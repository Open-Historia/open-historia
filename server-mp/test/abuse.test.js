/*! Open Historia — tests for what the public server does with hostile clients © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/abuse.test.js
//
// What a modified client or a script could throw at the server: frames too
// big, text that is not JSON, JSON that reaches for a prototype, messages
// nobody defined, floods, pages from other sites, and more sockets than one
// address should have. Each is refused, the refusals add up to a closed
// socket, and nothing leaks into the log that should not.

import test from "node:test";
import assert from "node:assert/strict";
import { connect, hostRoom, manualClock, offerPayload, startServer, until, wait } from "./helpers.js";

test("a frame over 64 KiB closes the socket (1009) before it is buffered", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = await connect(server);
  client.send(JSON.stringify({ t: "ping", n: 1, pad: "x".repeat(70_000) }));
  assert.equal((await client.closedWithin()).code, 1009);
});

test("malformed text, prototype keys, unknown types, invalid messages and binary frames: an error and a strike each, then 1008", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = await connect(server);
  const replies = [];
  for (const frame of [
    "{not json",
    '{"t":"ping","n":1,"__proto__":{"polluted":true}}',
    '{"t":"host","v":1,"room":{"constructor":{"prototype":{"polluted":true}}},"ts":1,"sig":"x"}',
    '{"t":"admin","grant":"everything"}',
    '{"t":"ping","n":1,"extra":true}',
  ]) {
    const reply = client.next("error");
    client.send(frame);
    replies.push(await reply);
  }
  assert.deepEqual(replies.map((reply) => reply.code), ["bad-json", "bad-json", "bad-json", "unknown-type", "invalid"]);
  // The keys that reach a prototype are refused by name, at parsing, before
  // any schema or handler could copy them anywhere.
  assert.match(replies[1].message, /forbidden key "__proto__"/);
  assert.match(replies[2].message, /forbidden key "(constructor|prototype)"/);
  assert.equal((await client.closedWithin()).code, 1008);

  // Binary frames, deep nesting and a non-object each count too.
  const second = await connect(server);
  const more = [];
  for (const frame of [Buffer.from([1, 2, 3]), `${"[".repeat(40)}${"]".repeat(40)}`, "[1,2,3]", '"ping"', '{"t":"toString"}']) {
    const reply = second.next("error");
    second.send(frame);
    more.push((await reply).code);
  }
  assert.deepEqual(more, ["bad-frame", "bad-json", "unknown-type", "unknown-type", "unknown-type"]);
  assert.equal((await second.closedWithin()).code, 1008);
});

test("the error names what was wrong, and a good message after a bad one still works", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = await connect(server);
  const reply = await client.request({ t: "list", filters: { secret: 1 } }, "rooms");
  assert.equal(reply.code, "invalid");
  assert.match(reply.message, /unexpected key "secret"/);
  assert.deepEqual(await client.request({ t: "ping", n: 7 }, "pong"), { t: "pong", n: 7 });
});

test("more than 20 messages a second (bursts of 40) earns strikes, and the fifth closes the socket", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const client = await connect(server);
  const received = [];
  client.ws.on("message", (data) => received.push(JSON.parse(data.toString())));
  for (let n = 0; n < 60; n += 1) client.send({ t: "ping", n });
  const { code } = await client.closedWithin();
  assert.equal(code, 1008);
  assert.equal(received.filter((message) => message.t === "pong").length, 40);
  const errors = received.filter((message) => message.t === "error");
  assert.equal(errors.length, 5);
  assert.ok(errors.every((error) => error.code === "rate-limited"));
  // Nothing after the close was answered.
  assert.equal(received.length, 45);
});

test("the bucket refills at 20 a second", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const client = await connect(server);
  for (let n = 0; n < 40; n += 1) client.send({ t: "ping", n });
  await until(() => client.inbox.length === 40);
  assert.ok(client.inbox.splice(0).every((message) => message.t === "pong"));
  assert.equal((await client.request({ t: "ping", n: 40 }, "pong")).code, "rate-limited");
  clock.advance(100);
  assert.deepEqual(await client.request({ t: "ping", n: 41 }, "pong"), { t: "pong", n: 41 });
  assert.deepEqual(await client.request({ t: "ping", n: 42 }, "pong"), { t: "pong", n: 42 });
  assert.equal((await client.request({ t: "ping", n: 43 }, "pong")).code, "rate-limited");
});

test("a page from an origin not on the list cannot connect; nor can a client with no Origin", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  await assert.rejects(connect(server, { origin: "https://evil.example" }), { status: 403 });
  await assert.rejects(connect(server, { origin: "https://app.paxhistoria" }), { status: 403 });
  await assert.rejects(connect(server, { origin: null }), { status: 403 });
  await assert.rejects(connect(server, { origin: "null" }), { status: 403 });
  // On the list: exact, and any port of localhost.
  await (await connect(server, { origin: "http://app.paxhistoria" })).close();
  await (await connect(server, { origin: "http://localhost:5173" })).close();
  // Anything but /ws is not a socket.
  await assert.rejects(connect(server, { path: "/api/rooms" }), { status: 404 });
  await assert.rejects(connect(server, { path: "/ws/extra" }), { status: 404 });

  const open = await startServer({ allowedOrigins: [] });
  t.after(() => open.close());
  await (await connect(open, { origin: "https://anywhere.example" })).close();
  await (await connect(open, { origin: null })).close();
});

test("sockets per address and in all are capped at the upgrade", async (t) => {
  const server = await startServer({ maxConnectionsPerIp: 2, maxConnections: 100 });
  t.after(() => server.close());
  const first = await connect(server);
  const second = await connect(server);
  await assert.rejects(connect(server), { status: 429 });
  // A closed socket frees its place.
  await first.close();
  const freed = await until(async () => {
    try {
      await (await connect(server)).close();
      return true;
    } catch {
      return false;
    }
  });
  assert.ok(freed, "a closed socket never gave its place back");
  await second.close();

  const small = await startServer({ maxConnectionsPerIp: 10, maxConnections: 2 });
  t.after(() => small.close());
  await connect(small);
  await connect(small);
  await assert.rejects(connect(small), { status: 503 });
});

test("upgrades and requests from one address are rate-limited", async (t) => {
  const clock = manualClock();
  const server = await startServer({ maxConnectionsPerIp: 100 }, { now: clock.now, limits: { requestBurst: 3 } });
  t.after(() => server.close());
  for (let index = 0; index < 3; index += 1) await connect(server);
  await assert.rejects(connect(server), { status: 429 });
  clock.advance(1000);
  await connect(server);
});

test("behind the proxy, the address is the last X-Forwarded-For entry, never the first", async (t) => {
  const server = await startServer({ trustProxy: true, maxConnectionsPerIp: 1 });
  t.after(() => server.close());
  // The client wrote the first entries; the proxy appended the last.
  await connect(server, { headers: { "X-Forwarded-For": "1.1.1.1, 203.0.113.7" } });
  await assert.rejects(connect(server, { headers: { "X-Forwarded-For": "9.9.9.9, 203.0.113.7" } }), { status: 429 });
  await connect(server, { headers: { "X-Forwarded-For": "203.0.113.7, 198.51.100.4" } });
  // One IPv6 /64 is one address.
  await connect(server, { headers: { "X-Forwarded-For": "2001:db8:1:2::1" } });
  await assert.rejects(connect(server, { headers: { "X-Forwarded-For": "2001:db8:1:2:ffff::9" } }), { status: 429 });
  await connect(server, { headers: { "X-Forwarded-For": "2001:db8:1:3::1" } });

  // Without TRUST_PROXY the header is ignored: every one of these is 127.0.0.1.
  const direct = await startServer({ maxConnectionsPerIp: 1 });
  t.after(() => direct.close());
  await connect(direct, { headers: { "X-Forwarded-For": "1.1.1.1" } });
  await assert.rejects(connect(direct, { headers: { "X-Forwarded-For": "2.2.2.2" } }), { status: 429 });
});

test("the log has a line per event, tags instead of addresses, and nothing a player wrote", async (t) => {
  const server = await startServer({ trustProxy: true });
  t.after(() => server.close());
  const headers = { "X-Forwarded-For": "198.51.100.23" };
  const { client: host, room } = await hostRoom(server, undefined, { name: "Secret Plans of Nicholas" }, { connectOptions: { headers } });
  const joiner = await connect(server, { headers });
  joiner.send({ t: "signal", roomId: room.roomId, to: "host", payload: { t: "offer", v: 1, session: "ab".repeat(16), sdp: "v=0\r\ns=private sdp\r\n", device: "A".repeat(43), name: "Player Name", version: "1", ts: Date.now() } });
  await host.next("signal");
  joiner.send("{not json");
  await joiner.next("error");
  await assert.rejects(connect(server, { origin: "https://evil.example", headers }), { status: 403 });
  await joiner.close();
  await wait(50);

  const log = server.lines.join("\n");
  for (const event of ["server.start", "conn.open", "room.hosted", "signal.offer", "conn.strike", "upgrade.refused", "conn.close"]) {
    assert.match(log, new RegExp(` ${event.replace(".", "\\.")}( |$)`, "m"), event);
  }
  for (const secret of ["198.51.100.23", "Secret Plans", "Player Name", "private sdp", room.roomId]) {
    assert.ok(!log.includes(secret), `the log contains ${secret}`);
  }
  // The start line names the address the server listens on; no other line
  // has an address in it, the proxy's included.
  const clientLines = server.lines.filter((line) => !line.includes(" server.start "));
  assert.ok(!clientLines.join("\n").includes("127.0.0.1"));
  assert.match(log, /ip=#[0-9a-f]{12}/);
  assert.match(log, new RegExp(`room=${room.roomId.slice(0, 8)}`));
  // One line per event, each starting with its time.
  for (const line of server.lines) assert.match(line, /^\d{4}-\d\d-\d\dT[\d:.]+Z (info|warn) [a-z]+\.[a-z-]+( |$)/);
});

test("a message may come in at most four frames; more closes the socket before they pile up", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = await connect(server);
  const text = JSON.stringify({ t: "ping", n: 4 });
  const parts = [text.slice(0, 5), text.slice(5, 10), text.slice(10, 15), text.slice(15)];
  parts.forEach((part, index) => client.ws.send(part, { fin: index === parts.length - 1 }));
  assert.deepEqual(await client.next("pong"), { t: "pong", n: 4 });
  // An unfinished message in one-byte pieces: never a message, so no rate
  // limit or strike would ever see it; the fifth piece ends the socket.
  for (let index = 0; index < 5; index += 1) client.ws.send("x", { fin: false });
  assert.equal((await client.closedWithin()).code, 1008);
  assert.ok(server.lines.some((line) => / conn\.error .*code=WS_ERR_TOO_MANY_BUFFERED_PARTS/.test(line)));
});

test("pings that keep coming after the strikes run out are neither counted nor answered", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const client = await connect(server);
  for (let index = 0; index < 300; index += 1) client.ws.ping();
  await client.closedWithin();
  await wait(50);
  assert.equal(server.lines.filter((line) => / conn\.strike /.test(line)).length, 5);
  assert.equal(server.lines.filter((line) => / conn\.dropped /.test(line)).length, 1);
});

test("above MAX_MEMORY_MB the server takes no new sockets, and takes them again below it", async (t) => {
  let resident = 100 * 1024 * 1024;
  const server = await startServer({ maxMemoryMb: 128 }, { memory: () => resident });
  t.after(() => server.close());
  await (await connect(server)).close();
  resident = 129 * 1024 * 1024;
  await assert.rejects(connect(server), { status: 503 });
  assert.ok(server.lines.some((line) => / upgrade\.refused .*reason=memory/.test(line)));
  resident = 100 * 1024 * 1024;
  await (await connect(server)).close();
});

test("an IPv6 /48 holds four addresses' worth of sockets, however many /64s it has", async (t) => {
  const server = await startServer({ trustProxy: true, maxConnectionsPerIp: 1 });
  t.after(() => server.close());
  for (const subnet of ["1", "2", "3", "4"]) await connect(server, { headers: { "X-Forwarded-For": `2001:db8:7:${subnet}::1` } });
  await assert.rejects(connect(server, { headers: { "X-Forwarded-For": "2001:db8:7:5::1" } }), { status: 429 });
  await connect(server, { headers: { "X-Forwarded-For": "2001:db8:8:1::1" } });
});

test("when the server has too much queued, a big reply becomes a short busy and relays are refused; small replies still go", async (t) => {
  const server = await startServer({}, { limits: { outboundBytes: 200 } });
  t.after(() => server.close());
  const { room } = await hostRoom(server);
  const browser = await connect(server);
  assert.equal((await browser.request({ t: "list" }, "rooms")).code, "busy");
  assert.deepEqual(await browser.request({ t: "ping", n: 1 }, "pong"), { t: "pong", n: 1 });
  const joiner = await connect(server);
  const refused = await joiner.request({ t: "signal", roomId: room.roomId, to: "host", payload: offerPayload() }, "error");
  assert.equal(refused.code, "busy");
});

test("a peer that does not read what is relayed to it holds up nobody but itself", async (t) => {
  const server = await startServer({}, { limits: { relayBufferedBytes: 100 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  // Any offer is bigger than this host may have waiting, so it is refused to
  // the joiner as busy; the host's socket stays open and answers its pings.
  assert.equal((await joiner.request({ t: "signal", roomId: room.roomId, to: "host", payload: offerPayload() }, "error")).code, "busy");
  assert.deepEqual(await host.request({ t: "ping", n: 9 }, "pong"), { t: "pong", n: 9 });
});
