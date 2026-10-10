# Web Build (openhistoria.com)

The web build is the browser-only edition of Open Historia served from the trusted central origin (openhistoria.com / the `/play/` site). It runs the **entire game client unchanged** with **zero server**: a `window.fetch` interceptor answers every same-origin `/api/*` call out of IndexedDB, and the map files are part of the site, served from the build's own `/assets` folder (`/play/assets` on openhistoria.com). There are no accounts: games stay in this browser and move between devices by export and import. Everything in this page lives under `src/runtime/web/` and ships in the web build and in the Android app (`--mode android`, which sets `VITE_OH_WEB` too and adds `VITE_OH_NATIVE` — see [mobile.md](mobile.md)); it is dynamically imported behind `import.meta.env.VITE_OH_WEB` so it is dead-code-eliminated from the desktop download, which keeps its real same-origin Express server.

See also: [Server build](server.md) (the Express store this mirrors), [World state](world-state.md), [Assets & PMTiles](assets-and-data.md), [Scenario & game library](runtime-services.md), [Community hub](runtime-services.md).

---

## 1. How it boots and how it is gated

The whole web backend is behind one Vite mode flag. `.env.web` sets `VITE_OH_WEB=1`, and that file is loaded **only** by `vite build --mode web`. The normal `npm run build` never sees it, so `import.meta.env.VITE_OH_WEB` is `undefined` there and every `if (import.meta.env.VITE_OH_WEB)` branch — plus the dynamic imports it guards — is stripped by tree-shaking.

| Step | Location | What happens |
|---|---|---|
| Gate | `src/main.jsx` | `if (import.meta.env.VITE_OH_WEB)` dynamically `import("./runtime/web/index.js")`, calls `installWebBackend()`, then `mount()`s the React app. Non-web builds just `mount()`. |
| Entry | `src/runtime/web/index.js` | `installWebBackend()` — seed → install interceptor → drop a retired sign-in → home page. |
| Map files | `src/runtime/worldFiles.js`, `src/runtime/assets.js` (`warmPmtilesArchive`) | Every map file is read from the build's own `/assets` folder (`ASSETS_BASE`, `worldFileUrl`, `mapArchiveUrl`). `warmPmtilesArchive` downloads an archive once through `fetchWithPersistence` and keeps it in memory. There is no node to try first and no manifest to hold the bytes to (§8). |
| Worker fetches | `src/runtime/assets.js` (`prepareWorkerFetchableUrl`) | Workers never see the `window.fetch` patch, so the scenario's regions GeoJSON reaches MapLibre's `custom-regions-source` and the cartography worker through a `blob:` copy (`Nations.jsx` via `useWorkerFetchableUrl`); the runtime URL stays the epoch/cache key. |

`installWebBackend()` (`src/runtime/web/index.js`) runs, in order:

1. `await ensureSeeded()` — write the default scenario into IndexedDB before any `/api` call (`libraryStore.js`).
2. `installWebApiRouter()` — monkey-patch `window.fetch` (`router.js`).
3. `forgetRetiredAccount()` (`retiredAccount.js`) — best-effort, not awaited: deletes the kv rows a sign-in from before accounts were removed left behind (`account:session`, `account:email`, `account:dek`, `sync:versions`). Nothing reads them any more.
4. On the website, if `shouldShowHome()` (not yet "entered" this tab session) → `showHomePage()`. Nothing is looked up or connected to first: the map is under the build's own `/assets`. The Android app has no home page; its boot screen (`nativeBoot.js`), painted before step 1, settles here.

Build scripts (`package.json`):

| Script | Command |
|---|---|
| `build:web` | `node scripts/seed-web-defaults.mjs && vite build --mode web --outDir dist-web --emptyOutDir && node scripts/stage-map-assets.mjs dist-web` |
| `build:site` | same, but `--base /play/`, then `scripts/assemble-site.mjs` after the map is staged (the GitHub-Pages parchment landing site wraps `/play/`). |
| `dev:web` | `node scripts/seed-web-defaults.mjs && node scripts/stage-map-assets.mjs public --missing-only && vite --mode web` |

