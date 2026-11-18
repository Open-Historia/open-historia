/*! Open Historia — a player's side of a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/gameClient.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createGameClient } from "./gameClient.js";
import { ALIVE_MS, GONE_MS, createLoopbackEngineSide, createLoopbackScreenSide } from "../transport/loopback.js";

const manualTimers = () => {
  const pending = new Map();
  let next = 1;
  return {
    timers: {
      setTimeout: (fn) => {
        const id = next++;
        pending.set(id, fn);
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    fireAll: () => {
      for (const [id, fn] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
  };
};

test("a request goes out checked, and resolves when the host answers it", async () => {
  const sent = [];
  const client = createGameClient({ send: (message) => sent.push(message) });
  const answer = client.request("order", { text: "Hold the line at Narva." });
  assert.equal(sent.length, 1);
  assert.match(sent[0].id, /^[0-9a-f]{16}$/);
  client.receive({ t: "ack", id: sent[0].id, ok: false, error: "Orders are taken while a round is being planned." });
  assert.deepEqual(await answer, { ok: false, error: "Orders are taken while a round is being planned." });

  const bad = await client.request("order", { text: "" });
  assert.equal(bad.ok, false, "refused before it is sent");
  assert.equal(sent.length, 1);
  const unknown = await client.request("becomeHost", {});
  assert.equal(unknown.ok, false);
});

test("an unanswered request gives up with a reason, and leaving answers every one still waiting", async () => {
  const clock = manualTimers();
  const client = createGameClient({ send: () => {}, timers: clock.timers });
  const first = client.request("ready", { value: true });
  clock.fireAll();
  assert.deepEqual(await first, { ok: false, error: "The host did not answer." });
  const second = client.request("ready", { value: false });
  client.close();
  assert.equal((await second).ok, false);
  assert.equal((await client.request("ready", { value: true })).error, "Not connected to a shared game.");
});

test("a request the host holds for the round has no deadline: it waits for its answer, and the screens are told what waits", async () => {
  // Each screen used to set its own deadline, blind to the round: 30 seconds
  // for an institution, and the player was told it failed while the host
  // applied it when the round landed (the review of 2026-11-18, door 1).
  const clock = manualTimers();
  const sent = [];
  const held = [];
  const client = createGameClient({ send: (message) => sent.push(message), timers: clock.timers, onHeld: (kinds) => held.push(kinds) });
  const founding = client.request("institution", { call: "lifecycle", args: { command: { type: "found", name: "Baltic Pact" } } });
  const other = client.request("ready", { value: true });
  client.receive({ t: "held", id: sent[0].id });
  client.receive({ t: "held", id: sent[0].id });
  assert.deepEqual(held, [["institution"]], "said once");
  // However long the round takes.
  clock.fireAll();
  assert.deepEqual(await other, { ok: false, error: "The host did not answer." }, "one not held still has the one deadline every request has");
  let settled = false;
  void founding.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "still waiting");
  client.receive({ t: "ack", id: sent[0].id, ok: true, error: null, result: { institutionId: "baltic-pact" } });
  assert.deepEqual(await founding, { ok: true, error: "", result: { institutionId: "baltic-pact" } });
  assert.deepEqual(held.at(-1), [], "nothing waits any more");
  // A deadline a screen still asks for is not one: every request waits alike.
  const asked = client.request("sheet", { country: "Estonia" }, { timeoutMs: 1 });
  client.receive({ t: "held", id: sent.at(-1).id });
  clock.fireAll();
  client.receive({ t: "ack", id: sent.at(-1).id, ok: true, error: null });
  assert.equal((await asked).ok, true);
  client.close();
});

test("the lobby, the round and notices are kept; views go to the page; the countdown runs on the player's own clock", () => {
  let t = 1000;
  const views = [];
  const changes = [];
  const client = createGameClient({ send: () => {}, applyView: (view) => views.push(view), onChange: (state) => changes.push(state), now: () => t });
  client.receive({ t: "lobby", started: false, seats: [], countries: [], scenario: { id: "s", name: "S", hash: "h" }, settings: {} });
  client.receive({ t: "round", phase: "planning", round: 1, remainingMs: 60_000, paused: false, ready: [], counted: 2, needed: 2 });
  client.receive({ t: "notice", level: "info", text: "Russia is now played by the AI." });
  client.receive({ t: "view", epoch: "e1", rev: 3, base: 2, docs: { game: { country: "X" } }, sums: { world: "a" } });
  assert.equal(client.state.round.phase, "planning");
  assert.equal(client.state.notices[0].text, "Russia is now played by the AI.");
  assert.deepEqual(views, [{ epoch: "e1", rev: 3, base: 2, docs: { game: { country: "X" } }, sums: { world: "a" } }]);
  t += 15_000;
  assert.equal(client.remainingMs(), 45_000);
  assert.equal(changes.length, 3);
});

test("the loopback carries the screen's requests and controls to the engine, and the engine's messages back, checked both ways", async () => {
  const seen = { hello: null, requests: [], controls: [], messages: [], statuses: [] };
  const engine = createLoopbackEngineSide({
    onHello: (hello) => { seen.hello = hello; },
    onRequest: (request) => seen.requests.push(request),
    onControl: (action, args) => seen.controls.push([action, args]),
  });
  const screen = createLoopbackScreenSide({
    onMessage: (message) => seen.messages.push(message),
    onStatus: (status) => seen.statuses.push(status),
  });
  // Closed whatever happens: an open channel keeps the test file running.
  try {
  screen.hello("device-host", "Host");
  screen.request({ t: "ready", id: "0123456789abcdef", value: true });
  screen.request({ t: "ready", id: "0123456789abcdef", value: true, isHost: true }); // not a request
  screen.control("start");
  screen.control("becomeGod");
  // An optional field left undefined is left out, not the control refused:
  // the host's page coming back after a reload opens with no settings.
  screen.control("open", { settings: undefined, name: "Host" });
  // The last word each way is a valid one: once it has arrived, everything sent
  // before it on that side has too, so what was dropped was dropped (a fixed
  // wait was too short on a busy machine).
  screen.control("pause");
  engine.send({ t: "notice", level: "info", text: "Round 2 begins." });
  engine.send({ t: "notice", level: "loud", text: "not a message" });
  engine.status({ token: "oh1-abc", players: 2 });
  for (let waited = 0; waited < 10_000 && !(seen.controls.some(([action]) => action === "pause") && seen.statuses.length); waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(seen.hello, { device: "device-host", name: "Host" });
  assert.deepEqual(seen.requests, [{ t: "ready", id: "0123456789abcdef", value: true }]);
  assert.deepEqual(seen.controls, [["start", null], ["open", { name: "Host" }], ["pause", null]]);
  assert.deepEqual(seen.messages, [{ t: "notice", level: "info", text: "Round 2 begins." }]);
  assert.deepEqual(seen.statuses, [{ token: "oh1-abc", players: 2 }]);
  } finally {
    engine.close();
    screen.close();
  }
});

test("a closed loopback end goes quiet: a late status or parting word is dropped, not thrown", async () => {
  const statuses = [];
  const engine = createLoopbackEngineSide({});
  const screen = createLoopbackScreenSide({ onStatus: (status) => statuses.push(status) });
  engine.close();
  assert.doesNotThrow(() => engine.status({ open: false }));
  assert.doesNotThrow(() => engine.send({ t: "notice", level: "info", text: "late" }));
  screen.close();
  assert.doesNotThrow(() => screen.bye());
  assert.doesNotThrow(() => screen.control("stop"));
  assert.doesNotThrow(() => {
    engine.close();
    screen.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(statuses, []);
});

test("a request not yet answered goes again with its own id after a reconnect, and is settled by one answer", async () => {
  const sent = [];
  const client = createGameClient({ send: (message) => sent.push(message), timers: globalThis });
  const asked = client.request("order", { text: "Hold the line at Narva" });
  assert.equal(sent.length, 1);
  assert.equal(client.resend(), 1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], "the same request, the same id");
  client.receive({ t: "ack", id: sent[0].id, ok: true, error: null });
  assert.deepEqual(await asked, { ok: true, error: "" });
  assert.equal(client.resend(), 0, "nothing left to send");
  client.close();
});

// Heartbeats are driven by hand: each end's interval is caught and called.
const handTimers = () => {
  const beats = [];
  return {
    beats,
    timers: { setInterval: (fn) => { beats.push(fn); return beats.length; }, clearInterval: () => {} },
  };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test("each end of the loopback says it is there, and takes the other for gone when it falls quiet", async () => {
  let t = 1_000;
  const now = () => t;
  const engineBeats = handTimers();
  const screenBeats = handTimers();
  let byes = 0;
  let gone = 0;
  const engine = createLoopbackEngineSide({ onBye: () => { byes += 1; }, timers: engineBeats.timers, now });
  const screen = createLoopbackScreenSide({ onGone: () => { gone += 1; }, timers: screenBeats.timers, now });
  // Closed whatever happens: an open channel keeps the test file running.
  try {
  // Nobody is taken for gone before they have been heard.
  t += GONE_MS * 2;
  engineBeats.beats[0]();
  screenBeats.beats[0]();
  assert.deepEqual([byes, gone], [0, 0]);
  screen.hello("device-host", "Host");
  await settle();
  engineBeats.beats[0]();
  await settle();
  // Both alive: each heard the other's word.
  t += ALIVE_MS;
  screenBeats.beats[0]();
  await settle();
  engineBeats.beats[0]();
  assert.deepEqual([byes, gone], [0, 0]);
  // The screen falls quiet (a page that froze or crashed says no bye).
  t += GONE_MS + 1;
  engineBeats.beats[0]();
  assert.equal(byes, 1, "the engine treats it as a screen that left");
  engineBeats.beats[0]();
  assert.equal(byes, 1, "once");
  // The engine falls quiet.
  screenBeats.beats[0]();
  assert.equal(gone, 1, "the screen says the engine window stopped");
  screenBeats.beats[0]();
  assert.equal(gone, 1, "once");
  } finally {
    engine.close();
    screen.close();
  }
});
