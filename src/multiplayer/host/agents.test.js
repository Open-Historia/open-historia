/*! Open Historia — a player's agents in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/agents.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { agentOrderFor } from "./agents.js";

const LATVIA = "Republic of Latvia"; // the host's seat
const RUSSIA = "Russian Federation"; // a second person
const ESTONIA = "Republic of Estonia";
const options = { host: LATVIA, date: "2014-04-01", known: (country) => [LATVIA, RUSSIA, ESTONIA].includes(country) };
const spy = (id, owner, target, status = "active", extra = {}) => ({ id, owner, target, status, deployedAt: "2014-03-01", turnedAt: "", exposedAt: "", coverStory: "", suspected: false, ...extra });
const order = (world, board, seat, request) => agentOrderFor(world, board, seat, request, options);

test("a player places an agent of its own, which stands on its own board", () => {
  const result = order({ spies: [] }, [], RUSSIA, { op: "deploy", target: ESTONIA });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.world.spies.map((entry) => [entry.owner, entry.target, entry.status, entry.deployedAt]), [[RUSSIA, ESTONIA, "active", "2014-04-01"]]);
  assert.match(result.world.spySeal, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.board.map((project) => [project.name, project.kind, project.secrecy, project.ownerCode]), [[`Agent in ${ESTONIA}`, "operation", "covert", ""]]);
});

test("the game's own rules refuse in the game's own words", () => {
  assert.match(order({ spies: [] }, [], RUSSIA, { op: "deploy", target: RUSSIA }).error, /cannot spy on yourself/);
  assert.match(order({ spies: [] }, [], RUSSIA, { op: "deploy", target: "Atlantis" }).error, /Unknown country/);
  const one = order({ spies: [] }, [], RUSSIA, { op: "deploy", target: ESTONIA });
  assert.match(order(one.world, one.board, RUSSIA, { op: "deploy", target: ESTONIA }).error, /already deployed/);
  // Another player's agent in the same country is nothing to do with this one.
  assert.equal(order(one.world, [], LATVIA, { op: "deploy", target: ESTONIA }).error, undefined);
});

test("an agent is its owner's to call home; one from before owners were kept is the host seat's", () => {
  const world = { spies: [spy("s-ru", RUSSIA, ESTONIA), spy("s-old", "", ESTONIA)] };
  assert.match(order(world, [], LATVIA, { op: "recall", spy: "s-ru" }).error, /not one of your agents/);
  assert.match(order(world, [], RUSSIA, { op: "recall", spy: "s-old" }).error, /not one of your agents/);
  assert.equal(order(world, [], RUSSIA, { op: "recall", spy: "s-ru" }).world.spies[0].status, "recalled");
  assert.equal(order(world, [], LATVIA, { op: "recall", spy: "s-old" }).world.spies[1].status, "recalled");
});

test("a caught agent is the business of the country that caught it: sent home, or turned with a story to tell", () => {
  const world = { spies: [spy("s-in-ru", LATVIA, RUSSIA, "discovered"), spy("s-in-lv", RUSSIA, LATVIA, "discovered")] };
  // Latvia cannot decide the fate of its own agent caught in Russia.
  assert.match(order(world, [], LATVIA, { op: "expel", spy: "s-in-ru" }).error, /not an agent your service is holding/);
  assert.equal(order(world, [], RUSSIA, { op: "expel", spy: "s-in-ru" }).world.spies[0].status, "exposed");
  const turned = order(world, [], LATVIA, { op: "turn", spy: "s-in-lv", story: "  The fleet stays   in port. " });
  assert.deepEqual([turned.world.spies[1].status, turned.world.spies[1].coverStory, turned.world.spies[1].turnedAt], ["turned", "The fleet stays in port.", "2014-04-01"]);
  // The story can be changed later, by the country that turned it, and only once it is turned.
  assert.match(order(world, [], LATVIA, { op: "story", spy: "s-in-lv", story: "x" }).error, /has turned/);
  assert.equal(order(turned.world, [], LATVIA, { op: "story", spy: "s-in-lv", story: "New orders." }).world.spies[1].coverStory, "New orders.");
  assert.match(order(turned.world, [], RUSSIA, { op: "story", spy: "s-in-lv", story: "x" }).error, /has turned/);
  // An agent still at work is nobody's to expel.
  assert.match(order({ spies: [spy("s", RUSSIA, LATVIA)] }, [], LATVIA, { op: "expel", spy: "s" }).error, /not an agent your service is holding/);
});

test("calling an agent home closes its entry on its owner's board, and touches nobody else's", () => {
  const placed = order({ spies: [] }, [{ id: "p-1", name: "Rail programme", kind: "project", status: "active", ownerCode: "" }], RUSSIA, { op: "deploy", target: ESTONIA });
  assert.equal(placed.board.length, 2);
  const recalled = order(placed.world, placed.board, RUSSIA, { op: "recall", spy: placed.world.spies[0].id });
  const entry = recalled.board.find((project) => project.name === `Agent in ${ESTONIA}`);
  assert.equal(entry.status, "cancelled");
  assert.equal(recalled.board.find((project) => project.name === "Rail programme").status, "active");
});
