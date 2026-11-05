import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), "utf8");

test("institution raster uploads are kept outside polled world.json and exposed through image routes", () => {
  const store = read("./libraryStore.js");
  const server = read("./server.js");
  const panel = read("../src/Game/GameUI/InstitutionAuthoringPanel.jsx");

  assert.match(store, /institutionLogos:\s*"institution-logos\.json"/);
  assert.match(server, /\/api\/runtime\/institution-logo\/:institutionId/);
  assert.match(server, /\/api\/scenarios\/:scenarioId\/institution-logo\/:institutionId/);
  assert.match(server, /readRuntimeJsonAsset\("institutionLogos"\)/);
  assert.match(panel, /uploadScenarioAsset\([\s\S]*"institutionLogos"/);
  assert.match(panel, /worldPatch:\s*\{\s*institutions:/);
});
