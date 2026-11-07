// Run: node --test src/Game/AI/skipTiers.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// A time skip shows in full what the turn is about and the rest in a line
// (promptFocus.js). These hold that nothing the turn needs is ever cut: the
// player, every power at war, every power the orders name, their units, their
// contested land, and a distant power or two in the spotlight; and that what is
// cut is still named or counted.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPolityLoreReference,
  buildPromptContext,
  buildPromptFocus,
  buildMarkersSummaryText,
  buildUnitsSummaryText,
  buildWorldSummary,
  MARKERS_TABLE_HEADER,
  UNITS_TABLE_HEADER,
  refreshPromptReference,
  PROMPT_REFERENCE_REFRESH,
} from "./promptContext.js";
import { describeTerritorialRowsGrouped, territorialControlRows } from "./standingContext.js";
import { describeGroupsForPrompt } from "../../runtime/groups.js";
import { AIR_STRIKES_MAX_CHARS, airStrikesBlock } from "../../runtime/fronts/airStrike.js";

const game = { country: "Ruritania", gameDate: "1930-05-12", round: 4, startDate: "1930-01-01" };

// Ruritania (the player) and Borduria fight Slavonia and Carpathia; the orders
// name Syldavia; sixty filler states hold a region or two each.
const bigWorld = () => {
  const fillers = Array.from({ length: 60 }, (_, index) => `Filler State ${index + 1}`);
  const holdings = [["Ruritania", 30], ["Slavonia", 12], ["Borduria", 6], ["Carpathia", 5], ["Syldavia", 4], ...fillers.map((name, index) => [name, 1 + (index % 4)])];
  const regions = [];
  const regionOwnershipOverrides = {};
  const polityOverrides = {};
  for (const [owner, count] of holdings) {
    polityOverrides[owner] = { code: owner, name: owner };
    for (let index = 0; index < count; index += 1) {
      const id = `${owner.replace(/\s+/g, "")}-${index}`;
      regions.push({ id, name: `${owner} province ${index}`, country: owner });
      regionOwnershipOverrides[id] = owner;
    }
  }
  polityOverrides.Slavonia.note = "A militarist republic.";
  return {
    regions,
    fillers,
    world: {
      customRegions: true,
      polityOverrides,
      regionOwnershipOverrides,
      wars: [{ id: "w1", status: "active", sideA: ["Ruritania", "Borduria"], sideB: ["Slavonia", "Carpathia"] }],
      language: "English",
    },
    actions: [{ id: "a1", status: "planned", title: "Envoy", text: "Send an envoy to Syldavia." }],
  };
};

test("a skip's world summary lists the player, every belligerent and every power the orders name, and names the rest", async () => {
  const { regions, world, actions, fillers } = bigWorld();
  const text = await buildWorldSummary({ game, world, events: [], actions, chats: [] }, regions, { tiers: true, briefed: true });
  assert.match(text, /- Ruritania \[30 regions\]: Ruritania province 0, /, "the player's regions in full");
  for (const name of ["Slavonia", "Borduria", "Carpathia", "Syldavia"]) {
    assert.ok(new RegExp(`- ${name} (\\[\\d+ regions\\]: ${name} province 0|— \\d+ regions)`).test(text), `${name} is in view`);
  }
  const rest = text.split("\n").find((line) => line.startsWith("Every other power"));
  assert.ok(rest, "the powers out of view in one paragraph");
  const named = fillers.filter((name) => text.includes(name));
  assert.equal(named.length, fillers.length, "no power is left unnamed");
  assert.match(text, /Spotlight this period, powers the story has not followed lately: Filler State \d+, Filler State \d+, Filler State \d+\./);
  assert.match(text, /Treat these as binding/);
});

test("with the lookup functions, the powers out of view are one line", async () => {
  const { regions, world, actions } = bigWorld();
  const text = await buildWorldSummary({ game, world, events: [], actions, chats: [] }, regions, { tiers: true, briefed: true, regionListsViaTools: true });
  assert.match(text, /Not in play this turn: \d+ other powers; list_regions and country_info give any of them\./);
  assert.match(text, /- Slavonia — 12 regions/);
  assert.doesNotMatch(text, /Slavonia province 0/, "region names come from the lookups");
});

