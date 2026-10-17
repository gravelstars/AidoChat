package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"ai-group-chat/internal/store"
)

// maxAvatarBytes 是头像图片大小上限（8MB）。
const maxAvatarBytes = 8 << 20

// avatarDirFunc 便于测试指向临时目录；生产固定为应用数据目录下的 avatars/。
var avatarDirFunc = defaultAvatarDir

// AvatarDir 返回头像图片的存放目录。
func AvatarDir() (string, error) { return avatarDirFunc() }

func defaultAvatarDir() (string, error) {
	p, err := store.DefaultPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(p), "avatars"), nil
}

// sniffExt 按文件头判断真实类型，返回扩展名（含点）；不支持时返回空。
func sniffExt(data []byte) string {
	switch {
	case len(data) >= 8 && string(data[0:8]) == "\x89PNG\r\n\x1a\n":
		return ".png"
	case len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return ".jpg"
	case len(data) >= 6 && (string(data[0:6]) == "GIF87a" || string(data[0:6]) == "GIF89a"):
		return ".gif"
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return ".webp"
	}
	return ""
}

func mimeByExt(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	}
	return "application/octet-stream"
}

// SaveAvatar 校验并原样保存图片，按内容哈希去重，返回 /avatars/<文件名>。
func SaveAvatar(name, mime string, data []byte) (string, error) {
	dir, err := AvatarDir()
	if err != nil {
		return "", err
	}
	return saveAvatarAt(dir, name, mime, data)
}
func saveAvatarAt(dir, name, mime string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("图片为空")
	}
	if len(data) > maxAvatarBytes {
		return "", errors.New("图片不能超过 8MB")
	}
	// 文件头优先；MIME 若提供则需与之一致，避免扩展名与内容不符。
	ext := sniffExt(data)
	if ext == "" {
		return "", errors.New("只支持 PNG、JPG、GIF、WebP")
	}
	if mime != "" && !strings.HasPrefix(mime, "image/") {
		return "", errors.New("只支持图片文件")
	}
	sum := sha256.Sum256(data)
	file := hex.EncodeToString(sum[:8]) + ext // 内容 SHA-256 前 16 位 + 扩展名
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("创建头像目录失败：%w", err)
	}
	path := filepath.Join(dir, file)
	if _, statErr := os.Stat(path); statErr == nil {
		return "/avatars/" + file, nil // 同一张图重复上传不产生新文件
	}
	// 同内容上传可能并发到达；每次写入独占临时文件，避免互相截断或改名后丢失。
	tmp, err := os.CreateTemp(dir, ".avatar-*")
	if err != nil {
		return "", fmt.Errorf("保存头像失败：%w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("保存头像失败：%w", err)
	}
	if err = tmp.Close(); err != nil {
		return "", fmt.Errorf("保存头像失败：%w", err)
	}
	if err = os.Rename(tmp.Name(), path); err != nil {
		// Windows 正在读取既有头像时可能拒绝替换；另一上传已落盘即视为去重成功。
		if st, statErr := os.Stat(path); statErr == nil && !st.IsDir() {
			return "/avatars/" + file, nil
		}
		return "", fmt.Errorf("保存头像失败：%w", err)
	}
	_ = name
	return "/avatars/" + file, nil
}

// AvatarHandler 让 /avatars/<文件> 从磁盘读取，其余请求交给 inner（嵌入的前端资源）。
// 文件名即内容哈希，可永久缓存；拒绝路径穿越。
func AvatarHandler(inner http.Handler) http.Handler {
	dir, _ := AvatarDir()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/avatars/") {
			inner.ServeHTTP(w, r)
			return
		}
		serveAvatar(w, r, dir)
	})
}

func serveAvatar(w http.ResponseWriter, r *http.Request, dir string) {
	name := strings.TrimPrefix(r.URL.Path, "/avatars/")
	// 只接受「哈希 + 单个扩展名」这一形态，杜绝 ../、子目录与绝对路径。
	if !isAvatarFile(name) || dir == "" {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(dir, name)
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mimeByExt(name))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, name, st.ModTime(), f)
}

// isAvatarFile 校验文件名形如 <32 位十六进制>.<png|jpg|gif|webp>。
func isAvatarFile(name string) bool {
	if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		return false
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	if len(base) != 16 {
		return false
	}
	if _, err := hex.DecodeString(base); err != nil {
		return false
	}
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return true
	}
	return false
}
