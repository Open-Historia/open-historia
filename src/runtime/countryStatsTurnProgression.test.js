import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld } from "./gameState.js";
import { normalizeCountryStatSheet } from "./countryStats.js";

const sheet = () => normalizeCountryStatSheet({
  territorialComponents: [{ geography: "Province A", group: "core", population: 1000000, gdpPerCapita: 10000 }],
  population: { annualGrowthRate: -1 },
  economy: { gdpGrowth: 5 },
});

const world = () => ({
  countryStats: { Aland: sheet(), Borduria: sheet() },
  polityOverrides: { Aland: { code: "Aland", name: "Aland" }, Borduria: { code: "Borduria", name: "Borduria" } },
  regionOwnershipOverrides: { "region-A": "Aland", "region-B": "Borduria" },
});
const event = (id, date, impacts = {}) => ({
  id, date, title: id, description: "An event is applied.", impacts,
});
const apply = (worldState, events, start = "2026-01-01", end = "2027-01-01") => applyEventImpactsToWorld({
  world: worldState,
  events,
  motion: { originDate: start, statsToDate: end, round: 2 },
}).world;

test("accepted jump advances national statistics without a Stats button or any AI call", () => {
  const before = world();
  const after = apply(before, []);
  assert.ok(after.countryStats.Aland.economy.gdp > before.countryStats.Aland.economy.gdp);
  assert.ok(after.countryStats.Aland.population.total < before.countryStats.Aland.population.total);
  assert.equal(after.countryStats.Aland.continuity.lastProgressedDate, "2027-01-01");
  assert.equal(before.countryStats.Aland.continuity?.lastProgressedDate, undefined, "input World is unchanged");
});

test("rate changes take effect after their dated event, not retrospectively at the beginning", () => {
  const mid = event("policy", "2026-07-01", { polityChanges: [{
    code: "Aland", stats: { economy: { gdpGrowth: -5 } },
  }] });
  const changed = apply(world(), [mid]).countryStats.Aland;
  const withoutPolicy = apply(world(), []).countryStats.Aland;
  assert.ok(changed.economy.gdp < withoutPolicy.economy.gdp);
  assert.equal(changed.economy.gdpGrowth, -5);
});

test("a dated GDP reduction is applied once, between the preceding and following progress intervals", () => {
  const before = world();
  const shock = event("shock", "2026-07-01", { polityChanges: [{
    code: "Aland", stats: { economy: { gdp: 8_000_000_000 } },
  }] });
  const after = apply(before, [shock]);
  assert.ok(after.countryStats.Aland.economy.gdp < apply(world(), []).countryStats.Aland.economy.gdp);
  const next = apply(after, [], "2027-01-01", "2027-01-01");
  assert.deepEqual(next.countryStats, after.countryStats);
});

test("explicit legal territory change pauses affected old ledgers pending geographic reassessment", () => {
  const change = event("handover", "2026-07-01", { regionTransfers: [
    { regionId: "region-A", fromCode: "Aland", toCode: "Borduria" },
  ] });
  const after = apply(world(), [change]);
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, true);
  assert.equal(after.countryStats.Borduria.continuity.progressionBlocked, true);
  const later = apply(after, [], "2027-01-01", "2028-01-01");
  assert.deepEqual(later.countryStats.Aland, after.countryStats.Aland);
  assert.deepEqual(later.countryStats.Borduria, after.countryStats.Borduria);
});

test("no time-advance authorization leaves Stats untouched, including preview/event replay", () => {
  const before = world();
  const after = applyEventImpactsToWorld({ world: before, events: [event("note", "2026-07-01")], motion: { originDate: "2026-01-01" } }).world;
  assert.deepEqual(after.countryStats, before.countryStats);
});

test("out-of-order dated events must never silently misdate annual growth", () => {
  const events = [event("later", "2026-09-01"), event("earlier", "2026-03-01")];
  const before = world();
  const after = apply(before, events);
  assert.deepEqual(after.countryStats, before.countryStats);
});
