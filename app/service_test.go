package app

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/store"
)

func fixture(t *testing.T, emit func(Event)) (*Service, *store.Store) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "data.db"))
	if err != nil {
		t.Fatal(err)
	}
	s := NewService(db, func(context.Context, domain.Provider) (llm.Provider, error) { return replyProvider{}, nil }, "mac", emit)
	t.Cleanup(func() { CloseService(s); db.Close() })
	return s, db
}

type replyProvider struct{}

func (replyProvider) Stream(ctx context.Context, req llm.Request, delta func(string)) (llm.Usage, error) {
	delta("真实回复")
	return llm.Usage{}, nil
}
func seed(t *testing.T, db *store.Store) {
	t.Helper()
	ctx := context.Background()
	p := domain.Provider{ID: "p", Name: "测试服务", Kind: "openai"}
	if err := db.SaveProvider(ctx, &p); err != nil {
		t.Fatal(err)
	}
	for _, m := range []domain.Member{{ID: "a", Name: "青砚", ProviderID: "p", Model: "test", Avatar: domain.Avatar{Glyph: "青", Color: "shiqing"}}, {ID: "b", Name: "墨白", ProviderID: "p", Model: "test", Avatar: domain.Avatar{Glyph: "墨", Color: "dai"}}} {
		if err := db.SaveMember(ctx, &m); err != nil {
			t.Fatal(err)
		}
	}
}
func TestBootstrapSettingsAndWireJSON(t *testing.T) {
	s, _ := fixture(t, nil)
	ctx := context.Background()
	b, err := s.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(b)
	for _, want := range []string{`"groups":[]`, `"members":[]`, `"providers":[]`, `"nightPaper":"ye"`, `"userSeal":{"text":"我","style":"baiwen"}`} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("missing %s: %s", want, raw)
		}
	}
	a := Appearance{Mode: "night", Paper: "ma", NightPaper: "wujin", FontSize: "l", Density: "compact"}
	if err = s.SetAppearance(ctx, a); err != nil {
		t.Fatal(err)
	}
	if err = s.SetUserSeal(ctx, UserSeal{Text: "子鹏之印", Style: "zhuwen"}); err != nil {
		t.Fatal(err)
	}
	b, err = s.Bootstrap(ctx)
	if err != nil || b.Appearance != a || b.UserSeal.Text != "子鹏之印" {
		t.Fatalf("%+v %v", b, err)
	}
	if err = s.SetAppearance(ctx, Appearance{Mode: "bad"}); err == nil {
		t.Fatal("invalid appearance accepted")
	}
}
func TestServiceSerialAndPersistentHistory(t *testing.T) {
	var mu sync.Mutex
	events := []Event{}
	ended := make(chan struct{}, 1)
	s, db := fixture(t, func(e Event) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
		if e["kind"] == "turn.end" {
			ended <- struct{}{}
		}
	})
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "测试群", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.Send(ctx, g.ID, "@青砚 @墨白 讨论", nil)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-ended:
	case <-time.After(3 * time.Second):
		t.Fatal("turn did not finish")
	}
	d, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Messages) != 3 || d.Messages[2].ContextSeq != 2 || d.Messages[2].Status != "done" || d.Busy || len(result.Order) != 2 {
		t.Fatalf("%+v %+v", d, result)
	}
	raw, _ := json.Marshal(d)
	if strings.Contains(string(raw), `"GroupID"`) || !strings.Contains(string(raw), `"createdAt"`) {
		t.Fatal(string(raw))
	}
	mu.Lock()
	defer mu.Unlock()
	for i, e := range events {
		if e["kind"] == "message" {
			m := e["message"].(Message)
			if m.Status == "done" && m.AuthorKind == "member" {
				if i == 0 || events[i-1]["kind"] != "delta" {
					t.Fatalf("terminal message before delta: %+v", events)
				}
			}
		}
	}
}
func TestUserMemoryAndAvatar(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "测试", MemberIDs: []string{"a"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Send(ctx, g.ID, "只记录", nil)
	if err != nil {
		t.Fatal(err)
	}
	item := domain.MemoryItem{ID: "memory", GroupID: g.ID, Ref: 1, Kind: domain.MemoryPlan, Content: "方案", Status: domain.MemoryProposed, Origin: domain.OriginUser, ProposedBy: domain.UserID, Sources: []domain.MemorySource{{MessageID: r.UserMessage.ID, Seq: 1, Role: domain.SourceProposed}}}
	if err = db.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{item}, 1); err != nil {
		t.Fatal(err)
	}
	confirmed, err := s.ConfirmMemory(ctx, item.ID)
	if err != nil || confirmed.Status != "confirmed" || confirmed.ConfirmedAt == nil {
		t.Fatalf("%+v %v", confirmed, err)
	}
	edited, err := s.EditMemory(ctx, item.ID, "用户改写")
	if err != nil || edited.Status != "confirmed" || edited.Origin != "user" {
		t.Fatalf("%+v %v", edited, err)
	}
	a := Avatar{Glyph: "砚", Color: "dai"}
	summary, err := s.SetGroupAvatar(ctx, g.ID, "a", &a)
	if err != nil || summary.MemberAvatars["a"] != a {
		t.Fatalf("%+v %v", summary, err)
	}
	if _, err = s.SetGroupAvatar(ctx, g.ID, "b", &a); err == nil {
		t.Fatal("nonmember avatar accepted")
	}
	if err := s.Summarize(ctx, g.ID); err != nil {
		t.Fatalf("整理应能触发：%v", err)
	}
	if err := s.Retry(ctx, "missing"); err == nil {
		t.Fatal("对不存在的消息重试应报错")
	}
}

