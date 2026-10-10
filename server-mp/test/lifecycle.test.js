/*! Open Historia — tests for rooms and sockets over time on the public server © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/lifecycle.test.js
//
// A room outlives its host's connection by a short grace, in which the same
// host key can take it back from a new connection; then it goes. Sockets that
// stop answering pings are dropped, idle ones are closed, and nothing a
// socket does is cut short by the HTTP server's request timeout.

import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { ORIGIN, connect, hostIdentity, hostMessage, hostRoom, offerPayload, startServer, until, wait } from "./helpers.js";

const listed = async (server) => {
  const browser = await connect(server);
  const reply = await browser.request({ t: "list" }, "rooms");
  await browser.close();
  return reply.rooms.map((room) => room.roomId);
};

test("a room stays listed through the grace after its host drops, refusing offers, then goes", async (t) => {
  const server = await startServer({}, { timing: { graceMs: 400 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  await host.close();
  await wait(50);
  assert.deepEqual(await listed(server), [room.roomId]);
  const joiner = await connect(server);
  assert.equal((await joiner.request({ t: "signal", roomId: room.roomId, to: "host", payload: offerPayload() }, "error")).code, "host-away");
  await wait(500);
  assert.deepEqual(await listed(server), []);
  assert.equal((await joiner.request({ t: "signal", roomId: room.roomId, to: "host", payload: offerPayload() }, "error")).code, "unknown-room");
  assert.ok(server.lines.some((line) => / room\.removed .*reason=expired/.test(line)));
});

test("the same host key takes its room back from a new connection within the grace", async (t) => {
  const server = await startServer({}, { timing: { graceMs: 300 } });
  t.after(() => server.close());
  const identity = hostIdentity();
  const registeredAt = Date.now();
  const { client: first, room } = await hostRoom(server, identity, {}, { ts: registeredAt });
  await first.close();
  await wait(50);

  // Another key cannot, even now: the id is not its to use.
  const thief = hostIdentity();
  const intruder = await connect(server);
  assert.equal((await intruder.request(hostMessage(thief, { ...room, hostKey: thief.hostKey }, Date.now() + 1), "hosted")).code, "invalid");
  // Nor can the first registration, played back: well signed and still
  // fresh, but not later than what the room already has.
  const replayed = await connect(server);
  assert.equal((await replayed.request(hostMessage(identity, room, registeredAt), "hosted")).code, "stale");

  const second = await connect(server);
  assert.equal((await second.request(hostMessage(identity, { ...room, open: 5 }, Date.now() + 2), "hosted")).t, "hosted");
  await wait(500);
  // Past the grace, still there, and offers now reach the new connection.
  assert.deepEqual(await listed(server), [room.roomId]);
  const joiner = await connect(server);
  const offer = offerPayload();
  joiner.send({ t: "signal", roomId: room.roomId, to: "host", payload: offer });
  assert.equal((await second.next("signal")).from, offer.session);
  assert.ok(server.lines.some((line) => / room\.reclaimed /.test(line)));
});

test("a room taken down on purpose goes at once", async (t) => {
  const server = await startServer({}, { timing: { graceMs: 60_000 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  await host.request({ t: "unhost", roomId: room.roomId }, "unhosted");
  await host.close();
  assert.deepEqual(await listed(server), []);
});

// A WebSocket handshake by hand, from a client that then never answers a ping.
const silentSocket = (server) => new Promise((resolve, reject) => {
  const socket = net.connect(server.port, "127.0.0.1", () => {
    socket.write([
      "GET /ws HTTP/1.1",
      `Host: 127.0.0.1:${server.port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
      "Sec-WebSocket-Version: 13",
      `Origin: ${ORIGIN}`,
      "", "",
    ].join("\r\n"));
  });
  const state = { closed: false, handshake: "" };
  socket.on("data", (chunk) => {
    if (!state.handshake) {
      state.handshake = chunk.toString("latin1").split("\r\n")[0];
      resolve({ socket, state });
    }
  });
  socket.on("close", () => {
    state.closed = true;
  });
  socket.on("error", reject);
  socket.setTimeout(3000, () => socket.destroy(new Error("no answer to the handshake")));
});

test("a socket that never answers a ping is dropped; one that does stays", async (t) => {
  const server = await startServer({}, { timing: { heartbeatMs: 100 } });
  t.after(() => server.close());
  const live = await connect(server);
  const { state } = await silentSocket(server);
  assert.match(state.handshake, /^HTTP\/1\.1 101 /);
  assert.ok(await until(() => state.closed, 3000), "the silent socket was never dropped");
  assert.ok(server.lines.some((line) => / conn\.dropped .*reason=no-pong/.test(line)));
  await wait(300);
  assert.deepEqual(await live.request({ t: "ping", n: 1 }, "pong"), { t: "pong", n: 1 });
});

test("a socket that says nothing at first is closed", async (t) => {
  const server = await startServer({}, { timing: { heartbeatMs: 50, firstMessageMs: 200 } });
  t.after(() => server.close());
  const silent = await connect(server);
  const talker = await connect(server);
  await talker.request({ t: "ping", n: 1 }, "pong");
  assert.equal((await silent.closedWithin()).code, 1000);
  assert.ok(server.lines.some((line) => / conn\.dropped .*reason=first-message/.test(line)));
  assert.deepEqual(await talker.request({ t: "ping", n: 2 }, "pong"), { t: "pong", n: 2 });
});

test("an idle socket is closed; one hosting a room, or waiting on a host, is not", async (t) => {
  const server = await startServer({}, { timing: { heartbeatMs: 50, idleMs: 300 } });
  t.after(() => server.close());
  const idle = await connect(server);
  await idle.request({ t: "ping", n: 0 }, "pong");
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  joiner.send({ t: "signal", roomId: room.roomId, to: "host", payload: offerPayload() });
  await host.next("signal");

  const closed = await idle.closedWithin();
  assert.equal(closed.code, 1000);
  await wait(400);
  assert.deepEqual(await host.request({ t: "ping", n: 1 }, "pong"), { t: "pong", n: 1 });
  assert.deepEqual(await joiner.request({ t: "ping", n: 2 }, "pong"), { t: "pong", n: 2 });
});

test("a host's socket that says nothing for an hour is closed, and its room follows after the grace", async (t) => {
  const server = await startServer({}, { timing: { heartbeatMs: 50, hostIdleMs: 300, graceMs: 200 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  assert.equal((await host.closedWithin()).code, 1000);
  assert.ok(server.lines.some((line) => / conn\.dropped .*reason=host-idle/.test(line)));
  await wait(400);
  assert.ok(!(await listed(server)).includes(room.roomId));
});

test("a socket outlives the HTTP server's request timeout", async (t) => {
  const server = await startServer({}, { limits: { requestTimeoutMs: 200 } });
  t.after(() => server.close());
  const client = await connect(server);
  await wait(900);
  assert.deepEqual(await client.request({ t: "ping", n: 3 }, "pong"), { t: "pong", n: 3 });
});

test("closing the server closes its sockets, going away (1001)", async () => {
  const server = await startServer();
  const client = await connect(server);
  await hostRoom(server);
  await server.close();
  assert.equal((await client.closedWithin()).code, 1001);
  assert.ok(server.lines.some((line) => / server\.stop /.test(line)));
});
