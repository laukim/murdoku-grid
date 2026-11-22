import {
  deleteLayoutById,
  ensureSchema,
  getPublicLayout,
  insertLayout,
  listLayouts,
  normalizeLayoutInput,
  updateLayout,
} from "./layouts.js";
import { clearSessionCookie, readSessionToken, sessionSecret, verifySession } from "./session.js";

const MAX_BODY = 200_000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleLayoutsRequest(request, env, deps = {}) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "layouts" || parts.length > 3) {
    return json({ error: "Not found" }, 404);
  }
  const id = parts[2] || null;
  if (id && !ID_RE.test(id)) return json({ error: "Not found" }, 404);

  const write = request.method === "POST" || request.method === "PUT" || request.method === "DELETE";
  const viewer = await readViewer(request, env);
  if (write && !viewer.sub) {
    return json({ error: "Sign in required" }, 401, clearHeader(viewer));
  }

  try {
    await ensureSchema(env.DB);
    const extra = clearHeader(viewer);
    if (!id) {
      if (request.method === "GET") return json({ layouts: await listLayouts(env.DB, viewer.sub) }, 200, extra);
      if (request.method === "POST") return createLayout(request, env, viewer.sub, deps);
      return json({ error: "Method not allowed" }, 405);
    }
    if (request.method === "GET") return readLayout(env, viewer.sub, id, extra);
    if (request.method === "PUT") return replaceLayout(request, env, viewer.sub, id, deps);
    if (request.method === "DELETE") return removeLayout(env, viewer.sub, id);
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("layouts request failed", err instanceof Error ? err.message : "");
    return json({ error: "Could not access layouts" }, 500);
  }
}

async function createLayout(request, env, userSub, deps) {
  const body = await readJson(request);
  if (body === undefined) return json({ error: "Layout is too large" }, 413);
  if (body === null) return json({ error: "Invalid JSON" }, 400);
  const parsed = normalizeLayoutInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const id = (deps.id || (() => crypto.randomUUID()))();
  const now = (deps.now || (() => new Date().toISOString()))();
  const layout = await insertLayout(env.DB, userSub, id, parsed.value, now);
  return json({ layout }, 201);
}

async function readLayout(env, userSub, id, extra) {
  const layout = await getPublicLayout(env.DB, id, userSub);
  if (!layout) return json({ error: "Not found" }, 404, extra);
  return json({ layout }, 200, extra);
}

async function replaceLayout(request, env, userSub, id, deps) {
  const body = await readJson(request);
  if (body === undefined) return json({ error: "Layout is too large" }, 413);
  if (body === null) return json({ error: "Invalid JSON" }, 400);
  const parsed = normalizeLayoutInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const now = (deps.now || (() => new Date().toISOString()))();
  const layout = await updateLayout(env.DB, userSub, id, parsed.value, now);
  if (!layout) return json({ error: "Not found" }, 404);
  return json({ layout });
}

async function removeLayout(env, userSub, id) {
  const removed = await deleteLayoutById(env.DB, userSub, id);
  if (!removed) return json({ error: "Not found" }, 404);
  return json({ ok: true });
}

async function readViewer(request, env) {
  const token = readSessionToken(request);
  if (!token) return { sub: "", invalid: false };
  const identity = await verifySession(token, sessionSecret(env));
  if (!identity?.sub) return { sub: "", invalid: true };
  return { sub: identity.sub, invalid: false };
}

function clearHeader(viewer) {
  return viewer.invalid ? { "set-cookie": clearSessionCookie() } : undefined;
}

async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) return undefined;
  const text = await request.text();
  if (text.length > MAX_BODY) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function json(body, status = 200, extra) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (extra) {
    for (const [name, value] of Object.entries(extra)) headers.append(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}
