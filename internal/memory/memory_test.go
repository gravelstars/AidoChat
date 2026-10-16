package memory

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
)

var now = time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)

func env() Env {
	n := 0
	return Env{
		GroupID: "g",
		Members: map[string]domain.Member{"mo": {ID: "mo", Name: "墨白"}, "qy": {ID: "qy", Name: "青砚"}},
		NewID:   func() string { n++; return fmt.Sprintf("new%d", n) },
		Now:     now,
	}
}

func window() []domain.Message {
	return []domain.Message{
		{ID: "a", Seq: 10, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Content: "首页要不要改", Status: domain.StatusDone},
		{ID: "b", Seq: 11, AuthorKind: domain.AuthorMember, AuthorID: "mo", Content: "建议单列", Status: domain.StatusDone},
		{ID: "c", Seq: 12, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID, Content: "就单列吧，低保真稿我已经画完了", Status: domain.StatusDone},
	}
}

func existing() []domain.MemoryItem {
	return []domain.MemoryItem{
		{ID: "x1", Ref: 1, Kind: domain.MemoryDecision, Content: "用 Go 写后端", Status: domain.MemoryConfirmed},
		{ID: "x2", Ref: 2, Kind: domain.MemoryPlan, Content: "首页用轮播", Status: domain.MemoryProposed, Origin: domain.OriginMember},
		{ID: "x3", Ref: 3, Kind: domain.MemoryTodo, Content: "画低保真稿", Status: domain.MemoryProposed, Origin: domain.OriginUser},
	}
}

func TestApplyHappyPath(t *testing.T) {
	ops, err := ParseOps("好的，结果如下：\n```json\n" + `{"ops":[
		{"op":"add","kind":"decision","content":"首页改为单列布局","origin":"user","proposed_by":"墨白","sources":[11,12]},
		{"op":"supersede","ref":2,"by":0,"sources":[12]},
		{"op":"complete","ref":3,"sources":[12]}
	]}` + "\n```")
	if err != nil {
		t.Fatal(err)
	}
	res := Apply(existing(), ops, window(), env())
	if len(res.Rejected) != 0 {
		t.Fatalf("unexpected rejects: %v", res.Rejected)
	}
	added := res.Items[3]
	if added.Ref != 4 || added.Status != domain.MemoryProposed || added.Origin != domain.OriginUser || added.ProposedBy != domain.UserID {
		t.Errorf("added item wrong: %+v", added)
	}
	if res.Items[1].Status != domain.MemorySuperseded || res.Items[1].SupersededBy != added.ID {
		t.Errorf("supersede failed: %+v", res.Items[1])
	}
	if res.Items[2].Status != domain.MemoryDone {
		t.Errorf("complete failed: %+v", res.Items[2])
	}
	if res.Cursor != 12 || len(res.Changed) != 3 {
		t.Errorf("cursor=%d changed=%v", res.Cursor, res.Changed)
	}
}

func TestApplyGuardsInvariants(t *testing.T) {
	ops := []Op{
		{Op: "update", Ref: 1, Content: "改用 Rust", Sources: []int64{11}},                                      // 已确认不可改
		{Op: "add", Kind: "plan", Content: "瞎编的", Origin: "member", Sources: []int64{99}},                     // 来源不存在
		{Op: "add", Kind: "plan", Content: "AI 冒充用户", Origin: "user", ProposedBy: "墨白", Sources: []int64{11}}, // 降级为 member
		{Op: "complete", Ref: 3, Sources: []int64{11}},                                                        // 无用户证据
		{Op: "add", Kind: "opinion", Content: "x", Sources: []int64{11}},                                      // 未知类别
		{Op: "add", Kind: "plan", Content: strings.Repeat("长", 200), Sources: []int64{11}},                    // 过长
		{Op: "confirm", Ref: 2, Sources: []int64{12}},                                                         // 不存在的操作
	}
	res := Apply(existing(), ops, window(), env())
	if len(res.Rejected) != 6 {
		t.Fatalf("want 6 rejects, got %d: %v", len(res.Rejected), res.Rejected)
	}
	if res.Items[0].Content != "用 Go 写后端" || res.Items[2].Status != domain.MemoryProposed {
		t.Error("protected items were modified")
	}
	downgraded := res.Items[3]
	if downgraded.Origin != domain.OriginMember || downgraded.ProposedBy != "mo" {
		t.Errorf("should downgrade to member origin by 墨白: %+v", downgraded)
	}
	for _, it := range res.Items {
		if it.Status == domain.MemoryConfirmed && it.ID != "x1" {
			t.Fatal("AI must never produce confirmed items")
		}
	}
}

func TestPolicyPending(t *testing.T) {
	var h []domain.Message
	for i := 1; i <= 10; i++ {
		st := domain.StatusDone
		if i == 9 {
			st = domain.StatusError
		}
		h = append(h, domain.Message{Seq: int64(i), Content: "短", Status: st})
	}
	p := Policy{MinMessages: 7, MinTokens: 10000, MaxWindow: 5} // #3–#10 去掉失败的 #9 共 7 条
	got, ready := p.Pending(2, h, false)
	if !ready || len(got) != 5 || got[0].Seq != 3 {
		t.Errorf("ready=%v len=%d first=%d", ready, len(got), got[0].Seq)
	}
	if _, ready := p.Pending(6, h, false); ready {
		t.Error("3 visible messages should not trigger")
	}
	if _, ready := p.Pending(6, h, true); !ready {
		t.Error("force should trigger")
	}
}

func TestUserActions(t *testing.T) {
	it := existing()[1]
	c, err := Confirm(it, now)
	if err != nil || c.Status != domain.MemoryConfirmed || c.ConfirmedAt == nil {
		t.Fatalf("confirm: %+v %v", c, err)
	}
	if _, err := Confirm(c, now); err == nil {
		t.Error("double confirm should fail")
	}
	if r := Reopen(c, now); r.Status != domain.MemoryProposed || r.ConfirmedAt != nil {
		t.Error("reopen failed")
	}
	if e, _ := Edit(it, "  首页用单列  ", now); e.Origin != domain.OriginUser || e.Content != "首页用单列" {
		t.Errorf("edit: %+v", e)
	}
}
