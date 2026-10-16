package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ai-group-chat/internal/llm"
)

func TestStreamRequestAndUsage(t *testing.T) {
	key := "test-secret"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer "+key || r.Method != "POST" {
			t.Errorf("invalid request headers/path")
		}
		var body struct {
			Model       string `json:"model"`
			Stream      bool   `json:"stream"`
			Messages    []struct{ Role, Content string }
			Temperature *float64
			MaxTokens   int `json:"max_tokens"`
			Options     struct {
				Include bool `json:"include_usage"`
			} `json:"stream_options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "test" || !body.Stream || !body.Options.Include || body.MaxTokens != 42 || body.Temperature == nil || *body.Temperature != 0 || len(body.Messages) != 2 || body.Messages[0].Role != "system" || body.Messages[0].Content != "规则" {
			t.Errorf("invalid body %+v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, ": ping\r\n\r\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"}}]}\r\n\r\n")
		// 分割 UTF-8 与 JSON；传输分片不能被当成不完整事件。
		chunk := []byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"你好\"}}]}\n\n")
		for _, b := range chunk {
			w.Write([]byte{b})
			w.(http.Flusher).Flush()
		}
		fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":3}}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	p, err := New(server.URL+"/v1/", key)
	if err != nil {
		t.Fatal(err)
	}
	zero := 0.0
	var output strings.Builder
	usage, err := p.Stream(context.Background(), llm.Request{Model: "test", System: "规则", Messages: []llm.Message{{Role: llm.RoleUser, Content: "你好"}}, MaxTokens: 42, Temperature: &zero}, func(d string) { output.WriteString(d) })
	if err != nil || output.String() != "你好" || usage.InputTokens != 12 || usage.OutputTokens != 3 {
		t.Fatalf("%q %+v %v", output.String(), usage, err)
	}
}

func TestStreamFailuresAndKeyRedaction(t *testing.T) {
	for _, tc := range []struct {
		name       string
		status     int
		body, want string
	}{
		{"401", 401, "test-secret", "401 Unauthorized"}, {"429", 429, "test-secret", "429"},
		{"malformed", 200, "data: {\"choices\":\n\n", "JSON"},
		{"truncated", 200, "data: {\"choices\":[{\"delta\":{\"content\":\"部分\"}}]}\n\n", "中断"},
		{"provider-error", 200, "data: {\"error\":{\"message\":\"test-secret\",\"code\":\"invalid_api_key\"}}\n\n", "模型服务"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer s.Close()
			p, err := New(s.URL, "test-secret")
			if err != nil {
				t.Fatal(err)
			}
			_, err = p.Stream(context.Background(), llm.Request{Model: "m"}, func(string) {})
			if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "test-secret") {
				t.Fatalf("%v", err)
			}
		})
	}
}
func TestCancellationAndNoKey(t *testing.T) {
	started := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("keyless endpoint got authorization")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"半\"}}]}\n\n")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer s.Close()
	p, err := New(s.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := p.Stream(ctx, llm.Request{Model: "m"}, func(string) {}); done <- err }()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel did not interrupt stream")
	}
}
