/*! Open Historia — who pays for what in a shared game, in words: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/costRules.test.js
//
// The lobby says who pays for what, truthfully, for every choice the host can
// make: a guest was told it needed no key while its advisor used its own, and
// some governments were answered on the host's key with nobody told.

import test from "node:test";
import assert from "node:assert/strict";

import { HOST_ANSWER_CHOICES, costRulesOf, gameMasterRuleOf, ownAiUsesOf, payerLineOf } from "./costRules.js";
import { HOST_ANSWERS_MAX, normalizeSettings } from "./host/settings.js";

const rules = (input) => costRulesOf(normalizeSettings(input).settings);

test("the lobby says who pays for the round, for the governments the AI plays, and what is always each player's own", () => {
  assert.deepEqual(rules({}), [
    "The host's AI makes each round's request.",
    "The host's AI answers messages to countries the AI plays, and writes the stat sheets and parties.",
    "Your own AI answers your advisor, AI suggestions, generals and Rostra Search.",
  ]);
  const cycle = rules({ payment: "cycle" });
  assert.match(cycle[0], /each player's device in turn, on that player's own AI key\. No key is sent/);
  assert.equal(cycle[1], "The paying player's device sees that round's whole request, every player's orders and secrets included.", "said plainly, in the owner's words");
  const own = rules({ replies: "own" });
  assert.match(own[1], /Your own AI answers your messages to countries the AI plays/);
  assert.equal(own[2], "Countries at war with you, your overlord or puppet, and institutions are not answered between rounds: the round reads what you write to them.");
  assert.equal(rules({ replies: "own", hostAnswers: 3 })[2], "Countries at war with you, your overlord or puppet, and institutions are answered by the host's AI, up to 3 of your messages a round; past that, the round reads them.");
  assert.ok(HOST_ANSWER_CHOICES.includes(0) && HOST_ANSWER_CHOICES.at(-1) === HOST_ANSWERS_MAX);
});

test("a player's AI set-up says what its own AI does in this game", () => {
  const uses = (input) => ownAiUsesOf(normalizeSettings(input).settings);
  assert.match(uses({}), /the host's AI makes each round's request and answers your messages/);
  assert.match(uses({}), /Your own AI answers your advisor, AI suggestions, generals and Rostra Search/);
  assert.match(uses({ replies: "own" }), /your messages to countries the AI plays and the stat sheets you open first/);
  assert.match(uses({ payment: "cycle" }), /makes the round's request when it is your turn to pay/);
  assert.match(uses({ payment: "cycle", replies: "own" }), /The host's AI does none of these for you\./);
});

test("the Game Master's rule, and whose device pays the round, for the round bar", () => {
  assert.match(gameMasterRuleOf(normalizeSettings({}).settings), /No Game Master in this game/);
  assert.match(gameMasterRuleOf(normalizeSettings({ cheats: "host" }).settings), /Every change is told to every player/);
  assert.match(gameMasterRuleOf(normalizeSettings({ cheats: "vote" }).settings), /No Game Master/, "a vote is not built");
  assert.equal(payerLineOf({ payer: "" }), "");
  assert.equal(payerLineOf({ payer: "Russian Federation", me: "Russian Federation", phase: "resolving" }), "Your device is making this round's AI request, on your own AI.");
  assert.equal(payerLineOf({ payer: "Russian Federation", me: "Republic of Latvia", phase: "planning" }), "Russian Federation's device pays for this round's AI request.");
});
