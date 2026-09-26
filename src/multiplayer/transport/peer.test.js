/*! Open Historia — WebRTC peer wrapper tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/transport/peer.test.js
//
// The wrapper against an in-memory RTCPeerConnection: offer, answer, a data
// channel that carries text both ways, fingerprints read from each side's SDP,
// large sends paced, and a lost connection reported once.

import test from "node:test";
import assert from "node:assert/strict";
import { createPeer, sdpFingerprint } from "./peer.js";
import { createFakeRtcNetwork } from "../testing/fakeRtc.js";

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const pair = async (network) => {
  const events = { player: [], host: [] };
  const player = createPeer({
    RTCPeerConnectionImpl: network.RTCPeerConnection,
    onOpen: () => events.player.push("open"),
    onMessage: (text) => events.player.push(text),
    onClose: (reason) => events.player.push(`closed:${reason}`),
  });
  const host = createPeer({
    RTCPeerConnectionImpl: network.RTCPeerConnection,
    onOpen: () => events.host.push("open"),
    onMessage: (text) => events.host.push(text),
    onClose: (reason) => events.host.push(`closed:${reason}`),
  });
  const offer = await player.createOffer();
  const answer = await host.answerOffer(offer);
  await player.acceptAnswer(answer);
  await settle();
  return { player, host, events };
};

test("an offer and an answer open a channel that carries text both ways", async () => {
  const { player, host, events } = await pair(createFakeRtcNetwork());
  assert.equal(player.open, true);
  assert.equal(host.open, true);
  assert.equal(player.send("hello host"), true);
  assert.equal(host.send("hello player"), true);
  await settle();
  assert.deepEqual(events.host, ["open", "hello host"]);
  assert.deepEqual(events.player, ["open", "hello player"]);
  const fromPlayer = player.fingerprints();
  const fromHost = host.fingerprints();
  assert.match(fromPlayer.local, /^sha-256 [0-9A-F:]+$/);
  assert.equal(fromPlayer.local, fromHost.remote);
  assert.equal(fromPlayer.remote, fromHost.local);
  assert.notEqual(fromPlayer.local, fromPlayer.remote);
});

test("a lost connection is reported once, and nothing is sent after it", async () => {
  const network = createFakeRtcNetwork();
  const { player, events } = await pair(network);
  network.drop();
  await settle();
  assert.equal(events.player.filter((entry) => entry.startsWith("closed")).length, 1);
  assert.equal(player.open, false);
  assert.equal(player.send("anyone?"), false);
  player.close();
  assert.equal(events.player.filter((entry) => entry.startsWith("closed")).length, 1);
});

test("a large send is paced by what the channel has buffered", async () => {
  const network = createFakeRtcNetwork();
  const { player, events } = await pair(network);
  const channel = [...network.connections.values()].find((connection) => connection.channel?.label === "oh" && connection.localDescription?.type === "offer").channel;
  channel.bufferedAmount = 5_000_000;
  let done = false;
  const sending = player.sendAll(["a", "b", "c"], { highWater: 1_000_000 }).then((result) => { done = result; });
  await settle(50);
  assert.equal(done, false, "held while the buffer is full");
  channel.bufferedAmount = 0;
  channel.onbufferedamountlow?.();
  await sending;
  await settle();
  assert.equal(done, true);
  assert.deepEqual(events.host.slice(1), ["a", "b", "c"]);
});

test("the fingerprint comes from the SDP's own line, or nothing", () => {
  assert.equal(sdpFingerprint("v=0\r\na=fingerprint:SHA-256 ab:cd\r\n"), "sha-256 AB:CD");
  assert.equal(sdpFingerprint("v=0\r\n"), "");
  assert.equal(sdpFingerprint(undefined), "");
});

test("a device without WebRTC gets a clear refusal", () => {
  assert.throws(() => createPeer({ RTCPeerConnectionImpl: undefined }), /cannot make WebRTC connections/);
});
