/*! Open Historia Continuum — advisor bridge into PWv2 + canonical Diplomacy V2. */

import { buildPoliticalDecisionContext } from "./politicalDecisionContext.js";
import { institutionsForPolity } from "../../runtime/institutions.js";
import { institutionLifecycleCasesForPolity } from "../../runtime/institutionLifecycleCore.js";
import {
  ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS,
  ADVISOR_POLITICAL_DECISION_MAX_CHARS,
  ADVISOR_POLITICAL_LIMITS,
  formatAdvisorPoliticalDiplomacyContext,
} from "./advisorPoliticalDiplomacyContextCore.js";

export {
  ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS,
  ADVISOR_POLITICAL_DECISION_MAX_CHARS,
  ADVISOR_POLITICAL_LIMITS,
  formatAdvisorPoliticalDiplomacyContext,
};

/**
 * Internal counsel context for the human polity.
 *
 * The player's own Political Actor is intentionally visible here: this is the
 * player's chief advisor, not a foreign principal. Foreign hidden PWv2 remains
 * private; the advisor sees only public/intelligence projections elsewhere.
 * This projection is read-only and never creates sovereign consent.
 */
export const buildAdvisorPoliticalDiplomacyContext = ({ world = {}, playerPolity = "" } = {}) => {
  const polity = String(playerPolity ?? "").replace(/\s+/g, " ").trim();
  if (!polity) return formatAdvisorPoliticalDiplomacyContext({ playerPolity: "" });

  const politicalContext = buildPoliticalDecisionContext(world, polity, {
    maxChars: ADVISOR_POLITICAL_DECISION_MAX_CHARS,
    limits: ADVISOR_POLITICAL_LIMITS,
  });
  // CP28 host integration deliberately projects only canonical membership here.
  // Latest Beta's one-request group-chat/poll stack is the host for formal
  // institution business; the older Continuum governance/chat executor is not
  // imported merely to make the Advisor aware that an institution exists.
  const institutionViews = institutionsForPolity(world, polity, { includeSuspended: true, includeDissolved: true })
    .map(({ institution, member }) => ({
      institution,
      member,
      canParticipate: String(member?.status || "member").toLowerCase() !== "suspended",
      canTableProposal: false,
      activeProposals: [],
      openBallots: [],
      playerPendingBallotCount: 0,
      playerPendingAmendmentReviewCount: 0,
    }));

  const institutionLifecycleCases = institutionLifecycleCasesForPolity(world, polity, { pendingOnly: true })
    .slice(0, 12);

  return formatAdvisorPoliticalDiplomacyContext({
    playerPolity: polity,
    politicalContext,
    institutionViews,
    institutionLifecycleCases,
  });
};
