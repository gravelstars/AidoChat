package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sharePNG(t *testing.T, width, height int) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func shareFixture(t *testing.T) (*Service, string) {
	t.Helper()
	s, _ := fixture(t, nil)
	root := t.TempDir()
	s.SelectExportDirectory = func() (string, error) { return root, nil }
	return s, root
}

func beginShare(t *testing.T, s *Service, title string, pages int) string {
	t.Helper()
	session, err := s.BeginShareExport(context.Background(), BeginShareExportInput{Title: title, PageCount: pages})
	if err != nil {
		t.Fatal(err)
	}
	if session.Cancelled || session.SessionID == "" {
		t.Fatalf("unexpected session %+v", session)
	}
	return session.SessionID
}

func TestShareExportCommitAndNoOverwrite(t *testing.T) {
	s, root := shareFixture(t)
	ctx := context.Background()
	title := "测试/群:*"
	session := beginShare(t, s, title, 2)
	page := sharePNG(t, 1080, 20)
	if err := s.WriteShareExportPage(ctx, WriteShareExportPageInput{SessionID: session, Index: 1, PNGBase64: page}); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteShareExportPage(ctx, WriteShareExportPageInput{SessionID: session, Index: 1, PNGBase64: page}); err == nil {
		t.Fatal("重复页被接受")
	}
	if err := s.WriteShareExportPage(ctx, WriteShareExportPageInput{SessionID: session, Index: 2, PNGBase64: sharePNG(t, 1080, 30)}); err != nil {
		t.Fatal(err)
	}
	result, err := s.CommitShareExport(ctx, session)
	if err != nil {
		t.Fatal(err)
	}
	if result.Count != 2 || !strings.HasPrefix(result.FolderName, "测试群-") {
		t.Fatalf("unexpected result %+v", result)
	}
	folder := filepath.Join(root, result.FolderName)
	entries, err := os.ReadDir(folder)
	if err != nil || len(entries) != 2 {
		t.Fatalf("folder %v %v", entries, err)
	}
	for i, height := range []int{20, 30} {
		data, err := os.ReadFile(filepath.Join(folder, entries[i].Name()))
		if err != nil {
			t.Fatal(err)
		}
		cfg, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil || cfg.Width != 1080 || cfg.Height != height {
			t.Fatalf("page %d %+v %v", i, cfg, err)
		}
	}
	// 整组已原子发布，暂存目录不能残留。
	dots, _ := filepath.Glob(filepath.Join(root, ".*"))
	if len(dots) != 0 {
		t.Fatalf("staging remains: %v", dots)
	}
	if _, err = s.CommitShareExport(ctx, session); err == nil {
		t.Fatal("重复提交被接受")
	}

	second := beginShare(t, s, title, 1)
	if err = s.WriteShareExportPage(ctx, WriteShareExportPageInput{SessionID: second, Index: 1, PNGBase64: page}); err != nil {
		t.Fatal(err)
	}
	other, err := s.CommitShareExport(ctx, second)
	if err != nil {
		t.Fatal(err)
	}
	if other.FolderName == result.FolderName {
		t.Fatal("覆盖了已有导出目录")
	}
}

func TestShareExportValidatesPagesAndSessions(t *testing.T) {
	s, _ := shareFixture(t)
	ctx := context.Background()
	if _, err := s.BeginShareExport(ctx, BeginShareExportInput{Title: "x", PageCount: 0}); err == nil {
		t.Fatal("zero pages accepted")
	}
	if _, err := s.BeginShareExport(ctx, BeginShareExportInput{Title: "x", PageCount: 21}); err == nil {
		t.Fatal("21 pages accepted")
	}
	session := beginShare(t, s, "校验", 2)
	for _, tc := range []struct {
		name string
		in   WriteShareExportPageInput
	}{
		{"bad session", WriteShareExportPageInput{SessionID: "nope", Index: 1, PNGBase64: sharePNG(t, 1080, 4)}},
		{"index zero", WriteShareExportPageInput{SessionID: session, Index: 0, PNGBase64: sharePNG(t, 1080, 4)}},
		{"index out", WriteShareExportPageInput{SessionID: session, Index: 3, PNGBase64: sharePNG(t, 1080, 4)}},
		{"bad base64", WriteShareExportPageInput{SessionID: session, Index: 1, PNGBase64: "%%%"}},
		{"not png", WriteShareExportPageInput{SessionID: session, Index: 1, PNGBase64: base64.StdEncoding.EncodeToString([]byte("hello"))}},
		{"wrong width", WriteShareExportPageInput{SessionID: session, Index: 1, PNGBase64: sharePNG(t, 1079, 4)}},
	} {
		if err := s.WriteShareExportPage(ctx, tc.in); err == nil {
			t.Fatalf("%s accepted", tc.name)
		}
	}
	if _, err := s.CommitShareExport(ctx, session); err == nil {
		t.Fatal("incomplete commit accepted")
	}
	if err := s.CancelShareExport(ctx, session); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelShareExport(ctx, session); err != nil {
		t.Fatalf("cancel not idempotent: %v", err)
	}
}

func TestShareExportCancelAndPicker(t *testing.T) {
	s, root := shareFixture(t)
	s.SelectExportDirectory = func() (string, error) { return "", nil }
	cancelled, err := s.BeginShareExport(context.Background(), BeginShareExportInput{Title: "取消", PageCount: 1})
	if err != nil || !cancelled.Cancelled || cancelled.SessionID != "" {
		t.Fatalf("%+v %v", cancelled, err)
	}

	s.SelectExportDirectory = nil
	if _, err = s.BeginShareExport(context.Background(), BeginShareExportInput{Title: "无选择器", PageCount: 1}); err == nil {
		t.Fatal("missing picker accepted")
	}

	s.SelectExportDirectory = func() (string, error) { return root, nil }
	session := beginShare(t, s, "取消", 1)
	if err = s.WriteShareExportPage(context.Background(), WriteShareExportPageInput{SessionID: session, Index: 1, PNGBase64: sharePNG(t, 1080, 4)}); err != nil {
		t.Fatal(err)
	}
	if err = s.CancelShareExport(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	dots, _ := filepath.Glob(filepath.Join(root, ".*"))
	if len(dots) != 0 {
		t.Fatalf("staging remains: %v", dots)
	}
}

func TestShareExportExpiryAndCloseCleanup(t *testing.T) {
	s, root := shareFixture(t)
	session := beginShare(t, s, "过期", 1)
	s.lifecycle.Lock()
	s.shares[session].createdAt = time.Now().Add(-time.Hour)
	s.lifecycle.Unlock()
	if err := s.WriteShareExportPage(context.Background(), WriteShareExportPageInput{SessionID: session, Index: 1, PNGBase64: sharePNG(t, 1080, 4)}); err == nil {
		t.Fatal("expired session accepted")
	}
	dots, _ := filepath.Glob(filepath.Join(root, ".*"))
	if len(dots) != 0 {
		t.Fatalf("expired staging remains: %v", dots)
	}

	active := beginShare(t, s, "关闭", 1)
	CloseService(s)
	entries, _ := os.ReadDir(root)
	if len(entries) != 0 {
		t.Fatalf("close left files: %v", entries)
	}
	if err := s.CancelShareExport(context.Background(), active); err != nil {
		t.Fatalf("cancel after close should be safe: %v", err)
	}
}
