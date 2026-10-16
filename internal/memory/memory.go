// Package memory 负责群记忆的整理：把一段新讨论交给"整理模型"，
// 让它以 JSON 操作的形式提出增改，再由 Apply 严格校验后落地。
//
// 不变式（见 ADR-0005，任何改动都不能破坏）：
//  1. AI 永远不能把条目变成 confirmed；confirmed 条目 AI 不能修改、取代、完成。
//  2. 每条 AI 产出的条目必须引用本次窗口内真实存在的消息作为来源。
//  3. origin=user 必须有至少一条用户消息作来源，否则降级为 member。
//  4. 待办完成必须有用户消息作证据。
package memory

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

// Policy 决定何时触发整理。
type Policy struct {
	MinMessages int // 自上次整理后至少新增多少条可见消息
	MinTokens   int // 或者累计多少 token
	MaxWindow   int // 单次最多整理多少条，多出的留给下一次
}

var DefaultPolicy = Policy{MinMessages: 8, MinTokens: 2500, MaxWindow: 40}

// Pending 返回 cursor 之后尚未整理的可见消息（按 Seq 升序，最多 MaxWindow 条），
// 以及是否达到触发条件。force 用于用户手动点"整理纪要"。
func (p Policy) Pending(cursor int64, history []domain.Message, force bool) ([]domain.Message, bool) {
	var out []domain.Message
	tokens := 0
	for _, m := range history {
		if m.Seq <= cursor || !m.Visible() {
			continue
		}
		out = append(out, m)
		tokens += llm.EstimateTokens(m.Content)
	}
	ready := len(out) > 0 && (force || len(out) >= p.MinMessages || tokens >= p.MinTokens)
	if len(out) > p.MaxWindow {
		out = out[:p.MaxWindow]
	}
	return out, ready
}

// ---- 整理请求 ----

const systemPrompt = `你是群聊的"纪要整理员"，不参与讨论，只负责维护这个群的长期记忆。
你会收到：现有记忆条目（带编号 M#）和一段新的群聊记录（每条以 [#编号 发言者] 开头）。
请判断新记录中有哪些内容值得长期记住，并以 JSON 返回对记忆的操作。

记忆分四类：
- decision 决定：已经拍板或提议拍板的结论
- plan 方案：提出的做法、设计、技术选型
- todo 待办：需要有人去做的具体事项
- background 背景：项目约束、目标、事实信息

规则：
1. 只记录对后续讨论有用的内容，寒暄、重复、过程性的话不记。宁缺毋滥。
2. content 用一句话写清楚，不超过 80 字，写结论不写过程。
3. origin：内容是用户本人说出或要求的，填 "user"；是 AI 成员提出的，填 "member"。proposed_by 填提出者名字（用户填"用户"）。
4. sources 填支撑这条内容的消息编号（数字），必须来自本次新记录。
5. 你不能确认任何事。即使用户说"就这么定"，也只记录为 origin=user 的条目，由用户在界面上盖章确认。
6. 标为「已确认」的条目不可修改、取代或完成。如果新讨论与它冲突，新增一条 plan 写明冲突（如"建议推翻 M3：……"）。
7. 未确认条目被新讨论修正时用 update；被新方案整体替代时用 supersede 指向新增条目。
8. 只有用户明确说某个待办已完成时，才能 complete 它。

只输出一个 JSON 对象，不要输出其他文字：
{"ops":[
  {"op":"add","kind":"decision|plan|todo|background","content":"...","origin":"user|member","proposed_by":"名字","sources":[12,13]},
  {"op":"update","ref":2,"content":"修正后的内容","sources":[15]},
  {"op":"supersede","ref":2,"by":0,"sources":[16]},
  {"op":"complete","ref":5,"sources":[17]}
]}
supersede 的 by 是本次 ops 数组中某个 add 操作的下标。没有值得记录的内容时返回 {"ops":[]}。`

// BuildRequest 生成发给整理模型的请求。
func BuildRequest(model string, g domain.Group, members map[string]domain.Member, items []domain.MemoryItem, window []domain.Message, loc *time.Location) llm.Request {
	if loc == nil {
		loc = time.Local
	}
	name := nameFunc(members)
	var sb strings.Builder
	fmt.Fprintf(&sb, "群聊「%s」", g.Title)
	if g.Topic != "" {
		fmt.Fprintf(&sb, "，主题：%s", g.Topic)
	}
	sb.WriteString("\n\n## 现有记忆\n")
	live := 0
	for _, it := range items {
		if !it.Live() && it.Status != domain.MemoryRejected {
			continue
		}
		live++
		state := map[domain.MemoryStatus]string{
			domain.MemoryConfirmed: "已确认", domain.MemoryProposed: "未确认", domain.MemoryRejected: "已否决",
		}[it.Status]
		fmt.Fprintf(&sb, "- M%d [%s·%s] %s（%s 提出）\n", it.Ref, it.Kind, state, it.Content, name(it.ProposedBy))
	}
	if live == 0 {
		sb.WriteString("（暂无）\n")
	}
	sb.WriteString("\n## 新记录\n")
	for _, m := range window {
		who := name(m.AuthorID)
		if m.AuthorKind == domain.AuthorSystem {
			who = "系统通知"
		}
		fmt.Fprintf(&sb, "[#%d %s · %s]\n%s\n\n", m.Seq, who, m.CreatedAt.In(loc).Format("01-02 15:04"), m.Content)
	}
	return llm.Request{
		Model:    model,
		System:   systemPrompt,
		Messages: []llm.Message{{Role: llm.RoleUser, Content: sb.String()}},
		// 整理要稳定，不要发挥。
		Temperature: ptr(0.2),
		// 推理型模型会先消耗 reasoning token；2000 在窗口稍大（约十余条）时不足以产出完整 JSON。
		MaxTokens: 4000,
	}
}

