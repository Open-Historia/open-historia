# Map Data & Assets

Open Historia paints the world from a handful of heavy, mostly-static binaries (three PMTiles vector archives, two GeoJSON seed/geometry files) plus small per-scenario JSON documents (colors, flags, tags, world state). This page traces where each asset physically lives (app bundle vs. the writable `OH_DATA_DIR` vs. a GitHub Release vs. a Cloudflare-hosted content swarm), how the server route layer resolves a scenario override on top of the shared default, and how the browser client (`src/runtime/assets.js`) caches, warms, primes, and memoizes everything without OOMing the tab. The single load-bearing rule: the big binaries are **never** in Git — they are downloaded from a GitHub Release named `map-data` on first launch, checksum-verified, and served locally.

---

## 1. Asset catalog

Every runtime asset the map depends on, with its physical filename, MIME, and how it reaches the browser.

| Asset | Key | File on disk | Source of truth | Served to client via | Notes |
|---|---|---|---|---|---|
| Regions vector tiles | `regions` | `regions.pmtiles` (~105.8 MB) | `map-data` Release | `GET /api/runtime/pmtiles/regions` | GADM level-1 borders; the z0 tile is the region catalog; paints owners above z6.5. Carries z9/z10, which the style never asks for — see `scripts/trim-pmtiles.mjs` |
| Countries vector tiles | `countries` | `countries.pmtiles` (~62.7 MB) | `map-data` Release | `GET /api/runtime/pmtiles/countries` | z0 tile is the country index + label source; warmed on **every** map; same unused z9/z10 |
| Cities vector tiles | `cities` | `cities.pmtiles` (~1.5 MB) | `map-data` Release | `GET /api/runtime/pmtiles/cities` | Modern-day city labels layer |
| Custom regions geometry | `regionsGeojson` | `regions.geojson` (per-scenario) | Scenario dir, else the stock world below | `GET /api/runtime/json/regionsGeojson` | The scenario's own map (the built-in Modern Day has one, a hand-drawn world); a scenario without one renders on the stock world; **never cached client-side** |
| Stock world geometry | — | `server/data/stock/regions.geojson` (~55.4 MB) | `map-data` Release (`default-regions-names.geojson`) | via `regionsGeojson` for scenarios without a map | GADM level-1 regions with owner names — what the hub's re-ownership presets (keyed by GADM ids) and "Modern Day (classic map)" render on |
| Built-in scenario seed | — | `server/seed/default/` (`regions.geojson` ~5.6 MB, `cities.geojson`, `world.json`, `colors.json`, cover…) | the app bundle (committed) | copied into `server/data/scenarios/default` by the server | Modern Day's own map; `world.builtInMap` names the map generation (§3) |
| Custom cities geometry | `citiesGeojson` | `cities.geojson` (per-scenario) | Scenario dir | `GET /api/runtime/json/citiesGeojson` | Era-accurate city points; rendered when `world.customCities`; **never cached client-side** |
| Region seed | — | `regions-seed.geojson` (~55.3 MB) | `map-data` Release → `public/assets/` | `GET /assets/regions-seed.geojson` | Offline-produced seed the **map editor** imports; not a runtime map layer |
| City seed | — | `cities-seed.json` (~7.9 MB) | `map-data` Release → `public/assets/` | `GET /assets/cities-seed.json` | Consumed by the editor (`citiesImport.js`) and AI prompt context (`promptContext.js`) |
| Nation colors | `colors` | `colors.json` (~3.4 KB) | Scenario dir, else app palette | `GET /api/runtime/json/colors` | Owner-name → hex; falls back to immutable `public/assets/colors.json` |
| Nation flags | `flags` | `flags.json` (per-scenario) | Scenario dir | `GET /api/runtime/json/flags` | Owner code → PNG data URL; `{}` when absent |
| Nation tags | `tags` | `tags.json` (per-scenario) | Scenario dir | `GET /api/runtime/json/tags` | Owner code → `string[]`; **starting** tags only (merge with `world.countryTags`) |
| Map background | `backgroundData` | `background.json` (per-scenario) | Scenario dir | `GET /api/runtime/json/backgroundData` | Heavy `{dataUrl}`/`{geojson}` payload; loaded only when `world.background` set |
| World state | `world` | `world.json` (per-game/scenario) | Game dir, else scenario | `GET /api/runtime/json/world` | The live simulation document — see [World state](world-state.md) |
| Runtime game JSON | `game`, `events`, `chat`, `actions`, `advisor`, `prompts`, `snapshots` | under game `storage/` | Game dir | `GET/PUT /api/runtime/json/<key>` | Per-game session state; polled ~5s |

