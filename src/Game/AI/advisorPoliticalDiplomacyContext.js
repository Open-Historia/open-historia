/*! Open Historia Continuum — advisor bridge into PWv2 + canonical Diplomacy V2. */

import { buildPoliticalDecisionContext } from "./politicalDecisionContext.js";
import { institutionsForPolity } from "../../runtime/institutions.js";
import { buildInstitutionDiplomacyView } from "../../runtime/institutionalDiplomacyView.js";
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
export const buildAdvisorPoliticalDiplomacyContext = ({ world = {}, playerPolity = "", chats = [] } = {}) => {
  const polity = String(playerPolity ?? "").replace(/\s+/g, " ").trim();
  if (!polity) return formatAdvisorPoliticalDiplomacyContext({ playerPolity: "" });

  const politicalContext = buildPoliticalDecisionContext(world, polity, {
    maxChars: ADVISOR_POLITICAL_DECISION_MAX_CHARS,
    limits: ADVISOR_POLITICAL_LIMITS,
  });
  // Institutions are first-class canonical state. Project the same structured
  // diplomacy view the UI uses so the Advisor knows the institution's identity,
  // charter, members, agenda and pending legal affordances instead of falling
  // back to the old "treaty + project" mental model.
  const institutionViews = institutionsForPolity(world, polity, { includeSuspended: true, includeDissolved: true })
    .map(({ institution, member }) => {
      try {
        return buildInstitutionDiplomacyView({
          world,
          institutionId: institution.id,
          playerCountry: polity,
        });
      } catch {
        return {
          institution,
          member,
          canParticipate: String(member?.status || "member").toLowerCase() !== "suspended",
          canTableProposal: false,
          activeProposals: [],
          openBallots: [],
          playerPendingBallotCount: 0,
          playerPendingAmendmentReviewCount: 0,
        };
      }
    });

  const institutionLifecycleCases = institutionLifecycleCasesForPolity(world, polity, { pendingOnly: true })
    .slice(0, 12);

  const threadContexts = (Array.isArray(chats) ? chats : []).slice(0, 18).map((chat) => {
    const lifecycle = Boolean(chat?.lifecycleInstitutionId && Array.isArray(chat?.lifecycleCaseIds) && chat.lifecycleCaseIds.length);
    const council = Boolean(chat?.institutionId && !lifecycle);
    const participants = (Array.isArray(chat?.countries) ? chat.countries : [])
      .map((entry) => String(entry?.name || entry?.code || entry || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const last = [...messages].reverse().find((message) => String(message?.text || "").trim()) || null;
    return {
      id: String(chat?.id || "").trim(),
      type: lifecycle ? "institution-lifecycle" : council ? "institution-council" : (participants.length <= 1 ? "private-bilateral" : "group-diplomacy"),
      institutionId: String(chat?.lifecycleInstitutionId || chat?.institutionId || "").trim(),
      lifecycleCaseIds: lifecycle ? chat.lifecycleCaseIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
      title: String(chat?.title || "").replace(/\s+/g, " ").trim(),
      participants,
      latestSpeaker: String(last?.speaker || "").replace(/\s+/g, " ").trim(),
      latestText: String(last?.text || "").replace(/\s+/g, " ").trim().slice(0, 280),
    };
  }).filter((entry) => entry.id && (entry.participants.length || entry.institutionId));


  return formatAdvisorPoliticalDiplomacyContext({
    playerPolity: polity,
    politicalContext,
    institutionViews,
    institutionLifecycleCases,
    threadContexts,
  });
};
