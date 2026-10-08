import { GOOGLE_CLIENT_ID } from "./google-client.js";

export function base64UrlToBytes(value) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = `${value}${pad}`.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_MS = 60_000;

let certCache = { keys: null, expiresAt: 0 };

export function resetGoogleCertCache() {
  certCache = { keys: null, expiresAt: 0 };
}

async function fetchCerts(fetchImpl, now, force) {
  if (!force && certCache.keys && certCache.expiresAt > now) return certCache.keys;
  const response = await fetchImpl(CERTS_URL);
  if (!response?.ok) throw new Error("certs");
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  certCache = { keys, expiresAt: now + 60 * 60 * 1000 };
  return keys;
}

/**
 * Verify a Google Identity Services ID token with Google's published keys.
 * The OAuth client is public; this does not use a client secret.
 */
export async function verifyGoogleIdToken(token, options = {}) {
  const clientId = options.clientId || GOOGLE_CLIENT_ID;
  const now = options.now ?? Date.now();
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("format");

  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!header || !payload) throw new Error("format");
  if (header.alg !== "RS256") throw new Error("alg");
  if (!audienceMatches(payload.aud, clientId)) throw new Error("aud");
  if (!ISSUERS.has(payload.iss)) throw new Error("iss");
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) throw new Error("sub");
  if (payload.email_verified !== true) throw new Error("email");
  const expMs = Number(payload.exp) * 1000;
  if (!Number.isFinite(expMs) || expMs < now - SKEW_MS) throw new Error("exp");

  let keys = options.jwks;
  if (!keys) keys = await fetchCerts(options.fetchImpl || fetch, now, false);
  let jwk = findKey(keys, header.kid);
  if (!jwk && !options.jwks) {
    keys = await fetchCerts(options.fetchImpl || fetch, now, true);
    jwk = findKey(keys, header.kid);
  }
  if (!jwk) throw new Error("kid");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error("sig");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
}

function findKey(keys, kid) {
  return (keys || []).find((key) => key?.kid === kid && key?.kty === "RSA" && key?.n && key?.e);
}

function audienceMatches(aud, clientId) {
  if (aud === clientId) return true;
  return Array.isArray(aud) && aud.includes(clientId);
}

function decodeJson(part) {
  try {
    const value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
