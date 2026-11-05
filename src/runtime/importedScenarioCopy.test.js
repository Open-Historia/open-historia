/*! Open Historia — the map a game zip carries tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/importedScenarioCopy.test.js
//
// A game zip carrying its map names it by the sender's scenario id, and ids
// come from names. What has to hold:
//   - an unrelated scenario that happens to hold the id is not the map, so the
//     carried map is imported rather than dropped;
//   - importing the same game twice still leaves one copy of its map;
//   - a hub game pointing at a map this library has under that id, but from
//     somewhere else, is shown as missing instead of opening on it.
// Store cases run in a child process: OH_DATA_DIR is read once, at import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { bundleMatchesScenario, findScenarioCopyOfBundle, scenarioCopyCandidates } from "./importedScenarioCopy.js";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(HERE, "..", "..", "server", "libraryStore.js")).href;
const HELPER_URL = url.pathToFileURL(path.join(HERE, "importedScenarioCopy.js")).href;
const roots = [];

const runStore = (body) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-carried-map-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const helper = await import(${JSON.stringify(HELPER_URL)});
    ${body}
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};
const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const bundle = (overrides = {}) => ({
  scenario: { id: "new-scenario", name: "New Scenario" },
  data: {
    world: { regionOwnershipOverrides: { r1: "Avalon" }, polityOverrides: { Avalon: { name: "Avalon" } } },
    game: { country: "Avalon", gameDate: "1200-01-01" },
    prompts: {},
  },
  ...overrides,
});
const detailsOf = (source, id = source.scenario.id) => ({ scenario: { id, name: source.scenario.name }, data: source.data });

test("the candidates are the sent id and the ids an earlier import of it was given", () => {
  const scenarios = [{ id: "new-scenario" }, { id: "new-scenario-2" }, { id: "new-scenario-copy" }, { id: "new-scenario-2-3" }, { id: "other" }];
  assert.deepEqual(scenarioCopyCandidates("new-scenario", scenarios).map((entry) => entry.id), ["new-scenario", "new-scenario-2"]);
  assert.deepEqual(scenarioCopyCandidates("", scenarios), []);
  assert.deepEqual(scenarioCopyCandidates("a.b", [{ id: "a.b-2" }, { id: "axb-2" }]).map((entry) => entry.id), ["a.b-2"], "the id is matched literally");
});

test("a scenario is the carried map only when its name, world, game and prompts are the bundle's", () => {
  const sent = bundle();
  assert.equal(bundleMatchesScenario(sent, detailsOf(sent)), true);
  const reordered = { scenario: sent.scenario, data: { ...sent.data, world: { polityOverrides: sent.data.world.polityOverrides, regionOwnershipOverrides: sent.data.world.regionOwnershipOverrides } } };
  assert.equal(bundleMatchesScenario(sent, detailsOf(reordered)), true, "key order is no difference");
  const unrelated = bundle({ data: { ...sent.data, world: { regionOwnershipOverrides: { r1: "Lyonesse" } } } });
  assert.equal(bundleMatchesScenario(sent, detailsOf(unrelated)), false, "the same name on another map is another map");
  const renamed = bundle({ scenario: { id: "new-scenario", name: "Old Scenario" } });
  assert.equal(bundleMatchesScenario(sent, detailsOf(renamed)), false);
  assert.equal(bundleMatchesScenario(sent, null), false);
});

test("the copy is found among the candidates, and a failed read is no copy", async () => {
  const sent = bundle();
  const unrelated = bundle({ data: { ...sent.data, game: { country: "Lyonesse" } } });
  const library = { "new-scenario": detailsOf(unrelated), "new-scenario-2": detailsOf(sent, "new-scenario-2") };
  const load = async (id) => library[id];
  const scenarios = [{ id: "new-scenario" }, { id: "new-scenario-2" }];
  assert.equal(await findScenarioCopyOfBundle(sent, scenarios, load), "new-scenario-2");
  assert.equal(await findScenarioCopyOfBundle(sent, [{ id: "new-scenario" }], load), null, "the unrelated holder of the id is skipped");
  assert.equal(await findScenarioCopyOfBundle(sent, scenarios, async () => { throw new Error("offline"); }), null);
});

test("on the desktop store: an unrelated map under the id is kept apart, and the same map imports once", () => {
  const result = runStore(`
    // The receiver's own map that happens to share the sender's id.
    store.createScenario({ id: "new-scenario", name: "New Scenario", setActive: false });
    store.updateScenario("new-scenario", { game: { country: "Lyonesse" }, world: { regionOwnershipOverrides: { r1: "Lyonesse" } } });
    // The sender's map, as a game zip would carry it: exported from its store.
    store.createScenario({ id: "sender", name: "New Scenario", setActive: false });
    store.updateScenario("sender", { game: { country: "Avalon", gameDate: "1200-01-01" }, world: { regionOwnershipOverrides: { r1: "Avalon" } } });
    const carried = store.exportScenarioBundle("sender");
    carried.scenario.id = "new-scenario";
    const scenarios = () => store.getScenarioCatalog().scenarios;
    const load = async (id) => store.getScenarioDetails(id);
    const first = await helper.findScenarioCopyOfBundle(carried, scenarios(), load);
    const importedId = first ?? store.importScenarioBundle(carried, { setSelected: false }).scenario.id;
    const second = await helper.findScenarioCopyOfBundle(carried, scenarios(), load);
    ${report(`{ first, importedId, second, receiversOwn: store.getScenarioDetails("new-scenario").data.game.country }`)}
  `);

  assert.equal(result.first, null, "the receiver's own New Scenario is not the sender's map");
  assert.equal(result.importedId, "new-scenario-2", "so the carried map is imported beside it");
  assert.equal(result.second, "new-scenario-2", "and a second import of the same game finds it rather than making another copy");
  assert.equal(result.receiversOwn, "Lyonesse", "the receiver's map is untouched");
});

test("on the desktop store: a hub game names this library's copy of the file, or a map that is missing", () => {
  const result = runStore(`
    const origin = { postId: 7, bundleUrl: "https://github.com/user-attachments/files/7/map.zip", syncedAt: "2026-08-01T00:00:00.000Z" };
    store.createScenario({ id: "new-scenario", name: "New Scenario", setActive: false });
    const importGame = () => store.importGameBundle({
      schema: "open-historia-game-bundle/1",
      game: { name: "Hub Campaign" },
      data: {},
      scenarioRef: { builtIn: false, hubOrigin: origin, scenarioId: "new-scenario", scenarioName: "New Scenario" },
    });
    const card = (id) => store.getGameCatalog().games.find((entry) => entry.id === id);
    const unrelated = card(importGame().game.id);
    // The post's map, downloaded: only an import says where a scenario came from.
    store.importScenarioBundle(
      { schema: "open-historia-scenario-bundle/2", scenario: { id: "hub-copy", name: "Hub Map" }, data: {}, hubOrigin: origin },
      { setSelected: false },
    );
    const copied = card(importGame().game.id);
    ${report(`{
      unrelated: { scenarioId: unrelated.scenarioId, missing: unrelated.scenarioMissing, origin: unrelated.importedScenarioOrigin?.postId },
      copied: { scenarioId: copied.scenarioId, missing: copied.scenarioMissing },
    }`)}
  `);

  assert.equal(result.unrelated.missing, true, "the receiver's own New Scenario is not the post's map, so the map shows as missing");
  assert.notEqual(result.unrelated.scenarioId, "new-scenario");
  assert.equal(result.unrelated.origin, 7, "and the game still knows where to fetch it");
  assert.deepEqual(result.copied, { scenarioId: "hub-copy", missing: false }, "a copy of that very file is the map, whatever its id");
});
