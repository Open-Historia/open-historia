/*! Open Historia — country tags © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

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
//
// "client-state" and "puppet-state" are deliberately NOT here. A subordination
// is a modelled relationship now (world.puppets), and a tag saying the same
// thing is a second answer to one question that nothing keeps in step. The
// vocabulary is open, so a model may still write either as free text — nothing
// steers it there, and an old save carrying one keeps it harmlessly as flavour.
export const TAG_SUGGESTIONS = [
  "socialist", "communist", "capitalist", "social-democratic", "liberal",
  "conservative", "fascist", "monarchist", "theocratic", "technocratic",
  "authoritarian", "totalitarian", "democratic", "one-party", "military-junta",
  "nato-aligned", "anti-nato", "warsaw-pact", "non-aligned", "neutral",
  "great-power", "regional-power", "colonial",
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
// The names a polity was keyed by before it was renamed (polityRename.js).
const formerNamesOf = (world, key) => {
  const record = world?.polityOverrides?.[key];
  return Array.isArray(record?.formerNames) ? record.formerNames.map((name) => String(name ?? "").trim()).filter(Boolean) : [];
};

// The current key of a name the scenario's tags were written under: the polity
// that was renamed away from it, if any.
const currentKeyFor = (world, name) => {
  const wanted = String(name ?? "").trim().toLowerCase();
  for (const [key, record] of Object.entries(world?.polityOverrides ?? {})) {
    if (Array.isArray(record?.formerNames) && record.formerNames.some((former) => String(former ?? "").trim().toLowerCase() === wanted)) return key;
  }
  return name;
};

export const resolveCountryTags = (baseTags, world, country) => {
  const key = String(country || "").trim();
  if (!key) return [];
  const live = world?.countryTags?.[key];
  if (Array.isArray(live)) return normalizeTagList(live);
  if (baseTags?.[key] != null) return normalizeTagList(baseTags[key]);
  // A renamed polity's starting tags are keyed by the name the scenario knew.
  for (const former of formerNamesOf(world, key)) {
    if (baseTags?.[former] != null) return normalizeTagList(baseTags[former]);
  }
  return [];
};

// Every country that has tags, live list winning over the author's. Used to build
// the world summary the model reads.
export const resolveAllCountryTags = (baseTags, world) => {
  const out = {};
  for (const country of new Set([
    ...Object.keys(baseTags || {}).map((name) => currentKeyFor(world, name)),
    ...Object.keys(world?.countryTags || {}),
  ])) {
    const tags = resolveCountryTags(baseTags, world, country);
    // Emit the key verbatim. Uppercasing here fed "RUSSIA" into the model's world
    // summary while polityOverrides said "Russia" — the same string in two cases.
    if (tags.length) out[String(country)] = tags;
  }
  return out;
};
