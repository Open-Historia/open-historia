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
  eventNarratesHardCombat,
  reconcileCombatWarState,
  repairWarLedgerPayload,
  splitWarStartNote,
  validatePregameWarBootstrap,
  validateWarLedgerPayload,
  warUpdateProseLines,
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

// Civil unrest can contain violence without being a canonical war. A riot or
// demonstration card must not enter the war ledger merely because the prose
// contains "clashes" or "killed".
test("street clashes are not canonical-war combat by vocabulary alone", () => {
  const riot = {
    id: "e1",
    date: "2014-05-02",
    title: "Tragic Clashes and Fire in Odessa",
    description: "Street clashes between rival demonstrators end with a building alight; dozens are killed.",
    kind: "world",
    combatants: [],
  };
  const candidate = { events: [riot], warUpdates: "" };
  assert.equal(eventNarratesHardCombat(riot), false);
  assert.deepEqual(reconcileCombatWarState(candidate, { world }).unresolved, []);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});


test("reported non-combat events do not trip canonical war detection", () => {
  const cases = [
    {
      kind: "diplomacy",
      title: "UN-Backed Syrian Peace Talks Open in Geneva Amid Procedural Disputes",
      description: "Delegates open negotiations after months of fighting while mediators argue over the agenda.",
      combatants: [],
    },
    {
      kind: "world",
      title: "UN Working Group Issues Opinion on Julian Assange's Detention",
      description: "A UN working group issues a legal opinion after a long political and legal battle over detention.",
      combatants: [],
    },
    {
      kind: "world",
      title: "UK Queen's Speech Outlines Brexit Legislative Agenda in Parliament",
      description: "The government sets out its legislative programme as parliamentary battles over Brexit continue.",
      combatants: ["United Kingdom"],
    },
    {
      kind: "world",
      title: "Venezuela Elects Controversial Constituent Assembly Amid Domestic Turmoil and Foreign Boycotts",
      description: "The vote proceeds amid protests and street clashes, but the event itself is an election rather than battlefield combat.",
      combatants: ["Venezuela"],
    },
    {
      kind: "military",
      title: "Unified Army Forms 1st and 2nd Mechanized Infantry Divisions with T-72B Tanks",
      description: "The army completes formation of two mechanized divisions and raises combat readiness without entering battle.",
      combatants: ["Sudan"],
    },
    {
      kind: "military",
      title: "Ansar Allah Engineering Units Complete Interlocking Tihama Coastal Defenses",
      description: "Engineering units complete fortifications designed to resist a possible amphibious assault; no attack occurs.",
      combatants: ["Yemen"],
    },
    {
      kind: "military",
      title: "Ansar Allah Initiates Comprehensive Operational Planning and Force Staging for Adan",
      description: "Commanders stage units and complete an assault plan for a possible future operation.",
      combatants: ["Yemen"],
    },
    {
      kind: "military",
      title: "Ansar Allah Fortifies Adan Northern Gateway and Establishes Kill Zones",
      description: "Engineering and defensive units fortify approaches and prepare kill zones for a possible future assault; no fighting occurs.",
      combatants: ["Yemen"],
    },
    {
      kind: "world",
      title: "Great March of Return Protests Begin Along Gaza Border",
      description: "Large demonstrations begin along the border while security forces deploy behind the fence.",
      combatants: [],
    },
    {
      kind: "world",
      title: "Clashes Persist Along Gaza Border Amid Great March of Return Demonstrations",
      description: "Demonstrators and security forces clash along the border during protests.",
      combatants: [],
    },
  ];

  for (const candidate of cases) {
    assert.equal(eventNarratesHardCombat(candidate), false, candidate.title);
    assert.equal(validateWarLedgerPayload({ events: [candidate], warUpdates: "" }, { world }), "", candidate.title);
  }
});

test("political and labour attack language is not battlefield combat", () => {
  const cases = [
    { kind: "world", title: "Opposition Launches Political Attack Against Government Budget", description: "Opposition leaders mount a sustained political attack against the cabinet's fiscal record." },
    { kind: "world", title: "Workers Strike Against Austerity Measures", description: "Transport unions begin a nationwide strike against planned wage cuts." },
    { kind: "world", title: "Rights Group Mounts Legal Assault on Detention Law", description: "Lawyers challenge the statute in court and describe the filing as a legal assault on the measure." },
  ];
  for (const event of cases) {
    assert.equal(eventNarratesHardCombat(event), false, event.title);
    assert.equal(validateWarLedgerPayload({ events: [event], warUpdates: "" }, { world }), "", event.title);
  }
});

