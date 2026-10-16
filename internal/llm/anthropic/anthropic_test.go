package anthropic

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

func TestStreamRequestAndCumulativeUsage(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "test-secret" || r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Error("invalid headers/path")
		}
		var body struct {
			System   string
			Stream   bool
			Max      int `json:"max_tokens"`
			Messages []struct{ Role, Content string }
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.System != "规则" || !body.Stream || body.Max != 4096 || len(body.Messages) != 1 || body.Messages[0].Role != "user" {
			t.Errorf("invalid body %+v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":12,\"output_tokens\":1}}}\n\n")
		fmt.Fprint(w, "event: ping\ndata: {\"type\":\"ping\"}\n\n")
		line := []byte("event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}\n\n")
		for _, b := range line {
			w.Write([]byte{b})
			w.(http.Flusher).Flush()
		}
		fmt.Fprint(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":2}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":3}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	}))
	defer s.Close()
	p, err := New(s.URL, "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	usage, err := p.Stream(context.Background(), llm.Request{Model: "m", System: "规则", Messages: []llm.Message{{Role: llm.RoleUser, Content: "你好"}}}, func(d string) { out.WriteString(d) })
	if err != nil || out.String() != "你好" || usage.InputTokens != 12 || usage.OutputTokens != 3 {
		t.Fatalf("%q %+v %v", out.String(), usage, err)
	}
}
func TestFailures(t *testing.T) {
	for _, tc := range []struct {
		name       string
		status     int
		body, want string
	}{
		{"401", 401, "test-secret", "401 Unauthorized"}, {"429", 429, "test-secret", "429"},
		{"malformed", 200, "data: {\n\n", "JSON"},
		{"truncated", 200, "data: {\"type\":\"ping\"}\n\n", "中断"},
		{"stream-error", 200, "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"test-secret\"}}\n\n", "繁忙"},
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
func TestCancel(t *testing.T) {
	started := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, ": ping\n\n")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer s.Close()
	p, err := New(s.URL, "test-secret")
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
		t.Fatal("cancel did not interrupt")
	}
}
