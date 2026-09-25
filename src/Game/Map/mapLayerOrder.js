/*! Open Historia — canonical current-renderer map layer stacking © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Political Cartography Pipeline v2 separates political truth (region fills)
// from presentation (boundaries, labels, cities, objects, units). React mount
// order cannot enforce that separation by itself because several sources mount
// asynchronously after world/scenario data arrives. MapLibre appends a late
// layer at the top unless it is explicitly reordered, which lets a political
// fill paint over boundaries and object/symbol layers.
//
// This list is the single current-renderer authority for bottom -> top order.
export const MAP_LAYER_ORDER = [
  // Political body / local geography.
  "countries-fill",
  "countries-outline",
  "custom-regions-fill-far",
  "custom-regions-repair-fill-far",
  "regions-fill",
  "regions-disputed",
  "regions-outline",
  "custom-regions-fill",
  "custom-regions-repair-fill",
  "ownership-transition-flood",
  "ownership-transition-sweep-fill",
  "custom-regions-local-outline",
  "custom-regions-repair-local-outline",
  "custom-regions-disputed-vnext",

  // Sovereign frontiers are presentation, but must remain above every
  // political fill and below every semantic object/label layer.
  "polity-boundaries-shadow",
  "polity-boundaries",

  // Draped standing-order lines belong above map cartography but below symbols.
  "units-heading",
  "units-station",

  // Political labels.
  "country-curved-labels",
  "country-line-labels-live-world",
  "country-line-labels-live-detail",
  "country-labels-live-managed",
  "country-labels-live-overlap",
  "country-labels",
  // PTR-0 replacement typography proof. It intentionally sits above the old
  // polity symbols while both systems coexist, and below cities/objects.
  "polity-text-renderer",

  // Physical/world objects must never be buried by political cartography.
  "cities-shapes",
  "cities-capitals",
  "cities-labels",
  "markers-shapes-strategic",
  "markers-labels-strategic",
  "markers-shapes-regional",
  "markers-labels-regional",
  "markers-shapes-local",
  "markers-labels-local",

  // Unit counters are interactive operational objects and remain topmost.
  "units-fill",
  "units-icons",
  "units-name",
];

const NATGEO_REFERENCE_TIER_METADATA_KEY = "openhistoria:natgeo-reference-tier";

const getNatGeoReferenceLayerIds = (map) => {
  const styleLayers = map?.getStyle?.()?.layers;
  if (!Array.isArray(styleLayers)) return { lines: [], labels: [] };
  const lines = [];
  const labels = [];
  for (const layer of styleLayers) {
    const tier = layer?.metadata?.[NATGEO_REFERENCE_TIER_METADATA_KEY];
    if (tier === "line") lines.push(layer.id);
    else if (tier === "label") labels.push(layer.id);
  }
  return { lines, labels };
};

export const buildEffectiveMapLayerOrder = (map) => {
  const { lines: natGeoLines, labels: natGeoLabels } = getNatGeoReferenceLayerIds(map);
  if (!natGeoLines.length && !natGeoLabels.length) return MAP_LAYER_ORDER;

  const order = [];
  for (const id of MAP_LAYER_ORDER) {
    order.push(id);
    // NatGeo's roads, coastlines and administrative borders must sit above OH
    // fills to remain visible, but below canonical OH sovereign borders.
    if (id === "custom-regions-disputed-vnext") order.push(...natGeoLines);
    // NatGeo reference text/icons (cities, admin1 names, water/terrain, roads)
    // must also sit above the political fill. Keep them below OH's own polity
    // typography and operational overlays so canonical labels stay dominant.
    if (id === "polity-boundaries") order.push(...natGeoLabels);
  }
  return order;
};

export const enforceMapLayerOrder = (map) => {
  if (!map?.getLayersOrder || !map.getLayer || !map.moveLayer) return false;

  const effectiveOrder = buildEffectiveMapLayerOrder(map);
  const present = effectiveOrder.filter((id) => map.getLayer(id));
  if (!present.length) return false;

  const current = map.getLayersOrder();
  if (current.slice(-present.length).join("\u0000") === present.join("\u0000")) {
    return false;
  }

  // Move known app/reference layers to the top one-by-one in canonical
  // bottom->top order. Untagged style-owned basemap material stays underneath.
  for (const id of present) map.moveLayer(id);
  return true;
};
