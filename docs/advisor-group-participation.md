# Advisor Group Chat: participation, memory, and Action continuity

Status: **Beta A3 development branch accepted for the five scoped live tests on 2026-11-11.** Not yet merged or released. The source baseline is upstream `beta` at `49ac8c04c695414cca8c4b75deca1aeea4b2755d`. This documents the later Group Chat feature, separate from the original single-recipient visual redesign in [Advisor conversation UI](advisor-conversation-ui.md).

## Ownership and routing

- `src/Game/AI/main.jsx`: `sendAdvisorGroupMessage` owns the request sequence, provider calls, and result validation; `buildAdvisorSystemPrompt` selects the memory directive for individual, group, or shared JSON-batch output.
- `src/Game/AI/advisorGroupMeetings.js`: selects all invited members not already completed for the turn. Direct mentions affect **order only**, not compulsory speech. Builds bounded shared history, prioritizes the complete latest user message, and carries canonical Action IDs plus saved unqueued proposals to the model. Parses the individual member's response before the UI completion callback.
- `src/Game/AI/advisorGroupBatching.js` and `advisorGroupSettings.js`: batch size and strict per-speaker JSON parsing. Device-local default is individual calls, sequentially; switching off individual responses groups members into sequential batches. A shared batch receives public participant profiles and group history, **not** each participant's private one-to-one history.
- `src/Game/GameUI/advisor.jsx` and `advisorGroupOrders.js`: validate and persist complete replies, staged native proposals, and recoverable partial completions. Individual successful responses are persisted before moving to the next member; shared-batch members are validated as a unit before application/persistence. The all-silent notice is presentation only and does not fabricate an Advisor reply or an Action.
- Canonical Actions and Projects continue to use existing native permission, ID, and mutation boundaries. A fenced Action proposal requires the player's separate **Proceed / Queue** approval; Advisor speech does not execute it.

## Independent participation contracts

- Each invited government member independently **speaks or passes**. There is no keyword-driven forced-speaker set. They may provide a distinct objection even when not addressed, but passing is legitimate when nothing material remains.
- In individual mode, silence is exactly `[[PASS]]` with no additional text, memory, Action, or Project. The parser fails closed on partial passes, missing replies, and a `[[PASS]]` followed by `ADVISOR_MEMORY:`, including an empty suffix. Substantive answers may include optional durable private memory after normal fenced proposal blocks.
- In shared JSON mode, every invited speaker must appear exactly once, in order and under their canonical ID. `pass: true` requires empty text and no memory/operations. For speaking members, optional memory belongs only in the structured JSON `memory` field; raw `ADVISOR_MEMORY:` in visible text is invalid.
- Ordinary one-to-one Advisor memory rules remain unchanged. The stricter Group Chat silence contract resolves Nestor's captured Crown Council conflict between a mandatory memory-on-every-reply directive and a literal pass. Invalid model output remains an error, never silently promoted to a valid pass.
- Group Chat history and canonical Action context retain long player directives, including authorization near the end. Do not silently truncate a new instruction or fabricate missing authorization. Native stable IDs distinguish same-named proposals, ministers, and existing board entries.

## Verified acceptance evidence (disposable Russia 2029 campaign)

The local development instance ran at `http://localhost:3003`, using a separate `OH_DATA_DIR` from the installed Beta app on port 3000. The test game was a disposable copy of the user's saved campaign, in-game 2029-07-30, round 301. Source and scenario copies were verified without altering the originals.

1. **Unanimous silence:** six members passed; no response or execution recorded, no new errors, no silent memory.
2. **Revised fiscal proposal:** Viktor answered; Orlov, Marina, and Belova contributed independent perspectives; two members passed.
3. **Discussion-only audit:** five substantive contributions, one pass, zero proposals; canonical Actions stayed at 348 and all 40 Project records matched the imported save (UTF-8 comparison).
4. **False historical attribution:** Sergei explicitly corrected the false premise; Orlov corroborated the saved meeting record.
5. **Two separate Action proposals:** Viktor and Marina had distinct reply-bound Action IDs. After the player queued only Viktor's Fiscal Analysis and reloaded the page, its exact native Action appeared **once**, with `planned` status; total Actions increased from 348 to 349. Marina's Operational Review remained **Proposed** in the UI and absent from the canonical Action list.

No new Group Chat error records were observed across these five live turns. Test 5 verifies distinct queued/proposed state and reload persistence; it does **not** establish post-time-skip Action resolution.

At the initial A3 checkpoint, the full upstream-based suite had **9,116 passing, 1 failing, 2 skipped, 2 TODO** out of 9,121 tests. The failure was an upstream cross-file Political Bridge architecture assertion that still expected `jumpChars < 28400`, although upstream commit `5ba77816` had deliberately raised the actual schema-size guard to `< 28450` for `regionControlOps[].part`. The schema itself passed its tests, and the A3 Advisor-focused suite passed 69/69 with a successful production build.

A follow-up on PR #1007 synchronized only the stale cross-file test expectation and documented the upstream reason, **without changing the schema or its enforced limit**. The complete Beta suite then passed **9,117 tests, 0 failures, 2 skipped, 2 TODO** (9,121 total), with the Political Bridge and schema contract tests passing 17/17 together. These figures are local validation; GitHub CI on the updated PR is a separate check.

## Acceptance scope and remaining watch items

The five exercised A3 behaviors are accepted as a local development checkpoint. The player explicitly waived the time-skip Action-resolution check because it was not part of the reported failure. A live provider test of a very long latest directive with authorization near its tail, cross-provider repeatability, and semantic completeness of a model's independent choice to pass remain unverified. Source tests cover long-message continuity but do not replace those live checks.

Keep request-performance concerns separate: individual calls are sequential by design; the existing shared-batch setting can reduce request count but may trade away private context and strict independent sequencing. No extra latency coordinator, forced-reply classifier, or parallel Action mutation path was added in A3.

Development evidence and source ZIP verification are recorded under `D:/OpenHistoria/Checkpoints/BETA_A_3_2026-11-11/UPSTREAM_RECONCILIATION/`, including `BETA_A3_LIVE_PLAYTEST_1_TO_5_EVIDENCE_20261111.md` and `BETA_A3_LIVE_TEST_5_APPROVAL_RELOAD_VERIFIED_20261111.md`. This document is not a claim that A3 has shipped in production Beta.
