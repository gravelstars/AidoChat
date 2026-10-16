//go:build !darwin && desktopqa

package desktop

import (
	"ai-group-chat/internal/store"
	"ai-group-chat/internal/turn"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func qaStatePath(path string) string                         { return path }
func installQA(*application.App, *application.WebviewWindow) {}

func qaDatabasePath(path string) string                                         { return path }
func prepareBackendQA(_ *store.Store, p turn.Providers) (turn.Providers, error) { return p, nil }
