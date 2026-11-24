import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeJwtPayload } from "../js/google-account.js";
import { LocalD1 } from "./local-d1.js";
import { handleLayoutsRequest } from "../worker/layouts-api.js";
import { handleSessionRequest } from "../worker/session-api.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  issueSession,
  sessionSecret,
  verifySession,
} from "../worker/session.js";
import worker from "../worker/index.js";

const SECRET = "test-session-secret-do-not-use-in-prod!!";
const OTHER_SECRET = "another-session-secret-not-the-same!!";
assert.ok(SECRET.length >= 32 && OTHER_SECRET.length >= 32);

async function verify(token) {
  if (token === "good-google") return { sub: "kim-sub", email: "kim.lau817@gmail.com" };
  if (token === "other-google") return { sub: "other-sub", email: "other@example.com" };
  if (token === "no-email") return { sub: "no-email-sub" };
  if (token === "mocho-google") return { sub: "mocho-sub", email: "Mocholateio@gmail.com" };
  throw new Error("bad token");
}

function request(method, path, { cookie = "", body, contentType, authorization = "" } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  let payload;
  if (body !== undefined) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    headers.set("content-type", contentType || "application/json");
  }
  return new Request(`https://murdoku-grid.test${path}`, {
    method,
    headers,
    body: payload,
  });
}

async function read(response) {
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookies: typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [],
  };
}

function cookiePair(line) {
  return String(line || "").split(";")[0];
}

function tokenFrom(line) {
  const pair = cookiePair(line);
  assert.ok(pair.startsWith(`${SESSION_COOKIE}=`), pair);
  return pair.slice(SESSION_COOKIE.length + 1);
}

function assertLiveCookie(line) {
  assert.match(line, /HttpOnly/);
  assert.match(line, /Secure/);
  assert.match(line, /SameSite=Lax/);
  assert.match(line, /Path=\//);
  assert.match(line, new RegExp(`Max-Age=${SESSION_TTL_SEC}`));
  const token = tokenFrom(line);
  assert.equal(token.split(".").length, 3);
  return token;
}

function assertClearCookie(line) {
  assert.match(line, new RegExp(`^${SESSION_COOKIE}=;`));
  assert.match(line, /HttpOnly/);
  assert.match(line, /Secure/);
  assert.match(line, /SameSite=Lax/);
  assert.match(line, /Path=\//);
  assert.match(line, /Max-Age=0/);
}

const db = new LocalD1();
const env = { DB: db, SESSION_SECRET: SECRET };
const deps = { verify };

{
  assert.equal(sessionSecret({}), "");
  assert.equal(sessionSecret({ SESSION_SECRET: "short" }), "");
  assert.equal(sessionSecret(env), SECRET);
}

{
  const missing = await read(await handleSessionRequest(
    request("POST", "/api/session", { body: { credential: "good-google" } }),
    { DB: db },
    deps,
  ));
  assert.equal(missing.status, 500);
  assert.equal(missing.body.error, "Session signing is not configured");
  assert.equal(missing.cookies.length, 0);

  const open = await read(await handleLayoutsRequest(request("GET", "/api/layouts"), { DB: db }));
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.layouts, []);
}

{
  const bad = await read(await handleSessionRequest(
    request("POST", "/api/session", { body: { credential: "nope" } }),
    env,
    deps,
  ));
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "Sign in required");
  assert.equal(bad.cookies.length, 0);

  const junk = await read(await handleSessionRequest(
    request("POST", "/api/session", { body: "{", contentType: "application/json" }),
    env,
    deps,
  ));
  assert.equal(junk.status, 400);

  const text = await read(await handleSessionRequest(
    request("POST", "/api/session", { body: "credential=good-google", contentType: "text/plain" }),
    env,
    deps,
  ));
  assert.equal(text.status, 400);
}

