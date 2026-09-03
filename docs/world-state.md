# World State & Turn Model

Open Historia keeps a running game in five plain-JSON documents served from a per-scenario/per-game runtime endpoint. The largest and most important is **`world.json`** — the political map plus everything the AI has changed since the scenario began (region ownership, polities, colors, tags, reputation, units, structures, catalyst, history). The **turn loop** is a "time jump": the AI returns a batch of `events`, each carrying machine-readable `impacts`, and `applyEventImpactsToWorld` folds those impacts into world state before it is persisted; the map re-renders because `useWorldState` polls `world.json` every 5 seconds.

Core files: `src/runtime/gameState.js` (state shape, normalizers, impact application), `src/Game/Map/useWorldState.js` (the poll), `src/Game/Map/unitsController.js` (the units peer-poll), `src/runtime/countryTags.js` (tag rules), `src/runtime/assets.js` (read/write/cache plumbing), `src/Game/AI/gameplay.js` (`applySimulationResult`, the turn writer).

Related pages: [Country tags](country-tags.md) · [Map rendering & Nations layer](nations-layer.md) · [Units & combat](units.md) · [AI turn / time jump](ai-turn.md) · [Scenario library](library.md).

---

## 1. Storage model: the runtime JSON assets

All mutable game state lives behind a small set of URLs built in `src/runtime/assets.js:63` (`JSON_URLS`) and rebuilt on every scenario/game switch by `setRuntimeAssetEndpoints` (`src/runtime/assets.js:204`). Each URL carries a `?v=<token>` cache-buster; changing the token (a library mutation) sweeps the in-memory value caches so the next read re-fetches (`src/runtime/assets.js:218`).

| Asset key | URL (path) | Read / write helpers (`gameState.js`) | Holds |
|---|---|---|---|
| `world` | `/api/runtime/json/world` | `readWorldState` / `writeWorldState` (`:985`,`:988`) | The political map + AI-mutated state (this page). |
| `game` | `/api/runtime/json/game` | `readGameData` / `writeGameData` (`:997`,`:1000`) | Player country, clock, round, difficulty (§6). |
| `events` | `/api/runtime/json/events` | `readEventsState` / `writeEventsState` (`:1009`,`:1012`) | Timeline of AI/scenario events, each with `impacts`. |
| `actions` | `/api/runtime/json/actions` | `readActionsState` / `writeActionsState` (`:1003`,`:1006`) | Player/queued orders awaiting the next jump. |
| `chat` | `/api/runtime/json/chat` | `readChatsState` / `writeChatsState` (`:1019`,`:1022`) | Diplomacy conversation threads. |
| `colors` | `/api/runtime/json/colors` | plain `writeJson(JSON_URLS.colors, …)` / `getNationColors` (`assets.js:900`) | `code → [r,g,b]` palette (sibling of `world`, not inside it). |
| `flags` | `/api/runtime/json/flags` | `getNationFlags` (`assets.js:949`) | Author flags `code → PNG data URL`. |
| `tags` | `/api/runtime/json/tags` | `getNationTags` (`assets.js:933`) | Author STARTING country tags (§10). |
| `regionsGeojson` / `citiesGeojson` | `/api/runtime/json/regionsGeojson` … | via `loadRegionCatalog` (`assets.js:1036`) | Custom drawn geometry (never value-cached, see `isNoStoreJsonUrl` `:158`). |

`readGameStateBundle` (`src/runtime/gameState.js:1025`) reads `actions`, `chats`, `events`, `game`, `world` in one `Promise.all` and is the standard "load everything" entry point.

### Games vs scenarios

The same asset keys are served from two different server roots (`src/runtime/library.js:10`):

- **Scenarios** — `/api/scenarios/*`. The immutable authored seed (WWII preset, a hub download, an editor export). `world.json` here is the STARTING position produced by the editor (`src/Editor/exportPreset.js:220`).
- **Games** — `/api/games/*`. A live playthrough. Selecting a scenario spawns a game whose `world.json` starts as a copy of the scenario's and is then mutated in place by every jump.

Only a **game's** `world.json` is written during play; the scenario copy stays pristine so the same scenario can seed many games. `setRuntimeAssetEndpoints` points `JSON_URLS.*` at whichever is active (the runtime token encodes it). `saveGame` in `src/Game/GameUI/libraryBar.jsx:1180` writes `world` **whole** (never a shallow `worldPatch`, which would drop `polityOverrides`/`ownerCodes`/`regionOwnershipOverrides` and wipe the map).

---

## 2. `world.json` shape — field table

`WORLD_DEFAULTS` (`src/runtime/gameState.js:15`) is the authoritative default object; `normalizeWorldState` (`:815`) spreads `{ ...WORLD_DEFAULTS, ...world }` and then re-derives the structured fields. Anything **not** in `WORLD_DEFAULTS` (e.g. `customRegions`, `basemap`, `ownerCodes`) passes through untouched from the stored document — these are scenario-authored or game-appended fields the normalizer never rewrites.

### 2a. Core political-map fields

