const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const splitList = (value) => [...new Set(String(value ?? "").split(/[\n,;]+/).map(clean).filter(Boolean))];
const humanize = (value) => clean(value).replace(/[-_]+/g, " ");
const capitalizeWords = (text) => String(text ?? "").replace(/(^|\s)(\S)/g, (_match, space, letter) => space + letter.toUpperCase());

const MEMBER_STATUS_LABELS = { member: "Member", observer: "Observer", participant: "Participant", associate: "Associate", candidate: "Candidate" };
const INVITABLE_LOWER_STATUSES = ["observer", "participant", "associate"];

const membershipLabel = (member = {}) => {
  const status = lower(member?.status || "member");
  if (status && status !== "member") return humanize(status);
  const role = lower(member?.role || "member");
  return humanize(role || "member");
};

const sortRows = (rows) => [...rows].sort((a, b) => (
  Number(b.playerPendingBallotCount || 0) - Number(a.playerPendingBallotCount || 0)
  || Number(b.playerPendingAmendmentReviewCount || 0) - Number(a.playerPendingAmendmentReviewCount || 0)
  || Number(b.openBallotCount || 0) - Number(a.openBallotCount || 0)
  || Number(b.activeProposalCount || 0) - Number(a.activeProposalCount || 0)
  || clean(a.institution?.name || a.institution?.id).localeCompare(clean(b.institution?.name || b.institution?.id))
));

const documentTouchesInstitution = (report, institution) => {
  const members = new Set(list(institution?.members).map((entry) => lower(entry?.polity)).filter(Boolean));
  members.add(lower(institution?.name));
  members.add(lower(institution?.shortName));
  const names = [report?.from, ...(report?.visibleTo || []), ...Object.keys(report?.receivedFrom || {}), ...Object.values(report?.receivedFrom || {})].map(lower).filter(Boolean);
  return names.some((name) => members.has(name));
};

const emblemMark = (institution) => {
  const raw = clean(institution?.shortName || institution?.name || institution?.id || "IN");
  const mark = raw.length <= 6 ? raw.toUpperCase() : raw.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 5).toUpperCase();
  return mark || "IN";
};

const ballotTone = (choice) => {
  const key = lower(choice);
  if (key === "yes") return "good";
  if (key === "no" || key === "veto") return "bad";
  return "neutral";
};

