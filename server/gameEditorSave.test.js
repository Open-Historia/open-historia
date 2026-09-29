/*! Open Historia — the game editor saves only what it changed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/gameEditorSave.test.js
//
// The game editor drawer can stay open over the map while turns are played.
// Its Save used to write back the game.json and world.json it loaded, which
// rolled the date, round, borders and polities back to when it opened. It now
// sends patches (gamePatch / worldPatch) of the fields changed in the form, and
// what has to hold is that the store merges them into the files as they are
// now, resolving the player country against the stored world, not the patch.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];

const run = (body) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-game-editor-save-"));
  roots.push(root);
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
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

test("an editor save made after turns were played keeps the turns", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland", setActive: true });
    store.createGame({ id: "saga", name: "Saga", scenarioId: "vinland", setActive: true });
    // The drawer opens here...
    const opened = store.getGameDetails("saga");
    // ...then turns are played: the date, the round and the map move on.
    const played = store.getGameDetails("saga").data;
    store.updateGame("saga", {
      game: { ...played.game, country: "Norse Kingdom", gameDate: "1001-06-01", round: 7 },
      world: {
        ...played.world,
        polityOverrides: { ...(played.world.polityOverrides ?? {}), "Norse Kingdom": { name: "Norse Kingdom", aliases: ["Norsemen"], color: "#123456", note: "" } },
        regionOwnershipOverrides: { r1: "Norse Kingdom" },
      },
    });
    // The player renames the game, changes the label font and picks the
    // player country by its alias, then saves, as the drawer now does.
    store.updateGame("saga", {
      name: "Saga of the North",
      gamePatch: { country: "Norsemen" },
      worldPatch: { labelFont: "Georgia" },
    });
    const saved = store.getGameDetails("saga");
    ${report(`{ openedRound: opened.data.game.round ?? null, name: saved.game.name, game: saved.data.game, world: saved.data.world }`)}
  `);

  assert.equal(result.name, "Saga of the North");
  assert.equal(result.game.round, 7, "the rounds played while the drawer was open are kept");
  assert.equal(result.game.gameDate, "1001-06-01", "and the date they reached");
  assert.equal(result.world.regionOwnershipOverrides.r1, "Norse Kingdom", "and the borders");
  assert.ok(result.world.polityOverrides["Norse Kingdom"], "and the polities");
  assert.equal(result.world.labelFont, "Georgia", "the edited world field lands");
  assert.equal(result.game.country, "Norse Kingdom", "the country resolves against the stored world's polities, not the patch alone");
});
