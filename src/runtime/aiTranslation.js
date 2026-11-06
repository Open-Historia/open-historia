/*! Open Historia — translating with the player's own AI, by choice © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/aiTranslation.test.js
//
// Translate with my AI (Settings → General → Language; docs/i18n.md). What the
// translation model on this device would translate (translationModels.js: a
// scenario's names and descriptions, region names, the interface of a language
// with no pack) goes to the player's own AI provider instead, for a player who
// finds the model's translations poor. It is off by default and only offered
// where the model is: the language in use has one and the player downloaded it.
// The download is never skipped, since the model is what takes over whenever
// the AI does not answer. A shipped pack's strings stay the pack's.
//
// Off, nothing here sends anything: the router below asks the AI only while
// `isAiOn()` says so, and translator.js loads the AI's module only from inside
// that path.
//
// Pure: translator.js holds the state (the phrase book, the queue, the caches)
// and the tests drive the router with stand-ins for the AI and the model.

import { acceptModelOutput, planModelBatch, translationModelFor } from "./translationModels.js";

// The switch, a UI setting like the others (runtime/mapSettings.js): "1" on,
// anything else off.
export const AI_TRANSLATION_SETTING = "i18n_translate_with_ai";

// Where the AI's translations are kept on this device, per language. Apart
// from the model's (translator.js CACHE_PREFIX and the server's language pack),
// so turning the switch off shows the model's again at once, and a string the
// AI has answered is never asked of it twice.
export const AI_CACHE_PREFIX = "i18n_ai_v1_";

// How many strings ride in one request. Requests are the scarce thing (a free
// key allows a few hundred a day, and a per-minute limit punishes requests in
// parallel), so one big request at a time: up to 240 strings, and bounded by
// characters as well, so a batch of prose does not outgrow the answer.
export const AI_BATCH_MAX_STRINGS = 240;
export const AI_BATCH_MAX_CHARS = 6000;

// After a failed request the AI rests a minute (the model translates
// meanwhile); after AI_MAX_FAILURES in a row it is left alone for the session.
export const AI_REST_MS = 60 * 1000;
export const AI_MAX_FAILURES = 3;

// Whether the switch is offered: a language with a translation model the
// player said yes to (and so downloaded: translator.js switchLanguage asks for
// it before the language is used). English, and a language with a pack and no
// model, have nothing the model would translate, so no switch.
export const aiTranslationOffered = ({ language, modelChoice } = {}) =>
  Boolean(language) && language !== "en" && Boolean(translationModelFor(language)) && modelChoice === "yes";

// The switch's stored value (getMapSetting's reading: only "1" is on).
export const readAiTranslationSetting = (value) => value === "1";

// The next request's worth of strings: as many as fit under both ceilings, and
// always at least one however long it is.
export const planAiBatch = (strings, { maxStrings = AI_BATCH_MAX_STRINGS, maxChars = AI_BATCH_MAX_CHARS } = {}) => {
  const limit = Math.max(1, Math.trunc(Number(maxStrings) || 1));
  const room = Math.max(1, Math.trunc(Number(maxChars) || 1));
  const batch = [];
  let chars = 0;
  for (const source of strings ?? []) {
    const length = String(source ?? "").length;
    if (batch.length >= limit) break;
    if (batch.length && chars + length > room) break;
    batch.push(source);
    chars += length;
  }
  return batch;
};

// The system prompt. `packed`: the language has a shipped pack, so only
// content is asked for.
export const aiTranslationPrompt = ({ language, name = language, packed = false, count }) =>
  "You are the translation engine for a grand-strategy game. " +
  (packed
    ? "The strings are the game's content: names of countries, polities and places, scenario and saved-game names and descriptions, custom statistics, community posts. "
    : "The strings are its interface and its content. ") +
  `Translate each English string in the user's JSON array into ${name} (${language}).\n` +
  "Rules:\n" +
  `- Answer with ONLY a JSON array of ${count} strings: the translations, same order, same length.\n` +
  "- Keep numbers, emoji, punctuation style, and placeholders such as {{name}} or ${...} exactly as they are.\n" +
  `- Country, region, and place names take their standard ${name} forms when they exist; otherwise keep them unchanged.\n` +
  `- If a string is already in ${name} or is a proper name or code with no translation, return it unchanged.\n` +
  "- Never add commentary, keys, or markdown.";

const extractJsonArray = (raw) => {
  const text = String(raw ?? "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export class AiTranslationReplyError extends Error {
  constructor(message) {
    super(message);
    this.name = "AiTranslationReplyError";
  }
}

// The AI's answer for `batch`, paired by position. Only an array of exactly the
// batch's length is read: one dropped or merged entry would give every later
// string its neighbour's translation. Within it, an entry is kept only if it
// passes the checks the model's answers pass (acceptModelOutput: every number
// and placeholder kept, no run-on); the rest are `rejected`, for the model.
export const readAiReply = (raw, batch) => {
  const strings = [...(batch ?? [])];
  const answers = extractJsonArray(raw);
  if (!answers) throw new AiTranslationReplyError("the translation answer was not a JSON array");
  if (answers.length !== strings.length) {
    throw new AiTranslationReplyError(`the translation answer had ${answers.length} entries for ${strings.length} strings`);
  }
  const pairs = [];
  const rejected = [];
  strings.forEach((source, index) => {
    const answer = typeof answers[index] === "string" ? acceptModelOutput(source, answers[index]) : null;
    if (answer) pairs.push([source, answer]);
    else rejected.push(source);
  });
  return { pairs, rejected };
};

// Who translates the queue, one step at a time.
//
//   isAiOn()        the switch, read before every step: off, the AI is never
//                   asked, and what it was going to take goes to the model;
//   askAi(batch)    one request; resolves to the raw answer, or throws;
//   askModel(batch) the model on this device; resolves to a translation or
//                   null per string;
//   known(source)   the model's translation already in hand, if any: a string
//                   the AI failed on keeps it rather than being run again;
//   cache           the AI's translations (source → text), shared with the
//                   translator, which keeps it on the device.
//
// step(pending) does one request's worth of work and resolves to what it
// settled: `translated` ({ source, text, by: "ai" | "model" }), `kept` (the
// model's translation stays) and `unusable` (stays English). What it did not
// reach stays pending for the next step. A string is asked of the AI once: an
// answer is cached, and a failure leaves it to the model.
export const createTranslationRouter = ({
  isAiOn,
  askAi,
  askModel,
  known = () => undefined,
  cache = new Map(),
  now = Date.now,
  restMs = AI_REST_MS,
  maxFailures = AI_MAX_FAILURES,
  onAiFailure = null,
} = {}) => {
  const tried = new Set();
  let restUntil = 0;
  let failures = 0;
  let halted = false;

  const aiAvailable = () => Boolean(isAiOn?.()) && !halted && now() >= restUntil;

  const viaModel = async (list, result) => {
    const unknown = [];
    for (const source of list) {
      if (known(source) !== undefined) result.kept.push(source);
      else unknown.push(source);
    }
    // Only kept strings this step: settled without the model.
    if (result.kept.length || !unknown.length) return result;
    const batch = planModelBatch(unknown);
    const answers = await askModel(batch);
    batch.forEach((source, index) => {
      const text = answers?.[index];
      if (typeof text === "string" && text) result.translated.push({ source, text, by: "model" });
      else result.unusable.push(source);
    });
    return result;
  };

  const step = async (pending) => {
    const list = [...(pending ?? [])];
    const result = { translated: [], kept: [], unusable: [], asked: null };
    if (!list.length) return result;
    if (aiAvailable()) {
      // Answered before: no request.
      for (const source of list) {
        if (cache.has(source)) result.translated.push({ source, text: cache.get(source), by: "ai" });
      }
      if (result.translated.length) return result;
      const fresh = list.filter((source) => !tried.has(source));
      if (fresh.length) {
        const batch = planAiBatch(fresh);
        batch.forEach((source) => tried.add(source));
        result.asked = "ai";
        try {
          const { pairs, rejected } = readAiReply(await askAi(batch), batch);
          failures = 0;
          for (const [source, text] of pairs) {
            cache.set(source, text);
            result.translated.push({ source, text, by: "ai" });
          }
          // Rejected answers are the model's to try, on a later step.
          if (rejected.length) result.rejected = rejected;
        } catch (error) {
          failures += 1;
          if (failures >= maxFailures) halted = true;
          else restUntil = now() + restMs;
          result.failed = batch;
          onAiFailure?.(error, { halted });
        }
        return result;
      }
    }
    result.asked = "model";
    return viaModel(list, result);
  };

  return {
    step,
    // For the translator: whether a string has been put to the AI this session.
    tried: (source) => tried.has(source),
    aiAvailable,
    halted: () => halted,
  };
};
