package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/llm/providers"
	"ai-group-chat/internal/memory"
	"ai-group-chat/internal/secret"
	"ai-group-chat/internal/store"
	"ai-group-chat/internal/turn"
)

type Service struct {
	db          *store.Store
	turns       *turn.Orchestrator
	runner      *memory.Runner
	events      *eventBuffer
	platform    string
	memoryMu    sync.Mutex
	lifecycle   sync.Mutex
	closed      bool
	credentials credentialStore
	providersMu sync.Mutex
}

func NewService(db *store.Store, providers turn.Providers, platform string, emit func(Event)) *Service {
	s := &Service{db: db, events: newEventBuffer(emit), platform: platform, credentials: systemCredentials{}}
	// 编排器可能已读取旧配置；在凭证变更同一边界内重读，才能保证地址与 Key 配对。
	construct := func(ctx context.Context, requested domain.Provider) (llm.Provider, error) {
		s.providersMu.Lock()
		defer s.providersMu.Unlock()
		current, err := s.db.Provider(ctx, requested.ID)
		if err != nil {
			return nil, friendly(err, "读取模型服务")
		}
		if providers == nil {
			return nil, errors.New("未配置模型客户端")
		}
		return providers(ctx, current)
	}

	s.turns = &turn.Orchestrator{Store: db, Providers: construct, NewID: store.NewID, Now: time.Now, Emit: func(e turn.Event) {
		s.events.push(e)
		if e.Kind == turn.EventMessage {
			if err := s.emitGroup(context.Background(), e.GroupID); err != nil {
				slog.Warn("群摘要推送失败", "error", err)
			}
		}
	}}
	// 记忆写入与用户盖章共用 memoryMu，整理过程中的快照不会覆盖用户刚确认的条目。
	s.runner = &memory.Runner{
		Store: db, Providers: memory.Providers(construct), NewID: store.NewID, Now: time.Now, Write: &s.memoryMu,
		Emit: func(e memory.Event) {
			s.events.send(Event{"kind": "memory", "groupId": e.GroupID, "items": memoriesDTO(e.Items), "cursor": e.Cursor, "summarizing": e.Summarizing})
		},
	}
	s.turns.AfterTurn = func(groupID string) { s.runner.Trigger(groupID) }
	return s
}

// CloseService 先停止模型调用，再关闭出口；数据库由创建它的桌面层管理。
func CloseService(s *Service) {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	groups, err := s.db.Groups(context.Background())
	if err == nil {
		for _, g := range groups {
			s.turns.Stop(g.ID)
		}
		// Stop 只请求取消。必须等回复将部分正文落库，桌面层才能关闭数据库。
		for _, g := range groups {
			for s.turns.Busy(g.ID) {
				time.Sleep(time.Millisecond)
			}
		}
	}
	// 等待进行中的记忆整理退出，避免它在数据库关闭后仍在写。
	s.runner.Close()
	s.events.close()
}