test("a power that changed since the last skip comes into view, and the rest say they did not change", async () => {
  const { regions, world, actions } = bigWorld();
  const bundle = { game, world, events: [], actions, chats: [] };
  const first = buildPromptFocus(bundle, regions, world, {});
  assert.equal(first.changed, null, "no snapshot: nothing is known to be unchanged");
  // The next skip: Filler State 7 took a province from Filler State 8.
  const moved = { ...world, promptSnapshot: first.snapshot, regionOwnershipOverrides: { ...world.regionOwnershipOverrides, "FillerState8-0": "Filler State 7" } };
  const next = buildPromptFocus({ ...bundle, world: moved }, regions, moved, {});
  assert.deepEqual([...next.changed].sort(), ["filler state 7", "filler state 8"]);
  assert.ok(next.inView.has("filler state 7") && next.inView.has("filler state 8"));
  const text = await buildWorldSummary({ ...bundle, world: moved }, regions, { tiers: true, briefed: true });
  assert.match(text, /Every other power, none of them changed since the last skip, with the regions it holds:/);
  assert.match(text, /- Filler State 7 \[4 regions\]: Filler State 7 province 0, /);
});

test("the player's units, its enemies' and those of the powers the orders name are in full; the rest by name, none dropped", () => {
  const unit = (id, ownerCode, extra = {}) => ({ id, name: `${ownerCode} unit ${id}`, type: "infantry", ownerCode, strength: 100, status: "idle", lat: 50, lng: 10, ...extra });
  const units = [
    ...Array.from({ length: 30 }, (_, index) => unit(`f${index}`, `Filler State ${index + 1}`)),
    unit("r1", "Ruritania"),
    unit("s1", "Slavonia", { type: "armor", strength: 64, posture: "attack", composition: "two tank brigades" }),
    unit("y1", "Syldavia"),
  ];
  const inView = new Set(["ruritania", "slavonia", "syldavia"]);
  const text = buildUnitsSummaryText({ units }, { player: "Ruritania", inView });
  assert.ok(text.startsWith(UNITS_TABLE_HEADER), "the fields are named once");
  assert.match(text, /^Ruritania:\n- Ruritania unit r1: infantry; 50\.00, 10\.00$/m, "full strength and idle go without saying");
  assert.match(text, /^Slavonia:\n- Slavonia unit s1: armor, 64%, attack; two tank brigades; 50\.00, 10\.00$/m);
  assert.match(text, /^- Syldavia unit y1: infantry; 50\.00, 10\.00$/m);
  assert.match(text, /^Other formations, by owner/m);
  for (let index = 0; index < 30; index += 1) assert.ok(text.includes(`Filler State ${index + 1} unit f${index} (infantry)`), `f${index} still named`);
  assert.doesNotMatch(text, /omitted/);
});

test("contested land is grouped by who holds it; the lines of the powers in view name every region, the rest are counted", () => {
  const catalog = [];
  const world = { regionOwnershipOverrides: {}, regionSovereigntyOverrides: {}, regionClaimants: {} };
  for (let index = 0; index < 20; index += 1) {
    catalog.push({ id: `s${index}`, name: `Slav ${index}`, country: "Slavonia" });
    world.regionOwnershipOverrides[`s${index}`] = "Ruritania";
    world.regionSovereigntyOverrides[`s${index}`] = "Slavonia";
  }
  for (let index = 0; index < 15; index += 1) {
    catalog.push({ id: `a${index}`, name: `Atl ${index}`, country: "Atlantis" });
    world.regionClaimants[`a${index}`] = ["Mu"];
  }
  const rows = territorialControlRows(world, catalog);
  const text = describeTerritorialRowsGrouped(rows, { inView: new Set(["ruritania"]) });
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- sovereign Slavonia, controller Ruritania \(20 regions\): Slav 0, .*Slav 19$/);
  assert.match(lines[1], /^- sovereign and controller Atlantis, claimed by Mu \(15 regions\): Atl 0, Atl 1, Atl 2, Atl 3, Atl 4, Atl 5, \(\+9 more\)$/);
});

test("a group out of view keeps its name and area and loses its long description; one in view keeps it all", () => {
  const long = "The first sentence says what it is. " + "Then a great deal of lore follows. ".repeat(20);
  const world = {
    groups: { "Red Hand": { description: long }, "Blue Band": { description: long } },
    groupAreas: { r1: "Red Hand", b1: "Blue Band" },
  };
  const text = describeGroupsForPrompt(world, { inView: (name) => name === "Blue Band" });
  const [first, second] = text.split("\n");
  assert.ok(first.startsWith("- Blue Band — The first sentence"), "the group in view comes first");
  assert.ok(first.includes("Then a great deal of lore follows."));
  assert.equal(second, "- Red Hand — The first sentence says what it is. [controls 1 region: r1 (r1)]");
});

