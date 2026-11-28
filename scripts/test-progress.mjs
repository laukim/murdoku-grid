import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalD1 } from "./local-d1.js";
import { handleLayoutsRequest } from "../worker/layouts-api.js";
import { issueSession, SESSION_COOKIE } from "../worker/session.js";
import worker from "../worker/index.js";

const SECRET = "test-session-secret-do-not-use-in-prod!!";
const KIM = "kim";
const OTHER = "other";
const MOCHO = "mocho";
const NEAR = "near";
const cookieCache = new Map();
const IDENTITIES = {
  [KIM]: { sub: "kim-sub", email: "kim.lau817@gmail.com" },
  [OTHER]: { sub: "other-sub", email: "other@example.com" },
  [MOCHO]: { sub: "mocho-sub", email: "mocholateio@gmail.com" },
  [NEAR]: { sub: "near-sub", email: "kim.lau817+extra@gmail.com" },
};

async function cookieHeader(key) {
  if (key == null) return "";
  const identity = IDENTITIES[key] || null;
  if (!identity) return `${SESSION_COOKIE}=${key}`;
  if (!cookieCache.has(key)) cookieCache.set(key, await issueSession(identity, SECRET));
  return `${SESSION_COOKIE}=${cookieCache.get(key)}`;
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
  return { DB: db, SESSION_SECRET: SECRET };
}

async function call(env, method, path, { key = KIM, body, deps } = {}) {
  const headers = new Headers();
  const cookie = await cookieHeader(key);
  if (cookie) headers.set("cookie", cookie);
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
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookies: typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [],
  };
}

function sample(overrides = {}) {
  return {
    title: "Manor study",
    width: 4,
    height: 3,
    characters: ["Ana", "Ben", "V"],
    walls: ["h,0,0", "v,1,2"],
    windows: ["h,0,1"],
    objects: [{ r: 0, c: 1, id: "table" }],
    marks: [{ r: 2, c: 0, confirmed: null, blocked: false, pencil: [0, 2] }],
    ...overrides,
  };
}

function layoutSnapshot(db, id) {
  return db.db.prepare(
    `SELECT id, user_sub, title, width, height, walls_json, windows_json, objects_json, marks_json, characters_json, created_at, updated_at
     FROM layouts WHERE id = ?`,
  ).get(id);
}

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="saveProgressBtn"/);
assert.match(html, /id="progressWrites" hidden/);
assert.match(html, /function canEditLayout\(\) \{\s*return signedIn && canUpdateAny;\s*\}/);
assert.match(html, /function canSaveProgress\(\) \{\s*return signedIn && !canUpdateAny;\s*\}/);
assert.match(html, /els\.layoutWrites\.hidden = !editable/);
assert.match(html, /els\.progressWrites\.hidden = !canSaveProgress\(\)/);
assert.match(html, /The shared puzzle layout stays unchanged/);
assert.match(html, /Open a saved puzzle before saving progress/);
assert.match(html, /Guests and unsigned visitors keep character letters/);
assert.match(html, /const PROGRESS_SAVE_MS = 800/);
const putFn = html.slice(html.indexOf("async function putSolveProgress"), html.indexOf("function disarmProgressAutosave"));
assert.match(putFn, /\/api\/layouts\/\$\{encodeURIComponent\(layoutId\)\}\/progress/);
assert.match(putFn, /body: \{ marks \}/);
assert.doesNotMatch(putFn, /walls|objects|title|windows/);
const keydown = html.slice(html.indexOf("document.addEventListener('keydown'"));
const signedKeys = keydown.indexOf("if (canEditLayout())");
const playKeys = keydown.indexOf("selectByKey");
assert.ok(signedKeys > 0 && playKeys > signedKeys, "editor letter keys run before guest character play");

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
assert.match(readme, /solve_progress/);
assert.match(readme, /\/api\/layouts\/:id\/progress/);
assert.match(readme, /Guest/);
assert.match(readme, /Unsigned/);
assert.match(readme, /Library editors/);

