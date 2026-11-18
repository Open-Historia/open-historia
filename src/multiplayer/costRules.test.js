/*! Open Historia — who pays for what in a shared game, in words: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/costRules.test.js
//
// The lobby says who pays for what, truthfully, for every choice the host can
// make: a guest was told it needed no key while its advisor used its own, and
// some governments were answered on the host's key with nobody told. With
// players taking turns to pay, it says what the owner said it must (decision
// 14: the payer sees the round and could change it), who pays in turn and who
// is passed over, and a round's cost and wait by who pays for it.

import test from "node:test";
import assert from "node:assert/strict";

import { HOST_ANSWER_CHOICES, PAYER_SEES_AND_CHANGES, costRulesOf, gameMasterRuleOf, ownAiUsesOf, payerLineOf, payersLinesOf, roundCostLinesOf } from "./costRules.js";
import { HOST_ANSWERS_MAX, normalizeSettings } from "./host/settings.js";

const rules = (input, viewer) => costRulesOf(normalizeSettings(input).settings, viewer);
const OWN_USES = "Your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search.";

test("the lobby says who pays for the round, for the governments the AI plays, and what is always each player's own", () => {
  assert.deepEqual(rules({}), [
    "The host's AI makes each round's request.",
    "The host's AI answers messages to countries the AI plays, and writes the stat sheets, parties and military figures.",
    OWN_USES,
  ]);
  const cycle = rules({ payment: "cycle" });
  assert.match(cycle[0], /each player's device in turn, on that player's own AI key\. No key is sent/);
  assert.doesNotMatch(cycle[0], /only carries/, "it does more than carry: its answer is the round");
  assert.equal(cycle[1], PAYER_SEES_AND_CHANGES);
  assert.match(cycle[1], /sees that round's whole request, every player's orders and secrets included, and could change what happens in that round/, "in the owner's words: it sees, and could alter the outcome");
  assert.match(cycle[2], /passed over until it has one/);
  const own = rules({ replies: "own" });
  assert.match(own[1], /Your own AI answers your messages to countries the AI plays, and writes the stat sheets, parties and military figures you are the first to open/);
  assert.equal(own[2], "Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are not answered between rounds: the round reads what you write to them.");
  assert.equal(rules({ replies: "own", hostAnswers: 3 })[2], "Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are answered by the host's AI, up to 3 of your messages a round; past that, the round reads them.");
  // The host's own messages are never counted: what every guest reads is not what the host does.
  assert.equal(rules({ replies: "own" }, { host: true })[2], "As the host, your messages to every country the AI plays are answered by your own AI.");
  assert.ok(HOST_ANSWER_CHOICES.includes(0) && HOST_ANSWER_CHOICES.at(-1) === HOST_ANSWERS_MAX);
});

test("a player's AI set-up says everything its own AI does in this game, and nothing the host's AI does not", () => {
  const uses = (input) => ownAiUsesOf(normalizeSettings(input).settings);
  assert.match(uses({}), /the host's AI makes each round's request and answers your messages/);
  for (const input of [{}, { replies: "own" }, { payment: "cycle" }, { payment: "cycle", replies: "own" }]) {
    assert.match(uses(input), /your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search/);
    assert.doesNotMatch(uses(input), /does none of these/, "with host answers, the host's AI does answer some of them");
  }
  assert.match(uses({ replies: "own" }), /your messages to countries the AI plays; and the stat sheets, parties and military figures you open first/);
  assert.match(uses({ payment: "cycle" }), /makes the round's request when it is your turn to pay/);
});

test("with players taking turns to pay, the lobby says who pays in turn, who is passed over, and tells a passed-over player why", () => {
  const settings = normalizeSettings({ payment: "cycle" }).settings;
  const seats = [
    { country: "Republic of Latvia", status: "human", held: true, you: false, pays: true },
    { country: "Russian Federation", status: "human", held: true, you: true, pays: false },
    { country: "Republic of Estonia", status: "ai", held: false, you: false },
    { country: "Kingdom of Prussia", status: "watching", held: true, you: false },
  ];
  assert.deepEqual(payersLinesOf(settings, seats), [
    "Paying in turn: Republic of Latvia.",
    "Passed over until their device has an AI that can make a round's request: Russian Federation.",
    "Your device has no AI that can make a round's request now, so your turn to pay is passed over. Set one up under Settings, AI.",
  ]);
  assert.deepEqual(payersLinesOf(normalizeSettings({}).settings, seats), [], "nothing to say where the host pays");
});

test("the round's cost and its wait, by who pays for it", () => {
  const host = normalizeSettings({}).settings;
  const cycle = normalizeSettings({ payment: "cycle" }).settings;
  assert.deepEqual(roundCostLinesOf({ difficulty: "normal", requests: 1, most: 8, stallMinutes: 15 }, host), [
    "Each round is one request to the host's AI, up to 8 when it looks things up.",
    "When an institution's members vote, the round makes one request more.",
    "A round whose AI is silent for 15 minutes fails, and the host can run it again.",
  ]);
  assert.equal(roundCostLinesOf({ requests: 1, most: 1, stallMinutes: 0 }, host)[2], "A round waits for the host's AI as long as it takes, and the host can cancel it.");
  // On the paying player's key, the host's own settings say nothing of what it spends.
  const paid = roundCostLinesOf({ requests: 1, most: 8, stallMinutes: 0 }, cycle);
  assert.match(paid[0], /one request to the paying player's AI; that player's own AI settings decide whether it may make more/);
  assert.doesNotMatch(paid.join(" "), /host's AI/);
  assert.equal(paid[2], "A round waits for the paying player's AI as long as it takes, and the host can cancel it.");
  assert.equal(roundCostLinesOf({ requests: 1, most: 1, stallMinutes: 15 }, cycle)[2], "A round whose AI is silent for 15 minutes fails, and the host can run it again.", "the paying device's model at work puts it off, as an answer arriving does");
  assert.deepEqual(roundCostLinesOf(null, host), []);
});

test("the Game Master's rule, and whose device pays the round, for the round bar", () => {
  assert.match(gameMasterRuleOf(normalizeSettings({}).settings), /No Game Master in this game/);
  assert.match(gameMasterRuleOf(normalizeSettings({ cheats: "host" }).settings), /Every change is told to every player/);
  assert.match(gameMasterRuleOf(normalizeSettings({ cheats: "vote" }).settings), /No Game Master/, "a vote is not built");
  assert.equal(payerLineOf({ payer: "" }), "");
  assert.equal(payerLineOf({ payer: "Russian Federation", me: "Russian Federation", phase: "resolving" }), "Your device is making this round's AI request, on your own AI.");
  assert.equal(payerLineOf({ payer: "Russian Federation", me: "Republic of Latvia", phase: "planning" }), "Russian Federation's device pays for this round's AI request.");
});
