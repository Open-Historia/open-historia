/*! Open Historia — when a shared game's round lands: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/roundDates.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { roundDatesOf } from "./roundDates.js";
import { jumpTargetDate } from "../../runtime/jumpDates.js";

test("the round bar names the date and where the round lands, by the skip's own rule", () => {
  assert.deepEqual(roundDatesOf("1914-08-01", 30), { now: "August 1st, 1914", lands: "August 31st, 1914", days: 30 });
  assert.equal(jumpTargetDate("1914-08-01", 30), "1914-08-31", "the date the host's skip lands on");
  assert.deepEqual(roundDatesOf("1914-12-20", 14), { now: "December 20th, 1914", lands: "January 3rd, 1915", days: 14 });
  assert.deepEqual(roundDatesOf("-0049-01-10", 1), { now: "January 10th, 49 BC", lands: "January 11th, 49 BC", days: 1 }, "BC dates step as AD ones do");
});

test("with no length known the date stands alone, and with no date there is nothing to say", () => {
  assert.deepEqual(roundDatesOf("1914-08-01", undefined), { now: "August 1st, 1914", lands: "", days: 0 });
  assert.deepEqual(roundDatesOf("1914-08-01", 0), { now: "August 1st, 1914", lands: "", days: 0 });
  assert.equal(roundDatesOf("", 30), null);
  assert.equal(roundDatesOf("soon", 30), null);
});

test("the game's screens learn a shared game's round from the bridge, and nothing outside one", async () => {
  const bridge = await import("./sharedGameBridge.js");
  const { startRemoteRuntime, stopRemoteRuntime } = await import("./remoteRuntime.js");
  let told = 0;
  const forget = bridge.subscribeSharedGameRole(() => { told += 1; });
  try {
    bridge.setSharedRoundDays(30);
    assert.equal(bridge.sharedRoundDays(), 30);
    bridge.setSharedRoundDays(30);
    assert.equal(told, 1, "the screens are told when it changes, once");
    bridge.setSharedRoundDays("x");
    assert.equal(bridge.sharedRoundDays(), 0);
    // The world held before a round: only for that round's record, and only while the page plays a shared game.
    const world = { units: [] };
    bridge.setSharedRoundBase({ world, from: "1914-08-01", round: 2 });
    assert.equal(bridge.sharedRoundBase({ fromDate: "1914-08-01", round: 2 }), null, "no shared game on this page");
    startRemoteRuntime({ publish: () => {}, urlFor: () => "" });
    assert.equal(bridge.sharedRoundBase({ fromDate: "1914-08-01", round: 2 }), world);
    assert.equal(bridge.sharedRoundBase({ fromDate: "1914-08-31", round: 3 }), null);
  } finally {
    stopRemoteRuntime();
    bridge.setSharedRoundBase(null);
    bridge.setSharedRoundDays(0);
    forget();
  }
});
