import { normalizeMarks } from "./layouts.js";

/**
 * Per-account solve marks for one saved puzzle.
 * This table is never the shared layout row.
 */
export async function ensureProgressSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS solve_progress (
    user_sub TEXT NOT NULL,
    layout_id TEXT NOT NULL,
    marks_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_sub, layout_id)
  )`).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS solve_progress_by_layout ON solve_progress (layout_id)",
  ).run();
}

export function normalizeProgressBody(body, layout) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid body" };
  }
  if (!Array.isArray(body.marks)) return { ok: false, error: "Marks must be an array" };
  return normalizeMarks(body.marks, layout.width, layout.height, layout.characters.length);
}

export async function readSolveProgress(db, userSub, layoutId) {
  const layout = await layoutSize(db, layoutId);
  if (!layout) return { missing: true };
  const row = await db.prepare(
    "SELECT marks_json, updated_at FROM solve_progress WHERE user_sub = ? AND layout_id = ?",
  ).bind(userSub, layoutId).first();
  if (!row) return { missing: false, progress: null };
  return {
    missing: false,
    progress: {
      marks: JSON.parse(row.marks_json),
      updated_at: row.updated_at,
    },
  };
}

export async function saveSolveProgress(db, userSub, layoutId, body, now) {
  const layout = await layoutSize(db, layoutId);
  if (!layout) return { ok: false, status: 404, error: "Not found" };
  const parsed = normalizeProgressBody(body, layout);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  await db.prepare(
    `INSERT INTO solve_progress (user_sub, layout_id, marks_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_sub, layout_id) DO UPDATE SET
       marks_json = excluded.marks_json,
       updated_at = excluded.updated_at`,
  ).bind(userSub, layoutId, JSON.stringify(parsed.value), now).run();
  const stored = await readSolveProgress(db, userSub, layoutId);
  return { ok: true, progress: stored.progress };
}

export async function clearSolveProgress(db, userSub, layoutId) {
  const layout = await layoutSize(db, layoutId);
  if (!layout) return false;
  await db.prepare(
    "DELETE FROM solve_progress WHERE user_sub = ? AND layout_id = ?",
  ).bind(userSub, layoutId).run();
  return true;
}

async function layoutSize(db, layoutId) {
  const row = await db.prepare(
    "SELECT width, height, characters_json FROM layouts WHERE id = ?",
  ).bind(layoutId).first();
  if (!row) return null;
  let characters = [];
  try {
    characters = JSON.parse(row.characters_json || "[]");
  } catch {
    characters = [];
  }
  if (!Array.isArray(characters)) characters = [];
  return { width: row.width, height: row.height, characters };
}
