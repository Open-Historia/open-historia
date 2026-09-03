import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const libraryBar = fs.readFileSync(
  path.resolve(here, "../src/Game/GameUI/libraryBar.jsx"),
  "utf8",
);
const exporter = fs.readFileSync(
  path.resolve(here, "../src/Editor/exportPreset.js"),
  "utf8",
);
const mapEditor = fs.readFileSync(
  path.resolve(here, "../src/Editor/MapEditor.jsx"),
  "utf8",
);

test("Scenario Workshop exports its currently selected built-in basemap", () => {
  assert.match(exporter, /basemap:\s*doc\.metadata\?\.basemap\s*\|\|\s*null/);
});

test("Scenario Workshop writes the exported basemap into scenario world state", () => {
  assert.match(libraryBar, /basemap:\s*seed\.world\?\.basemap\s*\?\?\s*null/);
});

test("Scenario Workshop refreshes cached scenario details after map save", () => {
  assert.match(
    libraryBar,
    /const savedScenarioDetails = await saveScenario\(scenarioId,\s*\{/,
  );
  assert.match(
    libraryBar,
    /setEditorDetails\(savedScenarioDetails\);/,
  );

  const saveAt = libraryBar.indexOf(
    "const savedScenarioDetails = await saveScenario(scenarioId, {",
  );
  const refreshAt = libraryBar.indexOf(
    "setEditorDetails(savedScenarioDetails);",
    saveAt,
  );
  const assetsAt = libraryBar.indexOf(
    "await uploadScenarioAsset(",
    saveAt,
  );

  assert.ok(saveAt >= 0, "scenario save call missing");
  assert.ok(refreshAt > saveAt, "fresh scenario details must be stored after save");
  assert.ok(assetsAt > refreshAt, "cache refresh should happen before later Workshop work");
});

test("reopening Workshop hydrates from scenario world.basemap", () => {
  assert.match(libraryBar, /basemap:\s*world\.basemap\s*\|\|\s*null/);
  assert.match(
    mapEditor,
    /if \(initialMap\.basemap\) base\.metadata\.basemap = initialMap\.basemap/,
  );
});
