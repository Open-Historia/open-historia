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
      resolved.push({ ...info, game: structuredClone(store.docs.game) });
      store.docs.events.push({ id: `round-${info.round}`, title: "The round's events", description: "", date: "2014-05-01" });
    },
    replyTo: async (info) => {
      replies.push(info);
    },
    readCountry: async (info) => {
      sheets.push(info);
      if (info.country === ESTONIA && options.sheetFails) throw new Error("The model did not answer.");
      store.docs.world = { ...store.docs.world, countryStats: { ...store.docs.world.countryStats, [info.country]: { capital: "A capital", stability: 50 } } };
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
