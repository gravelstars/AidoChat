# 0.1.2 实际功能与文档差异

核对日期：2026-10-17。基线为本地 AidoChat 0.1.2，TASK-018–022 交付代码。浏览器实际运行现有 App + mock，逐页检查聊天、纪要、成员、设置、新建群/群管理、分享对话框；本轮演示 UI 自动验收命令为 `node scripts/verify-demo.mjs`。原生数据库/模型协议/导出保存能力以仓库中的 Go 实现与此前 TASK-020/021 原生验收为证，不将 mock 操作当作真实模型验收。

## README 可引用的功能清单

| 功能 | 实际入口与边界 | 证据 |
| --- | --- | --- |
| 多成员群聊 | 左侧新建群、成员邀请/移出/排序、群名/主题、归档与删除；本地单用户 | Rail、CreateGroupDialog、GroupSettingsDialog |
| 角色和服务 | 成员名字/简介/角色提示词、服务与自由填写模型名；表单内创建/编辑服务 | MembersView、MemberEditor、ProviderDialog |
| 两类模型协议 | OpenAI 兼容与 Anthropic；可配置 Ollama，云端需要对应凭证和实际模型 | app/providers、internal/llm；演示不连接 |
| 点名与轮次 | @单人/@多人/@所有人，依次/同时、停止、原地重新生成 | Composer、MessageList、turn 编排测试 |
| 群纪要 | 决定/待办/方案/背景，AI 建议/用户提出/用户确认三种笔迹，真实来源回跳、盖章/撤销/否决/改写、待办完成 | MemoryPanel、memory 测试；实际盖章动画采样 |
| 附件 | PNG/JPEG/WebP、TXT/Markdown、文本 PDF，本地预览/移除；视觉模型须显式开启图片输入 | Composer、AttachmentList；TASK-020 原生两阶段 QA |
| 分享图片 | 选择起止消息、纸张与群名/时间/署名开关、分页 PNG；桌面原生目录保存 | ShareExportDialog；TASK-021 原生六页 QA |
| 个人资料 | 完整显示名与独立 1–4 字短印文，印文建议/预览，朱文/白文 | SettingsView、TASK-019 |
| 外观 | 六纸、昼夜/跟随系统、阅读字号/密度、默认与群内成员头像；代码块/Markdown | SettingsView、AvatarEditor、CodeBlock |
| 本地持久化与凭证 | 桌面 SQLite/附件文件、系统凭证存储；云端调用会发出必要上下文，不承诺“永不出网” | app/internal/store 与产品隐私说明 |

## 演示特有边界

- 所有成员回复为预设文案，整理纪要为预设提取；不调用模型、不接收 Key、不测试真实服务，不读取桌面数据目录。
- 浏览器独立命名空间持久化并可重置；配额有限，附件每份最多 512 KiB，不能代替桌面工作数据。分享可预览，保存需要桌面版。
- 初始虚构示例群同时有已确认、AI 建议和用户提出条目；小提示可关闭。宽度小于 900px 显示电脑访问说明和截图。

## 不写进 README 的能力

没有 AI 主动对话或跨群个人记忆，没有工具调用/联网搜索/执行代码，没有账号与云同步，没有手机端，没有扫描 PDF OCR/Word/Excel/视频。真实付费视觉模型、Windows/Linux 安装交互未因本轮浏览器验证而变成“已真机通过”。

## 与现有文档的差异（保留原文，不静默覆盖）

1. `docs/PRODUCT.md` 的“第一版不做”仍列文件/图片上传；本地 0.1.2 已实现四类附件，属于后续版本扩展。
2. 同文件仍把外观概括为日间/夜读两套；实际设置有六纸和昼夜偏好。
3. `docs/ARCHITECTURE.md` 的发送流程示意仍分开写用户消息与 pending 消息；当前 `Store.InsertMessages` 为用户消息、附件绑定和全部占位的原子事务。
4. HANDOFF 保留 0.1.1 历史旧 GitHub 所有者链接与“后续从 TASK-018 开始”的历史文字；当前仓库为 `gravelstars/AidoChat`，本任务为 TASK-023。
5. 文档曾记录 mock 改动不保证持久化；演示构建现有独立浏览器存储，普通开发预览与桌面路径不受影响。
6. 展示采样发现盖章 CSS Modules 引用了被改名的全局动画名，实际没有 CSSAnimation；只在非保护 `MemoryPanel.tsx` 显式引用已有 `stamp-in` / `ink-bleed`，保护样式与关键帧原字节不变。

以上是本轮观察与范围说明，不扩大正式产品承诺。最新发布与许可待办见 TASK-023 交付记录。
