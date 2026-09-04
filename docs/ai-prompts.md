# Prompt-Making Guide

Every LLM call the game makes is a template in `src/Game/AI/defaultPrompts.json` filled with runtime game state, then hardened by call-time directives, then validated against a JSON Schema tool. This page is the single reference for anyone editing prompts: it enumerates every `${PLACEHOLDER}`, every template variable and where it is computed, every AI task and its output schema, exactly how a final prompt is assembled, how prompts are overridden per scenario, and how to add a new variable or task. When in doubt, the code paths are all in `src/Game/AI/` and `src/runtime/`.

---

## 1. File map — where everything lives

| Concern | File | Notes |
|---|---|---|
| Task + root prompt text; `${PLACEHOLDER}`→`${var}` helper map | `src/Game/AI/defaultPrompts.json` | Built-in defaults, bundled with the app |
| Prompt-pack normalization, editor section list, task-key list | `src/Game/AI/gameplayPrompts.js` | `normalizePromptPack`, `serializePromptPack`, `PROMPT_SECTION_DEFINITIONS` |
| Context builders (world summary, histories, units, cities) | `src/Game/AI/promptContext.js` | `buildPromptContext`, `buildWorldSummary`, `renderTemplate`, `resolveHelperValues` |
| Task runner, call-time directives, validators, fallbacks, task entry points | `src/Game/AI/gameplay.js` | `runJsonTask`, `buildTemplateVariables`, `simulateTimelineJump`, etc. |
| JSON Schemas + tools + payload validator | `src/Game/AI/gameplaySchemas.js` | `GAMEPLAY_SCHEMAS`, `GAMEPLAY_TOOLS`, `validateGameplayPayload` |
| Provider dispatch, `callAI`, advisor/leader assembly | `src/Game/AI/main.jsx` | `callAI`, `buildAdvisorSystemPrompt`, `buildDiplomaticSystemPrompt` |
| Language directive (appended to *every* call) | `src/runtime/i18n.js` | `languageDirective` at line 137 |
| Difficulty directive (appended to task + leader prompts) | `src/runtime/difficulty.js` | `difficultyDirective` at line 73 |
| Where the active game's prompt overrides are read from | `src/runtime/assets.js:268` | `JSON_URLS.prompts = /api/runtime/json/prompts` |
| Per-scenario prompt editor UI ("Prompts" tab) | `src/Game/GameUI/libraryBar.jsx` | `handlePromptChange`, `serializePromptPack` on save |

See [World state](world-state.md) for the `world.json` shapes (`regionOwnershipOverrides`, `polityOverrides`, `units`, `markers`, `activeCatalyst`, `consolidatedHistory`, `simulationHistory`) that the context builders read.

---

## 2. The three prompt "kinds" and how they are stored

`defaultPrompts.json` has exactly three top-level buckets:

| Kind | JSON key | Contains | Rendered by |
|---|---|---|---|
| Root: **advisor** | `advisor` (string) | Chief-advisor side-panel chat | `buildAdvisorSystemPrompt` (`main.jsx:1012`) |
| Root: **leader** | `leader` (string) | AI diplomacy — polities replying in a chat | `buildDiplomaticSystemPrompt` (`main.jsx:1036`) |
| **tasks** | `tasks.<key>` (strings) | 13 structured JSON tasks (below) | `runJsonTask` (`gameplay.js:382`) |
| Helper map | `helpers` (object) | `${PLACEHOLDER}` → `${templateVar}` indirection | `resolveHelperValues` (`promptContext.js:23`) |

### Override / storage model

- The bundled `defaultPrompts.json` is the fallback. The **active game** may ship its own `prompts` asset, served at `JSON_URLS.prompts` (`/api/runtime/json/prompts`). Both `runJsonTask` (via `loadPromptCatalog`, `gameplay.js:310`) and the advisor/leader path (via `ensurePromptsLoaded`, `main.jsx:969`) read it.
- `normalizePromptPack` (`gameplayPrompts.js:232`) merges **per key with fallback**: for every task key in `PROMPT_TASK_KEYS`, an override is used only if it is a non-blank string, else the default. Same for `advisor`, `leader`, and each `helpers` entry. A partial override (one task) leaves all others at default.
- Scenarios persist overrides under `details.data.prompts`. The library "Prompts" editor writes them: root sections write `prompts[key]`, task sections write `prompts.tasks[key]`, helpers write `prompts.helpers[key]` (`libraryBar.jsx:1426`), and `serializePromptPack` flattens on save (`gameplayPrompts.js:255`).
- `PROMPT_SECTION_DEFINITIONS` (`gameplayPrompts.js:15`) drives the editor UI: one entry per editable section with a `label`, `type` (`root` | `task`), and a **declared** `helpers` list. Note two mismatches with the runtime: `idleDiplomacy` is a real task but has **no editor section** (not user-editable in the UI, still overridable via `prompts.tasks.idleDiplomacy`), and the declared helper lists are hints — some listed placeholders (e.g. `CONSOLIDATED_HISTORY`, `PLAYER_POLITY_REPUTATION_CONTEXT`) are **not** referenced by the current default text.

### ⚠️ Frozen-prompt caveat (read this before adding a rule to defaultPrompts.json)

**Existing campaigns carry a frozen copy of the task prompts.** A game created before your edit keeps whatever prompt text it was seeded with; editing `defaultPrompts.json` only affects games that read the default (no override) or new scenarios. This is *the* reason several critical rules are **appended at call time in `runJsonTask`** instead of living in the JSON (see §6): Player Agency, Map Truth, and International Reputation reach old games only because they are concatenated onto the system prompt every call. If a rule must apply retroactively to all campaigns, append it in code, not in `defaultPrompts.json`.

---

## 3. How a final prompt is assembled, end to end

