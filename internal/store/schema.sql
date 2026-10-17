-- ai-group-chat 本地数据库表结构（SQLite）。
-- 字段语义以 internal/domain/domain.go 为准；本文件是 TASK-003 的实现依据。
-- 约定：时间一律存 UTC 的 RFC3339 毫秒字符串；ID 用 ULID（按时间可排序）。
-- 迁移：用 PRAGMA user_version 记版本，启动时顺序执行 migrations/NNN_*.sql。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE providers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('openai', 'anthropic')),
  base_url    TEXT NOT NULL,
  key_ref     TEXT NOT NULL,          -- 系统钥匙串条目名；Key 明文绝不入库
  created_at  TEXT NOT NULL,
  deleted_at  TEXT                   -- 下线后仅为历史成员保留外键，配置与调用不可见
);

CREATE TABLE members (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,  -- 不含空白与 '@'，应用层校验
  avatar_glyph    TEXT NOT NULL,
  avatar_color    TEXT NOT NULL,
  avatar_image    TEXT NOT NULL DEFAULT '',
  brief           TEXT NOT NULL DEFAULT '',
  role_prompt     TEXT NOT NULL DEFAULT '',
  provider_id     TEXT NOT NULL REFERENCES providers(id),
  model           TEXT NOT NULL,
  temperature     REAL,
  context_tokens  INTEGER NOT NULL DEFAULT 16000,
  supports_images INTEGER NOT NULL DEFAULT 0, -- 仅由用户确认模型能力后开启
  created_at      TEXT NOT NULL,
  deleted_at      TEXT                   -- 软删除：历史消息仍需显示其名字头像
);

CREATE TABLE groups (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  topic          TEXT NOT NULL DEFAULT '',
  default_mode   TEXT NOT NULL DEFAULT 'serial' CHECK (default_mode IN ('serial', 'parallel')),
  memory_cursor  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,          -- 最后一条消息时间，用于群列表排序
  archived_at    TEXT
);

CREATE TABLE group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id),
  position   INTEGER NOT NULL,          -- @所有人 时的回复顺序
  joined_at  TEXT NOT NULL,
  -- 本群头像覆盖（ADR-0008），三列全为 NULL 表示使用成员默认头像
  avatar_glyph  TEXT,
  avatar_color  TEXT,
  avatar_image  TEXT,
  PRIMARY KEY (group_id, member_id)
);

CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  author_kind  TEXT NOT NULL CHECK (author_kind IN ('user', 'member', 'system')),
  author_id    TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  attachments  TEXT NOT NULL DEFAULT '[]', -- 事务绑定后的附件元数据快照
  mentions     TEXT NOT NULL DEFAULT '[]',   -- JSON 数组，成员 ID 有序
  mention_all  INTEGER NOT NULL DEFAULT 0,
  reply_to_id  TEXT NOT NULL DEFAULT '',
  turn_id      TEXT NOT NULL DEFAULT '',
  -- 本轮回复方式，重试用（TASK-005，由 migrations/002 加入）
  reply_mode   TEXT NOT NULL DEFAULT 'serial',
  provider     TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  context_seq  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'done', 'error', 'stopped')),
  error        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  finished_at  TEXT,
  UNIQUE (group_id, seq)
);
CREATE INDEX messages_turn ON messages(group_id, turn_id);

CREATE TABLE memory_items (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  ref            INTEGER NOT NULL,           -- 群内短编号 M{ref}
  kind           TEXT NOT NULL CHECK (kind IN ('background', 'plan', 'decision', 'todo')),
  content        TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'rejected', 'done', 'superseded')),
  origin         TEXT NOT NULL CHECK (origin IN ('user', 'member')),
  proposed_by    TEXT NOT NULL,
  confirmed_at   TEXT,
  superseded_by  TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (group_id, ref)
);

CREATE TABLE memory_sources (
  item_id     TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  message_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('proposed', 'discussed', 'completed')),
  PRIMARY KEY (item_id, message_id, role)
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,                   -- 如 memory.provider_id / memory.model / ui.appearance / ui.user_seal
  value  TEXT NOT NULL                       -- ui.appearance、ui.user_seal 存 JSON，结构见 contract.ts 的 Appearance / UserSeal
);

-- 启动时修复：上次异常退出时残留的进行中消息一律标为 stopped。
-- UPDATE messages SET status = 'stopped' WHERE status IN ('pending', 'streaming');

-- 活跃成员必须引用未下线服务；约束触发器见 migrations/003_provider_retirement.sql。

-- 附件草稿与消息的绑定身份，文件按id保存在数据库旁attachments目录。
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  metadata TEXT NOT NULL
);
CREATE INDEX attachments_group ON attachments(group_id);
