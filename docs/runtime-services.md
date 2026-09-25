# Runtime Services

The `src/runtime/` folder holds the framework-light services that sit between the server API and the React UI: the library/scenario/game catalog stores, the AI-powered UI translator and its language setting, the country-name resolver, and the small tag/label/flag/map-setting helpers. Most of these are plain modules with module-scope state plus a `useSyncExternalStore`/`useState` React hook, deliberately kept free of OpenLayers/heavy deps so the **editor**, the **game**, and the **server** can all import the same rules. This page maps each service, its exported API, and — most importantly — how data flows in from `/api/*` and back out to the components.

Related pages: [World state](world-state.md) · [Game state](world-state.md) · [Assets](assets-and-data.md) · [AI system](ai-overview.md)

---

## Module map

| Service | File | Owns | Consumed by |
|---|---|---|---|
| Library store | `src/runtime/library.js` | games + scenarios + active-game catalog, country-name overrides | `src/App.jsx`, `src/Game/GameUI/libraryBar.jsx`, `scenarios.jsx` |
| Scenario store | `src/runtime/scenarios.js` | scenario-only catalog (parallel, editor/standalone) | editor / scenario-picker contexts |
| Country-name resolver | `src/runtime/assets.js` (+ `polityNames.js`) | code→display-name plumbing, runtime asset endpoints/token | every map/name renderer |
| Language setting | `src/runtime/i18n.js` | UI language choice, `LANGUAGES`, RTL, `languageDirective` | Settings UI, `translator.js`, `callAI` |
| Translator | `src/runtime/translator.js` (+ `phraseBook.js`, `promptTranslations.js`) | shipped packs applied to the live DOM; content translated by the AI | `src/main.jsx` (boot), map labels, content writers |
| Country tags | `src/runtime/countryTags.js` | tag normalization + author-vs-live resolution | editor, game, server, `promptContext.js` |
| Country labels | `src/runtime/countryLabels.js` | map country-label GeoJSON (curved + point) | `src/Game/Map/Nations.jsx` |
| Community flags | `src/runtime/communityFlags.js` | hub-hosted shared flags & flag packs | `src/Editor/FlagPicker.jsx` |
| Map settings | `src/runtime/mapSettings.js` | localStorage map/AI toggles | map + settings components |
| Diagnostics log | `src/runtime/debugLog.js` | rolling event log for bug reports, the Logging file (Desktop log merged in), secret redaction, the on/off + detailed settings | `src/main.jsx` (boot), Settings → Diagnostics, library/assets/time/actions/settings/gameplay hooks |
| Desktop log | `server/logStore.js` (+ `server/logRedaction.js`) | the desktop app's and server's own entries, on disk; read back into the Logging file | `server/server.js` (`GET`/`DELETE /api/log`), `electron/main.cjs` |

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

**Token sweep (memory + correctness).** When the token changes, `setRuntimeAssetEndpoints` deletes the previous generation's entries from `jsonValueCache`, `jsonRequestCache`, `jsonLoadedUrls`, the PMTiles archive/header/directory caches, and clears the key-based `runtimeJsonValueCache`/`runtimeJsonRequestCache` — **before** rebuilding the URLs, because the old URL strings are the only handles to those entries. This prevents both the ~190 MB-per-switch GeoJSON leak and serving one scenario's bytes under another's cached PMTiles header. See [Assets](assets-and-data.md) for the full cache model.

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

Storage rule: writing `en` (or empty) **removes** the key rather than storing it (`writeLocalLanguage`, `i18n.js:81`), so "English" is represented by absence. `languageDirective()` returns `""` for English; otherwise it instructs the model to write all natural-language text in the target language while keeping JSON keys/ISO codes/date formats intact — this is why AI output does not need re-translation (see [AI system](ai-overview.md)).

---

## Translator — `src/runtime/translator.js`

Puts the running game into the player's language. The full design (the three kinds of text, the packs, patterns and runs, content, the prompts, regenerating the packs) is in **[Languages & Translation](i18n.md)**. In short:

