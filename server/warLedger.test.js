// Run: node --test server/warLedger.test.js
//
// The war ledger's binding of a record to the event that establishes it, and
// the last-attempt repair that keeps a finished segment when the model could
// not fix its records. A real fallback report started this: a "start" record
// whose event carried no warId was told, twice, to "reference the event number
// that establishes this transition" for a number it had already given, and a
// year of events fell to the canned fallback over it.

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyWarUpdates,
  decodeWarUpdates,
  eventNarratesHardCombat,
  interpretWarLedger,
  normalizeWorldWarEventLinks,
  reconcileCombatWarState,
  repairWarLedgerPayload,
  validateCanonicalWarEvents,
  validateWarLedgerPayload,
} from "../src/Game/AI/nativeWarLedger.js";

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

test("a supplied event number survives when no event carries the warId, and the record's event is its war's", () => {
  const candidate = {
    events: [event("e1", "Mexico declares war on the cartel state")],
    warUpdates: record("mexican-pacification-2016", "start", "Mexico", "Cartel State", "1"),
  };
  normalizeWorldWarEventLinks(candidate);
  assert.deepEqual(candidate.warUpdates[0].eventIndexes, [0], "the model's own number is kept, not blanked");
  // The war's id was asked for on the event, a second request for what the
  // record already said (2026-11-02): the event a record is tied to is its war's.
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
  interpretWarLedger(candidate, { world });
  assert.equal(candidate.events[0].warId, "mexican-pacification-2016", "and the engine writes the id on it");
});

test("the engine still rebinds a wrong number to the one event carrying the warId", () => {
  const candidate = {
    events: [
      event("e1", "Trade talks resume in Vienna", { kind: "economic" }),
      event("e2", "Ruritania declares war on Borduria", { warId: "rur-bor" }),
    ],
    warUpdates: record("rur-bor", "start", "Ruritania", "Borduria", "1"),
  };
  normalizeWorldWarEventLinks(candidate);
  assert.deepEqual(candidate.warUpdates[0].eventIndexes, [1]);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});

test("a record with no number and no event carrying its warId is still told to reference the event", () => {
  const candidate = {
    events: [event("e1", "Ruritania declares war on Borduria")],
    warUpdates: record("rur-bor", "start", "Ruritania", "Borduria", ""),
  };
  normalizeWorldWarEventLinks(candidate);
  assert.deepEqual(candidate.warUpdates[0].eventIndexes, []);
  assert.match(validateWarLedgerPayload(candidate, { world }), /must reference the event number/);
});

test("repair: the record's own number declares the link, so its event is stamped with the warId", () => {
  const candidate = {
    events: [event("e1", "Mexico declares war on the cartel state")],
    warUpdates: record("mexican-pacification-2016", "start", "Mexico", "Cartel State", "1", "pacification campaign"),
  };
  normalizeWorldWarEventLinks(candidate);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");

  const repair = repairWarLedgerPayload(candidate, { world });
  assert.deepEqual(repair, { stamped: 1, anchored: 0, droppedIds: [], strippedEvents: 0, residual: "" });
  assert.equal(candidate.events[0].warId, "mexican-pacification-2016");
  assert.equal(candidate.warUpdates.length, 1, "the war record is kept");
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});

test("repair: a record that cannot bind is dropped with its event's war bindings while the good one is kept", () => {
  const candidate = {
    events: [
      event("e1", "Ruritania declares war on Borduria"),
      event("e2", "Ruritania and Syldavia hold joint naval exercises", { combatants: ["Ruritania", "Syldavia"] }),
    ],
    warUpdates: [
      record("rur-bor", "start", "Ruritania", "Borduria", "1"),
      // An exercise opens no war, whatever the record says: the one wording a
      // time skip's record is not opened on.
      record("rur-syl", "start", "Ruritania", "Syldavia", "2"),
    ].join("\n"),
  };
  normalizeWorldWarEventLinks(candidate);
  assert.notEqual(validateWarLedgerPayload(candidate, { world }), "");

  const repair = repairWarLedgerPayload(candidate, { world });
  assert.equal(repair.stamped, 2);
  assert.deepEqual(repair.droppedIds, ["rur-syl"]);
  assert.equal(repair.strippedEvents, 1);
  assert.equal(repair.residual, "");
  assert.deepEqual(candidate.warUpdates.map((update) => update.id), ["rur-bor"]);
  assert.equal(candidate.events[0].warId, "rur-bor");
  assert.equal(candidate.events[1].warId, "");
  assert.deepEqual(candidate.events[1].combatants, [], "the dropped war's combatants go with it");
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});

