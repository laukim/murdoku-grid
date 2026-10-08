/**
 * Turn one pasted playground board into the grid helper's layout shape.
 * This module never fetches a URL.
 *
 * HTML: board-cell elements in row-major order, board-cell-crossed for
 * obstacles, and line elements whose --line-thickness is about 10px.
 * Outer borders are thick too; they are not room walls.
 *
 * Compact JSON uses 1-based "after row / after column" for full thick
 * lines and 0-based row-major indexes for crossed cells:
 * { "width": 6, "height": 6, "thickH": [3], "thickV": [3], "crossed": [5, 18] }
 * After row 3 is h,2,*. After column 3 is v,*,2.
 */

const THICK_PX = 8;

export function parseBoardPaste(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("Paste a board or layout first.");
  if (looksLikeHtml(trimmed)) return boardFromHtml(trimmed);
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("That paste is not board HTML or JSON.");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && isCompactBoard(parsed)) {
    return boardFromCompact(parsed);
  }
  return parsed;
}

function looksLikeHtml(text) {
  return text.startsWith("<") || (text.includes("<") && /board-cell/i.test(text));
}

function isCompactBoard(value) {
  return ["thickH", "thickV", "thickEdges", "crossed", "crossedCells"].some((key) => value[key] != null);
}

function boardFromCompact(source) {
  const width = requireDim(source.width ?? source.cols ?? source.size, "Width");
  const height = requireDim(source.height ?? source.rows ?? source.size, "Height");
  const walls = [];
  for (const spec of edgeList(source, "h")) walls.push(...expandEdge("h", spec, width, height));
  for (const spec of edgeList(source, "v")) walls.push(...expandEdge("v", spec, width, height));
  if (source.walls != null) {
    if (!Array.isArray(source.walls)) throw new Error("Walls must be an array");
    walls.push(...source.walls);
  }
  const objects = crossedObjects(
    source.crossed ?? source.crossedCells ?? [],
    width,
    height,
    source.obstacle || source.obstacleId || "other",
  );
  const layout = { width, height, walls, objects };
  if (typeof source.title === "string" || typeof source.name === "string") layout.title = source.title || source.name;
  if (source.characters != null) layout.characters = source.characters;
  else if (source.labels != null) layout.characters = source.labels;
  if (source.marks != null) layout.marks = source.marks;
  return layout;
}

function edgeList(source, orientation) {
  const edges = source.thickEdges;
  const fromEdges = edges && typeof edges === "object"
    ? edges[orientation] ?? edges[orientation === "h" ? "horizontal" : "vertical"]
    : null;
  const direct = orientation === "h" ? source.thickH : source.thickV;
  const list = direct ?? fromEdges ?? [];
  if (!Array.isArray(list)) throw new Error("Thick edges must be an array");
  return list;
}

function expandEdge(orientation, spec, width, height) {
  const span = orientation === "h" ? width : height;
  const limit = orientation === "h" ? height : width;
  if (typeof spec === "number" || (typeof spec === "string" && /^(0|[1-9]\d*)$/.test(spec))) {
    return fullLine(orientation, Number(spec), span, limit);
  }
  if (typeof spec === "string") return [spec];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Invalid thick edge");
  const after = asInt(spec.after ?? spec.afterRow ?? spec.afterCol);
  if (after == null) throw new Error("A thick edge needs after (1-based row or column)");
  const along = orientation === "h" ? (spec.c ?? spec.col ?? spec.cols) : (spec.r ?? spec.row ?? spec.rows);
  if (along == null) return fullLine(orientation, after, span, limit);
  const indexes = Array.isArray(along) ? along.map((value) => asInt(value)) : [asInt(along)];
  if (indexes.some((value) => value == null)) throw new Error("Invalid thick edge position");
  return partialLine(orientation, after, indexes, span, limit);
}

function fullLine(orientation, after, span, limit) {
  assertInternal(orientation, after, limit);
  const index = after - 1;
  return Array.from({ length: span }, (_, i) => orientation === "h" ? `h,${index},${i}` : `v,${i},${index}`);
}

function partialLine(orientation, after, indexes, span, limit) {
  assertInternal(orientation, after, limit);
  const index = after - 1;
  return indexes.map((i) => {
    if (i < 0 || i >= span) throw new Error("Thick edge is outside the grid");
    return orientation === "h" ? `h,${index},${i}` : `v,${i},${index}`;
  });
}

