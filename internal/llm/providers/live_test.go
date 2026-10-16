package providers

import (
	"context"
	"os"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/secret"
)

// 默认跳过，只有明确配置后才调用真实服务；Key 只从本应用系统钥匙串读取。
func TestLiveProvider(t *testing.T) {
	id := os.Getenv("AI_GROUP_CHAT_LIVE_PROVIDER_ID")
	if id == "" {
		t.Skip("未配置真实服务验收")
	}
	model, base := os.Getenv("AI_GROUP_CHAT_LIVE_MODEL"), os.Getenv("AI_GROUP_CHAT_LIVE_BASE_URL")
	if model == "" || base == "" {
		t.Fatal("真实服务验收需要模型名和服务地址")
	}
	kind := os.Getenv("AI_GROUP_CHAT_LIVE_KIND")
	if kind == "" {
		kind = "openai"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	keyRef := secret.Entry(id)
	if os.Getenv("AI_GROUP_CHAT_LIVE_KEYLESS") == "1" {
		keyRef = ""
	}
	p, err := New(nil)(ctx, domain.Provider{ID: id, Kind: kind, BaseURL: base, KeyRef: keyRef})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	// 部分服务默认先推理；过短的输出预算可能在产生正文前就耗尽。
	usage, err := p.Stream(ctx, llm.Request{Model: model, MaxTokens: 512, Messages: []llm.Message{{Role: llm.RoleUser, Content: "请只回复 OK"}}}, func(d string) { count += len(d) })
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("真实服务用量：响应字节=%d input_tokens=%d output_tokens=%d", count, usage.InputTokens, usage.OutputTokens)
	if count == 0 {
		t.Fatal("真实服务没有返回文本")
	}
	t.Logf("真实服务验收通过：类型=%s 模型=%s 响应字节=%d input_tokens=%d output_tokens=%d", kind, model, count, usage.InputTokens, usage.OutputTokens)
}
