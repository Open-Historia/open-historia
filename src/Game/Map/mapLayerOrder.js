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
  // Under every political fill, and showing nothing: it keeps a copy of the
  // bare map, for the ground a battlefield's troops have painted
  // (frontBasemapLayer.js).
  "fronts-basemap-take",
  // Political body / local geography.
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
  // Over every political fill: where a battlefield's ground is painted, the
  // bare map is put back, so the territory's colour behind the paint is seen
  // through (frontBasemapLayer.js).
  "fronts-basemap-put",
  // A group's area tints the land it controls, over every fill and stripe.
  "group-areas-tint",
  // The ground a battlefield's troops have taken, painted in their colour
  // over the bare map put back under it: one picture a battlefield. (The
  // "under" layers clear the ground to a pale grey instead, and are drawn only
  // where the map cannot be copied: FrontLayers.jsx.)
  "fronts-paint-under-0",
  "fronts-paint-under-1",
  "fronts-paint-under-2",
  "fronts-paint-under-3",
  "fronts-paint-under-4",
  "fronts-paint-under-5",
  "fronts-paint-under-6",
  "fronts-paint-under-7",
  "fronts-paint-under-8",
  "fronts-paint-under-9",
  "fronts-paint-under-10",
  "fronts-paint-under-11",
  "fronts-paint-0",
  "fronts-paint-1",
  "fronts-paint-2",
  "fronts-paint-3",
  "fronts-paint-4",
  "fronts-paint-5",
  "fronts-paint-6",
  "fronts-paint-7",
  "fronts-paint-8",
  "fronts-paint-9",
  "fronts-paint-10",
  "fronts-paint-11",
  // The season over the whole map (SeasonLayers.jsx): a faint tint over every
  // fill and every battlefield's paint, under the borders and every name.
  "seasons-tint",
  // Water frozen hard enough to cross, as ice with a light edge (IceLayers.jsx):
  // over the season, laid on the scenario's own regions and, for a region the
  // map repaired, on the repair.
  "ice-fill",
  "ice-fill-repair",
  "ice-cracks",
  "ice-cracks-repair",
  "ice-cracks-b",
  "ice-cracks-b-repair",
  "ice-edge",
  "ice-edge-repair",
  // What the war room shades of a battlefield's ground (WarRoomLayers.jsx: its
  // supply, and a rehearsal's gains and losses): over its paint, under the borders.
  "warroom-shade-fill",

  // Sovereign frontiers are presentation, but must remain above every
  // political fill and below every semantic object/label layer.
  "polity-boundaries-shadow",
  "polity-boundaries",
  // ...and its outline sits above the sovereign borders it may run along.
  "group-areas-outline-casing",
  "group-areas-outline",
  // A scenario's fortified lines (WarGeographyLayers.jsx), over the borders
  // they so often follow: the rubble of a breach, a line still being built,
  // and a standing line with its core and its teeth.
  "war-walls-rubble",
  "war-walls-planned",
  "war-walls-progress",
  "war-walls-casing",
  "war-walls-core",
  "war-walls-teeth",
  // The weather over each battlefield (FrontWeatherLayers.jsx): over its
  // ground and its walls, under the ways its troops came and every label.
  "fronts-weather-wash",
  "fronts-weather-pattern",
  "fronts-weather-pattern-b",
  "fronts-weather-pattern-c",
  // The ways a battlefield's troops have come: a faint line along what they
  // walked long ago, and arrows raised off the map (shadow, edge, face) along
  // their last days, over the borders and under every label.
  "fronts-arrows-past",
  "fronts-arrows-shadow",
  "fronts-arrows-edge",
  "fronts-arrows",

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
  "group-areas-labels",

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

  // A battlefield's troops stand over the cities they fight for, and under the
  // formations that have counters of their own.
  // The war room's planned movements lie under the troops that are to make
  // them (WarRoomLayers.jsx); its marks on the troops are among their layers.
  // Under the movements, the fortified line drawn and waiting to be ordered
  // built, and the names of those there are (WarRoomMarks.jsx; the lines
  // themselves are the map's own, war-walls-* above).
  "warroom-lines-casing",
  "warroom-lines-draft",
  "warroom-lines-label",
  "warroom-plans-casing",
  "warroom-plans",
  "warroom-plans-decoy",
  "warroom-plans-deploy",
  "warroom-plans-spot",
  "warroom-plans-head",
  "warroom-plans-label",
  "fronts-sides-lit",
  "fronts-sides",
  "fronts-sides-count",
  "fronts-troops-lit",
  "fronts-troops-dug",
  "fronts-troops",
  "fronts-troops-picked",
  "fronts-troops-kind",
  "fronts-troops-name",

  // Transporters cross the map over the fronts they sail to (TransportLayers.jsx).
  "transports-way-casing",
  "transports-way",
  "transports-icons",
  "transports-lost",
  // The aircraft each side flies over a battlefield (AirLayers.jsx), with their
  // shadows: over its troops and the transporters crossing to it.
  "fronts-air-shadow",
  "fronts-air",

  // Where the last turns' fleets fought, and the water each blockading fleet
  // closes (SeaBattleLayers.jsx): under the fleets themselves, which have counters.
  "blockades-ring",
  "seabattles-ring",
  "seabattles-mark",
  "seabattles-label",
  "blockades-label",

  // The war room's marks on the player's fleets: the stations and courses
  // they are told, and a ring round each, under its counter (WarRoomMarks.jsx).
  "warroom-fleets-station",
  "warroom-fleets-course",
  "warroom-fleets-head",
  "warroom-fleets-ring",
  // The war room's air strikes: the reach of the air unit picked out, and the rings where their bombs fall.
  "warroom-air-reach",
  "warroom-air-blast",
  "warroom-air-edge",
  "warroom-air-target",

  // Unit counters are interactive operational objects and remain topmost.
  "units-fill",
  "units-icons",
  "units-name",

  // What flies over all of it: missiles, aircraft and what they do where they
  // arrive (StrikeLayers.jsx). Nothing in it can be clicked.
  "strikes-flight",
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
