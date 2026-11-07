// Run: node --test src/Game/AI/promptContext.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// What the prompt builders choose to show when a list is longer than its
// budget: the things the turn is about come first, and a cut says so.
import test from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_DIGEST_FALLBACK_CHARS,
  buildAdvisorHistoryText,
  buildDetailedChatHistoryText,
  buildEventHistoryText,
  eventDigestOf,
  buildHistoricalAnchorText,
  buildPlayerPolityRegionsText,
  buildPromptContext,
  buildUnitsSummaryText,
  buildWorldSummary,
  orderByFocus,
} from "./promptContext.js";

const game = { country: "Ruritania", gameDate: "1930-05-12", round: 4, startDate: "1930-01-01" };

test("generic Advisor prompt history excludes unrelated ministers and their private conversations", () => {
  const entries = [
    { role: "user", text: "Chief-only strategic discussion" },
    { role: "advisor", text: "Chief reply" },
    { role: "advisor-contact", id: "advisor-minister-123456", name: "Finance Minister", title: "Treasury", personality: "Independent" },
    { role: "user", threadId: "advisor-minister-123456", text: "Confidential Treasury question" },
    { role: "advisor", threadId: "advisor-minister-123456", text: "Confidential Treasury reply" },
  ];
  const formatted = buildAdvisorHistoryText(entries);
  assert.match(formatted, /Chief-only strategic discussion/);
  assert.match(formatted, /Chief reply/);
  assert.doesNotMatch(formatted, /Confidential Treasury|Finance Minister|Treasury reply/);
});

const unit = (id, ownerCode) => ({ id, name: `${ownerCode} unit ${id}`, type: "infantry", ownerCode, strength: 100, lat: 50, lng: 10 });

test("a long units list keeps the player's and the turn's powers' units and counts the rest", () => {
  const units = [
    ...Array.from({ length: 65 }, (_, index) => unit(`b${index}`, "Borduria")),
    ...Array.from({ length: 5 }, (_, index) => unit(`r${index}`, "Ruritania")),
    ...Array.from({ length: 3 }, (_, index) => unit(`s${index}`, "Slavonia")),
  ];
  const text = buildUnitsSummaryText({ units }, {
    player: "Ruritania",
    actions: [{ title: "Warn Slavonia", text: "Warn Slavonia off the border.", status: "planned" }],
  });
  for (let index = 0; index < 5; index += 1) assert.ok(text.includes(`- Ruritania unit r${index} (`), `player unit r${index} is listed`);
  for (let index = 0; index < 3; index += 1) assert.ok(text.includes(`- Slavonia unit s${index} (`), `ordered-on unit s${index} is listed`);
  assert.ok(text.indexOf("- Ruritania unit r0 (") < text.indexOf("- Slavonia unit s0 (") && text.indexOf("- Slavonia unit s0 (") < text.indexOf("- Borduria unit b0 ("));
  assert.equal(text.includes("[id "), false, "a unit is listed by its name, never its id");
  assert.equal(text.split("\n").filter((line) => line.startsWith("- ")).length, 60);
  assert.match(text, /\[13 more units omitted; they remain on the map\]$/);
});

test("a units list that fits keeps its saved order and has no omission line", () => {
  const units = [unit("b0", "Borduria"), unit("r0", "Ruritania")];
  const text = buildUnitsSummaryText({ units }, { player: "Ruritania" });
  assert.ok(text.indexOf("- Borduria unit b0 (") < text.indexOf("- Ruritania unit r0 ("));
  assert.doesNotMatch(text, /omitted/);
});

