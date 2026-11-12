/*! Open Historia — historical Advisor Action context is not executable state. AGPL-3.0-or-later. */

// Old Advisor replies are still valuable conversational evidence, but their
// machine-readable Action fences are NOT a current queue inventory. In
// particular, a past edit target may now be resolved, removed or fictional.
// The canonical [Current Planned Actions] section supplies the ONLY editable
// order IDs. Redact fences from MODEL CONTEXT, never from persisted messages,
// the UI's review cards, or the reply being validated by native Action review.
const HISTORICAL_ACTION_NOTE =
  "[Historical Action proposal omitted from conversation replay. Only the current planned Actions list identifies editable orders; new follow-up work requires a separate proposal and player review.]";

// Also consume an unfinished historical fence so malformed old output cannot
// become a reusable edit example after reload or a partial-generation retry.
export const redactHistoricalAdvisorActionBlocks = (text) =>
  typeof text === "string"
    ? text.replace(/```actions\b[\s\S]*?(?:```|$)/gi, HISTORICAL_ACTION_NOTE)
    : text;

// Retain a bounded, non-executable description of real review cards saved with
// older replies. The original JSON target IDs are never echoed. An old receipt
// only establishes what happened THEN, not whether the Action is queued NOW.
export const renderHistoricalAdvisorReply = (message) => {
  const text = typeof message?.text === "string" ? message.text : "";
  const redacted = redactHistoricalAdvisorActionBlocks(text);
  const proposals = Array.isArray(message?.actionProposals) ? message.actionProposals : [];
  if (redacted === text || proposals.length === 0) return redacted;
  const items = proposals.filter((item) => item && typeof item === "object").slice(0, 4)
    .map((item) => {
      const name = String(item.title || item.text || "Untitled").trim().slice(0, 130);
      const oldReceipt = message.actionReceipts?.[item.id]?.status;
      const decision = ["queued", "updated", "removed", "cancelled"].includes(oldReceipt)
        ? "historical receipt: " + oldReceipt + "; current status unknown"
        : "no recorded approval receipt";
      return name + " (" + decision + ")";
    });
  const extra = proposals.length > 4 ? "; " + (proposals.length - 4) + " additional review card(s)" : "";
  return redacted + "\n[Historical Action review cards, not editable queue entries: " + items.join("; ") + extra + "]";
};

// Preserve player instructions and every other message field/part. Only the
// outgoing AI history changes; source Advisor messages remain byte-for-byte
// available to the native parser, the Action cards, and diagnostics.
export const sanitizeAdvisorModelHistory = (history) => {
  if (!Array.isArray(history)) return [];
  return history.map((entry) => {
    if (entry?.role !== "model" || typeof entry.parts?.[0]?.text !== "string") return entry;
    const redacted = redactHistoricalAdvisorActionBlocks(entry.parts[0].text);
    return redacted === entry.parts[0].text ? entry : {
      ...entry,
      parts: [{ ...entry.parts[0], text: redacted }, ...entry.parts.slice(1)],
    };
  });
};

// Current pending drafts come from persisted native review cards, not old AI
// JSON or prose. Keep these separate from the canonical queued Actions list.
// No draft ID below may be used as the target of an edit or removal.
export const pendingAdvisorActionDrafts = (messages, currentActions, threadId = "chief") => {
  if (!Array.isArray(messages) || !Array.isArray(currentActions)) return [];
  const canonicalIds = new Set(currentActions.map((action) => action?.id).filter(Boolean));
  const queuedTitles = new Set(currentActions.filter((action) => action?.status === "planned")
    .map((action) => String(action.title || "").trim().toLowerCase()).filter(Boolean));
  const seen = new Set();
  const pending = [];
  for (const message of messages) {
    if (message?.role !== "advisor" || (message.threadId || "chief") !== threadId
        || !Array.isArray(message.actionProposals)) continue;
    for (const proposal of message.actionProposals) {
      if (proposal?.operation !== "create" || !proposal.id || !proposal.actionId
          || message.actionReceipts?.[proposal.id] || canonicalIds.has(proposal.actionId)
          || seen.has(proposal.actionId) || !String(proposal.title || proposal.text || "").trim()) continue;
      pending.push({
        title: proposal.title || proposal.text,
        text: proposal.text || proposal.title,
        // Name collision is only a warning, never proof of identity or a
        // reason to mutate, delete or silently supersede either proposal.
        sameTitleQueued: queuedTitles.has(String(proposal.title || "").trim().toLowerCase()),
      });
      seen.add(proposal.actionId);
    }
  }
  return pending;
};

const safeDraftText = (text, max) => String(text || "").trim()
  .replace(/[\r\n\t]+/g, " ")
  .replace(/`+/g, "'")
  .replace(/\s{2,}/g, " ")
  .slice(0, max);

// A bounded native inventory, refreshed for EVERY individual minister/chief
// call, survives compacted conversation histories. It is NOT an Action queue.
// Never include machine IDs: the next response must create a new review card
// if the player asks to refine a draft not yet approved.
export const renderPendingAdvisorActionDrafts = (drafts, maxChars = 4600) => {
  if (!Array.isArray(drafts) || !drafts.length || maxChars < 320) return "";
  const heading = "[Unqueued Action drafts in THIS conversation - NOT on the Actions board]\n"
    + "These are saved proposals awaiting the player's Proceed, not executable or editable orders. "
    + "If asked to revise, expand or replace one, propose a new create WITHOUT an id, with the complete revised scope; "
    + "the player must review it and should not queue the outdated draft. "
    + "For an actual queued Action, use ONLY an exact ID from [Current Planned Actions]. "
    + "Never guess IDs or edit by title.\n";
  if (heading.length >= maxChars) return "";
  let context = heading;
  for (const draft of drafts.slice(-5).reverse()) {
    const line = "- [NOT QUEUED]" + (draft.sameTitleQueued
      ? " [SAME TITLE AS A QUEUED ACTION; identity not verified; compare the queued order before proposing new work]"
      : "") + " " + safeDraftText(draft.title, 150)
      + " | Proposed scope: " + safeDraftText(draft.text, 1050) + "\n";
    if (context.length + line.length > maxChars) {
      const available = maxChars - context.length;
      if (available > 125) context += line.slice(0, available);
      break;
    }
    context += line;
  }
  return context.trimEnd();
};