test("repair: when nothing binds, the records go, the events stay as narrative, and what the ledger still says is reported", () => {
  const candidate = {
    events: [event("e1", "Ruritania declares war on Borduria")],
    // No opponents: a start the ledger can never apply, and the title reads
    // like a declaration whatever record is behind it.
    warUpdates: record("rur-bor", "start", "Ruritania", "", "1"),
  };
  const repair = repairWarLedgerPayload(candidate, { world });
  assert.equal(repair.stamped, 1);
  assert.deepEqual(repair.droppedIds, ["rur-bor"]);
  assert.equal(repair.strippedEvents, 1);
  assert.equal(repair.residual, "", "a title that reads like a declaration is narrative without a record");
  assert.deepEqual(candidate.warUpdates, []);
  assert.equal(candidate.events[0].warId, "");
  assert.equal(candidate.events[0].title, "Ruritania declares war on Borduria", "the event itself is untouched");
});

test("repair: an event of a war that already exists keeps its binding when another record is dropped", () => {
  const worldWithWar = {
    wars: [{ id: "old-war", status: "active", sideA: ["Ruritania"], sideB: ["Borduria"], startedDate: "2015-01-01" }],
  };
  const candidate = {
    events: [
      event("e1", "Ruritanian artillery bombardment of Bordurian lines", { warId: "old-war", combatants: ["Ruritania", "Borduria"] }),
      event("e2", "Syldavian troops hold a drill near the Bordurian frontier"),
    ],
    warUpdates: record("syl-bor", "start", "Syldavia", "Borduria", "2"),
  };
  const repair = repairWarLedgerPayload(candidate, { world: worldWithWar });
  assert.deepEqual(repair.droppedIds, ["syl-bor"]);
  assert.equal(repair.residual, "");
  assert.equal(candidate.events[0].warId, "old-war", "the existing war's event keeps its warId");
  assert.deepEqual(candidate.events[0].combatants, ["Ruritania", "Borduria"]);
  assert.equal(candidate.events[1].warId, "");
});

// A player's diagnostics log (beta 0.0.50, 2026-09-22) shows two wars the
// player had just declared thrown away by this repair. The payloads are not in
// the log; these are the shapes its messages allow. Albania: "Albania
// recognises the serbian advance as an offical declaration of war" and "occupy
// the city of prizen" came back with the assault listed ahead of the event the
// war was started on — "Event "1st Albanian Motorized Brigade Assaults
// Prizren" references warId war-albania-serbia-2016, but no such canonical war
// exists at that point in the timeline" — and the war was dropped. Sweden: "we
// move troops into norway" came back as "Swedish Armed Forces Cross the
// Norwegian Border in Shock Mobilization", with the start on a later event,
// and the same message dropped that war too.

const albania = () => ({
  events: [
    event("e1", "1st Albanian Motorized Brigade Assaults Prizren", {
      description: "Albanian armour and infantry storm Serbian positions around Prizren; heavy fighting continues into the night.",
      warId: "war-albania-serbia-2016",
      combatants: ["Albania", "Serbia"],
    }),
    event("e2", "Albania Declares War on Serbia", {
      kind: "diplomacy",
      description: "Tirana answers the Serbian advance with a formal declaration of war.",
      warId: "war-albania-serbia-2016",
    }),
  ],
  warUpdates: record("war-albania-serbia-2016", "start", "Albania", "Serbia", "2", "Serbian advance answered"),
});

