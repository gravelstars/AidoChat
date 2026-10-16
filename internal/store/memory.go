package store

import (
	"context"
	"database/sql"
	"fmt"

	"ai-group-chat/internal/domain"
)

const memoryColumns = `id,group_id,ref,kind,content,status,origin,proposed_by,confirmed_at,superseded_by,created_at,updated_at`

func scanMemory(row rowScanner) (domain.MemoryItem, error) {
	var m domain.MemoryItem
	var confirmed, when, updated storedTime
	err := row.Scan(&m.ID, &m.GroupID, &m.Ref, &m.Kind, &m.Content, &m.Status, &m.Origin, &m.ProposedBy, &confirmed, &m.SupersededBy, &when, &updated)
	m.ConfirmedAt = confirmed.ptr()
	m.CreatedAt = when.Time
	m.UpdatedAt = updated.Time
	m.Sources = []domain.MemorySource{}
	return m, err
}
func (s *Store) MemoryItems(ctx context.Context, groupID string) ([]domain.MemoryItem, error) {
	out := []domain.MemoryItem{}
	err := s.write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT `+memoryColumns+` FROM memory_items WHERE group_id=? ORDER BY ref`, groupID)
		if err != nil {
			return err
		}
		for rows.Next() {
			m, err := scanMemory(rows)
			if err != nil {
				rows.Close()
				return err
			}
			out = append(out, m)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for i := range out {
			sources, err := tx.QueryContext(ctx, `SELECT message_id,seq,role FROM memory_sources WHERE item_id=? ORDER BY seq,role`, out[i].ID)
			if err != nil {
				return err
			}
			for sources.Next() {
				var source domain.MemorySource
				if err := sources.Scan(&source.MessageID, &source.Seq, &source.Role); err != nil {
					sources.Close()
					return err
				}
				out[i].Sources = append(out[i].Sources, source)
			}
			err = sources.Err()
			sources.Close()
			if err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

// SaveMemoryItems 保存已由 memory.Apply 或用户操作校验的变更集；未出现在变更集中的条目保持不动。
// 记忆状态的权限规则属于 memory 包。这里额外检查真实来源，防止持久化时串群或写入伪编号。
// 调用者须在应用变更、读取最新游标和保存期间持有群级整理/用户操作锁（TASK-006）。
func (s *Store) SaveMemoryItems(ctx context.Context, groupID string, items []domain.MemoryItem, cursor int64) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var current, maxSeq int64
		if err := tx.QueryRowContext(ctx, `SELECT memory_cursor,(SELECT COALESCE(MAX(seq),0) FROM messages WHERE group_id=groups.id) FROM groups WHERE id=?`, groupID).Scan(&current, &maxSeq); err != nil {
			return err
		}
		if cursor < current || cursor > maxSeq {
			return fmt.Errorf("记忆游标不能后退或超过群消息范围")
		}
		seen := map[string]bool{}
		for _, item := range items {
			if item.GroupID != groupID {
				return fmt.Errorf("记忆条目不属于该群")
			}
			if item.ID == "" {
				item.ID = NewID()
			}
			if seen[item.ID] {
				return fmt.Errorf("记忆变更包含重复条目")
			}
			seen[item.ID] = true
			var existingGroup string
			var existingRef int
			err := tx.QueryRowContext(ctx, `SELECT group_id,ref FROM memory_items WHERE id=?`, item.ID).Scan(&existingGroup, &existingRef)
			switch {
			case err == nil:
				if existingGroup != groupID || item.Ref != existingRef {
					return fmt.Errorf("不能改变记忆的群或编号")
				}
			case err == sql.ErrNoRows:
				if item.Ref == 0 {
					if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(ref),0)+1 FROM memory_items WHERE group_id=?`, groupID).Scan(&item.Ref); err != nil {
						return err
					}
				}
			default:
				return err
			}
			if item.Ref <= 0 {
				return fmt.Errorf("记忆编号必须大于零")
			}
			if len(item.Sources) == 0 {
				return fmt.Errorf("记忆必须有真实来源")
			}
			item.CreatedAt = created(item.CreatedAt)
			item.UpdatedAt = created(item.UpdatedAt)
			_, err = tx.ExecContext(ctx, `INSERT INTO memory_items(`+memoryColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,content=excluded.content,status=excluded.status,origin=excluded.origin,proposed_by=excluded.proposed_by,confirmed_at=excluded.confirmed_at,superseded_by=excluded.superseded_by,updated_at=excluded.updated_at`,
				item.ID, groupID, item.Ref, item.Kind, item.Content, item.Status, item.Origin, item.ProposedBy, nullableTime(item.ConfirmedAt), item.SupersededBy, stamp(item.CreatedAt), stamp(item.UpdatedAt))
			if err != nil {
				return fmt.Errorf("保存记忆条目：%w", err)
			}
			if _, err = tx.ExecContext(ctx, `DELETE FROM memory_sources WHERE item_id=?`, item.ID); err != nil {
				return err
			}
			for _, source := range item.Sources {
				switch source.Role {
				case domain.SourceProposed, domain.SourceDiscussed, domain.SourceCompleted:
				default:
					return fmt.Errorf("无效的记忆来源角色")
				}
				var found int
				if err = tx.QueryRowContext(ctx, `SELECT 1 FROM messages WHERE id=? AND group_id=? AND seq=?`, source.MessageID, groupID, source.Seq).Scan(&found); err != nil {
					return fmt.Errorf("记忆来源不存在或不属于该群：%w", err)
				}
				// 同窗口的多次整理操作可能追加相同来源；校验真实消息后按来源身份去重。
				if _, err = tx.ExecContext(ctx, `INSERT INTO memory_sources(item_id,message_id,seq,role) VALUES(?,?,?,?) ON CONFLICT(item_id,message_id,role) DO NOTHING`, item.ID, source.MessageID, source.Seq, source.Role); err != nil {
					return err
				}
			}
		}
		return affected(tx.ExecContext(ctx, `UPDATE groups SET memory_cursor=? WHERE id=?`, cursor, groupID))
	})
}
func (s *Store) DeleteMemoryItem(ctx context.Context, id string) error {
	return affected(s.db.ExecContext(ctx, `DELETE FROM memory_items WHERE id=?`, id))
}

// MemoryItem 的按 ID 查询供用户盖章等本地操作使用。
func (s *Store) MemoryItem(ctx context.Context, id string) (domain.MemoryItem, error) {
	var groupID string
	if err := s.db.QueryRowContext(ctx, `SELECT group_id FROM memory_items WHERE id=?`, id).Scan(&groupID); err != nil {
		return domain.MemoryItem{}, err
	}
	items, err := s.MemoryItems(ctx, groupID)
	if err != nil {
		return domain.MemoryItem{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return domain.MemoryItem{}, sql.ErrNoRows
}
