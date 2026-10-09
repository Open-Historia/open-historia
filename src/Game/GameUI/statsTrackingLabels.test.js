import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { extractFromSource } from "../../../scripts/i18n/extractStrings.mjs";

// The auto-refresh cadence used to be built in countryStats.js, which the
// catalog never reads, so "Every 6 months" stayed English in every language.
test("the Stats pane's auto-refresh cadence words reach the translation catalog", () => {
  const source = fs.readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
  const { exact, patterns } = extractFromSource(source, "src/Game/GameUI/stats.jsx", {});
  assert.ok(exact.has("Manual only"));
  assert.ok(exact.has("Every month"));
  assert.ok(patterns.has("Every {{count}} months"));
  assert.ok(patterns.has("Auto-refresh: {{countryStatsTrackingIntervalLabel}} · Tracked: {{trackedPolitiesCount}}/{{COUNTRY_STATS_TRACKING_MAX_POLITIES}}"));
});
