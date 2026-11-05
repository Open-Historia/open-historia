import assert from "node:assert/strict";
import test from "node:test";

import { validateGameplayPayload } from "./gameplaySchemas.js";

const exchange = {
  counterpart: "Italy",
  date: "1938-03-04",
  subject: "Austria",
  messages: [
    { speaker: "Germany", text: "Rome must stay out of Vienna." },
    { speaker: "Italy", text: "Agreed, for a price." },
  ],
};

test("spy intercept schema accepts prose-only political assessment", () => {
  const payload = {
    exchanges: [exchange],
    politicalAssessment: {
      summary: "Leadership appears willing to accept substantial diplomatic risk.",
      findings: [
        { topic: "Alliance perception", assessment: "Senior leaders appear to doubt allied political cohesion." },
      ],
    },
  };
  assert.deepEqual(validateGameplayPayload("spyIntercept", payload), { valid: true, error: "" });
});

test("spy model cannot author confidence or raw Political Actor fields", () => {
  const withConfidence = {
    exchanges: [exchange],
    politicalAssessment: {
      summary: "Assessment",
      confidence: "High",
      findings: [{ topic: "Risk", assessment: "Leadership appears risk tolerant." }],
    },
  };
  const confidenceResult = validateGameplayPayload("spyIntercept", withConfidence);
  assert.equal(confidenceResult.valid, false);
  assert.match(confidenceResult.error, /confidence.*not allowed/i);

  const withRawTraits = {
    exchanges: [exchange],
    politicalAssessment: {
      summary: "Assessment",
      findings: [{ topic: "Risk", assessment: "Leadership appears risk tolerant.", riskTolerance: 78 }],
    },
  };
  const rawResult = validateGameplayPayload("spyIntercept", withRawTraits);
  assert.equal(rawResult.valid, false);
  assert.match(rawResult.error, /riskTolerance.*not allowed/i);
});
