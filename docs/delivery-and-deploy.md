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
| `build:android` | `node scripts/seed-web-defaults.mjs && vite build --mode android --outDir dist-android --emptyOutDir` | `dist-android/` | `VITE_OH_WEB` + `VITE_OH_NATIVE` | `.env.android` | The Android app's bundle. `mobile/scripts/stage-www.mjs` then lays the verified map data under `www/assets`. |
| `dev` / `dev:web` | `vite` / `seed-web-defaults.mjs && vite --mode web` | — | — | — | Local dev. `dev` proxies `/api` → `localhost:3000` (`vite.config.ts:87`). |

**The map-binary trap** (`vite.config.ts:10-60`): the ~160 MB pmtiles/geojson live in `public/` so the dev and Express servers can serve them off disk, but Vite copies `publicDir` wholesale into the bundle. Neither build wants them there (the desktop streams them via `/api/runtime/pmtiles/:assetKey`; the web build fetches them from content nodes). The `oh-drop-map-binaries` Vite plugin deletes them from the output in `closeBundle()` — pmtiles from both builds, plus the editor seeds (`regions-seed.geojson`, `cities-seed.json`) from the *web* build only. This matters because Cloudflare Pages rejects any file over 25 MiB, and `regions.pmtiles` is ~101 MB — so without the drop, `build:site` produces a site Pages refuses. The trap "only fires on a machine that has actually played" (the files are gitignored and only arrive from the `map-data` Release), which is why CI and fresh clones build fine and the failure looks random.

---

## 2. Branch topology & the PR-triplet convention

### Remotes (`work-repo`)

| Remote | URL | Role |
|---|---|---|
| `upstream` | `github.com/Open-Historia/open-historia` | Canonical org repo. Has `main`, `beta`, `alpha` branches. All CI runs here. |
| `beta` | `github.com/Arkniem/Open-Historia-Beta` | Beta fork lineage. |
| `origin` | the maintainer's personal fork on GitHub (`Arkniem`) | Working fork. |
| `ltfork` | `github.com/lt20202122/open-historia` | Contributor fork. |

### The three long-lived channels

| Channel branch | What it feeds | CI trigger | Reaches players via |
|---|---|---|---|
| `main` | Stable | `app-bundle.yml` (push) → `app-stable` release; `deploy-site.yml` / admin-panel button → Cloudflare Pages; `android-apk.yml` (dispatch) → `android` release | Desktop stable download; the live website; the Android app |
| `beta` | Beta testers | `app-bundle.yml` (push) → `app-beta` release; `android-apk-beta.yml` (dispatch) → `android-beta` release | Desktop beta download; the Android beta app |
| `alpha` | Experimental staging | *(no push-triggered workflow)* | Only reaches users when its work is **bridged** into `beta`/`main` |

`alpha` is a staging branch with **no CI publish trigger of its own**. Work on `alpha` does not reach any installed app or the website until it is bridged forward into `beta` (then `main`).

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
| `desktop-stable-chunks`, `desktop-beta-chunks` | the same two workflows (`scripts/publish-update-chunks.mjs`) | the same runs | The app's own files cut into chunks: `c-<hash>.bin` (about 180 a build, each uploaded once), the manifests `m-<hash>.json`, and one head per system, `payload-{win,mac,linux}.json`, the only files replaced | no (`--latest=false`) | The desktop app, which updates by fetching the chunks that changed (§11.2). Nothing here is downloaded by hand |
| `android` | `android-apk.yml` | `workflow_dispatch` from `main` / `android-v*` tag | `open-historia.apk`, `latest.json` | no | The Android app (the `appId` in `mobile/capacitor.config.json`); it self-updates from here |
| `android-beta` | `android-apk-beta.yml` (§4.3) | `workflow_dispatch` from `beta` / `android-beta-v*` tag | `open-historia-beta.apk`, `latest.json` | **yes** (`--prerelease`) | The Android beta, "Open Historia Beta" (the stable id + `.beta`): a second app beside the stable one, with its own saves; it self-updates from here |
| `map-data` | *manually uploaded* | — | `regions.pmtiles`, `countries.pmtiles`, `cities.pmtiles`, `cities-seed.json`, `regions-seed-z8.geojson`, `default-regions-names.geojson` | — | The ~200 MB world-map binaries, off Git LFS (§7) |

