// Package app 是桌面桥接层；领域实体不依赖框架或 JSON 传输格式。
package app

import (
	"ai-group-chat/internal/domain"
	"time"
)

type Appearance struct {
	Mode       string `json:"mode"`
	Paper      string `json:"paper"`
	NightPaper string `json:"nightPaper"`
	FontSize   string `json:"fontSize"`
	Density    string `json:"density"`
}
type UserSeal struct {
	Text  string `json:"text"`
	Style string `json:"style"`
}
type Avatar struct {
	Glyph string `json:"glyph"`
	Color string `json:"color"`
	Image string `json:"image,omitempty"`
}
type Member struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Avatar        Avatar   `json:"avatar"`
	Brief         string   `json:"brief"`
	RolePrompt    string   `json:"rolePrompt"`
	ProviderID    string   `json:"providerId"`
	Model         string   `json:"model"`
	Temperature   *float64 `json:"temperature,omitempty"`
	ContextTokens int      `json:"contextTokens"`
}
type ProviderConfig struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	BaseURL string `json:"baseUrl"`
	HasKey  bool   `json:"hasKey"`
}
type LastMessage struct {
	AuthorID   string            `json:"authorId"`
	AuthorKind domain.AuthorKind `json:"authorKind"`
	Preview    string            `json:"preview"`
	At         string            `json:"at"`
}
type GroupSummary struct {
	ID            string            `json:"id"`
	Title         string            `json:"title"`
	Topic         string            `json:"topic"`
	MemberIDs     []string          `json:"memberIds"`
	MemberAvatars map[string]Avatar `json:"memberAvatars"`
	LastMessage   *LastMessage      `json:"lastMessage,omitempty"`
	UpdatedAt     string            `json:"updatedAt"`
	// Archived 表示群已归档：仍在数据里，但从侧栏主列表移入「已归档」（TASK-009）。
	Archived bool `json:"archived"`
}

// UpdateGroupInput 是群设置的保存内容（TASK-009）。
type UpdateGroupInput struct {
	ID          string           `json:"id"`
	Title       string           `json:"title"`
	Topic       string           `json:"topic"`
	DefaultMode domain.ReplyMode `json:"defaultMode"`
	MemberIDs   []string         `json:"memberIds"`
}
type Group struct {
	GroupSummary
	DefaultMode  domain.ReplyMode `json:"defaultMode"`
	MemoryCursor int64            `json:"memoryCursor"`
	CreatedAt    string           `json:"createdAt"`
}
type Message struct {
	ID         string               `json:"id"`
	GroupID    string               `json:"groupId"`
	Seq        int64                `json:"seq"`
	AuthorKind domain.AuthorKind    `json:"authorKind"`
	AuthorID   string               `json:"authorId"`
	Content    string               `json:"content"`
	Mentions   []string             `json:"mentions"`
	MentionAll bool                 `json:"mentionAll"`
	ReplyToID  string               `json:"replyToId"`
	TurnID     string               `json:"turnId"`
	Provider   string               `json:"provider"`
	Model      string               `json:"model"`
	ContextSeq int64                `json:"contextSeq"`
	Status     domain.MessageStatus `json:"status"`
	Error      string               `json:"error"`
	CreatedAt  string               `json:"createdAt"`
	FinishedAt *string              `json:"finishedAt,omitempty"`
	ReplyMode  domain.ReplyMode     `json:"replyMode"`
}
type MemorySource struct {
	MessageID string            `json:"messageId"`
	Seq       int64             `json:"seq"`
	Role      domain.SourceRole `json:"role"`
}
type MemoryItem struct {
	ID           string              `json:"id"`
	GroupID      string              `json:"groupId"`
	Ref          int                 `json:"ref"`
	Kind         domain.MemoryKind   `json:"kind"`
	Content      string              `json:"content"`
	Status       domain.MemoryStatus `json:"status"`
	Origin       domain.MemoryOrigin `json:"origin"`
	ProposedBy   string              `json:"proposedBy"`
	Sources      []MemorySource      `json:"sources"`
	ConfirmedAt  *string             `json:"confirmedAt,omitempty"`
	SupersededBy string              `json:"supersededBy"`
	CreatedAt    string              `json:"createdAt"`
	UpdatedAt    string              `json:"updatedAt"`
}
type Bootstrap struct {
	Platform   string           `json:"platform"`
	Appearance Appearance       `json:"appearance"`
	UserSeal   UserSeal         `json:"userSeal"`
	Members    []Member         `json:"members"`
	Providers  []ProviderConfig `json:"providers"`
	Groups     []GroupSummary   `json:"groups"`
	// RetiredMemberIDs 是只作为历史发言者存在的已删除成员（仍用于渲染历史，但不在名册/邀请列表里）。
	RetiredMemberIDs []string     `json:"retiredMemberIds"`
	Memory           MemoryConfig `json:"memory"`
	Version          string       `json:"version"`
}

