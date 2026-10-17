package app

import (
	"ai-group-chat/internal/store"
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestUserProfileLegacyAndValidation(t *testing.T) {
	s, _ := fixture(t, nil)
	ctx := context.Background()
	b, err := s.Bootstrap(ctx)
	if err != nil || b.UserDisplayName != "你" {
		t.Fatalf("legacy defaults: %+v %v", b, err)
	}
	p := UserProfile{DisplayName: " Sam Altman ", Seal: UserSeal{"SA", "baiwen"}}
	if err = s.SetUserProfile(ctx, p); err != nil {
		t.Fatal(err)
	}
	b, err = s.Bootstrap(ctx)
	if err != nil || b.UserDisplayName != "Sam Altman" || b.UserSeal.Text != "SA" {
		t.Fatalf("saved: %+v %v", b, err)
	}
	for _, name := range []string{"", strings.Repeat("𠮷", 41), "a\nb", "a\tb", "a\x00b"} {
		p.DisplayName = name
		if err = s.SetUserProfile(ctx, p); err == nil {
			t.Fatalf("accepted name %q", name)
		}
	}
	p.DisplayName = strings.Repeat("𠮷", 40)
	if err = s.SetUserProfile(ctx, p); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"", "ABCDE", "S A", "S\nA"} {
		p.Seal.Text = text
		if err = s.SetUserProfile(ctx, p); err == nil {
			t.Fatalf("accepted seal %q", text)
		}
	}
}

func TestUserProfileAtomicFailureAndReopen(t *testing.T) {
	s, db := fixture(t, nil)
	ctx := context.Background()
	if err := s.SetUserProfile(ctx, UserProfile{"旧名字", UserSeal{"旧", "zhuwen"}}); err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", db.Path())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	_, err = raw.Exec(`CREATE TRIGGER fail_profile BEFORE UPDATE ON settings WHEN NEW.key='ui.user_seal' BEGIN SELECT RAISE(ABORT,'profile rejected'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SetUserProfile(ctx, UserProfile{"新名字", UserSeal{"新", "baiwen"}}); err == nil {
		t.Fatal("save unexpectedly succeeded")
	}
	b, err := s.Bootstrap(ctx)
	if err != nil || b.UserDisplayName != "旧名字" || b.UserSeal.Text != "旧" {
		t.Fatalf("partial profile: %+v %v", b, err)
	}
	reopened, err := store.Open(db.Path())
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	s2 := NewService(reopened, nil, "mac", nil)
	b, err = s2.Bootstrap(ctx)
	if err != nil || b.UserDisplayName != "旧名字" {
		t.Fatalf("restart: %+v %v", b, err)
	}
}
