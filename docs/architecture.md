# Architecture Overview

Open Historia is a turn-based, AI-driven grand-strategy game that renders the whole Earth as an interactive map. The frontend is a single React 19 SPA (Vite build) that draws the world with MapLibre GL + PMTiles vector tiles and hosts an OpenLayers-based map editor behind a URL flag; the same client bundle runs against **three interchangeable `/api` backends** selected at compile time — a local Express server (desktop download), an in-browser IndexedDB fetch-interceptor (hosted website), and an embedded nodejs-mobile server (Android app). Everything the client needs it asks for through the same `/api/*` calls, so the three variants differ only in what answers those calls.

This page is the map of the codebase. Each subsystem has its own page; follow the cross-links.

---

## 1. Tech stack

| Concern | Choice | Where |
|---|---|---|
| UI framework | React 19 (+ `babel-plugin-react-compiler`) | `package.json`, `vite.config.ts:77` |
| Bundler / dev server | Vite 7 | `vite.config.ts`, `package.json` scripts |
| Map renderer | MapLibre GL 5 via `react-map-gl/maplibre` | `src/Game/Map/World.jsx:3` |
| Vector tiles | PMTiles 4 (`pmtiles`, `ol-pmtiles`) — regions / countries / cities archives | `src/runtime/assets.js`, `src/runtime/preload.js` |
| Map editor renderer | OpenLayers 10 (`ol`) — lazy-loaded, editor route only | `src/App.jsx:7`, `src/Editor/OlMap.jsx` |
| Geometry / GIS | `@turf/*`, `d3-geo`, `polygon-clipping`, `shpjs`, `geotiff` | `package.json` deps |
| Charts | Chart.js 4 (stats panel) | `src/Game/GameUI/stats.jsx` |
| Desktop/mobile server | Express 5 | `server/server.js`, `mobile/nodejs-project/` |
| Signing / trust | `@noble/ed25519` (content manifests, node directory) | `trust/`, `src/runtime/web/contentTrust.js` |
| Bundled tools | Azgaar Fantasy Map Generator (vendored) | `fmg/`, `scripts/fetch-fmg.mjs` |
| Basemap raster tiles | ESRI/ArcGIS Online (public, token-free) + terrarium DEM (AWS) | `src/runtime/assets.js:82` |

The heavy map binaries (`regions.pmtiles` ~101 MB, `countries.pmtiles`, `cities.pmtiles`, plus editor seed geojson) are **never bundled** — see [Map assets & PMTiles](map-assets.md). They live in `public/assets/`, are gitignored, and are fetched from a GitHub "map-data" Release on first launch. A Vite plugin (`dropMapBinaries`, `vite.config.ts:43`) deletes them from every build output so Cloudflare Pages' 25 MiB/file limit is never hit.

---

## 2. The three build variants

All three run the identical `src/` client. What changes is (a) the `VITE_OH_WEB` compile-time flag and (b) which process answers `/api/*`.

| Variant | Build command | `/api` backend | Asset storage | Distribution |
|---|---|---|---|---|
| **Desktop download** ("Download for Windows/Mac/Linux") | `npm run build` → `dist/` | Local Express server `server/server.js` on `localhost:3000` | Files under `server/data/` (JSON manifests + binary assets) | Zip + launcher scripts (`Launch Open Historia.*`) |
| **Web build** (the hosted website `openhistoria.com/play/`) | `npm run build:web` / `build:site` → `dist-web/` | **No server** — a `fetch()` interceptor answers `/api/*` from IndexedDB | IndexedDB in the browser; map tiles from the registry Worker / content nodes | Cloudflare Pages |
| **Android app** | client from `dist/` inside APK; server via `npm run build:mobile-server` | Embedded Express (`server/server.js`) run in-process by **nodejs-mobile**, bound to `127.0.0.1` | Files in a writable sandbox dir (`OH_DATA_DIR`) | Capacitor APK (`mobile/`) |

### How the compile-time flag selects the variant

The whole web branch hinges on one boolean literal, injected by Vite's `define`:

