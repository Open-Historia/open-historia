# AI System Overview

Open Historia drives every generative feature — the strategy advisor, leader diplomacy, timeline simulation, catalysts, stat sheets, and the game‑master console — through a single browser‑side AI layer under `src/Game/AI/`. The player's own API key talks **directly** to their chosen provider from the browser; there is no Open Historia backend in the loop except an optional same‑origin relay that only exists when the page is served from a machine the player controls. Two entry points sit on top of the transport: `callAI` for free‑form chat, and `runJsonTask` for schema‑validated structured "tasks" that mutate world state.

This page documents the plumbing. For the prompt templates and how they are assembled, see [AI prompts](ai-prompts.md); for the JSON tool/response schemas and per‑field meaning, see [AI schemas](ai-schemas.md); for what the applied changes touch, see [World state](world-state.md).

---

## Module map

| File | Responsibility |
|------|----------------|
| `src/Game/AI/main.jsx` | Transport. `callAI` dispatch, per‑provider callers, `providerFetch`/relay, streaming reassembly, advisor + diplomatic chat (`sendMessage`, `sendDiplomaticMessage`). |
| `src/Game/AI/providerConfig.js` | Provider registry, per‑provider storage keys/defaults, `getStoredProvider`, `getProviderSettings`, reasoning toggle. |
| `src/Game/AI/gameplay.js` | `runJsonTask` task runner + every gameplay task (jumps, catalysts, actions, GM, stat sheets, consolidation, idle diplomacy), validation/salvage, and applying results to world state. |
| `src/Game/AI/gameplaySchemas.js` | JSON Schemas, tool definitions, `getGameplayTool`, `validateGameplayPayload`. See [AI schemas](ai-schemas.md). |
| `src/Game/AI/gameplayPrompts.js`, `promptContext.js`, `defaultPrompts.json`, `gameplayPrompts.js` | Prompt pack normalization + template rendering. See [AI prompts](ai-prompts.md). |

---

## Supported providers

Defined in `PROVIDER_OPTIONS` at `src/Game/AI/providerConfig.js:4`. The selected provider is stored under the `api_provider` localStorage key and resolved by `getStoredProvider()` (`providerConfig.js:132`); `normalizeProvider` maps the legacy value `"custom"` → `"openai-compatible"` and falls back to `DEFAULT_PROVIDER` (`"gemini"`) for anything unknown.

| `value` | Label | Group | Caller (`main.jsx`) | Endpoint | Transport | Model discovery |
|---------|-------|-------|---------------------|----------|-----------|-----------------|
| `gemini` | Gemini | Native APIs | `callGemini` (`main.jsx:460`) | `generativelanguage.googleapis.com/v1beta` (hard‑coded, key in query) | **direct only** (`fetch`) | no |
| `openai` | OpenAI | Native APIs | `callOpenAI` → `callOpenAIStyleChatCompletions` (`main.jsx:702`) | `https://api.openai.com/v1` | `providerFetch` (direct, relay if local) | yes |
| `anthropic` | Anthropic | Native APIs | `callAnthropic` (`main.jsx:770`) | `https://api.anthropic.com/v1` | **direct only** (`fetch`, browser‑access opt‑in header) | no |
| `openai-compatible` | OpenAI Compatible | Gateways & self‑hosted | `callOpenAICompatible` (`main.jsx:736`) | user `endpoint` (default `http://localhost:11434/v1`) | `providerFetch` | yes |
| `anthropic-compatible` | Anthropic Compatible | Gateways & self‑hosted | `callAnthropicCompatible` (`main.jsx:858`) | user `endpoint` | `providerFetch` | no |

`callAI` (`main.jsx:942`) is the single switch over `getStoredProvider()`; `gemini` is the `default` branch. Before dispatch it appends a language directive (`languageDirective()`, [i18n](i18n.md)) so replies come back in the player's language at the source.

"OpenAI Compatible" is the catch‑all for Ollama, LM Studio, OpenRouter, vLLM, and other gateways speaking `/chat/completions`. "Anthropic Compatible" is a self‑hosted proxy speaking the Anthropic Messages API. Both share their native sibling's caller body but read a different settings namespace and are relay‑capable.

---

## Configuration & storage keys

All AI config lives in **browser `localStorage`** — never on a server. `PROVIDER_SETTINGS` (`providerConfig.js:42`) maps each provider's fields to their storage keys. Read via `getProviderSettings(provider)` (`providerConfig.js:157`), which always returns `{ provider, apiKey, endpoint, model, customParams }` (missing fields resolve to `""`).

