package store

import (
	"ai-group-chat/internal/domain"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func TestRetiredProviderCannotBeListedOrReactivated(t *testing.T) {
	s := openTest(t)
	p := domain.Provider{ID: "p", Name: "服务", Kind: "openai"}
	must(t, s.SaveProvider(ctx, &p))
	m := domain.Member{ID: "m", Name: "成员", ProviderID: "p", Model: "test"}
	must(t, s.SaveMember(ctx, &m))
	if err := s.DeleteProvider(ctx, p.ID); err == nil {
		t.Fatal("活跃成员应阻止下线")
	}
	must(t, s.DeleteMember(ctx, m.ID))
	must(t, s.DeleteProvider(ctx, p.ID))
	ps, err := s.Providers(ctx)
	must(t, err)
	if len(ps) != 0 {
		t.Fatal("下线服务仍出现在列表")
	}
	if _, err = s.Provider(ctx, p.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("下线服务仍能读取：%v", err)
	}
	if err = s.SaveProvider(ctx, &p); err == nil {
		t.Fatal("旧表单不应重新激活下线服务")
	}
	m.ID = "new"
	m.Name = "新成员"
	if err = s.SaveMember(ctx, &m); err == nil {
		t.Fatal("下线服务仍能被新成员引用")
	}
	var violations int
	must(t, s.db.QueryRow(`SELECT count(*) FROM pragma_foreign_key_check`).Scan(&violations))
	if violations != 0 {
		t.Fatal("历史引用外键损坏")
	}
	reopened, err := Open(s.Path())
	must(t, err)
	defer reopened.Close()
	ps, err = reopened.Providers(ctx)
	must(t, err)
	if len(ps) != 0 {
		t.Fatal("重启后服务重新出现")
	}
}

func TestProviderRetirementMigrationPreservesExistingData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", databaseURI(path))
	must(t, err)
	for _, n := range []string{"001_init.sql", "002_reply_mode.sql"} {
		raw, err := migrations.ReadFile("migrations/" + n)
		must(t, err)
		_, err = db.Exec(string(raw))
		must(t, err)
	}
	_, err = db.Exec(`INSERT INTO providers VALUES('p','旧服务','openai','http://localhost','','2026-10-17T00:00:00.000Z'); PRAGMA user_version=2;`)
	must(t, err)
	must(t, db.Close())
	s, err := Open(path)
	must(t, err)
	defer s.Close()
	p, err := s.Provider(ctx, "p")
	must(t, err)
	if p.Name != "旧服务" {
		t.Fatal("升级损失旧服务")
	}
	must(t, s.DeleteProvider(ctx, p.ID))
}