// MemoryConfig 是纪要整理使用的模型服务与模型（TASK-008 设置页）。
type MemoryConfig struct {
	ProviderID string `json:"providerId"`
	Model      string `json:"model"`
}

type SaveProviderInput struct {
	ID        string `json:"id"` // 为空表示新建
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	BaseURL   string `json:"baseUrl"`
	Key       string `json:"key"`       // 留空表示不修改已保存的 Key
	TestModel string `json:"testModel"` // 仅"测试连接"用；留空按类型取默认
}
type GroupDetail struct {
	Group    Group        `json:"group"`
	Messages []Message    `json:"messages"`
	Memory   []MemoryItem `json:"memory"`
	Busy     bool         `json:"busy"`
}
type SendResult struct {
	UserMessage Message  `json:"userMessage"`
	TurnID      string   `json:"turnId"`
	Order       []string `json:"order"`
}
type CreateGroupInput struct {
	Title       string           `json:"title"`
	Topic       string           `json:"topic"`
	MemberIDs   []string         `json:"memberIds"`
	DefaultMode domain.ReplyMode `json:"defaultMode"`
}
type SaveMemberInput struct {
	ID            string   `json:"id"` // 为空表示新建
	Name          string   `json:"name"`
	Avatar        Avatar   `json:"avatar"`
	Brief         string   `json:"brief"`
	RolePrompt    string   `json:"rolePrompt"`
	ProviderID    string   `json:"providerId"`
	Model         string   `json:"model"`
	Temperature   *float64 `json:"temperature,omitempty"`
	ContextTokens int      `json:"contextTokens"`
}

func stamp(t time.Time) string { return t.Format(time.RFC3339Nano) }
func optionalStamp(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := stamp(*t)
	return &s
}
func nonnil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}
func avatarDTO(a domain.Avatar) Avatar { return Avatar{a.Glyph, a.Color, a.Image} }
func (a Avatar) domain() domain.Avatar {
	return domain.Avatar{Glyph: a.Glyph, Color: a.Color, Image: a.Image}
}
func memberDTO(m domain.Member) Member {
	return Member{m.ID, m.Name, avatarDTO(m.Avatar), m.Brief, m.RolePrompt, m.ProviderID, m.Model, m.Temperature, m.ContextTokens}
}
func messageDTO(m domain.Message) Message {
	return Message{m.ID, m.GroupID, m.Seq, m.AuthorKind, m.AuthorID, m.Content, nonnil(m.Mentions), m.MentionAll, m.ReplyToID, m.TurnID, m.Provider, m.Model, m.ContextSeq, m.Status, m.Error, stamp(m.CreatedAt), optionalStamp(m.FinishedAt), m.ReplyMode}
}
func memoryDTO(m domain.MemoryItem) MemoryItem {
	sources := []MemorySource{}
	for _, s := range m.Sources {
		sources = append(sources, MemorySource{s.MessageID, s.Seq, s.Role})
	}
	return MemoryItem{m.ID, m.GroupID, m.Ref, m.Kind, m.Content, m.Status, m.Origin, m.ProposedBy, sources, optionalStamp(m.ConfirmedAt), m.SupersededBy, stamp(m.CreatedAt), stamp(m.UpdatedAt)}
}
func memoriesDTO(items []domain.MemoryItem) []MemoryItem {
	out := []MemoryItem{}
	for _, it := range items {
		out = append(out, memoryDTO(it))
	}
	return out
}

func (a Appearance) EffectivePaper(systemDark bool) string {
	if a.Mode == "night" || (a.Mode == "system" && systemDark) {
		return a.NightPaper
	}
	return a.Paper
}
