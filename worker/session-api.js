import { verifyGoogleIdToken } from "../js/google-jwt.js";
import { canUpdateAnyLayout } from "./library-editors.js";
import {
  clearSessionCookie,
  issueSession,
  readSessionToken,
  sessionSecret,
  sessionSetCookie,
  verifySession,
} from "./session.js";

const MAX_BODY = 20_000;

export async function handleSessionRequest(request, env, deps = {}) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/session/logout") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    return logout(request);
  }
  if (pathname !== "/api/session") return json({ error: "Not found" }, 404);
  if (request.method === "GET") return currentSession(request, env);
  if (request.method === "POST") return createSession(request, env, deps);
  return json({ error: "Method not allowed" }, 405);
}

async function currentSession(request, env) {
  const token = readSessionToken(request);
  if (!token) return json({ signedIn: false });
  const identity = await verifySession(token, sessionSecret(env));
  if (!identity) return json({ signedIn: false }, 200, { "set-cookie": clearSessionCookie() });
  return json(signedInBody(identity.email));
}

async function createSession(request, env, deps) {
  const secret = sessionSecret(env);
  if (!secret) return json({ error: "Session signing is not configured" }, 500);

  const credential = await readCredential(request);
  if (credential.error) return json({ error: credential.error }, credential.status);

  const verify = deps.verify || verifyGoogleIdToken;
  let identity;
  try {
    identity = await verify(credential.value);
  } catch {
    return json({ error: "Sign in required" }, 401);
  }
  if (!identity?.sub) return json({ error: "Sign in required" }, 401);

  let token;
  try {
    token = await issueSession(identity, secret, deps.nowMs ?? Date.now());
  } catch {
    return json({ error: "Session signing is not configured" }, 500);
  }
  return json(
    signedInBody(typeof identity.email === "string" ? identity.email : ""),
    200,
    { "set-cookie": sessionSetCookie(token) },
  );
}

function signedInBody(email) {
  const body = { signedIn: true, email: email || "" };
  if (canUpdateAnyLayout(body.email)) body.canUpdateAny = true;
  return body;
}

function logout(request) {
  const extra = readSessionToken(request) ? { "set-cookie": clearSessionCookie() } : undefined;
  return json({ signedIn: false }, 200, extra);
}

async function readCredential(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    return { error: "Invalid JSON", status: 400 };
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) return { error: "Invalid JSON", status: 400 };
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: "Invalid JSON", status: 400 };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: "Invalid JSON", status: 400 };
  }
  const credential = body && typeof body.credential === "string" ? body.credential.trim() : "";
  if (!credential || credential.length > 8000) return { error: "Sign in required", status: 401 };
  return { value: credential };
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
