# Deploying the playable game website (web mode)

This is the browser-playable Open Historia — the "play on a website" build. It's a
static app (served from a trusted origin) that keeps games client-side, sends AI keys
straight to the player's provider, and serves the world map from its own `assets/`
folder.

**Chosen setup:** app on **Cloudflare Pages**, with the map data inside the site. The
build downloads the six map files pinned in `scripts/map-assets.web.json` from the
`map-data` GitHub Release, verifies each one, and lays them under `dist-web/assets/`.
There is no content node to run and nothing to sign.

Prerequisites: a free Cloudflare account and Node.js 22 LTS or newer (the client build
runs on Vite 7; see the README).

---

## 1. Deploy the registry Worker (community hub proxy)

The site calls the registry Worker for one thing: community hub downloads
(`VITE_OH_HUB_URL`, the Worker's `/hub/file` route). Community bundles are files on
GitHub, and a browser cannot read those itself because GitHub sends no CORS header on
them. The map does not go through the Worker.

`.env.web` points `VITE_OH_HUB_URL` at the project's Worker. To run your own, deploy it
from the **open-historia-admin** repo:

```bash
cd registry
npx wrangler d1 create oh-accounts         # paste the returned id into wrangler.toml
npx wrangler d1 execute oh-accounts --remote --file schema.sql   # nodes, accounts, presence
npx wrangler kv namespace create NODES     # still used for small hot keys; paste the id in
npx wrangler secret put ADMIN_TOKEN        # a long random token
npx wrangler deploy                        # note the URL, e.g.
                                           #   https://open-historia-registry.<you>.workers.dev
```

> The node registry lives in **D1** (`nodes` table), not KV — KV's 1,000 writes/day free
> tier could not absorb node heartbeats. `schema.sql` also creates the accounts and
> presence tables.

## 2. Build the game for the web

From **this** repo:

```bash
npm install
npm run build:web
```

This produces `dist-web/`, with the map under `dist-web/assets/`: six files, about
69 MB, each under Cloudflare Pages' 25 MiB a file. The first build downloads them into
`map-cache/` (gitignored) and later builds reuse that cache. The build fails if a file
cannot be downloaded or does not match its pinned size and sha256. (Base path is `/`,
correct for Cloudflare Pages.)

To use your own Worker for the community hub, set its URL for the build:

```bash
# macOS/Linux
VITE_OH_HUB_URL="https://open-historia-registry.<you>.workers.dev" npm run build:web

# Windows PowerShell
$env:VITE_OH_HUB_URL="https://open-historia-registry.<you>.workers.dev"; npm run build:web
```

## 3. Deploy `dist-web/` to Cloudflare Pages

```bash
npx wrangler pages deploy dist-web --project-name open-historia
```

First run creates the project; it prints your URL (e.g. `https://open-historia.pages.dev`).
Add a custom domain in the Cloudflare Pages dashboard if you want.

## 4. The map (nothing to run)

The map is part of the site you deployed in step 3. No content node, node directory or
signed manifest is involved, and the admin panel is not needed for it.

The host must answer byte-range requests for static files, which Cloudflare Pages does.
To host the site somewhere else, use a server that does too: nginx, Caddy, Apache,
Netlify and GitHub Pages all do.

The site carries the map because a browser cannot fetch it from GitHub at run time:
neither the release download nor the API route sends an `Access-Control-Allow-Origin`
header on a release asset. The content-node software
([Open-Historia/open-historia-node](https://github.com/Open-Historia/open-historia-node))
still exists as a separate project, but the game no longer loads map data from it.

## 5. Play

Open your Pages URL. Players pick their AI provider and paste their own key in Settings
(it goes **straight to the provider** — nothing to configure server-side). Games are saved
in the browser (Export/Import for backups).

---

## Notes

- **The map is six static files under `assets/`:** `regions.pmtiles`, `countries.pmtiles`,
  `cities.pmtiles`, `regions-seed.geojson`, `default-regions.geojson` and
  `cities-seed.json`. If the world map is empty, check that they are in the deployed site
  and that the host answers a `Range` request for a `.pmtiles` file with a 206.
- **Nothing in the site is signed,** so no signing key is needed to build or deploy it.
- **Updating the game:** rebuild (`npm run build:web`) and re-run
  `wrangler pages deploy`. Everyone gets the update on their next load — no per-player step.
- **Updating the map:** the files are pinned in `scripts/map-assets.web.json`. A rebuild
  after that list changes downloads the new files and the next deploy carries them.
- **Local single-player is unaffected** by all of this — the downloadable app still runs
  its own server and never uses any of the web-mode code.
