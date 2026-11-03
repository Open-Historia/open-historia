import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../GameUI/stats.jsx", import.meta.url), "utf8");

test("ordinary turns never invoke legacy periodic AI Statistics reassessment", () => {
  assert.equal((game.match(/nextWorld = await refreshTrackedCountryStatsIfDue\(/g) || []).length, 0);
  assert.equal((game.match(/refreshTrackedCountryStatsIfDue\(/g) || []).length, 0,
    "the retained legacy implementation may not have any live caller");
  assert.match(game, /A refused\/partial native settlement leaves its/);
  assert.match(game, /return \{ history, stats: false \};/);
  const requestBudget = game.slice(game.indexOf("const createJumpRequests"), game.indexOf("const skipUpkeepDue"));
  assert.doesNotMatch(requestBudget, /reserve\("stats"/);
  assert.match(game, /if \(!nativeStatsChronology \|\| nativeStatsChronology\.partial\) impactedWorld = withBlockadeEconomy/);
  assert.match(game, /captureCountryStatsHistory\(nextWorld/);
});

test("historical tracking UX cannot reactivate retired AI reassessment", () => {
  assert.match(ui, /Legacy AI refresh schedule \(retired\)/);
  assert.match(ui, /Scheduled AI reassessment has been retired/);
  assert.doesNotMatch(ui, /onClick=\{\(\) => setIntervalMonths/);
  assert.match(ui, /Native history tracking/);
  assert.match(ui, /lastAutoRefreshByPolity/, "old timestamps remain available as historical data");
});