### 3a. Task path (`runJsonTask`, `gameplay.js:382`)

Order of concatenation onto the system prompt:

1. **Load pack** — `loadPromptCatalog()` → `normalizePromptPack(readJson(JSON_URLS.prompts))` (per-key override or default).
2. **Resolve helpers** — `helperValues = resolveHelperValues(prompts.helpers, variables)` (`promptContext.js:23`). Two passes so a helper that references another helper resolves.
3. **Render task text** — `systemPrompt = renderTemplate(prompts.tasks[taskKey], { ...variables, ...helperValues })` (`gameplay.js:392`). `renderTemplate` (`promptContext.js:17`) replaces `${key}` with `variables[key]` (missing/`null` → empty string). Both uppercase `${PLACEHOLDER}` keys (from `helperValues`) and lowercase `${var}` keys (from `variables`) are in scope.
4. **+ Difficulty directive** — `\n\n${difficultyDirective(game.difficulty)}` for every task (`gameplay.js:400`).
5. **+ Player Agency** and **+ Map Truth** — only `jumpForward`, `autoJumpForward` (`gameplay.js:411`–`420`).
6. **+ International Reputation** — only `actions`, `jumpForward`, `autoJumpForward`, `catalystCreation`, `catalystExecutor` (`gameplay.js:425`).
7. **Call `callAI(systemPrompt, [{role:"user", parts:[{text: userMessage}]}], { tool, maxTokens: 8192, ... })`.** Inside `callAI` (`main.jsx:942`): **+ Language directive** `\n\n${languageDirective()}` when the UI language ≠ English.
8. **Provider layer** (`main.jsx`): native tool-use providers (Anthropic/OpenAI/Gemini) pass `tool.schema` as a tool; the JSON-schema fallback path appends `\n\nReturn only one JSON object matching this JSON Schema…\n${JSON.stringify(tool.schema)}` (`main.jsx:573`). `maxTokens` is floored at 8192 by capped providers; Gemini ignores it.

So the final task system prompt is:

```
<rendered task text>
\n\n<difficulty directive>
[\n\n[Player Agency]…\n\n[Map Truth]…]        (jump tasks only)
[\n\n[International Reputation]…]              (5 tasks only)
\n\n<language directive>                        (non-English only)
[\n\n Return only one JSON object … <schema>]  (json-schema fallback providers only)
```

Retry (`gameplay.js:447`): each task gets **two output attempts**. On attempt-1 failure the model's raw answer plus a corrective user turn are appended to `history`, and attempt 2 runs against the same system prompt. `validatePayload` receives `{ attempt, finalAttempt }`; `finalAttempt` (attempt 2) switches validators from *strict* (return a corrective string) to *salvage* (repair in place). If both attempts fail, the deterministic `fallback()` runs (or, for tasks with no fallback, it throws). A user `signal` abort propagates and cancels rather than falling back.

### 3b. Advisor / leader path (`main.jsx`)

These do **not** go through `runJsonTask` or `buildTemplateVariables`; they build variables directly from `buildPromptContext` (`buildPromptVariables`, `main.jsx:989`, with `eventLimit: 16`).

- **Advisor** (`buildAdvisorSystemPrompt`, `main.jsx:1012`): `renderTemplate(promptPack.advisor, { ...variables, ...helperValues })` → `callAI` (language directive only). No difficulty, no schema (free-form text reply). Called by `sendMessage` (`main.jsx:1084`) with a rolling `advisorHistory`.
- **Leader** (`buildDiplomaticSystemPrompt`, `main.jsx:1036`): `renderTemplate(promptPack.leader, …)` **+ `\n\n${difficultyDirective}`** (`main.jsx:1063`). Then `sendDiplomaticMessage` (`main.jsx:1138`) appends a per-turn user instruction telling the model to speak as one specific polity and optionally emit a trailing `REACTION:<emoji>` line (`main.jsx:1144`), which `parseReaction` strips. `callAI` adds the language directive.

Because the advisor/leader path skips `buildTemplateVariables`, `playerPolityReputationContext` is empty and the military-feasibility doctrine (§5) is **not** appended to their unit text.

---

## 4. Placeholder → variable helper map

`defaultPrompts.json` → `helpers`. Task/root text uses the uppercase `${PLACEHOLDER}`; the helper maps it to a lowercase `${var}` computed in `buildPromptContext`. "Used by" lists the prompts whose **default text** actually contains the placeholder.

