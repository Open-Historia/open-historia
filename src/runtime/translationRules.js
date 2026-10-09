/*! Open Historia — what the translator sends to the AI, and what it keeps of the answer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/translationRules.test.js
//
// The rules that decide whether a string costs the player an AI request
// (docs/i18n.md), kept apart from the DOM and the AI so they can be tested.
// translator.js holds the state (the phrase book, the queue) and asks these:
//
//   - which strings have words to translate at all (isTranslatable), and which
//     are dates, written the player's way without a request (isNumericDate);
//   - where a rendered string the book does not know goes (routeUnknownText):
//     in a language with a shipped pack the interface is never sent to the AI;
//   - which events and which fields of written content are content
//     (isAuthoredEvent, collectContentText);
//   - how many strings ride in one request, and which ones
//     (planTranslationBatch, chooseTranslationBatch);
//   - what of the model's answer may be kept (readTranslationReply): an answer
//     is paired with its strings by position, so one of the wrong length is
//     never kept at all;
//   - what a failed request means for the next one (readTranslationFailure,
//     aiWaitIsOver): with nothing in the Fallback list able to answer, the
//     translator waits for the AI settings to change instead of asking again.

// How many strings ride in one request. This used to be 60 strings × 3 requests
// at a time, which made a first pass over a new language dozens of requests
// nobody pressed a button for — on a free key, where a few hundred a day is the
// whole allowance (AI/requestBudget.js), and where three concurrent requests is
// also the surest way to trip the per-MINUTE limit. One bigger request instead:
// same strings, a quarter of the requests, and nothing in flight beside it.
//
// Bounded by characters as well as count, because 240 strings of prose is a very
// different answer from 240 button labels, and the reply must not be truncated.
export const BATCH_MAX_STRINGS = 240;
export const BATCH_MAX_CHARS = 6000;
// What it falls back to when a batch fails: the model could not hold that many
// (a truncated answer, a token ceiling). Halved per failure, restored on the
// next success, so a language that cannot take big batches still finishes.
export const BATCH_MIN_STRINGS = 30;

// Only strings with real words need translating; glyphs, numbers, dates-only
// fragments and emoji stay as-is. The authored language is English, so
// requiring two Latin letters is a safe "has words" test.
export const isTranslatable = (text) => {
  const trimmed = String(text ?? "").trim();
  return trimmed.length > 1 && trimmed.length < 3000 && /[A-Za-z]{2}/.test(trimmed);
};

// A numeric date ("1/8/2016", "2016-01-08") has no words, but is written
// differently in most languages (localDates.js): the book writes it, and it is
// never sent to the AI.
export const isNumericDate = (text) => /^\d{1,2}\/\d{1,2}\/\d{4}$|^-?\d{4,6}-\d{2}-\d{2}$/.test(String(text ?? "").trim());

// Where a rendered string the book has nothing for goes:
//   "content"   — a name the scenario made (a region's): to the AI as content,
//                 when background AI allows it;
//   "missing"   — interface text in a language with a shipped pack: it stays
//                 English and is listed for the next pack, and costs nothing;
//   "interface" — interface text in a language without a pack: to the AI.
export const routeUnknownText = (text, { packed = false, isContent = null } = {}) => {
  if (typeof isContent === "function" && isContent(text)) return "content";
  return packed ? "missing" : "interface";
};

// A scenario's own events are its author's words; the ones the AI writes during
// play are already in the player's language (their source says which).
export const isAuthoredEvent = (event) => !event?.source || event.source === "scenario";

// The title and description of each authored event in a log.
export const authoredEventText = (events) => (Array.isArray(events) ? events : [])
  .filter(isAuthoredEvent)
  .flatMap((event) => [event?.title, event?.description])
  .filter((text) => typeof text === "string");

// Human-readable fields inside written content (a scenario or game saved from
// the library, the Workshop). Geometry is skipped: it can be enormous and
// holds nothing to show.
export const CONTENT_TEXT_KEYS = new Set([
  "name", "title", "subtitle", "description", "eyebrow", "heroTitle",
  "heroSubtitle", "summary", "blurb", "note", "label", "role", "mapLabel",
  "mapDistinctLabel", "sectionLabel", "prefix", "suffix",
]);
const SKIPPED_CONTENT_KEYS = new Set(["features", "geometry", "coordinates"]);
export const CONTENT_MAX_DEPTH = 6;
export const CONTENT_MAX_ARRAY = 500;

export const collectContentText = (payload) => {
  const found = [];
  const walk = (value, depth) => {
    if (depth > CONTENT_MAX_DEPTH || value == null) return;
    if (Array.isArray(value)) {
      if (value.length <= CONTENT_MAX_ARRAY) value.forEach((entry) => walk(entry, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (SKIPPED_CONTENT_KEYS.has(key)) continue;
      if (typeof entry === "string") {
        if (CONTENT_TEXT_KEYS.has(key)) found.push(entry);
      } else if (key === "aliases" && Array.isArray(entry)) {
        entry.forEach((alias) => typeof alias === "string" && found.push(alias));
      } else {
        walk(entry, depth + 1);
      }
    }
  };
  walk(payload, 0);
  return found;
};

// The next request's worth of strings: as many as fit under both ceilings, and
// always at least one however long that one string is.
export const planTranslationBatch = (strings, { maxStrings = BATCH_MAX_STRINGS, maxChars = BATCH_MAX_CHARS } = {}) => {
  const all = Array.isArray(strings) ? strings : [...(strings ?? [])];
  const limit = Math.max(1, Math.trunc(Number(maxStrings) || 1));
  const room = Math.max(1, Math.trunc(Number(maxChars) || 1));
  const batch = [];
  let chars = 0;
  for (const source of all) {
    const text = String(source ?? "");
    if (batch.length >= limit) break;
    if (batch.length && chars + text.length > room) break;
    batch.push(source);
    chars += text.length;
  }
  return batch;
};

// Which strings go next, and as what. The interface first, since a language
// without a pack is unreadable without it; content (names, descriptions) only
// while `contentAllowed()` says so (the Background AI switch and its daily
// cap), and never in the same request as the interface. null: nothing may go.
export const chooseTranslationBatch = (pending, { isContent = () => false, contentAllowed = () => true, maxStrings, maxChars } = {}) => {
  const all = [...(pending ?? [])];
  const ui = all.filter((text) => !isContent(text));
  if (ui.length) return { kind: "interface", strings: planTranslationBatch(ui, { maxStrings, maxChars }) };
  if (!all.length || !contentAllowed()) return null;
  return { kind: "content", strings: planTranslationBatch(all, { maxStrings, maxChars }) };
};

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

// A reply the translator cannot pair with its strings. `misaligned`: it was an
// array, of the wrong length.
export class TranslationReplyError extends Error {
  constructor(message, { misaligned = false } = {}) {
    super(message);
    this.name = "TranslationReplyError";
    this.misaligned = misaligned;
  }
}

// The model's answer for `batch`, paired by position. Only an array of exactly
// the batch's length is read: one dropped, merged or split entry would give
// every later string its neighbour's translation, and those are saved for good.
// Within a well-formed answer, an entry that is not a non-empty string is
// `unusable`: that string is not kept, and not asked about again this session.
// An entry equal to its source is kept (a name with no other form).
export const readTranslationReply = (raw, batch) => {
  const strings = [...(batch ?? [])];
  const translations = extractJsonArray(raw);
  if (!translations) throw new TranslationReplyError("translation response was not a JSON array");
  if (translations.length !== strings.length) {
    throw new TranslationReplyError(
      `translation response had ${translations.length} entries for ${strings.length} strings`,
      { misaligned: true },
    );
  }
  const pairs = [];
  const unusable = [];
  strings.forEach((source, index) => {
    const translated = typeof translations[index] === "string" ? translations[index].trim() : "";
    if (translated) pairs.push([source, translated]);
    else unusable.push(source);
  });
  return { pairs, unusable };
};

// What a failed request says about the next one.
//
// "unavailable": nothing in the Fallback list can answer. The list is empty,
// no entry has a key, or every one is Unusable or Spent (AI/fallbackRunner.js
// marks that error `fallbackUnavailable`, with `nextResetAt` when the first
// Spent model's return is known). No request went out, and asking again cannot
// work until the player changes the AI settings or that allowance is back, so
// it is waited for rather than tried again on a timer. Counted as an ordinary
// failure it was three calls failing at once, a minute's pause, three more,
// and translation stopped for the session: the key a new player pasted two
// minutes in translated nothing until the game was reloaded. (An older build
// never stopped: a player's log has it failing "after 0.0s" every minute.)
//
// "transient": anything else. A run of those pauses for a minute, as before.
export const readTranslationFailure = (error) => {
  const unavailable = error?.fallbackUnavailable;
  if (!unavailable || typeof unavailable !== "object") return { kind: "transient", until: null };
  const until = Number(unavailable.nextResetAt);
  return { kind: "unavailable", until: Number.isFinite(until) && until > 0 ? until : null };
};

// Whether a wait that began with an "unavailable" failure is over: something in
// the Fallback list can answer again (`canAnswer`, asked when the list says it
// changed), or the time the first Spent model comes back has passed.
export const aiWaitIsOver = (waiting, { canAnswer = false, now = Date.now() } = {}) => {
  if (!waiting || canAnswer) return true;
  return Number.isFinite(waiting.until) && now >= waiting.until;
};
