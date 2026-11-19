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

import { createGameHost, MAX_ORDERS_PER_ROUND, VIEW_ACK_MS } from "./gameHost.js";
import { GIVE_UP_MS, SLOW_MS } from "./worldQueue.js";
import { digestText } from "../protocol/digest.js";
import { startRemoteRuntime, stopRemoteRuntime } from "../client/remoteRuntime.js";
import { normalizeSettings } from "./settings.js";
import { chosenOrdersOf, generalsOf, talkOf } from "../../runtime/fronts/command.js";
import { keptPlansOf } from "../../runtime/fronts/plans.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../runtime/fronts/testKit.js";
import { HOST_MESSAGES, PLAYER_REQUESTS, REPLY_MAX_CHARS, REPLY_MAX_LINES, VIEW_KEYS, VIEW_PARTS } from "../game/messages.js";
import { validate } from "../protocol/validate.js";
import { projectForViewer } from "./projection.js";
import { resolveFeatures, setActiveFeatures } from "../../runtime/gameFeatures.js";
import { roundRulesOf } from "./hostRules.js";
import { SOCIAL_POST_MAX_CHARS } from "../../runtime/socialFeed.js";
import { ownReplyAsked } from "../client/ownReplies.js";
import { pendingSharedThread } from "../client/sharedThreads.js";
import { sessionFromRecord, sessionRecordOf } from "./sessionRecord.js";
import { advisorChangesOf } from "../game/advisorChanges.js";
import { advisorOfSeat } from "../../runtime/seatAdvisors.js";
import { PAYER_GONE_MS } from "./roundPayers.js";
import { carriedCall, carriedRequestOf, installRoundCarrier } from "../../Game/AI/roundCarrier.js";
import { createInstitutionDesk } from "./institutions.js";

const LATVIA = "Republic of Latvia";
const RUSSIA = "Russian Federation";
const ESTONIA = "Republic of Estonia";

const createClock = (start = 1_000_000) => {
  let t = start;
  let nextId = 1;
  const pending = new Map();
  // Everything the host has under way settles: a turn of the event loop runs every microtask queued before it,
  // and the ones those queue, so how many awaits a round's path has never decides what a test sees (twenty
  // microtask turns stopped being enough as rounds came to do more). The host's own timers are this clock's.
  const flush = async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
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
    // The host's own advisor conversation, every other seat's kept beside it (runtime/seatAdvisors.js).
    advisor: [{ role: "user", text: "Riga asks its advisor." }],
  };
  const update = (key) => async (fn) => {
    const next = await fn(structuredClone(docs[key]));
    if (next !== null && next !== undefined) docs[key] = next;
  };
  // The shared game's session, as the host saved it (host/sessionRecord.js).
  const shared = [];
  return {
    docs,
    shared,
    writeShared: async (record) => {
      shared.push(structuredClone(record));
    },
    read: async () => structuredClone(docs),
    updateActions: update("actions"),
    updateChats: update("chat"),
    updateWorld: update("world"),
    updateGame: update("game"),
    updateAdvisor: update("advisor"),
    // The world and the queue together, as one commit (and the event log with them).
    updateForces: async (fn) => {
      const next = await fn({ world: structuredClone(docs.world), actions: structuredClone(docs.actions), game: structuredClone(docs.game), events: structuredClone(docs.events) });
      if (!next) return;
      if (next.world) docs.world = next.world;
      if (next.actions) docs.actions = next.actions;
      if (next.events) docs.events = next.events;
    },
    // And the threads with them, as one commit (host/heldSeats.js).
    updateGameDocs: async (fn) => {
      const next = await fn({ world: structuredClone(docs.world), actions: structuredClone(docs.actions), game: structuredClone(docs.game), events: structuredClone(docs.events), chats: structuredClone(docs.chat) });
      if (!next) return;
      if (next.world) docs.world = next.world;
      if (next.actions) docs.actions = next.actions;
      if (next.events) docs.events = next.events;
      if (next.chats) docs.chat = next.chats;
      if (next.game) docs.game = next.game;
    },
  };
};

const setup = (options = {}) => {
  const clock = createClock();
  const store = createStore();
  if (options.world) store.docs.world = structuredClone(options.world);
  // A game as an earlier sitting left it.
  if (options.docs) Object.assign(store.docs, structuredClone(options.docs));
  const sent = [];
  const resolved = [];
  const replies = [];
  const sheets = [];
  const taken = [];
  const compiled = [];
  const settings = normalizeSettings({ roundMinutes: 10, countdownSeconds: 30, leaverGraceMinutes: 1, ...options.settings }).settings;
  const host = createGameHost({
    transport: { send: (id, message) => sent.push({ id, message }) },
    settings,
    hostSeat: { device: "device-host", name: "Host", country: LATVIA },
    scenario: { id: "fault-lines", name: "Fault Lines", hash: "abc" },
    countries: [LATVIA, RUSSIA, ESTONIA],
    store,
    resolveRound: async (info) => {
      // The steps the engine's skip says it is on (Game/AI/skipPhases.js), as it starts each.
      for (const step of options.steps ?? []) info.onProgress?.(step);
      // A round held in "resolving" until the test lets it go, or the host calls it off (the engine's own skip
      // honours the round's signal).
      if (options.holdResolve) {
        await Promise.race([options.holdResolve, new Promise((resolve, reject) => info.signal?.addEventListener("abort", () => reject(info.signal.reason), { once: true }))]);
      }
      // A round another player's device pays: its request carried there, and the answer awaited (host/roundPayers.js).
      if (options.carried) await options.carried(info);
      resolved.push({ ...info, game: structuredClone(store.docs.game) });
      store.docs.events.push({ id: `round-${info.round}`, title: "The round's events", description: "", date: "2014-05-01" });
      // A time skip writes the campaign's next round, as the game's own does.
      store.docs.game = { ...store.docs.game, round: (Number(store.docs.game?.round) || 0) + 1 };
      // What else the round wrote into the game.
      options.roundWrites?.(store.docs, info);
    },
    replyTo: async (info) => {
      replies.push(info);
      // What the AI governments at the table said, written into the game; and
      // what the engine says of the answer ({ unreachable }).
      return options.replyTo?.(info, store);
    },
    // The game's own reading (gameplay.js readCountryForPlayer): a sheet is
    // written for a country that has none, and one there stands.
    readCountry: async (info) => {
      sheets.push(info);
      if (info.country === ESTONIA && options.sheetFails) throw new Error("The model did not answer.");
      if (store.docs.world.countryStats?.[info.country]) return;
      store.docs.world = { ...store.docs.world, countryStats: { ...store.docs.world.countryStats, [info.country]: { capital: "A capital", stability: 50 } } };
    },
    hasSheet: async (country) => Boolean(store.docs.world.countryStats?.[country]),
    // gameplay.js takeCountryStatSheet: the first sheet to come is the sheet.
    takeSheet: async (info) => {
      taken.push(info);
      if (!info.sheet?.capital) throw new Error("Those figures are not a whole stat sheet.");
      if (store.docs.world.countryStats?.[info.country]) return { taken: false };
      store.docs.world = { ...store.docs.world, countryStats: { ...store.docs.world.countryStats, [info.country]: info.sheet } };
      return { taken: true };
    },
    ...(options.rateMilitary ? { rateMilitary: options.rateMilitary } : {}),
    ...(options.takeRatings ? { takeRatings: options.takeRatings } : {}),
    ...(options.readChart ? { readChart: options.readChart } : {}),
    ...(options.readCities ? { readCities: options.readCities } : {}),
    ...(options.setFlag ? { setFlag: options.setFlag } : {}),
    // The game's parties reading (gameplay.js): filled in once; a device's reading taken only for a country with none.
    compileParties: async ({ country }) => {
      compiled.push(country);
      store.docs.world = { ...store.docs.world, politicalActors: { byPolity: { ...store.docs.world.politicalActors?.byPolity, [country]: { parties: [{ name: "Host Party", role: "governing" }] } } } };
    },
    hasParties: async (country) => Boolean(store.docs.world.politicalActors?.byPolity?.[country]),
    takeParties: async ({ country, landscape }) => {
      if (store.docs.world.politicalActors?.byPolity?.[country]) return { taken: false };
      store.docs.world = { ...store.docs.world, politicalActors: { byPolity: { ...store.docs.world.politicalActors?.byPolity, [country]: { parties: landscape.parties } } } };
      return { taken: true };
    },
    ...(options.institution ? { institution: options.institution } : {}),
    ...(options.gameMaster ? { gameMaster: options.gameMaster } : {}),
    ...(options.onSeatsMoved ? { onSeatsMoved: options.onSeatsMoved } : {}),
    ...(options.onBusy ? { onBusy: options.onBusy } : {}),
    ...(options.countriesOf ? { countriesOf: options.countriesOf } : {}),
    ...(options.worldWords ? { worldWords: options.worldWords } : {}),
    campaign: options.campaign ?? "",
    ...(options.features ? { features: options.features } : {}),
    ...(options.rules ? { rules: options.rules } : {}),
    restored: options.restored ?? null,
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
  return { clock, store, sent, resolved, replies, sheets, taken, compiled, host, hostPlayer, guest, request, to, ack, shown };
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

test("orders the last skip left unanswered are not this round's: they do not count toward its limit", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  // A round ago the skip answered none of these: they stay queued, overdue (AI/playerFocus.js settleOrders).
  s.store.docs.actions.push(...Array.from({ length: MAX_ORDERS_PER_ROUND }, (_, n) => ({
    id: `order-ru-old-${n}`, status: "planned", overdue: true, title: `Old ${n}`, text: `Old order ${n}`, ownerCode: RUSSIA,
  })));
  for (let n = 0; n < MAX_ORDERS_PER_ROUND; n += 1) await s.request(s.guest, { t: "order", id: id(100 + n), text: `New order ${n}` });
  assert.ok(Array.from({ length: MAX_ORDERS_PER_ROUND }, (_, n) => s.ack(s.guest, id(100 + n))).every((answer) => answer.ok), "a whole round's orders, however many are overdue");
  await s.request(s.guest, { t: "order", id: id(200), text: "One more" });
  assert.match(s.ack(s.guest, id(200)).error, /At most 12 orders a round/, "this round's are still held to the limit");
  // A formation raised counts the same way (host/forces.js).
  await s.request(s.guest, { t: "deploy", id: id(201), type: "infantry", lng: 30.3, lat: 59.9 });
  assert.match(s.ack(s.guest, id(201)).error, /At most 12 orders a round/);
  // Withdrawn, an overdue order goes like any other.
  await s.request(s.guest, { t: "unorder", id: id(202), order: "order-ru-old-0" });
  assert.equal(s.ack(s.guest, id(202)).ok, true);
  assert.equal(s.store.docs.actions.some((action) => action.id === "order-ru-old-0"), false);
});

// Every queued order rides in the round's one request, overdue ones first, and none lapses: a player whose orders
// the AI kept leaving unanswered put twelve more in every round's request on top of all of them (the review of
// 2026-11-18, wars 3). The whole queue is held to twice a round's.
test("a player's whole queue, carried-over orders and all, is held to twice a round's orders, and the player is told why", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  s.store.docs.actions.push(...Array.from({ length: 2 * MAX_ORDERS_PER_ROUND - 3 }, (_, n) => ({
    id: `order-ru-old-${n}`, status: "planned", overdue: true, title: `Old ${n}`, text: `Old order ${n}`, ownerCode: RUSSIA,
  })));
  for (let n = 0; n < 3; n += 1) await s.request(s.guest, { t: "order", id: id(100 + n), text: `New order ${n}` });
  assert.ok([0, 1, 2].every((n) => s.ack(s.guest, id(100 + n)).ok), "within the queue's bound, a round's own are given");
  await s.request(s.guest, { t: "order", id: id(103), text: "One more" });
  assert.match(s.ack(s.guest, id(103)).error, /At most 24 of your orders wait at once, those carried over unanswered among them: withdraw one/);
  await s.request(s.guest, { t: "unorder", id: id(104), order: "order-ru-old-0" });
  await s.request(s.guest, { t: "order", id: id(105), text: "One more" });
  assert.equal(s.ack(s.guest, id(105)).ok, true, "one withdrawn makes room");
  assert.equal(s.store.docs.actions.filter((action) => action.ownerCode === RUSSIA && action.status === "planned").length, 2 * MAX_ORDERS_PER_ROUND);
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
  // A line sent from one of the guest's advisor's drafted letters keeps the
  // draft's id, so the guest's advisor says that letter went.
  await s.request(s.guest, { t: "say", id: id(5), thread: thread.id, to: [], text: "Moscow accepts.", fromDraft: "advisor-reply-9#1" });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
  await s.clock.flush();
  const line = s.shown(s.guest).chat.find((chat) => chat.id === thread.id).messages.find((message) => message.text === "Moscow accepts.");
  assert.equal(line.fromDraft, "advisor-reply-9#1");
});

test("diplomacy between people: each writes their own lines, the model answers for neither, and each reads a thread with the other", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();

  // The host opens a thread with the country the guest plays.
  await s.request(s.hostPlayer, { t: "say", id: id(2), thread: null, to: [RUSSIA], text: "Riga to Moscow." });
  assert.equal(s.ack(s.hostPlayer, id(2)).ok, true);
  await s.clock.flush();
  const thread = s.store.docs.chat.find((chat) => chat.player === LATVIA);
  assert.deepEqual(thread.countries.map((entry) => entry.name), [RUSSIA]);
  assert.deepEqual(s.replies, [], "Russia is a person's: nothing is asked of the model");

  // The guest reads it as a thread with Latvia, and answers in it.
  const seen = () => s.shown(s.guest).chat.find((chat) => chat.id === thread.id);
  assert.deepEqual(seen().countries.map((entry) => entry.name), [LATVIA]);
  assert.deepEqual(seen().messages.map((message) => [message.role, message.speaker]), [["leader", LATVIA]]);
  await s.request(s.guest, { t: "say", id: id(3), thread: thread.id, to: [], text: "Moscow to Riga." });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  await s.clock.flush();
  assert.deepEqual(s.replies, []);
  assert.deepEqual(seen().messages.map((message) => [message.role, message.speaker]), [["leader", LATVIA], ["user", RUSSIA]]);
  const hosts = s.shown(s.hostPlayer).chat.find((chat) => chat.id === thread.id);
  assert.deepEqual(hosts.countries.map((entry) => entry.name), [RUSSIA]);
  assert.deepEqual(hosts.messages.map((message) => [message.role, message.speaker]), [["user", LATVIA], ["leader", RUSSIA]]);

  // A thread the guest opens with the host is the guest's, and the host answers in it.
  await s.request(s.guest, { t: "say", id: id(4), thread: null, to: [LATVIA], text: "A second channel." });
  const second = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  assert.deepEqual(second.countries.map((entry) => entry.name), [LATVIA]);
  await s.request(s.hostPlayer, { t: "say", id: id(5), thread: second.id, to: [], text: "Received." });
  assert.equal(s.ack(s.hostPlayer, id(5)).ok, true);
  await s.clock.flush();
  assert.deepEqual(s.replies, []);

  // With an AI government at the table too, that government is asked, once.
  await s.request(s.hostPlayer, { t: "say", id: id(6), thread: null, to: [RUSSIA, ESTONIA], text: "A Baltic conference." });
  await s.clock.flush();
  const conference = s.store.docs.chat.find((chat) => chat.countries.length === 2);
  assert.deepEqual(s.replies, [{ chatId: conference.id, seat: LATVIA }]);
  await s.request(s.guest, { t: "say", id: id(7), thread: conference.id, to: [], text: "Moscow attends." });
  await s.clock.flush();
  assert.deepEqual(s.replies.at(-1), { chatId: conference.id, seat: RUSSIA });
});

