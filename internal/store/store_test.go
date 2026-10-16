package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/memory"
	"ai-group-chat/internal/turn"
	"github.com/oklog/ulid/v2"
)

var _ turn.Store = (*Store)(nil)
var ctx = context.Background()

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "data.db"))
	must(t, err)
	t.Cleanup(func() { must(t, s.Close()) })
	return s
}
func seed(t *testing.T, s *Store) domain.Group {
	t.Helper()
	for _, id := range []string{"mo", "qy"} {
		p := domain.Provider{ID: id, Name: id, Kind: "openai", BaseURL: "https://example.invalid/v1", KeyRef: "provider:" + id}
		must(t, s.SaveProvider(ctx, &p))
		name := "墨白"
		if id == "qy" {
			name = "青砚"
		}
		m := domain.Member{ID: id, Name: name, ProviderID: id, Model: "test", ContextTokens: 16000, Avatar: domain.Avatar{Glyph: string([]rune(name)[0]), Color: "shiqing"}}
		must(t, s.SaveMember(ctx, &m))
	}
	g := domain.Group{ID: "g", Title: "群", DefaultMode: domain.ModeSerial, MemberIDs: []string{"mo", "qy"}}
	must(t, s.CreateGroup(ctx, &g))
	return g
}
func insert(t *testing.T, s *Store, g string, status domain.MessageStatus, content string) domain.Message {
	t.Helper()
	m := domain.Message{GroupID: g, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Status: status, Content: content}
	must(t, s.InsertMessage(ctx, &m))
	return m
}

func TestOpenMigrationsAndDefaultPath(t *testing.T) {
	s := openTest(t)
	var version, foreign int
	var journal string
	must(t, s.db.QueryRow("PRAGMA user_version").Scan(&version))
	files, err := migrations.ReadDir("migrations")
	must(t, err)
	if version != len(files) {
		t.Fatalf("version %d, migrations %d", version, len(files))
	}
	must(t, s.db.QueryRow("PRAGMA foreign_keys").Scan(&foreign))
	if foreign != 1 {
		t.Fatal("foreign keys disabled")
	}
	must(t, s.db.QueryRow("PRAGMA journal_mode").Scan(&journal))
	if journal != "wal" {
		t.Fatal(journal)
	}
	path, err := DefaultPath()
	must(t, err)
	if filepath.Base(path) != "data.db" || filepath.Base(filepath.Dir(path)) != "ai-group-chat" {
		t.Fatal(path)
	}
	_, err = ulid.Parse(NewID())
	must(t, err)
	must(t, s.db.Close())
	reopened, err := Open(s.Path())
	must(t, err)
	must(t, reopened.Close())
	// Close 在 cleanup 还会调用；database/sql.Close 可重复调用。
}

func TestRejectNewerDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future.db")
	s, err := Open(path)
	must(t, err)
	_, err = s.db.Exec("PRAGMA user_version = 999")
	must(t, err)
	must(t, s.Close())
	other, err := Open(path)
	if err == nil {
		other.Close()
		t.Fatal("must reject newer schema")
	}
}

func TestConcurrentMessagesAcrossConnections(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	// 两个独立连接池，防止只靠进程内的锁通过测试。
	other, err := Open(s.Path())
	must(t, err)
	defer other.Close()
	var wg sync.WaitGroup
	errs := make(chan error, 50)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			db := s
			if i%2 == 1 {
				db = other
			}
			m := domain.Message{GroupID: "g", AuthorKind: domain.AuthorUser, AuthorID: "user", Status: domain.StatusDone, Content: fmt.Sprint(i)}
			err := db.InsertMessage(ctx, &m)
			if err == nil && m.Seq <= 0 {
				err = errors.New("seq not returned")
			}
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		must(t, err)
	}
	msgs, err := s.RecentMessages(ctx, "g", 100)
	must(t, err)
	if len(msgs) != 50 {
		t.Fatal(len(msgs))
	}
	for i, m := range msgs {
		if m.Seq != int64(i+1) {
			t.Fatalf("seq %d: %+v", i, m)
		}
	}
	recent, err := s.RecentMessages(ctx, "g", 3)
	must(t, err)
	if len(recent) != 3 || recent[0].Seq != 48 || recent[2].Seq != 50 {
		t.Fatal(recent)
	}
	empty, err := s.RecentMessages(ctx, "g", 0)
	must(t, err)
	if len(empty) != 0 {
		t.Fatal(empty)
	}
}

func TestRestartRecoveryAndRoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.db")
	s, err := Open(path)
	must(t, err)
	g := seed(t, s)
	g.MemberAvatars = map[string]domain.Avatar{"mo": {Glyph: "墨", Color: "dai", Image: "/avatars/a.gif"}}
	g.MemberIDs = []string{"qy", "mo"}
	must(t, s.UpdateGroup(ctx, g))
	a := insert(t, s, "g", domain.StatusPending, "")
	b := insert(t, s, "g", domain.StatusStreaming, "写到一半")
	c := insert(t, s, "g", domain.StatusDone, "周五评审")
	confirmed := time.Now().UTC().Truncate(time.Millisecond)
	item := domain.MemoryItem{GroupID: "g", Kind: domain.MemoryDecision, Content: "周五评审", Status: domain.MemoryConfirmed, Origin: domain.OriginUser, ProposedBy: "user", ConfirmedAt: &confirmed, Sources: []domain.MemorySource{{MessageID: c.ID, Seq: c.Seq, Role: domain.SourceProposed}}}
	must(t, s.SaveMemoryItems(ctx, "g", []domain.MemoryItem{item}, c.Seq))
	for key, value := range map[string]string{"ui.appearance": `{"paper":"xuan"}`, "ui.user_seal": `{"text":"我","style":"baiwen"}`} {
		must(t, s.SetSetting(ctx, key, value))
	}
	must(t, s.Close())
	s, err = Open(path)
	must(t, err)
	defer s.Close()
	loaded, err := s.Group(ctx, "g")
	must(t, err)
	if !reflect.DeepEqual(loaded.MemberIDs, g.MemberIDs) || !reflect.DeepEqual(loaded.MemberAvatars, g.MemberAvatars) || loaded.MemoryCursor != c.Seq {
		t.Fatalf("%+v", loaded)
	}
	for _, id := range []string{a.ID, b.ID} {
		m, err := s.Message(ctx, id)
		must(t, err)
		if m.Status != domain.StatusStopped || m.FinishedAt == nil {
			t.Fatal(m)
		}
		if id == b.ID && m.Content != b.Content {
			t.Fatal(m)
		}
	}
	items, err := s.MemoryItems(ctx, "g")
	must(t, err)
	if len(items) != 1 || items[0].Status != domain.MemoryConfirmed || !items[0].ConfirmedAt.Equal(confirmed) || !reflect.DeepEqual(items[0].Sources, item.Sources) {
		t.Fatal(items)
	}
	value, err := s.Setting(ctx, "ui.user_seal")
	must(t, err)
	if value != `{"text":"我","style":"baiwen"}` {
		t.Fatal(value)
	}
	must(t, s.SetGroupAvatar(ctx, "g", "mo", nil))
	loaded, err = s.Group(ctx, "g")
	must(t, err)
	if _, ok := loaded.MemberAvatars["mo"]; ok {
		t.Fatal("override not removed")
	}
	// 旧的群资料不得把新游标回写为零。
	g.Title = "新群名"
	must(t, s.UpdateGroup(ctx, g))
	loaded, err = s.Group(ctx, "g")
	must(t, err)
	if loaded.MemoryCursor != c.Seq {
		t.Fatal(loaded.MemoryCursor)
	}
}

