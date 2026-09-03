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
| Where the active game's prompt overrides are read from | `src/runtime/assets.js` | `JSON_URLS.prompts = /api/runtime/json/prompts` |
| Per-scenario prompt editor UI ("Prompts" tab) | `src/Game/GameUI/libraryBar.jsx` | `handlePromptChange`, `serializePromptPack` on save |

See [World state](world-state.md) for the `world.json` shapes (`regionOwnershipOverrides`, `polityOverrides`, `units`, `markers`, `activeCatalyst`, `consolidatedHistory`, `simulationHistory`) that the context builders read.

---

## 2. The three prompt "kinds" and how they are stored

`defaultPrompts.json` has exactly three top-level buckets:

| Kind | JSON key | Contains | Rendered by |
|---|---|---|---|
| Root: **advisor** | `advisor` (string) | Chief-advisor side-panel chat | `buildAdvisorSystemPrompt` (`main.jsx`) |
| Root: **leader** | `leader` (string) | AI diplomacy — polities replying in a chat | `buildDiplomaticSystemPrompt` (`main.jsx`) |
| **tasks** | `tasks.<key>` (strings) | 13 structured JSON tasks (below) | `runJsonTask` (`gameplay.js`) |
| Helper map | `helpers` (object) | `${PLACEHOLDER}` → `${templateVar}` indirection | `resolveHelperValues` (`promptContext.js`) |

### Override / storage model

- The bundled `defaultPrompts.json` is the fallback. The **active game** may ship its own `prompts` asset, served at `JSON_URLS.prompts` (`/api/runtime/json/prompts`). Both `runJsonTask` (via `loadPromptCatalog`, `gameplay.js`) and the advisor/leader path (via `ensurePromptsLoaded`, `main.jsx`) read it.
- `normalizePromptPack` (`gameplayPrompts.js`) merges **per key with fallback**: for every task key in `PROMPT_TASK_KEYS`, an override is used only if it is a non-blank string, else the default. Same for `advisor`, `leader`, and each `helpers` entry. A partial override (one task) leaves all others at default.
- Scenarios persist overrides under `details.data.prompts`. The library "Prompts" editor writes them: root sections write `prompts[key]`, task sections write `prompts.tasks[key]`, helpers write `prompts.helpers[key]` (`libraryBar.jsx`), and `serializePromptPack` flattens on save (`gameplayPrompts.js`).
- `PROMPT_SECTION_DEFINITIONS` (`gameplayPrompts.js`) drives the editor UI: one entry per editable section with a `label`, `type` (`root` | `task`), and a **declared** `helpers` list. Note two mismatches with the runtime: `idleDiplomacy` is a real task but has **no editor section** (not user-editable in the UI, still overridable via `prompts.tasks.idleDiplomacy`), and the declared helper lists are hints — some listed placeholders (e.g. `CONSOLIDATED_HISTORY`, `PLAYER_POLITY_REPUTATION_CONTEXT`) are **not** referenced by the current default text.

### ⚠️ Frozen-prompt caveat (read this before adding a rule to defaultPrompts.json)

**Existing campaigns carry a frozen copy of the task prompts.** A game created before your edit keeps whatever prompt text it was seeded with; editing `defaultPrompts.json` only affects games that read the default (no override) or new scenarios. This is *the* reason several critical rules are **appended at call time in `runJsonTask`** instead of living in the JSON (see §6): Player Agency, Map Truth, and International Reputation reach old games only because they are concatenated onto the system prompt every call. If a rule must apply retroactively to all campaigns, append it in code, not in `defaultPrompts.json`.

**There is one exception, and it is the cheapest route available: a NEW task key.** `normalizePromptPack` falls back to `PROMPT_TASK_DEFAULTS` for any key a stored pack has no override for, and no save can hold an override for a key that did not exist when it was frozen. So adding `tasks.myNewTask` to `defaultPrompts.json` reaches **every existing campaign immediately**, with no migration and no call-time injection. That is how the `projects` task shipped, and why all of its rules live in the template rather than in code.

**Two other ways a rule can reach a frozen save without editing its pack:**

