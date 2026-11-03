/*! Open Historia - guarded native Statistics turn accrual.
 * Peaceful verified-zero turns and fully reconciled dated wartime naval
 * observations use one native GDP/fiscal owner. Unknown, ambiguous, or
 * unsupported evidence retains the original legacy turn writer.
 * No new national baselines or history from untrusted prose are invented.
 */
import { planNativeStatsTurnChronology } from "./statsTurnChronology.js";
import { addGameDays, compareGameDates, diffGameDays, isCanonicalGameDate } from "./gameDates.js";
import { createStatsChronologyReducerBoundary } from "./statsChronologyReducer.js";
import { advanceNativeDemographicClock } from "./statsDemographicClock.js";
import { advanceNativeMigrationFlows, validateNativeMigrationPlans } from "./statsMigrationClock.js";
import { advanceNativeMacroEconomyClock } from "./statsNativeEconomyClock.js";
import { advanceNativeProductionClock } from "./statsProductionClock.js";
import { advanceNativeFiscalClock } from "./statsFiscalClock.js";
import { captureCountryStatsHistory, mergeCountryStatPatch, normalizeCountryStatSheet, normalizeCountryStatFiscalClock, normalizeCountryStatNativeEconomyClock, normalizeCountryStatGdpTrendClock } from "./countryStats.js";
import { collectActiveScenarioPolityKeys } from "./scenarioPolities.js";
import { validateCompletePositiveNavalEvidence, deriveDatedBlockadeCharges } from "./statsNavalEconomicPort.js";
import { BLOCKADE_BUDGET_A_YEAR } from "./naval/blockade.js";
import { sameNavalControlChronology } from "./naval/controlChronology.js";
import { deriveAllNativeEconomicExposure, captureNativeEconomicExposureHistory } from "./statsEconomicExposure.js";

const arr = (value) => Array.isArray(value) ? value : [];
// A city raid flown by the front engine has a separate legacy GDP/population
// writer in withAirStrikes. Until its dated losses enter the single native
// chronological receipt ledger, those affected accounts cannot have both.
// Return identities rather than assuming a damaged city is necessarily a
// belligerent: neutral countries may be struck as well.
export const unresolvedCityAirStrikeTargets = (turnFronts) => arr(turnFronts?.airStrikes)
  .filter((strike) => strike?.kind === "city" && Number(strike?.power) > 0)
  .map((strike) => typeof strike?.country === "string" ? strike.country.trim() : "");
// `runNaval` only publishes a blockadePeriods row after observing positive
// pressure, even when the whole-turn pressure is below the legacy threshold.
// Therefore a proven-zero naval result has THREE empty evidence arrays, not
// merely an empty daily array and no thresholded legacy blockades.
const hasActiveWar = (entry) => String(entry?.status || "").toLowerCase() !== "ended";

// An absent naval result is evidence of ZERO blockade ONLY in an otherwise
// peaceful turn with no authored/established blockade or war transition.
// In all other cases absence is UNKNOWN. A successful sea run with positive
// observations is also intentionally outside this first limited cutover.
export const provenZeroBlockadeDays = ({ baseWorld, turnFronts, warUpdates = [], fromDate = "", toDate = "" } = {}) => {
  if (!baseWorld || typeof baseWorld !== "object" || Array.isArray(baseWorld)
    || !Array.isArray(warUpdates) || warUpdates.length
    || (baseWorld.blockades != null && !Array.isArray(baseWorld.blockades))
    || (baseWorld.wars != null && !Array.isArray(baseWorld.wars))
    || (baseWorld.battlefields != null && !Array.isArray(baseWorld.battlefields))
    || arr(baseWorld.blockades).length
    || arr(turnFronts?.starts).length || arr(turnFronts?.joins).length
    || arr(turnFronts?.flips).length) return null;
  // The peaceful shortcut cannot use wartime reports. Established wars pass
  // the stronger, complete naval chronology check below instead.
  if (arr(baseWorld.wars).some(hasActiveWar)
    || arr(baseWorld.battlefields).some((battle) => String(battle?.status || "").toLowerCase() !== "ended")) return null;
  const sea = turnFronts?.sea;
  if (sea) {
    if (!Array.isArray(sea.blockadeDays) || sea.blockadeDays.length
      || !Array.isArray(sea.blockadePeriods) || sea.blockadePeriods.length
      || !Array.isArray(sea.blockades) || sea.blockades.length
      || !fromDate || !toDate || sea.fromDate !== fromDate
      || sea.days !== diffGameDays(fromDate, toDate)) return null;
    return [];
  }
  return [];
};

