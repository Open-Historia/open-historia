/*! Open Historia — a war's sides written a field early: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warSidesShifted.test.js
//
// A player at war with Ireland had no War Room (battle-of-europe-session-2,
// beta 0.0.95, 2026-10-25). The time skip wrote its war start with the event
// numbers where the opponents go, and the war was kept as the United Kingdom
// AND Ireland against "1" and "2": nobody was at war with Ireland, so no front
// opened, and the War Room button needs one.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeWarUpdates, splitOneSidedWar } from "./nativeWarLedger.js";
import { normalizeWorldState } from "../../runtime/gameState.js";

test("a war start with its event numbers where the opponents go is read with each in its place", () => {
  const [update] = decodeWarUpdates("war-uk-ireland-2016~start~United Kingdom,Ireland~1,2~The Anglo-Irish War|Britain invades");
  assert.deepEqual([update.op, update.actors, update.opponents, update.eventIndexes, update.note], ["start", ["United Kingdom"], ["Ireland"], [0, 1], "The Anglo-Irish War|Britain invades"]);
  // A record written right is read as it always was.
  const [right] = decodeWarUpdates("war-x~start~France~Germany~3~The War|cause");
  assert.deepEqual([right.actors, right.opponents, right.eventIndexes, right.note], [["France"], ["Germany"], [2], "The War|cause"]);
  // A side is polities: numbers are never one.
  const [numbers] = decodeWarUpdates("war-y~join-b~Italy,4~~5~");
  assert.deepEqual(numbers.actors, ["Italy"]);
  // Two parties written together are split only where there are two; three cannot be told apart.
  assert.deepEqual(splitOneSidedWar(["A", "B"], []), [["A"], ["B"]]);
  assert.deepEqual(splitOneSidedWar(["A", "B", "C"], []), [["A", "B", "C"], []]);
  assert.deepEqual(splitOneSidedWar(["A"], ["B"]), [["A"], ["B"]]);
});

test("a war already kept that way is the two of them against each other when the game is read", () => {
  const world = normalizeWorldState({
    wars: [
      { id: "war-uk-ireland-2016", status: "active", sideA: ["United Kingdom", "Ireland"], sideB: ["1", "2"], startedDate: "2016-06-03" },
      { id: "war-ok", status: "active", sideA: ["France", "Belgium"], sideB: ["Germany"], startedDate: "2016-06-03" },
    ],
  });
  const sides = Object.fromEntries(world.wars.map((war) => [war.id, [war.sideA, war.sideB]]));
  assert.deepEqual(sides["war-uk-ireland-2016"], [["United Kingdom"], ["Ireland"]]);
  assert.deepEqual(sides["war-ok"], [["France", "Belgium"], ["Germany"]], "a war kept right is left as it is");
});
