// runner.go 把 memory 包的提示词、解析与校验接到真实流程里（TASK-006）。
// 它不改变任何校验规则：AI 产出的操作仍由 Apply 逐条把关，confirmed 依旧只能由用户盖章产生。
package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

// errNoSummarizer 表示群里没有可用成员、也没有配置整理模型。
var errNoSummarizer = errors.New("没有可用的整理模型，请先配置模型服务")

// Store 是整理器需要的持久化能力。*store.Store 满足它。
type Store interface {
	Group(ctx context.Context, id string) (domain.Group, error)
	Members(ctx context.Context, ids []string) (map[string]domain.Member, error)
	// VisibleMessagesAfter 从游标之后按 Seq 升序读取可见消息，避免积压超过上限时跳过最早未整理记录。
	VisibleMessagesAfter(ctx context.Context, groupID string, cursor int64, limit int) ([]domain.Message, error)
	MemoryItems(ctx context.Context, groupID string) ([]domain.MemoryItem, error)
	SaveMemoryItems(ctx context.Context, groupID string, items []domain.MemoryItem, cursor int64) error
	Provider(ctx context.Context, id string) (domain.Provider, error)
	// Setting 读取设置项；不存在时返回 sql.ErrNoRows。
	Setting(ctx context.Context, key string) (string, error)
}

// Providers 按服务配置构造可调用的 Provider（含从钥匙串读取 Key）。
type Providers func(ctx context.Context, p domain.Provider) (llm.Provider, error)

// Event 是推送给前端的记忆变化。整场整理期间会收到一次 summarizing=true、一次 false。
type Event struct {
	GroupID     string
	Items       []domain.MemoryItem
	Cursor      int64
	Summarizing bool
	Error       string
}

// Runner 执行记忆整理，并串行化所有记忆写入（整理落地与用户盖章共用同一把锁）。
type Runner struct {
	Store     Store
	Providers Providers
	Emit      func(Event)
	NewID     func() string
	Now       func() time.Time
	Policy    Policy
	// HistoryLimit 从游标之后最多加载的历史条数，默认 1000（远大于 MaxWindow）。
	HistoryLimit int
	// Write 串行化记忆写入的互斥量，通常与用户操作（盖章/否决/改写）共用同一把。
	// 为 nil 时用内部锁。
	Write *sync.Mutex

	internal sync.Mutex // Write 为 nil 时的后备锁

	mu      sync.Mutex
	running map[string]bool // 正在整理的群
	again   map[string]bool // 整理期间又被触发，且下次是否强制
	closed  bool
	wg      sync.WaitGroup
	base    context.Context
	cancel  context.CancelFunc
}

func (r *Runner) writeMu() *sync.Mutex {
	if r.Write != nil {
		return r.Write
	}
	return &r.internal
}

func (r *Runner) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *Runner) newID() string {
	if r.NewID != nil {
		return r.NewID()
	}
	return ""
}

func (r *Runner) policy() Policy {
	if r.Policy.MinMessages == 0 && r.Policy.MinTokens == 0 && r.Policy.MaxWindow == 0 {
		return DefaultPolicy
	}
	return r.Policy
}

func (r *Runner) historyLimit() int {
	if r.HistoryLimit > 0 {
		return r.HistoryLimit
	}
	return 1000
}

func (r *Runner) emit(e Event) {
	if r.Emit != nil {
		r.Emit(e)
	}
}

// Trigger 异步触发一次自动整理（AfterTurn 钩子调用）。未达到触发条件时什么都不做。
func (r *Runner) Trigger(groupID string) { r.spawn(groupID, false) }

// Summarize 是用户点「整理」的手动触发（force = true）。先校验群存在以便把错误反馈给界面，
// 随后异步整理，结果通过 memory 事件推送。
func (r *Runner) Summarize(ctx context.Context, groupID string) error {
	if _, err := r.Store.Group(ctx, groupID); err != nil {
		return err
	}
	r.spawn(groupID, true)
	return nil
}

// Close 停止接受新的整理，并等待进行中的整理退出（模型调用会随 ctx 取消尽快返回）。
func (r *Runner) Close() {
	r.mu.Lock()
	r.closed = true
	cancel := r.cancel
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	r.wg.Wait()
}

func (r *Runner) spawn(groupID string, force bool) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	if r.base == nil {
		r.base, r.cancel = context.WithCancel(context.Background())
	}
	r.wg.Add(1)
	r.mu.Unlock()
	go func() {
		defer r.wg.Done()
		r.loop(r.base, groupID, force)
	}()
}

