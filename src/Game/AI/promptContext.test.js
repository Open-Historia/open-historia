// Run: node --test src/Game/AI/promptContext.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// What the prompt builders choose to show when a list is longer than its
// budget: the things the turn is about come first, and a cut says so.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEventHistoryText,
  buildHistoricalAnchorText,
  buildPlayerPolityRegionsText,
  buildPromptContext,
  buildUnitsSummaryText,
  buildWorldSummary,
  orderByFocus,
} from "./promptContext.js";

const game = { country: "Ruritania", gameDate: "1930-05-12", round: 4, startDate: "1930-01-01" };

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
  for (let index = 0; index < 5; index += 1) assert.ok(text.includes(`[id r${index}]`), `player unit r${index} is listed`);
  for (let index = 0; index < 3; index += 1) assert.ok(text.includes(`[id s${index}]`), `ordered-on unit s${index} is listed`);
  assert.ok(text.indexOf("[id r0]") < text.indexOf("[id s0]") && text.indexOf("[id s0]") < text.indexOf("[id b0]"));
  assert.equal(text.split("\n").filter((line) => line.startsWith("- ")).length, 60);
  assert.match(text, /\[13 more units omitted; they remain on the map\]$/);
});

test("a units list that fits keeps its saved order and has no omission line", () => {
  const units = [unit("b0", "Borduria"), unit("r0", "Ruritania")];
  const text = buildUnitsSummaryText({ units }, { player: "Ruritania" });
  assert.ok(text.indexOf("[id b0]") < text.indexOf("[id r0]"));
  assert.doesNotMatch(text, /omitted/);
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
  assert.match(jump, /Ruritania province 0 \(Ruritania-0\)/, "the jump keeps its vocabulary");
  assert.match(jump, /region vocabulary for regionTransfers/);
});
