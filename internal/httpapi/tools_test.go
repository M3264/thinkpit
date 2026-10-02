package httpapi

import (
	"context"
	"github.com/M3264/thinkpit/internal/conversation"
	"strings"
	"testing"
)

func TestReadOnlyToolBoundaries(t *testing.T) {
	ctx := context.Background()
	for _, zone := range []string{"", "UTC", "Europe/London"} {
		result, sources, err := executeTool(ctx, conversation.ToolCall{Name: "current_time", Timezone: zone})
		if err != nil || !strings.Contains(result, "T") || len(sources) != 0 {
			t.Fatalf("timezone %q: result=%q error=%v", zone, result, err)
		}
	}
	for _, call := range []conversation.ToolCall{
		{Name: "current_time", Timezone: "not/a/timezone"},
		{Name: "read_page", URL: "http://127.0.0.1/private"},
		{Name: "read_page", URL: "http://169.254.169.254/latest/meta-data"},
		{Name: "send_email"},
	} {
		result, sources, err := executeTool(ctx, call)
		if err == nil || result != "" || len(sources) != 0 {
			t.Fatalf("unsafe/invalid call accepted: %+v", call)
		}
	}
}
