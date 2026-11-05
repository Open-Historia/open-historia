/*! Open Historia — which recogniser the Advisor's microphone uses © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/speechEngines.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { LANGUAGES } from "./i18n.js";
import { ON_DEVICE_MODELS, SPEECH_ENGINES, baseLanguage, formatModelSize, modelBytes, onDeviceEngineFor, pickSpeechEngine, speechLocale, systemFallbackReason, systemSpeechPlatform, whisperLanguage } from "./speechEngines.js";

const { ANDROID, BROWSER, SYSTEM, WHISPER } = SPEECH_ENGINES;

test("the desktop app on Windows or macOS asks the system's recogniser first, in every language", () => {
  for (const language of ["en", "fr", "ja", "ar", "zh"]) {
    assert.equal(pickSpeechEngine({ language, electron: true, systemRecognizer: true, browserRecognizer: true, onDevice: true }), SYSTEM, language);
  }
  // Even without the means to run Whisper: the system's needs none of them.
  assert.equal(pickSpeechEngine({ language: "en", electron: true, systemRecognizer: true }), SYSTEM);
});

test("where the system's recogniser cannot listen, the same press falls back to Whisper", () => {
  assert.equal(pickSpeechEngine({ language: "en", electron: true, systemRecognizer: true, skipSystem: true, browserRecognizer: true, onDevice: true }), WHISPER);
  // Linux, or a build with no program for it.
  assert.equal(pickSpeechEngine({ language: "de", electron: true, systemRecognizer: false, onDevice: true }), WHISPER);
  assert.equal(pickSpeechEngine({ language: "de", electron: true, systemRecognizer: true, skipSystem: true, onDevice: false }), null);
});

test("the system's recogniser is the desktop app's alone: never a browser's, never Android's", () => {
  assert.equal(pickSpeechEngine({ language: "en", systemRecognizer: true, browserRecognizer: true, onDevice: true }), BROWSER);
  assert.equal(pickSpeechEngine({ language: "en", systemRecognizer: true, onDevice: true }), WHISPER);
  assert.equal(pickSpeechEngine({ language: "en", native: true, nativeRecognizer: true, electron: true, systemRecognizer: true }), ANDROID);
});

test("why the system's recogniser did not listen", () => {
  assert.equal(systemFallbackReason("privacy"), "privacy");
  assert.equal(systemFallbackReason("denied"), "denied");
  assert.equal(systemFallbackReason("language"), "language");
  assert.equal(systemFallbackReason("unavailable"), "absent");
  for (const code of ["failed", "network", undefined, "something new"]) assert.equal(systemFallbackReason(code), "failed", String(code));
  // A microphone the system refused would be refused to Whisper too.
  assert.equal(systemFallbackReason("microphone"), null);
});

test("Windows and macOS desktop apps may have a system recogniser; Linux has none", () => {
  assert.equal(systemSpeechPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) open-historia/0.0.1 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36"), true);
  assert.equal(systemSpeechPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Electron/37.2.0 Safari/537.36"), true);
  assert.equal(systemSpeechPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/37.2.0 Safari/537.36"), false);
  assert.equal(systemSpeechPlatform(""), false);
});

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
