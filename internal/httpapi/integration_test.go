package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/provider"
	"github.com/M3264/thinkpit/internal/storage"
)

func database(t *testing.T) *storage.Store {
	t.Helper()
	dsn := os.Getenv("THINKPIT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set THINKPIT_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	if !strings.Contains(dsn, "thinkpit_test") {
		t.Fatal("integration database must be named thinkpit_test")
	}
	s, err := storage.Open(context.Background(), dsn, bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Pool.Exec(context.Background(), "TRUNCATE events, conversations, providers RESTART IDENTITY CASCADE")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Pool.Close)
	return s
}
func saveFake(t *testing.T, s *storage.Store, url, id, kind string) {
	t.Helper()
	if err := s.SaveProvider(context.Background(), provider.Config{ID: id, Kind: kind, BaseURL: url, APIKey: "sensitive-test-key"}); err != nil {
		t.Fatal(err)
	}
}
func makeConversation(t *testing.T, s *storage.Store) *conversation.Conversation {
	t.Helper()
	c, err := conversation.New("Fictional library decision", []conversation.Participant{{ID: "a", Name: "Access", ProviderID: "one", Model: "test"}, {ID: "b", Name: "Staffing", ProviderID: "two", Model: "test"}}, true, conversation.Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Create(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	return c
}
func command(t *testing.T, s *storage.Store, id, action, text string) {
	t.Helper()
	if err := s.Change(context.Background(), id, "", "control", func(c *conversation.Conversation) (any, error) { err := c.Command(action, text, nil); return c, err }); err != nil {
		t.Fatal(err)
	}
}
func await(t *testing.T, s *storage.Store, id string, predicate func(*conversation.Conversation) bool) *conversation.Conversation {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		c, err := s.Get(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if predicate(c) {
			return c
		}
		time.Sleep(20 * time.Millisecond)
	}
	c, _ := s.Get(context.Background(), id)
	t.Fatalf("timed out: %+v", c)
	return nil
}
func startWorker(t *testing.T, s *storage.Store) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Work(ctx, s) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(5 * time.Second):
			t.Error("worker failed to stop")
		}
	})
}
func reply(w http.ResponseWriter, kind, text string, ctrl conversation.Control) {
	control, _ := json.Marshal(ctrl)
	content := text + "\n<thinkpit-control>" + string(control) + "</thinkpit-control>"
	w.Header().Set("Content-Type", "text/event-stream")
	if kind == "anthropic" {
		fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":50,\"output_tokens\":1}}}\n\n")
		b, _ := json.Marshal(map[string]any{"type": "content_block_delta", "delta": map[string]string{"type": "text_delta", "text": content}})
		fmt.Fprintf(w, "data: %s\n\n", b)
		fmt.Fprint(w, "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":40}}\n\ndata: {\"type\":\"message_stop\"}\n\n")
		return
	}
	b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": content}}}})
	fmt.Fprintf(w, "data: %s\n\n", b)
	fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":50,\"completion_tokens\":40}}\n\ndata: [DONE]\n\n")
}
func TestWorkerQuestionsAndTwoProviders(t *testing.T) {
	s := database(t)
	var calls atomic.Int32
	var addressed atomic.Bool
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		n := calls.Add(1)
		kind := "openai_compat"
		if r.URL.Path == "/messages" {
			kind = "anthropic"
		}
		if n == 2 {
			b, _ := json.Marshal(body["messages"])
			addressed.Store(strings.Contains(string(b), "Saturday staffing"))
		}
		ctrl := conversation.Control{ReadyToPause: true}
		text := "Saturday staffing requires a short volunteer trial."
		if n == 1 {
			ctrl.Question = &conversation.Question{Text: "Any preference?", Essential: false}
		}
		if n == 2 {
			ctrl.Question = &conversation.Question{Text: "What is the budget?", Essential: true}
			text = "Responding to Access: Saturday staffing needs a fixed budget."
		}
		reply(w, kind, text, ctrl)
	}))
	defer fake.Close()
	saveFake(t, s, fake.URL, "one", "openai_compat")
	saveFake(t, s, fake.URL, "two", "anthropic")
	c := makeConversation(t, s)
	startWorker(t, s)
	startWorker(t, s)
	command(t, s, c.ID, "start", "")
	waiting := await(t, s, c.ID, func(c *conversation.Conversation) bool { return c.State == conversation.Waiting })
	if !addressed.Load() || calls.Load() != 2 || len(waiting.Attempts) != 2 || waiting.Pending == nil {
		t.Fatal("shared provider context, optional question, or worker fencing failed")
	}
	time.Sleep(300 * time.Millisecond)
	if calls.Load() != 2 {
		t.Fatal("essential question did not block")
	}
	// A new store instance reads the same authoritative transcript and pending question.
	reopened, err := storage.Open(context.Background(), os.Getenv("THINKPIT_TEST_DATABASE_URL"), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	restored, err := reopened.Get(context.Background(), c.ID)
	reopened.Pool.Close()
	if err != nil || restored.Pending == nil || len(restored.Messages) != 3 {
		t.Fatal("restart lost messages or pending question")
	}
	command(t, s, c.ID, "message", "Budget is fixed at 100 fictional units.")
	finished := await(t, s, c.ID, func(c *conversation.Conversation) bool { return c.State == conversation.Ready })
	if finished.Pending != nil || len(finished.Attempts) != 4 || calls.Load() != 4 {
		t.Fatal("answer did not resume exactly one round")
	}
	for _, a := range finished.Attempts {
		if a.Status != "complete" {
			t.Fatal("duplicate or incomplete completed turns")
		}
	}
}
func TestHumanInterruptionAndStopCancelUpstream(t *testing.T) {
	s := database(t)
	var calls atomic.Int32
	started := make(chan struct{}, 4)
	cancelled := make(chan struct{}, 4)
	var newContext atomic.Bool
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if n == 2 {
			b, _ := json.Marshal(body)
			newContext.Store(strings.Contains(string(b), "Changed constraint") && !strings.Contains(string(b), "incomplete old reply"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"incomplete old reply\"}}]}\n\n")
		w.(http.Flusher).Flush()
		started <- struct{}{}
		<-r.Context().Done()
		cancelled <- struct{}{}
	}))
	defer fake.Close()
	saveFake(t, s, fake.URL, "one", "openai_compat")
	saveFake(t, s, fake.URL, "two", "openai_compat")
	c := makeConversation(t, s)
	startWorker(t, s)
	command(t, s, c.ID, "start", "")
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("call not started")
	}
	await(t, s, c.ID, func(c *conversation.Conversation) bool { return len(c.Messages) == 2 && c.Messages[1].Content != "" })
	command(t, s, c.ID, "message", "Changed constraint: do not extend hours.")
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream not cancelled")
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("next call not started")
	}
	if !newContext.Load() {
		t.Fatal("interruption absent from next context")
	}
	command(t, s, c.ID, "stop", "")
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("stop did not cancel")
	}
	time.Sleep(500 * time.Millisecond)
	if calls.Load() != 2 {
		t.Fatal("call after stop")
	}
	stored, _ := s.Get(context.Background(), c.ID)
	if stored.State != conversation.Stopped || stored.Messages[1].Status != "incomplete" || stored.Attempts[0].Status != "interrupted" {
		t.Fatal("interruption state lost")
	}
}
func TestLeaseRecoveryAndLateWorkerFencing(t *testing.T) {
	s := database(t)
	saveFake(t, s, "http://localhost:9999", "one", "openai_compat")
	saveFake(t, s, "http://localhost:9999", "two", "openai_compat")
	c := makeConversation(t, s)
	command(t, s, c.ID, "start", "")
	claimed, err := s.Claim(context.Background(), "worker-one")
	if err != nil || claimed == nil {
		t.Fatal(err)
	}
	var aid string
	err = s.Change(context.Background(), c.ID, "worker-one", "turn_started", func(c *conversation.Conversation) (any, error) {
		_, id, ok := c.Begin()
		aid = id
		if !ok {
			t.Fatal("begin failed")
		}
		c.Delta(aid, "lost partial reply")
		return c, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Claim(context.Background(), "worker-two")
	if err != nil || second != nil {
		t.Fatal("unexpired lease stolen")
	}
	_, err = s.Pool.Exec(context.Background(), "UPDATE conversations SET lease_until=now()-interval '1 second' WHERE id=$1", c.ID)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := s.Claim(context.Background(), "worker-two")
	if err != nil || recovered == nil || recovered.ActiveID != "" || recovered.Attempts[0].Status != "interrupted" || recovered.Messages[1].Status != "incomplete" {
		t.Fatal("lease recovery failed")
	}
	err = s.Change(context.Background(), c.ID, "worker-one", "turn_finished", func(c *conversation.Conversation) (any, error) {
		c.Finish(aid, conversation.Result{Text: "duplicate"}, nil)
		return c, nil
	})
	if !errors.Is(err, storage.ErrLease) {
		t.Fatal("late worker was not fenced")
	}
}
func TestHTTPAuthSecretsAndEventReplay(t *testing.T) {
	s := database(t)
	saveFake(t, s, "http://localhost:9999", "one", "openai_compat")
	saveFake(t, s, "http://localhost:9999", "two", "openai_compat")
	c := makeConversation(t, s)
	api := httptest.NewServer((&Server{Store: s, Username: "admin", Password: "long-test-password"}).Handler())
	defer api.Close()
	resp, err := http.Get(api.URL + "/api/providers")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatal("unauthenticated access")
	}
	request := func(method, path, body string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, api.URL+path, strings.NewReader(body))
		req.SetBasicAuth("admin", "long-test-password")
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	resp = request("GET", "/api/providers", "")
	var providers []provider.Config
	err = json.NewDecoder(resp.Body).Decode(&providers)
	resp.Body.Close()
	if err != nil || len(providers) != 2 || !providers[0].HasKey || providers[0].APIKey != "" {
		t.Fatal("provider key exposed")
	}
	var encrypted []byte
	if err = s.Pool.QueryRow(context.Background(), "SELECT encrypted_key FROM providers WHERE id='one'").Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encrypted, []byte("sensitive-test-key")) {
		t.Fatal("key stored in cleartext")
	}
	resp = request("POST", "/api/conversations/"+c.ID+"/controls", `{"action":"start","surprise":true}`)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatal("unknown fields accepted")
	}
	command(t, s, c.ID, "start", "")
	events, err := s.Events(context.Background(), c.ID, 0)
	if err != nil || len(events) != 2 {
		t.Fatal("events missing")
	}
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", api.URL+"/api/conversations/"+c.ID+"/events", nil)
	req.SetBasicAuth("admin", "long-test-password")
	req.Header.Set("Last-Event-ID", fmt.Sprint(events[0].ID))
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(resp.Body)
	line, err := reader.ReadString('\n')
	cancel()
	resp.Body.Close()
	if err != nil || line != fmt.Sprintf("id: %d\n", events[1].ID) {
		t.Fatalf("replay not ordered: %q %v", line, err)
	}
	req, _ = http.NewRequest("POST", api.URL+"/api/conversations/"+c.ID+"/controls", strings.NewReader(`{"action":"stop"}`))
	req.SetBasicAuth("admin", "long-test-password")
	req.Header.Set("Origin", "https://untrusted.example")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("cross-origin mutation accepted")
	}
	resp = request("GET", "/api/conversations/"+c.ID+"/export", "")
	var exported bytes.Buffer
	_, _ = exported.ReadFrom(resp.Body)
	resp.Body.Close()
	if strings.Contains(exported.String(), "sensitive-test-key") {
		t.Fatal("export exposed credentials")
	}
	resp = request("DELETE", "/api/conversations/"+c.ID, "")
	resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Fatal("delete failed")
	}
	events, err = s.Events(context.Background(), c.ID, 0)
	if err != nil || len(events) != 0 {
		t.Fatal("delete left event data")
	}
}
