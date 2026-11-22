/*! Open Historia — battlefields and fronts: ground taken inside a group's area: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/groupOccupation.test.js
//
// The owner's ruling (2026-11-09) on ground taken inside a group's area:
// "only if the war is against the group. otherwise the group keeps its occupation." And "if someone is at war
// with a group on territory they do not own, it should create another group there that takes the area from the
// group without actually annexing the territory from whatever country that is in."
import test from "node:test";
import assert from "node:assert/strict";
import { runFronts } from "./engine.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { readBattlefield } from "./testKit.js";

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const sheet = (layout) => syntheticMap({ layout, legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "group-occupation" });
const strong = (name) => (name === "Aland" ? 4 : 1);
const regionsOf = (world, letter) => world.regions.filter((region) => world.controllerOf(region.id) === legend[letter]).map((region) => region.id);
const areaOf = (ids, name) => Object.fromEntries(ids.map((id) => [id, name]));
// Aland's war, fought for `days` with Aland advancing all along the line of its one battlefield.
const fight = (world, { wars, groupAreas, groups = [], owners = {}, days = 40, battlefields = [], fromDate } = {}) => {
  const base = { wars, groupAreas, isGroup: (name) => groups.includes(name), groupOwnerOf: (name) => owners[name] ?? "", strengthOf: strong, arenas: new Map() };
  const opened = battlefields.length ? battlefields : runFronts(frontInput(world, { ...base, days: 0 })).battlefields;
  assert.equal(opened.filter((record) => record.status === "active").length, 1, "the war is fought on one battlefield");
  const moments = [{ day: 0, type: "order", battlefield: opened[0].name, side: "Aland", order: "advance", sector: "all", effort: "major" }];
  return runFronts(frontInput(world, { ...base, battlefields: opened, moments, days, ...(fromDate ? { fromDate } : {}) }));
};

test("a country at war with a country takes ground inside a group's area as usual, and the group outside the war keeps its area", () => {
  const world = sheet(["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"]);
  // The Free Hills hold all of Borduria, and are in nobody's war.
  const hills = areaOf(regionsOf(world, "B"), "Free Hills");
  const wars = [{ id: "war-1", title: "w", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }];
  const result = fight(world, { wars, groupAreas: hills, groups: ["Free Hills"] });
  const taken = result.flips.filter((flip) => flip.kind === "control");
  assert.ok(taken.length > 0, "Aland takes Borduria's ground");
  for (const flip of taken) assert.deepEqual([flip.from, flip.to], ["Borduria", "Aland"]);
  assert.deepEqual(result.flips.filter((flip) => flip.kind !== "control"), [], "nothing of the Free Hills' area is moved");
  assert.deepEqual(applyFlips(world, result.flips, hills), hills, "the Free Hills keep their occupation");
});

test("a country at war with a group takes back its own land from it: the group loses it, and nobody's control changes", () => {
  const world = sheet(["AAAAAAAA", "AAAAAAAA", "AAAAAAAA", "AAAAAAAA"]);
  // The Free Hills hold Aland's east.
  const east = world.regions.filter((region) => Number(region.id.slice(1).split("-")[0]) >= 4).map((region) => region.id);
  const hills = areaOf(east, "Free Hills");
  const wars = [{ id: "war-1", title: "w", status: "active", sideA: ["Aland"], sideB: ["Free Hills"] }];
  const result = fight(world, { wars, groupAreas: hills, groups: ["Free Hills"] });
  assert.ok(result.flips.length > 0, "Aland wins ground back");
  for (const flip of result.flips) assert.deepEqual([flip.kind, flip.from], ["groupRelease", "Free Hills"]);
  const after = applyFlips(world, result.flips, hills);
  assert.ok(Object.keys(after).length < east.length, "the Free Hills' area shrinks");
  for (const id of east) assert.equal(world.controllerOf(id), "Aland");
});

test("a country at war with a group on a third country's land takes that ground as a force of its own, and annexes nothing", () => {
  const world = sheet(["AAAANNNN", "AAAANNNN", "AAAANNNN", "AAAANNNN"]);
  // The Free Hills hold all of Neutralia, which is at war with nobody.
  const neutral = regionsOf(world, "N");
  const hills = areaOf(neutral, "Free Hills");
  const wars = [{ id: "war-1", title: "w", status: "active", sideA: ["Aland"], sideB: ["Free Hills"] }];
  const result = fight(world, { wars, groupAreas: hills, groups: ["Free Hills"], days: 5 });
  assert.ok(result.flips.length > 1, "Aland takes ground from the Free Hills");
  for (const flip of result.flips) {
    assert.deepEqual([flip.kind, flip.from, flip.to, flip.owner, flip.land], ["groupTake", "Free Hills", "Aland Forces in Neutralia", "Aland", "Neutralia"], JSON.stringify(flip));
  }
  // One force for all of it, and Neutralia keeps every region.
  const after = applyFlips(world, result.flips, hills);
  for (const id of neutral) assert.equal(world.controllerOf(id), "Neutralia");
  const forces = neutral.filter((id) => after[id] === "Aland Forces in Neutralia");
  assert.equal(forces.length, result.flips.length);

  // On the battlefield that ground is Aland's side's, and the war goes on there the next run, the force told to
  // the engine as the world then has it: a group whose owner is Aland.
  const [record] = result.battlefields;
  assert.deepEqual(record.sides, [["Aland"], ["Free Hills"]], "nobody new joins the war");
  const seen = readBattlefield(record, world);
  for (const id of forces) {
    const [west, south, east, north] = world.regions.find((region) => region.id === id).bbox;
    assert.equal(seen.holderAt((west + east) / 2, (south + north) / 2), 0, `${id} is Aland's side's`);
  }
  const next = fight(world, {
    wars,
    groupAreas: after,
    groups: ["Free Hills", "Aland Forces in Neutralia"],
    owners: { "Aland Forces in Neutralia": "Aland" },
    battlefields: result.battlefields,
    fromDate: result.battlefields[0].asOf,
    days: 40,
  });
  assert.deepEqual(next.battlefields.map((entry) => entry.name), [record.name], "the same battlefield, and no other");
  assert.ok(next.flips.length > 0, "the war goes on");
  for (const flip of next.flips) {
    assert.deepEqual([flip.kind, flip.to, flip.owner], ["groupTake", "Aland Forces in Neutralia", "Aland"], "the force it has there takes the rest");
  }
  const last = applyFlips(world, next.flips, after);
  for (const id of neutral) assert.equal(world.controllerOf(id), "Neutralia");
  assert.ok(neutral.filter((id) => last[id] === "Aland Forces in Neutralia").length > forces.length);
});

test("ground of an ally's the group held goes back to the ally, and a force's name another group has is passed over", () => {
  // Borduria is Aland's ally in its war with the Free Hills, who hold Borduria's and Neutralia's land.
  const world = sheet(["AAAABBNN", "AAAABBNN", "AAAABBNN", "AAAABBNN"]);
  const hills = areaOf([...regionsOf(world, "B"), ...regionsOf(world, "N")], "Free Hills");
  const wars = [{ id: "war-1", title: "w", status: "active", sideA: ["Aland", "Borduria"], sideB: ["Free Hills"] }];
  // A group of the force's name is somebody else's: Aland's force is the next name.
  const result = fight(world, { wars, groupAreas: hills, groups: ["Free Hills", "Aland Forces in Neutralia"], days: 20 });
  const borduria = result.flips.filter((flip) => world.controllerOf(flip.regionId) === "Borduria");
  const neutral = result.flips.filter((flip) => world.controllerOf(flip.regionId) === "Neutralia");
  assert.ok(borduria.length > 0 && neutral.length > 0, JSON.stringify(result.flips));
  for (const flip of borduria) assert.deepEqual([flip.kind, flip.from], ["groupRelease", "Free Hills"]);
  for (const flip of neutral) assert.deepEqual([flip.kind, flip.to, flip.owner], ["groupTake", "Aland Forces in Neutralia (2)", "Aland"]);
});

test("a group at war with a country takes nothing in name inside the area of a group outside that war", () => {
  const world = sheet(["NNNNBBBB", "NNNNBBBB", "NNNNBBBB", "NNNNBBBB"]);
  // Here "Aland" is a group (the strong side: strengthOf), risen in Borduria's west and at war with it; the Free
  // Hills, in nobody's war, hold Borduria's east.
  const west = world.regions.filter((region) => world.controllerOf(region.id) === "Borduria" && Number(region.id.slice(1).split("-")[0]) < 6).map((region) => region.id);
  const eastHills = world.regions.filter((region) => world.controllerOf(region.id) === "Borduria" && Number(region.id.slice(1).split("-")[0]) >= 6).map((region) => region.id);
  const areas = { ...areaOf(west, "Aland"), ...areaOf(eastHills, "Free Hills") };
  const wars = [{ id: "war-1", title: "w", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }];
  const result = fight(world, { wars, groupAreas: areas, groups: ["Aland", "Free Hills"] });
  for (const flip of result.flips) assert.notEqual(flip.from, "Free Hills", JSON.stringify(flip));
  const after = applyFlips(world, result.flips, areas);
  for (const id of eastHills) assert.equal(after[id], "Free Hills", "the Free Hills keep their occupation");
});
