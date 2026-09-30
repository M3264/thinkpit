package storage

import (
	"context"
	"encoding/json"
	"github.com/M3264/thinkpit/internal/conversation"
)

type Setup struct {
	ID           string                     `json:"id"`
	Name         string                     `json:"name"`
	Participants []conversation.Participant `json:"participants"`
	Limits       conversation.Limits        `json:"limits"`
	AskQuestions bool                       `json:"ask_questions"`
}

func (s *Store) Setups(ctx context.Context) ([]Setup, error) {
	rows, err := s.Pool.Query(ctx, "SELECT document FROM setups ORDER BY updated_at DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Setup{}
	for rows.Next() {
		var data []byte
		var v Setup
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) SaveSetup(ctx context.Context, v Setup) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, "INSERT INTO setups(id,document) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document,updated_at=now()", v.ID, data)
	return err
}
func (s *Store) DeleteSetup(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, "DELETE FROM setups WHERE id=$1", id)
	return err
}
