# 项目收尾状态

## TASK-023 上传与最新验证

2026-10-17 已将本地 0.1.2、双语仓库展示、演示构建与第三方声明上传至 [gravelstars/AidoChat](https://github.com/gravelstars/AidoChat)。源码 `b307939e8b90c9ba0dff8cf69b4560e40da38650` 的 [CI 39029099506](https://github.com/gravelstars/AidoChat/actions/runs/39029099506) 中 macOS、Windows、Ubuntu 三个任务均成功，包含自检和安装包构建；这不等于三平台安装交互已真机通过。

演示本地 `/AidoChat/` 子路径与线上地址均验证通过：92 个前端测试、Go vet/race、生产与 demo 构建及保护检查通过；线上 Playwright 验收 `ok=true`，外部请求和 4xx/5xx 均为空。仓库已改为 **public**，Pages 已启用，**Browser demo Pages** [39034066836](https://github.com/gravelstars/AidoChat/actions/runs/39034066836) 部署成功，地址为 [gravelstars.github.io/AidoChat](https://gravelstars.github.io/AidoChat/)。没有发布 Release。第三方许可兼容性仍有已报告的待确认项，不能把声明生成成功当成分发许可审查通过，见 THIRD_PARTY_NOTICES.md 与 TASK-023。

所有者已决定：只公开源码与浏览器演示，不发布二进制安装包或 Release；公开版权署名为 `gravelstars`，NOTICE 已更新；About、Topics、社交预览和提交邮箱由所有者手动设置。中英 README 的试玩入口已换成线上地址。GitHub API 仍显示仓库描述为 “AidoChat” 且 Topics 为空，需所有者在 About 设置中复核保存。

更新：2026-10-17，AidoChat 0.1.2。源码仓库：[gravelstars/AidoChat](https://github.com/gravelstars/AidoChat)。

## AidoChat 0.1.2

在 0.1.1 基础上交付 TASK-018–021：

- 个人资料：完整显示名与独立短印文分离，中英文姓名不再挤在同一方印里。
- 服务下线：只被已删除成员引用的服务可以下线，历史发言保留。
- 聊天附件：图片、TXT、Markdown、文本型 PDF 的本地导入、预览、事务绑定、重启回读和视觉能力预检；文档以带来源的文字进入上下文，记忆整理不发送原图。
- 分享图片：起止消息、真实 DOM 分页、1080 宽逐页 PNG、原生目录保存，支持当前纸/宣纸与群名/时间/署名开关。
- WKWebView 下补齐 PDF.js 所需的 `Map#getOrInsertComputed` 与 `ReadableStream` 异步迭代，PDF 可离线解析。
- 分享图群名在 WKWebView 中保持横向排版；成员编辑的模型服务操作与模型说明对齐，不再挤压图片输入。

本轮验证：`go vet ./...`、全量 `go test -race ./...` 通过；前端 80 项测试、类型检查和生产构建通过；保护文件检查通过。原生 QA 覆盖附件全链路、重启回读、分享图 6 页（长文、代码、表格跨页与单元格续写、附件、已退群成员），均 `ok=true`。分享图保存目录由 QA 注入，未自动点击系统目录选择器。

macOS 0.1.2 包已生成并在 `/Users/zoupengcheng/Desktop/AidoChat-release/0.1.2/`（已用 TASK-022 修复重新打包覆盖，源码提交 `128b599`）：`codesign --verify --deep --strict`、`hdiutil verify` 通过，二进制为 x86_64 + arm64。同目录另有 Windows amd64 `AidoChat.exe` 与 `AidoChat-windows.zip`（交叉编译，PE32+ x86-64，manifest 0.1.2.0）；未生成 NSIS 安装器，也未在 Windows 真机运行。是否替换 `/Applications/AidoChat.app` 由所有者决定；三平台 CI 本次未运行，Linux 包与 Windows/Linux 真机验收仍需补做。

## 0.1.1 历史交付

TASK-001–016 功能与整体审查已交付。TASK-017 完成正式命名、官方 SVG 与三平台图标、首次使用引导、表单对齐和模型连接测试修复。Go 模块、Wails 绑定、bundle ID、数据目录与钥匙串兼容标识保留，已有数据不迁移或重置。

成员表单可直接创建/编辑服务，空成员建群可继续创建成员，均保留草稿并自动选中。横向表单使用等宽列与顶部对齐。测试连接要求实际模型名称，不再将 gpt-4o-mini 发给其他服务；凭证读取失败直接反馈，免 Key 服务不读取系统凭证。测试参数修改会清除旧结果，关闭对话框后忽略过期异步结果。默认整理服务明确继承成员模型。

## 本轮验证

- `go vet ./...`、全量 `go test -race ./... -count=1` 通过。
- 前端9文件、56测试通过，生产构建通过；保留既有的部分 JS chunk 超过500 kB 提示。
- 连接测试新增本地 HTTP 回归，验证空模型、实际模型/已保存凭证、凭证读取失败和免 Key 服务。
- 独立空库原生 Wails QA：`ok=true`、`errors=[]`，覆盖首次配置、保留草稿、自动选中、模型校验和编辑模型带入；宣纸/夜读、960×640 原生窗口与纪要布局截图已归档。Windows 布局预览已目视检查。
- 完整原生 Wails + SQLite + turn.Orchestrator 回归：`ok=true`、`errors=[]`。覆盖串行/并行上下文、流式输入、停止、原地重试、成员/群管理、头像服务与路径穿越拒绝。流式采样25帧，平均16.16 ms、最大21 ms，仅代表本机样本。
- `wails3 task package` 成功；macOS .app 为 Intel/Apple Silicon 双架构，`codesign --verify --deep --strict` 和 `hdiutil verify` 通过。官方 SVG 字节核对一致，ICNS 解码通过。
- 保护指纹和 Git 空白检查通过，没有修改契约或放宽记忆规则。
- 新版安装于 `/Applications/AidoChat.app` 并启动；原数据库升级前后 `quick_check=ok`、各表记录数量一致。私密数据备份位置见归档索引。

本轮原生回归使用独立测试数据库与确定性本地模型，不读取用户 Key 或发送真实聊天。真实 DeepSeek 历史验收留在过程归档，本轮未重复付费云端调用。

三平台 [CI 38945065573](https://github.com/rickepicepic/AidoChat/actions/runs/38945065573) 全部成功，源码 `22aa9ca577cb2c3a09fbb69b87f4553486119423`。Windows NSIS、macOS dmg/zip、Ubuntu tar/deb/AppImage 和官方图标均构建成功，Artifacts 名称为 AidoChat-Windows、AidoChat-macOS、AidoChat-Linux。

## 平台与分发边界

| 项目 | 当前边界 |
| --- | --- |
| macOS | 本机安装/启动与原生回归通过；构建目标macOS12，旧系统未真机验证 |
| Windows | 以本轮原生 CI 自检与 NSIS 构建结果为准；目标机器 WebView2、凭证与安装交互仍待验收 |
| Linux | 以本轮 Ubuntu24.04 CI 自检与 tar/deb/AppImage 构建结果为准；安装/启动交互仍待验收，AppImage 未捆绑全部系统库 |
| 中文输入法与窗口 | Enter 组字保护已实现；真实输入法候选确认及 Windows/Linux 拖拽缩放/重启恢复仍待人工验收 |
| 正式分发 | macOS使用 ad-hoc 签名，尚无 Developer ID/公证；Windows尚无发布签名 |

应用关闭会等待取消收尾；流式期间崩溃可能丢失未落盘片段。Token预算为粗估。功能交付不能等同于所有系统真机验收完成。

## 清理与使用

源码目录保留代码、测试、构建配方、官方图标、可复用 QA 工具、产品/架构/设计/ADR 和使用说明。任务记录、测试截图和日志迁至外部归档；构建缓存和依赖可重建。旧安装包在新版启动和数据核对通过后删除，历史证据与用户数据保留。详见 [归档索引](ARCHIVE.md) 和 [使用说明书](USER_GUIDE.md)。
