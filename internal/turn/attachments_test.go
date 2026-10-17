package turn

import (
	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestAttachmentPreflightIsAtomic(t *testing.T) {
	o, s, _, _ := setup(domain.ModeSerial)
	a := []domain.Attachment{{ID: "img", Kind: "image", MIME: "image/png", Width: 10, Height: 10}}
	if _, err := o.Send(context.Background(), "g", "@墨白 @青砚 看图", nil, a); err == nil || !strings.Contains(err.Error(), "墨白") {
		t.Fatal(err)
	}
	if len(s.messages) != 0 {
		t.Fatal("partial round")
	}
	m := s.members["mo"]
	m.SupportsImages = true
	s.members["mo"] = m
	if _, err := o.Send(context.Background(), "g", "@墨白 @青砚 看图", nil, a); err == nil || !strings.Contains(err.Error(), "青砚") {
		t.Fatal(err)
	}
	if len(s.messages) != 0 {
		t.Fatal("partial round")
	}
	if res, err := o.Send(context.Background(), "g", "", nil, a); err != nil || len(res.Order) != 0 || len(res.UserMessage.Attachments) != 1 {
		t.Fatal(res, err)
	}
}
func TestAttachmentRequiredBudgetRejectsBeforePersistence(t *testing.T) {
	o, s, _, _ := setup(domain.ModeSerial)
	a := []domain.Attachment{{Kind: "document", Text: strings.Repeat("字", 20000)}}
	if _, err := o.Send(context.Background(), "g", "@墨白 阅读", nil, a); err == nil || !strings.Contains(err.Error(), "预算") {
		t.Fatal(err)
	}
	if len(s.messages) != 0 {
		t.Fatal("persisted oversize")
	}
}
func TestAttachmentsSelectedImagesAndRetryIdentity(t *testing.T) {
	for _, mode := range []domain.ReplyMode{domain.ModeSerial, domain.ModeParallel} {
		t.Run(string(mode), func(t *testing.T) {
			o, s, f, events := setup(mode)
			for id, m := range s.members {
				m.SupportsImages = true
				s.members[id] = m
			}
			var mu sync.Mutex
			loaded := []string{}
			o.LoadImage = func(_ context.Context, id string) (llm.Image, error) {
				mu.Lock()
				loaded = append(loaded, id)
				mu.Unlock()
				return llm.Image{ID: id, MIME: "image/png", Base64: "YWJj"}, nil
			}
			f.reply["qy"] = func(_ context.Context, d func(string)) error { d("第二位"); return nil }
			f.reply["mo"] = func(context.Context, func(string)) error { return errors.New("once") }
			a := []domain.Attachment{{ID: "image", Kind: "image", MIME: "image/png", Width: 50, Height: 50}, {ID: "doc", Name: "n.pdf", Kind: "document", Text: "第 1 页\nsource"}}
			res, err := o.Send(context.Background(), "g", "@墨白 @青砚 阅读", nil, a)
			if err != nil {
				t.Fatal(err)
			}
			waitEnd(t, events)
			var failed domain.Message
			s.mu.Lock()
			for _, m := range s.messages {
				if m.AuthorID == "mo" {
					failed = m
				}
			}
			s.mu.Unlock()
			if failed.Status != domain.StatusError {
				t.Fatal(failed)
			}
			f.mu.Lock()
			req := f.reqs["qy"]
			f.mu.Unlock()
			if len(req.Messages[0].Images) != 1 || req.Messages[0].Images[0].Base64 != "YWJj" || !strings.Contains(req.Messages[0].Content, "消息 #1 文档附件") {
				t.Fatal(req)
			}
			if err = o.Retry(context.Background(), failed.ID); err != nil {
				t.Fatal(err)
			}
			waitEnd(t, events)
			original, _ := s.Message(context.Background(), res.UserMessage.ID)
			if original.Attachments[0].ID != "image" {
				t.Fatal(original)
			}
			mu.Lock()
			if len(loaded) != 3 {
				t.Fatal(loaded)
			}
			mu.Unlock()
		})
	}
}

func TestAttachmentLoadsOnlyImagesKeptByBudget(t *testing.T) {
	o, s, f, events := setup(domain.ModeSerial)
	m := s.members["mo"]
	m.SupportsImages = true
	s.members["mo"] = m
	s.messages = []domain.Message{{ID: "old", GroupID: "g", Seq: 1, AuthorKind: domain.AuthorUser, Status: domain.StatusDone, TurnID: "earlier", Attachments: []domain.Attachment{{ID: "do-not-load", Kind: "image", Width: 8000, Height: 5000}}}}
	f.reply["mo"] = func(_ context.Context, d func(string)) error { d("ok"); return nil }
	loaded := make(chan string, 4)
	o.LoadImage = func(_ context.Context, id string) (llm.Image, error) {
		loaded <- id
		return llm.Image{ID: id, MIME: "image/png", Base64: "YWJj"}, nil
	}
	if _, err := o.Send(context.Background(), "g", "@墨白 看当前图", nil, []domain.Attachment{{ID: "current", Kind: "image", MIME: "image/png", Width: 2, Height: 2}}); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	close(loaded)
	ids := []string{}
	for id := range loaded {
		ids = append(ids, id)
	}
	if len(ids) != 1 || ids[0] != "current" {
		t.Fatal(ids)
	}
}