const issued = await read(await handleSessionRequest(
  request("POST", "/api/session", { body: { credential: "good-google" } }),
  env,
  deps,
));
assert.equal(issued.status, 200);
assert.equal(issued.body.signedIn, true);
assert.equal(issued.body.email, "kim.lau817@gmail.com");
assert.equal(issued.body.canUpdateAny, true);
assert.equal(issued.body.sub, undefined);
assert.equal(issued.cookies.length, 1);
const kimToken = assertLiveCookie(issued.cookies[0]);
assert.equal(kimToken.includes("good-google"), false);
const claims = decodeJwtPayload(kimToken);
assert.equal(claims.iss, "murdoku-grid");
assert.equal(claims.sub, "kim-sub");
assert.equal(claims.email, "kim.lau817@gmail.com");
assert.equal(claims.exp - claims.iat, SESSION_TTL_SEC);
assert.equal(claims.alg, undefined);

const kimCookie = cookiePair(issued.cookies[0]);
const reloaded = await read(await handleSessionRequest(request("GET", "/api/session", { cookie: kimCookie }), env));
assert.equal(reloaded.status, 200);
assert.equal(reloaded.body.signedIn, true);
assert.equal(reloaded.body.email, "kim.lau817@gmail.com");
assert.equal(reloaded.body.canUpdateAny, true);
assert.equal(reloaded.cookies.length, 0);

const anonymous = await read(await handleSessionRequest(request("GET", "/api/session"), env));
assert.deepEqual(anonymous.body, { signedIn: false });

{
  const noEmail = await read(await handleSessionRequest(
    request("POST", "/api/session", { body: { credential: "no-email" } }),
    env,
    deps,
  ));
  assert.equal(noEmail.status, 200);
  assert.equal(noEmail.body.email, "");
  assert.equal(noEmail.body.canUpdateAny, undefined);
  const identity = await verifySession(tokenFrom(noEmail.cookies[0]), SECRET);
  assert.equal(identity.sub, "no-email-sub");
  assert.equal(identity.email, "");
}

const otherIssued = await read(await handleSessionRequest(
  request("POST", "/api/session", { body: { credential: "other-google" } }),
  env,
  deps,
));
const otherCookie = cookiePair(otherIssued.cookies[0]);
assert.equal(otherIssued.body.canUpdateAny, undefined);
assert.equal(otherIssued.body.email, "other@example.com");

const mochoIssued = await read(await handleSessionRequest(
  request("POST", "/api/session", { body: { credential: "mocho-google" } }),
  env,
  deps,
));
assert.equal(mochoIssued.status, 200);
assert.equal(mochoIssued.body.email, "Mocholateio@gmail.com");
assert.equal(mochoIssued.body.canUpdateAny, true);
assert.equal(mochoIssued.body.sub, undefined);

function layoutBody(title = "Manor study") {
  return {
    title,
    width: 4,
    height: 3,
    characters: ["Ana", "Ben", "V"],
    walls: ["h,0,0"],
    objects: [{ r: 0, c: 1, id: "table" }],
  };
}

const created = await read(await handleLayoutsRequest(
  request("POST", "/api/layouts", { cookie: kimCookie, body: layoutBody("Kim only") }),
  env,
));
assert.equal(created.status, 201, JSON.stringify(created.body));
assert.equal(created.body.layout.mine, true);
assert.equal(created.body.layout.user_sub, undefined);
const layoutId = created.body.layout.id;
const row = db.db.prepare("SELECT user_sub FROM layouts WHERE id = ?").get(layoutId);
assert.equal(row.user_sub, "kim-sub");

const listed = await read(await handleLayoutsRequest(
  request("GET", "/api/layouts", { cookie: kimCookie }),
  env,
));
assert.equal(listed.body.layouts.find((layout) => layout.id === layoutId).mine, true);

const otherList = await read(await handleLayoutsRequest(
  request("GET", "/api/layouts", { cookie: otherCookie }),
  env,
));
assert.equal(otherList.body.layouts.find((layout) => layout.id === layoutId).mine, undefined);

const anonList = await read(await handleLayoutsRequest(request("GET", "/api/layouts"), env));
assert.equal(anonList.body.layouts.find((layout) => layout.id === layoutId).mine, undefined);

