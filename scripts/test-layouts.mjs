import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalD1 } from "./local-d1.js";
import { SCHEMA_SQL } from "../worker/schema.js";
import { handleLayoutsRequest } from "../worker/layouts-api.js";
import worker from "../worker/index.js";

const KIM = "kim-token";
const OTHER = "other-token";

async function verify(token) {
  if (token === KIM) return { sub: "kim-sub", email: "kim.lau817@gmail.com" };
  if (token === OTHER) return { sub: "other-sub", email: "other@example.com" };
  throw new Error("bad token");
}

function clock(start = "2026-10-08T12:00:00.000Z") {
  let n = 0;
  const base = Date.parse(start);
  return () => new Date(base + n++ * 1000).toISOString();
}

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function envWith(db) {
  return { DB: db };
}

async function call(env, method, path, { key = KIM, body, deps } = {}) {
  const headers = new Headers();
  if (key != null) headers.set("authorization", `Bearer ${key}`);
  let payload;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  const request = new Request(`https://murdoku-grid.test${path}`, {
    method,
    headers,
    body: payload,
  });
  const response = await handleLayoutsRequest(request, env, { verify, ...deps });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function sample(overrides = {}) {
  return {
    title: "Manor study",
    width: 4,
    height: 3,
    characters: ["Ana", "Ben", "V"],
    walls: ["h,0,0", "v,1,2"],
    objects: [{ r: 0, c: 1, id: "table" }],
    marks: [{ r: 2, c: 0, confirmed: null, blocked: false, pencil: [0, 2] }],
    ...overrides,
  };
}

const migration = readFileSync(new URL("../migrations/0001_layouts.sql", import.meta.url), "utf8");
assert.equal(migration, SCHEMA_SQL);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
for (const id of ["createBtn", "boardPaste", "convertPasteBtn", "importLayoutBtn", "importLayoutFile", "saveLayoutBtn", "updateLayoutBtn", "refreshLayoutsBtn", "layoutList", "signInBtn", "signOutBtn", "accountEmail", "furniturePicker", "obstaclePicker"]) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.doesNotMatch(html, /id="layoutsPanel" hidden/);
assert.match(html, /id="layoutWrites" hidden/);
assert.doesNotMatch(html, /id="layoutSelect"/);
assert.doesNotMatch(html, /id="accessKey"/);
assert.doesNotMatch(html, /Sign in to see saved layouts/);
assert.match(html, /Sign in with Google/);
const layoutsSource = readFileSync(new URL("../worker/layouts.js", import.meta.url), "utf8");
assert.doesNotMatch(layoutsSource, /LIMIT\s+\d+/);
assert.match(html, /data-mode="x"/);
assert.match(html, /data-mode="erase"/);
assert.match(html, /Room walls/);
assert.match(html, /class="page-columns"/);
assert.match(html, /function boardHeightBudget/);
assert.match(html, /viewportBudget/);
assert.match(html, /id="layoutTools" hidden/);
assert.match(html, /body class="view-only"/);
assert.match(html, /function canEditLayout/);
assert.match(html, /id="setupPanel" hidden/);
assert.match(html, /id="importPanel" hidden/);
assert.match(html, /els.setupPanel.hidden = !editable/);
assert.match(html, /els.importPanel.hidden = !editable/);
assert.match(html, /Open any saved puzzle to view the board/);
assert.match(html, /Sign in with Google to open a board/);
assert.doesNotMatch(html, /keep editing walls, rooms, and objects/);
assert.doesNotMatch(html, /Expected \$\{n\} labels/);

const db = new LocalD1();
const env = envWith(db);
const deps = { now: clock(), id: ids() };

{
  const noKey = await call(env, "GET", "/api/layouts", { key: null });
  assert.equal(noKey.status, 200);
  assert.deepEqual(noKey.body.layouts, []);
  const badKey = await call(env, "GET", "/api/layouts", { key: "nope-nope-nope" });
  assert.equal(badKey.status, 200);
  assert.deepEqual(badKey.body.layouts, []);
  const noWrite = await call(env, "POST", "/api/layouts", { key: null, body: sample(), deps });
  assert.equal(noWrite.status, 401);
  assert.equal(noWrite.body.error, "Sign in required");
  const badWrite = await call(env, "PUT", "/api/layouts/00000000-0000-4000-8000-000000000099", { key: "nope-nope-nope", body: sample() });
  assert.equal(badWrite.status, 401);
}

{
  const empty = await call(env, "GET", "/api/layouts", { deps });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.layouts, []);
}

