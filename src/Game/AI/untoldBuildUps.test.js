// Run: node --test src/Game/AI/untoldBuildUps.test.js
//
// A player's report (2026-11-05): Poland ordered "I build up my forces"; the skip told it as an event whose polity
// change raised Poland's military spending and manpower, and wrote no `home:` line, so no troops were called up.
import assert from "node:assert/strict";
import test from "node:test";

import { untoldBuildUps } from "./nativeFrontLedger.js";
import { buildFrontsBlock } from "./frontPrompt.js";

const ACTION = "action-0-mw2y9d8v-3ybdc8j";
const told = {
  id: "ev-2016-01-02-poland-build",
  date: "2016-01-02",
  title: "Polish Ministry of National Defence Initiates Broad Force Modernisation and Readiness Build-up",
  impacts: {
    actionIds: [ACTION],
    polityChanges: [{ operation: "update", code: "Poland", military: { spending: 2, manpower: 1 }, note: "Initiated national force build-up and readiness enhancement." }],
  },
};
const owners = new Map([[ACTION, "Poland"]]);

test("a player's ordered build-up told as a manpower rise calls their forces at home up", () => {
  const [order, ...rest] = untoldBuildUps([{ id: "ev-other", impacts: {} }, told], [], { humanSides: ["Poland"], owners });
  assert.equal(rest.length, 0);
  assert.equal(order.battlefield, "home: Poland");
  assert.equal(order.side, "Poland");
  assert.equal(order.order, "reinforce");
  assert.deepEqual(order.eventIds, ["ev-2016-01-02-poland-build"], "it rests on the event that carried the order out");
});

test("nothing is added where the answer wrote the line, nobody ordered it, or no men were raised", () => {
  const written = [{ battlefield: "home: Poland", side: "Poland", order: "reinforce" }];
  assert.deepEqual(untoldBuildUps([told], written, { humanSides: ["Poland"], owners }), [], "the answer's own line stands");
  assert.deepEqual(untoldBuildUps([told], [], { humanSides: ["Poland"], owners: new Map() }), [], "no order of the player's");
  assert.deepEqual(untoldBuildUps([told], [], { humanSides: ["Germany"], owners }), [], "a country nobody plays");
  const spendingOnly = { ...told, impacts: { ...told.impacts, polityChanges: [{ code: "Poland", military: { spending: 3 } }] } };
  assert.deepEqual(untoldBuildUps([spendingOnly], [], { humanSides: ["Poland"], owners }), [], "money alone raises nobody");
  const someoneElse = { ...told, impacts: { ...told.impacts, polityChanges: [{ code: "Germany", military: { manpower: 2 } }] } };
  assert.deepEqual(untoldBuildUps([someoneElse], [], { humanSides: ["Poland"], owners }), [], "only the player's own country");
});

test("the skip is told the build-up line with the player's own name", () => {
  const block = buildFrontsBlock({ battlefields: [], players: ["Poland"] });
  assert.match(block, /`home: Poland~Poland~reinforce~all~4`/);
  assert.doesNotMatch(block, /home: X~X/);
});
