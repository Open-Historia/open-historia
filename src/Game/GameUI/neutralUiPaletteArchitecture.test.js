import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const gameUiUrl = new URL("./", import.meta.url);
const jsxFiles = readdirSync(gameUiUrl)
  .filter((name) => name.endsWith(".jsx"))
  .sort();

const retiredPurplePatterns = [
  /#(?:7c3aed|8b5cf6|a78bfa|c4b5fd|ddd6fe|ede9fe|e9d5ff|f3f0ff)\b/i,
  /rgba?\(\s*(?:109\s*,\s*66\s*,\s*217|124\s*,\s*58\s*,\s*237|139\s*,\s*92\s*,\s*246|154\s*,\s*127\s*,\s*255|167\s*,\s*139\s*,\s*250|196\s*,\s*181\s*,\s*253)\b/i,
];

test("Game UI does not reintroduce the retired purple chrome palette", () => {
  const offenders = [];
  for (const name of jsxFiles) {
    const source = readFileSync(new URL(name, gameUiUrl), "utf8");
    if (retiredPurplePatterns.some((pattern) => pattern.test(source))) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

test("recent scenario-authoring surfaces use the shared neutral UI tokens", () => {
  for (const name of [
    "PoliticalWorldAuthoringPanel.jsx",
    "InstitutionAuthoringPanel.jsx",
    "InstitutionsWorkspace.jsx",
    "libraryBar.jsx",
  ]) {
    const source = readFileSync(new URL(name, gameUiUrl), "utf8");
    assert.match(source, /var\(--oh-grey-(?:raised|selected|border-strong|text|muted)\)/, `${name} should use the shared neutral palette`);
  }
});
