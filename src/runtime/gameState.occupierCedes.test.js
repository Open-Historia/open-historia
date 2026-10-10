/*! Open Historia — an occupier that cedes what it holds gives up the holding with the title © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.occupierCedes.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// Seen in a 45-skip test (2026-10-09): the United States, holding four North
// Korean regions it had occupied, handed them to South Korea by a
// reunification treaty. Their sovereign changed and the United States stayed
// in control of all four, so the map never showed the country reunited. A
// transfer leaves a region with the power that physically holds it only when
// that power is a THIRD party to the transfer.

import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld } from "./gameState.js";

const event = (impacts) => ({ date: "2018-06-12", title: "Treaty", description: "test", impacts });
const occupied = () => ({
  polityOverrides: {},
  regionOwnershipOverrides: { HAMHUNG: "United States", WONSAN: "United States", SEOUL: "South Korea" },
  regionSovereigntyOverrides: { HAMHUNG: "North Korea", WONSAN: "North Korea" },
  regionClaimants: { HAMHUNG: ["North Korea"], WONSAN: ["North Korea"] },
});

test("the occupier hands the region over: the receiver holds it and owns it", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: occupied(),
    events: [event({ regionTransfers: [{ regionId: "HAMHUNG", fromCode: "United States", toCode: "South Korea", basis: "treaty" }] })],
  });
  assert.equal(next.regionOwnershipOverrides.HAMHUNG, "South Korea", "control passes with the title");
  assert.equal(next.regionSovereigntyOverrides?.HAMHUNG ?? "South Korea", "South Korea");
  assert.equal(next.regionClaimants.HAMHUNG, undefined, "a clean hand-over settles the dispute");
  // The region it was not asked to hand over is as it was.
  assert.equal(next.regionOwnershipOverrides.WONSAN, "United States");
});

test("a third party that holds the region keeps holding it", () => {
  // North Korea cedes Wonsan to South Korea on paper while the United States
  // still stands there: the title moves, the holder does not.
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: occupied(),
    events: [event({ regionTransfers: [{ regionId: "WONSAN", fromCode: "North Korea", toCode: "South Korea", basis: "treaty" }] })],
  });
  assert.equal(next.regionOwnershipOverrides.WONSAN, "United States");
  assert.equal(next.regionSovereigntyOverrides.WONSAN, "South Korea");
  assert.deepEqual(next.regionClaimants.WONSAN, ["South Korea"]);
});
