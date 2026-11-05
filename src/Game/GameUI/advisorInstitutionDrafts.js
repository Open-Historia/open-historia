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

// The most buttons one reply offers.
const MAX_DRAFTS = 8;

// `problems`, when given, collects a sentence for every entry that got no
// button, for the advisor's receipt (advisorBlocks.js describeReplyProblems).
export const buildInstitutionDrafts = (raw, problems = []) => {
  if (!Array.isArray(raw)) return [];
  const drafts = raw.map((entry, index) => {
    const drop = (why) => {
      problems.push(`entry ${index + 1} ${why}, so no button was drawn for it`);
      return null;
    };
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return drop("was not an object");
    const type = lower(entry.type).replace(/[\s_]+/g, "-");
    const institutionId = clean(entry.institutionId);
    if (!TYPES.has(type)) return drop(`had the type "${clean(entry.type)}", which is not one of ${[...TYPES].join(", ")}`);
    if (!institutionId) return drop("named no institutionId");

    if (type === "table-proposal") {
      const title = clean(entry.title).slice(0, 160);
      if (!title) return drop("had no title");
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
      return proposalId ? { type, institutionId, proposalId } : drop("named no proposalId");
    }

    if (type === "vote") {
      const proposalId = clean(entry.proposalId);
      const choice = lower(entry.choice);
      if (!proposalId) return drop("named no proposalId");
      if (!VOTE_CHOICES.has(choice)) return drop(`had the choice "${choice}", which is not one of ${[...VOTE_CHOICES].join(", ")}`);
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
    if (!polity) return drop("named no polity");
    if (!MEMBER_STATUSES.has(requestedStatus)) return drop(`had the requestedStatus "${requestedStatus}", which is not one of ${[...MEMBER_STATUSES].join(", ")}`);
    return {
      type,
      institutionId,
      polity,
      requestedStatus,
      reason: clean(entry.reason).slice(0, 1200),
    };
  }).filter(Boolean);
  if (drafts.length > MAX_DRAFTS) {
    const extra = drafts.length - MAX_DRAFTS;
    problems.push(extra === 1
      ? `only the first ${MAX_DRAFTS} usable entries get a button; 1 more was left out`
      : `only the first ${MAX_DRAFTS} usable entries get a button; ${extra} more were left out`);
  }
  return drafts.slice(0, MAX_DRAFTS);
};

export const institutionDraftButtonLabel = (draft = {}) => {
  if (draft.type === "table-proposal") return `Table proposal in ${draft.institutionId}`;
  if (draft.type === "submit-proposal") return `Open formal vote in ${draft.institutionId}`;
  if (draft.type === "vote") return `Vote ${String(draft.choice || "").toUpperCase()} in ${draft.institutionId}`;
  if (draft.type === "invite") return `Invite ${draft.polity} to ${draft.institutionId}`;
  return "Institution action";
};
