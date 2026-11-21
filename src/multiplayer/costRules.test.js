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

import { ANSWERS_PER_ROUND_CHOICES, HOST_ANSWER_CHOICES, OWN_AGENT_LINE, PAYER_SEES_AND_CHANGES, costRulesOf, ownAiUsesOf, payerLineOf } from "./costRules.js";
import { HOST_ANSWERS_MAX, normalizeSettings } from "./host/settings.js";

const rules = (input, viewer) => costRulesOf(normalizeSettings(input).settings, viewer);
const OWN_USES = "Your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search.";

test("the lobby says who pays for the round, for the governments the AI plays, and what is always each player's own", () => {
  assert.deepEqual(rules({}), [
    "The host's AI makes each round's request.",
    "The host's AI answers up to 20 of your messages a round to countries the AI plays, Councils and hearings included; past that, the round reads them. It writes the stat sheets, parties and military figures.",
    // Its own readings after a round, as in single player (runtime/sharedReadings.js).
    "After each round it also reads, by itself, the figures the war needs of countries at war whose figures nobody has read.",
    OWN_USES,
  ]);
  // The number is the host's (host/settings.js answersPerRound, the review of 2026-11-18: rule 10).
  assert.match(rules({ answersPerRound: 5 })[1], /up to 5 of your messages a round/);
  assert.match(rules({ answersPerRound: 0 })[1], /answers no messages between rounds: the round reads what you write/);
  assert.ok(ANSWERS_PER_ROUND_CHOICES.includes(0) && ANSWERS_PER_ROUND_CHOICES.includes(20) && ANSWERS_PER_ROUND_CHOICES.at(-1) === HOST_ANSWERS_MAX);
  const cycle = rules({ payment: "cycle" });
  assert.match(cycle[0], /each player's device in turn, on that player's own AI key\. No key is sent/);
  assert.doesNotMatch(cycle[0], /only carries/, "it does more than carry: its answer is the round");
  assert.equal(cycle[1], PAYER_SEES_AND_CHANGES);
  assert.match(cycle[1], /sees that round's whole request, every player's orders and secrets included, and could change what happens in that round/, "in the owner's words: it sees, and could alter the outcome");
  assert.match(cycle[2], /passed over until it has one/);
  const own = rules({ replies: "own" });
  assert.match(own[1], /Your own AI answers your messages to countries the AI plays, and writes the stat sheets, parties and military figures you are the first to open/);
  // What a device writes stands for everyone, and what a player has a stake in is the host's AI's (security S6).
  assert.equal(own[2], "The figures a player's device writes for a country the AI plays stand for every player. Your own country's figures, and those of a country at war with you, are written by the host's AI.");
  // A reading goes once, to the first who asks (host/gameHost.js leaveReading), and the host's AI makes none by
  // itself (runtime/sharedReadings.js): the follow-ups of 2026-11-18, C5.
  assert.equal(own[3], "A sheet, parties or military figures of a country the AI plays are written once, by the device of the first player to open them: a player who opens them meanwhile sees them once they are written.");
  assert.equal(own[4], "The host's AI reads no figures by itself: what the war needs of a country nobody has opened is written in the round's own request.");
  assert.doesNotMatch(own.join(" "), /After each round it also reads/);
  assert.equal(own[5], "Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are not answered between rounds: the round reads what you write to them.");
  assert.equal(rules({ replies: "own", hostAnswers: 3 })[5], "Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are answered by the host's AI, up to 3 of your messages a round; past that, the round reads them.");
  // The host's own messages are never counted: what every guest reads is not what the host does.
  assert.equal(rules({ replies: "own" }, { host: true })[5], "As the host, your messages to every country the AI plays are answered by your own AI.");
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

test("a guest whose list holds only its own Agent is told why it is asked for an AI", () => {
  assert.match(OWN_AGENT_LINE, /^Your own Agent answers only what you start yourself and answer with \/answer;/);
  assert.match(OWN_AGENT_LINE, /set up an AI with an API key or a server of your own\.$/);
});

test("whose device pays the round, for the round bar", () => {
  assert.equal(payerLineOf({ payer: "" }), "");
  assert.equal(payerLineOf({ payer: "Russian Federation", me: "Russian Federation", phase: "resolving" }), "Your device is making this round's AI request, on your own AI.");
  assert.equal(payerLineOf({ payer: "Russian Federation", me: "Republic of Latvia", phase: "planning" }), "Russian Federation's device pays for this round's AI request.");
});
