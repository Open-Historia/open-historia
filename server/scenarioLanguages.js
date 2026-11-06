/*! Open Historia — a scenario's own language packs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A scenario may ship its own text in other languages, translated once by its
// author's AI in the Workshop (src/runtime/scenarioLanguagePacks.js) rather
// than on every player's device by the translation model:
//
//   languages: {
//     de: { "The Thirty Years' War": "Der Dreißigjährige Krieg", ... },
//     fr: { ... },
//   }
//
// Each pack is keyed by the English the scenario shows (its name, description,
// polity names, region and city names, events, institutions, custom stats...),
// exactly as the game's own packs (public/lang/<code>.json) are, so a string
// is looked up the same way wherever it is rendered. Because the key IS the
// source text, a string the author later rewrites is a new key: its old
// translation no longer matches anything and the new one is missing, which is
// what the Workshop regenerates.
//
// In a game, a player whose interface language has a pack here reads the
// scenario's strings from it first, before the game's packs and the model,
// and no request is made for them (src/runtime/translator.js).
//
// Read as a stranger's: a bundle is a file anybody can write. Only string
// values; only codes that look like a language's; no key that could reach an
// object's prototype; and a cap on the whole, so a scenario cannot make every
// library listing heavy (the catalogs carry only the codes:
// scenarioLanguageCodes).
//
// Pure and dependency-free: the desktop store (server/libraryStore.js), the
// web store (src/runtime/web/models.js), the editor and the suggested-changes
// diff all read the record through these functions, so they never disagree.
// The hub's checks (Open-historia-scenarios, scripts/lib/scenario-languages.mjs)
// hold the same limits.

// The languages a scenario may carry, and how much of each.
export const MAX_SCENARIO_LANGUAGES = 24;
export const MAX_SCENARIO_LANGUAGE_ENTRIES = 20000;
// One source string, and one translation, in characters: an event's
// description is the longest thing a scenario shows.
export const MAX_SCENARIO_LANGUAGE_SOURCE = 4000;
export const MAX_SCENARIO_LANGUAGE_TEXT = 8000;
// Every pack together, as JSON text. What would go past it is left out, from
// the end: the codes in order, each pack's entries as written.
export const MAX_SCENARIO_LANGUAGES_BYTES = 4 * 1024 * 1024;

// A language code as the game writes them (src/runtime/i18n.js LANGUAGES):
// two or three lower-case letters, and an optional region or script.
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
// Never a key: each reaches an object's prototype in some reader.
export const FORBIDDEN_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);
const forbidden = (key) => FORBIDDEN_KEYS.includes(key);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A pack's code, or "" for anything that is not one. English is the source
// language and never has a pack.
export const scenarioLanguageCode = (value) => {
  const code = typeof value === "string" ? value.trim() : "";
  return LANGUAGE_CODE.test(code) && code !== "en" && !forbidden(code) ? code : "";
};

// A source string as packs key it: trimmed, as the game's phrase book trims
// what it looks up (src/runtime/phraseBook.js).
export const scenarioLanguageKey = (value) => (typeof value === "string" ? value.trim() : "");

// Roughly what an entry weighs as JSON: its two strings and their quotes.
const entryBytes = (key, value) => key.length + value.length + 6;

// One pack read strictly: string to string, nothing empty, nothing too long.
const packOf = (raw, budget) => {
  const pack = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (count >= MAX_SCENARIO_LANGUAGE_ENTRIES || budget.left <= 0) break;
    if (typeof rawValue !== "string") continue;
    const key = scenarioLanguageKey(rawKey);
    const value = rawValue.trim();
    if (!key || !value || forbidden(key) || key.length > MAX_SCENARIO_LANGUAGE_SOURCE || value.length > MAX_SCENARIO_LANGUAGE_TEXT) continue;
    if (Object.hasOwn(pack, key)) continue;
    const bytes = entryBytes(key, value);
    if (bytes > budget.left) break;
    budget.left -= bytes;
    pack[key] = value;
    count += 1;
  }
  return count ? pack : null;
};

// The record as it is stored and exported, or null when it holds no
// translation. Codes in order, so two copies of one record compare equal.
export const normalizeScenarioLanguages = (raw) => {
  if (!isRecord(raw)) return null;
  const budget = { left: MAX_SCENARIO_LANGUAGES_BYTES };
  const languages = {};
  // Each code, and the key it was written under (" de" reads as "de").
  const written = new Map();
  for (const key of Object.keys(raw)) {
    const code = scenarioLanguageCode(key);
    if (code && !written.has(code) && isRecord(raw[key])) written.set(code, key);
  }
  for (const code of [...written.keys()].sort().slice(0, MAX_SCENARIO_LANGUAGES)) {
    const pack = packOf(raw[written.get(code)], budget);
    if (pack) languages[code] = pack;
  }
  return Object.keys(languages).length ? languages : null;
};

// The field of a scenario's details and of a bundle's `scenario` object: there
// only while the scenario has a pack, so every other scenario's record and file
// read as they always have.
export const scenarioLanguagesField = (raw) => {
  const languages = normalizeScenarioLanguages(raw);
  return languages ? { languages } : {};
};

// The languages a record has a pack for, in order: what a library listing
// carries instead of the packs themselves.
export const scenarioLanguageCodes = (raw) => Object.keys(normalizeScenarioLanguages(raw) ?? {});

// One language's pack (source -> translation), or an empty one.
export const scenarioLanguagePack = (raw, code) => {
  const wanted = scenarioLanguageCode(code);
  if (!wanted || !isRecord(raw) || !isRecord(raw[wanted])) return {};
  return normalizeScenarioLanguages({ [wanted]: raw[wanted] })?.[wanted] ?? {};
};

// A scenario's details without its packs, for a listing: `languageCodes` says
// which it has. The packs are read by the editor (the details) and by a game
// (one language at a time: GET /api/scenarios/:id/languages/:code).
export const withoutScenarioLanguages = (meta) => {
  if (!isRecord(meta)) return meta;
  const { languages, ...rest } = meta;
  const codes = scenarioLanguageCodes(languages);
  return codes.length ? { ...rest, languageCodes: codes } : rest;
};
