# Prompt-Making Guide

Every LLM call the game makes is a template in `src/Game/AI/defaultPrompts.json` filled with runtime game state, then hardened by call-time directives, then validated against a JSON Schema tool. This page is the single reference for anyone editing prompts: it enumerates every `${PLACEHOLDER}`, every template variable and where it is computed, every AI task and its output schema, exactly how a final prompt is assembled, how a scenario or game edits the guidance inside them, and how to add a new variable or task. When in doubt, the code paths are all in `src/Game/AI/` and `src/runtime/`.

---

## 1. File map — where everything lives

| Concern | File | Notes |
|---|---|---|
| Task + root prompt text; `${PLACEHOLDER}`→`${var}` helper map | `src/Game/AI/defaultPrompts.json` | Built-in defaults, bundled with the app |
| Prompt-pack composition, editor section list, task-key list | `src/Game/AI/gameplayPrompts.js` | `normalizePromptPack`, `serializePromptPack`, `PROMPT_SECTION_DEFINITIONS`, `PROMPT_EDITOR_SECTIONS`, `PROMPT_GUIDANCE_DEFAULTS` |
| The editable guidance passages inside each prompt: anchors, composition, pack normalisation | `src/Game/AI/promptGuidance.js` | `PROMPT_GUIDANCE`, `composePrompt`, `normalizePackGuidance`; pinned by `promptGuidance.test.js` |
| Context builders (world summary, histories, units, cities) | `src/Game/AI/promptContext.js` | `buildPromptContext`, `buildWorldSummary`, `renderTemplate`, `resolveHelperValues` |
| Task runner, call-time directives, validators, fallbacks, task entry points | `src/Game/AI/gameplay.js` | `runJsonTask`, `buildTemplateVariables`, `simulateTimelineJump`, etc. |
| JSON Schemas + tools + payload validator | `src/Game/AI/gameplaySchemas.js` | `GAMEPLAY_SCHEMAS`, `GAMEPLAY_TOOLS`, `validateGameplayPayload` |
| Provider dispatch, `callAI`, advisor/leader assembly | `src/Game/AI/main.jsx` | `callAI`, `buildAdvisorSystemPrompt`, `buildDiplomaticSystemPrompt` |
| Language directive (appended to *every* call) | `src/runtime/i18n.js` | `languageDirective` at line 137 |
| Difficulty directive (appended to task + leader prompts) | `src/runtime/difficulty.js` | `difficultyDirective` at line 73 |
| Where the active game's prompt overrides are read from | `src/runtime/assets.js` | `JSON_URLS.prompts = /api/runtime/json/prompts` |
| Per-scenario / per-game prompt editor UI ("Prompts" tab) | `src/Game/GameUI/libraryBar.jsx` | `PromptSectionEditor`, `handlePromptChange`, `serializePromptPack` on save |

See [World state](world-state.md) for the `world.json` shapes (`regionOwnershipOverrides`, `polityOverrides`, `units`, `markers`, `activeInteractive`, `consolidatedHistory`, `simulationHistory`) that the context builders read.

---

## 2. The three prompt "kinds" and how they are stored

`defaultPrompts.json` has exactly three top-level buckets:

| Kind | JSON key | Contains | Rendered by |
|---|---|---|---|
| Root: **advisor** | `advisor` (string) | Chief-advisor side-panel chat | `buildAdvisorSystemPrompt` (`main.jsx`) |
| Root: **leader** | `leader` (string) | AI diplomacy — polities replying in a chat | `buildDiplomaticSystemPrompt` (`main.jsx`) |
| **tasks** | `tasks.<key>` (strings) | 13 structured JSON tasks (below) | `runJsonTask` (`gameplay.js`) |
| Helper map | `helpers` (object) | `${PLACEHOLDER}` → `${templateVar}` indirection | `resolveHelperValues` (`promptContext.js`) |

### Storage model: guidance only (since 2026-09-16)

Every prompt is a fixed **technical template** — the placeholders that inject the world, the output contracts, the map rules — with a few passages of **guidance** inside it: the role, the tone, what to simulate and how much, what makes a good event. Only the guidance is stored and editable.

- `src/Game/AI/promptGuidance.js` declares the passages: per section (`advisor`, `leader`, or a task key) an ordered list of segments `{ id, label, start, end, hint }`, each located in the default text by a `start` and an `end` anchor copied verbatim from `defaultPrompts.json`. Anchors must be unique and in order (`promptGuidance.test.js` checks every one, that no passage carries a code block or a JSON contract, and that an unedited pack renders the shipped text byte for byte). A prompt with no entry has no guidance and never appears in the editor — the curator, the directors, the resolver, the stat sheet, the spy desks, the board and the next-speaker pick are technical end to end.
- A stored pack (`details.data.prompts`, served to the active game at `JSON_URLS.prompts` = `/api/runtime/json/prompts` and read by `loadPromptCatalog` in `gameplay.js` and `ensurePromptsLoaded` in `main.jsx`) is `{ "promptModel": 2, "guidance": { "advisor": { segmentId: text }, "leader": {…}, "tasks": { "jumpForward": {…}, … } } }` — the author's edits alone, trimmed, with blank and default-identical passages dropped (`normalizePackGuidance`). Nothing else is ever written.
- `normalizePromptPack` (`gameplayPrompts.js`) composes the runtime pack at load time: for every section it takes the **current** default text and replaces each edited segment's default passage with the author's text (`composePrompt`), then hands back the same `{ advisor, leader, helpers, tasks }` the renderers always used, plus `promptModel` and `guidance` for the editor. Helpers are always the defaults. Composition happens before rendering, so a `${PLAYER_POLITY}` inside an author's passage fills in like any other.
- **A pack in the old shape — whole prompt strings — is ignored.** Those packs froze the technical text at the time of the save; every scenario and game that has one now runs the current defaults (with no guidance edits, since the old model kept none apart). The built-in seed ships `{ "promptModel": 2, "guidance": {} }`, and `scripts/presets/build-preset.mjs` writes the same for a preset.
- **When the defaults change** (a release edits `defaultPrompts.json`): every scenario and game composes the new text on its next load. A passage the author edited keeps the author's text — edits are keyed by segment id, so a release that rewords a passage updates that segment's anchors in `promptGuidance.js` and the edit stays attached — and every passage they did not edit, plus all the technical text, follows the new default. A pack with no edits is always the current default in full (`promptGuidance.test.js`: "when the defaults change…").
- **A copied default is not an edit.** "Export all prompts" writes every passage (`materializePromptPack`), so a scenario that imported such a file (or a hub bundle made from one) stored the defaults of the version that wrote it as if its author had written them — and kept them after the game changed its defaults. `normalizePackGuidance` drops any stored passage identical, whitespace aside, to a default that any version has shipped, in English or in a shipped translation (`isShippedGuidanceDefault`): `src/Game/AI/shippedGuidance.js` holds their fingerprints (`guidanceFingerprint`, cyrb53), seeded on 2026-09-26 with every passage alpha, beta and main had shipped since packs became guidance-only and every translation of one. So a scenario like that, and every game played from it, runs the current defaults on its next load. The list only grows: after changing a default passage or a prompt pack, run `node scripts/prompts/record-shipped-guidance.mjs` (`promptGuidance.test.js` fails until you do). **Every branch must recognise every branch's defaults**, so a player on main whose scenario holds a copy of beta's or alpha's old defaults moves to main's current ones when that code is promoted: the list is one fingerprint per line and `.gitattributes` merges it with git's `union` driver, so merging alpha into beta or beta into main keeps both sides' entries; after such a merge run `node scripts/prompts/record-shipped-guidance.mjs --history`, which reads every version of the defaults and of the prompt packs in alpha's, beta's and main's histories (as `origin/<branch>`) and adds whatever the merged list lacks. Only stored packs are read this way — `composePrompt` takes the translated defaults as passages — and a passage its author changed by even a word stays theirs.
- `PROMPT_SECTION_DEFINITIONS` still lists every section with its `label`, `type` (`root` | `task`) and description (its `helpers` lists are documentation of what a section may render, nothing more); `PROMPT_EDITOR_SECTIONS` is the subset with guidance, and it is what the Prompts tab shows — one textarea per passage, "Reset to default" per passage and per section.

### The frozen-prompt era, and the call-time directives it left behind

Before the guidance model a save carried a **frozen copy** of every prompt, so an edit to `defaultPrompts.json` never reached an existing campaign. That is why rules were **appended at call time in `runJsonTask`** (§6). The reason is gone — a rule written into `defaultPrompts.json` now reaches every scenario and game the next time it loads its prompts — and the time skip no longer appends any (§6a): its rules are in its template and its live records are rendered into it. New rules belong in the template; a call-time block is only for text that depends on runtime state.

---

## 3. How a final prompt is assembled, end to end

### 3a. Task path (`runJsonTask`, `gameplay.js`)

Order of concatenation onto the system prompt:

