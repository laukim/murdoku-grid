# Murdoku Grid Helper

A browser grid for working [Murdoku](https://murdoku.com) puzzles with the same marking flow as the official site: pencil marks, placements, X cells, furniture, obstacles, and room walls.

The app is a Cloudflare Worker. Static files are Workers assets, and saved layouts live in a D1 database named `murdoku-layouts`. There is no puzzle catalog in this repo — you draw or load your own layouts.

**App, after deploy:** https://murdoku-grid.mocholate.workers.dev

GitHub Pages (`https://laukim.github.io/murdoku-grid/`) stops once the GitHub repo is private. That is expected; Cloudflare is the host. The Worker is not published yet — the deploy steps below create it. The D1 database and empty `layouts` table are already in the account.

## What it does

Set the grid size, then mark the puzzle as you work:

- **Pencil marks** — click or drag to note which characters could go in a cell
- **Place a person** — long-press a cell to confirm someone’s position; row and column cross-outs apply automatically
- **Mark X** — block a whole cell when no one can go there
- **Obstacles and furniture** — tables, trees, chairs, and the other map objects
- **Room walls** — click or drag internal grid lines to draw bold borders between rooms
- **Character colors** — A–Z (and V for the victim) each have their own color
- **Import JSON** — open a local room map or wall file, draw it, then keep marking
- **Saved layouts** — store the current grid, load it later, then keep adding objects and marks

Keyboard shortcuts: letter keys select a character, `X` for mark-X mode, `O` for obstacles, `E` for erase.

Clear all removes pencil marks, placements, and X cells. Room walls and objects stay, so a loaded layout can be marked again.

## Auth

Layouts are a private personal tool. Every `/api/layouts` request needs:

```
Authorization: Bearer <LAYOUT_KEY>
```

The Worker reads `LAYOUT_KEY` from a Wrangler secret (or `.dev.vars` locally). The page stores the same value in `localStorage` under `murdoku-grid.access-key` and sends it from the browser. There is no Google sign-in.

Anyone with the key can list, change, and delete layouts. Use a long random string, and do not commit it.

If `LAYOUT_KEY` is missing, the API returns 503. A missing or wrong key returns 401.

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/layouts` | | `{ layouts: [{ id, title, width, height, created_at, updated_at }] }` |
| `POST` | `/api/layouts` | layout | `201 { layout }` |
| `GET` | `/api/layouts/:id` | | `{ layout }` |
| `PUT` | `/api/layouts/:id` | layout | `{ layout }` |
| `DELETE` | `/api/layouts/:id` | | `{ ok: true }` |

`width` is the column count and `height` is the row count (2–20). A layout body:

```json
{
  "title": "Manor study",
  "width": 9,
  "height": 9,
  "characters": ["A", "B", "C", "D", "E", "F", "G", "H", "V"],
  "walls": ["h,0,1", "v,2,3"],
  "objects": [{ "r": 1, "c": 2, "id": "table" }],
  "marks": [{ "r": 0, "c": 0, "confirmed": null, "blocked": false, "pencil": [0, 1] }]
}
```

- `walls` are internal borders. `h,r,c` is the horizontal line under row `r` at column `c`. `v,r,c` is the vertical line to the right of column `c` in row `r`.
- `objects` is optional. Each entry is a furniture or obstacle id on a cell (`table`, `tree`, `chair`, …). An empty array is a room-only layout; load it and add objects later. Object ids are lowercase slugs, so new kinds can be stored without a schema change.
- `marks` is optional solving state: pencil indexes, a confirmed character index, or an X (`blocked`). Uncheck “Save pencil marks and placements” to store only the rooms and objects.

## Import a layout file

The page’s **Import JSON** button reads a local file and draws it with the same room walls, cells, and object tools. Nothing is downloaded. After import, add obstacles or marks, then **Save current** to store the layout in D1. Load it later from the saved-layout list.

`examples/garden-path.json` is a small handmade sample, not a puzzle catalog:

```json
{
  "title": "Garden path",
  "characters": ["A", "B", "C", "V"],
  "rooms": ["AABB", "AABB", "CCCB"],
  "obstacles": [{ "r": 0, "c": 2, "id": "tree" }]
}
```

That room map is 4 columns by 3 rows. Cells that share a letter are one room. A different letter next door becomes a wall: `v,0,1`, `v,1,1`, `v,2,2`, `h,1,0`, `h,1,1`, and `h,1,2`.

A file can describe rooms in any of these ways:

- `rooms`, `zones`, `roomMap`, or `zoneMap`: a grid of room ids. Each row is an array (`[1, 1, 2, 2]`), a character string (`"AABB"`), or comma-separated ids (`"living room,study"`). A flat list of one id per cell is row-major and needs `width` and `height`. Adjacent cells with different ids become walls.
- `walls`, `wallSegments`, or `edges`: internal borders, with or without a room map. Extra walls are added on top of a map. Each entry can be `"h,r,c"` / `"v,r,c"`, `{ "dir": "h", "r": 0, "c": 1 }`, `{ "from": [0, 0], "to": [0, 1] }`, or `[[0, 0], [1, 0]]`. `h,r,c` is the line under row `r` at column `c`. `v,r,c` is the line to the right of column `c` in row `r`.
- `width` and `height` (columns and rows, 2–20). Optional when a room map sets the size. A wall-only file needs both.

Optional objects use `obstacles`, `objects`, `features`, or a grid in `obstacleMap` / `objectMap`. A cell is `{ "r": 0, "c": 2, "id": "tree" }` (`row`/`col`/`x`/`y` and `type` work too). In a grid, `""`, `"-"`, and `"."` are empty. Ids drawn by the picker: `chair`, `bed`, `carpet`, `car`, `oil-slick`, `table`, `bookshelf`, `plant`, `tree`, `tv`, `statue`, `other`. Any other lowercase slug is kept so a later pass can still edit that cell; the grid shows it with the generic obstacle icon.

`characters` defaults to `A` … `V` using `min(width, height)` labels, same as Create grid. `marks` uses the saved-layout shape. A character label such as `"A"` is accepted anywhere an index is accepted and stored as an index.

The same converter runs from the shell for a file already on disk. It prints the layout JSON, a D1 `INSERT`, or posts to the Worker:

```bash
node scripts/import-layout.mjs examples/garden-path.json
node scripts/import-layout.mjs examples/garden-path.json --sql > /tmp/garden-path.sql
npx wrangler d1 execute murdoku-layouts --remote --file=/tmp/garden-path.sql
node scripts/import-layout.mjs ./my-layout.json \
  --post https://murdoku-grid.mocholate.workers.dev \
  --key "$LAYOUT_KEY"
```

`--title` replaces the title in the file. The command rejects an `http://` or `https://` path.

## Schema

`migrations/0001_layouts.sql`:

- `id` — text primary key (UUID)
- `title` — name
- `width`, `height` — columns and rows
- `walls_json` — room borders
- `objects_json` — furniture and obstacles; safe to update on a later save
- `marks_json` — pencil marks, placements, and X cells
- `characters_json` — labels, which also drive the colors
- `created_at`, `updated_at` — ISO-8601 timestamps

## Local

API tests use an in-memory D1 stand-in (no Cloudflare login):

```bash
npm test
```

Click through the UI the same way, with access key `local-dev-key`:

```bash
npm run dev:local
```

Open http://127.0.0.1:8787.

Wrangler’s local runtime (uses `.dev.vars`):

```bash
cp .dev.vars.example .dev.vars
npm install
npm run dev
```

## Deploy

The D1 database already exists in the Cloudflare account:

- name: `murdoku-layouts`
- id: `99a3ebdf-139e-4421-8736-fa32f9d261d8`

That id is in `wrangler.jsonc`. `layouts` is already created there, so the migration’s `CREATE TABLE IF NOT EXISTS` is safe and records Wrangler’s migration history.

This environment could not finish `wrangler deploy`: there is no Wrangler API token, and the assets upload session token cannot be attached from here. From a machine logged in with `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`):

```bash
npm install
npx wrangler secret put LAYOUT_KEY
npm run db:migrate
npm run deploy
```

`deploy.sh` applies the remote migration and deploys. Set the secret first. Put the same secret in the page’s Access key field.

Workers assets serve `index.html`. `/api/*` runs the Worker first, same pattern as `laukim/cube-learning` (`3x3coach`). `.assetsignore` keeps the Worker source, migrations, and `node_modules` off the public asset upload.

The workers.dev hostname is `murdoku-grid.mocholate.workers.dev`.