| `${PLACEHOLDER}` | → template var | Inserts | Used by (default text) |
|---|---|---|---|
| `PLAYER_POLITY` | `playerPolity` | Player polity name (`game.country`) | nearly all |
| `PLAYER_POLITY_REGIONS` | `playerPolityRegions` | Comma list of regions the player owns, or the LANDLESS notice | advisor |
| `PLAYER_POLITY_BATTALION_SUMMARIES` | `playerBattalionSummaries` | Player + world unit lines (no feasibility doctrine) | advisor |
| `PLAYER_POLITY_REPUTATION_CONTEXT` | `playerPolityReputationContext` | "International reputation: N/100 (band)." | *(none — injected via the [International Reputation] directive, not the placeholder)* |
| `PLAYER_ACTIONS_THIS_ROUND` | `plannedActions` | Planned (unresolved) actions | advisor, actions, jumpForward, autoJumpForward, catalystCreation, gameMaster, descriptionToAction |
| `PLAYER_EVERY_ACTION` / `PLAYER_EVERY_ACTION_NOT_PREVIOUS` | `allActions` | All actions incl. resolved | advisor, jumpForward, autoJumpForward |
| `GRAND_MAP_DESCRIPTION` | `worldSummary` | Full world snapshot (see §5 `worldSummary`) | advisor, countryStatSheet |
| `GRAND_MAP_DESCRIPTION_NO_CITY` | `worldSummaryNoCity` | **Identical string** to `worldSummary` (name is historical) | leader, actions, jumpForward, autoJumpForward, descriptionToAction, gameMaster, pregameHistory |
| `CURRENT_UNITS` | `unitsSummary` | Deployed units **+ conditional military-feasibility doctrine** | jumpForward, autoJumpForward |
| `CURRENT_MAP_STRUCTURES` | `markersSummary` | `world.markers` structures with coords | jumpForward, autoJumpForward |
| `CITY_COORDINATES` | `citiesSummary` | City coordinate catalog (custom era set or stock significant slice) | jumpForward, autoJumpForward |
| `NUMBER_OF_REGIONS` | `numberOfRegions` | Count of regions in the map catalog | jumpForward, autoJumpForward, gameMaster |
| `WORLD_BEFORE_ROUND_ONE_TEXT` | `worldBeforeRoundOne` | Scenario "World Before Round One" briefing | advisor, leader, actions, jumpForward, autoJumpForward, catalyst×3, descriptionToAction, gameMaster, pregameHistory |
| `HISTORICAL_PRESET_SIMULATION_RULES` | `simulationRules` | Scenario simulation rules | advisor, leader, countryStatSheet, actions, jump×2, catalyst×3, descriptionToAction, gameMaster, pregameHistory |
| `ALL_EVENTS_WITH_CONSOLIDATION` | `recentEventsLong` | STORY SO FAR (consolidated) + RECENT EVENTS | leader, jumpForward |
| `ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS` | `recentEventsLong` | Same value as above | advisor, actions, autoJumpForward, catalystCreation, catalystExecutor |
| `CONSOLIDATED_HISTORY` | `consolidatedHistory` | Just the consolidated "STORY SO FAR" | *(declared in editor sections; not in current default text)* |
| `PREVIOUS_ROUND_EVENTS` | `recentEvents` | Recent unconsolidated events (short window) | countryStatSheet, catalystCreation |
| `NON_CONSOLIDATED_ROUNDS_WITH_DATES` | `recentRoundsWithDates` | `from → to` date pairs from `simulationHistory` | advisor, leader, actions, jumpForward, autoJumpForward |
| `CHATS_NON_CONSOLIDATED_ROUNDS` | `chatHistoryLong` | Detailed multi-chat transcript | advisor, leader, actions, jumpForward, autoJumpForward |
| `CHAT_PARTICIPANTS` | `chatParticipants` | Names of the current chat's participants | leader, nextSpeaker |
| `THIS_CHAT_HISTORY` | `chatHistory` | The current chat's message lines | leader, nextSpeaker |
| `THIS_CHATS_MOST_RECENT_SPEAKER` | `lastSpeaker` | Name of the last speaker (to exclude) | nextSpeaker |
| `RESPONDING_POLITY_NAME` | `respondingPolityName` | Which polity the leader model should voice | leader |
| `ALL_ADVISOR_MESSAGES` | `advisorMessages` | Prior advisor↔player transcript | advisor |
| `ORIGIN_ROUND_DATE` | `date` | Current game date (`game.gameDate`, raw ISO/text) | leader, countryStatSheet, nextSpeaker, eventConsolidator, gameMaster, descriptionToAction |
| `ORIGIN_ROUND_GRAMMATICAL_DATE` | `dateReadable` | Current date formatted "D MMMM YYYY" | advisor, actions, jumpForward |
| `STARTING_ROUND_DATE` | `startDate` | Campaign start date (`game.startDate`) | advisor, jumpForward, autoJumpForward, pregameHistory |
| `TARGET_ROUND_DATE` | `targetDate` | Jump target date (ISO) | jumpForward, autoJumpForward |
| `TARGET_ROUND_GRAMMATICAL_DATE` | `targetDateReadable` | Target date formatted readable | jumpForward |
| `CURRENT_ROUND_NUMBER` | `round` | Current round number | jumpForward |
| `DIFFICULTY_DESCRIPTION_CHATS` | `difficultyGuidanceChats` | Difficulty guidance, "chats" flavor | leader |
| `DIFFICULTY_DESCRIPTION_JUMP_FORWARD` | `difficultyGuidanceJumpForward` | Difficulty guidance, "jump" flavor | jumpForward, autoJumpForward |
| `DESCRIPTION_ACTION_TEXT` | `actionInput` | Raw player freeform text to convert | descriptionToAction |
| `EVENTS_TO_CONSOLIDATE` | `eventsToConsolidate` | Event batch to compress | eventConsolidator |
| `CHATS_TO_CONSOLIDATE` | `chatsToConsolidate` | Chat batch to compress | eventConsolidator |
| `GAME_MASTER_PLAYER_REQUEST` | `gameMasterRequest` | Raw GM/cheat request text | gameMaster |
| `RUNNING_CATALYST_DATE` | `catalystDate` | Catalyst date (= current date) | catalystCreation, catalystExecutor, catalystSummary |
| `RUNNING_CATALYST_PERCENT` | `catalystPercent` | Catalyst progress %, `min(100, history.length*50)` | catalystExecutor |
| `CATALYST_PREMISE_DESCRIPTION` | `catalystPremise` | The catalyst's premise text | catalystExecutor, catalystSummary |
| `CATALYST_SIMULATION_HISTORY` | `catalystHistory` | Choice→summary log so far | catalystExecutor, catalystSummary |

Lowercase variables referenced **directly** by task text (no helper alias): `${language}` (all tasks), and in `idleDiplomacy` — `${playerPolity}`, `${dateReadable}`, `${worldSummary}`, `${recentEvents}`, `${chatSummary}`; in `catalystExecutor` — `${catalystChoice}`.

---

## 5. Template variable reference (the full map)

