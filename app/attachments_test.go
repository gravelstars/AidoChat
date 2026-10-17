package app

import (
	"ai-group-chat/internal/domain"
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentImportHandlerAndCleanup(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	g, err := s.CreateGroup(context.Background(), CreateGroupInput{Title: "附件", DefaultMode: domain.ModeSerial, MemberIDs: []string{"a"}})
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 3)))
	in := ImportAttachmentInput{GroupID: g.ID, Name: "image.png", MIME: "image/png", Base64: base64.StdEncoding.EncodeToString(b.Bytes())}
	a, err := s.ImportAttachment(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if a.Width != 4 || a.Height != 3 || strings.Contains(a.URL, db.Path()) {
		t.Fatal(a)
	}
	h := ResourceHandler(s, http.NotFoundHandler())
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", a.URL, nil))
	if r.Code != 200 || r.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal(r.Code, r.Header())
	}
	for _, path := range []string{"/attachments/../../data.db", "/attachments/evil", "/attachments/"} {
		r = httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code == 200 {
			t.Fatal(path)
		}
	}
	in.Name = "../evil.png"
	if _, err = s.ImportAttachment(context.Background(), in); err == nil {
		t.Fatal("path accepted")
	}
	in.Name = "wrong.png"
	in.Base64 = "%%%"
	if _, err = s.ImportAttachment(context.Background(), in); err == nil {
		t.Fatal("base64 accepted")
	}
	if err = s.RemoveDraftAttachment(context.Background(), a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(db.Path()), "attachments", a.ID)); !os.IsNotExist(err) {
		t.Fatal("draft remains", err)
	}
}
func TestAttachmentPreflightErrorIsUserFacing(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "视觉", DefaultMode: domain.ModeSerial, MemberIDs: []string{"a"}})
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 3)))
	a, err := s.ImportAttachment(ctx, ImportAttachmentInput{GroupID: g.ID, Name: "image.png", MIME: "image/png", Base64: base64.StdEncoding.EncodeToString(b.Bytes())})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.SendWithAttachments(ctx, g.ID, "@青砚 看图", nil, []string{a.ID})
	if err == nil || !strings.Contains(err.Error(), "青砚") || !strings.Contains(err.Error(), "图片") {
		t.Fatalf("能力校验被通用文案覆盖：%v", err)
	}
	// 预检失败不能落库，也不能消耗草稿，用户改完能力后可直接重发。
	if _, err = s.ReadAttachment(ctx, a.ID); err != nil {
		t.Fatal("草稿被消耗", err)
	}
	detail, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Messages) != 0 {
		t.Fatalf("预检失败仍写入消息：%+v", detail.Messages)
	}
}

func TestAttachmentDocumentValidationAndBinding(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "文档", DefaultMode: domain.ModeSerial, MemberIDs: []string{"a"}})
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.ImportAttachment(ctx, ImportAttachmentInput{GroupID: g.ID, Name: "notes.md", MIME: "text/markdown", Base64: base64.StdEncoding.EncodeToString([]byte("你好")), Text: "forged"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Text != "你好" {
		t.Fatal(a.Text)
	}
	if _, err = s.SendWithAttachments(ctx, g.ID, "", nil, []string{a.ID}); err != nil {
		t.Fatal(err)
	}
	summary, err := s.summary(ctx, domain.Group{ID: g.ID})
	if err != nil || summary.LastMessage == nil || !strings.Contains(summary.LastMessage.Preview, "notes.md") {
		t.Fatal(summary, err)
	}
	if err = s.RemoveDraftAttachment(ctx, a.ID); err == nil {
		t.Fatal("sent draft removed")
	}
	r := httptest.NewRecorder()
	ResourceHandler(s, http.NotFoundHandler()).ServeHTTP(r, httptest.NewRequest("GET", a.URL, nil))
	if !strings.HasPrefix(r.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal(r.Header())
	}
	if err = s.DeleteGroup(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(db.Path()), "attachments", a.ID)); !os.IsNotExist(err) {
		t.Fatal(err)
	}
	_, err = s.ImportAttachment(ctx, ImportAttachmentInput{GroupID: g.ID, Name: "n.txt", Base64: base64.StdEncoding.EncodeToString([]byte("a"))})
	if err == nil {
		t.Fatal("missing group")
	}
	_ = domain.MaxAttachments
}
func TestAvatarCustomDBIsolation(t *testing.T) {
	s, db := fixture(t, nil)
	var b bytes.Buffer
	png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	url, err := s.UploadAvatar(context.Background(), "p.png", "image/png", b.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(db.Path()), url)); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRecorder()
	ResourceHandler(s, http.NotFoundHandler()).ServeHTTP(r, httptest.NewRequest("GET", url, nil))
	if r.Code != 200 {
		t.Fatal(r.Code)
	}
}

