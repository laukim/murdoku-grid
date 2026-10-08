import { parseBoardPaste } from "./board-convert.js";

/**
 * Convert a local playground-style layout file into the grid helper's
 * saved-layout shape (width, height, wall segments, optional objects).
 * This module never fetches a URL.
 *
 * Room map: `rooms` or `zones` is a grid. Adjacent cells with different
 * ids become internal walls. Wall list: `walls` uses "h,r,c" / "v,r,c"
 * or a small set of segment objects. Obstacles are optional.
 */

export const KNOWN_OBJECT_IDS = [
  "chair",
  "bed",
  "carpet",
  "car",
  "oil-slick",
  "table",
  "bookshelf",
  "plant",
  "tree",
  "tv",
  "statue",
  "other",
];

const MAX_TITLE = 80;
const MAX_LABEL = 40;
const FEATURE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function importBoardSource(text, options = {}) {
  return importPlaygroundLayout(parseBoardPaste(text), options);
}

export function importPlaygroundLayout(input, options = {}) {
  const source = unwrap(input);
  const zoneKey = ["rooms", "zones", "roomMap", "zoneMap"].find((key) => source[key] != null);
  const rooms = zoneKey ? readZoneMap(source[zoneKey], source.width, source.height) : null;
  const width = rooms ? rooms.width : requireSize(source.width, "Width");
  const height = rooms ? rooms.height : requireSize(source.height, "Height");
  if (rooms && source.width != null && asInt(source.width) !== width) {
    throw new Error(`Room map has ${width} columns but width is ${source.width}`);
  }
  if (rooms && source.height != null && asInt(source.height) !== height) {
    throw new Error(`Room map has ${height} rows but height is ${source.height}`);
  }

  const walls = new Set(rooms ? wallsFromZoneMap(rooms.grid, width, height) : []);
  const explicit = readExplicitWalls(source.walls ?? source.wallSegments ?? source.edges, width, height);
  for (const key of explicit) walls.add(key);
  const maxWalls = (height - 1) * width + height * (width - 1);
  if (walls.size > maxWalls) throw new Error("Too many walls");

  const characters = readCharacters(source.characters ?? source.labels, width, height);
  const objects = readObjects(source, width, height);
  const marks = readMarks(source.marks, width, height, characters);

  return {
    title: readTitle(options.title || source.title || source.name, options.fallbackTitle),
    width,
    height,
    characters,
    walls: [...walls].sort(),
    objects,
    marks,
  };
}

export function layoutInsertSql(layout, { id, now, userSub = "" } = {}) {
  const layoutId = id || crypto.randomUUID();
  const ts = now || new Date().toISOString();
  return `INSERT INTO layouts (
  id, title, width, height, walls_json, objects_json, marks_json, characters_json, created_at, updated_at, user_sub
) VALUES (
  ${sqlString(layoutId)},
  ${sqlString(layout.title)},
  ${layout.width},
  ${layout.height},
  ${sqlString(JSON.stringify(layout.walls))},
  ${sqlString(JSON.stringify(layout.objects))},
  ${sqlString(JSON.stringify(layout.marks))},
  ${sqlString(JSON.stringify(layout.characters))},
  ${sqlString(ts)},
  ${sqlString(ts)},
  ${sqlString(String(userSub))}
);`;
}

function unwrap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Layout JSON must be an object");
  }
  const nested = input.layout;
  const hasGrid = input.width != null || input.height != null
    || input.rooms != null || input.zones != null || input.roomMap != null
    || input.walls != null || input.wallSegments != null;
  if (nested && typeof nested === "object" && !Array.isArray(nested) && !hasGrid) return nested;
  return input;
}

function requireSize(raw, label) {
  const n = asInt(raw);
  if (n == null || n < 2 || n > 20) throw new Error(`${label} must be an integer from 2 to 20`);
  return n;
}

