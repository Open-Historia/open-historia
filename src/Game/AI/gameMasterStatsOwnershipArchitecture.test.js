import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("standard and custom Stats ownership is checked for generated GM output and again before Preview/Apply", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const check = gameplay.slice(gameplay.indexOf("const validateStatContract ="), gameplay.indexOf("// ---- Placement:", gameplay.indexOf("const validateStatContract =")));
  assert.match(check, /if \(!customFullStatSheet\)\s*\{\s*const ownershipError = standardStatsMutationError\(taskKey, parsed\)/);
  assert.match(check, /const error = validateCustomObject\(patch\?\.customStats/,
    "custom scenarios must still validate their own schema-defined keys");
  const preview = gameplay.slice(gameplay.indexOf("const validateGameMasterPreviewPayload ="), gameplay.indexOf("const statError = validateGameMasterStatPatches(") + 140);
  assert.match(preview, /validateStatContract\(\s*"gameMaster", candidate, await loadTaskStatContract\("gameMaster"\)\)/,
    "GM Preview and Apply share native ownership validation");
  const apply = gameplay.slice(gameplay.indexOf("export const applyGameMasterPreview ="), gameplay.indexOf("const hasStatPatch = Object.keys(statsOnlyPatch).length"));
  assert.match(apply, /standardGameMasterPatchForApply\(requestedPatch\)/);
  assert.match(apply, /gmStatContract\?\.customFullStatSheet/,
    "custom-sheet GM metrics continue through the old canonical custom path");
  assert.match(apply, /capability\.intelligence = requestedPatch\.customStats\.intelligenceService/,
    "live intelligence alias remains in capability owner");
});

test("standard Stats never prompt the model with legacy customStats contamination from Brazil save", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const kernel = readFileSync(new URL("./countryStatsWorkerKernel.js", import.meta.url), "utf8");
  assert.match(gameplay, /const previousSummary = standardStatsPreviousSummary\(normalizedPrevious\)/);
  assert.match(kernel, /const previousSummary = standardStatsPreviousSummary\(normalizedPrevious\)/);
  assert.match(gameplay, /generateScenarioCustomStatSheet\(/,
    "custom scenario generation remains a distinct path");
});
