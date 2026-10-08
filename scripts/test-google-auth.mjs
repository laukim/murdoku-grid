import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeJwtPayload, tokenUsable } from "../js/google-account.js";
import { GOOGLE_CLIENT_ID } from "../js/google-client.js";
import { verifyGoogleIdToken } from "../js/google-jwt.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-kid";

function b64url(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return bytes.toString("base64url");
}

function signJwt(payload, { alg = "RS256", kid = "test-kid", key = privateKey } = {}) {
  const header = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  return `${data}.${signer.sign(key).toString("base64url")}`;
}

const nowSec = Math.floor(Date.now() / 1000);
const nowMs = nowSec * 1000;
const goodPayload = {
  iss: "https://accounts.google.com",
  aud: GOOGLE_CLIENT_ID,
  sub: "kim-sub",
  email: "kim.lau817@gmail.com",
  email_verified: true,
  exp: nowSec + 3600,
  iat: nowSec,
};

const good = signJwt(goodPayload);
const identity = await verifyGoogleIdToken(good, { jwks: [jwk], now: nowMs });
assert.equal(identity.sub, "kim-sub");
assert.equal(identity.email, "kim.lau817@gmail.com");
assert.equal(tokenUsable(good, nowMs), true);
assert.equal(decodeJwtPayload(good).email, "kim.lau817@gmail.com");

const otherIssuer = signJwt({ ...goodPayload, iss: "accounts.google.com" });
assert.equal((await verifyGoogleIdToken(otherIssuer, { jwks: [jwk], now: nowMs })).sub, "kim-sub");

async function rejects(token) {
  await assert.rejects(() => verifyGoogleIdToken(token, { jwks: [jwk], now: nowMs }));
}

await rejects(signJwt({ ...goodPayload, aud: "wrong-client" }));
await rejects(signJwt({ ...goodPayload, iss: "https://evil.example" }));
await rejects(signJwt({ ...goodPayload, exp: nowSec - 120 }));
await rejects(signJwt({ ...goodPayload, email_verified: false }));
await rejects(signJwt({ ...goodPayload, sub: "" }));
await rejects(signJwt(goodPayload, { alg: "HS256" }));

const broken = `${good.slice(0, -8)}aaaaaaaa`;
await rejects(broken);
assert.equal(tokenUsable(signJwt({ ...goodPayload, email_verified: false }), nowMs), false);
assert.equal(tokenUsable(signJwt({ ...goodPayload, exp: nowSec + 10 }), nowMs), false);

const files = [
  "worker/index.js",
  "worker/layouts-api.js",
  "worker/layouts.js",
  "js/google-jwt.js",
  "js/google-client.js",
  "js/google-account.js",
  "index.html",
  "wrangler.jsonc",
  "scripts/dev-server.mjs",
];
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.equal(/client_secret|LAYOUT_KEY/.test(text), false, file);
}

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.equal(/id="accessKey"/.test(page), false);
assert.match(page, /Sign in with Google to save layouts/);

console.log("google auth tests passed");
