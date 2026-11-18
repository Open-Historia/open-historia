/*! Open Historia — taking turns to pay for a shared game's rounds: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/roundPayers.test.js
//
// Whose turn it is to pay, and what happens to a request carried to the
// paying device: the next seat round the table of those who are here; the host
// paying a round for one whose turn it was without taking the turn; a request
// held to what may be sent; the engine kept from taking a paying device's
// silence for a model that stopped; and a stop told to the device.

import test from "node:test";
import assert from "node:assert/strict";

import { PAY_KEEPALIVE_MS, createRoundPayers } from "./roundPayers.js";
import { CARRIED_PROMPT_MAX } from "../game/messages.js";
import { carriedRequestOf } from "../../Game/AI/roundCarrier.js";

const fakeTimers = () => {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    setTimeout: (fn, ms) => { timers.set(next, { fn, ms, every: false }); return next++; },
    clearTimeout: (handle) => timers.delete(handle),
    setInterval: (fn, ms) => { timers.set(next, { fn, ms, every: true }); return next++; },
    clearInterval: (handle) => timers.delete(handle),
    fire: (every) => { for (const timer of [...timers.values()]) if (timer.every === every) timer.fn(); },
  };
};

const SEATS = [
  { country: "Republic of Latvia", device: "device-host", here: true },
  { country: "Russian Federation", device: "device-russia", here: true },
  { country: "Republic of Estonia", device: "device-estonia", here: true },
];
const request = () => carriedRequestOf({ systemPrompt: "The world as the host built it.", history: [{ role: "user", parts: [{ text: "Go on." }] }] });

test("each pays in turn round the table, of those who are here, and the host paying for one whose turn it was leaves it theirs", () => {
  const payers = createRoundPayers({ timers: fakeTimers() });
  const turn = (seats = SEATS, round = 1) => payers.payerOf({ seats, host: "device-host", round })?.country;
  assert.equal(turn(), "Republic of Latvia", "the first round: the first seat");
  payers.landed(payers.payerOf({ seats: SEATS, host: "device-host", round: 1 }));
  assert.equal(turn(), "Russian Federation");
  payers.landed(payers.payerOf({ seats: SEATS, host: "device-host", round: 2 }));
  // Estonia's player is away: the turn passes to the next who is here, and comes back round.
  const away = SEATS.map((seat) => (seat.device === "device-estonia" ? { ...seat, here: false } : seat));
  assert.equal(turn(away), "Republic of Latvia");
  assert.equal(turn(), "Republic of Estonia", "back, it is theirs, owing nothing for the rounds away");
  // The host pays Estonia's round itself: the turn is still Estonia's after.
  payers.hostPays(3);
  const instead = payers.payerOf({ seats: SEATS, host: "device-host", round: 3 });
  assert.deepEqual(instead, { device: "device-host", country: "Republic of Latvia", instead: true });
  assert.equal(turn(SEATS, 4), "Republic of Estonia", "only the round the host took on");
  payers.landed(instead);
  assert.equal(turn(SEATS, 3), "Republic of Estonia");
  // A seat that was let go: the turn goes on from the start.
  const record = payers.record();
  assert.equal(record, "device-russia");
  const later = createRoundPayers({ lastPayer: "device-gone", timers: fakeTimers() });
  assert.equal(later.payerOf({ seats: SEATS, host: "device-host", round: 9 }).country, "Republic of Latvia");
  assert.equal(later.payerOf({ seats: SEATS.map((seat) => ({ ...seat, here: false })), host: "device-host", round: 9 }), null, "nobody here, nobody pays");
});

test("a request is held to what may be sent, the engine is told the payer is still there, and a stop reaches the payer", async () => {
  const sent = [];
  const clock = fakeTimers();
  let here = true;
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), connected: () => here, timers: clock });
  const carry = payers.carry({ device: "device-russia", country: "Russian Federation", round: 2 });
  await assert.rejects(carry({ ...request(), systemPrompt: "x".repeat(CARRIED_PROMPT_MAX + 1) }, {}), /could not be sent to Russian Federation's device/);
  assert.equal(sent.length, 0);

  let woke = 0;
  const stop = new AbortController();
  const waiting = carry(request(), { onActivity: () => { woke += 1; }, signal: stop.signal });
  assert.equal(sent.at(-1).message.t, "pay");
  assert.ok(clock.timers.size > 0);
  // The engine's deadline counts silence: while the payer is here, it is told every so often.
  assert.equal([...clock.timers.values()].find((timer) => timer.every).ms, PAY_KEEPALIVE_MS);
  clock.fire(true);
  assert.equal(woke, 1);
  here = false;
  clock.fire(true);
  assert.equal(woke, 1, "not for a payer that is gone");
  // Stopped: the device is told, and the round's request ends with why.
  stop.abort(new Error("The host cancelled the round."));
  await assert.rejects(waiting, /The host cancelled the round\./);
  assert.deepEqual(sent.at(-1), { device: "device-russia", message: { t: "payStop", job: sent.find((entry) => entry.message.t === "pay").message.job } });
  assert.equal(clock.timers.size, 0, "nothing left running");
  // A lookup or an answer for it is not waited for any more.
  assert.match(payers.answered("device-russia", { job: sent.at(-1).message.job, answer: { text: "Late.", toolJson: "", asText: true } }), /not waiting/);
  assert.match(await payers.lookup("device-russia", { job: sent.at(-1).message.job, name: "look_up_region", args: {} }), /not waiting/);
});

test("an answer that does not read fails the round with why, and a lookup's failure is the model's to read", async () => {
  const sent = [];
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), timers: fakeTimers() });
  const carry = payers.carry({ device: "device-russia", country: "Russian Federation", round: 2 });
  const heard = [];
  const broken = carry(request(), { onRequest: (status) => heard.push(status) });
  const job = sent.at(-1).message.job;
  assert.equal(payers.answered("device-russia", { job, answer: { text: "", toolJson: "{not json", asText: false }, statuses: [503, 200] }), "That answer does not read.");
  await assert.rejects(broken, /Russian Federation's device sent an answer that does not read/);
  assert.deepEqual(heard, [503, 200], "what its provider said, in order, as the engine hears its own");
  // A refusal too: the skip reads it, and asks the old way where the provider refused its contract.
  const refused = carry(request(), { onRequest: (status) => heard.push(status) });
  assert.equal(payers.answered("device-russia", { job: sent.at(-1).message.job, error: "The provider refused the request.", statuses: [400] }), "");
  await assert.rejects(refused, /could not make the round's request: The provider refused the request\./);
  assert.equal(heard.at(-1), 400);

  const looking = carry(request(), { execute: async (name) => { throw new Error(`No region called ${name}.`); } });
  const second = sent.at(-1).message.job;
  assert.deepEqual(await payers.lookup("device-russia", { job: second, name: "Atlantis", args: [] }), { error: "", result: { text: JSON.stringify({ error: "No region called Atlantis." }) } });
  assert.match(await payers.lookup("device-estonia", { job: second, name: "Atlantis", args: {} }), /not waiting for an answer from your device/, "only the device it was sent to");
  payers.stop();
  await assert.rejects(looking, /The shared game was stopped\./);
  assert.equal(sent.at(-1).message.t, "payStop");
});
