import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importBoardSource } from "../layout-import.js";
import { normalizeLayoutInput } from "../worker/layouts.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const CROSSED = [5, 18, 23, 26, 29, 30];
const WALLS = [
  "h,2,0", "h,2,1", "h,2,2", "h,2,3", "h,2,4", "h,2,5",
  "v,0,2", "v,1,2", "v,2,2", "v,3,2", "v,4,2", "v,5,2",
];

function expectLayout(text, options) {
  const layout = importBoardSource(text, options);
  const normalized = normalizeLayoutInput(layout);
  assert.equal(normalized.ok, true, normalized.error || JSON.stringify(layout));
  assert.deepEqual(normalized.value, layout);
  return layout;
}

function objectsFor(indexes, id = "other") {
  return indexes
    .map((index) => ({ r: Math.floor(index / 6), c: index % 6, id }))
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

function roomSizes(width, height, walls) {
  const wall = new Set(walls);
  const seen = new Set();
  const sizes = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const start = `${r},${c}`;
      if (seen.has(start)) continue;
      let size = 0;
      const stack = [[r, c]];
      seen.add(start);
      while (stack.length) {
        const [y, x] = stack.pop();
        size++;
        const next = [];
        if (x + 1 < width && !wall.has(`v,${y},${x}`)) next.push([y, x + 1]);
        if (x > 0 && !wall.has(`v,${y},${x - 1}`)) next.push([y, x - 1]);
        if (y + 1 < height && !wall.has(`h,${y},${x}`)) next.push([y + 1, x]);
        if (y > 0 && !wall.has(`h,${y - 1},${x}`)) next.push([y - 1, x]);
        for (const [ny, nx] of next) {
          const key = `${ny},${nx}`;
          if (!seen.has(key)) {
            seen.add(key);
            stack.push([ny, nx]);
          }
        }
      }
      sizes.push(size);
    }
  }
  return sizes.sort((a, b) => a - b);
}

function cellHtml(index, extra = "") {
  const crossed = CROSSED.includes(index) ? " board-cell-crossed" : "";
  return `<div class="board-cell${crossed}" data-index="${index}"${extra}></div>`;
}

function perSegmentHtml() {
  const h = [];
  for (let line = 0; line <= 6; line++) {
    for (let c = 0; c < 6; c++) {
      const thick = line === 0 || line === 6 || line === 3;
      h.push(`<div class="h-line" style="--line-thickness: ${thick ? 10 : 2}px"></div>`);
    }
  }
  const v = [];
  for (let r = 0; r < 6; r++) {
    for (let edge = 0; edge <= 6; edge++) {
      const thick = edge === 0 || edge === 6 || edge === 3;
      v.push(`<div class="v-line" style="--line-thickness: ${thick ? 10 : 2}px"></div>`);
    }
  }
  const cells = Array.from({ length: 36 }, (_, index) => cellHtml(index)).join("");
  return `<div class="board" data-cols="6" data-rows="6" data-title="Four rooms">
    <div class="h-lines">${h.join("")}</div>
    <div class="v-lines">${v.join("")}</div>
    <div class="board-cells">${cells}</div>
  </div>`;
}

function fullLineHtml() {
  const h = [];
  const v = [];
  for (let line = 0; line <= 6; line++) {
    const hThick = line === 0 || line === 6 || line === 3;
    const vThick = line === 0 || line === 6 || line === 3;
    h.push(`<div class="horizontal-line" style="--line-thickness:${hThick ? "10px" : "2px"}"></div>`);
    v.push(`<div class="vertical-line" style="--line-thickness:${vThick ? "10px" : "2px"}"></div>`);
  }
  const cells = Array.from({ length: 36 }, (_, index) => cellHtml(index)).join("");
  return `<div class="board" style="--cols: 6; --rows: 6">${h.join("")}${v.join("")}${cells}</div>`;
}

const compact = readFileSync(new URL("../examples/four-rooms.json", import.meta.url), "utf8");
{
  const layout = expectLayout(compact);
  assert.equal(layout.title, "Four rooms");
  assert.equal(layout.width, 6);
  assert.equal(layout.height, 6);
  assert.deepEqual(layout.walls, WALLS);
  assert.deepEqual(layout.objects, objectsFor(CROSSED));
  assert.deepEqual(roomSizes(6, 6, layout.walls), [9, 9, 9, 9]);
}

{
  const fromSegments = expectLayout(perSegmentHtml());
  assert.equal(fromSegments.title, "Four rooms");
  assert.deepEqual(fromSegments.walls, WALLS);
  assert.deepEqual(fromSegments.objects, objectsFor(CROSSED));
}

{
  const fromLines = expectLayout(fullLineHtml(), { fallbackTitle: "Line board" });
  assert.equal(fromLines.title, "Line board");
  assert.deepEqual(fromLines.walls, WALLS);
  assert.deepEqual(fromLines.objects, objectsFor(CROSSED));
}

