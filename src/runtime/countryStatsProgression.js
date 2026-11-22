// Minimal native GDP/demographic progression for existing national Stats sheets.
// One canonical World writer owns these mutations; there is no AI scheduler,
// independent economy store, or automatic historical re-baselining.
import { diffGameDays, normalizeGameDate } from "./gameDates.js";
import { aggregateTerritorialEconomy, normalizeCountryStatSheet } from "./countryStats.js";

const DAYS_PER_YEAR = 365.2425;
const MAX_GROWTH = 100;
const MIN_GROWTH = -100;
const MAX_POPULATION_GROWTH = 20;
const MIN_POPULATION_GROWTH = -20;

const rateOf = (value, min, max) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : NaN;
};
const safeCarry = (value, limit) => {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : 0;
};
const ratio = (rate, days) => (rate === null ? 1 : Math.pow(1 + rate / 100, days / DAYS_PER_YEAR));

// Distribute a national rounded population by existing territorial weights.
// Largest remainder keeps all inhabitants accounted for when each component
// has to be stored as an integer.
const distributePopulation = (components, total) => {
  const before = components.reduce((sum, row) => sum + row.population, 0);
  if (!(before > 0) || !(total > 0)) return null;
  const exact = components.map((row) => row.population * total / before);
  const integers = exact.map(Math.floor);
  let remain = total - integers.reduce((sum, value) => sum + value, 0);
  const order = exact.map((number, index) => ({ index, fractional: number - integers[index] }))
    .sort((a, b) => b.fractional - a.fractional || a.index - b.index);
  for (let i = 0; i < remain && i < order.length; i += 1) integers[order[i].index] += 1;
  return components.map((row, index) => ({ ...row, population: integers[index] }));
};