test("a war whose first battle is listed before its declaration is kept by the repair, not dropped", () => {
  const candidate = albania();
  assert.deepEqual(reconcileCombatWarState(candidate, { world }).unresolved, [], "the assault names its war and both sides");
  normalizeWorldWarEventLinks(candidate);
  assert.match(
    validateWarLedgerPayload(candidate, { world }),
    /references warId war-albania-serbia-2016, but no such canonical war exists at that point in the timeline/,
    "the strict pass still reads the order as written, and says so while a retry remains",
  );

  const repair = repairWarLedgerPayload(candidate, { world });
  assert.deepEqual(repair.droppedIds, [], "the war the player declared is kept");
  assert.equal(repair.strippedEvents, 0);
  assert.equal(repair.residual, "");
  assert.equal(candidate.events[0].warId, "war-albania-serbia-2016", "the assault stays part of it");

  const merge = applyWarUpdates({ world, updates: decodeWarUpdates(candidate.warUpdates), events: candidate.events, stopDate: "2016-03-08", round: 7 });
  assert.deepEqual(merge.appliedIds, ["war-albania-serbia-2016"]);
  assert.equal(merge.wars[0].status, "active");
  assert.deepEqual(merge.wars[0].sideA, ["Albania"]);
  assert.deepEqual(merge.wars[0].sideB, ["Serbia"]);
});

test("the merged-turn check reads a round as one period, so it does not flag what the repair kept", () => {
  const candidate = albania();
  normalizeWorldWarEventLinks(candidate);
  const updates = decodeWarUpdates(candidate.warUpdates);
  assert.match(validateCanonicalWarEvents({ events: candidate.events, updates, world }), /no such canonical war exists at that point/);
  assert.equal(validateCanonicalWarEvents({ events: candidate.events, updates, world, startsInForce: true }), "");
});

test("a start sitting on an exercise moves to the event of that war that opens it", () => {
  const candidate = {
    events: [
      event("e1", "Swedish Armed Forces Cross the Norwegian Border in Shock Mobilization", {
        description: "Mechanised brigades roll out of Jämtland before dawn.",
        warId: "war-sweden-norway-2016",
      }),
      event("e2", "Norway's Home Guard Holds a Snap Exercise", {
        description: "Oslo calls up reservists across Trøndelag for a drill.",
        warId: "war-sweden-norway-2016",
      }),
    ],
    warUpdates: record("war-sweden-norway-2016", "start", "Sweden", "Norway", "2", "Swedish incursion"),
  };
  normalizeWorldWarEventLinks(candidate);
  assert.match(validateWarLedgerPayload(candidate, { world }), /no such canonical war exists at that point in the timeline/);

  const repair = repairWarLedgerPayload(candidate, { world });
  assert.equal(repair.anchored, 1, "the start moved onto the crossing");
  assert.deepEqual(repair.droppedIds, [], "and the war was kept");
  assert.equal(repair.residual, "");
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates)[0].eventIndexes, [0]);

  const merge = applyWarUpdates({ world, updates: decodeWarUpdates(candidate.warUpdates), events: candidate.events, stopDate: "2016-01-08", round: 2 });
  assert.deepEqual(merge.appliedIds, ["war-sweden-norway-2016"]);
});

test("a start the batch cannot open anywhere is still dropped, with its events kept as narrative", () => {
  const candidate = {
    events: [
      event("e1", "Swedish and Norwegian staffs hold a joint readiness exercise", { warId: "war-sweden-norway-2016" }),
      event("e2", "Norway's Home Guard Holds a Snap Drill", { warId: "war-sweden-norway-2016" }),
    ],
    warUpdates: record("war-sweden-norway-2016", "start", "Sweden", "Norway", "2"),
  };
  const repair = repairWarLedgerPayload(candidate, { world });
  assert.equal(repair.anchored, 0);
  assert.deepEqual(repair.droppedIds, ["war-sweden-norway-2016"], "every event of it is an exercise, so no war is made");
  assert.equal(candidate.events.length, 2);
  assert.equal(candidate.events[0].warId, "");
});

