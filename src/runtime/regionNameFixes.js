/*! Open Historia — GADM region-name corrections © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A handful of GADM level-1 regions ship with no usable NAME_1. The value is not an
// abbreviation — it is the literal string "NA" (R's missing-value marker, which GADM
// is exported from) or "?", and it flows straight through to the map panel and to the
// AI's region vocabulary. The worst case is England: "the majority of Britain" renders
// nameless, and because the AI's region catalog is built from the same field, the model
// cannot name England in a regionTransfer either — so England can never change hands.
//
// Only ids whose real name is unambiguous are corrected here. Each was confirmed from
// the seed by centroid AND by which sibling name is missing from that country's set:
//   GBR.1_1  centroid -2.30, 51.94 — siblings are Scotland/Wales/Northern Ireland
//   IRL.4_1  centroid -9.28, 51.69 — the only one of Ireland's 26 counties missing
//   NLD.14_1 centroid  4.50, 51.96 — the only Dutch province missing (Rotterdam area)
// The remaining placeholders are unidentifiable slivers (an unassigned Shetland-area
// polygon with no country, a Ukrainian artifact whose id is literally "?", and one
// Marshall Islands atoll); they are treated as UNNAMED rather than guessed at.
export const REGION_NAME_FIXES = {
  "GBR.1_1": "England",
  "IRL.4_1": "Cork",
  "NLD.14_1": "Zuid-Holland",
};

// Matched case-insensitively against the trimmed name. Deliberately tight: a real
// region name must never be mistaken for a placeholder, so this holds only markers
// that cannot be a genuine toponym.
const PLACEHOLDER_NAMES = new Set(["", "na", "n/a", "null", "nan", "?"]);

export const isPlaceholderRegionName = (value) =>
  PLACEHOLDER_NAMES.has(String(value ?? "").trim().toLowerCase());

// The name a region should be shown and referred to by. Returns "" when the source
// name is a placeholder and no correction is known — callers already treat a nameless
// region as one to skip (the AI catalog) or leave blank (the map panel), which is
// better than surfacing "NA" as if it were the place's actual name.
export const resolveRegionName = (id, rawName) => {
  const fixed = REGION_NAME_FIXES[String(id ?? "").trim()];
  if (fixed) return fixed;
  return isPlaceholderRegionName(rawName) ? "" : String(rawName ?? "").trim();
};
