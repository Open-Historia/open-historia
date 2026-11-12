import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { test } from "node:test";

const STORE_URL = url.pathToFileURL(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "libraryStore.js")).href;
const run = (body) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "oh-currency-persistence-"));
  try {
    const script = `
      const store = await import(${JSON.stringify(STORE_URL)});
      const fs = await import("node:fs");
      const path = await import("node:path");
      const gameJson = (id) => JSON.parse(fs.readFileSync(path.join(process.env.OH_DATA_DIR, "games", id, "game.json"), "utf8"));
      ${body}
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", env: { ...process.env, OH_DATA_DIR: dir }, stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output.slice(output.lastIndexOf("\n@@") + 3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("malformed currency patches fail before game creation and leave existing game and scenario untouched", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland" });
    store.createGame({ id: "good", name: "Good", scenarioId: "vinland" });
    const errors = [];
    for (const attempt of [
      () => store.createGame({ id: "bad", scenarioId: "vinland", gamePatch: { economicDisplayCurrency: "JPY" } }),
      () => store.updateScenario("vinland", { gamePatch: { economicDisplayCurrency: null } }),
      () => store.updateGame("good", { gamePatch: { economicDisplayCurrency: "eur" } }),
    ]) {
      try { attempt(); } catch (error) { errors.push(error.message); }
    }
    process.stdout.write("\\n@@" + JSON.stringify({ errors, good: gameJson("good"), bad: fs.existsSync(path.join(process.env.OH_DATA_DIR, "games", "bad")) }));
  `);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.every((message) => /GDP display currency must be one of/.test(message)));
  assert.equal(result.bad, false);
  assert.equal(result.good.economicDisplayCurrency, undefined);
});

test("scenario currency defaults copy to game, overrides persist through gamePatch, existing canonical GDP remains unchanged", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland", setActive: true });
    store.updateScenario("vinland", { gamePatch: { economicDisplayCurrency: "EUR" } });
    const source = store.getScenarioDetails("vinland").data.game;
    const a = store.createGame({ id: "euro", name: "Euro", scenarioId: "vinland" });
    const b = store.createGame({ id: "pound", name: "Pound", scenarioId: "vinland", gamePatch: { economicDisplayCurrency: "GBP", difficulty: "hard", country: "Norway" } });
    store.updateGame("pound", { gamePatch: { economicDisplayCurrency: "INR" } });
    store.createScenario({ id: "legacy", name: "Legacy" });
    const c = store.createGame({ id: "legacy-game", name: "Legacy", scenarioId: "legacy" });
    process.stdout.write("\\n@@" + JSON.stringify({ source, euro: gameJson("euro"), pound: gameJson("pound"), legacy: gameJson("legacy-game") }));
  `);
  assert.equal(result.source.economicDisplayCurrency, "EUR");
  assert.equal(result.euro.economicDisplayCurrency, "EUR");
  assert.equal(result.pound.economicDisplayCurrency, "INR");
  assert.equal(result.pound.difficulty, "hard");
  assert.equal(result.pound.country, "Norway");
  assert.equal(result.legacy.economicDisplayCurrency, undefined, "old scenarios do not need a save migration");
});
