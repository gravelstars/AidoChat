package memory

import (
	"ai-group-chat/internal/domain"
	"strings"
	"testing"
)

func TestAttachmentSummaryBudgetIsContiguousAndSourcePreserving(t *testing.T) {
	history := []domain.Message{{ID: "first", Seq: 1, AuthorKind: domain.AuthorUser, Status: domain.StatusDone, Content: "hello"}, {ID: "second", Seq: 2, AuthorKind: domain.AuthorUser, Status: domain.StatusDone, Attachments: []domain.Attachment{{Kind: "document", Name: "long.md", Text: strings.Repeat("字", 20000)}}}}
	h := attachmentHistory(history)
	if history[1].Content != "" || !strings.Contains(h[1].Content, "消息 #2 文档附件：long.md") {
		t.Fatal("source mutation", h)
	}
	window, err := summaryWindow("test", domain.Group{}, nil, nil, h, 4000)
	if err != nil || len(window) != 1 || window[0].ID != "first" {
		t.Fatal(window, err)
	}
	if _, err = summaryWindow("test", domain.Group{}, nil, nil, h[1:], 4000); err == nil || !strings.Contains(err.Error(), "#2") {
		t.Fatal(err)
	}
}
