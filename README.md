# Murdoku Grid Helper

Browser-based grid for solving Murdoku puzzles — pencil marks, long-press to place, room walls, obstacles, and more.

## Run locally

Open `index.html` in your browser, or:

```bash
python3 -m http.server 8080
```

Then visit http://localhost:8080

## Host publicly (free)

### Option A — Netlify (easiest)

1. Log in at [app.netlify.com](https://app.netlify.com)
2. Drag the `murdoku-grid` folder onto [app.netlify.com/drop](https://app.netlify.com/drop)
3. Netlify gives you a public URL like `https://your-name.netlify.app`

Or from this folder after `netlify login`:

```bash
chmod +x deploy.sh
./deploy.sh
```

### Option B — GitHub Pages

1. Create a new repo on GitHub (e.g. `murdoku-grid`)
2. Push this folder:

```bash
git remote add origin git@github.com:laukim/murdoku-grid.git
git push -u origin main
```

3. On GitHub: **Settings → Pages → Source: Deploy from branch → `main` / `/ (root)`**
4. Your site will be at `https://laukim.github.io/murdoku-grid/`
