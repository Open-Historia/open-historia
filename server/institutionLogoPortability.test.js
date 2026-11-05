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

const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;

const makeRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-institution-logo-"));
  roots.push(root);
  return root;
};

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("dedicated institution logo assets survive scenario and game portability paths", () => {
  const root = makeRoot();
  const result = runStore(root, `
    const logoMap = { "northern-league": "data:image/png;base64,AAAA" };
    const scenario = store.createScenario({ name: "Logo Scenario", setActive: false });
    store.uploadScenarioAsset(
      scenario.scenario.id,
      "institutionLogos",
      Buffer.from(JSON.stringify(logoMap), "utf8"),
      "application/json",
    );

    const scenarioBundle = store.exportScenarioBundle(scenario.scenario.id);
    const importedScenario = store.importScenarioBundle(scenarioBundle, { setSelected: false });
    const importedScenarioGame = store.createGame({
      name: "Imported Logo Scenario Game",
      scenarioId: importedScenario.scenario.id,
      setActive: true,
    });
    store.setActiveGame(importedScenarioGame.game.id);
    const importedScenarioRuntime = store.readRuntimeJsonAsset("institutionLogos").data;

    const sourceGame = store.createGame({
      name: "Logo Game",
      scenarioId: scenario.scenario.id,
      setActive: true,
    });
    store.setActiveGame(sourceGame.game.id);
    const sourceRuntime = store.readRuntimeJsonAsset("institutionLogos").data;
    const gameBundle = store.exportGameBundle(sourceGame.game.id);
    const importedGame = store.importGameBundle(gameBundle);
    store.setActiveGame(importedGame.game.id);
    const importedGameRuntime = store.readRuntimeJsonAsset("institutionLogos").data;

    ${report(`({
      scenarioAssetMode: scenarioBundle.assets.institutionLogos?.mode,
      scenarioAssetData: scenarioBundle.assets.institutionLogos?.data,
      importedScenarioRuntime,
      sourceRuntime,
      gameBundleData: gameBundle.data.institutionLogos,
      importedGameRuntime,
    })`)}
  `);

  const expected = { "northern-league": "data:image/png;base64,AAAA" };
  assert.equal(result.scenarioAssetMode, "embedded");
  assert.deepEqual(result.scenarioAssetData, expected);
  assert.deepEqual(result.importedScenarioRuntime, expected);
  assert.deepEqual(result.sourceRuntime, expected);
  assert.deepEqual(result.gameBundleData, expected);
  assert.deepEqual(result.importedGameRuntime, expected);
});
