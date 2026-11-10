/*! Open Historia — the impacts a scenario author attaches to a scripted event © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scriptedImpacts.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  SCRIPTED_IMPACT_TYPES,
  clearCountryClaimsEntry,
  compileImpactRows,
  normalizeScriptedImpacts,
  scriptedImpactProblems,
} from "./scriptedImpacts.js";
import { normalizeScriptedEvents } from "./gameFeatures.js";

const moldova = [{ id: "MDA.1_1", name: "Chişinău" }, { id: "MDA.22_1", name: "Ialoveni" }];

test("rows compile to the time skip's own impact shapes, one entry per region, by the region's map id", () => {
  const impacts = compileImpactRows([
    { type: "independence", name: "Republic of Moldova", regions: moldova, from: "Moldova", color: "#336699" },
    { type: "transfer", regions: [{ id: "UKR.1_1", name: "Cherkasy" }], to: "Moldova" },
    { type: "control", regions: [{ id: "ROU.1_1", name: "Alba" }], to: "Hungary", from: "Romania" },
    { type: "contest", regions: [{ id: "ROU.2_1", name: "Arad" }], actor: "Hungary" },
    { type: "clear_contest", regions: [{ id: "ROU.2_1", name: "Arad" }] },
    { type: "claim", regions: [{ id: "UKR.2_1", name: "Odessa" }], claimant: "Moldova" },
    { type: "drop_claim", regions: [{ id: "UKR.3_1", name: "Chernivtsi" }], claimant: "Romania" },
    { type: "rename", polity: "Moldova", name: "Moldavian Republic" },
    { type: "leader", polity: "Romania", leader: "Ion Popescu" },
  ]);
  assert.deepEqual(impacts.regionTransfers, [
    { regionId: "MDA.1_1", regionName: "Chişinău", fromCode: "Moldova", toCode: "Republic of Moldova" },
    { regionId: "MDA.22_1", regionName: "Ialoveni", fromCode: "Moldova", toCode: "Republic of Moldova" },
    { regionId: "UKR.1_1", regionName: "Cherkasy", toCode: "Moldova" },
  ]);
  assert.deepEqual(impacts.regionControlOps, [
    { op: "control", regionId: "ROU.1_1", regionName: "Alba", fromCode: "Romania", toCode: "Hungary" },
    { op: "contest", regionId: "ROU.2_1", regionName: "Arad", actorCode: "Hungary" },
    { op: "clear_contest", regionId: "ROU.2_1", regionName: "Arad", clearAll: true },
  ]);
  assert.deepEqual(impacts.regionClaims, [
    { regionId: "UKR.2_1", regionName: "Odessa", claimantCode: "Moldova" },
    { regionId: "UKR.3_1", regionName: "Chernivtsi", claimantCode: "Romania", drop: true },
  ]);
  assert.deepEqual(impacts.polityChanges, [
    { operation: "create", code: "Republic of Moldova", color: "#336699" },
    { operation: "rename", code: "Moldova", name: "Moldavian Republic" },
    { operation: "update", code: "Romania", stats: { leader: "Ion Popescu" } },
  ]);
});

test("an annexation and a dissolution hand over the whole country and then dissolve it", () => {
  assert.deepEqual(compileImpactRows([{ type: "annex", polity: "Moldova", to: "Romania" }]), {
    regionTransfers: [{ regionId: "country: Moldova", regionName: "Moldova", fromCode: "Moldova", wholeCountry: true, toCode: "Romania" }],
    regionControlOps: [],
    regionClaims: [],
    polityChanges: [{ operation: "dissolve", code: "Moldova" }],
  });
  assert.deepEqual(compileImpactRows([{ type: "dissolve", polity: "Moldova" }]).polityChanges, [{ operation: "dissolve", code: "Moldova" }]);
  assert.deepEqual(compileImpactRows([{ type: "dissolve", polity: "Moldova" }]).regionTransfers, []);
});

test("removing every claim on a country's territory is one regionClaims clear entry, with or without a claimant", () => {
  assert.deepEqual(clearCountryClaimsEntry({ country: "Moldova" }), {
    regionId: "country: Moldova",
    claimantCode: "Moldova",
    drop: true,
    allClaimants: true,
  });
  assert.deepEqual(clearCountryClaimsEntry({ country: "Moldova", claimant: "Romania" }), {
    regionId: "country: Moldova",
    claimantCode: "Romania",
    drop: true,
  });
  assert.deepEqual(normalizeScriptedImpacts({ regionClaims: [clearCountryClaimsEntry({ country: "Moldova" })] }), {
    regionClaims: [{ regionId: "country: Moldova", claimantCode: "Moldova", drop: true, allClaimants: true }],
  });
  assert.equal(clearCountryClaimsEntry({ country: " " }), null);
  assert.deepEqual(
    compileImpactRows([{ type: "clear_country_claims", polity: "Moldova", claimant: "Romania" }]).regionClaims,
    [clearCountryClaimsEntry({ country: "Moldova", claimant: "Romania" })],
  );
  assert.ok(SCRIPTED_IMPACT_TYPES.some((entry) => entry.type === "clear_country_claims" && entry.label === "Remove all claims on a country's territory"));
});

test("a row missing what it needs is flagged and compiles to nothing; a region chosen twice is flagged", () => {
  const rows = [
    { type: "transfer", regions: moldova, to: "Romania" },
    { type: "independence", name: "", regions: [moldova[1]] },
    { type: "claim", regions: [moldova[1]], claimant: "Ukraine" },
    { type: "leader", polity: "Romania" },
    { type: "control", regions: [], to: "" },
  ];
  const problems = scriptedImpactProblems(rows);
  assert.deepEqual(problems[0], { missing: [], repeated: [] });
  assert.deepEqual(problems[1], { missing: ["name"], repeated: ["Ialoveni"] });
  assert.deepEqual(problems[2], { missing: [], repeated: [] }, "a claim does not fight a transfer over a region");
  assert.deepEqual(problems[3].missing, ["leader"]);
  assert.deepEqual(problems[4].missing, ["regions", "to"]);
  const impacts = compileImpactRows(rows);
  assert.equal(impacts.regionTransfers.length, 2);
  assert.equal(impacts.polityChanges.length, 0);
});

test("the stores keep an event's rows and compiled impacts, and an outcome's, and nothing else of them", () => {
  const [event] = normalizeScriptedEvents([{
    date: "1991-08-27",
    text: "Moldova declares independence.",
    impactRows: [{ type: "independence", name: "Republic of Moldova", regions: moldova, stray: 1 }],
    outcomes: [{ id: "held", text: "It holds.", weight: 1, impactRows: [{ type: "claim", regions: [moldova[0]], claimant: "Romania" }] }],
  }]);
  assert.deepEqual(event.impactRows, [{ type: "independence", name: "Republic of Moldova", regions: moldova, from: "" }]);
  assert.equal(event.impacts.regionTransfers.length, 2);
  assert.deepEqual(event.impacts.polityChanges, [{ operation: "create", code: "Republic of Moldova" }]);
  assert.deepEqual(event.outcomes[0].impacts, { regionClaims: [{ regionId: "MDA.1_1", regionName: "Chişinău", claimantCode: "Romania" }] });
  const [plain] = normalizeScriptedEvents([{ date: "1991-08-27", text: "Nothing attached." }]);
  assert.equal("impacts" in plain, false);
  assert.equal("impactRows" in plain, false);
});

test("impacts written by hand keep only the four families and their own fields", () => {
  assert.deepEqual(normalizeScriptedImpacts({
    regionTransfers: [{ regionId: "MDA.1_1", toCode: "Romania", bogus: true }, { regionId: "MDA.2_1" }],
    unitOps: [{ op: "spawn" }],
  }), { regionTransfers: [{ regionId: "MDA.1_1", toCode: "Romania" }] });
});