- `templateAlreadySays` (`promptDedupe.js`) — a call-time directive can check whether the rendered template already contains it, and skip itself if so. A frozen save lacking the text still receives it; a new save stops paying for it twice. Used by `[Units on the Map]`, whose bundled-template wording it duplicates almost verbatim.
- `collapseRepeatedBlock` (`promptDedupe.js`) — collapses a large block the assembled prompt carries more than once, keeping the first copy. The scenario briefing arrives by two routes (the task text's own `${WORLD_BEFORE_ROUND_ONE_TEXT}`, and again inside `buildWorldSummary`), which on a real campaign was **107,870 characters sent twice**. It cannot be fixed in the templates: existing saves are frozen, and `countryStatSheet` and `actions` reach the briefing *only* through the world summary.

---

## 3. How a final prompt is assembled, end to end

### 3a. Task path (`runJsonTask`, `gameplay.js`)

Order of concatenation onto the system prompt:

1. **Load pack** — `loadPromptCatalog()` → `normalizePromptPack(readJson(JSON_URLS.prompts))` (per-key override or default).
2. **Resolve helpers** — `helperValues = resolveHelperValues(prompts.helpers, variables)` (`promptContext.js`). Two passes so a helper that references another helper resolves.
3. **Render task text** — `systemPrompt = renderTemplate(prompts.tasks[taskKey], { ...variables, ...helperValues })` (`gameplay.js`). `renderTemplate` (`promptContext.js`) replaces `${key}` with `variables[key]` (missing/`null` → empty string). Both uppercase `${PLACEHOLDER}` keys (from `helperValues`) and lowercase `${var}` keys (from `variables`) are in scope.
4. **+ Difficulty directive** — `\n\n${difficultyDirective(game.difficulty)}` for every task (`gameplay.js`).
5. **+ Player Agency** and **+ Map Truth** — only `jumpForward`, `autoJumpForward` (`gameplay.js`–`420`).
6. **+ International Reputation** — only `actions`, `jumpForward`, `autoJumpForward`, `catalystCreation`, `catalystExecutor` (`gameplay.js`).
7. **Call `callAI(systemPrompt, [{role:"user", parts:[{text: userMessage}]}], { tool, maxTokens: 8192, ... })`.** Inside `callAI` (`main.jsx`): **+ Language directive** `\n\n${languageDirective()}` when the UI language ≠ English.
8. **Provider layer** (`main.jsx`): native tool-use providers (Anthropic/OpenAI/Gemini) pass `tool.schema` as a tool; the JSON-schema fallback path appends `\n\nReturn only one JSON object matching this JSON Schema…\n${JSON.stringify(tool.schema)}` (`main.jsx`). `maxTokens` is floored at 8192 by capped providers; Gemini ignores it.

So the final task system prompt is:

```
<rendered task text>
\n\n<difficulty directive>
[\n\n[Player Agency]…\n\n[Map Truth]…]        (jump tasks only)
[\n\n[International Reputation]…]              (5 tasks only)
\n\n<language directive>                        (non-English only)
[\n\n Return only one JSON object … <schema>]  (json-schema fallback providers only)
```

Retry (`gameplay.js`): each task gets **two output attempts**. On attempt-1 failure the model's raw answer plus a corrective user turn are appended to `history`, and attempt 2 runs against the same system prompt. `validatePayload` receives `{ attempt, finalAttempt }`; `finalAttempt` (attempt 2) switches validators from *strict* (return a corrective string) to *salvage* (repair in place). If both attempts fail, the deterministic `fallback()` runs (or, for tasks with no fallback, it throws). A user `signal` abort propagates and cancels rather than falling back.

### 3b. Advisor / leader path (`main.jsx`)

These do **not** go through `runJsonTask` or `buildTemplateVariables`; they build variables directly from `buildPromptContext` (`buildPromptVariables`, `main.jsx`, with `eventLimit: 16`).

- **Advisor** (`buildAdvisorSystemPrompt`, `main.jsx`): `renderTemplate(promptPack.advisor, { ...variables, ...helperValues })` **+ `\n\n${buildAdvisorActionsDirective(plannedActionsWithIds)}` + `\n\n${ADVISOR_MESSAGE_DRAFT_DIRECTIVE}`** (`[Action Planning]` and `[Drafting Messages to Send]`, both appended at call time like §6's directives, for the same frozen-prompt reason) → `callAI` (language directive only). No difficulty, no schema (free-form text reply). Called by `sendMessage` (`main.jsx`) with a rolling `advisorHistory`.
  - `[Action Planning]` lets the advisor create/edit/remove the player's queued Actions as an ordinary part of chatting — no separate confirmation screen. It ends a reply with a fenced `` ```actions `` JSON array (stripped from the displayed text by `advisor.jsx`'s `parseMessage`); each entry creates (no `id`), edits (`id` + changed fields), or removes (`id` + `remove:true`) one queued action. IDs must be copied from `${plannedActionsWithIds}` (`buildPlannedActionsWithIdsText`, `promptContext.js`) — the one action-history rendering that exposes ids, since editing/removing a *specific* action needs a stable handle the way title-matching doesn't. Applied client-side by `advisor.jsx`'s `applyAdvisorActions` (`readActionsState`/`writeActionsState` — the same storage `actions.jsx` uses) right when a reply arrives, never at render time; the outcome renders as an `AdvisorActionsCard` in the chat bubble.
  - `[Drafting Messages to Send]` gives a real "Send message to X" button to a diplomatic message the advisor drafts in a blockquote. Alongside the blockquote(s) it appends a single fenced `` ```senddraft `` JSON array of `{country}` entries, one per drafted message, in the same order the blockquotes appear — the JSON deliberately carries no `text` field. `advisor.jsx`'s `parseMessage` reads the message text back out of the blockquote itself (`extractBlockquotes`, matched to each JSON entry positionally **from the end** — the fence follows the drafts, so the drafted letters are the last blockquotes in the reply, and aligning forwards would mispair every draft whenever the advisor also quoted the player earlier in the same reply; an explicit `text` field is still honored if present, for messages saved under the old format) rather than trusting the model to retype the letter verbatim into a JSON string — that was the original design, and it silently dropped the button whenever the retyped text contained an unescaped quote or a real line break, since `extractFencedJson` discards a fence it can't `JSON.parse` (now logged via `console.warn`) with no other trace. `advisor.jsx` renders one `AdvisorDraftSend` button per entry; clicking it calls `gameplay.js`'s `sendAdvisorDraftedMessage({ countryName, text })`, which resolves the country via `resolveInvitees`, finds (or opens) that country's 1-on-1 Diplomacy thread via `chatParticipantKey`/`foldGeneratedChatsIntoStorage`, gets a reply through `main.jsx`'s `sendDiplomaticMessageOnceOff` (a history-isolated sibling of `sendDiplomaticMessage` that never touches the module-level `diplomaticHistory` a live `ConversationView` may have loaded), and writes both messages to `chat.json` under the same `beginSimulation`/`endSimulation` busy-lock as `rollBackToSnapshot`. The open Diplomacy panel picks it up via its own 5s storage poll (`chat.jsx`) as if the player had sent it themselves. Once sent, the advisor message is patched with `sentDrafts: [draftIndex, …]` (persisted via `saveMessages`) so the button stays "✓ Sent" across a reload instead of reappearing clickable.
- **Leader** (`buildDiplomaticSystemPrompt`, `main.jsx`): `renderTemplate(promptPack.leader, …)` **+ `\n\n${difficultyDirective}`** (`main.jsx`). Then `sendDiplomaticMessage` (`main.jsx`) appends a per-turn user instruction telling the model to speak as one specific polity and optionally emit a trailing `REACTION:<emoji>` line (`main.jsx`), which `parseReaction` strips. `callAI` adds the language directive.

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

Lowercase variables referenced **directly** by task text (no helper alias): `${language}` (all tasks), and in `idleDiplomacy` — `${playerPolity}`, `${dateReadable}`, `${worldSummary}`, `${recentEvents}`, `${chatSummary}`; in `catalystExecutor` — `${catalystChoice}`; in `spyIntercept` — `${targetPolity}` and `${disinformation}` (the latter non-empty **only** when the agent has been turned, which is what makes a double agent's reports read as plausible fabrications rather than nothing at all).

---

## 5. Template variable reference (the full map)

Every key on the object returned by `buildPromptContext` (`promptContext.js`, return block 413–462), plus the two keys `buildTemplateVariables` (`gameplay.js`) adds/overrides. This is the master set available to `renderTemplate`.

| Variable | Inserts | Computed at |
|---|---|---|
| `playerPolity` | `game.country` or "Unknown polity" | `promptContext.js` |
| `playerPolityRegions` | Player's owned-region names, "No player polity…", "No explicit… override list", or the LANDLESS block | `buildPlayerPolityRegionsText` `promptContext.js` (LANDLESS text 287) |
| `playerBattalionSummaries` | `buildUnitsSummaryText(world)` (up to 60 units, coords/type/owner/strength/status) | `promptContext.js` / builder `195` |
| `unitsSummary` | Same unit text; **`buildTemplateVariables` appends `buildMilitaryFeasibilityText`** (era-reach/type/distance doctrine) only when units exist or the actions text matches the military regex | `promptContext.js`; override `gameplay.js`; feasibility builder `319` |
| `playerPolityReputationContext` | "International reputation: N/100 (poor/mixed/well-regarded)." from `world.internationalReputation[player]`, else last viewed stat sheet, else 50 | `buildPlayerPolityReputationText` `gameplay.js` (added `371`) |
| `worldSummary` | Multi-section snapshot: player line + tags, round, date, language, difficulty, world-before-round-one, simulation rules, up-to-24 territorial overrides, up-to-16 polity overrides (incl. `note` lore), up-to-40 country tag lines, active-catalyst line | `buildWorldSummary` `promptContext.js` |
| `worldSummaryNoCity` | **Identical** to `worldSummary` | `promptContext.js` |
| `citiesSummary` | City coordinate lines: custom-city scenarios use the era geojson (tier/pop sorted, ≤200); otherwise the stock significant slice (capitals + pop ≥ 2M, cached) | `buildCityCatalogText` `promptContext.js` |
| `markersSummary` | `world.markers` structures (≤60) with kind/owner/coords/note | `buildMarkersSummaryText` `promptContext.js` |
| `pendingUnitOrders` | `world.pendingUnitOrders` still-outstanding lines: unit, destination/target, current position, km remaining; or "No units currently have a standing multi-turn order…" | `buildPendingUnitOrdersText` `promptContext.js` (read directly by `runJsonTask`, not via a `${PLACEHOLDER}`) |
| `numberOfRegions` | `String(regionCatalog.length)` | `promptContext.js` |
| `recentEvents` | Unconsolidated event history, `eventLimit` window (10 default; 16 on advisor/leader path) | `buildEventHistoryText` `promptContext.js` |
| `recentEventsLong` | `buildCampaignHistoryText`: "STORY SO FAR" (consolidated) + "RECENT EVENTS" (≤`longEventLimit`, 24) | `promptContext.js` / builder `95` |
| `consolidatedHistory` | `buildConsolidatedHistoryText(world)` — the `consolidatedHistory[]` summaries | `promptContext.js` / builder `86` |
| `recentRoundsWithDates` | `from → to` date pairs from `world.simulationHistory` (≤8) | `buildRecentRoundsWithDates` `promptContext.js` |
| `chatHistory` | Current chat's `speaker: text` lines, or "No chat history." | `promptContext.js` |
| `chatHistoryLong` | `buildDetailedChatHistoryText(unconsolidatedChats, {limit: chatLimit})` | `promptContext.js` / builder `153` |
| `chatSummary` | One-line-per-chat last-message summary | `buildChatSummaryText` `promptContext.js` / builder `142` |
| `chatParticipants` | Current chat's participant names, comma-joined | `promptContext.js` (overridden with a bulleted list in `buildDiplomaticSystemPrompt`, `main.jsx`) |
| `chatsToConsolidate` | Explicit batch, else detailed transcript (≤12 chats, ≤50 msgs) | `promptContext.js` |
| `chat` | `JSON.stringify(unconsolidatedChats)` | `promptContext.js` |

**`chatHistoryLong` is visibility-filtered, and it is the only variable that is.** `buildDetailedChatHistoryText` takes a `visibleTo` option naming the polity the prompt speaks as, and keeps only chats that polity was a participant in (`chatVisibility.js`). Threaded through `buildPromptContext`'s `chatVisibleTo`, set from `speakingAs` on the leader path.

| Prompt | Speaks as | Sees |
|---|---|---|
| `leader` | one polity | **only chats that polity was in** |
| `advisor` | the player's own staff | everything — the player is in every chat, so the filter is a natural no-op |
| `jumpForward` / `autoJumpForward` | the omniscient narrator | everything; it must resolve what actually happened |
| `eventConsolidator` | the archivist | everything; it folds the whole round into canon |

Without it, every AI leader read the player's private letters to every other power — so there was no such thing as a confidential channel, and leaders visibly borrowed each other's phrasing. The filter **fails closed**: a chat with no recorded participants is hidden from a named polity, because wrongly showing one is a silent breach while wrongly hiding one is visible and recoverable. Group chats fall out correctly for free, since every power listed in `countries` was in the room.

`unconsolidatedChats` (`promptContext.js`) is sorted most-recently-ACTIVE first (`sortChatsByLastActivity`, walking each chat's messages backward for the first usable `time`, same convention as chat.jsx's `chatLastMessageTime`) before anything above slices it to a `limit`. Chats are only ever prepended to storage on creation, never reordered when a new message lands on an existing one — without this sort, a long-running chat that started many rounds ago but is still being actively messaged could silently fall out of `chatHistoryLong`'s window just because several other chats were *started* more recently, even though none of them were as current. (Real bug: the advisor had no record of an ongoing Algeria negotiation because Algeria's chat, opened in round 1, had aged past `chatLimit` while newer-but-quiet chats occupied the slice.)
| `lastSpeaker` | Current chat's last speaker name | `promptContext.js` |
| `respondingPolityName` | Option override, else first non-player participant | `promptContext.js` |
| `advisorMessages` | `buildAdvisorHistoryText(bundle.advisor, {limit: advisorLimit=18})` | `promptContext.js` / builder `127` |
| `actions` | `formatActionsForPrompt(bundle.actions)` (title + display text) | `promptContext.js` / builder `156` |
| `plannedActions` | `buildActionHistoryText(bundle.actions)` (planned only) | `promptContext.js` / builder `140` |
| `plannedActionsWithIds` | `buildPlannedActionsWithIdsText(bundle.actions)` — same planned-only list, WITH each action's `id` (the only action-history text that shows ids) | `promptContext.js` / builder `promptContext.js` (used only by the advisor's `[Action Planning]` directive, §3b) |
| `allActions` | `buildActionHistoryText(…, {includeResolved:true})` | `promptContext.js` |
| `actionInput` | The `actionInput` option (raw player text) | `promptContext.js` |
| `date` | `game.gameDate` (raw) | `promptContext.js` |
| `dateReadable` | `formatDateReadable(date)` → "D MMMM YYYY" (dayjs); raw text if unparseable | `promptContext.js` / builder `165` |
| `startDate` | `game.startDate` | `promptContext.js` |
| `round` | `String(game.round || 1)` | `promptContext.js` |
| `targetDate` | `targetDate` option or `date` | `promptContext.js` |
| `targetDateReadable` | `formatDateReadable(target)` | `promptContext.js` |
| `language` | `world.language ‖ game.language ‖ "English"` | `promptContext.js` |
| `difficulty` | `game.difficulty || "standard"` | `promptContext.js` |
| `difficultyGuidanceChats` | `buildDifficultyGuidance(difficulty, "chats")` | `promptContext.js` / builder `170` |
| `difficultyGuidanceJumpForward` | `buildDifficultyGuidance(difficulty, "jump")` | `promptContext.js` |
| `simulationRules` | `world.simulationRules` or "No extra simulation rules were provided." | `promptContext.js` |
| `worldBeforeRoundOne` | `world.startingTimelineText` or "No pre-game world briefing…" | `promptContext.js` |
| `numberOfRegions` | (above) | `promptContext.js` |
| `eventsToConsolidate` | Explicit batch, else `buildEventHistoryText(events, {limit:12})` | `promptContext.js` |
| `gameMasterRequest` | The `gameMasterRequest` option | `promptContext.js` |
| `catalystDate` | `= date` | `promptContext.js` |
| `catalystPercent` | `min(100, activeCatalyst.history.length*50)%`, else "0%" | `promptContext.js` |
| `catalystPremise` | `catalystPremise` option | `promptContext.js` |
| `catalystHistory` | `catalystHistory` option (choice→summary log) | `promptContext.js` |
| `catalystChoice` | `catalystChoice` option (the just-chosen option) | `promptContext.js` |
| `catalystOpening` | `catalystOpening` option | `promptContext.js` |

`buildPromptContext` accepts an options bag (`promptContext.js`): `actionInput`, `advisorLimit`, `catalystChoice/History/Opening/Premise`, `chat`, `chatLimit`, `chatsToConsolidate`, `eventLimit`, `eventsToConsolidate`, `gameMasterRequest`, `longEventLimit`, `respondingPolityName`, `targetDate`. Each task's entry point passes the ones it needs (e.g. `simulateTimelineJump` passes `targetDate`; `advanceActiveCatalyst` passes `catalystChoice/History/Premise/Opening`).

---

## 6. Call-time appended directives

Concatenated onto the system prompt in `runJsonTask` / `callAI` **after** the template renders. They exist in code (not `defaultPrompts.json`) so they reach frozen-prompt campaigns (§2).

| Directive | Applies to | Source |
|---|---|---|
| **Difficulty** — one of 6 blurbs steering success rates | every task (via `readGameData`); leader (via `buildDiplomaticSystemPrompt`) | `gameplay.js`, `main.jsx`; text in `difficulty.js` |
| **[Player Agency]** — never commit the player to treaties/wars they did not order; surface offers as open chats/events | `jumpForward`, `autoJumpForward` | `gameplay.js` |
| **[Map Truth]** — capture/annex/cede language *requires* matching `impacts.regionTransfers`; resolving the player's own ordered offensives is allowed | `jumpForward`, `autoJumpForward` | `gameplay.js` |
| **[International Reputation]** — how the world regards the player biases behavior; record changes via `polityChanges.reputation` (0–100) | `actions`, `jumpForward`, `autoJumpForward`, `catalystCreation`, `catalystExecutor` | `gameplay.js` |
| **[Standing Unit Orders]** — re-surfaces every still-outstanding `world.pendingUnitOrders` entry as **context**. The engine advances these itself (`advanceStandingOrders`), so the model must NOT emit a move for one — that would advance the unit twice for the same elapsed time. It emits an op only to redirect or end an order. Independent of `clearActions`, which never touches this list. Omitted entirely when no order is outstanding. | `jumpForward`, `autoJumpForward` | `gameplay.js` (after [Unit Coordinates]) |
| **[Other Powers' Militaries]** — nudges the model to give major/currently-relevant powers visible `unitOps` activity (mobilizing, patrolling, garrisoning) even absent a player-facing event, so the map doesn't read as depopulated of anyone but the player | `jumpForward`, `autoJumpForward` | `gameplay.js` (after [Standing Unit Orders]) |
| **[New Developments Only]** — the events shown as context have already happened; emit only what is NEW this period. Stops the "rolling-date" restatement a de-dup cannot catch | `jumpForward`, `autoJumpForward` | `gameplay.js` |
| **[Place Renaming]** — `markerOps` `rename`, on structures AND existing map cities | `jumpForward`, `autoJumpForward` | `gameplay.js` |
| **[Region and City Capture]** — territory belongs to REGIONS; a `regionTransfers` naming a city matches nothing and is silently dropped. Also the `wholeCountry` shorthand for a total takeover | `jumpForward`, `autoJumpForward` | `gameplay.js` |
| **[Polity Names]** — every polity is its FULL name, never a code; a code mints a phantom country beside the real one | `actions`, jumps, `catalystCreation`, `catalystExecutor` | `gameplay.js` |
| **[Unit Coordinates]** — real lng/lat, decimal point, never the `0,0` placeholder from the output template | jumps, `idleDiplomacy` | `gameplay.js` |
| **[Units on the Map]** — the unit contract: units are evidence of the events, strength is a percentage, no teleporting, posture is how intent is read. **Skipped when the rendered template already says it** (`templateAlreadySays`) | `jumpForward`, `autoJumpForward` | `gameplay.js` + `promptDedupe.js` |
| **[Sovereign Acts and What Needs Consent]** — does this act need anyone else's agreement? Internal acts resolve this jump; anything touching another polity needs consent or a fait accompli, else `regionClaims` plus a project to obtain it | `jumpForward`, `autoJumpForward` | `gameplay.js` |
| **[Projects & Operations]** — how to move the board with `impacts.projectOps`. **Game master only** now: the jump hands the board to the separate `projects` task, and `catalystExecutor`/`catalystSummary` were removed because neither schema has an `impacts` field at all | `gameMaster` | `gameplay.js` |
| **[Durable Canon]** + **[Player Orders Being Consolidated]** — the summary REPLACES what it covers, so divergences and standing commitments must survive it | `eventConsolidator` | `gameplay.js` |
| **[World Pulse]** — minutes have passed, not months: at most two `unitOps`, never a garrison, never the player's own units | `idleDiplomacy` | `gameplay.js` |
| **[Espionage]** — the simulator's uncensored, both-directions view of who has an agent where, plus the decrypted intercepts (`espionageBrief`). Appended at call time, inside a try/catch, so a frozen-prompt campaign gets it and a failure costs the turn nothing | jumps | `gameplay.js` |
| **[Your Intelligence]** — the other direction: what ONE foreign leader has learned about the player through their own agent (`foreignAgentBrief`) — the cover story if the agent is turned, redacted stolen material if it is live, nothing if there is none | leader replies | `AI/main.jsx` |
| **Open conversations** — the idle pulse is shown the actual threads (`renderOpenChatsForPrompt`), not just one line each, because a note to a polity already talking to the player is APPENDED to that thread and must read as the next thing they say | `idleDiplomacy` | `gameplay.js` |
| **[What the Sender Knows]** — the pulse sees every chat so it can judge who would plausibly speak, but the polity it writes AS knows only its own conversations, what is public, and what the player told it directly | `idleDiplomacy` | `gameplay.js` |
| **`ACTIONS_REFERENCE`** (`[Actions You Can Take]`) — the full lever menu. Deliberately NOT de-duplicated against the template's tail: the bundled template predates `regionClaims`, `actionIds` and `projectOps`, so this block is the only place a frozen campaign is told those exist | `jumpForward`, `autoJumpForward` | `gameplay.js` |
| **Language** — write all human-readable text in the UI language; keep JSON keys/ISO codes/dates unchanged | every `callAI` call (advisor, leader, all tasks, intel briefing) when language ≠ `en` | `callAI` `main.jsx`; text `i18n.js` |
| **Military feasibility** — era-reach/unit-type/distance doctrine; folded into `${CURRENT_UNITS}` not appended separately | conditional: only when units exist or actions text matches the military regex | `buildMilitaryFeasibilityText` `gameplay.js`, injected `372` |
| **Leader turn instruction** — "speak only as `<polity>`… optionally append `REACTION:<emoji>`" (a user-role turn, not system) | leader only | `main.jsx` |

Difficulty text (`difficulty.js`): `very-easy`, `easy`, `medium` (default; `"standard"`/empty normalize to medium), `hard`, `very-hard`, `impossible`. `buildDifficultyGuidance` (`promptContext.js`) is a *separate* softer paragraph used inside the jump/chat prompt bodies via `DIFFICULTY_DESCRIPTION_*`.

---

## 7. AI tasks

Each subsection: purpose · default prompt location · entry point · key inputs · output tool/schema · validation & fallback. All schemas are in `gameplaySchemas.js`; the tool name is what the model calls. Task text lives at `defaultPrompts.json` `tasks.<key>`.

### 7.1 `jumpForward` — manual time skip
- **Purpose:** Simulate every event between the origin date and a player-chosen target date; move the map, units, structures, diplomacy.
- **Prompt:** `tasks.jumpForward`. **Entry:** `simulateTimelineJump({days, mode:"jump", signal})` `gameplay.js`.
- **Inputs:** full state bundle; `targetDate`; event-count band from `eventCountRangeForDays(days)` (`1834`) with a floor of one event per queued action; duration label; `${CURRENT_UNITS/MAP_STRUCTURES/CITY_COORDINATES}`.
- **Tool/schema:** `submit_jump_result` / `JUMP_FORWARD_SCHEMA` (`gameplaySchemas.js`). Payload: `events[]` (each `date/title/description` + `impacts`), `stopDate`, `summary`, `clearActions`, nullable `catalyst`, top-level `diplomaticOutreach[]`.
- **Validation:** `validatePayload` (`gameplay.js`) — strict on attempt 1 / salvage on final: event-count range, `validateTimelineDates` (`125`) then `clampTimelineDates` (`187`) on salvage, then `validateGeneratedWorldChanges` (`1002`) resolving region names → ids (`resolveRegionTransfers` `831`) with a corrective owner-region list (`buildTransferFeedback` `940`) and the **capture-reluctance guard** (`CAPTURE_LANGUAGE` `994`, guard `1020`). **Fallback:** `fallbackJumpSimulation` (`1142`). Timeout: unbounded unless the "Limit AI generation" map setting is on (then 5 min); `signal` aborts cleanly.
- **Applied by:** `applySimulationResult` (`1305`) — appends events, bumps round/date, resolves planned actions, applies impacts, opens generated chats, writes a `simulationHistory` entry, snapshots for rollback.

### 7.2 `autoJumpForward` — auto skip to the next notable event
- **Purpose:** Same engine, but **stop early** at the first strategically notable / player-relevant / catalyst-worthy event and set it `notable:true`.
- **Prompt:** `tasks.autoJumpForward`. **Entry:** `simulateAutoJump({days=365, signal})` → `simulateTimelineJump(mode:"auto")` `gameplay.js`.
- **Tool/schema:** `submit_jump_result` / `AUTO_JUMP_FORWARD_SCHEMA` (= `JUMP_FORWARD_SCHEMA`, `gameplaySchemas.js`).
- **Validation:** same validator; in `auto` mode `stopDate` may be any date after origin and ≤ target (`validateTimelineDates` `153`); the event-count range is not strictly enforced.

### 7.3 `actions` — strategic action suggestions
- **Purpose:** Produce 6–9 "Topics of Concern," each with 2–5 concrete actions (kind `action`, or `chat` for outreach).
- **Prompt:** `tasks.actions`. **Entry:** `generateActionSuggestions({force})` `gameplay.js`.
- **Tool/schema:** `submit_actions` / `ACTIONS_SCHEMA` (`gameplaySchemas.js`): `topics[] { title, description, actions[] { title, text, kind, invitees, chatStarter } }`.
- **Validation/fallback:** accepts array/`topics`/`suggestions` shapes; empty → `fallbackActionSuggestions` (`678`, from `DEFAULT_SUGGESTION_TOPICS`). Result stored on `world.actionSuggestions`.

### 7.4 `descriptionToAction` — freeform text → structured command
- **Purpose:** Turn the player's raw sentence into one action (or a chat invitation), ~50% longer, tone-matched, ≤650 chars.
- **Prompt:** `tasks.descriptionToAction`. **Entry:** `refinePlayerAction(rawInput, {persist})` `gameplay.js` (passes `actionInput`).
- **Tool/schema:** `submit_description_to_action` / `DESCRIPTION_TO_ACTION_SCHEMA` (`483`): `{ title, text, kind, invitees[], chatStarter }`.
- **Fallback:** `fallbackDescriptionToAction` (`708`) — heuristic chat detection via `CHAT_HINT_PATTERNS` (`46`) and `inferInviteeNames`.

### 7.5 `nextSpeaker` — pick the next diplomat
- **Purpose:** Choose which participant speaks next in an open chat (never the last speaker).
- **Prompt:** `tasks.nextSpeaker`. **Entry:** `chooseNextDiplomaticSpeaker({chat, excludeSpeaker})` `gameplay.js`.
- **Tool/schema:** `submit_next_speaker` / `NEXT_SPEAKER_SCHEMA` (`497`): `{ nextSpeaker }`.
- **Fallback:** `fallbackNextSpeaker` (`740`) — mentioned polity, else first non-excluded participant. (The chosen polity's actual reply is generated by the **leader** root prompt, §7.14.)

### 7.6 `eventConsolidator` — compress history
- **Purpose:** Fold a batch of events + closed chats into one continuity summary (~≤360 words) so old detail leaves the context window without losing map/diplomacy facts.
- **Prompt:** `tasks.eventConsolidator`. **Entries:** `consolidateHistoryBatch` (`535`, auto-run by `compactHistoryIfNeeded` `554` after jumps) and `consolidateRecentHistory({limit})` (`1662`).
- **Tool/schema:** `submit_event_consolidation` / `EVENT_CONSOLIDATOR_SCHEMA` (`507`): `{ summary }`.
- **Fallback:** concatenate raw event lines + `buildChatSummaryText`. Triggers: `CONSOLIDATION_*` thresholds (`gameplay.js`).

### 7.7 `catalystCreation` — open a branching scene
- **Purpose:** Design an immersive interactive "catalyst" scene with an opening and 2–5 choices.
- **Prompt:** `tasks.catalystCreation`. **Entry:** `createCatalyst({force})` `gameplay.js`.
- **Tool/schema:** `submit_catalyst_creation` / `CATALYST_CREATION_SCHEMA` (= `catalystSchema`, `gameplaySchemas.js`): `{ title, premise, opening, choices[2..5] }`. Written to `world.activeCatalyst`.

### 7.8 `catalystExecutor` — advance a scene
- **Purpose:** React to the player's chosen option, advance the scene, add to a progress bar, and offer next choices (or resolve).
- **Prompt:** `tasks.catalystExecutor` (uses `${catalystChoice}` and `${RUNNING_CATALYST_PERCENT}`). **Entry:** `advanceActiveCatalyst(choiceText)` `gameplay.js`.
- **Tool/schema:** `submit_catalyst_execution` / `CATALYST_EXECUTOR_SCHEMA` (`519`): `{ summary, resolved, nextChoices[] }`. Validator (`926`) enforces: empty `nextChoices` when resolved, ≥2 distinct otherwise.

### 7.9 `catalystSummary` — resolved scene → one event
- **Purpose:** When a catalyst resolves, condense it into a single campaign event.
- **Prompt:** `tasks.catalystSummary`. **Entry:** the resolution branch of `advanceActiveCatalyst` (`gameplay.js`), then `applySimulationResult` with `mode:"catalyst"`.
- **Tool/schema:** `submit_catalyst_summary` / `CATALYST_SUMMARY_SCHEMA` (`539`): `{ title, description, importance }`.
- ⚠️ **Caveat:** the default `catalystSummary` string contains a large stray **"Game Master" / "Master Cheat Assistant"** block pasted mid-prompt (legacy content). The task still returns the `{title,description,importance}` shape; the real GM task is the separate `gameMaster` key (§7.11). If you rewrite this prompt, delete the embedded GM text.

### 7.10 `pregameHistory` — backstory generator
- **Purpose:** On the first open of a fresh game with a "World Before Round One" briefing, write 4–10 dated events **strictly before** the start date. Runs once (the `simulationHistory` entry doubles as the done-marker); events carry **no impacts** (world already reflects them); clock stays at start, round stays 1.
- **Prompt:** `tasks.pregameHistory`. **Entry:** `maybeGeneratePregameHistory()` `gameplay.js`.
- **Tool/schema:** `submit_pregame_history` / `PREGAME_HISTORY_SCHEMA` (`448`): `{ events[1..12] { date,title,description,importance,kind }, summary }` — note the impact-free `pregameEventSchema` (`434`).
- **Validation:** `validatePregameEvents` (`2013`) — strict/salvage: all dates before start, chronological; non-Gregorian scenarios skip date checks. No fallback (silent null on failure).

### 7.11 `gameMaster` — direct map/state cheat
- **Purpose:** Apply an explicit player/GM request to the map/world; never argue or refuse.
- **Prompt:** `tasks.gameMaster`. **Entry:** `applyGameMasterCommand(requestText)` `gameplay.js` (passes `gameMasterRequest`).
- **Tool/schema:** `submit_game_master` / `GAME_MASTER_SCHEMA` (`551`): `{ summary, impacts { regionTransfers, polityChanges, markerOps } }`.
- **Validation:** `validateGeneratedWorldChanges` (strict on attempt 1). **Fallback:** empty impacts + neutral summary. Wrapped as a "Game master intervention" event.

### 7.12 `countryStatSheet` — structured national stats
- **Purpose:** Compile a full stat sheet for a selected polity for the Stats tab.
- **Prompt:** `tasks.countryStatSheet`. **Entry:** `generateCountryStatSheet({code, name})` `gameplay.js` (userMessage carries a `buildTargetDossier` (`1498`) + era slice).
- **Tool/schema:** `submit_country_stat_sheet` / `COUNTRY_STAT_SHEET_SCHEMA` (`569`): `capital, continent, government, leader, stability(0–100), indices{sovereignty,foodAutonomy,energyAutonomy,economicIndependence,internalSecurity,internationalReputation}, economy{gdp,gdpGrowth,gdpPerCapita,currency,inflation,unemployment,publicDebt,budgetBalance}, gdpBreakdown{agriculture,industry,services}`.
- **Validation:** all strings non-blank; all indices 0–100 integers; `agriculture+industry+services === 100` (`gameplaySchemas.js`). No fallback.

### 7.13 `idleDiplomacy` — unprompted note drip
- **Purpose:** Between jumps, on each real-minute tick, a small chance a single polity sends the player a short note; usually the answer is silence (`chat: null`).
- **Prompt:** `tasks.idleDiplomacy` — the between-rounds **world pulse**, which returns an optional chat, up to two `unitOps`, and an optional `sighting` (one short intel event). **Entry:** `maybeSendIdleDiplomacy({chance})` (aliased `maybeRunIdlePulse`); suspended by the simulation busy-lock. Two rates off one roll: `IDLE_PULSE_CHANCE` (1/4) decides whether the call runs at all, `IDLE_DIPLOMACY_CHANCE` (1/8) whether a chat is allowed, so the chat cadence is unchanged while the map moves twice as often. A pulse gets no travel budget (`fromDate === toDate`), so it can re-posture, re-order and drift patrols but never march anything. The task key stays `idleDiplomacy` on purpose — renaming it would orphan every game's frozen prompt pack and every scenario's stored `prompts.json` under a key nothing reads.
- **Tool/schema:** `submit_idle_diplomacy` / `IDLE_DIPLOMACY_SCHEMA` (`468`): `{ chat: null | createdChat }`. No editor section; no canned fallback (silent). A note from a country the player already 1:1s with lands in that thread.

### 7.17 `projects` — the Projects & Operations board

- **Purpose:** move the board to match the events a jump has just produced. Bookkeeping, not authorship: it records what the story did to each running effort.
- **Prompt:** `tasks.projects`. **Entry:** `generateProjectOps`, run by `simulateTimelineJump` after the segments merge and before anything is written.
- **Inputs:** the board (`${projectsSummary}`) and the merged events, numbered, in the user message. Deliberately nothing else — no world summary, no city coordinates, no unit list, no chat history. ~20 KB against the jump's ~500 KB.
- **Tool/schema:** `submit_project_ops` / `PROJECTS_SCHEMA`: `{ projectOps[] }`, each carrying `eventIndex` so the op can be attached back onto the event that caused it.
- **No fallback.** An empty board is what a failed call should leave behind, and `runJsonTask` throwing is what lets the caller hold the turn and offer a retry rather than pretending the board moved.

Unlike every other task, **all of its rules live in the template** rather than being injected at call time — a new task key reaches every save through `PROMPT_TASK_DEFAULTS`, so there is no frozen-prompt problem to work around (§2).

### 7.14 Root prompt: `leader` — AI diplomacy
- **Purpose:** Roleplay a single non-player polity replying in an ongoing chat; hard rule to **match the player's average message length** and tone; simulate a polity leaving.
- **Prompt:** top-level `leader` string. **Assembly:** `buildDiplomaticSystemPrompt(countries, playerCountry)` (`main.jsx`, `+difficultyDirective`) then `sendDiplomaticMessage(playerMessage, speakingAs, countries)` (`1138`) adds the per-turn instruction + optional `REACTION:<emoji>`. Free-form text (no tool/schema). `${RESPONDING_POLITY_NAME}` selects the voiced polity.

### 7.15 Root prompt: `advisor` — chief advisor chat
- **Purpose:** In-character strategic advice, ≤3000 chars, may append a `chart`-fenced Chart.js block. **Assembly:** `buildAdvisorSystemPrompt` (`main.jsx`) + `sendMessage` (`1084`) with rolling `advisorHistory`; language directive only (no difficulty, no schema).

### 7.16 Not in the prompt pack: `generateCountryStats` — intel briefing
- **Purpose:** Free-text bulleted intelligence briefing on a polity. Builds its **own inline system prompt** (dossier + world snapshot + recent events) and calls `callAI` **directly** (no tool, no `runJsonTask`, so only the language directive is appended). Entry: `generateCountryStats({code, name})` `gameplay.js`. Distinct from `countryStatSheet` (§7.12).

---

## 8. Impacts / output-shape reference

Shared `impacts` object (`impactsSchema` `gameplaySchemas.js`) carried by jump/auto/gameMaster events. All entries are optional arrays; omit empties.

| Field | Entry shape | Resolution / notes |
|---|---|---|
| `regionTransfers` | `{ regionId, regionName?, fromCode?, toCode, note? }` | `regionId` may be a plain name; `resolveRegionTransfers` (`gameplay.js`) maps name→id (owner-disambiguated). Unresolved → strict corrective feedback (attempt 1) or dropped (final). Required whenever event text claims a capture (Map Truth guard). |
| `polityChanges` | `{ code, name?, color?, aliases?, reputation?(0–100), tags?, note? }` | `reputation` was recently added to the schema (`107`); without the schema entry, json-schema providers could never emit it. `tags` is the *complete* new trait list, not a delta. |
| `createdChats` | `{ countries[≥1], title, openingMessage, speaker }` | Initiating polity speaks first, never the player. `validateChatOpener` (`979`) requires title + opening. Built into a real chat by `buildGeneratedChat` (`762`). |
| `unitOps` | `spawn{unit{name,type∈enum,ownerCode,strength 1–100,composition,posture?,note?,lng,lat,regionId?}}` · `move{unitId,toLng,toLat,regionId?,posture?,note?}` · `strength{unitId,strength 0–100}` · `remove{unitId}` | `unitOpSchema`. Ops on unknown unit ids: strict error / salvage drop. `strength:0` or `remove` deletes the unit. A `move` is clamped to what the unit could travel in the elapsed time, leaving a standing order for the remainder; a `spawn` far from its owner's footprint is flagged `covert` rather than rejected (a far `garrison` becomes `infantry`). |
| `markerOps` | `build{marker{name,kind(free lowercase),ownerCode?,lng,lat,note?,foundedAt?}}` · `remove{name}` | `markerOpSchema` (`256`). Structures never move borders (no `regionTransfers`). |

Jump payloads also carry a top-level `diplomaticOutreach[]` (same shape as `createdChats`, not tied to an event) and a nullable `catalyst`. The schema validator (`validateGameplayPayload` `852`) additionally enforces non-blank `stopDate`/event fields, "at least one event, summary, or meaningful catalyst," and distinct catalyst choices.

---

## 9. Recipes

### Add a new template variable
1. **Compute it** in `buildPromptContext`'s return object (`promptContext.js`) — e.g. `myThing: buildMyThing(bundle.world)`. Add a builder next to the others if non-trivial. (If it needs reputation/feasibility-style augmentation only for tasks, add it in `buildTemplateVariables` `gameplay.js` instead — but remember advisor/leader won't see those.)
2. **Expose a placeholder** in `defaultPrompts.json` `helpers`: `"MY_THING": "${myThing}"`.
3. **Reference it** in the task/root text as `${MY_THING}` (or the lowercase `${myThing}` directly).
4. **(Optional) editor:** add `MY_THING` to the relevant section's `helpers` list in `PROMPT_SECTION_DEFINITIONS` (`gameplayPrompts.js`) so it shows in the Prompts editor hints.
5. Nothing else — `renderTemplate` picks up any key present in the merged `{...variables, ...helperValues}` map.

### Add a new task
1. **Schema + tool:** define `MY_TASK_SCHEMA` and `MY_TASK_TOOL = makeTool("submit_my_task", …)` in `gameplaySchemas.js`; register both in `GAMEPLAY_SCHEMAS` (`621`) and `GAMEPLAY_TOOLS` (`717`) under the new key; add any task-specific checks to `validateGameplayPayload` (`852`).
2. **Prompt text:** add `tasks.myTask` to `defaultPrompts.json` ending with the JSON output contract. It is auto-picked-up: `PROMPT_TASK_KEYS = Object.keys(tasks)` and `normalizePromptPack` iterate it (`gameplayPrompts.js`, `246`).
3. **Entry point:** in `gameplay.js`, build variables (`buildTemplateVariables(bundle, {…})`) and call `runJsonTask("myTask", { userMessage, variables, fallback?, validatePayload?, timeoutMs? })`. Wrap state-writing tasks in `beginSimulation()/endSimulation()`.
4. **Call-time directives:** if the rule must apply to existing games, add the task key to the relevant `if ([...].includes(taskKey))` blocks in `runJsonTask` (`gameplay.js`/`425`) rather than only in the JSON (frozen-prompt caveat, §2).
5. **(Optional) editor:** add a `PROMPT_SECTION_DEFINITIONS` entry (`type:"task"`) so it is user-editable per scenario.

---

## 10. Gotchas

- **`worldSummary` and `worldSummaryNoCity` are the same string** — the "no city" name is historical; city coordinates are a separate `citiesSummary`/`${CITY_COORDINATES}`.
- **Two output attempts per task**, then a deterministic fallback (or throw). `finalAttempt` comes from `runJsonTask`, never from counting validator calls — attempt-1 schema failures skip `validatePayload` entirely (`gameplay.js` comment).
- **Reputation and military-feasibility reach only the task path** (`buildTemplateVariables`). Advisor/leader use `buildPromptContext` directly and never see them.
- **`catalystSummary` contains stray embedded "Game Master" text** (§7.9) — the actual GM task is `gameMaster`.
- **`idleDiplomacy` and the intel `generateCountryStats` briefing are invisible to the Prompts editor** — the former has no `PROMPT_SECTION_DEFINITIONS` entry; the latter is an inline prompt not in `defaultPrompts.json`.
- **Editing `defaultPrompts.json` does not retroactively change existing campaigns** — they carry frozen prompt copies; use call-time appends for universal rules.
