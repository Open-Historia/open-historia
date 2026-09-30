# Contributing & Conventions

Open Historia is an open-source, community-driven alternative to Pax Historia: a React + Vite client, an Express server (`server/server.js`), a vector map editor, and a small fleet of build/release scripts. This page is the practical orientation for a new contributor — where the code lives, how it flows to players through the release channels, how to run and test it locally, the commit/style rules the maintainer enforces, and the handful of identifiers and data-hosting rules you must **not** break. There is no `CONTRIBUTING.md` in the repo; this doc is the closest thing, distilled from `README.md`, `package.json`, `.github/workflows/`, the license banners in the source, and `.gitattributes`/`.gitignore`.

For the systems these conventions govern, see [Architecture](architecture.md), [Server](server.md), [Assets & data](assets-and-data.md), and [Web build](web-build.md).

---

## 1. Repository & remote layout

The canonical repo is the **`Open-Historia` GitHub org**: `Open-Historia/open-historia`. That is what `README.md` tells players to clone (`git clone https://github.com/Open-Historia/open-historia.git`) and what every workflow, license banner, and asset manifest points back to.

This working clone (`work-repo`) has several remotes configured — useful to know so you push to the right place:

| Remote | URL | Role |
|--------|-----|------|
| `upstream` | `github.com/Open-Historia/open-historia` | The canonical org repo. PRs land here; this is "the repo". |
| `origin` | the maintainer's personal fork on GitHub (`Arkniem`) | Maintainer's personal working fork. |
| `beta` | `github.com/Arkniem/Open-Historia-Beta` | Beta staging fork. |
| `ltfork` | `github.com/lt20202122/open-historia` | A contributor fork. |

`scripts/map-assets.json` hard-codes `"owner": "Open-Historia", "repo": "open-historia", "release": "map-data"` — the org repo is also where the large binary release assets live (see §9).

Sibling repos in the same org that the code and docs reference (not part of this repo):

| Repo | Purpose |
|------|---------|
| `Open-Historia/open-historia-node` | Community **content node** — caches/serves read-only, checksum-verified map data. |
| `Open-Historia/open-historia-admin` | Private registry Worker (D1) + signing panel; deploys the website and node directory. |
| `Open-Historia/Open-historia-scenarios` | The Scenario Hub — official presets + community scenarios. |

---

## 2. Branches & the release channel model

The repo ships to players through **rolling per-channel GitHub Releases**, driven entirely by which branch you push to. The workflows in `.github/workflows/` are the source of truth:

| Branch | Built by | Produces |
|--------|----------|----------|
| `main` | `.github/workflows/desktop-installer.yml` | The Windows, macOS and Linux installers (`Open-Historia-Setup.exe`, `Open-Historia-mac-{x64,arm64}.zip`, `Open-Historia-x86_64.AppImage`, `Open-Historia-amd64.deb`) and their update feeds on the **`desktop-stable`** release (run from the Actions tab, or push a `desktop-v*` tag). |
| `main` | `.github/workflows/deploy-site.yml` | Deploys **openhistoria.com** (Cloudflare Pages) via `npm run build:site`. |
| `beta` | `.github/workflows/desktop-beta.yml` | The "Open Historia Beta" installers on the **`desktop-beta`** pre-release, a separate app beside the stable one (run from the Actions tab on `beta`, or push a `desktop-beta-v*` tag). |
| `main` | `.github/workflows/android-apk.yml` | `open-historia.apk` on the **`android`** release (run from the Actions tab on `main`, or push an `android-v*` tag). |
| `beta` | `.github/workflows/android-apk-beta.yml` | `open-historia-beta.apk` on the **`android-beta`** pre-release (run from the Actions tab on `beta`, or push an `android-beta-v*` tag). |
| PRs into `beta`/`main`, pushes to `beta` | `.github/workflows/tests.yml` | Runs `npm test`; publishes nothing. |

No installer is built on a push: each release is cut by a dispatch or a tag. The installers carry the client prebuilt and the server inside Electron; the world map is not packaged and downloads on first launch (`electron/main.cjs` runs `scripts/fetch-map-assets.mjs --ensure`). The zip bundle and its `Launch`/`Update` scripts (`app-bundle.yml`, the `app-stable`/`app-beta` releases) were retired in `b34a0e38`.

