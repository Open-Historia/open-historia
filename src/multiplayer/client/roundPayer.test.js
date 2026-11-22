/*! Open Historia — this device paying for a shared round, in its turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/roundPayer.test.js
//
// The paying device's side: the host's request carried to this device's own
// AI and its answer sent back; a lookup asked of the host with its round; the
// host told the model is at work (at most so often, and at once for a lookup
// round); a failure said to the host by its kind only, the provider's words
// kept here; a stop that stops it; the same request sent again after a
// reconnect answered once; and a game whose host pays answered no.

import test from "node:test";
import assert from "node:assert/strict";

import { PAYER_ALIVE_MS, createRoundPayer } from "./roundPayer.js";
import { createGameClient } from "./gameClient.js";
import { PLAYER_REQUESTS } from "../game/messages.js";
import { validate } from "../protocol/validate.js";

const CALL = { systemPrompt: "The world as the host built it.", history: [], tool: null, lookupTools: [], maxRounds: null, taskKey: "jumpForward", staticPrefixEnd: null, sharedPrefixEnd: null, promptCacheKey: "", maxTokens: null };
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

test("this device carries the host's request to its own AI and sends back the answer, asking the host for a lookup on the way", async () => {
  const sent = [];
  const looked = [];
  const asked = [];
  const told = [];
  let at = 1000;
  const payer = createRoundPayer({
    ask: async (call, { execute, onRequest, onActivity, onRound }) => {
      asked.push(call);
      onRequest(200);
      onActivity();
      onActivity();
      onRound(1);
      const region = await execute("look_up_region", { name: "Narva" }, 2);
      at += PAYER_ALIVE_MS;
      onActivity();
      return { text: "", toolJson: JSON.stringify({ events: [{ title: `Talks at ${region.region}` }] }), asText: false };
    },
    answer: async (fields) => { sent.push(fields); return { ok: true, error: "" }; },
    lookup: async (fields) => { looked.push(fields); return { ok: true, error: "", result: { text: JSON.stringify({ region: "Narva" }) } }; },
    alive: (message) => told.push(message),
    now: () => at,
  });
  payer.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  assert.equal(payer.get().status, "paying");
  // Sent again after a reconnect: the one under way answers it.
  payer.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  await flush();
  assert.equal(asked.length, 1);
  assert.deepEqual(looked, [{ job: "pay-2-1", name: "look_up_region", args: { name: "Narva" }, round: 2 }], "with the lookup round it was asked in");
  assert.deepEqual(told, [
    { t: "payAlive", job: "pay-2-1", round: 0 },
    { t: "payAlive", job: "pay-2-1", round: 1 },
    { t: "payAlive", job: "pay-2-1", round: 0 },
  ], "the model at work: once a while, and at once for a lookup round begun");
  for (const message of told) assert.equal(validate(PLAYER_REQUESTS.payAlive, message).ok, true);
  assert.deepEqual(sent, [{ job: "pay-2-1", answer: { text: "", toolJson: "{\"events\":[{\"title\":\"Talks at Narva\"}]}", asText: false }, statuses: [200] }], "with what its provider said, for the host's skip to read");
  assert.equal(payer.get(), null, "done: the round's events come in the next view");
});

test("a request this device cannot make is answered with its kind alone, a stop stops it, and a game whose host pays is answered no", async () => {
  const sent = [];
  const answer = async (fields) => { sent.push(fields); return { ok: true, error: "" }; };
  // The provider's own words (here with a masked key in them) stay on this device.
  const failing = createRoundPayer({
    ask: async (call, { onRequest }) => {
      onRequest(401);
      throw Object.assign(new Error("Incorrect API key provided: sk-proj-****abcd."), { payFailure: { kind: "unusable", busy: false } });
    },
    answer,
    lookup: async () => ({ ok: false }),
  });
  failing.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  await flush();
  assert.deepEqual(sent.at(-1), { job: "pay-2-1", failure: { kind: "unusable", busy: false }, statuses: [401] });
  assert.equal(JSON.stringify(sent).includes("sk-proj"), false, "nothing of the provider's words goes to the host");
  assert.equal(validate(PLAYER_REQUESTS.paid, { t: "paid", id: "0".repeat(16), ...sent.at(-1) }).ok, true);
  assert.deepEqual(failing.get(), { job: "pay-2-1", round: 2, status: "failed", error: "Incorrect API key provided: sk-proj-****abcd." }, "shown here, to this device's own player");
  // An error with no kind is "other".
  const plain = createRoundPayer({ ask: async () => { throw new Error("boom"); }, answer, lookup: async () => ({ ok: false }) });
  plain.receive({ t: "pay", job: "pay-2-2", round: 2, call: CALL });
  await flush();
  assert.deepEqual(sent.at(-1).failure, { kind: "other", busy: false });

  let stopped = null;
  const slow = createRoundPayer({
    ask: (call, { signal }) => new Promise((resolve, reject) => { signal.addEventListener("abort", () => { stopped = true; reject(new Error("aborted")); }); }),
    answer,
    lookup: async () => ({ ok: false }),
  });
  slow.receive({ t: "pay", job: "pay-3-1", round: 3, call: CALL });
  slow.receive({ t: "payStop", job: "pay-3-9" });
  assert.equal(slow.get().status, "paying", "another request's stop is not this one's");
  slow.receive({ t: "payStop", job: "pay-3-1" });
  await flush();
  assert.equal(stopped, true);
  assert.equal(slow.get(), null);
  assert.equal(sent.some((entry) => entry.job === "pay-3-1"), false, "the host no longer waits: nothing is sent");

  const hostPays = createRoundPayer({ ask: async () => assert.fail("asked in a game whose host pays"), answer, lookup: async () => ({ ok: false }), cycle: () => false });
  hostPays.receive({ t: "pay", job: "pay-4-1", round: 4, call: CALL });
  await flush();
  assert.deepEqual(sent.at(-1), { job: "pay-4-1", failure: { kind: "declined", busy: false } });
});

test("an answer this device cannot send still reaches the host as its kind", async () => {
  const sent = [];
  const payer = createRoundPayer({
    ask: async () => ({ text: "x", toolJson: "", asText: true }),
    answer: async (fields) => { sent.push(fields); return fields.answer ? { ok: false, error: "$.answer.text: longer than 1000000" } : { ok: true, error: "" }; },
    lookup: async () => ({ ok: false }),
  });
  payer.receive({ t: "pay", job: "pay-5-1", round: 5, call: CALL });
  await flush();
  assert.deepEqual(sent.at(-1), { job: "pay-5-1", failure: { kind: "unsent", busy: false }, statuses: [] });
  assert.match(payer.get().error, /longer than 1000000/);
});

test("the host's request and its stop reach the payer through the game's own client", () => {
  const paid = [];
  const client = createGameClient({ send: () => {}, onPay: (message) => paid.push(message.t) });
  client.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  client.receive({ t: "payStop", job: "pay-2-1" });
  assert.deepEqual(paid, ["pay", "payStop"]);
  client.close();
});
