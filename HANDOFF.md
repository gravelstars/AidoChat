# HANDOFF —— 当前交接

更新：2026-10-17。正式产品名 AidoChat，当前版本 0.1.2。

## 当前状态

TASK-001–013 的功能已交付，TASK-014 完成全项目审查与修复，TASK-015/016 完成收尾和首次原生 CI 修复；TASK-017 完成官方品牌与图标、首次配置入口、表单对齐和连接测试修复。桌面端走真实 Go 服务、SQLite 和模型适配器；浏览器预览走 mock。功能包括服务与成员管理、群管理、@ 串行/并行回复、停止与原地重试、带来源的群记忆、待办、代码块和头像。

已验证的内容与未完成验收分别记录在 [CLOSEOUT.md](docs/CLOSEOUT.md)。不要把功能交付理解为三平台真机验收全部完成。

TASK-020 聊天附件已交付：图片与 TXT/Markdown/PDF 的本地导入、草稿事务绑定、重启回读、视觉能力预检、结构化图片请求和预算裁剪均已实现并完成原生 QA；证据与遗留见 `docs/tasks/TASK-020-chat-attachments.md`。PDF 在 WKWebView 下需要项目内的兼容补丁（`Map#getOrInsertComputed`、`ReadableStream` 异步迭代），升级 pdf.js 时要在原生窗口复验。

TASK-021 分享图片已交付：按起止消息冻结快照、真实 DOM 分页、逐页 PNG、原生目录选择和暂存提交均已实现；长文/代码/表格（含跨页单元格）在 6 页原生 QA 中通过。证据与未真机部分见 `docs/tasks/TASK-021-share-images.md`。分享图升级时要重点复验 html-to-image 在目标 WebView 的字体与 SVG 外框渲染。

## 接手阅读顺序

1. AGENTS.md
2. docs/PRODUCT.md
3. docs/ARCHITECTURE.md
4. docs/DESIGN.md（动界面必须完整阅读）
5. 当前任务单；历史任务已归档，见 docs/ARCHIVE.md

使用与开发构建分别见 docs/USER_GUIDE.md 和 build/README.md。

## 必须保留的约束

- 受保护文件不改，不刷新保护指纹。
- 前后端契约不随意修改。
- 只有用户触发 AI 回复；AI 之间不级联 @。
- 每群同时只运行一个轮次；重试保留消息身份。
- AI 不能确认记忆或修改已确认条目，每条记忆有真实来源。
- 视觉沿用现有组件和 token，朱色属于用户。

## 最近整体审查

修复服务地址与凭证的并发错配、无 Key 本地服务、凭证失败补偿、设置原子更新、重试上下文、记忆积压处理与事件顺序、权威终态、头像并发保存、代码块和平台打包配方。详见历史归档中的 docs/qa/task-014/review.md。

macOS 本次原生桥接 QA 返回 ok=true，包含真实 Go 服务/SQLite/轮次、界面操作以及宣纸/夜读截图。上轮绘制帧超时未复现；本轮使用确定性的本地测试模型，不构成付费云端复验。最终 CI 38920611754 的 Windows/macOS/Ubuntu 自检和安装包构建全部通过（源码 a7c085d）。Windows URI/检出换行/NSIS 路径编码与 macOS DMG 忙碌问题已修复。Windows/Linux 安装交互、真实中文输入法和正式分发仍需补验；不能用交叉编译替代真机安装测试。

## 工作区整理

任务单、过程计划、截图和旧包已经校验归档。源码、测试、可复用 QA 工具、产品/架构/设计和 ADR 保留。用户数据库和系统凭证不属于仓库，不清理。未来任务继续在 docs/tasks 下认领并记录交付。

## AidoChat 0.1.2

在 0.1.1 基础上完成 TASK-018–021：服务下线修复、完整显示名与独立短印文、聊天附件（图片/TXT/Markdown/PDF）、分享图片（起止消息、真实 DOM 分页、原生目录保存）。附件与分享图的原生 QA、重启回读和证据见 `docs/tasks/TASK-020-chat-attachments.md`、`docs/tasks/TASK-021-share-images.md`。

本轮 Go vet/race 与 80 项前端测试通过，macOS 0.1.2 通用包已生成至 `/Users/zoupengcheng/Desktop/AidoChat-release/0.1.2/`，codesign 与 dmg 校验通过。三平台 CI 本次未运行，Windows/Linux 包与真机验收仍待补做；是否替换 `/Applications/AidoChat.app` 由所有者决定。

## AidoChat 0.1.1

远程仓库 https://github.com/rickepicepic/AidoChat。品牌已更新，Go 模块、绑定、数据目录、钥匙串服务与 bundle ID 保留兼容值。成员表单内可新建/编辑服务，空成员建群可继续创建成员，均保留草稿。连接测试必须提供实际模型名，凭证读取失败直接反馈；免 Key 本地服务不读取系统凭证。参数变更清除测试结果，关闭对话框后忽略过期异步结果。

本轮 Go vet/race 与 56 个前端测试通过，空库原生 Wails 配置链路和宣纸/夜读及最小窗口布局已验证。最终安装、CI 与归档证据见 CLOSEOUT.md / ARCHIVE.md。

AidoChat 0.1.1 最终源码22aa9ca，CI38945065573三平台全部成功。本机已安装至 /Applications/AidoChat.app，数据完整性和记录数量核对通过；旧安装包已按所有者要求删除。后续任务编号 TASK-018。

## TASK-023 仓库展示与演示

当前仓库为 https://github.com/gravelstars/AidoChat；主体仍为本地稳定 0.1.2。中英 README、一键展示素材、浏览器演示构建与 Pages 工作流已准备，使用 `npm run build:demo`，入口和所有者手动配置见 docs/DEMO.md。实际功能与文档差异见 docs/qa/task-023/features.md，交付证据见 TASK-023。

演示仅用虚构数据和预设回复，有独立浏览器持久化与重置；不连接真实模型、不接收 Key，分享仅预览。宽度小于900px显示电脑访问说明。生产桌面不会进入演示模式。

Apache 官方原文、NOTICE（版权署名为 `gravelstars`）和机器导出的第三方原文已保留。所有者已审阅并接受当前源码+演示分发范围；GPL 字体例外、LGPL/APSL 等发现仍保留，不能当作对全部依赖或未来二进制分发的法律结论；见 THIRD_PARTY_NOTICES.md。仓库已 public，Pages 已启用并部署成功：https://gravelstars.github.io/AidoChat/ ，线上 Playwright 验收 `ok=true`。决定只公开源码与演示，不发布二进制安装包或 Release。About 与 Topics 已按所有者文本通过 GitHub API 设置；社交预览图与个人提交邮箱仍待所有者处理。
