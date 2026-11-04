// Run: node --test src/Game/AI/gameMasterWars.test.js
//
// "The game master… refuses war declarations after a UN ultimatum expired, in
// Italian and English: the causal event does not narrate a war declaration…
// Military cooperation, deployments… are not belligerency" (a player's report,
// 2026-11-02). The Game Master's wars are read for what the request meant:
// the engine works out what the answer tells, and holds the rest only to a war
// having two sides that are countries in this world.
import assert from "node:assert/strict";
import test from "node:test";
import { gameMasterWarNames, settleGameMasterWars } from "./gameMasterWars.js";
import { applyWarUpdates, decodeWarUpdates } from "./nativeWarLedger.js";

const quietly = (run) => {
  const [warn, info] = [console.warn, console.info];
  console.warn = () => {};
  console.info = () => {};
  try {
    return run();
  } finally {
    console.warn = warn;
    console.info = info;
  }
};

const names = new Set(["italy", "ethiopia", "germany", "france", "iraq", "united states", "united kingdom", "russia", "ukraine"]);
const ledgerEvents = (events) => events.map((event, index) => ({ ...event, id: event.id || `gm-${index}` }));
const settle = (candidate, options = {}) => quietly(() => settleGameMasterWars(candidate, { world: {}, names, ledgerEvents, ...options }));
const gmEvent = (title, description, extra = {}) => ({ date: "1935-10-03", title, description, kind: "diplomacy", ...extra });
const applied = (candidate) => quietly(() => applyWarUpdates({
  world: {},
  updates: decodeWarUpdates(candidate.warUpdates),
  events: ledgerEvents(candidate.events),
  stopDate: "1935-10-03",
  round: 3,
}));

test("an Italian declaration of war is applied as the administrator asked, its words untouched", () => {
  const description = "Scaduto l'ultimatum della Società delle Nazioni, l'Italia apre le ostilità e le colonne passano il Mareb.";
  const candidate = {
    events: [gmEvent("L'Italia dichiara guerra all'Etiopia", description)],
    warUpdates: [{ id: "guerra-italo-etiopica", op: "start", actors: ["Italy"], opponents: ["Ethiopia"], eventIndexes: [0], note: "Title: Guerra d'Etiopia" }],
  };
  const { error, notes } = settle(candidate);
  assert.equal(error, "");
  assert.deepEqual(notes, []);
  assert.equal(candidate.events[0].warId, "guerra-italo-etiopica", "the war's id is written on its event");
  assert.deepEqual(candidate.events[0].combatants, ["Italy", "Ethiopia"], "and its two sides as the combatants");
  assert.equal(candidate.events[0].title, "L'Italia dichiara guerra all'Etiopia", "apostrophes kept");
  assert.equal(candidate.events[0].description, description, "accents kept");
  const merge = applied(candidate);
  assert.deepEqual(merge.wars.map((war) => [war.title, war.status, war.sideA, war.sideB]), [["Guerra d'Etiopia", "active", ["Italy"], ["Ethiopia"]]]);
});

test("an English declaration on an expired UN ultimatum is applied, and a bystander is not a combatant", () => {
  const candidate = {
    events: [gmEvent(
      "UN Ultimatum Expires; Coalition Opens Operations Against Iraq",
      "The deadline passes at midnight and the coalition's forces move against Iraq.",
      { kind: "military", combatants: ["United States", "United Kingdom", "Iraq", "United Nations"] },
    )],
    warUpdates: [{ id: "gulf-war", op: "start", actors: ["United States", "United Kingdom"], opponents: ["Iraq"], eventIndexes: [0], note: "" }],
  };
  // This is the wording the ledger refused: "operations" and an ultimatum are
  // no word of its English lists.
  const { error } = settle(candidate);
  assert.equal(error, "");
  assert.deepEqual(candidate.events[0].combatants, ["United States", "United Kingdom", "Iraq"]);
  assert.deepEqual(applied(candidate).appliedIds, ["gulf-war"]);
});

test("what the answer leaves out is worked out: the record's event, its sides, the war's id on the event", () => {
  const candidate = {
    events: [gmEvent("Germany declares war on France", "Berlin answers the expired ultimatum.")],
    // Both parties on one side, and no event number.
    warUpdates: [{ id: "war-germany-france", op: "start", actors: ["Germany", "France"], opponents: [], eventIndexes: [], note: "" }],
  };
  assert.equal(settle(candidate).error, "");
  const [record] = decodeWarUpdates(candidate.warUpdates);
  assert.deepEqual([record.actors, record.opponents, record.eventIndexes], [["Germany"], ["France"], [0]]);
  assert.equal(candidate.events[0].warId, "war-germany-france");
  assert.deepEqual(candidate.events[0].combatants, ["Germany", "France"]);

  // No record at all: the event's own war id and its two combatants are one.
  const bare = { events: [gmEvent("Germany declares war on France", "", { warId: "war-de-fr", combatants: ["Germany", "France"] })], warUpdates: [] };
  assert.equal(settle(bare).error, "");
  assert.deepEqual(decodeWarUpdates(bare.warUpdates).map((update) => [update.id, update.op]), [["war-de-fr", "start"]]);
});

