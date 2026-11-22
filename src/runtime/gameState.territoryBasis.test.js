/*! Open Historia — a border moves for held ground or agreement, never for a declaration © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.territoryBasis.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
// The vocabulary itself is tested bare in territoryBasis.test.js.
//
// The net in applyPolityAndTerritoryImpacts, and the field's trip through a
// save. The turn validator normally screens a jump's answer first and tells the
// model what it did; these cover the impacts that never meet it — the Game
// Master console, a project's stored completion effects, a hand-edited save —
// and the one property everything else rests on: an entry that does NOT state a
// basis behaves exactly as it did before the field existed.

import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld, normalizeEvents, normalizeWorldState } from "./gameState.js";

const event = (impacts) => ({ date: "1936-05-09", title: "Test", description: "test", impacts });
const world = () => ({
  polityOverrides: {},
  regionOwnershipOverrides: { TIGRAY: "Ethiopia", SHEWA: "Ethiopia", HARAR: "Ethiopia" },
});

test("a transfer that states no basis moves the border, as it always has", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({ regionTransfers: [{ regionId: "SHEWA", fromCode: "Ethiopia", toCode: "Italy" }] })],
  });
  assert.equal(next.regionOwnershipOverrides.SHEWA, "Italy");
  assert.equal(next.regionClaimants.SHEWA, undefined);
});

test("held ground and agreement move the border", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({
      regionTransfers: [{ regionId: "SHEWA", fromCode: "Ethiopia", toCode: "Italy", basis: "treaty" }],
      regionControlOps: [{ op: "control", regionId: "HARAR", fromCode: "Ethiopia", toCode: "Italy", basis: "occupation" }],
    })],
  });
  assert.equal(next.regionOwnershipOverrides.SHEWA, "Italy");
  assert.equal(next.regionOwnershipOverrides.HARAR, "Italy");
});

test("a proclaimed annexation of land not held leaves the border alone and stripes the region", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({ regionTransfers: [{ regionId: "TIGRAY", fromCode: "Ethiopia", toCode: "Italy", basis: "claim" }] })],
  });
  assert.equal(next.regionOwnershipOverrides.TIGRAY, "Ethiopia", "the border did not move");
  assert.equal(next.regionSovereigntyOverrides?.TIGRAY, undefined, "and neither did the title");
  assert.deepEqual(next.regionClaimants.TIGRAY, ["Italy"], "the declaration is on the map as a dispute");
});

test("a threat and a raid change nothing at all", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({
      regionTransfers: [{ regionId: "TIGRAY", fromCode: "Ethiopia", toCode: "Italy", basis: "threat" }],
      regionControlOps: [{ op: "control", regionId: "HARAR", fromCode: "Ethiopia", toCode: "Italy", basis: "raid" }],
    })],
  });
  assert.equal(next.regionOwnershipOverrides.TIGRAY, "Ethiopia");
  assert.equal(next.regionOwnershipOverrides.HARAR, "Ethiopia");
  assert.equal(next.regionClaimants.TIGRAY, undefined);
  assert.equal(next.regionClaimants.HARAR, undefined);
});

test("a claim by a polity nobody has heard of still founds it, like any other claim", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({ regionTransfers: [{ regionId: "TIGRAY", fromCode: "Ethiopia", toCode: "Tigrayan Provisional Council", basis: "claim" }] })],
  });
  assert.deepEqual(next.regionClaimants.TIGRAY, ["Tigrayan Provisional Council"]);
  assert.ok(next.polityOverrides["Tigrayan Provisional Council"], "the claimant exists afterwards");
  assert.equal(next.regionOwnershipOverrides.TIGRAY, "Ethiopia");
});

test("the claim a screened transfer leaves behind is settled by a real transfer later", () => {
  const first = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({ regionTransfers: [{ regionId: "TIGRAY", fromCode: "Ethiopia", toCode: "Italy", basis: "claim" }] })],
  });
  const second = applyEventImpactsToWorld({
    colors: first.colors,
    world: first.world,
    events: [event({ regionTransfers: [{ regionId: "TIGRAY", fromCode: "Ethiopia", toCode: "Italy", basis: "occupation" }] })],
  });
  assert.equal(second.world.regionOwnershipOverrides.TIGRAY, "Italy");
  assert.equal(second.world.regionClaimants.TIGRAY, undefined, "the dispute ends when the ground is taken");
});

test("the basis survives a save, a word that is none of ours is left out in any language, and an entry without one is unchanged", () => {
  const [stored] = normalizeEvents(JSON.parse(JSON.stringify([event({
    regionTransfers: [
      { regionId: "A", toCode: "Italy", basis: "Claim" },
      { regionId: "B", toCode: "Italy", basis: "vibes" },
      { regionId: "C", toCode: "Italy" },
      { regionId: "E", toCode: "Italy", basis: "Proclamation" },
      { regionId: "F", toCode: "Italy", basis: "proclamation" },
    ],
    regionControlOps: [
      { op: "control", regionId: "D", fromCode: "Ethiopia", toCode: "Italy", basis: "occupation" },
      { op: "control", regionId: "G", fromCode: "Ethiopia", toCode: "Italy", basis: "liberation" },
      { op: "control", regionId: "H", fromCode: "Ethiopia", toCode: "Italy", basis: "libération" },
    ],
  })])));
  assert.equal(stored.impacts.regionTransfers[0].basis, "claim");
  assert.equal("basis" in stored.impacts.regionTransfers[1], false, "an unknown word is treated as absent");
  // Byte-for-byte what a transfer looked like before the field existed.
  assert.deepEqual(stored.impacts.regionTransfers[2], { fromCode: "", note: "", regionId: "C", regionName: "", toCode: "Italy" });
  // An English synonym is no more one of ours than its French twin.
  assert.equal("basis" in stored.impacts.regionTransfers[3], false);
  assert.equal("basis" in stored.impacts.regionTransfers[4], false);
  assert.equal(stored.impacts.regionControlOps[0].basis, "occupation");
  assert.equal("basis" in stored.impacts.regionControlOps[1], false);
  assert.equal("basis" in stored.impacts.regionControlOps[2], false);
});

test("only the newest receipt keeps its notes, and an entry above it that has none does not cost them", () => {
  const receipt = (text) => ({ applied: { events: 2 }, notes: [{ kind: "dropped", text }] });
  const normalized = normalizeWorldState({
    simulationHistory: [
      { mode: "game-master", date: "1936-06-02", summary: "a correction" },
      { mode: "jump", date: "1936-06-01", receipt: receipt("the newest jump's note") },
      { mode: "jump", date: "1936-03-01", receipt: receipt("an older jump's note") },
      { mode: "jump", date: "1935-12-01", receipt: "not a receipt" },
    ],
  }).simulationHistory;

  assert.equal("receipt" in normalized[0], false);
  assert.deepEqual(normalized[1].receipt.notes, [{ kind: "dropped", text: "the newest jump's note" }]);
  assert.deepEqual(normalized[2].receipt.notes, [], "older turns keep their counts alone");
  assert.equal(normalized[2].receipt.applied.events, 2);
  assert.equal("receipt" in normalized[3], false, "a malformed receipt is dropped, not kept raw");

  // And it is stable: what was written is what is read back.
  const again = normalizeWorldState(JSON.parse(JSON.stringify({ simulationHistory: normalized }))).simulationHistory;
  assert.deepEqual(again, normalized);
});
