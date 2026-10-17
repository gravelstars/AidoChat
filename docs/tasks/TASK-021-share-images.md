# TASK-021 分享图片
- 认领：Claude Code · 2026-10-17
- 依赖：TASK-019、020 已交付
- 设计：docs/plans/2026-10-17-share-images-implementation.md
- 所有者批准：2026-10-17，起止消息、自动分页、html-to-image 固定依赖、新业务组件（ShareExportDialog / SharePage）及契约扩展。

## 验收
- [x] 起止消息闭区间、逆序/不存在/pending/streaming 拒绝；快照只含可公开字段
- [x] 真实 DOM 分页：长段落、字素边界、代码长行、表格续页、20 页上限与放不下错误
- [x] 离屏渲染 1080 宽，PNG 实际尺寸 1–10000，字体/头像/正文真实内容，不泄露 model/provider/path
- [x] 原生目录选择、暂存/逐页写入/提交/取消、不覆盖旧文件、失败回收
- [x] 前端预览、开关群名/时间/署名、宣纸/夜读、960×640、Windows 布局
- [x] Go vet/race、前端测试构建、protected、规格与质量复核
- [x] 原生 QA 生成 ≥2 页并留存宣纸/夜读截图与文件证据

## 交付记录 2026-10-17 · Claude Code
- 做了什么：
  - 新增起止消息分享：冻结快照只保留姓名、印章/头像、时间、正文、附件名称/图片和页码；拒绝逆序、缺失、pending/streaming。
  - 真实 DOM 分页：长段落按字素边界切分、代码按行/字素续页、列表与引用保留包装、表格按行续页并重复表头；单行超过一页时按单元格字素预算拆成续行，耗尽格为空。
  - 每页固定 1080 宽，离屏渲染后用 html-to-image 逐页生成 PNG；只内联本次实际使用字符对应的本地 woff2 分片。
  - 原生目录选择由桌面层注入；Go 侧使用隐藏暂存目录逐页写入、提交时整体 rename，不覆盖旧目录，取消/关闭/失败均回收。
  - 群聊头部新增「分享图片」入口；对话框支持范围、当前纸/宣纸、群名/时间/署名开关、逐页预览和保存进度。
- 怎么验证的：
  - `go vet ./...`、`go test -race ./...` 通过：`/private/tmp/aidochat-021-go-vet-final.log`、`/private/tmp/aidochat-021-go-race-final.log`；新增分享导出的成功、取消、重复页、缺页、过期、关闭清理与不覆盖测试。
  - 前端 80 项测试、类型检查、生产构建通过：`/private/tmp/aidochat-021-frontend-tests-final.log`、`/private/tmp/aidochat-021-typecheck-final.log`、`/private/tmp/aidochat-021-frontend-build-final.log`。
  - `scripts/check-protected.sh` 通过，本任务未新增保护例外。
  - 原生 QA `ok=true`：`/private/tmp/aidochat-021-native/qa/result-share.json`；长中英文、代码长行、61 行表格（含跨页单元格续写）和附件共生成 6 张 1080 宽 PNG，最高 3199px，保存在 `out/分享验收-2026-10-17-MEJ0J8/`，文件名连续且无覆盖。
  - 截图：`xuan-share-preview.png`、`xuan-share-saved.png`、`ye-share-preview.png`、`ye-share-minimum.png`（960×640）；Windows 布局预览：`/private/tmp/aidochat-021-windows-layout.png`。
  - 快照单元测试确认导出数据不含 model/provider/附件全文/本机路径；续页中的超长表格单元格首两格为空、第三格继续，表头在每页重复。
- 未验证 / 遗留：
  - macOS 原生验收使用 QA 注入的临时保存目录，未自动点击系统目录选择器本身；Windows/Linux 的真实系统目录选择器和 WebView2/WebKitGTK 未真机复验。
  - Windows 布局用浏览器 mock 截图，未在 Windows 真机桌面窗口复验。
  - 未覆盖麻纸/乌金、大字 + 紧凑密度的分享图组合；中文输入法、真实付费模型与本任务无关，未重复验收。
