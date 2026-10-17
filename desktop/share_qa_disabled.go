//go:build !desktopqa

package desktop

func shareDirectoryQA(fallback func() (string, error)) func() (string, error) {
	return fallback
}
