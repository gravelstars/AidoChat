// Package contextbuilder 把"一个多人群聊"翻译成"一次单人对话 API 调用"。
//
// 这是产品行为质量的核心：成员能不能分清谁说了什么、会不会冒充别人、
// 会不会无视用户已拍板的决定，都取决于这里。改动前先读 docs/ARCHITECTURE.md 的
// 「上下文组装」一节，并保持 builder_test.go 全绿。
package contextbuilder

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

// Turn 描述本轮回复的编排信息。
type Turn struct {
	UserMessage domain.Message
	Mode        domain.ReplyMode
	Order       []string // 本轮回复者成员 ID，有序
}

type Input struct {
	Group   domain.Group
	Members map[string]domain.Member // 至少包含群成员与历史发言者
	Self    domain.Member
	// History 按 Seq 升序，可以只是最近若干条（由 store 决定加载多少）。
	History []domain.Message
	Memory  []domain.MemoryItem
	Turn    Turn
	// Budget 是整个请求（system + messages）的 token 预算；<=0 时用 Self.ContextTokens，再缺省为 16000。
	Budget int
	Loc    *time.Location
}

type Output struct {
	Request    llm.Request
	ContextSeq int64 // 模型看到的最后一条消息 Seq
	Included   int   // 进入上下文的历史消息条数
	Dropped    int   // 因预算被裁掉的可见历史条数
	EstTokens  int
}

const (
	defaultBudget = 16000
	memoryShare   = 0.30 // 群记忆最多占预算的比例
)

func Build(in Input) Output {
	budget := in.Budget
	if budget <= 0 {
		budget = in.Self.ContextTokens
	}
	if budget <= 0 {
		budget = defaultBudget
	}
	loc := in.Loc
	if loc == nil {
		loc = time.Local
	}
	b := builder{in: in, loc: loc}

	visible := b.visibleHistory()

	// 本轮必选：用户这条消息 + （串行时）本轮已完成的前序回复。
	turnStart := slices.IndexFunc(visible, func(m domain.Message) bool { return m.ID == in.Turn.UserMessage.ID })
	if turnStart < 0 {
		// 调用方应保证用户消息在 History 里；兜底追加，避免请求以非 user 结尾。
		visible = append(visible, in.Turn.UserMessage)
		turnStart = len(visible) - 1
	}

	memoryText := b.memoryBlock(int(float64(budget) * memoryShare))
	head := b.systemHead()
	turnText := b.turnBlock(visible[turnStart:])

	// 先算出必选部分，剩余预算从新到旧装历史。
	required := visible[turnStart:]
	used := llm.EstimateTokens(head) + llm.EstimateTokens(memoryText) + llm.EstimateTokens(turnText)
	for _, m := range required {
		used += llm.EstimateTokens(b.render(m)) + 4
	}
	start := turnStart
	for start > 0 {
		cost := llm.EstimateTokens(b.render(visible[start-1])) + 4
		if used+cost > budget {
			break
		}
		used += cost
		start--
	}
	window := visible[start:]

	gapText := b.gapNote(window, visible[:start])

	system := strings.Join(nonEmpty(head, memoryText, gapText, turnText), "\n\n")
	msgs := b.toMessages(window)

	return Output{
		Request: llm.Request{
			Model:       in.Self.Model,
			System:      system,
			Messages:    msgs,
			Temperature: in.Self.Temperature,
		},
		ContextSeq: window[len(window)-1].Seq,
		Included:   len(window),
		Dropped:    start,
		EstTokens:  used + llm.EstimateTokens(gapText),
	}
}

type builder struct {
	in  Input
	loc *time.Location
}

// visibleHistory 过滤出模型可以看到的消息。
func (b builder) visibleHistory() []domain.Message {
	t := b.in.Turn
	var out []domain.Message
	for _, m := range b.in.History {
		if m.Seq > t.UserMessage.Seq && m.TurnID != t.UserMessage.TurnID {
			continue // 本轮之后的消息（理论上不存在：一个群同时只有一个进行中的轮次）
		}
		if m.ID != t.UserMessage.ID && !m.Visible() {
			continue
		}
		if m.TurnID == t.UserMessage.TurnID && m.AuthorKind == domain.AuthorMember {
			// 并行：本轮其他人的回答一律不可见。串行：只有排在自己前面的可见（Visible 已排除未完成的）。
			if t.Mode == domain.ModeParallel || m.AuthorID == b.in.Self.ID {
				continue
			}
		}
		out = append(out, m)
	}
	return out
}

