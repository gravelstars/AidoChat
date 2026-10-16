package app

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestSaveAvatarConcurrentDuplicates(t *testing.T) {
	dir := withTempAvatarDir(t)
	data := pngBytes(maxAvatarBytes)
	const uploads = 64
	start := make(chan struct{})
	errors := make(chan error, uploads)
	var workers sync.WaitGroup
	for range uploads {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			_, err := SaveAvatar("same.png", "image/png", data)
			errors <- err
		}()
	}
	close(start)
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Errorf("相同图片并发上传应全部成功：%v", err)
		}
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 1 {
		t.Fatalf("应只保留一个完整头像，无临时文件：files=%v err=%v", files, err)
	}
	saved, err := os.ReadFile(filepath.Join(dir, files[0].Name()))
	if err != nil || !bytes.Equal(saved, data) {
		t.Fatalf("并发上传损坏文件：%v", err)
	}
}

// pngBytes 是一张最小的 PNG（含正确文件头，内容无关紧要）。
func pngBytes(n int) []byte {
	b := make([]byte, n)
	copy(b, []byte("\x89PNG\r\n\x1a\n"))
	copy(b[8:], []byte("IHDR"))
	return b
}
func gifBytes() []byte { return []byte("GIF89a" + strings.Repeat("x", 40)) }

func withTempAvatarDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old := avatarDirFunc
	avatarDirFunc = func() (string, error) { return dir, nil }
	t.Cleanup(func() { avatarDirFunc = old })
	return dir
}

func TestSaveAvatarValidatesAndDedupes(t *testing.T) {
	dir := withTempAvatarDir(t)
	url, err := SaveAvatar("a.png", "image/png", pngBytes(64))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(url, "/avatars/") || !strings.HasSuffix(url, ".png") {
		t.Fatalf("url=%q", url)
	}
	name := filepath.Base(url)
	if _, err = os.Stat(filepath.Join(dir, name)); err != nil {
		t.Fatalf("文件未落盘：%v", err)
	}
	// 同一张图重复上传不产生新文件。
	again, err := SaveAvatar("copy.png", "image/png", pngBytes(64))
	if err != nil || again != url {
		t.Fatalf("dedupe failed: %q %v", again, err)
	}
	// GIF 保留原扩展名。
	gif, err := SaveAvatar("a.gif", "image/gif", gifBytes())
	if err != nil || !strings.HasSuffix(gif, ".gif") {
		t.Fatalf("gif: %q %v", gif, err)
	}
}

func TestSaveAvatarRejectsBadInput(t *testing.T) {
	withTempAvatarDir(t)
	if _, err := SaveAvatar("x.txt", "text/plain", []byte("hello world")); err == nil {
		t.Fatal("非图片应被拒")
	}
	if _, err := SaveAvatar("big.png", "image/png", pngBytes(maxAvatarBytes+1)); err == nil {
		t.Fatal("超过 8MB 应被拒")
	}
}

func TestAvatarHandlerServesAndRejectsTraversal(t *testing.T) {
	withTempAvatarDir(t)
	url, err := SaveAvatar("a.png", "image/png", pngBytes(32))
	if err != nil {
		t.Fatal(err)
	}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	h := AvatarHandler(inner)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", url, nil))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("serve avatar: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Fatalf("cache header: %q", cc)
	}
	for _, bad := range []string{"/avatars/../data.db", "/avatars/%2e%2e/secret", "/avatars/sub/x.png", "/avatars/"} {
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", bad, nil))
		if rec.Code != 404 {
			t.Fatalf("%s 应 404，得到 %d", bad, rec.Code)
		}
	}
	// 非 /avatars/* 的请求交给 inner。
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/index.html", nil))
	if rec.Code != 204 {
		t.Fatalf("inner not called: %d", rec.Code)
	}
}
