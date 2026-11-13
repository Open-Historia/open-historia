/*! Open Historia — a country split in two: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/countrySplit.test.js
//
// "make it so the ai can very easily create a civil war and split a country in 2" (the owner, 2026-11-10).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { readSplitPart, splitCountryOps, splitRegions } from "./countrySplit.js";
import { decodeWarUpdates } from "./nativeWarLedger.js";

test("a part is a side of the country or a place in it, with a share or half", () => {
  assert.deepEqual(readSplitPart("north"), { direction: "north", share: 0.5 });
  assert.deepEqual(readSplitPart("the North-East"), { direction: "northeast", share: 0.5 });
  assert.deepEqual(readSplitPart("southern half"), { direction: "south", share: 0.5 });
  assert.deepEqual(readSplitPart("east 30%"), { direction: "east", share: 0.3 });
  assert.deepEqual(readSplitPart("around Aleppo 40%"), { place: "Aleppo", share: 0.4 });
  assert.deepEqual(readSplitPart("region: Cyrenaica"), { place: "Cyrenaica", share: 0.5 });
  // Never a sliver nor the whole country.
  assert.equal(readSplitPart("west 2%").share, 0.15);
  assert.equal(readSplitPart("west 99%").share, 0.85);
});

// A country of three rows of four regions, from 30°E to 33°E and 35°N to 37°N; its capital in the middle of the east.
const grid = [];
for (let x = 0; x < 4; x += 1) for (let y = 0; y < 3; y += 1) grid.push({ id: `r${x}${y}`, name: `R${x}${y}`, centroid: [30 + x, 35 + y] });

test("the breakaway takes the side it is told, the government keeps its capital", () => {
  const east = splitRegions({ regions: grid, part: "east", capitalRegion: "r31" });
  assert.equal(east.ids.length, 6);
  assert.ok(!east.ids.includes("r31"));
  assert.ok(east.ids.includes("r30") && east.ids.includes("r32"));
  assert.ok(!east.ids.some((id) => id.startsWith("r0")));
  const north = splitRegions({ regions: grid, part: "north 25%" });
  assert.deepEqual(north.ids.sort(), ["r02", "r12", "r22"]);
});

test("a place: the regions nearest it, a region or a town of that name", () => {
  const around = splitRegions({ regions: grid, part: "around R00" });
  assert.equal(around.ids[0], "r00");
  assert.ok(around.ids.every((id) => ["r00", "r01", "r10", "r11", "r20", "r02", "r21"].includes(id)));
  const town = splitRegions({ regions: grid, part: "Port Town", places: [{ name: "Port Town", point: [33, 37] }] });
  assert.equal(town.ids[0], "r32");
  assert.equal(town.seed, "Port Town");
  // Nothing named: the far side from the capital.
  assert.equal(splitRegions({ regions: grid, part: "", capitalRegion: "r00" }).ids[0], "r32");
  // Named, the capital itself goes with the breakaway.
  assert.ok(splitRegions({ regions: grid, part: "R31", capitalRegion: "r31" }).ids.includes("r31"));
});

test("a country across the antimeridian splits by its own east and west", () => {
  const far = [{ id: "a", name: "A", centroid: [179, 60] }, { id: "b", name: "B", centroid: [-179, 60] }, { id: "c", name: "C", centroid: [170, 60] }, { id: "d", name: "D", centroid: [-170, 60] }];
  assert.deepEqual(splitRegions({ regions: far, part: "east" }).ids, ["d", "b"]);
});

test("a country of one region is not split", () => {
  assert.deepEqual(splitRegions({ regions: grid.slice(0, 1), part: "north" }).ids, []);
});

// The map as the skip's lookup context gives it.
const contextOf = ({ owners = { Syria: grid } } = {}) => ({
  resolveOwner: (name) => Object.keys(owners).find((owner) => owner.toLowerCase() === String(name ?? "").trim().toLowerCase()) || "",
  ownerRows: new Map(Object.entries(owners).map(([owner, rows]) => [owner, rows.map((row) => ({ ...row, owner }))])),
  cityRows: [{ name: "Capital City", coordinates: [33, 36], population: 2000000, capital: "primary" }],
  regionOfCity: (city) => (city.name === "Capital City" ? { id: "r31", owner: "Syria" } : null),
});
const run = async (impacts, { warUpdates = "", wars = [], player = "" } = {}) => {
  const candidate = { events: [{ title: "The army splits", impacts }], warUpdates };
  const containers = candidate.events.map((event, index) => ({ event, impacts: event.impacts, path: `$.events[${index}].impacts` }));
  const receipt = { notes: [] };
  const written = await splitCountryOps(candidate, containers, { receipt, lookupContext: async () => contextOf(), playerCountry: player, titleAt: () => "The army splits", wars });
  return { candidate, impacts, receipt, written };
};

test("one control entry is a civil war: half the country to the breakaway, and the war started", async () => {
  const { impacts, candidate, receipt, written } = await run({
    regionControlOps: [{ op: "control", regionId: "country: Syria", fromCode: "Syria", toCode: "Free Syrian Republic", part: "west", note: "The northern army defects." }],
  });
  assert.equal(written, 6);
  assert.equal(impacts.regionControlOps.length, 6);
  for (const op of impacts.regionControlOps) {
    assert.equal(op.op, "control");
    assert.equal(op.fromCode, "Syria");
    assert.equal(op.toCode, "Free Syrian Republic");
    assert.ok(!("part" in op) && !("wholeCountry" in op));
    assert.notEqual(op.regionId, "r31");
  }
  // The breakaway is founded by the event, once.
  assert.deepEqual(impacts.polityChanges, [{ operation: "create", code: "Free Syrian Republic" }]);
  const [war] = decodeWarUpdates(candidate.warUpdates);
  assert.equal(war.op, "start");
  assert.deepEqual([war.actors, war.opponents], [["Free Syrian Republic"], ["Syria"]]);
  assert.match(candidate.warUpdates, /Title: Syria Civil War;/);
  assert.match(receipt.notes[0].text, /Free Syrian Republic takes 6 of Syria's 12 regions \(west\), held in a civil war/);
});

test("a war already there, or one the answer starts, is not started again", async () => {
  const north = await run({ regionControlOps: [{ op: "control", regionId: "country: Syria", fromCode: "Syria", toCode: "North Syria", part: "north 25%" }] });
  assert.equal(north.impacts.regionControlOps.length, 3);
  const answered = await run(
    { regionControlOps: [{ op: "control", regionId: "country: Syria", fromCode: "Syria", toCode: "Rebels", part: "north" }] },
    { warUpdates: "war-syria~start~Rebels~Syria~1~Title: The Uprising" },
  );
  assert.equal(decodeWarUpdates(answered.candidate.warUpdates).length, 1);
  const standing = await run(
    { regionControlOps: [{ op: "control", regionId: "country: Syria", fromCode: "Syria", toCode: "Rebels", part: "north" }] },
    { wars: [{ id: "war-old", status: "active", sideA: ["Syria"], sideB: ["Rebels"] }] },
  );
  assert.equal(standing.candidate.warUpdates, "");
});

test("the player's own country loses at most a third in one entry; a country that is not there is not split", async () => {
  const mine = await run({ regionControlOps: [{ op: "control", regionId: "country: Syria", fromCode: "Syria", toCode: "Rebels", part: "south 80%" }] }, { player: "Syria" });
  assert.equal(mine.impacts.regionControlOps.length, 4);
  const nowhere = await run({ regionControlOps: [{ op: "control", regionId: "country: Atlantis", fromCode: "Atlantis", toCode: "Rebels", part: "north" }] });
  assert.equal(nowhere.impacts.regionControlOps.length, 0);
  assert.match(nowhere.receipt.notes[0].text, /the split of Atlantis \(north\) was not made: no country of that name holds land/);
  // An entry without a part is left to the resolver as it was.
  const whole = { op: "control", regionId: "country: Syria", fromCode: "Syria", toCode: "Rebels", wholeCountry: true };
  const left = await run({ regionControlOps: [whole] });
  assert.deepEqual(left.impacts.regionControlOps, [whole]);
  assert.equal(left.written, 0);
});

test("the skip is told how, and the game reads it before the transfers are resolved", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").split("\r\n").join("\n");
  assert.match(gameplay, /A civil war splits a country in ONE entry, never region by region/);
  const split = gameplay.indexOf("await splitCountryOps(candidate, containers");
  const resolve = gameplay.indexOf("const unresolvedTransfers = await resolveRegionTransfers(containers, world");
  assert.ok(split > 0 && split < resolve);
  const schemas = fs.readFileSync(new URL("./gameplaySchemas.js", import.meta.url), "utf8");
  // On a civil war's control entry; the prompt's [Levers] line explains it, the schema only points there.
  assert.equal((schemas.match(/part: SPLIT_PART_SCHEMA/g) ?? []).length, 1);
});
