/*! Open Historia — war and peace on screen: an offer of peace, a call to arms, terms of one's own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "A peace offer the player accepts or declines, with war weariness." "Also
// have war weariness, wars that end with terms and reparations." "Alliances
// that pull members into wars, with broken treaties costing reputation."
// "make it so peace is offered through the diplomatic chats instead of as a
// popup" (the owner, 2026-10-30).
//
// What the game itself decides of these is in AI/warAndPeace.js. This is what
// a player sees and answers:
//
//   CallToArmsCard     in a diplomatic chat, under the message in which an ally
//                      that was attacked asks the player for help: Honour the
//                      alliance / Break the treaty, and nothing said of what
//                      either does ("it should not explain what happens if you
//                      choose each option as that breaks immersion", the owner,
//                      2026-11-06). It was a card over the map.
//   PeaceOfferCard     in a diplomatic chat (chat.jsx), on the message that
//                      made it: an offer of peace and its terms. The player's
//                      to accept or decline when it was made to them; their
//                      own terms, waiting for the other side's leader, when
//                      they put them.
//   PeaceTermsForm     in the chat with an enemy nobody plays: the player's own
//                      terms, which the chat sends as a message for that
//                      enemy's leader to answer.
//   PeaceControls      under each of the player's wars in the Stats pane's
//                      Diplomacy tab: how weary each side is, and Propose
//                      peace, which opens the chat with the enemy.
//   ReparationsNote    in the same tab: who is paying whom, and for how long.
//
// An answer is the player's own country's and nobody else's. On a page that
// is playing a shared game it goes to the host as a request.

import React, { useState } from "react";
import { TERRITORY_AS_HELD, TERRITORY_RESTORED, cessionsByReceiver, normalizeReparations } from "../../runtime/peaceTerms.js";
import { puppetKindLabel } from "../../runtime/puppets.js";
import { wearinessOf, wearinessWord } from "../../runtime/warWeariness.js";
import { inSharedGame, requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";
import { answerDiplomacy } from "../AI/gameplayLazy.js";
import { TURN_RUNNING_NOTE, isSimulationBusy } from "../AI/simulationStatus.js";

const NONE = Object.freeze([]);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

// Why nothing was done, in the player's words.
const refusalText = (error) => {
  if (error === "not-open") return "This is no longer open.";
  if (error === "not-yours") return "This is not yours to answer.";
  if (error === "played") return "That side is led by another player: make peace with them in a chat.";
  if (error === "no-war") return "That war is over.";
  if (error === "not-in-war") return "You are not in that war.";
  return clean(error) || "That could not be done.";
};

// Sends one answer: to the host of a shared game, else to the game itself.
//   where   for "propose": { chatId, messageId }, the thread and the message that put the terms
// Resolves { ok, error, accepted, to, offerId }.
export const sendPeaceAnswer = async (op, ref, terms = null, where = {}) => {
  if (isSimulationBusy()) return { ok: false, error: TURN_RUNNING_NOTE, accepted: false, to: "" };
  try {
    if (inSharedGame()) {
      const answer = await requestFromHost("peace", { op, ref, terms: terms ?? {} });
      return { ok: answer.ok === true, error: answer.ok ? "" : clean(answer.error), accepted: answer.ok === true && (op === "accept" || op === "honour"), to: "" };
    }
    return await answerDiplomacy({ op, ref, terms, chatId: clean(where.chatId), messageId: clean(where.messageId) });
  } catch (error) {
    return { ok: false, error: clean(error?.message) || "That could not be done.", accepted: false, to: "" };
  }
};
const send = sendPeaceAnswer;
export { refusalText as peaceRefusalText };

// Terms in the player's words: the ground, the land and the country handed
// over, the money, and any other conditions.
export const TermsText = ({ terms }) => {
  const payment = terms?.reparations ?? null;
  const share = payment ? Math.round(payment.share * 1000) / 10 : 0;
  const annexed = terms?.annexed ?? null;
  const puppet = terms?.puppet ?? null;
  const conditions = Array.isArray(terms?.conditions) ? terms.conditions : NONE;
  return (
    <>
      {annexed
        ? <div><span data-no-translate>{annexed.country}</span> is annexed: all its land passes to <span data-no-translate>{annexed.by}</span>.</div>
        : <div>{terms?.territory === TERRITORY_AS_HELD ? "Each side keeps the ground it holds." : "Every region goes back to whose it was before the war."}</div>}
      {cessionsByReceiver(terms?.cessions).map(({ to, regions }) => (
        <div key={to}>Ceded to <span data-no-translate>{to}</span>: <span data-no-translate>{regions.join(", ")}</span>.</div>
      ))}
      {puppet ? <div><span data-no-translate>{`${puppet.subject} becomes ${puppet.overlord}'s ${puppetKindLabel(puppet.kind)}.`}</span></div> : null}
      <div>{payment ? `${payment.payer} pays ${payment.receiver} reparations: ${share}% of its economy a year for ${payment.years} years.` : "Nobody pays reparations."}</div>
      {conditions.length > 0 ? (
        <div>
          <div>And:</div>
          {conditions.map((condition) => <div key={condition} data-no-translate>{`- ${condition}`}</div>)}
        </div>
      ) : null}
    </>
  );
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

// ---- in a diplomatic chat -----------------------------------------------------------------

const CALL_STATUS_TEXT = Object.freeze({
  honoured: "You answered the call",
  refused: "You refused",
  lapsed: "No longer open",
});

// A call to arms, under the message in which the ally that was attacked asked
// for help (runtime/alliances.js world.callsToArms). Asked of the player and
// still open: its two answers. Answered: what the answer was.
//   call      a world.callsToArms entry
//   viewer    the player's country
export const CallToArmsCard = ({ call, viewer }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (fold(call?.ally) !== fold(viewer)) return null;
  const open = call?.status === "open";
  const act = async (op) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const answer = await send(op, call.id);
    setBusy(false);
    if (!answer.ok) setError(refusalText(answer.error));
  };
  return (
    <div role="group" data-call-to-arms={call?.id} style={{ display: "flex", flexDirection: "column", gap: "0.4rem", margin: "0.35rem 0" }}>
      {error ? <div role="alert" style={{ color: "#fca5a5", fontSize: "0.74rem" }}>{error}</div> : null}
      {open ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("honour")} style={buttonStyle(true)}>Honour the alliance</button>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("refuse")} style={buttonStyle(false)}>Break the treaty</button>
        </div>
      ) : (
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", fontWeight: 700 }}>{CALL_STATUS_TEXT[call?.status] ?? ""}</span>
      )}
    </div>
  );
};

const OFFER_STATUS_TEXT = Object.freeze({
  accepted: "Accepted: the war is over",
  declined: "Declined",
  lapsed: "No longer on the table",
});

// An offer of peace, in the chat it was made in, under the message that made
// it. Made to the player and still open: Accept / Decline. The player's own
// terms: waiting for an answer, or what became of them.
//   offer     a world.peaceOffers entry
//   viewer    the player's country
export const PeaceOfferCard = ({ offer, viewer }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = fold(offer?.from) === fold(viewer);
  const toMe = fold(offer?.to) === fold(viewer);
  const open = offer?.status === "open";
  const act = async (op) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const answer = await send(op, offer.id);
    setBusy(false);
    if (!answer.ok) setError(refusalText(answer.error));
  };
  const state = open ? (mine ? "Waiting for their answer" : "") : OFFER_STATUS_TEXT[offer?.status] ?? "";
  return (
    <div role="group" data-peace-offer={offer?.id} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${open && toMe ? "rgba(43,193,243,0.55)" : "rgba(255,255,255,0.14)"}`, borderRadius: "12px", color: "#e7e9ea", display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.78rem", lineHeight: 1.4, margin: "0.35rem 0", opacity: open ? 1 : 0.72, padding: "0.7rem 0.85rem" }}>
      <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {mine ? <>Your terms of peace · <span data-no-translate>{offer?.to}</span></> : <>Peace offered · <span data-no-translate>{offer?.from}</span></>}
        {state ? <> · {state}</> : null}
      </span>
      <div style={{ color: "rgba(255,255,255,0.85)" }}><TermsText terms={offer?.terms} /></div>
      {error ? <div role="alert" style={{ color: "#fca5a5" }}>{error}</div> : null}
      {open && toMe ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("accept")} style={buttonStyle(true)}>Accept</button>
          <button type="button" className="oh-tap" disabled={busy} onClick={() => act("decline")} style={buttonStyle(false)}>Decline</button>
        </div>
      ) : null}
    </div>
  );
};

const REPARATION_CHOICES = Object.freeze([
  { key: "none", label: "Nobody pays" },
  { key: "they-light", label: "They pay 1% a year for 5 years" },
  { key: "they-heavy", label: "They pay 3% a year for 10 years" },
  { key: "we-light", label: "We pay 1% a year for 5 years" },
  { key: "we-heavy", label: "We pay 3% a year for 10 years" },
]);
const paymentOf = (key, mine, theirs) => {
  if (key === "none") return null;
  const heavy = key.endsWith("heavy");
  const [payer, receiver] = key.startsWith("they") ? [theirs, mine] : [mine, theirs];
  return { payer, receiver, share: heavy ? 0.03 : 0.01, years: heavy ? 10 : 5 };
};

const fieldStyle = { backgroundColor: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "6px", color: "#e7e9ea", fontSize: "0.66rem", padding: "0.3rem 0.4rem", width: "100%" };

// What becomes of the enemy country: "free" (nothing), "annex" (all its land is
// the player's), or a kind of puppet of the player's (runtime/puppets.js).
const COUNTRY_CHOICES = Object.freeze([
  { key: "free", label: "Their country stays independent" },
  { key: "annex", label: "We annex all of their country" },
  { key: "satellite", label: "Their country becomes our puppet state" },
  { key: "protectorate", label: "Their country becomes our protectorate" },
  { key: "client", label: "Their country becomes our client state" },
]);
const regionNames = (text) => clean(text).split(/\s*,\s*/).map(clean).filter(Boolean);

