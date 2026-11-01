/*! Open Historia — war weariness, alliances coming due, and peace on terms: what the game does with them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "A peace offer the player accepts or declines, with war weariness." "Also
// have war weariness, wars that end with terms and reparations." "Alliances
// that pull members into wars, with broken treaties costing reputation."
//
// The rules are in three small files that know nothing of the game's world
// (runtime/warWeariness.js, runtime/peaceTerms.js, runtime/alliances.js). This
// is where they meet it: the war ledger, who holds what, the sheets of
// statistics, reputations and agreements.
//
// Whether a country wants peace, and on what terms, is the AI's to say ("it
// should not be fully deterministic anymore", the owner, 2026-10-30): the time
// skip writes it (a letter offering a person peace, a peace two countries
// nobody plays have made), and so does a leader in a chat (an offer, or its
// answer to terms a person put). The game checks what it is told and carries
// it out.
//
// AT THE END OF EVERY TURN (turnWarAndPeace, called by the turn after the
// ledgers the story wrote are merged), in this order:
//
//   reparations   are paid for the period, out of the payer's sheet into the receiver's
//   alliances     the wars that began this turn call on those bound to defend
//                 whoever was attacked: countries nobody plays come in or break
//                 the treaty, and a person is asked
//   weariness     every country's is moved by what the turn did to it
//   peace         the peaces the skip says two sides nobody plays made are
//                 made; offers whose war is over, or that stood too long,
//                 lapse. The offers the skip's letters carry are added as the
//                 letters are written (offerPeace)
//
// BETWEEN TURNS a person answers: an offer of peace (acceptPeaceOffer,
// declinePeaceOffer), a call to arms (answerCallToArms), or puts terms of
// their own to an enemy nobody plays (proposePeace), which its leader answers
// in the chat (answerPeaceProposal).
//
// A PEACE MADE (makePeace) ends the war in the ledger, settles the ground the
// two sides hold of each other's as its terms say, begins any reparations, and
// is kept (world.peaceTreaties) for the next period's story to tell.
//
// Everything here takes a world and returns one: nothing is read or written
// but what it is handed, so the same turn applied twice is the same world.

import { TREATY_BROKEN_REPUTATION, agreementsWithout, callsForTurn, defendersOf, honoursCall, normalizeCallsToArms, reputationAfterBreaking } from "../../runtime/alliances.js";
import { diffGameDays } from "../../runtime/gameDates.js";
import { applyCountryStatPatchToWorld, applyEventImpactsToWorld } from "../../runtime/gameState.js";
import {
  TERRITORY_AS_HELD,
  describeTerms,
  normalizePeaceOffers,
  normalizePeaceTreaties,
  normalizeReparations,
  normalizeTerms,
  offerFromAi,
  openOfferBetween,
  reparationsDue,
  reparationsOf,
  treatyFromSkip,
  withOffer,
  withTurnPeaceOffers,
} from "../../runtime/peaceTerms.js";
import { startingWearinessOf } from "../../runtime/militaryStats.js";
import { landWeightsOf } from "../../runtime/militaryPower.js";
import { populationFigureOf } from "../../runtime/populationFigure.js";
import { normalizeWarWeariness, wearinessGoingIn, wearinessOf, withTurnWeariness } from "../../runtime/warWeariness.js";
import { economyRate, withTurnResources } from "../../runtime/warResources.js";
import { withTurnAttrition } from "../../runtime/attrition.js";
import { middleFundingPerHead } from "../../runtime/militaryFunding.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { applyWarUpdates } from "./nativeWarLedger.js";

const clean = (value, most = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const figure = (value) => {
  const read = Number(value);
  return Number.isFinite(read) ? read : 0;
};
const sidesOf = (war) => [list(war?.sideA).map((name) => clean(name)).filter(Boolean), list(war?.sideB).map((name) => clean(name)).filter(Boolean)];
const active = (war) => fold(war?.status || "active") === "active";
const settleable = (war) => ["active", "ceasefire"].includes(fold(war?.status || "active"));

// ---- who holds what -----------------------------------------------------------------------

// How many regions each country holds, from the world alone: Map of its name
// in lower case to the count. Right for a map whose every region the world
// lists (a hand-drawn one); the turn counts them from the map itself
// (frontApply.js regionHoldingsOf).
export const regionHoldingsFromWorld = (world) => {
  const held = new Map();
  for (const holder of Object.values(record(world?.regionOwnershipOverrides))) {
    const key = fold(holder);
    if (key) held.set(key, (held.get(key) ?? 0) + 1);
  }
  return held;
};

// How a war stands for each country in it, on the ground: (warId, name) =>
// { lost, taken }, the share of its own regions the other side holds and the
// share of the other side's it holds. From the regions held by one country
// and lawfully another's (world.regionSovereigntyOverrides lists exactly those).
//   held   regionHoldingsFromWorld, or the turn's count
export const groundReader = (world, held = null) => {
  const holdings = held instanceof Map ? held : regionHoldingsFromWorld(world);
  const ownership = record(world?.regionOwnershipOverrides);
  const occupied = Object.entries(record(world?.regionSovereigntyOverrides)).map(([regionId, sovereign]) => [fold(sovereign), fold(ownership[regionId])]).filter(([sovereign, holder]) => sovereign && holder && sovereign !== holder);
  const cache = new Map();
  const read = (warId) => {
    if (cache.has(warId)) return cache.get(warId);
    const war = list(world?.wars).find((entry) => clean(entry?.id) === clean(warId));
    const sides = sidesOf(war).map((members) => new Set(members.map(fold)));
    const sideOf = (name) => (sides[0].has(name) ? 0 : sides[1].has(name) ? 1 : -1);
    const lost = new Map();
    const taken = new Map();
    for (const [sovereign, holder] of occupied) {
      const from = sideOf(sovereign);
      const to = sideOf(holder);
      if (from < 0 || to < 0 || from === to) continue;
      lost.set(sovereign, (lost.get(sovereign) ?? 0) + 1);
      taken.set(holder, (taken.get(holder) ?? 0) + 1);
    }
    // A country's own regions: those it holds, less what it holds of others', and what others hold of its own.
    const own = (name) => Math.max(1, (holdings.get(name) ?? 0) - (taken.get(name) ?? 0) + (lost.get(name) ?? 0));
    const sideOwn = sides.map((members) => [...members].reduce((sum, name) => sum + own(name), 0));
    const table = { sideOf, lost, taken, own, sideOwn };
    cache.set(warId, table);
    return table;
  };
  return (warId, name) => {
    const table = read(clean(warId));
    const key = fold(name);
    const side = table.sideOf(key);
    if (side < 0) return { lost: 0, taken: 0 };
    return { lost: (table.lost.get(key) ?? 0) / table.own(key), taken: (table.taken.get(key) ?? 0) / Math.max(1, table.sideOwn[1 - side]) };
  };
};

// ---- small writes -------------------------------------------------------------------------

const sheetKeyOf = (world, name) => Object.keys(record(world?.countryStats)).find((key) => fold(key) === fold(name)) ?? "";

// A country's people as the game knows them: its sheet's, else what the scenario's author gave it. 0 for neither.
const peopleOf = (world, name) => {
  const total = figure(record(world?.countryStats)[sheetKeyOf(world, name)]?.population?.total);
  if (total > 0) return total;
  const overrides = record(world?.polityOverrides);
  const key = Object.keys(overrides).find((entry) => fold(entry) === fold(name));
  return key ? populationFigureOf(overrides[key]) : 0;
};

// The score of two countries' relation, -100 to 100: 0 where none is recorded.
const relationOf = (world, a, b) => {
  const [first, second] = [fold(a), fold(b)];
  for (const row of list(world?.relations)) {
    const pair = [fold(row?.a), fold(row?.b)];
    if ((pair[0] === first && pair[1] === second) || (pair[0] === second && pair[1] === first)) return figure(row.score);
  }
  return 0;
};

// A world with one country's standing set (world.internationalReputation, and
// the figure on its sheet where its sheet carries one).
export const withReputation = (world, name, value) => {
  const country = clean(name);
  if (!country) return world;
  const map = record(world?.internationalReputation);
  // (By the name the world already has for it: its entry here, its sheet's, its own record's.)
  const named = (table) => Object.keys(record(table)).find((entry) => fold(entry) === fold(country));
  const key = named(map) ?? named(world?.countryStats) ?? named(world?.polityOverrides) ?? country;
  const next = { ...world, internationalReputation: { ...map, [key]: Math.max(0, Math.min(100, Math.round(figure(value)))) } };
  const sheetKey = sheetKeyOf(world, country);
  const indices = sheetKey ? record(world.countryStats[sheetKey]?.indices) : {};
  if (sheetKey && Number.isFinite(Number(indices.internationalReputation))) {
    next.countryStats = { ...world.countryStats };
    applyCountryStatPatchToWorld(next, sheetKey, { indices: { internationalReputation: next.internationalReputation[key] } });
  }
  return next;
};

// A world with a treaty broken: the breaker's standing falls, and it is out of the agreement.
export const withTreatyBroken = (world, { ally, via }, { date = "", round = 0 } = {}) => {
  const map = record(world?.internationalReputation);
  const key = Object.keys(map).find((entry) => fold(entry) === fold(ally));
  const sheet = record(world?.countryStats)[sheetKeyOf(world, ally)];
  const before = key ? map[key] : sheet?.indices?.internationalReputation;
  const next = withReputation(world, ally, reputationAfterBreaking(before));
  return { ...next, agreements: agreementsWithout(next.agreements, via, ally, { date, round }) };
};

// ---- a peace made -------------------------------------------------------------------------

// What a peace does to the ground: for every region one side of the war holds
// and that is lawfully the other's, a cession to whoever holds it ("as held")
// or its return to whose it is ("restored"). As an event's impacts.
export const peaceImpacts = (world, war, territory) => {
  const sides = sidesOf(war).map((members) => new Set(members.map(fold)));
  const sideOf = (name) => (sides[0].has(fold(name)) ? 0 : sides[1].has(fold(name)) ? 1 : -1);
  const ownership = record(world?.regionOwnershipOverrides);
  const note = `Peace: ${clean(war?.title) || clean(war?.id)}`;
  const regionTransfers = [];
  const regionControlOps = [];
  for (const [regionId, sovereign] of Object.entries(record(world?.regionSovereigntyOverrides))) {
    const holder = clean(ownership[regionId]);
    const from = sideOf(sovereign);
    const to = sideOf(holder);
    if (!holder || from < 0 || to < 0 || from === to) continue;
    if (territory === TERRITORY_AS_HELD) {
      regionTransfers.push({ regionId, fromCode: clean(sovereign), toCode: holder, basis: "treaty", note });
    } else {
      regionControlOps.push(
        { op: "control", regionId, fromCode: holder, toCode: clean(sovereign), basis: "treaty", note },
        { op: "clear_contest", regionId, fromCode: clean(sovereign), claimantCode: holder, clearAll: false, note },
      );
    }
  }
  return { regionTransfers, regionControlOps };
};

// A world with a war ended on terms.
//   warId        the war
//   from, to     who offered, and who took it
//   terms        { territory, reparations }
//   date, round  when
//   by           how it came about: "offer" (a person took one), "proposal" (a
//                person's own terms were taken), "settled" (two countries nobody plays)
// The same world when the war is not being fought.
export const makePeace = (world, { warId = "", from = "", to = "", terms = null, date = "", round = 0, by = "offer" } = {}) => {
  const war = list(world?.wars).find((entry) => clean(entry?.id) === clean(warId));
  if (!war || !settleable(war)) return world;
  const read = normalizeTerms(terms);
  const turn = Math.max(0, Math.round(figure(round)));
  let next = world;
  const impacts = peaceImpacts(world, war, read.territory);
  if (impacts.regionTransfers.length > 0 || impacts.regionControlOps.length > 0) {
    next = applyEventImpactsToWorld({
      world: next,
      round: turn,
      events: [{
        id: `peace-${clean(warId)}-${clean(date)}`,
        date: clean(date),
        title: "Peace",
        description: "The ground as the peace settles it.",
        importance: "minor",
        kind: "world",
        notable: false,
        playerRelated: false,
        impacts,
        source: "manual-admin",
      }],
    }).world;
  }
  next = applyWarUpdates({
    world: next,
    updates: [{ id: clean(warId), op: "end", actors: [], opponents: [], eventIds: [], baselineDate: clean(date), note: `Peace: ${describeTerms(read)}` }],
    events: [],
    stopDate: clean(date),
    round: turn,
    limit: Infinity,
  }).world;
  const [sideA, sideB] = sidesOf(war);
  const treaty = { id: `treaty:${clean(warId)}:${clean(date)}`, warId: clean(warId), title: clean(war.title) || clean(warId), date: clean(date), round: turn, from: clean(from), to: clean(to), sides: [sideA, sideB], terms: read, by: ["offer", "proposal", "settled"].includes(by) ? by : "offer" };
  return {
    ...next,
    reparations: normalizeReparations([...list(next.reparations), ...reparationsOf(read, { warId, date })]),
    peaceTreaties: normalizePeaceTreaties([...list(next.peaceTreaties).filter((entry) => entry?.id !== treaty.id), treaty]),
    // Whatever was offered in that war is answered by its ending.
    peaceOffers: normalizePeaceOffers(list(next.peaceOffers).map((offer) => (clean(offer?.warId) === clean(warId) && offer.status === "open" ? { ...offer, status: "lapsed", answeredRound: turn } : offer))),
    callsToArms: normalizeCallsToArms(list(next.callsToArms).map((call) => (clean(call?.warId) === clean(warId) && call.status === "open" ? { ...call, status: "lapsed", answeredRound: turn } : call))),
  };
};

// ---- the turn -----------------------------------------------------------------------------

// A world with a period's reparations paid: on the backend of each sheet, the
// payer owes more by what it paid and the receiver less.
const withReparationsPaid = (world, days) => {
  const gdpOf = (name) => figure(record(world?.countryStats)[sheetKeyOf(world, name)]?.economy?.gdp);
  const due = reparationsDue(world?.reparations, { days, gdpOf });
  if (due.payments.length === 0) return list(world?.reparations).length === due.reparations.length && due.reparations.every((entry, at) => entry.paidDays === world.reparations[at]?.paidDays) ? world : { ...world, reparations: due.reparations };
  const next = { ...world, reparations: due.reparations, countryStats: { ...record(world.countryStats) } };
  const owes = (name, points) => {
    const key = sheetKeyOf(next, name);
    if (!key) return;
    const before = figure(next.countryStats[key]?.economy?.publicDebt);
    applyCountryStatPatchToWorld(next, key, { economy: { publicDebt: Math.max(0, Math.round((before + points) * 100) / 100) } });
  };
  for (const payment of due.payments) {
    owes(payment.payer, payment.share * 100);
    const receiverGdp = gdpOf(payment.receiver);
    if (receiverGdp > 0) owes(payment.receiver, -(payment.amount / receiverGdp) * 100);
  }
  return next;
};

// What the end of a turn does.
//   world       the world as the turn's ledgers leave it
//   baseWorld   the world as the turn began
//   days        how long the period was
//   date, round the turn it now is
//   players     the countries people play
//   fronts      what the land and sea war came to (frontTurn.js runTurnFronts), or null
//   held        how many regions each country holds now (regionHoldingsFromWorld, or the map's count)
//   treaties    the peaces the skip says two countries nobody plays made:
//               [{ from, to, terms }] (peaceTerms.js readTreatyLines), each
//               checked before it is made
//   onRefused   (treaty with its `reason`) => anything, for each one refused
export const turnWarAndPeace = ({ world = {}, baseWorld = {}, days = 0, date = "", round = 0, players = [], fronts = null, held = null, treaties = [], onRefused = null } = {}) => {
  const holdings = held instanceof Map ? held : regionHoldingsFromWorld(world);
  const turn = Math.max(0, Math.round(figure(round)));
  let next = withReparationsPaid(world, days);

  // ---- alliances come due ----
  const fought = new Set(list(baseWorld?.wars).filter(active).map((war) => clean(war.id)));
  const began = list(next.wars).filter((war) => active(war) && !fought.has(clean(war.id))).map((war) => clean(war.id));
  const before = normalizeWarWeariness(baseWorld?.warWeariness);
  // (What each weighs in a land war: its people and what its forces have to spend, never the land it holds.)
  const strengthOf = landWeightsOf(next);
  const due = callsForTurn({
    world: next,
    wars: next.wars,
    began,
    calls: baseWorld?.callsToArms,
    players,
    honours: (ally, defender) => honoursCall({ relation: relationOf(next, ally, defender), weariness: wearinessOf(before, ally) }),
    strengthOf,
    round: turn,
    date,
  });
  // A bond the story itself ended this turn while its partner was attacked is a treaty broken too: the breaker pays.
  const broken = [...due.broken];
  for (const id of began) {
    const war = list(next.wars).find((entry) => clean(entry?.id) === id);
    const [attackers, defenders] = sidesOf(war);
    const defender = defenders[0];
    if (!defender) continue;
    const inWar = new Set([...attackers, ...defenders].map(fold));
    const still = new Set(defendersOf(next, defender).map((entry) => fold(entry.ally)));
    for (const entry of defendersOf(baseWorld, defender)) {
      if (still.has(fold(entry.ally)) || inWar.has(fold(entry.ally))) continue;
      if (broken.some((other) => fold(other.ally) === fold(entry.ally) && other.warId === id)) continue;
      broken.push({ ally: entry.ally, defender, via: { ...entry.via, kind: "ended" }, warId: id });
    }
  }
  if (due.joins.length > 0) {
    next = applyWarUpdates({
      world: next,
      // (No note: the war's own is the story's.)
      updates: due.joins.map((join) => ({ id: join.warId, op: "join-b", actors: [join.ally], opponents: [], eventIds: [], baselineDate: clean(date) })),
      events: [],
      stopDate: clean(date),
      round: turn,
      limit: Infinity,
    }).world;
  }
  for (const entry of broken) next = withTreatyBroken(next, entry, { date, round: turn });
  next = { ...next, callsToArms: due.calls };

  // ---- weariness ----
  // (A country that goes to war with none yet goes as weary as its own military figures say.)
  const weariness = withTurnWeariness(wearinessGoingIn(before, { wars: next.wars, startOf: startingWearinessOf(next) }), {
    days,
    wars: next.wars,
    manpower: fronts?.manpower,
    peopleOf: (name) => peopleOf(next, name),
    flips: fronts?.flips,
    heldBy: (name) => holdings.get(fold(name)) ?? 0,
    blockades: fronts?.sea?.blockades,
    // (And what attrition took, where the scenario's wars count it: runtime/fronts/attrition.js.)
    attrition: fronts?.attrition,
  });
  next = { ...next, warWeariness: weariness };
  // What attrition has cost each country at war (runtime/attrition.js).
  if (warSettingsOf(next).mechanics.attrition) next = { ...next, attrition: withTurnAttrition(baseWorld?.attrition, { attrition: fronts?.attrition, wars: next.wars }) };

  // ---- war resources ----
  // What advancing and building fortified lines spent, and what each country's
  // economy refilled, less under the period's blockades (runtime/warResources.js),
  // where the scenario's wars use them.
  if (warSettingsOf(next).mechanics.supply) {
    const sheets = next.countryStats && typeof next.countryStats === "object" ? next.countryStats : {};
    const middle = middleFundingPerHead(sheets);
    const sheetOf = (name) => sheets[Object.keys(sheets).find((key) => fold(key) === fold(name)) ?? ""] ?? null;
    const pressed = new Map(list(fronts?.sea?.blockades).map((entry) => [fold(entry?.country), Number(entry?.pressure) || 0]));
    next = {
      ...next,
      warResources: withTurnResources(baseWorld?.warResources, {
        days,
        toDate: date,
        effort: fronts?.effort,
        fortifications: next.fortifications,
        attrition: fronts?.attrition,
        rateOf: (name) => economyRate({ sheet: sheetOf(name), middle, pressure: pressed.get(fold(name)) ?? 0 }),
      }),
    };
  }

  // ---- peace ----
  // Only what the skip says was made. Weariness is a figure the AI is told
  // (warStatsPrompt.js), never what makes a peace.
  for (const told of list(treaties)) {
    const checked = treatyFromSkip({ ...told, wars: next.wars, players });
    if (!checked.treaty) {
      if (typeof onRefused === "function") onRefused({ ...told, reason: checked.reason });
      continue;
    }
    next = makePeace(next, { ...checked.treaty, date, round: turn, by: "settled" });
  }
  next = { ...next, peaceOffers: withTurnPeaceOffers(next.peaceOffers, { wars: next.wars, round: turn }) };
  return next;
};

// The length of a turn's period, in days.
export const turnDays = (baseGame, nextGame) => {
  const days = diffGameDays(clean(baseGame?.gameDate || baseGame?.startDate), clean(nextGame?.gameDate));
  return Number.isFinite(days) && days > 0 ? days : 0;
};

// ---- a person's answers -------------------------------------------------------------------

// A world with an offer of peace taken: the war ends on its terms. The same world when the offer is not open.
export const acceptPeaceOffer = (world, offerId, { date = "", round = 0 } = {}) => {
  const offer = normalizePeaceOffers(world?.peaceOffers).find((entry) => entry.id === clean(offerId, 80));
  if (!offer || offer.status !== "open") return world;
  const made = makePeace(world, { warId: offer.warId, from: offer.from, to: offer.to, terms: offer.terms, date, round, by: "offer" });
  if (made === world) return world;
  return { ...made, peaceOffers: normalizePeaceOffers(list(made.peaceOffers).map((entry) => (entry.id === offer.id ? { ...entry, status: "accepted", answeredRound: Math.max(1, Math.round(figure(round))) } : entry))) };
};

// A world with an offer of peace turned down: its maker does not offer again for a while.
export const declinePeaceOffer = (world, offerId, { round = 0 } = {}) => {
  const offers = normalizePeaceOffers(world?.peaceOffers);
  if (!offers.some((entry) => entry.id === clean(offerId, 80) && entry.status === "open")) return world;
  return { ...world, peaceOffers: offers.map((entry) => (entry.id === clean(offerId, 80) ? { ...entry, status: "declined", answeredRound: Math.max(1, Math.round(figure(round))) } : entry)) };
};

// An offer of peace an AI makes a person: a letter of the time skip's, or a
// leader's chat reply. Checked by peaceTerms.js offerFromAi; an open offer
// between the two in that war gives way to it.
//   from, to            the AI's country, the person's
//   terms               as the AI wrote them
//   players             the countries people play
//   source              "skip" | "chat" | "counter"
//   chatId, messageId   the thread and the message that carry it
// Returns { world, offer, reason }: `reason` says why nothing was offered ("" when it was).
export const offerPeace = (world, { from = "", to = "", terms = null, players = [], date = "", round = 0, source = "skip", chatId = "", messageId = "" } = {}) => {
  const made = offerFromAi({ from, to, terms, wars: world?.wars, players, round, date, source, chatId, messageId });
  if (!made.offer) return { world, offer: null, reason: made.reason };
  return { world: { ...world, peaceOffers: withOffer(world?.peaceOffers, made.offer) }, offer: made.offer, reason: "" };
};

// A person puts terms to the other side of a war. Nothing is decided here: the
// terms wait, open, for the leader of the other side's first country to answer
// in the chat (answerPeaceProposal).
//   from      the country proposing (a person's)
//   players   the countries people play: a side with one of them on it is theirs to answer, and is not answered here
//   chatId, messageId   the thread and the person's message that put them, where known
// Returns { world, offer, to, reason }: `reason` says why nothing happened ("" when the terms were put).
export const proposePeace = (world, { warId = "", from = "", terms = null, players = [], date = "", round = 0, chatId = "", messageId = "" } = {}) => {
  const war = list(world?.wars).find((entry) => clean(entry?.id) === clean(warId));
  if (!war || !settleable(war)) return { world, offer: null, to: "", reason: "no-war" };
  const sides = sidesOf(war);
  const mine = sides.findIndex((members) => members.some((member) => fold(member) === fold(from)));
  if (mine < 0) return { world, offer: null, to: "", reason: "not-in-war" };
  const to = sides[1 - mine][0];
  const played = new Set(list(players).map(fold));
  if (!to || sides[1 - mine].some((member) => played.has(fold(member)))) return { world, offer: null, to: to ?? "", reason: "played" };
  const turn = Math.max(0, Math.round(figure(round)));
  const own = sides[mine].find((member) => fold(member) === fold(from)) ?? clean(from);
  const [offer] = normalizePeaceOffers([{
    id: `peace:${clean(warId)}:${fold(own)}:${turn}`,
    warId: clean(warId),
    from: own,
    to,
    terms: normalizeTerms(terms),
    date: clean(date),
    round: turn,
    status: "open",
    source: "player",
    chatId,
    messageId,
  }]);
  return { world: { ...world, peaceOffers: withOffer(world?.peaceOffers, offer) }, offer, to, reason: "" };
};

// What a leader nobody plays says of peace in a chat with a person: it answers
// the terms that person put to it (accept, decline, counter), or it offers
// peace of its own. Nothing the leader did not say is done: a reply that says
// nothing of the terms leaves them open.
//   from        the leader's country
//   to          the person's
//   verdict     { verdict: "accept" | "decline" | "counter" | "offer", terms? } (peaceTerms.js readPeaceVerdict)
//   players     the countries people play
//   chatId, messageId   the thread and the leader's message
// Returns { world, outcome, reason }: outcome "peace" | "declined" | "offered" | "", `reason` when nothing was done.
export const answerPeaceProposal = (world, { from = "", to = "", verdict = null, players = [], date = "", round = 0, chatId = "", messageId = "" } = {}) => {
  const word = clean(verdict?.verdict).toLowerCase();
  const turn = Math.max(1, Math.round(figure(round)));
  const open = openOfferBetween(world?.peaceOffers, from, to);
  const put = open && fold(open.from) === fold(to) && fold(open.to) === fold(from) ? open : null;
  const marked = (offers, status) => normalizePeaceOffers(list(offers).map((entry) => (entry?.id === put.id ? { ...entry, status, answeredRound: turn } : entry)));
  if (word === "accept") {
    if (!put) return { world, outcome: "", reason: "nothing put" };
    const made = makePeace(world, { warId: put.warId, from: put.from, to: put.to, terms: put.terms, date, round, by: "proposal" });
    if (made === world) return { world, outcome: "", reason: "no-war" };
    return { world: { ...made, peaceOffers: marked(made.peaceOffers, "accepted") }, outcome: "peace", reason: "" };
  }
  if (word === "decline") {
    if (!put) return { world, outcome: "", reason: "nothing put" };
    return { world: { ...world, peaceOffers: marked(world.peaceOffers, "declined") }, outcome: "declined", reason: "" };
  }
  if (word === "counter" || word === "offer") {
    // A counter turns down what was put and offers other terms; an offer is made fresh.
    const base = put ? { ...world, peaceOffers: marked(world.peaceOffers, "declined") } : world;
    const made = offerPeace(base, { from, to, terms: verdict?.terms, players, date, round, source: put ? "counter" : "chat", chatId, messageId });
    if (!made.offer) return put ? { world: base, outcome: "declined", reason: made.reason } : { world, outcome: "", reason: made.reason };
    return { world: made.world, outcome: "offered", reason: "" };
  }
  return { world, outcome: "", reason: "unread" };
};

// A world with a call to arms answered.
//   honour   true joins the war on the defender's side; false breaks the treaty
// The same world when the call is not open.
export const answerCallToArms = (world, callId, honour, { date = "", round = 0 } = {}) => {
  const calls = normalizeCallsToArms(world?.callsToArms);
  const call = calls.find((entry) => entry.id === clean(callId, 120));
  if (!call || call.status !== "open") return world;
  const turn = Math.max(1, Math.round(figure(round)));
  const answered = (status) => calls.map((entry) => (entry.id === call.id ? { ...entry, status, answeredRound: turn } : entry));
  if (!honour) return { ...withTreatyBroken(world, call, { date, round: turn }), callsToArms: answered("refused") };
  const war = list(world?.wars).find((entry) => clean(entry?.id) === call.warId);
  if (!war || !active(war)) return { ...world, callsToArms: answered("lapsed") };
  const side = sidesOf(war)[0].some((member) => fold(member) === fold(call.defender)) ? "join-a" : "join-b";
  const joined = applyWarUpdates({
    world,
    updates: [{ id: call.warId, op: side, actors: [call.ally], opponents: [], eventIds: [], baselineDate: clean(date) }],
    events: [],
    stopDate: clean(date),
    round: turn,
    limit: Infinity,
  }).world;
  return { ...joined, callsToArms: answered("honoured") };
};

// One thing a person does about a war between turns, whoever's screen it came from.
//   op        "accept" | "decline" (an offer of peace, by its id), "honour" | "refuse"
//             (a call to arms, by its id), "propose" (terms of their own, for a war by
//             its id, which wait for the other side's leader to answer in the chat)
//   ref       the offer's, call's or war's id
//   country   who is doing it: the offer or call must be theirs
// Returns { world, error, accepted, to, offerId }: `error` is a word for why
// nothing was done ("" when something was), `accepted` whether an offer or a
// call was taken, `offerId` the terms a "propose" put.
//   chatId, messageId   for "propose": the thread and the message that put the terms
export const playerDiplomacy = (world, { op = "", ref = "", terms = null, country = "", players = [], date = "", round = 0, chatId = "", messageId = "" } = {}) => {
  const who = fold(country);
  const nothing = (error) => ({ world, error, accepted: false, to: "" });
  if (!who) return nothing("nobody");
  if (op === "accept" || op === "decline") {
    const offer = normalizePeaceOffers(world?.peaceOffers).find((entry) => entry.id === clean(ref, 80));
    if (!offer || offer.status !== "open") return nothing("not-open");
    if (fold(offer.to) !== who) return nothing("not-yours");
    const next = op === "accept" ? acceptPeaceOffer(world, offer.id, { date, round }) : declinePeaceOffer(world, offer.id, { round });
    return next === world ? nothing("not-open") : { world: next, error: "", accepted: op === "accept", to: offer.from };
  }
  if (op === "honour" || op === "refuse") {
    const call = normalizeCallsToArms(world?.callsToArms).find((entry) => entry.id === clean(ref, 120));
    if (!call || call.status !== "open") return nothing("not-open");
    if (fold(call.ally) !== who) return nothing("not-yours");
    return { world: answerCallToArms(world, call.id, op === "honour", { date, round }), error: "", accepted: op === "honour", to: call.defender };
  }
  if (op === "propose") {
    const put = proposePeace(world, { warId: ref, from: country, terms, players, date, round, chatId, messageId });
    return { world: put.world, error: put.reason, accepted: false, to: put.to, offerId: put.offer?.id ?? "" };
  }
  return nothing("unknown");
};

export { TREATY_BROKEN_REPUTATION };