const anonWrite = await read(await handleLayoutsRequest(
  request("POST", "/api/layouts", { body: layoutBody("Nope") }),
  env,
));
assert.equal(anonWrite.status, 401);
assert.equal(anonWrite.body.error, "Sign in required");
assert.equal(anonWrite.cookies.length, 0);

const otherWrite = await read(await handleLayoutsRequest(
  request("PUT", `/api/layouts/${layoutId}`, { cookie: otherCookie, body: layoutBody("Taken") }),
  env,
));
assert.equal(otherWrite.status, 404);
const otherDelete = await read(await handleLayoutsRequest(
  request("DELETE", `/api/layouts/${layoutId}`, { cookie: otherCookie }),
  env,
));
assert.equal(otherDelete.status, 404);
const still = db.db.prepare("SELECT title, user_sub FROM layouts WHERE id = ?").get(layoutId);
assert.equal(still.title, "Kim only");
assert.equal(still.user_sub, "kim-sub");

{
  const bearer = await read(await handleLayoutsRequest(
    request("DELETE", `/api/layouts/${layoutId}`, { authorization: `Bearer ${kimToken}` }),
    env,
  ));
  assert.equal(bearer.status, 401);
  const ignoredGoogle = await read(await handleLayoutsRequest(
    request("PUT", `/api/layouts/${layoutId}`, {
      authorization: "Bearer good-google",
      body: layoutBody("Google"),
    }),
    env,
  ));
  assert.equal(ignoredGoogle.status, 401);
  const kept = db.db.prepare("SELECT title FROM layouts WHERE id = ?").get(layoutId);
  assert.equal(kept.title, "Kim only");
}

{
  const now = Date.now();
  const aged = await issueSession(
    { sub: "kim-sub", email: "kim.lau817@gmail.com" },
    SECRET,
    now - 2 * 60 * 60 * 1000,
  );
  const stillKim = await verifySession(aged, SECRET, now);
  assert.equal(stillKim.sub, "kim-sub");
  const agedCookie = `${SESSION_COOKIE}=${aged}`;
  const saved = await read(await handleLayoutsRequest(
    request("POST", "/api/layouts", { cookie: agedCookie, body: layoutBody("After Google exp") }),
    env,
  ));
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const savedRow = db.db.prepare("SELECT user_sub FROM layouts WHERE id = ?").get(saved.body.layout.id);
  assert.equal(savedRow.user_sub, "kim-sub");

  const inside = await issueSession(
    { sub: "kim-sub", email: "kim.lau817@gmail.com" },
    SECRET,
    now - (SESSION_TTL_SEC - 60) * 1000,
  );
  assert.equal((await verifySession(inside, SECRET, now)).sub, "kim-sub");

  const expired = await issueSession(
    { sub: "kim-sub", email: "kim.lau817@gmail.com" },
    SECRET,
    now - (SESSION_TTL_SEC + 5) * 1000,
  );
  assert.equal(await verifySession(expired, SECRET, now), null);
  const expiredCookie = `${SESSION_COOKIE}=${expired}`;
  const denied = await read(await handleLayoutsRequest(
    request("DELETE", `/api/layouts/${layoutId}`, { cookie: expiredCookie }),
    env,
  ));
  assert.equal(denied.status, 401);
  assert.equal(denied.cookies.length, 1);
  assertClearCookie(denied.cookies[0]);
  const cleared = await read(await handleSessionRequest(
    request("GET", "/api/session", { cookie: expiredCookie }),
    env,
  ));
  assert.equal(cleared.body.signedIn, false);
  assertClearCookie(cleared.cookies[0]);
  const stillThere = db.db.prepare("SELECT title FROM layouts WHERE id = ?").get(layoutId);
  assert.equal(stillThere.title, "Kim only");
}

