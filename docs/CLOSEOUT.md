# 项目收尾状态

更新：2026-10-17，AidoChat 0.1.1。源码仓库：[rickepicepic/AidoChat](https://github.com/rickepicepic/AidoChat)。

## 当前交付

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