// loop 保证同一群同一时刻只跑一个整理任务：整理期间又来的请求合并为一次（force 取或）。
func (r *Runner) loop(ctx context.Context, groupID string, force bool) {
	for {
		r.mu.Lock()
		if r.running == nil {
			r.running = map[string]bool{}
			r.again = map[string]bool{}
		}
		if r.running[groupID] {
			r.again[groupID] = r.again[groupID] || force
			r.mu.Unlock()
			return
		}
		r.running[groupID] = true
		r.mu.Unlock()

		r.once(ctx, groupID, force)

		r.mu.Lock()
		delete(r.running, groupID)
		next, rerun := r.again[groupID]
		delete(r.again, groupID)
		r.mu.Unlock()
		if !rerun {
			return
		}
		force = next
	}
}

func (r *Runner) once(ctx context.Context, groupID string, force bool) {
	store := r.Store
	g, err := store.Group(ctx, groupID)
	if err != nil {
		slog.Warn("整理：读取群失败", "group", groupID, "error", err)
		return
	}
	history, err := store.VisibleMessagesAfter(ctx, groupID, g.MemoryCursor, r.historyLimit())
	if err != nil {
		slog.Warn("整理：读取历史失败", "group", groupID, "error", err)
		return
	}
	history = attachmentHistory(history)
	window, ready := r.policy().Pending(g.MemoryCursor, history, force)
	if !ready {
		return
	}
	provider, model, err := r.summarizer(ctx, g)
	if err != nil {
		slog.Warn("整理：没有可用的整理模型", "group", groupID, "error", err)
		return
	}
	items, err := store.MemoryItems(ctx, groupID)
	if err != nil {
		slog.Warn("整理：读取条目失败", "group", groupID, "error", err)
		return
	}
	members, err := store.Members(ctx, g.MemberIDs)
	if err != nil {
		slog.Warn("整理：读取成员失败", "group", groupID, "error", err)
		return
	}
	client, err := r.Providers(ctx, provider)
	if err != nil {
		slog.Warn("整理：构造模型客户端失败", "group", groupID, "error", err)
		return
	}

	if err := r.publishCurrent(ctx, groupID, true); err != nil {
		slog.Warn("整理：推送状态失败", "group", groupID, "error", err)
		return
	}

	budget := firstMember(g, members).ContextTokens
	if budget <= 0 {
		budget = 16000
	}
	window, err = summaryWindow(model, g, members, items, window, budget)
	if err != nil {
		r.publishFailure(groupID)
		r.emit(Event{GroupID: groupID, Items: items, Cursor: g.MemoryCursor, Error: err.Error()})
		return
	}
	req := BuildRequest(model, g, members, items, window, time.Local)
	raw, err := r.complete(ctx, client, req)
	ops, parseErr := ParseOps(raw)
	if parseErr != nil {
		// 解析失败：重试一次；仍失败则保持游标不动，记录原始输出的前 500 字。
		if ctx.Err() == nil {
			if raw2, err2 := r.complete(ctx, client, req); err2 == nil {
				if ops2, parseErr2 := ParseOps(raw2); parseErr2 == nil {
					ops, parseErr, raw, err = ops2, nil, raw2, nil
				} else {
					parseErr, raw = parseErr2, raw2
				}
			}
		}
	}
	if err != nil {
		slog.Warn("整理：调用模型失败", "group", groupID, "error", err)
		r.publishFailure(groupID)
		return
	}
	if parseErr != nil {
		slog.Warn("整理：结果不是合法 JSON", "group", groupID, "error", parseErr, "raw", head(raw, 500))
		r.publishFailure(groupID)
		return
	}

	// 落地必须与用户操作串行：重新读取最新条目与游标后再应用，避免用过时快照覆盖用户刚确认的条目。
	err = r.apply(ctx, groupID, ops, window, members)
	if err != nil {
		slog.Warn("整理：保存失败", "group", groupID, "error", err)
		r.publishFailure(groupID)
		return
	}
}

// publishCurrent 的读取与推送共用用户操作的锁，旧快照不能越过刚盖章的事件。
func (r *Runner) publishCurrent(ctx context.Context, groupID string, summarizing bool) error {
	mu := r.writeMu()
	mu.Lock()
	defer mu.Unlock()
	items, err := r.Store.MemoryItems(ctx, groupID)
	if err != nil {
		return err
	}
	g, err := r.Store.Group(ctx, groupID)
	if err != nil {
		return err
	}
	r.emit(Event{GroupID: groupID, Items: items, Cursor: g.MemoryCursor, Summarizing: summarizing})
	return nil
}

func (r *Runner) publishFailure(groupID string) {
	// 模型调用的 ctx 可能已取消；本地状态仍须以最新持久化结果收尾。
	if err := r.publishCurrent(context.Background(), groupID, false); err != nil {
		slog.Warn("整理：推送结束状态失败", "group", groupID, "error", err)
	}
}