| Provider | apiKey key | model key (default) | endpoint key (default) | customParams key |
|----------|-----------|---------------------|------------------------|------------------|
| `gemini` | `gemini_api_key` | `gemini_model` (`gemini-3.1-flash-lite-preview`) | — | `gemini_custom_params` |
| `openai` | `openai_api_key` | `openai_model` (`""` → discovery) | — (fixed) | `openai_custom_params` |
| `anthropic` | `anthropic_api_key` | `anthropic_model` (`claude-haiku-4-5`) | — (fixed) | `anthropic_custom_params` |
| `openai-compatible` | `openai_compatible_api_key` | `openai_compatible_model` (`""`) | `openai_compatible_endpoint` (`http://localhost:11434/v1`) | `openai_compatible_custom_params` |
| `anthropic-compatible` | `anthropic_compatible_api_key` | `anthropic_compatible_model` (`claude-haiku-4-5`) | `anthropic_compatible_endpoint` (`""`) | `anthropic_compatible_custom_params` |

Notes:
- **Legacy keys**: `openai-compatible` `endpoint`/`model` fall back to the pre‑rename `custom_api_endpoint`/`custom_api_model` keys (`readStoredValue`, `providerConfig.js:109`).
- **Settings‑form binding**: the settings UI reads/writes via `FORM_FIELD_MAP` (`providerConfig.js:85`), `loadProviderSettingsFormState()`, and `persistProviderSetting()`.
- **Default model constants** live in `main.jsx` too: `GEMINI_DEFAULT_MODEL` (`main.jsx:23`), `ANTHROPIC_DEFAULT_MODEL` (`main.jsx:24`), used as `resolveModel` fallbacks.

### `customParams` — the request‑body escape hatch

Each provider has a free‑text `customParams` field: a JSON object shallow‑merged **last** into the outgoing request body (`parseCustomParams`, `main.jsx:105`). It lets a player set body fields the UI doesn't expose (reasoning budgets, sampling params) and can override a built‑in key. Invalid JSON is warned and ignored — never fatal to a turn. A nested built‑in object (e.g. Gemini `generationConfig`) must be supplied whole to override any of its keys. For Anthropic, a `max_tokens` inside `customParams` is lifted into the token‑cap `Math.max` and then deleted so it can't fight the floor (`main.jsx:803`, `main.jsx:892`).

### Reasoning toggle

A single global toggle (`ai_reasoning_enabled` key) is read by `getReasoningEnabled()` (`providerConfig.js:174`). **On by default** — only an explicit `"0"` disables it, so a fresh install gets model reasoning without opting in. `callAI` honors it in every provider mode:

| Provider mode | Reasoning knob when ON | Source |
|---------------|------------------------|--------|
| Gemini | `generationConfig.thinkingConfig.thinkingBudget: 8192` | `main.jsx:490` |
| OpenAI / compatible | `reasoning_effort: "medium"` (sent in every mode incl. tool calls) | `main.jsx:594` |
| OpenAI compatible, local | additionally `enable_thinking: true` (Qwen3/Seed‑OSS local template key) | `main.jsx:601` |
| Anthropic / compatible | `thinking: { type: "enabled", budget_tokens: 4096 }` (only when **not** a tool call), `max_tokens` raised to fit | `main.jsx:811`, `main.jsx:900` |

If a provider rejects `tools` + `reasoning_effort` together (documented 400/422), the OpenAI‑style caller retries once with reasoning stripped (`disableToolReasoning`, `main.jsx:637`), then sends `reasoning_effort: "none"` in tool mode.

---

## Where the key goes: direct calls, origin, and the relay

The whole security model is in the comment block at `main.jsx:225`. AI calls go **straight from the browser to the provider** so the player's key only ever reaches the provider — never an Open Historia server or a community node. Direct is always tried first.

