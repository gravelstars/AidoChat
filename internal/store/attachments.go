package store

import (
	"ai-group-chat/internal/domain"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

func scanAttachment(row rowScanner) (domain.Attachment, error) {
	var a domain.Attachment
	var raw string
	if err := row.Scan(&raw); err != nil {
		return a, err
	}
	err := json.Unmarshal([]byte(raw), &a)
	return a, err
}
func (s *Store) SaveDraftAttachment(ctx context.Context, groupID string, a domain.Attachment) error {
	raw, err := json.Marshal(a)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO attachments(id,group_id,metadata) VALUES(?,?,?)`, a.ID, groupID, string(raw))
	return err
}
func (s *Store) Attachment(ctx context.Context, id string) (domain.Attachment, error) {
	return scanAttachment(s.db.QueryRowContext(ctx, `SELECT metadata FROM attachments WHERE id=?`, id))
}
func draftAttachments(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, group string, ids []string) ([]domain.Attachment, error) {
	if len(ids) > domain.MaxAttachments {
		return nil, errors.New("每条消息最多 4 份附件")
	}
	out := []domain.Attachment{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			return nil, errors.New("同一附件不能重复发送")
		}
		seen[id] = true
		a, err := scanAttachment(q.QueryRowContext(ctx, `SELECT metadata FROM attachments WHERE id=? AND group_id=? AND message_id IS NULL`, id, group))
		if err != nil {
			return nil, errors.New("附件不存在、已发送或属于其他群，请重新添加")
		}
		out = append(out, a)
	}
	return out, nil
}
func (s *Store) DraftAttachments(ctx context.Context, group string, ids []string) ([]domain.Attachment, error) {
	return draftAttachments(ctx, s.db, group, ids)
}
func (s *Store) RemoveDraftAttachment(ctx context.Context, id string) error {
	return affected(s.db.ExecContext(ctx, `DELETE FROM attachments WHERE id=? AND message_id IS NULL`, id))
}
func (s *Store) AttachmentIDs(ctx context.Context, group string, draftsOnly bool) ([]string, error) {
	query := `SELECT id FROM attachments WHERE 1=1`
	args := []any{}
	if group != "" {
		query += ` AND group_id=?`
		args = append(args, group)
	}
	if draftsOnly {
		query += ` AND message_id IS NULL`
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
