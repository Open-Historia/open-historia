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
import fs from "node:fs";

import {
  applyWarUpdates,
  decodeWarUpdates,
  eventNarratesHardCombat,
  normalizeWorldWarEventLinks,
  reconcileCombatWarState,
  repairWarLedgerPayload,
  validateCanonicalWarEvents,
  validateWarLedgerPayload,
  warUpdateProseLines,
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

test("a supplied event number survives when no event carries the warId, so the validator names the real defect", () => {
  const candidate = {
    events: [event("e1", "Mexico declares war on the cartel state")],
    warUpdates: record("mexican-pacification-2016", "start", "Mexico", "Cartel State", "1"),
  };
  normalizeWorldWarEventLinks(candidate);
  assert.deepEqual(candidate.warUpdates[0].eventIndexes, [0], "the model's own number is kept, not blanked");

  const error = validateWarLedgerPayload(candidate, { world });
  assert.match(error, /missing event\.warId="mexican-pacification-2016"/, "the event, not the number, is what is missing");
  assert.doesNotMatch(error, /must reference the event number/);
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
  assert.match(validateWarLedgerPayload(candidate, { world }), /missing event\.warId/);

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
      event("e2", "Ruritania and Syldavia sign a trade pact", { kind: "economic", combatants: ["Ruritania", "Syldavia"] }),
    ],
    warUpdates: [
      record("rur-bor", "start", "Ruritania", "Borduria", "1"),
      // A trade pact cannot start a canonical war, whatever the record says.
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
  assert.match(repair.residual, /no matching warUpdates record/);
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
      event("e2", "Syldavia opens a consulate", { kind: "diplomatic" }),
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

test("a start sitting on an event that cannot open a war moves to the event of that war that can", () => {
  const candidate = {
    events: [
      event("e1", "Swedish Armed Forces Cross the Norwegian Border in Shock Mobilization", {
        description: "Mechanised brigades roll out of Jämtland before dawn.",
        warId: "war-sweden-norway-2016",
      }),
      event("e2", "Norway Mobilises Its Home Guard", {
        description: "Oslo calls up reservists across Trøndelag.",
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
      event("e1", "Swedish and Norwegian staffs hold joint readiness talks", { warId: "war-sweden-norway-2016" }),
      event("e2", "Norway Mobilises Its Home Guard", { warId: "war-sweden-norway-2016" }),
    ],
    warUpdates: record("war-sweden-norway-2016", "start", "Sweden", "Norway", "2"),
  };
  const repair = repairWarLedgerPayload(candidate, { world });
  assert.equal(repair.anchored, 0);
  assert.deepEqual(repair.droppedIds, ["war-sweden-norway-2016"], "no event narrates the opening, so no war is made");
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
  assert.match(opens("Ruritanian and Bordurian staffs agree a deployment plan"), /cannot create a canonical war/, "cooperation is still no war");
  assert.match(opens("Ruritanian Army holds combat-readiness drills near the border"), /cannot create a canonical war/, "a drill near a border is not a crossing");

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

// A player's diagnostics log (beta 0.0.66, 2026-10-05, a game played in
// Russian): a month's skip answered warUpdates with a heading and a sentence
// saying no war had begun, ended or changed. Each line was read as a war whose
// id was the whole line and whose operation was blank: "Unsupported warUpdates
// operation "" for ### Обновления войн:." and, on the salvage pass, "dropped 2
// war record(s) (### Обновления войн:, Нет изменений. …)", which went on into
// the next prompt. The two lines, as the log's droppedWarIds gives them.
const PROSE_WAR_UPDATES = [
  "### Обновления войн:",
  "Нет изменений. В этом периоде ни одна война не началась, не закончилась и не изменилась — на карте нет активных конфликтов. ### Конец обновлений. **ВАЖНО:** Отвечай ТОЛЬКО валидным JSON объектом без каких-либо объяснений, комментариев или предисловий. Не добавляй текст перед или после JSON.",
];

const quietMonth = () => [
  event("e1", "Отряд кораблей Черноморского флота выходит на патрулирование", { date: "2014-09-12" }),
  event("e2", "Правительство утверждает бюджет на 2015 год", { date: "2014-09-25", kind: "domestic" }),
];

test("prose where the war records go is not a record: nothing is rejected and nothing is dropped", () => {
  const warUpdates = PROSE_WAR_UPDATES.join("\n");
  assert.deepEqual(decodeWarUpdates(warUpdates), []);
  assert.deepEqual(decodeWarUpdates(PROSE_WAR_UPDATES), [], "and as an array of lines");
  assert.deepEqual(warUpdateProseLines(warUpdates), PROSE_WAR_UPDATES, "the lines passed over can still be said");

  // The strict pass: no complaint, so no second request for the whole skip.
  const strict = { events: quietMonth(), warUpdates };
  normalizeWorldWarEventLinks(strict);
  assert.equal(validateWarLedgerPayload(strict, { world }), "");

  // The salvage pass: the repair has no record to drop, so the receipt it
  // feeds has no "id" to repeat to the model.
  const salvaged = { events: quietMonth(), warUpdates };
  assert.deepEqual(
    repairWarLedgerPayload(salvaged, { world }),
    { stamped: 0, anchored: 0, droppedIds: [], strippedEvents: 0, residual: "" },
  );
  assert.deepEqual(salvaged.warUpdates, []);
});

test("the usual ways of saying nothing changed are prose too", () => {
  for (const text of ["none", "No changes.", "N/A", "нет", "- no war updates this period -", "（无）"]) {
    assert.deepEqual(decodeWarUpdates(text), [], text);
    assert.equal(validateWarLedgerPayload({ events: quietMonth(), warUpdates: text }, { world }), "", text);
  }
  assert.deepEqual(warUpdateProseLines(""), []);
  assert.deepEqual(warUpdateProseLines(null), []);
});

test("prose beside real records costs only itself: the records are read, bound and judged as before", () => {
  const candidate = {
    events: [event("e1", "Ruritania declares war on Borduria", { warId: "rur-bor" })],
    warUpdates: ["### War updates:", record("rur-bor", "start", "Ruritania", "Borduria", "1"), "End of updates."].join("\n"),
  };
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates).map((update) => update.id), ["rur-bor"]);
  normalizeWorldWarEventLinks(candidate);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");

  // A record the ledger cannot apply is still dropped by name, and only it.
  const failing = {
    events: [event("e1", "Ruritania declares war on Borduria")],
    warUpdates: [PROSE_WAR_UPDATES[0], record("rur-bor", "start", "Ruritania", "", "1"), PROSE_WAR_UPDATES[1]].join("\n"),
  };
  assert.deepEqual(repairWarLedgerPayload(failing, { world }).droppedIds, ["rur-bor"]);
});

test("a line that is a record with a bad operation is still refused by name", () => {
  const refused = (warUpdates) => validateWarLedgerPayload({ events: quietMonth(), warUpdates }, { world });
  assert.equal(refused(record("rur-bor", "declare", "Ruritania", "Borduria", "1")), 'Unsupported warUpdates operation "declare" for rur-bor.');
  assert.equal(refused(record("rur-bor", "", "Ruritania", "Borduria", "1")), 'Unsupported warUpdates operation "" for rur-bor.');
  // One separator is enough to be a record: an id and what happens to it.
  assert.equal(refused("rur-bor~begin"), 'Unsupported warUpdates operation "begin" for rur-bor.');
  assert.deepEqual(warUpdateProseLines("rur-bor~begin"), []);
});

test("the prose lines go to the log, and the receipt is written from the repair's dropped ids alone", () => {
  // gameplay.js cannot be imported without the whole app; its wiring is read as
  // source. The receipt is the model's next prompt, so what reaches it matters.
  const source = fs.readFileSync(new URL("../src/Game/AI/gameplay.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const validateSegmentLedgers = "), source.indexOf("// One segment's storyline records"));
  assert.ok(body.length > 0, "validateSegmentLedgers was not found in gameplay.js");
  const said = body.slice(body.indexOf("warUpdateProseLines(candidate?.warUpdates)"), body.indexOf("reconcileCombatWarState(candidate"));
  assert.match(said, /console\.info\(/, "the lines passed over are said in the log");
  assert.doesNotMatch(said, /noteReceipt\(/, "and never in the receipt");
  const warNotes = [...body.matchAll(/noteReceipt\(\s*receipt,\s*"dropped",\s*`War ledger: ([\s\S]*?)\);/g)].map((match) => match[1]);
  assert.equal(warNotes.length, 1);
  assert.match(warNotes[0], /repair\.droppedIds\.join\(", "\)/);
});
