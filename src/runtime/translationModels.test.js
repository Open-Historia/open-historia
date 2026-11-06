// Run: node --test src/runtime/translationModels.test.js
//
// "can you also get a translator model to replace the ai requests for
// translation?" and "remove the option to use your api. it should make you use
// the model if you want to translate the game at all" (the owner, 2026-11-05).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { SHIPPED_PACK_LANGUAGES } from "./i18n.js";
import {
  MODEL_BATCH_CHARS,
  MODEL_BATCH_STRINGS,
  MIRROR,
  MODEL_FILES,
  TRANSLATION_MODELS,
  acceptModelOutput,
  formatModelSize,
  groupByLength,
  modelChoiceKey,
  modelFileUrl,
  modelSources,
  planModelBatch,
  readModelChoice,
  sourceFileUrl,
  splitForModel,
  translationModelFor,
} from "./translationModels.js";

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a model only where one reads right; the rest of the 22 have their packs alone", () => {
  const covered = SHIPPED_PACK_LANGUAGES.filter((code) => translationModelFor(code));
  assert.deepEqual(covered, ["ar", "de", "es", "fr", "id", "it", "nl", "pt", "ru", "sv", "zh"]);
  for (const code of ["bn", "fa", "hi", "ja", "ko", "pl", "th", "tr", "uk", "ur", "vi"]) {
    assert.equal(translationModelFor(code), null, code);
  }
  assert.equal(translationModelFor("en"), null, "English needs none");
  assert.equal(translationModelFor("pt-BR"), TRANSLATION_MODELS.pt, "a regional code is its language");
  assert.equal(translationModelFor(" DE "), TRANSLATION_MODELS.de);
  // Those without a pack, whose whole interface would otherwise be AI requests.
  for (const code of ["da", "hu", "ro", "cs", "fi", "lv", "lt", "sk", "et", "el", "he", "ga", "mt"]) assert.ok(translationModelFor(code), code);
});

test("every model is pinned, int8, 100 to 150 MB, Opus-MT as Transformers.js reads it", () => {
  for (const [code, entry] of Object.entries(TRANSLATION_MODELS)) {
    assert.match(entry.repo, /^(Xenova|Open-Historia)\/opus-mt-en-[A-Za-z]+$/, code);
    assert.equal(entry.mirrorOnly, entry.repo.startsWith("Open-Historia/"), `${code}: only the converted ones are on the mirror alone`);
    assert.match(entry.revision, /^[0-9a-f]{40}$/, `${code}: a commit, so the files never change under the cache`);
    assert.ok(entry.bytes > 100e6 && entry.bytes < 150e6, `${code}: ${entry.bytes}`);
  }
  assert.ok(MODEL_FILES.includes("onnx/encoder_model_quantized.onnx"));
  assert.ok(MODEL_FILES.includes("onnx/decoder_model_merged_quantized.onnx"));
  assert.equal(
    modelFileUrl(TRANSLATION_MODELS.de, "tokenizer.json"),
    "https://huggingface.co/Xenova/opus-mt-en-de/resolve/1ca130c44c4c5441ef16d48aae521a424ab644f7/tokenizer.json",
  );
  assert.equal(formatModelSize(TRANSLATION_MODELS.de.bytes), "112 MB");
  // The multi-language models are told which language: the pack's Portuguese is Brazil's.
  assert.equal(TRANSLATION_MODELS.pt.token, ">>pt_BR<<");
  assert.equal(TRANSLATION_MODELS.zh.token, ">>cmn_Hans<<");
  assert.equal(TRANSLATION_MODELS.ar.token, ">>ara<<");
  assert.equal(TRANSLATION_MODELS.de.token, "");
  assert.equal(TRANSLATION_MODELS.lv.token, ">>lav<<");
  assert.equal(TRANSLATION_MODELS.lt.token, ">>lit<<");
  assert.equal(TRANSLATION_MODELS.sv.token, ">>swe<<");
  assert.equal(TRANSLATION_MODELS.lv.repo, TRANSLATION_MODELS.lt.repo, "Latvian and Lithuanian share the Baltic model");
});

