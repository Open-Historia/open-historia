/*! Open Historia — native world integrity screen tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildNativeWorldExplorationSlate,
  createWorldActorResolver,
  createWorldEventScopeClassifier,
  deferredStorylineReentryHasConcreteTrigger,
  deriveWorldExplorationAudit,
  screenGeneratedWorldEvents,
  validateWorldExplorationAudit,
} from "./nativeWorldIntegrity.js";

const quietly = (run) => {
  const { info, warn } = console;
  console.info = () => {};
  console.warn = () => {};
  try {
    return run();
  } finally {
    console.info = info;
    console.warn = warn;
  }
};

// A large map: two hundred polities, each with two aliases.
const bigWorld = () => {
  const names = Array.from({ length: 200 }, (_, i) => `Polity Number ${i} Republic`);
  return {
    names,
    world: {
      polityOverrides: Object.fromEntries(names.map((name, i) => [name, {
        code: name,
        name,
        aliases: [`Land${i}`, `Realm ${i}`],
        status: "active",
      }])),
      wars: [{ id: "war-1-2", status: "active", sideA: [names[1]], sideB: [names[2]] }],
      storylines: [],
      projects: [],
    },
  };
};

test("the resolver finds the same polities by alias as by name, whole words only", () => {
  const { world, names } = bigWorld();
  const resolver = createWorldActorResolver(world, names[0]);
  assert.deepEqual(resolver.mentionedPolities("Land3 and Realm 4 meet; Land33x does not."), [names[3], names[4]]);
  assert.equal(resolver.mentions(names[5], "Talks in Land5 continue."), true);
  assert.equal(resolver.mentions(names[5], "Talks in Land55 continue."), false);
  // An alias given as the actor is matched as itself, not widened to its polity.
  assert.equal(resolver.mentions("Land6", "Realm 6 votes."), false);
});

test("the scope classifier reads mentions through its one resolver", () => {
  const { world, names } = bigWorld();
  const classify = createWorldEventScopeClassifier(null, { world, gameCountry: names[0] });
  assert.equal(classify({ title: "Land0 opens a port", description: "" }), "player-sphere");
  assert.equal(classify({ title: "Land9 opens a port", description: "" }), "wider-world");
  assert.equal(classify({ title: "A port opens", description: "" }), "unknown");
});

test("screening a segment on a two-hundred-polity map takes well under a few seconds", () => {
  const { world, names } = bigWorld();
  const events = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    date: "2014-07-01",
    title: `Land${i} Faces Fuel Rationing`,
    description: `Wartime rationing and war economy shortages hit Land${i} and Realm ${i + 1}.`,
    importance: "major",
  }));
  const analysis = {
    explorationSlate: Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      type: i < 5 ? "actor-domain" : "global",
      scope: i < 3 ? "player-sphere" : "wider-world",
      actor: names[i * 7],
      domain: "diplomacy",
    })),
  };

  const started = performance.now();
  const screened = quietly(() => screenGeneratedWorldEvents({
    events,
    world,
    game: { country: names[0] },
    actions: [],
    analysis,
  }));
  deriveWorldExplorationAudit({ events }, analysis, { world, gameCountry: names[0] });
  const elapsed = performance.now() - started;

  // Before the resolver was shared this took over ten seconds.
  assert.ok(elapsed < 3000, `took ${Math.round(elapsed)} ms`);
  // Every homefront stands: no word list reads an event for the war (the
  // belligerents' own used to survive a rationing rule read from English words).
  assert.equal(screened.events.length, events.length);
});

// --- The player's sovereign choices belong to the player ---

const latviaWorld = {
  polityOverrides: {
    "Republic of Latvia": { code: "Republic of Latvia", name: "Republic of Latvia", aliases: ["Latvia"], status: "active" },
    "Republic of Estonia": { code: "Republic of Estonia", name: "Republic of Estonia", aliases: ["Estonia"], status: "active" },
    "Russian Federation": { code: "Russian Federation", name: "Russian Federation", aliases: ["Russia"], status: "active" },
  },
  institutions: { byId: {} },
  wars: [],
  storylines: [],
  projects: [],
};
const latviaGame = { country: "Republic of Latvia", gameDate: "2014-06-20" };
const latviaEvent = (title, description, extra = {}) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  date: "2014-07-01",
  title,
  description,
  importance: "major",
  playerRelated: true,
  ...extra,
});
const screenLatvia = (events, extra = {}) => quietly(() => screenGeneratedWorldEvents({
  events,
  world: latviaWorld,
  game: latviaGame,
  actions: [],
  chats: [],
  ...extra,
}));

// The rule is logged, not enforced, until its verdicts prove precise: every
// event stays, and the ones it would withhold are marked.
const wouldWithhold = (screened) => screened.playerVerdicts
  .filter((verdict) => verdict.wouldWithhold)
  .map((verdict) => verdict.reason);

// A war record of the answer, tied to its event: `actors` start it.
const warRecord = (eventId, actors, opponents) => ({
  id: "baltic-war",
  op: "start",
  actors,
  opponents,
  eventIds: [eventId],
  eventIndexes: [0],
  note: "Baltic War",
});

test("the world declaring war for the player's country is marked to be withheld", () => {
  const war = latviaEvent("Latvia Declares War on Russia", "Latvia declares war on Russia.");
  const screened = screenLatvia([war], { warUpdates: [warRecord(war.id, ["Republic of Latvia"], ["Russian Federation"])] });
  assert.deepEqual(wouldWithhold(screened), ["player-fresh-sovereign-choice-without-authority"]);
  assert.equal(screened.events.length, 1, "logged only, so the event stays");
  assert.deepEqual(screened.dropped, []);
  // Without the record nothing the event carries says Latvia chose it: its
  // words alone never decide that.
  assert.deepEqual(wouldWithhold(screenLatvia([war])), []);
});

test("the world acting on the player's country is never marked, even when the title opens with it", () => {
  const attack = latviaEvent("Latvia Comes Under Attack as Russia Declares War", "Russia declares war on Latvia and its forces cross the border.", { combatants: ["Russian Federation", "Republic of Latvia"] });
  const screened = screenLatvia([
    latviaEvent("Russia Declares War on Latvia", "Russia declares war on Latvia.", { combatants: ["Russian Federation", "Republic of Latvia"] }),
    attack,
    latviaEvent("Latvia Hit as Russia Imposes Sanctions", "Russia imposes sanctions on Latvian food exports."),
  ], { warUpdates: [warRecord(attack.id, ["Russian Federation"], ["Republic of Latvia"])] });
  assert.equal(screened.events.length, 3);
  assert.deepEqual(screened.dropped, []);
  // The side a war is started on chose nothing; nor does a title that opens
  // with the player's country make it the one choosing.
  assert.deepEqual(wouldWithhold(screened), []);
});

// A player's report: a world event was filed "Not recorded: the game could
// not tell it was your government's order". It named the player's country
// beside words that sound like a decision, and carried nothing of the
// player's: no actor, no operation, no record, no order.
test("a world event naming the player's country with decision-sounding words is recorded", () => {
  const events = [
    latviaEvent(
      "Estonian Parliament Approves Joint Air Policing With Latvia",
      "The Estonian government approves a new bilateral defence agreement and orders fighter aircraft to patrol Latvian airspace; Latvia's government is said to welcome the deployment.",
      { playerRelated: false },
    ),
    latviaEvent(
      "Latvia's Neighbours Sign Sanctions Pact",
      "The governments of Estonia and Russia sign an agreement imposing new sanctions; Latvia's cabinet declares a national state of emergency, observers say.",
      { playerRelated: false },
    ),
  ];
  const screened = screenLatvia(events);
  assert.deepEqual(screened.dropped, []);
  assert.equal(screened.events.length, 2);
  assert.deepEqual(wouldWithhold(screened), []);
  // (sharedGameAgency.test.js: and where a shared game holds the boundary hard.)
});

test("the player's own order authorizes the same choice", () => {
  const actions = [{ id: "act-war", status: "planned", text: "Declare war on Russia" }];
  const screened = screenLatvia([latviaEvent("Latvia Declares War on Russia", "Latvia declares war on Russia.")], { actions });
  assert.equal(screened.events.length, 1);
  assert.equal(screened.events[0].agency.authority, "player-order");
  assert.deepEqual(screened.playerVerdicts, []);
});

test("an event citing a queued order is not marked even when it overreaches the order", () => {
  const actions = [{ id: "act-border", status: "planned", text: "Strengthen the eastern border" }];
  const screened = screenLatvia([latviaEvent(
    "Latvia Mobilizes Reservists",
    "Latvia announces a general mobilization of reservists.",
    { impacts: { actionIds: ["act-border"] } },
  )], { actions });
  assert.equal(screened.events.length, 1);
  assert.deepEqual(screened.events[0].impacts.actionIds, ["act-border"]);
  assert.deepEqual(wouldWithhold(screened), []);
});

test("the player's own message in a chat authorizes the treaty it agreed", () => {
  const chats = [{
    id: "chat-estonia",
    messages: [{
      id: "msg-latvia",
      role: "user",
      speaker: "Republic of Latvia",
      text: "Latvia will sign the border demarcation treaty with Estonia next month.",
    }],
  }];
  const treaty = latviaEvent(
    "Latvia Signs Border Demarcation Treaty With Estonia",
    "Latvia signs the border demarcation treaty with Estonia in Riga.",
  );
  const agreementUpdates = [pactRecord(treaty.id, ["Republic of Latvia", "Republic of Estonia"])];
  assert.equal(wouldWithhold(screenLatvia([treaty], { agreementUpdates })).length, 1, "without the chat nothing authorizes it");
  const screened = screenLatvia([treaty], { chats, agreementUpdates });
  assert.equal(screened.events.length, 1);
  assert.equal(screened.events[0].agency.authority, "player-commitment");
  assert.equal(screened.events[0].agency.authorityRef, "msg-latvia");
  assert.deepEqual(screened.playerVerdicts, []);
});

test("another power's sovereign act that only names the player's country stays unmarked", () => {
  const screened = screenLatvia([
    latviaEvent("NATO Deploys Battalion to Latvia", "NATO deploys a multinational battalion to Latvia."),
    latviaEvent("Russia Deploys Troops Near the Latvia Border", "Russia deploys troops near the border."),
  ]);
  assert.equal(screened.events.length, 2);
  assert.deepEqual(screened.dropped, []);
  assert.deepEqual(wouldWithhold(screened), []);
});

// --- The parties of a treaty are who signed it ---

const pactRecord = (eventId, parties) => ({
  id: "baltic-pact",
  op: "start",
  type: "mutual_defense",
  parties,
  eventIds: [eventId],
  eventIndexes: [0],
  title: "Baltic Defence Pact",
});

test("a treaty's agreement record makes the player a signatory even when another state heads the title", () => {
  const pact = latviaEvent("Estonia Signs Defence Pact With Latvia", "Estonia and Latvia sign a mutual defence pact in Tallinn.");
  const withoutRecord = screenLatvia([pact]);
  assert.deepEqual(wouldWithhold(withoutRecord), [], "read from the title alone, Estonia signed it");

  const screened = screenLatvia([pact], {
    agreementUpdates: [pactRecord(pact.id, ["Republic of Estonia", "Republic of Latvia"])],
  });
  assert.deepEqual(wouldWithhold(screened), ["joint-player-sovereign-choice-without-authority"]);
  assert.equal(screened.events.length, 1);
});

test("a treaty between two other states names both as sovereign actors and no one else", () => {
  const pact = latviaEvent(
    "Estonia and Russia Sign Border Treaty",
    "Estonia and Russia sign a border treaty, a move watched closely in Latvia.",
    { playerRelated: false },
  );
  const screened = screenLatvia([pact], {
    agreementUpdates: [pactRecord(pact.id, ["Republic of Estonia", "Russian Federation"])],
  });
  assert.equal(screened.events.length, 1);
  assert.deepEqual(
    screened.events[0].agency.sovereignActors.map((row) => [row.polity, row.authority]),
    [["Republic of Estonia", "autonomous"], ["Russian Federation", "autonomous"]],
  );
  assert.equal(screened.events[0].actors, undefined, "derived actors are never stored on the event");
});

// --- The screen's own regression cases (once an in-bundle self-test) ---

const empireWorld = {
  polityOverrides: {
    DEU: { code: "German Empire", name: "German Empire", aliases: ["Germany"] },
    POL: { code: "Poland", name: "Poland", aliases: [] },
    RUS: { code: "Russian Empire", name: "Russian Empire", aliases: ["Russia"] },
    "Austrian Empire": { code: "Austrian Empire", name: "Austria-Hungary", aliases: ["Austria-Hungary"] },
  },
  regionClaimants: { "reg-masovia": ["Russian Empire"] },
  wars: [{ id: "polish-war", status: "active", sideA: ["Poland"], sideB: ["Russian Empire"] }],
};
const empireGame = { country: "German Empire", gameDate: "1916-03-01", round: 1 };
const empireEvent = (title, description, impacts = {}) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  title,
  description,
  impacts: {
    regionTransfers: [],
    regionControlOps: [],
    polityChanges: [],
    unitOps: [],
    markerOps: [],
    createdChats: [],
    ...impacts,
  },
});
const screenEmpire = (event) => quietly(() => screenGeneratedWorldEvents({ events: [event], world: empireWorld, game: empireGame }));

// A homefront under war conditions used to be rejected, for English words
// (WAR_DEPENDENT_HOMEFRONT_RE), when the ledger as it stood BEFORE the segment
// had its polity at peace, which refused "Poland introduces wartime rationing"
// in the very segment that opened Poland's war; its twin in any other language
// went through. Who lives under war conditions is the war ledger's rule, told to
// the skip (gameplay.js warLedgerRules), and no word decides it.
test("a homefront under war conditions is kept as written, in English or not", () => {
  for (const [title, description] of [
    ["German Wartime Rationing Continues", "Germany expands its wartime rationing as shortages deepen."],
    ["Deutsche Kriegsrationierung geht weiter", "Deutschland weitet seine Kriegsrationierung aus, während sich die Engpässe verschärfen."],
  ]) {
    const screened = screenEmpire(empireEvent(title, description));
    assert.deepEqual(screened.events.map((event) => event.title), [title]);
    assert.deepEqual(screened.dropped, []);
  }
});

test("a polity's rationing in the segment that opens its war is kept", () => {
  const atPeace = { ...empireWorld, wars: [] };
  const opening = empireEvent("Russia Declares War on Poland", "Russian troops cross the Polish border.");
  const rationing = empireEvent("Poland introduces wartime rationing", "Warsaw rations bread and fuel as the army mobilises.");
  const screened = quietly(() => screenGeneratedWorldEvents({
    events: [opening, rationing],
    world: atPeace,
    game: empireGame,
    warUpdates: [{ id: "war-russia-poland", op: "start", actors: ["Russian Empire"], opponents: ["Poland"], eventIds: [opening.id], eventIndexes: [] }],
  }));
  assert.deepEqual(screened.events.map((event) => event.title), [opening.title, rationing.title]);
  assert.deepEqual(screened.dropped, []);
});

test("preparing for a possible war stays legal", () => {
  const screened = screenEmpire(empireEvent(
    "Germany Tests Wartime Food Reserves",
    "German officials simulate wartime ration allocations for a potential future conflict.",
  ));
  assert.equal(screened.events.length, 1);
});

// Hidden as routine for English words (ROUTINE_MILITARY_CUE_RE), and kept in
// any other language. The skip is told to leave out fire that changed nothing
// (FOLDED_SKIP_CONSEQUENCES); what it writes, the screen keeps.
test("routine artillery is kept as written, as its twin in another language is", () => {
  for (const [title, description] of [
    ["Russian Artillery Bombardment Outside Warsaw", "Russian artillery resumes bombardment and localized probing outside Warsaw."],
    ["Rosyjski ostrzał artyleryjski pod Warszawą", "Rosyjska artyleria wznawia ostrzał i lokalne rozpoznanie pod Warszawą."],
  ]) {
    const screened = screenEmpire(empireEvent(title, description));
    assert.deepEqual(screened.events.map((event) => event.title), [title]);
    assert.deepEqual(screened.hidden, []);
  }
});

test("a breakthrough with a control consequence survives", () => {
  const screened = screenEmpire(empireEvent(
    "Russian Forces Break Through Outside Warsaw",
    "Russian forces break through and capture the outer defensive belt.",
    { regionControlOps: [{ op: "control", regionId: "Warsaw", fromCode: "Poland", toCode: "Russian Empire" }] },
  ));
  assert.equal(screened.events.length, 1);
});

test("a process-only polity update is stripped and the event kept", () => {
  const screened = screenEmpire(empireEvent(
    "Reichstag Reviews Food Policy",
    "The Reichstag debates food policy without adopting a measure.",
    { polityChanges: [{ operation: "update", code: "German Empire", stats: { stability: 82 } }] },
  ));
  assert.equal(screened.events.length, 1);
  assert.equal(screened.strippedPolityUpdates, 1);
});

test("same-lineage polity updates merge before persistence", () => {
  const screened = screenEmpire(empireEvent(
    "Austro-Hungarian Ministry Reports Severe Fiscal Strain",
    "The finance ministry reports severe fiscal strain and a material stability decline.",
    {
      polityChanges: [
        { operation: "update", code: "Austria-Hungary", stats: { stability: 43, economy: { inflation: "13%" } } },
        { operation: "update", code: "Austrian Empire", stats: { stability: 43, economy: { budgetBalance: "-16% GDP" } } },
      ],
    },
  ));
  assert.equal(screened.events.length, 1);
  assert.equal(screened.mergedDuplicatePolityUpdates, 1);
  const changes = screened.events[0].impacts.polityChanges;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].stats.stability, 43);
  assert.equal(changes[0].stats.economy.inflation, "13%");
  assert.equal(changes[0].stats.economy.budgetBalance, "-16% GDP");
});

test("a contest the map already has is stripped as a no-op, and the event stays as written", () => {
  const screened = screenEmpire(empireEvent(
    "Russian Artillery Probe in Masovia",
    "Russian artillery resumes localized probing in Masovia; Polish positions remain unchanged.",
    { regionControlOps: [{ op: "contest", regionId: "reg-masovia", regionName: "Masovia", fromCode: "Poland", actorCode: "Russian Empire" }] },
  ));
  assert.equal(screened.strippedNoOpRegionControlOps, 1);
  assert.equal(screened.events.length, 1);
  assert.deepEqual(screened.events[0].impacts.regionControlOps, []);
  assert.deepEqual(screened.dropped, []);
});

const deferredPrior = {
  id: "storyline-deferred-motion-test",
  status: "active",
  pressure: 78,
  momentum: 20,
  participants: ["Poland", "Russian Empire"],
};
const reentryOf = (event, momentum) => deferredStorylineReentryHasConcreteTrigger(
  { events: [event], warUpdates: "", relationUpdates: "", agreementUpdates: "" },
  [0],
  deferredPrior,
  { ...deferredPrior, pressure: 82, momentum },
);
const reentry = (title, description, momentum, extra = {}) => reentryOf({ ...empireEvent(title, description), ...extra }, momentum);
const OFFENSIVE = [
  ["Polish Counteroffensive Retakes Forward Positions", "Polish forces launch a counteroffensive, repulse Russian units and regain ground after exploiting an overextended sector."],
  ["Polska kontrofensywa odbija wysunięte pozycje", "Polskie siły rozpoczynają kontrofensywę, odpierają rosyjskie oddziały i odzyskują teren na przeciągniętym odcinku."],
];

// What wakes a deferred storyline is what its event carries, never its words:
// "counteroffensive", "mutiny" or "election" used to wake one, and "artillery"
// keep one asleep, in English only.
test("a minor event that changes nothing cannot reactivate a deferred storyline, whatever it says", () => {
  assert.equal(reentry(
    "Russian Artillery Exchanges Continue",
    "Russian and Polish batteries exchange localized artillery fire while the trench line remains unchanged.",
    28,
  ), false);
  for (const [title, description] of OFFENSIVE) assert.equal(reentry(title, description, 34), false, title);
});

test("a major event, or one that carries an operation, can reactivate a deferred storyline, in any language", () => {
  for (const [title, description] of OFFENSIVE) {
    assert.equal(reentry(title, description, 34, { importance: "major" }), true, title);
    assert.equal(reentry(title, description, 34, { notable: true }), true, title);
    const moved = empireEvent(title, description, { unitOps: [{ op: "move", unitId: "Polish 3rd Army", at: "Masovia" }] });
    assert.equal(reentryOf(moved, 20), true, `${title}: an operation is enough on its own`);
  }
  assert.equal(reentry(
    "Russian Artillery Exchanges Continue",
    "Russian and Polish batteries exchange localized artillery fire while the trench line remains unchanged.",
    28,
    { importance: "major" },
  ), true, "a major event's words do not keep it asleep");
});

// gameplay.js does not load under bare node: its wiring is read.
test("no word list reads an event for the war, and the skip is told the rules instead", () => {
  const integrity = readFileSync(new URL("./nativeWorldIntegrity.js", import.meta.url), "utf8");
  for (const gone of [
    "WAR_DEPENDENT_HOMEFRONT_RE", "PREPAREDNESS_RE", "FOREIGN_SPILLOVER_RE", "ROUTINE_MILITARY_CUE_RE",
    "STRONG_MILITARY_CONSEQUENCE_RE", "CONCRETE_MILESTONE_RE", "CLEARLY_NON_MILITARY_TITLE_RE", "ENDOGENOUS_MATERIAL_CUE_RE",
  ]) assert.ok(!new RegExp(`const ${gone}\\b`).test(integrity), `${gone} is gone`);
  for (const gone of ["falseNonBelligerentWartimeReason", "routineMilitaryNoDeltaReason", "actorIsActiveBelligerent"]) {
    assert.ok(!integrity.includes(gone), `${gone} is gone`);
  }
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.ok(!gameplay.includes("filterStorylineUpdatesAfterIntegrityScreen"));
  const segment = gameplay.slice(gameplay.indexOf("const screenSegmentPayload = "), gameplay.indexOf("const selectBreadthRepairContext = "));
  assert.ok(segment.length > 0 && !segment.includes("frontOrders: payload?.frontOrders"), "the screen is not handed the orders");
  assert.match(segment, /payload\.storylineUpdates = normalizeArray\(decodedStorylineUpdates\);/);
  assert.match(gameplay, /A polity at peace does not live under war conditions — rationing, war taxes, mobilisation — because others are fighting, unless the war reaches it through something concrete/);
  assert.match(gameplay, /or one that reports a meeting, a review or a statement with no outcome, or patrols, exchanges of fire or a state of readiness that changed nothing\./);
});

const emptyCandidate = () => ({
  events: [],
  storylineUpdates: "",
  diplomaticOutreach: [],
  warUpdates: "",
  relationUpdates: "",
  agreementUpdates: "",
  summary: "",
});

test("a long silence asks for one re-check, and a quiet final answer is legal", () => {
  const analysis = { explorationSlate: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], visibleSilenceDays: 75 };
  assert.match(validateWorldExplorationAudit(emptyCandidate(), analysis, { finalAttempt: false }), /no canonical visible milestone for 75 days/);
  assert.equal(validateWorldExplorationAudit(emptyCandidate(), analysis, { finalAttempt: true }), "");
});

test("exploration coverage is derived natively, with no audit bookkeeping from the model", () => {
  const candidate = {
    ...emptyCandidate(),
    events: [empireEvent(
      "Russian Cabinet Reviews Railway Finance",
      "Russian ministers approve a railway financing package after a domestic cabinet review.",
    )],
  };
  const analysis = {
    explorationSlate: [
      { id: 1, actor: "Austria-Hungary", type: "actor-domain" },
      { id: 2, actor: "German Empire", type: "actor-domain" },
      { id: 3, actor: "Cross-border system", type: "global" },
      { id: 4, actor: "Wider world", type: "global" },
    ],
    visibleSilenceDays: 10,
  };
  assert.equal(validateWorldExplorationAudit(candidate, analysis, { finalAttempt: false, world: empireWorld, gameCountry: empireGame.country }), "");
});

const slateActors = (world, diplomaticActors) => buildNativeWorldExplorationSlate({
  bundle: { game: { country: "German Empire", gameDate: "1916-04-12", round: 54 }, world },
  allStorylines: [],
  selectedStorylines: [],
  diplomaticActors,
  causalCandidates: [],
}).filter((slot) => slot.type === "actor-domain").map((slot) => slot.actor);

test("exploration actor aliases collapse to one polity", () => {
  const actors = slateActors({
    polityOverrides: {
      "Austrian Empire": { code: "Austrian Empire", name: "Austria-Hungary", aliases: ["Austrian Empire", "Austria-Hungary"] },
    },
    countryStats: { "Austrian Empire": {} },
    wars: [],
    relations: [],
    agreements: [],
    storylines: [],
  }, ["Austrian Empire", "Austria-Hungary"]);
  assert.ok(actors.filter((actor) => actor === "Austria-Hungary").length <= 1, actors.join(", "));
  assert.ok(!actors.includes("Austrian Empire"), actors.join(", "));
});

test("a passive catalog polity cannot take an exploration slot", () => {
  const actors = slateActors({
    polityOverrides: {
      "Protectorate Bohemia-Moravia": { code: "Protectorate Bohemia-Moravia", name: "Protectorate Bohemia-Moravia", aliases: [] },
    },
    countryStats: { "Protectorate Bohemia-Moravia": {} },
    wars: [{ id: "test-war", status: "active", sideA: ["Poland"], sideB: ["Russian Empire"] }],
    relations: [],
    agreements: [],
    storylines: [],
    units: [],
  }, ["British Empire"]);
  assert.ok(!actors.includes("Protectorate Bohemia-Moravia"), actors.join(", "));
  for (const expected of ["British Empire", "Poland", "Russian Empire"]) assert.ok(actors.includes(expected), actors.join(", "));
});
