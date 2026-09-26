/*! Open Historia — a player's side of a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/gameClient.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createGameClient } from "./gameClient.js";
import { createLoopbackEngineSide, createLoopbackScreenSide } from "../transport/loopback.js";

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

test("the lobby, the round and notices are kept; views go to the page; the countdown runs on the player's own clock", () => {
  let t = 1000;
  const views = [];
  const changes = [];
  const client = createGameClient({ send: () => {}, applyView: (view) => views.push(view), onChange: (state) => changes.push(state), now: () => t });
  client.receive({ t: "lobby", started: false, seats: [], countries: [], scenario: { id: "s", name: "S", hash: "h" }, settings: {} });
  client.receive({ t: "round", phase: "planning", round: 1, remainingMs: 60_000, paused: false, ready: [], counted: 2, needed: 2 });
  client.receive({ t: "notice", level: "info", text: "Russia is now played by the AI." });
  client.receive({ t: "view", rev: 3, docs: { game: { country: "X" } } });
  assert.equal(client.state.round.phase, "planning");
  assert.equal(client.state.notices[0].text, "Russia is now played by the AI.");
  assert.deepEqual(views, [{ rev: 3, docs: { game: { country: "X" } } }]);
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
  screen.hello("device-host", "Host");
  screen.request({ t: "ready", id: "0123456789abcdef", value: true });
  screen.request({ t: "ready", id: "0123456789abcdef", value: true, isHost: true }); // not a request
  screen.control("start");
  screen.control("becomeGod");
  engine.send({ t: "notice", level: "info", text: "Round 2 begins." });
  engine.send({ t: "notice", level: "loud", text: "not a message" });
  engine.status({ token: "oh1-abc", players: 2 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(seen.hello, { device: "device-host", name: "Host" });
  assert.deepEqual(seen.requests, [{ t: "ready", id: "0123456789abcdef", value: true }]);
  assert.deepEqual(seen.controls, [["start", null]]);
  assert.deepEqual(seen.messages, [{ t: "notice", level: "info", text: "Round 2 begins." }]);
  assert.deepEqual(seen.statuses, [{ token: "oh1-abc", players: 2 }]);
  engine.close();
  screen.close();
});
