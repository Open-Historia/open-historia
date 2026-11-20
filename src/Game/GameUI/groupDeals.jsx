/*! Open Historia — deals with groups on screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A group (runtime/groups.js) is a party to diplomacy as a country is
// (runtime/groupParties.js). In the one-on-one chat with a group (chat.jsx):
//
//   GroupDealForm       Deal in the composer: what kind of deal, who gives where
//                       it has a direction, its name and its terms, put to the
//                       group, whose leadership answers in the chat; a
//                       crackdown is declared, not put
//   GroupDealOfferCard  at the foot of the thread, a deal one of them put to the
//                       other: Sign / Decline for the player when the group put
//                       it, Withdraw for the player's own
//   GroupDealsInForce   the deals in force between the two, each with End
//
// What each deal does is the game's (Game/AI/groupDeals.js); this only puts
// them. Every write goes through gameplayLazy.js playerGroupDeal: single player
// only, since a shared game's host keeps its world.

import React, { useState } from "react";
import { AGREEMENT_TYPE_LABELS } from "../../runtime/diplomaticViews.js";
import { TREATY_TERMS_MAX, TREATY_TITLE_MAX } from "../../runtime/treatyOffers.js";
import { GROUP_DEAL_TYPES, isDirectedGroupDeal, isUnilateralGroupDeal } from "../../runtime/groupParties.js";
import { normalizeGroups } from "../../runtime/groups.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

// The deals the form offers: a group's own, then a plain trade deal and any other.
export const GROUP_DEAL_FORM_TYPES = Object.freeze([...GROUP_DEAL_TYPES, "trade_economic", "other"]);

// Who gives, for a deal with a direction: [the player gives, the group gives].
export const GROUP_DEAL_DIRECTION_LABELS = Object.freeze({
  protection: ["We pay them", "They pay us"],
  sponsorship: ["We sponsor them", "They sponsor us"],
  amnesty: ["We grant it", "They grant it"],
  recognition: ["We recognise them", "They recognise us"],
});

// What the chosen deal does, shown under the choice while the form is open.
export const GROUP_DEAL_HINTS = Object.freeze({
  truce: "The fighting between you stops: a war between just the two of you goes to a ceasefire.",
  protection: "The payer pays a share of its wealth every year; a group that is paid grows stronger.",
  sponsorship: "The sponsor pays every year; a group that is sponsored grows stronger and better armed.",
  safe_passage: "Each side's people may cross the other's ground unharmed.",
  smuggling: "A country in it earns from the trade; a group in it grows stronger.",
  amnesty: "The group lays down its arms in the granting country: it gives up its ground there, and a war between you ends.",
  hostage_exchange: "The prisoners are exchanged at once.",
  recognition: "One side recognises the other as a lawful party.",
  crackdown: "Declared, not signed. It costs you every year, weakens them, and takes back their ground in your land region by region.",
  trade_economic: "Trade between you, on the terms you write.",
  other: "Whatever the terms you write say.",
});

const DEAL_STATUS_LABELS = Object.freeze({
  signed: "Signed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  lapsed: "No longer on the table",
});

// A group's banner where a country has a flag: its colour, with a dark band.
export const groupBannerDataUrl = (color) => {
  const fill = /^#[0-9a-f]{6}$/i.test(String(color ?? "")) ? String(color) : "#8a8f98";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="${fill}"/><path d="M0 14 L30 4 L30 9 L0 19 Z" fill="#0b0d10" fill-opacity="0.55"/><rect width="30" height="20" fill="none" stroke="#0b0d10" stroke-opacity="0.35"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// The groups the player may talk to, as the pickers list a country: { name, code, color, group }.
export const pickableGroupsOf = (world, player = "") => {
  const groups = normalizeGroups(world?.groups);
  return Object.values(groups)
    .filter((group) => fold(group.name) !== fold(player))
    .map((group) => ({ name: group.name, code: "", color: group.color, group: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const fieldStyle = {
  backgroundColor: "var(--oh-ui-bg, rgba(0,0,0,0.35))",
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.16))",
  borderRadius: "6px",
  color: "var(--oh-ui-text, #e7e9ea)",
  fontSize: "0.7rem",
  minHeight: "2rem",
  padding: "0.3rem 0.4rem",
  width: "100%",
  boxSizing: "border-box",
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
  gap: "0.4rem",
  fontSize: "0.78rem",
  lineHeight: 1.4,
  margin: "0.35rem 0",
  padding: "0.7rem 0.85rem",
});

const kickerStyle = { color: "var(--oh-ui-muted, rgba(255,255,255,0.55))", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" };

const kindOf = (type) => AGREEMENT_TYPE_LABELS[type] ?? AGREEMENT_TYPE_LABELS.other;

// Who gives in a deal with a direction, from the player's side.
const directionText = (type, giverIsPlayer) => {
  const labels = GROUP_DEAL_DIRECTION_LABELS[type];
  return labels ? labels[giverIsPlayer ? 0 : 1] : "";
};

// A deal put to a group from the composer.
//   group     the group's name
//   busy      the chat is waiting on something
//   onSend    ({ type, giver: "us" | "them", title, terms }) => Promise<string>: "" once put, else why not
//   onCancel  closes the form
export const GroupDealForm = ({ group = "", busy = false, onSend, onCancel }) => {
  const [type, setType] = useState("truce");
  const [giver, setGiver] = useState("us");
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("");
  const [said, setSaid] = useState("");
  const [sending, setSending] = useState(false);
  const declared = isUnilateralGroupDeal(type);
  const directed = isDirectedGroupDeal(type) && !declared;
  const put = async () => {
    if (sending || busy) return;
    setSending(true);
    setSaid("");
    const why = await onSend?.({ type, giver: declared ? "us" : giver, title: clean(title), terms: String(terms ?? "").trim() });
    setSending(false);
    if (why) setSaid(why);
  };
  return (
    <div data-group-deal-form="true" style={{ marginBottom: ".5rem", padding: ".6rem .65rem", border: "1px solid var(--oh-ui-line, rgba(255,255,255,.1))", borderRadius: 10, background: "var(--oh-ui-overlay-card, rgba(255,255,255,.03))", display: "flex", flexDirection: "column", gap: ".42rem" }}>
      <div style={{ fontSize: ".62rem", fontWeight: 820, color: "var(--oh-ui-text, #e7e9ea)" }}>
        {declared ? <>Declare against <span data-no-translate>{group}</span></> : <>A deal with <span data-no-translate>{group}</span></>}
      </div>
      <select aria-label="Kind of deal" value={type} onChange={(event) => setType(event.target.value)} style={fieldStyle}>
        {GROUP_DEAL_FORM_TYPES.map((key) => <option key={key} value={key}>{kindOf(key)}</option>)}
      </select>
      <div style={{ fontSize: ".6rem", lineHeight: 1.4, color: "var(--oh-ui-muted, rgba(255,255,255,.5))" }}>{GROUP_DEAL_HINTS[type]}</div>
      {directed && (
        <div role="radiogroup" aria-label="Who gives" style={{ display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
          {["us", "them"].map((side) => (
            <button
              key={side}
              type="button"
              role="radio"
              aria-checked={giver === side}
              className="oh-tap-row"
              onClick={() => setGiver(side)}
              style={{
                ...buttonStyle(false),
                flex: "1 1 8rem",
                minHeight: "2.1rem",
                background: giver === side ? "var(--oh-ui-active, rgba(43,193,243,.16))" : "var(--oh-ui-surface, rgba(255,255,255,0.06))",
                borderColor: giver === side ? "var(--oh-ui-accent, #2bc1f3)" : "var(--oh-ui-line, rgba(255,255,255,0.18))",
                color: giver === side ? "var(--oh-ui-accent, #2bc1f3)" : "var(--oh-ui-text, #e7e9ea)",
              }}
            >{directionText(type, side === "us")}</button>
          ))}
        </div>
      )}
      <input aria-label="Name of the deal" placeholder="Name of the deal" maxLength={TREATY_TITLE_MAX} value={title} onChange={(event) => setTitle(event.target.value)} style={fieldStyle} />
      <textarea aria-label="Its terms" placeholder="Its terms, a line each" rows={3} maxLength={TREATY_TERMS_MAX} value={terms} onChange={(event) => setTerms(event.target.value)} style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }} />
      {said ? <div role="status" style={{ color: "#fca5a5", fontSize: ".6rem" }}>{said}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: ".35rem", flexWrap: "wrap" }}>
        <button type="button" className="oh-tap-row" onClick={() => onCancel?.()} style={{ ...buttonStyle(false), flex: "0 0 auto" }}>Cancel</button>
        <button type="button" className="oh-tap-row" disabled={sending || busy} onClick={put} style={{ ...buttonStyle(true, sending || busy), flex: "0 0 auto" }}>{declared ? "Declare it" : "Put the deal"}</button>
      </div>
    </div>
  );
};

// A deal one of the two put to the other.
//   offer     a world.treatyOffers entry between the player and a group
//   viewer    the player's country
//   onAnswer  (op, offer) => Promise<string>: "" once done, else why not
export const GroupDealOfferCard = ({ offer, viewer, onAnswer }) => {
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
  // (The player gives when the player put it and it gives itself, or the group put it and the player is to give.)
  const giverIsPlayer = mine ? !offer?.giverIsTo : Boolean(offer?.giverIsTo);
  const direction = isDirectedGroupDeal(offer?.type) ? directionText(offer?.type, giverIsPlayer) : "";
  const state = open ? (mine ? "Waiting for their answer" : "") : DEAL_STATUS_LABELS[offer?.status] ?? "";
  return (
    <div role="group" data-group-deal-offer={offer?.id} style={{ ...cardStyle(open && toMe), opacity: open || offer?.status === "signed" ? 1 : 0.72 }}>
      <span style={kickerStyle}>
        {mine ? <>Your deal · <span data-no-translate>{offer?.to}</span></> : <>Deal offered · <span data-no-translate>{offer?.from}</span></>}
        {state ? <> · {state}</> : null}
      </span>
      <div style={{ fontWeight: 800 }}>
        {kindOf(offer?.type)}
        {clean(offer?.title) ? <>: <span data-no-translate>{offer.title}</span></> : null}
      </div>
      {direction ? <div style={{ color: "var(--oh-ui-muted, rgba(255,255,255,0.6))", fontSize: "0.7rem" }}>{direction}</div> : null}
      {clean(offer?.terms) ? <div data-no-translate style={{ whiteSpace: "pre-wrap" }}>{offer.terms}</div> : null}
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

// The deals in force between the player and a group, each with End (pressed twice: ending a deal
// short of its term is a deal broken, and the other side remembers it).
//   deals     world.agreements between the two, in force
//   viewer    the player's country
//   onEnd     (agreement) => Promise<string>
export const GroupDealsInForce = ({ deals = [], viewer = "", onEnd }) => {
  const [armed, setArmed] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!deals.length) return null;
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
    <div data-group-deals-in-force="true" style={{ ...cardStyle(false), gap: "0.3rem" }}>
      <span style={kickerStyle}>Deals in force</span>
      {deals.map((agreement) => {
        const giverIsPlayer = fold(agreement?.parties?.[0]) === fold(viewer);
        const direction = isDirectedGroupDeal(agreement?.type) ? directionText(agreement.type, giverIsPlayer) : "";
        const ending = armed === agreement.id;
        return (
          <div key={agreement.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 10rem", minWidth: 0 }}>
              <div style={{ fontWeight: 780, fontSize: "0.74rem" }}>
                {kindOf(agreement.type)}
                {clean(agreement.title) ? <>: <span data-no-translate>{agreement.title}</span></> : null}
              </div>
              {direction || agreement.type === "crackdown" ? (
                <div style={{ color: "var(--oh-ui-muted, rgba(255,255,255,0.55))", fontSize: "0.64rem" }}>
                  {agreement.type === "crackdown" ? (giverIsPlayer ? "Ours, against them" : "Theirs, against us") : direction}
                </div>
              ) : null}
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

// Why a deal could not be done, in words for the player.
export const GROUP_DEAL_REASON_TEXT = Object.freeze({
  open: "A deal between you is already waiting for an answer.",
  type: "That kind of deal cannot be put.",
  "not-a-group": "They are no longer a group on the map.",
  "not-open": "That deal is no longer on the table.",
  "not-yours": "That is not yours to answer.",
  nobody: "There is nobody to make it with.",
});
export const groupDealReasonText = (reason) => GROUP_DEAL_REASON_TEXT[reason] ?? (reason ? "That could not be done." : "");