// Wartime cutover requires mutually consistent daily/monthly/whole-turn sea
// evidence. Dated region-control changes are permitted only when their exact
// identities match the naval replay and the territorial ledger is fully mapped.
// War-roster and legal-sovereignty transitions remain outside this contract.
// Missing evidence is UNKNOWN, never a fabricated zero.
export const provenPositiveBlockadeDays = ({ baseWorld, turnFronts, warUpdates = [], fromDate = "", toDate = "", events = [], regionCatalog = null } = {}) => {
  if (!baseWorld || !Array.isArray(baseWorld.wars) || !baseWorld.wars.some(hasActiveWar)
    || !Array.isArray(warUpdates) || warUpdates.length
    || !Array.isArray(events)
    || events.some((event) => event?.impacts?.regionTransfers?.length
      || arr(event?.impacts?.polityChanges).some((change) => {
        // Stable non-naval ordinary updates do not invalidate a separately
        // observed coastline. Renames, new polities, naval capability and
        // canonical sovereign changes still do.
        if (change?.operation !== "update" || change.name || change.continent
          || change.capital || change.currency) return true;
        const military = change.military;
        return military && (typeof military !== "object" || Array.isArray(military)
          || Object.keys(military).some((key) => !["land", "spending"].includes(key)));
      }))
    || arr(turnFronts?.starts).length || arr(turnFronts?.joins).length
    || (baseWorld.blockades != null && !Array.isArray(baseWorld.blockades))
    || (baseWorld.battlefields != null && !Array.isArray(baseWorld.battlefields))) return null;
  const sea = turnFronts?.sea;
  const flips = arr(turnFronts?.flips);
  const authored = events.flatMap((event) => arr(event?.impacts?.regionControlOps)
    .filter((row) => row?.by !== "front")
    .map((row) => ({ day: diffGameDays(fromDate, event?.date), regionId: row?.regionId,
      from: row?.fromCode, to: row?.toCode })));
  const expectedControl = [...flips, ...authored];
  const actualControl = sea?.controlChronology;
  // Naval chronology is not sufficient by itself: a front flip must also be
  // carried by an accepted dated event, or the canonical region-control writer
  // will never publish it. Its event date must be the actual front-control day;
  // otherwise monthly occupation history and coastline history would disagree.
  const frontOps = events.flatMap((event) => arr(event?.impacts?.regionControlOps)
    .filter((op) => op?.by === "front")
    .map((op) => ({
      day: isCanonicalGameDate(event?.date) ? diffGameDays(fromDate, event.date) : NaN,
      regionId: op.regionId, from: op.fromCode, to: op.toCode, op: op.op,
    })));
  if (frontOps.length !== flips.length) return null;
  const keyOf = (row) => JSON.stringify([row.day, row.regionId, row.from, row.to]);
  const remaining = new Set();
  for (const flip of flips) {
    if (flip?.kind !== "control" || !Number.isInteger(flip.day)
      || flip.day < 1 || flip.day > diffGameDays(fromDate, toDate)
      || (flip.date && flip.date !== addGameDays(fromDate, flip.day))
      || !flip.regionId || !flip.from || !flip.to) return null;
    const key = keyOf(flip);
    if (remaining.has(key)) return null;
    remaining.add(key);
  }
  for (const op of frontOps) {
    const key = keyOf(op);
    if (op.op !== "control" || !remaining.delete(key)) return null;
  }
  if (remaining.size) return null;
  if (expectedControl.length) {
    // Native wartime occupancy growth requires a real map/territorial join,
    // not the implicit assumption that a coast takeover has no GDP cost.
    if (!Array.isArray(regionCatalog) || !regionCatalog.length) return null;
    const exposures = deriveAllNativeEconomicExposure(baseWorld, { regionCatalog });
    if (expectedControl.some((row) =>
      exposures[row.from]?.territorialCoverage !== "complete"
      || exposures[row.to]?.territorialCoverage !== "complete")) return null;
    // All land flips, including those introduced by the front engine, need
    // exact dated IDs. We refuse an unproved coastline instead of substituting
    // empty pressure for unknown control geometry.
    if (!Array.isArray(actualControl) || expectedControl.some((row) =>
      row?.kind && row.kind !== "control"
      || !Number.isInteger(row?.day) || !row?.regionId || !row?.from || !row?.to)
      || !sameNavalControlChronology(actualControl, expectedControl)) return null;
  } else if (actualControl?.length) return null;
  const completeZero = sea && sea.fromDate === fromDate && sea.days === diffGameDays(fromDate, toDate)
    && Array.isArray(sea.blockadeDays) && sea.blockadeDays.length === 0
    && Array.isArray(sea.blockadePeriods) && sea.blockadePeriods.length === 0
    && Array.isArray(sea.blockades) && sea.blockades.length === 0;
  const validated = completeZero ? [] : validateCompletePositiveNavalEvidence({ fromDate, toDate, sea });
  if (validated === null) return null;
  const sheets = baseWorld.countryStats;
  if (!sheets || typeof sheets !== "object" || Array.isArray(sheets)) return null;
  const active = new Map(collectActiveScenarioPolityKeys(baseWorld).map((key) => [key.toLocaleLowerCase(), key]));
  for (const country of new Set(validated.map((row) => row.country))) {
    const key = active.get(country.toLocaleLowerCase());
    // Authored name/identity ambiguity and nonterritorial or incomplete Stats
    // cannot be charged as if they were the same economic account.
    if (!key || key !== country || !Object.hasOwn(sheets, key)) return null;
    const sheet = normalizeCountryStatSheet(sheets[key]);
    if (!(sheet?.economy?.gdp > 0) || !(sheet.population?.total > 0)
      || !sheet.territorialComponents?.length || !Number.isFinite(sheet.economy.gdpGrowth)
      || sheet.economy.gdpGrowth < -30 || sheet.economy.gdpGrowth > 30
      || !Number.isFinite(sheet.economy.inflation) || sheet.economy.inflation < -20
      || sheet.economy.inflation > 100 || !Number.isFinite(sheet.economy.budgetBalance)
      || sheet.economy.budgetBalance < -50 || sheet.economy.budgetBalance > 50
      || sheet.economy.budgetBalance - BLOCKADE_BUDGET_A_YEAR * validated.filter((row) => row.country === country)
        .reduce((sum, row) => sum + row.pressure, 0) / 365 < -50) return null;
    const continuity = sheet.continuity;
    const sourceDate = continuity?.assessedDate || continuity?.demographicEvolution?.sourceDate
      || continuity?.demographicClock?.sourceDate || continuity?.foundingAssessment?.date;
    if (!isCanonicalGameDate(sourceDate) || compareGameDates(sourceDate, fromDate) > 0) return null;
    const oldNative = normalizeCountryStatNativeEconomyClock(continuity?.nativeEconomyClock);
    const oldTrend = normalizeCountryStatGdpTrendClock(continuity?.gdpTrendClock);
    if ((Object.hasOwn(continuity || {}, "nativeEconomyClock") && !oldNative)
      || (Object.hasOwn(continuity || {}, "gdpTrendClock") && !oldTrend && !oldNative)
      || (!oldNative && oldTrend && oldTrend.sourceDate === sourceDate && oldTrend.lastDate !== fromDate)
      || (oldNative && (oldNative.lastDate !== fromDate
        || Math.abs(sheet.economy.gdpGrowth - (oldNative.reportedGrowth ?? oldNative.sourceRealGrowth)) > .0002
        || Math.abs(sheet.economy.inflation - oldNative.inflation) > .0002))) return null;
  }
  return validated;
};

