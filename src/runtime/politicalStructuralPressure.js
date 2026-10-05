/*! Open Historia — structural world-to-politics pressure derivation (Continuum) */

import { getPoliticalProfileKey } from "./politicalActors.js";
import { compareGameDates, compareGameDatesNewestFirst, diffGameDays } from "./gameDates.js";
import { puppetStatesEnabled } from "./puppets.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const asArray = (value) => Array.isArray(value) ? value : [];

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const exposureMultiplier = (persistence, months) => {
  const p = clamp(Number(persistence) || 0, 0, 0.9999);
  const elapsed = Math.max(0, Number(months) || 0);
  if (elapsed <= 0) return 0;
  return (1 - Math.pow(p, elapsed)) / (1 - p);
};

const scaledSignal = ({ issue, salience, strain, lean = 0, persistence, source }, months) => {
  const multiplier = exposureMultiplier(persistence, months);
  const nextSalience = round1(clamp((Number(salience) || 0) * multiplier, 0, 100));
  const nextStrain = round1(clamp((Number(strain) || 0) * multiplier, 0, 100));
  if (nextSalience <= 0 && nextStrain <= 0) return null;
  return {
    issue,
    salience: nextSalience,
    strain: nextStrain,
    lean: round1(clamp(Number(lean) || 0, -100, 100)),
    persistence,
    source,
  };
};

const append = (signalsByPolity, polityKey, signal) => {
  if (!polityKey || !signal) return;
  if (!signalsByPolity[polityKey]) signalsByPolity[polityKey] = [];
  signalsByPolity[polityKey].push(signal);
};

// One resolver per derivation: every stats key, relation side and war participant
// names a polity, and the same few hundred names repeat across thousands of
// rows. An exact Political Actor key answers at once; anything else goes through
// the full profile lookup once and is remembered for the rest of the call.
const polityKeyResolver = (world) => {
  const byPolity = world?.politicalActors?.byPolity || {};
  const known = new Map();
  return (token) => {
    const name = clean(token);
    if (!name) return "";
    if (Object.prototype.hasOwnProperty.call(byPolity, name)) return name;
    if (!known.has(name)) known.set(name, getPoliticalProfileKey(world, name));
    return known.get(name);
  };
};

const source = ({ id, date, note }) => ({
  kind: "structural",
  id: clean(id),
  date: clean(date),
  note: clean(note),
});


const previousStatsSample = (world, statsKey, updatedAt) => {
  const series = Array.isArray(world?.countryStatsHistory?.[statsKey]) ? world.countryStatsHistory[statsKey] : [];
  const cutoff = clean(updatedAt);
  const candidates = series
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => !cutoff || !clean(entry.date) || compareGameDates(clean(entry.date), cutoff) < 0)
    .sort((left, right) => compareGameDatesNewestFirst(clean(left?.date), clean(right?.date)));
  return candidates[0] || null;
};

