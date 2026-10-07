/*! Open Historia — tests for the TURN credentials the public server hands out © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/turn.test.js
//
// Credentials follow coturn's use-auth-secret scheme exactly (recomputed here
// from the secret), last TURN_TTL_SECONDS, and each covers one connection.
// They go only where a game needs them: to a host, one per player connection,
// within a budget sized by its seats; and to a joiner that names a room with a
// host to answer it, before any offer (a relay-only offer already holds its
// relay candidates), within budgets per socket, per address and per room. A
// connection that outlives its credential asks again the same way.

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { connect, hostIdentity, hostRoom, manualClock, randomHex, startServer, wait } from "./helpers.js";

const SECRET = "f".repeat(16) + "0123456789abcdef".repeat(3);
const URLS = ["turn:turn.example.org:3478?transport=udp", "turn:turn.example.org:3478?transport=tcp", "turns:turn.example.org:5349?transport=tcp"];
const TURN = { turnSecret: SECRET, turnUrls: URLS, turnTtlSeconds: 600 };

const checkCredentials = (reply, at, ttl = 600) => {
  assert.equal(reply.t, "turn", JSON.stringify(reply));
  assert.equal(reply.ttl, ttl);
  assert.equal(reply.iceServers.length, 1);
  const [server] = reply.iceServers;
  assert.deepEqual(Object.keys(server).sort(), ["credential", "urls", "username"]);
  assert.deepEqual(server.urls, URLS);
  const match = /^(\d+):([0-9a-f]{32})$/.exec(server.username);
  assert.ok(match, server.username);
  assert.equal(Number(match[1]), Math.floor(at / 1000) + ttl);
  assert.equal(server.credential, createHmac("sha1", SECRET).update(server.username).digest("base64"));
  return server;
};

// A socket behind the proxy at `address`.
const from = (server, address) => connect(server, { headers: { "X-Forwarded-For": address } });

test("a host gets one credential per player connection, within twice its seats and two per credential lifetime", async (t) => {
  const clock = manualClock();
  const server = await startServer(TURN, { now: clock.now });
  t.after(() => server.close());
  const { client: host } = await hostRoom(server, hostIdentity(), { seats: 2, open: 2 }, { ts: clock.now() });
  const names = new Set();
  for (let index = 0; index < 6; index += 1) names.add(checkCredentials(await host.request({ t: "turn" }, "turn"), clock.now()).username);
  assert.equal(names.size, 6, "each credential is new");
  assert.equal((await host.request({ t: "turn" }, "turn")).code, "busy");
  // Six more every 600 seconds: one every 100.
  clock.advance(100_000);
  checkCredentials(await host.request({ t: "turn" }, "turn"), clock.now());
  assert.equal((await host.request({ t: "turn" }, "turn")).code, "busy");
  // Still hosting an hour later: renewing works as asking did.
  clock.advance(60 * 60_000);
  checkCredentials(await host.request({ t: "turn" }, "turn"), clock.now());
  // The secret itself never goes out.
  assert.ok(!JSON.stringify([...names]).includes(SECRET));
});

test("a joiner gets credentials for a room with a host to answer it, before any offer", async (t) => {
  const clock = manualClock();
  const server = await startServer(TURN, { now: clock.now, timing: { graceMs: 60_000 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server, hostIdentity(), {}, { ts: clock.now() });
  const joiner = await connect(server);
  checkCredentials(await joiner.request({ t: "turn", roomId: room.roomId }, "turn"), clock.now());

  assert.equal((await joiner.request({ t: "turn", roomId: randomHex(16) }, "turn")).code, "unknown-room");
  assert.equal((await host.request({ t: "turn", roomId: room.roomId }, "turn")).code, "own-room");
  // Naming no room, from a socket that hosts nothing: nothing.
  const idle = await connect(server);
  assert.equal((await idle.request({ t: "turn" }, "turn")).code, "not-eligible");
  await idle.request({ t: "list" }, "rooms");
  assert.equal((await idle.request({ t: "turn" }, "turn")).code, "not-eligible");
  // While the host is away (its socket closed, the room in its grace), nobody
  // is there to answer, so no credentials either.
  await host.close();
  await wait(50);
  assert.equal((await joiner.request({ t: "turn", roomId: room.roomId }, "turn")).code, "host-away");
});

test("a joiner's credentials are limited per socket and per address", async (t) => {
  const clock = manualClock();
  const server = await startServer({ ...TURN, trustProxy: true }, { now: clock.now });
  t.after(() => server.close());
  const { room } = await hostRoom(server, hostIdentity(), { seats: 64, open: 60 }, {
    ts: clock.now(), connectOptions: { headers: { "X-Forwarded-For": "192.0.2.1" } },
  });
  const ask = (socket) => socket.request({ t: "turn", roomId: room.roomId }, "turn");

  // Three from one socket, then one every twenty seconds.
  const first = await from(server, "198.51.100.1");
  for (let index = 0; index < 3; index += 1) checkCredentials(await ask(first), clock.now());
  assert.equal((await ask(first)).code, "rate-limited");
  // Six from one address, whatever its sockets.
  const second = await from(server, "198.51.100.1");
  for (let index = 0; index < 3; index += 1) checkCredentials(await ask(second), clock.now());
  const third = await from(server, "198.51.100.1");
  assert.equal((await ask(third)).code, "rate-limited");
  // Another address is another budget, and time refills them all.
  checkCredentials(await ask(await from(server, "203.0.113.9")), clock.now());
  clock.advance(20_000);
  checkCredentials(await ask(third), clock.now());
});

test("a room hands its joiners twice its seats and two credentials per lifetime, whoever asks", async (t) => {
  const clock = manualClock();
  const server = await startServer({ ...TURN, trustProxy: true }, { now: clock.now });
  t.after(() => server.close());
  const { room } = await hostRoom(server, hostIdentity(), { seats: 1, open: 1 }, {
    ts: clock.now(), connectOptions: { headers: { "X-Forwarded-For": "192.0.2.1" } },
  });
  const ask = async (address) => (await from(server, address)).request({ t: "turn", roomId: room.roomId }, "turn");
  for (const address of ["198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4"]) checkCredentials(await ask(address), clock.now());
  assert.equal((await ask("198.51.100.5")).code, "busy");
  // Four every 600 seconds: one every 150.
  clock.advance(150_000);
  checkCredentials(await ask("198.51.100.5"), clock.now());
});

test("a credential lasts TURN_TTL_SECONDS, 900 unless set", async (t) => {
  const clock = manualClock();
  const server = await startServer({ turnSecret: SECRET, turnUrls: URLS }, { now: clock.now });
  t.after(() => server.close());
  const { client: host } = await hostRoom(server, hostIdentity(), {}, { ts: clock.now() });
  checkCredentials(await host.request({ t: "turn" }, "turn"), clock.now(), 900);
});

test("with TURN off, the answer is an empty list, for anyone", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = await connect(server);
  assert.deepEqual(await client.request({ t: "turn" }, "turn"), { t: "turn", iceServers: [], ttl: 0 });
  assert.deepEqual(await client.request({ t: "turn", roomId: randomHex(16) }, "turn"), { t: "turn", iceServers: [], ttl: 0 });
});