func TestCatalogSoftDeleteAndGroupRollback(t *testing.T) {
	s := openTest(t)
	g := seed(t, s)
	temp := 0.7
	m, err := s.Member(ctx, "mo")
	must(t, err)
	m.Temperature = &temp
	m.Brief = "设计"
	m.Avatar.Image = "/avatars/a.gif"
	must(t, s.SaveMember(ctx, &m))
	got, err := s.Member(ctx, "mo")
	must(t, err)
	if !reflect.DeepEqual(got, m) {
		t.Fatalf("%+v != %+v", got, m)
	}
	p, err := s.Provider(ctx, "mo")
	must(t, err)
	p.Name = "改名"
	must(t, s.SaveProvider(ctx, &p))
	ps, err := s.Providers(ctx)
	must(t, err)
	if len(ps) != 2 {
		t.Fatal(ps)
	}
	if err = s.DeleteProvider(ctx, "mo"); err == nil {
		t.Fatal("deleted referenced provider")
	}
	g.MemberIDs = []string{"mo", "missing"}
	if err = s.UpdateGroup(ctx, g); err == nil {
		t.Fatal("accepted missing member")
	}
	loaded, err := s.Group(ctx, "g")
	must(t, err)
	if !reflect.DeepEqual(loaded.MemberIDs, []string{"mo", "qy"}) {
		t.Fatal(loaded.MemberIDs)
	}
	must(t, s.DeleteMember(ctx, "mo"))
	active, err := s.ListMembers(ctx)
	must(t, err)
	if len(active) != 1 || active[0].ID != "qy" {
		t.Fatal(active)
	}
	history, err := s.Members(ctx, []string{"mo", "missing"})
	must(t, err)
	if len(history) != 1 || history["mo"].Name != "墨白" {
		t.Fatal(history)
	}
	loaded, err = s.Group(ctx, "g")
	must(t, err)
	if !reflect.DeepEqual(loaded.MemberIDs, []string{"qy"}) {
		t.Fatal(loaded.MemberIDs)
	}
	if err = s.SaveMember(ctx, &m); err == nil {
		t.Fatal("resurrected deleted member")
	}
	a := domain.Avatar{Glyph: "青", Color: "dai"}
	must(t, s.SetGroupAvatar(ctx, "g", "qy", &a))
	if err = s.SetGroupAvatar(ctx, "g", "mo", &a); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing membership: %v", err)
	}
	must(t, s.DeleteGroup(ctx, "g"))
	if _, err = s.Group(ctx, "g"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
}

func TestMemoryAtomicityAndSources(t *testing.T) {
	s := openTest(t)
	g := seed(t, s)
	m := insert(t, s, g.ID, domain.StatusDone, "原文")
	item := domain.MemoryItem{GroupID: g.ID, Kind: domain.MemoryTodo, Content: "待办", Status: domain.MemoryProposed, Origin: domain.OriginUser, ProposedBy: "user", Sources: []domain.MemorySource{{MessageID: m.ID, Seq: m.Seq, Role: domain.SourceProposed}}}
	must(t, s.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{item}, m.Seq))
	items, err := s.MemoryItems(ctx, g.ID)
	must(t, err)
	if len(items) != 1 || items[0].Ref != 1 {
		t.Fatal(items)
	}
	other := domain.Group{ID: "other", Title: "另一个群", DefaultMode: domain.ModeSerial}
	must(t, s.CreateGroup(ctx, &other))
	foreign := insert(t, s, other.ID, domain.StatusDone, "其他群")
	for _, source := range []domain.MemorySource{{MessageID: "missing", Seq: 99, Role: domain.SourceProposed}, {MessageID: m.ID, Seq: 99, Role: domain.SourceProposed}, {MessageID: foreign.ID, Seq: foreign.Seq, Role: domain.SourceProposed}} {
		bad := item
		bad.Sources = []domain.MemorySource{source}
		if err = s.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{bad}, m.Seq); err == nil {
			t.Fatal("accepted forged source")
		}
	}
	changed := items[0]
	changed.Content = "不应保存"
	bad := item
	bad.Kind = "invalid"
	if err = s.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{changed, bad}, m.Seq); err == nil {
		t.Fatal("accepted invalid batch")
	}
	items, err = s.MemoryItems(ctx, g.ID)
	must(t, err)
	if len(items) != 1 || items[0].Content != "待办" {
		t.Fatal(items)
	}
	if err = s.SaveMemoryItems(ctx, g.ID, nil, 99); err == nil {
		t.Fatal("cursor exceeded history")
	}
	if err = s.SaveMemoryItems(ctx, g.ID, nil, 0); err == nil {
		t.Fatal("cursor went backwards")
	}
	changed = items[0]
	changed.Status = domain.MemoryRejected
	must(t, s.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{changed}, m.Seq))
	must(t, s.DeleteMemoryItem(ctx, changed.ID))
	items, err = s.MemoryItems(ctx, g.ID)
	must(t, err)
	if len(items) != 0 {
		t.Fatal(items)
	}
	must(t, s.SetSetting(ctx, "test", `{"enabled":true}`))
	must(t, s.SetSetting(ctx, "test", `{"enabled":false}`))
	must(t, s.DeleteSetting(ctx, "test"))
	if _, err = s.Setting(ctx, "test"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if err = s.SetSetting(ctx, "bad", "not JSON"); err == nil {
		t.Fatal("accepted invalid JSON")
	}
}

