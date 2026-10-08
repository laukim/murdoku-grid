import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { LocalD1 } from "./local-d1.js";
import { handleLayoutsRequest } from "../worker/layouts-api.js";

const port = Number(process.env.PORT || 8787);
const key = process.env.LAYOUT_KEY || "local-dev-key";
const htmlPath = new URL("../index.html", import.meta.url);
const importerPath = new URL("../layout-import.js", import.meta.url);
const boardConverterPath = new URL("../board-convert.js", import.meta.url);
const env = { DB: new LocalD1(), LAYOUT_KEY: key };

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/layouts" || url.pathname.startsWith("/api/layouts/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    if (req.headers.authorization) headers.set("authorization", req.headers.authorization);
    if (req.headers["content-type"]) headers.set("content-type", req.headers["content-type"]);
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await handleLayoutsRequest(request, env);
    const bytes = Buffer.from(await response.arrayBuffer());
    const out = {};
    response.headers.forEach((value, name) => {
      out[name] = value;
    });
    res.writeHead(response.status, out);
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

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Murdoku grid helper at http://127.0.0.1:${port}`);
  console.log(`Local access key: ${key}`);
});