function asInt(raw) {
  if (Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && /^(0|[1-9]\d*)$/.test(raw)) return Number(raw);
  return null;
}

function readTitle(raw, fallback) {
  const source = typeof raw === "string" && raw.trim() ? raw : fallback;
  const title = typeof source === "string" ? source.trim() : "";
  if (!title) return "Imported layout";
  if (title.length > MAX_TITLE || /[\u0000-\u001f]/.test(title)) {
    throw new Error("Title must be 1–80 characters");
  }
  return title;
}

function readZoneMap(raw, widthHint, heightHint) {
  const rows = zoneRows(raw, asInt(widthHint), asInt(heightHint));
  if (rows.length < 2 || rows.length > 20) throw new Error("Room map height must be from 2 to 20");
  const width = rows[0].length;
  if (width < 2 || width > 20) throw new Error("Room map width must be from 2 to 20");
  rows.forEach((row, index) => {
    if (row.length !== width) {
      throw new Error(`Room map row ${index + 1} has ${row.length} cells but width is ${width}`);
    }
  });
  return { width, height: rows.length, grid: rows };
}

function zoneRows(raw, widthHint, heightHint) {
  if (typeof raw === "string") {
    if (widthHint == null || heightHint == null || raw.length !== widthHint * heightHint) {
      throw new Error("A one-line room map needs width, height, and one character per cell");
    }
    const rows = [];
    for (let r = 0; r < heightHint; r++) {
      rows.push([...raw.slice(r * widthHint, (r + 1) * widthHint)]);
    }
    return rows;
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Room map must be a grid");

  if (isFlatIdList(raw, widthHint, heightHint)) {
    const rows = [];
    for (let r = 0; r < heightHint; r++) {
      rows.push(raw.slice(r * widthHint, (r + 1) * widthHint).map(roomId));
    }
    return rows;
  }

  return raw.map((row, index) => {
    if (Array.isArray(row)) {
      if (!row.every((cell) => isRoomId(cell))) throw new Error(`Invalid room id in row ${index + 1}`);
      return row.map(roomId);
    }
    if (typeof row === "string") return splitRoomRow(row, index);
    throw new Error(`Room map row ${index + 1} must be a string or an array`);
  });
}

function isFlatIdList(raw, widthHint, heightHint) {
  if (widthHint == null || heightHint == null || raw.length !== widthHint * heightHint) return false;
  return raw.every((cell) => Number.isInteger(cell) || (typeof cell === "string" && cell.trim().length === 1));
}

function splitRoomRow(row, index) {
  let cells;
  if (/[,;]/.test(row)) cells = row.split(/[,;]/).map((cell) => cell.trim());
  else if (/\s/.test(row)) cells = row.split(/\s+/).filter(Boolean);
  else cells = [...row];
  if (!cells.length || !cells.every((cell) => isRoomId(cell))) {
    throw new Error(`Invalid room id in row ${index + 1}`);
  }
  return cells.map(roomId);
}

function isRoomId(value) {
  return (typeof value === "string" && value.trim() && !/[\u0000-\u001f]/.test(value))
    || Number.isInteger(value);
}

function roomId(value) {
  return typeof value === "string" ? value.trim() : String(value);
}

function wallsFromZoneMap(grid, width, height) {
  const walls = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (c + 1 < width && grid[r][c] !== grid[r][c + 1]) walls.push(`v,${r},${c}`);
      if (r + 1 < height && grid[r][c] !== grid[r + 1][c]) walls.push(`h,${r},${c}`);
    }
  }
  return walls;
}

function readExplicitWalls(raw, width, height) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Walls must be an array");
  return raw.map((item) => {
    if (typeof item === "string") return parseWallKey(item, width, height);
    if (Array.isArray(item) || (item && typeof item === "object")) return wallFromValue(item, width, height);
    throw new Error("Invalid wall");
  });
}

