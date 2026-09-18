import React, { useEffect, useMemo, useState } from "react";
import { institutionLogoUrl } from "../../runtime/institutionLogos.js";
import { ensureInstitutionalChannel } from "../../runtime/institutionalChannels.js";
import {
  buildInstitutionDiplomacyView,
  buildPublicInstitutionDiplomacyView,
  listAllInstitutionDiplomacyViews,
  listInstitutionDiplomacyViews,
} from "../../runtime/institutionalDiplomacyView.js";
import {
  commitInstitutionGovernanceCommand,
  commitInstitutionalPlayerProposal,
  commitInstitutionalPlayerVoteRequest,
} from "../../runtime/institutionalGovernance.js";
import { documentsReadableBy } from "../../runtime/reportDelivery.js";
import { getLibraryState } from "../../runtime/library.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const list = (value) => Array.isArray(value) ? value : [];

const panel = {
  border: "1px solid rgba(255,255,255,.08)", borderRadius: "12px", background: "rgba(255,255,255,.035)",
};

export const SmallPill = ({ children, tone = "neutral" }) => {
  const tones = {
    neutral: ["rgba(255,255,255,.06)", "rgba(255,255,255,.12)", "rgba(255,255,255,.58)"],
    live: ["rgba(245,158,11,.12)", "rgba(245,158,11,.28)", "#fde68a"],
    good: ["rgba(34,197,94,.11)", "rgba(34,197,94,.24)", "#86efac"],
    bad: ["rgba(239,68,68,.1)", "rgba(239,68,68,.22)", "#fca5a5"],
    purple: ["rgba(139,92,246,.12)", "rgba(167,139,250,.26)", "#ddd6fe"],
  };
  const [bg, border, color] = tones[tone] || tones.neutral;
  return <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${border}`, background: bg, color, borderRadius: "999px", padding: ".14rem .42rem", fontSize: ".56rem", fontWeight: 750, lineHeight: 1.2 }}>{children}</span>;
};

export const Emblem = ({ institution, size = 42 }) => {
  const [failed, setFailed] = useState(false);
  const url = institutionLogoUrl(institution);
  const raw = clean(institution?.shortName || institution?.name || institution?.id || "IN");
  const mark = raw.length <= 6 ? raw.toUpperCase() : raw.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 5).toUpperCase();
  return <div style={{ width: size, height: size, flex: "0 0 auto", borderRadius: 11, display: "grid", placeItems: "center", overflow: "hidden", padding: url && !failed ? 4 : 0, background: "linear-gradient(145deg,rgba(139,92,246,.25),rgba(59,130,246,.09))", border: "1px solid rgba(167,139,250,.28)" }} title={institution?.name || institution?.id || "Institution"}>
    {url && !failed ? <img src={url} alt="" aria-hidden="true" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 7 }} /> : <span style={{ fontSize: ".6rem", fontWeight: 850, color: "#ede9fe" }}>{mark || "IN"}</span>}
  </div>;
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

const InstitutionRow = ({ row, selected, unread = false, onClick }) => {
  const institution = row.institution || {};
  const pending = Number(row.playerPendingBallotCount || 0) + Number(row.playerPendingAmendmentReviewCount || 0);
  return <button type="button" onClick={onClick} style={{ ...panel, width: "100%", display: "flex", gap: ".7rem", alignItems: "center", textAlign: "left", padding: ".7rem", cursor: "pointer", color: "white", borderColor: selected ? "rgba(167,139,250,.42)" : "rgba(255,255,255,.08)", background: selected ? "rgba(139,92,246,.09)" : "rgba(255,255,255,.03)" }}>
    <Emblem institution={institution} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
        <strong style={{ fontSize: ".8rem", lineHeight: 1.25, overflowWrap: "anywhere" }}>{institution.name || institution.id}</strong>
        {pending > 0 && <SmallPill tone="live">{pending} action{pending === 1 ? "" : "s"}</SmallPill>}
        {unread && <SmallPill tone="purple">new</SmallPill>}
      </div>
      <div style={{ marginTop: ".18rem", fontSize: ".62rem", color: "rgba(255,255,255,.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {row.member ? `${clean(row.member.role || row.member.status || "member")} · ${row.canParticipate ? "participating" : "read-only"}` : "world institution · public overview"}
        {row.openBallotCount ? ` · ${row.openBallotCount} open ballot${row.openBallotCount === 1 ? "" : "s"}` : ""}
      </div>
    </div>
    <span style={{ color: "rgba(255,255,255,.28)" }}>›</span>
  </button>;
};

export const Facts = ({ view }) => {
  const institution = view?.institution || {};
  const rule = view?.charterView?.defaultRule?.label || "unspecified";
  const items = [
    ["Members", `${view?.memberSummary?.active || 0}/${view?.memberSummary?.total || 0}`],
    ["Your role", view?.member ? clean(view.member.role || view.member.status || "member") : "not a member"],
    ["Decision rule", rule],
    ["Live agenda", String(view?.activeProposals?.length || 0)],
  ];
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(10rem,1fr))", gap: 1, background: "rgba(255,255,255,.05)", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,.06)" }}>
    {items.map(([label, value]) => <div key={label} style={{ padding: ".55rem .65rem", background: "rgba(20,20,24,.95)" }}><div style={{ fontSize: ".52rem", textTransform: "uppercase", letterSpacing: ".07em", color: "rgba(255,255,255,.38)" }}>{label}</div><div style={{ marginTop: ".14rem", fontSize: ".66rem", fontWeight: 700, color: "rgba(255,255,255,.82)", textTransform: label === "Your role" ? "capitalize" : "none" }}>{value}</div></div>)}
  </div>;
};

const ProposalCard = ({ proposal, view, busy, onVote, onSubmit, onAmend, onResolveAmendment }) => {
  const [amendText, setAmendText] = useState("");
  const needsVote = proposal.status === "voting" && proposal.playerEligible && !proposal.playerBallot;
  const statusTone = needsVote ? "live" : ["passed", "implementation"].includes(proposal.status) ? "good" : ["failed", "vetoed"].includes(proposal.status) ? "bad" : "purple";
  return <div style={{ ...panel, padding: ".72rem", borderColor: needsVote ? "rgba(245,158,11,.32)" : "rgba(167,139,250,.14)", background: needsVote ? "linear-gradient(180deg,rgba(245,158,11,.07),rgba(139,92,246,.035))" : "rgba(139,92,246,.045)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
      <strong style={{ flex: 1, minWidth: 0, fontSize: ".74rem" }}>{proposal.title}</strong>
      {needsVote && <SmallPill tone="live">Your vote</SmallPill>}
      <SmallPill tone={statusTone}>{proposal.status}</SmallPill>
    </div>
    {proposal.summary && <div style={{ marginTop: ".35rem", fontSize: ".65rem", lineHeight: 1.45, color: "rgba(255,255,255,.55)" }}>{proposal.summary}</div>}
    <div style={{ marginTop: ".35rem", fontSize: ".56rem", color: "rgba(255,255,255,.32)" }}>{proposal.createdBy ? `Submitted by ${proposal.createdBy}` : "Formal matter"}{proposal.ruleLabel ? ` · ${proposal.ruleLabel}` : ""}{proposal.status === "voting" ? ` · ${proposal.ballotsRecorded}/${proposal.eligibleVoters} ballots` : ""}</div>
    {proposal.playerBallot && <div style={{ marginTop: ".4rem" }}><SmallPill tone="neutral">You voted {proposal.playerBallot.choice}</SmallPill></div>}
    {needsVote && <div style={{ display: "flex", gap: ".35rem", marginTop: ".55rem", flexWrap: "wrap" }}>
      {["yes", "no", "abstain", ...(proposal.playerCanVeto ? ["veto"] : [])].map((choice) => <button key={choice} disabled={busy} onClick={() => onVote(proposal.id, choice)} style={{ border: "1px solid rgba(167,139,250,.24)", borderRadius: 8, background: "rgba(139,92,246,.1)", color: "#ede9fe", cursor: busy ? "wait" : "pointer", padding: ".3rem .5rem", fontSize: ".6rem", fontWeight: 700, textTransform: "capitalize" }}>{choice}</button>)}
    </div>}
    {proposal.playerCanSubmitForVote && view?.canParticipate && <button disabled={busy} onClick={() => onSubmit(proposal.id)} style={{ marginTop: ".5rem", border: "1px solid rgba(245,158,11,.24)", borderRadius: 8, background: "rgba(245,158,11,.08)", color: "#fde68a", cursor: busy ? "wait" : "pointer", padding: ".32rem .52rem", fontSize: ".6rem", fontWeight: 750 }}>Submit for formal vote</button>}
    {proposal.amendmentItems?.length ? <div style={{ marginTop: ".55rem", display: "flex", flexDirection: "column", gap: ".35rem" }}>
      {proposal.amendmentItems.map((amendment) => <div key={amendment.id} style={{ borderLeft: "2px solid rgba(167,139,250,.35)", paddingLeft: ".45rem" }}>
        <div style={{ fontSize: ".6rem", color: "rgba(255,255,255,.68)" }}>{amendment.text}</div>
        <div style={{ marginTop: ".18rem", display: "flex", gap: ".3rem", alignItems: "center" }}><SmallPill tone={amendment.status === "accepted" ? "good" : amendment.status === "rejected" ? "bad" : "neutral"}>{amendment.status}</SmallPill><span style={{ fontSize: ".53rem", color: "rgba(255,255,255,.3)" }}>{amendment.proposedBy ? `by ${amendment.proposedBy}` : ""}</span></div>
        {amendment.status === "proposed" && (amendment.playerCanResolve || amendment.playerCanWithdraw) && <div style={{ display: "flex", gap: ".3rem", marginTop: ".3rem" }}>
          {amendment.playerCanResolve && ["accepted", "rejected"].map((status) => <button key={status} disabled={busy} onClick={() => onResolveAmendment(proposal.id, amendment.id, status)} style={{ border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", color: status === "accepted" ? "#86efac" : "#fca5a5", borderRadius: 7, padding: ".2rem .35rem", fontSize: ".54rem", cursor: busy ? "wait" : "pointer" }}>{status === "accepted" ? "Accept" : "Reject"}</button>)}
          {amendment.playerCanWithdraw && <button disabled={busy} onClick={() => onResolveAmendment(proposal.id, amendment.id, "withdrawn")} style={{ border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.6)", borderRadius: 7, padding: ".2rem .35rem", fontSize: ".54rem", cursor: busy ? "wait" : "pointer" }}>Withdraw</button>}
        </div>}
      </div>)}
    </div> : null}
    {proposal.playerCanAmend && view?.canParticipate && <div style={{ marginTop: ".55rem", display: "flex", gap: ".35rem" }}>
      <input value={amendText} onChange={(e) => setAmendText(e.target.value)} placeholder="Propose amendment…" maxLength={4000} style={{ flex: 1, minWidth: 0, border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "rgba(0,0,0,.18)", color: "white", padding: ".35rem .45rem", fontSize: ".6rem" }} />
      <button disabled={busy || !amendText.trim()} onClick={async () => { await onAmend(proposal.id, amendText.trim()); setAmendText(""); }} style={{ border: "1px solid rgba(167,139,250,.22)", background: "rgba(139,92,246,.1)", color: "#ddd6fe", borderRadius: 8, padding: ".3rem .45rem", fontSize: ".56rem", cursor: busy || !amendText.trim() ? "not-allowed" : "pointer" }}>Add</button>
    </div>}
  </div>;
};

export default function InstitutionsWorkspace({ world = {}, playerCountry = "", gameDate = "", chats = [], unreadIds = new Set(), onAdoptResult, onOpenCouncil, focusRequest = null }) {
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [section, setSection] = useState("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalSummary, setProposalSummary] = useState("");

  useEffect(() => {
    const institutionId = clean(focusRequest?.institutionId);
    if (!institutionId) return;
    setSelectedId(institutionId);
    const requestedSection = clean(focusRequest?.section);
    if (requestedSection && requestedSection !== "council") setSection(requestedSection);
    setError("");
  }, [focusRequest?.institutionId, focusRequest?.section, focusRequest?.nonce]);

  const memberRows = useMemo(() => sortRows(listInstitutionDiplomacyViews(world, playerCountry)), [world, playerCountry]);
  const allRows = useMemo(() => listAllInstitutionDiplomacyViews(world, playerCountry), [world, playerCountry]);
  const rows = showAll ? allRows : memberRows;
  const channelByInstitution = useMemo(() => new Map(list(chats)
    .filter((chat) => chat?.institutionId)
    .map((chat) => [clean(chat.institutionId), chat])), [chats]);
  const selectedRow = (selectedId ? allRows.find((row) => clean(row?.institution?.id) === clean(selectedId)) : null) || null;
  const selectedView = useMemo(() => {
    if (!selectedRow?.institution?.id) return null;
    return selectedRow.member
      ? buildInstitutionDiplomacyView({ world, institutionId: selectedRow.institution.id, playerCountry })
      : buildPublicInstitutionDiplomacyView({ world, institutionId: selectedRow.institution.id, playerCountry });
  }, [world, playerCountry, selectedRow?.institution?.id, selectedRow?.member]);
  const pending = memberRows.reduce((sum, row) => sum + Number(row.playerPendingBallotCount || 0) + Number(row.playerPendingAmendmentReviewCount || 0), 0);

  const readableDocs = useMemo(() => selectedView?.institution
    ? documentsReadableBy(world?.reports, playerCountry).filter((report) => documentTouchesInstitution(report, selectedView.institution)).slice(0, 12)
    : [], [world?.reports, playerCountry, selectedView?.institution]);

  const adopt = (result) => {
    if (result) onAdoptResult?.(result);
  };
  const expectedGameId = () => clean(getLibraryState()?.activeGameId);
  const run = async (key, fn) => {
    if (busy) return null;
    setBusy(key); setError("");
    try { const result = await fn(); adopt(result); return result; }
    catch (err) { setError(err?.message || String(err)); return null; }
    finally { setBusy(""); }
  };

  const openCouncil = async () => {
    setSection("council");
    if (!selectedView?.institution?.id || !selectedRow?.member) return;
    const existing = channelByInstitution.get(clean(selectedView.institution.id));
    if (existing) {
      onOpenCouncil?.(existing, null);
      return;
    }
    const result = await run("council", () => ensureInstitutionalChannel({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId() }));
    if (result?.channel) onOpenCouncil?.(result.channel, null);
  };

  const createProposal = async () => {
    if (!proposalTitle.trim() || !selectedView?.institution?.id) return;
    const result = await run("proposal", () => commitInstitutionalPlayerProposal({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId(), proposal: { type: "resolution", title: proposalTitle.trim(), summary: proposalSummary.trim() } }));
    if (result) { setProposalTitle(""); setProposalSummary(""); }
  };

  const vote = (proposalId, choice) => run(`vote:${proposalId}`, () => commitInstitutionGovernanceCommand({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId(), command: { type: "vote", proposalId, polity: playerCountry, choice, authority: "player", finalizeWhenComplete: true, implementWhenPassed: true } }));
  const submit = (proposalId) => run(`submit:${proposalId}`, () => commitInstitutionalPlayerVoteRequest({ institutionId: selectedView.institution.id, proposalId, playerCountry, date: gameDate, expectedGameId: expectedGameId() }));
  const amend = (proposalId, text) => run(`amend:${proposalId}`, () => commitInstitutionGovernanceCommand({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId(), command: { type: "amendment", proposalId, proposer: playerCountry, amendment: { text } } }));
  const resolveAmendment = (proposalId, amendmentId, status) => run(`amend:${proposalId}:${amendmentId}`, () => commitInstitutionGovernanceCommand({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId(), command: { type: "amendment-status", proposalId, amendmentId, status, requester: playerCountry } }));

  if (!selectedView) {
    return <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: ".55rem 1rem", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", gap: ".45rem", flexShrink: 0 }}>
        <button onClick={() => setShowAll(false)} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 999, background: !showAll ? "rgba(139,92,246,.14)" : "rgba(255,255,255,.03)", color: !showAll ? "#ddd6fe" : "rgba(255,255,255,.55)", padding: ".28rem .55rem", fontSize: ".62rem", cursor: "pointer" }}>Your institutions ({memberRows.length})</button>
        <button onClick={() => setShowAll(true)} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 999, background: showAll ? "rgba(139,92,246,.14)" : "rgba(255,255,255,.03)", color: showAll ? "#ddd6fe" : "rgba(255,255,255,.55)", padding: ".28rem .55rem", fontSize: ".62rem", cursor: "pointer" }}>View all ({allRows.length})</button>
        {pending > 0 && <SmallPill tone="live">{pending} awaiting you</SmallPill>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: ".75rem 1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(15rem,1fr))", alignContent: "start", gap: ".55rem" }}>
        {rows.length ? rows.map((row) => { const channel = channelByInstitution.get(clean(row.institution.id)); return <InstitutionRow key={row.institution.id} row={row} unread={channel ? unreadIds.has(String(channel.id)) : false} onClick={() => { setSelectedId(row.institution.id); setSection("overview"); setError(""); }} />; }) : <div style={{ gridColumn: "1 / -1", margin: "auto", color: "rgba(255,255,255,.3)", fontSize: ".78rem", textAlign: "center", padding: "2rem" }}>{showAll ? "No institutions exist in this world yet." : "Your government is not part of any institution yet."}</div>}
      </div>
    </div>;
  }

  const institution = selectedView.institution;
  const tabs = [["overview", "Overview"], ["council", "Council"], ["agenda", `Agenda${selectedView.activeProposals?.length ? ` (${selectedView.activeProposals.length})` : ""}`], ["members", "Members"], ["charter", "Charter"], ["decisions", "Decisions"], ["documents", `Documents${readableDocs.length ? ` (${readableDocs.length})` : ""}`]];
  return <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
    <div style={{ display: "flex", alignItems: "center", gap: ".7rem", padding: ".75rem 1rem", borderBottom: "1px solid rgba(255,255,255,.06)", flexShrink: 0 }}>
      <button onClick={() => { setSelectedId(""); setError(""); }} style={{ border: 0, background: "transparent", color: "rgba(255,255,255,.55)", cursor: "pointer", fontSize: "1rem" }} aria-label="Back to institutions">‹</button>
      <Emblem institution={institution} size={46} />
      <div style={{ minWidth: 0, flex: 1 }}><div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}><strong style={{ fontSize: ".86rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{institution.name || institution.id}</strong><SmallPill tone={lower(institution.status || "active") === "active" ? "good" : "neutral"}>{institution.status || "active"}</SmallPill></div><div style={{ marginTop: ".16rem", fontSize: ".59rem", color: "rgba(255,255,255,.42)" }}>{institution.shortName ? `${institution.shortName} · ` : ""}{clean(institution.kind || "institution").replace(/[-_]/g, " ")}{institution.foundedDate ? ` · founded ${institution.foundedDate}` : ""}</div></div>
    </div>
    <div style={{ padding: ".6rem 1rem", flexShrink: 0 }}><Facts view={selectedView} /></div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: ".15rem", padding: "0 .7rem", borderBottom: "1px solid rgba(255,255,255,.06)", flexShrink: 0 }}>{tabs.map(([key, label]) => <button key={key} onClick={() => key === "council" && selectedRow.member ? openCouncil() : setSection(key)} disabled={key === "council" && Boolean(busy)} style={{ flex: "0 0 auto", border: 0, borderBottom: `2px solid ${section === key ? "rgba(139,92,246,.9)" : "transparent"}`, background: "transparent", color: section === key ? "#ede9fe" : "rgba(255,255,255,.47)", padding: ".48rem .55rem .55rem", fontSize: ".61rem", fontWeight: 720, cursor: key === "council" && busy ? "wait" : "pointer" }}>{key === "council" && busy === "council" ? "Opening…" : label}</button>)}</div>
    {error && <div style={{ margin: ".5rem 1rem 0", padding: ".45rem .6rem", borderRadius: 8, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", color: "#fca5a5", fontSize: ".62rem" }}>{error}</div>}
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: ".8rem 1rem 1rem" }}>
      {section === "overview" && <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
        <div style={{ ...panel, padding: ".7rem" }}><div style={{ fontSize: ".56rem", color: "rgba(255,255,255,.38)", textTransform: "uppercase", letterSpacing: ".07em" }}>Institutional authority</div><div style={{ marginTop: ".35rem", fontSize: ".68rem", lineHeight: 1.5, color: "rgba(255,255,255,.62)" }}>{selectedRow.member ? (selectedView.canParticipate ? "Your government is an active participant. Council speech is conversational; proposals, amendments and ballots below are native legal state." : "Your membership is currently read-only. You may inspect the institution but cannot exercise formal authority.") : "You are viewing this institution from outside. Public identity, charter and membership are visible; internal agenda and ballots remain private."}</div></div>
        {institution.description && <div style={{ ...panel, padding: ".7rem", fontSize: ".68rem", lineHeight: 1.5, color: "rgba(255,255,255,.6)" }}>{institution.description}</div>}
        <div style={{ ...panel, padding: ".7rem" }}><strong style={{ fontSize: ".66rem" }}>Latest formal activity</strong><div style={{ marginTop: ".45rem", display: "flex", flexDirection: "column", gap: ".35rem" }}>{selectedView.activeProposals?.slice(0, 3).map((proposal) => <div key={proposal.id} style={{ display: "flex", gap: ".4rem", alignItems: "center" }}><span style={{ flex: 1, fontSize: ".62rem", color: "rgba(255,255,255,.6)" }}>{proposal.title}</span><SmallPill tone={proposal.status === "voting" ? "live" : "purple"}>{proposal.status}</SmallPill></div>)}{!selectedView.activeProposals?.length && <span style={{ fontSize: ".61rem", color: "rgba(255,255,255,.32)" }}>No live formal business.</span>}</div></div>
      </div>}
      {section === "agenda" && <div style={{ display: "flex", flexDirection: "column", gap: ".55rem" }}>
        {selectedView.canTableProposal && <div style={{ ...panel, padding: ".7rem" }}><div style={{ fontSize: ".62rem", fontWeight: 750, marginBottom: ".4rem" }}>Table a proposal</div><input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} placeholder="Proposal title" maxLength={160} style={{ width: "100%", boxSizing: "border-box", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "rgba(0,0,0,.18)", color: "white", padding: ".4rem .5rem", fontSize: ".62rem" }} /><textarea value={proposalSummary} onChange={(e) => setProposalSummary(e.target.value)} placeholder="What should the institution decide?" maxLength={4000} rows={3} style={{ marginTop: ".4rem", width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "rgba(0,0,0,.18)", color: "white", padding: ".4rem .5rem", fontSize: ".62rem" }} /><button disabled={Boolean(busy) || !proposalTitle.trim()} onClick={createProposal} style={{ marginTop: ".4rem", border: "1px solid rgba(167,139,250,.25)", borderRadius: 8, background: "rgba(139,92,246,.12)", color: "#ede9fe", cursor: busy || !proposalTitle.trim() ? "not-allowed" : "pointer", padding: ".35rem .55rem", fontSize: ".6rem", fontWeight: 750 }}>Table proposal</button></div>}
        {selectedView.activeProposals?.length ? selectedView.activeProposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} view={selectedView} busy={Boolean(busy)} onVote={vote} onSubmit={submit} onAmend={amend} onResolveAmendment={resolveAmendment} />) : <div style={{ color: "rgba(255,255,255,.3)", fontSize: ".67rem", textAlign: "center", padding: "2rem .5rem" }}>No active proposals, amendments or ballots.</div>}
        {selectedView.openBallots?.some((proposal) => proposal.unresolvedNpcVoters > 0) && <div style={{ ...panel, padding: ".6rem", fontSize: ".58rem", color: "rgba(255,255,255,.42)", lineHeight: 1.45 }}>AI-member ballots are resolved through the current one-request Council turn. Open the Council and continue the discussion; native code validates every formal ballot independently.</div>}
      </div>}
      {section === "members" && <div style={{ display: "flex", flexDirection: "column", gap: ".35rem" }}>{selectedView.members?.map((member) => <div key={member.polity} style={{ ...panel, padding: ".55rem .65rem", display: "flex", alignItems: "center", gap: ".5rem" }}><strong style={{ flex: 1, fontSize: ".65rem" }}>{member.polity}</strong><SmallPill tone={member.status === "suspended" ? "bad" : "neutral"}>{member.role || member.status}</SmallPill>{member.since && <span style={{ fontSize: ".52rem", color: "rgba(255,255,255,.3)" }}>since {member.since}</span>}</div>)}</div>}
      {section === "charter" && <div style={{ display: "flex", flexDirection: "column", gap: ".55rem" }}><div style={{ ...panel, padding: ".7rem" }}><div style={{ fontSize: ".56rem", textTransform: "uppercase", color: "rgba(255,255,255,.38)" }}>Default voting rule</div><div style={{ marginTop: ".3rem", fontSize: ".72rem", fontWeight: 750 }}>{selectedView.charterView?.defaultRule?.label || "unspecified"}</div>{selectedView.charterView?.note && <p style={{ margin: ".45rem 0 0", fontSize: ".64rem", lineHeight: 1.45, color: "rgba(255,255,255,.55)" }}>{selectedView.charterView.note}</p>}</div>{selectedView.charterView?.proposalRules?.map((entry) => <div key={entry.type} style={{ ...panel, padding: ".6rem .7rem", display: "flex", gap: ".5rem", alignItems: "center" }}><span style={{ flex: 1, fontSize: ".62rem", textTransform: "capitalize" }}>{entry.label}</span><SmallPill tone="purple">{entry.rule.label}</SmallPill></div>)}</div>}
      {section === "decisions" && <div style={{ display: "flex", flexDirection: "column", gap: ".45rem" }}>{selectedView.decisionHistory?.length ? selectedView.decisionHistory.map((proposal) => <div key={proposal.id} style={{ ...panel, padding: ".65rem" }}><div style={{ display: "flex", gap: ".45rem", alignItems: "center" }}><strong style={{ flex: 1, fontSize: ".66rem" }}>{proposal.title}</strong><SmallPill tone={["passed", "implementation"].includes(proposal.status) ? "good" : "bad"}>{proposal.status}</SmallPill></div>{proposal.outcome?.reason && <div style={{ marginTop: ".3rem", fontSize: ".58rem", color: "rgba(255,255,255,.46)" }}>{proposal.outcome.reason}</div>}{proposal.closedBallots?.length ? <div style={{ marginTop: ".35rem", fontSize: ".55rem", color: "rgba(255,255,255,.32)" }}>{proposal.closedBallots.map((ballot) => `${ballot.polity}: ${ballot.choice}`).join(" · ")}</div> : null}</div>) : <div style={{ color: "rgba(255,255,255,.3)", fontSize: ".67rem", textAlign: "center", padding: "2rem .5rem" }}>No recorded formal decisions yet.</div>}</div>}
      {section === "documents" && <div style={{ display: "flex", flexDirection: "column", gap: ".45rem" }}>{readableDocs.length ? readableDocs.map((report) => <div key={report.id} style={{ ...panel, padding: ".65rem" }}><div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}><span aria-hidden="true">📄</span><strong style={{ flex: 1, fontSize: ".65rem" }}>{report.title}</strong>{report.dateline && <span style={{ fontSize: ".52rem", color: "rgba(255,255,255,.3)" }}>{report.dateline}</span>}</div><div style={{ marginTop: ".3rem", fontSize: ".58rem", color: "rgba(255,255,255,.45)" }}>{report.from ? `From ${report.from} · ` : ""}{report.visibleTo === null ? "published" : report.visibleTo?.some((name) => lower(name) === lower(playerCountry)) ? "held by your government" : "intercepted copy"}</div><div style={{ marginTop: ".35rem", fontSize: ".61rem", lineHeight: 1.45, color: "rgba(255,255,255,.6)", whiteSpace: "pre-wrap" }}>{report.body}</div></div>) : <div style={{ color: "rgba(255,255,255,.3)", fontSize: ".67rem", textAlign: "center", padding: "2rem .5rem" }}>No institution-related documents currently readable by your government.</div>}</div>}
      {section === "council" && <div style={{ ...panel, padding: ".8rem" }}><strong style={{ fontSize: ".68rem" }}>Council channel</strong><p style={{ margin: ".4rem 0 .65rem", fontSize: ".62rem", lineHeight: 1.5, color: "rgba(255,255,255,.5)" }}>{selectedRow.member ? "Uses Beta's current one-request group diplomacy, cross-chat knowledge, GM reminders and the native institution_* action contract. Conversation is never legal authority by itself." : "Only participating governments receive a persistent institutional council channel. This public view does not create one."}</p>{selectedRow.member && <button disabled={Boolean(busy)} onClick={openCouncil} style={{ border: "1px solid rgba(167,139,250,.28)", borderRadius: 9, background: "rgba(139,92,246,.13)", color: "#ede9fe", cursor: busy ? "wait" : "pointer", padding: ".45rem .65rem", fontSize: ".64rem", fontWeight: 760 }}>{busy === "council" ? "Opening…" : "Open council channel"}</button>}</div>}
    </div>
  </div>;
}