export const register = ({ engine, emit, plain }) => {
  const found = new Map();
  const exported = (name, kind = "function") => {
    if (found.has(name)) return found.get(name);
    let hit = null;
    for (const value of Object.values(engine)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value[name];
      if (kind === "function" ? typeof candidate === "function" : candidate !== undefined) {
        hit = candidate;
        break;
      }
    }
    if (hit) found.set(name, hit);
    return hit;
  };
  const need = (space, fn) => {
    const target = engine[space]?.[fn] || exported(fn);
    if (typeof target !== "function") throw new Error(`The engine bundle does not export ${space}.${fn}.`);
    return target;
  };
  const views = () => ({
    list: need("institutionalDiplomacyView", "listInstitutionDiplomacyViews"),
    listAll: need("institutionalDiplomacyView", "listAllInstitutionDiplomacyViews"),
    member: need("institutionalDiplomacyView", "buildInstitutionDiplomacyView"),
    public: need("institutionalDiplomacyView", "buildPublicInstitutionDiplomacyView"),
  });
  const logoUrl = (institution) => {
    const resolve = exported("institutionLogoUrl");
    return typeof resolve === "function" ? clean(resolve(institution)) : "";
  };
  const readable = (reports, player) => need("reportDelivery", "documentsReadableBy")(reports, player);
  const polityKeys = (world, player) => {
    const collect = exported("collectActiveScenarioPolityKeys");
    return typeof collect === "function" ? collect(world).filter((name) => lower(name) !== lower(player)) : [];
  };
  const emblem = (institution) => ({ url: logoUrl(institution), mark: emblemMark(institution), title: clean(institution?.name || institution?.id || "Institution") });

  const expectedGameId = () => {
    need("simulationStatus", "assertNoTurnRunning")();
    return clean(engine.getLibraryState()?.activeGameId);
  };

  const readIdentity = async () => {
    const game = await engine.gameState.readGameData({ force: true });
    return { player: clean(game?.country), gameDate: clean(game?.gameDate) };
  };

  const readAll = async () => {
    const [world, chats, identity] = await Promise.all([
      engine.gameState.readWorldState({ force: true }),
      engine.gameState.readChatsState({ force: true }).catch(() => []),
      readIdentity(),
    ]);
    return { world: world || {}, chats: list(chats), ...identity };
  };

  const automation = new Map();
  const inFlight = new Set();
  let pendingChange = null;
  const changed = (reason) => {
    if (pendingChange) return;
    pendingChange = setTimeout(() => {
      pendingChange = null;
      emit("institutions.changed", { reason });
    }, 150);
  };
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("oh:runtime-json-updated", (event) => {
      const url = event?.detail?.url;
      if (url === engine.JSON_URLS.world || url === engine.JSON_URLS.chat) changed("write");
    });
    globalThis.addEventListener("oh:active-game-changed", () => changed("game"));
  }

  const rowsFor = (world, player) => {
    const v = views();
    const memberRows = sortRows(v.list(world, player));
    const allRows = v.listAll(world, player);
    const playerLifecycleCases = engine.institutionLifecycle.institutionLifecycleCasesForPolity(world, player, { pendingOnly: true });
    const pendingInstitutionIds = new Set(playerLifecycleCases.map((entry) => clean(entry?.institution?.id)).filter(Boolean));
    const personalRows = sortRows([
      ...memberRows,
      ...allRows.filter((row) => !row.member && pendingInstitutionIds.has(clean(row?.institution?.id))),
    ].filter((row, index, rows) => rows.findIndex((candidate) => clean(candidate?.institution?.id) === clean(row?.institution?.id)) === index));
    const pending = memberRows.reduce((sum, row) => sum + Number(row.playerPendingBallotCount || 0) + Number(row.playerPendingAmendmentReviewCount || 0), 0) + playerLifecycleCases.length;
    return { memberRows, allRows, personalRows, pending };
  };

  const channelMap = (chats) => new Map(list(chats)
    .filter((chat) => chat?.institutionId && !(chat?.lifecycleInstitutionId && list(chat?.lifecycleCaseIds).length))
    .map((chat) => [clean(chat.institutionId), chat]));

  const selectedFor = (world, player, selectedId) => {
    const { allRows } = rowsFor(world, player);
    const row = (selectedId ? allRows.find((entry) => clean(entry?.institution?.id) === clean(selectedId)) : null) || null;
    if (!row?.institution?.id) return { row: null, view: null, pendingLifecycle: [] };
    const v = views();
    const view = row.member
      ? v.member({ world, institutionId: row.institution.id, playerCountry: player })
      : v.public({ world, institutionId: row.institution.id, playerCountry: player });
    const cases = Object.values(view?.institution?.lifecycleCases || {});
    const lifecycleCases = row.member ? cases : cases.filter((entry) => lower(entry?.polity) === lower(player) || lower(entry?.initiatedBy) === lower(player));
    const pendingLifecycle = lifecycleCases.filter((entry) => ["pending", "negotiating", "pending-approval"].includes(lower(entry?.status)));
    return { row, view, pendingLifecycle };
  };

  const rowView = (row, channels) => {
    const institution = row.institution || {};
    const pending = Number(row.playerPendingBallotCount || 0) + Number(row.playerPendingAmendmentReviewCount || 0);
    return {
      id: clean(institution.id),
      name: clean(institution.name || institution.id),
      emblem: emblem(institution),
      pending: pending > 0 ? `${pending} action${pending === 1 ? "" : "s"}` : "",
      channelId: clean(channels.get(clean(institution.id))?.id),
      sub: `${row.member ? `${membershipLabel(row.member)} · ${row.canParticipate ? "participating" : "read-only"}` : "world institution · public overview"}${row.openBallotCount ? ` · ${row.openBallotCount} open ballot${row.openBallotCount === 1 ? "" : "s"}` : ""}`,
    };
  };

  const proposalView = (proposal, view) => {
    const needsVote = proposal.status === "voting" && proposal.playerEligible && !proposal.playerBallot;
    const statusTone = needsVote ? "live" : ["passed", "implementation"].includes(proposal.status) ? "good" : ["failed", "vetoed"].includes(proposal.status) ? "bad" : "neutral";
    const unresolved = Number(proposal.unresolvedAmendments || 0);
    return {
      id: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      status: proposal.status,
      statusTone,
      needsVote,
      meta: `${proposal.createdBy ? `Submitted by ${proposal.createdBy}` : "Formal matter"}${proposal.ruleLabel ? ` · ${proposal.ruleLabel}` : ""}${proposal.status === "voting" ? ` · ${proposal.ballotsRecorded}/${proposal.eligibleVoters} ballots` : ""}`,
      ballot: proposal.playerBallot ? `You voted ${proposal.playerBallot.choice}` : "",
      choices: needsVote ? ["yes", "no", "abstain", ...(proposal.playerCanVeto ? ["veto"] : [])] : [],
      canCallVote: Boolean(proposal.playerCanSubmitForVote && view?.canParticipate),
      blocked: unresolved > 0 && view?.canParticipate
        ? `Vote is waiting on ${unresolved} unresolved amendment${unresolved === 1 ? "" : "s"}. The proposal sponsor must accept or reject each amendment, or its proposer may withdraw it.`
        : "",
      amendments: list(proposal.amendmentItems).map((amendment) => ({
        id: amendment.id,
        text: amendment.text,
        status: amendment.status,
        tone: amendment.status === "accepted" ? "good" : amendment.status === "rejected" ? "bad" : "neutral",
        by: amendment.proposedBy ? `by ${amendment.proposedBy}` : "",
        controls: amendment.status === "proposed" && Boolean(amendment.playerCanResolve || amendment.playerCanWithdraw || view?.canParticipate),
        canResolve: Boolean(amendment.playerCanResolve),
        canAsk: !amendment.playerCanResolve && Boolean(view?.canParticipate),
        canWithdraw: Boolean(amendment.playerCanWithdraw),
      })),
      canAmend: Boolean(proposal.playerCanAmend && view?.canParticipate),
    };
  };

  const decisionView = (proposal) => {
    const ballots = list(proposal?.closedBallots);
    const fallbackCount = (choice) => ballots.filter((ballot) => lower(ballot?.choice) === choice).length;
    const count = (key) => (Number.isFinite(Number(proposal?.outcome?.[key])) ? Number(proposal.outcome[key]) : fallbackCount(key));
    const tally = { yes: count("yes"), no: count("no"), abstain: count("abstain"), veto: count("veto") };
    return {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      statusTone: ["passed", "implementation"].includes(proposal.status) ? "good" : "bad",
      meta: [proposal.lastUpdatedDate, proposal.ruleLabel, proposal.ballotsRecorded ? `${proposal.ballotsRecorded} ballots recorded` : ""].filter(Boolean).join(" · "),
      summary: proposal.summary || "",
      reason: proposal.outcome?.reason && proposal.outcome.reason !== proposal.summary ? String(proposal.outcome.reason) : "",
      tally: [["yes", "For"], ["no", "Against"], ["abstain", "Abstain"], ["veto", "Veto"]]
        .filter(([choice]) => choice !== "veto" || tally.veto > 0)
        .map(([choice, label]) => ({ choice, label, count: tally[choice] })),
      ballots: ballots.map((ballot) => ({ polity: ballot.polity, choice: ballot.choice, tone: ballotTone(ballot.choice), government: ballot.government || "", reason: ballot.reason || "", date: ballot.date || "" })),
    };
  };

  const caseView = (entry, institution, player) => {
    const status = lower(entry?.status);
    const kind = lower(entry?.kind);
    return {
      id: clean(entry?.id),
      kind,
      initiatedBy: clean(entry?.initiatedBy),
      title: capitalizeWords(humanize(entry?.kind || "membership case")),
      status: humanize(entry?.status || "pending"),
      tone: ["accepted", "resolved"].includes(status) ? "good"
        : ["rejected", "expired"].includes(status) ? "bad"
          : ["pending", "pending-approval", "negotiating"].includes(status) ? "live" : "neutral",
      line: `${entry?.polity ? `${entry.polity}${entry.requestedStatus ? ` · ${humanize(entry.requestedStatus)}` : ""}` : clean(institution?.name)}${entry?.initiatedBy ? ` · initiated by ${entry.initiatedBy}` : ""}${entry?.effectiveDate ? ` · effective ${entry.effectiveDate}` : ""}`,
      reason: clean(entry?.reason),
      terms: clean(entry?.terms),
      canRespond: lower(entry?.polity) === lower(player) && ["invitation", "founding-invitation"].includes(kind) && ["pending", "negotiating"].includes(status),
      canOpenNegotiation: lower(entry?.initiatedBy) === lower(player) && ["invitation", "founding-invitation"].includes(kind) && ["pending", "negotiating"].includes(status),
      canRetract: lower(entry?.initiatedBy) === lower(player) && ["pending", "negotiating", "pending-approval"].includes(status),
      canCancelApplication: lower(entry?.polity) === lower(player) && kind === "application" && ["pending", "negotiating", "pending-approval"].includes(status),
    };
  };

  const confirmText = (institution, type, polity = "") => {
    const text = exported("institutionLifecycleConfirmText");
    return typeof text === "function" ? clean(text(institution, type, polity)) : "";
  };

  const detail = (world, chats, player, selectedId, inviteStatus) => {
    const { row, view, pendingLifecycle } = selectedFor(world, player, selectedId);
    if (!view) return null;
    const institution = view.institution;
    const polities = polityKeys(world, player);
    const invitableFor = exported("institutionInvitablePolities");
    const mayRise = exported("institutionMayRequestMembership");
    const invitable = typeof invitableFor === "function" ? invitableFor(row.institution, polities, inviteStatus) : [];
    const playerMayRise = typeof mayRise === "function" ? Boolean(mayRise(row.institution, player)) : false;
    const history = list(institution?.membershipHistory);
    const channel = channelMap(chats).get(clean(institution.id)) || null;
    const allowedStatuses = list(institution?.charter?.lifecycle?.accession?.allowedStatuses);
    const docs = readable(world?.reports, player).filter((report) => documentTouchesInstitution(report, institution)).slice(0, 12);
    const overviewPurpose = clean(list(institution?.charter?.lifecycle?.purpose)[0] || institution?.description || institution?.charter?.lifecycle?.identity?.politicalCharacter || "");
    const formal = list(view.decisionHistory).map((proposal) => ({
      id: `proposal:${proposal.id}`,
      date: clean(proposal.lastUpdatedDate || proposal.createdDate),
      title: proposal.title || "Formal decision",
      detail: `${humanize(proposal.status || "recorded")}${proposal.ruleLabel ? ` · ${proposal.ruleLabel}` : ""}`,
      tone: ["passed", "implementation"].includes(lower(proposal.status)) ? "good" : ["failed", "vetoed"].includes(lower(proposal.status)) ? "bad" : "neutral",
    }));
    const membership = history.map((entry) => ({
      id: `membership:${entry.id}`,
      date: clean(entry.date),
      title: entry.polity ? `${entry.polity} · ${humanize(entry.action)}` : humanize(entry.action || "Membership update"),
      detail: clean(entry.reason),
      tone: ["joined", "accepted", "reinstated"].includes(lower(entry.action)) ? "good" : ["expelled", "withdrew", "rejected"].includes(lower(entry.action)) ? "bad" : "neutral",
    }));
    const recentActivity = [...formal, ...membership].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const active = list(view.activeProposals);
    const pendingBallots = Number(view.playerPendingBallotCount || 0);
    const pendingAmendments = Number(view.playerPendingAmendmentReviewCount || 0);
    const automationEntry = [...automation.values()].find((entry) => lower(entry?.institutionId) === lower(institution.id));
    const lifecycle = institution?.charter?.lifecycle || null;
    const status = lower(institution.status || "active");
    return {
      id: clean(institution.id),
      name: clean(institution.name || institution.id),
      status: clean(institution.status || "active"),
      statusTone: status === "active" ? "good" : "neutral",
      dissolved: status === "dissolved",
      sub: `${clean(institution.kind || "institution").replace(/[-_]/g, " ")}${institution.foundedDate ? ` · founded ${institution.foundedDate}` : ""}`,
      purpose: overviewPurpose,
      emblem: emblem(institution),
      facts: [
        { label: "Members", value: `${view?.memberSummary?.active || 0}/${view?.memberSummary?.total || 0}` },
        { label: "Your role", value: capitalizeWords(view?.member ? membershipLabel(view.member) : "not a member") },
        { label: "Decision rule", value: view?.charterView?.defaultRule?.label || "unspecified" },
      ],
      tabs: [
        ["overview", "Overview"],
        ["council", "Council"],
        ["agenda", `Agenda${active.length ? ` (${active.length})` : ""}`],
        ["decisions", "Decisions"],
        ["charter", "Charter"],
        ["members", "Members"],
        ["documents", `Documents${docs.length ? ` (${docs.length})` : ""}`],
      ].map(([key, label]) => ({ key, label })),
      isMember: Boolean(row.member),
      canParticipate: Boolean(view.canParticipate),
      canTableProposal: Boolean(view.canTableProposal),
      channelId: clean(channel?.id),
      pendingBallots,
      pendingAmendments,
      actionRequired: `${pendingBallots ? `${pendingBallots} ballot${pendingBallots === 1 ? "" : "s"} awaiting you` : ""}${pendingBallots && pendingAmendments ? " · " : ""}${pendingAmendments ? `${pendingAmendments} amendment review${pendingAmendments === 1 ? "" : "s"}` : ""}`,
      business: active.length
        ? { kind: "proposal", title: active[0].title, text: active[0].summary || "This matter is currently before the institution.", status: humanize(active[0].status), live: active[0].status === "voting", more: active.length > 1 ? `+${active.length - 1} more` : "" }
        : pendingLifecycle.length
          ? { kind: "lifecycle", title: "Membership business awaiting resolution", text: `${pendingLifecycle.length} active lifecycle case${pendingLifecycle.length === 1 ? "" : "s"} remain before the institution.` }
          : { kind: "none", title: "No active formal business", text: "There are no debates, ballots or membership cases currently requiring attention." },
      businessStrong: Boolean(active.length || pendingLifecycle.length),
      hasPendingLifecycle: pendingLifecycle.length > 0,
      recentActivity,
      showFormalRecord: (list(view.decisionHistory).length || history.length) > recentActivity.length,
      proposals: active.map((proposal) => proposalView(proposal, view)),
      unresolvedNpcNote: list(view.openBallots).some((proposal) => proposal.unresolvedNpcVoters > 0),
      decisions: list(view.decisionHistory).map(decisionView),
      accession: (!row.member || playerMayRise) && status !== "dissolved"
        ? { blocked: pendingLifecycle.some((entry) => lower(entry.polity) === lower(player)), observer: !row.member && allowedStatuses.includes("observer") }
        : null,
      actions: row.member && view.canParticipate && status !== "dissolved"
        ? {
          status: humanize(institution.status || "active"),
          live: status === "provisional",
          inviteStatus,
          statuses: [{ value: "member", label: MEMBER_STATUS_LABELS.member }, ...INVITABLE_LOWER_STATUSES.filter((entry) => allowedStatuses.includes(entry)).map((entry) => ({ value: entry, label: MEMBER_STATUS_LABELS[entry] }))],
          invitable: invitable.map((entry) => ({ polity: entry.polity, note: entry.status ? (MEMBER_STATUS_LABELS[entry.status] ?? humanize(entry.status)) : "" })),
          withdrawConfirm: confirmText(institution, "withdraw"),
          dissolveConfirm: confirmText(institution, "dissolve"),
        }
        : null,
      lifecycleCases: pendingLifecycle.map((entry) => caseView(entry, institution, player)),
      members: list(view.members).map((member) => ({
        polity: member.polity,
        label: membershipLabel(member),
        suspended: member.status === "suspended",
        since: member.since ? `since ${member.since}` : "",
        canAct: Boolean(view.canParticipate) && lower(member.polity) !== lower(player) && status !== "dissolved",
        expelConfirm: confirmText(institution, "expel", member.polity),
      })),
      history: [...history].reverse().slice(0, 24).map((entry) => ({
        line: `${entry.polity ? `${entry.polity} · ` : ""}${humanize(entry.action)}${entry.reason ? ` · ${entry.reason}` : ""}`,
        date: clean(entry.date),
      })),
      historyCount: history.length,
      charter: {
        rule: view.charterView?.defaultRule?.label || "Unspecified voting rule",
        note: clean(view.charterView?.note),
        proposalRules: list(view.charterView?.proposalRules).map((entry) => ({ label: capitalizeWords(entry.label), rule: entry.rule.label })),
        lifecycle: lifecycle
          ? {
            purpose: list(lifecycle.purpose).join("; "),
            politicalCharacter: clean(lifecycle.identity?.politicalCharacter),
            geographicScope: list(lifecycle.identity?.geographicScope).join(", "),
            primaryThreatModel: list(lifecycle.identity?.primaryThreatModel).join(", "),
            rules: [["Accession", lifecycle.accession], ["Withdrawal", lifecycle.withdrawal], ["Expulsion", lifecycle.expulsion], ["Dissolution", lifecycle.dissolution]]
              .map(([label, rule]) => ({ label, note: clean(rule?.note), mode: humanize(rule?.mode || "approval"), notice: Number(rule?.noticeDays) > 0 ? `${rule.noticeDays}d notice` : "" })),
          }
          : null,
      },
      documents: docs.map((report) => ({
        id: clean(report.id),
        title: clean(report.title),
        dateline: clean(report.dateline),
        line: `${report.from ? `From ${report.from} · ` : ""}${report.visibleTo === null ? "published" : list(report.visibleTo).some((name) => lower(name) === lower(player)) ? "held by your government" : "intercepted copy"}`,
        body: String(report.body ?? ""),
      })),
      automation: automationEntry ? (automationEntry.kind === "vote" ? "Member governments are casting formal ballots…" : "Council members are considering the tabled matter…") : "",
    };
  };

  const voteRequest = async ({ institutionId, proposalId, player, gameDate }) => {
    const commit = () => engine.institutionalGovernance.commitInstitutionalPlayerVoteRequest({ institutionId, proposalId, playerCountry: player, date: gameDate, expectedGameId: expectedGameId() });
    const backfill = exported("commitWithVotingRuleBackfill");
    return typeof backfill === "function"
      ? backfill(commit, { institutionId, proposalId, expectedGameId: expectedGameId() })
      : commit();
  };

  const lifecycleCommand = async (command) => {
    const { player, gameDate } = await readIdentity();
    const result = await engine.institutionLifecycle.commitInstitutionLifecycleCommand({
      playerCountry: player, date: gameDate, expectedGameId: expectedGameId(), command,
    });
    return {
      institutionId: clean(result?.institution?.id),
      createdChatId: clean(result?.createdChat?.id),
    };
  };

  const governance = async (institutionId, command) => {
    const { player, gameDate } = await readIdentity();
    await engine.institutionalGovernance.commitInstitutionGovernanceCommand({
      institutionId, playerCountry: player, date: gameDate, expectedGameId: expectedGameId(), command: command(player),
    });
    return true;
  };

  const councilTurn = async ({ institutionId = "", proposalId = "", kind = "debate", playerComment = "", source = "player" } = {}, signal = null) => {
    const id = clean(institutionId);
    const proposal = clean(proposalId);
    const mode = kind === "vote" ? "vote" : kind === "amendment" ? "amendment" : "debate";
    if (!id || !proposal) return null;
    const key = `${id}:${proposal}:${mode}`;
    if (inFlight.has(key)) return null;
    inFlight.add(key);
    const campaign = clean(engine.getLibraryState()?.activeGameId);
    const { player, gameDate } = await readIdentity();
    try {
      automation.set(key, { key, institutionId: id, proposalId: proposal, kind: mode });
      emit("institutions.automation", { key, institutionId: id, proposalId: proposal, kind: mode, active: true });
      const comment = clean(playerComment);
      const materialized = comment
        ? await engine.institutionalGovernance.commitInstitutionalPlayerMessage({ institutionId: id, playerCountry: player, text: comment, date: gameDate, expectedGameId: campaign })
        : await engine.institutionalChannels.ensureInstitutionalChannel({ institutionId: id, playerCountry: player, date: gameDate, expectedGameId: campaign });
      emit("institutions.changed", { institutionId: id, channelId: clean(materialized?.channel?.id) });
      const result = await engine.gameplay.runChatActionBatch({
        agentKind: "diplomacy",
        chat: materialized.channel,
        playerMessage: mode === "amendment" ? comment : "",
        playerCountry: player,
        time: gameDate,
        institutionDebateRequested: mode === "debate",
        institutionProposalId: proposal,
        formalBusinessRequested: mode === "vote",
        formalBusinessInteractive: mode === "vote",
        useCanonicalState: true,
        expectedGameId: campaign,
        ...(signal ? { signal } : {}),
      });
      const channelId = clean(result?.channel?.id || materialized?.channel?.id);
      return { channelId, source, events: list(result?.newEvents).length };
    } finally {
      inFlight.delete(key);
      automation.delete(key);
      emit("institutions.automation", { key, institutionId: id, proposalId: proposal, kind: mode, active: false });
      emit("institutions.changed", { institutionId: id });
    }
  };

  return {
    "institutions.view": async ({ selectedId = "", inviteStatus = "member" } = {}) => {
      const { world, chats, player, gameDate } = await readAll();
      const { allRows, personalRows, pending } = rowsFor(world, player);
      const channels = channelMap(chats);
      const kinds = list(exported("INSTITUTION_KINDS", "value"));
      const polities = polityKeys(world, player);
      return plain({
        player,
        gameDate,
        personal: personalRows.map((row) => rowView(row, channels)),
        all: allRows.map((row) => rowView(row, channels)),
        pending,
        polities,
        kinds: kinds.map((kind) => ({ value: kind, label: humanize(kind) })),
        selected: selectedId ? detail(world, chats, player, selectedId, inviteStatus || "member") : null,
        automation: [...automation.values()],
      });
    },
    "institutions.found": async ({ founding = {} } = {}) => {
      const result = await lifecycleCommand({
        type: "found", name: clean(founding.name), shortName: clean(founding.shortName), kind: founding.kind,
        purpose: splitList(founding.purpose), politicalCharacter: clean(founding.politicalCharacter),
        geographicScope: splitList(founding.geographicScope), primaryThreatModel: splitList(founding.primaryThreatModel),
        votingRule: founding.votingRule, minimumFoundingMembers: Math.max(1, Number(founding.minimumFoundingMembers) || 1),
        accessionMode: founding.accessionMode, allowObserver: founding.allowObserver !== false,
        withdrawalMode: founding.withdrawalMode, withdrawalNoticeDays: Math.max(0, Number(founding.withdrawalNoticeDays) || 0),
        expulsionMode: founding.expulsionMode, dissolutionMode: founding.dissolutionMode,
        invitees: splitList(founding.invitees), charterNote: clean(founding.charterNote),
      });
      return result;
    },
    "institutions.apply": async ({ institutionId = "", requestedStatus = "member", reason = "" } = {}) => {
      const { player } = await readIdentity();
      return lifecycleCommand({ type: "apply", institutionId, polity: player, requestedStatus, reason: clean(reason) });
    },
    "institutions.invite": async ({ institutionId = "", polity = "", requestedStatus = "member", reason = "" } = {}) => {
      const { player } = await readIdentity();
      return lifecycleCommand({ type: "invite", institutionId, initiatedBy: player, polity: clean(polity), requestedStatus, reason: clean(reason) });
    },
    "institutions.lifecycle": async ({ institutionId = "", command = {} } = {}) => {
      const { player } = await readIdentity();
      const type = clean(command?.type);
      const reason = clean(command?.reason);
      const caseId = clean(command?.caseId);
      const polity = clean(command?.polity);
      const shaped = {
        respond: { type: "respond", caseId, actorPolity: player, decision: clean(command?.decision), reason, authority: "player" },
        retract: { type: "retract", caseId, initiatedBy: player, authority: "player" },
        "cancel-application": { type: "cancel-application", caseId, polity: player, reason, authority: "player" },
        withdraw: { type: "withdraw", polity: player, reason, authority: "player" },
      }[type] || { type, polity, initiatedBy: player, reason };
      return lifecycleCommand({ institutionId, ...shaped });
    },
    "institutions.openLifecycle": async ({ institutionId = "", caseId = "" } = {}) => {
      const { world, player, gameDate } = await readAll();
      const { view, pendingLifecycle } = selectedFor(world, player, institutionId);
      if (!view?.institution?.id) throw new Error("That institution is no longer on file.");
      const entry = pendingLifecycle.find((candidate) => clean(candidate?.id) === clean(caseId)) || { id: caseId };
      const grouped = lower(entry?.kind) === "founding-invitation"
        ? pendingLifecycle.filter((candidate) => lower(candidate?.kind) === "founding-invitation" && lower(candidate?.initiatedBy) === lower(entry?.initiatedBy || player))
        : [entry];
      const result = await engine.institutionLifecycle.ensureInstitutionLifecycleNegotiationChat({
        institutionId: view.institution.id,
        caseIds: grouped.map((candidate) => candidate.id),
        playerCountry: player,
        date: gameDate,
        expectedGameId: expectedGameId(),
      });
      return { channelId: clean(result?.channel?.id) };
    },
    "institutions.openCouncil": async ({ institutionId = "" } = {}) => {
      const { chats, player, gameDate } = await readAll();
      const existing = channelMap(chats).get(clean(institutionId));
      if (existing) return { channelId: clean(existing.id), existing: true };
      const result = await engine.institutionalChannels.ensureInstitutionalChannel({ institutionId, playerCountry: player, date: gameDate, expectedGameId: expectedGameId() });
      return { channelId: clean(result?.channel?.id), existing: false };
    },
    "institutions.proposal": async ({ institutionId = "", title = "", summary = "", mode = "debate" } = {}) => {
      const { player, gameDate } = await readIdentity();
      const result = await engine.institutionalGovernance.commitInstitutionalPlayerProposal({
        institutionId, playerCountry: player, date: gameDate, expectedGameId: expectedGameId(),
        proposal: { type: "resolution", title: String(title ?? "").trim(), summary: String(summary ?? "").trim() },
      });
      const proposalId = clean(result?.proposal?.id);
      if (!proposalId) throw new Error("The proposal was created but its canonical id was not returned.");
      if (mode === "vote") await voteRequest({ institutionId, proposalId, player, gameDate });
      return { proposalId };
    },
    "institutions.submit": async ({ institutionId = "", proposalId = "" } = {}) => {
      const { player, gameDate } = await readIdentity();
      await voteRequest({ institutionId, proposalId, player, gameDate });
      return { proposalId };
    },
    "institutions.vote": async ({ institutionId = "", proposalId = "", choice = "" } = {}) => governance(institutionId, (player) => ({
      type: "vote", proposalId, polity: player, choice, authority: "player", finalizeWhenComplete: true, implementWhenPassed: true,
    })),
    "institutions.amend": async ({ institutionId = "", proposalId = "", text = "" } = {}) => governance(institutionId, (player) => ({
      type: "amendment", proposalId, proposer: player, amendment: { text },
    })),
    "institutions.amendmentStatus": async ({ institutionId = "", proposalId = "", amendmentId = "", status = "" } = {}) => governance(institutionId, (player) => ({
      type: "amendment-status", proposalId, amendmentId, status, requester: player,
    })),
    "institutions.councilTurn": async (args = {}, { signal } = {}) => plain(await councilTurn(args, signal)),
  };
};
