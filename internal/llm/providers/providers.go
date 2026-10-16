// Package providers 将已保存的模型服务配置转换为 turn.Providers。
package providers

import (
	"context"
	"errors"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/llm/anthropic"
	"ai-group-chat/internal/llm/openai"
	"ai-group-chat/internal/secret"
	"ai-group-chat/internal/turn"
)

type KeyReader func(providerID string) (string, error)

// New 的 nil reader 使用系统钥匙串；测试可注入假读取器而不触碰真实凭证。
func New(read KeyReader) turn.Providers {
	if read == nil {
		read = secret.Get
	}
	return func(ctx context.Context, p domain.Provider) (llm.Provider, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if p.ID == "" {
			return nil, errors.New("模型服务 ID 不能为空")
		}
		if p.Kind != "openai" && p.Kind != "anthropic" {
			return nil, errors.New("不支持的模型服务类型")
		}
		if p.KeyRef != "" && p.KeyRef != secret.Entry(p.ID) {
			return nil, errors.New("模型服务的钥匙串引用与 ID 不一致")
		}
		// 空引用表示显式未配置 Key。本地模型不应依赖系统是否安装凭证服务。
		if p.KeyRef == "" {
			if p.Kind == "anthropic" {
				return nil, secret.ErrNotFound
			}
			return openai.New(p.BaseURL, "")
		}
		key, err := read(p.ID)
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err != nil {
			if !errors.Is(err, secret.ErrNotFound) {
				return nil, secret.ErrUnavailable
			}
			// 有引用却找不到条目时不能静默降级为无鉴权请求。
			return nil, secret.ErrNotFound
		}
		if p.Kind == "anthropic" {
			if key == "" {
				return nil, secret.ErrNotFound
			}
			return anthropic.New(p.BaseURL, key)
		}
		return openai.New(p.BaseURL, key)
	}
}