Every key on the object returned by `buildPromptContext` (`promptContext.js:379`, return block 413–462), plus the two keys `buildTemplateVariables` (`gameplay.js:367`) adds/overrides. This is the master set available to `renderTemplate`.

| Variable | Inserts | Computed at |
|---|---|---|
| `playerPolity` | `game.country` or "Unknown polity" | `promptContext.js:447` |
| `playerPolityRegions` | Player's owned-region names, "No player polity…", "No explicit… override list", or the LANDLESS block | `buildPlayerPolityRegionsText` `promptContext.js:293` (LANDLESS text 287) |
| `playerBattalionSummaries` | `buildUnitsSummaryText(world)` (up to 60 units, coords/type/owner/strength/status) | `promptContext.js:447` / builder `195` |
| `unitsSummary` | Same unit text; **`buildTemplateVariables` appends `buildMilitaryFeasibilityText`** (era-reach/type/distance doctrine) only when units exist or the actions text matches the military regex | `promptContext.js:458`; override `gameplay.js:372`; feasibility builder `319` |
| `playerPolityReputationContext` | "International reputation: N/100 (poor/mixed/well-regarded)." from `world.internationalReputation[player]`, else last viewed stat sheet, else 50 | `buildPlayerPolityReputationText` `gameplay.js:348` (added `371`) |
| `worldSummary` | Multi-section snapshot: player line + tags, round, date, language, difficulty, world-before-round-one, simulation rules, up-to-24 territorial overrides, up-to-16 polity overrides (incl. `note` lore), up-to-40 country tag lines, active-catalyst line | `buildWorldSummary` `promptContext.js:317` |
| `worldSummaryNoCity` | **Identical** to `worldSummary` | `promptContext.js:461` |
| `citiesSummary` | City coordinate lines: custom-city scenarios use the era geojson (tier/pop sorted, ≤200); otherwise the stock significant slice (capitals + pop ≥ 2M, cached) | `buildCityCatalogText` `promptContext.js:239` |
| `markersSummary` | `world.markers` structures (≤60) with kind/owner/coords/note | `buildMarkersSummaryText` `promptContext.js:211` |
| `numberOfRegions` | `String(regionCatalog.length)` | `promptContext.js:444` |
| `recentEvents` | Unconsolidated event history, `eventLimit` window (10 default; 16 on advisor/leader path) | `buildEventHistoryText` `promptContext.js:48` |
| `recentEventsLong` | `buildCampaignHistoryText`: "STORY SO FAR" (consolidated) + "RECENT EVENTS" (≤`longEventLimit`, 24) | `promptContext.js:450` / builder `95` |
| `consolidatedHistory` | `buildConsolidatedHistoryText(world)` — the `consolidatedHistory[]` summaries | `promptContext.js:433` / builder `86` |
| `recentRoundsWithDates` | `from → to` date pairs from `world.simulationHistory` (≤8) | `buildRecentRoundsWithDates` `promptContext.js:187` |
| `chatHistory` | Current chat's `speaker: text` lines, or "No chat history." | `promptContext.js:428` |
| `chatHistoryLong` | `buildDetailedChatHistoryText(unconsolidatedChats, {limit: chatLimit})` | `promptContext.js:429` / builder `114` |
| `chatSummary` | One-line-per-chat last-message summary | `buildChatSummaryText` `promptContext.js:431` / builder `103` |
| `chatParticipants` | Current chat's participant names, comma-joined | `promptContext.js:430` (overridden with a bulleted list in `buildDiplomaticSystemPrompt`, `main.jsx:1058`) |
| `chatsToConsolidate` | Explicit batch, else detailed transcript (≤12 chats, ≤50 msgs) | `promptContext.js:432` |
| `chat` | `JSON.stringify(unconsolidatedChats)` | `promptContext.js:427` |
| `lastSpeaker` | Current chat's last speaker name | `promptContext.js:442` |
| `respondingPolityName` | Option override, else first non-player participant | `promptContext.js:452` |
| `advisorMessages` | `buildAdvisorHistoryText(bundle.advisor, {limit: advisorLimit=18})` | `promptContext.js:416` / builder `127` |
| `actions` | `formatActionsForPrompt(bundle.actions)` (title + display text) | `promptContext.js:415` / builder `156` |
| `plannedActions` | `buildActionHistoryText(bundle.actions)` (planned only) | `promptContext.js:445` / builder `140` |
| `allActions` | `buildActionHistoryText(…, {includeResolved:true})` | `promptContext.js:417` |
| `actionInput` | The `actionInput` option (raw player text) | `promptContext.js:414` |
| `date` | `game.gameDate` (raw) | `promptContext.js:434` |
| `dateReadable` | `formatDateReadable(date)` → "D MMMM YYYY" (dayjs); raw text if unparseable | `promptContext.js:435` / builder `165` |
| `startDate` | `game.startDate` | `promptContext.js:456` |
| `round` | `String(game.round || 1)` | `promptContext.js:453` |
| `targetDate` | `targetDate` option or `date` | `promptContext.js:457` |
| `targetDateReadable` | `formatDateReadable(target)` | `promptContext.js:457` |
| `language` | `world.language ‖ game.language ‖ "English"` | `promptContext.js:441` |
| `difficulty` | `game.difficulty || "standard"` | `promptContext.js:436` |
| `difficultyGuidanceChats` | `buildDifficultyGuidance(difficulty, "chats")` | `promptContext.js:437` / builder `170` |
| `difficultyGuidanceJumpForward` | `buildDifficultyGuidance(difficulty, "jump")` | `promptContext.js:438` |
| `simulationRules` | `world.simulationRules` or "No extra simulation rules were provided." | `promptContext.js:454` |
| `worldBeforeRoundOne` | `world.startingTimelineText` or "No pre-game world briefing…" | `promptContext.js:459` |
| `numberOfRegions` | (above) | `promptContext.js:444` |
| `eventsToConsolidate` | Explicit batch, else `buildEventHistoryText(events, {limit:12})` | `promptContext.js:439` |
| `gameMasterRequest` | The `gameMasterRequest` option | `promptContext.js:440` |
| `catalystDate` | `= date` | `promptContext.js:420` |
| `catalystPercent` | `min(100, activeCatalyst.history.length*50)%`, else "0%" | `promptContext.js:422` |
| `catalystPremise` | `catalystPremise` option | `promptContext.js:425` |
| `catalystHistory` | `catalystHistory` option (choice→summary log) | `promptContext.js:423` |
| `catalystChoice` | `catalystChoice` option (the just-chosen option) | `promptContext.js:418` |
| `catalystOpening` | `catalystOpening` option | `promptContext.js:419` |

