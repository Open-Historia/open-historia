/*! Open Historia — first-reading intelligence assessment tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/intelligenceAssessment.test.js
//
// Every service used to sit on DEFAULT_INTELLIGENCE until a turn happened to
// move it; the first reading (gameplay.js assessIntelligenceService) asks the
// model the moment a service matters. The write itself needs a store, so what
// is pinned here is the mechanical chain around it: the task has a prompt in
// the defaults (which normalizePromptPack hands to every campaign, frozen packs
// included), a tool the provider is shown, a schema that keeps the answer to a
// rating plus its reasons, and the helpers that decide whether a service still
// needs its reading and what number goes into the world.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { getGameplayTool, validateGameplayPayload } from "./gameplaySchemas.js";
import { DEFAULT_INTELLIGENCE, intelligenceOf, isIntelligenceRated, normalizeIntelligenceRating } from "../../runtime/spycraft.js";

const defaults = JSON.parse(fs.readFileSync(new URL("./defaultPrompts.json", import.meta.url), "utf8"));

test("the assessment has a default prompt, so every campaign receives it", () => {
  const template = defaults.tasks.intelligenceAssessment;
  assert.equal(typeof template, "string");
  assert.match(template, /\$\{targetPolity\}/, "the prompt has to name the polity being rated");
  assert.match(template, /0-100/);
  assert.match(template, /required tool/i);
});

test("the provider is shown a tool for it", () => {
  const tool = getGameplayTool("intelligenceAssessment");
  assert.equal(tool?.name, "submit_intelligence_assessment");
  assert.deepEqual(tool.schema.required, ["intelligence", "rationale"]);
});

test("the schema keeps the answer to a rating and its reasons", () => {
  const ok = validateGameplayPayload("intelligenceAssessment", { intelligence: 72, service: "MI6", rationale: "Global reach, long tradition." });
  assert.equal(ok.valid, true, ok.error);
  assert.equal(validateGameplayPayload("intelligenceAssessment", { intelligence: 72 }).valid, false, "a bare number is not an assessment");
  assert.equal(validateGameplayPayload("intelligenceAssessment", { intelligence: "high", rationale: "x" }).valid, false);
  assert.equal(validateGameplayPayload("intelligenceAssessment", { intelligence: 50, rationale: "x", events: [] }).valid, false, "a stray field is a model answering the wrong task");
});

test("normalizeIntelligenceRating clamps, rounds and refuses junk", () => {
  assert.equal(normalizeIntelligenceRating(72.4), 72);
  assert.equal(normalizeIntelligenceRating("88"), 88);
  assert.equal(normalizeIntelligenceRating(140), 100);
  assert.equal(normalizeIntelligenceRating(-3), 0);
  assert.equal(normalizeIntelligenceRating(0), 0, "zero is a rating, not junk");
  for (const junk of [null, undefined, "", "strong", NaN, {}, []]) assert.equal(normalizeIntelligenceRating(junk), null);
});

test("isIntelligenceRated is about the record, not the default the maths use", () => {
  const world = { intelligence: { France: 0, Prussia: 61 } };
  assert.equal(isIntelligenceRated(world, "Prussia"), true);
  assert.equal(isIntelligenceRated(world, "France"), true, "a rating of 0 is still a rating");
  assert.equal(isIntelligenceRated(world, " Prussia "), true, "keys are trimmed like intelligenceOf trims them");
  assert.equal(isIntelligenceRated(world, "Bavaria"), false);
  assert.equal(intelligenceOf(world, "Bavaria"), DEFAULT_INTELLIGENCE, "unrated still reads as ordinary for the maths");
  assert.equal(isIntelligenceRated({}, "Bavaria"), false);
  assert.equal(isIntelligenceRated(null, "Bavaria"), false);
});
