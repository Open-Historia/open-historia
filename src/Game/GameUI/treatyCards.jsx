/*! Open Historia — treaties in a diplomatic chat, on screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "add a button to diplomacy chat to propose deal where you can write out a
// deal you propose and send it and the ai request actually properly creates
// the treatie in the way the game engine works" (the owner, 2026-11-19).
//
// In a one-on-one chat with a country or a group (chat.jsx):
//
//   ProposeDealButton   a rolled parchment left of the message box: opens the box
//   ProposalBox         the player writes the deal out in their own words and sends
//                       it; the other side's leadership answers it in the same
//                       request and writes the treaty as the game models it
//                       (Game/AI/treatyTalk.js)
//   TreatyCard          a treaty drafted in the chat: what the player proposed, the
//                       treaty as written (its kind, parties, term, terms and
//                       effects), and what became of it; Sign / Decline on a
//                       counter-offer put to the player, Withdraw on their own
//   AgreementsInForce   the agreements in force between the two, each with its
//                       effects and End (pressed twice: breaking one carries out
//                       what it says a breach costs)
//   EffectList          an agreement's effects, as the AI wrote them
//                       (runtime/agreementEffects.js), wherever agreements are listed
//
// Every write goes through gameplayLazy.js playerTreaty: single player only.

import React, { useState } from "react";
import { AGREEMENT_TYPE_LABELS } from "../../runtime/diplomaticViews.js";
import { AGREEMENT_EFFECT_LISTS, normalizeAgreementEffects } from "../../runtime/agreementEffects.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

export const PROPOSAL_MOST = 1200;

export const EFFECT_LIST_LABELS = Object.freeze({
  onSign: "On signing",
  monthly: "Every month",
  onEnd: "When it ends",
  onBreak: "If broken",
});
export const EFFECT_STAT_LABELS = Object.freeze({
  stability: "Stability",
  "economy.gdp": "GDP",
  "economy.publicDebt": "Public debt",
  "economy.budgetBalance": "Budget balance",
  "economy.gdpGrowth": "GDP growth",
  "economy.inflation": "Inflation",
  "economy.unemployment": "Unemployment",
  "population.total": "Population",
  "military.quality": "Military quality",
  "military.technology": "Military technology",
  "military.land": "Land forces",
  "military.sea": "Navy",
  "military.air": "Air force",
  "military.spending": "Military spending",
});
export const EFFECT_STRENGTH_LABELS = Object.freeze({
  spending: "Forces' funds",
  technology: "Forces' arms",
  quality: "Forces' training",
  land: "Fighters",
  sea: "Boats",
  air: "Aircraft",
});
export const EFFECT_WORD_LABELS = Object.freeze({
  relation: "Relation",
  reputation: "Standing",
  takes: "takes",
  releases: "gives up",
  ceasefire: "Their war goes to a ceasefire",
  warEnds: "Their war ends",
  months: "Term",
  noTerm: "No set term",
  breaker: "The one who breaks it",
  none: "No effects written",
});
const TREATY_STATUS_LABELS = Object.freeze({
  signed: "Signed",
  declined: "Refused",
  withdrawn: "Withdrawn",
  lapsed: "No longer on the table",
});

const kindOf = (type) => AGREEMENT_TYPE_LABELS[type] ?? AGREEMENT_TYPE_LABELS.other;
const signed = (value) => `${value > 0 ? "+" : ""}${Math.round(value * 100) / 100}`;
const money = (value) => {
  const number = Number(value) || 0;
  if (number >= 1e12) return `$${(number / 1e12).toFixed(2)}T`;
  if (number >= 1e9) return `$${(number / 1e9).toFixed(2)}B`;
  if (number >= 1e6) return `$${(number / 1e6).toFixed(1)}M`;
  return `$${Math.round(number).toLocaleString()}`;
};
const Name = ({ value }) => (fold(value) === "breaker" ? <span>{EFFECT_WORD_LABELS.breaker}</span> : <span data-no-translate>{value}</span>);

// One effect, in a line.
const EffectLine = ({ effect }) => {
  const number = (text) => <span data-no-translate style={{ fontVariantNumeric: "tabular-nums", fontWeight: 760 }}>{text}</span>;
  let body = null;
  if (effect.type === "stat") {
    const percent = effect.stat === "economy.gdp" || effect.stat === "population.total";
    body = <><Name value={effect.party} />: {EFFECT_STAT_LABELS[effect.stat] ? <span>{EFFECT_STAT_LABELS[effect.stat]}</span> : <span data-no-translate>{effect.stat}</span>} {number(`${signed(effect.change)}${percent ? "%" : ""}`)}</>;
  } else if (effect.type === "relation") {
    body = <><Name value={effect.party} /> ↔ <Name value={effect.with} />: {EFFECT_WORD_LABELS.relation} {number(signed(effect.change))}</>;
  } else if (effect.type === "reputation") {
    body = <><Name value={effect.party} />: {EFFECT_WORD_LABELS.reputation} {number(signed(effect.change))}</>;
  } else if (effect.type === "payment") {
    body = <><Name value={effect.from} /> → <Name value={effect.to} />: {number(money(effect.amount))}</>;
  } else if (effect.type === "strength") {
    body = <><Name value={effect.party} />: {EFFECT_STRENGTH_LABELS[effect.figure] ?? effect.figure} {number(signed(effect.change))}</>;
  } else if (effect.type === "area") {
    body = <><Name value={effect.group} /> {effect.op === "take" ? EFFECT_WORD_LABELS.takes : EFFECT_WORD_LABELS.releases} <span data-no-translate>{effect.region}</span></>;
  } else if (effect.type === "war") {
    body = <span>{effect.op === "end" ? EFFECT_WORD_LABELS.warEnds : EFFECT_WORD_LABELS.ceasefire}</span>;
  }
  return body ? <li style={{ lineHeight: 1.45 }}>{body}</li> : null;
};

// An agreement's effects (runtime/agreementEffects.js), grouped by when they happen.
export const EffectList = ({ effects, compact = false }) => {
  const shown = normalizeAgreementEffects(effects);
  if (!shown) return <div style={{ color: "var(--oh-ui-muted, rgba(255,255,255,0.5))", fontSize: compact ? "0.6rem" : "0.66rem" }}>{EFFECT_WORD_LABELS.none}</div>;
  return (
    <div data-agreement-effects="true" style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: compact ? "0.6rem" : "0.68rem", color: "var(--oh-ui-text, #e7e9ea)" }}>
      <div style={{ color: "var(--oh-ui-muted, rgba(255,255,255,0.55))" }}>
        {EFFECT_WORD_LABELS.months}: {shown.months ? <span data-no-translate>{`${shown.months} mo`}</span> : EFFECT_WORD_LABELS.noTerm}
      </div>
      {AGREEMENT_EFFECT_LISTS.filter((list) => shown[list]?.length).map((list) => (
        <div key={list}>
          <div style={{ color: "var(--oh-ui-accent, #2bc1f3)", fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{EFFECT_LIST_LABELS[list]}</div>
          <ul style={{ margin: "0.1rem 0 0", paddingLeft: "1rem" }}>
            {shown[list].map((effect, at) => <EffectLine key={`${list}-${at}`} effect={effect} />)}
          </ul>
        </div>
      ))}
    </div>
  );
};

const buttonStyle = (primary, busy = false) => ({
  background: primary ? "var(--oh-ui-accent, #2bc1f3)" : "var(--oh-ui-surface, rgba(255,255,255,0.06))",
  border: `1px solid ${primary ? "var(--oh-ui-accent, #2bc1f3)" : "var(--oh-ui-line, rgba(255,255,255,0.18))"}`,
  borderRadius: "8px",
  color: primary ? "#04141a" : "var(--oh-ui-text, #e7e9ea)",
  cursor: busy ? "wait" : "pointer",
  flex: "1 1 auto",
  fontSize: "0.68rem",
  fontWeight: 800,
  minHeight: "2.3rem",
  padding: "0.35rem 0.6rem",
});

const cardStyle = (lit = false) => ({
  background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.04))",
  border: `1px solid ${lit ? "var(--oh-ui-accent, #2bc1f3)" : "var(--oh-ui-line, rgba(255,255,255,0.14))"}`,
  borderRadius: "12px",
  color: "var(--oh-ui-text, #e7e9ea)",
  display: "flex",
  flexDirection: "column",
  gap: "0.45rem",
  fontSize: "0.76rem",
  lineHeight: 1.4,
  margin: "0.35rem 0",
  padding: "0.7rem 0.85rem",
});
const kickerStyle = { color: "var(--oh-ui-muted, rgba(255,255,255,0.55))", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" };

// The rolled parchment the Propose deal button shows.
const ParchmentIcon = () => (
  <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="20">
    <path d="M7 4h11a2 2 0 0 1 2 2v1h-4" />
    <path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10" />
    <path d="M7 4a2 2 0 0 0-2 2v11" />
    <path d="M18 4a2 2 0 0 1 2 2" />
    <path d="M9 9h4M9 12h4" />
  </svg>
);

// The Propose deal button: a rolled parchment left of the message box, the theme's icon colour, the accent
// when hovered or open. Touch-sized.
export const ProposeDealButton = ({ open = false, onToggle, disabled = false }) => {
  const [hover, setHover] = useState(false);
  const lit = open || hover;
  return (
    <button
      type="button"
      className="oh-tap"
      data-propose-deal="true"
      aria-label="Propose deal"
      aria-pressed={open}
      title="Propose deal"
      disabled={disabled}
      onClick={() => onToggle?.()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        alignItems: "center",
        background: open ? "var(--oh-ui-active, rgba(43,193,243,.16))" : "var(--oh-ui-surface, rgba(255,255,255,0.05))",
        border: `1px solid ${lit ? "var(--oh-ui-accent, #2bc1f3)" : "var(--oh-ui-line, rgba(255,255,255,0.15))"}`,
        borderRadius: "10px",
        color: lit ? "var(--oh-ui-accent, #2bc1f3)" : "var(--oh-ui-muted, rgba(255,255,255,0.7))",
        cursor: disabled ? "default" : "pointer",
        display: "inline-flex",
        flexShrink: 0,
        height: "2.75rem",
        justifyContent: "center",
        minWidth: "2.75rem",
        padding: 0,
        width: "2.75rem",
      }}
    >
      <ParchmentIcon />
    </button>
  );
};

// The box a proposal is written in.
//   counterpart   who it is put to
//   busy          the chat is waiting on something
//   onSend        (text) => Promise<string>: "" once sent, else why not
//   onCancel      closes the box
export const ProposalBox = ({ counterpart = "", busy = false, onSend, onCancel }) => {
  const [text, setText] = useState("");
  const [said, setSaid] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const proposal = String(text ?? "").trim();
    if (!proposal || sending || busy) return;
    setSending(true);
    setSaid("");
    const why = await onSend?.(proposal);
    setSending(false);
    if (why) setSaid(why);
    else setText("");
  };
  return (
    <div data-proposal-box="true" style={{ marginBottom: ".5rem", padding: ".6rem .65rem", border: "1px solid var(--oh-ui-line, rgba(255,255,255,.1))", borderRadius: 10, background: "var(--oh-ui-overlay-card, rgba(255,255,255,.03))", display: "flex", flexDirection: "column", gap: ".42rem" }}>
      <div style={{ fontSize: ".62rem", fontWeight: 820, color: "var(--oh-ui-text, #e7e9ea)" }}>
        Propose a deal to <span data-no-translate>{counterpart}</span>
      </div>
      <div style={{ fontSize: ".6rem", lineHeight: 1.4, color: "var(--oh-ui-muted, rgba(255,255,255,.5))" }}>Write it out in your own words: what each side gives, gets and does, and for how long. Their answer writes the treaty and what it does.</div>
      <textarea
        aria-label="Your proposal"
        placeholder="We pay 2bn a year for exclusive port access at Tartus for 10 years, and they close their airspace to Israel."
        rows={4}
        maxLength={PROPOSAL_MOST}
        value={text}
        onChange={(event) => setText(event.target.value)}
        style={{ background: "var(--oh-ui-bg, rgba(0,0,0,0.35))", border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.16))", borderRadius: "6px", boxSizing: "border-box", color: "var(--oh-ui-text, #e7e9ea)", fontFamily: "inherit", fontSize: "0.74rem", padding: "0.4rem 0.5rem", resize: "vertical", width: "100%" }}
      />
      {said ? <div role="status" style={{ color: "#fca5a5", fontSize: ".6rem" }}>{said}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: ".35rem", flexWrap: "wrap" }}>
        <button type="button" className="oh-tap-row" onClick={() => onCancel?.()} style={{ ...buttonStyle(false), flex: "0 0 auto" }}>Cancel</button>
        <button type="button" className="oh-tap-row" data-proposal-send="true" disabled={sending || busy || !text.trim()} onClick={send} style={{ ...buttonStyle(true, sending || busy), flex: "0 0 auto" }}>Send proposal</button>
      </div>
    </div>
  );
};

// A treaty drafted in the chat.
//   offer     a world.treatyOffers entry drafted by a leader (`drafted`)
//   viewer    the player's country
//   onAnswer  (op, offer) => Promise<string>
export const TreatyCard = ({ offer, viewer, onAnswer }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = fold(offer?.from) === fold(viewer);
  const toMe = fold(offer?.to) === fold(viewer);
  const open = offer?.status === "open";
  const act = async (op) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const why = await onAnswer?.(op, offer);
    setBusy(false);
    if (why) setError(why);
  };
  const state = open ? (mine ? "Waiting for their answer" : "") : TREATY_STATUS_LABELS[offer?.status] ?? "";
  return (
    <div role="group" data-treaty-card={offer?.id} style={{ ...cardStyle(open && toMe), opacity: open || offer?.status === "signed" ? 1 : 0.8 }}>
      <span style={kickerStyle}>
        {mine ? <>Your proposal · <span data-no-translate>{offer?.to}</span></> : <>Counter-offer · <span data-no-translate>{offer?.from}</span></>}
        {state ? <> · {state}</> : null}
      </span>
      {clean(offer?.proposal) ? <div data-no-translate style={{ color: "var(--oh-ui-muted, rgba(255,255,255,0.62))", fontStyle: "italic", whiteSpace: "pre-wrap" }}>{offer.proposal}</div> : null}
      <div style={{ fontWeight: 800 }}>
        {kindOf(offer?.type)}
        {clean(offer?.title) ? <>: <span data-no-translate>{offer.title}</span></> : null}
      </div>
      {offer?.parties?.length ? <div data-no-translate style={{ color: "var(--oh-ui-muted, rgba(255,255,255,0.6))", fontSize: "0.66rem" }}>{offer.parties.join(" · ")}</div> : null}
      {clean(offer?.terms) ? <div data-no-translate style={{ whiteSpace: "pre-wrap" }}>{offer.terms}</div> : null}
      <EffectList effects={offer?.effects} />
      {error ? <div role="alert" style={{ color: "#fca5a5" }}>{error}</div> : null}
      {open && toMe ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("sign")} style={buttonStyle(true, busy)}>Sign</button>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("decline")} style={buttonStyle(false, busy)}>Decline</button>
        </div>
      ) : null}
      {open && mine ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("withdraw")} style={buttonStyle(false, busy)}>Withdraw</button>
        </div>
      ) : null}
    </div>
  );
};

// The agreements in force between the player and the other side of a chat, with their effects and End.
export const AgreementsInForce = ({ agreements = [], onEnd }) => {
  const [armed, setArmed] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!agreements.length) return null;
  const end = async (agreement) => {
    if (busy) return;
    if (armed !== agreement.id) {
      setArmed(agreement.id);
      return;
    }
    setBusy(agreement.id);
    setError("");
    const why = await onEnd?.(agreement);
    setBusy("");
    setArmed("");
    if (why) setError(why);
  };
  return (
    <div data-agreements-in-force="true" style={{ ...cardStyle(false), gap: "0.55rem" }}>
      <span style={kickerStyle}>Deals in force</span>
      {agreements.map((agreement) => {
        const ending = armed === agreement.id;
        return (
          <div key={agreement.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 12rem", minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <div style={{ fontWeight: 780, fontSize: "0.74rem" }}>
                {kindOf(agreement.type)}
                {clean(agreement.title) ? <>: <span data-no-translate>{agreement.title}</span></> : null}
              </div>
              <EffectList compact effects={agreement.effects} />
            </div>
            <button
              type="button"
              className="oh-tap"
              disabled={busy === agreement.id}
              onClick={() => end(agreement)}
              onBlur={() => setArmed((value) => (value === agreement.id ? "" : value))}
              style={{ ...buttonStyle(false, busy === agreement.id), flex: "0 0 auto", minHeight: "2.1rem", borderColor: ending ? "#f87171" : "var(--oh-ui-line, rgba(255,255,255,0.18))", color: ending ? "#fca5a5" : "var(--oh-ui-text, #e7e9ea)" }}
            >{ending ? "End it?" : "End"}</button>
          </div>
        );
      })}
      {error ? <div role="alert" style={{ color: "#fca5a5", fontSize: "0.66rem" }}>{error}</div> : null}
    </div>
  );
};

// Why a treaty could not be done, in words for the player.
export const TREATY_REASON_TEXT = Object.freeze({
  "not-open": "That treaty is no longer on the table.",
  "not-yours": "That is not yours to answer.",
  "at-war": "You are at war with each other now.",
});
export const treatyReasonText = (reason) => TREATY_REASON_TEXT[reason] ?? (reason ? "That could not be done." : "");
