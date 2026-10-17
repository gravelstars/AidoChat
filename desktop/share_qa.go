//go:build desktopqa

package desktop

import "os"

// shareDirectoryQA 让原生验收不必弹出系统目录选择；生产构建没有这个入口。
func shareDirectoryQA(fallback func() (string, error)) func() (string, error) {
	if dir := os.Getenv("AGC_QA_SHARE_DIR"); dir != "" {
		return func() (string, error) { return dir, nil }
	}
	return fallback
}
