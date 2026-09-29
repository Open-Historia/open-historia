/*! Open Historia Continuum — a formal vote on an institution with no voting rule. */
// An institution from a save made before institution governance existed, or
// one a scenario authored without a charter rule, cannot open a ballot:
// openInstitutionProposalVoting refuses with VOTING_RULE_UNSPECIFIED. Every
// path that opens one (the player's submit in the Institutions workspace and
// the advisor's draft, an AI sponsor's institution_submit_proposal) goes
// through commitWithVotingRuleBackfill: on that refusal it asks the governance
// resolver once (institutionGovernanceBackfill.js, one request) and runs the
// whole commit again, which reads the world afresh. It asks at most once per
// campaign and institution in a session, and never while a turn is being
// written; otherwise the player reads a sentence they can act on.

import { INSTITUTION_GOVERNANCE_ERROR_CODES } from "../../runtime/institutionalGovernance.js";
import { isSimulationBusy } from "./simulationStatus.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const GOVERNANCE_BACKFILL_STALE = "institution-governance-backfill-stale";

export const isVotingRuleUnspecified =(error) => error?.code === INSTITUTION_GOVERNANCE_ERROR_CODES.VOTING_RULE_UNSPECIFIED;

// Player-visible: shown where the vote was asked for.
export const votingRuleMissingMessage = (name) => `${clean(name) || "This institution"} has no voting rule in its charter, so it cannot hold a formal vote yet. Its members can still debate the proposal.`;

const ruleError = (message) => Object.assign(new Error(message), { code: INSTITUTION_GOVERNANCE_ERROR_CODES.VOTING_RULE_UNSPECIFIED });

export const createVotingRuleRetry = ({ backfill, busy = () => false, attempted = new Set() } = {}) => async (commit, {
  institutionId = "", proposalId = "", expectedGameId = "",
} = {}) => {
  try {
    return await commit();
  } catch (error) {
    if (!isVotingRuleUnspecified(error)) throw error;
    const name = clean(error?.institutionName) || clean(institutionId);
    const key = `${clean(expectedGameId)}|${clean(institutionId).toLocaleLowerCase()}`;
    if (attempted.has(key)) throw ruleError(votingRuleMissingMessage(name));
    if (busy()) throw ruleError("The world is still updating. Ask for the vote again in a moment.");
    attempted.add(key);
    try {
      await backfill({ institutionId, proposalId, expectedGameId });
    } catch (backfillError) {
      // The campaign moved on while the resolver answered: nothing was kept,
      // so a later vote may ask again.
      if (backfillError?.code === GOVERNANCE_BACKFILL_STALE) attempted.delete(key);
      throw backfillError;
    }
    try {
      return await commit();
    } catch (retryError) {
      if (isVotingRuleUnspecified(retryError)) throw ruleError(votingRuleMissingMessage(name));
      throw retryError;
    }
  }
};

export const commitWithVotingRuleBackfill = createVotingRuleRetry({
  backfill: async (options) => (await import("./institutionGovernanceBackfill.js")).ensureLegacyInstitutionGovernanceForBallot(options),
  busy: isSimulationBusy,
});
