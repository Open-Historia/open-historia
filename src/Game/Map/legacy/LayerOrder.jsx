/*! Open Historia — map layer stacking order © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Keeps the map stacked in MAP_LAYER_ORDER. Renders nothing.
//
// This is the ONLY thing on the map allowed to reorder layers. Two components
// each re-asserting their own layers on styledata would take turns moving each
// other's work and never settle, so the canonical order lives in mapLayerOrder.js
// and exactly one subscriber applies it.

import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";

const LayerOrder = () => {
  const { current: map } = useMap();

  useEffect(() => {
    const mapInstance = map?.getMap?.() ?? map;
    if (!mapInstance?.on) return undefined;

    const arrange = () => enforceMapLayerOrder(mapInstance);

    // styledata is what announces an addLayer, a style reload, or a projection
    // change — every way the stack can be disturbed.
    arrange();
    mapInstance.on("styledata", arrange);
    return () => mapInstance.off("styledata", arrange);
  }, [map]);

  return null;
};

export default LayerOrder;