1. **The interface** comes from the shipped pack (`public/lang/<code>.json`) in the 22 languages that have one (`SHIPPED_PACK_LANGUAGES`), applied to the DOM by a `MutationObserver` as it renders: exact strings, `{{slot}}` patterns and runs of text nodes (`phraseBook.js`). It never costs an AI request there.
2. **Content** (what a scenario's author or a player made) is gathered up front, at boot and on every switch of save, and translated by the AI in a few big requests, then saved to the server's pack.
3. In a language **without** a pack, the interface goes through the AI as well, as content does.

### Lifecycle

| Export | Purpose |
|---|---|
| `startTranslator()` | Called once from `src/main.jsx:24`. Syncs language from server (reload if changed), returns early for English, sets `<html lang>` + RTL `direction`, loads localStorage cache + server pack, waits out the startup screen, then starts the observer and pre-translation pass |
| `stopTranslator()` | Disconnects the observer, clears timers, removes the progress pill |

Boot order inside `startTranslator`: `syncLanguageFromServer()` (reload on change) → bail if `en` → `loadPromptTranslations()` (pack languages) → set `lang`/`direction` → `loadCache()` → `loadServerPack()` → `whenStartupScreenGone()` (polls for `[data-startup-screen]`, 180 s cap) → activate observer + `scan()` → `collectContentStrings()` (again on `oh:active-game-changed`) → show progress if >10 pending → `processQueue()`.

### Public lookups (for callers/data outside the DOM)

| Export | Purpose |
|---|---|
| `translateLabel(text)` | **Sync** best-effort translate for text drawn outside the DOM (map country labels). Returns the known translation, or the original while queuing the name as content + firing `i18n:updated` when it resolves |
| `enqueueStrings(strings)` | Proactively queue content (e.g. freshly-fetched hub posts); only unknown strings cost a call |
| `enqueueEventStrings(events)` | An event log as it is written: queues only the scenario's own events (`source` `"scenario"`); the AI's are written in the player's language |
| `enqueueContentStrings(payload)` | Deep-walk a saved payload (≤6 deep) pulling human-readable fields (`CONTENT_TEXT_KEYS` + `aliases`), skipping `features`/`geometry`/`coordinates`, and enqueue them. Called by `library.js` on `createScenario/saveScenario/createGame/saveGame` so edited names/descriptions translate **and reach the server pack** the moment they're saved |

`countryLabels.js` calls `translateLabel(...)` so map labels follow the UI language; when new translations land, the `"i18n:updated"` event (debounced in `announceUpdate`) tells label builders to rebuild.

### Server language pack

- `loadServerPack()` — GET `/api/lang/:language` (shipped over saved) laid over this device's cache, so a stale local translation never hides the pack's; what the device learned that the server lacks is sent to it again.
- `syncEntriesToServer()` — debounced (2 s) PUT `/api/lang/:language` `{ entries }` pushing newly-generated translations so every device and future session reuses them instead of paying for the same AI call.

### Translation engine + config

`translateBatch()` (`translator.js:305`) late-imports `callAI` from `../Game/AI/main.jsx` and sends a strict JSON-array prompt (same length/order, keep numbers/emoji/placeholders, proper names unchanged). `processQueue()` sends **one batch at a time** (`planTranslationBatch`), writes results into both `cache` and `unsyncedEntries`, and backs off on repeated failure. It used to send 60 strings × 3 batches in parallel, which made a first pass over a new language dozens of requests nobody pressed a button for — on a free key, where a few hundred a day is the whole allowance, and where three concurrent requests is also the surest way to trip the per-MINUTE limit. A batch is now up to 240 strings or 6,000 source characters, whichever comes first: a quarter of the requests for the same language, one request in flight. On a failure the size halves (down to `BATCH_MIN_STRINGS`) and recovers on the next success, so a model that cannot hold a big batch still finishes. Live check (`.lab/probes/live-translation-probe.mjs`, Gemini, Japanese — the worst case for output tokens): 240 strings, 9.3 KB in, a complete 240-entry array back in 9 s.

| Constant | Value | Meaning |
|---|---|---|
| `CACHE_PREFIX` | `i18n_v2_` | localStorage key prefix (`+language`): what the AI translated on this device and the server does not have yet. The pre-pack `i18n_cache_*` keys are removed on boot |
| `CACHE_LIMIT` | `8000` | Max cached entries persisted (most-recent kept) |
| `BATCH_MAX_STRINGS` | `240` | Strings per AI call, at most |
| `BATCH_MAX_CHARS` | `6000` | Source characters per call, at most (whichever ceiling binds first) |
| `BATCH_MIN_STRINGS` | `30` | What the batch halves down to after a failure, recovering on the next success |
| `SCAN_DEBOUNCE_MS` | `350` | Debounce before a DOM scan |
| `MAX_CONSECUTIVE_FAILURES` | `3` | Failures before a 60 s cooldown |
| `TRANSLATED_ATTRIBUTES` | `placeholder, title, aria-label, aria-description, alt` | Attributes also translated (and observed as they change) |
| `SKIP_SELECTOR` | `script, style, noscript, input, textarea, [contenteditable], [data-no-translate]` | Never-translated nodes; opt out with `data-no-translate` |

The `nodeRecords` and `attributeRecords` WeakMaps record, per text node and attribute, the English last seen there and what the translator wrote over it, so re-renders that bring new English are translated again and the translator recognizes its own writes, runs of text nodes included.

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
- **Cache key** (`computeCountryLabelCacheKey`, `countryLabels.js:461`) folds tile-byte FNV hash + byte length + archive URL + **`getStoredLanguage()`**, so caches never leak across UI languages. Persisted via `writeRuntimeJson` / read via `readRuntimeJson` (see [Assets](assets-and-data.md)). Cache version is `country-labels-v3` (bumped to v3 when glyph `lat` was added for the globe text-size fix, issue #6).
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

The log a player sends with a bug report: **Settings → Diagnostics → Copy log / Save as file**. It answers the question the per-incident buttons cannot — *what sequence of things did they do?* — because the packaged desktop app binds no developer tools, so the console every failure was already being written to is unreachable to the people filing the reports.

The per-incident buttons — beside the timeline's fallback warning (`GameUI/time.jsx`), the advisor's error bubble and its board-update warning (`GameUI/advisor.jsx`) — save **this log** as a file: **💾 Save logging file** (`runtime/saveDebugLog.js`). They used to copy only the one failure, and that paste was what reached Discord, without the log around it. The failure's own details — for a fallback the reason, the requested range, the queued actions, and the raw model response the log's entries are too short to hold — go in a `-- Reported problem --` block between the header and the entries, passed as `buildLoggingFile({ incident })`. It is added when the file is built, not logged as an entry, so it is never clipped, never rolled off by the size cap, and still there with logging off. Fields the header already states (provider, model, polity, difficulty, round, game date) are dropped when they match it and kept when they differ.

Two fallbacks. **With logging off** the buttons go back to copying the failure alone under their old labels ("Copy debugging message", "Copy for a bug report"), with the header's context lines added (`buildIncidentReport`), and switch back live if logging is turned on. **In the Android app**, whose WebView cannot save a file, the full log is copied to the clipboard instead and the button says so; Settings' Save as file does the same.

### One log, one file: the Desktop log merged in

On desktop, the app's Electron process and its local server see things the page never can — a launch that failed before the page existed, an update that did not take, a server error — and they cannot reach the page's storage. So they write their own entries to the **Desktop log** (`server/logStore.js`, below), and the **Logging file** merges those entries into the page's by time. The player sends one file; each entry is stored **once**, by whoever saw it, in the place that writer can reach. The page never writes to the Desktop log.

Every way out goes through `buildLoggingFile({ incident })`: Settings' Copy and Save, View log, and every failure button.

* **Span.** Desktop entries from the page log's oldest remaining entry (else this page's start) until now. The page log survives reloads and restarts, so a launch that failed between two good ones — written only to the Desktop log, because the page never loaded — lands in the file. That is what makes the "could not start" dialog's "the full error is in the diagnostics log under Settings" true.
* **Sources.** Only the Electron process's (`main`, shown as `[desktop app]`) and the server's (`server`) entries. Older builds also had the page copy its entries and whole AI prompts into the Desktop log; those are never read back.
* **Each desktop entry** is trimmed to the same per-entry limit as a page entry in the current mode, folded when repeated exactly as page repeats are, and redacted with the full page redactor — including this device's stored keys, which the server and the Electron process cannot see. This is the choke point for everything that leaves the machine.
* **Size.** The header and the log get **1 MB** (`LOG_SECTION_MAX_CHARS`), about a third of a 1M-token context window, leaving the rest for reading the code; past it, the oldest entries are left out first and the header says how many. The reported problem comes **on top** and is not cut — it is what the player pressed the button about, and a normal one is a few kilobytes — unless it would take the whole file past **2 MB** (`LOGGING_FILE_MAX_CHARS`). Then it is cut in the middle, keeping its start and end (where a raw model response shows what it was and where it broke), with a line saying how much was cut.
* **Header.** States the Desktop log's status: `included (N entries …)`, `unavailable` (the request failed or timed out — the file is still made), or `none on this platform` (web and Android, whose in-browser API answers `/api/log` with a 404).
* **Fetching** (`fetchDesktopLog`) waits at most 2 s, so a dead server never holds the save and the save or copy still counts as the player's click.
* **Phones and LAN browsers** are served their page by the host, so the read reaches the host's Desktop log with no extra plumbing, and their file carries the host's errors.

### Game settings in the file

A report needs settings two ways, and gets both:

* **Every change, as it happens**, as a `setting` entry in words — "3D Globe turned on.", "Basemap set to World Imagery.", "Gemini model set to gemini-3.5-pro." — through `logSettingChange(label, value, { settle })` (or `logSettingMessage` for a line of its own wording). Fields that save on every keystroke (model names, per-task models, the endpoint, custom parameters, the label font) pass `settle`, so the line is written once the value has been still for 1.5 s, not once per keystroke.
* **Every setting's value as the file is saved**, in a `-- Settings when this file was saved --` block after the header, by section: Display, Map, AI, This save, Network, Diagnostics. A switch flipped before the log's span, or never touched, is in no log — and "was X on?" is the first question a report gets. `src/runtime/settingsLog.js` registers one reader per section (`registerSettingsSnapshot(section, read)`), each reading through the getter its owner already exports; `buildLoggingFile` calls them all as it builds the file (async ones — the server's LAN setting — within the same 2 s as the Desktop log), and a reader that throws says `(could not be read: …)` rather than vanishing. It is imported by `src/main.jsx` at boot, so the block is there however the file is saved.

Labels match the Settings panel word for word; `diagnosticsLogGuard.test.js` fails if a switch in the panel is missing from the snapshot. What a line may say is decided per setting: an API key is only ever `set` / `not set` (a change: "set" / "cleared"), custom parameters only their size (they can carry headers), an endpoint only its host (`endpointHostForLog`) — the path, the query and any URL credentials can carry a token. Everything is redacted again as the file is built.

Where changes are logged: `mapSettings.js` (every switch, the basemap and the label font), `providerConfig.js` (provider, every provider field, reasoning, AI profiles saved/updated/deleted), `GameUI/main.jsx` (Fullscreen, 3D Globe, 3D Terrain), `settings.jsx` (both languages, telemetry and ratings — `telemetry.js` imports nothing on purpose — and LAN sharing), `debugLog.js` (its own two switches).

**View log** (Settings → Diagnostics, `DiagnosticsLogViewer` in `settings.jsx`) lists `getLoggingFileEntries({ desktop })`: the same entries the file holds, newest first, each with `problem` for the problems-only filter (page `error`/`warn`/`crash` entries, any page entry logged with `{ problem: true }` — a failed AI task — and desktop `error`/`warn` levels). It replaced the Cheats panel's old "Diagnostics Log" tool, which read only the Desktop log.

### Two settings, both persisted

Both live in `localStorage`, which is what makes them survive closing the app: the desktop build keeps its Chromium profile between runs, so a choice holds across restarts, save switches and new campaigns. Neither is stored in a save file — the choice is about this installation, not this campaign, and a save copied between machines must not carry someone else's logging preference. **Absent means default, and the two defaults differ, so the keys read differently on purpose.**

| Setting | Key | Default | Off/on means |
|---|---|---|---|
| Logging | `oh_debug_log_enabled` | **ON** (absent or anything but `"0"`) | Off: nothing is recorded, and the stored log is deleted — on the host machine, the Desktop log too — see below |
| Detailed logging | `oh_debug_log_verbose` | **off** (absent or anything but `"1"`) | On: the `{ verbose: true }` entries are kept, and every entry keeps far more of itself |

Both are cached in module state rather than read per entry — `logDebugEvent` runs in the hot path of a turn and of every console call the game makes — and primed at module load, so the very first entry (logged from `src/main.jsx` before anything mounts) already obeys a saved choice. `setDebugLogEnabled` / `setDebugLogVerbose` write through the cache.

**Turning logging off also clears what was collected**, storage included, and the toggle's helper text says so. A player switching this off is saying they would rather the game did not keep this; leaving the last session's log in storage would ignore half of that, and it would go on occupying the storage budget for a feature they just declined. `persistNow` refuses to write while disabled, so a stray flush (pagehide, the error boundary) cannot put the key back afterwards.

It also sends `DELETE /api/log`, which removes the Desktop log and every rotated file — **on the host only**: the server refuses any non-loopback caller, so a phone's switch covers the phone's log and never reaches into the desktop's files. The refusal, and the web and Android builds' 404, are ignored. The desktop app and the server go on noting their own start-up and server errors afterwards — never campaign text — and the Settings text says exactly that. Nothing else ever deletes the Desktop log: an upgraded install's old files (which can hold whole prompts written by older builds) stay until the player turns Logging off on the host, and the Logging file never reads them.

### What is recorded

Two sources:

1. **Explicit `logDebugEvent()` calls** at the milestones a report needs. Every one is listed under "Hook sites" below.
2. **Everything the game already logged.** `installDebugLogCapture()` wraps `console.warn`/`console.error` (plus `console.log`/`console.info`, verbose-only) and listens for `error` / `unhandledrejection` on `window`. The originals are still called, so a developer with DevTools open sees exactly what they saw before. A caller that writes to the console something it has already logged properly wraps the call in `withConsoleCaptureMuted` — the error boundary does, so a render crash appears once, as its `crash` entry.

Detailed mode is expressed at the call site as a fourth argument — `logDebugEvent(cat, msg, detail, { verbose: true })` — and gated at the top of `logDebugEvent` rather than by an `if` around each call, so a hook cannot drift out of sync with the setting. It also raises what each entry keeps: `MAX_DETAIL_CHARS` 600 → 20,000, and error stacks 1 frame → 8.

### What is never recorded

**API keys**, **the player's home folder**, and **whole AI prompts**.

`redactSecrets()` runs over the category, message and detail of every entry **on the way in**, so a key is never even held in the buffer, and again over anything pushed into the context and over every Desktop log entry as it enters the Logging file. Two passes:

* **Literal.** Every value in `localStorage` under a key ending `_api_key` / `_token` / `_secret`, matched by suffix so a provider added later is covered without anyone remembering to come back — and every `apiKey` field inside a stored list whose key ends `_connections` or `_presets`, which is where `Game/AI/providerConfig.js` keeps its Connections (and the profiles before them kept theirs). Values under 8 characters are skipped — they are not keys, and treating them as such would redact half the log. This is the only pass that can catch a self-hosted gateway key, which may be any string at all.
* **The shared rules** (`server/logRedaction.js`, `redactLogText`), the same ones the Desktop log's writers use, so no writer can miss a shape another catches. Key shapes: `sk-…`, `sk-ant-…`, `pk-`/`rk-`, `AIza…`, `hf_`/`gsk_`/`xai-`, GitHub `gh?_` tokens, `Authorization: Bearer|Basic …`, `api_key`/`token`/`password`/`secret` in a dumped object or query string, URL userinfo (`http://user:pass@host` → the host survives, the credentials do not), and JWTs. And the **home folder** — `C:\Users\<name>`, `/Users/<name>`, `/home/<name>`, with a Windows path's backslashes single or JSON-doubled — becomes `~`, keeping the path after it. The server and the Electron process also replace their literal `os.homedir()`.

Provider and model **names** are in the header on purpose — the model is the most useful line in an AI bug report and is not a secret. Campaign text is kept to titles, ids and counts: a log a player will paste in public beats a complete one they will not.

Whole prompts are replaced by the **prompt fingerprint** (detailed mode only, below): a jump's prompt alone could fill the file, and it can be rebuilt from the save.

### Buffer and persistence

| Constant | Value | Why |
|---|---|---|
| `MAX_LOG_CHARS` | 1 MB, both modes | **The real governor**, and the Logging file's own size, so the log never holds more than a report can carry. The modes differ in *what* they record, not how much they keep; a normal log just reaches much further back. It used to be 192 KB for a normal log, which on a busy campaign reached back barely an hour |
| `MAX_ENTRIES` | 5000, both modes | A ceiling on a quiet session |
| `MAX_DETAIL_CHARS` / `_VERBOSE` | 600 / 20,000 | A truncated detail keeps `… (+N chars)`. A clipped stack trace or model response is usually worth nothing, which is what detailed mode is for; 20k clears a long advisor answer whole |
| `STACK_FRAMES` / `_VERBOSE` | 1 / 8 | One frame is where it threw; the rest is React internals nine times out of ten |
| `MAX_STORED_CHARS` | 1200 KB | Backstop on the *serialized* form only, for when the JSON scaffolding costs more than `entryCost` estimated |
| `COALESCE_WINDOW` / `COALESCE_MS` | 25 entries / 60 s | Repeat collapsing (below) |
| `PERSIST_DEBOUNCE_MS` | 800 | A busy turn logs a dozen entries a second; a synchronous write per entry is a jank source |

localStorage is a ~5 MB budget per origin, shared with the translator cache and every setting; the log's budget is characters and Chromium stores UTF-16, so a full log is ~2 MB of it. The cost that grows with the budget is the background save, which rewrites the whole buffer: measured in Chromium (Electron, desktop hardware) at ~5 ms for a full 1 MB log, 6 ms at worst — inside one 60 fps frame. If that ever stops being true on real players' machines, the normal budget is the one to shrink (the spec's fallback is ~200 KB); moving the log to IndexedDB is the larger fix.

**Trimming (`trimToBudget`).** The buffer is bounded by **size**, not only by entry count, and drops its **oldest** entries until it is inside both ceilings — oldest-first because a report is read for what led up to the problem and the problem is at the end. `usedChars` is maintained incrementally (`entryCost` = message + detail + category + gameDate + ~120 chars of JSON scaffolding) rather than recomputed, because trimming runs on every entry and re-measuring a 5000-entry buffer each time is how a bad network becomes a frame-rate problem. Entries go one at a time, so a full log keeps as much history as it can hold. `droppedEntries` counts what went, and the report says so — "the log starts at 11:42 with no explanation" and "the log dropped 900 entries to stay under the cap" are very different things to a reader.

**Repeat collapsing.** An entry identical (category + message + detail) to one in the last `COALESCE_WINDOW` entries and within `COALESCE_MS` bumps that entry's `repeat` counter instead of appending; the report renders `(×48, last 10:50:58)`. Without this a dead basemap host or content node evicts the whole campaign from the buffer — measured at ~100 entries in six seconds with the network down. It scans a window rather than only the previous entry because storms interleave (maplibre's `AJAXError` alternating with our own fetch rejection), which consecutive-only matching would collapse neither of. Desktop log entries are folded the same way as the Logging file is built.

**Persistence.** Mirrored to `localStorage` under `oh_debug_log_v1`, restored on the next boot behind a `— page reloaded —` separator, and flushed on `pagehide` and from the error boundary before its Reload button. The crash that killed the page is the whole point, and an in-memory buffer dies with it. Every storage access is wrapped: quota exceeded, private mode and disabled storage all degrade to an in-memory-only log rather than breaking the game.

### API

| Export | Purpose |
|---|---|
| `installDebugLogCapture()` | Once, at boot (`src/main.jsx`), before anything else runs. Restores the previous session (unless logging is off), wraps the console, binds the global error hooks |
| `logDebugEvent(category, message, detail?, { verbose, problem }?)` | The only way in. `detail` is flattened (Errors keep name + message + stack frames; objects are JSON; circular does not throw) and truncated. `verbose: true` marks an entry as detailed-mode-only; `problem: true` keeps it under View log's "problems only" whatever its category |
| `withConsoleCaptureMuted(run)` | Runs `run` with the console capture off, for a line already logged properly — the error boundary's own console line, and React's report of every caught error (`onCaughtError` in `src/main.jsx`), so a render crash is one entry |
| `isDebugLogEnabled()` / `setDebugLogEnabled(bool)` | The on/off switch. Turning it off clears the buffer, the stored copy, and (on the host) the Desktop log |
| `isDebugLogVerbose()` / `setDebugLogVerbose(bool)` | Detailed mode |
| `getDebugLogBytes()` / `getDebugLogLimitBytes()` / `getDebugLogDroppedCount()` / `formatLogSize(chars)` | Size reporting for the settings panel and the report header. `formatLogSize` renders anything under a kilobyte as `<1 KB`, never `0 KB` — beside a live entry count that reads like a broken counter |
| `setDebugLogContext(patch)` | Merges campaign/build context for the report header. Redacted like everything else |
| `buildLoggingFile({ incident }?)` | **The Logging file**: fetches the Desktop log and builds the report. What every button uses |
| `fetchDesktopLog()` | `{ status: "included" \| "unavailable" \| "none", entries }` from `GET /api/log?since=<span start>`. Never throws |
| `buildDebugLogReport({ incident, desktop }?)` | The plain-text file from what is passed in — header, reported problem, entries oldest-first, sized as above. Text, not JSON: it is going into a Discord message or a GitHub issue |
| `getLoggingFileEntries({ desktop })` | The file's entries, newest first, with `problem` — for View log |
| `debugLogFilename(tag?)` | `open-historia-log-<ISO stamp>[-tag].txt` |
| `clearDebugLog({ silent })` | Empties it. The player path leaves a "cleared" note so a gap never reads as lost entries; `silent` is for the tests |
| `flushDebugLog()` | Persist now, skipping the debounce |
| `getDebugLogEntries()` / `getDebugLogSize()` / `getDebugLogContext()` | Reads |
| `subscribeToDebugLog(listener)` | Returns an unsubscribe. Drives the entry count in the settings panel |
| `logSettingChange(label, value, { settle }?)` / `logSettingMessage(key, message, { settle }?)` | A setting change as a line: a boolean "turned on/off", anything else "set to"; `settle` waits for a typed value to stop changing |
| `registerSettingsSnapshot(section, read)` | Adds a section to the file's settings block; `read` returns `[label, value]` pairs (or a promise, or null to leave the section out). Returns an unregister |
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
| `src/runtime/mapSettings.js` | `setting` | Every map/AI/experimental toggle, by its UI label; the basemap and label font |
| `src/Game/AI/providerConfig.js` | `setting` | Provider switches, every provider field (model, per-task models, key set/cleared, endpoint host, custom-parameter size, structured output, strict tool schema), reasoning toggle, AI profiles; syncs provider + model into the header |
| `src/Game/GameUI/main.jsx`, `settings.jsx` | `setting` | Fullscreen, 3D Globe, 3D Terrain; UI and chat language, telemetry, ratings, LAN sharing |
| `src/Game/AI/gameplay.js` | `ai` | **Every AI task that failed**, with its reason and the error (and whether it was aborted), marked as a problem |
| `src/runtime/ErrorBoundary.jsx` | `crash` | Render crashes with the component stack, then flushes |
| `window` / `console` | `crash`, `error`, `warn` | Uncaught errors, unhandled rejections, and everything the game already logged |

Detailed mode only (`{ verbose: true }`):

| Where | Category | Records |
|---|---|---|
| `src/Game/AI/gameplay.js` | `ai` | Every task: start (prompt/user-message sizes, tool name, timeout), **a prompt fingerprint per attempt**, each attempt's answer (size, tool-call or prose, elapsed), **each rejection with its validation error and raw response — including retries that then succeeded**, which attempt won, and salvage |
| `src/runtime/library.js` | `api` | The calls that *worked*: method, path, status. The duration goes in only past 1 s — the game polls every 5 s, and a per-call millisecond figure would make each poll unique and defeat the repeat collapsing |
| `src/runtime/assets.js` | `save` | Every successful save with its byte size. Growth is the point: a `world.json` climbing past a megabyte makes every turn slower and is invisible in any single entry |
| `src/Game/GameUI/time.jsx` | `turn`, `ui` | Per-turn world changes (event titles plus counts of region transfers, polity changes, unit/marker/project ops, chats, and the unit and project totals) — this is what exposes a turn that narrates a conquest while moving no borders. Plus timeline panel navigation |
| `src/Game/GameUI/main.jsx` | `ui` | Which panels are open, as one effect over every panel flag rather than a call per handler — these panels are opened from a dozen places and per-handler calls would miss most of them |
| `console` | `log` | `console.log` / `console.info`, the game's routine chatter — noise in a normal report, running commentary in a detailed one |

**Prompt fingerprint** (`buildPromptFingerprint`, `src/Game/AI/contextDiagnostics.js`). For one structured AI attempt: the size and an 8-hex-digit FNV-1a hash of the whole system prompt, the prompt template, the instruction, the conversation history (with a message count), and every filled-in section by variable name. No text. Rebuild the prompt from the save, fingerprint it, and a mismatch names the section that differed. Only computed while detailed mode is on.

Tests: `src/runtime/debugLog.test.js` (redaction, buffer, coalescing, report, both switches and their persistence, the size budget, the Desktop log merged into the Logging file, and the settings block and settled change lines), `src/runtime/diagnosticsLogGuard.test.js` (the page never writes to the Desktop log; no whole prompts; every Settings switch is in the snapshot), `src/Game/AI/providerConfig.test.js` (provider changes logged, a key never), `src/Game/AI/contextDiagnostics.test.js` (the fingerprint).

---

## Desktop log — `server/logStore.js`

One append-only JSONL file, `<data dir>/logs/app.log` (rotated 5 × 5 MB: `app.log.1` … `app.log.4`), where the desktop app's **Electron process** (`source: "main"`, written directly by `electron/main.cjs` because it runs before the server exists) and the **server** (`source: "server"`, every API failure through `sendError`) write their own entries. It lives under the writable data dir (`server/dataDir.js`), beside the saves: `server/data/logs` for the zip, the Electron userData dir for the installed app, the sandbox path on Android.

It is **not a second log** — its entries appear in the Diagnostics log's Logging file, merged by time (above). The page never writes to it; older builds had the page copy every entry and the AI layer write whole system prompts here, regardless of the player's switches.

| Export / route | Purpose |
|---|---|
| `appendLog(entry)` | `{ level, source, event, message, data? }`. Redacted (`redact` → the shared rules plus this machine's literal home folder), clipped, appended; rotates first. Never throws |
| `readLogSince(since)` | The `main` and `server` entries at or after `since` (ISO), oldest first, reaching into the rotated files when the span goes back that far (a file last written before `since` is skipped). Redacted again on the way out, which covers what older builds and the Electron process wrote. Each entry's `data` is clipped to 20,000 chars and the whole read to ~1 MB, newest kept — the Logging file could not use more |
| `clearLog()` | Deletes `app.log` and every rotated file. Never throws |
| `GET /api/log?since=<ISO>` | `{ entries }` — `readLogSince`. Readable by any device that can reach the server: in practice the host player's own phone, whose report should carry the host's errors |
| `DELETE /api/log` | `clearLog()`, **loopback only** (403 otherwise, not through `sendError`, which would log the refusal into the log). Sent when the player turns Logging off |

The Electron process's writes use the same rules through `require()` of `server/logRedaction.js`; an older Electron whose Node cannot `require()` an ES module falls back to replacing the home folder only, and everything is redacted in full again as it is read back.

Tests: `server/desktopLog.test.js` — the store against a throwaway data folder, and the routes on a real server in a child process (including a LAN caller being refused the clear).