func (b builder) name(id string) string {
	if id == domain.UserID {
		return "用户"
	}
	if m, ok := b.in.Members[id]; ok {
		return m.Name
	}
	return "已退群成员"
}

func (b builder) clock(t time.Time) string {
	return t.In(b.loc).Format("01-02 15:04")
}

// render 把一条消息渲染成模型看到的文本。自己的发言不加标注（作为 assistant 角色）。
func (b builder) render(m domain.Message) string {
	if m.AuthorKind == domain.AuthorMember && m.AuthorID == b.in.Self.ID {
		return m.Content
	}
	var head string
	switch m.AuthorKind {
	case domain.AuthorUser:
		head = fmt.Sprintf("[#%d 用户 · %s]", m.Seq, b.clock(m.CreatedAt))
	case domain.AuthorSystem:
		head = fmt.Sprintf("[#%d 系统通知]", m.Seq)
	default:
		head = fmt.Sprintf("[#%d %s · %s", m.Seq, b.name(m.AuthorID), b.clock(m.CreatedAt))
		if reply := b.seqOf(m.ReplyToID); reply > 0 {
			head += fmt.Sprintf(" · 回复 #%d", reply)
		}
		head += "]"
	}
	body := m.Content
	if m.Status == domain.StatusStopped {
		body += "\n（此回复被用户中断，未写完）"
	}
	return head + "\n" + body
}

func (b builder) seqOf(id string) int64 {
	if id == "" {
		return 0
	}
	for _, m := range b.in.History {
		if m.ID == id {
			return m.Seq
		}
	}
	return 0
}

// toMessages 映射角色并合并相邻同角色消息，保证 user 开头、交替、user 结尾。
func (b builder) toMessages(window []domain.Message) []llm.Message {
	var out []llm.Message
	push := func(role llm.Role, text string) {
		if n := len(out); n > 0 && out[n-1].Role == role {
			out[n-1].Content += "\n\n" + text
			return
		}
		out = append(out, llm.Message{Role: role, Content: text})
	}
	for _, m := range window {
		role := llm.RoleUser
		if m.AuthorKind == domain.AuthorMember && m.AuthorID == b.in.Self.ID {
			role = llm.RoleAssistant
		}
		if len(out) == 0 && role == llm.RoleAssistant {
			push(llm.RoleUser, "（以下是群聊记录节选，更早的内容见系统提示中的群记忆）")
		}
		push(role, b.render(m))
	}
	if out[len(out)-1].Role != llm.RoleUser {
		// 串行轮次中，若前一位回复者恰好是自己（不应发生）或历史以自己结尾，补一个用户侧提示。
		push(llm.RoleUser, fmt.Sprintf("（请回复用户在 #%d 的请求）", b.in.Turn.UserMessage.Seq))
	}
	return out
}

func (b builder) systemHead() string {
	in := b.in
	var sb strings.Builder
	if p := strings.TrimSpace(in.Self.RolePrompt); p != "" {
		sb.WriteString(p)
		sb.WriteString("\n\n")
	}
	sb.WriteString("—— 群聊规则 ——\n")
	fmt.Fprintf(&sb, "你是「%s」，正在群聊「%s」中工作。", in.Self.Name, in.Group.Title)
	if t := strings.TrimSpace(in.Group.Topic); t != "" {
		fmt.Fprintf(&sb, "本群主题：%s", t)
	}
	sb.WriteString("\n群成员：\n- 用户：群主，唯一能 @ 成员、能确认决定的人\n")
	for _, id := range in.Group.MemberIDs {
		m, ok := in.Members[id]
		if !ok {
			continue
		}
		brief := strings.TrimSpace(m.Brief)
		if brief == "" {
			brief = "（无简介）"
		}
		if id == in.Self.ID {
			fmt.Fprintf(&sb, "- %s（你）：%s\n", m.Name, brief)
		} else {
			fmt.Fprintf(&sb, "- %s：%s\n", m.Name, brief)
		}
	}
	sb.WriteString(`规则：
1. 只有用户会 @ 你。你只回应用户本轮的请求；可以引用、补充、审查其他成员的发言，引用时写明是谁说的、在哪条（如"青砚在 #12 提到"）。
2. 他人发言开头的「[#编号 发言者 · 时间]」是系统标注。你直接写回复正文，不要加这种标注，不要替用户或其他成员发言。@ 其他成员不会让他们回复，需要谁参与请建议用户 @ 他。
3. 群记忆里「已确认」的是用户拍板的结论，必须遵循；如果你认为它有问题，先明确指出冲突再给建议。「未确认」的只是参考，可以质疑。
4. 不确定就直说。不要编造群里没出现过的事实、链接或数据。`)
	return sb.String()
}

