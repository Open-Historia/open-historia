/*! Open Historia - resolved interactive scene completion regression. AGPL-3.0-or-later. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sceneCompletionTitle } from "./interactiveCompletion.js";

const rome = "The Rome Rapprochement: Sokolov-Meloni Agreement on Sirte Basin";
const iran = "Foreign agent dies in custody in Islamic Republic of Iran";
const persisted = [
  { id: "event-ai-r0323-20290831-001", kind: "interactive", title: rome },
  { id: "espionage-323-1", source: "espionage", kind: "world", title: iran },
];

test("scene completion uses its own result, never a later espionage event from the committed timeline", () => {
  const result = { resolvedSceneTitle: rome, events: persisted };
  assert.equal(sceneCompletionTitle(result, "Historic state visit to Rome"), rome);
  assert.notEqual(sceneCompletionTitle(result, "Historic state visit to Rome"), persisted.at(-1).title);
});

test("missing scene outcome title falls back to its original scene, not unrelated appended events", () => {
  assert.equal(sceneCompletionTitle({ events: persisted }, "Historic state visit to Rome"),
    "Historic state visit to Rome");
  assert.equal(sceneCompletionTitle({ resolvedSceneTitle: " ", events: persisted }, "Original scene"),
    "Original scene");
  assert.equal(sceneCompletionTitle(null, "Original scene"), "Original scene");
});

test("both automatically resolved and manually ended scenes use the authoritative result title", () => {
  const ui = readFileSync(new URL("../GameUI/interactive.jsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.equal((ui.match(/sceneCompletionTitle\(result, title\)/g) || []).length, 2,
    "the Play and End buttons must share the same resolution contract");
  assert.doesNotMatch(ui, /result\.events\?\.at\?\.\(-1\)\?\.title/,
    "the returned timeline is not ordered by which event belongs to the finished scene");
  assert.match(engine, /resolvedSceneTitle:\s*normalizeString\(sceneOutcome\?\.title\)/,
    "scene resolution must return the title from its own committed outcome");
});