`buildPromptContext` accepts an options bag (`promptContext.js:379`): `actionInput`, `advisorLimit`, `catalystChoice/History/Opening/Premise`, `chat`, `chatLimit`, `chatsToConsolidate`, `eventLimit`, `eventsToConsolidate`, `gameMasterRequest`, `longEventLimit`, `respondingPolityName`, `targetDate`. Each task's entry point passes the ones it needs (e.g. `simulateTimelineJump` passes `targetDate`; `advanceActiveCatalyst` passes `catalystChoice/History/Premise/Opening`).

---

## 6. Call-time appended directives

Concatenated onto the system prompt in `runJsonTask` / `callAI` **after** the template renders. They exist in code (not `defaultPrompts.json`) so they reach frozen-prompt campaigns (§2).

| Directive | Applies to | Source |
|---|---|---|
| **Difficulty** — one of 6 blurbs steering success rates | every task (via `readGameData`); leader (via `buildDiplomaticSystemPrompt`) | `gameplay.js:400`, `main.jsx:1063`; text in `difficulty.js` |
| **[Player Agency]** — never commit the player to treaties/wars they did not order; surface offers as open chats/events | `jumpForward`, `autoJumpForward` | `gameplay.js:411` |
| **[Map Truth]** — capture/annex/cede language *requires* matching `impacts.regionTransfers`; resolving the player's own ordered offensives is allowed | `jumpForward`, `autoJumpForward` | `gameplay.js:420` |
| **[International Reputation]** — how the world regards the player biases behavior; record changes via `polityChanges.reputation` (0–100) | `actions`, `jumpForward`, `autoJumpForward`, `catalystCreation`, `catalystExecutor` | `gameplay.js:425` |
| **Language** — write all human-readable text in the UI language; keep JSON keys/ISO codes/dates unchanged | every `callAI` call (advisor, leader, all tasks, intel briefing) when language ≠ `en` | `callAI` `main.jsx:945`; text `i18n.js:137` |
| **Military feasibility** — era-reach/unit-type/distance doctrine; folded into `${CURRENT_UNITS}` not appended separately | conditional: only when units exist or actions text matches the military regex | `buildMilitaryFeasibilityText` `gameplay.js:319`, injected `372` |
| **Leader turn instruction** — "speak only as `<polity>`… optionally append `REACTION:<emoji>`" (a user-role turn, not system) | leader only | `main.jsx:1144` |

Difficulty text (`difficulty.js`): `very-easy`, `easy`, `medium` (default; `"standard"`/empty normalize to medium), `hard`, `very-hard`, `impossible`. `buildDifficultyGuidance` (`promptContext.js:170`) is a *separate* softer paragraph used inside the jump/chat prompt bodies via `DIFFICULTY_DESCRIPTION_*`.

---

## 7. AI tasks

Each subsection: purpose · default prompt location · entry point · key inputs · output tool/schema · validation & fallback. All schemas are in `gameplaySchemas.js`; the tool name is what the model calls. Task text lives at `defaultPrompts.json` `tasks.<key>`.

### 7.1 `jumpForward` — manual time skip
- **Purpose:** Simulate every event between the origin date and a player-chosen target date; move the map, units, structures, diplomacy.
- **Prompt:** `tasks.jumpForward`. **Entry:** `simulateTimelineJump({days, mode:"jump", signal})` `gameplay.js:1852`.
- **Inputs:** full state bundle; `targetDate`; event-count band from `eventCountRangeForDays(days)` (`1834`) with a floor of one event per queued action; duration label; `${CURRENT_UNITS/MAP_STRUCTURES/CITY_COORDINATES}`.
- **Tool/schema:** `submit_jump_result` / `JUMP_FORWARD_SCHEMA` (`gameplaySchemas.js:399`). Payload: `events[]` (each `date/title/description` + `impacts`), `stopDate`, `summary`, `clearActions`, nullable `catalyst`, top-level `diplomaticOutreach[]`.
- **Validation:** `validatePayload` (`gameplay.js:1897`) — strict on attempt 1 / salvage on final: event-count range, `validateTimelineDates` (`125`) then `clampTimelineDates` (`187`) on salvage, then `validateGeneratedWorldChanges` (`1002`) resolving region names → ids (`resolveRegionTransfers` `831`) with a corrective owner-region list (`buildTransferFeedback` `940`) and the **capture-reluctance guard** (`CAPTURE_LANGUAGE` `994`, guard `1020`). **Fallback:** `fallbackJumpSimulation` (`1142`). Timeout: unbounded unless the "Limit AI generation" map setting is on (then 5 min); `signal` aborts cleanly.
- **Applied by:** `applySimulationResult` (`1305`) — appends events, bumps round/date, resolves planned actions, applies impacts, opens generated chats, writes a `simulationHistory` entry, snapshots for rollback.

