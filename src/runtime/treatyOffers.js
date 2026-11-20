/*! Open Historia — treaties people sign © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Treaties and alliances between people: a sign action both must accept,
// which becomes a record the map, wars and AI governments all see" (the
// owner, 2026-11-15, deciding how people make treaties in a shared game). A
// treaty between two countries people play was words in their chat, which the
// next skip's AI might write down or not.
//
// Now one of them puts a treaty to the other (proposeTreaty), the other signs
// or declines it, and the one who put it may withdraw it while it waits
// (answerTreaty). A treaty signed is an agreement of the world's
// (world.agreements), like any the story writes: an alliance calls its members
// to arms (runtime/alliances.js), and the map's diplomatic view and every
// prompt read it.
//
// world.treatyOffers: [{ id, from, to, type, title, terms, date, round, status, answeredRound?, agreementId? }]
//   status   "open" | "signed" | "declined" | "withdrawn" | "lapsed"
//
// Only between two countries people play (the agreements of the AI's
// countries are the story's to write), not at war with each other (peace is
// made by its own offers: Game/AI/warAndPeace.js), one open between the same
// two at a time. Until it is signed an offer is the two's own business
// (multiplayer/host/projection.js). Pure, and loads in plain Node.

import { warBetween } from "./peaceTerms.js";
import { isDirectedGroupDeal, isGroupDealType, isUnilateralGroupDeal } from "./groupParties.js";

// The agreements people may sign (runtime/gameState.js WORLD_AGREEMENT_TYPE_SET): not a guarantee, which binds one
// way and names who, nor a peace settlement, which is a peace's own (world.peaceTreaties).
export const TREATY_TYPES = Object.freeze([
  "alliance",
  "mutual_defense",
  "military_cooperation",
  "non_aggression",
  "neutrality",
  "military_access",
  "friendship_consultation",
  "trade_economic",
  "other",
]);
export const TREATY_STATUSES = Object.freeze(["open", "signed", "declined", "withdrawn", "lapsed"]);
// An offer nobody answered for this many rounds lapses.
export const TREATY_OFFER_STANDS_ROUNDS = 4;
export const TREATY_TITLE_MAX = 120;
export const TREATY_TERMS_MAX = 1200;
const OFFERS_KEPT_MOST = 40;

const clean = (value, most = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const whole = (value) => Math.max(0, Math.trunc(Number(value) || 0));
// Terms keep their lines.
const termsText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, TREATY_TERMS_MAX).trim();

const normalizeTreatyOffer = (raw) => {
  const id = clean(raw?.id, 160);
  const from = clean(raw?.from);
  const to = clean(raw?.to);
  // (A deal with a group, runtime/groupDeals.js, is put the same way: proposeDeal.)
  const type = TREATY_TYPES.includes(raw?.type) || (isGroupDealType(raw?.type) && !isUnilateralGroupDeal(raw?.type)) ? raw.type : "";
  if (!id || !from || !to || fold(from) === fold(to) || !type) return null;
  const status = TREATY_STATUSES.includes(raw?.status) ? raw.status : "open";
  return {
    id,
    from,
    to,
    type,
    title: clean(raw?.title, TREATY_TITLE_MAX),
    terms: termsText(raw?.terms),
    date: clean(raw?.date, 40),
    round: whole(raw?.round),
    status,
    ...(status !== "open" && Number.isFinite(Number(raw?.answeredRound)) ? { answeredRound: whole(raw.answeredRound) } : {}),
    ...(status === "signed" && clean(raw?.agreementId, 160) ? { agreementId: clean(raw.agreementId, 160) } : {}),
    // A deal with a direction (groupParties.js): the one it was put to is the one who gives.
    ...(isDirectedGroupDeal(type) && raw?.giverIsTo === true ? { giverIsTo: true } : {}),
    // Put to a party nobody plays, whose leader answers it in the chat (`chatId`).
    ...(raw?.withLeader === true ? { withLeader: true } : {}),
    ...(clean(raw?.chatId, 160) ? { chatId: clean(raw.chatId, 160) } : {}),
  };
};

// world.treatyOffers as the world keeps it, in order: every open one, and the latest answered, at most
// OFFERS_KEPT_MOST in all.
export const normalizeTreatyOffers = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const offer = normalizeTreatyOffer(raw);
    if (offer) kept.set(offer.id, offer);
  }
  const all = [...kept.values()];
  const open = all.filter((offer) => offer.status === "open").slice(-OFFERS_KEPT_MOST);
  const room = OFFERS_KEPT_MOST - open.length;
  const answered = room > 0 ? all.filter((offer) => offer.status !== "open").slice(-room) : [];
  const keep = new Set([...open, ...answered]);
  return all.filter((offer) => keep.has(offer));
};

const openBetween = (offers, a, b) => normalizeTreatyOffers(offers).find((offer) => offer.status === "open"
  && [fold(offer.from), fold(offer.to)].sort().join("|") === [fold(a), fold(b)].sort().join("|")) ?? null;

// A country puts a treaty to another (a person's to a person's).
//   from, to          the two countries
//   type              one of TREATY_TYPES
//   title, terms      what it is called, and what it says, in the proposer's words
//   players           the countries people play
// Returns { world, offer, reason }: `reason` says why nothing was put ("" when it was): "nobody", "not-played" (the
// other country is the AI's), "type", "at-war" (the two are at war with each other: peace first), "open" (a treaty
// already waits between the two).
export const proposeTreaty = (world, { from = "", to = "", type = "", title = "", terms = "", players = [], date = "", round = 0 } = {}) => {
  const nothing = (reason) => ({ world, offer: null, reason });
  const played = new Set(list(players).map(fold).filter(Boolean));
  if (!clean(from) || !clean(to) || fold(from) === fold(to)) return nothing("nobody");
  if (!played.has(fold(to)) || !played.has(fold(from))) return nothing("not-played");
  if (!TREATY_TYPES.includes(type)) return nothing("type");
  if (warBetween(world?.wars, from, to)) return nothing("at-war");
  if (openBetween(world?.treatyOffers, from, to)) return nothing("open");
  const turn = whole(round);
  const offer = normalizeTreatyOffer({
    id: `treaty-offer:${fold(from)}:${fold(to)}:${turn}:${list(world?.treatyOffers).length}`,
    from: clean(from),
    to: clean(to),
    type,
    title,
    terms,
    date,
    round: turn,
    status: "open",
  });
  return { world: { ...world, treatyOffers: normalizeTreatyOffers([...list(world?.treatyOffers), offer]) }, offer, reason: "" };
};

// A deal put to a party nobody plays, or by one to a person: a group's leader
// answers it in the chat (Game/AI/gameplay.js answerDealInChat), a person with the
// offer's buttons. Unlike a treaty between people it may be put while the two
// fight, since a truce, an amnesty or a hostage exchange is made in a war.
//   type     one of TREATY_TYPES or a group deal (groupParties.js), never one declared alone
//   giver    "from" | "to": who gives, for a deal with a direction
//   withLeader   true when `to` is answered by its leader in the chat `chatId`
// Returns { world, offer, reason }, reason "" | "nobody" | "type" | "open".
export const proposeDeal = (world, { from = "", to = "", type = "", title = "", terms = "", giver = "from", date = "", round = 0, withLeader = false, chatId = "" } = {}) => {
  const nothing = (reason) => ({ world, offer: null, reason });
  if (!clean(from) || !clean(to) || fold(from) === fold(to)) return nothing("nobody");
  if (!(TREATY_TYPES.includes(type) || isGroupDealType(type)) || isUnilateralGroupDeal(type)) return nothing("type");
  if (openBetween(world?.treatyOffers, from, to)) return nothing("open");
  const turn = whole(round);
  const offer = normalizeTreatyOffer({
    id: `deal-offer:${fold(from)}:${fold(to)}:${turn}:${list(world?.treatyOffers).length}`,
    from: clean(from),
    to: clean(to),
    type,
    title,
    terms,
    date,
    round: turn,
    status: "open",
    giverIsTo: giver === "to",
    withLeader,
    chatId,
  });
  if (!offer) return nothing("type");
  return { world: { ...world, treatyOffers: normalizeTreatyOffers([...list(world?.treatyOffers), offer]) }, offer, reason: "" };
};

// The offer open between two, either way round, or null.
export const openOfferBetween = (offers, a, b) => openBetween(offers, a, b);

// A country answers a treaty put to it, or withdraws its own.
//   op        "sign" | "decline" (the one it was put to), "withdraw" (the one who put it)
//   ref       the offer's id
//   country   who is answering: the offer must be theirs to answer
//   players   the countries people play now, where they are known: a treaty is signed only while the one who put it
//             still plays their country (multiplayer/host/foundings.js withSeatLetGo lapses a let-go player's offers)
// Returns { world, error, agreement }: `error` is a word for why nothing was done ("" when it was): "not-open",
// "not-yours", "at-war" (the two went to war since: it lapses), "maker-gone" (its maker does not play their country
// now). Signed, `agreement` is the world's new agreement.
export const answerTreaty = (world, { op = "", ref = "", country = "", date = "", round = 0, players = null } = {}) => {
  const offers = normalizeTreatyOffers(world?.treatyOffers);
  const offer = offers.find((entry) => entry.id === clean(ref, 160));
  const nothing = (error) => ({ world, error, agreement: null });
  if (!offer || offer.status !== "open") return nothing("not-open");
  const turn = whole(round);
  const marked = (status, extra = {}) => offers.map((entry) => (entry.id === offer.id ? { ...entry, status, answeredRound: turn, ...extra } : entry));
  if (op === "withdraw") {
    if (fold(offer.from) !== fold(country)) return nothing("not-yours");
    return { world: { ...world, treatyOffers: normalizeTreatyOffers(marked("withdrawn")) }, error: "", agreement: null };
  }
  if (op !== "sign" && op !== "decline") return nothing("unknown");
  if (fold(offer.to) !== fold(country)) return nothing("not-yours");
  if (op === "decline") return { world: { ...world, treatyOffers: normalizeTreatyOffers(marked("declined")) }, error: "", agreement: null };
  if (Array.isArray(players) && !players.some((name) => fold(name) === fold(offer.from))) return nothing("maker-gone");
  if (!isGroupDealType(offer.type) && warBetween(world?.wars, offer.from, offer.to)) {
    return { world: { ...world, treatyOffers: normalizeTreatyOffers(marked("lapsed")) }, error: "at-war", agreement: null };
  }
  const day = clean(date, 40);
  const agreement = {
    id: `treaty:${fold(offer.from)}:${fold(offer.to)}:${turn}:${list(world?.agreements).length}`,
    title: offer.title,
    type: offer.type,
    status: "active",
    // Who gives first, for a deal with a direction (groupParties.js).
    parties: offer.giverIsTo ? [offer.to, offer.from] : [offer.from, offer.to],
    startedDate: day,
    lastUpdatedDate: day,
    terms: offer.terms,
    ...(offer.type === "military_access" ? { reciprocalAccess: true } : {}),
    createdRound: turn,
    updatedRound: turn,
  };
  return {
    world: {
      ...world,
      agreements: [...list(world?.agreements), agreement],
      treatyOffers: normalizeTreatyOffers(marked("signed", { agreementId: agreement.id })),
    },
    error: "",
    agreement,
  };
};

// At the end of a turn: an offer that stood unanswered for TREATY_OFFER_STANDS_ROUNDS, or whose two went to war with
// each other, lapses.
export const withTurnTreatyOffers = (offers, { wars = [], round = 0 } = {}) => {
  const turn = whole(round);
  return normalizeTreatyOffers(list(offers).map((offer) => {
    if (offer?.status !== "open") return offer;
    const stale = turn - whole(offer.round) >= TREATY_OFFER_STANDS_ROUNDS;
    // (A deal with a group is made in a war as well as out of one.)
    const atWar = !isGroupDealType(offer.type) && warBetween(wars, offer.from, offer.to);
    return stale || atWar ? { ...offer, status: "lapsed", answeredRound: turn } : offer;
  }));
};
