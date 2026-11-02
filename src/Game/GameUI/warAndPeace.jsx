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
//   WarAndPeaceCards   over the map, while a call to arms waits for the player:
//                      from an ally that was attacked (Honour the alliance /
//                      Break the treaty). It stays until it is answered, and
//                      can be folded away to a small button.
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
import { openCallsFor, TREATY_BROKEN_REPUTATION } from "../../runtime/alliances.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { TERRITORY_AS_HELD, TERRITORY_RESTORED, normalizeReparations } from "../../runtime/peaceTerms.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { wearinessOf, wearinessWord } from "../../runtime/warWeariness.js";
import { inSharedGame, requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";
import { answerDiplomacy } from "../AI/gameplayLazy.js";
import { TURN_RUNNING_NOTE, isSimulationBusy } from "../AI/simulationStatus.js";

const NONE = Object.freeze([]);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const selectCountry = (game) => clean(game?.country);
const selectCalls = (world) => (Array.isArray(world?.callsToArms) ? world.callsToArms : NONE);

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

// Terms in the player's words: the ground, then the money.
export const TermsText = ({ terms }) => {
  const payment = terms?.reparations ?? null;
  const share = payment ? Math.round(payment.share * 1000) / 10 : 0;
  return (
    <>
      <div>{terms?.territory === TERRITORY_AS_HELD ? "Each side keeps the ground it holds." : "Every region goes back to whose it was before the war."}</div>
      <div>{payment ? `${payment.payer} pays ${payment.receiver} reparations: ${share}% of its economy a year for ${payment.years} years.` : "Nobody pays reparations."}</div>
    </>
  );
};

const cardStyle = {
  backgroundColor: "rgba(16,21,24,0.97)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "12px",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#e7e9ea",
  fontFamily: "sans-serif",
  fontSize: "0.76rem",
  lineHeight: 1.45,
  padding: "0.7rem 0.8rem",
};
const titleStyle = { color: "rgba(255,255,255,0.55)", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" };
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

// One thing waiting for the player, with its two answers.
const DecisionCard = ({ title, children, yes, no, onYes, onNo }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (run) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const answer = await run();
    setBusy(false);
    if (!answer.ok) setError(refusalText(answer.error));
  };
  return (
    <div style={cardStyle} role="group">
      <div style={titleStyle}>{title}</div>
      <div style={{ marginTop: "0.3rem" }}>{children}</div>
      {error ? <div role="alert" style={{ color: "#fca5a5", marginTop: "0.4rem" }}>{error}</div> : null}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
        <button type="button" className="oh-tap" disabled={busy} onClick={() => act(onYes)} style={buttonStyle(true)}>{yes}</button>
        <button type="button" className="oh-tap" disabled={busy} onClick={() => act(onNo)} style={buttonStyle(false)}>{no}</button>
      </div>
    </div>
  );
};

// Over the map: the calls to arms that wait for the player. An offer of peace
// is not here: it is in the chat it was made in (PeaceOfferCard).
export const WarAndPeaceCards = () => {
  const country = useRuntimeState("game", selectCountry);
  const calls = useRuntimeState("world", selectCalls);
  const isMobile = useIsMobile();
  const [folded, setFolded] = useState(false);
  const called = country ? openCallsFor(calls, country) : NONE;
  const waiting = called.length;
  if (waiting === 0) return null;
  const place = isMobile
    ? { left: "0.5rem", right: "0.5rem", top: "4.75rem" }
    : { right: "1rem", top: "4.5rem", width: "min(22rem, calc(100vw - 2rem))" };
  if (folded) {
    return (
      <button type="button" className="oh-tap" onClick={() => setFolded(false)} style={{ ...cardStyle, cursor: "pointer", fontWeight: 800, position: "fixed", zIndex: 9000, ...place, width: "auto", left: "auto" }}>
        {`Waiting for your answer: ${waiting}`}
      </button>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "calc(100vh - 9rem)", overflowY: "auto", position: "fixed", zIndex: 9000, ...place }}>
      <button type="button" className="oh-tap" onClick={() => setFolded(true)} style={{ alignSelf: "flex-end", background: "rgba(16,21,24,0.9)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "999px", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: "0.66rem", fontWeight: 700, padding: "0.2rem 0.6rem" }}>Fold away</button>
      {called.map((call) => (
        <DecisionCard
          key={call.id}
          title="Call to arms"
          yes="Honour the alliance"
          no="Break the treaty"
          onYes={() => send("honour", call.id)}
          onNo={() => send("refuse", call.id)}
        >
          <div>{`${call.defender} has been attacked by ${call.attackers.join(", ") || "an enemy"} and calls on you to defend it.`}</div>
          {call.via.title ? <div style={{ color: "rgba(255,255,255,0.6)" }}>{`You are bound by ${call.via.title}.`}</div> : null}
          <div style={{ color: "rgba(255,255,255,0.6)", marginTop: "0.25rem" }}>{`Honouring it puts you at war. Breaking the treaty costs ${TREATY_BROKEN_REPUTATION} of your reputation, and ends it. Left unanswered, it counts as broken.`}</div>
        </DecisionCard>
      ))}
    </div>
  );
};

// ---- in a diplomatic chat -----------------------------------------------------------------

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
  const [said, setSaid] = useState("");
  const [sending, setSending] = useState(false);
  const put = async () => {
    if (sending || busy) return;
    setSending(true);
    setSaid("");
    const error = await onSend?.({ territory, reparations: paymentOf(money, clean(viewer), clean(enemy)) });
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
      <select aria-label="Reparations" value={money} onChange={(event) => setMoney(event.target.value)} style={fieldStyle}>
        {REPARATION_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select>
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

export default WarAndPeaceCards;
