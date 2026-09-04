# Delivery, Deploy & Releases

Open Historia ships to four surfaces from one repo: a **downloadable desktop app** (self-hosted local server), an **Android app** (embedded in-process server), the **playable website** (`openhistoria.com`, static app on Cloudflare Pages), plus supporting **Cloudflare Workers** (import counter, node registry). Which surface a commit reaches, and when, is decided by *which long-lived channel branch it lands on* (`main` / `beta` / `alpha`) and *which GitHub Actions workflow or local deploy engine fires*. This page maps every build script, workflow, release, and the local admin-panel deploy path, and traces how a single change flows out to players.

The Vite build has one pivotal switch — `--mode web` — that produces a *completely different* artifact from the default build (`vite.config.ts:65`). Almost everything below hangs off that distinction: desktop vs. web.

---

## 1. Build scripts (`package.json`)

Every delivery path starts with one of these npm scripts (`package.json:9`). The mode (`web` or not) is the load-bearing difference — it flips `import.meta.env.VITE_OH_WEB` into a compile-time literal so Rollup dead-code-eliminates the whole web (or desktop) runtime from the other build (`vite.config.ts:75`).

| Script | Command | Output dir | Mode | Base | Purpose |
|---|---|---|---|---|---|
| `build` | `vite build` | `dist/` | *(default/desktop)* | `/` | The desktop/local app bundle. Served by the Express server (`server/server.js`) and copied into the Android app. |
| `build:web` | `seed-web-defaults.mjs` → `vite build --mode web --outDir dist-web --emptyOutDir` | `dist-web/` | `web` | `/` | The browser game as a standalone Pages site (base `/`). Used by `WEB-DEPLOY.md`'s manual path. |
| `build:site` | `seed-web-defaults.mjs` → `vite build --mode web --base /play/ --outDir dist-web` → `assemble-site.mjs` | `dist-site/` | `web` | `/play/` | The **combined** `openhistoria.com`: landing page at `/`, game under `/play/`. This is what actually deploys to production. |
| `build:mobile-server` | `node scripts/build-mobile-server.mjs` | `mobile/nodejs-project/` | — | — | Assembles the embedded Node server for the APK. Runs *after* `build`. |
| `dev` / `dev:web` | `vite` / `seed-web-defaults.mjs && vite --mode web` | — | — | — | Local dev. `dev` proxies `/api` → `localhost:3000` (`vite.config.ts:87`). |

**The map-binary trap** (`vite.config.ts:10-60`): the ~160 MB pmtiles/geojson live in `public/` so the dev and Express servers can serve them off disk, but Vite copies `publicDir` wholesale into the bundle. Neither build wants them there (the desktop streams them via `/api/runtime/pmtiles/:assetKey`; the web build fetches them from content nodes). The `oh-drop-map-binaries` Vite plugin deletes them from the output in `closeBundle()` — pmtiles from both builds, plus the editor seeds (`regions-seed.geojson`, `cities-seed.json`) from the *web* build only. This matters because Cloudflare Pages rejects any file over 25 MiB, and `regions.pmtiles` is ~101 MB — so without the drop, `build:site` produces a site Pages refuses. The trap "only fires on a machine that has actually played" (the files are gitignored and only arrive from the `map-data` Release), which is why CI and fresh clones build fine and the failure looks random.

---

## 2. Branch topology & the PR-triplet convention

### Remotes (`work-repo`)

| Remote | URL | Role |
|---|---|---|
| `upstream` | `github.com/Open-Historia/open-historia` | Canonical org repo. Has `main`, `beta`, `alpha` branches. All CI runs here. |
| `beta` | `github.com/Arkniem/Open-Historia-Beta` | Beta fork lineage. |
| `origin` | `github.com/Arkniem/pax-historia-2` | Working fork. |
| `ltfork` | `github.com/lt20202122/open-historia` | Contributor fork. |

### The three long-lived channels

| Channel branch | What it feeds | CI trigger | Reaches players via |
|---|---|---|---|
| `main` | Stable | `app-bundle.yml` (push) → `app-stable` release; `deploy-site.yml` / admin-panel button → Cloudflare Pages | Desktop stable download; the live website |
| `beta` | Beta testers | `app-bundle.yml` (push) → `app-beta` release | Desktop beta download |
| `alpha` | Experimental staging | *(no push-triggered workflow)* — `android-apk-beta.yml` checks out `alpha` on demand | Only reaches users when its work is **bridged** into `beta`/`main`, or via a manually dispatched beta APK |