func friendly(err error, action string) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s：数据不存在，请重新打开群聊", action)
	}
	if errors.Is(err, turn.ErrBusy) || errors.Is(err, turn.ErrEmpty) || errors.Is(err, turn.ErrNotRetryable) {
		return err
	}
	slog.Warn(action, "error", err)
	return fmt.Errorf("%s失败，请重试并检查本地数据是否可读写", action)
}
func readSetting[T any](ctx context.Context, db *store.Store, key string, defaults T) (T, error) {
	raw, err := db.Setting(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	value := defaults
	if err = json.Unmarshal([]byte(raw), &value); err != nil {
		return defaults, fmt.Errorf("读取 %s 设置失败", key)
	}
	return value, nil
}

// LoadAppearance 供桌面层在创建原生窗口前读取纸色，避免启动时先闪白底。
func LoadAppearance(ctx context.Context, db *store.Store) (Appearance, error) {
	a, err := readSetting(ctx, db, "ui.appearance", Appearance{"day", "xuan", "ye", "m", "comfortable"})
	if err == nil {
		err = validateAppearance(a)
	}
	return a, err
}
func (s *Service) Bootstrap(ctx context.Context) (Bootstrap, error) {
	b := Bootstrap{Platform: s.platform, Members: []Member{}, Providers: []ProviderConfig{}, Groups: []GroupSummary{}, RetiredMemberIDs: []string{}}
	var err error
	b.Appearance, err = LoadAppearance(ctx, s.db)
	if err != nil {
		return b, friendly(err, "读取外观")
	}
	b.UserSeal, err = readSetting(ctx, s.db, "ui.user_seal", UserSeal{"我", "baiwen"})
	if err != nil {
		return b, friendly(err, "读取私印")
	}
	b.UserDisplayName, err = readSetting(ctx, s.db, "ui.user_display_name", "你")
	if err != nil {
		return b, friendly(err, "读取显示名")
	}
	members, err := s.db.ListMembers(ctx)
	if err != nil {
		return b, friendly(err, "读取成员")
	}
	byID := map[string]bool{}
	for _, m := range members {
		byID[m.ID] = true
		b.Members = append(b.Members, memberDTO(m))
	}
	providers, err := s.db.Providers(ctx)
	if err != nil {
		return b, friendly(err, "读取模型服务")
	}
	for _, p := range providers {
		hasKey := false
		if p.KeyRef != "" {
			key, e := s.credentials.Get(p.ID)
			hasKey = e == nil && key != ""
		}
		b.Providers = append(b.Providers, ProviderConfig{p.ID, p.Name, p.Kind, p.BaseURL, hasKey})
	}
	groups, err := s.db.Groups(ctx)
	if err != nil {
		return b, friendly(err, "读取群列表")
	}
	for _, g := range groups {
		// 归档群也一并返回，前端按 Archived 分到「已归档」区（TASK-009）。
		summary, e := s.summary(ctx, g)
		if e != nil {
			return b, friendly(e, "读取群摘要")
		}
		b.Groups = append(b.Groups, summary)
		history, e := s.history(ctx, g.ID)
		if e != nil {
			return b, friendly(e, "读取历史成员")
		}
		ids := []string{}
		for _, m := range history {
			if m.AuthorKind == domain.AuthorMember && !byID[m.AuthorID] {
				byID[m.AuthorID] = true
				ids = append(ids, m.AuthorID)
			}
		}
		extra, e := s.db.Members(ctx, ids)
		if e != nil {
			return b, friendly(e, "读取历史成员")
		}
		for _, id := range ids {
			if m, ok := extra[id]; ok {
				b.Members = append(b.Members, memberDTO(m))
				// 只作为历史发言者存在的成员（已软删除）：仍用于渲染，但不在名册/邀请列表。
				b.RetiredMemberIDs = append(b.RetiredMemberIDs, id)
			}
		}
	}
	b.Version = Version
	b.Memory.ProviderID, _ = s.settingString(ctx, "memory.provider_id")
	b.Memory.Model, _ = s.settingString(ctx, "memory.model")
	return b, nil
}
func (s *Service) history(ctx context.Context, id string) ([]domain.Message, error) {
	return s.db.RecentMessages(ctx, id, int(^uint(0)>>1))
}

// 群摘要的"最后一条消息"只认已结束的消息（done/stopped），与 mock 后端一致：
// 回复进行中不能让空的 pending/streaming 占位顶掉上一次真正的内容。
// 取一个够覆盖当前并发占位数的窗口，避免每次摘要都扫全表。
const summaryWindow = 20

func (s *Service) summary(ctx context.Context, g domain.Group) (GroupSummary, error) {
	out := GroupSummary{ID: g.ID, Title: g.Title, Topic: g.Topic, MemberIDs: nonnil(g.MemberIDs), MemberAvatars: map[string]Avatar{}, UpdatedAt: stamp(g.CreatedAt), Archived: g.ArchivedAt != nil}
	for id, a := range g.MemberAvatars {
		out.MemberAvatars[id] = avatarDTO(a)
	}
	recent, err := s.db.RecentMessages(ctx, g.ID, summaryWindow)
	if err != nil {
		return out, err
	}
	if len(recent) == 0 {
		return out, nil
	}
	out.UpdatedAt = stamp(recent[len(recent)-1].CreatedAt)
	for i := len(recent) - 1; i >= 0; i-- {
		m := recent[i]
		if m.Status != domain.StatusDone && m.Status != domain.StatusStopped {
			continue
		}
		r := []rune(m.Content)
		if len(r) > 100 {
			r = r[:100]
		}
		out.LastMessage = &LastMessage{m.AuthorID, m.AuthorKind, string(r), stamp(m.CreatedAt)}
		break
	}
	return out, nil
}
func (s *Service) groupDTO(ctx context.Context, g domain.Group) (Group, error) {
	summary, err := s.summary(ctx, g)
	return Group{summary, g.DefaultMode, g.MemoryCursor, stamp(g.CreatedAt)}, err
}
func (s *Service) emitGroup(ctx context.Context, id string) error {
	g, err := s.db.Group(ctx, id)
	if err != nil {
		return err
	}
	summary, err := s.summary(ctx, g)
	if err == nil {
		s.events.send(Event{"kind": "group", "group": summary})
	}
	return err
}
func (s *Service) OpenGroup(ctx context.Context, id string) (GroupDetail, error) {
	out := GroupDetail{Messages: []Message{}, Memory: []MemoryItem{}}
	g, err := s.db.Group(ctx, id)
	if err != nil {
		return out, friendly(err, "打开群")
	}
	out.Group, err = s.groupDTO(ctx, g)
	if err != nil {
		return out, friendly(err, "读取群摘要")
	}
	messages, err := s.history(ctx, id)
	if err != nil {
		return out, friendly(err, "读取消息")
	}
	for _, m := range messages {
		out.Messages = append(out.Messages, messageDTO(m))
	}
	items, err := s.db.MemoryItems(ctx, id)
	if err != nil {
		return out, friendly(err, "读取纪要")
	}
	out.Memory = memoriesDTO(items)
	out.Busy = s.turns.Busy(id)
	return out, nil
}
func (s *Service) CreateGroup(ctx context.Context, input CreateGroupInput) (Group, error) {
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		return Group{}, errors.New("群名称不能为空")
	}
	if input.DefaultMode != "serial" && input.DefaultMode != "parallel" {
		return Group{}, errors.New("请选择依次或同时回复")
	}
	g := domain.Group{Title: input.Title, Topic: strings.TrimSpace(input.Topic), MemberIDs: input.MemberIDs, DefaultMode: input.DefaultMode, MemberAvatars: map[string]domain.Avatar{}}
	if err := s.db.CreateGroup(ctx, &g); err != nil {
		return Group{}, friendly(err, "创建群")
	}
	out, err := s.groupDTO(ctx, g)
	if err != nil {
		return out, friendly(err, "读取群摘要")
	}
	s.events.send(Event{"kind": "group", "group": out.GroupSummary})
	return out, nil
}
func (s *Service) Send(ctx context.Context, id, content string, mode *domain.ReplyMode) (SendResult, error) {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return SendResult{}, errors.New("应用正在关闭，请重新打开后发送")
	}
	if mode != nil && *mode != "serial" && *mode != "parallel" {
		return SendResult{}, errors.New("请选择依次或同时回复")
	}
	r, err := s.turns.Send(ctx, id, content, mode)
	return SendResult{messageDTO(r.UserMessage), r.TurnID, nonnil(r.Order)}, friendly(err, "发送消息")
}
func (s *Service) Stop(ctx context.Context, id string) error { s.turns.Stop(id); return nil }
func (s *Service) Retry(ctx context.Context, id string) error {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return errors.New("应用正在关闭，请重新打开后重试")
	}
	return friendly(s.turns.Retry(ctx, id), "重试")
}
func (s *Service) Summarize(ctx context.Context, id string) error {
	return friendly(s.runner.Summarize(ctx, id), "整理纪要")
}

