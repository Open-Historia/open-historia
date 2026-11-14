/*! Open Historia — the id a name is given © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wherever the game makes an id out of a name or a title: a war from its two
// sides, a puppet's coup storyline, an agent from its target, a letter from its
// sender, a scripted beat, a marker, a party, a flag, a stored map. One rule:
//   - a name whose letters and digits are all a-z and 0-9 once case and
//     accents are folded ("Côte d'Ivoire", "Baltic & Nordic Union") keeps the
//     slug it always had, byte for byte, so the ids a saved game holds are the
//     ids its names are still given;
//   - a name with any other letter or digit in it ("Россия", "中国",
//     "Событие 1", "Straße") is given "u-" and a hash of the whole name, case
//     and accents folded: the same name the same id, on every reading and
//     every machine, and two names two ids.
// Those slugs kept a-z and 0-9 and nothing else, so every name written in
// Cyrillic, Chinese or Arabic was one id ("", or the fallback word after it),
// and a name with a number in it was that number: two coup storylines of two
// Russian-named puppets were one storyline, two wars started on one day
// between countries named in Chinese were one war, so the second was refused,
// "Событие 1" and "Задача 1" were the same scripted beat, and a recall of one
// agent recalled every agent sent to a country named in another script.
//
// The hash is the one runtime/stableId.js already gave a name with no a-z or
// 0-9 in it at all, so those ids are unchanged too.
//
// Shared by the server (gameFeatures.js, the stores) and the client, so it lives
// under server/ and imports nothing.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const MARKS = /[̀-ͯ]/g;

// The name as its id reads it: lower case, accents off, and no letter lost.
// (Checked lowered once more, so a sign that comes apart into Latin capitals,
// "™" into "TM", is as Latin as the slug that always read it.)
const folded = (value) => clean(value).toLowerCase().normalize("NFKD").replace(MARKS, "");

// A letter or a digit that an a-z slug drops: any letter but a-z, any digit but 0-9.
const OUTSIDE_A_Z = /[^\P{L}a-z]|[^\P{N}0-9]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// cyrb53: 53 bits, written in base 36.
const hash53 = (text) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

// Whether every letter and digit of a name is a-z or 0-9 once case and accents
// are folded: a name an a-z slug reads whole. A name with no letter or digit at
// all is one too (its slug is empty, as it always was).
export const isLatinName = (value) => !OUTSIDE_A_Z.test(folded(value).toLowerCase());

// The slug most of the game's ids were made with: lower case, accents off,
// every run of anything but a-z and 0-9 one "-", none at either end, at most
// `max` characters (none for no limit).
export const latinSlug = (value, max = 0) => {
  const slug = clean(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return max > 0 ? slug.slice(0, max) : slug;
};

// The id a name is given. `latin` is how the caller has always made the id of
// a Latin name (latinSlug unless it says otherwise), and is used for exactly
// those. Any other name is "u-" and the hash of its folded whole. "" only for a
// name with no letter or digit in it, for the caller's fallback.
export const nameId = (value, latin = latinSlug) => {
  const name = folded(value);
  if (!OUTSIDE_A_Z.test(name.toLowerCase())) {
    const slug = latin(value);
    // (A Latin form that read nothing of a name with letters in it, such as
    // a slug lowered by a Turkish locale, is no id: the hash is.)
    if (slug || !LETTER_OR_DIGIT.test(name)) return slug;
  }
  return `u-${hash53(name)}`;
};
