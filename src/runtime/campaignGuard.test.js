/*! Open Historia — campaign write guard tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/campaignGuard.test.js
//
// Reported 2026-09-04: a Modern Day jump was still generating when the player
// opened a 1911 campaign. The turn finished, wrote through the runtime endpoints
// the switch had repointed, and six months of 2016 landed on the 1911 save —
// destroying it, and leaving the campaign that generated the turn at its start.

import assert from "node:assert/strict";
import test from "node:test";

import { assertCampaignUnchanged, campaignChanged, campaignSwitchMessage } from "./campaignGuard.js";

test("the same campaign is never blocked", () => {
  assert.equal(campaignChanged("modern-day-session-3", "modern-day-session-3"), false);
  assert.doesNotThrow(() => assertCampaignUnchanged("modern-day-session-3", "modern-day-session-3"));
});

test("a turn that outlived a campaign switch is refused", () => {
  assert.equal(campaignChanged("modern-day-session-3", "the-great-war-session"), true);
  assert.throws(
    () => assertCampaignUnchanged("modern-day-session-3", "the-great-war-session"),
    (error) => error.campaignSwitched === true,
  );
});

test("the refusal says which campaigns and that nothing was written", () => {
  const message = campaignSwitchMessage("modern-day-session-3", "the-great-war-session");
  assert.match(message, /modern-day-session-3/);
  assert.match(message, /the-great-war-session/);
  assert.match(message, /nothing was written/);
});

test("an unknown campaign on either side never blocks an ordinary turn", () => {
  // No library state yet, or a caller that cannot say — a guard that cannot tell
  // must not cost the player a finished turn.
  for (const [from, to] of [["", "x"], ["x", ""], ["", ""], [null, undefined]]) {
    assert.equal(campaignChanged(from, to), false, `${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
    assert.doesNotThrow(() => assertCampaignUnchanged(from, to));
  }
});

test("surrounding whitespace is not a different campaign", () => {
  assert.equal(campaignChanged(" modern-day-session-3 ", "modern-day-session-3"), false);
});

test("the wording can name what was refused", () => {
  assert.match(campaignSwitchMessage("a", "b", "game-master change"), /This game-master change was generated/);
});
