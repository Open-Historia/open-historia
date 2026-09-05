# Runtime Services

The `src/runtime/` folder holds the framework-light services that sit between the server API and the React UI: the library/scenario/game catalog stores, the AI-powered UI translator and its language setting, the country-name resolver, and the small tag/label/flag/map-setting helpers. Most of these are plain modules with module-scope state plus a `useSyncExternalStore`/`useState` React hook, deliberately kept free of OpenLayers/heavy deps so the **editor**, the **game**, and the **server** can all import the same rules. This page maps each service, its exported API, and — most importantly — how data flows in from `/api/*` and back out to the components.

Related pages: [World state](world-state.md) · [Game state](game-state.md) · [Assets](assets.md) · [AI system](ai-system.md)

---

## Module map

| Service | File | Owns | Consumed by |
|---|---|---|---|
| Library store | `src/runtime/library.js` | games + scenarios + active-game catalog, country-name overrides | `src/App.jsx`, `src/Game/GameUI/libraryBar.jsx`, `scenarios.jsx` |
| Scenario store | `src/runtime/scenarios.js` | scenario-only catalog (parallel, editor/standalone) | editor / scenario-picker contexts |
| Country-name resolver | `src/runtime/assets.js` (+ `polityNames.js`) | code→display-name plumbing, runtime asset endpoints/token | every map/name renderer |
| Language setting | `src/runtime/i18n.js` | UI language choice, `LANGUAGES`, RTL, `languageDirective` | Settings UI, `translator.js`, `callAI` |
| Translator | `src/runtime/translator.js` | pre-translation pass + live DOM translation cache | `src/main.jsx` (boot), map labels |
| Country tags | `src/runtime/countryTags.js` | tag normalization + author-vs-live resolution | editor, game, server, `promptContext.js` |
| Country labels | `src/runtime/countryLabels.js` | map country-label GeoJSON (curved + point) | `src/Game/Map/Nations.jsx` |
| Community flags | `src/runtime/communityFlags.js` | hub-hosted shared flags & flag packs | `src/Editor/FlagPicker.jsx` |
| Map settings | `src/runtime/mapSettings.js` | localStorage map/AI toggles | map + settings components |
| Diagnostics log | `src/runtime/debugLog.js` | rolling event log for bug reports, secret redaction, the on/off + detailed settings | `src/main.jsx` (boot), Settings → Diagnostics, library/assets/time/actions/settings/gameplay hooks |

---

## Library store — `src/runtime/library.js`

The single source of truth for the player's **games**, **scenarios**, and which of each is active. It holds one module-scope object (`libraryState`), exposes it through a `useSyncExternalStore` subscription, and wraps every catalog mutation as an `/api/*` call that refreshes the store afterwards.

### State shape (`INITIAL_LIBRARY_STATE`, `library.js:13`)

| Field | Type | Meaning |
|---|---|---|
| `activeGame` | object \| null | The active game record (resolved from `games` by `activeGameId`) |
| `activeGameId` | string \| null | Server-chosen active game, falls back to `games[0].id` |
| `baseSaves` | array | Base-save descriptors returned by the catalog |
| `countryNames` | object | Catalog-level country-name map (`{}` when absent) |
| `error` | string \| null | Last catalog error message |
| `games` | array | All game records |
| `loaded` | boolean | Catalog has completed at least once |
| `loading` | boolean | A catalog fetch is in flight |
| `runtimeScenario` | object \| null | The scenario whose assets are currently live (drives overrides + token) |
| `scenarios` | array | All scenario records |
| `selectedScenario` / `selectedScenarioId` | object/string \| null | The scenario selected in the library UI |
| `token` | string | Cache-busting asset token (`catalog.token` → `activeGame.cacheToken` → `""`) |

`runtimeScenario` resolution (`library.js:119`) is layered: the scenario matching `catalog.runtimeScenario.id`, else the raw `catalog.runtimeScenario`, else the active game's `scenarioId` scenario. This is the scenario whose `countryNameOverrides` and `cacheToken` become live.

### Store API

| Export | Kind | Purpose |
|---|---|---|
| `getLibraryState()` | getter | Current `libraryState` snapshot |
| `subscribeToLibraryState(listener)` | subscribe | Adds/removes a listener; returns unsubscribe |
| `useLibraryState()` | React hook | `useSyncExternalStore` binding — components re-render on any state change |
| `refreshLibraryCatalog({ force })` | async | GET `/api/library`, apply into state; de-dupes concurrent calls via `libraryCatalogRequest` unless `force` |
| `ensureLibraryCatalog()` | async | Refresh only if not already `loaded` |

`emitLibraryState()` fans out to the `listeners` Set; `setLibraryState()` is the choke point that (1) stores the new object, (2) calls `syncLibraryRuntime()`, then (3) emits — so the country-name resolver and asset token are **always re-wired before** React sees the new state.

### Catalog mutations (each refreshes the store)

