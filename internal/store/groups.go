package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"ai-group-chat/internal/domain"
)

// CreateGroup 在一个事务内保存群及有序成员。新群游标从零开始。
func (s *Store) CreateGroup(ctx context.Context, g *domain.Group) error {
	next := *g
	if next.ID == "" {
		next.ID = NewID()
	}
	next.CreatedAt = created(next.CreatedAt)
	next.MemoryCursor = 0
	if next.DefaultMode == "" {
		next.DefaultMode = domain.ModeSerial
	}
	err := s.write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO groups(id,title,topic,default_mode,memory_cursor,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?)`, next.ID, next.Title, next.Topic, next.DefaultMode, 0, stamp(next.CreatedAt), stamp(next.CreatedAt), nullableTime(next.ArchivedAt))
		if err != nil {
			return err
		}
		return saveMemberships(ctx, tx, next)
	})
	if err != nil {
		return fmt.Errorf("创建群：%w", err)
	}
	*g = next
	return nil
}
func saveMemberships(ctx context.Context, tx *sql.Tx, g domain.Group) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_members WHERE group_id=?`, g.ID); err != nil {
		return err
	}
	seen := map[string]bool{}
	for position, id := range g.MemberIDs {
		if seen[id] {
			return fmt.Errorf("群成员不能重复")
		}
		seen[id] = true
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT 1 FROM members WHERE id=? AND deleted_at IS NULL`, id).Scan(&exists); err != nil {
			return fmt.Errorf("群成员不存在或已删除：%w", err)
		}
		var glyph, color, image any
		if avatar, ok := g.MemberAvatars[id]; ok {
			glyph, color, image = avatar.Glyph, avatar.Color, avatar.Image
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO group_members(group_id,member_id,position,joined_at,avatar_glyph,avatar_color,avatar_image) VALUES(?,?,?,?,?,?,?)`, g.ID, id, position, stamp(time.Now()), glyph, color, image); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) UpdateGroup(ctx context.Context, g domain.Group) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		// 游标由记忆事务维护，不能被一份旧的群资料覆盖。
		if err := affected(tx.ExecContext(ctx, `UPDATE groups SET title=?,topic=?,default_mode=?,archived_at=?,updated_at=? WHERE id=?`, g.Title, g.Topic, g.DefaultMode, nullableTime(g.ArchivedAt), stamp(time.Now()), g.ID)); err != nil {
			return err
		}
		return saveMemberships(ctx, tx, g)
	})
}
func (s *Store) Group(ctx context.Context, id string) (domain.Group, error) {
	var g domain.Group
	// 同一读事务保证群资料、成员顺序和头像覆盖来自同一版本。
	err := s.write(ctx, func(tx *sql.Tx) error {
		var when, archived storedTime
		if err := tx.QueryRowContext(ctx, `SELECT id,title,topic,default_mode,memory_cursor,created_at,archived_at FROM groups WHERE id=?`, id).Scan(&g.ID, &g.Title, &g.Topic, &g.DefaultMode, &g.MemoryCursor, &when, &archived); err != nil {
			return err
		}
		g.CreatedAt = when.Time
		g.ArchivedAt = archived.ptr()
		g.MemberIDs = []string{}
		g.MemberAvatars = map[string]domain.Avatar{}
		rows, err := tx.QueryContext(ctx, `SELECT member_id,avatar_glyph,avatar_color,avatar_image FROM group_members WHERE group_id=? ORDER BY position`, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var memberID string
			var glyph, color, image sql.NullString
			if err := rows.Scan(&memberID, &glyph, &color, &image); err != nil {
				return err
			}
			g.MemberIDs = append(g.MemberIDs, memberID)
			if glyph.Valid || color.Valid || image.Valid {
				g.MemberAvatars[memberID] = domain.Avatar{Glyph: glyph.String, Color: color.String, Image: image.String}
			}
		}
		return rows.Err()
	})
	return g, err
}

// Groups 返回所有群（包括归档群），服务层按用途筛选。
func (s *Store) Groups(ctx context.Context) ([]domain.Group, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM groups ORDER BY updated_at DESC,id`)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []domain.Group{}
	for _, id := range ids {
		g, err := s.Group(ctx, id)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}
func (s *Store) DeleteGroup(ctx context.Context, id string) error {
	return affected(s.db.ExecContext(ctx, `DELETE FROM groups WHERE id=?`, id))
}
func (s *Store) SetGroupAvatar(ctx context.Context, groupID, memberID string, a *domain.Avatar) error {
	var glyph, color, image any
	if a != nil {
		glyph, color, image = a.Glyph, a.Color, a.Image
	}
	return affected(s.db.ExecContext(ctx, `UPDATE group_members SET avatar_glyph=?,avatar_color=?,avatar_image=? WHERE group_id=? AND member_id=?`, glyph, color, image, groupID, memberID))
}

// ArchiveGroup 只影响群列表可见性，不删除任何讨论数据。
func (s *Store) ArchiveGroup(ctx context.Context, id string, at *time.Time) error {
	return affected(s.db.ExecContext(ctx, `UPDATE groups SET archived_at=? WHERE id=?`, nullableTime(at), id))
}
