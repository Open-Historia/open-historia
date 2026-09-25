import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const prompts = fs.readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");

test("generated Political Actor operations are dry-run against scratch canonical state before acceptance", () => {
  assert.match(gameplay, /politicalValidationWorld/);
  assert.match(gameplay, /applyPoliticalActorOperation\(politicalValidationWorld, operation\)/);
  assert.match(gameplay, /nativeOutcome\?\.applied/);
  assert.match(gameplay, /was refused: \$\{reason\}/);
});

test("GM prompt receives exact current Political Actor ids only for relevant request context", () => {
  assert.match(prompts, /gameMasterPoliticalActorContext/);
  assert.match(prompts, /exact ids; reuse existing ids instead of inventing replacements/i);
  assert.match(gameplay, /gameMasterPoliticalActorReferenceContext/);
  assert.match(gameplay, /Canonical parties:/);
  assert.match(gameplay, /id=\$\{JSON\.stringify/);
});

test("same-event polity rename is mirrored before Political Actor dry-run", () => {
  assert.match(gameplay, /Runtime polity renames are applied before Political Actor operations/);
  assert.match(gameplay, /getPoliticalProfileKey\(politicalValidationWorld, from\)/);
  assert.match(gameplay, /normalizePoliticalActorRecord/);
});