```
'import.meta.env.VITE_OH_WEB': JSON.stringify(mode === 'web')   // vite.config.ts:75
```

- `vite build` (any mode ≠ `web`) → `VITE_OH_WEB` is `false`. Rollup dead-code-eliminates every `if (import.meta.env.VITE_OH_WEB)` branch **and the dynamically-imported web backend** (`src/runtime/web/*`), so the desktop/Android bundle never pulls in IndexedDB stores, accounts, or the web-only generated seed files. This is why a fresh desktop extract (which has never run a web build) still builds and boots.
- `vite build --mode web` → `VITE_OH_WEB` is `true`, and Vite additionally loads `.env.web` (`VITE_OH_PMTILES_URL`, `VITE_OH_HUB_URL`, `VITE_OH_ACCOUNT_URL`, `VITE_OH_DIRECTORY_URL`, `VITE_OH_GOOGLE_CLIENT_ID`). See [Web build & accounts](web-build.md).

The one place the flag is read at boot is `src/main.jsx:28` (below). Because the web backend is behind a **dynamic `import()`**, the desktop build never even references the module.

**Relevant `package.json` scripts:**

| Script | Effect |
|---|---|
| `dev` | `vite` — desktop client on `:5173`, proxying `/api` → `http://localhost:3000` (`vite.config.ts:87`) |
| `dev:web` | seeds web defaults, then `vite --mode web` |
| `build` | desktop client → `dist/` |
| `build:web` | seeds, then `vite build --mode web --outDir dist-web` |
| `build:site` | `build:web` with `--base /play/` + `scripts/assemble-site.mjs` (bolts the marketing `site/` around `/play/`) |
| `build:mobile-server` | `scripts/build-mobile-server.mjs` — bundles `server/` into `mobile/nodejs-project/` |
| `test` | `node --test server/**/*.test.js` (server unit tests only) |

---

## 3. Boot sequence

### 3a. `src/main.jsx` — the fork

`index.html` loads exactly one module, `/src/main.jsx`. It:

1. `configureMapRuntime()` — sizes MapLibre worker count + parallel image requests from `navigator.hardwareConcurrency` (`src/runtime/assets.js:398`).
2. Renders `<App/>` into `#root`, then `startTranslator()` (live UI translation when a non-English language is set — see [i18n & translation](i18n.md)) and registers the service worker (`public/sw.js`, production only).
3. **The fork** (`src/main.jsx:28`):
   - If `VITE_OH_WEB`: `import("./runtime/web/index.js").then(installWebBackend)` installs the IndexedDB `/api` interceptor **before** `mount()`, so no request escapes uninstalled.
   - Else: `mount()` directly.

### 3b. `src/App.jsx` — routing (game vs editor)

`App()` reads URL params **once at render** (keeps hook order stable):

| URL | Renders | Notes |
|---|---|---|
| `?editor=1` | `<MapEditor/>` (lazy, `src/App.jsx:7`) | OpenLayers only fetched here; wrapped in `<Suspense>`. See [Map editor](map-editor.md) |
| anything else | `<ErrorBoundary><GameApp/></ErrorBoundary>` | `ErrorBoundary` (`src/runtime/ErrorBoundary.jsx`) shows a recoverable Reload screen on a render throw instead of a blank page |

### 3c. `GameApp` — startup preload & first render

`GameApp` (`src/App.jsx:36`) always mounts `<Map>` immediately (behind a black `WorldShell`), and swaps a `<StartupScreen>` overlay for the `<UI>` once ready. Readiness is a race between a time budget and two async signals:

| State / ref | Meaning | Set by |
|---|---|---|
| `startupState` | progress %, current stage, per-task steps | `runStartupPreload` progress callback (`src/runtime/preload.js`) |
| `preloadFinishedRef` | the 8 preload tasks finished/timed out | preload `.finally` |
| `worldIdleRef` / `hasFirstWorldIdle` | MapLibre fired its **first** `onIdle` (first world frame settled) | `<Map onInitialIdle={handleFirstWorldIdle}>` → `World.jsx:226` |
| `isReady` | show `<UI>`, hide `<StartupScreen>` | true when **(preload done AND first world idle)**, OR when `STARTUP_TIME_BUDGET_MS` (30 s) elapses |

