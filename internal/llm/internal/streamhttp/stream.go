// Package streamhttp 为文本模型适配器提供统一的 SSE 传输、取消和超时处理。
package streamhttp

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var ErrIdleTimeout = errors.New("流式响应超时：60 秒未收到数据，请重试")

const maxEventSize = 1 << 20

type Event struct{ Name, Data string }
type Client struct {
	HTTP        *http.Client
	IdleTimeout time.Duration
}

var sharedTransport = newTransport()

func newTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.TLSHandshakeTimeout = 15 * time.Second
	transport.ResponseHeaderTimeout = 15 * time.Second
	return transport
}

func NewClient() *Client {
	// 每次轮次可能重建适配器，复用传输层才能复用连接，避免空闲连接随轮次累积。
	return &Client{HTTP: &http.Client{Transport: sharedTransport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, IdleTimeout: 60 * time.Second}
}
func Endpoint(base, suffix string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("模型服务地址无效：请使用不含账号、查询参数或片段的 HTTP/HTTPS 地址")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	if !strings.HasSuffix(u.Path, suffix) {
		u.Path += suffix
	}
	u.RawPath = ""
	return u.String(), nil
}
func HTTPError(status int) error {
	message := "模型服务返回错误，请检查服务地址与模型配置后重试"
	switch status {
	case 400, 422:
		message = "请求参数不被模型服务接受，请检查模型名与参数"
	case 401:
		message = "该模型服务的 API Key 无效"
	case 403:
		message = "该模型服务拒绝访问，请检查权限或额度"
	case 404:
		message = "模型或接口不存在，请检查服务地址与模型名"
	case 408, 504:
		message = "模型服务响应超时，请重试"
	case 429:
		message = "请求过于频繁或额度不足"
	case 500, 502, 503, 529:
		message = "模型服务暂时繁忙，请稍后重试"
	}
	return fmt.Errorf("%d %s：%s", status, http.StatusText(status), message)
}
func networkError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return errors.New("连接超时：请检查网络或服务地址")
	}
	// net/http 错误可能包含请求 URL 或代理凭证；不要直接包装它。
	return errors.New("连接模型服务失败：请检查网络或服务地址")
}

// idleReader 按实际字节到达重置定时器，SSE 心跳及尚未成行的片段都算活动。
type idleReader struct {
	body    io.ReadCloser
	mu      sync.Mutex
	timer   *time.Timer
	timeout time.Duration
	closed  bool
}

func (r *idleReader) Read(p []byte) (int, error) {
	n, err := r.body.Read(p)
	if n > 0 {
		r.mu.Lock()
		if !r.closed {
			r.timer.Reset(r.timeout)
		}
		r.mu.Unlock()
	}
	return n, err
}
func (r *idleReader) stop() { r.mu.Lock(); r.closed = true; r.timer.Stop(); r.mu.Unlock() }

func (c *Client) Stream(parent context.Context, request *http.Request, onEvent func(Event) (bool, error)) error {
	if parent.Err() != nil {
		return parent.Err()
	}
	ctx, cancel := context.WithCancelCause(parent)
	defer cancel(nil)
	response, err := c.HTTP.Do(request.Clone(ctx))
	if err != nil {
		return networkError(parent, err)
	}
	defer response.Body.Close()
	if parent.Err() != nil {
		return parent.Err()
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return HTTPError(response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		kind, _, err := mime.ParseMediaType(contentType)
		if err != nil || kind != "text/event-stream" {
			return errors.New("模型服务未返回 SSE 流，请检查接口地址")
		}
	}
	idle := c.IdleTimeout
	if idle <= 0 {
		idle = 60 * time.Second
	}
	reader := &idleReader{body: response.Body, timeout: idle}
	reader.timer = time.AfterFunc(idle, func() { cancel(ErrIdleTimeout) })
	defer reader.stop()
	err = readEvents(reader, func(event Event) (bool, error) {
		// Scanner 可能已缓冲多个事件；即便无需继续读网络，也不能在停止后继续推送。
		if ctx.Err() != nil {
			return false, context.Cause(ctx)
		}
		return onEvent(event)
	})
	if parent.Err() != nil {
		return parent.Err()
	}
	if errors.Is(context.Cause(ctx), ErrIdleTimeout) {
		return ErrIdleTimeout
	}
	return err
}

func readEvents(reader io.Reader, onEvent func(Event) (bool, error)) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), maxEventSize)
	event := Event{}
	size := 0
	hasData := false
	dispatch := func() (bool, error) {
		if !hasData {
			event = Event{}
			size = 0
			return false, nil
		}
		done, err := onEvent(event)
		event = Event{}
		size = 0
		hasData = false
		return done, err
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			done, err := dispatch()
			if err != nil {
				return err
			}
			if done {
				return nil
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, _ := strings.Cut(line, ":")
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			event.Name = value
		case "data":
			size += len(value) + 1
			if size > maxEventSize {
				return errors.New("模型服务单条流式事件过大")
			}
			if hasData {
				event.Data += "\n"
			}
			event.Data += value
			hasData = true
		}
	}
	if scanner.Err() != nil {
		return errors.New("读取模型响应失败或事件过大，请重试")
	}
	if done, err := dispatch(); err != nil {
		return err
	} else if done {
		return nil
	}
	return errors.New("模型响应意外中断：未收到结束标记，请重试")
}
