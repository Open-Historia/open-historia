/*! Open Historia — hosting and joining with one invite token © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/session/session.test.js
//
// The whole wire, host and players, over in-memory relays and an in-memory
// WebRTC: one token lets many players in, up to the seats; someone else holding
// the token cannot pose as the host; a player who drops comes back as the same
// player; the host can remove and ban, and make a new token that shuts the old
// one out without touching anyone already in. And joining never waits without
// an end: each way it can fail has its own reason, on both screens.

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

const world = ({ seats = 4, hostLimits = {}, hostNow, relayOptions = {}, backlog = false, hostOptions = {} } = {}) => {
  const relays = createFakeRelayNetwork(relayOptions);
  const rtc = createFakeRtcNetwork({ backlog });
  const channelFactory = (options) => createNostrChannel({ ...options, relays: RELAYS, WebSocketImpl: relays.WebSocket });
  const peerFactory = (options) => createPeer({ ...options, RTCPeerConnectionImpl: rtc.RTCPeerConnection });
  const hostKey = createIdentity();
  const invite = createInvite(hostKey.publicKey);
  const events = { joins: [], leaves: [], messages: [], status: null };
  const host = track(createHostSession({
    invite: parseInvite(invite.token), host: hostKey, room: { name: "The Cold War", seats, version: VERSION },
    appMessages, channelFactory, peerFactory,
    onJoin: (player, detail) => events.joins.push({ ...player, ...detail }),
    onLeave: (player, reason) => events.leaves.push({ ...player, reason }),
    onMessage: (player, message) => events.messages.push({ from: player.name, message }),
    onStatus: (status) => { events.status = status; },
    ...(hostNow ? { now: hostNow } : {}),
    limits: { beaconIntervalMs: 200, pingIntervalMs: 100_000, ...hostLimits },
    ...hostOptions,
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

test("the game says who has room: a player whose device holds a seat comes in when a newcomer is told the game is full", async () => {
  // As the game counts its players (host/gameHost.js roomFor): Ana's device
  // holds a seat, and every seat is held.
  const ana = createIdentity();
  const setup = world({ seats: 1, hostOptions: { roomFor: (device) => device === ana.id, openSeats: () => 0 } });
  setup.host.start();
  const stranger = setup.join("Ben");
  assert.ok(await until(() => stranger.client.state === "rejected"));
  assert.equal(stranger.log.states.at(-1).reason, "full");
  const back = setup.join("Ana", { device: ana });
  assert.ok(await until(() => back.client.state === "connected"));
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
  assert.ok(banned.client.player && kicked.client.player, "each was in the game: its page takes it out, with why");
  const again = setup.join("Mallory", { device: banned.device });
  assert.ok(await until(() => again.client.state === "rejected"));
  assert.equal(again.log.states.at(-1).reason, "banned");
  const back = setup.join("Ben", { device: kicked.device });
  assert.ok(await until(() => back.client.state === "connected"));
  setup.host.stop();
});

// The page that was in the game is taken out of it on any end of its session (client/sharedGame.js endForThisPage),
// and tells why by the reason: a player the host banned while its connection was down is told it was banned when it
// comes back, still as the player it was, never let back in nor left reconnecting.
test("a player banned while its connection is down is told it was banned when it tries to come back", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Mallory");
  assert.ok(await until(() => player.client.state === "connected"));
  const id = player.client.player;
  setup.rtc.drop();
  assert.ok(await until(() => setup.host.players()[0]?.status === "away"));
  setup.host.kick(id, { ban: true });
  assert.ok(await until(() => player.client.state === "rejected", 10_000), JSON.stringify(player.log.states.map((entry) => entry.state)));
  assert.equal(player.log.states.at(-1).reason, "banned");
  assert.equal(player.client.player, id, "it was in the game: its page takes it out, with why");
  assert.equal(setup.events.joins.length, 1, "never let back in");
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
  // From a player, anything up to the host's limit for one (the answer its own
  // AI gave to a round it pays for is the largest thing a player sends).
  player.client.send({ t: "blob", data: "orders ".repeat(300_000) });
  assert.ok(await until(() => setup.events.messages.length === 1, 5000));
  assert.equal(setup.events.messages[0].message.data.length, 2_100_000);
  // And nothing larger: a message over the limit never arrives.
  player.client.send({ t: "blob", data: "orders ".repeat(500_000) });
  await wait(400);
  assert.equal(setup.events.messages.length, 1);
  setup.host.stop();
});

// A paying device's answer to a round is the largest message a player sends, in many frames: the rate is of
// messages, so its frames are no flood, and its player is not struck or removed (the review of 2026-11-18).
test("a large message in many frames is one message to the rate limit", async () => {
  const setup = world({ hostLimits: { messagesPerSecond: 5, messageBurst: 10, strikesToRemove: 5 } });
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  player.client.send({ t: "blob", data: "orders ".repeat(300_000) });
  assert.ok(await until(() => setup.events.messages.length === 1, 5000));
  player.client.send({ t: "chat", text: "and still here" });
  assert.ok(await until(() => setup.events.messages.length === 2, 2000));
  assert.equal(player.client.state, "connected");
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
  assert.ok(player.client.player, "still as the player it was: its page takes it out of the game (client/sharedGame.js)");
});

// --- Joining says where it stopped ------------------------------------------------

test("a player's screen is told each step: the host's lobby heard, connecting, let in", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  const steps = player.log.states.map((entry) => entry.state);
  assert.deepEqual([...new Set(steps)], ["finding", "connecting", "joining", "connected"]);
  assert.equal(player.log.states[0].heard, false, "nothing is known at first");
  assert.equal(player.log.states.at(-1).heard, true);
  assert.equal(player.log.states.at(-1).failures, 0);
  setup.host.stop();
});

test("no host on the code is \"host-not-found\"; a host that answers nobody is \"no-answer\"", async () => {
  const nobody = world();
  const lost = nobody.join("Ana", { findTimeoutMs: 300 });
  assert.ok(await until(() => lost.client.state === "lost"));
  assert.equal(lost.log.states.at(-1).reason, "host-not-found");
  assert.equal(lost.log.states.at(-1).heard, false);

  // Its beacon is heard; every offer is over its limit and is ignored.
  const silent = world({ hostLimits: { offersPerMinute: 0 } });
  silent.host.start();
  const waiting = silent.join("Ben", { findTimeoutMs: 800 });
  assert.ok(await until(() => waiting.client.state === "lost"));
  assert.equal(waiting.log.states.at(-1).reason, "no-answer");
  assert.ok(waiting.log.states.some((entry) => entry.state === "finding" && entry.heard), "the screen was told the lobby is there");
  assert.equal(waiting.log.room.name, "The Cold War");
  silent.host.stop();
});

test("answered, and the two computers never connect: the player is told so, and the host sees who", async () => {
  const setup = world();
  setup.rtc.block("failed");
  setup.host.start();
  const player = setup.join("Ana", { maxConnectFailures: 2 });
  assert.ok(await until(() => player.client.state === "lost"));
  assert.equal(player.log.states.at(-1).reason, "cannot-connect");
  assert.equal(player.log.states.at(-1).failures, 2);
  assert.ok(player.log.states.some((entry) => entry.state === "finding" && entry.failures === 1), "the screen was told of the first failure");
  assert.ok(await until(() => setup.events.status?.unreachable?.includes("Ana")), JSON.stringify(setup.events.status));
  assert.equal(setup.host.players().length, 0);

  // The network lets them through after all: they get in, and leave the list.
  setup.rtc.unblock();
  const again = setup.join("Ana", { device: player.device });
  assert.ok(await until(() => again.client.state === "connected"));
  assert.deepEqual(setup.events.status.unreachable, []);
  setup.host.stop();
});

test("a connection that never says it failed is given up on by the clock", async () => {
  const setup = world();
  setup.rtc.block("silent");
  setup.host.start();
  const player = setup.join("Ana", { connectTimeoutMs: 150, maxConnectFailures: 1 });
  assert.ok(await until(() => player.client.state === "lost"));
  assert.equal(player.log.states.at(-1).reason, "cannot-connect");
  setup.host.stop();
});

test("a host that answered once and then went quiet is not waited on for ever", async () => {
  const setup = world();
  setup.rtc.block("failed");
  setup.host.start();
  const player = setup.join("Ana", { maxConnectFailures: 5, findTimeoutMs: 2500 });
  assert.ok(await until(() => player.log.states.some((entry) => entry.failures === 1)));
  // The host is gone (no goodbye reaches someone who was never in): the next
  // offers go into silence, and that wait has an end of its own.
  setup.host.stop();
  assert.ok(await until(() => player.client.state === "lost"));
  assert.equal(player.log.states.at(-1).reason, "no-answer");
});

test("people the host cannot reach do not take the seats of those it can", async () => {
  const setup = world({ seats: 2 });
  setup.host.start();
  // Three joiners whose connections never open, each held by the host for as
  // long as it waits for one: more of them than there are seats.
  setup.rtc.block("silent");
  const stuck = ["Ana", "Ben", "Cleo"].map((name) => setup.join(name));
  assert.ok(await until(() => setup.events.status?.joining?.length === 3), JSON.stringify(setup.events.status));
  assert.ok(await until(() => stuck.every(({ client }) => client.state === "connecting")));
  // Two who can connect still get the two seats.
  setup.rtc.unblock();
  const fine = ["Dan", "Eve"].map((name) => setup.join(name));
  assert.ok(await until(() => fine.every(({ client }) => client.state === "connected")), JSON.stringify(fine.map(({ log }) => log.states.at(-1))));
  assert.deepEqual(setup.host.players().map((player) => player.name).sort(), ["Dan", "Eve"]);
  // And the seats are still the limit for whoever comes next.
  const late = setup.join("Finn");
  assert.ok(await until(() => late.client.state === "rejected"));
  assert.equal(late.log.states.at(-1).reason, "full");
  setup.host.stop();
});

test("a message from the host that this build cannot read is reported, not swallowed", async () => {
  const setup = world();
  setup.host.start();
  const problems = [];
  // A player on a build that does not know the host's "blob" message.
  const player = setup.join("Ana", { appMessages: { chat: appMessages.chat }, onProblem: (problem) => problems.push(problem) });
  assert.ok(await until(() => player.client.state === "connected"));
  setup.host.send(player.client.player, { t: "blob", data: "x" });
  assert.ok(await until(() => problems.length === 1));
  assert.equal(problems[0].type, "blob");
  assert.equal(player.log.messages.length, 0);
  setup.host.stop();
});

test("a computer whose clock is an hour behind is told its clock is wrong, not that no host was found", async () => {
  // The relays refuse an ephemeral event stamped more than a minute before
  // their own time, as strfry does; a player's computer was an hour behind.
  const setup = world({ relayOptions: { ephemeralMaxAgeSeconds: 60 } });
  setup.host.start();
  const hourBehind = () => Date.now() - 3_600_000;
  const late = setup.join("Ana", { now: hourBehind, findTimeoutMs: 800 });
  assert.ok(await until(() => late.client.state === "lost"));
  assert.equal(late.log.states.at(-1).reason, "clock");
  assert.ok(late.log.states.some((entry) => entry.state === "finding" && entry.clock), "the screen was told while it still tried");
  // Stamped by the relays' time instead (client/clock.js), the same computer gets in.
  const corrected = setup.join("Ben");
  assert.ok(await until(() => corrected.client.state === "connected"));
  setup.host.stop();
});

test("a host whose clock is an hour behind is told nobody can find its lobby", async () => {
  const setup = world({ relayOptions: { ephemeralMaxAgeSeconds: 60 }, hostNow: () => Date.now() - 3_600_000 });
  setup.host.start();
  assert.ok(await until(() => setup.events.status?.clockRefused === true), JSON.stringify(setup.events.status));
  setup.host.stop();
});

// A view of the world is megabytes, sent as many frames, paused whenever the
// channel's buffer is full. A small message sent meanwhile went out between its
// frames and arrived first; the page then dropped the large one as older, and
// never had the world. Each end now sends one message at a time.
test("a small message never overtakes a large one on its way, either way", async () => {
  const setup = world({ backlog: true });
  setup.host.start();
  const player = setup.join("Ana");
  assert.ok(await until(() => player.client.state === "connected"));
  // Under the test schema's 3 MB, and well over the 1 MiB that pauses a send.
  const data = "map ".repeat(700_000);
  setup.host.send(player.client.player, { t: "blob", data });
  setup.host.send(player.client.player, { t: "blob", data: "small" });
  assert.ok(await until(() => player.log.messages.length === 2, 20_000));
  assert.deepEqual(player.log.messages.map((message) => message.data.length), [data.length, 5], "the large one first, whole");
  // And from a player to the host.
  const order = "orders ".repeat(40_000);
  player.client.send({ t: "blob", data: order });
  player.client.send({ t: "blob", data: "small" });
  assert.ok(await until(() => setup.events.messages.length === 2, 20_000));
  assert.deepEqual(setup.events.messages.map((entry) => entry.message.data.length), [order.length, 5]);
  setup.host.stop();
});

test("a flood of offers keeps nobody of the game out, and a newcomer over the limit is told the host is busy", async () => {
  // The per-device limit is by a key a joiner makes for itself: fresh keys spent what everyone together may ask,
  // and a seated player coming back waited without a word (the review of 2026-11-18, security S12).
  const seated = createIdentity();
  const lines = [];
  const setup = world({ seats: 4, hostLimits: { offersPerMinute: 1 }, hostOptions: { knows: (device) => device === seated.id, log: (text) => lines.push(text) } });
  setup.host.start();
  const first = setup.join("Ana");
  assert.ok(await until(() => first.client.state === "connected"));
  const flood = setup.join("Ben");
  assert.ok(await until(() => lines.some((line) => /told to try again/.test(line))), "the newcomer over the limit is denied, busy");
  const back = setup.join("Cleo", { device: seated });
  assert.ok(await until(() => back.client.state === "connected"), "a player of the game is let through");
  assert.notEqual(flood.client.state, "connected");
  setup.host.stop();
});

// "I closed the lobby but this person says they are still in it" (the owner, 2026-11-18): a guest whose connection
// to the host dropped, and whose host never came back, was left "reconnecting" for good, playing a dead game.
test("a player who lost a host that is gone for good is told so once its lobby leaves the relays", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Ana", { beaconGoneMs: 800, reconnectMostMs: 60_000 });
  assert.ok(await until(() => player.client.state === "connected"));
  // The host's computer gone with no goodbye (the app closed, a crash): its connection drops and its lobby goes.
  setup.rtc.drop();
  setup.host.stop();
  assert.ok(await until(() => player.log.states.some((entry) => entry.state === "reconnecting"), 5000), "said at once");
  assert.ok(await until(() => player.client.state === "lost", 10_000), JSON.stringify(player.log.states.map((entry) => entry.state)));
  assert.equal(player.log.states.at(-1).reason, "host-gone");
});

test("a player who cannot get back to the host is told so after a bounded time, even with its lobby heard", async () => {
  const setup = world();
  setup.host.start();
  const player = setup.join("Ana", { beaconGoneMs: 60_000, reconnectMostMs: 1500 });
  assert.ok(await until(() => player.client.state === "connected"));
  // The host still on the relays, but every connection it answers never opens.
  setup.rtc.block("failed");
  setup.rtc.drop();
  assert.ok(await until(() => player.client.state === "lost", 10_000), JSON.stringify(player.log.states.map((entry) => entry.state)));
  assert.equal(player.log.states.at(-1).reason, "host-gone");
  setup.host.stop();
});
