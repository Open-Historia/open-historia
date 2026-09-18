/*! Open Historia Continuum — pure Advisor PWv2 + Diplomacy V2 prompt projection. */

export const ADVISOR_POLITICAL_DECISION_MAX_CHARS = 4200;
export const ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS = 4600;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => Array.isArray(value) ? value : [];

export const ADVISOR_POLITICAL_LIMITS = Object.freeze({
  traits: 8,
  goals: 6,
  fears: 6,
  ambitions: 6,
  domesticPressures: 6,
  pressureIssues: 6,
  governingEntities: 4,
  oppositionEntities: 4,
  perceptions: 5,
  relations: 6,
  agreements: 6,
  wars: 4,
  institutions: 12,
});

const proposalSummary = (view) => {
  const rows = list(view?.activeProposals).slice(0, 5).map((proposal) => {
    const flags = [];
    if (proposal.status === "voting" && proposal.playerEligible && !proposal.playerBallot) flags.push("PLAYER VOTE PENDING");
    if (proposal.playerCanVeto) flags.push("veto available");
    if (proposal.playerCanSubmitForVote) flags.push("may submit for vote");
    if (proposal.playerCanAmend) flags.push("may amend");
    const amendmentReview = list(proposal?.amendmentItems).filter((item) => item?.playerCanResolve).length;
    if (amendmentReview) flags.push(`${amendmentReview} amendment review${amendmentReview === 1 ? "" : "s"} pending`);
    return `  - [${proposal.id}] ${proposal.title} — ${proposal.status}${flags.length ? ` | ${flags.join("; ")}` : ""}`;
  });
  return rows;
};

/**
 * Pure formatter for the Advisor's private-government briefing and current
 * institution affordances. The caller owns retrieval of the bounded PWv2
 * projection and canonical institutional views.
 */
export const formatAdvisorPoliticalDiplomacyContext = ({
  playerPolity = "",
  politicalContext = null,
  institutionViews = [],
} = {}) => {
  const polity = clean(playerPolity);
  if (!polity) return { text: "", politicalText: "", diplomacyText: "", institutionIds: [], politicalContext: null };

  const political = politicalContext && typeof politicalContext === "object" ? politicalContext : null;
  const politicalText = political?.text
    ? [
      "[Private Government & Political Briefing — Advisor only]",
      "This is the human player's own canonical Political Actor/PWv2 state. Use it to understand the government's real internal constraints, governing coalition, opposition, goals, fears, ambitions, leadership tendencies, pressure and current behavioral disposition when giving advice.",
      "You are internal counsel, so this private state may inform your advice. Do not treat it as a new player order, do not convert preferences into sovereign consent, and do not claim that the government has taken an action merely because its PWv2 makes that action plausible.",
      "Foreign Political Actor private state is NOT provided here. Do not invent hidden foreign motives beyond public/intelligence evidence available elsewhere in the campaign.",
      political.text,
    ].join("\n")
    : [
      "[Private Government & Political Briefing — Advisor only]",
      `No canonical Political Actor/PWv2 record is available for ${polity}. Do not invent one.`,
    ].join("\n");

  const views = list(institutionViews);
  const institutionIds = views.map((entry) => clean(entry?.institution?.id)).filter(Boolean);
  const lines = [
    "[Current Diplomatic & Institutional Options — canonical UI/legal affordances]",
    "Use this to tell the player what diplomatic levers actually exist right now. Conversation is not a vote, membership is not consent, and you must never cast a formal ballot or table binding business on the player's behalf merely because you recommend it.",
    "You may draft ordinary bilateral messages for the player as before. For formal institutions, explain the available action and direct the player to the institution workspace when a legal click/choice is required.",
  ];

  if (!views.length) {
    lines.push("Formal institutions: the player currently has no tracked institutional memberships.");
  } else {
    lines.push("Formal institutions:");
    for (const entry of views.slice(0, 12)) {
      const institution = entry.institution || {};
      const member = entry.member || {};
      const options = [];
      if (entry.canParticipate) options.push("Council access");
      if (entry.canTableProposal) options.push("may table a resolution");
      if (entry.playerPendingBallotCount) options.push(`${entry.playerPendingBallotCount} player ballot${entry.playerPendingBallotCount === 1 ? "" : "s"} pending`);
      if (entry.playerPendingAmendmentReviewCount) options.push(`${entry.playerPendingAmendmentReviewCount} amendment review${entry.playerPendingAmendmentReviewCount === 1 ? "" : "s"} pending`);
      lines.push(`- ${institution.name || institution.id} [${institution.id}] — ${member.status || "member"}${member.role && member.role !== "member" ? ` / ${member.role}` : ""}${options.length ? ` | ${options.join("; ")}` : ""}`);
      for (const proposal of proposalSummary(entry)) lines.push(proposal);
    }
    if (views.length > 12) lines.push(`- ${views.length - 12} additional membership(s) omitted from the inline brief; use institution lookups when needed.`);
  }

  lines.push(
    "Advisor authority boundary:",
    "- You may recommend, explain, compare, draft language and point out pending institutional obligations.",
    "- You may NOT silently cast the player's vote, accept an amendment, table a formal resolution, join/leave an institution, sign an agreement, or infer sovereign authorization from PWv2. Those remain explicit player/native actions.",
    "- When the player asks what is possible, distinguish ordinary diplomatic speech from formal institutional acts and identify any pending player decision clearly.",
  );

  const diplomacyText = lines.join("\n").slice(0, ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS).trim();
  const text = [politicalText, diplomacyText].filter(Boolean).join("\n\n");
  return { text, politicalText, diplomacyText, institutionIds, politicalContext: political };
};