| Field | Type | Default | Meaning / data flow |
|---|---|---|---|
| `regionOwnershipOverrides` | `{ regionId: ownerCode }` | `{}` | THE re-ownership map: which polity owns each region above the base tiles. Written by AI `regionTransfers` (§8) and by cheats. Read by the Nations layer to paint fills, and by `isPolityLandless` (`:917`). Normalized to string→string, blanks dropped (`:823`). |
| `polityOverrides` | `{ code: {code,name,aliases[],color,note,verbatim?} }` | `{}` | Declared/renamed polities: new countries, renames, colors, alt-names. Written by AI `polityChanges` and the editor. `enqueueContentStrings` translates names on write (`:993`). Normalized by `normalizePolityOverride` (`:758`). Feeds `loadCountryNames` (`assets.js:1004`) and every name/flag resolver. |
| `regionClaimants` | `{ regionId: string[] }` (≤4) | `{}` | Marks a region DISPUTED — striped in the administrator's + claimants' colors. World-data equivalent of a `claimants` list on the geojson feature, and WINS over feature props. Normalized `:829` (sliced to 4). |
| `ownerCodes` | `string[]` | *(not defaulted; pass-through)* | The playable factions list — who can be picked/played, including landless ones. Appended by `saveGame` (`libraryBar.jsx:1197`), read by cheats (`cheats.jsx:120`) to enumerate owners. |
| `customRegions` | `boolean` | *(pass-through)* | When true, render political fills/borders/labels from the scenario's `regions.geojson` instead of the stock modern overlay. Set by the editor export (`exportPreset.js:227`) — forced on whenever there's custom geometry OR a custom background. Read in `useWorldState` and the Nations layer. |
| `customCities` | `boolean` | *(pass-through)* | Render authored cities instead of the modern city set (`exportPreset.js:239`). Surfaced by `useWorldState` (`:87`). |
| `basemap` | `string \| null` | *(pass-through)* | ESRI basemap preset id (`ESRI_BASEMAPS`, `assets.js:82`); falls back to `ocean` in-game. |
| `background` / `backgroundData` | `string \| null` / payload | *(pass-through)* | Custom map background (image-by-extent or vector overlay) that replaces Earth; heavy payload rides in a separate scenario asset (`exportPreset.js:228`). |

### 2b. AI-evolved diplomacy / identity fields

| Field | Type | Default | Meaning / data flow |
|---|---|---|---|
| `internationalReputation` | `{ code: 0–100 }` | `{}` | Per-polity reputation, authoritative (not the on-demand stat sheet it was first read from). Evolved by AI `polityChanges.reputation` each turn (`:1081`) and fed back into prompts. Normalized/clamped to `[0,100]` int (`:838`). Keyed by country NAME verbatim. |
| `countryTags` | `{ country: string[] }` | `{}` | Per-country tags the AI has CHANGED since the scenario started. Wins over the author's `tags.json` where present (see `resolveCountryTags`, `countryTags.js:55`). Keyed by country NAME verbatim (same namespace as reputation/colors — see the desync warning at `:845`). Normalized via `normalizeTagList` (`:850`). |
| `notes` | `string` | `""` | Free-form world notes. |

### 2c. Country-label styling (§ read by the map)

Empty string = defaults (Impact, white letters, half-black outline). The font renders from the PLAYER's local fonts — MapLibre v5 rasterizes each glyph client-side using the stack as a CSS `font-family` (there is no glyphs endpoint). Set in scenario settings; surfaced to the map by `useWorldState`.

| Field | Type | Default | Notes (`gameState.js`) |
|---|---|---|---|
| `labelFont` | `string` | `""` | CSS font-family stack for country labels (`:31`, normalized `:864`). |
| `labelTextColor` | `string` | `""` | Label fill color (`:33`). |
| `labelHaloColor` | `string` | `""` | Label outline color (`:32`). |

### 2d. Simulation config & timeline text

| Field | Type | Default | Meaning |
|---|---|---|---|
| `simulationRules` | `string` | `""` | Author house-rules injected into the AI prompt (`exportPreset.js:242`). |
| `startingTimelineText` | `string` | `""` | Author-written opening timeline shown pre-game (`exportPreset.js:243`). |
| `language` | `string` | `"English"` | UI/content language for translation (`:34`, `:867`). |
| `allowedUnitTypes` | `string[]` | *(pass-through)* | Scenario whitelist of deployable troop types; `null`/empty = all allowed (read in `unitsController.js:81`). |

### 2e. Units and markers (ride inside world state)

Stored in world so they share every read/write/poll/normalize path with no server change.

| Field | Type | Default | Element shape (normalizer) |
|---|---|---|---|
| `units` | `Unit[]` | `[]` | `normalizeUnitEntry` (`:475`): `{id,name,type,ownerCode,strength,lng,lat,regionId,status,note,source,orderId,createdAt,updatedAt}`. |
| `markers` | `Marker[]` | `[]` | `normalizeMarkerEntry` (`:518`): built structures — `{id,name,kind,ownerCode,lng,lat,note,foundedAt,createdAt}`. |
| `pendingUnitOrders` | `PendingUnitOrder[]` | `[]` | `normalizePendingUnitOrders`/`normalizePendingUnitOrderEntry` (`:625`,`:603`): `{id,unitId,kind,toLng,toLat,radiusKm,untilRound,targetId,targetLabel,note,issuedAt,issuedRound}`. Standing orders the **engine** advances every turn (`advanceStandingOrders`): `move` travels to a destination, `patrol` works a station of `radiusKm` centred on it. Minted by `applyUnitOpBatch` when an AI move exceeds what the unit could travel in the elapsed time, or when a unit takes `posture: "patrol"`. Surfaced to the AI every jump via `buildPendingUnitOrdersText` (`promptContext.js`) as **context only** — the model must not emit a move for one, or the unit advances twice. Auto-dropped by `pruneSatisfiedUnitOrders` (`:641`) once the unit is within ~60km of `toLng`/`toLat` or no longer exists; a `patrol` order is exempt from that arrival test (its destination *is* its station) and ends via `untilRound` instead. Pruned on **every** `normalizeWorldState` call (`:1128`), so this never needs a separate cleanup pass. |

