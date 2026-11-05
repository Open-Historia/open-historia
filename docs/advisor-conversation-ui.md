# Advisor conversation UI — scoped visual contract

Status: Advisor conversation visual redesign is merged in Beta source via PR #952 (merge `13aadc1e`, 2026-11-05). The separate multi-Action-fence parsing hotfix below is local source only until separately committed, merged, and released.

## Purpose and ownership

The Advisor drawer is a flexible **conversation workspace**, not a mandatory government-briefing mode. It supports short advice, ministers and officials, public-only civilian or fictional characters, free-form narrative/roleplay, and long Markdown replies. Never infer a genre, split natural-language dialogue into speakers using regex, fabricate named participants, or rewrite a message into briefing sections for display.

Implementation is owned by `src/Game/GameUI/advisor.jsx`, `AdvisorRecipients.jsx`, and their scoped stylesheet `advisorDossier.css`. The styling is rooted under `.oh-advisor-drawer` and intentionally separate from the Country dossier. The shared `markdown.jsx` renderer is unchanged; this UI adjusts only the Advisor's Markdown typography locally.

## Visual behavior

- The drawer, header and composer use a restrained dark navy palette with subtle blue/cyan accents and rectangular controls. Preserve desktop resizing and current phone safe-area geometry.
- The selected recipient remains visible in the collapsed picker. The expanded contact list is a compact ledger with a subtle selected row and still-visible Edit, Retire, Restore and contact-creation actions. Choosing a conversation collapses the picker. Existing confirmation, archived-state, office binding and public-only status notices remain unchanged.
- Advisor, minister and character replies appear as open long-form text with a narrow left rail, not one large filled grey speech bubble. User messages remain visually distinct, compact, right-aligned blue-toned messages. Errors, document notices and pending-response indicators retain distinct treatments.
- The message body is presented verbatim through the existing Markdown component. Paragraphs, headings, blockquotes, lists, emphasis, inline/fenced code, tables, original dialogue punctuation, draft buttons and charts are still rendered by the original components. No extra titles or authoring conventions are imposed.
- The bottom composer keeps textarea auto-height, Enter/Shift+Enter mechanics, loading/disabling and save/load guards. The old rocket glyph is replaced with an accessible conventional arrow, with appropriate focus/disabled colors and reduced-motion treatment.

## Non-negotiable boundaries

- **One recipient per Advisor thread remains canonical.** The existing `advisorThreads.js` recipient records and `threadId` ownership are unchanged. Native multi-person Advisor conversations (distinct participant identities, separate memories and per-participant information visibility) are **explicitly deferred**; do not merge them into this UI feature.
- Ordinary dialogue involving multiple characters may be written within a single model response, but that response retains its existing Advisor-thread identity. Never infer an independent speaker or grant access to another recipient's private history from text.
- Preserve recipient-type permission and government-knowledge separation. Non-minister characters receive only public scenario context and their own conversation. Never change `advisorRecipientForReply`, the AI prompt dispatch, or thread storage to make the visual redesign work.
- Preserve `React.memo(AdvisorMessageRow)` and `React.memo(AdvisorMessageList)`, lazy mounting of earlier messages, stable callback ownership, streaming, draft and approval controls, charts and error/report actions. No chat-history reparsing on composer keystrokes.
- No canonical game-state mutations, AI prompt changes, new mode preferences or schema changes are part of this patch.

## Regression checks

`src/Game/GameUI/advisorVisualLayout.test.js` covers scoped styling, memoized rows, native message/control preservation, recipient permissions, composer behavior, and responsive/accessible selectors. Existing `advisorRecipientsArchitecture.test.js`, `advisorThreads.test.js`, Advisor reply/draft tests, localization/no-gradient tests and the full Beta suite continue to apply.

Development note: the previous Political World Parties/Power Blocs switch is on a separate uncommitted feature track in the same local checkout. Keep the Advisor's overlay archive scoped only to its own modified/new files and this document. Do not mix commits, PRs or release claims across these tracks.

## 2026-11-05 — multiple fenced Advisor Action proposals (local hotfix)

A provider can emit several separate ```actions JSON arrays in one reply, even though the prompt asks for a single array. Previously `parseAdvisorReply` stripped only the first `actions` fence and `advisor.jsx` independently extracted that same first block when constructing persistent proposal attachments. Later Action arrays were displayed as raw horizontal-scrolling JSON code instead of reviewable cards. This is a parser contract bug, not a consequence of the Advisor visual stylesheet or a change in the Actions simulation.

`src/Game/GameUI/advisorReply.js` now uses the existing fenced JSON extractor repeatedly for Action blocks, preserving source order and leaving all other named block types on their existing routes. It hides completed raw Action fences and unfinished trailing `actions` content while streaming or on finalization. Malformed, non-list or truncated Action blocks do not yield partial speculative Action proposals, and the failure is reported in `actionBlockProblems`. `advisor.jsx` derives the stored proposals and error receipts from that same parse result; it no longer independently extracts only the first block. The existing `actionProposalsFromReply` validation, 24-proposal total limit, stable reply-bound IDs, per-proposal Discuss/Proceed confirmation, board writer, idempotency, recipient permissions and game-turn boundaries are unchanged. **No Action is auto-queued.**

Existing persisted Advisor messages are not rewritten or silently reinterpreted as newly authorized proposals. Future replies can show all accepted Action cards; old messages with missing proposal attachments cannot safely be auto-backfilled without a separate migration/authority decision. The reporter supplied screenshots (Gemma4:31b; Cold War scenario), not the underlying raw model transcript; the repeated correctly labeled fence diagnosis is reproduced in native tests, while alternate raw fence labels or malformed provider syntax have not been independently observed in that live report.

Regression evidence: `src/Game/GameUI/advisorReply.test.js` reproduces three separate Action arrays with two subsequent raw-code leaks, verifies stable proposal identities across the complete sequence, preserves the global 24-proposal bound across separate fences and rejects malformed/incomplete secondary blocks. The full project suite, production builds and user-facing retest must be recorded as separate gates before release.