// 并行必须真的同时进入模型；停止之后保留部分正文并把所有占位收尾。
type blockingProvider struct{ started chan struct{} }

func (p blockingProvider) Stream(ctx context.Context, _ llm.Request, delta func(string)) (llm.Usage, error) {
	delta("已生成部分")
	p.started <- struct{}{}
	<-ctx.Done()
	return llm.Usage{}, ctx.Err()
}
func TestParallelStopAndBusy(t *testing.T) {
	ended := make(chan struct{}, 1)
	s, db := fixture(t, func(e Event) {
		if e["kind"] == "turn.end" {
			ended <- struct{}{}
		}
	})
	seed(t, db)
	started := make(chan struct{}, 2)
	s.turns.Providers = func(context.Context, domain.Provider) (llm.Provider, error) { return blockingProvider{started}, nil }
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "并行", MemberIDs: []string{"a", "b"}, DefaultMode: "parallel"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, g.ID, "@所有人 开始", nil); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("members did not start concurrently")
		}
	}
	if _, err = s.Send(ctx, g.ID, "第二轮", nil); err == nil {
		t.Fatal("busy group accepted send")
	}
	if err = s.Stop(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ended:
	case <-time.After(time.Second):
		t.Fatal("stop did not end")
	}
	d, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range d.Messages[1:] {
		if m.Status != "stopped" || m.Content != "已生成部分" || m.ContextSeq != 1 {
			t.Fatalf("%+v", m)
		}
	}
}
func TestSettingsSurviveReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "restart.db")
	ctx := context.Background()
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s := NewService(db, nil, "mac", nil)
	if err = s.SetUserSeal(ctx, UserSeal{"印", "zhuwen"}); err != nil {
		t.Fatal(err)
	}
	if err = s.SetAppearance(ctx, Appearance{"night", "qing", "wujin", "s", "compact"}); err != nil {
		t.Fatal(err)
	}
	CloseService(s)
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s = NewService(db, nil, "mac", nil)
	defer CloseService(s)
	b, err := s.Bootstrap(ctx)
	if err != nil || b.UserSeal.Text != "印" || b.Appearance.NightPaper != "wujin" {
		t.Fatalf("%+v %v", b, err)
	}
}

type gatedCancelProvider struct{ started, cancelled, finish chan struct{} }

func (p gatedCancelProvider) Stream(ctx context.Context, _ llm.Request, delta func(string)) (llm.Usage, error) {
	delta("关闭前的正文")
	close(p.started)
	<-ctx.Done()
	close(p.cancelled)
	<-p.finish
	return llm.Usage{}, ctx.Err()
}
func TestCloseWaitsForCancelledReplyPersistence(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "关闭验收", MemberIDs: []string{"a"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	p := gatedCancelProvider{make(chan struct{}), make(chan struct{}), make(chan struct{})}
	s.turns.Providers = func(context.Context, domain.Provider) (llm.Provider, error) { return p, nil }
	if _, err = s.Send(ctx, g.ID, "@青砚 开始", nil); err != nil {
		t.Fatal(err)
	}
	<-p.started
	closed := make(chan struct{})
	go func() { CloseService(s); close(closed) }()
	<-p.cancelled
	select {
	case <-closed:
		close(p.finish)
		t.Fatal("close returned before cancelled provider finished")
	case <-time.After(20 * time.Millisecond):
	}
	close(p.finish)
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("close did not finish")
	}
	messages, err := db.RecentMessages(ctx, g.ID, 2)
	if err != nil || len(messages) != 2 || messages[1].Content != "关闭前的正文" || messages[1].Status != domain.StatusStopped {
		t.Fatalf("%+v %v", messages, err)
	}
	if _, err = s.Send(ctx, g.ID, "关闭后", nil); err == nil {
		t.Fatal("closed service accepted send")
	}
}