`Unit` enums (`:60`–`:64`): `type ∈ {infantry,armor,air,naval,artillery,garrison}` (default `infantry`); `status ∈ {idle,moving,engaged,defeated,pending}` (default `idle`; `pending` = a player deploy awaiting AI resolution, rendered translucent); `source ∈ {player,ai,scenario}` (default `scenario`); `posture ∈ {holding,massing,patrol,transit,exercise,blockade,withdrawing,assaulting}` (default `""` — intent, as distinct from lifecycle `status`; deliberately not `garrison`, which would collide with the unit *type*). **`assaulting` is the one posture that also moves the lifecycle**: a unit *arriving* under it is stamped `status: "engaged"` rather than `idle` (`applyUnitOpBatch`). It exists so the **beta** system can express a province assault at all — classic players reach that through the unit popup's Attack button (`attackRegion`, which does the same bookkeeping locally), but the beta card deliberately has no direct-control buttons ("intent, not control"), so a typed order like "Attack Provence" has to be something the *model* can enact. The AI still owns the outcome (casualties, and a `regionTransfer` only if the province actually falls); `engaged` is additionally exempt from `enforceUnitVolume` pruning, which is right for a formation in contact. `strength` is a **percentage of established strength**, clamped to `[0,100]` by `clampUnitStrength`, which coerces the old 1–1000 scale by dividing anything over 100 by ten. `composition` is free text for the order of battle ("1 aircraft carrier, 2 frigates"); `covert` is engine-assigned and means "no confirmed line of support" (a covert insertion **or** a presence only just detected), shown to the player as *Unconfirmed*; `eventId` links the event that created or last moved the unit. `marker.kind` is free-form (lowercased for stable styling), default `landmark`. `PendingUnitOrder.kind ∈ {move,patrol}` (default `move`; a legacy `attack` is coerced to `move`, keeping its destination and `targetLabel`).

### 2e-bis. Projects & operations (ride inside world state)

| Field | Type | Default | Element shape (normalizer) |
|---|---|---|---|
| `projects` | `Project[]` | `[]` | `normalizeProjectEntry`: `{id,name,kind,ownerCode,summary,status,progress,tags,secrecy,startedAt,targetDate,milestones,nextMilestone,lastUpdate,eventIds,linkedUnitIds,linkedMarkerIds,linkedSpyIds,verification,focus,note,createdAt,updatedAt,updatedRound}`. |

The **Projects & Operations board**: long-running efforts that span rounds — research and industrial programmes, construction projects, military and covert operations, sustained political campaigns. Deliberately distinct from the actions queue, which holds one round's orders and is resolved by the next jump.

A milestone may carry `repeat` (`weekly|monthly|quarterly|annual|biennial`) for a **standing commitment that comes round again** — an annual drill, a quarterly review. Marking one `done` does not retire it: `applyProjectOps` advances the date by one interval and sets it `pending` again, bumping `completedCount` and stamping `lastCompletedAt`. It rolls from the milestone's OWN date, not from the day it was ticked off, so an annual drill on 1 June stays on 1 June instead of drifting; a commitment missed for several cycles advances as many times as it takes to get ahead of the clock. Month-ends clamp (the 31st becomes the 28th in February) and recover afterwards. A skipped occurrence is deliberately **not** auto-rolled — it stays pending and flags `milestoneMissed`, because a drill nobody ran is exactly what the board should show.

`ongoing: true` marks a **standing effort with no planned end** — a permanent patrol, a continuous intelligence programme. It forces `targetDate` to `""` and can never be overdue, which is the point: without it the model invents an end date for something meant to continue, and the board then cries wolf the day that date passes. Distinct from merely having no `targetDate` yet, which is what an undated new entry looks like.

`kind ∈ {project, operation}` (default `project`); `status ∈ {proposed,active,stalled,paused,complete,failed,cancelled}` (default `active`; the still-running subset is exported as `PROJECT_OPEN_STATUSES`); `secrecy ∈ {public,restricted,covert}`. `tags` reuses `normalizeTagList` (`countryTags.js`) so the 8×32 caps and case-insensitive dedupe are shared with country tags. `ownerCode` is a country **NAME**, verbatim — same namespace as units and markers — and **blank means the player**, so the model is never made to restate the player's own country on every entry (a field it has to repeat is a field it eventually gets wrong). `nextMilestone` is **re-derived** from `milestones` on every normalize (earliest dated `pending` wins) rather than trusted: the model is given both and drifts them apart the moment it marks one done without restating the other.

Capped at **120 projects**, 8 milestones each and 12 `eventIds` each — sized against a real campaign (a forty-round game came back with 44 live projects) rather than guessed. One project measures ~1-1.4 KB, of which milestones are ~39%, so a full board costs ~160 KB against a `world.json` whose `startingTimelineText` and `consolidatedHistory` are already ~105 KB each. Going over the cap evicts **finished work first** (oldest by `updatedAt`), and only then the least recently touched live work — `.slice(0, N)` would have dropped whatever happened to be last, which is live work as often as not. The panel shows the count and warns within 10 of the limit, so this is never the first the player hears of it.