The client-side URL and PMTiles-archive tables are declared in `src/runtime/assets.js:63` (`JSON_URLS`) and `src/runtime/assets.js:122` (`PMTILES_ARCHIVES` / `PMTILES_PROTOCOL_URLS`). The server-side filename maps live in `server/libraryStore.js` — `PMTILES_ASSET_FILES` (`:281`), `SCENARIO_GEOJSON_ASSET_FILES` (`:291`), `OPTIONAL_JSON_ASSET_FILES` (`:258`), and `JSON_ASSET_DEFAULTS` (`:326`).

**Basemap raster** (satellite/streets/terrain imagery) is *not* one of these files — it streams live from public ESRI/ArcGIS Online and AWS terrain tile servers (§8), so it is not part of the `map-data` Release.

---

## 2. Where assets come from — the four sources

An asset can be resolved from up to four places. Which one wins depends on the build (desktop/embedded vs. web) and whether the active scenario ships an override.

| Source | What lives there | Which builds |
|---|---|---|
| **App bundle** (`public/assets/`, or `dist/assets/` in a built app) | The shared default `*.pmtiles`, `*-seed.*`, immutable `colors.json` | Desktop / Termux |
| **`OH_DATA_DIR`** (`server/data/…`, or a writable sandbox on Android) | Per-scenario overrides, per-game state, and — on the embedded server — the downloaded pmtiles under `<DATA_DIR>/assets/` | All node-server builds |
| **`map-data` GitHub Release** | Canonical copies of every heavy binary, checksum-pinned | Fetched at install/update time |
| **Cloudflare / content-node swarm** | Byte-identical pmtiles served over HTTP range requests, hash-verified | Web build only |

### `OH_DATA_DIR` and the data-dir resolver

`server/dataDir.js:16` exports the single writable root every store shares:

```
DATA_DIR = process.env.OH_DATA_DIR ? resolve(OH_DATA_DIR) : <server>/data
```

Desktop and Termux leave `OH_DATA_DIR` unset → `server/data` (byte-identical layout). The **Android** app runs `server.js` in-process via nodejs-mobile and sets `OH_DATA_DIR` to a writable sandbox, because the `server/data` shipped inside the APK is read-only. `server/libraryStore.js:20` derives `DIST_DIR`, `PUBLIC_DIR`, and `DATA_ASSETS_DIR` (`= <DATA_DIR>/assets`, `:32`) from it.

### PMTiles resolution order (server)

`resolveRuntimeBinaryAsset(assetKey)` — `server/libraryStore.js:2371` — resolves in this order and streams the first hit with `streamBinaryFile`:

1. **Scenario override** — `getScenarioUploadPath(scenario.id, assetKey)` (an editor-uploaded per-scenario archive).
2. **Fetched data-dir copy** — `<DATA_DIR>/assets/<file>.pmtiles` (embedded Android server, downloaded on first run).
3. **Bundle fallback** — `public/assets/<file>.pmtiles`.

Because step 1 can serve different bytes after a scenario switch, the client rotates its PMTiles caches on token change (§6) — a correctness fix, not just memory hygiene.

### JSON resolution order (server)

`readRuntimeJsonAsset(assetKey)` — `server/libraryStore.js:2218`:

- **Custom geometry** (`regionsGeojson`/`citiesGeojson`, in `SCENARIO_GEOJSON_ASSET_FILES`): resolved from the active game's scenario dir. A non-default scenario with no `regions.geojson` of its own **borrows the `default` scenario's** Modern-Day geometry (`:2237`); missing entirely → `EMPTY_FEATURE_COLLECTION`.
- **Per-game state** (`world`, `events`, `game`, `colors`, `flags`, `tags`, `snapshots`, …): active game dir first (`:2258`), then the selected scenario dir (`:2271`).
- **Optional JSON fallback** (`:2285`): only `colors` has a built-in fallback — the immutable app palette resolved from `dist/assets/colors.json` or `public/assets/colors.json` (`COLORS_ASSET_CANDIDATES`, `:356`). `flags`/`tags` with no file → `{}`.
- Otherwise → `JSON_ASSET_DEFAULTS[assetKey] ?? {}`.

---