test("a guest's thread begun from a country's panel reaches the host, and the AI's answer comes back to that guest alone", async () => {
  const { pendingSharedThread, sayRequestFor, openedThreadOf } = await import("../client/sharedThreads.js");
  const s = setup({
    // The AI government at the table answers into the thread (engineMain.js tableTurn).
    replyTo: async ({ chatId }, store) => {
      await store.updateChats((chats) => chats.map((chat) => (chat.id === chatId
        ? { ...chat, messages: [...chat.messages, { id: "reply-1", role: "leader", speaker: ESTONIA, code: ESTONIA, text: "Tallinn hears Moscow." }] }
        : chat)));
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();

  // The panel used to make the thread up and save it on the guest's own screen,
  // where nothing is saved: its first line named a thread the host never had,
  // and was refused. A guest has no thread of its own to fall back on.
  const madeUp = { id: "chat-mz1-abcde", countries: [{ name: ESTONIA, code: ESTONIA }], messages: [], status: "open" };
  await s.request(s.guest, { t: "say", id: id(2), ...sayRequestFor(madeUp, "Moscow to Tallinn.") });
  assert.match(s.ack(s.guest, id(2)).error, /not in that conversation/);
  assert.equal(s.store.docs.chat.length, 1);

  // Now the thread waits on the guest's screen until its first line opens it on the host.
  const pending = pendingSharedThread([{ name: ESTONIA, code: ESTONIA }], { now: () => 7 });
  const asked = { t: "say", id: id(3), ...sayRequestFor(pending, "Moscow to Tallinn.") };
  assert.equal(validate(PLAYER_REQUESTS.say, asked).ok, true);
  await s.request(s.guest, asked);
  const answer = s.ack(s.guest, id(3));
  assert.equal(answer.ok, true);
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  assert.equal(openedThreadOf(answer), thread.id, "the ack names the thread, for the screen to open");
  await s.clock.flush();
  assert.deepEqual(s.replies, [{ chatId: thread.id, seat: RUSSIA }], "Estonia answers, with Russia as the player");

  const guests = s.shown(s.guest).chat.find((chat) => chat.id === thread.id);
  assert.deepEqual(guests.countries.map((entry) => entry.name), [ESTONIA]);
  assert.deepEqual(guests.messages.map((message) => [message.role, message.speaker, message.text]), [
    ["user", RUSSIA, "Moscow to Tallinn."],
    ["leader", ESTONIA, "Tallinn hears Moscow."],
  ]);
  assert.equal((s.shown(s.hostPlayer).chat ?? []).some((chat) => chat.id === thread.id), false, "the host is not at that table");

  // The guest goes on in it by its id; a thread it opens with the host's own
  // country, a person's, asks the model nothing.
  await s.request(s.guest, { t: "say", id: id(4), ...sayRequestFor(guests, "And Riga?") });
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.equal(s.ack(s.guest, id(4)).result, undefined, "only a thread a line opens is named back");
  await s.request(s.guest, { t: "say", id: id(5), ...sayRequestFor(pendingSharedThread([{ name: LATVIA }]), "Moscow to Riga.") });
  await s.clock.flush();
  assert.equal(s.replies.length, 2);
  assert.deepEqual(s.replies.at(-1), { chatId: thread.id, seat: RUSSIA });
});

test("a guest's thread keeps its owner through the game's own normalizer and reconciler, beside the host's thread with the same country", async () => {
  const { normalizeChats, reconcileChatsForPlayer } = await import("../../runtime/gameState.js");
  const world = { polityOverrides: Object.fromEntries([LATVIA, RUSSIA, ESTONIA].map((name) => [name, { code: name, name, status: "active" }])) };
  const line = (id, speaker, text) => ({ id, role: "user", speaker, code: speaker, text });
  const stored = normalizeChats([
    { id: "lv-est", countries: [{ code: ESTONIA, name: ESTONIA }], messages: [line("m1", LATVIA, "Riga to Tallinn")] },
    { id: "ru-est", player: RUSSIA, countries: [{ code: ESTONIA, name: ESTONIA }], messages: [line("m2", RUSSIA, "Moscow to Tallinn")] },
    { id: "ru-lv", player: RUSSIA, countries: [{ code: LATVIA, name: LATVIA }], messages: [line("m3", RUSSIA, "Moscow to Riga")] },
  ]);
  assert.deepEqual(stored.map((chat) => chat.player ?? ""), ["", RUSSIA, RUSSIA]);
  // The host's game is reconciled for the host's country (the institutions do
  // this): Russia's threads are neither merged into Latvia's nor dropped.
  const after = reconcileChatsForPlayer(stored, world, LATVIA);
  assert.deepEqual(after.map((chat) => [chat.id, chat.player ?? "", chat.countries.map((entry) => entry.name).join()]), [
    ["lv-est", "", ESTONIA],
    ["ru-est", RUSSIA, ESTONIA],
    ["ru-lv", RUSSIA, LATVIA],
  ]);
  assert.deepEqual(after.map((chat) => chat.messages.length), [1, 1, 1]);
});

test("reconciled for a guest's institution business, the host's threads stay the host's", async () => {
  // A guest founding or voting runs the game's institution functions for the
  // guest's country, and they reconcile every thread for it. A host thread
  // whose only other member was that guest lost its last member and was gone.
  const { normalizeChats, reconcileChatsForPlayer } = await import("../../runtime/gameState.js");
  const { setHostingSharedGame } = await import("../../runtime/humanPolities.js");
  const world = { polityOverrides: Object.fromEntries([LATVIA, RUSSIA, ESTONIA].map((name) => [name, { code: name, name, status: "active" }])) };
  const line = (id, speaker, text) => ({ id, role: "user", speaker, code: speaker, text });
  const stored = normalizeChats([
    { id: "lv-ru", countries: [{ code: RUSSIA, name: RUSSIA }], messages: [line("m1", LATVIA, "Riga to Moscow")] },
    { id: "lv-est", countries: [{ code: ESTONIA, name: ESTONIA }], messages: [line("m2", LATVIA, "Riga to Tallinn")] },
    { id: "ru-est", player: RUSSIA, countries: [{ code: ESTONIA, name: ESTONIA }], messages: [line("m3", RUSSIA, "Moscow to Tallinn")] },
  ]);
  setHostingSharedGame(true, { host: LATVIA });
  try {
    const after = reconcileChatsForPlayer(stored, world, RUSSIA);
    assert.deepEqual(after.map((chat) => [chat.id, chat.player ?? "", chat.countries.map((entry) => entry.name).join()]), [
      ["lv-ru", "", RUSSIA],
      ["lv-est", "", ESTONIA],
      ["ru-est", RUSSIA, ESTONIA],
    ]);
    // For the host, as before: its own threads are its own.
    assert.deepEqual(reconcileChatsForPlayer(stored, world, LATVIA).map((chat) => chat.id), ["lv-ru", "lv-est", "ru-est"]);
  } finally {
    setHostingSharedGame(false);
  }
  // Single player, where no thread names an owner: nothing changes.
  assert.deepEqual(reconcileChatsForPlayer(stored.slice(0, 2), world, LATVIA).map((chat) => chat.id), ["lv-ru", "lv-est"]);
});

test("each player keeps a Projects board of its own, changed only by the game's own project operations, on the host", async () => {
  // The board came whole from the page and the host kept it: a page could write any entry's progress, or a plan that
  // took another player's land (the gap audit of 2026-11-18). The host applies the panel's and the advisor's
  // operations itself, by the game's own door (gameState.js applyProjectOpsToWorld), to that seat's own board.
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const names = (projects) => (projects ?? []).map((project) => project.name);
  const plan = { durationDays: 200, monthlyCost: 1e8, milestones: [{ title: "Docks", atProgress: 50 }], effects: [{ type: "stat", stat: "military.sea", change: 5 }] };

  // The guest opens a project of its own; what it says of its progress is not taken.
  await s.request(s.guest, { t: "projectOps", id: id(2), ops: [{ op: "create", name: "Northern Fleet refit", summary: "Dry docks at Severodvinsk.", secrecy: "covert", plan, progress: 99.99, status: "complete" }] });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  const refit = () => s.store.docs.world.seatBoards[RUSSIA].find((project) => project.name === "Northern Fleet refit");
  assert.equal(refit().progress, 0, "the host keeps every entry's progress");
  assert.notEqual(refit().status, "complete");
  assert.deepEqual(names(s.store.docs.world.projects), [], "the game's own board is the host's, untouched");
  assert.deepEqual(names(s.shown(s.guest).world.projects), ["Northern Fleet refit"]);
  assert.equal(JSON.stringify(s.shown(s.hostPlayer)).includes("Northern Fleet"), false, "nothing of its covert work reaches the host's view");
  // Its funding is its own to set.
  await s.request(s.guest, { t: "projectOps", id: id(3), ops: [{ op: "update", name: "Northern Fleet refit", funding: "high" }] });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.equal(refit().funding, "high");

  // The host's own board is the game's, as in single player.
  await s.request(s.hostPlayer, { t: "projectOps", id: id(4), ops: [{ op: "create", name: "Riga port expansion", secrecy: "covert", plan }] });
  assert.deepEqual(names(s.store.docs.world.projects), ["Riga port expansion"]);
  assert.deepEqual(names(s.shown(s.guest).world.projects), ["Northern Fleet refit"]);
  assert.equal(JSON.stringify(s.shown(s.guest)).includes("Riga port"), false);
  // Nobody's operations reach another's board: the guest cannot fund the host's work, nor open one in its name.
  await s.request(s.guest, { t: "projectOps", id: id(5), ops: [{ op: "update", name: "Riga port expansion", funding: "none" }] });
  assert.equal(s.store.docs.world.projects[0].funding, "normal");
  await s.request(s.guest, { t: "projectOps", id: id(6), ops: [{ op: "create", name: "Latvian collapse", ownerCode: LATVIA, plan }] });
  assert.match(s.ack(s.guest, id(6)).error, /not one of your own programmes/);
  assert.equal(JSON.stringify(s.store.docs.world).includes("Latvian collapse"), false);

  // What an older version's lending left on the game's board (runtime/seatBoards.js settleBoards): the host's view leaves it out.
  s.store.docs.world.projects = [...s.store.docs.world.projects, { ...refit(), ownerCode: RUSSIA }];
  assert.deepEqual(names(projectForViewer({ ...s.store.docs, game: { ...s.store.docs.game, country: LATVIA } }, LATVIA).world.projects), ["Riga port expansion"]);
  // And no board travels whole any more.
  assert.equal(PLAYER_REQUESTS.board, undefined);
});

test("a player's forces: raised and stood down by the host, for the player who asked, and undone with the order", async () => {
  // The host's map: Russia's ground east of 27°E, Latvia's west of it.
  const s = setup({ readChart: async () => ({ holds: (country, lng) => country === (lng >= 27 ? RUSSIA : LATVIA), sea: () => false }) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  const brigade = { type: "armor", strength: 80, name: "4th Guards", composition: "T-90 tanks", lng: 28.3, lat: 57.8 };
  await s.request(s.guest, { t: "deploy", id: id(2), ...brigade });
  assert.match(s.ack(s.guest, id(2)).error, /while a round is being planned/);
  await s.host.control.start();

  // Raised in Riga, the host's capital, it was taken (the review of 2026-11-18, wars 11): held to the host's map.
  await s.request(s.guest, { t: "deploy", id: id(20), ...brigade, lng: 24.1, lat: 56.9 });
  assert.match(s.ack(s.guest, id(20)).error, /on land your country holds, or at sea off it/);
  await s.request(s.guest, { t: "deploy", id: id(3), ...brigade });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  const raised = s.store.docs.world.units.at(-1);
  assert.deepEqual([raised.ownerCode, raised.status, raised.source, raised.type], [RUSSIA, "pending", "player", "armor"]);
  const request = s.store.docs.actions.find((action) => action.unitRevert?.unitId === raised.id);
  assert.equal(request.ownerCode, RUSSIA);
  // Only ordered: its owner sees the formation and the request, and nobody else sees either until the skip (the
  // owner's decision 6, "just do A only": what exists is public, what is only ordered is private).
  assert.ok(s.shown(s.guest).world.units.some((unit) => unit.id === raised.id));
  assert.equal(s.shown(s.hostPlayer).world.units.some((unit) => unit.id === raised.id), false);
  assert.deepEqual(s.shown(s.guest).actions.map((action) => action.id), [request.id]);
  assert.equal(s.shown(s.hostPlayer).actions.some((action) => action.id === request.id), false);

  // Nobody stands down another's formation.
  await s.request(s.hostPlayer, { t: "disband", id: id(4), unit: raised.id });
  assert.match(s.ack(s.hostPlayer, id(4)).error, /not one of your formations/);
  // Withdrawing the request takes the pending formation off the map again.
  await s.request(s.guest, { t: "unorder", id: id(5), order: request.id });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
  assert.equal(s.store.docs.world.units.some((unit) => unit.id === raised.id), false);
  assert.equal(s.shown(s.hostPlayer).world.units.some((unit) => unit.id === raised.id), false);

  // A standing formation stood down leaves the map with an order that says so.
  s.store.docs.world.units = [{ id: "ru-1", name: "76th Division", type: "infantry", ownerCode: RUSSIA, strength: 90, lng: 28.3, lat: 57.8, status: "idle", source: "ai" }];
  await s.request(s.guest, { t: "disband", id: id(6), unit: "ru-1" });
  assert.equal(s.ack(s.guest, id(6)).ok, true);
  assert.deepEqual(s.store.docs.world.units, []);
  const disband = s.store.docs.actions.find((action) => action.unitRevert?.restore?.id === "ru-1");
  assert.match(disband.text, /^Disband order: 76th Division/);
  await s.request(s.guest, { t: "unorder", id: id(7), order: disband.id });
  assert.deepEqual(s.store.docs.world.units.map((unit) => unit.id), ["ru-1"], "the order withdrawn, it stands again");
});

test("a player's agents: its own to place and recall, and a caught one the business of the country that caught it", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const agent = (fields) => ({ t: "agent", target: "", spy: "", story: "", ...fields });

  await s.request(s.guest, agent({ id: id(2), op: "deploy", target: ESTONIA }));
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  const placed = s.store.docs.world.spies[0];
  assert.deepEqual([placed.owner, placed.target, placed.status, placed.deployedAt], [RUSSIA, ESTONIA, "active", "2014-04-01"]);
  // It stands on its owner's board, which is not the game's own.
  assert.deepEqual(s.store.docs.world.seatBoards[RUSSIA].map((project) => project.name), [`Agent in ${ESTONIA}`]);
  assert.deepEqual(s.store.docs.world.projects ?? [], []);
  assert.equal(s.shown(s.guest).world.spies.length, 1);
  assert.equal(JSON.stringify(s.shown(s.hostPlayer).world).includes(placed.id), false, "nobody else is told");

  await s.request(s.guest, agent({ id: id(3), op: "deploy", target: "Atlantis" }));
  assert.match(s.ack(s.guest, id(3)).error, /Unknown country/);
  await s.request(s.hostPlayer, agent({ id: id(4), op: "recall", spy: placed.id }));
  assert.match(s.ack(s.hostPlayer, id(4)).error, /not one of your agents/);

  // Latvia's service catches a Russian agent: what becomes of it is Latvia's call.
  s.store.docs.world.spies.push({ id: "spy-in-lv", owner: RUSSIA, target: LATVIA, status: "discovered", deployedAt: "2014-03-01" });
  await s.request(s.guest, agent({ id: id(5), op: "expel", spy: "spy-in-lv" }));
  assert.match(s.ack(s.guest, id(5)).error, /not an agent your service is holding/);
  await s.request(s.hostPlayer, agent({ id: id(6), op: "turn", spy: "spy-in-lv", story: "The fleet stays in port." }));
  assert.equal(s.ack(s.hostPlayer, id(6)).ok, true);
  const turned = s.store.docs.world.spies.find((spy) => spy.id === "spy-in-lv");
  assert.deepEqual([turned.status, turned.coverStory], ["turned", "The fleet stays in port."]);
  // Its owner still sees an agent at work, and never the story it is fed.
  const seenByOwner = s.shown(s.guest).world.spies.find((spy) => spy.id === "spy-in-lv");
  assert.equal(seenByOwner.status, "active");
  assert.equal(JSON.stringify(s.shown(s.guest).world).includes("The fleet stays in port."), false);

  await s.request(s.guest, agent({ id: id(7), op: "recall", spy: placed.id }));
  assert.equal(s.store.docs.world.spies.find((spy) => spy.id === placed.id).status, "recalled");
  assert.equal(s.store.docs.world.seatBoards[RUSSIA][0].status, "cancelled");
});

test("a stat sheet is written by the host when a player's Stats pane has none, as many as are asked for, and reaches everyone", async () => {
  // The owner: stat sheets follow the replies setting, "either unlimited host use or use your own api", and
  // "there should be no stat rerolling tho on multiplayer".
  const s = setup({ sheetFails: true });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "sheet", id: id(2), country: RUSSIA });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual(s.sheets, [{ country: RUSSIA, seat: RUSSIA }]);
  assert.equal(s.shown(s.guest).world.countryStats[RUSSIA].capital, "A capital");
  assert.equal(s.shown(s.hostPlayer).world.countryStats[RUSSIA].capital, "A capital", "a sheet is public");
  // The host's reason for failing is the player's answer, in the host's words; the host reads the provider's own
  // (host/failureWords.js: they name the host's model and provider).
  await s.request(s.guest, { t: "sheet", id: id(3), country: ESTONIA });
  assert.equal(s.ack(s.guest, id(3)).error, "The host could not write that country's figures.");
  await s.request(s.hostPlayer, { t: "sheet", id: id(4), country: ESTONIA });
  assert.equal(s.ack(s.hostPlayer, id(4)).error, "The model did not answer.");
  // On the host's own key, as many as are asked for: no count a round.
  for (let n = 0; n < 12; n += 1) await s.request(s.guest, { t: "sheet", id: id(10 + n), country: n % 2 ? LATVIA : RUSSIA });
  assert.ok(Array.from({ length: 12 }, (_, n) => s.ack(s.guest, id(10 + n)).ok).every(Boolean));
  // A sheet once written stands: there is no asking for it to be written again.
  s.store.docs.world.countryStats[RUSSIA].stability = 51;
  await s.request(s.guest, { t: "sheet", id: id(30), country: RUSSIA });
  assert.equal(s.store.docs.world.countryStats[RUSSIA].stability, 51);
  assert.equal(validate(PLAYER_REQUESTS.sheet, { t: "sheet", id: id(31), country: RUSSIA, fresh: true }).ok, false, "a reroll is no request");
});

test("with each player's own AI, a missing sheet is written on the asking device and the host takes the figures, once", async () => {
  const s = setup({ settings: { replies: "own" } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  // No sheet: the host leaves it to the device that asked, and its own AI writes nothing.
  await s.request(s.guest, { t: "sheet", id: id(2), country: ESTONIA });
  assert.deepEqual([s.ack(s.guest, id(2)).ok, s.ack(s.guest, id(2)).result], [true, { answer: "own" }]);
  assert.deepEqual(s.sheets, []);
  // The device sends the figures it wrote: no key, figures alone. They reach everyone.
  const figures = { country: ESTONIA, sheet: { capital: "Tallinn", stability: 62 }, continuity: { stateFingerprint: "stats-1" }, rating: 55 };
  await s.request(s.guest, { t: "ownSheet", id: id(3), ...figures });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.deepEqual(s.taken, [{ country: ESTONIA, sheet: figures.sheet, continuity: figures.continuity, rating: 55 }]);
  assert.equal(s.shown(s.hostPlayer).world.countryStats[ESTONIA].capital, "Tallinn");
  // Figures nobody left to that device are not taken: any seat could send any country's, unasked, and the first
  // stood for the game (the gap audit of 2026-11-18). Nor is the same reading taken twice.
  await s.request(s.hostPlayer, { t: "ownSheet", id: id(4), country: ESTONIA, sheet: { capital: "Elsewhere", stability: 1 } });
  assert.match(s.ack(s.hostPlayer, id(4)).error, /not left to your device/);
  await s.request(s.guest, { t: "ownSheet", id: id(9), ...figures });
  assert.match(s.ack(s.guest, id(9)).error, /not left to your device/);
  await s.request(s.guest, { t: "sheet", id: id(5), country: ESTONIA });
  assert.equal(s.ack(s.guest, id(5)).result, undefined);
  assert.equal(s.store.docs.world.countryStats[ESTONIA].capital, "Tallinn");
  // A country another person plays is that player's own to read: a rival's figures are nobody else's to write first.
  await s.request(s.guest, { t: "sheet", id: id(10), country: LATVIA });
  assert.match(s.ack(s.guest, id(10)).error, /player of that country opens them/);
  // The player's own country is never its own device's to write: the war and the spies act on those figures
  // (host/ownReadings.js). The host's AI writes it, as it writes a sheet where the host's AI answers.
  await s.request(s.guest, { t: "sheet", id: id(11), country: RUSSIA });
  assert.deepEqual([s.ack(s.guest, id(11)).ok, s.ack(s.guest, id(11)).result], [true, undefined]);
  assert.deepEqual(s.sheets.at(-1), { country: RUSSIA, seat: RUSSIA });
  await s.request(s.guest, { t: "ownSheet", id: id(6), country: RUSSIA, sheet: { capital: "Moscow", stability: 100 } });
  assert.match(s.ack(s.guest, id(6)).error, /not left to your device/);
  // What is no whole sheet is refused with the reason.
  delete s.store.docs.world.countryStats[ESTONIA];
  await s.request(s.guest, { t: "sheet", id: id(12), country: ESTONIA });
  await s.request(s.guest, { t: "ownSheet", id: id(13), country: ESTONIA, sheet: { stability: 3 } });
  assert.match(s.ack(s.guest, id(13)).error, /not a whole stat sheet/);
  s.store.docs.world.countryStats[ESTONIA] = { capital: "Tallinn", stability: 62 };
  // Once the host's AI writes the figures again, a device's are not taken.
  s.host.control.setReplies("host");
  await s.request(s.guest, { t: "ownSheet", id: id(7), country: RUSSIA, sheet: { capital: "Moscow" } });
  assert.match(s.ack(s.guest, id(7)).error, /host's AI writes the figures/);
  await s.request(s.guest, { t: "sheet", id: id(8), country: RUSSIA });
  assert.deepEqual([s.ack(s.guest, id(8)).result, s.store.docs.world.countryStats[RUSSIA].capital], [undefined, "A capital"]);
});

test("a structure the map placed approximately is settled by the player it belongs to, and by nobody else", async () => {
  // The host's own map: Russia's ground east of 27 degrees and north of 55, the sea west of 21, within reach of
  // Russia's shore east of 18; everything else land of others.
  const chart = {
    holds: (country, lng, lat) => (lng < 21 ? null : lng >= 27 && lat >= 55 ? country === RUSSIA : false),
    sea: (lng) => lng < 21,
    landNear: (country, lng) => country === RUSSIA && lng >= 18,
  };
  const s = setup({ readChart: async () => chart });
  // Russia's base, placed near a capital because the map did not know its town.
  s.store.docs.world.markers = [
    { id: "base-ru", name: "Forward base", kind: "base", ownerCode: RUSSIA, lng: 30, lat: 59, approximate: { asked: "Novaya Gavan", country: RUSSIA, near: "capital" } },
    { id: "port-lv", name: "Harbour", kind: "port", ownerCode: LATVIA, lng: 24, lat: 57 },
  ];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const marker = (markerId) => s.store.docs.world.markers.find((entry) => entry.id === markerId);

  // Not another player's to settle, and not a structure that was placed exactly.
  await s.request(s.hostPlayer, { t: "settle", id: id(2), marker: "base-ru", move: true, lng: 10, lat: 10 });
  assert.match(s.ack(s.hostPlayer, id(2)).error, /not yours to settle/);
  await s.request(s.hostPlayer, { t: "settle", id: id(3), marker: "port-lv", move: true, lng: 10, lat: 10 });
  assert.match(s.ack(s.hostPlayer, id(3)).error, /not yours to settle/);
  await s.request(s.guest, { t: "settle", id: id(4), marker: "no-such", move: false, lng: 0, lat: 0 });
  assert.match(s.ack(s.guest, id(4)).error, /not on the map/);
  assert.deepEqual([marker("base-ru").lng, marker("base-ru").lat, Boolean(marker("base-ru").approximate)], [30, 59, true]);

  // Not onto another's land, nor far out to sea: any point on Earth was taken, another player's capital included.
  await s.request(s.guest, { t: "settle", id: id(8), marker: "base-ru", move: true, lng: 24.1, lat: 56.9 });
  assert.match(s.ack(s.guest, id(8)).error, /its own country's land/);
  await s.request(s.guest, { t: "settle", id: id(9), marker: "base-ru", move: true, lng: 5, lat: 56.9 });
  assert.match(s.ack(s.guest, id(9)).error, /its own country's land/);
  assert.deepEqual([marker("base-ru").lng, marker("base-ru").lat], [30, 59]);
  // The sea off its own coast is a place for it.
  await s.request(s.guest, { t: "settle", id: id(10), marker: "base-ru", move: true, lng: 19.5, lat: 58 });
  assert.equal(s.ack(s.guest, id(10)).ok, true);

  // Its owner moves it: it stands at the point, the mark is gone, and everyone's map shows it there.
  s.store.docs.world.markers[0] = { ...s.store.docs.world.markers[0], lng: 30, lat: 59, approximate: { asked: "Novaya Gavan", country: RUSSIA, near: "capital" } };
  await s.request(s.guest, { t: "settle", id: id(5), marker: "base-ru", move: true, lng: 31.25, lat: 60.5 });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
  assert.deepEqual([marker("base-ru").lng, marker("base-ru").lat, "approximate" in marker("base-ru")], [31.25, 60.5, false]);
  for (const player of [s.hostPlayer, s.guest]) {
    const seen = s.shown(player).world.markers.find((entry) => entry.id === "base-ru");
    assert.deepEqual([seen.lng, seen.lat], [31.25, 60.5]);
  }
});

test("when the game stops being shared the save is single player again", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  await s.host.stop();
  assert.equal("humanCountries" in s.store.docs.game, false);
  // A connection closing late, or a request arriving late, changes nothing.
  s.host.leave(s.guest);
  await s.request(s.guest, { t: "order", id: id(2), text: "Too late" });
  await s.clock.flush();
  assert.equal("humanCountries" in s.store.docs.game, false);
  assert.equal(s.store.docs.actions.some((action) => action.ownerCode === RUSSIA), false);
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

// A people founding a country of their own, as the time skip writes it: the
// polity created, the order it resolves, and the founder's land handed to it.
const founding = ({ id: eventId, from, to, order }) => ({
  id: eventId, date: "2014-04-20", title: `${from} founds ${to}`, description: "",
  impacts: {
    actionIds: [order],
    polityChanges: [{ operation: "create", code: to, name: to }],
    regionTransfers: [{ regionId: "reg-1", fromCode: from, toCode: to, basis: "independence" }],
  },
});

test("a player whose people found a country plays it from then on, with their queued orders and threads; the host's game country follows", async () => {
  const BALTIC = "Baltic Union";
  const PSKOV = "Pskov Republic";
  const moved = [];
  const s = setup({
    onSeatsMoved: (moves) => moved.push(...moves),
    roundWrites: (docs) => {
      // The host's order (no owner) and the guest's both found a country, and the old states end with it (a seat
      // follows a founding only then: host/foundings.js polityEnded).
      for (const name of [LATVIA, RUSSIA]) docs.world.polityOverrides[name] = { ...docs.world.polityOverrides[name], status: "dissolved" };
      docs.actions = docs.actions.map((action) => ({ ...action, status: "resolved" }));
      docs.actions.push(
        { id: "order-ru-found", status: "resolved", ownerCode: RUSSIA, text: "Found the Pskov Republic" },
        { id: "order-ru-later", status: "planned", ownerCode: RUSSIA, text: "Raise a militia" },
      );
      docs.events.push(
        founding({ id: "ev-baltic", from: LATVIA, to: BALTIC, order: "order-lv" }),
        founding({ id: "ev-pskov", from: RUSSIA, to: PSKOV, order: "order-ru-found" }),
      );
      docs.chat.push({ id: "chat-ru", player: RUSSIA, countries: [{ code: ESTONIA, name: ESTONIA }], messages: [] });
      // What only the old government knew, and an agent of its own.
      docs.events.push({ id: "ev-ru-secret", date: "2014-04-02", title: "A mole is found in Pskov", description: "", audience: [RUSSIA] });
      docs.world = { ...docs.world, spies: [{ id: "spy-ru", owner: RUSSIA, target: ESTONIA, status: "active" }] };
      // Its army, and what it built: a fort on the ground it gave the new country, a depot on the ground it kept.
      docs.world.units = [{ id: "ru-army", name: "6th Army", type: "infantry", ownerCode: RUSSIA, strength: 90, lng: 28.3, lat: 57.8, status: "idle", source: "player" }];
      docs.world.markers = [
        { id: "fort-pskov", name: "Pskov fort", kind: "fort", ownerCode: RUSSIA, lng: 28.3, lat: 57.8 },
        { id: "depot-moscow", name: "Moscow depot", kind: "depot", ownerCode: RUSSIA, lng: 37.6, lat: 55.7 },
      ];
    },
    // The host's own map: west of 30 degrees east is the Pskov Republic's now.
    readChart: async () => ({ holds: (country, lng) => (lng < 30) === (country === "Pskov Republic") }),
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  await s.clock.flush();
  assert.deepEqual(moved, [{ from: LATVIA, to: BALTIC, host: true }, { from: RUSSIA, to: PSKOV, host: false }]);
  assert.equal(s.store.docs.game.country, BALTIC);
  assert.deepEqual(s.store.docs.game.humanCountries, [BALTIC, PSKOV]);
  assert.equal(s.shown(s.guest).game.country, PSKOV);
  assert.equal(s.store.docs.actions.find((action) => action.id === "order-ru-later").ownerCode, PSKOV);
  assert.equal(s.store.docs.actions.find((action) => action.id === "order-ru-found").ownerCode, RUSSIA, "what was done stays done by who did it");
  assert.equal(s.store.docs.chat.find((chat) => chat.id === "chat-ru").player, PSKOV);
  assert.match(s.to(s.guest, "notice").at(-1).text, /you now play Pskov Republic/);
  assert.ok(!s.to(s.hostPlayer, "notice").some((notice) => /Pskov/.test(notice.text)), "the notice is the moved player's");
  assert.ok(s.shown(s.guest).events.some((event) => event.id === "ev-ru-secret"), "what the old government knew is still theirs");
  assert.ok(!s.shown(s.hostPlayer).events.some((event) => event.id === "ev-ru-secret"));
  assert.equal(s.store.docs.world.spies[0].owner, PSKOV);
  assert.equal(s.store.docs.world.units[0].ownerCode, PSKOV, "its army goes with it");
  assert.deepEqual(s.store.docs.world.markers.map((marker) => [marker.id, marker.ownerCode]), [["fort-pskov", PSKOV], ["depot-moscow", RUSSIA]]);
  assert.ok(s.shown(s.guest).world.units.some((unit) => unit.id === "ru-army" && unit.ownerCode === PSKOV));
  assert.equal(s.store.docs.actions.find((action) => action.id === "order-lv").ownerCode, LATVIA, "the host's past order stays the old name's");
  assert.deepEqual(s.store.docs.game.seatFoundings, [{ from: LATVIA, to: BALTIC }, { from: RUSSIA, to: PSKOV }]);
  const lobby = s.to(s.guest, "lobby").at(-1);
  assert.deepEqual(lobby.seats.map((seat) => [seat.country, seat.you]), [[BALTIC, false], [PSKOV, true]]);
});

test("a player who founds a country without giving it their own land keeps their seat", async () => {
  const s = setup({
    roundWrites: (docs) => {
      docs.actions.push({ id: "order-ru-puppet", status: "resolved", ownerCode: RUSSIA, text: "Set up a republic in Narva" });
      docs.events.push({
        id: "ev-puppet", date: "2014-04-20", title: "A republic is proclaimed in Narva", description: "",
        impacts: {
          actionIds: ["order-ru-puppet"],
          polityChanges: [{ operation: "create", code: "Narva Republic" }],
          regionTransfers: [{ regionId: "reg-narva", fromCode: ESTONIA, toCode: "Narva Republic" }],
        },
      });
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  assert.equal(s.store.docs.game.country, LATVIA);
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

// "When the game ends, it should actually kick the player from the game" (the owner, 2026-11-18). A release ends
// nothing: its player stays in, told why, and may take a free country. A ban ends the game for that player: the
// engine window sends its device away (host/engineMain.js "kick" with `ban`), its page takes it out to the menu
// with why (client/sharedGame.js endForThisPage), and the game keeps it out.
test("a player the host releases stays in the game; one the host bans is kept out of it for good", async () => {
  const s = setup();
  const third = { id: "p-third", device: "device-third", name: "Third" };
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  s.host.join(third);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.request(third, { t: "pick", id: id(2), country: ESTONIA });
  await s.host.control.start();

  const lobbies = s.to(s.guest, "lobby").length;
  assert.equal(s.host.control.kick(RUSSIA), s.guest.device);
  await s.clock.flush();
  assert.match(s.to(s.guest, "notice").at(-1).text, /^The host released you from Russian Federation\./);
  assert.equal(s.host.isBanned(s.guest.device), false);
  assert.ok(s.to(s.guest, "lobby").length > lobbies, "still sent the game, its seat let go");
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  assert.ok(s.ack(s.guest, id(3)), "and still answered");

  const toldBefore = s.to(third, "notice").length;
  assert.equal(s.host.control.kick(ESTONIA, { ban: true }), third.device);
  await s.clock.flush();
  assert.equal(s.to(third, "notice").length, toldBefore, "told by its own page, as it is taken out, not by a notice in the game");
  assert.equal(s.host.isBanned(third.device), true);
  assert.equal(s.host.isMember(third.device), false);
  assert.equal(s.host.roomFor(third.device), false);
  const again = { ...third, id: "p-third-2" };
  s.host.join(again);
  await s.clock.flush();
  assert.deepEqual(s.to(again, "lobby"), [], "a new connection of its device is given nothing of the game");
});

test("what a player does in the war room is written for its own side, and its war room is kept from the other side", async () => {
  const s = setup();
  // Russia in the west, Latvia in the east, and their troops along the line.
  const sheet = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend: { A: RUSSIA, B: LATVIA, "~": null }, west: 20, north: 51, step: 1, stepLat: 0.65, cities: [] });
  const row = (lng, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: 49.1 + ((index + 0.5) * 1.8) / count }));
  s.store.docs.world.battlefields = [battlefieldOn(sheet, { name: "The Baltic Front", sides: [[RUSSIA], [LATVIA]], troops: [row(20.9, 20), row(21.1, 12)] })];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const record = () => s.store.docs.world.battlefields[0];

  // The guest plays Russia: three of Russia's troops are told to dig in.
  await s.request(s.guest, { t: "warroom", id: id(2), op: { op: "order", battlefield: "The Baltic Front", troops: [0, 1, 2], order: "dig in", side: 1, player: LATVIA } });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual(chosenOrdersOf(record(), 0).map((order) => [order.order, order.troops, order.by]), [["dig in", [0, 1, 2], RUSSIA]], "whose troops they are is the seat's country, whatever the op says");
  assert.deepEqual(chosenOrdersOf(record(), 1), []);
  // The same numbers from the host are Latvia's troops.
  await s.request(s.hostPlayer, { t: "warroom", id: id(3), op: { op: "route", battlefield: "The Baltic Front", troops: [0, 1], way: [[21.2, 50.5], [20.6, 50.2]] } });
  assert.equal(s.ack(s.hostPlayer, id(3)).ok, true);
  assert.deepEqual(chosenOrdersOf(record(), 1).map((order) => [order.order, order.troops, order.by]), [["advance", [0, 1], LATVIA]]);
  // What is no op, or names a battlefield there is not, is refused in words.
  await s.request(s.guest, { t: "warroom", id: id(4), op: { op: "conquer", battlefield: "The Baltic Front" } });
  assert.match(s.ack(s.guest, id(4)).error, /Nothing was asked/);
  await s.request(s.guest, { t: "warroom", id: id(5), op: { op: "order", battlefield: "Nowhere", troops: [0], order: "hold" } });
  assert.match(s.ack(s.guest, id(5)).error, /no longer open/);

  // A turn of talk: what was said, the general's name and the order he took
  // (the 1st Army is the northern body; the three dug in are of the 2nd).
  await s.request(s.guest, { t: "warroom", id: id(6), op: { op: "talk", battlefield: "The Baltic Front", said: "Hold the river.", lines: [{ who: 0, text: "We will." }], orders: [{ command: 0, order: "hold" }], names: ["Gen. Orlov"] } });
  assert.equal(s.ack(s.guest, id(6)).ok, true);
  await s.request(s.guest, { t: "warroom", id: id(7), op: { op: "diversion", battlefield: "The Baltic Front", way: [[20.9, 49.3], [22.5, 49.3]], troops: 12 } });
  assert.equal(s.ack(s.guest, id(7)).ok, true);

  // Each is shown its own war room and nothing of the other's.
  const guestSees = s.shown(s.guest).world.battlefields[0];
  const hostSees = s.shown(s.hostPlayer).world.battlefields[0];
  assert.deepEqual(talkOf(guestSees, 0).map((line) => line.text), ["Hold the river.", "We will."]);
  assert.equal(generalsOf(guestSees, 0)[0].name, "Gen. Orlov");
  assert.deepEqual(chosenOrdersOf(guestSees, 0).map((order) => order.order).sort(), ["dig in", "hold"]);
  assert.deepEqual(keptPlansOf(guestSees, 0).map((plan) => plan.kind), ["diversion"]);
  assert.deepEqual(chosenOrdersOf(guestSees, 1), [], "the host's route is the host's");
  assert.deepEqual(talkOf(hostSees, 0), []);
  assert.deepEqual(generalsOf(hostSees, 0).map((general) => general.name).filter(Boolean), []);
  assert.deepEqual(keptPlansOf(hostSees, 0), []);
  assert.deepEqual(chosenOrdersOf(hostSees, 0), []);
  assert.deepEqual(chosenOrdersOf(hostSees, 1).map((order) => [order.order, order.troops]), [["advance", [0, 1]]], "and it still finds its own order in the list it is sent");
  assert.doesNotMatch(JSON.stringify(hostSees), /Hold the river|Gen\. Orlov/);
  // The troops themselves are seen by both: there is no fog of war.
  assert.equal(hostSees.troops[0], record().troops[0]);
});

test("the war room's fortified lines and fleets are the seat's own, held to the host's own map", async () => {
  // The host's chart of its map: Russia's ground west of 22°E, Latvia's east of it, and the sea north of 55°N.
  let readable = true;
  const reads = [];
  const fold = (name) => String(name).toLowerCase();
  const chart = {
    sea: (lng, lat) => lat > 55,
    joins: (from, to) => to[1] > 55,
    holds: (country, lng, lat) => (lat > 55 ? null : fold(country) === fold(lng < 22 ? RUSSIA : LATVIA)),
    coastOff: (country) => (fold(country) === fold(LATVIA) ? [23.5, 55.6] : null),
  };
  const s = setup({ readChart: async () => { reads.push(true); return readable ? chart : null; } });
  s.store.docs.world.units = [
    { id: "ru-fleet", name: "Baltic Fleet", type: "naval", ownerCode: RUSSIA, strength: 90, lng: 20.5, lat: 56.5, status: "idle", posture: "patrol" },
    { id: "lv-fleet", name: "Latvian Navy", type: "naval", ownerCode: LATVIA, strength: 30, lng: 23.5, lat: 56.5, status: "idle", posture: "holding" },
  ];
  s.store.docs.world.wars = [{ id: "war-1", status: "active", sideA: [RUSSIA], sideB: [LATVIA] }];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const lines = () => s.store.docs.world.fortifications ?? [];
  const orderOf = (unitId) => (s.store.docs.world.pendingUnitOrders ?? []).find((entry) => entry.unitId === unitId) ?? null;

  // The guest plays Russia: a line for Latvia, or on Latvia's ground, is refused.
  await s.request(s.guest, { t: "fortify", id: id(2), op: { op: "fortify", points: [[20, 50], [20.6, 50.4]], level: 6, owner: LATVIA } });
  assert.match(s.ack(s.guest, id(2)).error, /your own country/);
  await s.request(s.guest, { t: "fortify", id: id(3), op: { op: "fortify", points: [[22.5, 50], [23.2, 50.4]], level: 6 } });
  assert.match(s.ack(s.guest, id(3)).error, /ground you hold/);
  assert.deepEqual(lines(), []);
  // On its own ground it is built, for Russia, from the game's date.
  await s.request(s.guest, { t: "fortify", id: id(4), op: { op: "fortify", points: [[20, 50], [20.6, 50.4]], level: 6, name: "The Western Line" } });
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.deepEqual(lines().map((line) => [line.owner, line.level, line.name, line.building.since]), [[RUSSIA, 6, "The Western Line", "2014-04-01"]]);
  assert.ok(lines()[0].building.days >= 1);
  // Latvia cannot give up Russia's line; Russia can.
  await s.request(s.hostPlayer, { t: "fortify", id: id(5), op: { op: "unfortify", id: lines()[0].id } });
  assert.match(s.ack(s.hostPlayer, id(5)).error, /not one of yours/);
  assert.equal(lines().length, 1);
  // A line still being built is its owner's (decision 6); once it stands, everyone sees it.
  assert.equal(s.shown(s.guest).world.fortifications.length, 1);
  assert.equal(s.shown(s.hostPlayer).world.fortifications.length, 0);

  // A fleet: only the seat's own.
  await s.request(s.guest, { t: "fleet", id: id(6), op: { op: "posture", unit: "lv-fleet", posture: "withdrawing" } });
  assert.match(s.ack(s.guest, id(6)).error, /not a fleet of yours/);
  assert.equal(s.store.docs.world.units[1].posture, "holding");
  // Sent only to the sea.
  await s.request(s.guest, { t: "fleet", id: id(7), op: { op: "station", unit: "ru-fleet", to: [21, 54], order: "move" } });
  assert.match(s.ack(s.guest, id(7)).error, /not at sea/);
  await s.request(s.guest, { t: "fleet", id: id(8), op: { op: "station", unit: "ru-fleet", to: [21, 57.5], order: "move" } });
  assert.equal(s.ack(s.guest, id(8)).ok, true);
  assert.deepEqual([orderOf("ru-fleet").kind, orderOf("ru-fleet").toLng, orderOf("ru-fleet").toLat], ["move", 21, 57.5]);
  // A blockade of the enemy, from the water off its coast that the host's map finds.
  await s.request(s.guest, { t: "fleet", id: id(9), op: { op: "blockade", unit: "ru-fleet", country: LATVIA } });
  assert.equal(s.ack(s.guest, id(9)).ok, true);
  assert.deepEqual([s.store.docs.world.units[0].posture, orderOf("ru-fleet").toLng, orderOf("ru-fleet").toLat], ["blockade", 23.5, 55.6]);
  // The host's own fleet is the host's to command.
  await s.request(s.hostPlayer, { t: "fleet", id: id(10), op: { op: "posture", unit: "lv-fleet", posture: "assaulting" } });
  assert.equal(s.ack(s.hostPlayer, id(10)).ok, true);
  // Each sees its own fleet's standing order, and not the other's.
  assert.deepEqual(s.shown(s.guest).world.pendingUnitOrders.map((entry) => entry.unitId), ["ru-fleet"]);
  assert.deepEqual(s.shown(s.hostPlayer).world.pendingUnitOrders ?? [], []);
  // A posture needs no map; a station cannot be checked when the host's map could not be read.
  const asked = reads.length;
  await s.request(s.guest, { t: "fleet", id: id(11), op: { op: "posture", unit: "ru-fleet", posture: "patrol" } });
  assert.equal(reads.length, asked);
  readable = false;
  await s.request(s.guest, { t: "fleet", id: id(12), op: { op: "station", unit: "ru-fleet", to: [21, 57.5] } });
  assert.match(s.ack(s.guest, id(12)).error, /could not be read/);
  await s.request(s.guest, { t: "fortify", id: id(13), op: { op: "fortify", points: [[20, 51], [20.6, 51.4]], level: 4 } });
  assert.match(s.ack(s.guest, id(13)).error, /could not be read/);
  // What is no op of theirs is refused in words.
  await s.request(s.guest, { t: "fleet", id: id(14), op: { op: "sink", unit: "lv-fleet" } });
  assert.match(s.ack(s.guest, id(14)).error, /Nothing was asked/);
});

test("a player puts terms of peace to another player by name, and that player's own answer makes the peace", async (t) => {
  // "Peace between people: offers between players, each country making its own peace" (the owner, 2026-11-15).
  // The host answered every such proposal "That side is led by another player", and nothing else could be done.
  // (The engine reads who people play from the game while it hosts, runtime/humanPolities.js.)
  const { setHostingSharedGame } = await import("../../runtime/humanPolities.js");
  setHostingSharedGame(true, { host: LATVIA });
  t.after(() => setHostingSharedGame(false));
  const s = setup();
  s.store.docs.world.wars = [{ id: "war-1", title: "The Baltic War", status: "active", sideA: [RUSSIA], sideB: [LATVIA], startedDate: "2014-03-01" }];
  // Russia holds a region of Latvia's.
  s.store.docs.world.regionOwnershipOverrides = { "reg-latgale": RUSSIA };
  s.store.docs.world.regionSovereigntyOverrides = { "reg-latgale": LATVIA };
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const terms = { territory: "restored" };
  // Put to nobody by name, they are still refused: that side is a person's.
  await s.request(s.guest, { t: "peace", id: id(2), op: "propose", ref: "war-1", terms });
  assert.match(s.ack(s.guest, id(2)).error, /led by another player/);
  // Put to the host's country by name, they wait for the host's player.
  await s.request(s.guest, { t: "peace", id: id(3), op: "propose", ref: "war-1", terms, to: LATVIA });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  const offer = s.store.docs.world.peaceOffers.find((entry) => entry.status === "open");
  assert.deepEqual([offer.from, offer.to], [RUSSIA, LATVIA]);
  assert.ok(s.shown(s.hostPlayer).world.peaceOffers.some((entry) => entry.id === offer.id), "the one it is put to sees it");
  // Nobody answers it but the one it was put to.
  await s.request(s.guest, { t: "peace", id: id(4), op: "accept", ref: offer.id });
  assert.match(s.ack(s.guest, id(4)).error, /not yours to answer/);
  await s.request(s.hostPlayer, { t: "peace", id: id(5), op: "accept", ref: offer.id });
  assert.equal(s.ack(s.hostPlayer, id(5)).ok, true);
  assert.equal(s.store.docs.world.wars[0].status, "ended");
  // Made between rounds, it is told: an event on everyone's timeline with the ground it handed back, and a word to
  // every player. It moved the borders on every map with no event and no word (the gap audit of 2026-11-18).
  const told = s.store.docs.events.find((event) => event.id.startsWith("landing-peace-"));
  assert.equal(told.title, `Peace between ${RUSSIA} and ${LATVIA}`);
  assert.deepEqual(told.impacts.regionControlOps.map((op) => [op.regionId, op.fromCode, op.toCode]), [["reg-latgale", RUSSIA, LATVIA]]);
  assert.ok(s.store.docs.world.simulationHistory.some((entry) => entry.eventIds.includes(told.id)), "on the timeline");
  for (const player of [s.hostPlayer, s.guest]) {
    assert.ok(s.shown(player).events.some((event) => event.id === told.id && event.playerRelated), "theirs to read");
    assert.match(s.to(player, "notice").at(-1).text, /have made peace/);
  }
  // Answered again, nothing more is told.
  const events = s.store.docs.events.length;
  await s.request(s.hostPlayer, { t: "peace", id: id(6), op: "accept", ref: offer.id });
  assert.equal(s.store.docs.events.length, events);
});

test("two players sign a treaty: one puts it, the other signs it, and it is an agreement every view holds", async () => {
  // "Treaties and alliances between people: a sign action both must accept, which becomes a record the map, wars
  // and AI governments all see" (the owner, 2026-11-15).
  const { setHostingSharedGame } = await import("../../runtime/humanPolities.js");
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  setHostingSharedGame(true, { host: LATVIA });
  try {
    await s.host.control.start();
    // Only between two players: a country the AI plays makes its agreements in the story.
    await s.request(s.guest, { t: "treaty", id: id(2), op: "propose", to: ESTONIA, type: "alliance" });
    assert.match(s.ack(s.guest, id(2)).error, /signed between two players/);
    await s.request(s.guest, { t: "treaty", id: id(3), op: "propose", to: LATVIA, type: "non_aggression", title: "The Riga Pact", terms: "Neither attacks the other." });
    assert.equal(s.ack(s.guest, id(3)).ok, true);
    const offer = s.store.docs.world.treatyOffers[0];
    // The two's own business until it is signed.
    assert.equal(s.shown(s.hostPlayer).world.treatyOffers.length, 1);
    // Signed by the one it was put to, and nobody else.
    await s.request(s.guest, { t: "treaty", id: id(4), op: "sign", ref: offer.id });
    assert.match(s.ack(s.guest, id(4)).error, /not yours to answer/);
    await s.request(s.hostPlayer, { t: "treaty", id: id(5), op: "sign", ref: offer.id });
    assert.equal(s.ack(s.hostPlayer, id(5)).ok, true);
    const agreement = s.store.docs.world.agreements.at(-1);
    assert.deepEqual([agreement.type, agreement.title, agreement.status, agreement.parties], ["non_aggression", "The Riga Pact", "active", [RUSSIA, LATVIA]]);
    assert.ok(s.shown(s.guest).world.agreements.some((entry) => entry.id === agreement.id), "and every view holds it");
    // Signed between rounds, it is told as a peace is: an event, and a word to every player.
    assert.ok(!s.store.docs.events.some((event) => event.id.startsWith("landing-treaty-") && event.id !== `landing-treaty-${agreement.id}`), "only proposed, it was told to nobody");
    const told = s.store.docs.events.find((event) => event.id === `landing-treaty-${agreement.id}`);
    assert.equal(told.description, "The Riga Pact: Neither attacks the other.");
    assert.match(s.to(s.guest, "notice").at(-1).text, /have signed a treaty/);
  } finally {
    setHostingSharedGame(false);
  }
});

test("a treaty one player puts to another is seen by those two alone until it is signed", async () => {
  const { projectForViewer } = await import("./projection.js");
  const docs = { world: { treatyOffers: [{ id: "t1", from: RUSSIA, to: LATVIA, type: "alliance", status: "open" }] }, game: { country: LATVIA }, events: [], chat: [], actions: [] };
  const seen = (viewer) => projectForViewer(docs, viewer).world.treatyOffers.map((offer) => offer.id);
  assert.deepEqual([seen(RUSSIA), seen(LATVIA), seen(ESTONIA)], [["t1"], ["t1"], []]);
});

test("a player changes their own country's flag, and the host also those of the countries the AI plays", async () => {
  // "Own + host" (the owner, 2026-11-16): a flag changed on a page was answered "saved" and dropped.
  const set = [];
  const s = setup({ setFlag: async (change) => { set.push(change); } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const image = "data:image/png;base64,iVBORw0KGgo=";
  await s.request(s.guest, { t: "flag", id: id(2), country: RUSSIA, image });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  // Not another's: neither the host's country nor one the AI plays, for a guest.
  await s.request(s.guest, { t: "flag", id: id(3), country: LATVIA, image });
  assert.match(s.ack(s.guest, id(3)).error, /your own country/);
  await s.request(s.guest, { t: "flag", id: id(4), country: ESTONIA, image });
  assert.match(s.ack(s.guest, id(4)).error, /your own country/);
  // The host: its own, and a country the AI plays; never a player's.
  await s.request(s.hostPlayer, { t: "flag", id: id(5), country: ESTONIA, image: "" });
  assert.equal(s.ack(s.hostPlayer, id(5)).ok, true);
  await s.request(s.hostPlayer, { t: "flag", id: id(6), country: RUSSIA, image });
  assert.match(s.ack(s.hostPlayer, id(6)).error, /your own country/);
  assert.deepEqual(set, [{ country: RUSSIA, image }, { country: ESTONIA, image: "" }]);
  // Only an image, and only so big.
  assert.equal(validate(PLAYER_REQUESTS.flag, { t: "flag", id: id(7), country: RUSSIA, image: "javascript:alert(1)" }).ok, false);
});

// The ranking of a shared game stayed empty: a page rated nothing, and the host only the countries at war after a
// round (the gap audit of 2026-11-18).
test("countries' military figures are rated for a player's Stats pane, by the host's AI, only where a country of this game has none", async () => {
  const rated = [];
  const figures = { quality: 50, technology: 50, land: 50, sea: 50, air: 50, spending: 50, manpowerShare: 10, cavalryShare: 0.1, siegeShare: 0.1 };
  // The host's AI rates what it is asked, written into the game as the engine's commit does.
  const s = setup({ rateMilitary: async (info) => {
    rated.push(info);
    for (const country of info.countries) s.store.docs.world.countryStats[country] = { population: { total: 2e6 }, military: figures };
  } });
  s.store.docs.world.countryStats = { [ESTONIA]: { population: { total: 1.3e6 }, military: { quality: 60, technology: 60, land: 40, sea: 30, air: 30, spending: 55, manpowerShare: 8, cavalryShare: 0.1, siegeShare: 0.1 } } };
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "ratings", id: id(2), countries: [ESTONIA, LATVIA, RUSSIA, "Atlantis"] });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual(rated, [{ countries: [LATVIA, RUSSIA] }], "Estonia is rated already, and Atlantis no country of this game");
  // Nothing left to rate, nothing asked.
  await s.request(s.guest, { t: "ratings", id: id(3), countries: [ESTONIA] });
  assert.equal(rated.length, 1);
  assert.equal(validate(PLAYER_REQUESTS.ratings, { t: "ratings", id: id(4), countries: Array.from({ length: 301 }, (_, n) => `C${n}`) }).ok, false, "a list held to its size");
});

// A rating the host's AI did not make was answered as made, and the ranking stayed part empty with nothing to say
// for it (the review of 2026-11-18, wars 9): the player is told, with the host's reason.
test("a rating the host's AI does not make is said, with why", async () => {
  let answer = null;
  const s = setup({ rateMilitary: async () => answer });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "ratings", id: id(2), countries: [ESTONIA] });
  assert.equal(s.ack(s.guest, id(2)).error, `The host's AI gave no military figures for ${ESTONIA}.`);
  answer = { refused: "The host's AI has made all the background readings it makes in a day: the rest of these figures wait until tomorrow." };
  await s.request(s.guest, { t: "ratings", id: id(3), countries: [ESTONIA, LATVIA] });
  assert.match(s.ack(s.guest, id(3)).error, /all the background readings it makes in a day/);
  // What it did rate is no refusal.
  s.store.docs.world.countryStats = { [ESTONIA]: { population: { total: 1.3e6 }, military: { quality: 60, technology: 60, land: 40, sea: 30, air: 30, spending: 55, manpowerShare: 8, cavalryShare: 0.1, siegeShare: 0.1 } } };
  await s.request(s.guest, { t: "ratings", id: id(4), countries: [ESTONIA] });
  assert.equal(s.ack(s.guest, id(4)).ok, true);
});

// With each player's own AI, a reading was left to whoever asked last: two players opening one country both paid,
// and the first was told its figures were refused (the review of 2026-11-18, cost 7).
test("with each player's own AI, a reading is left once, to the first to ask, until it comes back or its time is up", async () => {
  const s = setup({ settings: { replies: "own" }, takeRatings: async () => [] });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "sheet", id: id(2), country: ESTONIA });
  assert.deepEqual(s.ack(s.guest, id(2)).result, { answer: "own" });
  // The host opens it a moment later: told it is being written, and nothing is left to its device.
  await s.request(s.hostPlayer, { t: "sheet", id: id(3), country: ESTONIA });
  assert.equal(s.ack(s.hostPlayer, id(3)).error, "Its figures are being written on another player's device: they show here when they are done.");
  // The first's figures are taken, as ever.
  await s.request(s.guest, { t: "ownSheet", id: id(4), country: ESTONIA, sheet: { capital: "Tallinn", stability: 60 } });
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  // Parties and ratings the same way.
  await s.request(s.guest, { t: "parties", id: id(5), country: ESTONIA });
  assert.deepEqual(s.ack(s.guest, id(5)).result, { answer: "own" });
  await s.request(s.hostPlayer, { t: "parties", id: id(6), country: ESTONIA });
  assert.match(s.ack(s.hostPlayer, id(6)).error, /being filled in on another player's device/);
  await s.request(s.guest, { t: "ratings", id: id(7), countries: [ESTONIA] });
  assert.deepEqual(s.ack(s.guest, id(7)).result, { answer: "own", countries: [ESTONIA] });
  await s.request(s.hostPlayer, { t: "ratings", id: id(8), countries: [ESTONIA] });
  assert.deepEqual([s.ack(s.hostPlayer, id(8)).ok, s.ack(s.hostPlayer, id(8)).result], [true, undefined], "nothing left to the second: the figures come with the view");
  // A device that never sends its reading back holds it only for a while: then the next to ask has it.
  await s.clock.advance(5 * 60 * 1000 + 1);
  await s.request(s.hostPlayer, { t: "ratings", id: id(9), countries: [ESTONIA] });
  assert.deepEqual(s.ack(s.hostPlayer, id(9)).result, { answer: "own", countries: [ESTONIA] });
  await s.request(s.guest, { t: "ownRatings", id: id(10), ratings: [{ country: ESTONIA, military: { quality: 50 } }] });
  assert.match(s.ack(s.guest, id(10)).error, /not left to your device/, "the reading is the second's now");
});

test("with each player's own AI, countries' figures are left to the asking device, and taken from it once, only for what it was left", async () => {
  const taken = [];
  const rated = [];
  const s = setup({ settings: { replies: "own" }, rateMilitary: async ({ countries }) => { rated.push(...countries); }, takeRatings: async (ratings) => { taken.push(...ratings); } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "ratings", id: id(2), countries: [ESTONIA, LATVIA, RUSSIA] });
  const answer = s.ack(s.guest, id(2));
  assert.equal(validate(HOST_MESSAGES.ack, answer).ok, true);
  assert.deepEqual(answer.result, { answer: "own", countries: [ESTONIA] }, "the host's country is the host's own device's to rate");
  // Its own country's figures are the host's AI's to rate (host/ownReadings.js).
  assert.deepEqual(rated, [RUSSIA]);
  const figures = { quality: 55, technology: 50, land: 60, sea: 20, air: 30, spending: 45, manpowerShare: 10, cavalryShare: 0.1, siegeShare: 0.1 };
  // Figures for a country not left to it are refused; those left to it are taken once.
  await s.request(s.guest, { t: "ownRatings", id: id(3), ratings: [{ country: LATVIA, military: figures }] });
  assert.match(s.ack(s.guest, id(3)).error, /not left to your device/);
  await s.request(s.guest, { t: "ownRatings", id: id(4), ratings: [{ country: ESTONIA, military: figures, population: 1.3e6 }, { country: LATVIA, military: figures }] });
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.deepEqual(taken, [{ name: ESTONIA, military: figures, population: 1.3e6 }]);
  await s.request(s.guest, { t: "ownRatings", id: id(5), ratings: [{ country: ESTONIA, military: figures }] });
  assert.match(s.ack(s.guest, id(5)).error, /not left to your device/, "once");
});

test("a country's parties are filled in once, by the host's AI or the asker's own, as a stat sheet is", async () => {
  // "Like sheets" (the owner, 2026-11-16): on a page they were read on the player's key and kept nowhere.
  const s = setup({ settings: { replies: "own" } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "parties", id: id(2), country: ESTONIA });
  assert.deepEqual([s.ack(s.guest, id(2)).ok, s.ack(s.guest, id(2)).result, s.compiled], [true, { answer: "own" }, []]);
  await s.request(s.guest, { t: "ownParties", id: id(3), country: ESTONIA, landscape: { parties: [{ name: "Isamaa", role: "governing" }] } });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.equal(s.shown(s.hostPlayer).world.politicalActors.byPolity[ESTONIA].parties[0].name, "Isamaa");
  // Filled in, they stand: asked again, nobody's AI is asked.
  await s.request(s.guest, { t: "parties", id: id(4), country: ESTONIA });
  assert.deepEqual([s.ack(s.guest, id(4)).result, s.compiled], [undefined, []]);
  // With the host's AI answering, the host fills them in.
  s.host.control.setReplies("host");
  await s.request(s.guest, { t: "ownParties", id: id(5), country: LATVIA, landscape: { parties: [] } });
  assert.match(s.ack(s.guest, id(5)).error, /host's AI fills in the parties/);
  await s.request(s.guest, { t: "parties", id: id(6), country: LATVIA });
  assert.deepEqual([s.ack(s.guest, id(6)).ok, s.compiled], [true, [LATVIA]]);
});

test("a goal's progress, read on the player's own device, is kept with that player's goal alone", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "goal", id: id(2), text: "Hold the Baltic coast" });
  await s.request(s.guest, { t: "goalProgress", id: id(3), goal: "Hold the Baltic coast", reading: { progress: 40, summary: "Halfway there." } });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.equal(s.shown(s.guest).world.playerGoals[RUSSIA].progress.progress, 40);
  assert.equal(s.shown(s.hostPlayer).world.playerGoals?.[RUSSIA], undefined, "nobody else sees it");
  await s.request(s.guest, { t: "goalProgress", id: id(4), goal: "Another goal", reading: { progress: 90, summary: "" } });
  assert.match(s.ack(s.guest, id(4)).error, /goal has changed/);
});

// FOLLOWUPS A10: the goal request rewrote world.json when its words had not changed.
test("a goal sent again in the same words writes nothing, and keeps its reading", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "goal", id: id(2), text: "Hold the Baltic coast" });
  await s.request(s.guest, { t: "goalProgress", id: id(3), goal: "Hold the Baltic coast", reading: { progress: 40, summary: "Halfway there." } });
  const world = s.store.docs.world;
  await s.request(s.guest, { t: "goal", id: id(4), text: " Hold the  Baltic coast " });
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.equal(s.store.docs.world, world, "world.json is not written again");
  assert.equal(s.store.docs.world.playerGoals[RUSSIA].progress.progress, 40);
});

test("a demand made or answered rides on its line, entered by the host by the game's own rules", async () => {
  // On a page "make this a demand" and a demand card's answer were entries of the thread's log, dropped: only the
  // words reached the host. Russia (the guest) is the host's Latvia's overlord here.
  const s = setup();
  s.store.docs.world.puppets = [{ id: "p1", overlord: RUSSIA, puppet: LATVIA, kind: "satellite", status: "active", secrecy: "open", loyalty: 60 }];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [LATVIA], text: "We must talk." });
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA).id;
  const held = () => s.store.docs.chat.find((chat) => chat.id === thread);
  await s.request(s.guest, { t: "say", id: id(3), thread, to: [], text: "Close your ports to our enemies.", demand: { op: "make" } });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  const made = held().events.find((event) => event.kind === "demand_made");
  assert.deepEqual([made.by, made.target, made.summary], [RUSSIA, LATVIA, "Close your ports to our enemies."]);
  // Only the overlord makes one: Latvia cannot demand of Russia.
  await s.request(s.hostPlayer, { t: "say", id: id(4), thread, to: [], text: "And you, ours.", demand: { op: "make" } });
  assert.match(s.ack(s.hostPlayer, id(4)).error, /not a demand you can make or answer/);
  // The puppet answers it from its card; the overlord cannot answer for it.
  await s.request(s.guest, { t: "say", id: id(5), thread, to: [], text: "We accept.", demand: { op: "answer", demandId: made.demandId, answer: "accepted" } });
  assert.match(s.ack(s.guest, id(5)).error, /not a demand you can make or answer/);
  await s.request(s.hostPlayer, { t: "say", id: id(6), thread, to: [], text: "We refuse this demand.", demand: { op: "answer", demandId: made.demandId, answer: "refused" } });
  assert.equal(s.ack(s.hostPlayer, id(6)).ok, true);
  assert.equal(held().demands.find((demand) => demand.id === made.demandId).status, "refused");
  assert.ok(held().messages.some((message) => message.text === "We refuse this demand."), "with its line");
});

