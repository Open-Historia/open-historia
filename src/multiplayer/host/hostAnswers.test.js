/*! Open Historia — what the host's AI answers for each player a round: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/hostAnswers.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createHostAnswers, hostAnswersSpent, hostTurnsSpent } from "./hostAnswers.js";
import { HOST_ANSWERS_MAX } from "./settings.js";

test("each player has the host's number of answers a round, counted apart, and none unless the host says", () => {
  assert.equal(createHostAnswers().take("Russian Federation", 1), false, "none by default");
  const answers = createHostAnswers({ limit: 2 });
  assert.equal(answers.left("Russian Federation", 1), 2);
  assert.equal(answers.take("Russian Federation", 1), true);
  assert.equal(answers.take("russian federation", 1), true, "the same player, however the name is written");
  assert.equal(answers.take("Russian Federation", 1), false);
  assert.equal(answers.left("Russian Federation", 1), 0);
  assert.equal(answers.take("Republic of Estonia", 1), true, "another player's are their own");
  assert.equal(answers.take("Russian Federation", 2), true, "a new round, new answers");
  assert.equal(answers.setLimit(2), false);
  assert.equal(answers.setLimit(HOST_ANSWERS_MAX + 10), true);
  assert.equal(answers.limit, HOST_ANSWERS_MAX, "held to the setting's bounds");
  assert.equal(answers.setLimit(-3), true);
  assert.equal(answers.limit, 0);
});

test("a player past the number is told why, in words that fit a line and a Council's turn", () => {
  assert.match(hostAnswersSpent(1), /at most 1 of your messages a round to a government that can act on them.*This one waits for the round, which reads it\./);
  assert.match(hostAnswersSpent(0), /does not answer messages to a government that can act on them.*between rounds\. Yours is written/);
  assert.match(hostTurnsSpent(2), /at most 2 of your messages a round.*Ask again next round\./);
  assert.match(hostTurnsSpent(0), /holds no Council or hearing turns between rounds/);
  for (const text of [hostAnswersSpent(50), hostTurnsSpent(50)]) assert.ok(text.length <= 500, "a notice's length");
});
