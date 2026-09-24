/*! Open Historia — the phrase book: translations looked up exactly or by pattern © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Translations are keyed by the English as the game renders it. The shipped
// packs (public/lang/<code>.json, built by scripts/i18n/) hold every fixed
// string of the interface, and most are exact: "Save game". A string the game
// builds around a value is a PATTERN, the value written as a double-brace slot:
// "Found {{count}} regions", "{{name}} declared war on {{target}}". Its
// translation may put the slots wherever its grammar needs them ("{{count}}
// Regionen gefunden"). A slot's value is itself looked up, so "Edit {{label}}"
// over "Edit Borders" reads "Grenzen bearbeiten" once "Borders" is known.
//
// Pure (no DOM, no storage): the translator (translator.js) asks it about text
// nodes and attributes, and the tests ask it directly.

const SLOT = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g;

// A pattern with less literal text than this is WEAK: "by {{author}}",
// "Our {{label}}". Anchored at both ends it can still match prose that happens
// to start with its words (a model's reply in another chat language: "Our
// forces are ready…"), so a weak pattern only takes a few words of value.
const STRONG_LETTERS = 8;
const WEAK_MAX_VALUE_WORDS = 4;
// A value never spans sentences unless the pattern around it is substantial:
// a template does not wrap a paragraph in a few words.
const SENTENCE_LETTERS = 16;
const MEMO_LIMIT = 5000;
const LIST_SEPARATOR = / [/·•|] /;
const LIST_SPLIT = /( [/·•|] )/;

const collapse = (text) => text.replace(/\s+/g, " ").trim();
const letterCount = (text) => (text.match(/\p{L}/gu) ?? []).length;
const wordCount = (text) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Literal text between slots: any run of whitespace matches any other, so a
// line break or a double space in the rendered text is no miss.
const literalSource = (text) => text.split(/\s+/).map(escapeRegex).join("\\s+");

export const isPatternKey = (text) => typeof text === "string" && text.includes("{{") && new RegExp(SLOT.source).test(text);

// One pattern, compiled; null for a key without a slot or without any words
// outside its slots (it would match anything).
export const compilePattern = (english, translated) => {
  if (typeof english !== "string" || typeof translated !== "string") return null;
  const key = english.trim();
  const slots = [];
  const literals = [];
  let source = "^";
  let last = 0;
  for (const match of key.matchAll(SLOT)) {
    const literal = key.slice(last, match.index);
    literals.push(literal);
    source += `${literalSource(literal)}([\\s\\S]*?)`;
    slots.push(match[1]);
    last = match.index + match[0].length;
  }
  if (!slots.length) return null;
  // Two slots with nothing between them cannot be told apart: the pattern
  // "{{charAt}}{{slice}} of {{overlord}}" would split any "Kingdom of Spain".
  if (literals.slice(1).some((literal) => !literal)) return null;
  const tail = key.slice(last);
  literals.push(tail);
  source += `${literalSource(tail)}$`;
  const literalText = literals.join(" ");
  const strength = letterCount(literalText);
  if (!strength) return null;
  // The longest literal word: a cheap test before the regex runs.
  const anchor = (literalText.match(/\p{L}+/gu) ?? []).reduce((best, word) => (word.length > best.length ? word : best), "");
  return {
    anchor,
    english: key,
    literalLength: collapse(literalText).length,
    regex: new RegExp(source, "u"),
    slots,
    strength,
    translated,
  };
};

// The translation with each slot filled. A slot named twice takes its values in
// order; a slot the translation names but the English lacks is dropped rather
// than shown in braces.
const fill = (template, slots, values) => {
  const queues = new Map();
  slots.forEach((name, index) => {
    if (!queues.has(name)) queues.set(name, []);
    queues.get(name).push(values[index]);
  });
  const used = new Map();
  return template.replace(SLOT, (_whole, name) => {
    const queue = queues.get(name);
    if (!queue) return "";
    const index = used.get(name) ?? 0;
    used.set(name, index + 1);
    return queue[Math.min(index, queue.length - 1)];
  });
};

const acceptsValues = (pattern, values) => {
  if (pattern.strength < STRONG_LETTERS) {
    const words = values.reduce((total, value) => total + wordCount(value), 0);
    if (words > WEAK_MAX_VALUE_WORDS) return false;
  }
  if (pattern.strength < SENTENCE_LETTERS && values.some((value) => /[.!?。！？]\s+\S/u.test(value))) return false;
  return true;
};

// `localizeValue` (optional): a rule for text no entry has but that can still be
// put into the player's language, a date for one (localDates.js). It is asked
// about a whole string the book does not know, and about each value in a
// pattern ("Round {{round}} · {{date}}").
export const createPhraseBook = ({ localizeValue = null } = {}) => {
  // English (as extracted, and whitespace-collapsed) → translation.
  const exact = new Map();
  // Pattern keys → translation; compiled lazily, most specific first.
  const patternEntries = new Map();
  let patterns = null;
  const memo = new Map();

  const compiled = () => {
    if (!patterns) {
      patterns = [];
      for (const [english, translated] of patternEntries) {
        const pattern = compilePattern(english, translated);
        if (pattern) patterns.push(pattern);
      }
      patterns.sort((a, b) => b.strength - a.strength || b.literalLength - a.literalLength);
    }
    return patterns;
  };

  const changed = () => {
    memo.clear();
  };

  const set = (english, translated) => {
    if (typeof english !== "string" || typeof translated !== "string") return;
    const key = english.trim();
    const value = translated.trim();
    if (!key || !value) return;
    if (isPatternKey(key)) {
      patternEntries.set(key, value);
      patterns = null;
    } else {
      exact.set(key, value);
      const collapsed = collapse(key);
      if (collapsed !== key) exact.set(collapsed, value);
    }
    changed();
  };

  const setAll = (entries) => {
    const list = entries instanceof Map ? entries.entries() : Object.entries(entries ?? {});
    for (const [english, translated] of list) set(english, translated);
  };

  const get = (text) => {
    if (typeof text !== "string") return undefined;
    const key = text.trim();
    return exact.get(key) ?? exact.get(collapse(key));
  };

  const byRule = (text) => {
    if (!localizeValue) return null;
    try {
      return localizeValue(text) ?? null;
    } catch {
      return null;
    }
  };

  const matchPattern = (text) => {
    for (const pattern of compiled()) {
      if (pattern.anchor && !text.includes(pattern.anchor)) continue;
      if (text.length > pattern.english.length + 300) continue;
      const match = pattern.regex.exec(text);
      if (!match) continue;
      const values = match.slice(1);
      if (!acceptsValues(pattern, values)) continue;
      // A weak pattern's value is a number or a name; words and numbers
      // together ("Found 12" before "{{value}} regions") are the start of some
      // other sentence, unless the book knows them (a date).
      if (pattern.strength < STRONG_LETTERS && values.some((value) => {
        const inner = value.trim();
        return /\p{L}/u.test(inner) && /\d/.test(inner) && get(inner) === undefined && byRule(inner) == null;
      })) continue;
      // A value the book knows is translated too ("Edit Borders"), and a date,
      // and a list: a last slot runs to the end, so "Playing as {{country}}"
      // over "Playing as France · Jan 1, 2016" holds the whole "France · …".
      const translatedValues = values.map((value) => {
        const inner = value.trim();
        if (!inner) return value;
        const known = get(inner) ?? byRule(inner) ?? byParts(inner);
        return known == null ? value : value.replace(inner, () => known);
      });
      return fill(pattern.translated, pattern.slots, translatedValues).trim();
    }
    return null;
  };

  // A list the game joins with " / " or " · " ("Modern Day Session / Japan /
  // 2016-01-01"): no pattern holds it, having no words of its own, so each
  // part is looked up by itself. Only when some part is known; dashes are not
  // separators, since prose uses them.
  const byParts = (text) => {
    if (text.length > 240 || !LIST_SEPARATOR.test(text)) return null;
    const parts = text.split(LIST_SPLIT);
    if (parts.length > 15) return null;
    let changed = false;
    const out = parts.map((part, index) => {
      const inner = part.trim();
      if (index % 2 === 1 || !inner) return part;
      const known = get(inner) ?? byRule(inner) ?? (patternEntries.size ? matchPattern(inner) : null);
      if (known == null) return part;
      changed = true;
      return part.replace(inner, () => known);
    });
    return changed ? out.join("") : null;
  };

  // The translation of a whole string (already trimmed by the caller or not),
  // or null when the book has nothing for it.
  const translate = (text) => {
    if (typeof text !== "string") return null;
    const key = text.trim();
    if (!key) return null;
    const known = get(key);
    if (known !== undefined) return known;
    if (memo.has(key)) return memo.get(key);
    const result = byRule(key) ?? (patternEntries.size ? matchPattern(key) : null) ?? byParts(key);
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(key, result);
    return result;
  };

  return {
    get,
    has: (text) => get(text) !== undefined,
    patternCount: () => patternEntries.size,
    set,
    setAll,
    size: () => exact.size + patternEntries.size,
    translate,
  };
};
