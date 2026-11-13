/*! Open Historia — the key a name is looked up by © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whether two names are the same name, wherever the game looks a name up whole:
// a polity's key, name, aliases and former names, a palette's or a flag's key,
// a political actor or party, the region or polity a camera flies to. One fold,
// in every script, of case and spacing only:
//   - case: "РОССИЯ" is "Россия", "ΕΛΛΑΔΑ" is "Ελλάδα";
//   - accents, the combining diacritics (U+0300-U+036F) and nothing else:
//     "Côte d'Ivoire" is "Cote d'Ivoire". A Devanagari or Thai vowel sign or a
//     kana voicing mark is part of its word and stays;
//   - spacing and punctuation: "Guinea-Bissau" is "Guinea Bissau", and an
//     apostrophe left out makes no new country.
// No word is dropped, added or guessed: "Republic of China" is not "China",
// and "Russia" is not "Russian Federation" (two names, two polities).
//
// It replaces the folds that kept only a-z and 0-9, under which every Russian,
// Chinese or Arabic name was the same empty key: a renamed "Россия" left its
// regions on the old name, a declared "Россия" resolved to nobody, and a
// programme owned by "中国" counted as the player's own. An empty key is no
// name, and sameName never matches it.
//
// Shared by the server (polityRename.js) and the client, so it lives under
// server/ and imports nothing.

// A fold depends on nothing but the text, and the same few hundred names are
// folded thousands of times in one time skip, so each answer is kept. The store
// is emptied when it passes MEMO_LIMIT names, so a long session cannot fill
// memory with names it no longer uses.
const MEMO_LIMIT = 20000;
const memo = new Map();

const fold = (text) => text
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

// The key a name is looked up by: "" for no name.
export const nameKey = (value) => {
  const text = typeof value === "string" ? value : String(value ?? "");
  let key = memo.get(text);
  if (key === undefined) {
    key = fold(text);
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(text, key);
  }
  return key;
};

// True when both are the same name. A name that folds to nothing is no name and
// matches nothing, itself included.
export const sameName = (left, right) => {
  const key = nameKey(left);
  return key !== "" && key === nameKey(right);
};
