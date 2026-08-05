# Activity Dashboard

React + Vite dashboard of GitHub activity for LF Decentralized Trust, OpenWallet
Foundation, and PQCA projects, published via GitHub Pages (`gh-pages` branch).
Activity data is exported from the `ghl` postgres database (a GitHub Archive
mirror) into per-day JSON files, then aggregated into the monthly files the
frontend reads from `public/data/`.

## Prerequisites

- Node.js + npm (`npm install` once)
- Rust toolchain (`cargo`) — builds the data exporter in `tools/update-data/`
- `gh` CLI authenticated with `read:enterprise` scope — for `bin/get-repos`
- `jq`
- `./setup` (gitignored) exporting `DATABASE_URL` for the ghl postgres server

## Updating the data

```sh
# 1. (occasionally) refresh the repo list from the GitHub enterprises
#    enterprises.json -> repos.json  (public repos only)
bin/get-repos

# 2. export events from postgres and rebuild public/data
#    dates are inclusive; with no args it regenerates 2014-01-01..today
bin/update-data                      # full regeneration
bin/update-data 2026-08-01           # incremental: from a date to today
bin/update-data 2026-08-01 2026-08-03  # explicit range
```

`bin/update-data` writes `new-actions/YYYY/YYYY-MM-DD.json` (one event JSON per
line; gitignored) for every org in `repos.json`, then runs `npm run aggregate`
(`scripts/aggregate.ts`), which rebuilds `public/data/YYYY-MM.json` and
`public/data/index.json` from scratch.

Only repos listed in `projects.json` appear in the dashboard; actors listed in
`block.json` (bots etc.) are excluded. Edit those and re-run `npm run
aggregate` — no database access needed.

## Local server

```sh
npm run dev        # Vite dev server with hot reload (serves public/data as-is)
```

Production build:

```sh
npm run build      # tsc + vite build -> dist/
npm run preview    # serve the dist build locally
```

## Publishing

```sh
bin/fix            # jq-normalize public/*.json, then commit + push gh-pages
```

`bin/fix` calls `bin/commit`, which commits everything staged and pushes to
`gh-pages`.
