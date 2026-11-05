/*! Open Historia — which recogniser the Advisor's microphone uses © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/speechEngines.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { LANGUAGES } from "./i18n.js";
import { ON_DEVICE_MODELS, SPEECH_ENGINES, baseLanguage, formatModelSize, modelBytes, onDeviceEngineFor, pickSpeechEngine, speechLocale, whisperLanguage } from "./speechEngines.js";

const { ANDROID, BROWSER, WHISPER } = SPEECH_ENGINES;

test("Android uses the phone's recogniser, or nothing: never a model download", () => {
  assert.equal(pickSpeechEngine({ language: "en", native: true, nativeRecognizer: true, onDevice: true }), ANDROID);
  assert.equal(pickSpeechEngine({ language: "ja", native: true, nativeRecognizer: true }), ANDROID);
  assert.equal(pickSpeechEngine({ language: "en", native: true, nativeRecognizer: false, onDevice: true, browserRecognizer: true }), null);
});

test("a browser with a working Web Speech API uses it, in every language", () => {
  for (const language of ["en", "fr", "ja", "ar", "zh"]) {
    assert.equal(pickSpeechEngine({ language, browserRecognizer: true, onDevice: true }), BROWSER);
  }
});

test("Electron has the Web Speech constructor but no service behind it: Whisper runs on the device", () => {
  for (const language of ["en", "de", "ja"]) {
    assert.equal(pickSpeechEngine({ language, browserRecognizer: true, electron: true, onDevice: true }), WHISPER, language);
  }
});

test("a browser recogniser that failed this session falls through to Whisper", () => {
  assert.equal(pickSpeechEngine({ language: "es", browserRecognizer: true, browserBroken: true, onDevice: true }), WHISPER);
  assert.equal(pickSpeechEngine({ language: "es", browserRecognizer: true, browserBroken: true, onDevice: false }), null);
});

test("Whisper is the on-device engine for every language of the game's picker", () => {
  assert.deepEqual(Object.keys(ON_DEVICE_MODELS), [WHISPER]);
  for (const { code } of LANGUAGES) assert.equal(onDeviceEngineFor(code), WHISPER, code);
});

test("no recogniser anywhere hides the microphone", () => {
  assert.equal(pickSpeechEngine({ language: "en" }), null);
  assert.equal(pickSpeechEngine({ language: "xx", onDevice: true }), null);
});

test("language codes: the game's, the recognisers' locales, Whisper's", () => {
  assert.equal(baseLanguage("pt-BR"), "pt");
  assert.equal(baseLanguage(" EN "), "en");
  assert.equal(baseLanguage(""), "en");
  assert.equal(speechLocale("en"), "en-US");
  assert.equal(speechLocale("zh"), "zh-CN");
  assert.equal(speechLocale("fil"), "fil-PH");
  assert.equal(speechLocale("pt_PT"), "pt-PT");
  assert.equal(speechLocale("xx"), "xx");
  for (const { code } of LANGUAGES) assert.match(speechLocale(code), /^[a-z]{2,3}-[A-Z]{2}$/, code);
  assert.equal(whisperLanguage("fil"), "tl");
  assert.equal(whisperLanguage("ja-JP"), "ja");
  assert.equal(whisperLanguage("de-AT"), "de");
  assert.equal(whisperLanguage("xx"), null);
});

test("the download prompt's size is the pinned files'", () => {
  assert.equal(modelBytes(WHISPER), 79664191);
  assert.equal(formatModelSize(modelBytes(WHISPER)), "80 MB");
  assert.equal(formatModelSize(1_500_000_000), "1.5 GB");
  for (const model of Object.values(ON_DEVICE_MODELS)) assert.match(model.revision, /^[0-9a-f]{40}$/);
});
