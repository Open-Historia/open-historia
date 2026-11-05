/*! Open Historia — battlefields and fronts: ground held is not ground disputed: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/heldRegions.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld, normalizeEvents, withoutBattlefieldDisputes } from "../gameState.js";
import { withoutHeldDisputes } from "../../Game/Map/useWorldState.js";
import { battlefieldHeldClaimants } from "./heldRegions.js";

const front = (extra = {}) => ({ name: "The Border", status: "active", sides: [["Russia", "Belarus"], ["Ukraine"]], ...extra });
const world = (extra = {}) => ({
  battlefields: [front()],
  regionOwnershipOverrides: { r1: "Russia", r2: "Russia", r3: "Russia", r4: "Ukraine", r5: "Russia", r6: "Ukraine" },
  // r1, r2, r5: taken by Russia from Ukraine. r3: held by Russia, lawfully Georgia's. r6: taken back by nobody.
  regionSovereigntyOverrides: { r1: "Ukraine", r2: "Ukraine", r3: "Georgia", r5: "ukraine" },
  regionClaimants: { r1: ["Ukraine"], r2: ["Ukraine", "Poland", "belarus"], r3: ["Georgia"], r4: ["Russia"], r5: ["Poland"] },
  ...extra,
});
const changes = (given) => Object.fromEntries(battlefieldHeldClaimants({
  battlefields: given.battlefields,
  owners: given.regionOwnershipOverrides,
  sovereigns: given.regionSovereigntyOverrides,
  claimants: given.regionClaimants,
}));

test("a region one side of a battlefield took from the other loses the claimants the battlefield accounts for, and no others", () => {
  // r1: Ukraine comes off, nobody is left. r2: Ukraine and Belarus (a member of the taker's side) come off, Poland's claim stands.
  // r3: lawfully Georgia's, which is on no battlefield with Russia: untouched. r4: no occupation at all, a plain claim: untouched.
  // r5: taken from Ukraine, but its only claimant is somebody else: nothing changes.
  assert.deepEqual(changes(world()), { r1: [], r2: ["Poland"] });
  // Whichever side holds it: Ukraine retaking a region that is lawfully Russia's is the same.
  assert.deepEqual(changes(world({
    regionOwnershipOverrides: { r9: "Ukraine" },
    regionSovereigntyOverrides: { r9: "Russia" },
    regionClaimants: { r9: ["Russia"] },
  })), { r9: [] });
  // A border only fortified in peace has taken nothing; a battlefield that has closed still accounts for what it took.
  assert.deepEqual(changes(world({ battlefields: [front({ status: "standing" })] })), {});
  assert.deepEqual(changes(world({ battlefields: [front({ status: "closed" })] })), { r1: [], r2: ["Poland"] });
  // Two members of the SAME side are no battlefield's two sides.
  assert.deepEqual(changes(world({
    regionOwnershipOverrides: { r9: "Russia" },
    regionSovereigntyOverrides: { r9: "Belarus" },
    regionClaimants: { r9: ["Belarus"] },
  })), {});
  for (const empty of [{}, world({ battlefields: [] }), world({ battlefields: "junk" }), world({ regionClaimants: null }), world({ regionSovereigntyOverrides: null })]) assert.deepEqual(changes(empty), {});
  assert.equal(battlefieldHeldClaimants().size, 0);
});

test("the world is cleaned of them when a turn's land war is written, and is itself when there is nothing to clean", () => {
  const before = world();
  const after = withoutBattlefieldDisputes(before);
  assert.deepEqual(after.regionClaimants, { r2: ["Poland"], r3: ["Georgia"], r4: ["Russia"], r5: ["Poland"] });
  // The region with nobody left is recorded as settled, so the claimants the map's own file may name do not stand in.
  assert.deepEqual(after.settledRegionClaims, ["r1"]);
  // Who controls it and whose it lawfully is are as they were.
  assert.equal(after.regionOwnershipOverrides, before.regionOwnershipOverrides);
  assert.equal(after.regionSovereigntyOverrides, before.regionSovereigntyOverrides);
  assert.deepEqual(before.regionClaimants.r1, ["Ukraine"], "the world given is not written to");
  assert.equal(withoutBattlefieldDisputes(after), after, "nothing left to clean: the same object");
  const peace = world({ battlefields: [] });
  assert.equal(withoutBattlefieldDisputes(peace), peace);
});

test("ground the front engine takes is controlled by the taker and lawfully the loser's, and is not made a disputed region", () => {
  const before = {
    regionOwnershipOverrides: { r1: "Ukraine", r2: "Ukraine", r3: "Russia" },
    regionSovereigntyOverrides: { r3: "Ukraine" },
    regionClaimants: { r2: ["Poland"], r3: ["Ukraine"] },
    polityOverrides: {
      Russia: { code: "Russia", name: "Russia", aliases: [], color: "", note: "" },
      Ukraine: { code: "Ukraine", name: "Ukraine", aliases: [], color: "", note: "" },
      Poland: { code: "Poland", name: "Poland", aliases: [], color: "", note: "" },
    },
  };
  const taken = (regionId, from, to, extra = {}) => ({ op: "control", regionId, fromCode: from, toCode: to, basis: "occupation", note: "The Border", ...extra });
  const events = normalizeEvents([{ id: "e1", date: "2024-03-04", title: "The line moves", description: "x", impacts: { regionControlOps: [
    taken("r1", "Ukraine", "Russia", { by: "front" }),
    taken("r2", "Ukraine", "Russia", { by: "front" }),
    // Taken back: it is its lawful holder's again, and nothing is left of the occupation.
    taken("r3", "Russia", "Ukraine", { by: "front" }),
  ] } }]);
  const { world: after } = applyEventImpactsToWorld({ colors: {}, events, world: before });
  assert.deepEqual([after.regionOwnershipOverrides.r1, after.regionSovereigntyOverrides.r1], ["Russia", "Ukraine"]);
  assert.equal(after.regionClaimants.r1, undefined, "held, not disputed: no stripes");
  assert.equal((after.settledRegionClaims ?? []).includes("r1"), false, "and nothing is said of a dispute it never had");
  assert.deepEqual(after.regionClaimants.r2, ["Poland"], "a dispute with somebody else stands");
  assert.deepEqual([after.regionOwnershipOverrides.r3, after.regionSovereigntyOverrides.r3, after.regionClaimants.r3], ["Ukraine", undefined, undefined]);

  // The same operation written by the story itself is an occupation as it always was: striped in its sovereign's colour.
  const written = normalizeEvents([{ id: "e2", date: "2024-03-05", title: "A town is seized", description: "x", impacts: { regionControlOps: [taken("r1", "Ukraine", "Russia")] } }]);
  const { world: occupied } = applyEventImpactsToWorld({ colors: {}, events: written, world: before });
  assert.deepEqual(occupied.regionClaimants.r1, ["Ukraine"]);
});

test("the map draws no stripes for such ground in a game saved before, and leaves every other claim as it was", () => {
  const state = world();
  const claimants = state.regionClaimants;
  const drawn = withoutHeldDisputes(claimants, state, state.regionOwnershipOverrides);
  assert.deepEqual(drawn, { r1: [], r2: ["Poland"], r3: ["Georgia"], r4: ["Russia"], r5: ["Poland"] });
  assert.equal(drawn.r3, claimants.r3);
  assert.deepEqual(claimants.r1, ["Ukraine"], "what it was given is not written to");
  // Nothing to take off: the very list it was given, so the map is not told anything changed.
  const peace = world({ battlefields: [] });
  assert.equal(withoutHeldDisputes(peace.regionClaimants, peace, peace.regionOwnershipOverrides), peace.regionClaimants);
});
