// Package domain 定义群聊的核心实体。这里的字段语义是全项目的契约：
// SQLite 表结构（internal/store/schema.sql）、前端类型（frontend/src/backend/contract.ts）
// 都必须与此保持一致。改动字段前先写 ADR。
package domain

import "time"

// UserID 是"用户"在 AuthorID / ProposedBy 等字段里的固定取值。本产品是单用户本地应用。
const UserID = "user"

type AuthorKind string

const (
	AuthorUser   AuthorKind = "user"
	AuthorMember AuthorKind = "member"
	AuthorSystem AuthorKind = "system" // 入群、退群、改名等系统通知
)

// ReplyMode 决定同时 @ 多个成员时的回复方式，见 ADR-0002。
type ReplyMode string

const (
	ModeSerial   ReplyMode = "serial"   // 按顺序回复，后者能看到前者
	ModeParallel ReplyMode = "parallel" // 同时回复，互相看不到本轮回答
)

type MessageStatus string

const (
	StatusPending   MessageStatus = "pending"   // 串行排队中，尚未开始
	StatusStreaming MessageStatus = "streaming" // 正在生成
	StatusDone      MessageStatus = "done"
	StatusError     MessageStatus = "error"
	StatusStopped   MessageStatus = "stopped" // 用户中断，Content 保留已生成部分
)

// Provider 是一个模型服务入口。Key 不在这里，只存钥匙串引用。
type Provider struct {
	ID      string
	Name    string
	Kind    string // "openai" (含所有 OpenAI 兼容服务) | "anthropic"
	BaseURL string
	KeyRef  string // 系统钥匙串里的条目名，永不落库明文
}

// Member 是一个 AI 成员（数字员工）。AI 没有个人记忆，见 ADR-0001。
type Member struct {
	ID             string
	Name           string // 全局唯一，不含空白与 '@'，用于 @ 匹配
	Avatar         Avatar
	Brief          string // 一句话简介，会告诉群里其他成员"这人是干什么的"
	RolePrompt     string // 角色提示词，只进入自己的 system prompt
	ProviderID     string
	Model          string
	Temperature    *float64
	SupportsImages bool
	ContextTokens  int // 该模型可用的上下文预算（不含回复预留）
	CreatedAt      time.Time
}

// Avatar 默认是一枚印章：一个字 + 一种矿物颜料色；也可以换成图片。
type Avatar struct {
	Glyph string // 默认取名字首字
	Color string // 设计系统 pigment 色名：shiqing / shilv / zheshi / tenghuang / dai / zise
	Image string // 头像图片的资源地址（应用数据目录下的文件，见 TASK-013），非空时优先；支持动图
}

// AvatarOf 返回成员在某个群里的头像：群内覆盖优先。
func AvatarOf(g Group, m Member) Avatar {
	if a, ok := g.MemberAvatars[m.ID]; ok {
		return a
	}
	return m.Avatar
}

type Group struct {
	ID          string
	Title       string
	Topic       string // 群主题，会写进每个成员的 system prompt
	DefaultMode ReplyMode
	MemberIDs   []string // 有序。@所有人 时按此顺序回复
	// MemberAvatars 是本群对成员头像的覆盖（ADR-0008）。没有覆盖的成员用 Member.Avatar。
	// 头像只影响界面，不进入提示词。
	MemberAvatars map[string]Avatar
	// MemoryCursor 是已整理进群记忆的最后一条消息 Seq。
	MemoryCursor int64
	CreatedAt    time.Time
	ArchivedAt   *time.Time
}

// Message 是群里的一条发言。"谁说的、谁处理的、回复谁、什么时候"都在这里。
type Message struct {
	ID          string
	GroupID     string
	Seq         int64 // 群内单调递增，从 1 开始；对人和对模型都用 #Seq 指代消息
	AuthorKind  AuthorKind
	AuthorID    string // 成员 ID；用户为 UserID；系统消息为空
	Content     string
	Attachments []Attachment

	// 用户消息：解析出的 @ 对象（有序）。
	Mentions   []string
	MentionAll bool
	// ReplyMode 记录这条消息触发的一轮用的是依次还是同时回复（TASK-005）。
	// 重试/重新生成时据此重建当时的上下文可见性。成员回复上无意义，落库时归一到 serial。
	ReplyMode ReplyMode

	// 成员消息：
	ReplyToID string // 回复的用户消息 ID
	TurnID    string // 同一次发送触发的所有回复共享一个 TurnID（用户消息自身也带）
	Provider  string // 实际处理该回复的服务与模型快照，成员换模型后历史仍可追溯
	Model     string
	// ContextSeq 是生成这条回复时模型看到的最后一条消息 Seq，用于溯源"它当时知道什么"。
	ContextSeq int64

	Status     MessageStatus
	Error      string
	CreatedAt  time.Time
	FinishedAt *time.Time
}

// Visible 报告这条消息能否作为上下文给模型看。
func (m Message) Visible() bool {
	switch m.Status {
	case StatusDone:
		return true
	case StatusStopped:
		return m.Content != ""
	}
	return false
}

// ---- 群记忆，见 ADR-0005 ----

type MemoryKind string

const (
	MemoryBackground MemoryKind = "background"
	MemoryPlan       MemoryKind = "plan"
	MemoryDecision   MemoryKind = "decision"
	MemoryTodo       MemoryKind = "todo"
)

type MemoryStatus string

const (
	MemoryProposed   MemoryStatus = "proposed"   // 尚未经用户确认
	MemoryConfirmed  MemoryStatus = "confirmed"  // 用户盖章。只有用户能进入此状态
	MemoryRejected   MemoryStatus = "rejected"   // 用户否决，仍保留以免 AI 反复提
	MemoryDone       MemoryStatus = "done"       // 待办已完成
	MemorySuperseded MemoryStatus = "superseded" // 被新条目取代
)

// MemoryOrigin 区分"用户自己说的"和"AI 提的"。与 Status 正交：
// 用户在聊天里说的话会被整理成 origin=user、status=proposed，仍需盖章才算定论。
type MemoryOrigin string

const (
	OriginUser   MemoryOrigin = "user"
	OriginMember MemoryOrigin = "member"
)

type SourceRole string

const (
	SourceProposed  SourceRole = "proposed"  // 首次提出
	SourceDiscussed SourceRole = "discussed" // 后续补充、修改
	SourceCompleted SourceRole = "completed" // 宣告完成
)

type MemorySource struct {
	MessageID string
	Seq       int64
	Role      SourceRole
}

type MemoryItem struct {
	ID         string
	GroupID    string
	Ref        int // 群内短编号，展示为 M{Ref}，提示词里也用它
	Kind       MemoryKind
	Content    string
	Status     MemoryStatus
	Origin     MemoryOrigin
	ProposedBy string // 成员 ID 或 UserID
	Sources    []MemorySource
	// ConfirmedAt 只由用户操作写入。
	ConfirmedAt  *time.Time
	SupersededBy string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Live 报告条目是否仍在生效（会进入提示词正文）。
func (m MemoryItem) Live() bool {
	return m.Status == MemoryProposed || m.Status == MemoryConfirmed
}