func TestMemberCreateEditDelete(t *testing.T) {
	ended := make(chan struct{}, 2)
	s, db := fixture(t, func(e Event) {
		if e["kind"] == "turn.end" {
			ended <- struct{}{}
		}
	})
	seed(t, db)
	ctx := context.Background()
	created, err := s.SaveMember(ctx, SaveMemberInput{Name: "拾遗", Avatar: Avatar{Glyph: "拾", Color: "zheshi"}, Brief: "产品经理", ProviderID: "p", Model: "test", ContextTokens: 16000})
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "拾遗" || created.ID == "" {
		t.Fatalf("%+v", created)
	}
	if _, err = s.SaveMember(ctx, SaveMemberInput{Name: "拾遗", Avatar: Avatar{Glyph: "拾", Color: "dai"}, ProviderID: "p", Model: "test"}); err == nil {
		t.Fatal("重复名字应被拒")
	}
	if _, err = s.SaveMember(ctx, SaveMemberInput{Name: "有 空格", Avatar: Avatar{Glyph: "空", Color: "dai"}, ProviderID: "p", Model: "test"}); err == nil {
		t.Fatal("含空格的名字应被拒")
	}

	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "成员群", MemberIDs: []string{created.ID}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, g.ID, "@拾遗 你好", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ended:
	case <-time.After(3 * time.Second):
		t.Fatal("轮次未结束")
	}
	renamed, err := s.SaveMember(ctx, SaveMemberInput{ID: created.ID, Name: "拾遗子", Avatar: created.Avatar, ProviderID: "p", Model: "test", ContextTokens: 8000})
	if err != nil || renamed.Name != "拾遗子" || renamed.ContextTokens != 8000 {
		t.Fatalf("%+v %v", renamed, err)
	}
	if err = s.DeleteMember(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	d, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	notified := false
	for _, m := range d.Messages {
		if m.AuthorKind == "system" && strings.Contains(m.Content, "拾遗子") {
			notified = true
		}
	}
	if !notified {
		t.Fatal("删除成员应写系统消息")
	}
	if slices.Contains(d.Group.MemberIDs, created.ID) {
		t.Fatal("删除后成员仍在群里")
	}
	b, err := s.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// 历史消息仍要能显示其（改名后的）名字。
	name := ""
	for _, m := range b.Members {
		if m.ID == created.ID {
			name = m.Name
		}
	}
	if name != "拾遗子" {
		t.Fatalf("已删除成员的历史名字读出为 %q", name)
	}
	if !slices.Contains(b.RetiredMemberIDs, created.ID) {
		t.Fatal("已删除成员应标记为已退群")
	}
}

func TestCompleteTodo(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "待办", MemberIDs: []string{"a"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Send(ctx, g.ID, "记一下", nil)
	if err != nil {
		t.Fatal(err)
	}
	item := domain.MemoryItem{ID: "todo", GroupID: g.ID, Ref: 1, Kind: domain.MemoryTodo, Content: "画稿", Status: domain.MemoryProposed, Origin: domain.OriginUser, ProposedBy: domain.UserID, Sources: []domain.MemorySource{{MessageID: r.UserMessage.ID, Seq: 1, Role: domain.SourceProposed}}}
	if err = db.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{item}, 1); err != nil {
		t.Fatal(err)
	}
	done, err := s.CompleteMemory(ctx, "todo")
	if err != nil || done.Status != "done" {
		t.Fatalf("complete: %+v %v", done, err)
	}
	back, err := s.UncompleteMemory(ctx, "todo")
	if err != nil || back.Status != "proposed" {
		t.Fatalf("uncomplete: %+v %v", back, err)
	}
}