1. **Load pack** — `loadPromptCatalog` → `normalizePromptPack(readJson(JSON_URLS.prompts))` (the current defaults with the pack's guidance edits composed in, §2).
2. **Resolve helpers** — `helperValues = resolveHelperValues(prompts.helpers, variables)` (`promptContext.js`). Two passes so a helper that references another helper resolves.
3. **Render task text** — `systemPrompt = renderTemplate(prompts.tasks[taskKey], {...variables,...helperValues })` (`gameplay.js`). `renderTemplate` (`promptContext.js`) replaces `${key}` with `variables[key]` (missing/`null` → empty string). Both uppercase `${PLACEHOLDER}` keys (from `helperValues`) and lowercase `${var}` keys (from `variables`) are in scope.
4. **+ Difficulty directive** — `\n\n${difficultyDirective(game.difficulty)}` for every task (`gameplay.js`).
5. **Time skips** render their live records into the template (`${JUMP_LIVE_STATE}`, §6a) instead of steps 4 and 6: nothing is appended after a jump's template.
6. **+ International Reputation** — only `actions`, `interactiveCreation`, `interactiveExecutor` (`gameplay.js`).
7. **Call `callAI(systemPrompt, [{role:"user", parts:[{text: userMessage}]}], { tool, maxTokens: 8192,... })`.** Inside `callAI` (`main.jsx`): **+ Language directive** `\n\n${languageDirective}` when the UI language ≠ English.
8. **Provider layer** (`main.jsx`): native tool-use providers (Anthropic/OpenAI/Gemini) pass `tool.schema` as a tool; the JSON-schema fallback path appends `\n\nReturn only one JSON object matching this JSON Schema…\n${JSON.stringify(tool.schema)}` (`main.jsx`). `maxTokens` is floored at 8192 by capped providers; Gemini ignores it.

So the final task system prompt is:

```
<rendered task text>
\n\n<difficulty directive>
(a time skip: its template, with the live records inside it at ${JUMP_LIVE_STATE}, and nothing after it)
[\n\n[International Reputation]…] (5 tasks only)
\n\n<language directive> (non-English only)
[\n\n Return only one JSON object … <schema>] (json-schema fallback providers only)
```

**The user message, for a jump.** `runJumpSegments` builds it as `[<application receipt>, <changes made outside the simulation>, <political decision context>, buildSegmentInstruction(…), <scripted beats>, WRITING_REMINDER]`, joined by a blank line, each empty part left out, so the request ends on how an event is written. The receipt is `[APPLICATION RESULT FROM YOUR LAST TURN]` (`runtime/applicationReceipt.js`): what the engine dropped, withheld or changed in the previous turn's answer, plus what it applied. The second block is `[CHANGES MADE OUTSIDE THE SIMULATION SINCE YOUR LAST TURN]` (`runtime/gmChanges.js`): every change the Game Master made by hand in the round this skip starts from — told once, because the round moves on when the skip lands, and again after a rollback. Both go in the **user** message, not the system prompt, so the cacheable static prefix is untouched; both are repeated on every segment, because each segment is a separate request. See [AI overview](ai-overview.md#the-application-receipt-what-salvage-did-told-to-the-next-turn) and [the Game Master's hand](ai-overview.md#the-game-masters-hand-changes-made-outside-the-simulation-and-standing-reminders).

Retry (`gameplay.js`): each task gets **two output attempts**. On attempt-1 failure the model's raw answer plus a corrective user turn are appended to `history`, and attempt 2 runs against the same system prompt. `validatePayload` receives `{ attempt, finalAttempt }`; `finalAttempt` (attempt 2) switches validators from *strict* (return a corrective string) to *salvage* (repair in place). If both attempts fail, the deterministic `fallback` runs (or, for tasks with no fallback, it throws). A user `signal` abort propagates and cancels rather than falling back.

### 3b. Advisor / leader path (`main.jsx`)

These do **not** go through `runJsonTask` or `buildTemplateVariables`; they build variables directly from `buildPromptContext` (`buildPromptVariables`, `main.jsx`, with `eventLimit: 16`).

- **Advisor** (`buildAdvisorSystemPrompt`, `main.jsx`): `renderTemplate(promptPack.advisor, {...variables,...helperValues })` → `callAI` (language directive only). No difficulty, no schema (free-form text reply). Called by `sendMessage` (`main.jsx`) with a rolling `advisorHistory`.
- **Leader** (`buildDiplomaticSystemPrompt`, `main.jsx`): `renderTemplate(promptPack.leader, …)` **+ `\n\n${difficultyDirective}`** (`main.jsx`). Then `sendDiplomaticMessage` (`main.jsx`) appends a per-turn user instruction telling the model to speak as one specific polity and optionally emit a trailing `REACTION:<emoji>` line (`main.jsx`), which `parseReaction` strips. `callAI` adds the language directive.

Because the advisor/leader path skips `buildTemplateVariables`, `playerPolityReputationContext` is empty and the military-feasibility doctrine (§5) is **not** appended to their unit text.

**The conversation is sent once, as the turns.** `ALL_ADVISOR_MESSAGES` (advisor) and `THIS_CHAT_HISTORY` (leader) used to render the transcript into the system prompt as well as sending it as the message turns — the same conversation twice, and, because it sat near the end of the system prompt, everything after it changed with every message, so no provider's prefix cache could reuse it. Both variables now render `CONVERSATION_IN_TURNS` (`main.jsx`), a pointer the templates' own sentences read naturally around, and a leader's own thread is also left out of the digest of its other chats (`buildDiplomaticSystemPrompt(…, { chatId })`). Measured on the Fault Lines save (`.lab/probes/conversation-anatomy.mjs`): an advisor message 124.4 K → 103.7 K characters with its system prompt identical from one message to the next (was 59%); a leader 70.2 K → 67.3 K, 100% (was 88%). Checked live: an advisor still recalls a code word from three exchanges back. The group-chat batch (`runChatActionBatch`) always sent its thread once.

**A player's message can carry a catch-up note** (`AI/conversationCatchUp.js`): written by the advisor panel when the world moved on since the last exchange — what became of the advisor's last reply (a chart not drawn, a block that half landed), the time that passed and the newest events since, and the Game Master's changes by hand. It rides ahead of what the player typed, is stored on the message, and is sent with it again after a reload (`loadHistory`).

**A leader's thread carries one too** (`buildThreadCatchUp`): the chat panel writes it onto the player's line when the world moved on since the thread's last dated line — the span, the newest events on the public record since, the borders they moved and the polities they renamed, founded or dissolved, and in a group the votes cast since the player's last turn. It rides ahead of the player's words (`withCatchUp`) in `sendDiplomaticMessage({ catchUp })` and in the group batch's user message (`runChatActionBatch({ catchUp })`), and is stored on the message (`catchUp`, `catchUpLabel`) so a reload or a retry sends the same words.

**Both get the Game Master's reminders** (`renderReminders`, `runtime/gmChanges.js`): the advisor among its directives before the formatting rules, a leader after its intelligence block.

**Only the advisor gets the player's standing goal** (`runtime/playerGoal.js`): `[Our Standing Goal]`, after the documents and before the reminders — the government's aim, to weigh advice by and to say plainly when an order works against it. A leader is never told it.

**Both read the documents file** (`world.reports`), bounded to eight, each body cut to 220 characters: the advisor `[Documents Our Government Holds]` — every paper the player's government can read, saying how it came by each (held with whom, ours alone, published, or a copy its agents took, which the holders do not know it has; `describeDocumentsForAdvisor`, `runtime/reportDelivery.js`); a leader `[Documents Your Government Holds]` — its own and the published ones, by the audience rule, never who stole a copy.

---

## 4. Placeholder → variable helper map

`defaultPrompts.json` → `helpers`. Task/root text uses the uppercase `${PLACEHOLDER}`; the helper maps it to a lowercase `${var}` computed in `buildPromptContext`. "Used by" lists the prompts whose **default text** actually contains the placeholder.

| `${PLACEHOLDER}` | → template var | Inserts | Used by (default text) |
|---|---|---|---|
| `PLAYER_POLITY` | `playerPolity` | Player polity name (`game.country`) | nearly all |
| `PLAYER_POLITY_REGIONS` | `playerPolityRegions` | Comma list of regions the player owns, or the LANDLESS notice | advisor |
| `PLAYER_POLITY_BATTALION_SUMMARIES` | `playerBattalionSummaries` | Player + world unit lines (no feasibility doctrine) | advisor |
| `PLAYER_POLITY_REPUTATION_CONTEXT` | `playerPolityReputationContext` | "International reputation: N/100 (band)." | *(none — injected via the [International Reputation] directive, not the placeholder)* |
| `PLAYER_ACTIONS_THIS_ROUND` | `plannedActions` | Planned (unresolved) actions | advisor, actions, jumpForward, autoJumpForward, interactiveCreation, gameMaster, descriptionToAction |
| `PLAYER_EVERY_ACTION` / `PLAYER_EVERY_ACTION_NOT_PREVIOUS` | `allActions` | All actions incl. resolved | advisor, jumpForward, autoJumpForward |
| `GRAND_MAP_DESCRIPTION` | `worldSummary` | Full world snapshot (see §5 `worldSummary`) | advisor, countryStatSheet |
| `GRAND_MAP_DESCRIPTION_NO_CITY` | `worldSummaryNoCity` | **Identical string** to `worldSummary` (name is historical) | leader, actions, jumpForward, autoJumpForward, descriptionToAction, gameMaster, pregameHistory |
| `CURRENT_UNITS` | `unitsSummary` | Deployed units **+ conditional military-feasibility doctrine** | jumpForward, autoJumpForward |
| `CURRENT_MAP_STRUCTURES` | `markersSummary` | `world.markers` structures with coords | jumpForward, autoJumpForward |
| `CITY_COORDINATES` | `citiesSummary` | City coordinate catalog (custom era set or stock significant slice) | jumpForward, autoJumpForward |
| `NUMBER_OF_REGIONS` | `numberOfRegions` | Count of regions in the map catalog | jumpForward, autoJumpForward, gameMaster |
| `WORLD_BEFORE_ROUND_ONE_TEXT` | `worldBeforeRoundOne` | Scenario "World Before Round One" briefing | advisor, leader, actions, jumpForward, autoJumpForward, interactive×3, descriptionToAction, gameMaster, pregameHistory |
| `HISTORICAL_PRESET_SIMULATION_RULES` | `simulationRules` | Scenario simulation rules | advisor, leader, countryStatSheet, actions, jump×2, interactive×3, descriptionToAction, gameMaster, pregameHistory |
| `ALL_EVENTS_WITH_CONSOLIDATION` | `recentEventsLong` | STORY SO FAR (consolidated) + RECENT EVENTS | leader, advisor, actions, jumpForward, autoJumpForward, interactiveCreation, interactiveExecutor |
| `CONSOLIDATED_HISTORY` | `consolidatedHistory` | Just the consolidated "STORY SO FAR" | *(declared in editor sections; not in current default text)* |
| `PREVIOUS_ROUND_EVENTS` | `recentEvents` | Recent unconsolidated events (short window) | countryStatSheet, interactiveCreation |
| `NON_CONSOLIDATED_ROUNDS_WITH_DATES` | `worldInitiativeContext` | The native world director's live analysis for the jump segment: focused and deferred storylines, the exploration slate, the era's conflict posture, economic and diplomatic attention, the storyline record contract | `runJumpSegments` (`buildWorldInitiativeContextBackground`, worker) |
| `canonicalStorylineContext` | `world.storylines` for the GM prompt: id, status, pressure, momentum, title, participants, state (≤24) | `buildGameMasterStorylineContext` |
| `recentRoundsWithDates` | `from → to` date pairs from `simulationHistory` | advisor, leader, actions, jumpForward, autoJumpForward |
| `CHATS_NON_CONSOLIDATED_ROUNDS` | `chatHistoryLong` | Detailed multi-chat transcript | advisor, leader, actions, jumpForward, autoJumpForward |
| `CHAT_PARTICIPANTS` | `chatParticipants` | Names of the current chat's participants | leader, chatActions |
| `THIS_CHAT_HISTORY` | `chatHistory` | The current chat's message lines — for the leader, `CONVERSATION_IN_TURNS` instead: the thread rides as the turns (§3b) | leader, chatActions |
| `RESPONDING_POLITY_NAME` | `respondingPolityName` | Which polity the leader model should voice | leader |
| `ALL_ADVISOR_MESSAGES` | `advisorMessages` | `CONVERSATION_IN_TURNS`: the transcript rides as the turns, once (§3b) | advisor |
| `ORIGIN_ROUND_DATE` | `date` | Current game date (`game.gameDate`, raw ISO/text) | leader, countryStatSheet, eventConsolidator, gameMaster, descriptionToAction |
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
| `RUNNING_INTERACTIVE_DATE` | `interactiveDate` | Interactive event date (= current date) | interactiveCreation, interactiveExecutor, interactiveSummary |
| `RUNNING_INTERACTIVE_PERCENT` | `interactivePercent` | Interactive event progress %, `min(100, history.length*50)` | interactiveExecutor |
| `INTERACTIVE_PREMISE_DESCRIPTION` | `interactivePremise` | The interactive event's premise text | interactiveExecutor, interactiveSummary |
| `INTERACTIVE_SIMULATION_HISTORY` | `interactiveHistory` | Choice→summary log so far | interactiveExecutor, interactiveSummary |

Lowercase variables referenced **directly** by task text (no helper alias): `${language}` (all tasks), and in `idleDiplomacy` — `${playerPolity}`, `${dateReadable}`, `${worldSummary}`, `${recentEvents}`, `${chatSummary}`; in `interactiveExecutor` — `${interactiveChoice}`.

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
| `worldSummary` | Multi-section snapshot: player line + tags, round, date, language, difficulty, world-before-round-one, simulation rules, up-to-24 territorial overrides, up-to-16 polity overrides (incl. `note` lore), up-to-40 country tag lines, the interactive event in progress | `buildWorldSummary` `promptContext.js` |
| `worldSummaryNoCity` | **Identical** to `worldSummary` | `promptContext.js` |
| `citiesSummary` | City coordinate lines: custom-city scenarios use the era geojson (tier/pop sorted, ≤200); otherwise the stock significant slice (capitals + pop ≥ 2M, cached) | `buildCityCatalogText` `promptContext.js` |
| `markersSummary` | `world.markers` structures (≤60) with kind/owner/coords/note | `buildMarkersSummaryText` `promptContext.js` |
| `numberOfRegions` | `String(regionCatalog.length)` | `promptContext.js` |
| `recentEvents` | Unconsolidated event history, `eventLimit` window (10 default; 16 on advisor/leader path) | `buildEventHistoryText` `promptContext.js` |
| `recentEventsLong` | `buildCampaignHistoryText`: "STORY SO FAR" (consolidated) + "RECENT EVENTS" (≤`longEventLimit`, 24) | `promptContext.js` / builder `95` |
| `consolidatedHistory` | `buildConsolidatedHistoryText(world)` — the `consolidatedHistory[]` summaries | `promptContext.js` / builder `86` |
| `recentRoundsWithDates` | `from → to` date pairs from `world.simulationHistory` (≤8) | `buildRecentRoundsWithDates` `promptContext.js` |
| `chatHistory` | Current chat's `speaker: text` lines, or "No chat history." | `promptContext.js` |
| `chatHistoryLong` | `buildDetailedChatHistoryText(unconsolidatedChats, {limit: chatLimit})` | `promptContext.js` / builder `114` |
| `chatSummary` | One-line-per-chat last-message summary | `buildChatSummaryText` `promptContext.js` / builder `103` |
| `chatParticipants` | Current chat's participant names, comma-joined | `promptContext.js` (overridden with a bulleted list in `buildDiplomaticSystemPrompt`, `main.jsx`, each name followed by `— what it is: …` when its record has a `role`, so a leader knows it is talking to a militia or a cartel) |
| `chatsToConsolidate` | Explicit batch, else detailed transcript (≤12 chats, ≤50 msgs) | `promptContext.js` |
| `chat` | `JSON.stringify(unconsolidatedChats)` | `promptContext.js` |
| `lastSpeaker` | Current chat's last speaker name | `promptContext.js` |
| `respondingPolityName` | Option override, else first non-player participant | `promptContext.js` |
| `advisorMessages` | `buildAdvisorHistoryText(bundle.advisor, {limit: advisorLimit=18})` | `promptContext.js` / builder `127` |
| `actions` | `formatActionsForPrompt(bundle.actions)` (title + display text) | `promptContext.js` / builder `156` |
| `plannedActions` | `buildActionHistoryText(bundle.actions)` (planned only) | `promptContext.js` / builder `140` |
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
| `interactiveDate` | `= date` | `promptContext.js` |
| `interactivePercent` | `min(100, activeInteractive.history.length*50)%`, else "0%" | `promptContext.js` |
| `interactivePremise` | `interactivePremise` option | `promptContext.js` |
| `interactiveHistory` | `interactiveHistory` option (choice→summary log) | `promptContext.js` |
| `interactiveChoice` | `interactiveChoice` option (the just-chosen option) | `promptContext.js` |
| `interactiveOpening` | `interactiveOpening` option | `promptContext.js` |

`buildPromptContext` accepts an options bag (`promptContext.js`): `actionInput`, `advisorLimit`, `interactiveChoice/History/Opening/Premise`, `chat`, `chatLimit`, `chatsToConsolidate`, `eventLimit`, `eventsToConsolidate`, `gameMasterRequest`, `longEventLimit`, `respondingPolityName`, `targetDate`. Each task's entry point passes the ones it needs (e.g. `simulateTimelineJump` passes `targetDate`; `advanceActiveInteractive` passes `interactiveChoice/History/Premise/Opening`).

---

### 5.1 Context envelope and demand-driven construction

The save remembers everything; a task is shown a bounded, deterministic slice of it (`promptContext.js` + `contextDiagnostics.js`):

- **Demand.** `buildTemplateVariables(bundle, { taskKey })` resolves which variables the ACTUAL loaded prompt pack can reach (the task text, the helpers it references, and the live directives `runJsonTask` appends for that task — `LIVE_RUNTIME_VARIABLE_KEYS` in `contextDiagnostics.js`) and passes them as `requiredKeys`; `buildPromptContext` then builds only those, so the region catalog, world summary, chats and border geometry are skipped when a task never renders them. A caller without a task key, or an unresolvable demand, gets the full build. `resolveHelperValues` renders only reachable helpers.
- **Budgets.** `buildEventHistoryText`, `buildDetailedChatHistoryText` and `buildConsolidatedHistoryText` accept `maxChars`; whole records are kept and every omission is declared in the text. Jumps run under the world-simulation envelope: 24k chars of consolidated history selected for **coverage** (newest continuity, the campaign foundation, evenly spread middle blocks), and once the full history exceeds 24k, up to 6k chars / 18 **permanent historical anchors** chosen from the consolidated past by provenance (critical events, the origin events of active wars, agreements and storylines, durable structural changes). Variables: `consolidatedHistory`, `historicalAnchors`, `historicalAttentionStatus`, and `recentEventsLong` (which embeds both).
- **Diplomatic memory.** A chat message may carry `memorySummary` (rolling durable memory of the thread); `diplomaticContinuity` renders the latest memory per thread with a short verbatim tail, and a jump's live records carry it as `[Diplomatic Memory]` only when at least one thread carries memory. `chatHistory` and `chatSummary` show the memory line too.
- **Marker attention.** `markersSummary` is a bounded, deterministic subset of world features (recently touched, under construction or damaged, named in recent events or chats, plus a rotating background sample), sized per task.
- **Diagnostics.** Set `globalThis.__OH_CONTEXT_DIAGNOSTICS__ = true` in DevTools: every structured request logs its demand, constructed-versus-required variables and sizes (`logContextDiagnostics`), and `buildTemplateVariables` logs its build time. Observational only.

## 6. Call-time appended directives

Concatenated onto the system prompt in `runJsonTask` / `callAI` **after** the template renders. They date from the frozen-prompt era (§2). A time skip gets none of them after its template: what it needs of them is in the template or in its live records (§6a).

| Directive | Applies to | Source |
|---|---|---|
| **Difficulty** — one of 6 blurbs steering success rates | every task (via `readGameData`); leader (via `buildDiplomaticSystemPrompt`) | `gameplay.js`, `main.jsx`; text in `difficulty.js` |
| **[The World's Share — counted by the engine]** and **[PRIORITY RULES — set by this scenario's author]** — the scenario author's world direction (`worldDirection.js` `buildWorldDirectionDirective`). A time skip carries it in its live records (§6a), before its output note and writing brief. | `jumpForward`, `autoJumpForward` |
| **[The Player's Standing Goal]** — what the player's government is steering toward (`describeGoalForSimulation`, `runtime/playerGoal.js`), as a guiding philosophy, not an order: the player's own ministers conduct the business the orders did not address in its spirit; it never creates an action the player did not order, never decides what Player Agency reserves for the player, never makes success likelier. Nothing while no goal is set | `worldMotionRepair`, `worldBreadthRepair`; a time skip has it in its live records | `playerGoalBlock` (`gameplay.js`) |
| **[REMINDERS FROM THE GAME MASTER]** — the GM's standing facts (`runtime/gmChanges.js` `renderReminders`), after the priority rules: a fact declared mid-game is newer than any rule written before it. Every task that writes the world or speaks for a polity (`GM_REMINDER_TASKS`); the turn review carries it once for the whole request, not once per job (`buildTaskSystemPrompt(…, { reminders: false })` per job). Nothing while there are none. | the skip, the review and its directors, `projects`, `gameMaster`, `actions`, `idleDiplomacy`, the interactive event tasks, `spyIntercept`, `chatActions` |
| **[Placing Things — say WHERE in words]** — every unit spawned or moved and every structure built may be placed with `at`, a phrase naming places the map knows; the engine finds the point, keeps it inside the right borders and moves it clear of anything already standing there; `lng`/`lat` only for a spot no name describes | `unitDirector`, `gameMaster`, `idleDiplomacy`, `interactiveExecutor` (a time skip's template has its own section) | `PLACEMENT_DIRECTIVE` in `placement.js`; resolved by `resolvePlacements` (`gameplay.js`) |
| **[GM Territorial Semantics — live override]** + **[GM Geographic Completeness]** + **[GM Physical-World Completeness]** — control vs sovereignty for the GM, one operation per narrated place, marker lifecycle audit | `gameMaster` | `gameplay.js` `runJsonTask` |
| **[International Reputation]** — how the world regards the player biases behavior; record changes via `polityChanges.reputation` (0–100) | `actions`, `interactiveCreation`, `interactiveExecutor` (a time skip has it in its live records) | `gameplay.js` |
| **Language** — write all human-readable text in the UI language; keep JSON keys/ISO codes/dates unchanged | every `callAI` call (advisor, leader, all tasks, intel briefing) when language ≠ `en` | `callAI` `main.jsx`; text `i18n.js` |
| **Military feasibility** — era-reach/unit-type/distance doctrine; folded into `${CURRENT_UNITS}` not appended separately | conditional: only when units exist or actions text matches the military regex | `buildMilitaryFeasibilityText` `gameplay.js`, injected `372` |
| **Leader turn instruction** — "speak only as `<polity>`… optionally append `REACTION:<emoji>`" (a user-role turn, not system) | leader only | `main.jsx` |

Difficulty text (`difficulty.js`): `very-easy`, `easy`, `medium` (default; `"standard"`/empty normalize to medium), `hard`, `very-hard`, `impossible`. `buildDifficultyGuidance` (`promptContext.js`) is a *separate* softer paragraph used inside the jump/chat prompt bodies via `DIFFICULTY_DESCRIPTION_*`.

---

### 6a. The time skip's prompt (since 2026-09-26)

A time skip (`jumpForward`, `autoJumpForward`) is its template and ONE block of live records rendered into it at `${JUMP_LIVE_STATE}` (helper → `jumpLiveState`, built by `buildJumpLiveState` in `gameplay.js` before the template renders). Nothing is appended after the template, so the template decides where everything sits and the prompt ends on how an event is written. Until 2026-09-26 the template was followed by some twenty rule blocks appended at call time (Player Agency, Map Truth, Why the Land Moves, Region and City Capture, Unit Coordinates, Units on the Map, Other Powers' Militaries, Sovereign Acts, the Counterfactual Knowledge Boundary, the World Director's doctrine, the Diplomatic Consequence Bridge, the 17,000-character Actions You Can Take…): a 30-day skip on the shipped 2014 save sent 186,630 characters, about 104,000 of them instructions. The same skip now sends about 106,000, most of it the world.

The template, in order:
1. **The brief** — what the game is; `[Your Role]`; `[Real History Is the Default]` (a game set in our history follows real history wherever the game has not changed things, and departs from it only where the game has; an alternate history from its divergence; a fictional world from its lore); `[Difficulty]`; `[Player Agency — critical]`; `[What an Order Can Do]` (every order gets an outcome and cites its id; consent, means, authority, the pace of a war); `[What to Simulate]` (the whole world, as many events as the period holds); `[The World Answers Back]` (the world moves first, both sides fight, the ban is on inventing a rivalry).
2. **How the world is recorded** — `[The Map]` (sovereignty = regionTransfers, control = regionControlOps, claims = regionClaims, the basis and what the engine does with it, place names the engine resolves), `[Polities]`, `[Placing Things — say WHERE in words]`, `[Units and Structures]`, `[Diplomacy]`, `[Reports — documents, not summaries]`.
3. **The scenario** — `[The World Before Round 1]`, `[What Is True Now]` (technical: the map and records outrank the game's events, which outrank real history and the briefing), `[Extra Simulation Rules for This Preset]`. Everything to here is the cacheable prefix.
4. **This game** — turns premise, event history, this round's orders, the map description, chats, units, structures, city coordinates.
5. **`${JUMP_LIVE_STATE}`** — `[This Game and Real History]` (`buildRealHistoryDirective`, `futureHistoryBoundary.js`: when the game began and, from Scenario Canon v2, whether and where this world split from ours), the difficulty's simulation directive, occupied and contested regions, `[What Is in Motion]` (the World Director's records — storylines due and their state, other open storylines, the pressures in the record, conflict risk, economic baselines, the diplomatic slice — and the storyline record format), `[Wars]` and `[Relations and Agreements]` (state, the hard rules and the `warUpdates` / `relationUpdates` / `agreementUpdates` / `puppetUpdates` line formats), `[Diplomatic Memory]`, standing and intelligence ratings, standing unit orders, the Projects board, the espionage brief, reports on file, a scenario's own stats sheet, `[Levers]` (the shapes the output function's field notes leave out), the player's standing goal and focus (their orders with the ids events cite), the scenario author's direction, the Game Master's reminders, the lookup directive.
6. **`[Output]`**, then **`[How to Write an Event]`** (guidance, id `quality`) — the title is the headline; the description is the article under it and tells the story (who acted, what they did, in what order, where, with what, what it cost, how it ended), never the headline restated; specifics; a minor event at least a full paragraph, a major one several; quotes; what counts as an event; an example from real history. No word cap and no voice rules.

The user message (`runJumpSegments`) is the application receipt, the Game Master's changes, the political decision context, the segment instruction (`buildSegmentInstruction`: the dates and the event range), the scripted beats, and last `WRITING_REMINDER` (`jumpSegments.js`).

Event ranges (`eventCountRangeForDays`): under a day 1-2, a week 3-6, a month 10-15, a quarter 16-22, half a year 22-30, longer 28-36; a segment of a split jump asks for its share of the whole jump's range, and the queued orders raise the floor as before.

---

## 7. AI tasks

Each subsection: purpose · default prompt location · entry point · key inputs · output tool/schema · validation & fallback. All schemas are in `gameplaySchemas.js`; the tool name is what the model calls. Task text lives at `defaultPrompts.json` `tasks.<key>`.

### 7.1 `jumpForward` — manual time skip
- **Purpose:** Simulate every event between the origin date and a player-chosen target date; move the map, units, structures, diplomacy.
- **Prompt:** `tasks.jumpForward`. **Entry:** `simulateTimelineJump({days, mode:"jump", signal})` `gameplay.js`.
- **Inputs:** full state bundle; `targetDate`; event-count band from `eventCountRangeForDays(days)` (a month 10-15, §6a) with a floor of one event per queued action; duration label; `${CURRENT_UNITS/MAP_STRUCTURES/CITY_COORDINATES}`; the live records (§6a).
- **Tool/schema:** `submit_jump_result` / `JUMP_FORWARD_SCHEMA` (`gameplaySchemas.js`). Payload: `events[]` (each `date/title/description` + `impacts`), `stopDate`, `summary`, `clearActions`, top-level `diplomaticOutreach[]`. No scene: now and then the skip offers one of its events as an interactive event instead, at no cost (`runtime/interactiveOffer.js`).
- **Validation:** `validatePayload` (`gameplay.js`) — strict on attempt 1 / salvage on final: event-count range, `validateTimelineDates` then `clampTimelineDates` on salvage, then `validateGeneratedWorldChanges` resolving region names → ids (`resolveRegionTransfers` `831`) with a corrective owner-region list (`buildTransferFeedback` `940`) and the **capture-reluctance guard** (`CAPTURE_LANGUAGE` `994`, guard `1020`). **Fallback:** `fallbackJumpSimulation`. Timeout: unbounded unless the "Limit AI generation" map setting is on (then 5 min); `signal` aborts cleanly.
- **Applied by:** `applySimulationResult` — appends events, bumps round/date, resolves planned actions, applies impacts, opens generated chats, writes a `simulationHistory` entry, snapshots for rollback.

- **What the jump is told** (both jump templates; pinned by `jumpPromptCraft.test.js`; the whole layout is §6a):
 - `[Real History Is the Default]` *(guidance, id `history`)* — the real events of the period happen, with their real people, places, dates and numbers, unless something in this game has changed their causes; the game departs from history only where the game has; an alternate history follows ours only to its divergence, a fictional world its own lore. It replaced the call-time Counterfactual Knowledge Boundary ("MEMORY IS NOT EVIDENCE"), under which a skip could not hold a month's real elections or crises.
 - `[What an Order Can Do]` *(guidance, id `orders`)* — every order is an attempt and gets an outcome, citing its id; acts that need nobody's consent happen now, acts that bind another polity need its agreement or a fait accompli (else a claim); means and authority decide what is possible; wars take time.
 - `[What Is True Now]` *(technical — deliberately **not** editable)* — the order of authority: the current map, records and last turn's application result; then the game's events, which explain the present and are never evidence of who holds what today; then real history and the world before round 1, the default for everything the game has not changed.
 - `[The World Answers Back]` *(guidance, id `reactions`)* — every other polity acts on its own interests; the world may move first, including against the player; both sides of a fight fight; a large move by the player gets answers from every power with a stake; other powers' forces show on the map; the player's own reply is never decided for them.
 - `[How to Write an Event]` *(guidance, id `quality`)* — last in the prompt: the title is the headline, the description the story under it, never the headline restated; no word cap, no voice rules.

### 7.2 `autoJumpForward` — auto skip to the next notable event
- **Purpose:** Same engine, but **stop early** at the first strategically notable / player-relevant / memorable event and set it `notable:true` (a notable event is preferred when the skip offers an interactive event).
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
- **Tool/schema:** `submit_description_to_action` / `DESCRIPTION_TO_ACTION_SCHEMA`: `{ title, text, kind, invitees[], chatStarter }`.
- **Fallback:** `fallbackDescriptionToAction` — heuristic chat detection via `CHAT_HINT_PATTERNS` and `inferInviteeNames`.

### 7.5 Diplomatic speaker routing — native / in-batch
- **One-on-one:** there is exactly one AI counterpart, selected natively. No speaker-selection model call exists.
- **Groups and institution conversations:** `runChatActionBatch` is the canonical path. The same AI request that decides what the table does also decides who speaks, reacts, votes, or stays silent and in what order.
- **Failure:** the group batch fails closed and reports the request error. There is no legacy sequential group-chat fallback and no standalone `nextSpeaker` prompt/tool/schema.

### 7.6 `eventConsolidator` — compress history
- **Purpose:** Fold a batch of events + closed chats into one continuity summary (~≤360 words) so old detail leaves the context window without losing map/diplomacy facts.
- **Prompt:** `tasks.eventConsolidator`. **Entries:** `consolidateHistoryBatch` (`535`, auto-run by `compactHistoryIfNeeded` `554` after jumps) and `consolidateRecentHistory({limit})`.
- **Tool/schema:** `submit_event_consolidation` / `EVENT_CONSOLIDATOR_SCHEMA`: `{ summary }`.
- **Fallback:** concatenate raw event lines + `buildChatSummaryText`. Triggers: `CONSOLIDATION_*` thresholds (`gameplay.js`).

### 7.7 `interactiveCreation` — open a branching scene
- **Purpose:** Design an immersive scene for the interactive event a time skip offered, with an opening and 2–5 choices.
- **Prompt:** `tasks.interactiveCreation`, with `[THE MOMENT TO PLAY OUT — BINDING]` (the offered event) and, when the player gave one, `[THE PLAYER'S ANGLE — BINDING]` in the user message. **Entry:** `createInteractive({ eventId, angle })` `gameplay.js`.
- **Tool/schema:** `submit_interactive_creation` / `INTERACTIVE_CREATION_SCHEMA` (= `interactiveSchema`, `gameplaySchemas.js`): `{ title, premise, opening, choices[2..5] }`. Written to `world.activeInteractive`.

### 7.8 `interactiveExecutor` — advance a scene
- **Purpose:** React to the player's chosen option, advance the scene, add to a progress bar, and offer next choices (or resolve).
- **Prompt:** `tasks.interactiveExecutor` (uses `${interactiveChoice}` and `${RUNNING_INTERACTIVE_PERCENT}`). **Entry:** `advanceActiveInteractive(choiceText)` `gameplay.js`.
- **Tool/schema:** `submit_interactive_execution` / `INTERACTIVE_EXECUTOR_SCHEMA`: `{ summary, resolved, nextChoices[] }`. Validator enforces: empty `nextChoices` when resolved, ≥2 distinct otherwise.

### 7.9 `interactiveSummary` — finished scene → one event
- **Purpose:** When an interactive event resolves, condense it into a single campaign event.
- **Prompt:** `tasks.interactiveSummary`. **Entry:** the resolution branch of `advanceActiveInteractive` (`gameplay.js`), then `applySimulationResult` with `mode:"interactive"`.
- **Tool/schema:** `submit_interactive_summary` / `INTERACTIVE_SUMMARY_SCHEMA`: `{ title, description, importance }`.

### 7.10 `pregameHistory` — backstory generator
- **Purpose:** On the first open of a fresh game with a "World Before Round One" briefing, write 4–10 dated events **strictly before** the start date. Runs once (the `simulationHistory` entry doubles as the done-marker); events carry **no impacts** (world already reflects them); clock stays at start, round stays 1.
- **Prompt:** `tasks.pregameHistory`. **Entry:** `maybeGeneratePregameHistory` `gameplay.js`.
- **Tool/schema:** `submit_pregame_history` / `PREGAME_HISTORY_SCHEMA`: `{ events[1..12] { date,title,description,importance,kind }, summary }` — note the impact-free `pregameEventSchema`.
- **Validation:** `validatePregameEvents` — strict/salvage: all dates before start, chronological; non-Gregorian scenarios skip date checks. No fallback (silent null on failure).

### 7.11 `gameMaster` — direct map/state cheat
- **Purpose:** Apply an explicit player/GM request to the map/world; never argue or refuse.
- **Prompt:** `tasks.gameMaster`. **Entry:** `applyGameMasterCommand(requestText)` `gameplay.js` (passes `gameMasterRequest`).
- **Tool/schema:** `submit_game_master` / `GAME_MASTER_SCHEMA`: `{ summary, impacts { regionTransfers, polityChanges, markerOps } }`.
- **Validation:** `validateGeneratedWorldChanges` (strict on attempt 1). **Fallback:** empty impacts + neutral summary. Wrapped as a "Game master intervention" event.

### 7.12 `countryStatSheet` — structured national stats
- **Purpose:** Compile a full stat sheet for a selected polity for the Stats tab.
- **Prompt:** `tasks.countryStatSheet`. **Entry:** `generateCountryStatSheet({code, name})` `gameplay.js` (userMessage carries a `buildTargetDossier` + era slice).
- **Tool/schema:** `submit_country_stat_sheet` / `COUNTRY_STAT_SHEET_SCHEMA`: `capital, continent, government, leader, stability(0–100), indices{sovereignty,foodAutonomy,energyAutonomy,economicIndependence,internalSecurity,internationalReputation}, economy{gdp,gdpGrowth,gdpPerCapita,currency,inflation,unemployment,publicDebt,budgetBalance}, gdpBreakdown{agriculture,industry,services}`.
- **Validation:** all strings non-blank; all indices 0–100 integers; `agriculture+industry+services === 100` (`gameplaySchemas.js`). No fallback.

### 7.12a `timelineCurator` — the native timeline curator

- **Prompt:** `tasks.timelineCurator` (uses `${curatorPriorHistory}` and `${curatorCandidates}`, passed directly) plus the `[Strict Curator Calibration]` directive appended at call time. **Entry:** `curateGeneratedEvents` in `src/Game/AI/nativeTimelineCurator.js`, called from `applySimulationResult` after the content de-dup and before canonical ids, impacts and persistence.
- **Purpose:** the model classifies every fresh candidate (KEEP / REDUNDANT / UNSUPPORTED_REVERSAL with confidence, matched prior indexes, storyline, worthwhile/substantive/process flags). Native gates decide what may be removed: an event with hard consequences (territory, claims, units, features, chats, a polity rename or recolor, a war-ledger binding) is always kept; an exact same-date restatement of a prior event is always dropped; a REDUNDANT verdict removes an event only with high confidence, a retrieved prior match that is genuinely similar, no new dimension and no recurrence value; saturation and process-filler gates catch routine churn in a busy storyline. Ledger records bound only to a dropped event are dropped with it. Any failure of the analysis keeps everything.

### 7.12b `unitDirector` — the native unit director

- **Prompt:** `tasks.unitDirector` (uses `${unitDirectorGameDate}`, `${unitDirectorRound}`, `${unitDirectorUnits}`, `${unitDirectorCandidates}`, all passed directly by the caller) plus the `[Native Unit Director — runtime rules]` directive appended at call time. **Entry:** `directGeneratedUnitOps` in `src/Game/AI/nativeUnitDirector.js`, called from `finishTimelineJump` after the segments are merged.
- **Purpose:** the jump writes history; this pass keeps the persistent order of battle coherent with it. Only events whose text describes an operational change (advance, redeploy, clash, mobilize, siege…) are offered, with the current units; the model answers `eventOrders` (unit ops per event index). Native rules keep only plausible ops: reuse before spawn (spawn budget, explicit new-formation cue), moves within the era leash of the unit type, strength only where the event narrates casualties/attrition/reinforcement, remove only for destruction/disbandment, no duplicates. Accepted ops are attached to the event and applied exactly like the simulator's own unitOps, so a long move becomes a standing order of the beta unit engine. There is no attack op on this build; a failed or unavailable director leaves the events unchanged.

### 7.12c The native world director, storylines and `worldMotionRepair`

- **Not a prompt-pack task.** `nativeWorldDirector.js` + `nativeWorldIntegrity.js` (ported from kernely's Continuum branch) run deterministic CPU analysis before every jump segment, in a module worker (`worldDirectorWorker.js`, main-thread fallback): which persistent storylines get focused attention this segment and which are deferred, a rotating exploration slate (5 player-sphere / 5 wider-world lanes plus a crisis-discovery lane), the era's conflict-risk posture, economic and diplomatic attention, and the storyline record contract. The text becomes `${worldInitiativeContext}` (appended as the `[Native World Director — authoritative live causal context]` directive); the analysis drives validation.
- **Storylines.** `world.storylines` (world-state.md §2b-bis) is the hidden state of the world's ongoing processes. A jump payload carries them as compact `storylineUpdates` lines (`id~status~pressure~momentum~startedDate~kind~title~participantsCSV~eventNumbersCSV~state`). Per segment, after the ledgers: the director's binders attach records to their events (`storylineIds` on events), quiet echoes of deferred processes are stripped, serious visible history must bite into a canonical owner (`validateWorldEventConsequencePayload`; a major event whose only consequence is an open Board entry, found by the engine's own matcher `boardEntriesConcernedByEvent`, passes provisionally and must be backed by the board pass, §7.17, while an unresolved crisis still needs a storyline), the records are checked (`validateWorldStorylinePayload`; among its rules, a crisis-level storyline — pressure ≥ 55, or a war — may not lower its pressure while its bound events carry only escalation/failure cues, a keyword test that is not applied to quiet programmes because ordinary words like "deploys" trip it) and the exploration audit is validated. Every accepted segment then passes the integrity screen (`screenGeneratedWorldEvents`: a non-belligerent's wartime economy, routine no-delta military or administrative process cards, low-trajectory feed guard) before the next segment or the curator sees it; a record bound only to a dropped event goes with it. `applyWorldStorylineUpdates` writes the ledger once per turn, after wars and diplomacy.
- **`worldMotionRepair`** (tool `submit_world_motion_repair`, `WORLD_MOTION_REPAIR_SCHEMA`): **once per skip, never per segment** (`repairSkipStorylineMotion`, after the last segment is in hand). Every storyline any segment selected (`mergeSkipAttentionStorylines`) is judged once over the whole skip (`findSkipStorylineMotionIssues`): where it stood before the skip against the last update it received in any segment, with its event links rebuilt from the skip's events. One that never got an update, or is past its anti-stasis backstop and still objectively unchanged, gets one narrow repair call (`runTargetedWorldMotionRepair`: inline system prompt, no events or other ledgers, `callRepairAI`). Detection, prompt and validation all use the skip's merged stop date. A failed repair withdraws that storyline's skip updates (unless the storyline was born in the skip), so it stays overdue for the next turn; it never costs the turn. Past the backstop (`storylineAtAntiStasisBackstop`) the repair prompt states the validator's numeric rule — change status, or move pressure ≥`ANTI_STASIS_MIN_PRESSURE_DELTA` (4) or momentum ≥`ANTI_STASIS_MIN_MOMENTUM_DELTA` (6) — because a prose-only change is rejected there. The main pass and the validator's rejection state the same rule, plus linking a material event, for every storyline at the backstop, active wars below the high-pressure line included; all three read one sentence, `describeAntiStasisObjectiveRule`. **Limits** (`nativeWorldDirector.js`): a skip makes at most `MAX_MOTION_REPAIRS_PER_JUMP` (8) repair calls and spends at most `MAX_MOTION_REPAIR_MS_PER_JUMP` (10 min) on them — none starts once it is spent, and one still running when it runs out is stopped (`runBoundedRepairCall`, `repairCall.js`) and left overdue without a cooldown; a storyline whose repair failed is not retried for `MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS` (3) rounds unless it changes or the player rewinds past the failure (in-memory `motionRepairFailures`, keyed by campaign); a turn that fell back to canned events makes no repair calls. A skipped issue is handled exactly like a failed repair, and each skip logs one `[OH World Motion Repair]` summary line (attempted, repaired, failed, left overdue and why).
- **Breadth repair.** After curation, a jump of 21–40 days left with ≤3 worthwhile events, or a busy window whose rolling consequence signal is low, gets one bounded composition search of the exploration lanes still quiet after curation (`runWorldBreadthRepair`, reusing the jump tool, ≤5 events, no ledger mutation, new storylines only); its candidates pass the same integrity screen and the same curator.
- **GM Console.** `storylineUpdates` (transport `storylineUpdatesJson`) create, advance or resolve storylines in a previewed transaction; `${canonicalStorylineContext}` shows the current ones. **Pregame.** `storyline:active | storyline:dormant` canonicalUpdates persist unresolved non-war Day-1 processes; every live Round-One war is mirrored into `storyline-<warId>` mechanically (`ensurePregameWarStorylineMirrors`).

### 7.12d `territoryDirector` — the native territory director

- **Prompt:** `tasks.territoryDirector` (uses `${territorialControlContext}`, `${territoryDirectorState}`, `${territoryDirectorCandidates}`). **Entry:** `directGeneratedTerritoryOps` (`nativeTerritoryDirector.js`) in `finishTimelineJump`, after the unit director. **Tool/schema:** `submit_territory_director` / `TERRITORY_DIRECTOR_SCHEMA` (`eventOrders[{eventIndex, regionControlOps[], reason}]`).
- **What it is shown of the map:** `summarizeTerritorialState` (`nativeTerritoryDirector.js`) — the two sparse stores (`regionSovereigntyOverrides`, `regionClaimants`), `claimantRoles` (what each claimant named there is, where its record says) and, of `regionOwnershipOverrides`, only the rows for the regions those two name: the occupied and disputed regions, capped at 400 with the front the candidate events are about kept first and anything left out counted. It used to be all three stores whole, pretty-printed. On a hand-drawn world every region carries an ownership override, so on the built-in scenario that was 4,848 rows of a numeric id and an owner — no region name, nothing to reason from — and a request of **215,323 characters, now 23,550**. It is also handed `placesTheseEventsName`: every region and city the candidate events name, each with who controls it now, who lawfully owns it where that differs, and who claims it (`placesNamedIn`, `lookupTools.js`) — because the controller is what the director writes into `fromCode`. For one day this was left to a lookup ("ask `find_region`"), which saved characters and cost a request: the wrong way round on a free key, where every lookup round re-sends the whole prompt ([the request budget](ai-overview.md#the-request-budget)). The template now says to take `fromCode` from that list, and the state never tells the model to go and ask for anything (pinned by `nativeTerritoryDirector.state.test.js`).
- **Asked as a job, not a request, while requests are being saved.** `buildTerritoryDirectorInput` returns exactly what the director's analyzer would be sent, or `null` when no event is territorial, so [the turn review](ai-overview.md#the-turn-review-every-check-after-a-skip-in-one-request) can carry it in its one request; the director then runs unchanged with that part of the answer in place of a call of its own. The unit director (`buildUnitDirectorInput`), the curator (`buildCuratorInput`) and the board follow the same pattern.
- **Purpose:** the jump writes history; this pass turns the surviving front state into de-facto `regionControlOps` (contest / control / clear_contest) without inventing legal transfers. Legacy wartime `regionTransfers` on capture-worded events are converted to control ops first; deterministic rules sanitize the proposals (a control flip needs explicit capture wording and different sides, a contest needs fighting wording, clearAll needs a final settlement, duplicates dropped); accepted ops are resolved through the geography resolver bounded by current control. `window.__OH_NATIVE_TERRITORY_DIRECTOR__.last` shows the last pass.

### 7.12e `geographyResolver` — the bounded semantic geography pass

- **Prompt:** `tasks.geographyResolver` (uses `${geographyResolverItems}`). **Entry:** inside `resolveRegionTransfers` (`gameplay.js`), for transfers and control ops whose place wording exact matching could not resolve. **Tool/schema:** `submit_geography_resolution` / `GEOGRAPHY_RESOLVER_SCHEMA`.
- **Purpose:** map a city, fortress, exonym or historical area onto the losing side's real regions (its `candidateRegions`) or answer UNRESOLVED; never decides who should own anything. The resolver first tries the rendered scenario geometry (city points inside region polygons, aliases, the losing side's own regions) and accepts a semantic answer only above a confidence threshold with every id inside the bounded candidate set; conflicting recipients for one region fail safe. Narrated city coverage: an event that says control changed in a named city must carry an operation for that city's rendered region.

### 7.13 `idleDiplomacy` — unprompted note drip
- **Purpose:** Between jumps, on each real-minute tick, a small chance a single polity sends the player a short note; usually the answer is silence (`chat: null`).
- **Prompt:** `tasks.idleDiplomacy` (uses lowercase `${playerPolity}`, `${dateReadable}`, `${worldSummary}`, `${recentEvents}`, `${chatSummary}`). **Entry:** `maybeSendIdleDiplomacy({chance})` in `gameplay.js`, rolled once a visible minute by `GameUI/main.jsx`. It is **background AI**: it does nothing while the player has Background AI turned off (Settings → AI → AI requests; on by default) or has reached that day's cap, and its calls are counted as background ([the request budget](ai-overview.md#the-request-budget)). Its one cadence is the game's Idle diplomacy feature — one attempt every N minutes, 8 by default, zero when the feature is off — and the same request also asks whether any forces would visibly move. It used to run at least one roll in four regardless of the feature, so that the map "breathed"; that floor is gone. Suspended by the simulation busy-lock.
- **Tool/schema:** `submit_idle_diplomacy` / `IDLE_DIPLOMACY_SCHEMA`: `{ chat: null | createdChat }`. No editor section; no canned fallback (silent). A note from a country the player already 1:1s with lands in that thread.

### 7.17 `projects` — the Projects & Operations board

- **Purpose:** move the board to match the events a jump has just produced. Bookkeeping, not authorship: it records what the story did to each running effort.
- **Prompt:** `tasks.projects`. **Entry:** `generateProjectOps`, run by `simulateTimelineJump` after the segments merge and before anything is written.
- **Inputs:** the board (`${projectsSummary}`) and **every Canonical event** of the jump, numbered, in the user message: the visible (timeline) events first, then the Hidden events, meaning those the integrity screen's routine/low-value rules and the curator's redundancy/filler/churn routes kept off the timeline, each marked "(kept off the timeline)". Routine progress is exactly what moves a standing Operation, so the board must not depend on what the timeline chose to show (world-state.md §2e-bis). Events rejected as untrue (non-belligerent wartime causality, an unsupported reversal) and exact duplicates are never included. Deliberately nothing else — no world summary, no city coordinates, no unit list, no chat history. ~20 KB against the jump's ~500 KB, plus the Hidden events.
- **Tool/schema:** `submit_project_ops` / `PROJECTS_SCHEMA`: `{ projectOps[] }`, each carrying `eventIndex`. `boardPassCarriers` (`runtime/projects.js`) groups the ops by the event that caused them and orders those groups by date across the visible and Hidden lists, so an entry a Hidden event opens exists before a later event moves it. Each group is applied in turn through the event path (`applyEventImpactsToWorld`), so completion effects release exactly as they would from a timeline card. Ops on a visible event are also recorded on it, as before. A Hidden event's are applied without being stamped into the entry's activity (`boardOnlyEventIds`). An op with no usable `eventIndex` still rides on the last visible event, but in a group of its own.
- **Provisional major events.** A strategically major event whose only consequence is a Board entry passes the world director's consequence check provisionally (§7.12c). The turn judges it on the Board itself, before and after that event's own ops (`materiallyChangedEntryIds`): an entry opened, a status or progress change, or a checkpoint reached or missed. A `lastUpdate` alone and a restated figure do not count, and neither does an op with no usable `eventIndex`. An unbacked event leaves the timeline before the write, and its ops are applied without stamping it. An event that gained a consequence of its own after the segment check (unit or control ops from the directors, spy orders, resolved player orders) stands on that instead. The `[OH board]` console line reports how many Hidden events were read and how many of them moved how many Board entries, the provisional events and how many were unbacked, and any HIGH PRIORITY entry the pass left unassessed.
- **No fallback.** An empty board is what a failed call should leave behind, and `runJsonTask` throwing is what lets the caller hold the turn and offer a retry rather than pretending the board moved. The segments' Hidden events ride in the held turn's `result`, so a Retry reads the same ones. A Retry re-runs the curator, though, so its Hidden events follow that run's own timeline.

Its rules live in the template, with one exception injected at call time: `buildBoardPassDirective` (`projectsDirective.js`) restates the HIGH PRIORITY rule, which means an explicit assessment every jump where "no material change this period, because…" is valid, never forced movement. It says it supersedes the old wording, a leftover of the frozen-prompt era (§2). The game master's inline board block and the jump's board directive share the same sentence (`HIGH_PRIORITY_ASSESSMENT_RULE`).

### 7.14 Root prompt: `leader` — AI diplomacy
- **Purpose:** Roleplay a single non-player polity replying in an ongoing chat; keep the existing hard rule to **match the player's average message length**, lightly match formality, and simulate a polity leaving. Decision posture comes from canon/current political state rather than from whether the proposal came from the player.
- **Prompt:** top-level `leader` string. **Assembly:** `buildDiplomaticSystemPrompt(countries, playerCountry)` (`main.jsx`, `+difficultyDirective`) then `sendDiplomaticMessage(playerMessage, speakingAs, countries)` adds the per-turn instruction + optional `REACTION:<emoji>`. Free-form text (no tool/schema). `${RESPONDING_POLITY_NAME}` selects the voiced polity.
- **CP3C diplomacy prose contract:** the shipped guidance no longer forces first-person-only speech, automatic threats/consequences on refusal, or celebratory/grateful language on acceptance. A leader may use first-person or natural state/institutional references, while the per-turn instruction still forbids a redundant country-name prefix; the group-chat structured-action path also strips only an exact redundant speaker label at its native boundary. The cleanup changes writing guidance only: it does not alter Political World projection, CP3A/CP3B authority/selection, difficulty, player agency, durable diplomatic memory, or canonical state semantics.

- **Durable memory:** every reply also carries a hidden `DIPLOMATIC_MEMORY:<summary>` line — the thread's COMPLETE durable memory, modal force and attribution preserved (`buildDiplomaticTurnInstruction`, `runtime/diplomaticEnvelope.js`). `parseDiplomaticEnvelope` strips it and the chat stores it on the message as `memorySummary`; the newest one is fed back as a system-side context entry ahead of the dated, attributed transcript tail (`loadDiplomaticHistory`), and `diplomaticContinuity` (§5.1) shows it to the jump.
### 7.15 Root prompt: `advisor` — chief advisor chat
- **Purpose:** In-character strategic advice, ≤3000 chars, may append a `chart`-fenced Chart.js block. **Assembly:** `buildAdvisorSystemPrompt` (`main.jsx`) + `sendMessage` with rolling `advisorHistory`; language directive only (no difficulty, no schema).

### 7.16 Not in the prompt pack: `generateCountryStats` — intel briefing
- **Purpose:** Free-text bulleted intelligence briefing on a polity. Builds its **own inline system prompt** (dossier + world snapshot + recent events) and calls `callAI` **directly** (no tool, no `runJsonTask`, so only the language directive is appended). Entry: `generateCountryStats({code, name})` `gameplay.js`. Distinct from `countryStatSheet` (§7.12).

---

## 8. Impacts / output-shape reference

Shared `impacts` object (`impactsSchema` `gameplaySchemas.js`) carried by jump/auto/gameMaster events. All entries are optional arrays; omit empties.

| Field | Entry shape | Resolution / notes |
|---|---|---|
| `regionControlOps` | `{ op: contest\|control\|clear_contest, regionId, regionName?, fromCode, actorCode\|toCode\|claimantCode, actorRole?\|toRole?, clearAll?, wholeCountry?, note? }` | De-facto control (world-state.md §2b). Resolved through the same geography resolver as transfers, bounded by current control; `control` moves the controller and anchors the lawful sovereign, `contest` adds a contender, `clear_contest` removes one. `actorRole` / `toRole` say what the new side is and become its record's `role`. |
| `regionTransfers` | `{ regionId, regionName?, fromCode?, toCode, note? }` (LEGAL sovereignty only) | `regionId` may be a plain name; `resolveRegionTransfers` (`gameplay.js`) maps name→id (owner-disambiguated). Unresolved → strict corrective feedback (attempt 1) or dropped (final). Required whenever event text claims a capture (Map Truth guard). A `toCode` the map does not know **founds** a polity of exactly that name (`runtime/polityFounding.js`): the resolver prepends a `polityChanges` create to the same event, and the world state founds again as a safety net for impacts that never met the resolver; only `fromCode` must already exist. Same for a `regionControlOps` control's `toCode`, a contest's `actorCode` and a live claim's `claimantCode`. |
| `regionClaims` | `{ regionId, regionName?, claimantCode, claimantRole?, drop?, note? }` | Territory claimed but not held: stripes the region without moving the border; `drop: true` withdraws. `claimantRole` says what the claimant is — a country, a terrorist organisation, one side of a civil war — and becomes its record's `role`. A plain name is resolved to an id beside the transfers; a claim that matches nothing is dropped, never failed. |
| `polityChanges` | `{ operation: update\|create\|rename\|restore\|dissolve, code, name?, color?, aliases?, reputation?(0–100), intelligence?, tags?, role?, stats?, note? }` | `reputation` was recently added to the schema; without the schema entry, json-schema providers could never emit it. `tags` is the *complete* new trait list, not a delta. `role` is what the polity is; an empty one keeps it. |
| `createdChats` | `{ countries[≥1], title, openingMessage, speaker }` | Initiating polity speaks first, never the player. `validateChatOpener` requires title + opening. Built into a real chat by `buildGeneratedChat`. |
| `unitOps` | `spawn{unit{name,type∈enum,ownerCode,strength 1–100,composition,at\|lng+lat,regionId?,posture?,note?}}` · `move{unitId,at\|toLng+toLat,regionId?,posture?,note?}` · `strength{unitId,strength 0–100}` · `remove{unitId}` | `unitOpSchema`. **`at` is where, in words** ("near Kharkiv", "off Sevastopol"), resolved to a point at validation by `placement.js` and then spaced off whatever already stands there (`runtime/featureSpacing.js`); see [placing things by name](ai-overview.md#placing-things-by-name-and-keeping-them-apart). Ops on unknown unit ids: strict error / salvage drop. `strength:0` or `remove` deletes the unit. |
| `markerOps` | `build{marker{name,kind(free lowercase),ownerCode?,status?,at\|lng+lat,note?,foundedAt?}}` (or flat beside `op`) · `update{markerId\|name, …, at?}` · `remove{name}` | `markerOpSchema`. `at` as for units. Structures never move borders (no `regionTransfers`). |
| `reports` | `create{reportId?,title,body,visibleTo[],from?,dateline?}` · `share{reportId,visibleTo[],from?}` | `reportOpSchema`. The document itself, in its own voice, held by the polities named; `visibleTo` empty = published; `from` whose it is (or, on a share, who passed it on). Holders are resolved at validation against the country catalog (unknown: strict error / receipt note; none known: dropped). `[Reports — documents, not summaries]` + `[Reports on File]` (with who stole a copy) ride on the jump; a leader gets `[Documents Your Government Holds]`, the advisor `[Documents Our Government Holds]`. |

Jump payloads also carry a top-level `diplomaticOutreach[]` (same shape as `createdChats`, not tied to an event). The schema validator (`validateGameplayPayload` `852`) additionally enforces non-blank `stopDate`/event fields, "at least one event, summary, or meaningful interactive event," and distinct interactive event choices.

---

## 9. Recipes

### Add a new template variable
1. **Compute it** in `buildPromptContext`'s return object (`promptContext.js`) — e.g. `myThing: buildMyThing(bundle.world)`. Add a builder next to the others if non-trivial. (If it needs reputation/feasibility-style augmentation only for tasks, add it in `buildTemplateVariables` `gameplay.js` instead — but remember advisor/leader won't see those.)
2. **Expose a placeholder** in `defaultPrompts.json` `helpers`: `"MY_THING": "${myThing}"`.
3. **Reference it** in the task/root text as `${MY_THING}` (or the lowercase `${myThing}` directly).
4. **Editor:** nothing — helpers are technical and never shown. If the sentence that uses the variable is guidance an author should be able to reword, keep it inside a segment declared in `promptGuidance.js` (or declare one, with unique `start`/`end` anchors) and keep the placeholder inside the passage.
5. Nothing else — `renderTemplate` picks up any key present in the merged `{...variables,...helperValues}` map.

### Add a new task
1. **Schema + tool:** define `MY_TASK_SCHEMA` and `MY_TASK_TOOL = makeTool("submit_my_task", …)` in `gameplaySchemas.js`; register both in `GAMEPLAY_SCHEMAS` and `GAMEPLAY_TOOLS` under the new key; add any task-specific checks to `validateGameplayPayload`.
2. **Prompt text:** add `tasks.myTask` to `defaultPrompts.json` ending with the JSON output contract. It is auto-picked-up: `PROMPT_TASK_KEYS = Object.keys(tasks)` and `normalizePromptPack` iterate it (`gameplayPrompts.js`, `246`).
3. **Entry point:** in `gameplay.js`, build variables (`buildTemplateVariables(bundle, {…})`) and call `runJsonTask("myTask", { userMessage, variables, fallback?, validatePayload?, timeoutMs? })`. Wrap state-writing tasks in `beginSimulation/endSimulation`.
4. **Call-time directives:** only for text that depends on runtime state; a rule in the template reaches every campaign (§2).
5. **(Optional) editor:** add a `PROMPT_SECTION_DEFINITIONS` entry (`type:"task"`) **and** at least one guidance segment in `promptGuidance.js`; a section without segments stays hidden, and only the segments are editable.

---

## 10. Gotchas

- **`worldSummary` and `worldSummaryNoCity` are the same string** — the "no city" name is historical; city coordinates are a separate `citiesSummary`/`${CITY_COORDINATES}`.
- **`worldSummary` embeds the briefing and the simulation rules**, so a prompt that also renders `${WORLD_BEFORE_ROUND_ONE_TEXT}` or `${HISTORICAL_PRESET_SIMULATION_RULES}` would send them twice. `collapseRepeatedWorldContext` (`promptDedupe.js`) keeps the first copy of each and swaps later copies for a pointer; `runJsonTask` applies it to every task and `main.jsx` to the advisor and leader prompts. Values under 400 characters are left alone. Don't strip them from the summary instead: `actions` and `idleDiplomacy` see the rules only there.
- **Two output attempts per task**, then a deterministic fallback (or throw). `finalAttempt` comes from `runJsonTask`, never from counting validator calls — attempt-1 schema failures skip `validatePayload` entirely (`gameplay.js` comment).
- **What a polity is goes beside its name, never in it.** A `role` is shown as a legend (`What these claimants are:`), a map (`claimantRoles`, `participantRoles`) or a `— what it is:` suffix, so the name the model copies into `claimantCode` / `toCode` stays exact: "Islamic State (a terrorist organisation)" written back as a claimant would found a second polity under that whole string ([polity names are exact](world-state.md)).
- **Reputation and military-feasibility reach only the task path** (`buildTemplateVariables`). Advisor/leader use `buildPromptContext` directly and never see them.
- **The intel `generateCountryStats` briefing is invisible to the Prompts editor** — it is an inline prompt not in `defaultPrompts.json`. (`idleDiplomacy` has had a section, with one guidance passage, since 2026-09-16.)
- **Editing `defaultPrompts.json` reaches every campaign** (the guidance model, §2) — but an edit that moves or rewrites a guidance passage must keep, or update, that passage's anchors in `promptGuidance.js`; `promptGuidance.test.js` fails otherwise, and a passage whose anchors are gone silently drops out of the editor.
