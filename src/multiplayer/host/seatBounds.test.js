/*! Open Historia — how much one player can make the host do: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/seatBounds.test.js
//
// The review of 2026-11-18 (security S2, S5, S8, S13, S14): nothing bounded what
// one guest made the host do. The queue, the round counts, the readings on the
// host's AI and the words a player is told when the host's AI fails.
import test from "node:test";
import assert from "node:assert/strict";

import { DROPPED, createWorldQueue } from "./worldQueue.js";
import { ADVISOR_SEAT_CHARS_MOST, FLAGS_PER_ROUND, QUEUE_BURST, QUEUE_RATE_PER_SECOND, READINGS_WAITING_MOST, advisorPastBound, createSeatBounds } from "./seatBounds.js";
import { failureKindOf, failureWords, guestFailureWords } from "./failureWords.js";

test("the queue counts what each player has waiting, and drops what a player let go of still had waiting", async () => {
  const queue = createWorldQueue();
  const applied = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const first = queue.run("round", () => held);
  const mine = [1, 2, 3].map((n) => queue.run("goal", () => applied.push(`guest-${n}`), { owner: "device-guest" }));
  const theirs = queue.run("order", () => applied.push("other"), { owner: "device-other" });
  assert.equal(queue.waitingOf("device-guest"), 3);
  assert.equal(queue.waitingOf("device-other"), 1);
  assert.equal(queue.waitingOf("nobody"), 0);
  assert.equal(queue.drop("device-guest", "The host took your country back."), 3);
  release();
  await first;
  for (const entry of mine) {
    await assert.rejects(entry, (error) => error.code === DROPPED && error.message === "The host took your country back.");
  }
  await theirs;
  assert.deepEqual(applied, ["other"], "nothing of the dropped player's was applied, and the others' still were");
  assert.equal(queue.waitingOf("device-guest"), 0);
  assert.equal(queue.drop("device-guest"), 0);
});

test("a player adds to the queue in a burst, then at a steady rate", () => {
  let t = 0;
  const bounds = createSeatBounds({ now: () => t });
  const admitted = Array.from({ length: QUEUE_BURST + 5 }, () => bounds.admit("device-guest")).filter(Boolean).length;
  assert.equal(admitted, QUEUE_BURST);
  assert.equal(bounds.admit("device-other"), true, "each player has its own");
  t += 1000;
  assert.equal(Array.from({ length: 5 }, () => bounds.admit("device-guest")).filter(Boolean).length, QUEUE_RATE_PER_SECOND);
});

test("what a player opens and writes a round is counted, and each round counts afresh", () => {
  const bounds = createSeatBounds();
  for (let n = 0; n < FLAGS_PER_ROUND; n += 1) {
    assert.equal(bounds.spent("flags", "Ruritania", 4), false);
    assert.equal(bounds.take("flags", "Ruritania", 4), true);
  }
  assert.equal(bounds.spent("flags", "ruritania", 4), true, "by the country, case aside");
  assert.equal(bounds.take("flags", "Ruritania", 4), false);
  assert.equal(bounds.spent("flags", "Freedonia", 4), false);
  assert.equal(bounds.spent("flags", "Ruritania", 5), false, "a new round");
});

test("readings on the host's AI: the same one under way is that one, a player's run one after another, and so many at most", async () => {
  const bounds = createSeatBounds();
  const started = [];
  const gates = new Map();
  const job = (name) => () => {
    started.push(name);
    return new Promise((resolve) => gates.set(name, resolve));
  };
  const a = bounds.read("Ruritania", "parties|freedonia", job("freedonia"));
  const again = bounds.read("Freedonia", "parties|freedonia", job("twice"));
  assert.equal(again, a, "a burst for one country is one reading, whoever asks");
  const b = bounds.read("Ruritania", "sheet|elbonia", job("elbonia"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["freedonia"], "one at a time for one player");
  gates.get("freedonia")();
  await a;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["freedonia", "elbonia"]);
  const more = Array.from({ length: READINGS_WAITING_MOST + 1 }, (_, n) => bounds.read("Ruritania", `sheet|c${n}`, () => Promise.resolve()));
  assert.equal(more.filter((entry) => entry === null).length, 2, "so many waiting at most, the one under way among them");
  assert.ok(bounds.read("Ruritania", "sheet|host", () => Promise.resolve(), { most: Infinity }), "the host's own are not held to the number");
  gates.get("elbonia")();
  await b;
});

test("a player's advisor conversations grow only so far; a change that shortens them is always taken", () => {
  const big = [{ role: "user", text: "x".repeat(ADVISOR_SEAT_CHARS_MOST) }];
  assert.equal(advisorPastBound([], [{ role: "user", text: "hello" }]), false);
  assert.equal(advisorPastBound([], big), true);
  assert.equal(advisorPastBound(big, [...big, { role: "user", text: "more" }]), true);
  assert.equal(advisorPastBound([...big, { role: "user", text: "more" }], big), false);
});

test("a failure of the AI is told to the host as it came, and to every other player in the host's words", () => {
  const provider = Object.assign(new Error("Gemini gemini-2.5-pro 429: quota exceeded for key AIza...xyz"), { providerFailure: { kind: "spent", reason: "used today's allowance" } });
  assert.equal(failureKindOf(provider), "spent");
  assert.equal(failureWords(provider, { toHost: true, fallback: "The host could not do that." }), provider.message);
  const guest = failureWords(provider, { fallback: "The host could not write that country's figures." });
  assert.equal(guest, "The host's AI has used up what it may ask for today.", "one whole sentence, for a language to put in its own order");
  assert.equal(guest.includes("Gemini") || guest.includes("AIza"), false);
  assert.equal(guestFailureWords(new Error("http://192.168.1.5:11434 refused"), "The host's AI could not write the round."), "The host's AI could not write the round.", "no kind said, none guessed from the words");
  assert.equal(failureKindOf({ providerFailure: { kind: "made-up" } }), "");
});
