// Run: node --test src/runtime/aiTranslation.test.js
//
// "add an toggle to do translation with your api (still must require
// downloading the translation model, this option exists if they are unhappy
// with the models quality)" (the owner, 2026-11-06). Translate with my AI:
// where the switch is offered, how the queue is batched and cached, the model
// taking over when the AI fails, and no AI request at all with it off.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  AI_BATCH_MAX_CHARS,
  AI_BATCH_MAX_STRINGS,
  AI_TRANSLATION_SETTING,
  aiTranslationOffered,
  aiTranslationPrompt,
  createTranslationRouter,
  planAiBatch,
  readAiReply,
  readAiTranslationSetting,
} from "./aiTranslation.js";
import { MODEL_BATCH_STRINGS } from "./translationModels.js";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

// A stand-in AI that answers "<lang>:<string>" for each string, counting its
// requests; and a stand-in model that does the same as "model:<string>".
const fakeAi = (answer = (batch) => JSON.stringify(batch.map((text) => `ai:${text}`))) => {
  const calls = [];
  const askAi = async (batch) => {
    calls.push([...batch]);
    return answer(batch);
  };
  return { askAi, calls };
};
const fakeModel = () => {
  const calls = [];
  const askModel = async (batch) => {
    calls.push([...batch]);
    return batch.map((text) => `model:${text}`);
  };
  return { askModel, calls };
};

// Drives the router as translator.js does: a step at a time until the queue is
// empty, settling what each step settled.
const drain = async (router, strings) => {
  const pending = new Set(strings);
  const settled = new Map();
  for (let guard = 0; pending.size && guard < 100; guard += 1) {
    const result = await router.step(pending);
    for (const { source, text, by } of result.translated) {
      settled.set(source, { text, by });
      pending.delete(source);
    }
    for (const source of [...result.kept, ...result.unusable]) pending.delete(source);
  }
  return settled;
};

const names = (count, prefix = "Duchy of Place") => Array.from({ length: count }, (_, index) => `${prefix} ${String.fromCharCode(65 + (index % 26))}${Math.floor(index / 26) ? String.fromCharCode(65 + Math.floor(index / 26) % 26) : ""}`);

test("the switch is offered only where the translation model is, once the player downloaded it", () => {
  assert.equal(aiTranslationOffered({ language: "de", modelChoice: "yes" }), true, "a pack and a model: the model's content");
  assert.equal(aiTranslationOffered({ language: "da", modelChoice: "yes" }), true, "a model and no pack");
  assert.equal(aiTranslationOffered({ language: "pt-BR", modelChoice: "yes" }), true, "a language the Romance model serves");
  assert.equal(aiTranslationOffered({ language: "de", modelChoice: "no" }), false, "the model not downloaded: no switch");
  assert.equal(aiTranslationOffered({ language: "de", modelChoice: "" }), false, "not asked yet: no switch");
  assert.equal(aiTranslationOffered({ language: "ja", modelChoice: "yes" }), false, "a pack and no model: nothing the model translates");
  assert.equal(aiTranslationOffered({ language: "en", modelChoice: "yes" }), false, "English");
  assert.equal(aiTranslationOffered({}), false);
});

test("the switch is off unless the player turned it on", () => {
  assert.equal(readAiTranslationSetting(null), false);
  assert.equal(readAiTranslationSetting("0"), false);
  assert.equal(readAiTranslationSetting("1"), true);
  assert.equal(AI_TRANSLATION_SETTING, "i18n_translate_with_ai");
  assert.match(read("./mapSettings.js"), /translateWithAi: AI_TRANSLATION_SETTING,/, "a UI setting like the others");
});

