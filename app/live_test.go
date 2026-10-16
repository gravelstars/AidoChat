package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm/providers"
	"ai-group-chat/internal/secret"
	"ai-group-chat/internal/store"
)

// 显式启用才调用真实服务；Key 只从系统钥匙串读取，测试不接收或输出 Key。
func TestLiveDeepSeekBridge(t *testing.T) {
	if os.Getenv("AI_GROUP_CHAT_LIVE_BRIDGE") != "1" {
		t.Skip("设置 AI_GROUP_CHAT_LIVE_BRIDGE=1 才运行真实服务验收")
	}
	db, err := store.Open(filepath.Join(t.TempDir(), "live.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	p := domain.Provider{ID: "deepseek", Name: "DeepSeek", Kind: "openai", BaseURL: "https://api.deepseek.com", KeyRef: secret.Entry("deepseek")}
	if err = db.SaveProvider(ctx, &p); err != nil {
		t.Fatal(err)
	}
	for _, m := range []domain.Member{{ID: "a", Name: "青砚", RolePrompt: "回答不超过20个字。", ProviderID: p.ID, Model: "deepseek-flash", ContextTokens: 8000, Avatar: domain.Avatar{Glyph: "青", Color: "shiqing"}}, {ID: "b", Name: "墨白", RolePrompt: "回答不超过20个字。", ProviderID: p.ID, Model: "deepseek-flash", ContextTokens: 8000, Avatar: domain.Avatar{Glyph: "墨", Color: "dai"}}} {
		if err = db.SaveMember(ctx, &m); err != nil {
			t.Fatal(err)
		}
	}
	startedAt := time.Now()
	ended := make(chan struct{}, 1)
	s := NewService(db, providers.New(nil), "mac", func(e Event) {
		if e["kind"] == "message" {
			m := e["message"].(Message)
			t.Logf("elapsed=%s seq=%d status=%s content_characters=%d", time.Since(startedAt).Round(time.Millisecond), m.Seq, m.Status, len([]rune(m.Content)))
		}
		if e["kind"] == "turn.end" {
			ended <- struct{}{}
		}
	})
	defer CloseService(s)
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "真实服务桥接验收", MemberIDs: []string{"a", "b"}, DefaultMode: domain.ModeSerial})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, g.ID, "@青砚 @墨白 请用一句短句说：已接通本地群聊。", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ended:
	case <-time.After(150 * time.Second):
		s.Stop(ctx, g.ID)
		t.Fatal("真实调用超时")
	}
	d, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Messages) != 3 {
		t.Fatalf("消息条数 %d", len(d.Messages))
	}
	for _, m := range d.Messages[1:] {
		if m.Status != domain.StatusDone || m.Content == "" {
			t.Fatalf("回复状态=%s 错误=%s", m.Status, m.Error)
		}
		t.Logf("seq=%d contextSeq=%d characters=%d status=%s", m.Seq, m.ContextSeq, len([]rune(m.Content)), m.Status)
	}
	if d.Messages[2].ContextSeq != d.Messages[1].Seq {
		t.Fatal("串行上下文未包含第一位回复")
	}
}
