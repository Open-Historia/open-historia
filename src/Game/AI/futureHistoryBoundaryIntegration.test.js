import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gameplay = fs.readFileSync(path.join(here, "gameplay.js"), "utf8");
const prompts = JSON.parse(fs.readFileSync(path.join(here, "defaultPrompts.json"), "utf8"));

test("time skips carry real history as the default, the player's agency, and no revived repair requests", () => {
  assert.match(gameplay, /buildRealHistoryDirective/);
  assert.doesNotMatch(gameplay, /buildFutureHistoryBoundaryDirective/);
  for (const task of ["jumpForward", "autoJumpForward"]) {
    assert.ok(prompts.tasks[task].includes("[Real History Is the Default]"), `${task}: real history`);
    assert.ok(prompts.tasks[task].includes("[Player Agency — critical]"), `${task}: player agency`);
  }
  assert.doesNotMatch(gameplay, /buildWorldCompositionBreadthPrompt/);
  assert.doesNotMatch(gameplay, /buildWorldCompositionContinuityPrompt/);
});
