// Package store 将领域实体保存在本机 SQLite 中。业务校验仍由领域与服务层负责。
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store 的方法可并发调用；事务不向调用者暴露，避免单连接池被嵌套调用耗尽。
type Store struct {
	db   *sql.DB
	path string
}

func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("获取应用数据目录：%w", err)
	}
	return filepath.Join(dir, "ai-group-chat", "data.db"), nil
}
func OpenDefault() (*Store, error) {
	path, err := DefaultPath()
	if err != nil {
		return nil, err
	}
	return Open(path)
}
func NewID() string           { return ulid.Make().String() }
func (s *Store) Path() string { return s.path }
func (s *Store) Close() error { return s.db.Close() }

// Open 接受明确的文件路径，测试可使用临时目录，不会碰用户数据。
func Open(path string) (*Store, error) {
	if path == "" {
		return nil, fmt.Errorf("数据库路径不能为空")
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("解析数据库路径：%w", err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, fmt.Errorf("创建数据库目录：%w", err)
	}
	db, err := sql.Open("sqlite", databaseURI(filepath.ToSlash(path)))
	if err != nil {
		return nil, fmt.Errorf("打开数据库：%w", err)
	}
	// 单进程内串行使用连接；立即事务确保其他连接也不能同时读取并分配同一个 seq。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s := &Store{db: db, path: path}
	ctx := context.Background()
	if err = s.migrate(ctx); err == nil {
		_, err = db.ExecContext(ctx, `UPDATE messages SET status='stopped', finished_at=? WHERE status IN ('pending','streaming')`, stamp(time.Now()))
	}
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("初始化数据库：%w", err)
	}
	return s, nil
}

func databaseURI(path string) string {
	// Windows 盘符必须属于 URI 路径，否则 file://C:/ 会被当作远程主机。
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	u := url.URL{Scheme: "file", Path: path}
	q := url.Values{"_pragma": {"busy_timeout(5000)", "foreign_keys(1)", "journal_mode(WAL)"}, "_txlock": {"immediate"}}
	u.RawQuery = q.Encode()
	return u.String()
}

func (s *Store) migrate(ctx context.Context) error {
	files, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	return s.write(ctx, func(tx *sql.Tx) error {
		var version int
		if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
			return err
		}
		if version > len(files) {
			return fmt.Errorf("数据库版本 %d 高于应用支持的版本 %d，请升级应用", version, len(files))
		}
		for i, file := range files {
			n, err := strconv.Atoi(strings.SplitN(file.Name(), "_", 2)[0])
			if err != nil || n != i+1 {
				return fmt.Errorf("数据库迁移编号不连续：%s", file.Name())
			}
			if n <= version {
				continue
			}
			body, err := migrations.ReadFile("migrations/" + file.Name())
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, string(body)); err != nil {
				return fmt.Errorf("迁移 %s：%w", file.Name(), err)
			}
			if _, err = tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", n)); err != nil {
				return err
			}
		}
		return nil
	})
}
func (s *Store) write(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func affected(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
func nullableTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return stamp(*t)
}
func created(t time.Time) time.Time {
	if t.IsZero() {
		return time.Now().UTC().Truncate(time.Millisecond)
	}
	return t.UTC().Truncate(time.Millisecond)
}

type rowScanner interface{ Scan(...any) error }
type storedTime struct {
	time.Time
	valid bool
}

func (t *storedTime) Scan(v any) error {
	if v == nil {
		t.Time = time.Time{}
		t.valid = false
		return nil
	}
	s, ok := v.(string)
	if !ok {
		return fmt.Errorf("无效的数据库时间类型 %T", v)
	}
	parsed, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return fmt.Errorf("读取数据库时间：%w", err)
	}
	t.Time = parsed
	t.valid = true
	return nil
}
func (t storedTime) ptr() *time.Time {
	if !t.valid {
		return nil
	}
	return &t.Time
}
