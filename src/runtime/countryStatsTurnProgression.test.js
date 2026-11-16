import test from "node:test";
import assert from "node:assert/strict";
import { applyCountryStatPatchToWorld, applyEventImpactsToWorld, applyProjectOps } from "./gameState.js";
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
test("the canonical previous sovereign is blocked when a legal transfer omits fromCode", () => {
  const before = world();
  const after = apply(before, [event("bare-transfer", "2026-07-01", {
    regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }],
  })]);
  assert.equal(after.regionOwnershipOverrides["region-A"], "Borduria");
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, true,
    "existing lawful donor cannot keep growing its pre-cession territorial ledger");
  assert.equal(after.countryStats.Borduria.continuity.progressionBlocked, true);
});

test("the legal sovereign, not an occupying controller, is the donor whose ledger pauses", () => {
  const before = world();
  before.regionOwnershipOverrides["region-A"] = "Occupier";
  before.regionSovereigntyOverrides = { "region-A": "Aland" };
  before.polityOverrides.Occupier = { code: "Occupier", name: "Occupier" };
  before.countryStats.Occupier = sheet();
  const after = apply(before, [event("occupied-transfer", "2026-07-01", {
    regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }],
  })]);
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, true);
  assert.equal(after.countryStats.Borduria.continuity.progressionBlocked, true);
  assert.equal(after.countryStats.Occupier.continuity.progressionBlocked, undefined,
    "a title transfer need not invalidate the occupier's distinct ledger");
});

test("implicit succession from a dissolution pauses a known heir's stale numeric ledger", () => {
  const before = world();
  before.countryStats.Newland = sheet();
  before.polityOverrides.Newland = { code: "Newland", name: "Newland" };
  const after = apply(before, [event("succession", "2026-07-01", {
    polityChanges: [{ operation: "create", code: "Newland" }, { operation: "dissolve", code: "Aland" }],
  })]);
  assert.equal(after.polityOverrides.Aland.status, "dissolved");
  assert.equal(after.regionOwnershipOverrides["region-A"], "Newland");
  assert.equal(after.countryStats.Newland.continuity.progressionBlocked, true,
    "heir must not grow a pre-inheritance national ledger using the enlarged borders");
});

test("occupation without a legal sovereignty change does not freeze either country's Stats", () => {
  const after = apply(world(), [event("occupation", "2026-07-01", {
    regionControlOps: [{ op: "control", regionId: "region-A", fromCode: "Aland", toCode: "Borduria" }],
  })]);
  assert.equal(after.regionOwnershipOverrides["region-A"], "Borduria");
  assert.equal(after.regionSovereigntyOverrides["region-A"], "Aland");
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, undefined);
  assert.equal(after.countryStats.Borduria.continuity.progressionBlocked, undefined);
});
test("a map-backed reassessment lifts the title-change hold without retroactive catch-up", () => {
  const affected = apply(world(), [event("cession", "2026-07-01", {
    regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }],
  })]);
  assert.equal(affected.countryStats.Borduria.continuity.progressionBlocked, true);
  const paused = affected.countryStats.Borduria.economy.gdp;
  const passiveEdit = structuredClone(affected);
  applyCountryStatPatchToWorld(passiveEdit, "Borduria", { economy: { gdpGrowth: 1.5 } });
  assert.equal(passiveEdit.countryStats.Borduria.continuity.progressionBlocked, true);
  const rebuilt = structuredClone(passiveEdit);
  applyCountryStatPatchToWorld(rebuilt, "Borduria", {
    territorialComponents: [{ geography: "Province A", group: "core", population: 1_500_000, gdpPerCapita: 10000 }],
  }, { replaceComponents: true, continuity: { assessedDate: "2027-06-01" } });
  assert.equal(rebuilt.countryStats.Borduria.continuity.progressionBlocked, false);
  assert.equal(rebuilt.countryStats.Borduria.continuity.lastProgressedDate, "2027-06-01");
  const later = apply(rebuilt, [], "2027-01-01", "2027-07-01");
  assert.ok(later.countryStats.Borduria.economy.gdp > rebuilt.countryStats.Borduria.economy.gdp);
  assert.equal(later.countryStats.Borduria.continuity.lastProgressedDate, "2027-07-01");
  assert.notEqual(later.countryStats.Borduria.economy.gdp, paused);
});