func TestGroupManagement(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "群", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	upd, err := s.UpdateGroup(ctx, UpdateGroupInput{ID: g.ID, Title: "新名", Topic: "主题", DefaultMode: "parallel", MemberIDs: []string{"b", "a"}})
	if err != nil {
		t.Fatal(err)
	}
	if upd.Title != "新名" || upd.DefaultMode != "parallel" || !slices.Equal(upd.MemberIDs, []string{"b", "a"}) {
		t.Fatalf("%+v", upd)
	}
	d, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	notes := map[string]bool{}
	for _, m := range d.Messages {
		if m.AuthorKind == "system" {
			notes[m.Content] = true
		}
	}
	for _, want := range []string{"你把群名改为「新名」", "你改了群主题", "你把默认回复方式改为同时回复", "你调整了发言顺序"} {
		if !notes[want] {
			t.Fatalf("缺少系统消息 %q，得到 %v", want, notes)
		}
	}
	// busy 时不能调整成员
	gate := make(chan struct{})
	started := make(chan struct{}, 2)
	s.turns.Providers = func(context.Context, domain.Provider) (llm.Provider, error) { return blockingProvider{started}, nil }
	if _, err = s.Send(ctx, g.ID, "@墨白 开始", nil); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && !s.turns.Busy(g.ID) {
		time.Sleep(2 * time.Millisecond)
	}
	if _, err = s.UpdateGroup(ctx, UpdateGroupInput{ID: g.ID, Title: "新名", Topic: "主题", DefaultMode: "parallel", MemberIDs: []string{"a"}}); err == nil {
		t.Fatal("有轮次进行时不应允许改动成员")
	}
	_ = gate
	if err = s.Stop(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	for s.turns.Busy(g.ID) {
		time.Sleep(time.Millisecond)
	}
	// 归档后仍可读到 Archived 标记
	if err = s.ArchiveGroup(ctx, g.ID, true); err != nil {
		t.Fatal(err)
	}
	b, err := s.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	marked := false
	for _, gs := range b.Groups {
		if gs.ID == g.ID && gs.Archived {
			marked = true
		}
	}
	if !marked {
		t.Fatal("归档群未标记 Archived")
	}
	// 删除后打不开
	if err = s.DeleteGroup(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.OpenGroup(ctx, g.ID); err == nil {
		t.Fatal("已删除的群仍能打开")
	}
}

func TestProviderCRUDAndMemoryConfig(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db) // provider p 被成员 a、b 使用
	ctx := context.Background()
	if err := s.DeleteProvider(ctx, "p"); err == nil {
		t.Fatal("删除仍被成员使用的服务应被拒")
	}
	cfg, err := s.SaveProvider(ctx, SaveProviderInput{Name: "新服务", Kind: "openai", BaseURL: "https://example.invalid/v1"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ID == "" || cfg.Name != "新服务" {
		t.Fatalf("%+v", cfg)
	}
	b, err := s.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range b.Providers {
		if p.ID == cfg.ID {
			found = true
		}
	}
	if !found || b.Version == "" || s.DataDir() == "" {
		t.Fatalf("bootstrap 缺少新服务/版本/数据目录：%+v", b)
	}
	if err = s.SetMemoryConfig(ctx, MemoryConfig{ProviderID: cfg.ID, Model: "m"}); err != nil {
		t.Fatal(err)
	}
	if b, _ = s.Bootstrap(ctx); b.Memory.ProviderID != cfg.ID || b.Memory.Model != "m" {
		t.Fatalf("%+v", b.Memory)
	}
	if err = s.DeleteProvider(ctx, cfg.ID); err != nil {
		t.Fatal(err)
	}
	if b, _ = s.Bootstrap(ctx); b.Memory.ProviderID != "" {
		t.Fatal("删除服务后应清空纪要设置")
	}
}

type failProvider struct{}

func (failProvider) Stream(context.Context, llm.Request, func(string)) (llm.Usage, error) {
	return llm.Usage{}, errors.New("401 Unauthorized：API Key 无效")
}

// 失败的消息重试后应在原位置变成成功回复（ID、Seq 不变）。
func TestServiceRetryInPlace(t *testing.T) {
	ended := make(chan struct{}, 4)
	s, db := fixture(t, func(e Event) {
		if e["kind"] == "turn.end" {
			ended <- struct{}{}
		}
	})
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "重试", MemberIDs: []string{"a"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	s.turns.Providers = func(context.Context, domain.Provider) (llm.Provider, error) {
		calls++
		if calls == 1 {
			return failProvider{}, nil
		}
		return replyProvider{}, nil
	}
	if _, err = s.Send(ctx, g.ID, "@青砚 开始", nil); err != nil {
		t.Fatal(err)
	}
	<-ended
	d, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	var failed Message
	for _, m := range d.Messages {
		if m.AuthorKind == "member" {
			failed = m
		}
	}
	if failed.Status != "error" {
		t.Fatalf("expected failed reply, got %+v", failed)
	}
	if err = s.Retry(ctx, failed.ID); err != nil {
		t.Fatal(err)
	}
	<-ended
	d, err = s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range d.Messages {
		if m.ID != failed.ID {
			continue
		}
		if m.Seq != failed.Seq || m.Status != "done" || m.Content != "真实回复" {
			t.Fatalf("retry should regenerate in place: %+v", m)
		}
		return
	}
	t.Fatal("重试后的消息不见了")
}

type staticProvider struct{ text string }

func (p staticProvider) Stream(_ context.Context, _ llm.Request, delta func(string)) (llm.Usage, error) {
	delta(p.text)
	return llm.Usage{}, nil
}

// 一轮结束后 AfterTurn 钩子应触发整理，并把结果通过 memory 事件推给前端。
func TestAfterTurnTriggersMemorySummarize(t *testing.T) {
	mem := make(chan Event, 8)
	s, db := fixture(t, func(e Event) {
		if e["kind"] == "memory" {
			mem <- e
		}
	})
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "整理", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	// 直接写入 8 条已结束的消息，达到 DefaultPolicy 的触发条件。
	for i := 1; i <= 8; i++ {
		kind, author := domain.AuthorUser, domain.UserID
		if i%2 == 0 {
			kind, author = domain.AuthorMember, "a"
		}
		m := domain.Message{GroupID: g.ID, AuthorKind: kind, AuthorID: author, Content: "一条讨论", Status: domain.StatusDone, CreatedAt: time.Now()}
		if err = db.InsertMessage(ctx, &m); err != nil {
			t.Fatal(err)
		}
	}
	s.runner.Providers = func(context.Context, domain.Provider) (llm.Provider, error) {
		return staticProvider{text: `{"ops":[{"op":"add","kind":"plan","content":"整理出的方案","sources":[1]}]}`}, nil
	}
	if _, err = s.Send(ctx, g.ID, "@青砚 继续", nil); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case e := <-mem:
			if b, _ := e["summarizing"].(bool); b {
				continue // 先到的是 summarizing=true
			}
			items, _ := e["items"].([]MemoryItem)
			if len(items) != 1 || items[0].Content != "整理出的方案" || items[0].Status != "proposed" {
				t.Fatalf("整理结果不对：%+v", items)
			}
			return
		case <-deadline:
			t.Fatal("一轮结束后没有触发整理")
		}
	}
}

func TestSummaryPreviewIgnoresUnfinishedPlaceholder(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()
	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "预览", MemberIDs: []string{"a"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	when := time.Now()
	asked := domain.Message{ID: "m1", GroupID: g.ID, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Content: "用户提问", Status: domain.StatusDone, CreatedAt: when}
	if err = db.InsertMessage(ctx, &asked); err != nil {
		t.Fatal(err)
	}
	// 回复进行中：空的 pending 占位不能顶掉上一次真正的内容。
	placeholder := domain.Message{ID: "m2", GroupID: g.ID, AuthorKind: domain.AuthorMember, AuthorID: "a", ReplyToID: "m1", Status: domain.StatusPending, CreatedAt: when}
	if err = db.InsertMessage(ctx, &placeholder); err != nil {
		t.Fatal(err)
	}
	group, err := db.Group(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	sum, err := s.summary(ctx, group)
	if err != nil || sum.LastMessage == nil || sum.LastMessage.Preview != "用户提问" {
		t.Fatalf("%+v %v", sum, err)
	}
}

func TestAppearanceSelectsAllPapersBeforeWindowCreation(t *testing.T) {
	for _, paper := range []string{"xuan", "su", "ma", "qing"} {
		a := Appearance{"day", paper, "ye", "m", "comfortable"}
		if a.EffectivePaper(true) != paper {
			t.Fatal(paper)
		}
	}
	for _, paper := range []string{"ye", "wujin"} {
		a := Appearance{"night", "xuan", paper, "m", "comfortable"}
		if a.EffectivePaper(false) != paper {
			t.Fatal(paper)
		}
		a.Mode = "system"
		if a.EffectivePaper(true) != paper || a.EffectivePaper(false) != "xuan" {
			t.Fatal("system theme")
		}
	}
}
