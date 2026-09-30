package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/M3264/thinkpit/internal/conversation"
)

type Config struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	BaseURL      string `json:"base_url"`
	EndpointPath string `json:"endpoint_path,omitempty"`
	HasKey       bool   `json:"has_key"`
	APIKey       string `json:"-"`
}
type Client interface {
	Stream(context.Context, conversation.Request, func(string) error) (conversation.Result, error)
}
type Adapter struct {
	Config Config
	HTTP   *http.Client
}

func Validate(c Config) error {
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(c.ID) > 128 || c.ID == "" || len(c.Name) > 128 || len(c.APIKey) > 8192 {
		return errors.New("invalid provider settings")
	}
	if c.EndpointPath != "" && (!strings.HasPrefix(c.EndpointPath, "/") || strings.ContainsAny(c.EndpointPath, "?#") || len(c.EndpointPath) > 256) {
		return errors.New("invalid provider endpoint path")
	}
	if c.Kind != "openai_compat" && c.Kind != "anthropic" {
		return errors.New("unsupported provider kind")
	}
	return nil
}
func New(c Config) (*Adapter, error) {
	if err := Validate(c); err != nil {
		return nil, err
	}
	return &Adapter{Config: c, HTTP: &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

const marker = "\n<thinkpit-control>"

// Filter keeps both control metadata and a partial delimiter out of text events.
type filter struct {
	all, pending string
	control      bool
	emit         func(string) error
}

func (f *filter) add(s string) error {
	f.all += s
	if len(f.all) > 1024*1024 {
		return errors.New("provider response too large")
	}
	if f.control {
		return nil
	}
	f.pending += s
	if at := strings.Index(f.pending, marker); at >= 0 {
		f.control = true
		text := f.pending[:at]
		f.pending = ""
		if text != "" {
			return f.emit(text)
		}
		return nil
	}
	hold := 0
	for n := 1; n < len(marker) && n <= len(f.pending); n++ {
		if strings.HasSuffix(f.pending, marker[:n]) {
			hold = n
		}
	}
	text := f.pending[:len(f.pending)-hold]
	f.pending = f.pending[len(f.pending)-hold:]
	if text != "" {
		return f.emit(text)
	}
	return nil
}
func parse(text string) (conversation.Result, error) {
	at := strings.LastIndex(text, marker)
	if at < 0 {
		return conversation.Result{}, errors.New("missing conversation control record")
	}
	body := strings.TrimSpace(text[at+len(marker):])
	if !strings.HasSuffix(body, "</thinkpit-control>") {
		return conversation.Result{}, errors.New("incomplete conversation control record")
	}
	body = strings.TrimSpace(strings.TrimSuffix(body, "</thinkpit-control>"))
	var shape map[string]json.RawMessage
	if json.Unmarshal([]byte(body), &shape) != nil || len(shape) != 3 || shape["addressed_id"] == nil || shape["question"] == nil || shape["ready_to_pause"] == nil || string(shape["ready_to_pause"]) == "null" || string(shape["addressed_id"]) == "null" {
		return conversation.Result{}, errors.New("invalid conversation control record")
	}
	if q := shape["question"]; string(q) != "null" {
		var fields map[string]json.RawMessage
		if json.Unmarshal(q, &fields) != nil || len(fields) != 2 || fields["text"] == nil || fields["essential"] == nil || string(fields["essential"]) == "null" {
			return conversation.Result{}, errors.New("invalid question control record")
		}
	}
	var control conversation.Control
	dec := json.NewDecoder(strings.NewReader(body))
	dec.DisallowUnknownFields()
	if dec.Decode(&control) != nil {
		return conversation.Result{}, errors.New("invalid conversation control record")
	}
	contribution := strings.TrimSpace(text[:at])
	if contribution == "" {
		return conversation.Result{}, errors.New("empty model contribution")
	}
	return conversation.Result{Text: contribution, Control: control}, nil
}
func (a *Adapter) Stream(ctx context.Context, r conversation.Request, emit func(string) error) (conversation.Result, error) {
	messages := []map[string]string{{"role": "system", "content": r.System}, {"role": "user", "content": r.Transcript}}
	path := "/chat/completions"
	body := map[string]any{"model": r.Participant.Model, "messages": messages, "max_tokens": r.MaxOutputTokens, "stream": true, "stream_options": map[string]bool{"include_usage": true}}
	if a.Config.Kind == "anthropic" {
		path = "/messages"
		body = map[string]any{"model": r.Participant.Model, "system": r.System, "messages": messages[1:], "max_tokens": r.MaxOutputTokens, "stream": true}
	}
	// Explicitly disable OpenRouter provider fallbacks; never change the chosen participant model silently.
	if strings.Contains(a.Config.BaseURL, "openrouter.ai") {
		body["provider"] = map[string]bool{"allow_fallbacks": false}
	}
	if a.Config.EndpointPath != "" {
		path = a.Config.EndpointPath
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(a.Config.BaseURL, "/")+path, bytes.NewReader(payload))
	if err != nil {
		return conversation.Result{}, errors.New("invalid provider URL")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if a.Config.Kind == "anthropic" {
		req.Header.Set("anthropic-version", "2023-06-01")
		req.Header.Set("x-api-key", a.Config.APIKey)
	} else if a.Config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+a.Config.APIKey)
	}
	resp, err := a.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return conversation.Result{}, ctx.Err()
		}
		return conversation.Result{}, errors.New("provider connection failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return conversation.Result{}, fmt.Errorf("provider returned HTTP %d", resp.StatusCode)
	} // Never echo upstream bodies or URLs: they may contain keys.
	f := filter{emit: emit}
	usage := conversation.Usage{}
	done := false
	finished := false
	err = readSSE(resp.Body, func(data string) error {
		if data == "[DONE]" {
			done = true
			return nil
		}
		var v struct {
			Type    string          `json:"type"`
			Error   json.RawMessage `json:"error"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Usage *struct {
				Prompt     int `json:"prompt_tokens"`
				Completion int `json:"completion_tokens"`
				Input      int `json:"input_tokens"`
				Output     int `json:"output_tokens"`
			} `json:"usage"`
			Message struct {
				Usage struct {
					Input  int `json:"input_tokens"`
					Output int `json:"output_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Delta struct {
				Type       string `json:"type"`
				Text       string `json:"text"`
				StopReason string `json:"stop_reason"`
			} `json:"delta"`
		}
		if json.Unmarshal([]byte(data), &v) != nil {
			return errors.New("invalid provider stream")
		}
		if v.Type == "error" || (v.Error != nil && string(v.Error) != "null") {
			return errors.New("provider stream error")
		}
		if a.Config.Kind == "anthropic" {
			switch v.Type {
			case "message_start":
				usage.Input = v.Message.Usage.Input
				usage.Output = v.Message.Usage.Output
				usage.Known = true
			case "content_block_delta":
				if v.Delta.Type == "text_delta" {
					return f.add(v.Delta.Text)
				}
			case "message_delta":
				if v.Usage != nil {
					usage.Output = v.Usage.Output
				}
				if v.Delta.StopReason == "end_turn" {
					finished = true
				}
			case "message_stop":
				done = true
			}
		} else {
			if v.Usage != nil {
				usage = conversation.Usage{Input: v.Usage.Prompt, Output: v.Usage.Completion, Known: true}
			}
			for _, choice := range v.Choices {
				if choice.FinishReason != nil {
					if *choice.FinishReason != "stop" {
						return errors.New("provider did not finish contribution")
					}
					finished = true
				}
				if err := f.add(choice.Delta.Content); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		usage.Known = false
		return conversation.Result{Usage: usage}, err
	}
	if !done || !finished {
		usage.Known = false
		return conversation.Result{Usage: usage}, errors.New("provider stream ended before completion")
	}
	result, err := parse(f.all)
	result.Usage = usage
	return result, err
}
func readSSE(r io.Reader, handle func(string) error) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	var lines []string
	dispatch := func() error {
		if len(lines) == 0 {
			return nil
		}
		data := strings.Join(lines, "\n")
		lines = nil
		return handle(data)
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			lines = append(lines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return errors.New("provider stream read failed")
	}
	return dispatch()
}
