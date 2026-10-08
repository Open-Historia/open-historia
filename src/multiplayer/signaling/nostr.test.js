/*! Open Historia — Nostr signaling tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/signaling/nostr.test.js
//
// The channel the host and its joiners find each other on, driven against
// in-memory relays that check events the way real ones do. Only holders of the
// room's key can be heard; a relay that tampers, floods or talks nonsense is
// ignored; one relay down changes nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { createNostrChannel, SIGNAL_KIND } from "./nostr.js";
import { createFakeRelayNetwork, settle } from "../testing/fakeRelays.js";
import { randomBytes, toHex } from "../bytes.js";

const RELAYS = ["wss://one.test", "wss://two.test", "wss://three.test"];
const room = () => ({ topic: toHex(randomBytes(16)), key: randomBytes(32) });

const channel = (network, { topic, key }, extra = {}) => {
  const received = [];
  const instance = createNostrChannel({
    topic, key, relays: RELAYS, WebSocketImpl: network.WebSocket,
    onPayload: (payload) => received.push(payload), ...extra,
  });
  return { instance, received };
};

test("two devices on the room's key hear each other, once each, and never their own echo", async () => {
  const network = createFakeRelayNetwork();
  const keys = room();
  const host = channel(network, keys);
  const joiner = channel(network, keys);
  await settle();
  assert.deepEqual(host.instance.status(), { connected: 3, total: 3 });
  assert.equal(joiner.instance.publish({ t: "offer", n: 1 }), 3);
  host.instance.publish({ t: "beacon" });
  await settle();
  assert.deepEqual(host.received, [{ t: "offer", n: 1 }], "delivered by three relays, heard once");
  assert.deepEqual(joiner.received, [{ t: "beacon" }]);
  host.instance.close();
  joiner.instance.close();
});

test("the relays accept what we publish: ids and signatures are what NIP-01 says", async () => {
  const network = createFakeRelayNetwork({ verify: true });
  const keys = room();
  const logs = [];
  const sender = channel(network, keys, { log: (line) => logs.push(line) });
  await settle();
  sender.instance.publish({ t: "hello" });
  await settle();
  const stored = network.relays.get(RELAYS[0]).events;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].kind, SIGNAL_KIND);
  assert.deepEqual(stored[0].tags, [["x", keys.topic]]);
  assert.equal(logs.filter((line) => /refused/.test(line)).length, 0, logs.join("\n"));
  sender.instance.close();
});

test("another room's key, or another room's topic, is never heard", async () => {
  const network = createFakeRelayNetwork();
  const keys = room();
  const listener = channel(network, keys);
  const wrongKey = channel(network, { topic: keys.topic, key: randomBytes(32) });
  const otherRoom = channel(network, room());
  await settle();
  wrongKey.instance.publish({ t: "offer", from: "intruder" });
  otherRoom.instance.publish({ t: "offer", from: "elsewhere" });
  await settle();
  assert.deepEqual(listener.received, []);
  for (const entry of [listener, wrongKey, otherRoom]) entry.instance.close();
});

test("a relay that tampers with an event, or talks nonsense, is ignored", async () => {
  const network = createFakeRelayNetwork();
  const keys = room();
  const listener = channel(network, keys);
  const sender = channel(network, keys);
  await settle();
  // Every relay rewrites what it passes on: a new time, or a new body.
  network.tamper(RELAYS[0], (event) => ({ ...event, created_at: event.created_at + 5 }));
  network.tamper(RELAYS[1], (event) => ({ ...event, content: `${event.content.slice(0, -4)}AAAA` }));
  network.tamper(RELAYS[2], (event) => ({ ...event, tags: [["x", keys.topic], ["p", "extra"]] }));
  sender.instance.publish({ t: "offer" });
  for (const frame of ["not json", "[]", '["EVENT"]', '["EVENT","x",{}]', JSON.stringify(["EVENT", "sub", { __proto__: { kind: SIGNAL_KIND } }]), "[".repeat(100)]) {
    network.inject(RELAYS[0], frame);
  }
  await settle();
  assert.deepEqual(listener.received, []);
  listener.instance.close();
  sender.instance.close();
});

test("one relay down changes nothing; a relay that comes back is used again", async () => {
  const network = createFakeRelayNetwork();
  const keys = room();
  network.down(RELAYS[0]);
  network.down(RELAYS[1]);
  const listener = channel(network, keys);
  const sender = channel(network, keys);
  await settle();
  assert.equal(listener.instance.status().connected, 1);
  sender.instance.publish({ t: "offer", n: 1 });
  await settle();
  assert.deepEqual(listener.received, [{ t: "offer", n: 1 }]);
  network.up(RELAYS[0]);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(listener.instance.status().connected, 2);
  listener.instance.close();
  sender.instance.close();
});

test("a flood is cut to the per-second limit before anything costly is done", async () => {
  const network = createFakeRelayNetwork();
  const keys = room();
  let clock = 1_000_000;
  const listener = channel(network, keys, { maxEventsPerSecond: 10, now: () => clock });
  const flooder = channel(network, keys, { relays: [RELAYS[0]], now: () => clock });
  await settle();
  for (let n = 0; n < 50; n += 1) flooder.instance.publish({ t: "offer", n });
  await settle(80);
  assert.equal(listener.received.length, 10);
  clock += 1000;
  flooder.instance.publish({ t: "offer", n: 99 });
  await settle();
  assert.equal(listener.received.at(-1).n, 99);
  listener.instance.close();
  flooder.instance.close();
});

test("closing stops everything", async () => {
  const network = createFakeRelayNetwork();
  const keys = room();
  const listener = channel(network, keys);
  const sender = channel(network, keys);
  await settle();
  listener.instance.close();
  sender.instance.publish({ t: "late" });
  await settle();
  assert.deepEqual(listener.received, []);
  assert.equal(listener.instance.publish({ t: "x" }), 0);
  sender.instance.close();
});

test("a malformed topic or key is refused up front", () => {
  const network = createFakeRelayNetwork();
  assert.throws(() => createNostrChannel({ topic: "nope", key: randomBytes(32), WebSocketImpl: network.WebSocket }), /topic/);
  assert.throws(() => createNostrChannel({ topic: toHex(randomBytes(16)), key: randomBytes(8), WebSocketImpl: network.WebSocket }), /key/);
});

test("a listener whose clock is ahead still hears a sender whose clock is behind", async () => {
  // A relay holds a subscription's "since" against the SENDER's clock. With a
  // reach of thirty seconds, a joiner a minute ahead of the host heard nothing
  // from it for the first half minute, and a joiner further ahead never did.
  const network = createFakeRelayNetwork();
  const keys = room();
  const host = channel(network, keys);
  const joiner = channel(network, keys, { now: () => Date.now() + 120_000 });
  await settle();
  host.instance.publish({ t: "beacon" });
  joiner.instance.publish({ t: "offer" });
  await settle();
  assert.deepEqual(joiner.received, [{ t: "beacon" }]);
  assert.deepEqual(host.received, [{ t: "offer" }]);
  host.instance.close();
  joiner.instance.close();
});

test("one event passed on by every relay counts once against the burst limit", async () => {
  // A lobby filling at once is many offers in a second, each from every relay:
  // counted per copy, the host's answer was crowded out by copies of offers.
  const network = createFakeRelayNetwork();
  const keys = room();
  const at = Date.now();
  const host = channel(network, keys, { maxEventsPerSecond: 4, now: () => at });
  const joiner = channel(network, keys);
  await settle();
  for (let n = 0; n < 4; n += 1) joiner.instance.publish({ t: "offer", n });
  await settle(60);
  assert.deepEqual(host.received.map((payload) => payload.n).sort(), [0, 1, 2, 3], "four events from three relays are four, not twelve");
  host.instance.close();
  joiner.instance.close();
});
