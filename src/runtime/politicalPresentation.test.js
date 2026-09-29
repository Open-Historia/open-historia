// Run: node --test src/runtime/politicalPresentation.test.js
//
// politicalPresentation.js decides what the political landscape chart in a
// country's overview draws (PoliticalOverview in stats.jsx): which mode, which
// parties get a slice of their own, what folds into "Other", and how a profile
// whose numbers add up past 100 is still drawn as one whole pie.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGovernmentPartyPresentation,
  buildPoliticalLandscape,
  buildPoliticalPartyLandscape,
  buildPoliticalPowerStructure,
  getPoliticalLandscapeMeta,
} from "./politicalPresentation.js";

const party = (name, percent, extra = {}) => ({ name, support: { percent }, ...extra });
const sliceNames = (landscape) => landscape.slices.map((slice) => slice.name);
const sum = (values) => values.reduce((total, value) => total + value, 0);

// ---------------------------------------------------------------------------
// Which chart

test("a profile with parties and no representation is electoral", () => {
  const meta = getPoliticalLandscapeMeta({ parties: [party("A", 50)] });
  assert.equal(meta.representation, "electoral");
  assert.equal(meta.mode, "party");
  assert.equal(meta.metricLabel, "support");
});

test("a profile with nothing mapped says so", () => {
  const meta = getPoliticalLandscapeMeta({});
  assert.equal(meta.representation, "none");
  assert.equal(meta.mode, "none");
  const landscape = buildPoliticalLandscape({});
  assert.deepEqual(landscape.slices, []);
  assert.deepEqual(landscape.entries, []);
  assert.equal(landscape.hasQuantitativeValues, false);
});

test("power blocs under representation none draw a power structure", () => {
  const meta = getPoliticalLandscapeMeta({
    politicalSystem: { representation: "none" },
    powerBlocs: [{ name: "The army" }],
  });
  assert.equal(meta.mode, "power");
  assert.equal(meta.subtitle, "Political actors and institutions shaping the regime");
});

test("court, party-state and unknown representations are power structures", () => {
  for (const representation of ["court_factions", "party_state", "military_factions", "something new"]) {
    const meta = getPoliticalLandscapeMeta({ politicalSystem: { representation } });
    assert.equal(meta.mode, "power", representation);
    assert.equal(meta.representation, representation);
    assert.equal(meta.metricLabel, "influence");
  }
});

// ---------------------------------------------------------------------------
// Electoral: slices and "Other"

test("a two-percent coalition partner keeps its own slice (PWV2-007)", () => {
  const landscape = buildPoliticalLandscape({
    parties: [party("A", 40), party("B", 30), party("C", 20), party("D", 3), party("E", 2)],
    government: { rulingParty: "A", coalition: ["E"] },
  });
  assert.equal(landscape.mode, "party");
  assert.deepEqual(sliceNames(landscape), ["A", "B", "C", "E", "Other"]);
  const partner = landscape.slices.find((slice) => slice.name === "E");
  assert.equal(partner.coalition, true);
  assert.equal(landscape.slices.find((slice) => slice.name === "A").ruling, true);
  // D is small and plays no part in government, so it folds into Other with the unlisted 5%.
  const other = landscape.slices.find((slice) => slice.isOther);
  assert.deepEqual(other.members.map((member) => member.name), ["D"]);
  assert.equal(other.support, 8);
  assert.equal(other.unlistedSupport, 5);
  assert.equal(landscape.entries, landscape.slices);
  assert.equal(landscape.hasQuantitativeValues, true);
});

test("a governing party is kept past the slice limit, a small outsider is not", () => {
  const parties = ["A", "B", "C", "D", "E", "F"].map((name, index) => party(name, 20 - index * 2));
  parties.push(party("Partner", 1, { coalition: true }), party("Outsider", 1));
  const landscape = buildPoliticalPartyLandscape({ parties }, { maxNamedSlices: 6 });
  assert.ok(sliceNames(landscape).includes("Partner"));
  assert.ok(!sliceNames(landscape).includes("Outsider"));
  const other = landscape.slices.find((slice) => slice.isOther);
  assert.deepEqual(other.members.map((member) => member.name), ["Outsider"]);
});

test("the three largest parties always get a slice, however small", () => {
  const landscape = buildPoliticalPartyLandscape({
    parties: [party("A", 3), party("B", 2), party("C", 1), party("D", 1)],
  });
  assert.deepEqual(sliceNames(landscape), ["A", "B", "C", "Other"]);
});

test("an explicit Others party merges into the one Other slice", () => {
  const landscape = buildPoliticalPartyLandscape({
    parties: [party("A", 50), party("Others", 10), party("B", 30)],
  });
  assert.deepEqual(sliceNames(landscape), ["A", "B", "Other"]);
  const other = landscape.slices.find((slice) => slice.isOther);
  assert.equal(other.support, 20);
  assert.equal(other.unlistedSupport, 10);
  assert.deepEqual(other.members.map((member) => member.name), ["Others"]);
});

