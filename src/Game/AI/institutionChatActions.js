/*! Open Historia Continuum - formal institutional actions carried by Beta's one-request chat turn. */

export const INSTITUTION_CHAT_ACTION_KINDS = Object.freeze([
  "institution_lodge_proposal",
  "institution_submit_proposal",
  "institution_amendment",
  "institution_resolve_amendment",
  "institution_vote",
]);

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => text(value).toLocaleLowerCase();
const clip = (value, max) => text(value).slice(0, max);

export const normalizeInstitutionChatAction = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const type = lower(entry.type ?? entry.action ?? entry.op);
  if (!INSTITUTION_CHAT_ACTION_KINDS.includes(type)) return null;
  const actorName = text(entry.actorName ?? entry.actor ?? entry.speaker);
  if (!actorName) return null;
  const base = { type, actorName };

  if (type === "institution_lodge_proposal") {
    const title = clip(entry.title ?? entry.proposalTitle, 240);
    const summary = clip(entry.summary ?? entry.content ?? entry.text, 2400);
    if (!title || !summary) return null;
    return {
      ...base,
      title,
      summary,
      proposalType: clip(entry.proposalType ?? entry.kind ?? "resolution", 120) || "resolution",
    };
  }

  const proposalId = clip(entry.proposalId ?? entry.proposal ?? entry.targetProposalId, 160);
  if (!proposalId) return null;

  if (type === "institution_submit_proposal") return { ...base, proposalId };

  if (type === "institution_amendment") {
    const amendmentText = clip(entry.amendmentText ?? entry.text ?? entry.content, 4000);
    return amendmentText ? { ...base, proposalId, amendmentText } : null;
  }

  if (type === "institution_resolve_amendment") {
    const amendmentId = clip(entry.amendmentId ?? entry.amendment, 160);
    const amendmentStatus = lower(entry.amendmentStatus ?? entry.status);
    if (!amendmentId || !["accepted", "rejected", "withdrawn"].includes(amendmentStatus)) return null;
    return { ...base, proposalId, amendmentId, amendmentStatus };
  }

  const voteChoice = lower(entry.voteChoice ?? entry.choice ?? entry.optionRef);
  if (!["yes", "no", "abstain", "veto"].includes(voteChoice)) return null;
  return {
    ...base,
    proposalId,
    voteChoice,
    ...(text(entry.reason) ? { reason: clip(entry.reason, 1200) } : {}),
  };
};

export const partitionInstitutionChatActions = (actions) => {
  const formal = [];
  const conversational = [];
  for (const entry of Array.isArray(actions) ? actions : []) {
    const normalized = normalizeInstitutionChatAction(entry);
    if (normalized) formal.push(normalized);
    else conversational.push(entry);
  }
  return { formal, conversational };
};