const statsSignals = ({ world, months, updatedAt, signalsByPolity, polityKeyFor }) => {
  for (const [statsKey, sheet] of Object.entries(world?.countryStats || {})) {
    const polityKey = polityKeyFor(statsKey);
    if (!polityKey || !sheet || typeof sheet !== "object") continue;
    const economy = sheet.economy && typeof sheet.economy === "object" ? sheet.economy : {};
    const previous = previousStatsSample(world, statsKey, updatedAt);

    const gdpGrowth = finite(economy.gdpGrowth);
    if (gdpGrowth != null && gdpGrowth < 0) {
      const severity = clamp((-gdpGrowth) / 8, 0, 1);
      append(signalsByPolity, polityKey, scaledSignal({
        issue: "economic_stress",
        salience: 4 + (8 * severity),
        strain: 5 + (12 * severity),
        lean: 100,
        persistence: 0.8,
        source: source({ id: `stats:${polityKey}:gdp-growth`, date: updatedAt, note: `Negative GDP growth (${gdpGrowth}%).` }),
      }, months));
    }

    const inflation = finite(economy.inflation);
    const previousInflation = finite(previous?.inflation);
    const inflationRise = inflation != null && previousInflation != null ? inflation - previousInflation : 0;
    if (inflation != null && (inflation >= 8 || inflationRise >= 2)) {
      const severity = clamp(Math.max((inflation - 8) / 20, inflationRise / 10), 0, 1);
      append(signalsByPolity, polityKey, scaledSignal({
        issue: "cost_of_living",
        salience: 3 + (10 * severity),
        strain: 4 + (14 * severity),
        lean: 100,
        persistence: 0.78,
        source: source({ id: `stats:${polityKey}:inflation`, date: updatedAt, note: `Elevated inflation (${inflation}%).` }),
      }, months));
      append(signalsByPolity, polityKey, scaledSignal({
        issue: "economic_stress",
        salience: 2 + (5 * severity),
        strain: 2 + (8 * severity),
        lean: 100,
        persistence: 0.8,
        source: source({ id: `stats:${polityKey}:inflation-stress`, date: updatedAt, note: `Inflation contributes to broader economic stress (${inflation}%).` }),
      }, months));
    }

    const unemployment = finite(economy.unemployment);
    const previousUnemployment = finite(previous?.unemployment);
    const unemploymentRise = unemployment != null && previousUnemployment != null ? unemployment - previousUnemployment : 0;
    if (unemployment != null && (unemployment >= 10 || unemploymentRise >= 1.5)) {
      const severity = clamp(Math.max((unemployment - 10) / 15, unemploymentRise / 8), 0, 1);
      append(signalsByPolity, polityKey, scaledSignal({
        issue: "unemployment",
        salience: 3 + (9 * severity),
        strain: 4 + (12 * severity),
        lean: 100,
        persistence: 0.82,
        source: source({ id: `stats:${polityKey}:unemployment`, date: updatedAt, note: `Elevated unemployment (${unemployment}%).` }),
      }, months));
      append(signalsByPolity, polityKey, scaledSignal({
        issue: "economic_stress",
        salience: 2 + (4 * severity),
        strain: 3 + (7 * severity),
        lean: 100,
        persistence: 0.8,
        source: source({ id: `stats:${polityKey}:unemployment-stress`, date: updatedAt, note: `Labour-market weakness contributes to broader economic stress (${unemployment}% unemployment).` }),
      }, months));
    }

    const stability = finite(sheet.stability);
    const previousStability = finite(previous?.stability);
    const stabilityDrop = stability != null && previousStability != null ? previousStability - stability : 0;
    if (stability != null && (stability <= 35 || stabilityDrop >= 8)) {
      const severity = clamp(Math.max((35 - stability) / 25, stabilityDrop / 30), 0, 1);
      append(signalsByPolity, polityKey, scaledSignal({
        issue: "institutional_trust",
        salience: 2 + (6 * severity),
        strain: 5 + (12 * severity),
        lean: 0,
        persistence: 0.84,
        source: source({ id: `stats:${polityKey}:stability`, date: updatedAt, note: `Low political stability (${stability}/100).` }),
      }, months));
    }
  }
};

const relationSignals = ({ world, months, updatedAt, signalsByPolity, polityKeyFor }) => {
  const byPolity = new Map();
  for (const relation of asArray(world?.relations)) {
    const score = finite(relation?.score);
    if (score == null || score > -40) continue;
    for (const token of [relation?.a, relation?.b]) {
      const polityKey = polityKeyFor(token);
      if (!polityKey) continue;
      const current = byPolity.get(polityKey) || { worst: 0, count: 0 };
      current.worst = Math.min(current.worst, score);
      current.count += 1;
      byPolity.set(polityKey, current);
    }
  }

  for (const [polityKey, state] of byPolity) {
    const severity = clamp((-40 - state.worst) / 60, 0, 1);
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "security",
      salience: 2 + (6 * severity) + Math.min(4, Math.max(0, state.count - 1)),
      strain: 1 + (4 * severity),
      lean: 45 + (35 * severity),
      persistence: 0.76,
      source: source({ id: `relations:${polityKey}`, date: updatedAt, note: `${state.count} materially strained/hostile bilateral relationship(s); worst score ${state.worst}.` }),
    }, months));
  }
};

const warSignals = ({ world, months, updatedAt, signalsByPolity, polityKeyFor }) => {
  const byPolity = new Map();
  for (const war of asArray(world?.wars)) {
    if (clean(war?.status).toLowerCase() !== "active") continue;
    // Game dates, BC included (runtime/gameDates.js); 0 when either is unreadable.
    const ageDays = Math.max(0, diffGameDays(clean(war?.startedDate), clean(updatedAt)) ?? 0);

    const participants = [...asArray(war?.sideA), ...asArray(war?.sideB)];
    for (const token of participants) {
      const polityKey = polityKeyFor(token);
      if (!polityKey) continue;
      const state = byPolity.get(polityKey) || { count: 0, longestDays: 0 };
      state.count += 1;
      state.longestDays = Math.max(state.longestDays, ageDays);
      byPolity.set(polityKey, state);
    }
  }

  for (const [polityKey, state] of byPolity) {
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "security",
      salience: 8 + Math.min(8, Math.max(0, state.count - 1) * 2),
      strain: 7 + Math.min(8, Math.max(0, state.count - 1) * 2),
      lean: 75,
      persistence: 0.88,
      source: source({ id: `wars:${polityKey}:active`, date: updatedAt, note: `Direct belligerent in ${state.count} active war(s).` }),
    }, months));

    if (state.longestDays >= 90) {
      const ageSeverity = clamp((state.longestDays - 90) / 720, 0, 1);
      append(signalsByPolity, polityKey, scaledSignal({
        issue: "war_weariness",
        salience: 2 + (10 * ageSeverity),
        strain: 4 + (14 * ageSeverity),
        lean: 100,
        persistence: 0.91,
        source: source({ id: `wars:${polityKey}:weariness`, date: updatedAt, note: `Sustained active war exposure (${state.longestDays} days).` }),
      }, months));
    }
  }
};