test("a vote is called with its line, in a thread the line opens too, and each person in it votes once, by a choice it has", async () => {
  // Neither could be done in a shared game: a vote called on a page was an entry of the thread's log, dropped, and a
  // ballot was not offered at all.
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  // The line that opens a conversation calls its vote: one choice twice is one choice.
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [LATVIA, ESTONIA], text: "I call a vote: A summit in Riga?", poll: { question: "A summit in Riga?", options: ["Yes", "No", "Yes"] } });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA).id;
  const held = () => s.store.docs.chat.find((chat) => chat.id === thread);
  const called = held().events.find((event) => event.kind === "poll_created");
  assert.deepEqual([called.by, called.question, called.options.map((option) => option.label)], [RUSSIA, "A summit in Riga?", ["Yes", "No"]]);
  const said = held().events.findIndex((event) => event.kind === "message" && event.text === "I call a vote: A summit in Riga?");
  assert.ok(said >= 0 && said < held().events.indexOf(called), "the line, then its vote");
  assert.equal(held().polls[0].question, "A summit in Riga?");
  // Each votes for itself, once.
  const [yes, no] = called.options;
  await s.request(s.hostPlayer, { t: "vote", id: id(3), thread, poll: called.pollId, option: no.id });
  assert.equal(s.ack(s.hostPlayer, id(3)).ok, true);
  await s.request(s.hostPlayer, { t: "vote", id: id(4), thread, poll: called.pollId, option: yes.id });
  assert.match(s.ack(s.hostPlayer, id(4)).error, /voted in it already/);
  await s.request(s.guest, { t: "vote", id: id(5), thread, poll: called.pollId, option: "no-such-option" });
  assert.match(s.ack(s.guest, id(5)).error, /no choice of that vote/);
  await s.request(s.guest, { t: "vote", id: id(6), thread, poll: called.pollId, option: yes.id });
  assert.equal(s.ack(s.guest, id(6)).ok, true);
  assert.deepEqual(held().polls[0].votes, { [LATVIA]: no.id, [RUSSIA]: yes.id });
  assert.equal(s.shown(s.guest).chat.find((chat) => chat.id === thread).polls[0].votes[LATVIA], no.id, "everyone in it sees each vote");
  await s.request(s.guest, { t: "vote", id: id(7), thread: "no-such-thread", poll: called.pollId, option: yes.id });
  assert.match(s.ack(s.guest, id(7)).error, /not in that conversation/);
  // A vote of two is a question: none is called between two countries alone.
  await s.request(s.guest, { t: "say", id: id(8), thread: null, to: [LATVIA], text: "I call a vote: Peace?", poll: { question: "Peace?", options: ["Yes", "No"] } });
  assert.match(s.ack(s.guest, id(8)).error, /conversation of several countries/);
});