### 7.2 `autoJumpForward` — auto skip to the next notable event
- **Purpose:** Same engine, but **stop early** at the first strategically notable / player-relevant / catalyst-worthy event and set it `notable:true`.
- **Prompt:** `tasks.autoJumpForward`. **Entry:** `simulateAutoJump({days=365, signal})` → `simulateTimelineJump(mode:"auto")` `gameplay.js:1946`.
- **Tool/schema:** `submit_jump_result` / `AUTO_JUMP_FORWARD_SCHEMA` (= `JUMP_FORWARD_SCHEMA`, `gameplaySchemas.js:429`).
- **Validation:** same validator; in `auto` mode `stopDate` may be any date after origin and ≤ target (`validateTimelineDates` `153`); the event-count range is not strictly enforced.

### 7.3 `actions` — strategic action suggestions
- **Purpose:** Produce 6–9 "Topics of Concern," each with 2–5 concrete actions (kind `action`, or `chat` for outreach).
- **Prompt:** `tasks.actions`. **Entry:** `generateActionSuggestions({force})` `gameplay.js:1430`.
- **Tool/schema:** `submit_actions` / `ACTIONS_SCHEMA` (`gameplaySchemas.js:369`): `topics[] { title, description, actions[] { title, text, kind, invitees, chatStarter } }`.
- **Validation/fallback:** accepts array/`topics`/`suggestions` shapes; empty → `fallbackActionSuggestions` (`678`, from `DEFAULT_SUGGESTION_TOPICS`). Result stored on `world.actionSuggestions`.

### 7.4 `descriptionToAction` — freeform text → structured command
- **Purpose:** Turn the player's raw sentence into one action (or a chat invitation), ~50% longer, tone-matched, ≤650 chars.
- **Prompt:** `tasks.descriptionToAction`. **Entry:** `refinePlayerAction(rawInput, {persist})` `gameplay.js:1597` (passes `actionInput`).
- **Tool/schema:** `submit_description_to_action` / `DESCRIPTION_TO_ACTION_SCHEMA` (`483`): `{ title, text, kind, invitees[], chatStarter }`.
- **Fallback:** `fallbackDescriptionToAction` (`708`) — heuristic chat detection via `CHAT_HINT_PATTERNS` (`46`) and `inferInviteeNames`.

