package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"ai-group-chat/internal/domain"
)

func TestRetiredMembersDoNotPreventProviderRemoval(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g := domain.Group{ID: "g", Title: "历史群", MemberIDs: []string{"a", "b"}}
	if err := db.CreateGroup(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteMember(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteProvider(ctx, "p"); err == nil || !strings.Contains(err.Error(), "墨白") || strings.Contains(err.Error(), "青砚") {
		t.Fatalf("应只报告仍在用的成员：%v", err)
	}
	if err := s.DeleteMember(ctx, "b"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMemoryConfig(ctx, MemoryConfig{ProviderID: "p", Model: "test"}); err != nil {
		t.Fatal(err)
	}
	m := domain.Message{ID: "historic", GroupID: "g", AuthorKind: domain.AuthorMember, AuthorID: "a", Content: "保留的历史发言", Status: domain.StatusDone}
	if err := db.InsertMessage(ctx, &m); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteProvider(ctx, "p"); err != nil {
		t.Fatalf("已删除成员不应阻止下线：%v", err)
	}
	if _, err := db.Provider(ctx, "p"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("下线服务仍可调用：%v", err)
	}
	b, err := s.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Providers) != 0 || b.Memory.ProviderID != "" || b.Memory.Model != "" {
		t.Fatalf("下线配置未清理：%+v", b)
	}
	old, err := db.Member(ctx, "a")
	if err != nil || old.Name != "青砚" || old.Avatar.Glyph != "青" {
		t.Fatalf("历史身份丢失：%+v %v", old, err)
	}
	got, err := db.Message(ctx, m.ID)
	if err != nil || got.Content != m.Content {
		t.Fatalf("历史消息丢失：%+v %v", got, err)
	}
}

func TestRetiredMemberProviderRemovalDeletesCredential(t *testing.T) {
	s, _ := fixture(t, nil)
	ctx := context.Background()
	ring := &fakeCredentials{keys: map[string]string{}}
	s.credentials = ring
	p, err := s.SaveProvider(ctx, SaveProviderInput{Name: "云服务", Kind: "openai", BaseURL: "https://example.invalid", Key: "test-only"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.SaveMember(ctx, SaveMemberInput{Name: "旧成员", ProviderID: p.ID, Model: "test", Avatar: Avatar{Glyph: "旧", Color: "dai"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteMember(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteProvider(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, exists := ring.keys[p.ID]; exists {
		t.Fatal("下线后凭证仍保留")
	}
}