function assertInternal(orientation, after, limit) {
  if (after < 1 || after > limit - 1) {
    const edge = orientation === "h" ? "row" : "column";
    throw new Error(`Thick ${edge} ${after} is the outer border`);
  }
}

function crossedObjects(list, width, height, fallbackId) {
  if (!Array.isArray(list)) throw new Error("Crossed cells must be an array");
  return list.map((item) => {
    if (typeof item === "number" || (typeof item === "string" && /^(0|[1-9]\d*)$/.test(item))) {
      return objectAt(Number(item), width, height, fallbackId);
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid crossed cell");
    const id = item.id || item.type || fallbackId;
    if (item.index != null || item.i != null) return objectAt(asInt(item.index ?? item.i), width, height, id);
    const r = asInt(item.r ?? item.row);
    const c = asInt(item.c ?? item.col);
    if (r == null || c == null) throw new Error("Invalid crossed cell");
    if (r < 0 || c < 0 || r >= height || c >= width) throw new Error("Crossed cell is outside the grid");
    return { r, c, id: slug(id) };
  });
}

function objectAt(index, width, height, id) {
  if (index == null || index < 0 || index >= width * height) throw new Error(`Crossed cell ${index} is outside the grid`);
  return { r: Math.floor(index / width), c: index % width, id: slug(id) };
}

function boardFromHtml(raw) {
  const { css, html } = extractStyleAndScript(raw);
  const rules = thicknessRules(css);
  const root = parseElements(html);
  const cells = [];
  const lines = [];
  walk(root, (el) => {
    if (isCell(el)) cells.push(el);
    else if (isLineElement(el)) lines.push(el);
  });
  if (cells.length < 4) throw new Error("Paste a board that includes its cells");

  const { width, height } = findSize(root, cells);
  const hLines = lines.filter((el) => orientationOf(el) === "h");
  const vLines = lines.filter((el) => orientationOf(el) === "v");
  const walls = [
    ...collectWalls(hLines, "h", width, height, rules),
    ...collectWalls(vLines, "v", width, height, rules),
  ];
  const indexes = cells.map((cell) => cellIndexAttr(cell));
  const useAttr = indexes.every((value) => value != null);
  const base = useAttr && Math.min(...indexes) === 1 && !indexes.includes(0) ? 1 : 0;
  const objects = [];
  cells.forEach((cell, position) => {
    if (!isCrossed(cell)) return;
    const index = useAttr ? indexes[position] - base : position;
    const id = cell.attrs["data-obstacle"] || cell.attrs["data-object"] || cell.attrs["data-feature"] || "other";
    objects.push(objectAt(index, width, height, id));
  });

  const layout = { width, height, walls, objects };
  const title = readHtmlTitle(raw, root);
  if (title) layout.title = title;
  return layout;
}

function extractStyleAndScript(html) {
  const css = [];
  const stripped = html
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, body) => {
      css.push(body);
      return "";
    })
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  return { css, html: stripped };
}

function thicknessRules(cssText) {
  const rules = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(cssText))) {
    const found = match[2].match(/--line-thickness\s*:\s*([0-9.]+)\s*px?/i);
    if (!found) continue;
    const px = Number(found[1]);
    for (const selector of match[1].split(",")) {
      const classes = [...selector.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((item) => item[1]);
      if (classes.length) rules.push({ classes, px });
    }
  }
  return rules;
}

