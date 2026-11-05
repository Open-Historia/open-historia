/*! Open Historia — Discord Rich Presence: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/discordPresence.test.js
//
// Against a stand-in for the Discord app: a real local socket (a named pipe on
// Windows) that answers the handshake and records what the game sends.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DISCORD_APPLICATION_ID,
  MIN_UPDATE_MS,
  OP_CLOSE,
  OP_FRAME,
  OP_HANDSHAKE,
  PRESENCE_BUTTON,
  PRESENCE_IMAGE,
  PRESENCE_STALE_MS,
  RETRY_MS,
  activityFor,
  createDiscordPresence,
  createFrameReader,
  discordIpcPaths,
  encodeFrame,
  normalizePresence,
} from "./discordPresence.js";

const socketPath = () => (process.platform === "win32"
  ? `\\\\?\\pipe\\oh-test-discord-${crypto.randomUUID()}`
  : path.join(os.tmpdir(), `oh-test-discord-${crypto.randomUUID()}.sock`));

// A Discord that knows one application id. `activities` collects every
// SET_ACTIVITY; `connections` the sockets it has accepted.
const fakeDiscord = async ({ clientId = "123", refuse = false } = {}) => {
  const where = socketPath();
  const activities = [];
  const connections = [];
  const handshakes = [];
  const waiters = [];
  const notify = () => { for (const w of waiters.splice(0)) w(); };
  const server = net.createServer((socket) => {
    connections.push(socket);
    socket.on("error", () => {});
    socket.on("data", createFrameReader((op, payload) => {
      if (op === OP_HANDSHAKE) {
        handshakes.push(payload);
        if (refuse || payload?.client_id !== clientId) {
          socket.write(encodeFrame(OP_CLOSE, { code: 4000, message: "Invalid Client ID" }));
          socket.end();
        } else {
          socket.write(encodeFrame(OP_FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
        }
        notify();
        return;
      }
      if (op === OP_FRAME && payload?.cmd === "SET_ACTIVITY") {
        activities.push(payload.args);
        socket.write(encodeFrame(OP_FRAME, { cmd: "SET_ACTIVITY", evt: null, nonce: payload.nonce, data: payload.args.activity }));
        notify();
      }
    }));
  });
  await new Promise((resolve) => server.listen(where, resolve));
  const until = async (check, what) => {
    const deadline = Date.now() + 3000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => { waiters.push(resolve); setTimeout(resolve, 50); });
    }
  };
  return {
    path: where,
    activities,
    connections,
    handshakes,
    until,
    close: () => new Promise((resolve) => {
      for (const socket of connections) socket.destroy();
      server.close(() => resolve());
    }),
  };
};

// Timers the test runs by hand, on a clock it sets.
const manualClock = () => {
  let t = 1_000_000;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    advance: (ms) => {
      t += ms;
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= t && timers.has(id)) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pending: () => [...timers.values()].map((timer) => timer.at - t),
  };
};

const game = { scene: "game", player: "France", scenario: "Modern Day", date: "1 January 2016" };

test("frames survive being split and joined", () => {
  const got = [];
  const read = createFrameReader((op, payload) => got.push([op, payload]));
  const joined = Buffer.concat([encodeFrame(1, { a: "é" }), encodeFrame(3, { b: 2 })]);
  read(joined.subarray(0, 5));
  read(joined.subarray(5, 13));
  read(joined.subarray(13));
  assert.deepEqual(got, [[1, { a: "é" }], [3, { b: 2 }]]);
});

test("the page may only say which scene, who, which scenario and when", () => {
  assert.equal(normalizePresence(null), null);
  assert.equal(normalizePresence({ scene: "anything" }), null);
  assert.deepEqual(normalizePresence({ scene: "menu", player: "x" }), { scene: "menu" });
  const long = normalizePresence({ scene: "game", player: "A".repeat(500), scenario: " Modern   Day ", date: "1 January 2016", secret: "key" });
  assert.equal(long.player.length, 60);
  assert.equal(long.scenario, "Modern Day");
  assert.equal("secret" in long, false);
});

test("Discord shows who, where and when, the logo and a way to play", () => {
  const activity = activityFor(game, { startedAt: 1234.5 });
  assert.equal(activity.details, "Playing as France");
  assert.equal(activity.state, "Modern Day · 1 January 2016");
  assert.deepEqual(activity.timestamps, { start: 1234 });
  assert.equal(activity.assets.large_image, PRESENCE_IMAGE);
  assert.deepEqual(activity.buttons, [PRESENCE_BUTTON]);
  assert.equal(activityFor({ scene: "game", player: "", scenario: "Rome", date: "218 BC" }).details, "Rome");
  assert.equal(activityFor({ scene: "menu" }).details, "In the main menu");
  assert.equal(activityFor(null), null);
  assert.ok(PRESENCE_BUTTON.label.length <= 32, "Discord caps a button label at 32 characters");
});

test("where the Discord app listens", () => {
  const windows = discordIpcPaths({ platform: "win32", env: {} });
  assert.equal(windows[0], "\\\\?\\pipe\\discord-ipc-0");
  assert.equal(windows.length, 10);
  const linux = discordIpcPaths({ platform: "linux", env: { XDG_RUNTIME_DIR: "/run/user/1000/" } });
  assert.equal(linux[0], "/run/user/1000/discord-ipc-0");
  assert.ok(linux.includes("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0"), "Flatpak");
  assert.ok(linux.includes("/run/user/1000/snap.discord/discord-ipc-9"), "Snap");
  assert.equal(discordIpcPaths({ platform: "darwin", env: { TMPDIR: "/var/folders/x/T/" } })[0], "/var/folders/x/T/discord-ipc-0");
});

test("finds Discord, says who it is, and shows the game", async () => {
  const discord = await fakeDiscord();
  const clock = manualClock();
  const presence = createDiscordPresence({
    applicationId: "123",
    enabled: true,
    paths: () => [socketPath(), discord.path],
    ...clock,
    pid: 4242,
  });
  try {
    presence.update(game);
    await discord.until(() => discord.activities.length === 1, "the first activity");
    assert.deepEqual(discord.handshakes[0], { v: 1, client_id: "123" });
    assert.equal(discord.activities[0].pid, 4242);
    assert.equal(discord.activities[0].activity.details, "Playing as France");
    assert.ok(presence.connected);

    presence.update({ ...game });
    clock.advance(MIN_UPDATE_MS * 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(discord.activities.length, 1, "the same activity is not sent twice");

    presence.update({ ...game, date: "2 January 2016" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await discord.until(() => discord.activities.length === 2, "the new date");
    assert.equal(discord.activities[1].activity.state, "Modern Day · 2 January 2016");
  } finally {
    presence.stop();
    await discord.close();
  }
});

test("never faster than Discord takes updates: the latest waits its turn", async () => {
  const discord = await fakeDiscord();
  const clock = manualClock();
  const presence = createDiscordPresence({ applicationId: "123", enabled: true, paths: () => [discord.path], ...clock });
  try {
    presence.update(game);
    await discord.until(() => discord.activities.length === 1, "the first activity");
    clock.advance(1000);
    presence.update({ ...game, date: "2 January 2016" });
    presence.update({ ...game, date: "3 January 2016" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(discord.activities.length, 1, "held back");
    clock.advance(MIN_UPDATE_MS);
    await discord.until(() => discord.activities.length === 2, "the held update");
    assert.equal(discord.activities[1].activity.state, "Modern Day · 3 January 2016", "only the latest");
  } finally {
    presence.stop();
    await discord.close();
  }
});

test("the elapsed timer starts again with each new game, not with each new date", async () => {
  const discord = await fakeDiscord();
  const clock = manualClock();
  const presence = createDiscordPresence({ applicationId: "123", enabled: true, paths: () => [discord.path], ...clock });
  const shown = async (count, what) => {
    await discord.until(() => discord.activities.length === count, what);
    return discord.activities[count - 1].activity;
  };
  try {
    presence.update({ scene: "menu" });
    const menuStart = (await shown(1, "the menu")).timestamps.start;
    assert.equal(menuStart, clock.now());

    clock.advance(2 * 60000);
    presence.update(game);
    const gameStart = (await shown(2, "the game")).timestamps.start;
    assert.equal(gameStart, clock.now(), "opening a game starts the timer, not the menu before it");

    clock.advance(2 * 60000);
    presence.update({ ...game, date: "2 January 2016" });
    assert.equal((await shown(3, "the next day")).timestamps.start, gameStart, "a time skip is the same game");

    clock.advance(2 * 60000);
    presence.update({ ...game, player: "Germany" });
    assert.equal((await shown(4, "another country")).timestamps.start, clock.now());
  } finally {
    presence.stop();
    await discord.close();
  }
});

test("the page going quiet takes the activity down; its next report puts it back", async () => {
  const discord = await fakeDiscord();
  const clock = manualClock();
  const presence = createDiscordPresence({ applicationId: "123", enabled: true, paths: () => [discord.path], ...clock });
  try {
    presence.update(game);
    await discord.until(() => discord.activities.length === 1, "the first activity");

    // Reports a minute apart keep it up.
    for (let minute = 0; minute < 5; minute += 1) {
      clock.advance(60000);
      presence.update(game);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(discord.activities.length, 1, "nothing changed, so nothing was sent");

    clock.advance(PRESENCE_STALE_MS);
    await discord.until(() => discord.activities.length === 2, "the activity cleared");
    assert.equal(discord.activities[1].activity, null);
    assert.ok(presence.connected, "Discord stays connected for the next report");

    clock.advance(MIN_UPDATE_MS);
    presence.update(game);
    await discord.until(() => discord.activities.length === 3, "the activity back");
    assert.equal(discord.activities[2].activity.details, "Playing as France");
    assert.equal(discord.activities[2].activity.timestamps.start, clock.now(), "a fresh timer");
  } finally {
    presence.stop();
    await discord.close();
  }
});

test("the page's goodbye clears the activity at once", async () => {
  const discord = await fakeDiscord();
  const clock = manualClock();
  const presence = createDiscordPresence({ applicationId: "123", enabled: true, paths: () => [discord.path], ...clock });
  try {
    presence.update(game);
    await discord.until(() => discord.activities.length === 1, "the first activity");
    clock.advance(MIN_UPDATE_MS);
    presence.update(normalizePresence({ scene: "none" }));
    await discord.until(() => discord.activities.length === 2, "the activity cleared");
    assert.equal(discord.activities[1].activity, null);
    assert.deepEqual(clock.pending(), [], "nothing left to time out");
  } finally {
    presence.stop();
    await discord.close();
  }
});

test("Discord quitting and coming back: the game finds it again", async () => {
  const first = await fakeDiscord();
  const clock = manualClock();
  let where = first.path;
  const presence = createDiscordPresence({ applicationId: "123", enabled: true, paths: () => [where], ...clock });
  try {
    presence.update(game);
    await first.until(() => first.activities.length === 1, "the first activity");
    await first.close();
    const deadline = Date.now() + 3000;
    while (presence.connected && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(presence.connected, false);
    assert.ok(clock.pending().includes(RETRY_MS), "it looks again later");

    const second = await fakeDiscord();
    where = second.path;
    clock.advance(RETRY_MS);
    await second.until(() => second.activities.length === 1, "the activity on the new connection");
    assert.equal(second.activities[0].activity.details, "Playing as France");
    await second.close();
  } finally {
    presence.stop();
  }
});

test("an application id Discord does not know: stops asking", async () => {
  const discord = await fakeDiscord({ refuse: true });
  const clock = manualClock();
  const warnings = [];
  const presence = createDiscordPresence({
    applicationId: "999",
    enabled: true,
    paths: () => [discord.path],
    ...clock,
    log: (level, message) => warnings.push(`${level}: ${message}`),
  });
  try {
    presence.update(game);
    await discord.until(() => discord.handshakes.length === 1, "the handshake");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(presence.connected, false);
    assert.deepEqual(clock.pending(), [], "no retry");
    assert.ok(warnings.some((w) => w.includes("does not know application 999")));
    presence.update({ ...game, date: "2 January 2016" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(discord.handshakes.length, 1, "and does not try again");
  } finally {
    presence.stop();
    await discord.close();
  }
});

test("the Open Historia application: a Discord id, so presence is on by default", () => {
  // Discord's ids are snowflakes: 17 to 20 digits. The application is named
  // "Open Historia", which is the "Open Historia" in "Playing Open Historia".
  assert.match(DISCORD_APPLICATION_ID, /^\d{17,20}$/);
  assert.equal(createDiscordPresence({ enabled: true, connect: () => Promise.reject(new Error("no")), paths: () => [] }).active, true);
});

test("no application id, or turned off: nothing is attempted", () => {
  let attempts = 0;
  const connect = () => { attempts += 1; return Promise.reject(new Error("no")); };
  const none = createDiscordPresence({ applicationId: "", enabled: true, connect, paths: () => ["x"] });
  none.update(game);
  const off = createDiscordPresence({ applicationId: "123", enabled: false, connect, paths: () => ["x"] });
  off.update(game);
  assert.equal(attempts, 0);
  assert.equal(none.active, false);
  assert.equal(off.active, false);
});

test("stop lets go of Discord, which takes the activity down", async () => {
  const discord = await fakeDiscord();
  const clock = manualClock();
  const presence = createDiscordPresence({ applicationId: "123", enabled: true, paths: () => [discord.path], ...clock });
  presence.update(game);
  await discord.until(() => discord.activities.length === 1, "the first activity");
  const closed = new Promise((resolve) => discord.connections[0].once("close", resolve));
  presence.stop();
  await closed;
  assert.equal(presence.connected, false);
  await discord.close();
});
