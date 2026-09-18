import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (url) => readFile(url, "utf8");
const [executor, worklist, checkpoint, quality, rebase, generator] = await Promise.all([
  read(new URL("./executor.js", import.meta.url)),
  read(new URL("./simpleWorklist.js", import.meta.url)),
  read(new URL("./checkpoint.js", import.meta.url)),
  read(new URL("./quality.js", import.meta.url)),
  read(new URL("./checkpointRebase.js", import.meta.url)),
  read(new URL("../geopoliticalWorldGenerator.js", import.meta.url)),
]);

test("PWv2 schedules one global institution-governance stage after membership and before agreements", () => {
  const membership = worklist.indexOf("if (membership.unresolvedInstitutionIds.length)");
  const governance = worklist.indexOf('stages?.institutionGovernance !== "complete"', membership);
  const agreements = worklist.indexOf('stages?.agreements !== "complete"', governance);
  assert.ok(membership >= 0 && governance > membership && agreements > governance);
  assert.match(worklist.slice(governance, agreements), /type:\s*"institution-governance"[\s\S]*targets:\s*\[\]/);
});

test("institution governance is bounded to one provider call and applied through the native charter owner", () => {
  assert.match(executor, /const taskProviderCallCeiling = \(type\) => \([\s\S]*\? 2 : 1/);
  assert.match(executor, /job\.type === "institution-governance"[\s\S]*generateGeopoliticalInstitutionGovernanceJob/);
  assert.match(executor, /job\.type === "institution-governance"[\s\S]*applyGeopoliticalInstitutionGovernanceBaseline/);
  assert.doesNotMatch(executor, /job\.type === "institution-governance"[\s\S]{0,800}for\s*\([^)]*institution[^)]*\)[\s\S]{0,400}callModel/);
});

test("old checkpoints and reference-canon rebases cannot skip the new governance gate", () => {
  assert.match(checkpoint, /institutionGovernance:\s*"pending"/);
  assert.match(checkpoint, /institutionGovernance:\s*"pending"[\s\S]*\.\.\.object\(next\.stages\)/);
  assert.match(rebase, /institutionDiscovery:\s*"pending",\s*institutionGovernance:\s*"pending",\s*agreements:\s*"pending"/);
  assert.match(quality, /Canonical institution governance resolution has not completed/);
});

test("governance prompt is exact-id, scenario-agnostic, and fails closed on legal uncertainty", () => {
  const start = generator.indexOf("const buildInstitutionGovernancePrompt");
  const end = generator.indexOf("const buildAgreementsPrompt", start);
  const block = generator.slice(start, end);
  assert.match(block, /Historical, alternate, future, fictional, and custom institutions are equally valid/);
  assert.match(block, /Use institutionId EXACTLY as supplied/);
  assert.match(block, /do NOT infer a voting rule mechanically from institution kind/i);
  assert.match(block, /return type=unspecified/i);
  assert.match(block, /Return EXACTLY one row for every requested institution/i);
});