// Regions each Political Actor administers, from the explicit ownership map. A
// stock map owned through its base tiles has rows only where a region changed
// hands, so its polities count only those; the snapshot the clock keeps
// (heldRegions) lets the next turn see a net loss.
export const heldRegionCounts = (world, polityKeyFor = polityKeyResolver(world)) => {
  const counts = {};
  for (const owner of Object.values(world?.regionOwnershipOverrides || {})) {
    const polityKey = polityKeyFor(owner);
    if (polityKey) counts[polityKey] = (counts[polityKey] || 0) + 1;
  }
  return counts;
};

// How much of a polity an area is: its share of what the polity administers
// when that is known, else a plain region count.
const areaSeverity = (count, total) => (total > 0
  ? clamp((count / total) * 3, 0, 1)
  : clamp(count / 30, 0, 1));

// Groups (world.groupAreas) controlling regions a polity administers: a state
// that does not hold its own ground faces regional and security pressure.
const groupControlSignals = ({ world, months, updatedAt, signalsByPolity, polityKeyFor, held }) => {
  const owners = world?.regionOwnershipOverrides || {};
  const byPolity = new Map();
  for (const [regionId, group] of Object.entries(world?.groupAreas || {})) {
    const polityKey = clean(group) ? polityKeyFor(owners[regionId]) : "";
    if (!polityKey) continue;
    const state = byPolity.get(polityKey) || { regions: 0, groups: new Set() };
    state.regions += 1;
    state.groups.add(clean(group));
    byPolity.set(polityKey, state);
  }

  for (const [polityKey, state] of byPolity) {
    const severity = areaSeverity(state.regions, held[polityKey] || 0);
    const note = `${state.regions} region(s) controlled by ${state.groups.size} group(s) outside the government's control.`;
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "regionalism",
      salience: 3 + (9 * severity),
      strain: 3 + (10 * severity),
      lean: 55,
      persistence: 0.86,
      source: source({ id: `groups:${polityKey}:regionalism`, date: updatedAt, note }),
    }, months));
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "security",
      salience: 4 + (8 * severity),
      strain: 3 + (9 * severity),
      lean: 65,
      persistence: 0.86,
      source: source({ id: `groups:${polityKey}:security`, date: updatedAt, note }),
    }, months));
  }
};

// Ground a polity is sovereign over but does not hold (an occupation), and
// ground it claims that another polity holds, press on sovereignty and
// national identity; an occupation far more than a standing claim.
const unheldTerritorySignals = ({ world, months, updatedAt, signalsByPolity, polityKeyFor, held }) => {
  const owners = world?.regionOwnershipOverrides || {};
  const sovereigns = world?.regionSovereigntyOverrides || {};
  const occupied = new Map();
  const claimed = new Map();
  const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const [regionId, sovereign] of Object.entries(sovereigns)) {
    const polityKey = polityKeyFor(sovereign);
    if (polityKey && polityKeyFor(owners[regionId]) !== polityKey) count(occupied, polityKey);
  }
  for (const [regionId, claimants] of Object.entries(world?.regionClaimants || {})) {
    const holder = polityKeyFor(owners[regionId]);
    const sovereign = polityKeyFor(sovereigns[regionId]);
    for (const polityKey of new Set(asArray(claimants).map(polityKeyFor))) {
      if (polityKey && polityKey !== holder && polityKey !== sovereign) count(claimed, polityKey);
    }
  }

  for (const [polityKey, regions] of occupied) {
    const severity = areaSeverity(regions, (held[polityKey] || 0) + regions);
    const note = `${regions} region(s) under its sovereignty held by another power.`;
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "sovereignty",
      salience: 4 + (10 * severity),
      strain: 5 + (12 * severity),
      lean: 85,
      persistence: 0.88,
      source: source({ id: `territory:${polityKey}:occupied`, date: updatedAt, note }),
    }, months));
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "national_identity",
      salience: 3 + (8 * severity),
      strain: 3 + (9 * severity),
      lean: 65,
      persistence: 0.88,
      source: source({ id: `territory:${polityKey}:occupied-identity`, date: updatedAt, note }),
    }, months));
  }

  for (const [polityKey, regions] of claimed) {
    const severity = clamp(regions / 20, 0, 1);
    const note = `Claims ${regions} region(s) another polity holds.`;
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "sovereignty",
      salience: 1 + (4 * severity),
      strain: 1 + (3 * severity),
      lean: 60,
      persistence: 0.8,
      source: source({ id: `territory:${polityKey}:claims`, date: updatedAt, note }),
    }, months));
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "national_identity",
      salience: 2 + (5 * severity),
      strain: 1 + (4 * severity),
      lean: 55,
      persistence: 0.8,
      source: source({ id: `territory:${polityKey}:claims-identity`, date: updatedAt, note }),
    }, months));
  }
};

