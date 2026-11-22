// Run: node --test server/warLedger.test.js
//
// The war ledger's binding of a record to the events of its war, as the time
// skip's settlement makes it (nativeWarLedger.js settleWarLedger). A real
// fallback report started this file: a "start" record whose event carried no
// warId was told, twice, to "reference the event number that establishes this
// transition" for a number it had already given, and a year of events fell to
// the canned fallback over it. Nothing here asks the model again: the record's
// own structure is read, and what cannot apply is left out and said.

import test from "node:test";
import assert from "node:assert/strict";

import { applyWarUpdates, decodeWarUpdates, settleWarLedger } from "../src/Game/AI/nativeWarLedger.js";

const event = (id, title, extra = {}) => ({
  id,
  date: "2016-03-01",
  title,
  description: "",
  kind: "military",
  ...extra,
});

// id~op~actorsCSV~opponentsCSV~eventNumbersCSV~note (event numbers are 1-based)
const record = (id, op, actors, opponents, eventNumbers, note = "") =>
  [id, op, actors, opponents, eventNumbers, note].join("~");

const world = {};
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

test("a record's own event number is kept, and the event it names is its war's", () => {
  const candidate = {
    events: [event("e1", "Mexico declares war on the cartel state")],
    warUpdates: record("mexican-pacification-2016", "start", "Mexico", "Cartel State", "1"),
  };
  assert.deepEqual(quietly(() => settleWarLedger(candidate, { world })).notes, []);
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates)[0].eventIndexes, [0], "the model's own number is kept");
  assert.equal(candidate.events[0].warId, "mexican-pacification-2016", "and the engine writes the id on it");
});

// A player's Albania answered its own declaration with "1st Albanian Motorized
// Brigade Assaults Prizren", listed before the declaration: read in that order
// the assault came before any war existed, and the repair dropped the war the
// player had just declared.
test("a war whose first battle is listed before its declaration is kept, and dated by that battle", () => {
  const candidate = {
    events: [
      event("e1", "1st Albanian Motorized Brigade Assaults Prizren", { date: "2016-03-01", warId: "war-albania-serbia-2016", combatants: ["Albania", "Serbia"] }),
      event("e2", "Albania Declares War on Serbia", { date: "2016-03-02", kind: "diplomacy", warId: "war-albania-serbia-2016" }),
    ],
    warUpdates: record("war-albania-serbia-2016", "start", "Albania", "Serbia", "2", "Declaration of war"),
  };
  const outcome = quietly(() => settleWarLedger(candidate, { world }));
  assert.deepEqual([outcome.notes, outcome.dropped, outcome.unbound], [[], [], []]);
  assert.equal(candidate.events[0].warId, "war-albania-serbia-2016", "the assault stays part of it");
  const merge = quietly(() => applyWarUpdates({ world, updates: candidate.warUpdates, events: candidate.events, stopDate: "2016-03-08", round: 7 }));
  assert.deepEqual(merge.appliedIds, ["war-albania-serbia-2016"]);
  assert.deepEqual([merge.wars[0].status, merge.wars[0].sideA, merge.wars[0].sideB, merge.wars[0].startedDate], ["active", ["Albania"], ["Serbia"], "2016-03-01"]);
});

test("a war's event told in Italian keeps its belligerents, and a joiner's event is its war's", () => {
  const worldAtWar = { wars: [{ id: "war-it-at", status: "active", sideA: ["Italy"], sideB: ["Austria"], startedDate: "1915-05-24" }] };
  const candidate = {
    events: [
      event("e1", "Battaglia dell'Isonzo", { warId: "war-it-at", combatants: ["Italy", "Austria", "Vatican City"] }),
      event("e2", "La Romania dichiara guerra all'Austria", { kind: "diplomacy" }),
    ],
    warUpdates: record("war-it-at", "join-a", "Romania", "", "2"),
  };
  assert.deepEqual(quietly(() => settleWarLedger(candidate, { world: worldAtWar })).notes, []);
  assert.deepEqual(candidate.events[0].combatants, ["Italy", "Austria"], "the war's own belligerents, and only them");
  assert.equal(candidate.events[1].warId, "war-it-at");
  const merge = quietly(() => applyWarUpdates({ world: worldAtWar, updates: candidate.warUpdates, events: candidate.events, stopDate: "1916-08-31", round: 5 }));
  assert.deepEqual(merge.wars[0].sideA, ["Italy", "Romania"]);
});

test("a record that cannot apply is left out and said; the rest of the answer stands", () => {
  const worldAtWar = { wars: [{ id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2015-01-01" }] };
  const candidate = {
    events: [event("e1", "Borduria changes sides"), event("e2", "Dorland joins Aland")],
    warUpdates: [
      record("war-1", "join-a", "Borduria", "", "1"),
      record("war-1", "join-a", "Dorland", "Borduria", "2"),
    ].join("\n"),
  };
  const outcome = quietly(() => settleWarLedger(candidate, { world: worldAtWar }));
  assert.equal(outcome.dropped.length, 1);
  assert.match(outcome.notes[0].text, /Borduria is already on the opposing side of war war-1/);
  assert.equal(outcome.notes[0].key, "gmWarChangeLeftOut", "the player's note names the war by its sides");
  const merge = quietly(() => applyWarUpdates({ world: worldAtWar, updates: candidate.warUpdates, events: candidate.events, stopDate: "2016-03-08", round: 7 }));
  assert.deepEqual(merge.wars[0].sideA, ["Aland", "Dorland"]);
});
