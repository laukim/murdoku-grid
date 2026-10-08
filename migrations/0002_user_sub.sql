ALTER TABLE layouts ADD COLUMN user_sub TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS layouts_by_user ON layouts (user_sub, updated_at DESC, id);
