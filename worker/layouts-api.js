import { verifyGoogleIdToken } from "../js/google-jwt.js";
import {
  deleteLayoutById,
  ensureSchema,
  getLayoutById,
  insertLayout,
  listLayouts,
  normalizeLayoutInput,
  updateLayout,
} from "./layouts.js";

const MAX_BODY = 200_000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleLayoutsRequest(request, env, deps = {}) {
  const userSub = await authenticate(request, deps);
  if (userSub instanceof Response) return userSub;

  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "layouts" || parts.length > 3) {
    return json({ error: "Not found" }, 404);
  }
  const id = parts[2] || null;
  if (id && !ID_RE.test(id)) return json({ error: "Not found" }, 404);

  try {
    await ensureSchema(env.DB);
    if (!id) {
      if (request.method === "GET") return json({ layouts: await listLayouts(env.DB, userSub) });
      if (request.method === "POST") return createLayout(request, env, userSub, deps);
      return json({ error: "Method not allowed" }, 405);
    }
    if (request.method === "GET") return readLayout(env, userSub, id);
    if (request.method === "PUT") return replaceLayout(request, env, userSub, id, deps);
    if (request.method === "DELETE") return removeLayout(env, userSub, id);
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

async function readLayout(env, userSub, id) {
  const layout = await getLayoutById(env.DB, userSub, id);
  if (!layout) return json({ error: "Not found" }, 404);
  return json({ layout });
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

async function authenticate(request, deps) {
  const verify = deps.verify || verifyGoogleIdToken;
  const token = bearerToken(request);
  if (!token) return json({ error: "Sign in required" }, 401);
  try {
    const identity = await verify(token);
    if (!identity?.sub) return json({ error: "Sign in required" }, 401);
    return identity.sub;
  } catch {
    return json({ error: "Sign in required" }, 401);
  }
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : "";
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
