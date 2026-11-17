import test from "node:test";
import assert from "node:assert/strict";

import {
  GOVERNMENT_BACKGROUND_FUNCTION,
  IDLE_BACKGROUND_LIMIT,
  buildIdleDiplomacyPoliticalDecisionSet,
  idleDiplomacyLookups,
  idleDiplomacyPoliticalContextText,
  idleDiplomacySpeakerHasContext,
  rankRelevantPolities,
} from "./idlePoliticalDiplomacyContext.js";

const actor = (polityKey) => ({
  polityKey,
  politicalSystem: { type: "republic", representation: "electoral" },
  government: { form: "Republic" },
  parties: [],
  powerBlocs: [],
  traits: {},
  goals: [],
  fears: [],
  ambitions: [],
  domesticPressures: [],
  perceptions: {},
});

const worldWithActors = (puppets) => ({
  politicalActors: {
    schemaVersion: 6,
    byPolity: {
      Player: actor("Player"),
      "Fallback State": actor("Fallback State"),
      "Direct Puppet": actor("Direct Puppet"),
      Overlord: actor("Overlord"),
    },
  },
  institutions: { byId: {} },
  relations: [],
  agreements: [],
  wars: [],
  puppets,
});

const selectedActors = (decisionSet) => decisionSet.contexts.map((context) => context.actorPolity);

test("idle Political World context prioritizes the player's direct Puppet relationship", () => {
  const bundle = {
    game: { country: "Player" },
    chats: [],
    world: worldWithActors([{
      id: "player-puppet",
      overlord: "Player",
      puppet: "Direct Puppet",
      kind: "satellite",
      loyalty: 55,
      secrecy: "covert",
      status: "active",
      knownTo: [],
    }]),
  };

  const decisionSet = buildIdleDiplomacyPoliticalDecisionSet(bundle, { maxActors: 1 });
  assert.deepEqual(selectedActors(decisionSet), ["Direct Puppet"]);
});

test("idle Political World context prioritizes the player's own overlord", () => {
  const bundle = {
    game: { country: "Player" },
    chats: [],
    world: worldWithActors([{
      id: "player-subordinate",
      overlord: "Overlord",
      puppet: "Player",
      kind: "client",
      loyalty: 40,
      secrecy: "covert",
      status: "active",
      knownTo: [],
    }]),
  };

  const decisionSet = buildIdleDiplomacyPoliticalDecisionSet(bundle, { maxActors: 1 });
  assert.deepEqual(selectedActors(decisionSet), ["Overlord"]);
});

// ---- relevance, one list, background on demand (the owner, 2026-11-01) ----------------

// Who decided an event, as a skip records it (runtime/eventAgency.js), and a
// country among its places as the engine keeps a found one (runtime/eventPlaces.js).
const decidedBy = (polity) => ({
  principal: polity,
  principalKind: "polity",
  sovereignPolity: polity,
  authority: "autonomous",
  authorityRef: "",
  sovereignActors: [{ polity, authority: "autonomous", authorityRef: "" }],
});
const inCountry = (...names) => names.map((name) => ({ kind: "country", name }));

// A world of invented countries, not the real one: who matters is what has happened.
const fantasy = (names, extra = {}) => ({
  politicalActors: { schemaVersion: 6, byPolity: Object.fromEntries(names.map((name) => [name, actor(name)])) },
  institutions: { byId: {} },
  relations: [],
  agreements: [],
  wars: [],
  puppets: [],
  ...extra,
});

test("the governments are ranked by the latest thing that involved them, events and dealings with the player alike", () => {
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", "Aquilonia", "Borduria", "Carpathia", "Drakmor", "Zembla"], {
      relations: [{ a: "Eldoria", b: "Carpathia", lastUpdatedDate: "1201-03-01" }],
      wars: [{ id: "war-1", sideA: ["Eldoria"], sideB: ["Drakmor"], lastUpdatedDate: "1201-05-01" }],
    }),
    chats: [{ countries: [{ name: "Aquilonia" }], messages: [{ text: "Greetings.", time: "1201-02-01" }] }],
    events: [
      { id: "e1", date: "1201-04-01", title: "Borduria fortifies its passes", description: "", agency: decidedBy("Borduria"), impacts: {} },
      { id: "e2", date: "1201-01-01", title: "A comet is seen", description: "", impacts: {} },
    ],
  };
  assert.deepEqual(rankRelevantPolities(bundle).map((entry) => entry.name), ["Drakmor", "Borduria", "Carpathia", "Aquilonia"]);
});

