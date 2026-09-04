/*! Open Historia — Map vNext contextual cartographic naming © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLocaleLowerCase().replace(/\s+/g, " ");

// A map label is presentation, never polity identity - and the presentation is
// the scenario designer's: the polity is labelled with the name it was given in
// the map editor (its override name, else the owner token the regions carry),
// exactly as the previous renderer did. A scenario may still hand a polity a
// cartographic name of its own with polityOverrides[owner].mapLabel. The
// stock-country geography (gadm0 references) is deliberately NOT used to
// shorten "Russian Federation" to "Russia": the designer wrote the long form
// on purpose, and a guessed short name is what "Kingdom of Prussia" -> "Prussia"
// looked like until the same rule turned an invented polity into a country.
export const resolveContextualPolityLabels = (politySurfaces, polityOverrides = {}) => {
  const features = Array.isArray(politySurfaces?.features) ? politySurfaces.features : [];
  const entries = features
    .map((feature) => {
      const owner = clean(feature?.properties?.owner);
      if (!owner) return null;
      const override = polityOverrides?.[owner] ?? {};
      const currentName = clean(override.name) || owner;
      return {
        owner,
        label: clean(override.mapLabel) || clean(override.mapDistinctLabel) || currentName,
      };
    })
    .filter(Boolean);

  const labels = new Map();
  for (const entry of entries) labels.set(entry.owner, entry.label);

  // The names are authored data, but malformed/imported scenarios can still
  // contain duplicates. Fail toward stable full identity, never toward two
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
