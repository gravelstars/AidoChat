package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"ai-group-chat/internal/secret"
)

func TestNewKeylessProviderDoesNotRequireStoredKey(t *testing.T) {
	s, db := fixture(t, nil)
	cfg, err := s.SaveProvider(context.Background(), SaveProviderInput{Name: "本地模型", Kind: "openai", BaseURL: "http://127.0.0.1:11434/v1"})
	if err != nil {
		t.Fatal(err)
	}
	p, err := db.Provider(context.Background(), cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p.KeyRef != "" {
		t.Fatalf("无 Key 服务不应变成需要钥匙串的服务：%q", p.KeyRef)
	}
}

type fakeCredentials struct {
	keys      map[string]string
	setErr    error
	getErr    error
	deleteErr error
	deletes   int
	onDelete  func()
	reads     int
	onSet     func()
}

func (f *fakeCredentials) Set(id, key string) error {
	if f.setErr != nil {
		return f.setErr
	}
	f.keys[id] = key
	if f.onSet != nil {
		f.onSet()
	}
	return nil
}
func (f *fakeCredentials) Get(id string) (string, error) {
	f.reads++
	if f.getErr != nil {
		return "", f.getErr
	}
	if key, ok := f.keys[id]; ok {
		return key, nil
	}
	return "", secret.ErrNotFound
}
func (f *fakeCredentials) Delete(id string) error {
	f.deletes++
	if f.deleteErr != nil {
		return f.deleteErr
	}
	delete(f.keys, id)
	if f.onDelete != nil {
		f.onDelete()
	}
	return nil
}

func TestProviderCredentialFailurePreservesSavedConfig(t *testing.T) {
	s, db := fixture(t, nil)
	ctx := context.Background()
	ring := &fakeCredentials{keys: map[string]string{}}
	s.credentials = ring
	cfg, err := s.SaveProvider(ctx, SaveProviderInput{Name: "旧服务", Kind: "openai", BaseURL: "https://old.invalid/v1", Key: "initial"})
	if err != nil {
		t.Fatal(err)
	}
	ring.setErr = errors.New("keyring unavailable")
	_, err = s.SaveProvider(ctx, SaveProviderInput{ID: cfg.ID, Name: "新服务", Kind: "openai", BaseURL: "https://new.invalid/v1", Key: "replacement"})
	if err == nil {
		t.Fatal("凭证写入失败未报告")
	}
	p, err := db.Provider(ctx, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "旧服务" || p.BaseURL != "https://old.invalid/v1" {
		t.Fatalf("失败却已改变模型服务：%+v", p)
	}
	ring.setErr = nil
	updated, err := s.SaveProvider(ctx, SaveProviderInput{ID: cfg.ID, Name: "改名", Kind: "openai", BaseURL: p.BaseURL})
	if err != nil || !updated.HasKey || ring.keys[cfg.ID] != "initial" {
		t.Fatalf("留空应保留已保存的Key：%+v %v", updated, err)
	}
}

func TestSavingKeylessProviderDoesNotReadKeyring(t *testing.T) {
	s, _ := fixture(t, nil)
	ring := &fakeCredentials{keys: map[string]string{}}
	s.credentials = ring
	cfg, err := s.SaveProvider(context.Background(), SaveProviderInput{Name: "Ollama", Kind: "openai", BaseURL: "http://localhost:11434/v1"})
	if err != nil || cfg.HasKey || ring.reads != 0 {
		t.Fatalf("无Key服务应不依赖系统钥匙串：%+v reads=%d err=%v", cfg, ring.reads, err)
	}
}

func TestProviderDatabaseFailureRestoresCredentials(t *testing.T) {
	for _, editing := range []bool{false, true} {
		t.Run(fmt.Sprint(editing), func(t *testing.T) {
			s, _ := fixture(t, nil)
			ring := &fakeCredentials{keys: map[string]string{}}
			s.credentials = ring
			input := SaveProviderInput{Name: "服务", Kind: "openai", BaseURL: "https://example.invalid/v1", Key: "new"}
			if editing {
				cfg, err := s.SaveProvider(context.Background(), input)
				if err != nil {
					t.Fatal(err)
				}
				input.ID = cfg.ID
				input.Key = "replacement"
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			ring.onSet = cancel
			if _, err := s.SaveProvider(ctx, input); err == nil {
				t.Fatal("取消后的数据库写入不应成功")
			}
			if editing {
				if ring.keys[input.ID] != "new" {
					t.Fatal("失败更新应恢复原Key")
				}
			} else if len(ring.keys) != 0 {
				t.Fatal("失败新建不应遗留未知ID的Key")
			}
		})
	}
}
func TestDataDirMatchesOpenedDatabase(t *testing.T) {
	s, db := fixture(t, nil)
	if s.DataDir() != filepath.Dir(db.Path()) {
		t.Fatalf("%s != %s", s.DataDir(), db.Path())
	}
}
