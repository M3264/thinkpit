CREATE TABLE IF NOT EXISTS conversations (
    id text PRIMARY KEY,
    document jsonb NOT NULL,
    state text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text,
    lease_until timestamptz
);
CREATE INDEX conversations_jobs ON conversations(state, lease_until);
CREATE TABLE IF NOT EXISTS events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    kind text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_replay ON events(conversation_id, id);
CREATE TABLE IF NOT EXISTS providers (
    id text PRIMARY KEY,
    settings jsonb NOT NULL,
    encrypted_key bytea NOT NULL
);
