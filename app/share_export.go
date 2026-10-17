package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"ai-group-chat/internal/store"
)

const (
	maxSharePages     = 20
	maxSharePageBytes = 8 << 20
	shareSessionTTL   = 30 * time.Minute
)

type BeginShareExportInput struct {
	Title     string `json:"title"`
	PageCount int    `json:"pageCount"`
}
type ShareExportSession struct {
	SessionID string `json:"sessionId"`
	Cancelled bool   `json:"cancelled"`
}
type WriteShareExportPageInput struct {
	SessionID string `json:"sessionId"`
	Index     int    `json:"index"`
	PNGBase64 string `json:"pngBase64"`
}
type CommitShareExportResult struct {
	Count      int    `json:"count"`
	FolderName string `json:"folderName"`
}

type shareExport struct {
	root      string
	staging   string
	title     string
	pages     int
	written   map[int]bool
	createdAt time.Time
}

// BeginShareExport 由原生目录选择决定保存位置。目录为空表示用户取消，不创建任何文件。
func (s *Service) BeginShareExport(ctx context.Context, in BeginShareExportInput) (ShareExportSession, error) {
	if err := ctx.Err(); err != nil {
		return ShareExportSession{}, err
	}
	if in.PageCount < 1 || in.PageCount > maxSharePages {
		return ShareExportSession{}, fmt.Errorf("分享图片需要 1–%d 页", maxSharePages)
	}
	s.lifecycle.Lock()
	closed, selectDirectory := s.closed, s.SelectExportDirectory
	s.lifecycle.Unlock()
	if closed {
		return ShareExportSession{}, errors.New("应用正在关闭，请重新打开后导出")
	}
	if selectDirectory == nil {
		return ShareExportSession{}, errors.New("当前环境无法选择保存位置，请在桌面应用中使用")
	}
	root, err := selectDirectory()
	if err != nil {
		return ShareExportSession{}, fmt.Errorf("选择保存位置失败：%w", err)
	}
	if root == "" {
		return ShareExportSession{Cancelled: true}, nil
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return ShareExportSession{}, errors.New("保存位置不可用，请重新选择")
	}

	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return ShareExportSession{}, errors.New("应用正在关闭，请重新打开后导出")
	}
	s.cleanupExpiredSharesLocked(time.Now())
	if s.shares == nil {
		s.shares = map[string]*shareExport{}
	}
	id := store.NewID()
	staging := filepath.Join(root, "."+id)
	if err := os.Mkdir(staging, 0700); err != nil {
		return ShareExportSession{}, errors.New("无法在所选位置创建暂存目录，请检查权限后重试")
	}
	s.shares[id] = &shareExport{
		root: root, staging: staging, title: shareFolderTitle(in.Title),
		pages: in.PageCount, written: map[int]bool{}, createdAt: time.Now(),
	}
	return ShareExportSession{SessionID: id}, nil
}

// WriteShareExportPage 校验真实 PNG 与 1080 宽，按页序号写入暂存目录。
func (s *Service) WriteShareExportPage(ctx context.Context, in WriteShareExportPageInput) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return errors.New("应用正在关闭，请重新打开后导出")
	}
	sess, err := s.shareSessionLocked(in.SessionID)
	if err != nil {
		return err
	}
	if in.Index < 1 || in.Index > sess.pages {
		return fmt.Errorf("分享页序号必须在 1–%d 之间", sess.pages)
	}
	if sess.written[in.Index] {
		return errors.New("该页已经写入，请勿重复提交")
	}
	encoded := in.PNGBase64
	if encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxSharePageBytes) {
		return errors.New("单页 PNG 为空或超过 8 MiB")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(data) == 0 || len(data) > maxSharePageBytes {
		return errors.New("PNG 数据无效或超过 8 MiB")
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return errors.New("分享页不是有效 PNG")
	}
	if cfg.Width != 1080 || cfg.Height < 1 || cfg.Height > 10000 {
		return errors.New("分享页尺寸必须为 1080 宽，高 1–10000 像素")
	}
	path := filepath.Join(sess.staging, fmt.Sprintf("%02d.png", in.Index))
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("无法写入暂存图片，请检查保存位置权限")
	}
	_, writeErr := f.Write(data)
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		_ = os.Remove(path)
		return errors.New("写入暂存图片失败，请重试")
	}
	sess.written[in.Index] = true
	return nil
}

