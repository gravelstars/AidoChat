// Package turn 编排"一次发送"：落库用户消息 → 解析 @ → 为每个回复者建占位消息 →
// 按串行或并行调用模型 → 流式推送 → 收尾。见 ADR-0001、ADR-0002。
//
// 并发约定：
//   - 每个群同一时刻最多一个进行中的轮次（Send 返回 ErrBusy）。
//   - Stop 取消整个轮次：正在生成的回复标为 stopped 并保留已生成内容，排队中的标为 stopped 且内容为空。
//   - 串行模式下某个成员失败，标为 error 后继续下一位；后续成员看不到失败的回复。
package turn

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"ai-group-chat/internal/contextbuilder"
	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

var (
	ErrBusy         = errors.New("该群有回复正在进行，请稍候或先停止")
	ErrEmpty        = errors.New("消息不能为空")
	ErrNotRetryable = errors.New("只能重试失败或已中断的成员回复")
)

// Store 是编排器需要的最小持久化接口，SQLite 实现见 TASK-003。
type Store interface {
	Group(ctx context.Context, id string) (domain.Group, error)
	Members(ctx context.Context, ids []string) (map[string]domain.Member, error)
	Provider(ctx context.Context, id string) (domain.Provider, error)
	// Message 按 ID 读取单条消息（重试用）。
	Message(ctx context.Context, id string) (domain.Message, error)
	// RecentMessages 返回该群最近 limit 条消息，按 Seq 升序。
	RecentMessages(ctx context.Context, groupID string, limit int) ([]domain.Message, error)
	MemoryItems(ctx context.Context, groupID string) ([]domain.MemoryItem, error)
	// InsertMessage 在事务里分配 Seq（群内 max+1）并写入，回填 m.Seq。
	InsertMessage(ctx context.Context, m *domain.Message) error
	UpdateMessage(ctx context.Context, m domain.Message) error
}

// Providers 根据服务配置构造可调用的 Provider（含从钥匙串读取 Key）。
type Providers func(ctx context.Context, p domain.Provider) (llm.Provider, error)

type EventKind string

const (
	EventMessage   EventKind = "message"    // 消息新建或状态变化，携带完整 Message
	EventDelta     EventKind = "delta"      // 流式增量，只带 MessageID + Delta
	EventTurnStart EventKind = "turn.start" // 携带 TurnID 与回复顺序
	EventTurnEnd   EventKind = "turn.end"
)

type Event struct {
	Kind      EventKind
	GroupID   string
	TurnID    string
	Message   *domain.Message
	MessageID string
	Delta     string
	Order     []string
}

type Sink func(Event)

type Orchestrator struct {
	Store     Store
	Providers Providers
	Emit      Sink
	NewID     func() string
	Now       func() time.Time
	// AfterTurn 在轮次结束后异步调用，用于触发群记忆整理（TASK-006）。可为 nil。
	AfterTurn func(groupID string)
	// HistoryLimit 是组装上下文时最多加载的历史条数，默认 200。
	HistoryLimit int

	mu     sync.Mutex
	active map[string]context.CancelFunc // groupID -> cancel
}

type SendResult struct {
	UserMessage domain.Message
	TurnID      string
	Order       []string // 为空表示没有 @ 任何人：只记录，不触发回复
}

