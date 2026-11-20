/*! Open Historia — deals with groups, and what they do to the world © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A group (runtime/groups.js) is a party to diplomacy as a country is
// (runtime/groupParties.js): it has a relation with anyone, and it makes deals
// that fit an actor that is not a state. A deal is an agreement of the world's
// (world.agreements), written by the time skip's agreementUpdates, signed in a
// chat (Game/AI/gameplay.js answerDealInChat), or declared by the player. Here
// is what a deal DOES, through the engines that already exist: the relation's
// score, the backend of a country's sheet (its public debt), a group's own
// military figures (which the war engine reads, runtime/militaryStats.js), the
// war ledger, and the group's area on the map.
//
// WHEN A DEAL STARTS (settleGroupDealStarts: once, marked `effectsApplied`, so
// a deal signed between turns and one the skip wrote go through the same door):
//   the relation between the two moves by START_RELATION
//   a crackdown ends every cooperative deal between the two, and a cooperative
//     deal ends a crackdown; a new deal of a type the two already have
//     replaces the old one
//   truce             a war between just the two is put on ceasefire
//   amnesty           a war between just the two ends; the group gives up the
//                     ground it held in the granting country's land, and its
//                     forces stand down (spending falls)
//   hostage_exchange  done at once: the deal is over when it is made
//
// EVERY TURN, WHILE IN FORCE (turnGroupDeals, after the war and peace of the
// turn), for the length of the period:
//   protection    the payer pays a share of its GDP a year (public debt on its
//                 sheet); a group paid grows its forces' spending
//   sponsorship   the sponsor pays; a group sponsored grows its forces'
//                 spending and technology
//   smuggling     a country in it earns (its debt falls a little); a group
//                 in it grows its spending
//   crackdown     the government pays for it; the group's spending falls, and
//                 the government takes back one region of the group's area in
//                 its own land every CRACKDOWN_DAYS_PER_REGION days
// Truce, safe passage, recognition and amnesty change the relation and the
// wars when they start; after that the story honours them, or breaks them.
//
// The figures are bounded (a period counts for at most MAX_YEARS_A_TURN years,
// a crackdown takes at most MAX_REGIONS_A_TURN regions a turn, a group's
// figures stay within their bounds). They are mine, not the owner's.
//
// Pure: takes a world and returns one.

import { applyCountryStatPatchToWorld } from "../../runtime/gameState.js";
import { applyGroupOps, findGroupKey, normalizeGroupAreas, normalizeGroups } from "../../runtime/groups.js";
import { normalizeMilitaryStats } from "../../runtime/militaryStats.js";
import { regionOwnerNow } from "../../runtime/gmAnnex.js";
import { relationBandForScore } from "../../runtime/diplomaticStance.js";
import {
  GROUP_DEAL_TYPES,
  dealsBetween,
  isGroupDealType,
  isOneOffGroupDeal,
  isUnilateralGroupDeal,
  relationBetween,
} from "../../runtime/groupParties.js";
import { applyWarUpdates } from "./nativeWarLedger.js";

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const figure = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const live = (agreement) => fold(agreement?.status || "active") === "active";

// How far the relation moves when a deal starts.
export const START_RELATION = Object.freeze({
  truce: 10,
  protection: 5,
  sponsorship: 15,
  safe_passage: 8,
  smuggling: 6,
  amnesty: 20,
  hostage_exchange: 10,
  recognition: 15,
  crackdown: -25,
});
// What a deal costs or earns a year, as a share of the payer's GDP.
export const PROTECTION_SHARE = 0.003;
export const SPONSORSHIP_SHARE = 0.002;
export const SMUGGLING_SHARE = 0.0015;
export const CRACKDOWN_SHARE = 0.0025;
// How a group's own forces move a year (militaryStats.js figures, 0 to 100).
export const GROUP_FIGURE_YEAR = Object.freeze({
  protection: { spending: 4 },
  sponsorship: { spending: 6, technology: 3 },
  smuggling: { spending: 3 },
  crackdown: { spending: -5 },
});
export const AMNESTY_STAND_DOWN = 15;
export const GROUP_SPENDING_BOUNDS = Object.freeze([10, 90]);
export const GROUP_TECHNOLOGY_BOUNDS = Object.freeze([0, 80]);
export const CRACKDOWN_DAYS_PER_REGION = 90;
export const MAX_REGIONS_A_TURN = 6;
export const MAX_YEARS_A_TURN = 3;
// A party that ends a deal it is in, short of its term: the other side's view of it falls.
export const BROKEN_DEAL_RELATION = -10;

// The deals that bind two sides to get along, which a crackdown ends.
const COOPERATIVE = new Set(GROUP_DEAL_TYPES.filter((type) => type !== "crackdown"));

// ---- the relation -------------------------------------------------------------------------

// A world with the relation between two moved by `delta` (a row made where there is none,
// from 0), its band from its score as the game bands it.
export const withRelationShift = (world, a, b, delta, { date = "", round = 0, summary = "" } = {}) => {
  const [x, y] = [clean(a), clean(b)];
  if (!x || !y || fold(x) === fold(y) || !figure(delta)) return world;
  const prior = relationBetween(world, x, y);
  const score = Math.max(-100, Math.min(100, Math.round(figure(prior?.score) + figure(delta))));
  const ordered = [x, y].sort((p, q) => fold(p).localeCompare(fold(q)));
  const row = {
    ...(prior ?? {}),
    id: clean(prior?.id) || `relation-deal-${fold(ordered[0])}-${fold(ordered[1])}`.slice(0, 160),
    a: prior ? prior.a : ordered[0],
    b: prior ? prior.b : ordered[1],
    score,
    status: relationBandForScore(score),
    summary: clean(summary, 300) || clean(prior?.summary, 300),
    lastUpdatedDate: clean(date, 40) || clean(prior?.lastUpdatedDate, 40),
    updatedRound: Math.max(0, Math.trunc(figure(round))),
    ...(prior ? {} : { createdRound: Math.max(0, Math.trunc(figure(round))) }),
  };
  const rows = list(world?.relations).filter((entry) => entry !== prior);
  return { ...world, relations: [...rows, row] };
};

// ---- the parties' own figures ----------------------------------------------------------------

const sheetKeyOf = (world, name) => Object.keys(record(world?.countryStats)).find((key) => fold(key) === fold(name)) ?? "";
const gdpOf = (world, name) => figure(record(world?.countryStats)[sheetKeyOf(world, name)]?.economy?.gdp);

// A world where `name` (a country with a sheet) owes `points` more public debt, in
// points of its GDP; nothing for a party with no sheet (a group has none).
const withDebt = (world, name, points) => {
  const key = sheetKeyOf(world, name);
  if (!key || !figure(points)) return world;
  const next = { ...world, countryStats: { ...record(world.countryStats) } };
  const before = figure(next.countryStats[key]?.economy?.publicDebt);
  applyCountryStatPatchToWorld(next, key, { economy: { publicDebt: Math.max(0, Math.round((before + points) * 100) / 100) } });
  return next;
};

// A payment of `share` of the payer's GDP a year for `years`: the payer's debt up, the receiver's
// down by the same sum against its own GDP.
const withPayment = (world, payer, receiver, share, years) => {
  const gdp = gdpOf(world, payer);
  if (!(gdp > 0) || !(share > 0) || !(years > 0)) return world;
  let next = withDebt(world, payer, share * years * 100);
  const theirs = gdpOf(next, receiver);
  if (theirs > 0) next = withDebt(next, receiver, -((gdp * share * years) / theirs) * 100);
  return next;
};

// A world with a group's own military figures moved, each kept within its bounds; nothing for a
// party that is no group.
export const withGroupFigures = (world, name, moves) => {
  const groups = record(world?.groups);
  const key = findGroupKey(groups, name);
  if (!key) return world;
  const before = normalizeMilitaryStats(groups[key]?.military) ?? {};
  const bounds = { spending: GROUP_SPENDING_BOUNDS, technology: GROUP_TECHNOLOGY_BOUNDS };
  const after = { ...before };
  let moved = false;
  for (const [field, delta] of Object.entries(record(moves))) {
    if (!figure(delta) || !bounds[field]) continue;
    const [least, most] = bounds[field];
    const from = Number.isFinite(Number(before[field])) ? Number(before[field]) : 50;
    const to = Math.max(least, Math.min(most, Math.round(from + figure(delta))));
    if (to !== before[field]) {
      after[field] = to;
      moved = true;
    }
  }
  if (!moved) return world;
  return { ...world, groups: { ...groups, [key]: { ...groups[key], military: after } } };
};

const isGroupIn = (world, name) => Boolean(findGroupKey(record(world?.groups), name));

// ---- wars between the two ---------------------------------------------------------------------

// The wars fought between just these two, one on each side.
const warsBetweenOnly = (world, a, b) => list(world?.wars).filter((war) => {
  if (!["active", "ceasefire"].includes(fold(war?.status || "active"))) return false;
  const sideA = list(war?.sideA).map(fold);
  const sideB = list(war?.sideB).map(fold);
  if (sideA.length !== 1 || sideB.length !== 1) return false;
  return (sideA[0] === fold(a) && sideB[0] === fold(b)) || (sideA[0] === fold(b) && sideB[0] === fold(a));
});

const withWarOp = (world, wars, op, { date = "", round = 0, note = "" } = {}) => {
  const ids = wars
    .filter((war) => (op === "ceasefire" ? fold(war?.status) === "active" : true))
    .map((war) => clean(war.id))
    .filter(Boolean);
  if (!ids.length) return world;
  return applyWarUpdates({
    world,
    updates: ids.map((id) => ({ id, op, actors: [], opponents: [], eventIds: [], baselineDate: clean(date, 40), note })),
    events: [],
    stopDate: clean(date, 40),
    round,
    limit: Infinity,
  }).world;
};

// ---- the group's area -------------------------------------------------------------------------

// The regions of a group's area that lie in `owner`'s land, in the order the area lists them.
const areaIn = (world, group, owner, regions) => {
  const key = findGroupKey(record(world?.groups), group);
  if (!key) return [];
  const byId = new Map(list(regions).map((region) => [clean(region?.id), region]));
  const overrides = record(world?.regionOwnershipOverrides);
  const areas = normalizeGroupAreas(world?.groupAreas, normalizeGroups(world?.groups));
  return Object.entries(areas)
    .filter(([regionId, name]) => name === key && byId.has(regionId) && fold(regionOwnerNow(byId.get(regionId), overrides)) === fold(owner))
    .map(([regionId]) => regionId);
};

const withAreaReleased = (world, group, regionIds) => {
  if (!regionIds.length) return world;
  const applied = applyGroupOps({ groups: world.groups, groupAreas: world.groupAreas }, [{ op: "release", name: group, regionIds }]);
  return { ...world, groups: applied.groups, groupAreas: applied.groupAreas };
};

// ---- a deal starts ------------------------------------------------------------------------------

const replaceAgreement = (world, agreement) => ({
  ...world,
  agreements: list(world?.agreements).map((entry) => (entry?.id === agreement.id ? agreement : entry)),
});

const ended = (agreement, date, round) => ({
  ...agreement,
  status: "ended",
  endedDate: clean(date, 40) || clean(agreement?.endedDate, 40),
  lastUpdatedDate: clean(date, 40) || clean(agreement?.lastUpdatedDate, 40),
  updatedRound: Math.max(0, Math.trunc(figure(round))),
});

// Carries out the start of every deal in force whose start has not been carried out.
//   regions   the map's catalog ([{ id, countryCode, country }]), for an amnesty's ground
// Returns { world, started: [agreement] }.
export const settleGroupDealStarts = (world, { date = "", round = 0, regions = [] } = {}) => {
  let next = world;
  const started = [];
  // Oldest first, so the newer of two that clash is the one that stands (the world lists its agreements newest first).
  const pending = list(world?.agreements)
    .filter((agreement) => live(agreement) && isGroupDealType(agreement?.type) && agreement.effectsApplied !== true)
    .map((agreement, at) => ({ agreement, at }))
    .sort((p, q) => figure(p.agreement.createdRound) - figure(q.agreement.createdRound)
      || clean(p.agreement.startedDate, 40).localeCompare(clean(q.agreement.startedDate, 40))
      || q.at - p.at)
    .map(({ agreement }) => agreement);
  for (const original of pending) {
    const agreement = list(next.agreements).find((entry) => entry?.id === original.id);
    if (!agreement || !live(agreement)) continue;
    const [giver, other] = list(agreement.parties).map((party) => clean(party));
    if (!giver || !other) continue;
    const type = agreement.type;
    const note = `${clean(agreement.title) || type}`;

    // What it replaces, or puts an end to.
    // (Only what has itself started: a deal still waiting its turn here ends what it clashes with when it does.)
    for (const prior of dealsBetween(next, giver, other)) {
      if (prior.id === agreement.id || !live(prior) || (isGroupDealType(prior.type) && prior.effectsApplied !== true)) continue;
      const clash = prior.type === type
        || (type === "crackdown" && COOPERATIVE.has(prior.type))
        || (prior.type === "crackdown" && COOPERATIVE.has(type));
      if (clash) next = replaceAgreement(next, ended(prior, date, round));
    }

    next = withRelationShift(next, giver, other, START_RELATION[type] ?? 0, { date, round });

    if (type === "truce") next = withWarOp(next, warsBetweenOnly(next, giver, other), "ceasefire", { date, round, note });
    if (type === "amnesty") {
      next = withWarOp(next, warsBetweenOnly(next, giver, other), "end", { date, round, note });
      next = withAreaReleased(next, other, areaIn(next, other, giver, regions));
      next = withGroupFigures(next, other, { spending: -AMNESTY_STAND_DOWN });
    }

    const done = { ...agreement, effectsApplied: true };
    next = replaceAgreement(next, isOneOffGroupDeal(type) ? ended(done, date, round) : done);
    started.push(done);
  }
  return { world: next, started };
};

// ---- the turn -----------------------------------------------------------------------------------

// What the end of a turn does with the deals in force.
//   days        how long the period was
//   regions     the map's catalog, for a crackdown's and an amnesty's ground
// Returns { world, notes: [string] }: what changed, for the turn's log.
export const turnGroupDeals = ({ world = {}, days = 0, date = "", round = 0, regions = [] } = {}) => {
  const notes = [];
  const starts = settleGroupDealStarts(world, { date, round, regions });
  let next = starts.world;
  for (const agreement of starts.started) notes.push(`${agreement.type} began: ${list(agreement.parties).join(" / ")}`);

  const years = Math.min(MAX_YEARS_A_TURN, Math.max(0, figure(days)) / 365);
  if (!(years > 0)) return { world: next, notes };

  for (const original of list(next.agreements)) {
    if (!live(original) || !isGroupDealType(original?.type)) continue;
    const agreement = list(next.agreements).find((entry) => entry?.id === original.id) ?? original;
    const [first, second] = list(agreement.parties).map((party) => clean(party));
    if (!first || !second) continue;
    const type = agreement.type;
    const moves = GROUP_FIGURE_YEAR[type] ?? null;
    const scaled = (table) => Object.fromEntries(Object.entries(table).map(([field, perYear]) => [field, perYear * years]));

    if (type === "protection" || type === "sponsorship") {
      next = withPayment(next, first, second, type === "protection" ? PROTECTION_SHARE : SPONSORSHIP_SHARE, years);
      next = withGroupFigures(next, second, scaled(moves));
    } else if (type === "smuggling") {
      for (const party of [first, second]) {
        if (isGroupIn(next, party)) next = withGroupFigures(next, party, scaled(moves));
        else next = withDebt(next, party, -SMUGGLING_SHARE * years * 100);
      }
    } else if (type === "crackdown") {
      const gdp = gdpOf(next, first);
      if (gdp > 0) next = withDebt(next, first, CRACKDOWN_SHARE * years * 100);
      next = withGroupFigures(next, second, scaled(moves));
      const area = areaIn(next, second, first, regions);
      const carried = figure(agreement.carryDays) + Math.max(0, figure(days));
      const steps = Math.min(MAX_REGIONS_A_TURN, area.length, Math.floor(carried / CRACKDOWN_DAYS_PER_REGION));
      if (steps > 0) {
        next = withAreaReleased(next, second, area.slice(0, steps));
        notes.push(`crackdown: ${first} took back ${steps} region${steps === 1 ? "" : "s"} from ${second}`);
      }
      const left = area.length > steps ? carried - steps * CRACKDOWN_DAYS_PER_REGION : 0;
      const current = list(next.agreements).find((entry) => entry?.id === agreement.id) ?? agreement;
      const kept = { ...current };
      if (left > 0) kept.carryDays = Math.round(left);
      else delete kept.carryDays;
      next = replaceAgreement(next, kept);
    }
  }
  return { world: next, notes };
};

// ---- the player's own deals -----------------------------------------------------------------------

// A deal one side declares on its own (a crackdown), in force at once, its start carried out.
// Returns { world, agreement, reason }.
export const declareGroupDeal = (world, { by = "", against = "", type = "", title = "", terms = "", date = "", round = 0, regions = [] } = {}) => {
  const nothing = (reason) => ({ world, agreement: null, reason });
  if (!clean(by) || !clean(against) || fold(by) === fold(against)) return nothing("nobody");
  if (!isUnilateralGroupDeal(type)) return nothing("type");
  if (dealsBetween(world, by, against).some((agreement) => agreement.type === type && live(agreement))) return nothing("open");
  const turn = Math.max(0, Math.trunc(figure(round)));
  const agreement = {
    id: `deal:${type}:${fold(by)}:${fold(against)}:${turn}:${list(world?.agreements).length}`,
    title: clean(title, 120) || `${clean(by)} – ${clean(against)}`,
    type,
    status: "active",
    parties: [clean(by), clean(against)],
    startedDate: clean(date, 40),
    lastUpdatedDate: clean(date, 40),
    terms: String(terms ?? "").trim().slice(0, 1200),
    createdRound: turn,
    updatedRound: turn,
  };
  const settled = settleGroupDealStarts({ ...world, agreements: [...list(world?.agreements), agreement] }, { date, round, regions });
  return { world: settled.world, agreement, reason: "" };
};

// A party ends a deal it is in. Ending one short of its term is a deal broken: the other
// side's view of the one who ended it falls (BROKEN_DEAL_RELATION).
// Returns { world, agreement, reason }.
export const endGroupDeal = (world, { id = "", by = "", date = "", round = 0 } = {}) => {
  const agreement = list(world?.agreements).find((entry) => clean(entry?.id) === clean(id));
  if (!agreement || !["active", "suspended"].includes(fold(agreement.status || "active"))) return { world, agreement: null, reason: "not-open" };
  const parties = list(agreement.parties).map((party) => clean(party));
  if (!parties.some((party) => fold(party) === fold(by))) return { world, agreement: null, reason: "not-yours" };
  const closed = ended(agreement, date, round);
  let next = replaceAgreement(world, closed);
  // (Ending a crackdown is no broken promise.)
  if (agreement.type !== "crackdown") {
    for (const other of parties.filter((party) => fold(party) !== fold(by))) next = withRelationShift(next, by, other, BROKEN_DEAL_RELATION, { date, round });
  }
  return { world: next, agreement: closed, reason: "" };
};

