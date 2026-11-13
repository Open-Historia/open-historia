/*! Open Historia — canonical war ledger tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeWarIdsForPolity,
  applyWarUpdates,
  bindWarUpdatesToEvents,
  buildCanonicalWarContext,
  decodeWarUpdates,
  settleWarLedger,
  splitWarStartNote,
  validatePregameWarBootstrap,
  validateWarLedgerPayload,
  warUpdateProseLines,
} from "./nativeWarLedger.js";

// A war exists only because a record started it (the model's warUpdates, or
// the game's own rules), and it changes only by records: exercised end to end
// on the compact line transport the model emits. What an event says is never
// read to decide anything about a war.

const world = { polityOverrides: {}, wars: [] };

const declaration = () => [{
  id: "e1",
  date: "1914-08-03",
  title: "Germany declares war on France",
  description: "Berlin declares war on Paris after the ultimatum expires.",
  kind: "diplomacy",
  warId: "war-france-germany-1914",
}];

const PROSE_HEADING = "### Обновления войн:";
const PROSE_NOTHING_CHANGED = "Нет изменений. В этом периоде ни одна война не началась, не закончилась и не изменилась — на карте нет активных конфликтов.";

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

// A real-key test (2026-10-28): "Title: Franco-Italian War~Dispute over…" was kept whole as the name.
test("a war's name ends at a tilde or a bar as well as a semicolon", () => {
  assert.deepEqual(splitWarStartNote("Title: Franco-Italian War~Dispute over Nice"), { title: "Franco-Italian War", cause: "Dispute over Nice" });
  assert.deepEqual(splitWarStartNote("Title: Alpine War | Dispute over Nice"), { title: "Alpine War", cause: "Dispute over Nice" });
  const named = applyWarUpdates({
    world,
    updates: "war-france-germany-1914~start~Germany~France~1~Title: The Great War~The ultimatum to Paris expired",
    events: declaration(),
    stopDate: "1914-08-31",
    round: 2,
  });
  assert.equal(named.wars[0].title, "The Great War");
  assert.equal(named.wars[0].cause, "The ultimatum to Paris expired");
});

test("Round-Zero baseline wars do not require a duplicate historical event link", () => {
  for (const id of ["war-uac-apla", "sec-us-civil-war-apla", "russo-ukrainian-war"]) {
    const result = validatePregameWarBootstrap({
      world,
      updates: [{
        id,
        op: "start",
        actors: [id === "russo-ukrainian-war" ? "Russia" : "Union of America"],
        opponents: [id === "russo-ukrainian-war" ? "Ukraine" : "American People's Liberation Army"],
        eventIndexes: [],
        eventIds: [],
        baselineDate: id === "russo-ukrainian-war" ? "2022-02-24" : "2021-04-10",
        note: "Already active when Round One begins.",
      }],
      events: [{
        id: "history-1",
        date: "2021-01-01",
        title: "Background crisis deepens",
        description: "The timeline records important context without duplicating the war id.",
      }],
      startDate: "2026-01-01",
    });

    assert.equal(result.error, "", id);
    assert.deepEqual(result.warProbe.appliedIds, [id], id);
    assert.equal(result.warProbe.wars[0].startedDate, id === "russo-ukrainian-war" ? "2022-02-24" : "2021-04-10", id);
    assert.deepEqual(result.warProbe.wars[0].sourceEventIds, [], id);
  }
});

test("Round-Zero preserves historical war provenance when a matching event exists", () => {
  const events = [{
    id: "e-war",
    date: "2021-04-10",
    title: "Second American Civil War erupts",
    description: "Federal authority fractures as organized forces enter open conflict.",
    warId: "sec-us-civil-war-apla",
  }];
  const result = validatePregameWarBootstrap({
    world,
    updates: [{
      id: "sec-us-civil-war-apla",
      op: "start",
      actors: ["Union of America"],
      opponents: ["American People's Liberation Army"],
      eventIndexes: [0],
      eventIds: [],
      baselineDate: "2021-04-09",
      note: "Civil war begins.",
    }],
    events,
    startDate: "2021-07-18",
  });

  assert.equal(result.error, "");
  assert.equal(result.warProbe.wars[0].startedDate, "2021-04-10", "linked event date outranks fallback baseline metadata");
  assert.deepEqual(result.warProbe.wars[0].sourceEventIds, ["e-war"]);
});

test("Round-Zero does not fabricate the campaign start date for an undated unbound war", () => {
  const result = validatePregameWarBootstrap({
    world,
    updates: [{
      id: "war-unknown-start",
      op: "start",
      actors: ["A"],
      opponents: ["B"],
      eventIndexes: [],
      eventIds: [],
      baselineDate: "",
      note: "The conflict predates the campaign, but its exact start is unknown.",
    }],
    events: [],
    startDate: "2026-01-01",
  });

  assert.equal(result.error, "");
  assert.equal(result.warProbe.wars[0].startedDate, "");
  assert.equal(result.warProbe.wars[0].lastUpdatedDate, "");
});

test("Round-Zero still fails closed on invalid war baselines", () => {
  const noOpponent = validatePregameWarBootstrap({
    world,
    updates: [{ id: "w", op: "start", actors: ["A"], opponents: [], baselineDate: "2020-01-01" }],
    startDate: "2021-01-01",
  });
  assert.match(noOpponent.error, /invalid Round-One war lifecycle sequence/);

  const ended = validatePregameWarBootstrap({
    world,
    updates: [
      { id: "w", op: "start", actors: ["A"], opponents: ["B"], baselineDate: "2020-01-01" },
      { id: "w", op: "end", actors: [], opponents: [], baselineDate: "2020-06-01" },
    ],
    startDate: "2021-01-01",
  });
  assert.match(ended.error, /leaves w ended at Round One/);

  const future = validatePregameWarBootstrap({
    world,
    updates: [{ id: "w", op: "start", actors: ["A"], opponents: ["B"], baselineDate: "2022-01-01" }],
    startDate: "2021-01-01",
  });
  assert.match(future.error, /baseline date must be on or before the Round-One date/);

  const reversedDates = validatePregameWarBootstrap({
    world,
    updates: [
      { id: "w", op: "start", actors: ["A"], opponents: ["B"], baselineDate: "2020-06-01" },
      { id: "w", op: "ceasefire", actors: [], opponents: [], baselineDate: "2020-05-01" },
    ],
    startDate: "2021-01-01",
  });
  assert.match(reversedDates.error, /predates an earlier transition/);
});

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

test("a join goes against the opponents it names, whatever its letter says (#892)", () => {
  const atWar = { polityOverrides: {}, wars: [{ id: "war-ukraine", status: "active", sideA: ["Russia"], sideB: ["Ukraine"], startedDate: "2022-02-24" }] };
  const join = (record) => applyWarUpdates({ world: atWar, updates: decodeWarUpdates(record), events: [], stopDate: "2026-02-01", round: 3 }).wars[0];
  // The letter backwards: "join-a" with Russia, side A, named as the enemy.
  const backwards = join("war-ukraine~join-a~United Kingdom~Russia~~UK enters the war");
  assert.deepEqual(backwards.sideA, ["Russia"]);
  assert.deepEqual(backwards.sideB, ["Ukraine", "United Kingdom"]);
  // No opponents named: the letter is all there is.
  assert.deepEqual(join("war-ukraine~join-b~United Kingdom~~~").sideB, ["Ukraine", "United Kingdom"]);
  assert.deepEqual(join("war-ukraine~join-a~Belarus~~~").sideA, ["Russia", "Belarus"]);
  // Opponents on both sides say nothing: the letter again.
  assert.deepEqual(join("war-ukraine~join-a~Belarus~Ukraine,Russia~~").sideA, ["Russia", "Belarus"]);
});

test("the skip is told that a country pulled out of a war leaves it, and that history yields to the record", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /A country nobody plays that the story takes out of a war \(its forces pulled out under an accord, a separate peace, its last troops brought home\) leaves it in that event, with a leave record: without one it is still at war, and its troops stay on the battlefield and fight on\./);
  // (Never in a player's war, which the peace rules say no surrender ends: the two rules agree.)
  assert.match(gameplay, /The battle or surrender that ends a war between countries nobody plays carries its end record; a war a player fights ends only by a peace \(see \$\{PEACE_BLOCK_HEADING\} below\), so no battle in it tells its end\./);
  assert.doesNotMatch(gameplay, /The battle or surrender that ends a war carries its end record/);
  assert.match(gameplay, /History yields to this game's record: a war the ledger shows ended, or never opened, is fought by nobody/);
  assert.match(gameplay, /Events follow the record, not the history: no fighting in a war that ended here, and no siege or offensive where the game's lines do not put one\./);
  // And a war that has gone otherwise is told where the game has it (a player crushing Germany from Berlin was told of real 1941, 2026-11-10).
  assert.match(gameplay, /no campaign, siege, offensive or battle that real history had at this date is fought unless an account or the map puts fighting there, and a side whose capital or heartland its enemy holds is losing that war, whatever real history says of it\./);
});


// ---- the war foundations (the owner, 2026-11-13: "the entire war foundational
// archetecture is pretty weak") ------------------------------------------------

const settled = (candidate, warWorld = world) => quietly(() => settleWarLedger(candidate, { world: warWorld }));
const merged = (candidate, warWorld = world, round = 2) => quietly(() => applyWarUpdates({
  world: warWorld,
  updates: candidate.warUpdates,
  events: candidate.events,
  stopDate: "2030-12-31",
  round,
}));
const byId = (wars, id) => wars.find((war) => war.id === id);

// Nothing judges an event by its words: an English word list misread plain
// prose and could not read a game written in the player's language, and every
// misreading was a second request for the same period.
test("fighting told without a war is history, never a refusal, in any language", () => {
  for (const title of [
    "Army seizes the presidential palace in Niamey",
    "Troops clash with protesters in Tbilisi",
    "Police raid on cartel compound leaves twelve dead",
    "L'esercito occupa il palazzo presidenziale",
  ]) {
    const candidate = { events: [{ id: "e1", date: "2027-05-10", title, description: "", kind: "military" }], warUpdates: "" };
    assert.equal(validateWarLedgerPayload(candidate, { world }), "", title);
    const outcome = settled(candidate);
    assert.deepEqual(outcome.notes, [], title);
    assert.deepEqual(decodeWarUpdates(candidate.warUpdates), [], `${title}: no war made up from its words`);
  }
});

test("a war record opens its war whatever its event says, an exercise included", () => {
  for (const title of ["Strait Thunder drills end as the PLA shells the Kinmen garrison", "Esercitazione: l'artiglieria colpisce Kinmen", "Exercise Anakonda simulates an attack"]) {
    const candidate = {
      events: [{ id: "e1", date: "2027-04-02", title, description: "", kind: "military", warId: "war-china-taiwan-2027", combatants: ["China", "Taiwan"] }],
      warUpdates: "war-china-taiwan-2027~start~China~Taiwan~1~Title: Strait War",
    };
    assert.deepEqual(settled(candidate).notes, [], title);
    const wars = merged(candidate).wars;
    assert.equal(byId(wars, "war-china-taiwan-2027")?.status, "active", title);
  }
});

test("an event tagged with a war no record opens: two combatants open it; else only the tag goes", () => {
  const opened = {
    events: [{ id: "e1", date: "2027-05-10", title: "Estonia and Russia trade fire at Narva", description: "", kind: "military", warId: "war-estonia-russia-2027", combatants: ["Estonia", "Russia"] }],
    warUpdates: "",
  };
  assert.deepEqual(settled(opened).notes, []);
  const war = byId(merged(opened).wars, "war-estonia-russia-2027");
  assert.deepEqual([war.sideA, war.sideB], [["Estonia"], ["Russia"]]);

  const vague = {
    events: [{ id: "e1", date: "2027-05-10", title: "Insurgents ambush a convoy", description: "", kind: "military", warId: "war-insurgency", combatants: ["Mali"] }],
    warUpdates: "",
  };
  const outcome = settled(vague);
  assert.equal(vague.events[0].warId, "", "the tag naming no war is removed");
  assert.equal(vague.events[0].title, "Insurgents ambush a convoy", "and the event stays");
  assert.deepEqual(outcome.unbound, ["Insurgents ambush a convoy"]);
  assert.equal(outcome.notes[0].key, "warLinkRemoved");
  assert.equal(merged(vague).wars.length, 0);
});

test("fighting tagged with a war keeps its tag, and names only that war's belligerents; nobody is put in", () => {
  const atWar = { polityOverrides: {}, wars: [{ id: "w", status: "active", sideA: ["France", "Belgium"], sideB: ["Germany"], startedDate: "1914-08-03" }] };
  const candidate = {
    events: [
      { id: "e1", date: "1914-08-20", title: "Battle of the Frontiers", description: "", kind: "military", warId: "w", combatants: [] },
      { id: "e2", date: "1914-08-22", title: "Ardennes", description: "", kind: "military", warId: "w", combatants: ["France", "Germany", "Spain"] },
    ],
    warUpdates: "",
  };
  assert.deepEqual(settled(candidate, atWar).notes, []);
  assert.equal(candidate.events[0].warId, "w");
  assert.deepEqual(candidate.events[0].combatants, [], "no first member stands in for a side the event did not name");
  assert.deepEqual(candidate.events[1].combatants, ["France", "Germany"], "a polity outside the war is not its combatant");
});

const FIRST_WAR = {
  id: "war-a-b",
  title: "First Aland War",
  status: "ended",
  sideA: ["Aland"],
  sideB: ["Borduria"],
  startedDate: "1900-01-01",
  endedDate: "1901-06-01",
  lastUpdatedDate: "1901-06-01",
  sourceEventIds: ["e0"],
  createdRound: 1,
  updatedRound: 4,
};

test("a start under an ended war's id is a new war that renews it: the old war keeps its record", () => {
  const ended = { polityOverrides: {}, wars: [FIRST_WAR], peaceTreaties: [{ id: "treaty:war-a-b:1901", warId: "war-a-b" }] };
  const candidate = {
    events: [{ id: "e1", date: "1910-03-01", title: "Cisland attacks Borduria", description: "", kind: "military", warId: "war-a-b", combatants: ["Cisland", "Borduria"] }],
    warUpdates: "war-a-b~start~Cisland~Borduria~1~Title: Second Aland War; a border dispute",
  };
  assert.deepEqual(settled(candidate, ended).notes, []);
  assert.equal(candidate.events[0].warId, "war-a-b-r2", "the answer's events of the old id are the new war's");
  const wars = merged(candidate, ended, 9).wars;
  const first = byId(wars, "war-a-b");
  assert.deepEqual(
    [first.title, first.status, first.sideA, first.startedDate, first.endedDate, first.sourceEventIds],
    ["First Aland War", "ended", ["Aland"], "1900-01-01", "1901-06-01", ["e0"]],
    "the first war is never written over",
  );
  const second = byId(wars, "war-a-b-r2");
  assert.deepEqual([second.title, second.status, second.sideA, second.sideB, second.startedDate, second.renews], ["Second Aland War", "active", ["Cisland"], ["Borduria"], "1910-03-01", "war-a-b"]);

  // The ledger's own merge does the same for a caller that interprets nothing.
  const direct = quietly(() => applyWarUpdates({ world: ended, updates: "war-a-b~start~Cisland~Borduria~~again", events: [], stopDate: "1910-03-01", round: 9 }));
  assert.deepEqual(direct.appliedIds, ["war-a-b-r2"]);
  assert.equal(byId(direct.wars, "war-a-b").title, "First Aland War");
});

test("a record naming a war that was renewed means the renewal", () => {
  const renewed = { polityOverrides: {}, wars: [FIRST_WAR, { ...FIRST_WAR, id: "war-a-b-r2", title: "Second Aland War", status: "active", sideA: ["Cisland"], endedDate: "", renews: "war-a-b", startedDate: "1910-03-01" }] };
  const candidate = {
    events: [{ id: "e1", date: "1910-06-01", title: "Dorland enters the war", description: "", kind: "diplomacy", warId: "war-a-b" }],
    warUpdates: "war-a-b~join-a~Dorland~Borduria~1~Dorland joins Cisland",
  };
  assert.deepEqual(settled(candidate, renewed).notes, []);
  assert.equal(candidate.events[0].warId, "war-a-b-r2");
  const wars = merged(candidate, renewed, 10).wars;
  assert.deepEqual(byId(wars, "war-a-b-r2").sideA, ["Cisland", "Dorland"]);
  assert.deepEqual(byId(wars, "war-a-b").sideA, ["Aland"]);
  assert.match(buildCanonicalWarContext({ wars }, { round: 10 }), /- war-a-b-r2 \| ACTIVE \| SIDE A: Cisland, Dorland \| SIDE B: Borduria/);
});

test("a war that is over flares again as its renewal; what is already so is no error", () => {
  const ended = { polityOverrides: {}, wars: [FIRST_WAR] };
  const events = [{ id: "e1", date: "1905-01-01", title: "The guns speak again", description: "", warId: "war-a-b" }];
  const resumed = { events: events.map((event) => ({ ...event })), warUpdates: "war-a-b~resume~~~1~fighting resumes" };
  assert.deepEqual(settled(resumed, ended).notes, []);
  const wars = merged(resumed, ended, 7).wars;
  assert.deepEqual([byId(wars, "war-a-b-r2").sideA, byId(wars, "war-a-b-r2").sideB, byId(wars, "war-a-b-r2").renews], [["Aland"], ["Borduria"], "war-a-b"]);
  assert.equal(byId(wars, "war-a-b").status, "ended");

  const joined = { events: events.map((event) => ({ ...event })), warUpdates: "war-a-b~join-a~Iran~Azerbaijan~1~Iran declares war on Azerbaijan" };
  settled(joined, ended);
  const flared = merged(joined, ended, 7).wars.find((war) => war.renews === "war-a-b");
  assert.deepEqual([flared.sideA, flared.sideB], [["Iran"], ["Azerbaijan"]], "a join of a war that is over, against those it names, is that war flaring again");

  for (const record of ["war-a-b~end~~~1~peace", "war-a-b~ceasefire~~~1~truce", "war-a-b~leave~Aland~~1~out"]) {
    const candidate = { events: events.map((event) => ({ ...event })), warUpdates: record };
    assert.deepEqual(settled(candidate, ended).notes, [], record);
    assert.deepEqual(merged(candidate, ended, 7).wars.map((war) => [war.id, war.status]), [["war-a-b", "ended"]], record);
  }
});

test("an id given to a war being fought, for a war between others, is a war of its own; so is an id started twice", () => {
  const atWar = { polityOverrides: {}, wars: [{ id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "1910-01-01" }] };
  const reused = {
    events: [{ id: "e1", date: "1911-01-01", title: "Cisland invades Dorduria", description: "", kind: "military", warId: "war-1", combatants: ["Cisland", "Dorduria"] }],
    warUpdates: "war-1~start~Cisland~Dorduria~1~Title: Northern War",
  };
  assert.deepEqual(settled(reused, atWar).notes, []);
  const wars = merged(reused, atWar).wars;
  assert.deepEqual(byId(wars, "war-1").sideA, ["Aland"], "the war being fought keeps its sides");
  assert.deepEqual([byId(wars, "war-1-r2").sideA, byId(wars, "war-1-r2").sideB], [["Cisland"], ["Dorduria"]]);
  assert.deepEqual(reused.events[0].combatants, ["Cisland", "Dorduria"], "its event keeps its own belligerents");

  const twice = {
    events: [
      { id: "e1", date: "1911-01-01", title: "Aland declares war on Borduria", description: "", warId: "war-x" },
      { id: "e2", date: "1911-01-02", title: "Cisland declares war on Dorduria", description: "", warId: "war-x" },
    ],
    warUpdates: "war-x~start~Aland~Borduria~1~one\nwar-x~start~Cisland~Dorduria~2~two",
  };
  assert.deepEqual(settled(twice).notes, []);
  const pair = merged(twice).wars;
  assert.deepEqual(pair.map((war) => [war.id, war.sideA[0], war.sideB[0]]).sort(), [["war-x", "Aland", "Borduria"], ["war-x-r2", "Cisland", "Dorduria"]]);
  assert.deepEqual(twice.events.map((event) => event.warId), ["war-x", "war-x-r2"]);
});

test("an end with a mis-copied id is the one war its event's combatants fight", () => {
  const atWar = { polityOverrides: {}, wars: [{ id: "war-iraq-kuwait-1990", status: "active", sideA: ["Iraq"], sideB: ["Kuwait"], startedDate: "1990-08-02" }] };
  const candidate = {
    events: [{ id: "e1", date: "1991-03-03", title: "Iraq and Kuwait sign the Safwan accords", description: "", kind: "diplomacy", combatants: ["Iraq", "Kuwait"] }],
    warUpdates: "war-iraq-kuwiat-1990~end~~~1~peace at Safwan",
  };
  assert.deepEqual(settled(candidate, atWar).notes, []);
  assert.equal(byId(merged(candidate, atWar).wars, "war-iraq-kuwait-1990").status, "ended");
});

test("a war began no later than the earliest of its events the answer tells", () => {
  const candidate = {
    events: [
      { id: "e1", date: "2020-01-05", title: "First shots on the border", description: "", kind: "military", warId: "war-x", combatants: ["Aland", "Borduria"] },
      { id: "e2", date: "2020-01-10", title: "Aland declares war on Borduria", description: "", kind: "diplomacy", warId: "war-x" },
    ],
    warUpdates: "war-x~start~Aland~Borduria~2~Declaration",
  };
  settled(candidate);
  assert.equal(byId(merged(candidate).wars, "war-x").startedDate, "2020-01-05");
});

test("a coalition joins whole, member by member; records past one answer's 64 are left out and said", () => {
  const atWar = { polityOverrides: {}, wars: [{ id: "w", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1939-09-03" }] };
  const members = Array.from({ length: 20 }, (_, index) => `Ally ${String.fromCharCode(65 + index)}`);
  const candidate = {
    events: [{ id: "e1", date: "1940-01-01", title: "The allies come in", description: "", warId: "w" }],
    warUpdates: members.map((name) => `w~join-b~${name}~Germany~1~joins`).join("\n"),
  };
  assert.deepEqual(settled(candidate, atWar).notes, []);
  assert.equal(byId(merged(candidate, atWar).wars, "w").sideB.length, 21, "a 13th joiner used to be cut without a word, a 17th record before it was read");

  const flood = {
    events: [{ id: "e1", date: "1940-01-01", title: "Everyone joins", description: "", warId: "w" }],
    warUpdates: Array.from({ length: 70 }, (_, index) => `w~join-b~Member ${index}x~Germany~1~joins`).join("\n"),
  };
  const outcome = settled(flood, atWar);
  assert.match(outcome.notes[0].text, /6 war record\(s\) past the 64/);
  assert.equal(byId(merged(flood, atWar).wars, "w").sideB.length, 64, "a side holds at most 64 members");
});

test("an answer settled once is settled: run again, nothing changes and nothing is said", () => {
  const ended = { polityOverrides: {}, wars: [FIRST_WAR, { id: "w", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1939-09-03" }] };
  const candidate = {
    events: [
      { id: "e1", date: "1940-01-01", title: "Aland strikes again", description: "", warId: "war-a-b", combatants: ["Aland", "Borduria", "Spain"] },
      { id: "e2", date: "1940-01-02", title: "Italy joins", description: "", warId: "w" },
      { id: "e3", date: "1940-01-03", title: "A stray tag", description: "", warId: "war-nowhere" },
    ],
    warUpdates: "war-a-b~start~Aland~Borduria~1~again\nw~join-a~Italy~France~2~joins\nw~declare~X~Y~2~bad",
  };
  const first = settled(candidate, ended);
  assert.equal(first.dropped.length, 1, "the bad record is left out");
  assert.deepEqual(first.unbound, ["A stray tag"]);
  const once = JSON.stringify(candidate);
  const second = settled(candidate, ended);
  assert.deepEqual(second.notes, []);
  assert.equal(JSON.stringify(candidate), once);
});

test("the wars Modern Day opens from the fighting under way are kept, their non-state sides included", () => {
  const candidate = { events: [RAMADI(), ALEPPO()], warUpdates: `${IRAQ_START}\n${SYRIA_START}` };
  assert.deepEqual(settled(candidate).notes, []);
  const wars = merged(candidate).wars;
  assert.deepEqual(byId(wars, "war-iraq-isis-2014").sideB, ["Islamic State"]);
  assert.deepEqual(byId(wars, "war-syrian-civil-2011").sideA, ["Syria", "Russia"]);
});

test("the time skip settles its wars in one pass, never a retry, with its records tied to their events before any sort", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const validateSegmentLedgers = "), source.indexOf("const validateSegmentStorylines = "));
  assert.ok(body.includes("settleWarLedger(candidate, { world, authority: \"skip\" })"));
  for (const gone of ["reconcileCombatWarState", "repairWarLedgerPayload", "normalizeWorldWarEventLinks", "validateWarLedgerPayload", "eventNarratesHardCombat", "isolateUnsupportedWarReports"]) {
    assert.ok(!source.includes(gone), `${gone} is gone`);
  }
  // Every ledger is tied there, wars with them (ledgerPins.test.js).
  const pin = source.indexOf("pinSegmentLedgers(candidate, segmentIndex);");
  assert.ok(pin > 0 && pin < source.indexOf("sortTimelineEventsChronologically(candidate);", pin), "pinned before the answer is put in date order");
  assert.match(source, /and keep to it while that war lasts; a war that has ended keeps its id, and fighting between its sides that breaks out again is a new war, with a start record of its own\./);
});
test("a line with no separator is prose, not a war record, and costs the answer nothing", () => {
  const warUpdates = `${PROSE_HEADING}
${PROSE_NOTHING_CHANGED}`;
  assert.deepEqual(decodeWarUpdates(warUpdates), []);
  assert.deepEqual(decodeWarUpdates([PROSE_HEADING, PROSE_NOTHING_CHANGED]), [], "nor as members of a list");
  assert.deepEqual(warUpdateProseLines(warUpdates), [PROSE_HEADING, PROSE_NOTHING_CHANGED], "what was ignored can still be said");
  const quiet = { events: [{ id: "e1", date: "2014-09-12", title: "Harvest comes in across the south", description: "", kind: "economy" }], warUpdates };
  assert.equal(validateWarLedgerPayload(quiet, { world }), "");
  assert.deepEqual(settled(quiet).notes, []);
});

test("prose around a real war record costs the record nothing", () => {
  const record = "war-france-germany-1914~start~Germany~France~1~Declaration of war";
  const candidate = { events: declaration(), warUpdates: `${PROSE_HEADING}
${record}
${PROSE_NOTHING_CHANGED}` };
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates).map((update) => [update.id, update.op]), [["war-france-germany-1914", "start"]]);
  assert.deepEqual(settled(candidate).notes, []);
  assert.deepEqual(merged(candidate).wars.map((war) => war.id), ["war-france-germany-1914"]);
});

test("a line with the separator and no real operation is a record, left out and said", () => {
  const leftOut = (warUpdates) => validateWarLedgerPayload({ events: declaration(), warUpdates }, { world });
  assert.match(leftOut("war-france-germany-1914~declare~Germany~France~1~Declaration of war"), /Unsupported war operation "declare" for war-france-germany-1914\./);
  assert.match(leftOut("war-france-germany-1914~"), /missing id\/op/);
  assert.deepEqual(warUpdateProseLines("war-france-germany-1914~\n\n   \nwar-a-b~end~~~1~peace"), [], "blank lines are not prose either");
});

test("a record with no id is named for what it is, never for its place among the lines", () => {
  const atWar = { polityOverrides: {}, wars: [{ id: "war-0", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "1900-01-01" }] };
  const [update] = decodeWarUpdates("~end~~~1~peace");
  assert.notEqual(update.id, "war-0", "an id-less end used to end whichever war was war-0");
  const candidate = { events: [{ id: "e1", date: "1901-01-01", title: "Peace", description: "" }], warUpdates: "~end~~~1~peace" };
  settled(candidate, atWar);
  assert.equal(byId(merged(candidate, atWar).wars, "war-0").status, "active");
});
