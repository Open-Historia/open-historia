import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanonReferencePack,
  listCanonReferencePacks,
  resolveScenarioInstitutionReferenceCatalog,
  resolveScenarioReferenceAuthorityHorizon,
  resolveScenarioReferencePacks,
} from "./canonReferencePacks.js";
import { materializeScenarioCanon } from "./scenarioCanon.js";

const historicalEarth = (authority = "round-zero-only", divergence = null) => materializeScenarioCanon({}, {
  canonContext: {
    universe: { id: "historical-earth", type: authority === "pre-divergence-only" ? "alternate" : "historical" },
    referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
    referenceAuthority: authority,
    divergence,
  },
});

test("legacy scenarios never acquire a reference pack implicitly", () => {
  const world = { startingTimelineText: "Earth, 2014" };
  assert.deepEqual(resolveScenarioReferencePacks(world), []);
  assert.deepEqual(resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate: "2014-03-22" }), []);
});

test("historical scenario explicitly opts into a date-bounded Earth pack", () => {
  const world = historicalEarth();
  const packs = resolveScenarioReferencePacks(world);
  assert.equal(packs.length, 1);
  const catalog2014 = resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate: "2014-03-22" });
  assert.ok(catalog2014.some((entry) => entry.id === "nato"));
  assert.ok(catalog2014.some((entry) => entry.id === "european-union"));

  const catalog1912 = resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate: "1912-01-01" });
  assert.equal(catalog1912.some((entry) => entry.id === "nato"), false);
  assert.equal(catalog1912.some((entry) => entry.id === "european-union"), false);
});

test("alternate scenario cannot inherit post-divergence real history", () => {
  const world = historicalEarth("pre-divergence-only", { date: "1991-01-01", description: "Alternate branch" });
  const catalog = resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate: "2014-03-22" });
  assert.ok(catalog.some((entry) => entry.id === "nato"));
  assert.ok(catalog.some((entry) => entry.id === "warsaw-pact"), "Warsaw Pact existed at divergence and remains valid pre-divergence reference context");
  assert.equal(catalog.some((entry) => entry.id === "european-union"), false, "EU founding after divergence has no authority");
});



test("alternate reference-pack horizon ends on the day before divergence", () => {
  const world = historicalEarth("pre-divergence-only", {
    date: "1991-01-01",
    description: "1991-01-01: Reference canon diverges.",
  });
  assert.equal(resolveScenarioReferenceAuthorityHorizon(world, "2014-03-22"), "1990-12-31");
});
test("fictional current scenario with no packs gets no Earth knowledge", () => {
  const world = materializeScenarioCanon({}, {
    canonContext: {
      universe: { id: "wasteland", type: "fictional" },
      referencePacks: [],
      referenceAuthority: "none",
    },
  });
  assert.deepEqual(resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate: "2287-01-01" }), []);
});

test("reference pack registry exposes metadata without making it canonical", () => {
  const listed = listCanonReferencePacks();
  assert.ok(listed.some((entry) => entry.id === "earth-history"));
  const pack = getCanonReferencePack("earth-history");
  assert.equal(pack.version, "1.0");
});

test("selecting a reference pack from a pristine legacy context activates its data-defined defaults", async () => {
  const { createLegacyCanonContext } = await import("./scenarioCanon.js");
  const { updateCanonContextReferencePackSelection } = await import("./canonReferencePacks.js");
  const next = updateCanonContextReferencePackSelection(createLegacyCanonContext(), "earth-history", true);

  assert.equal(next.referenceAuthority, "round-zero-only");
  assert.equal(next.universe.id, "historical-earth");
  assert.equal(next.universe.type, "historical");
  assert.deepEqual(next.referencePacks.map((entry) => entry.id), ["earth-history"]);
});

test("explicit universe identity is never overwritten by selecting a reference pack", async () => {
  const { updateCanonContextReferencePackSelection } = await import("./canonReferencePacks.js");
  const next = updateCanonContextReferencePackSelection({
    universe: { id: "fallout", type: "fictional" },
    referencePacks: [],
    referenceAuthority: "none",
  }, "earth-history", true);

  assert.equal(next.referenceAuthority, "round-zero-only");
  assert.equal(next.universe.id, "fallout");
  assert.equal(next.universe.type, "fictional");
});

test("authority none disables selected packs without forgetting selection", async () => {
  const { activeReferencePackIds, enabledReferencePackIds, normalizeCanonContext } = await import("./scenarioCanon.js");
  const context = normalizeCanonContext({
    universe: { id: "historical-earth", type: "historical" },
    referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
    referenceAuthority: "none",
  });

  assert.deepEqual(enabledReferencePackIds(context), ["earth-history"]);
  assert.deepEqual(activeReferencePackIds(context), []);
});

test("2014 Earth membership snapshot resolves major institution coverage without becoming runtime logic", async () => {
  const { resolveScenarioInstitutionMembershipCoverage, resolveScenarioInstitutionMembershipHistory } = await import("./canonReferencePacks.js");
  const world = historicalEarth();
  const coverage = resolveScenarioInstitutionMembershipCoverage(world, { scenarioDate: "2014-03-22" });
  assert.ok(coverage.institutionIds.includes("nato"));
  assert.ok(coverage.institutionIds.includes("european-union"));
  assert.ok(coverage.institutionIds.includes("united-nations"));
  assert.ok(coverage.institutionIds.includes("african-union"));
  assert.ok(coverage.institutionIds.includes("brics"));

  const history = resolveScenarioInstitutionMembershipHistory(world, { scenarioDate: "2014-03-22" });
  assert.equal(history.nato["Republic of Latvia"][0].joinedAt, "2004-03-29");
  assert.equal(history["european-union"]["Republic of Latvia"][0].joinedAt, "2004-05-01");
  assert.equal(history["united-nations"]["State of Palestine"][0].status, "observer");
  assert.equal(history["african-union"]["Arab Republic of Egypt"][0].status, "suspended");
});

test("dated membership snapshots do not leak into unrelated eras", async () => {
  const { resolveScenarioInstitutionMembershipCoverage, resolveScenarioInstitutionMembershipHistory } = await import("./canonReferencePacks.js");
  const world = historicalEarth();
  assert.deepEqual(resolveScenarioInstitutionMembershipCoverage(world, { scenarioDate: "1912-01-01" }).institutionIds, []);
  assert.deepEqual(resolveScenarioInstitutionMembershipHistory(world, { scenarioDate: "1912-01-01" }), {});
});
