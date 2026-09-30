package conversation

import (
	"errors"
	"strings"
	"testing"
)

func fixture(t *testing.T, ask bool) *Conversation {
	t.Helper()
	c, err := New("Should our fictional library extend weekend hours?", []Participant{{ID: "a", Name: "Ada", ProviderID: "one", Model: "same"}, {ID: "b", Name: "Bo", ProviderID: "two", Model: "same"}, {ID: "c", Name: "Cy", ProviderID: "one", Model: "same"}}, ask, Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if err = c.Command("start", "", nil); err != nil {
		t.Fatal(err)
	}
	return c
}
func turn(t *testing.T, c *Conversation, ctrl Control) Request {
	t.Helper()
	req, aid, ok := c.Begin()
	if !ok {
		t.Fatalf("could not begin: %s %s", c.State, c.Reason)
	}
	c.Delta(aid, "partial")
	if !c.Finish(aid, Result{Text: "Consider the specific staffing tradeoff from the previous message.", Control: ctrl, Usage: Usage{Input: 20, Output: 30, Known: true}}, nil) {
		t.Fatal("finish ignored")
	}
	return req
}
func TestSharedHistoryAndDistinctIdentities(t *testing.T) {
	c := fixture(t, true)
	first := turn(t, c, Control{AddressedID: "c"})
	next := turn(t, c, Control{})
	if first.Participant.ID != "a" || next.Participant.ID != "c" {
		t.Fatal("addressed participant not selected")
	}
	if !strings.Contains(next.Transcript, "Ada (a)") || !strings.Contains(next.Transcript, "specific staffing tradeoff") {
		t.Fatal("shared transcript lost speaker or contribution")
	}
	if !strings.Contains(next.System, "Bo") || first.Participant.Model != next.Participant.Model {
		t.Fatal("same-model identities unavailable")
	}
	third := turn(t, c, Control{AddressedID: "a"})
	if third.Participant.ID != "b" {
		t.Fatal("participant starved")
	}
}
func TestQuestionRules(t *testing.T) {
	for _, essential := range []bool{true, false} {
		c := fixture(t, true)
		turn(t, c, Control{Question: &Question{Text: "What is the staffing budget?", Essential: essential}})
		if essential {
			if c.State != Waiting || c.Pending == nil {
				t.Fatal("essential question did not block")
			}
			if _, _, ok := c.Begin(); ok {
				t.Fatal("called while waiting")
			}
			if err := c.Command("pause", "", nil); err != nil {
				t.Fatal(err)
			}
			if err := c.Command("resume", "", nil); err != nil {
				t.Fatal(err)
			}
			if c.State != Waiting {
				t.Fatal("resume bypassed question")
			}
			if err := c.Command("skip_question", "", nil); err != nil {
				t.Fatal(err)
			}
			if c.State != Running || c.Pending != nil {
				t.Fatal("skip did not unblock")
			}
		} else if c.State != Running || c.Pending != nil {
			t.Fatal("optional question blocked")
		}
	}
	c := fixture(t, false)
	req, aid, _ := c.Begin()
	if !strings.Contains(req.System, "Do not ask the human questions") {
		t.Fatal("question policy missing")
	}
	c.Finish(aid, Result{Text: "Question", Control: Control{Question: &Question{Text: "Budget?"}}}, nil)
	if c.State != Failed || c.Pending != nil {
		t.Fatal("disabled question accepted")
	}
	c = fixture(t, true)
	turn(t, c, Control{Question: &Question{Text: "Budget?", Essential: true}})
	off := false
	if err := c.Command("questions", "", &off); err != nil {
		t.Fatal(err)
	}
	if c.State != Running || c.Pending != nil {
		t.Fatal("disabling questions did not release pending question")
	}
}
func TestInterruptionFencesLateCompletion(t *testing.T) {
	c := fixture(t, true)
	_, aid, _ := c.Begin()
	c.Delta(aid, "aborted text")
	reserved := c.ChargedTokens
	if err := c.Command("message", "New constraint: budget is fixed.", nil); err != nil {
		t.Fatal(err)
	}
	if c.Finish(aid, Result{Text: "stale completion"}, nil) || c.Delta(aid, "stale delta") {
		t.Fatal("late result accepted")
	}
	if c.Messages[1].Status != "incomplete" || c.Attempts[0].Status != "interrupted" || c.ChargedTokens != reserved {
		t.Fatal("interruption not recorded or reservation lost")
	}
	req, _, ok := c.Begin()
	if !ok || !strings.Contains(req.Transcript, "budget is fixed") || strings.Contains(req.Transcript, "aborted text") {
		t.Fatal("incorrect next context")
	}
}
func TestPauseStopAndLimits(t *testing.T) {
	for _, action := range []string{"pause", "stop"} {
		c := fixture(t, true)
		_, aid, _ := c.Begin()
		if err := c.Command(action, "", nil); err != nil {
			t.Fatal(err)
		}
		if _, _, ok := c.Begin(); ok {
			t.Fatal("call after control")
		}
		if c.Finish(aid, Result{Text: "stale"}, nil) {
			t.Fatal("call completed after control")
		}
	}
	c := fixture(t, true)
	c.Limits.MaxTurns = 1
	turn(t, c, Control{})
	if _, _, ok := c.Begin(); ok || c.Reason != "turn_limit" {
		t.Fatal("turn cap failed")
	}
	c = fixture(t, true)
	c.Limits.MaxTokens = 10
	if _, _, ok := c.Begin(); ok || c.Reason != "token_limit" || len(c.Attempts) != 0 {
		t.Fatal("reservation cap failed")
	}
	c = fixture(t, true)
	_, aid, _ := c.Begin()
	reserve := c.ChargedTokens
	c.Finish(aid, Result{Text: "text", Usage: Usage{Known: true, Input: reserve + 1, Output: 1}}, nil)
	if c.State != Failed {
		t.Fatal("provider overrun hidden")
	}
}
func TestIdleRequiresCompleteRound(t *testing.T) {
	c := fixture(t, true)
	turn(t, c, Control{ReadyToPause: true, AddressedID: "a"})
	if c.State != Running {
		t.Fatal("idle before round complete")
	}
	turn(t, c, Control{ReadyToPause: true})
	turn(t, c, Control{ReadyToPause: true})
	if c.State != Ready || c.Reason != "idle" {
		t.Fatal("idle not detected")
	}
	if err := c.Command("start", "", nil); err != nil {
		t.Fatal(err)
	}
	turn(t, c, Control{ReadyToPause: false})
	turn(t, c, Control{ReadyToPause: true})
	turn(t, c, Control{ReadyToPause: true})
	if c.State != Running {
		t.Fatal("round with contribution went idle")
	}
}
func TestFailureRecoveryAndSummary(t *testing.T) {
	c := fixture(t, true)
	_, aid, _ := c.Begin()
	c.Delta(aid, "lost")
	c.Recover()
	if c.ActiveID != "" || c.Messages[1].Status != "incomplete" {
		t.Fatal("restart marked call successful")
	}
	_, aid, ok := c.Begin()
	if !ok {
		t.Fatal("recovery did not permit successor")
	}
	c.Finish(aid, Result{}, errors.New("provider unavailable"))
	if c.State != Failed || c.Attempts[1].Status != "failed" {
		t.Fatal("failure hidden")
	}
	if _, _, ok = c.Begin(); ok {
		t.Fatal("automatic substitution or retry")
	}
	c = fixture(t, true)
	if err := c.Command("pause", "", nil); err != nil {
		t.Fatal(err)
	}
	if err := c.Command("summary", "", nil); err != nil {
		t.Fatal(err)
	}
	r := turn(t, c, Control{})
	if !r.Summary || !strings.Contains(r.System, "Cite message IDs") || c.State != Paused {
		t.Fatal("summary did not return to paused")
	}
}
func TestInvalidControlsAndConfig(t *testing.T) {
	c := fixture(t, true)
	turn(t, c, Control{AddressedID: "unknown"})
	if c.State != Failed {
		t.Fatal("unknown participant accepted")
	}
	if _, err := New("topic", []Participant{{ID: "a", ProviderID: "x", Model: "m"}, {ID: "a", ProviderID: "x", Model: "m"}}, true, Limits{}); err == nil {
		t.Fatal("duplicate identities accepted")
	}
	if err := c.Command("message", " ", nil); err == nil {
		t.Fatal("blank input accepted")
	}
}

func TestStoppedSummaryCannotResumeDiscussion(t *testing.T) {
	c := fixture(t, true)
	if err := c.Command("stop", "", nil); err != nil {
		t.Fatal(err)
	}
	if err := c.Command("summary", "", nil); err != nil {
		t.Fatal(err)
	}
	turn(t, c, Control{})
	if c.State != Stopped {
		t.Fatal("summary revived stopped conversation")
	}
	if err := c.Command("resume", "", nil); err == nil {
		t.Fatal("stopped discussion resumed")
	}
}