`deploy-site.yml` skips its build for `**.md`, `mobile/**`, and `.github/**` changes (docs/app can't change what the site serves) and refuses to deploy any file over Cloudflare Pages' 25 MiB limit (`deploy-site.yml`).

There is also an **`alpha`** staging branch and a large number of feature branches (typically a `feature`, `feature-alpha`, `feature-beta`, `feature-main` family per change). Feature work is developed on a topic branch, staged, then merged toward the release channels. When in doubt about the target branch for a PR, ask the maintainer rather than guessing — the channel topology (dev → alpha → beta → main) is maintainer-managed.

---

## 3. The PR-only workflow (submit; maintainer merges)

**Contributors submit pull requests. A maintainer reviews and merges — you do not merge your own PR.** The git history is almost entirely `Merge pull request #NNN from Open-Historia/<branch>` commits authored by the maintainer (`Arkniem`), i.e. every change lands through a reviewed PR.

Practical flow:

1. Fork `Open-Historia/open-historia` (or branch, if you have push access).
2. Create a topic branch off the appropriate base.
3. Make your change; run `npm run lint` and `npm test` locally (see §7–8).
4. Open a PR against the org repo. Describe *why*, not just *what* — the codebase's comment culture (§5) extends to PR descriptions.
5. A maintainer merges. Do not force-push shared branches or self-merge.

---

## 4. Commit identity & attribution rules

These are hard rules — the maintainer enforces them on every commit and PR.

### No AI attribution — ever

**Do not add `Co-Authored-By: Claude …` trailers, `Generated with Claude Code` footers, or any AI-attribution line** to commit messages or PR bodies. This applies whether or not an AI tool touched the change. Commits and PRs read as authored by a human contributor, full stop.

### Author identity

Commit under **your own GitHub-linked identity** (use your GitHub `noreply` email so commits attribute to your account, e.g. `<id>+<user>@users.noreply.github.com`). The maintainer commits as `Arkniem` (Nicholas Krol). Do not impersonate another contributor's name/email.

### License-banner authorship is separate from Git authorship

The **file-header license banners** (§5) credit **Nicholas Krol** because they mark the portions he authored — that is a *licensing* statement, not a claim of Git authorship. Don't remove or rewrite an existing banner when you edit a file; leave the attribution intact.

---

## 5. Coding style & conventions

### License banners on source files

Almost every source file (~111 across `src/`, `server/`, `scripts/`) opens with a one-line (or short block) AGPL banner pointing at `LICENSE`. Two forms are in use:

```js
/*! Open Historia — portions (short description of what this file does) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
```

```js
/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
```

Even config, workflows, and `.gitattributes` carry the banner (`.github/workflows/*.yml`, `vite.config.ts`, `eslint.config.js` excepted). **When you add a new file, add a banner** in the same style with a short parenthetical describing the file's role. When you edit an existing file, keep its banner.

The whole project — including the map editor and its tooling — is licensed **AGPL-3.0-or-later** under the top-level `LICENSE`. The previous MIT carve-out for `src/Editor/`, `scripts/extract-regions.mjs`, and `server/mapEditorStore.js` was retired when the project relicensed; `src/Editor/LICENSE` no longer exists. Third-party code retains its own license — Azgaar's Fantasy Map Generator, vendored into `fmg/dist`, is MIT.

### Verbose, explanatory comments (the house style)

The single most distinctive convention: **comments explain *why*, name the trap, and often cite the failure mode** — not what the next line literally does. They are frequently multi-sentence and read like short design notes. Representative examples worth imitating:

- `vite.config.ts` — a full paragraph on why the pmtiles are dropped from the bundle, including that "the trap is that it only fires on a machine that has actually played."
- `server/security.js` — the banner explains *why* the helpers are split out (unit-testable without the server), and each function comment states the exact attack it blocks ("Rejects `../`, a path separator (including the `%2f` Express decodes back into `/`)…").
- `.github/workflows/deploy-site.yml` — explains *why* CI deploys the site rather than connecting Pages to the repo, and the map-binary trap it sidesteps.
- `server/ownerMigration.test.js` — notes fixtures are "TRANSCRIBED FROM THE REAL SHIPPED DATA, not invented."

Match this: when you write a non-obvious line, leave a comment that would stop the next person from "fixing" it back into a bug.

### Linting, TypeScript, and the React compiler

| Tool | Config | Notes |
|------|--------|-------|
| ESLint 9 (flat config) | `eslint.config.js` | Runs on `**/*.{ts,tsx}` with `js.configs.recommended`, `typescript-eslint`, `react-hooks`, and `react-refresh` (Vite). `dist` is globally ignored. Run: `npm run lint`. |
| TypeScript 5.9 | `tsconfig*.json` | `.ts`/`.tsx` are type-checked and linted; much of the game UI is `.jsx` (not strictly typed). Both coexist. |
| React 19 + React Compiler | `vite.config.ts` | The build enables `babel-plugin-react-compiler`. Don't hand-write memoization that fights the compiler; follow the Rules of Hooks (react-hooks lint enforces this). |

Note ESLint only targets `.ts`/`.tsx` — the many `.jsx`/`.js` files are not linted by the current config, so rely on review and the comment culture there.

### Line endings

`.gitattributes` forces **LF** on `*.sh` and `*.command` — "CRLF breaks bash on Linux/macOS." Keep any shell script LF; don't let an editor rewrite it to CRLF.

---

## 6. Running the app locally

Prerequisites: **Node.js 22 LTS or newer** (minimum `^20.19.0 || >=22.12.0`, enforced by `package.json:engines`; Vite 7 requires it) and Git.

### First-time setup

```bash
git clone https://github.com/Open-Historia/open-historia.git
cd open-historia
node scripts/fetch-map-assets.mjs   # download world-map binaries (NOT in the repo — see §10)
npm install
```

### Two ways to run

**A. Production-style (matches what players get):**

```bash
npm run build           # vite build -> dist/
node server/server.js   # Express server on http://localhost:3000
```

Open **http://localhost:3000**. The server (`server/server.js`) serves `dist/`, exposes the `/api/*` routes (library/scenario stores, map-editor store, basemaps, flags, the AI relay, the hub proxy, and `/api/runtime/pmtiles/:assetKey` for streaming map binaries off disk), and enforces the CORS/CSRF guards in `server/security.js`. See [Server](server.md).

**B. Hot-reload dev (run BOTH processes):**

```bash
node server/server.js   # terminal 1 — the API/server on :3000
npm run dev             # terminal 2 — Vite dev server (HMR)
```

Vite proxies `/api` to `http://localhost:3000` (`vite.config.ts`), so the editor's save/load and the game's runtime endpoints work under HMR. You need the Express server running alongside `vite` — the dev server alone has no backend.

### Other run/build scripts (`package.json:scripts`)

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server (desktop/local mode). |
| `npm run dev:web` | Seeds web defaults (`scripts/seed-web-defaults.mjs`) then `vite --mode web`. |
| `npm run build` | `vite build` → `dist/` (the desktop client). |
| `npm run build:web` | Web build → `dist-web/` (base `/`). See [Web build](web-build.md). |
| `npm run build:site` | Web build at base `/play/` + `scripts/assemble-site.mjs` (landing page at `/`, game at `/play/`) → `dist-site/`. |
| `npm run build:android` | Web-style build with `--mode android` → `dist-android/`, the Android app's bundle (the app has no server; see [mobile.md](mobile.md)). |
| `npm run lint` | ESLint over the repo. |
| `npm run preview` / `preview:web` | Serve a built bundle for inspection. |

`--mode web` builds the browser-playable website; **any other mode builds the local/desktop app** (`vite.config.ts`). The web flag is compiled to a literal (`import.meta.env.VITE_OH_WEB`) so Rollup dead-code-eliminates the web runtime out of the desktop build (`vite.config.ts`).

### The desktop app

Players install the Electron app from the `desktop-stable` release (§2); there are no launcher or update scripts any more. `npm run dist:win` (and the other `dist:*` scripts) builds an installer locally the way `desktop-installer.yml` does. The app downloads the world map on first launch with `scripts/fetch-map-assets.mjs` and, on Windows and Linux, updates itself from its release's `latest*.yml` feed (`electron-updater`): opening the app installs a waiting update before the game window opens (`electron/launchUpdate.cjs`; see [delivery-and-deploy.md §11.1](delivery-and-deploy.md#111-how-an-installed-game-updates)).

---

## 7. Running tests

```bash
npm test
# => node --test "server/**/*.test.js" "src/**/*.test.js"
```

Tests use the **built-in Node test runner** (`node --test`) with `node:assert/strict` — **no test framework, no extra deps**. Both globs run: the server's modules and the client's (`src/`), several hundred test files between them. `.github/workflows/tests.yml` runs the same `npm test` on every pull request into `beta` or `main` and every push to `beta`, and `desktop-beta.yml` runs it before it builds. A test sits **beside its module** as `<module>.test.js` (or `<module>.<topic>.test.js`), and the globs pick it up automatically. For example:

| Test file | Covers |
|-----------|--------|
| `server/security.test.js` | Path containment, the CSRF/origin guard, HTTP range parsing, the hub host allowlist (`server/security.js`). |
| `server/ownerMigration.test.js` | The owner-code → owner-name resolver, with fixtures transcribed from real shipped scenario data (`server/ownerMigration.js`). |
| `src/Game/AI/turnReview.test.js` | The after-skip review prompt and the answer taken apart (`turnReview.js`). |
| `src/Game/AI/repairCall.test.js` | The world-repair call's time limits (`repairCall.js`, which imports `idleDeadline.js`). |
| `src/runtime/gameState.unitMotion.test.js` | How far a unit moves in a turn (`gameState.js` + `unitMotion.js`). |

**The rule every test depends on: a tested module, and everything it imports, must load under plain Node.** No bundler runs first, so a test cannot import, directly or through another module:

- `src/Game/AI/gameplay.js` or `src/Game/AI/main.jsx` (JSX, and the whole game behind them);
- any `.jsx` file;
- a module that reads `import.meta.env.X` unguarded when it loads — `import.meta.env` exists only under Vite, so such a module must read it as `import.meta.env?.X`, as `promptContext.js` does for `CITY_SEED_URL`;
- anything under `src/runtime/web/generated/`, which is gitignored build output.

Importing other plain modules is fine: `repairCall.js` imports `idleDeadline.js`, and `gameState.js` imports many other runtime modules. So logic that needs a test belongs in a plain module the big file imports (as `turnReview.js`, `nativeUnitDirector.js` or `runtime/territoryBasis.js` are for `gameplay.js`), not inside `gameplay.js` itself. Keep the tested functions **pure** where you can, so they need no server and no browser, and prefer real transcribed fixtures over invented ones (`server/ownerMigration.test.js`).

Some tests read a source file as text and match it (`fs.readFileSync(... "gameplay.js")` and a regex) to guard an architectural rule, such as "server/ never imports src/" (`server/serverImports.test.js`). Those pin the shape of the code, not what it does; they do not replace a behavioural test that calls the function. Render-path changes still have to be checked by booting the app.

---

## 8. Load-bearing identifiers that must never change

These strings are wired into external contracts (release assets players download, the Android package identity, update checks). Renaming any of them silently breaks installs or self-updates. **Treat them as frozen.**

| Identifier | Where | Why it's frozen |
|-----------|-------|-----------------|
| **The Android application id** (Capacitor `appId`) | `mobile/capacitor.config.json` | The Android application ID. Changing it makes every existing install a *different* app — no in-place update; users would get a duplicate. |
| **`open-historia.apk`** (release asset name) | `.github/workflows/android-apk.yml` | The exact filename players download from the `android` release, and what the README and site link by name. Renamed from the project's earlier name on 2026-09-04 (main `e29967e`); see delivery-and-deploy.md §3 for what that cost. |
| **`android`** (rolling release tag) | `android-apk.yml` | The APK is republished to this single rolling release; the app updates itself from it. |
| **`desktop-stable` / `desktop-beta`** (release tags) | `package.json` `build.publish`, `electron-builder.beta.yml` `publish`, `desktop-installer.yml`, `desktop-beta.yml` | The installed apps read their update feed (`latest*.yml`) from these URLs, which are baked into every install; the README links `desktop-stable`. |
| **Installer asset names** (`Open-Historia-Setup.exe`, `Open-Historia-mac-{x64,arm64}.zip`, `Open-Historia-x86_64.AppImage`, `Open-Historia-amd64.deb`, and the `Open-Historia-Beta-*` set) | `artifactName` in `package.json` `build` and `electron-builder.beta.yml`; `latest.json` in both desktop workflows | The update feeds and `latest.json` name them, and the README and site link them by name. |
| **`map-data`** (release) + the per-asset names | `scripts/map-assets.json` | The map-binary release and asset names (`regions.pmtiles`, `regions-seed-z8.geojson`, `default-regions-names.geojson`, …). The fetch script resolves these by name; a rename orphans every fetch. |
| **The Android WebView host** (Capacitor `hostname`) | `mobile/capacitor.config.json` | The WebView origin the Android app serves under. |
| **`Build: N`** convention | `android-apk.yml` | The boot screen matches `__APP_BUILD__` (stamped from the run number) against `Build: N` in the release notes to decide whether to self-update. Keep both sides in sync. |

When a map file legitimately changes, you upload a *new* asset and update its `sha256`/`bytes` in `scripts/map-assets.json` — you don't rename the contract-facing names.

---

## 9. The map-data-off-LFS rule

**The large world-map binaries are not in the repo and must never be re-added to Git (or Git LFS).** They are hosted as assets on the `map-data` GitHub Release and downloaded on demand by `scripts/fetch-map-assets.mjs`, which reads `scripts/map-assets.json`.

Why: LFS's free bandwidth (1 GB/month, shared org-wide) was exhausted by a handful of player installs. Release-asset download bandwidth is free and unmetered. This is stated three times in the tree so it can't be missed: `.gitattributes:6-11`, `.gitignore` ("Large world-map binaries" block), and `scripts/map-assets.json:_comment`.

The gitignored / release-hosted files:

| File | Manifest asset name |
|------|--------------------|
| `public/assets/regions.pmtiles` | `regions.pmtiles` |
| `public/assets/countries.pmtiles` | `countries.pmtiles` |
| `public/assets/cities.pmtiles` | `cities.pmtiles` |
| `public/assets/cities-seed.json` | `cities-seed.json` |
| `public/assets/regions-seed.geojson` | `regions-seed-z8.geojson` |
| `server/data/stock/regions.geojson` | `default-regions-names.geojson` |

Rules of thumb:
- **Never `git add`** any `*.pmtiles`, the seed geojson/json, or the default scenario's `regions.geojson`. They're gitignored; don't `-f` them in.
- **To change a map file:** upload the new asset to the `map-data` release, then update its `sha256` + `bytes` in `scripts/map-assets.json`. `fetch-map-assets.mjs` re-downloads any listed file that's missing or hash-mismatched.
- **The builds actively drop these from the bundle** — `vite.config.ts`'s `dropMapBinaries` plugin deletes the pmtiles (and, for web, the editor seeds) after copy, because Cloudflare Pages rejects any file over 25 MiB and nothing loads a pmtiles archive from the bundle anyway (the desktop streams them off disk via `/api/runtime/pmtiles/:assetKey`; the web build fetches them from content nodes, hash-verified). Don't defeat this plugin. See [Assets & data](assets-and-data.md).

Related gitignored-but-not-in-LFS runtime artifacts you also shouldn't commit: `/fmg/` (vendored Fantasy Map Generator, fetched by `scripts/fetch-fmg.mjs`), `/src/runtime/web/generated/` (web seed), `/node-content/` (content-node store), and the offline signing keys `trust/*.key.pem` / `*.key` (**never commit a signing key**).

---

## 10. Quick reference — where things live

| You want to… | Look at |
|--------------|---------|
| Change the server API / routes | `server/server.js`, `server/*Store.js`, [Server](server.md) |
| Touch security guards | `server/security.js` (+ `security.test.js`) |
| Edit the map editor | `src/Editor/` (covered by the top-level `LICENSE`) |
| Edit the game map / UI | `src/Game/` — see [Game map](game-map.md), [Game UI](game-ui.md) |
| World-state fields & flow | [World state](world-state.md) |
| AI prompts / schemas | [AI overview](ai-overview.md), [AI schemas](ai-schemas.md) |
| Build/release plumbing | `.github/workflows/`, `scripts/`, `vite.config.ts` |
| Map-data hosting | `scripts/map-assets.json`, `scripts/fetch-map-assets.mjs` (§9) |
| Rebuild an official preset | `scripts/presets/build-preset.mjs <spec>` |
| Web/site deploy | `WEB-DEPLOY.md`, [Web build](web-build.md) |