- **`PAGE_IS_LOCAL`** (`main.jsx:250`, from `isLocallyServed()`): true when the page is served from a machine the player controls — `localhost`/`127.0.0.1`/`::1`/`*.local` or the LAN private ranges `10.*`, `192.168.*`, `172.16–31.*`. The LAN ranges cover the Android client, which loads the UI from a local server on the home network.
- **`providerFetch(url, options)`** (`main.jsx:303`): tries `directFetch`; on a CORS/network `TypeError` (not an abort) **and** only when `PAGE_IS_LOCAL`, it remembers the origin in `relayOnlyOrigins` and retries through the same‑origin `/api/ai/relay` (`relayFetch`, `main.jsx:284`). A remembered origin skips the doomed direct attempt on later calls.
- On a **hosted website** there is no relay: every call is direct‑only and the key is never handed to anything but the provider. If a hosted page tries to reach a **local** backend (Ollama/LM Studio) and the browser rejects it, `providerFetch` throws an actionable error telling the user to set `OLLAMA_ORIGINS`/enable CORS (`main.jsx:321`).
- **Who uses the relay**: only the `providerFetch` callers — `openai`, `openai-compatible`, `anthropic-compatible`, and model discovery (`GET /models`). **Native Gemini and native Anthropic bypass `providerFetch` entirely** (plain `fetch`), because both explicitly allow browser calls (Anthropic via the `anthropic-dangerous-direct-browser-access: true` header, `main.jsx:795`). They are therefore always direct, relay or not.

`isLocalEndpoint(url)` (`main.jsx:269`) is the per‑endpoint sibling of `PAGE_IS_LOCAL`; it also gates local streaming (below).

---

## Model resolution

`resolveModel(provider, opts)` (`main.jsx:413`) picks the model for a call:

1. A configured `model` in settings wins (Gemini strips a `models/` prefix).
2. Else the caller's `fallbackModel` (Gemini/Anthropic native/compatible defaults).
3. Else, if `providerSupportsModelDiscovery(provider)` (only `openai` and `openai-compatible`, `providerConfig.js:141`), `GET {endpoint}/models` and pick a likely chat model via `pickLikelyChatModel` (`main.jsx:122`) against `CHAT_MODEL_HINTS`/`NON_CHAT_MODEL_HINTS` (`main.jsx:28`). The discovered id is persisted back with `setProviderField`.
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

`sendMessage` (`main.jsx:1084`) and `sendDiplomaticMessage` (`main.jsx:1138`) build a system prompt, push the user turn onto a module‑level history (`advisorHistory` / `diplomaticHistory`, compacted by `compactConversationHistory` at `main.jsx:1070`), call `callAI` **without a `tool`** (plain text reply), and append the reply. On error the pushed user turn is popped so history isn't corrupted. `startChat`/`loadHistory`/`startDiplomaticChat`/`loadDiplomaticHistory` manage those histories. Diplomatic replies may carry a trailing `REACTION:<emoji>` line parsed off by `parseReaction` (`main.jsx:1130`).

---

## Transport internals per provider

`callAI` (`main.jsx:942`) → one of five callers. Shared retry/abort machinery:

- **Retries**: `retries = 3`, `retryDelay = 15000` ms. Retried on `429`/`503` (Gemini treats `429` as fatal "quota exhausted", `main.jsx:509`). Guarded by `canRetryBeforeDeadline(deadline, retryDelay)` (`main.jsx:67`) so a retry that would overrun the deadline is not attempted.
- **Abort**: an `AbortSignal` (`signal`) propagates from `runJsonTask`'s controller through the caller to `fetch`/relay. An `AbortError` never triggers the relay fallback and never falls back to canned events (see [Cancellation](#cancellation--timeouts)).
- **Errors**: `readErrorPayload`/`extractErrorMessage` (`main.jsx:78`) surface the provider's own message.

### Structured output modes (per provider)

`callAI` passes `tool` (a `{ name, description, schema }` from `getGameplayTool`) for structured tasks. Each provider forces exactly that one tool:

| Provider | Forcing mechanism | Extractor |
|----------|-------------------|-----------|
| Gemini | `tools.functionDeclarations` + `toolConfig.functionCallingConfig.mode: "ANY"`, `allowedFunctionNames:[tool.name]`; schema stripped of `additionalProperties`/`$schema` via `toGeminiSchema` | `extractGeminiToolInput` (`main.jsx:148`) |
| OpenAI / compatible | `tools:[{type:"function",…}]` + `tool_choice: "required"` (string form — llama.cpp servers reject the object form, `main.jsx:611`) | `extractOpenAIToolInput` (`main.jsx:176`) |
| Anthropic / compatible | `tools:[{name,…,input_schema}]` + `tool_choice:{type:"tool",name}` | `extractAnthropicToolInput` (`main.jsx:205`) |

