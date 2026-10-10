/*! Open Historia — tests for the public multiplayer server's HTTP side © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/http.test.js
//
// GET /healthz and GET /api/rooms, and nothing else. The listing is the same
// as the socket's, with the same filters spelled as a query string; pages from
// allowed origins may read it (CORS), others get no CORS header; requests with
// bodies, long URLs and floods are refused.

import test from "node:test";
import assert from "node:assert/strict";
import { ORIGIN, connect, hostIdentity, hostRoom, httpRequest, manualClock, startServer } from "./helpers.js";

test("GET /healthz says ok, with the usual safety headers", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const response = await httpRequest(server, "/healthz");
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { ok: true });
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.headers["content-security-policy"], /default-src 'none'/);
  const head = await httpRequest(server, "/healthz", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
});

test("GET /api/rooms is the socket's listing, with the same filters", async (t) => {
  // A still clock, so both listings are taken at the same moment.
  const clock = manualClock();
  const server = await startServer({ maxRoomsPerIp: 10 }, { now: clock.now });
  t.after(() => server.close());
  const foggy = (await hostRoom(server, hostIdentity(), { name: "Foggy Bottom", open: 2 })).room;
  const clear = (await hostRoom(server, hostIdentity(), { name: "Clear Skies", fog: false, cheats: "host", open: 7 })).room;
  await hostRoom(server, hostIdentity(), { visibility: "unlisted" });

  const all = await httpRequest(server, "/api/rooms");
  assert.equal(all.status, 200);
  const socketListing = await (await connect(server)).request({ t: "list" }, "rooms");
  assert.deepEqual(all.json, socketListing);
  assert.equal(all.json.total, 2);
  assert.deepEqual(all.json.rooms.map((room) => room.roomId), [foggy.roomId, clear.roomId]);

  const filtered = await httpRequest(server, "/api/rooms?fog=false&cheats=host&minOpen=5&q=CLEAR&page=0");
  assert.deepEqual(filtered.json.rooms.map((room) => room.roomId), [clear.roomId]);
  assert.equal((await httpRequest(server, "/api/rooms?fog=true")).json.rooms[0].roomId, foggy.roomId);
  assert.equal((await httpRequest(server, "/api/rooms?page=1")).json.rooms.length, 0);
  assert.equal((await httpRequest(server, "/api/rooms?language=en&password=false")).json.total, 2);
  assert.equal((await httpRequest(server, `/api/rooms?scenario=${encodeURIComponent("cold-war-1962")}`)).json.total, 2);
});

test("a listing query that is not one is a 400", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  for (const [query, why] of [
    ["fog=yes", /fog must be true or false/],
    ["fog=1", /fog must be true or false/],
    ["minOpen=-1", /minOpen must be a whole number/],
    ["minOpen=99", /outside 0\.\.64/],
    ["page=101", /outside 0\.\.100/],
    ["page=x", /page must be a whole number/],
    ["hostKey=abc", /unknown filter "hostKey"/],
    ["__proto__=1", /unknown filter "__proto__"/],
    ["fog=true&fog=false", /given more than once/],
    ["cheats=all", /not an allowed value/],
    ["language=english", /does not match its pattern/],
    [`q=${"x".repeat(61)}`, /longer than 60/],
    ["q=%00", /does not match its pattern/],
  ]) {
    const response = await httpRequest(server, `/api/rooms?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.json.code, "invalid");
    assert.match(response.json.message, why, query);
  }
});

test("CORS: an allowed origin is named back, any other gets no CORS header; no list means *", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const allowed = await httpRequest(server, "/api/rooms", { headers: { Origin: ORIGIN } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], ORIGIN);
  assert.match(allowed.headers.vary, /Origin/);
  const port = await httpRequest(server, "/api/rooms", { headers: { Origin: "http://localhost:4173" } });
  assert.equal(port.headers["access-control-allow-origin"], "http://localhost:4173");

  const foreign = await httpRequest(server, "/api/rooms", { headers: { Origin: "https://evil.example" } });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.headers["access-control-allow-origin"], undefined);
  assert.match(foreign.headers.vary, /Origin/);
  // Only the listing is shared across origins.
  assert.equal((await httpRequest(server, "/healthz", { headers: { Origin: ORIGIN } })).headers["access-control-allow-origin"], undefined);

  // Preflight.
  const preflight = await httpRequest(server, "/api/rooms", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], ORIGIN);
  assert.match(preflight.headers["access-control-allow-methods"], /GET/);
  const refused = await httpRequest(server, "/api/rooms", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(refused.status, 403);
  assert.equal(refused.headers["access-control-allow-origin"], undefined);

  const open = await startServer({ allowedOrigins: [] });
  t.after(() => open.close());
  assert.equal((await httpRequest(open, "/api/rooms", { headers: { Origin: "https://evil.example" } })).headers["access-control-allow-origin"], "*");
});

test("everything else is a 404; bodies, long URLs and floods are refused", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now, limits: { requestBurst: 40 } });
  t.after(() => server.close());
  for (const [method, path] of [
    ["GET", "/"], ["GET", "/api"], ["GET", "/api/rooms/"], ["GET", "/api/rooms/abc"], ["GET", "/ws"], ["GET", "/.env"],
    ["DELETE", "/api/rooms"], ["PUT", "/healthz"], ["GET", "/healthz/../api/rooms/x"],
  ]) {
    const response = await httpRequest(server, path, { method });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(response.json.code, "not-found");
  }
  const posted = await httpRequest(server, "/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(posted.status, 413);
  assert.equal((await httpRequest(server, `/api/rooms?q=${"a".repeat(3000)}`)).status, 414);

  // The request rate per address: this server allows bursts of 40.
  let limited = null;
  for (let index = 0; index < 60 && !limited; index += 1) {
    const response = await httpRequest(server, "/healthz");
    if (response.status === 429) limited = response;
  }
  assert.ok(limited, "never rate-limited");
  assert.equal(limited.headers["retry-after"], "1");
  clock.advance(1000);
  assert.equal((await httpRequest(server, "/healthz")).status, 200);
});
