import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalD1 } from "./local-d1.js";
import { SCHEMA_SQL } from "../worker/schema.js";
import { handleLayoutsRequest } from "../worker/layouts-api.js";
import worker from "../worker/index.js";

const KEY = "test-key-123456";

function clock(start = "2026-10-08T12:00:00.000Z") {
  let n = 0;
  const base = Date.parse(start);
  return () => new Date(base + n++ * 1000).toISOString();
}

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function envWith(db, key = KEY) {
  return { DB: db, LAYOUT_KEY: key };
}

async function call(env, method, path, { key = KEY, body, deps } = {}) {
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
  const response = await handleLayoutsRequest(request, env, deps);
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
for (const id of ["createBtn", "boardPaste", "convertPasteBtn", "importLayoutBtn", "importLayoutFile", "saveLayoutBtn", "updateLayoutBtn", "loadLayoutBtn", "deleteLayoutBtn", "layoutSelect", "accessKey", "furniturePicker", "obstaclePicker"]) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(html, /data-mode="x"/);
assert.match(html, /data-mode="erase"/);
assert.match(html, /Room walls/);

const db = new LocalD1();
const env = envWith(db);
const deps = { now: clock(), id: ids() };

{
  const missing = await call(envWith(db, ""), "GET", "/api/layouts", { key: null });
  assert.equal(missing.status, 503);
  const noKey = await call(env, "GET", "/api/layouts", { key: null });
  assert.equal(noKey.status, 401);
  const badKey = await call(env, "GET", "/api/layouts", { key: "nope-nope-nope" });
  assert.equal(badKey.status, 401);
  assert.equal(badKey.body.error, "Unauthorized");
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
  const api = await worker.fetch(new Request("https://murdoku-grid.test/api/layouts", {
    headers: { authorization: `Bearer ${KEY}` },
  }), env);
  assert.equal(api.status, 200);
}

console.log("layouts api tests passed");
