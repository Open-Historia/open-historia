/*! Open Historia — the territory director's rules: what it is asked, what it may keep © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTerritoryDirector.rules.test.js
//
// Runs without node_modules: nativeTerritoryDirector.js imports nothing.
//
// The director is asked about an event by what the event IS: its own
// territorial operations, the war it belongs to (warId), the powers fighting
// in it (combatants), or a player's order or Scene it answers (`ordered`).
// Its answer is kept by what each operation IS: its kind and the fields that
// kind needs. Never by words. English capture, fight and ceasefire words used
// to decide both, and an event in any other language was never read: "there
// should be absolutely no keywording done in this game anywhere" (the owner,
// 2026-11-13). Each rule below is shown with an English event and its French
// twin, which must be treated exactly alike.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTerritoryDirectorInput,
  directGeneratedTerritoryOps,
  hasTerritorialContent,
  sanitizeDirectorOrders,
} from "./nativeTerritoryDirector.js";

const event = (title, description = "", impacts = {}, extra = {}) => ({
  date: "1914-09-01",
  title,
  description,
  impacts: { regionTransfers: [], regionControlOps: [], unitOps: [], ...impacts },
  ...extra,
});

const world = { regionOwnershipOverrides: {}, regionSovereigntyOverrides: {}, regionClaimants: {} };

const candidateIndexes = async (events) =>
  (await buildTerritoryDirectorInput({ events, world }))?.candidates.map((row) => row.eventIndex) ?? [];

// One event, written in English and in French, with the same structured fields.
const twins = (english, french, impacts = {}, extra = {}) => [
  event(english[0], english[1], impacts, extra),
  event(french[0], french[1], impacts, extra),
];

test("an event of a war, or with combatants, is asked about in every language", async () => {
  const war = { warId: "war-1914", combatants: ["German Empire", "Belgium"] };
  const [english, french] = twins(
    ["German army captures Liège", "The fortress city falls to German troops after a siege."],
    ["L'armée allemande prend Liège", "La ville forteresse tombe aux mains des troupes allemandes après un siège."],
    {},
    war,
  );
  assert.deepEqual(await candidateIndexes([english, french]), [0, 1]);
  // warId alone, or combatants alone, is enough.
  assert.deepEqual(await candidateIndexes([event("x", "", {}, { warId: "war-1914" }), event("y", "", {}, { combatants: ["Serbia"] })]), [0, 1]);
});

test("an event with no war, no combatants, no operations and no order is not asked about, whatever its words say", async () => {
  const [english, french] = twins(
    ["Battle on the Marne", "French and British forces counterattack along the river and capture three villages."],
    ["Bataille de la Marne", "Les forces françaises et britanniques contre-attaquent le long de la rivière et prennent trois villages."],
  );
  assert.deepEqual(await candidateIndexes([english, french]), []);
  let asked = 0;
  const out = await directGeneratedTerritoryOps({ events: [english, french], world, analyzeBatch: async () => { asked += 1; return { eventOrders: [] }; } });
  assert.equal(asked, 0);
  assert.equal(out.length, 2);
});

test("an event carrying territorial operations, or answering an order of the player's, is asked about", async () => {
  const cession = event(
    "Treaty of Frankfurt cedes Alsace",
    "France cedes Alsace to the German Empire under the treaty.",
    { regionTransfers: [{ regionId: "Alsace", fromCode: "France", toCode: "German Empire" }] },
  );
  const ordered = event("Burkinabe columns move north", "Les colonnes avancent.", {}, { ordered: { forces: true, build: true } });
  assert.deepEqual(await candidateIndexes([cession, ordered]), [0, 1]);
});

test("a legal transfer stays a legal transfer, whatever the event's words: no analyzer, no conversion", async () => {
  const transfer = { regionId: "Liège", regionName: "Liège", fromCode: "Belgium", toCode: "German Empire" };
  const [english, french] = twins(
    ["German army captures Liège", "German troops capture the city after a short siege."],
    ["L'armée allemande prend Liège", "Les troupes allemandes prennent la ville après un court siège."],
    { regionTransfers: [transfer] },
  );
  const out = await directGeneratedTerritoryOps({ events: [english, french], world });
  for (const written of out) {
    assert.deepEqual(written.impacts.regionTransfers, [transfer]);
    assert.deepEqual(written.impacts.regionControlOps, []);
  }
});

// --- What the director's answer may do to the map ---------------------------

const answering = (eventOrders) => async () => ({ payload: { eventOrders, summary: "" } });
const controlOps = (out, index) => out[index].impacts.regionControlOps;

test("each op kind is kept by its own fields, in English and in French alike", async () => {
  const war = { warId: "war-1877", combatants: ["Ottoman Empire", "Russian Empire"] };
  const [english, french] = twins(
    ["Fighting at Kars", "Russian forces fail to take control of Kars after days of fighting around the citadel."],
    ["Combats à Kars", "Les forces russes ne parviennent pas à prendre Kars après des jours de combats autour de la citadelle."],
    {},
    war,
  );
  const ops = [
    { op: "control", regionId: "Kars", fromCode: "Ottoman Empire", toCode: "Russian Empire" },
    { op: "contest", regionId: "Ardahan", fromCode: "Ottoman Empire", actorCode: "Russian Empire" },
    { op: "clear_contest", regionId: "Batum", fromCode: "Ottoman Empire", claimantCode: "Russian Empire" },
    { op: "clear_contest", regionId: "Erzurum", fromCode: "Ottoman Empire", clearAll: true },
  ];
  const out = await directGeneratedTerritoryOps({
    events: [english, french],
    world,
    analyzeBatch: answering([{ eventIndex: 0, regionControlOps: ops }, { eventIndex: 1, regionControlOps: ops }]),
  });
  // The model decides whether control changed; its op's kind is trusted.
  assert.deepEqual(controlOps(out, 0), ops);
  assert.deepEqual(controlOps(out, 1), ops);
});

test("a control flip on a region the event's own regionTransfers already move is left out; others stand", async () => {
  const cession = event("Treaty cedes Alsace", "France cedes Alsace to the German Empire by treaty.", {
    regionTransfers: [{ regionId: "FRA.1_1", regionName: "Alsace", fromCode: "France", toCode: "German Empire" }],
  });
  const out = await directGeneratedTerritoryOps({
    events: [cession],
    world,
    analyzeBatch: answering([{ eventIndex: 0, regionControlOps: [
      { op: "control", regionId: "alsace", fromCode: "France", toCode: "German Empire" },
      { op: "control", regionId: "Lorraine", fromCode: "France", toCode: "German Empire" },
    ] }]),
  });
  assert.deepEqual(controlOps(out, 0).map((op) => op.regionId), ["Lorraine"]);
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

test("ops without the fields their kind needs, of unknown kinds, or for events out of range are dropped", async () => {
  const battle = event("Battle of Tannenberg", "German forces capture much of the Russian Second Army's ground.", {}, { warId: "war-1914" });
  const out = await directGeneratedTerritoryOps({
    events: [battle],
    world,
    analyzeBatch: answering([
      { eventIndex: 0, regionControlOps: [
        { op: "control", regionId: "Tannenberg", fromCode: "German Empire", toCode: "German Empire" },
        { op: "contest", regionId: "", fromCode: "Russian Empire", actorCode: "German Empire" },
        { op: "annex", regionId: "Tannenberg", fromCode: "Russian Empire", toCode: "German Empire" },
        { op: "clear_contest", regionId: "Tannenberg", fromCode: "Russian Empire" },
      ] },
      { eventIndex: 4, regionControlOps: [{ op: "control", regionId: "Riga", fromCode: "Russian Empire", toCode: "German Empire" }] },
    ]),
  });
  assert.deepEqual(controlOps(out, 0), []);
});

test("an answer for an event the director was not asked about changes nothing", () => {
  const quiet = event("Railway Officials Convene", "Officials review freight timetables.");
  const result = sanitizeDirectorOrders({
    events: [quiet],
    orders: [{ eventIndex: 0, regionControlOps: [{ op: "control", regionId: "Kars", fromCode: "Ottoman Empire", toCode: "Russian Empire" }] }],
  });
  assert.equal(hasTerritorialContent(quiet), false);
  assert.deepEqual(result.acceptedByEvent.get(0) || [], []);
});

test("a failed analysis leaves the events as the simulator wrote them", async () => {
  const battle = event("Battle on the Marne", "French and British forces counterattack along the river.", {}, { warId: "war-1914" });
  const out = await directGeneratedTerritoryOps({ events: [battle], world, analyzeBatch: async () => { throw new Error("model unavailable"); } });
  assert.deepEqual(out, [battle]);
});

test("the player's Cancel during the analysis reaches the skip instead of being kept as a failure", async () => {
  const battle = event("Battle on the Marne", "French and British forces counterattack along the river.", {}, { warId: "war-1914" });
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
  "Armed nationalist and republican volunteers stage a coordinated insurrection in Dublin, seizing the General Post Office.",
  {},
  { warId: "easter-rising", combatants: ["Ireland", "British Empire"] },
);

test("the Easter Rising, a war event, takes a contest of Dublin", () => {
  const result = sanitizeDirectorOrders({
    events: [easterRising],
    orders: [{
      eventIndex: 0,
      regionControlOps: [{ actorCode: "Ireland", op: "contest", regionName: "Dublin", fromCode: "British Empire", regionId: "Dublin", note: "Easter Rising in Dublin" }],
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

test("no word list is left to read an event by", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./nativeTerritoryDirector.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /_PATTERN\b|\.test\(text\)|eventText|convertLegacyWartimeTransfers/);
});
