-- 下线服务保留历史成员的外键，但不再可供配置或调用；API Key 仍由服务层从钥匙串删除。
ALTER TABLE providers ADD COLUMN deleted_at TEXT;

CREATE TRIGGER providers_retire_active_members
BEFORE UPDATE OF deleted_at ON providers
WHEN NEW.deleted_at IS NOT NULL AND EXISTS (
 SELECT 1 FROM members WHERE provider_id=OLD.id AND deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'仍有成员在使用此模型服务'); END;

CREATE TRIGGER members_require_active_provider_insert
BEFORE INSERT ON members
WHEN NOT EXISTS (SELECT 1 FROM providers WHERE id=NEW.provider_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'模型服务不存在或已下线'); END;

CREATE TRIGGER members_require_active_provider_update
BEFORE UPDATE OF provider_id ON members
WHEN NEW.deleted_at IS NULL AND NOT EXISTS (
 SELECT 1 FROM providers WHERE id=NEW.provider_id AND deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'模型服务不存在或已下线'); END;
