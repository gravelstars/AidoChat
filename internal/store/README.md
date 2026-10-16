# SQLite 存储

`OpenDefault()` 打开 `os.UserConfigDir()/ai-group-chat/data.db`；`Open(path)` 可指定文件路径，测试必须使用临时目录。调用者退出时调用 `Close()`。业务核心不依赖 Wails。

- 使用 WAL、外键、5 秒 busy timeout、立即事务；每个 Store 一个连接。方法可并发调用，跨 Store 的写入也由 SQLite 事务协调。
- 首次打开运行嵌入的 `migrations/001_init.sql`，迁移和 `user_version` 同事务提交。更高版本数据库会被拒绝，避免旧应用误写新表结构。
- **Open 只应在应用启动时调用。** 它会把所有遗留 `pending/streaming` 消息恢复为 `stopped` 并记录结束时间。不要在活跃轮次期间额外 Open 同一个文件；同一进程复用已有 Store。
- `NewID()` 返回可并发调用的 ULID；创建方法在 ID 为空时自动分配。创建时间缺省取当前 UTC，数据库时间格式为 RFC3339 毫秒。

## 方法约定

- `SaveProvider` / `SaveMember` 创建或更新并在成功后回填 ID、缺省创建时间；模型服务只保存 `KeyRef`，没有保存 Key 明文的字段或方法。已软删除成员不能被 Save 复活。
- `ListMembers` 只列未删除成员；`Member` / `Members(ids)` 可查已删除成员，用于历史显示。`DeleteMember` 软删除并移除群关系；系统通知和进行中轮次检查留给服务层。
- `CreateGroup` / `UpdateGroup` 原子保存群资料及有序成员。`UpdateGroup` 不改记忆游标。头像未覆盖时三列为 NULL；`SetGroupAvatar(..., nil)` 恢复默认。
- `Groups` 返回含归档的全部群，按最近更新时间排序；服务层按需要筛选。删除群由外键级联删除消息、记忆、来源和成员关系。
- `InsertMessage` 在事务内计算 seq 并在提交成功后回填，失败不修改传入对象。`UpdateMessage` 只改内容、模型快照、ContextSeq、状态、错误、结束时间，保留编号、作者、轮次和触发关系。`RecentMessages` 的 limit ≤ 0 返回空列表。
- `SaveMemoryItems(groupID, changes, cursor)` 保存变更集（不会删除未传入条目）及游标。新条目 ID/Ref 为零时分配；调用后重新读取 `MemoryItems` 获取编号与来源。来源必须在同群真实存在且 seq 匹配；来源与条目、游标同事务保存。删除单个条目会级联删除来源。
- **记忆业务校验先调用 memory 包**：存储层不辨别操作者，不能代替 `memory.Apply`、Confirm、Reject、Edit 等规则。TASK-006 必须在读取最新状态、校验、保存期间串行化同群记忆操作，避免旧快照覆盖用户操作。
- `SetSetting` 接受 JSON 文本（标量字符串也需 JSON 引号），`Setting` 原样读回，便于保存 appearance、user seal 等配置。未找到记录及未影响任何行的删除/更新可用 `errors.Is(err, sql.ErrNoRows)` 判断。

## 验证

`go test -race ./internal/store` 使用临时文件数据库，覆盖独立连接并发插入、事务回滚、来源校验、重启恢复，以及现有 Orchestrator 的依次、同时、停止和失败继续行为，不调用真实模型。
