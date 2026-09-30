package storage

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/M3264/thinkpit/internal/provider"
	"github.com/jackc/pgx/v5"
	"time"
)

func (s *Store) ModelCatalog(ctx context.Context, key string) (provider.Catalog, time.Time, error) {
	var raw []byte
	var at time.Time
	err := s.Pool.QueryRow(ctx, "SELECT catalog,fetched_at FROM model_catalogs WHERE cache_key=$1", key).Scan(&raw, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return provider.Catalog{}, at, nil
	}
	var catalog provider.Catalog
	if err == nil {
		err = json.Unmarshal(raw, &catalog)
	}
	return catalog, at, err
}
func (s *Store) SaveModelCatalog(ctx context.Context, key string, catalog provider.Catalog, at time.Time) error {
	raw, err := json.Marshal(catalog)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, "INSERT INTO model_catalogs(cache_key,catalog,fetched_at) VALUES($1,$2,$3) ON CONFLICT(cache_key) DO UPDATE SET catalog=$2,fetched_at=$3", key, raw, at)
	return err
}
