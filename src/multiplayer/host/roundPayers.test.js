/*! Open Historia — taking turns to pay for a shared game's rounds: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/roundPayers.test.js
//
// Whose turn it is to pay, and what happens to a request carried to the
// paying device: the next seat round the table of those who are here and whose
// device said it can pay; a turn taken by a round that did not land; the host
// paying a round for one whose turn it was without taking the turn; a request
// held to what may be sent; the engine's deadline put off only by the device's
// own word that its model is at work; a failure said in the host's words by
// its kind; a payer let go failing the round at once; and a stop told to the device.

import test from "node:test";
import assert from "node:assert/strict";

import { PAYER_GONE_MS, PAY_FAILURE_WORDS, createRoundPayers } from "./roundPayers.js";
import { CARRIED_PROMPT_MAX } from "../game/messages.js";
import { PAY_FAILURE_KINDS, carriedRequestOf } from "../../Game/AI/roundCarrier.js";

const fakeTimers = () => {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    setTimeout: (fn, ms) => { timers.set(next, { fn, ms }); return next++; },
    clearTimeout: (handle) => timers.delete(handle),
    fire: () => { for (const [handle, timer] of [...timers.entries()]) { timers.delete(handle); timer.fn(); } },
  };
};

const SEATS = [
  { country: "Republic of Latvia", device: "device-host", here: true },
  { country: "Russian Federation", device: "device-russia", here: true },
  { country: "Republic of Estonia", device: "device-estonia", here: true },
];
const CAN = { ready: true, noRequestLimit: false, lookups: true, segmented: false, declares: false };
const request = () => carriedRequestOf({ systemPrompt: "The world as the host built it.", history: [{ role: "user", parts: [{ text: "Go on." }] }] });
const able = (payers, ...devices) => devices.forEach((device) => payers.state(device, CAN));

test("each pays in turn round the table, of those who are here and whose device said it can pay; the host's own always can", () => {
  const payers = createRoundPayers({ timers: fakeTimers() });
  const turn = (seats = SEATS, round = 1) => payers.payerOf({ seats, host: "device-host", round })?.country;
  assert.equal(turn(), "Republic of Latvia", "the first round: the first seat");
  payers.landed(payers.payerOf({ seats: SEATS, host: "device-host", round: 1 }));
  // Nobody else has said it can pay: never asked, the host's own pays again.
  assert.equal(turn(), "Republic of Latvia", "a device that has not said it can pay is never asked");
  assert.equal(payers.canPay("device-russia", "device-host"), false);
  assert.equal(payers.canPay("device-host", "device-host"), true);
  // Russia's device says it can; Estonia's that it has no AI that can answer now.
  assert.equal(payers.state("device-russia", CAN), true, "a change");
  assert.equal(payers.state("device-russia", { ...CAN, t: "canPay", id: "x" }), false, "the same again is no change, and nothing else of the message is kept");
  payers.state("device-estonia", { ...CAN, ready: false });
  assert.equal(turn(), "Russian Federation");
  payers.landed(payers.payerOf({ seats: SEATS, host: "device-host", round: 2 }));
  assert.equal(turn(), "Republic of Latvia", "Estonia is passed over");
  payers.state("device-estonia", CAN);
  assert.equal(turn(), "Republic of Estonia", "set up, it takes its turn");
  // Estonia's player is away: the turn passes to the next who is here, and comes back round.
  const away = SEATS.map((seat) => (seat.device === "device-estonia" ? { ...seat, here: false } : seat));
  assert.equal(turn(away), "Republic of Latvia");
  assert.deepEqual(payers.profileOf("device-estonia"), CAN, "what it stated, for the round to be built under");
  assert.equal(payers.profileOf("device-nobody"), null);
  // A seat that was let go: the turn goes on from the start.
  const later = createRoundPayers({ lastPayer: "device-gone", timers: fakeTimers() });
  able(later, "device-russia");
  assert.equal(later.payerOf({ seats: SEATS, host: "device-host", round: 9 }).country, "Republic of Latvia");
  assert.equal(later.payerOf({ seats: SEATS.map((seat) => ({ ...seat, here: false })), host: "device-host", round: 9 }), null, "nobody here, nobody pays");
});

test("a round its payer was asked for takes the turn whether or not it lands; the host paying instead leaves the turn where it was", async () => {
  const sent = [];
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), timers: fakeTimers() });
  able(payers, "device-russia", "device-estonia");
  payers.landed(payers.payerOf({ seats: SEATS, host: "device-host", round: 1 }));
  const russia = { ...payers.payerOf({ seats: SEATS, host: "device-host", round: 2 }), round: 2 };
  assert.equal(russia.country, "Russian Federation");
  // Failed before anything was sent to its device: it paid nothing, and it is still its turn.
  payers.begin(russia);
  assert.equal(payers.missed(russia), false);
  payers.begin(null);
  assert.equal(payers.payerOf({ seats: SEATS, host: "device-host", round: 2 }).country, "Russian Federation");
  // Asked, and its device failed: the turn is taken, and the round run again is Estonia's.
  payers.begin(russia);
  const failing = payers.carry({ ...russia })(request(), {});
  payers.answered("device-russia", { job: sent.at(-1).message.job, failure: { kind: "spent" } });
  await assert.rejects(failing, /Russian Federation's device could not make the round's request: its AI has used its allowance\./);
  assert.equal(payers.missed(russia), true);
  payers.begin(null);
  assert.equal(payers.payerOf({ seats: SEATS, host: "device-host", round: 2 }).country, "Republic of Estonia");
  assert.equal(payers.record(), "device-russia", "kept with the session");
  // The host pays Estonia's round itself: the turn is still Estonia's after.
  payers.hostPays(2);
  const instead = payers.payerOf({ seats: SEATS, host: "device-host", round: 2 });
  assert.deepEqual(instead, { device: "device-host", country: "Republic of Latvia", instead: true });
  assert.equal(payers.payerOf({ seats: SEATS, host: "device-host", round: 3 }).country, "Republic of Estonia", "only the round the host took on");
  payers.begin({ ...instead, round: 2 });
  assert.equal(payers.missed(instead), false, "the host paying instead takes nobody's turn");
  payers.landed(instead);
  assert.equal(payers.payerOf({ seats: SEATS, host: "device-host", round: 3 }).country, "Republic of Estonia");
});

test("a request is held to what may be sent, the engine hears the device's own word that its model works, and a stop reaches the payer", async () => {
  const sent = [];
  const clock = fakeTimers();
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), timers: clock });
  const carry = payers.carry({ device: "device-russia", country: "Russian Federation", round: 2 });
  await assert.rejects(carry({ ...request(), systemPrompt: "x".repeat(CARRIED_PROMPT_MAX + 1) }, {}), /could not be sent to Russian Federation's device/);
  assert.equal(sent.length, 0);

  const heard = [];
  const stop = new AbortController();
  const waiting = carry(request(), { alive: (round) => heard.push(round), signal: stop.signal });
  const job = sent.at(-1).message.job;
  assert.equal(sent.at(-1).message.t, "pay");
  // Nothing keeps the engine's deadline at bay but the device itself: no timer runs while it is connected.
  assert.equal(clock.timers.size, 0);
  assert.equal(payers.alive("device-russia", { job, round: 0 }), true);
  assert.equal(payers.alive("device-russia", { job, round: 2 }), true);
  assert.deepEqual(heard, [0, 2], "an answer arriving, and a lookup round begun");
  assert.equal(payers.alive("device-estonia", { job, round: 1 }), false, "only the device it was sent to");
  // Stopped: the device is told, and the round's request ends with why.
  stop.abort(new Error("The host cancelled the round."));
  await assert.rejects(waiting, /The host cancelled the round\./);
  assert.deepEqual(sent.at(-1), { device: "device-russia", message: { t: "payStop", job } });
  assert.equal(clock.timers.size, 0, "nothing left running");
  // A lookup or an answer for it is not waited for any more.
  assert.match(payers.answered("device-russia", { job, answer: { text: "Late.", toolJson: "", asText: true } }), /not waiting/);
  assert.match(await payers.lookup("device-russia", { job, name: "look_up_region", args: {} }), /not waiting/);
  assert.equal(payers.alive("device-russia", { job }), false);
});

test("an answer comes back whole; one that does not read fails the round with why; a failure is said in the host's words by its kind", async () => {
  const sent = [];
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), timers: fakeTimers() });
  const carry = payers.carry({ device: "device-russia", country: "Russian Federation", round: 2 });
  const heard = [];
  const whole = carry(request(), { onRequest: (status) => heard.push(status) });
  assert.equal(payers.answered("device-russia", {
    job: sent.at(-1).message.job,
    answer: { text: "", toolJson: "{\"events\":[]}", asText: false, reasoning: "First the war.", cut: true, outputOnly: true },
    statuses: [200],
  }), "");
  assert.deepEqual(await whole, { text: "", toolInput: { events: [] }, asText: false, reasoning: "First the war.", cut: true, outputOnly: true }, "the whole of it: the engine reads each part (roundCarrier.js)");
  assert.deepEqual(heard, [200]);

  const broken = carry(request(), { onRequest: (status) => heard.push(status) });
  assert.equal(payers.answered("device-russia", { job: sent.at(-1).message.job, answer: { text: "", toolJson: "{not json", asText: false }, statuses: [503, 200] }), "That answer does not read.");
  await assert.rejects(broken, /Russian Federation's device sent an answer that does not read/);
  assert.deepEqual(heard, [200, 503, 200], "what its provider said, in order, as the engine hears its own");
  // Every kind has the host's own words; the device's are never what everyone is told.
  for (const kind of PAY_FAILURE_KINDS) assert.match(PAY_FAILURE_WORDS[kind]("Russian Federation"), /^Russian Federation's device could not (?:make|send)/, kind);
  const refused = carry(request(), {});
  payers.answered("device-russia", { job: sent.at(-1).message.job, failure: { kind: "refused", busy: true }, statuses: [200] });
  const error = await refused.catch((failure) => failure);
  assert.equal(error.message, "Russian Federation's device could not make the round's request: its AI refused it.");
  assert.deepEqual(error.payFailure, { kind: "refused", busy: true }, "the kind, for the engine to ask again as it would its own");
  const odd = carry(request(), {});
  payers.answered("device-russia", { job: sent.at(-1).message.job, failure: { kind: "sk-live-12345" } });
  assert.equal((await odd.catch((failure) => failure)).payFailure.kind, "other", "a kind the host does not know is no word of the device's");
});

test("a lookup is answered by the engine's own hook with its round, only for the device it was sent to", async () => {
  const sent = [];
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), timers: fakeTimers() });
  const carry = payers.carry({ device: "device-russia", country: "Russian Federation", round: 2 });
  const asked = [];
  const looking = carry(request(), { execute: async (name, args, round) => { asked.push({ name, args, round }); return { region: "Narva" }; } });
  const job = sent.at(-1).message.job;
  assert.deepEqual(await payers.lookup("device-russia", { job, name: "look_up_region", args: { name: "Narva" }, round: 2 }), { error: "", result: { text: JSON.stringify({ region: "Narva" }) } });
  assert.deepEqual(asked, [{ name: "look_up_region", args: { name: "Narva" }, round: 2 }]);
  assert.match(await payers.lookup("device-estonia", { job, name: "x", args: {} }), /not waiting for an answer from your device/, "only the device it was sent to");
  const plain = carry(request(), {});
  assert.equal(await payers.lookup("device-russia", { job: sent.at(-1).message.job, name: "x", args: {} }), "That request looks nothing up.");
  payers.stop();
  await assert.rejects(looking, /The shared game was stopped\./);
  await assert.rejects(plain, /The shared game was stopped\./);
  assert.equal(sent.at(-1).message.t, "payStop");
});

test("a payer whose connection drops is waited for, one the host lets go of fails the round at once", async () => {
  const sent = [];
  const clock = fakeTimers();
  let here = true;
  const payers = createRoundPayers({ send: (device, message) => sent.push({ device, message }), connected: () => here, timers: clock });
  able(payers, "device-russia");
  const carry = payers.carry({ device: "device-russia", country: "Russian Federation", round: 2 });
  const gone = carry(request(), {});
  here = false;
  payers.left("device-russia");
  assert.equal([...clock.timers.values()][0].ms, PAYER_GONE_MS);
  clock.fire();
  await assert.rejects(gone, /left before it made the round's request/);
  // Released while it pays: told to stop, and the round fails now, not never.
  here = true;
  const released = carry(request(), {});
  const job = sent.at(-1).message.job;
  payers.released("device-russia");
  await assert.rejects(released, /Russian Federation's player was let go before their device made the round's request\./);
  assert.deepEqual(sent.at(-1), { device: "device-russia", message: { t: "payStop", job } });
  // What its device said of paying is the device's, not the seat's: seated again, it takes its turn.
  assert.equal(payers.canPay("device-russia", "device-host"), true);
});