## 3. The `map-data` GitHub Release + manifest

The heavy binaries used to live in Git LFS; the org's free LFS *bandwidth* is 1 GB/month shared, and a full checkout pulls ~200 MB, so a few installs exhausted it and every subsequent download 403'd. They now ship as **assets on a GitHub Release** (`Open-Historia/open-historia`, tag `map-data`), whose download bandwidth is free and unmetered. See `scripts/fetch-map-assets.mjs:1` for the full rationale.

### `scripts/map-assets.json`

The manifest that `fetch-map-assets.mjs` reads. Note the **name/namespace split**: `path` is the *stable client location* the game serves from; `asset` is the *versioned release filename* uploaded to GitHub.

| `path` (stable client name) | `asset` (release name) | bytes | Why the names differ |
|---|---|---|---|
| `public/assets/regions.pmtiles` | `regions.pmtiles` | 105 827 424 | same |
| `public/assets/countries.pmtiles` | `countries.pmtiles` | 62 739 546 | same |
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

Makes the local tree match the manifest. Called by the launcher and updater **in place of** `git lfs pull`.

| Mode | Command | Behaviour |
|---|---|---|
| Verify | `node scripts/fetch-map-assets.mjs` | Re-fetch anything whose SHA-256 differs (picks up a re-uploaded map, repairs truncation) |
| Ensure | `node scripts/fetch-map-assets.mjs --ensure` | Faster: trusts size, only fetches missing / wrong-size files |

Downloads to `<dst>.download`, verifies the SHA-256 **before** renaming into place, and is **best-effort**: it never exits non-zero (`process.exit(0)` on every path, `fetch-map-assets.mjs:92`) so a network failure can never block a launch or update. Requires Node 18+ for global `fetch`.

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

That is **134.9 MB off the 288.7 MB** a player pulls on first launch. Shipping it is the ordinary release dance and is NOT done by running the script: upload the trimmed archives to the `map-data` release, put their new `bytes`/`sha256` in `scripts/map-assets.json`, regenerate `public/content-manifest.json` (`scripts/build-content-manifest.mjs`) and re-sign it, then re-populate the content nodes. Installs that already have the big archives keep them until `fetch-map-assets.mjs` runs in verify mode.

Two things a trimmed archive still says about itself: the metadata blob is preserved verbatim, so `vector_layers[0].maxzoom` and `tilestats` still describe z10 (MapLibre reads the header, not these, so rendering is unaffected — `tippecanoe-decode` and friends would be misled), and `centerZoom` is carried across as it was.

### Embedded (Android) variant

`mobile/nodejs-project/fetchMapAssets.mjs` uses the **same** release + checksums but routes every asset into the writable `OH_DATA_DIR` instead of the read-only APK bundle (`fetchMapAssets.mjs:25` `targetFor`):

- `server/data/<x>` → `<DATA_DIR>/<x>` (scenario geojson)
- `public/assets/<x>` → `<DATA_DIR>/assets/<x>` (the pmtiles)

This is why `resolveRuntimeBinaryAsset` checks `<DATA_DIR>/assets` before the bundle (§2).

---

## 4. Server runtime routes

The client talks only to these same-origin routes (`server/server.js`). In the **web build** there is no Express server — a `fetch()` interceptor in `src/runtime/web/router.js` answers the same paths from IndexedDB / a content CDN (§7).

| Route | Handler | Purpose |
|---|---|---|
| `GET /api/runtime/json/:assetKey` | `readRuntimeJsonAsset` | Serve a runtime JSON doc; `Cache-Control: no-store` (`server.js:459`) |
| `PUT /api/runtime/json/:assetKey` | `writeRuntimeJsonAsset` | Persist to the active game; echoes back the normalized record (`server.js:470`) |
| `GET /api/runtime/pmtiles/:assetKey` | `resolveRuntimeBinaryAsset` | Stream a pmtiles archive (range-capable via `streamBinaryFile`) (`server.js:481`) |
| `HEAD /api/runtime/pmtiles/:assetKey` | `resolveRuntimeBinaryAsset` | `Content-Length` for the client freshness check; `Accept-Ranges: bytes` (`server.js:490`) |
| `GET/PUT/DELETE /api/scenarios/:id/assets/:assetKey` | scenario asset store | Upload/serve per-scenario overrides (pmtiles, geojson, flags, tags, cover) (`server.js:333`) |
| `GET/PUT/DELETE /api/games/:id/assets/:assetKey` | game asset store | Per-game images (`server.js:400`) |

