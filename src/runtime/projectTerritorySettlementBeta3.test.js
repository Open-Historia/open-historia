import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertProjectTerritoryApplied,
  assertProjectTerritoryResolved,
  settleProjectTerritoryWorld,
} from "./projectTerritorySettlement.js";

const project = {
  projectId: "project-1",
  project: "Border Settlement",
  owner: "France",
  date: "2041-05-08",
  regionTransfers: [{ regionId: "region-A", toCode: "France" }],
  regionClaims: [],
  polityChanges: [],
};
const original = { regionOwnershipOverrides: { "region-A": "Germany" }, regionSovereigntyOverrides: {}, countryStats: { France: { economy: { gdp: 100 } } } };
const unchangedResolver = async () => [];
const applyToFrance = ({ world, colors }) => ({
  world: {
    ...world, regionOwnershipOverrides: { "region-A": "France" },
    regionSovereigntyOverrides: {},
  },
  colors, renamedPolities: [],
});

test("missing region aborts project settlement before a world mutation can run", async () => {
  let called = 0;
  const before = structuredClone(original);
  await assert.rejects(() => settleProjectTerritoryWorld({
    entries: [project], world: original, colors: {},
    resolveTransfers: async () => [{ path: "projects[0]", label: "region-A", reason: "no rendered region matches" }],
    applyWorldImpacts: () => { called += 1; return applyToFrance({ world: original }); },
  }), /no rendered region matches/);
  assert.equal(called, 0);
  assert.deepEqual(original, before);
});

test("resolver dropping a transfer without an explicit refusal is also an error", async () => {
  await assert.rejects(() => settleProjectTerritoryWorld({
    entries: [project], world: original, colors: {},
    resolveTransfers: async (containers) => {
      containers[0].impacts.regionTransfers = [];
      return [];
    },
    applyWorldImpacts: applyToFrance,
  }), /discarded transfers/);
});

test("a region rejected by the world writer cannot be treated as a settled project", async () => {
  await assert.rejects(() => settleProjectTerritoryWorld({
    entries: [project], world: original, colors: {},
    resolveTransfers: unchangedResolver,
    applyWorldImpacts: ({ world, colors }) => ({ world, colors, renamedPolities: [] }),
  }), /did not transfer sovereignty/);
});

test("legal sovereign can change while a third party still occupies the region", async () => {
  const settled = await settleProjectTerritoryWorld({
    entries: [project], world: original, colors: { France: "#fff" }, round: 4,
    resolveTransfers: unchangedResolver,
    readCatalog: async () => [{ id: "region-A", bakedOwner: "Germany" }],
    applyWorldImpacts: ({ world, colors, events, boardOnlyEventIds, regionCatalog }) => {
      assert.equal(events[0].impacts.regionTransfers[0].regionId, "region-A");
      assert.deepEqual(boardOnlyEventIds, [events[0].id]);
      assert.equal(regionCatalog[0].id, "region-A");
      return {
        world: { ...world, regionSovereigntyOverrides: { "region-A": "France" } },
        colors, renamedPolities: [],
      };
    },
  });
  assert.equal(settled.world.regionOwnershipOverrides["region-A"], "Germany");
  assert.equal(settled.world.regionSovereigntyOverrides["region-A"], "France");
});

test("successfully settled ordinary transfer returns the canonical world writer's result", async () => {
  const result = await settleProjectTerritoryWorld({
    entries: [project], world: original, colors: {},
    resolveTransfers: unchangedResolver, applyWorldImpacts: applyToFrance,
  });
  assert.equal(result.world.regionOwnershipOverrides["region-A"], "France");
  assert.equal(original.regionOwnershipOverrides["region-A"], "Germany", "source not mutated");
});

test("a valid claim must be present in the resulting canonical claimants", async () => {
  const withClaim = { ...project, regionTransfers: [], regionClaims: [{ regionId: "region-A", claimantCode: "Italy" }] };
  await assert.rejects(() => settleProjectTerritoryWorld({
    entries: [withClaim], world: original, colors: {},
    resolveTransfers: unchangedResolver,
    applyWorldImpacts: ({ world, colors }) => ({ world, colors, renamedPolities: [] }),
  }), /did not register the claim/);
  const actual = await settleProjectTerritoryWorld({
    entries: [withClaim], world: original, colors: {},
    resolveTransfers: unchangedResolver,
    applyWorldImpacts: ({ world, colors }) => ({
      world: { ...world, regionClaimants: { "region-A": ["Italy"] } },
      colors, renamedPolities: [],
    }),
  });
  assert.deepEqual(actual.world.regionClaimants["region-A"], ["Italy"]);
});

