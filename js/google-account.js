import { base64UrlToBytes } from "./google-jwt.js";

export const GOOGLE_TOKEN_KEY = "murdoku-grid.google-id-token";

export function readGoogleToken(store) {
  try {
    return store?.getItem?.(GOOGLE_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function writeGoogleToken(store, token) {
  try {
    if (token) store?.setItem?.(GOOGLE_TOKEN_KEY, token);
    else store?.removeItem?.(GOOGLE_TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function tokenUsable(token, now = Date.now()) {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload?.exp);
  if (!payload?.sub || payload.email_verified !== true || !Number.isFinite(exp)) return false;
  return exp * 1000 > now + 30_000;
}
