import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planNeutralStatsLiveTurn } from './statsNeutralTurnClock.js';
import { mergeCountryStatPatch } from './countryStats.js';

const sheet = (name) => mergeCountryStatPatch(null, {
  territorialComponents: [{ geography: `${name} Province`, group: 'core', population: 1000000, gdpPerCapita: 1000 }],
  economy: { gdpGrowth: 3, inflation: 2, unemployment: 7, budgetBalance: -2, publicDebt: 40 },
  continuity: { assessedDate: '1912-01-01', demographicEvolution: { version: 1, sourceDate: '1912-01-01',
    endDate: '1961-12-31', lastDate: '1912-01-01', basePopulation: 1000000, birthRate: 30,
    deathRate: 15, birthTrendPerYear: 0, deathTrendPerYear: 0, creditedBirths: 0,
    creditedDeaths: 0, birthFraction: 0, deathFraction: 0, influences: [] } },
});
const baseline = () => ({
  ownerCodes: ['Aland', 'Borduria', 'Neutral'],
  wars: [{ id: 'war-a-b', status: 'active', sideA: ['Aland'], sideB: ['Borduria'] }],
  blockades: [],
  countryStats: { Aland: sheet('Aland'), Borduria: sheet('Borduria'), Neutral: sheet('Neutral') },
});
const from = '1912-01-01';
const to = '1912-12-31';
const args = (extra = {}) => ({
  baseWorld: baseline(), events: [], fromDate: from, toDate: to, round: 2,
  warUpdates: [{ id: 'new-war', op: 'start', actors: ['Aland'], opponents: ['Borduria'] }],
  turnFronts: { flips: [{ regionId: 'province-a', from: 'Aland', to: 'Borduria' }],
    sea: { fromDate: from, days: 365, blockadeDays: null, blockadePeriods: null, blockades: [] } },
  ...extra,
});

test('war with changed fronts still advances and samples unrelated neutral native ledgers', () => {
  const world = baseline();
  const boundary = planNeutralStatsLiveTurn(args());
  assert.ok(boundary);
  assert.deepEqual(boundary.scopedCountries, ['Neutral']);
  const result = boundary.afterEvents(world, 0);
  const neutral = result.countryStats.Neutral;
  assert.ok(neutral.population.total > 1000000);
  assert.ok(neutral.economy.gdp > 1000000000);
  assert.equal(neutral.continuity.demographicEvolution.lastDate, to);
  assert.equal(neutral.continuity.nativeEconomyClock.lastDate, to);
  assert.deepEqual(result.countryStatsHistory.Neutral.map((x) => x.date), [
    '1912-01-31','1912-02-29','1912-03-31','1912-04-30','1912-05-31','1912-06-30',
    '1912-07-31','1912-08-31','1912-09-30','1912-10-31','1912-11-30','1912-12-31',
  ]);
  assert.deepEqual(result.countryStats.Aland, world.countryStats.Aland);
  assert.deepEqual(result.countryStats.Borduria, world.countryStats.Borduria);
  assert.equal(result.countryStatsHistory.Aland, undefined);
  assert.equal(world.countryStatsHistory, undefined);
});

test('a short neutral turn accrues its exact days, while an extended turn samples only elapsed civil months', () => {
  const short = planNeutralStatsLiveTurn(args({ toDate: '1912-01-04' })).afterEvents(baseline(), 0);
  assert.equal(short.countryStats.Neutral.continuity.demographicEvolution.lastDate, '1912-01-04');
  assert.deepEqual(short.countryStatsHistory.Neutral.map((x) => x.date), ['1912-01-04']);
  const quarter = planNeutralStatsLiveTurn(args({ toDate: '1912-04-01' })).afterEvents(baseline(), 0);
  assert.deepEqual(quarter.countryStatsHistory.Neutral.map((x) => x.date), ['1912-01-31','1912-02-29','1912-03-31','1912-04-01']);
});

