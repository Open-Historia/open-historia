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

test("the resolver finds a polity by any of its exact names, and searches no text", () => {
  const { world, names } = bigWorld();
  const resolver = createWorldActorResolver(world, names[0]);
  assert.equal(resolver.knownCanonical("Land3"), names[3]);
  assert.equal(resolver.knownCanonical("realm 4"), names[4], "case aside");
  assert.equal(resolver.knownCanonical("Land33x"), "", "a name it does not hold is none");
  assert.equal(resolver.equivalent("Land5", "Realm 5"), true);
  // What an event concerns is read from its structured fields: the resolver
  // has no way to look for a name in a text any more.
  assert.equal(resolver.mentionedPolities, undefined);
  assert.equal(resolver.mentions, undefined);
});

test("the scope classifier reads who an event concerns from its fields, in any language", () => {
  const { world, names } = bigWorld();
  const classify = createWorldEventScopeClassifier(null, { world, gameCountry: names[0] });
  for (const [title, description] of [
    ["Land0 opens a port", "A new deep-water port opens."],
    ["Land0 eröffnet einen Hafen", "Ein neuer Tiefwasserhafen wird eröffnet."],
  ]) {
    assert.equal(classify({ title, description, actors: ["Land0"] }), "player-sphere", title);
    assert.equal(classify({ title, description, actors: ["Land9"] }), "wider-world", title);
    assert.equal(classify({ title, description, impacts: { regionTransfers: [{ regionId: "r", fromCode: "Land9", toCode: "Realm 10" }] } }), "wider-world", title);
    // A name in the text alone makes it nobody's.
    assert.equal(classify({ title, description }), "unknown", title);
  }
  assert.equal(classify({ title: "A port opens", description: "", playerRelated: true }), "player-sphere");
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

// The order the event cites (impacts.actionIds) is the authority: what its
// words and the event's share is never read, to grant it or to refuse it.
test("the player's own order, cited, authorizes the same choice, in English or not", () => {
  const actions = [{ id: "act-war", status: "planned", text: "Declare war on Russia" }];
  for (const [title, description] of [
    ["Latvia Declares War on Russia", "Latvia declares war on Russia."],
    ["Latvija piesaka karu Krievijai", "Latvija piesaka karu Krievijai."],
  ]) {
    const war = latviaEvent(title, description, { impacts: { actionIds: ["act-war"] } });
    const warUpdates = [warRecord(war.id, ["Republic of Latvia"], ["Russian Federation"])];
    const screened = screenLatvia([war], { actions, warUpdates });
    assert.equal(screened.events.length, 1);
    assert.equal(screened.events[0].agency.authority, "player-order", title);
    assert.equal(screened.events[0].agency.authorityRef, "act-war", title);
    assert.deepEqual(screened.playerVerdicts, []);
    // Not cited, the order authorizes nothing, however plainly its words fit.
    const uncited = screenLatvia([latviaEvent(title, description)], { actions, warUpdates: [warRecord(latviaEvent(title, description).id, ["Republic of Latvia"], ["Russian Federation"])] });
    assert.deepEqual(wouldWithhold(uncited), ["player-fresh-sovereign-choice-without-authority"], title);
  }
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

// A message counts by who wrote it to whom: the player wrote to every other
// party of the treaty the event starts. What it said is the model's to have
// read when it wrote the treaty; no word of it is compared with the event's.
test("the player's own message to the other party authorizes the treaty it agreed, in any language", () => {
  const chatWith = (country, text) => [{
    id: "chat-estonia",
    countries: [{ name: country }],
    messages: [{ id: "msg-latvia", role: "user", speaker: "Republic of Latvia", text }],
  }];
  for (const [title, description, words] of [
    ["Latvia Signs Border Demarcation Treaty With Estonia", "Latvia signs the border demarcation treaty with Estonia in Riga.", "Latvia will sign the border demarcation treaty with Estonia next month."],
    ["拉脱维亚与爱沙尼亚签署边界划定条约", "两国在里加签署边界条约。", "我们下个月签署边界条约。"],
  ]) {
    const treaty = latviaEvent(title, description);
    const agreementUpdates = [pactRecord(treaty.id, ["Republic of Latvia", "Republic of Estonia"])];
    assert.equal(wouldWithhold(screenLatvia([treaty], { agreementUpdates })).length, 1, "without the chat nothing authorizes it");
    const screened = screenLatvia([treaty], { chats: chatWith("Republic of Estonia", words), agreementUpdates });
    assert.equal(screened.events.length, 1);
    assert.equal(screened.events[0].agency.authority, "player-commitment", title);
    assert.equal(screened.events[0].agency.authorityRef, "msg-latvia", title);
    assert.deepEqual(screened.playerVerdicts, []);
    // Written to someone else, it is no word to Estonia.
    const elsewhere = screenLatvia([treaty], { chats: chatWith("Russian Federation", words), agreementUpdates });
    assert.equal(wouldWithhold(elsewhere).length, 1, title);
  }
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

// A stat update was stripped from an event that read like a meeting
// (PROCESS_ONLY_POLITY_UPDATE_RE), unless it also held an English outcome verb:
// "Committee reviews tariffs; rates rise 5%" lost its figures, and the same
// event in any other language kept them. The update is the model's, and stays.
test("a polity's stat update stays with an event that reads like a meeting, in English or not", () => {
  for (const [title, description] of [
    ["Reichstag Reviews Food Policy", "The Reichstag debates food policy without adopting a measure."],
    ["Reichstag berät über die Ernährungspolitik", "Der Reichstag debattiert über die Ernährungspolitik, ohne eine Maßnahme zu beschließen."],
  ]) {
    const screened = screenEmpire(empireEvent(title, description,
      { polityChanges: [{ operation: "update", code: "German Empire", stats: { stability: 82 } }] }));
    assert.equal(screened.events.length, 1);
    assert.deepEqual(screened.events[0].impacts.polityChanges.map((change) => change.stats.stability), [82], title);
    assert.equal("strippedPolityUpdates" in screened, false);
  }
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

// A participant a storyline update adds wakes it when the event's own fields or
// records name that participant: its actors, combatants, operations, or a war,
// relation or agreement record tied to it. A name in its prose did, in the
// prose's own spelling only.
test("a new participant wakes a deferred storyline by the event's fields, never by its prose", () => {
  const joined = { ...deferredPrior, participants: [...deferredPrior.participants, "German Empire"], pressure: 78, momentum: 20 };
  const wakes = (event, candidate = {}) => deferredStorylineReentryHasConcreteTrigger(
    { events: [event], warUpdates: "", relationUpdates: "", agreementUpdates: "", ...candidate },
    [0],
    deferredPrior,
    joined,
  );
  for (const [title, description] of [
    ["German Envoys Join the Polish Talks", "The German Empire sends envoys to the talks over Masovia."],
    ["Niemieccy wysłannicy dołączają do rozmów", "Cesarstwo Niemieckie wysyła wysłanników na rozmowy o Mazowszu."],
  ]) {
    const event = { ...empireEvent(title, description), importance: "minor" };
    assert.equal(wakes(event), false, `${title}: named only in prose`);
    assert.equal(wakes({ ...event, actors: ["German Empire"] }), true, `${title}: among its actors`);
    assert.equal(wakes(event, { relationUpdates: [{ a: "German Empire", b: "Poland", eventIndexes: [0] }] }), true, `${title}: a relation record tied to it`);
  }
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

// The owner, 2026-11-13: "there should be absolutely no keywording done in
// this game anywhere". Nothing in the screen reads an event's words, an
// order's or a message's: not a word list, not a name searched for in a text,
// not the words two texts share.
test("the screen holds no word list, no text search and no text similarity", () => {
  const integrity = readFileSync(new URL("./nativeWorldIntegrity.js", import.meta.url), "utf8");
  const code = integrity.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /const [A-Z_]+_RE\b/, "no regular expression constant");
  assert.doesNotMatch(code, /\\b\(/, "no word-boundary alternation");
  for (const gone of [
    "PROCESS_ONLY_POLITY_UPDATE_RE", "ROUTINE_ADMINISTRATIVE_CUE_RE", "LOW_TRAJECTORY_INSTITUTIONAL_RE", "TRAJECTORY_BREAKPOINT_RE",
    "CRISIS_DISCOVERY_KIND_RE", "INSTITUTION_SUBPRINCIPAL_HINT_RE", "EVENT_SUBJECT_VERB_RE", "DELEGATED_DOMESTIC_ACTOR_RE",
    "ENDOGENOUS_DOMESTIC_PROCESS_RE", "EXOGENOUS_EVENT_RE", "ROUTINE_COLLECTIVE_PROCESS_RE", "AUTHORITY_BINDING_STOP_WORDS",
  ]) assert.ok(!code.includes(gone), `${gone} is gone`);
  for (const gone of [
    "authoritySemanticScore", "resolveUniqueSemanticAuthority", "resolvePlayerOrderAuthority", "nativeSubjectLabel",
    "subjectPolityFromEvent", "actorFamilyMentioned", "eventMentionedPolities", "newParticipantsMentionedInEvent",
    "mentionedPolities", "sanitizeProcessOnlyPolityUpdates", "routineAdministrativeNoDeltaReason", "applyLowTrajectoryFeedGuard",
    "latentCrisisConsequenceChannels", "validateWorldPlayerAgencyPayload", "previewScreenedEvent",
  ]) assert.ok(!code.includes(gone), `${gone} is gone`);
  assert.doesNotMatch(code, /\.title\b[^\n]*\.(?:test|includes|match|startsWith)\(/, "no title is searched");
  assert.doesNotMatch(code, /\.description\b[^\n]*\.(?:test|includes|match)\(/, "no description is searched");
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
