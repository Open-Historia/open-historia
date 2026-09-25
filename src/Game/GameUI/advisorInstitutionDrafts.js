// Validates the Advisor's proposed formal institution actions before the UI
// offers a confirmation button. This module is deliberately import-free so it
// can run in the bare node:test gate without pulling in the game runtime.
//
// These are DRAFTS, not authority. advisor.jsx executes one only after the
// human player clicks its button, and the canonical institution runtime then
// revalidates membership, proposal state, ballot eligibility and lifecycle law.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();

const TYPES = new Set(["table-proposal", "submit-proposal", "vote", "invite"]);
const VOTE_CHOICES = new Set(["yes", "no", "abstain", "veto"]);
const MEMBER_STATUSES = new Set(["member", "observer", "associate", "participant"]);

export const buildInstitutionDrafts = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const type = lower(entry.type).replace(/[\s_]+/g, "-");
    const institutionId = clean(entry.institutionId);
    if (!TYPES.has(type) || !institutionId) return null;

    if (type === "table-proposal") {
      const title = clean(entry.title).slice(0, 160);
      if (!title) return null;
      return {
        type,
        institutionId,
        proposalType: clean(entry.proposalType || "resolution").toLowerCase().replace(/[\s_]+/g, "-").slice(0, 80) || "resolution",
        title,
        summary: clean(entry.summary).slice(0, 4000),
      };
    }

    if (type === "submit-proposal") {
      const proposalId = clean(entry.proposalId);
      return proposalId ? { type, institutionId, proposalId } : null;
    }

    if (type === "vote") {
      const proposalId = clean(entry.proposalId);
      const choice = lower(entry.choice);
      if (!proposalId || !VOTE_CHOICES.has(choice)) return null;
      return {
        type,
        institutionId,
        proposalId,
        choice,
        reason: clean(entry.reason).slice(0, 1200),
      };
    }

    const polity = clean(entry.polity);
    const requestedStatus = lower(entry.requestedStatus || "member");
    if (!polity || !MEMBER_STATUSES.has(requestedStatus)) return null;
    return {
      type,
      institutionId,
      polity,
      requestedStatus,
      reason: clean(entry.reason).slice(0, 1200),
    };
  }).filter(Boolean).slice(0, 8);
};

export const institutionDraftButtonLabel = (draft = {}) => {
  if (draft.type === "table-proposal") return `Table proposal in ${draft.institutionId}`;
  if (draft.type === "submit-proposal") return `Open formal vote in ${draft.institutionId}`;
  if (draft.type === "vote") return `Vote ${String(draft.choice || "").toUpperCase()} in ${draft.institutionId}`;
  if (draft.type === "invite") return `Invite ${draft.polity} to ${draft.institutionId}`;
  return "Institution action";
};
