# Server & API

Open Historia ships with a small **Express** server (`server/server.js`) that is the single backend for the whole app: it serves the built SPA, exposes a JSON/binary REST API under `/api/*`, and reads/writes every piece of persistent state (scenarios, games, map-editor docs, basemaps, flags, language packs, UI settings) as plain files under one writable data directory. There is no database — the on-disk layout under `server/data/` *is* the data model, and each concern gets its own self-contained "store" module. The same `server.js` runs unchanged from a checkout, on Termux, and in-process inside the Electron desktop app; portability comes entirely from the `OH_DATA_DIR` indirection in `server/dataDir.js` (and `OH_ASSETS_DIR` for the stock map archives). The Android app runs no server: it is the web build, whose backend is IndexedDB (see [mobile.md](mobile.md)).

> This page documents the **game server** (`server/server.js`). Content nodes are not part of it: the node software is the separate [Open-Historia/open-historia-node](https://github.com/Open-Historia/open-historia-node) repository.

---

## Boot sequence & topology

`server/server.js` is an ES module. On import it:

1. Builds the Express `app`, reads `PORT` (default `3000`) and `distDir = ../dist` (the Vite build output), and decides which interface to listen on: loopback by default, every interface when LAN sharing is on (Settings → Advanced → Network, `network-settings.json`), or whatever `OH_HOST` says.
2. Installs the **Host guard** first (DNS rebinding, `isAllowedHostHeader` in `server/security.js`): a request whose `Host` is not an IP address, `localhost`/`*.localhost`, this computer's name (`<hostname>`, `<hostname>.local`), a hostname in `OH_HOST` or a name in `OH_ALLOWED_HOSTS` is refused with `403` before any other middleware runs. Without it a page that re-points its own name at `127.0.0.1` arrives over loopback with a matching `Origin` and `Host` and passes every check below.
3. Installs the **CORS** middleware — `Access-Control-Allow-Origin` reflects only an allowed origin (`allowedCorsOrigin` in `server/security.js`: the Capacitor shell origins, or an `Origin` whose host equals `Host`; `*` only with `OH_ALLOW_CROSS_ORIGIN=1`), `Vary: Origin`, all methods, `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges` (so PMTiles range recovery can read `Content-Range` off a 416), and `Access-Control-Allow-Private-Network: true` (Chrome's Private Network Access preflight for loopback/LAN) for an allowed origin only. `OPTIONS` short-circuits to `204`.
4. Installs a per-IP **rate limit** for network callers (`OH_RATE_LIMIT` per minute, default 1200; loopback is exempt).
5. Calls `ensureScenarioStore()`, `ensureGameStore()`, `ensureMapEditorStore()`, `ensureBasemapStore()` — first-run seeding of `server/data/`.
6. Installs the **CSRF / cross-origin-write guard** (`crossOriginWriteAllowed` in `server/security.js`). See [Security guard](#security--path-safety).
7. Registers all `/api/*` routes, then the `/fmg` static mount (if vendored), then `express.static(distDir)`, then the SPA catch-all `GET *splat → dist/index.html`.
8. Listens on `PORT` and the chosen host; an `EADDRINUSE` at startup is turned into a human message instead of a raw stack. Turning LAN sharing on or off later rebinds the listener in place (`rebindListener`).

Route ordering matters: `/fmg/*` and `express.static` are mounted **before** the `*splat` fallback so real files aren't swallowed by `index.html`.

| Concern | Module | What it owns |
| --- | --- | --- |
| HTTP routing, static serving, range streaming, AI relay, hub proxy, shutdown | `server/server.js` | The Express app and every route |
| Scenario + game catalog, CRUD, runtime read/write, owner canonicalization, bundle import/export, asset serving | `server/libraryStore.js` | The bulk of the data model |
| Owner-code → country-name schema-2 migration | `server/ownerMigration.js` | `resolveOwnerName` + record migrators |
| Writable data-root resolution | `server/dataDir.js` | `DATA_DIR` |
| Path containment, CSRF guard, range parsing, hub host allowlist | `server/security.js` | Pure, unit-tested helpers |
| Community download cache (hub-cache): capped streaming download, size cap with least-recently-used eviction, startup sweep, clear | `server/hubCache.js` | `/api/hub/file`'s disk cache, `/api/hub/cache` |
| Map-editor documents | `server/mapEditorStore.js` | `/api/mapeditor/*` |
| User basemap library ("Your basemaps") | `server/basemapStore.js` | `/api/basemaps/*` |
| Saved flag library ("My flags") | `server/flagStore.js` | `/api/flags/*` |

---

## API route table

All routes are JSON in / JSON out unless noted. Errors are `{ error: message }` with the status shown (via `sendError`). Body-size limits: `jsonParser` = 64 MB, `largeJsonParser` = 512 MB, `uploadParser` (`express.raw`, any type) = 512 MB. The **Handler** column names what the route calls (store functions live in `server/libraryStore.js` unless noted); find a route in `server/server.js` by its path.

### Client preferences & language packs
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/ui-settings` | Global shared UI settings (currently `language`) — every device sees the same choice | `readUiSettings` |
| PUT | `/api/ui-settings` | Set the shared UI language | writes `ui-settings.json` |
| GET | `/api/lang/:code` | Merged language pack: saved `data/lang/<code>.json` **under** shipped `dist|public/lang/<code>.json` (shipped wins: a saved entry for a string the pack covers is an older AI translation; see [Languages & Translation](i18n.md)) | `readLangPack` |
| PUT | `/api/lang/:code` | Append runtime-generated translations into `data/lang/<code>.json`, skipping strings the shipped pack has (bounded per entry: source ≤3000, translation ≤6000 chars) | `readLangPack` + write |

`code` must match `/^[a-z]{2,3}$/` or the route 400s (`isLangCode`).

### Scenarios
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/scenarios` | Scenario catalog (`{ scenarios, selectedScenarioId, activeScenarioId }`) | `getScenarioCatalog` |
| GET | `/api/library` | Combined catalog: scenarios + games + selected/active + `countryNames` registry | `getLibraryCatalog` |
| GET | `/api/scenarios/:scenarioId` | One scenario's summary + all 7 core JSON assets | `getScenarioDetails` |
| POST | `/api/scenarios` | Create a scenario (optionally seeded from `seedScenarioId`) → 201 | `createScenario` |
| PUT | `/api/scenarios/active` | Set the selected scenario (alias of `selected`) | `setSelectedScenario` |
| PUT | `/api/scenarios/selected` | Set the selected scenario | `setSelectedScenario` |
| PUT | `/api/scenarios/:scenarioId` | Update meta / `world` / `game` / `prompts` / `storage.*` (full-replace or `*Patch` merge) | `updateScenario` |
| GET | `/api/scenarios/:scenarioId/export` | Export a shareable bundle; always full, custom PMTiles included. `?mode=` is accepted and ignored, and older light bundles still import | `exportScenarioBundle` |
| POST | `/api/scenarios/import` | Import a bundle as a **new** scenario (auto-selects it) → 201 | `importScenarioBundle` |
| PUT | `/api/scenarios/:scenarioId/import` | Replace an existing scenario's content from a fresh bundle (hub "Update" button) | `updateScenarioFromBundle` |
| GET | `/api/scenarios/:scenarioId/assets/:assetKey` | Stream a binary/JSON upload asset (range-capable); `regionsGeojson?coarse=1` streams the coarsened copy the country picker uses | `resolveScenarioUploadAsset` / `resolveScenarioCoarseRegionsAsset` → `streamBinaryFile` |
| PUT | `/api/scenarios/:scenarioId/assets/:assetKey` | Upload a binary asset (raw body) | `uploadScenarioAsset` |
| GET | `/api/scenarios/:scenarioId/institution-logo/:institutionId` | One institution's logo from the scenario's `institutionLogos` map, as an image (data URL decoded, size-capped) | `readScenarioInstitutionLogoMap` → `sendInstitutionLogo` |
| DELETE | `/api/scenarios/:scenarioId/assets/:assetKey` | Remove one upload asset | `removeScenarioAsset` |
| DELETE | `/api/scenarios/:scenarioId` | Soft-delete a scenario to `.trash` (blocked if games still use it) | `deleteScenario` |

### Games
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/games` | Game catalog (`{ games, activeGameId }`) | `getGameCatalog` |
| GET | `/api/games/:gameId` | One game's summary + all 7 core JSON assets + its scenario summary | `getGameDetails` |
| POST | `/api/games` | Create a game from a scenario (or seed from `seedGameId`; a copy keeps its source's scenario even when that scenario is gone, and a refused create leaves nothing on disk) → 201 | `createGame` |
| PUT | `/api/games/active` | Set the active game (stamps `lastPlayedAt`/`playCount`) | `setActiveGame` |
| PUT | `/api/games/:gameId` | Update meta / `world` / `game` / `prompts` / `storage.*`; `scenarioId` re-points the game at a scenario this library holds (anything else is refused) | `updateGame` |
| GET | `/api/games/:gameId/export` | Export one game as a bundle (the zip around it is built in the client, `src/runtime/gameZip.js`, so the web build makes the same file) | `exportGameBundle` |
| POST | `/api/games/import` | Import a game bundle as a new game → 201; never switches the active game | `importGameBundle` |
| GET | `/api/games/:gameId/snapshots` | A game's restore points, by id (`/api/runtime/json/snapshots` only reaches the active game); kept out of the bundle because they are far larger | `readGameSnapshots` |
| PUT | `/api/games/:gameId/snapshots` | Write a game's restore points (an import carrying them) | `writeGameSnapshots` |
| GET | `/api/games/:gameId/assets/:assetKey` | Stream a game upload asset (only `cover`) | `resolveGameUploadAsset` → `streamBinaryFile` |
| PUT | `/api/games/:gameId/assets/:assetKey` | Upload a game asset (raw body) | `uploadGameAsset` |
| DELETE | `/api/games/:gameId` | Soft-delete a game to `.trash` | `deleteGame` |
| DELETE | `/api/games/:gameId/assets/:assetKey` | Remove one game upload asset | `removeGameAsset` |

### Trash (loopback only)
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/trash` | What delete moved to `.trash`: `{ entries: [{ entry, kind, id, name, scenarioId?, deletedAt, bytes }] }`, newest first (`listTrash`) | `server/server.js` |
| POST | `/api/trash/:entry/restore` | Put one entry back under its old id, or the next free one if that id was reused; → `{ id, kind, library }` (`restoreFromTrash`) | `server/server.js` |
| DELETE | `/api/trash` | Delete every entry for good; → `{ removed, bytes }` (`emptyTrash`) | `server/server.js` |

A 403 from anywhere but the machine running the server. Nothing in the app calls these yet: the library has no Recently deleted shelf, nothing purges old entries, and the web store still deletes records outright (`idbDelete`).

### Runtime (what the running game polls)
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/runtime/json/:assetKey` | Read a JSON asset for the **active game** (falls back to its scenario, then defaults); custom geometry is streamed untransformed. `Cache-Control: no-store` | `readRuntimeJsonAsset` / `resolveRuntimeGeojsonAsset` |
| PUT | `/api/runtime/json/:assetKey` | Write one JSON asset for the active game (auto-creates a session if none). Refuses an empty body rather than blanking the save; `Prefer: return=minimal` answers 204 without reading the record back | `writeRuntimeJsonAsset` |
| PUT | `/api/runtime/turn-commit` | **Commit a whole turn at once** (below) | `writeRuntimeTurnState` |
| GET | `/api/runtime/pmtiles/:assetKey` | Stream the active scenario's PMTiles archive (range-capable) | `resolveRuntimeBinaryAsset` → `streamBinaryFile` |
| HEAD | `/api/runtime/pmtiles/:assetKey` | Size probe for the PMTiles reader (`Content-Length`, `Accept-Ranges`) | `resolveRuntimeBinaryAsset` |
| GET | `/api/runtime/institution-logo/:institutionId` | One institution's logo from the active game's `institutionLogos` | `readRuntimeJsonAsset("institutionLogos")` → `sendInstitutionLogo` |

`assetKey` for JSON is one of `world`, `game`, `prompts`, `actions`, `advisor`, `chat`, `events`, `colors`, `flags`, `tags`, `snapshots`, `regionsGeojson`, `citiesGeojson`, `backgroundData` and the other runtime keys; for PMTiles one of `cities`, `countries`, `regions`. See [Runtime asset resolution](#runtime-asset-resolution).

**The turn commit.** The end of a turn writes six domains that must agree with each other, so it is one request, not six PUTs (`commitCanonicalTurnPayload` in `src/runtime/gameState.js`; the web store answers the same route). Body:

```
{ actions: [...], chat: [...], events: [...], game: {...}, colors: {...}, world: {...}, expectedGameId?: "<id>" }
```

`actions`, `chat` and `events` must be arrays and the other three objects, or the whole commit is refused (400). `expectedGameId`, when sent, must be the active game: a turn started in one save is never written into another. The owners in `world`, `game` and `colors` are canonicalized as on any write. The answer is `{ transactionId, assets }`, the canonical copies as stored.

**Atomicity.** Before any file changes, the full generation is written to `storage/turn-commit-journal.json` in the game's folder. Each of the six files is then replaced atomically (`writeJsonFileAtomic`), and the journal is removed last. A crash or error part-way leaves the journal behind, and the next runtime read or write rolls **forward** to exactly that generation (`recoverPendingTurnCommit`), so no reader is ever left on a save that is half one turn and half the next.

### AI relay, hub proxy, app updates, logs, network, shutdown
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| POST | `/api/ai/relay` | Server-to-server relay to a player-configured OpenAI-compatible endpoint (defeats the endpoint's missing CORS). Speaks `http`/`https` directly — **not** `fetch`, whose undici default gave up on any generation that took over 300s to answer — and pipes the upstream body straight back, so a streamed answer reaches the browser as it arrives. Aborts upstream if the client disconnects; `OH_RELAY_TIMEOUT_MS` (default 600000) is the only deadline, on silence (restarted by every chunk), and it replies `504` rather than hanging. Once the answer has started, a failure (that deadline, the 64 MB cap, the endpoint dropping mid-answer) destroys the connection instead of ending it cleanly, so the browser's reader fails rather than taking half an answer for a whole one | route handler in `server/server.js` |
| GET | `/api/app-update?track=` | The update manifest for `stable` / `beta` (the Android releases' `latest.json`) or `desktop` (the `desktop-stable` release, or `OH_DESKTOP_UPDATE_URL` for the desktop beta), fetched server-side because release assets send no CORS headers; cached 3 min, stale-if-error, `{}` for an unknown track or when offline | `APP_UPDATE_MANIFESTS` |
| GET | `/api/app-update/status` | The desktop updater's state (`{ supported: false }` outside the installed desktop app) | `desktopUpdater` (`globalThis.__ohAutoUpdate`, `electron/main.cjs`) |
| POST | `/api/app-update/download` | Start downloading the update; the page follows it through `/status`. 404 where the build cannot update itself | `desktopUpdater().download` |
| POST | `/api/app-update/restart` | Install the downloaded update and restart; 409 unless one is ready | `desktopUpdater().restart` |
| GET | `/api/log?since=` | The Desktop log (this server's and the Electron process's own entries), to merge into the Logging file a player sends | `readLogSince` (`server/logStore.js`) |
| DELETE | `/api/log` | Clear the Desktop log; 403 unless the caller is this machine | `clearLog` (`server/logStore.js`) |
| GET | `/api/server/network` | LAN sharing state (`{ lanEnabled, host, port, lockedByEnv, addresses }`) and the relay switch (`relayForLan`, `relayLockedByEnv`); the addresses only for a caller on this machine | `lanAddresses`, `relaySettingState` |
| POST | `/api/server/network` | Turn LAN sharing on or off (`{ lanEnabled }`) and rebind without a restart (loopback ↔ `0.0.0.0`), or set the relay switch alone (`{ relayForLan }`, applied at once), both saved to `network-settings.json`; 403 unless the caller is this machine, 409 while `OH_HOST` (LAN sharing) or `OH_ALLOW_REMOTE_RELAY` (the relay switch) is set. The relay answers another device only while `relayForLan` is on; its refusal is a `403` marked `X-OH-Relay: refused` | `writeNetworkSettings` → `rebindListener` |
| POST | `/api/server/shutdown` | Stop the process (acks first, then `process.exit(0)`); only from this machine unless LAN sharing is on | route handler |
| POST | `/api/presence` | What the page shows, for Discord's "Playing Open Historia" (`{ scene: "game", player, scenario, date }` or `{ scene: "menu" }`; anything else, such as the page's `{ scene: "none" }` goodbye, clears it); taken from this computer only, answered 204 either way. See [Discord Rich Presence](#discord-rich-presence) | `server/discordPresence.js` |
| GET | `/api/hub/file?url=` | Proxy-download a community bundle from GitHub only; manual redirect-following with per-hop allowlist re-check; on-disk cache keyed by URL SHA-256. A download over 200 MB (`HUB_MAX_BUNDLE_BYTES`) is refused with `413` from its `Content-Length`, or as it passes the cap while being streamed to disk (never held in memory). The cache is capped at 1 GB (`HUB_CACHE_MAX_BYTES`, `server/hubCache.js`): past it the entries used longest ago go first (a hit counts as a use), and leftover `.tmp` downloads are swept at startup | `isAllowedHubUrl` (`server/security.js`), `hubCachePaths`, `saveCappedBody` (`server/hubCache.js`) |; a scenario bundle is cached and served under the current bundle name (`scenarioBundleNames.js`)
| GET / DELETE | `/api/hub/cache` | How much the download cache holds (`{ files, bytes }`), and emptying it (Settings → Advanced → Storage → "Clear download cache"); downloads in progress are left alone | `hubCacheUsage` / `clearHubCache` (`server/hubCache.js`) |
| POST | `/api/hub/import-log` | Best-effort import telemetry; one ping per scenario per install (atomic `wx` marker), forwarded to the counter Worker | route handler |
| GET | `/api/hub/import-counts` | Read import counts back from the counter Worker (60 s in-memory cache) | route handler |

### Map editor, flags, basemaps
| Method | Path | Purpose | Handler |
| --- | --- | --- | --- |
| GET | `/api/mapeditor/documents` | List map-editor doc summaries | `getMapEditorCatalog` (`server/mapEditorStore.js`) |
| POST | `/api/mapeditor/documents` | Create a map-editor doc → 201 | `createMapEditorDocument` |
| GET | `/api/mapeditor/documents/:id` | Full doc (regions, features, types, colors, flags) | `getMapEditorDocument` |
| PUT | `/api/mapeditor/documents/:id` | Update a doc | `updateMapEditorDocument` |
| DELETE | `/api/mapeditor/documents/:id` | Delete a doc | `deleteMapEditorDocument` |
| GET | `/api/flags` | List saved flags ("My flags") | `listFlags` (`server/flagStore.js`) |
| POST | `/api/flags` | Save a flag (data-URL PNG; dedup by content hash) → 201 | `createFlag` |
| DELETE | `/api/flags/:id` | Delete a saved flag | `deleteFlag` |
| GET | `/api/basemaps` | Basemap catalog (light metadata only) | `getBasemapCatalog` (`server/basemapStore.js`) |
| POST | `/api/basemaps` | Create a basemap (image or vector; dedup by hash) → 201 | `createBasemap` |
| GET | `/api/basemaps/:id/payload` | Heavy payload (`{ dataUrl }` or `{ geojson }`), fetched only when applied | `getBasemapPayload` |
| DELETE | `/api/basemaps/:id` | Delete a basemap | `deleteBasemap` |

### Static / SPA
| Path | Purpose | Handler |
| --- | --- | --- |
| `/fmg/*` | Vendored Fantasy Map Generator (`../fmg/dist`), mounted only if it exists (only `node scripts/fetch-fmg.mjs` creates it; the Workshop hides its Generate tab otherwise) | `express.static(fmgDistDir)` |
| `/*` (files) | `express.static(dist)` | `express.static(distDir)` |
| `GET *splat` | SPA fallback → `dist/index.html` | registered last in `server/server.js` |

---

## On-disk layout: `server/data/`

Every store roots its files at `DATA_DIR` (see [Portability](#portability-the-writable-data-dir)). Default `DATA_DIR = server/data`. Verified layout:

```
server/data/
  scenario-manifest.json         # { order[], selectedScenarioId, activeScenarioId, version:2 }
  game-manifest.json             # { order[], activeGameId, version:2 }
  ui-settings.json               # { language }
  network-settings.json          # { lanAccess } — the LAN sharing switch
  scenarios/
    <scenarioId>/
      scenario.json              # meta (name, hero*, accentColor, coverImageContentType,
                                 #        countryNameOverrides, hubOrigin, hubPublished, hubReviews,
                                 #        playCount, timestamps)
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
        turn-commit-journal.json # only while a turn commit is being written (see the turn commit)
  basemaps/  basemaps-manifest.json
  mapeditor-documents/  mapeditor-manifest.json
  flags-library.json
  lang/<code>.json               # runtime-saved translations (survive app updates)
  hub-cache/<sha256>.body|.type  # cached hub downloads (bundles, basemaps, flags), capped at 1 GB, least recently used first; bundle-names-current marks the one-time rename pass as done
  import-pings/<sha256>          # one-per-scenario import telemetry markers
  .trash/<kind>-<id>[-n]/        # soft-deleted scenarios/games, each with a .deleted.json marker (/api/trash)
```

Key path constants live at the top of `server/libraryStore.js`: `SCENARIOS_DIR`, `GAMES_DIR`, `SCENARIO_MANIFEST_PATH`, `GAME_MANIFEST_PATH`, plus the read-only source roots `DIST_DIR`/`PUBLIC_DIR` and `PMTILES_ASSETS_DIR` (`OH_ASSETS_DIR` when set, else `public/assets`).

### Asset-file groupings (the vocabulary of `assetKey`)

Defined near the top of `server/libraryStore.js`, after the path constants. These maps drive every read/write/serve path:

| Group | Keys → files | Notes |
| --- | --- | --- |
| `CORE_JSON_ASSET_FILES` | `world`→`world.json`, `game`→`game.json`, `prompts`→`prompts.json` | Object-shaped; always seeded |
| `STORAGE_JSON_ASSET_FILES` | `actions`,`advisor`,`chat`,`events` → `storage/*.json` | Array-shaped |
| `JSON_ASSET_FILES` | CORE ∪ STORAGE | Copied into every new scenario/game |
| `OPTIONAL_JSON_ASSET_FILES` | `colors`,`flags`,`tags` → `*.json` | Static author data kept **out** of the 5 s `world.json` poll |
| `RUNTIME_ONLY_JSON_ASSET_FILES` | `snapshots`→`storage/snapshots.json` | Roll-back points (each a pre-turn `state`, the `round` the turn started on, the `campaignId` it was captured in and, for a time skip, the `turn` journal Intervene re-applies from — `src/Game/AI/intervene.js`); never copied/exported |
| `PMTILES_ASSET_FILES` | `cities`,`countries`,`regions` → `*.pmtiles` | Per-scenario binary map overrides |
| `SCENARIO_GEOJSON_ASSET_FILES` | `regionsGeojson`→`regions.geojson`, `citiesGeojson`→`cities.geojson`, `backgroundData`→`background.json` | Custom map geometry; always embedded in bundles |
| `*_IMAGE_ASSET_FILES` | `cover`→`cover-image.bin` | Content type recorded in meta |
| `UPLOADABLE_SCENARIO_ASSET_FILES` | image ∪ optional-JSON ∪ PMTiles ∪ geojson | The valid `:assetKey` set for scenario upload/serve/delete |
| `UPLOADABLE_GAME_ASSET_FILES` | just `cover` | Games only accept a cover upload |

> `GET /api/scenarios/:id/assets/regionsGeojson?coarse=1` serves a coarse copy of the regions (`resolveScenarioCoarseRegionsAsset`, `server/coarseGeometry.js`): the far tier's Douglas-Peucker coarsening, kept beside it as `regions.coarse.geojson` and stamped on the regions file's size+mtime. It is built where the regions are written — `uploadScenarioAsset` (a Workshop save, an upload) and `applyScenarioBundleAsset` (an import or hub Update) — so Apply & Play's picker finds it ready; regions written any other way (the built-in seed, an in-play geometry edit, a file changed by hand) fail the stamp check and are built on the first `?coarse=1` request after the change, synchronously on the event loop. The country picker draws that (a few MB) instead of the full-resolution file (221 MB for the stock world); the web store computes the same on demand. Never exported or cloned.

`flags`/`tags` are separate JSON assets (not fields on `world.json`) specifically because `world.json` is re-polled every 5 s and a few hundred flags would be megabytes on every poll (`server/libraryStore.js`). See [World state](world-state.md).

### Manifests & catalog cache
- A **scenario/game manifest** is `{ order: id[], selected/active, version:2 }`. `resolveOrderedIds` (`server/libraryStore.js`) reconciles the manifest order against directories actually present on disk, so a hand-added or hand-deleted directory self-heals.
- Every JSON file the store writes is **compact** except the four a person might open by hand — `scenario.json`, `game-instance.json` and the two manifests (`INDENTED_JSON_FILES`, `serializeJsonFile`). Worlds, events, chat, restore points and the turn journal used to be indented, which added a large share of whitespace to every write, fsync and parse.
- `getScenarioCatalog`/`getGameCatalog` are **memoized** (`scenarioCatalogCache`, `gameCatalogCache`, `server/libraryStore.js`). A catalog build walks every directory and parses each meta file — the 5 s `world.json` poll used to cost ~139 sync file ops just to learn the active game. The cache is invalidated wholesale inside `writeJsonFile` (`server/libraryStore.js`), the single choke point every meta/manifest write passes through, so no call site has to remember to invalidate. Writes are frequent during play (every chat line, order and turn commit), so a rebuild must stay cheap: each game's figures (country, date, round, event and pending-order counts, from its `game.json`, `actions.json` and `events.json`) are kept per game in `gameFiguresCache` (`readGameFigures`), stamped on those three files' size+mtime and forgotten when the store writes into that game, so a rebuild parses only the game that changed rather than every campaign in the library.

### First-run seeding
`ensureScenarioStore` → `ensureDefaultScenario` (`server/libraryStore.js`) seeds the built-in `default` scenario **only on a true first run** (no manifest yet). The default scenario is deletable and, once deleted, stays deleted across restarts. `ensureGameStore` seeds no game — the player starts their first game from a scenario; if every game is deleted the runtime falls back to the selected scenario's data, and the first stateful write auto-creates a session (`writeRuntimeJsonAsset`, `server/libraryStore.js`).

---

## Serving assets

### JSON assets
Read as parsed objects and re-serialized. Two families:
- **Catalog/details reads** (`getScenarioDetails`/`getGameDetails`, `server/libraryStore.js`) return all 7 core assets inline in the HTTP JSON body.
- **Runtime reads** (`/api/runtime/json/:assetKey`) go through `readRuntimeJsonAsset` and emit `res.send(JSON.stringify(data))` with `Cache-Control: no-store` and `application/json` (`server/server.js`). Scenario *upload* JSON assets (`colors`, geojson) served via `/assets/:assetKey` get `application/json; charset=utf-8` so the map editor can open a scenario's own map (`resolveScenarioUploadAsset`, `server/libraryStore.js`).

### Binary assets & PMTiles byte-range
All binary serving funnels through **`streamBinaryFile(req, res, sourcePath, contentType)`** (`server/server.js`):
- Sets `Accept-Ranges: bytes`, the content type, and `Cache-Control: no-store`.
- **No `Range` header** → full file, `Content-Length` set, `fs.createReadStream(...).pipe(res)`.
- **With `Range`** → `parseByteRange(rangeHeader, totalSize)` (`server/security.js`):
  - unsatisfiable/empty → `416` with `Content-Range: bytes */<size>`;
  - otherwise `206` with `Content-Length` and `Content-Range: bytes start-end/total`, streaming just that slice.
- `parseByteRange` correctly handles suffix ranges (`bytes=-N` = final N bytes) and clamps `start`/`end`; a first-byte-position past EOF is a `416`.

PMTiles are served by `resolveRuntimeBinaryAsset` (`server/libraryStore.js`), which resolves in priority order: **(1)** the active scenario's own `<key>.pmtiles` override → **(2)** the stock archive in `PMTILES_ASSETS_DIR` — `public/assets/<key>.pmtiles` from a checkout, or the writable folder `OH_ASSETS_DIR` names (the installed desktop app downloads the map there, because its own bundle is read-only). The `HEAD` route replies with size and `Accept-Ranges` without streaming, for the pmtiles reader's initial probe (`server/server.js`).

Upload assets are written straight from the raw request buffer (`uploadScenarioAsset`/`uploadGameAsset`, `server/libraryStore.js`); the `assetKey` is validated against the uploadable set before any filesystem touch, and a cover upload also records its normalized image content type in meta (PNG/JPEG/WEBP/GIF/AVIF only, `SUPPORTED_IMAGE_CONTENT_TYPES`).

---

## Runtime asset resolution

`readRuntimeJsonAsset(assetKey)` (`server/libraryStore.js`) is the heart of what a playing client sees. The resolution ladder:

1. Resolve the **active game** first (`getActiveGameSummary`) and run its owner-schema migration hook (`ensureGameOwnerSchema`) — this happens *above* the geojson branch on purpose, because `regions.geojson` returns early and is where `owner` physically lives.
2. **`SCENARIO_GEOJSON_ASSET_FILES`** keys resolve from the active game's **scenario** directory. A scenario with no `regions.geojson` of its own borrows the built-in `default` Modern Day geometry (migrated as *default's* record, not the borrowing scenario's), so every scenario renders with the custom map style; missing cities stay absent.
3. Otherwise, prefer the **active game's** own `<assetKey>` file if it exists.
4. Else fall back to the **active scenario's** file.
5. Else, for optional assets, `colors` alone has a built-in fallback (the shipped 293-country palette via `resolveColorsAssetFile`); everything else is `{}`.
6. Else the type-appropriate default (`JSON_ASSET_DEFAULTS`, `server/libraryStore.js`).

`world` gets `normalizeRuntimeWorld` applied on the way out (`server/libraryStore.js`): if `world.customRegions` is unset it is injected `true` in the *served* payload (never written to disk), so old/fresh worlds still render with the custom style.

`writeRuntimeJsonAsset(assetKey, value)` (`server/libraryStore.js`) always writes to the **active game** (auto-creating a session from the selected scenario if there is no active game), canonicalizes owner references first (`world` → `canonicalizeWorldCountryRefs`, `game` → `canonicalizeGameCountry`, `colors` → `canonicalizeColorKeys`), writes via `writeJsonFile`, bumps game meta, and returns the freshly re-read asset.

`writeRuntimeTurnState(payload)` (`PUT /api/runtime/turn-commit`) writes a whole turn to the active game the same way, but a payload stamped with `expectedGameId` is checked first, before any session is created: a turn for another game, or for a game deleted while it ran (no game active), is refused and the library is left as it was. The web store (`src/runtime/web/libraryStore.js`) does the same.

---

## Owner canonicalization & the schema-2 migration

Owners are identified by **country name** ("Russia"), not GADM code ("RUS"). Two cooperating mechanisms keep that invariant; both live at the persistence boundary so no reader ever has to normalize.

### Write-time canonicalization (`server/libraryStore.js`)
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

`migrateOwnerRecordAtPaths` (`server/libraryStore.js`) orchestrates it: it reads the record's files and hands them, with the context it gathered, to `migrateOwnerRecord` (`server/ownerMigration.js`), which builds the resolver context (`buildMigrationContext`) and one `renames` map (`buildOwnerRenameMap`) so a record is resolved *consistently* across all sibling files, derives the polities' `mapRefs`, and returns the migrated parts; the store then rewrites `colors.json`, `flags.json`, `tags.json` (`rekeyOwnerMap`, which deterministically resolves the N-tokens-collide-on-one-name merges), `regions.geojson` (`migrateRegions` — `owner` only; `country` dropped, `gid0` kept as provenance), `storage/events.json` (`migrateEvents`), `storage/chat.json` (`migrateChat`), `game.json` (`migrateGame`); **discard** roll-back `snapshots.json` (blind-restored, unmarked, would re-inject codes); and write `world.json` **last** because it carries the marker — a crash mid-migration simply redoes the record. A game migrates against **its scenario's** context (`ensureGameOwnerSchema` migrates the parent scenario first, then the game with the scenario's `countryNameOverrides` + `regions.geojson` as read-only resolver context), so one token can't mean two things inside one running game. Each record is attempted once per process via the `ownerSchemaChecked` set, with the key removed on failure so the next read retries, and removed (`invalidateOwnerSchemaCache`) whenever the record's world is replaced — `updateScenario`/`updateGame` with `world` or `worldPatch`, which the bundle import and hub Update go through, and `importGameBundle` — or the record is deleted, so a legacy world written later is migrated on the next read instead of after a restart.

The web build does not mirror this: `src/runtime/web/libraryStore.js` (`ensureOwnerSchema`) imports `server/ownerMigration.js` and calls the same `migrateOwnerRecord`, gathering the same context from IndexedDB (`ownerMigrationContext`: a game resolves against its scenario's meta, regions and inherited `mapRefs` after the scenario migrates; a scenario without a map of its own borrows the stock world). Tests: `server/ownerMigration.test.js`.

---

## Scenario bundles (export / import / update)

Bundles are the shareable unit strangers swap on the community hub. Schema string `open-historia-scenario-bundle/2` is the **only** compatibility gate (`version` is written and read by nobody). `isScenarioBundleSchema` reads format 2 and the unversioned format 1 under any `<name>-scenario-bundle` name — files written before 2026-09-29 carry the project's earlier name and import unchanged, and a format 1 bundle gets named by the migration on first read. Whatever is exported again says the current name. A build from before 2026-09-29 knows only the earlier name, so it refuses a file written now.

- **Export** — `exportScenarioBundle(id)` (`server/libraryStore.js`) returns `{ schema, scenario{meta}, data{7 core assets}, assets{...}, mode: "full", exportedAt }`. Every export is full: cover, colors, flags, tags, geometry, background and any custom PMTiles archive travel whenever the scenario has them. The former light mode (which dropped custom PMTiles) is gone; `?mode=` on the route is accepted and ignored, and older `mode: "light"` bundles still import.
  - **What is base64 and what is not.** Binaries (the cover, a custom PMTiles archive) are base64. JSON assets — the region and city geometry, a vector background — are the JSON itself (`encodeJsonFile`), because base64 made every shared map a third bigger for nothing: in a real hub bundle the region geometry was 17.1 MB of the 18.1 MB file, against 12.8 MB of actual geometry. Anything that does not parse as JSON still falls back to base64, byte-exact. The importer reads both shapes, so the bundles already on the hub import unchanged (`server/scenarioBundleWeight.test.js`).
  - **Inside a .zip the heavy assets are real entries.** `src/runtime/bundleFiles.js` lifts every embedded asset over 64 KB out of `scenario.json` into `assets/<file>` — text DEFLATEd, binaries STOREd — leaving `{ mode: "file", file, format }` behind, and puts them back on import before the bundle reaches the importer, which never learns it happened. The same lift is used by the scenario export, the hub publish and a game export carrying its map. That hub map: 18.1 MB as one JSON document, 13.8 MB with the geometry as JSON, **4.2 MB** as a zip.
- **Import** — `importScenarioBundle` (`server/libraryStore.js`) creates a **new** scenario, writes its core data via `updateScenario`, lays down each embedded asset via `applyScenarioBundleAsset`, then stamps `hubOrigin` last (so the import's own writes never count as the player's edits) and selects it.
- **Update-in-place** — `updateScenarioFromBundle` (`server/libraryStore.js`) is the hub card's "Update" button: it keeps the local `id` (games reference scenarios by id) and `createdAt`, replaces meta/world/assets from the new bundle, and visits **every** uploadable key so an asset the new version dropped doesn't linger. `hubOrigin` is re-stamped last so the card reverts to "New Game" after refresh.

### Hub provenance: where a scenario came from and where it went

A scenario keeps three records about the community hub in `scenario.json`. They are normalised by `server/hubProvenance.js`, which is pure and shared with the web store (`src/runtime/web/models.js`), so the two stores never disagree. Tests: `server/hubProvenance.test.js`.

| Record | Shape | Written by |
|---|---|---|
| `hubOrigin` | `{ postId, bundleUrl, syncedAt, title?, author?, editedAt? }` — the post this copy was downloaded from | the import and **Update** (stamped last); `null` from **Unlink** |
| `hubPublished` | `{ key, publishedAt, postIds[], author?, title?, suggestions[], blocked?[], checkedAt?, commentCounts? }` — the player's own posts of this scenario and the suggestions left on them | **Publish** (the key), **Link my post**, the suggestion checks, **Reject all from @…** / **Unblock** |
| `hubReviews` | `{ [suggestionId]: { status: reviewing|done|dismissed, accepted[], rejected[], updatedAt } }` | the review dialog; the map editor on save |

The rules:

- **An edit keeps `hubOrigin` and stamps `editedAt`** (`hubOriginAfterWrite`, used by `writeScenarioMeta`). Before, the first local edit erased it. An edited copy is never offered an **Update**, which would overwrite the player's work. It still knows its original, which **Suggest changes** compares against. A write that carries `hubOrigin` sets it, and an explicit `hubOrigin: null` unlinks the scenario for good.
- **Bookkeeping is not an edit.** `updateScenario` (`server/libraryStore.js`) writes a body that carries only `hubOrigin` / `hubPublished` / `hubReviews` with `touch: false`. That write moves neither `updatedAt` nor `editedAt`. In a body that also edits the scenario, the provenance is written after the edit.
- **An edited copy's games carry their map.** `fetchableHubOrigin` returns null for an edited copy, so a game exported from it embeds the map rather than pointing at a post whose file is no longer what the game was played on.
- **An imported game names the map it was played on, never merely the same id.** Ids come from names, so a receiver's own "New Scenario" holds the id of every other "New Scenario". A game that points at a hub file (`scenarioRef.hubOrigin`) names this library's copy of that very file (`importedGameScenarioId` / `scenarioCopyOfHubFile`: same post, same `bundleUrl`, unedited), in both stores' `importGameBundle`; with no copy it names an id nothing here holds, so the game shows its map as missing and **Import & play** fetches it (or takes a copy already here) and re-points the game with `saveGame({ scenarioId })`. A map carried inside the zip is imported unless a copy of it is already here (`src/runtime/importedScenarioCopy.js`: the same name, world, game and prompts under the sent id or an earlier import's `-2`, `-3`… id), so importing the same game twice still leaves one map.
- **Suggestions are references**, never the files: `{ id, postId, commentId, author, createdAt, zipUrl, note }`, with `zipUrl` a GitHub attachment. There are at most 50 (`MAX_HUB_SUGGESTIONS`); past that the newest are kept, and a check (`refreshPublishedRecord`, `trimSuggestions`) leaves out the ones already reviewed or dismissed first, then the oldest. A blocked contributor's (a case-insensitive login in `blocked`, at most 100) are dropped on every write. `withContributorBlocked` also resets `commentCounts`, so the next check re-reads every comment. `openHubSuggestions(published, reviews)` lists the suggestions not yet reviewed or dismissed.

GitHub mints a new immutable attachment URL per re-upload, so `bundleUrl` inequality is itself the update signal, and the reason `/api/hub/file`'s disk cache can never go stale. What players downloaded before 2026-09-29 says the project's earlier name in its schema: `scenarioBundleNames.js` rewrites the schema value (only that; the format stays 1 or 2, a zip's `scenario.json` is rewritten and re-zipped) as a download arrives, as a cached copy is served, and once for the whole cache at startup (`renameHubCacheBundles`, marker `bundle-names-current`), so every copy a player has downloaded is kept under the current name. The suggestion flow is in [game-ui.md §4.8](game-ui.md#48-suggested-changes).

---

## Security & path safety

`server/security.js` holds the pure, unit-tested guards (`server/security.test.js`):

| Helper | Guarantees |
| --- | --- |
| `resolveChildPath(baseDir, name, label)` | `name` must resolve to a **direct child** of `baseDir` — rejects `../`, path separators (incl. the `%2f` Express decodes to `/`), and absolutes. Used by `getScenarioDirectory`/`getGameDirectory` and by every store's `docPath`/`metaPath`/`payloadPath`, so a route `:id` can't escape the data dir. Re-exported in `libraryStore.js` as `resolveWithinDirectory`. |
| `crossOriginWriteAllowed({method,origin,host,remoteAddress,allowAll})` | The CSRF guard. Allows safe methods (GET/HEAD/OPTIONS); same-origin writes (`Origin` host === `Host`); and no-`Origin` writes **only from loopback**. A foreign `Origin`, or a no-`Origin` write from a non-loopback host, is `403`. Bypass with `OH_ALLOW_CROSS_ORIGIN=1`. Without it, the blanket CORS (needed so the Android connect screen can *probe*) would otherwise let any visited web page POST/DELETE to `localhost`. |
| `isAllowedHostHeader(host, names)` / `allowedHostNames(list)` | The DNS-rebinding guard, run before every route. Allows a `Host` that is an IP address, `localhost` or `*.localhost` (names nobody can re-point at this server), or one of the owner's names (`OH_ALLOWED_HOSTS`, a hostname in `OH_HOST`, this computer's name and `<name>.local`); `*` allows everything. A missing `Host` (HTTP/1.0, never a browser) passes. Because it runs first, a "same-origin" `Origin` in the guards below is always one of these names. |
| `isLoopbackAddress(addr)` | Unwraps IPv4-mapped IPv6 (`::ffff:127.0.0.1`); true for `::1`, `127.*`. |
| `parseByteRange(header, size)` | Range parsing for `streamBinaryFile` (above). |
| `isAllowedHubUrl(url, hosts)` | A hub download must be **https** and either on the fixed GitHub host set or any `*.githubusercontent.com`. Checked on the initial URL **and every redirect hop** in `/api/hub/file`, which follows redirects manually (`redirect: "manual"`) so a `github.com → attacker` redirect can't cause SSRF. |
| `relayTargetAllowed(url)` / `isMetadataAddress(host)` / `metadataGuardedLookup(lookup)` | The AI relay may reach private addresses (a self-hosted model is the point) but never the cloud metadata service: `169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254` and the metadata hostnames. An IPv6 address that stands for an IPv4 one (mapped `::ffff:a9fe:a9fe`, compatible, NAT64) is unwrapped first. `relayTargetAllowed` judges the URL; `metadataGuardedLookup` wraps `dns.lookup` on the relay's upstream socket, so a **name** that resolves to a metadata address is refused too (`400`). |

Additional hardening in the stores: content hashes for basemaps/flags are **always computed server-side** — trusting a client hash would let a caller poison the dedup index so a later genuine upload is silently discarded (`server/basemapStore.js`, `server/flagStore.js`). A saved flag must be a base64 image data URL of a known type (png, jpeg, webp, gif, svg) of at most 2 MB decoded; `server/flagValidation.js` holds that rule and the web build's flag store imports it, so the website and the Android app keep and refuse the same flags as the desktop. Deletes are **soft** (`moveDirectoryToTrash`, `server/libraryStore.js`) with a Windows-specific retry-then-copy fallback for locked directories.

---

## Portability: the writable data dir

`server/dataDir.js` is the whole portability story:

```js
export const DATA_DIR = process.env.OH_DATA_DIR
  ? path.resolve(process.env.OH_DATA_DIR)
  : path.join(__dirname, "data");   // server/data
```

Every store imports this one constant, so a single env var relocates **all** writable state. A server run from a checkout (or Termux) leaves it unset and uses `server/data`. Any host whose app folder is **read-only** sets it to a writable path instead: the installed desktop app runs `server.js` inside Electron and points `OH_DATA_DIR` at `<userData>/server/data` and `OH_ASSETS_DIR` at `<userData>/public/assets`, where it downloads the map on first launch (`electron/main.cjs`), so a desktop install's saves — and its `.trash` — live there, not under `server/data`. `OH_ASSETS_DIR` is the same override for the stock PMTiles that `resolveRuntimeBinaryAsset` falls back to. (The Android app runs no server; its library is the web backend's IndexedDB — see [mobile.md](mobile.md).) Shipped-but-updatable content (`dist|public/lang/*.json`) stays under the app root and is *merged over* the writable `DATA_DIR/lang/*.json`, so runtime translations survive app updates that overwrite the app root, and an updated pack replaces the older AI translations of the strings it covers.

### Environment variables
| Var | Default | Effect |
| --- | --- | --- |
| `PORT` | `3000` | Listen port (`server/server.js`) |
| `OH_DATA_DIR` | `server/data` | Writable data root for every store (`server/dataDir.js`) |
| `OH_ASSETS_DIR` | `public/assets` | Where the stock PMTiles archives are read from (`PMTILES_ASSETS_DIR`, `server/libraryStore.js`) |
| `OH_ALLOW_CROSS_ORIGIN` | unset | `=1` disables the cross-origin-write guard (`server/server.js`) |
| `OH_ALLOW_REMOTE_RELAY` | unset | `=1` lets devices other than this computer use `/api/ai/relay`. Overrides and locks the Settings switch (`relayForLan` in `network-settings.json`) |
| `OH_ALLOWED_HOSTS` | unset | Comma-separated host names the server also answers to, beyond IP addresses, `localhost` and this computer's name (a name behind a reverse proxy, a LAN DNS name); `*` turns the Host guard off |
| `OH_IMPORT_COUNTER_URL` | `https://oh-import-counter.…workers.dev` | Import-telemetry counter Worker; empty string disables pings (`server/server.js`) |
| `OH_DISCORD_PRESENCE` | on | `=0` turns Discord Rich Presence off (`server/discordPresence.js`) |
| `OH_DISCORD_APP_ID` | the committed id | Another Discord application for the presence (testing) |

## Discord Rich Presence

Discord shows "Playing Open Historia" on a player's profile and beside their name in every server's member list when a program on the same computer tells the Discord app what is being played. This server is that program: it runs on the player's computer, in the desktop app (`electron/main.cjs` imports it) and in the downloadable local server. The website runs in a browser and the Android app on a phone, and neither can reach a Discord app.

- The page reports what is on screen: `src/runtime/discordPresence.js` `presenceFor` / `useDiscordPresence`, called from the HUD (`src/Game/GameUI/main.jsx`), posts `/api/presence` 1.5 s after the last change and again every minute (`PRESENCE_HEARTBEAT_MS`), sends `{ scene: "none" }` as a beacon on `pagehide`, and does none of it in a web build (`VITE_OH_WEB`). The server clears the activity when no report has arrived for 3 minutes (`PRESENCE_STALE_MS`), which covers a tab that closed without its goodbye: the downloadable local server keeps running after its tab is gone (the desktop app quits with its window, and Discord drops the activity with the connection).
- `server/discordPresence.js` speaks Discord's local protocol itself (no dependency): the socket `discord-ipc-0..9` (a named pipe on Windows; a Unix socket under `XDG_RUNTIME_DIR`/`TMPDIR`, including the Flatpak and Snap locations), frames of opcode + length + JSON, a handshake with the application id, then `SET_ACTIVITY`. It reconnects every 30 s while Discord is closed, sends at most one update per 4 s (Discord takes five in twenty seconds) and nothing that is already showing, and stops for good if Discord does not know the application id.
- What shows: "Playing Open Historia" (the Discord application's name), then "Playing as France", "Modern Day · 1 January 2016", the time since this game (scenario and country) was opened, or since the main menu was, restarted by each new game but not by a time skip, the logo (an image URL, so there is no art to upload) and a "Play Open Historia" button to openhistoria.com. "In the main menu" outside a game.
- The application: `DISCORD_APPLICATION_ID` in `server/discordPresence.js`, an application named "Open Historia" in Discord's developer portal (discord.com/developers/applications). The id (`1529270119916896326`) is public. With no id, the whole feature is inert.
- Off: a player turns it off in Discord (User Settings, Activity Privacy, "Share your detected activities with others"); a server owner with `OH_DISCORD_PRESENCE=0`.

Related sibling pages: [World state](world-state.md) · [Map editor](map-editor.md) · [Scenario hub](runtime-services.md).
