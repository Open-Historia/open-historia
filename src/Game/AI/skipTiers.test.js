// Run: node --test src/Game/AI/skipTiers.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// A time skip shows in full what the turn is about and the rest in a line
// (promptFocus.js). These hold that nothing the turn needs is ever cut: the
// player, every power at war, every power the orders name, the relevant
// countries idle diplomacy keeps, their units and their contested land; that no
// distant power is singled out for a turn of its own (the spotlight, removed
// after the quality A/B of 2026-11-07); and that what is cut is still named or
// counted.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOneLineDetail,
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
// name Syldavia; sixty filler states hold eight to eleven regions each, more
// than the region names a skip lists (buildRegionOwnershipText focusTotalCap).
const bigWorld = () => {
  const fillers = Array.from({ length: 60 }, (_, index) => `Filler State ${index + 1}`);
  const holdings = [["Ruritania", 30], ["Slavonia", 12], ["Borduria", 6], ["Carpathia", 5], ["Syldavia", 4], ...fillers.map((name, index) => [name, 8 + (index % 4)])];
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
  // The region names listed fill the budget: the powers in view, then the next by rank.
  const listed = text.split("\n").filter((line) => /^- .+ \[\d+ regions?\]: /.test(line));
  assert.ok(listed.some((line) => line.startsWith("- Filler State")), "powers out of view fill what the budget leaves");
  const names = listed.reduce((sum, line) => sum + line.split(": ").slice(1).join(": ").split(", ").length, 0);
  assert.ok(names >= 480 && names < 480 + 12, `${names} region names listed`);
  assert.ok(!rest.includes(listed.at(-1).slice(2, listed.at(-1).indexOf(" ["))), "a power listed in full is not in the paragraph too");
  assert.doesNotMatch(text, /Spotlight|development of its own/, "no distant power is singled out for a turn");
  assert.match(text, /Treat these as binding/);
});

