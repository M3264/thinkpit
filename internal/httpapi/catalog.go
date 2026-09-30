package httpapi

import (
	"context"
	"encoding/json"
	"github.com/M3264/thinkpit/internal/provider"
	"net/http"
	"time"
)

func (s *Server) catalog(w http.ResponseWriter, r *http.Request, config provider.Config) {
	// Include credentials in a server-keyed fingerprint, never in the saved catalog.
	settings, _ := json.Marshal(config)
	key := s.signature("catalog:" + string(settings) + ":" + config.APIKey)
	saved, at, err := s.Store.ModelCatalog(r.Context(), key)
	if failure(w, err) {
		return
	}
	respond := func(c provider.Catalog, at time.Time, stale bool, warning string) {
		write(w, 200, struct {
			provider.Catalog
			FetchedAt time.Time `json:"fetched_at"`
			Stale     bool      `json:"stale"`
			Warning   string    `json:"warning,omitempty"`
		}{c, at, stale, warning})
	}
	if !at.IsZero() && time.Since(at) < 24*time.Hour && r.URL.Query().Get("refresh") != "true" {
		respond(saved, at, false, "")
		return
	}
	adapter, err := provider.New(config)
	if failure(w, err) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	catalog, err := adapter.Models(ctx)
	if err != nil {
		if !at.IsZero() {
			respond(saved, at, true, "Provider unavailable. Showing saved models; refresh to try again.")
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	if failure(w, s.Store.SaveModelCatalog(r.Context(), key, catalog, now)) {
		return
	}
	respond(catalog, now, false, "")
}
