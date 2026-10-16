//go:build darwin && desktopqa

package desktop

/*
#cgo CFLAGS: -DAGC_DESKTOP_QA
#include <stdlib.h>
int agcCaptureWindow(void *window, const char *image, const char *metrics);
*/
import "C"

import (
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func qaStatePath(path string) string {
	if override := os.Getenv("AGC_QA_STATE"); override != "" {
		return override
	}
	return path
}

// 仅 desktopqa 构建可用，在本应用内捕获视图，不需要录制其他应用或桌面。
func installQA(app *application.App, w *application.WebviewWindow) {
	if os.Getenv("AGC_QA_BRIDGE") == "1" {
		installBridgeQA(app, w)
		return
	}
	dir := os.Getenv("AGC_QA_DIR")
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		slog.Error("QA 目录失败", "error", err)
		return
	}
	var once sync.Once
	ready := `(async()=>{while(!document.querySelector('[aria-label="切换昼夜"]'))await new Promise(r=>setTimeout(r,50));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const api=await import('/wails/runtime.js');await api.Events.Emit('desktop:qa-ready');})()`
	stage := 0
	app.Event.On("desktop:qa-ready", func(*application.CustomEvent) {
		name := []string{"xuan-macos", "ye-macos", "ye-minimum-macos"}[stage]
		captureQA(w, dir, name)
		stage++
		switch stage {
		case 1:
			w.ExecJS(`document.querySelector('[aria-label="切换昼夜"]').click();` + ready)
		case 2:
			w.SetSize(960, 640)
			time.AfterFunc(500*time.Millisecond, func() { w.ExecJS(ready) })
		case 3:
			w.ExecJS(`if (["ye","wujin"].includes(document.documentElement.dataset.paper)) document.querySelector('[aria-label="切换昼夜"]')?.click(); if (window.__agcQAOriginalAppearance === null) localStorage.removeItem("agc.appearance"); else if (typeof window.__agcQAOriginalAppearance === "string") localStorage.setItem("agc.appearance", window.__agcQAOriginalAppearance);`)
			time.AfterFunc(300*time.Millisecond, app.Quit)
		}
	})
	w.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		once.Do(func() {
			time.AfterFunc(time.Second, func() {
				w.ExecJS(`window.__agcQAOriginalAppearance = localStorage.getItem("agc.appearance"); if (["ye","wujin"].includes(document.documentElement.dataset.paper)) document.querySelector('[aria-label="切换昼夜"]')?.click();` + ready)
			})
		})
	})
}

func captureQA(w *application.WebviewWindow, dir, name string) {
	image := C.CString(filepath.Join(dir, name+".png"))
	metrics := C.CString(filepath.Join(dir, name+".json"))
	defer C.free(unsafe.Pointer(image))
	defer C.free(unsafe.Pointer(metrics))
	application.InvokeSync(func() {
		code := C.agcCaptureWindow(w.NativeWindow(), image, metrics)
		slog.Info("QA 视图捕获", "name", name, "code", int(code))
	})
}