var kindOrder = []struct {
	kind  domain.MemoryKind
	title string
}{
	{domain.MemoryDecision, "决定"},
	{domain.MemoryTodo, "待办"},
	{domain.MemoryPlan, "方案"},
	{domain.MemoryBackground, "背景"},
}

// memoryBlock 渲染群记忆，超出 cap 时按优先级截断：
// 已确认 > 未完成待办 > 用户提出 > AI 建议 > 已否决（只列一行防止反复提）。
func (b builder) memoryBlock(cap int) string {
	items := b.in.Memory
	if len(items) == 0 {
		return ""
	}
	rank := func(m domain.MemoryItem) int {
		switch {
		case m.Status == domain.MemoryConfirmed:
			return 0
		case m.Kind == domain.MemoryTodo && m.Status == domain.MemoryProposed:
			return 1
		case m.Status == domain.MemoryProposed && m.Origin == domain.OriginUser:
			return 2
		case m.Status == domain.MemoryProposed:
			return 3
		case m.Status == domain.MemoryRejected:
			return 4
		}
		return -1 // done / superseded 不进提示词
	}
	var pool []domain.MemoryItem
	for _, m := range items {
		if rank(m) >= 0 {
			pool = append(pool, m)
		}
	}
	slices.SortStableFunc(pool, func(a, c domain.MemoryItem) int { return rank(a) - rank(c) })

	header := fmt.Sprintf("—— 群记忆（整理至 #%d）——", b.in.Group.MemoryCursor)
	used := llm.EstimateTokens(header)
	keep := map[string]bool{}
	omitted := 0
	for _, m := range pool {
		cost := llm.EstimateTokens(b.memoryLine(m)) + 2
		if used+cost > cap {
			omitted++
			continue
		}
		used += cost
		keep[m.ID] = true
	}

	var sb strings.Builder
	sb.WriteString(header)
	for _, k := range kindOrder {
		var lines []string
		for _, m := range items {
			if keep[m.ID] && m.Kind == k.kind && m.Status != domain.MemoryRejected {
				lines = append(lines, b.memoryLine(m))
			}
		}
		if len(lines) > 0 {
			fmt.Fprintf(&sb, "\n%s：\n%s", k.title, strings.Join(lines, "\n"))
		}
	}
	var rejected []string
	for _, m := range items {
		if keep[m.ID] && m.Status == domain.MemoryRejected {
			rejected = append(rejected, fmt.Sprintf("M%d %s", m.Ref, m.Content))
		}
	}
	if len(rejected) > 0 {
		fmt.Fprintf(&sb, "\n用户已否决（不要再提）：%s", strings.Join(rejected, "；"))
	}
	if omitted > 0 {
		fmt.Fprintf(&sb, "\n（另有 %d 条较次要的记忆因篇幅未列出）", omitted)
	}
	return sb.String()
}

func (b builder) memoryLine(m domain.MemoryItem) string {
	var tag string
	switch {
	case m.Status == domain.MemoryConfirmed:
		tag = "已确认"
	case m.Origin == domain.OriginUser:
		tag = "用户提出·未确认"
	default:
		tag = "AI建议·未确认"
	}
	if m.Kind == domain.MemoryTodo && m.Status != domain.MemoryRejected {
		tag = "待办·" + tag
	}
	var src []string
	if p := firstSource(m, domain.SourceProposed); p > 0 {
		src = append(src, fmt.Sprintf("%s 提出于 #%d", b.name(m.ProposedBy), p))
	}
	if m.ConfirmedAt != nil {
		src = append(src, "用户确认于 "+b.clock(*m.ConfirmedAt))
	}
	line := fmt.Sprintf("- [%s] M%d %s", tag, m.Ref, m.Content)
	if len(src) > 0 {
		line += "（" + strings.Join(src, "，") + "）"
	}
	return line
}

