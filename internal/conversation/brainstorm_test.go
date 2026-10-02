package conversation

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func brainstormFixture(t *testing.T) *Conversation {
	c := fixture(t, true)
	c.EnableBrainstorm("router")
	if c.State != Running {
		if e := c.Command("start", "", nil); e != nil {
			t.Fatal(e)
		}
	}
	return c
}
func decide(t *testing.T, c *Conversation, action, speaker string) {
	t.Helper()
	if e := c.ApplyDecision(Decision{ID: ID(), Action: action, Speaker: speaker, ReplyTo: c.Messages[0].ID, Confidence: .9}); e != nil {
		t.Fatal(e)
	}
}
func finishIdea(t *testing.T, c *Conversation) {
	t.Helper()
	r, id, ok := c.Begin()
	if !ok {
		t.Fatal("did not begin", c.State, c.Reason)
	}
	if !r.Plain {
		t.Fatal("normal idea requires plain output")
	}
	if !c.Finish(id, Result{Text: "A concrete idea\nA specific useful contribution."}, nil) {
		t.Fatal("finish failed")
	}
}
func TestBrainstormStopsAndResumesFromFocus(t *testing.T) {
	c := brainstormFixture(t)
	if _, _, ok := c.Begin(); ok {
		t.Fatal("generation before decision")
	}
	decide(t, c, "explore", "a")
	finishIdea(t, c)
	decide(t, c, "challenge", "b")
	finishIdea(t, c)
	target := c.Messages[1].ID
	decide(t, c, "yield", "a")
	finishIdea(t, c)
	if c.State != Ready || c.Reason != "brainstorm_complete" {
		t.Fatal(c.State, c.Reason)
	}
	if e := c.SetFocus(target); e != nil {
		t.Fatal(e)
	}
	if e := c.Command("message", "Try a smaller version", nil); e != nil {
		t.Fatal(e)
	}
	if c.State != Running || c.Brainstorm.ExchangeTurns != 0 || c.Messages[len(c.Messages)-1].ReplyTo != target {
		t.Fatal("focused followup not resumed")
	}
}
func TestBrainstormPermissionsAndFairness(t *testing.T) {
	c := brainstormFixture(t)
	decide(t, c, "research", "a")
	if c.Brainstorm.Action == "research" {
		t.Fatal("web disabled")
	}
	finishIdea(t, c)
	decide(t, c, "develop", "a")
	finishIdea(t, c)
	decide(t, c, "develop", "a")
	if c.Participants[c.Next].ID == "a" {
		t.Fatal("speaker monopolized room")
	}
	c.Unavailable = map[string]string{"b": "offline"}
	if c.ApplyDecision(Decision{Action: "explore", Speaker: "b"}) == nil {
		t.Fatal("unavailable speaker allowed")
	}
	c.AskQuestions = false
	decide(t, c, "ask", "a")
	if c.Brainstorm.Action == "ask" {
		t.Fatal("questions disabled")
	}
}
func TestBrainstormAskInterruptionAndRecovery(t *testing.T) {
	c := brainstormFixture(t)
	decide(t, c, "ask", "a")
	finishIdea(t, c)
	if c.State != Waiting || c.Pending == nil {
		t.Fatal("essential question did not wait")
	}
	if e := c.Command("skip_question", "", nil); e != nil {
		t.Fatal(e)
	}
	if !c.NeedsDecision() {
		t.Fatal("skip did not resume")
	}
	c.Brainstorm.PendingID = "pending"
	c.Brainstorm.Decisions = append(c.Brainstorm.Decisions, Decision{ID: "pending", Status: "running", ReservedTokens: 4000})
	c.ChargedTokens += 4000
	reserved := c.ChargedTokens
	c.Recover()
	if c.Brainstorm.PendingID != "" || c.Brainstorm.Decisions[len(c.Brainstorm.Decisions)-1].Status != "interrupted" || c.ChargedTokens != reserved {
		t.Fatal("decision recovery failed")
	}
}
func TestBrainstormBoundAndFailure(t *testing.T) {
	c := brainstormFixture(t)
	c.Brainstorm.ExchangeTurns = 8
	decide(t, c, "explore", "a")
	if c.Brainstorm.Action != "synthesize" {
		t.Fatal("exchange not bounded")
	}
	_, id, ok := c.Begin()
	if !ok {
		t.Fatal("begin")
	}
	c.Finish(id, Result{}, errors.New("offline"))
	if !c.NeedsDecision() || c.Brainstorm.Action != "" {
		t.Fatal("failed participant did not yield")
	}
}
func TestBrainstormStateBoundedAndLegacyUnchanged(t *testing.T) {
	c := brainstormFixture(t)
	c.Topic = strings.Repeat("a", 32000)
	for i := 0; i < 30; i++ {
		c.Messages = append(c.Messages, Message{ID: ID(), Content: strings.Repeat("z", 32000), Status: "complete"})
	}
	state := c.DecisionState()
	if len(state) > 35000 || !json.Valid(state) {
		t.Fatal("unbounded state")
	}
	legacy := fixture(t, true)
	if legacy.NeedsDecision() {
		t.Fatal("legacy scheduler changed")
	}
}
