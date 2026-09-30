package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Metadata comes from the configured provider; unknown prices remain unknown.
type Model struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description,omitempty"`
	Context      int      `json:"context_length,omitempty"`
	Free         *bool    `json:"free,omitempty"`
	Capabilities []string `json:"capabilities"`
}
type Catalog struct {
	Models    []Model `json:"models"`
	Truncated bool    `json:"truncated"`
}
type modelRecord struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	DisplayName  string          `json:"display_name"`
	Description  string          `json:"description"`
	Context      int             `json:"context_length"`
	MaxInput     int             `json:"max_input_tokens"`
	Tier         string          `json:"tier"`
	Reasoning    json.RawMessage `json:"reasoning"`
	Vision       bool            `json:"vision"`
	Tools        bool            `json:"tools"`
	Input        []string        `json:"input_modalities"`
	Output       []string        `json:"output_modalities"`
	Architecture struct {
		Input  []string `json:"input_modalities"`
		Output []string `json:"output_modalities"`
	} `json:"architecture"`
	Pricing      map[string]json.RawMessage `json:"pricing"`
	Parameters   []string                   `json:"supported_parameters"`
	Capabilities map[string]struct {
		Supported bool `json:"supported"`
	} `json:"capabilities"`
}

func (a *Adapter) Models(ctx context.Context) (Catalog, error) {
	out := Catalog{Models: []Model{}}
	base := strings.TrimRight(a.Config.BaseURL, "/")
	parsed, _ := url.Parse(base)
	pollinations := parsed.Hostname() == "text.pollinations.ai"
	next := base + "/models"
	if a.Config.Kind == "anthropic" {
		next += "?limit=1000"
	}
	seen := map[string]bool{}
	for page := 0; page < 10; page++ {
		req, err := http.NewRequestWithContext(ctx, "GET", next, nil)
		if err != nil {
			return out, errors.New("invalid model catalog URL")
		}
		req.Header.Set("Accept", "application/json")
		if a.Config.Kind == "anthropic" {
			req.Header.Set("anthropic-version", "2023-06-01")
			req.Header.Set("x-api-key", a.Config.APIKey)
		} else if a.Config.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+a.Config.APIKey)
		}
		resp, err := a.HTTP.Do(req)
		if err != nil {
			return out, errors.New("model catalog connection failed")
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
		resp.Body.Close()
		if resp.StatusCode != 200 {
			return out, fmt.Errorf("model catalog returned HTTP %d", resp.StatusCode)
		}
		if readErr != nil || len(data) > 8*1024*1024 {
			return out, errors.New("model catalog response too large")
		}
		// Never return a provider that reflects its credential in catalog metadata.
		if a.Config.APIKey != "" && strings.Contains(string(data), a.Config.APIKey) {
			return out, errors.New("unsafe model catalog response")
		}
		var records []modelRecord
		var envelope struct {
			Data    []modelRecord `json:"data"`
			HasMore bool          `json:"has_more"`
			LastID  string        `json:"last_id"`
		}
		if pollinations {
			err = json.Unmarshal(data, &records)
		} else {
			err = json.Unmarshal(data, &envelope)
			records = envelope.Data
		}
		if err != nil || records == nil {
			return out, errors.New("invalid model catalog response")
		}
		for _, r := range records {
			modelID := r.ID
			if pollinations {
				modelID = r.Name
			}
			if modelID == "" || len(modelID) > 256 || seen[modelID] {
				continue
			}
			seen[modelID] = true
			output := append(r.Output, r.Architecture.Output...)
			if len(output) > 0 && !contains(output, "text") {
				continue
			}
			m := Model{ID: modelID, Name: r.Name, Description: r.Description, Context: r.Context, Capabilities: []string{}}
			if r.DisplayName != "" {
				m.Name = r.DisplayName
			}
			if m.Name == "" {
				m.Name = modelID
			}
			if m.Context == 0 {
				m.Context = r.MaxInput
			}
			if r.Vision || contains(r.Input, "image") || contains(r.Architecture.Input, "image") || r.Capabilities["image_input"].Supported {
				m.Capabilities = append(m.Capabilities, "vision")
			}
			if reasoningSupported(r.Reasoning) || contains(r.Parameters, "reasoning") || r.Capabilities["thinking"].Supported {
				m.Capabilities = append(m.Capabilities, "reasoning")
			}
			if r.Tools || contains(r.Parameters, "tools") {
				m.Capabilities = append(m.Capabilities, "tools")
			}
			if pollinations && r.Tier == "anonymous" {
				free := true
				m.Free = &free
			}
			if p, ok := r.Pricing["prompt"]; ok {
				if q, ok := r.Pricing["completion"]; ok {
					pn, pe := price(p)
					qn, qe := price(q)
					if pe == nil && qe == nil && pn >= 0 && qn >= 0 {
						free := pn == 0 && qn == 0
						if fee, exists := r.Pricing["request"]; exists {
							amount, err := price(fee)
							free = free && err == nil && amount == 0
						}
						m.Free = &free
					}
				}
			}
			out.Models = append(out.Models, m)
			if len(out.Models) >= 5000 {
				out.Truncated = true
				break
			}
		}
		if out.Truncated || !envelope.HasMore {
			break
		}
		if envelope.LastID == "" {
			return out, errors.New("invalid model catalog pagination")
		}
		next = base + "/models?limit=1000&after_id=" + url.QueryEscape(envelope.LastID)
		if page == 9 {
			out.Truncated = true
		}
	}
	sort.Slice(out.Models, func(i, j int) bool { return strings.ToLower(out.Models[i].Name) < strings.ToLower(out.Models[j].Name) })
	return out, nil
}
func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}
func price(raw json.RawMessage) (float64, error) {
	s := string(raw)
	var v string
	if json.Unmarshal(raw, &v) == nil {
		s = v
	}
	return strconv.ParseFloat(s, 64)
}

func reasoningSupported(raw json.RawMessage) bool {
	if string(raw) == "true" {
		return true
	}
	var metadata map[string]json.RawMessage
	return json.Unmarshal(raw, &metadata) == nil && len(metadata) > 0
}
