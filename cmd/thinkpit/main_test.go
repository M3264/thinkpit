package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/M3264/thinkpit/internal/conversation"
)

func TestHeadlessAnswerAndExport(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		if calls == 2 {
			b, _ := json.Marshal(request)
			if !strings.Contains(string(b), "Budget is fixed") {
				t.Error("resumed request lost answer")
			}
		}
		ctrl := map[string]any{"addressed_id": "", "question": nil, "ready_to_pause": true}
		if calls == 1 {
			ctrl["question"] = map[string]any{"text": "What is the budget?", "essential": true}
		}
		control, _ := json.Marshal(ctrl)
		content := "Use a small fictional trial.\n<thinkpit-control>" + string(control) + "</thinkpit-control>"
		b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": content}}}})
		fmt.Fprintf(w, "data: %s\n\n", b)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":30,\"completion_tokens\":40}}\n\ndata: [DONE]\n\n")
	}))
	defer upstream.Close()
	dir := t.TempDir()
	configFile := filepath.Join(dir, "config.json")
	transcript := filepath.Join(dir, "transcript.json")
	t.Setenv("THINKPIT_FAKE_KEY", "never-export-this-key")
	config := map[string]any{"topic": "Fictional budget", "ask_questions": true, "participants": []any{map[string]string{"id": "a", "name": "Ada", "provider_id": "fake", "model": "test"}}, "providers": []any{map[string]string{"id": "fake", "kind": "openai_compat", "base_url": upstream.URL, "key_env": "THINKPIT_FAKE_KEY"}}}
	data, _ := json.Marshal(config)
	if err := os.WriteFile(configFile, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := headless(context.Background(), []string{"-config", configFile, "-out", transcript}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(transcript)
	if err != nil {
		t.Fatal(err)
	}
	var c conversation.Conversation
	_ = json.Unmarshal(data, &c)
	if c.State != conversation.Waiting || c.Pending == nil {
		t.Fatal("essential question not saved")
	}
	if err := headless(context.Background(), []string{"-config", configFile, "-resume", transcript, "-out", transcript, "-action", "message", "-text", "Budget is fixed at 100 units."}); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(transcript)
	if err != nil {
		t.Fatal(err)
	}
	c = conversation.Conversation{}
	_ = json.Unmarshal(data, &c)
	if c.State != conversation.Ready || c.Pending != nil || calls != 2 {
		t.Fatal("answer failed to resume")
	}
	md, err := os.ReadFile(filepath.Join(dir, "transcript.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data)+string(md), "never-export-this-key") {
		t.Fatal("key exported")
	}
}
