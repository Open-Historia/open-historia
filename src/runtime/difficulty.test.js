/*! Open Historia — difficulty in the prompts: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/difficulty.test.js
//
// Difficulty 2.0 writes one directive per scope. A leader used to get two
// difficulty instructions that disagreed: the pre-2.0 paragraph in its template
// (${DIFFICULTY_DESCRIPTION_CHATS}) and the SIMULATION directive appended after
// it, never the diplomacy one. A time skip likewise carried the old "jump"
// paragraph in its template and the simulation directive in its live records.
// What has to hold: each template's placeholder now renders the scoped 2.0
// directive, so the leader reads the diplomacy directive once and the skip the
// simulation directive once, and the old wording is gone.
import test from "node:test";
import assert from "node:assert/strict";

import defaultPrompts from "../Game/AI/defaultPrompts.json" with { type: "json" };
import { DIFFICULTY_LEVELS, difficultyDirective, difficultyMeta, difficultyPassage } from "./difficulty.js";
import { buildDifficultyGuidance, renderTemplate, resolveHelperValues } from "../Game/AI/promptContext.js";

const count = (text, needle) => text.split(needle).length - 1;

const render = (template, difficulty) => {
  const variables = {
    difficultyGuidanceChats: buildDifficultyGuidance(difficulty, "chats"),
    difficultyGuidanceJumpForward: buildDifficultyGuidance(difficulty, "jump"),
  };
  return renderTemplate(template, { ...variables, ...resolveHelperValues(defaultPrompts.helpers, variables) });
};

test("a leader is told the diplomacy directive once, and nothing of the simulation one", () => {
  for (const level of DIFFICULTY_LEVELS) {
    const prompt = render(defaultPrompts.leader, level.id);
    assert.equal(count(prompt, level.directives.diplomacy), 1, level.id);
    assert.equal(count(prompt, level.directives.simulation), 0, level.id);
    assert.equal(count(prompt, `The difficulty is ${level.label}.`), 1, level.id);
  }
});

test("a time skip is told the simulation directive once", () => {
  for (const task of ["jumpForward", "autoJumpForward"]) {
    for (const level of DIFFICULTY_LEVELS) {
      const prompt = render(defaultPrompts.tasks[task], level.id);
      assert.equal(count(prompt, level.directives.simulation), 1, `${task} ${level.id}`);
      assert.equal(count(prompt, level.directives.diplomacy), 0, `${task} ${level.id}`);
    }
  }
});

test("the pre-2.0 difficulty paragraphs are gone", () => {
  const prompt = render(defaultPrompts.leader, "impossible") + render(defaultPrompts.tasks.jumpForward, "impossible");
  assert.doesNotMatch(prompt, /almost never break the player's way/);
  assert.doesNotMatch(prompt, /should scale with the difficulty/);
  assert.match(prompt, /never anti-player scripting/);
});

test("the passage and the directive say the same thing, and an old or blank setting is medium", () => {
  const passage = difficultyPassage("hard", "diplomacy");
  const directive = difficultyDirective("hard", "diplomacy");
  assert.ok(directive.endsWith(difficultyMeta("hard").directives.diplomacy));
  assert.ok(passage.endsWith(difficultyMeta("hard").directives.diplomacy));
  assert.match(directive, /^\[Difficulty 2\.0 — Hard\]/);
  assert.equal(difficultyPassage("standard"), difficultyPassage("medium"));
  assert.equal(difficultyPassage(""), difficultyPassage("medium", "simulation"));
  assert.equal(difficultyPassage("hard", "nonsense"), difficultyPassage("hard", "simulation"));
});