func TestCRUDDeletionCascadesAndIdentity(t *testing.T) {
	s := openTest(t)
	g := seed(t, s)
	source := insert(t, s, g.ID, domain.StatusDone, "真实来源")
	item := domain.MemoryItem{GroupID: g.ID, Kind: domain.MemoryPlan, Content: "方案", Status: domain.MemoryProposed, Origin: domain.OriginUser, ProposedBy: "user", Sources: []domain.MemorySource{{MessageID: source.ID, Seq: source.Seq, Role: domain.SourceProposed}}}
	must(t, s.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{item}, source.Seq))
	items, err := s.MemoryItems(ctx, g.ID)
	must(t, err)
	got, err := s.MemoryItem(ctx, items[0].ID)
	must(t, err)
	if !reflect.DeepEqual(got, items[0]) {
		t.Fatal(got)
	}
	avatar := domain.Avatar{Glyph: "青", Color: "dai", Image: "/avatars/default.gif"}
	must(t, s.SetMemberAvatar(ctx, "mo", avatar))
	member, err := s.Member(ctx, "mo")
	must(t, err)
	if member.Avatar != avatar {
		t.Fatal(member.Avatar)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	must(t, s.ArchiveGroup(ctx, "g", &now))
	groups, err := s.Groups(ctx)
	must(t, err)
	if len(groups) != 1 || groups[0].ArchivedAt == nil || !groups[0].ArchivedAt.Equal(now) {
		t.Fatal(groups)
	}
	must(t, s.ArchiveGroup(ctx, "g", nil))
	gotGroup, err := s.Group(ctx, "g")
	must(t, err)
	if gotGroup.ArchivedAt != nil {
		t.Fatal(gotGroup)
	}
	source.Content = "改过的正文"
	source.AuthorID = "cannot-change"
	source.TurnID = "cannot-change"
	must(t, s.UpdateMessage(ctx, source))
	persisted, err := s.Message(ctx, source.ID)
	must(t, err)
	if persisted.Content != source.Content || persisted.AuthorID != "user" || persisted.TurnID != "" {
		t.Fatal(persisted)
	}
	// 错误的消息编号不能改写原消息。
	source.Seq = 999
	if err = s.UpdateMessage(ctx, source); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	must(t, s.DeleteGroup(ctx, g.ID))
	for _, table := range []string{"messages", "memory_items", "memory_sources", "group_members"} {
		var count int
		must(t, s.db.QueryRow("SELECT count(*) FROM "+table).Scan(&count))
		if count != 0 {
			t.Fatalf("%s left %d rows", table, count)
		}
	}
	fresh := domain.Provider{Name: "空服务", Kind: "openai", BaseURL: "http://localhost:11434/v1"}
	must(t, s.SaveProvider(ctx, &fresh))
	if _, err = ulid.Parse(fresh.ID); err != nil {
		t.Fatal(err)
	}
	must(t, s.DeleteProvider(ctx, fresh.ID))
}

