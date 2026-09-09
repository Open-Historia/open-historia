/*! Open Historia — owner-name canonicalisation © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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
