/*! Open Historia — what agreements do to the world, as the AI wrote it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every agreement of the world, a country's treaty or a group's deal, carries
// the effects the request that made it wrote (runtime/agreementEffects.js).
// Here they are carried out through the engines the game already has: a
// country's sheet (its stats and the backend's public debt), the relation
// between two, a country's standing, a group's own military figures (which the
// war engine reads, runtime/militaryStats.js), a group's area on the map, and
// the war ledger. Exactly what is written, within the caps, once and on
// schedule; never a number of the engine's own. An agreement with no effects
// (an old save's, or one written with none) does nothing here.
//
// WHEN IT IS MADE (settleAgreementStarts, marked `effectsApplied`, so one signed
// in a chat between turns and one the skip wrote go through the same door): its
// onSign effects. A new agreement of the same type between the same parties
// replaces the old one.
// EVERY TURN (turnAgreements, after the war and peace of the turn): a twelfth of
// its perYear effects (written as a year's amounts) for every whole month of the
// period it was in force (the days short of a month carried to the next turn);
// at its term it expires. What the world keeps in whole points (a relation, a
// standing, a group's figures) is banked as fractions between months.
// WHEN IT ENDS (settleAgreementEnds, marked `endApplied`): its onBreak effects
// when a party broke it (`brokenBy`, which stands for "breaker"), else its onEnd.
//
// Pure: takes a world and returns one.

import { applyCountryStatPatchToWorld, statEffectPatch } from "../../runtime/gameState.js";
import { diffGameDays } from "../../runtime/gameDates.js";
import { applyGroupOps, normalizeGroupAreas, normalizeGroups } from "../../runtime/groups.js";
import { normalizeMilitaryStats } from "../../runtime/militaryStats.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { statMeasure } from "../../runtime/projectEngine.js";
import { relationBandForScore } from "../../runtime/diplomaticStance.js";
import { BREAKER, EFFECT_CAPS, MONTHS_A_YEAR, PAYMENT_MOST, normalizeAgreementEffects, scaleOfList } from "../../runtime/agreementEffects.js";
import { dealsBetween, groupPartyKey, isDirectedGroupDeal, relationBetween } from "../../runtime/groupParties.js";
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
const turnOf = (round) => Math.max(0, Math.trunc(figure(round)));

export const DAYS_PER_MONTH = 30;

// ---- the systems an effect moves ------------------------------------------------------------

const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const isExplicitGroup = (value) => /^\s*group\s*:/i.test(String(value ?? ""));
const sheetKeyOf = (world, name) => {
  if (isExplicitGroup(name)) return "";
  const canonical = toCountryName(clean(name)) || clean(name);
  return Object.keys(record(world?.countryStats)).find((key) => fold(key) === fold(canonical) || fold(key) === fold(name)) ?? "";
};
const gdpOf = (world, name) => figure(record(world?.countryStats)[sheetKeyOf(world, name)]?.economy?.gdp);
const isPolityInWorld = (world, name) => {
  const canonical = toCountryName(clean(name)) || clean(name);
  return Boolean(
    sheetKeyOf(world, canonical)
    || Object.keys(record(world?.polityOverrides)).some((key) => fold(key) === fold(canonical))
    || (canonical && fold(canonical) !== fold(name)),
  );
};
// Resolves a party name inside an agreement effect to the canonical key used in
// world.relations / world.agreements: handles "group: Name", renamed groups,
// and ISO-3 country codes.
const resolveEffectParty = (world, name) => {
  const raw = clean(name);
  if (!raw) return "";
  const groupKey = groupPartyKey(world, raw);
  if (groupKey && isExplicitGroup(raw)) {
    return isPolityInWorld(world, groupKey) ? `group: ${groupKey}` : groupKey;
  }
  const canonical = toCountryName(raw) || raw;
  if (isPolityInWorld(world, canonical)) return canonical;
  if (groupKey) return groupKey;
  return canonical;
};

// The relation between two moved by `delta` (a row made where there is none, from 0).
export const withRelationShift = (world, a, b, delta, { date = "", round = 0 } = {}) => {
  const [x, y] = [resolveEffectParty(world, a), resolveEffectParty(world, b)];
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
    lastUpdatedDate: clean(date, 40) || clean(prior?.lastUpdatedDate, 40),
    updatedRound: turnOf(round),
    ...(prior ? {} : { createdRound: turnOf(round) }),
  };
  return { ...world, relations: [...list(world?.relations).filter((entry) => entry !== prior), row] };
};

// A country's sheet moved by a stat effect, bounded against the figure it moves; nothing for no sheet.
const withStat = (world, effect, scale) => {
  const key = sheetKeyOf(world, effect.party);
  if (!key) return world;
  const result = statEffectPatch(world.countryStats[key], effect, scale);
  if (!result) return world;
  const next = { ...world, countryStats: { ...record(world.countryStats) } };
  applyCountryStatPatchToWorld(next, key, result.patch);
  return next;
};

// Public debt, in points of GDP, on a country's sheet; nothing for no sheet.
const withDebt = (world, name, points) => {
  const key = sheetKeyOf(world, name);
  if (!key || !figure(points)) return world;
  const next = { ...world, countryStats: { ...record(world.countryStats) } };
  const before = figure(next.countryStats[key]?.economy?.publicDebt);
  applyCountryStatPatchToWorld(next, key, { economy: { publicDebt: Math.max(0, Math.round((before + points) * 10000) / 10000) } });
  return next;
};

// A payment: the payer's debt up by what it paid (held to its cap, a share of its GDP),
// the receiver's down by the same sum against its own GDP. When the payer has no GDP on
// record (a group, or an unassessed country), cap against the receiver's GDP so a group
// payment can never wipe out a country's entire public debt.
const withPayment = (world, effect, scale) => {
  const payerGdp = gdpOf(world, effect.from);
  const theirs = gdpOf(world, effect.to);
  // (A month's share is a twelfth of the year's cap.)
  const share = scale === "month" ? EFFECT_CAPS.payment.year / MONTHS_A_YEAR : EFFECT_CAPS.payment[scale];
  const baseGdp = payerGdp > 0 ? payerGdp : theirs;
  const most = baseGdp > 0 ? baseGdp * share : PAYMENT_MOST;
  const amount = Math.min(effect.amount, most);
  let next = world;
  if (payerGdp > 0) next = withDebt(next, effect.from, (amount / payerGdp) * 100);
  if (theirs > 0) next = withDebt(next, effect.to, -(amount / theirs) * 100);
  return next;
};

// A country's standing (world.internationalReputation, and its sheet's figure).
const withReputation = (world, name, delta) => {
  if (isExplicitGroup(name)) return world;
  const canonical = toCountryName(clean(name)) || clean(name);
  if (!canonical) return world;
  const map = record(world?.internationalReputation);
  const named = (table) => Object.keys(record(table)).find((entry) => fold(entry) === fold(canonical) || fold(entry) === fold(name));
  // Groups have no internationalReputation entry unless a colliding state exists.
  if (groupPartyKey(world, name) && !named(map) && !named(world?.countryStats) && !named(world?.polityOverrides)) return world;
  const key = named(map) ?? named(world?.countryStats) ?? named(world?.polityOverrides) ?? canonical;
  const sheetKey = sheetKeyOf(world, canonical);
  const sheetRep = record(world.countryStats)[sheetKey]?.indices?.internationalReputation;
  const before = hasNumber(map[key]) ? Number(map[key]) : hasNumber(sheetRep) ? Number(sheetRep) : 50;
  const value = Math.max(0, Math.min(100, Math.round(before + delta)));
  const next = { ...world, internationalReputation: { ...map, [key]: value } };
  if (sheetKey && hasNumber(sheetRep)) {
    next.countryStats = { ...world.countryStats };
    applyCountryStatPatchToWorld(next, sheetKey, { indices: { internationalReputation: value } });
  }
  return next;
};

// A group's own military figures moved, each within 0-100.
const withGroupFigure = (world, name, field, delta) => {
  const groups = record(world?.groups);
  const key = groupPartyKey(world, name);
  if (!key) return world;
  const before = normalizeMilitaryStats(groups[key]?.military) ?? {};
  const from = hasNumber(before[field]) ? Number(before[field]) : 50;
  const to = Math.max(0, Math.min(100, Math.round((from + delta) * 100) / 100));
  if (to === before[field]) return world;
  return { ...world, groups: { ...groups, [key]: { ...groups[key], military: { ...before, [field]: to } } } };
};

// A region of the map's catalog by its exact name (or id), for an area effect.
const regionNamed = (regions, written) => {
  const wanted = fold(written);
  return list(regions).find((region) => fold(region?.name) === wanted) ?? list(regions).find((region) => fold(region?.id) === wanted) ?? null;
};

const withArea = (world, effect, regions) => {
  const region = regionNamed(regions, effect.region);
  const key = groupPartyKey(world, effect.group);
  if (!region || !key) return world;
  const id = clean(region.id);
  const areas = normalizeGroupAreas(world.groupAreas, normalizeGroups(world.groups));
  if (effect.op === "release" && areas[id] !== key) return world;
  const applied = applyGroupOps({ groups: world.groups, groupAreas: world.groupAreas }, [{ op: effect.op, name: key, regionIds: [id] }]);
  return { ...world, groups: applied.groups, groupAreas: applied.groupAreas };
};

// The wars fought between just two, one on each side.
const warsBetweenOnly = (world, a, b) => list(world?.wars).filter((war) => {
  if (!["active", "ceasefire"].includes(fold(war?.status || "active"))) return false;
  const sideA = list(war?.sideA).map(fold);
  const sideB = list(war?.sideB).map(fold);
  if (sideA.length !== 1 || sideB.length !== 1) return false;
  return (sideA[0] === fold(a) && sideB[0] === fold(b)) || (sideA[0] === fold(b) && sideB[0] === fold(a));
});

const withWar = (world, agreement, op, { date = "", round = 0 } = {}) => {
  const [a, b] = list(agreement.parties);
  const ids = warsBetweenOnly(world, a, b)
    .filter((war) => (op === "ceasefire" ? fold(war?.status) === "active" : true))
    .map((war) => clean(war.id))
    .filter(Boolean);
  if (!ids.length) return world;
  return applyWarUpdates({
    world,
    updates: ids.map((id) => ({ id, op, actors: [], opponents: [], eventIds: [], baselineDate: clean(date, 40), note: clean(agreement.title) })),
    events: [],
    stopDate: clean(date, 40),
    round,
    limit: Infinity,
  }).world;
};

// Whether `name` resolves to one of the agreement's own participants.
const isAgreementParty = (world, agreement, name) => {
  const resolved = fold(resolveEffectParty(world, name));
  if (!resolved) return false;
  return list(agreement?.parties).some((party) => fold(resolveEffectParty(world, party)) === resolved);
};

// One effect carried out. `breaker`: who broke the agreement, for an onBreak effect naming "breaker".
// Every target party/group must be a participant of `agreement` so a treaty can never mutate
// an unrelated country's or group's canonical state.
export const applyAgreementEffect = (world, agreement, effect, { scale = "once", date = "", round = 0, regions = [], breaker = "" } = {}) => {
  const who = (name) => (fold(name) === BREAKER ? clean(breaker) : clean(name));
  const named = {
    ...effect,
    ...(effect.party ? { party: who(effect.party) } : {}),
    ...(effect.with ? { with: who(effect.with) } : {}),
    ...(effect.from ? { from: who(effect.from) } : {}),
    ...(effect.to ? { to: who(effect.to) } : {}),
    ...(effect.group ? { group: who(effect.group) } : {}),
  };
  switch (named.type) {
    case "stat":
      return isAgreementParty(world, agreement, named.party) ? withStat(world, named, scale) : world;
    case "relation":
      return isAgreementParty(world, agreement, named.party) && isAgreementParty(world, agreement, named.with)
        ? withRelationShift(world, named.party, named.with, named.change, { date, round })
        : world;
    case "reputation":
      return isAgreementParty(world, agreement, named.party) ? withReputation(world, named.party, named.change) : world;
    case "payment":
      return isAgreementParty(world, agreement, named.from) && isAgreementParty(world, agreement, named.to)
        ? withPayment(world, named, scale)
        : world;
    case "strength":
      return isAgreementParty(world, agreement, named.party) ? withGroupFigure(world, named.party, named.figure, named.change) : world;
    case "area":
      return scale === "once" && isAgreementParty(world, agreement, named.group) ? withArea(world, named, regions) : world;
    case "war":
      return scale === "once" ? withWar(world, agreement, named.op, { date, round }) : world;
    default:
      return world;
  }
};

const applyList = (world, agreement, name, options) => {
  const effects = normalizeAgreementEffects(agreement?.effects);
  let next = world;
  for (const effect of list(effects?.[name])) next = applyAgreementEffect(next, agreement, effect, { ...options, scale: scaleOfList(name) });
  return next;
};

const replaceAgreement = (world, agreement) => ({
  ...world,
  agreements: list(world?.agreements).map((entry) => (entry?.id === agreement.id ? agreement : entry)),
});

const endedRecord = (agreement, { date = "", round = 0, status = "ended", by = "" } = {}) => ({
  ...agreement,
  status,
  endedDate: clean(date, 40) || clean(agreement?.endedDate, 40),
  lastUpdatedDate: clean(date, 40) || clean(agreement?.lastUpdatedDate, 40),
  updatedRound: turnOf(round),
  ...(by ? { brokenBy: clean(by) } : {}),
});

// ---- made ---------------------------------------------------------------------------------------

// Whether two agreements bind the exact same parties (and in the same order
// for directed types like protection, sponsorship, crackdown, or guarantee).
const sameAgreementParties = (a, b) => {
  const left = list(a?.parties).map(fold).filter(Boolean);
  const right = list(b?.parties).map(fold).filter(Boolean);
  if (left.length !== right.length) return false;
  if (isDirectedGroupDeal(a?.type) || fold(a?.type) === "guarantee") {
    return left.every((party, index) => party === right[index]);
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((party, index) => party === sortedRight[index]);
};

// Carries out the making of every agreement in force whose making has not been carried out and
// that carries effects. Oldest first (the world lists its agreements newest first), so the newer of
// two of the same type between the same parties is the one that stands.
// Returns { world, started: [agreement] }.
export const settleAgreementStarts = (world, { date = "", round = 0, regions = [] } = {}) => {
  let next = world;
  const started = [];
  const pending = list(world?.agreements)
    .map((agreement, at) => ({ agreement, at }))
    .filter(({ agreement }) => live(agreement) && agreement.effectsApplied !== true && normalizeAgreementEffects(agreement.effects))
    .sort((p, q) => figure(p.agreement.createdRound) - figure(q.agreement.createdRound)
      || clean(p.agreement.startedDate, 40).localeCompare(clean(q.agreement.startedDate, 40))
      || q.at - p.at)
    .map(({ agreement }) => agreement);
  for (const original of pending) {
    const agreement = list(next.agreements).find((entry) => entry?.id === original.id);
    if (!agreement || !live(agreement)) continue;
    const [first, second] = list(agreement.parties);
    for (const prior of dealsBetween(next, first, second)) {
      if (prior.id === agreement.id || !live(prior) || prior.type !== agreement.type || !sameAgreementParties(prior, agreement)) continue;
      if (normalizeAgreementEffects(prior.effects) && prior.effectsApplied !== true) continue;
      next = replaceAgreement(next, { ...endedRecord(prior, { date, round }), endApplied: true });
    }
    next = applyList(next, agreement, "onSign", { date, round, regions });
    const done = { ...(list(next.agreements).find((entry) => entry?.id === agreement.id) ?? agreement), effectsApplied: true };
    next = replaceAgreement(next, done);
    started.push(done);
  }
  return { world: next, started };
};

// ---- ended ---------------------------------------------------------------------------------------

// Carries out the end of every agreement that ended (or expired) with effects whose end has not been
// carried out: its onBreak effects when a party broke it, else its onEnd. Returns { world, ended }.
export const settleAgreementEnds = (world, { date = "", round = 0, regions = [] } = {}) => {
  let next = world;
  const ended = [];
  for (const agreement of list(world?.agreements)) {
    if (!["ended", "expired"].includes(fold(agreement?.status)) || agreement.endApplied === true || !normalizeAgreementEffects(agreement.effects)) continue;
    const breaker = clean(agreement.brokenBy);
    const which = breaker && normalizeAgreementEffects(agreement.effects)?.onBreak ? "onBreak" : "onEnd";
    // (Its making's effects first, if it ended before they were ever carried out.)
    if (agreement.effectsApplied !== true) next = applyList(next, agreement, "onSign", { date, round, regions });
    next = applyList(next, agreement, which, { date, round, regions, breaker });
    next = replaceAgreement(next, { ...agreement, effectsApplied: true, endApplied: true });
    ended.push({ ...agreement, by: which });
  }
  return { world: next, ended };
};

// A party breaks an agreement it is in: it ends, and its onBreak effects (or onEnd, when it has no
// breach written) are carried out. Returns { world, agreement, reason }.
export const breakAgreement = (world, { id = "", by = "", date = "", round = 0, regions = [] } = {}) => {
  const agreement = list(world?.agreements).find((entry) => clean(entry?.id) === clean(id));
  if (!agreement || !["active", "suspended"].includes(fold(agreement.status || "active"))) return { world, agreement: null, reason: "not-open" };
  if (!list(agreement.parties).some((party) => fold(party) === fold(by))) return { world, agreement: null, reason: "not-yours" };
  const broken = endedRecord(agreement, { date, round, by });
  const settled = settleAgreementEnds(replaceAgreement(world, broken), { date, round, regions });
  return { world: settled.world, agreement: broken, reason: "" };
};

// ---- the turn -----------------------------------------------------------------------------------

// How many days of this turn's `period` an agreement was actually in force:
// an agreement signed mid-turn only accrues from its `startedDate` through `date`,
// never retroactively across the full skip duration.
const activeDaysFor = (agreement, period, date) => {
  const started = clean(agreement?.startedDate, 40);
  const until = clean(date, 40);
  if (!started || !until) return period;
  const sinceStart = diffGameDays(started, until);
  if (!Number.isFinite(sinceStart)) return period;
  if (sinceStart <= 0) return 0;
  return Math.min(period, sinceStart);
};

// What the end of a turn does with the agreements: the making of new ones, a month of effects for every
// whole month each was in force, the term of each, and the end of those that ended.
//   days      how long the period was
//   regions   the map's catalog, for an effect that moves a group's area
// Returns { world, notes: [string] } for the turn's log.
export const turnAgreements = ({ world = {}, days = 0, date = "", round = 0, regions = [] } = {}) => {
  const notes = [];
  const starts = settleAgreementStarts(world, { date, round, regions });
  let next = starts.world;
  for (const agreement of starts.started) notes.push(`made: ${clean(agreement.title) || agreement.type}`);

  const period = Math.max(0, figure(days));
  if (period > 0) {
    for (const original of list(next.agreements)) {
      if (!live(original) || original.effectsApplied !== true) continue;
      const effects = normalizeAgreementEffects(original.effects);
      if (!effects) continue;
      let agreement = list(next.agreements).find((entry) => entry?.id === original.id) ?? original;
      const elapsed = activeDaysFor(agreement, period, date);
      if (elapsed <= 0) continue;
      const carried = figure(agreement.carryDays) + elapsed;
      const run = figure(agreement.monthsRun);
      const term = figure(effects.months);
      const left = term > 0 ? Math.max(0, term - run) : Infinity;
      const months = Math.min(left, Math.floor(carried / DAYS_PER_MONTH));
      // Each month a twelfth of each year's effect, held to a twelfth of its cap.
      // Figures stored as whole integers (relation, reputation, group strength, and
      // points-measured sheet stats such as stability/indices/military) are banked as
      // fractions of a point (`figureCarry`) and applied a whole point at a time;
      // fractional stats are banked to 0.01 steps so sub-0.06/yr changes aren't lost.
      const banked = { ...record(agreement.figureCarry) };
      for (let month = 0; month < months; month += 1) {
        for (const effect of list(effects.perYear)) {
          const twelfth = effect.type === "payment"
            ? { ...effect, amount: effect.amount / MONTHS_A_YEAR }
            : { ...effect, change: effect.change / MONTHS_A_YEAR };
          if (effect.type === "payment") {
            next = applyAgreementEffect(next, agreement, twelfth, { scale: "month", date, round, regions });
            continue;
          }
          if (effect.type === "stat") {
            const key = `stat|${fold(effect.party)}|${fold(effect.stat)}`;
            const total = figure(banked[key]) + twelfth.change;
            if (statMeasure(effect.stat) === "points") {
              const whole = Math.trunc(total);
              banked[key] = Math.round((total - whole) * 1000) / 1000;
              // Apply the banked whole point without re-clamping down to the 0.5 monthly cap.
              if (whole) next = applyAgreementEffect(next, agreement, { ...effect, change: whole }, { scale: "once", date, round, regions });
            } else {
              const step = Math.trunc(total * 100) / 100;
              banked[key] = Math.round((total - step) * 10000) / 10000;
              if (step) next = applyAgreementEffect(next, agreement, { ...effect, change: step }, { scale: "month", date, round, regions });
            }
            continue;
          }
          if (!["relation", "reputation", "strength"].includes(effect.type)) {
            next = applyAgreementEffect(next, agreement, twelfth, { scale: "month", date, round, regions });
            continue;
          }
          const key = `${effect.type}|${fold(effect.party)}|${fold(effect.with || effect.figure || "")}`;
          const total = figure(banked[key]) + twelfth.change;
          const whole = Math.trunc(total);
          banked[key] = Math.round((total - whole) * 1000) / 1000;
          if (whole) next = applyAgreementEffect(next, agreement, { ...effect, change: whole }, { scale: "month", date, round, regions });
        }
      }
      agreement = list(next.agreements).find((entry) => entry?.id === original.id) ?? agreement;
      const kept = { ...agreement, monthsRun: run + months };
      const carry = Object.fromEntries(Object.entries(banked).filter(([, value]) => value));
      if (Object.keys(carry).length) kept.figureCarry = carry;
      else delete kept.figureCarry;
      const rest = Math.round(carried - months * DAYS_PER_MONTH);
      if (rest > 0 && kept.monthsRun < (term > 0 ? term : Infinity)) kept.carryDays = rest;
      else delete kept.carryDays;
      if (months > 0 && effects.perYear?.length) notes.push(`${months} month${months === 1 ? "" : "s"} of ${clean(agreement.title) || agreement.type}`);
      next = replaceAgreement(next, term > 0 && kept.monthsRun >= term ? endedRecord(kept, { date, round, status: "expired" }) : kept);
    }
  }

  const ends = settleAgreementEnds(next, { date, round, regions });
  for (const agreement of ends.ended) notes.push(`${agreement.by === "onBreak" ? "broken" : "ended"}: ${clean(agreement.title) || agreement.type}`);
  return { world: ends.world, notes };
};
