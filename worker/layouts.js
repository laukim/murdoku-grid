import { SCHEMA_SQL } from "./schema.js";

const MAX_TITLE = 80;
const MAX_LABEL = 40;
const FEATURE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export async function ensureSchema(db) {
  for (const sql of SCHEMA_SQL.split(";").map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(sql).run();
  }
  const info = await db.prepare("PRAGMA table_info(layouts)").all();
  const names = new Set((info.results || []).map((column) => column.name));
  if (!names.has("user_sub")) {
    await db.prepare("ALTER TABLE layouts ADD COLUMN user_sub TEXT NOT NULL DEFAULT ''").run();
  }
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS layouts_by_user ON layouts (user_sub, updated_at DESC, id)",
  ).run();
}

export function normalizeLayoutInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid body" };
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > MAX_TITLE || /[\u0000-\u001f]/.test(title)) {
    return { ok: false, error: "Title must be 1–80 characters" };
  }

  const { width, height } = body;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || width > 20 || height < 2 || height > 20) {
    return { ok: false, error: "Width and height must be integers from 2 to 20" };
  }

  const characters = normalizeCharacters(body.characters);
  if (!characters.ok) return characters;
  const walls = normalizeWalls(body.walls, width, height);
  if (!walls.ok) return walls;
  const objects = normalizeObjects(body.objects, width, height);
  if (!objects.ok) return objects;
  const marks = normalizeMarks(body.marks, width, height, characters.value.length);
  if (!marks.ok) return marks;

  return {
    ok: true,
    value: {
      title,
      width,
      height,
      walls: walls.value,
      objects: objects.value,
      marks: marks.value,
      characters: characters.value,
    },
  };
}

export async function listLayouts(db, userSub) {
  const { results } = await db.prepare(
    `SELECT id, title, width, height, created_at, updated_at
     FROM layouts
     WHERE user_sub = ?
     ORDER BY updated_at DESC, id ASC`,
  ).bind(userSub).all();
  return results.map(summaryFromRow);
}

export async function getLayoutById(db, userSub, id) {
  const row = await db.prepare(
    `SELECT id, title, width, height, walls_json, objects_json, marks_json, characters_json, created_at, updated_at
     FROM layouts WHERE id = ? AND user_sub = ?`,
  ).bind(id, userSub).first();
  return row ? layoutFromRow(row) : null;
}

