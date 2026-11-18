/*! Open Historia — a player's own device answering for the AI's governments: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/ownReplies.test.js
//
// The host of a shared game may have each player's own device answer for the
// governments the AI plays (host/settings.js `replies: "own"`). The owner,
// 2026-11-15: "build C and D, and the host can choose, but no sending api
// keys". So the device asks its own model and sends the host the words.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PLAYER_REQUESTS, REPLY_MAX_CHARS, REPLY_MAX_LINES } from "../game/messages.js";
import { validate } from "../protocol/validate.js";
import { pendingSharedThread } from "./sharedThreads.js";
import {
  OWN_REPLY_CHARS_MAX,
  OWN_REPLY_LINES_MAX,
  OWN_REPLY_VIEW_MS,
  createOwnReplies,
  ownReplyAsked,
  replyLinesForHost,
} from "./ownReplies.js";

const ESTONIA = "Republic of Estonia";
const FRANCE = "France";

test("the host's answer to a line says whether this device answers it, for which line and which governments", () => {
  const kept = { id: "thread-7", countries: [{ name: ESTONIA }], messages: [] };
  const pending = pendingSharedThread([{ name: ESTONIA }], { now: () => 7 });
  // The host's own computer answers (or nobody does): nothing for this device.
  assert.equal(ownReplyAsked(kept, { ok: true }), null);
  assert.equal(ownReplyAsked(pending, { ok: true, result: { chatId: "thread-9" } }), null);
  assert.equal(ownReplyAsked(kept, { ok: false, error: "The round is being resolved", result: { answer: "own", line: "m1", governments: [ESTONIA] } }), null);
  // This device answers: a thread the host keeps is the one written in.
  assert.deepEqual(ownReplyAsked(kept, { ok: true, result: { answer: "own", line: "message-1", governments: [ESTONIA, FRANCE] } }),
    { thread: "thread-7", line: "message-1", governments: [ESTONIA, FRANCE] });
  // A thread this line opened is the one the host named, never the pending one's own id.
  assert.deepEqual(ownReplyAsked(pending, { ok: true, result: { chatId: "thread-9", answer: "own", line: "message-2", governments: [ESTONIA] } }),
    { thread: "thread-9", line: "message-2", governments: [ESTONIA] });
  assert.equal(ownReplyAsked(pending, { ok: true, result: { answer: "own", line: "message-2", governments: [ESTONIA] } }), null, "a pending thread the host did not name has nowhere to answer");
  // Nothing to answer for, or no line to answer.
  assert.equal(ownReplyAsked(kept, { ok: true, result: { answer: "own", line: "message-1", governments: [] } }), null);
  assert.equal(ownReplyAsked(kept, { ok: true, result: { answer: "own", governments: [ESTONIA] } }), null);
});

test("the words are sent as the host takes them: names and what was said, within what one reply holds", () => {
  assert.equal(OWN_REPLY_LINES_MAX, REPLY_MAX_LINES);
  assert.equal(OWN_REPLY_CHARS_MAX, REPLY_MAX_CHARS);
  const lines = replyLinesForHost([
    { speaker: ` ${ESTONIA} `, text: "  Tallinn hears Moscow.\n\nIt will answer.  " },
    { speaker: "", text: "Nobody's words." },
    { speaker: FRANCE, text: "   " },
    { speaker: FRANCE, text: "x".repeat(REPLY_MAX_CHARS + 500) },
    ...Array.from({ length: 12 }, (_, index) => ({ speaker: FRANCE, text: `Line ${index}.` })),
  ]);
  assert.equal(lines.length, REPLY_MAX_LINES);
  assert.deepEqual(lines[0], { speaker: ESTONIA, text: "Tallinn hears Moscow.\n\nIt will answer." }, "a government's paragraphs are kept");
  assert.equal(lines[1].text.length, REPLY_MAX_CHARS);
  const request = { t: "reply", id: "0123456789abcdef", thread: "thread-7", line: "message-1", lines };
  assert.equal(validate(PLAYER_REQUESTS.reply, request).ok, true);
  assert.deepEqual(replyLinesForHost(null), []);
});

// A runner with a view, a model and a host that the test answers for.
const rig = (options = {}) => {
  let t = 0;
  // `thread: null`: the view never holds the thread at all.
  const view = { thread: "thread" in options ? options.thread : { id: "thread-7", messages: [{ id: "message-1", role: "user", text: "Moscow to Tallinn." }] } };
  const asked = [];
  const sent = [];
  const logged = [];
  const changes = [];
  const replies = createOwnReplies({
    readThread: async (thread) => (view.thread && view.thread.id === thread ? view.thread : null),
    write: async (request) => {
      asked.push(request);
      return options.write ? options.write(request, asked.length) : { lines: [{ speaker: ESTONIA, text: "Tallinn hears Moscow." }], unreachable: false, reason: "", refused: 0 };
    },
    send: async (fields) => {
      sent.push(fields);
      return options.send ? options.send(fields, sent.length) : { ok: true, error: "" };
    },
    // Each wait is a quarter of a second of the test's own clock.
    wait: async (ms) => { t += ms; },
    now: () => t,
    log: (text, why) => logged.push({ text, why }),
  });
  replies.subscribe(() => changes.push(replies.get("thread-7")?.status ?? "done"));
  const line = { thread: "thread-7", line: "message-1", governments: [ESTONIA], text: "Moscow to Tallinn.", playerCountry: "Russian Federation" };
  return { replies, view, asked, sent, logged, changes, line, clock: () => t };
};

test("this device asks its own model once the view holds the line, and sends the host the words and nothing else", async () => {
  const r = rig();
  await r.replies.start(r.line);
  assert.equal(r.asked.length, 1);
  assert.deepEqual(r.asked[0], { chat: r.view.thread, text: "Moscow to Tallinn.", governments: [ESTONIA], playerCountry: "Russian Federation" });
  assert.deepEqual(r.sent, [{ thread: "thread-7", line: "message-1", lines: [{ speaker: ESTONIA, text: "Tallinn hears Moscow." }] }]);
  assert.equal(validate(PLAYER_REQUESTS.reply, { t: "reply", id: "0123456789abcdef", ...r.sent[0] }).ok, true);
  assert.equal(r.replies.get("thread-7"), null, "done: the lines arrive in the next view, as any line does");
  assert.deepEqual(r.changes, ["writing", "done"]);
  assert.deepEqual(r.logged, []);
});

test("the line is waited for in the view, and given up on when it never comes", async () => {
  // The view brings the line a little later: the governments are shown what was written.
  const late = rig({ thread: { id: "thread-7", messages: [] } });
  const running = late.replies.start(late.line);
  await Promise.resolve();
  late.view.thread = { id: "thread-7", messages: [{ id: "message-1", role: "user", text: "Moscow to Tallinn." }] };
  await running;
  assert.equal(late.asked.length, 1);
  assert.equal(late.sent.length, 1);

  const never = rig({ thread: null });
  await never.replies.start(never.line);
  assert.equal(never.asked.length, 0, "the model is not asked about a line this screen does not hold");
  assert.equal(never.replies.get("thread-7").status, "stopped");
  assert.equal(never.replies.get("thread-7").why, "late");
  assert.ok(never.clock() >= OWN_REPLY_VIEW_MS);
});

test("what stops an answer is kept for the thread to show, and Retry asks again without a second line", async () => {
  // The model could not be reached.
  const r = rig({ write: (_request, attempt) => (attempt === 1 ? { lines: [], unreachable: true, reason: "HTTP 429", refused: 0 } : { lines: [{ speaker: ESTONIA, text: "Tallinn hears Moscow." }] }) });
  await r.replies.start(r.line);
  assert.deepEqual({ ...r.replies.get("thread-7") }, { ...r.line, status: "stopped", why: "unreachable", error: "HTTP 429" });
  assert.equal(r.sent.length, 0);
  assert.equal(r.logged[0].why, "unreachable");
  await r.replies.retry("thread-7");
  assert.equal(r.asked.length, 2);
  assert.deepEqual(r.asked[1], r.asked[0], "the same line, as it stands in the thread");
  assert.equal(r.sent.length, 1);
  assert.equal(r.replies.get("thread-7"), null);
  await r.replies.retry("thread-7");
  assert.equal(r.asked.length, 2, "nothing to try again");

  // The model answered that nobody speaks.
  const quiet = rig({ write: () => ({ lines: [], unreachable: false, reason: "", refused: 2 }) });
  await quiet.replies.start(quiet.line);
  assert.equal(quiet.replies.get("thread-7").why, "silent");
  assert.match(quiet.replies.get("thread-7").error, /2 of the model's actions were refused/);
  assert.equal(quiet.sent.length, 0);

  // The host did not take the words.
  const refused = rig({ send: () => ({ ok: false, error: "That line is not waiting for an answer from your device." }) });
  await refused.replies.start(refused.line);
  assert.equal(refused.replies.get("thread-7").why, "refused");
  assert.match(refused.replies.get("thread-7").error, /not waiting/);

  // Anything else that goes wrong on the way.
  const broken = rig({ write: () => { throw new Error("No AI is set up on this device."); } });
  await broken.replies.start(broken.line);
  assert.equal(broken.replies.get("thread-7").why, "failed");
  assert.equal(broken.replies.get("thread-7").error, "No AI is set up on this device.");
  broken.replies.dismiss("thread-7");
  assert.equal(broken.replies.get("thread-7"), null);
});

test("one answer at a time for a thread: a newer line of the player's takes the place of the one being answered", async () => {
  let release;
  const r = rig({
    write: (_request, attempt) => (attempt === 1
      ? new Promise((resolve) => { release = () => resolve({ lines: [{ speaker: ESTONIA, text: "An answer to the first." }] }); })
      : { lines: [{ speaker: ESTONIA, text: "An answer to the second." }] }),
  });
  const first = r.replies.start(r.line);
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  assert.equal(r.replies.get("thread-7").status, "writing");
  await r.replies.retry("thread-7");
  assert.equal(r.asked.length, 1, "Retry does nothing while an answer is being written");

  r.view.thread = { id: "thread-7", messages: [...r.view.thread.messages, { id: "message-2", role: "user", text: "And Narva?" }] };
  const second = r.replies.start({ ...r.line, line: "message-2", text: "And Narva?" });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(r.sent.map((fields) => [fields.line, fields.lines[0].text]), [["message-2", "An answer to the second."]], "the first answer, overtaken, is not sent");
  assert.equal(r.replies.get("thread-7"), null);

  // Nothing to answer for is nothing to do.
  await r.replies.start({ thread: "thread-7", line: "message-3", governments: [] });
  await r.replies.start({ thread: "", line: "message-3", governments: [ESTONIA] });
  assert.equal(r.asked.length, 2);
});

test("no key goes with the words: the reply has nowhere to carry one, and this file reads none", () => {
  const request = { t: "reply", id: "0123456789abcdef", thread: "thread-7", line: "message-1", lines: [{ speaker: ESTONIA, text: "Words." }] };
  assert.equal(validate(PLAYER_REQUESTS.reply, { ...request, key: "anything" }).ok, false);
  assert.equal(validate(PLAYER_REQUESTS.reply, { ...request, lines: [{ speaker: ESTONIA, text: "Words.", apiKey: "anything" }] }).ok, false);
  const source = readFileSync(new URL("./ownReplies.js", import.meta.url), "utf8");
  assert.equal(/localStorage|api_key|apiKey|import\s/.test(source.replace(/^\s*\/\/.*$/gm, "")), false, "import-free, and nothing of the device's settings");
});
