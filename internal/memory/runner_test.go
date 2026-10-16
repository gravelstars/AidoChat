package memory

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

// fakeStore 是 Runner 需要的最小内存实现。
type fakeStore struct {
	mu       sync.Mutex
	group    domain.Group
	members  map[string]domain.Member
	messages []domain.Message
	items    []domain.MemoryItem
	provider domain.Provider
	settings map[string]string
}

func (s *fakeStore) Group(_ context.Context, id string) (domain.Group, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id != s.group.ID {
		return domain.Group{}, errors.New("群不存在")
	}
	return s.group, nil
}
func (s *fakeStore) Members(_ context.Context, ids []string) (map[string]domain.Member, error) {
	out := map[string]domain.Member{}
	for _, id := range ids {
		if m, ok := s.members[id]; ok {
			out[id] = m
		}
	}
	return out, nil
}
func (s *fakeStore) RecentMessages(_ context.Context, _ string, limit int) ([]domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit > 0 && len(s.messages) > limit {
		return slices.Clone(s.messages[len(s.messages)-limit:]), nil
	}
	return slices.Clone(s.messages), nil
}
func (s *fakeStore) VisibleMessagesAfter(_ context.Context, _ string, cursor int64, limit int) ([]domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []domain.Message{}
	for _, m := range s.messages {
		if m.Seq > cursor && m.Visible() && len(out) < limit {
			out = append(out, m)
		}
	}
	return out, nil
}
func (s *fakeStore) MemoryItems(_ context.Context, _ string) ([]domain.MemoryItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.items), nil
}
func (s *fakeStore) SaveMemoryItems(_ context.Context, _ string, items []domain.MemoryItem, cursor int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, it := range items {
		found := false
		for i := range s.items {
			if s.items[i].ID == it.ID {
				s.items[i] = it
				found = true
				break
			}
		}
		if !found {
			s.items = append(s.items, it)
		}
	}
	s.group.MemoryCursor = cursor
	return nil
}
func (s *fakeStore) Provider(_ context.Context, _ string) (domain.Provider, error) {
	return s.provider, nil
}
func (s *fakeStore) Setting(_ context.Context, key string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.settings[key]; ok {
		return v, nil
	}
	return "", sql.ErrNoRows
}
func (s *fakeStore) snapshot() (domain.Group, []domain.MemoryItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.group, slices.Clone(s.items)
}

// scriptProvider 每次 Stream 依次吐出预设文本，并记录调用次数。
type scriptProvider struct {
	mu        sync.Mutex
	responses []string
	calls     int
	gate      chan struct{} // 非 nil 时阻塞到收到信号，用于并发测试
}

func (p *scriptProvider) Stream(ctx context.Context, _ llm.Request, d func(string)) (llm.Usage, error) {
	p.mu.Lock()
	var resp string
	if p.calls < len(p.responses) {
		resp = p.responses[p.calls]
	}
	p.calls++
	gate := p.gate
	p.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return llm.Usage{}, ctx.Err()
		}
	}
	if resp != "" {
		d(resp)
	}
	return llm.Usage{}, nil
}
func (p *scriptProvider) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

func testWindow() []domain.Message {
	return []domain.Message{
		{ID: "m1", Seq: 1, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Content: "首页要不要改", Status: domain.StatusDone},
		{ID: "m2", Seq: 2, AuthorKind: domain.AuthorMember, AuthorID: "mo", Content: "建议单列", Status: domain.StatusDone},
		{ID: "m3", Seq: 3, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Content: "就单列，我来画稿", Status: domain.StatusDone},
	}
}

func newStore(messages []domain.Message) *fakeStore {
	return &fakeStore{
		group:    domain.Group{ID: "g", Title: "首页改版评审", MemberIDs: []string{"mo", "qy"}},
		members:  map[string]domain.Member{"mo": {ID: "mo", Name: "墨白", ProviderID: "p", Model: "m1"}, "qy": {ID: "qy", Name: "青砚", ProviderID: "p", Model: "m1"}},
		messages: messages,
		provider: domain.Provider{ID: "p", Name: "测试服务", Kind: "openai"},
		settings: map[string]string{},
	}
}

