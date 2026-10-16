package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStateRoundTripAndFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings", "window.json")
	state, err := LoadState(path)
	if err != nil || state.Width != 1280 || state.Height != 820 || state.Paper != "xuan" || state.HasPosition {
		t.Fatalf("%+v %v", state, err)
	}
	state = State{Width: 1040, Height: 700, X: -1200, Y: 80, HasPosition: true, Paper: "ye"}
	if err = SaveState(path, state); err != nil {
		t.Fatal(err)
	}
	restored, err := LoadState(path)
	if err != nil || restored != state {
		t.Fatalf("%+v %v", restored, err)
	}
	if err = os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	restored, err = LoadState(path)
	if err == nil || restored.Width != 1280 {
		t.Fatalf("bad data must return usable default and error: %+v %v", restored, err)
	}
}
func TestStateClampAndScreens(t *testing.T) {
	s := State{Width: 10, Height: 10, X: 9000, Y: 9000, HasPosition: true, Paper: "unknown"}.Normalized()
	if s.Width != 960 || s.Height != 640 || s.Paper != "xuan" {
		t.Fatal(s)
	}
	screens := []Rect{{X: 0, Y: 0, Width: 1440, Height: 900}, {X: -1440, Y: 0, Width: 1440, Height: 900}}
	s = s.OnScreens(screens)
	if s.HasPosition {
		t.Fatal("offscreen window must be recentered")
	}
	s = State{Width: 1280, Height: 820, X: -1300, Y: 20, HasPosition: true}.Normalized().OnScreens(screens)
	if !s.HasPosition {
		t.Fatal("negative coordinates on another screen are valid")
	}
}
func TestPlatformAndPaper(t *testing.T) {
	for input, want := range map[string]string{"darwin": "mac", "windows": "windows", "linux": "linux"} {
		if Platform(input) != want {
			t.Fatal(input)
		}
	}
	if PaperColour("ye") != "#1c1a17" || PaperColour("xuan") != "#f4efe6" {
		t.Fatal("paper colours must match tokens")
	}
}

func TestWindowOptionsPreserveNativeControls(t *testing.T) {
	for _, platform := range []string{"darwin", "windows", "linux"} {
		options := WindowOptions(DefaultState(), platform)
		if options.Width != 1280 || options.Height != 820 || options.MinWidth != 960 || options.MinHeight != 640 {
			t.Fatal(options)
		}
		if options.Frameless != (platform != "darwin") {
			t.Fatal("macOS must keep native traffic lights with a hidden title bar")
		}
		if options.Windows.DisableFramelessWindowDecorations {
			t.Fatal("Windows decorations must remain enabled")
		}
	}
}
