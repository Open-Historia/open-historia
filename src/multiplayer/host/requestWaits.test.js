/*! Open Historia — the host's word that a request waits for the round: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/requestWaits.test.js
//
// A request asked while a round is resolved is told at once that it waits for
// the round; one that asks the AI first and is still thinking when a round
// begins is told then; each is told once, and again on a reconnect.

import test from "node:test";
import assert from "node:assert/strict";

import { createRequestWaits } from "./requestWaits.js";

const recorder = () => {
  const told = [];
  return { told, tell: (device, message) => told.push([device, message]) };
};

test("a request asked while a round is resolved is told at once that it is held; one asked before is not", () => {
  const { told, tell } = recorder();
  const waits = createRequestWaits({ tell });
  waits.begin({ device: "d1", id: "a1", t: "order", resolving: false });
  assert.deepEqual(told, []);
  waits.begin({ device: "d1", id: "a2", t: "order", resolving: true });
  assert.deepEqual(told, [["d1", { t: "held", id: "a2" }]]);
  assert.equal(waits.held, 1);
  waits.end("d1", "a2");
  assert.equal(waits.held, 0);
});

test("a round that begins holds what the requests still thinking will write, and nothing else; each is told once", () => {
  const { told, tell } = recorder();
  const waits = createRequestWaits({ tell, thinking: new Set(["institution", "sheet"]) });
  waits.begin({ device: "d1", id: "b1", t: "institution" });
  // An entry of the queue taken before the round is applied before it.
  waits.begin({ device: "d2", id: "b2", t: "order" });
  waits.roundBegan();
  waits.roundBegan();
  assert.deepEqual(told, [["d1", { t: "held", id: "b1" }]]);
});

test("one sent again after a reconnect, still held, is told again; one answered or never held is not", () => {
  const { told, tell } = recorder();
  const waits = createRequestWaits({ tell });
  waits.begin({ device: "d1", id: "c1", t: "say", resolving: true });
  waits.begin({ device: "d1", id: "c2", t: "say" });
  told.length = 0;
  waits.again("d1", "c1");
  waits.again("d1", "c2");
  assert.deepEqual(told, [["d1", { t: "held", id: "c1" }]]);
  waits.end("d1", "c1");
  waits.again("d1", "c1");
  assert.equal(told.length, 1);
});
