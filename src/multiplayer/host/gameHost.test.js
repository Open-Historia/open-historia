/*! Open Historia — the host's side of a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/gameHost.test.js
//
// The host with an in-memory game, a transport that records what it sends and a
// clock stepped by hand: requests are checked against seat and phase, applied
// once, answered; each player is sent its own view and only what changed; a
// round runs the time skip with everyone who plays written into the game; a
// leaver's country goes to the AI and comes back with its player.

import test from "node:test";
import assert from "node:assert/strict";

import { createGameHost, MAX_ORDERS_PER_ROUND } from "./gameHost.js";
import { normalizeSettings } from "./settings.js";

const LATVIA = "Republic of Latvia";
const RUSSIA = "Russian Federation";
const ESTONIA = "Republic of Estonia";

const createClock = (start = 1_000_000) => {
  let t = start;
  let nextId = 1;
  const pending = new Map();
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  const schedule = (fn, ms, every) => {
    const id = nextId++;
    pending.set(id, { at: t + Math.max(0, ms), fn, every });
    return id;
  };
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => schedule(fn, ms, 0),
      clearTimeout: (id) => pending.delete(id),
      setInterval: (fn, ms) => schedule(fn, ms, ms),
      clearInterval: (id) => pending.delete(id),
    },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        t = timer.at;
        if (timer.every) timer.at += timer.every;
        else pending.delete(id);
        timer.fn();
        await flush();
      }
      t = end;
      await flush();
    },
    flush,
  };
};

const createStore = () => {
  const docs = {
    game: { country: LATVIA, gameDate: "2014-04-01", round: 1 },
    world: {
      polityOverrides: Object.fromEntries([LATVIA, RUSSIA, ESTONIA].map((name) => [name, { code: name, name, status: "active" }])),
    },
    events: [],
    chat: [{ id: "chat-lv-est", countries: [{ code: ESTONIA, name: ESTONIA }], messages: [{ id: "m1", role: "user", text: "Riga to Tallinn" }] }],
    actions: [{ id: "order-lv", status: "planned", title: "Talks", text: "Open talks with Estonia" }],
    intercepts: {},
    colors: {},
    flags: {},
  };
  const update = (key) => async (fn) => {
    const next = await fn(structuredClone(docs[key]));
    if (next !== null && next !== undefined) docs[key] = next;
  };
  return {
    docs,
    read: async () => structuredClone(docs),
    updateActions: update("actions"),
    updateChats: update("chat"),
    updateWorld: update("world"),
    updateGame: update("game"),
  };
};

const setup = (options = {}) => {
  const clock = createClock();
  const store = createStore();
  const sent = [];
  const resolved = [];
  const replies = [];
  const settings = normalizeSettings({ roundMinutes: 10, countdownSeconds: 30, leaverGraceMinutes: 1, ...options.settings }).settings;
  const host = createGameHost({
    transport: { send: (id, message) => sent.push({ id, message }) },
    settings,
    hostSeat: { device: "device-host", name: "Host", country: LATVIA },
    scenario: { id: "fault-lines", name: "Fault Lines", hash: "abc" },
    countries: [LATVIA, RUSSIA, ESTONIA],
    store,
    resolveRound: async (info) => {
      resolved.push({ ...info, game: structuredClone(store.docs.game) });
      store.docs.events.push({ id: `round-${info.round}`, title: "The round's events", description: "", date: "2014-05-01" });
    },
    replyTo: async (info) => {
      replies.push(info);
    },
    now: clock.now,
    timers: clock.timers,
  });
  host.start();
  const hostPlayer = { id: "loopback", device: "device-host", name: "Host" };
  const guest = { id: "p-guest", device: "device-guest", name: "Guest" };
  const request = async (player, message) => {
    await host.receive(player, message);
    await clock.flush();
  };
  const to = (player, t) => sent.filter((entry) => entry.id === player.id && entry.message.t === t).map((entry) => entry.message);
  const ack = (player, id) => to(player, "ack").find((message) => message.id === id);
  // What a player's screen holds: every view it was sent, applied in order.
  const shown = (player) => Object.assign({}, ...to(player, "view").map((view) => view.docs));
  return { clock, store, sent, resolved, replies, host, hostPlayer, guest, request, to, ack, shown };
};

const id = (n) => n.toString(16).padStart(16, "0");

test("the lobby: the host's seat is taken, a guest picks a free country, and cannot take one already played", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.clock.flush();
  const first = s.to(s.guest, "lobby").at(-1);
  assert.deepEqual(first.seats.map((seat) => [seat.country, seat.status, seat.you]), [[LATVIA, "human", false]]);
  await s.request(s.guest, { t: "pick", id: id(1), country: LATVIA });
  assert.equal(s.ack(s.guest, id(1)).ok, false);
  await s.request(s.guest, { t: "pick", id: id(2), country: "Atlantis" });
  assert.equal(s.ack(s.guest, id(2)).error, "not-a-country");
  await s.request(s.guest, { t: "pick", id: id(3), country: RUSSIA });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  const lobby = s.to(s.guest, "lobby").at(-1);
  assert.deepEqual(lobby.seats.map((seat) => [seat.country, seat.you]), [[LATVIA, false], [RUSSIA, true]]);
  await s.request(s.hostPlayer, { t: "unpick", id: id(4) });
  assert.match(s.ack(s.hostPlayer, id(4)).error, /host plays its own/);
});

test("each player is sent its own view, and afterwards only what changed", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.clock.flush();
  const guestView = s.to(s.guest, "view").at(-1);
  assert.equal(s.shown(s.guest).game.country, RUSSIA);
  assert.deepEqual(s.shown(s.guest).actions, [], "the host's order is the host's");
  assert.deepEqual(s.shown(s.guest).chat, []);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  const hostViews = s.to(s.hostPlayer, "view").length;

  await s.request(s.guest, { t: "order", id: id(2), text: "Reinforce the garrison in Pskov." });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  const next = s.to(s.guest, "view").at(-1);
  assert.deepEqual(Object.keys(next.docs), ["actions"], "only the changed document");
  assert.equal(next.docs.actions[0].ownerCode, RUSSIA);
  assert.ok(next.rev > guestView.rev);
  assert.equal(s.to(s.hostPlayer, "view").length, hostViews, "nothing the host may see changed");
});

test("requests are held to the asker's seat and the round's phase, and a repeated one is applied once", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "order", id: id(1), text: "Anything" });
  assert.equal(s.ack(s.guest, id(1)).error, "Take a country first.");
  await s.request(s.guest, { t: "pick", id: id(2), country: RUSSIA });
  await s.request(s.guest, { t: "order", id: id(3), text: "Too early" });
  assert.match(s.ack(s.guest, id(3)).error, /while a round is being planned/);
  await s.host.control.start();
  await s.request(s.guest, { t: "order", id: id(4), text: "March on Narva" });
  await s.request(s.guest, { t: "order", id: id(4), text: "March on Narva" });
  assert.equal(s.store.docs.actions.filter((action) => action.ownerCode === RUSSIA).length, 1, "sent twice, applied once");
  await s.request(s.guest, { t: "unorder", id: id(5), order: "order-lv" });
  assert.match(s.ack(s.guest, id(5)).error, /not one of your queued orders/);
  assert.ok(s.store.docs.actions.some((action) => action.id === "order-lv"));
  for (let n = 0; n < MAX_ORDERS_PER_ROUND; n += 1) await s.request(s.guest, { t: "order", id: id(100 + n), text: `Order ${n}` });
  assert.match(s.ack(s.guest, id(100 + MAX_ORDERS_PER_ROUND - 1)).error, /At most/);
  assert.equal(s.store.docs.actions.filter((action) => action.ownerCode === RUSSIA).length, MAX_ORDERS_PER_ROUND);
});

test("diplomacy: a thread belongs to whoever opened it, the AI answers, and no one writes into another's thread", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  assert.equal(thread.messages[0].speaker, RUSSIA);
  await s.clock.flush();
  assert.deepEqual(s.replies, [{ chatId: thread.id, seat: RUSSIA }]);
  assert.deepEqual(s.shown(s.guest).chat.map((chat) => chat.id), [thread.id]);
  await s.request(s.guest, { t: "say", id: id(3), thread: "chat-lv-est", to: [], text: "Let me in." });
  assert.match(s.ack(s.guest, id(3)).error, /not in that conversation/);
  await s.request(s.guest, { t: "say", id: id(4), thread: null, to: [RUSSIA], text: "Hello me." });
  assert.match(s.ack(s.guest, id(4)).error, /does not write to itself/);
});

test("a round: everyone ready resolves it, with everyone who plays written into the game first, then new views", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  assert.equal(s.resolved.length, 0);
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  await s.clock.flush();
  assert.equal(s.resolved.length, 1);
  assert.deepEqual(s.resolved[0].humanCountries, [LATVIA, RUSSIA]);
  assert.deepEqual(s.resolved[0].game.humanCountries, [LATVIA, RUSSIA]);
  assert.equal(s.resolved[0].daysPerRound, 30);
  assert.deepEqual(s.shown(s.guest).events.map((event) => event.id), ["round-1"]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "revealing");
});

test("a leaver's country waits, goes to the AI, and comes back with its player; the host's never lapses", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  s.host.leave(s.guest);
  s.host.leave(s.hostPlayer);
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA], "away, not yet the AI's");
  await s.clock.advance(90_000);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA], "Russia is the AI's now; the host's seat stays");
  s.host.join(s.hostPlayer);
  const again = { ...s.guest, id: "p-guest-2" };
  s.host.join(again);
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  assert.equal(s.shown(again).game.country, RUSSIA);
});

test("the host can take a country back from a player, never its own", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  assert.equal(s.host.control.kick(RUSSIA), "device-guest");
  assert.equal(s.host.control.kick(LATVIA), null);
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA]);
});
