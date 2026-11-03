/*! Open Historia - bounded native fiscal accrual from an established Stats assessment. */
import { addGameDays, compareGameDates, diffGameDays, isCanonicalGameDate } from "./gameDates.js";
import { mergeCountryStatPatch, normalizeCountryStatSheet, normalizeCountryStatFiscalClock } from "./countryStats.js";
import { collectActiveScenarioPolityKeys } from "./scenarioPolities.js";

// Budget balance and public debt are recorded as shares (%) of annual GDP.
// A continuing deficit/surplus can change the debt ratio with no narrated event.
// This is NOT a macroeconomic production, inflation, interest, or debt-pricing model.
export const FISCAL_CLOCK_MAX_DAYS = 240;
export const FISCAL_CLOCK_MAX_ANNUAL_BALANCE = 50;
const DAYS_PER_YEAR = 365.2425;
const point4 = (number) => Math.round(number * 10000) / 10000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// A recorded national assessment (or its historical legacy fallback) is the
// fiscal source date for both deterministic accrual and one-off debt effects.
// The date is evidence of the GDP/debt baseline, not permission to infer a rate.
export const fiscalSourceDateOf = (sheet) =>
  sheet?.continuity?.assessedDate
  || sheet?.continuity?.demographicEvolution?.sourceDate
  || sheet?.continuity?.demographicClock?.sourceDate
  || sheet?.continuity?.foundingAssessment?.date
  || "";

// Advance only existing, dated canonical readings; no generic rate assumptions,
// keyword inference, added AI requests, or creation of missing Stats baselines.
// `baselineWorld` is the world as the turn BEGAN: an event that changes the
// budget balance on the turn's last day must not rewrite earlier fiscal history.
export const advanceNativeFiscalClock = (
  world,
  { baselineWorld, fromDate = "", toDate = "" } = {},
) => {
  if (!world || typeof world !== "object" || Array.isArray(world)) return world;
  const days = diffGameDays(fromDate, toDate);
  if (!(days > 0)) return world;
  const prior = baselineWorld?.countryStats;
  const current = world.countryStats;
  if (!prior || typeof prior !== "object" || Array.isArray(prior)
    || !current || typeof current !== "object" || Array.isArray(current)) return world;
  const active = new Set(collectActiveScenarioPolityKeys(world));
  if (!active.size) return world;
  let changed = null;
  for (const [polity, sourceValue] of Object.entries(prior)) {
    if (!active.has(polity) || !own(current, polity)) continue;
    const source = normalizeCountryStatSheet(sourceValue);
    const live = normalizeCountryStatSheet(current[polity]);
    // Legacy reviewed scenario sheets frequently date their demographic
    // assessment but not the simultaneous starting fiscal reading. Reuse only
    // that explicit canonical source date, never the current turn date.
    const sourceDate = fiscalSourceDateOf(source);
    const rate = source?.economy?.budgetBalance;
    const debt = live?.economy?.publicDebt;
    if (!isCanonicalGameDate(sourceDate) || typeof rate !== "number" || !Number.isFinite(rate)
      || rate === 0 || Math.abs(rate) > FISCAL_CLOCK_MAX_ANNUAL_BALANCE
      || typeof debt !== "number" || !Number.isFinite(debt) || debt < 0 || debt > 1000) continue;
    // An assessment newer than the interval provides no past authority.
    if (compareGameDates(sourceDate, toDate) > 0) continue;
    const horizon = addGameDays(sourceDate, FISCAL_CLOCK_MAX_DAYS);
    if (compareGameDates(fromDate, horizon) >= 0) continue;
    const oldClock = normalizeCountryStatFiscalClock(live.continuity?.fiscalClock);
    // A rate changed without a newly dated assessment is not an authorized
    // re-estimation of the *past*; hold until a new source is established.
    if (oldClock && oldClock.sourceDate === sourceDate && oldClock.balance !== rate) continue;
    const clock = oldClock && oldClock.sourceDate === sourceDate
      ? oldClock : { sourceDate, anchorDate: compareGameDates(fromDate, sourceDate) >= 0 ? fromDate : sourceDate,
        lastDate: compareGameDates(fromDate, sourceDate) >= 0 ? fromDate : sourceDate, balance: rate, credited: 0 };
    const end = compareGameDates(toDate, horizon) < 0 ? toDate : horizon;
    if (compareGameDates(end, clock.lastDate) <= 0) continue;
    const elapsed = diffGameDays(clock.anchorDate, end);
    if (!(elapsed > 0)) continue;
    // Cumulative target plus credited rounding residue makes a sequence of
    // short turns approach the same total as one longer skip, while retaining
    // genuine explicit debt edits made between turns.
    const target = -(clock.balance * elapsed) / DAYS_PER_YEAR;
    const nextDebt = point4(Math.max(0, debt + target - clock.credited));
    if (!Number.isFinite(nextDebt) || nextDebt > 1000) continue;
    const credited = clock.credited + (nextDebt - debt);
    const nextClock = { ...clock, lastDate: end, credited };
    const nextSheet = mergeCountryStatPatch(live, {
      economy: { publicDebt: nextDebt },
      continuity: { fiscalClock: nextClock },
    });
    if (!changed) changed = { ...current };
    changed[polity] = nextSheet;
  }
  return changed ? { ...world, countryStats: changed } : world;
};
