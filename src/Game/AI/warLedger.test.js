/*! Open Historia — canonical war ledger tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  activeWarIdsForPolity,
  applyWarUpdates,
  buildCanonicalWarContext,
  decodeWarUpdates,
  eventNarratesHardCombat,
  reconcileCombatWarState,
  repairWarLedgerPayload,
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

// A player's Modern Day game (2016). That scenario starts with no war on
// record, so the wars in Syria and Iraq are opened by the model from whichever
// of their battles it writes first, as the prompt tells it to. The turn's log:
// "dropped 2 war record(s) (war-iraq-isis-2014, war-syrian-civil-2011), unbound
// 4 event(s) … cannot create a canonical war from "Iraqi Forces Secure Central
// Ramadi and Clear Anbar Pockets" … The ledger still says: Combat event "Syrian
// and Russian Forces Advance North of Aleppo" has no event.warId." The two
// titles and the two ids are the log's; the log holds no more of the turn, so
// the descriptions are plain reporting of the same two operations.
const ongoing = (id, date, title, description, warId, combatants, kind = "military") => ({ id, date, title, description, kind, warId, combatants });
const RAMADI = () => ongoing("e1", "2016-01-04", "Iraqi Forces Secure Central Ramadi and Clear Anbar Pockets",
  "Iraqi security forces, backed by coalition air power, secured the government complex in central Ramadi and cleared the remaining Islamic State pockets across Anbar province.",
  "war-iraq-isis-2014", ["Iraq", "Islamic State"]);
const ALEPPO = () => ongoing("e2", "2016-02-03", "Syrian and Russian Forces Advance North of Aleppo",
  "Syrian government troops backed by Russian aircraft took Nubl and Zahraa north of Aleppo, cutting the opposition's supply corridor to Turkey.",
  "war-syrian-civil-2011", ["Syria", "Russia", "Syrian Opposition"]);
const IRAQ_START = "war-iraq-isis-2014~start~Iraq~Islamic State~1~title: War against the Islamic State; the campaign to retake Anbar";
const SYRIA_START = "war-syrian-civil-2011~start~Syria,Russia~Syrian Opposition~2~title: Syrian Civil War; the government's Aleppo offensive";
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

test("a war already under way is opened on a report of its fighting", () => {
  const events = [RAMADI(), ALEPPO()];
  // Neither is a battle by the ledger's own word lists, which is why each was
  // refused: an event had to hold one of those words to open a war.
  assert.equal(eventNarratesHardCombat(events[0]), false);
  assert.equal(eventNarratesHardCombat(events[1]), false);
  const candidate = { events, warUpdates: `${IRAQ_START}\n${SYRIA_START}` };
  assert.equal(validateWarLedgerPayload(candidate, { world }), "", "both starts are accepted as written, with no second request");

  const merge = applyWarUpdates({ world, updates: decodeWarUpdates(candidate.warUpdates), events, stopDate: "2016-02-29", round: 1 });
  assert.deepEqual(merge.appliedIds, ["war-iraq-isis-2014", "war-syrian-civil-2011"]);
  assert.deepEqual(merge.wars.map((war) => `${war.id}: ${war.status}`).sort(), ["war-iraq-isis-2014: active", "war-syrian-civil-2011: active"]);
  assert.deepEqual(merge.wars.find((war) => war.id === "war-syrian-civil-2011").sideA, ["Syria", "Russia"]);
});

test("what the ledger calls hard combat can open the war it is told it needs", () => {
  // A military event that "raids" must belong to an active war, and until now
  // could not open one: whatever the model answered for it was refused.
  const raid = ongoing("e1", "1998-05-12", "Border Raid at Badme", "Ethiopian troops raided Eritrean posts at Badme and held them overnight.", "war-eritrea-ethiopia-1998", ["Ethiopia", "Eritrea"]);
  assert.equal(eventNarratesHardCombat(raid), true);
  const candidate = { events: [raid], warUpdates: "war-eritrea-ethiopia-1998~start~Ethiopia~Eritrea~1~title: Eritrean–Ethiopian War; the dispute over Badme" };
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});

test("a deployment, an exercise or a charm offensive still opens no war, whatever record is put on it", () => {
  const refused = (title, description, kind = "military") => {
    const candidate = {
      events: [ongoing("e1", "2016-03-01", title, description, "war-poland-belarus-2016", ["Poland", "Belarus"], kind)],
      warUpdates: "war-poland-belarus-2016~start~Poland~Belarus~1~title: A war nobody is fighting",
    };
    return validateWarLedgerPayload(candidate, { world });
  };
  assert.match(refused("Polish 18th Division Deploys to the Suwalki Gap", "Warsaw moves a mechanised division to the border and raises readiness."), /cannot create a canonical war/);
  assert.match(refused("Anakonda Exercise Simulates an Attack on the Suwalki Gap", "A training attack by two brigades; attack helicopters and main battle tanks take part in the drill."), /cannot create a canonical war/);
  assert.match(refused("Warsaw Launches a Diplomatic Offensive Over the Border", "Envoys tour European capitals.", "diplomacy"), /cannot create a canonical war/);
  assert.match(refused("Combat Battlegroup Arrives at Orzysz", "A NATO combat battlegroup takes up its barracks."), /cannot create a canonical war/);
  assert.match(refused("Army Declares Its Brigades Ready for Offensive Operations", "The general staff reports full offensive capability on the front line."), /cannot create a canonical war/);
  assert.match(refused("Allied Forces Push East to Reassure the Baltic States", "Two battalions take up positions near the border."), /cannot create a canonical war/);
});

test("the engine still makes up no war of its own from the wider wording", () => {
  // Two names and a raid, and no record from the model: reconcileCombatWarState
  // asks the narrow question it always asked before it invents a war.
  const raid = ongoing("e1", "1998-05-12", "Border Raid at Badme", "Ethiopian troops raided Eritrean posts at Badme and held them overnight.", "", ["Ethiopia", "Eritrea"]);
  const candidate = { events: [raid], warUpdates: "" };
  const outcome = quietly(() => reconcileCombatWarState(candidate, { world }));
  assert.equal(outcome.started, 0);
  assert.equal(outcome.unresolved.length, 1);
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates), []);
});

test("the last attempt's repair drops a war at a time: a refused start costs its own war only", () => {
  // The Iraqi start sits on an event that narrates no fighting at all, and the
  // Syrian one is sound. Every record of the turn used to go.
  const budget = ongoing("e1", "2016-01-04", "Iraqi Parliament Approves an Emergency War Budget", "Baghdad votes the army another year of funding.", "war-iraq-isis-2014", [], "politics");
  const candidate = { events: [budget, ALEPPO()], warUpdates: `${IRAQ_START}\n${SYRIA_START}` };
  assert.match(validateWarLedgerPayload(candidate, { world }), /war-iraq-isis-2014 \(start\) cannot create a canonical war/);
  const repair = quietly(() => repairWarLedgerPayload(candidate, { world }));
  assert.deepEqual(repair.droppedIds, ["war-iraq-isis-2014"]);
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates).map((update) => update.id), ["war-syrian-civil-2011"]);
  assert.equal(repair.strippedEvents, 1);
  assert.equal(candidate.events[0].warId, "", "the budget vote is narrative");
  assert.equal(candidate.events[1].warId, "war-syrian-civil-2011", "the advance is still the Syrian war's");
  assert.equal(repair.residual, "");
});

test("the repair keeps a sound war beside an event the ledger cannot place", () => {
  const strike = ongoing("e1", "2016-02-25", "Saudi Aircraft Bombard Houthi Positions Around Sanaa", "Coalition aircraft bombarded Houthi positions around Sanaa in the heaviest air strikes of the month.", "war-yemen-2015", ["Saudi Arabia", "Houthis"]);
  const start = "war-yemen-2015~start~Saudi Arabia~Houthis~1~title: Yemeni Civil War; the coalition's air campaign";
  // A riot that reads like a battle and belongs to no war.
  const riot = { id: "e2", date: "2016-02-27", title: "Tragic Clashes and Fire in Odessa", description: "Street clashes between rival demonstrators end with a building alight; dozens are killed.", kind: "world", warId: "", combatants: [] };
  const withRiot = { events: [strike, riot], warUpdates: start };
  assert.match(validateWarLedgerPayload(withRiot, { world }), /no event\.warId/);
  const first = quietly(() => repairWarLedgerPayload(withRiot, { world }));
  assert.deepEqual(first.droppedIds, []);
  assert.equal(withRiot.events[0].warId, "war-yemen-2015");
  assert.match(first.residual, /Tragic Clashes and Fire in Odessa/, "the riot is still what the ledger remarks on, and it is only logged");

  // A battle of the war that names one side only: the war's record applies,
  // so the war is kept, and the remark is about the battle.
  const oneSided = ongoing("e2", "2016-03-02", "Coalition Aircraft Bombard Taiz", "A second week of bombardment of the city.", "war-yemen-2015", ["Saudi Arabia"]);
  const withOneSided = { events: [strike, oneSided], warUpdates: start };
  assert.match(validateWarLedgerPayload(withOneSided, { world }), /at least the two opposing belligerent/);
  const second = quietly(() => repairWarLedgerPayload(withOneSided, { world }));
  assert.deepEqual(second.droppedIds, []);
  assert.deepEqual(decodeWarUpdates(withOneSided.warUpdates).map((update) => update.id), ["war-yemen-2015"]);
  assert.equal(withOneSided.events[1].warId, "war-yemen-2015");
  assert.match(second.residual, /Coalition Aircraft Bombard Taiz/);
});

test("the repair drops a join that cannot be made and keeps the war it was joining", () => {
  const strike = ongoing("e1", "2016-02-25", "Saudi Aircraft Bombard Houthi Positions Around Sanaa", "Coalition aircraft bombarded Houthi positions around Sanaa.", "war-yemen-2015", ["Saudi Arabia", "Houthis"]);
  const entry = ongoing("e2", "2016-03-01", "Egypt Joins the War in Yemen", "Cairo enters the war beside Riyadh.", "war-yemen-2015", []);
  const candidate = {
    events: [strike, entry],
    // The join names a polity that is already on the other side.
    warUpdates: "war-yemen-2015~start~Saudi Arabia~Houthis~1~title: Yemeni Civil War\nwar-yemen-2015~join-b~Saudi Arabia~~2~",
  };
  assert.match(validateWarLedgerPayload(candidate, { world }), /already on the opposing side/);
  const repair = quietly(() => repairWarLedgerPayload(candidate, { world }));
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates).map((update) => `${update.id}:${update.op}`), ["war-yemen-2015:start"]);
  assert.deepEqual(repair.droppedIds, ["war-yemen-2015"]);
  assert.equal(repair.strippedEvents, 0);
});