`alpha` is a staging branch with **no CI publish trigger of its own**. Work on `alpha` does not reach any installed app or the website until it is bridged forward into `beta` (then `main`). The one exception is `android-apk-beta.yml`, which is dispatch-only and always builds from `alpha` regardless of where it is run (§4.3).

### The PR-triplet convention

A single change is landed as **three parallel branches**, one per channel, and submitted as three PRs — one against `main`, one against `beta`, one against `alpha`. The naming is `<feature>-main` / `<feature>-beta` / `<feature>-alpha`. This is visible throughout the branch list, e.g.:

- `colony-labels-disputed-{alpha,beta,main}`
- `editor-verbatim-region-shade-{alpha,beta,main}`
- `fix/editor-autosave-{alpha,beta,main}`
- `ai-time-limit-toggle-{alpha,beta,main}`
- `date-salvage-{alpha,beta,main}`

Each triplet member targets its like-named channel because the three channels have diverged (different features in flight), so a change usually needs a per-channel port rather than a clean cherry-pick. PRs are submit-only; the maintainer merges (see the repo-conventions memory).

> **Commit/PR attribution:** commit as the account-linked identity; **no** Claude `Co-Authored-By` trailer and **no** "Generated with Claude Code" footer (repo policy).

---

## 3. GitHub Releases catalog

Delivery leans on **rolling releases** (fixed tags whose assets are re-uploaded with `--clobber`) rather than one release per version. This keeps a single stable download URL per surface.

| Release tag | Built by | From | Asset(s) | Prerelease? | For |
|---|---|---|---|---|---|
| `app-stable` | `app-bundle.yml` | push to `main` | `Open-Historia.zip` (source + map data) | no (`--latest=false`) | One-download desktop install, stable |
| `app-beta` | `app-bundle.yml` | push to `beta` | `Open-Historia.zip` | no (`--latest=false`) | One-download desktop install, beta |
| `android` | `android-apk.yml` | `workflow_dispatch` / `android-v*` tag | `open-historia.apk` | no | Stable Android app; the app self-updates from here |
| `android-beta` | `android-apk-beta.yml` *(off-main, §4.3)* | `workflow_dispatch`, checks out `alpha` | `pax-historia.apk` | **yes** (`--prerelease`) | Experimental in-app-server Android build; isolated from stable |
| `map-data` | *manually uploaded* | — | `regions.pmtiles`, `countries.pmtiles`, `cities.pmtiles`, `cities-seed.json`, `regions-seed-z8.geojson`, `default-regions-names.geojson` | — | The ~200 MB world-map binaries, off Git LFS (§7) |

The APK asset name is contractual — it (and the Android `appId`) must not change, because anything holding a fixed release/asset URL keeps pointing at the old name. It WAS changed, from `pax-historia.apk` to `open-historia.apk`, on 2026-09-04 (main `e29967e`, with the README and site/index.html updated to match). The old asset is still on the `android` release and is now frozen at the 2026-09-03 build, so anything still fetching it by name will never see another update. In practice the in-app check reads `apk` out of `android/latest.json` rather than a fixed filename — and that file does not exist and is written by no workflow, so the in-app Android update is inert either way. Decide which of those two to fix before renaming it again.

---

## 4. GitHub Actions workflows (`.github/workflows/`)

Three workflow files live on `main`. A fourth (`android-apk-beta.yml`) lives only on the beta-APK lineage.

### 4.1 `app-bundle.yml` — full-app one-download bundle

`.github/workflows/app-bundle.yml`. Packages the **whole app plus the world-map data** into one `Open-Historia.zip` so players install with a single download — no Git, no Git LFS, no separate map-data step.

| Aspect | Detail |
|---|---|
| Triggers | `workflow_dispatch`; push to `main` or `beta` |
| Map data | `node scripts/fetch-map-assets.mjs` writes the binaries into the tree (guarded: absent script → code-only bundle, never a failure) |
| Assemble | `rsync` the tree into `bundle/Open-Historia/` excluding `.git`, `.github`, `node_modules`, `dist`, `bundle`; restore exec bits on the `Launch`/`Update` scripts; `zip -r` |
| Channel pick | `github.ref_name == main` → tag `app-stable`; else → `app-beta` (`.github/workflows/app-bundle.yml:57`) |
| Publish | `gh release create <tag> --latest=false … || gh release edit …`; then `gh release upload <tag> Open-Historia.zip --clobber` |