If a board ever genuinely needs more than this, the answer is not a bigger number: it is moving `projects` out to its own runtime asset. That is real work, because rollback snapshots and the staged event reveal both get `world.projects` for free today purely by riding inside world state.

**The player cannot author a project's content.** Only two things write what a project *is*: events, via `impacts.projectOps` (§5) — which since the board moved out of the jump are produced by the dedicated `projects` task and attached back onto the events that caused them — and the advisor, via its ```` ```projects ```` block. The player owns exactly two fields, from the panel itself: `priority` (`high|normal|low` — how much attention they want it to get, which the jump and advisor directives then act on) and abandoning it, which goes through the ordinary `cancel` op so the entry stays under Closed with the progress it actually reached. Both route through `applyProjectOpsToWorld`, the same door the advisor uses, so they stamp `updatedAt`/`updatedRound` and close out dangling milestones like any other write. `eventIds` is stamped by `applyProjectOps` from the causing event, which is what builds the per-project activity feed without the model having to maintain it.

Everything date-derived — overdue, due-soon, a slipped milestone, a programme untouched for several rounds — is **not stored**. It is computed from the game clock by `src/runtime/projects.js` (import-free, unit-tested in a bare checkout), so it cannot go stale between AI turns. That split is the point of the feature: the model owns what only it can know, the calendar owns the rest.

Not in `TEMPLATE_WORLD_OVERRIDE_KEYS`, deliberately — `buildFreshWorldSeedFromScenario` carries *authored settings* across, and projects are play state, exactly like `units` and `markers`.

#### Espionage on the board

`linkedSpyIds` ties a covert operation to the agent it is actually running. The split is deliberate: the **engine** owns whether such an entry exists and whether it has ended (`spyOperationOps` in `projects.js`, called from the turn and from the Spy tab, so the two cannot disagree), and the **model** owns the story — progress, milestones, `lastUpdate` — because once the entry exists it is an ordinary board entry. The field is engine-written only: it is absent from `projectSchema`, so a strict provider cannot emit it, and absent from `PROJECT_PATCHABLE_FIELDS`, so no update can rewrite the link.

Three cases are deliberately left alone. A `turned` agent changes nothing — the player is never told, and an entry that closed itself would say so louder than any message. A `suspected` one is left alone too, because the model is free to set it back to active on the next jump and the two would flip-flop; the Spy tab already flags it. And another polity's agent inside the player is not the player's programme.

Espionage also reaches the board **through the events it produces**: `resolveEspionage` runs inside `applySimulationResult`, and the `projects` task now runs there too, after it — so an exposure can stall the operation it belonged to on the same turn rather than a turn later. The `projects` task additionally receives the `[Espionage]` brief (framed for the board rather than the simulator), which is the one source that can put a **rival's** programme on the board as a foreign entry.

#### Doubting what a spy told you

A turned agent feeds planted material and the board opens a foreign entry from it. That is the deception working. What makes it a mechanic rather than noise is that it ends, and that settling it is a **move the player makes**.

`verification` runs `"" → doubted → confirmed | refuted`, and ownership is split:

