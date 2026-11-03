import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const gameplay = await readFile(new URL("./gameplay.js", import.meta.url), "utf8");
const background = await readFile(new URL("../../runtime/politicalBackground.js", import.meta.url), "utf8");

test("latest Beta applies native PWv2 background motion after settled turn impacts and before Stats history snapshot", () => {
  const citiesFollowing = gameplay.indexOf("nextWorld = await citiesFollowCountries({");
  const politics = gameplay.indexOf("const political = await advancePoliticalBackgroundSimulation({");
  const statsHistory = gameplay.indexOf("nextWorld = captureCountryStatsHistory(nextWorld, {", politics);
  assert.ok(citiesFollowing > 0 && politics > citiesFollowing, "political background sees the settled native world, not a fabricated Stats reassessment");
  assert.doesNotMatch(gameplay, /nextWorld = await refreshTrackedCountryStatsIfDue\(/);
  assert.ok(statsHistory > politics, "Stats history must snapshot the world after native political evolution");
});

test("political background is CPU-only and preserves canonical state if its worker is unavailable", () => {
  assert.doesNotMatch(background, /callAI|runJsonTask|requestBudget/);
  assert.match(background, /reason:\s*computed\.reason \|\| "background-worker-skipped"/);
  assert.match(background, /world:\s*inputWorld/);
});
