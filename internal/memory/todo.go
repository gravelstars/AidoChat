// todo.go 是用户对待办的勾选操作（TASK-010）。memory.go 里的 AI 校验规则不变；
// 这里只补"用户完成/撤销完成"，同样不改变任何 AI 权限。
package memory

import (
	"fmt"
	"time"

	"ai-group-chat/internal/domain"
)

// Complete 由用户把一条待办标记为完成：仅对 todo 生效，完成即 done，ConfirmedAt 不变。
func Complete(it domain.MemoryItem, now time.Time) (domain.MemoryItem, error) {
	if it.Kind != domain.MemoryTodo {
		return it, fmt.Errorf("M%d 不是待办", it.Ref)
	}
	switch it.Status {
	case domain.MemoryDone:
		return it, nil
	case domain.MemoryProposed, domain.MemoryConfirmed:
		it.Status, it.UpdatedAt = domain.MemoryDone, now
		return it, nil
	default:
		return it, fmt.Errorf("M%d 当前状态 %s 不能完成", it.Ref, it.Status)
	}
}

// Uncomplete 撤销完成，回到未确认（ConfirmedAt 不变）。
func Uncomplete(it domain.MemoryItem, now time.Time) (domain.MemoryItem, error) {
	if it.Kind != domain.MemoryTodo {
		return it, fmt.Errorf("M%d 不是待办", it.Ref)
	}
	if it.Status != domain.MemoryDone {
		return it, fmt.Errorf("M%d 不是已完成状态", it.Ref)
	}
	it.Status, it.UpdatedAt = domain.MemoryProposed, now
	return it, nil
}
