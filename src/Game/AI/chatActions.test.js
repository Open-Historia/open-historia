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
    CHAT_REVEAL_MAX_PAUSE_MS,
    CHAT_REVEAL_MIN_PAUSE_MS,
    MAX_ACTIONS_PER_BATCH,
    applyChatActionBatch,
    describeChatActionFeedback,
    describeChatCutIn,
    normalizeChatAction,
    planChatReveal,
    randomChatRevealPauseMs,
    stripRedundantChatSpeakerPrefix,
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

test("structured messages strip only a redundant exact leading speaker label", () => {
    assert.equal(stripRedundantChatSpeakerPrefix("French Republic: France supports the proposal.", "French Republic"), "France supports the proposal.");
    assert.equal(stripRedundantChatSpeakerPrefix("French Republic - France supports the proposal.", "French Republic"), "France supports the proposal.");
    assert.equal(stripRedundantChatSpeakerPrefix("France: France supports the proposal.", "French Republic"), "France: France supports the proposal.", "aliases are not guessed");
    assert.equal(stripRedundantChatSpeakerPrefix("We agree with French Republic: this should pass.", "French Republic"), "We agree with French Republic: this should pass.", "later mentions are untouched");
    assert.deepEqual(
        normalizeChatAction({ type: "send_message", actorName: "French Republic", content: "French Republic: France supports the proposal." }),
        { type: "send_message", actorName: "French Republic", content: "France supports the proposal." },
    );
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

test("a second turn on the same game day mints ids of its own, so its replies are not dropped", () => {
    const base = [
        { id: "c", kind: "chat_created", title: "Talks" },
        { id: "j1", kind: "member_joined", member: { name: "France" } },
        { id: "j2", kind: "member_joined", member: { name: "Prussia" } },
    ];
    const first = applyChatActionBatch([{ type: "send_message", actorName: "France", content: "First turn." }], roster(), { time: "1871-01-26" });
    const log = [...base, ...first.events];
    const second = applyChatActionBatch([
        { type: "send_message", actorName: "Prussia", content: "Second turn." },
        { type: "add_reaction", actorName: "France", targetEntryId: first.events[0].id, emoji: "👍" },
    ], roster({ messageIds: first.events.map((event) => event.id) }), { time: "1871-01-26", takenIds: log.map((event) => event.id) });
    const secondIds = second.events.map((event) => event.id);
    assert.equal(secondIds.some((id) => log.some((event) => event.id === id)), false, "no id of the first turn is minted again");
    assert.equal(new Set(secondIds).size, secondIds.length);
    const messages = projectChatThread([...log, ...second.events]).messages;
    assert.deepEqual(messages.map((message) => message.text), ["First turn.", "Second turn."], "the second turn's reply is in the thread");
    assert.deepEqual(Object.keys(messages[0].reactions), ["France"], "the reaction is on the line it named");
    assert.deepEqual(messages[1].reactions, {});
});

// ---------------------------------------------------------------------------
// Saying a batch a line at a time

const ids = (steps) => steps.map((step) => step.events.map((event) => event.id));

test("a batch is said a message at a time, each with what follows it", () => {
    const { events } = applyChatActionBatch([
        { type: "rename_chat", actorName: "France", title: "Armistice talks" },
        { type: "send_message", actorName: "France", content: "We ask for terms." },
        { type: "add_reaction", actorName: "Prussia", targetEntryId: "m1", emoji: "👍" },
        { type: "send_message", actorName: "Prussia", content: "Alsace first." },
        { type: "create_poll", actorName: "Prussia", pollRef: "p", question: "Sign now?", options: ["Yes", "No"] },
        { type: "poll_vote", actorName: "Prussia", pollRef: "p", optionRef: "yes" },
        { type: "poll_vote", actorName: "France", pollRef: "p", optionRef: "no" },
        { type: "send_message", actorName: "France", content: "Never." },
    ], roster(), { time: "1871-01-26" });
    const steps = planChatReveal(events);
    assert.deepEqual(steps.map((step) => step.speaker), ["France", "Prussia", "France"], "one step per message, named for its speaker");
    assert.deepEqual(steps.map((step) => step.events.map((event) => event.kind)), [
        ["title_changed", "message", "reaction"],
        ["message", "poll_created", "poll_vote_cast", "poll_vote_cast"],
        ["message"],
    ], "what comes before the first message goes with it; the rest follows its message");
    assert.deepEqual(ids(steps).flat(), events.map((event) => event.id), "every event, once, in order");
    assert.equal(CHAT_REVEAL_MIN_PAUSE_MS, 1000);
    assert.equal(CHAT_REVEAL_MAX_PAUSE_MS, 3000);
});

test("group reply pauses are randomized independently inside the 1-3 second window", () => {
    assert.equal(randomChatRevealPauseMs(() => 0), 1000);
    assert.equal(randomChatRevealPauseMs(() => 0.5), 2000);
    assert.equal(randomChatRevealPauseMs(() => 0.999999), 3000);
    assert.equal(randomChatRevealPauseMs(() => -1), 1000, "bad low samples clamp safely");
    assert.equal(randomChatRevealPauseMs(() => Number.NaN), 1000, "non-numeric samples fail closed to the minimum");
});

test("a batch with fewer than two messages is one step, and nothing is none", () => {
    const one = [{ id: "m", kind: "message", by: "France", text: "Yes." }, { id: "r", kind: "reaction", by: "Prussia", target: "m", emoji: "🙂" }];
    assert.deepEqual(ids(planChatReveal(one)), [["m", "r"]]);
    const quiet = [{ id: "r", kind: "reaction", by: "Prussia", target: "m1", emoji: "🙂" }];
    assert.deepEqual(planChatReveal(quiet), [{ speaker: "", events: quiet }], "a reaction alone is shown at once");
    assert.deepEqual(planChatReveal([]), []);
    assert.deepEqual(planChatReveal(null), []);
});

test("cutting in tells the next turn whose lines went unsaid, never the lines", () => {
    const steps = planChatReveal([
        { id: "a", kind: "message", by: "Prussia", text: "Alsace first." },
        { id: "v", kind: "poll_vote_cast", by: "Prussia", pollId: "p", optionId: "o" },
        { id: "b", kind: "message", by: "France", text: "Never." },
        { id: "c", kind: "message", by: "Prussia", text: "Then war." },
    ]);
    const note = describeChatCutIn({ player: "Bavaria", steps });
    assert.match(note, /^\[The player cut in\]/);
    assert.match(note, /Bavaria spoke before Prussia and France had finished/);
    assert.match(note, /Answer what Bavaria has just said/);
    assert.equal(/Alsace|Never|war/.test(note), false, "the unsaid words are not repeated to the model");
    assert.match(describeChatCutIn({ player: "Bavaria", steps: steps.slice(1, 2) }), /before France had finished: what it was about to say/);
    assert.equal(describeChatCutIn({ player: "Bavaria", steps: [] }), "");
    assert.equal(describeChatCutIn({ player: "Bavaria", steps: [{ speaker: "", events: [{ id: "v", kind: "poll_vote_cast" }] }] }), "", "no line went unsaid");
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
