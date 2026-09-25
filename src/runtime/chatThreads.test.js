/*! Open Historia — chat thread event-log tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/chatThreads.test.js
//
// Runs without node_modules: chatThreads.js imports nothing.
//
// The invariant: the projection of a log is exactly the shape every existing
// reader of a chat expects (countries, messages, title), so event-sourcing the
// threads changes nothing for them — while the log answers what the old shape
// could not: who was in the room when something was said, who renamed it, and
// how the vote went.

import test from "node:test";
import assert from "node:assert/strict";

import {
    CHAT_EVENTS_LIMIT,
    eventsFromLegacyChat,
    membersAtEvent,
    normalizeChatEvent,
    normalizeChatEvents,
    projectChatThread,
    threadAsSeenBy,
    withUnloggedMessages,
} from "./chatThreads.js";

const legacy = () => ({
    id: "chat-1",
    title: "French mediation offer",
    source: "invitation",
    status: "open",
    countries: [{ code: "FRA", name: "France" }, { name: "Prussia" }],
    messages: [
        { id: "m1", role: "leader", speaker: "France", code: "FRA", text: "We propose talks at Nancy.", time: "1870-07-14" },
        { id: "m2", role: "user", speaker: "Bavaria", text: "On what terms?", time: "1870-07-15", reactions: { Prussia: { emoji: "🤨", code: "" } } },
    ],
});

test("a thread saved before the log existed becomes one, in order", () => {
    const events = eventsFromLegacyChat(legacy());
    assert.deepEqual(events.map((event) => event.kind), [
        "chat_created", "member_joined", "member_joined", "message", "message", "reaction",
    ]);
    assert.equal(events[0].title, "French mediation offer");
    assert.equal(events[1].member.name, "France");
    assert.equal(events[3].text, "We propose talks at Nancy.");
    assert.equal(events[5].emoji, "🤨");
    assert.equal(events[5].target, "m2");
});

test("the projection is the shape every existing reader already expects", () => {
    const projected = projectChatThread(eventsFromLegacyChat(legacy()));
    assert.equal(projected.title, "French mediation offer");
    assert.equal(projected.source, "invitation");
    assert.deepEqual(projected.countries, [{ code: "FRA", name: "France" }, { code: "", name: "Prussia" }]);
    assert.equal(projected.messages.length, 2);
    assert.equal(projected.messages[0].speaker, "France");
    assert.equal(projected.messages[0].text, "We propose talks at Nancy.");
    assert.deepEqual(projected.messages[1].reactions, { Prussia: { emoji: "🤨", code: "" } });
});

test("multiple reactions from the same participant are preserved instead of overwritten", () => {
    const projected = projectChatThread([
        { id: "c1", kind: "chat_created", time: "1815-01-01" },
        { id: "j1", kind: "member_joined", member: { name: "France", code: "FRA" } },
        { id: "m1", kind: "message", by: "Player", role: "user", text: "Agreed." },
        { id: "r1", kind: "reaction", by: "France", code: "FRA", target: "m1", emoji: "🤝" },
        { id: "r2", kind: "reaction", by: "France", code: "FRA", target: "m1", emoji: "👍" },
    ]);

    assert.deepEqual(projected.messages[0].reactions, {
        France: { emoji: "🤝", code: "FRA" },
        "France#2": { emoji: "👍", code: "FRA", country: "France" },
    });

    const roundTrip = eventsFromLegacyChat({ countries: projected.countries, messages: projected.messages });
    const reactionActors = roundTrip.filter((event) => event.kind === "reaction").map((event) => event.by);
    assert.deepEqual(reactionActors, ["France", "France"]);
});

test("migration is idempotent: a log projected and migrated again is the same log", () => {
    const once = eventsFromLegacyChat(legacy());
    const projected = projectChatThread(once);
    const twice = eventsFromLegacyChat({ ...legacy(), countries: projected.countries, messages: projected.messages });
    assert.deepEqual(twice.map((event) => `${event.kind}:${event.text ?? event.member?.name ?? event.emoji ?? ""}`),
        once.map((event) => `${event.kind}:${event.text ?? event.member?.name ?? event.emoji ?? ""}`));
});

test("membership is a history, not a list: joins, departures and who was in the room", () => {
    const events = [
        { id: "e1", kind: "chat_created", title: "Congress", time: "1815-01-01" },
        { id: "e2", kind: "member_joined", member: "Austria" },
        { id: "e3", kind: "member_joined", member: "Prussia" },
        { id: "e4", kind: "message", by: "Austria", text: "We open." },
        { id: "e5", kind: "member_joined", member: "France" },
        { id: "e6", kind: "message", by: "France", text: "We are here." },
        { id: "e7", kind: "member_left", member: "Prussia" },
        { id: "e8", kind: "message", by: "Austria", text: "Prussia has withdrawn." },
    ];
    const projected = projectChatThread(events);
    assert.deepEqual(projected.countries.map((member) => member.name), ["Austria", "France"], "Prussia left");
    assert.deepEqual(projected.messages[0].heardBy, ["Austria", "Prussia"], "France was not yet in the room");
    assert.deepEqual(projected.messages[1].heardBy, ["Austria", "Prussia", "France"]);
    assert.deepEqual(projected.messages[2].heardBy, ["Austria", "France"]);
    assert.deepEqual(membersAtEvent(events, "e4").map((member) => member.name), ["Austria", "Prussia"]);
});

test("a newcomer is shown only what was said while it was in the room", () => {
    const events = [
        { id: "e1", kind: "chat_created", title: "Congress" },
        { id: "e2", kind: "member_joined", member: "Austria" },
        { id: "e3", kind: "message", by: "Austria", text: "A secret we agreed before France arrived." },
        { id: "e4", kind: "member_joined", member: "France" },
        { id: "e5", kind: "message", by: "France", text: "What have we missed?" },
    ];
    const asFrance = threadAsSeenBy(events, "France");
    assert.deepEqual(asFrance.messages.map((message) => message.text), ["What have we missed?"]);
    const asAustria = threadAsSeenBy(events, "Austria");
    assert.equal(asAustria.messages.length, 2);
    assert.equal(threadAsSeenBy(events, "").messages.length, 2, "no viewer is the narrator: everything");
});

test("a poll is created, extended and voted, and the first vote of an actor is final", () => {
    const events = [
        { id: "e1", kind: "chat_created", title: "Armistice" },
        { id: "e2", kind: "member_joined", member: "France" },
        { id: "e3", kind: "member_joined", member: "Prussia" },
        { id: "e4", kind: "poll_created", by: "France", pollId: "p1", question: "Accept the armistice on the terms of 26 January?", options: [{ id: "yes", label: "Accept" }, { id: "no", label: "Refuse" }] },
        { id: "e5", kind: "poll_option_added", by: "Prussia", pollId: "p1", optionId: "delay", label: "Adjourn for a week" },
        { id: "e6", kind: "poll_vote_cast", by: "France", pollId: "p1", optionId: "yes" },
        { id: "e7", kind: "poll_vote_cast", by: "Prussia", pollId: "p1", optionId: "delay" },
        { id: "e8", kind: "poll_vote_cast", by: "France", pollId: "p1", optionId: "no" },
        { id: "e9", kind: "poll_vote_cast", by: "Prussia", pollId: "p1", optionId: "nonexistent" },
    ];
    const [poll] = projectChatThread(events).polls;
    assert.equal(poll.question, "Accept the armistice on the terms of 26 January?");
    assert.equal(poll.options.length, 3);
    assert.deepEqual(poll.votes, { France: "yes", Prussia: "delay" }, "the second vote of an actor is refused, as is a vote for nothing");
    assert.deepEqual(poll.tally.map((option) => `${option.id}:${option.votes}`), ["yes:1", "no:0", "delay:1"]);
});

test("malformed events are refused, not stored", () => {
    assert.equal(normalizeChatEvent({ kind: "message", text: "" }), null);
    assert.equal(normalizeChatEvent({ kind: "message", text: "hi" }).role, "system", "no speaker is the system");
    assert.equal(normalizeChatEvent({ kind: "nonsense", text: "hi" }), null);
    assert.equal(normalizeChatEvent({ kind: "poll_created", pollId: "p", question: "q?", options: [{ label: "only one" }] }), null, "a poll needs two options");
    assert.equal(normalizeChatEvent({ kind: "poll_vote_cast", pollId: "p", optionId: "o" }), null, "a vote needs a voter");
    assert.equal(normalizeChatEvent({ kind: "member_joined", member: "" }), null);
    assert.equal(normalizeChatEvent("nonsense"), null);
    assert.deepEqual(normalizeChatEvents([{ id: "dup", kind: "message", text: "a" }, { id: "dup", kind: "message", text: "b" }]).length, 1);
});

test("a very long thread keeps its structure and its newest talk", () => {
    const events = [
        { id: "created", kind: "chat_created", title: "Long war" },
        { id: "join-1", kind: "member_joined", member: "France" },
        ...Array.from({ length: CHAT_EVENTS_LIMIT + 50 }, (_unused, index) => ({ id: `m${index}`, kind: "message", by: "France", text: `line ${index}` })),
    ];
    const kept = normalizeChatEvents(events);
    assert.equal(kept.length, CHAT_EVENTS_LIMIT);
    assert.equal(kept[0].kind, "chat_created", "the creation is never dropped");
    assert.equal(kept[1].kind, "member_joined", "nor is a join: it is who is in the room");
    assert.equal(kept.at(-1).text, `line ${CHAT_EVENTS_LIMIT + 49}`, "the newest talk is what survives");
    assert.deepEqual(projectChatThread(kept).countries.map((member) => member.name), ["France"]);
});

test("a message written beside the log is folded into it, once, and a re-read changes nothing", () => {
    // The second one-request group turn: the log already exists, and the
    // player's new line reached the thread only through its `messages`.
    const log = [
        { id: "c", kind: "chat_created", title: "Conference" },
        { id: "j1", kind: "member_joined", member: "France" },
        { id: "j2", kind: "member_joined", member: "Prussia" },
        { id: "m1", kind: "message", by: "France", role: "leader", text: "We open." },
    ];
    const messages = [
        ...projectChatThread(log).messages,
        { role: "user", speaker: "Bavaria", text: "Then we answer.", time: "1870-07-16" },
        { role: "error", speaker: "System", text: "This chat has no valid participants." },
    ];
    const folded = withUnloggedMessages(log, messages, { threadId: "chat-9" });
    assert.deepEqual(projectChatThread(folded).messages.map((message) => `${message.speaker}: ${message.text}`), [
        "France: We open.",
        "Bavaria: Then we answer.",
    ], "the player's line is kept and the error bubble is not");
    const again = withUnloggedMessages(folded, [...messages, ...projectChatThread(folded).messages], { threadId: "chat-9" });
    assert.deepEqual(again, folded, "idempotent: the content-derived id matches on every read");
    assert.equal(folded.at(-1).role, "user");
});

test("a message the log already has, by id or by speaker and words, is not added twice", () => {
    const log = [
        { id: "c", kind: "chat_created", title: "Talks" },
        { id: "j1", kind: "member_joined", member: "France" },
        { id: "m1", kind: "message", by: "France", role: "leader", text: "We open." },
    ];
    const same = withUnloggedMessages(log, [
        { id: "m1", speaker: "France", text: "We open (edited on screen)." },
        { speaker: "france", text: "We open." },
    ]);
    assert.deepEqual(same, normalizeChatEvents(log));
    assert.deepEqual(withUnloggedMessages([], [{ speaker: "France", text: "hi" }]), [], "no log, nothing to fold into");
});