// Send 同步完成落库与编排准备后立即返回，模型调用在后台进行，结果通过 Emit 推送。
func (o *Orchestrator) Send(ctx context.Context, groupID, content string, mode *domain.ReplyMode) (SendResult, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return SendResult{}, ErrEmpty
	}
	runCtx, cancel := context.WithCancel(context.Background())
	if !o.acquire(groupID, cancel) {
		cancel()
		return SendResult{}, ErrBusy
	}
	release := func() { o.release(groupID); cancel() }

	g, err := o.Store.Group(ctx, groupID)
	if err != nil {
		release()
		return SendResult{}, err
	}
	members, err := o.Store.Members(ctx, g.MemberIDs)
	if err != nil {
		release()
		return SendResult{}, err
	}
	cands := make([]domain.Member, 0, len(g.MemberIDs))
	for _, id := range g.MemberIDs {
		if m, ok := members[id]; ok {
			cands = append(cands, m)
		}
	}
	ids, all := domain.ParseMentions(content, cands)
	order := domain.PlanTargets(g, ids, all)
	m := g.DefaultMode
	if mode != nil {
		m = *mode
	}
	if m != domain.ModeParallel {
		m = domain.ModeSerial
	}

	turnID := o.NewID()
	now := o.Now()
	user := domain.Message{
		ID: o.NewID(), GroupID: groupID, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID,
		Content: content, Mentions: ids, MentionAll: all, TurnID: turnID, ReplyMode: m,
		Status: domain.StatusDone, CreatedAt: now, FinishedAt: &now,
	}
	if err := o.Store.InsertMessage(ctx, &user); err != nil {
		release()
		return SendResult{}, err
	}
	o.emit(Event{Kind: EventMessage, GroupID: groupID, TurnID: turnID, Message: &user})

	res := SendResult{UserMessage: user, TurnID: turnID, Order: order}
	if len(order) == 0 {
		release()
		return res, nil
	}

	// 先为所有回复者建占位，前端立刻能看到"谁在排队"。
	slots := make([]domain.Message, 0, len(order))
	for _, id := range order {
		mem := members[id]
		slot := domain.Message{
			ID: o.NewID(), GroupID: groupID, AuthorKind: domain.AuthorMember, AuthorID: id,
			ReplyToID: user.ID, TurnID: turnID, Model: mem.Model,
			Status: domain.StatusPending, CreatedAt: o.Now(),
		}
		if err := o.Store.InsertMessage(ctx, &slot); err != nil {
			release()
			return res, err
		}
		slots = append(slots, slot)
		o.emit(Event{Kind: EventMessage, GroupID: groupID, TurnID: turnID, Message: &slot})
	}
	o.emit(Event{Kind: EventTurnStart, GroupID: groupID, TurnID: turnID, Order: order})

	go func() {
		defer func() {
			// Sink 在锁外调用，但送达结束事件之前仍保留轮次占用，避免新 start 越过旧 end。
			o.emit(Event{Kind: EventTurnEnd, GroupID: groupID, TurnID: turnID})
			release()
			if o.AfterTurn != nil {
				go o.AfterTurn(groupID)
			}
		}()
		t := contextbuilder.Turn{UserMessage: user, Mode: m, Order: order}
		if m == domain.ModeParallel {
			var wg sync.WaitGroup
			for i := range slots {
				wg.Add(1)
				go func(slot domain.Message) {
					defer wg.Done()
					o.reply(runCtx, g, members, t, slot)
				}(slots[i])
			}
			wg.Wait()
			return
		}
		for _, slot := range slots {
			o.reply(runCtx, g, members, t, slot)
		}
	}()
	return res, nil
}

// Retry 在原消息上原地重新生成一位失败或已中断的成员回复（TASK-005）。
// 保留 ID、Seq、ReplyToID、TurnID，只清空内容并重走生成流程；重试本身占用该群的轮次锁。
func (o *Orchestrator) Retry(ctx context.Context, messageID string) error {
	msg, err := o.Store.Message(ctx, messageID)
	if err != nil {
		return err
	}
	if msg.AuthorKind != domain.AuthorMember || (msg.Status != domain.StatusError && msg.Status != domain.StatusStopped) {
		return ErrNotRetryable
	}
	runCtx, cancel := context.WithCancel(context.Background())
	if !o.acquire(msg.GroupID, cancel) {
		cancel()
		return ErrBusy
	}
	release := func() { o.release(msg.GroupID); cancel() }

	g, err := o.Store.Group(ctx, msg.GroupID)
	if err != nil {
		release()
		return err
	}
	members, err := o.Store.Members(ctx, g.MemberIDs)
	if err != nil {
		release()
		return err
	}
	// 用当时的用户消息确定轮次模式；上下文可见性依赖它（依次能看到前面已完成的回复，同时看不到）。
	user, err := o.Store.Message(ctx, msg.ReplyToID)
	if err != nil {
		release()
		return err
	}
	mode := user.ReplyMode
	if mode != domain.ModeParallel {
		mode = domain.ModeSerial
	}
	// 重建原轮次的回复顺序（同 TurnID 的成员回复按 Seq），以便提示词正确描述"你是第几位"。
	order := []string{msg.AuthorID}
	limit := o.HistoryLimit
	if limit <= 0 {
		limit = 200
	}
	if history, e := o.Store.RecentMessages(ctx, g.ID, limit); e == nil {
		rebuilt := []string{}
		for _, m := range history {
			if m.AuthorKind == domain.AuthorMember && m.TurnID == msg.TurnID {
				rebuilt = append(rebuilt, m.AuthorID)
			}
		}
		if len(rebuilt) > 0 {
			order = rebuilt
		}
	}

	// 原地重置：保留编号与触发关系，先推送 pending 让界面回到"思考中"。
	msg.Content, msg.Error, msg.FinishedAt, msg.Status = "", "", nil, domain.StatusPending
	if err = o.Store.UpdateMessage(ctx, msg); err != nil {
		release()
		return err
	}
	o.emit(Event{Kind: EventMessage, GroupID: g.ID, TurnID: msg.TurnID, Message: &msg})
	o.emit(Event{Kind: EventTurnStart, GroupID: g.ID, TurnID: msg.TurnID, Order: []string{msg.AuthorID}})

	go func() {
		defer func() {
			o.emit(Event{Kind: EventTurnEnd, GroupID: g.ID, TurnID: msg.TurnID})
			release()
		}()
		t := contextbuilder.Turn{UserMessage: user, Mode: mode, Order: order}
		o.reply(runCtx, g, members, t, msg)
	}()
	return nil
}

