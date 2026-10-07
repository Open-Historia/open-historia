import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("normal timeline validation delegates formal institution outcomes to the native ledger", () => {
  assert.match(gameplay, /generatedInstitutionOutcomeIntegrityIssue/);
  assert.match(gameplay, /const institutionOutcomeError = generatedInstitutionOutcomeIntegrityIssue\(candidate, world\)/);
  assert.match(gameplay, /if \(institutionOutcomeError\) return institutionOutcomeError/);
});