const advanceSheet = (source, { fromDate, toDate }) => {
  // Validate raw, pre-normalization rates. An unbounded provider value must not
  // be silently clamped to a plausible rate and then compounded.
  const growth = rateOf(source?.economy?.gdpGrowth, MIN_GROWTH, MAX_GROWTH);
  const demographic = rateOf(source?.population?.annualGrowthRate, MIN_POPULATION_GROWTH, MAX_POPULATION_GROWTH);
  if (Number.isNaN(growth) || Number.isNaN(demographic)) return null;
  if (growth === null && demographic === null) return null;
  if (source?.continuity?.progressionBlocked === true) return null;

  const sheet = normalizeCountryStatSheet(source);
  if (!sheet) return null;
  const priorCursor = sheet.continuity?.lastProgressedDate;
  const priorDate = priorCursor ? normalizeGameDate(priorCursor) : fromDate;
  if (priorCursor && !priorDate) return null;
  const from = Math.max(0, diffGameDays(fromDate, priorDate) ?? -1) > 0 ? priorDate : fromDate;
  const days = diffGameDays(from, toDate);
  if (!(days > 0)) return null;

  const gdpMultiplier = ratio(growth, days);
  const populationMultiplier = ratio(demographic, days);
  if (!(gdpMultiplier > 0) || !(populationMultiplier > 0)
    || !Number.isFinite(gdpMultiplier) || !Number.isFinite(populationMultiplier)) return null;

  const components = sheet.territorialComponents;
  const mapped = Array.isArray(components) && components.length > 0;
  // Existing scenario-custom sheets often have a real hidden national backend
  // but predate territorial components. Progress those known GDP/population
  // totals in compatibility mode; an explicitly empty MAPPED ledger remains
  // incomplete and must not acquire a fabricated economy.
  if (!mapped && Array.isArray(components) && sheet.territorialScope !== "nonterritorial") return null;

  const baselinePopulation = Number(sheet.population?.total);
  if (!Number.isSafeInteger(baselinePopulation) || baselinePopulation <= 0) return null;
  const previousExactPopulation = baselinePopulation
    + safeCarry(sheet.continuity?.populationRemainder, 0.5);
  const exactPopulation = previousExactPopulation * populationMultiplier;
  if (!Number.isFinite(exactPopulation) || exactPopulation < 1 || exactPopulation > Number.MAX_SAFE_INTEGER) return null;
  const newPopulation = Math.round(exactPopulation);
  const populationRemainder = exactPopulation - newPopulation;

  const baselineGdp = Number(sheet.economy?.gdp);
  const hasGdp = Number.isFinite(baselineGdp) && baselineGdp > 0;
  // A legacy national backend needs actual GDP as well as population. An
  // optional population trend on its own cannot establish an economic sheet.
  if (!mapped && !hasGdp && sheet.territorialScope !== "nonterritorial") return null;
  if (growth !== null && !hasGdp) return null;
  const previousExactGdp = hasGdp
    ? baselineGdp + safeCarry(sheet.continuity?.gdpRemainder, 1e9)
    : null;
  const exactGdp = hasGdp ? previousExactGdp * gdpMultiplier : null;
  if (hasGdp && (!(exactGdp > 0) || !Number.isFinite(exactGdp))) return null;

  const continuity = {
    ...(sheet.continuity || {}),
    lastProgressedDate: toDate,
    populationRemainder,
  };
  let next;
  if (mapped) {
    const before = aggregateTerritorialEconomy(components);
    if (!before || !(before.gdp > 0)) return null;
    const withPopulation = distributePopulation(components, newPopulation);
    if (!withPopulation) return null;
    const afterPopulationGdp = withPopulation.reduce((sum, row) => sum + row.population * row.gdpPerCapita, 0);
    const gdpTarget = exactGdp ?? before.gdp;
    if (!(afterPopulationGdp > 0) || !(gdpTarget > 0)) return null;
    const multiplier = gdpTarget / afterPopulationGdp;
    const nextComponents = withPopulation.map((row) => ({
      ...row,
      gdpPerCapita: Math.round(row.gdpPerCapita * multiplier * 100) / 100,
    }));
    if (nextComponents.some((row) => !(row.gdpPerCapita > 0) || !Number.isFinite(row.gdpPerCapita))) return null;
    const computed = aggregateTerritorialEconomy(nextComponents);
    if (!computed) return null;
    continuity.gdpRemainder = gdpTarget - Math.round(computed.gdp);
    if (Math.abs(continuity.gdpRemainder) > 1e9) return null;
    next = normalizeCountryStatSheet({
      ...sheet,
      territorialComponents: nextComponents,
      continuity,
    });
  } else {
    continuity.gdpRemainder = hasGdp ? exactGdp - Math.round(exactGdp) : 0;
    next = normalizeCountryStatSheet({
      ...sheet,
      population: { ...sheet.population, total: newPopulation },
      economy: hasGdp ? { ...sheet.economy, gdp: Math.round(exactGdp) } : sheet.economy,
      continuity,
    });
  }

  if (!next || next.population?.total !== newPopulation) return null;
  if (next.continuity?.lastProgressedDate !== toDate) return null;
  return next;
};

// Advance each valid national ledger from its latest persisted cursor, or from
// the beginning of the FIRST eligible post-upgrade turn for older saves.
// Events may change a growth rate at their own date between these calls.
export const advanceCountryStatsInterval = (countryStats, { fromDate, toDate } = {}) => {
  const from = normalizeGameDate(fromDate);
  const to = normalizeGameDate(toDate);
  const days = from && to ? diffGameDays(from, to) : null;
  if (!from || !to || !(days > 0) || !countryStats || typeof countryStats !== "object" || Array.isArray(countryStats)) {
    return { countryStats, advanced: [] };
  }
  let next = countryStats;
  const advanced = [];
  for (const [code, sheet] of Object.entries(countryStats)) {
    if (!code || !sheet || typeof sheet !== "object") continue;
    const updated = advanceSheet(sheet, { fromDate: from, toDate: to });
    if (!updated) continue;
    if (next === countryStats) next = { ...countryStats };
    next[code] = updated;
    advanced.push(code);
  }
  return { countryStats: next, advanced };
};
