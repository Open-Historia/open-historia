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

import { SCENE_MAP_CHANGED_FIELD, getGameplayTool, validateGameplayPayload } from "./gameplaySchemas.js";

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

// Whether the finished scene changed the map rides in the answer that ends it,
// so the Scene's map check (a request) is asked only when that answer says so.
// One optional boolean, last, after every field the scene and its record need.
test("the answer that ends a scene may say it changed the map: one optional boolean, last", () => {
    const summary = getGameplayTool("interactiveSummary").schema;
    for (const [tool, key] of [[schema, SCENE_MAP_CHANGED_FIELD.record], [summary, SCENE_MAP_CHANGED_FIELD.summary]]) {
        assert.equal(tool.properties[key]?.type, "boolean", key);
        assert.equal(tool.required.includes(key), false, key);
        assert.equal(Object.keys(tool.properties).at(-1), key, `${key} comes after the load-bearing fields`);
        assert.match(tool.properties[key].description, /forces.*ground.*built/);
    }
    assert.deepEqual(SCENE_MAP_CHANGED_FIELD, { record: "recordMapChanged", summary: "mapChanged" });
    // Small: what each adds to its schema, the property and its comma.
    const cost = (tool, key) => JSON.stringify({ [key]: tool.properties[key] }).length - 1;
    assert.ok(cost(schema, "recordMapChanged") <= 220, String(cost(schema, "recordMapChanged")));
    assert.ok(cost(summary, "mapChanged") <= 190, String(cost(summary, "mapChanged")));
});

test("a resolving answer and a summary are valid with the map field and without it", () => {
    const resolved = { summary: "The column takes the bridge.", resolved: true, nextChoices: [], recordTitle: "Bridge at Kherson taken", recordDescription: "The column took the bridge.", recordImportance: "major" };
    assert.equal(validateGameplayPayload("interactiveExecutor", { ...resolved, recordMapChanged: true }).valid, true);
    assert.equal(validateGameplayPayload("interactiveExecutor", { ...resolved, recordMapChanged: false }).valid, true);
    assert.equal(validateGameplayPayload("interactiveExecutor", resolved).valid, true);
    const condensed = { title: "Le pont de Kherson est pris", description: "La colonne a pris le pont.", importance: "major" };
    assert.equal(validateGameplayPayload("interactiveSummary", { ...condensed, mapChanged: true }).valid, true);
    assert.equal(validateGameplayPayload("interactiveSummary", condensed).valid, true);
});
