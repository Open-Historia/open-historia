/*! Open Historia — demand check schema tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/demandCheckSchema.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { DEMAND_CHECK_OUTCOMES } from "../../runtime/demandCheck.js";
import { DEMAND_CHECK_SCHEMA, getGameplayTool } from "./gameplaySchemas.js";

// The schema used to repeat the outcomes as its own literal list. An outcome
// added to demandCheck.js alone would have made every demandCheck answer that
// used it fail validation — a real request thrown away.
test("the demandCheck schema offers exactly the outcomes demandCheck.js interprets", () => {
  assert.deepEqual(DEMAND_CHECK_SCHEMA.properties.outcome.enum, [...DEMAND_CHECK_OUTCOMES]);
  const tool = getGameplayTool("demandCheck");
  assert.deepEqual(tool.schema.properties.outcome.enum, [...DEMAND_CHECK_OUTCOMES]);
});

test("the schema's enum is a copy, not the frozen list itself", () => {
  assert.notEqual(DEMAND_CHECK_SCHEMA.properties.outcome.enum, DEMAND_CHECK_OUTCOMES);
  assert.equal(Object.isFrozen(DEMAND_CHECK_SCHEMA.properties.outcome.enum), false);
});
