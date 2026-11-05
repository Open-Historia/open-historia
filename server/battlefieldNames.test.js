/*! Open Historia — a renamed country or group, in the battlefields it fights on: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test server/battlefieldNames.test.js
//
// A battlefield names its sides' members by exact name, so a rename has to
// reach it by every road a rename takes: the world's own re-keying, an event
// that renames a country, and a group renamed by a group operation.

import test from "node:test";
import assert from "node:assert/strict";

import { renameInBattlefields } from "./battlefieldNames.js";
import { renamePolityInWorld } from "./polityRename.js";
import { applyEventImpactsToWorld, normalizeWorldState } from "../src/runtime/gameState.js";
import { createFrame } from "../src/runtime/fronts/frame.js";

const battlefield = (overrides = {}) => ({
  name: "Prussia - France front",
  warId: "war-1",
  status: "active",
  sides: [["Prussia", "Bavaria"], ["France"]],
  openedDate: "1870-07-19",
  asOf: "1870-08-01",
  frame: createFrame({ west: 4, south: 47, east: 10, north: 51 }),
  orders: [
    { s: 0, sector: "all", order: "advance", since: "1870-08-01", by: "Prussia" },
    { s: 1, sector: "all", order: "hold", since: "1870-08-01", by: "France" },
  ],
  ...overrides,
});

test("the member and whoever gave an order are renamed; the battlefield's own name is not", () => {
  const list = [battlefield()];
  const renamed = renameInBattlefields(list, "Prussia", "Germany");
  assert.deepEqual(renamed[0].sides, [["Germany", "Bavaria"], ["France"]]);
  assert.equal(renamed[0].orders[0].by, "Germany");
  assert.equal(renamed[0].orders[1].by, "France");
  assert.equal(renamed[0].name, "Prussia - France front");
  assert.equal(list[0].sides[0][0], "Prussia", "the list handed in is not written to");
});

test("what the map draws by name is renamed too: the colours of taken ground, and whose a region is still drawn as", () => {
  const replay = {
    d: "1870-07-19", n: 12, s: 0, e: 12, t: ["", ""], m: "", p: "",
    names: ["Prussia", "Bavaria", "France"],
    o: [["region-4", "France"], ["region-9", "Prussia"]],
    f: [[7, "region-4", "Prussia"], [9, "region-9", "France"]],
  };
  const list = [battlefield({ replay, contested: [["region-9", "Prussia"], ["region-2", "France"]] })];
  const [renamed] = renameInBattlefields(list, "Prussia", "Germany");
  assert.deepEqual(renamed.replay.names, ["Germany", "Bavaria", "France"], "in its place: painted ground names its colour by it");
  assert.deepEqual(renamed.replay.o, [["region-4", "France"], ["region-9", "Germany"]]);
  assert.deepEqual(renamed.replay.f, [[7, "region-4", "Germany"], [9, "region-9", "France"]]);
  assert.deepEqual(renamed.contested, [["region-9", "Germany"], ["region-2", "France"]]);
  assert.deepEqual(replay.names, ["Prussia", "Bavaria", "France"], "the record it was made from is not touched");
  // A replay nothing in it was renamed in is the same object: what was read from it stays read.
  const [other] = renameInBattlefields([battlefield({ replay: { ...replay, names: ["Austria"], o: [], f: [] }, sides: [["Prussia"], ["France"]] })], "Prussia", "Germany");
  assert.equal(other.replay.names[0], "Austria");
  const kept = battlefield({ replay, sides: [["Austria"], ["Italy"]], orders: [] });
  assert.notEqual(renameInBattlefields([kept], "Prussia", "Germany")[0].replay, replay);
  const untouched = battlefield({ replay: { ...replay, names: ["Austria", "Italy"], o: [["region-1", "Italy"]], f: [] }, sides: [["Prussia"], ["France"]] });
  assert.equal(renameInBattlefields([untouched], "Prussia", "Germany")[0].replay, untouched.replay);
});

test("a list nothing in it changed comes back as it was", () => {
  const list = [battlefield()];
  assert.equal(renameInBattlefields(list, "Austria", "Austria-Hungary"), list);
  assert.equal(renameInBattlefields(list, "", "Germany"), list);
  assert.equal(renameInBattlefields(null, "Prussia", "Germany"), null);
  assert.equal(renameInBattlefields(list, "prussia ", "Germany")[0].sides[0][0], "Germany", "any case");
  assert.equal(renameInBattlefields(list, "Prus", "Germany"), list, "nothing looser than the name");
});

test("a member keeps its place in its side, since a troop names its owner by it", () => {
  const renamed = renameInBattlefields([battlefield()], "Bavaria", "Kingdom of Bavaria");
  assert.deepEqual(renamed[0].sides[0], ["Prussia", "Kingdom of Bavaria"]);
});

test("renaming a country in the world re-keys its battlefields with everything else", () => {
  const world = {
    polityOverrides: { Prussia: { name: "Prussia" }, France: { name: "France" } },
    wars: [{ id: "war-1", status: "active", sideA: ["Prussia"], sideB: ["France"] }],
    battlefields: [battlefield()],
  };
  const result = renamePolityInWorld(world, "Prussia", "Germany");
  assert.deepEqual(result.world.battlefields[0].sides[0], ["Germany", "Bavaria"]);
  assert.deepEqual(result.world.wars[0].sideA, ["Germany"]);
  assert.deepEqual(normalizeWorldState(result.world).battlefields[0].sides[0], ["Germany", "Bavaria"]);
});

test("a group renamed by a group operation is renamed where it fights", () => {
  const world = normalizeWorldState({
    groups: { "The Commune": { name: "The Commune", description: "Paris in revolt.", color: "#e11d48" } },
    groupAreas: { PARIS: "The Commune" },
    battlefields: [battlefield({ name: "Paris", sides: [["France"], ["The Commune"]], orders: [] })],
  });
  const event = {
    id: "e1",
    date: "1871-04-01",
    title: "The Commune takes a new name",
    description: "x",
    impacts: { groupOps: [{ op: "update", name: "The Commune", newName: "The Federation of Communes" }] },
  };
  const applied = applyEventImpactsToWorld({ colors: {}, events: [event], world });
  assert.deepEqual(applied.world.battlefields[0].sides[1], ["The Federation of Communes"]);
});
