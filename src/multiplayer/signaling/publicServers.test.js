/*! Open Historia — the public game listing, from a player's side: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/signaling/publicServers.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { configuredServer, listPublicRooms, listingQuery } from "./publicServers.js";

const row = (extra = {}) => ({
  roomId: "0123456789abcdef0123456789abcdef",
  hostKey: "A".repeat(43),
  name: "Baltic Crisis",
  scenario: { id: "fault-lines", name: "Fault Lines", hash: "0".repeat(64) },
  seats: 8,
  open: 5,
  round: { minutes: 20, readyThreshold: 2 / 3, countdownSeconds: 60 },
  payment: "host",
  fog: true,
  cheats: "off",
  language: "en",
  version: "1",
  password: false,
  visibility: "public",
  players: 3,
  ageSeconds: 120,
  ...extra,
});
const answer = (body, status = 200) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("no server set up: nothing is fetched", async () => {
  assert.equal(configuredServer({ getItem: () => null }), "");
  assert.equal(configuredServer({ getItem: () => "javascript:alert(1)" }), "");
  assert.equal(configuredServer({ getItem: () => "https://mp.example.org" }), "https://mp.example.org");
  let called = false;
  const result = await listPublicRooms({ server: "", fetchImpl: async () => { called = true; } });
  assert.match(result.error, /No public server/);
  assert.equal(called, false);
});

test("filters become a plain query, only the ones set", () => {
  assert.equal(listingQuery({ q: " baltic ", fog: true, minOpen: 2, cheats: "", password: undefined }, 3), "q=baltic&fog=true&minOpen=2&page=3");
  assert.equal(listingQuery({}), "");
});

test("a listing's rows are checked one by one: a bad row is left out, the rest are shown", async () => {
  const result = await listPublicRooms({
    server: "https://mp.example.org",
    fetchImpl: answer({ rooms: [row(), row({ name: "bad\u0007name" }), row({ seats: 999 }), row({ extra: true })], total: 4, page: 0 }),
  });
  assert.equal(result.rooms.length, 1);
  assert.equal(result.rooms[0].name, "Baltic Crisis");
  assert.equal(result.total, 4);
});

test("an answer that is not a listing, or tries a prototype key, or fails, is an error, never rows", async () => {
  for (const body of ["not json", JSON.stringify({ rooms: "x" }), '{"rooms":[],"total":0,"page":0,"__proto__":{"admin":true}}']) {
    const result = await listPublicRooms({ server: "https://mp.example.org", fetchImpl: answer(body) });
    assert.ok(result.error, body);
  }
  assert.match((await listPublicRooms({ server: "https://mp.example.org", fetchImpl: answer({}, 503) })).error, /503/);
  assert.match((await listPublicRooms({ server: "https://mp.example.org", fetchImpl: async () => { throw new TypeError("offline"); } })).error, /could not be reached/);
  assert.equal({}.admin, undefined);
});