function wallFromValue(item, width, height) {
  if (Array.isArray(item)) {
    if (item.length === 3 && wallDir(item[0])) return parseWallKey(`${wallDir(item[0])},${item[1]},${item[2]}`, width, height);
    if (item.length === 2) return wallBetween(item[0], item[1], width, height);
    throw new Error("Invalid wall");
  }
  if (item.between || (item.from && item.to)) {
    const pair = item.between || [item.from, item.to];
    return wallBetween(pair[0], pair[1], width, height);
  }
  const dir = wallDir(item.dir ?? item.edge ?? item.type ?? item.orientation);
  const r = asInt(item.r ?? item.row);
  const c = asInt(item.c ?? item.col ?? item.column);
  if (!dir || r == null || c == null) throw new Error("Invalid wall");
  return parseWallKey(`${dir},${r},${c}`, width, height);
}

function wallDir(value) {
  const dir = String(value ?? "").toLowerCase();
  if (dir === "h" || dir === "horizontal" || dir === "row") return "h";
  if (dir === "v" || dir === "vertical" || dir === "col" || dir === "column") return "v";
  return null;
}

function wallBetween(a, b, width, height) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
    throw new Error("Wall endpoints must be [row, column] pairs");
  }
  const r1 = asInt(a[0]);
  const c1 = asInt(a[1]);
  const r2 = asInt(b[0]);
  const c2 = asInt(b[1]);
  if ([r1, c1, r2, c2].some((n) => n == null)) throw new Error("Invalid wall endpoint");
  for (const [r, c] of [[r1, c1], [r2, c2]]) {
    if (r < 0 || c < 0 || r >= height || c >= width) throw new Error("Wall endpoint is outside the grid");
  }
  if (r1 === r2 && Math.abs(c1 - c2) === 1) return `v,${r1},${Math.min(c1, c2)}`;
  if (c1 === c2 && Math.abs(r1 - r2) === 1) return `h,${Math.min(r1, r2)},${c1}`;
  throw new Error("Wall endpoints must be adjacent cells");
}

function parseWallKey(key, width, height) {
  if (typeof key !== "string") throw new Error("Invalid wall");
  const match = /^(h|v),(\d+),(\d+)$/.exec(key);
  if (!match) throw new Error(`Invalid wall "${key}"`);
  const type = match[1];
  const r = Number(match[2]);
  const c = Number(match[3]);
  if (`${type},${r},${c}` !== key) throw new Error(`Invalid wall "${key}"`);
  const inRange = type === "h" ? r <= height - 2 && c <= width - 1 : r <= height - 1 && c <= width - 2;
  if (!inRange) throw new Error(`Wall ${key} is outside the grid`);
  return key;
}

function readCharacters(raw, width, height) {
  if (raw == null) return defaultCharacters(width, height);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 26) {
    throw new Error("Characters must be 1–26 labels");
  }
  return raw.map((label) => {
    if (typeof label !== "string") throw new Error("Invalid character label");
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > MAX_LABEL || /[\u0000-\u001f]/.test(trimmed)) {
      throw new Error("Invalid character label");
    }
    return trimmed;
  });
}

function defaultCharacters(width, height) {
  const n = Math.min(width, height);
  const labels = [];
  for (let i = 0; i < n - 1; i++) labels.push(String.fromCharCode(65 + i));
  labels.push("V");
  return labels;
}

function readObjects(source, width, height) {
  const byCell = new Map();
  const grid = source.obstacleMap ?? source.objectMap;
  if (grid != null) placeObjectGrid(grid, width, height, byCell);
  for (const key of ["obstacles", "objects", "features"]) {
    if (source[key] == null) continue;
    if (!Array.isArray(source[key])) throw new Error("Objects must be an array");
    if (isObjectGrid(source[key], height)) placeObjectGrid(source[key], width, height, byCell);
    else for (const item of source[key]) placeObject(item, width, height, byCell);
  }
  if (byCell.size > width * height) throw new Error("Too many objects");
  return [...byCell.values()].sort((a, b) => a.r - b.r || a.c - b.c);
}

