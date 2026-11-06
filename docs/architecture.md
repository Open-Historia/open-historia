# Architecture Overview

Open Historia is a turn-based, AI-driven grand-strategy game that renders the whole Earth as an interactive map. The frontend is a single React 19 SPA (Vite build) that draws the world with MapLibre GL + PMTiles vector tiles and hosts an OpenLayers-based map editor behind a URL flag; the same client bundle runs against **two interchangeable `/api` backends** selected at compile time — a local Express server (the desktop app, or a self-hosted server) and an in-browser IndexedDB fetch-interceptor (the hosted website, and the Android app, which hosts the web build in a WebView; see [mobile.md](mobile.md)). Everything the client needs it asks for through the same `/api/*` calls, so the variants differ only in what answers those calls.

This page is the map of the codebase. Each subsystem has its own page; follow the cross-links.

---

## 1. Tech stack

| Concern | Choice | Where |
|---|---|---|
| UI framework | React 19 (+ `babel-plugin-react-compiler`) | `package.json`, `vite.config.ts` |
| Bundler / dev server | Vite 7 | `vite.config.ts`, `package.json` scripts |
| Map renderer | MapLibre GL 6, the game's own build of it (`vendor/maplibre-gl`), via `react-map-gl/maplibre` | `src/Game/Map/World.jsx` |
| Vector tiles | PMTiles 4 (`pmtiles`, `ol-pmtiles`) — regions / countries / cities archives | `src/runtime/assets.js`, `src/runtime/preload.js` |
| Map editor renderer | OpenLayers 10 (`ol`) — lazy-loaded, editor route only | `src/App.jsx`, `src/Editor/OlMap.jsx` |
| Geometry / GIS | `@turf/*`, `d3-geo`, `polygon-clipping`, `shpjs`, `geotiff` | `package.json` deps |
| Charts | Chart.js 4 (stats panel) | `src/Game/GameUI/stats.jsx` |
| Desktop / local server | Express 5 | `server/server.js` (inside Electron for the desktop app) |
| Map generator (desktop installers and source checkouts) | Azgaar Fantasy Map Generator: a prepared copy that reaches no outside host, packed by the installers; the Workshop hides its Generate tab where there is none (web, Android) | `fmg/`, `scripts/fetch-fmg.mjs`, `scripts/fmg-vendor.mjs` |
| Basemap raster tiles | ESRI/ArcGIS Online (public, token-free) + terrarium DEM (AWS) | `src/runtime/assets.js` |

The heavy map binaries (`regions.pmtiles`, ~21 MB as the z8 trim every build reads, `countries.pmtiles`, `cities.pmtiles`, plus the seed and stock-world geojson) are **never in Git** and never part of the script bundle — see [Map assets & PMTiles](assets-and-data.md). They are assets of a GitHub "map-data" Release, and every build reads its own copy from its own `/assets` folder (`src/runtime/worldFiles.js`). The desktop app fetches them on first launch (a checkout keeps them in `public/assets/`, gitignored). The website and the Android app carry six web-sized files, pinned in `scripts/map-assets.web.json` and laid into the build by `scripts/stage-map-assets.mjs`. A Vite plugin (`dropMapBinaries`, `vite.config.ts`) deletes whatever copies a developer's `public/assets/` holds from every build output, so a file over Cloudflare Pages' 25 MiB/file limit never reaches the site.

---

## 2. The three build variants

All three run the identical `src/` client. What changes is (a) the `VITE_OH_WEB` compile-time flag and (b) which process answers `/api/*`.