func TestFailedInsertLeavesMessageUnchanged(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	m := domain.Message{GroupID: "missing", AuthorKind: domain.AuthorUser, AuthorID: "user", Status: domain.StatusDone, Seq: 90}
	original := m
	if err := s.InsertMessage(ctx, &m); err == nil {
		t.Fatal("accepted absent group")
	}
	if !reflect.DeepEqual(m, original) {
		t.Fatal("failed insert changed caller's message")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	m.GroupID = "g"
	if err := s.InsertMessage(cancelled, &m); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	first := insert(t, s, "g", domain.StatusDone, "first")
	if first.Seq != 1 {
		t.Fatal(first.Seq)
	}
	if err := s.SaveMemoryItems(ctx, "g", []domain.MemoryItem{{GroupID: "g", Kind: domain.MemoryPlan, Status: domain.MemoryProposed, Origin: domain.OriginUser}}, 1); err == nil {
		t.Fatal("accepted memory without source")
	}
}

func TestRepeatedMemorySourcesAreStoredOnce(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	message := insert(t, s, "g", domain.StatusDone, "来源")
	source := domain.MemorySource{MessageID: message.ID, Seq: message.Seq, Role: domain.SourceProposed}
	ops := []memory.Op{{Op: "add", Kind: "plan", Content: "方案", Origin: "user", ProposedBy: "用户", Sources: []int64{message.Seq, message.Seq}}}
	result := memory.Apply(nil, ops, []domain.Message{message}, memory.Env{GroupID: "g", NewID: NewID, Now: time.Now()})
	if len(result.Rejected) != 0 || len(result.Items) != 1 {
		t.Fatalf("Apply: %+v", result)
	}
	item := result.Items[0]
	must(t, s.SaveMemoryItems(ctx, "g", []domain.MemoryItem{item}, message.Seq))
	items, err := s.MemoryItems(ctx, "g")
	must(t, err)
	if len(items) != 1 || len(items[0].Sources) != 1 {
		t.Fatal(items)
	}
	// 更新操作追加已存在的来源，也必须能正常保存。
	item = items[0]
	item.Sources = append(item.Sources, source)
	must(t, s.SaveMemoryItems(ctx, "g", []domain.MemoryItem{item}, message.Seq))
}

// TASK-005：消息记录本轮回复方式；未指定时归一到 serial。
func TestMessageReplyModeRoundTrip(t *testing.T) {
	s := openTest(t)
	g := seed(t, s)
	user := domain.Message{GroupID: g.ID, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Status: domain.StatusDone, Content: "试试", ReplyMode: domain.ModeParallel}
	must(t, s.InsertMessage(ctx, &user))
	got, err := s.Message(ctx, user.ID)
	must(t, err)
	if got.ReplyMode != domain.ModeParallel {
		t.Fatalf("reply mode %q", got.ReplyMode)
	}
	slot := domain.Message{GroupID: g.ID, AuthorKind: domain.AuthorMember, AuthorID: "mo", ReplyToID: user.ID, Status: domain.StatusPending}
	must(t, s.InsertMessage(ctx, &slot))
	got2, err := s.Message(ctx, slot.ID)
	must(t, err)
	if got2.ReplyMode != domain.ModeSerial {
		t.Fatalf("未指定的回复方式应归为 serial，得到 %q", got2.ReplyMode)
	}
	// 重新读取整群历史也要带回 reply_mode。
	history, err := s.RecentMessages(ctx, g.ID, 10)
	must(t, err)
	if len(history) != 2 || history[0].ReplyMode != domain.ModeParallel {
		t.Fatalf("history: %+v", history)
	}
}

func TestVisibleMessagesAfterReadsEarliestRangeWithinGroup(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	other := domain.Group{ID: "other", Title: "另一个群"}
	must(t, s.CreateGroup(ctx, &other))
	for i := 0; i < 6; i++ {
		insert(t, s, "g", domain.StatusDone, fmt.Sprint(i+1))
		insert(t, s, "other", domain.StatusDone, "其他群")
	}
	messages, err := s.VisibleMessagesAfter(ctx, "g", 2, 2)
	must(t, err)
	if len(messages) != 2 || messages[0].Seq != 3 || messages[1].Seq != 4 || messages[0].GroupID != "g" {
		t.Fatalf("wrong earliest range: %+v", messages)
	}
	for _, request := range []struct {
		cursor int64
		limit  int
	}{{0, 0}, {6, 2}} {
		messages, err = s.VisibleMessagesAfter(ctx, "g", request.cursor, request.limit)
		must(t, err)
		if len(messages) != 0 {
			t.Fatalf("expected empty range: %+v", messages)
		}
	}
}

func TestVisibleMessagesAfterDoesNotLetInvisibleRowsHideNextWindow(t *testing.T) {
	s := openTest(t)
	seed(t, s)
	for _, status := range []domain.MessageStatus{domain.StatusPending, domain.StatusStreaming, domain.StatusError, domain.StatusStopped} {
		insert(t, s, "g", status, "")
	}
	done := insert(t, s, "g", domain.StatusDone, "正常发言")
	partial := insert(t, s, "g", domain.StatusStopped, "中断前的正文")
	messages, err := s.VisibleMessagesAfter(ctx, "g", 0, 2)
	must(t, err)
	if len(messages) != 2 || messages[0].ID != done.ID || messages[1].ID != partial.ID {
		t.Fatalf("invisible rows consumed summary window: %+v", messages)
	}
}