// UploadAvatar 原样保存一张头像图片，返回可直接放进 Avatar.image 的地址（TASK-013）。
func (s *Service) UploadAvatar(ctx context.Context, name, mime string, data []byte) (string, error) {
	_ = ctx
	return SaveAvatar(name, mime, data)
}
func (s *Service) mutateMemory(ctx context.Context, id string, change func(domain.MemoryItem, time.Time) (domain.MemoryItem, error)) (MemoryItem, error) {
	// 用户操作使用同一把锁；TASK-006 整理应用结果时必须共用这条串行边界。
	s.memoryMu.Lock()
	defer s.memoryMu.Unlock()
	it, err := s.db.MemoryItem(ctx, id)
	if err != nil {
		return MemoryItem{}, friendly(err, "读取纪要")
	}
	it, err = change(it, time.Now())
	if err != nil {
		return MemoryItem{}, err
	}
	g, err := s.db.Group(ctx, it.GroupID)
	if err != nil {
		return MemoryItem{}, friendly(err, "读取群")
	}
	if err = s.db.SaveMemoryItems(ctx, g.ID, []domain.MemoryItem{it}, g.MemoryCursor); err != nil {
		return MemoryItem{}, friendly(err, "保存纪要")
	}
	items, err := s.db.MemoryItems(ctx, g.ID)
	if err != nil {
		return MemoryItem{}, friendly(err, "读取纪要")
	}
	s.events.send(Event{"kind": "memory", "groupId": g.ID, "items": memoriesDTO(items), "cursor": g.MemoryCursor, "summarizing": false})
	return memoryDTO(it), nil
}
func (s *Service) ConfirmMemory(ctx context.Context, id string) (MemoryItem, error) {
	return s.mutateMemory(ctx, id, memory.Confirm)
}
func (s *Service) RejectMemory(ctx context.Context, id string) (MemoryItem, error) {
	return s.mutateMemory(ctx, id, func(it domain.MemoryItem, t time.Time) (domain.MemoryItem, error) { return memory.Reject(it, t), nil })
}
func (s *Service) ReopenMemory(ctx context.Context, id string) (MemoryItem, error) {
	return s.mutateMemory(ctx, id, func(it domain.MemoryItem, t time.Time) (domain.MemoryItem, error) { return memory.Reopen(it, t), nil })
}
func (s *Service) EditMemory(ctx context.Context, id, content string) (MemoryItem, error) {
	return s.mutateMemory(ctx, id, func(it domain.MemoryItem, t time.Time) (domain.MemoryItem, error) { return memory.Edit(it, content, t) })
}
func validateAppearance(a Appearance) error {
	contains := func(v string, values ...string) bool {
		for _, x := range values {
			if v == x {
				return true
			}
		}
		return false
	}
	if !contains(a.Mode, "day", "night", "system") || !contains(a.Paper, "xuan", "su", "ma", "qing") || !contains(a.NightPaper, "ye", "wujin") || !contains(a.FontSize, "s", "m", "l") || !contains(a.Density, "comfortable", "compact") {
		return errors.New("外观设置无效，请重新选择纸张与阅读偏好")
	}
	return nil
}
func (s *Service) SetAppearance(ctx context.Context, a Appearance) error {
	if err := validateAppearance(a); err != nil {
		return err
	}
	raw, err := json.Marshal(a)
	if err != nil {
		return err
	}
	return friendly(s.db.SetSetting(ctx, "ui.appearance", string(raw)), "保存外观")
}
func (s *Service) SetUserSeal(ctx context.Context, seal UserSeal) error {
	if err := validateUserSeal(seal); err != nil {
		return err
	}
	raw, err := json.Marshal(seal)
	if err != nil {
		return err
	}
	return friendly(s.db.SetSetting(ctx, "ui.user_seal", string(raw)), "保存私印")
}
func validAvatar(a Avatar) error {
	switch a.Color {
	case "shiqing", "shilv", "zheshi", "tenghuang", "dai", "zise":
	default:
		return errors.New("请选择现有的成员颜料")
	}
	if utf8.RuneCountInString(a.Glyph) != 1 {
		return errors.New("印章头像需要一个字")
	}
	return nil
}
func (s *Service) SetGroupAvatar(ctx context.Context, groupID, memberID string, a *Avatar) (GroupSummary, error) {
	var avatar *domain.Avatar
	if a != nil {
		if err := validAvatar(*a); err != nil {
			return GroupSummary{}, err
		}
		v := a.domain()
		avatar = &v
	}
	if err := s.db.SetGroupAvatar(ctx, groupID, memberID, avatar); err != nil {
		return GroupSummary{}, friendly(err, "保存本群头像")
	}
	g, err := s.db.Group(ctx, groupID)
	if err != nil {
		return GroupSummary{}, friendly(err, "读取群")
	}
	out, err := s.summary(ctx, g)
	if err != nil {
		return out, friendly(err, "读取群摘要")
	}
	s.events.send(Event{"kind": "group", "group": out})
	return out, nil
}
func (s *Service) SetMemberAvatar(ctx context.Context, id string, a Avatar) (Member, error) {
	if err := validAvatar(a); err != nil {
		return Member{}, err
	}
	if err := s.db.SetMemberAvatar(ctx, id, a.domain()); err != nil {
		return Member{}, friendly(err, "保存默认头像")
	}
	m, err := s.db.Member(ctx, id)
	return memberDTO(m), friendly(err, "读取成员")
}