test("support that adds up past 100 keeps its labels but draws as one whole pie", () => {
  const landscape = buildPoliticalPartyLandscape({
    parties: [party("A", 70), party("B", 60), party("C", 150)],
  });
  assert.deepEqual(landscape.slices.map((slice) => slice.support), [100, 70, 60]);
  assert.ok(!landscape.slices.some((slice) => slice.isOther));
  assert.ok(Math.abs(sum(landscape.slices.map((slice) => slice.chartPercent)) - 100) < 1e-9);
  assert.ok(Math.abs(landscape.slices[0].chartPercent - (100 / 230) * 100) < 1e-9);
  assert.equal(landscape.totalKnownSupport, 100);
});

test("parties with no support figures are listed but not charted", () => {
  const landscape = buildPoliticalLandscape({
    parties: [{ name: "Quiet" }, party("Silent", 0), { name: "" }, "not a party"],
  });
  assert.deepEqual(landscape.slices, []);
  assert.deepEqual(landscape.entries.map((entry) => entry.name), ["Quiet", "Silent"]);
  assert.equal(landscape.hasQuantitativeValues, false);
});

test("an estimated figure marks the landscape approximate", () => {
  const landscape = buildPoliticalPartyLandscape({
    parties: [party("A", 60), { name: "B", support: { percent: 30, basis: "generated estimate" } }],
  });
  assert.equal(landscape.isApproximate, true);
});

// ---------------------------------------------------------------------------
// Power structures

test("power blocs sort by influence, then by label, and the rest is Other", () => {
  const structure = buildPoliticalPowerStructure({
    powerBlocs: [
      { name: "Clergy", influence: { label: "weak" } },
      { name: "Army", influence: { percent: 45 } },
      { name: "Court", influence: { label: "Very strong" } },
      { name: "Nobles", influence: { percent: 30 } },
    ],
  });
  assert.deepEqual(structure.blocs.map((bloc) => bloc.name), ["Army", "Nobles", "Court", "Clergy"]);
  assert.deepEqual(structure.slices.map((slice) => slice.name), ["Army", "Nobles", "Other"]);
  assert.equal(structure.slices[2].influence, 25);
  assert.equal(structure.slices[2].displayValue, "25%");
  assert.deepEqual(structure.entries.map((entry) => entry.name), ["Army", "Nobles", "Court", "Clergy", "Other"]);
  assert.equal(structure.hasQuantitativeInfluence, true);
});

test("a party state with no power blocs charts its parties' influence", () => {
  const landscape = buildPoliticalLandscape({
    politicalSystem: { representation: "party_state" },
    parties: [
      { name: "The Party", influence: { percent: 80, basis: "approximate" } },
      { name: "Allied bloc", influence: { percent: 12.5 } },
    ],
  });
  assert.equal(landscape.mode, "power");
  assert.deepEqual(landscape.slices.map((slice) => slice.name), ["The Party", "Allied bloc", "Other"]);
  assert.equal(landscape.slices[1].displayValue, "12.5%");
  const other = landscape.slices[2];
  assert.equal(other.id, "__other_party_state__");
  assert.equal(other.influence, 7.5);
  assert.equal(other.influenceApproximate, true);
  assert.equal(landscape.totalKnownPercent, 92.5);
  assert.equal(landscape.isApproximate, true);
});

test("a party state that has power blocs charts the blocs instead", () => {
  const landscape = buildPoliticalLandscape({
    politicalSystem: { representation: "party_state" },
    parties: [{ name: "The Party", influence: { percent: 80 } }],
    powerBlocs: [{ name: "Security services", influence: { percent: 100 } }],
  });
  assert.deepEqual(landscape.slices.map((slice) => slice.name), ["Security services"]);
});

// ---------------------------------------------------------------------------
// Who governs

test("the government line names one party or a coalition, each once", () => {
  const single = buildGovernmentPartyPresentation({
    parties: [{ id: "p1", name: "Labour" }],
    government: { rulingParty: "Labour", rulingPartyIds: ["p1"] },
  });
  assert.deepEqual(single, { ids: ["p1"], names: ["Labour"], label: "Government" });

  const coalition = buildGovernmentPartyPresentation({
    parties: [{ id: "p1", name: "Labour" }, { id: "p2", name: "Greens", shortName: "GRN" }],
    government: { rulingPartyIds: ["p1"], coalition: ["GRN"] },
  });
  assert.deepEqual(coalition.names, ["Labour", "Greens"]);
  assert.equal(coalition.label, "Governing coalition");

  assert.deepEqual(buildGovernmentPartyPresentation({}), { ids: [], names: [], label: "" });
});