test("names are matched whole and exactly: Niger is not Nigeria", () => {
  const bundle = {
    game: { country: "Chad" },
    world: fantasy(["Chad", "Niger", "Nigeria"]),
    chats: [],
    events: [{ id: "e1", date: "2016-01-02", title: "Nigeria closes its northern border", description: "Lagos cites smuggling.", agency: decidedBy("Nigeria"), impacts: {} }],
  };
  assert.deepEqual(rankRelevantPolities(bundle).map((entry) => entry.name), ["Nigeria"]);
  // Candidates count only where the world has no political profiles.
  assert.deepEqual(rankRelevantPolities(bundle, { candidates: ["Niger", "Chad"] }).map((entry) => entry.name), ["Nigeria"]);
});

test("a world without political profiles ranks the candidates it is given, and none without them", () => {
  const bundle = {
    game: { country: "Chad" },
    world: {},
    chats: [],
    events: [{ id: "e1", date: "2016-01-02", title: "Nigeria closes its northern border", description: "Lagos cites smuggling.", places: inCountry("Nigeria"), impacts: {} }],
  };
  assert.deepEqual(rankRelevantPolities(bundle).map((entry) => entry.name), []);
  assert.deepEqual(rankRelevantPolities(bundle, { candidates: ["Chad", "Niger", "Nigeria"] }).map((entry) => entry.name), ["Nigeria"]);
});

test("a reaction's own event comes first", () => {
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", "Aquilonia", "Borduria"], { relations: [{ a: "Eldoria", b: "Aquilonia", lastUpdatedDate: "1300-01-01" }] }),
    chats: [],
    events: [],
  };
  const event = { id: "e9", date: "1200-01-01", title: "Borduria recalls its envoy", agency: decidedBy("Borduria"), impacts: {} };
  assert.deepEqual(rankRelevantPolities(bundle, { event }).map((entry) => entry.name), ["Borduria", "Aquilonia"]);
});

// Who an event involves is what it records. Its title and description were
// searched for the governments' names: "Allemagne" was never Germany, a
// Chinese name written against the next character was never found, and a game
// told in another language gave background to other governments than an
// English one with the same history.
test("an event involves the polities its structure names, the same in every language, and never those its words name", () => {
  const world = fantasy(["Eldoria", "Germany", "Poland", "Iran", "Oman", "Romania"]);
  const ranked = (event) => rankRelevantPolities({ game: { country: "Eldoria" }, world, chats: [], events: [event] }).map((entry) => entry.name);
  const structure = { date: "1939-08-31", agency: decidedBy("Germany"), places: inCountry("Poland"), impacts: {} };
  const english = ranked({ ...structure, id: "en", title: "Germany closes its border with Poland", description: "Berlin cites unrest." });
  const french = ranked({ ...structure, id: "fr", title: "L'Allemagne ferme sa frontière avec la Pologne", description: "Berlin invoque des troubles." });
  const chinese = ranked({ ...structure, id: "zh", title: "德国关闭与波兰的边境", description: "柏林称局势动荡。" });
  assert.deepEqual(new Set(english), new Set(["Germany", "Poland"]));
  assert.deepEqual(french, english);
  assert.deepEqual(chinese, english);
  // Named in its words, recorded nowhere: it involves nobody.
  assert.deepEqual(ranked({ id: "words", date: "1939-09-01", title: "Iran and Oman watch Romania", description: "Germany and Poland are silent.", impacts: {} }), []);
});