### 7.5 `nextSpeaker` — pick the next diplomat
- **Purpose:** Choose which participant speaks next in an open chat (never the last speaker).
- **Prompt:** `tasks.nextSpeaker`. **Entry:** `chooseNextDiplomaticSpeaker({chat, excludeSpeaker})` `gameplay.js:1630`.
- **Tool/schema:** `submit_next_speaker` / `NEXT_SPEAKER_SCHEMA` (`497`): `{ nextSpeaker }`.
- **Fallback:** `fallbackNextSpeaker` (`740`) — mentioned polity, else first non-excluded participant. (The chosen polity's actual reply is generated by the **leader** root prompt, §7.14.)

### 7.6 `eventConsolidator` — compress history
- **Purpose:** Fold a batch of events + closed chats into one continuity summary (~≤360 words) so old detail leaves the context window without losing map/diplomacy facts.
- **Prompt:** `tasks.eventConsolidator`. **Entries:** `consolidateHistoryBatch` (`535`, auto-run by `compactHistoryIfNeeded` `554` after jumps) and `consolidateRecentHistory({limit})` (`1662`).
- **Tool/schema:** `submit_event_consolidation` / `EVENT_CONSOLIDATOR_SCHEMA` (`507`): `{ summary }`.
- **Fallback:** concatenate raw event lines + `buildChatSummaryText`. Triggers: `CONSOLIDATION_*` thresholds (`gameplay.js:530`).

### 7.7 `catalystCreation` — open a branching scene
- **Purpose:** Design an immersive interactive "catalyst" scene with an opening and 2–5 choices.
- **Prompt:** `tasks.catalystCreation`. **Entry:** `createCatalyst({force})` `gameplay.js:1670`.
- **Tool/schema:** `submit_catalyst_creation` / `CATALYST_CREATION_SCHEMA` (= `catalystSchema`, `gameplaySchemas.js:346`): `{ title, premise, opening, choices[2..5] }`. Written to `world.activeCatalyst`.

### 7.8 `catalystExecutor` — advance a scene
- **Purpose:** React to the player's chosen option, advance the scene, add to a progress bar, and offer next choices (or resolve).
- **Prompt:** `tasks.catalystExecutor` (uses `${catalystChoice}` and `${RUNNING_CATALYST_PERCENT}`). **Entry:** `advanceActiveCatalyst(choiceText)` `gameplay.js:1701`.
- **Tool/schema:** `submit_catalyst_execution` / `CATALYST_EXECUTOR_SCHEMA` (`519`): `{ summary, resolved, nextChoices[] }`. Validator (`926`) enforces: empty `nextChoices` when resolved, ≥2 distinct otherwise.

### 7.9 `catalystSummary` — resolved scene → one event
- **Purpose:** When a catalyst resolves, condense it into a single campaign event.
- **Prompt:** `tasks.catalystSummary`. **Entry:** the resolution branch of `advanceActiveCatalyst` (`gameplay.js:1775`), then `applySimulationResult` with `mode:"catalyst"`.
- **Tool/schema:** `submit_catalyst_summary` / `CATALYST_SUMMARY_SCHEMA` (`539`): `{ title, description, importance }`.
- ⚠️ **Caveat:** the default `catalystSummary` string contains a large stray **"Game Master" / "Master Cheat Assistant"** block pasted mid-prompt (legacy content). The task still returns the `{title,description,importance}` shape; the real GM task is the separate `gameMaster` key (§7.11). If you rewrite this prompt, delete the embedded GM text.

### 7.10 `pregameHistory` — backstory generator
- **Purpose:** On the first open of a fresh game with a "World Before Round One" briefing, write 4–10 dated events **strictly before** the start date. Runs once (the `simulationHistory` entry doubles as the done-marker); events carry **no impacts** (world already reflects them); clock stays at start, round stays 1.
- **Prompt:** `tasks.pregameHistory`. **Entry:** `maybeGeneratePregameHistory()` `gameplay.js:2050`.
- **Tool/schema:** `submit_pregame_history` / `PREGAME_HISTORY_SCHEMA` (`448`): `{ events[1..12] { date,title,description,importance,kind }, summary }` — note the impact-free `pregameEventSchema` (`434`).
- **Validation:** `validatePregameEvents` (`2013`) — strict/salvage: all dates before start, chronological; non-Gregorian scenarios skip date checks. No fallback (silent null on failure).

### 7.11 `gameMaster` — direct map/state cheat
- **Purpose:** Apply an explicit player/GM request to the map/world; never argue or refuse.
- **Prompt:** `tasks.gameMaster`. **Entry:** `applyGameMasterCommand(requestText)` `gameplay.js:1949` (passes `gameMasterRequest`).
- **Tool/schema:** `submit_game_master` / `GAME_MASTER_SCHEMA` (`551`): `{ summary, impacts { regionTransfers, polityChanges, markerOps } }`.
- **Validation:** `validateGeneratedWorldChanges` (strict on attempt 1). **Fallback:** empty impacts + neutral summary. Wrapped as a "Game master intervention" event.

### 7.12 `countryStatSheet` — structured national stats
- **Purpose:** Compile a full stat sheet for a selected polity for the Stats tab.
- **Prompt:** `tasks.countryStatSheet`. **Entry:** `generateCountryStatSheet({code, name})` `gameplay.js:1580` (userMessage carries a `buildTargetDossier` (`1498`) + era slice).
- **Tool/schema:** `submit_country_stat_sheet` / `COUNTRY_STAT_SHEET_SCHEMA` (`569`): `capital, continent, government, leader, stability(0–100), indices{sovereignty,foodAutonomy,energyAutonomy,economicIndependence,internalSecurity,internationalReputation}, economy{gdp,gdpGrowth,gdpPerCapita,currency,inflation,unemployment,publicDebt,budgetBalance}, gdpBreakdown{agriculture,industry,services}`.
- **Validation:** all strings non-blank; all indices 0–100 integers; `agriculture+industry+services === 100` (`gameplaySchemas.js:940`). No fallback.

### 7.12b `unitDirector` — the native unit director

- **Prompt:** `tasks.unitDirector` (uses `${unitDirectorGameDate}`, `${unitDirectorRound}`, `${unitDirectorUnits}`, `${unitDirectorCandidates}`, all passed directly by the caller) plus the `[Native Unit Director — runtime rules]` directive appended at call time. **Entry:** `directGeneratedUnitOps` in `src/Game/AI/nativeUnitDirector.js`, called from `finishTimelineJump` after the segments are merged.
- **Purpose:** the jump writes history; this pass keeps the persistent order of battle coherent with it. Only events whose text describes an operational change (advance, redeploy, clash, mobilize, siege…) are offered, with the current units; the model answers `eventOrders` (unit ops per event index). Native rules keep only plausible ops: reuse before spawn (spawn budget, explicit new-formation cue), moves within the era leash of the unit type, strength only where the event narrates casualties/attrition/reinforcement, remove only for destruction/disbandment, no duplicates. Accepted ops are attached to the event and applied exactly like the simulator's own unitOps, so a long move becomes a standing order of the beta unit engine. There is no attack op on this build; a failed or unavailable director leaves the events unchanged.

### 7.13 `idleDiplomacy` — unprompted note drip
- **Purpose:** Between jumps, on each real-minute tick, a small chance a single polity sends the player a short note; usually the answer is silence (`chat: null`).
- **Prompt:** `tasks.idleDiplomacy` (uses lowercase `${playerPolity}`, `${dateReadable}`, `${worldSummary}`, `${recentEvents}`, `${chatSummary}`). **Entry:** `maybeSendIdleDiplomacy({chance})` `gameplay.js:2128` (1/20 default; suspended by the simulation busy-lock, `628`).
- **Tool/schema:** `submit_idle_diplomacy` / `IDLE_DIPLOMACY_SCHEMA` (`468`): `{ chat: null | createdChat }`. No editor section; no canned fallback (silent). A note from a country the player already 1:1s with lands in that thread.

### 7.14 Root prompt: `leader` — AI diplomacy
- **Purpose:** Roleplay a single non-player polity replying in an ongoing chat; hard rule to **match the player's average message length** and tone; simulate a polity leaving.
- **Prompt:** top-level `leader` string. **Assembly:** `buildDiplomaticSystemPrompt(countries, playerCountry)` (`main.jsx:1036`, `+difficultyDirective`) then `sendDiplomaticMessage(playerMessage, speakingAs, countries)` (`1138`) adds the per-turn instruction + optional `REACTION:<emoji>`. Free-form text (no tool/schema). `${RESPONDING_POLITY_NAME}` selects the voiced polity.

### 7.15 Root prompt: `advisor` — chief advisor chat
- **Purpose:** In-character strategic advice, ≤3000 chars, may append a `chart`-fenced Chart.js block. **Assembly:** `buildAdvisorSystemPrompt` (`main.jsx:1012`) + `sendMessage` (`1084`) with rolling `advisorHistory`; language directive only (no difficulty, no schema).

### 7.16 Not in the prompt pack: `generateCountryStats` — intel briefing
- **Purpose:** Free-text bulleted intelligence briefing on a polity. Builds its **own inline system prompt** (dossier + world snapshot + recent events) and calls `callAI` **directly** (no tool, no `runJsonTask`, so only the language directive is appended). Entry: `generateCountryStats({code, name})` `gameplay.js:1551`. Distinct from `countryStatSheet` (§7.12).

---

## 8. Impacts / output-shape reference

Shared `impacts` object (`impactsSchema` `gameplaySchemas.js:282`) carried by jump/auto/gameMaster events. All entries are optional arrays; omit empties.

| Field | Entry shape | Resolution / notes |
|---|---|---|
| `regionTransfers` | `{ regionId, regionName?, fromCode?, toCode, note? }` | `regionId` may be a plain name; `resolveRegionTransfers` (`gameplay.js:831`) maps name→id (owner-disambiguated). Unresolved → strict corrective feedback (attempt 1) or dropped (final). Required whenever event text claims a capture (Map Truth guard). |
| `polityChanges` | `{ code, name?, color?, aliases?, reputation?(0–100), tags?, note? }` | `reputation` was recently added to the schema (`107`); without the schema entry, json-schema providers could never emit it. `tags` is the *complete* new trait list, not a delta. |
| `createdChats` | `{ countries[≥1], title, openingMessage, speaker }` | Initiating polity speaks first, never the player. `validateChatOpener` (`979`) requires title + opening. Built into a real chat by `buildGeneratedChat` (`762`). |
| `unitOps` | `spawn{unit{name,type∈enum,ownerCode,strength 1–1000,lng,lat,regionId?}}` · `move{unitId,toLng,toLat,regionId?,note?}` · `strength{unitId,strength 0–1000}` · `remove{unitId}` | `unitOpSchema` (`178`). Ops on unknown unit ids: strict error / salvage drop. `strength:0` or `remove` deletes the unit. |
| `markerOps` | `build{marker{name,kind(free lowercase),ownerCode?,lng,lat,note?,foundedAt?}}` · `remove{name}` | `markerOpSchema` (`256`). Structures never move borders (no `regionTransfers`). |

Jump payloads also carry a top-level `diplomaticOutreach[]` (same shape as `createdChats`, not tied to an event) and a nullable `catalyst`. The schema validator (`validateGameplayPayload` `852`) additionally enforces non-blank `stopDate`/event fields, "at least one event, summary, or meaningful catalyst," and distinct catalyst choices.

---

## 9. Recipes

### Add a new template variable
1. **Compute it** in `buildPromptContext`'s return object (`promptContext.js:413`) — e.g. `myThing: buildMyThing(bundle.world)`. Add a builder next to the others if non-trivial. (If it needs reputation/feasibility-style augmentation only for tasks, add it in `buildTemplateVariables` `gameplay.js:367` instead — but remember advisor/leader won't see those.)
2. **Expose a placeholder** in `defaultPrompts.json` `helpers`: `"MY_THING": "${myThing}"`.
3. **Reference it** in the task/root text as `${MY_THING}` (or the lowercase `${myThing}` directly).
4. **(Optional) editor:** add `MY_THING` to the relevant section's `helpers` list in `PROMPT_SECTION_DEFINITIONS` (`gameplayPrompts.js:15`) so it shows in the Prompts editor hints.
5. Nothing else — `renderTemplate` picks up any key present in the merged `{...variables, ...helperValues}` map.

