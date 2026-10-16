package contextbuilder

import (
	"strings"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

var t0 = time.Date(2026, 10, 15, 10, 0, 0, 0, time.UTC)

type fixture struct {
	group   domain.Group
	members map[string]domain.Member
	history []domain.Message
}

func newFixture() *fixture {
	mo := domain.Member{ID: "mo", Name: "墨白", Brief: "前端设计", RolePrompt: "你是资深前端设计师。"}
	qy := domain.Member{ID: "qy", Name: "青砚", Brief: "代码审查"}
	return &fixture{
		group:   domain.Group{ID: "g", Title: "产品评审群", Topic: "首页改版", MemberIDs: []string{"mo", "qy"}},
		members: map[string]domain.Member{"mo": mo, "qy": qy},
	}
}

func (f *fixture) add(kind domain.AuthorKind, author, content, turn string, status domain.MessageStatus) domain.Message {
	seq := int64(len(f.history) + 1)
	m := domain.Message{
		ID: "msg" + string(rune('a'+seq)), GroupID: "g", Seq: seq, AuthorKind: kind, AuthorID: author,
		Content: content, TurnID: turn, Status: status, CreatedAt: t0.Add(time.Duration(seq) * time.Minute),
	}
	if kind == domain.AuthorMember {
		for _, h := range f.history {
			if h.TurnID == turn && h.AuthorKind == domain.AuthorUser {
				m.ReplyToID = h.ID
			}
		}
	}
	f.history = append(f.history, m)
	return m
}

func (f *fixture) build(self string, user domain.Message, mode domain.ReplyMode, order ...string) Output {
	return Build(Input{
		Group: f.group, Members: f.members, Self: f.members[self], History: f.history,
		Turn: Turn{UserMessage: user, Mode: mode, Order: order}, Loc: time.UTC,
	})
}

func assertAlternating(t *testing.T, msgs []llm.Message) {
	t.Helper()
	if len(msgs) == 0 || msgs[0].Role != llm.RoleUser || msgs[len(msgs)-1].Role != llm.RoleUser {
		t.Fatalf("must start and end with user: %+v", msgs)
	}
	for i := 1; i < len(msgs); i++ {
		if msgs[i].Role == msgs[i-1].Role {
			t.Fatalf("roles not alternating at %d: %+v", i, msgs)
		}
	}
}

func TestSerialSecondSeesFirst(t *testing.T) {
	f := newFixture()
	u := f.add(domain.AuthorUser, domain.UserID, "@墨白 @青砚 看下首页方案", "t1", domain.StatusDone)
	f.add(domain.AuthorMember, "mo", "建议改成单列布局。", "t1", domain.StatusDone)
	f.add(domain.AuthorMember, "qy", "", "t1", domain.StatusStreaming)

	out := f.build("qy", u, domain.ModeSerial, "mo", "qy")
	assertAlternating(t, out.Request.Messages)
	all := out.Request.Messages[0].Content
	if !strings.Contains(all, "[#2 墨白 · 10-15 10:02 · 回复 #1]") || !strings.Contains(all, "单列布局") {
		t.Errorf("second speaker should see first reply with header, got:\n%s", all)
	}
	if !strings.Contains(out.Request.System, "你是第 2 位") || !strings.Contains(out.Request.System, "墨白（#2） 已经回复") {
		t.Errorf("turn block missing serial info:\n%s", out.Request.System)
	}
	if out.ContextSeq != 2 {
		t.Errorf("ContextSeq = %d, want 2", out.ContextSeq)
	}
}

func TestParallelHidesSameTurnReplies(t *testing.T) {
	f := newFixture()
	u := f.add(domain.AuthorUser, domain.UserID, "@墨白 @青砚 各自给方案", "t1", domain.StatusDone)
	f.add(domain.AuthorMember, "mo", "墨白的方案", "t1", domain.StatusDone) // 先完成了
	f.add(domain.AuthorMember, "qy", "", "t1", domain.StatusStreaming)

	out := f.build("qy", u, domain.ModeParallel, "mo", "qy")
	assertAlternating(t, out.Request.Messages)
	for _, m := range out.Request.Messages {
		if strings.Contains(m.Content, "墨白的方案") {
			t.Fatal("parallel mode must not leak same-turn replies")
		}
	}
	if !strings.Contains(out.Request.System, "同时独立作答") {
		t.Errorf("missing parallel instruction")
	}
}

func TestOwnMessagesAreAssistantWithoutHeader(t *testing.T) {
	f := newFixture()
	f.add(domain.AuthorUser, domain.UserID, "@墨白 第一个问题", "t1", domain.StatusDone)
	f.add(domain.AuthorMember, "mo", "第一个回答", "t1", domain.StatusDone)
	u := f.add(domain.AuthorUser, domain.UserID, "@墨白 追问", "t2", domain.StatusDone)

	out := f.build("mo", u, domain.ModeSerial, "mo")
	msgs := out.Request.Messages
	assertAlternating(t, msgs)
	if len(msgs) != 3 || msgs[1].Role != llm.RoleAssistant || msgs[1].Content != "第一个回答" {
		t.Errorf("own reply should be bare assistant message: %+v", msgs)
	}
	if !strings.HasPrefix(out.Request.System, "你是资深前端设计师。") {
		t.Errorf("role prompt should lead system prompt")
	}
}

func TestOthersMergedIntoOneUserMessage(t *testing.T) {
	f := newFixture()
	f.add(domain.AuthorUser, domain.UserID, "@青砚 审一下", "t1", domain.StatusDone)
	f.add(domain.AuthorMember, "qy", "有两个问题", "t1", domain.StatusDone)
	f.add(domain.AuthorMember, "mo", "", "t1", domain.StatusError) // 失败的不可见
	u := f.add(domain.AuthorUser, domain.UserID, "@墨白 你怎么看青砚的意见", "t2", domain.StatusDone)

	out := f.build("mo", u, domain.ModeSerial, "mo")
	msgs := out.Request.Messages
	if len(msgs) != 1 {
		t.Fatalf("all foreign messages should merge into one user message, got %d", len(msgs))
	}
	c := msgs[0].Content
	if !(strings.Index(c, "#1 用户") < strings.Index(c, "#2 青砚") && strings.Index(c, "#2 青砚") < strings.Index(c, "#4 用户")) {
		t.Errorf("order broken:\n%s", c)
	}
}

func TestHistoryStartingWithOwnMessageGetsLeadIn(t *testing.T) {
	f := newFixture()
	f.add(domain.AuthorUser, domain.UserID, strings.Repeat("很长的旧消息", 400), "t0", domain.StatusDone)
	f.add(domain.AuthorMember, "mo", "旧回答", "t0", domain.StatusDone)
	u := f.add(domain.AuthorUser, domain.UserID, "@墨白 继续", "t1", domain.StatusDone)

	out := Build(Input{
		Group: f.group, Members: f.members, Self: f.members["mo"], History: f.history,
		Turn: Turn{UserMessage: u, Mode: domain.ModeSerial, Order: []string{"mo"}}, Budget: 900, Loc: time.UTC,
	})
	assertAlternating(t, out.Request.Messages)
	if out.Dropped != 1 {
		t.Errorf("Dropped = %d, want 1", out.Dropped)
	}
	if !strings.Contains(out.Request.System, "#1–#1 之间有 1 条讨论因篇幅未展示") {
		t.Errorf("should disclose unsummarized gap:\n%s", out.Request.System)
	}
}

func TestMemoryRenderingDistinguishesConfirmation(t *testing.T) {
	f := newFixture()
	u := f.add(domain.AuthorUser, domain.UserID, "@墨白 继续", "t1", domain.StatusDone)
	confirmed := t0.Add(5 * time.Minute)
	f.group.MemoryCursor = 0
	mem := []domain.MemoryItem{
		{ID: "a", Ref: 1, Kind: domain.MemoryDecision, Content: "首页改单列", Status: domain.MemoryConfirmed, Origin: domain.OriginMember,
			ProposedBy: "mo", Sources: []domain.MemorySource{{Seq: 12, Role: domain.SourceProposed}}, ConfirmedAt: &confirmed},
		{ID: "b", Ref: 2, Kind: domain.MemoryPlan, Content: "加骨架屏", Status: domain.MemoryProposed, Origin: domain.OriginMember, ProposedBy: "qy",
			Sources: []domain.MemorySource{{Seq: 13, Role: domain.SourceProposed}}},
		{ID: "c", Ref: 3, Kind: domain.MemoryPlan, Content: "用轮播图", Status: domain.MemoryRejected, Origin: domain.OriginMember, ProposedBy: "mo"},
		{ID: "d", Ref: 4, Kind: domain.MemoryTodo, Content: "出低保真稿", Status: domain.MemoryProposed, Origin: domain.OriginUser, ProposedBy: domain.UserID},
		{ID: "e", Ref: 5, Kind: domain.MemoryTodo, Content: "已经做完的事", Status: domain.MemoryDone},
	}
	out := Build(Input{Group: f.group, Members: f.members, Self: f.members["mo"], History: f.history, Memory: mem,
		Turn: Turn{UserMessage: u, Mode: domain.ModeSerial, Order: []string{"mo"}}, Loc: time.UTC})
	s := out.Request.System
	for _, want := range []string{
		"- [已确认] M1 首页改单列（墨白 提出于 #12，用户确认于 10-15 10:05）",
		"- [AI建议·未确认] M2 加骨架屏（青砚 提出于 #13）",
		"- [待办·用户提出·未确认] M4 出低保真稿",
		"用户已否决（不要再提）：M3 用轮播图",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q in:\n%s", want, s)
		}
	}
	if strings.Contains(s, "已经做完的事") {
		t.Error("done items should not be in prompt")
	}
	if strings.Index(s, "决定：") > strings.Index(s, "方案：") {
		t.Error("decisions should come before plans")
	}
}

func TestSanitizeReply(t *testing.T) {
	cases := map[string]string{
		"[#5 墨白 · 10-15 10:03]\n正文":        "正文",
		"【墨白】：正文":                          "正文",
		"墨白：正文":                            "正文",
		"[#5 墨白 · 10-15 10:03 · 回复 #4] 正文": "正文",
		"【注意】这里要小心":                        "【注意】这里要小心",
		"[1] 参考资料":                         "[1] 参考资料",
		"正文里提到【墨白】没关系":                     "正文里提到【墨白】没关系",
	}
	for in, want := range cases {
		if got := SanitizeReply("墨白", in); got != want {
			t.Errorf("SanitizeReply(%q) = %q, want %q", in, got, want)
		}
	}
}