func TestAttachmentFormatAndLimits(t *testing.T) {
	encoded := func(data []byte) string { return base64.StdEncoding.EncodeToString(data) }
	for _, tc := range []struct {
		name string
		in   ImportAttachmentInput
	}{
		{"binary text", ImportAttachmentInput{Name: "a.txt", Base64: encoded([]byte{0, 1, 2})}},
		{"text controls", ImportAttachmentInput{Name: "a.md", Base64: encoded([]byte("abc\a"))}},
		{"text long", ImportAttachmentInput{Name: "a.markdown", Base64: encoded([]byte(strings.Repeat("字", domain.MaxDocumentRunes+1)))}},
		{"unknown", ImportAttachmentInput{Name: "a.exe", Base64: encoded([]byte("hello"))}},
		{"pdf corrupt", ImportAttachmentInput{Name: "a.pdf", Base64: encoded([]byte("hello")), Text: "abc", PageCount: 1}},
		{"pdf empty", ImportAttachmentInput{Name: "a.pdf", Base64: encoded([]byte("%PDF-1.4\n%%EOF")), PageCount: 1}},
		{"pdf pages", ImportAttachmentInput{Name: "a.pdf", Base64: encoded([]byte("%PDF-1.4\n%%EOF")), Text: "a", PageCount: 101}},
		{"document size", ImportAttachmentInput{Name: "a.txt", Base64: encoded(bytes.Repeat([]byte("a"), domain.MaxDocumentBytes+1))}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := validateAttachment(tc.in); err == nil {
				t.Fatal("accepted")
			}
		})
	}
	a, _, err := validateAttachment(ImportAttachmentInput{Name: "n.markdown", Base64: encoded([]byte("正文"))})
	if err != nil || a.MIME != "text/markdown" {
		t.Fatal(a, err)
	}
	if _, _, err = validateAttachment(ImportAttachmentInput{Name: "n.pdf", Base64: encoded([]byte("%PDF-1.4\nstream\n(/Encrypt)\nendstream\n%%EOF")), Text: "第 1 页\n/Encrypt", PageCount: 1}); err != nil {
		t.Fatal("ordinary text must not imply encryption", err)
	}
	if checkImage(domain.Attachment{Width: 8000, Height: 5001}) == nil || checkImage(domain.Attachment{Width: 1, Height: 1, Size: domain.MaxImageBytes + 1}) == nil {
		t.Fatal("image limit")
	}
	webp, err := base64.StdEncoding.DecodeString("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
	if err != nil {
		t.Fatal(err)
	}
	w, h, err := webpDimensions(webp)
	if err != nil || w != 1 || h != 1 {
		t.Fatal(w, h, err)
	}
	if _, _, err = webpDimensions(webp[:len(webp)-1]); err == nil {
		t.Fatal("truncated RIFF")
	}
}
func TestAttachmentStartupCleanupKeepsBoundFiles(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "clean", MemberIDs: []string{"a"}, DefaultMode: domain.ModeSerial})
	if err != nil {
		t.Fatal(err)
	}
	in := ImportAttachmentInput{GroupID: g.ID, Name: "n.txt", Base64: base64.StdEncoding.EncodeToString([]byte("n"))}
	bound, err := s.ImportAttachment(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SendWithAttachments(ctx, g.ID, "", nil, []string{bound.ID}); err != nil {
		t.Fatal(err)
	}
	draft, err := s.ImportAttachment(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	// 第二次构造服务模拟异常退出后的重启，旧服务此时没有活动轮次。
	restarted := NewService(db, nil, "mac", nil)
	defer CloseService(restarted)
	if _, err = restarted.ReadAttachment(ctx, draft.ID); err == nil {
		t.Fatal("stale draft retained")
	}
	if _, err = restarted.ReadAttachment(ctx, bound.ID); err != nil {
		t.Fatal("bound removed", err)
	}
	if _, err = os.Stat(filepath.Join(s.attachmentDir(), bound.ID)); err != nil {
		t.Fatal(err)
	}
}

func TestAttachmentMissingSourceIsReported(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "missing", DefaultMode: domain.ModeSerial, MemberIDs: []string{"a"}})
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.ImportAttachment(ctx, ImportAttachmentInput{GroupID: g.ID, Name: "n.txt", Base64: base64.StdEncoding.EncodeToString([]byte("n"))})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(s.attachmentDir(), a.ID)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadAttachment(ctx, a.ID); err == nil || !strings.Contains(err.Error(), "缺失") {
		t.Fatal(err)
	}
}