test("a model converted for the game is read from the scenario repository; the rest from Hugging Face alone", () => {
  assert.match(MIRROR.commit, /^[0-9a-f]{40}$/, "the mirror is read at a commit");
  assert.equal(MIRROR.host, "https://raw.githubusercontent.com/", "raw files answer any origin; release downloads do not");
  const de = modelSources(TRANSLATION_MODELS.de);
  assert.equal(de.length, 1, "Hugging Face only");
  assert.equal(
    sourceFileUrl(de[0], "tokenizer.json"),
    "https://huggingface.co/Xenova/opus-mt-en-de/resolve/1ca130c44c4c5441ef16d48aae521a424ab644f7/tokenizer.json",
    "the same URL, and so the same cache key, as before",
  );
  const lv = modelSources(TRANSLATION_MODELS.lv);
  assert.equal(lv.length, 1, "the mirror only");
  assert.equal(TRANSLATION_MODELS.lv.revision, MIRROR.commit);
  assert.equal(
    modelFileUrl(TRANSLATION_MODELS.lv, "tokenizer.json"),
    `https://raw.githubusercontent.com/Open-Historia/Open-historia-scenarios/${MIRROR.commit}/models/opus-mt-en-bat/tokenizer.json`,
  );
  // The template Transformers.js fills (env.remotePathTemplate) is the same path.
  for (const source of [...de, ...lv]) {
    const filled = `${source.host}${source.path.replaceAll("{model}", source.model).replaceAll("{revision}", source.revision)}`;
    assert.equal(sourceFileUrl(source, "config.json"), `${filled}config.json`);
  }
});

test("the player's answer is kept per language", () => {
  assert.equal(readModelChoice("yes"), "yes");
  assert.equal(readModelChoice("no"), "no");
  assert.equal(readModelChoice("maybe"), "");
  assert.equal(readModelChoice(null), "");
  assert.equal(modelChoiceKey("pt-BR"), "oh:translation-model:pt");
});

test("small batches bounded by count and characters; rows grouped by length", () => {
  const names = Array.from({ length: 30 }, (_, index) => `Region ${index}`);
  assert.equal(planModelBatch(names).length, MODEL_BATCH_STRINGS);
  const prose = Array.from({ length: 5 }, () => "x".repeat(500));
  assert.equal(planModelBatch(prose).length, Math.floor(MODEL_BATCH_CHARS / 500));
  assert.deepEqual(planModelBatch(["y".repeat(5000)]), ["y".repeat(5000)], "one long string still goes, alone");
  assert.deepEqual(planModelBatch([]), []);
  const strings = ["a much longer string than the rest", "ab", "abc", "a medium string", "x"];
  const groups = groupByLength(strings, { maxRows: 2 });
  assert.deepEqual(groups, [[4, 1], [2, 3], [0]]);
  assert.deepEqual(groups.flat().sort(), [0, 1, 2, 3, 4], "every string, once");
});

test("a long string is cut into its lines and sentences and put back with the same breaks", () => {
  const short = splitForModel("Kingdom of Bavaria");
  assert.deepEqual(short.pieces, ["Kingdom of Bavaria"]);
  assert.equal(short.join(["Königreich Bayern"]), "Königreich Bayern");

  const lines = splitForModel("First line.\n\nSecond line.");
  assert.deepEqual(lines.pieces, ["First line.", "Second line."]);
  assert.equal(lines.join(["Erste.", "Zweite."]), "Erste.\n\nZweite.");

  const sentence = "A sentence that is long enough. ";
  const long = splitForModel(`${sentence.repeat(3)}End!`, { maxChars: 40 });
  assert.deepEqual(long.pieces, ["A sentence that is long enough.", "A sentence that is long enough.", "A sentence that is long enough.", "End!"]);
  assert.equal(long.join(["1.", "2.", "3.", "4!"]), "1. 2. 3. 4!");

  const padded = splitForModel("  Name  ");
  assert.equal(padded.join(["Nom"]), "  Nom  ", "its own whitespace is kept");
  assert.deepEqual(splitForModel("").pieces, []);
});

