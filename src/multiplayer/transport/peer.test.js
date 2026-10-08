/*! Open Historia — WebRTC peer wrapper tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/transport/peer.test.js
//
// The wrapper against an in-memory RTCPeerConnection: offer, answer, a data
// channel that carries text both ways, fingerprints read from each side's SDP,
// large sends paced, and a lost connection reported once.

import test from "node:test";
import assert from "node:assert/strict";
import { classifyCandidates, createPeer, probeNetwork, sdpFingerprint } from "./peer.js";
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

// --- What a device's own candidates say of its network ------------------------------

const cand = (type, address, port, extra = "") => `candidate:1 1 udp 2122260223 ${address} ${port} typ ${type}${extra ? ` ${extra}` : ""} generation 0`;

test("one public address for one local port is a network others can connect to", () => {
  assert.equal(classifyCandidates([
    cand("host", "192.168.1.20", 50000),
    cand("srflx", "203.0.113.7", 61000, "raddr 192.168.1.20 rport 50000"),
  ]), "open");
  // Two network cards behind the same router: two local ports, one public
  // port each. Still open.
  assert.equal(classifyCandidates([
    cand("host", "192.168.1.20", 50000),
    cand("host", "192.168.1.21", 50001),
    cand("srflx", "203.0.113.7", 61000, "raddr 192.168.1.20 rport 50000"),
    cand("srflx", "203.0.113.7", 61001, "raddr 192.168.1.21 rport 50001"),
  ]), "open");
});

test("two public ports for one local port is a network that cannot be connected to", () => {
  assert.equal(classifyCandidates([
    cand("host", "10.0.0.5", 50000),
    cand("srflx", "198.51.100.9", 1024, "raddr 10.0.0.5 rport 50000"),
    cand("srflx", "198.51.100.9", 1025, "raddr 10.0.0.5 rport 50000"),
  ]), "symmetric");
  // The browser hiding the local address (an .local name, and no raddr): more
  // public candidates than local ones to have come from.
  assert.equal(classifyCandidates([
    cand("host", "0f2b7d3e-1a2b-4c3d-9e8f-123456789abc.local", 50000),
    cand("srflx", "198.51.100.9", 1024, "raddr 0.0.0.0 rport 0"),
    cand("srflx", "198.51.100.9", 1025, "raddr 0.0.0.0 rport 0"),
  ]), "symmetric");
  // And never by guesswork: hidden local ports, and no more public than local.
  assert.equal(classifyCandidates([
    cand("host", "aaaa.local", 50000),
    cand("host", "bbbb.local", 50001),
    cand("srflx", "198.51.100.9", 1024, "raddr 0.0.0.0 rport 0"),
    cand("srflx", "198.51.100.9", 1025, "raddr 0.0.0.0 rport 0"),
  ]), "open");
});

test("no public address at all is a blocked network; nothing gathered is unknown", () => {
  assert.equal(classifyCandidates([cand("host", "192.168.1.20", 50000)]), "blocked");
  assert.equal(classifyCandidates([]), "unknown");
  assert.equal(classifyCandidates(["not a candidate", null]), "unknown");
  // TCP candidates and the second component say nothing about UDP mappings.
  assert.equal(classifyCandidates(["candidate:1 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active"]), "unknown");
});

test("the probe gathers this device's candidates and closes its connection", async () => {
  const made = [];
  class Gathering {
    constructor(config) {
      this.config = config;
      this.closed = false;
      made.push(this);
    }

    createDataChannel() {
      return {};
    }

    async createOffer() {
      return { type: "offer", sdp: "v=0" };
    }

    async setLocalDescription() {
      setTimeout(() => {
        this.onicecandidate?.({ candidate: { candidate: cand("host", "192.168.1.20", 50000) } });
        this.onicecandidate?.({ candidate: { candidate: cand("srflx", "203.0.113.7", 61000, "raddr 192.168.1.20 rport 50000") } });
        this.onicecandidate?.({ candidate: null });
      }, 5);
    }

    close() {
      this.closed = true;
    }
  }
  assert.equal(await probeNetwork({ RTCPeerConnectionImpl: Gathering, timeoutMs: 2000 }), "open");
  assert.equal(made.length, 1);
  assert.equal(made[0].closed, true);
  assert.ok(made[0].config.iceServers.length > 0);
  // A browser that never finishes gathering is not waited on for ever, and a
  // device without WebRTC is simply not known.
  class Stalled extends Gathering {
    async setLocalDescription() {
      setTimeout(() => this.onicecandidate?.({ candidate: { candidate: cand("host", "192.168.1.20", 50000) } }), 5);
    }
  }
  assert.equal(await probeNetwork({ RTCPeerConnectionImpl: Stalled, timeoutMs: 60 }), "blocked");
  assert.equal(await probeNetwork({ RTCPeerConnectionImpl: undefined }), "unknown");
});
