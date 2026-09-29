// Run: node --test src/Game/AI/promptContext.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// What the prompt builders choose to show when a list is longer than its
// budget: the things the turn is about come first, and a cut says so.
import test from "node:test";
import assert from "node:assert/strict";

import {
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
