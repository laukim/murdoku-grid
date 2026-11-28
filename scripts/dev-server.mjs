import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalD1 } from "./local-d1.js";
import { handleLayoutsRequest } from "../worker/layouts-api.js";
import { handleSessionRequest } from "../worker/session-api.js";

loadDevVars();

const port = Number(process.env.PORT || 8787);
const htmlPath = new URL("../index.html", import.meta.url);
const importerPath = new URL("../layout-import.js", import.meta.url);
const boardConverterPath = new URL("../board-convert.js", import.meta.url);
const jsDir = fileURLToPath(new URL("../js/", import.meta.url));
const env = { DB: new LocalD1(), SESSION_SECRET: process.env.SESSION_SECRET || "" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const api = url.pathname === "/api/session"
    || url.pathname === "/api/session/logout"
    || url.pathname === "/api/layouts"
    || url.pathname.startsWith("/api/layouts/");
  if (api) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
    if (req.headers["content-type"]) headers.set("content-type", req.headers["content-type"]);
    if (req.headers["content-length"]) headers.set("content-length", req.headers["content-length"]);
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = url.pathname.startsWith("/api/layouts")
      ? await handleLayoutsRequest(request, env)
      : await handleSessionRequest(request, env);
    const bytes = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, responseHeaders(response));
    res.end(bytes);
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(htmlPath));
    return;
  }

  if (url.pathname === "/layout-import.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(readFileSync(importerPath));
    return;
  }

  if (url.pathname === "/board-convert.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(readFileSync(boardConverterPath));
    return;
  }

  if (url.pathname.startsWith("/js/")) {
    const name = url.pathname.slice("/js/".length);
    const filePath = resolve(jsDir, name);
    const inside = filePath.startsWith(jsDir.endsWith(sep) ? jsDir : jsDir + sep);
    if (!/^[\w.-]+$/.test(name) || name.includes("..") || !name.endsWith(".js") || !inside || !existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(readFileSync(filePath));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Murdoku grid helper at http://127.0.0.1:${port}`);
  console.log("Saved puzzles are public. Guests can save solve progress. Library editors can edit layouts.");
  if (!env.SESSION_SECRET) {
    console.log("SESSION_SECRET is unset. Unsigned play works. Sign-in needs the secret in .dev.vars.");
  }
});

function responseHeaders(response) {
  const headers = {};
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") return;
    headers[name] = value;
  });
  if (cookies.length === 1) headers["set-cookie"] = cookies[0];
  else if (cookies.length > 1) headers["set-cookie"] = cookies;
  return headers;
}

function loadDevVars() {
  const path = fileURLToPath(new URL("../.dev.vars", import.meta.url));
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}
