package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/httpapi"
	"github.com/M3264/thinkpit/internal/provider"
	"github.com/M3264/thinkpit/internal/storage"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(os.Args) > 1 && os.Args[1] == "run" {
		return headless(ctx, os.Args[2:])
	}
	if len(os.Args) > 1 && os.Args[1] != "serve" {
		return errors.New("usage: thinkpit serve | thinkpit run -config config.json -out transcript.json")
	}
	keyPath := os.Getenv("THINKPIT_KEY_FILE")
	keyText, err := os.ReadFile(keyPath)
	if err != nil {
		return errors.New("THINKPIT_KEY_FILE must point to a deployment key file")
	}
	key, err := hex.DecodeString(strings.TrimSpace(string(keyText)))
	if err != nil || len(key) != 32 {
		return errors.New("deployment key must contain 64 hex characters")
	}
	password := os.Getenv("THINKPIT_PASSWORD")
	if len(password) < 16 {
		return errors.New("THINKPIT_PASSWORD must be at least 16 characters")
	}
	username := os.Getenv("THINKPIT_USERNAME")
	if username == "" {
		username = "admin"
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL required")
	}
	s, err := storage.Open(ctx, dsn, key)
	if err != nil {
		return err
	}
	defer s.Pool.Close()
	addr := os.Getenv("THINKPIT_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	api := &httpapi.Server{Store: s, Username: username, Password: password}
	server := &http.Server{Addr: addr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	workerResult := make(chan error, 1)
	go func() { workerResult <- httpapi.Work(ctx, s) }()
	serveResult := make(chan error, 1)
	go func() { log.Printf("ThinkPit backend listening on %s", addr); serveResult <- server.ListenAndServe() }()
	workerExited := false
	select {
	case <-ctx.Done():
	case err = <-workerResult:
		workerExited = true
		stop()
		if err != nil {
			err = errors.New("conversation worker stopped")
		}
	case err = <-serveResult:
		stop()
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	stop()
	if !workerExited {
		select {
		case <-workerResult:
		case <-shutdown.Done():
		}
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

type runnerConfig struct {
	Topic        string                     `json:"topic"`
	AskQuestions bool                       `json:"ask_questions"`
	Limits       conversation.Limits        `json:"limits"`
	Participants []conversation.Participant `json:"participants"`
	Providers    []struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Kind         string `json:"kind"`
		BaseURL      string `json:"base_url"`
		EndpointPath string `json:"endpoint_path,omitempty"`
		KeyEnv       string `json:"key_env"`
	} `json:"providers"`
}

func headless(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	configPath := flags.String("config", "", "runner config JSON")
	out := flags.String("out", "data/transcript.json", "transcript JSON path")
	resume := flags.String("resume", "", "saved transcript path")
	action := flags.String("action", "", "apply a saved conversation control before running")
	text := flags.String("text", "", "human message for -action message")
	ask := flags.Bool("questions", true, "question toggle for -action questions")
	if err := flags.Parse(args); err != nil {
		return err
	}
	data, err := os.ReadFile(*configPath)
	if err != nil {
		return errors.New("could not read runner config")
	}
	var config runnerConfig
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if dec.Decode(&config) != nil {
		return errors.New("invalid runner config")
	}
	providers := map[string]*provider.Adapter{}
	for _, p := range config.Providers {
		key := ""
		if p.KeyEnv != "" {
			key = os.Getenv(p.KeyEnv)
			if key == "" {
				return fmt.Errorf("provider %s needs environment variable %s", p.ID, p.KeyEnv)
			}
		}
		a, err := provider.New(provider.Config{ID: p.ID, Name: p.Name, Kind: p.Kind, BaseURL: p.BaseURL, EndpointPath: p.EndpointPath, APIKey: key})
		if err != nil {
			return err
		}
		providers[p.ID] = a
	}
	var c *conversation.Conversation
	if *resume != "" {
		saved, err := os.ReadFile(*resume)
		if err != nil {
			return errors.New("could not read saved transcript")
		}
		if json.Unmarshal(saved, &c) != nil || c == nil {
			return errors.New("invalid saved transcript")
		}
		if len(c.Participants) == 0 || c.Next < 0 || c.Next >= len(c.Participants) || c.Limits.MaxTurns < 1 || c.Limits.MaxTokens < 1 {
			return errors.New("invalid saved conversation settings")
		}
		c.Recover()
		if *action != "" {
			if err = c.Command(*action, *text, ask); err != nil {
				return err
			}
		}
		if *action == "" && (c.State == conversation.Ready || c.State == conversation.Paused) {
			if err = c.Command("resume", "", nil); err != nil {
				return err
			}
		}
	} else {
		c, err = conversation.New(config.Topic, config.Participants, config.AskQuestions, config.Limits)
		if err != nil {
			return err
		}
		if err = c.Command("start", "", nil); err != nil {
			return err
		}
	}
	for _, p := range c.Participants {
		if providers[p.ProviderID] == nil {
			return errors.New("participant references unconfigured provider")
		}
	}
	persist := func() error {
		b, err := json.MarshalIndent(c, "", "  ")
		if err != nil {
			return err
		}
		if err = atomicFile(*out, b); err != nil {
			return err
		}
		return atomicFile(strings.TrimSuffix(*out, filepath.Ext(*out))+".md", []byte(c.Markdown()))
	}
	if err = persist(); err != nil {
		return err
	}
	for c.State == conversation.Running {
		req, aid, ok := c.Begin()
		if err = persist(); err != nil {
			return err
		}
		if !ok {
			break
		}
		fmt.Printf("\n%s (%s):\n", req.Participant.Name, req.Participant.Model)
		result, callErr := providers[req.Participant.ProviderID].Stream(ctx, req, func(text string) error { c.Delta(aid, text); fmt.Print(text); return persist() })
		c.Finish(aid, result, callErr)
		if err = persist(); err != nil {
			return err
		}
	}
	fmt.Printf("\n\nState: %s (%s). Transcript: %s\n", c.State, c.Reason, *out)
	if c.State == conversation.Failed {
		return errors.New("conversation failed; see attempt status in transcript")
	}
	return nil
}
func atomicFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".thinkpit-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