A `requestAnimationFrame` loop (`src/App.jsx:67`) ticks `elapsedMs` and flips `isReady` when either condition is met. The overlay's last 3% ("Finalizing first world render") is gated on `hasFirstWorldIdle` so the bar never sits at 100% while the map is still blank.

Before the preload even starts, `ensureLibraryCatalog()` (`src/runtime/library.js:187`) loads the games/scenarios catalog so the active game's cache token is known. The **8 preload tasks** (`src/runtime/preload.js:82`) warm: runtime JSON state, ESRI + terrain textures, `countries.pmtiles`, the country index, country labels, `cities.pmtiles`, and `regions.pmtiles`. See [Startup preload](startup-preload.md).

Both `<Map>` and `<UI>` are keyed on `activeGameId` (not the library token) so a scenario "Apply & Play" — which writes many assets and bumps the token repeatedly — remounts the map exactly **once** (`src/App.jsx:57`, `:169`).

---

## 4. Directory map

### Repo root

| Path | What lives there |
|---|---|
| `src/` | The React client (all three variants share this) |
| `server/` | Express server + on-disk stores (desktop + embedded mobile backend) |
| `scripts/` | Build/seed/signing/asset tooling (`.mjs`) — see below |
| `public/` | Static assets served as-is: `assets/` (map binaries, gitignored), `lang/` shipped language packs, `sw.js`, signed `content-manifest.json` / `node-directory.json`, marketing HTML (`guides/`, `how-to-play/`, …) |
| `site/` | Marketing homepage shell wrapped around `/play/` by `build:site` |
| `mobile/` | Android app: Capacitor (`android/`, `www/`, `capacitor.config.json`) + `nodejs-project/` embedded server |
| `node-content/` + `server/node.js` | Content-node server (hash-addressed, read-only) — see [Content nodes](content-nodes.md) |
| `fmg/` | Vendored Azgaar Fantasy Map Generator (served at `/fmg` for the editor's Generate console) |
| `trust/` | Ed25519 root key material + `pinned-key.js` for content/directory verification |
| `tools/import-counter/` | Cloudflare Worker: self-hosted scenario-import counter |
| `hub-templates/` | GitHub issue templates for the community scenario/basemap hub |
| `dist/`, `dist-web/`, `dist-site/` | Build outputs (desktop, web, assembled site) |
| `vite.config.ts`, `index.html`, `.env.web` | Build config + web-mode env |

### `src/` layout

| Path | Responsibility | Deep-dive |
|---|---|---|
| `src/main.jsx` | Entry: runtime config, mount, web/desktop fork | §3a |
| `src/App.jsx` | Route split (game vs editor), startup race | §3b/3c |
| `src/Game/Map/` | MapLibre map + layers: `World.jsx` (map shell + style), `Nations.jsx` (region fills/borders/labels), `Cities.jsx`, `Units.jsx` + `unitsController.js`/`unitCombat.js`, `MarkersLayer.jsx`, `GlobeEffects.jsx` + globe sun/star canvases, `useWorldState.js`, `useCustomBackground.js` | [Map rendering](map-rendering.md) |
| `src/Game/GameUI/` | The HUD: `main.jsx` (shell), `libraryBar.jsx` (top bar + main menu), `time.jsx` (date/turn), `chat.jsx` (toolbar/inbox), `advisor.jsx`, `forces.jsx`, `settings.jsx`, `search.jsx`, `stats.jsx`, `scenarios.jsx`, `communityHub.jsx`, `actions.jsx`, `cheats.jsx`, `FactionCreator.jsx`, `CountryPickerMap.jsx`, `other.jsx` | [Game UI](game-ui.md) |
| `src/Game/Selection/` | Click-target popups: `Regions.jsx`, `CountryPanel.jsx`, `Units.jsx`, `Features.jsx` | [Selection & popups](selection.md) |
| `src/Game/AI/` | AI turn engine: `main.jsx` (provider chat), `gameplay.js`, `gameplayPrompts.js`, `gameplaySchemas.js`, `promptContext.js`, `providerConfig.js`, `defaultPrompts.json` | [AI system](ai-system.md) |
| `src/runtime/` | Client "kernel": asset/endpoint layer, game/world state, library catalog, preload, i18n, startup UI | below |
| `src/runtime/web/` | **Web-only** backend (dead-code-stripped from desktop): `index.js`, `router.js`, IndexedDB stores, accounts, sync, nodes, home page | [Web build & accounts](web-build.md) |
| `src/Editor/` | OpenLayers map editor (author custom maps) | [Map editor](map-editor.md) |

### `src/runtime/` (the client kernel)

| File | Role |
|---|---|
| `assets.js` | The asset/endpoint hub: defines `JSON_URLS`, `PMTILES_ARCHIVES`, ESRI basemaps, MapLibre `pmtiles`/`ohbase` protocols, `readJson`/`writeJson`/`warm*`, per-token cache sweeping. §5 |
| `library.js` | React store (`useSyncExternalStore`) for games/scenarios; wraps `/api/library`, `/api/games`, `/api/scenarios`; wires the active cache token + country-name overrides into `assets.js` |
| `gameState.js` | `GAME_DEFAULTS` + `WORLD_DEFAULTS`; read/write of the per-game `game.json` and `world.json` runtime state | [World state](world-state.md) |
| `preload.js` | The 8 startup warm tasks + progress model. §3c |
| `StartupScreen.jsx` / `ErrorBoundary.jsx` | Loading overlay; render-error recovery |
| `countryLabels.js`, `countryFlags.js`, `countryTags.js`, `countryNames`/`polityNames.js` | Country label/flag/tag/name resolution from `countries.pmtiles` + overrides |
| `communityBasemaps.js`, `communityFlags.js`, `basemapLibrary.js`, `flagLibrary.js` | Community/basemap/flag catalogs |
| `mapSettings.js`, `difficulty.js`, `scenarios.js` | Map display settings, difficulty directives, scenario helpers |
| `translator.js`, `i18n.js` | Live UI translation + language directives |
| `generated/` | Build-time generated tables (country names, etc.) |

### `scripts/` and `server/` (quick index)

| `scripts/*.mjs` | Purpose |
|---|---|
| `fetch-map-assets.mjs` / `map-assets.json` | Pull map binaries from the map-data Release |
| `seed-web-defaults.mjs` | Generate web-build seed data (default scenario) |
| `build-mobile-server.mjs` | Bundle `server/` into the APK's nodejs-project |
| `extract-regions.mjs` / `extract-cities.mjs` / `build-default-map.mjs` | Build the PMTiles/geojson map data |
| `build-content-manifest.mjs` / `sign-release.mjs` / `gen-signing-key.mjs` | Content-node manifest signing (Ed25519) |
| `generate-country-*.mjs`, `generate-lang-packs.mjs`, `fetch-fmg.mjs`, `populate-node.mjs`, `node-updater.mjs` | Data/tooling generation |

| `server/*.js` | Purpose |
|---|---|
| `server.js` | The Express app: all `/api/*` routes, CORS, CSRF guard, static SPA serve, AI relay, hub proxy, shutdown |
| `libraryStore.js` | Games + scenarios store (catalog, assets, runtime JSON, import/export) — the on-disk heart |
| `mapEditorStore.js`, `basemapStore.js`, `flagStore.js` | Editor docs, basemaps, "My flags" stores |
| `dataDir.js` | Resolves the single writable `DATA_DIR` (`OH_DATA_DIR` or `server/data`) |
| `security.js` | Cross-origin write policy, hub URL allowlist, byte-range parsing |
| `ownerMigration.js`, `trust.js`, `country-names.json` | Owner code→name migration, trust helpers, data |
| `node.js` | Standalone content-node server (separate process) |

---

## 5. Data flow: frontend ↔ `/api` ↔ stored assets

The client **never** talks to storage directly. Every state read/write is a same-origin `/api/*` call built in `src/runtime/`. A backend answers it. This indirection is exactly what lets the same client run on Express, IndexedDB, or nodejs-mobile.

### The runtime asset endpoints

`setRuntimeAssetEndpoints({ token })` (`src/runtime/assets.js:204`) rebuilds every URL whenever the active library token changes, stamping `?v=<token>` for cache-busting and **sweeping the previous generation's caches** (a ~190 MB-per-switch GeoJSON leak fix — see [World state](world-state.md) and the RAM audit notes). The two endpoint families:

| Family | URL | Backed by | Payload |
|---|---|---|---|
| Runtime **JSON** state | `/api/runtime/json/:key` (GET/PUT) | `readRuntimeJsonAsset`/`writeRuntimeJsonAsset` in `libraryStore.js` | Per-game/scenario state: `game`, `world`, `events`, `chat`, `advisor`, `actions`, `colors`, `flags`, `tags`, `prompts`, `snapshots`, `regionsGeojson`, `citiesGeojson`, `backgroundData` (`assets.js:260`) |
| Runtime **binary** tiles | `/api/runtime/pmtiles/:key` (GET/HEAD, range) | `resolveRuntimeBinaryAsset` → `streamBinaryFile` | `regions` / `countries` / `cities` PMTiles archives (or a scenario override) |

`game` vs `world`: `game.json` holds the player-facing scenario meta (`GAME_DEFAULTS` — country, difficulty, dates, round), `world.json` holds the mutable simulation (`WORLD_DEFAULTS` — units, markers, catalyst, reputation, region ownership/claimants, tags, label styling, history). Both are `gameState.js`.

### The `/api` surface (`server/server.js`)

| Route group | Methods | Store |
|---|---|---|
| `/api/library` | GET | Combined catalog (games + scenarios + active/selected ids + token) |
| `/api/games`, `/api/games/:id`, `/api/games/active`, `/api/games/:id/assets/:key` | GET/POST/PUT/DELETE | `libraryStore.js` games |
| `/api/scenarios`, `/api/scenarios/:id`, `/api/scenarios/selected`, `/api/scenarios/:id/export`, `/api/scenarios/import`, `/api/scenarios/:id/import`, `.../assets/:key` | GET/POST/PUT/DELETE | `libraryStore.js` scenarios + bundle import/export |
| `/api/runtime/json/:key`, `/api/runtime/pmtiles/:key` | GET/PUT/HEAD | per-game runtime state + tiles |
| `/api/mapeditor/documents…` | GET/POST/PUT/DELETE | `mapEditorStore.js` |
| `/api/basemaps…`, `/api/flags…` | GET/POST/DELETE | `basemapStore.js`, `flagStore.js` |
| `/api/ui-settings`, `/api/lang/:code` | GET/PUT | shared UI language + accumulated translation packs |
| `/api/ai/relay` | POST | Server-to-server relay to the player's OpenAI-compatible AI endpoint (defeats CORS) |
| `/api/hub/file`, `/api/hub/import-log`, `/api/hub/import-counts` | GET/POST | Community hub GitHub proxy (SSRF-guarded to GitHub hosts) + self-hosted import counter |
| `/api/server/shutdown` | POST | Exits the process (no button in the beta UI any more; scripts and the launcher) |
| `/fmg/*`, `*splat` | GET | Vendored FMG static + SPA fallback (`index.html`) |

**Security middleware** (`server/server.js:73`, `:112`): blanket permissive CORS (so the Android WebView's cross-origin *probe* works) but state-changing writes are blocked unless same-origin or loopback (`crossOriginWriteAllowed` in `security.js`); override with `OH_ALLOW_CROSS_ORIGIN=1`. See [Server & security](server-api.md).

### The three backends, one contract

| Backend | Entry | How it answers `/api/*` |
|---|---|---|
| Express (desktop / mobile) | `server/server.js` | Real HTTP routes; assets on disk under `DATA_DIR` (`server/dataDir.js`) |
| Web (browser) | `src/runtime/web/index.js` → `router.js` | Monkey-patches `window.fetch`: same-origin `/api/*` is routed to IndexedDB store handlers (`libraryStore.js`, `basemapStore.js`, `flagStore.js`, `editorStore.js`, `settingsStore.js`); PMTiles resolve to `VITE_OH_PMTILES_URL` or a connected content node; `/api/hub/*` forwards to the registry Worker. Everything non-`/api` passes through to the real `fetch`. |
| Embedded mobile | `mobile/nodejs-project/main.js` | Picks a writable `OH_DATA_DIR`, first-run-seeds from a bundled `seed/` snapshot, best-effort downloads map binaries, then `import("./server/server.js")` bound to `127.0.0.1`; the WebView loads it same-origin |

Because the web router keys on `url.origin === location.origin && pathname.startsWith("/api/")` (`router.js:153`), the client code (`library.js`, `assets.js`, editor IO, basemap library) is **byte-identical** across variants — it just calls `fetch("/api/…")`.

### Map render path (read side)

`World.jsx` builds a MapLibre style from three inputs — the ESRI basemap (via the `ohbase://` protocol that swaps ESRI's "not yet available" placeholder tiles for upscaled ancestors, `assets.js:418`), the terrarium DEM terrain/hillshade, or a **custom uploaded background** (image or vector) that replaces ESRI entirely (`useCustomBackground.js`). On top, child layers render game data pulled from the runtime JSON + PMTiles: `<Nations>` (region fills/borders/labels), `<Cities>`, `<Units>`, `<MarkersLayer>`, plus the `<Selection>` popups. Globe vs mercator, terrain on/off, and fullscreen are React state in `GameApp`, persisted to `localStorage` and passed down to both `<Map>` and `<UI>`. See [Map rendering](map-rendering.md).

### Write side (mutations)

Gameplay writes flow: **AI turn / cheat / UI action → `gameState.js` write → PUT `/api/runtime/json/{world|game|events|…}` → store persists → library token bumps → `assets.js` sweeps stale caches → affected layers re-read**. Library mutations (create/select/save game or scenario, asset upload) go through `src/runtime/library.js`, which force-refreshes the catalog and re-syncs the runtime token. See [World state](world-state.md) and [AI system](ai-system.md).

---

## 6. Beyond the game loop

| Subsystem | Summary | Page |
|---|---|---|
| **Map editor** | `?editor=1` route, OpenLayers, authors custom region/city/basemap maps, exports scenario bundles; can run the vendored FMG generator | [Map editor](map-editor.md) |
| **Community hub** | Scenario/basemap sharing via GitHub issues; server/Worker proxies downloads and counts imports | [Community hub](community-hub.md) |
| **Content nodes** | `server/node.js` — anyone-runnable, hash-addressed, read-only file server that offloads map-tile/bundle delivery; client re-verifies every byte against the signed manifest | [Content nodes](content-nodes.md) |
| **Web accounts + sync** | Google sign-in + E2E-encrypted game/scenario sync against the registry Worker (web build only) | [Web build & accounts](web-build.md) |
| **i18n** | `startTranslator()` live-translates the UI; server accumulates AI-generated language packs | [i18n & translation](i18n.md) |

---

### Quick "where do I look?" index

- Something wrong on the **map** → `src/Game/Map/` (start `World.jsx`, then `Nations.jsx`).
- Wrong **HUD/button** → `src/Game/GameUI/main.jsx` wires the shell; each control is its own file.
- **State not saving / stale after switch** → `src/runtime/gameState.js` + `src/runtime/assets.js` (`setRuntimeAssetEndpoints` cache sweep) + `src/runtime/library.js`.
- **API 404 / route** → `server/server.js` (desktop) or `src/runtime/web/router.js` (web).
- **Build/variant weirdness** → `vite.config.ts` (`define` flag + `dropMapBinaries`) and `.env.web`.
- **Boot hangs / blank screen** → `src/App.jsx` startup race + `src/runtime/preload.js`.
