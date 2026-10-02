package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/provider"
	"github.com/M3264/thinkpit/internal/storage"
)

func Work(ctx context.Context, s *storage.Store) error {
	owner := conversation.ID()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
		c, err := s.Claim(ctx, owner)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		if c == nil {
			continue
		}
		if c.PendingTool != "" {
			runTool(ctx, s, c, owner)
		} else {
			runTurn(ctx, s, c.ID, owner)
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err = s.Release(cleanup, c.ID, owner)
		cancel()
		if err != nil {
			return err
		}
	}
}
func runTurn(parent context.Context, s *storage.Store, id, owner string) {
	var req conversation.Request
	var aid string
	var ok bool
	err := s.Change(parent, id, owner, "turn_started", func(c *conversation.Conversation) (any, error) { req, aid, ok = c.Begin(); return c, nil })
	if err != nil || !ok {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Minute)
	defer cancel()
	watcherDone := make(chan struct{})
	watcherExit := make(chan struct{})
	go func() {
		defer close(watcherExit)
		tick := time.NewTicker(200 * time.Millisecond)
		defer tick.Stop()
		renew := time.NewTicker(5 * time.Second)
		defer renew.Stop()
		for {
			select {
			case <-watcherDone:
				return
			case <-ctx.Done():
				return
			case <-tick.C:
				c, err := s.Get(ctx, id)
				if err != nil || c.ActiveID != aid || c.State != conversation.Running {
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
	p, callErr := s.Provider(ctx, req.Participant.ProviderID)
	var result conversation.Result
	if callErr == nil {
		var adapter *provider.Adapter
		adapter, callErr = provider.New(p)
		if callErr == nil {
			result, callErr = adapter.Stream(ctx, req, func(text string) error {
				return s.Change(ctx, id, owner, "text_delta", func(c *conversation.Conversation) (any, error) {
					if !c.Delta(aid, text) {
						return nil, errors.New("turn interrupted")
					}
					return map[string]string{"attempt_id": aid, "text": text}, nil
				})
			})
		}
	}
	close(watcherDone)
	<-watcherExit
	// Completion is committed independently of the model context; stale attempts are ignored.
	commit, done := context.WithTimeout(context.Background(), 5*time.Second)
	defer done()
	_ = s.Change(commit, id, owner, "turn_finished", func(c *conversation.Conversation) (any, error) {
		if !c.Finish(aid, result, callErr) {
			return nil, nil
		}
		return c, nil
	})
}