test("with each player's own AI, a vote called at a table of governments is answered on the host, so they vote in it", async () => {
  // A device writes the governments' words alone: a vote called with "own" replies stood with people's ballots only
  // (the gap audit of 2026-11-18). Its ballots are cast in the host's own turn, while a government there has none,
  // within the host's answers a player has a round (settings.hostAnswers).
  const s = setup({ settings: { replies: "own", hostAnswers: 2 } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA, LATVIA], text: "I call a vote: A summit?", poll: { question: "A summit?", options: ["Yes", "No"] } });
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  assert.deepEqual(s.ack(s.guest, id(2)).result, { chatId: thread.id }, "no device is asked");
  await s.clock.flush();
  assert.deepEqual(s.replies, [{ chatId: thread.id, seat: RUSSIA }], "the host's own turn, which votes");
  // Still unvoted by Estonia: the next line is the host's too.
  await s.request(s.guest, { t: "say", id: id(3), thread: thread.id, to: [], text: "Tallinn, your vote?" });
  assert.equal(s.ack(s.guest, id(3)).result, undefined);
  // Estonia has voted (its turn on the host cast it): words alone again, on the device.
  const held = s.store.docs.chat.find((chat) => chat.id === thread.id);
  const called = held.events.find((event) => event.kind === "poll_created");
  held.events.push({ id: "vote-ee", kind: "poll_vote_cast", time: "2014-04-01", by: ESTONIA, pollId: called.pollId, optionId: called.options[0].id });
  await s.request(s.guest, { t: "say", id: id(4), thread: thread.id, to: [], text: "Thank you." });
  assert.equal(s.ack(s.guest, id(4)).result.answer, "own");
  assert.deepEqual(s.ack(s.guest, id(4)).result.governments, [ESTONIA]);
});

test("writing to a player who has gone: told they are away, and once the AI has their country its government answers", async () => {
  // Nobody answered in a thread a leaver had opened, and nobody was told (the gap audit of 2026-11-18).
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [LATVIA], text: "Moscow to Riga." });
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA).id;
  s.host.leave(s.guest);
  await s.clock.flush();
  await s.request(s.hostPlayer, { t: "say", id: id(3), thread, to: [], text: "Riga answers Moscow." });
  assert.equal(s.ack(s.hostPlayer, id(3)).ok, true);
  assert.match(s.to(s.hostPlayer, "notice").at(-1).text, /Russian Federation's player is away, and will read it on coming back\./);
  assert.deepEqual(s.replies, [], "a person, away, is not answered for");
  // The grace runs out: the AI plays Russia, and its government answers in the thread its player opened.
  await s.clock.advance(2 * 60_000);
  await s.request(s.hostPlayer, { t: "say", id: id(4), thread, to: [], text: "Riga asks again." });
  await s.clock.flush();
  assert.deepEqual(s.replies, [{ chatId: thread, seat: LATVIA }]);
});

test("a Retry asks the host for the governments' answer to the player's last line again, and sends no line", async () => {
  // A group Retry sent its line a second time, and a one-on-one one asked the player's own key for a reply the host
  // never took (the gap audit of 2026-11-18).
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  const thread = () => s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  await s.clock.flush();
  assert.equal(s.replies.length, 1);
  // The host's AI could not answer: the line stands unanswered, and the player asks again.
  await s.request(s.guest, { t: "answer", id: id(3), thread: thread().id });
  assert.equal(validate(PLAYER_REQUESTS.answer, { t: "answer", id: id(3), thread: thread().id }).ok, true);
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  await s.clock.flush();
  assert.deepEqual(s.replies.at(-1), { chatId: thread().id, seat: RUSSIA });
  assert.equal(thread().messages.length, 1, "the line is not sent again");
  // Answered meanwhile, it is not answered twice.
  thread().messages.push({ id: "m-ee", role: "leader", speaker: ESTONIA, text: "Tallinn hears you." });
  await s.request(s.guest, { t: "answer", id: id(4), thread: thread().id });
  assert.match(s.ack(s.guest, id(4)).error, /answered already/);
  // Only in a thread of its own, and only where a government the AI plays sits.
  await s.request(s.guest, { t: "answer", id: id(5), thread: "chat-lv-est" });
  assert.match(s.ack(s.guest, id(5)).error, /not in that conversation/);
  await s.request(s.guest, { t: "say", id: id(6), thread: null, to: [LATVIA], text: "Moscow to Riga." });
  const people = s.store.docs.chat.find((chat) => chat.player === RUSSIA && chat.countries.some((country) => country.name === LATVIA));
  await s.request(s.guest, { t: "answer", id: id(7), thread: people.id });
  assert.match(s.ack(s.guest, id(7)).error, /Nobody at that table/);

  // With each player's own AI, the device is told to write it, for the line it is.
  s.host.control.setReplies("own");
  thread().messages.push({ id: "m-ru-2", role: "user", speaker: RUSSIA, code: RUSSIA, text: "And Narva?" });
  await s.request(s.guest, { t: "answer", id: id(8), thread: thread().id });
  assert.deepEqual(s.ack(s.guest, id(8)).result, { answer: "own", line: "m-ru-2", governments: [ESTONIA] });
  await s.request(s.guest, { t: "reply", id: id(9), thread: thread().id, line: "m-ru-2", lines: [{ speaker: ESTONIA, text: "Narva stays ours." }] });
  assert.equal(s.ack(s.guest, id(9)).ok, true);
});

test("the advisor's conversation is the seat's: kept by the host, written by it alone, in that seat's view only", async () => {
  // It lived in each guest's local stand-in, lost with a new invite code or on another device, and the host's file had
  // two writers, its screen and its engine (the gap audit of 2026-11-18).
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  assert.deepEqual(s.shown(s.guest).advisor, [], "a guest's own, empty at first; never the host's");
  assert.deepEqual(s.shown(s.hostPlayer).advisor, [{ role: "user", text: "Riga asks its advisor." }]);
  // The guest's screen saves a line and its advisor's answer: what changed, asked of the host.
  const asked = [{ role: "user", text: "Moscow asks." }, { role: "advisor", id: "reply-1", text: "Moscow is told." }];
  const changes = advisorChangesOf([], asked);
  await s.request(s.guest, { t: "advisor", id: id(2), ...changes });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual(s.shown(s.guest).advisor.map((entry) => entry.text), ["Moscow asks.", "Moscow is told."]);
  assert.deepEqual(s.shown(s.hostPlayer).advisor, [{ role: "user", text: "Riga asks its advisor." }], "the host's is as it was");
  assert.equal(JSON.stringify(s.to(s.hostPlayer, "view")).includes("Moscow asks."), false, "and no view of the host's carries the guest's");
  // The host's own screen saves through the same door: the file itself is the host's conversation.
  const hostHad = s.shown(s.hostPlayer).advisor;
  await s.request(s.hostPlayer, { t: "advisor", id: id(3), ...advisorChangesOf(hostHad, [...hostHad, { role: "user", text: "Riga again." }]) });
  assert.deepEqual(advisorOfSeat(s.store.docs.advisor, LATVIA, { gameCountry: LATVIA }).map((entry) => entry.text), ["Riga asks its advisor.", "Riga again."]);
  // The same device on a new connection (another invite code, a reconnect) is sent it whole.
  const again = { id: "p-guest-2", device: "device-guest", name: "Guest" };
  s.host.leave(s.guest);
  s.host.join(again);
  await s.clock.flush();
  assert.deepEqual(s.shown(again).advisor.map((entry) => entry.text), ["Moscow asks.", "Moscow is told."]);
  // What does not hold is refused with the reason, and nothing is written.
  await s.request(again, { t: "advisor", id: id(4), threads: [{ thread: "advisor-nobody-1", keep: 0, messages: [{ role: "user", text: "Hello?" }], clear: false }] });
  assert.match(s.ack(again, id(4)).error, /unknown Advisor conversation/);
  // A seat let go takes its player's counsel with it: the next player of that country starts with none.
  s.host.control.kick(RUSSIA);
  await s.clock.flush();
  assert.deepEqual(advisorOfSeat(s.store.docs.advisor, RUSSIA, { gameCountry: LATVIA }), []);
  assert.deepEqual(advisorOfSeat(s.store.docs.advisor, LATVIA, { gameCountry: LATVIA }).length, 2);
});

test("an order keeps the id its screen gave it: queued once, never another's, given other words or withdrawn by its owner", async () => {
  // It went as its words alone and the host gave it an id of its own: an AI suggestion's card never said it was queued
  // (a second press queued it again), and an advisor's proposal could not be approved at all.
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const queued = () => s.store.docs.actions.filter((action) => action.id === "suggestion-7");
  await s.request(s.guest, { t: "order", id: id(2), text: "Call up the reserves.", ref: "suggestion-7", title: "Mobilise", source: "suggested" });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual(queued().map((action) => [action.ownerCode, action.title, action.text, action.source, action.status]), [[RUSSIA, "Mobilise", "Call up the reserves.", "suggested", "planned"]]);
  // Asked again (a lost answer, a second press): one order.
  await s.request(s.guest, { t: "order", id: id(3), text: "Call up the reserves.", ref: "suggestion-7" });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.equal(queued().length, 1);
  await s.request(s.guest, { t: "order", id: id(4), text: "Something else.", ref: "suggestion-7" });
  assert.match(s.ack(s.guest, id(4)).error, /other words/);
  await s.request(s.hostPlayer, { t: "order", id: id(5), text: "Call up the reserves.", ref: "suggestion-7" });
  assert.match(s.ack(s.hostPlayer, id(5)).error, /someone else's/);
  // An order that opens a conversation keeps whom it invites and its opening line.
  await s.request(s.guest, { t: "order", id: id(6), text: "Open talks.", ref: "s-8", kind: "chat", invitees: [ESTONIA], chatStarter: "Shall we talk?" });
  const talks = s.store.docs.actions.find((action) => action.id === "s-8");
  assert.deepEqual([talks.kind, talks.invitees, talks.chatStarter], ["chat", [ESTONIA], "Shall we talk?"]);
  await s.request(s.guest, { t: "order", id: id(7), text: "Open talks.", kind: "chat", invitees: ["Atlantis"] });
  assert.match(s.ack(s.guest, id(7)).error, /Unknown country/);
  // Given other words by its owner alone; the rest of it stays.
  await s.request(s.hostPlayer, { t: "reword", id: id(8), order: "suggestion-7", title: "Mine now" });
  assert.match(s.ack(s.hostPlayer, id(8)).error, /not one of your queued orders/);
  await s.request(s.guest, { t: "reword", id: id(9), order: "suggestion-7", title: "Mobilise at once" });
  assert.equal(s.ack(s.guest, id(9)).ok, true);
  assert.deepEqual(queued().map((action) => [action.title, action.text, action.source]), [["Mobilise at once", "Call up the reserves.", "suggested"]]);
  await s.request(s.guest, { t: "unorder", id: id(10), order: "suggestion-7" });
  assert.equal(s.ack(s.guest, id(10)).ok, true);
  assert.equal(queued().length, 0);
  // An order the screen named no id for is given one, as before.
  await s.request(s.guest, { t: "order", id: id(11), text: "Hold the line." });
  assert.ok(s.store.docs.actions.find((action) => action.text === "Hold the line.").id.startsWith("order-"));
});

test("a conversation is renamed, given countries and closed for everyone in it, by someone in it", async () => {
  // "All shared" (the owner, 2026-11-16): on the asker's screen alone these were dropped, the thread came back, the
  // name reverted, and an added country never heard a word.
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [LATVIA], text: "Shall we talk?" });
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  const held = () => s.store.docs.chat.find((chat) => chat.id === thread.id);
  // Renamed, by someone in it: everyone in it sees the name.
  await s.request(s.hostPlayer, { t: "thread", id: id(3), op: "rename", thread: thread.id, title: "The Baltic talks" });
  assert.equal(s.ack(s.hostPlayer, id(3)).ok, true);
  assert.equal(held().title, "The Baltic talks");
  assert.equal(s.shown(s.guest).chat.find((chat) => chat.id === thread.id).title, "The Baltic talks");
  // Given a country: it is in the thread now, for the next line to reach.
  await s.request(s.guest, { t: "thread", id: id(4), op: "add", thread: thread.id, members: [ESTONIA] });
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.deepEqual(held().countries.map((entry) => entry.name).sort(), [ESTONIA, LATVIA].sort());
  assert.ok(held().events.some((event) => event.kind === "member_joined" && event.member.name === ESTONIA && event.by === RUSSIA));
  await s.request(s.guest, { t: "thread", id: id(5), op: "add", thread: thread.id, members: ["Atlantis"] });
  assert.match(s.ack(s.guest, id(5)).error, /Unknown country/);
  // Closed for everyone in it.
  await s.request(s.guest, { t: "thread", id: id(7), op: "close", thread: thread.id });
  assert.equal(s.ack(s.guest, id(7)).ok, true);
  assert.equal(held().status, "closed");
  assert.equal(s.shown(s.hostPlayer).chat.find((chat) => chat.id === thread.id)?.status ?? "closed", "closed");
  await s.request(s.guest, { t: "thread", id: id(8), op: "rename", thread: "no-such-thread", title: "x" });
  assert.match(s.ack(s.guest, id(8)).error, /not in that conversation/);
});

test("a city struck from the air is the host's own map's: how many live there is never the page's to say", async () => {
  // A guest's page sent the people of the city it struck, and the host took the figure: fifty million "killed"
  // in a town of thousands, as the page liked. The host now looks the city up on its own map.
  let readable = true;
  const cityMap = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { city: "Riga", population: 600000 }, geometry: { type: "Point", coordinates: [24.1, 56.95] } },
      { type: "Feature", properties: { city: "Daugavpils", population: 80000 }, geometry: { type: "Point", coordinates: [26.5, 55.87] } },
    ],
  };
  const s = setup({ readCities: async () => (readable ? cityMap : null) });
  s.store.docs.world.units = [{ id: "ru-air", name: "6th Air Army", type: "air", ownerCode: RUSSIA, strength: 90, lng: 28.3, lat: 57.8, status: "idle" }];
  s.store.docs.world.wars = [{ id: "war-1", status: "active", sideA: [RUSSIA], sideB: [LATVIA] }];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const strike = () => (s.store.docs.world.airStrikeOrders ?? [])[0] ?? null;
  const asked = { op: "airstrike", unit: "ru-air", kind: "city", to: [24.1, 56.95], target: "Riga", country: LATVIA, people: 50000000 };

  await s.request(s.guest, { t: "airstrike", id: id(2), op: asked });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual([strike().target, strike().people, strike().owner], ["Riga", 600000, RUSSIA]);
  // As many as the host's world says live there now: a figure the game set for the city stands over the map's.
  s.store.docs.world.cityPopulations = { riga: 450000 };
  await s.request(s.guest, { t: "airstrike", id: id(3), op: { ...asked, radius: 1.5 } });
  assert.deepEqual([strike().people, strike().radius], [450000, 1.5]);
  // A city the host's map does not have there is refused.
  await s.request(s.guest, { t: "airstrike", id: id(4), op: { ...asked, target: "Atlantis" } });
  assert.match(s.ack(s.guest, id(4)).error, /which city/);
  // Where the host's map of cities could not be read, its people are unknown: still not the page's figure.
  readable = false;
  await s.request(s.guest, { t: "airstrike", id: id(5), op: asked });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
  assert.equal(strike().people, 0);
});

test("an order given while a round is resolved waits behind it and is the next round's; one given as its events are read is taken at once", async () => {
  // A player gave three orders as the round's events came in, was refused
  // ("Orders are taken while a round is being planned"), and gave them again.
  // Then one given while the round was resolved was refused too; and before
  // that, one already being applied when the round began was overwritten by
  // the round, after an "ok". Now each waits its turn in the one queue.
  let release;
  const atTheRound = [];
  const s = setup({
    holdResolve: new Promise((resolve) => { release = resolve; }),
    roundWrites: (docs) => atTheRound.push(docs.actions.map((action) => action.text)),
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  const waiting = s.host.receive(s.guest, { t: "order", id: id(4), text: "Send missiles to Abkhazia" });
  await s.clock.flush();
  assert.equal(s.ack(s.guest, id(4)), undefined, "answered once it is applied, not refused");
  assert.equal(s.store.docs.actions.some((action) => action.text === "Send missiles to Abkhazia"), false);
  release();
  await waiting;
  await s.clock.flush();
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.deepEqual(atTheRound, [["Open talks with Estonia"]], "the round's skip did not have it: it is the next round's");
  assert.equal(s.to(s.guest, "round").at(-1).phase, "revealing");
  const queued = s.store.docs.actions.find((action) => action.text === "Send missiles to Abkhazia");
  assert.equal(queued.ownerCode, RUSSIA);
  assert.equal(queued.status, "planned");
  // And taken back, while the events are still read.
  await s.request(s.guest, { t: "unorder", id: id(6), order: queued.id });
  assert.equal(s.ack(s.guest, id(6)).ok, true);
});

test("a request that waits for the round being resolved is said to at once, and answered once the round has landed", async () => {
  // A guest pressed Found while the world moved: after the screen's own 30
  // seconds it read "The host did not answer.", and when the round landed the
  // host founded it, so a second press founded it twice (the review of
  // 2026-11-18, door 1). The host now says at once that the request waits, and
  // the page waits for its answer.
  let release;
  let thinking;
  const s = setup({
    holdResolve: new Promise((resolve) => { release = resolve; }),
    // An institution's business asks the AI first and writes after: here it is
    // still thinking when the round begins.
    institution: async () => {
      await new Promise((resolve) => { thinking = resolve; });
      return { institutionId: "baltic-pact" };
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const founding = s.host.receive(s.guest, { t: "institution", id: id(2), call: "lifecycle", args: { command: { type: "found", name: "Baltic Pact" } } });
  await s.clock.flush();
  assert.deepEqual(s.to(s.guest, "held"), [], "nothing holds it yet");
  await s.request(s.hostPlayer, { t: "ready", id: id(3), value: true });
  await s.request(s.guest, { t: "ready", id: id(4), value: true });
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  assert.deepEqual(s.to(s.guest, "held").map((message) => message.id), [id(2)], "the round began while it was thinking: what it writes waits");
  assert.equal(s.to(s.guest, "held").every((message) => validate(HOST_MESSAGES.held, message).ok), true);
  assert.deepEqual(s.to(s.hostPlayer, "held"), [], "a ready is answered at once, never held");
  // Asked while the round is resolved: said at once.
  const order = s.host.receive(s.guest, { t: "order", id: id(5), text: "Hold the line at Pskov" });
  await s.clock.flush();
  assert.deepEqual(s.to(s.guest, "held").map((message) => message.id), [id(2), id(5)]);
  assert.equal(s.ack(s.guest, id(5)), undefined, "and answered only once it is applied");
  // The page reconnected and sent it again: told again on its new connection.
  s.host.leave(s.guest);
  const back = { ...s.guest, id: "p-guest-2" };
  s.host.join(back);
  await s.request(back, { t: "order", id: id(5), text: "Hold the line at Pskov" });
  assert.deepEqual(s.to(back, "held").map((message) => message.id), [id(5)]);
  release();
  thinking();
  await Promise.all([founding, order]);
  await s.clock.flush();
  assert.equal(s.ack(back, id(5)).ok, true);
  assert.equal(s.ack(back, id(2)).ok, true);
  assert.equal(s.to(back, "held").length, 1, "each is said once");
});

test("a request sent again after a reconnect is applied once, and answered as the first time", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "order", id: id(2), text: "Hold the line at Narva" });
  const first = s.ack(s.guest, id(2));
  // The page did not hear the answer, reconnected, and sent the same request again.
  s.host.leave(s.guest);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "order", id: id(2), text: "Hold the line at Narva" });
  const answers = s.to(s.guest, "ack").filter((ack) => ack.id === id(2));
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[1], first);
  assert.equal(s.store.docs.actions.filter((action) => action.text === "Hold the line at Narva").length, 1, "applied once");
});

