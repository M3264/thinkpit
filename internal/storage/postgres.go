package storage

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/M3264/thinkpit/internal/conversation"
	"github.com/M3264/thinkpit/internal/provider"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS
var ErrNotFound = errors.New("not found")
var ErrLease = errors.New("worker lease lost")

type Store struct {
	Pool *pgxpool.Pool
	aead cipher.AEAD
}

func Open(ctx context.Context, dsn string, key []byte) (*Store, error) {
	if len(key) != 32 {
		return nil, errors.New("deployment key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, errors.New("invalid database configuration")
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("database connection failed")
	}
	s := &Store{Pool: pool, aead: aead}
	if err = s.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database migration failed: %w", err)
	}
	return s, nil
}
func (s *Store) migrate(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(78746781)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	files, _ := migrations.ReadDir("migrations")
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	for _, f := range files {
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", f.Name()).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, _ := migrations.ReadFile("migrations/" + f.Name())
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", f.Name()); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) Create(ctx context.Context, c *conversation.Conversation) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	data, _ := json.Marshal(c)
	if _, err = tx.Exec(ctx, "INSERT INTO conversations(id,document,state) VALUES($1,$2,$3)", c.ID, data, c.State); err != nil {
		return err
	}
	if err = event(ctx, tx, c.ID, "created", c); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Get(ctx context.Context, id string) (*conversation.Conversation, error) {
	var data []byte
	var cursor int64
	err := s.Pool.QueryRow(ctx, "SELECT document,COALESCE((SELECT max(id) FROM events WHERE conversation_id=$1),0) FROM conversations WHERE id=$1", id).Scan(&data, &cursor)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var c conversation.Conversation
	err = json.Unmarshal(data, &c)
	c.LastEventID = cursor
	return &c, err
}
func (s *Store) List(ctx context.Context) ([]*conversation.Conversation, error) {
	rows, err := s.Pool.Query(ctx, "SELECT document FROM conversations ORDER BY updated_at DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*conversation.Conversation{}
	for rows.Next() {
		var data []byte
		var c conversation.Conversation
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &c); err != nil {
			return nil, err
		}
		out = append(out, &c)
	}
	return out, rows.Err()
}
func event(ctx context.Context, tx pgx.Tx, id, kind string, data any) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "INSERT INTO events(conversation_id,kind,data) VALUES($1,$2,$3)", id, kind, payload)
	return err
}

// Change serializes engine mutations with user actions. A lease fences late workers.
func (s *Store) Change(ctx context.Context, id, owner, kind string, fn func(*conversation.Conversation) (any, error)) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var data []byte
	var valid bool
	err = tx.QueryRow(ctx, "SELECT document, ($2='' OR (lease_owner=$2 AND lease_until>now())) FROM conversations WHERE id=$1 FOR UPDATE", id, owner).Scan(&data, &valid)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !valid {
		return ErrLease
	}
	var c conversation.Conversation
	if err = json.Unmarshal(data, &c); err != nil {
		return err
	}
	payload, err := fn(&c)
	if err != nil {
		return err
	}
	data, err = json.Marshal(c)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE conversations SET document=$2,state=$3,updated_at=now() WHERE id=$1", id, data, c.State); err != nil {
		return err
	}
	if payload != nil {
		if err = event(ctx, tx, id, kind, payload); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) Claim(ctx context.Context, owner string) (*conversation.Conversation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var data []byte
	err = tx.QueryRow(ctx, "SELECT document FROM conversations WHERE state='running' AND (document->>'retry_at' IS NULL OR (document->>'retry_at')::timestamptz<=now()) AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1").Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var c conversation.Conversation
	if err = json.Unmarshal(data, &c); err != nil {
		return nil, err
	}
	if c.ActiveID != "" || (c.Brainstorm != nil && c.Brainstorm.PendingID != "") {
		c.Recover()
		if err = event(ctx, tx, c.ID, "recovered", &c); err != nil {
			return nil, err
		}
	}
	data, _ = json.Marshal(c)
	if _, err = tx.Exec(ctx, "UPDATE conversations SET document=$2,lease_owner=$3,lease_until=now()+interval '30 seconds' WHERE id=$1", c.ID, data, owner); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &c, nil
}
func (s *Store) Renew(ctx context.Context, id, owner string) error {
	tag, err := s.Pool.Exec(ctx, "UPDATE conversations SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND lease_owner=$2 AND lease_until>now()", id, owner)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrLease
	}
	return err
}
func (s *Store) Release(ctx context.Context, id, owner string) error {
	_, err := s.Pool.Exec(ctx, "UPDATE conversations SET lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2", id, owner)
	return err
}
func (s *Store) Events(ctx context.Context, id string, after int64) ([]conversation.Event, error) {
	rows, err := s.Pool.Query(ctx, "SELECT id,kind,data FROM events WHERE conversation_id=$1 AND id>$2 ORDER BY id LIMIT 200", id, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []conversation.Event{}
	for rows.Next() {
		e := conversation.Event{ConversationID: id}
		var b []byte
		if err = rows.Scan(&e.ID, &e.Kind, &b); err != nil {
			return nil, err
		}
		e.Data = json.RawMessage(b)
		out = append(out, e)
	}
	return out, rows.Err()
}
func (s *Store) Delete(ctx context.Context, id string) error {
	tag, err := s.Pool.Exec(ctx, "DELETE FROM conversations WHERE id=$1", id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
func (s *Store) SaveProvider(ctx context.Context, p provider.Config) error {
	if err := provider.Validate(p); err != nil {
		return err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	sealed := s.aead.Seal(nonce, nonce, []byte(p.APIKey), []byte(p.ID))
	p.HasKey = p.APIKey != ""
	data, _ := json.Marshal(p)
	_, err := s.Pool.Exec(ctx, "INSERT INTO providers(id,settings,encrypted_key) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET settings=$2,encrypted_key=$3", p.ID, data, sealed)
	return err
}
func (s *Store) Providers(ctx context.Context) ([]provider.Config, error) {
	rows, err := s.Pool.Query(ctx, "SELECT settings FROM providers ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []provider.Config{}
	for rows.Next() {
		var data []byte
		var p provider.Config
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) Provider(ctx context.Context, id string) (provider.Config, error) {
	var p provider.Config
	var data, sealed []byte
	err := s.Pool.QueryRow(ctx, "SELECT settings,encrypted_key FROM providers WHERE id=$1", id).Scan(&data, &sealed)
	if err != nil {
		return p, errors.New("provider unavailable")
	}
	if err = json.Unmarshal(data, &p); err != nil {
		return p, err
	}
	if len(sealed) < s.aead.NonceSize() {
		return p, errors.New("invalid encrypted provider key")
	}
	plain, err := s.aead.Open(nil, sealed[:s.aead.NonceSize()], sealed[s.aead.NonceSize():], []byte(id))
	if err != nil {
		return p, errors.New("provider key could not be decrypted")
	}
	p.APIKey = string(plain)
	return p, nil
}
