# Web Build (openhistoria.com)

The web build is the browser-only edition of Open Historia served from the trusted central origin (openhistoria.com / the `/play/` site). It runs the **entire game client unchanged** with **zero server**: a `window.fetch` interceptor answers every same-origin `/api/*` call out of IndexedDB, and heavy map tiles stream from a Cloudflare Worker proxy (or a hash-verified community node swarm). There are no accounts: games stay in this browser and move between devices by export and import. Everything in this page lives under `src/runtime/web/` and ships in the web build and in the Android app (`--mode android`, which sets `VITE_OH_WEB` too and adds `VITE_OH_NATIVE` — see [mobile.md](mobile.md)); it is dynamically imported behind `import.meta.env.VITE_OH_WEB` so it is dead-code-eliminated from the desktop download, which keeps its real same-origin Express server.

See also: [Server build](server.md) (the Express store this mirrors), [World state](world-state.md), [Assets & PMTiles](assets-and-data.md), [Scenario & game library](runtime-services.md), [Community hub](runtime-services.md).

---

## 1. How it boots and how it is gated

The whole web backend is behind one Vite mode flag. `.env.web` sets `VITE_OH_WEB=1`, and that file is loaded **only** by `vite build --mode web`. The normal `npm run build` never sees it, so `import.meta.env.VITE_OH_WEB` is `undefined` there and every `if (import.meta.env.VITE_OH_WEB)` branch — plus the dynamic imports it guards — is stripped by tree-shaking.

| Step | Location | What happens |
|---|---|---|
| Gate | `src/main.jsx` | `if (import.meta.env.VITE_OH_WEB)` dynamically `import("./runtime/web/index.js")`, calls `installWebBackend()`, then `mount()`s the React app. Non-web builds just `mount()`. |
| Entry | `src/runtime/web/index.js` | `installWebBackend()` — seed → install interceptor → drop a retired sign-in → home page. |
| Content fetch | `src/runtime/assets.js` (`warmPmtilesArchive`) | For pmtiles, dynamically imports `web/contentTrust.js` and tries `fetchVerifiedBuffer(url)` (node swarm) before the origin; the origin's bytes are then held to the same signed manifest by `verifyOriginBuffer(url, buffer)`. A scenario's own archive skips both. |
| Worker fetches | `src/runtime/assets.js` (`prepareWorkerFetchableUrl`) | Workers never see the `window.fetch` patch, so the scenario's regions GeoJSON reaches MapLibre's `custom-regions-source` and the cartography worker through a `blob:` copy (`Nations.jsx` via `useWorkerFetchableUrl`); the runtime URL stays the epoch/cache key. |

`installWebBackend()` (`src/runtime/web/index.js`) runs, in order:

1. `await ensureSeeded()` — write the default scenario into IndexedDB before any `/api` call (`libraryStore.js`).
2. `installWebApiRouter()` — monkey-patch `window.fetch` (`router.js`).
3. `forgetRetiredAccount()` (`retiredAccount.js`) — best-effort, not awaited: deletes the kv rows a sign-in from before accounts were removed left behind (`account:session`, `account:email`, `account:dek`, `sync:versions`). Nothing reads them any more.
4. If `shouldShowHome()` (not yet "entered" this tab session) → `showHomePage()`; otherwise `connectBestNode()` in the background.

Build scripts (`package.json`):

| Script | Command |
|---|---|
| `build:web` | `node scripts/seed-web-defaults.mjs && vite build --mode web --outDir dist-web --emptyOutDir` |
| `build:site` | same, but `--base /play/` + `scripts/assemble-site.mjs` (the GitHub-Pages parchment landing site wraps `/play/`). |

