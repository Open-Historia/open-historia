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

import { createGameHost, MAX_ORDERS_PER_ROUND, MAX_SHEETS_PER_ROUND } from "./gameHost.js";
import { normalizeSettings } from "./settings.js";
import { chosenOrdersOf, generalsOf, talkOf } from "../../runtime/fronts/command.js";
import { keptPlansOf } from "../../runtime/fronts/plans.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../runtime/fronts/testKit.js";

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
    // The world and the queue together, as one commit.
    updateForces: async (fn) => {
      const next = await fn({ world: structuredClone(docs.world), actions: structuredClone(docs.actions), game: structuredClone(docs.game) });
      if (!next) return;
      if (next.world) docs.world = next.world;
      if (next.actions) docs.actions = next.actions;
    },
  };
};

const setup = (options = {}) => {
  const clock = createClock();
  const store = createStore();
  const sent = [];
  const resolved = [];
  const replies = [];
  const sheets = [];
  const settings = normalizeSettings({ roundMinutes: 10, countdownSeconds: 30, leaverGraceMinutes: 1, ...options.settings }).settings;
  const host = createGameHost({
    transport: { send: (id, message) => sent.push({ id, message }) },
    settings,
    hostSeat: { device: "device-host", name: "Host", country: LATVIA },
    scenario: { id: "fault-lines", name: "Fault Lines", hash: "abc" },
    countries: [LATVIA, RUSSIA, ESTONIA],
    store,
    resolveRound: async (info) => {
      // A round held in "resolving" until the test lets it go.
      if (options.holdResolve) await options.holdResolve;
      resolved.push({ ...info, game: structuredClone(store.docs.game) });
      store.docs.events.push({ id: `round-${info.round}`, title: "The round's events", description: "", date: "2014-05-01" });
      // What else the round wrote into the game.
      options.roundWrites?.(store.docs, info);
    },
    replyTo: async (info) => {
      replies.push(info);
    },
    readCountry: async (info) => {
      sheets.push(info);
      if (info.country === ESTONIA && options.sheetFails) throw new Error("The model did not answer.");
      store.docs.world = { ...store.docs.world, countryStats: { ...store.docs.world.countryStats, [info.country]: { capital: "A capital", stability: 50 } } };
    },
    ...(options.readChart ? { readChart: options.readChart } : {}),
    ...(options.institution ? { institution: options.institution } : {}),
    ...(options.onSeatsMoved ? { onSeatsMoved: options.onSeatsMoved } : {}),
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
  return { clock, store, sent, resolved, replies, sheets, host, hostPlayer, guest, request, to, ack, shown };
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

test("each player keeps a Projects board of its own: the host's is the game's, another person's is kept beside it", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  const names = (projects) => (projects ?? []).map((project) => project.name);

  // The guest's advisor put a project on its board; what is not a project is dropped.
  await s.request(s.guest, { t: "board", id: id(2), projects: [{ name: "Northern Fleet refit", status: "active", summary: "Dry docks at Severodvinsk." }, { nonsense: true }, "text"] });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual(Object.keys(s.store.docs.world.seatBoards), [RUSSIA]);
  assert.deepEqual(names(s.store.docs.world.seatBoards[RUSSIA]), ["Northern Fleet refit"]);
  assert.deepEqual(names(s.store.docs.world.projects), [], "the game's own board is the host's, untouched");
  assert.deepEqual(names(s.shown(s.guest).world.projects), ["Northern Fleet refit"]);
  assert.deepEqual(names(s.shown(s.hostPlayer).world.projects), []);
  assert.equal(JSON.stringify(s.shown(s.hostPlayer)).includes("Northern Fleet"), false, "nothing of it reaches the host's view");

  // The host's own board is the game's, as in single player.
  await s.request(s.hostPlayer, { t: "board", id: id(3), projects: [{ name: "Riga port expansion" }] });
  assert.deepEqual(names(s.store.docs.world.projects), ["Riga port expansion"]);
  assert.deepEqual(names(s.shown(s.hostPlayer).world.projects), ["Riga port expansion"]);
  assert.deepEqual(names(s.shown(s.guest).world.projects), ["Northern Fleet refit"]);
  assert.equal(JSON.stringify(s.shown(s.guest)).includes("Riga port"), false);

  // A board is a list; an emptied one is kept as nothing.
  await s.request(s.guest, { t: "board", id: id(4), projects: { name: "not a list" } });
  assert.match(s.ack(s.guest, id(4)).error, /list of projects/);
  await s.request(s.guest, { t: "board", id: id(5), projects: [] });
  assert.deepEqual(s.store.docs.world.seatBoards, {});
  assert.deepEqual(names(s.shown(s.guest).world.projects), []);
});

test("a player's forces: raised and stood down by the host, for the player who asked, and undone with the order", async () => {
  const s = setup();
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  const brigade = { type: "armor", strength: 80, name: "4th Guards", composition: "T-90 tanks", lng: 28.3, lat: 57.8 };
  await s.request(s.guest, { t: "deploy", id: id(2), ...brigade });
  assert.match(s.ack(s.guest, id(2)).error, /while a round is being planned/);
  await s.host.control.start();

  await s.request(s.guest, { t: "deploy", id: id(3), ...brigade });
  assert.equal(s.ack(s.guest, id(3)).ok, true);
  const raised = s.store.docs.world.units.at(-1);
  assert.deepEqual([raised.ownerCode, raised.status, raised.source, raised.type], [RUSSIA, "pending", "player", "armor"]);
  const request = s.store.docs.actions.find((action) => action.unitRevert?.unitId === raised.id);
  assert.equal(request.ownerCode, RUSSIA);
  // Both players see the formation on the map; only its owner sees the request.
  assert.ok(s.shown(s.hostPlayer).world.units.some((unit) => unit.id === raised.id));
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

test("a stat sheet is written by the host when a player's Stats pane has none, a few a round, and reaches everyone", async () => {
  const s = setup({ sheetFails: true });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.guest, { t: "sheet", id: id(2), country: RUSSIA, fresh: false });
  assert.equal(s.ack(s.guest, id(2)).ok, true);
  assert.deepEqual(s.sheets, [{ country: RUSSIA, fresh: false, seat: RUSSIA }]);
  assert.equal(s.shown(s.guest).world.countryStats[RUSSIA].capital, "A capital");
  assert.equal(s.shown(s.hostPlayer).world.countryStats[RUSSIA].capital, "A capital", "a sheet is public");
  // The host's reason for failing is the player's answer.
  await s.request(s.guest, { t: "sheet", id: id(3), country: ESTONIA, fresh: true });
  assert.equal(s.ack(s.guest, id(3)).error, "The model did not answer.");
  // Each is a request on the host's key: a player has a few a round.
  for (let n = 0; n < MAX_SHEETS_PER_ROUND; n += 1) await s.request(s.guest, { t: "sheet", id: id(10 + n), country: LATVIA, fresh: false });
  assert.match(s.ack(s.guest, id(10 + MAX_SHEETS_PER_ROUND - 1)).error, /stat sheets a round/);
  // The other player's count is its own.
  await s.request(s.hostPlayer, { t: "sheet", id: id(40), country: LATVIA, fresh: false });
  assert.equal(s.ack(s.hostPlayer, id(40)).ok, true);
});

test("a structure the map placed approximately is settled by the player it belongs to, and by nobody else", async () => {
  const s = setup();
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

  // Its owner moves it: it stands at the point, the mark is gone, and everyone's map shows it there.
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
      // The host's order (no owner) and the guest's both found a country.
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
    },
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
  // And the line is there for all to see.
  assert.equal(s.shown(s.hostPlayer).world.fortifications.length, 1);

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

test("orders given while a round's events are read are the next round's; while it is resolved, the player is told why not", async () => {
  // A player gave three orders as the round's events came in, was refused
  // ("Orders are taken while a round is being planned"), and gave them again.
  let release;
  const s = setup({ holdResolve: new Promise((resolve) => { release = resolve; }) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  await s.request(s.guest, { t: "order", id: id(4), text: "Send missiles to Abkhazia" });
  assert.match(s.ack(s.guest, id(4)).error, /being resolved/);
  release();
  await s.clock.flush();
  assert.equal(s.to(s.guest, "round").at(-1).phase, "revealing");
  await s.request(s.guest, { t: "order", id: id(5), text: "Send missiles to Abkhazia" });
  assert.equal(s.ack(s.guest, id(5)).ok, true);
  const queued = s.store.docs.actions.find((action) => action.text === "Send missiles to Abkhazia");
  assert.equal(queued.ownerCode, RUSSIA);
  assert.equal(queued.status, "planned");
  // And taken back, while the events are still read.
  await s.request(s.guest, { t: "unorder", id: id(6), order: queued.id });
  assert.equal(s.ack(s.guest, id(6)).ok, true);
});

test("while a round is resolved, letters to the AI's governments and goals wait; people still write to each other, every line dated by the game", async () => {
  let release;
  const s = setup({ holdResolve: new Promise((resolve) => { release = resolve; }) });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await s.request(s.guest, { t: "pick", id: id(1), country: RUSSIA });
  await s.host.control.start();
  await s.request(s.hostPlayer, { t: "ready", id: id(2), value: true });
  await s.request(s.guest, { t: "ready", id: id(3), value: true });
  assert.equal(s.to(s.guest, "round").at(-1).phase, "resolving");
  // Estonia is the AI's: a new thread, and the AI's thread the host owns.
  await s.request(s.guest, { t: "say", id: id(4), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  assert.match(s.ack(s.guest, id(4)).error, /being resolved/);
  await s.request(s.hostPlayer, { t: "say", id: id(5), thread: "chat-lv-est", to: [], text: "Riga again." });
  assert.match(s.ack(s.hostPlayer, id(5)).error, /being resolved/);
  await s.request(s.guest, { t: "goal", id: id(6), text: "Take Narva" });
  assert.match(s.ack(s.guest, id(6)).error, /being resolved/);
  // Latvia is the host's: people write to each other at any time.
  await s.request(s.guest, { t: "say", id: id(7), thread: null, to: [LATVIA], text: "Moscow to Riga." });
  assert.equal(s.ack(s.guest, id(7)).ok, true);
  const thread = s.store.docs.chat.find((chat) => chat.player === RUSSIA);
  assert.equal(thread.messages[0].time, "2014-04-01");
  release();
  await s.clock.flush();
  await s.request(s.guest, { t: "say", id: id(8), thread: null, to: [ESTONIA], text: "Moscow to Tallinn." });
  assert.equal(s.ack(s.guest, id(8)).ok, true);
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
  assert.equal(asked.at(-1).seat, RUSSIA, "the seat's country, never one the request names");
  // The host's own screen asks the same way, for the host's country.
  await s.request(s.hostPlayer, { t: "institution", id: id(4), call: "channel", args: { institutionId: "baltic-pact" } });
  assert.equal(asked.at(-1).seat, LATVIA);
  // A refusal is said in the desk's own words.
  await s.request(s.guest, { t: "institution", id: id(5), call: "lifecycle", args: { command: { type: "seize" } } });
  assert.match(s.ack(s.guest, id(5)).error, /not something a player can do/);
  assert.equal(s.ack(s.guest, id(5)).result, undefined);
});
