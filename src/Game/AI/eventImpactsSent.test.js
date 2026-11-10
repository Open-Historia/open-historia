// Run: node --test src/Game/AI/eventImpactsSent.test.js
//
// A time skip's events are sent with impacts required: optional, a live
// gemini-3.5-flash-lite skip left it off every event, the changes it had
// planned included; required, every event came back with one, {} where nothing
// changed. The answer is still read without it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getGameplayTool, validateGameplayPayload, withEventImpacts } from "./gameplaySchemas.js";

test("a skip's events are sent with impacts required", () => {
  const tool = getGameplayTool("jumpForward");
  assert.ok(!(tool.schema.properties.events.items.required ?? []).includes("impacts"), "the stored contract leaves it optional");
  const sent = withEventImpacts(tool);
  // (And its one-line digest, for the same reason: below.)
  assert.deepEqual(sent.schema.properties.events.items.required, [...(tool.schema.properties.events.items.required ?? []), "impacts", "digest"]);
  assert.equal(withEventImpacts(sent), sent, "asked twice, the same tool");
  const other = getGameplayTool("countryStatSheet");
  assert.equal(withEventImpacts(other), other, "a tool with no events is handed back as it is");
});

test("an event that changes nothing answers with an empty impacts, and one without is still read", () => {
  const answer = (event) => ({ events: [{ date: "2026-01-02", title: "A quiet week", description: "Nothing moved.", ...event }], summary: "x", stopDate: "2026-01-08" });
  assert.equal(validateGameplayPayload("jumpForward", answer({ impacts: {} })).valid, true);
  assert.equal(validateGameplayPayload("jumpForward", answer({})).valid, true);
});

test("every skip's tool goes through it", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /const shown = withEventImpacts\(withEventAudience\(grouped\)\);/);
});

test("every event of a skip is asked for its one-line digest, and an answer without one is still read", () => {
  const sent = withEventImpacts(getGameplayTool("jumpForward"));
  const event = sent.schema.properties.events.items;
  assert.ok(event.required.includes("digest"));
  assert.ok(event.properties.digest.description.includes("140"));
  const keys = Object.keys(event.properties);
  assert.equal(keys.indexOf("digest"), keys.indexOf("description") + 1, "written after the story it sums up");
  assert.equal(getGameplayTool("jumpForward").schema.properties.events.items.required.includes("digest"), false, "optional in the task's own schema");
});