test("an event's war, its operations and a place not yet found name their parties too", () => {
  const world = fantasy(["Eldoria", "Aquilonia", "Borduria", "Carpathia", "Drakmor", "Zembla"], {
    wars: [{ id: "war-7", status: "active", sideA: ["Aquilonia"], sideB: ["Borduria"] }],
  });
  const ranked = (event) => rankRelevantPolities({ game: { country: "Eldoria" }, world, chats: [], events: [event] }).map((entry) => entry.name);
  assert.deepEqual(new Set(ranked({ id: "w", date: "1201-01-01", title: "Skirmish", warId: "war-7", impacts: {} })), new Set(["Aquilonia", "Borduria"]));
  assert.deepEqual(ranked({ id: "t", date: "1201-01-01", title: "A province changes hands", impacts: { regionTransfers: [{ regionId: "r1", fromCode: "Carpathia", toCode: "Drakmor" }] } }).sort(), ["Carpathia", "Drakmor"]);
  assert.deepEqual(ranked({ id: "p", date: "1201-01-01", title: "Riots", places: ["city: Zemblagrad, country: Zembla"], impacts: {} }), ["Zembla"]);
});

test("at most twenty carry their background: the twenty latest to have had something happen", () => {
  const names = Array.from({ length: 30 }, (_, index) => `Realm ${String(index).padStart(2, "0")}`);
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", ...names]),
    chats: [],
    // Realm 00 the earliest, Realm 24 the latest; Realms 25-29 untouched.
    events: names.slice(0, 25).map((name, index) => ({ id: `e${index}`, date: `1200-01-${String(index + 1).padStart(2, "0")}`, title: `${name} holds a festival`, places: inCountry(name), impacts: {} })),
  };
  const set = buildIdleDiplomacyPoliticalDecisionSet(bundle);
  assert.equal(IDLE_BACKGROUND_LIMIT, 20);
  assert.equal(set.contexts.length, 20);
  assert.equal(set.contexts[0].actorPolity, "Realm 24");
  assert.ok(!set.contexts.some((context) => ["Realm 00", "Realm 04", "Realm 27"].includes(context.actorPolity)));
  assert.equal(set.listed.length, 30, "every government is listed");
  assert.deepEqual(set.listed.slice(0, 3), ["Realm 24", "Realm 23", "Realm 22"]);
  assert.deepEqual(set.listed.slice(-5), ["Realm 25", "Realm 26", "Realm 27", "Realm 28", "Realm 29"]);
});

test("the model reads one list, in that order, with no headings between the relevant and the rest", () => {
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", "Aquilonia", "Borduria", "Zembla"], { relations: [{ a: "Eldoria", b: "Zembla", lastUpdatedDate: "1201-01-01" }] }),
    chats: [],
    events: [],
  };
  const set = buildIdleDiplomacyPoliticalDecisionSet(bundle);
  const text = idleDiplomacyPoliticalContextText(set, { canFetch: true });
  const order = ["- Zembla", "- Aquilonia", "- Borduria"].map((line) => text.indexOf(line));
  assert.ok(order.every((at) => at > 0) && order[0] < order[1] && order[1] < order[2], text);
  assert.doesNotMatch(text, /relevant|irrelevant|others?:|the rest/i);
  assert.match(text, new RegExp(`fetched with ${GOVERNMENT_BACKGROUND_FUNCTION}`));
  assert.doesNotMatch(text, /war-|polity-|\bid\b/i, "names, never ids");
});

test("a government listed without background can have it fetched, and may then write; without it, nothing is sent", async () => {
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", "Aquilonia", "Borduria"], { relations: [{ a: "Eldoria", b: "Aquilonia", lastUpdatedDate: "1201-01-01" }] }),
    chats: [],
    events: [],
  };
  const set = buildIdleDiplomacyPoliticalDecisionSet(bundle);
  assert.deepEqual(set.contexts.map((context) => context.actorPolity), ["Aquilonia"]);
  assert.equal(idleDiplomacySpeakerHasContext(bundle.world, "Borduria", set), false);

  const lookups = idleDiplomacyLookups(null, { world: bundle.world, decisionSet: set, canFetch: true });
  assert.equal(lookups.tools[0].name, GOVERNMENT_BACKGROUND_FUNCTION);
  assert.equal(lookups.maxRounds, 2);
  const answer = await lookups.execute(GOVERNMENT_BACKGROUND_FUNCTION, { names: "Borduria\nAtlantis" });
  assert.match(answer, /^- Borduria\n/);
  assert.match(answer, /No government called "Atlantis" is in the list\./);
  assert.equal(idleDiplomacySpeakerHasContext(bundle.world, "Borduria", set), true);

  // Other lookups are kept and answered as before.
  const both = idleDiplomacyLookups({ tools: [{ name: "find_region" }], execute: async () => "region" }, { world: bundle.world, decisionSet: buildIdleDiplomacyPoliticalDecisionSet(bundle), canFetch: true });
  assert.deepEqual(both.tools.map((tool) => tool.name), [GOVERNMENT_BACKGROUND_FUNCTION, "find_region"]);
  assert.equal(await both.execute("find_region", {}), "region");
});

