-- TASK-005：在消息上记录本轮回复方式（依次/同时），供重试时重建当时的上下文可见性。
-- 历史行归为 serial；列定义与 schema.sql 保持一致（ALTER 不能加 CHECK）。
ALTER TABLE messages ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'serial';
