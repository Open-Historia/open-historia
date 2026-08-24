/*! Open Historia — owner-name canonicalisation © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// A polity is identified EVERYWHERE by its full country name — "Spain", never "ESP".
// Ownership, colours, flags, tags and the AI's own vocabulary are all keyed that way
// (see server/ownerMigration.js, which migrated stored worlds to it). GADM's three
// letter codes remain only as provenance inside the .pmtiles binaries and on a
// region's `gid0`/`countryCode`; they are not an identity anyone keys off.
//
// The one place a code can still appear is INBOUND: a legacy save written before the
// migration, or a model that answers "ESP" out of habit. Both funnel through here and
// come out as the name, so a code can never enter the world state and mint a phantom
// country sitting alongside the real one ("ESP" painted next to "Spain").
import COUNTRY_NAMES from "./generated/countryNames.js";

// Canonicalises one owner token to its full country name. Anything that is not a
// known GADM code — an invented polity ("Roman Empire"), an era name, a name already
// — is returned untouched, so this is always safe to apply.
export const toCountryName = (token) => {
  const raw = String(token ?? "").trim();
  if (!raw) return "";
  return COUNTRY_NAMES[raw] || COUNTRY_NAMES[raw.toUpperCase()] || raw;
};

// True when the token is a bare GADM code that has a full name to become. Only useful
// for reporting; call sites should just canonicalise unconditionally.
export const isCountryCode = (token) => {
  const raw = String(token ?? "").trim();
  return Boolean(raw) && Boolean(COUNTRY_NAMES[raw] || COUNTRY_NAMES[raw.toUpperCase()]);
};

// ---------------------------------------------------------------------------
// Display names vs identity
//
// A polity is renamed by writing polityOverrides[token].name — the KEY never
// moves, so "Germany" stays the identity while "Third Reich" becomes the label.
// That only holds if every inbound owner is folded back to the token: a model
// that writes a transfer to "Third Reich" (the name it just read in the story)
// would otherwise mint a second owner beside the first, and the world splits in
// two — half the regions keyed "Germany" with the country's colour, tags,
// reputation and stat sheet, half keyed "Third Reich" with none of them and a
// procedural fallback colour on the map.
//
// Hence one shared alias map, built from the polity registry and applied
// wherever an owner enters the world state (gameState.normalizeWorldState and
// applyEventImpactsToWorld) or is compared against one (the AI's region-transfer
// resolver).
// ---------------------------------------------------------------------------

// Case-, diacritic- and punctuation-insensitive identity for an owner token, so
// "Côte d'Ivoire", "cote divoire" and "COTE D'IVOIRE" are one polity. Separators
// are dropped rather than folded to a space: the model spells a name back the way
// it remembers it, and an apostrophe it left out must not make a new country.
export const ownerIdentityKey = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// Every real country's name is an identity of its own and can never be redirected
// to some other polity — the guard that stops a scenario whose polity happens to
// be NAMED "India" from swallowing the actual India's territory.
const COUNTRY_NAME_KEYS = new Set(Object.values(COUNTRY_NAMES).map(ownerIdentityKey));

// polity display name / alias -> the token that polity is keyed by. Names that
// identify someone already (another polity's key, a real country) and names two
// polities both answer to are left out: an ambiguous alias identifies nobody, and
// redirecting one is worse than not resolving it.
export const buildOwnerAliasMap = (polityOverrides) => {
  const rows = [];
  const identities = new Set();

  for (const [key, polity] of Object.entries(polityOverrides ?? {})) {
    if (!polity || typeof polity !== "object") {
      continue;
    }

    const token = String(polity.code ?? "").trim() || String(key ?? "").trim();
    const tokenKey = ownerIdentityKey(token);
    if (!tokenKey) {
      continue;
    }

    identities.add(tokenKey);
    rows.push({
      names: [polity.name, ...(Array.isArray(polity.aliases) ? polity.aliases : [])],
      token,
      tokenKey,
    });
  }

  const aliases = new Map();
  for (const row of rows) {
    for (const name of row.names) {
      const nameKey = ownerIdentityKey(name);
      if (!nameKey || nameKey === row.tokenKey || identities.has(nameKey) || COUNTRY_NAME_KEYS.has(nameKey)) {
        continue;
      }

      const claimed = aliases.get(nameKey);
      // Two polities answering to one name: blank it rather than pick a winner.
      aliases.set(nameKey, claimed !== undefined && claimed !== row.token ? "" : row.token);
    }
  }

  for (const [key, token] of aliases) {
    if (!token) {
      aliases.delete(key);
    }
  }

  return aliases;
};

// The single inbound canonicalisation: a GADM code becomes its country name, and
// a polity's display name or alias becomes the token it is keyed by. Anything
// else is returned untouched, so this is always safe to apply.
export const canonicalOwnerName = (token, aliasMap) => {
  const name = toCountryName(token);
  if (!name || !aliasMap?.size) {
    return name;
  }

  return aliasMap.get(ownerIdentityKey(name)) || name;
};

// Owners repeat across thousands of regions, so fold each distinct string once.
export const createOwnerResolver = (aliasMap) => {
  const cache = new Map();

  return (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }

    const cached = cache.get(raw);
    if (cached !== undefined) {
      return cached;
    }

    const resolved = canonicalOwnerName(raw, aliasMap);
    cache.set(raw, resolved);
    return resolved;
  };
};