// SaveMember 新建或更新一位成员（TASK-007）。ID 为空表示新建。
func (s *Service) SaveMember(ctx context.Context, in SaveMemberInput) (Member, error) {
	// 与删除服务共用边界，防止检查完引用后又有新成员指向该服务。
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	in.Name = strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > 12 {
		return Member{}, errors.New("名字须为 1–12 个字")
	}
	if strings.ContainsFunc(in.Name, func(r rune) bool { return unicode.IsSpace(r) || r == '@' }) {
		return Member{}, errors.New("名字里不能有空格或 @")
	}
	if err := validAvatar(in.Avatar); err != nil {
		return Member{}, err
	}
	if utf8.RuneCountInString(in.Brief) > 30 {
		return Member{}, errors.New("一句话简介不能超过 30 字")
	}
	if utf8.RuneCountInString(in.RolePrompt) > 4000 {
		return Member{}, errors.New("角色提示词不能超过 4000 字")
	}
	if strings.TrimSpace(in.Model) == "" {
		return Member{}, errors.New("请填写模型名称")
	}
	if in.ProviderID == "" {
		return Member{}, errors.New("请选择模型服务")
	}
	if _, err := s.db.Provider(ctx, in.ProviderID); err != nil {
		return Member{}, friendly(err, "读取模型服务")
	}
	members, err := s.db.ListMembers(ctx)
	if err != nil {
		return Member{}, friendly(err, "读取成员")
	}
	for _, m := range members {
		if m.Name == in.Name && m.ID != in.ID {
			return Member{}, errors.New("已经有叫这个名字的成员了")
		}
	}
	if in.ContextTokens <= 0 {
		in.ContextTokens = 16000
	}
	m := domain.Member{ID: in.ID, Name: in.Name, Avatar: in.Avatar.domain(), Brief: strings.TrimSpace(in.Brief), RolePrompt: in.RolePrompt, ProviderID: in.ProviderID, Model: strings.TrimSpace(in.Model), Temperature: in.Temperature, ContextTokens: in.ContextTokens}
	if err = s.db.SaveMember(ctx, &m); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "constraint") {
			return Member{}, errors.New("已经有叫这个名字的成员了")
		}
		return Member{}, friendly(err, "保存成员")
	}
	return memberDTO(m), nil
}

