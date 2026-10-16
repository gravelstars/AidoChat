# 项目收尾状态

更新：2026-10-17，AidoChat 0.1.1。功能代码基线：158b4e1；后续 TASK-016 修复首次原生 CI 发现的 Windows 文件 URI、检出换行、NSIS 路径/编码与 macOS 磁盘映像忙碌问题。

## 结论

功能开发及整体审查修复已完成，当前 macOS 桌面源码可构建并通过原生桥接回归；Windows、macOS、Ubuntu 原生 CI 的自检和安装包构建全部通过。项目具备本地使用条件；跨平台安装和正式分发验收尚未全部完成。

## 本轮验证

- `go vet ./...` 通过。
- `go test -race ./... -count=1` 全部通过。
- 前端 `npm test`：9 文件、56 测试通过。
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
| Windows | 原生 CI 全部自检、exe/zip、图标资源与 NSIS 安装器构建通过；安装后 WebView2、凭证、对话真机验收待补 |
| Linux | Ubuntu 24.04 原生 CI 全部自检和 tar/deb/AppImage 构建通过；安装/启动交互待补，AppImage 不捆绑全部系统库 |
| 图标 | 所有者已于 2026-10-16 批准现有 SVG 母版；仓库变量 APP_ICON_APPROVED=true 已启用，三平台生成及打包通过 |
| 中文输入法与窗口 | macOS 真正输入法候选确认、Windows/Linux 拖拽缩放/重启恢复等仍需人工验收 |
| 正式分发 | macOS 尚无 Developer ID/公证，Windows 尚无发布签名；当前 macOS 包使用 ad-hoc 签名 |
| 系统版本 | macOS 12 为构建目标，旧版本尚未真机验证；Linux 优先 Ubuntu 24.04 |

关闭应用时仍需等待外部模型服务完成取消处理；流式期间崩溃可能丢失尚未落盘的增量。Token 估计为粗估。以上属于已知使用边界，不应对外宣称“所有平台全部验收”。

## 清理与交付

历史任务、计划、截图和旧包迁入项目外部归档，逐文件校验；用户数据和凭证不动。本次报告与截图也在外部归档。当前目录保留源码、测试、构建配方、可复用 QA 工具、产品/架构/设计/ADR、当前任务与使用说明。依赖、dist 和构建缓存可按构建说明再生成。

归档位置见 [ARCHIVE.md](ARCHIVE.md)，使用方法见 [USER_GUIDE.md](USER_GUIDE.md)。GitHub 首次上传使用干净源码快照，保留本机原历史分支；不上传过程归档、安装包、依赖、数据库或凭证。

## GitHub 首次原生 CI

干净源码已上传到 https://github.com/rickepicepic/AidoChat 。首次运行 38913777806：Ubuntu 自检及 tar/deb 构建通过；Windows 测试发现盘符 URI 问题；macOS 编译、签名和 zip 成功，但创建 dmg 返回 Resource busy。已逐项修复，最终源码提交为 `7a6ff5dcdc44edbd45af3407ba9ab561179e3bc4`。最终 [CI 38920611754](https://github.com/rickepicepic/AidoChat/actions/runs/38920611754) 的 macos-14、windows-2022、ubuntu-24.04 三个 job 全部 success。该运行的 Artifacts 提供各平台包；不是已经完成真机安装验收的正式发行版。

本机最终 macOS 包已复制到外部归档 release/macos，含批准图标，双架构、签名完整性和 DMG 校验通过；前一版本单独留在 release/macos-before-platform-validation。本机 macOS 26 的 iconutil 拒绝该 iconset，采用同一已批准 SVG 的 PNG ICNS 块打包并经 sips 解码校验；macos-14 CI 使用原脚本生成成功。安装包下载网络较慢，Windows/Linux 包以成功 CI 的 Artifacts 为准，没有把不完整下载作为本地交付。

全部历史及本次任务过程记录已归档到源码目录之外，当前 docs/tasks 仅保留未来任务指引。源码目录已清理 node_modules、dist、build/bin、任务缓存与临时归档；再次开发需 npm ci。用户数据、凭证和本机旧源码分支均保留。

## AidoChat 0.1.1 验证

官方 SVG 已原样替换并生成三平台图标。修复横向 Field 间距导致的输入框错位，服务/模型与预算/温度使用等宽列；纪要服务/模型顶部对齐。空服务与空成员入口均可继续完成配置并保留草稿。模型测试不再猜测其他厂商模型，钥匙串错误不会被吞掉；异步测试、保存和删除结果按对话框会话隔离。默认纪要服务明确继承成员模型。

Go vet 与全量 race 测试、56 个前端测试和生产构建通过。独立空库原生 QA 的 result.json 为 ok=true、errors=[]，覆盖首次配置、自动选中、保留草稿、模型校验、服务编辑模型带入、宣纸/夜读、原生 960×640（WebView DOM 宽961）和纪要布局。Windows 参数布局预览也已目视检查。原生测试使用独立测试库与本地确定性模型，不访问用户聊天或真实云端 Key。

macOS iconutil 在本机拒绝合法 iconset，已将同一 SVG 的 PNG ICNS 块打包回退纳入脚本，并使用 sips 验证解码；不再需要手工制作。Windows/Linux 仍须以原生 CI 和目标机器验收区分。
