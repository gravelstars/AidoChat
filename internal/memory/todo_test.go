package memory

import (
	"testing"
	"time"

	"ai-group-chat/internal/domain"
)

func TestTodoCompleteUncomplete(t *testing.T) {
	todo := domain.MemoryItem{ID: "t", Ref: 3, Kind: domain.MemoryTodo, Status: domain.MemoryProposed}
	done, err := Complete(todo, now)
	if err != nil || done.Status != domain.MemoryDone {
		t.Fatalf("complete: %+v %v", done, err)
	}
	if _, err := Complete(domain.MemoryItem{Ref: 4, Kind: domain.MemoryPlan, Status: domain.MemoryProposed}, now); err == nil {
		t.Fatal("非待办不应能完成")
	}
	back, err := Uncomplete(done, now)
	if err != nil || back.Status != domain.MemoryProposed {
		t.Fatalf("uncomplete: %+v %v", back, err)
	}
	if _, err := Uncomplete(todo, now); err == nil {
		t.Fatal("未完成的待办不能撤销完成")
	}

	confirmed := now
	ct := domain.MemoryItem{ID: "c", Ref: 5, Kind: domain.MemoryTodo, Status: domain.MemoryConfirmed, ConfirmedAt: &confirmed}
	got, err := Complete(ct, now.Add(time.Hour))
	if err != nil || got.Status != domain.MemoryDone {
		t.Fatalf("%+v %v", got, err)
	}
	if got.ConfirmedAt == nil || !got.ConfirmedAt.Equal(confirmed) {
		t.Fatal("完成待办不应改动 ConfirmedAt")
	}
}
