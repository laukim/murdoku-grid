import { base64UrlToBytes } from "../js/google-jwt.js";

/** HttpOnly session cookie. Not the Google ID token. */
export const SESSION_COOKIE = "murdoku_session";

/** Fixed lifetime from the moment the Worker issues the session. */
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

const MIN_SECRET_LENGTH = 32;
const ISSUER = "murdoku-grid";
const SKEW_MS = 60_000;
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/";

/**
 * Worker secret used as the HMAC key. Empty when missing or too short,
 * so callers fail closed instead of signing with a weak key.
 */
export function sessionSecret(env) {
  const secret = env && typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET : "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : "";
}

export function sessionSetCookie(token) {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRS}; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
}

export function readSessionToken(request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== SESSION_COOKIE) continue;
    return trimmed.slice(eq + 1);
  }
  return "";
}

export async function issueSession(identity, secret, nowMs = Date.now()) {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error("secret");
  const sub = cleanSub(identity?.sub);
  if (!sub) throw new Error("sub");
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TTL_SEC;
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({
    iss: ISSUER,
    sub,
    email: cleanEmail(identity?.email),
    iat,
    exp,
  });
  const data = `${header}.${payload}`;
  const sig = await hmacSign(data, secret);
  return `${data}.${sig}`;
}

/**
 * @returns {Promise<{ sub: string, email: string } | null>}
 */
export async function verifySession(token, secret, nowMs = Date.now()) {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!header || !payload) return null;
  if (header.alg !== "HS256" || header.crit != null) return null;
  if (header.typ != null && header.typ !== "JWT") return null;

  const valid = await hmacVerify(`${parts[0]}.${parts[1]}`, parts[2], secret);
  if (!valid) return null;
  if (payload.iss !== ISSUER) return null;

  const sub = cleanSub(payload.sub);
  if (!sub) return null;
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);
  if (!Number.isFinite(exp) || !Number.isFinite(iat)) return null;
  if (exp * 1000 <= nowMs) return null;
  if (iat * 1000 > nowMs + SKEW_MS) return null;
  if (exp - iat > SESSION_TTL_SEC + 60) return null;
  return { sub, email: cleanEmail(payload.email) };
}

function cleanSub(sub) {
  if (typeof sub !== "string") return "";
  const trimmed = sub.trim();
  if (!trimmed || trimmed.length > 255 || /[\u0000-\u001f]/.test(trimmed)) return "";
  return trimmed;
}

function cleanEmail(email) {
  if (typeof email !== "string") return "";
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 320 || /[\u0000-\u001f]/.test(trimmed)) return "";
  return trimmed;
}

function b64urlJson(value) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeJson(part) {
  try {
    const value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(data, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function hmacVerify(data, signature, secret) {
  try {
    const sigBytes = base64UrlToBytes(signature);
    const key = await hmacKey(secret);
    return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
  } catch {
    return false;
  }
}
