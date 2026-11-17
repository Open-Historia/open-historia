# Advisor Action history and canonical queue boundaries

**Scope:** Individual Chief/Minister Advisor chats. Group Chat has its own bounded history renderer; character contacts do not have Action authority. Status: Beta bugfix branch `fix/beta-advisor-stale-action-history-2026-11-12`, based on upstream `beta` at `fc03eb2ed1797c00d1961a3380d60d9d8464e86a`; not merged or released.

## Root cause and contract

The native Action parser treats an `actions` JSON entry with a nonempty `id` as an edit/removal of **exactly that queued order**. The canonical board must contain the ID exactly once with `status: planned`. A resolved, absent, duplicate, or fabricated ID cannot be edited, and a rejected edit must **never** be silently reinterpreted as a new Action. The player still approves each valid proposal through **Proceed / Queue**; replies do not execute orders.

Individual Advisor histories previously replayed the raw machine-readable ```actions fences in older model replies into subsequent provider calls, including after save/reload and retries. Those IDs are *historical descriptions*, not proof of a currently editable order. Conversely, `buildPlannedActionsWithIdsText` in `src/Game/AI/promptContext.js` intentionally exposes only the canonical `planned` queue to the new prompt. This contradiction encouraged the model to copy stale IDs from its own previous output, even though validation correctly refused them.

## Native source ownership

- `src/Game/AI/advisorActionHistory.js`: pure, deterministic history renderer. Removes previous Action JSON fences **only from Advisor model context** and replaces them with a non-executable historical marker. Handles malformed/unfinished fences without accepting them as work. For persisted replies with native review-card metadata, supplies bounded titles and historical receipts **without** original target/action IDs; a past receipt does not establish present queue status.
- `src/Game/AI/main.jsx`: `loadHistory` sanitizes historical minister/chief replies **before** `compactConversationHistory` can collapse old model text into a synthetic user-side summary; `sendMessage` also filters provider-bound prior history and the just-generated reply before retaining it for a subsequent in-session call.
- `src/Game/GameUI/advisor.jsx`: passes recipient character type through thread selection and storage retry. Ordinary character conversations retain their content unchanged. The **raw** newly generated reply remains intact for `parseAdvisorReply`, native proposal review, UI cards, transcript persistence, and diagnostics.
- `src/Game/GameUI/advisorActionReview.js`: unchanged. Its fail-closed target check, stable Action IDs, canonical queue mutation, and Proceed permission boundary remain authoritative. Likewise no Group Chat routing or Action execution contracts changed.

The renderer is **not** a new authority for queued/resolved status. The current canonical Actions list remains the only valid set of edit/remove targets. Descriptions of historical proposals are not commands, not approved actions, and not evidence of execution.

## Unapproved draft revision context (Marina, 2029-08-31)

The source incident also exposed a distinct lifecycle state: Marina had saved two Action review cards for Yekaterinburg labor compliance and regional winter readiness, but neither was yet approved. When asked to refine them, the model treated the draft IDs as editable **queued** Action IDs and the native review correctly rejected both. Later, she emitted new create proposals without target IDs; the player approved them and both revised Actions entered the canonical queue.

Individual Minister/Chief system prompts now receive a **fresh, per-thread inventory of persisted unapproved create proposals**, separate from `[Current Planned Actions]`, with bounded original scope and an explicit new-create-for-revision contract. This native inventory is reconstructed each generation from saved review cards and Action state, not hallucinated from historical AI JSON. Proposals with an existing receipt or canonical Action ID are excluded. The contact's private inventory cannot leak to another minister, Group Chat, or a non-minister character.

The saved campaign also demonstrates that an earlier unapproved proposal can coexist with a **different later approved Action of the same title**; titles are not stable identities. In that case the context flags the queued-title collision for human/model comparison, without claiming automatic supersession, suppressing the original card, or editing any order. True first-class in-place draft revision/supersession remains a separate design task; this patch teaches the model how to request a fresh reviewable Action within the existing native contracts and preserves the player's Proceed gate. Projects have a separate existing authorization/update path and are **not rewritten** by this fix.

## Regression evidence

Captured from an installed Beta Russian Federation save, in-game August 21–29, 2029:

- Boris requested updates against a fabricated historical target and twice against a genuine Sirte Basin Action that had already **resolved at round 317**.
- Irina requested an update against an invented Moreau accountability placeholder instead of a queued Action.
- The existing validator rejected each invalid edit as intended. Boris later generated a separate new valid Action after repeated manual correction; that Action and a second Priority Green Action are already queued. An independent Moreau review proposal was saved but not queued.
- In a **read-only local replay** against the active save, Boris's 89 and Irina's 26 historical fenced Action blocks were removed from AI-facing history, while player input and saved Advisor messages were untouched. This is a deterministic source replay, not a claim about live model generation.

Focused regression tests in `src/Game/AI/advisorActionHistory.test.js` cover real ID patterns, malformed blocks, player-text isolation, saved native proposal titles/receipts, character exclusions, both fresh/reload paths and source integration. Existing target-status tests continue to require invalid edits to fail closed.

## Limits and watch items

This prevents *historical machine JSON* from being replayed as a reusable operation, including across compaction. It does not guarantee an external language model never fabricates an ID in a fresh response. Existing validation still blocks such attempts; a separate explicit, player-approved recovery affordance is a potential future enhancement, **not implemented** here. The fix does not backfill or queue already-rejected historical proposals, and no active campaign data has been changed.

For testing, always distinguish deterministic replay, unit tests, Vite build, and a genuine provider-mediated live playtest; do not present one as the other. Source work and checkpoint evidence belong to the isolated Beta bugfix branch, not the accepted A3 branch or the Native track.
