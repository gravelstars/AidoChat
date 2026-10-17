package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/store"
	"github.com/oklog/ulid/v2"
)

type ImportAttachmentInput struct {
	GroupID   string `json:"groupId"`
	Name      string `json:"name"`
	MIME      string `json:"mime"`
	Base64    string `json:"base64"`
	Text      string `json:"text"`
	PageCount int    `json:"pageCount"`
}

func (s *Service) attachmentDir() string {
	return filepath.Join(filepath.Dir(s.db.Path()), "attachments")
}
func attachmentID(id string) bool { _, err := ulid.ParseStrict(id); return err == nil && len(id) == 26 }
func validAttachmentName(name string) bool {
	return name != "" && utf8.RuneCountInString(name) <= 255 && name == filepath.Base(name) && !strings.ContainsAny(name, "/\\") && !strings.ContainsFunc(name, unicode.IsControl) && name != "." && name != ".."
}

func validateAttachment(in ImportAttachmentInput) (domain.Attachment, []byte, error) {
	a := domain.Attachment{Name: in.Name}
	if !validAttachmentName(in.Name) {
		return a, nil, errors.New("附件名称无效，请使用不含路径的文件名")
	}
	if len(in.Base64) > base64.StdEncoding.EncodedLen(domain.MaxDocumentBytes) {
		return a, nil, errors.New("附件不能超过 20 MiB（图片 10 MiB）")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(in.Base64)
	if err != nil || len(data) == 0 {
		return a, nil, errors.New("附件数据无效或为空，请重新添加")
	}
	a.Size = int64(len(data))
	a.Kind = "image"
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")), bytes.HasPrefix(data, []byte{255, 216, 255}):
		cfg, format, e := image.DecodeConfig(bytes.NewReader(data))
		if e != nil {
			return a, nil, errors.New("图片损坏，无法读取尺寸")
		}
		a.Width, a.Height = cfg.Width, cfg.Height
		a.MIME = "image/" + format
		if err = checkImage(a); err != nil {
			return a, nil, err
		}
		if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
			return a, nil, errors.New("图片损坏，无法完整读取")
		}
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		a.MIME = "image/webp"
		a.Width, a.Height, err = webpDimensions(data)
		if err != nil {
			return a, nil, err
		}
		if err = checkImage(a); err != nil {
			return a, nil, err
		}
	default:
		a.Kind = "document"
		ext := strings.ToLower(filepath.Ext(in.Name))
		if len(data) > domain.MaxDocumentBytes {
			return a, nil, errors.New("文档不能超过 20 MiB")
		}
		switch ext {
		case ".txt", ".md", ".markdown":
			if !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
				return a, nil, errors.New("文本文件须为 UTF-8 编码，不能包含二进制内容")
			}
			a.MIME = "text/plain"
			if ext == ".md" || ext == ".markdown" {
				a.MIME = "text/markdown"
			}
			a.Text = string(bytes.TrimPrefix(data, []byte{239, 187, 191}))
			a.PageCount = 0
		case ".pdf":
			if !bytes.HasPrefix(data, []byte("%PDF-")) || !bytes.Contains(data[max(0, len(data)-1024):], []byte("%%EOF")) {
				return a, nil, errors.New("PDF 文件损坏或格式无效")
			}
			a.MIME = "application/pdf"
			a.Text = in.Text
			a.PageCount = in.PageCount
			if a.PageCount < 1 || a.PageCount > domain.MaxPDFPages {
				return a, nil, errors.New("PDF 最多 100 页，请拆分后重新添加")
			}
		default:
			return a, nil, errors.New("只支持 PNG、JPEG、WebP 图片及 TXT、Markdown、PDF 文档")
		}
		if strings.TrimSpace(a.Text) == "" {
			return a, nil, errors.New("文档未提取到文字；扫描版 PDF 暂不支持 OCR")
		}
		if !utf8.ValidString(a.Text) || strings.ContainsFunc(a.Text, func(r rune) bool { return unicode.IsControl(r) && r != '\t' && r != '\n' && r != '\r' }) {
			return a, nil, errors.New("文档包含无效控制字符，请使用 UTF-8 文本")
		}
		if utf8.RuneCountInString(a.Text) > domain.MaxDocumentRunes {
			return a, nil, errors.New("文档文字不能超过 100000 字符，请拆分后重新添加")
		}
	}
	return a, data, nil
}
func checkImage(a domain.Attachment) error {
	if a.Size > domain.MaxImageBytes {
		return errors.New("图片不能超过 10 MiB")
	}
	if a.Width <= 0 || a.Height <= 0 || int64(a.Width)*int64(a.Height) > domain.MaxImagePixels {
		return errors.New("图片不能超过 4000 万像素，请缩小后重新添加")
	}
	return nil
}

