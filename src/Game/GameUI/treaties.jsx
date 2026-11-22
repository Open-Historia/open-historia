/*! Open Historia — treaties between players on screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Treaties and alliances between people: a sign action both must accept,
// which becomes a record the map, wars and AI governments all see" (the
// owner, 2026-11-15). In a shared game, in the one-on-one chat between two
// players (chat.jsx):
//
//   TreatyForm        Treaty in the composer: what kind of treaty, its name
//                     and its terms, put to the other player
//                     (runtime/treatyOffers.js proposeTreaty), with the
//                     player's own message saying so
//   TreatyOfferCard   at the foot of the thread, a treaty one of them put to
//                     the other: Sign / Decline for the one it was put to,
//                     Withdraw for the one who put it, and what became of it
//                     once answered. Signed, it is an agreement of the world's.
//
// Every answer goes to the host as a request: whose it is is the seat's
// country, and nothing on this screen.

import React, { useState } from "react";
import { TREATY_TERMS_MAX, TREATY_TITLE_MAX, TREATY_TYPES } from "../../runtime/treatyOffers.js";
import { AGREEMENT_TYPE_LABELS } from "../../runtime/diplomaticViews.js";
import { requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

// The treaties a thread shows: those between the player and the other side of a one-on-one chat, open first.
export const treatyOffersForThread = ({ offers = [], player = "", counterpart = "" } = {}) => {
  const pair = [fold(player), fold(counterpart)].sort().join("|");
  if (!fold(player) || !fold(counterpart)) return [];
  return (Array.isArray(offers) ? offers : [])
    .filter((offer) => [fold(offer?.from), fold(offer?.to)].sort().join("|") === pair)
    .filter((offer) => offer.status === "open" || offer.status === "signed")
    .slice(-3);
};

// Sends one thing done with a treaty to the host. Resolves "" when it was done, else why not, in words.
export const sendTreaty = async (op, fields = {}) => {
  try {
    const answer = await requestFromHost("treaty", { op, ...fields });
    return answer.ok ? "" : clean(answer.error) || "That could not be done.";
  } catch (error) {
    return clean(error?.message) || "That could not be done.";
  }
};

const buttonStyle = (primary) => ({
  backgroundColor: primary ? "#2bc1f3" : "rgba(255,255,255,0.06)",
  border: `1px solid ${primary ? "#2bc1f3" : "rgba(255,255,255,0.18)"}`,
  borderRadius: "8px",
  color: primary ? "#04141a" : "#e7e9ea",
  cursor: "pointer",
  flex: 1,
  fontSize: "0.72rem",
  fontWeight: 800,
  minHeight: "2.3rem",
  padding: "0.35rem 0.6rem",
});

const STATUS_TEXT = Object.freeze({
  signed: "Signed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  lapsed: "No longer on the table",
});

// A treaty one of the two put to the other.
//   offer     a world.treatyOffers entry
//   viewer    the player's country
export const TreatyOfferCard = ({ offer, viewer }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = fold(offer?.from) === fold(viewer);
  const toMe = fold(offer?.to) === fold(viewer);
  const open = offer?.status === "open";
  const act = async (op) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const why = await sendTreaty(op, { ref: offer.id });
    setBusy(false);
    if (why) setError(why);
  };
  const kind = AGREEMENT_TYPE_LABELS[offer?.type] ?? AGREEMENT_TYPE_LABELS.other;
  const state = open ? (mine ? "Waiting for their signature" : "") : STATUS_TEXT[offer?.status] ?? "";
  return (
    <div role="group" data-treaty-offer={offer?.id} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${open && toMe ? "rgba(43,193,243,0.55)" : "rgba(255,255,255,0.14)"}`, borderRadius: "12px", color: "#e7e9ea", display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.78rem", lineHeight: 1.4, margin: "0.35rem 0", opacity: open || offer?.status === "signed" ? 1 : 0.72, padding: "0.7rem 0.85rem" }}>
      <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {mine ? <>Your treaty · <span data-no-translate>{offer?.to}</span></> : <>Treaty offered · <span data-no-translate>{offer?.from}</span></>}
        {state ? <> · {state}</> : null}
      </span>
      <div style={{ fontWeight: 800 }}>
        {kind}
        {clean(offer?.title) ? <>: <span data-no-translate>{offer.title}</span></> : null}
      </div>
      {clean(offer?.terms) ? <div data-no-translate style={{ color: "rgba(255,255,255,0.85)", whiteSpace: "pre-wrap" }}>{offer.terms}</div> : null}
      {error ? <div role="alert" style={{ color: "#fca5a5" }}>{error}</div> : null}
      {open && toMe ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("sign")} style={buttonStyle(true)}>Sign</button>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("decline")} style={buttonStyle(false)}>Decline</button>
        </div>
      ) : null}
      {open && mine ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("withdraw")} style={buttonStyle(false)}>Withdraw</button>
        </div>
      ) : null}
    </div>
  );
};

const fieldStyle = { backgroundColor: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "6px", color: "#e7e9ea", fontSize: "0.66rem", padding: "0.3rem 0.4rem", width: "100%" };

// A treaty put to the other player of a one-on-one chat.
//   busy        the chat is waiting on something
//   onSend      ({ type, title, terms }) => Promise<string>: "" once it was put, else why not
//   onCancel    closes the form
export const TreatyForm = ({ busy = false, onSend, onCancel }) => {
  const [type, setType] = useState("alliance");
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("");
  const [said, setSaid] = useState("");
  const [sending, setSending] = useState(false);
  const put = async () => {
    if (sending || busy) return;
    setSending(true);
    setSaid("");
    const why = await onSend?.({ type, title: clean(title), terms: String(terms ?? "").trim() });
    setSending(false);
    if (why) setSaid(why);
  };
  return (
    <div data-treaty-form="true" style={{ marginBottom: ".5rem", padding: ".55rem .62rem", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, background: "rgba(255,255,255,.03)", display: "flex", flexDirection: "column", gap: ".38rem" }}>
      <div style={{ fontSize: ".56rem", fontWeight: 820, color: "var(--oh-grey-text)" }}>Propose a treaty</div>
      <div style={{ fontSize: ".51rem", lineHeight: 1.35, color: "rgba(255,255,255,.38)" }}>Once they sign it, it holds for both of you, and the world knows of it.</div>
      <select aria-label="Kind of treaty" value={type} onChange={(event) => setType(event.target.value)} style={fieldStyle}>
        {TREATY_TYPES.map((key) => <option key={key} value={key}>{AGREEMENT_TYPE_LABELS[key] ?? AGREEMENT_TYPE_LABELS.other}</option>)}
      </select>
      <input aria-label="Name of the treaty" placeholder="Name of the treaty" maxLength={TREATY_TITLE_MAX} value={title} onChange={(event) => setTitle(event.target.value)} style={fieldStyle} />
      <textarea aria-label="Its terms" placeholder="Its terms, a line each" rows={3} maxLength={TREATY_TERMS_MAX} value={terms} onChange={(event) => setTerms(event.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />
      {said ? <div role="status" style={{ color: "#fca5a5", fontSize: ".58rem" }}>{said}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: ".35rem" }}>
        <button type="button" className="oh-tap-row" onClick={() => onCancel?.()} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "transparent", color: "rgba(255,255,255,.58)", padding: ".3rem .48rem", fontSize: ".58rem", cursor: "pointer" }}>Cancel</button>
        <button type="button" className="oh-tap-row" disabled={sending || busy} onClick={put} style={{ border: "1px solid #2bc1f3", borderRadius: 8, background: "#2bc1f3", color: "#04141a", padding: ".3rem .52rem", fontSize: ".58rem", fontWeight: 800, cursor: sending || busy ? "wait" : "pointer" }}>Send treaty</button>
      </div>
    </div>
  );
};