test("direct battlefield actions still require canonical war state", () => {
  const cases = [
    {
      kind: "military",
      title: "Ansar Allah Launches Amphibious Assault on Mayyun Island Across Bab-el-Mandeb",
      description: "Amphibious forces assault the island's defended positions.",
      combatants: ["Yemen", "Southern Transitional Council"],
    },
    {
      kind: "world",
      title: "Syrian Army Advances in Northern Aleppo",
      description: "Syrian units launch concerted assaults on insurgent strongholds near Azaz.",
      combatants: ["Syria", "Syrian Opposition"],
    },
    {
      kind: "military",
      title: "Battle of the Frontiers",
      description: "French and German armies clash along the border.",
      combatants: ["France", "Germany"],
    },
  ];

  for (const candidate of cases) {
    assert.equal(eventNarratesHardCombat(candidate), true, candidate.title);
    assert.match(validateWarLedgerPayload({ events: [candidate], warUpdates: "" }, { world }), /no event\.warId/, candidate.title);
  }
});

// A player's log (a small local model answering in Russian): a month's
// warUpdates was a Markdown heading and a sentence saying nothing had changed,
// with the model's reminder to itself on the end. Each line was read as a war
// record with no operation: 'Unsupported warUpdates operation "" for ###
// Обновления войн:.', which on a strict pass refuses the answer and has the
// month asked for again. On the last attempt the salvage "dropped 2 war
// record(s)" by those "ids", which is how the sentence came to be quoted in
// the next prompt. Both lines are verbatim.
const PROSE_HEADING = "### Обновления войн:";
const PROSE_NOTHING_CHANGED = "Нет изменений. В этом периоде ни одна война не началась, не закончилась и не изменилась — на карте нет активных конфликтов. ### Конец обновлений. **ВАЖНО:** Отвечай ТОЛЬКО валидным JSON объектом без каких-либо объяснений, комментариев или предисловий. Не добавляй текст перед или после JSON.";

test("a line with no separator is prose, not a war record", () => {
  const warUpdates = `${PROSE_HEADING}\n${PROSE_NOTHING_CHANGED}`;
  assert.deepEqual(decodeWarUpdates(warUpdates), []);
  assert.deepEqual(decodeWarUpdates([PROSE_HEADING, PROSE_NOTHING_CHANGED]), [], "nor as members of a list");
  assert.deepEqual(warUpdateProseLines(warUpdates), [PROSE_HEADING, PROSE_NOTHING_CHANGED], "what was ignored can still be said");

  // The answer is not refused over them, so the month is not asked for twice.
  const quiet = () => ({
    events: [{ id: "e1", date: "2014-09-12", title: "Harvest comes in across the south", description: "Grain yields are above the five-year average.", kind: "economy" }],
    warUpdates,
  });
  assert.equal(validateWarLedgerPayload(quiet(), { world }), "");

  // The last attempt has nothing to drop, so nothing of them is quoted back.
  const candidate = quiet();
  const repair = repairWarLedgerPayload(candidate, { world });
  assert.deepEqual(repair.droppedIds, []);
  assert.equal(repair.residual, "");
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates), []);
});

test("prose around a real war record costs the record nothing", () => {
  const record = "war-france-germany-1914~start~Germany~France~1~Declaration of war";
  const candidate = { events: declaration(), warUpdates: `${PROSE_HEADING}\n${record}\n${PROSE_NOTHING_CHANGED}` };
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates).map((update) => [update.id, update.op]), [["war-france-germany-1914", "start"]]);
  assert.deepEqual(warUpdateProseLines(candidate.warUpdates), [PROSE_HEADING, PROSE_NOTHING_CHANGED]);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
  // Read as records, no single removal made the batch valid and the salvage
  // dropped every record of the segment, the declared war with them.
  const repair = repairWarLedgerPayload(candidate, { world });
  assert.deepEqual(repair.droppedIds, []);
  const merge = applyWarUpdates({ world, updates: candidate.warUpdates, events: candidate.events, stopDate: "1914-08-31", round: 2 });
  assert.deepEqual(merge.appliedIds, ["war-france-germany-1914"]);
});