test("Settings shows the switch under the interface language only where it is offered", () => {
  const settings = read("../Game/GameUI/settings.jsx");
  const toggle = settings.slice(settings.indexOf("const AiTranslationToggle"), settings.indexOf("// Steers prompts only"));
  assert.match(toggle, /aiTranslationAvailable\(\)/);
  assert.match(toggle, /if \(!offered\) return null;/, "no switch where there is no model");
  assert.match(toggle, /MAP_SETTING_KEYS\.translateWithAi/);
  assert.match(toggle, /label="Translate with my AI"/);
  assert.match(toggle, /spends its requests/, "the hint says it costs requests");
  assert.match(settings, /<AiTranslationToggle language=\{current\} \/>/, "beside the language picker");
  const translator = read("./translator.js");
  assert.match(translator, /aiTranslationOffered\(\{ language: code, modelChoice: modelChoice\(code\) \}\)/, "offered from the player's own download answer");
});

test("a batch holds up to 240 strings and 6,000 characters, and always one", () => {
  assert.equal(planAiBatch(names(500)).length, AI_BATCH_MAX_STRINGS);
  const long = Array.from({ length: 10 }, () => "x".repeat(1000));
  assert.equal(planAiBatch(long).length, AI_BATCH_MAX_CHARS / 1000);
  assert.deepEqual(planAiBatch(["y".repeat(9000), "z"]), ["y".repeat(9000)]);
  assert.deepEqual(planAiBatch([]), []);
});

test("the queue goes to the AI in as few requests as fit, never to the model", async () => {
  const ai = fakeAi();
  const model = fakeModel();
  const router = createTranslationRouter({ isAiOn: () => true, askAi: ai.askAi, askModel: model.askModel });
  const strings = names(300);
  const settled = await drain(router, strings);
  assert.equal(ai.calls.length, 2, "300 strings: two requests, not one each");
  assert.equal(ai.calls[0].length, 240);
  assert.equal(ai.calls[1].length, 60);
  assert.equal(model.calls.length, 0);
  assert.equal(settled.size, 300);
  assert.deepEqual(settled.get(strings[0]), { text: `ai:${strings[0]}`, by: "ai" });
});

test("a string is never asked of the AI twice: its answer is cached", async () => {
  const ai = fakeAi();
  const cache = new Map();
  const router = createTranslationRouter({ isAiOn: () => true, askAi: ai.askAi, askModel: fakeModel().askModel, cache });
  await drain(router, ["Kingdom of Wessex", "Duchy of Milan"]);
  assert.equal(cache.get("Kingdom of Wessex"), "ai:Kingdom of Wessex");
  const again = await drain(router, ["Kingdom of Wessex"]);
  assert.equal(ai.calls.length, 1, "answered from the cache");
  assert.deepEqual(again.get("Kingdom of Wessex"), { text: "ai:Kingdom of Wessex", by: "ai" });
  // A new session with the cache kept on the device asks nothing either.
  const next = fakeAi();
  const later = createTranslationRouter({ isAiOn: () => true, askAi: next.askAi, askModel: fakeModel().askModel, cache });
  await drain(later, ["Duchy of Milan"]);
  assert.equal(next.calls.length, 0);
});

test("a failed request falls back to the model for that batch, and is not asked again", async () => {
  for (const [why, answer] of [
    ["no key", () => { throw Object.assign(new Error("No AI model can answer"), { fallbackUnavailable: {} }); }],
    ["rate limit", () => { throw Object.assign(new Error("429 Too Many Requests"), { status: 429 }); }],
    ["refusal", () => "I can't help with that."],
    ["bad JSON", () => "[\"one\", \"two\""],
    ["wrong length", () => "[\"only one\"]"],
  ]) {
    const ai = fakeAi(answer);
    const model = fakeModel();
    const failures = [];
    let clock = 0;
    const router = createTranslationRouter({
      isAiOn: () => true, askAi: ai.askAi, askModel: model.askModel, now: () => clock, onAiFailure: (error) => failures.push(error),
    });
    const settled = await drain(router, ["Kingdom of Wessex", "Duchy of Milan"]);
    assert.equal(ai.calls.length, 1, `${why}: one request`);
    assert.equal(failures.length, 1, why);
    assert.deepEqual(model.calls, [["Kingdom of Wessex", "Duchy of Milan"]], `${why}: the model took the batch`);
    assert.deepEqual(settled.get("Duchy of Milan"), { text: "model:Duchy of Milan", by: "model" }, why);
    assert.equal(router.tried("Duchy of Milan"), true);
    clock += 120000;
  }
});