### Add a new task
1. **Schema + tool:** define `MY_TASK_SCHEMA` and `MY_TASK_TOOL = makeTool("submit_my_task", …)` in `gameplaySchemas.js`; register both in `GAMEPLAY_SCHEMAS` (`621`) and `GAMEPLAY_TOOLS` (`717`) under the new key; add any task-specific checks to `validateGameplayPayload` (`852`).
2. **Prompt text:** add `tasks.myTask` to `defaultPrompts.json` ending with the JSON output contract. It is auto-picked-up: `PROMPT_TASK_KEYS = Object.keys(tasks)` and `normalizePromptPack` iterate it (`gameplayPrompts.js:230`, `246`).
3. **Entry point:** in `gameplay.js`, build variables (`buildTemplateVariables(bundle, {…})`) and call `runJsonTask("myTask", { userMessage, variables, fallback?, validatePayload?, timeoutMs? })`. Wrap state-writing tasks in `beginSimulation()/endSimulation()`.
4. **Call-time directives:** if the rule must apply to existing games, add the task key to the relevant `if ([...].includes(taskKey))` blocks in `runJsonTask` (`gameplay.js:411`/`425`) rather than only in the JSON (frozen-prompt caveat, §2).
5. **(Optional) editor:** add a `PROMPT_SECTION_DEFINITIONS` entry (`type:"task"`) so it is user-editable per scenario.

---

## 10. Gotchas

- **`worldSummary` and `worldSummaryNoCity` are the same string** — the "no city" name is historical; city coordinates are a separate `citiesSummary`/`${CITY_COORDINATES}`.
- **Two output attempts per task**, then a deterministic fallback (or throw). `finalAttempt` comes from `runJsonTask`, never from counting validator calls — attempt-1 schema failures skip `validatePayload` entirely (`gameplay.js:464` comment).
- **Reputation and military-feasibility reach only the task path** (`buildTemplateVariables`). Advisor/leader use `buildPromptContext` directly and never see them.
- **`catalystSummary` contains stray embedded "Game Master" text** (§7.9) — the actual GM task is `gameMaster`.
- **`idleDiplomacy` and the intel `generateCountryStats` briefing are invisible to the Prompts editor** — the former has no `PROMPT_SECTION_DEFINITIONS` entry; the latter is an inline prompt not in `defaultPrompts.json`.
- **Editing `defaultPrompts.json` does not retroactively change existing campaigns** — they carry frozen prompt copies; use call-time appends for universal rules.