const migration = readFileSync(new URL("../migrations/0004_solve_progress.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS solve_progress/);
assert.match(migration, /PRIMARY KEY \(user_sub, layout_id\)/);
const progressSource = readFileSync(new URL("../worker/progress.js", import.meta.url), "utf8");
assert.match(progressSource, /CREATE TABLE IF NOT EXISTS solve_progress/);
assert.match(progressSource, /ON CONFLICT\(user_sub, layout_id\)/);
const layoutsSource = readFileSync(new URL("../worker/layouts.js", import.meta.url), "utf8");
assert.match(layoutsSource, /DELETE FROM solve_progress WHERE layout_id = \?/);
assert.doesNotMatch(layoutsSource, /UPDATE solve_progress/);

const db = new LocalD1();
const env = envWith(db);
const deps = { now: clock(), id: ids() };

const created = await call(env, "POST", "/api/layouts", { body: sample(), deps });
assert.equal(created.status, 201, JSON.stringify(created.body));
const id = created.body.layout.id;
const before = layoutSnapshot(db, id);
assert.equal(before.user_sub, "kim-sub");
assert.equal(before.marks_json, JSON.stringify(created.body.layout.marks));

{
  const unsigned = await call(env, "GET", `/api/layouts/${id}/progress`, { key: null });
  assert.equal(unsigned.status, 401);
  assert.equal(unsigned.body.error, "Sign in required");
  assert.equal(unsigned.cookies.length, 0);
  const unsignedWrite = await call(env, "PUT", `/api/layouts/${id}/progress`, {
    key: null,
    body: { marks: [] },
  });
  assert.equal(unsignedWrite.status, 401);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM solve_progress").get().n, 0);
}

{
  const empty = await call(env, "GET", `/api/layouts/${id}/progress`, { key: OTHER, deps });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { progress: null });
  assert.equal(empty.body.progress, null);
}

const guestMarks = [{ r: 0, c: 0, confirmed: null, blocked: false, pencil: [2, 0] }];
const saved = await call(env, "PUT", `/api/layouts/${id}/progress`, {
  key: OTHER,
  body: {
    marks: guestMarks,
    title: "Hijacked",
    walls: ["h,1,1"],
    windows: ["v,0,0"],
    objects: [{ r: 0, c: 0, id: "tree" }],
    characters: ["Z"],
    user_sub: "kim-sub",
  },
  deps,
});
assert.equal(saved.status, 200, JSON.stringify(saved.body));
assert.deepEqual(saved.body.progress.marks, [{ r: 0, c: 0, confirmed: null, blocked: false, pencil: [0, 2] }]);
assert.equal(saved.body.progress.updated_at, "2026-10-08T12:00:01.000Z");
assert.equal(saved.body.progress.user_sub, undefined);
assert.equal(saved.body.layout, undefined);
assert.deepEqual(layoutSnapshot(db, id), before);

const again = await call(env, "GET", `/api/layouts/${id}/progress`, { key: OTHER });
assert.deepEqual(again.body.progress.marks, saved.body.progress.marks);
const layoutStill = await call(env, "GET", `/api/layouts/${id}`, { key: null });
assert.deepEqual(layoutStill.body.layout.marks, created.body.layout.marks);
assert.equal(layoutStill.body.layout.title, "Manor study");
assert.deepEqual(layoutStill.body.layout.walls, ["h,0,0", "v,1,2"]);
assert.deepEqual(layoutStill.body.layout.objects, [{ r: 0, c: 1, id: "table" }]);

{
  const kimProgress = await call(env, "GET", `/api/layouts/${id}/progress`, { key: KIM });
  assert.deepEqual(kimProgress.body, { progress: null });
  const kimSave = await call(env, "PUT", `/api/layouts/${id}/progress`, {
    key: KIM,
    body: { marks: [{ r: 1, c: 1, confirmed: 1, blocked: false, pencil: [0] }] },
    deps,
  });
  assert.equal(kimSave.status, 200, JSON.stringify(kimSave.body));
  assert.deepEqual(kimSave.body.progress.marks, [{ r: 1, c: 1, confirmed: 1, blocked: false, pencil: [] }]);
  assert.deepEqual(layoutSnapshot(db, id), before);
  const otherStill = await call(env, "GET", `/api/layouts/${id}/progress`, { key: OTHER });
  assert.deepEqual(otherStill.body.progress.marks, saved.body.progress.marks);
}

{
  const replaced = await call(env, "PUT", `/api/layouts/${id}/progress`, {
    key: OTHER,
    body: { marks: [{ r: 0, c: 2, confirmed: null, blocked: true, pencil: [1] }] },
    deps,
  });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.deepEqual(replaced.body.progress.marks, [{ r: 0, c: 2, confirmed: null, blocked: true, pencil: [] }]);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM solve_progress WHERE user_sub = ? AND layout_id = ?").get("other-sub", id).n, 1);
  assert.deepEqual(layoutSnapshot(db, id), before);
}

{
  const cleared = await call(env, "PUT", `/api/layouts/${id}/progress`, {
    key: NEAR,
    body: { marks: [] },
    deps,
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.deepEqual(cleared.body.progress.marks, []);
  assert.ok(cleared.body.progress.updated_at);
  const readBack = await call(env, "GET", `/api/layouts/${id}/progress`, { key: NEAR });
  assert.deepEqual(readBack.body.progress.marks, []);
  const cannotUpdate = await call(env, "PUT", `/api/layouts/${id}`, {
    key: NEAR,
    body: sample({ title: "Taken by alias" }),
    deps,
  });
  assert.equal(cannotUpdate.status, 404);
  assert.equal(layoutSnapshot(db, id).title, "Manor study");
}

{
  const editorUpdate = await call(env, "PUT", `/api/layouts/${id}`, {
    key: MOCHO,
    body: sample({ title: "Manor study", objects: [{ r: 0, c: 1, id: "tree" }] }),
    deps,
  });
  assert.equal(editorUpdate.status, 200, JSON.stringify(editorUpdate.body));
  assert.deepEqual(editorUpdate.body.layout.objects, [{ r: 0, c: 1, id: "tree" }]);
  assert.equal(editorUpdate.body.layout.user_sub, undefined);
  assert.equal(layoutSnapshot(db, id).user_sub, "kim-sub");
  const guestAfterEdit = await call(env, "GET", `/api/layouts/${id}/progress`, { key: OTHER });
  assert.deepEqual(guestAfterEdit.body.progress.marks, [{ r: 0, c: 2, confirmed: null, blocked: true, pencil: [] }]);
  const sharedMarks = await call(env, "GET", `/api/layouts/${id}`, { key: OTHER });
  assert.deepEqual(sharedMarks.body.layout.marks, created.body.layout.marks);
  assert.equal(sharedMarks.body.layout.mine, undefined);
}

{
  const dropped = await call(env, "DELETE", `/api/layouts/${id}/progress`, { key: OTHER });
  assert.equal(dropped.status, 200);
  assert.deepEqual(dropped.body, { ok: true });
  const gone = await call(env, "GET", `/api/layouts/${id}/progress`, { key: OTHER });
  assert.deepEqual(gone.body, { progress: null });
  const kimKept = await call(env, "GET", `/api/layouts/${id}/progress`, { key: KIM });
  assert.equal(kimKept.body.progress.marks[0].confirmed, 1);
  const layoutKept = layoutSnapshot(db, id);
  assert.equal(layoutKept.title, "Manor study");
  assert.equal(layoutKept.user_sub, "kim-sub");
}

{
  const rowsBefore = db.db.prepare("SELECT COUNT(*) AS n FROM solve_progress WHERE layout_id = ?").get(id).n;
  assert.ok(rowsBefore >= 1);
  const otherDelete = await call(env, "DELETE", `/api/layouts/${id}`, { key: OTHER });
  assert.equal(otherDelete.status, 404);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM solve_progress WHERE layout_id = ?").get(id).n, rowsBefore);
  const removed = await call(env, "DELETE", `/api/layouts/${id}`, { key: KIM });
  assert.equal(removed.status, 200);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM solve_progress WHERE layout_id = ?").get(id).n, 0);
  const missing = await call(env, "GET", `/api/layouts/${id}/progress`, { key: OTHER });
  assert.equal(missing.status, 404);
  const missingWrite = await call(env, "PUT", `/api/layouts/${id}/progress`, {
    key: OTHER,
    body: { marks: [] },
    deps,
  });
  assert.equal(missingWrite.status, 404);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM solve_progress").get().n, 0);
}

{
  const fresh = await call(env, "POST", "/api/layouts", { body: sample({ title: "Progress checks" }), deps });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
  const freshId = fresh.body.layout.id;
  const untouched = layoutSnapshot(db, freshId);
  const cases = [
    {},
    { marks: { r: 0, c: 0 } },
    { marks: [{ r: 0, c: 0, confirmed: 9, blocked: false, pencil: [] }] },
    { marks: [{ r: 0, c: 0, confirmed: 0, blocked: true, pencil: [] }] },
    { marks: [{ r: 9, c: 0, confirmed: null, blocked: true, pencil: [] }] },
    { marks: [{ r: 0, c: 0, confirmed: null, blocked: false, pencil: [0, 0] }] },
  ];
  for (const body of cases) {
    const response = await call(env, "PUT", `/api/layouts/${freshId}/progress`, { key: OTHER, body, deps });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(layoutSnapshot(db, freshId), untouched);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM solve_progress WHERE layout_id = ?").get(freshId).n, 0);

  const badMethod = await call(env, "POST", `/api/layouts/${freshId}/progress`, { key: OTHER, body: { marks: [] } });
  assert.equal(badMethod.status, 405);
  const badPath = await call(env, "GET", `/api/layouts/${freshId}/progress/extra`, { key: OTHER });
  assert.equal(badPath.status, 404);
  const badId = await call(env, "GET", "/api/layouts/not-an-id/progress", { key: OTHER });
  assert.equal(badId.status, 404);
  const junk = await call(env, "PUT", `/api/layouts/${freshId}/progress`, { key: "nope-nope-nope", body: { marks: [] } });
  assert.equal(junk.status, 401);
  assert.equal(junk.cookies.length, 1);
  assert.match(junk.cookies[0], /Max-Age=0/);
  assert.deepEqual(layoutSnapshot(db, freshId), untouched);
}

{
  const routed = await worker.fetch(new Request(`https://murdoku-grid.test/api/layouts/${id}/progress`), env);
  assert.equal(routed.status, 401);
  const listed = await worker.fetch(new Request("https://murdoku-grid.test/api/layouts"), env);
  assert.equal(listed.status, 200);
  const payload = await listed.json();
  assert.equal(payload.layouts.some((layout) => layout.progress != null || layout.user_sub != null), false);
}

console.log("progress tests passed");
