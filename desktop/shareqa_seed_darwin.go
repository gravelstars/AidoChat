//go:build darwin && desktopqa

package desktop

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/store"
)

// seedShareQA 构造足量的真实内容（长文、代码、表格、附件、已退群成员），供原生分享图验收。
func seedShareQA(db *store.Store) error {
	ctx := context.Background()
	provider := domain.Provider{ID: "share-qa", Name: "分享验收本地服务", Kind: "openai"}
	if err := db.SaveProvider(ctx, &provider); err != nil {
		return err
	}
	for _, m := range []domain.Member{
		{ID: "share-a", Name: "青砚", ProviderID: provider.ID, Model: "share-qa-local", ContextTokens: 16000, Avatar: domain.Avatar{Glyph: "青", Color: "shiqing"}},
		{ID: "share-b", Name: "墨白", ProviderID: provider.ID, Model: "share-qa-local", ContextTokens: 16000, Avatar: domain.Avatar{Glyph: "墨", Color: "dai"}},
	} {
		if err := db.SaveMember(ctx, &m); err != nil {
			return err
		}
	}
	if err := db.SetSettings(ctx, map[string]string{
		"ui.user_display_name": `"子鹏 · Sam Altman"`,
		"ui.user_seal":         `{"text":"子鹏之印","style":"zhuwen"}`,
	}); err != nil {
		return err
	}
	g := domain.Group{Title: "分享验收", Topic: "分享图片原生验收：长文、代码、表格、附件", DefaultMode: domain.ModeSerial, MemberIDs: []string{"share-a", "share-b"}}
	if err := db.CreateGroup(ctx, &g); err != nil {
		return err
	}

	now := time.Now().Add(-time.Hour)
	writeMsg := func(m *domain.Message) error {
		m.CreatedAt = now
		m.FinishedAt = &now
		now = now.Add(time.Minute)
		return db.InsertMessage(ctx, m)
	}

	user := domain.Message{
		ID: store.NewID(), GroupID: g.ID, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID,
		Content: "@所有人 请把这次讨论完整保存成分享图片。\n\n" +
			strings.Repeat("分享图应当完整保留群聊的上下文、发言者身份和真实顺序，不能截断正文。", 42),
		Mentions: []string{"share-a", "share-b"}, MentionAll: true, ReplyMode: domain.ModeSerial,
		TurnID: store.NewID(), Status: domain.StatusDone,
	}
	if err := writeMsg(&user); err != nil {
		return err
	}

	codeLine := strings.Repeat(`const value = "一段很长的英文与中文混合内容，用来验证代码换行不会丢字符"; `, 12)
	member := domain.Message{
		ID: store.NewID(), GroupID: g.ID, AuthorKind: domain.AuthorMember, AuthorID: "share-a",
		Content: "## 方案\n\n" + strings.Repeat("先冻结快照，再按真实版心分页，最后逐页生成 PNG。", 28) +
			"\n\n- 起止消息包含两端\n- 超长内容自动分页\n\n```ts\n" + codeLine + "\n```\n\n" +
			"English: " + strings.Repeat("A share image must preserve every visible character and inline formatting. ", 22),
		ReplyToID: user.ID, TurnID: user.TurnID, Provider: provider.ID, Model: "share-qa-local",
		Status: domain.StatusDone,
	}
	if err := writeMsg(&member); err != nil {
		return err
	}

	imgID, docID := store.NewID(), store.NewID()
	dir := filepath.Join(filepath.Dir(db.Path()), "attachments")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 320, 180))); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, imgID), imageBytes.Bytes(), 0600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, docID), []byte("share qa document"), 0600); err != nil {
		return err
	}
	for _, a := range []domain.Attachment{
		{ID: imgID, Name: "分享配图.png", MIME: "image/png", Size: int64(imageBytes.Len()), Kind: "image", URL: "/attachments/" + imgID, Width: 320, Height: 180},
		{ID: docID, Name: "需求说明.pdf", MIME: "application/pdf", Size: 18, Kind: "document", URL: "/attachments/" + docID, PageCount: 12},
	} {
		if err := db.SaveDraftAttachment(ctx, g.ID, a); err != nil {
			return err
		}
	}
	withFiles := domain.Message{
		ID: store.NewID(), GroupID: g.ID, AuthorKind: domain.AuthorUser, AuthorID: domain.UserID,
		Content:  "这些附件也要出现在分享图里（只显示名称与图片，不包含本机路径或提取全文）。",
		Mentions: []string{"share-b"}, ReplyMode: domain.ModeSerial, TurnID: store.NewID(), Status: domain.StatusDone,
		Attachments: []domain.Attachment{{ID: imgID}, {ID: docID}},
	}
	if err := writeMsg(&withFiles); err != nil {
		return err
	}

	var table strings.Builder
	table.WriteString("| 维度 | 结论 | 备注 |\n|---|---|---|\n")
	for i := 0; i < 60; i++ {
		table.WriteString("| 检查项 " + strings.Repeat("长", 8) + " | 通过 | 第 ")
		table.WriteString(strings.Repeat("续", 30))
		table.WriteString(" 行 |\n")
	}
	table.WriteString("| 超长单元格 | 续写 | ")
	table.WriteString(strings.Repeat("单元格内容需要在多页之间无损续写，续行里的其他格应为空。", 150))
	table.WriteString(" |\n")
	tableMsg := domain.Message{
		ID: store.NewID(), GroupID: g.ID, AuthorKind: domain.AuthorMember, AuthorID: "share-b",
		Content:   "### 表格分页\n\n" + table.String() + "\n\n" + strings.Repeat("表格之后还有正文，不能丢失。", 30),
		ReplyToID: withFiles.ID, TurnID: withFiles.TurnID, Provider: provider.ID, Model: "share-qa-local",
		Status: domain.StatusDone,
	}
	if err := writeMsg(&tableMsg); err != nil {
		return err
	}

	gone := domain.Message{
		ID: store.NewID(), GroupID: g.ID, AuthorKind: domain.AuthorMember, AuthorID: "share-gone",
		Content: "这是一条已退群成员的历史发言，分享图中应显示「已退群成员」而不是空白。" +
			strings.Repeat("历史身份仍要保留。", 24),
		ReplyToID: withFiles.ID, TurnID: withFiles.TurnID, Provider: provider.ID, Model: "share-qa-local",
		Status: domain.StatusDone,
	}
	return writeMsg(&gone)
}