test("the words that open a war include their other forms and a border crossing; a battle is still a battle", () => {
  const opens = (title, description = "") => validateWarLedgerPayload({
    events: [event("e1", title, { description, warId: "w" })],
    warUpdates: record("w", "start", "Ruritania", "Borduria", "1"),
  }, { world });
  for (const [title, description] of [
    ["Ruritanian Brigade Assaults Bordurian Positions", ""],
    ["Ruritania Breaks with Borduria", "Ruritania declared war on Borduria at dawn."],
    ["Ruritanian Troops Invaded Borduria Overnight", ""],
    ["Ruritanian Army Crosses the Bordurian Frontier", ""],
    ["Ruritanian columns pour across the border", ""],
    ["Ruritanian aircraft carry out airstrikes on Bordurian depots", ""],
  ]) {
    assert.equal(opens(title, description), "", title);
  }
  // The record is what says the war began; the event's words are not asked to
  // say it again, in English or any language (2026-11-02).
  assert.equal(opens("Ruritanian and Bordurian staffs agree a deployment plan"), "", "the record opens the war");
  assert.equal(opens("La Ruritania dichiara guerra alla Borduria", "Scaduto l'ultimatum dell'ONU, Ruritania apre le ostilità."), "", "in Italian too");
  assert.match(opens("Ruritanian Army holds combat-readiness drills near the border"), /describes an exercise or drill/, "a drill is the one wording that opens none");

  // The detector that decides whether an event must belong to a war at all is
  // not loosened: a government that "battles wildfires" fights no one.
  assert.equal(eventNarratesHardCombat({ kind: "domestic", title: "Government battles wildfires in the north", description: "" }), false);
});

test("only the causal start event may rely on start-record sides; later battles still need combatants", () => {
  const candidate = {
    events: [
      event("e1", "Ruritania Declares War on Borduria", {
        kind: "diplomacy",
        warId: "w",
      }),
      event("e2", "Ruritanian Brigade Assaults Bordurian Positions", {
        warId: "w",
      }),
    ],
    warUpdates: record("w", "start", "Ruritania", "Borduria", "1"),
  };

  assert.match(
    validateWarLedgerPayload(candidate, { world }),
    /must include event\.combatants naming at least the two opposing belligerent polities/,
  );
});

test("a unit called a Combat Wing or a battle group is a formation, not a battle", () => {
  // Transcribed from the same log: an Ecuadorian air wing changing bases was
  // flagged as combat needing a war, on two turns running.
  assert.equal(eventNarratesHardCombat({
    kind: "military",
    title: "FAE 21st Combat Wing Redeploys to Quito Amid Border Strains with Colombia",
    description: "The wing moves its aircraft to Mariscal Sucre airport.",
  }), false);
  assert.equal(eventNarratesHardCombat({ kind: "military", title: "EU battle group deploys to Bamako", description: "" }), false);
  assert.equal(eventNarratesHardCombat({
    kind: "military",
    title: "Ecuadorian and Colombian troops locked in combat near Ipiales",
    description: "",
  }), true, "real combat still reads as combat");
});

// Since the skip writes its events in the player's own language (2026-10-30),
// a battle told in Italian reads as prose to the English word lists that tell
// combat, and reconciliation cleared the combatants of every such event: the
// war's fronts had no one named to fight.
test("a war's event told in Italian keeps its combatants, and an opening names both sides", () => {
  const worldAtWar = { wars: [{ id: "war-it-at", status: "active", sideA: ["Italy"], sideB: ["Austria"], startedDate: "1915-05-24" }] };
  const candidate = {
    events: [
      event("e1", "Battaglia dell'Isonzo", { warId: "war-it-at", combatants: ["Italy", "Austria", "Vatican City"] }),
      event("e2", "La Romania dichiara guerra all'Austria", { kind: "diplomacy" }),
    ],
    warUpdates: record("war-it-at", "join-a", "Romania", "", "2"),
  };
  interpretWarLedger(candidate, { world: worldAtWar });
  reconcileCombatWarState(candidate, { world: worldAtWar });
  assert.deepEqual(candidate.events[0].combatants, ["Italy", "Austria"], "the war's own belligerents, and only them");
  assert.equal(candidate.events[1].warId, "war-it-at");
  assert.deepEqual(candidate.events[1].combatants, ["Romania", "Austria"], "the joiner and the side it fights");
  normalizeWorldWarEventLinks(candidate);
  assert.equal(validateWarLedgerPayload(candidate, { world: worldAtWar }), "");
});