test("two units of one name are told apart by their owner, and a region id is never shown", () => {
  const units = [
    { id: "a", name: "1st Army", type: "infantry", ownerCode: "Borduria", strength: 100, lat: 50, lng: 10, regionId: "4441" },
    { id: "b", name: "1st Army", type: "infantry", ownerCode: "Ruritania", strength: 100, lat: 51, lng: 11 },
    { id: "c", name: "Guards", type: "armor", ownerCode: "Ruritania", strength: 100, lat: 52, lng: 12 },
  ];
  const text = buildUnitsSummaryText({ units }, { player: "Ruritania" });
  assert.match(text, /^- 1st Army \(Borduria\) \(infantry, owner Borduria/m);
  assert.match(text, /^- 1st Army \(Ruritania\) \(infantry, owner Ruritania/m);
  assert.match(text, /^- Guards \(armor, owner Ruritania/m);
  assert.equal(text.includes("4441"), false);
});

test("marker attention reads the queued orders, not the answered ones", async () => {
  const markers = Array.from({ length: 60 }, (_, index) => ({
    id: `m${index}`,
    name: `Depot ${String.fromCharCode(65 + (index % 26))}${Math.floor(index / 26)}x`,
    kind: "depot",
    status: "active",
    lat: 50,
    lng: 10,
  }));
  markers.push({ id: "kiel", name: "Kiel Canal", kind: "canal", status: "active", lat: 54.3, lng: 10.1 });
  // Ten answered orders, each naming another marker, after the one queued
  // order that names the canal: a window of the last ten actions used to be
  // all answered ones.
  const actions = [
    { id: "a-live", title: "Widen the Kiel Canal", text: "Widen the Kiel Canal for the new cruisers.", status: "planned" },
    ...markers.slice(0, 10).map((marker, index) => ({
      id: `a-old-${index}`,
      title: `Inspect ${marker.name}`,
      text: `Inspect ${marker.name}.`,
      status: "resolved",
    })),
  ];
  const context = await buildPromptContext({
    game,
    world: { markers, language: "English" },
    events: [],
    actions,
    chats: [],
  }, { requiredKeys: ["markersSummary"], taskKey: "advisor" });
  assert.match(context.markersSummary, /Kiel Canal/);
});

// A hand-drawn world: twenty authored polities, the one the player is at war
// with stored last.
const authoredWorld = () => {
  const names = Array.from({ length: 19 }, (_, index) => `Filler State ${index + 1}`);
  const polityOverrides = {};
  for (const name of [...names, "Ruritania", "Slavonia"]) {
    polityOverrides[name] = { code: name, name, note: `${name} lore.` };
  }
  const countryTags = {};
  for (const name of Array.from({ length: 44 }, (_, index) => `Tagged Land ${index + 1}`)) countryTags[name] = ["quiet"];
  countryTags.Slavonia = ["militarist"];
  const regions = [];
  const regionOwnershipOverrides = {};
  for (const [owner, count] of [["Ruritania", 30], ["Slavonia", 4], ...names.map((name) => [name, 1])]) {
    for (let index = 0; index < count; index += 1) {
      const id = `${owner.replace(/\s+/g, "")}-${index}`;
      regions.push({ id, name: `${owner} province ${index}`, country: owner });
      regionOwnershipOverrides[id] = owner;
    }
  }
  return {
    regions,
    world: {
      customRegions: true,
      polityOverrides,
      countryTags,
      regionOwnershipOverrides,
      wars: [{ id: "w1", status: "active", sideA: ["Ruritania"], sideB: ["Slavonia"] }],
      language: "English",
    },
  };
};

test("the world summary keeps the lore and tags of the powers the turn is about, and counts the cut", async () => {
  const { regions, world } = authoredWorld();
  const text = await buildWorldSummary({ game, world, events: [], actions: [], chats: [] }, regions);
  assert.match(text, /- Slavonia: Slavonia — Slavonia lore\./, "the enemy's lore survives the cap");
  assert.match(text, /- Ruritania: Ruritania — Ruritania lore\./);
  assert.match(text, /\(\+5 more polities not listed\)/);
  assert.match(text, /- Slavonia: militarist/, "the enemy's tags survive the cap");
  assert.match(text, /\(\+5 more tagged countries not listed\)/);
});

test("orderByFocus puts ranked powers first by exact name and keeps the rest in order", () => {
  const ordered = orderByFocus(["Russia", "Panama", "Russian Federation", "Chile"], (name) => [name], ["Russian Federation", "Chile"]);
  assert.deepEqual(ordered, ["Russian Federation", "Chile", "Russia", "Panama"], "\"Russia\" is not the Russian Federation");
});

test("the player's region list says how many regions it left out", async () => {
  const { regions, world } = authoredWorld();
  const text = await buildPlayerPolityRegionsText({ game, world }, regions);
  assert.equal(text.split(", ").length, 25);
  assert.match(text, /, \(\+6 more\)$/);
});

const occupationAndGroup = (extra = {}) => ({
  id: "e-occupation",
  date: "1930-03-01",
  title: "Kharkiv falls",
  description: "Russian forces take the city; a partisan band forms in the woods.",
  importance: "minor",
  impacts: {
    regionControlOps: [
      { op: "control", regionId: "UKR.7_1", regionName: "Kharkiv", fromCode: "Ukraine", toCode: "Russian Federation" },
      { op: "contest", regionId: "UKR.10_1", regionName: "Luhansk", fromCode: "Ukraine", actorCode: "Russian Federation" },
    ],
    groupOps: [{ op: "create", name: "Kharkiv Partisans", regionIds: ["UKR.7_1", "UKR.7_2"] }],
  },
  ...extra,
});

test("recent events note occupations and groups, not only sovereignty transfers", () => {
  const text = buildEventHistoryText([occupationAndGroup()]);
  assert.match(text, /Control: Kharkiv -> Russian Federation \(from Ukraine\), Luhansk contested by Russian Federation \(held by Ukraine\)/);
  assert.match(text, /Groups: Kharkiv Partisans founded in 2 regions/);

  const renamed = buildEventHistoryText([{
    ...occupationAndGroup(),
    impacts: { polityChanges: [{ code: "Slavonia", name: "Greater Slavonia" }] },
  }]);
  assert.match(renamed, /Polity changes: Slavonia renamed to Greater Slavonia/, "the older notes keep their wording");
});

test("a group founding or an occupation is a durable anchor for a long campaign", () => {
  const events = [
    occupationAndGroup(),
    { id: "e-parade", date: "1930-03-02", title: "Parade", description: "A parade.", importance: "minor", impacts: {} },
  ];
  const world = { consolidatedHistory: [{ id: "h1", summary: "Spring 1930.", throughEventId: "e-parade", throughDate: "1930-03-02" }] };
  const anchors = buildHistoricalAnchorText(events, world);
  assert.match(anchors, /Kharkiv falls/);
  assert.doesNotMatch(anchors, /Parade/);
});

test("a conversation's world summary gives counts, and names only for the player and the speaker", async () => {
  const { regions, world } = authoredWorld();
  const bundle = { game, world, events: [], actions: [], chats: [] };
  const chat = await buildWorldSummary(bundle, regions, { conversation: true, speakingAs: "Slavonia" });
  assert.match(chat, /Map ownership by power:\nRegions held by the powers in this conversation:/);
  assert.match(chat, /- Ruritania \[30 regions\]: Ruritania province 0, /);
  assert.match(chat, /- Slavonia \[4 regions\]: Slavonia province 0, Slavonia province 1, Slavonia province 2, Slavonia province 3/);
  assert.match(chat, /- Filler State 1 — 1 region/);
  assert.equal(chat.includes("(Ruritania-0)"), false, "no region ids");
  assert.equal(chat.includes("regionTransfer"), false, "no jump instructions");
  assert.equal(chat.includes("polityChanges"), false);

  const jump = await buildWorldSummary(bundle, regions);
  assert.match(jump, /Ruritania province 0, Ruritania province 1/, "the jump keeps its vocabulary");
  assert.equal(jump.includes("(Ruritania-0)"), false, "by name, with no region ids");
  assert.match(jump, /region vocabulary for regionTransfers/);
});

// A time skip's template states the player, the round, the date, the language,
// the difficulty, the briefing and the rules itself.
test("a skip's world summary leaves out the briefing its template gives, and keeps the player's tags", async () => {
  const { regions, world } = authoredWorld();
  const briefedWorld = { ...world, startingTimelineText: "The long lore of the scenario.", simulationRules: "No poison gas." };
  const bundle = { game: { ...game, difficulty: "hard" }, world: briefedWorld, events: [], actions: [], chats: [] };
  const full = await buildWorldSummary(bundle, regions);
  const skip = await buildWorldSummary(bundle, regions, { briefed: true });
  for (const line of ["Current round: 4", "Current date: 1930-05-12", "Difficulty: hard", "World before round one: The long lore", "Simulation rules: No poison gas."]) {
    assert.ok(full.includes(line), `the full summary still says ${line}`);
    assert.equal(skip.includes(line), false, `a skip's does not repeat ${line}`);
  }
  assert.equal(skip.includes("Language:"), false);
  assert.ok(full.endsWith(skip.slice(skip.indexOf("Territorial changes from the base scenario:"))), "the rest is the same");
  const variables = await buildPromptContext(bundle, { requiredKeys: ["worldSummaryNoCity"], taskKey: "jumpForward" });
  assert.equal(variables.worldSummaryNoCity.includes("Current round: 4"), false);
  const others = await buildPromptContext(bundle, { requiredKeys: ["worldSummaryNoCity"], taskKey: "actions" });
  assert.ok(others.worldSummaryNoCity.includes("Current round: 4"), "the tasks whose only briefing it is keep it");
});

// A skip once had each chat thread's memory and last words twice: in
// [Diplomacy So Far] and again in [Diplomatic Memory].
const thread = (id, day, { memory = "", messages = 2 } = {}) => ({
  id,
  countries: [{ name: "Ruritania" }, { name: `Partner ${id}` }],
  messages: [
    ...Array.from({ length: messages }, (_, index) => ({
      role: index % 2 ? "leader" : "user",
      speaker: index % 2 ? `Partner ${id}` : "Ruritania",
      text: `${id} message ${index}`,
      time: `1930-05-${String(day).padStart(2, "0")}`,
      // The rolling memory rides on the message it was written after.
      ...(memory && index === messages - 1 ? { memorySummary: memory } : {}),
    })),
  ],
});

test("a skip's diplomacy gives each thread once: its memory, then its last words, older threads with a memory after", async () => {
  const chats = [
    ...Array.from({ length: 9 }, (_, index) => thread(`t${index}`, 20 - index, { memory: index === 0 ? "Ruritania promised Partner t0 a port." : "" })),
    thread("old", 2, { memory: "Partner old was promised a withdrawal by June." }),
  ];
  const text = buildDetailedChatHistoryText(chats, { limit: 8, memoryThreads: 12 });
  assert.match(text, /Chat 1: Ruritania, Partner t0\nDurable diplomatic memory through [^:]+: Ruritania promised Partner t0 a port\./);
  assert.match(text, /Chat 9: Ruritania, Partner old \(an older thread with a standing memory\)\nDurable diplomatic memory through [^:]+: Partner old was promised a withdrawal by June\.\nold message 0\nold message 1|Partner old was promised a withdrawal by June\./);
  assert.equal(text.includes("Partner t8"), false, "an older thread with no memory is in the history, not here");
  assert.equal(buildDetailedChatHistoryText(chats, { limit: 8 }).includes("Partner old"), false, "only a skip asks for them");
  const bundle = { game, world: {}, events: [], actions: [], chats, advisor: [] };
  const skip = await buildPromptContext(bundle, { requiredKeys: ["chatHistoryLong", "diplomaticContinuity"], taskKey: "jumpForward" });
  assert.equal(skip.diplomaticContinuity, "", "no second copy");
  assert.match(skip.chatHistoryLong, /Partner old was promised a withdrawal by June/);
  const withLookups = await buildPromptContext(bundle, { requiredKeys: ["chatHistoryLong", "diplomaticContinuity"], taskKey: "jumpForward", lookups: true });
  assert.match(withLookups.diplomaticContinuity, /Partner old was promised a withdrawal by June/, "the short view keeps its memory block");
});

// A skip's history tells the newest skip's events in full and the older ones
// by their one-line digest (or the opening of their story, where they have none).
test("a skip's history: the newest skip's events in full, older ones by their digest or the start of their story", () => {
  const story = (word) => `${word} ${"and the story went on at length about who did what to whom. ".repeat(8)}`.trim();
  const events = [
    { id: "old-1", date: "1930-01-05", title: "The old crisis", description: story("Old"), digest: "Slavonia closed the border after the old crisis.", importance: "major", impacts: {} },
    { id: "old-2", date: "1930-02-05", title: "An undigested event", description: story("Undigested"), importance: "major", impacts: {} },
    { id: "new-1", date: "1930-05-01", title: "The newest event", description: story("Newest"), digest: "Never shown: this one is told in full.", importance: "major", impacts: {} },
  ];
  const world = { simulationHistory: [{ date: "1930-05-12", eventIds: ["new-1"] }, { date: "1930-03-01", eventIds: ["old-1", "old-2"] }] };
  const skip = buildEventHistoryText(events, { world, digests: true, limit: 10 });
  assert.match(skip, /- 1930-01-05: The old crisis\n {2}Slavonia closed the border after the old crisis\./);
  assert.ok(skip.includes(story("Newest")), "the newest skip's event in full");
  assert.equal(skip.includes("Never shown"), false);
  assert.equal(skip.includes(story("Undigested")), false);
  assert.ok(skip.includes(eventDigestOf(events[1])), "an event with no digest by the opening of its story");
  assert.ok(eventDigestOf(events[1]).length <= EVENT_DIGEST_FALLBACK_CHARS && eventDigestOf(events[1]).startsWith("Undigested and the story"));
  // Every other task, and a world with no recorded skip, still tells every event in full.
  assert.ok(buildEventHistoryText(events, { world, limit: 10 }).includes(story("Old")));
  assert.ok(buildEventHistoryText(events, { world: {}, digests: true, limit: 10 }).includes(story("Old")));
});

// The ranking keeps the events a turn is most about; the rest are not yet in
// the history document either, so without a line each they were in neither.
test("a skip lists in a line each the recent events its ranking left out, newest kept, the rest counted", () => {
  const events = Array.from({ length: 60 }, (_, index) => ({
    id: `e${index}`,
    date: `1930-0${1 + Math.floor(index / 20)}-${String(1 + (index % 20)).padStart(2, "0")}`,
    title: `Event number ${index}`,
    description: `The story of event ${index}.`,
    ...(index % 2 ? { digest: `Digest of event ${index}.` } : {}),
    importance: index % 7 === 0 ? "major" : "minor",
    impacts: {},
  }));
  const text = buildEventHistoryText(events, { limit: 10, alsoListed: 40 });
  const [told, also] = text.split("ALSO RECENT (the other events since the story so far, which are not told above; one line each):");
  assert.ok(also, "the list is there");
  const listed = also.trim().split("\n").filter((line) => /^- \d{4}-/.test(line));
  assert.equal(listed.length, 40);
  assert.match(also, /^- \(10 earlier of them not listed\)$/m);
  for (let index = 0; index < 60; index += 1) {
    const inHistory = told.includes(`: Event number ${index}\n`) || told.trimEnd().endsWith(`: Event number ${index}`) || told.includes(`Event number ${index}\n  The story`);
    const inList = also.includes(`: Event number ${index}`);
    assert.equal(inHistory && inList, false, `event ${index} is told twice`);
  }
  // Each by its title and its digest where it has one.
  for (const line of listed) {
    const index = Number(/Event number (\d+)/.exec(line)[1]);
    assert.equal(line.endsWith(index % 2 ? ` — Digest of event ${index}.` : `Event number ${index}`), true, line);
  }
  // The newest of those left out are the ones listed.
  const newestLeftOut = Math.max(...listed.map((line) => Number(/Event number (\d+)/.exec(line)[1])));
  assert.ok(events.slice(newestLeftOut + 1).every((event) => told.includes(`: ${event.title}`)), "every newer event is told above");
  assert.equal(also.includes("The story of event"), false, "one line each, no story");
  // Nothing left out, nothing added; and only a skip asks for it.
  assert.equal(buildEventHistoryText(events.slice(0, 5), { limit: 10, alsoListed: 40 }).includes("ALSO RECENT"), false);
  assert.equal(buildEventHistoryText(events, { limit: 10 }).includes("ALSO RECENT"), false);
});