test("the polities' lore rides in the cached opening, and lore written since rides in the live part", async () => {
  const { regions, world, actions } = bigWorld();
  assert.equal(buildPolityLoreReference(world), "- Slavonia: A militarist republic.");
  const reference = refreshPromptReference(world, 4);
  assert.deepEqual(reference.notes, { slavonia: { name: "Slavonia", note: "A militarist republic." } });
  // Unchanged notes keep the reference as it was.
  assert.equal(refreshPromptReference({ ...world, promptReference: reference }, 9), reference);
  // One note moves: the reference stays (the opening stays cached), and the live part carries it.
  const moved = { ...world, promptReference: reference, polityOverrides: { ...world.polityOverrides, Slavonia: { code: "Slavonia", name: "Slavonia", note: "A republic at war." } } };
  assert.equal(refreshPromptReference(moved, 9), reference);
  assert.equal(buildPolityLoreReference(moved), "- Slavonia: A militarist republic.");
  const text = await buildWorldSummary({ game, world: moved, events: [], actions, chats: [] }, regions, { tiers: true, briefed: true });
  assert.match(text, /- Slavonia — A republic at war\./);
  // Long enough after, the reference is renewed.
  const later = refreshPromptReference(moved, 4 + PROMPT_REFERENCE_REFRESH.rounds);
  assert.equal(later.notes.slavonia.note, "A republic at war.");
});

test("a skip's prompt context carries its focus and the lore reference, and other tasks keep the untiered summary", async () => {
  const { world, actions } = bigWorld();
  const bundle = { game, world, events: [], actions, chats: [] };
  const skip = await buildPromptContext(bundle, { requiredKeys: ["worldSummaryNoCity", "polityLoreReference", "unitsSummary"], taskKey: "jumpForward" });
  assert.ok(skip.promptFocus?.inView instanceof Set);
  assert.match(skip.polityLoreReference, /^\[Polity Lore\]\n.*\n- Slavonia: A militarist republic\.\n\n$/);
  const other = await buildPromptContext(bundle, { requiredKeys: ["worldSummaryNoCity"], taskKey: "actions" });
  assert.equal(other.promptFocus, undefined);
  assert.doesNotMatch(other.worldSummaryNoCity, /Spotlight this period/);
});

test("the air strikes a skip is told are capped, the heaviest kept, and the rest counted", () => {
  const strike = (index, extra = {}) => ({
    id: `s${index}`, owner: "Aland", unit: `Bomber Wing ${index}`, kind: "city", target: `Town ${index}`, country: "Borduria",
    lng: 20, lat: 50, outcome: "through", round: 3, lost: 5, ...extra,
  });
  const strikes = [...Array.from({ length: 38 }, (_, index) => strike(index)), strike(38, { dead: 5000 }), strike(39, { dead: 9000 })];
  const block = airStrikesBlock(strikes);
  assert.ok(block.length <= AIR_STRIKES_MAX_CHARS + 600, `the block is bounded (${block.length})`);
  assert.match(block, /Bomber Wing 38 struck/);
  assert.match(block, /Bomber Wing 39 struck/);
  assert.match(block, /\(\+\d+ more air strikes? this period, of lesser effect, not listed\)$/);
  assert.equal(airStrikesBlock(strikes.slice(0, 3)).includes("more air strike"), false);
});

test("a skip's structures are a table too: what they are, whose, where; the rotation's others in a line", () => {
  const markers = [
    { id: "m1", name: "Fort Brod", kind: "fortress", ownerCode: "Ruritania", status: "active", lat: 51.2, lng: 23.4, note: "The border's anchor." },
    { id: "m2", name: "Zenda Dam", kind: "dam", ownerCode: "Atlantis", status: "under_construction", lat: 40, lng: 10 },
    { id: "m3", name: "Old Lighthouse", kind: "landmark", ownerCode: "Atlantis", status: "active", lat: 41, lng: 11 },
  ];
  const text = buildMarkersSummaryText({ markers }, { inView: new Set(["ruritania"]), limit: 10 });
  const lines = text.split("\n");
  assert.equal(lines[0], MARKERS_TABLE_HEADER);
  assert.ok(lines.includes("- Fort Brod: fortress, Ruritania; 51.20, 23.40 — The border's anchor."));
  assert.ok(lines.includes("- Zenda Dam: dam, Atlantis, under_construction; 40.00, 10.00"), "an open structure is in full wherever it is");
  assert.ok(lines.includes("- Old Lighthouse: landmark, Atlantis"), "a quiet one out of view is named");
});
