//go:build darwin && desktopqa

package desktop

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/store"
	"ai-group-chat/internal/turn"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func qaDatabasePath(path string) string {
	if p := os.Getenv("AGC_QA_DB"); p != "" {
		return p
	}
	return path
}
func prepareBackendQA(db *store.Store, p turn.Providers) (turn.Providers, error) {
	if os.Getenv("AGC_QA_BRIDGE") != "1" {
		return p, nil
	}
	if os.Getenv("AGC_QA_DB") == "" {
		return nil, errors.New("桥接验收必须指定独立 AGC_QA_DB，避免写入用户数据库")
	}
	if os.Getenv("AGC_QA_ONBOARDING") == "1" {
		return func(context.Context, domain.Provider) (llm.Provider, error) { return bridgeQAProvider{}, nil }, nil
	}
	ctx := context.Background()
	provider := domain.Provider{ID: "bridge-qa", Name: "桥接验收本地测试流", Kind: "openai"}
	if err := db.SaveProvider(ctx, &provider); err != nil {
		return nil, err
	}
	if os.Getenv("AGC_QA_SHARE") == "1" {
		if err := seedShareQA(db); err != nil {
			return nil, err
		}
	} else {
		for _, m := range []domain.Member{{ID: "qa-a", Name: "青砚", ProviderID: provider.ID, Model: "bridge-qa-stream", ContextTokens: 16000, Avatar: domain.Avatar{Glyph: "青", Color: "shiqing"}}, {ID: "qa-b", Name: "墨白", ProviderID: provider.ID, Model: "bridge-qa-stream", ContextTokens: 16000, Avatar: domain.Avatar{Glyph: "墨", Color: "dai"}}} {
			if err := db.SaveMember(ctx, &m); err != nil {
				return nil, err
			}
		}
	}
	return func(context.Context, domain.Provider) (llm.Provider, error) { return bridgeQAProvider{}, nil }, nil
}

type bridgeQAProvider struct{}

var bridgeQARequestMu sync.Mutex

func (bridgeQAProvider) Stream(ctx context.Context, request llm.Request, delta func(string)) (llm.Usage, error) {
	if os.Getenv("AGC_QA_ATTACHMENTS") == "1" && os.Getenv("AGC_QA_DB") != "" {
		// 只在独立库的QA模型中记录合成请求，不读取凭证或真实用户聊天。
		bridgeQARequestMu.Lock()
		raw, err := json.Marshal(request)
		if err == nil {
			f, err := os.OpenFile(filepath.Join(os.Getenv("AGC_QA_DIR"), "requests.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			if err == nil {
				_, _ = f.Write(append(raw, '\n'))
				_ = f.Close()
			}
		}
		bridgeQARequestMu.Unlock()
	}
	// 先给一小段带代码块的正文，用来验收 TASK-011 的高亮与复制。
	delta("桥接验收记录：下面是一段示例代码，用于检查高亮配色。\n\n```ts\nconst answer = 42 // 注释走 --ink-3\nfunction greet(name: string) {\n  return `你好，${name}`\n}\n```\n\n")
	chunk := "桥接验收记录：正文通过 Go 编排器与事件缓冲进入本机界面，保留来源编号。\n\n"
	for range 80 {
		select {
		case <-ctx.Done():
			return llm.Usage{}, ctx.Err()
		case <-time.After(18 * time.Millisecond):
			delta(chunk)
		}
	}
	return llm.Usage{}, nil
}

//go:embed bridgeqa.js
var bridgeQAScript string

//go:embed onboardingqa.js
var onboardingQAScript string

//go:embed attachmentsqa.js
var attachmentsQAScript string

//go:embed attachmentsrestartqa.js
var attachmentsRestartQAScript string

//go:embed shareqa.js
var shareQAScript string

func installBridgeQA(app *application.App, w *application.WebviewWindow) {
	dir := os.Getenv("AGC_QA_DIR")
	if dir == "" {
		return
	}
	_ = os.MkdirAll(dir, 0700)
	app.Event.On("bridge:qa-fixtures", func(*application.CustomEvent) {
		if os.Getenv("AGC_QA_ATTACHMENTS") != "1" || os.Getenv("AGC_QA_DB") == "" {
			return
		}
		root := "/private/tmp/aidochat-020-fixtures"
		fixtures := map[string]string{}
		for _, name := range []string{"sample.png", "sample.txt", "sample.md", "sample.pdf", "no-text.pdf", "invalid.pdf"} {
			raw, err := os.ReadFile(filepath.Join(root, name))
			if err == nil && len(raw) < 2<<20 {
				fixtures[name] = base64.StdEncoding.EncodeToString(raw)
			}
		}
		if raw, err := json.Marshal(fixtures); err == nil {
			w.ExecJS("window.__attachmentQAFixtures = " + string(raw))
		}
	})
	app.Event.On("bridge:qa-progress", func(e *application.CustomEvent) { slog.Info("QA 进度", "stage", e.Data) })
	app.Event.On("bridge:qa-diagnostic", func(e *application.CustomEvent) { slog.Warn("QA 前端诊断", "error", e.Data) })
	app.Event.On("bridge:qa-capture", func(e *application.CustomEvent) {
		name, ok := e.Data.(string)
		if !ok {
			return
		}
		// 只接受安全的截图名，避免路径穿越。
		if name == "" || len(name) > 40 || strings.ContainsAny(name, "/\\.") {
			return
		}
		captureQA(w, dir, name)
		// 用截图名而不是布尔值回执，避免上一张的迟到回执让下一张提前继续。
		w.ExecJS("window.__bridgeCaptureDone = " + strconv.Quote(name))
	})
	app.Event.On("bridge:qa-minimum", func(*application.CustomEvent) {
		w.SetSize(960, 640)
		width, height := w.Size()
		slog.Info("QA 最小窗口", "width", width, "height", height)
	})
	app.Event.On("bridge:qa-result", func(e *application.CustomEvent) {
		raw, err := json.MarshalIndent(e.Data, "", "  ")
		if err == nil {
			_ = os.WriteFile(filepath.Join(dir, "result.json"), raw, 0600)
		}
		time.AfterFunc(200*time.Millisecond, app.Quit)
	})
	w.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		time.AfterFunc(time.Second, func() {
			app.Show()
			w.Focus()
			script := bridgeQAScript
			if os.Getenv("AGC_QA_ONBOARDING") == "1" {
				script = onboardingQAScript
			}
			if os.Getenv("AGC_QA_ATTACHMENTS") == "1" {
				script = attachmentsQAScript
			}
			if os.Getenv("AGC_QA_RESTART") == "1" {
				script = attachmentsRestartQAScript
			}
			if os.Getenv("AGC_QA_SHARE") == "1" {
				script = shareQAScript
			}
			w.ExecJS(script)
		})
	})
}
