/*! Open Historia — what the translator translates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/translationRules.test.js
//
// The rules that decide which strings the translator gives the translation
// model on this device (docs/i18n.md, translationModels.js), kept apart from
// the DOM so they can be tested. translator.js holds the state (the phrase
// book, the queue) and asks these:
//
//   - which strings have words to translate at all (isTranslatable), and which
//     are dates, written the player's way by the book (isNumericDate);
//   - where a rendered string the book does not know goes (routeUnknownText):
//     in a language with a shipped pack the interface is never translated live;
//   - which events and which fields of written content are content
//     (isAuthoredEvent, collectContentText).

// Only strings with real words need translating; glyphs, numbers, dates-only
// fragments and emoji stay as-is. The authored language is English, so
// requiring two Latin letters is a safe "has words" test.
export const isTranslatable = (text) => {
  const trimmed = String(text ?? "").trim();
  return trimmed.length > 1 && trimmed.length < 3000 && /[A-Za-z]{2}/.test(trimmed);
};

// A numeric date ("1/8/2016", "2016-01-08") has no words, but is written
// differently in most languages (localDates.js): the book writes it.
export const isNumericDate = (text) => /^\d{1,2}\/\d{1,2}\/\d{4}$|^-?\d{4,6}-\d{2}-\d{2}$/.test(String(text ?? "").trim());

// Where a rendered string the book has nothing for goes:
//   "content"   — a name the scenario made (a region's): to the model as
//                 content;
//   "missing"   — interface text in a language with a shipped pack: it stays
//                 English and is listed for the next pack;
//   "interface" — interface text in a language without a pack: to the model.
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
