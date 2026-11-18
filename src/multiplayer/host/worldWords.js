/*! Open Historia — what the host writes into a shared world, in the world's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A shared world is written in one language, a rule of the game the host sets
// in the lobby (host/settings.js `language`). The AI writes its events in it.
// What the host's own game writes into the world without asking the AI, a
// peace two players make between rounds or a treaty they sign
// (host/landings.js), was English whatever the world's language: kept for good
// among events the AI wrote in Japanese, and left as it is by every screen's
// translator, which reads such events as written in the world's language
// already (runtime/translationRules.js isAuthoredEvent).
//
// So the host writes them from the language pack the game ships for the
// world's language (public/lang/<code>.json): every pattern the host writes is
// one of the interface catalog's, translated there. No model is asked: a peace
// still costs no request (rule 3). A language with no shipped pack, or a pack
// that lacks a pattern, gets the English for it.
//
// Names stay exactly as the world has them (polity names are exact): only the
// words around them are the language's, and names in a list are joined as that
// language joins them.
//
// Pure: the pack is handed in.

import { createPhraseBook, fillSlots } from "../../runtime/phraseBook.js";

const englishList = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// { say(pattern, values), word(text), list(names) } (runtime/peaceTerms.js termsInWords).
export const ENGLISH_WORDS = Object.freeze({
  say: (pattern, values = {}) => fillSlots(pattern, values),
  word: (text) => text,
  list: (names) => englishList((Array.isArray(names) ? names : []).map(String)),
});

// The words of `code`'s pack (an object, English pattern → translation, as
// public/lang/<code>.json holds it), falling back to English for what it lacks.
export const worldWordsOf = (pack, code = "") => {
  const language = String(code ?? "").trim();
  if (!language || language === "en" || !pack || typeof pack !== "object" || Array.isArray(pack)) return ENGLISH_WORDS;
  const book = createPhraseBook();
  book.setAll(pack);
  let joiner = null;
  try {
    joiner = typeof Intl?.ListFormat === "function" ? new Intl.ListFormat(language, { style: "long", type: "conjunction" }) : null;
  } catch {
    joiner = null;
  }
  return Object.freeze({
    language,
    say: (pattern, values = {}) => book.format(pattern, values) ?? fillSlots(pattern, values),
    word: (text) => book.get(text) ?? text,
    list: (names) => {
      const all = (Array.isArray(names) ? names : []).map(String);
      return joiner ? joiner.format(all) : englishList(all);
    },
  });
};
