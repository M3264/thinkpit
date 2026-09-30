package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCatalogMetadataAndUnknownPricing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer secret-test-key" {
			t.Error("catalog request did not use saved provider identity")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[{"id":"paid","name":"Paid","pricing":{"prompt":"0.1","completion":"0.2"}},{"id":"free","name":"Free","reasoning":{"default_enabled":true},"context_length":32000,"pricing":{"prompt":"0","completion":"0"},"architecture":{"input_modalities":["text","image"],"output_modalities":["text"]},"supported_parameters":["tools","reasoning"]},{"id":"unknown"},{"id":"image","architecture":{"output_modalities":["image"]}}]}`))
	}))
	defer server.Close()
	a, _ := New(Config{ID: "test", Kind: "openai_compat", BaseURL: server.URL + "/v1", APIKey: "secret-test-key"})
	out, err := a.Models(context.Background())
	if err != nil || len(out.Models) != 3 {
		t.Fatalf("catalog: %v %+v", err, out)
	}
	for _, m := range out.Models {
		switch m.ID {
		case "free":
			if m.Free == nil || !*m.Free || m.Context != 32000 || len(m.Capabilities) != 3 {
				t.Fatal("free model metadata lost")
			}
		case "paid":
			if m.Free == nil || *m.Free {
				t.Fatal("paid model misclassified")
			}
		case "unknown":
			if m.Free != nil {
				t.Fatal("unknown pricing invented")
			}
		}
	}
}
func TestAnthropicPaginationAndSafeFailures(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("x-api-key") != "secret-test-key" || r.Header.Get("anthropic-version") == "" {
			t.Error("native catalog headers absent")
		}
		if r.URL.Query().Get("after_id") == "" {
			w.Write([]byte(`{"data":[{"id":"a","display_name":"First","max_input_tokens":100000,"capabilities":{"thinking":{"supported":true}}}],"has_more":true,"last_id":"a"}`))
		} else {
			w.Write([]byte(`{"data":[{"id":"b","display_name":"Second"}],"has_more":false}`))
		}
	}))
	defer server.Close()
	a, _ := New(Config{ID: "test", Kind: "anthropic", BaseURL: server.URL, APIKey: "secret-test-key"})
	out, err := a.Models(context.Background())
	if err != nil || calls != 2 || len(out.Models) != 2 || out.Models[0].Context != 100000 {
		t.Fatal("pagination or metadata failed", err)
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret-test-key", 401) }))
	defer bad.Close()
	a.Config.BaseURL = bad.URL
	_, err = a.Models(context.Background())
	if err == nil || strings.Contains(err.Error(), "secret-test-key") {
		t.Fatal("failure exposed key")
	}
}
func TestCatalogRejectsReflectedCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":[{"id":"x","description":"secret-test-key"}]}`))
	}))
	defer server.Close()
	a, _ := New(Config{ID: "test", Kind: "openai_compat", BaseURL: server.URL, APIKey: "secret-test-key"})
	if _, err := a.Models(context.Background()); err == nil {
		t.Fatal("reflected credential accepted")
	}
}

func TestRequestFeePreventsFreeClassification(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":[{"id":"fee","pricing":{"prompt":"0","completion":"0","request":"0.01"}}]}`))
	}))
	defer server.Close()
	a, _ := New(Config{ID: "test", Kind: "openai_compat", BaseURL: server.URL})
	out, err := a.Models(context.Background())
	if err != nil || len(out.Models) != 1 || out.Models[0].Free == nil || *out.Models[0].Free {
		t.Fatal("request fee classified free", err)
	}
}