// Called ONLY inside the already-detached, accepted canonical turn chronology.
// Every positive civil day has one canonical GDP/budget writer, and the old
// whole-turn blockade writer is bypassed by the existing gameplay cutover.
// The native fiscal rate reanchors on an ACTUAL blockade day after accruing the
// previous day at the previous rate, never retroactively for that previous day.
export const applyNativeDatedBlockadeDay = (world, step) => {
  if (!step.blockadeDays?.length) return world;
  const charges = deriveDatedBlockadeCharges({
    fromDate: step.fromDate, toDate: step.toDate, blockadeDays: step.blockadeDays,
  });
  if (!charges || diffGameDays(step.fromDate, step.toDate) !== 1) throw new Error("Invalid dated blockade accrual window");
  const revised = { ...world.countryStats };
  for (const charge of charges) {
    const before = normalizeCountryStatSheet(revised[charge.country]);
    const economy = before?.economy;
    if (!before?.territorialComponents?.length || !(economy?.gdp > 0)
      || !Number.isFinite(economy.budgetBalance)) throw new Error("Dated blockade target lost its canonical economy");
    const gdp = economy.gdp;
    const nextGdp = Math.max(1, Math.round(gdp * charge.gdpFactor * 100) / 100);
    const budget = Math.max(-100, Math.round((economy.budgetBalance + charge.budgetBalanceDelta) * 1e8) / 1e8);
    const debt = Number.isFinite(economy.publicDebt)
      ? Math.round(economy.publicDebt * gdp / nextGdp * 10000) / 10000 : null;
    if (!(nextGdp > 0) || !Number.isFinite(budget) || (debt !== null && debt > 1000)) {
      throw new Error("Dated blockade exceeds canonical economic bounds");
    }
    const oldFiscal = normalizeCountryStatFiscalClock(before.continuity?.fiscalClock);
    const horizon = oldFiscal ? addGameDays(oldFiscal.sourceDate, 240) : null;
    const fiscalClock = oldFiscal && oldFiscal.lastDate === step.toDate
      && compareGameDates(step.toDate, horizon) <= 0 && budget !== 0 && Math.abs(budget) <= 50
      ? { ...oldFiscal, anchorDate: step.toDate, lastDate: step.toDate, balance: budget, credited: 0 }
      : null;
    const updated = mergeCountryStatPatch(before, {
      economy: { gdp: nextGdp, budgetBalance: budget, ...(debt !== null ? { publicDebt: debt } : {}) },
      ...(fiscalClock ? { continuity: { fiscalClock } } : {}),
    }, { maxAggregateRescale: 10 });
    // A blockade can bring the annual budget balance to exactly zero. In that
    // case the old nonzero fiscal clock is no longer authoritative: retaining
    // it would let a later return to the old rate accrue debt retroactively
    // across the zero-balance interval. Keep the new GDP and debt settlement,
    // but retire only that stale cursor when it could not be reanchored.
    if (oldFiscal && !fiscalClock && oldFiscal.balance !== budget
      && updated.continuity?.fiscalClock) {
      updated.continuity = { ...updated.continuity };
      delete updated.continuity.fiscalClock;
    }
    if (!(updated?.economy?.gdp > 0) || !(updated.economy.gdp < gdp)
      || updated.economy.budgetBalance !== budget) throw new Error("Dated blockade did not settle canonical GDP and budget");
    const clock = updated.continuity?.nativeEconomyClock;
    if (!clock || clock.lastDate !== step.toDate) throw new Error("Missing native economic cursor for dated blockade");
    clock.lastGdp = updated.economy.gdp;
    revised[charge.country] = updated;
  }
  return { ...world, countryStats: revised };
};

