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
| `src/Game/AI/gameplayPrompts.js`, `promptContext.js`, `defaultPrompts.json` | Prompt pack normalization + template rendering. See [AI prompts](ai-prompts.md). |
| `src/Game/AI/chatVisibility.js` | Which diplomatic chats a given polity is allowed to have read. Keeps a leader out of conversations it was not in. |
| `src/Game/AI/structuredMode.js` | The structured-output ladder (`tool → json_schema → json_object → text_json`), the per-provider setting, and the observer that offers it to the player. |
| `src/Game/AI/promptDedupe.js` | Skipping a call-time directive the template already carries, and collapsing a large block the prompt would otherwise send twice. |
| `src/Game/AI/usageStats.js` | Token counts and time-to-first-byte, normalized across the three providers' reporting shapes. |
| `src/Game/AI/jsonSalvage.js` | Tolerant parsing of a model's answer: think-block stripping, the answer sentinel, fenced and balanced-brace recovery. |
| `src/Game/AI/providerErrors.js` | Reading what a provider sent INSTEAD of an answer: busy vs rate-limited vs spent quota, streaming refusals, and deliberation-instead-of-tool-call. |

Every module in the second group is **import-free and unit-tested**, deliberately: `main.jsx` and `gameplay.js` reach settings, `fetch` and the DOM and cannot be tested at all, so the judgement calls are lifted out into files that can be.

---

## Supported providers

Defined in `PROVIDER_OPTIONS` at `src/Game/AI/providerConfig.js`. The selected provider is stored under the `api_provider` localStorage key and resolved by `getStoredProvider()` (`providerConfig.js`); `normalizeProvider` maps the legacy value `"custom"` → `"openai-compatible"` and falls back to `DEFAULT_PROVIDER` (`"gemini"`) for anything unknown.

| `value` | Label | Group | Caller (`main.jsx`) | Endpoint | Transport | Model discovery |
|---------|-------|-------|---------------------|----------|-----------|-----------------|
| `gemini` | Gemini | Native APIs | `callGemini` (`main.jsx`) | `generativelanguage.googleapis.com/v1beta` (hard‑coded, key in query) | **direct only** (`fetch`) | no |
| `openai` | OpenAI | Native APIs | `callOpenAI` → `callOpenAIStyleChatCompletions` (`main.jsx`) | `https://api.openai.com/v1` | `providerFetch` (direct, relay if local) | yes |
| `anthropic` | Anthropic | Native APIs | `callAnthropic` (`main.jsx`) | `https://api.anthropic.com/v1` | **direct only** (`fetch`, browser‑access opt‑in header) | no |
| `openai-compatible` | OpenAI Compatible | Gateways & self‑hosted | `callOpenAICompatible` (`main.jsx`) | user `endpoint` (default `http://localhost:11434/v1`) | `providerFetch` | yes |
| `anthropic-compatible` | Anthropic Compatible | Gateways & self‑hosted | `callAnthropicCompatible` (`main.jsx`) | user `endpoint` | `providerFetch` | no |

`callAI` (`main.jsx`) is the single switch over `getStoredProvider()`; `gemini` is the `default` branch. Before dispatch it appends a language directive (`languageDirective()`, [i18n](i18n.md)) so replies come back in the player's language at the source.

"OpenAI Compatible" is the catch‑all for Ollama, LM Studio, OpenRouter, vLLM, and other gateways speaking `/chat/completions`. "Anthropic Compatible" is a self‑hosted proxy speaking the Anthropic Messages API. Both share their native sibling's caller body but read a different settings namespace and are relay‑capable.

---

## Configuration & storage keys

All AI config lives in **browser `localStorage`** — never on a server. `PROVIDER_SETTINGS` (`providerConfig.js`) maps each provider's fields to their storage keys. Read via `getProviderSettings(provider)` (`providerConfig.js`), which always returns `{ provider, apiKey, endpoint, model, customParams }` (missing fields resolve to `""`).

