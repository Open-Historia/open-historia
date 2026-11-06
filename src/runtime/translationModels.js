/*! Open Historia — which languages a translation model on the device covers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What no language pack has (a scenario's names and descriptions, a map's
// region names, the interface of a language with no pack) is translated on the
// device by a small open model, where one translates English into the
// player's language well. A language with a model is played in only once the
// player has seen its size and said yes (translator.js switchLanguage); no
// translation is ever an AI request. A language with a pack and no model shows
// what its pack has, and an answer that fails the checks below stays English.
//
// The models are Opus-MT (Language Technology Research Group, University of
// Helsinki; https://github.com/Helsinki-NLP/Opus-MT), one per language pair,
// licensed CC BY 4.0, in the ONNX copies Transformers.js publishes
// (huggingface.co/Xenova/opus-mt-en-*). Only the player's language is
// downloaded: about 110 MB, int8. A language is listed only where a trial on the
// game's own kind of text (polity names, scenario blurbs) read right; vi, hi,
// sv and uk renamed places or ran on, and ja, ko, pl, tr, bn, fa, th and ur
// have no model small enough. NLLB-200 (CC BY-NC, so not usable here) and
// M2M100 (about 640 MB) were the multilingual alternatives.
//
// Pure: the worker (translationWorker.js) and the translator call it, and the
// tests call it directly.

// The files Transformers.js reads for one model: the int8 encoder and the merged
// decoder (one file for the first token and the rest), the tokenizer, and the
// configs. `bytes` below is their sum on the model host, at the pinned revision.
export const MODEL_FILES = Object.freeze([
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
]);

export const MODEL_HOST = "https://huggingface.co";

// `token`: a model that writes several languages is told which by a token in
// front of the text (Marian's ">>id<<").
const model = (repo, revision, bytes, token = "") => Object.freeze({ repo, revision, bytes, token });

export const TRANSLATION_MODELS = Object.freeze({
  ar: model("Xenova/opus-mt-en-ar", "034a684356c19021a187cda4d7f823298b913921", 117602786, ">>ara<<"),
  de: model("Xenova/opus-mt-en-de", "1ca130c44c4c5441ef16d48aae521a424ab644f7", 111519780),
  es: model("Xenova/opus-mt-en-es", "4b002a4c7edd54a7ced58877258b87f7efd3f892", 119377271),
  fr: model("Xenova/opus-mt-en-fr", "28726206f80896b90035bd99cccd5cc1e151f916", 113111733),
  id: model("Xenova/opus-mt-en-id", "b3b41f654c2fb3286d007dee1da7b0f47fd27d82", 107915091),
  it: model("Xenova/opus-mt-en-it", "075406e3c8c2c30634d4a1bd8f00c21d9e162011", 136474044),
  nl: model("Xenova/opus-mt-en-nl", "c3a0541231a7329b4492809fc2bd7ab7d2ceb0bc", 121631416),
  // The Romance model, told Brazilian Portuguese: the pack's (pt.json) is.
  pt: model("Xenova/opus-mt-en-ROMANCE", "9d2ba69ac80c8e8453c3d9a1e2323a0e7b8ca3cd", 119232541, ">>pt_BR<<"),
  ru: model("Xenova/opus-mt-en-ru", "e050376e960175e8ddc5cff85025dc8436cddd68", 117767359),
  zh: model("Xenova/opus-mt-en-zh", "046f55aec303cdee3e0318604406d4df20f1e8ea", 119495576, ">>cmn_Hans<<"),
  // Languages with no shipped pack, whose whole interface would otherwise go
  // to the AI.
  da: model("Xenova/opus-mt-en-da", "33862dc071a5cc43e821e60742553c501c587e77", 112558991),
  hu: model("Xenova/opus-mt-en-hu", "1b7df958c1bd8f094eff1ce76d536468923ed7e3", 116699316),
  ro: model("Xenova/opus-mt-en-ro", "3d816891778276930df2a45cbfb70689b3fe8981", 113247006),
  cs: model("Xenova/opus-mt-en-cs", "ed163ca109a93297e2f055eb3397bd33230141ad", 116695526),
  fi: model("Xenova/opus-mt-en-fi", "4e5799273dbd7cce94c1e99cc9d3acb9f191b8eb", 119429988),
});

// "pt-BR", " DE " → "pt", "de".
const baseLanguage = (code) => String(code || "").trim().toLowerCase().split(/[-_]/)[0];

export const translationModelFor = (language) => TRANSLATION_MODELS[baseLanguage(language)] || null;

// Where Transformers.js fetches a file from, which is also its key in the
// browser's cache.
export const modelFileUrl = (entry, file) => `${MODEL_HOST}/${entry.repo}/resolve/${entry.revision}/${file}`;

// "112 MB": decimal megabytes, as the model host and the operating system's
// download dialogs count them.
export const formatModelSize = (bytes) => `${Math.max(1, Math.round((Number(bytes) || 0) / 1e6))} MB`;

// ---------------------------------------------------------------------------
// The player's answer to the download prompt, per language, kept on this
// device: "yes" (downloaded, and in use) or "no" (the game stayed English).

export const MODEL_CHOICE_PREFIX = "oh:translation-model:";
export const modelChoiceKey = (language) => `${MODEL_CHOICE_PREFIX}${baseLanguage(language)}`;
export const readModelChoice = (value) => (value === "yes" || value === "no" ? value : "");

// ---------------------------------------------------------------------------
// Batching.
//
// The model runs in a worker on one thread, a few hundred milliseconds a short
// string. A batch is small, so the queue keeps moving and a panel that opens
// meanwhile is not left waiting behind a hundred names; and bounded by
// characters, since padding makes every row of a batch as long as its longest.
export const MODEL_BATCH_STRINGS = 8;
export const MODEL_BATCH_CHARS = 1200;

export const planModelBatch = (strings, { maxStrings = MODEL_BATCH_STRINGS, maxChars = MODEL_BATCH_CHARS } = {}) => {
  const batch = [];
  let chars = 0;
  for (const text of strings ?? []) {
    if (batch.length >= maxStrings) break;
    const length = String(text).length;
    if (batch.length && chars + length > maxChars) break;
    batch.push(text);
    chars += length;
  }
  return batch;
};

// Rows of similar length together: a short name padded to a paragraph's length
// costs the paragraph's time. Indices, so the answers go back in order.
export const groupByLength = (strings, { maxRows = 4 } = {}) => {
  const order = strings.map((text, index) => ({ index, length: String(text).length }))
    .sort((a, b) => a.length - b.length);
  const groups = [];
  for (let at = 0; at < order.length; at += maxRows) {
    groups.push(order.slice(at, at + maxRows).map((row) => row.index));
  }
  return groups;
};

// The model reads a few hundred words at most, and translates a sentence best
// on its own. A long string is cut into pieces: its lines, and a long line into
// sentences; `join` puts the translated pieces back with the same breaks.
export const MODEL_PIECE_CHARS = 400;

export const splitForModel = (text, { maxChars = MODEL_PIECE_CHARS } = {}) => {
  // Each part is a piece to translate (a number: its index in `pieces`) or
  // text kept as it is (line breaks, the spaces between sentences).
  const pieces = [];
  const parts = [];
  const keep = (raw) => { if (raw) parts.push(raw); };
  const add = (chunk) => {
    const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(chunk);
    keep(lead);
    if (body) {
      parts.push(pieces.length);
      pieces.push(body);
    }
    keep(trail);
  };
  for (const unit of String(text ?? "").match(/[^\n]+|\n+/g) || []) {
    if (unit.startsWith("\n")) keep(unit);
    else if (unit.length <= maxChars) add(unit);
    else unit.split(/(?<=[.!?…;:])(\s+)/).forEach((chunk, at) => (at % 2 ? keep(chunk) : add(chunk)));
  }
  return {
    pieces,
    join: (translated) => parts.map((part) => (typeof part === "number" ? translated[part] ?? "" : part)).join(""),
  };
};

// ---------------------------------------------------------------------------
// What of the model's answer may be kept.
//
// A small model sometimes runs on (repeating a word or a mark to the end of its
// budget), echoes its language token, or drops a number. Such an answer is not
// kept; the string stays English.

const PLACEHOLDER = /\{\{\s*[^}]+?\s*\}\}|\$\{[^}]*\}/g;
const ARABIC_INDIC = /[٠-٩۰-۹]/g;
const westernDigits = (text) => text.replace(ARABIC_INDIC, (digit) => String((digit.charCodeAt(0) & 0xf) % 10));
const numbersIn = (text) => (westernDigits(String(text)).match(/\d+/g) || []).sort();

export const acceptModelOutput = (source, output) => {
  const english = String(source ?? "").trim();
  const text = String(output ?? "").trim();
  if (!text || !english) return null;
  if (/>>\w+<</.test(text)) return null;
  // The English kept and something made up after it ("Scenarios" →
  // "Scenarios Formand", "Wessex" → "Wessex Ordförande").
  if (text.length > english.length && text.toLowerCase().startsWith(english.toLowerCase())) return null;
  // Runaway: far longer than any translation of it would be.
  if (text.length > english.length * 3 + 24) return null;
  // The same few characters again and again ("- - - -", "豆腐 豆腐 豆腐").
  if (/(.{1,16}?)(?:\s*\1){4,}/u.test(text) && !/(.{1,16}?)(?:\s*\1){4,}/u.test(english)) return null;
  // Every placeholder, and every number, survives, and no number is made up
  // ("Military junta" → "Militares, 9000").
  const slots = (value) => (value.match(PLACEHOLDER) || []).map((slot) => slot.replace(/\s+/g, "")).sort();
  if (slots(english).join("\n") !== slots(text).join("\n")) return null;
  const wanted = numbersIn(english);
  const got = numbersIn(text);
  if (wanted.some((number) => !got.includes(number))) return null;
  if (got.some((number) => !wanted.includes(number))) return null;
  return text;
};
