package httpapi

import (
	"context"
	"encoding/json"
	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/director"
	"github.com/M3264/thinkpit/internal/provider"
	"github.com/M3264/thinkpit/internal/storage"
	"time"
)

func runDecision(parent context.Context, s *storage.Store, id, owner string) {
	runDecisionUsing(parent, s, id, owner, director.New)
}
func runDecisionUsing(parent context.Context, s *storage.Store, id, owner string, newClient func(provider.Config) (*director.Client, error)) {
	var request director.Request
	var pending, providerID string
	err := s.Change(parent, id, owner, "decision_started", func(c *conversation.Conversation) (any, error) {
		if !c.NeedsDecision() || c.Brainstorm.PendingID != "" {
			return nil, conversation.ErrInvalid
		}
		if len(c.Attempts) >= c.Limits.MaxTurns {
			c.State = conversation.Stopped
			c.Reason = "turn_limit"
			return c, nil
		}
		var e error
		request, e = director.Prepare(c)
		if e != nil {
			c.State = conversation.Failed
			c.Reason = "all_models_failed"
			return c, nil
		}
		data, _ := json.Marshal(request)
		reservation := len(data) + 4096
		if c.ChargedTokens+reservation > c.Limits.MaxTokens {
			c.State = conversation.Stopped
			c.Reason = "token_limit"
			return c, nil
		}
		pending = conversation.ID()
		providerID = c.Brainstorm.ProviderID
		c.Brainstorm.PendingID = pending
		c.ChargedTokens += reservation
		c.Brainstorm.Decisions = append(c.Brainstorm.Decisions, conversation.Decision{ID: pending, Status: "running", ReservedTokens: reservation, CreatedAt: time.Now().UTC()})
		return c, nil
	})
	if err != nil || pending == "" {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 22*time.Second)
	defer cancel()
	done, exit := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(exit)
		tick := time.NewTicker(200 * time.Millisecond)
		defer tick.Stop()
		renew := time.NewTicker(5 * time.Second)
		defer renew.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-tick.C:
				c, e := s.Get(ctx, id)
				if e != nil || c.State != conversation.Running || c.Brainstorm == nil || c.Brainstorm.PendingID != pending {
					cancel()
					return
				}
			case <-renew.C:
				if s.Renew(ctx, id, owner) != nil {
					cancel()
					return
				}
			}
		}
	}()
	var decision conversation.Decision
	p, callErr := s.Provider(ctx, providerID)
	if callErr == nil {
		var client *director.Client
		client, callErr = newClient(p)
		if callErr == nil {
			decision, callErr = client.Decide(ctx, request)
		}
	}
	close(done)
	<-exit
	commit, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	_ = s.Change(commit, id, owner, "decision_finished", func(c *conversation.Conversation) (any, error) {
		b := c.Brainstorm
		if b == nil || b.PendingID != pending || c.State != conversation.Running {
			return nil, nil
		}
		old := b.Decisions[len(b.Decisions)-1]
		decision.ID = pending
		decision.CreatedAt = old.CreatedAt
		decision.ReservedTokens = old.ReservedTokens
		if decision.Usage.Known {
			c.ChargedTokens += decision.Usage.Input + decision.Usage.Output - old.ReservedTokens
		}
		if callErr == nil && (c.ChargedTokens > c.Limits.MaxTokens || (decision.Usage.Known && decision.Usage.Input+decision.Usage.Output > old.ReservedTokens)) {
			b.PendingID = ""
			decision.Status = "failed"
			decision.Error = "Coordination exceeded the token reservation"
			b.Decisions[len(b.Decisions)-1] = decision
			c.State = conversation.Stopped
			c.Reason = "token_limit"
			return c, nil
		}
		if callErr == nil {
			callErr = c.ApplyDecision(decision)
		}
		if callErr != nil {
			b.PendingID = ""
			decision.Status = "failed"
			decision.Error = callErr.Error()
			b.Decisions[len(b.Decisions)-1] = decision
			c.State = conversation.Failed
			c.Reason = "coordination_failure"
		}
		return c, nil
	})
}
