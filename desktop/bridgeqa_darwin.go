//go:build darwin && desktopqa

package desktop

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
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
	for _, m := range []domain.Member{{ID: "qa-a", Name: "青砚", ProviderID: provider.ID, Model: "bridge-qa-stream", ContextTokens: 16000, Avatar: domain.Avatar{Glyph: "青", Color: "shiqing"}}, {ID: "qa-b", Name: "墨白", ProviderID: provider.ID, Model: "bridge-qa-stream", ContextTokens: 16000, Avatar: domain.Avatar{Glyph: "墨", Color: "dai"}}} {
		if err := db.SaveMember(ctx, &m); err != nil {
			return nil, err
		}
	}
	return func(context.Context, domain.Provider) (llm.Provider, error) { return bridgeQAProvider{}, nil }, nil
}

type bridgeQAProvider struct{}

func (bridgeQAProvider) Stream(ctx context.Context, _ llm.Request, delta func(string)) (llm.Usage, error) {
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

func installBridgeQA(app *application.App, w *application.WebviewWindow) {
	dir := os.Getenv("AGC_QA_DIR")
	if dir == "" {
		return
	}
	_ = os.MkdirAll(dir, 0700)
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
		w.ExecJS(`window.__bridgeCaptureDone = true`)
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
			w.ExecJS(script)
		})
	})
}
