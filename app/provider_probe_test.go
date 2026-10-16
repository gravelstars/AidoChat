package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/secret"
)

func TestProviderProbeRequiresExplicitModel(t *testing.T) {
	s, _ := fixture(t, nil)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); http.Error(w, "bad model", 400) }))
	defer server.Close()
	_, err := s.TestProvider(context.Background(), SaveProviderInput{Kind: "openai", BaseURL: server.URL})
	if err == nil || !strings.Contains(err.Error(), "模型") || calls.Load() != 0 {
		t.Fatalf("空测试模型必须在本地明确报错：calls=%d err=%v", calls.Load(), err)
	}
}

func TestProviderProbeUsesExplicitModelAndSavedKey(t *testing.T) {
	s, db := fixture(t, nil)
	ring := &fakeCredentials{keys: map[string]string{"existing": "probe-key"}}
	s.credentials = ring
	p := domain.Provider{ID: "existing", Name: "服务", Kind: "openai", BaseURL: "https://example.invalid", KeyRef: secret.Entry("existing")}
	if err := db.SaveProvider(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	var model string
	var auth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", 400)
			return
		}
		model = body.Model
		auth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"pong\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	_, err := s.TestProvider(context.Background(), SaveProviderInput{ID: p.ID, Kind: "openai", BaseURL: server.URL, TestModel: "provider-specific-model"})
	if err != nil || model != "provider-specific-model" || auth != "Bearer probe-key" {
		t.Fatalf("请求未按当前填写模型与保存凭证发送：model=%q authPresent=%v err=%v", model, auth != "", err)
	}
}

func TestProviderProbeDoesNotSilentlyIgnoreCredentialFailure(t *testing.T) {
	s, db := fixture(t, nil)
	s.credentials = &fakeCredentials{keys: map[string]string{}, getErr: errors.New("系统凭证服务不可用")}
	p := domain.Provider{ID: "existing", Name: "服务", Kind: "openai", BaseURL: "https://example.invalid", KeyRef: secret.Entry("existing")}
	if err := db.SaveProvider(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); http.Error(w, "unauthorized", 401) }))
	defer server.Close()
	_, err := s.TestProvider(context.Background(), SaveProviderInput{ID: p.ID, Kind: "openai", BaseURL: server.URL, TestModel: "model"})
	if err == nil || calls.Load() != 0 || !strings.Contains(err.Error(), "凭证") {
		t.Fatalf("凭证错误应明确反馈，不能降级为未鉴权请求：calls=%d err=%v", calls.Load(), err)
	}
}

func TestProviderProbeKeylessSavedServiceDoesNotReadCredentials(t *testing.T) {
	s, db := fixture(t, nil)
	ring := &fakeCredentials{keys: map[string]string{}, getErr: errors.New("不应读取凭证")}
	s.credentials = ring
	p := domain.Provider{ID: "keyless", Name: "本地服务", Kind: "openai", BaseURL: "http://localhost"}
	if err := db.SaveProvider(context.Background(), &p); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	_, err := s.TestProvider(context.Background(), SaveProviderInput{ID: p.ID, Kind: "openai", BaseURL: server.URL, TestModel: "local-model"})
	if err != nil || ring.reads != 0 {
		t.Fatalf("免Key服务应不读取系统凭证：reads=%d err=%v", ring.reads, err)
	}
}
