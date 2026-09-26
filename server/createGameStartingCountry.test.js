/*! Open Historia - a new game starts with the player's country © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The new-game picker's country and difficulty ride on the create request
// (gamePatch) instead of a second request after `setActive` had already made
// the game current — the gap in which the opening cover and the HUD named the
// scenario's default country (Modern Day's United States).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];

const run = (body) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-start-country-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const fs = await import("node:fs");
    const path = await import("node:path");
    const gameJson = (id) => JSON.parse(fs.readFileSync(path.join(process.env.OH_DATA_DIR, "games", id, "game.json"), "utf8"));
    ${body}
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

const report = (expr) => `process.stdout.write("\\n@@" + JSON.stringify(${expr}));`;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a game created with a gamePatch holds the country and difficulty from the start, exactly as a later save would write them", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland", setActive: true });
    store.updateScenario("vinland", { game: { country: "Norway", startDate: "1000-01-01", gameDate: "1000-01-01", round: 1 } });
    const created = store.createGame({ id: "picked", name: "Picked", scenarioId: "vinland", gamePatch: { country: "Iceland", difficulty: "hard" }, setActive: true });
    store.createGame({ id: "saved", name: "Saved", scenarioId: "vinland" });
    store.updateGame("saved", { gamePatch: { country: "Iceland", difficulty: "hard" } });
    store.createGame({ id: "plain", name: "Plain", scenarioId: "vinland" });
    ${report(`{ picked: gameJson("picked"), saved: gameJson("saved"), plain: gameJson("plain"), active: created.game?.id ?? created.id }`)}
  `);
  assert.equal(result.picked.country, "Iceland");
  assert.equal(result.picked.difficulty, "hard");
  // A patch merges: the scenario's dates and round stay (the "Undated" bug).
  assert.equal(result.picked.startDate, "1000-01-01");
  assert.equal(result.picked.round, 1);
  assert.deepEqual(result.picked, result.saved);
  assert.equal(result.plain.country, "Norway", "without a patch the scenario's default stands");
});
