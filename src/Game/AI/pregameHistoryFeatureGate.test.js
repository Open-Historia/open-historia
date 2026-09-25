/*! Open Historia — pre-game history feature-gate regression © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/pregameHistoryFeatureGate.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./gameplayLazy.js", import.meta.url), "utf8");

test("pre-game history checks its feature switch before loading the AI simulation stack", () => {
  assert.match(
    source,
    /import \{ isActiveFeatureEnabled \} from "\.\.\/\.\.\/runtime\/gameFeatures\.js";/,
    "gameplayLazy must read the resolved scenario/game feature state",
  );

  const start = source.indexOf("export const maybeGeneratePregameHistory = async");
  assert.notEqual(start, -1, "the pre-game history lazy entry point is missing");
  const end = source.indexOf("\n};", start);
  assert.notEqual(end, -1, "could not bound the pre-game history lazy entry point");
  const body = source.slice(start, end + 3);

  const gate = body.indexOf('if (!isActiveFeatureEnabled("pregameHistory")) return null;');
  const load = body.indexOf("await gameplay()");
  assert.notEqual(gate, -1, "the feature switch is not enforced");
  assert.notEqual(load, -1, "the production entry point no longer reaches gameplay");
  assert.ok(gate < load, "gameplay.js is loaded before the feature is checked");
});