{
  const created = await call(env, "POST", "/api/layouts", { body: sample(), deps });
  assert.equal(created.status, 201);
  assert.equal(created.body.layout.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(created.body.layout.created_at, "2026-10-08T12:00:00.000Z");
  assert.deepEqual(created.body.layout.walls, ["h,0,0", "v,1,2"]);
  assert.deepEqual(created.body.layout.objects, [{ r: 0, c: 1, id: "table" }]);
  assert.equal(created.body.layout.marks[0].pencil[0], 0);

  const roomOnly = await call(env, "POST", "/api/layouts", {
    body: sample({ title: "Rooms only", objects: undefined, marks: undefined }),
    deps,
  });
  assert.equal(roomOnly.status, 201);
  assert.deepEqual(roomOnly.body.layout.objects, []);
  assert.deepEqual(roomOnly.body.layout.marks, []);

  const listed = await call(env, "GET", "/api/layouts", { deps });
  assert.equal(listed.body.layouts.length, 2);
  assert.equal(listed.body.layouts[0].title, "Rooms only");
  assert.equal(listed.body.layouts[0].walls, undefined);
  assert.equal(listed.body.layouts[1].width, 4);
  assert.equal(listed.body.layouts[1].height, 3);

  const fetched = await call(env, "GET", "/api/layouts/00000000-0000-4000-8000-000000000001", { deps });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.layout.title, "Manor study");

  const updated = await call(env, "PUT", "/api/layouts/00000000-0000-4000-8000-000000000001", {
    body: sample({
      title: "Manor study",
      objects: [{ r: 0, c: 1, id: "table" }, { r: 1, c: 1, id: "tree" }],
    }),
    deps,
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.layout.walls, ["h,0,0", "v,1,2"]);
  assert.deepEqual(updated.body.layout.objects, [
    { r: 0, c: 1, id: "table" },
    { r: 1, c: 1, id: "tree" },
  ]);
  assert.equal(updated.body.layout.created_at, "2026-10-08T12:00:00.000Z");
  assert.notEqual(updated.body.layout.updated_at, updated.body.layout.created_at);

  const after = await call(env, "GET", "/api/layouts", { deps });
  assert.equal(after.body.layouts[0].id, "00000000-0000-4000-8000-000000000001");

  const removed = await call(env, "DELETE", "/api/layouts/00000000-0000-4000-8000-000000000002", { deps });
  assert.equal(removed.status, 200);
  const gone = await call(env, "GET", "/api/layouts/00000000-0000-4000-8000-000000000002", { deps });
  assert.equal(gone.status, 404);
}

{
  const cases = [
    sample({ title: "  " }),
    sample({ width: 1, height: 3 }),
    sample({ walls: ["h,9,0"] }),
    sample({ walls: ["wall"] }),
    sample({ objects: [{ r: 0, c: 1, id: "Tree" }] }),
    sample({ marks: [{ r: 0, c: 0, confirmed: 9, blocked: false, pencil: [] }] }),
    sample({ marks: [{ r: 0, c: 0, confirmed: 0, blocked: true, pencil: [] }] }),
    sample({ characters: [] }),
  ];
  for (const body of cases) {
    const response = await call(env, "POST", "/api/layouts", { body, deps });
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  const lastWins = await call(env, "POST", "/api/layouts", {
    body: sample({
      objects: [{ r: 0, c: 0, id: "plant" }, { r: 0, c: 0, id: "statue" }],
    }),
    deps,
  });
  assert.equal(lastWins.status, 201);
  assert.deepEqual(lastWins.body.layout.objects, [{ r: 0, c: 0, id: "statue" }]);
}

{
  const missing = await call(env, "PUT", "/api/layouts/00000000-0000-4000-8000-000000000099", { body: sample(), deps });
  assert.equal(missing.status, 404);
  const badMethod = await call(env, "PATCH", "/api/layouts", { deps });
  assert.equal(badMethod.status, 405);
  const badPath = await call(env, "GET", "/api/layouts/not-an-id", { deps });
  assert.equal(badPath.status, 404);
  const invalid = await call(env, "POST", "/api/layouts", { body: "{", deps });
  assert.equal(invalid.status, 400);
}

{
  const other = new Request("https://murdoku-grid.test/", { method: "GET" });
  const response = await worker.fetch(other, env);
  assert.equal(response.status, 404);
  const api = await worker.fetch(new Request("https://murdoku-grid.test/api/layouts"), env);
  assert.equal(api.status, 200);
  const listed = await api.json();
  assert.ok(Array.isArray(listed.layouts));
  assert.equal(listed.layouts.some((layout) => layout.user_sub != null), false);
}

{
  const owned = await call(env, "POST", "/api/layouts", {
    body: { ...sample(), title: "Kim only", user_sub: "other-sub" },
    deps,
  });
  assert.equal(owned.status, 201);
  assert.equal(owned.body.layout.mine, true);
  assert.equal(owned.body.layout.user_sub, undefined);
  const kimList = await call(env, "GET", "/api/layouts", { deps });
  const kimItem = kimList.body.layouts.find((layout) => layout.id === owned.body.layout.id);
  assert.equal(kimItem.mine, true);
  assert.equal(kimItem.user_sub, undefined);
  const anonList = await call(env, "GET", "/api/layouts", { key: null });
  const anonItem = anonList.body.layouts.find((layout) => layout.id === owned.body.layout.id);
  assert.ok(anonItem);
  assert.equal(anonItem.mine, undefined);
  assert.equal(anonItem.title, "Kim only");
  const otherList = await call(env, "GET", "/api/layouts", { key: OTHER, deps });
  const otherItem = otherList.body.layouts.find((layout) => layout.id === owned.body.layout.id);
  assert.ok(otherItem);
  assert.equal(otherItem.mine, undefined);
  const otherRead = await call(env, "GET", `/api/layouts/${owned.body.layout.id}`, { key: null });
  assert.equal(otherRead.status, 200);
  assert.equal(otherRead.body.layout.title, "Kim only");
  assert.equal(otherRead.body.layout.mine, undefined);
  const otherWrite = await call(env, "PUT", `/api/layouts/${owned.body.layout.id}`, {
    key: OTHER,
    body: sample({ title: "Taken" }),
    deps,
  });
  assert.equal(otherWrite.status, 404);
  const otherDelete = await call(env, "DELETE", `/api/layouts/${owned.body.layout.id}`, { key: OTHER, deps });
  assert.equal(otherDelete.status, 404);
  const stillThere = await call(env, "GET", `/api/layouts/${owned.body.layout.id}`, { deps });
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.body.layout.title, "Kim only");
  const row = db.db.prepare("SELECT user_sub FROM layouts WHERE id = ?").get(owned.body.layout.id);
  assert.equal(row.user_sub, "kim-sub");
}

{
  const before = db.db.prepare("SELECT COUNT(*) AS n FROM layouts").get().n;
  for (let i = 0; i < 8; i++) {
    const created = await call(env, "POST", "/api/layouts", {
      body: sample({ title: `Batch ${i}` }),
      deps,
    });
    assert.equal(created.status, 201);
  }
  const listed = await call(env, "GET", "/api/layouts", { deps });
  const stored = db.db.prepare("SELECT COUNT(*) AS n FROM layouts").get().n;
  assert.equal(stored, before + 8);
  assert.equal(listed.body.layouts.length, stored);
  assert.equal(listed.body.layouts.filter((layout) => layout.title.startsWith("Batch ")).length, 8);
}

{
  for (const title of ["Vol1 #11", "Vol1 #2", "Notes", "Vol1 #5"]) {
    const created = await call(env, "POST", "/api/layouts", { body: sample({ title }), deps });
    assert.equal(created.status, 201, created.body?.error);
  }
  const listed = await call(env, "GET", "/api/layouts", { deps });
  const titles = listed.body.layouts
    .map((layout) => layout.title)
    .filter((title) => title.startsWith("Vol1 #") || title === "Notes");
  assert.deepEqual(titles, ["Vol1 #2", "Vol1 #5", "Vol1 #11", "Notes"]);

  const windowed = await call(env, "POST", "/api/layouts", {
    body: sample({
      title: "Window study",
      walls: ["h,0,0", "h,0,1", "v,1,2"],
      windows: ["h,0,1"],
      objects: [{ r: 0, c: 0, id: "cash-register" }],
    }),
    deps,
  });
  assert.equal(windowed.status, 201, windowed.body?.error);
  assert.deepEqual(windowed.body.layout.walls, ["h,0,0", "v,1,2"]);
  assert.deepEqual(windowed.body.layout.windows, ["h,0,1"]);
  assert.deepEqual(windowed.body.layout.objects, [{ r: 0, c: 0, id: "cash-register" }]);
  const again = await call(env, "GET", `/api/layouts/${windowed.body.layout.id}`, { deps });
  assert.deepEqual(again.body.layout.windows, ["h,0,1"]);

  const badWindow = await call(env, "POST", "/api/layouts", {
    body: sample({ title: "Bad window", windows: ["pane"] }),
    deps,
  });
  assert.equal(badWindow.status, 400);
}

console.log("layouts api tests passed");
