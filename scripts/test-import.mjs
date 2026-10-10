import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importPlaygroundLayout, KNOWN_OBJECT_IDS, layoutInsertSql } from "../layout-import.js";
import { normalizeLayoutInput } from "../worker/layouts.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function expectImport(input, options) {
  const layout = importPlaygroundLayout(input, options);
  const normalized = normalizeLayoutInput(layout);
  assert.equal(normalized.ok, true, normalized.error || JSON.stringify(layout));
  assert.deepEqual(normalized.value, layout);
  return layout;
}

function expectReject(input, pattern) {
  assert.throws(() => importPlaygroundLayout(input), pattern);
}

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const catalog = page.slice(page.indexOf("const FURNITURE_ITEMS"), page.indexOf("const MAP_ITEMS"));
const pickerIds = [...catalog.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(pickerIds, KNOWN_OBJECT_IDS);
const obstacleBlock = page.slice(page.indexOf("const OBSTACLE_ITEMS"), page.indexOf("const MAP_ITEMS"));
for (const id of ["boulder", "rubble"]) {
  const start = obstacleBlock.indexOf(`id: '${id}'`);
  assert.ok(start >= 0, `${id} is an obstacle`);
  const next = obstacleBlock.indexOf("\n      {", start + 1);
  const entry = obstacleBlock.slice(start, next === -1 ? obstacleBlock.length : next);
  assert.equal(entry.includes("stretchable"), false, `${id} stays a single cell`);
  assert.match(entry, /category: 'obstacle'/);
}

const garden = JSON.parse(readFileSync(new URL("../examples/garden-path.json", import.meta.url), "utf8"));
{
  const layout = expectImport(garden);
  assert.equal(layout.title, "Garden path");
  assert.equal(layout.width, 4);
  assert.equal(layout.height, 3);
  assert.deepEqual(layout.characters, ["A", "B", "C", "V"]);
  assert.deepEqual(layout.walls, ["h,1,0", "h,1,1", "h,1,2", "v,0,1", "v,1,1", "v,2,2"]);
  assert.deepEqual(layout.objects, [{ r: 0, c: 2, id: "tree" }]);
  assert.deepEqual(layout.marks, []);
}

{
  const layout = expectImport({
    name: "Study",
    zones: [
      [1, 1, "2", "2"],
      [1, 1, 2, 2],
      [3, 3, 3, 2],
    ],
    walls: [
      { dir: "horizontal", r: 0, c: 0 },
      ["v", 0, 0],
      { from: [2, 2], to: [2, 3] },
    ],
    obstacles: [
      ["", "Tree", "", ""],
      ["-", "-", "-", "-"],
      [".", ".", ".", "."],
    ],
    objects: [{ row: 2, col: 0, type: "oil slick" }],
  });
  assert.equal(layout.title, "Study");
  assert.deepEqual(layout.walls, ["h,0,0", "h,1,0", "h,1,1", "h,1,2", "v,0,0", "v,0,1", "v,1,1", "v,2,2"]);
  assert.deepEqual(layout.objects, [
    { r: 0, c: 1, id: "tree" },
    { r: 2, c: 0, id: "oil-slick" },
  ]);
  assert.deepEqual(layout.characters, ["A", "B", "V"]);
}

{
  const layout = expectImport({
    title: "Segments",
    width: 4,
    height: 3,
    walls: ["v,0,1", { edge: "h", row: 1, col: 2 }, [[0, 2], [0, 3]]],
    features: [{ x: 1, y: 2, kind: "bookshelf" }],
    marks: [{ r: 0, c: 0, confirmed: "A", blocked: false, pencil: ["B", "V"] }],
  });
  assert.equal(layout.title, "Segments");
  assert.deepEqual(layout.walls, ["h,1,2", "v,0,1", "v,0,2"]);
  assert.deepEqual(layout.objects, [{ r: 2, c: 1, id: "bookshelf" }]);
  assert.deepEqual(layout.marks, [{ r: 0, c: 0, confirmed: 0, blocked: false, pencil: [] }]);
}

{
  const layout = expectImport({
    title: "Debris",
    width: 4,
    height: 3,
    obstacles: [
      { r: 0, c: 1, id: "boulder" },
      { r: 2, c: 3, type: "Rubble" },
    ],
  });
  assert.deepEqual(layout.objects, [
    { r: 0, c: 1, id: "boulder" },
    { r: 2, c: 3, id: "rubble" },
  ]);
  assert.match(layoutInsertSql(layout), /"id":"boulder"/);
  assert.match(layoutInsertSql(layout), /"id":"rubble"/);
}

{
  const layout = expectImport({
    width: 4,
    height: 2,
    rooms: [1, 1, 2, 2, 1, 1, 2, 2],
    characters: ["A", "B", "C", "V"],
    marks: [{ r: 1, c: 1, confirmed: null, blocked: false, pencil: [2, 0] }],
  }, { fallbackTitle: "Flat rooms" });
  assert.equal(layout.title, "Flat rooms");
  assert.deepEqual(layout.walls, ["v,0,1", "v,1,1"]);
  assert.deepEqual(layout.marks, [{ r: 1, c: 1, confirmed: null, blocked: false, pencil: [0, 2] }]);
}

{
  const layout = expectImport({
    layout: {
      title: "Wrapped",
      width: 3,
      height: 2,
      characters: ["Ann", "Bo", "V"],
      walls: ["h,0,1"],
      objects: [{ r: 1, c: 0, id: "plant" }, { r: 1, c: 0, id: "statue" }],
    },
  });
  assert.equal(layout.title, "Wrapped");
  assert.deepEqual(layout.objects, [{ r: 1, c: 0, id: "statue" }]);
  assert.deepEqual(layout.characters, ["Ann", "Bo", "V"]);
}

{
  const layout = expectImport({
    width: "5",
    height: "2",
    rooms: ["living room,living room,study,study,study", "living room,living room,study,study,study"],
  });
  assert.equal(layout.width, 5);
  assert.deepEqual(layout.walls, ["v,0,1", "v,1,1"]);
}

expectReject({ width: 1, height: 3, walls: [] }, /Width must be an integer from 2 to 20/);
expectReject({ rooms: ["AB", "ABC"] }, /row 2/);
expectReject({ width: 3, height: 2, walls: ["h,9,0"] }, /outside the grid/);
expectReject({ width: 3, height: 2, walls: [{ from: [0, 0], to: [1, 1] }] }, /adjacent/);
expectReject({ width: 3, height: 2, objects: [{ r: 0, c: 0, id: "Not an id!!" }] }, /Invalid object id/);
expectReject({ rooms: ["AB", "AB"], width: 3 }, /width is 3/);
expectReject({}, /Width must be an integer/);

{
  const layout = expectImport({
    title: "Register",
    width: 2,
    height: 2,
    walls: ["h,0,0", "h,0,1"],
    windows: ["h,0,1"],
    objects: [{ r: 0, c: 0, type: "cashRegister" }, { r: 0, c: 1, id: "register" }],
  });
  assert.deepEqual(layout.walls, ["h,0,0"]);
  assert.deepEqual(layout.windows, ["h,0,1"]);
  assert.deepEqual(layout.objects, [
    { r: 0, c: 0, id: "cash-register" },
    { r: 0, c: 1, id: "cash-register" },
  ]);
}

{
  const layout = expectImport({ title: "O'Hare", width: 2, height: 2, walls: [] });
  const sql = layoutInsertSql(layout, { id: "fixed-id", now: "2026-10-08T12:00:00.000Z" });
  assert.match(sql, /O''Hare/);
  assert.match(sql, /'fixed-id'/);
  assert.match(sql, /'2026-10-08T12:00:00.000Z'/);
  assert.match(sql, /INSERT INTO layouts/);
}

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="importLayoutBtn"/);
assert.match(html, /layout-import\.js/);

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
  const printed = await runCli(["examples/garden-path.json"]);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(JSON.parse(printed.stdout).title, "Garden path");

  const sql = await runCli(["examples/garden-path.json", "--sql", "--title", "Renamed path"]);
  assert.equal(sql.status, 0, sql.stderr);
  assert.match(sql.stdout, /Renamed path/);

  const remote = await runCli(["https://example.test/layout.json"]);
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /local JSON file/);
}

{
  const posted = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      posted.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ layout: { id: "posted-1", title: posted[0].body.title } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const result = await runCli([
    "examples/garden-path.json",
    "--post",
    `http://127.0.0.1:${port}`,
    "--key",
    "cli-key",
  ]);
  server.close();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, "/api/layouts");
  assert.equal(posted[0].authorization, "Bearer cli-key");
  assert.equal(posted[0].body.title, "Garden path");
  assert.equal(posted[0].body.objects[0].id, "tree");
  assert.equal(JSON.parse(result.stdout).layout.id, "posted-1");
}

console.log("layout import tests passed");