test("an answer that drops a number or runs on goes to the model; the rest is kept", async () => {
  const ai = fakeAi(() => JSON.stringify(["Königreich Wessex", "Armee", "Herzogtum Mailand"]));
  const model = fakeModel();
  const router = createTranslationRouter({ isAiOn: () => true, askAi: ai.askAi, askModel: model.askModel });
  const settled = await drain(router, ["Kingdom of Wessex", "Army of 1200", "Duchy of Milan"]);
  assert.equal(settled.get("Kingdom of Wessex").by, "ai");
  assert.equal(settled.get("Duchy of Milan").by, "ai");
  assert.deepEqual(settled.get("Army of 1200"), { text: "model:Army of 1200", by: "model" });
  assert.equal(ai.calls.length, 1);
});

test("a string the model translated before keeps that translation when the AI fails", async () => {
  const ai = fakeAi(() => { throw new Error("offline"); });
  const model = fakeModel();
  const router = createTranslationRouter({
    isAiOn: () => true, askAi: ai.askAi, askModel: model.askModel, known: (text) => (text === "Duchy of Milan" ? "Herzogtum Mailand" : undefined),
  });
  const pending = new Set(["Duchy of Milan"]);
  await router.step(pending);
  const result = await router.step(pending);
  assert.deepEqual(result.kept, ["Duchy of Milan"]);
  assert.equal(model.calls.length, 0, "no model run for what it already did");
});

test("after a failure the AI rests a minute (the model translates meanwhile); after three it is left for the session", async () => {
  let clock = 0;
  const ai = fakeAi(() => { throw new Error("503"); });
  const model = fakeModel();
  const router = createTranslationRouter({ isAiOn: () => true, askAi: ai.askAi, askModel: model.askModel, now: () => clock });
  await drain(router, ["Alpha One"]);
  assert.equal(router.aiAvailable(), false, "resting");
  await drain(router, ["Beta Two"]);
  assert.equal(ai.calls.length, 1, "no request while it rests");
  assert.deepEqual(model.calls.at(-1), ["Beta Two"]);
  clock += 60000;
  await drain(router, ["Gamma Three"]);
  clock += 60000;
  await drain(router, ["Delta Four"]);
  assert.equal(ai.calls.length, 3);
  assert.equal(router.halted(), true);
  clock += 10 * 60000;
  await drain(router, ["Epsilon Five"]);
  assert.equal(ai.calls.length, 3, "given up on for the session");
});

test("off, no AI request is ever made: the model translates in its own small batches", async () => {
  const ai = fakeAi();
  const model = fakeModel();
  const router = createTranslationRouter({ isAiOn: () => false, askAi: ai.askAi, askModel: model.askModel });
  const settled = await drain(router, names(20));
  assert.equal(ai.calls.length, 0);
  assert.equal(model.calls[0].length, MODEL_BATCH_STRINGS);
  assert.equal(settled.size, 20);
  assert.ok([...settled.values()].every((entry) => entry.by === "model"));
});

test("turned off part-way, the rest of the queue goes to the model at once", async () => {
  let on = true;
  const ai = fakeAi();
  const model = fakeModel();
  const router = createTranslationRouter({ isAiOn: () => on, askAi: ai.askAi, askModel: model.askModel });
  const pending = new Set(names(300));
  await router.step(pending);
  assert.equal(ai.calls.length, 1);
  on = false;
  const result = await router.step(new Set([...pending].slice(240)));
  assert.equal(result.asked, "model");
  assert.equal(ai.calls.length, 1);
});