test("an answer that ran on, echoed its token or lost a number or a slot is refused", () => {
  assert.equal(acceptModelOutput("Kingdom of Bavaria", " Königreich Bayern "), "Königreich Bayern");
  assert.equal(acceptModelOutput("Kingdom of Bavaria", ""), null);
  assert.equal(acceptModelOutput("Kingdom of Bavaria", "Reino de Baviera - - - - - - - - - -"), null, "ran on");
  assert.equal(acceptModelOutput("Ottoman Empire", "奥斯曼帝国 豆 豆腐 豆腐 豆腐 豆腐 豆腐 豆腐"), null, "ran on");
  assert.equal(acceptModelOutput("Grain reserves", ">>pt_BR<< Réserves de céréales"), null, "its language token");
  assert.equal(acceptModelOutput("Republic of Venice", "x".repeat(200)), null, "far too long");
  assert.equal(acceptModelOutput("The crisis of July 1914", "Die Krise vom Juli"), null, "a number lost");
  assert.equal(acceptModelOutput("The crisis of July 1914", "Die Krise vom Juli 1914"), "Die Krise vom Juli 1914");
  assert.equal(acceptModelOutput("Military junta", "Militares, 9000"), null, "a number made up");
  assert.equal(acceptModelOutput("Scenarios", "Scenarios Formand"), null, "the English kept, with a word made up after it");
  assert.equal(acceptModelOutput("Wessex", "Wessex"), "Wessex", "a name kept as it is");
  assert.equal(acceptModelOutput("The crisis of 1914", "أزمة ١٩١٤"), "أزمة ١٩١٤", "Arabic-Indic digits are the same number");
  assert.equal(acceptModelOutput("Found {{count}} regions", "{{count}} Regionen gefunden"), "{{count}} Regionen gefunden");
  assert.equal(acceptModelOutput("Found {{count}} regions", "Regionen gefunden"), null, "a slot lost");
});

// The page's side needs a browser, so it is read in its source.
test("the translator asks the AI only with Translate with my AI on; a language with a model is used only after a yes", () => {
  const translator = read("src/runtime/translator.js");
  assert.doesNotMatch(translator, /^import[^;]*(?:Game\/AI|requestBudget|fallbackRunner)/m, "no AI module up front");
  assert.doesNotMatch(translator, /Background AI|fallbackRunner/);
  // The one AI request is askAi's, and the router makes it only while the
  // switch is on (aiTranslation.test.js).
  assert.equal(translator.match(/callAI\(/g).length, 1);
  const askAi = translator.slice(translator.indexOf("const askAi = async"), translator.indexOf("const aiFailed ="));
  assert.match(askAi, /callAI\(/);
  assert.match(translator, /isAiOn: \(\) => run === generation && aiShown && aiInUse\(\)/);
  const queue = translator.slice(translator.indexOf("const processQueue = async () => {"), translator.indexOf("// ---- content ----"));
  assert.match(queue, /!translating\(\) \|\| !router\) \{\n\s*return;/, "nothing is translated without the model or the switch");
  assert.match(queue, /await router\.step\(pending\)/);
  assert.match(translator, /const translating = \(\) => modelInUse\(\) \|\| aiInUse\(\);/);
  assert.match(translator, /const modelInUse = \(\) => Boolean\(translationModelFor\(language\)\) && modelChoice\(\) === "yes" && !modelFailed;/);
  const switching = translator.slice(translator.indexOf("export const switchLanguage = "), translator.indexOf("export const stopTranslator"));
  assert.match(switching, /modelChoice\(wanted\) !== "yes" && !\(await askForModel\(wanted\)\)\) \{\n\s*return language;/, "declined: the language the game had");
  assert.ok(switching.indexOf("askForModel(") < switching.indexOf("setStoredLanguage("), "asked before it is kept");
  assert.doesNotMatch(switching, /location\.reload/, "no reload: the player stays where they are");
  const start = translator.slice(translator.indexOf("const startInLanguage = "), translator.indexOf("const leaveLanguage = "));
  assert.match(start, /if \(!kept\) \{\n\s*await switchLanguage\(DEFAULT_LANGUAGE\);/, "said no at start: English");

  const worker = read("src/runtime/translationWorker.js");
  const name = worker.match(/const MODEL_CACHE = "([^"]+)";/)[1];
  assert.match(read("src/runtime/assets.js"), new RegExp(`const TRANSLATION_MODEL_CACHE_NAME = "${name}";`));
  assert.match(worker, /env\.cacheKey = MODEL_CACHE;/);
  assert.match(worker, /dtype: "q8"/, "the int8 files MODEL_FILES lists");
  // Transformers.js is told where the model is read from.
  assert.match(worker, /const \[source\] = modelSources\(entry\);\s*env\.remoteHost = source\.host;\s*env\.remotePathTemplate = source\.path;/);
  assert.match(worker, /from_pretrained\(source\.model, \{ \.\.\.options, device: "wasm", dtype: "q8" \}\)/);
});
