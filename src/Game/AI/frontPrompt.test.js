/*! Open Historia — what a time skip is told of its battlefields: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontPrompt.test.js
//
// The [Fronts] block of a time skip's prompt (frontPrompt.js): what it has to
// say, that it never outgrows its length, and that nothing in it is an id.

import test from "node:test";
import assert from "node:assert/strict";

import { describeBattlefield } from "../../runtime/fronts/brief.js";
import { FRONT_EFFORTS, FRONT_ORDERS, FRONT_RESULTS, MAX_BATTLEFIELDS } from "../../runtime/fronts/constants.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { decodeFrontOrders } from "./nativeFrontLedger.js";
import { FRONTS_BLOCK_HEADING, FRONTS_BLOCK_MAX, alliesRule, battlefieldPowers, buildFrontsBlock } from "./frontPrompt.js";
import { runTurnFronts } from "./frontTurn.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.6, lat: 51.4, capital: true },
  { name: "Brod", lng: 23.3, lat: 51.2, capital: true },
  { name: "Northgate", lng: 21.4, lat: 51.9 },
  { name: "Mid", lng: 21.6, lat: 51.0 },
  { name: "Southwick", lng: 21.5, lat: 50.1 },
];
const sheet = syntheticMap({ layout: enlarge(["AAABBB", "AAABBB", "AAABBB", "AAABBB", "~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities });

// A battlefield as the engine leaves one after a week of fighting, with a
// formation of the world's taken into it.
const fought = async () => {
  const world = {
    regionOwnershipOverrides: Object.fromEntries(sheet.regions.map((region) => [region.id, sheet.controllerOf(region.id)])),
    countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } },
    wars: [{ id: "war-17", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01" }],
    battlefields: [],
    units: [{ id: "unit-1714", name: "1st Guards Tank Army", type: "armor", ownerCode: "Aland", strength: 80, lng: 21.1, lat: 51.3 }],
  };
  const run = await runTurnFronts({
    createFrontRun,
    // (Every side is left to the orders this test gives it: a side's own staff is tested in frontStaff.test.js.)
    staff: false,
    world,
    events: [{ id: "event-ai-r0002-20240304-001", date: "2024-03-04", title: "The offensive opens", description: "x", impacts: {} }],
    frontOrders: [
      { id: "front-0", battlefield: "The Border", side: "Aland", order: "spearhead", sector: "north", objective: "city: Brod", effort: "total", eventIds: ["event-ai-r0002-20240304-001"] },
      { id: "front-1", battlefield: "The Border", side: "Borduria", order: "dig in", sector: "all", eventIds: [] },
    ],
    warStages: [world.wars],
    fromDate: "2024-03-01",
    toDate: "2024-03-09",
    map: { key: "the sheet", cities: sheet.map.cities, flat: false },
    regionIds: sheet.regions.map((region) => region.id),
    arenas: new Map(),
    loadRegions: async () => sheet.regions,
    seed: "campaign|2",
  });
  return run.battlefields[0];
};

// Anything that reads as an id of the map's or the game's: a stock region
// ("UKR.4_1"), a drawn one ("r6-2"), a unit, a war, an event, an order.
const ID_LIKE = /\b[A-Z]{3}\.\d+(?:_\d+)?\b|\br\d+-\d+\b|\b(?:unit|war|event|front|marker|region)-[\w-]*\d[\w-]*\b/;

test("the block says how an order is written, what it sets aside, who may not be ordered, and how each battlefield stands", async () => {
  const record = await fought();
  const block = buildFrontsBlock({ battlefields: [record], players: ["Neutralia"] });
  const lines = block.split("\n");
  assert.equal(lines[0], FRONTS_BLOCK_HEADING);
  assert.equal(FRONTS_BLOCK_HEADING, "[Fronts]");
  // The sentence that sets aside the template's own rules on these battlefields.
  assert.match(lines[1], /On the battlefields below this replaces what the instructions above say of moving formations and taking regions: write no unitOps for their sides' land forces and no regionControlOps for their regions\./);
  assert.match(lines[1], /Fleets, air wings, garrisons, bases and land forces away from every battlefield move as before\./);
  // The format, field for field as the ledger reads it.
  assert.ok(lines.includes("battlefield~side~order~sector~eventNumbers~objective~result~effort"));
  assert.ok(block.includes("Orders go in frontOrders, one line each:"));
  for (const word of FRONT_ORDERS) assert.ok(new RegExp(`(\\| |: )${word}( \\||\\.)`).test(block), `the order "${word}" is offered`);
  for (const word of FRONT_RESULTS) assert.ok(block.includes(word), `the result "${word}"`);
  for (const word of FRONT_EFFORTS) assert.ok(block.includes(word), `the effort "${word}"`);
  assert.match(block, /An assault sends the troops it takes straight at its objective, which it must have: `city: X`, `structure: X` or `unit: X`\./);
  assert.match(block, /A border with no war is `border: A \/ B`, the two countries by their exact names: with dig in or hold, troops are sent to fortify it and attack nothing; with an order to attack from one of the two at effort major or total, that country invades the other and the war between them begins that day/);
  assert.match(block, /Any country may strike first so, at one a person plays as at any other, when the story has it do so\./);
  assert.match(block, /Sent in peace to another country's land it is an attack on it: the war begins the day its troops are put down\./);
  assert.match(block, /A war begun in this answer has none yet: name its battlefield yourself in its first order\./);
  // Its own examples are lines the ledger reads without a complaint.
  const examples = lines.filter((line) => line.startsWith("Eastern Ukraine~"));
  assert.equal(examples.length, 2);
  assert.deepEqual(decodeFrontOrders(examples.join("\n")).map(({ side, order, sector, objective, result, effort, problem }) => [side, order, sector, objective, result, effort, problem]), [
    ["Russia", "spearhead", "north", "city: Kharkiv", "", "major", undefined],
    ["Russia", "", "south", "city: Mariupol", "captured", "", undefined],
  ]);
  // A person's side.
  assert.ok(lines.some((line) => line.startsWith("Neutralia is played by a person: write no order for it of your own.")));
  // The battlefield, as its own brief words it.
  assert.ok(lines.includes("Battlefields open now:"));
  const brief = describeBattlefield(record);
  assert.ok(block.endsWith(brief), "told in full, last");
  assert.match(brief, /^- The Border: Aland against Borduria, open since 2024-03-01, line \d+ km\n {2}Strength: Aland \d+ formations/);
  assert.match(brief, /Standing orders: Aland: north spearhead toward city: Brod \(total\); elsewhere hold\. Borduria: all dig in \(major\)\./);
  assert.match(brief, /Sectors: north, centre, south(, [a-z]+)*, or a place on the line\.$/);
  assert.ok(block.length <= FRONTS_BLOCK_MAX);
});

test("nothing in the block is an id", async () => {
  const record = await fought();
  assert.deepEqual(record.named.map((entry) => entry.unitId), ["unit-1714"], "the record itself knows the formation by its id");
  assert.equal(record.warId, "war-17");
  const block = buildFrontsBlock({ battlefields: [record, { ...record, name: "The Southern Front", warId: "war-18" }], players: ["Aland"] });
  for (const region of sheet.regions) assert.ok(!block.includes(region.id), `no region id (${region.id})`);
  assert.doesNotMatch(block, ID_LIKE);
  assert.equal(block.includes("unit-1714") || block.includes("war-17") || block.includes("event-ai"), false);
  // Places carry their kind.
  assert.match(block, /city: Brod/);
  assert.equal(/toward Brod\b/.test(block), false);
});

test("the block never outgrows its length: the battlefields a turn is most about are told in full, the rest in a line, and what is left out is counted", async () => {
  const record = await fought();
  const long = (index) => `The Great Northern and Eastern Front of the Second Continental War, sector ${index + 1}`.slice(0, 80);
  const many = Array.from({ length: MAX_BATTLEFIELDS }, (_, index) => ({
    ...record,
    name: long(index),
    status: index % 3 === 2 ? "frozen" : "active",
    sides: index === 7
      ? [["Neutralia", "The Kingdom of Cisland"], ["The Bordurian Commonwealth"]]
      : [["The United Provinces of Aland", "The Kingdom of Cisland", "The Free Cities"], ["The Bordurian Commonwealth", "The Eastern Confederation"]],
    brief: { ...record.brief, km: 100 + index * 50 },
  }));
  const block = buildFrontsBlock({ battlefields: many, players: ["Neutralia"] });
  assert.ok(block.length <= FRONTS_BLOCK_MAX, `${block.length} characters`);
  assert.ok(block.length > FRONTS_BLOCK_MAX - 700, "and the room is used");
  const listed = block.split("\n").filter((line) => line.startsWith("- The Great Northern"));
  assert.equal(listed.length, MAX_BATTLEFIELDS, "every battlefield is there to be ordered by name");
  const full = block.split("\n").filter((line) => line.startsWith("  Strength: ")).length;
  assert.ok(full >= 2 && full < MAX_BATTLEFIELDS, `${full} told in full`);
  // The one a person fights on comes first, then the longest lines being fought over.
  assert.ok(listed[0].startsWith(`- ${long(7)}: Neutralia, The Kingdom of Cisland against`));
  assert.ok(listed[1].startsWith(`- ${long(10)}:`), "the longest active line next");
  // The least a battlefield is told in still names it and who leads each side.
  assert.equal(listed.at(-1), `- ${long(2)}: The United Provinces of Aland and 2 allies against The Bordurian Commonwealth and 1 ally.`);
  assert.doesNotMatch(block, ID_LIKE);

  // With shorter names there is room to give the ones not told in full their
  // sides and the sector words that fit them.
  const plainly = many.map((entry, index) => ({ ...entry, name: `Front ${index + 1}`, sides: [["Aland", "Cisland"], ["Borduria"]] }));
  const plain = buildFrontsBlock({ battlefields: plainly, players: [] });
  assert.ok(plain.length <= FRONTS_BLOCK_MAX);
  assert.ok(plain.split("\n").filter((line) => line.startsWith("  Strength: ")).length >= 4);
  // How much room is left over after those told in full depends on how long
  // the engine's own telling of a battlefield is, so the fuller line is looked
  // for across a run of lengths: at some of them there is room for it.
  const fuller = /^- Front \d+: Aland, Cisland against Borduria, line \d+ km\. Sectors: north, centre, south(, [a-z]+)*, or a place on the line\.$/;
  const lengths = Array.from({ length: 60 }, (_, step) => 5900 + step * 60);
  assert.ok(lengths.some((max) => buildFrontsBlock({ battlefields: plainly, players: [], max }).split("\n").some((line) => fuller.test(line))));

  // Held to whatever length it is given, and saying what it had to leave out.
  for (const max of [5500, 4300, 3500, 3000]) {
    const tight = buildFrontsBlock({ battlefields: many, players: ["Neutralia"], max });
    assert.ok(tight.length <= max, `${tight.length} of ${max}`);
    assert.ok(tight.startsWith(FRONTS_BLOCK_HEADING));
  }
  // (Room for a few lines past the rules themselves, however long those are: with what is said of a player's allies there.)
  const rules = buildFrontsBlock({ battlefields: [], players: ["Neutralia"] }).length + alliesRule(many, ["Neutralia"]).length + 1;
  const tight = buildFrontsBlock({ battlefields: many, players: ["Neutralia"], max: rules + 560 });
  const shown = tight.split("\n").filter((line) => line.startsWith("- The Great Northern")).length;
  assert.ok(shown > 0 && shown < MAX_BATTLEFIELDS);
  assert.ok(tight.endsWith(`(${MAX_BATTLEFIELDS - shown} more battlefields are open and not listed.)`));
});

test("a battlefield that has closed is not listed, and a world with none says so", async () => {
  const record = await fought();
  const none = buildFrontsBlock({ battlefields: [], players: ["Aland"] });
  assert.ok(none.endsWith("\nNo battlefield is open now."));
  assert.ok(none.includes("battlefield~side~order~sector~eventNumbers~objective~result~effort"), "the rules are still there: a war may begin in this very answer");
  const { field: _field, ...ended } = record;
  assert.equal(buildFrontsBlock({ battlefields: [{ ...ended, status: "closed", closedDate: "2024-03-09" }], players: ["Aland"] }), none);
  assert.equal(buildFrontsBlock({ battlefields: "junk", players: ["Aland"] }), none);
  // Nobody plays a side: no rule about players.
  assert.equal(buildFrontsBlock({ battlefields: [] }).includes("played by a person"), false);
  assert.match(buildFrontsBlock({ battlefields: [], players: ["Aland", "Borduria", "Cisland"] }), /\nAland, Borduria and Cisland are each played by a person: write no order for them of your own\./);
});

test("who a battlefield fields: the members of the sides of every one fought on or frozen, once each", async () => {
  const record = await fought();
  const { field: _field, ...ended } = record;
  assert.deepEqual(battlefieldPowers([
    record,
    { ...record, name: "The Southern Front", sides: [["aland", "Cisland"], ["Borduria"]] },
    { ...ended, name: "An old front", status: "closed", sides: [["Syldavia"], ["Borduria"]] },
  ]), ["Aland", "Borduria", "Cisland"]);
  assert.deepEqual(battlefieldPowers(undefined), []);
});
