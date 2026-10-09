/*! Open Historia — tests for the public multiplayer server's listing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/listing.test.js
//
// The listing shows public rooms only, narrows by every filter, orders by
// players then age, and pages fifty at a time.

import test from "node:test";
import assert from "node:assert/strict";
import { connect, hostIdentity, hostMessage, hostRoom, httpRequest, manualClock, startServer } from "./helpers.js";

const ids = (reply) => reply.rooms.map((room) => room.roomId).sort();
const expect = (...rooms) => rooms.map((room) => room.roomId).sort();

test("each filter narrows the listing, and unlisted rooms are never in it", async (t) => {
  // This test asks for two dozen listings in a row, on purpose.
  const server = await startServer({ maxRoomsPerIp: 20, maxConnectionsPerIp: 20 }, { limits: { listBurst: 100, listAddressBurst: 100 } });
  t.after(() => server.close());
  const make = async (overrides) => (await hostRoom(server, hostIdentity(), overrides)).room;
  const coldWar = await make({ name: "Berlin Airlift", scenario: { id: "cold-war", name: "Cold War", hash: "11".repeat(32) }, open: 7, language: "en-GB" });
  const ww2 = await make({ name: "Operation Überlord", scenario: { id: "ww2", name: "World War II", hash: "22".repeat(32) }, fog: false, cheats: "vote", open: 1, language: "de" });
  const cycle = await make({ name: "Payment Club", payment: "cycle", password: true, version: "0.0.52", language: "en", open: 4 });
  const hidden = await make({ name: "Friends Only", visibility: "unlisted" });
  const browser = await connect(server);
  const list = (filters) => browser.request({ t: "list", filters }, "rooms");

  const everything = await list({});
  assert.deepEqual(ids(everything), expect(coldWar, ww2, cycle));
  assert.equal(everything.total, 3);
  assert.ok(!ids(everything).includes(hidden.roomId));

  assert.deepEqual(ids(await list({ scenario: "cold-war" })), expect(coldWar));
  assert.deepEqual(ids(await list({ scenario: "cold" })), []);
  assert.deepEqual(ids(await list({ language: "en" })), expect(coldWar, cycle));
  assert.deepEqual(ids(await list({ language: "en-GB" })), expect(coldWar));
  assert.deepEqual(ids(await list({ language: "en-gb" })), expect(coldWar));
  assert.deepEqual(ids(await list({ language: "de" })), expect(ww2));
  assert.deepEqual(ids(await list({ version: "0.0.52" })), expect(cycle));
  assert.deepEqual(ids(await list({ fog: false })), expect(ww2));
  assert.deepEqual(ids(await list({ fog: true })), expect(coldWar, cycle));
  assert.deepEqual(ids(await list({ cheats: "vote" })), expect(ww2));
  assert.deepEqual(ids(await list({ payment: "cycle" })), expect(cycle));
  assert.deepEqual(ids(await list({ password: true })), expect(cycle));
  assert.deepEqual(ids(await list({ password: false })), expect(coldWar, ww2));
  assert.deepEqual(ids(await list({ minOpen: 4 })), expect(coldWar, cycle));
  assert.deepEqual(ids(await list({ minOpen: 8 })), []);
  // Search: either name, any case, any Unicode form.
  assert.deepEqual(ids(await list({ q: "AIRLIFT" })), expect(coldWar));
  assert.deepEqual(ids(await list({ q: "world war" })), expect(ww2));
  assert.deepEqual(ids(await list({ q: "überlord" })), expect(ww2));
  assert.deepEqual(ids(await list({ q: "friends" })), []);
  assert.deepEqual(ids(await list({ q: "" })), expect(coldWar, ww2, cycle));
  // Together.
  assert.deepEqual(ids(await list({ language: "en", fog: true, minOpen: 5 })), expect(coldWar));

  // A filter that is not one, or out of range, is an invalid message.
  assert.equal((await browser.request({ t: "list", filters: { hostKey: "x" } }, "rooms")).code, "invalid");
  assert.equal((await browser.request({ t: "list", filters: { minOpen: 65 } }, "rooms")).code, "invalid");
  assert.equal((await browser.request({ t: "list", page: 101 }, "rooms")).code, "invalid");
});

test("most players first, then the newest; fifty to a page; ages from first registration", async (t) => {
  const clock = manualClock();
  const server = await startServer({ maxRoomsPerIp: 100, maxConnectionsPerIp: 100 }, { now: clock.now, limits: { requestBurst: 1000 } });
  t.after(() => server.close());
  const rooms = [];
  for (let index = 0; index < 60; index += 1) {
    // Players 0-5 (seats 8, open 8-…); each room a second younger than the last.
    const open = 8 - (index % 6);
    rooms.push({ ...(await hostRoom(server, hostIdentity(), { open }, { ts: clock.now() })).room, createdAt: clock.now() });
    clock.advance(1000);
  }
  const browser = await connect(server);
  const expected = [...rooms]
    .sort((a, b) => (b.seats - b.open) - (a.seats - a.open) || b.createdAt - a.createdAt)
    .map((room) => room.roomId);

  const first = await browser.request({ t: "list", page: 0 }, "rooms");
  const second = await browser.request({ t: "list", page: 1 }, "rooms");
  const third = await browser.request({ t: "list", page: 2 }, "rooms");
  assert.equal(first.rooms.length, 50);
  assert.equal(second.rooms.length, 10);
  assert.equal(third.rooms.length, 0);
  for (const page of [first, second, third]) assert.equal(page.total, 60);
  assert.deepEqual([first.page, second.page, third.page], [0, 1, 2]);
  assert.deepEqual([...first.rooms, ...second.rooms].map((room) => room.roomId), expected);

  // The oldest room was registered 59 seconds before the newest, and the
  // clock has moved on one more since.
  const oldest = [...first.rooms, ...second.rooms].find((room) => room.roomId === rooms[0].roomId);
  assert.equal(oldest.ageSeconds, 60);
  assert.equal(oldest.players, 0);
  const busiest = first.rooms[0];
  assert.equal(busiest.players, 5);
});

test("listing has a budget of its own: per socket, and per address across sockets and HTTP", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const browser = await connect(server);
  for (let index = 0; index < 5; index += 1) assert.equal((await browser.request({ t: "list" }, "rooms")).t, "rooms");
  const refused = await browser.request({ t: "list" }, "rooms");
  assert.equal(refused.code, "rate-limited");
  // Not a strike: paging fast is not an attack, and the socket stays.
  assert.deepEqual(await browser.request({ t: "ping", n: 1 }, "pong"), { t: "pong", n: 1 });
  // The address has fifteen at once: five more sockets' worth, minus what
  // HTTP takes from the same budget.
  for (let index = 0; index < 5; index += 1) assert.equal((await httpRequest(server, "/api/rooms")).status, 200);
  const other = await connect(server);
  for (let index = 0; index < 5; index += 1) assert.equal((await other.request({ t: "list" }, "rooms")).t, "rooms");
  assert.equal((await httpRequest(server, "/api/rooms")).status, 429);
  clock.advance(1000);
  assert.equal((await other.request({ t: "list" }, "rooms")).t, "rooms");
});

test("a cached page changes as soon as a room does, and its ages move with the clock", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const { client: host, room, identity } = await hostRoom(server, hostIdentity(), { name: "Before" }, { ts: clock.now() });
  const browser = await connect(server);
  const list = async () => (await browser.request({ t: "list" }, "rooms")).rooms;
  assert.equal((await list())[0].name, "Before");
  await host.request(hostMessage(identity, { ...room, name: "After" }, clock.now() + 1), "hosted");
  assert.equal((await list())[0].name, "After");
  clock.advance(3000);
  assert.equal((await list())[0].ageSeconds, 3);
  await host.request({ t: "unhost", roomId: room.roomId }, "unhosted");
  assert.deepEqual(await list(), []);
});