| Provider | apiKey key | model key (default) | endpoint key (default) | customParams key | structuredMode key |
|----------|-----------|---------------------|------------------------|------------------|---|
| `gemini` | `gemini_api_key` | `gemini_model` (`gemini-3.5-flash-lite`) | — | `gemini_custom_params` | `gemini_structured_mode` (`auto`) |
| `openai` | `openai_api_key` | `openai_model` (`""` → discovery) | — (fixed) | `openai_custom_params` | `openai_structured_mode` (`auto`) |
| `anthropic` | `anthropic_api_key` | `anthropic_model` (`claude-haiku-4-5`) | — (fixed) | `anthropic_custom_params` | `anthropic_structured_mode` (`auto`) |
| `openai-compatible` | `openai_compatible_api_key` | `openai_compatible_model` (`""`) | `openai_compatible_endpoint` (`http://localhost:11434/v1`) | `openai_compatible_custom_params` | `openai_compatible_structured_mode` (`auto`) |
| `anthropic-compatible` | `anthropic_compatible_api_key` | `anthropic_compatible_model` (`claude-haiku-4-5`) | `anthropic_compatible_endpoint` (`""`) | `anthropic_compatible_custom_params` | `anthropic_compatible_structured_mode` (`auto`) |

Notes:
- **`structuredMode` exists on all five providers but is only READ by three** — `openai`, `openai-compatible` and `anthropic-compatible`, whose callers walk the ladder. Native Gemini and Anthropic enforce their own tool contracts, so the settings UI does not offer the control there; a stored value on those two is inert.
- **Legacy keys**: `openai-compatible` `endpoint`/`model` fall back to the pre‑rename `custom_api_endpoint`/`custom_api_model` keys (`readStoredValue`, `providerConfig.js`).
- **Settings‑form binding**: the settings UI reads/writes via `FORM_FIELD_MAP` (`providerConfig.js`), `loadProviderSettingsFormState()`, and `persistProviderSetting()`.
- **Default model constants** live in `main.jsx` too: `GEMINI_DEFAULT_MODEL` (`main.jsx`), `ANTHROPIC_DEFAULT_MODEL` (`main.jsx`), used as `resolveModel` fallbacks.

### `customParams` — the request‑body escape hatch

Each provider has a free‑text `customParams` field: a JSON object shallow‑merged **last** into the outgoing request body (`parseCustomParams`, `main.jsx`). It lets a player set body fields the UI doesn't expose (reasoning budgets, sampling params) and can override a built‑in key. Invalid JSON is warned and ignored — never fatal to a turn. A nested built‑in object (e.g. Gemini `generationConfig`) must be supplied whole to override any of its keys. For Anthropic, a `max_tokens` inside `customParams` is lifted into the token‑cap `Math.max` and then deleted so it can't fight the floor (`main.jsx`).

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

Ported from the abdulrahman-2005 fork. Every AI call names its task — the prompt-pack task key for `runJsonTask` calls (`jumpForward`, `timelineCurator`, `territoryDirector`…), the repair/briefing keys the direct calls pass, and `advisor` / `diplomacy` for the chats — and `resolveModel` (`main.jsx`) asks `getModelForTask(provider, taskKey)` (`providerConfig.js`) which model to run. A task override stored under `<provider>_model_<taskKey>` wins; a blank one falls through to the provider's default model and then to discovery, exactly as before. The field names are synthesized by `getSettingConfig` (`model_<taskKey>`), so `getProviderField`/`setProviderField` work on them with no per-task schema; `AI_TASK_ROUTING` lists the tasks the Settings panel shows (Settings → provider → **Per-task models**, collapsed by default). Overrides are per provider, so switching providers switches the whole set, and changing a task's model does not touch the provider's structured-output choice (only the base `model` field does).

### Configuration profiles and recent models