// DeleteMember 软删除成员：从所有群里移出，并在每个群里写一条系统消息（TASK-007）。
func (s *Service) DeleteMember(ctx context.Context, id string) error {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return errors.New("应用正在关闭")
	}
	m, err := s.db.Member(ctx, id)
	if err != nil {
		return friendly(err, "读取成员")
	}
	groups, err := s.db.Groups(ctx)
	if err != nil {
		return friendly(err, "读取群")
	}
	var affected []string
	for _, g := range groups {
		if !slices.Contains(g.MemberIDs, id) {
			continue
		}
		if s.turns.Busy(g.ID) {
			return errors.New("该成员正在回复，请先停止再删除")
		}
		affected = append(affected, g.ID)
	}
	if err = s.db.DeleteMember(ctx, id); err != nil {
		return friendly(err, "删除成员")
	}
	for _, gid := range affected {
		note := domain.Message{ID: store.NewID(), GroupID: gid, AuthorKind: domain.AuthorSystem, Content: "你移出了 " + m.Name, Status: domain.StatusDone}
		if err = s.db.InsertMessage(ctx, &note); err != nil {
			slog.Warn("写系统消息失败", "error", err)
			continue
		}
		s.events.send(Event{"kind": "message", "groupId": gid, "message": messageDTO(note)})
		if err = s.emitGroup(ctx, gid); err != nil {
			slog.Warn("群摘要推送失败", "error", err)
		}
	}
	return nil
}

// Version 是应用版本，显示在设置页「关于」。
const Version = "0.1.1"