// webpDimensions 检查 RIFF 完整边界、VP8/L 位流头和扩展画布，不信任文件后缀。
func webpDimensions(data []byte) (int, int, error) {
	bad := errors.New("WebP 图片损坏，无法读取完整尺寸")
	if len(data) < 20 || uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
		return 0, 0, bad
	}
	w, h, cw, ch := 0, 0, 0, 0
	imageSeen := false
	for off := 12; off < len(data); {
		if len(data)-off < 8 {
			return 0, 0, bad
		}
		size := uint64(binary.LittleEndian.Uint32(data[off+4 : off+8]))
		end := uint64(off) + 8 + size
		if end > uint64(len(data)) {
			return 0, 0, bad
		}
		chunk := data[off+8 : int(end)]
		kind := string(data[off : off+4])
		switch kind {
		case "VP8X":
			if len(chunk) != 10 {
				return 0, 0, bad
			}
			if chunk[0]&2 != 0 {
				return 0, 0, errors.New("聊天附件暂不支持动态 WebP，请转换为静态图片")
			}
			cw = 1 + int(chunk[4]) + (int(chunk[5]) << 8) + (int(chunk[6]) << 16)
			ch = 1 + int(chunk[7]) + (int(chunk[8]) << 8) + (int(chunk[9]) << 16)
		case "VP8 ":
			if imageSeen || len(chunk) < 10 || chunk[0]&1 != 0 || !bytes.Equal(chunk[3:6], []byte{157, 1, 42}) {
				return 0, 0, bad
			}
			w = int(binary.LittleEndian.Uint16(chunk[6:8]) & 0x3fff)
			h = int(binary.LittleEndian.Uint16(chunk[8:10]) & 0x3fff)
			imageSeen = true
		case "VP8L":
			if imageSeen || len(chunk) < 5 || chunk[0] != 47 || chunk[4]>>5 != 0 {
				return 0, 0, bad
			}
			bits := binary.LittleEndian.Uint32(chunk[1:5])
			w = int(bits&0x3fff) + 1
			h = int((bits>>14)&0x3fff) + 1
			imageSeen = true
		}
		off = int(end + (size & 1))
		if off > len(data) {
			return 0, 0, bad
		}
	}
	if !imageSeen || w < 1 || h < 1 || (cw > 0 && (cw != w || ch != h)) {
		return 0, 0, bad
	}
	return w, h, nil
}
func (s *Service) ImportAttachment(ctx context.Context, in ImportAttachmentInput) (domain.Attachment, error) {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return domain.Attachment{}, errors.New("应用正在关闭")
	}
	g, err := s.db.Group(ctx, in.GroupID)
	if err != nil {
		return domain.Attachment{}, friendly(err, "读取附件所属群")
	}
	if g.ArchivedAt != nil {
		return domain.Attachment{}, errors.New("请先取消归档再添加附件")
	}
	draftIDs, err := s.db.AttachmentIDs(ctx, in.GroupID, true)
	if err != nil {
		return domain.Attachment{}, friendly(err, "读取草稿附件")
	}
	if len(draftIDs) >= domain.MaxAttachments {
		return domain.Attachment{}, errors.New("每条消息最多 4 份附件，请先移除已有草稿")
	}
	a, data, err := validateAttachment(in)
	if err != nil {
		return a, err
	}
	a.ID = store.NewID()
	a.URL = "/attachments/" + a.ID
	dir := s.attachmentDir()
	if err = os.MkdirAll(dir, 0700); err != nil {
		return domain.Attachment{}, errors.New("无法创建本地附件目录")
	}
	path := filepath.Join(dir, a.ID)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return domain.Attachment{}, errors.New("无法保存本地附件")
	}
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil || closeErr != nil {
		os.Remove(path)
		return domain.Attachment{}, errors.New("无法完整保存本地附件")
	}
	if err = s.db.SaveDraftAttachment(ctx, g.ID, a); err != nil {
		os.Remove(path)
		return domain.Attachment{}, friendly(err, "保存附件")
	}
	return a, nil
}
func (s *Service) ReadAttachment(ctx context.Context, id string) (domain.Attachment, error) {
	if !attachmentID(id) {
		return domain.Attachment{}, errors.New("附件 ID 无效")
	}
	a, err := s.db.Attachment(ctx, id)
	if err != nil {
		return a, friendly(err, "读取附件")
	}
	st, err := os.Stat(filepath.Join(s.attachmentDir(), id))
	if err != nil || !st.Mode().IsRegular() {
		return a, errors.New("本地附件文件缺失，请重新添加原文件")
	}
	return a, nil
}
func (s *Service) RemoveDraftAttachment(ctx context.Context, id string) error {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if !attachmentID(id) {
		return errors.New("附件 ID 无效")
	}
	if err := s.db.RemoveDraftAttachment(ctx, id); err != nil {
		return friendly(err, "移除草稿附件")
	}
	if err := os.Remove(filepath.Join(s.attachmentDir(), id)); err != nil && !os.IsNotExist(err) {
		return errors.New("附件记录已移除，文件将在下次启动时清理")
	}
	return nil
}
func (s *Service) cleanupDraftAttachments() {
	ids, err := s.db.AttachmentIDs(context.Background(), "", true)
	if err != nil {
		return
	}
	for _, id := range ids {
		if s.db.RemoveDraftAttachment(context.Background(), id) == nil {
			_ = os.Remove(filepath.Join(s.attachmentDir(), id))
		}
	}
	// 回收异常退出发生在写文件与落元数据之间的孤儿文件；保留任何有记录的附件。
	entries, _ := os.ReadDir(s.attachmentDir())
	for _, e := range entries {
		if !e.IsDir() && attachmentID(e.Name()) {
			if _, err = s.db.Attachment(context.Background(), e.Name()); errors.Is(err, sql.ErrNoRows) {
				_ = os.Remove(filepath.Join(s.attachmentDir(), e.Name()))
			}
		}
	}
}
func (s *Service) loadImage(ctx context.Context, id string) (llm.Image, error) {
	a, err := s.ReadAttachment(ctx, id)
	if err != nil {
		return llm.Image{}, err
	}
	if a.Kind != "image" {
		return llm.Image{}, errors.New("附件不是图片")
	}
	data, err := os.ReadFile(filepath.Join(s.attachmentDir(), id))
	if err != nil {
		return llm.Image{}, errors.New("本地图片缺失，请重新添加附件")
	}
	if len(data) > domain.MaxImageBytes {
		return llm.Image{}, errors.New("本地图片超过上限")
	}
	return llm.Image{ID: id, MIME: a.MIME, Width: a.Width, Height: a.Height, Base64: base64.StdEncoding.EncodeToString(data)}, nil
}
func ResourceHandler(s *Service, inner http.Handler) http.Handler {
	avatarDir := filepath.Join(filepath.Dir(s.db.Path()), "avatars")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/avatars/") {
			serveAvatar(w, r, avatarDir)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/attachments/") {
			inner.ServeHTTP(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		id := strings.TrimPrefix(r.URL.Path, "/attachments/")
		if !attachmentID(id) || (r.Method != "GET" && r.Method != "HEAD") {
			http.NotFound(w, r)
			return
		}
		a, err := s.db.Attachment(r.Context(), id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(filepath.Join(s.attachmentDir(), id))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil || !st.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", a.MIME)
		if a.Kind != "image" {
			w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": a.Name}))
		}
		http.ServeContent(w, r, a.Name, st.ModTime(), f)
	})
}