// The terms the form makes.
//   ground, money, country    the three choices
//   theirs, ours              regions each side cedes, by name, comma between
//   more                      any other conditions, a line each
export const termsFromForm = ({ viewer = "", enemy = "", ground = TERRITORY_RESTORED, money = "none", country = "free", theirs = "", ours = "", more = "" } = {}) => {
  const mine = clean(viewer);
  const other = clean(enemy);
  return {
    territory: ground,
    reparations: paymentOf(money, mine, other),
    ...(country === "annex" ? { annexed: { country: other, by: mine } } : {}),
    ...(["satellite", "protectorate", "client"].includes(country) ? { puppet: { subject: other, overlord: mine, kind: country } } : {}),
    cessions: [...regionNames(theirs).map((region) => ({ region, to: mine })), ...regionNames(ours).map((region) => ({ region, to: other }))],
    conditions: String(more ?? "").split(/\r?\n/).map(clean).filter(Boolean),
  };
};

// The player's own terms, put to an enemy nobody plays in the chat with it.
// The chat sends them as the player's message; that enemy's leader answers in
// its reply (AI/warAndPeace.js answerPeaceProposal).
//   viewer, enemy   the player's country and the enemy's
//   busy            the chat is waiting on a reply
//   onSend          (terms) => Promise<string>: "" once they were put, else why not
//   onCancel        closes the form
export const PeaceTermsForm = ({ viewer, enemy, busy = false, onSend, onCancel }) => {
  const [territory, setTerritory] = useState(TERRITORY_RESTORED);
  const [money, setMoney] = useState("none");
  const [country, setCountry] = useState("free");
  const [theirs, setTheirs] = useState("");
  const [ours, setOurs] = useState("");
  const [more, setMore] = useState("");
  const [said, setSaid] = useState("");
  const [sending, setSending] = useState(false);
  const put = async () => {
    if (sending || busy) return;
    setSending(true);
    setSaid("");
    const error = await onSend?.(termsFromForm({ viewer, enemy, ground: territory, money, country, theirs, ours, more }));
    setSending(false);
    if (error) setSaid(refusalText(error));
  };
  return (
    <div data-peace-terms-form="true" style={{ marginBottom: ".5rem", padding: ".55rem .62rem", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, background: "rgba(255,255,255,.03)", display: "flex", flexDirection: "column", gap: ".38rem" }}>
      <div style={{ fontSize: ".56rem", fontWeight: 820, color: "var(--oh-grey-text)" }}>Propose peace</div>
      <div style={{ fontSize: ".51rem", lineHeight: 1.35, color: "rgba(255,255,255,.38)" }}>Your terms are sent in this chat. Their leader answers them in the reply: accepts, declines or offers other terms.</div>
      <select aria-label="The ground" value={territory} onChange={(event) => setTerritory(event.target.value)} style={fieldStyle}>
        <option value={TERRITORY_RESTORED}>The old borders: every region goes back</option>
        <option value={TERRITORY_AS_HELD}>Each side keeps the ground it holds</option>
      </select>
      <select aria-label="Their country" value={country} onChange={(event) => setCountry(event.target.value)} style={fieldStyle}>
        {COUNTRY_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select>
      {country !== "annex" ? <input aria-label="Regions they cede to us" placeholder="Regions they cede to us, by name, comma between" value={theirs} onChange={(event) => setTheirs(event.target.value)} style={fieldStyle} /> : null}
      <input aria-label="Regions we cede to them" placeholder="Regions we cede to them, by name, comma between" value={ours} onChange={(event) => setOurs(event.target.value)} style={fieldStyle} />
      <select aria-label="Reparations" value={money} onChange={(event) => setMoney(event.target.value)} style={fieldStyle}>
        {REPARATION_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select>
      <textarea aria-label="Other conditions" placeholder="Any other conditions, a line each" rows={2} value={more} onChange={(event) => setMore(event.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />
      {said ? <div role="status" style={{ color: "#fca5a5", fontSize: ".58rem" }}>{said}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: ".35rem" }}>
        <button type="button" className="oh-tap-row" onClick={() => onCancel?.()} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "transparent", color: "rgba(255,255,255,.58)", padding: ".3rem .48rem", fontSize: ".58rem", cursor: "pointer" }}>Cancel</button>
        <button type="button" className="oh-tap-row" disabled={sending || busy} onClick={put} style={{ border: "1px solid #2bc1f3", borderRadius: 8, background: "#2bc1f3", color: "#04141a", padding: ".3rem .52rem", fontSize: ".58rem", fontWeight: 800, cursor: sending || busy ? "wait" : "pointer" }}>Send terms</button>
      </div>
    </div>
  );
};

// ---- in the Stats pane --------------------------------------------------------------------

const smallButton = { background: "none", border: "none", color: "#2bc1f3", cursor: "pointer", display: "block", font: "inherit", fontSize: "0.61rem", fontWeight: 700, marginTop: "0.22rem", padding: 0, textAlign: "left" };

// Under one of a country's wars: how weary each side's first country is, and,
// where the war is the player's own and is being fought, Propose peace, which
// opens the chat with the enemy, where the terms are put (PeaceTermsForm).
//   war      the war as the pane lists it ({ id, status, sideA, sideB })
//   world    the world
//   viewer   the player's country
const WearyWord = ({ value }) => {
  const word = wearinessWord(value);
  return word === "exhausted" ? <>exhausted</>
    : word === "war-weary" ? <>war-weary</>
      : word === "strained" ? <>strained</>
        : word === "uneasy" ? <>uneasy</>
          : null;
};

export const PeaceControls = ({ war, world, viewer }) => {
  const sides = [Array.isArray(war?.sideA) ? war.sideA : NONE, Array.isArray(war?.sideB) ? war.sideB : NONE];
  const mine = sides.findIndex((members) => members.some((member) => fold(member) === fold(viewer)));
  const leads = [clean(sides[0][0]), clean(sides[1][0])].filter(Boolean);
  const theirs = mine >= 0 ? clean(sides[1 - mine][0]) : "";
  const own = mine >= 0 ? clean(sides[mine].find((member) => fold(member) === fold(viewer))) : "";
  const weary = (mine >= 0 ? [own, theirs].filter(Boolean) : leads)
    .map((name) => ({ name, value: Math.round(wearinessOf(world?.warWeariness, name)) }))
    .filter((entry) => entry.value > 0);
  const fought = ["active", "ceasefire"].includes(fold(war?.status || "active"));
  // (Loaded when asked: the chat panel imports this file.)
  const openChat = () => import("./chat.jsx").then((module) => module.requestDiplomaticChat(theirs)).catch(() => {});
  return (
    <div style={{ marginTop: "0.25rem" }}>
      {weary.length > 0 ? (
        <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.61rem" }}>
          <span>War weariness: </span>
          {weary.map((entry, at) => (
            <React.Fragment key={entry.name}>
              {at > 0 ? " · " : null}
              <span data-no-translate>{`${entry.name} ${entry.value}`}</span>
              {wearinessWord(entry.value) ? <> (<WearyWord value={entry.value} />)</> : null}
            </React.Fragment>
          ))}
        </div>
      ) : null}
      {mine >= 0 && fought && theirs ? (
        <button type="button" className="oh-tap-row" onClick={openChat} style={smallButton}>Propose peace in the chat</button>
      ) : null}
    </div>
  );
};

// Who is paying a country reparations, and whom it pays.
export const ReparationsNote = ({ world, target }) => {
  const key = fold(target);
  const rows = normalizeReparations(world?.reparations).filter((entry) => fold(entry.payer) === key || fold(entry.receiver) === key);
  if (rows.length === 0) return null;
  return (
    <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.66rem", lineHeight: 1.45, marginTop: "0.55rem" }}>
      <div style={{ fontWeight: 800 }}>Reparations</div>
      {rows.map((entry) => {
        const years = Math.max(0, entry.days - entry.paidDays) / 365;
        return <div key={entry.id}>{`${entry.payer} pays ${entry.receiver} ${Math.round(entry.share * 1000) / 10}% of its economy a year, for ${Math.round(years * 10) / 10} more years.`}</div>;
      })}
    </div>
  );
};

