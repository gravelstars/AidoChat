package openai

import (
	"ai-group-chat/internal/llm"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImageWireShape(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		m := body["messages"].([]any)[0].(map[string]any)
		parts, ok := m["content"].([]any)
		if !ok || len(parts) != 2 {
			t.Error(m)
		} else {
			img := parts[1].(map[string]any)
			if img["type"] != "image_url" || img["image_url"].(map[string]any)["url"] != "data:image/png;base64,YWJj" {
				t.Error(img)
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer s.Close()
	p, _ := New(s.URL, "")
	_, err := p.Stream(context.Background(), llm.Request{Messages: []llm.Message{{Role: llm.RoleUser, Content: "look", Images: []llm.Image{{MIME: "image/png", Base64: "YWJj"}}}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
}
