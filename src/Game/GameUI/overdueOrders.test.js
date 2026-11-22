/*! Open Historia — what the Actions panel says of an overdue order: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/overdueOrders.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { refusedOrdersKey, refusedOrdersOf } from "./overdueOrders.js";
import { normalizeWorldState } from "../../runtime/gameState.js";

const card = (title, actionIds, route) => ({ title, description: "", date: "1914-08-03", route, actionIds });

test("why an order's event was refused is found by the order's id, from the newest time skip", () => {
  const world = {
    simulationHistory: [
      // A Game Master's intervention answers no order: stepped over.
      { mode: "gm", eventIds: [], filedEvents: [card("GM card", ["order-a"], "EXACT_DUPLICATE")] },
      {
        mode: "jump",
        eventIds: ["e1"],
        filedEvents: [
          card("The fleet sails", ["order-a"], "UNSUPPORTED_REVERSAL"),
          card("The fleet sails again", ["order-a"], "EXACT_DUPLICATE"),
          card("Patrols", ["order-b"], "ROUTINE_MILITARY_NO_DELTA"),
          card("Nobody's", [], "EXACT_DUPLICATE"),
        ],
      },
      { mode: "jump", eventIds: ["e0"], filedEvents: [card("An older skip's", ["order-c"], "EXACT_DUPLICATE")] },
    ],
  };
  const refused = refusedOrdersOf(normalizeWorldState(world));
  assert.deepEqual(Object.keys(refused).sort(), ["order-a", "order-b"], "the newest skip's cards only, by the ids they cite");
  assert.equal(refused["order-a"].fate, "not-recorded");
  assert.match(refused["order-a"].note, /Contradicts what is already on the record/, "the first card that cites it");
  assert.equal(refused["order-b"].fate, "off-timeline");
  assert.equal(refusedOrdersKey(world), JSON.stringify(refusedOrdersOf(world)));
});

test("a world with no skip, or a skip that refused nothing, has no reasons", () => {
  assert.deepEqual(refusedOrdersOf({}), {});
  assert.deepEqual(refusedOrdersOf(null), {});
  assert.deepEqual(refusedOrdersOf({ simulationHistory: [{ mode: "jump", eventIds: ["e1"] }] }), {});
  assert.equal(refusedOrdersKey(undefined), "{}");
});
