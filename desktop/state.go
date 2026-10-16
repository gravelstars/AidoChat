// Package desktop 管理桌面外壳，不包含群聊业务。
package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type State struct {
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	X           int    `json:"x"`
	Y           int    `json:"y"`
	HasPosition bool   `json:"hasPosition"`
	Paper       string `json:"paper"`
}
type Rect struct{ X, Y, Width, Height int }

func DefaultState() State { return State{Width: 1280, Height: 820, Paper: "xuan"} }
func StatePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("获取窗口配置目录：%w", err)
	}
	return filepath.Join(dir, "ai-group-chat", "window.json"), nil
}
func (s State) Normalized() State {
	s.Width = max(960, s.Width)
	s.Height = max(640, s.Height)
	if s.Width > 16384 {
		s.Width = 1280
	}
	if s.Height > 16384 {
		s.Height = 820
	}
	if _, ok := paperColours[s.Paper]; !ok {
		s.Paper = "xuan"
	}
	return s
}

// OnScreens 保证标题栏仍可被拖回；允许多显示器的负坐标。
func (s State) OnScreens(screens []Rect) State {
	if !s.HasPosition || len(screens) == 0 {
		return s
	}
	for _, r := range screens {
		if min(s.X+s.Width, r.X+r.Width)-max(s.X, r.X) >= 96 && s.Y >= r.Y && s.Y+32 <= r.Y+r.Height {
			return s
		}
	}
	s.HasPosition = false
	return s
}
func LoadState(path string) (State, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return DefaultState(), nil
	}
	if err != nil {
		return DefaultState(), fmt.Errorf("读取窗口配置：%w", err)
	}
	state := DefaultState()
	if err = json.Unmarshal(data, &state); err != nil {
		return DefaultState(), fmt.Errorf("窗口配置损坏，使用默认位置：%w", err)
	}
	return state.Normalized(), nil
}
func SaveState(path string, state State) error {
	data, err := json.Marshal(state.Normalized())
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".window-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
func Platform(goos string) string {
	if goos == "darwin" {
		return "mac"
	}
	return goos
}

// 原生窗口不能读取 CSS；值与 tokens.css 保持一致，测试校验同步。
var paperColours = map[string]string{"xuan": "#f4efe6", "su": "#f5f5f2", "ma": "#e9dfcc", "qing": "#e9ecea", "ye": "#1c1a17", "wujin": "#15181b"}

func PaperColour(paper string) string {
	if colour, ok := paperColours[paper]; ok {
		return colour
	}
	return paperColours["xuan"]
}
