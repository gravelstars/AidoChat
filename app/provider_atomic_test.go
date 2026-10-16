package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/llm/providers"
	"ai-group-chat/internal/store"
)

func failMemoryModelUpdates(t *testing.T, db *store.Store) {
	t.Helper()
	raw, err := sql.Open("sqlite", db.Path())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if _, err = raw.Exec(`CREATE TRIGGER fail_memory_model BEFORE UPDATE ON settings WHEN NEW.key='memory.model' BEGIN SELECT RAISE(ABORT,'simulated settings write failure'); END`); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryConfigFailurePreservesBothFields(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	other := domain.Provider{ID: "other", Name: "other", Kind: "openai", BaseURL: "https://other.invalid"}
	if err := db.SaveProvider(ctx, &other); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMemoryConfig(ctx, MemoryConfig{ProviderID: "p", Model: "old-model"}); err != nil {
		t.Fatal(err)
	}
	failMemoryModelUpdates(t, db)
	if err := s.SetMemoryConfig(ctx, MemoryConfig{ProviderID: "other", Model: "new-model"}); err == nil {
		t.Fatal("expected write failure")
	}
	pid, _ := s.settingString(ctx, "memory.provider_id")
	model, _ := s.settingString(ctx, "memory.model")
	if pid != "p" || model != "old-model" {
		t.Fatalf("failed operation changed config pair: provider=%q model=%q", pid, model)
	}
}

func TestDeleteProviderCredentialFailurePreservesRetryableConfig(t *testing.T) {
	s, db := fixture(t, nil)
	ctx := context.Background()
	ring := &fakeCredentials{keys: map[string]string{}}
	s.credentials = ring
	cfg, err := s.SaveProvider(ctx, SaveProviderInput{Name: "service", Kind: "openai", BaseURL: "https://example.invalid", Key: "initial"})
	if err != nil {
		t.Fatal(err)
	}
	ring.deleteErr = errors.New("keyring locked")
	if err = s.DeleteProvider(ctx, cfg.ID); err == nil {
		t.Fatal("credential deletion failure was ignored")
	}
	if _, err = db.Provider(ctx, cfg.ID); err != nil {
		t.Fatal("failed deletion removed retryable provider")
	}
	if ring.keys[cfg.ID] != "initial" {
		t.Fatal("failed deletion changed key")
	}
	ring.deleteErr = nil
	if err = s.DeleteProvider(ctx, cfg.ID); err != nil {
		t.Fatal(err)
	}
	if ring.keys[cfg.ID] != "" {
		t.Fatal("retry did not remove key")
	}
}

func TestDeleteProviderAndMemoryConfigRollbackTogether(t *testing.T) {
	s, db := fixture(t, nil)
	ctx := context.Background()
	ring := &fakeCredentials{keys: map[string]string{}}
	s.credentials = ring
	cfg, err := s.SaveProvider(ctx, SaveProviderInput{Name: "service", Kind: "openai", BaseURL: "https://example.invalid", Key: "initial"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SetMemoryConfig(ctx, MemoryConfig{ProviderID: cfg.ID, Model: "old-model"}); err != nil {
		t.Fatal(err)
	}
	failMemoryModelUpdates(t, db)
	if err = s.DeleteProvider(ctx, cfg.ID); err == nil {
		t.Fatal("settings failure was ignored")
	}
	if _, err = db.Provider(ctx, cfg.ID); err != nil {
		t.Fatal("provider deletion was not rolled back")
	}
	if ring.keys[cfg.ID] != "initial" {
		t.Fatal("original key was not restored")
	}
	pid, _ := s.settingString(ctx, "memory.provider_id")
	model, _ := s.settingString(ctx, "memory.model")
	if pid != cfg.ID || model != "old-model" {
		t.Fatal("memory settings were not rolled back")
	}
}

func TestDeleteKeylessProviderDoesNotUseKeyring(t *testing.T) {
	s, _ := fixture(t, nil)
	ctx := context.Background()
	ring := &fakeCredentials{keys: map[string]string{}}
	s.credentials = ring
	cfg, err := s.SaveProvider(ctx, SaveProviderInput{Name: "local", Kind: "openai", BaseURL: "http://localhost:11434/v1"})
	if err != nil {
		t.Fatal(err)
	}
	ring.getErr = errors.New("keyring unavailable")
	ring.deleteErr = ring.getErr
	if err = s.DeleteProvider(ctx, cfg.ID); err != nil {
		t.Fatal(err)
	}
	if ring.reads != 0 || ring.deletes != 0 {
		t.Fatalf("keyless provider accessed keyring: reads=%d deletes=%d", ring.reads, ring.deletes)
	}
}

func TestSaveMemberSharesProviderDeletionBoundary(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	s.providersMu.Lock()
	result := make(chan error, 1)
	go func() {
		_, err := s.SaveMember(ctx, SaveMemberInput{Name: "新成员", ProviderID: "p", Model: "m", Avatar: Avatar{Glyph: "新", Color: "dai"}})
		result <- err
	}()
	var early bool
	select {
	case <-result:
		early = true
	case <-time.After(30 * time.Millisecond):
	}
	s.providersMu.Unlock()
	if !early {
		if err := <-result; err != nil {
			t.Fatal(err)
		}
	}
	if early {
		t.Fatal("member save bypassed provider deletion boundary")
	}
}

func TestProviderFactoryRefreshesAddressAndKeyAsOneSnapshot(t *testing.T) {
	for _, source := range []string{"turn", "memory"} {
		t.Run(source, func(t *testing.T) {
			ctx := context.Background()
			db, err := store.Open(filepath.Join(t.TempDir(), "data.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			ring := &fakeCredentials{keys: map[string]string{}}
			s := NewService(db, providers.New(ring.Get), "mac", nil)
			s.credentials = ring
			defer CloseService(s)
			reached := make(chan string, 2)
			endpoint := func(name string) *httptest.Server {
				return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Header.Get("Authorization") != "Bearer replacement" {
						t.Error("wrong credential used")
					}
					reached <- name
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n")
				}))
			}
			old := endpoint("old")
			defer old.Close()
			fresh := endpoint("new")
			defer fresh.Close()
			cfg, err := s.SaveProvider(ctx, SaveProviderInput{Name: "old", Kind: "openai", BaseURL: old.URL, Key: "initial"})
			if err != nil {
				t.Fatal(err)
			}
			stale, err := db.Provider(ctx, cfg.ID)
			if err != nil {
				t.Fatal(err)
			}
			wrote := make(chan struct{})
			allow := make(chan struct{})
			ring.onSet = func() { close(wrote); <-allow }
			saved := make(chan error, 1)
			go func() {
				_, err := s.SaveProvider(ctx, SaveProviderInput{ID: cfg.ID, Name: "new", Kind: "openai", BaseURL: fresh.URL, Key: "replacement"})
				saved <- err
			}()
			<-wrote
			streamed := make(chan error, 1)
			go func() {
				var client llm.Provider
				var err error
				if source == "turn" {
					client, err = s.turns.Providers(ctx, stale)
				} else {
					client, err = s.runner.Providers(ctx, stale)
				}
				if err == nil {
					_, err = client.Stream(ctx, llm.Request{Model: "test", Messages: []llm.Message{{Role: llm.RoleUser, Content: "ping"}}}, nil)
				}
				streamed <- err
			}()
			var destination string
			select {
			case destination = <-reached:
			case <-time.After(30 * time.Millisecond):
			}
			close(allow)
			if err = <-saved; err != nil {
				t.Fatal(err)
			}
			if err = <-streamed; err != nil {
				t.Fatal(err)
			}
			if destination == "" {
				select {
				case destination = <-reached:
				case <-time.After(time.Second):
					t.Fatal("request missing")
				}
			}
			if destination != "new" {
				t.Fatal("replacement key was sent to old endpoint")
			}
		})
	}
}

func TestDeleteProviderCancellationRestoresCredential(t *testing.T) {
	s, db := fixture(t, nil)
	ring := &fakeCredentials{keys: map[string]string{}}
	s.credentials = ring
	cfg, err := s.SaveProvider(context.Background(), SaveProviderInput{Name: "service", Kind: "openai", BaseURL: "https://example.invalid", Key: "initial"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ring.onDelete = cancel
	if err = s.DeleteProvider(ctx, cfg.ID); err == nil {
		t.Fatal("cancelled delete reported success")
	}
	if ring.keys[cfg.ID] != "initial" {
		t.Fatal("cancelled delete did not restore original credential")
	}
	if _, err = db.Provider(context.Background(), cfg.ID); err != nil {
		t.Fatal("cancelled delete removed provider")
	}
}