All go through `requestJson()` (thin `fetch` + `parseApiResponse`, which throws `payload.error || payload.message || "HTTP <status>"`). Two patterns: functions that receive a fresh `catalog` in the response apply it directly via `applyLibraryCatalog`; the rest call `refreshLibraryCatalog({ force: true })` after mutating.

| Export | HTTP | Route | Notes |
|---|---|---|---|
| `loadScenarioDetails(id)` | GET | `/api/scenarios/:id` | Returns details, no state change |
| `createScenario(payload)` | POST | `/api/scenarios` | Then `enqueueContentStrings(payload)` + force refresh |
| `saveScenario(id, payload)` | PUT | `/api/scenarios/:id` | Same translate-on-save + force refresh |
| `selectScenario(id)` | PUT | `/api/scenarios/selected` | Body `{ scenarioId }`; applies returned catalog |
| `removeScenario(id)` | DELETE | `/api/scenarios/:id` | Applies returned catalog |
| `downloadScenarioJsonAsset(id, key)` | GET | `/api/scenarios/:id/assets/:key` | Returns `null` on 404/throw (missing = "use default") |
| `uploadScenarioAsset(id, key, file)` | PUT | `/api/scenarios/:id/assets/:key` | Raw body via `toUploadBuffer`; force refresh |
| `clearScenarioAsset(id, key)` | DELETE | `/api/scenarios/:id/assets/:key` | Force refresh |
| `exportScenarioBundle(id, mode="light")` | GET | `/api/scenarios/:id/export?mode=` | Returns bundle JSON |
| `importScenarioBundle(bundle)` | POST | `/api/scenarios/import` | New local scenario; force refresh |
| `updateScenarioFromBundle(id, bundle)` | PUT | `/api/scenarios/:id/import` | Hub **Update** button — replaces content, **keeps the local id** so games keep working |
| `loadGameDetails(id)` | GET | `/api/games/:id` | Returns details |
| `createGame(payload)` | POST | `/api/games` | `enqueueContentStrings` + force refresh |
| `saveGame(id, payload)` | PUT | `/api/games/:id` | `enqueueContentStrings` + force refresh |
| `activateGame(id)` | PUT | `/api/games/active` | Body `{ gameId }`; applies returned catalog |
| `removeGame(id)` | DELETE | `/api/games/:id` | Applies returned catalog |
| `uploadGameAsset(id, key, file)` | PUT | `/api/games/:id/assets/:key` | Raw body; force refresh |
| `clearGameAsset(id, key)` | DELETE | `/api/games/:id/assets/:key` | Force refresh |

`toUploadBuffer()` (`library.js:235`) accepts `Blob`, `ArrayBuffer`, a typed-array view, or coerces anything else to a UTF-8 buffer, so callers can upload files or serialized JSON identically.

### Country-name override resolver (in this module)

`resolveCountryNameOverride(overrides, name, code)` (`library.js:41`) is the ordered lookup used to rename countries per-scenario. It reads `runtimeScenario.countryNameOverrides` and returns the first hit:

1. by **code** (uppercased via `normalizeLookupKey`) — e.g. `overrides["RUS"]`
2. by **exact name** — `overrides["Russia"]`
3. by **normalized (uppercased) name** — `overrides["RUSSIA"]`
4. otherwise the original `name`

Two exits into the shared asset layer:

- `syncLibraryRuntime()` (`library.js:68`) runs on every `setLibraryState` and once at module load (`library.js:388`). It pushes the token to `setRuntimeAssetEndpoints({ token })` and installs the resolver via `setCountryNameResolver((name, code) => resolveCountryNameOverride(runtimeScenario.countryNameOverrides, name, code))`. From then on every `resolveCountryDisplayName` call inside `assets.js`/`countryLabels.js`/`polityNames.js` honors the active scenario's renames.
- `resolveScenarioCountryName(name, code)` (`library.js:385`) is the direct synchronous export for callers that already have a `name`/`code` pair.

### Boot / data flow