// An open puppet feels its overlord's direction as a sovereignty question, the
// more so the less loyal it is. A covert arrangement is not public, so it moves
// no public opinion, and none of this runs while Puppet states is switched off.
const puppetSignals = ({ world, months, updatedAt, signalsByPolity, polityKeyFor }) => {
  if (!puppetStatesEnabled()) return;
  for (const row of asArray(world?.puppets)) {
    if (clean(row?.status).toLowerCase() !== "active" || clean(row?.secrecy).toLowerCase() === "covert") continue;
    const polityKey = polityKeyFor(row?.puppet);
    if (!polityKey || polityKey === polityKeyFor(row?.overlord)) continue;
    const loyalty = finite(row?.loyalty);
    const severity = clamp(1 - ((loyalty ?? 50) / 100), 0, 1);
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "sovereignty",
      salience: 4 + (6 * severity),
      strain: 3 + (9 * severity),
      lean: 80,
      persistence: 0.9,
      source: source({ id: `puppets:${polityKey}`, date: updatedAt, note: `Openly directed by a foreign overlord (${clean(row?.kind) || "subordinate"}).` }),
    }, months));
  }
};

// Ground lost since the clock last advanced, net of ground gained.
const territoryLossSignals = ({ world, months, updatedAt, signalsByPolity, held }) => {
  const byPolity = world?.politicalActors?.byPolity || {};
  const previous = world?.politicalSimulation?.heldRegions;
  if (!previous || typeof previous !== "object") return;
  for (const [polityKey, before] of Object.entries(previous)) {
    const lost = (Number(before) || 0) - (held[polityKey] || 0);
    if (lost <= 0 || !Object.prototype.hasOwnProperty.call(byPolity, polityKey)) continue;
    const severity = clamp(Math.max((lost / Math.max(1, Number(before))) * 4, lost / 20), 0, 1);
    append(signalsByPolity, polityKey, scaledSignal({
      issue: "national_identity",
      salience: 3 + (9 * severity),
      strain: 3 + (10 * severity),
      lean: 75,
      persistence: 0.85,
      source: source({ id: `territory:${polityKey}:lost`, date: updatedAt, note: `Lost ${lost} region(s) since the last political update.` }),
    }, months));
  }
};

// This is a DERIVATION boundary only. It reads canonical world ledgers/stats and
// emits already-structured pressure signals for existing Political Actors. It
// never creates actors, edits Stats/war/diplomatic state, or emits timeline news.
// `groups` false while groups are switched off for the game
// (server/gameFeatures.js): their areas press on no one, as puppets do not.
export const derivePoliticalStructuralSignals = (world, { months = 0, updatedAt = "", groups = true } = {}) => {
  const elapsed = Math.max(0, Number(months) || 0);
  const signalsByPolity = {};
  if (elapsed <= 0 || !world?.politicalActors?.byPolity) return signalsByPolity;

  const polityKeyFor = polityKeyResolver(world);
  const context = { world, months: elapsed, updatedAt, signalsByPolity, polityKeyFor, held: heldRegionCounts(world, polityKeyFor) };
  statsSignals(context);
  relationSignals(context);
  warSignals(context);
  if (groups) groupControlSignals(context);
  unheldTerritorySignals(context);
  puppetSignals(context);
  territoryLossSignals(context);

  return Object.fromEntries(
    Object.entries(signalsByPolity)
      .filter(([, signals]) => signals.length)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
};
