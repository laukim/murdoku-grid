CREATE TABLE IF NOT EXISTS solve_progress (
  user_sub TEXT NOT NULL,
  layout_id TEXT NOT NULL,
  marks_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_sub, layout_id)
);

CREATE INDEX IF NOT EXISTS solve_progress_by_layout ON solve_progress (layout_id);