Runs on **every** push to `main`/`beta` so the download never goes stale. The zip's launchers (`Launch Open Historia.{bat,command,sh}`) install deps, build, fetch map assets, and start the game at `http://localhost:3000`.

### 4.2 `android-apk.yml` — stable Android APK

`.github/workflows/android-apk.yml`. Builds the thin Android client (`mobile/`) with an **in-process** `nodejs-mobile` server and attaches the APK to the rolling `android` release.

| Aspect | Detail |
|---|---|
| Triggers | `workflow_dispatch`; push tag `android-v*` |
| Toolchain | Node 20, Temurin Java 21 |
| Build number | `sed` stamps `${{ github.run_number }}` into `mobile/www/index.html` over `__APP_BUILD__`. The boot screen compares this against `Build: N` in the release notes to decide whether to self-update (`.github/workflows/android-apk.yml:32`) |
| Build | `npm ci` → `npm run build` (produces `dist/`) → `node scripts/build-mobile-server.mjs` (assembles the embedded server) → in `mobile/`: `npm ci` → `npx cap sync android` → `./gradlew assembleDebug --no-daemon` |
| Collect | copies `app-debug.apk` → `open-historia.apk` |
| Publish | `gh release create android … || gh release edit android`; `gh release upload android open-historia.apk --clobber`; notes end with `Build: ${{ github.run_number }}` |

The embedded server must be assembled **before** `cap sync` copies it into the native app — that ordering is why `build-mobile-server.mjs` runs between `npm run build` and the Gradle step.

### 4.3 `android-apk-beta.yml` — experimental Android beta *(off-main)*

Lives on the `beta-apk-workflow` lineage (e.g. `upstream/beta-apk-workflow`), **not on `main`**. Builds the experimental embedded-node-server app and publishes to the **isolated `android-beta` pre-release**, leaving stable `android` and every installed stable app untouched.

| Aspect | Detail |
|---|---|
| Trigger | `workflow_dispatch` only |
| Source | `actions/checkout@v4` with `ref: alpha` — always builds `alpha`'s node-server code regardless of dispatch branch |
| Self-update redirect | `sed 's#releases/tags/android"#releases/tags/android-beta"#'` on `mobile/www/index.html`, so the beta polls `android-beta` and never nags a tester back to stable |
| Publish | `gh release create android-beta --prerelease … || gh release edit android-beta --prerelease …`; `--clobber` upload |

### 4.4 `deploy-site.yml` — website via CI *(superseded, still present)*

`.github/workflows/deploy-site.yml`. The original CI path for `openhistoria.com`. It still exists on `main` but is now **superseded by the local admin-panel deploy button** (§6); the token used to push branches lacks the `workflow` OAuth scope needed to delete the file, so it is left in place (website-deploy-button memory).