The APK asset names are contractual — they, and the two Android application ids (the `appId` in `mobile/capacitor.config.json`, and the beta's, the same id + `.beta`), must not change, because anything holding a fixed release/asset URL keeps pointing at the old name, and a new id is a new app beside the old one. The stable name WAS changed, from the project's earlier name to `open-historia.apk`, on 2026-09-04 (main `e29967e`, with the README and site/index.html updated to match); the old asset has since been deleted. The in-app update banner reads `apk` out of the release's `latest.json`, which each Android workflow writes beside its APK.

---

## 4. GitHub Actions workflows (`.github/workflows/`)

Three workflow files live on `main`. `android-apk-beta.yml` (§4.3) is there too, only so its Run workflow entry appears; it refuses to run from anything but `beta`.

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

`.github/workflows/android-apk.yml`. Builds the Android app (`mobile/`) — the `--mode android` web bundle with the world map inside the APK — and attaches the APK and its update manifest to the rolling `android` release.

| Aspect | Detail |
|---|---|
| Triggers | `workflow_dispatch` from `main` (from any other branch its first step fails: a dispatch from `beta` once published the beta's code as the stable app, build 14 on 2026-09-25); push tag `android-v*` |
| Toolchain | Node 24, Temurin Java 21 |
| Build number | `VITE_APP_BUILD=${{ github.run_number }}` is baked into the bundle and `OH_ANDROID_BUILD` becomes `versionCode`/`versionName`; the update banner compares the bundle's number against `latest.json` |
| Build | `npm ci` → `npm run build:android` (→ `dist-android/`) → in `mobile/`: `npm ci` → `npm run map` (map data, cached on the manifest hash) → `npm run www` → `npx cap sync android` → `./gradlew assembleRelease` with the `ANDROID_KEYSTORE_*` secrets, or `assembleDebug` without them |
| Collect | copies the APK → `open-historia.apk` |
| Publish | `gh release create android … || gh release edit android`; uploads `open-historia.apk` and `latest.json` (`{ build, apk, notes }`) with `--clobber` |

The map data must be staged **before** `cap sync` copies `www/` into the native project — that ordering is why `npm run map` and `npm run www` run between the bundle build and the Gradle step. One keystore for the life of the app: a fresh debug keystore on each runner is a different certificate, and Android refuses to install over a package signed with another one.

### 4.3 `android-apk-beta.yml` — the Android beta app

`.github/workflows/android-apk-beta.yml`. The same build as §4.2 with the channel set to beta, which makes it a second app, as `desktop-beta.yml` makes the desktop beta: "Open Historia Beta", application id = the stable id + `.beta`, the compass with a BETA banner for its icon. It installs **beside** the stable app rather than over it, keeps its own saves (a package's WebView storage is its own; Export and Import carry games across), and updates itself from its own release. Same keystore as the stable app.

| Aspect | Detail |
|---|---|
| Triggers | `workflow_dispatch` from `beta` (from any other branch its first step fails; the copy on `main` is only there for the Run workflow entry); push tag `android-beta-v*`, which the stable `android-v*` does not match |
| Channel | `OH_ANDROID_CHANNEL=beta`: `mobile/android/app/build.gradle` picks the application id, `versionName` `1.0.N-beta` and the manifest placeholders `appLabel` / `appIcon` / `appIconRound` (the icons come from `scripts/make-android-beta-icons.ps1`, committed) |
| Update feed | `VITE_APP_TRACK=beta`: the web router reads `android-beta/latest.json`, so a tester is never offered the stable build; `versionCode` is this workflow's own run number |
| Publish | `gh release create android-beta --prerelease …` or `gh release edit android-beta --prerelease …`; uploads `open-historia-beta.apk` and `latest.json` with `--clobber` |

`server/androidBetaPackaging.test.js` holds these together, and the stable workflow to the `android` release. The file replaced an experimental embedded-node-server build (2026-07) that checked out `alpha` and never ran green.

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

### 7.1 Import counter — `tools/import-counter/` (retired)

A scenario's import count is how many times its file has been downloaded from the community hub's **releases**, as GitHub counts it. The hub repository's workflow checks each post's attachment, puts a checked copy of it in a release, adds the downloads up every half hour, and writes them to `index.json` on its `hub-index` branch, with where each copy is, the list of released posts and the suggestions it has checked; the game reads that file from `raw.githubusercontent.com` (`src/runtime/hubFiles.js`), which costs no API request. That index is also the game's only list of the hub's posts, and the copies it names are the only hub files the game downloads: a post's own attachment is never fetched, and GitHub's API is asked for nothing but a post's comments. See [runtime-services.md](runtime-services.md).

Until 2026-10-05 the count was kept by this Worker in KV, pinged once per install through `/api/hub/import-log`. One KV `list()` per read of `/counts` and a write per import spent the free plan's daily KV allowance within hours of every day, after which nobody saw any counts. Those routes, `OH_IMPORT_COUNTER_URL` and the ping are gone from the game.

Builds from before the change still call the Worker, so it still answers them, from the hub's index, and stores nothing (`worker.js`; `server/importCounterWorker.test.js`):

| Item | Value |
|---|---|
| Worker name | `oh-import-counter` (`tools/import-counter/wrangler.toml`) |
| `GET /counts`, `GET /count/<post>` | The hub index's counts, in the shapes the old builds read; the index is kept five minutes at the edge |
| `POST /hit` | Accepted and ignored. An import made by a build that downloads the attachment is therefore not counted; one made by a build that downloads the release copy is counted by GitHub |
| Storage | None. The `IMPORTS` KV binding is unused and can be removed with the namespace; what it had counted is carried in the hub's numbers (`data/legacy-import-counts.json` there) |

It rides the site deploy from the admin panel (§6.1).

### 7.2 Node registry — `open-historia-admin/registry/`

The web-mode control plane (source of truth: the admin repo). Serves the signed node directory, proxies map content, and hosts hub + accounts. Worker name `open-historia-registry`.

| Binding | Kind | Purpose |
|---|---|---|
| `NODES` | KV | Small hot keys + TTL items (magic-link tokens, sessions via `acct:`/`magic:`/`sess:` prefixes) |
| `OH_ACCOUNTS` | D1 (`oh-accounts`) | Nodes table, users, sessions, wrapped account keys, encrypted sync blobs; schema in `registry/schema.sql` |
| `IMPORT_COUNTER` | Service binding → `oh-import-counter` | For the older builds' `/hub/import-log` and `/hub/import-counts` (§7.1; this build calls neither). A direct binding because a Worker can't reach another same-account Worker via its public `workers.dev` URL (subrequest silently never arrives) |
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
- **Name namespaces:** the manifest maps a *versioned* release asset name to a *stable* local path — e.g. `regions-seed-z8.geojson` (release) → `public/assets/regions-seed.geojson` (tree), and `default-regions-names.geojson` → `server/data/stock/regions.geojson` (the stock world every scenario without a map of its own renders on; it used to be the built-in scenario's file). The client always reads the stable path. The built-in scenario's own map is not on the release at all: it ships in the app as `server/seed/default/regions.geojson` (see [Assets](assets-and-data.md) §3).
- **Callers:** the app launchers/updater and `app-bundle.yml` call it in place of `git lfs pull`. **Never re-add these files to Git LFS.**

When a map file changes: upload the new asset to the `map-data` Release, then update its `sha256` + `bytes` in `scripts/map-assets.json`.

---

## 9. Android staging (`mobile/scripts/`)

The Android app has no server of its own: it is the `--mode android` web bundle, and the world map ships **inside** the APK. Two scripts in `mobile/scripts/` put it together; both are idempotent.

| Script | What it does |
|---|---|
| `stage-map-assets.mjs` (`npm run map`) | Downloads the six files in `mobile/map-assets.android.json` from the `map-data` release into `mobile/map-cache/` and verifies size + sha256; a file already present and correct is skipped. The archives are the z8 trims (`scripts/trim-pmtiles.mjs`): regions 21.1 MB, countries 12.6 MB — the map never renders past z8 — plus `cities.pmtiles`, the 12.8 MB `default-regions.geojson`, `regions-seed.geojson` and `cities-seed.json`. The 55 MB desktop-only variants never ship. |
| `stage-www.mjs` (`npm run www`) | Copies `dist-android/` into `mobile/www/`, prunes the website-only files (marketing pages, screenshots, sitemap, the signed node directory), and lays `map-cache/*` under `www/assets/`. |

`build.gradle` stores `*.pmtiles` uncompressed (`androidResources { noCompress 'pmtiles' }`) so a Range read never inflates from byte 0; `versionCode`/`versionName` come from `OH_ANDROID_BUILD`; the `release` type signs with `OH_ANDROID_KEYSTORE` when set and the debug key otherwise. See [mobile.md](mobile.md).

---

## 10. Web-mode seed (`seed-web-defaults.mjs`)

`scripts/seed-web-defaults.mjs` runs only from `build:web` / `build:site` / `dev:web`. It bundles the built-in `default` scenario (`server/seed/default`) into JS modules under `src/runtime/web/generated/` (git-ignored) so a fresh browser can seed its IndexedDB library with a playable scenario; the scenario's own map (`regions.geojson`, ~5.6 MB) is copied beside them and becomes a hashed static asset of the web build, referenced from `defaultScenarioMeta.js`. The desktop build never imports these, so no seed data ships in the download.

| Output | Content |
|---|---|
| `defaultScenario.js` | `{ meta, cover (base64), colors, data{game,prompts,world,actions,advisor,chat,events} }` |
| `countryNames.js` | Canonical code→name registry, mirroring `server/country-names.json` (used by `canonicalizeCountryRef`) |
| `fallbackColors.js` | App-level default palette from `public/assets/colors.json`, immutable & scenario-independent |

It reads only from `server/seed/default`, which **is** committed (map included) — so the website build (including CI) needs nothing from the `map-data` Release.

---

## 11. End-to-end: how a change reaches each surface

| Surface | Landing branch | Build artifact | Delivery mechanism | Player action |
|---|---|---|---|---|
| **Desktop (stable)** | `main` | `Open-Historia.zip` on `app-stable` | `app-bundle.yml` on push | Download zip once, or run "Update Open Historia" |
| **Desktop (beta)** | `beta` | `Open-Historia.zip` on `app-beta` | `app-bundle.yml` on push | Download the beta zip |
| **Android (stable)** | `main` | `open-historia.apk` on `android` | `android-apk.yml` (dispatch from `main` / `android-v*` tag) | Install once; the app self-updates from `android/latest.json` |
| **Android (beta)** | `beta` | `open-historia-beta.apk` on `android-beta` | `android-apk-beta.yml` (dispatch from `beta` / `android-beta-v*` tag) | Install from the pre-release, beside the stable app; self-updates from `android-beta/latest.json` |
| **Website** | `main` | `dist-site/` | Admin-panel 🚀 button → clean `upstream/main` worktree → `build:site` → `wrangler pages deploy` (or legacy `deploy-site.yml`) | Nothing — next page load |
| **Import counter Worker** (retired, §7.1) | `main` | `tools/import-counter/worker.js` | Rides the admin-panel site deploy from the same worktree | — |
| **Registry Worker** | admin repo | `registry/worker.js` | Rides the site deploy from the admin repo dir | — |
| **Node directory** | *runtime data* | signed JSON | Admin panel re-signs + POSTs to the registry on any node change | Live, no rebuild |
| **Map binaries** | *manual* | Release assets | Uploaded to `map-data`; fetched by `fetch-map-assets.mjs` at launch/update/bundle | Downloaded on first run |

Key asymmetries a newcomer should internalize:

- **A push to `main` or `beta` re-ships the desktop zip automatically; a push does *not* ship the website or the APK.** The website waits for a maintainer to click 🚀 (or dispatch `deploy-site.yml`); the APK waits for a `workflow_dispatch` or an `android-v*` tag.
- **`alpha` ships nothing on its own** — it reaches users only once bridged into `beta`/`main`.
- **Worker code and website move together** through the admin-panel deploy engine, precisely to stop merged worker code from sitting undeployed.
- **Map data is decoupled from code** — a code release does not re-cut the map; a map change is a manual Release upload + manifest edit.

### 11.1 How an installed desktop game updates

Opening the game installs a waiting update; the update banner (`src/runtime/AppUpdateBanner.jsx`) is for an update found while the game is already open.

- **As the game opens** (Windows, Linux): `electron/launchUpdate.cjs`, from `boot()` in `electron/main.cjs` before the map check and the server: `checkForUpdates` against the release's `latest*.yml`, capped at 6 s. Nothing newer, offline or slow: no window, the game opens. An update: the setup window shows "Updating Open Historia" with its progress, then `quitAndInstall(true, true)` (silent, reopens on the new version). **Open the game now** opens the game at once; the download carries on and installs when the game is closed (`autoInstallOnAppQuit`), and the banner shows how far it got.
- **The beta offer:** the stable app's update screen also offers **Download the beta** (`betaOffer`, `setup:open-beta`): the beta's Windows installer, or its release page on other systems, opened in the player's browser while the update goes on. The beta is a separate app with its own saves, and its own update screen makes no such offer.
- **A version that fails to download at launch twice** is left to the banner (`launch-update.json` in the app's user-data folder); a newer version starts again from zero.
- **While it is open:** the banner. **Update now** downloads, **Restart now** installs.
- **Downloads are always full** (`disableDifferentialDownload`): every installer is published under one fixed name on a rolling release, so the old block map electron-updater would compare against is the new one.
- **macOS:** an update made of chunks installs itself as on the other systems (§11.2; not yet run on a Mac). One that needs the installer does nothing at launch (Squirrel.Mac needs a signed app, and the build is unsigned); the banner links to the new zip.

Tests: `server/launchUpdate.test.js`.

### 11.2 An update made of chunks

The installer is about 140 MB, and an update used to be all of it again, although most of it had not changed: the Electron runtime never, and most of the app's own files not either. So a release also publishes the app's own files (everything inside `app.asar`: the built client, the server, the language packs, the node modules; 142 MB in some 9,500 files) cut into chunks, each a file of its own on a release, and an installed app fetches only the chunks it cannot make from the files it already has. The desktop row of §11.1 is unchanged by it: the same check as the game opens, the same screen, the same banner. What is fetched is smaller, and there is no installer to run.

- **Cutting** (`electron/payloadChunks.cjs`, run by `scripts/build-update-chunks.mjs` on what electron-builder packed). A file of 256 KB or more is cut where its own content says to: a rolling hash decides, never before 256 KB and always by 4 MB, so an edit moves the cuts around the edit and nowhere else, and the chunks before and after it are last release's. A smaller file shares a chunk, a *pack*, with other small files of its own part of the app (24 packs for `node_modules`, 24 for `dist`, 16 for `server`, 4 for the rest), chosen by its name without the build's stamp, so a rebuilt `index-<hash>.js` stays in its pack and an edited server file does not cost a slice of the node modules. Every number is fixed, because the app cuts the files it has the same way to find their chunks; changing one needs a new `FORMAT`.
- **Measured** on a packed build of this branch: 183 chunks, the largest 3.0 MB. A second build with one line changed in the client and one in the server had 162 of them unchanged: 21 chunks, 11.4 MB, to fetch (Vite renamed 33 bundles for that one line, which is most of it). The app's own updater took 15 s to do it from a local server, nearly all of it putting the 9,500 files in place.
- **Publishing** (`scripts/publish-update-chunks.mjs`). A chunk is `c-<hash>.bin` on the `desktop-stable-chunks` or `desktop-beta-chunks` release (§3), named by its content, so one already there is the same bytes and is never uploaded again or replaced. The manifest, which lists every file with its hash and its parts (2.3 MB), goes up the same way as `m-<hash>.json`. Last goes the head, `payload-win.json` / `payload-mac.json` / `payload-linux.json`: 300 bytes under a fixed name, saying which build is published, the Electron it runs on and which manifest describes it. So an app is never told of a build whose chunks are not all there. The three systems' builds share every chunk their files share. A release holds 1,000 files: `--prune-unreferenced` removes the chunks and manifests no head leads to any more (never one uploaded in the last six hours, which another system's job may be about to name); without it the publish stops, with a message, before the release is full. The workflows do not pass it.
- **Updating** (`electron/payloadUpdate.cjs`). The app reads the head, which is all a start with nothing newer fetches. For a newer build on its own Electron it reads the manifest (checked against the hash the head gives), hashes the files it has, fetches the chunks it lacks (four at a time; each checked against its name; three attempts; a chunk fetched before a failure or a Cancel is kept for the next attempt) and puts the new set together under `<userData>/app-payload/<build>/`. An unchanged file is copied (or linked, from a set an earlier update made); a changed one is made of the chunks read out of the old file and the ones fetched. Every file is checked against the manifest before it is written, and only then is `app-payload/current.json` written. Nothing touches the files that are running, and a failure at any point leaves the app as it was.
- **Starting** (`electron/bootstrap.cjs`, which is `package.json`'s `main`; the rules are in `electron/payloadBoot.cjs`). A start runs the newer set when it is finished, newer than what the installer put down (so an installer run since then wins), built for this Electron and this `PROTOCOL`, and has not failed to start twice: a start counts as failed until the game's window is up (`globalThis.__ohPayload.confirm()`, from `main.cjs`), and a set given up on is never fetched again. Otherwise the installed files run, as before. The Desktop log's `app.files` line says which. `OH_NO_PAYLOAD=1` makes a packaged app run its installed files, to tell a fault in an update from a fault in the app.
- **When the installer still updates** (`electron/layeredUpdate.cjs`, the one updater the launch screen and the banner's routes drive; it has electron-updater's methods and events). A release packed with another Electron, or with a higher `PROTOCOL`: raise that when a release changes anything only the installer can change (packaging, files kept outside the archive, what the bootstrap does). A set this app could not start from. Chunks that cannot be looked up, fetched or put together: the same release is then taken whole. After an update made of chunks the installed files are the older ones, so the installer's feed offering the version that is running is not an update.
- **Not covered:** the Android app (Android installs an APK whole) and the website (a browser already fetches only the files that changed).

Tests: `server/payloadChunks.test.js`, `server/payloadUpdate.test.js` (a release on a local server, end to end), `server/updateChunksRelease.test.js`. `OH_PAYLOAD_FEED=http://127.0.0.1:<port>/` points a packaged build at a release served from the same machine, and from nowhere else.

---
## 12. Traps & invariants

- **Never re-add map binaries to Git LFS** — they live on the `map-data` Release only (§8).
- **Never let a pmtiles/large geojson into a Pages build** — the `oh-drop-map-binaries` plugin, both CI size guards, and the local deploy engine's `findOversized` all defend the 25 MiB Pages limit, which rejects *after* a green build (`vite.config.ts:43`, `deploy-site.yml:58`, `deploy-site.mjs:95`).
- **Neither Android application id may ever change** (the `appId` in `mobile/capacitor.config.json`; the beta's, the same id + `.beta`): a new id is a new app, and its players' saves stay behind in the old one. The APK asset name was changed once (from the project's earlier name to `open-historia.apk`, 2026-09-04); the old asset has since been deleted from the release. See §3 before doing it again.
- **Stage the map data before `cap sync`** — `android-apk.yml` runs `npm run map` and `npm run www` between `npm run build:android` and Gradle; `cap sync` copies whatever is in `mobile/www/`.
- **`ROOT_PAGES` is fail-hard, `ROOT_ASSETS` is fail-soft** — a dropped root *page* fails `build:site`; a dropped root *image* is only a cosmetic 404 (`assemble-site.mjs:46`, `:59`).
- **`deploy-site.yml` is superseded but still on `main`** — the admin-panel button is the live path; the yml stays because the pushing token lacks the `workflow` scope to delete it.
- **`--branch=main` / `--branch=<BRANCH>` is what makes a Pages upload production** — omit it and the live domain keeps the old build while the deploy still reports success.

---

### See also

- [World state](world-state.md) — the `world.json` shape that scenarios and the web seed carry
- [Web mode & content nodes](web-build.md) — how the browser build resolves map data from the signed directory
- [Scenario hub](runtime-services.md) — the hub's index: its posts, its checked files and the import counts
