package memory

import (
	"context"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm/providers"
	"ai-group-chat/internal/secret"
)

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

// TestLiveSummarize 用真实模型跑一次整理（TASK-006 的真实验收）。
// 默认跳过，只有 keys 已在系统钥匙串、并显式设置 AGC_LIVE_MEMORY=1 时才调用。
// 例：AGC_LIVE_MEMORY=1 AI_GROUP_CHAT_LIVE_PROVIDER_ID=deepseek \
//     AI_GROUP_CHAT_LIVE_BASE_URL=https://api.deepseek.com AI_GROUP_CHAT_LIVE_MODEL=deepseek-flash \
//     go test ./internal/memory -run '^TestLiveSummarize$' -v -count=1
func TestLiveSummarize(t *testing.T) {
	if os.Getenv("AGC_LIVE_MEMORY") != "1" {
		t.Skip("未配置真实模型整理验收")
	}
	id := envOr("AI_GROUP_CHAT_LIVE_PROVIDER_ID", "deepseek")
	base := envOr("AI_GROUP_CHAT_LIVE_BASE_URL", "https://api.deepseek.com")
	model := envOr("AI_GROUP_CHAT_LIVE_MODEL", "deepseek-flash")

	convo := reviewConversation()
	if n := os.Getenv("AGC_LIVE_MEMORY_N"); n != "" && atoi(n) < len(convo) {
		convo = convo[:atoi(n)]
	}
	st := newStore(convo)
	st.provider = domain.Provider{ID: id, Name: "DeepSeek", Kind: "openai", BaseURL: base, KeyRef: secret.Entry(id)}
	for _, m := range st.members {
		m.ProviderID = id
		m.Model = model
		st.members[m.ID] = m
	}

	var events []Event
	var mu sync.Mutex
	n := 0
	r := &Runner{
		Store:     st,
		Providers: Providers(providers.New(nil)),
		NewID:     func() string { n++; return "k" + string(rune('0'+n)) },
		Now:       time.Now,
		Emit: func(e Event) {
			mu.Lock()
			events = append(events, e)
			mu.Unlock()
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	if err := r.Summarize(ctx, "g"); err != nil {
		t.Fatal(err)
	}
	if !waitSummaryDoneFor(t, &events, &mu, 120*time.Second) {
		t.Fatal("整理没有完成（超时）")
	}
	g, items := st.snapshot()
	t.Logf("整理游标推进到 #%d，共 %d 条记忆：", g.MemoryCursor, len(items))
	for _, it := range items {
		src := ""
		for _, s := range it.Sources {
			src += "#" + itoa(s.Seq) + " "
		}
		t.Logf("  M%d [%s/%s/%s] %s（来源 %s）", it.Ref, it.Kind, it.Status, it.Origin, it.Content, src)
	}
	for _, it := range items {
		if it.Status == domain.MemoryConfirmed {
			t.Fatal("AI 产生了 confirmed 条目")
		}
	}
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// reviewConversation 是一段约 15 条的「首页改版评审」讨论，含决定、待办与背景。
func reviewConversation() []domain.Message {
	done := domain.StatusDone
	line := func(seq int64, kind domain.AuthorKind, id, content string) domain.Message {
		return domain.Message{ID: "m" + itoa(seq), Seq: seq, AuthorKind: kind, AuthorID: id, Content: content, Status: done}
	}
	return []domain.Message{
		line(1, domain.AuthorUser, domain.UserID, "官网首页现在是三栏，信息太散，我想改成单列，你们先看看可行性。"),
		line(2, domain.AuthorMember, "mo", "单列可行，而且更适合以移动端为主的访问结构。建议首屏放一句话价值主张加搜索框，去掉轮播。"),
		line(3, domain.AuthorMember, "qy", "同意。实现上三张卡片依赖接口数据，首屏会有空白闪烁，需要骨架屏。轮播组件被其他三个页面复用，先别动组件本身。"),
		line(4, domain.AuthorUser, domain.UserID, "那就先按单列做。首屏保留搜索框，轮播首页的引用删掉。"),
		line(5, domain.AuthorMember, "mo", "正文行宽建议控制在 720px 左右，中文读起来最舒服。卡片区可以放宽到 1080px。"),
		line(6, domain.AuthorUser, domain.UserID, "低保真稿我来画，这周五之前给。"),
		line(7, domain.AuthorMember, "sy", "从需求角度追问一下：老用户习惯从右侧进文档，改版后入口放哪？建议首屏导航里保留一个入口。"),
		line(8, domain.AuthorUser, domain.UserID, "文档入口保留在首屏导航。"),
		line(9, domain.AuthorMember, "gl", "建议先定一个衡量指标，比如首屏到注册页的转化率。改版前后各拉一次数据对比。"),
		line(10, domain.AuthorUser, domain.UserID, "指标就用首屏到注册页的转化率。"),
		line(11, domain.AuthorMember, "qy", "另外注意，列表超过 200 项要虚拟化，接口失败要有降级，不能整页白屏。"),
		line(12, domain.AuthorUser, domain.UserID, "好，这些记一下，实现的时候注意。"),
		line(13, domain.AuthorMember, "mo", "桌面端最大宽度建议 1080px 封顶，大屏上两侧留白用浅色底区分。"),
		line(14, domain.AuthorUser, domain.UserID, "就这么定，我下周开始画稿。"),
	}
}
