/*! Open Historia — canonical war ledger tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  activeWarIdsForPolity,
  applyWarUpdates,
  bindWarUpdatesToEvents,
  buildCanonicalWarContext,
  decodeWarUpdates,
  eventNarratesHardCombat,
  reconcileCombatWarState,
  repairWarLedgerPayload,
  splitWarStartNote,
  validateWarLedgerPayload,
} from "./nativeWarLedger.js";

// A war exists only because a warUpdates record started it, and a battle can
// only be narrated inside one that is active: the invariant the whole ledger
// enforces, exercised end to end on the compact line transport the model emits.

const world = { polityOverrides: {}, wars: [] };

const declaration = () => [{
  id: "e1",
  date: "1914-08-03",
  title: "Germany declares war on France",
  description: "Berlin declares war on Paris after the ultimatum expires.",
  kind: "diplomacy",
  warId: "war-france-germany-1914",
}];

test("a declaration starts a canonical war bound to its event", () => {
  const events = declaration();
  const candidate = { events, warUpdates: "war-france-germany-1914~start~Germany~France~1~Declaration of war" };
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");

  const merge = applyWarUpdates({
    world,
    updates: decodeWarUpdates(candidate.warUpdates),
    events,
    stopDate: "1914-08-31",
    round: 2,
  });
  assert.deepEqual(merge.appliedIds, ["war-france-germany-1914"]);
  assert.equal(merge.wars.length, 1);
  assert.equal(merge.wars[0].status, "active");
  assert.deepEqual(merge.wars[0].sideA, ["Germany"]);
  assert.deepEqual(merge.wars[0].sideB, ["France"]);
  assert.equal(merge.wars[0].startedDate, "1914-08-03");
  assert.deepEqual(merge.wars[0].sourceEventIds, ["e1"]);
  assert.deepEqual(activeWarIdsForPolity(merge.world, "France"), ["war-france-germany-1914"]);
  assert.match(buildCanonicalWarContext(merge.world), /war-france-germany-1914 \| ACTIVE \| SIDE A: Germany \| SIDE B: France/);
});

// Every war the model opened used to be called "A–B War": the record had no
// place for the name the model gave it.
test("a start's note can name the war; the rest of it is the cause", () => {
  const events = declaration();
  const named = applyWarUpdates({
    world,
    updates: "war-france-germany-1914~start~Germany~France~1~Title: The Great War; The ultimatum to Paris expired unanswered",
    events,
    stopDate: "1914-08-31",
    round: 2,
  });
  assert.equal(named.wars[0].title, "The Great War");
  assert.equal(named.wars[0].cause, "The ultimatum to Paris expired unanswered");
  assert.equal(named.wars[0].note, "The ultimatum to Paris expired unanswered");

  const unnamed = applyWarUpdates({ world, updates: "war-france-germany-1914~start~Germany~France~1~Declaration of war", events, stopDate: "1914-08-31", round: 2 });
  assert.equal(unnamed.wars[0].title, "Germany–France War");
  assert.equal(unnamed.wars[0].cause, "Declaration of war");

  assert.deepEqual(splitWarStartNote("title: Winter War"), { title: "Winter War", cause: "" });
  assert.deepEqual(splitWarStartNote("The title: a pretext"), { title: "", cause: "The title: a pretext" }, "only a leading Title: names the war");
});

test("a declaration with no matching warUpdates record is rejected", () => {
  const error = validateWarLedgerPayload({ events: declaration(), warUpdates: "" }, { world });
  assert.match(error, /narrates a canonical war transition but has no matching warUpdates record/);
});

test("hard combat without a canonical war is rejected", () => {
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-08-20",
      title: "Battle of the Frontiers",
      description: "French and German armies clash along the whole border.",
      kind: "military",
      combatants: ["France", "Germany"],
    }],
    warUpdates: "",
  };
  assert.match(validateWarLedgerPayload(candidate, { world }), /has no event\.warId/);
});

test("reconciliation binds unlabelled combat to the one matching active war", () => {
  const warWorld = {
    ...world,
    wars: [{ id: "war-france-germany-1914", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
  };
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-08-20",
      title: "Battle of the Frontiers",
      description: "French and German armies clash along the whole border.",
      kind: "military",
      combatants: ["France", "Germany"],
    }],
    warUpdates: "",
  };
  const repair = reconcileCombatWarState(candidate, { world: warWorld });
  assert.equal(repair.bound, 1);
  assert.deepEqual(repair.unresolved, []);
  assert.equal(candidate.events[0].warId, "war-france-germany-1914");
  assert.equal(validateWarLedgerPayload(candidate, { world: warWorld }), "");
});

// The prompt tells the model to tag fighting with the war's id. Tagged with a
// ceasefire war's id and no record of its own, the segment used to be rejected
// ("ceasefire, not active") — a corrective request — where the same event
// untagged resumed the war.
test("fighting tagged with a ceasefire war's id resumes that war", () => {
  const truce = {
    ...world,
    wars: [{ id: "war-france-germany-1914", status: "ceasefire", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
  };
  const battle = (warId) => ({
    events: [{
      id: "e1",
      date: "1915-03-10",
      title: "Battle of Neuve Chapelle",
      description: "French and German armies clash again along the border after the truce breaks down.",
      kind: "military",
      combatants: ["France", "Germany"],
      warId,
    }],
    warUpdates: "",
  });

  const tagged = battle("war-france-germany-1914");
  const repair = reconcileCombatWarState(tagged, { world: truce });
  assert.equal(repair.resumed, 1);
  assert.deepEqual(repair.unresolved, []);
  assert.deepEqual(decodeWarUpdates(tagged.warUpdates).map((update) => [update.id, update.op]), [["war-france-germany-1914", "resume"]]);
  assert.equal(validateWarLedgerPayload(tagged, { world: truce }), "");

  const untagged = battle(undefined);
  reconcileCombatWarState(untagged, { world: truce });
  assert.deepEqual(decodeWarUpdates(untagged.warUpdates), decodeWarUpdates(tagged.warUpdates), "tagged or not, the same resume");

  // A record the model wrote for the war itself is left for the validator.
  const withRecord = { ...battle("war-france-germany-1914"), warUpdates: "war-france-germany-1914~resume~~~1~The truce collapses" };
  assert.equal(reconcileCombatWarState(withRecord, { world: truce }).resumed, 0);
  assert.equal(decodeWarUpdates(withRecord.warUpdates).length, 1);
});

// A record that already crossed a segment or hidden-pass boundary carries
// stable eventIds; its eventIndexes point into the answer it came from, not
// the combined batch it is bound against now. Reading them again rebinds the
// record to an unrelated event — the ground BugReport1's dropped wars grew in.
test("binding keeps a record's existing event ids over its pass-local indexes", () => {
  const events = [
    { id: "turn-event-1", date: "1915-01-01", title: "Unrelated", description: "", kind: "politics" },
    { id: "turn-event-2", date: "1915-01-02", title: "Also unrelated", description: "", kind: "politics" },
  ];
  const [carried] = bindWarUpdatesToEvents([{ id: "w", op: "start", actors: ["A"], opponents: ["B"], eventIds: ["segment-1-event-4"], eventIndexes: [0] }], events);
  assert.deepEqual(carried.eventIds, ["segment-1-event-4"], "the stable id wins");

  const [fresh] = bindWarUpdatesToEvents("w~start~A~B~2,2,1~Declaration", events);
  assert.deepEqual(fresh.eventIds, ["turn-event-2", "turn-event-1"], "indexes resolve against this batch, once each, in order");

  const many = Array.from({ length: 30 }, (_, index) => `event-${index}`);
  const [capped] = bindWarUpdatesToEvents([{ id: "w", op: "start", eventIds: [...many, many[0]] }], events);
  assert.deepEqual(capped.eventIds, many.slice(0, 24), "de-duplicated and capped at 24");
});

test("a readiness event naming two allies is not combat and creates no war", () => {
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-07-30",
      title: "Joint staff talks conclude",
      description: "British and French staffs agree combat-readiness measures and a deployment plan.",
      kind: "military",
      combatants: ["France", "United Kingdom"],
    }],
    warUpdates: "",
  };
  const repair = reconcileCombatWarState(candidate, { world });
  assert.equal(repair.started, 0);
  assert.equal(repair.sanitized, 1);
  assert.deepEqual(candidate.events[0].combatants, []);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});

// Transcribed from a player's debug report (Iran, round 55): the event the model
// wrote for the player's own queued action. It was read as a launched military
// offensive with no combatants, so the retry was spent on a phantom battle and
// the final attempt dropped the event from the turn.
test("a diplomatic offensive is not a battle; a military offensive still is", () => {
  const diplomatic = {
    id: "segment-1-event-2",
    date: "2026-07-18",
    kind: "diplomacy",
    title: "Ministry of Foreign Affairs Launches European Diplomatic Offensive for Sanctions Relief",
    description: "The Ministry of Foreign Affairs, in close coordination with Omani backchannel delegates, launches an active diplomatic offensive across European capitals, formally demanding the immediate lifting of unilateral Western sanctions against the sovereign Bahraini Republic and the unified government of Yemen.",
  };
  assert.equal(eventNarratesHardCombat(diplomatic), false);
  const candidate = { events: [diplomatic], warUpdates: "" };
  assert.deepEqual(reconcileCombatWarState(candidate, { world }).unresolved, []);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");

  for (const phrase of ["charm offensive", "media counter-offensive", "peace offensive"]) {
    assert.equal(
      eventNarratesHardCombat({ kind: "diplomacy", title: `Tokyo launches a ${phrase} in Seoul`, description: "" }),
      false,
      phrase,
    );
  }

  assert.equal(eventNarratesHardCombat({
    kind: "military",
    title: "Germany launches an offensive on the Marne",
    description: "German armies open a counter-offensive against French positions.",
  }), true, "a military offensive is still combat");
  assert.equal(eventNarratesHardCombat({
    kind: "diplomacy",
    title: "Paris opens a diplomatic offensive as armies clash on the border",
    description: "",
  }), true, "real fighting in the same event is still combat");
  assert.equal(eventNarratesHardCombat({
    kind: "military",
    title: "Moscow launches a cyber offensive against Kyiv's grid",
    description: "",
  }), true, "a cyber offensive is a hostile act, not a figure of speech");
});

test("ceasefire, resume and end move the status; a second start on a live war is refused", () => {
  const warWorld = { ...world, wars: [{ id: "w", status: "active", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01" }] };
  const events = [{ id: "e1", date: "1901-01-01", title: "Armistice signed between A and B", description: "The guns fall silent.", warId: "w" }];

  const paused = applyWarUpdates({ world: warWorld, updates: "w~ceasefire~~~1~armistice", events, stopDate: "1901-01-31", round: 3 });
  assert.equal(paused.wars[0].status, "ceasefire");

  const again = applyWarUpdates({ world: paused.world, updates: "w~start~A~B~1~again", events, stopDate: "1901-02-01", round: 4 });
  assert.deepEqual(again.appliedIds, []);
  assert.equal(again.wars[0].status, "ceasefire");

  const resumed = applyWarUpdates({ world: paused.world, updates: "w~resume~~~1~fighting resumes", events, stopDate: "1901-02-01", round: 4 });
  assert.equal(resumed.wars[0].status, "active");

  const ended = applyWarUpdates({ world: resumed.world, updates: "w~end~~~1~peace", events, stopDate: "1901-03-01", round: 5 });
  assert.equal(ended.wars[0].status, "ended");
  assert.equal(ended.wars[0].endedDate, "1901-01-01");
  assert.match(buildCanonicalWarContext(ended.world), /No active or ceasefire canonical wars/);
});

// An ended war dropped out of the context the moment it ended, so the next
// skip's model had no word that the fighting had stopped.
test("wars ended in the last two rounds are listed as ENDED, at most five", () => {
  const war = (id, updatedRound, extra = {}) => ({
    id, status: "ended", sideA: [`${id}-a`], sideB: [`${id}-b`],
    startedDate: "1900-01-01", endedDate: "1901-06-01", updatedRound, ...extra,
  });
  const recent = { wars: [
    { id: "live", status: "active", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01" },
    war("just-now", 7, { endedDate: "1901-07-01" }),
    war("last-round", 6),
    war("long-ago", 5),
  ] };

  const text = buildCanonicalWarContext(recent, { round: 7 });
  assert.match(text, /- live \| ACTIVE/);
  assert.match(text, /- just-now \| ENDED 1901-07-01 \| SIDE A: just-now-a \| SIDE B: just-now-b/);
  assert.match(text, /- last-round \| ENDED 1901-06-01/);
  assert.doesNotMatch(text, /long-ago/, "three rounds back is no longer recent");
  assert.ok(text.indexOf("just-now") < text.indexOf("last-round"), "newest first");
  assert.match(text, /This ledger is authoritative belligerency/);

  // Without the round nothing ended is listed.
  assert.doesNotMatch(buildCanonicalWarContext(recent), /ENDED/);

  // With no war running, the ended ones still follow the "no war" lines.
  const quiet = buildCanonicalWarContext({ wars: recent.wars.slice(1) }, { round: 7 });
  assert.match(quiet, /^No active or ceasefire canonical wars are recorded\./);
  assert.match(quiet, /- just-now \| ENDED/);

  const many = { wars: Array.from({ length: 8 }, (_, index) => war(`w${index}`, 7)) };
  assert.equal(buildCanonicalWarContext(many, { round: 7 }).match(/\| ENDED /g).length, 5);
});

// A live run (2026-09-17) lost two real events to this: "Tragic Clashes and Fire
// in Odessa" and "Explosion Rocks Regional Administration Building in Luhansk"
// read as hard combat to the detector, named no two belligerents, and were
// DELETED by the salvage path — and under salvage-first there is no second
// attempt to correct them, so the player simply never saw them. What must fail
// closed is the belligerency, not the event.
test("an unbindable combat event is reported for unbinding, never for deletion", () => {
  const riot = {
    id: "e1",
    date: "2014-05-02",
    title: "Tragic Clashes and Fire in Odessa",
    description: "Street clashes between rival demonstrators end with a building alight; dozens are killed.",
    kind: "world",
    combatants: [],
  };
  const candidate = { events: [riot], warUpdates: "" };
  const outcome = reconcileCombatWarState(candidate, { world });

  assert.equal(outcome.unresolved.length, 1, "the engine cannot tie it to a war, and says so");
  assert.equal(outcome.unresolved[0].index, 0);
  // reconcileCombatWarState itself never removes an event: it reports, and the
  // caller (gameplay.js validateGeneratedWorldChanges) unbinds rather than drops.
  assert.equal(candidate.events.length, 1, "the event is still there after reconciliation");
  assert.equal(candidate.events[0].title, "Tragic Clashes and Fire in Odessa");

  // What the caller then does (gameplay.js validateGeneratedWorldChanges): strip
  // the war metadata and keep the event. The ledger still complains that prose
  // reading as combat carries no warId — a riot IS written like a battle — and
  // that complaint is only ever logged: repairWarLedgerPayload, the last stage,
  // strips bindings and drops records but NEVER removes an event. So the event
  // reaches the player either way, with no belligerency invented for it.
  candidate.events = candidate.events.map((event) => ({ ...event, warId: "", combatants: [] }));
  const repair = repairWarLedgerPayload(candidate, { world });
  assert.equal(candidate.events.length, 1, "the repair keeps the event");
  assert.equal(candidate.events[0].warId, "", "and invents no war for it");
  assert.deepEqual(candidate.events[0].combatants, []);
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates), [], "no war record was conjured either");
  assert.match(repair.residual, /no event.warId/, "the residual complaint is about the ledger, and is only logged");
});

test("a war starts on its earliest linked event by the calendar, BC years included", () => {
  const events = [
    { id: "e2", date: "-0217-01-15", title: "Carthage marches on Rome", description: "Carthage answers the declaration.", kind: "diplomacy", warId: "war-rome-carthage" },
    { id: "e1", date: "-0218-12-20", title: "Rome declares war on Carthage", description: "Rome declares war on Carthage.", kind: "diplomacy", warId: "war-rome-carthage" },
  ];
  const [start] = decodeWarUpdates("war-rome-carthage~start~Rome~Carthage~1~Declaration of war");
  const merge = applyWarUpdates({
    world: { polityOverrides: {}, wars: [] },
    updates: [{ ...start, eventIds: ["e2", "e1"] }],
    events,
    stopDate: "-0217-01-31",
    round: 2,
  });
  assert.equal(merge.wars[0].startedDate, "-0218-12-20", "218 BC comes before 217 BC");
});
