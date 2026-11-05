// Run: node --test src/runtime/speechWorkerLoad.test.js
//
// The Advisor microphone's Whisper model is downloaded once and then loads with
// no connection. Two things stopped that: the page's start-up sweep of old
// caches deleted Transformers.js's cache on every start, and pipeline() in
// Transformers.js 4.3.1 asks the model host about the "main" revision on every
// load. The worker needs a browser, so its side is read in its source.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("Whisper's cache is the one the start-up sweep keeps", () => {
  const worker = read("src/runtime/speechWorker.js");
  const name = worker.match(/const WHISPER_CACHE = "([^"]+)";/)[1];
  const assets = read("src/runtime/assets.js");
  assert.match(assets, new RegExp(`const WHISPER_CACHE_NAME = "${name}";`));
  assert.match(worker, /env\.cacheKey = WHISPER_CACHE;/);
  assert.match(worker, /caches\.open\(WHISPER_CACHE\)/);
});

test("the model loads from the cache alone: no pipeline(), every part read at the pinned revision", () => {
  const worker = read("src/runtime/speechWorker.js");
  const code = worker.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\bpipeline\(/, "pipeline() asks the model host about the main revision");
  assert.doesNotMatch(code, /AutoTokenizer|AutoProcessor/, "so do these");
  for (const file of ["tokenizer.json", "tokenizer_config.json", "preprocessor_config.json"]) {
    assert.match(code, new RegExp(`readJson\\("${file.replace(".", "\\.")}"\\)`), file);
  }
  assert.match(code, /AutoModelForSpeechSeq2Seq\.from_pretrained\(MODEL\.repo, \{\n\s*revision: MODEL\.revision,/);
  assert.match(code, /new AutomaticSpeechRecognitionPipeline\(\{ task: "automatic-speech-recognition", model, tokenizer, processor \}\)/);
});