// SaveProvider 新建或更新一个模型服务（TASK-008）。Key 只在非空时写入系统钥匙串。
func (s *Service) SaveProvider(ctx context.Context, in SaveProviderInput) (ProviderConfig, error) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return ProviderConfig{}, errors.New("给服务起个名字")
	}
	if in.Kind != "openai" && in.Kind != "anthropic" {
		return ProviderConfig{}, errors.New("请选择服务类型")
	}
	if strings.TrimSpace(in.BaseURL) == "" {
		return ProviderConfig{}, errors.New("请填写服务地址")
	}
	p := domain.Provider{ID: in.ID, Name: in.Name, Kind: in.Kind, BaseURL: strings.TrimSpace(in.BaseURL)}
	if p.ID == "" {
		p.ID = store.NewID()
	} else {
		previous, err := s.db.Provider(ctx, p.ID)
		if err != nil {
			return ProviderConfig{}, friendly(err, "读取模型服务")
		}
		p.KeyRef = previous.KeyRef
	}
	key := strings.TrimSpace(in.Key)
	previousKey := ""
	if key != "" {
		if err := ctx.Err(); err != nil {
			return ProviderConfig{}, err
		}
		if p.KeyRef != "" {
			var err error
			previousKey, err = s.credentials.Get(p.ID)
			if err != nil && !errors.Is(err, secret.ErrNotFound) {
				return ProviderConfig{}, fmt.Errorf("读取原 API Key 失败：%w", err)
			}
		}
		// 凭证写入失败时，不能让旧服务的地址、名称和引用先发生变化。
		if err := s.credentials.Set(p.ID, key); err != nil {
			return ProviderConfig{}, fmt.Errorf("保存 API Key 失败：%w", err)
		}
		p.KeyRef = secret.Entry(p.ID)
	}
	if err := s.db.SaveProvider(ctx, &p); err != nil {
		if key != "" {
			var rollbackErr error
			if previousKey == "" {
				rollbackErr = s.credentials.Delete(p.ID)
			} else {
				rollbackErr = s.credentials.Set(p.ID, previousKey)
			}
			if rollbackErr != nil {
				return ProviderConfig{}, errors.New("模型服务保存失败，原 API Key 恢复也失败，请重新打开服务设置检查凭证")
			}
		}
		return ProviderConfig{}, friendly(err, "保存模型服务")
	}

	hasKey := key != ""
	if p.KeyRef != "" && !hasKey {
		if k, e := s.credentials.Get(p.ID); e == nil && k != "" {
			hasKey = true
		}
	}

	return ProviderConfig{p.ID, p.Name, p.Kind, p.BaseURL, hasKey}, nil
}

// DeleteProvider 删除模型服务；仍被成员使用时拒绝（TASK-008）。
func (s *Service) DeleteProvider(ctx context.Context, id string) error {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	used, err := s.db.MembersUsingProvider(ctx, id)
	if err != nil {
		return friendly(err, "读取成员")
	}
	if len(used) > 0 {
		return fmt.Errorf("还有成员在用这个服务：%s。请先改掉他们的模型服务。", strings.Join(used, "、"))
	}

	p, err := s.db.Provider(ctx, id)
	if err != nil {
		return friendly(err, "读取模型服务")
	}
	previousKey := ""
	removedCredential := false
	if p.KeyRef != "" {
		previousKey, err = s.credentials.Get(id)
		if err != nil && !errors.Is(err, secret.ErrNotFound) {
			return fmt.Errorf("读取原 API Key 失败：%w", err)
		}
		if err == nil {
			if err = s.credentials.Delete(id); err != nil {
				return fmt.Errorf("删除 API Key 失败：%w", err)
			}
			removedCredential = true
		}
	}
	if err = s.db.DeleteProviderAndMemoryConfig(ctx, id); err != nil {
		if removedCredential && previousKey != "" {
			if rollbackErr := s.credentials.Set(id, previousKey); rollbackErr != nil {
				return errors.New("模型服务删除失败，原 API Key 恢复也失败，请重新打开服务设置检查凭证")
			}
		}
		return friendly(err, "删除模型服务")
	}

	return nil
}