func ptr[T any](v T) *T { return &v }

func nameFunc(members map[string]domain.Member) func(string) string {
	return func(id string) string {
		if id == domain.UserID {
			return "用户"
		}
		if m, ok := members[id]; ok {
			return m.Name
		}
		return "已退群成员"
	}
}

// ---- 解析与校验 ----

type Op struct {
	Op         string  `json:"op"`
	Kind       string  `json:"kind,omitempty"`
	Content    string  `json:"content,omitempty"`
	Origin     string  `json:"origin,omitempty"`
	ProposedBy string  `json:"proposed_by,omitempty"`
	Sources    []int64 `json:"sources"`
	Ref        int     `json:"ref,omitempty"`
	By         *int    `json:"by,omitempty"`
}

// ParseOps 容忍模型在 JSON 外包裹 ```json 代码块或前后多余文字。
func ParseOps(raw string) ([]Op, error) {
	s := strings.TrimSpace(raw)
	if i := strings.Index(s, "{"); i >= 0 {
		if j := strings.LastIndex(s, "}"); j > i {
			s = s[i : j+1]
		}
	}
	var out struct {
		Ops []Op `json:"ops"`
	}
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, fmt.Errorf("整理结果不是合法 JSON：%w", err)
	}
	return out.Ops, nil
}

// Env 是 Apply 需要的外部依赖，便于测试注入。
type Env struct {
	GroupID string
	Members map[string]domain.Member
	NewID   func() string
	Now     time.Time
}

// Result 是一次整理的结果。Changed 是新增或被修改的条目（调用方据此写库并推送前端）。
type Result struct {
	Items    []domain.MemoryItem // 应用后的完整列表
	Changed  []string            // 发生变化的条目 ID
	Rejected []string            // 被拒绝的操作及原因，写日志即可，不打扰用户
	Cursor   int64               // 新的 MemoryCursor
}

const maxContentRunes = 120

