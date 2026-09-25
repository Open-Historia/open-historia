import React, { useEffect, useMemo, useState } from "react";
import { institutionLogoUrl } from "../../runtime/institutionLogos.js";
import { INSTITUTION_KINDS } from "../../runtime/institutions.js";
import { commitInstitutionLifecycleCommand, ensureInstitutionLifecycleNegotiationChat, institutionLifecycleCasesForPolity } from "../../runtime/institutionLifecycle.js";
import { collectActiveScenarioPolityKeys } from "../../runtime/scenarioPolities.js";
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
import { isTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { institutionMembershipDisplayLabel } from "./institutionMembershipPresentation.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const splitList = (value) => [...new Set(String(value ?? "").split(/[\n,;]+/).map(clean).filter(Boolean))];
const humanize = (value) => clean(value).replace(/[-_]+/g, " ");

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
  return <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${border}`, background: bg, color, borderRadius: "999px", padding: ".16rem .46rem", fontSize: ".65rem", fontWeight: 750, lineHeight: 1.2 }}>{children}</span>;
};

export const Emblem = ({ institution, size = 42 }) => {
  const [failed, setFailed] = useState(false);
  const url = institutionLogoUrl(institution);
  const raw = clean(institution?.shortName || institution?.name || institution?.id || "IN");
  const mark = raw.length <= 6 ? raw.toUpperCase() : raw.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 5).toUpperCase();
  return <div style={{ width: size, height: size, flex: "0 0 auto", borderRadius: 11, display: "grid", placeItems: "center", overflow: "hidden", padding: url && !failed ? 4 : 0, background: "linear-gradient(145deg,rgba(139,92,246,.25),rgba(59,130,246,.09))", border: "1px solid rgba(167,139,250,.28)" }} title={institution?.name || institution?.id || "Institution"}>
    {url && !failed ? <img src={url} alt="" aria-hidden="true" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 7 }} /> : <span style={{ fontSize: ".64rem", fontWeight: 850, color: "#ede9fe" }}>{mark || "IN"}</span>}
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
  return <button className="oh-tap-row" type="button" onClick={onClick} style={{ ...panel, width: "100%", display: "flex", gap: ".7rem", alignItems: "center", textAlign: "left", padding: ".7rem", cursor: "pointer", color: "white", borderColor: selected ? "rgba(167,139,250,.42)" : "rgba(255,255,255,.08)", background: selected ? "rgba(139,92,246,.09)" : "rgba(255,255,255,.03)" }}>
    <Emblem institution={institution} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
        <strong style={{ fontSize: ".8rem", lineHeight: 1.25, overflowWrap: "anywhere" }}>{institution.name || institution.id}</strong>
        {pending > 0 && <SmallPill tone="live">{pending} action{pending === 1 ? "" : "s"}</SmallPill>}
        {unread && <SmallPill tone="purple">new</SmallPill>}
      </div>
      <div style={{ marginTop: ".18rem", fontSize: ".62rem", color: "rgba(255,255,255,.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {row.member ? `${institutionMembershipDisplayLabel(row.member)} · ${row.canParticipate ? "participating" : "read-only"}` : "world institution · public overview"}
        {row.openBallotCount ? ` · ${row.openBallotCount} open ballot${row.openBallotCount === 1 ? "" : "s"}` : ""}
      </div>
    </div>
    <span style={{ color: "rgba(255,255,255,.28)" }}>›</span>
  </button>;
};

export const Facts = ({ view }) => {
  const rule = view?.charterView?.defaultRule?.label || "unspecified";
  const items = [
    ["Members", `${view?.memberSummary?.active || 0}/${view?.memberSummary?.total || 0}`],
    ["Your role", view?.member ? institutionMembershipDisplayLabel(view.member) : "not a member"],
    ["Decision rule", rule],
  ];
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: ".45rem" }}>
    {items.map(([label, value]) => <div key={label} style={{ ...panel, padding: ".62rem .72rem", background: "rgba(20,20,24,.72)" }}><div style={{ fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".065em", color: "rgba(255,255,255,.4)" }}>{label}</div><div style={{ marginTop: ".18rem", fontSize: ".76rem", fontWeight: 740, color: "rgba(255,255,255,.88)", textTransform: label === "Your role" ? "capitalize" : "none" }}>{value}</div></div>)}
  </div>;
};


const ballotTone = (choice) => {
  const key = lower(choice);
  if (key === "yes") return "good";
  if (key === "no" || key === "veto") return "bad";
  return "neutral";
};

const DecisionCard = ({ proposal }) => {
  const [positionsOpen, setPositionsOpen] = useState(false);
  const ballots = list(proposal?.closedBallots);
  const fallbackCount = (choice) => ballots.filter((ballot) => lower(ballot?.choice) === choice).length;
  const tally = {
    yes: Number.isFinite(Number(proposal?.outcome?.yes)) ? Number(proposal.outcome.yes) : fallbackCount("yes"),
    no: Number.isFinite(Number(proposal?.outcome?.no)) ? Number(proposal.outcome.no) : fallbackCount("no"),
    abstain: Number.isFinite(Number(proposal?.outcome?.abstain)) ? Number(proposal.outcome.abstain) : fallbackCount("abstain"),
    veto: Number.isFinite(Number(proposal?.outcome?.veto)) ? Number(proposal.outcome.veto) : fallbackCount("veto"),
  };
  const statusGood = ["passed", "implementation"].includes(proposal.status);
  const meta = [proposal.lastUpdatedDate, proposal.ruleLabel, proposal.ballotsRecorded ? `${proposal.ballotsRecorded} ballots recorded` : ""].filter(Boolean);

  return <div data-institution-decision-card="formal" style={{ ...panel, padding: ".8rem", background: "rgba(255,255,255,.026)" }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: ".6rem" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: ".59rem", fontWeight: 850, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(196,181,253,.72)" }}>Formal decision</div>
        <strong style={{ display: "block", marginTop: ".2rem", fontSize: ".73rem", lineHeight: 1.35 }}>{proposal.title}</strong>
        {meta.length > 0 && <div style={{ marginTop: ".25rem", fontSize: ".6rem", color: "rgba(255,255,255,.35)" }}>{meta.join(" · ")}</div>}
      </div>
      <SmallPill tone={statusGood ? "good" : "bad"}>{proposal.status}</SmallPill>
    </div>

    {proposal.summary && <div style={{ marginTop: ".55rem", fontSize: ".65rem", lineHeight: 1.5, color: "rgba(255,255,255,.62)" }}>{proposal.summary}</div>}
    {proposal.outcome?.reason && proposal.outcome.reason !== proposal.summary && <div style={{ marginTop: ".42rem", fontSize: ".62rem", lineHeight: 1.45, color: "rgba(255,255,255,.45)" }}>{proposal.outcome.reason}</div>}

    <div data-institution-decision-tally="true" style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".65rem" }}>
      {[["yes", "For"], ["no", "Against"], ["abstain", "Abstain"], ["veto", "Veto"]].filter(([choice]) => choice !== "veto" || tally.veto > 0).map(([choice, label]) => <div key={choice} style={{ minWidth: "4.2rem", border: "1px solid rgba(255,255,255,.07)", borderRadius: 9, background: "rgba(255,255,255,.035)", padding: ".48rem .58rem" }}>
        <div style={{ fontSize: ".78rem", fontWeight: 820, color: choice === "yes" ? "#dcfce7" : choice === "no" || choice === "veto" ? "#fecaca" : "rgba(255,255,255,.8)" }}>{tally[choice]}</div>
        <div style={{ marginTop: ".08rem", fontSize: ".58rem", textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.35)" }}>{label}</div>
      </div>)}
    </div>

    {ballots.length > 0 && <div style={{ marginTop: ".65rem", paddingTop: ".5rem", borderTop: "1px solid rgba(255,255,255,.06)" }}>
      <button className="oh-tap-row" type="button" onClick={() => setPositionsOpen((open) => !open)} aria-expanded={positionsOpen} data-institution-recorded-positions-toggle="true" style={{ display: "inline-flex", alignItems: "center", gap: ".35rem", border: 0, background: "transparent", color: "#c4b5fd", padding: 0, cursor: "pointer", fontSize: ".62rem", fontWeight: 760 }}>        <span>{positionsOpen ? "Hide" : "View"} recorded member positions</span>
        <SmallPill tone="purple">{ballots.length}</SmallPill>
        <span aria-hidden="true" style={{ transform: positionsOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease", color: "rgba(255,255,255,.4)" }}>⌄</span>
      </button>

      {positionsOpen && <div data-institution-recorded-positions="expanded" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(18rem,1fr))", gap: ".45rem", marginTop: ".55rem" }}>
        {ballots.map((ballot, index) => <div key={`${ballot.polity || "ballot"}-${index}`} style={{ border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, background: "rgba(0,0,0,.12)", padding: ".58rem .65rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <strong style={{ flex: 1, minWidth: 0, fontSize: ".65rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ballot.polity}</strong>
            <SmallPill tone={ballotTone(ballot.choice)}>{ballot.choice}</SmallPill>
          </div>
          {ballot.government && <div style={{ marginTop: ".16rem", fontSize: ".58rem", color: "rgba(255,255,255,.3)" }}>{ballot.government}</div>}
          <div style={{ marginTop: ".38rem", fontSize: ".62rem", lineHeight: 1.45, color: ballot.reason ? "rgba(255,255,255,.62)" : "rgba(255,255,255,.3)", fontStyle: ballot.reason ? "normal" : "italic" }}>{ballot.reason || "No recorded public rationale."}</div>
          {ballot.date && <div style={{ marginTop: ".32rem", fontSize: ".58rem", color: "rgba(255,255,255,.25)" }}>{ballot.date}</div>}
        </div>)}
      </div>}
    </div>}
  </div>;
};

const ProposalCard = ({ proposal, view, busy, onVote, onSubmit, onAmend, onResolveAmendment }) => {
  const [amendText, setAmendText] = useState("");
  const [voteComment, setVoteComment] = useState("");
  const needsVote = proposal.status === "voting" && proposal.playerEligible && !proposal.playerBallot;
  const statusTone = needsVote ? "live" : ["passed", "implementation"].includes(proposal.status) ? "good" : ["failed", "vetoed"].includes(proposal.status) ? "bad" : "purple";
  return <div style={{ ...panel, padding: ".72rem", borderColor: needsVote ? "rgba(245,158,11,.32)" : "rgba(167,139,250,.14)", background: needsVote ? "linear-gradient(180deg,rgba(245,158,11,.07),rgba(139,92,246,.035))" : "rgba(139,92,246,.045)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
      <strong style={{ flex: 1, minWidth: 0, fontSize: ".74rem" }}>{proposal.title}</strong>
      {needsVote && <SmallPill tone="live">Your vote</SmallPill>}
      <SmallPill tone={statusTone}>{proposal.status}</SmallPill>
    </div>
    {proposal.summary && <div style={{ marginTop: ".35rem", fontSize: ".65rem", lineHeight: 1.45, color: "rgba(255,255,255,.55)" }}>{proposal.summary}</div>}
    <div style={{ marginTop: ".35rem", fontSize: ".61rem", color: "rgba(255,255,255,.32)" }}>{proposal.createdBy ? `Submitted by ${proposal.createdBy}` : "Formal matter"}{proposal.ruleLabel ? ` · ${proposal.ruleLabel}` : ""}{proposal.status === "voting" ? ` · ${proposal.ballotsRecorded}/${proposal.eligibleVoters} ballots` : ""}</div>
    {proposal.playerBallot && <div style={{ marginTop: ".4rem" }}><SmallPill tone="neutral">You voted {proposal.playerBallot.choice}</SmallPill></div>}
    {needsVote && <div style={{ display: "flex", gap: ".35rem", marginTop: ".55rem", flexWrap: "wrap" }}>
      {["yes", "no", "abstain", ...(proposal.playerCanVeto ? ["veto"] : [])].map((choice) => <button className="oh-tap-row" key={choice} disabled={busy} onClick={() => onVote(proposal.id, choice)} style={{ border: "1px solid rgba(167,139,250,.24)", borderRadius: 8, background: "rgba(139,92,246,.1)", color: "#ede9fe", cursor: busy ? "wait" : "pointer", padding: ".3rem .5rem", fontSize: ".64rem", fontWeight: 700, textTransform: "capitalize" }}>{choice}</button>)}
    </div>}
    {proposal.playerCanSubmitForVote && view?.canParticipate && <div data-institution-call-vote="true" style={{ marginTop: ".58rem", display: "flex", gap: ".4rem", alignItems: "stretch", flexWrap: "wrap" }}>
      <input value={voteComment} onChange={(e) => setVoteComment(e.target.value)} placeholder="Closing comment before the vote (optional)" maxLength={1200} style={{ ...fieldStyle, flex: "1 1 18rem", minWidth: "12rem" }} />
      <button className="oh-tap-row" disabled={busy} onClick={async () => { const ok = await onSubmit(proposal.id, voteComment.trim()); if (ok) setVoteComment(""); }} style={{ border: "1px solid rgba(245,158,11,.28)", borderRadius: 8, background: "rgba(245,158,11,.1)", color: "#fde68a", cursor: busy ? "wait" : "pointer", padding: ".4rem .62rem", fontSize: ".64rem", fontWeight: 780 }}>Call vote</button>    </div>}
    {proposal.amendmentItems?.length ? <div style={{ marginTop: ".55rem", display: "flex", flexDirection: "column", gap: ".35rem" }}>
      {proposal.amendmentItems.map((amendment) => <div key={amendment.id} style={{ borderLeft: "2px solid rgba(167,139,250,.35)", paddingLeft: ".45rem" }}>
        <div style={{ fontSize: ".64rem", color: "rgba(255,255,255,.68)" }}>{amendment.text}</div>
        <div style={{ marginTop: ".18rem", display: "flex", gap: ".3rem", alignItems: "center" }}><SmallPill tone={amendment.status === "accepted" ? "good" : amendment.status === "rejected" ? "bad" : "neutral"}>{amendment.status}</SmallPill><span style={{ fontSize: ".59rem", color: "rgba(255,255,255,.3)" }}>{amendment.proposedBy ? `by ${amendment.proposedBy}` : ""}</span></div>
        {amendment.status === "proposed" && (amendment.playerCanResolve || amendment.playerCanWithdraw) && <div style={{ display: "flex", gap: ".3rem", marginTop: ".3rem" }}>
          {amendment.playerCanResolve && ["accepted", "rejected"].map((status) => <button className="oh-tap-row" key={status} disabled={busy} onClick={() => onResolveAmendment(proposal.id, amendment.id, status)} style={{ border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", color: status === "accepted" ? "#86efac" : "#fca5a5", borderRadius: 7, padding: ".2rem .35rem", fontSize: ".6rem", cursor: busy ? "wait" : "pointer" }}>{status === "accepted" ? "Accept" : "Reject"}</button>)}
          {amendment.playerCanWithdraw && <button className="oh-tap-row" disabled={busy} onClick={() => onResolveAmendment(proposal.id, amendment.id, "withdrawn")} style={{ border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.6)", borderRadius: 7, padding: ".2rem .35rem", fontSize: ".6rem", cursor: busy ? "wait" : "pointer" }}>Withdraw</button>}        </div>}
      </div>)}
    </div> : null}
    {proposal.playerCanAmend && view?.canParticipate && <div style={{ marginTop: ".55rem", display: "flex", gap: ".35rem" }}>
      <input value={amendText} onChange={(e) => setAmendText(e.target.value)} placeholder="Propose amendment…" maxLength={4000} style={{ flex: 1, minWidth: 0, border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "rgba(0,0,0,.18)", color: "white", padding: ".35rem .45rem", fontSize: ".64rem" }} />
      <button disabled={busy || !amendText.trim()} onClick={async () => { await onAmend(proposal.id, amendText.trim()); setAmendText(""); }} style={{ border: "1px solid rgba(167,139,250,.22)", background: "rgba(139,92,246,.1)", color: "#ddd6fe", borderRadius: 8, padding: ".3rem .45rem", fontSize: ".61rem", cursor: busy || !amendText.trim() ? "not-allowed" : "pointer" }}>Add</button>    </div>}
  </div>;
};


const fieldStyle = {
  width: "100%", boxSizing: "border-box", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8,
  background: "rgba(0,0,0,.2)", color: "white", padding: ".48rem .56rem", fontSize: ".68rem", fontFamily: "inherit",
};

const LifecycleCaseCard = ({ entry, institutionName = "", canRespond = false, canOpenNegotiation = false, busy = false, opening = false, onRespond = null, onOpenNegotiation = null }) => {
  const kind = humanize(entry?.kind || "membership case");
  const status = humanize(entry?.status || "pending");
  const tone = ["accepted", "resolved"].includes(lower(entry?.status)) ? "good"
    : ["rejected", "expired"].includes(lower(entry?.status)) ? "bad"
      : ["pending", "pending-approval", "negotiating"].includes(lower(entry?.status)) ? "live" : "neutral";
  return <div data-institution-lifecycle-case={clean(entry?.id)} style={{ ...panel, padding: ".6rem .65rem", background: "rgba(139,92,246,.035)" }}>
    <div style={{ display: "flex", gap: ".45rem", alignItems: "center" }}>
      <strong style={{ flex: 1, minWidth: 0, fontSize: ".63rem", textTransform: "capitalize" }}>{kind}</strong>
      <SmallPill tone={tone}>{status}</SmallPill>
    </div>
    <div style={{ marginTop: ".28rem", fontSize: ".61rem", color: "rgba(255,255,255,.48)", lineHeight: 1.45 }}>
      {entry?.polity ? `${entry.polity}${entry.requestedStatus ? ` · ${humanize(entry.requestedStatus)}` : ""}` : institutionName}
      {entry?.initiatedBy ? ` · initiated by ${entry.initiatedBy}` : ""}
      {entry?.effectiveDate ? ` · effective ${entry.effectiveDate}` : ""}
    </div>
    {entry?.reason && <div style={{ marginTop: ".34rem", fontSize: ".62rem", lineHeight: 1.45, color: "rgba(255,255,255,.58)" }}>{entry.reason}</div>}
    {entry?.terms && <div style={{ marginTop: ".28rem", fontSize: ".6rem", lineHeight: 1.4, color: "rgba(196,181,253,.62)" }}>Terms: {entry.terms}</div>}
    {canOpenNegotiation && <div data-foreign-lifecycle-negotiation-controls="true" style={{ display: "flex", justifyContent: "flex-end", marginTop: ".5rem", paddingTop: ".45rem", borderTop: "1px solid rgba(255,255,255,.06)" }}>
      <button className="oh-tap-row" disabled={busy} onClick={() => onOpenNegotiation?.()} style={{ border: "1px solid rgba(167,139,250,.24)", borderRadius: 7, background: "rgba(139,92,246,.09)", color: "#ddd6fe", padding: ".28rem .46rem", fontSize: ".6rem", fontWeight: 760, cursor: busy ? "wait" : "pointer" }}>{opening ? "Opening…" : "Open negotiation →"}</button>    </div>}
    {canRespond && <div data-player-lifecycle-response-controls="true" style={{ display: "flex", flexWrap: "wrap", gap: ".3rem", marginTop: ".5rem", paddingTop: ".45rem", borderTop: "1px solid rgba(255,255,255,.06)" }}>
      <button className="oh-tap-row" disabled={busy} onClick={() => onRespond?.("accept")} style={{ border: "1px solid rgba(34,197,94,.24)", borderRadius: 7, background: "rgba(34,197,94,.08)", color: "#bbf7d0", padding: ".26rem .42rem", fontSize: ".6rem", fontWeight: 760, cursor: busy ? "wait" : "pointer" }}>Accept</button>
      <button className="oh-tap-row" disabled={busy} onClick={() => onRespond?.("seek-observer")} style={{ border: "1px solid rgba(167,139,250,.22)", borderRadius: 7, background: "rgba(139,92,246,.08)", color: "#ddd6fe", padding: ".26rem .42rem", fontSize: ".6rem", cursor: busy ? "wait" : "pointer" }}>Seek observer status</button>
      <button className="oh-tap-row" disabled={busy} onClick={() => onRespond?.("delay")} style={{ border: "1px solid rgba(245,158,11,.2)", borderRadius: 7, background: "rgba(245,158,11,.06)", color: "#fde68a", padding: ".26rem .42rem", fontSize: ".6rem", cursor: busy ? "wait" : "pointer" }}>Decide later</button>
      <button className="oh-tap-row" disabled={busy} onClick={() => onRespond?.("reject")} style={{ border: "1px solid rgba(239,68,68,.2)", borderRadius: 7, background: "rgba(239,68,68,.06)", color: "#fca5a5", padding: ".26rem .42rem", fontSize: ".6rem", cursor: busy ? "wait" : "pointer" }}>Reject</button>    </div>}
  </div>;
};

const LifecycleRuleRow = ({ label, rule }) => <div style={{ ...panel, padding: ".58rem .65rem", display: "flex", alignItems: "center", gap: ".55rem" }}>
  <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{ fontSize: ".62rem", fontWeight: 760 }}>{label}</div>
    {rule?.note && <div style={{ marginTop: ".16rem", fontSize: ".59rem", color: "rgba(255,255,255,.35)" }}>{rule.note}</div>}
  </div>
  <SmallPill tone="purple">{humanize(rule?.mode || "approval")}</SmallPill>
  {Number(rule?.noticeDays) > 0 && <span style={{ fontSize: ".59rem", color: "rgba(255,255,255,.36)" }}>{rule.noticeDays}d notice</span>}
</div>;

const PolityMultiPicker = ({ value = "", onChange, polities = [], label = "Select governments", multiple = true }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => multiple ? splitList(value) : [clean(value)].filter(Boolean), [value, multiple]);
  const selectedKeys = useMemo(() => new Set(selected.map(lower)), [selected]);
  const normalizedQuery = lower(query);
  const matches = useMemo(() => polities
    .filter((polity) => !selectedKeys.has(lower(polity)))
    .filter((polity) => !normalizedQuery || lower(polity).includes(normalizedQuery))
    .sort((a, b) => {
      const aStarts = normalizedQuery && lower(a).startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = normalizedQuery && lower(b).startsWith(normalizedQuery) ? 0 : 1;
      return aStarts - bStarts || clean(a).localeCompare(clean(b));
    })
    .slice(0, 8), [polities, selectedKeys, normalizedQuery]);

  const commitSelected = (next) => onChange?.(multiple ? next.join("; ") : clean(next[0] || ""));
  const choose = (polity) => {
    const exact = clean(polity);
    if (!exact || selectedKeys.has(lower(exact))) return;
    commitSelected(multiple ? [...selected, exact] : [exact]);
    setQuery("");
    setOpen(multiple);
  };
  const remove = (polity) => commitSelected(selected.filter((entry) => lower(entry) !== lower(polity)));
  const chooseFirst = () => {
    const exact = polities.find((polity) => lower(polity) === normalizedQuery);
    const candidate = exact || matches[0];
    if (candidate) choose(candidate);
  };

  return <div data-polity-multi-picker="true" style={{ position: "relative" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: ".3rem", minHeight: "2.15rem", alignItems: "center", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "rgba(8,8,12,.72)", padding: ".28rem .36rem" }}>
      {selected.map((polity) => <span key={polity} data-selected-polity={polity} style={{ display: "inline-flex", alignItems: "center", gap: ".28rem", maxWidth: "15rem", border: "1px solid rgba(167,139,250,.25)", borderRadius: 999, background: "rgba(139,92,246,.12)", color: "#ede9fe", padding: ".22rem .38rem .22rem .46rem", fontSize: ".6rem", fontWeight: 720 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{polity}</span>
        <button className="oh-tap" type="button" aria-label={`Remove ${polity}`} onClick={() => remove(polity)} style={{ border: 0, background: "transparent", color: "rgba(255,255,255,.5)", padding: 0, cursor: "pointer", fontSize: ".7rem", lineHeight: 1 }}>×</button>
      </span>)}
      <input
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); chooseFirst(); }
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Backspace" && !query && selected.length) remove(selected[selected.length - 1]);
        }}
        placeholder={selected.length ? (multiple ? "Add another government…" : "Change government…") : label}
        style={{ flex: "1 1 12rem", minWidth: "9rem", border: 0, outline: 0, background: "transparent", color: "rgba(255,255,255,.86)", padding: ".2rem .22rem", fontSize: ".64rem" }}
      />
    </div>
    {open && matches.length > 0 && <div data-polity-picker-results="true" style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "calc(100% + .28rem)", maxHeight: "12.5rem", overflowY: "auto", border: "1px solid rgba(167,139,250,.2)", borderRadius: 9, background: "rgba(20,20,25,.985)", boxShadow: "0 12px 30px rgba(0,0,0,.35)", padding: ".28rem" }}>
      {matches.map((polity) => <button className="oh-tap-row" key={polity} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(polity)} style={{ width: "100%", display: "flex", alignItems: "center", gap: ".45rem", border: 0, borderRadius: 7, background: "transparent", color: "rgba(255,255,255,.82)", padding: ".42rem .48rem", textAlign: "left", cursor: "pointer", fontSize: ".62rem" }} onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(139,92,246,.12)"; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}>        <span style={{ width: ".42rem", height: ".42rem", borderRadius: 999, background: "rgba(167,139,250,.7)", flex: "0 0 auto" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{polity}</span>
      </button>)}
    </div>}
    {open && query && matches.length === 0 && <div style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "calc(100% + .28rem)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 9, background: "rgba(20,20,25,.985)", color: "rgba(255,255,255,.38)", padding: ".55rem .6rem", fontSize: ".6rem" }}>No canonical polity matches “{query}”.</div>}
  </div>;
};

const FoundInstitutionForm = ({ value, onChange, onCancel, onSubmit, busy, polities = [] }) => {
  const [advanced, setAdvanced] = useState(false);
  const set = (key, next) => onChange({ ...value, [key]: next });
  // One column on a phone, where two left each field a few letters wide.
  const isMobile = useIsMobile();
  const labelStyle = { fontSize: ".66rem", color: "rgba(255,255,255,.58)", fontWeight: 650 };
  const sectionLabelStyle = { fontSize: ".62rem", fontWeight: 850, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(196,181,253,.68)" };

  return <div data-institution-founding-wizard="true" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "1rem 1.15rem 1.2rem" }}>
    <div style={{ maxWidth: "50rem", margin: "0 auto", display: "flex", flexDirection: "column", gap: ".85rem" }}>      <div>
        <div style={{ fontSize: ".64rem", fontWeight: 850, letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(196,181,253,.72)" }}>Found an institution</div>
        <div style={{ marginTop: ".2rem", fontSize: "1rem", fontWeight: 820 }}>Create the institution first. Let diplomacy decide who joins it.</div>
        <div style={{ marginTop: ".3rem", maxWidth: "44rem", fontSize: ".7rem", lineHeight: 1.55, color: "rgba(255,255,255,.5)" }}>Foreign governments are invited, never auto-enrolled. Their decisions use the current Political World, relations, strategic fit and the institution's actual purpose. The simple form uses sensible charter defaults; advanced settings remain fully editable.</div>
      </div>

      <div style={{ ...panel, padding: ".9rem", display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: ".75rem" }}>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Name<input autoFocus={!isTouchPrimary()} value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="Baltic Union" maxLength={160} style={{ ...fieldStyle, marginTop: ".28rem", fontSize: ".72rem", padding: ".52rem .62rem" }} /></label>
        <label style={labelStyle}>Type<select value={value.kind} onChange={(e) => set("kind", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem", fontSize: ".7rem", padding: ".5rem .58rem" }}>{INSTITUTION_KINDS.map((kind) => <option key={kind} value={kind}>{humanize(kind)}</option>)}</select></label>
        <div style={{ display: "flex", alignItems: "end", justifyContent: "flex-end" }}><button className="oh-tap-row" type="button" onClick={() => setAdvanced((open) => !open)} style={{ border: "1px solid rgba(167,139,250,.22)", borderRadius: 8, background: advanced ? "rgba(139,92,246,.12)" : "rgba(255,255,255,.035)", color: advanced ? "#ede9fe" : "rgba(255,255,255,.68)", padding: ".48rem .7rem", fontSize: ".64rem", fontWeight: 760, cursor: "pointer" }}>{advanced ? "Hide advanced settings" : "Advanced settings"}</button></div>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Purpose<textarea value={value.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="What is this institution for?" rows={3} maxLength={1600} style={{ ...fieldStyle, marginTop: ".28rem", resize: "vertical", fontSize: ".7rem", lineHeight: 1.5 }} /></label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Invite founding governments<div style={{ marginTop: ".28rem" }}><PolityMultiPicker value={value.invitees} onChange={(next) => set("invitees", next)} polities={polities} label="Search governments…" /></div></label>

        {advanced && <>
          <div style={{ gridColumn: "1 / -1", marginTop: ".05rem", paddingTop: ".7rem", borderTop: "1px solid rgba(255,255,255,.07)" }}><div style={sectionLabelStyle}>Advanced identity & governance</div></div>
          <label style={labelStyle}>Short name<input value={value.shortName} onChange={(e) => set("shortName", e.target.value)} placeholder="BU" maxLength={24} style={{ ...fieldStyle, marginTop: ".28rem" }} /></label>
          <label style={labelStyle}>Decision rule<select value={value.votingRule} onChange={(e) => set("votingRule", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem" }}><option value="simple-majority">Simple majority</option><option value="qualified-majority">Qualified majority</option><option value="unanimity">Unanimity</option></select></label>
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Political character<input value={value.politicalCharacter} onChange={(e) => set("politicalCharacter", e.target.value)} placeholder="Regional political and security integration" maxLength={500} style={{ ...fieldStyle, marginTop: ".28rem" }} /></label>
          <label style={labelStyle}>Geographic scope<input value={value.geographicScope} onChange={(e) => set("geographicScope", e.target.value)} placeholder="Baltic States" maxLength={800} style={{ ...fieldStyle, marginTop: ".28rem" }} /></label>
          <label style={labelStyle}>Primary threat / adversary model<input value={value.primaryThreatModel} onChange={(e) => set("primaryThreatModel", e.target.value)} placeholder="Optional" maxLength={800} style={{ ...fieldStyle, marginTop: ".28rem" }} /></label>
          <label style={labelStyle}>Minimum founding members<input type="number" min="1" max="64" value={value.minimumFoundingMembers} onChange={(e) => set("minimumFoundingMembers", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem" }} /></label>
          <div />

          <div style={{ gridColumn: "1 / -1", marginTop: ".05rem", paddingTop: ".7rem", borderTop: "1px solid rgba(255,255,255,.07)" }}>
            <div style={sectionLabelStyle}>Membership constitution</div>
            <div style={{ marginTop: ".2rem", fontSize: ".62rem", lineHeight: 1.45, color: "rgba(255,255,255,.36)" }}>These rules become canonical charter law. Diplomacy may negotiate within them, but neither chat nor the AI can bypass them.</div>
          </div>
          <label style={labelStyle}>Accession<select value={value.accessionMode} onChange={(e) => set("accessionMode", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem" }}><option value="approval">Member vote required</option><option value="direct">Direct after acceptance</option></select></label>
          <label style={labelStyle}>Observer status<select value={value.allowObserver ? "yes" : "no"} onChange={(e) => set("allowObserver", e.target.value === "yes")} style={{ ...fieldStyle, marginTop: ".28rem" }}><option value="yes">Allowed</option><option value="no">Not allowed</option></select></label>
          <label style={labelStyle}>Withdrawal<select value={value.withdrawalMode} onChange={(e) => set("withdrawalMode", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem" }}><option value="unilateral">Unilateral</option><option value="notice">Notice required</option><option value="approval">Institution approval required</option><option value="not-permitted">Not permitted</option></select></label>
          <label style={labelStyle}>Withdrawal notice<input type="number" min="0" max="3650" disabled={value.withdrawalMode !== "notice"} value={value.withdrawalNoticeDays} onChange={(e) => set("withdrawalNoticeDays", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem", opacity: value.withdrawalMode === "notice" ? 1 : .45 }} /></label>
          <label style={labelStyle}>Expulsion<select value={value.expulsionMode} onChange={(e) => set("expulsionMode", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem" }}><option value="approval">Formal vote permitted</option><option value="not-permitted">Not permitted</option></select></label>
          <label style={labelStyle}>Dissolution<select value={value.dissolutionMode} onChange={(e) => set("dissolutionMode", e.target.value)} style={{ ...fieldStyle, marginTop: ".28rem" }}><option value="approval">Formal vote permitted</option><option value="not-permitted">Not permitted</option></select></label>
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Founding charter note<textarea value={value.charterNote} onChange={(e) => set("charterNote", e.target.value)} placeholder="Optional public founding principles or special terms" rows={2} maxLength={1200} style={{ ...fieldStyle, marginTop: ".28rem", resize: "vertical" }} /></label>
        </>}      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: ".62rem", color: "rgba(255,255,255,.34)" }}>{advanced ? "Advanced charter settings are visible." : "Simple mode uses the charter defaults shown under Advanced settings."}</span>
        <div style={{ display: "flex", gap: ".45rem" }}>
          <button className="oh-tap-row" type="button" disabled={busy} onClick={onCancel} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "rgba(255,255,255,.035)", color: "rgba(255,255,255,.65)", padding: ".46rem .75rem", fontSize: ".66rem", cursor: busy ? "wait" : "pointer" }}>Cancel</button>
          <button className="oh-tap-row" type="button" disabled={busy || !clean(value.name)} onClick={onSubmit} style={{ border: "1px solid rgba(167,139,250,.32)", borderRadius: 8, background: "rgba(139,92,246,.16)", color: "#ede9fe", padding: ".46rem .8rem", fontSize: ".66rem", fontWeight: 780, cursor: busy || !clean(value.name) ? "not-allowed" : "pointer" }}>{busy ? "Founding…" : "Found institution"}</button>
        </div>      </div>
    </div>
  </div>;
};

export default function InstitutionsWorkspace({ panelOpen = true, world = {}, playerCountry = "", gameDate = "", chats = [], unreadIds = new Set(), onAdoptResult, onOpenCouncil, onOpenLifecycleChat, onRequestCouncilTurn, councilAutomation = [], onCouncilVisibleChange, renderCouncil, focusRequest = null }) {  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [section, setSection] = useState("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalSummary, setProposalSummary] = useState("");
  const [foundingOpen, setFoundingOpen] = useState(false);
  // On a phone, Back leaves the founding form, then goes from an institution
  // back to the list (runtime/backToClose.js). Only while the diplomacy panel
  // shows: closed, it keeps this workspace, and what it had open, mounted.
  useBackToClose(panelOpen && Boolean(selectedId), () => { setSelectedId(""); setError(""); });
  useBackToClose(panelOpen && foundingOpen, () => setFoundingOpen(false));
  const [founding, setFounding] = useState({
    name: "", shortName: "", kind: "security_alliance", purpose: "", politicalCharacter: "",
    geographicScope: "", primaryThreatModel: "", votingRule: "simple-majority",
    minimumFoundingMembers: "2", accessionMode: "approval", allowObserver: true,
    withdrawalMode: "unilateral", withdrawalNoticeDays: "0", expulsionMode: "approval", dissolutionMode: "approval",
    invitees: "", charterNote: "",
  });
  const [inviteTarget, setInviteTarget] = useState("");
  const [inviteStatus, setInviteStatus] = useState("member");
  const [inviteReason, setInviteReason] = useState("");
  const [applicationReason, setApplicationReason] = useState("");
  const [lifecycleReason, setLifecycleReason] = useState("");

  useEffect(() => {
    const institutionId = clean(focusRequest?.institutionId);
    if (!institutionId) return;
    setSelectedId(institutionId);
    const requestedSection = clean(focusRequest?.section);
    if (requestedSection) setSection(requestedSection);
    setError("");
  }, [focusRequest?.institutionId, focusRequest?.section, focusRequest?.nonce]);

  const memberRows = useMemo(() => sortRows(listInstitutionDiplomacyViews(world, playerCountry)), [world, playerCountry]);
  const allRows = useMemo(() => listAllInstitutionDiplomacyViews(world, playerCountry), [world, playerCountry]);
  const playerLifecycleCases = useMemo(() => institutionLifecycleCasesForPolity(world, playerCountry, { pendingOnly: true }), [world, playerCountry]);
  const pendingInstitutionIds = useMemo(() => new Set(playerLifecycleCases.map((entry) => clean(entry?.institution?.id)).filter(Boolean)), [playerLifecycleCases]);
  const personalRows = useMemo(() => sortRows([
    ...memberRows,
    ...allRows.filter((row) => !row.member && pendingInstitutionIds.has(clean(row?.institution?.id))),
  ].filter((row, index, rows) => rows.findIndex((candidate) => clean(candidate?.institution?.id) === clean(row?.institution?.id)) === index)), [memberRows, allRows, pendingInstitutionIds]);
  const rows = showAll ? allRows : personalRows;
  const allPolities = useMemo(() => collectActiveScenarioPolityKeys(world).filter((name) => lower(name) !== lower(playerCountry)), [world, playerCountry]);
  const channelByInstitution = useMemo(() => new Map(list(chats)
    .filter((chat) => chat?.institutionId && !(chat?.lifecycleInstitutionId && list(chat?.lifecycleCaseIds).length))
    .map((chat) => [clean(chat.institutionId), chat])), [chats]);
  const selectedRow = (selectedId ? allRows.find((row) => clean(row?.institution?.id) === clean(selectedId)) : null) || null;
  const selectedView = useMemo(() => {
    if (!selectedRow?.institution?.id) return null;
    return selectedRow.member
      ? buildInstitutionDiplomacyView({ world, institutionId: selectedRow.institution.id, playerCountry })
      : buildPublicInstitutionDiplomacyView({ world, institutionId: selectedRow.institution.id, playerCountry });
  }, [world, playerCountry, selectedRow?.institution?.id, selectedRow?.member]);
  const selectedChannel = selectedView?.institution?.id
    ? channelByInstitution.get(clean(selectedView.institution.id)) || null
    : null;
  const selectedPendingBallots = Number(selectedView?.playerPendingBallotCount || 0);
  const selectedPendingAmendments = Number(selectedView?.playerPendingAmendmentReviewCount || 0);
  const selectedPendingActions = selectedPendingBallots + selectedPendingAmendments;
  const selectedLifecycleCases = useMemo(() => {
    const cases = Object.values(selectedView?.institution?.lifecycleCases || {});
    if (selectedRow?.member) return cases;
    return cases.filter((entry) => lower(entry?.polity) === lower(playerCountry) || lower(entry?.initiatedBy) === lower(playerCountry));
  }, [selectedView?.institution?.lifecycleCases, selectedRow?.member, playerCountry]);
  const selectedPendingLifecycle = selectedLifecycleCases.filter((entry) => ["pending", "negotiating", "pending-approval"].includes(lower(entry?.status)));
  const selectedHistory = list(selectedView?.institution?.membershipHistory);
  const pending = memberRows.reduce((sum, row) => sum + Number(row.playerPendingBallotCount || 0) + Number(row.playerPendingAmendmentReviewCount || 0), 0) + playerLifecycleCases.length;

  useEffect(() => {
    const visibleCouncilId = section === "council" ? clean(selectedChannel?.id) : "";
    onCouncilVisibleChange?.(visibleCouncilId);
    return () => onCouncilVisibleChange?.("");
  }, [section, selectedChannel?.id, onCouncilVisibleChange]);

  const readableDocs = useMemo(() => selectedView?.institution
    ? documentsReadableBy(world?.reports, playerCountry).filter((report) => documentTouchesInstitution(report, selectedView.institution)).slice(0, 12)
    : [], [world?.reports, playerCountry, selectedView?.institution]);

  const overviewPurpose = clean(
    list(selectedView?.institution?.charter?.lifecycle?.purpose)[0]
    || selectedView?.institution?.description
    || selectedView?.institution?.charter?.lifecycle?.identity?.politicalCharacter
    || ""
  );
  const recentActivity = useMemo(() => {
    const formal = list(selectedView?.decisionHistory).map((proposal) => ({
      id: `proposal:${proposal.id}`,
      date: clean(proposal.lastUpdatedDate || proposal.createdDate),
      title: proposal.title || "Formal decision",
      detail: `${humanize(proposal.status || "recorded")}${proposal.ruleLabel ? ` · ${proposal.ruleLabel}` : ""}`,
      tone: ["passed", "implementation"].includes(lower(proposal.status)) ? "good" : ["failed", "vetoed"].includes(lower(proposal.status)) ? "bad" : "purple",
    }));
    const membership = selectedHistory.map((entry) => ({
      id: `membership:${entry.id}`,
      date: clean(entry.date),
      title: entry.polity ? `${entry.polity} · ${humanize(entry.action)}` : humanize(entry.action || "Membership update"),
      detail: clean(entry.reason),
      tone: ["joined", "accepted", "reinstated"].includes(lower(entry.action)) ? "good" : ["expelled", "withdrew", "rejected"].includes(lower(entry.action)) ? "bad" : "neutral",
    }));
    return [...formal, ...membership]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [selectedView?.decisionHistory, selectedHistory]);

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

  const createProposal = async (mode = "debate") => {
    if (!proposalTitle.trim() || !selectedView?.institution?.id) return;
    if (busy) return;
    const institutionId = selectedView.institution.id;
    setBusy(`proposal:${mode}`);
    setError("");
    try {
      let result = await commitInstitutionalPlayerProposal({ institutionId, playerCountry, date: gameDate, expectedGameId: expectedGameId(), proposal: { type: "resolution", title: proposalTitle.trim(), summary: proposalSummary.trim() } });
      adopt(result);
      const proposalId = clean(result?.proposal?.id);
      if (!proposalId) throw new Error("The proposal was created but its canonical id was not returned.");
      if (mode === "vote") {
        result = await commitInstitutionalPlayerVoteRequest({ institutionId, proposalId, playerCountry, date: gameDate, expectedGameId: expectedGameId() });
        adopt(result);
      }
      setProposalTitle("");
      setProposalSummary("");
      if (mode === "debate") setSection("council");
      try {
        await onRequestCouncilTurn?.({ institutionId, proposalId, kind: mode === "vote" ? "vote" : "debate", source: `table-proposal:${mode}` });
      } catch (aiError) {
        setError(`The proposal is ${mode === "vote" ? "open for voting" : "tabled for debate"}, but the Council response could not be generated: ${aiError?.message || aiError}`);
      }
      return result;
    } catch (err) {
      setError(err?.message || String(err));
      return null;
    } finally {
      setBusy("");
    }
  };

  const vote = (proposalId, choice) => run(`vote:${proposalId}`, () => commitInstitutionGovernanceCommand({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId(), command: { type: "vote", proposalId, polity: playerCountry, choice, authority: "player", finalizeWhenComplete: true, implementWhenPassed: true } }));
  const submit = async (proposalId, playerComment = "") => {
    if (busy) return null;
    const institutionId = selectedView?.institution?.id;
    if (!institutionId) return null;
    setBusy(`submit:${proposalId}`);
    setError("");
    try {
      const result = await commitInstitutionalPlayerVoteRequest({ institutionId, proposalId, playerCountry, date: gameDate, expectedGameId: expectedGameId() });
      adopt(result);
      try {
        await onRequestCouncilTurn?.({ institutionId, proposalId, kind: "vote", playerComment, source: "call-vote" });
      } catch (aiError) {
        setError(`The formal vote is open, but the Council response could not be generated: ${aiError?.message || aiError}`);
      }
      return result;
    } catch (err) {
      setError(err?.message || String(err));
      return null;
    } finally {
      setBusy("");
    }
  };
  const amend = (proposalId, text) => run(`amend:${proposalId}`, () => commitInstitutionGovernanceCommand({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId(), command: { type: "amendment", proposalId, proposer: playerCountry, amendment: { text } } }));
  const resolveAmendment = (proposalId, amendmentId, status) => run(`amend:${proposalId}:${amendmentId}`, () => commitInstitutionGovernanceCommand({ institutionId: selectedView.institution.id, playerCountry, date: gameDate, expectedGameId: expectedGameId(), command: { type: "amendment-status", proposalId, amendmentId, status, requester: playerCountry } }));

  const foundInstitution = async () => {
    const result = await run("found", () => commitInstitutionLifecycleCommand({
      playerCountry, date: gameDate, expectedGameId: expectedGameId(),
      command: {
        type: "found", name: clean(founding.name), shortName: clean(founding.shortName), kind: founding.kind,
        purpose: splitList(founding.purpose), politicalCharacter: clean(founding.politicalCharacter),
        geographicScope: splitList(founding.geographicScope), primaryThreatModel: splitList(founding.primaryThreatModel),
        votingRule: founding.votingRule, minimumFoundingMembers: Math.max(1, Number(founding.minimumFoundingMembers) || 1),
        accessionMode: founding.accessionMode, allowObserver: founding.allowObserver !== false,
        withdrawalMode: founding.withdrawalMode, withdrawalNoticeDays: Math.max(0, Number(founding.withdrawalNoticeDays) || 0),
        expulsionMode: founding.expulsionMode, dissolutionMode: founding.dissolutionMode,
        invitees: splitList(founding.invitees), charterNote: clean(founding.charterNote),
      },
    }));
    if (!result?.institution) return;
    setFoundingOpen(false);
    setFounding({ name: "", shortName: "", kind: "security_alliance", purpose: "", politicalCharacter: "", geographicScope: "", primaryThreatModel: "", votingRule: "simple-majority", minimumFoundingMembers: "2", accessionMode: "approval", allowObserver: true, withdrawalMode: "unilateral", withdrawalNoticeDays: "0", expulsionMode: "approval", dissolutionMode: "approval", invitees: "", charterNote: "" });
    setSelectedId(result.institution.id);
    setSection("overview");
    if (result.createdChat) onOpenLifecycleChat?.(result.createdChat, result);
  };

  const applyForMembership = async (requestedStatus = "member") => {
    const result = await run(`apply:${requestedStatus}`, () => commitInstitutionLifecycleCommand({
      playerCountry, date: gameDate, expectedGameId: expectedGameId(),
      command: { type: "apply", institutionId: selectedView.institution.id, polity: playerCountry, requestedStatus, reason: clean(applicationReason) },
    }));
    if (result?.createdChat) onOpenLifecycleChat?.(result.createdChat, result);
  };

  const invitePolity = async () => {
    if (!clean(inviteTarget)) return;
    const result = await run("invite", () => commitInstitutionLifecycleCommand({
      playerCountry, date: gameDate, expectedGameId: expectedGameId(),
      command: { type: "invite", institutionId: selectedView.institution.id, initiatedBy: playerCountry, polity: clean(inviteTarget), requestedStatus: inviteStatus, reason: clean(inviteReason) },
    }));
    if (result) { setInviteTarget(""); setInviteReason(""); if (result.createdChat) onOpenLifecycleChat?.(result.createdChat, result); }
  };

  const lifecycleCommand = (key, command) => run(key, () => commitInstitutionLifecycleCommand({
    playerCountry, date: gameDate, expectedGameId: expectedGameId(), command: { institutionId: selectedView.institution.id, ...command },
  }));
  const respondToLifecycleCase = (entry, decision) => lifecycleCommand(`respond:${entry?.id}:${decision}`, {
    type: "respond", caseId: entry?.id, actorPolity: playerCountry, decision, reason: clean(lifecycleReason), authority: "player",
  });
  const openLifecycleNegotiation = async (entry) => {
    if (!entry?.id || !selectedView?.institution?.id) return;
    const groupedCases = lower(entry?.kind) === "founding-invitation"
      ? selectedPendingLifecycle.filter((candidate) => lower(candidate?.kind) === "founding-invitation" && lower(candidate?.initiatedBy) === lower(entry?.initiatedBy || playerCountry))
      : [entry];
    const result = await run(`open-lifecycle:${entry.id}`, () => ensureInstitutionLifecycleNegotiationChat({
      institutionId: selectedView.institution.id,
      caseIds: groupedCases.map((candidate) => candidate.id),
      playerCountry,
      date: gameDate,
      expectedGameId: expectedGameId(),
    }));
    if (result?.channel) onOpenLifecycleChat?.(result.channel, result);
  };
  const withdraw = () => lifecycleCommand("withdraw", { type: "withdraw", polity: playerCountry, reason: clean(lifecycleReason), authority: "player" });
  const proposeLifecycle = (type, polity = "") => lifecycleCommand(`${type}:${polity}`, { type, polity, initiatedBy: playerCountry, reason: clean(lifecycleReason) });

  if (!selectedView) {
    return <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: ".55rem 1rem", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", gap: ".45rem", flexShrink: 0 }}>
        <button className="oh-tap-row" onClick={() => setShowAll(false)} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 999, background: !showAll ? "rgba(139,92,246,.14)" : "rgba(255,255,255,.03)", color: !showAll ? "#ddd6fe" : "rgba(255,255,255,.55)", padding: ".28rem .55rem", fontSize: ".62rem", cursor: "pointer" }}>Your institutions ({personalRows.length})</button>
        <button className="oh-tap-row" onClick={() => setShowAll(true)} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 999, background: showAll ? "rgba(139,92,246,.14)" : "rgba(255,255,255,.03)", color: showAll ? "#ddd6fe" : "rgba(255,255,255,.55)", padding: ".28rem .55rem", fontSize: ".62rem", cursor: "pointer" }}>View all ({allRows.length})</button>
        {pending > 0 && <SmallPill tone="live">{pending} awaiting you</SmallPill>}
        <button className="oh-tap-row" type="button" onClick={() => { setFoundingOpen(true); setError(""); }} style={{ marginLeft: "auto", border: "1px solid rgba(167,139,250,.3)", borderRadius: 8, background: "rgba(139,92,246,.14)", color: "#ede9fe", padding: ".32rem .58rem", fontSize: ".64rem", fontWeight: 780, cursor: "pointer" }}>＋ Found institution</button>      </div>
      {error && <div style={{ margin: ".5rem 1rem 0", padding: ".45rem .6rem", borderRadius: 8, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", color: "#fca5a5", fontSize: ".62rem", flexShrink: 0 }}>{error}</div>}
      {foundingOpen ? <FoundInstitutionForm value={founding} onChange={setFounding} onCancel={() => setFoundingOpen(false)} onSubmit={foundInstitution} busy={busy === "found"} polities={allPolities} /> : <div style={{ flex: 1, overflowY: "auto", padding: ".75rem 1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(15rem,1fr))", alignContent: "start", gap: ".55rem" }}>
        {rows.length ? rows.map((row) => { const channel = channelByInstitution.get(clean(row.institution.id)); return <InstitutionRow key={row.institution.id} row={row} unread={channel ? unreadIds.has(String(channel.id)) : false} onClick={() => { setSelectedId(row.institution.id); setSection("overview"); setError(""); }} />; }) : <div style={{ gridColumn: "1 / -1", margin: "auto", color: "rgba(255,255,255,.3)", fontSize: ".78rem", textAlign: "center", padding: "2rem" }}>{showAll ? "No institutions exist in this world yet." : "Your government is not part of any institution and has no pending invitation or application."}</div>}
      </div>}
    </div>;
  }

  const institution = selectedView.institution;
  const activeCouncilAutomation = list(councilAutomation).find((entry) => lower(entry?.institutionId) === lower(institution.id));
  const tabs = [["overview", "Overview"], ["council", "Council"], ["agenda", `Agenda${selectedView.activeProposals?.length ? ` (${selectedView.activeProposals.length})` : ""}`], ["decisions", "Decisions"], ["charter", "Charter"], ["members", "Members"], ["documents", `Documents${readableDocs.length ? ` (${readableDocs.length})` : ""}`]];
  return <div data-institution-shell="persistent" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    <div data-institution-header="persistent" style={{ display: "flex", alignItems: "center", gap: ".85rem", padding: ".9rem 1rem .78rem", borderBottom: "1px solid rgba(255,255,255,.055)", flexShrink: 0 }}>
      <button className="oh-tap" onClick={() => { setSelectedId(""); setError(""); }} style={{ border: 0, background: "transparent", color: "rgba(255,255,255,.55)", cursor: "pointer", fontSize: "1.08rem" }} aria-label="Back to institutions">‹</button>
      <Emblem institution={institution} size={56} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}><strong style={{ fontSize: "1.04rem", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{institution.name || institution.id}</strong><SmallPill tone={lower(institution.status || "active") === "active" ? "good" : "neutral"}>{institution.status || "active"}</SmallPill></div>
        <div style={{ marginTop: ".2rem", fontSize: ".65rem", color: "rgba(255,255,255,.45)" }}>{clean(institution.kind || "institution").replace(/[-_]/g, " ")}{institution.foundedDate ? ` · founded ${institution.foundedDate}` : ""}</div>
        {overviewPurpose && <div style={{ marginTop: ".3rem", maxWidth: "44rem", fontSize: ".7rem", lineHeight: 1.4, color: "rgba(255,255,255,.62)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{overviewPurpose}</div>}
      </div>    </div>
    <div data-institution-facts="persistent" style={{ padding: ".65rem 1rem .7rem", flexShrink: 0 }}><Facts view={selectedView} /></div>
    <div data-institution-tabs="persistent" style={{ display: "flex", flexWrap: "wrap", gap: ".08rem", padding: "0 .78rem", borderBottom: "1px solid rgba(255,255,255,.06)", flexShrink: 0 }}>{tabs.map(([key, label]) => <button className="oh-tap-row" key={key} onClick={() => key === "council" && selectedRow.member ? openCouncil() : setSection(key)} disabled={key === "council" && Boolean(busy)} style={{ flex: "0 0 auto", border: 0, borderBottom: `2px solid ${section === key ? "rgba(139,92,246,.9)" : "transparent"}`, background: "transparent", color: section === key ? "#f3f0ff" : "rgba(255,255,255,.52)", padding: ".58rem .68rem .62rem", fontSize: ".68rem", fontWeight: 730, cursor: key === "council" && busy ? "wait" : "pointer" }}>{key === "council" && busy === "council" ? "Opening…" : label}</button>)}</div>    {error && <div style={{ margin: ".5rem 1rem 0", padding: ".45rem .6rem", borderRadius: 8, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", color: "#fca5a5", fontSize: ".62rem", flexShrink: 0 }}>{error}</div>}
    {section === "council" && selectedPendingActions > 0 && <button className="oh-tap-row" type="button" onClick={() => setSection("agenda")} style={{ margin: ".55rem 1rem 0", padding: ".58rem .7rem", display: "flex", alignItems: "center", gap: ".7rem", border: "1px solid rgba(245,158,11,.28)", borderRadius: 10, background: "rgba(245,158,11,.08)", color: "#fde68a", cursor: "pointer", textAlign: "left", flexShrink: 0 }}>
      <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: ".59rem", fontWeight: 850, letterSpacing: ".07em", textTransform: "uppercase", color: "rgba(253,230,138,.7)" }}>Action required</span><span style={{ display: "block", marginTop: ".12rem", fontSize: ".62rem", fontWeight: 700 }}>{selectedPendingBallots ? `${selectedPendingBallots} ballot${selectedPendingBallots === 1 ? "" : "s"} awaiting you` : ""}{selectedPendingBallots && selectedPendingAmendments ? " · " : ""}{selectedPendingAmendments ? `${selectedPendingAmendments} amendment review${selectedPendingAmendments === 1 ? "" : "s"}` : ""}</span></span>
      <strong style={{ fontSize: ".64rem" }}>Review agenda →</strong>    </button>}
    <div data-institution-content={section} style={{ flex: 1, minHeight: 0, overflowY: section === "council" ? "hidden" : "auto", padding: section === "council" ? ".55rem 1rem .8rem" : ".8rem 1rem 1rem", display: section === "council" ? "flex" : "block", flexDirection: section === "council" ? "column" : undefined }}>
      {section === "overview" && <div data-institution-overview="focused" style={{ display: "flex", flexDirection: "column", gap: ".75rem", maxWidth: "56rem", margin: "0 auto" }}>
        <div data-institution-current-business="true" style={{ ...panel, padding: "1rem", borderColor: selectedView.activeProposals?.length || selectedPendingLifecycle.length ? "rgba(167,139,250,.2)" : "rgba(255,255,255,.075)", background: "linear-gradient(145deg,rgba(139,92,246,.055),rgba(255,255,255,.025))" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: ".75rem" }}>
            <div style={{ width: "2.25rem", height: "2.25rem", borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(139,92,246,.12)", border: "1px solid rgba(167,139,250,.18)", color: "#c4b5fd", fontSize: "1rem" }} aria-hidden="true">▤</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: ".65rem", fontWeight: 850, letterSpacing: ".075em", textTransform: "uppercase", color: "rgba(196,181,253,.72)" }}>Current business</div>
              {selectedView.activeProposals?.length ? <>
                <div style={{ marginTop: ".28rem", fontSize: ".88rem", fontWeight: 780 }}>{selectedView.activeProposals[0].title}</div>
                <div style={{ marginTop: ".28rem", fontSize: ".67rem", lineHeight: 1.5, color: "rgba(255,255,255,.5)" }}>{selectedView.activeProposals[0].summary || "This matter is currently before the institution."}</div>
                <div style={{ marginTop: ".48rem", display: "flex", gap: ".35rem", flexWrap: "wrap" }}><SmallPill tone={selectedView.activeProposals[0].status === "voting" ? "live" : "purple"}>{humanize(selectedView.activeProposals[0].status)}</SmallPill>{selectedView.activeProposals.length > 1 && <SmallPill tone="neutral">+{selectedView.activeProposals.length - 1} more</SmallPill>}</div>
              </> : selectedPendingLifecycle.length ? <>
                <div style={{ marginTop: ".28rem", fontSize: ".88rem", fontWeight: 780 }}>Membership business awaiting resolution</div>
                <div style={{ marginTop: ".28rem", fontSize: ".67rem", lineHeight: 1.5, color: "rgba(255,255,255,.5)" }}>{selectedPendingLifecycle.length} active lifecycle case{selectedPendingLifecycle.length === 1 ? "" : "s"} remain before the institution.</div>
              </> : <>
                <div style={{ marginTop: ".28rem", fontSize: ".88rem", fontWeight: 780 }}>No active formal business</div>
                <div style={{ marginTop: ".28rem", fontSize: ".67rem", lineHeight: 1.5, color: "rgba(255,255,255,.45)" }}>There are no debates, ballots or membership cases currently requiring attention.</div>
              </>}
            </div>
          </div>
          <div style={{ display: "flex", gap: ".45rem", flexWrap: "wrap", marginTop: ".8rem", paddingTop: ".72rem", borderTop: "1px solid rgba(255,255,255,.06)" }}>
            {selectedView.canTableProposal && <button type="button" onClick={() => setSection("agenda")} style={{ border: "1px solid rgba(167,139,250,.3)", borderRadius: 9, background: "rgba(139,92,246,.13)", color: "#ede9fe", padding: ".46rem .7rem", fontSize: ".67rem", fontWeight: 780, cursor: "pointer" }}>＋ Table a matter</button>}
            {selectedRow.member && <button type="button" onClick={openCouncil} disabled={Boolean(busy)} style={{ border: "1px solid rgba(255,255,255,.11)", borderRadius: 9, background: "rgba(255,255,255,.045)", color: "rgba(255,255,255,.78)", padding: ".46rem .7rem", fontSize: ".67rem", fontWeight: 720, cursor: busy ? "wait" : "pointer" }}>Open Council</button>}
            {selectedPendingLifecycle.length > 0 && <button type="button" onClick={() => setSection("members")} style={{ marginLeft: "auto", border: 0, background: "transparent", color: "#c4b5fd", padding: ".46rem .2rem", fontSize: ".65rem", fontWeight: 730, cursor: "pointer" }}>Review membership →</button>}
          </div>
        </div>

        <div data-institution-recent-activity="true" style={{ ...panel, padding: ".9rem 1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem" }}><strong style={{ flex: 1, fontSize: ".78rem" }}>Recent activity</strong>{(selectedView.decisionHistory?.length || selectedHistory.length) > recentActivity.length && <button type="button" onClick={() => setSection("decisions")} style={{ border: 0, background: "transparent", color: "#c4b5fd", fontSize: ".62rem", cursor: "pointer" }}>View formal record →</button>}</div>
          {recentActivity.length ? <div style={{ marginTop: ".65rem", display: "flex", flexDirection: "column" }}>{recentActivity.map((entry, index) => <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: ".6rem", alignItems: "start", padding: ".48rem 0", borderTop: index ? "1px solid rgba(255,255,255,.055)" : 0 }}>
            <span style={{ width: ".5rem", height: ".5rem", marginTop: ".28rem", borderRadius: 999, background: entry.tone === "good" ? "#4ade80" : entry.tone === "bad" ? "#f87171" : entry.tone === "purple" ? "#a78bfa" : "rgba(255,255,255,.35)" }} />
            <div style={{ minWidth: 0 }}><div style={{ fontSize: ".68rem", fontWeight: 710, color: "rgba(255,255,255,.82)" }}>{entry.title}</div>{entry.detail && <div style={{ marginTop: ".12rem", fontSize: ".64rem", lineHeight: 1.4, color: "rgba(255,255,255,.4)" }}>{entry.detail}</div>}</div>
            {entry.date && <span style={{ fontSize: ".61rem", color: "rgba(255,255,255,.28)", whiteSpace: "nowrap" }}>{entry.date}</span>}
          </div>)}</div> : <div style={{ padding: "1rem .1rem .4rem", fontSize: ".66rem", color: "rgba(255,255,255,.34)" }}>No formal activity has been recorded yet.</div>}
        </div>
      </div>}
      {section === "agenda" && <div style={{ display: "flex", flexDirection: "column", gap: ".55rem" }}>
        {selectedView.canTableProposal && <div data-institution-table-proposal="true" style={{ ...panel, padding: ".85rem" }}>
          <div style={{ fontSize: ".76rem", fontWeight: 780 }}>Table a matter</div>
          <div style={{ marginTop: ".2rem", fontSize: ".62rem", lineHeight: 1.45, color: "rgba(255,255,255,.42)" }}>Open a Council debate first, or move a ready matter directly to a formal ballot.</div>
          <input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} placeholder="Proposal title" maxLength={160} style={{ ...fieldStyle, marginTop: ".58rem" }} />
          <textarea value={proposalSummary} onChange={(e) => setProposalSummary(e.target.value)} placeholder="What should the institution decide?" maxLength={4000} rows={3} style={{ ...fieldStyle, marginTop: ".42rem", resize: "vertical" }} />
          <div style={{ display: "flex", gap: ".42rem", marginTop: ".55rem", flexWrap: "wrap" }}>
            <button disabled={Boolean(busy) || !proposalTitle.trim()} onClick={() => createProposal("debate")} style={{ border: "1px solid rgba(167,139,250,.3)", borderRadius: 8, background: "rgba(139,92,246,.14)", color: "#ede9fe", cursor: busy || !proposalTitle.trim() ? "not-allowed" : "pointer", padding: ".42rem .64rem", fontSize: ".64rem", fontWeight: 780 }}>Open for debate</button>
            <button disabled={Boolean(busy) || !proposalTitle.trim()} onClick={() => createProposal("vote")} style={{ border: "1px solid rgba(245,158,11,.24)", borderRadius: 8, background: "rgba(245,158,11,.075)", color: "#fde68a", cursor: busy || !proposalTitle.trim() ? "not-allowed" : "pointer", padding: ".42rem .64rem", fontSize: ".64rem", fontWeight: 760 }}>Put to vote now</button>
          </div>
        </div>}
        {selectedView.activeProposals?.length ? selectedView.activeProposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} view={selectedView} busy={Boolean(busy)} onVote={vote} onSubmit={submit} onAmend={amend} onResolveAmendment={resolveAmendment} />) : <div style={{ color: "rgba(255,255,255,.3)", fontSize: ".67rem", textAlign: "center", padding: "2rem .5rem" }}>No active proposals, amendments or ballots.</div>}
        {selectedView.openBallots?.some((proposal) => proposal.unresolvedNpcVoters > 0) && <div style={{ ...panel, padding: ".68rem .75rem", fontSize: ".62rem", color: "rgba(255,255,255,.44)", lineHeight: 1.5 }}>When a formal vote opens, one bounded Council round immediately prompts unresolved eligible AI ballots. Any ballots still unresolved remain eligible for the normal post-turn follow-up.</div>}
      </div>}
      {section === "members" && <div data-institution-members-workspace="true" style={{ display: "flex", flexDirection: "column", gap: ".75rem", maxWidth: "56rem", margin: "0 auto" }}>
        {!selectedRow.member && lower(institution.status) !== "dissolved" && <div data-institution-accession-controls="true" style={{ ...panel, padding: ".9rem", borderColor: "rgba(167,139,250,.16)" }}>
          <div style={{ fontSize: ".78rem", fontWeight: 780 }}>Request accession</div>
          <div style={{ marginTop: ".24rem", fontSize: ".64rem", lineHeight: 1.5, color: "rgba(255,255,255,.46)" }}>Your request opens formal membership business under this institution's charter. Membership is never granted merely by sending the request.</div>
          <textarea value={applicationReason} onChange={(e) => setApplicationReason(e.target.value)} placeholder="Why is your government seeking membership?" rows={2} maxLength={1200} style={{ ...fieldStyle, marginTop: ".6rem", resize: "vertical" }} />
          <div style={{ display: "flex", gap: ".45rem", marginTop: ".5rem", flexWrap: "wrap" }}>
            <button disabled={Boolean(busy) || selectedPendingLifecycle.some((entry) => lower(entry.polity) === lower(playerCountry))} onClick={() => applyForMembership("member")} style={{ border: "1px solid rgba(167,139,250,.28)", borderRadius: 8, background: "rgba(139,92,246,.12)", color: "#ede9fe", padding: ".42rem .65rem", fontSize: ".65rem", fontWeight: 760, cursor: busy ? "wait" : "pointer" }}>Request membership</button>
            {list(institution?.charter?.lifecycle?.accession?.allowedStatuses).includes("observer") && <button disabled={Boolean(busy) || selectedPendingLifecycle.some((entry) => lower(entry.polity) === lower(playerCountry))} onClick={() => applyForMembership("observer")} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.72)", padding: ".42rem .65rem", fontSize: ".65rem", cursor: busy ? "wait" : "pointer" }}>Request observer status</button>}          </div>
        </div>}

        {selectedRow.member && selectedView.canParticipate && lower(institution.status) !== "dissolved" && <div data-institution-lifecycle-controls="true" style={{ ...panel, padding: ".9rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}><div style={{ flex: 1 }}><strong style={{ display: "block", fontSize: ".78rem" }}>Membership actions</strong><span style={{ display: "block", marginTop: ".18rem", fontSize: ".62rem", color: "rgba(255,255,255,.4)" }}>Invite governments or begin a formal membership procedure.</span></div><SmallPill tone={lower(institution.status) === "provisional" ? "live" : "purple"}>{humanize(institution.status || "active")}</SmallPill></div>
          <div style={{ marginTop: ".6rem", display: "grid", gridTemplateColumns: "minmax(12rem,1fr) auto", gap: ".45rem" }}>
            <PolityMultiPicker value={inviteTarget} onChange={setInviteTarget} polities={allPolities.filter((name) => !list(institution.members).some((member) => lower(member.polity) === lower(name)))} label="Search a government…" multiple={false} />
            <select value={inviteStatus} onChange={(e) => setInviteStatus(e.target.value)} style={{ ...fieldStyle, width: "auto" }}><option value="member">Member</option>{list(institution?.charter?.lifecycle?.accession?.allowedStatuses).includes("observer") && <option value="observer">Observer</option>}</select>
            <input value={inviteReason} onChange={(e) => setInviteReason(e.target.value)} placeholder="Reason or proposed terms (optional)" maxLength={1200} style={{ ...fieldStyle, gridColumn: "1 / 2" }} />
            <button className="oh-tap-row" disabled={Boolean(busy) || !clean(inviteTarget)} onClick={invitePolity} style={{ border: "1px solid rgba(167,139,250,.25)", borderRadius: 8, background: "rgba(139,92,246,.11)", color: "#ddd6fe", padding: ".4rem .62rem", fontSize: ".65rem", fontWeight: 750, cursor: busy || !clean(inviteTarget) ? "not-allowed" : "pointer" }}>Send invitation</button>          </div>
          <details style={{ marginTop: ".65rem", borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: ".6rem" }}>
            <summary style={{ cursor: "pointer", fontSize: ".64rem", fontWeight: 720, color: "rgba(255,255,255,.62)" }}>Withdrawal, discipline & dissolution</summary>
            <textarea value={lifecycleReason} onChange={(e) => setLifecycleReason(e.target.value)} placeholder="Reason for withdrawal, disciplinary motion or dissolution proposal (optional)" rows={2} maxLength={1200} style={{ ...fieldStyle, marginTop: ".55rem", resize: "vertical" }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".45rem" }}>
              <button disabled={Boolean(busy)} onClick={withdraw} style={{ border: "1px solid rgba(245,158,11,.2)", borderRadius: 8, background: "rgba(245,158,11,.07)", color: "#fde68a", padding: ".36rem .55rem", fontSize: ".62rem", cursor: busy ? "wait" : "pointer" }}>Withdraw from institution</button>
              <button disabled={Boolean(busy)} onClick={() => proposeLifecycle("dissolve")} style={{ border: "1px solid rgba(239,68,68,.2)", borderRadius: 8, background: "rgba(239,68,68,.06)", color: "#fca5a5", padding: ".36rem .55rem", fontSize: ".62rem", cursor: busy ? "wait" : "pointer" }}>Propose dissolution</button>
            </div>
          </details>
        </div>}

        {selectedPendingLifecycle.length > 0 && <section>
          <div style={{ fontSize: ".64rem", fontWeight: 850, letterSpacing: ".075em", textTransform: "uppercase", color: "rgba(253,230,138,.68)", marginBottom: ".45rem" }}>Pending membership business</div>
          <div style={{ display: "flex", flexDirection: "column", gap: ".45rem" }}>{selectedPendingLifecycle.map((entry) => <LifecycleCaseCard key={entry.id} entry={entry} institutionName={institution.name} busy={Boolean(busy)} opening={busy === `open-lifecycle:${entry.id}`} canRespond={lower(entry?.polity) === lower(playerCountry) && ["invitation", "founding-invitation"].includes(lower(entry?.kind)) && ["pending", "negotiating"].includes(lower(entry?.status))} canOpenNegotiation={lower(entry?.initiatedBy) === lower(playerCountry) && ["invitation", "founding-invitation"].includes(lower(entry?.kind)) && ["pending", "negotiating"].includes(lower(entry?.status))} onRespond={(decision) => respondToLifecycleCase(entry, decision)} onOpenNegotiation={() => openLifecycleNegotiation(entry)} />)}</div>
        </section>}

        <section>
          <div style={{ display: "flex", alignItems: "baseline", gap: ".5rem", marginBottom: ".45rem" }}><strong style={{ fontSize: ".78rem" }}>Current members</strong><span style={{ fontSize: ".64rem", color: "rgba(255,255,255,.32)" }}>{selectedView.members?.length || 0} listed</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: ".35rem" }}>{selectedView.members?.map((member) => <div key={member.polity} style={{ ...panel, padding: ".62rem .72rem", display: "flex", alignItems: "center", gap: ".55rem" }}>
            <strong style={{ flex: 1, fontSize: ".69rem" }}>{member.polity}</strong><SmallPill tone={member.status === "suspended" ? "bad" : "neutral"}>{institutionMembershipDisplayLabel(member)}</SmallPill>{member.since && <span style={{ fontSize: ".61rem", color: "rgba(255,255,255,.3)" }}>since {member.since}</span>}
            {selectedView.canParticipate && lower(member.polity) !== lower(playerCountry) && lower(institution.status) !== "dissolved" && <details style={{ position: "relative" }}><summary style={{ listStyle: "none", cursor: "pointer", color: "rgba(255,255,255,.46)", fontSize: ".75rem", padding: ".1rem .2rem" }}>•••</summary><div style={{ position: "absolute", right: 0, top: "1.5rem", zIndex: 20, minWidth: "10rem", display: "flex", flexDirection: "column", gap: ".25rem", padding: ".35rem", border: "1px solid rgba(255,255,255,.1)", borderRadius: 9, background: "rgba(18,18,23,.98)", boxShadow: "0 10px 28px rgba(0,0,0,.35)" }}>
              {lower(member.status) === "suspended" ? <button disabled={Boolean(busy)} onClick={() => proposeLifecycle("reinstate", member.polity)} style={{ border: 0, borderRadius: 7, background: "rgba(34,197,94,.06)", color: "#86efac", padding: ".38rem .45rem", fontSize: ".64rem", textAlign: "left", cursor: busy ? "wait" : "pointer" }}>Propose reinstatement</button> : <button disabled={Boolean(busy)} onClick={() => proposeLifecycle("suspend", member.polity)} style={{ border: 0, borderRadius: 7, background: "rgba(245,158,11,.06)", color: "#fde68a", padding: ".38rem .45rem", fontSize: ".64rem", textAlign: "left", cursor: busy ? "wait" : "pointer" }}>Propose suspension</button>}
              <button disabled={Boolean(busy)} onClick={() => proposeLifecycle("expel", member.polity)} style={{ border: 0, borderRadius: 7, background: "rgba(239,68,68,.06)", color: "#fca5a5", padding: ".38rem .45rem", fontSize: ".64rem", textAlign: "left", cursor: busy ? "wait" : "pointer" }}>Propose expulsion</button>
            </div></details>}
          </div>)}</div>
        </section>

        {selectedHistory.length > 0 && <details style={{ ...panel, padding: ".72rem .8rem" }}><summary style={{ cursor: "pointer", fontSize: ".69rem", fontWeight: 730, color: "rgba(255,255,255,.68)" }}>Membership history ({selectedHistory.length})</summary><div style={{ marginTop: ".5rem", display: "flex", flexDirection: "column" }}>{[...selectedHistory].reverse().slice(0, 24).map((entry, index) => <div key={entry.id} style={{ padding: ".42rem .05rem", display: "flex", alignItems: "center", gap: ".5rem", borderTop: index ? "1px solid rgba(255,255,255,.055)" : 0 }}><span style={{ flex: 1, minWidth: 0, fontSize: ".62rem", color: "rgba(255,255,255,.58)" }}>{entry.polity ? `${entry.polity} · ` : ""}{humanize(entry.action)}{entry.reason ? ` · ${entry.reason}` : ""}</span>{entry.date && <span style={{ fontSize: ".6rem", color: "rgba(255,255,255,.27)" }}>{entry.date}</span>}</div>)}</div></details>}
      </div>}
      {section === "charter" && <div data-institution-charter-workspace="true" style={{ display: "flex", flexDirection: "column", gap: ".75rem", maxWidth: "56rem", margin: "0 auto" }}>
        <div style={{ ...panel, padding: ".9rem 1rem" }}>
          <div style={{ display: "flex", gap: ".7rem", alignItems: "flex-start" }}><div style={{ flex: 1 }}><div style={{ fontSize: ".64rem", textTransform: "uppercase", letterSpacing: ".07em", color: "rgba(196,181,253,.68)" }}>Decision framework</div><div style={{ marginTop: ".25rem", fontSize: ".86rem", fontWeight: 780 }}>{selectedView.charterView?.defaultRule?.label || "Unspecified voting rule"}</div></div><SmallPill tone="purple">Default rule</SmallPill></div>
          {selectedView.charterView?.note && <p style={{ margin: ".55rem 0 0", fontSize: ".67rem", lineHeight: 1.5, color: "rgba(255,255,255,.55)" }}>{selectedView.charterView.note}</p>}
          {selectedView.charterView?.proposalRules?.length > 0 && <div style={{ marginTop: ".75rem", paddingTop: ".65rem", borderTop: "1px solid rgba(255,255,255,.06)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(12rem,1fr))", gap: ".45rem .8rem" }}>{selectedView.charterView.proposalRules.map((entry) => <div key={entry.type} style={{ display: "flex", alignItems: "center", gap: ".45rem", minWidth: 0 }}><span style={{ flex: 1, minWidth: 0, fontSize: ".64rem", color: "rgba(255,255,255,.62)", textTransform: "capitalize" }}>{entry.label}</span><SmallPill tone="neutral">{entry.rule.label}</SmallPill></div>)}</div>}
        </div>

        {institution?.charter?.lifecycle && <div style={{ ...panel, padding: ".9rem 1rem" }}>
          <div style={{ fontSize: ".78rem", fontWeight: 780 }}>Membership constitution</div>
          <div style={{ marginTop: ".6rem", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(14rem,1fr))", gap: ".6rem 1rem" }}>
            {list(institution.charter.lifecycle.purpose).length > 0 && <div><div style={{ fontSize: ".61rem", textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.34)" }}>Purpose</div><div style={{ marginTop: ".2rem", fontSize: ".66rem", lineHeight: 1.45, color: "rgba(255,255,255,.62)" }}>{institution.charter.lifecycle.purpose.join("; ")}</div></div>}
            {institution.charter.lifecycle.identity?.politicalCharacter && <div><div style={{ fontSize: ".61rem", textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.34)" }}>Political character</div><div style={{ marginTop: ".2rem", fontSize: ".66rem", lineHeight: 1.45, color: "rgba(255,255,255,.62)" }}>{institution.charter.lifecycle.identity.politicalCharacter}</div></div>}
            {list(institution.charter.lifecycle.identity?.geographicScope).length > 0 && <div><div style={{ fontSize: ".61rem", textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.34)" }}>Geographic scope</div><div style={{ marginTop: ".2rem", fontSize: ".66rem", color: "rgba(255,255,255,.62)" }}>{institution.charter.lifecycle.identity.geographicScope.join(", ")}</div></div>}
            {list(institution.charter.lifecycle.identity?.primaryThreatModel).length > 0 && <div><div style={{ fontSize: ".61rem", textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.34)" }}>Primary threat model</div><div style={{ marginTop: ".2rem", fontSize: ".66rem", color: "rgba(255,255,255,.62)" }}>{institution.charter.lifecycle.identity.primaryThreatModel.join(", ")}</div></div>}
          </div>
          <div style={{ marginTop: ".75rem", paddingTop: ".65rem", borderTop: "1px solid rgba(255,255,255,.06)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(13rem,1fr))", gap: ".45rem" }}>            <LifecycleRuleRow label="Accession" rule={institution.charter.lifecycle.accession} />
            <LifecycleRuleRow label="Withdrawal" rule={institution.charter.lifecycle.withdrawal} />
            <LifecycleRuleRow label="Expulsion" rule={institution.charter.lifecycle.expulsion} />
            <LifecycleRuleRow label="Dissolution" rule={institution.charter.lifecycle.dissolution} />
          </div>
        </div>}
      </div>}
      {section === "decisions" && <div style={{ display: "flex", flexDirection: "column", gap: ".55rem" }}>
        <div style={{ padding: ".05rem .1rem .2rem" }}>
          <div style={{ fontSize: ".59rem", fontWeight: 850, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(196,181,253,.68)" }}>Institutional record</div>
          <div style={{ marginTop: ".18rem", fontSize: ".78rem", fontWeight: 780 }}>Decisions</div>
          <div style={{ marginTop: ".2rem", fontSize: ".61rem", color: "rgba(255,255,255,.38)" }}>Passed, failed and implemented matters are preserved as formal history rather than buried in chat.</div>
        </div>
        {selectedView.decisionHistory?.length ? selectedView.decisionHistory.map((proposal) => <DecisionCard key={proposal.id} proposal={proposal} />) : <div style={{ color: "rgba(255,255,255,.3)", fontSize: ".67rem", textAlign: "center", padding: "2rem .5rem" }}>No recorded formal decisions yet.</div>}
      </div>}
      {section === "documents" && <div style={{ display: "flex", flexDirection: "column", gap: ".45rem" }}>{readableDocs.length ? readableDocs.map((report) => <div key={report.id} style={{ ...panel, padding: ".65rem" }}><div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}><span aria-hidden="true">📄</span><strong style={{ flex: 1, fontSize: ".65rem" }}>{report.title}</strong>{report.dateline && <span style={{ fontSize: ".59rem", color: "rgba(255,255,255,.3)" }}>{report.dateline}</span>}</div><div style={{ marginTop: ".3rem", fontSize: ".62rem", color: "rgba(255,255,255,.45)" }}>{report.from ? `From ${report.from} · ` : ""}{report.visibleTo === null ? "published" : report.visibleTo?.some((name) => lower(name) === lower(playerCountry)) ? "held by your government" : "intercepted copy"}</div><div style={{ marginTop: ".35rem", fontSize: ".65rem", lineHeight: 1.45, color: "rgba(255,255,255,.6)", whiteSpace: "pre-wrap" }}>{report.body}</div></div>) : <div style={{ color: "rgba(255,255,255,.3)", fontSize: ".67rem", textAlign: "center", padding: "2rem .5rem" }}>No institution-related documents currently readable by your government.</div>}</div>}
      {section === "council" && activeCouncilAutomation && <div data-institution-council-automation="true" style={{ marginBottom: ".5rem", padding: ".55rem .7rem", border: "1px solid rgba(167,139,250,.18)", borderRadius: 10, background: "rgba(139,92,246,.075)", color: "rgba(255,255,255,.72)", fontSize: ".66rem", lineHeight: 1.45, flexShrink: 0 }}>{activeCouncilAutomation.kind === "vote" ? "Member governments are casting formal ballots…" : "Council members are considering the tabled matter…"}</div>}
      {section === "council" && (selectedRow.member ? (selectedChannel && renderCouncil ? <div data-institution-council-pane="embedded" style={{ ...panel, flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", background: "rgba(7,7,10,.22)", borderColor: "rgba(167,139,250,.12)" }}>{renderCouncil(selectedChannel)}</div> : <div style={{ ...panel, padding: ".8rem" }}><strong style={{ fontSize: ".68rem" }}>Council channel</strong><p style={{ margin: ".4rem 0 .65rem", fontSize: ".62rem", lineHeight: 1.5, color: "rgba(255,255,255,.5)" }}>{busy === "council" ? "Preparing the persistent council channel…" : "This institution has a persistent Council channel for member discussion. Formal proposals, amendments and ballots remain governed by the institution\'s charter."}</p><button className="oh-tap-row" disabled={Boolean(busy)} onClick={openCouncil} style={{ border: "1px solid rgba(167,139,250,.28)", borderRadius: 9, background: "rgba(139,92,246,.13)", color: "#ede9fe", cursor: busy ? "wait" : "pointer", padding: ".45rem .65rem", fontSize: ".64rem", fontWeight: 760 }}>{busy === "council" ? "Opening…" : "Open council channel"}</button></div>) : <div style={{ ...panel, padding: ".8rem" }}><strong style={{ fontSize: ".68rem" }}>Council channel</strong><p style={{ margin: ".4rem 0 0", fontSize: ".62rem", lineHeight: 1.5, color: "rgba(255,255,255,.5)" }}>Only participating governments receive a persistent institutional council channel. This public view does not create one.</p></div>)}    </div>
  </div>;
}