// apply 将最新状态的读取、落库和推送置于同一写锁，保持与用户操作的事件顺序。
func (r *Runner) apply(ctx context.Context, groupID string, ops []Op, window []domain.Message, members map[string]domain.Member) error {
	mu := r.writeMu()
	mu.Lock()
	defer mu.Unlock()

	fresh, err := r.Store.MemoryItems(ctx, groupID)
	if err != nil {
		return err
	}
	g, err := r.Store.Group(ctx, groupID)
	if err != nil {
		return err
	}
	res := Apply(fresh, ops, window, Env{GroupID: groupID, Members: members, NewID: r.newID, Now: r.now()})
	if len(res.Rejected) > 0 {
		slog.Info("整理：拒绝了不合规操作", "group", groupID, "rejected", res.Rejected)
	}
	// 只落库发生变化的条目；未变化的保持不动。
	changed := map[string]bool{}
	for _, id := range res.Changed {
		changed[id] = true
	}
	var save []domain.MemoryItem
	for _, it := range res.Items {
		if changed[it.ID] {
			save = append(save, it)
		}
	}
	// 窗口游标不能后退：另一次整理若已推进到更靠后的位置，保留较新的游标。
	cursor := res.Cursor
	if g.MemoryCursor > cursor {
		cursor = g.MemoryCursor
	}
	if err = r.Store.SaveMemoryItems(ctx, groupID, save, cursor); err != nil {
		return err
	}
	final, err := r.Store.MemoryItems(ctx, groupID)
	if err != nil {
		return err
	}
	r.emit(Event{GroupID: groupID, Items: final, Cursor: cursor, Summarizing: false})
	return nil
}

// complete 用非流式方式收齐全文：Stream 的回调拼起来即可。
func (r *Runner) complete(ctx context.Context, client llm.Provider, req llm.Request) (string, error) {
	var sb strings.Builder
	_, err := client.Stream(ctx, req, func(d string) { sb.WriteString(d) })
	return sb.String(), err
}

// summarizer 解析整理模型：优先设置里的 memory.provider_id / memory.model，
// 未设置时用该群第一位成员的服务与模型。
func (r *Runner) summarizer(ctx context.Context, g domain.Group) (domain.Provider, string, error) {
	id := r.setting(ctx, "memory.provider_id")
	model := r.setting(ctx, "memory.model")
	members, err := r.Store.Members(ctx, g.MemberIDs)
	if err != nil {
		return domain.Provider{}, "", err
	}
	first := firstMember(g, members)
	if id == "" {
		id = first.ProviderID
	}
	if model == "" {
		model = first.Model
	}
	if id == "" {
		return domain.Provider{}, "", errNoSummarizer
	}
	p, err := r.Store.Provider(ctx, id)
	if err != nil {
		return domain.Provider{}, "", err
	}
	if model == "" {
		model = first.Model
	}
	return p, model, nil
}

func (r *Runner) setting(ctx context.Context, key string) string {
	raw, err := r.Store.Setting(ctx, key)
	if err != nil {
		return ""
	}
	var s string
	if json.Unmarshal([]byte(raw), &s) == nil {
		return s
	}
	return strings.TrimSpace(raw)
}

func firstMember(g domain.Group, members map[string]domain.Member) domain.Member {
	for _, id := range g.MemberIDs {
		if m, ok := members[id]; ok {
			return m
		}
	}
	return domain.Member{}
}

func head(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// 整理只读带来源的提取文字，原图不会自动发送给整理模型。
func attachmentHistory(history []domain.Message) []domain.Message {
	out := append([]domain.Message(nil), history...)
	for i, m := range out {
		out[i].Content = m.Content + domain.AttachmentText(m, false)
	}
	return out
}
func summaryWindow(model string, g domain.Group, members map[string]domain.Member, items []domain.MemoryItem, window []domain.Message, budget int) ([]domain.Message, error) {
	for n := 1; n <= len(window); n++ {
		req := BuildRequest(model, g, members, items, window[:n], time.Local)
		cost := llm.EstimateTokens(req.System)
		for _, m := range req.Messages {
			cost += llm.EstimateTokens(m.Content) + 4
		}
		if cost > budget {
			if n == 1 {
				return nil, fmt.Errorf("纪要整理暂停：消息 #%d 及其附件超过整理上下文预算 %d，请配置更大预算的整理成员或拆分文档；该消息尚未整理", window[0].Seq, budget)
			}
			return window[:n-1], nil
		}
	}
	return window, nil
}
