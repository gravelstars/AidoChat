package store

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/turn"
)

type providerFunc func(context.Context, llm.Request, func(string)) (llm.Usage, error)

func (f providerFunc) Stream(ctx context.Context, r llm.Request, d func(string)) (llm.Usage, error) {
	return f(ctx, r, d)
}

type fakeModels struct {
	mu       sync.Mutex
	requests map[string]llm.Request
	replies  map[string]func(context.Context, func(string)) error
}

func (f *fakeModels) provider(_ context.Context, p domain.Provider) (llm.Provider, error) {
	return providerFunc(func(ctx context.Context, r llm.Request, d func(string)) (llm.Usage, error) {
		f.mu.Lock()
		f.requests[p.ID] = r
		reply := f.replies[p.ID]
		f.mu.Unlock()
		return llm.Usage{}, reply(ctx, d)
	}), nil
}
func say(text string) func(context.Context, func(string)) error {
	return func(_ context.Context, d func(string)) error {
		for _, r := range text {
			d(string(r))
		}
		return nil
	}
}
func setupTurn(t *testing.T) (*Store, *turn.Orchestrator, *fakeModels, <-chan struct{}) {
	t.Helper()
	s := openTest(t)
	seed(t, s)
	f := &fakeModels{requests: map[string]llm.Request{}, replies: map[string]func(context.Context, func(string)) error{"mo": say("墨白回答"), "qy": say("青砚回答")}}
	ended := make(chan struct{})
	o := &turn.Orchestrator{Store: s, Providers: f.provider, NewID: NewID, Now: time.Now, Emit: func(e turn.Event) {
		if e.Kind == turn.EventTurnEnd {
			close(ended)
		}
	}}
	t.Cleanup(func() {
		if o.Busy("g") {
			o.Stop("g")
			await(t, ended)
		}
	})
	return s, o, f, ended
}
func await(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("等待轮次超时")
	}
}
func byAuthor(t *testing.T, s *Store, id string) domain.Message {
	t.Helper()
	messages, err := s.RecentMessages(ctx, "g", 100)
	must(t, err)
	for _, m := range messages {
		if m.AuthorID == id {
			return m
		}
	}
	t.Fatalf("missing author %s", id)
	return domain.Message{}
}
func TestSQLiteSerialOrderAndContext(t *testing.T) {
	s, o, f, ended := setupTurn(t)
	result, err := o.Send(ctx, "g", "@青砚 @墨白 看看", nil)
	must(t, err)
	await(t, ended)
	if len(result.Order) != 2 || result.Order[0] != "qy" || result.Order[1] != "mo" {
		t.Fatal(result.Order)
	}
	first, second := byAuthor(t, s, "qy"), byAuthor(t, s, "mo")
	if first.Status != domain.StatusDone || second.Status != domain.StatusDone || second.ContextSeq != first.Seq {
		t.Fatalf("first=%+v second=%+v", first, second)
	}
	if !strings.Contains(f.requests["mo"].Messages[0].Content, "青砚回答") {
		t.Fatal("第二位未看到前一位回复")
	}
	if o.Busy("g") {
		t.Fatal("轮次锁未释放")
	}
}
func TestSQLiteSerialContinuesAfterError(t *testing.T) {
	s, o, f, ended := setupTurn(t)
	f.replies["mo"] = func(context.Context, func(string)) error { return errors.New("401 unauthorized") }
	_, err := o.Send(ctx, "g", "@所有人 开工", nil)
	must(t, err)
	await(t, ended)
	if byAuthor(t, s, "mo").Status != domain.StatusError || byAuthor(t, s, "qy").Status != domain.StatusDone {
		t.Fatal("失败后未继续")
	}
	if !strings.Contains(f.requests["qy"].System, "排在你前面的成员没有成功回复") {
		t.Fatal("未标明失败缺口")
	}
}
func TestSQLiteParallelAndBusy(t *testing.T) {
	s, o, f, ended := setupTurn(t)
	started := make(chan struct{}, 2)
	gate := make(chan struct{})
	reply := func(ctx context.Context, d func(string)) error {
		started <- struct{}{}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-gate:
			d("ok")
			return nil
		}
	}
	f.replies["mo"], f.replies["qy"] = reply, reply
	mode := domain.ModeParallel
	_, err := o.Send(ctx, "g", "@所有人 各说各的", &mode)
	must(t, err)
	for i := 0; i < 2; i++ {
		await(t, started)
	}
	if _, err := o.Send(ctx, "g", "插一句", nil); !errors.Is(err, turn.ErrBusy) {
		t.Fatalf("want busy: %v", err)
	}
	if byAuthor(t, s, "mo").Status != domain.StatusStreaming || byAuthor(t, s, "qy").Status != domain.StatusStreaming {
		t.Fatal("未同时输出")
	}
	close(gate)
	await(t, ended)
	for _, id := range []string{"mo", "qy"} {
		m := byAuthor(t, s, id)
		if m.Status != domain.StatusDone || m.ContextSeq != 1 {
			t.Fatalf("并行上下文不应含其他回复：%+v", m)
		}
	}
}
func TestSQLiteStopKeepsPartialAndCancelsQueue(t *testing.T) {
	s, o, f, ended := setupTurn(t)
	started := make(chan struct{})
	f.replies["mo"] = func(ctx context.Context, d func(string)) error {
		d("写了一半")
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	_, err := o.Send(ctx, "g", "@所有人 长文", nil)
	must(t, err)
	await(t, started)
	o.Stop("g")
	await(t, ended)
	first, second := byAuthor(t, s, "mo"), byAuthor(t, s, "qy")
	if first.Status != domain.StatusStopped || first.Content != "写了一半" || second.Status != domain.StatusStopped || second.Content != "" {
		t.Fatalf("%+v %+v", first, second)
	}
}
func TestSQLiteNoMentionOnlyStoresNote(t *testing.T) {
	s, o, f, _ := setupTurn(t)
	result, err := o.Send(ctx, "g", "记一下：周五评审", nil)
	must(t, err)
	messages, err := s.RecentMessages(ctx, "g", 100)
	must(t, err)
	if len(result.Order) != 0 || len(messages) != 1 || o.Busy("g") || len(f.requests) != 0 {
		t.Fatal("无 @ 应只记录")
	}
}
