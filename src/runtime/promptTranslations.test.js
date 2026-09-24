/*! Open Historia — translated prompt guidance tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/promptTranslations.test.js
//
// The language packs carry the default prompts' guidance passages translated
// (public/lang/prompts/<code>.json). A player who reads German gets them in
// German, in the Prompts tab and in what the AI receives, wherever the scenario
// has not written its own; the template around them (the placeholders, the
// output contracts the game parses) stays English. These pin that composition.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildGuidanceDefaults, composePrompt } from "../Game/AI/promptGuidance.js";
import {
  loadPromptTranslations,
  localizeGuidanceTree,
  localizedPassages,
  promptTranslationLanguage,
  promptTranslationsVersion,
  setPromptTranslations,
  subscribePromptTranslations,
  translateGuidancePassage,
  withoutLocalizedDefaults,
} from "./promptTranslations.js";

const DEFAULT_PROMPTS = JSON.parse(fs.readFileSync(new URL("../Game/AI/defaultPrompts.json", import.meta.url), "utf8"));
const DEFAULTS = buildGuidanceDefaults(DEFAULT_PROMPTS);
const [FIRST_ID, FIRST_PASSAGE] = Object.entries(DEFAULTS.advisor)[0];
const [SECOND_ID, SECOND_PASSAGE] = Object.entries(DEFAULTS.advisor)[1];

const reset = () => setPromptTranslations("en", {});

test("the defaults have advisor passages to translate", () => {
  assert.ok(FIRST_PASSAGE && SECOND_PASSAGE, "at least two advisor guidance passages");
  assert.ok(DEFAULT_PROMPTS.advisor.includes(FIRST_PASSAGE));
});

test("a passage is looked up by its English text; one the pack lacks stays English", () => {
  setPromptTranslations("de", { [FIRST_PASSAGE]: "[Deine Rolle] Du berätst ${PLAYER_POLITY}." });
  assert.equal(translateGuidancePassage(FIRST_PASSAGE), "[Deine Rolle] Du berätst ${PLAYER_POLITY}.");
  assert.equal(translateGuidancePassage(SECOND_PASSAGE), SECOND_PASSAGE);
  const localized = localizeGuidanceTree(DEFAULTS);
  assert.equal(localized.advisor[FIRST_ID], "[Deine Rolle] Du berätst ${PLAYER_POLITY}.");
  assert.equal(localized.advisor[SECOND_ID], SECOND_PASSAGE);
  assert.deepEqual(Object.keys(localized.tasks), Object.keys(DEFAULTS.tasks), "every section is still there");
  reset();
  assert.equal(localizeGuidanceTree(DEFAULTS), DEFAULTS, "English is the tree itself");
});

test("the AI receives the translated passage inside the English template", () => {
  setPromptTranslations("de", { [FIRST_PASSAGE]: "DEUTSCHE ANLEITUNG" });
  const localized = localizeGuidanceTree(DEFAULTS);
  const composed = composePrompt("advisor", DEFAULT_PROMPTS.advisor, localizedPassages(localized.advisor, {}));
  assert.equal(composed, DEFAULT_PROMPTS.advisor.replace(FIRST_PASSAGE, "DEUTSCHE ANLEITUNG"));
  reset();
});

test("an author's own passage wins over the translated default", () => {
  setPromptTranslations("de", { [FIRST_PASSAGE]: "DEUTSCHE ANLEITUNG", [SECOND_PASSAGE]: "ZWEITE ANLEITUNG" });
  const localized = localizeGuidanceTree(DEFAULTS);
  const composed = composePrompt("advisor", DEFAULT_PROMPTS.advisor, localizedPassages(localized.advisor, { [SECOND_ID]: "The author's words." }));
  assert.ok(composed.includes("DEUTSCHE ANLEITUNG"), "the passage they left alone is translated");
  assert.ok(composed.includes("The author's words."), "theirs is theirs, in whatever language");
  assert.ok(!composed.includes("ZWEITE ANLEITUNG"));
  reset();
});

test("an edit identical to the translated default is no edit", () => {
  setPromptTranslations("de", { [FIRST_PASSAGE]: "DEUTSCHE ANLEITUNG" });
  const localized = localizeGuidanceTree(DEFAULTS);
  const taskKey = Object.keys(DEFAULTS.tasks).find((key) => Object.keys(DEFAULTS.tasks[key]).length);
  const [taskId, taskPassage] = Object.entries(DEFAULTS.tasks[taskKey])[0];
  const kept = withoutLocalizedDefaults({
    advisor: { [FIRST_ID]: " DEUTSCHE ANLEITUNG ", [SECOND_ID]: "Rewritten." },
    leader: {},
    tasks: { [taskKey]: { [taskId]: taskPassage } },
  }, localized);
  assert.deepEqual(kept.advisor, { [SECOND_ID]: "Rewritten." });
  assert.deepEqual(kept.tasks, {}, "a task left with nothing is dropped, as normalizePackGuidance drops it");
  reset();
});

test("loading fetches the language's passages once and tells the listeners", async () => {
  reset();
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    return { ok: true, json: async () => ({ [FIRST_PASSAGE]: "PASSAGE EN FRANÇAIS" }) };
  };
  let heard = 0;
  const unsubscribe = subscribePromptTranslations(() => { heard += 1; });
  const before = promptTranslationsVersion();
  assert.equal(await loadPromptTranslations("fr", { fetchImpl }), true);
  assert.deepEqual(requested, ["/lang/prompts/fr.json"]);
  assert.equal(promptTranslationLanguage(), "fr");
  assert.equal(translateGuidancePassage(FIRST_PASSAGE), "PASSAGE EN FRANÇAIS");
  assert.ok(promptTranslationsVersion() > before, "the version moves, so composed prompts are rebuilt");
  assert.equal(heard, 1);
  assert.equal(await loadPromptTranslations("fr", { fetchImpl }), true, "already loaded");
  assert.equal(requested.length, 1, "no second request");
  unsubscribe();
  reset();
});

test("English, a missing pack or a failed request leave the English defaults", async () => {
  reset();
  let calls = 0;
  const missing = async () => { calls += 1; return { ok: false, json: async () => ({}) }; };
  const broken = async () => { calls += 1; throw new Error("offline"); };
  assert.equal(await loadPromptTranslations("en", { fetchImpl: missing }), false);
  assert.equal(calls, 0, "English needs no request");
  assert.equal(await loadPromptTranslations("sw", { fetchImpl: missing }), false);
  assert.equal(await loadPromptTranslations("de", { fetchImpl: broken }), false, "never throws");
  assert.equal(translateGuidancePassage(FIRST_PASSAGE), FIRST_PASSAGE);
});