function parseElements(html) {
  const root = { name: "#root", attrs: {}, classList: [], style: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("<!--")) continue;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (closing) {
      while (stack.length > 1 && stack.at(-1).name !== name) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = /\/\s*$/.test(match[3]) || ["br", "img", "hr", "meta", "link", "input"].includes(name);
    const el = makeElement(name, match[3].replace(/\/\s*$/, ""), stack.at(-1));
    stack.at(-1).children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

function makeElement(name, attrText, parent) {
  const attrs = parseAttrs(attrText);
  const el = {
    name,
    attrs,
    classList: classTokens(attrs.class || ""),
    style: parseStyle(attrs.style || ""),
    children: [],
    parent,
  };
  return el;
}

function parseAttrs(text) {
  const attrs = {};
  const re = /([:@\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = re.exec(text))) {
    attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return attrs;
}

function parseStyle(text) {
  const style = {};
  for (const part of text.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    style[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return style;
}

function classTokens(value) {
  return value.split(/\s+/).filter(Boolean);
}

function walk(el, visit) {
  for (const child of el.children) {
    visit(child);
    walk(child, visit);
  }
}

function isCell(el) {
  if (!el.classList.includes("board-cell") && !el.classList.includes("board-cell-crossed")) return false;
  return !el.children.some((child) => isCell(child));
}

function isCrossed(el) {
  return el.classList.includes("board-cell-crossed") || el.classList.includes("crossed");
}

function isLineElement(el) {
  if (isCell(el) || !orientationOf(el)) return false;
  return !el.children.some((child) => isCell(child) || orientationOf(child));
}

function orientationOf(el) {
  return orientationFrom(el.classList)
    || orientationFrom(classTokens(`${el.attrs["data-orientation"] || ""} ${el.attrs["data-dir"] || ""} ${el.style["--orientation"] || ""} ${el.style["--dir"] || ""}`))
    || (el.parent ? orientationFrom(el.parent.classList) : null);
}

function orientationFrom(tokens) {
  const h = tokens.some((token) => /^(?:h-line|hline|line-h|board-line-h|h-lines|lines-h|horizontal|board-lines-h)(?:-|$)/.test(token));
  const v = tokens.some((token) => /^(?:v-line|vline|line-v|board-line-v|v-lines|lines-v|vertical|board-lines-v)(?:-|$)/.test(token));
  if (h && !v) return "h";
  if (v && !h) return "v";
  return null;
}

function findSize(root, cells) {
  let width = null;
  let height = null;
  walk(root, (el) => {
    const w = firstInt(el, ["data-cols", "data-columns", "data-width", "--cols", "--columns", "--board-columns", "--width"]);
    const h = firstInt(el, ["data-rows", "data-height", "--rows", "--board-rows", "--height"]);
    const square = firstInt(el, ["data-size", "--size", "--board-size"]);
    if (w != null && width == null) width = w;
    if (h != null && height == null) height = h;
    if (square != null && width == null && height == null) {
      width = square;
      height = square;
    }
  });

  const rows = [];
  walk(root, (el) => {
    if (!el.classList.includes("board-row")) return;
    if (el.children.some((child) => hasClass(child, "board-row"))) return;
    const rowCells = [];
    walk(el, (node) => {
      if (isCell(node)) rowCells.push(node);
    });
    if (rowCells.length) rows.push(rowCells);
  });
  if (rows.length >= 2) {
    const rowWidth = rows[0].length;
    if (rows.some((row) => row.length !== rowWidth)) throw new Error("Board rows have different lengths");
    if (width != null && width !== rowWidth) throw new Error(`Board width is ${width} but a row has ${rowWidth} cells`);
    if (height != null && height !== rows.length) throw new Error(`Board height is ${height} but there are ${rows.length} rows`);
    width = rowWidth;
    height = rows.length;
  }

  if (width != null && height == null && cells.length % width === 0) height = cells.length / width;
  if (height != null && width == null && cells.length % height === 0) width = cells.length / height;
  if (width == null && height == null) {
    const side = Math.sqrt(cells.length);
    if (Number.isInteger(side)) {
      width = side;
      height = side;
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("Board paste needs a width and height, or a square set of cells");
  }
  if (cells.length !== width * height) throw new Error(`Found ${cells.length} cells but the board is ${width}×${height}`);
  return { width, height };
}

function hasClass(el, token) {
  if (el.classList.includes(token)) return true;
  return el.children.some((child) => hasClass(child, token));
}

function collectWalls(lines, orientation, width, height, rules) {
  if (lines.length === 0) return [];
  const shape = gridShape(lines.length, orientation, width, height);
  const missing = lines.some((line) => positionWalls(line, orientation, width, height) == null);
  if (!shape && missing) {
    const label = orientation === "h" ? "horizontal" : "vertical";
    throw new Error(`Could not place ${lines.length} ${label} lines on a ${width}×${height} board`);
  }
  const walls = [];
  lines.forEach((line, index) => {
    if (!isThickLine(line, rules)) return;
    const explicit = positionWalls(line, orientation, width, height);
    if (explicit) walls.push(...explicit);
    else if (shape) walls.push(...wallKeysAt(index, shape, orientation, width, height));
  });
  return walls;
}

function gridShape(count, orientation, width, height) {
  if (orientation === "h") {
    if (count === (height + 1) * width) return { outer: true, per: width, full: false };
    if (count === height + 1) return { outer: true, per: 1, full: true };
    if (count === (height - 1) * width) return { outer: false, per: width, full: false };
    if (count === height - 1) return { outer: false, per: 1, full: true };
  } else {
    if (count === height * (width + 1)) return { outer: true, per: width + 1, full: false };
    if (count === width + 1) return { outer: true, per: 1, full: true };
    if (count === height * (width - 1)) return { outer: false, per: width - 1, full: false };
    if (count === width - 1) return { outer: false, per: 1, full: true };
  }
  return null;
}

function wallKeysAt(index, shape, orientation, width, height) {
  if (shape.full) {
    const limit = orientation === "h" ? height : width;
    if (shape.outer && (index === 0 || index === limit)) return [];
    const at = shape.outer ? index - 1 : index;
    const span = orientation === "h" ? width : height;
    return Array.from({ length: span }, (_, i) => orientation === "h" ? `h,${at},${i}` : `v,${i},${at}`);
  }
  const band = Math.floor(index / shape.per);
  const offset = index % shape.per;
  if (orientation === "h") {
    if (shape.outer && (band === 0 || band === height)) return [];
    return [`h,${shape.outer ? band - 1 : band},${offset}`];
  }
  if (shape.outer && (offset === 0 || offset === width)) return [];
  return [`v,${band},${shape.outer ? offset - 1 : offset}`];
}

function positionWalls(line, orientation, width, height) {
  const edge = line.attrs["data-edge"];
  if (typeof edge === "string" && /^(h|v),\d+,\d+$/.test(edge)) return [edge];

  const lineIndex = firstInt(line, ["data-line-index", "--line-index"]);
  const after = firstInt(line, orientation === "h" ? ["data-after-row", "--after-row"] : ["data-after-col", "--after-col"]);
  const raw = lineIndex != null ? lineIndex : after;
  if (raw == null) return null;
  const limit = orientation === "h" ? height : width;
  const span = orientation === "h" ? width : height;
  if (raw <= 0 || raw >= limit) return [];
  const index = raw - 1;
  const along = firstInt(line, orientation === "h" ? ["data-col", "data-c", "--col", "--c"] : ["data-row", "data-r", "--row", "--r"]);
  if (along == null) return Array.from({ length: span }, (_, i) => orientation === "h" ? `h,${index},${i}` : `v,${i},${index}`);
  if (along < 0 || along >= span) throw new Error("Thick edge is outside the grid");
  return [orientation === "h" ? `h,${index},${along}` : `v,${along},${index}`];
}

function isThickLine(line, rules) {
  const px = lineThickness(line, rules);
  return px != null && px >= THICK_PX;
}

function lineThickness(line, rules) {
  const inline = pxOf(line.style["--line-thickness"]);
  if (inline != null) return inline;
  let fromCss = null;
  for (const rule of rules) {
    if (rule.classes.every((name) => line.classList.includes(name))) fromCss = rule.px;
  }
  if (fromCss != null) return fromCss;
  if (line.classList.some((name) => name === "thick" || name === "is-thick" || name === "board-line-thick")) return 10;
  return null;
}

function pxOf(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([0-9.]+)\s*px?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function cellIndexAttr(cell) {
  const direct = firstInt(cell, ["data-index", "data-cell", "data-i"]);
  if (direct != null) return direct;
  const id = cell.attrs.id || "";
  const match = /^(?:cell|board-cell)-(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function readHtmlTitle(raw, root) {
  const titleTag = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleTag && titleTag[1].trim()) return decodeEntities(titleTag[1].trim());
  let found = null;
  walk(root, (el) => {
    if (found) return;
    const titled = el.attrs["data-title"] || el.attrs["data-name"];
    if (titled && titled.trim()) found = titled.trim();
  });
  return found;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function firstInt(el, keys) {
  for (const key of keys) {
    const raw = key.startsWith("--") ? el.style[key] : el.attrs[key];
    const n = asInt(raw);
    if (n != null) return n;
  }
  return null;
}

function asInt(raw) {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const match = String(raw).trim().match(/^-?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isInteger(n) ? n : null;
}

function requireDim(raw, label) {
  const n = asInt(raw);
  if (n == null) throw new Error(`${label} must be an integer from 2 to 20`);
  return n;
}

function slug(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "other";
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
}
