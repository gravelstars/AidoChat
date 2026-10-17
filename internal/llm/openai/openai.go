// Package openai 实现 Chat Completions 兼容的文本流式协议。
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/llm/internal/streamhttp"
)

type Provider struct {
	endpoint, key string
	client        *streamhttp.Client
}

var _ llm.Provider = (*Provider)(nil)

func New(baseURL, key string) (*Provider, error) {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	endpoint, err := streamhttp.Endpoint(baseURL, "/chat/completions")
	if err != nil {
		return nil, err
	}
	return &Provider{endpoint: endpoint, key: key, client: streamhttp.NewClient()}, nil
}

type wireMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

func (p *Provider) Stream(ctx context.Context, req llm.Request, onDelta func(string)) (llm.Usage, error) {
	usage := llm.Usage{}
	if ctx.Err() != nil {
		return usage, ctx.Err()
	}
	messages := []wireMessage{}
	if req.System != "" {
		messages = append(messages, wireMessage{"system", req.System})
	}
	for _, m := range req.Messages {
		var content any = m.Content
		if len(m.Images) > 0 {
			parts := []any{map[string]any{"type": "text", "text": m.Content}}
			for _, img := range m.Images {
				if err := img.Validate(); err != nil {
					return usage, err
				}
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": "data:" + img.MIME + ";base64," + img.Base64}})
			}
			content = parts
		}
		messages = append(messages, wireMessage{string(m.Role), content})
	}
	body := struct {
		Model       string          `json:"model"`
		Messages    []wireMessage   `json:"messages"`
		Stream      bool            `json:"stream"`
		Options     map[string]bool `json:"stream_options"`
		Temperature *float64        `json:"temperature,omitempty"`
		MaxTokens   int             `json:"max_tokens,omitempty"`
	}{req.Model, messages, true, map[string]bool{"include_usage": true}, req.Temperature, req.MaxTokens}
	raw, err := json.Marshal(body)
	if err != nil {
		return usage, errors.New("模型请求参数无法编码，请检查温度等参数")
	}
	request, err := http.NewRequestWithContext(ctx, "POST", p.endpoint, bytes.NewReader(raw))
	if err != nil {
		return usage, errors.New("无法创建模型请求，请检查服务地址")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	if p.key != "" {
		request.Header.Set("Authorization", "Bearer "+p.key)
	}
	err = p.client.Stream(ctx, request, func(event streamhttp.Event) (bool, error) {
		if event.Data == "[DONE]" {
			return true, nil
		}
		var chunk struct {
			Choices []struct {
				Index int `json:"index"`
				Delta struct {
					Content *string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				Input  int `json:"prompt_tokens"`
				Output int `json:"completion_tokens"`
			} `json:"usage"`
			Error json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal([]byte(event.Data), &chunk); err != nil {
			return false, errors.New("模型服务返回的流式 JSON 无效，请重试")
		}
		if len(chunk.Error) > 0 && string(chunk.Error) != "null" {
			return false, errors.New("模型服务在生成过程中返回错误，请检查模型配置或稍后重试")
		}
		if chunk.Usage != nil {
			usage.InputTokens = chunk.Usage.Input
			usage.OutputTokens = chunk.Usage.Output
		}
		for _, choice := range chunk.Choices {
			if choice.Index == 0 && choice.Delta.Content != nil && onDelta != nil {
				onDelta(*choice.Delta.Content)
			}
		}
		return false, nil
	})
	if err != nil {
		for _, m := range req.Messages {
			if len(m.Images) > 0 {
				return usage, fmt.Errorf("%w；请检查所选模型是否支持图片输入及服务的图片限制", err)
			}
		}
	}
	return usage, err
}
