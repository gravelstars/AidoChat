package store

import (
	"database/sql"
	"errors"
	"testing"

	"ai-group-chat/internal/domain"
)

func TestSetSettingsRollsBackAllValues(t *testing.T) {
	s := openTest(t)
	must(t, s.SetSettings(ctx, map[string]string{"first": `"old-first"`, "second": `"old-second"`}))
	_, err := s.db.Exec(`CREATE TRIGGER fail_second_setting BEFORE UPDATE ON settings WHEN NEW.key='second' BEGIN SELECT RAISE(ABORT,'simulated settings failure'); END`)
	must(t, err)
	if err = s.SetSettings(ctx, map[string]string{"first": `"new-first"`, "second": `"new-second"`}); err == nil {
		t.Fatal("expected write failure")
	}
	for key, want := range map[string]string{"first": `"old-first"`, "second": `"old-second"`} {
		got, err := s.Setting(ctx, key)
		must(t, err)
		if got != want {
			t.Fatalf("%s partially committed: %s", key, got)
		}
	}
	if err = s.SetSettings(ctx, map[string]string{"third": `"valid"`, "bad": "invalid-json"}); err == nil {
		t.Fatal("invalid JSON accepted")
	}
	if _, err = s.Setting(ctx, "third"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("invalid batch left a value: %v", err)
	}
}

func TestDeleteProviderAndMemoryConfigOnlyClearsMatchingProvider(t *testing.T) {
	s := openTest(t)
	for _, id := range []string{"active", "other"} {
		p := domain.Provider{ID: id, Name: id, Kind: "openai"}
		must(t, s.SaveProvider(ctx, &p))
	}
	must(t, s.SetSettings(ctx, map[string]string{"memory.provider_id": `"active"`, "memory.model": `"model"`, "ui.user_seal": `{"text":"我"}`}))
	must(t, s.DeleteProviderAndMemoryConfig(ctx, "other"))
	raw, err := s.Setting(ctx, "memory.provider_id")
	must(t, err)
	if raw != `"active"` {
		t.Fatal("unrelated provider deletion cleared configured service")
	}
	must(t, s.DeleteProviderAndMemoryConfig(ctx, "active"))
	for _, key := range []string{"memory.provider_id", "memory.model"} {
		raw, err = s.Setting(ctx, key)
		must(t, err)
		if raw != `""` {
			t.Fatalf("%s not cleared: %s", key, raw)
		}
	}
	raw, err = s.Setting(ctx, "ui.user_seal")
	must(t, err)
	if raw != `{"text":"我"}` {
		t.Fatal("unrelated setting changed")
	}
	if err = s.DeleteProviderAndMemoryConfig(ctx, "active"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing provider: %v", err)
	}
}
