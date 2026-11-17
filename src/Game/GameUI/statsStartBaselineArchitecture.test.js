import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("an already complete scenario Stats sheet does not automatically reroll merely for lacking a calibration stamp", () => {
  const ui = readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../AI/gameplay.js", import.meta.url), "utf8");
  assert.match(ui, /needsStartStatsCoverageVerification\(/,
    "older scenario sheets still require verification against the real map before being trusted");
  assert.match(ui, /persistedNeedsCapAudit \|\| persistedNeedsCoverageCheck/,
    "both old 64-component poisoning and general start-state map mismatch require a native check");
  assert.match(ui, /needsLegacyComponentCapAudit/, "separately retained 64-component corruption audit");
  assert.match(engine, /shouldPreserveLegacyStartStatsBaseline\(/, "generation path must explicitly preserve verified matching legacy baselines");
  const preserved = engine.slice(engine.indexOf("if (statCode && shouldPreserveLegacyStartStatsBaseline({"), engine.indexOf("// Only preserve the old zero-AI migration behavior"));
  assert.match(preserved, /return previous;/, "preservation returns the canonical record");
  assert.doesNotMatch(preserved, /mutateWorldState|applyCountryStatPatchToWorld/, "no migration may rewrite unrelated legacy metadata");
  assert.match(engine, /!territorialCoverageMatches/, "territorial mismatch still requires a numeric repair");
  assert.match(engine, /forceReassess/, "explicit manual reassessment is still possible");
});

test("the country header leads directly into its tabs; only an actionable Stats hold appears in content", () => {
  const ui = readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
  const hero = ui.indexOf('className="oh-country-hero"');
  const tabs = ui.indexOf('className="oh-country-dossier-tabs"');
  const content = ui.indexOf('className="oh-country-content"');
  const hold = ui.indexOf('sheet?.continuity?.progressionBlocked', content);
  const notice = ui.indexOf("Territory changed: refresh this country's Stats", content);
  assert.ok(hero > 0 && hero < tabs && tabs < content && content < hold && hold < notice,
    "only a real geographical Stats hold should appear below navigation in the National view");
  assert.match(ui.slice(content, notice), /statsView === "economy" && sheet\?\.continuity\?\.progressionBlocked/);
  assert.match(ui.slice(content, notice), /role="status"/);
  assert.doesNotMatch(ui, /GDP advances automatically when a valid annual growth rate exists/);
  assert.doesNotMatch(ui, /Last assessed: \{/);
  assert.doesNotMatch(ui, /Progressed through: \{/);
});
