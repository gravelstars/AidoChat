package contextbuilder

import (
	"ai-group-chat/internal/domain"
	"strings"
	"testing"
)

func TestAttachmentBudgetWindowAndTextSources(t *testing.T) {
	f := newFixture()
	old := f.add(domain.AuthorUser, "user", "older", "old", domain.StatusDone)
	f.history[0].Attachments = []domain.Attachment{{ID: "old", Kind: "image", Width: 4000, Height: 4000}}
	user := f.add(domain.AuthorUser, "user", "now", "new", domain.StatusDone)
	f.history[1].Attachments = []domain.Attachment{{ID: "new", Kind: "image", Width: 100, Height: 100}, {ID: "doc", Name: "notes.pdf", Kind: "document", Text: "[第 1 页]\nhello"}}
	user = f.history[1]
	self := f.members["mo"]
	self.SupportsImages = true
	in := Input{Group: f.group, Members: f.members, Self: self, History: f.history, Turn: Turn{UserMessage: user, Order: []string{"mo"}}, Budget: 2000}
	out := Build(in)
	if out.Dropped != 1 {
		t.Fatalf("old %s not dropped: %+v", old.ID, out)
	}
	if len(out.Request.Messages[0].Images) != 1 || out.Request.Messages[0].Images[0].ID != "new" {
		t.Fatal(out.Request.Messages)
	}
	if !strings.Contains(out.Request.Messages[0].Content, "消息 #2 文档附件：notes.pdf") || !strings.Contains(out.Request.Messages[0].Content, "第 1 页") {
		t.Fatal(out.Request.Messages)
	}
	in.Self.SupportsImages = false
	out = Build(in)
	if len(out.Request.Messages[0].Images) != 0 || !strings.Contains(out.Request.Messages[0].Content, "该模型未收到图片") {
		t.Fatal(out)
	}
}
