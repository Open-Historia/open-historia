import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { provenZeroBlockadeDays, planNativeStatsLiveTurn, applyNativeDatedBlockadeDay } from "./statsLiveTurnClock.js";
import { advanceNativeFiscalClock } from "./statsFiscalClock.js";
import { mergeCountryStatPatch } from "./countryStats.js";

const fixture = () => ({
  ownerCodes: ["Aland"],
  countryStats: { Aland: mergeCountryStatPatch(null, {
    territorialComponents: [{ geography: "Aland City", group: "core", population: 1000000, gdpPerCapita: 1000 }],
    economy: { gdpGrowth: 3, inflation: 2, unemployment: 7, budgetBalance: -2, publicDebt: 40 },
    continuity: { assessedDate: "1912-01-01" },
  }) },
});
const plan = (extra = {}) => planNativeStatsLiveTurn({
  baseWorld: fixture(), fromDate: "1912-01-01", toDate: "1912-12-31", round: 3,
  events: [], ...extra,
});

test("peace without war or blockades is provable zero, without assuming a sea run", () => {
  assert.deepEqual(provenZeroBlockadeDays({ baseWorld: fixture(), turnFronts: null }), []);
  assert.deepEqual(provenZeroBlockadeDays({ baseWorld: { ...fixture(), wars: [{ status: "ended" }] }, turnFronts: null }), []);
  assert.deepEqual(provenZeroBlockadeDays({ baseWorld: fixture(), fromDate: "1912-01-01", toDate: "1912-12-31", turnFronts: { sea: { blockadeDays: [], blockadePeriods: [], blockades: [], fromDate: "1912-01-01", days: 365 } } }), []);
});

test("unknown sea, any active blockade, war transitions or control flips refuses native cutover", () => {
  const w = fixture();
  for (const opts of [
    { baseWorld: { ...w, wars: [{ status: "active" }] } },
    // A complete zero-pressure SEA result does not make an active land war peaceful.
    { baseWorld: { ...w, wars: [{ status: "active" }] }, fromDate: "1912-01-01", toDate: "1912-12-31", turnFronts: { sea: { blockadeDays: [], blockadePeriods: [], blockades: [], fromDate: "1912-01-01", days: 365 } } },
    { baseWorld: { ...w, battlefields: [{ status: "active" }] }, fromDate: "1912-01-01", toDate: "1912-12-31", turnFronts: { sea: { blockadeDays: [], blockadePeriods: [], blockades: [], fromDate: "1912-01-01", days: 365 } } },
    { baseWorld: { ...w, blockades: [{ country: "Aland" }] } },
    { baseWorld: { ...w, blockades: {} } },
    { baseWorld: { ...w, wars: {} } },
    { baseWorld: { ...w, battlefields: [{ status: "active" }] } },
    { baseWorld: w, turnFronts: { sea: { blockadeDays: null } } },
    { baseWorld: w, turnFronts: { sea: { blockadeDays: [], blockadePeriods: null, blockades: [] } } },
    { baseWorld: w, turnFronts: { sea: { blockadeDays: [], blockadePeriods: [], blockades: [], fromDate: "1912-01-01", days: 30 } } },
    { baseWorld: w, turnFronts: { sea: { blockadeDays: [{ date: "1912-01-02" }] } } },
    { baseWorld: w, turnFronts: { sea: { blockadeDays: [], blockades: [{ country: "Aland", pressure: .5 }] } } },
    { baseWorld: w, turnFronts: { starts: [{ id: "new" }] } },
    { baseWorld: w, turnFronts: { joins: [{ name: "Aland" }] } },
    { baseWorld: w, turnFronts: { flips: [{ regionId: "r" }] } },
    { baseWorld: w, warUpdates: [{ id: "war" }] },
  ]) assert.equal(provenZeroBlockadeDays(opts), null);
});