- `spyProvenanceOps` ties a foreign entry to the agent that must have produced it (the brief is the only channel that puts a rival's programme on the board), stamping `linkedSpyIds`. Retroactive on purpose, so entries opened before this existed still get linked.
- `spyIntelDoubtOps` stamps **`doubted`** when that agent is `suspected` or `turned` — the analysts' own warning, the same flag the Spy tab shows, not proof. Cast once per entry, so a later verdict is never overwritten. The wording never says an agent was turned: the player is not told, so the board is not either.
- `doubtedAwaitingFreshSource` lists doubted entries the player now has a **clean** agent for — not the one that caused the doubt, and not a suspected replacement. That list is handed to the `projects` task, because whether a fresh source bears on an entry is a fact about world state, not something readable from board text.
- **`confirmed` and `refuted` are the model's**, through an ordinary op. `projectSchema` offers only those two, so no model can cast doubt on the board itself — only settle one already cast.

The engine never decides whether a programme was real; that is fiction, and only the model has it. It decides only *whether the question can honestly be asked yet*.

> `linkedSpyIds` and `verification` are both in `PROJECT_PATCHABLE_FIELDS` because the engine sets them through ordinary update ops. The protection is `projectSchema`, which omits `linkedSpyIds` entirely and restricts `verification` to the two verdicts: **the schema decides what a model can say, the whitelist only decides what an op can carry.**

`world.intelligence` is reachable from the board rather than only from a bare `polityChange`: a sustained build-up belongs in a programme whose `onComplete.polityChanges` carries the new rating, so it lands when the work finishes and can be funded, watched, or wrecked first. A sudden shock — a purge, a defector, a ring rolled up — still changes it directly. `onComplete` releases on completion only, never on a cancel or a fail, so abandoning the programme delivers nothing.

### 2e-ter. Espionage (rides inside world state, except the intercepts)

| Field | Type | Default | Element shape (normalizer) |
|---|---|---|---|
| `intelligence` | `{[polity]: number}` | `{}` | Per-polity service capability 0-100, clamped and rounded. Absent means `DEFAULT_INTELLIGENCE` (40) — "ordinary", not "none". |
| `spies` | `Spy[]` | `[]` | `normalizeSpy`: `{id,owner,target,deployedAt,status,turnedAt,exposedAt,coverStory,suspected}`. |
| `spySeal` | `string` | `""` | 64 hex chars, validated `/^[0-9a-f]{64}$/i`; blanked if malformed. |

`intelligence` is keyed by country **NAME**, verbatim — the same namespace as `internationalReputation`, `polityOverrides` and `countryTags` — and moves exactly like reputation: the AI sets it through `polityChanges.intelligence` (0-100), applied in `applyPolityAndTerritoryImpacts` against the **alias-resolved** owner key, so a polity the model names by an alias cannot end up with two split ratings. It decides how much of others' diplomacy a polity can read and how much of its own it can keep secret. Rendered by the Stats tab's 🕵 card, never part of the AI-written stat sheet.

`Spy.status ∈ {active, discovered, turned, exposed, recalled}`. `active` is in place and reporting; `discovered` was caught by the target and is waiting on the **player's** decision (it reports nothing meanwhile); `turned` is a double agent whose owner is not told — the target writes what it "reports"; `exposed` and `recalled` are terminal. `owner: ""` is a pre-ownership record and means the player's. Caps: `MAX_ACTIVE_SPIES` 3 per owner, `MAX_FOREIGN_SPIES` 3 inside the player at once.

**The intercepts are NOT in world state.** They live in their own runtime-only JSON asset (`storage/intercepts.json`, `readInterceptsState` / `writeInterceptsState`), because they are refreshed *after* the jump's world write and a second world writer would race it. Shape: `{[targetPolity]: {gatheredAt, round, planted, exchanges}}`, where an exchange is `{id, counterpart, date, subject, messages}` and a message is `{speaker, text}` **or** `{speaker, cipher}` — never both. At rest it is always `cipher`: `spySeal.js` seals each message with AES-GCM under `world.spySeal`, opened in exactly two places (the simulator prompt, and the intercept view for as long as it is on screen). `planted: true` marks a report produced while the agent was turned; the file remembers, the player is never told.

This is the one asset in `RUNTIME_ONLY_JSON_ASSET_FILES` whose default is an **object**, which is why the server's write-path shape guard derives `expectsArray` from `JSON_ASSET_DEFAULTS` rather than from registry membership (`server/libraryStore.js`, and `server/runtimeJsonShape.test.js` pins it).

Espionage resolves once per turn in `applySimulationResult`, **after** the standing-order/unit-volume pipeline, so an agent's round is decided against where forces actually ended up. It is deterministic, seeded on `${round}:${key}` with four roll keys — `:detect`, `:turn`, `:suspect`, `:deploy`. **Those key strings are save-compatibility surface**: changing one makes every existing save replay its next round differently. Its events are appended to `freshEvents` *before* `nextEvents` is built, so they persist to the event log.

### 2f. Turn machinery & narrative history

| Field | Type | Default | Meaning (normalizer) |
|---|---|---|---|
| `activeCatalyst` | `Catalyst \| null` | `null` | A running branching scenario prompt: `{title,premise,opening,choices[],history[]}` (`normalizeCatalyst` `:264`). Advanced by `advanceActiveCatalyst` (`gameplay.js:1701`). |
| `actionSuggestions` | `Topic[]` | `[]` | AI-proposed action topics `{id,title,description,actions[]}` (`:777`); cleared each jump (`gameplay.js:1339`). |
| `simulationHistory` | `Turn[]` | `[]` | Last ≤12 turns: `{catalyst,date,eventIds[],fallbackReason,fromDate,mode,plannedActions[],round,summary,source,toDate}` (built `gameplay.js:1343`, normalized `:875`). |
| `consolidatedHistory` | `Summary[]` | `[]` | Compacted older-turn summaries `{summary,chatIds[],throughDate,throughEventId,throughRound,source,createdAt}` (`normalizeConsolidatedHistory` `:796`) — produced by `compactHistoryIfNeeded`. |
| `lastJumpMode` | `string` | `""` | Mode of the most recent jump (`jump`/`auto`/…) (`:867`). |
| `lastJumpSummary` | `string` | `""` | One-line summary of the last jump. |
| `lastJumpTargetDate` | `string` | `""` | Target date the last jump advanced to. |

> `ownerSchema` is a **document/editor** marker (`src/Editor/documentMigration.js:27`), not a runtime `world.json` field — it gates the editor's owner-code→name migration. A game's `world.json` inherits it only as an inert pass-through if the seed carried it.

---

## 3. `normalizeWorldState` — the single normalizer

`normalizeWorldState(world)` (`src/runtime/gameState.js:815`) is called on **every** read and write of `world.json`, so no downstream code has to defend against missing/malformed fields. Behavior:

1. Spread defaults then the raw doc: `{ ...WORLD_DEFAULTS, ...nextWorld, … }` (`:856`). Unknown fields (scenario extras) survive; known fields are then overwritten by their normalized versions.
2. Rebuild the maps with blank-key/blank-value filtering: `regionOwnershipOverrides`, `polityOverrides`, `regionClaimants` (≤4), `internationalReputation` (clamped ints), `countryTags` (via `normalizeTagList`).
3. Normalize the arrays: `units`, `pendingUnitOrders` (pruned against the just-normalized `units`), `markers`, `actionSuggestions`, `simulationHistory`, `consolidatedHistory`, and singletons `activeCatalyst`, label config, `notes`, `language`, `simulationRules`, `startingTimelineText`.

`writeWorldState` (`:988`) normalizes, calls `enqueueContentStrings(polityOverrides)` to translate edited names on write, then `writeJson(JSON_URLS.world, …, { pretty:true })`.

**Namespace caution (`:845`):** `countryTags`, `internationalReputation`, `polityOverrides`, and `colors` are all keyed by country **NAME verbatim**. An earlier version uppercased `countryTags` keys only, so a single `change.code` could land under two keys (`countryTags["RUSSIA"]` vs `internationalReputation["Russia"]`) — harmless while owners were uppercase GADM codes, a silent desync once owners are names. Keep the casing consistent.

---

## 4. `isPolityLandless` — "does this polity hold territory?"

`isPolityLandless(world, code)` (`src/runtime/gameState.js:917`) is the single source of truth for "landless" (a government-in-exile, movement, or stateless person), used by both the AI prompt (`buildPlayerPolityRegionsText`) and the flag resolvers (a landless polity must NOT borrow the code-derived country flag). The subtlety: owning a region via an override = has land; but a scenario that ships **no** `regionOwnershipOverrides` at all means every polity owns its country through the base map tiles (a stock modern map), which is NOT landless (`:928`).

---

## 5. AI "impacts" — the mutation vocabulary

Every event may carry an `impacts` object (`normalizeEventImpacts`, `src/runtime/gameState.js:669`) whose five arrays are the ONLY way the AI mutates world state. Each is independently normalized and invalid entries are dropped.

| Impact array | Element normalizer | Applied by | Effect on `world.json` |
|---|---|---|---|
| `regionClaims` | `normalizeRegionClaim` → `{regionId,claimantCode,drop,note}` | `applyPolityAndTerritoryImpacts` | Appends to / removes from `regionClaimants[regionId]` (de-duplicated case-insensitively; the key is deleted at zero). Applied **before** `regionTransfers`, so a region claimed and handed over in the same jump ends settled rather than striped. Until this existed nothing but the map editor and the cheats panel could raise a dispute, so a unilateral claim had nowhere to go but a project. |
| `regionTransfers` | `normalizeRegionTransfer` (`:420`) → `{regionId,toCode,fromCode,regionName,note}` | inline loop (`:1048`) | `regionOwnershipOverrides[regionId] = toCode`. |
| `polityChanges` | `normalizePolityChange` (`:442`) → `{code,name,color,aliases[],note,reputation,tags}` | inline loop (`:1052`) | Upserts `polityOverrides[code]`; also writes `colors[code]` (§7), `internationalReputation[code]`, `countryTags[code]`. |
| `unitOps` | `normalizeUnitOp` (`:592`) → `spawn\|move\|strength\|remove` | `applyUnitOps` (`:638`) | Rewrites `world.units`. |
| `markerOps` | `normalizeMarkerOp` (`:549`) → `build\|remove` | `applyMarkerOps` (`:575`) | Rewrites `world.markers`. |
| `projectOps` | `normalizeProjectOp` → `create\|update\|milestone\|close\|remove` | `applyProjectOps` (via `releaseProjectCompletionEffects` first) | Rewrites `world.projects`. **Ending a project keeps it:** `complete`/`cancel`/`fail` (plus the aliases `finish`, `abandon`, `shelve`) all resolve to one `close` op that sets a closed status and leaves the entry on the board under the Closed view — success marks pending milestones `done` and forces 100%, anything else marks them `missed` and preserves the progress actually reached. Only `remove`/`delete`/`drop` erase, which is for an entry that should never have been opened. `cancel` used to alias to `remove`, so the most natural way for a model to say "we gave up on this" silently deleted it instead of recording it. Matches by id, then case-insensitive name; an op against a project that does not exist is **dropped**, never auto-created. A `create` naming a project already on the board is folded in as an **update that merges only the fields the op actually carried**, so a chatty turn can neither fill the board with duplicates nor reset what it failed to restate. That merge is driven by a `provided` field list recorded at normalize time (a JSON-safe array, because normalized ops are persisted in `events.json` and replayed by the staged reveal): once an op is normalized, every field is populated, so there is otherwise no way to tell `progress: 0` from "progress was not mentioned". Before this, a jump that merely mentioned a running operation reset `ongoing` to false, `progress` to 0, `status` to active, `secrecy` to public, emptied `tags`, and demoted an operation to a project. `tags` follows the `countryTags` rule — an array replaces wholesale, absent means unchanged. |
| `createdChats` | `normalizeChats` (`:415`) | turn writer (`gameplay.js:1364`) | New diplomacy threads pushed into `chat.json` (not `world`). |
| `actionIds` | string list (`:683`) | turn writer | Which queued actions this event resolves. |

### `normalizePolityChange` semantics (`:442`)

- `reputation`: parsed and clamped to `[0,100]` int, else `null` ("unchanged").
- `tags`: `Array.isArray` → `normalizeTagList`; otherwise `null`. This distinction is load-bearing — the AI sends the COMPLETE new tag list, so `[]` means "this country now has no defining tags" (must drop them) while `null`/undefined means "unchanged" (`:459`). `applyEventImpactsToWorld` deletes the key on `[]` and sets it on a non-empty list (`:1089`).

### `applyUnitOps` (`:638`) — pure

`spawn` (marks `source:"ai"`) pushes; `move` sets `lng/lat/regionId`, `status:"moving"`; `strength` clamps and marks `defeated` at ≤0; `remove` filters by id. Ops on unknown ids are silently ignored; the final list drops any unit with `strength ≤ 0` or `status === "defeated"` (`:666`).

### `applyMarkerOps` (`:575`) — pure

`build` replaces any existing marker of the same name (case-insensitive) rather than stacking duplicates; `remove` matches by id first, then exact name (the AI usually knows the name, rarely the id).

---

## 6. `game.json` — the clock (`GAME_DEFAULTS`)

`GAME_DEFAULTS` (`src/runtime/gameState.js:6`), normalized by `normalizeGameData` (`:956`):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `country` | `string` | `""` | The player's owner code/name. |
| `difficulty` | `string` | `"standard"` | Feeds `difficultyDirective` in the prompt. |
| `gameDate` | `string` | `""` | Current in-game date (`YYYY-MM-DD`), advanced each jump to `result.stopDate`. |
| `startDate` | `string` | `""` | Scenario start date. |
| `language` | `string` | `"English"` | UI/content language. |
| `round` | `int > 0` | `1` | Turn counter, `+1` each jump (`gameplay.js:1324`). |

`canonicalizeDateString` (`:939`) repairs `gameDate`/`startDate` from loose formats (`"2016-12-31T00:00:00.000Z"`, `"December 31, 2016"`) back to strict `YYYY-MM-DD`. Without it, `addIsoDays` rejects the value and every jump computes `target == origin`, freezing the clock while the model re-simulates the past. Deliberately non-Gregorian dates (`"1200 BCE"`) don't parse and pass through untouched.

---

## 7. `colors.json` — the palette (a sibling, not a world field)

Colors live in a separate asset (`code → [r,g,b]`), not inside `world.json`. `applyEventImpactsToWorld` takes `colors` as an input and returns the mutated palette alongside the world (`:1043`, `:1107`): when a `polityChange` carries a 6-hex `color`, it is parsed to `[r,g,b]` and written to `nextColors[change.code]` (`:1067`). The turn writer persists both in the same `Promise.all` (`gameplay.js:1402`). A colors write invalidates the memoized `getNationColors` cache and dispatches `oh:colors-updated` so the map repaints mid-session without a reload (`assets.js:177`).

---

## 8. `applyEventImpactsToWorld` — folding impacts into state

`applyEventImpactsToWorld({ colors, events, world })` (`src/runtime/gameState.js:1043`) is a **pure** function returning `{ colors, world }`. It clones the inputs, normalizes the world and the events, then for each event applies (in order): region transfers → polity changes (name/color/reputation/tags + palette) → unit ops → marker ops. It does NOT persist — the caller writes. Two callers:

1. **The turn writer** — `applySimulationResult` (`src/Game/AI/gameplay.js:1305`). It builds the next world (merging `activeCatalyst`, `lastJump*`, and the new `simulationHistory` head), calls `applyEventImpactsToWorld` with the generated events (`:1333`), optionally compacts history, then persists everything in one `Promise.all`: `writeActionsState`, `writeChatsState`, `writeEventsState`, `writeGameData`, `writeJson(colors)`, `writeWorldState` (`:1397`). It then captures a rollback snapshot of the pre-jump state (`captureRollbackSnapshot`, `:1407`).
2. **The staged reveal** — `src/Game/GameUI/time.jsx:1617`. As a turn's events are revealed one at a time, it re-applies impacts up to the last revealed event onto `stagedBase.world` and calls `setWorldStateOverride(stagedWorld)` / `setUnitsOverride(...)` so the map shows the world as of that event. It passes `colors: {}` because it only needs the world, not the palette. When staging ends (or on unmount) both overrides are cleared to `null` (`:1612`, `:1629`).

---

## 9. The 5-second poll — `useWorldState`

`src/Game/Map/useWorldState.js` is a **singleton** poll shared by all map consumers (it replaced 4 redundant `world.json` requests).

| Piece | Location | Behavior |
|---|---|---|
| `POLL_MS` | `:7` | 5000 ms interval. |
| `sharedState` / `pollTimer` / `subscribers` | `:8`–`:10` | One interval, one result set, a `Set` of subscriber callbacks. |
| `poll()` | `:31` | `readJson(JSON_URLS.world, { defaultValue:{}, force:true })`, then notifies subscribers. `force:true` bypasses the value cache; concurrent forced reads to the same URL are still batched into one fetch (`assets.js:560`). On error → `{}`. |
| `startPolling` / `stopPolling` | `:40`,`:46` | First subscriber starts the timer (immediate `poll()` then interval); last unsubscribe clears it (`:79`). |
| `overrideState` / `setWorldStateOverride` | `:17`,`:25` | Staged-reveal override. `effectiveState() = overrideState ?? sharedState` (`:19`). The poll keeps running underneath — `world.json` stays authoritative — and clearing to `null` snaps consumers back to live state. |
| `getWorldStateSnapshot` | `:23` | Read-only accessor of the effective state (peer of `unitsController.getUnits`). |

### Content-compare / referential-identity guard (`:83`–`:124`)

`useWorldState` derives a small object of the fields the map cares about (`worldState`, `worldKnown`, `customRegions`, `customCities`, `basemap`, `background`, `regionOwnershipOverrides`, `regionClaimants`, `polityOverrides`, `markers`, `labelFont`, `labelHaloColor`, `labelTextColor`) and, if it is **content-equal** to the previous derived object, RETURNS THE PREVIOUS OBJECT REFERENCE. This keeps `useMemo`/`useEffect` consumers from re-running every 5 seconds when nothing meaningful changed. Comparison strategy:

- Scalars (`basemap`, `background`, label config, booleans): `===`.
- `regionOwnershipOverrides`, `polityOverrides`: `areEqualShallow` (`:56`) — key count + per-key `===` (values are strings/stable object refs).
- `regionClaimants` and `markers`: `JSON.stringify` content-compare (`:113`,`:115`) — their values are fresh arrays/objects every poll, so reference equality would churn every 5 s; the payloads are tiny. `EMPTY_MARKERS` (`:54`) is a stable `[]` so a marker-less world never churns the memo.

`worldState` itself is the raw polled object (still replaced each poll), but the sibling derived fields drive the map layers and are identity-stable.

### Units peer-poll — `unitsController.js`

`src/Game/Map/unitsController.js` runs its OWN 5-second `setInterval` (`startUnitsSync`, `:90`) that force-reads `world.json` + `game.json` and republishes `world.units` to a pub/sub (`:70`). The player's only mutations are **deploy**, **disband** and **request orders** — manual movement and manual combat were removed, so where forces go and what happens when they meet belongs to the AI and to `advanceStandingOrders`. `deployUnit` and `removeUnit` apply optimistically in memory and `commit` does a read-modify-write of `world.units` **preserving the rest of world state** (`{ ...world, units: nextUnits }`), guarded by a `busy` flag so the poll doesn't clobber a mid-commit write. A deploy and a `requestUnitOrders` both `queueOrder` (an action) so the AI adjudicates them on the next jump; a deploy carries a `unitRevert` describing how to undo it if the player deletes the action first (`normalizeUnitRevert` in `gameState.js`). `revertUnitOrder` keeps its `lng`/`lat`/`status`/`pendingOrderId` branches for actions queued by the old manual-order UI that are still sitting in existing saves. It exposes its own `setUnitsOverride`/`getUnits` (`:53`,`:58`) mirroring the world-state override for staged reveals.

---

## 10. Country tags — `src/runtime/countryTags.js`

A dependency-free module (imported by the editor, the game, and the server) that owns the two rules both halves must agree on: how a tag list is normalized and which source wins.

| Export | Location | Purpose |
|---|---|---|
| `MAX_TAGS` / `MAX_TAG_LEN` | `:12`,`:13` | 8 tags, 32 chars each. |
| `TAG_SUGGESTIONS` | `:19` | Open-vocabulary suggestions (`socialist`, `authoritarian`, `nato-aligned`, …) so common cases converge on one spelling. |
| `normalizeTagList(list, opts)` | `:32` | Trim, collapse whitespace, cap length, drop blanks, dedupe case-insensitively, cap count. Non-strings dropped (a stray number means a palette `[r,g,b]` leaked in). |
| `resolveCountryTags(baseTags, world, country)` | `:55` | The tags in force NOW for one country: the AI's live `world.countryTags[name]` if it has ever set one, ELSE the author's `tags.json` list. **Not a merge** — a revolution that dropped "socialist" must not have it restored by the scenario file underneath. Keyed by country NAME verbatim. |
| `resolveAllCountryTags(baseTags, world)` | `:65` | Every tagged country, live winning over author, for the world summary the model reads. Emits keys verbatim (no uppercasing — see the desync note). |

Author starting tags come from `getNationTags` (`assets.js:933`, the scenario's `tags.json`); live changes land in `world.countryTags` via `polityChanges.tags` (§5/§8). See [Country tags](country-tags.md).

---

## 11. Read / write API surface (`gameState.js`)

| Function | Line | Notes |
|---|---|---|
| `readWorldState({force})` | `:985` | `readJson(world)` → `normalizeWorldState`. |
| `writeWorldState(world, opts)` | `:988` | normalize → `enqueueContentStrings(polityOverrides)` → `writeJson(pretty)`. |
| `readGameData` / `writeGameData` | `:997`,`:1000` | `normalizeGameData` on both ends. |
| `readActionsState` / `writeActionsState` | `:1003`,`:1006` | `normalizeActions`. |
| `readEventsState` / `writeEventsState` | `:1009`,`:1012` | `normalizeEvents`; write enqueues content strings. |
| `readChatsState` / `writeChatsState` | `:1019`,`:1022` | `normalizeChats`. |
| `readGameStateBundle` | `:1025` | `Promise.all` of all five. |
| `applyEventImpactsToWorld` | `:1043` | Pure fold of impacts → `{colors, world}`. |
| `applyUnitOps` / `applyMarkerOps` | `:638`,`:575` | Pure list mutators. |
| `isPolityLandless` | `:917` | Territory check. |

All reads/writes route through `src/runtime/assets.js` `readJson`/`writeJson`, which layer value-caching, request batching, Cache-Storage persistence with a HEAD freshness check, and derived-cache invalidation (`invalidateDerivedCachesForWrite`, `assets.js:177`) on top of the raw `/api/runtime/json/*` endpoints.
