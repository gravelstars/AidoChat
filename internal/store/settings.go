package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

func (s *Store) Setting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, key).Scan(&value)
	return value, err
}
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	return s.SetSettings(ctx, map[string]string{key: value})
}

// SetSettings 将关联设置一起提交，避免失败后留下服务与模型不匹配的半份配置。
func (s *Store) SetSettings(ctx context.Context, values map[string]string) error {
	return s.write(ctx, func(tx *sql.Tx) error { return setSettings(ctx, tx, values) })
}
func setSettings(ctx context.Context, tx *sql.Tx, values map[string]string) error {
	for key, value := range values {
		if key == "" || !json.Valid([]byte(value)) {
			return fmt.Errorf("设置项需要非空名称和有效的 JSON 值")
		}
	}
	for key, value := range values {
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			return err
		}
	}
	return nil
}

// DeleteProviderAndMemoryConfig 保证删除服务与解除对应纪要配置一起成功或一起回滚。
func (s *Store) DeleteProviderAndMemoryConfig(ctx context.Context, id string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := affected(tx.ExecContext(ctx, `UPDATE providers SET deleted_at=?,key_ref='' WHERE id=? AND deleted_at IS NULL`, stamp(time.Now()), id)); err != nil {
			return err
		}
		var raw string
		err := tx.QueryRowContext(ctx, `SELECT value FROM settings WHERE key='memory.provider_id'`).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		var configured string
		if json.Unmarshal([]byte(raw), &configured) != nil || configured != id {
			return nil
		}
		return setSettings(ctx, tx, map[string]string{"memory.provider_id": `""`, "memory.model": `""`})
	})
}

func (s *Store) DeleteSetting(ctx context.Context, key string) error {
	return affected(s.db.ExecContext(ctx, `DELETE FROM settings WHERE key=?`, key))
}