// TestProvider 发一个极短请求验证服务可用，返回耗时（毫秒）。Key 留空时用已保存的。
func (s *Service) TestProvider(ctx context.Context, in SaveProviderInput) (int, error) {
	if in.Kind != "openai" && in.Kind != "anthropic" {
		return 0, errors.New("请选择服务类型")
	}
	if strings.TrimSpace(in.BaseURL) == "" {
		return 0, errors.New("请填写服务地址")
	}
	model := strings.TrimSpace(in.TestModel)
	if model == "" {
		return 0, errors.New("请填写这个服务实际可用的测试模型名称")
	}
	key := strings.TrimSpace(in.Key)
	if key == "" && in.ID != "" {
		// 读取与服务保存共用边界；凭证读取失败不应被伪装成远端鉴权失败。
		var err error
		key, err = func() (string, error) {
			s.providersMu.Lock()
			defer s.providersMu.Unlock()
			p, err := s.db.Provider(ctx, in.ID)
			if err != nil {
				return "", friendly(err, "读取模型服务")
			}
			if p.KeyRef == "" {
				return "", nil
			}
			stored, err := s.credentials.Get(in.ID)
			if err != nil {
				return "", fmt.Errorf("读取已保存的 API Key 失败：%w", err)
			}
			if stored == "" {
				return "", secret.ErrNotFound
			}
			return stored, nil
		}()
		if err != nil {
			return 0, err
		}
	}
	if key == "" && in.Kind == "anthropic" {
		return 0, errors.New("请填写 API Key")
	}
	probe := domain.Provider{ID: "probe", Kind: in.Kind, BaseURL: strings.TrimSpace(in.BaseURL)}
	if key != "" {
		probe.KeyRef = secret.Entry("probe")
	}
	client, err := providers.New(func(string) (string, error) { return key, nil })(ctx, probe)
	if err != nil {
		return 0, err
	}
	testCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	start := time.Now()
	if _, err = client.Stream(testCtx, llm.Request{Model: model, MaxTokens: 32, Messages: []llm.Message{{Role: llm.RoleUser, Content: "ping"}}}, func(string) {}); err != nil {
		return 0, err
	}
	return int(time.Since(start).Milliseconds()), nil
}

// SetMemoryConfig 保存纪要整理用的服务与模型。
func (s *Service) SetMemoryConfig(ctx context.Context, cfg MemoryConfig) error {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	if cfg.ProviderID != "" {
		if _, err := s.db.Provider(ctx, cfg.ProviderID); err != nil {
			return friendly(err, "读取模型服务")
		}
	} else {
		cfg.Model = ""
	}

	values := map[string]string{}
	for key, value := range map[string]string{"memory.provider_id": cfg.ProviderID, "memory.model": cfg.Model} {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		values[key] = string(raw)
	}
	return friendly(s.db.SetSettings(ctx, values), "保存纪要设置")
}

// DataDir 返回数据库所在目录；OpenDataDir 在文件管理器中打开它。
func (s *Service) DataDir() string {
	return filepath.Dir(s.db.Path())
}

func (s *Service) OpenDataDir() error {
	dir := s.DataDir()
	if dir == "" {
		return errors.New("无法定位数据目录")
	}
	cmd := "xdg-open"
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd = "explorer"
	}
	if err := exec.Command(cmd, dir).Start(); err != nil {
		return fmt.Errorf("打开数据目录失败：%w", err)
	}
	return nil
}

// settingString 读取一个以 JSON 字符串保存的设置项；不存在或非法时返回空串。
func (s *Service) settingString(ctx context.Context, key string) (string, error) {
	raw, err := s.db.Setting(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var v string
	if json.Unmarshal([]byte(raw), &v) != nil {
		return "", nil
	}
	return v, nil
}

func (s *Service) saveSetting(ctx context.Context, key, value string) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.db.SetSetting(ctx, key, string(raw))
}

func modeLabel(m domain.ReplyMode) string {
	if m == domain.ModeParallel {
		return "同时回复"
	}
	return "依次回复"
}

// difference 返回在 a 中、不在 b 中的元素（保持 a 的顺序）。
func difference(a, b []string) []string {
	in := make(map[string]bool, len(b))
	for _, x := range b {
		in[x] = true
	}
	out := []string{}
	for _, x := range a {
		if !in[x] {
			out = append(out, x)
		}
	}
	return out
}

// systemMessage 写一条系统通知并推送，进入上下文供成员感知（TASK-009）。
func (s *Service) systemMessage(ctx context.Context, groupID, content string) {
	note := domain.Message{ID: store.NewID(), GroupID: groupID, AuthorKind: domain.AuthorSystem, Content: content, Status: domain.StatusDone}
	if err := s.db.InsertMessage(ctx, &note); err != nil {
		slog.Warn("写系统消息失败", "error", err)
		return
	}
	s.events.send(Event{"kind": "message", "groupId": groupID, "message": messageDTO(note)})
}

