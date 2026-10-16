// Package anthropic 实现 Messages API 的文本流式协议。
package anthropic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

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
		baseURL = "https://api.anthropic.com"
	}
	// Anthropic 的根地址与 /v1 地址都可配置，已完整填写的 /v1/messages 也不重复拼接。
	if strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/v1") {
		baseURL = strings.TrimRight(baseURL, "/") + "/messages"
	} else if !strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/messages") {
		baseURL = strings.TrimRight(baseURL, "/") + "/v1/messages"
	}
	endpoint, err := streamhttp.Endpoint(baseURL, "/messages")
	if err != nil {
		return nil, err
	}
	return &Provider{endpoint: endpoint, key: key, client: streamhttp.NewClient()}, nil
}

type wireMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type tokenUsage struct {
	Input         *int `json:"input_tokens"`
	Output        *int `json:"output_tokens"`
	CacheRead     *int `json:"cache_read_input_tokens"`
	CacheCreation *int `json:"cache_creation_input_tokens"`
}

func (p *Provider) Stream(ctx context.Context, req llm.Request, onDelta func(string)) (llm.Usage, error) {
	usage := llm.Usage{}
	if ctx.Err() != nil {
		return usage, ctx.Err()
	}
	messages := []wireMessage{}
	for _, m := range req.Messages {
		messages = append(messages, wireMessage{string(m.Role), m.Content})
	}
	max := req.MaxTokens
	if max <= 0 {
		max = 4096
	}
	body := struct {
		Model       string        `json:"model"`
		Messages    []wireMessage `json:"messages"`
		System      string        `json:"system,omitempty"`
		Stream      bool          `json:"stream"`
		MaxTokens   int           `json:"max_tokens"`
		Temperature *float64      `json:"temperature,omitempty"`
	}{req.Model, messages, req.System, true, max, req.Temperature}
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
	request.Header.Set("anthropic-version", "2023-06-01")
	if p.key != "" {
		request.Header.Set("x-api-key", p.key)
	}
	input, cacheRead, cacheCreation := 0, 0, 0
	applyUsage := func(u tokenUsage) {
		if u.Input != nil {
			input = *u.Input
		}
		if u.CacheRead != nil {
			cacheRead = *u.CacheRead
		}
		if u.CacheCreation != nil {
			cacheCreation = *u.CacheCreation
		}
		usage.InputTokens = input + cacheRead + cacheCreation
		if u.Output != nil {
			usage.OutputTokens = *u.Output
		}
	}
	err = p.client.Stream(ctx, request, func(event streamhttp.Event) (bool, error) {
		var chunk struct {
			Type    string `json:"type"`
			Message struct {
				Usage tokenUsage `json:"usage"`
			} `json:"message"`
			Usage tokenUsage `json:"usage"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
			Block struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content_block"`
			Error struct {
				Type string `json:"type"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(event.Data), &chunk); err != nil {
			return false, errors.New("模型服务返回的流式 JSON 无效，请重试")
		}
		kind := chunk.Type
		if kind == "" {
			kind = event.Name
		}
		switch kind {
		case "message_start":
			applyUsage(chunk.Message.Usage)
		case "message_delta":
			applyUsage(chunk.Usage)
		case "content_block_start":
			if chunk.Block.Type == "text" && chunk.Block.Text != "" && onDelta != nil {
				onDelta(chunk.Block.Text)
			}
		case "content_block_delta":
			if chunk.Delta.Type == "text_delta" && onDelta != nil {
				onDelta(chunk.Delta.Text)
			}
		case "message_stop":
			return true, nil
		case "error":
			switch chunk.Error.Type {
			case "overloaded_error":
				return false, streamhttp.HTTPError(529)
			case "rate_limit_error":
				return false, streamhttp.HTTPError(429)
			case "authentication_error":
				return false, streamhttp.HTTPError(401)
			default:
				return false, errors.New("模型服务在生成过程中返回错误，请稍后重试")
			}
		}
		return false, nil
	})
	return usage, err
}
