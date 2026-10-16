package memory

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

type regressionProvider func(context.Context, llm.Request, func(string)) (llm.Usage, error)

func (f regressionProvider) Stream(c context.Context, r llm.Request, d func(string)) (llm.Usage, error) {
	return f(c, r, d)
}
func TestRunnerTransportRetrySuccessAdvancesCursor(t *testing.T) {
	st := newStore(testWindow())
	calls := 0
	p := regressionProvider(func(_ context.Context, _ llm.Request, d func(string)) (llm.Usage, error) {
		calls++
		if calls == 1 {
			d(`{"ops":`)
			return llm.Usage{}, errors.New("connection reset")
		}
		d(`{"ops":[]}`)
		return llm.Usage{}, nil
	})
	events := []Event{}
	mu := sync.Mutex{}
	r := newRunner(st, p, &events, &mu)
	r.once(context.Background(), "g", true)
	g, _ := st.snapshot()
	if calls != 2 || g.MemoryCursor != 3 {
		t.Fatalf("successful second request discarded: calls=%d cursor=%d", calls, g.MemoryCursor)
	}
}
func TestRunnerFailureEventPreservesUserConfirmation(t *testing.T) {
	st := newStore(testWindow())
	st.items = []domain.MemoryItem{{ID: "k", GroupID: "g", Ref: 1, Status: domain.MemoryProposed}}
	p := regressionProvider(func(_ context.Context, _ llm.Request, d func(string)) (llm.Usage, error) {
		st.mu.Lock()
		st.items[0].Status = domain.MemoryConfirmed
		st.mu.Unlock()
		d(`{"ops":[]}`)
		return llm.Usage{}, errors.New("network failed")
	})
	events := []Event{}
	mu := sync.Mutex{}
	r := newRunner(st, p, &events, &mu)
	r.once(context.Background(), "g", true)
	_, items := st.snapshot()
	last := events[len(events)-1]
	if last.Items[0].Status != items[0].Status {
		t.Fatalf("DB status=%s but last UI event status=%s", items[0].Status, last.Items[0].Status)
	}
}
func TestRunnerHistoryCapDoesNotSkipUnprocessedMessages(t *testing.T) {
	ms := make([]domain.Message, 1001)
	for i := range ms {
		ms[i] = domain.Message{ID: fmt.Sprint(i + 1), Seq: int64(i + 1), AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Content: "discussion", Status: domain.StatusDone}
	}
	st := newStore(ms)
	p := regressionProvider(func(_ context.Context, _ llm.Request, d func(string)) (llm.Usage, error) {
		d(`{"ops":[]}`)
		return llm.Usage{}, nil
	})
	events := []Event{}
	mu := sync.Mutex{}
	r := newRunner(st, p, &events, &mu)
	r.once(context.Background(), "g", true)
	g, _ := st.snapshot()
	if g.MemoryCursor != 40 {
		t.Fatalf("expected first window #1-40, got cursor=%d (message #1 permanently skipped)", g.MemoryCursor)
	}
}

// 用户更新与整理最终事件必须按同一写入顺序发送，不能先盖章、再被旧事件覆盖。
func TestRunnerFinalEventPrecedesConcurrentUserChange(t *testing.T) {
	st := newStore(testWindow())
	st.items = []domain.MemoryItem{{ID: "k", GroupID: "g", Ref: 1, Status: domain.MemoryProposed}}
	p := regressionProvider(func(_ context.Context, _ llm.Request, d func(string)) (llm.Usage, error) {
		d(`{"ops":[]}`)
		return llm.Usage{}, nil
	})
	events := []Event{}
	var eventMu, writeMu sync.Mutex
	r := newRunner(st, p, &events, &eventMu)
	r.Write = &writeMu
	entered := make(chan struct{})
	allow := make(chan struct{})
	done := make(chan struct{})
	userDone := make(chan struct{})
	r.Emit = func(e Event) {
		if !e.Summarizing {
			close(entered)
			<-allow
		}
		eventMu.Lock()
		events = append(events, e)
		eventMu.Unlock()
	}
	go func() { r.once(context.Background(), "g", true); close(done) }()
	<-entered
	go func() {
		writeMu.Lock()
		defer writeMu.Unlock()
		st.mu.Lock()
		st.items[0].Status = domain.MemoryConfirmed
		st.mu.Unlock()
		g, items := st.snapshot()
		eventMu.Lock()
		events = append(events, Event{GroupID: "g", Items: items, Cursor: g.MemoryCursor})
		eventMu.Unlock()
		close(userDone)
	}()
	// 给用户操作机会争取写锁；最终事件仍阻塞时，它必须尚未完成。
	var overtook bool
	select {
	case <-userDone:
		overtook = true
	case <-time.After(30 * time.Millisecond):
	}
	close(allow)
	<-done
	<-userDone
	if overtook || events[len(events)-1].Items[0].Status != domain.MemoryConfirmed {
		t.Fatal("stale final event overtook user confirmation")
	}
}