`writeRuntimeJsonAsset` (`libraryStore.js:2314`) auto-creates a game from the selected scenario if none is active, canonicalizes country refs for `world`/`game`/`colors`, then writes to the game dir and returns the re-read record. That echoed record is what the client caches (§5, `writeJson`).

---

## 5. Client asset layer — `src/runtime/assets.js`

The browser's single module for reading, writing, warming, priming, and caching every asset. All URLs carry a `?v=<runtimeAssetToken>` query so a library mutation invalidates by URL identity.

### Endpoint wiring — `setRuntimeAssetEndpoints`

`assets.js:204`. Called on boot and on every scenario/game/library switch with a new `token`. It:

1. **Sweeps the old generation's caches BEFORE rebuilding the URLs** (`:218`) — the old URL strings are the only handles to those entries, so this must run first or the parsed GeoJSON (~190 MB on a 55 MB `regions.geojson`) is stranded forever.
2. Rebuilds every `JSON_URLS.*` = `withRuntimeToken("/api/runtime/json/<key>")` (`:260`).
3. Rebuilds `PMTILES_ARCHIVES.*` = `buildAbsoluteUrl("/api/runtime/pmtiles/<key>")` (`:275`) and the `pmtiles://…` protocol URLs (`:279`).

The token also gates the PMTiles cache rotation (`:239`): dropping `binaryValueCache`, `binaryRequestCache`, `pmtilesArchives`, the `Protocol` tile registry, and the `pmtilesCache` header — both to free the ~162 MB of warmed buffers and because `/api/runtime/pmtiles/:key` can serve *different bytes* after a switch (a stale directory applied to new bytes would decode garbage).

### Reading JSON — `readJson`

`assets.js:544`. Options: `{ cache, defaultValue, force, signal }`.

| Behaviour | Detail |
|---|---|
| Store decision | Snapshotted synchronously at call time via `isNoStoreJsonUrl` (see below) — never re-evaluated post-`await` |
| Value cache | `jsonValueCache` (Map, URL-keyed, no TTL/cap; swept on token change) |
| Request batching | `jsonRequestCache` de-dupes concurrent fetches to the same URL even with `force:true` — the ~5 s Nations/Cities/background/units pollers share one network request |
| Failure fallback | With `defaultValue`, serves a clone but **does not cache** it (transient failure must not pin a default) |
| Parse bookkeeping | `jsonLoadedUrls.add(url)` records a genuine parse *inside* the try — lets `loadRegionCatalog` tell "no custom regions" apart from "fetch failed, retry" |

`isNoStoreJsonUrl(url)` (`assets.js:158`) returns true for `regionsGeojson` and `citiesGeojson`. These FeatureCollections are huge and their only long-lived reader keeps them in React state (`Nations.jsx`/`Cities.jsx`, both `force:true`), so caching a second parsed copy is pure waste. It **must** be evaluated synchronously (the comment at `:154` explains why an after-`await` check resurrects the leak on scenario switch).

### Writing JSON — `writeJson` / `primeJson`

- `writeJson(url, data)` (`assets.js:618`) `PUT`s the payload, then caches **what the store echoed back** (the normalized record), not what was sent — legacy-record rewrites on the way in used to be pinned out of view. It calls `primeJson`, `invalidateDerivedCachesForWrite`, and `persistResponse`.
- `primeJson(url, data)` (`assets.js:602`) seeds the value cache (or deletes it for no-store URLs) and marks `jsonLoadedUrls`. Used to make a write immediately visible without a round-trip.
- `invalidateDerivedCachesForWrite(url)` (`assets.js:177`) drops the memoized `colors`/`flags`/`tags`/`world`-derived promises on a matching write and fires the `oh:colors-updated` DOM event so the live map repaints without a reload.

### Reading/priming binary — PMTiles

| Function | Line | Role |
|---|---|---|
| `getPmtilesArchive(url)` | `818` | Return cached `PMTiles` or register a new one |
| `warmPmtilesArchive(url)` | `829` | Download the full archive into `binaryValueCache`, then prime. **Web build** tries the hash-verified node swarm first (`contentTrust.js`), falls through to the origin |
| `primePmtilesArchive(url, buffer)` | `823` | Store the ArrayBuffer and register a `MemorySource`-backed archive |
| `registerPmtilesArchive(url)` | `390` | `new PMTiles(source, pmtilesCache)` + register on the `Protocol` |

