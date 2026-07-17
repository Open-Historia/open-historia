/*! Open Historia — country tags © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// What a country IS, in short traits: "socialist", "authoritarian", "anti-nato".
// The map-maker sets the starting tags in the editor (tags.json on the scenario);
// the AI reads them as context for everything that country does and rewrites them
// as the world changes, which lands in world.countryTags.
//
// This module owns the two rules both halves must agree on — how a tag list is
// normalized, and which source wins — so the editor and the runtime cannot drift.
// It deliberately imports nothing: the editor, the game and the server all use it.

export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 32;

// Suggestions only — the vocabulary is open. Alt-history is the product, so a
// closed list could never cover it; these exist so the common cases converge on
// one spelling instead of "anti-nato" / "anti nato" / "antiNATO" splitting the
// model's attention three ways.
export const TAG_SUGGESTIONS = [
  "socialist", "communist", "capitalist", "social-democratic", "liberal",
  "conservative", "fascist", "monarchist", "theocratic", "technocratic",
  "authoritarian", "totalitarian", "democratic", "one-party", "military-junta",
  "nato-aligned", "anti-nato", "warsaw-pact", "non-aligned", "neutral",
  "great-power", "regional-power", "client-state", "puppet-state", "colonial",
  "nuclear", "isolationist", "expansionist", "revanchist", "pariah",
];

// Trim, collapse whitespace, cap length, drop blanks, dedupe case-insensitively,
// cap count. Non-strings are dropped rather than coerced: colors.json is
// code -> [r,g,b], and a number reaching a tag list means that palette has leaked
// in — which should vanish, not render as "102".
export const normalizeTagList = (list, { maxTags = MAX_TAGS, maxLen = MAX_TAG_LEN } = {}) => {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= maxTags) break;
  }
  return out;
};

// The tags in force right now for one country: the AI's live list if it has ever
// set one, else the author's starting list. NOT a merge — a revolution that
// dropped "socialist" must not have it restored by the scenario file underneath.
// Keyed by the country's NAME, verbatim. The uppercasing this used to do worked
// only while owners were GADM codes, which are already uppercase — with names it
// looked up baseTags["RUSSIA"] for a tags.json keyed "Russia" and every author tag
// silently vanished.
export const resolveCountryTags = (baseTags, world, country) => {
  const key = String(country || "").trim();
  if (!key) return [];
  const live = world?.countryTags?.[key];
  if (Array.isArray(live)) return normalizeTagList(live);
  return normalizeTagList(baseTags?.[key]);
};

// Every country that has tags, live list winning over the author's. Used to build
// the world summary the model reads.
export const resolveAllCountryTags = (baseTags, world) => {
  const out = {};
  for (const country of new Set([
    ...Object.keys(baseTags || {}),
    ...Object.keys(world?.countryTags || {}),
  ])) {
    const tags = resolveCountryTags(baseTags, world, country);
    // Emit the key verbatim. Uppercasing here fed "RUSSIA" into the model's world
    // summary while polityOverrides said "Russia" — the same string in two cases.
    if (tags.length) out[String(country)] = tags;
  }
  return out;
};
