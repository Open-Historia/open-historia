/*! Open Historia — frozen water on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Make frozen areas look frozen too so you know its frozen by looking" (the
// owner). Water frozen hard enough for troops to cross (world.frozenRegions,
// as the last turn left it: iceFeatures.js) is covered in ice: a thin pale
// tint the basemap shows through, cracked all over (two tiles of wandering
// cracks of prime sizes, so they do not repeat to the eye: mapPatterns.js),
// with a crisp light edge. It is shown whatever the
// Seasons and weather switch says, since it changes where troops can go.
// Water that can freeze and has not is not marked at all: "frozen water
// shouldnt be marked as ice either, just show the visuals" (the owner,
// 2026-10-14).
//
// The ice is laid on the regions the map already draws (Nations.jsx), by id:
// these layers are on the scenario's own regions' source, and on the repair
// source for a region the map had to repair, which is drawn in its place.
// Those sources come and go with the map's style and its scenario, and the
// layers with them (useLayerOrder.js puts them back in their place).

import React, { useEffect, useMemo, useState } from "react";
import { Layer, useMap } from "react-map-gl/maplibre";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { featureIdsOf, iceFilters, iceRegionIds } from "./iceFeatures.js";
import { ICE_LAYERS, ICE_TINT, iceImageId, icePattern } from "./mapPatterns.js";
import { useLayerOrder } from "./useLayerOrder.js";

const OWN = "custom-regions-source";
const REPAIR = "custom-regions-repair-source";
const LAYERS = ["ice-fill", "ice-fill-repair", "ice-cracks", "ice-cracks-repair", "ice-cracks-b", "ice-cracks-b-repair", "ice-edge", "ice-edge-repair"];
const NONE = Object.freeze([]);
const selectFrozen = (world) => (Array.isArray(world?.frozenRegions) ? world.frozenRegions : NONE);

// The ice thin enough for the map under it to show ("the frozen water doesnt show the basemap behind it, it should").
const ICE_PAINT = { "fill-color": ICE_TINT, "fill-opacity": 0.3 };
const CRACK_PAINT = ICE_LAYERS.map((_, layer) => ({ "fill-pattern": iceImageId(layer), "fill-opacity": 0.9 }));
const EDGE_LAYOUT = { "line-join": "round" };
const EDGE_PAINT = {
  "line-color": "#eef6ff",
  "line-opacity": 0.95,
  "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 6, 1.6, 10, 2.4],
};

// The pictures the ice is drawn with: put on the map when it has not got
// them, after every change of style (which takes a map's images away), and the
// moment the map asks for one it lacks.
const PICTURES = Object.fromEntries(ICE_LAYERS.map((_, layer) => [iceImageId(layer), () => icePattern(layer)]));
const provide = (map, id) => {
  try {
    if (Object.hasOwn(PICTURES, id) && !map.hasImage(id)) map.addImage(id, PICTURES[id](), { pixelRatio: 1 });
  } catch { /* the map is between styles: asked again when the next one has loaded */ }
};

// The ids of the regions the repair source draws (Nations.jsx), read again
// when that source is made, given new data or taken away. [] while there is none.
const useRepairedIds = (map, active) => {
  const [ids, setIds] = useState(NONE);
  useEffect(() => {
    if (!map || !active) return undefined;
    let alive = true;
    let timer = 0;
    let present = null;
    const keep = (next) => setIds((was) => (was.join("\u0000") === next.join("\u0000") ? was : next));
    const read = () => {
      let source = null;
      try {
        source = map.style ? map.getSource(REPAIR) : null;
      } catch { /* the map is gone */ }
      present = Boolean(source);
      if (!source?.getData) {
        keep(NONE);
        return;
      }
      source.getData().then((data) => {
        if (alive) keep(featureIdsOf(data));
      }).catch(() => {});
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 120);
    };
    // (A tile of it loading is not new data.)
    const onSource = (event) => {
      if (event?.sourceId === REPAIR && !event.tile) later();
    };
    const onStyle = () => {
      let has = false;
      try {
        has = Boolean(map.style && map.getSource(REPAIR));
      } catch { /* the map is gone */ }
      if (has !== present) later();
    };
    read();
    map.on("sourcedata", onSource);
    map.on("styledata", onStyle);
    return () => {
      alive = false;
      clearTimeout(timer);
      map.off("sourcedata", onSource);
      map.off("styledata", onStyle);
    };
  }, [map, active]);
  return ids;
};

const IceLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const frozenRaw = useRuntimeState("world", selectFrozen);

  const { frozen } = useMemo(() => iceRegionIds({ frozen: frozenRaw }), [frozenRaw]);
  const any = frozen.length > 0;
  const repaired = useRepairedIds(map, any);
  const filters = useMemo(() => iceFilters({ frozen, repaired }), [frozen, repaired]);

  useEffect(() => {
    if (!map || !any) return undefined;
    const again = () => Object.keys(PICTURES).forEach((id) => provide(map, id));
    const asked = (event) => provide(map, event?.id);
    again();
    map.on("styledata", again);
    map.on("styleimagemissing", asked);
    return () => {
      map.off("styledata", again);
      map.off("styleimagemissing", asked);
    };
  }, [map, any]);
  useLayerOrder(map, LAYERS, any);

  if (!any) return null;
  return (
    <>
      {filters.frozen.own && <Layer id="ice-fill" type="fill" source={OWN} filter={filters.frozen.own} paint={ICE_PAINT} />}
      {filters.frozen.repair && <Layer id="ice-fill-repair" type="fill" source={REPAIR} filter={filters.frozen.repair} paint={ICE_PAINT} />}
      {filters.frozen.own && <Layer id="ice-cracks" type="fill" source={OWN} filter={filters.frozen.own} paint={CRACK_PAINT[0]} />}
      {filters.frozen.repair && <Layer id="ice-cracks-repair" type="fill" source={REPAIR} filter={filters.frozen.repair} paint={CRACK_PAINT[0]} />}
      {filters.frozen.own && <Layer id="ice-cracks-b" type="fill" source={OWN} filter={filters.frozen.own} paint={CRACK_PAINT[1]} />}
      {filters.frozen.repair && <Layer id="ice-cracks-b-repair" type="fill" source={REPAIR} filter={filters.frozen.repair} paint={CRACK_PAINT[1]} />}
      {filters.frozen.own && <Layer id="ice-edge" type="line" source={OWN} filter={filters.frozen.own} layout={EDGE_LAYOUT} paint={EDGE_PAINT} />}
      {filters.frozen.repair && <Layer id="ice-edge-repair" type="line" source={REPAIR} filter={filters.frozen.repair} layout={EDGE_LAYOUT} paint={EDGE_PAINT} />}
    </>
  );
};

export default IceLayers;
