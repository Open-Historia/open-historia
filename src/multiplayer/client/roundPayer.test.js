/*! Open Historia — this device paying for a shared round, in its turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/roundPayer.test.js
//
// The paying device's side: the host's request carried to this device's own
// AI and its answer sent back; a lookup asked of the host; a failure said to
// the host with why; a stop that stops it; the same request sent again after a
// reconnect answered once; and a game whose host pays answered no.

import test from "node:test";
import assert from "node:assert/strict";

import { createRoundPayer } from "./roundPayer.js";
import { createGameClient } from "./gameClient.js";

const CALL = { systemPrompt: "The world as the host built it.", history: [], tool: null, lookupTools: [], maxRounds: null, taskKey: "jumpForward", staticPrefixEnd: null, sharedPrefixEnd: null, promptCacheKey: "", maxTokens: null };
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

test("this device carries the host's request to its own AI and sends back the answer, asking the host for a lookup on the way", async () => {
  const sent = [];
  const looked = [];
  const asked = [];
  const payer = createRoundPayer({
    ask: async (call, { execute, onRequest }) => {
      asked.push(call);
      onRequest(200);
      const region = await execute("look_up_region", { name: "Narva" });
      return { text: "", toolJson: JSON.stringify({ events: [{ title: `Talks at ${region.region}` }] }), asText: false };
    },
    answer: async (fields) => { sent.push(fields); return { ok: true, error: "" }; },
    lookup: async (fields) => { looked.push(fields); return { ok: true, error: "", result: { text: JSON.stringify({ region: "Narva" }) } }; },
  });
  payer.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  assert.equal(payer.get().status, "paying");
  // Sent again after a reconnect: the one under way answers it.
  payer.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  await flush();
  assert.equal(asked.length, 1);
  assert.deepEqual(looked, [{ job: "pay-2-1", name: "look_up_region", args: { name: "Narva" } }]);
  assert.deepEqual(sent, [{ job: "pay-2-1", answer: { text: "", toolJson: "{\"events\":[{\"title\":\"Talks at Narva\"}]}", asText: false }, statuses: [200] }], "with what its provider said, for the host's skip to read");
  assert.equal(payer.get(), null, "done: the round's events come in the next view");
});

test("a request this device cannot make is answered with why, a stop stops it, and a game whose host pays is answered no", async () => {
  const sent = [];
  const answer = async (fields) => { sent.push(fields); return { ok: true, error: "" }; };
  const failing = createRoundPayer({ ask: async (call, { onRequest }) => { onRequest(400); throw new Error("The provider refused the request."); }, answer, lookup: async () => ({ ok: false }) });
  failing.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  await flush();
  assert.deepEqual(sent.at(-1), { job: "pay-2-1", error: "The provider refused the request.", statuses: [400] });
  assert.deepEqual(failing.get(), { job: "pay-2-1", round: 2, status: "failed", error: "The provider refused the request." });

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
  assert.deepEqual(sent.at(-1), { job: "pay-4-1", error: "This game's host pays for its rounds." });
});

test("an answer this device cannot send still reaches the host as why", async () => {
  const sent = [];
  const payer = createRoundPayer({
    ask: async () => ({ text: "x", toolJson: "", asText: true }),
    answer: async (fields) => { sent.push(fields); return fields.answer ? { ok: false, error: "$.answer.text: longer than 1000000" } : { ok: true, error: "" }; },
    lookup: async () => ({ ok: false }),
  });
  payer.receive({ t: "pay", job: "pay-5-1", round: 5, call: CALL });
  await flush();
  assert.match(sent.at(-1).error, /this device's answer could not be sent \(\$\.answer\.text: longer than 1000000\)/);
});

test("the host's request and its stop reach the payer through the game's own client", () => {
  const paid = [];
  const client = createGameClient({ send: () => {}, onPay: (message) => paid.push(message.t) });
  client.receive({ t: "pay", job: "pay-2-1", round: 2, call: CALL });
  client.receive({ t: "payStop", job: "pay-2-1" });
  assert.deepEqual(paid, ["pay", "payStop"]);
  client.close();
});