func newRunner(st *fakeStore, prov llm.Provider, events *[]Event, mu *sync.Mutex) *Runner {
	n := 0
	return &Runner{
		Store: st,
		Providers: func(context.Context, domain.Provider) (llm.Provider, error) {
			return prov, nil
		},
		NewID:  func() string { n++; return "k" + string(rune('0'+n)) },
		Now:    func() time.Time { return now },
		Policy: Policy{MinMessages: 3, MinTokens: 1 << 30, MaxWindow: 40},
		Emit: func(e Event) {
			mu.Lock()
			*events = append(*events, e)
			mu.Unlock()
		},
	}
}

// waitSummaryDone 等到收到 summarizing=false 的事件；超时返回 false。
func waitSummaryDone(t *testing.T, events *[]Event, mu *sync.Mutex) bool {
	t.Helper()
	return waitSummaryDoneFor(t, events, mu, 2*time.Second)
}

func waitSummaryDoneFor(t *testing.T, events *[]Event, mu *sync.Mutex, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		mu.Lock()
		for _, e := range *events {
			if !e.Summarizing {
				mu.Unlock()
				return true
			}
		}
		mu.Unlock()
		time.Sleep(2 * time.Millisecond)
	}
	return false
}

func TestRunnerSummarizesAtThreshold(t *testing.T) {
	st := newStore(testWindow())
	prov := &scriptProvider{responses: []string{`{"ops":[{"op":"add","kind":"decision","content":"首页改为单列布局","origin":"user","proposed_by":"墨白","sources":[3]}]}`}}
	var events []Event
	var mu sync.Mutex
	r := newRunner(st, prov, &events, &mu)

	r.Trigger("g")
	if !waitSummaryDone(t, &events, &mu) {
		t.Fatal("整理没有完成")
	}
	mu.Lock()
	if len(events) != 2 || !events[0].Summarizing || events[1].Summarizing {
		t.Fatalf("事件序列不对：%+v", events)
	}
	mu.Unlock()
	g, items := st.snapshot()
	if g.MemoryCursor != 3 {
		t.Fatalf("游标应为 3，得到 %d", g.MemoryCursor)
	}
	if len(items) != 1 || items[0].Content != "首页改为单列布局" || items[0].Status != domain.MemoryProposed || items[0].Origin != domain.OriginUser {
		t.Fatalf("新增条目不对：%+v", items)
	}
}

func TestRunnerBelowThresholdDoesNothing(t *testing.T) {
	st := newStore(testWindow()[:2]) // 只有 2 条可见消息
	prov := &scriptProvider{}
	var events []Event
	var mu sync.Mutex
	r := newRunner(st, prov, &events, &mu)

	r.Trigger("g")
	time.Sleep(50 * time.Millisecond)
	g, items := st.snapshot()
	if len(events) != 0 || prov.count() != 0 || g.MemoryCursor != 0 || len(items) != 0 {
		t.Fatalf("未达阈值却触发了整理：events=%d calls=%d cursor=%d items=%d", len(events), prov.count(), g.MemoryCursor, len(items))
	}
}

