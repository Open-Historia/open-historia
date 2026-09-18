/*! Open Historia — chat action batch tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/chatActions.test.js
//
// Runs without node_modules: chatActions.js imports nothing.
//
// One request acts for every AI participant in a thread. What these pin: an
// actor may never be a human or an outsider; a bad action costs only itself;
// refs let a poll be created and voted in the same answer; and a poll nobody
// answered is reported as the failure it is.

import test from "node:test";
import assert from "node:assert/strict";

import {
    MAX_ACTIONS_PER_BATCH,
    applyChatActionBatch,
    describeChatActionFeedback,
    normalizeChatAction,
} from "./chatActions.js";
import { projectChatThread } from "../../runtime/chatThreads.js";

const roster = (extra = {}) => ({
    aiParticipants: ["France", "Prussia"],
    humanParticipants: ["Bavaria"],
    knownPolities: ["France", "Prussia", "Bavaria", "Austria", "Russian Empire"],
    messageIds: ["m1"],
    polls: [],
    ...extra,
});

test("an action is read from what the model writes, and refused when it is not one", () => {
    assert.deepEqual(normalizeChatAction({ type: "send_message", actorName: "France", content: "We propose talks." }),
        { type: "send_message", actorName: "France", content: "We propose talks." });
    assert.equal(normalizeChatAction({ type: "send_message", actorName: "France", content: "  " }), null);
    assert.equal(normalizeChatAction({ type: "send_message", content: "no actor" }), null);
    assert.equal(normalizeChatAction({ type: "nonsense", actorName: "France" }), null);
    assert.equal(normalizeChatAction({ type: "create_poll", actorName: "France", pollRef: "p", question: "q?", options: [{ optionRef: "a", label: "A" }] }), null, "a poll needs two options");
});

test("a model may never speak for a human, nor for a polity outside the room", () => {
    const { events, applied, rejected } = applyChatActionBatch([
        { type: "send_message", actorName: "Bavaria", content: "I accept my own terms." },
        { type: "send_message", actorName: "Austria", content: "We were not invited." },
        { type: "send_message", actorName: "France", content: "We propose talks at Nancy." },
    ], roster(), { time: "1870-07-14" });

    assert.equal(applied.length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].by, "France");
    assert.equal(rejected.length, 2);
    assert.match(rejected[0].reason, /played by a human/);
    assert.match(rejected[1].reason, /not a participant/);
});

test("one bad action costs only itself", () => {
    const { applied, rejected } = applyChatActionBatch([
        { type: "send_message", actorName: "France", content: "First." },
        { type: "add_reaction", actorName: "Prussia", targetEntryId: "does-not-exist", emoji: "🤨" },
        { type: "send_message", actorName: "Prussia", content: "Second." },
    ], roster(), { time: "1870-07-14" });
    assert.deepEqual(applied.map((action) => action.type), ["send_message", "send_message"]);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /no message does-not-exist/);
});

test("a poll is created and voted in ONE batch, through the refs the batch introduced", () => {
    const { events, rejected, unansweredPolls } = applyChatActionBatch([
        { type: "create_poll", actorName: "France", pollRef: "armistice", question: "Accept the armistice?", options: [{ optionRef: "yes", label: "Accept" }, { optionRef: "no", label: "Refuse" }] },
        { type: "poll_vote", actorName: "France", pollRef: "armistice", optionRef: "yes" },
        { type: "poll_vote", actorName: "Prussia", pollRef: "armistice", optionRef: "no" },
    ], roster(), { time: "1871-01-26" });

    assert.deepEqual(rejected, []);
    assert.deepEqual(unansweredPolls, [], "every AI participant voted");
    const [poll] = projectChatThread([
        { id: "c", kind: "chat_created", title: "Armistice" },
        { id: "j1", kind: "member_joined", member: "France" },
        { id: "j2", kind: "member_joined", member: "Prussia" },
        ...events,
    ]).polls;
    assert.equal(poll.question, "Accept the armistice?");
    assert.deepEqual(poll.tally.map((option) => `${option.label}:${option.votes}`), ["Accept:1", "Refuse:1"]);
});

test("a poll the AI participants did not answer is reported as a failure", () => {
    const { unansweredPolls } = applyChatActionBatch([
        { type: "create_poll", actorName: "France", pollRef: "p", question: "Adjourn?", options: [{ optionRef: "y", label: "Yes" }, { optionRef: "n", label: "No" }] },
        { type: "poll_vote", actorName: "France", pollRef: "p", optionRef: "y" },
    ], roster(), {});
    assert.equal(unansweredPolls.length, 1);
    assert.deepEqual(unansweredPolls[0].missing, ["Prussia"]);
    assert.match(describeChatActionFeedback({ unansweredPolls }), /Prussia did not vote/);
});

test("the first vote of an actor stands, in the batch and against a poll already open", () => {
    const twice = applyChatActionBatch([
        { type: "create_poll", actorName: "France", pollRef: "p", question: "Adjourn?", options: [{ optionRef: "y", label: "Yes" }, { optionRef: "n", label: "No" }] },
        { type: "poll_vote", actorName: "France", pollRef: "p", optionRef: "y" },
        { type: "poll_vote", actorName: "France", pollRef: "p", optionRef: "n" },
        { type: "poll_vote", actorName: "Prussia", pollRef: "p", optionRef: "n" },
    ], roster(), {});
    assert.equal(twice.rejected.length, 1);
    assert.match(twice.rejected[0].reason, /already voted/);

    const open = applyChatActionBatch([
        { type: "poll_vote", actorName: "France", pollRef: "poll-open-1", optionRef: "Accept" },
    ], roster({ polls: [{ id: "poll-open-1", options: [{ id: "o1", label: "Accept" }], votes: { France: "o1" } }] }), {});
    assert.equal(open.rejected.length, 1);
    assert.match(open.rejected[0].reason, /already voted/);
});

test("membership moves, and neither a human nor an outsider can be removed", () => {
    const { events, applied, rejected } = applyChatActionBatch([
        { type: "add_member", actorName: "France", targetName: "Austria" },
        { type: "add_member", actorName: "France", targetName: "Atlantis" },
        { type: "add_member", actorName: "France", targetName: "Prussia" },
        { type: "remove_member", actorName: "France", targetName: "Bavaria" },
        { type: "remove_member", actorName: "Prussia", targetName: "Austria" },
        { type: "rename_chat", actorName: "Prussia", title: "The Nancy conference" },
    ], roster(), { time: "1870-07-16" });

    assert.deepEqual(applied.map((action) => `${action.type}:${action.targetName ?? action.title ?? ""}`), [
        "add_member:Austria", "remove_member:Austria", "rename_chat:The Nancy conference",
    ]);
    assert.equal(rejected.length, 3);
    assert.match(rejected[0].reason, /not a polity on this map/);
    assert.match(rejected[1].reason, /already in this chat/);
    assert.match(rejected[2].reason, /played by a human/);
    assert.deepEqual(events.map((event) => event.kind), ["member_joined", "member_left", "title_changed"]);
});

test("a batch is bounded, and the feedback names every refusal", () => {
    const many = Array.from({ length: MAX_ACTIONS_PER_BATCH + 5 }, (_unused, index) => ({ type: "send_message", actorName: "France", content: `line ${index}` }));
    assert.equal(applyChatActionBatch(many, roster(), {}).applied.length, MAX_ACTIONS_PER_BATCH);

    const feedback = describeChatActionFeedback({
        rejected: [{ action: { type: "send_message", actorName: "Bavaria" }, reason: "played by a human" }],
    });
    assert.match(feedback, /^\[What your last actions did\]/);
    assert.match(feedback, /send_message by Bavaria was refused: played by a human\./);
    assert.equal(describeChatActionFeedback({}), "", "nothing to say when everything landed");
});

// What a live run actually wrote (2026-09-17): the poll's options came back as
// bare strings and the votes named them by label, so the whole poll and both
// votes were refused over bookkeeping. A label IS a usable ref.
test("a poll written loosely still lands: bare options, votes by label", () => {
    const { events, applied, rejected, unansweredPolls } = applyChatActionBatch([
        { type: "create_poll", actorName: "France", pollRef: "ceasefire_vote", question: "Accept an immediate ceasefire?", options: ["Accept", "Refuse"] },
        { type: "poll_vote", actorName: "France", pollRef: "ceasefire_vote", optionRef: "Accept" },
        { type: "poll_vote", actorName: "Prussia", pollRef: "ceasefire_vote", optionRef: "refuse" },
    ], roster(), { time: "1871-01-26" });

    assert.deepEqual(rejected, [], "nothing was refused over a missing ref");
    assert.equal(applied.length, 3);
    assert.deepEqual(unansweredPolls, []);
    const [poll] = projectChatThread([
        { id: "c", kind: "chat_created", title: "Armistice" },
        { id: "j1", kind: "member_joined", member: "France" },
        { id: "j2", kind: "member_joined", member: "Prussia" },
        ...events,
    ]).polls;
    assert.deepEqual(poll.options.map((option) => option.label), ["Accept", "Refuse"]);
    assert.deepEqual(poll.tally.map((option) => `${option.label}:${option.votes}`), ["Accept:1", "Refuse:1"]);
});

test("an option given as {label} alone, and a vote by its own ref, both work", () => {
    const { rejected } = applyChatActionBatch([
        { type: "create_poll", actorName: "France", pollRef: "p", question: "Adjourn?", options: [{ label: "Adjourn for a week" }, { optionRef: "sit", label: "Sit on" }] },
        { type: "poll_vote", actorName: "France", pollRef: "p", optionRef: "adjourn-for-a-week" },
        { type: "poll_vote", actorName: "Prussia", pollRef: "p", optionRef: "sit" },
    ], roster(), {});
    assert.deepEqual(rejected, []);
});

test("institution channels reject generic membership mutations without rejecting sibling speech", () => {
  const result = applyChatActionBatch([
    { type: "add_member", actorName: "France", targetName: "Spain" },
    { type: "send_message", actorName: "France", content: "The council should decide membership formally." },
  ], {
    aiParticipants: ["France"], humanParticipants: ["Germany"], knownPolities: ["France", "Germany", "Spain"],
  }, { time: "2026-01-01", disallowMembershipChanges: true });
  assert.equal(result.applied.length, 1);
  assert.equal(result.events[0].kind, "message");
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /institution ledger/i);
});