// Apply 校验并应用 ops。任何不合规的操作只会被单独拒绝，不影响其余操作。
func Apply(items []domain.MemoryItem, ops []Op, window []domain.Message, env Env) Result {
	res := Result{Items: slices.Clone(items)}
	if len(window) > 0 {
		res.Cursor = window[len(window)-1].Seq
	}
	bySeq := map[int64]domain.Message{}
	for _, m := range window {
		bySeq[m.Seq] = m
	}
	byRef := map[int]int{}
	maxRef := 0
	for i, it := range res.Items {
		byRef[it.Ref] = i
		maxRef = max(maxRef, it.Ref)
	}
	memberByName := map[string]string{"用户": domain.UserID}
	for id, m := range env.Members {
		memberByName[m.Name] = id
	}
	reject := func(i int, format string, a ...any) {
		res.Rejected = append(res.Rejected, fmt.Sprintf("op[%d]: ", i)+fmt.Sprintf(format, a...))
	}
	changed := map[string]bool{}
	addedIdx := map[int]int{} // op 下标 -> res.Items 下标

	sources := func(seqs []int64, role domain.SourceRole) ([]domain.MemorySource, bool, error) {
		if len(seqs) == 0 {
			return nil, false, fmt.Errorf("缺少来源")
		}
		var out []domain.MemorySource
		fromUser := false
		for _, s := range seqs {
			m, ok := bySeq[s]
			if !ok {
				return nil, false, fmt.Errorf("来源 #%d 不在本次记录中", s)
			}
			fromUser = fromUser || m.AuthorKind == domain.AuthorUser
			out = append(out, domain.MemorySource{MessageID: m.ID, Seq: s, Role: role})
		}
		return out, fromUser, nil
	}

	// 先处理 add，supersede 依赖 add 的结果。
	for i, op := range ops {
		if op.Op != "add" {
			continue
		}
		kind := domain.MemoryKind(op.Kind)
		if !slices.Contains([]domain.MemoryKind{domain.MemoryBackground, domain.MemoryPlan, domain.MemoryDecision, domain.MemoryTodo}, kind) {
			reject(i, "未知类别 %q", op.Kind)
			continue
		}
		content, ok := cleanContent(op.Content)
		if !ok {
			reject(i, "内容为空或过长")
			continue
		}
		src, fromUser, err := sources(op.Sources, domain.SourceProposed)
		if err != nil {
			reject(i, "%v", err)
			continue
		}
		origin := domain.OriginMember
		if op.Origin == "user" && fromUser {
			origin = domain.OriginUser
		}
		by := memberByName[op.ProposedBy]
		if origin == domain.OriginUser {
			by = domain.UserID
		} else if by == "" || by == domain.UserID {
			by = firstMemberAuthor(src, bySeq)
		}
		maxRef++
		res.Items = append(res.Items, domain.MemoryItem{
			ID: env.NewID(), GroupID: env.GroupID, Ref: maxRef, Kind: kind, Content: content,
			Status: domain.MemoryProposed, Origin: origin, ProposedBy: by, Sources: src,
			CreatedAt: env.Now, UpdatedAt: env.Now,
		})
		idx := len(res.Items) - 1
		addedIdx[i] = idx
		byRef[maxRef] = idx
		changed[res.Items[idx].ID] = true
	}

	for i, op := range ops {
		if op.Op == "add" {
			continue
		}
		idx, ok := byRef[op.Ref]
		if !ok {
			reject(i, "M%d 不存在", op.Ref)
			continue
		}
		it := &res.Items[idx]
		if it.Status == domain.MemoryConfirmed {
			reject(i, "M%d 已由用户确认，AI 不可修改", op.Ref)
			continue
		}
		if it.Status != domain.MemoryProposed {
			reject(i, "M%d 状态为 %s，不可操作", op.Ref, it.Status)
			continue
		}
		switch op.Op {
		case "update":
			content, ok := cleanContent(op.Content)
			if !ok {
				reject(i, "内容为空或过长")
				continue
			}
			src, _, err := sources(op.Sources, domain.SourceDiscussed)
			if err != nil {
				reject(i, "%v", err)
				continue
			}
			it.Content = content
			it.Sources = append(it.Sources, src...)
		case "supersede":
			if op.By == nil {
				reject(i, "supersede 缺少 by")
				continue
			}
			newIdx, ok := addedIdx[*op.By]
			if !ok {
				reject(i, "by=%d 不是本次成功的 add", *op.By)
				continue
			}
			it.Status = domain.MemorySuperseded
			it.SupersededBy = res.Items[newIdx].ID
		case "complete":
			if it.Kind != domain.MemoryTodo {
				reject(i, "M%d 不是待办", op.Ref)
				continue
			}
			src, fromUser, err := sources(op.Sources, domain.SourceCompleted)
			if err != nil {
				reject(i, "%v", err)
				continue
			}
			if !fromUser {
				reject(i, "完成 M%d 需要用户发言作证据", op.Ref)
				continue
			}
			it.Status = domain.MemoryDone
			it.Sources = append(it.Sources, src...)
		default:
			reject(i, "未知操作 %q", op.Op)
			continue
		}
		it.UpdatedAt = env.Now
		changed[it.ID] = true
	}

	for _, it := range res.Items {
		if changed[it.ID] {
			res.Changed = append(res.Changed, it.ID)
		}
	}
	return res
}

func cleanContent(s string) (string, bool) {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	n := utf8.RuneCountInString(s)
	return s, n > 0 && n <= maxContentRunes
}

func firstMemberAuthor(src []domain.MemorySource, bySeq map[int64]domain.Message) string {
	for _, s := range src {
		if m := bySeq[s.Seq]; m.AuthorKind == domain.AuthorMember {
			return m.AuthorID
		}
	}
	return ""
}

// ---- 用户操作：只有这里能写入 confirmed ----

func Confirm(it domain.MemoryItem, now time.Time) (domain.MemoryItem, error) {
	if it.Status != domain.MemoryProposed && it.Status != domain.MemoryRejected {
		return it, fmt.Errorf("M%d 当前状态 %s 不能确认", it.Ref, it.Status)
	}
	it.Status, it.ConfirmedAt, it.UpdatedAt = domain.MemoryConfirmed, &now, now
	return it, nil
}

func Reject(it domain.MemoryItem, now time.Time) domain.MemoryItem {
	it.Status, it.ConfirmedAt, it.UpdatedAt = domain.MemoryRejected, nil, now
	return it
}

// Reopen 撤销确认或否决，回到未确认。
func Reopen(it domain.MemoryItem, now time.Time) domain.MemoryItem {
	it.Status, it.ConfirmedAt, it.UpdatedAt = domain.MemoryProposed, nil, now
	return it
}

// Edit 是用户手动改写内容。用户改写即视为用户提出（origin=user），状态不变。
func Edit(it domain.MemoryItem, content string, now time.Time) (domain.MemoryItem, error) {
	c, ok := cleanContent(content)
	if !ok {
		return it, fmt.Errorf("内容为空或超过 %d 字", maxContentRunes)
	}
	it.Content, it.Origin, it.UpdatedAt = c, domain.OriginUser, now
	return it, nil
}
