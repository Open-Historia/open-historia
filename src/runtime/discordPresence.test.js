/*! Open Historia — what Discord shows the player playing: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/discordPresence.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PRESENCE_GONE, PRESENCE_HEARTBEAT_MS, presenceFor } from "./discordPresence.js";
import { normalizePresence, PRESENCE_STALE_MS } from "../../server/discordPresence.js";

const game = { id: "g1", country: "FRA", currentDate: "2016-01-01" };

test("in a game: who, which scenario and the in-game date", () => {
  assert.deepEqual(presenceFor({ activeGame: game, playerName: "France", scenarioName: "Modern Day" }), {
    scene: "game",
    player: "France",
    scenario: "Modern Day",
    date: "1 January 2016",
  });
});

test("a year before AD 1 reads as BC", () => {
  const rome = presenceFor({ activeGame: { ...game, currentDate: "-0218-03-01" }, playerName: "Rome", scenarioName: "Punic Wars" });
  assert.equal(rome.date, "1 March 218 BC");
});

test("no game, no games, or the main menu over a game: the main menu", () => {
  assert.deepEqual(presenceFor({}), { scene: "menu" });
  assert.deepEqual(presenceFor({ activeGame: game, inMenu: true }), { scene: "menu" });
});

test("what the page sends is what the server accepts", () => {
  const sent = presenceFor({ activeGame: game, playerName: "France", scenarioName: "Modern Day" });
  assert.deepEqual(normalizePresence(JSON.parse(JSON.stringify(sent))), sent);
  assert.deepEqual(normalizePresence(presenceFor({})), { scene: "menu" });
});

test("the page's goodbye clears the activity, and its heartbeat outpaces the server's timeout", () => {
  assert.equal(normalizePresence(JSON.parse(JSON.stringify(PRESENCE_GONE))), null);
  // Two missed beats (a background tab's timers are throttled to a minute) must
  // not take a player who is still playing off Discord.
  assert.ok(PRESENCE_HEARTBEAT_MS * 2 < PRESENCE_STALE_MS);
});

test("the HUD reports it, and the server only takes it from this computer", () => {
  const hud = fs.readFileSync(new URL("../Game/GameUI/main.jsx", import.meta.url), "utf8");
  assert.match(hud, /useDiscordPresence\(presenceFor\(\{/);
  const server = fs.readFileSync(new URL("../../server/server.js", import.meta.url), "utf8");
  assert.match(server, /app\.post\("\/api\/presence", jsonParser, \(req, res\) => \{\s*if \(isLoopbackAddress\(req\.socket\?\.remoteAddress\)\) discordPresence\.update\(normalizePresence\(req\.body\)\);/);
});