func TestRunnerProtectsConfirmedItems(t *testing.T) {
	st := newStore(testWindow())
	st.items = []domain.MemoryItem{{
		ID: "x1", GroupID: "g", Ref: 1, Kind: domain.MemoryDecision, Content: "用 Go 写后端",
		Status: domain.MemoryConfirmed, Origin: domain.OriginMember, ProposedBy: "mo",
		Sources: []domain.MemorySource{{MessageID: "m1", Seq: 1, Role: domain.SourceProposed}},
	}}
	// AI 试图修改已确认条目，并新增一条不存在的来源。
	prov := &scriptProvider{responses: []string{`{"ops":[
		{"op":"update","ref":1,"content":"改用 Rust","sources":[2]},
		{"op":"add","kind":"plan","content":"瞎编","sources":[99]}
	]}`}}
	var events []Event
	var mu sync.Mutex
	r := newRunner(st, prov, &events, &mu)

	r.Trigger("g")
	if !waitSummaryDone(t, &events, &mu) {
		t.Fatal("整理没有完成")
	}
	_, items := st.snapshot()
	var confirmed *domain.MemoryItem
	for i := range items {
		if items[i].Ref == 1 {
			confirmed = &items[i]
		}
		if items[i].Status == domain.MemoryConfirmed && items[i].Ref != 1 {
			t.Fatal("AI 不能产生新的 confirmed 条目")
		}
	}
	if confirmed == nil || confirmed.Content != "用 Go 写后端" || confirmed.Status != domain.MemoryConfirmed {
		t.Fatalf("已确认条目被修改：%+v", confirmed)
	}
	if len(items) != 1 {
		t.Fatalf("不合规的 add 不应落库：%+v", items)
	}
}

func TestRunnerCoalescesConcurrentTriggers(t *testing.T) {
	st := newStore(testWindow())
	gate := make(chan struct{})
	prov := &scriptProvider{responses: []string{`{"ops":[]}`}, gate: gate}
	var events []Event
	var mu sync.Mutex
	r := newRunner(st, prov, &events, &mu)

	for range 5 {
		r.Trigger("g")
	}
	// 等第一次调用进入 provider（阻塞在 gate），再放行。
	deadline := time.Now().Add(time.Second)
	for prov.count() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if prov.count() != 1 {
		t.Fatalf("并发触发应合并为一次整理，实际调用 %d 次", prov.count())
	}
	close(gate)
	if !waitSummaryDone(t, &events, &mu) {
		t.Fatal("整理没有完成")
	}
	if prov.count() != 1 {
		t.Fatalf("合并后仍触发了额外整理：%d 次", prov.count())
	}
}

func TestRunnerParseFailureKeepsCursor(t *testing.T) {
	st := newStore(testWindow())
	prov := &scriptProvider{responses: []string{"这不是 JSON", "仍然不是"}}
	var events []Event
	var mu sync.Mutex
	r := newRunner(st, prov, &events, &mu)

	r.Trigger("g")
	if !waitSummaryDone(t, &events, &mu) {
		t.Fatal("整理没有结束")
	}
	if prov.count() != 2 { // 失败后重试一次
		t.Fatalf("解析失败应重试一次，实际 %d 次", prov.count())
	}
	g, items := st.snapshot()
	if g.MemoryCursor != 0 || len(items) != 0 {
		t.Fatalf("解析失败不应推进游标或写入：cursor=%d items=%d", g.MemoryCursor, len(items))
	}
	mu.Lock()
	defer mu.Unlock()
	last := events[len(events)-1]
	if last.Summarizing {
		t.Fatal("最后事件应结束整理态")
	}
}

func TestRunnerUsesConfiguredModel(t *testing.T) {
	st := newStore(testWindow())
	st.settings["memory.provider_id"] = `"p"`
	st.settings["memory.model"] = `"big-model"`
	var seen llm.Request
	prov := &captureProvider{on: func(r llm.Request) { seen = r }, text: `{"ops":[]}`}
	var events []Event
	var mu sync.Mutex
	r := newRunner(st, prov, &events, &mu)

	r.Summarize(context.Background(), "g")
	if !waitSummaryDone(t, &events, &mu) {
		t.Fatal("整理没有完成")
	}
	if seen.Model != "big-model" || !strings.Contains(seen.System, "纪要整理员") {
		t.Fatalf("未使用配置的整理模型：%+v", seen)
	}
}

type captureProvider struct {
	on   func(llm.Request)
	text string
}

func (p *captureProvider) Stream(_ context.Context, r llm.Request, d func(string)) (llm.Usage, error) {
	p.on(r)
	d(p.text)
	return llm.Usage{}, nil
}
