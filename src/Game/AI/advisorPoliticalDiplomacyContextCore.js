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
    if (proposal.playerCanCallVote || proposal.playerCanSubmitForVote) flags.push("may call vote");
    if (proposal.playerCanAmend) flags.push("may amend");
    const amendmentReview = list(proposal?.amendmentItems).filter((item) => item?.playerCanResolve).length;
    if (amendmentReview) flags.push(`${amendmentReview} amendment review${amendmentReview === 1 ? "" : "s"} pending`);
    return `  - [${proposal.id}] ${proposal.title} — ${proposal.status}${flags.length ? ` | ${flags.join("; ")}` : ""}`;
  });
  return rows;
};

// What the advisor may and may not do with the options below. Sent whole,
// ahead of the lists, whatever they hold.
const AUTHORITY_BOUNDARY = Object.freeze([
  "Advisor authority boundary:",
  "- You may recommend, explain, compare, draft language and point out pending institutional obligations.",
  "- You may NOT silently cast the player's vote, accept an amendment, found/join/leave an institution, accept an invitation, sign an agreement, or infer sovereign authorization from PWv2. Those remain explicit player/native actions.",
  "- When you recommend a concrete formal institution step the player can legally take now, normally prepare the typed institution-action draft in the same reply so the player gets a confirmation button. Do not stop at a generic 'formal execution remains your prerogative'. Phrase it as a recommendation/offer, and never claim the act occurred until the player confirms it.",
  "- For membership, follow the charter's actual lifecycle. If the legal next step is an invitation whose acceptance later triggers an approval ballot, offer the invitation; do not fabricate an immediate accession vote just because it sounds more formal.",
  "- You MAY explain pending invitations/applications, charter accession/withdrawal rules, likely consequences, and where the player can exercise the corresponding explicit lifecycle control in the Institutions workspace.",
  "- When the player asks what is possible, distinguish ordinary diplomatic speech from formal institutional acts and identify any pending player decision clearly.",
]);

// The least the lists get, however long the rules grow.
const ADVISOR_DIPLOMACY_MIN_LIST_CHARS = 1500;

const linesSize = (lines) => lines.reduce((sum, line) => sum + line.length + 1, 0);

// One list inside `budget` characters, cut a whole row at a time: each row in
// full while it fits (at most `maxFull`), then each remaining row's one-line
// short form while that fits, then one line counting the rest. `total` counts
// the rows the caller never passed as well (the builder caps them). The count
// line is always given room, so nothing leaves the brief unsaid.
const fitRows = (rows, { budget, maxFull, total, omitted }) => {
  const out = [];
  const reserve = omitted(total).length + 1;
  let used = 0;
  let index = 0;
  for (; index < rows.length && index < maxFull; index += 1) {
    const cost = linesSize(rows[index].full);
    if (used + cost + reserve > budget) break;
    out.push(...rows[index].full);
    used += cost;
  }
  for (; index < rows.length; index += 1) {
    const cost = rows[index].short.length + 1;
    if (used + cost + reserve > budget) break;
    out.push(rows[index].short);
    used += cost;
  }
  if (total > index) out.push(omitted(total - index));
  return out;
};

const institutionRow = (entry) => {
  const institution = entry?.institution || {};
  const member = entry?.member || {};
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
  const full = [`- ${institution.name || institution.id} [${institution.id}] — ${clean(institution.kind) || "other"} / ${clean(institution.status) || "active"} — ${member.status || "member"}${member.role && member.role !== "member" ? ` / ${member.role}` : ""}${options.length ? ` | ${options.join("; ")}` : ""}`];
  if (members.length) full.push(`  members: ${members.join(", ")}`);
  if (voting && typeof voting === "string") full.push(`  decision rule: ${clean(voting)}`);
  if (lifecycleBits.length) full.push(`  ${lifecycleBits.join(" | ")}`);
  full.push(...proposalSummary(entry));
  return {
    full,
    short: `- ${institution.name || institution.id} [${institution.id}] — ${member.status || "member"}${entry.playerPendingBallotCount ? " | vote pending" : ""}`,
  };
};

