/*! Open Historia — map layer stacking order © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The one place that decides what sits above what on the game map.
//
// Nothing that adds a layer to this map passes a beforeId: <Nations>, <Cities>,
// <MarkersLayer> and <Units> all call addLayer() with no anchor, so MapLibre
// appends each one wherever the stack happens to be at that moment. That order
// is NOT stable, because two of those components add layers late:
//
//   * <Cities> returns null on a custom-cities scenario until cities.geojson
//     arrives, then mounts a whole new cities-source — so the city markers and
//     labels are appended ABOVE the unit counters that mounted while it was gone.
//   * regions-disputed only mounts once a disputed region with stripes exists,
//     which needs world state. It is a `fill`, so it lands above the labels AND
//     above the units, painting its stripes over both.
//
// Beyond the obvious overdraw, the stacking order decides the frame rate. With
// 3D terrain on, MapLibre "drapes" a contiguous run of drapeable layers into a
// per-tile texture and flushes that stack on the first layer it cannot drape.
// Every extra stack costs the whole drape cache, not just an extra pass:
// RenderPool.freeAllObjects() runs at the end of every flush, so the next stack
// is handed the previous stack's textures and re-stamps them, and next frame the
// stamps no longer match. A single stray fill or line layer above the labels is
// enough to make every fill and hairline on the map — match-expression
// fill-colour and all — re-render per tile, per frame.
//
// So the order below is canonical, and enforceMapLayerOrder puts the stack back
// into it after every style change.

// Layer types MapLibre can drape onto 3D terrain. Anything else (symbol, circle,
// heatmap, fill-extrusion, custom) is drawn live, in 3D, and ends a drape run.
export const DRAPED_LAYER_TYPES = new Set([
  "background",
  "fill",
  "line",
  "raster",
  "hillshade",
  "color-relief",
]);

// Bottom to top. Only layers this app adds from React appear here — the basemap
// layers baked into buildWorldStyle (satellite, hills, custom-bg-*) are owned by
// the style, always sit at the bottom, and are deliberately left alone.
//
// A NEW LAYER MUST BE ADDED TO THIS LIST. Anything missing from it is never
// moved, so it ends up beneath everything listed here once the first arrangement
// runs — which for a symbol layer means buried under the region fills.
//
// Two placements are load-bearing rather than cosmetic:
//   * units-heading / units-station sit at the END of the draped run, below the
//     label symbols instead of after them. They are `line` layers, so putting
//     them after the labels opens a second drape stack and costs the cache (see
//     above). Below the labels they extend the one run that starts at the
//     basemap raster. The visible cost is that a heading line passes under a
//     city or country label, which is ordinary cartography.
//   * The three counter layers close the list. A unit must never be painted
//     over: the glyph and strength label carry dark halos and stay legible
//     through a translucent fill, but the disc is its owner's colour sitting
//     under that same owner's colour, so it washes out to a ghost.
export const MAP_LAYER_ORDER = [
  // Region fills and their hairlines — the coloured body of the map.
  "countries-fill",
  "countries-outline",
  "regions-fill",
  "regions-disputed",
  "regions-outline",
  // The far tier (custom-regions-fill-far / -hairline-far / -disputed-far) used
  // to sit here, painting unedited GADM regions from the seed GeoJSON below z7 to
  // hide the sliver gaps the tiler leaves between independently-simplified
  // neighbours. It is gone because regionSeedCore.js no longer keeps geometry for
  // those regions — only drawn shapes and reshaped ones survive the index, so
  // there is nothing left to paint. Restoring it means having the worker emit a
  // simplified low-zoom collection, not re-adding these ids.
  "custom-regions-fill",
  "custom-regions-disputed",
  "custom-regions-outline",
  // Standing orders. Draped, so they close the run above rather than following
  // the labels — see the note above.
  "units-heading",
  "units-station",
  // Everything below here is drawn live above the terrain.
  "country-curved-labels",
  "country-labels",
  "cities-shapes",
  "cities-labels",
  "markers-shapes",
  "markers-labels",
  // The counters, always last.
  "units-fill",
  "units-icons",
  "units-name",
];

// Put the stack back into MAP_LAYER_ORDER. Safe to call on every style change:
// it compares the arrangement it wants against the one in place and returns
// without touching anything when they already agree, so the styledata that
// moveLayer itself fires settles instead of looping.
//
// Every layer named above belongs on top of every style-owned basemap layer, so
// arranging them is just moving each one to the top in order — no anchor
// resolution, and no way to land in a half-applied state.
export const enforceMapLayerOrder = (map) => {
  if (!map?.getLayersOrder || !map.getLayer) return false;

  const present = MAP_LAYER_ORDER.filter((id) => map.getLayer(id));
  if (!present.length) return false;

  // getLayersOrder() hands back a copy of the id list, which is what makes this
  // cheap enough to run on every styledata. getStyle() would serialize every
  // layer, and the region fills carry a match stop per region.
  const order = map.getLayersOrder();
  if (order.slice(-present.length).join() === present.join()) return false;

  for (const id of present) map.moveLayer(id);
  return true;
};

// True when the arrangement leaves exactly one draped run, i.e. the terrain
// render-to-texture cache can survive between frames. Exported for the tests —
// the property is the whole point of where units-heading/units-station sit.
export const countDrapeStacks = (map) => {
  let stacks = 0;
  let prevDraped = false;
  for (const id of map.getLayersOrder()) {
    const draped = DRAPED_LAYER_TYPES.has(map.getLayer(id)?.type);
    if (draped && !prevDraped) stacks += 1;
    prevDraped = draped;
  }
  return stacks;
};