test("the prompt asks for a JSON array of the batch's length, content only where a pack has the interface", () => {
  const packed = aiTranslationPrompt({ language: "de", name: "German", packed: true, count: 3 });
  assert.match(packed, /into German \(de\)/);
  assert.match(packed, /JSON array of 3 strings/);
  assert.match(packed, /the game's content/);
  assert.match(aiTranslationPrompt({ language: "da", name: "Danish", packed: false, count: 1 }), /its interface and its content/);
});

test("a reply is read by position, only when it has one entry per string", () => {
  assert.deepEqual(readAiReply("```json\n[\"Wessex\", \"Mailand\"]\n```", ["Wessex", "Milan"]), {
    pairs: [["Wessex", "Wessex"], ["Milan", "Mailand"]], rejected: [],
  });
  assert.throws(() => readAiReply("[\"Wessex\"]", ["Wessex", "Milan"]), /1 entries for 2 strings/);
  assert.throws(() => readAiReply("no", ["Wessex"]), /not a JSON array/);
  assert.deepEqual(readAiReply("[\"\", 5]", ["Wessex", "Milan"]).rejected, ["Wessex", "Milan"]);
});

// A translation is a request nobody pressed anything for: background work,
// under the day's fixed cap (requestBudget.js BACKGROUND_DAILY_CAP), like idle
// diplomacy. Until 2026-11-09 it was marked background and never asked the
// allowance, so a page of new text could spend the whole day's cap.
test("past the day's background allowance the model translates, and the AI is not asked or given up on", async () => {
  const ai = fakeAi();
  const model = fakeModel();
  let allowed = false;
  const router = createTranslationRouter({ isAiOn: () => true, mayAskAi: async () => allowed, askAi: ai.askAi, askModel: model.askModel });
  const refused = await router.step(["Wessex", "Milan"]);
  assert.equal(ai.calls.length, 0, "no request past the allowance");
  assert.equal(refused.asked, "model");
  assert.deepEqual(refused.translated.map((entry) => entry.by), ["model", "model"]);
  assert.equal(router.halted(), false, "a spent allowance is no failure of the AI");
  assert.equal(router.tried("Wessex"), false);
  allowed = true;
  const asked = await router.step(["Paris"]);
  assert.equal(ai.calls.length, 1);
  assert.equal(asked.asked, "ai");
});

test("the translator asks the background allowance before every request to the AI", () => {
  const translator = read("./translator.js");
  const gate = translator.slice(translator.indexOf("const mayAskAi = async"), translator.indexOf("const aiFailed ="));
  assert.match(gate, /import\("\.\.\/Game\/AI\/requestBudget\.js"\)/, "loaded only on the AI's path");
  assert.match(gate, /return backgroundAiAllowance\(\)\.allowed;/);
  assert.match(translator, /isAiOn: \(\) => run === generation && aiShown && aiInUse\(\),\n\s*mayAskAi,\n\s*askAi,/);
});

test("the translator reaches the AI only from inside the switch's path", () => {
  const translator = read("./translator.js");
  assert.doesNotMatch(translator, /^import[^;]*Game\/AI/m, "no AI module is imported up front");
  const askAi = translator.slice(translator.indexOf("const askAi = async"), translator.indexOf("const aiFailed ="));
  assert.match(askAi, /import\("\.\.\/Game\/AI\/main\.jsx"\)/);
  assert.match(askAi, /taskKey: "translation"/);
  assert.match(translator, /isAiOn: \(\) => run === generation && aiShown && aiInUse\(\)/);
  assert.match(translator, /const aiInUse = \(\) => language !== DEFAULT_LANGUAGE && aiSettingOn\(\)/, "the switch is read before every request");
  // The AI's translations are kept on this device, never sent to the server's
  // pack, which holds the model's.
  const apply = translator.slice(translator.indexOf("const applyStep ="), translator.indexOf("const processQueue ="));
  assert.match(apply, /if \(by === "ai"\) \{\s*aiEntries\.set\(source, text\);/);
  assert.doesNotMatch(apply.slice(0, apply.indexOf("} else {")), /unsyncedEntries/);
});
