# 架构

## 1. 总览

```
┌──────────────────────── Wails v3 应用（单进程）────────────────────────┐
│                                                                         │
│  frontend/ (React + TS, 系统 WebView 渲染)                              │
│    features/*  ──►  state/store.ts (zustand)  ──►  backend/contract.ts  │
│                                                   ├─ mock.ts              │
│                                                   └─ wails.ts             │
│                          ▲ 事件 (message / delta / turn / memory)        │
│ ─────────────────────────┼──────────────── Wails 绑定 + 事件 ──────────  │
│                          │                                              │
│  app/ (Go, Wails 服务层)  薄薄一层：参数转换 + 事件转发                 │
│    │                                                                    │
│    ├─ internal/turn          轮次编排：串行/并行/停止/失败继续          │
│    ├─ internal/contextbuilder 群聊 → 单次模型请求                       │
│    ├─ internal/memory        群记忆整理与校验                           │
│    ├─ internal/domain        实体、@ 解析、回复顺序                      │
│    ├─ internal/llm           模型调用契约 + 适配器                      │
│    └─ internal/store         SQLite 持久化                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
         │ HTTPS（只有调用模型时才出网，发送的是该成员的上下文）
         ▼
   各家模型服务（OpenAI 兼容 / Anthropic）
```

原则：
- **业务核心不依赖 Wails。** `internal/*` 里没有任何 Wails 引用，可以单独测试；以后要做 Web 版，只需换掉 `app/` 和 `wails.ts`。
- **前端只认 `Backend` 接口。** 组件不直接调 Wails 运行时。
- **数据全在本地。** SQLite 文件放在系统应用数据目录（`os.UserConfigDir()/ai-group-chat/`）；Key 放系统钥匙串。

## 2. 一次发送的完整流程

```
用户按 Enter
  → store.send(content, mode?)
  → Backend.send  ──►  Orchestrator.Send
                         1. 获取该群的"轮次锁"（同一群同时只有一个进行中的轮次，否则 ErrBusy）
                         2. ParseMentions → PlanTargets 决定回复者与顺序
                         3. 校验附件与视觉/预算预检；把用户消息、附件绑定和全部回复占位放入同一事务
                         4. 提交后推送用户名与全部 pending 占位（前端立刻看到"谁在排队"）
                         5. 没有 @ 任何人 → 结束（只记录，不回复，见 ADR-0001）
                         6. 后台 goroutine：
                              串行：逐个 reply()，每个都重新读取历史，所以能看到前一位的回复
                              并行：同时 reply()，contextbuilder 会屏蔽本轮其他人的回答
                         7. 全部结束 → turn.end 事件 → AfterTurn 钩子（触发记忆整理）
  reply(成员):
     读历史 + 群记忆 + 附件来源文字 → contextbuilder.Build（只加载窗口内选中的图片）
     → provider.Stream → 每个增量推送 delta 事件
     → 结束后 SanitizeReply 去掉模型模仿的标注 → done / error / stopped
```

停止：`Orchestrator.Stop(groupID)` 取消整个轮次。正在生成的保留已生成内容，标为 `stopped`；排队中的标为 `stopped` 且内容为空。

## 3. 上下文组装（`internal/contextbuilder`）

难点在于：模型 API 只认 `user / assistant` 两种角色，而群里有用户和多位成员。

| 群里的发言 | 映射为 | 文本 |
|---|---|---|
| 自己（当前成员）说过的 | `assistant` | 原文，**不加标注**（否则模型会学着给自己加标注） |
| 用户说的 | `user` | `[#12 用户 · 10-15 10:02]\n原文` |
| 其他成员说的 | `user` | `[#13 青砚 · 10-15 10:03 · 回复 #12]\n原文` |
| 系统通知 | `user` | `[#1 系统通知]\n原文` |

相邻的同角色消息合并成一条，保证"user 开头、交替、user 结尾"（Anthropic 的硬性要求）。