function isObjectGrid(raw, height) {
  if (raw.length !== height || raw.length === 0) return false;
  return raw.every((row) => Array.isArray(row) || typeof row === "string");
}

function placeObjectGrid(grid, width, height, byCell) {
  if (!Array.isArray(grid) || grid.length !== height) throw new Error("Obstacle grid must have one row per grid row");
  grid.forEach((row, r) => {
    let cells = row;
    if (typeof row === "string") {
      cells = row.length === width ? [...row] : row.split(/[,;]/).map((cell) => cell.trim());
    }
    if (!Array.isArray(cells) || cells.length !== width) {
      throw new Error(`Obstacle grid row ${r + 1} must have ${width} cells`);
    }
    cells.forEach((cell, c) => {
      if (cell == null || cell === "" || cell === "-" || cell === ".") return;
      if (typeof cell !== "string") throw new Error("Obstacle grid cells must be an id or blank");
      byCell.set(`${r},${c}`, { r, c, id: objectId(cell) });
    });
  });
}

function placeObject(item, width, height, byCell) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid object");
  const r = asInt(item.r ?? item.row ?? item.y);
  const c = asInt(item.c ?? item.col ?? item.column ?? item.x);
  if (r == null || c == null) throw new Error("Invalid object cell");
  if (r < 0 || c < 0 || r >= height || c >= width) throw new Error(`Object at row ${r}, column ${c} is outside the grid`);
  const id = objectId(item.id ?? item.type ?? item.kind);
  byCell.set(`${r},${c}`, { r, c, id });
}

function objectId(raw) {
  if (typeof raw !== "string") throw new Error("Invalid object id");
  const id = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!FEATURE_ID.test(id)) throw new Error(`Invalid object id "${raw}"`);
  return id;
}

function readMarks(raw, width, height, characters) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Marks must be an array");
  if (raw.length > width * height) throw new Error("Too many marks");
  const byCell = new Map();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid mark");
    const r = asInt(item.r ?? item.row);
    const c = asInt(item.c ?? item.col ?? item.column);
    if (r == null || c == null) throw new Error("Invalid mark cell");
    if (r < 0 || c < 0 || r >= height || c >= width) throw new Error("Mark is outside the grid");
    const confirmed = characterIndex(item.confirmed, characters, "Invalid placement");
    const blocked = item.blocked === true;
    if (blocked && confirmed !== null) throw new Error("A cell cannot be both placed and marked X");
    const pencilRaw = item.pencil == null ? [] : item.pencil;
    if (!Array.isArray(pencilRaw) || pencilRaw.length > characters.length) throw new Error("Invalid pencil marks");
    const pencil = [];
    const seen = new Set();
    for (const entry of pencilRaw) {
      const n = characterIndex(entry, characters, "Invalid pencil marks");
      if (n === null || seen.has(n)) throw new Error("Invalid pencil marks");
      seen.add(n);
      pencil.push(n);
    }
    pencil.sort((a, b) => a - b);
    if (confirmed === null && !blocked && pencil.length === 0) continue;
    byCell.set(`${r},${c}`, {
      r,
      c,
      confirmed,
      blocked,
      pencil: confirmed !== null || blocked ? [] : pencil,
    });
  }
  return [...byCell.values()].sort((a, b) => a.r - b.r || a.c - b.c);
}

function characterIndex(value, characters, message) {
  if (value == null || value === "") return null;
  if (Number.isInteger(value)) {
    if (value < 0 || value >= characters.length) throw new Error(message);
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const n = Number(value);
    if (n >= characters.length) throw new Error(message);
    return n;
  }
  if (typeof value === "string") {
    const idx = characters.indexOf(value.trim());
    if (idx < 0) throw new Error(message);
    return idx;
  }
  throw new Error(message);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
