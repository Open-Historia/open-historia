/*! Open Historia — which speech recogniser the Advisor's microphone uses © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Advisor's microphone turns speech into text without the player's AI
// provider: a request spent on dictation is one fewer for the game, and on a
// free key there are few. So every engine here is a recogniser the platform
// already has, or an open model that runs on the device.
//
//   android   the phone's own recogniser, through the SpeechRecognition plugin
//             (@capacitor-community/speech-recognition in mobile/).
//   browser   the Web Speech API of a browser that has one. Not in Electron: it
//             has the constructor, but no key for Google's service behind it,
//             so every start fails with "network".
//   whisper   OpenAI's Whisper base in a worker (Transformers.js on ONNX
//             Runtime Web), for every language of the game: it was trained on
//             all fifty, and its download is small enough to ask for.
//
// Pure: everything about the platform comes in as arguments, so the choice is
// tested without a browser.

export const SPEECH_ENGINES = Object.freeze({
  ANDROID: "android",
  BROWSER: "browser",
  WHISPER: "whisper",
});

// Whisper's codes for the game's languages where they differ from the game's.
const WHISPER_CODES = Object.freeze({ fil: "tl" });

// Every language of the game's picker (src/runtime/i18n.js) that Whisper was
// trained on, under Whisper's code. All fifty are.
const WHISPER_LANGUAGES = Object.freeze(new Set([
  "en", "zh", "hi", "es", "fr", "ar", "bn", "pt", "ru", "ur", "id", "de", "ja",
  "sw", "mr", "te", "tr", "ta", "vi", "ko", "it", "ha", "th", "gu", "kn", "fa",
  "pl", "uk", "ml", "my", "pa", "ro", "nl", "el", "cs", "hu", "sv", "he", "ms",
  "tl", "am", "ne", "si", "km", "so", "az", "uz", "yo", "fi", "da",
]));

// A region for each language, for the recognisers that take a locale (the Web
// Speech API and Android's). A bare code works in most of them, but some pick
// no model at all without the region, and the most spoken one is the safe bet.
const LOCALES = Object.freeze({
  en: "en-US", zh: "zh-CN", hi: "hi-IN", es: "es-ES", fr: "fr-FR", ar: "ar-SA",
  bn: "bn-BD", pt: "pt-BR", ru: "ru-RU", ur: "ur-PK", id: "id-ID", de: "de-DE",
  ja: "ja-JP", sw: "sw-KE", mr: "mr-IN", te: "te-IN", tr: "tr-TR", ta: "ta-IN",
  vi: "vi-VN", ko: "ko-KR", it: "it-IT", ha: "ha-NG", th: "th-TH", gu: "gu-IN",
  kn: "kn-IN", fa: "fa-IR", pl: "pl-PL", uk: "uk-UA", ml: "ml-IN", my: "my-MM",
  pa: "pa-IN", ro: "ro-RO", nl: "nl-NL", el: "el-GR", cs: "cs-CZ", hu: "hu-HU",
  sv: "sv-SE", he: "he-IL", ms: "ms-MY", fil: "fil-PH", am: "am-ET", ne: "ne-NP",
  si: "si-LK", km: "km-KH", so: "so-SO", az: "az-AZ", uz: "uz-UZ", yo: "yo-NG",
  fi: "fi-FI", da: "da-DK",
});

// "pt-BR", "PT", " en " → the game's code ("pt", "en").
export const baseLanguage = (code) => String(code || "").trim().toLowerCase().split(/[-_]/)[0] || "en";

// The locale a platform recogniser is asked for.
export const speechLocale = (code) => {
  const raw = String(code || "").trim();
  if (/^[a-z]{2,3}[-_][a-z]{2}$/i.test(raw)) return raw.replace("_", "-");
  const base = baseLanguage(raw);
  return LOCALES[base] || base;
};

// Whisper's language code, or null when Whisper does not have it.
export const whisperLanguage = (code) => {
  const base = baseLanguage(code);
  const mapped = WHISPER_CODES[base] || base;
  return WHISPER_LANGUAGES.has(mapped) ? mapped : null;
};

// The on-device engine for a language: Whisper, or null where it does not
// speak the language.
export const onDeviceEngineFor = (code) => (whisperLanguage(code) ? SPEECH_ENGINES.WHISPER : null);

// Which engine runs, or null where none can (the microphone is then hidden).
//   native            the Android app's build
//   nativeRecognizer  its SpeechRecognition plugin is there
//   browserRecognizer the page has SpeechRecognition / webkitSpeechRecognition
//   electron          the page runs in the desktop app
//   browserBroken     the browser's recogniser failed this session (network,
//                     refused by the browser, language not offered)
//   onDevice          a worker, WebAssembly and the microphone are there
export const pickSpeechEngine = ({
  language,
  native = false,
  nativeRecognizer = false,
  browserRecognizer = false,
  electron = false,
  browserBroken = false,
  onDevice = false,
} = {}) => {
  // A model download is no thing to put on a phone that has a recogniser of
  // its own, and the Android WebView has no Web Speech API.
  if (native) return nativeRecognizer ? SPEECH_ENGINES.ANDROID : null;
  if (browserRecognizer && !electron && !browserBroken) return SPEECH_ENGINES.BROWSER;
  if (!onDevice) return null;
  return onDeviceEngineFor(language);
};

// The model an on-device engine downloads once, pinned to a revision so what
// is cached is what was measured. Sizes are the files' own, in bytes. Whisper
// small would read better, but its 8-bit files come to 250 MB and its encoder
// is several times the work of base's, on one thread.
export const ON_DEVICE_MODELS = Object.freeze({
  [SPEECH_ENGINES.WHISPER]: Object.freeze({
    name: "Whisper base",
    repo: "onnx-community/whisper-base",
    revision: "27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c",
    files: Object.freeze({
      "config.json": 2243,
      "generation_config.json": 3832,
      "preprocessor_config.json": 339,
      "tokenizer.json": 2480466,
      "tokenizer_config.json": 282682,
      "onnx/encoder_model_quantized.onnx": 23201314,
      "onnx/decoder_model_merged_quantized.onnx": 53693315,
    }),
  }),
});

export const modelBytes = (engine) =>
  Object.values(ON_DEVICE_MODELS[engine]?.files || {}).reduce((sum, bytes) => sum + bytes, 0);

// "80 MB", "1.5 GB": the size the download prompt shows, in decimal megabytes
// as a browser's download list counts them.
export const formatModelSize = (bytes) => {
  const mb = Number(bytes) / 1e6;
  if (!Number.isFinite(mb) || mb <= 0) return "0 MB";
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(mb))} MB`;
};