func firstSource(m domain.MemoryItem, role domain.SourceRole) int64 {
	for _, s := range m.Sources {
		if s.Role == role {
			return s.Seq
		}
	}
	if len(m.Sources) > 0 {
		return m.Sources[0].Seq
	}
	return 0
}

// gapNote 在"被裁掉的历史尚未整理进记忆"时如实告知模型，避免它以为自己看到了全部。
func (b builder) gapNote(window, dropped []domain.Message) string {
	cursor := b.in.Group.MemoryCursor
	var lost []int64
	for _, m := range dropped {
		if m.Seq > cursor {
			lost = append(lost, m.Seq)
		}
	}
	if len(lost) == 0 {
		return ""
	}
	return fmt.Sprintf("注意：#%d–#%d 之间有 %d 条讨论因篇幅未展示，且尚未整理进群记忆。若用户问到，请说明你看不到这部分。",
		lost[0], lost[len(lost)-1], len(lost))
}

func (b builder) turnBlock(turn []domain.Message) string {
	t := b.in.Turn
	others := make([]string, 0, len(t.Order))
	pos := -1
	for i, id := range t.Order {
		if id == b.in.Self.ID {
			pos = i
			continue
		}
		others = append(others, b.name(id))
	}
	var sb strings.Builder
	sb.WriteString("—— 本轮 ——\n")
	fmt.Fprintf(&sb, "用户在 #%d 发出了请求。", t.UserMessage.Seq)
	switch {
	case len(others) == 0:
		sb.WriteString("本轮只 @ 了你。")
	case t.Mode == domain.ModeParallel:
		fmt.Fprintf(&sb, "本轮还 @ 了 %s，你们同时独立作答，你看不到他们本轮的回答。请给出你自己完整的观点。", strings.Join(others, "、"))
	default:
		fmt.Fprintf(&sb, "本轮按顺序回复：%s，你是第 %d 位。", b.orderNames(), pos+1)
		var before []string
		for _, m := range turn {
			if m.AuthorKind == domain.AuthorMember {
				before = append(before, fmt.Sprintf("%s（#%d）", b.name(m.AuthorID), m.Seq))
			}
		}
		if len(before) > 0 {
			fmt.Fprintf(&sb, "%s 已经回复，见上文。请在其基础上补充、审查或给出不同意见，不要重复他们已说过的内容。", strings.Join(before, "、"))
		} else if pos > 0 {
			sb.WriteString("排在你前面的成员没有成功回复，请独立作答。")
		}
	}
	return sb.String()
}

func (b builder) orderNames() string {
	names := make([]string, len(b.in.Turn.Order))
	for i, id := range b.in.Turn.Order {
		names[i] = b.name(id)
	}
	return strings.Join(names, " → ")
}

func nonEmpty(parts ...string) []string {
	out := parts[:0]
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

// SanitizeReply 去掉模型模仿系统标注产生的前缀，例如「[#45 墨白 · 10-15 10:03]」「【墨白】：」「墨白：」。
// 只处理开头，正文中间的引用保留。
func SanitizeReply(selfName, text string) string {
	t := strings.TrimLeft(text, " \t\r\n")
	for {
		loc := headerRe.FindStringIndex(t)
		if loc == nil {
			break
		}
		if !strings.Contains(t[:loc[1]], selfName) && !strings.HasPrefix(t, "[#") {
			break
		}
		t = strings.TrimLeft(t[loc[1]:], " \t\r\n")
	}
	if strings.HasPrefix(t, selfName+"：") || strings.HasPrefix(t, selfName+":") {
		t = strings.TrimLeft(strings.TrimPrefix(strings.TrimPrefix(t, selfName+"："), selfName+":"), " \t\r\n")
	}
	return t
}

var headerRe = regexp.MustCompile(`^(?:\[#?\d*[^\]\n]{0,40}\]|【[^】\n]{1,20}】)[:：]?`)
