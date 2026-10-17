package store

import (
	"ai-group-chat/internal/domain"
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func TestAttachmentBindingIsAtomicAndGroupScoped(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	a := domain.Attachment{ID: NewID(), Name: "notes.txt", MIME: "text/plain", Size: 3, Kind: "document", Text: "abc"}
	must(t, s.SaveDraftAttachment(ctx, "g", a))
	bad := domain.Message{GroupID: "g", AuthorKind: domain.AuthorUser, Status: domain.StatusDone, Attachments: []domain.Attachment{{ID: a.ID}, {ID: "missing"}}}
	if s.InsertMessage(ctx, &bad) == nil {
		t.Fatal("missing ID accepted")
	}
	if _, err := s.DraftAttachments(ctx, "g", []string{a.ID}); err != nil {
		t.Fatal("partial binding after failure", err)
	}
	good := domain.Message{GroupID: "g", AuthorKind: domain.AuthorUser, Status: domain.StatusDone, Attachments: []domain.Attachment{{ID: a.ID}}}
	must(t, s.InsertMessage(ctx, &good))
	got, err := s.Message(ctx, good.ID)
	must(t, err)
	if len(got.Attachments) != 1 || got.Attachments[0].Text != "abc" {
		t.Fatal(got)
	}
	if _, err = s.DraftAttachments(ctx, "g", []string{a.ID}); err == nil {
		t.Fatal("bound reused")
	}
	if err = s.RemoveDraftAttachment(ctx, a.ID); err == nil {
		t.Fatal("bound deleted")
	}
	var count int
	must(t, s.db.QueryRow("SELECT count(*) FROM pragma_foreign_key_check").Scan(&count))
	if count != 0 {
		t.Fatal(count)
	}
}
func TestAttachmentRejectsCrossGroupDuplicateAndLimit(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	a := domain.Attachment{ID: NewID(), Name: "n.txt", Kind: "document", Text: "abc"}
	must(t, s.SaveDraftAttachment(ctx, "g", a))
	for _, ids := range [][]string{{a.ID, a.ID}, {"missing"}, {"1", "2", "3", "4", "5"}} {
		if _, err := s.DraftAttachments(ctx, "g", ids); err == nil {
			t.Fatal("accepted", ids)
		}
	}
	if _, err := s.DraftAttachments(ctx, "other", []string{a.ID}); err == nil {
		t.Fatal("cross group")
	}
}

func TestAttachmentReopenAndMemberImages(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.db")
	s, err := Open(path)
	must(t, err)
	seed(t, s)
	m, err := s.Member(ctx, "mo")
	must(t, err)
	if m.SupportsImages {
		t.Fatal("old default")
	}
	m.SupportsImages = true
	must(t, s.SaveMember(ctx, &m))
	a := domain.Attachment{ID: NewID(), Name: "saved.txt", Kind: "document", Text: "正文"}
	must(t, s.SaveDraftAttachment(ctx, "g", a))
	msg := domain.Message{GroupID: "g", AuthorKind: domain.AuthorUser, Status: domain.StatusDone, Attachments: []domain.Attachment{{ID: a.ID}}}
	must(t, s.InsertMessage(ctx, &msg))
	must(t, s.Close())
	s, err = Open(path)
	must(t, err)
	defer s.Close()
	got, err := s.Message(ctx, msg.ID)
	must(t, err)
	if len(got.Attachments) != 1 || got.Attachments[0].ID != a.ID {
		t.Fatal(got)
	}
	m, err = s.Member(ctx, "mo")
	must(t, err)
	if !m.SupportsImages {
		t.Fatal("capability not persisted")
	}
}

func TestAttachmentMigrationPreservesVersionThreeData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v3.db")
	db, err := sql.Open("sqlite", databaseURI(path))
	must(t, err)
	for _, file := range []string{"001_init.sql", "002_reply_mode.sql", "003_provider_retirement.sql"} {
		body, err := migrations.ReadFile("migrations/" + file)
		must(t, err)
		_, err = db.Exec(string(body))
		must(t, err)
	}
	_, err = db.Exec(`INSERT INTO providers VALUES('p','旧服务','openai','http://localhost','','2026-10-17T00:00:00.000Z',NULL);
 INSERT INTO members(id,name,avatar_glyph,avatar_color,provider_id,model,created_at)VALUES('m','成员','成','dai','p','text-only','2026-10-17T00:00:00.000Z');
 INSERT INTO groups(id,title,created_at,updated_at)VALUES('g','旧群','2026-10-17T00:00:00.000Z','2026-10-17T00:00:00.000Z');
 INSERT INTO messages(id,group_id,seq,author_kind,content,status,created_at)VALUES('old','g',1,'user','旧消息','done','2026-10-17T00:00:00.000Z');
 PRAGMA user_version=3;`)
	must(t, err)
	must(t, db.Close())
	s, err := Open(path)
	must(t, err)
	defer s.Close()
	member, err := s.Member(ctx, "m")
	must(t, err)
	if member.SupportsImages || member.Model != "text-only" {
		t.Fatal(member)
	}
	msg, err := s.Message(ctx, "old")
	must(t, err)
	if msg.Content != "旧消息" || len(msg.Attachments) != 0 {
		t.Fatal(msg)
	}
}

func TestAttachmentTurnRollbackWhenPlaceholderFails(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	a := domain.Attachment{ID: NewID(), Name: "draft.txt", Kind: "document", Text: "keep"}
	must(t, s.SaveDraftAttachment(ctx, "g", a))
	_, err := s.db.Exec(`CREATE TRIGGER reject_placeholder BEFORE INSERT ON messages WHEN NEW.author_kind='member' BEGIN SELECT RAISE(ABORT,'placeholder failure'); END;`)
	must(t, err)
	user := domain.Message{ID: NewID(), GroupID: "g", AuthorKind: domain.AuthorUser, Status: domain.StatusDone, Attachments: []domain.Attachment{{ID: a.ID}}}
	slot := domain.Message{GroupID: "g", AuthorKind: domain.AuthorMember, Status: domain.StatusPending, ReplyToID: user.ID}
	if err = s.InsertMessages(ctx, []*domain.Message{&user, &slot}); err == nil {
		t.Fatal("accepted failed placeholder")
	}
	if _, err = s.DraftAttachments(ctx, "g", []string{a.ID}); err != nil {
		t.Fatal("draft consumed", err)
	}
	messages, err := s.RecentMessages(ctx, "g", 10)
	must(t, err)
	if len(messages) != 0 || user.Seq != 0 || slot.ID != "" {
		t.Fatal("partial mutation", messages, user, slot)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err = s.InsertMessages(cancelled, []*domain.Message{&user, &slot}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	_, err = s.db.Exec(`DROP TRIGGER reject_placeholder`)
	must(t, err)
	must(t, s.InsertMessages(ctx, []*domain.Message{&user, &slot}))
	if user.Seq != 1 || slot.Seq != 2 {
		t.Fatal(user, slot)
	}
}
