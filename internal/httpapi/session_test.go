package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSessionLoginAndStaticAssets(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<main>ThinkPit</main>"), 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{Username: "admin", Password: "long-test-password", StaticDir: dir}
	handler := server.Handler()
	request := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	w := request("GET", "/", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "ThinkPit") {
		t.Fatal("public app shell missing")
	}
	w = request("GET", "/api/session", "", nil)
	if w.Code != 401 || w.Header().Get("WWW-Authenticate") != "" {
		t.Fatal("browser login triggered basic prompt")
	}
	w = request("POST", "/api/login", `{"username":"admin","password":"incorrect"}`, nil)
	if w.Code != 401 {
		t.Fatal("invalid login accepted")
	}
	w = request("POST", "/api/login", `{"username":"admin","password":"long-test-password"}`, nil)
	if w.Code != 200 {
		t.Fatal("login failed")
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe session cookie")
	}
	cookie := cookies[0]
	w = request("GET", "/api/session", "", cookie)
	if w.Code != 200 {
		t.Fatal("session not accepted")
	}
	cookie.Value += "tampered"
	w = request("GET", "/api/session", "", cookie)
	if w.Code != 401 {
		t.Fatal("tampered session accepted")
	}
	w = request("GET", "/assets/missing.js", "", nil)
	if w.Code != 404 {
		t.Fatal("missing asset received app shell")
	}
	req := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"admin","password":"long-test-password"}`))
	req.Header.Set("Origin", "https://untrusted.example")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("cross-origin login accepted")
	}
}
