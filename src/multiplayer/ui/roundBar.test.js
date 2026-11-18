/*! Open Historia — what a shared game's round bar says: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/ui/roundBar.test.js
//
// The review of 2026-11-18 (ui 1, 6, 7, 8, 15, 16): a failed or cancelled
// round showed a clock running down to 0:00 on nothing, a cancel read "could
// not be resolved", the host's screen gone read "Paused", nothing moved while a
// round was resolved, counts were glued onto pieces of English, the bar laid
// itself out in half the screen, and Stop ended everyone's game in one click.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { clock, failureText, readyText, roundClockText, unreadLabel, waitsForTheHost } from "./roundBar.js";

test("the clock says the time left, or why there is none", () => {
  const planning = { phase: "planning", round: 4, failed: 0, paused: false };
  assert.equal(roundClockText({ round: planning, remaining: 19 * 60_000 + 58_000 }), "19:58");
  assert.equal(roundClockText({ round: { ...planning, paused: true } }), "Paused");
  assert.equal(roundClockText({ round: { ...planning, paused: true, hostAway: true } }), "Waiting for the host's screen to come back");
  // A round that failed or was cancelled: planned again, but nothing runs it but the host.
  const failed = { ...planning, failed: 4, failure: "The model's quota is used up." };
  assert.equal(waitsForTheHost(failed), true);
  assert.equal(roundClockText({ round: failed, remaining: 19 * 60_000 }), "Waiting for the host to run it again", "never a clock running down on nothing");
  assert.equal(roundClockText({ round: failed, role: "host" }), "Waiting for you to run it again");
  // Run again: resolving, its failure still said until it lands, and how long it has been resolving.
  assert.equal(waitsForTheHost({ ...failed, phase: "resolving" }), false);
  assert.equal(roundClockText({ round: { ...failed, phase: "resolving" }, elapsed: 83_000 }), "1:23");
  assert.equal(roundClockText({ round: { phase: "revealing", paused: false }, remaining: 61_000 }), "1:01");
  assert.equal(roundClockText({ round: { phase: "lobby" } }), "");
  assert.equal(clock(3 * 3600_000 + 5_000), "3:00:05");
});

test("a cancelled round is said as cancelled; one that failed, with why", () => {
  assert.equal(failureText({ failed: 4, failureKind: "cancelled", failure: "The host cancelled the round." }), "The host cancelled round 4. Its orders are still queued.");
  assert.equal(failureText({ failed: 4, failureKind: "failed", failure: "The model's quota is used up." }), "Round 4 could not be resolved: The model's quota is used up.");
  assert.equal(failureText({ failed: 4, failure: "" }), "Round 4 could not be resolved: the host's AI did not answer.");
});

test("every line is whole, its count in it", () => {
  assert.equal(readyText({ ready: ["A", "B"], counted: 3, needed: 2 }), "2 of 3 ready (countdown at 2)");
  assert.equal(readyText({ ready: [], counted: 1, needed: 0 }), "0 of 1 ready");
  assert.equal(unreadLabel(1), "1 new notice");
  assert.equal(unreadLabel(3), "3 new notices");
});

// What the overlay is made of, read as text: it is JSX, which plain node does not load. These pin two rules of
// its layout and its Stop, the way serverImports.test.js pins one of the server's.
test("the round bar is as wide as what it holds, and the host's Stop asks before it ends everyone's game", () => {
  const source = fs.readFileSync(new URL("./SharedGameOverlay.jsx", import.meta.url), "utf8");
  const bar = source.slice(source.indexOf("const RoundBar = "), source.indexOf("export function SharedGameView"));
  assert.ok(bar.length > 1000, "the round bar was found");
  assert.doesNotMatch(bar, /translateX\(-50%\)/, "centred by a transform, it had half the screen to lay out in");
  assert.match(bar, /width: "fit-content"/);
  assert.match(bar, /useIsMobile\(\)/, "a phone's bar is one row, the rest under Players");
  assert.doesNotMatch(source, /onClick=\{leave\}>\{role === "host"/, "Stop never ends the game in one click");
  assert.match(source, /Stop sharing for everyone/);
  // The host's lines are translated whole; only the names in them are not.
  assert.equal((source.match(/data-no-translate/g) ?? []).length, 1);
});
