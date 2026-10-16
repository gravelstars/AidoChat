# 项目收尾状态

日期：2026-10-16。功能代码基线：158b4e1；后续收尾仅整理文档、过程文件和发布验证。

## 结论

功能开发及整体审查修复已完成，当前 macOS 桌面源码可构建并通过原生桥接回归。项目具备本地使用条件；跨平台安装和正式分发验收尚未全部完成。

## 本轮验证

- `go vet ./...` 通过。
- `go test -race ./... -count=1` 全部通过。
- 前端 `npm test`：9 文件、52 测试通过。
- 前端生产构建通过；保留既有的部分 JS chunk 超过 500 kB 提示。
- `wails3 task package` 通过，生成 macOS Intel/Apple Silicon 通用 .app、zip 与 dmg。
- `codesign --verify --deep --strict` 通过；`file` 确认双架构；`hdiutil verify` 通过。
- 独立临时库中的 macOS 原生桥接 QA：`ok=true`、`errors=[]`。覆盖 UI 建群、串行上下文、并行上下文、流式输入、停止、原地重试、成员编辑、设置入口、群管理、头像服务与路径穿越拒绝。宣纸、夜读及其他纸张截图已归档。
- 流式期间采样 25 帧，平均 16.4 ms，最大 19 ms；此数据仅反映本机本轮样本。
- 受保护文件校验和 Git 空白差异检查通过。

原生报告使用 deterministic local test provider，真实 Wails + SQLite + turn.Orchestrator；不调用云端、不读取用户 Key。历史 DeepSeek 真实服务验收保存在过程归档中，本轮没有重复付费调用。前一轮未产生绘制帧的报告仍保留，不能倒改为通过。

## 尚需验收

| 项目 | 当前边界 |
| --- | --- |
| Windows | 交叉编译及资源/引导安装器检查已做，原生 CI 和安装、WebView2、凭证、对话验收待补 |
| Linux | GTK4/WebKitGTK 6.0 的 tar/deb/AppImage 配方就绪，原生 CI 和安装/启动待补；AppImage 不捆绑全部系统库 |
| 图标 | 已有 SVG 母版，尚待所有者确认；不自动生成正式图标。CI 用 APP_ICON_APPROVED=true 显式启用，未启用时跳过 AppImage |
| 中文输入法与窗口 | macOS 真正输入法候选确认、Windows/Linux 拖拽缩放/重启恢复等仍需人工验收 |
| 正式分发 | macOS 尚无 Developer ID/公证，Windows 尚无发布签名；当前 macOS 包使用 ad-hoc 签名 |
| 系统版本 | macOS 12 为构建目标，旧版本尚未真机验证；Linux 优先 Ubuntu 24.04 |

关闭应用时仍需等待外部模型服务完成取消处理；流式期间崩溃可能丢失尚未落盘的增量。Token 估计为粗估。以上属于已知使用边界，不应对外宣称“所有平台全部验收”。

## 清理与交付

历史任务、计划、截图和旧包迁入项目外部归档，逐文件校验；用户数据和凭证不动。本次报告与截图也在外部归档。当前目录保留源码、测试、构建配方、可复用 QA 工具、产品/架构/设计/ADR、当前任务与使用说明。依赖、dist 和构建缓存可按构建说明再生成。

归档位置见 [ARCHIVE.md](ARCHIVE.md)，使用方法见 [USER_GUIDE.md](USER_GUIDE.md)。GitHub 首次上传使用干净源码快照，保留本机原历史分支；不上传过程归档、安装包、依赖、数据库或凭证。