`MemorySource` (`assets.js:364`) wraps an in-memory `Uint8Array` and satisfies `getBytes(offset, length)` locally, so once an archive is warmed the PMTiles library slices it in memory instead of issuing range requests. `createPmtilesArchive` (`:382`) uses a `MemorySource` when the bytes are in `binaryValueCache`, else the URL (range fetches). Directory/header decode caching is the shared `pmtilesCache = new SharedPromiseCache(256)` (`:141`).

### `resolveCountryDisplayName` and the resolver

`assets.js:288`. `resolveCountryDisplayName(name, code)` delegates to a swappable `countryNameResolver` installed via `setCountryNameResolver` (`:284`) — the i18n / localization layer registers a resolver so PMTiles feature names (`Country`/`NAME`/…) render translated. It defaults to identity. Used by both `loadCountryNames` and `loadRegionCatalog` when decoding the z0 tile.

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

`fetchWithPersistence(url)` (`assets.js:336`) layers a `CacheStorage` cache (`PRELOAD_CACHE_NAME = "open-historia-preload-v2"`, `:11`) over the network so warmed assets survive reloads:

1. Look up the persisted `Response`.
2. If present, issue a **`HEAD`** and compare `Content-Length` against the cached copy's. Equal (or the server can't answer, i.e. offline) → serve cached. Differ → refetch (an update replaced the file on disk).
3. Miss → `fetch(url, {cache:"force-cache"})`, then `persistResponse(url, clone)`.

The `v1` → `v2` cache-name bump (`:9`) exists because `v1` had no freshness check and could serve months-old map data forever; the bump flushes everyone once and the `HEAD` check keeps it fresh thereafter. `jsonHeadersFor` (`:32`) stamps the real UTF-8 byte length on client-written responses so the `HEAD` comparison isn't silently disabled by a missing `Content-Length`.

The **web build** uses a parallel key namespace: `buildRuntimeCacheUrl(key)` (`:333`) → `…/__runtime-cache/<key>.json`, read/written by `readRuntimeJson` / `writeRuntimeJson` (`:666`, `:705`) which are keyed by *asset key* (not URL) and therefore cleared wholesale on a token change (they'd otherwise serve the previous game's state).

---

## 7. Web build differences

Under `import.meta.env.VITE_OH_WEB` there is no node server:

- **Route interception:** `src/runtime/web/router.js:31` installs a `fetch` interceptor for same-origin `/api/*`. `/api/runtime/pmtiles/:key` (`router.js:51`) checks a scenario override in IndexedDB (`getScenarioPmtilesOverride`), else fetches `${VITE_OH_PMTILES_URL || "/assets"}/<key>.pmtiles`. The hosted site sets `VITE_OH_PMTILES_URL` to the **registry Worker's CORS+range proxy**, because Cloudflare Pages can't host the 60–100 MB archives directly (same-origin would 404 to the SPA fallback).
- **Verified content swarm:** `warmPmtilesArchive` (`assets.js:855`) dynamically imports `src/runtime/web/contentTrust.js` and calls `fetchVerifiedBuffer(url)`. It maps the URL to a manifest asset id (`assetIdFromUrl`, `contentTrust.js:72`), fetches `<node>/oh/v1/content/<sha256>` from the vetted node swarm, and verifies **every byte** against the signed `content-manifest.json` (`:140`). A bad/broken node can at worst force a retry — it can never deliver tampered bytes — and any failure falls through to the canonical origin, so a node outage is invisible. The signed node **directory** (`VITE_OH_DIRECTORY_URL`) is a deny-list/control doc; live addresses come from `nodes-live.json`. This whole block is stripped from the local download.
- **Worker fetches:** the `window.fetch` patch is invisible to workers — MapLibre's tile workers and the political-cartography worker (`src/Game/Map/vnext/polityBoundariesWorker.js`) fetch with their own global — so the scenario's regions GeoJSON is re-served to the `custom-regions-source` and the worker through a `blob:` URL: `prepareWorkerFetchableUrl(url)` (`assets.js`) fetches the runtime URL on the page and stages the bytes as a blob; `useWorkerFetchableUrl` (`src/Game/Map/useWorkerFetchableUrl.js`) hands that URL to `Nations.jsx`, which keeps the runtime URL as the identity for geometry epochs, catalog keys and readiness. MapLibre forwards a non-http(s) URL from its workers to the main thread, and a dedicated worker resolves a blob URL its page created. Copies are released (revoked after a grace period) when the token rotates or the asset is written. The desktop keeps the plain URL.
- **Origin check:** the origin fallback in `warmPmtilesArchive` is held to the same signed manifest through `verifyOriginBuffer(url, buffer)` (`contentTrust.js`): `checked` is false — the bytes trusted as before — when the manifest is unsigned or missing, does not list the asset, or the active scenario serves its own archive under the runtime URL (`hasScenarioPmtilesOverride`, `libraryStore.js`); a scenario's own archive is never fetched from the swarm either. Only a signed hash that contradicts the bytes fails the archive.

