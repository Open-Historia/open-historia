import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./institutionGovernanceBackfill.js", import.meta.url), "utf8");

test("legacy governance backfill reuses the canonical PWv2 governance resolver at scenario-start authority", () => {
  assert.match(source, /generateGeopoliticalInstitutionGovernanceJob\(\{/);
  assert.match(source, /resolveScenarioHistoryAuthority\(\{ world, scenarioDate \}\)/);
  assert.match(source, /buildRoundZeroCanonContextText\(\{ world, game, events \}/);
  assert.match(source, /game\?\.startDate \|\| game\?\.gameDate/);
  assert.doesNotMatch(source, /simple-majority|unanimity|consensus/);
});

test("legacy governance provider work happens before an atomic generation-guarded publication", () => {
  const generated = source.indexOf("await generateGeopoliticalInstitutionGovernanceJob");
  const mutate = source.indexOf("await mutateCanonicalTurnState", generated);
  assert.ok(generated >= 0 && mutate > generated);
  const block = source.slice(mutate, mutate + 3800);
  assert.match(block, /liveGame\?\.gameDate/);
  assert.match(block, /liveGame\?\.round/);
  assert.match(block, /applyGeopoliticalInstitutionGovernanceBaseline\(\{/);
  assert.match(block, /expectedGameId:\s*activeGameId/);
});

test("legacy governance backfill remains fail-closed when constitutional law cannot be established", () => {
  assert.match(source, /final\.rule\.type === "unspecified"/);
  assert.match(source, /No canonical voting rule could be established/);
});