{
  const cells = Array.from({ length: 36 }, (_, index) => {
    if (index === 5) return `<div class="board-cell board-cell-crossed" data-object="tree"></div>`;
    return `<div class="board-cell"></div>`;
  }).join("");
  const html = `<style>
    .h-line { --line-thickness: 2px; }
    .h-line.thick { --line-thickness: 10px; }
  </style>
  <div class="board" data-cols="6" data-rows="6">
    <div class="h-line thick" data-after-row="3" data-col="4"></div>
    <div class="v-line" data-after-col="3" style="--line-thickness: 10px"></div>
    <div class="h-line" data-after-row="1"></div>
    ${cells}
  </div>`;
  const layout = expectLayout(html, { fallbackTitle: "Partial" });
  assert.equal(layout.title, "Partial");
  assert.ok(layout.walls.includes("h,2,4"));
  assert.ok(layout.walls.includes("v,0,2") && layout.walls.includes("v,5,2"));
  assert.equal(layout.walls.includes("h,0,0"), false);
  assert.deepEqual(layout.objects, [{ r: 0, c: 5, id: "tree" }]);
}

{
  const garden = readFileSync(new URL("../examples/garden-path.json", import.meta.url), "utf8");
  const layout = expectLayout(garden);
  assert.equal(layout.title, "Garden path");
  assert.equal(layout.objects[0].id, "tree");
}

function playgroundShellHtml() {
  const edges = [];
  for (let row = 0; row <= 6; row++) {
    for (let col = 0; col < 6; col++) {
      const fixed = row === 0 || row === 6;
      const thick = fixed || row === 3;
      edges.push(
        `<button type="button" data-testid="edge-h-${row}-${col}" class="board-edge board-edge-horizontal${fixed ? " board-edge-fixed" : ""}" style="--line-thickness:${thick ? 10 : 3}px"></button>`,
      );
    }
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col <= 6; col++) {
      const fixed = col === 0 || col === 6;
      const thick = fixed || col === 3;
      edges.push(
        `<button type="button" data-testid="edge-v-${row}-${col}" class="board-edge board-edge-vertical${fixed ? " board-edge-fixed" : ""}" style="--line-thickness:${thick ? 10 : 3}px"></button>`,
      );
    }
  }
  const cells = Array.from({ length: 36 }, (_, index) => {
    if (index === 5) {
      return `<button type="button" class="board-cell board-cell-special-crossed"></button>`;
    }
    return `<button type="button" class="board-cell"></button>`;
  }).join("");
  return `<div class="board-shell" data-cols="6" data-rows="6" data-title="Vol1 #2">
    <div class="board-edges">${edges.join("")}</div>
    <div class="board-object board-object-window" style="left:120px;top:270px;width:60px;height:60px;transform:rotate(90deg)"></div>
    <div class="board-object board-object-window" data-edge="v,0,1"></div>
    <div class="board-cells">${cells}</div>
  </div>`;
}

{
  const fromPlayground = expectLayout(playgroundShellHtml());
  assert.equal(fromPlayground.title, "Vol1 #2");
  const expectedWalls = WALLS.filter((key) => key !== "h,2,1");
  assert.deepEqual(fromPlayground.walls, expectedWalls);
  assert.deepEqual(fromPlayground.windows, ["h,2,1", "v,0,1"]);
  assert.deepEqual(fromPlayground.objects, [{ r: 0, c: 5, id: "other" }]);
  assert.equal(fromPlayground.walls.includes("h,0,0"), false);
  assert.equal(fromPlayground.walls.includes("v,0,0"), false);
}

assert.throws(
  () => importBoardSource(JSON.stringify({ width: 6, height: 6, thickH: [6], crossed: [] })),
  /outer border/,
);
assert.throws(() => importBoardSource("   "), /Paste a board/);
assert.throws(
  () => importBoardSource(JSON.stringify({ width: 6, height: 6, crossed: [36] })),
  /outside the grid/,
);

const htmlPage = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(htmlPage, /id="boardPaste"/);
assert.match(htmlPage, /id="convertPasteBtn"/);
assert.match(htmlPage, /board-cell-crossed/);
assert.match(htmlPage, /id: 'cash-register'/);
assert.match(htmlPage, /id="mapLegend"/);
assert.match(htmlPage, /map-legend-item/);
assert.match(htmlPage, /if \(!canEditLayout\(\)\) return layout\.title/);

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/import-layout.mjs", ...args], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

{
  const printed = await runCli(["examples/four-rooms.json"]);
  assert.equal(printed.status, 0, printed.stderr);
  const layout = JSON.parse(printed.stdout);
  assert.deepEqual(layout.walls, WALLS);
  assert.equal(layout.objects.length, 6);
  assert.ok(layout.objects.every((item) => item.id === "other"));
}

console.log("board paste tests passed");
