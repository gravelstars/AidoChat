# TASK-023 GitHub 展示、浏览器演示与许可
- 认领：Codex · 2026-10-17
- 依赖：TASK-018–022 已交付，应用 0.1.2 可运行
- 所有者方案：本会话完整任务说明；新仓库 gravelstars/AidoChat。
- 授权：仅新增截图用 Playwright devDependency；许可证导出工具使用临时工具目录，不成为应用依赖。最初要求不推送；所有者随后明确授权本地 0.1.2 与本任务成果上传 gravelstars/AidoChat。仍不得发布 Release、开启 Pages 或修改仓库设置。

## 实施与验收
- [x] 实际运行并逐界面核对功能，记录文档差异
- [x] Apache 官方 LICENSE、占位 NOTICE、机器生成依赖清单和字体完整许可
- [x] 演示 mock 本地持久化、明确提示/重置、示例群与盖章、桌面功能反馈、窄屏说明
- [x] Pages 子路径构建、本地离线请求审计、仅 main push 的发布工作流
- [x] 一键素材脚本、日夜 SVG 轮廓字横幅、主图、特性图、GIF、社交图片
- [x] 中英 README、贡献指南、两个 Issue 模板、所有者手动配置说明
- [x] Go vet/race、前端测试/构建、保护检查、桌面与手机宽度本地预览

## 实施计划
1. 运行现有页面，建立 docs/qa/task-023/features.md，逐项区分桌面功能与 mock 能力；旧产品文档不静默修改。
2. frontend/src/demo：只在 VITE_DEMO=true 的演示构建包装现有 App；设置提示与窄屏页，mock 使用独立存储命名空间、重置仅清自己数据，屏蔽真实服务能力和 Key 输入。契约与保护文件不变。
3. scripts 生成许可证导出清单，保留原始版权与许可；遇到 GPL/AGPL 或无法分类立即记录，不自动判兼容。
4. scripts/capture-showcase.mjs 用批准的 Playwright，通过真实演示交互生成截图、盖章序列和验收证据；SVG 文字通过系统轮廓工具转换，不依赖 GitHub 字体。
5. 依据核对清单写双语 README 与配套文件，Pages 未开启/Release 未发布明示状态；在线地址采用 https://gravelstars.github.io/AidoChat/，下载链接仅使用实际存在的资源。
6. 本地 /AidoChat/ 预览验证所有资源同源、提示可关闭/重置/刷新持久化、盖章、900px 窄屏与只读路径隐私；执行完整检查后写交付记录。只交付文件，不执行发布操作。

## 交付记录 2026-10-17 · Codex
- 做了什么：以本地 0.1.2 为基线，新增独立演示构建、可关闭的预设回复说明/轻提示、独立持久化/重置与 900px 窄屏说明；隐藏 Key/真实连接/系统目录，分享预览与桌面保存明确分开。中英 README、贡献指南、Issue 模板、Apache 官方原文与 NOTICE 占位、机器生成第三方声明、Pages workflow 和全部脚本素材齐全。
- 真实功能与文档差异：见 [features.md](../qa/task-023/features.md)，明确旧 PRODUCT 仍列附件不做/两种纸、ARCHITECTURE 旧发送步骤、历史仓库地址等；不静默改受保护设计或旧产品范围。
- 额外必要修复：非保护 MemoryPanel.tsx 显式引用已有全局关键帧，真实落印/墨晕得以播放；修复演示存储配额失败回滚、流式中盖章失败、旧轮次/重试隔离，以及 899px 下下载链接无法滚动到达。独立审查复现并确认上述四项已关闭，无剩余 P1/P2。
- 怎么验证的：Go vet 与全量 race 通过；前端 17 文件 92 项测试、生产与 demo 构建通过；保护检查、git diff --check、所有 README 本地资源链接检查通过。证据日志 `/private/tmp/aidochat-023-{vet,race,tests-final,build-final,demo-build-final,browser-final}.log`。
- 浏览器：脚本 [verify-demo.mjs](../../scripts/verify-demo.mjs) 真实点击群/成员/设置/分享/盖章，验证刷新、重置、TXT 文件输入、@ 点名/停止及 899×640、390×640 窄屏；结果 [demo-verification.json](../qa/task-023/demo-verification.json) 为 ok=true，外部请求与资源错误均为空。日夜与窄屏验收截图留在 `/tmp/aidochat-023-demo-qa/`。
- 素材：一键脚本完整成功，日夜主图 2880×1800（1440×900、2 倍像素），所有 PNG 小于 500KiB，所有 SVG 字形为路径；GIF 3 秒、13 个不同帧、低于 3MB。完整尺寸见 [manifest.json](../assets/manifest.json)，动画名与外部请求审计见 [request-audit.json](../assets/request-audit.json)。宣纸/夜读截图仅来自虚构演示数据。
- 许可：官方 Apache 文件原字节核对通过，三个实际 Noto/JetBrains 字体完整 OFL 保留；224 个 npm 包与 172 个 Go 模块机器导出、2060 条原文来源 hash 验证通过。许可导出器误收集 .go 原文容器的问题已修为 .go.txt，原字节保留，Go ./... 检查通过。
- **所有者复核结论：接受当前源码+浏览器演示分发范围。** 已报告实际打包 Liberation GPLv2+字体例外、原生生成源的 LGPL/APSL/BSD 四条款等，见 [许可记录](../qa/task-023/licenses.md)；所有者已审阅并接受当前范围，但这不是法律意见，也不能判定全部依赖兼容或覆盖未来二进制分发。NOTICE 已填 `gravelstars`，LICENSE 官方附录占位不改。
- 未验证：真实 Windows/Linux 系统、真实系统目录选择器、真实云模型不属于本轮浏览器验收；GitHub Pages 未开启、未发布 Release，没有把本地包写成公开下载。README 首个试玩入口暂指说明页，待所有者开通后换为直达地址。
- 所有者手动操作文本：About 中英简介、7 个 Topics、Pages 开启步骤/最终地址、社交图上传位置、版权所有者和个人邮箱说明全部见 [DEMO.md](../DEMO.md)。没有设置个人邮箱，没有修改这些仓库设置。