test('one annual turn and monthly partitions give the same neutral population, GDP and history', () => {
  const annual = planNeutralStatsLiveTurn(args()).afterEvents(baseline(), 0);
  let monthly = baseline(), previous = from;
  for (const date of annual.countryStatsHistory.Neutral.map((row) => row.date)) {
    const plan = planNeutralStatsLiveTurn(args({ baseWorld: monthly, fromDate: previous, toDate: date }));
    assert.ok(plan, date);
    monthly = plan.afterEvents(monthly, 0);
    previous = date;
  }
  assert.equal(monthly.countryStats.Neutral.population.total, annual.countryStats.Neutral.population.total);
  assert.equal(monthly.countryStats.Neutral.economy.gdp, annual.countryStats.Neutral.economy.gdp);
  assert.deepEqual(monthly.countryStatsHistory.Neutral, annual.countryStatsHistory.Neutral);
});

test('war or occupation of previously neutral polity removes it from native scope', () => {
  const options = args({ warUpdates: [{ op: 'join-a', actors: ['Neutral'], opponents: [] }] });
  assert.equal(planNeutralStatsLiveTurn(options), null);
  const battlefield = args({ turnFronts: { flips: [{ from: 'Neutral', to: 'Aland' }] } });
  assert.equal(planNeutralStatsLiveTurn(battlefield), null);
});

test('invalid or unknown combatant names and incomplete war records never create a false safe subset', () => {
  for (const options of [
    args({ warUpdates: [{ op: 'start', actors: ['Unlisted'], opponents: ['Aland'] }] }),
    args({ baseWorld: { ...baseline(), blockades: [{ country: 'Unlisted' }] } }),
    args({ turnFronts: { flips: [{ from: 'Aland' }] } }),
    args({ events: [{ id: 'combat', date: '1912-04-03', warId: 'war-new' }] }),
  ]) assert.equal(planNeutralStatsLiveTurn(options), null);
});

test('a war participant cannot authenticate itself from its own war record', () => {
  const world = baseline();
  world.wars[0].sideB = ['Unlisted belligerent'];
  // The global scenario roster includes war-side names for political
  // discovery. That inclusion alone must not authorize an economic writer.
  const reasons = [];
  const result = planNeutralStatsLiveTurn(args({
    baseWorld: world,
    warUpdates: [],
    turnFronts: null,
    onReject: (reason) => reasons.push(reason),
  }));
  assert.equal(result, null);
  assert.deepEqual(reasons, ['unknown-established-belligerent']);
  // A stale Stats ledger row is not an independent political roster member.
  const withStaleSheet = { ...world,
    countryStats: { ...world.countryStats, 'Unlisted belligerent': sheet('Unlisted belligerent') } };
  assert.equal(planNeutralStatsLiveTurn(args({
    baseWorld: withStaleSheet, warUpdates: [], turnFronts: null,
  })), null);
});

test('native and legacy writers coexist without periodic AI regeneration of neutral Stats', () => {
  const source = readFileSync(new URL('../Game/AI/gameplay.js', import.meta.url), 'utf8');
  assert.match(source, /planNativeStatsLiveTurn\(statsTurnArgs\) \|\| planNeutralStatsLiveTurn\(statsTurnArgs\)/);
  assert.doesNotMatch(source, /nextWorld = await refreshTrackedCountryStatsIfDue\(/);
  assert.match(source, /return \{ history, stats: false \};/);
  assert.match(source, /nativeStatsChronology\.partial\) impactedWorld = withBlockadeEconomy/);
});

// War identity itself is a native identifier: do not turn an unrelated economy
// off simply because a war-related diplomatic event omitted redundant names.
test('known war ID without repeated combatants preserves unrelated monthly accrual', () => {
  const base = baseline();
  const events = [{ id: 'war-note', date: '1912-02-02', warId: 'war-a-b', combatants: [] }];
  const plan = planNeutralStatsLiveTurn(args({ baseWorld: base, events }));
  assert.ok(plan);
  assert.deepEqual(plan.scopedCountries, ['Neutral']);
  let world = plan.beforeEvent(base, 0, events[0]);
  world = plan.afterEvents(world, 1);
  assert.ok(world.countryStats.Neutral.economy.gdp > base.countryStats.Neutral.economy.gdp);
  assert.equal(world.countryStatsHistory.Neutral.length, 12);
});

test('unresolved war ID still fails closed and supplies a deterministic refusal reason', () => {
  const reasons = [];
  const plan = planNeutralStatsLiveTurn(args({
    events: [{ id: 'war-note', date: '1912-02-02', warId: 'unknown-war' }],
    onReject: (reason) => reasons.push(reason),
  }));
  assert.equal(plan, null);
  assert.deepEqual(reasons, ['unknown-event-war-belligerent']);
});
