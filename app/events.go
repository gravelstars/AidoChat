package app

import (
	"ai-group-chat/internal/turn"
	"sync"
	"time"
)

const EventName = "backend:event"

type Event map[string]any

type deltaBuffer struct {
	groupID string
	text    string
	timer   *time.Timer
}
type eventBuffer struct {
	mu      sync.Mutex
	pending map[string]*deltaBuffer
	emit    func(Event)
	closed  bool
}

func newEventBuffer(emit func(Event)) *eventBuffer {
	if emit == nil {
		emit = func(Event) {}
	}
	return &eventBuffer{pending: map[string]*deltaBuffer{}, emit: emit}
}

// 所有出口共用一把锁，计时器和不同成员并行生成时也不会越过完整消息事件。
func (b *eventBuffer) push(e turn.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	switch e.Kind {
	case turn.EventDelta:
		d := b.pending[e.MessageID]
		if d == nil {
			d = &deltaBuffer{groupID: e.GroupID}
			b.pending[e.MessageID] = d
			d.timer = time.AfterFunc(40*time.Millisecond, func() {
				b.mu.Lock()
				defer b.mu.Unlock()
				if b.pending[e.MessageID] == d {
					b.flush(e.MessageID)
				}
			})
		}
		d.text += e.Delta
		if len(d.text) >= 64 {
			b.flush(e.MessageID)
		}
	case turn.EventMessage:
		if e.Message == nil {
			return
		}
		b.flush(e.Message.ID)
		b.emit(Event{"kind": "message", "groupId": e.GroupID, "message": messageDTO(*e.Message)})
	case turn.EventTurnStart:
		b.emit(Event{"kind": "turn.start", "groupId": e.GroupID, "turnId": e.TurnID, "order": nonnil(e.Order)})
	case turn.EventTurnEnd:
		for id, d := range b.pending {
			if d.groupID == e.GroupID {
				b.flush(id)
			}
		}
		b.emit(Event{"kind": "turn.end", "groupId": e.GroupID, "turnId": e.TurnID})
	}
}
func (b *eventBuffer) flush(id string) {
	d := b.pending[id]
	if d == nil {
		return
	}
	d.timer.Stop()
	delete(b.pending, id)
	if d.text != "" {
		b.emit(Event{"kind": "delta", "groupId": d.groupID, "messageId": id, "delta": d.text})
	}
}
func (b *eventBuffer) send(e Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.closed {
		b.emit(e)
	}
}
func (b *eventBuffer) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	for id := range b.pending {
		b.flush(id)
	}
	b.closed = true
}