test("while requests are being saved there is no function, and any listed government may write", () => {
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", "Aquilonia", "Borduria"], { relations: [{ a: "Eldoria", b: "Aquilonia", lastUpdatedDate: "1201-01-01" }] }),
    chats: [],
    events: [],
  };
  const set = buildIdleDiplomacyPoliticalDecisionSet(bundle);
  assert.equal(idleDiplomacyLookups(null, { world: bundle.world, decisionSet: set, canFetch: false }), null);
  assert.equal(idleDiplomacySpeakerHasContext(bundle.world, "Borduria", set), true);
  assert.doesNotMatch(idleDiplomacyPoliticalContextText(set, { canFetch: false }), new RegExp(GOVERNMENT_BACKGROUND_FUNCTION));
});

test("the idle pulse and the event reaction send nothing rather than re-attribute a letter, and keep the player out of the recipients", async () => {
  const fs = await import("node:fs");
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.doesNotMatch(gameplay, /reactionSpeakerWithContext\(/);
  assert.equal((gameplay.match(/idleDiplomacyLookups\(buildTaskLookups\(bundle\)/g) || []).length, 2);
  assert.match(gameplay, /const countries = withoutPlayerParticipant\(\s*await resolveInvitees\(candidate\.chat\.countries, bundle\.world\),\s*bundle\.game\.country,\s*\);/);
});

test("every country in any chat with the player is relevant: a group chat with no dated messages, a closed chat, an institution's channel", () => {
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", "Aquilonia", "Borduria", "Carpathia", "Drakmor", "Elbonia", "Zembla"]),
    events: [{ id: "e1", date: "1201-06-01", title: "Drakmor crowns a king", agency: decidedBy("Drakmor"), impacts: {} }],
    chats: [
      { id: "g1", countries: [{ name: "Eldoria" }, { name: "Aquilonia" }, { name: "Borduria" }], messages: [{ text: "Welcome." }] },
      { id: "c1", status: "closed", countries: [{ name: "Carpathia" }], messages: [{ text: "Farewell.", time: "1201-02-01" }] },
      { id: "institution-channel-league", institutionId: "league", countries: ["Eldoria", "Elbonia"], messages: [], createdRound: 3 },
    ],
  };
  const ranked = rankRelevantPolities(bundle).map((entry) => entry.name);
  // Dated first (newest first), then by round, then the undated; Zembla, untouched, is not relevant.
  assert.deepEqual(ranked, ["Drakmor", "Carpathia", "Elbonia", "Aquilonia", "Borduria"]);
  const set = buildIdleDiplomacyPoliticalDecisionSet(bundle);
  assert.deepEqual(set.listed, ["Drakmor", "Carpathia", "Elbonia", "Aquilonia", "Borduria", "Zembla"]);
  assert.equal(set.contexts.length, 5, "every chat member carries its background, above the country nobody dealt with");
});

test("a chat dated by its own date when its messages carry none", () => {
  const bundle = {
    game: { country: "Eldoria" },
    world: fantasy(["Eldoria", "Aquilonia", "Borduria"], { relations: [{ a: "Eldoria", b: "Borduria", lastUpdatedDate: "1201-01-01" }] }),
    events: [],
    chats: [{ id: "c1", countries: ["Aquilonia"], lastUpdatedDate: "1201-05-01", messages: [{ text: "Hello." }] }],
  };
  assert.deepEqual(rankRelevantPolities(bundle).map((entry) => entry.name), ["Aquilonia", "Borduria"]);
});
