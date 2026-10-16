package turn

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

// memStore 是测试用的内存实现，也可以作为 SQLite 实现的行为参照。
type memStore struct {
	mu       sync.Mutex
	group    domain.Group
	members  map[string]domain.Member
	messages []domain.Message
}

func (s *memStore) Group(context.Context, string) (domain.Group, error) { return s.group, nil }
func (s *memStore) Members(_ context.Context, ids []string) (map[string]domain.Member, error) {
	out := map[string]domain.Member{}
	for _, id := range ids {
		if m, ok := s.members[id]; ok {
			out[id] = m
		}
	}
	return out, nil
}
func (s *memStore) Provider(_ context.Context, id string) (domain.Provider, error) {
	return domain.Provider{ID: id, Name: id}, nil
}
func (s *memStore) Message(_ context.Context, id string) (domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.messages {
		if m.ID == id {
			return m, nil
		}
	}
	return domain.Message{}, errors.New("消息不存在")
}
func (s *memStore) RecentMessages(context.Context, string, int) ([]domain.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.messages), nil
}
func (s *memStore) MemoryItems(context.Context, string) ([]domain.MemoryItem, error) { return nil, nil }
func (s *memStore) InsertMessage(_ context.Context, m *domain.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m.Seq = int64(len(s.messages) + 1)
	s.messages = append(s.messages, *m)
	return nil
}
func (s *memStore) UpdateMessage(_ context.Context, m domain.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.messages {
		if s.messages[i].ID == m.ID {
			s.messages[i] = m
			return nil
		}
	}
	return errors.New("not found")
}
func (s *memStore) byAuthor(id string) domain.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.messages {
		if m.AuthorID == id {
			return m
		}
	}
	return domain.Message{}
}

// fakeLLM 按成员（ProviderID）返回预设行为，并记录收到的请求。
type fakeLLM struct {
	mu    sync.Mutex
	reqs  map[string]llm.Request
	reply map[string]func(ctx context.Context, onDelta func(string)) error
}

func (f *fakeLLM) providers(_ context.Context, p domain.Provider) (llm.Provider, error) {
	return providerFunc(func(ctx context.Context, req llm.Request, onDelta func(string)) (llm.Usage, error) {
		f.mu.Lock()
		f.reqs[p.ID] = req
		fn := f.reply[p.ID]
		f.mu.Unlock()
		return llm.Usage{}, fn(ctx, onDelta)
	}), nil
}

type providerFunc func(context.Context, llm.Request, func(string)) (llm.Usage, error)

func (p providerFunc) Stream(ctx context.Context, r llm.Request, d func(string)) (llm.Usage, error) {
	return p(ctx, r, d)
}

func say(text string) func(context.Context, func(string)) error {
	return func(_ context.Context, d func(string)) error {
		for _, r := range text {
			d(string(r))
		}
		return nil
	}
}

func setup(mode domain.ReplyMode) (*Orchestrator, *memStore, *fakeLLM, chan Event) {
	st := &memStore{
		group: domain.Group{ID: "g", Title: "群", DefaultMode: mode, MemberIDs: []string{"mo", "qy"}},
		members: map[string]domain.Member{
			"mo": {ID: "mo", Name: "墨白", ProviderID: "mo", Model: "m1"},
			"qy": {ID: "qy", Name: "青砚", ProviderID: "qy", Model: "m2"},
		},
	}
	f := &fakeLLM{reqs: map[string]llm.Request{}, reply: map[string]func(context.Context, func(string)) error{}}
	events := make(chan Event, 1024)
	n := 0
	var idMu sync.Mutex
	o := &Orchestrator{
		Store: st, Providers: f.providers, Emit: func(e Event) { events <- e },
		NewID: func() string { idMu.Lock(); defer idMu.Unlock(); n++; return fmt.Sprintf("id%d", n) },
		Now:   func() time.Time { return time.Date(2026, 10, 15, 10, 0, 0, 0, time.UTC) },
	}
	return o, st, f, events
}

