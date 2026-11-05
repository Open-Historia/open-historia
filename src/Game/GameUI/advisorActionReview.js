/*! Open Historia — Advisor Action review; proposals are never board writes. AGPL-3.0-or-later. */
import { planAdvisorActionEdits } from "./advisorBlocks.js";

const nonempty = (value, max = 12000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const MAX_PROPOSALS_PER_REPLY = 24;
const RECEIPT_STATUSES = new Set(["queued", "updated", "removed"]);

// Preserve each machine-readable Action op as a REVIEWABLE message attachment.
// These objects are proposals, never effective Orders. Do not interpret prose
// as commands. A unique reply ID and index become the future canonical order ID.
export const actionProposalsFromReply = (operations, messageId) => {
  if (operations == null) return { proposals: [], problems: [] };
  if (!Array.isArray(operations)) return { proposals: [], problems: ["The Action block must contain a list; no Actions were queued."] };
  if (!/^advisor-reply-[a-z0-9-]{8,80}$/.test(String(messageId || ""))) {
    throw new Error("Advisor reply needs a stable message ID before proposing Actions.");
  }
  if (operations.length > MAX_PROPOSALS_PER_REPLY) {
    return { proposals: [], problems: ["The Action block exceeds the review limit; nothing was queued."] };
  }
  const problems = [];
  const proposals = [];
  operations.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`Action entry ${index + 1} is not an object.`);
      return;
    }
    if (["id", "title", "text"].some((field) => raw[field] != null && typeof raw[field] !== "string")) {
      problems.push(`Action entry ${index + 1} contains a non-text field.`);
      return;
    }
    if (String(raw.id || "").length > 150 || String(raw.title || "").length > 240 || String(raw.text || "").length > 12000) {
      problems.push(`Action entry ${index + 1} is too long; no truncated Action was offered.`);
      return;
    }
    const targetId = nonempty(raw.id, 150);
    const remove = raw.remove === true;
    const title = nonempty(raw.title, 240);
    const text = nonempty(raw.text, 12000);
    const operation = targetId ? (remove ? "remove" : "edit") : "create";
    if ((!targetId && remove) || (operation !== "remove" && !title && !text)) {
      problems.push(`Action entry ${index + 1} has no usable operation or content.`);
      return;
    }
    const kind = raw.kind === "chat" ? "chat" : "action";
    proposals.push({
      id: `proposal-${index}`,
      actionId: `action-${messageId}-${index}`,
      operation,
      ...(targetId ? { targetId } : {}),
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(operation === "create" ? { kind } : {}),
    });
  });
  return { proposals, problems };
};

const validateProposal = (proposal) => {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)
      || !/^proposal-\d{1,2}$/.test(proposal.id || "")
      || !/^action-advisor-reply-[a-z0-9-]{8,80}-\d{1,2}$/.test(proposal.actionId || "")) {
    throw new Error("Invalid saved Advisor Action proposal.");
  }
  if (!["create", "edit", "remove"].includes(proposal.operation)) {
    throw new Error("Unsupported Advisor Action operation.");
  }
  if (proposal.operation !== "create" && !nonempty(proposal.targetId, 150)) {
    throw new Error("The proposed Action no longer identifies a target order.");
  }
  if (proposal.operation !== "remove" && !nonempty(proposal.title) && !nonempty(proposal.text)) {
    throw new Error("The proposed Action has no content.");
  }
  return proposal;
};

// Pure planning against the LATEST canonical queue. The caller must perform
// this inside mutateActionsState to prevent stale read/append lost updates.
export const planApprovedAdvisorAction = (actions, proposal, normalizeAction, { repeatOf } = {}) => {
  const item = validateProposal(proposal);
  const current = Array.isArray(actions) ? actions : [];
  if (item.operation === "create") {
    const prior = current.find((order) => order.id === item.actionId);
    if (prior) {
      if (prior.title !== (item.title || item.text) || prior.text !== (item.text || item.title)
          || prior.kind !== item.kind) {
        throw new Error("An order with this proposal ID already exists with different contents.");
      }
      return { next: current, changed: false, receipt: { status: "queued", actionId: prior.id, title: prior.title } };
    }
  } else {
    const target = current.find((order) => order.id === item.targetId);
    if (!target || target.status !== "planned") {
      throw new Error("The referenced order is missing or no longer awaiting execution. Review the Actions board.");
    }
  }

  const raw = item.operation === "create"
    ? { title: item.title, text: item.text, kind: item.kind }
    : item.operation === "edit"
      ? { id: item.targetId, ...(item.title ? { title: item.title } : {}), ...(item.text ? { text: item.text } : {}) }
      : { id: item.targetId, remove: true };
  const plan = planAdvisorActionEdits(current, [raw], (created) => normalizeAction({
    ...created,
    id: item.actionId,
  }), { repeatOf });
  if (plan.problems.length || plan.items.length !== 1) {
    throw new Error(plan.problems.join(" ") || "The requested Action could not be queued.");
  }
  if (plan.reverts.length) {
    // Deleting pending deployments is not just an Actions JSON edit: it requires
    // map reversion. The standalone review action does not own that transaction.
    throw new Error("This Action also controls a placed unit. Remove it through the Actions panel.");
  }
  return {
    next: plan.next,
    changed: true,
    receipt: {
      status: item.operation === "create" ? "queued" : item.operation === "edit" ? "updated" : "removed",
      actionId: item.operation === "create" ? item.actionId : item.targetId,
      title: plan.items[0].title,
    },
  };
};

// Persist only an acknowledged native result on the originating message. The
// caller must first receive a successful queue write (or detect an existing
// same-ID order). Never mark a proposal accepted based on model prose.
export const recordAdvisorActionReceipt = (entries, threadId, messageId, proposalId, receipt) => {
  if (!Array.isArray(entries) || !RECEIPT_STATUSES.has(receipt?.status)
      || !nonempty(receipt.actionId, 150) || !nonempty(messageId, 140)
      || !/^proposal-\d{1,2}$/.test(String(proposalId || ""))) {
    throw new Error("Malformed Advisor Action receipt.");
  }
  const matching = entries.filter((entry) => entry?.role === "advisor"
    && (entry.threadId || "chief") === threadId && entry.id === messageId);
  if (matching.length !== 1 || !matching[0].actionProposals?.some((proposal) => proposal.id === proposalId)) {
    throw new Error("The original Advisor Action proposal is no longer available.");
  }
  const previous = matching[0].actionReceipts?.[proposalId];
  if (previous) {
    if (previous.actionId !== receipt.actionId || previous.status !== receipt.status) {
      throw new Error("This Advisor Action proposal already has a different confirmed receipt.");
    }
    return entries;
  }
  return entries.map((entry) => entry === matching[0]
    ? { ...entry, actionReceipts: { ...(entry.actionReceipts || {}), [proposalId]: {
      status: receipt.status, actionId: receipt.actionId, title: nonempty(receipt.title, 240),
    } } }
    : entry);
};
