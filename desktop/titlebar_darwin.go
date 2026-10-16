package desktop

/*
#cgo LDFLAGS: -framework Cocoa
void agcLayoutTrafficLights(void *window);
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

func layoutTrafficLights(w *application.WebviewWindow) {
	application.InvokeSync(func() {
		if handle := w.NativeWindow(); handle != nil {
			C.agcLayoutTrafficLights(handle)
		}
	})
}