test("what is written while a round is resolved waits behind it, in the order it was sent, dated by the round it lands in", async () => {
  // A letter between people written during a round could be lost to the
  // round's own saving of the conversations; letters to the AI and goals were
  // refused. Now each waits its turn and lands after the round.
  let release;
  const s = setup({
    holdResolve: new Promise((resolve) => { release = resolve; }),
    roundWrites: (docs) => { docs.game.gameDate = "2014-05-01"; },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  const sent = [
    s.host.receive(s.guest, { t: "say", id: id(4), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." }),
    s.host.receive(s.hostPlayer, { t: "say", id: id(5), thread: "chat-lv-est", to: [], text: "Riga again." }),
    s.host.receive(s.guest, { t: "goal", id: id(6), text: "Take Narva" }),
    s.host.receive(s.guest, { t: "say", id: id(7), thread: null, to: [LATVIA], text: "Moscow to Riga." }),
  ];
  await s.clock.flush();
  for (const n of [4, 6, 7]) assert.equal(s.ack(s.guest, id(n)), undefined);
  assert.equal(s.store.docs.chat.length, 1, "nothing written while the round is resolved");
  release();
  await Promise.all(sent);
  await s.clock.flush();
  for (const n of [4, 6, 7]) assert.equal(s.ack(s.guest, id(n)).ok, true);
  assert.equal(s.ack(s.hostPlayer, id(5)).ok, true);
  const lines = s.store.docs.chat.flatMap((chat) => chat.messages ?? []).filter((message) => /Moscow|Riga again/.test(message.text));
  assert.deepEqual(lines.map((message) => message.text).sort(), ["Moscow to Riga.", "Moscow to Tallinn.", "Riga again."]);
  assert.ok(lines.every((message) => message.time === "2014-05-01"), "dated by the round they landed in");
  assert.ok(s.replies.some((reply) => reply.seat === RUSSIA), "Estonia answers once the letter has landed");
});

test("an institution's business goes to the host's desk for the asker's seat, and what it made comes back with the ack", async () => {
  const asked = [];
  const s = setup({
    institution: async (request) => {
      asked.push(request);
      if (request.args?.command?.type === "seize") throw new Error("That is not something a player can do to an institution.");
      return { institutionId: "baltic-pact", chatId: "founding-1", extra: "not sent" };
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "institution", id: id(1), call: "lifecycle", args: { command: { type: "found", name: "Baltic Pact" } } });
  assert.equal(s.ack(s.guest, id(1)).error, "Take a country first.");
  await s.request(s.guest, { t: "pick", id: id(2), country: RUSSIA });
  await s.request(s.guest, { t: "institution", id: id(3), call: "lifecycle", args: { command: { type: "found", name: "Baltic Pact" } } });
  const ack = s.ack(s.guest, id(3));
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.result, { institutionId: "baltic-pact", chatId: "founding-1" });
  // (The seat as it is when the desk writes: host/institutions.js.)
  assert.equal(asked.at(-1).seat(), RUSSIA, "the seat's country, never one the request names");
  // The host's own screen asks the same way, for the host's country.
  await s.request(s.hostPlayer, { t: "institution", id: id(4), call: "channel", args: { institutionId: "baltic-pact" } });
  assert.equal(asked.at(-1).seat(), LATVIA);
  // A refusal is said in the desk's own words.
  await s.request(s.guest, { t: "institution", id: id(5), call: "lifecycle", args: { command: { type: "seize" } } });
  assert.match(s.ack(s.guest, id(5)).error, /not something a player can do/);
  assert.equal(s.ack(s.guest, id(5)).result, undefined);
});

// FOLLOWUPS A1: an institution's business asked while a round was resolved was written, once the round had landed,
// under the country name it had when it arrived: the round had renamed the country, and nobody played that name.
test("an institution's business asked while a round resolves is written for the seat as the round left it", async () => {
  const EMPIRE = "Russian Empire";
  let release;
  const written = [];
  let s = null;
  const desk = createInstitutionDesk({
    host: LATVIA,
    write: (label, fn) => s.host.write(label, fn),
    game: {
      lifecycle: async (args) => {
        written.push(args);
        return { institution: { id: "eurasian-union" } };
      },
      readChats: async () => s.store.docs.chat,
      updateChats: async (fn) => s.store.updateChats(fn),
    },
  });
  s = setup({
    institution: desk,
    holdResolve: new Promise((resolve) => { release = resolve; }),
    // The round renames the guest's country (server/polityRename.js keeps the old name among its former names).
    roundWrites: (docs) => {
      const { [RUSSIA]: _old, ...rest } = docs.world.polityOverrides;
      docs.world.polityOverrides = { ...rest, [EMPIRE]: { code: EMPIRE, name: EMPIRE, status: "active", formerNames: [RUSSIA] } };
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  const founding = s.host.receive(s.guest, { t: "institution", id: id(4), call: "lifecycle", args: { command: { type: "found", name: "Eurasian Union", founder: RUSSIA } } });
  await s.clock.flush();
  assert.deepEqual(written, [], "it waits behind the round");
  release();
  await founding;
  await s.clock.flush();
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.deepEqual(written.map((args) => args.playerCountry), [EMPIRE], "written for the country the seat plays now");
  assert.equal(written[0].command.authority, "player");
});

// Rostra, the social network (runtime/socialFeed.js): a guest posts through the
// host, as the leader of its own seat's country whatever the message says, and
// the feed is public, in every player's view.
test("a guest's post goes into the feed as its own country's leader, dated by the game, and every view carries it", async () => {
  const s = setup();
  s.store.docs.world.countryStats = { [RUSSIA]: { leader: "Ivan Petrov" } };
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "post", id: id(2), text: "Moscow wants talks.", quote: "" });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  const [first] = s.store.docs.world.socialFeed;
  assert.deepEqual(
    { id: first.id, author: first.author, country: first.country, by: first.by, kind: first.kind, date: first.date, round: first.round, text: first.text },
    { id: "p1", author: "Ivan Petrov", country: RUSSIA, by: RUSSIA, kind: "player", date: "2014-04-01", round: 1, text: "Moscow wants talks." },
  );
  // The host's own seat quotes it.
  await s.request(s.hostPlayer, { t: "post", id: id(3), text: "Riga is listening.", quote: "p1" });
  assert.equal(s.ack(s.hostPlayer, id(3)).ok, true);
  assert.equal(s.store.docs.world.socialFeed[1].quote, "p1");
  assert.equal(s.store.docs.world.socialFeed[1].by, LATVIA);
  // A quote of a post that is not there is refused in words, and nothing is written.
  await s.request(s.guest, { t: "post", id: id(4), text: "Quoting nothing.", quote: "p9" });
  assert.match(s.ack(s.guest, id(4)).error, /no longer there/);
  assert.equal(s.store.docs.world.socialFeed.length, 2);
  // Public: the guest's own view holds both posts, in the feed's own document: a post re-sends the feed, not the world.
  await s.clock.advance(1000);
  assert.deepEqual((s.shown(s.guest).feed ?? []).map((entry) => entry.id), ["p1", "p2"]);
  assert.equal("socialFeed" in s.shown(s.guest).world, false);
  const before = s.to(s.guest, "view").length;
  await s.request(s.hostPlayer, { t: "post", id: id(5), text: "Riga again.", quote: "" });
  const sentNow = s.to(s.guest, "view").slice(before);
  assert.deepEqual(sentNow.map((view) => Object.keys(view.docs)), [["feed"]]);
});

test("each player posts on Rostra as often a round as the host allows, and is told when that is done", async () => {
  // One player could push everything else out of the feed's newest 300 (the gap audit of 2026-11-18).
  const s = setup({ settings: { postsPerRound: 2 } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  for (const n of [2, 3, 4]) await s.request(s.guest, { t: "post", id: id(n), text: `Moscow, post ${n}.`, quote: "" });
  assert.deepEqual([2, 3, 4].map((n) => s.ack(s.guest, id(n)).ok), [true, true, false]);
  assert.match(s.ack(s.guest, id(4)).error, /this round's 2 posts: post again next round/);
  // Another player's are their own to make.
  await s.request(s.hostPlayer, { t: "post", id: id(5), text: "Riga posts.", quote: "" });
  assert.equal(s.ack(s.hostPlayer, id(5)).ok, true);
  // The next round, again.
  s.store.docs.game = { ...s.store.docs.game, round: 2 };
  await s.request(s.guest, { t: "post", id: id(6), text: "Moscow, next round.", quote: "" });
  assert.equal(s.ack(s.guest, id(6)).ok, true);
  assert.equal(normalizeSettings({}).settings.postsPerRound, 5, "five a round unless the host says otherwise");
  assert.equal(normalizeSettings({ postsPerRound: 0 }).key, "postsPerRound");
});

test("a post request is held to its shape: words within the limit, a post id or nothing to quote, nothing else", () => {
  const ask = (fields) => validate(PLAYER_REQUESTS.post, { t: "post", id: id(1), quote: "", ...fields });
  assert.equal(ask({ text: "Hello" }).ok, true);
  assert.equal(ask({ text: "Hello", quote: "p12" }).ok, true);
  assert.equal(ask({ text: "" }).ok, false, "a post needs words");
  assert.equal(ask({ text: "x".repeat(SOCIAL_POST_MAX_CHARS + 1) }).ok, false, "and no more than a post holds");
  assert.equal(ask({ text: "Hi", quote: "anything" }).ok, false, "a quote names a post by its id");
  assert.equal(ask({ text: "Hi", author: "Someone Else" }).ok, false, "who wrote it is never the message's to say");
  assert.equal(ask({ text: "Hi", country: RUSSIA }).ok, false);
});

test("a post written while a round is resolved lands after it; where the game has no social media, nobody posts", async () => {
  let release;
  const s = setup({ holdResolve: new Promise((resolve) => { release = resolve; }) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  const waiting = s.host.receive(s.guest, { t: "post", id: id(4), text: "Now?", quote: "" });
  await s.clock.flush();
  assert.equal((s.store.docs.world.socialFeed ?? []).length, 0);
  release();
  await waiting;
  await s.clock.flush();
  assert.equal(s.ack(s.guest, id(4)).ok, true);
  assert.equal((s.store.docs.world.socialFeed ?? []).length, 1);
  setActiveFeatures({ socialMedia: false }, null);
  try {
    await s.request(s.guest, { t: "post", id: id(5), text: "Now?", quote: "" });
    assert.match(s.ack(s.guest, id(5)).error, /no social media/);
  } finally {
    setActiveFeatures(null, null);
  }
  assert.equal((s.store.docs.world.socialFeed ?? []).length, 1);
});

test("a round that cannot be resolved says why on every screen until one is, and its orders stay queued", async () => {
  let fail = true;
  const s = setup({ roundWrites: () => { if (fail) throw new Error("The model's quota is used up."); } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "order", id: id(2), text: "Hold the line at Narva" });
  await s.request(s.hostPlayer, { t: "ready", id: id(3), value: true });
  await s.request(s.guest, { t: "ready", id: id(4), value: true });
  await s.clock.flush();
  const after = s.to(s.guest, "round").at(-1);
  assert.equal(after.phase, "planning");
  assert.equal(after.round, 1, "the same round, planned again");
  assert.equal(after.failed, 1);
  // The host reads why as it came; every other player in the host's words (host/failureWords.js).
  assert.equal(after.failure, "The host's AI could not write the round.");
  assert.match(s.to(s.hostPlayer, "round").at(-1).failure, /quota is used up/);
  assert.equal(s.to(s.guest, "notice").at(-1).text, "Round 1 could not be resolved: The host's AI could not write the round. Its orders are still queued, and the host can end the round again.");
  assert.match(s.to(s.hostPlayer, "notice").at(-1).text, /Round 1 could not be resolved: The model's quota is used up/);
  assert.equal(validate(HOST_MESSAGES.round, after).ok, true);
  assert.ok(s.store.docs.actions.some((action) => action.text === "Hold the line at Narva" && action.status === "planned"));
  // The host tries again, and it lands: the failure is no longer said.
  fail = false;
  s.host.control.resolveNow();
  await s.clock.flush();
  const landed = s.to(s.guest, "round").at(-1);
  assert.equal(landed.phase, "revealing");
  assert.equal(landed.failed, 0);
  assert.equal(landed.failure, "");
});

// --- WHO ANSWERS FOR THE AI'S GOVERNMENTS ---------------------------------------------
// The host's choice (settings.js `replies`): its own computer on its own AI key
// ("host"), or the writer's own device on the writer's own key ("own"). The
// owner, 2026-11-15: "build C and D, and the host can choose, but no sending
// api keys".

test("the host's AI answers one line at a time at each table, and someone who writes again while their answer waits is answered once", async () => {
  let running = 0;
  let most = 0;
  const gates = [];
  const s = setup({
    replyTo: async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => { gates.push(resolve); });
      running -= 1;
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();

  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "First." });
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  await s.clock.flush();
  assert.equal(s.replies.length, 1, "the first line is being answered");
  // Two more lines while it is: one more answer waits, for both of them.
  await s.request(s.guest, { t: "say", id: id(3), thread: thread.id, to: [], text: "Second." });
  await s.request(s.guest, { t: "say", id: id(4), thread: thread.id, to: [], text: "Third." });
  await s.clock.flush();
  assert.equal(s.replies.length, 1, "nothing else is asked while the first answer is out");
  // Another table is answered beside it.
  await s.request(s.hostPlayer, { t: "say", id: id(5), thread: "chat-lv-est", to: [], text: "Riga again." });
  await s.clock.flush();
  assert.deepEqual(s.replies.map((reply) => reply.chatId), [thread.id, "chat-lv-est"]);
  assert.equal(most, 2, "two tables, one answer each");

  gates.shift()();
  await s.clock.flush();
  assert.deepEqual(s.replies.map((reply) => reply.chatId), [thread.id, "chat-lv-est", thread.id], "then one answer for what was written meanwhile");
  gates.shift()();
  gates.shift()();
  await s.clock.flush();
  assert.equal(s.replies.length, 3, "and no fourth: the third line was answered with the second");
  assert.equal(gates.length, 0);

  // Once the table is quiet, the next line is answered as the first was.
  await s.request(s.guest, { t: "say", id: id(6), thread: thread.id, to: [], text: "Fourth." });
  await s.clock.flush();
  assert.equal(s.replies.length, 4);
  gates.shift()();
  await s.clock.flush();
});

test("when the host's AI cannot be reached, whoever wrote is told, and nobody else", async () => {
  const s = setup({ replyTo: async () => ({ unreachable: true }) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const before = s.to(s.hostPlayer, "notice").length;
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  await s.clock.flush();
  const told = s.to(s.guest, "notice").at(-1);
  assert.equal(told.level, "warn");
  assert.match(told.text, /The host's AI could not be reached: Republic of Estonia did not answer/);
  assert.equal(s.to(s.hostPlayer, "notice").length, before, "the host did not write that line");
  assert.equal(validate(HOST_MESSAGES.notice, told).ok, true);
});

test("a peace a leader made in its answer is said to every player, as one two players make is", async () => {
  // The engine told it as an event (engineMain.js decidedAndTold, host/landings.js); the host says it to everyone.
  const s = setup({ replyTo: async () => ({ landed: [{ id: "landing-peace-treaty:war-2:2014-04-01", concerns: [ESTONIA, RUSSIA] }] }) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "We accept your terms." });
  await s.clock.flush();
  for (const player of [s.hostPlayer, s.guest]) assert.equal(s.to(player, "notice").at(-1).text, `${ESTONIA} and ${RUSSIA} have made peace.`);
});

test("with each player's own AI, the host leaves the answer to the writer's device and takes its words once, for the AI's governments alone", async () => {
  // (Two answers of the host's AI a round for what only it may answer: the Council's line and the war's below.)
  const s = setup({ settings: { replies: "own", hostAnswers: 2 } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const lobby = s.to(s.guest, "lobby").at(-1);
  assert.equal(lobby.settings.replies, "own", "every screen is told whose AI answers");
  assert.equal(validate(HOST_MESSAGES.lobby, lobby).ok, true);

  // The guest writes to a government the AI plays: the host takes the line and
  // says "answer it yourself", with the line and the governments that answer.
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  const answer = s.ack(s.guest, id(2));
  assert.equal(answer.ok, true);
  assert.equal(validate(HOST_MESSAGES.ack, answer).ok, true);
  const thread = () => s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  const line = thread().messages[0].id;
  assert.deepEqual(answer.result, { chatId: thread().id, answer: "own", line, governments: [ESTONIA] });
  assert.deepEqual(ownReplyAsked(pendingSharedThread([{ name: ESTONIA }]), answer), { thread: thread().id, line, governments: [ESTONIA] });
  await s.clock.flush();
  assert.deepEqual(s.replies, [], "the host's own AI is asked nothing");

  const reply = (fields) => ({ t: "reply", thread: thread().id, line, ...fields });
  // Not for someone else's line.
  await s.request(s.hostPlayer, reply({ id: id(3), lines: [{ speaker: ESTONIA, text: "Tallinn to Riga." }] }));
  assert.match(s.ack(s.hostPlayer, id(3)).error, /not waiting for an answer from your device/);
  // Not for a line the host never left to a device.
  await s.request(s.guest, reply({ id: id(4), line: "message-made-up", lines: [{ speaker: ESTONIA, text: "Anything." }] }));
  assert.match(s.ack(s.guest, id(4)).error, /not waiting/);
  // Never for a country a person plays, the writer's own included.
  await s.request(s.guest, reply({ id: id(5), lines: [{ speaker: LATVIA, text: "Riga agrees to everything." }, { speaker: RUSSIA, text: "So do I." }] }));
  assert.match(s.ack(s.guest, id(5)).error, /None of those governments/);
  assert.equal(thread().messages.length, 1, "nothing was written");

  // The governments' words, as the device wrote them: dated and given their
  // ids by the host, a person's country among them left out.
  const words = "Tallinn hears Moscow.\n\nIt will answer within the week.";
  await s.request(s.guest, reply({ id: id(6), lines: [{ speaker: "republic of estonia", text: words }, { speaker: LATVIA, text: "Riga too." }] }));
  assert.equal(s.ack(s.guest, id(6)).ok, true);
  assert.deepEqual(thread().messages.map((message) => [message.role, message.speaker, message.text, message.time]), [
    ["user", RUSSIA, "Moscow to Tallinn.", "2014-04-01"],
    ["leader", ESTONIA, words, "2014-04-01"],
  ]);
  assert.match(thread().messages[1].id, /^message-/);
  const seen = s.shown(s.guest).chat.find((chat) => chat.id === thread().id);
  assert.deepEqual(seen.messages.map((message) => [message.role, message.speaker]), [["user", RUSSIA], ["leader", ESTONIA]]);
  assert.equal((s.shown(s.hostPlayer).chat ?? []).some((chat) => chat.id === thread().id), false, "the host is not at that table");
  // Once.
  await s.request(s.guest, reply({ id: id(7), lines: [{ speaker: ESTONIA, text: "And again." }] }));
  assert.match(s.ack(s.guest, id(7)).error, /not waiting/);
  assert.equal(thread().messages.length, 2);

  // A line in the same thread is left to the device as the first was, by its id alone.
  await s.request(s.guest, { t: "say", id: id(8), thread: thread().id, to: [], text: "And Narva?" });
  const second = s.ack(s.guest, id(8)).result;
  assert.deepEqual(second, { answer: "own", line: thread().messages[2].id, governments: [ESTONIA] });
  assert.deepEqual(ownReplyAsked(seen, s.ack(s.guest, id(8))), { thread: thread().id, line: second.line, governments: [ESTONIA] });

  // People answer for themselves: no model, and no device.
  await s.request(s.guest, { t: "say", id: id(9), thread: null, to: [LATVIA], text: "Moscow to Riga." });
  assert.equal(s.ack(s.guest, id(9)).result.answer, undefined);
  assert.equal(ownReplyAsked(pendingSharedThread([{ name: LATVIA }]), s.ack(s.guest, id(9))), null);

  // An institution's table votes and decides in its answer: the host's own AI
  // answers it, whatever the setting.
  s.store.docs.chat.push({ id: "council-1", institutionId: "inst-1", countries: [{ code: RUSSIA, name: RUSSIA }, { code: ESTONIA, name: ESTONIA }], messages: [] });
  await s.request(s.guest, { t: "say", id: id(10), thread: "council-1", to: [], text: "Moscow addresses the council." });
  assert.equal(s.ack(s.guest, id(10)).ok, true);
  assert.equal(s.ack(s.guest, id(10)).result, undefined);
  await s.clock.flush();
  assert.deepEqual(s.replies, [{ chatId: "council-1", seat: RUSSIA }]);

  // So does a government at war with the writer: its answer may make peace,
  // or accept the writer's terms, which only the host's own game can carry out.
  s.store.docs.world.wars = [{ id: "war-1", title: "The Narva War", status: "active", sideA: [RUSSIA], sideB: [ESTONIA] }];
  await s.request(s.guest, { t: "say", id: id(11), thread: thread().id, to: [], text: "Moscow proposes a ceasefire." });
  assert.equal(s.ack(s.guest, id(11)).ok, true);
  assert.equal(s.ack(s.guest, id(11)).result, undefined, "nothing is left to the device");
  await s.clock.flush();
  assert.deepEqual(s.replies.at(-1), { chatId: thread().id, seat: RUSSIA });
  assert.equal(s.replies.length, 2);
  // Another's war is not the writer's: Latvia's with Estonia leaves the guest's line to its device.
  s.store.docs.world.wars = [{ id: "war-2", title: "The Baltic War", status: "active", sideA: [LATVIA], sideB: [ESTONIA] }];
  await s.request(s.guest, { t: "say", id: id(12), thread: thread().id, to: [], text: "Moscow watches." });
  assert.equal(s.ack(s.guest, id(12)).result.answer, "own");
  // And once the writer's own war is settled, the device answers again.
  s.store.docs.world.wars = [{ id: "war-1", title: "The Narva War", status: "ended", sideA: [RUSSIA], sideB: [ESTONIA] }];
  await s.request(s.guest, { t: "say", id: id(13), thread: thread().id, to: [], text: "Moscow thanks Tallinn." });
  assert.equal(s.ack(s.guest, id(13)).result.answer, "own");
  await s.clock.flush();
  assert.equal(s.replies.length, 2);
  assert.equal(s.store.docs.game.humanCountries.length, 2);
});

test("a reply is held to its shape: a line, a thread, and a few governments' words", () => {
  const ask = (fields) => validate(PLAYER_REQUESTS.reply, { t: "reply", id: id(1), thread: "thread-1", line: "message-1", lines: [{ speaker: ESTONIA, text: "Tallinn hears Moscow." }], ...fields });
  assert.equal(ask({}).ok, true);
  assert.equal(ask({ lines: Array.from({ length: REPLY_MAX_LINES }, () => ({ speaker: ESTONIA, text: "A line." })) }).ok, true);
  assert.equal(ask({ lines: Array.from({ length: REPLY_MAX_LINES + 1 }, () => ({ speaker: ESTONIA, text: "A line." })) }).ok, false, "no more lines than a table says at once");
  assert.equal(ask({ lines: [{ speaker: ESTONIA, text: "x".repeat(REPLY_MAX_CHARS + 1) }] }).ok, false);
  assert.equal(ask({ lines: [{ speaker: ESTONIA, text: "" }] }).ok, false, "an answer needs words");
  assert.equal(ask({ line: "" }).ok, false);
  assert.equal(ask({ thread: "" }).ok, false);
  assert.equal(ask({ lines: [{ speaker: ESTONIA, text: "Words.", key: "sk-anything" }] }).ok, false, "nothing but a name and its words: a key has nowhere to go");
  assert.equal(ask({ key: "sk-anything" }).ok, false);
  assert.equal(ask({ lines: [{ speaker: ESTONIA, text: "Words.", role: "user" }] }).ok, false, "whose line it is, is the host's to say");
});

test("the host can change who answers while the game runs, and a line already left to a device is still answered from it", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  assert.equal(s.to(s.guest, "lobby").at(-1).settings.replies, "host");

  assert.equal(s.host.control.setReplies("own"), true);
  assert.equal(s.host.control.setReplies("own"), false, "already so");
  assert.equal(s.host.control.setReplies("everyone"), false, "not a way to answer");
  assert.equal(s.to(s.guest, "lobby").at(-1).settings.replies, "own");
  assert.equal(s.host.status().lobby.settings.replies, "own");
  for (const player of [s.guest, s.hostPlayer]) assert.match(s.to(player, "notice").at(-1).text, /each player's own AI answers/);

  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  const left = s.ack(s.guest, id(2)).result;
  assert.equal(left.answer, "own");

  // Back to the host's AI: the line the device was left with is still its own.
  assert.equal(s.host.control.setReplies("host"), true);
  assert.match(s.to(s.guest, "notice").at(-1).text, /the host's AI answers/);
  await s.request(s.guest, { t: "reply", id: id(3), thread: left.chatId, line: left.line, lines: [{ speaker: ESTONIA, text: "Tallinn hears Moscow." }] });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.deepEqual(s.replies, []);
  // And the next line is the host's AI's to answer.
  await s.request(s.guest, { t: "say", id: id(4), thread: left.chatId, to: [], text: "And Narva?" });
  assert.equal(s.ack(s.guest, id(4)).result, undefined);
  await s.clock.flush();
  assert.deepEqual(s.replies, [{ chatId: left.chatId, seat: RUSSIA }]);
});

// --- VIEWS THE PAGE CHECKS -------------------------------------------------------------
// A view names its connection, the view it follows and what every document adds
// up to; a page shows only what follows what it holds and adds up, and says
// what it did. Before, the host counted views blind and a reconnect froze the
// guest's world (the page ignored every view numbered below the last it had).

// What a page holds after every view it was sent, in order.
const heldAfter = (views) => Object.assign({}, ...views.map((view) => view.docs));

test("each view names its connection, follows the last, and says what every document adds up to", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "order", id: id(2), text: "Reinforce the garrison in Pskov." });
  await s.clock.flush();
  const views = s.to(s.guest, "view");
  assert.ok(views.length >= 2);
  assert.equal(views[0].base, 0, "the first is whole");
  assert.deepEqual(Object.keys(views[0].docs).sort(), [...VIEW_KEYS].sort(), "with every document");
  for (let n = 1; n < views.length; n += 1) {
    assert.equal(views[n].epoch, views[0].epoch);
    assert.equal(views[n].base, views[n - 1].rev, "each follows the one before");
  }
  const held = heldAfter(views);
  for (const key of VIEW_KEYS) assert.equal(views.at(-1).sums[key], digestText(JSON.stringify(held[key] ?? null)), key);
  for (const view of views) assert.equal(validate(HOST_MESSAGES.view, view).ok, true);
});

test("a reconnect is a new connection, and its first view is whole", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  for (let n = 0; n < 5; n += 1) await s.request(s.guest, { t: "order", id: id(10 + n), text: `Order ${n}` });
  await s.clock.flush();
  const before = s.to(s.guest, "view");
  const last = before.at(-1);
  // The connection drops and the same device comes back.
  s.host.leave(s.guest);
  s.host.join(s.guest);
  await s.clock.flush();
  const after = s.to(s.guest, "view").slice(before.length);
  assert.ok(after.length >= 1);
  assert.notEqual(after[0].epoch, last.epoch, "a new name for the new connection's views");
  assert.equal(after[0].base, 0);
  assert.deepEqual(Object.keys(after[0].docs).sort(), [...VIEW_KEYS].sort());
});

test("a page that could not apply a view gets the whole view again, and a page that never says anything does too", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.clock.flush();
  const count = () => s.to(s.guest, "view").length;
  const latest = () => s.to(s.guest, "view").at(-1);
  // Applied: nothing more is sent.
  await s.request(s.guest, { t: "viewed", epoch: latest().epoch, rev: latest().rev, ok: true });
  const settled = count();
  // Could not: the whole view, at once, and not again within two seconds.
  await s.request(s.guest, { t: "viewed", epoch: latest().epoch, rev: latest().rev, ok: false });
  await s.clock.flush();
  assert.equal(count(), settled + 1);
  assert.equal(latest().base, 0);
  await s.request(s.guest, { t: "viewed", epoch: latest().epoch, rev: latest().rev, ok: false });
  await s.clock.flush();
  assert.equal(count(), settled + 1, "a page asking again at once is not sent the world twice");
  // Word of an earlier connection's views is not about this one's.
  await s.clock.advance(3_000);
  await s.request(s.guest, { t: "viewed", epoch: "old", rev: 1, ok: false });
  await s.clock.flush();
  assert.equal(count(), settled + 1);
  // Nothing heard of the last view for a minute: sent again, whole.
  await s.clock.advance(VIEW_ACK_MS + 15_000);
  assert.equal(count(), settled + 2);
  assert.equal(latest().base, 0);
  // Said applied: the waiting stops.
  await s.request(s.guest, { t: "viewed", epoch: latest().epoch, rev: latest().rev, ok: true });
  await s.clock.advance(VIEW_ACK_MS * 2);
  assert.equal(count(), settled + 2);
});

test("a page that loses a view on the way ends up holding exactly what the host holds for it", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.clock.flush();
  const page = startRemoteRuntime({ publish: () => {}, urlFor: (key) => `/api/runtime/json/${key}` });
  try {
    let fed = 0;
    // The page's side (client/sharedGame.js): apply each view in order, and say what it did.
    const deliver = async ({ drop = -1 } = {}) => {
      const views = s.to(s.guest, "view");
      for (; fed < views.length; fed += 1) {
        if (fed === drop) continue;
        const outcome = page.apply(views[fed]);
        if (outcome.reason === "repeat") continue;
        await s.request(s.guest, { t: "viewed", epoch: views[fed].epoch, rev: views[fed].rev, ok: outcome.ok });
      }
    };
    await deliver();
    for (let n = 0; n < 3; n += 1) await s.request(s.guest, { t: "order", id: id(20 + n), text: `Order ${n}` });
    await s.request(s.guest, { t: "say", id: id(30), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
    await s.clock.flush();
    // The second of these views never arrives.
    await deliver({ drop: fed + 1 });
    await s.clock.advance(3_000);
    await deliver();
    await deliver();
    const host = heldAfter(s.to(s.guest, "view"));
    // A part sent apart from its document (VIEW_PARTS: Rostra's feed) is read in it.
    for (const [part, { of, key }] of Object.entries(VIEW_PARTS)) if (host[of] && host[part] != null) host[of] = { ...host[of], [key]: host[part] };
    for (const key of VIEW_KEYS) assert.deepEqual(page.held(key) ?? null, host[key] ?? null, key);
    assert.ok(page.held("chat").some((chat) => (chat.messages ?? []).some((message) => message.text === "Moscow to Tallinn.")), "the thread opened after the lost view is there");
  } finally {
    stopRemoteRuntime();
  }
});

// The game's countries as the engine counts them (engineMain.js gameCountries):
// its own, every one that holds land, every one whose record says it lives.
const gameCountries = (docs) => [...new Set([
  docs.game.country,
  ...Object.values(docs.world.regionOwnershipOverrides ?? {}),
  ...Object.entries(docs.world.polityOverrides ?? {}).filter(([, entry]) => entry?.status !== "dissolved").map(([key, entry]) => entry?.name || key),
])];
// A map whose countries have no records of their own, as most maps' do: each
// is the game's by the land it holds.
const mapWorld = () => ({ regionOwnershipOverrides: { "reg-lv": LATVIA, "reg-ru": RUSSIA, "reg-ee": ESTONIA } });
const playRound = async (s, players) => {
  for (const [index, player] of players.entries()) await s.request(player, { t: "ready", id: id(900 + s.resolved.length * 10 + index), value: true });
  await s.clock.flush();
};

test("a round over a map whose countries have no records of their own leaves every seat where it was", async () => {
  const s = setup({ world: mapWorld(), countriesOf: gameCountries });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.equal(s.resolved.length, 1);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  assert.ok(!s.to(s.guest, "notice").some((entry) => /is gone/.test(entry.text)));
});

test("a country annexed whole is gone: its player watches it, and may take any free country where newcomers may not join", async () => {
  const s = setup({
    world: mapWorld(),
    countriesOf: gameCountries,
    settings: { allowMidGameJoin: false },
    roundWrites: (docs) => {
      docs.world.regionOwnershipOverrides["reg-ee"] = RUSSIA;
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: ESTONIA });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA]);
  assert.match(s.to(s.guest, "notice").at(-1).text, /Republic of Estonia is gone/);
  const lobby = s.to(s.guest, "lobby").at(-1);
  assert.deepEqual(lobby.seats.map((seat) => [seat.country, seat.status, seat.you]), [[LATVIA, "human", false], [ESTONIA, "watching", true]]);
  assert.ok(!lobby.countries.includes(ESTONIA), "a country that is gone cannot be taken");
  assert.equal(s.shown(s.guest).game.country, ESTONIA, "what its government knew is still theirs to read");
  // A newcomer may not join now; the player whose country is gone may take a free one.
  const newcomer = { id: "p-new", device: "device-new", name: "New" };
  s.host.join(newcomer);
  await s.request(newcomer, { t: "pick", id: id(4), country: RUSSIA });
  assert.equal(s.ack(newcomer, id(4)).error, "game-started");
  await s.request(s.guest, { t: "pick", id: id(5), country: RUSSIA });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  assert.ok(!s.to(s.guest, "lobby").at(-1).seats.some((seat) => seat.status === "watching"));
});

// FOLLOWUPS A3: the orders a gone country's player had queued stayed planned under the gone name, and the next skip
// read them among the live orders; a formation it was raising stood on the map for nobody.
test("a country gone takes its player's queued orders with it, and what they raised on the map is undone", async () => {
  const s = setup({
    world: mapWorld(),
    countriesOf: gameCountries,
    roundWrites: (docs) => {
      docs.world.regionOwnershipOverrides["reg-ee"] = RUSSIA;
      // The round carried out none of Estonia's orders: they were still planned when it landed.
    },
    // The host's own map: Estonia holds its ground until the round.
    readChart: async () => ({ holds: (country) => country === ESTONIA }),
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: ESTONIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "order", id: id(2), text: "Fortify Narva." });
  await s.request(s.guest, { t: "deploy", id: id(3), name: "Narva Guard", type: "infantry", strength: 20, lng: 28.2, lat: 59.4 });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.equal(s.store.docs.actions.filter((action) => action.ownerCode === ESTONIA).length, 2);
  assert.ok(s.store.docs.world.units.some((unit) => unit.ownerCode === ESTONIA && unit.status === "pending"));
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA]);
  assert.ok(!s.store.docs.actions.some((action) => action.ownerCode === ESTONIA && action.status === "planned"), "nothing is left planned for a country that is gone");
  assert.ok(s.store.docs.actions.some((action) => action.id === "order-lv"), "the host's own stay");
  assert.ok(!(s.store.docs.world.units ?? []).some((unit) => unit.ownerCode === ESTONIA && unit.status === "pending"), "no formation of its stands waiting on the map");
});

test("a country renamed while its player is away keeps their seat, and they come back to it under its new name", async () => {
  const EMPIRE = "Russian Empire";
  const s = setup({
    countriesOf: gameCountries,
    roundWrites: (docs) => {
      // The game's own rename (server/polityRename.js): re-keyed, the old name kept.
      const { [RUSSIA]: old, ...rest } = docs.world.polityOverrides;
      docs.world.polityOverrides = { ...rest, [EMPIRE]: { ...old, code: EMPIRE, name: EMPIRE, formerNames: [RUSSIA] } };
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  s.host.leave(s.guest);
  // Past the grace: the AI minds Russia when the round lands.
  await s.clock.advance(90_000);
  await playRound(s, [s.hostPlayer]);
  assert.equal(s.resolved.length, 1);
  assert.deepEqual(s.resolved[0].humanCountries, [LATVIA]);
  const again = { ...s.guest, id: "p-guest-2" };
  s.host.join(again);
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, EMPIRE]);
  assert.equal(s.shown(again).game.country, EMPIRE);
  assert.deepEqual(s.store.docs.game.seatFoundings, [{ from: RUSSIA, to: EMPIRE }]);
});

test("once the game is under way a player changes country only with the host's yes", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "unpick", id: id(2) });
  assert.equal(s.ack(s.guest, id(2)).error, "Ask the host to change your country.");
  await s.request(s.guest, { t: "pick", id: id(3), country: ESTONIA });
  assert.deepEqual(s.ack(s.guest, id(3)).result, { asked: ESTONIA });
  assert.deepEqual(s.to(s.hostPlayer, "lobby").at(-1).changes, [{ from: RUSSIA, to: ESTONIA, name: "Guest" }]);
  assert.deepEqual(s.to(s.guest, "lobby").at(-1).changes, [], "only the host is shown who asks");
  assert.match(s.to(s.hostPlayer, "notice").at(-1).text, /asks to play Republic of Estonia/);
  // Refused: nothing changes.
  assert.equal(await s.host.control.seat({ op: "refuse", from: RUSSIA }), true);
  assert.match(s.to(s.guest, "notice").at(-1).text, /keeps you as Russian Federation/);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  // Allowed: the player plays the country asked for, and the old one is anyone's.
  await s.request(s.guest, { t: "pick", id: id(4), country: ESTONIA });
  assert.equal(await s.host.control.seat({ op: "allow", from: RUSSIA }), true);
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, ESTONIA]);
  assert.equal(s.shown(s.guest).game.country, ESTONIA);
  assert.deepEqual(s.to(s.hostPlayer, "lobby").at(-1).changes, []);
  const other = { id: "p-other", device: "device-other", name: "Other" };
  s.host.join(other);
  await s.request(other, { t: "pick", id: id(5), country: RUSSIA });
  assert.equal(s.ack(other, id(5)).ok, true);
});

test("the session is saved with the game and taken up again: every seat its device's, the round, a change asked and a ban", async () => {
  const campaign = "game-baltic";
  const s = setup({ campaign });
  const other = { id: "p-other", device: "device-other", name: "Other" };
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  s.host.join(other);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.request(other, { t: "pick", id: id(2), country: ESTONIA });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest, other]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "revealing");
  // Estonia's player is banned; Russia's asks to change, and the host closes the game.
  s.host.control.kick(ESTONIA, { ban: true });
  await s.request(s.guest, { t: "pick", id: id(3), country: ESTONIA });
  await s.host.stop();
  const record = s.store.shared.at(-1);
  assert.equal(record.campaign, campaign);
  assert.equal(record.round, 2, "the round read when the game closed is done: the next is planned");
  assert.deepEqual(record.banned, ["device-other"]);
  assert.deepEqual(record.changes.map((entry) => [entry.from, entry.to]), [[RUSSIA, ESTONIA]]);
  assert.equal(sessionFromRecord(record, { campaign: "another-game", hostDevice: "device-host" }), null, "never another campaign's");
  assert.equal(sessionFromRecord(record, { campaign, hostDevice: "another-host" }), null, "never another host's");

  // Shared again another day.
  const t = setup({ campaign, restored: sessionFromRecord(record, { campaign, hostDevice: "device-host" }) });
  t.host.join(t.hostPlayer);
  await t.clock.flush();
  assert.deepEqual(t.to(t.hostPlayer, "lobby").at(-1).seats.map((seat) => [seat.country, seat.status]), [[RUSSIA, "away"], [ESTONIA, "ai"], [LATVIA, "human"]]);
  assert.deepEqual(t.to(t.hostPlayer, "lobby").at(-1).changes, [{ from: RUSSIA, to: ESTONIA, name: "Guest" }]);
  assert.equal(t.to(t.hostPlayer, "round").at(-1).round, 2);
  assert.equal(t.to(t.hostPlayer, "round").at(-1).phase, "planning");
  assert.equal(t.to(t.hostPlayer, "round").at(-1).paused, true, "paused until the host resumes it, when its players are back");
  // Russia is its player's device's: nobody else takes it, and its player comes back to it.
  const stranger = { id: "p-stranger", device: "device-stranger", name: "Stranger" };
  t.host.join(stranger);
  await t.request(stranger, { t: "pick", id: id(4), country: RUSSIA });
  assert.equal(t.ack(stranger, id(4)).error, "taken");
  t.host.join(t.guest);
  await t.clock.flush();
  assert.deepEqual(t.store.docs.game.humanCountries, [RUSSIA, LATVIA]);
  assert.equal(t.shown(t.guest).game.country, RUSSIA);
  // The banned device is kept out.
  assert.equal(t.host.isBanned("device-other"), true);
  t.host.join(other);
  await t.clock.flush();
  assert.equal(t.to(other, "lobby").length, 0);
});

// The review of 2026-11-18, core 3 and views 5: after Stop, the host's single-player game showed every guest's queued
// orders, private threads and secret events as its own, and its skips carried the orders out.
test("after Stop the host's own game is its own seat's: a guest's orders, threads and secret events wait, and come back when the session is taken up", async () => {
  const campaign = "game-baltic";
  const s = setup({ campaign });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "order", id: id(2), text: "Invade Latvia." });
  await s.request(s.guest, { t: "say", id: id(3), thread: null, to: [ESTONIA], text: "Moscow to Tallinn, privately." });
  await s.request(s.hostPlayer, { t: "say", id: id(4), thread: null, to: [RUSSIA], text: "Riga to Moscow." });
  s.store.docs.events.push(
    { id: "e-public", date: "2014-04-02", title: "Talks open", description: "" },
    { id: "e-secret", date: "2014-04-03", title: "Moscow's agent turned", description: "", audience: [RUSSIA] },
    { id: "e-host-knows", date: "2014-04-04", title: "Riga learns", description: "", audience: [LATVIA, RUSSIA] },
  );
  const before = structuredClone(s.store.docs);
  await s.host.stop();
  const docs = s.store.docs;
  assert.deepEqual(docs.actions.map((action) => action.id), ["order-lv"], "the host's own order only");
  assert.deepEqual(docs.chat.map((chat) => chat.id), ["chat-lv-est"], "the guest's thread and the thread between the two people wait");
  assert.deepEqual(docs.events.map((event) => event.id), ["e-public", "e-host-knows"], "an event only the guest's government knows waits");
  assert.equal(docs.game.humanCountries, undefined, "single player again");
  assert.equal(JSON.stringify([docs.actions, docs.chat, docs.events]).includes("Invade Latvia"), false);
  assert.equal(JSON.stringify([docs.actions, docs.chat, docs.events]).includes("privately"), false);

  // Shared again another day: everything is back where it was, before anything else.
  const t = setup({ campaign, docs, restored: sessionFromRecord(s.store.shared.at(-1), { campaign, hostDevice: "device-host" }) });
  await t.clock.flush();
  assert.deepEqual(t.store.docs.actions, before.actions);
  assert.deepEqual(t.store.docs.chat.map((chat) => chat.id).sort(), before.chat.map((chat) => chat.id).sort());
  assert.deepEqual(t.store.docs.events.map((event) => event.id), before.events.map((event) => event.id), "each event where it stood");
  assert.equal("seatsHeld" in t.store.docs.world, false);
});

test("a player who holds a seat is let back in however many newcomers came meanwhile; a newcomer only while there is a seat", async () => {
  const s = setup({ settings: { seats: 2 } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  s.host.leave(s.guest);
  await s.clock.advance(90_000);
  // Both seats are held (the guest's is the AI's to mind, and still the guest's).
  assert.equal(s.host.roomFor("device-new"), false);
  assert.equal(s.host.openSeats(), 0);
  assert.equal(s.host.roomFor("device-guest"), true);
  // Released by the host: a seat is free, and the guest is a newcomer again (in the game's order).
  s.host.control.kick(RUSSIA);
  await s.clock.flush();
  assert.equal(s.host.roomFor("device-new"), true);
  assert.equal(s.host.openSeats(), 1);
  s.host.join({ id: "p-new", device: "device-new", name: "New" });
  assert.equal(s.host.roomFor("device-guest"), false, "the one already in without a seat has it");
  assert.equal(s.host.roomFor("device-new"), true);
});

test("the round waits while the host's screen is gone, and goes on when it is back; a round the host paused itself stays paused", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  // The host's page reloads: its screen is gone a moment.
  s.host.leave(s.hostPlayer);
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).paused, true, "nothing runs out meanwhile");
  assert.match(s.to(s.guest, "notice").at(-1).text, /host's screen is away/);
  await s.clock.advance(20 * 60_000);
  assert.equal(s.resolved.length, 0, "no round is resolved with nobody at the host's screen");
  s.host.join({ ...s.hostPlayer, id: "loopback-2" });
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).paused, false);
  assert.match(s.to(s.guest, "notice").at(-1).text, /host is back/);
  // Paused by the host, and the host's screen goes and comes back: still paused.
  s.host.control.pause();
  s.host.leave({ ...s.hostPlayer, id: "loopback-2" });
  s.host.join({ ...s.hostPlayer, id: "loopback-3" });
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).paused, true);
});

