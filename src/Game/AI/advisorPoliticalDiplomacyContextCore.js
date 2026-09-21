/*! Open Historia Continuum — pure Advisor PWv2 + Diplomacy V2 prompt projection. */

export const ADVISOR_POLITICAL_DECISION_MAX_CHARS = 4200;
export const ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS = 7600;

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
  institutionLifecycleCases = [],
  threadContexts = [],
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
  const lifecycleCases = list(institutionLifecycleCases);
  const institutionIds = [...new Set([
    ...views.map((entry) => clean(entry?.institution?.id)),
    ...lifecycleCases.map((entry) => clean(entry?.institution?.id)),
  ].filter(Boolean))];
  const lines = [
    "[Current Diplomatic & Institutional Options — canonical UI/legal affordances]",
    "INSTITUTION CAPABILITY MANIFEST: Institutions are first-class canonical game objects. The player can found custom institutions with structured identity/charter fields including name, short name, type, purpose, political character, geographic scope, threat/adversary model, decision rule, minimum founding members, accession, observer, withdrawal, expulsion and dissolution rules. Institutions have persistent Council channels, formal agenda/proposals, ballots, amendments, decisions/history, documents and lifecycle cases. NEVER tell the player that custom institutions are only simulated through treaties/projects/bilateral narrative.",
    "Use this to tell the player what diplomatic levers actually exist right now. Conversation is not a vote, membership is not consent, and you must never cast a formal ballot or table binding business on the player's behalf merely because you recommend it. You MAY prepare a formal institution action draft for explicit player confirmation when the canonical affordance exists.",
    "Distinguish PRIVATE BILATERAL threads, INSTITUTION COUNCIL threads and INSTITUTION LIFECYCLE/accession hearings. A message in one thread is not automatically known or addressed in another.",
    "You may draft bilateral or institutional messages for the player. Every draft must identify its exact destination type and canonical target; never rely on whichever chat happened to be opened most recently.",
    "You may also prepare a formal institution-action draft (proposal, submit-for-vote, ballot, or membership invitation) when the current canonical state makes that exact step available. A draft is not execution: the player must explicitly confirm it in the Advisor UI, and native governance validates it again.",
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
      if (entry.canParticipate && clean(institution?.charter?.lifecycle?.accession?.mode || "approval") !== "not-permitted") options.push("may invite eligible governments");
      if (entry.playerPendingBallotCount) options.push(`${entry.playerPendingBallotCount} player ballot${entry.playerPendingBallotCount === 1 ? "" : "s"} pending`);
      if (entry.playerPendingAmendmentReviewCount) options.push(`${entry.playerPendingAmendmentReviewCount} amendment review${entry.playerPendingAmendmentReviewCount === 1 ? "" : "s"} pending`);
      const lifecycle = institution?.charter?.lifecycle || {};
      const identity = lifecycle?.identity || {};
      const lifecycleBits = [
        list(lifecycle.purpose).length ? `purpose: ${list(lifecycle.purpose).slice(0, 3).join("; ")}` : "",
        clean(identity.politicalCharacter) ? `character: ${clean(identity.politicalCharacter).slice(0, 180)}` : "",
        list(identity.geographicScope).length ? `scope: ${list(identity.geographicScope).slice(0, 3).join(", ")}` : "",
        clean(institution?.charter?.note) ? `charter/obligations: ${clean(institution.charter.note).slice(0, 220)}` : "",
        lifecycle?.withdrawal?.mode ? `withdrawal: ${lifecycle.withdrawal.mode}${Number(lifecycle.withdrawal.noticeDays) > 0 ? ` (${lifecycle.withdrawal.noticeDays}d notice)` : ""}` : "",
      ].filter(Boolean);
      const members = list(institution?.members).slice(0, 16).map((item) => `${clean(item?.polity)} (${clean(item?.status || "member")}${clean(item?.role) && clean(item.role) !== "member" ? `/${clean(item.role)}` : ""})`).filter(Boolean);
      const voting = institution?.charter?.decisionRule || institution?.charter?.votingRule || institution?.charter?.governance?.decisionRule || "";
      lines.push(`- ${institution.name || institution.id} [${institution.id}] — ${clean(institution.kind) || "other"} / ${clean(institution.status) || "active"} — ${member.status || "member"}${member.role && member.role !== "member" ? ` / ${member.role}` : ""}${options.length ? ` | ${options.join("; ")}` : ""}`);
      if (members.length) lines.push(`  members: ${members.join(", ")}`);
      if (voting && typeof voting === "string") lines.push(`  decision rule: ${clean(voting)}`);
      if (lifecycleBits.length) lines.push(`  ${lifecycleBits.join(" | ")}`);
      for (const proposal of proposalSummary(entry)) lines.push(proposal);
    }
    if (views.length > 12) lines.push(`- ${views.length - 12} additional membership(s) omitted from the inline brief; use institution lookups when needed.`);
  }

  if (lifecycleCases.length) {
    lines.push("Pending institution lifecycle:");
    for (const entry of lifecycleCases.slice(0, 12)) {
      const institution = entry?.institution || {};
      const lifecycleCase = entry?.case || {};
      const lifecycle = institution?.charter?.lifecycle || {};
      const identity = lifecycle?.identity || {};
      const fit = [
        list(lifecycle.purpose).length ? `purpose=${list(lifecycle.purpose).slice(0, 3).join("; ")}` : "",
        clean(identity.politicalCharacter) ? `character=${clean(identity.politicalCharacter).slice(0, 160)}` : "",
        list(identity.geographicScope).length ? `scope=${list(identity.geographicScope).slice(0, 3).join(", ")}` : "",
        list(identity.primaryThreatModel).length ? `threat model=${list(identity.primaryThreatModel).slice(0, 3).join(", ")}` : "",
        clean(institution?.charter?.note) ? `obligations=${clean(institution.charter.note).slice(0, 180)}` : "",
      ].filter(Boolean).join(" | ");
      lines.push(`- ${institution.name || institution.id} [${institution.id}] — ${lifecycleCase.kind || "lifecycle"} / ${lifecycleCase.status || "pending"}${lifecycleCase.requestedStatus ? ` | requested ${lifecycleCase.requestedStatus}` : ""}${lifecycleCase.effectiveDate ? ` | effective ${lifecycleCase.effectiveDate}` : ""}${fit ? ` | ${fit}` : ""}${lifecycleCase.reason ? ` | case=${lifecycleCase.reason}` : ""}`);
    }
  } else {
    lines.push("Pending institution lifecycle: none.");
  }

  const threads = list(threadContexts);
  lines.push("Diplomatic thread identity:");
  if (!threads.length) {
    lines.push("- no recent visible diplomatic threads");
  } else {
    for (const thread of threads.slice(0, 12)) {
      const type = clean(thread?.type).toUpperCase().replace(/-/g, " ");
      const ids = [
        clean(thread?.institutionId) ? `institution=${clean(thread.institutionId)}` : "",
        list(thread?.lifecycleCaseIds).length ? `cases=${list(thread.lifecycleCaseIds).join(",")}` : "",
        clean(thread?.id) ? `thread=${clean(thread.id)}` : "",
      ].filter(Boolean).join(" | ");
      lines.push(`- ${type}${ids ? ` [${ids}]` : ""} | participants: ${list(thread?.participants).join(", ") || "—"}${clean(thread?.title) ? ` | title: ${clean(thread.title)}` : ""}`);
      if (clean(thread?.latestText)) lines.push(`  latest ${clean(thread?.latestSpeaker) || "message"}: ${clean(thread.latestText)}`);
    }
  }

  lines.push(
    "Advisor authority boundary:",
    "- You may recommend, explain, compare, draft language and point out pending institutional obligations.",
    "- You may NOT silently cast the player's vote, accept an amendment, found/join/leave an institution, accept an invitation, sign an agreement, or infer sovereign authorization from PWv2. Those remain explicit player/native actions.",
    "- When you recommend a concrete formal institution step the player can legally take now, normally prepare the typed institution-action draft in the same reply so the player gets a confirmation button. Do not stop at a generic 'formal execution remains your prerogative'. Phrase it as a recommendation/offer, and never claim the act occurred until the player confirms it.",
    "- For membership, follow the charter's actual lifecycle. If the legal next step is an invitation whose acceptance later triggers an approval ballot, offer the invitation; do not fabricate an immediate accession vote just because it sounds more formal.",
    "- You MAY explain pending invitations/applications, charter accession/withdrawal rules, likely consequences, and where the player can exercise the corresponding explicit lifecycle control in the Institutions workspace.",
    "- When the player asks what is possible, distinguish ordinary diplomatic speech from formal institutional acts and identify any pending player decision clearly.",
  );

  const diplomacyText = lines.join("\n").slice(0, ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS).trim();
  const text = [politicalText, diplomacyText].filter(Boolean).join("\n\n");
  return { text, politicalText, diplomacyText, institutionIds, politicalContext: political };
};
