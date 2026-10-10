# AI Return Schemas & Validation

Every AI gameplay task in Open Historia hands the model a JSON Schema (as a provider "tool") and gets back a JSON object it must trust before mutating the world. This page documents the schemas the model must return (`src/Game/AI/gameplaySchemas.js`), the hand-rolled two-layer validator that gates every response, and the strict-vs-salvage retry discipline in `runJsonTask` (`src/Game/AI/gameplay.js`) that decides whether a bad answer earns a corrective retry or gets repaired in place. If you are adding a field the model should emit, read the [`additionalProperties: false` trap](#the-additionalpropertiesfalse-trap) first — it is the single most common way a new feature silently does nothing.

Related pages: [World state](world-state.md) (what these payloads mutate), [AI providers](ai-overview.md) (how the schema becomes a tool call in `main.jsx`), [Gameplay orchestration](ai-overview.md) (the task callers), [Gameplay prompts](ai-prompts.md) (the templates rendered alongside each schema).

---

## 1. The big picture: two files, two validation layers

| Concern | File | What it holds |
|---|---|---|
| Schema definitions + generic validator | `src/Game/AI/gameplaySchemas.js` | `GAMEPLAY_SCHEMAS`, `GAMEPLAY_TOOLS`, `validateGameplayPayload` |
| Task orchestration + world-aware validator | `src/Game/AI/gameplay.js` | `runJsonTask`, `validateGeneratedWorldChanges`, timeline/pregame validators, JSON recovery |
| Provider wire format | `src/Game/AI/main.jsx` | `callAI` — turns a `tool` into Gemini/OpenAI/Anthropic tool calls, extracts `toolInput` |

A response passes through **two independent validation layers** before it is accepted (`gameplay.js`):

1. **Layer 1 — schema + generic invariants** (`validateGameplayPayload`, always runs). Structural: types, required keys, `additionalProperties`, ranges, plus per-task rules like the gdpBreakdown sum and distinct-choice checks. Pure function of the payload; knows nothing about the current game.
2. **Layer 2 — the `validatePayload` callback** (optional, world-aware). Only some callers supply it (`jumpForward`, `autoJumpForward`, `gameMaster`, `pregameHistory`, `idleDiplomacy`). It gets `{ attempt, finalAttempt }` and can consult live world state — e.g. `validateGeneratedWorldChanges` resolves region names against the real map. This is where strict-vs-salvage lives.

Both layers return a string error (`""` means valid). A non-empty error on attempt 1 becomes the corrective feedback the model sees on its one retry.

---

## 2. Task registry: schema, tool, and task key

Each task is identified by a **task key**. `GAMEPLAY_SCHEMAS` maps the key to its schema; `GAMEPLAY_TOOLS` maps it to a `{ name, description, schema }` tool object built by `makeTool` (`gameplaySchemas.js`). `getGameplayTool(taskKey)` is what `runJsonTask` calls to get the provider tool; `validateGameplayPayload(taskKey, value)` is what validates the result.

Diplomatic speaker routing is deliberately absent from this table: one-on-one threads select their sole counterpart natively, while group turns choose speakers inside `chatActions` in the same request that generates the table's actions. The retired standalone `nextSpeaker` schema/tool no longer exists.

| Task key | Schema export | Tool name (provider function name) | Called from |
|---|---|---|---|
| `actions` | `ACTIONS_SCHEMA` | `submit_actions` | `generateActions` |
| `jumpForward` | `JUMP_FORWARD_SCHEMA` | `submit_jump_result` | `simulateTimelineJump` |
| `autoJumpForward` | `AUTO_JUMP_FORWARD_SCHEMA` (**= `JUMP_FORWARD_SCHEMA`**) | `submit_jump_result` | `simulateAutoJump` |
| `descriptionToAction` | `DESCRIPTION_TO_ACTION_SCHEMA` | `submit_description_to_action` | freeform-intent → command |
| `eventConsolidator` | `EVENT_CONSOLIDATOR_SCHEMA` | `submit_event_consolidation` | `consolidateHistoryBatch` |
| `interactiveCreation` | `INTERACTIVE_CREATION_SCHEMA` (**= `interactiveSchema`**) | `submit_interactive_creation` | opening an interactive event's scene |
| `interactiveExecutor` | `INTERACTIVE_EXECUTOR_SCHEMA` | `submit_interactive_execution` | advance an interactive event |
| `interactiveSummary` | `INTERACTIVE_SUMMARY_SCHEMA` | `submit_interactive_summary` | finished interactive event → event |
| `gameMaster` | `GAME_MASTER_SCHEMA` | `submit_game_master` | `previewGameMasterCommand` |
| `countryStatSheet` | `COUNTRY_STAT_SHEET_SCHEMA` | `submit_country_stat_sheet` | national stat sheet |
| `timelineCurator` | `TIMELINE_CURATOR_SCHEMA` | `submit_timeline_curator` | one judgment per fresh event; native gates in `nativeTimelineCurator.js` decide what a judgment may remove |
| `unitDirector` | `UNIT_DIRECTOR_SCHEMA` | `submit_unit_director` | unit operations for the turn's military events (sanitized by `nativeUnitDirector.js`) |
| `idleDiplomacy` | `IDLE_DIPLOMACY_SCHEMA` | `submit_idle_diplomacy` | idle inbox drip |
| `pregameHistory` | `PREGAME_HISTORY_SCHEMA` | `submit_pregame_history` | pre-game backstory |
| `listenIn` | `LISTEN_IN_SCHEMA` | `submit_listen_in_feed` | `generateListenInFeed`: the Listen in phone's feed |

`getGameplayTool` returns `null` for an unknown key; `validateGameplayPayload` returns `{ valid: false, error: "Unknown gameplay task key: …" }`.

### How a schema becomes a tool call

`callAI` (`main.jsx`) receives the `tool` and adapts it per provider (`main.jsx`):

- **Gemini** — `tools: [{ functionDeclarations: [{ name, description, parameters: toGeminiSchema(schema) }] }]`, forced via `allowedFunctionNames`. `toGeminiSchema` **strips `additionalProperties` and `$schema`** recursively (`main.jsx`) — Gemini rejects those keys.
- **OpenAI-compatible** — `tools: [{ type: "function", function: { name, description, parameters: schema } }]` in `tool` mode; falls back to `response_format: { type: "json_schema", … }` and then `{ type: "json_object" }` on 400/422 (`main.jsx`). The schema is sent **verbatim, including `additionalProperties: false`**.
- **Anthropic** — native `tool_use`; `extractAnthropicToolInput` reads `block.input`.

The parsed arguments come back as `response.toolInput`. `runJsonTask` prefers that; if the model answered in prose (local models with no tool support), it falls back to `extractJsonPayload(rawText)` (`gameplay.js`). The Political World generators (the v2 executor's temporal sentinel and exact-date verification, and the geopolitical jobs) read an answer the same way through `toolResponsePayload` (`src/Game/AI/toolResponsePayload.js`): the tool call when there is one, otherwise `rawText` parsed with `extractJsonPayload`, since every text-mode answer (`json_schema`, `json_object`, `text_json`, Gemini's streamed-text fallback, an Anthropic text answer) arrives with `toolInput: null`.

---

## 3. Shared building blocks

Small factory helpers keep the schemas DRY (`gameplaySchemas.js`):

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

### 4.1 `impactsSchema` — structured world-state effects

The heart of the map-mutating pipeline. Attached to events (`eventSchema.impacts`) and to `GAME_MASTER_SCHEMA.impacts`. "Include only effect arrays that are relevant." Consumed by `validateGeneratedWorldChanges` and then applied to [world state](world-state.md).

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `actionIds` | `string[]` | Player action ids this event resolves | no |
| `createdChats` | `createdChatSchema[]` | Diplomatic chats the event opens toward the player | no |
| `polityChanges` | `polityChangeSchema[]` | Polity metadata changes (name/color/reputation/tags…) | no |
| `regionTransfers` | `regionTransferSchema[]` | **Map ownership changes.** Required by prompt whenever narration says territory changed hands — one entry per region | no |
| `regionClaims` | `regionClaimSchema[]` | **Territory claimed but not held.** Marks a region disputed (striped) *without* moving the border — an irredentist declaration, a proclaimed union, a contested frontier. `drop: true` withdraws a claim | no |
| `groupOps` | `groupOpSchema[]` | **Groups** — actors that are not countries (a terrorist organisation, a cartel, a militia, a zombie outbreak) and the areas they control. One object discriminated by `op`: `create` (a new group, its `description` and optionally `color` and `regionIds`), `update` (`description`, `color`, or `newName`), `take` (regions into its area), `release` (regions out of it; all of them when `regionIds` is empty), `dissolve` (the group and its area erased). A group owns no land: taking a region moves no border. `regionIds` are exact ids or plain region names, resolved like claims; one that matches nothing is dropped with a note. See [World state](world-state.md) (`groups`, `groupAreas`) | no |
| `unitOps` | `unitOpSchema[]` | Military unit mutations | no |
| `markerOps` | `markerOpSchema[]` | Structures built/destroyed on the map | no |
| `reports` | `reportOpSchema[]` | **Documents only some governments hold** — `create` (title, body, `visibleTo` of full polity names, optional `reportId`/`from`/`dateline`) or `share` (`reportId`, `visibleTo`, optional `from` — the holder who passed it on). `from` decides the thread and the speaker when a document reaches the player through diplomacy. Never carries impacts: what moved the map stays in the public event. See [reports](ai-overview.md#reports-what-only-some-governments-know) | no |

### 4.2 `regionTransferSchema`

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `regionId` | string | The region's **name** as the map spells it, written `region: <name>`; `country: <name>` is the whole of a country's land, or of a territory or dependency of that name (`country: Puerto Rico`, `country: Greenland`; see `namedAreas.js`). Never an id (one that arrives is still read; see `nameRefs.js`) | **yes** |
| `regionName` | string | Human-readable name, when known | no |
| `fromCode` | string | Previous owner polity code — lets the resolver locate the region | no |
| `toCode` | string | New owner polity code | **yes** |
| `note` | string | Brief reason | no |
| `basis` | enum | **Why the land moves** — `treaty` · `annexation` · `unification` · `independence` · `occupation` move the map; `claim` · `threat` · `raid` do not. The vocabulary, its synonyms and the screen live in `runtime/territoryBasis.js`. | no |

`basis` also rides on the **`control`** variant of `regionControlOpSchema` (not on `contest`, which is already the middle state, nor on `clear_contest`, which moves nothing toward anyone). It is **optional on purpose**: an older payload, the Game Master console and a lenient local backend all answer without it, and an entry with no basis is applied exactly as before. A value outside the enum fails schema validation, so the in‑turn retry can name a real one. What the engine does with a `claim` — it becomes a `regionClaims` entry — is in [AI overview](ai-overview.md#strict--salvage-validation-discipline).

**What a non-state side is** lives on a group (`groupOps`), not on the polity: the claimant roles that briefly rode on claims, contests and controls (2026-09-22) were taken out again on 2026-09-25, and disputed territory is plain claims and stripes as before.

> **The schema has a size budget.** `projectOpSchema.test.js` holds the serialized jump tool schema under 28,000 characters, because it rides on every request. That is why the definition of `basis` is stated once (on `regionTransfers`) and the control operation only points at it, why the long explanation is a call‑time directive (`TERRITORY_BASIS_DIRECTIVE`) rather than a field description, and why `groupOps` is in `JUMP_COMPACT_IMPACT_DESCRIPTIONS` (its field descriptions are dropped from the jump's copy; the actions reference states the shape once). The compaction drops only string annotations, so the group's own `description` field stays in the schema. At 27,673 characters there are about 330 to spare: a new impact family should follow the board's example and take its own call rather than join this contract.

### 4.3 `polityChangeSchema`

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

> `reputation` is the canonical example of the [`additionalProperties: false` trap](#7-the-additionalpropertiesfalse-trap): the prompt asked for it and `gameState` clamped/wrote it, but it was **absent from `properties`** — so a strict `json_schema` provider could never emit it and reputation silently never moved. Declaring it is what connected the feature.

### 4.4 `unitOpSchema` — `anyOf` on `op`

Not a single object: an `anyOf` of four shapes discriminated by `op`. Each branch is `additionalProperties: false`, so fields from one op leaking into another fail validation.

| `op` | Required fields | Payload |
|---|---|---|
| `spawn` | `op`, `unit` | full `unitSchema` object |
| `move` | `op`, `unitId` | `at` **or** `toLng`+`toLat`; + optional `regionId`, `posture`, `note` |
| `strength` | `op`, `unitId`, `strength` | `strength` integer 0–100 |
| `remove` | `op`, `unitId` | + optional `note` |

`unitSchema` fields: `id`, `name`* (nonempty), `type`* (enum: `infantry|armor|air|naval|artillery|garrison`), `ownerCode`* (nonempty), `strength`* (integer 1–100, a percentage of established strength), `composition`* (nonempty), `at` (where, in words), `lng` (−180..180), `lat` (−90..90), `regionId`, `status` (enum `idle|moving|engaged|pending`), `posture`, `note`. (\* = required.)

**`at` — where, in words** (`atSchema`, shared by a spawn, a move, a build and an update). A phrase naming places the map knows — "near Kharkiv", "eastern Ukraine", "off Sevastopol", "Donetsk Oblast facing Russia" — resolved to a point at validation by `src/Game/AI/placement.js` (see [placing things by name](ai-overview.md#placing-things-by-name-and-keeping-them-apart)). It is why `lng`/`lat` are no longer required on a spawn or a build: a model that guesses a longitude puts an army in the sea, and a model that names a place does not. When both are given, `at` wins; an operation left with neither is dropped by the normalizer exactly as one that never had coordinates. The phrase is described once, in the schema's one-line field description, and explained once, in the `[Placing Things]` directive — the jump's schema has a size budget (`projectOpSchema.test.js`), and five copies of a grammar would spend it.

### 4.5 `markerOpSchema` — `anyOf` on `op`

| `op` | Required | Payload |
|---|---|---|
| `build` | `op`, `marker` | full `markerSchema` |
| `build` (flat) | `op`, `name` | the structure's fields beside `op` — the shape models write most, accepted rather than failing the turn |
| `update` | `op` | `markerId` (preferred) or `name`; `kind`, `ownerCode`, `status`, `note`; `at` or `lng`+`lat` only when it genuinely relocates |
| `remove` | `op`, `name` | + optional `markerId`, `note` |

`markerSchema` fields: `id`, `name`* (nonempty), `kind`* (nonempty free-form lowercase noun — city/base/silo/embassy…), `ownerCode`, `status`, `at` (where, in words — see §4.4), `lng` (−180..180), `lat` (−90..90), `note`, `foundedAt`. `normalizeMarkerOperationShape` carries `at` (also read from `place`/`where`/`location`) through to validation and omits `lng`/`lat` it was not given, so a build placed by name is not refused for the coordinates it does not have yet.

> **Note:** `validateGeneratedWorldChanges` (Layer 2) also accepts `op: "found"` as an alias of `build` and `op: "destroy"` as an alias of `remove` (`gameplay.js`), and for a build reads coordinates from `operation.marker ?? operation`. The **schema itself only declares `build`/`remove`** — the aliases pass Layer 1 only because `unitOp`/`markerOp` schemas validate loosely (see the caveat in §6).

### 4.5-bis `projectOpSchema` — ONE object, discriminated by `op`

Unlike `unitOpSchema` and `markerOpSchema`, this is a single object with an `op` enum and all-optional fields, not an `anyOf`.

| `op` | Meaning |
|---|---|
| `create` | open a new effort (give it a `summary` too) |
| `update` | progress moved, or the status changed; `newName` renames |
| `milestone` | a checkpoint reached or missed (`projectMilestoneSchema`) |
| `complete` / `cancel` / `fail` | it ended; all three keep it on the board under Closed |
| `remove` | erase an entry that should never have been opened — NOT how a project ends |

Required: `op` and `name`. `eventIndex` says which of the events this op follows from.

> **Why it is not an `anyOf`.** It used to be, with six branches — and three of them (nested `create`, flat `create`, `update`) each restated `projectSchema`'s twenty properties in full. Serialized, that was **41,538 characters of a 63,161-character jump schema**: two thirds of the entire output contract for one impact branch, more than three times every other branch combined, sent on every jump and once per segment.
>
> It was also duplication rather than information. `normalizeProjectOp` (`runtime/gameState.js`) already accepts a create written flat *or* nested (`operation.project ?? operation`), already resolves every op alias, and already merges a create naming an existing project into an update of only the fields it carried. The schema was spending 13 KB describing tolerance the reducer had all along.
>
> Collapsing it was also a **reliability** win, not only a size one: a six-branch `anyOf` is one of the worst constructs for Gemini's OpenAPI subset (see `geminiSchema.js`) and for small local models, which routinely pick the wrong branch or blend two. `onComplete` was thinned the same way — it re-embedded `polityChangeSchema`, `regionTransferSchema` and `regionClaimSchema` in full, all three of which appear elsewhere in the very same payload.
>
> The nested `create` spelling survives as a permissive `project: { type: "object" }` key. The model is no longer told to nest, but `additionalProperties: false` means one that does anyway would fail validation and cost the whole turn — the exact failure the flat variant was added to prevent. ~150 characters instead of 13,000.
>
> `src/Game/AI/projectOpSchema.test.js` is the safety net: every op shape the six-variant schema accepted must still validate.

### 4.5-ter `PROJECTS_SCHEMA` — the board's own task

A skip keeps the board itself, in every mode: `foldJumpTool` adds `impacts.projectOps` to the contract it is sent (`foldedProjectOpsSchema`: this op without `priority`, `startedAt`, the links, `focus`, the nested `project` and `onComplete`), `agentReports` at the top level when an agent's report is due, and `history` (`{ summary*, document* }`, the consolidator's two fields) last of all when a fold of the history document is due. `JUMP_FORWARD_SCHEMA`, which every answer is validated against, accepts both contracts, and takes `agentReports` and `history` loosely: each is judged where it is read, so a poor one costs that report or that fold and never the turn. See [the folded time skip](ai-overview.md#the-folded-time-skip-one-request-its-own-consequences).

For a skip a provider refused in its folded form, `projectOps` does not appear on the jump the model is sent: `jumpImpactsSchema` is `impactsSchema` minus that branch, and the board is moved by the `board` job of the one turn review that skip gets, after the segments merge and before anything is written.

```
{ "projectOps": [ { "op": "update", "id": "...", "name": "...", "eventIndex": 0, "progress": 58, ... } ] }
```

`{"projectOps": []}` is a valid and expected answer — the prompt says so explicitly, because a schema that rejected it would push the model into inventing progress, which is the one thing the board must never contain.

The **game master keeps the full `impactsSchema`**, board included: it is a single call with no second pass to hand the work to.

Jump schema size across the two changes, measured when they landed: **63,161 → 31,678 → 21,609 characters.** It grew again with what beta added to the jump (31,720 once `at` joined), and the **description audit** brought it to **24,915**: every field description says what the field *is* in a line, because the levers are explained at length in the actions reference and the call-time directives the jump is always given — a paragraph in a field description was the same paragraph a third time. The guard in `projectOpSchema.test.js` is now **28,000**, raised on purpose when `impacts.reports` landed (26,363 chars; ~1,450 for the family). It is a prompt-size guard, not a provider limit: an impact family that saves a *request* may raise it — reports inside the jump cost ~1,450 characters instead of a whole request a turn, which is the trade the budget asks for.

### 4.5-ter `CHAT_ACTIONS_SCHEMA` — one turn of a conversation

`{ actions: chatActionSchema[], memorySummary? }`, the answer to one request that acts for every AI participant in a thread (`submit_chat_actions`; see [group diplomacy](ai-overview.md#group-diplomacy-one-request-for-the-whole-table)).

`chatActionSchema` is ONE object with a `type` enum — send_message, add_reaction, rename_chat, add_member, remove_member, create_poll, add_poll_option, poll_vote — and all-optional fields, like `projectOpSchema` and for a harder reason: **Gemini refuses a function declaration whose `anyOf` has more than six branches** (bisected live: six passed, seven did not) and this vocabulary has eight. Nothing is lost, because `normalizeChatAction` (`chatActions.js`) enforces what each type needs before anything is applied, and a malformed action costs only itself.

`pollRef`/`optionRef` are the batch's own labels for a poll it invents, so it can be created and voted in the same answer; the engine mints the real ids. A label is accepted where a ref is expected — the model writes them that way.

### 4.6 `createdChatSchema`

The initiating polity always speaks first — a blank untitled chat tells the player nothing.

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `title` | string (nonempty) | Purpose (e.g. "French mediation offer") | **yes** |
| `countries` | array (`minItems: 1`) of polity **names** | The other side; never the player | **yes** |
| `openingMessage` | string (nonempty) | Initiator's first message, in leader's voice; never the player | **yes** |
| `speaker` | string (nonempty) | Name of the polity sending the opener; never the player | **yes** |
| `linkedEventId` | string | Optional cause link | no |

`countries` are plain names — what the actions reference has always shown (`{"countries":["..."]}`) and what `resolveInvitees` (gameplay.js) has always read. The schema used to demand `{code, name}` objects, so a model that followed the prose failed the schema; `normalizeChatShape` (gameplaySchemas.js) still folds an object to its name for a campaign whose frozen prompt shows the old shape, on the jump, the idle pulse and the GM transport alike. At validation the resolved `{code, name}` list replaces the names on the kept event, so everything that reads a *stored* chat's participants sees the shape it always did. The message list, `source` and `status` the schema once carried were never taught and are the engine's to fill (`buildGeneratedChat`).

### 4.7 Jump payload — `JUMP_FORWARD_SCHEMA`

Also used for `autoJumpForward`. This is the largest task.

| Field | Type | Meaning | Req? |
|---|---|---|---|
| `events` | `eventSchema[]` | Dated events during the period | **yes** |
| `stopDate` | string | Date the simulation stops | **yes** |
| `summary` | string | Concise period summary | **yes** |
| `clearActions` | boolean | Were queued player actions resolved | **yes** |
| `diplomaticOutreach` | `createdChatSchema[]` | Polities reaching out on their own initiative, not tied to any event | no |

`eventSchema`: `id`, `date`* , `title`* , `description`* , `importance`, `kind`, `notable` (bool), `playerRelated` (bool), `impacts` (`impactsSchema`).

There is **no scene** in the answer: a scene begins only when the player takes up an interactive event, an event of the skip that the engine offers for it now and then at no cost (`runtime/interactiveOffer.js`; `interactiveCreation`). The schema used to carry a `catalyst` on every skip, into a save no panel showed it from; an answer that still carries one has it dropped by `normalizeGameplayPayload` before validation, never refused.

#### Ledger transports (`warUpdates`, `relationUpdates`, `agreementUpdates`, `puppetUpdates`)

Four optional strings, one record per line, fields separated by `~`. They deliberately stay text: the nested object form is what Gemini function calling and strict tool modes choke on, and the formats are taught in the live prompt (`buildWarLedgerDirective` / `buildDiplomaticLedgerDirective` in gameplay.js), so every campaign carries them whatever guidance it edited (ai-prompts.md §2).

| Transport | Line | Ops |
|---|---|---|
| `warUpdates` | `warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note` (a start's note may open `Title: <the war's name>;`, then the cause — `splitWarStartNote`; without it the war is called "A–B War") | start, join-a, join-b, leave, ceasefire, resume, end |
| `relationUpdates` | `A~B~score~status~eventNumbersCSV~summary` | absolute score; a blank status is derived from it |
| `agreementUpdates` | `agreementId~op~type~partiesCSV~eventNumbersCSV~title~terms` | start, update, suspend, resume, end, expire |
| `puppetUpdates` | `op~overlord~puppet~kind~loyalty~secrecy~eventNumbersCSV~note` | install, reclassify, loyalty, reveal, release, annex, revolt, suppress |

`eventNumbersCSV` (1-based) is a hint first: the engine rebinds war records from `event.warId` and the transition's wording (`normalizeWorldWarEventLinks`, in `nativeWarLedger.js`) whenever an event carries the record's warId, and the diplomatic director binds relation and agreement records to the one event that matches. When no event carries the warId the model's own numbers are kept rather than blanked, so the validator reports the real defect (the event is missing its `warId`) instead of asking for a number the model already gave. Validation runs per segment against the world as the earlier segments left it (`validateSegmentLedgers`): strict while a retry remains, repaired on the final attempt (`repairWarLedgerPayload`): a record's own event numbers are stamped onto their events as the warId they declare, a record that still cannot bind is dropped with the war bindings of its events (events of wars that already exist keep theirs), and the segment is kept — the events stand as narrative, and only the canonical war change is lost, logged to the diagnostics log. Accepted records are bound to the segment's event ids, concatenated by `mergeSegmentPayloads` (which carries all four families — every skip is built from the merge, so a family it left out would never be applied), remapped to the canonical round-scoped ids minted in `applySimulationResult` (`src/runtime/eventIdentity.js`), and applied by `applyWarUpdates` / `applyDiplomaticUpdates`. Each decoder caps ONE answer's records (16 wars, 20 relations, 16 agreements, 24 puppets, 16 storylines); the merged turn's applies (and its storyline motion check) pass `limit: Infinity`, because every segment's answer was held to the caps already and cutting a four-segment year to one answer's worth dropped every later segment's records. `eventSchema` carries `warId` and `combatants[]` for the combat rule (docs/world-state.md §2b-bis).

`puppetUpdates` records a **subordination** — one polity directing another's will while it stays a separate country holding its own territory and its own sovereignty (docs/world-state.md §2b-bis and the Glossary). `kind` ∈ protectorate | satellite | client and says WHICH POWERS the Overlord holds rather than how tightly, so a change of arrangement is `reclassify` and never a step along a scale; only `install` needs kind/loyalty/secrecy. `loyalty` is 0-100 and `secrecy` is open | covert. `reveal` is one-way. The director refuses what the world cannot support: a second Overlord for a Puppet that has one, a cycle, and any chain — an `install` naming an Overlord that is itself held attaches to whoever holds it, and one naming a Puppet that holds others reparents those one hop up, permanently, in the same event.

Three things the ENGINE does rather than the model, all for the same reason — a rule that depends on the model remembering to emit a line is a rule that silently lapses.

A **refused demand** costs a fixed 10 Loyalty, charged once. A **demand** is an Overlord telling its own Puppet to do something, and it is a record, not a sentence: a `demand_made` event in the one-on-one thread between the two, answered by `demand_answered` events (`src/runtime/chatThreads.js`), exactly as a poll and its votes are kept. It runs open → accepted | refused | countered, and a countered demand → settled (the Overlord took the alternative) or superseded (the Overlord demanded again, revised or restated). Only a refusal costs anything; offering an alternative is negotiating.

Who records what. The **player** answers from a demand card in the thread — Accept, Refuse, or an alternative in their own words — and, as an Overlord, makes a demand with the composer's ⚑ toggle and accepts or rejects a Puppet's alternative from the card. Those are choices, so they cost no request and cannot be misread. An **AI**'s reply in that thread is read by one small request, the `demandCheck` task (`DEMAND_CHECK_SCHEMA`, `src/runtime/demandCheck.js`), whose answer is a REQUIRED outcome from a fixed list — the code accepts only those the speaker may give in the state the demand is in. It is asked only in the one-on-one thread between the player and their own Overlord or Puppet; group chats have no demand machinery. It replaced an optional hidden `REFUSED_DEMAND` line the model was asked to add to its reply: a live run showed an Overlord answer a flat refusal with "Belarus's refusal is noted" and not mark it, two in three at best one-on-one and none in groups. The next jump collects refused demands off the saved threads with `chargeRefusals` (`gameState.js`), and records each in `world.chargedRefusals` — never on the thread, because chat writers save whatever copy they hold and erased a flag kept there.

A Puppet whose Loyalty falls below 35 (`PUPPET_COUP_LOYALTY` in `src/runtime/puppets.js`, the number the Workshop warns at too) is handed a hidden **Storyline** once, which the world director then ripens; the model still decides whether and when anything comes of it, through `revolt` or `suppress`, and either settles the Storyline. And an **`annex` costs the Overlord `internationalReputation`** — 8 for a covert arrangement, 16 for one the world could see — because a cost the model only sometimes remembers is one players learn to ignore, and a Puppet then becomes free territory with a waiting period.

What the engine does *not* decide is whether unrest was foreseen. The bounded ledger slice tells the jump whether the Overlord has an agent inside its own Puppet, or services strong enough to catch word — the fact — and the model writes the fiction from there.

**Who is told what.** The jump, the idle diplomacy pass and next-speaker read the whole ledger from the canonical diplomatic context: they reason about the entire world. A **leader** is not given that context and must not be: it speaks as one country, so `puppetBriefingFor` (`src/runtime/puppets.js`) briefs it on what that country knows — its own arrangements, and for a covert one which of the people in the room have *not* found out, which is what it needs to know which way to lie. The one-on-one leader and every AI participant of a group turn get it; the player is counted into the room by hand, because a chat's `countries` list only its non-player members. A covert arrangement a third party knows of is one its **agents uncovered**: an *active* agent inside either party reveals it to its owner at the end of the turn (`revealPuppetsToSpies`), and refreshes what that owner last saw, so a lapsed arrangement can be learned to have lapsed; with no agent in place the old belief stands. A turned agent reveals nothing, because its captors choose what it reports.

The **pregame bootstrap** declares Puppets already standing on the start date in its flat `canonicalUpdates`, as `puppet:open` or `puppet:covert` with `polities` = [overlord, puppet], `category` the kind and `score` the loyalty (`puppetUpdatesFromCanonical`).

`PREGAME_HISTORY_SCHEMA` takes the same facts for round zero as one flat `canonicalUpdates` array (`canonicalUpdateSchema`: `kind` = relation | war:<op> | agreement:start, plus id / polities / opponents / score / category / title / detail), which `expandCanonicalUpdateEnvelope` turns into the three transports before `validatePregameCanonicalBootstrap` runs.

### 4.8 `interactiveSchema` and executor/summary

`INTERACTIVE_CREATION_SCHEMA` is `interactiveSchema` directly.

| Schema | Fields (required*) |
|---|---|
| `interactiveSchema` | `title`*, `premise`*, `opening`*, `choices`* (array, `minItems: 2`, `maxItems: 5`, nonempty items) |
| `INTERACTIVE_EXECUTOR_SCHEMA` | `summary`*, `resolved`* (bool), `nextChoices`* (array `maxItems: 5`, nonempty items), `recordTitle`, `recordDescription`, `recordImportance` (optional: the finished scene's record, filled only when `resolved`; saves the `interactiveSummary` request) |
| `INTERACTIVE_SUMMARY_SCHEMA` | `title`*, `description`*, `importance`* |

### 4.9 Small single-purpose schemas

| Schema | Fields (required*) | Purpose |
|---|---|---|
| `ACTIONS_SCHEMA` | `topics`* (array `minItems:1`); each topic: `title`*, `description`*, `actions`* (array `minItems:1` of `actionSchema`) | Strategic topics + concrete actions |
| `DESCRIPTION_TO_ACTION_SCHEMA` | `title`*, `text`*, `kind`*, `invitees`, `chatStarter` | Freeform intent → structured command |
| `EVENT_CONSOLIDATOR_SCHEMA` | `summary`* | Continuity-safe history summary |
| `GAME_MASTER_SCHEMA` | `summary`*, `impacts`* | GM intervention + world effects |
| `IDLE_DIPLOMACY_SCHEMA` | `chat`* (`null \| createdChatSchema`) | At most one idle note, or `null` for silence |
| `PREGAME_HISTORY_SCHEMA` | `events`* (array `minItems:1`,`maxItems:12` of `pregameEventSchema`), `summary`* | Pre-game backstory |
| `LISTEN_IN_SCHEMA` | `posts`* (array of `{ author*, text*, handle, about, filler, minutesAgo, likes, reposts, replies }`; deliberately no `minItems`, since one usable post is still a feed), `trends` (≤ 5 strings) | What ordinary people in a place are posting (the Listen in phone) |

`actionSchema`: `id`, `title`*, `text`*, `kind`, `invitees`, `chatStarter`. `pregameEventSchema`: `date`*, `title`*, `description`*, `importance`, `kind` — **deliberately no `impacts`** (a backstory event is a record, not a change to apply).

### 4.10 `COUNTRY_STAT_SHEET_SCHEMA`

A complete national statistics sheet. Every top-level object below is required; every nested field is required within its object.

| Group | Fields | Type |
|---|---|---|
| top level | `capital`, `continent`, `government`, `leader` | nonempty string |
| top level | `stability` | percentage (int 0–100) |
| `indices` | `sovereignty`, `foodAutonomy`, `energyAutonomy`, `economicIndependence`, `internalSecurity`, `internationalReputation` | percentage each |
| `economy` | `gdp`, `gdpGrowth`, `gdpPerCapita`, `currency`, `inflation`, `unemployment`, `publicDebt`, `budgetBalance` | nonempty string each |
| `gdpBreakdown` | `agriculture`, `industry`, `services` | percentage each — **must sum to exactly 100** (see §5.3) |

---

## 5. Layer 1 validation — `validateGameplayPayload`

Two stages inside one function: the generic schema walk, then per-task rules.

### 5.1 `validateAgainstSchema` — the hand-rolled schema walker

There is **no Ajv / JSON-Schema library** here; validation is a bespoke recursive walk supporting exactly the keywords the schemas use. If you use a JSON-Schema keyword this walker doesn't implement, it is silently ignored.

| Keyword handled | Behavior |
|---|---|
| `anyOf` | Passes if the value matches **any** candidate; else concatenates all sub-errors |
| `type` | `integer` = number AND `Number.isInteger`; missing `type` matches anything |
| finite check | `number`/`integer` must be `Number.isFinite` (rejects `NaN`/`Infinity`) |
| `minimum`/`maximum` | numeric bounds |
| `enum` | value must be in the list |
| `minLength` | string length (this is how `nonEmptyTextSchema`'s `minLength:1` is enforced) |
| `minItems`/`maxItems` | array length |
| `items` | recurse into each element |
| `required` | each key must be an own-property (via `hasOwnProperty`) |
| `additionalProperties: false` | any key not in `properties` → `"… is not allowed."` |

`valueType` distinguishes `null`/`array`/`object`/primitive so error messages are precise. `propertyPath` builds JSONPath-ish locations (`$.economy.gdp`, `$.events[3].date`) so retry feedback names the exact offending field.

> **Caveat — nested `anyOf` schemas validate loosely.** `unitOpSchema` and `markerOpSchema` have `anyOf` at the top of the item but **no `type`** on the wrapper. The walker's `anyOf` branch tries each candidate and passes if any matches. Because the candidate objects use `additionalProperties: false`, a mostly-correct op usually matches one branch — but this is a weaker guarantee than a discriminated union. The real teeth for unit/marker ops are in Layer 2 (`validateGeneratedWorldChanges`), which is why alias ops like `found`/`destroy` slip past Layer 1.

### 5.2 Per-task generic rules

After the schema walk passes, `validateGameplayPayload` runs task-specific checks. These exist because the schema can't express cross-field constraints or non-blank-after-trim.

| Task | Extra rule |
|---|---|
| `jumpForward` / `autoJumpForward` | `stopDate` non-blank; every event's `date`/`title`/`description` non-blank after trim; **at least one of** events or a non-empty summary |
| `pregameHistory` | every event's `date`/`title`/`description` non-blank; `summary` non-blank |
| `descriptionToAction`, `eventConsolidator`, `interactiveCreation`, `interactiveExecutor`, `interactiveSummary`, `gameMaster` | a per-task list of top-level fields must be non-blank after trim (`requiredTextByTask`) |
| `interactiveCreation` | `choices` distinct (`validateDistinctChoices`) |
| `interactiveExecutor` | `nextChoices` **must be empty when `resolved`**; must have **≥2** when unresolved; must be distinct |
| `countryStatSheet` | deep no-blank-strings (`findBlankString`); **gdpBreakdown sum = 100** |
| `actions` | each topic `title` non-blank; each action `title` AND `text` non-blank |

Helpers backing these:

- **`validateDistinctChoices`** — trims + lowercases each choice, flags the first blank, then rejects if the `Set` size differs from the array length (duplicate detection).
- **`findBlankString`** — recurses the entire value (objects and arrays) and returns the JSONPath of the first whitespace-only string. Used by `countryStatSheet` so no field in the sheet ships blank. Note this is stricter than the schema's `nonEmptyTextSchema` (which only checks `minLength`, so `"   "` would pass the walker but fail here).

### 5.3 The `gdpBreakdown` sum-to-100 rule

```
if (breakdown.agriculture + breakdown.industry + breakdown.services !== 100)
  return { valid: false, error: "$.gdpBreakdown percentages must sum to 100." };
```

Each part is already a `percentageSchema` (int 0–100) by Layer 1, but three in-range integers can still sum to 97 or 110. This exact-equality check (`!== 100`, not a tolerance band) guarantees the three-slice pie the stat sheet renders is coherent. A model that emits `40/40/30` fails and, on attempt 1, is told to fix it.

### 5.4 The capture-reluctance guards (Layer 2, `validateGeneratedWorldChanges` in `gameplay.js`)

Not in `validateGameplayPayload` — they live in `validateGeneratedWorldChanges`, which jump/GM tasks pass as their `validatePayload` callback. The recurring field report they fix: "two turns of invasions and not a single province transferred."

They run on the strict attempt only, only for event-shaped payloads, and only while the `captureGuard` option is on (the default). The Game Master preview passes `captureGuard: false`: an administrative correction may mention an annexation without moving a border. Two checks, over every event's `title`+`description`:

1. **Control changes.** If the whole payload has **zero** `regionControlOps` and an event matches `CONTROL_CHANGE_LANGUAGE` — a word-boundary-anchored regex of *capture verbs* (`captur*`, `seiz*`, `conquer*`, `occupy/ies/ied/ation`, `overran/overrun`, `liberat*`, `retak*`, `recaptur*`, `fell to`, `falls to`, `takes control`, `assumes control`) — without also matching the legal wording below, the error asks for control operations (`op=control` for a capture/occupation/liberation, `op=contest` while a region is disputed) or for the capture language to go.
2. **Legal transfers.** If the whole payload has **zero** `regionTransfers` and an event matches `LEGAL_TRANSFER_LANGUAGE` (`annex*`, `cede/ceded/ceding`, `cession`, `sovereignty passes/transfers`, `treaty transfer`, `formal(ly) transfer(red)`, `incorporat*`, `unification`, `territorial award`, `sold`, `sale of territory`), the error asks for legal transfers (one per region, or `wholeCountry: true` for a total annexation or unification) or for the settlement wording to go.

So wartime captures belong in `regionControlOps`, not `regionTransfers`; `annex*` and `cede*` moved from the capture list to the legal one. Both regexes are narrow by design: "preoccupied"/"occupational" never match, and defensive battles that move no borders (war verbs, not capture verbs) never trip them. English-only heuristic; non-English games just skip the nudge. Because the guards are **strict-only**, they can never cost a finished turn on the final attempt.

---

## 6. `validateGeneratedWorldChanges` — the world-aware Layer 2 (`gameplay.js`)

Passed as `validatePayload` by `jumpForward`/`autoJumpForward` (`gameplay.js`) and `gameMaster`. It both **validates and mutates in place** (canonicalizing region ids, dropping dead ops), so a payload is only accepted after it has passed through here clean. Signature: `(candidate, world, { strictTransfers })`. `strict = strictTransfers` and callers set it to `!finalAttempt`.

| Check | Strict behavior (attempt 1) | Salvage behavior (final attempt) |
|---|---|---|
| Region transfers unresolvable against the map | Return `buildTransferFeedback` — the losing owner's real region list so the model can resend with exact ids/names | Leave unresolved transfers for normalization to drop |
| Capture narration + zero transfers | Corrective error (see §5.4) | Skipped entirely |
| `createdChats` with no known participants | Reject | Drop the chat, keep the turn |
| `createdChats` opener/title missing | Reject (`validateChatOpener`) | Skipped |
| `unitOps.spawn` missing name/ownerCode | Reject | Drop the op |
| `unitOps.spawn` duplicate id | Reject | `delete unit.id` so normalization mints a fresh one |
| `unitOps` targeting a nonexistent `unitId` | Reject | Drop the op |
| `markerOps.build` missing name / coords | Reject | Drop the op |
| `markerOps.remove` missing name+id | Reject | Drop the op |
| `diplomaticOutreach` with no known participants / bad opener | Reject | Drop the outreach |

`buildTransferFeedback` caps at the first 3 unresolved transfers and lists up to 40 candidate regions each (`"Pomorskie (POL.11_1)"`) — small, targeted vocabulary so the model can fix "Pomerania" into a real id on the retry instead of losing the map change.

---

## 7. The `additionalProperties: false` trap

**A field that is not declared in a schema's `properties` cannot round-trip — even if the prompt asks for it and the writer code handles it.** Two independent gates enforce this:

1. **The provider.** In OpenAI `json_schema` mode (and strict tool modes), the schema — including `additionalProperties: false` — is sent verbatim and the provider constrains generation to it. The model literally cannot emit an undeclared key. (Gemini is the exception: `toGeminiSchema` strips `additionalProperties`, `main.jsx` — but you cannot rely on that, since other providers enforce it.)
2. **The local validator.** Even if a model volunteers an extra key, `validateAgainstSchema` returns `"… is not allowed."` for any property missing from `properties` when `additionalProperties === false` (`gameplaySchemas.js`). The payload is rejected.

The lived example is `reputation` on `polityChangeSchema`. The prompt requested it, `gameState` normalized/clamped/wrote it — but the field was missing from `properties`, so `additionalProperties: false` meant a strict provider **could never emit it** and international reputation silently never moved. The fix was simply to declare it. The in-code comment is worth reading before you touch any schema.

**Checklist to make a new field emittable:**

1. Add it to the relevant schema's `properties` (with a good `description` — the model reads it).
2. Add it to `required` only if it must always be present (most impact fields are optional).
3. Make sure the writer/normalizer in [world state](world-state.md) actually reads and applies it.
4. If it needs a cross-field or non-blank rule the schema can't express, add it to `validateGameplayPayload` or the task's `validatePayload` callback.

Skipping step 1 is the silent-no-op failure mode.

---

## 8. `runJsonTask` — the request/validate/retry harness (`gameplay.js`)

Every AI gameplay call goes through this one function. It owns prompt assembly, the abort/timeout budget, the two-attempt loop, and the fallback.

### 8.1 Options

| Option | Meaning |
|---|---|
| `fallback` | Async function returning a deterministic payload when the AI can't produce a valid one. If absent, failure **throws** instead of falling back. |
| `signal` | External `AbortSignal` (player pressed Cancel) — propagated into `callAI` and the server relay. |
| `timeoutMs` | Default `120000`. `0`/non-finite **disables** the deadline (jumps use `0` unless "Limit AI generation" is on → 300000). |
| `userMessage` | The single user turn seeding `history`. |
| `validatePayload` | Optional Layer-2 callback `(candidate, { attempt, finalAttempt })`. |
| `variables` | Template variables for the rendered system prompt. |

### 8.2 Prompt assembly (before the loop)

1. `loadPromptCatalog` + `renderTemplate` build the system prompt from the current templates plus the campaign's guidance edits (ai-prompts.md §2).
2. Append the **difficulty directive** from `readGameData().difficulty`.
3. For `jumpForward`/`autoJumpForward`: nothing is appended; the live records are rendered into the template at `${JUMP_LIVE_STATE}` before it renders (ai-prompts.md §6a).
4. For `actions` and the interactive event tasks: append **[International Reputation]** context.

### 8.3 The two-attempt loop

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

- **`maxTokens: 8192`** is a per-response output ceiling only for capped providers; Gemini ignores it. Jumps used to request 16384, which only raised the ceiling and did nothing useful.
- **`retryInstruction` adapts to how the model answered**: a model that used a tool is told to "Call `<tool>` again with corrected input"; a prose model (no tool support) is told to "Respond again with ONLY the corrected JSON object". Telling a tool-less local model to call a tool it can't see would waste the one retry.
- Only **one retry** exists (attempt 1 → attempt 2). Spend it wisely — this is why strict validators front-load the most fixable errors.

### 8.4 `finalAttempt` — the linchpin of strict vs salvage

`finalAttempt` is `outputAttempt === 2`, computed **in `runJsonTask` from the real attempt counter**, never from counting validator invocations. The comment beside that computation in `runJsonTask` explains why this matters: if attempt 1 dies at the schema/parse layer, `validatePayload` never runs, so a self-counting validator would think attempt 2 was its "first" call, emit *strict* feedback meant for the model, and hand that string to the player as a fallback reason (a real field report: fallbacks that read "Resend the same response with…"). Sourcing `finalAttempt` from the loop counter is what keeps strict feedback pointed at the model and salvage pointed at the player.

### 8.5 Strict vs salvage — the contract

Every Layer-2 validator follows the same discipline. `strict = !finalAttempt`:

- **Attempt 1 (strict):** return a **corrective error string** describing exactly what's wrong. This becomes the retry message; the model usually fixes its own answer. Shape problems (wrong event count, stray dates, unresolvable region names, bad ops) are all strict here.
- **Attempt 2 (final = salvage):** **never reject a finished generation to the canned fallback over cosmetics.** Instead repair in place: `clampTimelineDates` pulls stray dates into the window (`timelineDates.js`, called from the jump validator in `gameplay.js`), unresolvable transfers/ops are dropped, duplicate unit ids are deleted so normalization re-mints them. A good story with sloppy dates beats canned events every time.

The jump validator is the canonical example: `const strict = !finalAttempt;` gates the event-count check, then `validateTimelineDates` (strict → return error; salvage → `clampTimelineDates`), then `validateGeneratedWorldChanges(..., { strictTransfers: strict })`. `pregameHistory` (`validatePregameEvents`) and `idleDiplomacy` follow the identical pattern.

### 8.6 Outcomes

| Situation | Result |
|---|---|
| Valid payload (either attempt) | `{ generation: { source: "ai", fallbackReason: "" }, payload }` |
| Player cancelled (`signal.aborted`) | **Throws** the abort reason — never silently falls back |
| No `fallback` provided + failure | Throws `AI task "<key>" failed: <reason>` |
| `fallback` provided + failure/timeout | Warns, returns `{ generation: { source: "fallback", fallbackReason }, payload: await fallback() }` |

Callers read `generation.source`/`fallbackReason` to tell the player whether they got a real AI turn or the deterministic fallback.

---

## 9. JSON recovery — `extractJsonPayload` (`gameplay.js`)

When a model answers in prose instead of a tool call, `runJsonTask` must dig the JSON out. The recovery ladder:

1. **Strip think blocks** — `<think>…</think>` and a leading `…</think>` (reasoning models / Ollama templates prepend these).
2. **`lenientJsonParse`** the whole text: try `JSON.parse`; on failure repair the two slips small models make — curly `"smart"` quotes → `"`, and trailing commas before `}`/`]` — then reparse. Repairs run **only after** a strict parse fails, so well-formed output is never touched.
3. **Any fenced block** — `` ```json ``, `` ```JSON ``, `` ```javascript ``, or bare `` ``` `` — parsed leniently.
4. **`balancedJsonCandidates`** — a string-aware brace/bracket walker that extracts every balanced top-level `{…}`/`[…]`, sorted objects-first so a stray inline array in the model's commentary can't shadow the real object payload. Each candidate is parsed leniently; first object wins.
5. Returns `null` if nothing parses → Layer 1 reports `"Response did not contain parseable JSON or tool arguments."`

This ladder is what lets local/self-hosted models without tool support still play; hosted providers normally return clean `toolInput` and skip it entirely.

---

## 10. Where to look when…

| You want to… | Go to |
|---|---|
| Add/change a field the model returns | `gameplaySchemas.js` `properties` + [§7 trap](#7-the-additionalpropertiesfalse-trap) |
| Add a whole new task | Add schema → `GAMEPLAY_SCHEMAS` + tool → `GAMEPLAY_TOOLS`, then a caller using `runJsonTask` |
| Change what makes a payload invalid (generic) | `validateGameplayPayload` (`gameplaySchemas.js`) |
| Change map/world-aware validation | `validateGeneratedWorldChanges` (`gameplay.js`) |
| Tune retry feedback wording | The corrective strings returned by the validators (they are shown to the model verbatim) |
| Debug "the AI turn silently became a fallback" | `runJsonTask` `failureReason`, and check whether a strict error leaked (see `finalAttempt`, §8.4) |
| Debug provider tool wiring | `callAI` in `main.jsx` ([AI providers](ai-overview.md)) |