test("a round that comes to be planned while the host's screen is gone waits for it too", async () => {
  let release;
  const holdResolve = new Promise((resolve) => { release = resolve; });
  const s = setup({ holdResolve });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  // The host's screen goes while the round is resolved: the skip runs on.
  s.host.leave(s.hostPlayer);
  release();
  await s.clock.flush();
  await s.clock.flush();
  const after = s.to(s.guest, "round").at(-1);
  assert.equal(after.phase, "revealing");
  assert.equal(after.paused, true, "the reading waits for the host");
});

test("the lobby states the game's inputs every screen uses: its map's checksum and its feature switches", async () => {
  const features = { socialMedia: { enabled: false, look: "phone" }, worldDirection: { enabled: true } };
  const s = setup({ features });
  s.host.join(s.guest);
  await s.clock.flush();
  const lobby = s.to(s.guest, "lobby").at(-1);
  assert.deepEqual(lobby.features, features);
  assert.equal(lobby.scenario.hash, "abc");
  assert.equal(validate(HOST_MESSAGES.lobby, lobby).ok, true);
});

// Only Stop could end a round that hung, and a round that failed ran again at every deadline on the host's key, and
// failed again (the gap audit of 2026-11-18). The host cancels a round being resolved; a round that failed or was
// cancelled waits, with its orders, for the host to run it again (decision 9: it waits visibly, never written for it).
test("the host cancels a round that hangs; it waits with its orders until the host runs it again", async () => {
  let release;
  const s = setup({ holdResolve: new Promise((resolve) => { release = resolve; }) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  assert.equal(s.host.control.cancelRound(), false, "nothing to cancel while planning");
  await s.request(s.guest, { t: "order", id: id(2), text: "Hold the line at Pskov" });
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  assert.equal(s.host.control.cancelRound(), true);
  await s.clock.flush();
  const status = s.to(s.guest, "round").at(-1);
  assert.equal(status.phase, "planning");
  assert.equal(status.failed, 1);
  assert.match(s.to(s.guest, "notice").map((entry) => entry.text).join(" "), /The host cancelled round 1\. Its orders are still queued/);
  assert.ok(s.store.docs.actions.some((action) => action.text === "Hold the line at Pskov" && action.status === "planned"));
  // It does not run again by itself: everyone ready, the planning time over, and it still waits for the host.
  await playRound(s, [s.hostPlayer, s.guest]);
  await s.clock.advance(60 * 60 * 1000);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "planning");
  assert.equal(s.resolved.length, 0, "nothing ran it again: it would be resolving");
  // The host runs it again, and this time it lands.
  release();
  s.host.control.resolveNow();
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).phase, "revealing");
  assert.equal(s.to(s.guest, "round").at(-1).failed, 0);
});

// The review of 2026-11-18, ui 6, 7 and 15: a cancel read "could not be resolved: The host cancelled the round.";
// a guest saw "Paused" while the host's screen was gone, and the host's row looked present; and a round being
// resolved was minutes of one still label.
test("every screen is told what became of a round, that the host's screen is away, and the step a round being resolved is on", async () => {
  let release;
  const s = setup({
    holdResolve: new Promise((resolve) => { release = resolve; }),
    steps: [{ label: "Reading the world" }, { label: "Writing the events", detail: "part 1 of 2" }, { label: "Writing the events", detail: "part 1 of 2" }],
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const planning = s.to(s.guest, "round").at(-1);
  assert.equal(planning.hostAway, undefined, "the host is here");
  assert.equal(planning.step, undefined);
  assert.equal(planning.elapsedMs, undefined, "only a round being resolved has been resolving");
  // Resolving: each step, once, as the engine starts it, and how long it has been.
  await playRound(s, [s.hostPlayer, s.guest]);
  await s.clock.advance(30_000);
  const steps = s.to(s.guest, "round").filter((message) => message.phase === "resolving" && message.step).map((message) => message.step);
  assert.deepEqual(steps, [{ label: "Reading the world", detail: "" }, { label: "Writing the events", detail: "part 1 of 2" }], "a step said again is not sent again");
  // A screen that comes in meanwhile is told the step, and for how long the round has been resolving.
  const late = { id: "p-late", device: "device-late", name: "Late" };
  s.host.join(late);
  await s.clock.flush();
  assert.deepEqual([s.to(late, "round").at(-1).step, s.to(late, "round").at(-1).elapsedMs], [{ label: "Writing the events", detail: "part 1 of 2" }, 30_000]);
  assert.equal(s.host.control.cancelRound(), true);
  await s.clock.flush();
  const cancelled = s.to(s.guest, "round").at(-1);
  assert.equal(cancelled.phase, "planning");
  assert.equal(cancelled.failureKind, "cancelled", "said as cancelled, not as a round that could not be resolved");
  assert.equal(cancelled.step, undefined, "no step once it is not resolving");
  for (const message of s.to(s.guest, "round")) assert.equal(validate(HOST_MESSAGES.round, message).ok, true);
  // The host's screen goes: every screen says so, the round waits, and the host's row says it is away.
  s.host.leave(s.hostPlayer);
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).hostAway, true);
  assert.equal(s.to(s.guest, "lobby").at(-1).seats.find((seat) => seat.country === LATVIA).status, "away");
  assert.equal(validate(HOST_MESSAGES.lobby, s.to(s.guest, "lobby").at(-1)).ok, true);
  // And back.
  s.host.join({ ...s.hostPlayer, id: "loopback-2" });
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).hostAway, undefined);
  assert.equal(s.to(s.guest, "lobby").at(-1).seats.find((seat) => seat.country === LATVIA).status, "human");
  // A round that fails is said as failed.
  release();
  s.host.control.resolveNow();
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).failed, 0, "it landed");
});

test("what the host says about a line a player wrote names the conversation and the line, for that conversation to show it", async () => {
  const s = setup({ settings: { replies: "own", hostAnswers: 1 }, replyTo: () => { throw new Error("The table's turn broke."); } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  s.store.docs.world.wars = [{ id: "war-1", title: "The Narva War", status: "active", sideA: [RUSSIA], sideB: [ESTONIA] }];
  // The host's AI answers the first, and its turn fails: the writer is told, in the thread, under that line.
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow proposes a ceasefire." });
  await s.clock.flush();
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  const first = thread.messages.at(-1).id;
  const failed = s.to(s.guest, "notice").at(-1);
  assert.equal(failed.level, "warn");
  assert.match(failed.text, /The host could not write the answer to your message/);
  assert.deepEqual([failed.about, failed.thread, failed.line], ["thread", thread.id, first]);
  assert.equal(validate(HOST_MESSAGES.notice, failed).ok, true);
  // Past the host's answers this round: said under the second line.
  await s.request(s.guest, { t: "say", id: id(3), thread: thread.id, to: [], text: "And Narva?" });
  await s.clock.flush();
  const second = s.store.docs.chat.find((chat) => chat.id === thread.id).messages.at(-1).id;
  const spent = s.to(s.guest, "notice").at(-1);
  assert.match(spent.text, /at most 1 of your messages a round/);
  assert.deepEqual([spent.about, spent.thread, spent.line], ["thread", thread.id, second]);
});

test("a seat the host takes back leaves the next player of that country none of the last player's orders, goal or letters", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "order", id: id(2), text: "Mass troops at Narva" });
  await s.request(s.guest, { t: "goal", id: id(3), text: "Take back the Baltic coast" });
  await s.request(s.guest, { t: "say", id: id(4), thread: null, to: [LATVIA], text: "A private word, Riga." });
  assert.ok(s.store.docs.actions.some((action) => action.text === "Mass troops at Narva"));
  assert.ok(s.store.docs.world.playerGoals?.[RUSSIA]);
  s.host.control.kick(RUSSIA);
  await s.clock.flush();
  assert.equal(s.store.docs.actions.some((action) => action.text === "Mass troops at Narva"), false, "its queued order went with its player");
  assert.equal(s.store.docs.world.playerGoals?.[RUSSIA], undefined);
  const letter = s.store.docs.chat.find((chat) => (chat.messages ?? []).some((message) => message.text === "A private word, Riga."));
  assert.equal(letter.status, "closed", "a letter between people is not the next player's to read");
  assert.equal(projectForViewer({ ...s.store.docs, game: { ...s.store.docs.game, country: LATVIA } }, RUSSIA).chat.some((chat) => chat.id === letter.id), false, "nor sent to the next player of Russia");
  assert.equal(projectForViewer({ ...s.store.docs, game: { ...s.store.docs.game, country: LATVIA } }, LATVIA).chat.some((chat) => chat.id === letter.id), true, "the other person keeps it, closed");
});

// What is only ordered stays private until the skip (decision 6), as a property of the order and its date, not of a
// snapshot taken when a round landed or sharing began (the review of 2026-11-18, wars 5, 6; views 10).
test("a fleet ordered, in the lobby or in a round, and a line given up are seen by the others as they stood until the skip", async () => {
  const chart = { sea: (lng, lat) => lat > 55, joins: () => true, holds: (country, lng, lat) => (lat > 55 ? null : country === RUSSIA), coastOff: () => null };
  const s = setup({
    readChart: async () => chart,
    // The skip carries the orders out, and moves the date on.
    roundWrites: (docs) => {
      docs.game = { ...docs.game, gameDate: "2014-05-01" };
    },
  });
  s.store.docs.world.units = [{ id: "ru-fleet", name: "Baltic Fleet", type: "naval", ownerCode: RUSSIA, strength: 90, lng: 20.5, lat: 56.5, status: "idle", posture: "patrol" }];
  s.store.docs.world.fortifications = [{ id: "built-1", name: "The Old Line", owner: RUSSIA, level: 5, points: [[20, 50], [20.6, 50.4]], building: { since: "2014-03-01", days: 90 } }];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  // In the lobby: a fleet's order was counted seen the moment the game started.
  await s.request(s.guest, { t: "fleet", id: id(2), op: { op: "posture", unit: "ru-fleet", posture: "holding" } });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  await s.host.control.start();
  await s.request(s.guest, { t: "fortify", id: id(3), op: { op: "unfortify", id: "built-1" } });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  await s.request(s.hostPlayer, { t: "order", id: id(4), text: "Watch the coast" });
  const hostSees = () => s.shown(s.hostPlayer).world;
  assert.equal(hostSees().units.find((unit) => unit.id === "ru-fleet").posture, "patrol", "the host sees the fleet as it stood");
  assert.deepEqual(hostSees().fortifications.map((line) => line.id), ["built-1"], "and the line it had seen being built");
  assert.deepEqual(s.shown(s.guest).world.fortifications, [], "its owner gave it up");
  assert.equal(s.store.docs.world.fortifications.length, 0, "gone from the world at once, as in single player");
  // The round lands: everyone sees the world as it is.
  s.host.control.resolveNow();
  await s.clock.flush();
  await s.request(s.hostPlayer, { t: "order", id: id(5), text: "Watch the coast again" });
  assert.equal(hostSees().units.find((unit) => unit.id === "ru-fleet").posture, "holding");
  assert.deepEqual(hostSees().fortifications, []);
  assert.deepEqual([s.store.docs.world.seenFleetPostures, s.store.docs.world.linesGivenUp], [{}, []], "nothing kept once seen");
});

