package desktop

import (
	bridge "ai-group-chat/app"
	"ai-group-chat/internal/llm/providers"
	"ai-group-chat/internal/store"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type Shell struct {
	mu           sync.Mutex
	state        State
	path         string
	window       *application.WebviewWindow
	startupPaper func(bool) string
}

func NewShell(path string) (*Shell, error) {
	state, err := LoadState(path)
	return &Shell{state: state, path: path}, err
}

// 原生应用已初始化、待创建窗口时读系统主题；此时 Env.IsDarkMode 才可靠。
func (s *Shell) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	if s.startupPaper != nil {
		return s.SetPaper(s.startupPaper(application.Get().Env.IsDarkMode()))
	}
	return nil
}
func (s *Shell) stateSnapshot() State { s.mu.Lock(); defer s.mu.Unlock(); return s.state }
func (s *Shell) SetPaper(paper string) error {
	if _, ok := paperColours[paper]; !ok {
		return errors.New("未知纸张")
	}
	s.mu.Lock()
	s.state.Paper = paper
	err := SaveState(s.path, s.state)
	window := s.window
	s.mu.Unlock()
	if window != nil {
		window.SetBackgroundColour(Colour(paper))
	}
	return err
}
func Colour(paper string) application.RGBA {
	value, _ := strconv.ParseUint(PaperColour(paper)[1:], 16, 32)
	return application.NewRGB(uint8(value>>16), uint8(value>>8), uint8(value))
}
func (s *Shell) bind(app *application.App, w *application.WebviewWindow) {
	s.window = w
	desired := s.stateSnapshot()
	var ready atomic.Bool
	var setup sync.Once
	initialise := func() {
		setup.Do(func() {
			// Wails beta.29 的 macOS 构造会减去边缘像素；原生创建后恢复精确尺寸，防止重启逐次缩小。
			if runtime.GOOS == "darwin" {
				w.SetSize(desired.Width, desired.Height)
			}
			screens := []Rect{}
			for _, screen := range app.Screen.GetAll() {
				r := screen.WorkArea
				screens = append(screens, Rect{r.X, r.Y, r.Width, r.Height})
			}
			if !desired.OnScreens(screens).HasPosition {
				w.Center()
			}
			layoutTrafficLights(w)
			ready.Store(true)
		})
	}
	remember := func(*application.WindowEvent) {
		if !ready.Load() || w.IsMinimised() || w.IsMaximised() || w.IsFullscreen() {
			return
		}
		width, height := w.Size()
		if width < 960 || height < 640 {
			return
		}
		x, y := w.Position()
		s.mu.Lock()
		s.state.Width, s.state.Height, s.state.X, s.state.Y, s.state.HasPosition = width, height, x, y, true
		err := SaveState(s.path, s.state)
		s.mu.Unlock()
		if err != nil {
			slog.Warn("窗口位置未能保存", "error", err)
		}
	}
	w.OnWindowEvent(events.Common.WindowDidMove, remember)
	w.OnWindowEvent(events.Common.WindowDidResize, remember)
	w.RegisterHook(events.Common.WindowClosing, remember)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) { initialise() })
	w.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) { initialise(); layoutTrafficLights(w) })
	w.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
		if ready.Load() {
			layoutTrafficLights(w)
		}
	})
}
func WindowOptions(state State, goos string) application.WebviewWindowOptions {
	state = state.Normalized()
	options := application.WebviewWindowOptions{Name: "main", Title: "AidoChat", Width: state.Width, Height: state.Height, MinWidth: 960, MinHeight: 640, Frameless: goos != "darwin", BackgroundColour: Colour(state.Paper), URL: "/", InitialPosition: application.WindowCentered}
	if state.HasPosition {
		options.InitialPosition = application.WindowXY
		options.X = state.X
		options.Y = state.Y
	}
	if goos == "darwin" {
		options.Mac = application.MacWindow{TitleBar: application.MacTitleBarHiddenInset, InvisibleTitleBarHeight: 64}
	}
	return options
}
func (s *Shell) flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := SaveState(s.path, s.state); err != nil {
		return fmt.Errorf("保存窗口配置：%w", err)
	}
	return nil
}

// Run 把框架初始化留在外壳层；Shell 的远程方法为 SetPaper，生命周期方法由 Wails 保留。
func Run(assets fs.FS) error {
	path, err := StatePath()
	if err != nil {
		return err
	}
	path = qaStatePath(path)
	shell, err := NewShell(path)
	if err != nil {
		slog.Warn("使用默认窗口配置", "error", err)
	}
	dbPath, err := store.DefaultPath()
	if err != nil {
		return err
	}
	db, err := store.Open(qaDatabasePath(dbPath))
	if err != nil {
		return err
	}
	defer db.Close()
	factory, err := prepareBackendQA(db, providers.New(nil))
	if err != nil {
		return err
	}
	var app *application.App
	service := bridge.NewService(db, factory, Platform(runtime.GOOS), func(e bridge.Event) { app.Event.Emit(bridge.EventName, e) })
	defer bridge.CloseService(service)
	appearance, err := bridge.LoadAppearance(context.Background(), db)
	if err != nil {
		return err
	}
	app = application.New(application.Options{
		Name: "AidoChat", Description: "本地 AI 群聊",
		Services: []application.Service{application.NewService(shell), application.NewService(service)},
		Flags:    map[string]any{"app.platform": Platform(runtime.GOOS)},
		// 头像资源走 /avatars/*（TASK-013），其余交给嵌入的前端资源。
		Assets: application.AssetOptions{Handler: bridge.ResourceHandler(service, application.AssetFileServerFS(assets))},
		Mac:    application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		OnShutdown: func() {
			if err := shell.flush(); err != nil {
				slog.Warn("窗口配置保存失败", "error", err)
			}
		},
	})
	shell.startupPaper = appearance.EffectivePaper
	if err := shell.SetPaper(appearance.EffectivePaper(false)); err != nil {
		return err
	}

	window := app.Window.NewWithOptions(WindowOptions(shell.stateSnapshot(), runtime.GOOS))
	service.SelectExportDirectory = shareDirectoryQA(func() (string, error) {
		return app.Dialog.OpenFile().
			CanChooseFiles(false).
			CanChooseDirectories(true).
			CanCreateDirectories(true).
			AttachToWindow(window).
			SetTitle("选择分享图片保存位置").
			PromptForSingleSelection()
	})
	shell.bind(app, window)
	installQA(app, window)
	return app.Run()
}
