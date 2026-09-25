import assert from "node:assert/strict";
import test from "node:test";

import { newSeal, newSpyReportId, openPoliticalAssessment, sealPoliticalAssessment } from "./spySeal.js";

test("political assessments are sealed at rest under the report id and round-trip", async () => {
  const seal = newSeal();
  const reportId = newSpyReportId();
  const assessment = {
    summary: "Leadership appears unusually willing to accept diplomatic risk.",
    source: "HUMINT reporting",
    confidence: "Moderate",
    gatheredAt: "1938-03-04",
    findings: [{ topic: "Alliance perception", text: "Senior leaders appear to doubt allied cohesion." }],
  };

  const sealed = await sealPoliticalAssessment(seal, reportId, assessment);
  assert.ok(sealed?.cipher);
  assert.ok(!JSON.stringify(sealed).includes("doubt allied cohesion"));
  assert.deepEqual(await openPoliticalAssessment(seal, reportId, sealed), assessment);
  assert.notDeepEqual(await openPoliticalAssessment(newSeal(), reportId, sealed), assessment);
});