## 上传与最终复核
- 所有者最新明确授权上传；已正常快进推送到 `gravelstars/AidoChat` 的 main，没有强推。主体代码与展示初版提交 `f7a4384`（隐私重写后哈希），此前本地 0.1.2 任务提交一并保留。为隐匿旧提交邮箱，main 已重写身份并使用带租约强推；旧 SHA 可能仍能被直接访问一段时间。使用已登录 GitHub 账号的公开 noreply 身份作本任务提交，没有设置或猜测个人邮箱。
- 三平台 CI [39029099506](https://github.com/gravelstars/AidoChat/actions/runs/39029099506) 的 macOS14、Windows2022、Ubuntu24.04 各任务均 success，包括自检与安装包构建。未发布 Release，Artifacts 不是公开下载文件，README 仍诚实写安装包即将发布。
- 仓库 API 确认为 private；未登录 GitHub 浏览器返回 404，不能声称已在实际已登录 GitHub 页面完成所有主题测试。已用 GitHub 官方 Markdown API 渲染中英原文，并在本地布局近似预览中测试 1440/390px、日间/夜间共8种组合：全部图片正常、主题源切换正确、无溢出、三个入口在首屏；桌面内容高中文2448px/英文2469px（1000px视口约2.5屏）。证据 [readme-preview.json](../qa/task-023/readme-preview.json)，截图 `/private/tmp/aidochat-023-readme-preview-*.png`。
- Pages 工作流 [39029099516](https://github.com/gravelstars/AidoChat/actions/runs/39029099516) 在 `configure-pages` 失败，明确 `Get Pages site failed / Not Found`，与未开启 Pages 一致。没有启用参数或修改设置绕过，尚未得到线上演示地址可用的证据。
- Git 原文保全：`.gitattributes` 对 LICENSE 与许可证原文禁用换行转换；原始工具输出/许可原文的空白不修剪。已逐条验证 Git index 的 2060条来源/851文件与原字节 SHA256/SHA1一致，代码仍受正常空白检查。

### 所有者待办 / 未完成的外部验收
- [x] 版权署名确定为 `gravelstars`，NOTICE 已填写；所有者已审阅并接受当前源码+演示分发范围，但没有自行判定全依赖 Apache 兼容，未来二进制发布仍需复核。
- [x] 发布范围确定为只公开源码与浏览器演示，不发布二进制安装包；本地 0.1.2 包保留但不作为公开下载。
- [x] 所有者已将仓库改为 public，并开启 Pages（`Source: GitHub Actions`）。
- [x] 执行者触发 **Browser demo Pages** [39034066836](https://github.com/gravelstars/AidoChat/actions/runs/39034066836) 成功；线上 Playwright 验收 `ok=true`，外部请求与 4xx/5xx 为空，地址 [gravelstars.github.io/AidoChat](https://gravelstars.github.io/AidoChat/)。
- [x] 所有者已在登录的 GitHub 实际页面检查 README 日夜与手机宽度。
- [x] About 与 Topics 已由所有者授权、执行者通过 GitHub API 设置：描述为「一个有温度的有趣的多AI群聊本地应用，开源，免费。」，Topics 为 `ai-chat`、`desktop-app`、`local-first`、`react`、`golang`、`group-chat`。
- [ ] 社交预览图和个人提交邮箱仍由所有者手动设置；暂不发布 Release。

## 所有者决定 2026-10-17
- 仓库：公开，并启用 GitHub Pages 展示浏览器演示。
- 分发：只发布源码与浏览器演示；不发布 Windows/macOS/Linux 二进制安装包或 GitHub Release。
- 署名：公开版权署名为 `gravelstars`；`NOTICE` 已更新。
- 许可：保留待审阅声明；本次决定不等于判定全部第三方许可兼容。
- 仓库元数据：About、Topics、社交预览和个人提交邮箱由所有者手动设置。
- 执行者后续：在所有者开启 Pages 后推送文档变更并触发 **Browser demo Pages**，验证在线地址后把中英 README 的“待开启”入口换成实际地址。以上已于本日完成，线上验收结果取 `/private/tmp/aidochat-023-demo-live2/result.json`。