| Aspect | Detail |
|---|---|
| Triggers | `workflow_dispatch`; push to `main` with `paths-ignore` for `**.md`, `mobile/**`, `.github/**` (docs/app can't change what the site serves) |
| Concurrency | group `deploy-site`, `cancel-in-progress: true` — a newer push supersedes an in-flight deploy rather than racing it live |
| Build | `npm ci` → `npm run build:site` |
| Size guard | fails if any `dist-site` file exceeds 24 MiB (Pages rejects >25 MiB *after* reporting a green build) |
| Deploy | `cloudflare/wrangler-action@v3` → `pages deploy dist-site --project-name=open-historia --branch=main`. `--branch=main` is what marks it the **production** deployment; without it Pages treats it as a preview and the live domain keeps the old build |
| Secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

Why an Action rather than Git-connected Pages: the Pages project is direct-upload and Cloudflare can't convert those to Git-connected without a new project + domain move (downtime). CI is also "the one place the map-binary trap cannot fire" — a runner never has the gitignored pmtiles.

---

## 5. The website build pipeline (`build:site` → `assemble-site.mjs`)

`build:site` runs three stages in order, then hands off to the assembler:

1. `node scripts/seed-web-defaults.mjs` — bundles the built-in default scenario for the browser (§8).
2. `vite build --mode web --base /play/ --outDir dist-web` — the game, based at `/play/`.
3. `node scripts/assemble-site.mjs` — stitches `site/` (landing page) + `dist-web/` (game) into `dist-site/`.

### `scripts/assemble-site.mjs`

Produces `dist-site/`: landing page at `/`, game under `/play/`.

| Constant / step | Location | Behavior |
|---|---|---|
| `siteDir` = `site/` | `assemble-site.mjs:10` | Marketing landing page source (`index.html`, `_redirects`) copied to `dist-site/` root |
| `gameDir` = `dist-web/` | `assemble-site.mjs:11` | Web game (base `/play/`) copied to `dist-site/play/` |
| `outDir` = `dist-site/` | `assemble-site.mjs:12` | The deployable output |
| `ROOT_PAGES` | `assemble-site.mjs:22` | Pages that must answer at the **root** (`guides`, `get-started`, `how-to-play`, `ai-setup`, `self-hosting`, `pax-historia-alternative`, `sitemap`, `guides.css`, `robots.txt`, `sitemap.xml`). Their only copy lives in `public/` (so a local install serves them offline too); assembler lifts them out of `/play/` up to `/`. **A listed page that's missing fails the build** (a dropped page would otherwise 404 only to a crawler) |
| `ROOT_ASSETS` | `assemble-site.mjs:34` | Images referenced by absolute `/…` paths from both root guides and the game (`logo.png`, five `loading_screen*`, PWA icons, `screenshot.png`). Copied to `/` if present; **silently skipped** if renamed (a missing image is a cosmetic 404, not build-fatal) |
| Guard | `assemble-site.mjs:41` | Fatal if `dist-web/index.html` is missing (build the game first) |

The `--base /play/` split is why absolute `/logo.png` in the game needs a duplicate at the site root: under `/play/` an absolute URL resolves against the origin, not the base.

---

## 6. The local admin-panel deploy engine (primary website path)

The website is now deployed with a **button in the admin panel**, which runs on the maintainer's machine. Source: `open-historia-admin/panel/lib/deploy-site.mjs` (a separate private repo), driven by `open-historia-admin/panel/server.js`, with the button in `open-historia-admin/panel/public/index.html` and the standalone `open-historia-admin/admin-panel.html`.

### Why a git worktree, not an in-place build

`deploySite()` (`panel/lib/deploy-site.mjs:123`) never builds the maintainer's checkout. It maintains a **throwaway worktree pinned to `<remote>/main`** for three reasons (`deploy-site.mjs:6-19`):

1. "Deploy from main" must mean *main* — the maintainer's `work-repo` usually sits on a feature branch.
2. It sidesteps the map-binary trap for free — a freshly hard-reset worktree never has the gitignored pmtiles, so they can't be swept into `dist-site`.
3. It leaves the maintainer's working tree and `node_modules` untouched.

### Configuration (env-overridable)

| Var | Default | Meaning |
|---|---|---|
| `OH_SITE_REPO` | sibling `../../../work-repo` | The game repo (must have the `upstream` remote) |
| `OH_SITE_WORKTREE` | `../../.site-build` | The throwaway checkout; its `node_modules` persists between runs |
| `OH_SITE_REMOTE` | `upstream` | Remote to fetch/reset from |
| `OH_SITE_BRANCH` | `main` | Branch to deploy |
| `OH_PAGES_PROJECT` | `open-historia` | Cloudflare Pages project |
| `MAX_FILE_BYTES` | `24 * 1024 * 1024` | Local mirror of Pages' 25 MiB reject-after-green-build limit |
| `OH_DEPLOY_DRY_RUN` | — | Build + size-guard only; skip the actual publishes |
| `OH_DEPLOY_SKIP_WORKERS` | — | Deploy only the site, skip the two Workers |

### Steps (`deploySite`)

1. **Fetch** `upstream/main`; record the target commit (`deploy-site.mjs:130`).
2. **Prepare a clean tree** — if the worktree is registered, `git reset --hard upstream/main` + `git clean -fd` (no `-x`, so gitignored `node_modules` survives for a fast install); otherwise `git worktree add --force --detach` (`deploy-site.mjs:135`).
3. **Install** `npm install --no-audit --no-fund` in the worktree.
4. **Build** `npm run build:site`.
5. **Size guard** — recursive scan of `dist-site`; refuse to deploy if any file > 24 MiB (`deploy-site.mjs:153`).
6. **Deploy** `wrangler pages deploy dist-site --project-name=open-historia --branch=main --commit-dirty=true` (build output is untracked in the throwaway worktree by design). Parses the printed `*.pages.dev` URL from stdout.
7. **Deploy the Workers** (§6.1) unless skipped — the site is already live, so a worker failure is collected and reported, not treated as "nothing deployed."

Auth uses whatever `wrangler login` OAuth token (or `CLOUDFLARE_API_TOKEN`) is already on the machine; nothing secret is stored or read by this file.

### The button (`server.js` + panel HTML)

- `POST /api/deploy-site` (`panel/server.js:154`) sets a `deploying` mutex (409 if already running), then **streams** the log as `text/plain` one line per chunk; the final line is `DEPLOY_OK <url>` or `DEPLOY_FAILED <message>` so the client can tell how it ended.
- **CSRF guard** (`server.js:130`): `admin-panel.html` opens from `file://` (origin `null`), so the Deploy button hits this endpoint cross-origin. Allowed only when Origin is absent/`null` or a `localhost`/`127.0.0.1`/`[::1]` host — never a real website. Origin can't be forged by a browser, making it a reliable guard.
- The 🚀 button ("Deploy website + workers") lives at `panel/public/index.html:51` and `admin-panel.html:73`; it confirms, POSTs, and renders the live log.

### 6.1 Workers that ride every site deploy (`WORKERS`, `deploy-site.mjs:44`)

Two Cloudflare Workers deploy alongside the site so merged worker code can never sit undeployed while the website moves on (this happened once — the import-counter shipped in a PR and served stale code for days because nothing ran `wrangler deploy`). Each is skipped with a log line if its `wrangler.toml` is absent.

| Worker | Deployed from | Source of truth | Why there |
|---|---|---|---|
| import-counter | `<worktree>/tools/import-counter` | the game repo (`main`) | Deploys *exactly* merged main, never a local edit |
| registry | `open-historia-admin/registry` (admin repo, next to the panel) | the admin repo | Its code lives in the admin repo, not the game repo |

---

## 7. Cloudflare Workers (the control/edge plane)

### 7.1 Import counter — `tools/import-counter/`

A tiny Worker that counts community-scenario imports. The game server pings it once per successful install via `server/server.js` → `/api/hub/import-log` (`server/server.js:657`), giving real numbers even for scenarios GitHub can't count (issue attachments).

| Item | Value |
|---|---|
| Worker name | `oh-import-counter` (`tools/import-counter/wrangler.toml`) |
| Entry | `worker.js` |
| Storage | KV binding `IMPORTS` (counts live in each key's metadata so `/counts` is one list call) |
| Default URL baked into the app | `https://oh-import-counter.nichojkrol.workers.dev` (`server/server.js:654`) |
| Override | `OH_IMPORT_COUNTER_URL` env on the game server |
| Dedup | Website: once per **account _and_ IP** (skip if either seen); app/anonymous web: once per **IP**. Raw IPs never stored — hashed with `HASH_SALT` |
| Read routes | `/counts` (all), `/count/<hub-issue-number>` (one) |

### 7.2 Node registry — `open-historia-admin/registry/`

The web-mode control plane (source of truth: the admin repo). Serves the signed node directory, proxies map content, and hosts hub + accounts. Worker name `open-historia-registry`.

| Binding | Kind | Purpose |
|---|---|---|
| `NODES` | KV | Small hot keys + TTL items (magic-link tokens, sessions via `acct:`/`magic:`/`sess:` prefixes) |
| `OH_ACCOUNTS` | D1 (`oh-accounts`) | Nodes table, users, sessions, wrapped account keys, encrypted sync blobs; schema in `registry/schema.sql` |
| `IMPORT_COUNTER` | Service binding → `oh-import-counter` | Direct binding because a Worker can't reach another same-account Worker via its public `workers.dev` URL (subrequest silently never arrives) |
| `EMAIL` | Email Sending | Magic-link emails, sent by the Worker itself |

The **admin panel** (`open-historia-admin/panel/server.js`) is the human interface to the registry: it lists nodes, accepts/pauses/bans/rate-limits/redirects them, and after **any** change rebuilds the node directory, signs it with the offline root key (`oh-root.key.pem`), and POSTs it to the registry, which serves it live to players and nodes (`panel/server.js:66`). No game rebuild is needed for a directory change.

The web game points at the registry through build-time env (`.env.web`):

| `VITE_OH_*` flag | Value | Used for |
|---|---|---|
| `VITE_OH_WEB` | `1` | The compile-time web/desktop switch |
| `VITE_OH_PMTILES_URL` | `…workers.dev/content` | Map tiles served/proxied by the registry |
| `VITE_OH_DIRECTORY_URL` | `…/node-directory.json` | The signed content-node directory |
| `VITE_OH_HUB_URL` / `VITE_OH_ACCOUNT_URL` | `…workers.dev` | Scenario hub + magic-link accounts/sync |
| `VITE_OH_GOOGLE_CLIENT_ID` | *(client id)* | Google sign-in |

---

## 8. Map-data Release & `fetch-map-assets.mjs`

The ~200 MB world-map binaries left Git LFS (whose free 1 GB/mo org-wide bandwidth was exhausted by a handful of full checkouts, then 403'd) and now ship as assets on the `map-data` GitHub Release, whose download bandwidth is free and unmetered.

- **Manifest:** `scripts/map-assets.json` — `owner`/`repo`/`release` (`Open-Historia`/`open-historia`/`map-data`) plus each asset's `path`, release `asset` name, `bytes`, and `sha256`.
- **Fetcher:** `scripts/fetch-map-assets.mjs` makes the local tree match the manifest. Full run verifies SHA-256 and re-fetches anything missing or changed; `--ensure` trusts byte-size for speed. **Best-effort — never exits non-zero**, so it can never block a launch, update, or the `app-bundle.yml` bundle step. Downloads to a `.download` temp then atomic-renames.
- **Name namespaces:** the manifest maps a *versioned* release asset name to a *stable* local path — e.g. `regions-seed-z8.geojson` (release) → `public/assets/regions-seed.geojson` (tree), and `default-regions-names.geojson` → `server/data/scenarios/default/regions.geojson`. The client always reads the stable path.
- **Callers:** the app launchers/updater and `app-bundle.yml` call it in place of `git lfs pull`. **Never re-add these files to Git LFS.**

When a map file changes: upload the new asset to the `map-data` Release, then update its `sha256` + `bytes` in `scripts/map-assets.json`.

---

## 9. Mobile embedded-server assembly (`build-mobile-server.mjs`)

`scripts/build-mobile-server.mjs` populates `mobile/nodejs-project/` with everything `nodejs-mobile` needs to run the real Express server in-process inside the APK. It runs **after** `vite build` (it needs `dist/`) and is idempotent (wipes and rebuilds copied dirs, leaving the committed `main.js` / `fetchMapAssets.mjs` alone).

| Step | What it copies/does |
|---|---|
| 1 | `server/` verbatim; `dist/` **minus** heavy map files (`copyLight` strips `*.pmtiles`, `*.geojson`, `cities-seed.json`) |
| 2 | `public/lang/` (the server's read-only lang fallback); `public/assets` pmtiles intentionally excluded |
| 3 | `seed/` = default scenarios + `scenario-manifest.json` + `game-manifest.json`, minus heavy map files |
| 4 | `scripts/map-assets.json` → the first-run map fetch manifest |
| 5 | Writes a minimal `package.json` whose only runtime dep is `express`, pinned to the root's version so the phone runs the same Express as desktop |
| 6 | `npm install --omit=dev` into the project so the APK bundles `node_modules` (skip with `--no-install`) |

The ~200 MB map binaries deliberately never ship in the APK — the app downloads them on first run (`mobile/nodejs-project/fetchMapAssets.mjs`).

---

## 10. Web-mode seed (`seed-web-defaults.mjs`)

`scripts/seed-web-defaults.mjs` runs only from `build:web` / `build:site` / `dev:web`. It bundles the built-in `default` scenario (`server/data/scenarios/default`) into JS modules under `src/runtime/web/generated/` (git-ignored) so a fresh browser can seed its IndexedDB library with a playable scenario. The desktop build never imports these, so no seed data ships in the download.

| Output | Content |
|---|---|
| `defaultScenario.js` | `{ meta, cover (base64), colors, data{game,prompts,world,actions,advisor,chat,events} }` |
| `countryNames.js` | Canonical code→name registry, mirroring `server/country-names.json` (used by `canonicalizeCountryRef`) |
| `fallbackColors.js` | App-level default palette from `public/assets/colors.json`, immutable & scenario-independent |

It reads only from `server/data`, which **is** committed — so the website build (including CI) needs nothing from the `map-data` Release.

---

## 11. End-to-end: how a change reaches each surface

| Surface | Landing branch | Build artifact | Delivery mechanism | Player action |
|---|---|---|---|---|
| **Desktop (stable)** | `main` | `Open-Historia.zip` on `app-stable` | `app-bundle.yml` on push | Download zip once, or run "Update Open Historia" |
| **Desktop (beta)** | `beta` | `Open-Historia.zip` on `app-beta` | `app-bundle.yml` on push | Download the beta zip |
| **Android (stable)** | `main` (mobile client) | `open-historia.apk` on `android` | `android-apk.yml` (dispatch / `android-v*` tag) | App self-updates by comparing `Build: N` |
| **Android (beta)** | `alpha` | `pax-historia.apk` on `android-beta` | `android-apk-beta.yml` (dispatch, off-main) | Sideload from the pre-release; self-updates from `android-beta` |
| **Website** | `main` | `dist-site/` | Admin-panel 🚀 button → clean `upstream/main` worktree → `build:site` → `wrangler pages deploy` (or legacy `deploy-site.yml`) | Nothing — next page load |
| **Import counter Worker** | `main` | `tools/import-counter/worker.js` | Rides the admin-panel site deploy from the same worktree | — |
| **Registry Worker** | admin repo | `registry/worker.js` | Rides the site deploy from the admin repo dir | — |
| **Node directory** | *runtime data* | signed JSON | Admin panel re-signs + POSTs to the registry on any node change | Live, no rebuild |
| **Map binaries** | *manual* | Release assets | Uploaded to `map-data`; fetched by `fetch-map-assets.mjs` at launch/update/bundle | Downloaded on first run |

Key asymmetries a newcomer should internalize:

- **A push to `main` or `beta` re-ships the desktop zip automatically; a push does *not* ship the website or the APK.** The website waits for a maintainer to click 🚀 (or dispatch `deploy-site.yml`); the APK waits for a `workflow_dispatch` or an `android-v*` tag.
- **`alpha` ships nothing on its own** — it only reaches users via the manually dispatched `android-beta` build, or once bridged into `beta`/`main`.
- **Worker code and website move together** through the admin-panel deploy engine, precisely to stop merged worker code from sitting undeployed.
- **Map data is decoupled from code** — a code release does not re-cut the map; a map change is a manual Release upload + manifest edit.

---

## 12. Traps & invariants

- **Never re-add map binaries to Git LFS** — they live on the `map-data` Release only (§8).
- **Never let a pmtiles/large geojson into a Pages build** — the `oh-drop-map-binaries` plugin, both CI size guards, and the local deploy engine's `findOversized` all defend the 25 MiB Pages limit, which rejects *after* a green build (`vite.config.ts:43`, `deploy-site.yml:58`, `deploy-site.mjs:95`).
- **The Android `appId` must never change.** The APK asset name was changed once (`pax-historia.apk` → `open-historia.apk`, 2026-09-04); the old asset is frozen on the release. See §4.2 before doing it again.
- **Assemble the mobile server before `cap sync`** — `android-apk.yml` runs `build-mobile-server.mjs` between `npm run build` and Gradle.
- **`ROOT_PAGES` is fail-hard, `ROOT_ASSETS` is fail-soft** — a dropped root *page* fails `build:site`; a dropped root *image* is only a cosmetic 404 (`assemble-site.mjs:46`, `:59`).
- **`deploy-site.yml` is superseded but still on `main`** — the admin-panel button is the live path; the yml stays because the pushing token lacks the `workflow` scope to delete it.
- **`--branch=main` / `--branch=<BRANCH>` is what makes a Pages upload production** — omit it and the live domain keeps the old build while the deploy still reports success.

---

### See also

- [World state](world-state.md) — the `world.json` shape that scenarios and the web seed carry
- [Web mode & content nodes](web-mode.md) — how the browser build resolves map data from the signed directory
- [Scenario hub](hub-and-scenarios.md) — the import flow that feeds the import counter
