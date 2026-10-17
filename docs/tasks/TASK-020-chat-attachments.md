# TASK-020 聊天附件
- 认领：Codex · 2026-10-17
- 依赖：TASK-018、019 已交付
- 设计：docs/plans/2026-10-17-attachments-implementation.md
- 所有者批准：2026-10-17，图片/TXT/Markdown/PDF、契约扩展、PDF.js固定依赖、builder.go唯一受保护例外；仅主执行者更新其保护指纹。

## 验收
- [x] 本地导入、预览、草稿取消与清理，服务再次校验真实格式和限制
- [x] SQLite迁移、事务绑定与重启回读；跨群和重复发送拒绝
- [x] 文档真实来源上下文、图片结构化请求、视觉预检与预算裁剪
- [x] 图片/TXT/MD/PDF前端输入、粘贴、拖入与失败保留
- [x] Go vet/race、前端测试构建和规格质量复核
- [x] 原生QA及宣纸/夜读截图（主执行者）

## 交付记录 2026-10-17 · Claude Code
- 做了什么：
  - 完成附件前端与后端链路：PNG/JPEG/WebP、TXT/Markdown、文本型 PDF 的导入、预览、草稿绑定、资源读取与清理；成员「图片输入」开关与结构化图片请求。
  - 修复规格复核的 P2：`Store.InsertMessages` 把用户消息、附件绑定和全部回复占位放进同一事务，事务失败时调用方消息保持原样，附件草稿可原样重试。
  - 视觉/预算预检错误通过 `turn.UserError` 保留给用户的处理建议，不再被通用失败文案覆盖。
  - 修复原生 WKWebView 的 PDF.js 兼容问题：补齐 `Map#getOrInsertComputed` 与 `ReadableStream` 异步迭代，PDF worker 在真实桌面 WebView 内可离线解析。
  - 原生 QA 工具改为等待成员选中后再建群；截图回执按名称匹配，避免上一张的迟到回执；新增重启回读脚本。
- 怎么验证的：
  - `go vet ./...` 与 `go test -race ./...` 全通过：`/private/tmp/aidochat-020-go-vet-final.log`、`/private/tmp/aidochat-020-go-race-final.log`。
  - 前端 71 项测试与生产构建通过：`/private/tmp/aidochat-020-frontend-tests-final.log`、`/private/tmp/aidochat-020-frontend-build-final.log`。
  - `scripts/check-protected.sh` 通过；按所有者授权仅替换 `scripts/protected.sha256` 中 `internal/contextbuilder/builder.go` 的单行哈希，其余行未改。
  - 原生独立临时库 QA 两阶段 `ok=true`：`/private/tmp/aidochat-020-native/qa/result-first.json`（导入、视觉拒绝、PDF、并行请求、路径穿越）与 `result-restart.json`（重启回读 4 份附件、2 条回复、资源可读）。
  - 截图：`xuan-attachment-vision-error.png`、`xuan-pdf-preview.png`、`xuan-attachment-chat.png`、`ye-attachment-minimum.png`（960×640）、`xuan-attachment-restart.png`、`ye-attachment-restart.png`。
  - 请求证据 `requests.jsonl`：图片以 MIME/Base64/尺寸结构化发送；文档文字带 `[#1 …]` 消息来源；纪要整理请求不含图片；超过预算/缺视觉能力在落库前拒绝并保留草稿。
- 未验证 / 遗留：
  - Windows/Linux 真机安装与交互、真实中文输入法、真实付费模型的视觉请求未复验；原生 QA 使用确定性的本地测试模型。
  - 粘贴/拖入与文件选择共用同一条校验与导入链，原生自动化只直接覆盖文件选择；未单独模拟原生粘贴板与拖放。
  - 扫描版 PDF OCR、Word/Excel、视频附件不在本期范围。
