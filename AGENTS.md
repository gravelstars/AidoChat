# AGENTS.md —— 执行者工作手册

你接手的是 ai-group-chat：一个本地运行的 AI 群聊桌面应用。核心架构、设计系统和主界面已经完成，你的工作是按任务单补齐其余部分。

本手册适用于所有执行者，不论你是哪个模型、哪个工具。可能同时有多个执行者在不同任务上工作。

## 开工前按顺序读

1. `HANDOFF.md`：现状、已完成与待完成、推荐顺序
2. `docs/PRODUCT.md`：做什么、不做什么
3. `docs/ARCHITECTURE.md`：模块划分与一次发送的完整流程
4. `docs/DESIGN.md`：视觉规范。**凡是动界面，必须先读完**
5. 你被分配的 `docs/tasks/TASK-xxx.md`

## 四条铁律

1. **受保护文件不改。** 清单在 `scripts/protected.txt`。交付前运行 `scripts/check-protected.sh`，必须通过。**禁止运行 `scripts/check-protected.sh --update`**，那是项目所有者的操作。
2. **不自由发挥视觉。** 只用 `tokens.css` 里的变量，只用现有组件（`Button`、`Segmented`、`Dialog`、`Field`、`Seal` / `UserSeal`、`Icon`，业务上可复用 `AvatarEditor`），新页面照现有页面写。不引入 UI 组件库、图标库、Tailwind。朱色只属于用户（见 DESIGN.md §2）。
3. **不改契约。** `internal/domain/domain.go` 与 `frontend/src/backend/contract.ts` 的字段是前后端契约。任务单明确允许的扩展除外，其他改动写阻塞记录。
4. **不放宽记忆规则。** AI 不能产生"已确认"，不能修改已确认的条目，每条记忆必须有真实来源（ADR-0005）。任何让这些规则变松的改动都不接受。

## 任务流程

1. 读任务单，确认依赖的任务已完成。
2. **认领**：在任务单开头的元信息里追加一行 `- 认领：<执行者名称> · YYYY-MM-DD`。已经有人认领且未写交付记录的任务不要碰；需要接手时先问项目所有者。
3. 开一个分支：`task/xxx-简述`。一次只做一张任务单，不顺手改其他任务的范围。
4. 实现。遇到下列情况**停下来写阻塞记录**，不要自己决定：
   - 需要改受保护文件或契约
   - 需要新增依赖
   - 需要新组件、新颜色、新图标
   - 任务单与现有代码或规范冲突
5. 自检：
   ```bash
   go vet ./... && go test -race ./...
   cd frontend && npm test && npm run build
   cd .. && scripts/check-protected.sh
   ```
6. 在任务单末尾追加"交付记录"：做了什么、怎么验证的、截图（界面任务至少需要宣纸与夜读两种纸）、未验证的部分（例如"Windows 未真机验证"）。
7. 把验收标准里的复选框逐项打勾。没做到的不要打勾，写明原因。

### 交付记录格式

```markdown
## 交付记录 YYYY-MM-DD · <执行者名称>
- 做了什么：……
- 怎么验证的：……（命令输出、截图路径）
- 未验证 / 遗留：……
```

### 阻塞记录格式

在任务单末尾追加：

```markdown
## 阻塞记录 YYYY-MM-DD
- 问题：……
- 影响：……
- 我的建议：……（如涉及受保护文件，附上具体的 diff）
```

## 代码约定

- Go：标准库优先；错误信息给人看的部分用中文；注释用中文，说明"为什么"，不复述代码。
- 前端：函数组件 + hooks；状态放 `state/store.ts`；组件不直接调用 Wails 运行时，只通过 `backend`；样式用 CSS Modules。
- 每个可点击元素都要有 `:active` 按下反馈（DESIGN.md §7）。
- 中文输入法：任何监听 Enter 的地方都要判断 `e.nativeEvent.isComposing`。
- 不要提交 API Key、数据库文件、`node_modules`、`dist`。

## 运行

```bash
# 前端预览（mock 后端，含演示数据）
cd frontend && npm install && npm run dev      # http://localhost:5173
# Windows 布局预览：http://localhost:5173/?platform=windows

# Go 测试
go test -race ./...

# 桌面应用（TASK-001 完成后）
wails3 dev
```