// What the one-line list says of a power out of view (the quality A/B of
// 2026-11-07: the facts a model was asked of such a power came back "unknown").
test("a power out of view is its count, leader, alliances, agreements, peace and land in one entry", async () => {
  const { regions, world, actions } = bigWorld();
  // A small filler, so the region names' budget does not reach it.
  const far = "Filler State 9";
  const record = (name) => ({ code: name, name });
  const recorded = {
    ...world,
    polityOverrides: { ...world.polityOverrides, [far]: { ...record(far), leader: { name: "Queen Ilsa" } } },
    countryStats: { [far]: { leader: "Queen Ilsa" } },
    agreements: [
      { id: "a1", title: "Northern Pact", type: "mutual_defense", status: "active", parties: [far, "Filler State 58"] },
      { id: "a2", title: "Grain Treaty", type: "trade_economic", status: "active", parties: [far, "Filler State 57"] },
      { id: "a3", title: "Old Accord", type: "trade_economic", status: "ended", parties: [far, "Filler State 56"] },
    ],
    peaceTreaties: [{ id: "t1", warId: "w0", title: "The Short War", date: "1929-03-01", from: far, to: "Filler State 55", sides: [[far], ["Filler State 55"]] }],
    // Two of its provinces are held by Filler State 54.
    // And one override for a region this map does not have (a save carried over from an older map).
    regionOwnershipOverrides: { ...world.regionOwnershipOverrides, "FillerState9-0": "Filler State 54", "FillerState9-1": "Filler State 54", "ghost-17": "Ruritania" },
  };
  const text = await buildWorldSummary({ game, world: recorded, events: [], actions, chats: [] }, regions, { tiers: true, briefed: true });
  const rest = text.split("\n").find((line) => line.startsWith("Every other power"));
  assert.match(rest, /what the records say of it:/);
  const entry = rest.slice(rest.indexOf(`${far} (`), rest.indexOf(")", rest.indexOf(`${far} (`)) + 1);
  assert.equal(entry, `${far} (6; led by Queen Ilsa; allied with Filler State 58; agreement: Grain Treaty with Filler State 57; at peace with Filler State 55 since 1929-03-01; 2 of its regions held by Filler State 54)`);
  // A power at war is in view, so the flag says so only where a ledger names it otherwise; it is still read.
  const detail = buildOneLineDetail({ ...recorded, wars: [{ id: "w2", status: "active", sideA: [far], sideB: ["Filler State 59", "Filler State 53"] }] }, regions);
  assert.match(detail(far), /^led by Queen Ilsa; at war with Filler State 59, Filler State 53; /);
  assert.match(detail("Filler State 54"), /holds 2 of Filler State 9's$/);
  assert.equal(buildOneLineDetail(world, regions)("Filler State 33"), "", "nothing on record: the name and count alone");
  assert.match(text, /A region named nowhere in this description is held by the power it belongs to on the scenario's map: every region that changed hands is among the territorial changes above\./);
  assert.doesNotMatch(text, /ghost-17/, "a region the map does not have is never named by its id");
});

test("with the lookup functions, the powers out of view are one line", async () => {
  const { regions, world, actions } = bigWorld();
  const text = await buildWorldSummary({ game, world, events: [], actions, chats: [] }, regions, { tiers: true, briefed: true, regionListsViaTools: true });
  assert.match(text, /Not in play this turn: \d+ other powers; list_regions and power_info give any of them\./);
  assert.doesNotMatch(text, /A region named nowhere/, "the lookups say who holds any region");
  assert.match(text, /- Slavonia — 12 regions/);
  assert.doesNotMatch(text, /Slavonia province 0/, "region names come from the lookups");
});

// Idle diplomacy's relevant countries (idlePoliticalDiplomacyContext.js
// rankRelevantPolities): here, a filler state the latest event names, and one
// the player has a chat with. Each is shown as a neighbour is: its regions in
// full, its units in the table.
test("the relevant countries idle diplomacy keeps are in view, as a neighbour is", async () => {
  const { regions, world, actions } = bigWorld();
  const politicalActors = { byPolity: Object.fromEntries(Object.keys(world.polityOverrides).map((name) => [name, { government: {} }])) };
  const related = { ...world, politicalActors };
  const bundle = {
    game,
    world: related,
    events: [{ id: "e1", date: "1930-05-01", title: "Filler State 41 recalls its ambassador", description: "Filler State 41 recalls its ambassador from Ruritania.", countries: ["Filler State 41"] }],
    actions,
    chats: [{ id: "c1", countries: [{ name: "Filler State 52" }], messages: [{ time: "1930-04-20", text: "Greetings." }] }],
  };
  const focus = buildPromptFocus(bundle, regions, related, {});
  assert.ok(focus.relevant.includes("Filler State 41") && focus.relevant.includes("Filler State 52"), focus.relevant.join(", "));
  assert.ok(focus.inView.has("filler state 41") && focus.inView.has("filler state 52"));
  const reasons = Object.fromEntries(focus.ranked.map((entry) => [entry.label, entry.reasons]));
  assert.ok(reasons["Filler State 41"].includes("relevant country"));
  const text = await buildWorldSummary(bundle, regions, { tiers: true, briefed: true });
  assert.match(text, /- Filler State 41 \[\d+ regions?\]: Filler State 41 province 0/);
  // Without a political world they are ranked among the map's own powers.
  const plain = buildPromptFocus({ ...bundle, world }, regions, world, {});
  assert.deepEqual(plain.relevant.slice(0, 2), ["Filler State 41", "Filler State 52"]);
  assert.ok(plain.inView.has("filler state 41"));
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
  assert.match(text, /Every other power, none of them changed since the last skip, with the regions it holds and what the records say of it:/);
  assert.match(text, /- Filler State 7 \[\d+ regions\]: Filler State 7 province 0, /);
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
  const text = describeGroupsForPrompt(world, { inView: (name) => name === "Blue Band", regionName: (id) => ({ r1: "Ruhr", b1: "Saar" })[id] ?? "" });
  const [first, second] = text.split("\n");
  assert.ok(first.startsWith("- Blue Band — The first sentence"), "the group in view comes first");
  assert.ok(first.includes("Then a great deal of lore follows."));
  assert.equal(second, "- Red Hand — The first sentence says what it is. [controls 1 region: Ruhr]");
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
  assert.doesNotMatch(other.worldSummaryNoCity, /Spotlight|development of its own/);
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

// Group chats and the ballot pass talk; they never write regionTransfers, and
// the region vocabulary of up to 480 names was most of their world summary.
test("group chats and ballots are built as conversations, without the region vocabulary", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const calls = source.match(/buildTemplateVariables\(bundle, \{ taskKey: "chatActions"[^}]*\}\)/g) ?? [];
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call, /conversation: true/);
  const { regions, world } = bigWorld();
  const bundle = { game, world, events: [], actions: [], chats: [] };
  const chat = await buildPromptContext(bundle, { requiredKeys: ["worldSummary"], taskKey: "chatActions", conversation: true, mapSource: { regionCatalog: regions, nationTags: {} } });
  assert.doesNotMatch(chat.worldSummary, /region vocabulary for regionTransfers/);
  assert.doesNotMatch(chat.worldSummary, /Slavonia province 0/);
  assert.match(chat.worldSummary, /Ruritania province 0/, "the player's own regions by name");
  assert.ok(regions.length > 0);
});