// UpdateGroup 保存群设置：改名、主题、默认回复方式、成员增删与顺序（TASK-009）。
// 每次变更写一条系统消息；有进行中的轮次时不允许改动成员。
func (s *Service) UpdateGroup(ctx context.Context, in UpdateGroupInput) (Group, error) {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return Group{}, errors.New("应用正在关闭")
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Topic = strings.TrimSpace(in.Topic)
	if in.Title == "" {
		return Group{}, errors.New("群名不能为空")
	}
	if in.DefaultMode != domain.ModeSerial && in.DefaultMode != domain.ModeParallel {
		return Group{}, errors.New("请选择依次或同时回复")
	}
	if len(in.MemberIDs) == 0 {
		return Group{}, errors.New("群里至少要有一位成员")
	}
	g, err := s.db.Group(ctx, in.ID)
	if err != nil {
		return Group{}, friendly(err, "读取群")
	}
	if s.turns.Busy(in.ID) && !slices.Equal(g.MemberIDs, in.MemberIDs) {
		return Group{}, errors.New("有成员正在回复，请先停止再调整成员")
	}
	var notes []string
	if g.Title != in.Title {
		notes = append(notes, "你把群名改为「"+in.Title+"」")
	}
	if g.Topic != in.Topic {
		notes = append(notes, "你改了群主题")
	}
	if g.DefaultMode != in.DefaultMode {
		notes = append(notes, "你把默认回复方式改为"+modeLabel(in.DefaultMode))
	}
	added := difference(in.MemberIDs, g.MemberIDs)
	removed := difference(g.MemberIDs, in.MemberIDs)
	names := func(ids []string) []string {
		m, _ := s.db.Members(ctx, ids)
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			if x, ok := m[id]; ok {
				out = append(out, x.Name)
			}
		}
		return out
	}
	for _, n := range names(added) {
		notes = append(notes, "你邀请了 "+n)
	}
	for _, n := range names(removed) {
		notes = append(notes, "你移出了 "+n)
	}
	if len(added) == 0 && len(removed) == 0 && !slices.Equal(g.MemberIDs, in.MemberIDs) {
		notes = append(notes, "你调整了发言顺序")
	}
	g.Title, g.Topic, g.DefaultMode, g.MemberIDs = in.Title, in.Topic, in.DefaultMode, in.MemberIDs
	if err = s.db.UpdateGroup(ctx, g); err != nil {
		return Group{}, friendly(err, "保存群设置")
	}
	for _, n := range notes {
		s.systemMessage(ctx, g.ID, n)
	}
	out, err := s.groupDTO(ctx, g)
	if err != nil {
		return out, friendly(err, "读取群摘要")
	}
	s.events.send(Event{"kind": "group", "group": out.GroupSummary})
	return out, nil
}

// ArchiveGroup 归档 / 取消归档：只影响侧栏可见性，不删除数据（TASK-009）。
func (s *Service) ArchiveGroup(ctx context.Context, id string, archived bool) error {
	var at *time.Time
	if archived {
		now := time.Now()
		at = &now
	}
	if err := s.db.ArchiveGroup(ctx, id, at); err != nil {
		return friendly(err, "归档群")
	}
	g, err := s.db.Group(ctx, id)
	if err != nil {
		return friendly(err, "读取群")
	}
	out, err := s.summary(ctx, g)
	if err != nil {
		return friendly(err, "读取群摘要")
	}
	s.events.send(Event{"kind": "group", "group": out})
	return nil
}

// DeleteGroup 删除群并级联删除消息与记忆（TASK-009）。
func (s *Service) DeleteGroup(ctx context.Context, id string) error {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return errors.New("应用正在关闭")
	}
	if s.turns.Busy(id) {
		return errors.New("该群正在回复，请先停止再删除")
	}
	if err := s.db.DeleteGroup(ctx, id); err != nil {
		return friendly(err, "删除群")
	}
	s.events.send(Event{"kind": "group.remove", "groupId": id})
	return nil
}

// CompleteMemory / UncompleteMemory 是用户对待办的勾选（TASK-010）。
func (s *Service) CompleteMemory(ctx context.Context, id string) (MemoryItem, error) {
	return s.mutateMemory(ctx, id, memory.Complete)
}
func (s *Service) UncompleteMemory(ctx context.Context, id string) (MemoryItem, error) {
	return s.mutateMemory(ctx, id, memory.Uncomplete)
}
