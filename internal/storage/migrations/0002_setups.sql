CREATE TABLE setups (
 id text PRIMARY KEY,
 document jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