`src/App.jsx` calls `ensureLibraryCatalog()` and reads `useLibraryState()` (only `activeGameId` in that file). On any library mutation the token changes → `setRuntimeAssetEndpoints` sweeps and rotates all runtime URLs (see [resolver plumbing](#country-name-resolver-plumbing--srcruntimeassetsjs)) → components subscribed to the store re-render → asset fetches now carry the new `?v=<token>`.

---

## Scenario store — `src/runtime/scenarios.js`

A **parallel, scenario-only** variant of the library store for contexts that have no concept of "games" (the editor / standalone scenario flows). Structurally it mirrors `library.js` — same `parseApiResponse`/`requestJson`/`toUploadBuffer`, same `resolveCountryNameOverride` (identical 3-step code→name→normalized lookup) — but its state centers on a single active scenario.

### State (`INITIAL_SCENARIO_STATE`, `scenarios.js:9`)

`activeScenario`, `activeScenarioId`, `baseSaves`, `error`, `loaded`, `loading`, `scenarios`, `token`. There is no `games`, `activeGame`, `countryNames`, `selectedScenario`, or `runtimeScenario`; the resolver and token both read from `activeScenario` instead.

### API differences vs. library store

| Export | HTTP | Route |
|---|---|---|
| `getScenarioState` / `subscribeToScenarioState` / `useScenarioState` | — | Store accessors (same pattern) |
| `refreshScenarioCatalog({force})` / `ensureScenarioCatalog()` | GET | `/api/scenarios` |
| `createScenario` / `saveScenario` | POST / PUT | `/api/scenarios`, `/api/scenarios/:id` (no `enqueueContentStrings` here) |
| `activateScenario(id)` | PUT | `/api/scenarios/active` (body `{ scenarioId }`) — cf. library's `selectScenario` → `/selected` |
| `removeScenario(id)` | DELETE | `/api/scenarios/:id` |
| `uploadScenarioAsset` / `clearScenarioAsset` | PUT / DELETE | `/api/scenarios/:id/assets/:key` |
| `resolveScenarioCountryName(name, code)` | — | Reads `activeScenario.countryNameOverrides` |

`syncScenarioRuntime()` (`scenarios.js:59`) does the same `setRuntimeAssetEndpoints` + `setCountryNameResolver` wiring as the library store, keyed on `activeScenario`. Only one of the two stores should be driving `assets.js` at a time (whichever build is mounted), since both call the same global setters.

---

## Country-name resolver plumbing — `src/runtime/assets.js`

Codes (`"RUS"`, `"KHAL"`) are the load-bearing identifiers in the data; the player must only ever see full names. The resolver is a single mutable function slot in `assets.js` that the library/scenario stores install into.

| Export (`assets.js`) | Line | Role |
|---|---|---|
| `setCountryNameResolver(resolver)` | `284` | Installs the active resolver (`(name, code) => string`); non-functions reset to identity |
| `resolveCountryDisplayName(name, code)` | `288` | The single call site used across the asset layer — delegates to the installed resolver |
| `setRuntimeAssetEndpoints({ token })` | `204` | Rebuilds every `JSON_URLS.*` and `PMTILES_ARCHIVES.*` with `?v=<token>`, and **sweeps stale caches** on token change |

Default resolver is identity (`countryNameResolver = (name) => name`, `assets.js:40`) until a store installs one. `loadCountryNames` (`assets.js:965`) and `loadRegionCatalog` decode the countries PMTiles z0 tile and run each raw `Country/NAME` through `resolveCountryDisplayName(name, code)`, so scenario renames flow into the country dropdowns and map labels without those modules knowing about scenarios.

**Token sweep (memory + correctness).** When the token changes, `setRuntimeAssetEndpoints` deletes the previous generation's entries from `jsonValueCache`, `jsonRequestCache`, `jsonLoadedUrls`, the PMTiles archive/header/directory caches, and clears the key-based `runtimeJsonValueCache`/`runtimeJsonRequestCache` — **before** rebuilding the URLs, because the old URL strings are the only handles to those entries. This prevents both the ~190 MB-per-switch GeoJSON leak and serving one scenario's bytes under another's cached PMTiles header. See [Assets](assets.md) for the full cache model.

### Sibling resolver — `src/runtime/polityNames.js`

Where the override resolver renames by scenario, `polityNames.js` resolves a **code → era-polity or base name** for single values, cached for sync access.

| Export | Purpose |
|---|---|
| `ensurePolityNames()` | Refreshes `nameByCode` if older than 15 s; merges `loadCountryNames()` with `world.polityOverrides` (era polity wins **only when it carries a name**) |
| `polityDisplayName(code)` | Sync lookup, falls back to the code until a refresh has run |
| `useCountryDisplayName(code)` | Hook: renders the code, then swaps to the resolved name after `ensurePolityNames()` |

---

## Language setting — `src/runtime/i18n.js`

Owns the UI-language *choice* and static catalog. The choice is stored on the **server** (shared by every device — desktop browser and the Android app that play through the same server) and mirrored to `localStorage["ui_language"]` so boot doesn't wait on a fetch. `"en"` (the authored language) means no translation happens at all.

| Export | Purpose |
|---|---|
| `DEFAULT_LANGUAGE` | `"en"` |
| `LANGUAGES` | 50-entry array of `{ code, name, native }` (top-50 most-spoken, English name + endonym) |
| `getLanguageOptions()` | Returns `LANGUAGES` |
| `languageDisplayName(code)` | English display name, falls back to the code |
| `getStoredLanguage()` | Reads localStorage; returns `DEFAULT_LANGUAGE` on miss/error |
| `setStoredLanguage(code)` | Writes localStorage **and** PUT `/api/ui-settings` `{ language }` (offline-tolerant) |
| `syncLanguageFromServer()` | GET `/api/ui-settings`; server wins; returns `true` if the local value changed (caller reloads) |
| `isRtlLanguage(code)` | Membership in `RTL_LANGUAGES` = `{ ar, he, fa, ur }` |
| `languageDirective()` | System-prompt fragment appended to every AI call so replies arrive natively in-language |

Storage rule: writing `en` (or empty) **removes** the key rather than storing it (`writeLocalLanguage`, `i18n.js:81`), so "English" is represented by absence. `languageDirective()` returns `""` for English; otherwise it instructs the model to write all natural-language text in the target language while keeping JSON keys/ISO codes/date formats intact — this is why AI output does not need re-translation (see [AI system](ai-system.md)).

---

## Translator — `src/runtime/translator.js`

Translates the running UI into the player's language using whichever AI provider is configured. Two layers:

1. **One-time pre-translation pass** per language (on boot / after a switch): gathers every string the game *could* show, translates up front behind a progress pill, caches in localStorage.
2. **A `MutationObserver`** that keeps applying the cache to new DOM synchronously (no English flash) and lazily translates the rare strings the pre-pass couldn't know.

### Lifecycle

| Export | Purpose |
|---|---|
| `startTranslator()` | Called once from `src/main.jsx:24`. Syncs language from server (reload if changed), returns early for English, sets `<html lang>` + RTL `direction`, loads localStorage cache + server pack, waits out the startup screen, then starts the observer and pre-translation pass |
| `stopTranslator()` | Disconnects the observer, clears timers, removes the progress pill |

Boot order inside `startTranslator` (`translator.js:587`): `syncLanguageFromServer()` (reload on change) → bail if `en` → set `lang`/`direction` → `loadCache()` → `loadServerPack()` → `whenStartupScreenGone()` (polls for `[data-startup-screen]`, 180 s cap) → activate observer + `scan()` → `collectCatalogStrings()` → show progress if >10 pending → `processQueue()`.

### Public lookups (for callers/data outside the DOM)

| Export | Purpose |
|---|---|
| `translateLabel(text)` | **Sync** best-effort translate for text drawn outside the DOM (map country labels). Returns cached translation, or the original while queuing the string + firing `i18n:updated` when it resolves |
| `enqueueStrings(strings)` | Proactively queue an array of strings (e.g. freshly-fetched hub posts); only uncached ones cost a call |
| `enqueueContentStrings(payload)` | Deep-walk a saved payload (≤6 deep) pulling human-readable fields (`CONTENT_TEXT_KEYS` + `aliases`), skipping `features`/`geometry`/`coordinates`, and enqueue them. Called by `library.js` on `createScenario/saveScenario/createGame/saveGame` so edited names/descriptions translate **and reach the server pack** the moment they're saved |

`countryLabels.js` calls `translateLabel(...)` so map labels follow the UI language; when new translations land, the `"i18n:updated"` event (debounced in `announceUpdate`) tells label builders to rebuild.

### Server language pack

- `loadServerPack()` — GET `/api/lang/:language`, merges shipped + community-generated translations into the local cache without overwriting.
- `syncEntriesToServer()` — debounced (2 s) PUT `/api/lang/:language` `{ entries }` pushing newly-generated translations so every device and future session reuses them instead of paying for the same AI call.

### Translation engine + config

`translateBatch()` (`translator.js:305`) late-imports `callAI` from `../Game/AI/main.jsx` and sends a strict JSON-array prompt (same length/order, keep numbers/emoji/placeholders, proper names unchanged). `processQueue()` runs up to `MAX_CONCURRENT_BATCHES` batches in parallel, writes results into both `cache` and `unsyncedEntries`, and backs off on repeated failure.

| Constant | Value | Meaning |
|---|---|---|
| `CACHE_PREFIX` | `i18n_cache_` | localStorage key prefix (`+language`) |
| `CACHE_LIMIT` | `8000` | Max cached entries persisted (most-recent kept) |
| `BATCH_SIZE` | `60` | Strings per AI call |
| `MAX_CONCURRENT_BATCHES` | `3` | Parallel batches per pump |
| `SCAN_DEBOUNCE_MS` | `350` | Debounce before a DOM scan |
| `MAX_CONSECUTIVE_FAILURES` | `3` | Failures before a 60 s cooldown |
| `TRANSLATED_ATTRIBUTES` | `placeholder, title, aria-label` | Attributes also translated |
| `SKIP_SELECTOR` | `script, style, noscript, input, textarea, [contenteditable], [data-no-translate]` | Never-translated nodes; opt out with `data-no-translate` |

The `nodeSources` WeakMap records the English source last seen at each text node, so re-renders that restore English are re-translated and the translator recognizes its own writes.

---

## Country tags — `src/runtime/countryTags.js`

Short traits describing what a country *is* (`"socialist"`, `"authoritarian"`, `"anti-nato"`). The map-maker sets starting tags in the editor (`tags.json` on the scenario); the AI reads them as context and rewrites them into `world.countryTags`. This module owns the two rules both halves must agree on — normalization and which source wins — and **imports nothing** so editor, game, and server share it.

| Export | Purpose |
|---|---|
| `MAX_TAGS` = 8 / `MAX_TAG_LEN` = 32 | Caps |
| `TAG_SUGGESTIONS` | 30 suggested spellings (open vocabulary — suggestions only, so the model converges on one spelling) |
| `normalizeTagList(list, {maxTags, maxLen})` | Trim, collapse whitespace, cap length, drop blanks/non-strings, dedupe case-insensitively, cap count |
| `resolveCountryTags(baseTags, world, country)` | Tags in force **now** for one country: the AI's live list if it ever set one, else the author's list — **not a merge** |
| `resolveAllCountryTags(baseTags, world)` | Same rule across every country that has tags; builds the world summary the model reads |

**Keying gotcha (documented in-file):** tags are keyed by the country's **name, verbatim** — no uppercasing. The code used to uppercase (fine when owners were uppercase GADM codes); with names it looked up `baseTags["RUSSIA"]` against a `tags.json` keyed `"Russia"` and silently dropped every author tag. `resolveAllCountryTags` emits keys verbatim for the same reason (the model's world summary must match `polityOverrides` casing). Consumed by `src/Game/AI/promptContext.js`.

---

## Country labels — `src/runtime/countryLabels.js`

Builds the GeoJSON that draws country **names** on the map (not the DOM). Reads the countries PMTiles z0 tile, decodes it, and produces two FeatureCollections: `curvedLabelData` (per-glyph point features following a computed spine for long/curved countries) and `pointLabelData` (a single centroid point for the rest). Consumed by `src/Game/Map/Nations.jsx`.

| Export | Purpose |
|---|---|
| `loadCountryLabelCollections({ force, ownedCodes })` | Main entry: returns `{ curvedLabelData, pointLabelData }`, memoized + persisted |
| `warmCountryLabelCollections(options)` | Preload helper returning `{ kind:"json", size, url }` for the warm-cache report |

### How it connects

- **Names** run through `translateLabel(resolveCountryDisplayName(rawName, code))` (`countryLabels.js:499`) — so labels honor both the scenario country-name overrides *and* the UI language.
- **`ownedCodes`** (a `Set`): when non-empty, countries owning no territory in the scenario are skipped, so a nonexistent-era nation doesn't float its modern name over unclaimed land. A distinct owner set caches separately (owner-hash suffix on the cache key).
- **Cache key** (`computeCountryLabelCacheKey`, `countryLabels.js:461`) folds tile-byte FNV hash + byte length + archive URL + **`getStoredLanguage()`**, so caches never leak across UI languages. Persisted via `writeRuntimeJson` / read via `readRuntimeJson` (see [Assets](assets.md)). Cache version is `country-labels-v3` (bumped to v3 when glyph `lat` was added for the globe text-size fix, issue #6).
- **Empty-result guard** (`countryLabels.js:642`): an empty build is treated as a degraded z0 read — served once, never cached — so a transient miss can't poison every future boot.

Geometry helpers (`getCentroid`, `getPrincipalAxisAngle`, `buildCurvedLabelPath`, `buildCurvedLabelGlyphFeatures`, `tileToLngLat`, …) convert tile coordinates to lng/lat and decide curved-vs-point; each glyph carries its own `lat` so `Nations.jsx` can correct globe-projection text inflation at high latitude.

---

## Community flags — `src/runtime/communityFlags.js`

Reads flags shared by other players **straight from the hub repo's GitHub Issues** — the Issues API query *is* the index (no index file, no CI); a post is live the moment its author submits. Deliberately mirrors `communityBasemaps.js` and stays free of React/OpenLayers deps so the editor (`src/Editor/FlagPicker.jsx`) and game can both use it.

| Constant | Value |
|---|---|
| Hub repo | `Open-Historia/Open-historia-scenarios` |
| `HUB_API_FLAGS` | issues `?state=open&labels=flag&per_page=100` (label must exist in the repo or GitHub drops it) |
| `HUB_API_SCENARIOS` | issues `?state=open&labels=scenario` — scanned for scenario posts carrying flags |
| `CACHE_TTL_MS` | 5 min in-memory cache |

| Export | Purpose |
|---|---|
| `fetchCommunityFlags({ force })` | Fetches both endpoints (scenarios best-effort), parses, filters to installable, caches. Returns `[...dedicatedFlagPosts, ...scenarioFlagPacks]` |
| `flagPostInstallable(post)` | True if a payload can be extracted: `imageUrl` for a flag post, `packUrl` for a scenario pack |
| `loadCommunityFlagDataUrl(post)` | Downloads a flag image **through the hub proxy** (`/api/hub/file?url=`, since GitHub attachments send no CORS) and returns a chunked base64 `data:` URL |
| `loadCommunityFlagPack(post)` | Downloads a scenario bundle via the proxy, finds `scenario.json` (zip or bare JSON), returns custom `{ code, dataUrl }` flags from `assets.flags` (flagcdn/built-in URLs skipped) |
| `communityFlagsHubUrl()` | Link to the filtered hub issue list |
| `openFlagPublishForm({name, author, code})` | Opens the prefilled `flag.yml` issue form in a new tab (image left for the user to drag in) |

**Two post shapes.** `parseFlagPost` turns a dedicated `[Flag]` issue into a card (`id, title, author, avatarUrl, url, createdAt, official, upvotes, code, imageUrl`); `parseScenarioAsFlagPack` turns a `scenario` issue that stamped a **`Flags-Count:` tag** into one installable pack card (`fromScenario: true, flagCount, packUrl`), so flags shared inside a scenario surface here without downloading every bundle. Regex contracts: `COVER_IMAGE_PATTERN` (inline markdown/`<img>`), `FILE_LINK_PATTERN` (GitHub file/user-attachment/raw links), `CODE_PATTERN` (`Flag-Code:`), `FLAGS_COUNT_PATTERN` (`Flags-Count:`). `OFFICIAL_ASSOCIATIONS` = `OWNER/MEMBER/COLLABORATOR` sets the `official` badge. `.zip` bundles are read with `unzipBundle`/`looksLikeZip` from `bundleZip.js`.

---

## Map settings — `src/runtime/mapSettings.js`

Tiny localStorage-backed boolean toggles read reactively instead of threaded as props through `GameUI`/`main.jsx`. Same getter/setter pattern as `src/Game/AI/providerConfig.js`; the hook sits beside the data it subscribes to, mirroring `useCountryDisplayName`.

| `MAP_SETTING_KEYS` key | localStorage key | Effect when ON |
|---|---|---|
| `hideCountryLabels` | `map_hide_country_labels` | Hide country name labels |
| `disableIdleRotation` | `map_disable_idle_rotation` | Stop the idle globe spin |
| `disableEventCamera` | `map_disable_event_camera` | Suppress event camera moves |
| `limitAiGeneration` | `ai_limit_generation` | (Not a map setting) timeline-jump generation gets a 5-min deadline → canned-event fallback; OFF (the default) waits as long as the model needs |

| Export | Purpose |
|---|---|
| `getMapSetting(key)` | `localStorage.getItem(key) === "1"` |
| `setMapSetting(key, value)` | Writes `"1"`/`"0"`, logs the flip to the diagnostics log, and dispatches a `mapSettings:updated` window event |
| `useMapSetting(key)` | `useState` hook that re-reads on the `mapSettings:updated` event |

Values are stored as `"1"`/`"0"` strings (absent = off). The custom `mapSettings:updated` event is the cross-component sync mechanism — any `setMapSetting` call updates every `useMapSetting(key)` subscriber in the same document.

---

## Diagnostics log — `src/runtime/debugLog.js`

The log a player pastes into a bug report: **Settings → Diagnostics → Copy log / Save as file**. It answers the question the per-incident buttons cannot — *what sequence of things did they do?* — because the packaged desktop app binds no developer tools, so the console every failure was already being written to is unreachable to the people filing the reports.

Sits beside the two older, narrower affordances rather than replacing them: the advisor's "Copy for a bug report" (`GameUI/advisor.jsx`) and the timeline's "Copy debugging message" (`GameUI/time.jsx`) still describe **one** failed AI turn in full, including the raw model response, which this log deliberately does not carry.

### Two settings, both persisted

Both live in `localStorage`, which is what makes them survive closing the app: the desktop build keeps its Chromium profile between runs, so a choice holds across restarts, save switches and new campaigns. Neither is stored in a save file — the choice is about this installation, not this campaign, and a save copied between machines must not carry someone else's logging preference. **Absent means default, and the two defaults differ, so the keys read differently on purpose.**

| Setting | Key | Default | Off/on means |
|---|---|---|---|
| Logging | `oh_debug_log_enabled` | **ON** (absent or anything but `"0"`) | Off: nothing is recorded, and the stored log is deleted — see below |
| Detailed logging | `oh_debug_log_verbose` | **off** (absent or anything but `"1"`) | On: the `{ verbose: true }` entries are kept, and every entry keeps far more of itself |

Both are cached in module state rather than read per entry — `logDebugEvent` runs in the hot path of a turn and of every console call the game makes — and primed at module load, so the very first entry (logged from `src/main.jsx` before anything mounts) already obeys a saved choice. `setDebugLogEnabled` / `setDebugLogVerbose` write through the cache.

**Turning logging off also clears what was collected**, storage included, and the toggle's helper text says so. A player switching this off is saying they would rather the game did not keep this; leaving the last session's log in storage would ignore half of that, and it would go on occupying the storage budget for a feature they just declined. `persistNow` refuses to write while disabled, so a stray flush (pagehide, the error boundary) cannot put the key back afterwards.

### What is recorded

Two sources:

1. **Explicit `logDebugEvent()` calls** at the milestones a report needs. Every one is listed under "Hook sites" below.
2. **Everything the game already logged.** `installDebugLogCapture()` wraps `console.warn`/`console.error` (plus `console.log`/`console.info`, verbose-only) and listens for `error` / `unhandledrejection` on `window`. The originals are still called, so a developer with DevTools open sees exactly what they saw before.

Detailed mode is expressed at the call site as a fourth argument — `logDebugEvent(cat, msg, detail, { verbose: true })` — and gated at the top of `logDebugEvent` rather than by an `if` around each call, so a hook cannot drift out of sync with the setting. It also raises what each entry keeps: `MAX_DETAIL_CHARS` 600 → 6000, and error stacks 1 frame → 8.

### What is never recorded

**API keys.** `redactSecrets()` runs over the category, message and detail of every entry **on the way in**, so a key is never even held in the buffer, and again over anything pushed into the context. Two passes:

* **Literal.** Every value in `localStorage` under a key ending `_api_key` / `_token` / `_secret` (i.e. everything `Game/AI/providerConfig.js` stores), matched by suffix so a provider added later is covered without anyone remembering to come back. Values under 8 characters are skipped — they are not keys, and treating them as such would redact half the log. This is the only pass that can catch a self-hosted gateway key, which may be any string at all.
* **Pattern.** `sk-…`, `sk-ant-…`, `AIza…`, `hf_`/`gsk_`/`xai-`, `Authorization: Bearer|Basic …`, `api_key`/`token`/`password` in a dumped object or query string, URL userinfo (`http://user:pass@host` → the host survives, the credentials do not), and JWTs.

Provider and model **names** are in the header on purpose — the model is the most useful line in an AI bug report and is not a secret. Campaign text is kept to titles, ids and counts: a log a player will paste in public beats a complete one they will not.

### Buffer and persistence

| Constant | Value | Why |
|---|---|---|
| `MAX_LOG_CHARS` | 192 KB | **The real governor.** localStorage is a ~5 MB budget shared with the translator cache; the log is the least important thing in it |
| `MAX_ENTRIES` / `MAX_ENTRIES_VERBOSE` | 400 / 2500 | A ceiling on a quiet session. Detailed mode raises it because its entries are more numerous; it does **not** raise the size budget, so a detailed log simply holds less history in the same space |
| `MAX_DETAIL_CHARS` / `_VERBOSE` | 600 / 6000 | A truncated detail keeps `… (+N chars)`. A clipped stack trace or model response is usually worth nothing, which is what detailed mode is for |
| `STACK_FRAMES` / `_VERBOSE` | 1 / 8 | One frame is where it threw; the rest is React internals nine times out of ten |
| `MAX_STORED_CHARS` | 224 KB | Backstop on the *serialized* form only, for when the JSON scaffolding costs more than `entryCost` estimated |
| `COALESCE_WINDOW` / `COALESCE_MS` | 25 entries / 60 s | Repeat collapsing (below) |
| `PERSIST_DEBOUNCE_MS` | 800 | A busy turn logs a dozen entries a second; a synchronous write per entry is a jank source |

**Trimming (`trimToBudget`).** The buffer is bounded by **size**, not only by entry count, and drops its **oldest** entries until it is inside both ceilings — oldest-first because a report is read for what led up to the problem and the problem is at the end. `usedChars` is maintained incrementally (`entryCost` = message + detail + category + gameDate + ~120 chars of JSON scaffolding) rather than recomputed, because trimming runs on every entry and re-measuring a 2500-entry buffer each time is how a bad network becomes a frame-rate problem. Entries go one at a time, so a full log keeps as much history as it can hold. `droppedEntries` counts what went, and the report says so — "the log starts at 11:42 with no explanation" and "the log dropped 900 entries to stay under the cap" are very different things to a reader.

**Repeat collapsing.** An entry identical (category + message + detail) to one in the last `COALESCE_WINDOW` entries and within `COALESCE_MS` bumps that entry's `repeat` counter instead of appending; the report renders `(×48, last 10:50:58)`. Without this a dead basemap host or content node evicts the whole campaign from the buffer — measured at ~100 entries in six seconds with the network down. It scans a window rather than only the previous entry because storms interleave (maplibre's `AJAXError` alternating with our own fetch rejection), which consecutive-only matching would collapse neither of.

**Persistence.** Mirrored to `localStorage` under `oh_debug_log_v1`, restored on the next boot behind a `— page reloaded —` separator, and flushed on `pagehide` and from the error boundary before its Reload button. The crash that killed the page is the whole point, and an in-memory buffer dies with it. Every storage access is wrapped: quota exceeded, private mode and disabled storage all degrade to an in-memory-only log rather than breaking the game.

### API

| Export | Purpose |
|---|---|
| `installDebugLogCapture()` | Once, at boot (`src/main.jsx`), before anything else runs. Restores the previous session (unless logging is off), wraps the console, binds the global error hooks |
| `logDebugEvent(category, message, detail?, { verbose }?)` | The only way in. `detail` is flattened (Errors keep name + message + stack frames; objects are JSON; circular does not throw) and truncated. `verbose: true` marks an entry as detailed-mode-only |
| `isDebugLogEnabled()` / `setDebugLogEnabled(bool)` | The on/off switch. Turning it off clears the buffer and the stored copy |
| `isDebugLogVerbose()` / `setDebugLogVerbose(bool)` | Detailed mode. Turning it off re-trims to the smaller ceiling |
| `getDebugLogBytes()` / `getDebugLogLimitBytes()` / `getDebugLogDroppedCount()` / `formatLogSize(chars)` | Size reporting for the settings panel and the report header. `formatLogSize` renders anything under a kilobyte as `<1 KB`, never `0 KB` — beside a live entry count that reads like a broken counter |
| `setDebugLogContext(patch)` | Merges campaign/build context for the report header. Redacted like everything else |
| `buildDebugLogReport()` | The plain-text block the player copies — header, then entries oldest-first. Text, not JSON: it is going into a Discord message or a GitHub issue |
| `debugLogFilename()` | `open-historia-log-<ISO stamp>.txt` |
| `clearDebugLog({ silent })` | Empties it. The player path leaves a "cleared" note so a gap never reads as lost entries; `silent` is for the tests |
| `flushDebugLog()` | Persist now, skipping the debounce |
| `getDebugLogEntries()` / `getDebugLogSize()` / `getDebugLogContext()` | Reads |
| `subscribeToDebugLog(listener)` | Returns an unsubscribe. Drives the entry count in the settings panel |
| `redactSecrets(text)` | Exported for the tests; called internally on every entry |

### Hook sites

Always recorded:

| Where | Category | Records |
|---|---|---|
| `src/main.jsx` | `app` | Boot, build channel, browser language |
| `src/runtime/library.js` | `game`, `api` | Active-game switches (and the header's campaign block), game creation, deletion, and **every** failed `/api/library`, `/api/games`, `/api/scenarios` call — the path and the server's message, never the request body |
| `src/runtime/assets.js` | `save` | **Failed** `writeJson` — world, game, actions, events and chats all persist through there, so a failure is the campaign not reaching disk. It previously threw into callers that only surface it as a toast |
| `src/Game/GameUI/time.jsx` | `turn` | Jump/auto-jump start, finish (with elapsed seconds, event count, source), **fallback with its reason**, cancel, undo; keeps the in-game date and round in the context |
| `src/Game/GameUI/actions.jsx` | `action` | Orders queued (manual and from suggestions) and removed |
| `src/runtime/mapSettings.js` | `setting` | Every map/AI/experimental toggle, by its UI label |
| `src/Game/AI/providerConfig.js` | `setting` | Provider switches, reasoning toggle; syncs provider + model into the header |
| `src/runtime/ErrorBoundary.jsx` | `crash` | Render crashes with the component stack, then flushes |
| `window` / `console` | `crash`, `error`, `warn` | Uncaught errors, unhandled rejections, and everything the game already logged |

Detailed mode only (`{ verbose: true }`):

| Where | Category | Records |
|---|---|---|
| `src/Game/AI/gameplay.js` | `ai` | Every task: start (prompt/user-message sizes, tool name, timeout), each attempt's answer (size, tool-call or prose, elapsed), **each rejection with its validation error and raw response — including retries that then succeeded**, which attempt won, and salvage |
| `src/runtime/library.js` | `api` | The calls that *worked*: method, path, status. The duration goes in only past 1 s — the game polls every 5 s, and a per-call millisecond figure would make each poll unique and defeat the repeat collapsing |
| `src/runtime/assets.js` | `save` | Every successful save with its byte size. Growth is the point: a `world.json` climbing past a megabyte makes every turn slower and is invisible in any single entry |
| `src/Game/GameUI/time.jsx` | `turn`, `ui` | Per-turn world changes (event titles plus counts of region transfers, polity changes, unit/marker/project ops, chats, and the unit and project totals) — this is what exposes a turn that narrates a conquest while moving no borders. Plus timeline panel navigation |
| `src/Game/GameUI/main.jsx` | `ui` | Which panels are open, as one effect over every panel flag rather than a call per handler — these panels are opened from a dozen places and per-handler calls would miss most of them |
| `console` | `log` | `console.log` / `console.info`, the game's routine chatter — noise in a normal report, running commentary in a detailed one |

Tests: `src/runtime/debugLog.test.js` (44 cases — redaction, buffer, coalescing, report, both switches and their persistence, and the size budget).