test("a stock-map legal donor is held when no World override or transfer.fromCode exists", () => {
  const before = world();
  delete before.regionOwnershipOverrides["region-A"];
  const after = applyEventImpactsToWorld({
    world: before,
    events: [event("stock-cession", "2026-07-01", {
      regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }],
    })],
    regionCatalog: [{ id: "region-A", country: "Geographic Aland", bakedOwner: "Aland" }],
    motion: { originDate: "2026-01-01", statsToDate: "2027-01-01", round: 2 },
  }).world;
  assert.equal(after.regionOwnershipOverrides["region-A"], "Borduria");
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, true);
  assert.equal(after.countryStats.Borduria.continuity.progressionBlocked, true);
});

test("historical map political owner takes precedence over a different base geography", () => {
  const before = world();
  delete before.regionOwnershipOverrides["region-A"];
  before.countryStats.Geographia = sheet();
  before.polityOverrides.Geographia = { code: "Geographia", name: "Geographia" };
  const after = applyEventImpactsToWorld({
    world: before,
    events: [event("historical-cession", "2026-07-01", {
      regionTransfers: [{ regionId: "region-A", fromCode: "Geographia", toCode: "Borduria" }],
    })],
    regionCatalog: [{ id: "region-A", country: "Geographia", bakedOwner: "Aland" }],
    motion: { originDate: "2026-01-01", statsToDate: "2027-01-01", round: 2 },
  }).world;
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, true,
    "actual political owner is the donor, even when an event's fromCode or geographic country disagrees");
  assert.equal(after.countryStats.Geographia.continuity.progressionBlocked, undefined);
});

test("an explicitly unowned map polygon must not assign its base geography a fictitious donor", () => {
  const before = world();
  delete before.regionOwnershipOverrides["region-A"];
  const after = applyEventImpactsToWorld({
    world: before,
    events: [event("unowned-cession", "2026-07-01", {
      regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }],
    })],
    regionCatalog: [{ id: "region-A", country: "Aland", bakedOwner: "" }],
    motion: { originDate: "2026-01-01", statsToDate: "2027-01-01", round: 2 },
  }).world;
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, undefined);
  assert.equal(after.countryStats.Borduria.continuity.progressionBlocked, true);
});

test("the project onComplete transfer also identifies a stock-map donor", () => {
  const before = world();
  delete before.regionOwnershipOverrides["region-A"];
  before.projects = applyProjectOps([], [{
    op: "create",
    name: "Settlement",
    summary: "Transfer one region",
    status: "active",
    onComplete: { regionTransfers: [{ regionId: "region-A", toCode: "Borduria" }] },
  }]);
  const after = applyEventImpactsToWorld({
    world: before,
    events: [event("complete-settlement", "2026-07-01", {
      projectOps: [{ op: "complete", name: "Settlement" }],
    })],
    regionCatalog: [{ id: "region-A", country: "Geographic Aland", bakedOwner: "Aland" }],
    motion: { originDate: "2026-01-01", statsToDate: "2027-01-01", round: 2 },
  }).world;
  assert.equal(after.regionOwnershipOverrides["region-A"], "Borduria");
  assert.equal(after.countryStats.Aland.continuity.progressionBlocked, true);
  assert.equal(after.countryStats.Borduria.continuity.progressionBlocked, true);
});

test("a missing authoritative region refuses time-advancing legal transfer without mutating the source world", () => {
  const before = world();
  delete before.regionOwnershipOverrides["region-A"];
  const original = structuredClone(before);
  assert.throws(() => applyEventImpactsToWorld({
    world: before,
    events: [event("unsupported-transfer", "2026-07-01", {
      regionTransfers: [{ regionId: "region-A", fromCode: "Aland", toCode: "Borduria" }],
    })],
    regionCatalog: [{ id: "not-this-region", country: "Aland", bakedOwner: "Aland" }],
    motion: { originDate: "2026-01-01", statsToDate: "2027-01-01", round: 2 },
  }), /no matching region in the authoritative map catalog/);
  assert.deepEqual(before, original, "no partial World mutation reaches the canonical input");
});
