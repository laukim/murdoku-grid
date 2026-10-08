CREATE TABLE IF NOT EXISTS layouts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  walls_json TEXT NOT NULL DEFAULT '[]',
  objects_json TEXT NOT NULL DEFAULT '[]',
  marks_json TEXT NOT NULL DEFAULT '[]',
  characters_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS layouts_by_updated ON layouts (updated_at DESC, id);