// Stop 取消该群进行中的轮次。没有进行中的轮次时什么也不做。
func (o *Orchestrator) Stop(groupID string) {
	o.mu.Lock()
	cancel := o.active[groupID]
	o.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// Busy 报告该群是否有进行中的轮次。
func (o *Orchestrator) Busy(groupID string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.active[groupID] != nil
}

func (o *Orchestrator) acquire(groupID string, cancel context.CancelFunc) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.active == nil {
		o.active = map[string]context.CancelFunc{}
	}
	if o.active[groupID] != nil {
		return false
	}
	o.active[groupID] = cancel
	return true
}

func (o *Orchestrator) release(groupID string) {
	o.mu.Lock()
	delete(o.active, groupID)
	o.mu.Unlock()
}

func (o *Orchestrator) emit(e Event) {
	if o.Emit != nil {
		o.Emit(e)
	}
}

// reply 生成一位成员的回复。所有错误都落到消息状态上，不向上返回。
func (o *Orchestrator) reply(ctx context.Context, g domain.Group, members map[string]domain.Member, t contextbuilder.Turn, slot domain.Message) {
	// 落库与推送不受用户"停止"影响，用独立 ctx。
	bg := context.Background()
	finish := func(status domain.MessageStatus, errText string) {
		now := o.Now()
		slot.Status, slot.Error, slot.FinishedAt = status, errText, &now
		_ = o.Store.UpdateMessage(bg, slot)
		o.emit(Event{Kind: EventMessage, GroupID: g.ID, TurnID: t.UserMessage.TurnID, Message: &slot})
	}
	if ctx.Err() != nil {
		finish(domain.StatusStopped, "")
		return
	}

	self, ok := members[slot.AuthorID]
	if !ok {
		finish(domain.StatusError, "成员不存在")
		return
	}
	prov, err := o.Store.Provider(bg, self.ProviderID)
	if err != nil {
		finish(domain.StatusError, "找不到模型服务配置")
		return
	}
	client, err := o.Providers(bg, prov)
	if err != nil {
		finish(domain.StatusError, err.Error())
		return
	}
	limit := o.HistoryLimit
	if limit <= 0 {
		limit = 200
	}
	// 串行时每位成员重新加载历史，才能看到前一位刚写完的回复。
	history, err := o.Store.RecentMessages(bg, g.ID, limit)
	if err != nil {
		finish(domain.StatusError, err.Error())
		return
	}
	// 重试时同轮后序回复可能已完成；在进入受保护的 Builder 前恢复原先的可见性。
	if t.Mode == domain.ModeSerial {
		filtered := history[:0]
		for _, m := range history {
			if m.TurnID == slot.TurnID && m.AuthorKind == domain.AuthorMember && m.Seq > slot.Seq {
				continue
			}
			filtered = append(filtered, m)
		}
		history = filtered
	}

	mem, err := o.Store.MemoryItems(bg, g.ID)
	if err != nil {
		finish(domain.StatusError, err.Error())
		return
	}
	// 历史里可能出现已退群成员的发言，补齐名字。
	all := members
	if missing := missingAuthors(history, members); len(missing) > 0 {
		if extra, err := o.Store.Members(bg, missing); err == nil {
			all = make(map[string]domain.Member, len(members)+len(extra))
			for k, v := range members {
				all[k] = v
			}
			for k, v := range extra {
				all[k] = v
			}
		}
	}

	out := contextbuilder.Build(contextbuilder.Input{
		Group: g, Members: all, Self: self, History: history, Memory: mem, Turn: t,
	})
	slot.Status, slot.Provider, slot.Model, slot.ContextSeq = domain.StatusStreaming, prov.Name, self.Model, out.ContextSeq
	_ = o.Store.UpdateMessage(bg, slot)
	o.emit(Event{Kind: EventMessage, GroupID: g.ID, TurnID: t.UserMessage.TurnID, Message: &slot})

	var sb strings.Builder
	_, err = client.Stream(ctx, out.Request, func(d string) {
		sb.WriteString(d)
		o.emit(Event{Kind: EventDelta, GroupID: g.ID, TurnID: t.UserMessage.TurnID, MessageID: slot.ID, Delta: d})
	})
	slot.Content = contextbuilder.SanitizeReply(self.Name, sb.String())
	switch {
	case ctx.Err() != nil:
		finish(domain.StatusStopped, "")
	case err != nil:
		finish(domain.StatusError, err.Error())
	case strings.TrimSpace(slot.Content) == "":
		finish(domain.StatusError, "模型返回了空内容")
	default:
		finish(domain.StatusDone, "")
	}
}

func missingAuthors(history []domain.Message, members map[string]domain.Member) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range history {
		if m.AuthorKind != domain.AuthorMember || seen[m.AuthorID] {
			continue
		}
		seen[m.AuthorID] = true
		if _, ok := members[m.AuthorID]; !ok {
			out = append(out, m.AuthorID)
		}
	}
	return out
}