func waitEnd(t *testing.T, events chan Event) {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case e := <-events:
			if e.Kind == EventTurnEnd {
				return
			}
		case <-timeout:
			t.Fatal("turn did not end")
		}
	}
}

func TestSerialSecondSeesFirstAndOrder(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	f.reply["mo"] = say("单列布局")
	f.reply["qy"] = say("同意墨白")

	res, err := o.Send(context.Background(), "g", "@青砚 @墨白 看看", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(res.Order, []string{"qy", "mo"}) {
		t.Fatalf("order follows mention order, got %v", res.Order)
	}
	waitEnd(t, events)

	if st.byAuthor("qy").Content != "同意墨白" || st.byAuthor("mo").Status != domain.StatusDone {
		t.Fatalf("unexpected results: %+v", st.messages)
	}
	// 墨白排第二，应看到青砚的回复
	if !strings.Contains(f.reqs["mo"].Messages[0].Content, "同意墨白") {
		t.Error("second speaker should see first reply")
	}
	if o.Busy("g") {
		t.Error("should release after turn")
	}
}

func TestSerialContinuesAfterError(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	f.reply["mo"] = func(context.Context, func(string)) error { return errors.New("401 unauthorized") }
	f.reply["qy"] = say("我来")

	if _, err := o.Send(context.Background(), "g", "@所有人 开工", nil); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	if m := st.byAuthor("mo"); m.Status != domain.StatusError || m.Error == "" {
		t.Errorf("mo should be error: %+v", m)
	}
	if st.byAuthor("qy").Status != domain.StatusDone {
		t.Error("qy should still reply")
	}
	if !strings.Contains(f.reqs["qy"].System, "排在你前面的成员没有成功回复") {
		t.Error("qy should be told the previous reply failed")
	}
}

func TestParallelOverrideAndBusy(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	gate := make(chan struct{})
	block := func(ctx context.Context, d func(string)) error { <-gate; d("ok"); return nil }
	f.reply["mo"], f.reply["qy"] = block, block

	par := domain.ModeParallel
	if _, err := o.Send(context.Background(), "g", "@墨白 @青砚 各说各的", &par); err != nil {
		t.Fatal(err)
	}
	if _, err := o.Send(context.Background(), "g", "@墨白 插一句", nil); !errors.Is(err, ErrBusy) {
		t.Errorf("want ErrBusy, got %v", err)
	}
	// 并行：两者应同时处于 streaming
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if st.byAuthor("mo").Status == domain.StatusStreaming && st.byAuthor("qy").Status == domain.StatusStreaming {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if st.byAuthor("mo").Status != domain.StatusStreaming || st.byAuthor("qy").Status != domain.StatusStreaming {
		t.Fatal("parallel replies should stream concurrently")
	}
	close(gate)
	waitEnd(t, events)
}

func TestStopKeepsPartialAndCancelsQueue(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	started := make(chan struct{})
	f.reply["mo"] = func(ctx context.Context, d func(string)) error {
		d("写了一半")
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	f.reply["qy"] = say("不该出现")

	if _, err := o.Send(context.Background(), "g", "@墨白 @青砚 长文", nil); err != nil {
		t.Fatal(err)
	}
	<-started
	o.Stop("g")
	waitEnd(t, events)

	if m := st.byAuthor("mo"); m.Status != domain.StatusStopped || m.Content != "写了一半" {
		t.Errorf("mo: %+v", m)
	}
	if m := st.byAuthor("qy"); m.Status != domain.StatusStopped || m.Content != "" {
		t.Errorf("queued qy should be stopped empty: %+v", m)
	}
}

func TestNoMentionIsJustANote(t *testing.T) {
	o, st, _, _ := setup(domain.ModeSerial)
	res, err := o.Send(context.Background(), "g", "记一下：周五评审", nil)
	if err != nil || len(res.Order) != 0 || len(st.messages) != 1 || o.Busy("g") {
		t.Fatalf("res=%+v err=%v msgs=%d", res, err, len(st.messages))
	}
}

func TestRetryFailedReplyInPlace(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	f.reply["mo"] = func(context.Context, func(string)) error { return errors.New("401 unauthorized") }
	if _, err := o.Send(context.Background(), "g", "@墨白 试试", nil); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	failed := st.byAuthor("mo")
	if failed.Status != domain.StatusError {
		t.Fatalf("expected error, got %+v", failed)
	}
	f.reply["mo"] = say("修好了")
	if err := o.Retry(context.Background(), failed.ID); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	got := st.byAuthor("mo")
	if got.ID != failed.ID || got.Seq != failed.Seq || got.TurnID != failed.TurnID || got.Status != domain.StatusDone || got.Content != "修好了" || got.Error != "" {
		t.Fatalf("retry should regenerate in place: %+v", got)
	}
	if o.Busy("g") {
		t.Error("retry should release the turn lock")
	}
}

func TestRetryStoppedRegenerates(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	started := make(chan struct{})
	f.reply["mo"] = func(ctx context.Context, d func(string)) error {
		d("半句")
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	if _, err := o.Send(context.Background(), "g", "@墨白 长文", nil); err != nil {
		t.Fatal(err)
	}
	<-started
	o.Stop("g")
	waitEnd(t, events)
	stopped := st.byAuthor("mo")
	if stopped.Status != domain.StatusStopped {
		t.Fatalf("expected stopped, got %+v", stopped)
	}
	f.reply["mo"] = say("重新生成完成")
	if err := o.Retry(context.Background(), stopped.ID); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	if got := st.byAuthor("mo"); got.Status != domain.StatusDone || got.Content != "重新生成完成" {
		t.Fatalf("regenerate: %+v", got)
	}
}

func TestRetryRejectsBusy(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	f.reply["mo"] = func(context.Context, func(string)) error { return errors.New("boom") }
	if _, err := o.Send(context.Background(), "g", "@墨白 先失败", nil); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	failed := st.byAuthor("mo")
	if failed.Status != domain.StatusError {
		t.Fatalf("expected error, got %+v", failed)
	}
	gate := make(chan struct{})
	f.reply["qy"] = func(ctx context.Context, d func(string)) error { d("进行中"); <-gate; return nil }
	if _, err := o.Send(context.Background(), "g", "@青砚 慢慢来", nil); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && st.byAuthor("qy").Status != domain.StatusStreaming {
		time.Sleep(2 * time.Millisecond)
	}
	if err := o.Retry(context.Background(), failed.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("want ErrBusy while a turn is running, got %v", err)
	}
	close(gate)
	waitEnd(t, events)
}

func TestRetryRejectsNonRetryable(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	f.reply["mo"] = say("好了")
	res, err := o.Send(context.Background(), "g", "@墨白 你好", nil)
	if err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	if err := o.Retry(context.Background(), st.byAuthor("mo").ID); !errors.Is(err, ErrNotRetryable) {
		t.Fatalf("done reply should not be retryable, got %v", err)
	}
	if err := o.Retry(context.Background(), res.UserMessage.ID); !errors.Is(err, ErrNotRetryable) {
		t.Fatalf("user message should not be retryable, got %v", err)
	}
}

func TestRetrySerialSeesEarlierReply(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	f.reply["mo"] = say("墨白的意见")
	f.reply["qy"] = func(context.Context, func(string)) error { return errors.New("boom") }
	if _, err := o.Send(context.Background(), "g", "@墨白 @青砚 讨论", nil); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	f.reply["qy"] = say("青砚补充")
	if err := o.Retry(context.Background(), st.byAuthor("qy").ID); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	// 依次模式下重试，应当看得到本轮排在自己前面、已完成的墨白回复。
	if !strings.Contains(f.reqs["qy"].Messages[0].Content, "墨白的意见") {
		t.Errorf("serial retry should see the earlier reply this turn: %+v", f.reqs["qy"].Messages)
	}
}