{
  const [h, p, sig] = kimToken.split(".");
  const flipped = `${h}.${p}.${sig.slice(0, -2)}${sig.endsWith("a") ? "b" : "a"}`;
  assert.equal(await verifySession(flipped, SECRET), null);
  const tampered = await read(await handleLayoutsRequest(
    request("POST", "/api/layouts", { cookie: `${SESSION_COOKIE}=${flipped}`, body: layoutBody("Tampered") }),
    env,
  ));
  assert.equal(tampered.status, 401);
  assertClearCookie(tampered.cookies[0]);

  const wrong = await read(await handleLayoutsRequest(
    request("GET", "/api/layouts", { cookie: kimCookie }),
    { DB: db, SESSION_SECRET: OTHER_SECRET },
  ));
  assert.equal(wrong.status, 200);
  assert.equal(wrong.body.layouts.find((layout) => layout.id === layoutId).mine, undefined);
  assertClearCookie(wrong.cookies[0]);

  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "murdoku-grid",
    sub: "kim-sub",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  assert.equal(await verifySession(`${header}.${payload}.x`, SECRET), null);
  assert.equal(await verifySession(`${header}.${payload}.`, SECRET), null);

  const future = await issueSession({ sub: "kim-sub", email: "kim.lau817@gmail.com" }, SECRET, Date.now() + 5 * 60 * 1000);
  assert.equal(await verifySession(future, SECRET), null);

  const mixed = `theme=dark; ${kimCookie}; extra=1`;
  const fromMixed = await verifySession(mixed.split("; ").find((part) => part.startsWith(`${SESSION_COOKIE}=`)).split("=").slice(1).join("="), SECRET);
  assert.equal(fromMixed.sub, "kim-sub");
  const mixedRead = await read(await handleSessionRequest(
    request("GET", "/api/session", { cookie: mixed }),
    env,
  ));
  assert.equal(mixedRead.body.signedIn, true);
  assert.equal(mixedRead.body.email, "kim.lau817@gmail.com");
}

{
  const loggedOut = await read(await handleSessionRequest(
    request("POST", "/api/session/logout", { cookie: kimCookie }),
    env,
  ));
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(loggedOut.body, { signedIn: false });
  assert.equal(loggedOut.cookies.length, 1);
  assertClearCookie(loggedOut.cookies[0]);
  assert.equal(loggedOut.cookies[0].includes(kimToken), false);

  const after = await read(await handleSessionRequest(request("GET", "/api/session"), env));
  assert.equal(after.body.signedIn, false);
  const write = await read(await handleLayoutsRequest(
    request("PUT", `/api/layouts/${layoutId}`, { body: layoutBody("Signed out") }),
    env,
  ));
  assert.equal(write.status, 401);
  const kept = db.db.prepare("SELECT title, user_sub FROM layouts WHERE id = ?").get(layoutId);
  assert.equal(kept.title, "Kim only");
  assert.equal(kept.user_sub, "kim-sub");

  const noCookie = await read(await handleSessionRequest(request("POST", "/api/session/logout"), env));
  assert.equal(noCookie.body.signedIn, false);
  assert.equal(noCookie.cookies.length, 0);

  const getLogout = await read(await handleSessionRequest(
    request("GET", "/api/session/logout", { cookie: kimCookie }),
    env,
  ));
  assert.equal(getLogout.status, 405);
  assert.equal(getLogout.cookies.length, 0);
}

{
  const routed = await read(await worker.fetch(
    request("POST", "/api/session", { body: { credential: "good-google" } }),
    { DB: db },
  ));
  assert.equal(routed.status, 500);
  assert.equal(routed.cookies.length, 0);
  const status = await read(await worker.fetch(request("GET", "/api/session"), env));
  assert.equal(status.status, 200);
  assert.equal(status.body.signedIn, false);
  const missing = await worker.fetch(request("GET", "/api/nope"), env);
  assert.equal(missing.status, 404);
}

{
  const files = [
    "worker/session.js",
    "worker/session-api.js",
    "worker/layouts-api.js",
    "worker/index.js",
    "index.html",
    "README.md",
    ".dev.vars.example",
    "wrangler.jsonc",
  ];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/SESSION_SECRET\s*[:=]\s*["'][^"']+["']/.test(text), false, file);
    assert.equal(/client_secret|LAYOUT_KEY/.test(text), false, file);
  }
}

console.log("session tests passed");
