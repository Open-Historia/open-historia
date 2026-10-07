/*! Open Historia — tests for registering a room on the public multiplayer server © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/hosting.test.js
//
// A room goes into the listing only with a fresh signature by its host key,
// only its own connection can change it or take it down, its id stays bound
// to its key, and nobody can fill the server with rooms.

import test from "node:test";
import assert from "node:assert/strict";
import { connect, hostIdentity, hostMessage, hostRoom, makeRoom, manualClock, signRoom, startServer } from "./helpers.js";

const listing = async (client, filters = {}) => client.request({ t: "list", filters }, "rooms");

test("a signed room is registered, listed, updated by its connection and taken down", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const identity = hostIdentity();
  const host = await connect(server);
  const room = makeRoom(identity, { seats: 8, open: 6 });
  const ts = Date.now();
  assert.deepEqual(await host.request(hostMessage(identity, room, ts), "hosted"), { t: "hosted", roomId: room.roomId });

  const browser = await connect(server);
  let listed = await listing(browser);
  assert.equal(listed.total, 1);
  assert.deepEqual(listed.rooms[0], { ...room, players: 2, ageSeconds: 0 });

  // An update: fewer seats open, and a later ts.
  const updated = { ...room, open: 3, name: "The Cuban Crisis" };
  assert.equal((await host.request(hostMessage(identity, updated, ts + 1), "hosted")).t, "hosted");
  listed = await listing(browser);
  assert.equal(listed.rooms[0].players, 5);
  assert.equal(listed.rooms[0].name, "The Cuban Crisis");

  assert.deepEqual(await host.request({ t: "unhost", roomId: room.roomId }, "unhosted"), { t: "unhosted", roomId: room.roomId });
  assert.equal((await listing(browser)).total, 0);
  // Taking it down again: it is no longer this connection's room.
  assert.equal((await host.request({ t: "unhost", roomId: room.roomId }, "unhosted")).code, "not-your-room");
});

test("key order does not matter: the signature covers the room's canonical JSON", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const identity = hostIdentity();
  const host = await connect(server);
  const room = makeRoom(identity);
  const ts = Date.now();
  const sig = signRoom(identity, room, ts);
  const reordered = Object.fromEntries(Object.entries(room).reverse());
  const text = JSON.stringify({ sig, ts, room: reordered, v: 1, t: "host" });
  host.send(text);
  assert.equal((await host.next()).t, "hosted");
});

test("a bad signature, a stale or future ts, a replayed ts and open > seats are refused", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const identity = hostIdentity();
  const host = await connect(server);
  const room = makeRoom(identity);
  const at = clock.now();

  // Signed by another key.
  const forged = { ...hostMessage(identity, room, at), sig: signRoom(hostIdentity(), room, at) };
  assert.equal((await host.request(forged, "hosted")).code, "bad-signature");
  // Signed over other contents.
  const swapped = { ...hostMessage(identity, room, at), room: { ...room, name: "Something else" } };
  assert.equal((await host.request(swapped, "hosted")).code, "bad-signature");
  // Signed over another ts.
  assert.equal((await host.request({ ...hostMessage(identity, room, at), ts: at + 1 }, "hosted")).code, "bad-signature");

  // More than five minutes either side of the server's clock, however well signed.
  for (const ts of [at - 5 * 60_000 - 1, at + 5 * 60_000 + 1]) {
    const reply = await host.request(hostMessage(identity, room, ts), "hosted");
    assert.equal(reply.code, "stale");
    assert.match(reply.message, new RegExp(String(at)));
  }

  const lopsided = makeRoom(identity, { seats: 4, open: 5 });
  assert.equal((await host.request(hostMessage(identity, lopsided, at), "hosted")).code, "invalid");

  // Registered at `at`; the same message again, or an older one, is refused.
  assert.equal((await host.request(hostMessage(identity, room, at), "hosted")).t, "hosted");
  assert.equal((await host.request(hostMessage(identity, room, at), "hosted")).code, "stale");
  assert.equal((await host.request(hostMessage(identity, { ...room, open: 0 }, at - 1000), "hosted")).code, "stale");
  assert.equal((await host.request(hostMessage(identity, { ...room, open: 0 }, at + 1), "hosted")).t, "hosted");
});

test("a room id stays bound to its host key and its connection", async (t) => {
  const server = await startServer({ maxRoomsPerIp: 10 });
  t.after(() => server.close());
  const { client: owner, room, identity } = await hostRoom(server);

  // Another key, with a perfectly good signature of its own: the id is not
  // one its key and any nonce derive, so it is refused before anything else.
  const intruder = await connect(server);
  const thief = hostIdentity();
  const stolen = { ...room, hostKey: thief.hostKey, name: "Mine now" };
  const refused = await intruder.request(hostMessage(thief, stolen, Date.now()), "hosted");
  assert.equal(refused.code, "invalid");
  assert.match(refused.message, /derived from hostKey and nonce/);

  // The same key from another connection, while the first still holds it.
  assert.equal((await intruder.request(hostMessage(identity, { ...room, open: 0 }, Date.now() + 5), "hosted")).code, "room-in-use");
  assert.equal((await intruder.request({ t: "unhost", roomId: room.roomId }, "unhosted")).code, "not-your-room");

  // Nothing changed.
  const listed = await intruder.request({ t: "list" }, "rooms");
  assert.equal(listed.rooms[0].name, room.name);
  assert.equal(listed.rooms[0].open, room.open);
  assert.equal(owner.inbox.length, 0);
});

test("once a room is gone, nobody else can register a room under its id", async (t) => {
  const server = await startServer({ maxRoomsPerIp: 10 });
  t.after(() => server.close());
  const { client: owner, room } = await hostRoom(server);
  await owner.request({ t: "unhost", roomId: room.roomId }, "unhosted");

  // The id is free in the registry, but it is derived from the first key:
  // a squatter's key with any nonce, the listed one included, derives another.
  const squatter = hostIdentity();
  const client = await connect(server);
  for (const nonce of [room.nonce, "0".repeat(32)]) {
    const claim = { ...makeRoom(squatter, { nonce }), roomId: room.roomId };
    assert.equal((await client.request(hostMessage(squatter, claim), "hosted")).code, "invalid");
  }
  // Its own room, under its own derived id, it may register.
  const own = makeRoom(squatter);
  assert.notEqual(own.roomId, room.roomId);
  assert.equal((await client.request(hostMessage(squatter, own), "hosted")).t, "hosted");
});

test("room messages have a budget of their own: bursts of 10, then 2 a second", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const identity = hostIdentity();
  const host = await connect(server);
  const room = makeRoom(identity);
  for (let index = 0; index < 10; index += 1) {
    assert.equal((await host.request(hostMessage(identity, { ...room, open: index % 7 }, clock.now() + index), "hosted")).t, "hosted");
  }
  const refused = await host.request(hostMessage(identity, room, clock.now() + 10), "hosted");
  assert.equal(refused.code, "rate-limited");
  clock.advance(500);
  assert.equal((await host.request(hostMessage(identity, room, clock.now() + 11), "hosted")).t, "hosted");
});

test("what can be refused without the signature is refused before it is checked", async (t) => {
  const server = await startServer({ maxRoomsPerIp: 1 });
  t.after(() => server.close());
  const { client: host, room, identity } = await hostRoom(server);
  const garbage = "A".repeat(86);
  // Each of these would also fail the signature; the cheaper refusal answers,
  // and it is not a strike, so the socket stays.
  const other = makeRoom(identity);
  const replies = [];
  for (let index = 0; index < 6; index += 1) {
    replies.push(await host.request({ ...hostMessage(identity, other), sig: garbage }, "hosted"));
  }
  assert.ok(replies.every((reply) => reply.code === "one-room"));
  const second = await connect(server);
  assert.equal((await second.request({ ...hostMessage(identity, other), sig: garbage }, "hosted")).code, "too-many-rooms");
  assert.equal((await second.request({ ...hostMessage(identity, { ...room, open: 0 }), sig: garbage }, "hosted")).code, "room-in-use");
  assert.equal((await host.request({ ...hostMessage(identity, room, 0), sig: garbage }, "hosted")).code, "stale");
  assert.deepEqual(await host.request({ t: "ping", n: 1 }, "pong"), { t: "pong", n: 1 });
});

test("one room per connection, a few per address, and a ceiling for the server", async (t) => {
  const perAddress = await startServer({ maxRoomsPerIp: 2, maxRooms: 10 });
  t.after(() => perAddress.close());
  const identity = hostIdentity();
  const first = await hostRoom(perAddress, identity);
  const another = makeRoom(identity);
  assert.equal((await first.client.request(hostMessage(identity, another), "hosted")).code, "one-room");
  await hostRoom(perAddress);
  const third = await connect(perAddress);
  const extra = hostIdentity();
  assert.equal((await third.request(hostMessage(extra, makeRoom(extra)), "hosted")).code, "too-many-rooms");
  // A room taken down frees its place.
  await first.client.request({ t: "unhost", roomId: first.room.roomId }, "unhosted");
  assert.equal((await third.request(hostMessage(extra, makeRoom(extra)), "hosted")).t, "hosted");

  const small = await startServer({ maxRoomsPerIp: 50, maxRooms: 2 });
  t.after(() => small.close());
  await hostRoom(small);
  await hostRoom(small);
  const late = await connect(small);
  const key = hostIdentity();
  assert.equal((await late.request(hostMessage(key, makeRoom(key)), "hosted")).code, "server-full");
});