test("a line with the separator and no real operation is still a record, and still refused", () => {
  const refused = (warUpdates) => validateWarLedgerPayload({ events: declaration(), warUpdates }, { world });
  assert.equal(refused("war-france-germany-1914~declare~Germany~France~1~Declaration of war"), 'Unsupported warUpdates operation "declare" for war-france-germany-1914.');
  assert.equal(refused("war-france-germany-1914~"), 'Unsupported warUpdates operation "" for war-france-germany-1914.');
  assert.deepEqual(warUpdateProseLines("war-france-germany-1914~\n\n   \nwar-a-b~end~~~1~peace"), [], "blank lines are not prose either");
});

// gameplay.js does not load under bare node, so its side is checked in its
// source: the ignored lines are said once per answer, and the receipt the next
// prompt opens with quotes dropped ids short (applicationReceipt.js).
test("the time skip says which lines it ignored, and its receipt quotes war ids short", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const validateSegmentLedgers = "), source.indexOf("const validateSegmentStorylines = "));
  assert.ok(body.indexOf("warUpdateProseLines(candidate?.warUpdates)") > 0, "read from the answer as it arrived");
  assert.ok(body.indexOf("warUpdateProseLines(candidate?.warUpdates)") < body.indexOf("reconcileCombatWarState(candidate"), "before the field is rewritten");
  assert.match(body, /War ledger: \$\{repair\.droppedIds\.length\} war record\(s\) were dropped`\s*\+ `\$\{repair\.droppedIds\.length \? ` \(\$\{quoteReceiptIds\(repair\.droppedIds\)\}\)` : ""\}/);
  assert.doesNotMatch(body, /noteReceipt\([^;]*droppedIds\.join/s, "never the ids as the model wrote them");
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
  assert.deepEqual(merge.wars.map((war) => `${war.title}: ${war.status}`).sort(), ["Syrian Civil War: active", "War against the Islamic State: active"]);
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
  // Two names and a report of ground retaken, and no record from the model:
  // reconcileCombatWarState asks its own question before it invents a war, and
  // the wider wording is not part of it.
  const retaken = ongoing("e1", "2016-01-02", "Iraqi Forces Secure Central Ramadi and Clear Anbar Pockets", "Government units retake the city centre and clear the last pockets in Anbar.", "", ["Iraq", "Islamic State"]);
  assert.equal(eventNarratesHardCombat(retaken), false);
  const candidate = { events: [retaken], warUpdates: "" };
  const outcome = quietly(() => reconcileCombatWarState(candidate, { world }));
  assert.equal(outcome.started, 0);
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates), []);
  // What the ledger itself calls hard combat between two named sides is the
  // engine's to open: a raid by troops on the other's posts.
  const raid = ongoing("e1", "1998-05-12", "Border Raid at Badme", "Ethiopian troops raided Eritrean posts at Badme and held them overnight.", "", ["Ethiopia", "Eritrea"]);
  assert.equal(eventNarratesHardCombat(raid), true);
  assert.equal(quietly(() => reconcileCombatWarState({ events: [raid], warUpdates: "" }, { world })).started, 1);
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
  // A riot is not a battle: "clashes" between demonstrators, with no force and
  // no two sides named, ask for no war at all.
  const riot = { id: "e2", date: "2016-02-27", title: "Tragic Clashes and Fire in Odessa", description: "Street clashes between rival demonstrators end with a building alight; dozens are killed.", kind: "world", warId: "", combatants: [] };
  assert.equal(validateWarLedgerPayload({ events: [strike, riot], warUpdates: start }, { world }), "");
  // Shelling nobody claims: fighting, and no war to put it in.
  const shelling = ongoing("e2", "2016-02-27", "Artillery Shells Fall on Kilis", "Shelling from across the border hits the town; nobody claims it.", "", []);
  const withShelling = { events: [strike, shelling], warUpdates: start };
  assert.match(validateWarLedgerPayload(withShelling, { world }), /no event\.warId/);
  const first = quietly(() => repairWarLedgerPayload(withShelling, { world }));
  assert.deepEqual(first.droppedIds, []);
  assert.equal(withShelling.events[0].warId, "war-yemen-2015");
  assert.match(first.residual, /Artillery Shells Fall on Kilis/, "the shelling is still what the ledger remarks on, and it is only logged");

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
