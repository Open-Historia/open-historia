import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const layer = fs.readFileSync(path.join(here, "PolityTextLayer.jsx"), "utf8");
const nations = fs.readFileSync(path.join(here, "..", "Nations.jsx"), "utf8");

// What the runtime does with each wakeup is tested in polityTextSync.test.js;
// these check that the component sends the right one.
test("scenario style wakeups cannot starve an in-flight PTR placement generation", () => {
  assert.match(layer, /const onMapReady = \(\) => \{[\s\S]*?invalidateInFlight: false/);
});

test("new canonical PTR records still preempt stale placement work", () => {
  assert.match(layer, /runtime\.syncRecords\(\{ invalidateInFlight: true \}\)/);
});

test("PTR scenario recovery does not key the renderer to the mutable runtime asset token", () => {
  assert.doesNotMatch(nations, /key=\{`ptr:\$\{activeGeometryEpoch\}`\}/);
  assert.doesNotMatch(nations, /ptrPolityTextStatus\.lifecycleEpoch === activeGeometryEpoch/);
  assert.match(nations, /<PolityTextLayer[\s\S]*?records=\{ptr1PolityTextEnabled \? ptr1PolityTextRecords : \[\]\}/);
});

test("scenario recovery keeps the accepted political-fill and flood baseline intact", () => {
  assert.match(nations, /const buildPoliticalFillOpacity = \(hiddenExpression = null\) => \[/);
  assert.match(nations, /createOwnershipFloodCustomLayer/);
  assert.match(nations, /const OWNERSHIP_FLOOD_PREP_BUDGET_MS = 350/);
  // One ramp for the custom and the stock fills: the political map's, or on the
  // diplomatic map its stronger one (buildDiplomaticFillOpacity).
  assert.match(
    nations,
    /const hiddenAwareFillOpacity = useMemo\(\(\) => \(diplomaticOn[\s\S]*?buildPoliticalFillOpacity\(FILL_HIDDEN\)\)/,
  );
  assert.match(nations, /const transitionAwareFillOpacity = customFlag \? hiddenAwareFillOpacity : 0;/);
  // (The hidden flag, shared by the sweep and the battlefields' ground: frontGround.js.)
  assert.match(nations, /const FILL_HIDDEN = \["boolean", \["feature-state", "ownershipTransitionHidden"\], false\];/);
  assert.doesNotMatch(
    nations,
    /const hiddenAwareFillOpacity = useMemo\(\(\) => \(diplomaticOn[\s\S]*?\[\s*"case",[\s\S]*?POLITICAL_FILL_OPACITY/,
  );
});
