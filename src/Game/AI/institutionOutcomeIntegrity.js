/*! Open Historia - institution ledger is the authority for formal proposal outcomes. */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();
const list = (value) => Array.isArray(value) ? value : [];

const TERMINAL_ACT_RE = /\b(?:formally\s+)?(?:adopts?|adopted|approves?|approved|passes?|passed|ratifies?|ratified|rejects?|rejected|vetoes?|vetoed)\b/i;
const NON_TERMINAL_CONTEXT_RE = /\b(?:would|could|should|may|might|will|plans?\s+to|seeks?\s+to|calls?\s+for|supports?\s+(?:the\s+)?(?:adoption|approval|passage|ratification|rejection)|urges?\s+(?:the\s+)?(?:adoption|approval|passage|ratification|rejection))\b/i;
const GENERIC_PROPOSAL_TOKENS = new Set([
  "a", "an", "and", "the", "for", "of", "on", "to", "in", "with", "by",
  "proposal", "resolution", "framework", "motion", "measure", "initiative", "program", "programme",
]);

const significantProposalTokens = (proposal, institution) => {
  const institutionTokens = new Set(fold(`${institution?.name || ""} ${institution?.shortName || ""}`).split(" ").filter(Boolean));
  return fold(proposal?.title)
    .split(" ")
    .filter((token) => token.length > 2 && !GENERIC_PROPOSAL_TOKENS.has(token) && !institutionTokens.has(token));
};

const mentionsInstitution = (text, institution) => {
  const haystack = fold(text);
  return [institution?.name, institution?.shortName, institution?.id]
    .map(fold)
    .filter((token) => token.length >= 2)
    .some((token) => haystack.includes(token));
};

const mentionsProposal = (text, proposal, institution) => {
  const haystack = fold(text);
  const exact = fold(proposal?.title);
  if (exact && exact.length >= 8 && haystack.includes(exact)) return true;
  const proposalId = fold(proposal?.id);
  if (proposalId && proposalId.length >= 6 && haystack.includes(proposalId)) return true;
  const tokens = significantProposalTokens(proposal, institution);
  return tokens.length >= 3 && tokens.every((token) => haystack.includes(token));
};

const eventClaimsTerminalInstitutionOutcome = (event, institution, proposal) => {
  const text = `${clean(event?.title)} ${clean(event?.description)}`.trim();
  if (!text || !TERMINAL_ACT_RE.test(text)) return false;
  if (NON_TERMINAL_CONTEXT_RE.test(text)) return false;
  if (!mentionsInstitution(text, institution)) return false;
  return mentionsProposal(text, proposal, institution);
};

export const generatedInstitutionOutcomeIntegrityIssue = (candidate, world = {}) => {
  const institutions = world?.institutions?.byId && typeof world.institutions.byId === "object"
    ? Object.values(world.institutions.byId)
    : [];
  if (!institutions.length) return "";

  for (const event of list(candidate?.events)) {
    for (const institution of institutions) {
      if (!institution || String(institution.status || "active").toLocaleLowerCase() === "dissolved") continue;
      const proposals = institution?.proposals && typeof institution.proposals === "object"
        ? Object.values(institution.proposals)
        : [];
      for (const proposal of proposals) {
        if (!proposal || !eventClaimsTerminalInstitutionOutcome(event, institution, proposal)) continue;
        const nativeStatus = clean(proposal.status || "draft").toLocaleLowerCase();
        return `Generated event "${clean(event?.title) || "untitled"}" claims a formal outcome for ${institution.name || institution.id} proposal "${proposal.title || proposal.id}", but formal institution outcomes are owned by the native institution ledger (current proposal status: ${nativeStatus || "unknown"}). Do not narrate adoption, approval, passage, ratification, rejection or veto of an existing canonical proposal in an ordinary world event. Let the native institutional ballot close first; its governance path writes the canonical decision/timeline outcome itself.`;
      }
    }
  }
  return "";
};
