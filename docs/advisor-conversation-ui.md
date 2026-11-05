# Advisor conversation UI — scoped visual contract

Status: Local Beta UI proposal (2026-11-05), pending in-game visual acceptance and PR. The implementation is not in upstream Beta until merged and released.

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