See the [Node network](delivery-and-deploy.md) notes for the swarm/registry architecture.

---

## 8. Startup preload + the ~162 MB prime

`src/runtime/preload.js` warms the map before React fully mounts, inside a **30 s time budget** (`STARTUP_TIME_BUDGET_MS`, `:16`). Tasks run serially, each with an `AbortController` wired to the remaining budget; the budget expiring aborts the current task and leaves the rest to load lazily in-game.

| # | id | Label | Weight | Warms | Skipped on custom map? |
|---|---|---|---|---|---|
| 1 | `state` | Syncing saves and runtime state | 12 | `game`,`prompts`,`colors`,`actions`,`chat`,`advisor`,`events`,`world` JSON | no |
| 2 | `textures` | Warming world textures | 20 | ESRI basemap + AWS terrain raster tiles (global z0–2 + initial viewport) | **yes** — a custom `world.background` replaces the basemap entirely |
| 3 | `countries` | Caching country geometry | 26 | `countries.pmtiles` (~62.7 MB) | **no** — needed for names + labels on every map |
| 4 | `country-index` | Building country index | 8 | `loadCountryNames()` | no |
| 5 | `country-labels` | Building country labels | 14 | `warmCountryLabelCollections()` | no |
| 6 | `cities` | Caching city layer | 10 | `cities.pmtiles` (~1.5 MB) | no |
| 7 | `regions` | Caching regional borders | 24 | `regions.pmtiles` (~105.8 MB) | **no** — paints owners above z6.5 even on custom maps |

**The ~162 MB prime:** warming tasks 3+6+7 pulls all three archives fully into `binaryValueCache` as in-memory `ArrayBuffer`s — the code cites regions ≈101 MB + countries ≈60 MB + cities ≈1.5 MB ≈ **162 MB** resident (`assets.js:231`; on-disk manifest sizes total ~170 MB). This is a deliberate memory-for-latency trade: a fully-warmed `MemorySource` archive answers tile requests without further network I/O. The cost is that this ~162 MB must be **freed on scenario switch** — which is exactly what the PMTiles cache rotation in `setRuntimeAssetEndpoints` (§5) does. See the [RAM & paint audit](architecture.md) notes for the broader memory backlog (the geojson double-store, pinned PMTiles).

Task results feed a weighted progress bar: `normalizeTaskResult` (`preload.js:165`) sums the `.size` of each warmed asset into `loadedBytes`, and `progress = completedWeight / TOTAL_WEIGHT`.

---

## 9. Derived catalogs (memoized accessors)

These read the z0 PMTiles tile (or a JSON doc) once per scenario and cache the derived result on the scenario token. They power AI prompts, pickers, and labels.

| Accessor | Line | Reads | Produces | Cache key |
|---|---|---|---|---|
| `getNationColors()` | `900` | `colors.json` | owner-name → hex map | `JSON_URLS.colors` |
| `getNationFlags()` | `949` | `flags.json` | owner-code → PNG data URL (`{}` default) | `JSON_URLS.flags` |
| `getNationTags()` | `933` | `tags.json` | owner-code → `string[]` **starting** tags (merge with `world.countryTags`) | `JSON_URLS.tags` |
| `loadCountryNames()` | `965` | `countries.pmtiles` z0 tile + `world.polityOverrides` | sorted `{code,name}[]` country index | `PMTILES_ARCHIVES.countries` |
| `loadRegionCatalog()` | `1036` | `regions.pmtiles` z0 tile + `regions.geojson` custom names | sorted `{id,name,country,countryCode}[]` | `PMTILES_ARCHIVES.regions` + `JSON_URLS.regionsGeojson` |

