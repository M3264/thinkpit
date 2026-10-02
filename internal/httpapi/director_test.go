package httpapi

import (
	"context"
	"encoding/json"
	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/director"
	"github.com/M3264/thinkpit/internal/provider"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDurableDecisionAndHumanCancellation(t *testing.T) {
	for _, interrupt := range []bool{false, true} {
		t.Run(map[bool]string{false: "complete", true: "interrupt"}[interrupt], func(t *testing.T) {
			s := database(t)
			c := makeConversation(t, s)
			s.Change(context.Background(), c.ID, "", "setup", func(c *conversation.Conversation) (any, error) {
				c.EnableBrainstorm("router")
				c.Command("start", "", nil)
				return c, nil
			})
			saveFake(t, s, "https://openrouter.ai/api/v1", "router", "openai_compat")
			owner := "test-worker"
			if _, e := s.Claim(context.Background(), owner); e != nil {
				t.Fatal(e)
			}
			entered := make(chan struct{})
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req director.Request
				if json.NewDecoder(r.Body).Decode(&req) != nil {
					t.Error("request invalid")
				}
				close(entered)
				if interrupt {
					<-r.Context().Done()
					return
				}
				answers := map[string]any{}
				for k, q := range req.Questions {
					choice := ""
					probs := map[string]float64{}
					for id := range q.Criteria {
						probs[id] = 0
						choice = id
					}
					if k == "action" {
						choice = "explore"
					}
					if k == "speaker" {
						choice = "b"
					}
					probs[choice] = 1
					answers[k] = map[string]any{"type": "choice", "choice": choice, "confidence": .9, "probabilities": probs}
				}
				json.NewEncoder(w).Encode(map[string]any{"model": "test-jev", "answers": answers, "usage": map[string]int{"input_tokens": 100, "output_tokens": 50}})
			}))
			defer srv.Close()
			finished := make(chan struct{})
			go func() {
				defer close(finished)
				runDecisionUsing(context.Background(), s, c.ID, owner, func(provider.Config) (*director.Client, error) {
					return &director.Client{Endpoint: srv.URL, HTTP: srv.Client()}, nil
				})
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("decision never started")
			}
			if interrupt {
				command(t, s, c.ID, "message", "Focus on accessibility")
			}
			select {
			case <-finished:
			case <-time.After(3 * time.Second):
				t.Fatal("decision not cancelled/completed")
			}
			live, e := s.Get(context.Background(), c.ID)
			if e != nil {
				t.Fatal(e)
			}
			d := live.Brainstorm.Decisions[0]
			if live.Brainstorm.PendingID != "" {
				t.Fatal("pending not cleared")
			}
			if interrupt {
				if d.Status != "interrupted" || live.Brainstorm.Action != "" {
					t.Fatal("stale decision applied")
				}
				if live.ChargedTokens != d.ReservedTokens {
					t.Fatal("interrupted reservation lost")
				}
			} else {
				if d.Status != "complete" || live.Next != 1 || live.ChargedTokens != 150 {
					t.Fatalf("decision not durably applied: %+v", d)
				}
				req, _, ok := live.Begin()
				if !ok || !req.Plain || req.Participant.ID != "b" {
					t.Fatal("decision did not schedule chosen speaker")
				}
			}
		})
	}
}
