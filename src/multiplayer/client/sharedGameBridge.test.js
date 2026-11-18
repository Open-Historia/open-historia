/*! Open Historia — what the game's screens need of a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/sharedGameBridge.test.js
//
// What the screens read of the shared game that the page's client tells: which
// of their requests wait for the round being resolved, and why the host did not
// keep a change to the advisor's conversation. Each is said where the player
// acted, and changes tell the screens that subscribed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  setSharedAdvisorRefusal, setSharedRequestsHeld, sharedAdvisorRefusal, sharedRequestsHeld, subscribeSharedGameRole,
} from "./sharedGameBridge.js";

test("the requests the host holds for the round are told by kind, once each, to the screens that subscribed", () => {
  let told = 0;
  const stop = subscribeSharedGameRole(() => { told += 1; });
  try {
    assert.deepEqual(sharedRequestsHeld(), []);
    setSharedRequestsHeld(["sheet", "institution", "institution"]);
    assert.deepEqual(sharedRequestsHeld(), ["institution", "sheet"]);
    const kept = sharedRequestsHeld();
    setSharedRequestsHeld(["institution", "sheet"]);
    assert.equal(sharedRequestsHeld(), kept, "the same list, no change told");
    setSharedRequestsHeld([]);
    assert.deepEqual(sharedRequestsHeld(), []);
    assert.equal(told, 2);
  } finally {
    stop();
  }
});

test("a change of the advisor's conversation the host did not keep is said in the advisor, not on the round bar", () => {
  // It reverted the conversation and said why on the round bar alone (the review of 2026-11-18, door 10).
  setSharedAdvisorRefusal("  The advisor's conversation is too long to keep.  ");
  assert.equal(sharedAdvisorRefusal(), "The advisor's conversation is too long to keep.");
  setSharedAdvisorRefusal("");
  assert.equal(sharedAdvisorRefusal(), "");
  const page = readFileSync(new URL("./sharedGame.js", import.meta.url), "utf8");
  const advisorBranch = page.slice(page.indexOf('if (key === "advisor") {'), page.indexOf("// A change no door takes is said"));
  assert.match(advisorBranch, /setSharedAdvisorRefusal\(answer\?\.error \|\| "The host did not answer\."\)/);
  assert.doesNotMatch(advisorBranch, /notify\(/);
  const advisor = readFileSync(new URL("../../Game/GameUI/advisor.jsx", import.meta.url), "utf8");
  assert.match(advisor, /hostRefusal \? \(\s*<StorageProblemNotice title="The host did not keep your latest change to this conversation\." detail=\{hostRefusal\} \/>/);
});
