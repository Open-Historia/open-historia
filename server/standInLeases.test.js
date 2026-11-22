/*! Open Historia — which stand-ins a page is showing now: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/standInLeases.test.js
//
// A page holding a shared game's stand-in renews its lease here; a start of any
// page of this server closes only a stand-in nobody holds.

import test from "node:test";
import assert from "node:assert/strict";

import { STAND_IN_LEASE_MS, createStandInLeases } from "./standInLeases.js";

test("a stand-in is held while its page renews the lease, and no longer once it lapses or is let go", () => {
  let t = 1_000;
  const leases = createStandInLeases({ now: () => t });
  assert.deepEqual(leases.held(), []);
  assert.equal(leases.touch("shared-game-0123456789ab"), true);
  assert.equal(leases.touch("shared-game-ffffffffffff"), true);
  t += STAND_IN_LEASE_MS - 1;
  leases.touch("shared-game-ffffffffffff");
  assert.deepEqual(leases.held(), ["shared-game-0123456789ab", "shared-game-ffffffffffff"]);
  t += 2;
  assert.deepEqual(leases.held(), ["shared-game-ffffffffffff"], "the first page went quiet");
  leases.release("shared-game-ffffffffffff");
  assert.deepEqual(leases.held(), []);
});

test("nothing worth keeping is kept, and there is a bound", () => {
  const leases = createStandInLeases({ now: () => 5 });
  assert.equal(leases.touch(""), false);
  assert.equal(leases.touch("x".repeat(201)), false);
  for (let n = 0; n < 100; n += 1) leases.touch(`shared-game-${n}`);
  assert.equal(leases.held().length, 64);
  assert.ok(leases.held().includes("shared-game-99"), "the newest are kept");
});