| Variant | Build command | `/api` backend | Asset storage | Distribution |
|---|---|---|---|---|
| **Desktop app** ("Download for Windows/Mac/Linux") | `npm run build` → `dist/`, packaged with `server/` by electron-builder | Express server `server/server.js`, run inside the Electron process on `localhost:3000` | Files under the data directory (`server/data/` from a clone; the app's user-data folder in the installed app, via `OH_DATA_DIR`) | Installers on the `desktop-stable` release (`desktop-installer.yml`); see [delivery](delivery-and-deploy.md) §4.1 |
| **Web build** (the hosted website `openhistoria.com/play/`) | `npm run build:web` / `build:site` → `dist-web/` | **No server** — a `fetch()` interceptor answers `/api/*` from IndexedDB | IndexedDB in the browser; map data from the site's own `/play/assets/`, six files laid in when the site is built | Cloudflare Pages |
| **Android app** | client from `dist-android/` (`npm run build:android`) inside the APK, with the world map under `www/assets` | None — the web backend (`src/runtime/web/*`) answers `/api/*` in the page | IndexedDB `open-historia-web`; map data read from the APK by HTTP Range | Capacitor APK (`mobile/`) — see [mobile.md](mobile.md) |

### How the compile-time flag selects the variant

The whole web branch hinges on one boolean literal, injected by Vite's `define`:

```
'import.meta.env.VITE_OH_WEB': JSON.stringify(mode === 'web')   // vite.config.ts
```

- `vite build` (any mode ≠ `web`) → `VITE_OH_WEB` is `false`. Rollup dead-code-eliminates every `if (import.meta.env.VITE_OH_WEB)` branch **and the dynamically-imported web backend** (`src/runtime/web/*`), so the desktop bundle never pulls in IndexedDB stores or the web-only generated seed files. This is why a fresh desktop extract (which has never run a web build) still builds and boots.
- `vite build --mode web` → `VITE_OH_WEB` is `true`, and Vite additionally loads `.env.web` (`VITE_OH_HUB_URL`, the community hub proxy; the map needs no setting). See [Web build](web-build.md).

The one place the flag is read at boot is `src/main.jsx` (below). Because the web backend is behind a **dynamic `import()`**, the desktop build never even references the module.

**Relevant `package.json` scripts:**

| Script | Effect |
|---|---|
| `dev` | `vite` — desktop client on `:5173`, proxying `/api` → `http://localhost:3000` (`vite.config.ts`) |
| `dev:web` | seeds web defaults, lays the map files `public/` lacks (`stage-map-assets.mjs public --missing-only`), then `vite --mode web` |
| `build` | desktop client → `dist/` |
| `build:web` | seeds, then `vite build --mode web --outDir dist-web`, then lays the map files into `dist-web/assets/` (`stage-map-assets.mjs dist-web`) |
| `build:site` | `build:web` with `--base /play/` + `scripts/assemble-site.mjs` (bolts the marketing `site/` around `/play/`; the map is served at `/play/assets/`) |
| `build:android` | `seed-web-defaults.mjs` + `vite build --mode android` → `dist-android/` (the Android app's bundle; `mobile/scripts/stage-www.mjs` adds the map data) |
| `test` | `node --test "server/**/*.test.js" "src/**/*.test.js"` — server and client tests, each beside its module; a tested module and its imports must load under plain Node (see [conventions](conventions.md) §7) |

---

## 3. Boot sequence

### 3a. `src/main.jsx` — the fork

`index.html` loads exactly one module, `/src/main.jsx`. It:

1. `configureMapRuntime()` — sizes MapLibre worker count + parallel image requests from `navigator.hardwareConcurrency` (`src/runtime/assets.js`).
2. Renders `<App/>` into `#root`, then `startTranslator()` (live UI translation when a non-English language is set — see [i18n & translation](i18n.md)) and registers the service worker (`public/sw.js`, production only, and not in the Android app, whose APK leaves `sw.js` out).
3. **The fork** (`src/main.jsx`):
   - If `VITE_OH_WEB`: `import("./runtime/web/index.js").then(installWebBackend)` installs the IndexedDB `/api` interceptor **before** `mount()`, so no request escapes uninstalled.
   - Else: `mount()` directly.

### 3b. `src/App.jsx` — routing (game vs editor)

`App()` reads URL params **once at render** (keeps hook order stable):

| URL | Renders | Notes |
|---|---|---|
| `?editor=1` | `<MapEditor/>` (lazy, `src/App.jsx`) | OpenLayers only fetched here; wrapped in `<Suspense>`. See [Map editor](map-editor.md) |
| anything else | `<ErrorBoundary><GameApp/></ErrorBoundary>` | `ErrorBoundary` (`src/runtime/ErrorBoundary.jsx`) shows a recoverable Reload screen on a render throw instead of a blank page, with a Save logging file button that attaches the crash's full stacks |

### 3c. `GameApp` — the page starts on the menu; a game is loaded when it is opened

`GameApp` (`src/App.jsx`) starts on the **main menu with no game loaded behind it**: no map instance, none of a game's regions, tiles, borders or labels, and no wait for a world to be drawn. The library still has an *active* game (the one last played), but nothing is loaded for it until the player opens a game. One module-level fact decides that, `src/runtime/gameEntry.js` (`hasEnteredGame()`, `enterGame()`, `useGameEntered()`): false on every page load, set once, never unset.

| State | Meaning | Set by |
|---|---|---|
| `startupState` | the startup screen's one step, **Syncing games and scenarios** | `createMenuStartupState()` (`src/runtime/preload.js`) |
| `isReady` | show `<UI>` (the menu), hide `<StartupScreen>` | `ensureLibraryCatalog()` settling either way, or `STARTUP_TIME_BUDGET_MS` (30 s) should it never answer |
| `door` | `"shut"`: show `<VaultDoor>` over the menu once `menuReady` (`isReady` and the door decided; `GameUI/VaultDoor.jsx`, [game-ui.md](game-ui.md) §1.4); the menu's music is held behind it (`holdMusicBehindDoor`) | `"deciding"` from the start until `runtime/vaultDoorDue.js` has compared the running build (`runtime/buildId.js`) with the one the door last opened for: `"shut"` the first time the game opens after an update, or at every opening with **Every time the game opens** (`vaultDoorAlways`), otherwise `"open"` (and the music is freed). `"open"` when the door has opened (`onOpened`, which keeps the build), or at once if it cannot be drawn (`DoorFrame`). The startup screen stays while `"deciding"`. Once a page: going back to the menu from a game does not shut it again |
| `gameEntered` (`useGameEntered()`) | mount `<WorldMap>` (the lazy MapLibre chunk), and run the game's warm-ups | `enterGame()`, below |

**Who enters a game.** The library, when a game it was asked to open has landed in its state: `activateGame` (Play on a game's card, the active one included, where the id does not change; Import & play; a shared game's stand-in) and `createGame({ setActive })` (a new game, a clone, Apply & Play) call `enterGame()` after the catalog is applied, never before, so the map does not start on the game that is on its way out. And the main menu, when it closes over the game that is already the active one with the library opening nothing: hosting or joining a shared game (`enterActiveGame` in `libraryBar.jsx`, the Lobbies tab's `onEnterGame`, and a phone's Back over a game the menu was opened from). The menu has no other way to be closed. Between a press of Play and the game landing, the menu is closed and nothing is entered yet: `GameUI/main.jsx` shows the cover loading screen (`awaitingGame`), a flow that fails opens the menu again, and should neither happen within the cover's 60 s ceiling the active game is entered.

**From entry on it is as it was.** The map mounts keyed on the active game; the **preload tasks** (`runStartupPreload`, `src/runtime/preload.js`: runtime JSON state, ESRI + terrain textures, `countries.pmtiles`, the country index, `cities.pmtiles`, `regions.pmtiles`) start with the first game entered, once a page, in the background with no screen of their own; the first world idle only warms the AI chunk (`prefetchGameplay`); and the cover (`useGameLoading`, whose wait and ceiling start at entry, not at mount) stays until the map has drawn. Leaving a game for the menu keeps that game loaded behind the menu: only the first game of a page waits for a Play.

**What waits for entry besides the map**: the game's own controls in `GameUI/main.jsx` (the date widget, which runs the game, the toolbar, Search, the forces, the advisor button), the AI timers, the scenario's music, Discord's "playing", the hooks that read the open game's documents (`useRuntimeState`; `useWorldState({ wait })` and `useCountryDisplayName(code, { wait })` for the two callers that are on screen with the menu), and the retry of a missing community basemap. The standalone editor route (`?editor=1`) is untouched, and the website's entry screen and the Android app's boot screen sit in front of the same menu.

See [Startup preload](assets-and-data.md).

Both `<Map>` and `<UI>` are keyed on `activeGameId` (not the library token) so a scenario "Apply & Play" — which writes many assets and bumps the token repeatedly — remounts the map exactly **once** (`src/App.jsx`).

---

## 4. Directory map

### Repo root

| Path | What lives there |
|---|---|
| `src/` | The React client (all three variants share this) |
| `server/` | Express server + on-disk stores (the desktop app and a self-hosted local server) |
| `scripts/` | Build/seed/signing/asset tooling (`.mjs`) — see below |
| `public/` | Static assets served as-is: `assets/` (map binaries, gitignored), `lang/` shipped language packs, `sw.js`, marketing HTML (`guides/`, `how-to-play/`, …) |
| `site/` | Marketing homepage shell wrapped around `/play/` by `build:site` |
| `mobile/` | Android app: Capacitor (`android/`, `www/`, `capacitor.config.json`) around the web build, plus the map-staging scripts (`scripts/`, which use the website's stager and list, `scripts/stage-map-assets.mjs` and `scripts/map-assets.web.json`); no server of its own — see [mobile.md](mobile.md) |
| `fmg/` | The game's prepared copy of Azgaar's Fantasy Map Generator (gitignored; fetched by `scripts/fetch-fmg.mjs`, packed by the desktop installers, served at `/fmg` for the editor's Generate drawer) |
| `tools/import-counter/` | Cloudflare Worker: the retired import counter. It keeps answering older game builds from the hub's index and stores nothing; this build does not call it ([delivery-and-deploy.md §7.1](delivery-and-deploy.md)) |
| `hub-templates/` | GitHub issue templates for the community scenario/basemap hub |
| `dist/`, `dist-web/`, `dist-site/` | Build outputs (desktop, web, assembled site) |
| `map-cache/` | The six map files a web build carries, downloaded and verified by `scripts/stage-map-assets.mjs` (gitignored) |
| `vite.config.ts`, `index.html`, `.env.web` | Build config + web-mode env |

### `src/` layout

| Path | Responsibility | Deep-dive |
|---|---|---|
| `src/main.jsx` | Entry: runtime config, mount, web/desktop fork | §3a |
| `src/App.jsx` | Route split (game vs editor), startup, and the map mounted when a game is opened | §3b/3c |
| `src/Game/Map/` | MapLibre map + layers: `World.jsx` (map shell + style), `Nations.jsx` (region fills/borders/labels), `Cities.jsx`, `Units.jsx` + `unitsController.js`, `MarkersLayer.jsx`, `GlobeEffects.jsx` + globe sun/star canvases, `useWorldState.js`, `useCustomBackground.js` | [Map rendering](game-map.md) |
| `src/Game/GameUI/` | The HUD: `main.jsx` (shell), `libraryBar.jsx` (top bar + main menu), `time.jsx` (date/turn), `chat.jsx` (toolbar/inbox), `advisor.jsx`, `forces.jsx`, `settings.jsx`, `search.jsx`, `stats.jsx`, `communityHub.jsx`, `actions.jsx`, `cheats.jsx`, `FactionCreator.jsx`, `CountryPickerMap.jsx`, `other.jsx` | [Game UI](game-ui.md) |
| `src/Game/Selection/` | Click-target popups: `Regions.jsx`, `CountryPanel.jsx`, `Units.jsx`, `Features.jsx` | [Selection & popups](game-ui.md) |
| `src/Game/AI/` | AI turn engine: `main.jsx` (provider chat), `gameplay.js`, `gameplayPrompts.js`, `gameplaySchemas.js`, `promptContext.js`, `providerConfig.js`, `defaultPrompts.json` | [AI system](ai-overview.md) |
| `src/runtime/` | Client "kernel": asset/endpoint layer, game/world state, library catalog, preload, i18n, startup UI | below |
| `src/runtime/web/` | **Web-only** backend (dead-code-stripped from desktop): `index.js`, `router.js`, IndexedDB stores, home page, the Android boot screen | [Web build](web-build.md) |
| `src/Editor/` | OpenLayers map editor (author custom maps) | [Map editor](map-editor.md) |

### `src/runtime/` (the client kernel)

| File | Role |
|---|---|
| `assets.js` | The asset/endpoint hub: defines `JSON_URLS`, `PMTILES_ARCHIVES`, ESRI basemaps, MapLibre `pmtiles`/`ohbase` protocols, `readJson`/`writeJson`/`warm*`, per-token cache sweeping. §5 |
| `library.js` | React store (`useSyncExternalStore`) for games/scenarios; wraps `/api/library`, `/api/games`, `/api/scenarios`; wires the active cache token + country-name overrides into `assets.js` |
| `gameState.js` | `GAME_DEFAULTS` + `WORLD_DEFAULTS`; read/write of the per-game `game.json` and `world.json` runtime state | [World state](world-state.md) |
| `preload.js` | A game's warm tasks (run when the first game is opened) + the startup screen's one step. §3c |
| `gameEntry.js` | Whether a game has been opened since the page started: nothing of a game is loaded before. §3c |
| `worldFiles.js` | Where a build reads its map files: `ASSETS_BASE` (`/assets`; `/play/assets` on openhistoria.com), `worldFileUrl`, `mapArchiveUrl` |
| `StartupScreen.jsx` / `ErrorBoundary.jsx` | Loading overlay; render-error recovery |
| `countryLabels.js`, `countryFlags.js`, `countryTags.js`, `countryNames`/`polityNames.js` | Country flag/tag/name resolution from `countries.pmtiles` + overrides; the picker's coarse region shapes |
| `communityBasemaps.js`, `communityFlags.js`, `basemapLibrary.js`, `flagLibrary.js` | Community/basemap/flag catalogs |
| `mapSettings.js`, `difficulty.js` | Map display settings, difficulty directives |
| `translator.js`, `i18n.js` | Live UI translation + language directives |
| `generated/` | Build-time generated tables (country names, etc.) |

### `scripts/` and `server/` (quick index)

| `scripts/*.mjs` | Purpose |
|---|---|
| `fetch-map-assets.mjs` / `map-assets.json` | Pull map binaries from the map-data Release (the desktop app and a local server) |
| `stage-map-assets.mjs` / `map-assets.web.json` | Fetch + sha256-verify the six map files the website and the Android app carry into `map-cache/`, and lay them into a web build |
| `seed-web-defaults.mjs` | Generate web-build seed data (default scenario) |
| `mobile/scripts/stage-map-assets.mjs` | The Android build's wrapper around `stage-map-assets.mjs` (`npm run map` in `mobile/`): the same list and cache |
| `extract-regions.mjs` / `extract-cities.mjs` / `build-default-map.mjs` | Build the PMTiles/geojson map data |
| `generate-country-*.mjs`, `generate-lang-packs.mjs`, `fetch-fmg.mjs` | Data/tooling generation |

| `server/*.js` | Purpose |
|---|---|
| `server.js` | The Express app: all `/api/*` routes, CORS, CSRF guard, static SPA serve, AI relay, hub proxy, shutdown |
| `libraryStore.js` | Games + scenarios store (catalog, assets, runtime JSON, import/export) — the on-disk heart |
| `mapEditorStore.js`, `basemapStore.js`, `flagStore.js` | Editor docs, basemaps, "My flags" stores |
| `dataDir.js` | Resolves the single writable `DATA_DIR` (`OH_DATA_DIR` or `server/data`) |
| `security.js` | Cross-origin write policy, hub URL allowlist, byte-range parsing |
| `ownerMigration.js`, `country-names.json` | Owner code→name migration, data |

---

## 5. Data flow: frontend ↔ `/api` ↔ stored assets

The client **never** talks to storage directly. Every state read/write is a same-origin `/api/*` call built in `src/runtime/`. A backend answers it. This indirection is exactly what lets the same client run on Express or on IndexedDB.

### The runtime asset endpoints

`setRuntimeAssetEndpoints({ token })` (`src/runtime/assets.js`) rebuilds every URL whenever the active library token changes, stamping `?v=<token>` for cache-busting and **sweeping the previous generation's caches** (a ~190 MB-per-switch GeoJSON leak fix — see [World state](world-state.md) and the RAM audit notes). The two endpoint families:

| Family | URL | Backed by | Payload |
|---|---|---|---|
| Runtime **JSON** state | `/api/runtime/json/:key` (GET/PUT) | `readRuntimeJsonAsset`/`writeRuntimeJsonAsset` in `libraryStore.js` | Per-game/scenario state: `game`, `world`, `events`, `chat`, `advisor`, `actions`, `colors`, `flags`, `tags`, `prompts`, `snapshots`, `regionsGeojson`, `citiesGeojson`, `backgroundData` (`assets.js`) |
| Runtime **binary** tiles | `/api/runtime/pmtiles/:key` (GET/HEAD, range) | `resolveRuntimeBinaryAsset` → `streamBinaryFile` | `regions` / `countries` / `cities` PMTiles archives (or a scenario override) |

`game` vs `world`: `game.json` holds the player-facing scenario meta (`GAME_DEFAULTS` — country, difficulty, dates, round), `world.json` holds the mutable simulation (`WORLD_DEFAULTS` — units, markers, interactive events, reputation, region ownership/claimants, tags, label styling, history). Both are `gameState.js`.

### The `/api` surface (`server/server.js`)

| Route group | Methods | Store |
|---|---|---|
| `/api/library` | GET | Combined catalog (games + scenarios + active/selected ids + token) |
| `/api/games`, `/api/games/:id`, `/api/games/active`, `/api/games/:id/assets/:key` | GET/POST/PUT/DELETE | `libraryStore.js` games |
| `/api/scenarios`, `/api/scenarios/:id`, `/api/scenarios/selected`, `/api/scenarios/:id/export`, `/api/scenarios/import`, `/api/scenarios/:id/import`, `.../assets/:key` | GET/POST/PUT/DELETE | `libraryStore.js` scenarios + bundle import/export |
| `/api/runtime/json/:key`, `/api/runtime/pmtiles/:key` | GET/PUT/HEAD | per-game runtime state + tiles |
| `/api/mapeditor/documents…` | GET/POST/PUT/DELETE | `mapEditorStore.js` |
| `/api/basemaps…`, `/api/flags…` | GET/POST/PUT/DELETE | `basemapStore.js`, `tiledBasemaps.js` (Tiled Basemap install jobs and archives, [ADR 0005](adr/0005-tiled-basemaps-stream-to-disk.md)), `officialBasemaps.js` (the official list of detailed maps, [ADR 0006](adr/0006-official-basemap-list.md)), `flagStore.js` |
| `/api/ui-settings`, `/api/lang/:code` | GET/PUT | shared UI language + accumulated translation packs |
| `/api/ai/relay` | POST | Server-to-server relay to the player's OpenAI-compatible AI endpoint (defeats CORS) |
| `/api/hub/file` | GET | Community hub GitHub proxy (SSRF-guarded to GitHub hosts). Import counts are read by the page from the hub's own index, not through the server |
| `/api/server/shutdown` | POST | Exits the process (no button in the UI any more; for scripts) |
| `/fmg/*`, `*splat` | GET | Vendored FMG static + SPA fallback (`index.html`) |

**Security middleware** (`server/server.js`): CORS only for the page's own origin and the app shells (`allowedCorsOrigin`: the Android app's WebView origins, so an Android app pointed at this server on the LAN can reach it) but state-changing writes are blocked unless same-origin or loopback (`crossOriginWriteAllowed` in `security.js`); override with `OH_ALLOW_CROSS_ORIGIN=1`. See [Server & security](server.md).

### The two backends, one contract

| Backend | Entry | How it answers `/api/*` |
|---|---|---|
| Express (desktop app, self-hosted server) | `server/server.js` | Real HTTP routes; assets on disk under `DATA_DIR` (`server/dataDir.js`; the desktop app points `OH_DATA_DIR` at its user-data folder) |
| Web (browser, and the Android app) | `src/runtime/web/index.js` → `router.js` | Monkey-patches `window.fetch`: same-origin `/api/*` is routed to IndexedDB store handlers (`libraryStore.js`, `basemapStore.js`, `flagStore.js`, `editorStore.js`, `settingsStore.js`); PMTiles are fetched from the build's own `/assets` folder (`src/runtime/worldFiles.js`); `/api/hub/file` forwards to the registry Worker. Everything non-`/api` passes through to the real `fetch`. The Android app is a host of this backend: the same code in a Capacitor WebView, with the map read from the APK (see [mobile.md](mobile.md)). |

Because the web router keys on `url.origin === location.origin && pathname.startsWith("/api/")` (`router.js`), the client code (`library.js`, `assets.js`, editor IO, basemap library) is **byte-identical** across variants — it just calls `fetch("/api/…")`.

### Map render path (read side)

`World.jsx` builds a MapLibre style from three inputs — the ESRI basemap (via the `ohbase://` protocol that swaps ESRI's "not yet available" placeholder tiles for upscaled ancestors, `assets.js`), the terrarium DEM terrain/hillshade, or a **custom uploaded background** (image or vector) that replaces ESRI entirely (`useCustomBackground.js`). On top, child layers render game data pulled from the runtime JSON + PMTiles: `<Nations>` (region fills/borders/labels), `<Cities>`, `<Units>`, `<MarkersLayer>`, plus the `<Selection>` popups. Globe vs mercator, terrain on/off, and fullscreen are React state in `GameApp`, persisted to `localStorage` and passed down to both `<Map>` and `<UI>`. See [Map rendering](game-map.md).

### Write side (mutations)

Gameplay writes flow: **AI turn / cheat / UI action → `gameState.js` write → PUT `/api/runtime/json/{world|game|events|…}` → store persists → library token bumps → `assets.js` sweeps stale caches → affected layers re-read**. Library mutations (create/select/save game or scenario, asset upload) go through `src/runtime/library.js`, which force-refreshes the catalog and re-syncs the runtime token (once per batch for a multi-write save, `withSingleLibraryRefresh`). See [World state](world-state.md) and [AI system](ai-overview.md).

---

## 6. Beyond the game loop

| Subsystem | Summary | Page |
|---|---|---|
| **Map editor** | `?editor=1` route, OpenLayers, authors custom region/city/basemap maps, exports scenario bundles; can run the vendored FMG generator | [Map editor](map-editor.md) |
| **Community hub** | Scenario/basemap sharing via GitHub issues; server/Worker proxies downloads and counts imports | [Community hub](runtime-services.md) |
| **Web saves** | No accounts and no sync: games and scenarios stay in this browser (IndexedDB) and move with game export/import (web build only) | [Web build](web-build.md) |
| **i18n** | shipped language packs translate the interface (22 languages); the AI translates only content, once, into the server's pack; the prompts' guidance ships translated | [Languages & Translation](i18n.md) |

### Scenario Political World authoring

The Scenario Editor's **Politics → Manage Political World** edits the canonical `world.politicalActors.byPolity` records through `src/Game/GameUI/countryEditorPolitical.js`. Government details include the legislature, seat capacity and next election; party details include stable IDs, parliamentary seats, support, coalition/governing role, native names, ideology and founding information. Government membership is recorded using canonical party IDs rather than independent role flags. Blank party-seat values mean unknown, while `0` means explicitly no seats. The editor rejects duplicate party IDs, excessive assigned seats and impossible electoral support totals rather than inventing corrective data.

The in-game **Cheats → Country Editor** uses that same `countryEditorPolitical.js` bridge against the live `world.politicalActors` record, exposing the legislature and party fields without creating a second Stats-side ledger. Its save path applies the same seat, support and party-ID checks before writing the world, and records a GM edit note.

The on-demand AI **Compile government and parties** workflow is a *candidate update*, not a historical source of truth: `src/Game/AI/gameplay.js` validates compiled totals before folding them into Political World. This protects basic arithmetic integrity but does not establish that every AI-authored party, coalition or election claim matches scenario canon. Use the manual authoring controls to review and correct such results.

---

### Advisor conversations and recipient identity

The **Advisor** remains a single chief-advisor conversation for legacy saves and for players who never add a contact. The existing `storage/advisor.json` stays an array so desktop/web imports, exports, restore points and native document notices remain compatible. Legacy conversation rows without `threadId` are the `chief` thread. Opt-in recipients are stored as `role: "advisor-contact"` records with stable IDs, bounded names/titles/personality text and optional Political World officeholder bindings; their messages carry that contact's `threadId`. Retiring a contact requires an explicit Cancel/Retire confirmation and marks the profile archived without deleting the transcript. An optional `role: "advisor-chief-profile"` record customizes the default chief advisor's displayed name, title and personality; absent that record, the scenario's original Advisor identity and prompt behave as before. Restoring defaults deletes only the override record, not messages or memories. The override is appended to the original scenario Advisor prompt rather than replacing its instructions, and the chief advisor cannot be retired.

`src/runtime/advisorThreads.js` owns the storage contract and preserves unrelated recipients and native document notices when a conversation is saved via `mutateAdvisorState`'s canonical write queue. `src/Game/AI/advisorSessions.js` keeps separate conversation histories, `ADVISOR_MEMORY` summaries and in-flight generation guards for each thread. The UI in `AdvisorRecipients.jsx` exposes manual contact creation, per-recipient identity editing, switching, archiving and restoration. Available Political World bindings currently include the player's head of government and head of state. A binding pins the *person occupying that office at the time*; an officeholder replacement must never inherit their predecessor's transcript. Manual contacts are conversation identities and **do not** by themselves create canonical ministerial appointments.

**M3C Action Review (local source candidate, not yet upstream):** Both the Chief and eligible Advisor/Minister contacts now generate durable **proposed** Action cards on their own saved messages; a reply does not automatically queue anything. Each proposal offers **Discuss** (prefills conversation with no canonical write) and **Proceed** (explicit player-authorized native Actions queue operation). `src/Game/GameUI/advisorActionReview.js` stores bounded proposal details and derives a stable queue ID from the originating reply ID/index, while `advisorActionApproval.js` re-reads the canonical saved message and recipient, rejects foreign/civilian/other-character and retired contacts, and uses the existing `mutateActionsState` serialized writer. Once the actual native Action write completes (or the identical stable ID is found), only then may the existing `advisor.json` record receive a confirmed receipt. An interrupted receipt save is safely retried without appending a duplicate create Action; multiple proposals are independent. Historical `actionsSummary` receipts from the prior Chief auto-queue behavior remain renderable. Updates/removals refer to an existing pending Action; unit-order removals requiring a map revert remain blocked here and must use the Actions panel. This is an approval gate, NOT a new execution engine: the simulation determines subsequent outcomes on a time skip. **Multiplayer limitation:** the current host `order` request has no stable source proposal ID or returned canonical Action ID, so this new review route fails closed in shared games rather than claiming idempotency or misreporting host rejection. **Projects remain automatic without approval:** the Chief and eligible domestic Advisor/Minister contacts may open and update Projects through the existing native `applyProjectOpsToWorld` contract. The Project write now runs inside `mutateWorldState`'s canonical write queue to avoid losing concurrent world changes, and replies display the actual accepted changes. Foreign/civilian/other-character conversations cannot mutate Projects. Speculative Project recommendations should be expressed in prose; Project blocks are reserved for decided sustained efforts or established progress. No Project author/lead schema, exclusive edit permissions, automatic office authority, commitment ledger or additional approval dialog is introduced. This implementation is a candidate until full tests, build and live acceptance; don't mistake it for released upstream Beta.

**M3C identity portion still outstanding:** Optional canonical person/office/faction links and their audience-scoped knowledge/authority are a separate submilestone. Typed names are not mandates. Advisor conversations remain user-initiated; proactive messaging, promises and deadlines, automatic ministry directives or delegated powers are deferred.

**Recipient Types foundation (M3A, scoped):** Optional `advisor-contact.recipientType` is restricted to `advisor-minister`, `citizen-civilian`, `foreign-official`, or `other-character`. Existing contact records without the field are read as `advisor-minister` without rewriting them, and chief messages remain unchanged. Manual character identities (e.g., a historical emperor or revolutionary representative) require no Political World appointment. An existing binding to the player's current head of state or government is available only for Advisor/Minister in M3A; typed contact creation is not canonical character creation, evidence of an office, or an assertion of diplomatic access. Invalid types fail closed. A type may change only before the contact has saved conversation history, so future civilian/foreign AI context cannot inherit a previous minister's confidential transcript. No existing chat/memory record is migrated or retired.

**M3A safety gate (historical checkpoint):** Before character-aware context existed, non-minister recipients could be created but their composer and AI send boundary were disabled. This was necessary because all contacts otherwise inherited the player's privileged government Advisor prompt and group lookup tools.

**M3B character conversations (current):** Citizen/Civilian, Foreign Official and Other Character contacts use an independent `src/Game/AI/characterConversations.js` prompt path. It receives only the saved recipient's identity/personality, the game date and player polity, and a bounded allowlist of public event date/title/description from the as-seen timeline; events with private audiences, secrecy flags or future dates are excluded. No player Action queue, private diplomatic transcript, government ledgers, intelligence, document reports, GM change notes, Advisor scenario prompt or AI lookup functions enter this branch. The initial AI boundary rereads the canonical `advisor.json` recipient, checks its identity/type/retirement status and rejects stale or forged types before the model call. Character catch-up messages are filtered to the same public event projection without GM changes; character replies cannot produce direct canonical operations, deploy units or supply diplomacy draft shortcuts. The chief Advisor and legacy minister prompts remain unchanged. Contacts preserve their individual transcripts and `ADVISOR_MEMORY` through reload, but their spoken declarations are NOT canonical events, agreements or appointments. This implements bounded **conversations**, not a full character simulation, universal person registry or general-purpose foreign-polity intelligence entitlement.

**Deferred:** M3C may extend justified canonical person/faction links and audience-aware faction knowledge without inventing a universal registry. Native group conversations, unsolicited messages, autonomous actions, promises as canonical records and delegated execution privileges remain deferred.

### Quick "where do I look?" index

- Something wrong on the **map** → `src/Game/Map/` (start `World.jsx`, then `Nations.jsx`).
- Wrong **HUD/button** → `src/Game/GameUI/main.jsx` wires the shell; each control is its own file.
- **State not saving / stale after switch** → `src/runtime/gameState.js` + `src/runtime/assets.js` (`setRuntimeAssetEndpoints` cache sweep) + `src/runtime/library.js`.
- **API 404 / route** → `server/server.js` (desktop) or `src/runtime/web/router.js` (web).
- **Build/variant weirdness** → `vite.config.ts` (`define` flag + `dropMapBinaries`) and `.env.web`.
- **Boot hangs / blank screen** → `src/App.jsx` startup (it waits for the library catalog only) + `src/runtime/gameEntry.js` (the map and the game's controls mount when a game is entered) + `src/runtime/preload.js`.
