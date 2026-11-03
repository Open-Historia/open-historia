import test from "node:test";
import assert from "node:assert/strict";
import { describeUnparseableStructuredAnswer } from "./structuredAnswerFailure.js";
import { REASONING_ONLY_MESSAGE, OUTPUT_LIMIT_MESSAGE } from "./providerErrors.js";

test("July 29 malformed JSON is reported as a malformed answer, never as reasoning only", () => {
  const rawText = `{"events":[{"date":"2016-05-31","title":"Overtime changes",
  - playerRelated: false,
  "description":"Unquantified effect."}]}`;
  const long = rawText + " x".repeat(1000);
  const message = describeUnparseableStructuredAnswer({ rawText: long });
  assert.match(message, /malformed or incomplete JSON/);
  assert.notEqual(message, REASONING_ONLY_MESSAGE);
});

test("reasoning-only and output-limit paths retain their distinct labels", () => {
  assert.equal(describeUnparseableStructuredAnswer({ reasoningOnly: true }),
    REASONING_ONLY_MESSAGE);
  assert.equal(describeUnparseableStructuredAnswer({ rawText: "{",
    cutAtOutputLimit: true }), OUTPUT_LIMIT_MESSAGE);
  assert.match(describeUnparseableStructuredAnswer({ rawText: "thinking through many assumptions" }),
    /returned text/);
  assert.match(describeUnparseableStructuredAnswer({}), /did not contain parseable JSON/);
});
