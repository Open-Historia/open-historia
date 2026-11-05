import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_ACTIONS_SCHEMA } from "./gameplaySchemas.js";
import { toGeminiSchema } from "./geminiSchema.js";

test("institution lifecycle decisions stay out of Gemini's already-wide chat action union", () => {
  const action = CHAT_ACTIONS_SCHEMA.properties.actions.items;
  assert.ok(!action.properties.type.enum.includes("institution_lifecycle_response"));
  assert.equal(action.properties.lifecycleCaseId, undefined);
  assert.equal(action.properties.lifecycleDecision, undefined);
  assert.equal(action.properties.lifecycleTerms, undefined);
  assert.equal(CHAT_ACTIONS_SCHEMA.properties.lifecycleResponsesJson.type, "string");
  assert.match(CHAT_ACTIONS_SCHEMA.properties.lifecycleResponsesJson.description, /accept, reject, seek-observer, request-terms, or delay/);

  const converted = toGeminiSchema(CHAT_ACTIONS_SCHEMA);
  assert.equal(converted.properties.lifecycleResponsesJson.type, "string");
  assert.ok(Object.keys(converted.properties.actions.items.properties).length <= 21, "keep the Gemini chat action object at the proven pre-lifecycle width");
});
