/*! Open Historia — disputes drawn in the Workshop reach the game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/workshopDisputes.test.js
//
// A dispute drawn in the Scenario Workshop ("Disputed by") used to stripe the
// map and never reach the AI: the export wrote no world.regionClaimants, and
// every reader but the map read only the world's rows. The export writes them
// now, the world readers add the map file's own, and the Workshop opens with the
// world's disputes, by the rule the game reads them with.
//
// (The per-claimant "what it is" descriptions that came with this, 2026-09-22,
// were taken out again on 2026-09-25: disputed territory is plain claims again,
// and what a non-state actor is lives on its group — runtime/groups.js.)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { withMapClaims } from "../src/runtime/mapClaims.js";
import { claimStamper } from "../src/Editor/claimOverrides.js";
import { buildGameSeed } from "../src/Editor/exportPreset.js";

const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const region = (id, owner, extra = {}) => ({ type: "Feature", id, properties: { id, name: id, owner, typeId: "land", ...extra }, geometry: square });
const doc = (polities) => ({ name: "falklands", metadata: { kind: "import-world" }, types: [{ id: "land", name: "Land" }], features: [], colorOverrides: {}, flags: {}, tags: {}, polities });

test("the Workshop's export writes the map's disputes as the world's own list", () => {
  const seed = buildGameSeed(
    doc({ "United Kingdom": { name: "United Kingdom", code: "United Kingdom", aliases: ["United Kingdom"], status: "active", note: "" } }),
    { type: "FeatureCollection", features: [region("r1", "United Kingdom", { claimants: ["Argentina", "Argentina"] }), region("r2", "United Kingdom")] },
  );
  assert.deepEqual(seed.world.regionClaimants, { r1: ["Argentina"] }, "the AI reads world.regionClaimants, so the map's disputes go there too");
  assert.deepEqual(seed.world.settledRegionClaims, [], "a scenario starts with no dispute already over");
  assert.equal("role" in seed.world.polityOverrides["United Kingdom"], false, "no role field any more");
});

test("the Workshop opens with the world's disputes stamped over the map file's, as the game reads them", () => {
  const features = new Map(["a", "b", "c", "d"].map((id) => {
    const values = new Map([["claimants", id === "a" || id === "c" ? ["From the file"] : null]]);
    return [id, { getId: () => id, get: (key) => values.get(key), set: (key, value) => values.set(key, value) }];
  }));
  const stamp = claimStamper({ claimants: { a: ["From the world"], b: ["New in the world"], d: [] }, settled: ["c"] });
  for (const feature of features.values()) stamp(feature);
  assert.deepEqual(features.get("a").get("claimants"), ["From the world"], "a world row wins");
  assert.deepEqual(features.get("b").get("claimants"), ["New in the world"]);
  assert.equal(features.get("c").get("claimants"), null, "a settled dispute has no claimants");
  assert.equal(features.get("d").get("claimants"), null, "an empty world row ends it too");
  const untouched = { getId: () => "z", set: () => assert.fail("nothing to stamp") };
  claimStamper(null)(untouched);
});

test("the world is read with the map file's disputes, and nothing the world says is changed", () => {
  const catalog = [
    { id: "a", claimants: ["China"] },
    { id: "b", claimants: ["Argentina"] },
    { id: "c", claimants: ["Morocco"] },
    { id: "d" },
  ];
  const world = { regionClaimants: { b: ["United Kingdom"] }, settledRegionClaims: ["c"] };
  const read = withMapClaims(world, catalog);
  assert.deepEqual(read.regionClaimants, { a: ["China"], b: ["United Kingdom"] });
  assert.deepEqual(world.regionClaimants, { b: ["United Kingdom"] }, "the world passed in is not mutated");
  assert.equal(withMapClaims(world, [{ id: "b", claimants: ["Argentina"] }]), world, "nothing to add: the same object");
  assert.equal(withMapClaims(world, null), world);
});

test("both world readers see the map's disputes", () => {
  const reader = readFileSync(new URL("../src/runtime/gameState.js", import.meta.url), "utf8");
  assert.ok(reader.includes("withMapClaims(normalizeWorldState(raw), catalog)"), "readWorldStateView");
  assert.ok(reader.includes("getPrimedScenarioRegionCatalog(),"), "readWorldState");
});
