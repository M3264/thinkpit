package director

import (
	"context"
	"encoding/json"
	"github.com/M3264/thinkpit/internal/conversation"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func request(t *testing.T) Request {
	c, e := conversation.New("A fictional idea", []conversation.Participant{{ID: "a", Name: "A", ProviderID: "router", Model: "free"}}, true, conversation.Limits{})
	if e != nil {
		t.Fatal(e)
	}
	c.EnableBrainstorm("router")
	r, e := Prepare(c)
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func TestTypedDecisionAndInvalidResponses(t *testing.T) {
	for _, variant := range []string{"valid", "bad_choice", "missing", "negative_usage", "bad_probability", "secret_error"} {
		t.Run(variant, func(t *testing.T) {
			r := request(t)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if req.Header.Get("Authorization") != "Bearer private" {
					t.Error("missing server credential")
				}
				if variant == "secret_error" {
					http.Error(w, "private credential and upstream details", 429)
					return
				}
				answers := map[string]any{}
				for k, q := range r.Questions {
					probs := map[string]float64{}
					choice := ""
					for option := range q.Criteria {
						probs[option] = 0
						choice = option
					}
					probs[choice] = 1
					answers[k] = map[string]any{"type": "choice", "choice": choice, "confidence": .9, "probabilities": probs}
				}
				if variant == "bad_choice" {
					answers["speaker"].(map[string]any)["choice"] = "stranger"
				}
				if variant == "missing" {
					delete(answers, "action")
				}
				if variant == "bad_probability" {
					answers["action"].(map[string]any)["confidence"] = 1.5
				}
				input := 100
				if variant == "negative_usage" {
					input = -1
				}
				json.NewEncoder(w).Encode(map[string]any{"model": "test", "answers": answers, "usage": map[string]int{"input_tokens": input, "output_tokens": 20}})
			}))
			defer srv.Close()
			client := Client{Endpoint: srv.URL, Key: "private", HTTP: srv.Client()}
			d, e := client.Decide(context.Background(), r)
			if variant == "valid" || variant == "negative_usage" {
				if e != nil {
					t.Fatal(e)
				}
				if variant == "negative_usage" && d.Usage.Known {
					t.Fatal("invalid usage trusted")
				}
			} else if e == nil {
				t.Fatal("bad response accepted")
			}
			if e != nil && strings.Contains(e.Error(), "private") {
				t.Fatal("secret exposed")
			}
		})
	}
}
func TestContextCancellation(t *testing.T) {
	r := request(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c := Client{Endpoint: "http://127.0.0.1:1", HTTP: http.DefaultClient}
	if _, e := c.Decide(ctx, r); e != context.Canceled {
		t.Fatal(e)
	}
}