Common invariants: each drops its promise on failure so the next call **retries** instead of pinning an empty catalog for the session; each is invalidated by `invalidateDerivedCachesForWrite` when its underlying asset is written.

- **`loadCountryNames`** decodes the `countries` vector-tile layer, dedupes by resolved display name (`resolveCountryDisplayName`), then merges `world.polityOverrides` — a nameless override never degrades a real name to a bare code (`:1008`).
- **`loadRegionCatalog`** decodes the stock `regions` layer, then **overlays the scenario's own `regions.geojson`**: the world's own name for a region wins (a world that renamed "Warmińsko-Mazurskie" to "South Konisburg" talks about South Konisburg everywhere, `:1109`), and editor-drawn `reg_*` shapes the stock tiles don't know get named from the custom geometry. It uses `jsonLoadedUrls.has(regionsGeojson)` (`:1101`) — not a truthiness test on the payload — to distinguish "no custom regions" (stock names correct) from "fetch failed" (retry), because the server answers a geometry-less scenario with a 200 empty FeatureCollection. The stock tile read is in its own `try`: when the archive cannot be read at all (a 404, a corrupt download, a test sandbox without it) the catalog carries the scenario's own regions rather than nothing — it used to return `[]`, which emptied every lookup, geography resolver and placement gazetteer on a hand-drawn world whose regions were all sitting in its own geojson.

`decodeVectorTile(data)` (`assets.js:885`) lazily imports `@mapbox/vector-tile` + `pbf` and is the shared decoder for both catalogs.

---

## 10. Basemap raster + terrain (asset-adjacent)

Not part of the `map-data` Release, but resolved through this module. `ESRI_BASEMAPS` (`assets.js:82`) lists ten public, token-free ArcGIS Online services with per-layer `maxZoom`; `DEFAULT_BASEMAP_ID = "ocean"` (`:94`). The selected id is read from `localStorage["map_basemap_style"]` (`selectedBasemapId`, `:112`).

| Concern | Mechanism |
|---|---|
| Low-zoom source | Direct ESRI XYZ template `esriTileTemplate(id)` (`:104`) |
| High-zoom source | `ohbase://<id>/{z}/{y}/{x}` protocol (`basemapProtocolTemplate`, `:109`), registered by `ensureBasemapProtocol` (`:537`) |
| Placeholder swap | ESRI serves an identical "Map Data Not Yet Available" JPEG (HTTP 200) past a layer's coverage; `basemapTileLoader` (`:513`) byte-detects it (learned from two ocean tiles, `loadPlaceholderRef` `:454`) and synthesizes an upscaled crop of the nearest real ancestor (`synthesizeFromAncestor`, `:471`) |
| Terrain | `TERRAIN_TILE_TEMPLATE` → AWS `elevation-tiles-prod` terrarium PNGs (`:119`) |
| Runtime tuning | `configureMapRuntime` (`:398`) sizes MapLibre worker count + parallel image requests from `hardwareConcurrency` |

Raster tiles are warmed via `warmRemoteResources` / `warmRemoteResource` (`assets.js:775`, `:732`) with bounded concurrency (default 6), caching only the *size* per URL (the bytes live in the browser HTTP cache under `force-cache`).

---

## Quick file map

| File | Role |
|---|---|
| `src/runtime/assets.js` | Client asset layer: read/write/warm/prime, caches, derived catalogs, basemap protocols |
| `src/runtime/preload.js` | 30 s startup warm sequence + progress model |
| `src/runtime/web/router.js` | Web-build `fetch` interceptor for `/api/*` (pmtiles → `VITE_OH_PMTILES_URL`) |
| `src/runtime/web/contentTrust.js` | Web-build hash-verified content-node fetch |
| `scripts/fetch-map-assets.mjs` | Desktop/updater: sync local tree to the `map-data` Release |
| `scripts/map-assets.json` | The Release manifest (paths, versioned asset names, sha256, bytes) |
| `mobile/nodejs-project/fetchMapAssets.mjs` | Embedded-server variant → downloads into `OH_DATA_DIR` |
| `server/server.js` | Express `/api/runtime/{json,pmtiles}` routes |
| `server/libraryStore.js` | Server-side asset resolution (scenario override → data-dir → bundle) |
| `server/dataDir.js` | `DATA_DIR` / `OH_DATA_DIR` resolver |

Related pages: [World state](world-state.md) · [Node network](delivery-and-deploy.md) · [Performance / RAM](architecture.md)
