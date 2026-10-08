/*! Open Historia — tests for passing offers and answers through the public server © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/signal.test.js
//
// An offer reaches the room's host and nobody else; the host's answer or deny
// reaches the joiner that made the offer and nobody else; nobody but the
// host's connection can answer, and nobody can take over another joiner's
// session. The relay carries signaling and nothing else: one answer per
// offer, a few offers per session, SDP that is SDP, and (with TURN on) relay
// candidates only; and no one socket or address can use up a room.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CANDIDATES, answerPayload, connect, denyPayload, hostIdentity, hostRoom, manualClock, offerPayload, randomHex, sdpWith, startServer,
} from "./helpers.js";

const signal = (roomId, to, payload) => ({ t: "signal", roomId, to, payload });

test("an offer reaches the host; its answer reaches that joiner alone", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  const bystander = await connect(server);

  const offer = offerPayload();
  joiner.send(signal(room.roomId, "host", offer));
  const delivered = await host.next("signal");
  assert.deepEqual(delivered, { t: "signal", roomId: room.roomId, from: offer.session, payload: offer });

  const answer = answerPayload(offer.session);
  host.send(signal(room.roomId, offer.session, answer));
  assert.deepEqual(await joiner.next("signal"), { t: "signal", roomId: room.roomId, from: "host", payload: answer });
  assert.equal(await bystander.quiet(), null);

  // The joiner repeats its offer until it hears back; each copy gets through,
  // and so does a deny.
  joiner.send(signal(room.roomId, "host", { ...offer, ts: Date.now() }));
  assert.equal((await host.next("signal")).from, offer.session);
  const deny = denyPayload(offer.session, "full");
  host.send(signal(room.roomId, offer.session, deny));
  assert.deepEqual((await joiner.next("signal")).payload, deny);
  assert.equal(await host.quiet(), null);
});

test("unlisted rooms are reached by their id like public ones", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server, hostIdentity(), { visibility: "unlisted" });
  const joiner = await connect(server);
  const offer = offerPayload();
  joiner.send(signal(room.roomId, "host", offer));
  assert.equal((await host.next("signal")).from, offer.session);
});

test("only the host's connection answers, only for a session it was offered, only to that joiner", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  const other = await connect(server);
  const offer = offerPayload();
  joiner.send(signal(room.roomId, "host", offer));
  await host.next("signal");

  // Someone else answers as if they were the host.
  const fake = await other.request(signal(room.roomId, offer.session, answerPayload(offer.session)), "error");
  assert.equal(fake.code, "not-host");
  // The host answers a session nobody offered.
  const nobody = randomHex(16);
  assert.equal((await host.request(signal(room.roomId, nobody, answerPayload(nobody)), "error")).code, "unknown-session");
  // The host addresses one session with a payload for another.
  assert.equal((await host.request(signal(room.roomId, offer.session, answerPayload(nobody)), "error")).code, "session-mismatch");
  // The host sends an offer, or a joiner sends an answer to the host.
  assert.equal((await host.request(signal(room.roomId, offer.session, offerPayload(offer.session)), "error")).code, "wrong-payload");
  assert.equal((await joiner.request(signal(room.roomId, "host", answerPayload(offer.session)), "error")).code, "wrong-payload");
  // Another connection offers on the joiner's session, to have the answer sent to it.
  assert.equal((await other.request(signal(room.roomId, "host", offerPayload(offer.session)), "error")).code, "session-taken");
  // The host offers to its own room.
  assert.equal((await host.request(signal(room.roomId, "host", offerPayload()), "error")).code, "own-room");
  // A room that is not there.
  assert.equal((await joiner.request(signal(randomHex(16), "host", offerPayload()), "error")).code, "unknown-room");
  assert.equal((await host.request(signal(randomHex(16), offer.session, answerPayload(offer.session)), "error")).code, "unknown-room");

  // None of that reached the joiner, and the real answer still does.
  assert.equal(joiner.inbox.length, 0);
  host.send(signal(room.roomId, offer.session, answerPayload(offer.session)));
  assert.equal((await joiner.next("signal")).from, "host");
  assert.equal(other.inbox.length, 0);
});

test("a session lasts two minutes, and goes when its joiner leaves", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server, hostIdentity(), {}, { ts: clock.now() });

  const patient = await connect(server);
  const early = offerPayload();
  patient.send(signal(room.roomId, "host", early));
  await host.next("signal");
  clock.advance(2 * 60_000 + 1);
  assert.equal((await host.request(signal(room.roomId, early.session, answerPayload(early.session)), "error")).code, "unknown-session");

  const leaver = await connect(server);
  const gone = offerPayload();
  leaver.send(signal(room.roomId, "host", gone));
  await host.next("signal");
  await leaver.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await host.request(signal(room.roomId, gone.session, answerPayload(gone.session)), "error")).code, "unknown-session");
});

test("a joiner holds only a few sessions at once: the oldest makes way", async (t) => {
  const server = await startServer({}, { limits: { sessionsPerConnection: 2 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  const sessions = [offerPayload(), offerPayload(), offerPayload()];
  for (const offer of sessions) {
    joiner.send(signal(room.roomId, "host", offer));
    await host.next("signal");
  }
  const [oldest, middle, newest] = sessions.map((offer) => offer.session);
  assert.equal((await host.request(signal(room.roomId, oldest, answerPayload(oldest)), "error")).code, "unknown-session");
  host.send(signal(room.roomId, middle, answerPayload(middle)));
  host.send(signal(room.roomId, newest, answerPayload(newest)));
  assert.equal((await joiner.next("signal")).payload.session, middle);
  assert.equal((await joiner.next("signal")).payload.session, newest);
});

test("a room takes only so many offers a second, from everyone together", async (t) => {
  const clock = manualClock();
  const server = await startServer({ maxConnectionsPerIp: 20 }, { now: clock.now, limits: { offerBurst: 3, offersPerSecond: 1 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server, hostIdentity(), {}, { ts: clock.now() });
  const joiners = await Promise.all([1, 2, 3, 4].map(() => connect(server)));
  for (const joiner of joiners.slice(0, 3)) {
    joiner.send(signal(room.roomId, "host", offerPayload()));
    await host.next("signal");
  }
  assert.equal((await joiners[3].request(signal(room.roomId, "host", offerPayload()), "error")).code, "busy");
  clock.advance(1000);
  joiners[3].send(signal(room.roomId, "host", offerPayload()));
  assert.equal((await host.next("signal")).t, "signal");
});

test("one answer or deny per offer: the relay is not a pipe", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  const offer = offerPayload();
  joiner.send(signal(room.roomId, "host", offer));
  await host.next("signal");
  host.send(signal(room.roomId, offer.session, answerPayload(offer.session)));
  await joiner.next("signal");
  // A second answer to the same offer is refused, and never arrives.
  assert.equal((await host.request(signal(room.roomId, offer.session, answerPayload(offer.session)), "error")).code, "no-offer");
  assert.equal(await joiner.quiet(), null);
  // A repeated offer earns one more (the host re-sends its answer), and only one.
  joiner.send(signal(room.roomId, "host", { ...offer, ts: Date.now() }));
  await host.next("signal");
  host.send(signal(room.roomId, offer.session, denyPayload(offer.session)));
  assert.equal((await joiner.next("signal")).payload.t, "deny");
  assert.equal((await host.request(signal(room.roomId, offer.session, denyPayload(offer.session)), "error")).code, "no-offer");
});

test("a session carries only so many offers", async (t) => {
  const clock = manualClock();
  const server = await startServer({}, { now: clock.now, limits: { offersPerSession: 3 } });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server, hostIdentity(), {}, { ts: clock.now() });
  const joiner = await connect(server);
  const offer = offerPayload();
  for (let index = 0; index < 3; index += 1) {
    joiner.send(signal(room.roomId, "host", offer));
    await host.next("signal");
    clock.advance(5000);
  }
  assert.equal((await joiner.request(signal(room.roomId, "host", offer), "error")).code, "session-spent");
  // A new session is a new start.
  joiner.send(signal(room.roomId, "host", offerPayload()));
  assert.equal((await host.next("signal")).t, "signal");
});

test("no one socket, and no one address, can use up a room's offers", async (t) => {
  const clock = manualClock();
  const server = await startServer({ trustProxy: true, maxConnectionsPerIp: 20 }, { now: clock.now });
  t.after(() => server.close());
  const from = (address) => connect(server, { headers: { "X-Forwarded-For": address } });
  const { client: host, room } = await hostRoom(server, hostIdentity(), {}, {
    ts: clock.now(), connectOptions: { headers: { "X-Forwarded-For": "192.0.2.1" } },
  });
  const delivered = async (socket) => {
    socket.send(signal(room.roomId, "host", offerPayload()));
    await host.next("signal");
  };

  // One socket: four offers at once, then one every two seconds; a fifth now
  // is refused, and a strike.
  const flooder = await from("198.51.100.1");
  for (let index = 0; index < 4; index += 1) await delivered(flooder);
  assert.equal((await flooder.request(signal(room.roomId, "host", offerPayload()), "error")).code, "rate-limited");
  // One address: eight at once across all its sockets.
  const second = await from("198.51.100.1");
  for (let index = 0; index < 4; index += 1) await delivered(second);
  const third = await from("198.51.100.1");
  assert.equal((await third.request(signal(room.roomId, "host", offerPayload()), "error")).code, "busy");
  // Everyone else still gets in.
  const player = await from("203.0.113.50");
  const offer = offerPayload();
  player.send(signal(room.roomId, "host", offer));
  assert.equal((await host.next("signal")).from, offer.session);
});

test("an SDP must be SDP: v=0 first, printable lines, not too many or too long", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  for (const sdp of [
    "hello there, this is not SDP",
    "v=0\r\ns=\u0001binary\r\n",
    `v=0\r\na=${"x".repeat(300)}\r\n`,
    `v=0\r\n${"a=x\r\n".repeat(120)}`,
    "v=0\r\nnot a line\r\n",
  ]) {
    const reply = await joiner.request(signal(room.roomId, "host", offerPayload(randomHex(16), { sdp })), "error");
    assert.equal(reply.code, "bad-sdp", JSON.stringify(sdp.slice(0, 30)));
  }
  assert.equal(host.inbox.length, 0);
});

test("with TURN on, offers and answers carry relay candidates only, naming no client address", async (t) => {
  const server = await startServer({ turnSecret: "0123456789abcdef".repeat(4), turnUrls: ["turn:turn.example.org:3478"] });
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  for (const candidate of [CANDIDATES.host, CANDIDATES.srflx, CANDIDATES.relayNamingClient]) {
    const reply = await joiner.request(signal(room.roomId, "host", offerPayload(randomHex(16), { sdp: sdpWith(CANDIDATES.relay, candidate) })), "error");
    assert.equal(reply.code, "bad-sdp");
  }
  assert.equal(host.inbox.length, 0);
  const offer = offerPayload(randomHex(16), { sdp: sdpWith(CANDIDATES.relay) });
  joiner.send(signal(room.roomId, "host", offer));
  assert.equal((await host.next("signal")).payload.sdp, offer.sdp);
  // The host is held to the same.
  const leaky = answerPayload(offer.session, { sdp: sdpWith(CANDIDATES.host) });
  assert.equal((await host.request(signal(room.roomId, offer.session, leaky), "error")).code, "bad-sdp");
  host.send(signal(room.roomId, offer.session, answerPayload(offer.session, { sdp: sdpWith(CANDIDATES.relay) })));
  assert.equal((await joiner.next("signal")).payload.t, "answer");
});

test("with TURN off (development), direct candidates pass", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const { client: host, room } = await hostRoom(server);
  const joiner = await connect(server);
  const offer = offerPayload(randomHex(16), { sdp: sdpWith(CANDIDATES.host, CANDIDATES.srflx) });
  joiner.send(signal(room.roomId, "host", offer));
  assert.equal((await host.next("signal")).from, offer.session);
});