// A hunt could name a convoy only ordered, which the hunter's view did not hold, and the smallest-number ids of the
// engine told a player how many hidden convoys and lines held the numbers below its own (the review of 2026-11-18,
// wars 4).
test("a hunt finds only a convoy its hunter sees, refused in the same words as one that is not there; what a player sends has an id that tells nothing", async () => {
  const sheet = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend: { A: RUSSIA, B: LATVIA, "~": null }, west: 20, north: 51, step: 1, stepLat: 0.65, cities: [] });
  const row = (lng, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: 49.1 + ((index + 0.5) * 1.8) / count }));
  const field = battlefieldOn(sheet, { name: "The Baltic Front", sides: [[RUSSIA], [LATVIA]], troops: [row(20.9, 20), row(21.1, 12)] });
  const s = setup({ readChart: async () => ({ holds: (country) => country === LATVIA, sea: () => false, joins: () => true }) });
  const convoy = (cid, status) => ({ id: cid, medium: "sea", kind: "troop convoy", owner: RUSSIA, warId: field.warId, to: { lng: 24, lat: 57, name: "city: Riga" }, from: { lng: 20, lat: 57 }, speed: 700, capacity: 6, raise: 6, status, way: [[20, 57], [24, 57]], km: 240, by: RUSSIA });
  s.store.docs.world.battlefields = [field];
  s.store.docs.world.transports = [convoy("t1", "ordered"), convoy("t2", "moving")];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const hunt = (n, tid) => s.request(s.hostPlayer, { t: "warroom", id: id(n), op: { op: "hunt", battlefield: "The Baltic Front", id: tid } });
  await hunt(2, "t1");
  await hunt(3, "t9");
  assert.equal(s.ack(s.hostPlayer, id(2)).error, s.ack(s.hostPlayer, id(3)).error, "a hidden convoy and none at all are answered alike");
  assert.match(s.ack(s.hostPlayer, id(2)).error, /not a transporter of a side you are fighting/);
  assert.deepEqual(s.store.docs.world.transports.find((entry) => entry.id === "t1").hunters ?? [], []);
  await hunt(4, "t2");
  assert.equal(s.ack(s.hostPlayer, id(4)).ok, true, "one under way, which every view holds, is hunted");
  assert.deepEqual(s.store.docs.world.transports.find((entry) => entry.id === "t2").hunters, [LATVIA]);
  // The host's own convoy, sent: an id of the host's, not the smallest number free.
  await s.request(s.hostPlayer, { t: "warroom", id: id(5), op: { op: "transport", battlefield: "The Baltic Front", troops: [0, 1], medium: "sea", to: [24, 57.5], name: "city: Pärnu" } });
  assert.equal(s.ack(s.hostPlayer, id(5)).ok, true);
  const sentOne = s.store.docs.world.transports.at(-1);
  assert.equal(sentOne.owner, LATVIA);
  assert.match(sentOne.id, /^t[0-9a-z]{8}$/);
  // And a line built: an id of the host's too.
  await s.request(s.hostPlayer, { t: "fortify", id: id(6), op: { op: "fortify", points: [[24, 50], [24.6, 50.4]], level: 4 } });
  assert.equal(s.ack(s.hostPlayer, id(6)).ok, true);
  assert.match(s.store.docs.world.fortifications.at(-1).id, /^line-[0-9a-z]{8}$/);
});

// --- WHO PAYS, AND THE GAME MASTER ---------------------------------------------------------
// The gap audit of 2026-11-18, items 29 to 31: what only the host's AI may answer is held to a number the host sets;
// players take turns to pay for the round's request, which goes, as built, to the paying device and comes back as an
// answer; and the Game Master is the host's, where the lobby says so, with every change told to every player.

// Round `round` read through by everyone, so the next is planned.
const readRound = async (s, players, round) => {
  for (const [index, player] of players.entries()) await s.request(player, { t: "revealed", id: id(800 + round * 10 + index), round });
  await s.clock.flush();
};

test("with each player's own AI, what only the host's AI may answer is held to the host's number a round, and the writer is told", async () => {
  const asked = [];
  const s = setup({ settings: { replies: "own", hostAnswers: 1 }, institution: async (request) => { asked.push(request); return { chatId: "council-1" }; } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  s.store.docs.world.wars = [
    { id: "war-1", title: "The Narva War", status: "active", sideA: [RUSSIA], sideB: [ESTONIA] },
    { id: "war-2", title: "The Daugava War", status: "active", sideA: [LATVIA], sideB: [ESTONIA] },
  ];
  // The first of the round: the host's AI answers, as its answer may make peace.
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow proposes a ceasefire." });
  await s.clock.flush();
  assert.equal(s.replies.length, 1);
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA).id;
  assert.equal(s.ack(s.guest, id(2)).result.answer, undefined);
  // The second is past the number: written, read by the round, and its writer told why nobody answers it now.
  await s.request(s.guest, { t: "say", id: id(3), thread, to: [], text: "And Narva?" });
  await s.clock.flush();
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.equal(s.ack(s.guest, id(3)).result.answer, "round", "nothing is left to the device: words alone cannot end a war");
  assert.equal(s.replies.length, 1, "the host's AI was not asked again");
  assert.ok(s.store.docs.chat.find((chat) => chat.id === thread).messages.some((message) => message.text === "And Narva?"));
  assert.match(s.to(s.guest, "notice").at(-1).text, /at most 1 of your messages a round to a government that can act on them/);
  assert.equal(s.to(s.hostPlayer, "notice").some((entry) => /at most 1/.test(entry.text)), false, "told to the writer alone");
  // A Council's turn is one of them too: refused, and the desk is not asked.
  await s.request(s.guest, { t: "institution", id: id(4), call: "council", args: { institutionId: "baltic-pact", proposalId: "p1", kind: "debate" } });
  assert.match(s.ack(s.guest, id(4)).error, /you have had them this round/);
  assert.equal(asked.length, 0);
  // The host's own lines are its own key's either way: never counted.
  for (const n of [5, 6]) {
    await s.request(s.hostPlayer, { t: "say", id: id(n), thread: null, to: [ESTONIA], text: `Riga writes to Tallinn (${n}).` });
    await s.clock.flush();
  }
  assert.equal(s.replies.length, 3);
  // The next round gives each player its answers again.
  await playRound(s, [s.hostPlayer, s.guest]);
  await readRound(s, [s.hostPlayer, s.guest], 2);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "planning");
  await s.request(s.guest, { t: "say", id: id(7), thread, to: [], text: "Moscow asks again." });
  await s.clock.flush();
  assert.equal(s.replies.length, 4);
  // The host may change the number while the game runs, and everyone is told.
  assert.equal(s.host.control.setHostAnswers(0), true);
  assert.equal(s.host.control.setHostAnswers(0), false, "already so");
  assert.equal(s.to(s.guest, "lobby").at(-1).settings.hostAnswers, 0);
  assert.equal(validate(HOST_MESSAGES.lobby, s.to(s.guest, "lobby").at(-1)).ok, true);
  assert.match(s.to(s.guest, "notice").at(-1).text, /answers no messages between rounds/);
  await s.request(s.guest, { t: "say", id: id(8), thread, to: [], text: "Moscow waits." });
  await s.clock.flush();
  assert.equal(s.replies.length, 4);
  assert.match(s.to(s.guest, "notice").at(-1).text, /does not answer messages to a government that can act on them/);
  // And with the host's AI answering every message, there is no number at all.
  assert.equal(s.host.control.setReplies("host"), true);
  await s.request(s.guest, { t: "say", id: id(9), thread, to: [], text: "Moscow, on the host's AI." });
  await s.clock.flush();
  assert.equal(s.replies.length, 5);
});

// The request the host's engine builds, as callAI hands it to the carrier (Game/AI/roundCarrier.js).
const BUILT = {
  systemPrompt: "[Difficulty]\n\nThe world as the host's engine built it: every player's orders and secrets.",
  history: [{ role: "user", parts: [{ text: "Simulate the next 30 days." }] }],
  opts: { tool: { name: "submit_jump", description: "The period.", schema: { type: "object", properties: { events: { type: "array" } } } }, taskKey: "jumpForward", staticPrefixEnd: 12 },
  lookups: { tools: [{ name: "look_up_region", description: "A region.", schema: { type: "object" } }], maxRounds: 2 },
};
const builtRequest = () => carriedRequestOf(BUILT);
// What a guest's device states about paying for a round: it can, and its own settings. No key.
const CAN_PAY = { ready: true, noRequestLimit: false, lookups: true, segmented: false, declares: false };
// The engine's skip, as engineMain.js runs it around a round another device pays: the carrier
// installed with that device's own rules, and the skip's request through callAI's carried path.
const carryThrough = async (info, { execute = async () => null, counted = [] } = {}) => {
  const uninstall = installRoundCarrier(info.carry, { rules: info.payer?.rules ?? null, who: info.payer?.device ?? "" });
  try {
    return await carriedCall({ ...BUILT, lookups: { ...BUILT.lookups, execute, onRound: (round) => counted.push(round) }, spender: "jump" });
  } finally {
    uninstall();
  }
};