`scripts/seed-web-defaults.mjs` regenerates `src/runtime/web/generated/defaultScenario.js` (auto-generated; the default scenario's meta + colors + base64 cover) so the seed is baked into the bundle.

---

## 2. Configuration (`.env.web`)

Every URL points at the **registry Worker** (`open-historia-registry.nichojkrol.workers.dev`), which is the one piece of always-on server infrastructure.

| Var | Value / default | Purpose | Read in |
|---|---|---|---|
| `VITE_OH_WEB` | `1` | Master flag; gates all web-mode code + dynamic imports. | `main.jsx`, `assets.js`, `libraryBar.jsx`, `settings.jsx` |
| `VITE_OH_PMTILES_URL` | Worker `/content` | CORS+range proxy for the 60–100 MB pmtiles (Cloudflare Pages caps at 25 MB/file). Also the base for `default-regions.geojson`. Falls back to `/assets` (local dev). | `router.js`, `libraryStore.js` |
| `VITE_OH_DIRECTORY_URL` | Worker `/node-directory.json` | The **signed** live node directory (updates as nodes are accepted/paused/banned). | `contentTrust.js` |
| `VITE_OH_HUB_URL` | Worker root | Community-hub GitHub proxy (`/hub/*`), because GitHub attachments send no CORS. | `router.js` |
| `VITE_OH_MANIFEST_URL` | *(unset)* → `${BASE_URL}content-manifest.json` | Signed asset→hash manifest; ships with the build, so the default sits beside it (`/play/content-manifest.json` on openhistoria.com; a root-absolute default 404'd there and verification never ran). A missing manifest logs one `console.info`. | `contentTrust.js` |

---

## 3. The fake backend: the `/api` fetch interceptor (`router.js`)

There is no Express server. `installWebApiRouter()` (`router.js`) replaces `window.fetch` once (`installed` guard). The wrapper:

- Resolves the request URL against `location.href`. **Only** same-origin requests whose path starts with `/api/` are intercepted; everything else (AI providers, GitHub API, ESRI tiles, static assets, node URLs) passes straight to the saved `originalFetch`.
- Builds a real `Request`, dispatches to `route(request, url)`, and returns a real `Response` — so all the existing client code (`src/runtime/library.js`, `src/runtime/assets.js`, `documentIO.js`, `basemapLibrary.js`) runs **unchanged**.
- On throw: `SyntaxError` (bad JSON body) → `400`, anything else → `500` (mirrors Express body-parser behavior).

> **Important boundary:** only `window.fetch` is patched. `<img src>`, `<link>`, XHR, `EventSource`, and PMTiles' own range reads that don't go through `fetch` all **bypass** the interceptor. This is exactly why cover images are shown through `blob:` object URLs (see §6) rather than served as `/api/...` paths.

### `route()` dispatch

`route()` (`router.js`) splits the path into `["api", domain, ...segments]` and dispatches on `domain`. Each handler returns a `Response` or `null` (fall through).

| `domain` (+ path shape) | Handler | Store file |
|---|---|---|
| `runtime/pmtiles/<key>` | inline (scenario override → else proxy) | `libraryStore.getScenarioPmtilesOverride` |
| `runtime/json/<key>` | `handleRuntimeJson` | `libraryStore.js` |
| `mapeditor/*` | `handleMapEditor` | `editorStore.js` |
| `basemaps/*` | `handleBasemaps` | `basemapStore.js` |
| `flags/*` | `handleFlags` | `flagStore.js` |
| `library` | `handleLibrary` | `libraryStore.js` |
| `scenarios/*` | `handleScenarios` | `libraryStore.js` |
| `games/*` | `handleGames` | `libraryStore.js` |
| `trash`, `trash/<entry>/restore` | `handleTrash` | `libraryStore.js` |
| `ui-settings/*` | `handleUiSettings` | `settingsStore.js` |
| `lang/*` | `handleLang` | `settingsStore.js` |
| `hub/*` | inline proxy → Worker / node | (see below) |
| *(anything else)* | `errorResponse("Unknown web-mode endpoint", 404)` | `util.js` |

### Body handling (`readBody`, `router.js`)

- `GET`/`HEAD` → no body.
- **Asset uploads** (`isAssetUpload`: `scenarios`|`games` + an `assets` segment + `PUT`) are forced to **raw bytes** regardless of `Content-Type`, because colors/geojson arrive as `application/json` but must be stored **verbatim** (the server's `express.raw` does the same).
- Otherwise: `application/json` → `JSON.parse`; everything else → raw `Uint8Array`.

### The two branches that are *not* pure IndexedDB

- **`runtime/pmtiles/<key>`** (`router.js`): first ask `getScenarioPmtilesOverride(key, range)` (a scenario may carry its own pmtiles in IndexedDB); otherwise proxy `${VITE_OH_PMTILES_URL||/assets}/<key>.pmtiles` with the incoming `Range`/method.
- **`hub/*`** (`router.js`): forward to `${VITE_OH_HUB_URL}/hub/<segments>`. For a bundle download (`hub/file?url=…`, GET) it **prefers the connected content node** (`getConnected()` → `node.url/oh/v1/hub`) to offload the central proxy, falling back to the Worker. `POST`s (import counters) are anonymous; the Worker dedups them by IP.

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
- The default scenario's `regionsGeojson` (~12 MB) is **not** in the seed — `fetchDefaultRegionsGeojson()` pulls `${VITE_OH_PMTILES_URL}/default-regions.geojson` once per session (never pinning an empty/failed result, so a transient miss retries). Without it the political map renders blank.
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
- Hub provenance (`hubOrigin`, `hubPublished`, `hubReviews`) follows the desktop store's rules through the same `server/hubProvenance.js`. `hubOrigin` is stamped **last** by an import. Any later edit keeps it and stamps `editedAt`, which stops hub updates from overwriting the player's work while keeping the original for **Suggest changes**. `hubOrigin: null` unlinks the scenario. A body carrying only provenance is bookkeeping (`writeScenarioMeta(record, updates, { touch: false })`: no `updatedAt`, no `editedAt`). See [server.md](server.md#hub-provenance-where-a-scenario-came-from-and-where-it-went).
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

## 8. Heavy content: PMTiles, the node swarm, and the trust model

Heavy map tiles never touch IndexedDB by default; they stream from the network. Integrity comes from **hashes and signatures, never from trusting a node**.

### The fetch path (`assets.js` → `contentTrust.js`)

`assets.js` (web only): for a pmtiles URL, try `fetchVerifiedBuffer(url)` first; on any miss/failure fall through to the origin (via `router.js`'s pmtiles proxy branch → the Worker). A node outage is therefore invisible.

`fetchVerifiedBuffer(url)` (`contentTrust.js`):

1. Map the URL to a content-manifest asset id (`countries.pmtiles`, etc.).
2. Load the **signed** content manifest (asset→`{sha256,bytes}`) and the active node list.
3. For each candidate node (connected node first, then a per-asset rotation): `GET <node>/oh/v1/content/<sha256>`, reject on wrong byte length, **recompute SHA-256 and compare** — a tampered node is skipped with a warning.
4. Return the verified `ArrayBuffer`, or `null` so the caller uses the canonical origin.

### Where the manifest comes from

`public/content-manifest.json` describes the files the **website** fetches by release-asset name through the Worker's `/content` proxy, listed in `scripts/map-assets.web.json` (the full `regions.pmtiles` / `countries.pmtiles`, `cities.pmtiles`, and the web-sized seeds). It is not the desktop list (`scripts/map-assets.json`), whose files differ in size. `node scripts/build-content-manifest.mjs` rebuilds it from the web list; when nothing changed it leaves the file byte-for-byte alone (the signature stays valid), otherwise it drops `keyid`/`issued`/`expires` and prints the `sign-release.mjs --stamp` command to run. Content nodes are filled from the same list by the node software ([Open-Historia/open-historia-node](https://github.com/Open-Historia/open-historia-node)). `server/contentManifest.test.js` fails when the web list and the committed manifest drift apart, or when two lists give one release asset different bytes.

### Node directory: signed control doc + live addresses

`loadDirectoryNodes()` (`contentTrust.js`) combines two sources:
- The **signed** directory (`VITE_OH_DIRECTORY_URL`) — an auto-accept **deny-list / control doc**: nodes marked `banned`/`paused` are excluded and rate-limit/cap overrides applied.
- The **unsigned** live list (`nodes-live.json`, same origin) — actual current URLs (`{id,url,status}`), so a node restarting on a new URL needs no admin re-sign.

Because every byte is hash-verified, an un-vetted node can at worst be useless; a bad actor is removed by an admin ban published to the signed directory.

### Signature verification (`trust.js` + `trust/pinned-key.js`)

`fetchSignedJson(url)` (`trust.js`) fetches `url` and `url.sig` (both bounded by `SIGNED_FETCH_TIMEOUT_MS`, 4 s, body included; `nodes-live.json` has the same deadline), verifies the **detached Ed25519 signature over the exact served bytes** against the pinned root key(s), and enforces `keyid` + `expires`. Returns `{valid, data, reason}`; any of unsigned / bad-signature / expired / keyid-unknown / timed out ⇒ `valid:false` and the client simply **doesn't use nodes** and falls back to the origin — a broken trust chain degrades safely.

- `verifyDetached` uses `@noble/ed25519`.
- `PINNED_ROOT_KEYS` (`trust/pinned-key.js`) — currently one key `oh-root-1` — is compiled into both the client and the node software; the private key is offline. Rotation = ship both keys for one release, then drop the old one.

### Connecting to a node (`nodeConnect.js`)

`connectBestNode()` probes every directory node's `/oh/v1/status` (4 s timeout), picks reachable + `active` + not `full` with the **lowest latency**, and makes content fetches prefer it (`setPreferredNode`).

| Endpoint | Method | Purpose |
|---|---|---|
| `/oh/v1/status` | GET | probe: liveness, region, user counts, `full` |
| `/oh/v1/ping` | GET | count toward the node's live user tally; heartbeat health check |
| `/oh/v1/leave` | GET (keepalive, `pagehide`) | drop out of the node's player count immediately |
| `/oh/v1/content/<sha256>` | GET | fetch a hash-addressed content blob |
| `/oh/v1/hub?url=…` | GET | node-served community bundle download |

A 20 s heartbeat re-selects a node if the current one goes draining/full/unreachable. Nothing is reported to the registry: a node sees only IPs, and the player stays anonymous.

---

## 9. Home / connect screen (`homePage.js`)

A full-screen parchment/Roman overlay injected over the already-mounted game on first entry per tab session (`sessionStorage["oh:entered"]`). Pure DOM (no React), scoped under `.oh-home`. It auto-connects the best node and renders live stats. Its text, the demo notice's and the Android boot screen's come from `bootTexts.js`, looked up in the player's shipped language pack (see [i18n.md](i18n.md)).

| Control | Behavior |
|---|---|
| Connection panel | "Finding the nearest node…" → connected node card (**anonymous node id only**, region, latency, `players/max` bar) or "Connected via the origin" fallback. Fed by `connectBestNode()` → `renderConnection`. If the connection has not settled by `CONNECT_DEADLINE_MS` (8 s, `nativeBoot.js`) it shows the origin and enables Enter; a node that answers later replaces it. |
| **⚔ Enter Open Historia** | `enter()` — sets the `oh:entered` flag and removes the overlay. |
| Footer links | GitHub, Discord, Host a node. |

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
| PMTiles hosting | served by the server | Worker CORS+range proxy + hash-verified node swarm; default `regions.geojson` fetched from the content origin, not seeded |
| Default scenario | full data on disk | seeded from `generated/defaultScenario.js`; big geometry fetched on demand |
| Moving games between devices | copy the data folder, or export/import | export/import only — there are no accounts and no sync |
| Community bundle download | direct | proxied via Worker `/hub/file` or a connected node (CORS) |
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
| `src/runtime/web/homePage.js` | entry/connect overlay |
| `src/runtime/web/bootTexts.js` | the first screens' text, looked up in the player's language pack |
| `src/runtime/web/contentTrust.js` | verified node-swarm content fetch |
| `src/runtime/web/trust.js` | Ed25519 signed-manifest verification |
| `src/runtime/web/nodeConnect.js` | node selection + heartbeat |
| `src/runtime/web/settingsStore.js` | ui-settings + language handlers |
| `src/runtime/web/basemapStore.js` / `flagStore.js` / `editorStore.js` | secondary store handlers |
| `trust/pinned-key.js` | pinned root public key(s) |
| `.env.web` | web-mode build config |
