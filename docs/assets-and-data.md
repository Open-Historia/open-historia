# Map Data & Assets

Open Historia paints the world from a handful of heavy, mostly-static binaries (three PMTiles vector archives, two GeoJSON seed/geometry files) plus small per-scenario JSON documents (colors, flags, tags, world state). This page traces where each asset physically lives (app bundle vs. the writable `OH_DATA_DIR` vs. a GitHub Release vs. a Cloudflare-hosted content swarm), how the server route layer resolves a scenario override on top of the shared default, and how the browser client (`src/runtime/assets.js`) caches, warms, primes, and memoizes everything without OOMing the tab. The single load-bearing rule: the big binaries are **never** in Git — they are downloaded from a GitHub Release named `map-data` on first launch, checksum-verified, and served locally.

---

## 1. Asset catalog

Every runtime asset the map depends on, with its physical filename, MIME, and how it reaches the browser.

| Asset | Key | File on disk | Source of truth | Served to client via | Notes |
|---|---|---|---|---|---|
| Regions vector tiles | `regions` | `regions.pmtiles` (~21.1 MB z8 trim on desktop/Android; ~105.8 MB z10 on the website) | `map-data` Release | `GET /api/runtime/pmtiles/regions` | GADM level-1 borders; the z0 tile is the region catalog; paints owners above z6.5. The website's z10 copy carries z9/z10, which the style never asks for — see `scripts/trim-pmtiles.mjs` |
| Countries vector tiles | `countries` | `countries.pmtiles` (~12.6 MB z8 trim on desktop/Android; ~62.7 MB z10 on the website) | `map-data` Release | `GET /api/runtime/pmtiles/countries` | z0 tile is the country index + label source; warmed on **every** map; the website's z10 copy has the same unused z9/z10 |
| Cities vector tiles | `cities` | `cities.pmtiles` (~1.5 MB) | `map-data` Release | `GET /api/runtime/pmtiles/cities` | Modern-day city labels layer |
| Custom regions geometry | `regionsGeojson` | `regions.geojson` (per-scenario) | Scenario dir, else the stock world below | `GET /api/runtime/json/regionsGeojson` | The scenario's own map (the built-in Modern Day has one, a hand-drawn world); a scenario without one renders on the stock world; **never cached client-side** |
| Stock world geometry | — | `server/data/stock/regions.geojson` (~55.4 MB) | `map-data` Release (`default-regions-names.geojson`) | via `regionsGeojson` for scenarios without a map | GADM level-1 regions with owner names — what the hub's re-ownership presets (keyed by GADM ids) and "Modern Day (classic map)" render on |
| Built-in scenario seed | — | `server/seed/default/` (`regions.geojson` ~5.6 MB, `cities.geojson`, `world.json`, `colors.json`, cover…) | the app bundle (committed) | copied into `server/data/scenarios/default` by the server | Modern Day's own map; `world.builtInMap` names the map generation (§3) |
| Custom cities geometry | `citiesGeojson` | `cities.geojson` (per-scenario) | Scenario dir | `GET /api/runtime/json/citiesGeojson` | Era-accurate city points; rendered when `world.customCities`; **never cached client-side** |
| Region seed | — | `regions-seed.geojson` (~55.3 MB) | `map-data` Release → `public/assets/` | `GET /assets/regions-seed.geojson` | Offline-produced seed the **map editor** imports; not a runtime map layer |
| City seed | — | `cities-seed.json` (~7.9 MB) | `map-data` Release → `public/assets/` | `GET /assets/cities-seed.json` | Consumed by the editor (`citiesImport.js`), AI prompt context (`promptContext.js`) and placing things by name (`worldCities.js`, read only when a phrase names a town the map lacks) |
| Nation colors | `colors` | `colors.json` (~3.4 KB) | Scenario dir, else app palette | `GET /api/runtime/json/colors` | Owner-name → hex; falls back to immutable `public/assets/colors.json` |
| Nation flags | `flags` | `flags.json` (per-scenario) | Scenario dir | `GET /api/runtime/json/flags` | Owner code → PNG data URL; `{}` when absent |
| Nation tags | `tags` | `tags.json` (per-scenario) | Scenario dir | `GET /api/runtime/json/tags` | Owner code → `string[]`; **starting** tags only (merge with `world.countryTags`) |
| Map background | `backgroundData` | `background.json` (per-scenario) | Scenario dir | `GET /api/runtime/json/backgroundData` | Heavy `{dataUrl}`/`{geojson}` payload; loaded only when `world.background` set |
| World state | `world` | `world.json` (per-game/scenario) | Game dir, else scenario | `GET /api/runtime/json/world` | The live simulation document — see [World state](world-state.md) |
| Runtime game JSON | `game`, `events`, `chat`, `actions`, `advisor`, `prompts`, `snapshots` | under game `storage/` | Game dir | `GET/PUT /api/runtime/json/<key>` | Per-game session state; polled ~5s |

The client-side URL and PMTiles-archive tables are declared in `src/runtime/assets.js` (`JSON_URLS`) and `src/runtime/assets.js` (`PMTILES_ARCHIVES` / `PMTILES_PROTOCOL_URLS`). The server-side filename maps live in `server/libraryStore.js` — `PMTILES_ASSET_FILES`, `SCENARIO_GEOJSON_ASSET_FILES`, `OPTIONAL_JSON_ASSET_FILES`, and `JSON_ASSET_DEFAULTS`.

