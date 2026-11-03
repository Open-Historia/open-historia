/*! Open Historia — Rostra's polls: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/rostraPolls.test.js
//
// A player's post can be a poll (runtime/socialFeed.js): the public of the
// leader's country votes over the next time skip, which writes the result in
// the answer it already gives (pollResults). What is pinned here: what a poll
// may hold, how the skip is asked and how its answer is read, and that the
// skip's contract only grows while a poll is open.

import test from "node:test";
import assert from "node:assert/strict";

import { mergeSegmentPayloads } from "../Game/AI/jumpSegments.js";
import { POLL_RESULTS_FIELD, SOCIAL_POSTS_FIELD, getGameplayTool, validateGameplayPayload, withSocialPosts } from "../Game/AI/gameplaySchemas.js";
import { toGeminiSchema } from "../Game/AI/geminiSchema.js";
import {
  POLL_CHOICES_MAX,
  normalizePoll,
  openPolls,
  placeRostraLines,
  pollWinner,
  readSkipPollResults,
  socialFeedPromptBlock,
  withPlayerPost,
} from "./socialFeed.js";

const world = { polityOverrides: {}, socialFeed: [] };
const ask = (text = "Continue attacks on Iran", choices = ["Yes", "No"]) =>
  withPlayerPost(world, { by: "United States", text, choices, date: "2027-01-31", round: 4 });

test("a poll is the post's question and two to four different choices", () => {
  const made = ask();
  assert.equal(made.error, undefined);
  assert.equal(made.post.text, "Continue attacks on Iran");
  assert.deepEqual(made.post.poll, { choices: ["Yes", "No"] });
  assert.equal(made.post.kind, "player");
  for (const choices of [["Yes"], ["Yes", "yes"], ["Yes", " "], ["A", "B", "C", "D", "E"], ["A".repeat(41), "B"]]) {
    assert.ok(ask("Q", choices).error, JSON.stringify(choices));
  }
  assert.equal(normalizePoll({ choices: ["A", "B", "C", "D", "E"] }).choices.length, POLL_CHOICES_MAX);
  // A plain post is no poll, and only a player asks one.
  assert.equal(withPlayerPost(world, { by: "United States", text: "Hello", date: "2027-01-31" }).post.poll, undefined);
});

test("the next skip is told the open poll and asked for the public's answer", () => {
  const { world: asked } = ask();
  const block = socialFeedPromptBlock({ feed: asked.socialFeed, players: ["United States"], round: 4 });
  assert.match(block, /p1 \| 2027-01-31 \|[^\n]*"Continue attacks on Iran" Poll, open until this time skip: "Yes" \/ "No"\./);
  assert.match(block, /Write pollResults: the player's open poll \(p1\)/);
  assert.match(block, /never from what the leader would like to hear/);
  // No poll, no ask.
  assert.doesNotMatch(socialFeedPromptBlock({ feed: [], players: ["United States"], round: 4 }), /pollResults/);
});

test("the answer is read onto the open poll: shares to 100, votes, one sentence", () => {
  const { world: asked } = ask();
  const read = readSkipPollResults([
    { poll: "p1", shares: [37.6, 61.9], votes: "485,200", consensus: "The public voted against more strikes, citing the risk of escalation." },
    { poll: "p9", shares: [50, 50] },
  ], { feed: asked.socialFeed, round: 5 });
  assert.equal(read.answered, 1);
  const poll = read.feed[0].poll;
  assert.deepEqual(poll.results, { shares: [38, 62], votes: 485200, consensus: "The public voted against more strikes, citing the risk of escalation.", round: 5 });
  assert.equal(pollWinner(poll), 1);
  assert.deepEqual(openPolls(read.feed), []);
  // Answered once: a second answer changes nothing.
  assert.equal(readSkipPollResults([{ poll: "p1", shares: [90, 10] }], { feed: read.feed }).answered, 0);
  // Shares named by choice are read too; an answer with no share at all is none.
  assert.deepEqual(readSkipPollResults([{ poll: "p1", shares: { no: 3, yes: 1 } }], { feed: asked.socialFeed }).feed[0].poll.results.shares, [25, 75]);
  assert.equal(readSkipPollResults([{ poll: "p1", shares: [0, 0] }], { feed: asked.socialFeed }).answered, 0);
  // A tie has no winner.
  assert.equal(pollWinner({ choices: ["A", "B"], results: { shares: [50, 50] } }), -1);
});

test("the skip is asked for the field only while a poll is open; the answer is read either way", () => {
  const plain = withSocialPosts(getGameplayTool("jumpForward"), true);
  assert.equal(POLL_RESULTS_FIELD in plain.schema.properties, false, "no poll, no field: the skip's contract is as it was");
  const polled = withSocialPosts(getGameplayTool("jumpForward"), true, { polls: true });
  const keys = Object.keys(polled.schema.properties);
  assert.equal(keys.indexOf(POLL_RESULTS_FIELD), keys.indexOf(SOCIAL_POSTS_FIELD) - 1, "just before the posts");
  assert.deepEqual(polled.schema.properties[POLL_RESULTS_FIELD].items.required, ["poll", "shares"]);
  const gemini = toGeminiSchema(polled.schema.properties[POLL_RESULTS_FIELD]);
  assert.equal(JSON.stringify(gemini).includes("minItems") || JSON.stringify(gemini).includes("maxItems"), false);
  assert.equal(POLL_RESULTS_FIELD in withSocialPosts(getGameplayTool("jumpForward"), false, { polls: true }).schema.properties, false, "no social media, no polls");
  const verdict = validateGameplayPayload("jumpForward", { events: [], stopDate: "2027-02-28", summary: "A month.", pollResults: [{ poll: "p1", shares: [1, 2] }, "odd"] });
  assert.equal(validateGameplayPayload("jumpForward", { events: [], stopDate: "2027-02-28", summary: "A month.", pollResults: "none" }).valid, true);
  assert.equal(verdict.valid, true, verdict.error);
  // The segments of a skip hand every answer on.
  assert.deepEqual(mergeSegmentPayloads([{ events: [], pollResults: [{ poll: "p1" }] }, { events: [], pollResults: [{ poll: "p2" }] }], { targetDate: "2027-02-28" }).pollResults, [{ poll: "p1" }, { poll: "p2" }]);
});

test("a place's feed hears what was said on Rostra there, polls and results included", () => {
  const { world: asked } = ask();
  const voted = readSkipPollResults([{ poll: "p1", shares: [38, 62], votes: 485200, consensus: "Against." }], { feed: asked.socialFeed, round: 5 }).feed;
  const lines = placeRostraLines([...voted, { id: "p2", author: "Ana Lima", role: "Columnist", country: "France", text: "Elsewhere.", date: "2027-02-01", round: 5, kind: "voice" }], { country: "United States" });
  assert.match(lines, /Continue attacks on Iran" Poll result: "Yes" 38%, "No" 62% \(485,200 votes\)\. Against\./);
  assert.doesNotMatch(lines, /Elsewhere/);
  assert.equal(placeRostraLines(voted, { country: "France" }), "");
});