export async function insertLayout(db, userSub, id, value, now) {
  await db.prepare(
    `INSERT INTO layouts (
       id, user_sub, title, width, height, walls_json, objects_json, marks_json, characters_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    userSub,
    value.title,
    value.width,
    value.height,
    JSON.stringify(value.walls),
    JSON.stringify(value.objects),
    JSON.stringify(value.marks),
    JSON.stringify(value.characters),
    now,
    now,
  ).run();
  return getLayoutById(db, userSub, id);
}

export async function updateLayout(db, userSub, id, value, now) {
  const existing = await getLayoutById(db, userSub, id);
  if (!existing) return null;
  await db.prepare(
    `UPDATE layouts
     SET title = ?, width = ?, height = ?, walls_json = ?, objects_json = ?, marks_json = ?, characters_json = ?, updated_at = ?
     WHERE id = ? AND user_sub = ?`,
  ).bind(
    value.title,
    value.width,
    value.height,
    JSON.stringify(value.walls),
    JSON.stringify(value.objects),
    JSON.stringify(value.marks),
    JSON.stringify(value.characters),
    now,
    id,
    userSub,
  ).run();
  return getLayoutById(db, userSub, id);
}

export async function deleteLayoutById(db, userSub, id) {
  const existing = await getLayoutById(db, userSub, id);
  if (!existing) return false;
  await db.prepare("DELETE FROM layouts WHERE id = ? AND user_sub = ?").bind(id, userSub).run();
  return true;
}

function summaryFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    width: row.width,
    height: row.height,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function layoutFromRow(row) {
  return {
    ...summaryFromRow(row),
    walls: JSON.parse(row.walls_json),
    objects: JSON.parse(row.objects_json),
    marks: JSON.parse(row.marks_json),
    characters: JSON.parse(row.characters_json),
  };
}

function normalizeCharacters(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 26) {
    return { ok: false, error: "Characters must be 1–26 labels" };
  }
  const value = [];
  for (const label of raw) {
    if (typeof label !== "string") return { ok: false, error: "Invalid character label" };
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > MAX_LABEL || /[\u0000-\u001f]/.test(trimmed)) {
      return { ok: false, error: "Invalid character label" };
    }
    value.push(trimmed);
  }
  return { ok: true, value };
}

function normalizeWalls(raw, width, height) {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Walls must be an array" };
  const max = (height - 1) * width + height * (width - 1);
  if (raw.length > max) return { ok: false, error: "Too many walls" };

  const seen = new Set();
  for (const key of raw) {
    if (typeof key !== "string") return { ok: false, error: "Invalid wall" };
    const match = /^(h|v),(\d+),(\d+)$/.exec(key);
    if (!match) return { ok: false, error: "Invalid wall" };
    const type = match[1];
    const r = Number(match[2]);
    const c = Number(match[3]);
    if (`${type},${r},${c}` !== key) return { ok: false, error: "Invalid wall" };
    const inRange = type === "h"
      ? r <= height - 2 && c <= width - 1
      : r <= height - 1 && c <= width - 2;
    if (!inRange) return { ok: false, error: "Wall is outside the grid" };
    seen.add(key);
  }
  return { ok: true, value: [...seen].sort() };
}

function normalizeObjects(raw, width, height) {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Objects must be an array" };
  if (raw.length > width * height) return { ok: false, error: "Too many objects" };

  const byCell = new Map();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Invalid object" };
    if (!Number.isInteger(item.r) || !Number.isInteger(item.c)) return { ok: false, error: "Invalid object cell" };
    if (item.r < 0 || item.c < 0 || item.r >= height || item.c >= width) {
      return { ok: false, error: "Object is outside the grid" };
    }
    if (typeof item.id !== "string" || !FEATURE_ID.test(item.id)) return { ok: false, error: "Invalid object id" };
    byCell.set(`${item.r},${item.c}`, { r: item.r, c: item.c, id: item.id });
  }
  return {
    ok: true,
    value: [...byCell.values()].sort((a, b) => a.r - b.r || a.c - b.c),
  };
}

function normalizeMarks(raw, width, height, characterCount) {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Marks must be an array" };
  if (raw.length > width * height) return { ok: false, error: "Too many marks" };

  const byCell = new Map();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Invalid mark" };
    if (!Number.isInteger(item.r) || !Number.isInteger(item.c)) return { ok: false, error: "Invalid mark cell" };
    if (item.r < 0 || item.c < 0 || item.r >= height || item.c >= width) {
      return { ok: false, error: "Mark is outside the grid" };
    }

    const confirmed = item.confirmed == null ? null : item.confirmed;
    if (confirmed !== null && (!Number.isInteger(confirmed) || confirmed < 0 || confirmed >= characterCount)) {
      return { ok: false, error: "Invalid placement" };
    }
    const blocked = item.blocked === true;
    if (blocked && confirmed !== null) return { ok: false, error: "A cell cannot be both placed and marked X" };

    const pencilRaw = item.pencil == null ? [] : item.pencil;
    if (!Array.isArray(pencilRaw) || pencilRaw.length > characterCount) {
      return { ok: false, error: "Invalid pencil marks" };
    }
    const pencil = [];
    const seen = new Set();
    for (const n of pencilRaw) {
      if (!Number.isInteger(n) || n < 0 || n >= characterCount || seen.has(n)) {
        return { ok: false, error: "Invalid pencil marks" };
      }
      seen.add(n);
      pencil.push(n);
    }
    pencil.sort((a, b) => a - b);
    if (confirmed === null && !blocked && pencil.length === 0) continue;
    byCell.set(`${item.r},${item.c}`, {
      r: item.r,
      c: item.c,
      confirmed,
      blocked,
      pencil: confirmed !== null || blocked ? [] : pencil,
    });
  }
  return {
    ok: true,
    value: [...byCell.values()].sort((a, b) => a.r - b.r || a.c - b.c),
  };
}