The OpenAI‑style caller runs a **`structuredMode` state machine** (`main.jsx:563`): `tool` → on 400/422, either strip reasoning, or (only when `allowJsonSchemaFallback`, i.e. **compatible only**) fall through `json_schema` → `json_object` → `text_json` (schema inlined into the system prompt). Native OpenAI keeps `allowJsonSchemaFallback: false` (`main.jsx:730`) and stays in tool mode. Each caller returns either a plain string (chat) or `{ rawText, toolInput }` (structured).

### Streaming vs buffered

Cloud providers use a **buffered** path (`await response.json()`). **Streaming is used only for local OpenAI‑compatible endpoints**, and only to make Cancel physical:

- `streamLocalEndpoint = isLocalEndpoint(endpoint)` (`main.jsx:575`). When true, `stream: true` is added to the body (`main.jsx:583`). Local inference servers (llama.cpp, LM Studio, Ollama) only notice a dead socket on their next token write; without streaming a cancelled non‑streaming request keeps generating the whole completion. Streaming makes the next token write fail, stopping inference within a token or two.
- The response is branched on the **actual** `content-type`, not on what was asked: `text/event-stream` → `readOpenAIStreamedResponse` (`main.jsx:343`), else `response.json()` (`main.jsx:681`). `readOpenAIStreamedResponse` reassembles SSE `data:` deltas (content + `tool_calls` arguments + `finish_reason`) back into a normal chat‑completions object so the existing extractors work unchanged.
- Anthropic‑compatible does **not** stream even when local; Gemini and native Anthropic never stream.

### maxTokens / token‑cap semantics

`runJsonTask` always passes `maxTokens: 8192` (`gameplay.js:455`) — one request budget for every task. What each provider does with it:

| Provider | Body field | Value actually sent | Notes |
|----------|-----------|---------------------|-------|
| Gemini | *(none)* | not sent | Gemini ignores the cap entirely; no `maxOutputTokens` unless supplied via `customParams`. |
| OpenAI | `max_completion_tokens` | `Math.max(8192, maxTokens)` | `tokenLimitField: "max_completion_tokens"` (`main.jsx:731`). |
| OpenAI compatible | `max_tokens` | `Math.max(8192, maxTokens)` | `tokenLimitField: "max_tokens"` (`main.jsx:765`). |
| Anthropic | `max_tokens` (required) | `Math.max(8192, maxTokens, customParams.max_tokens)` | raised further when extended thinking is on so `max_tokens` exceeds the 4096 thinking budget (`main.jsx:803`). |
| Anthropic compatible | `max_tokens` | same as Anthropic | `main.jsx:892`. |

So `maxTokens` is a **per‑response output ceiling only for providers that take one**, floored at 8192; capped providers are floored, Gemini ignores it. This is why jump tasks stopped requesting 16384 — it only raised the ceiling on capped providers and changed nothing on Gemini.

---

## The task runner: `runJsonTask`

`runJsonTask(taskKey, { fallback, signal, timeoutMs, userMessage, validatePayload, variables })` (`gameplay.js:382`) is the structured‑generation core. Steps:

1. **Prompt assembly**: `renderTemplate(prompts.tasks[taskKey], { …variables, …helpers })`, then append call‑time directives: `difficultyDirective` for all tasks; `[Player Agency]` + `[Map Truth]` for `jumpForward`/`autoJumpForward` (`gameplay.js:411`); `[International Reputation]` for `actions`/jumps/catalyst tasks (`gameplay.js:425`). These are appended **at call time** because each save carries its own frozen copy of the prompts — a `defaultPrompts.json` edit never reaches existing campaigns.
2. **Deadline/abort wiring**: an internal `AbortController` is aborted by (a) the external `signal` (player Cancel) or (b) a `timeoutMs` timer (`gameplay.js:441`). `timeoutMs` default is 120000 ms; jumps pass `0` (no deadline) unless the "Limit AI generation" map setting opts into a 5‑minute bound (`gameplay.js:1888`).
3. **Two output attempts** (`gameplay.js:447`): call `callAI` with the task `tool` and `maxTokens: 8192`; parse `response.toolInput ?? extractJsonPayload(rawText)`; run `validateGameplayPayload(taskKey, parsed)` (schema) then the caller's `validatePayload`. On attempt‑1 failure it pushes the model's answer + a corrective instruction into `history` and retries once. A model that used a tool is told to "call it again"; a prose model is told to "respond with ONLY the corrected JSON".
4. **Outcome**: valid → `{ generation:{source:"ai"}, payload }`. Both attempts fail → deterministic `fallback()` with `generation.source:"fallback"` and the `failureReason`. No `fallback` → throw. A user **abort** is re‑thrown, never falling back (`gameplay.js:513`).