test("positive subthreshold monthly evidence cannot be mistaken for zero when legacy blockades are empty", () => {
  const zero = { fromDate: "1912-01-01", days: 30, blockadeDays: [], blockadePeriods: [], blockades: [] };
  assert.deepEqual(provenZeroBlockadeDays({ baseWorld: fixture(), fromDate: "1912-01-01", toDate: "1912-01-31", turnFronts: { sea: zero } }), []);
  // `runNaval` retains positive month observations even if the whole-turn
  // result is too weak to cross the legacy `BLOCKADE_LEAST` threshold.
  const period = { country: "Aland", fromDate: "1912-01-02", toDate: "1912-01-31", days: 30,
    activeDays: 1, pressure: 0.0001, covered: 0.01, by: ["Borduria"] };
  for (const sea of [
    { ...zero, blockadePeriods: [period] },
    { ...zero, blockades: [{ country: "Aland", pressure: 0 }] },
    { ...zero, blockadeDays: [{ country: "Aland", date: "1912-01-03", pressure: 0.0001, covered: 0.01, by: ["Borduria"] }] },
  ]) {
    const input = { baseWorld: fixture(), fromDate: "1912-01-01", toDate: "1912-01-31", turnFronts: { sea } };
    assert.equal(provenZeroBlockadeDays(input), null);
    assert.equal(planNativeStatsLiveTurn({ ...input, round: 3, events: [] }), null,
      "unreconciled evidence must keep the legacy GDP/fiscal writer, not activate native chronology");
  }
});

test("annual zero-blockade turn genuinely advances native GDP and emits all months", () => {
  const initial = fixture();
  const boundary = plan({ baseWorld: initial });
  assert.ok(boundary);
  const result = boundary.afterEvents(initial, 0);
  assert.ok(result.countryStats.Aland.economy.gdp > initial.countryStats.Aland.economy.gdp);
  assert.equal(result.countryStats.Aland.continuity.nativeEconomyClock.lastDate, "1912-12-31");
  const months = result.countryStatsHistory.Aland.map((entry) => entry.date);
  assert.deepEqual(months, ["1912-01-31", "1912-02-29", "1912-03-31", "1912-04-30", "1912-05-31", "1912-06-30", "1912-07-31", "1912-08-31", "1912-09-30", "1912-10-31", "1912-11-30", "1912-12-31"]);
  assert.equal(result.countryStats.Aland.military, initial.countryStats.Aland.military);
  assert.equal(initial.countryStatsHistory, undefined);
  assert.throws(() => boundary.afterEvents(result, 0), /repeated/);
});

test("a dated shock cannot alter earlier monthly samples; same-day sequence stays intact", () => {
  const initial = fixture();
  const events = [{ id: "first", date: "1912-07-10" }, { id: "second", date: "1912-07-10" }];
  const baseline = plan().afterEvents(fixture(), 0);
  const boundary = plan({ baseWorld: initial, events });
  let next = boundary.beforeEvent(initial, 0, events[0]);
  assert.deepEqual(next.countryStatsHistory.Aland.slice(0, 6), baseline.countryStatsHistory.Aland.slice(0, 6));
  const originalGdp = next.countryStats.Aland.economy.gdp;
  next = { ...next, countryStats: { ...next.countryStats, Aland: mergeCountryStatPatch(next.countryStats.Aland,
    { economy: { gdp: originalGdp * .9 } }, { maxAggregateRescale: 10 }) } };
  next = boundary.beforeEvent(next, 1, events[1]);
  next = boundary.afterEvents(next, events.length);
  assert.ok(next.countryStats.Aland.economy.gdp < baseline.countryStats.Aland.economy.gdp);
  assert.deepEqual(next.countryStatsHistory.Aland.slice(0, 6), baseline.countryStatsHistory.Aland.slice(0, 6));
});

test("one annual cutover equals twelve month-partitioned cutovers with the same dated facts", () => {
  const annual = plan().afterEvents(fixture(), 0);
  const monthlyDates = annual.countryStatsHistory.Aland.map((sample) => sample.date);
  let start = "1912-01-01";
  let monthly = fixture();
  for (const end of monthlyDates) {
    const boundary = plan({ baseWorld: monthly, fromDate: start, toDate: end });
    assert.ok(boundary);
    monthly = boundary.afterEvents(monthly, 0);
    start = end;
  }
  assert.equal(monthly.countryStats.Aland.economy.gdp, annual.countryStats.Aland.economy.gdp);
  assert.equal(monthly.countryStats.Aland.economy.publicDebt, annual.countryStats.Aland.economy.publicDebt);
  assert.deepEqual(monthly.countryStatsHistory.Aland, annual.countryStatsHistory.Aland);
});

