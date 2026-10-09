# Murdoku Grid Helper

A browser grid for working [Murdoku](https://murdoku.com) puzzles with the same marking flow as the official site: pencil marks, placements, X cells, furniture, obstacles, and room walls.

The app is a Cloudflare Worker. Static files are Workers assets, and saved layouts live in a D1 database named `murdoku-layouts`. There is no puzzle catalog in this repo — you draw or load your own layouts.

**Live app:** https://murdoku-grid.mocholate.workers.dev

GitHub Pages (`https://laukim.github.io/murdoku-grid/`) stops once the GitHub repo is private. That is expected; Cloudflare is the host. The D1 database is `murdoku-layouts`. A source change still needs a deploy; the Worker currently running was published with embedded assets, so publish this repo with `npm run deploy` when Wrangler is logged in.

## What it does

Set the grid size, then mark the puzzle as you work:

- **Pencil marks** — click or drag to note which characters could go in a cell
- **Place a person** — long-press a cell to confirm someone’s position; row and column cross-outs apply automatically
- **Mark X** — block a whole cell when no one can go there
- **Obstacles and furniture** — tables, shelves, cash registers, trees, chairs, and the other map objects. Sign in to place or change them. Unsigned viewers get a legend of those icons instead of the tool buttons.
- **Room walls and windows** — click an internal edge to cycle wall, window, and open. Drag draws or clears solid walls. A window is a wall with a gap in the middle. Sign in to edit them.
- **Character colors** — A–Z (and V for the victim) each have their own color
- **Create grid / Open a board** — set a size, paste a playground board, or import JSON. Sign in to use these
- **Saved puzzles** — the list of every saved layout is visible without an account. Titles such as Vol1 #5 come before Vol1 #11. Unsigned visitors see the title only. Sign in to create a grid, open a board, edit walls, windows, furniture, and obstacles, or to save, update, or delete your own.

Keyboard shortcuts: letter keys select a character, `X` for mark-X mode, `O` for obstacles, `E` for erase.

Clear all removes pencil marks, placements, and X cells. Room walls and objects stay, so a loaded layout can be marked again.

## Auth

Anyone can list and open saved puzzles. Without Google sign-in the page is load-and-view: the library is a row of titles, the board sits in front, and a legend shows furniture and obstacle icons. Create grid, Open a board, and the wall, furniture, and obstacle tools stay hidden, and clicking the grid does not add or remove rooms or objects. Pencil marks, placements, and X cells still work. Save, update, and delete need Google sign-in. A new puzzle is stored under that token’s `sub`. Update and delete only change rows with the same `sub`. A `user_sub` field in the JSON body is ignored, and responses do not include `sub`. The list puts numbered titles first, in numeric order, then other titles newest first.

The page uses Google Identity Services with the same public OAuth client as `laukim/cube-learning` (`3x3coach`). The client id lives in `js/google-client.js`. There is no client secret and no email allowlist. The Worker checks the ID token with Google’s published keys (RS256, `accounts.google.com`, `email_verified`).

`GET /api/layouts` and `GET /api/layouts/:id` do not require a token. A usable token may be sent on those reads; matching rows then include `mine: true`. A missing or invalid token on `POST`, `PUT`, or `DELETE` returns `401` `{ "error": "Sign in required" }`. Changing someone else’s row returns `404`. The browser keeps a usable ID token in `localStorage` under `murdoku-grid.google-id-token`.

Sign-in from the deployed host needs this authorized JavaScript origin on that same OAuth client in Google Cloud:

- `https://murdoku-grid.mocholate.workers.dev`
- `http://127.0.0.1:8787` and `http://localhost:8787` for local use

This repo cannot change the Google Cloud console. Add the origin there before the button can finish sign-in.

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/layouts` | | `{ layouts: [{ id, title, width, height, created_at, updated_at, mine? }] }` for every saved layout. No auth. `mine: true` when the optional bearer owns that row |
| `POST` | `/api/layouts` | layout | `201 { layout }`. Google sign-in required |
| `GET` | `/api/layouts/:id` | | `{ layout }` for any saved id. No auth. `mine: true` when the optional bearer owns it |
| `PUT` | `/api/layouts/:id` | layout | `{ layout }`. Google sign-in required, and only for that account’s row |
| `DELETE` | `/api/layouts/:id` | | `{ ok: true }`. Google sign-in required, and only for that account’s row |

`width` is the column count and `height` is the row count (2–20). A layout body:

```json
{
  "title": "Manor study",
  "width": 9,
  "height": 9,
  "characters": ["A", "B", "C", "D", "E", "F", "G", "H", "V"],
  "walls": ["h,0,1", "v,2,3"],
  "windows": ["h,1,2"],
  "objects": [{ "r": 1, "c": 2, "id": "table" }],
  "marks": [{ "r": 0, "c": 0, "confirmed": null, "blocked": false, "pencil": [0, 1] }]
}
```

- `walls` are internal borders. `h,r,c` is the horizontal line under row `r` at column `c`. `v,r,c` is the vertical line to the right of column `c` in row `r`.
- `windows` uses the same keys. A window is drawn with a gap and is not also stored as a solid wall. Omit it, or send `[]`, when the board has none.
- `objects` is optional. Each entry is a furniture or obstacle id on a cell (`table`, `tree`, `chair`, `cash-register`, …). An empty array is a room-only layout; load it and add objects later. Object ids are lowercase slugs, so new kinds can be stored without a schema change. `register` and `cashRegister` are stored as `cash-register`.
- `marks` is optional solving state: pencil indexes, a confirmed character index, or an X (`blocked`). Uncheck “Save pencil marks and placements” to store only the rooms and objects.

## Import a layout file

The page’s **Import JSON** button is on Open a board, which is shown after Google sign-in. It reads a local file and draws it with the same room walls, cells, and object tools. Nothing is downloaded. After import, add obstacles or marks. **Save current** is on the signed-in puzzle list and stores the layout in D1 for that Google account.

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

Optional objects use `obstacles`, `objects`, `features`, or a grid in `obstacleMap` / `objectMap`. A cell is `{ "r": 0, "c": 2, "id": "tree" }` (`row`/`col`/`x`/`y` and `type` work too). In a grid, `""`, `"-"`, and `"."` are empty. Ids drawn by the picker: `chair`, `bed`, `carpet`, `car`, `oil-slick`, `table`, `bookshelf`, `cash-register`, `plant`, `tree`, `tv`, `statue`, `other`. Any other lowercase slug is kept so a later pass can still edit that cell; the grid shows it with the generic obstacle icon. `windows` uses the same `h,r,c` / `v,r,c` keys as walls.

`characters` defaults to `A` … `V` using `min(width, height)` labels, same as Create grid. `marks` uses the saved-layout shape. A character label such as `"A"` is accepted anywhere an index is accepted and stored as an index.

The same converter runs from the shell for a file already on disk. It prints the layout JSON, a D1 `INSERT`, or posts to the Worker:

```bash
node scripts/import-layout.mjs examples/garden-path.json
node scripts/import-layout.mjs examples/garden-path.json --sql > /tmp/garden-path.sql
npx wrangler d1 execute murdoku-layouts --remote --file=/tmp/garden-path.sql
node scripts/import-layout.mjs ./my-layout.json \
  --post https://murdoku-grid.mocholate.workers.dev \
  --key "$GOOGLE_ID_TOKEN"
```

`--title` replaces the title in the file. `--key` and `GOOGLE_ID_TOKEN` are a Google ID token from a signed-in browser. `--sql` can take `--user-sub` so the inserted row belongs to that Google account; an empty `user_sub` stays hidden from every signed-in list. The command rejects an `http://` or `https://` path. The same command accepts a pasted board saved as a local `.html` file.

## Playground board paste

Sign in, then paste one board at a time into **Paste playground board** and choose **Convert paste**. The grid draws the rooms. Add marks with the existing tools. **Save current** stores it in D1. This does not fetch the playground site.

Two inputs convert to the same `h,r,c` / `v,r,c` walls:

**Board HTML.** Cells are `board-cell` elements in row-major order. `board-cell-crossed` and `board-cell-special-crossed` become an obstacle (`other`, unless the cell has `data-object`). A line is thick when its `--line-thickness` is about 10px (8px or more). Playground edges are `board-edge-horizontal` / `board-edge-vertical` buttons with `data-testid="edge-h-ROW-COL"` or `edge-v-ROW-COL` (boundary indexes: `edge-h-3-1` is `h,2,1`). `board-edge-fixed` is the outer border and is not a room wall. A `board-object-window` on an edge is stored as a window. Paste every line in order, including the thin ones, or mark internal lines with `data-after-row` / `data-after-col` (1-based). `data-cols` and `data-rows` set the size when the cell count is not a square.

**Compact JSON.** `thickH` and `thickV` are 1-based: the line after that row or column, across the whole board. `crossed` indexes are 0-based and row-major. `examples/four-rooms.json` is the 6×6 case with four 3×3 rooms:

```json
{
  "title": "Four rooms",
  "width": 6,
  "height": 6,
  "thickH": [3],
  "thickV": [3],
  "crossed": [5, 18, 23, 26, 29, 30]
}
```

After row 3 is `h,2,0` … `h,2,5`. After column 3 is `v,0,2` … `v,5,2`. The crossed indexes land on `(0,5)`, `(3,0)`, `(3,5)`, `(4,2)`, `(4,5)`, and `(5,0)` as `other` obstacles. A later save can replace `other` with a tree, table, or any other object.

## Schema

`migrations/0001_layouts.sql` creates the table. `migrations/0002_user_sub.sql` adds the owner column. `migrations/0003_windows.sql` adds `windows_json`:

- `id` — text primary key (UUID)
- `user_sub` — Google account `sub` that owns the row
- `title` — name
- `width`, `height` — columns and rows
- `walls_json` — room borders
- `windows_json` — window edges, same keys as walls
- `objects_json` — furniture and obstacles; safe to update on a later save
- `marks_json` — pencil marks, placements, and X cells
- `characters_json` — labels, which also drive the colors
- `created_at`, `updated_at` — ISO-8601 timestamps

`0002` and `0003` are plain `ALTER TABLE` statements. Run them once with `npm run db:migrate` before deploying the Worker that expects `user_sub` and `windows_json`. If migrate reports a duplicate column, the column is already present; continue with `npm run deploy`. The Worker also adds a missing column when it opens, so a database created by an earlier migration still loads.

## Local

API tests use an in-memory D1 stand-in (no Cloudflare login):

```bash
npm test
```

Click through the UI the same way. The board, paste, and import work before sign-in. Save and load ask for Google:

```bash
npm run dev:local
```

Open http://127.0.0.1:8787.

Wrangler’s local runtime does not need a secret:

```bash
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
npm run db:migrate
npm run deploy
```

`deploy.sh` applies the remote migration and deploys. There is no access-key secret to set. After deploy, add `https://murdoku-grid.mocholate.workers.dev` as an authorized JavaScript origin on the Google OAuth client so sign-in can complete.

Workers assets serve `index.html`. `/api/*` runs the Worker first, same pattern as `laukim/cube-learning` (`3x3coach`). `.assetsignore` keeps the Worker source, migrations, and `node_modules` off the public asset upload.

The workers.dev hostname is `murdoku-grid.mocholate.workers.dev`.