// The standard-sheet-only caller must establish scenario Stats mode. Pure
// adapter, used on the already detached canonical event world. This accepts
// only a complete chronological plan; otherwise the caller retains legacy
// behavior without a partial economic mutation.
export const planNativeStatsLiveTurn = ({ baseWorld, turnFronts, warUpdates,
  fromDate = "", toDate = "", events = [], round = 0, regionCatalog = null } = {}) => {
  // Civilian bomb damage is currently an independent legacy direct writer.
  // Fail closed rather than accrue native GDP/population before writing it
  // again without a dated receipt, history sample or partition guarantee.
  if (unresolvedCityAirStrikeTargets(turnFronts).length) return null;
  if (!baseWorld?.countryStats || !Object.keys(baseWorld.countryStats).length
    || !Array.isArray(events) || !Number.isInteger(round) || round < 1) return null;
  const zero = provenZeroBlockadeDays({ baseWorld, turnFronts, warUpdates, fromDate, toDate });
  const positive = zero === null ? provenPositiveBlockadeDays({
    baseWorld, turnFronts, warUpdates, fromDate, toDate, events, regionCatalog,
  }) : null;
  const blockadeDays = zero ?? positive;
  if (blockadeDays === null) return null;
  // A scenario migration is explicit canonical input. A malformed plan must
  // not activate a chronology that would skip its resident transfers.
  const migrationPlans = validateNativeMigrationPlans(baseWorld);
  const migrationNames = new Set(migrationPlans.flatMap((flow) => [flow.fromPolity, flow.toPolity]));
  // One-day intervals when exposed preserve fiscal causality across arbitrary
  // skip partitions and let the budget change only AFTER its actual naval day.
  // A verified wartime report with no positive pressure is not an instruction
  // to accrue every national GDP/fiscal ledger daily. Preserve the standard
  // month/event chronology for zero-pressure war exactly as for peace. Only
  // actual exposed countries need day-specific blockade settlement.
  const positiveDaily = positive !== null && positive.length > 0;
  const steps = planNativeStatsTurnChronology({ fromDate, toDate, events, blockadeDays,
    dailyTicks: positiveDaily,
    processDates: migrationPlans.flatMap((flow) => [flow.sourceDate, flow.endDate]) });
  if (!steps) return null;
  // A migrant pair must accrue on the same chronological boundary even when
  // only one of them is under blockade. Never settle half a transfer in a
  // scoped GDP pass while deferring the other account to month-end.
  const pressuredCountries = new Set([
    ...(positive || []).map((row) => row.country), ...migrationNames,
  ]);
  let quietCursor = fromDate;
  const flushDates = new Set(steps.filter((step) => step.type === "sample").map((step) => step.date));
  for (const step of steps) if (step.type === "events" && step.date !== fromDate) {
    flushDates.add(addGameDays(step.date, -1));
    flushDates.add(step.date);
  }
  const advanceClocks = (world, from, to, names = null) => {
    if (!(diffGameDays(from, to) > 0)) return world;
    const scoped = names === null ? world : { ...world, countryStats: Object.fromEntries(
      Object.entries(world.countryStats).filter(([name]) => names.has(name)),
    ), migrationFlows: (world.migrationFlows || []).filter((flow) =>
      names.has(flow.fromPolity) && names.has(flow.toPolity)) };
    if (!Object.keys(scoped.countryStats).length) return world;
    const baselineWorld = scoped;
    let next = advanceNativeDemographicClock(scoped, { baselineWorld, fromDate: from, toDate: to });
    next = advanceNativeMigrationFlows(next, { baselineWorld, fromDate: from, toDate: to });
    next = advanceNativeMacroEconomyClock(next, { baselineWorld, fromDate: from, toDate: to, regionCatalog });
    next = advanceNativeProductionClock(next, { fromDate: from, toDate: to });
    next = advanceNativeFiscalClock(next, { baselineWorld, fromDate: from, toDate: to });
    if (names === null) return next;
    const updatedFlows = new Map((next.migrationFlows || []).map((flow) => [flow.id, flow]));
    return { ...world, countryStats: { ...world.countryStats, ...next.countryStats },
      ...(updatedFlows.size ? { migrationFlows: world.migrationFlows.map((flow) => updatedFlows.get(flow.id) || flow) } : {}),
    };
  };
  return createStatsChronologyReducerBoundary({
    steps, events,
    accrue(world, step) {
      if (!positiveDaily) return advanceClocks(world, step.fromDate, step.toDate);
      // Blockaded countries need daily fiscal/economic precision. All other
      // countries retain ordinary month/event-bounded ticks, so a year of
      // warfare doesn't redraw 79 untouched national ledgers 365 times.
      let next = advanceClocks(world, step.fromDate, step.toDate, pressuredCountries);
      next = applyNativeDatedBlockadeDay(next, step);
      if (flushDates.has(step.toDate)) {
        const quietNames = new Set(Object.keys(next.countryStats).filter((key) => !pressuredCountries.has(key)));
        next = advanceClocks(next, quietCursor, step.toDate, quietNames);
        quietCursor = step.toDate;
      }
      return next;
    },
    sample: (world, step) => captureNativeEconomicExposureHistory(
      captureCountryStatsHistory(world, { date: step.date, round }),
      { date: step.date, round, regionCatalog },
    ),
  });
};
