# World State & Turn Model

Open Historia keeps a running game in five plain-JSON documents served from a per-scenario/per-game runtime endpoint. The largest and most important is **`world.json`** — the political map plus everything the AI has changed since the scenario began (region ownership, polities, colors, tags, reputation, units, structures, interactive events, history). The **turn loop** is a "time jump": the AI returns a batch of `events`, each carrying machine-readable `impacts`, and `applyEventImpactsToWorld` folds those impacts into world state before it is persisted; the map re-renders because the write announces itself and `useWorldState` is listening.

Core files: `src/runtime/gameState.js` (state shape, normalizers, impact application), `src/Game/Map/useWorldState.js` (the map store), `src/runtime/runtimeStore.js` (the HUD store), `src/Game/Map/unitsController.js` (the units store), `src/runtime/countryTags.js` (tag rules), `src/runtime/assets.js` (read/write/cache plumbing), `src/Game/AI/gameplay.js` (`applySimulationResult`, the turn writer).

Related pages: [Country tags](world-state.md) · [Map rendering & Nations layer](game-map.md) · [Units & combat](world-state.md) · [AI turn / time jump](ai-overview.md) · [Scenario library](runtime-services.md).

## Glossary

The words below mean one thing each. Use them in code, prompts, tickets and PRs, and avoid the listed alternatives.

**Project**:
A deliberate effort one polity runs towards a goal, such as a research programme, a construction or a sustained campaign. It can complete, fail or be abandoned.
_Avoid_: Programme, initiative, plan (as the term for the record itself)

**Operation**:
A Project with a military or covert purpose.
_Avoid_: Mission, op

**Board**:
The player-visible list of Projects and Operations, including foreign ones the player's services know about.
_Avoid_: Projects & Operations panel, tracker

**Board entry**:
One Project or Operation on the Board.
_Avoid_: Effort, item, card

**Storyline**:
An ongoing situation no single polity controls, with unresolved stakes, such as a war, a crisis, a rivalry or unrest. Hidden from the player. A Project can cause or feed a Storyline, but the same thing is never both.
_Avoid_: Process, thread, arc

### The map

**Structure**:
Anything physical the campaign builds and the map draws in one place: a base, shipyard, data centre, ground station, reactor, embassy. Kept in `world.markers[]` and written by an event's `markerOps`, so **marker** is the field name for the record while Structure is the thing itself. A satellite is not one; the ground station that serves it is. Something that moves is a unit.
_Avoid_: Feature, facility, building (as the term for the record)

### Library

**Scenario**:
An authored starting position — the map, the polities and the opening state — that a Game is started from. Never written to during play, so one Scenario can seed many Games.
_Avoid_: Preset, map, mod

**Game**:
One playthrough of a Scenario: everything the player has done and everything the world has become since it started. The thing a player names, continues, archives and exports.
_Avoid_: Save, save game, campaign, session (as the term for the record)

### Events

**Canonical event**:
Something the simulation accepted as having happened during a jump, whether or not the player sees it on the timeline.
_Avoid_: Accepted card

**Player event**:
A Canonical event that involves the player's polity in any way: something it does, something done to it or said about it, or something that happens inside its territory. Every other event is a World event.
_Avoid_: Player-related event, player-sphere event

**World event**:
A Canonical event that does not involve the player's polity at all, such as a crisis between two other powers in a theatre the player is not in.
_Avoid_: Wider-world event, background event

**Player focus**:
How much of each jump belongs to Player events: World first, Balanced, Focused or Spotlight. The Scenario sets the level a new Game starts on and the player changes it for their own Game, like any other feature setting. It is a minimum share that applies only as far as the player has something going on; in a quiet stretch the World fills the jump.
_Avoid_: Player share, player weighting, attention balance

**Hidden event**:
A Canonical event kept off the timeline because it was routine, low-value or already covered. It still happened. Distinct from a rejected event, which the simulation judged untrue and which never happened.
_Avoid_: Dropped event (for anything that still happened)

### Diagnostics

**Diagnostics log**:
The one log a player sends with a bug report: what they did and what went wrong, in order. It is kept on every platform, and on desktop it also carries the Desktop log's entries.
_Avoid_: Debug log, app log, server log

**Desktop log**:
Where the desktop app itself and its local server note their own start-up, update and server errors, because they cannot reach the Diagnostics log directly. It is not a second log: its entries appear in the Diagnostics log.
_Avoid_: app.log (as the name of a log), server log

**Detailed logging**:
The switch that adds whole AI exchanges, conversations and world changes to the Diagnostics log. Off by default.
_Avoid_: Verbose mode, debug mode

**Logging file**:
The single text file a player saves from the Diagnostics log to attach to a report: at most 1 MB of log, with the problem being reported on top, and never more than 2 MB in all.
_Avoid_: Debug report, bug report (for the file itself)

**Prompt fingerprint**:
The size and a short hash of each section of a prompt sent to the model, noted for every attempt under Detailed logging, so a prompt rebuilt from the save can be checked against the one actually sent.
_Avoid_: Prompt dump

### AI access

**Fallback list**:
The player's ordered list of models to answer AI calls, which may mix providers. Every call starts at the top — every call, whatever short mark an entry picked up a moment ago — and uses the first entry that answers. It moves down only when an entry cannot answer, passes over a Spent entry until its reset, and never spreads calls across entries to get more usage.
_Avoid_: Rotator, rotation, key rotation, model chain

**Connection**:
A saved way to reach one provider: which provider it is, a name the player gives it, its key, and its endpoint when the provider needs one. Many Fallback entries can share one Connection.
_Avoid_: Profile, preset, account

**Fallback entry**:
One Connection and one model, at one place in the Fallback list. A task that has its own pick names a Fallback entry: it tries that entry first, then the list from the top.
_Avoid_: Slot, route, step

**Spent**:
A Fallback list entry that has used up its allowance. Its row says so until its allowance resets, it answers again, or the player resets it. Calls go round it while the mark holds — the provider has already said it cannot answer — but never drop it: it is tried last when nothing else has answered.
_Avoid_: Exhausted, maxed out, dead

**Rate limited**:
Refused for the moment because of too many requests in a short window. Waiting fixes it, so a Rate limited entry is not Spent.
_Avoid_: Quota exceeded (for a short-window limit)

**Unusable**:
A Fallback entry that failed in a way waiting cannot fix, such as a rejected key or a model the provider does not know. It is skipped until the player edits it, and it shows the player what went wrong.
_Avoid_: Broken, Spent (for this case)

### Subordination

**Puppet**:
A polity whose foreign or domestic will is directed by another. It remains a separate country throughout: it holds its own territory, keeps its own sovereignty, and paints in its own colour. A Puppet is never a region-level fact.

The whole system is optional: a scenario switches it off with the **Puppet states** feature (`server/gameFeatures.js`), and a game cloned from that scenario may decide for itself. Off, nothing can be made another's Puppet — not by the simulator, the Game Master, or the scenario's own start date — no Demand can be made or answered, and no surface mentions subordination. The `puppets` ledger is left alone, so a game switched back on finds its arrangements as it left them.
_Avoid_: Vassal, satellite state, client state, subject (as the term for the record)

**Overlord**:
The polity directing a Puppet. One Puppet has at most one Overlord; one Overlord may hold many.
_Avoid_: Suzerain, master, patron, parent

**Loyalty**:
How far a Puppet accepts its Overlord's direction, 0-100. Always hidden, even where the subordination itself is open knowledge, and shown to the player only as a band.
_Avoid_: Obedience, compliance, satisfaction, stability

**Demand**:
An Overlord telling its own Puppet to do something, in the one-on-one conversation between them. The Puppet accepts it, refuses it, or offers an alternative, which the Overlord either takes or answers by demanding again. Only a refusal costs the Puppet Loyalty.
_Avoid_: Order, request, ultimatum (as the term for the record)

---

## 1. Storage model: the runtime JSON assets

