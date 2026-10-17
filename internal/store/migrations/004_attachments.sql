ALTER TABLE members ADD COLUMN supports_images INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
CREATE TABLE attachments (
 id TEXT PRIMARY KEY,
 group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
 metadata TEXT NOT NULL
);
CREATE INDEX attachments_group ON attachments(group_id);
