// Run: node --test src/runtime/translationModels.test.js
//
// "can you also get a translator model to replace the ai requests for
// translation?" (the owner, 2026-11-05). Where a small open model translates
// English into the player's language well, it does so on the device; the AI
// keeps every language, string and failure the model cannot take.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { SHIPPED_PACK_LANGUAGES } from "./i18n.js";
import {
  ENGINES,
  MODEL_BATCH_CHARS,
  MODEL_BATCH_STRINGS,
  MODEL_FILES,
  TRANSLATION_MODELS,
  acceptModelOutput,
  formatModelSize,
  groupByLength,
  modelChoiceKey,
  modelFileUrl,
  planModelBatch,
  readModelChoice,
  splitForModel,
  splitPendingByEngine,
  translationEngineFor,
  translationModelFor,
} from "./translationModels.js";

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a model only where one reads right; the rest of the 22 stay with the AI", () => {
  const covered = SHIPPED_PACK_LANGUAGES.filter((code) => translationModelFor(code));
  assert.deepEqual(covered, ["ar", "de", "es", "fr", "id", "it", "nl", "pt", "ru", "zh"]);
  for (const code of ["bn", "fa", "hi", "ja", "ko", "pl", "sv", "th", "tr", "uk", "ur", "vi"]) {
    assert.equal(translationModelFor(code), null, code);
  }
  assert.equal(translationModelFor("en"), null, "English needs none");
  assert.equal(translationModelFor("pt-BR"), TRANSLATION_MODELS.pt, "a regional code is its language");
  assert.equal(translationModelFor(" DE "), TRANSLATION_MODELS.de);
  // Three without a pack, whose whole interface would otherwise be AI requests.
  for (const code of ["da", "hu", "ro"]) assert.ok(translationModelFor(code), code);
});

test("every model is pinned, int8, about 110 MB, from the Transformers.js copies of Opus-MT", () => {
  for (const [code, entry] of Object.entries(TRANSLATION_MODELS)) {
    assert.match(entry.repo, /^Xenova\/opus-mt-en-[A-Za-z]+$/, code);
    assert.match(entry.revision, /^[0-9a-f]{40}$/, `${code}: a commit, so the files never change under the cache`);
    assert.ok(entry.bytes > 100e6 && entry.bytes < 140e6, `${code}: ${entry.bytes}`);
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
});

test("who translates: the model once the player said yes, the AI otherwise, nobody while asking", () => {
  assert.equal(translationEngineFor({ language: "de" }), ENGINES.ASK, "not asked yet: asked, and nothing is sent");
  assert.equal(translationEngineFor({ language: "de", choice: "yes" }), ENGINES.MODEL);
  assert.equal(translationEngineFor({ language: "de", choice: "no" }), ENGINES.AI, "declined: the AI, as before");
  assert.equal(translationEngineFor({ language: "de", choice: "yes", failed: true }), ENGINES.AI, "would not load: the AI");
  assert.equal(translationEngineFor({ language: "ja", choice: "yes" }), ENGINES.AI, "no model for it: the AI");
  assert.equal(translationEngineFor({ language: "ja" }), ENGINES.AI, "and it is never asked about");
  assert.equal(translationEngineFor({ language: "de", choice: "maybe" }), ENGINES.ASK);
  assert.equal(readModelChoice("yes"), "yes");
  assert.equal(readModelChoice(null), "");
  assert.equal(modelChoiceKey("pt-BR"), "oh:translation-model:pt");
});

test("the model takes the queue; the AI gets only what the model's answer was refused for", () => {
  const pending = new Set(["Kingdom of Bavaria", "Wessex", "Grain reserves"]);
  assert.deepEqual(splitPendingByEngine(pending, { engine: ENGINES.MODEL, refused: new Set(["Wessex"]) }), {
    model: ["Kingdom of Bavaria", "Grain reserves"],
    ai: ["Wessex"],
  });
  assert.deepEqual(splitPendingByEngine(pending, { engine: ENGINES.AI }), { model: [], ai: [...pending] });
  assert.deepEqual(splitPendingByEngine(pending, { engine: ENGINES.ASK }), { model: [], ai: [] }, "asking: nothing goes anywhere");
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
test("the translator asks before anything is sent, and the model's cache survives the start-up sweep", () => {
  const translator = read("src/runtime/translator.js");
  const queue = translator.slice(translator.indexOf("const processQueue = async () => {"), translator.indexOf("// ---- content ----"));
  assert.match(queue, /const engine = await engineNow\(\);\n\s*if \(engine === ENGINES\.ASK\) \{\n\s*askAboutModel\(\);\n\s*break;/);
  assert.ok(queue.indexOf("translateOnDevice(") < queue.indexOf("translateBatch("), "the model before the AI");
  assert.match(queue, /chooseTranslationBatch\(share\.ai, \{/, "the AI gets the model's leftovers");

  const worker = read("src/runtime/translationWorker.js");
  const name = worker.match(/const MODEL_CACHE = "([^"]+)";/)[1];
  assert.match(read("src/runtime/assets.js"), new RegExp(`const TRANSLATION_MODEL_CACHE_NAME = "${name}";`));
  assert.match(worker, /env\.cacheKey = MODEL_CACHE;/);
  assert.match(worker, /dtype: "q8"/, "the int8 files MODEL_FILES lists");
});
