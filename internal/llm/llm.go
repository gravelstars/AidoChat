// Package llm 是与模型服务无关的调用契约。各家适配器（OpenAI 兼容、Anthropic）
// 在子包里实现 Provider，见 docs/tasks/TASK-004。
package llm

import (
	"context"
	"unicode"
)

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

type Message struct {
	Role    Role
	Content string
	Images  []Image
}

// Request 保证：Messages 非空、以 user 开头、user/assistant 严格交替、以 user 结尾。
// 这是 Anthropic 的硬性要求；OpenAI 兼容服务也都接受。由 contextbuilder 负责保证。
type Request struct {
	Model       string
	System      string
	Messages    []Message
	Temperature *float64
	MaxTokens   int
}

type Usage struct {
	InputTokens  int
	OutputTokens int
}

// Provider 以回调方式流式返回。onDelta 在调用方 goroutine 外被调用也可以，但必须按顺序。
// ctx 取消时应尽快返回 ctx.Err()。
type Provider interface {
	Stream(ctx context.Context, req Request, onDelta func(string)) (Usage, error)
}

// EstimateTokens 是不依赖分词器的粗估：CJK 每字约 1 token，其余约 4 字符 1 token。
// 只用于预算裁剪，宁可高估。
func EstimateTokens(s string) int {
	cjk, other := 0, 0
	for _, r := range s {
		if r > 0x2E80 && (unicode.Is(unicode.Han, r) || unicode.In(r, unicode.Hiragana, unicode.Katakana, unicode.Hangul) || unicode.IsPunct(r)) {
			cjk++
		} else {
			other++
		}
	}
	return cjk + (other+3)/4 + 1
}
