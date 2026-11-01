/*! Open Historia — a prompt names the language the player reads: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/promptLanguage.test.js
//
// "After the update, the AI suggestions are now coming to me in English instead
// of Arabic" (a player, Android, 2026-10-29). Every call ends with the
// interface's language directive (main.jsx callAI, i18n.js languageDirective),
// but the prompts themselves say "write in ${language}", and that was the save's
// language: "English" unless the scenario's author changed it. The suggested
// actions were told English three times and Arabic once. What has to hold:
//   - ${language} is the language the player reads, whatever the save says;
//   - a player who reads English still gets the save's own language;
//   - the advisor and the leaders name the chat language.
import test from "node:test";
import assert from "node:assert/strict";

import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import { buildPromptContext, renderTemplate } from "./promptContext.js";
import { languageDirective, readingLanguageName } from "../../runtime/i18n.js";

const withStorage = async (values, run) => {
  const had = Object.hasOwn(globalThis, "localStorage");
  const previous = globalThis.localStorage;
  const store = new Map(Object.entries(values));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  try {
    return await run();
  } finally {
    if (had) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
};

const bundleIn = (language) => ({
  game: { country: "Russia", gameDate: "2026-01-15", round: 4 },
  world: { ...(language ? { language } : {}), simulationRules: "Rules.", startingTimelineText: "Briefing." },
  events: [],
  chats: [],
  actions: [],
});

const languageOf = async (bundle, options = {}) =>
  (await buildPromptContext(bundle, { requiredKeys: ["language"], ...options })).language;

test("an Arabic player's suggested actions are asked for in Arabic, on a save that says English", async () => {
  await withStorage({ ui_language: "ar" }, async () => {
    for (const saved of ["English", ""]) {
      const language = await languageOf(bundleIn(saved), { taskKey: "actions" });
      assert.equal(language, "Arabic", `save language ${JSON.stringify(saved)}`);
      const prompt = `${renderTemplate(defaultPrompts.tasks.actions, { language })}\n\n${languageDirective()}`;
      assert.ok(!/language of English|string in English/.test(prompt), "no line asks for English");
      assert.equal(prompt.match(/language of Arabic|string in Arabic/g)?.length, 3, "the template's three lines say Arabic");
      assert.match(prompt, /Write ALL natural-language text in Arabic/, "as the directive does");
    }
  });
});

test("a player who reads English gets the save's own language", async () => {
  await withStorage({}, async () => {
    assert.equal(await languageOf(bundleIn("French")), "French");
    assert.equal(await languageOf(bundleIn("")), "English");
  });
});

test("the advisor and the leaders name the chat language", async () => {
  await withStorage({ ui_language: "ar", ai_chat_language: "de" }, async () => {
    assert.equal(await languageOf(bundleIn("English"), { conversation: true }), "German");
    assert.equal(await languageOf(bundleIn("English")), "Arabic", "a task still names the interface's");
  });
});

test("readingLanguageName: the reader's language first, the save's for an English reader", async () => {
  await withStorage({ ui_language: "ru" }, () => assert.equal(readingLanguageName("Spanish"), "Russian"));
  await withStorage({}, () => assert.equal(readingLanguageName("  Spanish "), "Spanish"));
  await withStorage({}, () => assert.equal(readingLanguageName(undefined), "English"));
  await withStorage({ ai_chat_language: "fr" }, () => assert.equal(readingLanguageName("", { chat: true }), "French"));
});