test("invalid event chronology and missing baselines retain the legacy path", () => {
  assert.equal(plan({ baseWorld: { countryStats: {} } }), null);
  assert.equal(plan({ events: [{ id: "missing", date: "1913-01-01" }] }), null);
  assert.equal(plan({ baseWorld: { ...fixture(), blockades: [{ country: "Aland" }] } }), null);
  assert.equal(plan({ fromDate: "1912-12-31", toDate: "1912-01-01" }), null);
});

test("gameplay cutover is opt-in and does not call the legacy blockade or AI Statistics writer twice", () => {
  const body = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  assert.match(body, /statsChronology: nativeStatsChronology/);
  assert.match(body, /if \(!nativeStatsChronology \|\| nativeStatsChronology\.partial\) impactedWorld = withBlockadeEconomy/);
  assert.doesNotMatch(body, /nextWorld = await refreshTrackedCountryStatsIfDue\(/,
    "no partial or refused native settlement may invoke periodic AI re-baselining");
  assert.match(body, /if \(!nativeStatsChronology \|\| nativeStatsChronology\.partial\) requestConflictSheets/);
});

import { addGameDays as addCivilDay, diffGameDays as countCivilDays } from "./gameDates.js";
const positiveSea = (fromDate, toDate, observations) => {
  const days = countCivilDays(fromDate, toDate);
  const byDay = new Map(observations.map((row) => [row.date, row]));
  const byMonth = new Map();
  for (let day = 1; day <= days; day++) {
    const date = addCivilDay(fromDate, day);
    const month = date.slice(0,date.lastIndexOf('-'));
    const dates = byMonth.get(month) || [];
    dates.push(date);
    byMonth.set(month, dates);
  }
  const period = (dates) => {
    const hits = dates.map((date) => byDay.get(date)).filter(Boolean);
    return { country: 'Aland', fromDate: dates[0], toDate: dates.at(-1), days: dates.length,
      activeDays: hits.length, pressure: hits.reduce((a, row) => a + row.pressure, 0) / dates.length,
      covered: hits.length ? hits.reduce((a, row) => a + row.covered, 0) / hits.length : 0,
      by: hits.length ? ['Borduria'] : [] };
  };
  const sum = observations.reduce((a, row) => a + row.pressure, 0);
  return { fromDate, days, blockadeDays: observations, blockadePeriods: [...byMonth.values()].map(period),
    blockades: sum / days >= .02 ? [{ country: 'Aland', pressure: Math.round(sum / days * 1000) / 1000,
      days: observations.length, by: ['Borduria'], covered: .5 }] : [] };
};
const pressureRows = Array.from({ length: 7 }, (_, i) => ({
  country: 'Aland', date: `1912-01-${String(i + 6).padStart(2, '0')}`,
  pressure: .8, covered: .5, by: ['Borduria'],
}));
const warWorld = () => ({ ...fixture(), wars: [{ id: 'war-1912', status: 'active' }] });

// This is an isolated source-level acceptance harness; it does not assert that
// the actual browser naval turn, save writer or multiplayer host was exercised.
test('positive naval days settle once through native chronology, with monthly history and no future retroactivity', () => {
  const initial = warWorld();
  const sea = positiveSea('1912-01-01', '1912-02-01', pressureRows);
  const boundary = planNativeStatsLiveTurn({ baseWorld: initial, fromDate: '1912-01-01',
    toDate: '1912-02-01', turnFronts: { sea }, round: 3, events: [] });
  assert.ok(boundary, 'verified positive naval evidence should activate the native writer');
  const after = boundary.afterEvents(initial, 0);
  assert.ok(after.countryStats.Aland.economy.gdp < planNativeStatsLiveTurn({ baseWorld: fixture(),
    fromDate: '1912-01-01', toDate: '1912-02-01', round: 3, events: [] }).afterEvents(fixture(),0).countryStats.Aland.economy.gdp);
  assert.ok(after.countryStats.Aland.economy.budgetBalance < -2);
  assert.ok(after.countryStats.Aland.economy.publicDebt >= 40);
  assert.deepEqual(after.countryStatsHistory.Aland.map((row) => row.date), ['1912-01-31','1912-02-01']);
  assert.throws(() => boundary.afterEvents(after, 0), /repeated/);
});

test('naval evidence mismatch and unknown naval observation never activate the positive writer', () => {
  const sea = positiveSea('1912-01-01', '1912-02-01', pressureRows);
  for (const altered of [
    { ...sea, blockadeDays: null },
    { ...sea, blockadePeriods: null },
    { ...sea, blockadePeriods: sea.blockadePeriods.slice(0,1) },
    { ...sea, blockadePeriods: [{ ...sea.blockadePeriods[0], pressure: 0 }, sea.blockadePeriods[1]] },
    { ...sea, blockades: [] },
    { ...sea, days: 30 },
  ]) assert.equal(planNativeStatsLiveTurn({ baseWorld: warWorld(), fromDate: '1912-01-01',
    toDate: '1912-02-01', turnFronts: { sea: altered }, round: 3, events: [] }), null);
});

test('positive blockade single-interval and split-by-day terms reconcile GDP, debt, budget and history', () => {
  const original = warWorld();
  const beginning = '1912-01-01', middle = '1912-01-09', finish = '1912-02-01';
  const run = (world, from, to, observations) => {
    const boundary = planNativeStatsLiveTurn({ baseWorld: world,
      turnFronts: { sea: positiveSea(from, to, observations) },
      fromDate: from, toDate: to, round: 3, events: [] });
    assert.ok(boundary, `missing chronological plan ${from} -> ${to}`);
    return boundary.afterEvents(world, 0);
  };
  const annual = run(original, beginning, finish, pressureRows);
  const first = run(original, beginning, middle, pressureRows.filter((row) => row.date <= middle));
  const second = run(first, middle, finish, pressureRows.filter((row) => row.date > middle));
  const a = annual.countryStats.Aland, b = second.countryStats.Aland;
  assert.ok(Math.abs(a.economy.gdp - b.economy.gdp) < 0.001, `${a.economy.gdp} vs ${b.economy.gdp}`);
  assert.equal(a.economy.publicDebt, b.economy.publicDebt);
  assert.equal(a.economy.budgetBalance, b.economy.budgetBalance);
  const aligned = second.countryStatsHistory.Aland.filter((row) => row.date !== middle);
  assert.deepEqual(annual.countryStatsHistory.Aland, aligned);
  assert.equal(a.continuity.nativeEconomyClock.lastDate,finish);
});

test('a dated event on an unaffected polity sees its accrued state before the event and matches normal chronology', () => {
  const build = (war) => {
    const base = fixture();
    const b = mergeCountryStatPatch(null, {
      territorialComponents: [{ geography: 'Borduria Town', group: 'core', population: 500000, gdpPerCapita: 2000 }],
      economy: { gdpGrowth: 3, inflation: 2, unemployment: 7, budgetBalance: -2, publicDebt: 40 },
      continuity: { assessedDate: '1912-01-01' },
    });
    return { ...base, ...(war ? { wars: [{ id: 'test-war', status: 'active' }] } : {}),
      ownerCodes: ['Aland', 'Borduria'], countryStats: { ...base.countryStats, Borduria: b } };
  };
  const events = [{ id: 'evt-1', date: '1912-01-18' }];
  const run = (world, sea) => {
    const boundary = planNativeStatsLiveTurn({ baseWorld: world,
      turnFronts: sea ? { sea } : null, fromDate: '1912-01-01', toDate: '1912-02-01', events, round: 3 });
    assert.ok(boundary);
    let next = boundary.beforeEvent(world, 0, events[0]);
    assert.ok(next.countryStats.Borduria.economy.gdp > world.countryStats.Borduria.economy.gdp);
    const shocked = next.countryStats.Borduria.economy.gdp * .9;
    next = { ...next, countryStats: { ...next.countryStats, Borduria: mergeCountryStatPatch(next.countryStats.Borduria,
      { economy: { gdp: shocked } }, { maxAggregateRescale: 10 }) } };
    return boundary.afterEvents(next, 1);
  };
  const naval = run(build(true), positiveSea('1912-01-01', '1912-02-01', pressureRows));
  const peaceful = run(build(false), null);
  assert.equal(naval.countryStats.Borduria.economy.gdp, peaceful.countryStats.Borduria.economy.gdp);
  assert.equal(naval.countryStats.Borduria.economy.publicDebt, peaceful.countryStats.Borduria.economy.publicDebt);
  assert.deepEqual(naval.countryStatsHistory.Borduria, peaceful.countryStatsHistory.Borduria);
});

// A complete wartime naval report with no pressure must have the SAME civil
// economic chronology as the peaceful zero path. Daily rounding otherwise
// changes both GDP/debt and can cost seconds per 79-country year.
test('complete zero naval pressure in an ongoing war preserves peaceful monthly GDP, debt, and history', () => {
  const peaceful = fixture();
  const wartime = { ...fixture(), wars: [{ id: 'ongoing-war', status: 'active' }] };
  const fromDate = '1912-01-01', toDate = '1912-12-31';
  const options = { fromDate, toDate, events: [], round: 4 };
  const ordinary = planNativeStatsLiveTurn({ ...options, baseWorld: peaceful });
  const noPressure = planNativeStatsLiveTurn({ ...options, baseWorld: wartime,
    turnFronts: { sea: { fromDate, days: 365, blockadeDays: [], blockadePeriods: [], blockades: [] } } });
  assert.ok(ordinary && noPressure, 'complete no-pressure war evidence should enable native chronology');
  const a = ordinary.afterEvents(peaceful, 0);
  const b = noPressure.afterEvents(wartime, 0);
  assert.deepEqual(b.countryStats.Aland, a.countryStats.Aland);
  assert.deepEqual(b.countryStatsHistory.Aland, a.countryStatsHistory.Aland);
});


test("dated blockade zero-budget transition retires fiscal cursor instead of retroactive debt", () => {
  // The one-day naval charge exactly extinguishes an otherwise valid fiscal
  // reading. An old cursor must not later resume for the zero-balance period.
  const rate = 3 / 365;
  const initial = fixture();
  const world = { ...initial, countryStats: { ...initial.countryStats,
    Aland: mergeCountryStatPatch(initial.countryStats.Aland,
      { economy: { budgetBalance: rate } }) } };
  const first = planNativeStatsLiveTurn({ baseWorld: world, fromDate: "1912-01-01",
    toDate: "1912-01-02", events: [], round: 2 });
  assert.ok(first);
  const onJan2 = first.afterEvents(world, 0);
  assert.ok(onJan2.countryStats.Aland.continuity.fiscalClock);
  const blockaded = applyNativeDatedBlockadeDay(onJan2, {
    fromDate: "1912-01-01", toDate: "1912-01-02",
    blockadeDays: [{ country: "Aland", date: "1912-01-02",
      pressure: 0.5, covered: 0.5, by: ["Borduria"] }],
  });
  const affected = blockaded.countryStats.Aland;
  assert.equal(affected.economy.budgetBalance, 0);
  assert.equal(affected.continuity.fiscalClock, undefined,
    "the old nonzero fiscal accrual cursor cannot remain authoritative at zero balance");

  const oneQuietDay = planNativeStatsLiveTurn({ baseWorld: blockaded,
    fromDate: "1912-01-02", toDate: "1912-01-03", events: [], round: 3 });
  assert.ok(oneQuietDay);
  const quiet = oneQuietDay.afterEvents(blockaded, 0);
  const restarted = { ...quiet, countryStats: { ...quiet.countryStats,
    Aland: mergeCountryStatPatch(quiet.countryStats.Aland,
      { economy: { budgetBalance: rate } }) } };
  const next = advanceNativeFiscalClock(restarted, {
    baselineWorld: restarted, fromDate: "1912-01-03", toDate: "1912-01-04",
  });
  assert.equal(next.countryStats.Aland.continuity.fiscalClock?.anchorDate, "1912-01-03",
    "resumed fiscal authority must anchor at the new interval, not accrue through the zero day");
});
