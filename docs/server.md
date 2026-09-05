# Server & API

Open Historia ships with a small **Express** server (`server/server.js`) that is the single backend for the whole app: it serves the built SPA, exposes a JSON/binary REST API under `/api/*`, and reads/writes every piece of persistent state (scenarios, games, map-editor docs, basemaps, flags, language packs, UI settings) as plain files under one writable data directory. There is no database — the on-disk layout under `server/data/` *is* the data model, and each concern gets its own self-contained "store" module. The same `server.js` runs unchanged on desktop, Termux, and in-process inside the Android app (via `nodejs-mobile`); portability comes entirely from the `OH_DATA_DIR` indirection in `server/dataDir.js`.

> This page documents the **game server** (`server/server.js`). A second, unrelated entry point — `server/node.js` — is the stateless content-node for the peer network (hash-addressed read-only bytes; run separately with `OH_NODE_PORT`). It is out of scope here beyond this note.

---

## Boot sequence & topology

`server/server.js` is an ES module. On import it:

1. Builds the Express `app`, reads `PORT` (default `3000`, `server/server.js:61`) and `distDir = ../dist` (the Vite build output).
2. Installs a **blanket CORS** middleware (`server/server.js:73-89`) — `Access-Control-Allow-Origin: *`, all methods, and three deliberate extras: `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges` (so PMTiles range recovery can read `Content-Range` off a 416), and `Access-Control-Allow-Private-Network: true` (Chrome's Private Network Access preflight for loopback/LAN). `OPTIONS` short-circuits to `204`.
3. Installs the **CSRF / cross-origin-write guard** (`server/server.js:112-128`, logic in `server/security.js`). See [Security guard](#security--path-safety).
4. Calls `ensureScenarioStore()`, `ensureGameStore()`, `ensureMapEditorStore()`, `ensureBasemapStore()` — first-run seeding of `server/data/` (`server/server.js:91-94`).
5. Registers all `/api/*` routes, then the `/fmg` static mount (if vendored), then `express.static(distDir)`, then the SPA catch-all `GET *splat → dist/index.html` (`server/server.js:813-820`).
6. `app.listen(PORT)`; an `EADDRINUSE` is caught and turned into a human message instead of a raw stack (`server/server.js:828-836`).

Route ordering matters: `/fmg/*` and `express.static` are mounted **before** the `*splat` fallback so real files aren't swallowed by `index.html`.

| Concern | Module | What it owns |
| --- | --- | --- |
| HTTP routing, static serving, range streaming, AI relay, hub proxy, shutdown | `server/server.js` | The Express app and every route |
| Scenario + game catalog, CRUD, runtime read/write, owner canonicalization, bundle import/export, asset serving | `server/libraryStore.js` | The bulk of the data model |
| Owner-code → country-name schema-2 migration | `server/ownerMigration.js` | `resolveOwnerName` + record migrators |
| Writable data-root resolution | `server/dataDir.js` | `DATA_DIR` |
| Path containment, CSRF guard, range parsing, hub host allowlist | `server/security.js` | Pure, unit-tested helpers |
| Map-editor documents | `server/mapEditorStore.js` | `/api/mapeditor/*` |
| User basemap library ("Your basemaps") | `server/basemapStore.js` | `/api/basemaps/*` |
| Saved flag library ("My flags") | `server/flagStore.js` | `/api/flags/*` |

---

## API route table

All routes are JSON in / JSON out unless noted. Errors are `{ error: message }` with the status shown (via `sendError`, `server/server.js:96-99`). Body-size limits: `jsonParser` = 64 MB, `largeJsonParser` = 2048 MB, `uploadParser` (`express.raw`, any type) = 2048 MB (`server/server.js:64-66`).

### Client preferences & language packs
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/ui-settings` | Global shared UI settings (currently `language`) — every device sees the same choice | `server/server.js:171` |
| PUT | `/api/ui-settings` | Set the shared UI language | `server/server.js:236` |
| GET | `/api/lang/:code` | Merged language pack: shipped `dist|public/lang/<code>.json` **under** saved `data/lang/<code>.json` (saved wins) | `server/server.js:197` |
| PUT | `/api/lang/:code` | Append runtime-generated translations into `data/lang/<code>.json` (bounded per entry: source ≤3000, translation ≤6000 chars) | `server/server.js:205` |

`code` must match `/^[a-z]{2,3}$/` or the route 400s (`isLangCode`, `server/server.js:195`).

### Scenarios
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/scenarios` | Scenario catalog (`{ scenarios, selectedScenarioId, activeScenarioId }`) | `server/server.js:250` |
| GET | `/api/library` | Combined catalog: scenarios + games + selected/active + `countryNames` registry | `server/server.js:258` |
| GET | `/api/scenarios/:scenarioId` | One scenario's summary + all 7 core JSON assets | `server/server.js:266` |
| POST | `/api/scenarios` | Create a scenario (optionally seeded from `seedScenarioId`) → 201 | `server/server.js:274` |
| PUT | `/api/scenarios/active` | Set the selected scenario (alias of `selected`) | `server/server.js:282` |
| PUT | `/api/scenarios/selected` | Set the selected scenario | `server/server.js:290` |
| PUT | `/api/scenarios/:scenarioId` | Update meta / `world` / `game` / `prompts` / `storage.*` (full-replace or `*Patch` merge) | `server/server.js:298` |
| GET | `/api/scenarios/:scenarioId/export` | Export a shareable bundle; `?mode=full` embeds PMTiles, default `light` | `server/server.js:306` |
| POST | `/api/scenarios/import` | Import a bundle as a **new** scenario (auto-selects it) → 201 | `server/server.js:315` |
| PUT | `/api/scenarios/:scenarioId/import` | Replace an existing scenario's content from a fresh bundle (hub "Update" button) | `server/server.js:325` |
| GET | `/api/scenarios/:scenarioId/assets/:assetKey` | Stream a binary/JSON upload asset (range-capable) | `server/server.js:333` |
| PUT | `/api/scenarios/:scenarioId/assets/:assetKey` | Upload a binary asset (raw body) | `server/server.js:342` |
| DELETE | `/api/scenarios/:scenarioId/assets/:assetKey` | Remove one upload asset | `server/server.js:443` |
| DELETE | `/api/scenarios/:scenarioId` | Soft-delete a scenario to `.trash` (blocked if games still use it) | `server/server.js:451` |

### Games
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/games` | Game catalog (`{ games, activeGameId }`) | `server/server.js:360` |
| GET | `/api/games/:gameId` | One game's summary + all 7 core JSON assets + its scenario summary | `server/server.js:368` |
| POST | `/api/games` | Create a game from a scenario (or seed from `seedGameId`) → 201 | `server/server.js:376` |
| PUT | `/api/games/active` | Set the active game (stamps `lastPlayedAt`/`playCount`) | `server/server.js:384` |
| PUT | `/api/games/:gameId` | Update meta / `world` / `game` / `prompts` / `storage.*` | `server/server.js:392` |
| GET | `/api/games/:gameId/assets/:assetKey` | Stream a game upload asset (only `cover`) | `server/server.js:400` |
| PUT | `/api/games/:gameId/assets/:assetKey` | Upload a game asset (raw body) | `server/server.js:409` |
| DELETE | `/api/games/:gameId` | Soft-delete a game to `.trash` | `server/server.js:427` |
| DELETE | `/api/games/:gameId/assets/:assetKey` | Remove one game upload asset | `server/server.js:435` |

### Runtime (what the running game polls)
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/runtime/json/:assetKey` | Read a JSON asset for the **active game** (falls back to its scenario, then defaults). `Cache-Control: no-store` | `server/server.js:459` |
| PUT | `/api/runtime/json/:assetKey` | Write a JSON asset for the active game (auto-creates a session if none) | `server/server.js:470` |
| GET | `/api/runtime/pmtiles/:assetKey` | Stream the active scenario's PMTiles archive (range-capable) | `server/server.js:481` |
| HEAD | `/api/runtime/pmtiles/:assetKey` | Size probe for the PMTiles reader (`Content-Length`, `Accept-Ranges`) | `server/server.js:490` |

`assetKey` for JSON is one of `world`, `game`, `prompts`, `actions`, `advisor`, `chat`, `events`, `colors`, `flags`, `tags`, `snapshots`, `regionsGeojson`, `citiesGeojson`, `backgroundData`; for PMTiles one of `cities`, `countries`, `regions`. See [Runtime asset resolution](#runtime-asset-resolution).

### AI relay, hub proxy, telemetry, shutdown
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| POST | `/api/ai/relay` | Server-to-server relay to a player-configured OpenAI-compatible endpoint (defeats the endpoint's missing CORS). Speaks `http`/`https` directly — **not** `fetch`, whose undici default gave up on any generation that took over 300s to answer — and pipes the upstream body straight back, so a streamed answer reaches the browser as it arrives. Aborts upstream if the client disconnects; `OH_RELAY_TIMEOUT_MS` (default 600000) is the only deadline, and it replies `504` rather than hanging | `server/server.js:844` |
| POST | `/api/server/shutdown` | Stop the process (acks first, then `process.exit(0)`); the beta UI no longer has a button for it | `server/server.js:559` |
| GET | `/api/hub/file?url=` | Proxy-download a community bundle from GitHub only; manual redirect-following with per-hop allowlist re-check; on-disk cache keyed by URL SHA-256 | `server/server.js:575` |
| POST | `/api/hub/import-log` | Best-effort import telemetry; one ping per scenario per install (atomic `wx` marker), forwarded to the counter Worker | `server/server.js:657` |
| GET | `/api/hub/import-counts` | Read import counts back from the counter Worker (60 s in-memory cache) | `server/server.js:691` |

### Map editor, flags, basemaps
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/mapeditor/documents` | List map-editor doc summaries | `server/server.js:708` |
| POST | `/api/mapeditor/documents` | Create a map-editor doc → 201 | `server/server.js:716` |
| GET | `/api/mapeditor/documents/:id` | Full doc (regions, features, types, colors, flags) | `server/server.js:724` |
| PUT | `/api/mapeditor/documents/:id` | Update a doc | `server/server.js:732` |
| DELETE | `/api/mapeditor/documents/:id` | Delete a doc | `server/server.js:740` |
| GET | `/api/flags` | List saved flags ("My flags") | `server/server.js:751` |
| POST | `/api/flags` | Save a flag (data-URL PNG; dedup by content hash) → 201 | `server/server.js:759` |
| DELETE | `/api/flags/:id` | Delete a saved flag | `server/server.js:767` |
| GET | `/api/basemaps` | Basemap catalog (light metadata only) | `server/server.js:776` |
| POST | `/api/basemaps` | Create a basemap (image or vector; dedup by hash) → 201 | `server/server.js:784` |
| GET | `/api/basemaps/:id/payload` | Heavy payload (`{ dataUrl }` or `{ geojson }`), fetched only when applied | `server/server.js:792` |
| DELETE | `/api/basemaps/:id` | Delete a basemap | `server/server.js:800` |

### Static / SPA
| Path | Purpose | Handler |
| --- | --- | --- |
| `/fmg/*` | Vendored Fantasy Map Generator (`../fmg/dist`), mounted only if it exists | `server/server.js:813-814` |
| `/*` (files) | `express.static(dist)` | `server/server.js:816` |
| `GET *splat` | SPA fallback → `dist/index.html` | `server/server.js:818` |

---

## On-disk layout: `server/data/`

Every store roots its files at `DATA_DIR` (see [Portability](#portability-the-writable-data-dir)). Default `DATA_DIR = server/data`. Verified layout:

```
server/data/
  scenario-manifest.json         # { order[], selectedScenarioId, activeScenarioId, version:2 }
  game-manifest.json             # { order[], activeGameId, version:2 }
  ui-settings.json               # { language }
  scenarios/
    <scenarioId>/
      scenario.json              # meta (name, hero*, accentColor, coverImageContentType,
                                 #        countryNameOverrides, hubOrigin, playCount, timestamps)
      world.json  game.json  prompts.json   # CORE_JSON_ASSET_FILES
      colors.json flags.json tags.json       # OPTIONAL_JSON_ASSET_FILES
      cover-image.bin            # uploaded cover (content type in scenario.json)
      cities.pmtiles countries.pmtiles regions.pmtiles   # per-scenario PMTiles overrides
      regions.geojson cities.geojson background.json      # custom map geometry
      storage/
        actions.json advisor.json chat.json events.json   # STORAGE_JSON_ASSET_FILES
  games/
    <gameId>/
      game-instance.json         # meta (+ scenarioId, lastPlayedAt, playCount)
      world.json game.json prompts.json colors.json flags.json tags.json
      cover-image.bin
      storage/
        actions.json advisor.json chat.json events.json snapshots.json
  assets/                        # embedded-server ONLY: PMTiles fetched into OH_DATA_DIR on first run
  basemaps/  basemaps-manifest.json
  mapeditor-documents/  mapeditor-manifest.json
  flags-library.json
  lang/<code>.json               # runtime-saved translations (survive app updates)
  hub-cache/<sha256>.body|.type  # cached hub bundle downloads
  import-pings/<sha256>          # one-per-scenario import telemetry markers
  .trash/<kind>-<id>[-n]/        # soft-deleted scenarios/games (recoverable by hand)
```

Key path constants live at `server/libraryStore.js:19-35`: `SCENARIOS_DIR`, `GAMES_DIR`, `SCENARIO_MANIFEST_PATH`, `GAME_MANIFEST_PATH`, `DATA_ASSETS_DIR`, plus the read-only source roots `DIST_DIR`/`PUBLIC_DIR` and `PMTILES_ASSETS_DIR = public/assets`.

### Asset-file groupings (the vocabulary of `assetKey`)
Defined at `server/libraryStore.js:240-324`. These maps drive every read/write/serve path:

| Group | Keys → files | Notes |
| --- | --- | --- |
| `CORE_JSON_ASSET_FILES` | `world`→`world.json`, `game`→`game.json`, `prompts`→`prompts.json` | Object-shaped; always seeded |
| `STORAGE_JSON_ASSET_FILES` | `actions`,`advisor`,`chat`,`events` → `storage/*.json` | Array-shaped |
| `JSON_ASSET_FILES` | CORE ∪ STORAGE | Copied into every new scenario/game |
| `OPTIONAL_JSON_ASSET_FILES` | `colors`,`flags`,`tags` → `*.json` | Static author data kept **out** of the 5 s `world.json` poll |
| `RUNTIME_ONLY_JSON_ASSET_FILES` | `snapshots`→`storage/snapshots.json` | Roll-back points; never copied/exported |
| `PMTILES_ASSET_FILES` | `cities`,`countries`,`regions` → `*.pmtiles` | Per-scenario binary map overrides |
| `SCENARIO_GEOJSON_ASSET_FILES` | `regionsGeojson`→`regions.geojson`, `citiesGeojson`→`cities.geojson`, `backgroundData`→`background.json` | Custom map geometry; always embedded in bundles |
| `*_IMAGE_ASSET_FILES` | `cover`→`cover-image.bin` | Content type recorded in meta |
| `UPLOADABLE_SCENARIO_ASSET_FILES` | image ∪ optional-JSON ∪ PMTiles ∪ geojson | The valid `:assetKey` set for scenario upload/serve/delete |
| `UPLOADABLE_GAME_ASSET_FILES` | just `cover` | Games only accept a cover upload |

`flags`/`tags` are separate JSON assets (not fields on `world.json`) specifically because `world.json` is re-polled every 5 s and a few hundred flags would be megabytes on every poll (`server/libraryStore.js:258-270`). See [World state](world-state.md).

### Manifests & catalog cache
- A **scenario/game manifest** is `{ order: id[], selected/active, version:2 }`. `resolveOrderedIds` (`server/libraryStore.js:1097`) reconciles the manifest order against directories actually present on disk, so a hand-added or hand-deleted directory self-heals.
- `getScenarioCatalog`/`getGameCatalog` are **memoized** (`scenarioCatalogCache`, `gameCatalogCache`, `server/libraryStore.js:427-433`). A catalog build walks every directory and parses each meta file — the 5 s `world.json` poll used to cost ~139 sync file ops just to learn the active game. The cache is invalidated wholesale inside `writeJsonFile` (`server/libraryStore.js:408-416`), the single choke point every meta/manifest write passes through, so no call site has to remember to invalidate.

### First-run seeding
`ensureScenarioStore` → `ensureDefaultScenario` (`server/libraryStore.js:1004-1055`) seeds the built-in `default` scenario **only on a true first run** (no manifest yet). The default scenario is deletable and, once deleted, stays deleted across restarts. `ensureGameStore` seeds no game — the player starts their first game from a scenario; if every game is deleted the runtime falls back to the selected scenario's data, and the first stateful write auto-creates a session (`writeRuntimeJsonAsset`, `server/libraryStore.js:2321-2340`).

---

## Serving assets

### JSON assets
Read as parsed objects and re-serialized. Two families:
- **Catalog/details reads** (`getScenarioDetails`/`getGameDetails`, `server/libraryStore.js:1327-1362`) return all 7 core assets inline in the HTTP JSON body.
- **Runtime reads** (`/api/runtime/json/:assetKey`) go through `readRuntimeJsonAsset` and emit `res.send(JSON.stringify(data))` with `Cache-Control: no-store` and `application/json` (`server/server.js:459-468`). Scenario *upload* JSON assets (`colors`, geojson) served via `/assets/:assetKey` get `application/json; charset=utf-8` so the map editor can open a scenario's own map (`resolveScenarioUploadAsset`, `server/libraryStore.js:2009-2016`).

### Binary assets & PMTiles byte-range
All binary serving funnels through **`streamBinaryFile(req, res, sourcePath, contentType)`** (`server/server.js:130-156`):
- Sets `Accept-Ranges: bytes`, the content type, and `Cache-Control: no-store`.
- **No `Range` header** → full file, `Content-Length` set, `fs.createReadStream(...).pipe(res)`.
- **With `Range`** → `parseByteRange(rangeHeader, totalSize)` (`server/security.js:59-79`):
  - unsatisfiable/empty → `416` with `Content-Range: bytes */<size>`;
  - otherwise `206` with `Content-Length` and `Content-Range: bytes start-end/total`, streaming just that slice.
- `parseByteRange` correctly handles suffix ranges (`bytes=-N` = final N bytes) and clamps `start`/`end`; a first-byte-position past EOF is a `416`.

PMTiles are served by `resolveRuntimeBinaryAsset` (`server/libraryStore.js:2371-2403`), which resolves in priority order: **(1)** the active scenario's own `<key>.pmtiles` override → **(2)** `DATA_ASSETS_DIR` (`OH_DATA_DIR/assets`, where the embedded Android server downloads them on first run) → **(3)** the shipped `public/assets/<key>.pmtiles`. The `HEAD` route replies with size and `Accept-Ranges` without streaming, for the pmtiles reader's initial probe (`server/server.js:490-502`).

Upload assets are written straight from the raw request buffer (`uploadScenarioAsset`/`uploadGameAsset`, `server/libraryStore.js:1909-1972`); the `assetKey` is validated against the uploadable set before any filesystem touch, and a cover upload also records its normalized image content type in meta (PNG/JPEG/WEBP/GIF/AVIF only, `SUPPORTED_IMAGE_CONTENT_TYPES`).

---

## Runtime asset resolution

`readRuntimeJsonAsset(assetKey)` (`server/libraryStore.js:2218-2312`) is the heart of what a playing client sees. The resolution ladder:

1. Resolve the **active game** first (`getActiveGameSummary`) and run its owner-schema migration hook (`ensureGameOwnerSchema`) — this happens *above* the geojson branch on purpose, because `regions.geojson` returns early and is where `owner` physically lives.
2. **`SCENARIO_GEOJSON_ASSET_FILES`** keys resolve from the active game's **scenario** directory. A scenario with no `regions.geojson` of its own borrows the built-in `default` Modern Day geometry (migrated as *default's* record, not the borrowing scenario's), so every scenario renders with the custom map style; missing cities stay absent.
3. Otherwise, prefer the **active game's** own `<assetKey>` file if it exists.
4. Else fall back to the **active scenario's** file.
5. Else, for optional assets, `colors` alone has a built-in fallback (the shipped 293-country palette via `resolveColorsAssetFile`); everything else is `{}`.
6. Else the type-appropriate default (`JSON_ASSET_DEFAULTS`, `server/libraryStore.js:326-336`).

`world` gets `normalizeRuntimeWorld` applied on the way out (`server/libraryStore.js:2073-2078`): if `world.customRegions` is unset it is injected `true` in the *served* payload (never written to disk), so old/fresh worlds still render with the custom style.

`writeRuntimeJsonAsset(assetKey, value)` (`server/libraryStore.js:2314-2369`) always writes to the **active game** (auto-creating a session from the selected scenario if there is no active game), canonicalizes owner references first (`world` → `canonicalizeWorldCountryRefs`, `game` → `canonicalizeGameCountry`, `colors` → `canonicalizeColorKeys`), writes via `writeJsonFile`, bumps game meta, and returns the freshly re-read asset.

---

## Owner canonicalization & the schema-2 migration

Owners are identified by **country name** ("Russia"), not GADM code ("RUS"). Two cooperating mechanisms keep that invariant; both live at the persistence boundary so no reader ever has to normalize.

### Write-time canonicalization (`server/libraryStore.js:69-200`)
`resolveOwnerRef(value, world)` resolves any author/AI/legacy reference to the canonical name, in order: **verbatim** editor polity → the scenario's own polity name/alias (with a self-name guard that prevents `{"MNG":{name:"MNG"}}` from pinning "MNG" forever) → legacy-code key → the shipped `country-names.json` registry (`code → name`, loaded once into `COUNTRY_NAME_REGISTRY`) → else the token is its own identifier. `canonicalizeWorldCountryRefs` applies it across `regionOwnershipOverrides`, `ownerCodes`, `polityOverrides` (dropping the now-redundant `.code`), `units[].ownerCode`, `countryTags`, `internationalReputation`. **A legacy (unmigrated) world is returned untouched** — canonicalizing it would destroy the migration's rule 1 and mis-name every invented polity.

### The schema-2 migration (`server/ownerMigration.js`)
A **one-time, eager, on-disk** rewrite of a code-keyed record into a name-keyed one, gated on `world.ownerSchema` (`OWNER_SCHEMA = 2`; `needsMigration` = `ownerSchema < 2`). It is not a read transform because `owner` lives in `regions.geojson`, which the read path returns before any hook, and re-walking a 55 MB FeatureCollection per poll would be ruinous.

`resolveOwnerName(token, ctx)` is the ordered resolver — the obvious "each region carries owner→country so it can self-migrate" answer is **false** for presets (a preset's `ROM` spans 36 modern `country` values), hence the rules:

| # | Rule | Catches |
| --- | --- | --- |
| 0 | Editor-marked `verbatim` polity | Human-typed name colliding with a code ("USA") |
| 1 | Scenario's own polity name (with `name !== token` guard) | `ROM`→"Roman Empire"; skips degenerate `{"Z01":{name:"Z01"}}` |
| 2 | Legacy per-scenario `countryNameOverrides` label (read-only, being deleted) | wwii-1939 "Siam" |
| 3 | Shipped GADM registry | The whole modern world; the accepted disputed-territory merges (Z01→India) |
| 4 | Consensus of the regions the token owns, **only if unanimous** | Names an FMG world's polities |
| 5 | Token is its own identifier | Custom polities |

`migrateOwnerRecordAtPaths` (`server/libraryStore.js:2095-2152`) orchestrates it: build one `renames` map (`buildOwnerRenameMap`) so a record is resolved *consistently* across all sibling files, then rewrite `colors.json`, `flags.json`, `tags.json` (`rekeyOwnerMap`, which deterministically resolves the N-tokens-collide-on-one-name merges), `regions.geojson` (`migrateRegions` — `owner` only; `country` dropped, `gid0` kept as provenance), `storage/events.json` (`migrateEvents`), `storage/chat.json` (`migrateChat`), `game.json` (`migrateGame`); **discard** roll-back `snapshots.json` (blind-restored, unmarked, would re-inject codes); and write `world.json` **last** because it carries the marker — a crash mid-migration simply redoes the record. A game migrates against **its scenario's** context (`ensureGameOwnerSchema` migrates the parent scenario first, then the game with the scenario's `countryNameOverrides` + `regions.geojson` as read-only resolver context), so one token can't mean two things inside one running game. Each record is attempted once per process via the `ownerSchemaChecked` set, with the key removed on failure so the next read retries.

The mirror of this logic for the web build is `src/runtime/web/ownerMigration.js` — keep them in step. Tests: `server/ownerMigration.test.js`.

---

## Scenario bundles (export / import / update)

Bundles are the shareable unit strangers swap on the community hub. Schema string `pax-historia-scenario-bundle/2` is the **only** compatibility gate (`version` is written and read by nobody). `ACCEPTED_BUNDLE_SCHEMAS` also accepts the unversioned v1 string — old bundles import fine and get named by the migration on first read.

- **Export** — `exportScenarioBundle(id, {mode})` (`server/libraryStore.js:2477`) returns `{ schema, scenario{meta}, data{7 core assets}, assets{...}, mode, exportedAt }`. `mode: "light"` embeds cover/colors/flags/tags/geojson/background but **not** PMTiles (they're huge and reconstructable); `mode: "full"` base64-embeds the PMTiles too. Custom geometry is always embedded even in light mode — a shared custom map is broken without it.
- **Import** — `importScenarioBundle` (`server/libraryStore.js:2529`) creates a **new** scenario, writes its core data via `updateScenario`, lays down each embedded asset via `applyScenarioBundleAsset`, then stamps `hubOrigin` last (so the import's own meta writes don't clear it) and selects it.
- **Update-in-place** — `updateScenarioFromBundle` (`server/libraryStore.js:2635`) is the hub card's "Update" button: it keeps the local `id` (games reference scenarios by id) and `createdAt`, replaces meta/world/assets from the new bundle, and visits **every** uploadable key so an asset the new version dropped doesn't linger. `hubOrigin` is re-stamped last so the card reverts to "New Game" after refresh.

`hubOrigin` (`{ postId, bundleUrl, syncedAt }`, normalized at `server/libraryStore.js:575-585`) is provenance for hub imports. **Any meta write that doesn't explicitly carry `hubOrigin` clears it** (`writeScenarioMeta`, `server/libraryStore.js:639-641`) — a local edit forks the copy and stops offering overwrites. GitHub mints a new immutable attachment URL per re-upload, so `bundleUrl` inequality is itself the update signal (and the reason `/api/hub/file`'s disk cache can never go stale). See [Scenario hub](scenario-hub.md).

---

## Security & path safety

`server/security.js` holds the pure, unit-tested guards (`server/security.test.js`):

| Helper | Guarantees |
| --- | --- |
| `resolveChildPath(baseDir, name, label)` | `name` must resolve to a **direct child** of `baseDir` — rejects `../`, path separators (incl. the `%2f` Express decodes to `/`), and absolutes. Used by `getScenarioDirectory`/`getGameDirectory` and by every store's `docPath`/`metaPath`/`payloadPath`, so a route `:id` can't escape the data dir. Re-exported in `libraryStore.js` as `resolveWithinDirectory`. |
| `crossOriginWriteAllowed({method,origin,host,remoteAddress,allowAll})` | The CSRF guard. Allows safe methods (GET/HEAD/OPTIONS); same-origin writes (`Origin` host === `Host`); and no-`Origin` writes **only from loopback**. A foreign `Origin`, or a no-`Origin` write from a non-loopback host, is `403`. Bypass with `OH_ALLOW_CROSS_ORIGIN=1`. Without it, the blanket CORS (needed so the Android connect screen can *probe*) would otherwise let any visited web page POST/DELETE to `localhost`. |
| `isLoopbackAddress(addr)` | Unwraps IPv4-mapped IPv6 (`::ffff:127.0.0.1`); true for `::1`, `127.*`. |
| `parseByteRange(header, size)` | Range parsing for `streamBinaryFile` (above). |
| `isAllowedHubUrl(url, hosts)` | A hub download must be **https** and either on the fixed GitHub host set or any `*.githubusercontent.com`. Checked on the initial URL **and every redirect hop** in `/api/hub/file`, which follows redirects manually (`redirect: "manual"`) so a `github.com → attacker` redirect can't cause SSRF. |

Additional hardening in the stores: content hashes for basemaps/flags are **always computed server-side** — trusting a client hash would let a caller poison the dedup index so a later genuine upload is silently discarded (`server/basemapStore.js:104-110`, `server/flagStore.js:33-35`). Deletes are **soft** (`moveDirectoryToTrash`, `server/libraryStore.js:1804-1842`) with a Windows-specific retry-then-copy fallback for locked directories.

---

## Portability: the writable data dir

`server/dataDir.js` is the whole portability story:

```js
export const DATA_DIR = process.env.OH_DATA_DIR
  ? path.resolve(process.env.OH_DATA_DIR)
  : path.join(__dirname, "data");   // server/data
```

Every store imports this one constant, so a single env var relocates **all** writable state. Desktop and Termux leave it unset and use `server/data` (byte-identical to how they've always worked). The **embedded Android server** runs `server.js` in-process via `nodejs-mobile`, where the `server/data` shipped inside the APK is **read-only**; the app sets `OH_DATA_DIR` to a writable sandbox path, seeds first-run defaults there, and downloads PMTiles into `OH_DATA_DIR/assets` (which `resolveRuntimeBinaryAsset` prefers over the read-only shipped copies). Shipped-but-updatable content (`dist|public/lang/*.json`) stays under the app root and is *merged under* the writable `DATA_DIR/lang/*.json`, so runtime translations survive app updates that overwrite the app root.

### Environment variables
| Var | Default | Effect |
| --- | --- | --- |
| `PORT` | `3000` | Listen port (`server/server.js:61`) |
| `OH_DATA_DIR` | `server/data` | Writable data root for every store (`server/dataDir.js`) |
| `OH_ALLOW_CROSS_ORIGIN` | unset | `=1` disables the cross-origin-write guard (`server/server.js:111`) |
| `OH_IMPORT_COUNTER_URL` | `https://oh-import-counter.…workers.dev` | Import-telemetry counter Worker; empty string disables pings (`server/server.js:653`) |

Related sibling pages: [World state](world-state.md) · [Map editor](map-editor.md) · [Scenario hub](scenario-hub.md).
