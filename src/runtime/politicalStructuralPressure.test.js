import test from "node:test";
import assert from "node:assert/strict";

import { normalizePoliticalActors } from "./politicalActors.js";
import { derivePoliticalStructuralSignals, heldRegionCounts } from "./politicalStructuralPressure.js";
import { setPuppetStatesEnabled } from "./puppets.js";

const baseWorld = () => ({
  politicalActors: normalizePoliticalActors({
    byPolity: {
      A: { polityKey: "A", government: { form: "Republic" }, parties: [] },
      B: { polityKey: "B", government: { form: "Republic" }, parties: [] },
    },
  }),
  countryStats: {},
  relations: [],
  wars: [],
});

const issuesFor = (signals, polity) => new Set((signals[polity] || []).map((entry) => entry.issue));

test("structural Stats stress creates political pressure signals without inventing events", () => {
  const world = baseWorld();
  world.countryStats.A = {
    stability: 30,
    economy: { gdpGrowth: -4, inflation: 12, unemployment: 11 },
  };
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  const issues = issuesFor(result, "A");
  assert.ok(issues.has("economic_stress"));
  assert.ok(issues.has("cost_of_living"));
  assert.ok(issues.has("unemployment"));
  assert.ok(issues.has("institutional_trust"));
  assert.equal(result.B, undefined);
  assert.ok(result.A.every((entry) => entry.source?.kind === "structural"));
});

test("active wars create security pressure and sustained wars add war weariness", () => {
  const world = baseWorld();
  world.wars = [{
    id: "war-ab",
    status: "active",
    sideA: ["A"],
    sideB: ["B"],
    startedDate: "2013-01-01",
  }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  for (const polity of ["A", "B"]) {
    const issues = issuesFor(result, polity);
    assert.ok(issues.has("security"));
    assert.ok(issues.has("war_weariness"));
  }
});

test("hostile bilateral relations raise bounded security pressure for both existing actors", () => {
  const world = baseWorld();
  world.relations = [{ a: "A", b: "B", score: -75, status: "hostile" }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  assert.ok(issuesFor(result, "A").has("security"));
  assert.ok(issuesFor(result, "B").has("security"));
  assert.ok(result.A.every((entry) => entry.salience <= 100 && entry.strain <= 100));
});

test("structural derivation never creates signals for a polity without a Political Actor", () => {
  const world = baseWorld();
  world.countryStats.Unknown = { economy: { inflation: 50, unemployment: 30, gdpGrowth: -20 } };
  world.relations = [{ a: "Unknown", b: "A", score: -100 }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  assert.equal(result.Unknown, undefined);
  assert.ok(result.A);
});

test("structural derivation is deterministic and scales persistent exposure without linear turn spam", () => {
  const world = baseWorld();
  world.countryStats.A = { economy: { inflation: 15 } };
  const one = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  const twelve = derivePoliticalStructuralSignals(world, { months: 12, updatedAt: "2015-03-22" });
  const twelveAgain = derivePoliticalStructuralSignals(world, { months: 12, updatedAt: "2015-03-22" });
  assert.deepEqual(twelve, twelveAgain);
  const oneCost = one.A.find((entry) => entry.issue === "cost_of_living").salience;
  const twelveCost = twelve.A.find((entry) => entry.issue === "cost_of_living").salience;
  assert.ok(twelveCost > oneCost);
  assert.ok(twelveCost < oneCost * 12);
});


test("economic structural pressure prefers recent deterioration over modern-era assumptions", () => {
  const world = baseWorld();
  world.countryStats.A = { stability: 60, economy: { inflation: 6, unemployment: 8, gdpGrowth: 1 } };
  let result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "1867-02-01" });
  assert.equal(result.A, undefined);

  world.countryStatsHistory = {
    A: [{ date: "1867-01-01", inflation: 2, unemployment: 5, stability: 70 }],
  };
  result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "1867-02-01" });
  const issues = issuesFor(result, "A");
  assert.ok(issues.has("cost_of_living"));
  assert.ok(issues.has("unemployment"));
});

test("a BC war ages by the calendar and brings war weariness", () => {
  const world = baseWorld();
  world.wars = [{
    id: "war-ab",
    status: "active",
    sideA: ["A"],
    sideB: ["B"],
    startedDate: "-0219-01-01",
  }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "-0218-04-22" });
  for (const polity of ["A", "B"]) assert.ok(issuesFor(result, polity).has("war_weariness"));
});

test("in a BC scenario the previous Stats sample is the latest one before the turn", () => {
  const world = baseWorld();
  world.countryStats.A = { stability: 60, economy: { inflation: 6, unemployment: 8, gdpGrowth: 1 } };
  world.countryStatsHistory = {
    A: [
      { date: "-0219-06-01", inflation: 9, unemployment: 12, stability: 50 },
      { date: "-0219-12-01", inflation: 2, unemployment: 5, stability: 70 },
      { date: "-0217-01-01", inflation: 6, unemployment: 8, stability: 60 },
    ],
  };
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "-0218-02-01" });
  const issues = issuesFor(result, "A");
  assert.ok(issues.has("cost_of_living"), "compared with December 219 BC, not June 219 BC or a sample from 217 BC");
  assert.ok(issues.has("unemployment"));
});

