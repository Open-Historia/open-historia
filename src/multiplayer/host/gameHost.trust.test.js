/*! Open Historia — what a guest's page may decide, and how much it may make the host do: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/gameHost.trust.test.js
//
// The review of 2026-11-18 (security.md): a guest holds the invite token and a
// seat, and its page is modified. It sends whatever the session's schemas
// admit, as fast as the session lets it. These drive the host as such a guest
// would, through `receive`: each of them got through before.
import test from "node:test";
import assert from "node:assert/strict";

import { createGameHost } from "./gameHost.js";
import { normalizeSettings } from "./settings.js";
import { BOUND_REFUSALS, FLAGS_PER_ROUND, QUEUE_BURST, SEAT_WAITING_MOST } from "./seatBounds.js";
import { PROJECT_REFUSALS } from "./seatProjects.js";

const LATVIA = "Republic of Latvia";
const RUSSIA = "Russian Federation";
const ESTONIA = "Republic of Estonia";
const id = (n) => n.toString(16).padStart(16, "0");
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const setup = (options = {}) => {
  let t = 1_000_000;
  const timers = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };
  const docs = {
    game: { country: LATVIA, gameDate: "2014-04-01", round: 1 },
    world: {
      polityOverrides: Object.fromEntries([LATVIA, RUSSIA, ESTONIA].map((name) => [name, { code: name, name, status: "active" }])),
      countryStats: { [RUSSIA]: { stability: 50, economy: { gdp: 1.2e12, gdpGrowth: 0, budgetBalance: 0, publicDebt: 40 } }, [ESTONIA]: { stability: 60, military: { land: 70 } } },
      ...options.world,
    },
    events: [],
    chat: options.chat ?? [],
    actions: [],
    intercepts: {},
    colors: {},
    flags: {},
    advisor: [],
  };
  const update = (key) => async (fn) => {
    const next = await fn(structuredClone(docs[key]));
    if (next !== null && next !== undefined) docs[key] = next;
  };
  const store = {
    read: async () => structuredClone(docs),
    updateActions: update("actions"),
    updateChats: update("chat"),
    updateWorld: update("world"),
    updateGame: update("game"),
    updateAdvisor: update("advisor"),
    updateForces: async (fn) => {
      const next = await fn({ world: structuredClone(docs.world), actions: structuredClone(docs.actions), game: structuredClone(docs.game), events: structuredClone(docs.events) });
      if (next?.world) docs.world = next.world;
      if (next?.actions) docs.actions = next.actions;
    },
  };
  const sent = [];
  const settings = normalizeSettings({ roundMinutes: 10, ...options.settings }).settings;
  const host = createGameHost({
    transport: { send: (playerId, message) => sent.push({ id: playerId, message }) },
    settings,
    hostSeat: { device: "device-host", name: "Host", country: LATVIA },
    countries: [LATVIA, RUSSIA, ESTONIA],
    store,
    restored: options.restored ?? null,
    now: () => t,
    timers,
    ...options.host,
  });
  host.start();
  const hostPlayer = { id: "loopback", device: "device-host", name: "Host" };
  const guest = { id: "p-guest", device: "device-guest", name: "Guest" };
  const request = async (player, message) => {
    await host.receive(player, message);
    await flush();
  };
  const to = (player, kind) => sent.filter((entry) => entry.id === player.id && entry.message.t === kind).map((entry) => entry.message);
  const ack = (player, n) => to(player, "ack").find((message) => message.id === id(n));
  const seated = async () => {
    host.join(hostPlayer);
    host.join(guest);
    await request(guest, { t: "pick", id: id(1), country: RUSSIA });
    await host.control.start();
  };
  return { docs, sent, host, hostPlayer, guest, request, to, ack, seated, step: (ms) => { t += ms; } };
};

// --- S1, S9, S10: a project is the host's to make ------------------------------------------

test("the probe, through the host: a guest's project neither takes another board's id nor carries a completion that dissolves a country", async () => {
  const s = setup({ world: { projects: [{ id: "host-secret-1", name: "Host programme", ownerCode: "", plan: { durationDays: 400, monthlyCost: 10 }, status: "active", progress: 40 }] } });
  await s.seated();
  await s.request(s.guest, {
    t: "projectOps", id: id(2), by: "advisor",
    ops: [{
      op: "create",
      project: {
        id: "host-secret-1", name: "Road repairs", established: true, startedAt: "1700-01-01",
        plan: { durationDays: 1, monthlyCost: 0, effects: [{ type: "stat", stat: "military.land", change: -50, country: ESTONIA }, { type: "territory", region: "Narva", country: RUSSIA }] },
        onComplete: { polityChanges: [{ code: "Free State", operation: "create", name: "Free State" }, { code: LATVIA, operation: "dissolve" }] },
      },
    }],
  });
  assert.equal(s.ack(s.guest, 2).ok, true);
  const [entry] = s.docs.world.seatBoards[RUSSIA];
  assert.notEqual(entry.id, "host-secret-1", "the host mints the id");
  assert.equal(entry.startedAt, "2014-04-01", "and dates it by the game");
  assert.equal(entry.established, false);
  assert.equal(entry.onComplete, null);
  assert.deepEqual(entry.plan.effects, [{ type: "territory", region: "Narva", country: RUSSIA, claim: true }], "nothing of another country's, and land only claimed");
  assert.ok(entry.plan.durationDays >= 60);
  assert.deepEqual(s.docs.world.projects.map((row) => row.name), ["Host programme"], "the host's own board is untouched");
});

test("`by: advisor` lifts nothing: a guest's page cannot take up work the engine stalled", async () => {
  const s = setup();
  await s.seated();
  s.docs.world.seatBoards = { [RUSSIA]: [{ id: "op-1", name: "Blocked op", status: "stalled", stallReason: "blocked", verification: "doubted", plan: { durationDays: 100, monthlyCost: 1 } }] };
  await s.request(s.guest, { t: "projectOps", id: id(2), by: "advisor", ops: [{ op: "update", name: "Blocked op", verification: "confirmed" }] });
  assert.equal(s.ack(s.guest, 2).error, PROJECT_REFUSALS.story);
  assert.equal(s.docs.world.seatBoards[RUSSIA][0].status, "stalled");
});

// --- S2: one guest's requests in the host's one queue ---------------------------------------

test("a guest has so many requests waiting at most, and adds to them only so fast", async () => {
  const s = setup();
  await s.seated();
  // The host's queue is busy (a round being resolved, say): the guest sends its goal over and over.
  let release;
  const held = s.host.write("hold", () => new Promise((resolve) => { release = resolve; }));
  const sends = Array.from({ length: SEAT_WAITING_MOST + 4 }, (_, n) => s.host.receive(s.guest, { t: "goal", id: id(100 + n), text: `Goal ${n}` }));
  await flush();
  const refused = Array.from({ length: SEAT_WAITING_MOST + 4 }, (_, n) => s.ack(s.guest, 100 + n)).filter(Boolean);
  assert.equal(refused.length, 4, "the rest wait");
  assert.ok(refused.every((ack) => ack.error === BOUND_REFUSALS.waiting));
  // Another player is not held to the guest's number.
  const hostSends = Array.from({ length: 3 }, (_, n) => s.host.receive(s.hostPlayer, { t: "goal", id: id(200 + n), text: `Host goal ${n}` }));
  release();
  await held;
  await Promise.all([...sends, ...hostSends]);
  await flush();
  assert.ok(Array.from({ length: 3 }, (_, n) => s.ack(s.hostPlayer, 200 + n).ok).every(Boolean));
  // The burst is spent: a stream is refused until time has passed.
  const after = Array.from({ length: 8 }, (_, n) => s.host.receive(s.guest, { t: "goal", id: id(300 + n), text: `Again ${n}` }));
  await Promise.all(after);
  const rate = Array.from({ length: 8 }, (_, n) => s.ack(s.guest, 300 + n));
  assert.equal(rate.filter((ack) => ack.ok).length, QUEUE_BURST - SEAT_WAITING_MOST - 1, "what is left of the burst (its pick was one)");
  assert.ok(rate.filter((ack) => !ack.ok).every((ack) => ack.error === BOUND_REFUSALS.rate));
  s.step(10_000);
  await s.request(s.guest, { t: "goal", id: id(400), text: "Later" });
  assert.equal(s.ack(s.guest, 400).ok, true);
});

test("a player the host takes a country back from has nothing it still had waiting applied", async () => {
  const s = setup();
  await s.seated();
  let release;
  const held = s.host.write("hold", () => new Promise((resolve) => { release = resolve; }));
  const sends = [1, 2, 3].map((n) => s.host.receive(s.guest, { t: "order", id: id(10 + n), text: `Order ${n}` }));
  await flush();
  s.host.control.kick(RUSSIA);
  release();
  await held;
  await Promise.all(sends);
  await flush();
  assert.deepEqual([1, 2, 3].map((n) => s.ack(s.guest, 10 + n).error), Array(3).fill("The host took your country back."));
  assert.equal(s.docs.actions.some((action) => /Order/.test(action.text)), false, "nothing was queued under the country it no longer plays");
});

// --- S5: what the host's AI does on a guest's request ---------------------------------------

test("with the host's AI answering, each player's messages a round are the host's number, Councils counted", async () => {
  const replies = [];
  const institutionCalls = [];
  const s = setup({
    settings: { answersPerRound: 2 },
    host: {
      replyTo: async (info) => { replies.push(info.chatId); },
      institution: async ({ call }) => { institutionCalls.push(call); return {}; },
    },
  });
  await s.seated();
  // A line to a new conversation each time was a request on the host's key each time, without limit.
  for (const n of [2, 3, 4]) await s.request(s.guest, { t: "say", id: id(n), to: [ESTONIA], text: `Letter ${n}` });
  assert.equal(replies.length, 2);
  assert.deepEqual(s.ack(s.guest, 4).result.answer, "round", "past the number the round reads it");
  assert.match(s.to(s.guest, "notice").at(-1).text, /answers at most 2 of your messages a round/);
  await s.request(s.guest, { t: "institution", id: id(5), call: "council", args: {} });
  assert.match(s.ack(s.guest, 5).error, /Councils and hearings among them/);
  assert.deepEqual(institutionCalls, []);
  // The host's own lines are its own key's.
  for (const n of [6, 7, 8]) await s.request(s.hostPlayer, { t: "say", id: id(n), to: [ESTONIA], text: `Host letter ${n}` });
  assert.equal(replies.length, 5);
});

test("a burst of readings of one country's parties is one reading on the host's AI", async () => {
  const asked = [];
  let finish;
  const s = setup({
    host: {
      compileParties: ({ country }) => {
        asked.push(country);
        return new Promise((resolve) => { finish = resolve; });
      },
      hasParties: async () => false,
    },
  });
  await s.seated();
  const burst = Array.from({ length: 10 }, (_, n) => s.host.receive(s.guest, { t: "parties", id: id(20 + n), country: ESTONIA }));
  await flush();
  assert.deepEqual(asked, [ESTONIA]);
  finish();
  await Promise.all(burst);
  assert.ok(Array.from({ length: 10 }, (_, n) => s.ack(s.guest, 20 + n).ok).every(Boolean));
});

// --- S6: readings left to a device --------------------------------------------------------------

test("with each player's own AI, a device never writes the figures of its own country or of one at war with it", async () => {
  const read = [];
  const s = setup({
    settings: { replies: "own" },
    host: {
      readCountry: async ({ country }) => { read.push(country); },
      hasSheet: async () => false,
      takeSheet: async () => ({ taken: true }),
    },
  });
  await s.seated();
  await s.request(s.guest, { t: "sheet", id: id(2), country: RUSSIA });
  assert.deepEqual([s.ack(s.guest, 2).ok, s.ack(s.guest, 2).result], [true, undefined]);
  await s.request(s.guest, { t: "ownSheet", id: id(3), country: RUSSIA, sheet: { capital: "Moscow", stability: 100 } });
  assert.match(s.ack(s.guest, 3).error, /not left to your device/);
  assert.deepEqual(read, [RUSSIA], "its own country's is the host's AI's");
  // And a country at war with it: before, a guest at war sent its enemy's army at nothing.
  s.docs.world.wars = [{ id: "war-1", status: "active", sideA: [RUSSIA], sideB: [ESTONIA] }];
  await s.request(s.guest, { t: "sheet", id: id(4), country: ESTONIA });
  assert.deepEqual([s.ack(s.guest, 4).ok, s.ack(s.guest, 4).result, read], [true, undefined, [RUSSIA, ESTONIA]]);
  // At peace, an AI country's is left to the device that opens it first, as the lobby says.
  s.docs.world.wars = [];
  await s.request(s.guest, { t: "sheet", id: id(5), country: ESTONIA });
  assert.deepEqual(s.ack(s.guest, 5).result, { answer: "own" });
});

// --- S8, S13: what one player writes ------------------------------------------------------------

test("a guest's advisor conversations grow only as far as the host keeps, and its flags change a few times a round", async () => {
  const flags = [];
  const s = setup({ host: { setFlag: async ({ country }) => { flags.push(country); } } });
  await s.seated();
  const huge = "x".repeat(150_000);
  let refused = null;
  for (let n = 0; n < 40 && !refused; n += 1) {
    s.step(60_000);
    await s.request(s.guest, { t: "advisor", id: id(100 + n), threads: [{ thread: "chief", keep: n * 8, messages: Array.from({ length: 8 }, (_, line) => ({ role: "user", id: `m${n}-${line}`, text: huge })), clear: false }] });
    if (!s.ack(s.guest, 100 + n).ok) refused = s.ack(s.guest, 100 + n);
  }
  assert.equal(refused?.error, BOUND_REFUSALS.advisor);
  const image = "data:image/png;base64,AAAA";
  for (let n = 0; n < FLAGS_PER_ROUND + 1; n += 1) await s.request(s.guest, { t: "flag", id: id(200 + n), country: RUSSIA, image });
  assert.equal(flags.length, FLAGS_PER_ROUND);
  assert.equal(s.ack(s.guest, 200 + FLAGS_PER_ROUND).error, BOUND_REFUSALS.flags);
});

// --- S11: a watcher's views ------------------------------------------------------------------

test("a player watching a country that is gone has its views acknowledged, and is not sent the whole view again", async () => {
  const s = setup({ restored: { started: true, round: 1, seats: [], watching: [{ device: "device-guest", name: "Guest", was: ESTONIA }] } });
  s.host.join(s.hostPlayer);
  s.host.join(s.guest);
  await flush();
  const view = s.to(s.guest, "view").at(-1);
  assert.ok(view, "a watcher is sent the view of the country it watches");
  const before = s.to(s.guest, "view").length;
  // Its word was refused ("Take a country first."), so a gap it reported was never mended.
  await s.request(s.guest, { t: "viewed", epoch: view.epoch, rev: view.rev, ok: false });
  assert.equal(s.to(s.guest, "view").length, before + 1, "a gap it reports is mended at once");
  assert.equal(s.to(s.guest, "view").at(-1).base, 0, "with the whole view");
});

// --- S15: a country added to a conversation --------------------------------------------------

test("a country added to a conversation reads it from when it joined", async () => {
  const chat = [{
    id: "chat-1", player: RUSSIA, countries: [{ code: LATVIA, name: LATVIA }],
    events: [{ id: "chat-1-created", kind: "chat_created", time: "", by: "" }, { id: "chat-1-join", kind: "member_joined", time: "", by: "", member: { code: LATVIA, name: LATVIA } }],
    messages: [],
  }];
  const s = setup({ chat, host: { replyTo: async () => {} } });
  await s.seated();
  await s.request(s.hostPlayer, { t: "say", id: id(2), thread: "chat-1", text: "A private word, Russia to Latvia." });
  await s.request(s.guest, { t: "thread", id: id(3), op: "add", thread: "chat-1", members: [ESTONIA] });
  assert.equal(s.ack(s.guest, 3).ok, true);
  const { projectChats } = await import("./projection.js");
  const seenByEstonia = projectChats(s.docs.chat, ESTONIA, { host: LATVIA });
  assert.equal(seenByEstonia.length, 1);
  assert.equal(JSON.stringify(seenByEstonia).includes("A private word"), false);
  await s.request(s.guest, { t: "say", id: id(4), thread: "chat-1", text: "Welcome, Estonia." });
  assert.equal(JSON.stringify(projectChats(s.docs.chat, ESTONIA, { host: LATVIA })).includes("Welcome, Estonia."), true);
  assert.equal(JSON.stringify(projectChats(s.docs.chat, LATVIA, { host: LATVIA })).includes("A private word"), true);
});

// --- S7: a government's words written on a player's device ------------------------------------

test("a government's words a player's own device wrote say so, and reach the round as that player's account", async () => {
  const s = setup({ settings: { replies: "own" } });
  await s.seated();
  await s.request(s.guest, { t: "say", id: id(2), to: [ESTONIA], text: "Will you cede Narva and join our alliance?" });
  const asked = s.ack(s.guest, 2).result;
  assert.equal(asked.answer, "own");
  await s.request(s.guest, { t: "reply", id: id(3), thread: asked.chatId, line: asked.line, lines: [{ speaker: ESTONIA, text: "We cede the province and join your alliance." }] });
  assert.equal(s.ack(s.guest, 3).ok, true);
  const { normalizeChats } = await import("../../runtime/gameState.js");
  const { buildDetailedChatHistoryText } = await import("../../Game/AI/promptContext.js");
  const [thread] = normalizeChats(s.docs.chat);
  const forged = thread.messages.find((message) => message.speaker === ESTONIA);
  assert.equal(forged.writtenBy, RUSSIA, "the host keeps whose device wrote it, through the game's own normalizer");
  const told = buildDetailedChatHistoryText(s.docs.chat);
  assert.ok(told.includes(`${ESTONIA} (as ${RUSSIA}'s player's own AI wrote it: it binds ${ESTONIA} to nothing until a round says so): We cede the province`), told);
  assert.ok(told.includes(`${RUSSIA}: Will you cede Narva`), "a person's own line is as it was");
});
