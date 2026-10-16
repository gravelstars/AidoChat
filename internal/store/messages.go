package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"ai-group-chat/internal/domain"
)

const messageColumns = `id,group_id,seq,author_kind,author_id,content,mentions,mention_all,reply_to_id,turn_id,provider,model,context_seq,status,error,created_at,finished_at,reply_mode`

func scanMessage(row rowScanner) (domain.Message, error) {
	var m domain.Message
	var mentions string
	var when, finished storedTime
	if err := row.Scan(&m.ID, &m.GroupID, &m.Seq, &m.AuthorKind, &m.AuthorID, &m.Content, &mentions, &m.MentionAll, &m.ReplyToID, &m.TurnID, &m.Provider, &m.Model, &m.ContextSeq, &m.Status, &m.Error, &when, &finished, &m.ReplyMode); err != nil {
		return m, err
	}
	if err := json.Unmarshal([]byte(mentions), &m.Mentions); err != nil {
		return m, fmt.Errorf("读取消息提及：%w", err)
	}
	m.CreatedAt = when.Time
	m.FinishedAt = finished.ptr()
	return m, nil
}
func (s *Store) Message(ctx context.Context, id string) (domain.Message, error) {
	return scanMessage(s.db.QueryRowContext(ctx, `SELECT `+messageColumns+` FROM messages WHERE id=?`, id))
}
func (s *Store) RecentMessages(ctx context.Context, groupID string, limit int) ([]domain.Message, error) {
	if limit <= 0 {
		return []domain.Message{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+messageColumns+` FROM (SELECT `+messageColumns+` FROM messages WHERE group_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq`, groupID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Message{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// VisibleMessagesAfter 读取游标后的最早可见记录，整理器不能以最近 N 条代替尚未处理的窗口。
func (s *Store) VisibleMessagesAfter(ctx context.Context, groupID string, cursor int64, limit int) ([]domain.Message, error) {
	if limit <= 0 {
		return []domain.Message{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+messageColumns+` FROM messages WHERE group_id=? AND seq>? AND (status='done' OR (status='stopped' AND content<>'')) ORDER BY seq LIMIT ?`, groupID, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Message{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) InsertMessage(ctx context.Context, m *domain.Message) error {
	next := *m
	if next.ID == "" {
		next.ID = NewID()
	}
	next.CreatedAt = created(next.CreatedAt)
	// 只有用户消息的 ReplyMode 有意义；成员回复归一到 serial，保证列值始终合法。
	if next.ReplyMode == "" {
		next.ReplyMode = domain.ModeSerial
	}
	mentions := next.Mentions
	if mentions == nil {
		mentions = []string{}
	}
	encoded, err := json.Marshal(mentions)
	if err != nil {
		return err
	}
	err = s.write(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE group_id=?`, next.GroupID).Scan(&next.Seq); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO messages(`+messageColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, next.ID, next.GroupID, next.Seq, next.AuthorKind, next.AuthorID, next.Content, string(encoded), next.MentionAll, next.ReplyToID, next.TurnID, next.Provider, next.Model, next.ContextSeq, next.Status, next.Error, stamp(next.CreatedAt), nullableTime(next.FinishedAt), next.ReplyMode)
		if err != nil {
			return err
		}
		return affected(tx.ExecContext(ctx, `UPDATE groups SET updated_at=MAX(updated_at,?) WHERE id=?`, stamp(next.CreatedAt), next.GroupID))
	})
	if err != nil {
		return fmt.Errorf("保存消息：%w", err)
	}
	*m = next
	return nil
}

// UpdateMessage 不改变消息编号、作者和触发关系，只保存生成结果及实际模型快照。
func (s *Store) UpdateMessage(ctx context.Context, m domain.Message) error {
	return affected(s.db.ExecContext(ctx, `UPDATE messages SET content=?,provider=?,model=?,context_seq=?,status=?,error=?,finished_at=? WHERE id=? AND group_id=? AND seq=?`, m.Content, m.Provider, m.Model, m.ContextSeq, m.Status, m.Error, nullableTime(m.FinishedAt), m.ID, m.GroupID, m.Seq))
}
