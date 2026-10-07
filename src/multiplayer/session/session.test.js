/*! Open Historia — hosting and joining with one invite token © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/session/session.test.js
//
// The whole wire, host and players, over in-memory relays and an in-memory
// WebRTC: one token lets many players in, up to the seats; someone else holding
// the token cannot pose as the host; a player who drops comes back as the same
// player; the host can remove and ban, and make a new token that shuts the old
// one out without touching anyone already in.

import test from "node:test";
import assert from "node:assert/strict";
import { createHostSession } from "./host.js";
import { createClientSession } from "./client.js";
import { createIdentity } from "../identity.js";
import { createInvite, parseInvite } from "../invite.js";
import { createNostrChannel } from "../signaling/nostr.js";
import { createFakeRelayNetwork } from "../testing/fakeRelays.js";
import { createFakeRtcNetwork } from "../testing/fakeRtc.js";
import { createPeer } from "../transport/peer.js";
import { literal, obj, str } from "../protocol/validate.js";

const RELAYS = ["wss://one.test", "wss://two.test"];
const VERSION = "0.0.51-alpha";
const appMessages = {
  chat: obj({ t: literal("chat"), text: str(200) }),
  blob: obj({ t: literal("blob"), data: str(3_000_000) }),
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// These run on the real clock (the handshake's own timers do), and a machine
// busy with something else can take seconds over what is otherwise instant: a
// wait ends as soon as its condition holds, so a long limit costs nothing
// until something is wrong.
const until = async (check, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await wait(10);
  }
  return check();
};

// Every session a test opens is closed when the test ends, passed or failed: a
// host or a player left running keeps its timers, and the file then never exits.
const opened = [];
const track = (session) => {
  opened.push(session);
  return session;
};
test.afterEach(() => {
  for (const session of opened.splice(0)) {
    try {
      if (typeof session.stop === "function") session.stop();
      else session.leave();
    } catch {
      // already closed
    }
  }
});

const world = ({ seats = 4, hostLimits = {} } = {}) => {
  const relays = createFakeRelayNetwork();
  const rtc = createFakeRtcNetwork();
  const channelFactory = (options) => createNostrChannel({ ...options, relays: RELAYS, WebSocketImpl: relays.WebSocket });
  const peerFactory = (options) => createPeer({ ...options, RTCPeerConnectionImpl: rtc.RTCPeerConnection });
  const hostKey = createIdentity();
  const invite = createInvite(hostKey.publicKey);
  const events = { joins: [], leaves: [], messages: [] };
  const host = track(createHostSession({
    invite: parseInvite(invite.token), host: hostKey, room: { name: "The Cold War", seats, version: VERSION },
    appMessages, channelFactory, peerFactory,
    onJoin: (player, detail) => events.joins.push({ ...player, ...detail }),
    onLeave: (player, reason) => events.leaves.push({ ...player, reason }),
    onMessage: (player, message) => events.messages.push({ from: player.name, message }),
    limits: { beaconIntervalMs: 200, pingIntervalMs: 100_000, ...hostLimits },
  }));
  const join = (name, { token = invite.token, device = createIdentity(), version = VERSION, ...extra } = {}) => {
    const log = { states: [], messages: [], room: null };
    const client = track(createClientSession({
      token, device, name, version, appMessages, channelFactory, peerFactory,
      offerIntervalMs: 100, findTimeoutMs: 40_000, joinTimeoutMs: 20_000,
      onState: (state, detail) => log.states.push({ state, ...detail }),
      onRoom: (room) => { log.room = room; },
      onMessage: (message) => log.messages.push(message),
      ...extra,
    }));
    client.connect();
    return { client, log, device };
  };
  return { relays, rtc, host, hostKey, invite, events, join, channelFactory, peerFactory };
};

test("one token lets several players in, and messages flow both ways", async () => {
  const setup = world({ seats: 4 });
  setup.host.start();
  const players = ["Ana", "Ben", "Cleo"].map((name) => setup.join(name));
  assert.ok(await until(() => players.every(({ client }) => client.state === "connected")), JSON.stringify(players.map(({ log }) => log.states.map((s) => s.state))));
  assert.deepEqual(setup.host.players().map((player) => player.name).sort(), ["Ana", "Ben", "Cleo"]);
  assert.equal(new Set(players.map(({ client }) => client.player)).size, 3);
  assert.equal(players[0].log.room.name, "The Cold War");

  players[1].client.send({ t: "chat", text: "Hello from Ben" });
  await until(() => setup.events.messages.length === 1);
  assert.deepEqual(setup.events.messages, [{ from: "Ben", message: { t: "chat", text: "Hello from Ben" } }]);

  assert.equal(setup.host.broadcast({ t: "chat", text: "Round 1 begins" }), 3);
  assert.ok(await until(() => players.every(({ log }) => log.messages.length === 1)));
  setup.host.stop();
});

test("the seats are a limit: the next player is told the game is full", async () => {
  const setup = world({ seats: 2 });
  setup.host.start();
  const first = setup.join("Ana");
  const second = setup.join("Ben");
  assert.ok(await until(() => first.client.state === "connected" && second.client.state === "connected"));
  const third = setup.join("Cleo");
  assert.ok(await until(() => third.client.state === "rejected"));
  assert.equal(third.log.states.at(-1).reason, "full");
  setup.host.stop();
});

test("someone else holding the token cannot answer as the host", async () => {
  const setup = world();
  // An impostor with the same token, but not the host's key: its answers are
  // signed with the wrong key, and the player never takes them.
  const impostorKey = createIdentity();
  const forged = { ...parseInvite(setup.invite.token), hostKey: impostorKey.id };
  const impostor = track(createHostSession({
    invite: forged, host: impostorKey, room: { name: "Totally the host", seats: 8, version: VERSION },
    appMessages, channelFactory: setup.channelFactory, peerFactory: setup.peerFactory,
    limits: { beaconIntervalMs: 200 },
  }));
  impostor.start();
  const player = setup.join("Ana");
  await wait(600);
  assert.notEqual(player.client.state, "connected");
  assert.equal(impostor.players().length, 0);
  assert.equal(player.log.room, null, "the impostor's beacon is not believed");
  // The real host shows up, and the player joins it.
  setup.host.start();
  assert.ok(await until(() => player.client.state === "connected"));
  assert.equal(setup.host.players().length, 1);
  assert.equal(player.log.room.name, "The Cold War");
  impostor.stop();
  setup.host.stop();
});

test("a hello that is not the device's own is refused", async () => {
  const setup = world();
  setup.host.start();
  // A client that claims one device key in its offer and signs with another.
  const claimed = createIdentity();
  const actual = createIdentity();
  const liar = setup.join("Mallory", { device: { id: claimed.id, sign: actual.sign, publicKey: claimed.publicKey } });
  assert.ok(await until(() => liar.client.state === "rejected"));
  assert.equal(liar.log.states.at(-1).reason, "bad-hello");
  assert.equal(setup.host.players().length, 0);
  setup.host.stop();
});

test("a malformed message is dropped with a strike, and enough strikes remove the player", async () => {
  const setup = world({ hostLimits: { strikesToRemove: 3 } });
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  for (const bad of [{ t: "chat", text: 5 }, { t: "chat", text: "x", admin: true }, { t: "shutdown" }]) player.client.send(bad);
  assert.ok(await until(() => player.client.state === "rejected"));
  assert.equal(player.log.states.at(-1).reason, "misbehaving");
  assert.equal(setup.events.messages.length, 0);
  assert.equal(setup.events.leaves.at(-1).reason, "misbehaving");
  setup.host.stop();
});

test("a flood is cut by the rate limit and the flooder removed", async () => {
  const setup = world({ hostLimits: { messagesPerSecond: 5, messageBurst: 10, strikesToRemove: 5 } });
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  for (let n = 0; n < 40; n += 1) player.client.send({ t: "chat", text: `spam ${n}` });
  assert.ok(await until(() => player.client.state === "rejected"));
  assert.ok(setup.events.messages.length <= 11, `${setup.events.messages.length} got through`);
  setup.host.stop();
});

test("a player whose connection drops comes back as the same player", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  const id = player.client.player;
  setup.rtc.drop();
  assert.ok(await until(() => setup.events.leaves.length === 1));
  assert.equal(setup.host.players()[0].status, "away");
  assert.ok(await until(() => player.client.state === "connected" && setup.events.joins.length === 2, 5000));
  assert.equal(player.client.player, id);
  assert.equal(setup.events.joins.at(-1).resumed, true);
  assert.equal(setup.host.players().length, 1);
  setup.host.stop();
});

test("a removed and banned player cannot come back; a kicked one can", async () => {
  const setup = world();
  setup.host.start();
  const banned = setup.join("Mallory");
  const kicked = setup.join("Ben");
  assert.ok(await until(() => banned.client.state === "connected" && kicked.client.state === "connected"));
  setup.host.kick(banned.client.player, { ban: true });
  setup.host.kick(kicked.client.player);
  assert.ok(await until(() => banned.client.state === "rejected" && kicked.client.state === "rejected"));
  assert.equal(banned.log.states.at(-1).reason, "banned");
  assert.equal(kicked.log.states.at(-1).reason, "kicked");
  const again = setup.join("Mallory", { device: banned.device });
  assert.ok(await until(() => again.client.state === "rejected"));
  assert.equal(again.log.states.at(-1).reason, "banned");
  const back = setup.join("Ben", { device: kicked.device });
  assert.ok(await until(() => back.client.state === "connected"));
  setup.host.stop();
});

test("a new token shuts the old one out, and everyone already in stays", async () => {
  const setup = world();
  setup.host.start();
  const inside = setup.join("Ana");
  assert.ok(await until(() => inside.client.state === "connected"));
  const fresh = createInvite(setup.hostKey.publicKey);
  setup.host.rotate(parseInvite(fresh.token));
  const late = setup.join("Ben", { token: setup.invite.token });
  const invited = setup.join("Cleo", { token: fresh.token });
  assert.ok(await until(() => invited.client.state === "connected"));
  await wait(400);
  assert.notEqual(late.client.state, "connected");
  assert.equal(inside.client.state, "connected");
  assert.deepEqual(setup.host.players().map((player) => player.name).sort(), ["Ana", "Cleo"]);
  late.client.leave();
  setup.host.stop();
});

test("another version of the game is turned away before it connects", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Ana", { version: "0.0.49-alpha" });
  assert.ok(await until(() => player.client.state === "rejected"));
  assert.equal(player.log.states.at(-1).reason, "version");
  setup.host.stop();
});

test("a bad token is caught before anything is tried", async () => {
  const setup = world();
  const player = setup.join("Ana", { token: "oh1-not-a-token" });
  assert.equal(player.client.state, "invalid");
  assert.match(player.log.states.at(-1).message, /wrong length|characters/);
});

test("a large message arrives whole, both ways", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  const data = "map ".repeat(500_000);
  setup.host.send(player.client.player, { t: "blob", data });
  assert.ok(await until(() => player.log.messages.length === 1, 5000));
  assert.equal(player.log.messages[0].data.length, data.length);
  // From a player, anything up to the host's limit for one (a Projects board
  // at its fullest is the largest thing a player sends).
  player.client.send({ t: "blob", data: "orders ".repeat(50_000) });
  assert.ok(await until(() => setup.events.messages.length === 1, 5000));
  assert.equal(setup.events.messages[0].message.data.length, 350_000);
  // And nothing larger: a message over the limit never arrives.
  player.client.send({ t: "blob", data: "orders ".repeat(100_000) });
  await wait(400);
  assert.equal(setup.events.messages.length, 1);
  setup.host.stop();
});

test("when the host closes the game, players are told", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  setup.host.stop();
  assert.ok(await until(() => player.client.state === "lost"));
  assert.equal(player.log.states.at(-1).reason, "host-closed");
});