// CommitShareExport 要求所有页都已写入，再把整组图片原子发布到用户选择的目录。
func (s *Service) CommitShareExport(ctx context.Context, sessionID string) (CommitShareExportResult, error) {
	if err := ctx.Err(); err != nil {
		return CommitShareExportResult{}, err
	}
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return CommitShareExportResult{}, errors.New("应用正在关闭，请重新打开后导出")
	}
	sess, err := s.shareSessionLocked(sessionID)
	if err != nil {
		return CommitShareExportResult{}, err
	}
	if len(sess.written) != sess.pages {
		return CommitShareExportResult{}, errors.New("分享图片尚未生成完整，请等待所有页面完成后再保存")
	}
	for i := 1; i <= sess.pages; i++ {
		if !sess.written[i] {
			return CommitShareExportResult{}, errors.New("分享图片尚未生成完整，请等待所有页面完成后再保存")
		}
	}
	target, err := publishShareFolder(sess)
	if err != nil {
		s.discardShareLocked(sessionID)
		return CommitShareExportResult{}, err
	}
	delete(s.shares, sessionID)
	return CommitShareExportResult{Count: sess.pages, FolderName: filepath.Base(target)}, nil
}

// CancelShareExport 丢弃暂存目录。已经提交或取消过的任务按幂等处理。
func (s *Service) CancelShareExport(ctx context.Context, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	s.discardShareLocked(sessionID)
	return nil
}

func (s *Service) shareSessionLocked(id string) (*shareExport, error) {
	sess, ok := s.shares[id]
	if !ok {
		return nil, errors.New("分享任务不存在或已结束，请重新导出")
	}
	if time.Since(sess.createdAt) > shareSessionTTL {
		s.discardShareLocked(id)
		return nil, errors.New("分享任务已过期，请重新导出")
	}
	return sess, nil
}

func (s *Service) discardShareLocked(id string) {
	sess, ok := s.shares[id]
	if !ok {
		return
	}
	delete(s.shares, id)
	_ = os.RemoveAll(sess.staging)
}

func (s *Service) cleanupExpiredSharesLocked(now time.Time) {
	for id, sess := range s.shares {
		if now.Sub(sess.createdAt) > shareSessionTTL {
			s.discardShareLocked(id)
		}
	}
}

func (s *Service) cleanupSharesLocked() {
	for id := range s.shares {
		s.discardShareLocked(id)
	}
}

// publishShareFolder 生成不覆盖旧文件的目标名：群名-日期-短随机。
func publishShareFolder(sess *shareExport) (string, error) {
	base := fmt.Sprintf("%s-%s-%s", sess.title, time.Now().Format("2006-01-02"), store.NewID()[20:])
	for attempt := 0; attempt < 100; attempt++ {
		name := base
		if attempt > 0 {
			name = fmt.Sprintf("%s-%d", base, attempt+1)
		}
		target := filepath.Join(sess.root, name)
		if _, err := os.Lstat(target); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", errors.New("无法检查保存位置，请重新选择目录")
		}
		if err := os.Rename(sess.staging, target); err != nil {
			continue
		}
		return target, nil
	}
	return "", errors.New("无法发布分享图片，请换一个保存位置后重试")
}

// shareFolderTitle 去掉路径分隔符与控制字符，限制长度；空标题回退为「群聊」。
func shareFolderTitle(title string) string {
	title = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`/\:*?"<>|`, r) {
			return -1
		}
		return r
	}, title)
	title = strings.TrimSpace(title)
	runes := []rune(title)
	if len(runes) > 40 {
		runes = runes[:40]
	}
	if len(runes) == 0 {
		return "群聊"
	}
	return string(runes)
}
