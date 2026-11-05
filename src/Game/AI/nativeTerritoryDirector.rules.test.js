/*! Open Historia — the territory director's rules: what it is asked, what it may keep © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTerritoryDirector.rules.test.js
//
// Runs without node_modules: nativeTerritoryDirector.js imports nothing.
//
// The director is a request (or a job in the turn review) after every skip with
// a territorial event. Its answer is filtered by wording: a control flip needs a
// capture, a contest a fight, a clear_contest a ceasefire or withdrawal. An event
// with none of those can only get ops the rules drop, so it must not be asked
// about at all.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTerritoryDirectorInput,
  directGeneratedTerritoryOps,
  hasTerritorialContent,
  sanitizeDirectorOrders,
} from "./nativeTerritoryDirector.js";

const event = (title, description = "", impacts = {}) => ({
  date: "1914-09-01",
  title,
  description,
  impacts: { regionTransfers: [], regionControlOps: [], unitOps: [], ...impacts },
});

const world = { regionOwnershipOverrides: {}, regionSovereigntyOverrides: {}, regionClaimants: {} };

const candidateIndexes = async (events) =>
  (await buildTerritoryDirectorInput({ events, world }))?.candidates.map((row) => row.eventIndex) ?? [];

test("a treaty cession with no fighting or capture wording is not asked about", async () => {
  const cession = event(
    "Treaty of Frankfurt cedes Alsace",
    "France cedes Alsace to the German Empire under the treaty, and German sovereignty over the province is recognised.",
    { regionTransfers: [{ regionId: "Alsace", fromCode: "France", toCode: "German Empire" }] },
  );
  assert.deepEqual(await candidateIndexes([cession]), []);
});

test("a treaty or sovereignty event without a fight is skipped, and the analyzer is never run", async () => {
  let asked = 0;
  const events = [
    event("Trade treaty signed in Lisbon", "Portugal and Brazil sign a commercial treaty lowering tariffs on coffee."),
    event("Parliament debates sovereignty", "Deputies argue over sovereignty in a long session; no vote is taken."),
  ];
  const out = await directGeneratedTerritoryOps({ events, world, analyzeBatch: async () => { asked += 1; return { eventOrders: [] }; } });
  assert.equal(asked, 0);
  assert.equal(out.length, 2);
});

test("a capture, a fight and a ceasefire are each asked about", async () => {
  const events = [
    event("German army captures Liège", "The fortress city falls to German troops after a siege."),
    event("Battle on the Marne", "French and British forces counterattack along the river."),
    event("Ceasefire on the Bosnian front", "Both sides agree to a ceasefire and begin to withdraw."),
    event("Coal output rises", "Mines in the Ruhr report a record quarter."),
  ];
  assert.deepEqual(await candidateIndexes(events), [0, 1, 2]);
});

test("a control change the event itself denies is not asked about", async () => {
  const stalemate = event(
    "Stalemate over the pass",
    "Neither side manages to take control of the pass; the lines hold where they were.",
  );
  // "control of" is territorial wording, but the only op it could suggest is a
  // negated control flip, and nothing here is a fight or a ceasefire.
  assert.deepEqual(await candidateIndexes([stalemate]), []);
});

test("a peace event can still clear a contest, so it is still asked about", async () => {
  const peace = event("Peace returns to the valley", "The two powers make peace and the claims along the valley lapse.");
  assert.deepEqual(await candidateIndexes([peace]), [0]);
});

// --- What the director's answer may do to the map ---------------------------
//
// The rules below decide whether land changes sovereignty or only occupation. A
// regex slip here turns every trench advance into a permanent border, or stops
// treaties moving borders at all.

const answering = (eventOrders) => async () => ({ payload: { eventOrders, summary: "" } });
const controlOps = (out, index) => out[index].impacts.regionControlOps;
const transfers = (out, index) => out[index].impacts.regionTransfers;

test("a wartime capture written as a legal transfer becomes occupation, with no analyzer at all", async () => {
  const capture = event("German army captures Liège", "German troops capture the city after a short siege.", {
    regionTransfers: [{ regionId: "Liège", regionName: "Liège", fromCode: "Belgium", toCode: "German Empire" }],
  });
  const [out] = await directGeneratedTerritoryOps({ events: [capture], world });
  assert.deepEqual(out.impacts.regionTransfers, []);
  assert.equal(out.impacts.regionControlOps.length, 1);
  assert.deepEqual(
    { op: out.impacts.regionControlOps[0].op, regionId: out.impacts.regionControlOps[0].regionId, fromCode: out.impacts.regionControlOps[0].fromCode, toCode: out.impacts.regionControlOps[0].toCode },
    { op: "control", regionId: "Liège", fromCode: "Belgium", toCode: "German Empire" },
  );
});

test("a treaty cession stays a legal transfer, even when the war that led to it is mentioned", async () => {
  const cession = event("Treaty cedes Alsace", "After German troops captured Strasbourg, France cedes Alsace to the German Empire by treaty.", {
    regionTransfers: [{ regionId: "Alsace", fromCode: "France", toCode: "German Empire" }],
  });
  const out = await directGeneratedTerritoryOps({
    events: [cession],
    world,
    // A control flip on top of a settlement the transfer already records is dropped.
    analyzeBatch: answering([{ eventIndex: 0, regionControlOps: [{ op: "control", regionId: "Alsace", fromCode: "France", toCode: "German Empire" }] }]),
  });
  assert.equal(transfers(out, 0).length, 1);
  assert.deepEqual(controlOps(out, 0), []);
});

test("a capture the event denies cannot flip control, but the fighting can still contest it", async () => {
  const stalled = event("Fighting at Kars", "Russian forces fail to take control of Kars after days of fighting around the citadel.");
  const out = await directGeneratedTerritoryOps({
    events: [stalled],
    world,
    analyzeBatch: answering([{
      eventIndex: 0,
      regionControlOps: [
        { op: "control", regionId: "Kars", fromCode: "Ottoman Empire", toCode: "Russian Empire" },
        { op: "contest", regionId: "Kars", fromCode: "Ottoman Empire", actorCode: "Russian Empire" },
      ],
    }]),
  });
  assert.deepEqual(controlOps(out, 0).map((op) => op.op), ["contest"]);
});

test("clearAll needs a final settlement; a ceasefire clears only the named claimant", async () => {
  const ceasefire = event("Ceasefire in the Chaco", "Bolivia and Paraguay agree to a ceasefire and their columns withdraw.");
  const settlement = event("Chaco settlement signed", "An armistice becomes a final settlement: all claims withdrawn along the Chaco boundary.");
  const clearAll = { op: "clear_contest", regionId: "Chaco", fromCode: "Paraguay", clearAll: true };
  const clearOne = { op: "clear_contest", regionId: "Chaco", fromCode: "Paraguay", claimantCode: "Bolivia" };
  const out = await directGeneratedTerritoryOps({
    events: [ceasefire, settlement],
    world,
    analyzeBatch: answering([
      { eventIndex: 0, regionControlOps: [clearAll, clearOne] },
      { eventIndex: 1, regionControlOps: [clearAll] },
    ]),
  });
  assert.deepEqual(controlOps(out, 0), [clearOne]);
  assert.deepEqual(controlOps(out, 1), [clearAll]);
});

test("an op the event already carries, or the answer repeats, is added once", async () => {
  const existing = { op: "control", regionId: "Namur", fromCode: "Belgium", toCode: "German Empire" };
  const fall = event("Namur falls", "Namur falls to the German Empire after its forts are overrun.", { regionControlOps: [existing] });
  const other = { op: "control", regionId: "Maubeuge", fromCode: "France", toCode: "German Empire" };
  const out = await directGeneratedTerritoryOps({
    events: [fall],
    world,
    analyzeBatch: answering([{ eventIndex: 0, regionControlOps: [{ ...existing, regionId: "namur" }, other, { ...other }] }]),
  });
  assert.deepEqual(controlOps(out, 0), [existing, other]);
});

test("ops without the fields a flip or contest needs, for unknown kinds, or for events out of range are dropped", async () => {
  const battle = event("Battle of Tannenberg", "German forces capture much of the Russian Second Army's ground in heavy fighting.");
  const out = await directGeneratedTerritoryOps({
    events: [battle],
    world,
    analyzeBatch: answering([
      { eventIndex: 0, regionControlOps: [
        { op: "control", regionId: "Tannenberg", fromCode: "German Empire", toCode: "German Empire" },
        { op: "contest", regionId: "", fromCode: "Russian Empire", actorCode: "German Empire" },
        { op: "annex", regionId: "Tannenberg", fromCode: "Russian Empire", toCode: "German Empire" },
      ] },
      { eventIndex: 4, regionControlOps: [{ op: "control", regionId: "Riga", fromCode: "Russian Empire", toCode: "German Empire" }] },
    ]),
  });
  assert.deepEqual(controlOps(out, 0), []);
});

test("a failed analysis leaves the events as the simulator wrote them", async () => {
  const battle = event("Battle on the Marne", "French and British forces counterattack along the river.");
  const out = await directGeneratedTerritoryOps({ events: [battle], world, analyzeBatch: async () => { throw new Error("model unavailable"); } });
  assert.deepEqual(out, [battle]);
});

test("the player's Cancel during the analysis reaches the skip instead of being kept as a failure", async () => {
  const battle = event("Battle on the Marne", "French and British forces counterattack along the river.");
  const controller = new AbortController();
  const analyzeBatch = async () => {
    controller.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
    throw controller.signal.reason;
  };
  await assert.rejects(
    directGeneratedTerritoryOps({ events: [battle], world, analyzeBatch, signal: controller.signal }),
    (error) => error?.name === "AbortError",
  );
});

// --- Once the director's in-bundle self-test ---

const easterRising = event(
  "The Easter Rising Erupts in Dublin",
  "Armed nationalist and republican volunteers stage a coordinated insurrection in Dublin, seizing the General Post Office and proclaiming the establishment of an independent Irish Republic. British garrison troops and artillery are swiftly deployed to seal off the city center and engage insurgent strongholds, triggering heavy urban skirmishing across the capital over the subsequent week.",
);

test("the Easter Rising's wording supports a contest of Dublin", () => {
  const result = sanitizeDirectorOrders({
    events: [easterRising],
    orders: [{
      eventIndex: 0,
      regionControlOps: [{
        actorCode: "Ireland",
        op: "contest",
        regionName: "Dublin",
        fromCode: "British Empire",
        regionId: "Dublin",
        note: "Easter Rising in Dublin",
      }],
    }],
  });
  assert.equal(hasTerritorialContent(easterRising), true);
  assert.deepEqual((result.acceptedByEvent.get(0) || []).map((op) => op.op), ["contest"]);
});

test("a polity cannot contest a region from itself", () => {
  const result = sanitizeDirectorOrders({
    events: [easterRising],
    orders: [{
      eventIndex: 0,
      regionControlOps: [{ actorCode: "British Empire", op: "contest", fromCode: "British Empire", regionId: "Dublin" }],
    }],
  });
  assert.deepEqual(result.acceptedByEvent.get(0) || [], []);
  assert.ok(result.diagnostics.some((row) => String(row.reason || "").includes("different nonblank")));
});

test("an administrative meeting is not territorial", () => {
  assert.equal(hasTerritorialContent(event("Railway Officials Convene", "Officials review freight timetables and administrative procedures.")), false);
});
