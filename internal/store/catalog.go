package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"ai-group-chat/internal/domain"
)

const providerColumns = `id,name,kind,base_url,key_ref`

func scanProvider(row rowScanner) (domain.Provider, error) {
	var p domain.Provider
	err := row.Scan(&p.ID, &p.Name, &p.Kind, &p.BaseURL, &p.KeyRef)
	return p, err
}
func (s *Store) Provider(ctx context.Context, id string) (domain.Provider, error) {
	return scanProvider(s.db.QueryRowContext(ctx, `SELECT `+providerColumns+` FROM providers WHERE id=? AND deleted_at IS NULL`, id))
}
func (s *Store) Providers(ctx context.Context) ([]domain.Provider, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+providerColumns+` FROM providers WHERE deleted_at IS NULL ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Provider{}
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) SaveProvider(ctx context.Context, p *domain.Provider) error {
	next := *p
	if next.ID == "" {
		next.ID = NewID()
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO providers(id,name,kind,base_url,key_ref,created_at) VALUES(?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,base_url=excluded.base_url,key_ref=excluded.key_ref WHERE providers.deleted_at IS NULL`, next.ID, next.Name, next.Kind, next.BaseURL, next.KeyRef, stamp(time.Now()))
	if err = affected(result, err); err != nil {
		return fmt.Errorf("保存模型服务：%w", err)
	}
	*p = next
	return nil
}
func (s *Store) DeleteProvider(ctx context.Context, id string) error {
	return affected(s.db.ExecContext(ctx, `UPDATE providers SET deleted_at=?,key_ref='' WHERE id=? AND deleted_at IS NULL`, stamp(time.Now()), id))
}

const memberColumns = `id,name,avatar_glyph,avatar_color,avatar_image,brief,role_prompt,provider_id,model,temperature,context_tokens,created_at`

func scanMember(row rowScanner) (domain.Member, error) {
	var m domain.Member
	var when storedTime
	var temperature sql.NullFloat64
	err := row.Scan(&m.ID, &m.Name, &m.Avatar.Glyph, &m.Avatar.Color, &m.Avatar.Image, &m.Brief, &m.RolePrompt, &m.ProviderID, &m.Model, &temperature, &m.ContextTokens, &when)
	m.CreatedAt = when.Time
	if temperature.Valid {
		m.Temperature = &temperature.Float64
	}
	return m, err
}
func (s *Store) Member(ctx context.Context, id string) (domain.Member, error) {
	return scanMember(s.db.QueryRowContext(ctx, `SELECT `+memberColumns+` FROM members WHERE id=?`, id))
}
func (s *Store) Members(ctx context.Context, ids []string) (map[string]domain.Member, error) {
	out := map[string]domain.Member{}
	for _, id := range ids {
		if _, ok := out[id]; ok {
			continue
		}
		m, err := s.Member(ctx, id)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		out[id] = m
	}
	return out, nil
}

// MembersUsingProvider 返回使用该服务的活跃成员名字；历史身份不再阻止服务下线。
func (s *Store) MembersUsingProvider(ctx context.Context, providerID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name FROM members WHERE provider_id=? AND deleted_at IS NULL ORDER BY created_at,id`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func (s *Store) ListMembers(ctx context.Context) ([]domain.Member, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+memberColumns+` FROM members WHERE deleted_at IS NULL ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Member{}
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (s *Store) SaveMember(ctx context.Context, m *domain.Member) error {
	if utf8.RuneCountInString(m.Name) < 1 || utf8.RuneCountInString(m.Name) > 12 || strings.ContainsFunc(m.Name, func(r rune) bool { return unicode.IsSpace(r) || r == '@' }) {
		return fmt.Errorf("成员名字须为 1–12 字，不能有空格或 @")
	}
	next := *m
	if next.ID == "" {
		next.ID = NewID()
	}
	next.CreatedAt = created(next.CreatedAt)
	result, err := s.db.ExecContext(ctx, `INSERT INTO members(`+memberColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar_glyph=excluded.avatar_glyph,avatar_color=excluded.avatar_color,avatar_image=excluded.avatar_image,brief=excluded.brief,role_prompt=excluded.role_prompt,provider_id=excluded.provider_id,model=excluded.model,temperature=excluded.temperature,context_tokens=excluded.context_tokens WHERE members.deleted_at IS NULL`,
		next.ID, next.Name, next.Avatar.Glyph, next.Avatar.Color, next.Avatar.Image, next.Brief, next.RolePrompt, next.ProviderID, next.Model, next.Temperature, next.ContextTokens, stamp(next.CreatedAt))
	if err = affected(result, err); err != nil {
		return fmt.Errorf("保存成员：%w", err)
	}
	*m = next
	return nil
}

// DeleteMember 只做持久化；系统通知和进行中轮次的检查由服务层安排。
func (s *Store) DeleteMember(ctx context.Context, id string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := affected(tx.ExecContext(ctx, `UPDATE members SET deleted_at=? WHERE id=? AND deleted_at IS NULL`, stamp(time.Now()), id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM group_members WHERE member_id=?`, id)
		return err
	})
}

// SetMemberAvatar 修改默认头像，不影响群内覆盖，也不改变成员的其他资料。
func (s *Store) SetMemberAvatar(ctx context.Context, id string, a domain.Avatar) error {
	return affected(s.db.ExecContext(ctx, `UPDATE members SET avatar_glyph=?,avatar_color=?,avatar_image=? WHERE id=? AND deleted_at IS NULL`, a.Glyph, a.Color, a.Image, id))
}
