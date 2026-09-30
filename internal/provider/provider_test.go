package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/M3264/thinkpit/internal/conversation"
)

const fullReply = `A specific reply to Ada's staffing concern.
<thinkpit-control>{"addressed_id":"a","question":null,"ready_to_pause":false}</thinkpit-control>`

func TestOpenAIStream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("bad request")
		}
		var req map[string]any
		if json.NewDecoder(r.Body).Decode(&req) != nil || req["stream"] != true {
			t.Error("streaming request missing")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, part := range []string{fullReply[:15], fullReply[15:50], fullReply[50:]} {
			b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": part}}}})
			fmt.Fprintf(w, "data: %s\n\n", b)
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":50,\"completion_tokens\":70}}\n\ndata: [DONE]\n\n")
	}))
	defer srv.Close()
	a, _ := New(Config{ID: "x", Kind: "openai_compat", BaseURL: srv.URL + "/v1", APIKey: "secret"})
	var streamed strings.Builder
	res, err := a.Stream(context.Background(), conversation.Request{Participant: conversation.Participant{Model: "test"}, MaxOutputTokens: 512}, func(s string) error { streamed.WriteString(s); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if res.Control.AddressedID != "a" || res.Usage.Input != 50 || res.Usage.Output != 70 || !res.Usage.Known {
		t.Fatal("normalized response wrong")
	}
	if strings.Contains(streamed.String(), "thinkpit-control") || strings.Contains(streamed.String(), "ready_to_pause") {
		t.Fatal("control leaked into text stream")
	}
}
func TestAnthropicStream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "secret" || r.Header.Get("anthropic-version") == "" {
			t.Error("bad native request")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":60,\"output_tokens\":1}}}\n\n")
		b, _ := json.Marshal(map[string]any{"type": "content_block_delta", "delta": map[string]string{"type": "text_delta", "text": fullReply}})
		fmt.Fprintf(w, "data: %s\n\n", b)
		fmt.Fprint(w, "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":80}}\n\ndata: {\"type\":\"message_stop\"}\n\n")
	}))
	defer srv.Close()
	a, _ := New(Config{ID: "x", Kind: "anthropic", BaseURL: srv.URL + "/v1", APIKey: "secret"})
	res, err := a.Stream(context.Background(), conversation.Request{}, func(string) error { return nil })
	if err != nil || res.Usage.Input != 60 || res.Usage.Output != 80 {
		t.Fatalf("normalization: %v %+v", err, res)
	}
}
func TestControlFilteringAtEveryBoundary(t *testing.T) {
	for cut := 0; cut <= len(fullReply); cut++ {
		var b strings.Builder
		f := filter{emit: func(s string) error { b.WriteString(s); return nil }}
		if err := f.add(fullReply[:cut]); err != nil {
			t.Fatal(err)
		}
		if err := f.add(fullReply[cut:]); err != nil {
			t.Fatal(err)
		}
		if b.String() != "A specific reply to Ada's staffing concern." {
			t.Fatalf("boundary %d: %q", cut, b.String())
		}
	}
}
func TestInvalidControlAndSecretSafety(t *testing.T) {
	for _, reply := range []string{"no control", fullReply + "extra", strings.Replace(fullReply, "false", "null", 1), strings.Replace(fullReply, "\"question\":null,", "", 1), strings.Replace(fullReply, "\"question\":null", "\"question\":{\"text\":\"?\"}", 1)} {
		if _, err := parse(reply); err == nil {
			t.Fatal("invalid control accepted")
		}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret key is secret", 401) }))
	defer srv.Close()
	a, _ := New(Config{ID: "x", Kind: "openai_compat", BaseURL: srv.URL, APIKey: "secret"})
	_, err := a.Stream(context.Background(), conversation.Request{}, func(string) error { return nil })
	if err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatal("upstream body leaked")
	}
	data, _ := json.Marshal(a.Config)
	if strings.Contains(string(data), "secret") {
		t.Fatal("config leaked key")
	}
}
func TestTruncatedStreamFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": fullReply}}}})
		fmt.Fprintf(w, "data: %s\n\n", b)
	}))
	defer srv.Close()
	a, _ := New(Config{ID: "x", Kind: "openai_compat", BaseURL: srv.URL})
	_, err := a.Stream(context.Background(), conversation.Request{}, func(string) error { return nil })
	if err == nil {
		t.Fatal("truncated stream marked complete")
	}
}

func TestRetryMetadata(t *testing.T) {
	for _, status := range []int{400, 401, 408, 429, 500, 503} {
		e := &RetryError{Status: status}
		want := status == 408 || status == 429 || status >= 500
		if e.Retryable() != want {
			t.Fatalf("status %d retry policy", status)
		}
	}
	if retryAfter("120") != 120*time.Second || retryAfter("invalid") != 0 {
		t.Fatal("Retry-After parsing failed")
	}
}