All mutable game state lives behind a small set of URLs built in `src/runtime/assets.js` (`JSON_URLS`) and rebuilt on every scenario/game switch by `setRuntimeAssetEndpoints` (`src/runtime/assets.js`). Each URL carries a `?v=<token>` cache-buster; changing the token (a library mutation) sweeps the in-memory value caches so the next read re-fetches (`src/runtime/assets.js`).

| Asset key | URL (path) | Read / write helpers (`gameState.js`) | Holds |
|---|---|---|---|
| `world` | `/api/runtime/json/world` | `readWorldState` / `writeWorldState` | The political map + AI-mutated state (this page). |
| `game` | `/api/runtime/json/game` | `readGameData` / `writeGameData` | Player country, clock, round, difficulty (§6). |
| `events` | `/api/runtime/json/events` | `readEventsState` / `writeEventsState` | Timeline of AI/scenario events, each with `impacts`. |
| `actions` | `/api/runtime/json/actions` | `readActionsState` / `writeActionsState` | Player/queued orders awaiting the next jump. |
| `chat` | `/api/runtime/json/chat` | `readChatsState` / `writeChatsState` | Diplomacy conversation threads. |
| `colors` | `/api/runtime/json/colors` | plain `writeJson(JSON_URLS.colors, …)` / `getNationColors` (`assets.js`) | `code → [r,g,b]` palette (sibling of `world`, not inside it). |
| `flags` | `/api/runtime/json/flags` | `getNationFlags` (`assets.js`) | Author flags `code → PNG data URL`. |
| `tags` | `/api/runtime/json/tags` | `getNationTags` (`assets.js`) | Author STARTING country tags (§10). |
| `regionsGeojson` / `citiesGeojson` | `/api/runtime/json/regionsGeojson` … | via `loadRegionCatalog` (`assets.js`) | Custom drawn geometry (never value-cached, see `isNoStoreJsonUrl`). |

