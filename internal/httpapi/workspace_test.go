package httpapi

import (
	"bytes"
	"encoding/json"
	"github.com/M3264/thinkpit/internal/conversation"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUploadAndPreparedContextCannotBeForged(t *testing.T) {
	server := &Server{Username: "admin", Password: "long-test-password"}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, _ := form.CreateFormFile("file", "notes.md")
	file.Write([]byte("A human-authored factual note."))
	form.Close()
	req := httptest.NewRequest("POST", "/api/attachments", &body)
	req.SetBasicAuth("admin", "long-test-password")
	req.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("upload failed", w.Body.String())
	}
	var prepared preparedEvidence
	if json.Unmarshal(w.Body.Bytes(), &prepared) != nil {
		t.Fatal("invalid preview")
	}
	out, err := server.resolve([]string{prepared.Token}, nil)
	if err != nil || len(out) != 1 || out[0].Name != "notes.md" || !strings.Contains(out[0].Text, "factual") {
		t.Fatal("prepared context lost")
	}
	out, err = server.resolve([]string{prepared.Token}, out)
	if err != nil || len(out) != 1 {
		t.Fatal("duplicate source repeated")
	}
	if _, err = server.resolve([]string{prepared.Token + "tampered"}, nil); err == nil {
		t.Fatal("forged provenance accepted")
	}
	foreign := (&Server{Password: "different-password"}).prepare(conversation.Evidence{ID: "fake", Text: "fake"})
	if _, err = server.resolve([]string{foreign.Token}, nil); err == nil {
		t.Fatal("foreign signature accepted")
	}
}