test("players take turns to pay: a device that says it can is given its turn, and the round's request goes to it, as built, under its own settings", async () => {
  const answers = [];
  const looked = [];
  const rules = [];
  const counted = [];
  const s = setup({
    settings: { payment: "cycle" },
    carried: async (info) => {
      if (!info.carry) return;
      rules.push(info.payer?.rules);
      answers.push(await carryThrough(info, { counted, execute: async (name, args) => { looked.push({ name, args }); return { region: "Narva", holder: ESTONIA }; } }));
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  assert.equal(validate(HOST_MESSAGES.lobby, s.to(s.guest, "lobby").at(-1)).ok, true);
  assert.equal(s.to(s.guest, "lobby").at(-1).settings.payment, "cycle", "every screen is told who pays");
  // The first round is the host's turn, in seat order: no request leaves its computer.
  assert.equal(s.to(s.guest, "round").at(-1).payer, LATVIA);
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.equal(s.resolved.length, 1);
  assert.equal(s.resolved[0].carry, undefined);
  assert.equal(s.to(s.guest, "pay").length, 0);
  await readRound(s, [s.hostPlayer, s.guest], 2);
  // Russia's device has said nothing of paying: it is not asked, and the host's AI pays again.
  assert.equal(s.to(s.guest, "round").at(-1).payer, LATVIA);
  assert.equal(s.to(s.guest, "lobby").at(-1).seats.find((seat) => seat.country === RUSSIA).pays, false);
  // It says it can, with its own settings and no key: every screen hears whose turn is next.
  await s.request(s.guest, { t: "canPay", id: id(10), ...CAN_PAY });
  assert.equal(s.ack(s.guest, id(10)).ok, true);
  assert.equal(s.to(s.guest, "lobby").at(-1).seats.find((seat) => seat.country === RUSSIA).pays, true);
  assert.equal(validate(HOST_MESSAGES.lobby, s.to(s.guest, "lobby").at(-1)).ok, true);
  assert.equal(s.to(s.guest, "round").at(-1).payer, RUSSIA);
  assert.equal(validate(HOST_MESSAGES.round, s.to(s.guest, "round").at(-1)).ok, true);
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  assert.deepEqual(rules, [CAN_PAY], "the engine builds the round under the paying device's own settings");
  const pay = s.to(s.guest, "pay").at(-1);
  assert.equal(validate(HOST_MESSAGES.pay, pay).ok, true);
  assert.equal(pay.round, 2);
  assert.deepEqual(pay.call, builtRequest(), "exactly the request the engine built: no key, and nothing taken out");
  assert.equal(JSON.stringify(pay).includes("apiKey"), false);
  assert.equal(s.to(s.hostPlayer, "pay").length, 0, "sent to the payer alone");
  // A lookup its model asks for is answered from the host's own game, and the round it begins is counted.
  await s.request(s.guest, { t: "payLookup", id: id(2), job: pay.job, name: "look_up_region", args: { name: "Narva" }, round: 1 });
  assert.deepEqual(looked, [{ name: "look_up_region", args: { name: "Narva" } }]);
  assert.deepEqual(JSON.parse(s.ack(s.guest, id(2)).result.text), { region: "Narva", holder: ESTONIA });
  await s.host.receive(s.guest, { t: "payAlive", job: pay.job, round: 1 });
  assert.deepEqual(counted, [1], "the skip's budget hears the payer's lookup round as one of its own");
  // Nobody else answers for it: not the host's screen, and not a request that is not waiting.
  await s.request(s.hostPlayer, { t: "paid", id: id(3), job: pay.job, answer: { text: "Forged.", toolJson: "", asText: true } });
  assert.match(s.ack(s.hostPlayer, id(3)).error, /not waiting for an answer from your device/);
  await s.request(s.guest, { t: "paid", id: id(4), job: "pay-9-x", answer: { text: "Forged.", toolJson: "", asText: true } });
  assert.match(s.ack(s.guest, id(4)).error, /not waiting/);
  assert.equal(s.resolved.length, 1, "still waiting for the payer");
  // Its answer, as its AI gave it: the round's, applied by the host's engine as its own.
  const period = { events: [{ title: "Talks at Narva", date: "2014-05-03" }] };
  await s.request(s.guest, { t: "paid", id: id(5), job: pay.job, answer: { text: "", toolJson: JSON.stringify(period), asText: false } });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
  await s.clock.flush();
  assert.deepEqual(answers, [{ rawText: "", toolInput: period }]);
  assert.equal(s.resolved.length, 2);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "revealing");
  // Once: the same answer again is not waited for.
  await s.request(s.guest, { t: "paid", id: id(6), job: pay.job, answer: { text: "Again.", toolJson: "", asText: true } });
  assert.match(s.ack(s.guest, id(6)).error, /not waiting/);
  // Round the table: the third is the host's again.
  await readRound(s, [s.hostPlayer, s.guest], 3);
  assert.equal(s.to(s.guest, "round").at(-1).payer, LATVIA);
});

test("a payer whose AI fails, or who is gone, fails the round visibly and its turn is taken; the host paying instead leaves the turn where it was", async () => {
  const s = setup({
    settings: { payment: "cycle" },
    carried: async (info) => {
      if (info.carry) await carryThrough(info);
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.request(s.guest, { t: "canPay", id: id(20), ...CAN_PAY });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  await readRound(s, [s.hostPlayer, s.guest], 2);
  // Russia's turn, and its AI cannot answer: the round says why in the host's words, and waits.
  await playRound(s, [s.hostPlayer, s.guest]);
  const pay = s.to(s.guest, "pay").at(-1);
  await s.request(s.guest, { t: "paid", id: id(2), job: pay.job, failure: { kind: "none", busy: false } });
  await s.clock.flush();
  let status = s.to(s.guest, "round").at(-1);
  assert.equal(status.phase, "planning");
  assert.equal(status.failed, 2);
  assert.match(status.failure, /Russian Federation's device could not make the round's request: it has no AI that can make it now\./);
  const told = s.to(s.hostPlayer, "notice").map((entry) => entry.text).join(" ");
  assert.match(told, /Round 2 could not be resolved/);
  assert.match(told, /Russian Federation's turn to pay is taken: run again, round 2 is paid by the next player in turn\./);
  // Its device says it cannot pay now: it is passed over, and the round run again is the host's.
  await s.request(s.guest, { t: "canPay", id: id(21), ...CAN_PAY, ready: false });
  assert.equal(s.to(s.guest, "lobby").at(-1).seats.find((seat) => seat.country === RUSSIA).pays, false);
  status = s.to(s.guest, "round").at(-1);
  assert.equal(status.payer, LATVIA, "never asked again while it cannot: before, it kept the turn for ever");
  const asked = s.to(s.guest, "pay").length;
  s.host.control.resolveNow();
  await s.clock.flush();
  assert.equal(s.to(s.guest, "pay").length, asked, "no request left the host's computer");
  assert.equal(s.resolved.length, 2);
  await readRound(s, [s.hostPlayer, s.guest], 3);
  // Set up again, it takes its turn; its device goes and comes back within the wait.
  await s.request(s.guest, { t: "canPay", id: id(22), ...CAN_PAY });
  assert.equal(s.to(s.guest, "round").at(-1).payer, RUSSIA);
  await playRound(s, [s.hostPlayer, s.guest]);
  const again = s.to(s.guest, "pay").at(-1);
  assert.notEqual(again.job, pay.job);
  s.host.leave(s.guest);
  await s.clock.advance(PAYER_GONE_MS / 2);
  const back = { ...s.guest, id: "p-guest-2" };
  s.host.join(back);
  await s.clock.flush();
  assert.equal(s.to(back, "pay").at(-1).job, again.job, "sent the request once more");
  // Gone for good: the round fails with why, and the turn is taken.
  s.host.leave(back);
  await s.clock.advance(PAYER_GONE_MS + 1000);
  status = s.sent.filter((entry) => entry.message.t === "round").at(-1).message;
  assert.equal(status.phase, "planning");
  assert.match(status.failure, /left before it made the round's request/);
  assert.equal(status.payer, LATVIA);
  // Run again on the host's AI, it lands; the next is Russia's.
  s.host.join(s.guest);
  await s.clock.flush();
  s.host.control.resolveNow();
  await s.clock.flush();
  assert.equal(s.resolved.length, 3);
  await readRound(s, [s.hostPlayer, s.guest], 4);
  assert.equal(s.to(s.guest, "round").at(-1).payer, RUSSIA);
  // The host pays Russia's round itself: Russia was never asked, and the turn is still Russia's after.
  assert.equal(s.host.control.payRound(), true);
  await s.clock.flush();
  assert.match(s.to(s.guest, "notice").map((entry) => entry.text).join(" "), /The host pays for round 4 itself\./);
  assert.equal(s.resolved.length, 4);
  assert.equal(s.resolved[3].carry, undefined, "no request left the host's computer");
  assert.equal(s.to(s.guest, "round").at(-1).failed, 0);
  await readRound(s, [s.hostPlayer, s.guest], 5);
  assert.equal(s.to(s.guest, "round").at(-1).payer, RUSSIA);
  // Not a way to pay where the host pays for every round.
  const t = setup();
  t.host.join(t.hostPlayer);
  await t.host.control.start();
  assert.equal(t.host.control.payRound(), false);
  assert.equal(t.to(t.hostPlayer, "round").at(-1).payer, undefined);
});

test("a payer the host lets go of while it pays fails the round at once, and its late answer is not waited for", async () => {
  const s = setup({ settings: { payment: "cycle" }, carried: async (info) => { if (info.carry) await carryThrough(info); } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.request(s.guest, { t: "canPay", id: id(30), ...CAN_PAY });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  await readRound(s, [s.hostPlayer, s.guest], 2);
  await playRound(s, [s.hostPlayer, s.guest]);
  const pay = s.to(s.guest, "pay").at(-1);
  assert.equal(s.host.control.kick(RUSSIA), s.guest.device);
  await s.clock.flush();
  assert.deepEqual(s.to(s.guest, "payStop").at(-1), { t: "payStop", job: pay.job });
  const status = s.to(s.hostPlayer, "round").at(-1);
  assert.equal(status.phase, "planning", "before, the round waited for ever");
  assert.match(status.failure, /Russian Federation's player was let go before their device made the round's request/);
  // Still connected, its answer is judged by its device and job, not by a seat it no longer has.
  await s.request(s.guest, { t: "paid", id: id(31), job: pay.job, answer: { text: "Late.", toolJson: "", asText: true } });
  assert.match(s.ack(s.guest, id(31)).error, /not waiting for an answer from your device/);
});

test("a round the host cancels while a player's device pays it tells that device to stop and takes its turn; who took it last is kept with the session", async () => {
  const campaign = "game-baltic";
  const s = setup({ campaign, settings: { payment: "cycle" }, carried: async (info) => { if (info.carry) await carryThrough(info); } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.request(s.guest, { t: "canPay", id: id(40), ...CAN_PAY });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  await readRound(s, [s.hostPlayer, s.guest], 2);
  await playRound(s, [s.hostPlayer, s.guest]);
  const pay = s.to(s.guest, "pay").at(-1);
  assert.equal(s.host.control.cancelRound(), true);
  await s.clock.flush();
  assert.deepEqual(s.to(s.guest, "payStop").at(-1), { t: "payStop", job: pay.job });
  assert.equal(validate(HOST_MESSAGES.payStop, s.to(s.guest, "payStop").at(-1)).ok, true);
  assert.match(s.to(s.guest, "round").at(-1).failure, /cancelled/);
  assert.equal(s.to(s.guest, "round").at(-1).payer, LATVIA, "its key spent what it spent: run again, the round is the next payer's");
  // The record says Russia took the last turn, and a game taken up again goes on with the next.
  await s.host.stop();
  const record = s.store.shared.at(-1);
  assert.equal(record.lastPayer, "device-guest");
  const restored = sessionFromRecord(record, { campaign, hostDevice: "device-host" });
  assert.equal(restored.lastPayer, "device-guest");
  const t = setup({ campaign, settings: { payment: "cycle" }, restored });
  t.host.join(t.hostPlayer);
  t.host.join(t.guest);
  await t.clock.flush();
  assert.equal(t.to(t.guest, "round").at(-1).payer, LATVIA);
});

// The Game Master's whole AI call was one entry of the queue, and every player's requests waited behind the model
// with no word (FOLLOWUPS A5). It thinks outside the queue and writes inside it, as the rest of the AI's work does.
test("the Game Master is the host's, only where the lobby says so: it thinks outside the queue and writes as one entry, never while a round resolves, and told to every player", async () => {
  // Off unless the host says: nothing is asked.
  const off = setup({ gameMaster: async () => assert.fail("asked in a game without a Game Master") });
  off.host.join(off.hostPlayer);
  assert.equal(await off.host.control.gameMaster("Give Latvia the coast."), false);
  assert.match(off.to(off.hostPlayer, "notice").at(-1).text, /The Game Master is off in this game/);

  const commands = [];
  const applied = [];
  let gate = Promise.resolve();
  let s = null;
  s = setup({
    settings: { cheats: "host" },
    holdResolve: new Promise(() => {}),
    // The engine's (engineMain.js): the preview asked of the AI, then applied in the host's order.
    gameMaster: async ({ command, write }) => {
      commands.push(command);
      await gate;
      return write(async () => {
        if (/fail/.test(command)) throw new Error("Canonical state changed after this preview was generated.");
        applied.push({ command, actions: s.store.docs.actions.map((action) => action.text) });
        s.store.docs.world = { ...s.store.docs.world, gmTouched: true };
        return { summary: "Estonia's border moved to the Narva.", eventIds: ["event-gm-1"], warIds: [], statCountries: [ESTONIA] };
      });
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  // While it thinks, a player's order is applied at once; what it changes is written after, in the queue's order.
  let open;
  gate = new Promise((resolve) => { open = resolve; });
  const working = s.host.control.gameMaster("Move Estonia's border to the Narva.");
  await s.clock.flush();
  await s.request(s.guest, { t: "order", id: id(2), text: "Hold the line at Pskov" });
  assert.equal(s.ack(s.guest, id(2)).ok, true, "answered while the Game Master thinks");
  assert.deepEqual(s.to(s.guest, "held"), [], "nothing waits for it");
  assert.equal(s.store.docs.world.gmTouched, undefined, "nothing of it is written yet");
  open();
  assert.equal(await working, true);
  assert.ok(applied[0].actions.includes("Hold the line at Pskov"), "written after what was applied while it thought");
  assert.equal(s.store.docs.world.gmTouched, true);
  assert.deepEqual(commands, ["Move Estonia's border to the Narva."]);
  // Every player is told what it changed, and every lobby lists it, with what
  // it touched as fields each screen says in its own words (gameMasterChangeLines).
  for (const player of [s.hostPlayer, s.guest]) {
    assert.ok(s.to(player, "notice").some((entry) => entry.text === "The host used the Game Master: Estonia's border moved to the Narva." && entry.about === "gm"));
  }
  const lobby = s.to(s.guest, "lobby").at(-1);
  assert.equal(validate(HOST_MESSAGES.lobby, lobby).ok, true);
  assert.deepEqual(lobby.gameMaster, [{
    round: 1, date: "2014-04-01", summary: "Estonia's border moved to the Narva.",
    changed: { events: 1, wars: 0, relations: 0, agreements: 0, figures: ["Republic of Estonia"], moreFigures: 0 },
  }]);
  assert.equal(lobby.settings.cheats, "host", "every lobby says the Game Master may be used");
  // One that changes nothing tells the host why, and nobody else anything:
  // said about the Game Master, for its box to show where the host gave it.
  assert.equal(await s.host.control.gameMaster("Make it fail."), false);
  assert.match(s.to(s.hostPlayer, "notice").at(-1).text, /The Game Master changed nothing: Canonical state changed/);
  assert.equal(s.to(s.hostPlayer, "notice").at(-1).about, "gm");
  assert.equal(validate(HOST_MESSAGES.notice, s.to(s.hostPlayer, "notice").at(-1)).ok, true);
  assert.equal(s.to(s.guest, "notice").some((entry) => /changed nothing/.test(entry.text)), false);
  assert.equal(s.to(s.guest, "lobby").at(-1).gameMaster.length, 1);
  // A round that begins while it thinks moves the world it read on: nothing is written, and the host is told now.
  gate = new Promise((resolve) => { open = resolve; });
  const overtaken = s.host.control.gameMaster("Move the border north.");
  await s.clock.flush();
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  open();
  assert.equal(await overtaken, false);
  assert.match(s.to(s.hostPlayer, "notice").at(-1).text, /A round began while the Game Master was at work/);
  assert.equal(applied.length, 1, "nothing of it was applied");
  // Never asked while a round is resolved.
  assert.equal(await s.host.control.gameMaster("Move it back."), false);
  assert.match(s.to(s.hostPlayer, "notice").at(-1).text, /Not while a round is being resolved/);
  assert.equal(commands.length, 3);
});

// An institution's Council turn ran outside the one answer at a time at each
// table: beside an answer in the same thread it read the thread as it was,
// and the second's lines were dropped (the gap audit of 2026-11-18, D2).
test("a Council's turn waits for the answer under way at its table, and another table's does not", async () => {
  let running = 0;
  let most = 0;
  const gates = [];
  const turn = () => new Promise((resolve) => { gates.push(resolve); });
  const councilTurns = [];
  let s = null;
  const desk = createInstitutionDesk({
    host: LATVIA,
    game: {
      channel: async ({ institutionId }) => ({ channel: { id: institutionId === "inst-2" ? "council-2" : "council-1" } }),
      message: async () => ({ channel: { id: "council-1" } }),
      chatTurn: async ({ chat }) => {
        councilTurns.push(chat.id);
        running += 1;
        most = Math.max(most, running);
        await turn();
        running -= 1;
      },
      readChats: async () => s.store.docs.chat,
      updateChats: async (fn) => s.store.updateChats(fn),
    },
  });
  s = setup({
    institution: desk,
    replyTo: async () => {
      running += 1;
      most = Math.max(most, running);
      await turn();
      running -= 1;
    },
  });
  s.store.docs.chat.push(
    { id: "council-1", institutionId: "inst-1", countries: [{ code: RUSSIA, name: RUSSIA }, { code: ESTONIA, name: ESTONIA }], messages: [] },
    { id: "council-2", institutionId: "inst-2", countries: [{ code: RUSSIA, name: RUSSIA }, { code: ESTONIA, name: ESTONIA }], messages: [] },
  );
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  // A line in the Council: its governments' answer is under way.
  await s.request(s.guest, { t: "say", id: id(2), thread: "council-1", to: [], text: "Moscow addresses the council." });
  await s.clock.flush();
  assert.equal(s.replies.length, 1);
  // The Council's debate on a proposal, asked meanwhile, waits for it.
  const debate = s.host.receive(s.guest, { t: "institution", id: id(3), call: "council", args: { institutionId: "inst-1", proposalId: "p1", kind: "debate" } });
  // Another institution's Council is its own table: it goes on beside them.
  const other = s.host.receive(s.guest, { t: "institution", id: id(4), call: "council", args: { institutionId: "inst-2", proposalId: "p9", kind: "debate" } });
  await s.clock.flush();
  assert.deepEqual(councilTurns, ["council-2"], "the first Council's turn has not begun");
  gates.shift()();
  await s.clock.flush();
  assert.deepEqual(councilTurns, ["council-2", "council-1"], "its turn came once the answer was written");
  assert.equal(most, 2, "one turn at a time at each table");
  while (gates.length) gates.shift()();
  await Promise.all([debate, other]);
  await s.clock.flush();
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  assert.equal(s.ack(s.guest, id(4)).ok, true);
});

// Any member closed or renamed an institution's Council for every member (the
// gap audit of 2026-11-18, N6).
test("nobody renames or closes an institution's Council for everyone at it", async () => {
  const s = setup();
  s.store.docs.chat.push({ id: "council-1", institutionId: "inst-1", player: RUSSIA, title: "Baltic Council", countries: [{ code: LATVIA, name: LATVIA }, { code: ESTONIA, name: ESTONIA }], messages: [] });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "thread", id: id(2), op: "rename", thread: "council-1", title: "Riga's club" });
  assert.match(s.ack(s.hostPlayer, id(2)).error, /keeps the institution's name/);
  await s.request(s.guest, { t: "thread", id: id(3), op: "close", thread: "council-1" });
  assert.match(s.ack(s.guest, id(3)).error, /stays open/);
  const council = s.store.docs.chat.find((chat) => chat.id === "council-1");
  assert.equal(council.title, "Baltic Council");
  assert.notEqual(council.status, "closed");
});

// The gap audit of 2026-11-18: the host refused no request for a feature its game has off, though every screen hid
// it; a changed page placed agents with no espionage and sailed fleets with no navies. One gate per request, before
// it does anything, with the host's reason.
test("the host refuses a request for what its game has switched off, with its reason, and changes nothing", async () => {
  const features = resolveFeatures(null, { espionage: { enabled: false }, fronts: { navies: false } });
  const s = setup({ features });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const before = JSON.stringify(s.store.docs.world);
  await s.request(s.guest, { t: "agent", id: id(2), op: "deploy", target: ESTONIA, spy: "", story: "" });
  assert.equal(s.ack(s.guest, id(2)).error, "This game has no espionage.");
  await s.request(s.guest, { t: "fleet", id: id(3), op: { op: "posture", unit: "ru-fleet", posture: "withdrawing" } });
  assert.equal(s.ack(s.guest, id(3)).error, "This game has no navies.");
  await s.request(s.guest, { t: "deploy", id: id(4), type: "naval", strength: 100, name: "", composition: "", lng: 20, lat: 59 });
  assert.equal(s.ack(s.guest, id(4)).error, "This game has no navies.");
  assert.equal(JSON.stringify(s.store.docs.world), before);
  // What the game does have is taken as ever.
  await s.request(s.guest, { t: "order", id: id(5), text: "Hold the line at Pskov." });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
});

// Rule 7, same inputs: what decides each round beyond the settings is stated in the lobby (host/hostRules.js), and a
// change the host makes to its AI settings mid-game reaches every screen.
test("the lobby states the rules every round is played by, and says when the host's AI settings change them", async () => {
  const rules = roundRulesOf({ difficulty: "hard" });
  const s = setup({ rules });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.clock.flush();
  const lobby = s.to(s.guest, "lobby").at(-1);
  assert.deepEqual(lobby.rules, { difficulty: "hard", requests: 1, most: 1, stallMinutes: 0, quietMinutes: 0 });
  assert.equal(validate(HOST_MESSAGES.lobby, lobby).ok, true);
  const sent = s.to(s.guest, "lobby").length;
  assert.equal(s.host.control.setRules(roundRulesOf({ difficulty: "hard" })), false, "nothing changed, nothing said");
  assert.equal(s.to(s.guest, "lobby").length, sent);
  assert.equal(s.host.control.setRules(roundRulesOf({ difficulty: "hard", noRequestLimit: true, limitGeneration: true })), true);
  const told = s.to(s.guest, "lobby").at(-1);
  assert.equal(told.rules.most > 1, true);
  assert.equal(told.rules.stallMinutes, 15);
  assert.equal(told.rules.quietMinutes, 5);
  assert.equal(validate(HOST_MESSAGES.lobby, told).ok, true);
});

// Item 41: a seat's release to the AI runs in the engine on the host's clock (the leaver's grace), as the lobby says.
test("a player who leaves keeps their country for the grace, then the AI plays it until they are back, on the host's clock", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  s.host.leave(s.guest);
  await s.clock.flush();
  const status = (country) => s.to(s.hostPlayer, "lobby").at(-1).seats.find((seat) => seat.country === country)?.status;
  assert.equal(status(RUSSIA), "away");
  await s.clock.advance(45_000);
  assert.equal(status(RUSSIA), "away", "within the minute's grace");
  await s.clock.advance(30_000);
  assert.equal(status(RUSSIA), "ai");
  assert.ok(s.to(s.hostPlayer, "notice").some((entry) => entry.text.includes(`${RUSSIA} is now played by the AI`)));
  s.host.join(s.guest);
  await s.clock.flush();
  assert.equal(status(RUSSIA), "human", "theirs again when they are back");
});

// --- WHO A REQUEST ACTS FOR, AND WHAT FOLLOWS A SEAT ---------------------------------------
// The review of 2026-11-18, cluster "seats": a seat was looked up before its request waited in the queue, and what
// the host kept for a seat was kept by the country's name, so renames, foundings, releases, kicks and changes of
// country left things behind or applied them to the wrong country.

const EMPIRE = "Russian Empire";
// The game's own rename (server/polityRename.js): re-keyed, the old name kept.
const renamed = (docs, from, to) => {
  const { [from]: old, ...rest } = docs.world.polityOverrides;
  docs.world.polityOverrides = { ...rest, [to]: { ...old, code: to, name: to, formerNames: [from] } };
};

test("a request that waits behind a round acts for the seat as the round left it: renamed, its order, goal and own AI's answer are the new name's", async () => {
  let release;
  const s = setup({
    holdResolve: new Promise((resolve) => { release = resolve; }),
    countriesOf: gameCountries,
    settings: { replies: "own" },
    roundWrites: (docs) => renamed(docs, RUSSIA, EMPIRE),
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  // A line left to the guest's own device to answer, before the round.
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  const asked = s.ack(s.guest, id(2)).result;
  assert.equal(asked.answer, "own");
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  const waiting = [
    s.request(s.guest, { t: "order", id: id(3), text: "An order given while the round resolves." }),
    s.request(s.guest, { t: "goal", id: id(4), text: "A goal set while the round resolves." }),
    s.request(s.guest, { t: "reply", id: id(5), thread: asked.chatId, line: asked.line, lines: [{ speaker: ESTONIA, text: "Tallinn hears you." }] }),
  ];
  await s.clock.flush();
  release();
  await Promise.all(waiting);
  await s.clock.flush();
  assert.equal(s.store.docs.game.humanCountries.includes(EMPIRE), true);
  assert.equal(s.store.docs.actions.find((action) => /while the round resolves/.test(action.text))?.ownerCode, EMPIRE);
  assert.deepEqual(Object.keys(s.store.docs.world.playerGoals ?? {}), [EMPIRE]);
  assert.equal(s.ack(s.guest, id(5)).ok, true, "the answer its own AI wrote is taken, though a round renamed its country meanwhile");
  assert.ok(s.shown(s.guest).actions.some((action) => /while the round resolves/.test(action.text)), "and its view shows the order");
});

test("the host releases a player while a round resolves: what they sent before goes with their seat, what they send after is refused, and a pick that waited does not take it first", async () => {
  let release;
  const s = setup({ holdResolve: new Promise((resolve) => { release = resolve; }), campaign: "game-baltic" });
  const third = { id: "p-third", device: "device-third", name: "Third" };
  const newcomer = { id: "p-new", device: "device-new", name: "New" };
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  s.host.join(third);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.request(third, { t: "pick", id: id(2), country: ESTONIA });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest, third]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  s.host.join(newcomer);
  const waiting = [
    s.request(third, { t: "order", id: id(10), text: "Third's order before the release." }),
    s.request(newcomer, { t: "pick", id: id(11), country: ESTONIA }),
  ];
  await s.clock.flush();
  assert.equal(s.host.control.kick(ESTONIA), "device-third");
  await s.clock.flush();
  // Saved at once, while the round still resolves: an engine closed now keeps the host's word.
  assert.deepEqual(s.store.shared.at(-1).released, [{ device: "device-third", country: ESTONIA }]);
  const late = s.request(third, { t: "order", id: id(12), text: "Third's order after the release." });
  release();
  await Promise.all([...waiting, late]);
  await s.clock.flush();
  assert.equal(s.ack(newcomer, id(11)).error, "taken", "a pick that waited found the seat still its player's");
  assert.equal(s.ack(third, id(12)).error, `You no longer play ${ESTONIA}.`);
  assert.ok(!s.store.docs.actions.some((action) => /Third's order/.test(action.text)), "what they ordered before went with their seat");
  assert.match(s.to(third, "notice").at(-1).text, /^The host released you from Republic of Estonia\. You can take another free country/);
  // They do not take it back; anyone else may.
  await s.request(third, { t: "pick", id: id(13), country: ESTONIA });
  assert.equal(s.ack(third, id(13)).error, "released");
  await s.request(newcomer, { t: "pick", id: id(14), country: ESTONIA });
  assert.equal(s.ack(newcomer, id(14)).ok, true);
});

test("the session is saved at once, whatever the round is doing, and once more at Stop; a release saved before its seat was let go is let go when the game is taken up", async () => {
  let release;
  const campaign = "game-baltic";
  const s = setup({ holdResolve: new Promise((resolve) => { release = resolve; }), campaign });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  s.host.control.kick(RUSSIA, { ban: true });
  assert.equal(s.host.control.setReplies("own"), true);
  await s.clock.flush();
  const saved = s.store.shared.at(-1);
  assert.deepEqual(saved.banned, ["device-guest"]);
  assert.equal(saved.settings.replies, "own", "a change of who answers is saved");
  assert.equal(saved.seats.find((seat) => seat.country === RUSSIA)?.device, "device-guest", "its seat is let go in the game's order, after the round");
  // The engine is closed before the round lands: taken up again, the banned player's seat is let go first.
  const t = setup({ campaign, restored: sessionFromRecord(saved, { campaign, hostDevice: "device-host" }) });
  t.host.join(t.hostPlayer);
  await t.clock.flush();
  assert.equal(t.to(t.hostPlayer, "lobby").at(-1).seats.find((seat) => seat.country === RUSSIA)?.held, false);
  // And Stop writes the session once more, as it stands.
  const writes = s.store.shared.length;
  await s.host.stop();
  release();
  assert.ok(s.store.shared.length > writes);
  assert.equal(s.store.shared.at(-1).settings.replies, "own");
});

test("a change of country asked before a round that renames both countries follows them, and its player's own go with them", async () => {
  const SSR = "Estonian SSR";
  const s = setup({ countriesOf: gameCountries, roundWrites: (docs) => { renamed(docs, RUSSIA, EMPIRE); renamed(docs, ESTONIA, SSR); } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "pick", id: id(2), country: ESTONIA });
  await playRound(s, [s.hostPlayer, s.guest]);
  await s.request(s.guest, { t: "order", id: id(3), text: "A private plan of the guest's." });
  assert.deepEqual(s.to(s.hostPlayer, "lobby").at(-1).changes, [{ from: EMPIRE, to: SSR, name: "Guest" }]);
  assert.equal(await s.host.control.seat({ op: "allow", from: EMPIRE }), true);
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, SSR]);
  assert.ok(!s.store.docs.actions.some((action) => action.text === "A private plan of the guest's."), "the order they gave as the Empire went with them");
});

test("a player who releases part of their own land as a puppet keeps their seat and their army", async () => {
  const PSKOV = "Pskov Republic";
  const s = setup({
    countriesOf: gameCountries,
    roundWrites: (docs) => {
      docs.actions.push({ id: "order-ru-puppet", status: "resolved", ownerCode: RUSSIA, text: "Release Pskov as a puppet state" });
      docs.events.push(founding({ id: "ev-pskov", from: RUSSIA, to: PSKOV, order: "order-ru-puppet" }));
      docs.world.polityOverrides[PSKOV] = { code: PSKOV, name: PSKOV, status: "active" };
      docs.world.units = [{ id: "ru-army", name: "6th Army", type: "infantry", ownerCode: RUSSIA, strength: 90, lng: 28.3, lat: 57.8, status: "idle", source: "player" }];
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  assert.equal(s.store.docs.world.units[0].ownerCode, RUSSIA, "Russia's army stays Russia's");
  assert.equal(s.store.docs.game.seatFoundings, undefined);
  assert.ok(!s.to(s.guest, "notice").some((entry) => /you now play/.test(entry.text)));
});

test("a peace between rounds that annexes a played country lets its seat go at once: its player watches, and gives no more orders for it", async (t) => {
  const { setHostingSharedGame } = await import("../../runtime/humanPolities.js");
  setHostingSharedGame(true, { host: LATVIA });
  t.after(() => setHostingSharedGame(false));
  const s = setup({ world: mapWorld(), countriesOf: gameCountries });
  s.store.docs.world.wars = [{ id: "war-1", title: "The Baltic War", status: "active", sideA: [ESTONIA], sideB: [LATVIA], startedDate: "2014-03-01" }];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: ESTONIA });
  await s.host.control.start();
  // Estonia's player puts terms that hand all Estonia to Latvia; the host takes them.
  await s.request(s.guest, { t: "peace", id: id(2), op: "propose", ref: "war-1", to: LATVIA, terms: { territory: "as held", annexed: { country: ESTONIA } } });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  const offer = s.store.docs.world.peaceOffers.find((entry) => entry.status === "open");
  await s.request(s.hostPlayer, { t: "peace", id: id(3), op: "accept", ref: offer.id });
  assert.equal(s.ack(s.hostPlayer, id(3)).ok, true);
  assert.equal(s.store.docs.world.regionOwnershipOverrides["reg-ee"], LATVIA);
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA], "not at the next round's landing: now");
  assert.match(s.to(s.guest, "notice").at(-1).text, /Republic of Estonia is gone/);
  await s.request(s.guest, { t: "order", id: id(4), text: "Raise the Estonian militia." });
  assert.equal(s.ack(s.guest, id(4)).ok, false);
  assert.ok(!s.to(s.hostPlayer, "lobby").at(-1).countries.includes(ESTONIA), "the lobby no longer offers it");
});

// The seats followed in an entry of their own, queued after the one that wrote the peace: a request of the
// annexed country's player waiting between the two acted for a country with no land (FOLLOWUPS A2). The engine
// writes a table's decisions as an entry (engineMain.js decidedAndTold), and tells it what landed.
test("a peace a leader made in a table's answer that ends the writer's country lets its seat go in the same entry", async () => {
  const landing = { id: "landing-peace-treaty:war-2:2014-04-01", concerns: [ESTONIA, RUSSIA] };
  let s = null;
  s = setup({
    replyTo: async () => {
      await s.host.write("table-decided", async ({ told }) => {
        s.store.docs.world.polityOverrides[RUSSIA] = { ...s.store.docs.world.polityOverrides[RUSSIA], status: "dissolved" };
        // The annexed country's player gives an order while the decision is written: it waits behind this entry.
        void s.host.receive(s.guest, { t: "order", id: id(3), text: "Raise the militia." });
        told([landing]);
      });
      return { landed: [landing] };
    },
  });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [ESTONIA], text: "We give up." });
  await s.clock.flush();
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA]);
  assert.ok(s.to(s.guest, "notice").some((notice) => /Russian Federation is gone/.test(notice.text)));
  assert.equal(s.ack(s.guest, id(3)).ok, false, "the order waited behind the peace, and its seat had ended");
  assert.match(s.ack(s.guest, id(3)).error, /no longer play/);
  assert.ok(!s.store.docs.actions.some((action) => action.text === "Raise the militia."));
});

test("a request sent again after the game is shared again is answered as it was, and applied once", async () => {
  const campaign = "game-baltic";
  const s = setup({ campaign });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "say", id: id(2), thread: null, to: [LATVIA], text: "A letter to Riga." });
  const first = s.ack(s.guest, id(2));
  assert.equal(first.ok, true);
  await s.clock.flush();
  // The engine closes; the game is shared again, and the guest's page sends the letter again (it had no answer).
  const record = s.store.shared.at(-1);
  const t = setup({ campaign, restored: sessionFromRecord(record, { campaign, hostDevice: "device-host" }) });
  t.store.docs.chat = structuredClone(s.store.docs.chat);
  t.host.join(t.hostPlayer);
  t.host.join(t.guest);
  await t.clock.flush();
  await t.request(t.guest, { t: "say", id: id(2), thread: null, to: [LATVIA], text: "A letter to Riga." });
  assert.deepEqual(t.ack(t.guest, id(2)), first);
  assert.equal(t.store.docs.chat.flatMap((chat) => chat.messages ?? []).filter((line) => line.text === "A letter to Riga.").length, 1);
});

// FOLLOWUPS A4: the answer is saved with the session after the request's effect, apart from it. An engine closed in
// between had written the effect and not the answer, and the request sent again was applied twice.
test("a request whose effect was written just before the engine closed, its answer never saved, is applied once when sent again", async () => {
  const campaign = "game-baltic";
  const s = setup({ campaign });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.clock.flush();
  // The session as it was last saved: the engine closes after the order below is written, before its answer is saved.
  const saved = structuredClone(s.store.shared.at(-1));
  await s.request(s.guest, { t: "order", id: id(2), text: "Hold the line at Narva" });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.equal(s.shown(s.guest).game.sharedRequests, undefined, "no view carries the host's marks");
  assert.equal(s.shown(s.hostPlayer).game.sharedRequests, undefined);
  // Shared again from that session, over the documents as the engine left them.
  const t = setup({ campaign, restored: sessionFromRecord(saved, { campaign, hostDevice: "device-host" }) });
  Object.assign(t.store.docs, structuredClone(s.store.docs));
  t.host.join(t.hostPlayer);
  t.host.join(t.guest);
  await t.clock.flush();
  await t.request(t.guest, { t: "order", id: id(2), text: "Hold the line at Narva" });
  assert.equal(t.ack(t.guest, id(2)).ok, true, "answered as done");
  assert.equal(t.store.docs.actions.filter((action) => action.text === "Hold the line at Narva").length, 1, "applied once");
  // A request it never applied is applied as ever.
  await t.request(t.guest, { t: "order", id: id(4), text: "Raise the Pskov levies" });
  assert.equal(t.store.docs.actions.filter((action) => action.text === "Raise the Pskov levies").length, 1);
});

test("a founding the seats never followed (the engine closed after its round's turn was written) is followed when the game is taken up", async () => {
  const campaign = "game-baltic";
  const PSKOV = "Pskov Republic";
  // Saved as the round began: the seats had followed the world through round-1's event.
  const record = sessionRecordOf({
    campaign, started: true, round: 2, hostDevice: "device-host", followed: "round-1",
    seats: [{ country: RUSSIA, device: "device-guest", name: "Guest", status: "human" }],
  });
  const world = structuredClone(createStore().docs.world);
  world.polityOverrides[RUSSIA] = { ...world.polityOverrides[RUSSIA], status: "dissolved" };
  world.polityOverrides[PSKOV] = { code: PSKOV, name: PSKOV, status: "active" };
  const t = setup({ campaign, world, restored: sessionFromRecord(record, { campaign, hostDevice: "device-host" }) });
  // What the round wrote before the engine closed: Russia's own order founded the Pskov Republic, and Russia ended.
  t.store.docs.events.push({ id: "round-1", title: "An old round" }, founding({ id: "ev-pskov", from: RUSSIA, to: PSKOV, order: "order-ru-found" }));
  t.store.docs.actions.push({ id: "order-ru-found", status: "resolved", ownerCode: RUSSIA, text: "Found the Pskov Republic" });
  t.host.join(t.hostPlayer);
  await t.clock.flush();
  assert.deepEqual(t.to(t.hostPlayer, "lobby").at(-1).seats.map((seat) => [seat.country, seat.status]), [[LATVIA, "human"], [PSKOV, "away"]]);
  assert.deepEqual(t.store.docs.game.seatFoundings, [{ from: RUSSIA, to: PSKOV }]);
  assert.equal(t.store.shared.at(-1).followed, "ev-pskov");
});

test("the host whose country is gone may take a free one, and plays it from then on; what was the old country's stays its own", async () => {
  const moved = [];
  const s = setup({
    countriesOf: gameCountries,
    onSeatsMoved: (moves) => moved.push(...moves),
    // Latvia is annexed whole, its record dissolved (runtime/gameState.js dissolvePolity).
    roundWrites: (docs) => {
      docs.world.polityOverrides[LATVIA] = { ...docs.world.polityOverrides[LATVIA], status: "dissolved" };
    },
  });
  // The host's own records, named by nobody: an order queued, a thread, a programme on its board.
  s.store.docs.world.projects = [{ id: "proj-lv", name: "Riga Metro", status: "active", progress: 10 }];
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await playRound(s, [s.hostPlayer, s.guest]);
  assert.match(s.to(s.hostPlayer, "notice").at(-1).text, /Republic of Latvia is gone\. You can take any free country/);
  assert.deepEqual(s.to(s.hostPlayer, "lobby").at(-1).seats.find((seat) => seat.you)?.status, "watching");
  await s.request(s.hostPlayer, { t: "pick", id: id(2), country: ESTONIA });
  assert.equal(s.ack(s.hostPlayer, id(2)).ok, true);
  assert.equal(s.store.docs.game.country, ESTONIA);
  assert.deepEqual(moved, [{ from: LATVIA, to: ESTONIA, host: true }]);
  assert.deepEqual(s.store.docs.game.humanCountries, [RUSSIA, ESTONIA]);
  // Latvia's order is not Estonia's: it went with Latvia, which nobody can carry it out for (FOLLOWUPS A3).
  assert.ok(!s.store.docs.actions.some((action) => action.id === "order-lv"), "Latvia's order is not Estonia's");
  assert.equal(s.store.docs.chat.find((chat) => chat.id === "chat-lv-est").player, LATVIA, "nor its thread");
  assert.deepEqual(s.store.docs.world.projects, [], "nor its programme");
  assert.equal(s.store.docs.world.seatBoards[LATVIA][0].id, "proj-lv");
  assert.equal(s.shown(s.hostPlayer).game.country, ESTONIA);
  assert.ok(!s.shown(s.hostPlayer).actions.some((action) => action.id === "order-lv"));
  // A host whose country stands still plays its own.
  await s.request(s.hostPlayer, { t: "pick", id: id(3), country: LATVIA });
  assert.equal(s.ack(s.hostPlayer, id(3)).error, "The host plays its own game's country.");
});

// "Start the game does nothing" (the owner, 2026-11-18, two guests in): Start is an entry of the host's queue, and a
// reading the engine made by itself had its write's entry held open (engineMain.js setReadingsOrder) and never let
// go. Start waited behind it for good, and the host was told nothing. The reading here is in flight when Start is
// pressed, as on the owner's computer (the two-browser run presses Start before any reading is made).
test("Start pressed while a reading's write is held open is said on the host's screen, and the game starts", async () => {
  const busy = [];
  const s = setup({ onBusy: (entry) => busy.push(entry) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  // The engine's reading: its write entered, never ended.
  void s.host.write("reading:stat-sheet", () => new Promise(() => {}));
  const starting = s.host.control.start();
  await s.clock.flush();
  assert.equal(s.to(s.guest, "lobby").at(-1).started, false, "behind the reading");
  await s.clock.advance(SLOW_MS);
  assert.equal(busy.at(-1)?.label, "reading:stat-sheet", "the host is told what it waits for");
  assert.equal(busy.at(-1)?.gaveUp, false);
  await s.clock.advance(GIVE_UP_MS);
  await starting;
  await s.clock.flush();
  assert.equal(busy.some((entry) => entry?.gaveUp === true), true);
  assert.equal(s.to(s.guest, "lobby").at(-1).started, true, "the game started");
  assert.deepEqual(s.store.docs.game.humanCountries, [LATVIA, RUSSIA]);
  assert.equal(busy.at(-1), null, "and the host's screen is told the queue moves again");
});
