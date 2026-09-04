# AI Return Schemas & Validation

Every AI gameplay task in Open Historia hands the model a JSON Schema (as a provider "tool") and gets back a JSON object it must trust before mutating the world. This page documents the schemas the model must return (`src/Game/AI/gameplaySchemas.js`), the hand-rolled two-layer validator that gates every response, and the strict-vs-salvage retry discipline in `runJsonTask` (`src/Game/AI/gameplay.js`) that decides whether a bad answer earns a corrective retry or gets repaired in place. If you are adding a field the model should emit, read the [`additionalProperties: false` trap](#the-additionalpropertiesfalse-trap) first — it is the single most common way a new feature silently does nothing.

Related pages: [World state](world-state.md) (what these payloads mutate), [AI providers](ai-providers.md) (how the schema becomes a tool call in `main.jsx`), [Gameplay orchestration](ai-gameplay.md) (the task callers), [Gameplay prompts](gameplay-prompts.md) (the templates rendered alongside each schema).

---

## 1. The big picture: two files, two validation layers

| Concern | File | What it holds |
|---|---|---|
| Schema definitions + generic validator | `src/Game/AI/gameplaySchemas.js` | `GAMEPLAY_SCHEMAS`, `GAMEPLAY_TOOLS`, `validateGameplayPayload` |
| Task orchestration + world-aware validator | `src/Game/AI/gameplay.js` | `runJsonTask`, `validateGeneratedWorldChanges`, timeline/pregame validators, JSON recovery |
| Provider wire format | `src/Game/AI/main.jsx` | `callAI` — turns a `tool` into Gemini/OpenAI/Anthropic tool calls, extracts `toolInput` |

A response passes through **two independent validation layers** before it is accepted (`gameplay.js:461-477`):

1. **Layer 1 — schema + generic invariants** (`validateGameplayPayload`, always runs). Structural: types, required keys, `additionalProperties`, ranges, plus per-task rules like the gdpBreakdown sum and distinct-choice checks. Pure function of the payload; knows nothing about the current game.
2. **Layer 2 — the `validatePayload` callback** (optional, world-aware). Only some callers supply it (`jumpForward`, `autoJumpForward`, `gameMaster`, `pregameHistory`, `idleDiplomacy`). It gets `{ attempt, finalAttempt }` and can consult live world state — e.g. `validateGeneratedWorldChanges` resolves region names against the real map. This is where strict-vs-salvage lives.

Both layers return a string error (`""` means valid). A non-empty error on attempt 1 becomes the corrective feedback the model sees on its one retry.

---

## 2. Task registry: schema, tool, and task key

Each task is identified by a **task key**. `GAMEPLAY_SCHEMAS` maps the key to its schema; `GAMEPLAY_TOOLS` maps it to a `{ name, description, schema }` tool object built by `makeTool` (`gameplaySchemas.js:637`). `getGameplayTool(taskKey)` (`:733`) is what `runJsonTask` calls to get the provider tool; `validateGameplayPayload(taskKey, value)` (`:852`) is what validates the result.

| Task key | Schema export | Tool name (provider function name) | Called from |
|---|---|---|---|
| `actions` | `ACTIONS_SCHEMA` | `submit_actions` | `generateActions` |
| `jumpForward` | `JUMP_FORWARD_SCHEMA` | `submit_jump_result` | `simulateTimelineJump` |
| `autoJumpForward` | `AUTO_JUMP_FORWARD_SCHEMA` (**= `JUMP_FORWARD_SCHEMA`**, `:429`) | `submit_jump_result` | `simulateAutoJump` |
| `descriptionToAction` | `DESCRIPTION_TO_ACTION_SCHEMA` | `submit_description_to_action` | freeform-intent → command |
| `nextSpeaker` | `NEXT_SPEAKER_SCHEMA` | `submit_next_speaker` | diplomatic chat turn order |
| `eventConsolidator` | `EVENT_CONSOLIDATOR_SCHEMA` | `submit_event_consolidation` | `consolidateHistoryBatch` |
| `catalystCreation` | `CATALYST_CREATION_SCHEMA` (**= `catalystSchema`**, `:517`) | `submit_catalyst_creation` | catalyst scene creation |
| `catalystExecutor` | `CATALYST_EXECUTOR_SCHEMA` | `submit_catalyst_execution` | advance a catalyst |
| `catalystSummary` | `CATALYST_SUMMARY_SCHEMA` | `submit_catalyst_summary` | resolved catalyst → event |
| `gameMaster` | `GAME_MASTER_SCHEMA` | `submit_game_master` | `applyGameMasterCommand` |
| `countryStatSheet` | `COUNTRY_STAT_SHEET_SCHEMA` | `submit_country_stat_sheet` | national stat sheet |
| `timelineCurator` | `TIMELINE_CURATOR_SCHEMA` | `submit_timeline_curator` | one judgment per fresh event; native gates in `nativeTimelineCurator.js` decide what a judgment may remove |
| `unitDirector` | `UNIT_DIRECTOR_SCHEMA` | `submit_unit_director` | unit operations for the turn's military events (sanitized by `nativeUnitDirector.js`) |
| `idleDiplomacy` | `IDLE_DIPLOMACY_SCHEMA` | `submit_idle_diplomacy` | idle inbox drip |
| `pregameHistory` | `PREGAME_HISTORY_SCHEMA` | `submit_pregame_history` | pre-game backstory |

`getGameplayTool` returns `null` for an unknown key; `validateGameplayPayload` returns `{ valid: false, error: "Unknown gameplay task key: …" }` (`:854`).

### How a schema becomes a tool call

`callAI` (`main.jsx`) receives the `tool` and adapts it per provider (`main.jsx:494-627`):

- **Gemini** — `tools: [{ functionDeclarations: [{ name, description, parameters: toGeminiSchema(schema) }] }]`, forced via `allowedFunctionNames`. `toGeminiSchema` **strips `additionalProperties` and `$schema`** recursively (`main.jsx:211-219`) — Gemini rejects those keys.
- **OpenAI-compatible** — `tools: [{ type: "function", function: { name, description, parameters: schema } }]` in `tool` mode; falls back to `response_format: { type: "json_schema", … }` and then `{ type: "json_object" }` on 400/422 (`main.jsx:605-650`). The schema is sent **verbatim, including `additionalProperties: false`**.
- **Anthropic** — native `tool_use`; `extractAnthropicToolInput` reads `block.input`.

The parsed arguments come back as `response.toolInput`. `runJsonTask` prefers that; if the model answered in prose (local models with no tool support), it falls back to `extractJsonPayload(rawText)` (`gameplay.js:460`).

---

## 3. Shared building blocks

Small factory helpers keep the schemas DRY (`gameplaySchemas.js:1-15`, `:562`):

| Helper | Produces | Notes |
|---|---|---|
| `textSchema(desc)` | `{ type: "string", description }` | optional free text |
| `nonEmptyTextSchema(desc)` | `textSchema` + `minLength: 1` | enforced by the validator's `minLength` check |
| `stringArraySchema(desc)` | `{ type: "array", items: { type: "string" } }` | e.g. `aliases`, `tags`, `invitees` |
| `percentageSchema(desc)` | `{ type: "integer", minimum: 0, maximum: 100 }` | all stat-sheet indices |

Every object schema sets `additionalProperties: false`. Understand what that means before adding fields — see [§7](#7-the-additionalpropertiesfalse-trap).

---

## 4. Payload schemas — field tables

Only fields listed in a schema's `properties` are legal; anything else is rejected. "Req?" is membership in the schema's `required` array. Sub-schemas are broken out so you can trace nesting.

### 4.1 `impactsSchema` — structured world-state effects (`:282`)

The heart of the map-mutating pipeline. Attached to events (`eventSchema.impacts`) and to `GAME_MASTER_SCHEMA.impacts`. "Include only effect arrays that are relevant." Consumed by `validateGeneratedWorldChanges` and then applied to [world state](world-state.md).

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `actionIds` | `string[]` | Player action ids this event resolves | no |
| `createdChats` | `createdChatSchema[]` | Diplomatic chats the event opens toward the player | no |
| `polityChanges` | `polityChangeSchema[]` | Polity metadata changes (name/color/reputation/tags…) | no |
| `regionTransfers` | `regionTransferSchema[]` | **Map ownership changes.** Required by prompt whenever narration says territory changed hands — one entry per region | no |
| `regionClaims` | `regionClaimSchema[]` | **Territory claimed but not held.** Marks a region disputed (striped) *without* moving the border — an irredentist declaration, a proclaimed union, a contested frontier. `drop: true` withdraws a claim | no |
| `unitOps` | `unitOpSchema[]` | Military unit mutations | no |
| `markerOps` | `markerOpSchema[]` | Structures built/destroyed on the map | no |

### 4.2 `regionTransferSchema` (`:90`)

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `regionId` | string | Exact region id **or plain name** (engine resolves names → ids) | **yes** |
| `regionName` | string | Human-readable name, when known | no |
| `fromCode` | string | Previous owner polity code — lets the resolver locate the region | no |
| `toCode` | string | New owner polity code | **yes** |
| `note` | string | Brief reason | no |

### 4.3 `polityChangeSchema` (`:107`)

A creation/rename/recolor/metadata change. Only `code` is required; send other fields **only when they change**.

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `code` | string | Exact polity code | **yes** |
| `name` | string | New name, only when it changes | no |
| `color` | string | New six-digit hex color, only when it changes | no |
| `aliases` | `string[]` | Alternative names | no |
| `reputation` | number | International reputation 0–100, only when it changes (0 = pariah, 100 = universally trusted) | no |
| `tags` | `string[]` | Complete new trait list (ideology/alignment/posture) — send the whole list, not a delta | no |
| `note` | string | Brief reason | no |

> `reputation` is the canonical example of the [`additionalProperties: false` trap](#7-the-additionalpropertiesfalse-trap): the prompt asked for it and `gameState` clamped/wrote it, but it was **absent from `properties`** — so a strict `json_schema` provider could never emit it and reputation silently never moved. Declaring it (`:119`) is what connected the feature.

### 4.4 `unitOpSchema` — `anyOf` on `op` (`:178`)

Not a single object: an `anyOf` of four shapes discriminated by `op`. Each branch is `additionalProperties: false`, so fields from one op leaking into another fail validation.

| `op` | Required fields | Payload |
|---|---|---|
| `spawn` | `op`, `unit` | full `unitSchema` object |
| `move` | `op`, `unitId`, `toLng`, `toLat` | + optional `regionId`, `note` |
| `strength` | `op`, `unitId`, `strength` | `strength` integer 0–1000 |
| `remove` | `op`, `unitId` | + optional `note` |

`unitSchema` (`:136`) fields: `id`, `name`* (nonempty), `type`* (enum: `infantry|armor|air|naval|artillery|garrison`), `ownerCode`* (nonempty), `strength`* (integer 1–1000), `lng`* (−180..180), `lat`* (−90..90), `regionId`, `status` (enum `idle|moving|engaged|pending`), `note`. (\* = required.)

### 4.5 `markerOpSchema` — `anyOf` on `op` (`:256`)

| `op` | Required | Payload |
|---|---|---|
| `build` | `op`, `marker` | full `markerSchema` |
| `remove` | `op`, `name` | + optional `markerId`, `note` |

`markerSchema` (`:227`) fields: `id`, `name`* (nonempty), `kind`* (nonempty free-form lowercase noun — city/base/silo/embassy…), `ownerCode`, `lng`* (−180..180), `lat`* (−90..90), `note`, `foundedAt`.

> **Note:** `validateGeneratedWorldChanges` (Layer 2) also accepts `op: "found"` as an alias of `build` and `op: "destroy"` as an alias of `remove` (`gameplay.js:1095`, `:1105`), and for a build reads coordinates from `operation.marker ?? operation`. The **schema itself only declares `build`/`remove`** — the aliases pass Layer 1 only because `unitOp`/`markerOp` schemas validate loosely (see the caveat in §6).

### 4.6 `createdChatSchema` (`:57`)

The initiating polity always speaks first — a blank untitled chat tells the player nothing.

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `id` | string | Stable chat id | no |
| `title` | string (nonempty) | Purpose (e.g. "French mediation offer") | **yes** |
| `countries` | array (`minItems: 1`) of `chatCountrySchema` | Participants | **yes** |
| `messages` | `chatMessageSchema[]` | Messages the chat begins with | no |
| `openingMessage` | string (nonempty) | Initiator's first message, in leader's voice; never the player | **yes** |
| `speaker` | string (nonempty) | Name of the polity sending the opener; never the player | **yes** |
| `linkedEventId` | string | Optional cause link | no |
| `source`, `status` | string | Optional labels | no |

`chatCountrySchema` (`:32`): `code`, `name`* (nonempty). `chatMessageSchema` (`:43`): `code`, `role`, `speaker`, `text`* (nonempty? — only `text` required), `time`.

### 4.7 Jump payload — `JUMP_FORWARD_SCHEMA` (`:399`)

Also used for `autoJumpForward`. This is the largest task.

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `events` | `eventSchema[]` | Dated events during the period | **yes** |
| `stopDate` | string | Date the simulation stops | **yes** |
| `summary` | string | Concise period summary | **yes** |
| `clearActions` | boolean | Were queued player actions resolved | **yes** |
| `catalyst` | `catalystSchema \| null` | Optional interactive scene | no |
| `diplomaticOutreach` | `createdChatSchema[]` | Polities reaching out on their own initiative, not tied to any event | no |

`eventSchema` (`:322`): `id`, `date`* , `title`* , `description`* , `importance`, `kind`, `notable` (bool), `playerRelated` (bool), `impacts` (`impactsSchema`).

#### Ledger transports (`warUpdates`, `relationUpdates`, `agreementUpdates`)

Three optional strings, one record per line, fields separated by `~`. They deliberately stay text: the nested object form is what Gemini function calling and strict tool modes choke on, and the formats are taught in the live prompt (`buildWarLedgerDirective` / `buildDiplomaticLedgerDirective` in gameplay.js), so frozen prompt packs get them too.

| Transport | Line | Ops |
|---|---|---|
| `warUpdates` | `warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note` | start, join-a, join-b, leave, ceasefire, resume, end |
| `relationUpdates` | `A~B~score~status~eventNumbersCSV~summary` | absolute score; a blank status is derived from it |
| `agreementUpdates` | `agreementId~op~type~partiesCSV~eventNumbersCSV~title~terms` | start, update, suspend, resume, end, expire |

`eventNumbersCSV` (1-based) is a hint only: the engine rebinds war records from `event.warId` and the transition's wording (`normalizeWorldWarEventLinks`), and the diplomatic director binds relation and agreement records to the one event that matches. Validation runs per segment against the world as the earlier segments left it (`validateSegmentLedgers`): strict while a retry remains, salvaged on the final attempt. Accepted records are bound to the segment's event ids, concatenated by `mergeSegmentPayloads`, remapped to the canonical round-scoped ids minted in `applySimulationResult` (`src/runtime/eventIdentity.js`), and applied by `applyWarUpdates` / `applyDiplomaticUpdates`. `eventSchema` carries `warId` and `combatants[]` for the combat rule (docs/world-state.md §2b-bis).

`PREGAME_HISTORY_SCHEMA` takes the same facts for round zero as one flat `canonicalUpdates` array (`canonicalUpdateSchema`: `kind` = relation | war:<op> | agreement:start, plus id / polities / opponents / score / category / title / detail), which `expandCanonicalUpdateEnvelope` turns into the three transports before `validatePregameCanonicalBootstrap` runs.

### 4.8 `catalystSchema` (`:346`) and executor/summary

`CATALYST_CREATION_SCHEMA` is `catalystSchema` directly.

| Schema | Fields (required*) |
|---|---|
| `catalystSchema` | `title`*, `premise`*, `opening`*, `choices`* (array, `minItems: 2`, `maxItems: 5`, nonempty items) |
| `CATALYST_EXECUTOR_SCHEMA` (`:519`) | `summary`*, `resolved`* (bool), `nextChoices`* (array `maxItems: 5`, nonempty items) |
| `CATALYST_SUMMARY_SCHEMA` (`:539`) | `title`*, `description`*, `importance`* |

### 4.9 Small single-purpose schemas

| Schema | Fields (required*) | Purpose |
|---|---|---|
| `ACTIONS_SCHEMA` (`:369`) | `topics`* (array `minItems:1`); each topic: `title`*, `description`*, `actions`* (array `minItems:1` of `actionSchema`) | Strategic topics + concrete actions |
| `DESCRIPTION_TO_ACTION_SCHEMA` (`:483`) | `title`*, `text`*, `kind`*, `invitees`, `chatStarter` | Freeform intent → structured command |
| `NEXT_SPEAKER_SCHEMA` (`:497`) | `nextSpeaker`* | Whose turn in a chat |
| `EVENT_CONSOLIDATOR_SCHEMA` (`:507`) | `summary`* | Continuity-safe history summary |
| `GAME_MASTER_SCHEMA` (`:551`) | `summary`*, `impacts`* | GM intervention + world effects |
| `IDLE_DIPLOMACY_SCHEMA` (`:468`) | `chat`* (`null \| createdChatSchema`) | At most one idle note, or `null` for silence |
| `PREGAME_HISTORY_SCHEMA` (`:448`) | `events`* (array `minItems:1`,`maxItems:12` of `pregameEventSchema`), `summary`* | Pre-game backstory |

`actionSchema` (`:17`): `id`, `title`*, `text`*, `kind`, `invitees`, `chatStarter`. `pregameEventSchema` (`:434`): `date`*, `title`*, `description`*, `importance`, `kind` — **deliberately no `impacts`** (a backstory event is a record, not a change to apply, `:431`).

### 4.10 `COUNTRY_STAT_SHEET_SCHEMA` (`:569`)

A complete national statistics sheet. Every top-level object below is required; every nested field is required within its object.

| Group | Fields | Type |
|---|---|---|
| top level | `capital`, `continent`, `government`, `leader` | nonempty string |
| top level | `stability` | percentage (int 0–100) |
| `indices` | `sovereignty`, `foodAutonomy`, `energyAutonomy`, `economicIndependence`, `internalSecurity`, `internationalReputation` | percentage each |
| `economy` | `gdp`, `gdpGrowth`, `gdpPerCapita`, `currency`, `inflation`, `unemployment`, `publicDebt`, `budgetBalance` | nonempty string each |
| `gdpBreakdown` | `agriculture`, `industry`, `services` | percentage each — **must sum to exactly 100** (see §5.3) |

---

## 5. Layer 1 validation — `validateGameplayPayload` (`:852`)

Two stages inside one function: the generic schema walk, then per-task rules.

### 5.1 `validateAgainstSchema` — the hand-rolled schema walker (`:744`)

There is **no Ajv / JSON-Schema library** here; validation is a bespoke recursive walk supporting exactly the keywords the schemas use. If you use a JSON-Schema keyword this walker doesn't implement, it is silently ignored.

| Keyword handled | Behavior | Line |
|---|---|---|
| `anyOf` | Passes if the value matches **any** candidate; else concatenates all sub-errors | `:745` |
| `type` | `integer` = number AND `Number.isInteger`; missing `type` matches anything | `:751` |
| finite check | `number`/`integer` must be `Number.isFinite` (rejects `NaN`/`Infinity`) | `:759` |
| `minimum`/`maximum` | numeric bounds | `:763` |
| `enum` | value must be in the list | `:771` |
| `minLength` | string length (this is how `nonEmptyTextSchema`'s `minLength:1` is enforced) | `:775` |
| `minItems`/`maxItems` | array length | `:780` |
| `items` | recurse into each element | `:787` |
| `required` | each key must be an own-property (via `hasOwnProperty`) | `:796` |
| `additionalProperties: false` | any key not in `properties` → `"… is not allowed."` | `:805` |

`valueType` (`:735`) distinguishes `null`/`array`/`object`/primitive so error messages are precise. `propertyPath` (`:741`) builds JSONPath-ish locations (`$.economy.gdp`, `$.events[3].date`) so retry feedback names the exact offending field.

> **Caveat — nested `anyOf` schemas validate loosely.** `unitOpSchema` and `markerOpSchema` have `anyOf` at the top of the item but **no `type`** on the wrapper. The walker's `anyOf` branch tries each candidate and passes if any matches. Because the candidate objects use `additionalProperties: false`, a mostly-correct op usually matches one branch — but this is a weaker guarantee than a discriminated union. The real teeth for unit/marker ops are in Layer 2 (`validateGeneratedWorldChanges`), which is why alias ops like `found`/`destroy` slip past Layer 1.

### 5.2 Per-task generic rules

After the schema walk passes, `validateGameplayPayload` runs task-specific checks. These exist because the schema can't express cross-field constraints or non-blank-after-trim.

| Task | Extra rule | Line |
|---|---|---|
| `jumpForward` / `autoJumpForward` | `stopDate` non-blank; every event's `date`/`title`/`description` non-blank after trim; **at least one of** events, non-empty summary, or a *meaningful* catalyst; if a catalyst is present its `choices` must be distinct | `:866` |
| `pregameHistory` | every event's `date`/`title`/`description` non-blank; `summary` non-blank | `:892` |
| `descriptionToAction`, `nextSpeaker`, `eventConsolidator`, `catalystCreation`, `catalystExecutor`, `catalystSummary`, `gameMaster` | a per-task list of top-level fields must be non-blank after trim (`requiredTextByTask`, `:906`) | `:915` |
| `catalystCreation` | `choices` distinct (`validateDistinctChoices`) | `:921` |
| `catalystExecutor` | `nextChoices` **must be empty when `resolved`**; must have **≥2** when unresolved; must be distinct | `:926` |
| `countryStatSheet` | deep no-blank-strings (`findBlankString`); **gdpBreakdown sum = 100** | `:937` |
| `actions` | each topic `title` non-blank; each action `title` AND `text` non-blank | `:946` |

Helpers backing these:

- **`hasMeaningfulCatalyst`** (`:819`) — a catalyst counts only if `title`/`premise`/`opening` has real text **or** `choices` is non-empty. Prevents an empty `{}` catalyst from satisfying the "at least one of" jump rule.
- **`validateDistinctChoices`** (`:828`) — trims + lowercases each choice, flags the first blank, then rejects if the `Set` size differs from the array length (duplicate detection).
- **`findBlankString`** (`:836`) — recurses the entire value (objects and arrays) and returns the JSONPath of the first whitespace-only string. Used by `countryStatSheet` so no field in the sheet ships blank. Note this is stricter than the schema's `nonEmptyTextSchema` (which only checks `minLength`, so `"   "` would pass the walker but fail here).

### 5.3 The `gdpBreakdown` sum-to-100 rule (`:940`)

```
if (breakdown.agriculture + breakdown.industry + breakdown.services !== 100)
  return { valid: false, error: "$.gdpBreakdown percentages must sum to 100." };
```

Each part is already a `percentageSchema` (int 0–100) by Layer 1, but three in-range integers can still sum to 97 or 110. This exact-equality check (`!== 100`, not a tolerance band) guarantees the three-slice pie the stat sheet renders is coherent. A model that emits `40/40/30` fails and, on attempt 1, is told to fix it.

### 5.4 The capture-reluctance guard (Layer 2, `gameplay.js:1011-1032`)

Not in `validateGameplayPayload` — it lives in `validateGeneratedWorldChanges`, which jump/GM tasks pass as their `validatePayload` callback. The recurring field report it fixes: "two turns of invasions and not a single province transferred."

Logic (strict attempt only):

1. Sum `regionTransfers` across all event `impacts` containers.
2. If the total is **0**, scan every event's `title`+`description` against `CAPTURE_LANGUAGE` — a deliberately narrow, word-boundary-anchored regex of *capture verbs* (`captur*`, `seiz*`, `annex*`, `conquer*`, `occupy/ies/ied/ation`, `overran`, `liberat*`, `retak*`, `cede*`, `fell to`, `falls to`; `gameplay.js:994`).
3. If any event narrates a capture but zero regions moved, return a corrective error telling the model to add `regionTransfers` to every capture event **or** strip the capture language.

It is narrow by design: "preoccupied"/"occupational" never match, and defensive battles that move no borders (war verbs, not capture verbs) are a legitimate zero-transfer turn and never trip it. English-only heuristic; non-English games just skip the nudge. Because it is **strict-only**, it can never cost a finished turn on the final attempt.

---

## 6. `validateGeneratedWorldChanges` — the world-aware Layer 2 (`gameplay.js:1002`)

Passed as `validatePayload` by `jumpForward`/`autoJumpForward` (`gameplay.js:1916`) and `gameMaster` (`:1965`). It both **validates and mutates in place** (canonicalizing region ids, dropping dead ops), so a payload is only accepted after it has passed through here clean. Signature: `(candidate, world, { strictTransfers })`. `strict = strictTransfers` and callers set it to `!finalAttempt`.

| Check | Strict behavior (attempt 1) | Salvage behavior (final attempt) | Line |
|---|---|---|---|
| Region transfers unresolvable against the map | Return `buildTransferFeedback` — the losing owner's real region list so the model can resend with exact ids/names | Leave unresolved transfers for normalization to drop | `:1007` |
| Capture narration + zero transfers | Corrective error (see §5.4) | Skipped entirely | `:1020` |
| `createdChats` with no known participants | Reject | Drop the chat, keep the turn | `:1042` |
| `createdChats` opener/title missing | Reject (`validateChatOpener`) | Skipped | `:1046` |
| `unitOps.spawn` missing name/ownerCode | Reject | Drop the op | `:1059` |
| `unitOps.spawn` duplicate id | Reject | `delete unit.id` so normalization mints a fresh one | `:1064` |
| `unitOps` targeting a nonexistent `unitId` | Reject | Drop the op | `:1079` |
| `markerOps.build` missing name / coords | Reject | Drop the op | `:1097` |
| `markerOps.remove` missing name+id | Reject | Drop the op | `:1106` |
| `diplomaticOutreach` with no known participants / bad opener | Reject | Drop the outreach | `:1126` |

`buildTransferFeedback` (`:940`) caps at the first 3 unresolved transfers and lists up to 40 candidate regions each (`"Pomorskie (POL.11_1)"`) — small, targeted vocabulary so the model can fix "Pomerania" into a real id on the retry instead of losing the map change.

---

## 7. The `additionalProperties: false` trap

**A field that is not declared in a schema's `properties` cannot round-trip — even if the prompt asks for it and the writer code handles it.** Two independent gates enforce this:

1. **The provider.** In OpenAI `json_schema` mode (and strict tool modes), the schema — including `additionalProperties: false` — is sent verbatim and the provider constrains generation to it. The model literally cannot emit an undeclared key. (Gemini is the exception: `toGeminiSchema` strips `additionalProperties`, `main.jsx:216` — but you cannot rely on that, since other providers enforce it.)
2. **The local validator.** Even if a model volunteers an extra key, `validateAgainstSchema` returns `"… is not allowed."` for any property missing from `properties` when `additionalProperties === false` (`gameplaySchemas.js:805`). The payload is rejected.

The lived example is `reputation` on `polityChangeSchema`. The prompt requested it, `gameState` normalized/clamped/wrote it — but the field was missing from `properties`, so `additionalProperties: false` meant a strict provider **could never emit it** and international reputation silently never moved. The fix (`:117-123`) was simply to declare it. The in-code comment is worth reading before you touch any schema.

**Checklist to make a new field emittable:**

1. Add it to the relevant schema's `properties` (with a good `description` — the model reads it).
2. Add it to `required` only if it must always be present (most impact fields are optional).
3. Make sure the writer/normalizer in [world state](world-state.md) actually reads and applies it.
4. If it needs a cross-field or non-blank rule the schema can't express, add it to `validateGameplayPayload` or the task's `validatePayload` callback.

Skipping step 1 is the silent-no-op failure mode.

---

## 8. `runJsonTask` — the request/validate/retry harness (`gameplay.js:382`)

Every AI gameplay call goes through this one function. It owns prompt assembly, the abort/timeout budget, the two-attempt loop, and the fallback.

### 8.1 Options

| Option | Meaning |
|---|---|
| `fallback` | Async function returning a deterministic payload when the AI can't produce a valid one. If absent, failure **throws** instead of falling back (`:519`). |
| `signal` | External `AbortSignal` (player pressed Cancel) — propagated into `callAI` and the server relay (`:435`). |
| `timeoutMs` | Default `120000`. `0`/non-finite **disables** the deadline (jumps use `0` unless "Limit AI generation" is on → 300000, `:1888`). |
| `userMessage` | The single user turn seeding `history`. |
| `validatePayload` | Optional Layer-2 callback `(candidate, { attempt, finalAttempt })`. |
| `variables` | Template variables for the rendered system prompt. |

### 8.2 Prompt assembly (before the loop)

1. `loadPromptCatalog` + `renderTemplate` build the system prompt from the campaign's frozen prompt pack (`:390`).
2. Append the **difficulty directive** from `readGameData().difficulty` (`:400`).
3. For `jumpForward`/`autoJumpForward`: append **[Player Agency]** and **[Map Truth]** blocks at call time (`:411-421`) — done here, not in `defaultPrompts.json`, because existing campaigns carry frozen prompt copies, so a call-time append is the only way the rule reaches them.
4. For `actions`/jumps/catalysts: append **[International Reputation]** context (`:425`).

### 8.3 The two-attempt loop (`:447-502`)

```
for (outputAttempt = 1; outputAttempt <= 2; outputAttempt++):
    response = callAI(systemPrompt, history, { deadline, maxTokens: 8192, signal, tool })
    parsed   = response.toolInput ?? extractJsonPayload(rawText)          // §9
    validation = parsed ? validateGameplayPayload(taskKey, parsed) : {invalid}   // Layer 1
    if (validation.valid && validatePayload):
        taskError = await validatePayload(parsed, { attempt: outputAttempt,
                                                    finalAttempt: outputAttempt === 2 })   // Layer 2
        if (taskError) validation = { valid:false, error: taskError }
    if (validation.valid): return { generation:{source:"ai"}, payload: parsed }
    if (outputAttempt === 1 && !aborted):
        history.push(model turn = rawText)
        history.push(user turn = "Your previous structured answer failed validation: <error> <retryInstruction>")
        continue
```

Key details:

- **`maxTokens: 8192`** is a per-response output ceiling only for capped providers; Gemini ignores it (`:450`). Jumps used to request 16384, which only raised the ceiling and did nothing useful.
- **`retryInstruction` adapts to how the model answered** (`:493`): a model that used a tool is told to "Call `<tool>` again with corrected input"; a prose model (no tool support) is told to "Respond again with ONLY the corrected JSON object". Telling a tool-less local model to call a tool it can't see would waste the one retry.
- Only **one retry** exists (attempt 1 → attempt 2). Spend it wisely — this is why strict validators front-load the most fixable errors.

### 8.4 `finalAttempt` — the linchpin of strict vs salvage

`finalAttempt` is `outputAttempt === 2`, computed **in `runJsonTask` from the real attempt counter** (`:474`), never from counting validator invocations. The comment at `:465-472` explains why this matters: if attempt 1 dies at the schema/parse layer, `validatePayload` never runs, so a self-counting validator would think attempt 2 was its "first" call, emit *strict* feedback meant for the model, and hand that string to the player as a fallback reason (a real field report: fallbacks that read "Resend the same response with…"). Sourcing `finalAttempt` from the loop counter is what keeps strict feedback pointed at the model and salvage pointed at the player.

### 8.5 Strict vs salvage — the contract

Every Layer-2 validator follows the same discipline. `strict = !finalAttempt`:

- **Attempt 1 (strict):** return a **corrective error string** describing exactly what's wrong. This becomes the retry message; the model usually fixes its own answer. Shape problems (wrong event count, stray dates, unresolvable region names, bad ops) are all strict here.
- **Attempt 2 (final = salvage):** **never reject a finished generation to the canned fallback over cosmetics.** Instead repair in place: `clampTimelineDates` pulls stray dates into the window (`gameplay.js:187`, `:1914`), unresolvable transfers/ops are dropped, duplicate unit ids are deleted so normalization re-mints them. A good story with sloppy dates beats canned events every time.

The jump validator (`:1897-1917`) is the canonical example: `const strict = !finalAttempt;` gates the event-count check, then `validateTimelineDates` (strict → return error; salvage → `clampTimelineDates`), then `validateGeneratedWorldChanges(..., { strictTransfers: strict })`. `pregameHistory` (`validatePregameEvents`, `:2013`) and `idleDiplomacy` follow the identical pattern.

### 8.6 Outcomes

| Situation | Result |
|---|---|
| Valid payload (either attempt) | `{ generation: { source: "ai", fallbackReason: "" }, payload }` (`:480`) |
| Player cancelled (`signal.aborted`) | **Throws** the abort reason — never silently falls back (`:513`) |
| No `fallback` provided + failure | Throws `AI task "<key>" failed: <reason>` (`:520`) |
| `fallback` provided + failure/timeout | Warns, returns `{ generation: { source: "fallback", fallbackReason }, payload: await fallback() }` (`:524`) |

Callers read `generation.source`/`fallbackReason` to tell the player whether they got a real AI turn or the deterministic fallback.

---

## 9. JSON recovery — `extractJsonPayload` (`gameplay.js:284`)

When a model answers in prose instead of a tool call, `runJsonTask` must dig the JSON out. The recovery ladder:

1. **Strip think blocks** — `<think>…</think>` and a leading `…</think>` (reasoning models / Ollama templates prepend these) (`:287`).
2. **`lenientJsonParse`** the whole text (`:230`): try `JSON.parse`; on failure repair the two slips small models make — curly `"smart"` quotes → `"`, and trailing commas before `}`/`]` — then reparse. Repairs run **only after** a strict parse fails, so well-formed output is never touched.
3. **Any fenced block** — `` ```json ``, `` ```JSON ``, `` ```javascript ``, or bare `` ``` `` — parsed leniently (`:297`).
4. **`balancedJsonCandidates`** (`:243`) — a string-aware brace/bracket walker that extracts every balanced top-level `{…}`/`[…]`, sorted objects-first so a stray inline array in the model's commentary can't shadow the real object payload. Each candidate is parsed leniently; first object wins.
5. Returns `null` if nothing parses → Layer 1 reports `"Response did not contain parseable JSON or tool arguments."`

This ladder is what lets local/self-hosted models without tool support still play; hosted providers normally return clean `toolInput` and skip it entirely.

---

## 10. Where to look when…

| You want to… | Go to |
|---|---|
| Add/change a field the model returns | `gameplaySchemas.js` `properties` + [§7 trap](#7-the-additionalpropertiesfalse-trap) |
| Add a whole new task | Add schema → `GAMEPLAY_SCHEMAS` + tool → `GAMEPLAY_TOOLS`, then a caller using `runJsonTask` |
| Change what makes a payload invalid (generic) | `validateGameplayPayload` (`gameplaySchemas.js:852`) |
| Change map/world-aware validation | `validateGeneratedWorldChanges` (`gameplay.js:1002`) |
| Tune retry feedback wording | The corrective strings returned by the validators (they are shown to the model verbatim) |
| Debug "the AI turn silently became a fallback" | `runJsonTask` `failureReason`, and check whether a strict error leaked (see `finalAttempt`, §8.4) |
| Debug provider tool wiring | `callAI` in `main.jsx` ([AI providers](ai-providers.md)) |