For `openai-compatible` and `anthropic-compatible`, Settings shows **Configuration profiles**: named endpoint/key/model/custom-params bundles stored as one JSON array under `ai_provider_presets` (`getSavedPresets`/`savePreset`/`updatePreset`/`deletePreset`). Three stock entries (Groq, OpenRouter, Local Ollama) are written on first read so they can be edited or deleted like any other; applying a profile that has no key keeps the key currently entered. `resolveModel` also records the model each call actually ran with (`saveRecentModel`, ten per provider under `ai_recent_models_<provider>`), and every model field — the provider's and the per-task ones — offers those as datalist suggestions (`getRecentModels`).

### Prompt caching: the static prefix

Ported from the abdulrahman-2005 fork. `runJsonTask` renders a task template with `renderTemplateCached` (`src/Game/AI/promptLayout.js`, import-free): the boundary is the first placeholder in the template whose key is not in `STATIC_PROMPT_KEYS` (the game-lifetime constants — `language`, `playerPolity`, `worldBeforeRoundOne`, `simulationRules`, the difficulty guidance, `startDate`, `numberOfRegions` and the helper keys that alias them), so everything before it is byte-identical from one call to the next within a campaign. The runner keeps that prefix as text, and once the directives and the de-duplication have rewritten the prompt it passes `staticPrefixEnd: staticPrefixEndOf(systemPrompt, prefix)` to `callAI` (null if the prompt no longer opens with the prefix). `callAnthropic` and `callAnthropicCompatible` turn a usable boundary into two `system` content blocks via `buildAnthropicSystemContent` — the prefix carries `cache_control: { type: "ephemeral" }`, the per-turn tail is plain — and prompts with no boundary, or a prefix under `MIN_CACHEABLE_PREFIX_CHARS`, go out as the string they always were. OpenAI and Gemini cache identical prefixes implicitly, so the layout alone helps them. Measured on the stock pack, the jump templates keep about two thirds of their text ahead of the first per-turn placeholder; `promptLayout.test.js` asserts that share so a template edit cannot silently throw the cache away.

