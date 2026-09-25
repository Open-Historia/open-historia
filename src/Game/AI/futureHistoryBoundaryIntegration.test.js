import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gameplay = fs.readFileSync(path.join(here, "gameplay.js"), "utf8");

test("latest Beta time skips append the native counterfactual knowledge boundary without reviving repair requests", () => {
  assert.match(gameplay, /buildFutureHistoryBoundaryDirective/);
  assert.match(gameplay, /\[Player Agency\]/);
  assert.doesNotMatch(gameplay, /buildWorldCompositionBreadthPrompt/);
  assert.doesNotMatch(gameplay, /buildWorldCompositionContinuityPrompt/);
});