test("a start of a war already being fought is its newcomers' join; a made-up id for it is that war", () => {
  const world = { wars: [{ id: "russo-ukrainian-war", status: "active", sideA: ["Russia"], sideB: ["Ukraine"], startedDate: "2022-02-24" }] };
  const candidate = {
    events: [gmEvent("The United Kingdom enters the war on Ukraine's side", "", { date: "2024-01-01" })],
    warUpdates: [{ id: "uk-enters-war", op: "start", actors: ["United Kingdom", "Ukraine"], opponents: ["Russia"], eventIndexes: [0], note: "" }],
  };
  // The new id names no war the ledger knows, but its sides are the war's.
  assert.equal(settle(candidate, { world }).error, "");
  assert.equal(candidate.events[0].warId, "russo-ukrainian-war");
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates).map((update) => [update.id, update.op, update.actors]),
    [["russo-ukrainian-war", "join-b", ["United Kingdom"]]]);

  const renamed = {
    events: [gmEvent("Ceasefire on the Dnieper", "", { date: "2024-01-01" })],
    warUpdates: [{ id: "war-in-ukraine", op: "ceasefire", actors: ["Russia", "Ukraine"], opponents: [], eventIndexes: [0], note: "" }],
  };
  assert.equal(settle(renamed, { world }).error, "");
  assert.equal(decodeWarUpdates(renamed.warUpdates)[0].id, "russo-ukrainian-war");
  assert.equal(renamed.events[0].warId, "russo-ukrainian-war");
});

test("a country that does not exist is said plainly, and on the last answer that war alone is left out", () => {
  const make = () => ({
    events: [
      gmEvent("Italy declares war on Atlantis", "", { warId: "war-atlantis" }),
      gmEvent("Germany declares war on France", "", { warId: "war-de-fr" }),
    ],
    warUpdates: [
      { id: "war-atlantis", op: "start", actors: ["Italy"], opponents: ["Atlantis"], eventIndexes: [0], note: "" },
      { id: "war-de-fr", op: "start", actors: ["Germany"], opponents: ["France"], eventIndexes: [1], note: "" },
    ],
  });
  const strict = make();
  const first = settle(strict);
  assert.match(first.error, /"Atlantis" is not a country in this world/);
  assert.doesNotMatch(first.error, /war-atlantis/, "no ids in what the model is told");

  const last = make();
  const { error, notes } = settle(last, { finalAttempt: true });
  assert.equal(error, "");
  assert.deepEqual(notes, ["The war between Italy and Atlantis was left out: Atlantis is not a country in this world."]);
  assert.deepEqual(decodeWarUpdates(last.warUpdates).map((update) => update.id), ["war-de-fr"], "the rest is kept");
  assert.equal(last.events[0].warId, "", "the event stays, as history");
  assert.equal(last.events.length, 2);
});

test("a war that does not say who fights whom is said plainly", () => {
  const candidate = { events: [gmEvent("War breaks out", "")], warUpdates: [{ id: "war-x", op: "start", actors: [], opponents: [], eventIndexes: [0], note: "" }] };
  assert.match(settle({ ...candidate, warUpdates: [...candidate.warUpdates] }).error, /without saying who fights whom/);
  const { notes } = settle(candidate, { finalAttempt: true });
  assert.deepEqual(notes, ["A war was left out: the request did not make clear who fights whom."]);
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates), []);
});

test("read twice, the transaction is the same: Apply's revalidation changes nothing", () => {
  const candidate = {
    events: [gmEvent("L'Italia dichiara guerra all'Etiopia", "", { combatants: ["Italy", "Ethiopia", "League of Nations"] })],
    warUpdates: [{ id: "it-et", op: "start", actors: ["Italy", "Ethiopia"], opponents: [], eventIndexes: [], note: "" }],
  };
  assert.equal(settle(candidate).error, "");
  const once = JSON.stringify(candidate);
  assert.equal(settle(candidate).error, "");
  assert.equal(JSON.stringify(candidate), once);
});

test("the names a war may give a side: countries, the wars' belligerents, the map's groups and this transaction's own", () => {
  const world = {
    wars: [{ id: "w", status: "active", sideA: ["Iraq"], sideB: ["Islamic State"] }],
    groups: { "Cartel del Norte": { name: "Cartel del Norte", description: "A cartel." } },
  };
  const candidate = {
    events: [{ impacts: { polityChanges: [{ operation: "create", code: "Free Silesia" }], regionControlOps: [{ op: "contest", actorCode: "Rif Republic" }] } }],
  };
  const known = gameMasterWarNames(candidate, { world, active: new Set(["italy"]) });
  for (const name of ["italy", "iraq", "islamic state", "cartel del norte", "free silesia", "rif republic"]) {
    assert.ok(known.has(name), name);
  }
  assert.equal(known.has("atlantis"), false);
});
