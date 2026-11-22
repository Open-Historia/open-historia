/*!
 * Open Historia Map Editor - native region marquee and movement selection.
 * Stable region IDs remain the source of truth. No map features are cloned.
 */

// Rectangle selection includes regions actually touching the rectangle (not
// merely regions whose bounding boxes overlap it). Shift adds to the existing
// selection; a regular drag replaces it.
export const regionsInRectangle = (source, extent, currentIds = [], additive = false) => {
  const ids = additive ? [...new Set(currentIds)] : [];
  if (!source || !Array.isArray(extent) || extent.length !== 4) return ids;
  const seen = new Set(ids);
  source.forEachFeatureInExtent(extent, (feature) => {
    const id = feature.getId();
    if (id == null || seen.has(id) || !feature.getGeometry()?.intersectsExtent(extent)) return;
    ids.push(id);
    seen.add(id);
  });
  return ids;
};

// The group interaction acts on the REAL selected features only. The fallback
// single-region Translate is filtered to ignore selected features so the group
// interaction can claim their pointerdown without a duplicate drag.
export const selectedMoveFeatures = (source, selectedIds = []) => {
  if (!source || !Array.isArray(selectedIds)) return [];
  const seen = new Set();
  const result = [];
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const feature = source.getFeatureById(id);
    if (feature?.getGeometry()) result.push(feature);
  }
  return result;
};
