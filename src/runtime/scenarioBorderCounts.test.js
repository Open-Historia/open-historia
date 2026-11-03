// Run: node --test src/runtime/scenarioBorderCounts.test.js
//
// "I merged many regions and yet it says there are 5 changes" (the owner,
// 2026-11-01, a suggestion for Community Default World Project). A border
// change is a group of neighbouring regions accepted together, so the 28
// regions merged into 17 neighbours were four changes. The suggestion now says
// how many regions they touch.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { borderRegionCounts, describeBorderRegions, summarizeChangesForComment } from "./scenarioChanges.js";

const group = (ops) => ({ kind: "borders", area: "map", regions: ops.map((op, index) => ({ id: String(index), op })) });
const changes = [
  group(["reshape", "remove", "remove", "remove"]),
  group(["reshape", "remove", "add"]),
  { kind: "region-name", area: "map", regionId: "9", from: "Montauk", to: "Long Island" },
];

test("the regions inside the border changes are counted by what happened to them", () => {
  assert.deepEqual(borderRegionCounts(changes), { merged: 4, reshaped: 2, added: 1 });
  assert.equal(describeBorderRegions(borderRegionCounts(changes)), "4 regions merged into others, 2 reshaped, 1 new");
  assert.deepEqual(borderRegionCounts([]), { merged: 0, reshaped: 0, added: 0 });
});

test("the GitHub comment says it beside the border changes", () => {
  assert.deepEqual(summarizeChangesForComment(changes), ["2 border changes (4 regions merged into others, 2 reshaped, 1 new)", "1 region renamed or retyped"]);
});

test("the suggestion dialog and the author's review show it under Borders", () => {
  const source = fs.readFileSync(new URL("../Game/GameUI/ScenarioSuggestions.jsx", import.meta.url), "utf8");
  assert.match(source, /const regions = section\.id === "borders" \? borderRegionCounts\(changes\) : null;/);
});