Not taken from the fork: its v2/v3 prompt packs (frozen copies of older prompts with the call-time directives baked in — beta's `promptDedupe.js` already skips a directive the template carries) and its slim repair prompt for jump retries (beta's second attempt is the last one before the canned fallback and its validators lean on the template's context).

### Batch background tasks (Anthropic, opt-in)

Ported from the abdulrahman-2005 fork behind **Settings → AI → Batch background AI tasks** (`MAP_SETTING_KEYS.batchBackgroundTasks`, off by default). With it on and Anthropic selected, a `runJsonTask` call made with `sync: false` and an `onBatchResult` applier is submitted to the Message Batches API instead (`submitAIBatch`, `main.jsx`; one request per batch, the same tool and system prompt as the live call) and returns `{ deferred: true }` at once. `pollPendingBatches` (`gameplay.js`, a one-minute timer while anything is in flight, skipped while a simulation runs) retrieves finished batches (`retrieveAIBatch`), runs the schema check and the task's `validatePayload` in final-attempt mode, and hands the payload — or the task's deterministic fallback — to the applier; an applier that returns `false` (a simulation started meanwhile) is retried on the next poll. The registry is in memory: a reload orphans an in-flight batch. The only task using it is the event consolidator: `compactHistoryIfNeeded` supplies an applier that writes the `consolidatedHistory` entry out of band, unless a synchronous consolidation covered those events in the meantime; the jump that asked for it simply carries on with the events unconsolidated.

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

**Where a call starts** is `getProviderSettings(provider).structuredMode` — a per-provider setting, `auto` by default. `auto` starts at `tool`; anything else names a rung to begin at, skipping ones a gateway has already been shown to ignore. It is a starting point, never a lock: the ladder still steps down from wherever it starts, so a setting chosen months ago cannot strand a campaign. Changing the **model** resets it to `auto` (`setProviderField`), because the evidence behind the choice was about one model.

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


## The task runner: `runJsonTask`

`runJsonTask(taskKey, { fallback, signal, userMessage, validatePayload, variables })` (`gameplay.js`) is the structured‑generation core. Steps:

1. **Prompt assembly**: `renderTemplate(prompts.tasks[taskKey], { …variables, …helpers })`, then append call‑time directives: `difficultyDirective` for all tasks; `[Player Agency]` + `[Map Truth]` for `jumpForward`/`autoJumpForward` (`gameplay.js`); `[International Reputation]` for `actions`/jumps/catalyst tasks (`gameplay.js`). These are appended **at call time** because each save carries its own frozen copy of the prompts — a `defaultPrompts.json` edit never reaches existing campaigns.
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
| `jumpForward` | `submit_jump_result` | `simulateTimelineJump({mode:"jump"})` | Advance to a target date; events + impacts + catalyst → world state. |
| `autoJumpForward` | `submit_jump_result` | `simulateAutoJump` | Advance to the next notable moment. |
| `actions` | `submit_actions` | `generateActionSuggestions` | Strategic suggestion topics for the player. |
| `descriptionToAction` | `submit_description_to_action` | `refinePlayerAction` | Freeform intent → structured action/chat. |
| `nextSpeaker` | `submit_next_speaker` | `chooseNextDiplomaticSpeaker` | Pick next chat participant. |
| `eventConsolidator` | `submit_event_consolidation` | `consolidateRecentHistory` / auto `compactHistoryIfNeeded` | Compress old events/chats into a continuity summary. |
| `catalystCreation` | `submit_catalyst_creation` | `createCatalyst` | Open an interactive decision scene. |
| `catalystExecutor` | `submit_catalyst_execution` | `advanceActiveCatalyst` | Resolve a catalyst choice. |
| `catalystSummary` | `submit_catalyst_summary` | (within catalyst resolution) | Final event from a resolved catalyst. |
| `gameMaster` | `submit_game_master` | `applyGameMasterCommand` | GM console: apply free‑text world/map edits. |
| `countryStatSheet` | `submit_country_stat_sheet` | `generateCountryStatSheet` / `generateCountryStats` | National statistics sheet. |
| `timelineCurator` | `submit_timeline_curator` | `curateGeneratedEvents` (`nativeTimelineCurator.js`, from `applySimulationResult`) | Judges each fresh event against recent canon before it persists; deterministic gates (hard impacts, retrieved prior matches, saturation) decide what may be dropped, default KEEP. |
| `unitDirector` | `submit_unit_director` | `directGeneratedUnitOps` (`nativeUnitDirector.js`, from `finishTimelineJump`) | Keeps existing NPC formations coherent with the turn's military events: proposes spawn/move/strength/remove ops that native rules sanitize before they ride the normal unitOps path. |
| `idleDiplomacy` | `submit_idle_diplomacy` | `maybeSendIdleDiplomacy` | Optional unprompted diplomatic note. |
| `pregameHistory` | `submit_pregame_history` | `maybeGeneratePregameHistory` | Backstory events before the start date. |


---

## Strict / salvage validation discipline

Two validation layers run on a parsed payload; the second is where the strict/salvage contract lives.

1. **Schema** — `validateGameplayPayload(taskKey, parsed)` (`gameplaySchemas.js`) checks the payload against `GAMEPLAY_SCHEMAS[taskKey]` with a hand‑rolled validator (types, `enum`, `minLength`/`minItems`/`maxItems`, `required`, `additionalProperties:false`). See [AI schemas](ai-schemas.md).

2. **Semantic `validatePayload(candidate, { attempt, finalAttempt })`** — the caller‑supplied validator. The **`finalAttempt` flag comes from `runJsonTask` itself** (`gameplay.js`), never from counting invocations — a schema failure on attempt 1 skips this validator, which would otherwise make attempt 2 look "first" and leak strict feedback out as the fallback reason (a real field report). The contract:

   - **Attempt 1 (`strict = !finalAttempt`)**: shape problems return a **corrective error string**, which `runJsonTask` feeds back to the model as its one retry — the model usually fixes its own answer.
   - **Attempt 2 (final)**: a finished generation is **never rejected into the canned fallback** over cosmetics. Instead the payload is **salvaged in place**: dates clamped, unresolvable ops dropped, invalid entries pruned.

   The jump validator (`gameplay.js`) shows all three: strict event‑count check → `validateTimelineDates` (strict) vs `clampTimelineDates` (salvage, `gameplay.js`) → `validateGeneratedWorldChanges` with `strictTransfers: strict`.

   `validateGeneratedWorldChanges` (`gameplay.js`) is the map‑integrity gate:
   - **Region transfers**: `resolveRegionTransfers` (`gameplay.js`) canonicalizes each `regionId` — the prompt asks for a region's plain **name**, which must be resolved to a real map id (e.g. `DEU.2_1`) via the region catalog, owner‑aware for repeated names. Strict: unresolved names **fail** with the losing owner's real region list (`buildTransferFeedback`, `gameplay.js`) so the retry has the vocabulary; final: unresolved transfers are dropped (a phantom key never reaches world state).
   - **Reluctance guard** (strict only): an event whose text uses capture language (`CAPTURE_LANGUAGE`, `gameplay.js`) while the whole payload ships **zero** `regionTransfers` fails once — narration and the map must never disagree.
   - **Unit ops / marker ops / created chats / outreach**: each validated per entry; strict returns a path‑anchored error, salvage drops the bad entry (stale `unitId`, blank marker name, unresolvable chat participants) and keeps the turn.

---

## Applying world changes

Once a payload is accepted (region ids already canonicalized in place), the exported task functions write it back:

- **Jumps**: `applySimulationResult` (`gameplay.js`) normalizes events, advances `gameDate`/`round`, resolves planned actions to `resolved`, runs `applyEventImpactsToWorld` (from `runtime/gameState.js` — region ownership, polity changes, units, markers, colors), builds chats from `impacts.createdChats` + top‑level `diplomaticOutreach` via `buildGeneratedChat` (`gameplay.js`), optionally consolidates history, writes all state slices, and captures a rollback snapshot (`loadRollbackSnapshots`/`rollBackToSnapshot`, `gameplay.js`).
- **GM command**: `applyGameMasterCommand` (`gameplay.js`) turns the payload into a single GM event and applies its impacts the same way.
- The `generation` object (`{ source: "ai" | "fallback", fallbackReason }`) rides along into `simulationHistory` so the UI can show whether a turn was AI‑ or fallback‑generated.

See [World state](world-state.md) for the shape of what these writers touch, and [Game state persistence](game-state.md) for the read/write bundle helpers.

---

## Cancellation & timeouts

- **Player Cancel** passes an `AbortSignal` into `simulateTimelineJump`/etc → `runJsonTask` → `callAI` → `fetch`/relay. A deliberate cancel is re‑thrown as an `AbortError` and **does not** write state or fall back to canned events (`gameplay.js`).
- **Timeout** aborts the same controller but **does** use the deterministic fallback, because a stalled model shouldn't leave the turn with nothing. It measures **silence, not elapsed time**: the "Limit AI generation" setting (`ai_limit_generation`, **on** by default — read with `getMapSettingDefaultOn`) gives a task two windows: `AI_IDLE_TIMEOUT_MS` (5 minutes) with nothing arriving once an answer has started, and `AI_FIRST_BYTE_TIMEOUT_MS` (15 minutes) with no answer at all. Off disables both and generation waits as long as the model needs.
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
| `getStoredProvider`, `getProviderSettings`, `getReasoningEnabled` | `providerConfig.js` | Read selected provider / its settings / reasoning toggle. |
| `runJsonTask(taskKey, opts)` | `gameplay.js` | Structured task runner (2 attempts, validate/salvage, fallback). |
| `simulateTimelineJump`, `applyGameMasterCommand`, `generateActionSuggestions`, … | `gameplay.js` | Task entry points (see [catalog](#task-catalog)). |
| `getGameplayTool`, `validateGameplayPayload` | `gameplaySchemas.js` | taskKey → tool, payload schema check. See [AI schemas](ai-schemas.md). |
