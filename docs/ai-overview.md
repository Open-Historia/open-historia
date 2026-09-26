# AI System Overview

Open Historia drives every generative feature — the strategy advisor, leader diplomacy, timeline simulation, interactive events, stat sheets, and the game‑master console — through a single browser‑side AI layer under `src/Game/AI/`. The player's own API key talks **directly** to their chosen provider from the browser; there is no Open Historia backend in the loop except an optional same‑origin relay that only exists when the page is served from a machine the player controls. Two entry points sit on top of the transport: `callAI` for free‑form chat, and `runJsonTask` for schema‑validated structured "tasks" that mutate world state.

This page documents the plumbing. For the prompt templates and how they are assembled, see [AI prompts](ai-prompts.md); for the JSON tool/response schemas and per‑field meaning, see [AI schemas](ai-schemas.md); for what the applied changes touch, see [World state](world-state.md).

---

## Module map

| File | Responsibility |
|------|----------------|
| `src/Game/AI/main.jsx` | Transport. `callAI` dispatch, per‑provider callers, `providerFetch`/relay, streaming reassembly, advisor + diplomatic chat (`sendMessage`, `sendDiplomaticMessage`). |
| `src/Game/AI/providerConfig.js` | Provider registry, Connections and the Fallback list (storage, migration, Fill, per-task picks, entry states), reasoning toggle. |
| `src/Game/AI/fallbackRunner.js` | The Fallback list's rules: order (every call from the top), the marks a failure leaves, reset times, "nothing can answer". |
| `src/Game/AI/gameplay.js` | `runJsonTask` task runner + every gameplay task (jumps, interactive events, actions, GM, stat sheets, consolidation, idle diplomacy), validation/salvage, and applying results to world state. |
| `src/Game/AI/gameplaySchemas.js` | JSON Schemas, tool definitions, `getGameplayTool`, `validateGameplayPayload`. See [AI schemas](ai-schemas.md). |
| `src/Game/AI/gameplayPrompts.js`, `promptContext.js`, `defaultPrompts.json` | Prompt pack normalization + template rendering. See [AI prompts](ai-prompts.md). |
| `src/Game/AI/audience.js` | **Who is looking.** The narrator (`SIMULATION_AUDIENCE`) sees everything; a viewer is one or more polities and nothing they could not know. One question asked one way of a chat, a distribution list, an agent — fail closed, and the narrator is always said out loud. |
| `src/Game/AI/chatVisibility.js` | Which diplomatic chats a given polity is allowed to have read. Keeps a leader out of conversations it was not in. Expressed on `audience.js`; it keeps its names and its one legacy convenience (a blank polity is the narrator). |
| `src/Game/AI/lookupTools.js` | The lookup functions a structured task may call before answering: their declarations, the directive, and the executor that answers them from the live campaign and the rendered map. |
| `src/Game/AI/toolTurns.js` | A lookup round in the conversation: one stored shape (Gemini parts), rendered as each provider's tool-call exchange, and the readers that pull a model's calls out of each envelope. |
| `src/Game/AI/structuredMode.js` | The structured-output ladder (`tool → json_schema → json_object → text_json`), the per-entry setting, and the observer that offers it to the player. |
| `src/Game/AI/sampling.js` | What temperature each task is asked at, and the tasks deliberately left at the provider's own. |
| `src/Game/AI/promptDedupe.js` | Skipping a call-time directive the template already carries, and collapsing a large block the prompt would otherwise send twice. |
| `src/Game/AI/usageStats.js` | Token counts and time-to-first-byte, normalized across the three providers' reporting shapes. |
| `src/Game/AI/jsonSalvage.js` | Tolerant parsing of a model's answer: think-block stripping, the answer sentinel, fenced and balanced-brace recovery. |
| `src/Game/AI/providerErrors.js` | Reading what a provider sent INSTEAD of an answer: busy vs rate-limited vs spent quota vs unusable (`classifyProviderFailure`), how often to retry each (`shouldRetryProviderFailure`), streaming refusals, and deliberation-instead-of-tool-call. |
| `src/runtime/applicationReceipt.js` | What the engine dropped, withheld or changed in the simulator's last answer, carried on the newest turn record and rendered at the top of the next jump. See [the application receipt](#the-application-receipt-what-salvage-did-told-to-the-next-turn). |
| `src/runtime/territoryBasis.js` | Why a region changes hands: the `basis` vocabulary, the screen that turns a `claim`-basis transfer into a claim, and the directive the jump is given. |
| `src/Game/AI/requestBudget.js` | **How many provider requests the game spends, and on what.** The player's switches (save requests, background AI, the limits, the five after-skip checks), the day's ledger counted at the provider boundary, and the budget one time skip spends from. See [the request budget](#the-request-budget). |
| `src/Game/AI/turnReview.js` | Every check after a time skip as ONE request: several jobs fenced into one prompt, one output function with a field per job, the answer taken apart, and the board's event numbers moved onto the list the turn ended with. |
| `src/Game/AI/worldDirection.js` | **A scenario author's settings, read and enforced by the engine**: the pace (scales the event count a period is asked for and checked against), the world's share (counted on every answer), and the priority rules (written last in the jump's instructions, marked as outranking everything above). See [world direction](#world-direction-what-an-author-sets-as-numbers). |
| `src/Game/AI/schemaSalvage.js` | Keeping an answer that is wrong in one place: reads where the validator says the fault is and removes the smallest thing there (an unknown field, a malformed optional field, a surplus, one list item) instead of asking for the whole answer again. |
| `src/Game/AI/contextWindow.js` | **Not sending what cannot fit.** What each model said about its context window, remembered from its own refusal; the size of a request; the preflight that passes an entry over without a request and the message when no entry can take it. See [the context preflight](#the-context-preflight-not-sending-what-cannot-fit). |
| `src/runtime/chatThreads.js` | **A thread as an event log.** chat_created / member_joined / member_left / title_changed / message / reaction / poll_created / poll_option_added / poll_vote_cast, the projection back to the shape every reader already expects, migration of an older thread, and membership windows. See [group diplomacy](#group-diplomacy-one-request-for-the-whole-table). |
| `src/Game/AI/chatActions.js` | **One request acts for every AI participant.** The action vocabulary, refs for a poll created and voted in one answer, per-action validation, the feedback the next turn is told, and the steps a batch is said in (`planChatReveal`, `describeChatCutIn`). |
| `src/Game/AI/crossChatKnowledge.js` | **What a leader has heard elsewhere.** Membership-scoped, cursored so nothing is sent twice, and fenced with the delimiters escaped out of the content. |
| `src/runtime/gmChanges.js` | **The Game Master's hand.** One line per change made outside the simulation (`world.gmChanges`, by round, grouped when made in steps), the block the next skip opens with, and the GM's standing reminders (`world.simulationReminders`) every AI is shown. See [the Game Master's hand](#the-game-masters-hand-changes-made-outside-the-simulation-and-standing-reminders). |
| `src/Game/AI/conversationCatchUp.js` | **What a conversation missed.** The note the advisor's next question carries when the world moved on: what became of its last reply, the time and the newest events since, the GM's changes; and the note a leader is sent with the player's next line — the time, the events, the borders moved and the polities changed since the thread last spoke, the votes cast in it. See [conversations](#conversations-one-copy-a-stable-prefix-and-a-catch-up-note). |
| `src/Game/AI/skipPhases.js` | **What a skip is doing, and where its time went.** The phases a skip enters by name, told to the panel as each starts and summed into one log line when it lands. See [the phases of a skip](#the-phases-of-a-skip). |
| `src/Game/AI/interactiveRewind.js` | **Taking back a beat of an interactive event.** Each beat keeps what the player was shown when they chose it, so the scene can return to any beat; and which scene is one in progress (`isSceneInProgress`). See [Interactive events](#interactive-events-a-moment-a-time-skip-offers-to-play-out). |
| `src/runtime/playerGoal.js` | **The player's standing goal.** Kept per polity in `world.playerGoals`; told to the advisor, the time skip and the suggestions in their own terms, never to a leader. See [the standing goal](#the-players-standing-goal). |
| `src/runtime/reports.js` | **Documents, and the governments that hold them.** The stored shape, the `create`/`share` ops an event carries, the audience-scoped read, the list a prompt is shown, and the Report Voice directive. See [reports](#reports-what-only-some-governments-know). |
| `src/runtime/reportDelivery.js` | **How a document reaches the player** — through diplomacy, an agent, or its event — planned from what changed hands in a turn; the note, the intercept and the card's documents it becomes; the advisor's list of the government's papers, and its notice of each new one (taken back with an undone turn). |
| `src/Game/AI/intervene.js` | **Stopping a round where the player wants to act.** The journal of what a turn applied, kept on its rollback snapshot; the cut of that journal to the revealed prefix (ledger records bound only to discarded events go with them; the closing date is the last kept event's); and the receipt note that tells the simulator what never happened. See [Intervene](#intervene-stopping-a-round-where-the-player-wants-to-act). |
| `src/runtime/unseenEvents.js` | **What the player has not been shown yet.** Which of the newest skip's events the reveal has not reached (kept on the device), and the rules that take them — and what they brought — out of what the player and the AI speaking to them are shown. See [what the player has not been shown yet](#what-the-player-has-not-been-shown-yet). |
| `src/Game/AI/placement.js` | **Where a thing goes, said in words.** The grammar of `at` ("near Kharkiv", "eastern Ukraine", "off Sevastopol", "Donetsk Oblast facing Russia") and its resolution against a gazetteer of the map into one deterministic point. See [placing things by name](#placing-things-by-name-and-keeping-them-apart). |
| `src/runtime/featureSpacing.js` | Keeping counters and structures off each other: a golden-angle spiral search outward from the point a thing wants, held inside the region (or the sea) it was put in. |

Every module in the second group is **import-free and unit-tested**, deliberately: `main.jsx` and `gameplay.js` reach settings, `fetch` and the DOM and cannot be tested at all, so the judgement calls are lifted out into files that can be.

---

## Supported providers

Defined in `PROVIDER_OPTIONS` at `src/Game/AI/providerConfig.js`. Which provider answers a call is decided by the [Fallback list](#the-fallback-list), not by a single selected provider; `normalizeProvider` maps the legacy value `"custom"` → `"openai-compatible"` and falls back to `DEFAULT_PROVIDER` (`"gemini"`) for anything unknown.

| `value` | Label | Group | Caller (`main.jsx`) | Endpoint | Transport | Model discovery |
|---------|-------|-------|---------------------|----------|-----------|-----------------|
| `gemini` | Gemini | Native APIs | `callGemini` (`main.jsx`) | `generativelanguage.googleapis.com/v1beta` (hard‑coded, key in query) | **direct only** (`fetch`) | no |
| `openai` | OpenAI | Native APIs | `callOpenAI` → `callOpenAIStyleChatCompletions` (`main.jsx`) | `https://api.openai.com/v1` | `providerFetch` (direct, relay if local) | yes |
| `anthropic` | Anthropic | Native APIs | `callAnthropic` (`main.jsx`) | `https://api.anthropic.com/v1` | **direct only** (`fetch`, browser‑access opt‑in header) | no |
| `openai-compatible` | OpenAI Compatible | Gateways & self‑hosted | `callOpenAICompatible` (`main.jsx`) | user `endpoint` (default `http://localhost:11434/v1`) | `providerFetch` | yes |
| `anthropic-compatible` | Anthropic Compatible | Gateways & self‑hosted | `callAnthropicCompatible` (`main.jsx`) | user `endpoint` | `providerFetch` | no |

`callAI` (`main.jsx`) runs every call through the Fallback list (`runWithFallback`, `fallbackRunner.js`), and `dispatchToProvider` switches on each tried entry's provider; `gemini` is the `default` branch. Before dispatch it appends a language directive (`languageDirective()`, [i18n](i18n.md)) so replies come back in the player's language at the source.

"OpenAI Compatible" is the catch‑all for Ollama, LM Studio, OpenRouter, vLLM, and other gateways speaking `/chat/completions`. "Anthropic Compatible" is a self‑hosted proxy speaking the Anthropic Messages API. Both share their native sibling's caller body but read a different settings namespace and are relay‑capable.

---

## Configuration & storage keys

All AI config lives in **browser `localStorage`** — never on a server — as **Connections** and the **Fallback list** (the glossary's words: `docs/world-state.md`, "AI access"; the decision: `docs/adr/0002-connections-and-fallback-list-hold-all-ai-settings.md`).

| Key | Holds |
|-----|-------|
| `ai_connections` | JSON array of Connections: `{ id, provider, name, apiKey, endpoint, customParams, toolStrict, suggestedModel }`. |
| `ai_fallback_list` | JSON array of Fallback entries, in order: `{ id, connectionId, model, customParamsOverride, structuredMode }`. Its presence marks the migration done. |
| `ai_task_picks` | `{ taskKey: entryId }` — the entry a task tries first. |
| `ai_fallback_rate_limit` | `"next"` (default) or `"wait"`: what a Rate limited entry does. |
| `ai_gemini_default_chain` | `"1"` once the list has been checked for the old one-entry Gemini default (see Migration below); never read again. |
| `ai_gemini_default_chain_v3` | `"1"` once the list has had this update's switch to the Flash-Lite default (see Migration below); set straight away on a first launch. What it replaced is kept under `ai_fallback_list_before_gemini_lite_reset` and `ai_task_picks_before_gemini_lite_reset`. |
| `ai_fallback_states` | `{ entryId: { spentUntil?, unusable?, skipUntil?, skipReason?, lastAnsweredAt? } }` — kept apart from the list so a mark never rewrites what the player typed. |

`getResolvedFallbackList()` returns the list with each entry's Connection folded in — `{ id, provider, connectionName, apiKey, endpoint, model, customParams, structuredMode, toolStrict, label }` — and that object is what each provider caller receives as `entrySettings`. An entry's `customParamsOverride`, when set, replaces its Connection's `customParams`.

Notes:
- **Migration** runs on the first read of the list, wherever that is (the harness reads it with no UI): every provider with a key or endpoint, and every profile under `ai_provider_presets`, becomes a Connection; the old active provider (`api_provider`) and its model become entry #1 — or, for Gemini with no model stored, the whole **default Gemini list** (`GEMINI_DEFAULT_CHAIN` in `providerConfig.js`: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`, the second the first's backup, both on the one Gemini Connection; no Flash model, since those are the ones most often busy); the active provider's per-task models (`<provider>_model_<taskKey>`) become entries at the bottom, with picks pointing at them. The old per-provider keys (`gemini_api_key`, `openai_compatible_endpoint`, the legacy `custom_api_*`…) are left in storage and never read again.
- **`structuredMode` lives on the entry** and is only READ by three providers — `openai`, `openai-compatible` and `anthropic-compatible`, whose callers walk the ladder. Changing an entry's model resets it to `auto` (`updateEntry`).
- **The default Gemini list reaches existing players once**: a list still exactly as a first launch set it up before the list existed — ONE Gemini entry on `gemini-3.5-flash-lite` or on a blank model, which meant it — becomes the default list on its next read (`upgradeFormerGeminiDefault`); the old entry keeps its id and its place (so a task pick and a Spent mark stay with it) and its model is written out. A list the player shaped is never touched, and `ai_gemini_default_chain` makes it a one-time check. The start-of-game key prompt (`applyQuickAiSetup`) keeps the list when no model is typed, puts a typed model first (dropping the same model further down that Connection), and gives a NEW Gemini Connection the default list at the top.
- **This update's switch to the Flash-Lite default reaches every Gemini player once** (`resetToGeminiDefaultChain`, marker `ai_gemini_default_chain_v3`; it takes over from the earlier `_v2` reset, which put the six-model Flash list in): every entry on a Gemini Connection leaves the list and the default list takes the place of the first of them, on the Gemini Connections those entries used — only the keyed ones when some are key-less, model first across two keyed ones. Entries on other providers keep their places, a list with no Gemini entry is left alone, an empty one gets the default, and a list already on it is untouched. The old list and task picks are kept under the backup keys above; picks on Gemini entries are cleared and picks on other providers' entries stay. A list migrated in the same read is already this version's and is not touched, so a harness run keeps the model it was given.
- **Default model constants**: `GEMINI_DEFAULT_MODEL` (= `GEMINI_DEFAULT_CHAIN[0]`, `gemini-3.5-flash-lite`) and `ANTHROPIC_DEFAULT_MODEL` in `main.jsx`, `OPENAI_DEFAULT_MODEL` (`gpt-6-luna`) in `providerConfig.js`, used as `resolveModel` fallbacks for an entry with a blank model. Only `openai-compatible` still discovers: a blank model there asks the server's `/models` once per entry per session and never writes the answer back.

### The Fallback list

Every call starts at the top of the list — or at the task's own pick — and moves down only when an entry cannot answer. It never spreads calls across entries to get more usage (`docs/adr/0001-fallback-never-rotation.md`). The rules are in `fallbackRunner.js` (import-free, tested); the provider callers only say how a call failed, via `error.providerFailure` from `classifyProviderFailure` (`providerErrors.js`):

**Every call starts at the top again, except past a Spent or a busy entry.** A rate-limit mark says what a Settings row shows and what the "nothing can answer" message says; it never takes an entry out of a call's order. A busy mark does, for one minute (ten until 2026-09-25): a 503 is the provider saying it is overloaded, and a night's log (2026-09-21) showed the same model asked again within the minute answering with 503s that took 10–70 s each to arrive, or serving in 191 s what its backup served in 34. The strongest model that can answer is asked first every time, so a key that was topped up or a rate limit that passed is used the moment it can answer, at the cost of one fast failed request (a 404 or a 429 is refused in well under a tenth of a second; see `.lab/probes/fallback-timing-probe.mjs`).

A **Spent** mark is the exception: the provider has said the allowance is gone until a reset hours away, so re-asking costs that refusal on every call of every turn rather than once — a session log showed four refusals before each answer, forty across the session. A Spent entry therefore sinks to the **back** of the order until its reset, and is reached again only when nothing else has answered, so a reset that came early, or a mark left by a misread response, is still never what fails a turn. Unusable does not sink: its mark has no reset to wait for, and a provider that returned one 401 in a bad moment heals itself on the next call.

| Failure | What the entry is marked | Clears |
|---------|--------------------------|--------|
| Spent (daily allowance, billing, `insufficient_quota`) | `spentUntil` | Gemini: next midnight Pacific. Others: an hour on. Or an answer, or the Reset button. |
| Unusable (401/403, a bad key, an unknown model, no key set) | `unusable: reason` | When the entry or its Connection is edited, or when it answers again. |
| Busy (502/503/504/529, an overloaded frame, a server that cannot be reached) | `skipUntil` +10 min; the entry waits at the back of the order until then | By itself, or an answer. |
| Rate limited, setting `"next"` (the default) | `skipUntil` + the provider's RetryInfo, or 60 s | As busy. On `"wait"` the provider retries as before and nothing is marked. |
| Too big for the model's context window (`tooBig`) | nothing — the request is the problem, not the entry | The call moves to the next entry, whose window may be larger, and the model's window is remembered (see [the context preflight](#the-context-preflight-not-sending-what-cannot-fit)). |
| Anything else (a bad answer, a parse failure) | nothing | — the call fails as it always did. |

How many times a provider retries before giving up is shared too (`shouldRetryProviderFailure`): Spent and Unusable never; with a backup below it, busy and Rate limited hand the call on at once (on `"wait"`, Rate limited still retries in place) — and when the entry is the last in the order, busy and Rate limited keep the full retry count they had before the list existed. A streamed chat reply never falls back once any of it has reached the player. When nothing can answer — every entry Spent or Unusable — the call throws an error carrying `fallbackUnavailable: { nextResetAt, nextEntry }`, and a time skip checks `fallbackAvailability` first so it is not started at all; both say the same thing (`describeUnavailable`). Each switch is announced once (the `ai:fallback-switch` window event, shown by `FallbackSwitchNotice`), even when the call that found it then fails, and every mark is a Diagnostics log line.

### The context preflight: not sending what cannot fit

A time skip is a big request — about 47,000 tokens on the built-in scenario, more with a long history — and a model with a 32K window refuses it. That refusal used to cost a request *and* the turn: the provider's error was "other" to the Fallback list, so the call failed there instead of moving to an entry with a bigger window, the OpenAI-style path walked the structured-output ladder first (a request per rung, each refused the same way), and the next skip made the same request again. `src/Game/AI/contextWindow.js` (import-free, tested) fixes it with two rules on plain data:

1. **Remember what a model said about its window.** Most refusals state the numbers — "maximum context length is 32768 tokens", "your messages resulted in 46901 tokens", "250123 tokens > 200000 maximum", "exceeds the maximum number of input tokens allowed (1048576)" — and `parseContextWindowError` reads them the right way round. When a refusal states nothing (llama.cpp's "exceeds the available context size"), what is remembered is that *this* size did not fit. The memory (`createContextWindowMemory`, key `ai_context_windows`, one entry per model on one connection) is written by `callAI` the moment a `tooBig` failure comes back, and read before every call.
2. **Ask before sending.** `callAI` sizes every request (`requestChars`: the system prompt, every turn, the tool declarations; four characters a token) and hands the runner a `canAttempt(entry)`: an entry whose known window cannot take the request — after a 10% margin for the roughness of the estimate and room for the answer (`maxTokens`, else 4,096) — is passed over *without a request*, announced like any other switch ("cannot take a request this size"). Only when no entry can take it does the call fail, before anything was sent, with `nothingFitsMessage`: the size, every entry's reason, and which model to pick.

A refusal is classified `tooBig` by `classifyProviderFailure`, never retried, never walked down the ladder, and always carries `contextWindowMessage` whichever provider's words it came in. A time skip whose request fits no model **refuses rather than going canned** (`runJumpSegments`): canned events would hide the problem skip after skip and write themselves into the game's history. Every other task keeps its harmless "unavailable" fallback. What was learned expires — a stated limit after a month, a size merely seen to fail after a week — because providers raise limits and the player has no other way to clear it; `declare` (a limit the player sets) does not expire, though nothing in the UI sets one yet. Proven offline (`.lab/probes/context-preflight-probe.mjs`): the refusal costs exactly one request and is remembered from the model's own words; the next skip sends nothing and tells the player what to do.

Not built, on purpose: trimming the prompt to fit. The sections a skip carries are each there for a reason, the order to drop them in is a judgement per section, and a free-tier Gemini key — most players — has a million-token window. Section-by-section trimming waits for a real case.

### `customParams` — the request‑body escape hatch

Each provider has a free‑text `customParams` field: a JSON object shallow‑merged **last** into the outgoing request body (`parseCustomParams`, `main.jsx`). It lets a player set body fields the UI doesn't expose (reasoning budgets, sampling params) and can override a built‑in key. Invalid JSON is warned and ignored — never fatal to a turn. A nested built‑in object (e.g. Gemini `generationConfig`) must be supplied whole to override any of its keys. For Anthropic, a `max_tokens` inside `customParams` is lifted into the token‑cap `Math.max` and then deleted so it can't fight the floor (`main.jsx`).

### Per-task sampling temperature

The game used to set no sampling parameters at all, so every call ran at the provider default of 1.0. `src/Game/AI/sampling.js` (import-free, tested) is a table of task key to temperature, applied in every provider path by `temperatureBody(taskKey)`. Each value is set from what the task's own prompt asks for, not from its model tier.

| Band | Tasks | Why |
|---|---|---|
| **0.1** | `demandCheck`, `geographyResolver` | Classification and matching, where one answer is right and the rest are wrong: "you are recording, exactly, what the reply already says", "ONE job: translate ... you have NO authority to decide". |
| **0.2** | `eventConsolidator`, `gameMaster`, `projects`, `structureDirector`, `territoryDirector`, `timelineCurator`, `unitDirector` | Reconciliation and summary. Every one of these is told that changing nothing is a correct answer: "be conservative", "an empty projectOps list is normal", "inventing progress is worse than reporting none", "default verdict = KEEP". |
| **0.3** | `countryStatSheet`, `intelligenceAssessment`, `interactiveSummary` | Bounded estimation, where the model must supply what the record does not: "provide plausible estimates ... do not answer unknown", "where the record is silent use your best historical judgement". |
| **0.3** | `turnReview` | A compromise, because this one request carries five jobs: the four 0.2 reconcilers above plus the agents' reports, which are written prose (the `spyIntercept` template). |

**A task not in the table sends no temperature and runs exactly as it did before.** Absence means no deliberate choice was made, not 1.0. Left out on purpose, because they write prose someone reads in character: `jumpForward`, `autoJumpForward`, both world repairs, `pregameHistory`, both interactive tasks, `actions`, `idleDiplomacy`, `spyIntercept`, `chatActions`, `advisor`, `diplomacy`. `descriptionToAction` is out for the same reason despite its name: it is told to expand the player's own writing by half, match their tone, and "increase the quality and entertainment", which is creative writing rather than parsing.

**Where each provider takes it.** Gemini: `generationConfig.temperature`, in the same object as the thinking budget so setting either keeps the other. OpenAI and compatible: `temperature`, sent before `customParams` so a player's own still wins. Anthropic and compatible: `temperature`, but **only where extended thinking is not**, since the Messages API refuses the two together (`reasoning && !tool` is the existing gate). The Anthropic batch path has no thinking, so it always applies. The relay forwards a request body opaquely, so a relayed call carries it unchanged.

**When a model refuses it.** An OpenAI reasoning model takes only its own temperature ("Unsupported value: 'temperature' does not support 0.2 with this model"), and some gateways reject the parameter outright. `isTemperatureRefusal` (`providerErrors.js`) recognises that 400/422 and the call retries once without the field, ahead of the streaming and structured-output concessions: it is the cheapest of the three, because giving the temperature back leaves the call exactly as it ran before this existed. The concession only fires for a temperature the game set; one the player put in `customParams` survives and is theirs to fix.

**The refusal is remembered, per endpoint and model.** A reasoning model rejects every call that carries a temperature, so a concession scoped to one call would rediscover the same 400 forever, at one refused request each time, against the allowance the whole [request budget](#the-request-budget) exists to protect. This is the failure `structuredMode.js` was written about, and it was made again here before being caught. `createTemperatureMemory` (`sampling.js`, keyed by `temperatureRefusalKey({ provider, endpoint, model })`, stored under `ai_temperature_refusals`) holds what was learned, so `disableTemperature` starts true for a model already known to refuse and no request is spent. It is kept in memory as well as in localStorage, so a browser refusing storage still forgets only between sessions rather than between calls, and an entry goes stale after 30 days because a provider may change what it accepts.

**A key that names no task is silently inert**, which is the one way this table can be wrong without anything failing, so `sampling.test.js` checks every key against the prompt pack.

### Reasoning toggle

A single global toggle (`ai_reasoning_enabled` key) is read by `getReasoningEnabled()` (`providerConfig.js`). **On by default** — only an explicit `"0"` disables it, so a fresh install gets model reasoning without opting in. `callAI` honors it in every provider mode:

| Provider mode | Reasoning knob when ON | Source |
|---------------|------------------------|--------|
| Gemini | `generationConfig.thinkingConfig.thinkingBudget: 8192` | `main.jsx` |
| OpenAI / compatible | `reasoning_effort: "medium"` (sent in every mode incl. tool calls) | `main.jsx` |
| OpenAI compatible, local | additionally `enable_thinking: true` (Qwen3/Seed‑OSS local template key) | `main.jsx` |
| Anthropic / compatible | `thinking: { type: "enabled", budget_tokens: 4096 }` (only when **not** a tool call), `max_tokens` raised to fit | `main.jsx`, `main.jsx` |

If a provider rejects `tools` + `reasoning_effort` together (documented 400/422), the OpenAI‑style caller retries once with reasoning stripped (`disableToolReasoning`, `main.jsx`), then sends `reasoning_effort: "none"` in tool mode.

It is deliberately still **one global toggle**, not per task, and that is worth knowing before changing it: measured on Gemini, thinking is 60% of the jump's output budget but **83% of the consolidator's** — which is extraction, not invention. Making it per-task is a real and unclaimed win on the providers that report usage. It was left alone because the provider it would most obviously help (a hosted gateway with slow bookkeeping calls) reports no usage at all, so the change could not be verified there, and its "thinking" does not look like a budgeted channel — it deliberates in plain `content`.

### Per-task model routing

Ported from the abdulrahman-2005 fork. Every AI call names its task — the prompt-pack task key for `runJsonTask` calls (`jumpForward`, `timelineCurator`, `territoryDirector`…), the repair/briefing keys the direct calls pass, and `advisor` / `diplomacy` for the chats. A task with a pick (`getTaskPick(taskKey)`, `providerConfig.js`) tries that Fallback entry first, then the list from the top, so it only fails when every entry is used up; a task without one starts at the top. `AI_TASK_ROUTING` lists the tasks Settings → Advanced → **Per-task models** shows, each a choice among the list's entries.

### Connection templates and recent models

Settings → AI → Connections offers three templates (`CONNECTION_TEMPLATES`: Groq, OpenRouter, Local Ollama) — the old stock profiles — so a gateway key is one click and a paste away. `resolveModel` records the model each call actually ran with (`saveRecentModel`, ten per provider under `ai_recent_models_<provider>`), and every model field offers those, plus the Connection's suggested model, as datalist suggestions (`getRecentModels`).

### Prompt caching: the static prefix

Ported from the abdulrahman-2005 fork. `runJsonTask` renders a task template with `renderTemplateCached` (`src/Game/AI/promptLayout.js`, import-free): the boundary is the first placeholder in the template whose key is not in `STATIC_PROMPT_KEYS` (the game-lifetime constants — `language`, `playerPolity`, `worldBeforeRoundOne`, `simulationRules`, the difficulty guidance, `startDate`, `numberOfRegions` and the helper keys that alias them), so everything before it is byte-identical from one call to the next within a campaign. The runner keeps that prefix as text, and once the directives and the de-duplication have rewritten the prompt it passes `staticPrefixEnd: staticPrefixEndOf(systemPrompt, prefix)` to `callAI` (null if the prompt no longer opens with the prefix). `callAnthropic` and `callAnthropicCompatible` turn a usable boundary into two `system` content blocks via `buildAnthropicSystemContent` — the prefix carries `cache_control: { type: "ephemeral" }`, the per-turn tail is plain — and prompts with no boundary, or a prefix under `MIN_CACHEABLE_PREFIX_CHARS`, go out as the string they always were. OpenAI and Gemini cache identical prefixes implicitly, so the layout alone helps them. Measured on the stock pack, the jump templates keep about two thirds of their text ahead of the first per-turn placeholder; `promptLayout.test.js` asserts that share so a template edit cannot silently throw the cache away.

Not taken from the fork: its v2/v3 prompt packs (frozen copies of older prompts with the call-time directives baked in — beta's `promptDedupe.js` already skips a directive the template carries) and its slim repair prompt for jump retries (beta's second attempt is the last one before the canned fallback and its validators lean on the template's context).

### Batch background tasks (Anthropic, opt-in)

Ported from the abdulrahman-2005 fork behind **Settings → AI → Batch background AI tasks** (`MAP_SETTING_KEYS.batchBackgroundTasks`, off by default). With it on and Anthropic selected, a `runJsonTask` call made with `sync: false` and an `onBatchResult` applier is submitted to the Message Batches API instead (`submitAIBatch`, `main.jsx`; one request per batch, the same tool and system prompt as the live call) and returns `{ deferred: true }` at once. `pollPendingBatches` (`gameplay.js`, a one-minute timer while anything is in flight, skipped while a simulation runs) retrieves finished batches (`retrieveAIBatch`), runs the schema check and the task's `validatePayload` in final-attempt mode, and hands the payload — or the task's deterministic fallback — to the applier; an applier that returns `false` (a simulation started meanwhile) is retried on the next poll. The registry is in memory: a reload orphans an in-flight batch. The only task using it is the event consolidator: `compactHistoryIfNeeded` supplies an applier that writes the `consolidatedHistory` entry out of band, unless a synchronous consolidation covered those events in the meantime; the jump that asked for it simply carries on with the events unconsolidated.

### AI debug console and telemetry

Ported from the abdulrahman-2005 fork. `src/Game/AI/telemetry.js` (import-free) keeps one record per AI call: `callAI` opens it (`startAiRecord`: task key, provider, the full system prompt and user message, never clipped), the provider reports the resolved model (`onModel`), and the call closes it with the answer, usage (the `usageStats.js` shape), latency and time to first byte (`attachCallMetrics`, `finishAiRecord`). A `runJsonTask` call hands in `__debug` (attempt, simulated days) and `__debugSink`, and reports the validator's verdict afterwards (`attachAttemptOutcome`: ok, validation error, a `normalizeParsedSummary` count of events, transfers, control ops, wars, chats…) — the record counts as complete, and the rating toast fires, only then. Batch submissions get a record that the poller closes. Records live in a session buffer (500) and, while **Settings → AI → Record AI telemetry** is on (default), in IndexedDB `oh-debug-telemetry` (200 across sessions); keys never enter a record. **Settings → 📊 AI debug console** (`GameUI/debugConsole.jsx`, a lazy chunk mounted from `GameUI/main.jsx`) lists every generation with filters and full prompt/response review, aggregates tokens, latency and ratings per task and per model, and exports JSON/CSV or the world state, or clears the store. **Rate AI generations** (default off) shows `GameUI/generationRatingToast.jsx` — a 1-10 bar — after each time skip, Game Master edit and interactive event (`RATING_ELIGIBLE_TASKS`); ratings are stored on the record. Not taken: the fork's simulation-stage monitor (its overlay was never built) and its prompt-pack comparison tab (no packs on beta).

### Ranked event history and event category tags

Two more pieces ported from the abdulrahman-2005 fork. `buildEventHistoryText` (`promptContext.js`) no longer fills the recent-events window with a flat recency cut: `selectRankedEvents` scores each unconsolidated event by recency (a soft decay over about six months from the game date the callers now pass), importance (major 2.5x minor) and relevance (a transfer between polities absent from the map counts half), keeps the top `limit` and re-sorts them chronologically, so the text reads as before and only the selection changed; a consolidation pass that asks for every event is untouched (`server/eventHistoryRanking.test.js`). Events also carry model-emitted **category tags** — `tags` in the jump and pre-game event schemas, enum `EVENT_TAG_ENUM` (Military, Diplomacy, Economy, Politics, Culture, Disaster; up to three) from the import-free `src/runtime/eventTags.js`, normalized on the save by `normalizeEventTags`; the timeline's turn panel shows the categories present as filter chips and prefixes each event card's pills with them, and older events without tags are always shown. Not taken from the fork's region-resolution work: its offline city→region gazetteer and adjacency JSON (beta's geography resolver matches cities in region polygons at runtime for any map, and the region catalog already carries adjacencies), its identity/causal validation layers (the save-aware owner resolver and the capture guard cover them), and its advisory front assessment (the territory director resolves fronts deterministically).

### Lenient payload shapes

Ported from the abdulrahman-2005 fork. Before a jump answer reaches the schema, `runJsonTask` passes it through `normalizeGameplayPayload` (`gameplaySchemas.js`, import-free, `server/gameplaySchemas.test.js`): an envelope (`result`/`output`/`payload`/`data`) around the answer is unwrapped, a singular `event` or a `timeline`/`newEvents` list becomes `events`, `stop_date`/`overview`/`actionsResolved` and the event-level `occurredAt`/`headline`/`details`/`effects` synonyms map to their canonical keys, impacts doubled inside an `impacts`/`effects`/`changes` wrapper are flattened (array fields concatenated), impact aliases (`transfers`, `controlOps`, `claims`, `chats`, `projects`…) are renamed, and marker operations written as `create`/`found`/`destroy` or flat with `latitude`/`longitude`/`owner`/`type` are rewritten to the canonical `build`/`remove`/`rename` shapes. Nothing is invented: an answer without events still fails validation. The other fork leftovers were already covered on beta — `foldGeneratedChatsIntoStorage` merges a generated note into the existing bilateral channel, the leader prompt carries the other threads and the durable diplomatic memory, and a transfer's method is expressed by control ops versus legal transfers — so they were not ported.

---

## Where the key goes: direct calls, origin, and the relay

The whole security model is in the comment block at `main.jsx`. AI calls go **straight from the browser to the provider** so the player's key only ever reaches the provider — never an Open Historia server or a community node. Direct is always tried first.

- **`PAGE_IS_LOCAL`** (`main.jsx`, from `isLocallyServed()`): true when the page is served from a machine the player controls — `localhost`/`127.0.0.1`/`::1`/`*.local` or the LAN private ranges `10.*`, `192.168.*`, `172.16–31.*`. The LAN ranges cover the Android client, which loads the UI from a local server on the home network.
- **`providerFetch(url, options)`** (`main.jsx`): tries `directFetch`; on a CORS/network `TypeError` (not an abort) **and** only when `PAGE_IS_LOCAL`, it remembers the origin in `relayOnlyOrigins` and retries through the same‑origin `/api/ai/relay` (`relayFetch`, `main.jsx`). A remembered origin skips the doomed direct attempt on later calls.
- On a **hosted website** there is no relay: every call is direct‑only and the key is never handed to anything but the provider. If a hosted page tries to reach a **local** backend (Ollama/LM Studio) and the browser rejects it, `providerFetch` throws an actionable error telling the user to set `OLLAMA_ORIGINS`/enable CORS (`main.jsx`).
- **Who uses the relay**: only the `providerFetch` callers — `openai`, `openai-compatible`, `anthropic-compatible`, and model discovery (`GET /models`). **Native Gemini and native Anthropic bypass `providerFetch` entirely** (plain `fetch`), because both explicitly allow browser calls (Anthropic via the `anthropic-dangerous-direct-browser-access: true` header, `main.jsx`). They are therefore always direct, relay or not.

`isLocalEndpoint(url)` (`main.jsx`) is the per‑endpoint sibling of `PAGE_IS_LOCAL`; it also gates local streaming (below).

---

## Model resolution

`resolveModel(provider, opts)` (`main.jsx`) picks the model for a call:

1. A configured `model` in settings wins (Gemini strips a `models/` prefix).
2. Else the caller's `fallbackModel` (Gemini/Anthropic native/compatible defaults).
3. Else, if `providerSupportsModelDiscovery(provider)` (only `openai` and `openai-compatible`, `providerConfig.js`), `GET {endpoint}/models` and pick a likely chat model via `pickLikelyChatModel` (`main.jsx`) against `CHAT_MODEL_HINTS`/`NON_CHAT_MODEL_HINTS` (`main.jsx`). The discovered id is persisted back with `setProviderField`.
4. Else throw a "go to settings and enter a model/endpoint" error.

---

## Request flow: UI action → provider → applied world change

Two shapes of call sit on the transport.

### A. Structured gameplay task (the map‑changing path)

```
UI control (e.g. "Jump forward", GM console, "Suggest actions")
  → gameplay.js exported fn (simulateTimelineJump / applyGameMasterCommand / …)
     → readGameStateBundle() + buildTemplateVariables()      [read world/events/actions/chats]
     → runJsonTask(taskKey, { userMessage, variables, validatePayload, fallback, … })
        → renderTemplate(promptPack.tasks[taskKey], vars) + difficulty/agency/map-truth/reputation directives
        → tool = getGameplayTool(taskKey)
        → callAI(systemPrompt, [{role:user, parts:[{text:userMessage}]}], { tool, maxTokens:8192, deadline, signal })
           → per-provider caller → providerFetch/fetch → provider
        → parse (toolInput ?? extractJsonPayload) → validateGameplayPayload(schema) → validatePayload(strict|salvage)
        → up to 2 output attempts; else deterministic fallback() (or throw / propagate abort)
  → applySimulationResult() / applyEventImpactsToWorld() → writeWorldState/… + rollback snapshot
```

Every task entry point wraps itself in `beginSimulation()`/`endSimulation()` — a busy lock so the idle world pulse never writes chat or world state mid-jump. The pulse re-checks it at entry, after the model returns, and again immediately before each write.

### B. Free‑form chat (advisor / diplomacy)

`sendMessage` (`main.jsx`) and `sendDiplomaticMessage` (`main.jsx`) build a system prompt, push the user turn onto a module‑level history (`advisorHistory` / `diplomaticHistory`, compacted by `compactConversationHistory` at `main.jsx`), call `callAI` **without a `tool`** (plain text reply), and append the reply. On error the pushed user turn is popped so history isn't corrupted. `startChat`/`loadHistory`/`startDiplomaticChat`/`loadDiplomaticHistory` manage those histories. Diplomatic replies may carry a trailing `REACTION:<emoji>` line parsed off by `parseReaction` (`main.jsx`).

---

## Transport internals per provider

`callAI` (`main.jsx`) → one of five callers. Shared retry/abort machinery:

- **Retries**: `retries = 3`, `retryDelay = 15000` ms. Retried on `429`/`503` (Gemini treats `429` as fatal "quota exhausted", `main.jsx`). Guarded by `canRetryBeforeDeadline(deadline, retryDelay)` (`main.jsx`) so a retry that would overrun the deadline is not attempted.
- **Abort**: an `AbortSignal` (`signal`) propagates from `runJsonTask`'s controller through the caller to `fetch`/relay. An `AbortError` never triggers the relay fallback and never falls back to canned events (see [Cancellation](#cancellation--timeouts)).
- **Errors**: `readErrorPayload`/`extractErrorMessage` (`main.jsx`) surface the provider's own message.

### Structured output modes (per provider)

`callAI` passes `tool` (a `{ name, description, schema }` from `getGameplayTool`) for structured tasks. Each provider forces exactly that one tool:

| Provider | Forcing mechanism | Extractor |
|----------|-------------------|-----------|
| Gemini | `tools.functionDeclarations` + `toolConfig.functionCallingConfig.mode: "ANY"`, `allowedFunctionNames:[tool.name]`; schema stripped of `additionalProperties`/`$schema` via `toGeminiSchema` | `extractGeminiToolInput` |
| OpenAI / compatible | `tools:[{type:"function",…}]` + `tool_choice: "required"` (string form — llama.cpp servers reject the object form) | `extractOpenAIToolInput` |
| Anthropic / compatible | `tools:[{name,…,input_schema}]` + `tool_choice:{type:"tool",name}` | `extractAnthropicToolInput` |

### Lookup functions: the campaign behind function calls

Every structured task whose answer names powers, places or ledgers (`jumpForward`/`autoJumpForward`, `gameMaster`, `interactiveCreation`, `interactiveExecutor`, `actions`, `descriptionToAction`, `idleDiplomacy`, `unitDirector`, `territoryDirector`, `projects`, `pregameHistory`, `spyIntercept`, `geographyResolver`, `countryStatSheet`, `timelineCurator`, and the storyline repair call) declares twenty **lookup functions** (`LOOKUP_TOOLS`, `lookupTools.js`) beside its output function: the map (`list_powers`, `list_regions`, `find_region`, `region_info`, `map_around`, `border_between`, `find_city`, `list_cities`, `contested_regions`, `region_history`, `path_between`), the powers (`power_info`, `relations_between`, `war_ledger`, `spy_network`, `list_units`), and what is in motion (`recent_events`, `chat_history`, `storylines`, `list_projects`). Tasks that name nothing on the map (`eventConsolidator`, `interactiveSummary`, `intelligenceAssessment`) and the free-text advisor and diplomacy paths declare none; a task routed through the batch path runs no lookups. The model calls them to learn the exact names and ids it needs (the power names the map declares, one power's regions, a region by name whether exact, suffixed or a transliteration off, a region's neighbours and cities, the war ledger) and then calls the output function once. Nothing hands over the whole map: `list_powers` is names and counts, `list_regions` is one power paged at 300, `find_region` is at most eight candidates, and the local picture comes from `map_around` (one region and its surroundings grouped by owner) and `border_between` (where two powers touch), while the prompt keeps its ranked ownership overview. Every answer is built from the live campaign and the rendered catalog (`buildLookupContext` / `executeLookup`), and owner names are exact: asking for "Russia" on a map that only knows "Russian Federation" is an error that lists the real names. `LOOKUP_DIRECTIVE`, appended to the prompt by `runJsonTask`, tells the model to look a region up before writing any `regionTransfers` / `regionControlOps` / `regionClaims` entry. **Settings → AI → AI lookup functions** (on by default, `MAP_SETTING_KEYS.lookupFunctions`) turns the whole mechanism off: `buildTaskLookups` then declares nothing and `buildTemplateVariables` builds the full prompt, region lists included.

**The mechanism is also off whenever requests are being saved, which is the default** ([the request budget](#the-request-budget)): `lookupFunctionsEnabled()` is `!savingRequests() && <the toggle>`. A lookup round is a whole extra request — the entire prompt goes out again — and the round budget is per task and per attempt, so a skip with its passes was measured at 23 requests where a player expected three. The full prompt costs more characters and no extra request, which is the right way round on a free key. Where a task needs a name it would have looked up, the engine reads it out beforehand instead: `placesNamedIn(context, text)` (`lookupTools.js`) finds every region and city a text names — whole words, accents folded, longest name first, nothing of three letters or fewer — and returns each with its controller, its lawful owner where that differs, and its claimants. The territory director is handed that for its candidate events (`placesTheseEventsName`), because the controller is what it writes into `fromCode`.

The loop lives in `callAI` (`runWithLookups`, `main.jsx`). `runJsonTask` passes `lookups: { tools, execute, maxRounds? }`, built per call by `buildTaskLookups` (`gameplay.js`) lazily from the bundle the task is shown, so prompt and lookups never disagree. Each provider receives the lookups as extra tool declarations (`lookupTools`); when the model answers with lookup calls instead of the output tool, the provider returns `{ lookupCalls }`, `callAI` executes them, appends a round to the conversation (`appendLookupRound`, `toolTurns.js`: a model turn of `functionCall` parts and a user turn of `functionResponse` parts, rendered per provider by `geminiContentsFromHistory` / `openAiMessagesFromHistory` / `anthropicMessagesFromHistory`) and asks again. After `maxRounds` (default 3, `DEFAULT_LOOKUP_ROUNDS` in `main.jsx`) the final request forces the output function (`requireOutputTool`). Parallel calls in one turn work on all three wire formats (the OpenAI stream reader keeps every `tool_calls` index). Each round restarts the task's first-byte window, since the prompt is evaluated again; the system prompt is byte-identical across rounds, so a cached prefix pays off.

| Provider | Declaration | While lookups are allowed | Final round | Reader |
|----------|-------------|---------------------------|-------------|--------|
| Gemini | `functionDeclarations: [output, ...lookups]` | `mode:"ANY"`, `allowedFunctionNames`: all | `allowedFunctionNames: [output]` | `lookupCallsFromGemini` |
| OpenAI / compatible | `tools: [output, ...lookups]` | `tool_choice: "required"` | only the output tool declared | `lookupCallsFromOpenAI` |
| Anthropic / compatible | `tools: [output, ...lookups]` | `tool_choice: {type:"any"}` | `tool_choice: {type:"tool", name}` | `lookupCallsFromAnthropic` |

Every round is tracked: `callAI` attaches each call (name, arguments, the whole answer, milliseconds) to the telemetry record (`attachLookupRound`, shown in the AI debug console as a **Function calls** section, a lookups card and a per-task column, and exported in the CSV as `lookupRounds` / `lookupCalls` / `lookupNames`), sums the usage of all rounds into the record (`sumUsage`), and writes one diagnostics-log line per round (`ai-call`: the calls with their arguments and how many characters each was answered) with the full arguments and answers as a detailed-mode entry.

**Who is asking.** Three of the functions answer from material a government keeps to itself: `chat_history` (the player's correspondence), `spy_network` (every agent in the world) and `list_projects` (covert operations included). `buildLookupContext` therefore takes an `audience` (`audience.js`), and `buildTaskLookups` passes one. The **narrator** is the default, because every task that carries lookups today is the narrator — the jump, the directors, the game master — and its answers are unchanged to the byte. A **viewer** is answered only what it could know: a conversation it was not in is reported exactly as one that never happened (saying "you may not read that" would itself tell a government that the player is talking to someone, and to whom); a service sees its own agents — a turned or discovered one still reading as `active`, its cover story never labelled as one — and only the foreign agents it has actually caught; a `public` programme is whole, a `restricted` one is only the fact that it exists, a `covert` one is absent, and the count matches what is shown so a hidden entry cannot be inferred from it. **A surface that speaks AS a polity and carries lookups must pass a viewer**; until this existed that combination would have let a leader read the player's letters to everyone else through a function call. `idleDiplomacy` is still shown every chat in its prompt and held back only by prose (`[What the Sender Knows]`): choosing the sender before building what it may read is a change to how the pulse works, and belongs with the diplomacy rework rather than here.

Tests: `server/lookupTools.test.js`, `src/Game/AI/lookupAudience.test.js`, `src/Game/AI/audience.test.js`, `server/toolTurns.test.js`, `src/Game/AI/streamAssembly.test.js`, `src/Game/AI/telemetry.test.js`, `src/Game/AI/usageStats.test.js`.

### The structured-output ladder

**Forcing a tool is a request, not a guarantee.** A first-party API enforces it; an arbitrary gateway may accept `tool_choice: "required"` and then let the model answer in prose. That is not hypothetical — a hosted NVIDIA endpoint did exactly this, and a model that reasons well spent three minutes writing a *correct plan* and never emitted the call. Three turns in four fell back to canned events.

So the OpenAI-style caller walks a ladder, strongest first (`STRUCTURED_MODES`, `structuredMode.js`):

```
tool → json_schema → json_object → text_json
```

- `tool` — the provider enforces the schema.
- `json_schema` / `json_object` — `response_format`, provider-validated or loosely so.
- `text_json` — the schema inlined into the system prompt, enforced by nothing. Carries `ANSWER_SENTINEL` (`jsonSalvage.js`), a literal marker the model must write before the payload, which both forces a stop to the deliberating and gives `extractJsonPayload` an unambiguous cut point.

It steps down on **two** signals: an HTTP 400/422 refusing the mode, and — added later — a 200 that carries **no tool call and a planning monologue** (`looksLikeDeliberation`, `providerErrors.js`). The second matters because the failure arrives as a perfectly good response, so nothing else would notice. A step down does **not** consume one of `runJsonTask`'s two output attempts.

Anthropic-compatible has the same problem (it is also an arbitrary proxy) and a two-rung version of the ladder, `tool → text_json`: the Messages API has no `response_format`. Native OpenAI, Anthropic and Gemini honour their own contracts and have no ladder.

**Where a call starts** is the Fallback entry's `structuredMode` — per entry, because the evidence is about one model on one endpoint, `auto` by default. `auto` starts at `tool`; anything else names a rung to begin at, skipping ones a gateway has already been shown to ignore. It is a starting point, never a lock: the ladder still steps down from wherever it starts, so a setting chosen months ago cannot strand a campaign. Changing the entry's **model** resets it to `auto` (`updateEntry`). The observer's evidence is keyed by entry id.

The setting is **offered, never inferred**: `createModeObserver` records where calls land, and after two consistent sightings the UI asks whether to start there in future. Silently remembering was considered and rejected — one unrelated failure would demote every later call out of the strongest channel, invisibly.

### Streaming vs buffered

**Every request streams** unless a gateway has refused to (`streamThisRequest = !streamingDisabled`). The reason is keep-alive, not rendering: a buffered request sends zero bytes for the whole generation, which is indistinguishable from a dead one, and a gateway closes it. The original field report was a 502 at exactly 301.7s on a healthy endpoint.

Diplomatic chat was the last buffered path — the only call with neither a `tool` nor an `onChunk` — and failed on precisely this: an endpoint 502'd every leader reply after ~38s of silence, while the **advisor**, a *bigger* prompt on the same endpoint, worked fine because it renders tokens and therefore streamed.

Gemini still picks its stream URL only when there is a tool or an `onChunk`; a plain buffered Gemini chat remains possible. It has never shown this failure, being first-party.

The response is always branched on the **actual** `content-type`, not on what was asked, so a gateway that ignores the request still works: `text/event-stream` → the matching reader in `streamAssembly.js`, else `response.json()`. Each reader rebuilds that provider's normal envelope, including its `usage` block, so the extractors and the telemetry work unchanged.

### Retries and what counts as transient

`retries = 3`, `retryDelay = 15000` ms, bounded by `canRetryBeforeDeadline`.

`RETRYABLE_HTTP_STATUSES` is **429, 502, 503, 504**. 502 and 504 are there because a proxy having a bad moment is exactly as temporary as a 503, and `providerErrors.js` has always treated all four as "busy" when they arrive inside a stream — the status code now agrees with the stream frame. Before that, an identical 502 got three attempts as a frame and zero as a status.

**Gemini's 429 is handled separately and first**, because it is two different situations wearing one status code: a per-minute rate limit (waiting fixes it — the common case on a free tier) versus a spent daily allowance or balance (waiting cannot). `isQuotaExhaustedPayload` tells them apart and defaults to *retryable*, since a wrong guess costs one request while the opposite costs a turn. `retryDelayMsFromPayload` honours Google's own `RetryInfo` when present. Before this, one per-minute trip on a free-tier key destroyed the turn.

### maxTokens / token-cap semantics

Structured tasks pass **no `maxTokens` at all**, so they run at the provider's maximum. Only the advisor caps, at 8192.

| Provider | Body field | Notes |
|----------|-----------|-------|
| Gemini | `maxOutputTokens` | sent for chat; **omitted entirely on the tool path** |
| OpenAI | `max_completion_tokens` | only when a cap was passed |
| OpenAI compatible | `max_tokens` | only when a cap was passed |
| Anthropic / compatible | `max_tokens` (required) | derived from the model ceiling, learned from a prior 400, and raised to clear the thinking budget |

### Usage and timing telemetry

`usageStats.js` normalizes each provider's reporting into `{ promptTokens, outputTokens, totalTokens, cachedTokens, thinkingTokens }`, and `createFirstByteTimer` derives TTFB from the activity signal the stream readers already emit. Both are logged by `callAI` in detailed mode, and **omitted rather than zeroed** when a provider reports nothing — several gateways report no usage at all.

Anthropic's `cache_read_input_tokens` and `cache_creation_input_tokens` are added into `promptTokens`, since `input_tokens` excludes both. Gemini's `thoughtsTokenCount` is counted as output, since it is billed as output and a reasoning model spends most of its budget there.


## The request budget

Most players bring a free Gemini key. On that tier tokens are close to free and **requests** are what run out — a few hundred a day, a handful a minute — so the yardstick for every AI feature is how many requests a player action costs, not how long its prompt is. `requestBudget.js` holds the rules (import-free, tested under bare node); `main.jsx` and `gameplay.js` apply them.

**The ledger.** Every provider response is one request, whatever became of it: a lookup round, a retry, a refusal. It is counted where it happens — each provider path calls `onRequest(response.status)` straight after its `fetch`, and `callAI` turns that into `requestLedger.note({ status, kind, taskKey })` — because one `callAI` can be many requests. A 2xx is `used`; a 429 is `refused` (a wait, not allowance); anything else is `failed`. The day is Google's: it turns over at midnight Pacific (`nextPacificMidnight`), since that is the allowance nearly every player is counting against. The ledger lives in localStorage (`ai_request_ledger`), announces changes as the window event `ai:request-budget`, and is what the time panel's caption, **Settings → AI → AI requests** and the Logging file's *AI requests* block all read.

**The switches** (Settings → AI → AI requests; all in localStorage):

| Setting | Key | Default | Effect |
|---|---|---|---|
| Save AI requests | `ai_save_requests` | **on** | Everything below the table. Off restores the pipeline exactly as it was: lookups, strict-then-retry, one request per check, one per agent. |
| Requests a day your key allows | `ai_daily_request_limit` | 500 | The denominator of the count, and the reserve background AI keeps clear of. The game never stops a call at the limit; the provider does. |
| Background AI | `ai_background_activity` | **on** | Whether anything may call the model with nobody pressing a button. Absent means on; only an explicit `"0"` turns it off. |
| Background requests a day, at most | `ai_background_daily_cap` | 30 | The most it may spend in a day. It also stops while less than a tenth of the day is left (`BACKGROUND_RESERVE_SHARE`). |
| Checks after a time skip ×5 | `ai_review_units` / `_territory` / `_timeline` / `_board` / `_spies` | on | Which jobs the turn review may carry. |

**What saving changes.** A time skip is one request where it can be and never more than `JUMP_REQUEST_CAP` (3; a skip the player chose to generate in segments pays one per segment, and the cap moves with it — `jumpRequestCap`).

1. *No lookup rounds.* See above; names are handed over, not asked for.
2. *The first answer is judged the way the last one always was.* `runJsonTask` sets `lastChance` on attempt 1, so the task validator repairs the answer in place (`finalAttempt: true`) instead of sending it back, and a fault the schema can point at is cut out by `salvageBySchema` rather than failing the whole answer. A second request is made only when there is nothing usable to keep. The model still learns what was dropped or changed — that is what the [application receipt](#the-application-receipt-what-salvage-did-told-to-the-next-turn) is for — it just does not cost the player a request to say so. (Schema salvage also runs on the final attempt with saving off: a finished turn should never lose to the canned fallback over one malformed op.)
3. *The checks after a skip are one request, or none.* See [the turn review](#the-turn-review-every-check-after-a-skip-in-one-request).
4. *No second searches.* The storyline-motion repair settles every issue as skipped (exactly a failed repair: the copy-forward is withdrawn and the storyline stays overdue for the next skip), and the post-curation breadth repair does not run.
5. *The rest asks the skip's budget first.* `createJumpRequests` gives a skip a budget (`createJumpBudget`) and a counter; `jumpTaskOptions(requests, spender)` threads both into every `runJsonTask` the skip makes. Spenders in the order they run: `jump`, `jumpRetry`, `geography` (the place-name resolver, which in saving mode takes every unresolved place of the turn in one batch of up to 18 instead of batches of 6), `review`, `history`, `stats`. A refused task ends the way a failed one would — its fallback, or an earlier answer salvaged. **History consolidation asks the budget *before* the task starts**, because a refused task falls back to its deterministic digest and folding history with a digest is permanent; refused, the fold simply waits for the next skip. `reportJumpRequests` writes what the skip cost to the ledger (`lastJump`) and to the turn log, including anything left out to stay inside the cap.

**Background AI** is anything the game would do with nobody pressing a button, and all of it asks `backgroundAiAllowance()` first and marks its calls `requestKind: BACKGROUND_REQUEST`: the idle pulse (`maybeSendIdleDiplomacy` — which used to roll one chance in four every visible minute *even with idle diplomacy switched off for the game*, because its movement half ran regardless: about fifteen model calls an hour from a player reading the map; it now runs at the feature's own cadence and not at all with the feature off), the timed agent report (`maybeGatherIntelligence`), and the fire-and-forget first readings (`ensureCountryAssessed` and friends, triggered by opening the Spies tab, reading an intercept or deploying an agent — up to two requests the player never asked for). The Event Editor's NPC reaction and the Stats pane's own sheet are the player's explicit actions and are not background.

Measured offline on the built-in scenario with a stand-in model that answers every task at once and never asks a lookup (`.lab/probes/request-count.mjs`): a skip costs **1** request when nothing needs checking and **2** when something does, against a floor of **10–12** with saving off — and the live figure with saving off, lookups and retries included, was 23 answered plus 5 refused.

### The turn review: every check after a skip in one request

After a skip the game checks five things, and each used to be a request of its own (one *per agent* for the last): the unit director, the territory director, the timeline curator, the Projects board, and the agents' reports. The jobs do not depend on each other's **answers**, only on the same events, so while requests are being saved they go out together (`runTurnReview`, `gameplay.js`; the text-and-data half is `turnReview.js`).

- **Nothing here decides what a check does.** Each job is built from the input its own native director would have sent — `buildUnitDirectorInput`, `buildTerritoryDirectorInput`, `buildCuratorInput`, the board's event list, `prepareSpyReport` — and rendered by `buildTaskSystemPrompt(taskKey, …)`, the prompt assembly lifted out of `runJsonTask`, so a job is shown exactly the prompt its own request would have carried (a scenario's custom template included). Each part of the answer is validated by its own job's schema, repaired by `salvageBySchema`, and then handed to that same director in place of the request it would have made. A part that is missing or malformed is that director's ordinary "analysis unavailable" case, and costs the other parts nothing.
- **One prompt, fenced.** `buildTurnReviewPrompt` puts each job between a BEGINNING and an END line and opens with the rules that make that safe: everything inside a fence belongs to that job alone (two jobs may number the same events differently), and where a job's own text says "return JSON" or "use the required tool", that describes the content of its field. `buildTurnReviewTool` is one output function, `submit_turn_review`, with one required field per job, each carrying that job's own schema (together well inside the jump's schema-size guard, see [AI schemas](ai-schemas.md#45-bis-projectopschema--one-object-discriminated-by-op)). `shareRepeatedBlocks` sends a long block several jobs carry verbatim — the simulation rules, the world snapshot — once, with a pointer in the later jobs.
- **Whether to ask at all is decided first, natively, per check.** Units and territory: the director found events it would ask about. Timeline: `candidatesWorthJudging` (`nativeTimelineCurator.js`) — an event can only be removed if it has no hard consequence and either resembles retrieved history above the similarity floors, carries the routine-military cue without a concrete consequence, or has a process frame; a candidate that meets none of those is kept whatever the analyst says. (Two model-only routes are knowingly given up *as reasons to ask*, and pinned by test.) Board: `boardPassReasons` (`runtime/projects.js`) — an event names or describes an open entry, an event reads like the start of a long effort, or the calendar is due (overdue, a slipped milestone, no report for `STALE_ROUNDS`, a HIGH PRIORITY entry) and the board has been left alone for `BOARD_PASS_QUIET_ROUNDS`, counted from the entry's own update and from `world.boardReviewedRound`. Agents: one placed since the last skip that has never reported (once), or a report three rounds old on a collection round — bounded by the calendar, never by whether the last attempt worked. **No reason from any of them means no request.** When there is a reason, every enabled check with something to look at rides along: it is the same request either way.
- **The board's event numbers.** The board job is shown the events as the skip *wrote* them, but its ops are applied after the timeline job's verdicts. `remapBoardOps` moves each op's `eventIndex` onto the list the turn ended with — kept events under their permanent ids, events taken off the timeline but still true as Hidden events — and drops an op whose event was withheld altogether. The board job sees the pre-turn board and not this turn's espionage events; the native covert-operation sync still runs before its ops are applied.
- **It never holds the turn.** With saving off a failed board call holds the turn for a retry; here the only way to un-hold it would be another request, so no board part means the board does not move this turn.
- Agents' reports are filed after the turn is written (`fileReviewedAgentReports`), and only for agents still in place: one caught this turn did not get a report out.

## World direction: what an author sets as numbers

A scenario can already tell the simulator how to run its world in prose — the simulation rules, the prompt editor. Prose is a request. World direction is the other half: a few settings an author sets as **numbers the engine reads and enforces**. It is an entry of the feature registry (`server/gameFeatures.js`, `worldDirection`), so it has the registry's whole shape for free: a scenario carries the complete configuration, a game carries only what it overrides, both editors render it from the definition, and `getActiveWorldDirection()` (`src/runtime/gameFeatures.js`) is `null` when it is switched off. The registry gained one thing for it: a setting may be `type: "text"` (trimmed, line endings normalised, bounded by `maxLength`; a game's blank follows the scenario, exactly as a blank number does).

| Setting | Default | What the engine does with it |
|---|---|---|
| Pace (`eventPace`, 40–250%) | 100 | `scaleEventRange` scales the period's event range **before** the queued orders raise the floor (`segmentEventRange(…, { pace })`) — an author who wants a sparse chronicle still owes the player a slot per order. The scaled range is what the skip asks for, what its validator checks, and the breadth repair's ceiling. A single-number range (a skip of a few hours is exactly one event) is never scaled. |
| The world's share (`worldShare`, 0–80%) | 35 | `worldShareShortfall` counts the events that are not the player's — one the simulator marks `playerRelated`, or whose own words name the player's polity as whole words, so under-declaring does not get past the count. Not applied below three events; `0` turns it off. The template has said "about a third" in prose since Phase 1A; this is that sentence, counted. |
| Priority rules (`priorityRules`, text) | none | `buildWorldDirectionDirective` writes them **last** in the jump's system prompt, after every other directive, under a heading that says they outrank the default guidance, the simulation rules, *and anything a field description of the output function suggests is possible* — without that last clause a rule like "no nuclear weapons before 1945" loses to a schema that lists them as a thing a polity can start. |
| Scripted events (`scriptedEvents`, text) | none | The author's history beats, one per line: the date first (`YYYY-MM-DD`, a year before AD 1 with a leading minus), then what happens in the author's words; a `#` line or a line without a date is ignored (`parseScriptedEvents`). The skip whose span covers a beat's date (`scriptedBeatsInSpan`: after the origin day, up to the target — the game's first skip covers its origin day too) is told the beat in its user message beside the receipt (`buildScriptedEventsInstruction`), and the event range grows so each beat has a slot. After the answer, `beatIsWritten` looks for an event within a week of the date sharing enough of the beat's particular words; **a beat the answer left out is written by the engine** (`ensureScriptedEvents`: the author's words, on the author's date, `kind: "world"`, `notable`, no impacts) and the receipt tells the simulator to carry its consequences. An auto jump that stopped short owes only the beats up to where it stopped. Never a rejection: an author's beat does not depend on the model's mood, and asking again is a request. |
| The map's tempo (`territoryTempo`, 0–60 regions per 30 days) | 0 (off) | `applyTerritoryTempo` counts a skip's `regionTransfers` and `regionControlOps` *control* entries in event order (a contest opened or cleared moves nothing; a `wholeCountry` entry is the whole allowance) against `territoryTempoAllowance` (the ceiling scaled to the period, never below one) and **withholds** the rest before the geography resolver spends anything on them, with a `withheld` receipt note that says the front moves this far and to carry the rest on. The directive states the number for the period. |

**None of it costs a request**, which is what makes it safe to default on. Each setting shapes the one request a skip already makes. A skip that falls short of the pace or the share is **kept** on every attempt, in both modes — a lopsided period is still a period — and the simulator is told at the top of its next turn through the receipt's `short` note. Proven offline (`.lab/probes/direction-probe.mjs`): at pace 40 a month asks for "between 2 and 3" events, the instructions end with the author's rule, a skip that gave the world one event in four is kept with both notes on its receipt; a scripted beat the stand-in left out is on the timeline in the author's words with a note; of two captures against a tempo of one, one is withheld with a note; and the direction itself cost nothing (the captures earned the one after-skip review).

Scripted events are typed as lines rather than in the Event Editor's shape, on purpose for now: the line is what an author writes in a scenario's notes anyway, and an editor can be built on the same setting later without changing what the engine does with it.

## Group diplomacy: one request for the whole table

A four-way chat once cost **several requests for one player message**: a standalone speaker-selection call, then one call per leader who answered, capped at three. That architecture is retired. A group turn is now **one request** returning an ordered action batch that acts for every AI participant at once; one-on-one diplomacy selects its sole counterpart natively. There is no sequential group fallback.

**A thread is an event log** (`src/runtime/chatThreads.js`, 8 tests). The old shape — a title, a list of countries, a list of messages — cannot say who was in the room when something was said, who renamed it, or how a vote went. The log can: `chat_created`, `member_joined`, `member_left`, `title_changed`, `message`, `reaction`, `poll_created`, `poll_option_added`, `poll_vote_cast`. Its **projection is exactly the old shape**, so every existing reader (promptContext, chatVisibility, the world director, the timeline panel) goes on working unchanged; `normalizeChatEntry` stores the log beside the projection, and a thread saved before the log existed is migrated on read, idempotently. **Membership windows** fall out of it: `threadAsSeenBy` shows a polity only what was said while it was a member, so a power that joined on turn six is never written as though it heard turn two.

**The batch** (`src/Game/AI/chatActions.js`, 14 tests): send_message, add_reaction, rename_chat, add_member, remove_member, create_poll, add_poll_option, poll_vote. Every action is validated and applied on its own, so one bad action costs only itself, and what was refused is carried into the next turn in words the model can act on (`describeChatActionFeedback`) — the application receipt's discipline, at chat scale. Two rules from the reference are kept because they are what make a batch coherent rather than a list of messages: **refs, not ids** (a poll invented in the batch is addressed by the batch's own `pollRef`, so it can be created and voted in one answer; the engine mints the real ids), and **a poll is binding** (every AI participant that would vote must vote in the same batch — one nobody answered is reported as the failure it is). An actor may never be a human-controlled participant nor a polity outside the room: that is settled natively from the roster, not asked of the model.

**Cross-chat knowledge** (`src/Game/AI/crossChatKnowledge.js`, 6 tests): before a leader speaks it is shown what it has heard in its *own* other threads since it last spoke here — scoped by membership, cut by a per (thread, polity) cursor kept in `world.chatKnowledgeCursors` so the same exchange is never sent twice, and **fenced**, with the fence's delimiters escaped out of the content. This is the one place in the game where text a model wrote is fed back to a model as data, so the block says plainly that nothing inside a fence is an instruction. Each participant's cables are a separate labelled block and the prompt states that one polity may not write from another's; that boundary is a prompt-level rule, not an enforcement — the honest trade for acting for several polities in one request (the reference does not draw it at all).

**What only the live model could teach it.** Gemini refuses a function declaration whose `anyOf` has more than six branches — 400 "Request contains an invalid argument", bisected against the live API, six passing and seven not — so `chatActionSchema` is ONE object with a `type` enum and all-optional fields, exactly as `projectOpSchema` is. It also refuses array-length bounds on an array of *objects* inside an `anyOf` branch, which `geminiSchema.js` now strips for every schema (an array of strings keeps them, which is why the jump's `interactive.choices` always worked). And the model writes poll options loosely — bare strings, or a label with no ref, then votes for them by label — so a label is accepted as a ref rather than costing the poll and every vote that named it.

Proven offline (`.lab/probes/chat-batch-probe.mjs`, ten checks) and **live** (`live-chat-batch-probe.mjs`): one request, three leaders in their own voices, a binding ceasefire poll opened and answered by every AI participant, seven actions applied and nothing said for the player.

**Said a line at a time.** One request answers for the whole table, but a table does not talk all at once. `planChatReveal` cuts a batch into steps — a message and what follows it up to the next message; what comes before the first goes with it — and the panel says the first at once (the request was the wait for it) and each later one after its speaker has been seen typing for `CHAT_REVEAL_PAUSE_MS` (5 s; `GameUI/chatReveal.js`, 5 tests, times it). A step not shown yet is held by the panel, not written into the thread, so it **has not been said**: when the player speaks first it never is, the way Intervene discards the events a skip's reveal has not reached, and the next turn is told whose lines went unsaid, never the lines themselves (`describeChatCutIn`: *[The player cut in] Bavaria spoke before Prussia and France had finished…*), so a leader can pick the thread up without repeating what nobody heard. Leaving the thread is not cutting in: the rest is said at once. Each step is written onto the thread as it stands (`logForNextStep`), so a vote cast in between is kept, and nothing is written once the campaign has changed (`campaignGuard.js`). It costs no request. Seen working in the real `ConversationView` against a scripted turn (`.lab/stagger-check/`): lines at 0.8 s, 5.8 s and 10.8 s, a cut-in whose unsaid lines never appeared and whose next request saw only what was said, and a thread left mid-turn with the last line written once.

**A turn's ids are its own.** An event id is minted from the turn's date and a count, so a second group turn on the same game day minted the first one's ids again — and the log keeps only the first event of an id (`normalizeChatEvents`), so that turn's replies vanished from the thread, and a reaction meant for one landed on the old line. `runChatActionBatch` now hands `applyChatActionBatch` the ids the log already holds (`takenIds`), and a taken one is skipped.

One request writes every participant, so the whole thread is in front of the model — including what was said before a newcomer came in. A line some present participant did not hear is marked `(not heard by …)` from the log's own `heardBy`, and the transcript says what that means; what a newcomer does bring is its own other threads, capped at four threads of eight lines each — the budgeted prior knowledge of a polity just brought in.

**Messages written beside the log are folded into it** (`withUnloggedMessages`, chatThreads.js). The log is the truth of a thread, so `normalizeChatEntry` projected messages from it alone — and every writer that still wrote `messages` (the one-on-one panel, the rotation fallback, a note a turn folds into an open thread, the player's own line before a group turn) lost its message on the next read once a thread had a log. The second one-request group turn dropped the very line the player had just sent. Such messages are now appended to the log in order, recognised by id or by speaker and words (idempotent: an id-less one gets an id from its content); error bubbles, the panel's own, never enter it.

## Conversations: one copy, a stable prefix, and a catch-up note

The advisor and a leader are real conversations — a system prompt rebuilt from the present on every message, then the exchange so far as the turns. They were sent **twice**: the templates also rendered the transcript into the system prompt (`ALL_ADVISOR_MESSAGES`, `THIS_CHAT_HISTORY`, and a leader's own thread a third time in the digest of its chats). Worse than the size, the copy sat near the end of the system prompt, so everything after it — the advisor's ~40 K of directives — changed with every message and no provider's prefix cache could reuse any of it. Now the turns are the only copy (`CONVERSATION_IN_TURNS`, [prompts §3b](ai-prompts.md#3b-advisor--leader-path-mainjsx)). On the Fault Lines save with a 12-exchange transcript (`.lab/probes/conversation-anatomy.mjs`):

| | before | after | system prompt identical to the previous message's |
|---|---|---|---|
| advisor message | 124.4 K | 103.7 K | 59% → **100%** |
| leader message | 70.2 K | 67.3 K | 88% → **100%** |

No other passage of 200+ characters is sent twice in these requests or in a jump request (`jump-repeats.mjs`) — which is why the reference's per-fact fingerprints are not built: they earn their keep where knowledge is delivered into a transcript once and must be re-sent when edited, and here the state is re-rendered on every call (an edit is simply what the next call says), while the one incremental channel, cross-chat knowledge, is append-only and already cursored.

What the rebuilt system prompt cannot say is **what is new since the conversation last spoke**. The advisor's earlier replies sit in the turns undated, written before a month of events it cannot tell apart from the ones it discussed. So the advisor panel writes a **catch-up note** onto the player's next question when the world moved on (`conversationCatchUp.js`): what became of the advisor's own last reply (a chart the panel could not draw, an actions block whose removal matched nothing, a projects block cut short — the receipt it was never given), the span and the newest few events since (titles only; the record is already in the prompt), and the Game Master's changes by hand. It is stored on the message and sent with it again after a reload; an unchanged world adds nothing. Live, the advisor opened its next answer with the change it was told of.

**A leader gets one too.** A thread with a foreign government can sit for months of game time; its turns say nothing of the invasion, the annexation or the renamed republic in between. When the player writes into it after the world moved on, the chat panel builds a note from the moment the player is writing from (the events shown, never an unrevealed one) against the thread's last dated line (`buildThreadCatchUp`): the span, the newest few events on the public record since, the borders those events moved and the polities they renamed, founded or dissolved, and — in a group — the votes cast in the thread since the player's last turn. It rides ahead of the player's words (`withCatchUp`), one-to-one (`sendDiplomaticMessage({ catchUp })`) and in the group batch (`runChatActionBatch({ catchUp })`, one request as ever), and is stored on the player's message (`catchUp`, `catchUpLabel`, kept through the chat normalizers and the thread log) so a reload, a retry or the next reply sends the same words. The bubble shows it as one small line ("⏳ Since 1 December 2015 · 3 events · 1 border change") with the whole note on hover. Only what is public is in it: what a leader heard elsewhere is cross-chat knowledge, and a secret is a report. Proven offline in `.lab/probes/phase6-probe.mjs` (the note ahead of the player's line in both paths).

## The Game Master's hand: changes made outside the simulation, and standing reminders

The cheats panel changes the world between turns — a country annexed, a border redrawn region by region, a polity's figures set by hand, a city placed, an event written into the record, the history document rewritten, a turn rolled back — and the GM console makes AI-assisted transactions. The console's were logged in `world.gmAudit`; the rest nowhere. The next skip saw the new state with no word of how it came about, and a model shown an unexplained change tends to explain it, or undo it.

Every such change is now one line in `world.gmChanges` (`src/runtime/gmChanges.js`, 10 tests), tagged with the round it was made in — each cheats tool records its own sentence after its save succeeds (a failed note never costs the edit), and a change made in steps is one growing line ("Moved Crimea, Sevastopol and 4 more to …"). The skip that starts from that round opens with `[CHANGES MADE OUTSIDE THE SIMULATION SINCE YOUR LAST TURN]`, beside the receipt: canon, acts of authority not events, not to be undone or written up again. Told once, because the round moves on when the skip lands; told again after a rollback, because the skip that heard them no longer happened. The advisor's catch-up note carries them too.

**Reminders** are the GM's standing facts ("the Kerch bridge is down") — dated, a short list, edited or withdrawn in the cheats panel's *Simulation Reminders* tool. Every prompt that writes the world or speaks for a polity ends with the whole list (after the author's priority rules: a fact declared mid-game is newer than any rule written before it), the turn review once for all its jobs, the advisor and every leader too. Because every call carries the list, an edit is simply what the next call says. Withdrawing one is itself a change, so the next skip is told the fact no longer holds. Every AI sees every reminder — a secret belongs in a report, which has an audience.

Proven offline (`.lab/probes/gm-changes-probe.mjs`, eleven checks) and live: a region annexed by hand before a skip stayed annexed, and nothing in the skip contradicted the reminder. None of it costs a request.

## The phases of a skip

A skip is several pieces of work — reading the world, writing the events, the one review request, placing the armies and fronts, the board, the history, writing the record — and the panel said "Simulating…" for all of it. `src/Game/AI/skipPhases.js` (7 tests): the skip enters each phase by name as it starts; the time panel shows the phase's own words ("Writing 1 month of events… (part 2 of 3)", "Moving the armies, redrawing the fronts and hearing from 2 agents…" — the review described by the jobs it carries), auto-jump included; and when the skip lands the log gets one line of where the time and the requests went, counted from the skip's own budget — of this form:

```
Time skip phases: 25.8 s — reading the world 1.1 s · writing 1 month of events 16.9 s (1 request) · moving the armies and checking the record 6.2 s (1 request) · writing it into the record 1.6 s.
```

The summary also rides on the result (`result.phases`). A retry of a held segment is timed on its own and tells the panel that asked for it.

## Interactive events: a moment a time skip offers to play out

An **interactive event** is a moment of the campaign played out beat by beat — a summit, an ultimatum, a night in a bunker — then written into the record as one event. The player does not ask for one: **now and then a time skip offers one of its own events for it** (`src/runtime/interactiveOffer.js`, 7 tests). That event's card in the Events panel carries a yellow ⚡ strip with **Play it out** and **Let it pass**, and the time panel mentions the offer until the next skip replaces it. There is no button that starts one. (They were called catalysts until 18 September 2026, and began from a *Catalyst mode* button in *Settings → Tools*.)

**Choosing the offer costs nothing.** `applySimulationResult` picks it for a jump or an auto-jump once the turn's events are final (`chooseInteractiveOffer`). An event qualifies when it is about the player (`playerRelated`), of weight (importance major, high or critical, or `notable`), written by the simulation (not a fallback stand-in, not the engine's own espionage) and not itself a played-out scene; the weightiest wins, a notable one above its peers, the latest of equals. The dice (`INTERACTIVE_OFFER_CHANCE`, one in three) are seeded by the turn — its round and first event — so the same turn always offers the same event: a turn held on its board and applied again, or an Intervene that keeps the offered event. No offer comes within `INTERACTIVE_OFFER_COOLDOWN` (3) rounds of the last one. The offer is `world.interactiveOffer = { eventId, round }`, beside `world.lastInteractiveOfferRound`; every skip replaces it, taken up or not, and an undo takes it back with its turn.

**Playing it out** opens the panel (`GameUI/interactive.jsx`, by `oh:open-interactive-event`) on the event: its title, date and description, an optional **angle** of the player's own, **Play it out** and **Let it pass**. `createInteractive({ eventId, angle })` needs the offer to stand (its event on the record, no scene in progress, the reveal finished) and binds the creation to the event (`[THE MOMENT TO PLAY OUT — BINDING]`: open inside it — its decisive moment if it is still unfolding, or the moment its consequences reach the player's leadership — and build on what it reports without retelling, contradicting or resolving it, or inventing backstory to dramatise it), and to the angle when there is one (`[THE PLAYER'S ANGLE — BINDING]`). The scene is stamped `origin: "player"`, `fromEventId`, `request` (the angle) and `startedOn`, and the offer is spent. `declineInteractiveOffer()` lets it pass: the offer goes, nothing else changes, no request.

From there the scene plays out: the offered choices or the player's own move, a move taken back, and **End the scene** (written into the record, one request) or **Set aside** (nothing written, no request). **Time stands still while one is in progress** (`isSceneInProgress`: one the player took up, or any with a beat played): `simulateTimelineJump` refuses, and the time panel's skip controls are replaced by a note that leads back to the scene. A scene an older skip proposed and nobody played is not one in progress — it blocks nothing, shows nowhere, and the next skip clears it. **A step that fails changes nothing**: the canned text a task falls back on is not a scene anyone asked for, so `createInteractive`, `advanceActiveInteractive` and the resolution throw the reason instead (`sceneStepFailed`) and the panel shows it. `endActiveInteractive()` writes the scene as it stands — or, with no beat played, simply closes it; `setAsideActiveInteractive()` closes it.

Costs, said beside the buttons: playing an offer out is one request, each move one more, ending one more; letting it pass, taking a move back and setting a scene aside cost none.

**Saves and settings from before the rename** read under the new names: a save's `activeCatalyst` scene, a turn record's `catalyst` mode and an event's `catalyst` kind (`gameState.js`; `gameState.interactiveEvents.test.js`); a player's per-task model picks, old per-provider task models and a scenario's prompt edits under the old task keys (`src/Game/AI/formerTaskKeys.js`). A skip answer still carrying a `catalyst` field has it dropped by `normalizeGameplayPayload` rather than refused. Of the placeholders, `${ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS}` folded into `${ALL_EVENTS_WITH_CONSOLIDATION}`, whose exact alias it was; the rest became `${RUNNING_INTERACTIVE_DATE}`, `${RUNNING_INTERACTIVE_PERCENT}`, `${INTERACTIVE_PREMISE_DESCRIPTION}` and `${INTERACTIVE_SIMULATION_HISTORY}`.

Proven offline in `.lab/probes/phase6-probe.mjs` (20 checks): a skip offering one of its events with no request of its own, the offer held back until the reveal is done, taken up from the player's angle in one request, a skip refused while the scene runs, a beat played and taken back for no request, the end written into the record in one request, an offer let pass and then refused, a failed start leaving the offer standing, the next skip letting an offer pass, and a save's scene under the old key holding time still until set aside. The panel's four states, the event card's strip and the time panel's note are rendered in `.lab/probes/panel-smoke.mjs`, with the Tools tab shown to have no button for it.

### Taking back a beat

Until an interactive event resolves into its one event, nothing but the scene has changed, so any beat can be taken back at no cost beyond the beat itself. The record made it impossible: a beat kept its choice and summary only, and the scene's `opening` was overwritten by every summary. `src/Game/AI/interactiveRewind.js` (4 tests): each beat now keeps the text above the choices (`before`) and the choices offered (`offered`), the scene its `firstOpening`; `rewindActiveInteractive({ beatIndex, choice })` (gameplay.js) returns the scene to exactly how it stood at that beat — no request — or chooses again at once, the one request any beat costs. A beat played before this has no screen kept and says so.

## The player's standing goal

Orders are what the player's government does this turn; a **standing goal** is the direction behind them — "keep out of the war and grow the economy", "unify Italy by 1870". The player sets it in the Actions panel (a compact field under the date line; locked while a turn runs, because the turn writes the world it lives in), and it is kept per polity in `world.playerGoals` (`src/runtime/playerGoal.js`, 3 tests), so a renamed country keeps its goal (`server/polityRename.js` re-keys it) and a player who switches polity finds that polity's own. An undo or an Intervene keeps the goal in force now: it is the player's, not the turn's.

Who is told, each in its own terms, and none of it a request:

| reader | told |
|---|---|
| the advisor | `[Our Standing Goal]` — the government's aim: weigh advice by it, say what brings it nearer, and say plainly when an order works against it (`describeGoalForAdvisor`, in `buildAdvisorSystemPrompt`) |
| the time skip and its repairs | `[The Player's Standing Goal]` — a guiding philosophy, not an order: the player's own ministers conduct the business the orders did not cover in its spirit; it never creates an action the player did not order, never decides what Player Agency reserves for the player, never makes success likelier — other powers do not know it (`PLAYER_GOAL_TASKS`, appended before the author's direction, which outranks it) |
| the suggestions | one line ahead of the request: serve the goal where they can, and one may say what it would take |
| a leader | never: a government's aims are its own |

Proven offline in `.lab/probes/phase6-probe.mjs`: the advisor, the skip and the suggestions carry it; Russia's leader does not; an undo keeps a goal set after the turn.

## The event cards' links

`deriveEventLinks` (`src/Game/GameUI/eventFocus.js`, `eventLinks.test.js`): the powers, regions, formations and structures an event is about — from its operations first, then from the places and powers its words name, through the same word-boundary name index the event camera uses — each with the frame to fly to. The card shows them as chips; a click flies the map there. A place the map cannot frame is left out; a power is shown by the name it has now; eight at most. Derived on render, never stored.

On a drawn map the stock outline tables (keyed by GADM id) know none of the regions, so the map's worker now records each region's bounding box (wrapped across the antimeridian) and the focus context frames drawn regions — and the polities holding them — by those boxes. The same fix gives the event camera a frame on drawn maps, where it had none.

## Reports: what only some governments know

The timeline is public — everyone reads it. A secret protocol, a private letter between heads of state, an intelligence assessment, the full articles of a treaty are **documents**, and a document is held by the governments it was addressed to. `world.reports` keeps them (`{id, title, body, visibleTo, from, interceptedBy, receivedFrom, sourceEventId, createdRound, createdDate, dateline, origin}`), and `src/runtime/reports.js` (import-free) owns the rules.

**They ride in the jump's own answer.** `impacts.reports` joins the other impact arrays: `create` writes a document (title, body, `visibleTo`, optional `from` — whose document it is — `dateline` and a stable `reportId`), `share` widens who holds an existing one, by id or by its exact title, with an optional `from` naming the holder who passed it on. A separate call would have cost a request per turn — the thing Phase 1B exists to prevent — so reports went *inside* the jump's schema instead, exactly as the reference does, and the schema guard in `projectOpSchema.test.js` was raised on purpose (~1,450 chars for the family, against a whole request a turn).

**Who reads one** is the audience rule already in `audience.js`: `visibleTo` null is public, a list is the governments that hold it, and `audienceSeesScoped` decides. The prompt's `[Reports on File]` block is unscoped for the narrator, which wrote them all — and is told which copies were stolen; a leader gets `[Documents Your Government Holds]` by the rule (never who stole what), and the advisor `[Documents Our Government Holds]`: every paper the player's government can read, each saying how it came by it (`describeDocumentsForAdvisor`). Holders are checked at validation, where the whole country catalog is in hand: a holder the map does not know fails the strict attempt with the real names, and on the final attempt is dropped with a receipt note; a document with no known holder at all is dropped entirely rather than written to nobody.

**The hard boundary**, stated in `REPORT_VOICE_DIRECTIVE`: anything that moved the map — a border, a unit, a structure — is observable and stays in the public event. A report carries no impacts, and the public event describes only the observable surface of what the document contains. The directive also asks for the artifact rather than a summary of it: first person for a letter or a cable, numbered Articles for a treaty, FROM / TO / SUBJECT / DATE for an intelligence report.

**How the player comes to read one.** There is no document panel: `world.reports` is the file behind the game, and a document reaches the player the way it would reach a government (`src/runtime/reportDelivery.js`, 7 tests; planned in `applySimulationResult` from what changed hands in the turn):

| the document | reaches the player |
|---|---|
| held by the player **with other governments** (created so, or passed to the player) | **diplomacy** — a note in the thread with the other holders, spoken by its sender (`from`); a copy passed on by one holder comes from that holder alone. Folded like any note, so a thread already open is where it lands. |
| **not** held by the player, but by a government where the player has an **active agent** | **the Spies tab** — the agent's copy, filed with its intercepts (`doc-<id>`), sealed like them and decoded only as far as the player's service can read the target's; an agent's periodic report keeps the documents it replaces traffic around. The file marks `interceptedBy` for the narrator. |
| **published**, or held by the player's government **alone** | **its event** — the card shows it under the event text, a click away |
| a secret between others, no agent among them | nowhere on the player's side: the simulation and its holders know it |

A turned agent brings nothing real, so only active ones steal. None of it costs a request.

**The advisor says a paper has arrived.** Each document delivered to the player's side in a turn — by diplomacy, by an agent, or on its event card, but never a published communiqué, which is news — also puts a notice in the advisor's conversation (`documentNotices`: `role: "notice"`, `kind: "document"`, the report, the channel and sender, the event that brought it): "📄 A new paper on your desk", with *Read it* / *Put it away*. It is a line of the panel, never sent to a model, and hidden until the reveal reaches its event. An undo takes it back with the paper (`withoutOrphanedNotices`, run by `rollBackToSnapshot`); the rest of the conversation is the player's and stays. The panel loads its conversation once and saves the whole list, so it merges a notice written while it is open (the `oh:runtime-json-updated` event) rather than saving over it. Proven offline in `.lab/probes/phase6-probe.mjs`.

Proven offline (`.lab/probes/report-delivery-probe.mjs`, ten checks: the letter from Moscow in the thread with Russia, the stolen protocol in the Spies file opening to its text, the communiqué and the assessment on their events' cards, the Franco-Italian secret nowhere, Russia's leader holding its papers but never told of the theft, the advisor reading all four, the next skip's narrator told who stole a copy) and `.lab/probes/reports-probe.mjs`: a trade-agreement event whose secret protocol is held by two powers while its public text mentions only grain and credit; a document addressed to a power that does not exist dropped with a note; the player reading their own assessment and not the others' protocol, and the other government the reverse; a later skip's `share` widening the protocol to a third power; the simulator shown both the directive and the file; and not one request beyond the two skips' own.

Found on the way, and fixed: `loadCountryNames` returned an empty catalog the moment the stock countries tile archive could not be read — *before* merging the world's own polities — so a hand-drawn map whose 202 countries live in `polityOverrides` lost every one of them, and with them the country pickers, the map labels and every name a chat participant or a report holder is resolved against. The same gap `loadRegionCatalog` had, fixed the same way.

## Intervene: stopping a round where the player wants to act

A time skip is revealed one event at a time. Three events in, the player sees the thing they would have acted on — an ultimatum, a border crossing — and the four events after it have already assumed they did nothing. **Intervene** stops the round there: the events revealed so far are canon, the rest never happened, the game's date is the last revealed event's, and the player's next orders go out before what came next.

It costs no request, and it is built on what a turn already does. `applySimulationResult` captures a rollback snapshot of the pre-turn state at the end of every turn; a time skip now also puts **the journal of what it applied** beside it (`journalTurn`: the events as applied and in reveal order, less the engine's own espionage events, the four ledger update lists as remapped, the stop date, summary, outreach, `clearActions`, mode and receipt). `interveneAfterEvent(keptCount)` (`gameplay.js`) cuts the journal to the revealed prefix (`truncateTurn`: ledger records bound only to discarded events go with them, by `eventIds`, `eventIndexes` or the id in their text; the closing date is the latest kept event's, never before the day after the round began), **rolls the game back to the snapshot** (`rollBackToSnapshot(0)`, which drops it) and **applies the prefix again through `applySimulationResult`** (which chooses the turn's interactive event offer again from the kept events, so an offer on a kept event stands) — with an empty review, so every director finds its part missing and keeps the events as written (they were checked when they were made, and the unit and territory directors' ops are already on them), and with a jump budget that has nothing left, so history consolidation and the tracked stats stand down. The apply captures a fresh snapshot of the same moment with the shorter journal, so the round can still be undone, or stopped earlier still. The next turn's receipt carries a `withheld` note (`describeIntervention`) naming where the player stopped and the events that never happened, so the simulator does not write them again as if they were still coming.

Proven offline (`.lab/probes/intervene-probe.mjs`): a four-event skip whose third event occupies a region and whose fourth raises an army, stopped after the second, leaves the first two on the timeline, no occupation, no army, the game on the second event's date, the receipt saying so, the round undoable, and no request spent. Seen in the app: **✋ Intervene here** under *Next event* / *Skip to end*, its one confirmation, and the panel afterwards.

Deliberately not built: the *live* reveal — events appearing as the answer streams in rather than after it lands. Gemini, the provider most players use, delivers a function call as one whole part at the end of the stream, so there is nothing to parse incrementally on the default path; OpenAI-style and Anthropic endpoints stream tool arguments and could feed an incremental parser. Until the default provider can show anything early, a live reveal would be an OpenAI-and-Anthropic-only feature, and the staged reveal already gives Intervene everything it needs.

An undo and an Intervene also take the Spies file back with the turn: the restore point keeps the agents' file as it stood before the turn filed anything (see [world state](world-state.md#2e-ter-espionage-rides-inside-world-state-except-the-intercepts)), so an undone turn's traffic and stolen copies go with it, and Intervene files again only what the kept events stole. Before, a copy of a protocol signed in a discarded event stayed in the Spies tab after the protocol itself was gone. Proven offline in `.lab/probes/rollback-intercepts-probe.mjs`.

## What the player has not been shown yet

A skip is written whole and then shown one event at a time. Until the reveal reaches an event the player has not seen it — and until they have, nothing else may show it to them: not the advisor, not a leader answering a letter, not the thread that event opened, not the copy an agent stole in it. Intervene can still discard it, and an advisor who had spoken of it would have spoken of something that, for the player, never happened. The reference's advisor is shown the same thing: only the activity revealed so far in the running jump.

**Which events are unseen** (`src/runtime/unseenEvents.js`, 5 tests): `applySimulationResult` marks every event of a time skip but its first as unseen, before it writes anything; each **Next event** and **Skip to end** in the time panel marks the reveal's front; an undo and an Intervene end the reveal. It is kept on the device (localStorage `oh_unseen_turn_events`, keyed by the turn's first event), because a reveal is the player's progress through the record, not part of the record — and it only ever applies to the turn the world says is newest, so a reveal abandoned by a later skip or undone away can never hide anything. A reload now resumes the reveal where the player left it; a turn with nothing unseen opens whole.

**What a turn's own writing carries.** Every message a turn puts in a thread carries `eventId`, the event whose reveal shows it: a chat an event opened (`buildGeneratedChat`'s `revealWith`), the period's outreach (the turn's last event), a document's note (the event that wrote it, or the last event for a copy passed on). So does a stolen copy in the Spies file.

**What each surface is shown:**

| surface | shown |
|---|---|
| the advisor, a leader (1:1 or the group batch), the next-speaker pick, suggestions, Improve | the campaign **as seen** (`gameState.js viewAsSeen`): the events up to the reveal's front; the world as those events left it — the turn's restore point with the seen events applied, exactly as the map is showing it, with what belongs to no turn (reminders, the GM's log, the seal, the leaders' cursors) kept from today; the threads without what the unseen events wrote; the date of the last event shown. Read-only — every writer re-reads what is stored. |
| the chat list, its unread badge and the incoming-message watcher | the threads without what the unseen events wrote (`withoutUnseenChats`): a letter arrives — and counts as unread, and raises its notification — when the reveal reaches the event that brought it. The panel filters when it shows; what it writes back is always the stored thread. |
| an open conversation | the same, at render time, with each message keeping its index in the stored thread (a retry replays the right one); the leader is sent only what is shown, and again when the reveal moves on |
| the Spies tab | the file without the copies stolen in unseen events (`withoutUnseenIntercepts`) |
| the advisor's catch-up note and the dates on its messages | the moment the player is asking from: the events shown, and the reveal's date — so the next question's note picks up what the rest of the reveal showed |
| background writers — the idle pulse, the timed agent report, a reaction queued to an unseen event | wait for the reveal to finish, or for their event to be revealed |

The time skip itself, the checks after it and the GM console see everything: they are the narrator.

Proven offline in `.lab/probes/reveal-gate-probe.mjs` (eight checks): a four-event skip whose later events deliver a letter, open a thread, take a region and steal a protocol; with only the first shown, neither the advisor nor Russia's leader is told any of it, no surface shows it, and the world as seen still has the region and stands on the first event's date; after the reveal, all of it. Seen in the app on the Fault Lines save: a letter and a thread tied to the third event absent with one event shown, arriving marked *new* when **Next event** reached it, the reveal resuming at the same event after a reload, and **Skip to end** clearing it.

Found on the way, and fixed: **no chat an event opened was ever opened.** A chat an event opens is written as an opener — who speaks first and what they say — and the chat normalizer, which knows threads and not openers, dropped both fields when the event was normalized; the turn writer then found nothing to say and opened nothing. Only the period's top-level outreach ever reached the player. `normalizeEventImpacts` now keeps the opener (`normalizeCreatedChat`, `gameState.createdChats.test.js`).

## Placing things by name, and keeping them apart

A model knows that a tank army is "massing east of Kharkiv"; it does not know that Kharkiv is at 36.23 E, 49.99 N, and when it is made to say so it guesses. A guessed longitude is what a rifle division standing forty kilometres out in the Black Sea looks like. Names are what a model is good at and what the map is good at resolving, so every unit it spawns or moves and every structure it builds may be placed with **`at`: a phrase naming places the map knows**, and the engine finds the point. `lng`/`lat` are no longer required on a spawn or a build; they remain for a spot no name describes, and `at` wins when both are given.

**The grammar** (`src/Game/AI/placement.js`, `readPlacement`): the place itself ("Kharkiv" — a city, region, existing structure or unit); "near X" (beside it, `NEAR_KM` = 22 km, the compass walked round until the point is on land); "east of X" (`DIRECTION_KM` = 35 km that way); "eastern Ukraine" / "Donetsk Oblast, north" / "the north of X" (that part of a region, or of a country the region in that part of it); "coast of Crimea" (on land at the sea's edge); "off Sevastopol" (at sea, `OFFSHORE_KM` = 30 km out from the nearest shore, shortening to 16 and 8 km when a strait is narrow); "X facing Y" / "the border of X with Y" (the side of one place nearest another — a front, a border garrison); "between X and Y" (halfway); and `[lng, lat]`. The **whole phrase is tried as a name first**, so North Korea, the Ivory Coast and the West Bank are places — but exactly as the map spells them: the loose lookup that would take "off Sevastopol" for the region Sevastopol is only allowed for a phrase that can be nothing but a name (`exact` on the reading). Every result is deterministic (a Halton sequence seeded by the phrase and the thing's name), because a unit that twitches each time a save is read is a bug the player can see; the seed is why two brigades "near Kharkiv" start on different sides of it.

**The gazetteer** is built where region names are already resolved — at validation (`buildPlacementGazetteer` in `gameplay.js`, from the lookup context and the rendered geojson) — because the runtime layer that applies operations has no geometry and goes on receiving plain coordinates. `find(name, { exact })` looks up units and structures by id or name, then cities (exact or alias), then a country before a region that shares its name, then regions (exact, alias, "Kharkiv" for "Kharkiv Oblast"; loosely, one edit or a contained word, only when not `exact`), and last a city one letter out. `regionAt(point)` is a bbox test then point-in-polygon; `nearestLand(point, maxKm)` is where a land formation put in the sea by coordinates comes ashore (within 150 km, with an `adjusted` receipt note that tells the model to use `at`).

**Spacing** (`src/runtime/featureSpacing.js`, `spaceOut`): once every `at` in a payload is a point, each newly placed thing is moved clear of everything already standing (`obstaclesOf(world)` plus the things placed before it in the same turn). A footprint is a radius on the ground — `FOOTPRINT_KM.unit` = 16, `.marker` = 10, the size a counter reads as at the zoom a theatre is played at — and two footprints may not touch (`SPACING_PADDING` = 1.12). The search walks outward on a golden-angle spiral and takes the first spot that touches nothing; a spot that would leave the region the thing was put in (`inside`) is bisected back along the line to where it started, so an army spaced off its neighbour never crosses a border or ends up in the sea — and a fleet put at sea is held to the sea, not dragged ashore. If nowhere is clear, the least crowded spot found is used: a little overlap beats a wrong country. A moved unit leaves the place it stood before it is counted as an obstacle.

`resolvePlacements(containers, world, { receipt })` runs in `validateGeneratedWorldChanges` beside the region resolvers, on the unit director's orders before its own rules measure the move (`placeDirectorOrders`), and on the idle pulse's unit ops. A phrase the map cannot find is a `dropped` receipt note when the operation has no coordinates of its own ("no city, region, unit or structure on this map is called …"), an `adjusted` note when it has. The model is told all of this once, in the `[Placing Things — say WHERE in words]` directive appended to the jump, unit director, game master, idle diplomacy and interactive event executor prompts, and the actions reference's examples say `"at": "<where, in words>"` instead of two numbers. Proven offline (`.lab/probes/placement-probe.mjs`): two brigades "near Kharkiv" land 22 km from the city on different bearings and are spaced 49 km apart; a squadron "off Sevastopol" is 32 km out at sea; a division given coordinates in the Black Sea is moved ashore with a note; a unit "near Atlantis" is left off the map with a note; an airfield in "eastern Ukraine" is in Ukraine's east; a depot "at Kharkiv" sits beside the brigades rather than under them.

## The task runner: `runJsonTask`

`runJsonTask(taskKey, { fallback, signal, userMessage, validatePayload, variables })` (`gameplay.js`) is the structured‑generation core. Steps:

1. **Prompt assembly**: `renderTemplate(prompts.tasks[taskKey], { …variables, …helpers })`, then append call‑time directives: `difficultyDirective` for most tasks; `[International Reputation]` for `actions` and the interactive event tasks (`gameplay.js`). A time skip is the exception: its live records are rendered into its template at `${JUMP_LIVE_STATE}` and nothing is appended after it (ai-prompts.md §6a). The call-time blocks date from when each save carried a frozen copy of the prompts; since the guidance model (ai-prompts.md §2) every campaign composes the current templates, so a `defaultPrompts.json` edit reaches all of them.
2. **Deadline/abort wiring**: an internal `AbortController` is aborted by (a) the external `signal` (player Cancel) or (b) the idle deadline (`gameplay.js`, see [Cancellation & timeouts](#cancellation--timeouts)). No call site sets its own window any more — the policy is one setting read in `taskIdleTimeoutMs`.
3. **Two output attempts** (`gameplay.js`): call `callAI` with the task `tool` and `maxTokens: 8192`; parse `response.toolInput ?? extractJsonPayload(rawText)`; run `validateGameplayPayload(taskKey, parsed)` (schema) then the caller's `validatePayload`. On attempt‑1 failure it pushes the model's answer + a corrective instruction into `history` and retries once. A model that used a tool is told to "call it again"; a prose model is told to "respond with ONLY the corrected JSON".
4. **Outcome**: valid → `{ generation:{source:"ai"}, payload }`. Both attempts fail → deterministic `fallback()` with `generation.source:"fallback"` and the `failureReason`. No `fallback` → throw. A user **abort** is re‑thrown, never falling back (`gameplay.js`).

### `extractJsonPayload` — tolerant parsing

`extractJsonPayload` (`gameplay.js`) is what makes small/local models usable without tool support: strips `<think>…</think>` blocks, tries a lenient parse (`lenientJsonParse` repairs smart quotes and trailing commas, `gameplay.js`), then any ```` ``` ```` fenced block, then every balanced top‑level `{…}`/`[…]` via a string‑aware scan (`balancedJsonCandidates`, `gameplay.js`), objects preferred over stray arrays. Repairs are attempted **only after** a strict parse fails, so well‑formed output is untouched.

---

## Task catalog

`taskKey` → schema (`GAMEPLAY_SCHEMAS`) → tool (`GAMEPLAY_TOOLS`), both in `gameplaySchemas.js`. Callers in `gameplay.js`, named rather than line-referenced because the line numbers rot:

| taskKey | Tool name | Exported fn (`gameplay.js`) | Purpose / applied to |
|---------|-----------|-----------------------------|----------------------|
| `jumpForward` | `submit_jump_result` | `simulateTimelineJump({mode:"jump"})` | Advance to a target date; events + impacts → world state. No scene: now and then it offers one of its events as an interactive event instead (`interactiveOffer.js`, no request). |
| `autoJumpForward` | `submit_jump_result` | `simulateAutoJump` | Advance to the next notable moment. |
| `actions` | `submit_actions` | `generateActionSuggestions` | Strategic suggestion topics for the player. |
| `descriptionToAction` | `submit_description_to_action` | `refinePlayerAction` | Freeform intent → structured action/chat. |
| `eventConsolidator` | `submit_event_consolidation` | auto `compactHistoryIfNeeded` (a turn), `consolidateHistoryNow` (Cheats → History Document), `consolidateRecentHistory` | Fold old events/chats/orders into the campaign's living history document (`world.historyDocument`): the first pass writes it, later passes rewrite it, condensing unimportant older material to stay near 1,500 words; the events themselves stay in the log. |
| `interactiveCreation` | `submit_interactive_creation` | `createInteractive({ eventId, angle })` | Open the scene of the interactive event a skip offered, from the player's angle when they gave one. |
| `interactiveExecutor` | `submit_interactive_execution` | `advanceActiveInteractive` (and `rewindActiveInteractive` with a choice) | Play one move of the scene. |
| `interactiveSummary` | `submit_interactive_summary` | the scene resolving, or `endActiveInteractive` | The scene written into the record as one event. |
| `gameMaster` | `submit_game_master` | `applyGameMasterCommand` | GM console: apply free‑text world/map edits. |
| `countryStatSheet` | `submit_country_stat_sheet` | `generateCountryStatSheet` / `generateCountryStats` | National statistics sheet. |
| `timelineCurator` | `submit_timeline_curator` | `curateGeneratedEvents` (`nativeTimelineCurator.js`, from `applySimulationResult`) | Judges each fresh event against recent canon before it persists; deterministic gates (hard impacts, retrieved prior matches, saturation) decide what may be dropped, default KEEP. |
| `unitDirector` | `submit_unit_director` | `directGeneratedUnitOps` (`nativeUnitDirector.js`, from `finishTimelineJump`) | Keeps existing NPC formations coherent with the turn's military events: proposes spawn/move/strength/remove ops that native rules sanitize before they ride the normal unitOps path. |
| `idleDiplomacy` | `submit_idle_diplomacy` | `maybeSendIdleDiplomacy` | Optional unprompted diplomatic note. |
| `pregameHistory` | `submit_pregame_history` | `maybeGeneratePregameHistory` | Backstory events before the start date. |
| `projects` | `submit_project_ops` | `generateProjectOps` (internal; run by `simulateTimelineJump`) | The Projects & Operations board, kept in step with the events a jump just produced. |

### Why `projects` is its own call

The board used to move inline, through `impacts.projectOps` on a jump's events. That made `projectOps` **41.5 KB of the jump's 63 KB tool schema** — two thirds of the whole output contract for one impact branch, three times every other branch combined — and the board dominated what the model spent its attention on. A field run caught one narrating stalled programmes for three minutes and never reaching the events it was asked for.

So the jump writes the story and a second call reads that story and moves the board. It runs **once per jump, never per segment**: a segmented jump would otherwise pay for it three times and show the model a third of the round each time. Its prompt is the board plus the merged events — no world summary, no city coordinates, no unit list, no chat history — and comes to ~20 KB against the jump's ~500 KB.

The ops are **attached back onto the events that caused them** (by `eventIndex`) rather than applied separately, so `events.json` still records them for the staged reveal and the existing write path runs unchanged: `applyEventImpactsToWorld` → `releaseProjectCompletionEffects` → `applyProjectOps`, inside one write and one rollback snapshot.

**A failure holds the turn rather than losing it.** The events are generated and valid at that point, so throwing them away to re-roll a bookkeeping call would be the worst outcome. Nothing is written, `pendingProjectsJump` keeps the whole turn, and the UI offers Retry (re-runs only the board) or Discard. Holding is what keeps the retry honest: the ops must ride in on their events, which only works *before* the world is written — a retry afterwards would have to use the non-event door, which refuses to close a project carrying an `onComplete`. A held turn also counts as `isSimulationBusy`, so the idle pulse cannot write into a world about to be replaced.

The game master still moves the board inline: it is one call with no second pass to hand the work to.


---

## Strict / salvage validation discipline

Two validation layers run on a parsed payload; the second is where the strict/salvage contract lives.

1. **Schema** — `validateGameplayPayload(taskKey, parsed)` (`gameplaySchemas.js`) checks the payload against `GAMEPLAY_SCHEMAS[taskKey]` with a hand‑rolled validator (types, `enum`, `minLength`/`minItems`/`maxItems`, `required`, `additionalProperties:false`). See [AI schemas](ai-schemas.md).

2. **Semantic `validatePayload(candidate, { attempt, finalAttempt })`** — the caller‑supplied validator. The **`finalAttempt` flag comes from `runJsonTask` itself** (`gameplay.js`), never from counting invocations — a schema failure on attempt 1 skips this validator, which would otherwise make attempt 2 look "first" and leak strict feedback out as the fallback reason (a real field report). The contract:

   - **Attempt 1 (`strict = !finalAttempt`)**: shape problems return a **corrective error string**, which `runJsonTask` feeds back to the model as its one retry — the model usually fixes its own answer.
   - **Attempt 2 (final)**: a finished generation is **never rejected into the canned fallback** over cosmetics. Instead the payload is **salvaged in place**: dates clamped, unresolvable ops dropped, invalid entries pruned.

   The jump validator (`gameplay.js`) shows all three: strict event‑count check → `validateTimelineDates` (strict) vs `clampTimelineDates` (salvage, `gameplay.js`) → `validateGeneratedWorldChanges` with `strictTransfers: strict`.

   `validateGeneratedWorldChanges` (`gameplay.js`) is the map‑integrity gate:
   - **Region transfers**: `resolveRegionTransfers` (`gameplay.js`) canonicalizes each `regionId` — the prompt asks for a region's plain **name**, which must be resolved to a real map id (e.g. `DEU.2_1`) via the region catalog, owner‑aware for repeated names. Strict: unresolved names **fail** with the losing owner's real region list (`buildTransferFeedback`, `gameplay.js`) so the retry has the vocabulary; final: unresolved transfers are dropped (a phantom key never reaches world state). A receiver the map does not know is founded under that exact name (`runtime/polityFounding.js`), with a `polityChanges` create synthesised onto the event; only the loser must already exist.
   - **Reluctance guard** (strict only): an event whose text uses capture language (`CAPTURE_LANGUAGE`, `gameplay.js`) while the whole payload ships **zero** `regionTransfers` fails once — narration and the map must never disagree.
   - **Unit ops / marker ops / created chats / outreach**: each validated per entry; strict returns a path‑anchored error, salvage drops the bad entry (stale `unitId`, blank marker name, unresolvable chat participants) and keeps the turn.
   - **Why the land moves** (`runtime/territoryBasis.js`): a `regionTransfers` entry and a `regionControlOps` control flip may each carry a `basis`. `treaty`, `annexation`, `unification`, `independence` and `occupation` move the map; `claim`, `threat` and `raid` do not. A transfer whose own basis is `claim` is **turned into a `regionClaims` entry** — the region goes disputed instead of changing colour — and a `threat` or a `raid` is left out. This is never an error and never costs a retry: the intent is unambiguous, so it is screened in place (before the geography resolver, so the claim it produces is resolved to a region id like any other) on both attempts. **An entry with no basis is applied exactly as before** — the Game Master console, a lenient local backend and every older payload answer without one, and this game's territorial bugs have been borders that failed to move. `applyPolityAndTerritoryImpacts` runs the same screen again as a net for impacts that never met the validator (a project's stored `onComplete` effects, a hand‑edited save); it is idempotent.

### The application receipt: what salvage did, told to the next turn

Salvage keeps the turn, and until this existed it also kept a secret. A control operation naming a region that is not on the map is dropped, the turn lands, and the model — which narrated the capture and believes it happened — builds the next turn on it. The same is true of an event the curator keeps off the timeline, one the integrity screen rejects, a combat event the war ledger cannot bind, and a transfer turned into a claim.

`runtime/applicationReceipt.js` is the difference, in sentences a model can act on. It is import‑free and tested under bare node.

- **Filled** by `validateGeneratedWorldChanges` (each salvage drop, each unresolved transfer or control operation, each `basis` screen), `validateSegmentLedgers` (war‑ledger salvage), the date clamp, `screenSegmentPayload` (integrity screen), `runJumpSegments` (what `schemaSalvage.js` cut out of the answer rather than ask again, and an event count outside the period's range), and `applySimulationResult` (word‑for‑word restatements, curator drops, impact entries normalization threw away, and the tally of what was applied).
- **Five kinds of note**, rendered in this order under a heading each: `redone` (rejected and regenerated within the turn), `withheld` (events that did not reach the timeline), `dropped` (operations that were not applied), `adjusted` (operations the engine changed), and `short` — kept exactly as written, but short of what was asked. `short` is what a strict retry used to say and no longer gets the chance to: while [requests are being saved](#the-request-budget) a thin answer is kept, because sending it back is a whole second request. Nothing was lost, so it does not trigger the closing "do not build on anything listed above".
- **One draft per validator run.** The jump's validator can run several times before an answer is taken — the strict attempt, the salvaged retry, a late salvage of the first attempt. `withReceiptDraft` gives each run a draft of its own; only the run that returned clean is merged, once `runJsonTask` has actually returned. A rejected attempt's drops never reach the record. The strict attempt's complaint is remembered as **one line** (`firstComplaintLine`) — the two‑hundred‑region vocabulary it carried was already spent on the in‑turn retry.
- **Stored** on the head of `world.simulationHistory` as `receipt`, so a rollback restores the receipt that belongs to the restored turn and an exported game carries its own. `normalizeWorldState` keeps the notes on the **newest receipt only** (older turns keep their counts), so the polled world file never carries more than one receipt's text; a Game Master intervention or a resolved interactive event recorded above the jump carries none and does not cost the jump its notes. Bounded: 40 notes of 280 characters, and a cut is counted and said, never silent.
- **Read** by the next jump: `renderLastTurnReceipt` renders `[APPLICATION RESULT FROM YOUR LAST TURN]` at the top of the **user message**, on every segment (each is a separate request). Not the system prompt — the cacheable static prefix is untouched. It renders nothing on a campaign's first jump or after a turn that predates receipts, and then the message is byte‑for‑byte what it always was. A fallback turn is reported as such ("nothing you drafted for that period happened") rather than by counts.

Only a jump writes one. `selectLastJumpRecord` steps over Game Master, interactive event and pregame entries when it reads.

---

## Applying world changes

Once a payload is accepted (region ids already canonicalized in place), the exported task functions write it back:

- **Jumps**: `applySimulationResult` (`gameplay.js`) normalizes events, advances `gameDate`/`round`, resolves planned actions to `resolved`, runs `applyEventImpactsToWorld` (from `runtime/gameState.js` — region ownership, polity changes, units, markers, colors), builds chats from `impacts.createdChats` + top‑level `diplomaticOutreach` via `buildGeneratedChat` (`gameplay.js`), optionally consolidates history, writes all state slices, and captures a rollback snapshot (`loadRollbackSnapshots`/`rollBackToSnapshot`, `gameplay.js`).
- **GM command**: `applyGameMasterCommand` (`gameplay.js`) turns the payload into a single GM event and applies its impacts the same way.
- The `generation` object (`{ source: "ai" | "fallback", fallbackReason }`) rides along into `simulationHistory` so the UI can show whether a turn was AI‑ or fallback‑generated.

See [World state](world-state.md) for the shape of what these writers touch, and [Game state persistence](world-state.md) for the read/write bundle helpers.

---

## Cancellation & timeouts

- **Player Cancel** passes an `AbortSignal` into `simulateTimelineJump`/etc → `runJsonTask` → `callAI` → `fetch`/relay. A deliberate cancel is re‑thrown as an `AbortError` and **does not** write state or fall back to canned events (`gameplay.js`).
- **Timeout** aborts the same controller but **does** use the deterministic fallback, because a stalled model shouldn't leave the turn with nothing. It measures **silence, not elapsed time**: the "Limit AI generation" setting (`ai_limit_generation`, **off** by default — read with `getMapSetting`) gives a task two windows: `AI_IDLE_TIMEOUT_MS` (5 minutes) with nothing arriving once an answer has started, and `AI_FIRST_BYTE_TIMEOUT_MS` (15 minutes) with no answer at all. Off disables both and generation waits as long as the model needs. The one exception is the two world repairs (`worldMotionRepair`, `worldBreadthRepair`): they are optional follow-up work, so `callRepairAI` always applies the same two windows to them, whatever the setting says, and a timed-out repair is an ordinary failed repair, never a fallback. The motion repair also passes what is left of its per-skip time budget (`runBoundedRepairCall`, `repairCall.js`), so a repair still running when that is spent is stopped too.
  - `createIdleDeadline` (`idleDeadline.js`) owns the timer. `start()` arms the long window when a request goes out; the first network chunk switches to the short one and every chunk after restarts it. The split is what lets a model that keeps writing run as long as it likes, while still bounding the two cases that produce no bytes for a long time and are indistinguishable from a dead request — prompt evaluation on a local model, and a buffered endpoint whose headers only arrive once the whole answer is ready.
  - A relayed call (every local model) also has the relay's own `OH_RELAY_TIMEOUT_MS` (10 minutes), which reaches it before the 15.
  - The activity signal comes from `readSSE` (`streamAssembly.js`), which calls `onActivity` per chunk; `runJsonTask` passes `idle.note` down through `callAI` to each provider caller's stream reader, and `idle.deadline` as the retry bound.
  - `start()` is called per attempt, and the timer is cancelled as soon as an attempt is answered (`gameplay.js`, around the `callAI` await), so validation and salvage are not counted as silence and a retry gets the long window back.
- **Conversational** `callAI` callers accept an `opts.signal` too (advisor/diplomacy Stop button); on abort the just‑pushed history entry is popped.

---

## Quick reference: key exports

| Symbol | File | Role |
|--------|------|------|
| `callAI(systemPrompt, history, opts)` | `main.jsx` | Provider dispatch; returns string (chat) or `{rawText,toolInput}` (structured). |
| `sendMessage`, `sendDiplomaticMessage` | `main.jsx` | Advisor / leader chat turns. |
| `readOpenAIStreamedResponse`, `readAnthropicStreamedResponse`, `readGeminiStreamedResponse` | `streamAssembly.js` | SSE → that provider's normal envelope, so streaming is invisible downstream. |
| `getResolvedFallbackList`, `getTaskPick`, `getReasoningEnabled` | `providerConfig.js` | The Fallback list with each Connection folded in / a task's pick / reasoning toggle. |
| `runWithFallback`, `fallbackAvailability`, `entryStatus` | `fallbackRunner.js` | Run one call down the list / can anything answer now / what a Settings row shows. |
| `runJsonTask(taskKey, opts)` | `gameplay.js` | Structured task runner (2 attempts, validate/salvage, fallback; `lookups` declares the lookup functions). |
| `LOOKUP_TOOLS`, `LOOKUP_DIRECTIVE`, `buildLookupContext`, `executeLookup` | `lookupTools.js` | The lookup functions and their executor (see [Lookup functions](#lookup-functions-the-campaign-behind-function-calls)). |
| `appendLookupRound`, `geminiContentsFromHistory`, `openAiMessagesFromHistory`, `anthropicMessagesFromHistory`, `lookupCallsFrom*` | `toolTurns.js` | A lookup round stored once, rendered and read per provider. |
| `simulateTimelineJump`, `applyGameMasterCommand`, `generateActionSuggestions`, … | `gameplay.js` | Task entry points (see [catalog](#task-catalog)). |
| `getGameplayTool`, `validateGameplayPayload` | `gameplaySchemas.js` | taskKey → tool, payload schema check. See [AI schemas](ai-schemas.md). |

### Composable scripted-event rules

Scripted-event authoring separates eligibility from probability. Each dated event may have no conditions or a shallow condition group using `all`, `any`, or `at_least` (with `requiredCount`), plus a `percent` chance. No conditions means unconditional eligibility. Conditions are evaluated from canonical state once when the date is due; only if they pass is the chance rolled. The accepted outcome is persisted exactly once. Existing CSE-v1 `always`, `chance`, and `conditional` triggers normalize into this `rules` contract without changing valid behavior.

The authoring UI currently exposes only predicates backed by canonical state we trust enough for scenario contracts: polity existence, Political World actor existence, institution existence/membership/status, and puppet/subordination relationships. Legacy war predicates remain readable for compatibility but are deliberately hidden from authoring until the war ledger is hardened. Human-facing pickers store canonical IDs underneath and allow an explicit unresolved/custom token only for advanced future-entity authoring.