const lifecycleRow = (entry) => {
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
  const head = `- ${institution.name || institution.id} [${institution.id}] — ${lifecycleCase.kind || "lifecycle"} / ${lifecycleCase.status || "pending"}${lifecycleCase.requestedStatus ? ` | requested ${lifecycleCase.requestedStatus}` : ""}`;
  return {
    full: [`${head}${lifecycleCase.effectiveDate ? ` | effective ${lifecycleCase.effectiveDate}` : ""}${fit ? ` | ${fit}` : ""}${lifecycleCase.reason ? ` | case=${lifecycleCase.reason}` : ""}`],
    short: head,
  };
};

const threadRow = (thread) => {
  const type = clean(thread?.type).toUpperCase().replace(/-/g, " ");
  const ids = [
    clean(thread?.institutionId) ? `institution=${clean(thread.institutionId)}` : "",
    list(thread?.lifecycleCaseIds).length ? `cases=${list(thread.lifecycleCaseIds).join(",")}` : "",
    clean(thread?.id) ? `thread=${clean(thread.id)}` : "",
  ].filter(Boolean).join(" | ");
  const head = `- ${type}${ids ? ` [${ids}]` : ""} | participants: ${list(thread?.participants).join(", ") || "—"}`;
  const full = [`${head}${clean(thread?.title) ? ` | title: ${clean(thread.title)}` : ""}`];
  if (clean(thread?.latestText)) full.push(`  latest ${clean(thread?.latestSpeaker) || "message"}: ${clean(thread.latestText)}`);
  return { full, short: head };
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
  // How many there are in all, when the caller passed only the first few.
  institutionLifecycleCaseCount = 0,
  threadCount = 0,
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

  // The rules are laid down before the lists and are never cut. The whole
  // brief used to be sliced to its cap after the lists, so a busy campaign (a
  // dozen threads, a few institutions) lost the rule against casting the
  // player's vote, and with four institutions the whole section: exactly the
  // campaigns where the advisor drafts votes and invitations. Only the lists
  // are budgeted, a whole row at a time (fitRows).
  lines.push(...AUTHORITY_BOUNDARY);
  const listBudget = Math.max(ADVISOR_DIPLOMACY_MIN_LIST_CHARS, ADVISOR_DIPLOMACY_OPTIONS_MAX_CHARS - linesSize(lines));
  let remaining = listBudget;

  if (!views.length) {
    lines.push("Formal institutions: the player currently has no tracked institutional memberships.");
    remaining -= linesSize(lines.slice(-1));
  } else {
    const heading = "Formal institutions:";
    const fitted = fitRows(views.map(institutionRow), {
      budget: Math.floor(listBudget * 0.5) - heading.length - 1,
      maxFull: 12,
      total: views.length,
      omitted: (count) => (count === 1
        ? "- 1 more membership omitted from this brief."
        : `- ${count} more memberships omitted from this brief.`),
    });
    lines.push(heading, ...fitted);
    remaining -= linesSize([heading, ...fitted]);
  }

  const lifecycleTotal = Math.max(lifecycleCases.length, Number(institutionLifecycleCaseCount) || 0);
  if (lifecycleTotal) {
    const heading = "Pending institution lifecycle:";
    const fitted = fitRows(lifecycleCases.map(lifecycleRow), {
      budget: Math.floor(remaining * 0.4) - heading.length - 1,
      maxFull: 12,
      total: lifecycleTotal,
      omitted: (count) => (count === 1
        ? "- 1 more pending lifecycle case omitted from this brief."
        : `- ${count} more pending lifecycle cases omitted from this brief.`),
    });
    lines.push(heading, ...fitted);
    remaining -= linesSize([heading, ...fitted]);
  } else {
    lines.push("Pending institution lifecycle: none.");
  }

  const threads = list(threadContexts);
  const threadTotal = Math.max(threads.length, Number(threadCount) || 0);
  lines.push("Diplomatic thread identity:");
  if (!threadTotal) {
    lines.push("- no recent visible diplomatic threads");
  } else {
    lines.push(...fitRows(threads.map(threadRow), {
      budget: remaining - "Diplomatic thread identity:".length - 1,
      maxFull: 12,
      total: threadTotal,
      omitted: (count) => (count === 1
        ? "- 1 more diplomatic thread omitted from this brief."
        : `- ${count} more diplomatic threads omitted from this brief.`),
    }));
  }

  const diplomacyText = lines.join("\n").trim();
  const text = [politicalText, diplomacyText].filter(Boolean).join("\n\n");
  return { text, politicalText, diplomacyText, institutionIds, politicalContext: political };
};
