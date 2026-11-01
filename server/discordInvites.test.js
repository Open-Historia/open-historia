/*! Open Historia — shared games joined through Discord: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/discordInvites.test.js
//
// "make inviting someone to play on discord rich presence invite them to a
// multiplayer game. if they are online they should get a popup asking them to
// join" (the owner, 2026-10-28).

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import test from "node:test";

import {
  JOIN_SECRET_PATTERN,
  OP_FRAME,
  PRESENCE_BUTTON,
  activityFor,
  createDiscordPresence,
  createFrameReader,
  encodeFrame,
  normalizePresence,
  partyIdOf,
} from "./discordPresence.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

// An invite code as multiplayer/invite.js writes it: "oh1-" and 114 base64url characters.
const TOKEN = `oh1-${"AbC_d-9".repeat(17)}Ab0x5`.slice(0, 118);
const game = { scene: "game", player: "France", scenario: "Modern Day", date: "1 January 2016" };

// A Discord app on an in-memory socket: answers the handshake, records every
// frame the game writes, and can dispatch an event to it.
const fakeSocket = () => {
  const socket = new EventEmitter();
  socket.frames = [];
  const reader = createFrameReader((op, payload) => {
    if (op === 0) setImmediate(() => socket.emit("data", encodeFrame(OP_FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } })));
    else socket.frames.push(payload);
  });
  socket.write = (chunk) => { reader(chunk); return true; };
  socket.destroy = () => { socket.emit("close"); };
  socket.dispatch = (evt, data) => socket.emit("data", encodeFrame(OP_FRAME, { cmd: "DISPATCH", evt, data }));
  return socket;
};

const connected = async (options = {}) => {
  const socket = fakeSocket();
  const presence = createDiscordPresence({ applicationId: "123", enabled: true, paths: () => ["fake"], connect: async () => socket, ...options });
  return { socket, presence };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a shared game's party carries its invite code as the join secret, and nothing else as one", () => {
  assert.equal(JOIN_SECRET_PATTERN.test(TOKEN), true);
  const withParty = normalizePresence({ ...game, party: { token: TOKEN, players: 3, seats: 8, secret: "x" } });
  assert.deepEqual(withParty.party, { token: TOKEN, players: 3, seats: 8 });
  // Not an invite code, or none at all: no party.
  for (const token of ["", "sk-live-123", "oh1-short", `oh2-${TOKEN.slice(4)}`]) {
    assert.equal("party" in normalizePresence({ ...game, party: { token, players: 1, seats: 8 } }), false, token);
  }
  assert.equal(normalizePresence({ scene: "menu", party: { token: TOKEN, players: 1, seats: 4 } }).party.seats, 4);
  // More in than seats is held to the seats.
  assert.deepEqual(normalizePresence({ ...game, party: { token: TOKEN, players: 90, seats: 6 } }).party, { token: TOKEN, players: 6, seats: 6 });
});

test("Discord is shown a party and a join secret, and no button beside them", () => {
  const activity = activityFor(normalizePresence({ ...game, party: { token: TOKEN, players: 2, seats: 8 } }));
  assert.deepEqual(activity.secrets, { join: TOKEN });
  assert.deepEqual(activity.party, { id: partyIdOf(TOKEN), size: [2, 8] });
  assert.equal(activity.party.id.includes(TOKEN.slice(4, 20)), false, "the party id says nothing of the code");
  assert.equal("buttons" in activity, false);
  assert.equal(activityFor(normalizePresence({ scene: "menu", party: { token: TOKEN, players: 1, seats: 8 } })).details, "In a shared game's lobby");
  // A game played alone keeps its button and has no secret.
  const alone = activityFor(normalizePresence(game));
  assert.deepEqual(alone.buttons, [PRESENCE_BUTTON]);
  assert.equal("secrets" in alone, false);
});

test("joins and requests to join are asked for, and wait for the page", async () => {
  const { socket, presence } = await connected();
  presence.update(normalizePresence(game));
  await settle();
  const subscribed = socket.frames.filter((frame) => frame.cmd === "SUBSCRIBE").map((frame) => frame.evt);
  assert.deepEqual(subscribed, ["ACTIVITY_JOIN", "ACTIVITY_JOIN_REQUEST"]);

  // A friend pressed Join: the code waits for the page, once.
  socket.dispatch("ACTIVITY_JOIN", { secret: TOKEN });
  socket.dispatch("ACTIVITY_JOIN_REQUEST", { user: { id: "123456789012", username: "lafayette", global_name: "Gilbert" } });
  await settle();
  const inbox = presence.takeInbox();
  assert.deepEqual(inbox, { join: { token: TOKEN }, requests: [{ id: "123456789012", name: "Gilbert" }] });
  assert.equal(presence.takeInbox().join, null, "a join is handed over once");

  // Accepted: Discord sends the invitation; declined: the request is closed.
  assert.equal(presence.answer("123456789012", true), true);
  const invite = socket.frames.find((frame) => frame.cmd === "SEND_ACTIVITY_JOIN_INVITE");
  assert.deepEqual(invite.args, { user_id: "123456789012" });
  assert.equal(presence.answer("123456789012", false), false, "answered already");
  socket.dispatch("ACTIVITY_JOIN_REQUEST", { user: { id: "999999999999", username: "kaiser" } });
  await settle();
  assert.equal(presence.answer("999999999999", false), true);
  assert.deepEqual(socket.frames.find((frame) => frame.cmd === "CLOSE_ACTIVITY_REQUEST").args, { user_id: "999999999999" });
  presence.stop();
});

test("nothing is taken that is not an invite code, nor while the presence is off", async () => {
  const { socket, presence } = await connected();
  presence.update(normalizePresence(game));
  await settle();
  socket.dispatch("ACTIVITY_JOIN", { secret: "javascript:alert(1)" });
  socket.dispatch("ACTIVITY_JOIN_REQUEST", { user: { id: "not-a-snowflake", username: "x" } });
  await settle();
  assert.deepEqual(presence.takeInbox(), { join: null, requests: [] });
  // Turned off (the page's goodbye): nothing is held, and nothing new is taken.
  presence.update(null);
  socket.dispatch("ACTIVITY_JOIN", { secret: TOKEN });
  await settle();
  assert.deepEqual(presence.takeInbox(), { join: null, requests: [] });
  presence.stop();
});

test("old joins and requests are let go", async () => {
  let t = 1_000_000;
  const { socket, presence } = await connected({ now: () => t });
  presence.update(normalizePresence(game));
  await settle();
  socket.dispatch("ACTIVITY_JOIN", { secret: TOKEN });
  socket.dispatch("ACTIVITY_JOIN_REQUEST", { user: { id: "123456789012", username: "late" } });
  await settle();
  t += 10 * 60 * 1000;
  assert.deepEqual(presence.takeInbox(), { join: null, requests: [] });
  presence.stop();
});

test("the routes, the popups, the party and Discord's launch are wired", () => {
  const server = read("./server.js");
  assert.match(server, /app\.get\("\/api\/presence\/inbox", \(req, res\) => \{\s+if \(!isLoopbackAddress\(req\.socket\?\.remoteAddress\)\)/);
  assert.match(server, /app\.post\("\/api\/presence\/answer", jsonParser, \(req, res\) => \{\s+if \(!isLoopbackAddress/);
  const ui = read("../src/multiplayer/ui/DiscordInvites.jsx");
  assert.match(ui, /await joinSharedGame\(\{ token: invite\.token, name: rememberedName\(\) \}\);\s+setInvite\(null\);\s+enterActiveGameFromOutside\(\);/);
  assert.match(ui, /setDiscordParty\(available \? party : null\);/);
  assert.match(ui, /if \(stopped \|\| !presenceAllowed\(\)\) return;/);
  assert.match(ui, /A friend invited you to a shared game/);
  assert.match(ui, /asks to join your shared game/);
  assert.match(read("../src/App.jsx"), /<SharedGameOverlay \/>\s+<DiscordInvites \/>/);
  assert.match(read("../src/runtime/discordPresence.js"), /const body = JSON\.stringify\(withParty\(presence, currentParty\)\);/);
  const main = read("../electron/main.cjs");
  const { DISCORD_APPLICATION_ID: serverId } = { DISCORD_APPLICATION_ID: read("./discordPresence.js").match(/DISCORD_APPLICATION_ID = "(\d+)"/)[1] };
  assert.match(main, new RegExp(`const DISCORD_APPLICATION_ID = "${serverId}";`), "the same application as the server's");
  assert.match(main, /app\.setAsDefaultProtocolClient\(`discord-\$\{DISCORD_APPLICATION_ID\}`\);/);
});
