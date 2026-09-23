/*! Open Historia — what a polity is, in the author's words © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A polity's ROLE: one line of free text saying what this power is — "a
// terrorist organisation", "a street gang", "the rebel side of the civil war",
// "a country claiming this land as its own", or anything else the author types.
// It is how a map says that a claimant is not simply another country: the map
// author writes it for a claimant in the Scenario Workshop, the AI writes it
// when it raises a claim or founds a polity, and the model is shown it wherever
// that polity appears — its claims, its wars, its diplomacy, its dossier.
//
// Free text on purpose. A fixed list of kinds (state / rebel / terrorist /
// criminal) would decide for the author what a claimant may be; the words are
// what the model reads anyway.
//
// Pure and import-free, and under server/ because both the client and the
// server store polity records (the Electron package ships server/ and dist/
// only, so shared code cannot live under src/).

export const POLITY_ROLE_MAX = 240;

// The hint in every field a role is typed into (the Workshop's claimant list
// and Countries panel, the game's Region Inspector).
export const POLITY_ROLE_PLACEHOLDER = "e.g. a terrorist organisation, a gang, one side of a civil war";

// One line: whitespace collapsed, capped. Never throws.
export const normalizePolityRole = (value) => {
  if (value === null || value === undefined || typeof value === "object") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, POLITY_ROLE_MAX).trim();
};

const fold = (value) => String(value ?? "").trim().toLocaleLowerCase();

// The record a name refers to: its own key, a key in another case, or a record
// that lists the name among its aliases or former names.
export const findPolityRecord = (polityOverrides, name) => {
  const registry = polityOverrides && typeof polityOverrides === "object" && !Array.isArray(polityOverrides) ? polityOverrides : {};
  const key = fold(name);
  if (!key) return null;
  if (registry[name] && typeof registry[name] === "object") return registry[name];
  let byAlias = null;
  for (const [recordKey, record] of Object.entries(registry)) {
    if (!record || typeof record !== "object") continue;
    if (fold(recordKey) === key || fold(record.name) === key || fold(record.code) === key) return record;
    if (!byAlias) {
      const names = [...(Array.isArray(record.aliases) ? record.aliases : []), ...(Array.isArray(record.formerNames) ? record.formerNames : [])];
      if (names.some((alias) => fold(alias) === key)) byAlias = record;
    }
  }
  return byAlias;
};

// What a named polity is, or "".
export const polityRoleOf = (polityOverrides, name) => normalizePolityRole(findPolityRecord(polityOverrides, name)?.role);

// "Islamic State (a terrorist organisation)": a name with its role, for the
// model. A name with no role is returned as it is.
export const withPolityRole = (name, role) => {
  const label = String(name ?? "").trim();
  const text = normalizePolityRole(role);
  return label && text ? `${label} (${text})` : label;
};

// The same, looked up in a registry.
export const describePolity = (polityOverrides, name) => withPolityRole(name, polityRoleOf(polityOverrides, name));