test("a polity-only completion needs no fictitious transfer but still requires world commit", async () => {
  const polity = { ...project, regionTransfers: [], regionClaims: [], polityChanges: [{ code: "France", name: "New France" }] };
  const updated = await settleProjectTerritoryWorld({
    entries: [polity], world: original, colors: {},
    resolveTransfers: unchangedResolver,
    applyWorldImpacts: ({ world, colors }) => ({ world, colors, renamedPolities: [{ from: "France", to: "New France" }] }),
  });
  assert.equal(updated.renamedPolities[0].to, "New France");
});

test("empty settlement changes nothing and does not require a map dependency", async () => {
  const value = await settleProjectTerritoryWorld({ entries: [], world: original, colors: {} });
  assert.equal(value.world, original);
});

test("live time-skip engine consumes the strict settlement seam, not a swallow-and-continue catch", () => {
  const source = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  const from = source.indexOf("const runProjectsEngine = async");
  const to = source.indexOf("const applySimulationResult = async", from);
  assert.ok(from >= 0 && to > from);
  const path = source.slice(from, to);
  assert.match(path, /await settleProjectTerritoryWorld\(/);
  assert.doesNotMatch(path, /a completed project's territory could not be applied; the rest of the turn stands/);
});

test("fail-closed guards reject missing settlement verification data", () => {
  assert.throws(() => assertProjectTerritoryResolved([project], [], []), /omitted a completion/);
  assert.throws(() => assertProjectTerritoryResolved([project], [{}], null), /no verification result/);
  assert.throws(() => assertProjectTerritoryApplied([], null), /no canonical world/);
});

test("a real project completion settles its stat and legal title through the canonical event writer", async () => {
  const { normalizeWorldState, applyProjectOutcomesToWorld, applyEventImpactsToWorld } = await import("./gameState.js");
  const base = normalizeWorldState({
    countryStats: {
      France: { stability: 50, economy: { gdp: 1_000_000, budgetBalance: 0, publicDebt: 0 } },
      Germany: { stability: 50, economy: { gdp: 1_000_000, budgetBalance: 0, publicDebt: 0 } },
    },
    projects: [{
      id: "project-1", name: "Border Settlement", ownerCode: "France", status: "active",
      plan: { durationDays: 30, monthlyCost: 0, effects: [
        { type: "stat", stat: "stability", change: 2 },
        { type: "territory", region: "A", country: "France" },
      ] },
    }],
    regionOwnershipOverrides: { "region: A": "Germany" },
  });
  const before = structuredClone(base);
  const released = applyProjectOutcomesToWorld({
    world: base,
    outcomes: [{ type: "complete", projectId: "project-1", project: "Border Settlement", owner: "France", date: "2041-05-08" }],
    host: "France", round: 4, date: "2041-05-08",
  });
  assert.equal(released.territory.length, 1);
  assert.equal(released.world.projects[0].effectsAppliedAt, "2041-05-08");
  assert.equal(released.world.countryStats.France.stability, 52);
  const result = await settleProjectTerritoryWorld({
    entries: released.territory, world: released.world, colors: { France: "#fff", Germany: "#000" },
    round: 4,
    resolveTransfers: unchangedResolver,
    readCatalog: async () => [{ id: "region: A", bakedOwner: "Germany" }],
    applyWorldImpacts: applyEventImpactsToWorld,
  });
  assert.equal(result.world.regionOwnershipOverrides["region: A"], "France");
  assert.equal(result.world.projects[0].effectsAppliedAt, "2041-05-08");
  assert.equal(result.world.countryStats.France.stability, 52);
  assert.deepEqual(base, before, "original state remains unchanged until complete turn commit");
});

test("missing real map region rejects project territory after in-memory effects, before state publication", async () => {
  const { normalizeWorldState, applyProjectOutcomesToWorld, applyEventImpactsToWorld } = await import("./gameState.js");
  const source = normalizeWorldState({
    projects: [{
      id: "project-1", name: "Border Settlement", ownerCode: "France", status: "active",
      plan: { durationDays: 30, monthlyCost: 0, effects: [{ type: "territory", region: "A", country: "France" }] },
    }],
    regionOwnershipOverrides: { "region: A": "Germany" },
  });
  const released = applyProjectOutcomesToWorld({
    world: source,
    outcomes: [{ type: "complete", projectId: "project-1", project: "Border Settlement", owner: "France", date: "2041-05-08" }],
    host: "France", round: 4, date: "2041-05-08",
  });
  assert.equal(released.world.projects[0].effectsAppliedAt, "2041-05-08");
  await assert.rejects(() => settleProjectTerritoryWorld({
    entries: released.territory, world: released.world, colors: {},
    resolveTransfers: async () => [{ path: "projects[0]", reason: "region missing from rendered map" }],
    applyWorldImpacts: applyEventImpactsToWorld,
  }), /region missing from rendered map/);
  assert.equal(source.projects[0].effectsAppliedAt, "", "no latch published to original world");
});
