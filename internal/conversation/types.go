package conversation

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

type State string

const (
	Ready   State = "ready"
	Running State = "running"
	Waiting State = "waiting_for_user"
	Paused  State = "paused"
	Stopped State = "stopped"
	Failed  State = "failed"
)

type Participant struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ProviderID   string `json:"provider_id"`
	Model        string `json:"model"`
	Instructions string `json:"instructions,omitempty"`
}
type Limits struct {
	MaxTurns        int `json:"max_turns"`
	MaxTokens       int `json:"max_tokens"`
	MaxOutputTokens int `json:"max_output_tokens"`
}
type Usage struct {
	Input  int  `json:"input_tokens"`
	Output int  `json:"output_tokens"`
	Known  bool `json:"known"`
}
type Question struct {
	Text      string `json:"text"`
	Essential bool   `json:"essential"`
	MessageID string `json:"message_id,omitempty"`
}
type Control struct {
	AddressedID  string    `json:"addressed_id"`
	Question     *Question `json:"question"`
	ReadyToPause bool      `json:"ready_to_pause"`
}
type Message struct {
	ID         string    `json:"id"`
	SpeakerID  string    `json:"speaker_id"`
	Content    string    `json:"content"`
	Status     string    `json:"status"`
	ReplyTo    string    `json:"reply_to,omitempty"`
	ProviderID string    `json:"provider_id,omitempty"`
	Model      string    `json:"model,omitempty"`
	Control    *Control  `json:"control,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}
type Attempt struct {
	ID             string `json:"id"`
	MessageID      string `json:"message_id"`
	ParticipantID  string `json:"participant_id"`
	Status         string `json:"status"`
	ReservedTokens int    `json:"reserved_tokens"`
	Usage          Usage  `json:"usage"`
	Error          string `json:"error,omitempty"`
}
type Conversation struct {
	ID                 string          `json:"id"`
	Topic              string          `json:"topic"`
	State              State           `json:"state"`
	Reason             string          `json:"reason,omitempty"`
	Participants       []Participant   `json:"participants"`
	AskQuestions       bool            `json:"ask_questions"`
	Limits             Limits          `json:"limits"`
	Messages           []Message       `json:"messages"`
	Attempts           []Attempt       `json:"attempts"`
	Pending            *Question       `json:"pending_question,omitempty"`
	Next               int             `json:"next"`
	RoundSeen          map[string]bool `json:"round_seen"`
	RoundReady         map[string]bool `json:"round_ready"`
	ChargedTokens      int             `json:"charged_tokens"`
	ActiveID           string          `json:"active_attempt_id,omitempty"`
	SummaryRequested   bool            `json:"summary_requested"`
	SummaryReturnState State           `json:"summary_return_state,omitempty"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}
type Event struct {
	ID             int64  `json:"id"`
	ConversationID string `json:"conversation_id"`
	Kind           string `json:"kind"`
	Data           any    `json:"data"`
}
type Request struct {
	Participant     Participant `json:"participant"`
	System          string      `json:"system"`
	Transcript      string      `json:"transcript"`
	MaxOutputTokens int         `json:"max_output_tokens"`
	Summary         bool        `json:"summary"`
}
type Result struct {
	Text    string
	Control Control
	Usage   Usage
}

func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