**Basemap raster** (satellite/streets/terrain imagery) is *not* one of these files — it streams live from public ESRI/ArcGIS Online and AWS terrain tile servers (§8), so it is not part of the `map-data` Release.

---

## 2. Where assets come from — the four sources

An asset can be resolved from up to four places. Which one wins depends on the build (desktop/server vs. web) and whether the active scenario ships an override.

| Source | What lives there | Which builds |
|---|---|---|
| **App bundle** (`public/assets/`, or `dist/assets/` in a built app; `www/assets/` inside the Android APK) | The shared default `*.pmtiles`, `*-seed.*`, immutable `colors.json` (the Android app ships the z8 trims and the web-sized seeds, pinned in `mobile/map-assets.android.json`). The installed desktop app ships no map: it downloads it into the folder `OH_ASSETS_DIR` names | Server from a checkout / Termux / Android |
| **`OH_DATA_DIR`** (`server/data/…`, or the desktop app's user-data folder) | Per-scenario overrides, per-game state | Every build that runs the Express server |
| **`map-data` GitHub Release** | Canonical copies of every heavy binary, checksum-pinned | Fetched at install/update time |
| **Cloudflare / content-node swarm** | Byte-identical pmtiles served over HTTP range requests, hash-verified | Web build only |

### `OH_DATA_DIR` and the data-dir resolver

`server/dataDir.js` exports the single writable root every store shares:

```
DATA_DIR = process.env.OH_DATA_DIR ? resolve(OH_DATA_DIR) : <server>/data
```

A server run from a checkout, and Termux, leave `OH_DATA_DIR` unset → `server/data`. It is a generic writable-data override for a host whose app folder is read-only: the installed desktop app sets it to `<userData>/server/data`, and sets `OH_ASSETS_DIR` (the stock-PMTiles folder, `PMTILES_ASSETS_DIR` in `server/libraryStore.js`, default `public/assets`) to `<userData>/public/assets` (`electron/main.cjs`). The **Android** app has no server and no data dir: its library is the web backend's IndexedDB, and its map data is read from the APK (see [mobile.md](mobile.md)).

### PMTiles resolution order (server)

`resolveRuntimeBinaryAsset(assetKey)` (`server/libraryStore.js`) resolves in this order and streams the first hit with `streamBinaryFile`:

1. **Scenario override** — `getScenarioUploadPath(scenario.id, assetKey)` (an editor-uploaded per-scenario archive).
2. **Stock archive** — `<PMTILES_ASSETS_DIR>/<file>.pmtiles`: `public/assets/` from a checkout, or the folder `OH_ASSETS_DIR` names (where the installed desktop app downloads the map on first launch).

Because step 1 can serve different bytes after a scenario switch, the client rotates its PMTiles caches on token change (§6) — a correctness fix, not just memory hygiene.

### JSON resolution order (server)

`readRuntimeJsonAsset(assetKey)` — `server/libraryStore.js`:

- **Custom geometry** (`regionsGeojson`/`citiesGeojson`, in `SCENARIO_GEOJSON_ASSET_FILES`): resolved from the active game's scenario dir. A non-default scenario with no `regions.geojson` of its own **borrows the `default` scenario's** Modern-Day geometry; missing entirely → `EMPTY_FEATURE_COLLECTION`.
- **Per-game state** (`world`, `events`, `game`, `colors`, `flags`, `tags`, `snapshots`, …): active game dir first, then the selected scenario dir.
- **Optional JSON fallback**: only `colors` has a built-in fallback — the immutable app palette resolved from `dist/assets/colors.json` or `public/assets/colors.json` (`COLORS_ASSET_CANDIDATES`). `flags`/`tags` with no file → `{}`.
- Otherwise → `JSON_ASSET_DEFAULTS[assetKey] ?? {}`.

---

## 3. The `map-data` GitHub Release + manifest

The heavy binaries used to live in Git LFS; the org's free LFS *bandwidth* is 1 GB/month shared, and a full checkout pulls ~200 MB, so a few installs exhausted it and every subsequent download 403'd. They now ship as **assets on a GitHub Release** (`Open-Historia/open-historia`, tag `map-data`), whose download bandwidth is free and unmetered. See `scripts/fetch-map-assets.mjs` for the full rationale.

### `scripts/map-assets.json`

The manifest that `fetch-map-assets.mjs` reads. Note the **name/namespace split**: `path` is the *stable client location* the game serves from; `asset` is the *versioned release filename* uploaded to GitHub.

| `path` (stable client name) | `asset` (release name) | bytes | Why the names differ |
|---|---|---|---|
| `public/assets/regions.pmtiles` | **`regions-z8.pmtiles`** | 21 106 005 | the z8 trim (`trim-pmtiles.mjs` below); the full z10 `regions.pmtiles` stays on the release for the website |
| `public/assets/countries.pmtiles` | **`countries-z8.pmtiles`** | 12 580 027 | the z8 trim, as above |
| `public/assets/cities.pmtiles` | `cities.pmtiles` | 1 547 924 | same |
| `public/assets/cities-seed.json` | `cities-seed.json` | 7 857 627 | same |
| `public/assets/regions-seed.geojson` | **`regions-seed-z8.geojson`** | 55 350 393 | client name is stable; release name is versioned to a zoom generation (z8) |
| `server/data/stock/regions.geojson` | **`default-regions-names.geojson`** | 55 401 660 | the stock GADM world with owner names — every scenario without a map of its own renders on it (it WAS the built-in scenario's file until Modern Day was redrawn; the release name kept its history) |

Root keys: `owner: "Open-Historia"`, `repo: "open-historia"`, `release: "map-data"`. Download URL is `https://github.com/<owner>/<repo>/releases/download/<release>/<asset>`.

**Namespacing gotcha:** the client always requests the *stable* path (e.g. `regions-seed.geojson`), while the release stores a *versioned* name (`regions-seed-z8.geojson`). The manifest is the only bridge. If a new zoom generation is uploaded under a new release name but the manifest's `sha256`/`bytes` aren't bumped, clients keep the old bytes; conversely a stable client name can silently point at a stale release generation. **When a map file changes: upload the new asset AND update its `sha256` + `bytes` in the manifest.**

### The built-in scenario seed (`server/seed/default`)

The built-in Modern Day scenario is **not** on the release and not under `server/data` in Git. It is a committed seed directory — `scenario.json`, `world.json`, `game.json`, `colors.json`, `cover-image.bin`, `storage/*.json`, and its own map: `regions.geojson` (a hand-drawn world of ~4,850 regions, ~5.6 MB) and `cities.geojson` (~2,500 authored cities). The app bundle ships it (`server/**`), and `server/libraryStore.js` (`syncBuiltInScenarioFromSeed`) copies it into the data directory:

- **First run:** the whole seed is copied into `server/data/scenarios/default` (a packaged install used to get only a meta file and the fetched map; now it gets the world, colours and cover too). `prompts.json` is deliberately not copied — a game starts on the code's current prompt defaults.
- **A newer map in the seed** (`world.json` `builtInMap` differs from the install's): the campaigns started on the previous map — and a built-in the player had edited — keep it in a forked scenario, `modern-day-classic` ("Modern Day (classic map)"), and those games are re-pointed at the fork; then the built-in is reset to the seed. The fork carries no `regions.geojson`: the previous built-in map was the stock world, so the fork renders on it like any other scenario without a map. An install whose built-in still holds the stock file as its `regions.geojson` has that file **moved** to `server/data/stock/` (the size matches the manifest entry) rather than downloaded again; a file of another size is a map the player uploaded and travels with the fork. `electron/main.cjs` does the same move before the manifest check so the setup screen never re-downloads it.
- **Newer content on the same map** (`world.json` `builtInRevision` above the install's; 1 when unstamped — revision 2 renamed the countries to their common names): the built-in is refreshed **in place** (`refreshBuiltInContent`). Every campaign keeps its own world, colours, flags and tags and reads only the geometry from the built-in, which a revision never changes, so its campaigns stay on it; one old enough to still read the scenario's colours, flags, tags or stats sheet is first given copies of them. A built-in the player changed (its `updatedAt` moved: the Workshop, the scenario settings, the cheats panel's city tool) is instead kept as `modern-day-edited` ("Modern Day (your edited copy)") with its map and the campaigns started on it, then the built-in is reseeded. No stamp change, so no scenario loses the bundled map.
- **A deliberately deleted built-in** stays deleted (the guard in `ensureDefaultScenario`).
- **A scenario created from scratch** copies the built-in's map, cities and colours (`createScenario`), so it starts on the same world the game shows — and the Workshop opens on that map rather than the stock seed.

To ship a new built-in map: open Modern Day's Workshop, import the map, Save, copy the resulting `regions.geojson`, `cities.geojson`, `world.json` and `colors.json` from the data directory into `server/seed/default/`, and change `world.builtInMap` to a new value. To ship new content on the same map (names, colours, claims — the region ids and geometry unchanged), raise `world.builtInRevision` instead: a new stamp would fork every campaign and, on the web, send every scenario carrying the old stamp back to the stock world. `server/builtInScenarioSeed.test.js` checks the seed's world matches its map and exercises every branch above.

The web build bundles the same map: `scripts/seed-web-defaults.mjs` copies it beside the generated seed module and `src/runtime/web/generated/defaultScenarioMeta.js` exports its URL and stamp; `src/runtime/web/libraryStore.js` serves it for any scenario whose world carries the stamp (`usesBuiltInMap`) and keeps fetching the stock world from the content origin for every other scenario without a map. Its `ensureSeeded` runs the same fork-and-reset for a stored library that predates the redraw, and the same in-place refresh for one a revision behind (`defaultScenarioMeta.js` exports `builtInRevision` too).

### `scripts/fetch-map-assets.mjs`

Makes the local tree match the manifest. Called by the desktop app on launch (`electron/main.cjs`, `--ensure`) and run by hand after a clone, **in place of** `git lfs pull`.

| Mode | Command | Behaviour |
|---|---|---|
| Verify | `node scripts/fetch-map-assets.mjs` | Re-fetch anything whose SHA-256 differs (picks up a re-uploaded map, repairs truncation) |
| Ensure | `node scripts/fetch-map-assets.mjs --ensure` | Faster: a right-size file is hashed only when `.map-assets-verified.json` has no stamp for it, or its size or mtime changed since it passed; missing, wrong-size and wrong-hash files are fetched |
| Progress | add `--progress` to either | Also prints `@progress {"asset","received","total"}` lines while a file downloads (the first, the last, and at most one every 250 ms between) |

Each file streams to `<dst>.download` and is hashed as it arrives (a 100 MB archive is never held in memory), and the SHA-256 is checked **before** it is renamed into place, and is **best-effort**: it never exits non-zero (`process.exit(0)` on every path) so a network failure can never block a launch or update. Requires Node 18+ for global `fetch`.

Manifest paths are relative to the current directory, except that the fetcher follows the server's folders when they are set (`resolveAssetTarget`): `public/assets/…` lands in `OH_ASSETS_DIR` and `server/data/…` in `OH_DATA_DIR`. The desktop app sets both before it spawns the fetcher, and its setup check (`assetTarget` in `electron/main.cjs`) applies the same rule, so the check, the download and the server look at one folder. That matters for the packaged beta, whose `OH_ASSETS_DIR` is the stable app's `%APPDATA%/open-historia/public/assets` while its own data lives under `Open Historia Beta`; `server/mapAssetsFetch.test.js` keeps the two rules in step.

On the desktop, a missing or wrong-size file opens the setup window before the server starts: `downloadMapData` runs the fetcher with `--ensure --progress` and turns the `@progress` lines into the bar. Because the fetcher always exits 0, `electron/main.cjs` checks the disk again afterwards; if files are still missing it logs `map.incomplete` and the window says how many map files could not be downloaded and offers **Try again** or **Continue without the map**. Every stderr line of the fetcher, from the setup download (`map.download`) and the background check (`map.verify`), goes to the Desktop log. After the game window is up, `verifyMapData` runs `--ensure` again in the background, which is what finds and repairs a file damaged on disk without changing length.

The verified-state file (`.map-assets-verified.json`, in the current directory: the repo root for a source install, the app's userData on the desktop; gitignored) maps each file's path on disk to the `sha256`, `size` and `mtimeMs` it passed with. It is rewritten after every run and only ever saves a re-hash: deleting it is safe.

### `scripts/trim-pmtiles.mjs` — the zoom levels nothing draws

`regions.pmtiles` and `countries.pmtiles` were cut at `-z10`, but the map mounts both as vector sources capped at `maxzoom: 8` (`src/Game/Map/Nations.jsx`), and past z8 MapLibre overzooms the z8 tile rather than asking for a z9 one. Those two levels are **80% of both archives** and have never been drawn.

```
node scripts/trim-pmtiles.mjs <input.pmtiles> <output.pmtiles> <maxzoom> [--verify]
```

A pure repack: tile bodies are copied across still compressed, byte for byte, so nothing is re-encoded and nothing about how the map looks can change. Tile type, compressions, bounds, center, minZoom and the metadata blob are preserved; `maxZoom`, the counts, the directories and every offset are rewritten. `--verify` reads both archives back and compares tiles.

| Archive | Now | At z8 | Saved |
|---|---|---|---|
| `regions.pmtiles` | 105,827,424 | 21,106,005 | 84.7 MB |
| `countries.pmtiles` | 62,739,546 | 12,580,027 | 50.2 MB |
| `cities.pmtiles` | 1,547,924 | — | nothing; `-zg` already stopped it at z3 |

That is **134.9 MB off the 288.7 MB** a player pulls on first launch. The trims are on the `map-data` release as `regions-z8.pmtiles` and `countries-z8.pmtiles`, and `scripts/map-assets.json` (desktop and local server) and `mobile/map-assets.android.json` pin them. An install that already has the z10 archives replaces them on its next launch: their size no longer matches, so the desktop setup check and `--ensure` both fetch the trims. Because a packaged beta shares the stable app's `public/assets`, the pins must change on every branch in the same release, or a tester with both apps re-downloads one or the other on every launch.

The website is unchanged: it fetches `regions.pmtiles` / `countries.pmtiles` (z10) by name through the Worker proxy, and `public/content-manifest.json` is built from its own list, `scripts/map-assets.web.json`. Moving it to the trims means serving the `-z8` bytes under the names it requests (or mapping the names in `router.js` and `contentTrust.js`), then rebuilding and re-signing the manifest and re-populating the nodes.

Two things a trimmed archive still says about itself: the metadata blob is preserved verbatim, so `vector_layers[0].maxzoom` and `tilestats` still describe z10 (MapLibre reads the header, not these, so rendering is unaffected — `tippecanoe-decode` and friends would be misled), and `centerZoom` is carried across as it was.

### Android variant

The Android app ships its map data **inside the APK**: `mobile/scripts/stage-map-assets.mjs` downloads the six files pinned in `mobile/map-assets.android.json` from the same `map-data` release (the z8-trimmed archives, `cities.pmtiles`, and the web-sized `default-regions.geojson`, `regions-seed.geojson`, `cities-seed.json`), verifies each sha256, and `stage-www.mjs` lays them under `www/assets/`. The interceptor's `/api/runtime/pmtiles/<key>` becomes one whole-file read of `/assets/<key>.pmtiles` from Capacitor's local server, sliced in memory — that server ignores the end of a Range, so the app never sends one (`src/runtime/wholeFileSource.js`). Nothing is downloaded at first run and nothing is streamed from a content node.

---

## 4. Server runtime routes

The client talks only to these same-origin routes (`server/server.js`). In the **web build** there is no Express server — a `fetch()` interceptor in `src/runtime/web/router.js` answers the same paths from IndexedDB / a content CDN (§7).

| Route | Handler | Purpose |
|---|---|---|
| `GET /api/runtime/json/:assetKey` | `readRuntimeJsonAsset` | Serve a runtime JSON doc; `Cache-Control: no-store` (`server.js`) |
| `PUT /api/runtime/json/:assetKey` | `writeRuntimeJsonAsset` | Persist to the active game; echoes back the normalized record (`server.js`) |
| `GET /api/runtime/pmtiles/:assetKey` | `resolveRuntimeBinaryAsset` | Stream a pmtiles archive (range-capable via `streamBinaryFile`) (`server.js`) |
| `HEAD /api/runtime/pmtiles/:assetKey` | `resolveRuntimeBinaryAsset` | `Content-Length` for the client freshness check; `Accept-Ranges: bytes` (`server.js`) |
| `GET/PUT/DELETE /api/scenarios/:id/assets/:assetKey` | scenario asset store | Upload/serve per-scenario overrides (pmtiles, geojson, flags, tags, cover) (`server.js`) |
| `GET/PUT/DELETE /api/games/:id/assets/:assetKey` | game asset store | Per-game images (`server.js`) |

`writeRuntimeJsonAsset` (`libraryStore.js`) auto-creates a game from the selected scenario if none is active, canonicalizes country refs for `world`/`game`/`colors`, then writes to the game dir and returns the re-read record. That echoed record is what the client caches (§5, `writeJson`).

---

## 5. Client asset layer — `src/runtime/assets.js`

The browser's single module for reading, writing, warming, priming, and caching every asset. All URLs carry a `?v=<runtimeAssetToken>` query so a library mutation invalidates by URL identity.

### Endpoint wiring — `setRuntimeAssetEndpoints`

`assets.js`. Called on boot and on every scenario/game/library switch with a new `token`. It:

1. **Sweeps the old generation's caches BEFORE rebuilding the URLs** — the old URL strings are the only handles to those entries, so this must run first or the parsed GeoJSON (~190 MB on a 55 MB `regions.geojson`) is stranded forever.
2. Rebuilds every `JSON_URLS.*` = `withRuntimeToken("/api/runtime/json/<key>")`.
3. Rebuilds `PMTILES_ARCHIVES.*` = `buildAbsoluteUrl("/api/runtime/pmtiles/<key>")` and the `pmtiles://…` protocol URLs.

The token also gates the PMTiles cache rotation: dropping `binaryValueCache`, `binaryRequestCache`, `pmtilesArchives`, the `Protocol` tile registry, and the `pmtilesCache` header — both to free the ~162 MB of warmed buffers and because `/api/runtime/pmtiles/:key` can serve *different bytes* after a switch (a stale directory applied to new bytes would decode garbage).

### Reading JSON — `readJson`

`assets.js`. Options: `{ cache, defaultValue, force, signal }`.

| Behaviour | Detail |
|---|---|
| Store decision | Snapshotted synchronously at call time via `isNoStoreJsonUrl` (see below) — never re-evaluated post-`await` |
| Value cache | `jsonValueCache` (Map, URL-keyed, no TTL/cap; swept on token change) |
| Request batching | `jsonRequestCache` de-dupes concurrent fetches to the same URL even with `force:true` — the ~5 s Nations/Cities/background/units pollers share one network request |
| Failure fallback | With `defaultValue`, serves a clone but **does not cache** it (transient failure must not pin a default). Each caller applies its OWN default: the shared request rejects, so a caller with none gets the error (it used to be handed whichever default the first caller brought). A failed fetch's error carries `status` |
| Parse bookkeeping | `jsonLoadedUrls.add(url)` records a genuine parse *inside* the try — lets `loadRegionCatalog` tell "no custom regions" apart from "fetch failed, retry" |

`isNoStoreJsonUrl(url)` (`assets.js`) returns true for `regionsGeojson` and `citiesGeojson`. These FeatureCollections are huge and their only long-lived reader keeps them in React state (`Nations.jsx`/`Cities.jsx`, both `force:true`), so caching a second parsed copy is pure waste. It **must** be evaluated synchronously (the comment on `isNoStoreJsonUrl` explains why an after-`await` check resurrects the leak on scenario switch).

### Writing JSON — `writeJson` / `primeJson`

- `writeJson(url, data)` (`assets.js`) `PUT`s the payload, then caches **what the store echoed back** (the normalized record), not what was sent — legacy-record rewrites on the way in used to be pinned out of view. It calls `primeJson`, `invalidateDerivedCachesForWrite`, and `persistResponse`.
- `primeJson(url, data)` (`assets.js`) seeds the value cache (or deletes it for no-store URLs) and marks `jsonLoadedUrls`. Used to make a write immediately visible without a round-trip.
- `invalidateDerivedCachesForWrite(url)` (`assets.js`) drops the memoized `colors`/`flags`/`tags`/`world`-derived promises on a matching write and fires the `oh:colors-updated` DOM event so the live map repaints without a reload.

### Reading/priming binary — PMTiles

| Function | Role |
|---|---|
| `getPmtilesArchive(url)` | Return cached `PMTiles` or register a new one |
| `warmPmtilesArchive(url)` | Download the full archive into `binaryValueCache`, then prime. **Web build** tries the hash-verified node swarm first (`contentTrust.js`), falls through to the origin |
| `primePmtilesArchive(url, buffer)` | Store the ArrayBuffer and register a `MemorySource`-backed archive |
| `registerPmtilesArchive(url)` | `new PMTiles(source, pmtilesCache)` + register on the `Protocol` |

`MemorySource` (`assets.js`) wraps an in-memory `Uint8Array` and satisfies `getBytes(offset, length)` locally, so once an archive is warmed the PMTiles library slices it in memory instead of issuing range requests. `createPmtilesArchive` uses a `MemorySource` when the bytes are in `binaryValueCache`, else the URL (range fetches). Directory/header decode caching is the shared `pmtilesCache = new SharedPromiseCache(256)`.

### `resolveCountryDisplayName` and the resolver

`assets.js`. `resolveCountryDisplayName(name, code)` delegates to a swappable `countryNameResolver` installed via `setCountryNameResolver` — the i18n / localization layer registers a resolver so PMTiles feature names (`Country`/`NAME`/…) render translated. It defaults to identity. Used by both `loadCountryNames` and `loadRegionCatalog` when decoding the z0 tile.

### Cache inventory

| Cache | Keyed by | Contents | Rotated on token? |
|---|---|---|---|
| `jsonValueCache` | full URL | parsed JSON docs | yes |
| `jsonRequestCache` | full URL | in-flight JSON promises | yes |
| `jsonLoadedUrls` (Set) | full URL | "did a genuine parse happen" | yes |
| `binaryValueCache` | full URL | pmtiles `ArrayBuffer`s | yes |
| `binaryRequestCache` | full URL | in-flight pmtiles fetches | yes |
| `pmtilesArchives` | full URL | `PMTiles` instances | yes |
| `pmtilesCache` | source key | header/dir LRU (256) | header entry cleared |
| `runtimeJsonValueCache` / `runtimeJsonRequestCache` | asset **key** | web-build IndexedDB-backed docs | cleared (correctness) |
| `remoteValueCache` / `remoteRequestCache` | URL | warmed raster tile sizes | no |
| memoized promises: `nationColorsPromise`, `nationFlagsPromise`, `nationTagsPromise`, `countryNamesPromise`, `regionCatalogPromise` | scenario token | derived catalogs | re-keyed |

---

## 6. Persistent Cache Storage + freshness

`fetchWithPersistence(url)` (`assets.js`) layers a `CacheStorage` cache (`PRELOAD_CACHE_NAME = "open-historia-preload-v2"`) over the network so warmed assets survive reloads:

1. Look up the persisted `Response`.
2. If present, issue a **`HEAD`** and compare `Content-Length` against the cached copy's. Equal (or the server can't answer, i.e. offline) → serve cached. Differ → refetch (an update replaced the file on disk).
3. Miss → `fetch(url, {cache:"force-cache"})`, then `persistResponse(url, clone)`.

The `v1` → `v2` cache-name bump exists because `v1` had no freshness check and could serve months-old map data forever; the bump flushes everyone once and the `HEAD` check keeps it fresh thereafter. `jsonHeadersFor` stamps the real UTF-8 byte length on client-written responses so the `HEAD` comparison isn't silently disabled by a missing `Content-Length`.

The **web build** uses a parallel key namespace: `buildRuntimeCacheUrl(key)` → `…/__runtime-cache/<key>.json`, read/written by `readRuntimeJson` / `writeRuntimeJson` which are keyed by *asset key* (not URL) and therefore cleared wholesale on a token change (they'd otherwise serve the previous game's state).

---

## 7. Web build differences

Under `import.meta.env.VITE_OH_WEB` there is no node server:

- **Route interception:** `src/runtime/web/router.js` installs a `fetch` interceptor for same-origin `/api/*`. `/api/runtime/pmtiles/:key` (`router.js`) checks a scenario override in IndexedDB (`getScenarioPmtilesOverride`), else fetches `${VITE_OH_PMTILES_URL || "/assets"}/<key>.pmtiles`. The hosted site sets `VITE_OH_PMTILES_URL` to the **registry Worker's CORS+range proxy**, because Cloudflare Pages can't host the 60–100 MB archives directly (same-origin would 404 to the SPA fallback).
- **Verified content swarm:** `warmPmtilesArchive` (`assets.js`) dynamically imports `src/runtime/web/contentTrust.js` and calls `fetchVerifiedBuffer(url)`. It maps the URL to a manifest asset id (`assetIdFromUrl`, `contentTrust.js`), fetches `<node>/oh/v1/content/<sha256>` from the vetted node swarm, and verifies **every byte** against the signed `content-manifest.json`. A bad/broken node can at worst force a retry — it can never deliver tampered bytes — and any failure falls through to the canonical origin, so a node outage is invisible. The signed node **directory** (`VITE_OH_DIRECTORY_URL`) is a deny-list/control doc; live addresses come from `nodes-live.json`. This whole block is stripped from the local download.
- **Worker fetches:** the `window.fetch` patch is invisible to workers — MapLibre's tile workers and the political-cartography worker (`src/Game/Map/vnext/polityBoundariesWorker.js`) fetch with their own global — so the scenario's regions GeoJSON is re-served to the `custom-regions-source` and the worker through a `blob:` URL: `prepareWorkerFetchableUrl(url)` (`assets.js`) fetches the runtime URL on the page and stages the bytes as a blob; `useWorkerFetchableUrl` (`src/Game/Map/useWorkerFetchableUrl.js`) hands that URL to `Nations.jsx`, which keeps the runtime URL as the identity for geometry epochs, catalog keys and readiness. MapLibre forwards a non-http(s) URL from its workers to the main thread, and a dedicated worker resolves a blob URL its page created. Copies are released (revoked after a grace period) when the token rotates or the asset is written. The desktop keeps the plain URL.
- **Origin check:** the origin fallback in `warmPmtilesArchive` is held to the same signed manifest through `verifyOriginBuffer(url, buffer)` (`contentTrust.js`): `checked` is false — the bytes trusted as before — when the manifest is unsigned or missing, does not list the asset, or the active scenario serves its own archive under the runtime URL (`hasScenarioPmtilesOverride`, `libraryStore.js`); a scenario's own archive is never fetched from the swarm either. Only a signed hash that contradicts the bytes fails the archive.

See the [Node network](delivery-and-deploy.md) notes for the swarm/registry architecture.

---

## 8. Startup preload + the ~162 MB prime

`src/runtime/preload.js` warms the map before React fully mounts, inside a **30 s time budget** (`STARTUP_TIME_BUDGET_MS`). Tasks run serially, each with an `AbortController` wired to the remaining budget; the budget expiring aborts the current task and leaves the rest to load lazily in-game.

| # | id | Label | Weight | Warms | Skipped on custom map? |
|---|---|---|---|---|---|
| 1 | `state` | Syncing saves and runtime state | 12 | `game`,`prompts`,`colors`,`actions`,`chat`,`advisor`,`events`,`world` JSON | no |
| 2 | `textures` | Warming world textures | 20 | ESRI basemap + AWS terrain raster tiles (global z0–2 + initial viewport) | **yes** — a custom `world.background` replaces the basemap entirely |
| 3 | `countries` | Caching country geometry | 26 | `countries.pmtiles` (~62.7 MB) | **no** — needed for country names and bounds on every map |
| 4 | `country-index` | Building country index | 8 | `loadCountryNames()` | no |
| 5 | `cities` | Caching city layer | 10 | `cities.pmtiles` (~1.5 MB) | no |
| 6 | `regions` | Caching regional borders | 24 | `regions.pmtiles` (~105.8 MB) | **no** — paints owners above z6.5 even on custom maps |

There used to be a `country-labels` task that built the stock modern-country label atlas; no served world draws it (every world is a custom one), so it is gone, and the preload deletes the `country-labels-*` entries it left in Cache Storage (`deleteRuntimeJsonByPrefix`).

**The ~162 MB prime:** warming tasks 3+5+6 pulls all three archives fully into `binaryValueCache` as in-memory `ArrayBuffer`s — the code cites regions ≈101 MB + countries ≈60 MB + cities ≈1.5 MB ≈ **162 MB** resident (`assets.js`; on-disk manifest sizes total ~170 MB). This is a deliberate memory-for-latency trade: a fully-warmed `MemorySource` archive answers tile requests without further network I/O. The cost is that this ~162 MB must be **freed on scenario switch** — which is exactly what the PMTiles cache rotation in `setRuntimeAssetEndpoints` (§5) does. See the [RAM & paint audit](architecture.md) notes for the broader memory backlog (the geojson double-store, pinned PMTiles).

Task results feed a weighted progress bar: `normalizeTaskResult` (`preload.js`) sums the `.size` of each warmed asset into `loadedBytes`, and `progress = completedWeight / TOTAL_WEIGHT`.

---

## 9. Derived catalogs (memoized accessors)

These read the z0 PMTiles tile (or a JSON doc) once per scenario and cache the derived result on the scenario token. They power AI prompts, pickers, and labels.

| Accessor | Reads | Produces | Cache key |
|---|---|---|---|
| `getNationColors()` | `colors.json` | owner-name → hex map | `JSON_URLS.colors` |
| `getNationFlags()` | `flags.json` | owner-code → PNG data URL (`{}` default) | `JSON_URLS.flags` |
| `getNationTags()` | `tags.json` | owner-code → `string[]` **starting** tags (merge with `world.countryTags`) | `JSON_URLS.tags` |
| `loadCountryNames()` | `countries.pmtiles` z0 tile + `world.polityOverrides` | sorted `{code,name}[]` country index | `PMTILES_ARCHIVES.countries` |
| `loadRegionCatalog()` | `regions.pmtiles` z0 tile + `regions.geojson` custom names | sorted `{id,name,country,countryCode}[]` | `PMTILES_ARCHIVES.regions` + `JSON_URLS.regionsGeojson` |

Common invariants: each drops its promise on failure so the next call **retries** instead of pinning an empty catalog for the session; each is invalidated by `invalidateDerivedCachesForWrite` when its underlying asset is written.

- **`loadCountryNames`** decodes the `countries` vector-tile layer, dedupes by resolved display name (`resolveCountryDisplayName`), then merges `world.polityOverrides` — a nameless override never degrades a real name to a bare code.
- **`loadRegionCatalog`** decodes the stock `regions` layer, then **overlays the scenario's own `regions.geojson`**: the world's own name for a region wins (a world that renamed "Warmińsko-Mazurskie" to "South Konisburg" talks about South Konisburg everywhere), and editor-drawn `reg_*` shapes the stock tiles don't know get named from the custom geometry. It uses `jsonLoadedUrls.has(regionsGeojson)` — not a truthiness test on the payload — to distinguish "no custom regions" (stock names correct) from "fetch failed" (retry), because the server answers a geometry-less scenario with a 200 empty FeatureCollection. The stock tile read is in its own `try`: when the archive cannot be read at all (a 404, a corrupt download, a test sandbox without it) the catalog carries the scenario's own regions rather than nothing — it used to return `[]`, which emptied every lookup, geography resolver and placement gazetteer on a hand-drawn world whose regions were all sitting in its own geojson.

`decodeVectorTile(data)` (`assets.js`) lazily imports `@mapbox/vector-tile` + `pbf` and is the shared decoder for both catalogs.

---

## 10. Basemap raster + terrain (asset-adjacent)

Not part of the `map-data` Release, but resolved through this module. `ESRI_BASEMAPS` (`assets.js`) lists ten public, token-free ArcGIS Online services with per-layer `maxZoom`; `DEFAULT_BASEMAP_ID = "ocean"`. The selected id is read from `localStorage["map_basemap_style"]` (`selectedBasemapId`).

| Concern | Mechanism |
|---|---|
| Low-zoom source | Direct ESRI XYZ template `esriTileTemplate(id)` |
| High-zoom source | `ohbase://<id>/{z}/{y}/{x}` protocol (`basemapProtocolTemplate`), registered by `ensureBasemapProtocol` |
| Placeholder swap | ESRI serves an identical "Map Data Not Yet Available" JPEG (HTTP 200) past a layer's coverage; `basemapTileLoader` byte-detects it (learned from two ocean tiles, `loadPlaceholderRef`) and synthesizes an upscaled crop of the nearest real ancestor (`synthesizeFromAncestor`) |
| Terrain | `TERRAIN_TILE_TEMPLATE` → AWS `elevation-tiles-prod` terrarium PNGs |
| Runtime tuning | `configureMapRuntime` sizes MapLibre worker count + parallel image requests from `hardwareConcurrency` |

Raster tiles are warmed via `warmRemoteResources` / `warmRemoteResource` (`assets.js`) with bounded concurrency (default 6), caching only the *size* per URL (the bytes live in the browser HTTP cache under `force-cache`).

---

## 11. Built-in flags (`public/flags/`)

The flags the game draws for standard countries ship with every build (website, desktop, Android), so they show offline and no flag request leaves the device. Added 2026-09-29; before that every flag was fetched from flagcdn.com as it was drawn.

| Piece | What it is |
|---|---|
| `public/flags/<code>.svg` | What the panels, pickers and chat draw |
| `public/flags/w160/<code>.png` | What the map's unit counters rasterise: a canvas cannot size an SVG with no width, and a few (Bangladesh, Uruguay, Christmas Island) have none |
| `scripts/fetch-flags.mjs` | Downloads the set from flagcdn.com (Flagpedia.net's flags, public domain) and writes `src/runtime/generated/bundledFlagCodes.js`. 256 codes, 4.1 MB: every code flagcdn serves except the US states (7.9 MB the game never asks for), so the countries and territories, the EU, the UN, Kosovo and the four UK nations. The files are committed; a build never needs the network for them |
| `bundledFlagUrl(url, { raster })` (`countryFlags.js`) | Maps a flagcdn address onto the shipped copy, under the build's `BASE_URL` (`/play/flags/` on the website): the SVG for an SVG, the 160 px PNG for any raster size and for every `raster` request; anything else (an uploaded data URL, a hub image, an unshipped code) unchanged |

Scenarios and saves keep **storing** the flagcdn address (`flagImageUrlFromGid`, `listBuiltInFlags`, *Fill standard flags*): every version and every other install understands it, where a path into this build's files would break on an older version, and the website's `/play/` base would disagree with the desktop about where the files are. The address becomes the local copy only where a flag is drawn, so every `<img>` and canvas that shows a flag goes through `bundledFlagUrl`; `src/runtime/bundledFlags.test.js` fails on an `<img>` whose `src` names a flag without it, and checks the files against the list.

---

## Quick file map

| File | Role |
|---|---|
| `src/runtime/assets.js` | Client asset layer: read/write/warm/prime, caches, derived catalogs, basemap protocols |
| `src/runtime/countryFlags.js` | Country codes, flag emoji, the flagcdn address of a built-in flag, and `bundledFlagUrl` (the shipped copy, §11) |
| `src/runtime/preload.js` | 30 s startup warm sequence + progress model |
| `src/runtime/web/router.js` | Web-build `fetch` interceptor for `/api/*` (pmtiles → `VITE_OH_PMTILES_URL`) |
| `src/runtime/web/contentTrust.js` | Web-build hash-verified content-node fetch |
| `scripts/fetch-map-assets.mjs` | Sync a local tree to the `map-data` Release (the desktop app runs it on launch; run it by hand after a clone) |
| `scripts/map-assets.json` | The Release manifest (paths, versioned asset names, sha256, bytes) |
| `mobile/scripts/stage-map-assets.mjs` | The Android build's variant → downloads the files in `mobile/map-assets.android.json` into `mobile/map-cache/` for the APK |
| `server/server.js` | Express `/api/runtime/{json,pmtiles}` routes |
| `server/libraryStore.js` | Server-side asset resolution (scenario override → data-dir → bundle) |
| `server/dataDir.js` | `DATA_DIR` / `OH_DATA_DIR` resolver |

Related pages: [World state](world-state.md) · [Node network](delivery-and-deploy.md) · [Performance / RAM](architecture.md)
