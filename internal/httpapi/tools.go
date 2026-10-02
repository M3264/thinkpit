package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/evidence"
	"github.com/M3264/thinkpit/internal/storage"
	"os"
	"time"
	_ "time/tzdata"
)

func executeTool(ctx context.Context, call conversation.ToolCall) (string, []conversation.Evidence, error) {
	switch call.Name {
	case "web_search":
		found, err := evidence.Search(ctx, os.Getenv("THINKPIT_SEARCH_URL"), call.Query)
		if err != nil {
			return "", nil, err
		}
		if len(found.Results) > 5 {
			found.Results = found.Results[:5]
		}
		sources := []conversation.Evidence{}
		for i, r := range found.Results {
			if len(r.Content) > 1800 {
				found.Results[i].Content = r.Content[:1800]
			}
			sources = append(sources, conversation.Evidence{ID: conversation.ID(), Kind: "web", Name: r.Title, URL: r.URL, Text: found.Results[i].Content, Truncated: true})
		}
		data, _ := json.Marshal(found)
		return string(data), sources, nil
	case "read_page":
		page, err := evidence.Fetch(ctx, call.URL)
		if err != nil {
			return "", nil, err
		}
		if len(page.Text) > 10000 {
			page.Text = page.Text[:10000]
			page.Truncated = true
		}
		data, _ := json.Marshal(page)
		return string(data), []conversation.Evidence{page}, nil
	case "current_time":
		zone := call.Timezone
		if zone == "" {
			zone = "UTC"
		}
		location, err := time.LoadLocation(zone)
		if err != nil {
			return "", nil, errors.New("unknown timezone; use an IANA timezone such as UTC or Europe/London")
		}
		return time.Now().In(location).Format(time.RFC3339) + " (" + zone + ")", nil, nil
	default:
		return "", nil, errors.New("unknown tool")
	}
}
func runTool(parent context.Context, s *storage.Store, c *conversation.Conversation, owner string) {
	toolID := c.PendingTool
	var call conversation.ToolCall
	err := s.Change(parent, c.ID, owner, "tool_started", func(saved *conversation.Conversation) (any, error) {
		if saved.State != conversation.Running || saved.PendingTool != toolID || !saved.ToolsEnabled {
			return nil, conversation.ErrInvalid
		}
		for i := range saved.Tools {
			if saved.Tools[i].ID == toolID {
				saved.Tools[i].Status = "running"
				call = saved.Tools[i].Call
				return saved, nil
			}
		}
		return nil, conversation.ErrInvalid
	})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()
	exit := make(chan struct{})
	done := make(chan struct{})
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
				live, err := s.Get(ctx, c.ID)
				if err != nil || live.PendingTool != toolID || live.State != conversation.Running || !live.ToolsEnabled {
					cancel()
					return
				}
			case <-renew.C:
				if s.Renew(ctx, c.ID, owner) != nil {
					cancel()
					return
				}
			}
		}
	}()
	result, sources, callErr := executeTool(ctx, call)
	close(done)
	<-exit
	commit, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	_ = s.Change(commit, c.ID, owner, "tool_finished", func(live *conversation.Conversation) (any, error) {
		if live.PendingTool != toolID || live.State != conversation.Running || !live.ToolsEnabled {
			return nil, nil
		}
		for i := range live.Tools {
			if live.Tools[i].ID == toolID {
				record := &live.Tools[i]
				record.Status = "complete"
				record.Result = result
				record.Sources = sources
				if callErr != nil {
					record.Status = "failed"
					record.Error = callErr.Error()
				}
				break
			}
		}
		live.PendingTool = ""
		live.UpdatedAt = time.Now().UTC()
		return live, nil
	})
}
