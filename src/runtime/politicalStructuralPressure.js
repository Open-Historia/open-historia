/*! Open Historia — structural world-to-politics pressure derivation (Continuum) */

import { getPoliticalProfileKey } from "./politicalActors.js";

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

const polityKeyFor = (world, token) => getPoliticalProfileKey(world, clean(token));

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
    .filter((entry) => !cutoff || !clean(entry.date) || clean(entry.date) < cutoff)
    .sort((left, right) => clean(right?.date).localeCompare(clean(left?.date)));
  return candidates[0] || null;
};

const statsSignals = ({ world, months, updatedAt, signalsByPolity }) => {
  for (const [statsKey, sheet] of Object.entries(world?.countryStats || {})) {
    const polityKey = polityKeyFor(world, statsKey);
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

const relationSignals = ({ world, months, updatedAt, signalsByPolity }) => {
  const byPolity = new Map();
  for (const relation of asArray(world?.relations)) {
    const score = finite(relation?.score);
    if (score == null || score > -40) continue;
    for (const token of [relation?.a, relation?.b]) {
      const polityKey = polityKeyFor(world, token);
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

const warSignals = ({ world, months, updatedAt, signalsByPolity }) => {
  const byPolity = new Map();
  const toTime = /^\d{4}-\d{2}-\d{2}$/.test(clean(updatedAt)) ? new Date(`${updatedAt}T00:00:00Z`).getTime() : NaN;

  for (const war of asArray(world?.wars)) {
    if (clean(war?.status).toLowerCase() !== "active") continue;
    const startedTime = /^\d{4}-\d{2}-\d{2}$/.test(clean(war?.startedDate))
      ? new Date(`${war.startedDate}T00:00:00Z`).getTime()
      : NaN;
    const ageDays = Number.isFinite(toTime) && Number.isFinite(startedTime)
      ? Math.max(0, Math.round((toTime - startedTime) / 86400000))
      : 0;

    const participants = [...asArray(war?.sideA), ...asArray(war?.sideB)];
    for (const token of participants) {
      const polityKey = polityKeyFor(world, token);
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

// This is a DERIVATION boundary only. It reads canonical world ledgers/stats and
// emits already-structured pressure signals for existing Political Actors. It
// never creates actors, edits Stats/war/diplomatic state, or emits timeline news.
export const derivePoliticalStructuralSignals = (world, { months = 0, updatedAt = "" } = {}) => {
  const elapsed = Math.max(0, Number(months) || 0);
  const signalsByPolity = {};
  if (elapsed <= 0 || !world?.politicalActors?.byPolity) return signalsByPolity;

  statsSignals({ world, months: elapsed, updatedAt, signalsByPolity });
  relationSignals({ world, months: elapsed, updatedAt, signalsByPolity });
  warSignals({ world, months: elapsed, updatedAt, signalsByPolity });

  return Object.fromEntries(
    Object.entries(signalsByPolity)
      .filter(([, signals]) => signals.length)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
};
