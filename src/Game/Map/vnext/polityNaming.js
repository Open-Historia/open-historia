/*! Open Historia — Map vNext contextual cartographic naming © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import COUNTRY_NAMES from "../../../runtime/generated/countryNames.js";
import { resolveStockCountryCode } from "../../../runtime/polityIdentity.js";

const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLocaleLowerCase().replace(/\s+/g, " ");

const normalizeRefs = (...values) => [...new Set(
  values
    .flat(Infinity)
    .map((value) => clean(value).toUpperCase())
    .filter((value) => Boolean(COUNTRY_NAMES[value])),
)];

const surfaceRefs = (feature, override) => normalizeRefs(
  feature?.properties?.gadm0,
  override?.mapRefs?.gadm0,
);

const uniqueStockName = (owner, refs) => {
  if (refs.length === 1) return clean(COUNTRY_NAMES[refs[0]]);
  const code = resolveStockCountryCode(owner);
  return code ? clean(COUNTRY_NAMES[code]) : "";
};

// A map label is presentation, never polity identity. We use geography only
// when it is unambiguous in the LIVE map. If two current actors occupy the same
// homeland (civil war, rival governments, competing restorations), both fall
// back to their distinct current regime names. There is deliberately no
// adjective stemming or country-name word list here: "Polish" is never guessed
// into "Poland", and an invented polity keeps its authored name.
export const resolveContextualPolityLabels = (politySurfaces, polityOverrides = {}) => {
  const features = Array.isArray(politySurfaces?.features) ? politySurfaces.features : [];
  const entries = features
    .map((feature) => {
      const owner = clean(feature?.properties?.owner);
      if (!owner) return null;
      const override = polityOverrides?.[owner] ?? {};
      const currentName = clean(override.name) || owner;
      const refs = surfaceRefs(feature, override);
      const geographicName = clean(override.mapLabel) || uniqueStockName(owner, refs);
      return {
        owner,
        currentName,
        distinctName: clean(override.mapDistinctLabel) || currentName,
        geographicName,
        refs,
      };
    })
    .filter(Boolean);

  const refUse = new Map();
  const geographicUse = new Map();
  for (const entry of entries) {
    for (const ref of entry.refs) refUse.set(ref, (refUse.get(ref) || 0) + 1);
    if (entry.geographicName) {
      const key = fold(entry.geographicName);
      geographicUse.set(key, (geographicUse.get(key) || 0) + 1);
    }
  }

  const labels = new Map();
  for (const entry of entries) {
    const contestedGeography = entry.refs.some((ref) => (refUse.get(ref) || 0) > 1);
    const duplicateGeographicName = entry.geographicName
      && (geographicUse.get(fold(entry.geographicName)) || 0) > 1;
    labels.set(
      entry.owner,
      contestedGeography || duplicateGeographicName || !entry.geographicName
        ? entry.distinctName
        : entry.geographicName,
    );
  }

  // The distinct names are authored data, but malformed/imported scenarios can
  // still contain duplicates. Fail toward stable full identity, never toward two
  // indistinguishable labels.
  const finalUse = new Map();
  for (const label of labels.values()) finalUse.set(fold(label), (finalUse.get(fold(label)) || 0) + 1);
  for (const entry of entries) {
    const current = labels.get(entry.owner);
    if ((finalUse.get(fold(current)) || 0) > 1) labels.set(entry.owner, entry.owner);
  }

  return labels;
};

export default resolveContextualPolityLabels;