`scripts/seed-web-defaults.mjs` regenerates `src/runtime/web/generated/defaultScenario.js` (auto-generated; the default scenario's meta + colors + base64 cover) so the seed is baked into the bundle.

`scripts/stage-map-assets.mjs` puts the map into the build (§8). It downloads the six files pinned in `scripts/map-assets.web.json` from the `map-data` GitHub Release into `map-cache/` at the repo root (gitignored), checks each against its size and sha256, and, given a folder, lays them under that folder's `assets/` at their stable names. A file already in the cache and correct is not downloaded again. It exits non-zero when a file cannot be had, so a site is never built without its map. `build:web` and `build:site` stage into `dist-web` after the Vite build; `dev:web` stages into `public` with `--missing-only`, which lays only the files `public/` lacks and never overwrites a developer's desktop copies.

---

## 2. Configuration (`.env.web`)

The one URL left points at the **registry Worker** (`open-historia-registry.nichojkrol.workers.dev`), the project's one piece of always-on server infrastructure, and the game calls it only for community hub downloads. The map needs no setting: it is part of the build (§8).

| Var | Value / default | Purpose | Read in |
|---|---|---|---|
| `VITE_OH_WEB` | `1` | Master flag; gates all web-mode code + dynamic imports. | `main.jsx`, `assets.js`, `libraryBar.jsx`, `settings.jsx` |
| `VITE_OH_HUB_URL` | Worker root | Community-hub GitHub proxy (`/hub/file`), because GitHub attachments and release assets send no CORS header. | `router.js` |

`VITE_OH_PMTILES_URL`, `VITE_OH_DIRECTORY_URL` and `VITE_OH_MANIFEST_URL` no longer exist. They named a content origin, a node directory and a signed manifest, and the build has none of the three (§8).

---

## 3. The fake backend: the `/api` fetch interceptor (`router.js`)

There is no Express server. `installWebApiRouter()` (`router.js`) replaces `window.fetch` once (`installed` guard). The wrapper:

- Resolves the request URL against `location.href`. **Only** same-origin requests whose path starts with `/api/` are intercepted; everything else (AI providers, GitHub API, ESRI tiles, static assets, the map files under `/assets` among them) passes straight to the saved `originalFetch`.
- Builds a real `Request`, dispatches to `route(request, url)`, and returns a real `Response` — so all the existing client code (`src/runtime/library.js`, `src/runtime/assets.js`, `documentIO.js`, `basemapLibrary.js`) runs **unchanged**.
- On throw: `SyntaxError` (bad JSON body) → `400`, anything else → `500` (mirrors Express body-parser behavior).

> **Important boundary:** only `window.fetch` is patched. `<img src>`, `<link>`, XHR, `EventSource`, and PMTiles' own range reads that don't go through `fetch` all **bypass** the interceptor. This is exactly why cover images are shown through `blob:` object URLs (see §6) rather than served as `/api/...` paths.

### `route()` dispatch

`route()` (`router.js`) splits the path into `["api", domain, ...segments]` and dispatches on `domain`. Each handler returns a `Response` or `null` (fall through).

| `domain` (+ path shape) | Handler | Store file |
|---|---|---|
| `runtime/pmtiles/<key>` | inline (scenario override → else the build's own archive) | `libraryStore.getScenarioPmtilesOverride` |
| `runtime/json/<key>` | `handleRuntimeJson` | `libraryStore.js` |
| `mapeditor/*` | `handleMapEditor` | `editorStore.js` |
| `basemaps/*` | `handleBasemaps` | `basemapStore.js` — except Tiled Basemaps: `basemaps/tiled/*` and `basemaps/official/install` answer 501 with a plain message, `basemaps/official` is an empty list and `basemaps/by-hash/*` / `basemaps/official/:id` 404, since hundreds of megabytes need the desktop app or a local server's disk ([ADR 0005](adr/0005-tiled-basemaps-stream-to-disk.md), [ADR 0006](adr/0006-official-basemap-list.md)); a scenario naming one shows its basemap |
| `flags/*` | `handleFlags` | `flagStore.js` |
| `library` | `handleLibrary` | `libraryStore.js` |
| `scenarios/*` | `handleScenarios` | `libraryStore.js` |
| `games/*` | `handleGames` | `libraryStore.js` |
| `trash`, `trash/<entry>/restore` | `handleTrash` | `libraryStore.js` |
| `ui-settings/*` | `handleUiSettings` | `settingsStore.js` |
| `lang/*` | `handleLang` | `settingsStore.js` |
| `hub/*` | inline proxy → Worker | (see below) |
| *(anything else)* | `errorResponse("Unknown web-mode endpoint", 404)` | `util.js` |

### Body handling (`readBody`, `router.js`)

- `GET`/`HEAD` → no body.
- **Asset uploads** (`isAssetUpload`: `scenarios`|`games` + an `assets` segment + `PUT`) are forced to **raw bytes** regardless of `Content-Type`, because colors/geojson arrive as `application/json` but must be stored **verbatim** (the server's `express.raw` does the same).
- Otherwise: `application/json` → `JSON.parse`; everything else → raw `Uint8Array`.

### The two branches that are *not* pure IndexedDB

- **`runtime/pmtiles/<key>`** (`router.js`): first ask `getScenarioPmtilesOverride(key, range)` (a scenario may carry its own pmtiles in IndexedDB); otherwise fetch `mapArchiveUrl(key)` (`src/runtime/worldFiles.js`: `<ASSETS_BASE>/<key>.pmtiles`, the build's own z8 archive) with the incoming method and headers, so a `Range` is answered by the host that serves the site.
- **`hub/*`** (`router.js`): the only hub call is a bundle download, `GET hub/file?url=…`, forwarded to `${VITE_OH_HUB_URL}/hub/file`. Community bundles are files on GitHub, which sends no CORS header on them, so a page cannot read one itself: the Worker fetches the file and returns it with the header. Any other hub path answers 404, and an unset `VITE_OH_HUB_URL` answers 502. Import counts are read from the hub's own index (`src/runtime/hubFiles.js`), straight from GitHub.

---

## 4. IndexedDB layer (`idb.js`)

A dependency-free promise wrapper. Database `open-historia-web`, `DB_VERSION = 5`. Adding a store means bumping the version; `onupgradeneeded` creates only what is missing (additive — nobody's data is touched). An `onversionchange` handler closes this connection when another tab opens a newer version, so a second tab's upgrade isn't blocked.

| Store (`STORES`) | keyPath | Mirrors server on-disk store |
|---|---|---|
| `scenarios` | `id` | one record per scenario (meta + json + assets) |
| `games` | `id` | one record per game |
| `mapeditorDocs` | `id` | map-editor documents |
| `basemapMeta` | `id` | basemap metadata |
| `basemapPayload` | `id` | basemap binary payloads |
| `flags` | `id` | flag records |
| `kv` | `key` | small singletons (manifests, ui-settings, `seeded`), and `parked-turn:<gameId>`: a time skip kept for a game that was not open when it finished (`/api/games/:id/parked-turn`, `src/Game/AI/parkedTurn.js`), outside the game record so runtime reads never clone it, and it goes into the trash with its game (see Trash) |
| `scenarioMeta` | `id` | lean projection of each scenario (meta, cover marker, asset status) that the library menu is built from — no geometry or tiles |
| `gameMeta` | `id` | lean projection of each game (meta, cover marker, country, date, round, counts, `inlineRestorePoints`) — no restore points or full JSON |
| `mapeditorMeta` | `id` | the eight-field summary of each map-editor document the Documents menu lists (the desktop store's `.summary.json`) |
| `covers` | `id` | version 5: one cover's bytes, `{ id: "scenario:<id>" or "game:<id>", contentType, bytes }` |
| `snapshots` | `id` | version 5: one restore point, `{ id: "<gameId>/<restore point id>", snapshot }` (the desktop's `storage/snapshots/<id>.json`) |
| `snapshotIndex` | `id` | version 5: a game's restore points in order, newest first, `{ id: gameId, entries: [{ id, round, fromDate, toDate, capturedAt, slot }] }` (the desktop's `storage/snapshots-index.json`) |
| `trash` | `id` | version 5: a deleted scenario or game, whole: `{ id: entry, kind, itemId, record, parkedTurn? }`, the record carrying its cover's bytes and a game's restore points inside it (the desktop's `.trash`) |
| `trashMeta` | `id` | version 5: the lean row the Recently deleted shelves list: `{ id: entry, kind, itemId, name, deletedAt, scenarioId? }` |

Helpers: `idbGet`, `idbGetAll`, `idbGetAllKeys` (keys only, never the values), `idbGetMany` (several rows of one store in one transaction), `idbPut`, `idbPutPair` / `idbDeletePair` (a record and its lean index row in one transaction), `idbTransaction(stores, fn)` (reads and writes across several stores in one readwrite transaction; `fn` gets `{ get, getAllKeys, put, delete }` and must await only those), `idbMovePair` (a record and its index row out of one pair of stores and into another in one transaction: a delete into the trash, a restore out of it; rows the record keeps in stores of its own move in the same transaction), `idbDelete`, `reconcileMetaIndex` (build a listing from an index store, backfilling a missing row one record at a time and dropping orphans), and kv-specific `kvGet(key, fallback)`, `kvPut`, `kvUpdate`. `runTx` resolves on transaction **commit** (via `oncomplete`), not merely on request success, so writes are durable before a caller reads back.

---

## 5. The library store (`libraryStore.js`) — the heart of the fake backend

A byte-faithful browser port of `server/libraryStore.js`. Backs `/api/library`, `/api/scenarios*`, `/api/games*`, `/api/runtime/json*`, `/api/runtime/snapshots/:id`, `/api/runtime/pmtiles*`.

### Record shapes

```
scenario:  { id, meta, json:{actions,advisor,chat,events,game,prompts,world},
             colors?, flags?, geojson:{regionsGeojson,citiesGeojson,backgroundData},
             pmtiles:{cities,countries,regions}, cover?:{contentType,byteLength,key} }
game:      { id, meta, json:{…7…}, colors?, flags?, cover?:{contentType,byteLength,key} }
```

A cover's bytes and a game's restore points have stores of their own (version 5), so loading a game record, which every runtime read and write does, no longer deserialises up to twelve whole worlds (about 21 MB late in a campaign), and a listing copies no cover bytes. `putRecord` writes a record with its lean row, its cover and its restore points in one transaction:

- **Covers.** The record and its row keep a marker, `{ contentType, byteLength, key }`, `key` naming the `covers` row. A cover that arrives as bytes (an upload, the seed) goes into `covers` and becomes a marker; a marker naming another record's row (a copied game, a scenario seeded from another, the built-in's forks) gets a row of its own; no cover deletes the row. `readCover` reads the bytes for the cover routes and the scenario export.
- **Restore points.** One `snapshots` row each, in the order the game's `snapshotIndex` row lists them. The runtime `snapshots` key and the game-zip route `/api/games/:id/snapshots` still read and write the whole list (`readRestorePoints`; `snapshotsIndex` reads only the index row, and `GET /api/runtime/snapshots/:id`, `handleRuntimeSnapshot`, only the one row the staged reveal needs), but a list set on the record (`setGameSnapshots`) is stored by `putRecord` through the planner the desktop store uses (`server/restorePoints.js`): only the restore points not stored already are written, and the rows the new list no longer names are deleted, so a turn writes one row. The zip route writes every one (`reuseRestorePoints: false`). A record without a list leaves the stored ones alone; the owner-rename migration sets an empty list, which empties them. Deleting a game or a scenario takes its cover, and a game every row under `<gameId>/`, into its trash entry (see Trash).
- **Saves from before version 5** keep the cover as `{ contentType, bytes }` on the record and its row, and restore points in `record.snapshots` (or `record.json.snapshots`, where a zip import once put them). Every reader takes them from there, and the record's next put moves them. `migrateStoreLayout` moves the rest once, 15 s after boot (`index.js`), and records `store-layout: 5` in `kv` when done: covers from the lean rows, which hold the same bytes, without loading any record (the record keeps its spare copy until its next put), and restore points by loading each game whose row does not say `inlineRestorePoints: false`, one at a time through the write queue. A run cut short starts again on the next boot.

Unlike the server (which splits a scenario across many files on disk), a web record holds `world`/`game`/`colors`/`geojson` together, so owner migration is **synchronous and in-place** — nothing to keep in step across files. Gathering what a record resolves against (a game's scenario, migrated first; the stock world for a scenario without a map) is async (`migrateOwnerSchema`), and runs one record at a time (`serializeByKey`, `writeQueue.js`): a game opening fires several runtime reads together, and each would otherwise migrate the game against its own, possibly unmigrated, copy of the scenario.

### Manifests (in `kv`)

| kv key | Shape | Meaning |
|---|---|---|
| `scenario-manifest` | `{ order[], selectedScenarioId }` | scenario order + which is selected |
| `game-manifest` | `{ activeGameId, order[] }` | game order + which is active |
| `seeded` | `boolean` | one-time seed flag |
| `store-layout` | `number` | `5` once `migrateStoreLayout` has moved every older save's covers and restore points |

### Catalog composition

- `getLibraryCatalog()` is what `/api/library` returns: `{ activeGame, activeGameId, activeScenarioId, countryNames, games, runtimeScenario, scenarios, selectedScenario, selectedScenarioId, token }`. `token` is a cache key combining the active game's + runtime scenario's `updatedAt`.
- `getScenarioCatalog()` / `getGameCatalog()` compose per-item summaries (spread `readScenarioMeta`/`readGameMeta`, `assetStatus`, `cacheToken = ${id}-${updatedAt}`, `coverImageUrl`, usage counts). Order comes from `resolveOrderedIds` (manifest order, then extras, default id unshifted first).
- A game summary also carries `country`, `currentDate`, `round`, `eventCount`, `pendingActions` (non-`resolved` actions), `scenarioName`, `scenarioAccentColor`, `scenarioMissing` (true when the library does not hold the game's scenario; the entry is then built by `missingScenarioSummary`, as the desktop's `buildScenarioCatalogEntry(..., { missing: true })`, and `scenarioName` is what the sender called the map), and both `coverImageUrl` (own → falls back to its scenario's) and `ownCoverImageUrl`.

### Runtime JSON read/write (what the running game hits every turn)

`readRuntimeJsonAsset(key)` resolves an asset by precedence: **active game record → active runtime scenario → fallback default**. Special cases:

- `SCENARIO_GEOJSON_ASSET_KEYS` (`regionsGeojson`/`citiesGeojson`/`backgroundData`) come from the scenario; a scenario without its own `regionsGeojson` **borrows Modern Day's** (migrated as *default's* record, since those owners live in default's owner-space).
- The stock world (the web-sized GADM world with owners as country names, 13.1 MB) is **not** in the seed. `fetchDefaultRegionsGeojson()` fetches it from the build's own assets folder, `default-regions.geojson` (`worldFileUrl("stock")`, `src/runtime/worldFiles.js`; §8), once per session, never pinning an empty/failed result, so a transient miss retries. The editor's default world is read the same way, from `regions-seed.geojson` (`worldFileUrl("seed")`). Without the stock world the political map renders blank.
- These session caches (the built-in and stock regions, and the coarse copy of the regions for the scenario being looked at, `coarseRegionsCache.js`, one slot) are all dropped when Android sends `oh:memory-pressure` (`src/runtime/memoryPressure.js`); the next read fetches and builds them again.
- `colors` falls back to the immutable app palette (`generated/fallbackColors.js`), **not** the mutable default-scenario colors.

`writeRuntimeJsonAsset(key, value)` writes onto the active game (auto-creating one from the selected scenario if none exists), canonicalizing country refs on the way in: `world`→`canonicalizeWorldCountryRefs`, `game`→`canonicalizeGameCountry`, `colors`→`canonicalizeColorKeys`. `flags` are **not** canonicalized (a flag key is always the raw code the editor painted). The geometry keys (`regionsGeojson`, `citiesGeojson`, `backgroundData`) are written to the active game's **scenario** instead, as on the desktop: the two FeatureCollections must be one (`{}` is refused, so an empty body cannot erase a map), and a game whose scenario is gone is refused rather than given a new one.

What a runtime read or write costs: the active game comes from the `game-manifest` plus one record read (`getActiveGameRecord`; the game catalog is only the fallback when the manifest names nothing that exists), is loaded **once** per read and handed down to the scenario lookups, and a write's reply is read from the record it just put. A PUT carrying `Prefer: return=minimal` (the rollback archive, `writeJson(..., { echo: false })`) gets `204` with `Preference-Applied` and no reply at all, as on the desktop; `router.js` passes the header in `ctx.prefer`. The pmtiles checks (`hasScenarioPmtilesOverride`, and `getScenarioPmtilesOverride` before it serves anything) answer from the lean rows: the manifest's active game, its `gameMeta` row's `scenarioId`, that scenario's `scenarioMeta` row's `assetStatus[key]`. Only a scenario that does serve its own archive is loaded, to slice its bytes; a missing row falls back to loading the records. The game record itself is lean: its restore points and cover bytes live in their own stores (see Record shapes).

Every runtime asset of a game lives in its one record, so every change to a game is a read-modify-write of the whole save. All of them run through one write queue (`writeQueue.js` `serializeWrite`): the turn commit, the runtime JSON writes, and `mutateGame(id, fn)`, which the game routes use (`updateGame`, the play stamp, cover upload and removal, the restore-point route, the built-in scenario's fork and refresh). A write outside the queue could read the record before a turn commit and put its stale copy back after it. Code already inside the queue must not call `mutateGame` (it would wait on itself); `createGame`, which the runtime writers call from inside it, stamps its play count before its first put for that reason.

### Owner-schema migration (`ensureOwnerSchema`)

Rewrites a record whose owners are GADM codes into one keyed by country **names**. It *imports* `server/ownerMigration.js` (pure ESM, so Vite bundles it) and calls the same `migrateOwnerRecord` the desktop store does — one resolver, one context, no drift. `migrateOwnerSchema` gathers that context first (`ownerMigrationContext`), as `server/libraryStore.js` does: a **game** resolves against its **scenario's** `countryNameOverrides` and regions (read-only) and inherits the scenario's polity `mapRefs`, after the scenario itself migrates (a web game record carries neither regions nor name overrides, so alone it named e.g. wwii-1939's THA "Thailand" while the map said "Siam"); a **scenario** without a map of its own borrows the stock world as read-only context. It runs on read and before an update, once per `kind:id` (`migratedRecords` set), persists through `putGame`/`putScenario` so the menu's meta rows follow, and discards the game's roll-back restore points (an empty list, which its put stores; they predate the rename and are blind-written back with no staleness marker).

### Export / import bundles

- `exportScenarioBundle(id)` — every export is full (`mode: "full"`): the cover, colours, flags, tags, geometry, background and any custom PMTiles archive travel whenever the scenario has them. There is no light mode any more; an older `mode: "light"` bundle still imports. Geometry and the other JSON assets are embedded as JSON, not base64, matching the desktop store (see `docs/server.md`); the cover and PMTiles archives are still base64. Schema `open-historia-scenario-bundle/2`.
- `importScenarioBundle` / `updateScenarioFromBundle` accept any schema in `ACCEPTED_BUNDLE_SCHEMAS` (v1 + v2), and lay down each asset through one `applyScenarioBundleAsset`, as the desktop store does: geometry that travelled as JSON is stored, one that travelled as base64 is decoded, and only an asset the bundle does not embed is cleared (the hub Update once had its own copy without the JSON branch and deleted a map's regions, cities and basemap). Note the **JSON-descriptor gotcha**: `colors`/`flags`/`tags` descriptors carry the **object itself** in `descriptor.data`, not base64 — passing them through `base64ToBytes` (as geojson/pmtiles do) made `atob` throw and broke import of every flag/tag-carrying preset (e.g. WWII).
- Hub provenance (`hubOrigin`, `hubPublished`, `hubUnlinked`, `hubReviews`) follows the desktop store's rules through the same `server/hubProvenance.js`. `hubOrigin` is stamped **last** by an import, with the checked copy in the hub's releases that was downloaded (`release`, kept through every write that keeps the link; a link without one is an old link, whose card asks for an Update). Any later edit keeps it and stamps `editedAt`, which stops hub updates from overwriting the player's work while keeping the original for **Suggest changes**. `hubOrigin: null` unlinks the scenario, and `hubPublished: null` its player's own post, both for good: what was unlinked goes into `hubUnlinked` and nothing attaches it again (`hubLinksAfterWrite`), a scenario write cannot set `hubOrigin` at all (`pickHubProvenance`), and an Update only renews the link a copy has (`hubOriginForUpdate`). A body carrying only provenance is bookkeeping (`writeScenarioMeta(record, updates, { touch: false })`: no `updatedAt`, no `editedAt`). One thing is this store's own: `updateScenario` and `updateScenarioFromBundle` take one turn per scenario (`serializeByKey`, `scenario-write:<id>`), because a write here is a read, a change and a put with awaits between them, and two at once each began from the same record, so a check for suggestions landing with an Unlink put the post back. The desktop store answers one request at a time and needs none. See [server.md](server.md#hub-provenance-where-a-scenario-came-from-and-where-it-went).
- A community basemap that could not be downloaded (`missingBasemap`, see [server.md](server.md#hub-provenance-where-a-scenario-came-from-and-where-it-went)) is kept and exported as its reference, and `PUT /api/scenarios/:id/basemap` (`restoreScenarioBasemap`) puts it in place once the game has downloaded it, as the desktop store does.

### Trash (Recently deleted)

Deleting a scenario or game moves its record, whole, into the `trash` store (`moveToTrash`, one `idbMovePair` transaction; a game's move runs in the write queue so a turn commit cannot put it back). Its cover's bytes and a game's restore points leave their stores in the same transaction and ride inside the record, as a save from before version 5 carried them (`takeRecordRows`), and a game's kept turn (`parked-turn:<id>`) rides beside it, so nothing of it is left under an id a new scenario or game may take. A restore puts them back under the id it restores to, in the one transaction that takes the entry out (`putRecordRows`, as a record's put does; the kept turn only under the game's own id), and emptying or purging the trash deletes them with the entry. `handleTrash` serves the same routes as the desktop's (`GET /api/trash`, `POST /api/trash/:entry/restore`, `DELETE /api/trash[?kind=]`), so the library's Recently deleted shelves work here too. The limits are tighter than the desktop's 30 days, because every record can hold a whole map and a phone's storage quota is small: an entry is kept `TRASH_KEEP_DAYS` (7) days and only the last `TRASH_KEEP_COUNT` (5) are kept, the oldest going first (`purgeTrash`, run after each delete, on each listing and at boot). The listing is read from `trashMeta` and has no sizes, which would mean loading every record; `keepCount` in the reply is how the library tells the two stores apart.

### Seeding (`ensureSeeded`)

If the `seeded` kv flag is unset and no `default` scenario exists, write `defaultScenarioSeedRecord()` (built from `generated/defaultScenario.js`: meta, colors, base64 cover) and add it to the manifest. Idempotent. It then purges the trash (`purgeTrash`).

---

## 6. Cover images — and why they differ from the server

`COVER_IMAGE_ASSET_KEY = "cover"`; a cover's bytes are a row of the `covers` store and the record keeps a marker (`{ contentType, byteLength, key }`, see Record shapes). The **displayed** cover in a catalog summary differs by build:

| | Server build | Web build |
|---|---|---|
| `coverImageUrl` value | a **fetchable path** via `buildScenarioAssetUrl(id,"cover",token)` → `/api/scenarios/:id/assets/cover?token=…` (`server/libraryStore.js`) | a **`blob:` object URL** via `coverUrl` → `coverObjectUrl(key, cacheToken, cover)` (`src/runtime/web/coverUrls.js`), called from the scenario and game summaries in `libraryStore.js`. The lean row's marker names the version (`coverObjectUrl.known`), so the bytes are read from `covers` only for a URL not made yet |

**Why:** the library UI renders the cover in an `<img src>`. On the server that `src` is a normal HTTP URL the browser fetches directly. In the web build there is no server, and — critically — an `<img>` load does **not** pass through the patched `window.fetch`, so a `/api/scenarios/:id/assets/cover` `src` would hit the network and 404 to the SPA fallback instead of reaching the interceptor. An object URL over the stored bytes makes the image render with **zero network round-trip**, straight from IndexedDB. Each cover gets one object URL per version of its record, handed out again on every listing and revoked when the cover changes; it replaced a base64 `data:` URL rebuilt on every listing, which churned hundreds of MB on a phone while a game loaded (`coverUrls.test.js` pins it). (The interceptor *does* still serve a direct `GET /api/scenarios/:id/assets/cover` — `scenarioAssetResponse` — for code paths that go through `fetch`, e.g. export; it's only the `<img>` display path that needs the object URL.)

Cover uploads/removals (`uploadScenarioAsset`/`uploadGameAsset`) validate the content-type against `SUPPORTED_IMAGE_CONTENT_TYPES` (avif/gif/jpeg/png/webp) and mirror the bytes + `coverImageContentType` meta.

---

## 7. Store models & country resolution (`models.js`)

A faithful mirror of the constants and pure helpers in `server/libraryStore.js`.

### Asset-key sets

| Set | Members |
|---|---|
| `STORAGE_JSON_ASSET_KEYS` | `actions, advisor, chat, events` |
| `CORE_JSON_ASSET_KEYS` | `game, prompts, world` |
| `OPTIONAL_JSON_ASSET_KEYS` | `colors, flags, tags` |
| `PMTILES_ASSET_KEYS` | `cities, countries, regions` |
| `SCENARIO_GEOJSON_ASSET_KEYS` | `regionsGeojson, citiesGeojson, backgroundData` |
| `UPLOADABLE_SCENARIO_ASSET_KEYS` | `cover` + optional + pmtiles + geojson |
| `UPLOADABLE_GAME_ASSET_KEYS` | `cover` only |

`SCENARIO_BUNDLE_SCHEMA = "open-historia-scenario-bundle/2"` — the **only** compatibility gate on a file strangers swap; the schema string moves with the owner rename so an old build can't silently mis-resolve a name-keyed bundle. `isScenarioBundleSchema` (mirrored from `server/libraryStore.js`) reads format 1 and 2 under any `<name>-scenario-bundle` name, so files written under the project's earlier name import unchanged.

### `resolveOwnerRef(value, world)`

Resolves an owner token to its canonical **name**. Precedence:

1. A `polityOverrides[value]` marked `verbatim` (a human-named polity whose text collides with a GADM code like "USA") → honored literally.
2. Any polity whose `name`/`aliases`/key matches (case-insensitive), skipping self-named entries so `{MNG:{name:"MNG"}}` doesn't pin `MNG` forever.
3. `COUNTRY_NAME_REGISTRY[value]` (legacy code or alias → name).
4. Otherwise the raw value.

`canonicalizeWorldCountryRefs` / `canonicalizeGameCountry` / `canonicalizeColorKeys` apply it across `regionOwnershipOverrides`, `ownerCodes`, `polityOverrides` (rekeyed by name, `.code` dropped), `units`, `countryTags`, `internationalReputation`, and color/game country fields. `readScenarioMeta`/`readGameMeta` apply defaults + normalize `coverImageContentType`, `hubOrigin`, `hubPublished`, `hubReviews`, `playCount`, `lastPlayedAt`.

---

## 8. Heavy content: the map files the build carries

The map is part of the site. Every build of the game reads its map data from its own `/assets` folder under the same stable names, and what differs is only how the files get there. The desktop app fetches them from the `map-data` GitHub Release at first launch (`scripts/fetch-map-assets.mjs`, list `scripts/map-assets.json`). The website and the Android app are the same bundle and carry the same six files, laid into the build when it is made. Nothing is fetched from a third party at run time, so there is no node to connect to, no manifest and no signature to check.

### Where the files are read from (`worldFiles.js`)

`src/runtime/worldFiles.js` is the one module that names them. `ASSETS_BASE` is `${BASE_URL}assets`: `/assets` on the desktop and in the Android app, `/play/assets` on openhistoria.com.

| Call | File under `ASSETS_BASE` | Read by |
|---|---|---|
| `mapArchiveUrl(key)` | `<key>.pmtiles` (`regions`, `countries`, `cities`) | `router.js`, for `/api/runtime/pmtiles/<key>` |
| `worldFileUrl("stock")` | `default-regions.geojson` | `libraryStore.js` (`fetchDefaultRegionsGeojson`) |
| `worldFileUrl("seed")` | `regions-seed.geojson` | `src/Editor/regionImport.js` |
| `worldFileUrl("cities")` | `cities-seed.json` | `src/Editor/citiesImport.js`, `src/Game/AI/promptContext.js`, `src/Game/AI/worldCities.js` |

Which bytes are behind a name is decided by the pinned list and by nothing at run time. On the desktop the server answers `/api/runtime/pmtiles/<key>` from the same folder itself, and reads the stock world from its data folder (`server/data/stock/regions.geojson`).

### The list and the stager

`scripts/map-assets.web.json` pins the six files. Each entry has `asset` (the name on the release), `path` (the stable name under the build), `bytes` and `sha256`.

| Release asset | Path in the build | Bytes |
|---|---|---|
| `regions-z8.pmtiles` | `assets/regions.pmtiles` | 21,106,005 |
| `countries-z8.pmtiles` | `assets/countries.pmtiles` | 12,580,027 |
| `cities.pmtiles` | `assets/cities.pmtiles` | 1,547,924 |
| `cities-seed.json` | `assets/cities-seed.json` | 7,857,627 |
| `regions-seed-clean.geojson` | `assets/regions-seed.geojson` | 13,077,300 |
| `default-regions-names-web-clean.geojson` | `assets/default-regions.geojson` | 13,128,553 |

About 69 MB in all. The archives are the z8 trims the desktop and the Android app already used: 35 MB instead of the 168 MB z10 ones the website used to stream. The two world files are the web-sized cut of the world, deep-cleaned. The stock world has its owners as country names and is built from that seed by `scripts/build-default-map.mjs`, exactly as the desktop's stock world is built from the desktop's seed. It is 13 MB where the stock world the website used to be handed was 55 MB. See [Map Data & Assets](assets-and-data.md) §3.

`scripts/stage-map-assets.mjs` downloads and verifies the files into `map-cache/` and lays them into a build (§1). `build:web` and `build:site` lay them into `dist-web/assets/`, and `build:site` then assembles the site, so they are served at `/play/assets/`. Before that, the Vite plugin `dropMapBinaries` (`vite.config.ts`) removes whatever map files `public/assets/` put into the output: a developer's `public/` holds the desktop's copies under the same names, and its `regions-seed.geojson` is 55 MB. For Android, `mobile/scripts/stage-map-assets.mjs` (`npm run map` in `mobile/`) is a thin wrapper around the same script and cache, and `mobile/scripts/stage-www.mjs` lays the files under `www/assets/` (see [mobile.md](mobile.md)).

Every file must stay under Cloudflare Pages' 25 MiB a file (`SITE_FILE_LIMIT_BYTES` in the stager). `src/runtime/worldFiles.test.js` checks the list against the limit and against the names the app asks for, and the deploy workflow refuses a built site with a file over 24 MiB.

### Why the site carries its own copy

A browser cannot read a GitHub release asset. Neither the release download (`github.com/.../releases/download/...`, which redirects to `release-assets.githubusercontent.com`) nor the API route sends an `Access-Control-Allow-Origin` header on the file (measured 2026-10-06), and the API route is limited to 60 requests an hour without a token. The desktop's fetcher is a Node script, where that header is not needed.

The host must answer byte-range requests for static files: an archive is read by `Range` until the whole of it has been warmed into memory. Cloudflare Pages does (measured: a 206 on the live site). A self-hosted site needs a server that does too; nginx, Caddy, Apache, Netlify and GitHub Pages all do.

### What it replaced

The website used to fetch the archives and the two world files at run time from a content origin (`VITE_OH_PMTILES_URL`: the registry Worker's `/content` proxy in front of the `map-data` release), try community content nodes first (a signed node directory, `VITE_OH_DIRECTORY_URL`), and check the bytes against a signed manifest. The proxy and the nodes existed only to get around the limit above, and none of it is in the game any more: `src/runtime/web/nodeConnect.js`, `contentTrust.js` and `trust.js`, `public/content-manifest.json` and `public/node-directory.json` with their signatures, `scripts/build-content-manifest.mjs`, `server/contentManifest.test.js` and the tests workflow's manifest-expiry step are removed.

The signing tools are still in the repo (`scripts/sign-release.mjs`, `scripts/gen-signing-key.mjs`, `server/trust.js`, `server/releaseSigning.test.js`, `trust/`), but no build of the game uses them. The content-node software ([Open-Historia/open-historia-node](https://github.com/Open-Historia/open-historia-node), a separate repository) and the Worker's `/content` route still exist; the game does not use them for map data.

Community hub downloads still go through the Worker (`VITE_OH_HUB_URL`, `/hub/file`, §3): community bundles are files on GitHub, and the same limit applies to them.

---

## 9. Home screen (`homePage.js`)

A full-screen parchment/Roman overlay injected over the already-mounted game on first entry per tab session (`sessionStorage["oh:entered"]`). Pure DOM (no React), scoped under `.oh-home`. It shows the wordmark, what the game is and the way in. There is nothing to connect to first, so it has no connection card and Enter is available at once. Its text, the demo notice's and the Android boot screen's come from `bootTexts.js`, looked up in the player's shipped language pack (see [i18n.md](i18n.md)).

| Control | Behavior |
|---|---|
| **⚔ Enter Open Historia** | Shows the demo notice once per tab session, then `enter()` sets the `oh:entered` flag and removes the overlay. |
| Footer links | GitHub, Discord, Privacy. |

The Android app never shows this page. Its boot screen (`nativeBoot.js`) says "Getting the world ready…" while the library is seeded, then "Everything is on this device", and comes down after `BOOT_DEADLINE_MS` (8 s) at the latest.

---

## 10. Accounts and sync (removed)

The web build used to offer optional magic-link/Google accounts with end-to-end-encrypted sync of games and scenarios through the registry Worker. Both were removed: games live in this browser's IndexedDB and move between devices by game export/import. The client code (`account.js`, `sync.js`, `accountWidget.js`), the `VITE_OH_ACCOUNT_URL`/`VITE_OH_GOOGLE_CLIENT_ID` settings, the Bearer session on hub `POST`s and the presence reports to the registry are gone. The one piece left is `retiredAccount.js`, which deletes a leftover session, email, data key and sync version table from `kv` at boot (§1), so a browser that signed in before the removal no longer holds an identity the player cannot see.

---

## 11. Secondary stores (brief)

The interceptor also answers these through the same `ctx` handler pattern (return `Response` or `null`):

| Domain | Handler | Notes |
|---|---|---|
| `mapeditor/*` | `handleMapEditor` (`editorStore.js`) | map-editor documents in the `mapeditorDocs` store; each write also writes its summary to `mapeditorMeta`, and the list is built from those summaries, so opening the Documents menu never loads a whole map |
| `basemaps/*` | `handleBasemaps` (`basemapStore.js`) | basemap meta + payload (two stores) |
| `flags/*` | `handleFlags` (`flagStore.js`) | flag records, validated by the desktop's own rule (`server/flagValidation.js`: known image type, base64, at most 2 MB) |
| `ui-settings/*` | `handleUiSettings` (`settingsStore.js`) | UI settings persisted in `kv` |
| `lang/*` | `handleLang` (`settingsStore.js`) | language packs: the static `/lang/*.json` Vite copies to the site, merged over the IndexedDB overlay of AI translations (shipped wins; see [Languages & Translation](i18n.md)) |

---

## 12. Key differences vs the server build

| Aspect | Server build | Web build |
|---|---|---|
| Backend | real Express server, same-origin | `window.fetch` interceptor (`router.js`), no server |
| Persistence | files on disk (`server/libraryStore.js` etc.) | one IndexedDB record per item (`idb.js`) |
| Record layout | scenario split across many files | `world`/`game`/`colors`/`geojson`/`cover` in **one** record |
| Owner migration | must keep files in step | in-place on one record; the **same** `migrateOwnerRecord` and context (`server/ownerMigration.js`) |
| Cover image URL | fetchable `/api/.../assets/cover?token=` | `blob:` object URL (bypasses the fetch interceptor) — see §6 |
| Map files | fetched from the `map-data` release at first launch, then served by the server | static files under the build's own `/assets`, laid in at build time from the same release (§8); the stock world is one of them, not seeded |
| Default scenario | full data on disk | seeded from `generated/defaultScenario.js`; big geometry fetched on demand |
| Moving games between devices | copy the data folder, or export/import | export/import only — there are no accounts and no sync |
| Community bundle download | direct | proxied via Worker `/hub/file` (CORS) |
| Code shipped | this whole tree stripped out | this whole tree, behind `VITE_OH_WEB` |

---

### File index

| File | Role |
|---|---|
| `src/runtime/web/index.js` | boot entry (`installWebBackend`) |
| `src/runtime/web/router.js` | `/api` fetch interceptor + dispatch |
| `src/runtime/web/idb.js` | IndexedDB primitives + `STORES` |
| `src/runtime/web/libraryStore.js` | scenarios/games/runtime store + handlers |
| `src/runtime/web/models.js` | constants, `resolveOwnerRef`, meta readers |
| `src/runtime/web/util.js` | response builders, base64, SHA-256, range serving |
| `src/runtime/web/retiredAccount.js` | one-time boot cleanup of a pre-removal sign-in |
| `src/runtime/web/coverUrls.js` | covers as cached `blob:` object URLs |
| `src/runtime/web/homePage.js` | the website's entry overlay |
| `src/runtime/web/nativeBoot.js` | the Android app's boot screen |
| `src/runtime/web/bootTexts.js` | the first screens' text, looked up in the player's language pack |
| `src/runtime/worldFiles.js` | where a build reads its map files: `ASSETS_BASE`, `worldFileUrl`, `mapArchiveUrl` |
| `src/runtime/web/settingsStore.js` | ui-settings + language handlers |
| `src/runtime/web/basemapStore.js` / `flagStore.js` / `editorStore.js` | secondary store handlers |
| `scripts/map-assets.web.json` | the six map files a web build carries, pinned by size and sha256 |
| `scripts/stage-map-assets.mjs` | downloads and verifies them into `map-cache/`, lays them into a build |
| `.env.web` | web-mode build config |