### `extractJsonPayload` — tolerant parsing

`extractJsonPayload` (`gameplay.js:284`) is what makes small/local models usable without tool support: strips `<think>…</think>` blocks, tries a lenient parse (`lenientJsonParse` repairs smart quotes and trailing commas, `gameplay.js:230`), then any ```` ``` ```` fenced block, then every balanced top‑level `{…}`/`[…]` via a string‑aware scan (`balancedJsonCandidates`, `gameplay.js:243`), objects preferred over stray arrays. Repairs are attempted **only after** a strict parse fails, so well‑formed output is untouched.

---

## Task catalog

`taskKey` → schema (`GAMEPLAY_SCHEMAS`, `gameplaySchemas.js:621`) → tool (`GAMEPLAY_TOOLS`, `gameplaySchemas.js:717`). Exported callers in `gameplay.js`:

| taskKey | Tool name | Exported fn (`gameplay.js`) | Purpose / applied to |
|---------|-----------|-----------------------------|----------------------|
| `jumpForward` | `submit_jump_result` | `simulateTimelineJump({mode:"jump"})` (`:1852`) | Advance to a target date; events + impacts + catalyst → world state. |
| `autoJumpForward` | `submit_jump_result` | `simulateAutoJump` (`:1946`) | Advance to the next notable moment. |
| `actions` | `submit_actions` | `generateActionSuggestions` (`:1430`) | Strategic suggestion topics for the player. |
| `descriptionToAction` | `submit_description_to_action` | `refinePlayerAction` (`:1597`) | Freeform intent → structured action/chat. |
| `nextSpeaker` | `submit_next_speaker` | `chooseNextDiplomaticSpeaker` (`:1630`) | Pick next chat participant. |
| `eventConsolidator` | `submit_event_consolidation` | `consolidateRecentHistory` / auto `compactHistoryIfNeeded` (`:1662`, `:554`) | Compress old events/chats into a continuity summary. |
| `catalystCreation` | `submit_catalyst_creation` | `createCatalyst` (`:1670`) | Open an interactive decision scene. |
| `catalystExecutor` | `submit_catalyst_execution` | `advanceActiveCatalyst` (`:1701`) | Resolve a catalyst choice. |
| `catalystSummary` | `submit_catalyst_summary` | (within catalyst resolution, `:1775`) | Final event from a resolved catalyst. |
| `gameMaster` | `submit_game_master` | `applyGameMasterCommand` (`:1949`) | GM console: apply free‑text world/map edits. |
| `countryStatSheet` | `submit_country_stat_sheet` | `generateCountryStatSheet` / `generateCountryStats` (`:1580`, `:1551`) | National statistics sheet. |
| `idleDiplomacy` | `submit_idle_diplomacy` | `maybeSendIdleDiplomacy` / `maybeRunIdlePulse` | The between-rounds world pulse: an optional unprompted diplomatic note, up to two unit ops, and an optional intel sighting. |
| `pregameHistory` | `submit_pregame_history` | `maybeGeneratePregameHistory` (`:2050`) | Backstory events before the start date. |

---

## Strict / salvage validation discipline

Two validation layers run on a parsed payload; the second is where the strict/salvage contract lives.

1. **Schema** — `validateGameplayPayload(taskKey, parsed)` (`gameplaySchemas.js:852`) checks the payload against `GAMEPLAY_SCHEMAS[taskKey]` with a hand‑rolled validator (types, `enum`, `minLength`/`minItems`/`maxItems`, `required`, `additionalProperties:false`). See [AI schemas](ai-schemas.md).

2. **Semantic `validatePayload(candidate, { attempt, finalAttempt })`** — the caller‑supplied validator. The **`finalAttempt` flag comes from `runJsonTask` itself** (`gameplay.js:474`), never from counting invocations — a schema failure on attempt 1 skips this validator, which would otherwise make attempt 2 look "first" and leak strict feedback out as the fallback reason (a real field report). The contract:

   - **Attempt 1 (`strict = !finalAttempt`)**: shape problems return a **corrective error string**, which `runJsonTask` feeds back to the model as its one retry — the model usually fixes its own answer.
   - **Attempt 2 (final)**: a finished generation is **never rejected into the canned fallback** over cosmetics. Instead the payload is **salvaged in place**: dates clamped, unresolvable ops dropped, invalid entries pruned.

   The jump validator (`gameplay.js:1897`) shows all three: strict event‑count check → `validateTimelineDates` (strict) vs `clampTimelineDates` (salvage, `gameplay.js:187`) → `validateGeneratedWorldChanges` with `strictTransfers: strict`.

   `validateGeneratedWorldChanges` (`gameplay.js:1002`) is the map‑integrity gate:
   - **Region transfers**: `resolveRegionTransfers` (`gameplay.js:831`) canonicalizes each `regionId` — the prompt asks for a region's plain **name**, which must be resolved to a real map id (e.g. `DEU.2_1`) via the region catalog, owner‑aware for repeated names. Strict: unresolved names **fail** with the losing owner's real region list (`buildTransferFeedback`, `gameplay.js:940`) so the retry has the vocabulary; final: unresolved transfers are dropped (a phantom key never reaches world state).
   - **Reluctance guard** (strict only): an event whose text uses capture language (`CAPTURE_LANGUAGE`, `gameplay.js:994`) while the whole payload ships **zero** `regionTransfers` fails once — narration and the map must never disagree.
   - **Unit ops / marker ops / created chats / outreach**: each validated per entry; strict returns a path‑anchored error, salvage drops the bad entry (stale `unitId`, blank marker name, unresolvable chat participants) and keeps the turn.

---

## Applying world changes

Once a payload is accepted (region ids already canonicalized in place), the exported task functions write it back:

- **Jumps**: `applySimulationResult` (`gameplay.js:1305`) normalizes events, advances `gameDate`/`round`, resolves planned actions to `resolved`, runs `applyEventImpactsToWorld` (from `runtime/gameState.js` — region ownership, polity changes, units, markers, colors), builds chats from `impacts.createdChats` + top‑level `diplomaticOutreach` via `buildGeneratedChat` (`gameplay.js:762`), optionally consolidates history, writes all state slices, and captures a rollback snapshot (`loadRollbackSnapshots`/`rollBackToSnapshot`, `gameplay.js:1278`).
- **GM command**: `applyGameMasterCommand` (`gameplay.js:1949`) turns the payload into a single GM event and applies its impacts the same way.
- The `generation` object (`{ source: "ai" | "fallback", fallbackReason }`) rides along into `simulationHistory` so the UI can show whether a turn was AI‑ or fallback‑generated.

See [World state](world-state.md) for the shape of what these writers touch, and [Game state persistence](game-state.md) for the read/write bundle helpers.

---

## Cancellation & timeouts

- **Player Cancel** passes an `AbortSignal` into `simulateTimelineJump`/etc → `runJsonTask` → `callAI` → `fetch`/relay. A deliberate cancel is re‑thrown as an `AbortError` and **does not** write state or fall back to canned events (`gameplay.js:513`).
- **Timeout** (`timeoutMs`) aborts the same controller but **does** use the deterministic fallback, because a slow model shouldn't leave the turn with nothing. Jumps default to no timeout (wait as long as the model needs); the "Limit AI generation" setting imposes 5 minutes.
- **Conversational** `callAI` callers accept an `opts.signal` too (advisor/diplomacy Stop button); on abort the just‑pushed history entry is popped.

---

## Quick reference: key exports

| Symbol | File | Role |
|--------|------|------|
| `callAI(systemPrompt, history, opts)` | `main.jsx:942` | Provider dispatch; returns string (chat) or `{rawText,toolInput}` (structured). |
| `sendMessage`, `sendDiplomaticMessage` | `main.jsx:1084`, `:1138` | Advisor / leader chat turns. |
| `readOpenAIStreamedResponse` | `main.jsx:343` | SSE → chat‑completions reassembly (local streaming). |
| `getStoredProvider`, `getProviderSettings`, `getReasoningEnabled` | `providerConfig.js:132`, `:157`, `:174` | Read selected provider / its settings / reasoning toggle. |
| `runJsonTask(taskKey, opts)` | `gameplay.js:382` | Structured task runner (2 attempts, validate/salvage, fallback). |
| `simulateTimelineJump`, `applyGameMasterCommand`, `generateActionSuggestions`, … | `gameplay.js` | Task entry points (see [catalog](#task-catalog)). |
| `getGameplayTool`, `validateGameplayPayload` | `gameplaySchemas.js:733`, `:852` | taskKey → tool, payload schema check. See [AI schemas](ai-schemas.md). |