test("names that are not actor keys resolve through the profile lookup, once per name, to the same actor", () => {
  const world = baseWorld();
  world.polityOverrides = { A: { name: "Republic of A", aliases: ["Old A"] } };
  world.relations = [
    { a: "Old A", b: "B", score: -80 },
    { a: "Republic of A", b: "B", score: -60 },
    { a: "Old A", b: "Nowhere", score: -90 },
  ];
  world.wars = [{ status: "active", sideA: ["Old A"], sideB: ["B"], startedDate: "2014-01-01" }];
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  assert.deepEqual(Object.keys(result), ["A", "B"]);
  const relation = result.A.find((entry) => entry.source.id === "relations:A");
  assert.match(relation.source.note, /^3 materially strained/);
  assert.ok(result.A.some((entry) => entry.source.id === "wars:A:active"));
});

const territoryWorld = () => ({
  ...baseWorld(),
  regionOwnershipOverrides: { a1: "A", a2: "A", a3: "A", a4: "A", a5: "A", a6: "A", b1: "B", b2: "B", b3: "B" },
});
const signalFor = (signals, polity, id) => (signals[polity] || []).find((entry) => entry.source.id === id);

test("held region counts come from the explicit ownership map, per Political Actor", () => {
  const world = territoryWorld();
  world.regionOwnershipOverrides.x1 = "Nowhere";
  assert.deepEqual(heldRegionCounts(world), { A: 6, B: 3 });
});

test("groups controlling a polity's regions raise regionalism and security, scaled by the share held", () => {
  const world = territoryWorld();
  world.groupAreas = { a1: "Cartel", a2: "Cartel", a3: "Rebels", b1: "Cartel" };
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  const regionalism = signalFor(result, "A", "groups:A:regionalism");
  assert.ok(regionalism);
  assert.equal(regionalism.issue, "regionalism");
  assert.match(regionalism.source.note, /^3 region\(s\) controlled by 2 group\(s\)/);
  assert.ok(signalFor(result, "A", "groups:A:security"));
  assert.ok(signalFor(result, "B", "groups:B:regionalism"));
  const one = territoryWorld();
  one.groupAreas = { a1: "Cartel" };
  const smaller = signalFor(derivePoliticalStructuralSignals(one, { months: 1, updatedAt: "2014-04-22" }), "A", "groups:A:regionalism");
  assert.ok(smaller.salience < regionalism.salience);
});

test("occupied ground presses sovereignty and national identity harder than a standing claim", () => {
  const world = territoryWorld();
  world.regionOwnershipOverrides.a1 = "B";
  world.regionSovereigntyOverrides = { a1: "A" };
  world.regionClaimants = { a1: ["A", "B"], b2: ["A"], b3: ["B"] };
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  const occupied = signalFor(result, "A", "territory:A:occupied");
  const claims = signalFor(result, "A", "territory:A:claims");
  assert.equal(occupied.issue, "sovereignty");
  assert.ok(signalFor(result, "A", "territory:A:occupied-identity"));
  assert.match(claims.source.note, /^Claims 1 region/);
  assert.ok(occupied.salience > claims.salience);
  assert.equal(signalFor(result, "B", "territory:B:claims"), undefined);
});

test("an open puppet feels sovereignty pressure; a covert one, a released one or a switched-off system does not", () => {
  const world = baseWorld();
  world.puppets = [{ id: "p1", overlord: "B", puppet: "A", kind: "satellite", secrecy: "open", status: "active", loyalty: 20 }];
  const open = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  assert.equal(signalFor(open, "A", "puppets:A").issue, "sovereignty");
  assert.equal(open.B, undefined);

  world.puppets[0].secrecy = "covert";
  assert.equal(derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" }).A, undefined);
  world.puppets[0].secrecy = "open";
  world.puppets[0].status = "released";
  assert.equal(derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" }).A, undefined);

  world.puppets[0].status = "active";
  setPuppetStatesEnabled(false);
  try {
    assert.equal(derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" }).A, undefined);
  } finally {
    setPuppetStatesEnabled(true);
  }
});

test("a net loss of ground since the clock last advanced raises national identity pressure", () => {
  const world = territoryWorld();
  world.politicalSimulation = { heldRegions: { A: 10, B: 3 } };
  const result = derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" });
  const lost = signalFor(result, "A", "territory:A:lost");
  assert.equal(lost.issue, "national_identity");
  assert.match(lost.source.note, /^Lost 4 region/);
  assert.equal(signalFor(result, "B", "territory:B:lost"), undefined);

  delete world.politicalSimulation;
  assert.equal(derivePoliticalStructuralSignals(world, { months: 1, updatedAt: "2014-04-22" }).A, undefined);
});