`readGameStateBundle` (`src/runtime/gameState.js`) reads `actions`, `chats`, `events`, `game`, `world` in one `Promise.all` and is the standard "load everything" entry point. `viewAsSeen` turns such a bundle into the campaign **as the player has been shown it** while a skip is being revealed — for whatever speaks to the player; it is never written back (see [what the player has not been shown yet](ai-overview.md#what-the-player-has-not-been-shown-yet)).

A chat message a turn wrote — a note an event sent, a letter a document became — carries `eventId`, the event whose reveal shows it, and so does its entry in the thread's log. Which of the newest skip's events are still unseen is kept on the device (localStorage `oh_unseen_turn_events`, `runtime/unseenEvents.js`), not in the save: it is the player's progress through the record, not part of the record.

### Games vs scenarios

The same asset keys are served from two different server roots (`src/runtime/library.js`):

- **Scenarios** — `/api/scenarios/*`. The immutable authored seed (WWII preset, a hub download, an editor export). `world.json` here is the STARTING position produced by the editor (`src/Editor/exportPreset.js`).
- **Games** — `/api/games/*`. A live playthrough. Selecting a scenario spawns a game whose `world.json` starts as a copy of the scenario's and is then mutated in place by every jump.

Only a **game's** `world.json` is written during play; the scenario copy stays pristine so the same scenario can seed many games. `setRuntimeAssetEndpoints` points `JSON_URLS.*` at whichever is active (the runtime token encodes it). `saveGame` in `src/Game/GameUI/libraryBar.jsx` writes `world` **whole** (never a shallow `worldPatch`, which would drop `polityOverrides`/`ownerCodes`/`regionOwnershipOverrides` and wipe the map).

---

## 2. `world.json` shape — field table

`WORLD_DEFAULTS` (`src/runtime/gameState.js`) is the authoritative default object; `normalizeWorldState` spreads `{...WORLD_DEFAULTS,...world }` and then re-derives the structured fields. Anything **not** in `WORLD_DEFAULTS` (e.g. `customRegions`, `basemap`, `ownerCodes`) passes through untouched from the stored document — these are scenario-authored or game-appended fields the normalizer never rewrites.

### 2a. Core political-map fields

| Field | Type | Default | Meaning / data flow |
|---|---|---|---|
| `regionOwnershipOverrides` | `{ regionId: ownerCode }` | `{}` | THE re-ownership map: which polity owns each region above the base tiles. Written by AI `regionTransfers` (§8) and by cheats. Read by the Nations layer to paint fills, and by `isPolityLandless`. Normalized to string→string, blanks dropped. |
| `polityOverrides` | `{ name: {code,name,aliases[],formerNames?[],color,note,status?,mapRefs?{gadm0[]},mapLabel?,mapDistinctLabel?,verbatim?} }` | `{}` | Declared/renamed polities: new countries, renames, colors, alt-names. **A polity is keyed by its name and `name` equals the key; a rename re-keys the country everywhere** (`server/polityRename.js` `renamePolityInWorld`, reached from an event's `polityChanges` — a `rename`, or an `update` carrying a new `name` — and from the Workshop) with the old name kept in `formerNames`, which `buildOwnerAliasMap` folds onto the country and `resolveCountryTags` uses to find the scenario's starting tags. In every map keyed by names (colours, flags, stats, tags, reputation, intelligence, the standing goal) the country's own value moves to the new name and anything already under it is dropped: no other polity may hold that name, so it is a leftover, such as an unused stock-palette colour, and it must not repaint or restate the renamed country. A save whose record still shows a display name over a different key is re-keyed on its next apply (`displayNameMigrations`), except onto a real country's name that was never its own. Written by AI `polityChanges` and the editor. `enqueueContentStrings` translates names on write. Normalized by `normalizePolityOverride`. Feeds `loadCountryNames` (`assets.js`) and every name/flag resolver. |
| `regionClaimants` | `{ regionId: string[] }` (≤4) | `{}` | Marks a region DISPUTED — striped in the administrator's + claimants' colors. World-data equivalent of a `claimants` list on the geojson feature, and WINS over feature props. Normalized (sliced to 4). Sparse: a row only while a region is disputed. |
| `settledRegionClaims` | `string[]` (region ids) | `[]` | Regions whose dispute the world has ended — a claim dropped, a contest cleared, a clean hand-over (`settleRegionClaims` in `gameState.js`). The map shows a settled region as undisputed instead of falling back to the `claimants` its geojson feature bakes in (the built-in map bakes 109), which is how an ended dispute used to come back. A region disputed again leaves the list; normalized unique, never one with a live row. |
| `regionSovereigntyOverrides` | `{ regionId: ownerCode }` | `{}` | The LEGAL sovereign of a region where it differs from the polity in `regionOwnershipOverrides` that administers it — an occupation, a displaced government's homeland. Sparse: normal territory has no row (a row equal to the controller is dropped on normalisation). Written by legal `regionTransfers` (which move the title, and administration unless a third party holds the ground) and anchored by de-facto `regionControlOps` before control flips, so the occupied region stays striped in its sovereign's colour. Read by the Region Inspector, the country panel and the Stats territorial scope. |
| `ownerCodes` | `string[]` | *(not defaulted; pass-through)* | The playable factions list — who can be picked/played, including landless ones. Appended by `saveGame` (`libraryBar.jsx`), read by cheats (`cheats.jsx`) to enumerate owners. |
| `customRegions` | `boolean` | *(pass-through)* | When true, render political fills/borders/labels from the scenario's `regions.geojson` instead of the stock modern overlay. Set by the editor export (`exportPreset.js`) — forced on whenever there's custom geometry OR a custom background. Read in `useWorldState` and the Nations layer. |
| `customCities` | `boolean` | *(pass-through)* | Render authored cities instead of the modern city set (`exportPreset.js`). Surfaced by `useWorldState`. |
| `basemap` | `string \| null` | *(pass-through)* | ESRI basemap preset id (`ESRI_BASEMAPS`, `assets.js`); falls back to `ocean` in-game. |
| `background` / `backgroundData` | `string \| null` / payload | *(pass-through)* | Custom map background (image-by-extent or vector overlay) that replaces Earth; heavy payload rides in a separate scenario asset (`exportPreset.js`). |

### 2b. AI-evolved diplomacy / identity fields

| Field | Type | Default | Meaning / data flow |
|---|---|---|---|
| `internationalReputation` | `{ code: 0–100 }` | `{}` | Per-polity reputation, authoritative (not the on-demand stat sheet it was first read from). Evolved by AI `polityChanges.reputation` each turn and fed back into prompts. Normalized/clamped to `[0,100]` int. Keyed by country NAME verbatim. |
| `countryTags` | `{ country: string[] }` | `{}` | Per-country tags the AI has CHANGED since the scenario started. Wins over the author's `tags.json` where present (see `resolveCountryTags`, `countryTags.js`). Keyed by country NAME verbatim (same namespace as reputation/colors — see the desync warning at). Normalized via `normalizeTagList`. |
| `notes` | `string` | `""` | Free-form world notes. |

### 2b-bis. Canonical ledgers — wars, relations, agreements, storylines

Three engine-owned arrays carry the political facts the simulation used to keep only as prose. The AI never writes them directly: a jump payload carries compact text lines (`warUpdates`, `relationUpdates`, `agreementUpdates` — see ai-schemas.md §4.7) that `src/Game/AI/nativeWarLedger.js` and `src/Game/AI/nativeDiplomaticDirector.js` validate against the current world, bind to the event that caused them, and fold in once per turn (`applySimulationResult`).

| Field | Shape | Notes |
|---|---|---|
| `wars` | `[{ id, title, status, sideA[], sideB[], startedDate, endedDate, lastUpdatedDate, cause, note, sourceEventIds[], createdRound, updatedRound }]` | `status` ∈ active / ceasefire / ended. **The only source of belligerency:** an event that narrates battlefield combat must carry `warId` and `combatants` naming polities from both sides of an *active* war, or the segment is rejected (on the final attempt the combat event is dropped instead). Transitions are explicit: start, join-a, join-b, leave, ceasefire, resume, end. |
| `relations` | `[{ id, a, b, score, status, summary, lastUpdatedDate, sourceEventIds[], createdRound, updatedRound }]` | Sparse, one row per unordered pair; `score` −100..100 with `status` derived from it (friendly ≥ 55, cordial ≥ 20, neutral ≥ −10, cautious ≥ −30, strained ≥ −60, else hostile / rival). An untracked pair is *unknown*, not zero. A publicly exposed spy ring lowers the pair's score by 20. |
| `agreements` | `[{ id, title, type, status, parties[], startedDate, endedDate, lastUpdatedDate, terms, guarantor?, beneficiary?, sourceEventIds[], createdRound, updatedRound }]` | Formal instruments: alliance, mutual_defense, guarantee, non_aggression, friendship_consultation, trade_economic, military_cooperation, military_access, neutrality, peace_settlement, other. `status` ∈ active / suspended / ended / expired. In simulation, lifecycle bookkeeping is repaired rather than fatal: a `start` for an agreement already in force becomes an update/resume or is dropped, and an update/suspend/resume/end/expire naming an id the ledger never recorded is re-aimed only at the single agreement with exactly the same resolved parties, the same named type (and a guarantee's direction) and a status the verb can act on — otherwise the row is dropped and the turn kept, since an unrecorded instrument has nothing to end (`nativeDiplomaticDirector.js`, `normalizeUnknownAgreementLifecycle`). The GM preview stays fail-closed. |
| `storylines` | `[{ id, kind, title, participants[], status, pressure, momentum, startedDate, accountedThroughDate, lastUpdatedDate, lastVisibleEventDate, nextReviewDate, state, drivers[], constraints[], sourceEventIds[], createdRound, updatedRound }]` | Persistent world processes, the hidden state the native world director advances between turns (ai-prompts.md §7.12c). `status` ∈ active / dormant / resolved; `pressure` (unresolved stakes) and `momentum` (rate of change) 0–100; the director schedules attention from `nextReviewDate`; events carry `storylineIds[]`. ≤96, written by `applyWorldStorylineUpdates` from a jump's compact `storylineUpdates` lines, a GM transaction or the pregame bootstrap (every live Round-One war gets a `storyline-<warId>` mirror). |
| `puppets` | `[{ id, overlord, puppet, kind, loyalty, secrecy, knownTo[], status, startedDate, endedDate, lastUpdatedDate, sourceEventIds[], createdRound, updatedRound }]` | Subordinations: who directs whom. **Directional**, unlike a relation, and **partly secret**, unlike an agreement — which is why it is neither (`docs/adr/0004-puppet-ledger-and-secrecy.md`). `kind` ∈ protectorate / satellite / client, and states WHICH POWERS the Overlord holds, not a degree: there is deliberately no `occupied-government`, because an occupation is a region-level fact `regionSovereigntyOverrides` already carries. `secrecy` ∈ open / covert. `status` ∈ active / released / annexed / revolted. `loyalty` 0-100. `knownTo` is `[{ polity, learnedDate, seenStatus? }]` — who has learned a covert row and the status they **last saw**. A third party joins it only through an *active* agent inside either party (`revealPuppetsToSpies`); an agent still in place refreshes what its owner last saw, and with none the old belief stands, so a polity that learned something in 1948 goes on believing it after it lapsed. Entries are never pruned. Written only through the director's compact `puppetUpdates` lines (ai-schemas.md §4.7): `install`, `reclassify`, `loyalty`, `reveal` (one-way), `release`, `annex`, `revolt`, `suppress`. One Overlord per Puppet; no cycles; **no chains** — an install involving a polity that already holds or is held reparents one hop so nobody is a Puppet of a Puppet. ≤ 64, evicting ended rows first (oldest by `lastUpdatedDate`) because stale foreign knowledge depends on them surviving. A Puppet keeps its own territory and its own sovereignty: **nothing here is a fact about land**. What a given viewer may SEE of a row is `src/runtime/puppets.js`, which the country panel, the map popup card, the diplomacy markers and the advisor all share — and which is also where the **Puppet states** feature switches the whole system off, on the two roots every surface reads through. Rows are normalized and persisted whatever that feature says. |
| `chargedRefusals` | `string[]` | The refused demands the engine has already charged Loyalty for (`chargeRefusals`), as `<threadId>:<demandId>` — a demand id is only unique within its thread. A demand itself lives in its thread's log (`demand_made` / `demand_answered`, chatThreads.js); this is only the record that its refusal was paid for, so each is charged once however often a turn is retried. On the world and not the thread because every world writer re-reads before it writes, while chats are saved from whatever copy a panel holds — a flag kept on the thread was erased by the next stale save. Written only by the turn; never sent to a model. ≤ 512, most recent kept. |
| `diplomaticLedgerVersion` | number | 0 until `migrateLegacyDiplomaticState` has seeded relations and agreements from a pre-ledger save's treaty events and chats (it runs at the start of the next jump), or the pregame bootstrap wrote the ledgers for a fresh game. |

Events gained `warId` and `combatants[]` for the same rule. Polity names inside the ledgers share the owner namespace (`normalizeWorldState` resolves them through `polityIdentity.js`), so a renamed polity folds onto one identity. A fresh game with a "World Before Round One" briefing gets its Day-1 wars, relations and agreements from the pregame bootstrap (`maybeGeneratePregameHistory`, the `canonicalUpdates` envelope), so a campaign that opens mid-war starts with that war on the books. Espionage reads the ledgers too: a polity at war with the player is fully hostile, a ceasefire or a bad relation partly so (`applySimulationResult`, then `spycraft.js foreignDeployChance`).

### 2c. Country-label styling (§ read by the map)

Empty string = defaults (Georgia, white letters, half-black outline). The font renders from the PLAYER's local fonts — MapLibre v5 rasterizes each glyph client-side using the stack as a CSS `font-family` (there is no glyphs endpoint). Set in scenario settings; surfaced to the map by `useWorldState`.

| Field | Type | Default | Notes (`gameState.js`) |
|---|---|---|---|
| `labelFont` | `string` | `""` | CSS font-family stack for country labels (normalized). |
| `labelTextColor` | `string` | `""` | Label fill color. |
| `labelHaloColor` | `string` | `""` | Label outline color. |

### 2d. Simulation config & timeline text

| Field | Type | Default | Meaning |
|---|---|---|---|
| `simulationRules` | `string` | `""` | Author house-rules injected into the AI prompt (`exportPreset.js`). |
| `startingTimelineText` | `string` | `""` | Author-written opening timeline shown pre-game (`exportPreset.js`). |
| `language` | `string` | `"English"` | UI/content language for translation. |
| `allowedUnitTypes` | `string[]` | *(pass-through)* | Scenario whitelist of deployable troop types; `null`/empty = all allowed (read in `unitsController.js`). |

### 2e. Units and markers (ride inside world state)

Stored in world so they share every read/write/poll/normalize path with no server change.

| Field | Type | Default | Element shape (normalizer) |
|---|---|---|---|
| `units` | `Unit[]` | `[]` | `normalizeUnitEntry`: `{id,name,type,ownerCode,strength,lng,lat,regionId,status,note,source,orderId,createdAt,updatedAt}`. |
| `markers` | `Marker[]` | `[]` | `normalizeMarkerEntry`: built structures — `{id,name,kind,ownerCode,lng,lat,note,foundedAt,createdAt}`. |
| `reports` | `Report[]` | `[]` | `normalizeReports` (`runtime/reports.js`): documents held by the governments they were addressed to — `{id,title,body,visibleTo,from?,interceptedBy?,receivedFrom?,sourceEventId,createdRound,createdDate,dateline,origin}`. `visibleTo` null = public; `from` whose document it is; `receivedFrom` holder → the holder who passed them their copy; `interceptedBy` the services whose agents stole one (narrator-only). Written by `impacts.reports` (create / share); read through `audienceSeesScoped`. The backend file: no panel lists it — each document reaches the player through diplomacy, an agent or its event (`runtime/reportDelivery.js`). Bounded to 240. |
| `chatKnowledgeCursors` | `object` | `{}` | `"<threadId>|<polity>" -> the last message id that polity was shown of that thread` (AI/crossChatKnowledge.js). Keeps a leader from being handed the same exchange twice. |
| `gmChanges` | `GmChange[]` | `[]` | `normalizeGmChanges` (`runtime/gmChanges.js`): every change made outside the simulation, one line each — `{id,kind,summary,round,date,at}`, plus `{group,template,items}` for a change made in steps (a border redrawn region by region is one growing line). Newest first, bounded to 64. The skip that starts from `round` is told them once; a rollback restores the list as it was, so a skip it undid is told them again. `kind ∈ {gm-console,territory,polity,stats,feature,timeline,history,rollback,reminder,setting,other}`. |
| `simulationReminders` | `Reminder[]` | `[]` | `normalizeReminders` (`runtime/gmChanges.js`): the Game Master's standing facts — `{id,text,round,date,at}`, oldest first, twelve at most, 600 characters each. Every AI in the game is shown the whole list until one is withdrawn; withdrawing records a `reminder` change. |
| `playerGoals` | `{[polity]: {text,round?,date?}}` | `{}` | `normalizePlayerGoals` (`runtime/playerGoal.js`): what each player's government is steering toward, set in the Actions panel, 600 characters at most; keyed by the polity's name, so a rename re-keys it (`server/polityRename.js`). Told to the advisor, the time skip and the suggestions, never to a leader. An undo keeps the goal in force (`rollBackToSnapshot` carries it over the restored world), and the view of the world as seen keeps today's (`viewAsSeen`). |
| `pendingUnitOrders` | `PendingUnitOrder[]` | `[]` | `normalizePendingUnitOrders`/`normalizePendingUnitOrderEntry`: `{id,unitId,kind,toLng,toLat,radiusKm,untilRound,targetId,targetLabel,note,issuedAt,issuedRound}`. Standing orders the **engine** advances every turn (`advanceStandingOrders`): `move` travels to a destination, `patrol` works a station of `radiusKm` centred on it. Minted by `applyUnitOpBatch` when an AI move exceeds what the unit could travel in the elapsed time, or when a unit takes `posture: "patrol"`. Surfaced to the AI every jump via `buildPendingUnitOrdersText` (`promptContext.js`) as **context only** — the model must not emit a move for one, or the unit advances twice. Auto-dropped by `pruneSatisfiedUnitOrders` once the unit is within ~60km of `toLng`/`toLat` or no longer exists; a `patrol` order is exempt from that arrival test (its destination *is* its station) and ends via `untilRound` instead. Pruned on **every** `normalizeWorldState` call, so this never needs a separate cleanup pass. |

`Unit` enums (–): `type ∈ {infantry,armor,air,naval,artillery,garrison}` (default `infantry`); `status ∈ {idle,moving,engaged,defeated,pending}` (default `idle`; `pending` = a player deploy awaiting AI resolution, rendered translucent); `source ∈ {player,ai,scenario}` (default `scenario`; `scenario` = placed in the map editor's Units panel, map-editor.md §9b); `posture ∈ {holding,massing,patrol,transit,exercise,blockade,withdrawing,assaulting}` (default `""` — intent, as distinct from lifecycle `status`; deliberately not `garrison`, which would collide with the unit *type*). **`assaulting` is the one posture that also moves the lifecycle**: a unit *arriving* under it is stamped `status: "engaged"` rather than `idle` (`applyUnitOpBatch`). It exists so the **beta** system can express a province assault at all — classic players reach that through the unit popup's Attack button (`attackRegion`, which does the same bookkeeping locally), but the beta card deliberately has no direct-control buttons ("intent, not control"), so a typed order like "Attack Provence" has to be something the *model* can enact. The AI still owns the outcome (casualties, and a `regionTransfer` only if the province actually falls); `engaged` is additionally exempt from `enforceUnitVolume` pruning, which is right for a formation in contact. `strength` is a **percentage of established strength**, clamped to `[0,100]` by `clampUnitStrength`, which coerces the old 1–1000 scale by dividing anything over 100 by ten. `composition` is free text for the order of battle ("1 aircraft carrier, 2 frigates"); `covert` is engine-assigned and means "no confirmed line of support" (a covert insertion **or** a presence only just detected), shown to the player as *Unconfirmed*; `eventId` links the event that created or last moved the unit. `marker.kind` is free-form (lowercased for stable styling), default `landmark`. `PendingUnitOrder.kind ∈ {move,patrol}` (default `move`; a legacy `attack` is coerced to `move`, keeping its destination and `targetLabel`).

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

**The board reads every Canonical event, not just the timeline.** The timeline cleanup (the integrity screen's routine and low-value rules, the curator's redundancy, filler and churn routes) decides what is *worth showing*, and keeps routine patrol, reconnaissance and administrative follow-up off the timeline. Those are Hidden events (see the Glossary): they still happened, and routine progress is exactly what moves a standing Operation or records a stall. So the board pass reads them too, and a Board entry can move without a timeline card. Its `lastUpdate` carries the explanation, and its activity feed stays a list of timeline events: a Hidden event is never stamped into `eventIds`. Only events judged untrue (rejected) and exact duplicates are withheld from the board. The same separation keeps a Project off the Storylines ledger: one polity's deliberate effort is a Board entry, a Storyline is a situation nobody controls, and the jump is told that one may cause the other but a thing is never both (ai-prompts.md §7.12c, §7.17).

**HIGH PRIORITY buys an assessment, not motion.** Every jump, each of the player's open HIGH PRIORITY entries gets an explicit assessment, and "no material change this period, because…" is a valid one. The earlier rule that such an entry "must not sit on the list two jumps running" forbade that honest answer and so invited invented progress. An entry the board pass leaves unassessed is named in the turn log, never retried.

Everything date-derived — overdue, due-soon, a slipped milestone, a programme untouched for several rounds — is **not stored**. It is computed from the game clock by `src/runtime/projects.js` (import-free, unit-tested in a bare checkout), so it cannot go stale between AI turns. That split is the point of the feature: the model owns what only it can know, the calendar owns the rest.

Not in `TEMPLATE_WORLD_OVERRIDE_KEYS`, deliberately — `buildFreshWorldSeedFromScenario` carries *authored settings* across, and projects are play state, exactly like `markers`. (`units` *is* in the list since the map editor gained a Units panel: a scenario's authored starting formations carry into every game made from it — map-editor.md §9b.)

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
| `spies` | `Spy[]` | `[]` | `normalizeSpy`: `{id,owner,target,deployedAt,status,turnedAt,exposedAt,coverStory,suspected}`. The Spy tab deploys and recalls by hand; a jump event's `impacts.spyOps` does the same for the player's queued orders (`spycraft.js applySpyOps`, same rules, skipped orders logged). |
| `spySeal` | `string` | `""` | 64 hex chars, validated `/^[0-9a-f]{64}$/i`; blanked if malformed. |

`intelligence` is keyed by country **NAME**, verbatim — the same namespace as `internationalReputation`, `polityOverrides` and `countryTags` — and moves exactly like reputation: the AI sets it through `polityChanges.intelligence` (0-100), applied in `applyPolityAndTerritoryImpacts` against the **alias-resolved** owner key, so a polity the model names by an alias cannot end up with two split ratings. It decides how much of others' diplomacy a polity can read and how much of its own it can keep secret. Rendered by the Stats tab's 🕵 card, never part of the AI-written stat sheet. A service nobody has rated gets a **first reading** the moment it matters — the Stats pane opens on that polity, an agent is sent there, one of its intercepts is read, one of its agents is caught, an order deploys an agent there — through the `intelligenceAssessment` task (`gameplay.js assessIntelligenceService`, 0-100 with a rationale), written here only while the key is still absent; the turn owns the number after that. The same triggers give the polity its stat sheet if it has none (`ensureCountryStatSheet`), and the Stats pane now generates the sheet on any sub-tab rather than only on Economy.

`Spy.status ∈ {active, discovered, turned, exposed, recalled}`. `active` is in place and reporting; `discovered` was caught by the target and is waiting on the **player's** decision (it reports nothing meanwhile); `turned` is a double agent whose owner is not told — the target writes what it "reports"; `exposed` and `recalled` are terminal. `owner: ""` is a pre-ownership record and means the player's. Caps: `MAX_ACTIVE_SPIES` 3 per owner, `MAX_FOREIGN_SPIES` 3 inside the player at once.

**The intercepts are NOT in world state.** They live in their own runtime-only JSON asset (`storage/intercepts.json`, `readInterceptsState` / `writeInterceptsState`), because they are refreshed *after* the jump's world write and a second world writer would race it. Shape: `{[targetPolity]: {gatheredAt, round, planted, exchanges}}`, where an exchange is `{id, counterpart, date, subject, messages, eventId?}` (`eventId` only on a stolen document's copy: the event whose reveal shows it, see [what the player has not been shown yet](ai-overview.md#what-the-player-has-not-been-shown-yet)) and a message is `{speaker, text}` **or** `{speaker, cipher}` — never both. A turn's restore point keeps this file as it stood before the turn filed anything into it (`snapshot.state.intercepts`), so an undo or an Intervene takes the turn's reports and stolen copies back with it; restoring a snapshot captured before that keeps today's file, less every stolen copy whose report the restored world no longer holds as stolen (`reportDelivery.js withoutOrphanedDocuments`, which runs on every restore). At rest it is always `cipher`: `spySeal.js` seals each message with AES-GCM under `world.spySeal`, opened in exactly two places (the simulator prompt, and the intercept view for as long as it is on screen). `planted: true` marks a report produced while the agent was turned; the file remembers, the player is never told.

This is the one asset in `RUNTIME_ONLY_JSON_ASSET_FILES` whose default is an **object**, which is why the server's write-path shape guard derives `expectsArray` from `JSON_ASSET_DEFAULTS` rather than from registry membership (`server/libraryStore.js`, and `server/runtimeJsonShape.test.js` pins it).

Espionage resolves once per turn in `applySimulationResult`, **after** the standing-order/unit-volume pipeline, so an agent's round is decided against where forces actually ended up. It is deterministic, seeded on `${round}:${key}` with four roll keys — `:detect`, `:turn`, `:suspect`, `:deploy`. **Those key strings are save-compatibility surface**: changing one makes every existing save replay its next round differently. Its events are appended to `freshEvents` *before* `nextEvents` is built, so they persist to the event log.

### 2f. Turn machinery & narrative history

| Field | Type | Default | Meaning (normalizer) |
|---|---|---|---|
| `activeInteractive` | `Interactive \| null` | `null` | The interactive event being played, a branching scene: `{title,premise,opening,firstOpening,choices[],history[]}` (`normalizeInteractive`, which keeps the extra fields). Advanced by `advanceActiveInteractive` (`gameplay.js`). Each beat in `history` is `{choice,summary,before,offered[]}` — `before` the text that was above the choices and `offered` the choices, so `rewindActiveInteractive` can return the scene to any beat (`AI/interactiveRewind.js`); a beat recorded before these fields existed cannot be returned to. Opened only when the player takes up the offer below (`createInteractive({ eventId, angle })`, `GameUI/interactive.jsx`), stamped `origin: "player"`, `fromEventId` (the offered event), `request` (the player's angle, if any) and `startedOn`. A scene is **in progress** when it is the player's or has a beat played (`isSceneInProgress`); while one is, a time skip is refused. A scene an older skip proposed and nobody played is not in progress and the next skip clears it. A save from before interactive events were renamed holds its scene under `activeCatalyst`, read here (`normalizeWorldState`). |
| `interactiveOffer` | `{eventId, round} \| null` | `null` | The event the last time skip offered to be played out as an interactive event (`runtime/interactiveOffer.js` `chooseInteractiveOffer`, in `applySimulationResult`): one about the player and of weight, on one skip in three at most, seeded by the turn so a re-applied turn offers the same. Every skip replaces it; taking it up (`createInteractive`) or letting it pass (`declineInteractiveOffer`) clears it. Shown on its event's card once the reveal reaches it. |
| `lastInteractiveOfferRound` | `number` | `0` | The round of the last offer made; none comes within `INTERACTIVE_OFFER_COOLDOWN` (3) rounds of it. |
| `actionSuggestions` | `Topic[]` | `[]` | AI-proposed action topics `{id,title,description,actions[]}`; cleared each jump (`gameplay.js`). |
| `simulationHistory` | `Turn[]` | `[]` | Last ≤12 turns: `{date,eventIds[],fallbackReason,fromDate,mode,plannedActions[],receipt?,round,summary,source,toDate}` (built in `applySimulationResult`, normalized in `normalizeWorldState`). `receipt` is the **application receipt** (`runtime/applicationReceipt.js`): `{version, applied:{events,regionTransfers,…}, notes:[{kind,text}], omitted}` — what the engine dropped, withheld or changed in that turn's answer, read once by the next jump. Only a jump writes one, and only the **newest** receipt keeps its `notes` (older turns keep `applied` alone), so this polled file never holds more than one receipt's text. It lives here rather than in a runtime asset so that a rollback restores the receipt belonging to the restored turn. |
| `consolidatedHistory` | `Summary[]` | `[]` | The ledger of consolidation passes `{summary,chatIds[],actionIds[],throughDate,throughEventId,throughRound,source,createdAt}` (`normalizeConsolidatedHistory`) — appended by `compactHistoryIfNeeded`; the last entry's `throughEventId` is the boundary the prompt reads events from (`getUnconsolidatedEvents`, or its `throughDate` if that event was deleted). Consolidation never trims the event log. Rendered as the older history only while no `historyDocument` exists. |
| `historyDocument` | `{text,revision,updatedAt,source,throughDate,throughEventId,throughRound}` \| `null` | `null` | The living history the AI is shown in place of the folded events: the first pass writes it, every later pass rewrites it with the new period folded in and unimportant older material condensed past ~1,500 words (`applyHistoryDocumentUpdate`, `historyConsolidation.js`; a pass that returns no document appends its summary instead). Editable in Cheats → History Document (`source: "manual"`). |
| `boardReviewedRound` | `number` | `0` | The round the Projects board was last checked against a turn's events (the turn review's board job, or the board's own request). `0` = never. Lets a skip decide without asking anyone whether the calendar is due another look (`projects.js` `boardPassReasons`); a value later than the current round is another campaign's and counts as never. |
| `lastJumpMode` | `string` | `""` | Mode of the most recent jump (`jump`/`auto`/…). |
| `lastJumpSummary` | `string` | `""` | One-line summary of the last jump. |
| `lastJumpTargetDate` | `string` | `""` | Target date the last jump advanced to. |

> `ownerSchema` is a **document/editor** marker (`src/Editor/documentMigration.js`), not a runtime `world.json` field — it gates the editor's owner-code→name migration. A game's `world.json` inherits it only as an inert pass-through if the seed carried it.

---

## 3. `normalizeWorldState` — the single normalizer

`normalizeWorldState(world)` (`src/runtime/gameState.js`) is called on **every** read and write of `world.json`, so no downstream code has to defend against missing/malformed fields. Behavior:

1. Spread defaults then the raw doc: `{...WORLD_DEFAULTS,...nextWorld, … }`. Unknown fields (scenario extras) survive; known fields are then overwritten by their normalized versions.
2. Rebuild the maps with blank-key/blank-value filtering: `regionOwnershipOverrides`, `polityOverrides`, `regionClaimants` (≤4), `internationalReputation` (clamped ints), `countryTags` (via `normalizeTagList`).
3. Normalize the arrays: `units`, `pendingUnitOrders` (pruned against the just-normalized `units`), `markers`, `actionSuggestions`, `simulationHistory`, `consolidatedHistory`, and singletons `activeInteractive`, `interactiveOffer`, `historyDocument`, label config, `notes`, `language`, `simulationRules`, `startingTimelineText`.

`writeWorldState` normalizes, calls `enqueueContentStrings(polityOverrides)` to translate edited names on write, then `writeJson(JSON_URLS.world, …, { pretty:true })`.

**Namespace caution:** `countryTags`, `internationalReputation`, `polityOverrides`, and `colors` are all keyed by country **NAME verbatim**. An earlier version uppercased `countryTags` keys only, so a single `change.code` could land under two keys (`countryTags["RUSSIA"]` vs `internationalReputation["Russia"]`) — harmless while owners were uppercase GADM codes, a silent desync once owners are names. Keep the casing consistent.

---

## 4. `isPolityLandless` — "does this polity hold territory?"

`isPolityLandless(world, code)` (`src/runtime/gameState.js`) is the single source of truth for "landless" (a government-in-exile, movement, or stateless person), used by both the AI prompt (`buildPlayerPolityRegionsText`) and the flag resolvers (a landless polity must NOT borrow the code-derived country flag). The subtlety: owning a region via an override = has land; but a scenario that ships **no** `regionOwnershipOverrides` at all means every polity owns its country through the base map tiles (a stock modern map), which is NOT landless.

---

## 5. AI "impacts" — the mutation vocabulary

Every event may carry an `impacts` object (`normalizeEventImpacts`, `src/runtime/gameState.js`) whose eleven arrays are the ONLY way the AI mutates world state: `actionIds`, `createdChats`, `markerOps`, `polityChanges`, `projectOps`, `regionClaims`, `regionControlOps`, `regionTransfers`, `reports`, `spyOps` and `unitOps`. Each is independently normalized and invalid entries are dropped. (`spyOps` used to be the one family read off the raw event and never normalized, so a reloaded campaign could not replay espionage from `events.json`; it is normalized like the rest now, and still APPLIED after `resolveEspionage` by `applySpyOps`, so an agent placed this turn is not also caught this turn.)

| Impact array | Element normalizer | Applied by | Effect on `world.json` |
|---|---|---|---|
| `regionControlOps` | `normalizeRegionControlOp` → `{op: contest\|control\|clear_contest, regionId, fromCode, actorCode\|toCode\|claimantCode, clearAll?, wholeCountry?, note}` | `applyPolityAndTerritoryImpacts` | De-facto control without a legal change: `contest` adds a contender to the stripes, `control` makes `toCode` the controller (the previous controller and the lawful sovereign become claimants, the sovereign anchored in `regionSovereigntyOverrides`), `clear_contest` removes one claimant (or all with `clearAll`, never the displaced sovereign). Proposed by the simulator and by `nativeTerritoryDirector.js`; resolved through the same geography resolver as transfers, bounded by current control. |
| `regionClaims` | `normalizeRegionClaim` → `{regionId,claimantCode,drop,note}` | `applyPolityAndTerritoryImpacts` | Appends to / removes from `regionClaimants[regionId]` (de-duplicated case-insensitively; the key is deleted at zero). Applied **before** `regionTransfers`, so a region claimed and handed over in the same jump ends settled rather than striped. Until this existed nothing but the map editor and the cheats panel could raise a dispute, so a unilateral claim had nowhere to go but a project. A claimant the world does not know is founded as a landless polity rather than written as a bare name. Plain region names are resolved to ids beside the transfers (`resolveRegionTransfers`); a claim that matches nothing is dropped, never failed. |
| `regionTransfers` | `normalizeRegionTransfer` → `{regionId,toCode,fromCode,regionName,note,basis?}` | `applyPolityAndTerritoryImpacts` | A change of LEGAL sovereignty: `regionSovereigntyOverrides[regionId] = toCode`, and `regionOwnershipOverrides[regionId] = toCode` too unless a third party physically holds the region, in which case the lawful sovereign stays visible as a claimant. A clean hand‑over clears the region's claimants. |
| `polityChanges` | `normalizePolityChange` → `{code,name,color,aliases[],note,reputation,tags}` | inline loop | Upserts `polityOverrides[code]`; also writes `colors[code]` (§7), `internationalReputation[code]`, `countryTags[code]`. A polity can also come into being without any entry here: territory given to a name the world does not know (a transfer's `toCode`, a control op's `toCode`, a contest's `actorCode`, a live claim's `claimantCode`) founds it as an active record with a colour of its own (`polityFounding.js` `foundPolityIfUnknown`; the AI resolver adds the create explicitly, this is the safety net). Stock country names and names already on the map are never founded this way. |
| `unitOps` | `normalizeUnitOp` → `spawn\|move\|strength\|remove` | `applyUnitOps` | Rewrites `world.units`. |
| `markerOps` | `normalizeMarkerOp` → `build\|remove` | `applyMarkerOps` | Rewrites `world.markers`. |
| `projectOps` | `normalizeProjectOp` → `create\|update\|milestone\|close\|remove` | `applyProjectOps` (via `releaseProjectCompletionEffects` first) | Rewrites `world.projects`. **Ending a project keeps it:** `complete`/`cancel`/`fail` (plus the aliases `finish`, `abandon`, `shelve`) all resolve to one `close` op that sets a closed status and leaves the entry on the board under the Closed view — success marks pending milestones `done` and forces 100%, anything else marks them `missed` and preserves the progress actually reached. Only `remove`/`delete`/`drop` erase, which is for an entry that should never have been opened. `cancel` used to alias to `remove`, so the most natural way for a model to say "we gave up on this" silently deleted it instead of recording it. Matches by id, then case-insensitive name; an op against a project that does not exist is **dropped**, never auto-created. A `create` naming a project already on the board is folded in as an **update that merges only the fields the op actually carried**, so a chatty turn can neither fill the board with duplicates nor reset what it failed to restate. That merge is driven by a `provided` field list recorded at normalize time (a JSON-safe array, because normalized ops are persisted in `events.json` and replayed by the staged reveal): once an op is normalized, every field is populated, so there is otherwise no way to tell `progress: 0` from "progress was not mentioned". Before this, a jump that merely mentioned a running operation reset `ongoing` to false, `progress` to 0, `status` to active, `secrecy` to public, emptied `tags`, and demoted an operation to a project. `tags` follows the `countryTags` rule — an array replaces wholesale, absent means unchanged. |
| `createdChats` | `normalizeCreatedChat` (a thread entry that keeps its `openingMessage` and `speaker`) | turn writer (`gameplay.js`) | New diplomacy threads pushed into `chat.json` (not `world`). The opener is what `buildGeneratedChat` turns into the thread's first message; the chat normalizer used to drop both fields, so no chat an event opened was ever opened. |
| `actionIds` | string list | turn writer | Which queued actions this event resolves. |

**Why the land moves — `basis`.** A transfer, and a `regionControlOps` control flip, may say why (`runtime/territoryBasis.js`). `treaty`, `annexation`, `unification`, `independence` and `occupation` move the map. `claim`, `threat` and `raid` do not: `applyPolityAndTerritoryImpacts` screens all three arrays first (`screenTerritoryBasis`), turning a `claim`‑basis entry into a `regionClaims` entry for its receiver — the region goes disputed instead of changing hands — and leaving a `threat` or a `raid` out. A claim over a whole country (`wholeCountry: true`) is refused rather than striped across every province. The field is carried through normalization **only when present**, so a transfer written before it existed round‑trips byte‑for‑byte, and **an entry with no basis is applied exactly as before**. The turn validator runs the same screen earlier and tells the model what it did (the [application receipt](ai-overview.md#the-application-receipt-what-salvage-did-told-to-the-next-turn)); the screen here is the net for impacts that never meet it, and it is idempotent.

### `normalizePolityChange` semantics

- `reputation`: parsed and clamped to `[0,100]` int, else `null` ("unchanged").
- `tags`: `Array.isArray` → `normalizeTagList`; otherwise `null`. This distinction is load-bearing — the AI sends the COMPLETE new tag list, so `[]` means "this country now has no defining tags" (must drop them) while `null`/undefined means "unchanged". `applyEventImpactsToWorld` deletes the key on `[]` and sets it on a non-empty list.

### `applyUnitOps` — pure

`spawn` (marks `source:"ai"`) pushes; `move` sets `lng/lat/regionId`, `status:"moving"`; `strength` clamps and marks `defeated` at ≤0; `remove` filters by id. Ops on unknown ids are silently ignored; the final list drops any unit with `strength ≤ 0` or `status === "defeated"`.

### `applyMarkerOps` — pure

`build` replaces any existing marker of the same name (case-insensitive) rather than stacking duplicates; `remove` matches by id first, then exact name (the AI usually knows the name, rarely the id).

---

## 6. `game.json` — the clock (`GAME_DEFAULTS`)

`GAME_DEFAULTS` (`src/runtime/gameState.js`), normalized by `normalizeGameData`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `country` | `string` | `""` | The player's owner code/name. |
| `difficulty` | `string` | `"standard"` | Feeds `difficultyDirective` in the prompt. |
| `gameDate` | `string` | `""` | Current in-game date (`YYYY-MM-DD`; a year before AD 1 carries a leading minus and counts backwards with no year zero, so `-0218-03-01` is 1 March 218 BC — see `src/runtime/gameDates.js`), advanced each jump to `result.stopDate`. |
| `startDate` | `string` | `""` | Scenario start date. |
| `language` | `string` | `"English"` | UI/content language. |
| `round` | `int > 0` | `1` | Turn counter, `+1` each jump (`gameplay.js`). |

`canonicalizeDateString` repairs `gameDate`/`startDate` from loose formats (`"2016-12-31T00:00:00.000Z"`, `"December 31, 2016"`, `"-218-03-01"`) back to the canonical form (`normalizeGameDate`). Without it, the jump's date arithmetic rejects the value and every jump computes `target == origin`, freezing the clock while the model re-simulates the past. **Every parse, step, difference, comparison and display of a game date goes through `src/runtime/gameDates.js`** — BC years are negative, there is no year zero, the arithmetic is astronomical inside, and comparing two date strings is wrong for BC (`-0218` sorts before `-0300` as text, yet 218 BC comes after 300 BC). Prose dates (`"Third Age 3019"`) don't parse and pass through untouched, on the lenient validation branch.

---

## 7. `colors.json` — the palette (a sibling, not a world field)

Colors live in a separate asset (`code → [r,g,b]`), not inside `world.json`. `applyEventImpactsToWorld` takes `colors` as an input and returns the mutated palette alongside the world: when a `polityChange` carries a 6-hex `color`, it is parsed to `[r,g,b]` and written to `nextColors[change.code]`. The turn writer persists both in the same `Promise.all` (`gameplay.js`). A colors write invalidates the memoized `getNationColors` cache and dispatches `oh:colors-updated` so the map repaints mid-session without a reload (`assets.js`).

---

## 8. `applyEventImpactsToWorld` — folding impacts into state

`applyEventImpactsToWorld({ colors, events, world })` (`src/runtime/gameState.js`) is a **pure** function returning `{ colors, world }`. It clones the inputs, normalizes the world and the events, then for each event applies (in order): region transfers → polity changes (name/color/reputation/tags + palette) → unit ops → marker ops. It does NOT persist — the caller writes. Two callers:

1. **The turn writer** — `applySimulationResult` (`src/Game/AI/gameplay.js`). It builds the next world (clearing `activeInteractive`, choosing a skip's `interactiveOffer`, merging `lastJump*`, and the new `simulationHistory` head), calls `applyEventImpactsToWorld` with the generated events, optionally compacts history, then persists everything in one `Promise.all`: `writeActionsState`, `writeChatsState`, `writeEventsState`, `writeGameData`, `writeJson(colors)`, `writeWorldState`. It then captures a rollback snapshot of the pre-jump state (`captureRollbackSnapshot`,).
2. **The staged reveal** — `src/Game/GameUI/time.jsx`. As a turn's events are revealed one at a time, it re-applies impacts up to the last revealed event onto `stagedBase.world` and calls `setWorldStateOverride(stagedWorld)` / `setUnitsOverride(...)` so the map shows the world as of that event. It passes `colors: {}` because it only needs the world, not the palette. When staging ends (or on unmount) both overrides are cleared to `null`.

---

## 9. State distribution: three stores, no panel polls

No panel fetches a runtime document on its own timer any more. Three stores hold the live state, and all three are driven by the canonical write events `writeJson` dispatches (`assets.js`-): `oh:world-updated`, `oh:game-updated`, and `oh:runtime-json-updated` for every mutable runtime asset. Updates are pushed, not polled. The one remaining timer is a 60-second backstop for a writer no event can reach.

### The map store: `src/Game/Map/useWorldState.js`

A singleton that holds `world.json` for all map consumers. It bootstraps once from the already-warmed asset cache and updates only when a canonical write announces itself. The 90-second safety poll it used to run was removed because it could interrupt otherwise idle map interaction.

| Piece | Location | Behavior |
|---|---|---|
| `sharedState` / `publishedState` / `subscribers` | - | One world object, one derived object, a `Set` of subscriber callbacks. |
| `bootstrap` | | `readJson(JSON_URLS.world, { force: false, clone: false })` on first subscribe. On error it publishes `{}` rather than leaving consumers unpainted. |
| `onWorldUpdated` | | `oh:world-updated` carries the saved world in `event.detail.world`; the store adopts that object directly, with no read. |
| `onActiveGameChanged` | | A save switch drops `sharedState`, the override and the published object, then bootstraps again from the new save's `world.json`. |
| `overrideState` / `setWorldStateOverride` |, | Staged-reveal override. `effectiveState = overrideState ?? sharedState`. Canonical updates keep landing underneath, and clearing to `null` snaps consumers back to live state. |
| `getWorldStateSnapshot` | | Read-only accessor of the effective state (peer of `unitsController.getUnits`). |

### The HUD store: `src/runtime/runtimeStore.js`

One store and one subscription list for all six mutable runtime documents: `game`, `world`, `events`, `actions`, `chat`, `intercepts`. It replaced ten independent 5-second `force: true` intervals across `time.jsx`, `actions.jsx`, `chat.jsx`, `projects.jsx` and `settings.jsx`.

| Piece | Location | Behavior |
|---|---|---|
| `SOURCES` | | Per key: the `gameState.js` reader and the matching normalizer. The store always holds normalized documents. |
| `subscribeRuntime(key, fn, { select, seed })` | | Adds a subscriber. With `select`, `fn` is called only when that selector's output changes, compared with `deepEqual`. Without one, only when the document's own reference changes. `seed` is the slice the caller last rendered, so a change landing between a render and its subscription is not swallowed. |
| `applyValue` | | Normalizes, deep-compares against the current document, and publishes only on a real difference. A poll that found nothing new notifies nobody. |
| `openChannel` | | A `BroadcastChannel` carrying **only the key** of a document this tab wrote. Other tabs of the origin share one save and see no `window` event from it; posting the value instead would structured-clone a multi-megabyte world into every listening tab on every write. A receiving tab marks that key `stale` and re-reads it, or defers if it is hidden or has nobody subscribed. |
| `tick` / `syncTimer` |, | The 60-second backstop (`RUNTIME_BACKSTOP_MS`), running only while at least one key has subscribers and the tab is visible. A tick reads only the keys that are marked stale or whose last write is older than the backstop, so in an ordinary session it finds nothing and issues nothing. It exists for a writer no event reaches: a save edited on disk while the app runs. |
| `onRuntimeJsonUpdated` | | A same-tab write is authoritative on arrival: the store takes `event.detail.value` and marks that key fresh, so the next tick skips it. In an ordinary session almost every update arrives this way and costs no request. |
| `isStaleGameRead` | | A read that comes back behind the published `(round, gameDate)` is refused, and the whole batch with it, since world and events belong to that same stale turn. `game` therefore rides along with every batch. This is the invariant that used to live in `time.jsx`'s `gameStampRef`. |
| `onRolledBack` | | A rollback is the one write that legitimately moves the clock backwards, so `oh:rolled-back` (dispatched by `rollBackToSnapshot`) clears the stamp and re-reads. |
| `onActiveGameChanged` | | Same reset as the map store: every document is dropped and re-read for the new save. |
| `primeRuntimeValue(key, value)` | | Publishes state the caller already holds (a finished turn, a restored bundle) without a round trip. `time.jsx` uses it where it used to call `setGameData` / `setEvents` / `setWorldState`. |
| `refreshRuntimeState(keys)` | | An explicit read, for the moment a panel opens. |

`countryStats` and `countryStatsHistory` are the one exception to all of this: the stats worker writes `world.json` from off-thread and `primeCountryStatsWorkerCommit` patches the same-tab caches narrowly rather than re-broadcasting the world, so those two fields only become current here on a backstop read. Read them through `readCountryStatsBundle`.

React consumers use `useRuntimeState(key, select, depsKey)` (`src/runtime/useRuntimeState.js`). Pass `depsKey` when the selector closes over something that can change without the document changing, as `projects.jsx` does for `isPolityLandless(world, playerCountry)`.

The practical rule for a new panel: subscribe to the narrowest slice you can name. `actions.jsx` takes `{ country, gameDate, round }` off `game.json` and re-renders for nothing else; `projects.jsx` takes `world.projects` and `world.polityOverrides` separately, so a unit move does not touch the board.

### Content-compare / referential-identity guard (`useWorldState.js`-)

`useWorldState` derives a small object of the fields the map cares about (`worldState`, `worldKnown`, `customRegions`, `customCities`, `basemap`, `background`, `regionOwnershipOverrides`, `regionClaimants`, `polityOverrides`, `markers`, `cityRenames`, `cityPopulations`, `labelFont`, `labelHaloColor`, `labelTextColor`) and, if it is **content-equal** to the previous derived object, RETURNS THE PREVIOUS OBJECT REFERENCE. This keeps `useMemo`/`useEffect` consumers from re-running when nothing meaningful changed. Comparison strategy:

- Scalars (`basemap`, label config, booleans): `===`.
- `regionOwnershipOverrides`: `areEqualShallow`, key count plus per-key `===` (values are strings).
- `background`, `regionClaimants`, `polityOverrides`, `markers`, `cityRenames`, `cityPopulations`: `areEqualStructured`, a recursive content compare. Their values are fresh arrays/objects on every canonical update, so reference equality would churn; the payloads are small. `EMPTY_MARKERS` is a stable `[]` so a marker-less world never churns the memo.

`worldState` itself is the raw world object (replaced whenever a write lands), but the sibling derived fields drive the map layers and are identity-stable.

### The units store: `unitsController.js`

`src/Game/Map/unitsController.js` is the third store and follows the same shape: `startUnitsSync` ref-counts subscribers, bootstraps once, and then listens for `oh:world-updated` and `oh:game-updated`, republishing `world.units` to its own pub/sub. Its own 5-second `world.json` + `game.json` poll is gone.

The player's only mutations are **deploy**, **disband** and **request orders**. Manual movement and manual combat were removed, so where forces go and what happens when they meet belongs to the AI and to `advanceStandingOrders`. `deployUnit` and `removeUnit` apply optimistically in memory and `commit` does a read-modify-write of `world.units` **preserving the rest of world state** (`{...world, units: nextUnits }`), guarded by a `busy` flag so an incoming update does not clobber a mid-commit write. A deploy and a `requestUnitOrders` both `queueOrder` (an action) so the AI adjudicates them on the next jump; a deploy carries a `unitRevert` describing how to undo it if the player deletes the action first (`normalizeUnitRevert` in `gameState.js`). `revertUnitOrder` keeps its `lng`/`lat`/`status`/`pendingOrderId` branches for actions queued by the old manual-order UI that are still sitting in existing saves. It exposes its own `setUnitsOverride`/`getUnits` mirroring the world-state override for staged reveals.

---

## 10. Country tags — `src/runtime/countryTags.js`

A dependency-free module (imported by the editor, the game, and the server) that owns the two rules both halves must agree on: how a tag list is normalized and which source wins.

| Export | Location | Purpose |
|---|---|---|
| `MAX_TAGS` / `MAX_TAG_LEN` |, | 8 tags, 32 chars each. |
| `TAG_SUGGESTIONS` | | Open-vocabulary suggestions (`socialist`, `authoritarian`, `nato-aligned`, …) so common cases converge on one spelling. |
| `normalizeTagList(list, opts)` | | Trim, collapse whitespace, cap length, drop blanks, dedupe case-insensitively, cap count. Non-strings dropped (a stray number means a palette `[r,g,b]` leaked in). |
| `resolveCountryTags(baseTags, world, country)` | | The tags in force NOW for one country: the AI's live `world.countryTags[name]` if it has ever set one, ELSE the author's `tags.json` list. **Not a merge** — a revolution that dropped "socialist" must not have it restored by the scenario file underneath. Keyed by country NAME verbatim. |
| `resolveAllCountryTags(baseTags, world)` | | Every tagged country, live winning over author, for the world summary the model reads. Emits keys verbatim (no uppercasing — see the desync note). |

Author starting tags come from `getNationTags` (`assets.js`, the scenario's `tags.json`); live changes land in `world.countryTags` via `polityChanges.tags` (§5/§8). See [Country tags](world-state.md).

---

## 11. Read / write API surface (`gameState.js`)

| Function | Line | Notes |
|---|---|---|
| `readWorldState({force})` | | `readJson(world)` → `normalizeWorldState`. |
| `writeWorldState(world, opts)` | | normalize → `enqueueContentStrings(polityOverrides)` → `writeJson(pretty)`. |
| `readGameData` / `writeGameData` |, | `normalizeGameData` on both ends. |
| `readActionsState` / `writeActionsState` |, | `normalizeActions`. |
| `readEventsState` / `writeEventsState` |, | `normalizeEvents`; write enqueues content strings. |
| `readChatsState` / `writeChatsState` |, | `normalizeChats`. |
| `readGameStateBundle` | | `Promise.all` of all five. |
| `applyEventImpactsToWorld` | | Pure fold of impacts → `{colors, world}`. |
| `applyUnitOps` / `applyMarkerOps` |, | Pure list mutators. |
| `isPolityLandless` | | Territory check. |

All reads/writes route through `src/runtime/assets.js` `readJson`/`writeJson`, which layer value-caching, request batching, Cache-Storage persistence with a HEAD freshness check, and derived-cache invalidation (`invalidateDerivedCachesForWrite`, `assets.js`) on top of the raw `/api/runtime/json/*` endpoints.
