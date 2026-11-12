# Advisor diplomatic-history context and read-only retrieval

**Track:** Beta. Source of truth: `src/Game/AI/advisorDiplomaticContext.js` and the call site in `src/Game/AI/main.jsx`. This is an individual Chief/Minister prompt-context implementation. Group Chat uses its separate bounded history and does not receive individual Advisor lookup tools. It is not a replacement for Time Skip history folding, canonical diplomacy, or Action/Project review.

## Background and data ownership

The source audit of the 2029-08-31 Russian Federation campaign showed 1,657 events, 396 Actions, 53 diplomatic threads and 1,840 Advisor messages. The Advisor already used consolidated event history, history tiers, a bounded list of recent events, a 24-resolved-Action excerpt, a separate Advisor conversation compactor, and archived-diplomacy retrieval. The incorrect diagnosis was that it received every timeline event unbounded.

The genuine issue was the `CHATS_NON_CONSOLIDATED_ROUNDS` helper: `buildPromptContext` built `chatHistoryLong` from ten full messages in each of up to eight active diplomatic threads with no character budget when called from `buildPromptVariables` for a conversation. It generated **97,735 characters** in that save. Four chats were archived; 39 of 43 unconsolidated chats remained active under the 12-month/four-skips archive policy and its legal/lifecycle exemptions. The model's latest user question could also be absent from persisted Advisor messages while the archive search was running.

## New Advisor-specific read model

`buildAdvisorSystemPrompt` replaces only the Advisor's `chatHistoryLong` with `renderAdvisorDiplomaticContext`. It excludes the expensive legacy key from the demanded variable set and instead constructs a **maximum 16,000-character** view from the same current read-only campaign bundle:

- Total, active, unconsolidated and archived counts.
- A broad, **bounded source-thread continuity index** before detailed dialogue: each active thread gets a compact saved-memory or most-recent-source summary, date, source thread ID and canonical open-demand count when present. These are historical conversation summaries, **not proof of binding or executed sovereign commitments**. If the limit is reached, the omission count is explicit; no saved thread is deleted.
- Most recently active threads, capped by a per-thread budget, including named participants, the most recent durable diplomatic memory, and two recent dated/attributed statements.
- A couple of slots reserved for older active threads to prevent an influx of routine new dialogue from hiding every older relationship.
- Dated source-message excerpts matched against the **current** Advisor question by evidence-bearing source-token overlap or a named subject—not an English-only diplomatic-keyword allowlist. The matched old message can come from an active or archived thread. A bounded best-match source window favors a requested final clause over an earlier heading; weak generic matches are excluded. This is lexical matching, not guaranteed semantic recall.
- Existing archived-diplomacy summaries/binding notes, when they fit, rather than rewriting canonical archived chats.
- Omission notes when only a sample of active threads is shown. Never present a truncated source quote as a complete treaty.

There is no new AI summarization task, storage schema, mutable archive, or save migration. Older source messages, even in still-active threads, remain available in their original saved form. Long player turns give the retrieval terms near the end priority alongside terms from the beginning.

## Native lookup boundary

When Settings permits AI lookup functions, the individual Chief/Minister path offers:

- `search_advisor_diplomacy({query,partner?,limit?})` — deterministic lexical lookup against **all saved chats visible in the player-as-viewer snapshot**, returning exact threadId, messageIndex, sourceMessageId (when stored), original message length, date, participant, speaker, bounded excerpt, and relevance score.
- `read_advisor_diplomacy({threadId,messageIndex?,messageId?,offset?,maxChars?,around?,limit?})` — **bounded pagination of the exact original source string**, up to 2,000 characters per page (900 by default), with `totalChars`, `offset`, `hasMore`, and `nextOffset` for further pages. `messageId` can be supplied to fail closed if the message at the index changed. Legacy adjacent-message `around` and `limit` remain supported; invalid or inaccessible threads, indices, IDs and offsets fail closed. No writes or fabricated IDs.

The lookup tools compose with existing Group/Map tools instead of replacing them, with up to five lookup rounds on the individual path so a search and several source pages can complete. Existing provider-wide tool guards remain in force. When lookups are disabled (or in shared-batch mode), question-relevant dated excerpts in the capped prompt provide a minimum fallback, rather than blindly dropping all historical evidence. The lexical search may miss synonyms and is not an embedding/RAG semantic search. The saved source remains available to the player if an exact citation is uncertain.

The **audience rule** remains critical: the new search and direct read honor `filterChatsVisibleTo` when a reader is restricted, and these tools are **not** added to the foreign Leader, Time Skip, or non-minister character paths. Advisor prompts use `viewAsSeen` so unrevealed mid-skip data does not leak. Direct chat messages are evidence, not authorization for Action/Project mutation or execution.

## Tests and regression expectations

`src/Game/AI/advisorDiplomaticContext.test.js` checks a 30-thread adversarial prompt, 50k-character recent messages, all 40 active sources indexed under the cap, exact pagination through an arbitrarily long treaty including its final clause, source message ID validation, old treaty retrieval in an active and archived thread, native open demand projection, invalid ID/index/offset fail-closed behavior, restricted audience, source-focused no-lookup fallback including non-English questions, generic-topic suppression, long-turn tail terms, and Advisor-only wiring. Existing `chatArchive`, `chatVisibility`, Advisor Group, Action queue/draft and recipient tests remain authoritative.

Compare the real campaign's old 97,735-character diplomatic section to the new capped 16,000-character section (~84% reduction). The broader system prompt still contains time-aware event tiers, simulation rules, canon, current world state, and other sections; this figure is **not** a measured total token count nor a guarantee about a provider's quality or maximum context setting.

## Limitations and next milestone

The system still has one provider-specific context window and other variable-size context sections. A bounded *diplomatic* section does not imply the entire prompt is under every model's context limit. No automatic mutation, Action proposal revision, or Project authorization is added here; those are governed by independent native contracts. The previously uncommitted Advisor Action A2 fixes are included in the cumulative release overlay and remain uncommitted in their original worktree. Live model behavior, especially whether Gemma uses the tools when needed, requires a disposable provider-mediated playtest. Time Skip's own history model and foreign Leader confidentiality are not changed.
