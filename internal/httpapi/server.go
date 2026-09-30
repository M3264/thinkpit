package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/provider"
	"github.com/M3264/thinkpit/internal/storage"
)

type Server struct {
	Store    *storage.Store
	Username string
	Password string
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if err := s.Store.Pool.Ping(ctx); err != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		write(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/providers", func(w http.ResponseWriter, r *http.Request) {
		p, err := s.Store.Providers(r.Context())
		if failure(w, err) {
			return
		}
		write(w, 200, p)
	})
	mux.HandleFunc("PUT /api/providers/{id}", s.saveProvider)
	mux.HandleFunc("GET /api/conversations", func(w http.ResponseWriter, r *http.Request) {
		cs, err := s.Store.List(r.Context())
		if failure(w, err) {
			return
		}
		write(w, 200, cs)
	})
	mux.HandleFunc("POST /api/conversations", s.create)
	mux.HandleFunc("GET /api/conversations/{id}", func(w http.ResponseWriter, r *http.Request) {
		c, err := s.Store.Get(r.Context(), r.PathValue("id"))
		if failure(w, err) {
			return
		}
		write(w, 200, c)
	})
	mux.HandleFunc("DELETE /api/conversations/{id}", func(w http.ResponseWriter, r *http.Request) {
		if failure(w, s.Store.Delete(r.Context(), r.PathValue("id"))) {
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("POST /api/conversations/{id}/controls", s.control)
	mux.HandleFunc("GET /api/conversations/{id}/events", s.events)
	mux.HandleFunc("GET /api/conversations/{id}/export", func(w http.ResponseWriter, r *http.Request) {
		c, err := s.Store.Get(r.Context(), r.PathValue("id"))
		if failure(w, err) {
			return
		}
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=thinkpit.md")
		fmt.Fprint(w, c.Markdown())
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.URL.Path != "/healthz" {
			user, pass, ok := r.BasicAuth()
			want := sha256.Sum256([]byte(s.Password))
			got := sha256.Sum256([]byte(pass))
			uWant := sha256.Sum256([]byte(s.Username))
			uGot := sha256.Sum256([]byte(user))
			if !ok || subtle.ConstantTimeCompare(want[:], got[:]) != 1 || subtle.ConstantTimeCompare(uWant[:], uGot[:]) != 1 {
				w.Header().Set("WWW-Authenticate", `Basic realm="ThinkPit", charset="UTF-8"`)
				http.Error(w, "authentication required", 401)
				return
			}
			// Reject cross-origin browser mutations, including requests with ambient Basic credentials.
			if r.Method != "GET" && r.Method != "HEAD" {
				if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
					http.Error(w, "cross-origin request rejected", 403)
					return
				}
				if origin := r.Header.Get("Origin"); origin != "" {
					expected := "http://" + r.Host
					if r.TLS != nil {
						expected = "https://" + r.Host
					}
					if origin != expected {
						http.Error(w, "cross-origin request rejected", 403)
						return
					}
				}
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "application/json required", 415)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(v) != nil {
		http.Error(w, "invalid JSON request", 400)
		return false
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		http.Error(w, "one JSON object required", 400)
		return false
	}
	return true
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, storage.ErrNotFound):
		http.Error(w, "not found", 404)
	case errors.Is(err, conversation.ErrInvalid):
		http.Error(w, "invalid operation", 409)
	default:
		http.Error(w, "operation failed", 500)
	}
	return true
}
func (s *Server) saveProvider(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string `json:"name"`
		Kind         string `json:"kind"`
		BaseURL      string `json:"base_url"`
		EndpointPath string `json:"endpoint_path,omitempty"`
		APIKey       string `json:"api_key"`
	}
	if !decode(w, r, &body) {
		return
	}
	p := provider.Config{ID: r.PathValue("id"), Name: body.Name, Kind: body.Kind, BaseURL: body.BaseURL, EndpointPath: body.EndpointPath, APIKey: body.APIKey, HasKey: body.APIKey != ""}
	if err := provider.Validate(p); err != nil {
		http.Error(w, "invalid provider settings", 400)
		return
	}
	if failure(w, s.Store.SaveProvider(r.Context(), p)) {
		return
	}
	write(w, 200, p)
}
func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Topic        string                     `json:"topic"`
		Participants []conversation.Participant `json:"participants"`
		AskQuestions *bool                      `json:"ask_questions"`
		Limits       conversation.Limits        `json:"limits"`
	}
	if !decode(w, r, &body) {
		return
	}
	ask := true
	if body.AskQuestions != nil {
		ask = *body.AskQuestions
	}
	c, err := conversation.New(body.Topic, body.Participants, ask, body.Limits)
	if err != nil {
		http.Error(w, "invalid conversation settings", 400)
		return
	}
	for _, p := range c.Participants {
		if _, err = s.Store.Provider(r.Context(), p.ProviderID); err != nil {
			http.Error(w, "participant provider unavailable", 400)
			return
		}
	}
	if failure(w, s.Store.Create(r.Context(), c)) {
		return
	}
	write(w, 201, c)
}
func (s *Server) control(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action       string `json:"action"`
		Text         string `json:"text"`
		AskQuestions *bool  `json:"ask_questions"`
	}
	if !decode(w, r, &body) {
		return
	}
	var out *conversation.Conversation
	err := s.Store.Change(r.Context(), r.PathValue("id"), "", "control", func(c *conversation.Conversation) (any, error) {
		if err := c.Command(body.Action, body.Text, body.AskQuestions); err != nil {
			return nil, err
		}
		out = c
		return c, nil
	})
	if failure(w, err) {
		return
	}
	write(w, 200, out)
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.Get(r.Context(), id); failure(w, err) {
		return
	}
	after := int64(0)
	if last := r.Header.Get("Last-Event-ID"); last != "" {
		n, err := strconv.ParseInt(last, 10, 64)
		if err != nil || n < 0 {
			http.Error(w, "invalid event ID", 400)
			return
		}
		after = n
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	for {
		events, err := s.Store.Events(r.Context(), id, after)
		if err != nil {
			return
		}
		_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
		for _, e := range events {
			data, _ := json.Marshal(e.Data)
			if _, err = fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", e.ID, e.Kind, data); err != nil {
				return
			}
			after = e.ID
		}
		if rc.Flush() != nil {
			return
		}
		if len(events) == 200 {
			continue
		}
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		case <-heartbeat.C:
			if _, err = fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
		}
	}
}