System prompt 的结构依次是：
1. 成员自己的角色提示词
2. 群聊规则：你是谁、群成员名单与简介、只有用户能 @、不要模仿标注、已确认的决定必须遵循
3. 群记忆：按"决定 / 待办 / 方案 / 背景"分组，每条标明 `[已确认]` / `[用户提出·未确认]` / `[AI建议·未确认]` 和来源；已否决的单独一行"不要再提"
4. 缺口说明：如果有消息因篇幅被裁掉、又还没整理进记忆，如实告诉模型它看不到 #a–#b
5. 本轮说明：串行时告诉它"你是第几位、谁已经回复了"；并行时告诉它"别人同时作答，你看不到"

预算：群记忆最多占 30%；本轮消息必选；剩余预算从新到旧装历史。token 用 `llm.EstimateTokens` 粗估（CJK 每字 1 token），宁可高估。

## 4. 群记忆（`internal/memory`）

见 ADR-0005。要点：
- 记忆是**条目**，不是一段摘要文本。每条有类型、内容、状态、来源（消息编号）、提出者。
- 整理模型只能提交 JSON 操作（add / update / supersede / complete），`Apply` 逐条校验，不合规的单独拒绝。
- **AI 永远不能确认**。`confirmed` 只能由用户在界面上盖章产生（`memory.Confirm`）。AI 也不能修改、取代或完成已确认的条目。
- 触发：一轮结束后，若自上次整理以来新增 ≥8 条可见消息或 ≥2500 token，就整理一次（`Policy.Pending`）；用户也可以手动点"整理"。
- 整理用的模型在设置里单独配置（默认用第一个可用成员的模型）。整理时，相关讨论会发给该模型服务；界面底部有说明。

## 5. 数据

表结构见 `internal/store/schema.sql`，字段语义以 `internal/domain/domain.go` 为准。

- 消息编号 `seq` 群内单调递增，对人、对模型都用 `#seq` 指代消息。
- 记忆编号 `ref` 群内单调递增，展示为 `M{ref}`。
- 成员软删除：历史消息仍要显示已删除成员的名字和印章。
- 启动时把残留的 `pending / streaming` 消息改为 `stopped`（上次异常退出）。

## 6. 前后端契约

`frontend/src/backend/contract.ts` 与 `internal/domain` 一一对应。事件：

| 事件 | 时机 | 载荷 |
|---|---|---|
| `message` | 消息新建、状态变化 | 完整 Message |
| `delta` | 流式增量 | messageId + 文本片段 |
| `turn.start` / `turn.end` | 轮次开始 / 结束 | turnId，开始时附带回复顺序 |
| `memory` | 整理开始 / 结束、用户操作后 | 该群全部记忆条目 + cursor + summarizing |
| `group` | 群信息或最后一条消息变化 | GroupSummary（侧栏用） |

前端 store 对 `delta` 按帧合并；终态 `message` 事件使用后端清洗后的权威正文，不能用流式正文的长度覆盖终态。Wails 侧缓冲增量再转发，确保终态前刷新待发增量；轮次结束事件按 turn ID 防止旧事件覆盖新轮次。

## 7. 测试

- Go：`go test -race ./...`。`contextbuilder`、`memory`、`turn` 的测试描述的就是产品行为，改代码前先读测试。
- 前端：`cd frontend && npm test`。`testdata/mentions.json` 是 Go 与 TS 共享的 @ 解析用例，两边必须同时通过。
- 界面：`cd frontend && npm run dev`，浏览器打开 `http://localhost:5173`（mock 后端，含演示数据）；`?platform=windows` 预览 Windows 布局。

## 8. 附件与分享

- 附件文件保存在数据库旁的 `attachments/`，数据库只存随机 ID 与元数据；消息落库时在同一事务里绑定草稿，失败可原样重试。
- 图片只有在成员开启「图片输入」时才以结构化图像块发送；文档提取文字带 `[#消息号 文件名]` 来源进入上下文。扫描版 PDF 不做 OCR。
- 分享图片先冻结起止消息的公开字段，再用真实 DOM 测量分页，逐页渲染 1080 宽 PNG。保存由桌面层选择目录，Go 侧在隐藏暂存目录写入并整体发布，不覆盖旧目录。
