/*! Open Historia — a scene that ends brings its own record: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/interactiveExecutorRecord.test.js
//
// A scene the model resolved cost a second request (interactiveSummary) only to
// condense what the resolving answer had just concluded. The executor now
// writes the record with the move. The fields are optional, so an answer that
// leaves them out is still a good move — it only falls back to that request —
// and a beat never fails over them.

import test from "node:test";
import assert from "node:assert/strict";

import { getGameplayTool, validateGameplayPayload } from "./gameplaySchemas.js";

const schema = getGameplayTool("interactiveExecutor").schema;

test("the executor may write the finished scene's record, and is never made to", () => {
    for (const key of ["recordTitle", "recordDescription", "recordImportance"]) {
        assert.equal(schema.properties[key]?.type, "string", key);
        assert.equal(schema.required.includes(key), false, key);
    }
});

test("a resolving answer is valid with its record and without it", () => {
    const resolved = { summary: "The envoys sign.", resolved: true, nextChoices: [] };
    assert.equal(validateGameplayPayload("interactiveExecutor", {
        ...resolved,
        recordTitle: "Treaty of Riga signed",
        recordDescription: "After three days of talks the envoys agreed the border.",
        recordImportance: "major",
    }).valid, true);
    assert.equal(validateGameplayPayload("interactiveExecutor", resolved).valid, true);
});

test("a move that goes on is unaffected by the record fields", () => {
    const going = { summary: "The envoy hesitates.", resolved: false, nextChoices: ["Press him", "Wait"] };
    assert.equal(validateGameplayPayload("interactiveExecutor", going).valid, true);
    assert.equal(validateGameplayPayload("interactiveExecutor", { ...going, recordTitle: "", recordDescription: "" }).valid, true);
});
