#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { importBoardSource, layoutInsertSql } from "../layout-import.js";

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node scripts/import-layout.mjs <file.json> [--title name] [--sql] [--post url] [--key secret]

Reads a local layout file (room-map JSON, thick-edge JSON, or pasted board
HTML) and prints the grid-helper layout. --sql prints a D1 INSERT. --post
sends it to a Worker /api/layouts endpoint. This command does not download
remote catalogs.`);
  process.exit(args.length === 0 ? 1 : 0);
}

const titleFlag = flagValue("--title");
const postUrl = flagValue("--post");
const key = flagValue("--key") || process.env.LAYOUT_KEY || "";
const asSql = args.includes("--sql");
const consumed = new Set();
for (const name of ["--title", "--post", "--key"]) {
  const index = args.indexOf(name);
  if (index !== -1) {
    consumed.add(index);
    consumed.add(index + 1);
  }
}
const file = args.find((arg, index) => !consumed.has(index) && !arg.startsWith("--"));

if (!file) {
  fail("Pass a local JSON file.");
}
if (/^https?:\/\//i.test(file)) {
  fail("Pass a local JSON file. This importer does not fetch remote catalogs.");
}
if (asSql && postUrl) {
  fail("Use either --sql or --post.");
}
if (postUrl && !key) {
  fail("Set --key or LAYOUT_KEY to post a layout.");
}

const text = readFileSync(file, "utf8");
if (text.length > 1_000_000) fail("That file is too large.");

const fallbackTitle = basename(file, extname(file)).replace(/[-_]+/g, " ").trim();
let layout;
try {
  layout = importBoardSource(text, {
    title: titleFlag || undefined,
    fallbackTitle,
  });
} catch (err) {
  fail(err instanceof Error ? err.message : "Could not import that layout.");
}

if (asSql) {
  console.log(layoutInsertSql(layout));
} else if (postUrl) {
  const response = await fetch(new URL("/api/layouts", postUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(layout),
  });
  const bodyText = await response.text();
  if (!response.ok) fail(bodyText || `Request failed (${response.status})`);
  console.log(bodyText);
} else {
  console.log(JSON.stringify(layout, null, 2));
}

function flagValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} needs a value.`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
