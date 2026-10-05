/*! Open Historia — a first reading is one request: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/firstReadingCombined.test.js
//
// A polity with neither a stat sheet nor a rated intelligence service used to
// cost two background requests: the sheet, then a separate assessment that saw
// the same dossier. The sheet's request now carries the assessment's fields,
// last, so the rating is written after the numbers it rests on. Only the tool
// shown to the model changes; the sheet's own schema, and every other request
// that uses it, are as they were.

import test from "node:test";
import assert from "node:assert/strict";

import {
    GAMEPLAY_SCHEMAS,
    INTELLIGENCE_RATING_FIELD,
    getGameplayTool,
    getGameplayToolForCustomStatSheet,
    withIntelligenceRating,
} from "./gameplaySchemas.js";
import { toGeminiSchema } from "./geminiSchema.js";

test("the standard sheet's tool gains the rating as its last, required field", () => {
    const base = getGameplayTool("countryStatSheet");
    const tool = withIntelligenceRating(base);
    const keys = Object.keys(tool.schema.properties);
    assert.equal(keys.at(-1), INTELLIGENCE_RATING_FIELD);
    assert.deepEqual(keys.slice(0, -1), Object.keys(base.schema.properties));
    assert.ok(tool.schema.required.includes(INTELLIGENCE_RATING_FIELD));
    for (const key of base.schema.required) assert.ok(tool.schema.required.includes(key), key);
    const rating = tool.schema.properties[INTELLIGENCE_RATING_FIELD];
    assert.equal(rating.properties.intelligence.type, "number");
    assert.deepEqual(rating.required, ["intelligence", "rationale"]);
    assert.equal(tool.name, base.name);
});

test("a scenario-defined sheet's tool gains it too, after its own values", () => {
    const rows = [{ key: "timber", label: "Timber", kind: "index", minimum: 0, maximum: 100, description: "Usable timber supply." }];
    const tool = withIntelligenceRating(getGameplayToolForCustomStatSheet("countryStatSheet", rows, { custom: true }));
    assert.deepEqual(Object.keys(tool.schema.properties), ["customStats", INTELLIGENCE_RATING_FIELD]);
    assert.deepEqual(tool.schema.required, ["customStats", INTELLIGENCE_RATING_FIELD]);
});

test("nothing else changes: the base tool and the sheet schema never carry the rating", () => {
    const base = getGameplayTool("countryStatSheet");
    withIntelligenceRating(base);
    assert.equal(base.schema.properties[INTELLIGENCE_RATING_FIELD], undefined);
    assert.equal(GAMEPLAY_SCHEMAS.countryStatSheet.properties[INTELLIGENCE_RATING_FIELD], undefined);
    assert.equal(withIntelligenceRating(null), null);
});

test("the combined tool converts to a schema Gemini accepts", () => {
    const converted = toGeminiSchema(withIntelligenceRating(getGameplayTool("countryStatSheet")).schema);
    assert.equal(converted.properties[INTELLIGENCE_RATING_FIELD].type, "object");
    assert.ok(!JSON.stringify(converted).includes("additionalProperties"));
});
