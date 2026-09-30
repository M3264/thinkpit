package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/evidence"
	"github.com/M3264/thinkpit/internal/storage"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

type preparedEvidence struct {
	Evidence conversation.Evidence `json:"evidence"`
	Token    string                `json:"token"`
}

func (s *Server) prepare(e conversation.Evidence) preparedEvidence {
	payload, _ := json.Marshal(struct {
		Evidence conversation.Evidence `json:"evidence"`
		Expires  int64                 `json:"expires"`
	}{e, time.Now().Add(24 * time.Hour).Unix()})
	value := base64.RawURLEncoding.EncodeToString(payload)
	return preparedEvidence{e, value + "." + s.signature("evidence:"+value)}
}
func (s *Server) resolve(tokens []string, existing []conversation.Evidence) ([]conversation.Evidence, error) {
	out := append([]conversation.Evidence{}, existing...)
	seen := map[string]bool{}
	total := 0
	for _, e := range out {
		seen[e.ID] = true
		total += len(e.Text)
	}
	for _, token := range tokens {
		parts := strings.Split(token, ".")
		if len(parts) != 2 || !hmac.Equal([]byte(parts[1]), []byte(s.signature("evidence:"+parts[0]))) {
			return nil, errors.New("invalid context token")
		}
		raw, err := base64.RawURLEncoding.DecodeString(parts[0])
		if err != nil {
			return nil, err
		}
		var v struct {
			Evidence conversation.Evidence `json:"evidence"`
			Expires  int64                 `json:"expires"`
		}
		if json.Unmarshal(raw, &v) != nil || v.Expires < time.Now().Unix() {
			return nil, errors.New("context expired; upload or fetch again")
		}
		if seen[v.Evidence.ID] {
			continue
		}
		seen[v.Evidence.ID] = true
		out = append(out, v.Evidence)
		total += len(v.Evidence.Text)
	}
	if len(out) > 20 || total > 96000 {
		return nil, errors.New("context limit reached: 20 items and 96 KB extracted text")
	}
	return out, nil
}
func (s *Server) workspace(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/setups", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.Store.Setups(r.Context())
		if !failure(w, err) {
			write(w, 200, v)
		}
	})
	mux.HandleFunc("PUT /api/setups/{id}", func(w http.ResponseWriter, r *http.Request) {
		var v storage.Setup
		if !decode(w, r, &v) {
			return
		}
		v.ID = r.PathValue("id")
		if v.ID == "" || len(v.ID) > 128 || strings.TrimSpace(v.Name) == "" || len(v.Name) > 128 {
			http.Error(w, "setup name is required", 400)
			return
		}
		c, err := conversation.New("Saved setup", v.Participants, v.AskQuestions, v.Limits)
		if err != nil {
			http.Error(w, "invalid setup participants or limits", 400)
			return
		}
		v.Participants = c.Participants
		v.Limits = c.Limits
		if !failure(w, s.Store.SaveSetup(r.Context(), v)) {
			write(w, 200, v)
		}
	})
	mux.HandleFunc("DELETE /api/setups/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !failure(w, s.Store.DeleteSetup(r.Context(), r.PathValue("id"))) {
			w.WriteHeader(204)
		}
	})
	mux.HandleFunc("POST /api/search", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Query string `json:"query"`
		}
		if !decode(w, r, &v) {
			return
		}
		if strings.TrimSpace(v.Query) == "" || len(v.Query) > 500 {
			http.Error(w, "enter a search query up to 500 characters", 400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		results, err := evidence.Search(ctx, os.Getenv("THINKPIT_SEARCH_URL"), v.Query)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		write(w, 200, results)
	})
	mux.HandleFunc("POST /api/sources", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			URL string `json:"url"`
		}
		if !decode(w, r, &v) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		source, err := evidence.Fetch(ctx, v.URL)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		write(w, 200, s.prepare(source))
	})
	mux.HandleFunc("POST /api/attachments", s.upload)
}

type textWriter struct {
	data      []byte
	truncated bool
}

func (w *textWriter) Write(p []byte) (int, error) {
	n := len(p)
	remaining := 16000 - len(w.data)
	if len(p) > remaining {
		w.truncated = true
		p = p[:remaining]
	}
	w.data = append(w.data, p...)
	return n, nil
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2*1024*1024+64*1024)
	if err := r.ParseMultipartForm(2 * 1024 * 1024); err != nil {
		http.Error(w, "file exceeds the 2 MB upload limit", 400)
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "choose a file", 400)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 2*1024*1024+1))
	if err != nil || len(data) > 2*1024*1024 {
		http.Error(w, "file exceeds the 2 MB upload limit", 400)
		return
	}
	name := filepath.Base(header.Filename)
	if len(name) > 256 {
		name = name[:256]
	}
	out := conversation.Evidence{ID: conversation.ID(), Kind: "file", Name: name}
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".pdf" {
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			http.Error(w, "invalid PDF file", 400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "pdftotext", "-layout", "-", "-")
		cmd.Stdin = bytes.NewReader(data)
		writer := &textWriter{}
		cmd.Stdout = writer
		cmd.Stderr = io.Discard
		if cmd.Run() != nil {
			http.Error(w, "PDF text could not be extracted; scanned PDFs need OCR first", 400)
			return
		}
		out.Text = strings.ToValidUTF8(string(writer.data), "")
		out.Truncated = writer.truncated
	} else {
		switch ext {
		case ".txt", ".md", ".csv", ".json", ".log", ".tsv":
		default:
			http.Error(w, "use a text, Markdown, CSV, JSON, TSV, log, or text-based PDF file", 400)
			return
		}
		if !utf8.Valid(data) || bytes.Contains(data, []byte{0}) {
			http.Error(w, "file must contain UTF-8 text", 400)
			return
		}
		if len(data) > 16000 {
			data = data[:16000]
			out.Truncated = true
		}
		out.Text = strings.ToValidUTF8(string(data), "")
	}
	out.Text = strings.TrimSpace(out.Text)
	if out.Text == "" {
		http.Error(w, "file contains no readable text; scanned PDFs need OCR first", 400)
		return
	}
	write(w, 200, s.prepare(out))
}
