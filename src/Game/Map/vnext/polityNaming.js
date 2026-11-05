/*! Open Historia — Map vNext contextual cartographic naming © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

const clean = (value) => String(value ?? "").trim();

// The fold that decides whether two labels read the same, for a label as the
// player reads it, which may be in any script (runtime/translator.js): folded
// to a-z, every Chinese, Arabic or Cyrillic name was "" and "collided" with
// every other, so each fell back to its English owner.
export const labelFoldKey = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

// The name each polity's label shows, keyed by canonical owner — the namespace
// the boundary worker keys its geometry by, so raw codes or aliases here would
// recreate the old USA-vs-United States class of stale-label mismatch.
// Nations.jsx (workerLabelNames) runs it; the callbacks are the game's own:
//   canonicalOwner — owner code -> the name the map keys it by (toCountryName);
//   displayName(raw, owner) — resolveCountryDisplayName;
//   translate(label) — the player's language pack (translateLabel).
//
// A map label is presentation, never polity identity - and the presentation is
// the scenario designer's: the polity is labelled with the name it was given in
// the map editor (its override name, else the owner token the regions carry). A
// scenario may still hand a polity a cartographic name of its own with
// polityOverrides[owner].mapLabel (or mapDistinctLabel). The stock-country
// geography is deliberately NOT used to shorten "Russian Federation" to
// "Russia": the designer wrote the long form on purpose, and a guessed short
// name is what "Kingdom of Prussia" -> "Prussia" looked like until the same
// rule turned an invented polity into a country.
export const resolvePolityLabelNames = ({
  records = [],
  regionOwnershipOverrides = {},
  polityOverrides = {},
  canonicalOwner = (value) => value,
  displayName = (raw) => raw,
  translate = (label) => label,
} = {}) => {
  const canonical = (value) => clean(canonicalOwner(clean(value)));
  const owners = new Set();
  for (const record of records ?? []) {
    const owner = canonical(record?.owner);
    if (owner) owners.add(owner);
  }
  for (const rawOwner of Object.values(regionOwnershipOverrides ?? {})) {
    const owner = canonical(rawOwner);
    if (owner) owners.add(owner);
  }

  // An override filed under a code and under the name it canonicalises to
  // ("ESP" and "Spain"): the one under the name itself wins.
  const overrideByCanonical = new Map();
  for (const [rawOwner, entry] of Object.entries(polityOverrides ?? {})) {
    const owner = canonical(rawOwner);
    if (!owner) continue;
    owners.add(owner);
    if (!overrideByCanonical.has(owner) || rawOwner === owner) overrideByCanonical.set(owner, entry ?? {});
  }

  const labels = new Map();
  for (const owner of owners) {
    const override = overrideByCanonical.get(owner) ?? {};
    const raw = String(
      override.mapLabel
      || override.mapDistinctLabel
      || override.name
      || owner,
    ).trim();
    labels.set(owner, translate(displayName(raw, owner)) || owner);
  }

  // Authored names are presentation, but duplicate display labels make two
  // different political actors indistinguishable. Fall back to stable owner
  // identity only for the colliding labels.
  const counts = new Map();
  for (const label of labels.values()) {
    const key = labelFoldKey(label);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [owner, label] of labels) {
    if ((counts.get(labelFoldKey(label)) ?? 0) > 1) labels.set(owner, owner);
  }
  return Object.fromEntries(labels);
};

export default resolvePolityLabelNames;
