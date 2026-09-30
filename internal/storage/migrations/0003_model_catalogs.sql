CREATE TABLE IF NOT EXISTS model_catalogs (
    cache_key TEXT PRIMARY KEY,
    catalog JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
