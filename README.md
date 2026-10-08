# Murdoku Grid Helper

A browser grid for working [Murdoku](https://murdoku.com) puzzles with the same marking flow as the official site: pencil marks, placements, X cells, furniture, obstacles, and room walls.

The app is a Cloudflare Worker. Static files are Workers assets, and saved layouts live in a D1 database named `murdoku-layouts`. There is no puzzle catalog in this repo — you draw or load your own layouts.

**App:** https://murdoku-grid.mocholate.workers.dev

GitHub Pages (`https://laukim.github.io/murdoku-grid/`) stops once the GitHub repo is private. That is expected; Cloudflare is the host.

## What it does

Set the grid size, then mark the puzzle as you work:

- **Pencil marks** — click or drag to note which characters could go in a cell
- **Place a person** — long-press a cell to confirm someone’s position; row and column cross-outs apply automatically
- **Mark X** — block a whole cell when no one can go there
- **Obstacles and furniture** — tables, trees, chairs, and the other map objects
- **Room walls** — click or drag internal grid lines to draw bold borders between rooms
- **Character colors** — A–Z (and V for the victim) each have their own color
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

That id is in `wrangler.jsonc`. From a machine logged in with `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`):

```bash
npm install
npx wrangler secret put LAYOUT_KEY
npm run db:migrate
npm run deploy
```

`deploy.sh` applies the remote migration and deploys. Set the secret first. Put the same secret in the page’s Access key field.

Workers assets serve `index.html`. `/api/*` runs the Worker first, same pattern as `laukim/cube-learning` (`3x3coach`). `.assetsignore` keeps the Worker source, migrations, and `node_modules` off the public asset upload.

The workers.dev hostname is `murdoku-grid.mocholate.workers.dev`.
