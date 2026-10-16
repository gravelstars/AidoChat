package app

import (
	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/turn"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDeltaBufferThresholdFlushAndClose(t *testing.T) {
	var mu sync.Mutex
	var got []Event
	b := newEventBuffer(func(e Event) { mu.Lock(); got = append(got, e); mu.Unlock() })
	b.push(turn.Event{Kind: turn.EventDelta, GroupID: "g", MessageID: "m", Delta: strings.Repeat("中", 21)})
	mu.Lock()
	n := len(got)
	mu.Unlock()
	if n != 0 {
		t.Fatal("flushed below 64 bytes")
	}
	b.push(turn.Event{Kind: turn.EventDelta, GroupID: "g", MessageID: "m", Delta: "a"})
	mu.Lock()
	n = len(got)
	mu.Unlock()
	if n != 1 {
		t.Fatal("threshold not flushed")
	}
	b.push(turn.Event{Kind: turn.EventDelta, GroupID: "g", MessageID: "m", Delta: "尾"})
	b.push(turn.Event{Kind: turn.EventMessage, GroupID: "g", Message: &domain.Message{ID: "m", Status: domain.StatusDone}})
	mu.Lock()
	if len(got) != 3 || got[1]["delta"] != "尾" || got[2]["kind"] != "message" {
		t.Fatalf("%+v", got)
	}
	mu.Unlock()
	b.push(turn.Event{Kind: turn.EventDelta, GroupID: "g", MessageID: "n", Delta: "timer"})
	deadline := time.Now().Add(time.Second)
	for {
		mu.Lock()
		n = len(got)
		mu.Unlock()
		if n == 4 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("40ms flush missing")
		}
		time.Sleep(time.Millisecond)
	}
	b.close()
	b.close()
}
