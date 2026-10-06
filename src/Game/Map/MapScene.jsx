/*! Open Historia — map scene composition © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { useMap } from "react-map-gl/maplibre";
import Nations from "./Nations";
import Cities from "./Cities";
import MarkersLayer from "./MarkersLayer.jsx";
import Units from "./Units";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import UnitPopup from "../Selection/Units";
import FeaturePopup from "../Selection/Features.jsx";
import ListenInPhone from "../GameUI/ListenInPhone.jsx";

// Opt-in only (?mapFillProbe=1, or localStorage oh:mapFillProbe = "1"): a
// diagnostic, not something every player's console and window should carry.
const isMapFillProbeEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mapFillProbe") === "1") return true;
    return window.localStorage?.getItem("oh:mapFillProbe") === "1";
  } catch {
    return false;
  }
};

// Temporary PCPv2 rendered-layer probe. This lives INSIDE the react-map-gl
// context so useMap() hands us the actual active MapLibre instance, avoiding
// outer-ref/remount timing ambiguity while we diagnose the persistent wedges.
const MapFillProbe = () => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!map || typeof window === "undefined") return undefined;

    const politicalFillLayers = () => (map.getStyle?.()?.layers ?? [])
      .filter((layer) => (
        layer?.type === "fill"
        && /(polit|polity|region|countr|disput)/i.test(String(layer?.id ?? ""))
      ));
    const savedOpacity = new Map();

    const describeLayers = () => politicalFillLayers().map((layer) => ({
      id: layer.id,
      source: layer.source ?? "",
      sourceLayer: layer["source-layer"] ?? "",
      visibility: map.getLayoutProperty?.(layer.id, "visibility") ?? "visible",
      fillOpacity: map.getPaintProperty?.(layer.id, "fill-opacity"),
      fillColor: map.getPaintProperty?.(layer.id, "fill-color"),
      fillPattern: map.getPaintProperty?.(layer.id, "fill-pattern"),
    }));

    const restore = () => {
      for (const [layerId, opacity] of savedOpacity) {
        if (!map.getLayer?.(layerId)) continue;
        map.setPaintProperty?.(layerId, "fill-opacity", opacity);
      }
      savedOpacity.clear();
      map.triggerRepaint?.();
      return describeLayers();
    };

    const isolate = (layerIds) => {
      restore();
      const keep = new Set(
        (Array.isArray(layerIds) ? layerIds : [layerIds])
          .map((entry) => String(entry ?? ""))
          .filter(Boolean),
      );
      for (const layer of politicalFillLayers()) {
        const opacity = map.getPaintProperty?.(layer.id, "fill-opacity");
        savedOpacity.set(layer.id, opacity);
        if (!keep.has(layer.id)) map.setPaintProperty?.(layer.id, "fill-opacity", 0);
      }
      map.triggerRepaint?.();
      console.info("[OH MAP FILL PROBE] isolated", [...keep]);
      return describeLayers();
    };

    const inspect = (pointOrLngLat) => {
      let point = pointOrLngLat;
      if (Array.isArray(pointOrLngLat) && pointOrLngLat.length >= 2) {
        point = map.project?.({ lng: Number(pointOrLngLat[0]), lat: Number(pointOrLngLat[1]) });
      } else if (pointOrLngLat?.lng != null && pointOrLngLat?.lat != null) {
        point = map.project?.(pointOrLngLat);
      }
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
        throw new Error("inspect() expects a MapLibre screen point or [lng, lat]");
      }
      const layerIds = politicalFillLayers().map((layer) => layer.id);
      const features = layerIds.length
        ? map.queryRenderedFeatures?.(point, { layers: layerIds }) ?? []
        : [];
      const rows = features.map((feature) => ({
        layer: feature?.layer?.id ?? "",
        source: feature?.source ?? feature?.layer?.source ?? "",
        sourceLayer: feature?.sourceLayer ?? feature?.layer?.["source-layer"] ?? "",
        id: feature?.id ?? feature?.properties?.id ?? feature?.properties?.GID_1 ?? "",
        owner: feature?.properties?._liveOwner
          ?? feature?.properties?.owner
          ?? feature?.properties?.GID_0
          ?? "",
        name: feature?.properties?.name ?? feature?.properties?.NAME_1 ?? "",
        geometryType: feature?.geometry?.type ?? "",
      }));
      console.table(rows);
      console.info("[OH MAP FILL PROBE] point", point, "features", features);
      return { point, rows, features };
    };

    const pick = () => {
      console.info("[OH MAP FILL PROBE] click the center of a visible wedge");
      map.once?.("click", (event) => {
        const result = inspect(event.point);
        console.info(
          "[OH MAP FILL PROBE] clicked",
          [event.lngLat?.lng, event.lngLat?.lat],
          result.rows,
        );
      });
    };

    const probe = { map, layers: describeLayers, inspect, pick, isolate, restore };
    window.__OH_MAP__ = map;
    window.__OH_MAP_FILL_PROBE__ = probe;
    console.info(
      "[OH MAP FILL PROBE] ready (MapScene/useMap). Use window.__OH_MAP_FILL_PROBE__.layers(), .pick(), .isolate(id), .restore().",
    );

    return () => {
      restore();
      if (window.__OH_MAP__ === map) delete window.__OH_MAP__;
      if (window.__OH_MAP_FILL_PROBE__ === probe) delete window.__OH_MAP_FILL_PROBE__;
    };
  }, [map]);

  return null;
};

// The camera/basemap shell lives in World.jsx. Everything that is projected
// into that world lives here, in deliberate paint/placement order. Keeping the
// scene graph behind one boundary keeps layer changes decoupled from
// projection, terrain, or GPU lifecycle.
const MapScene = ({ isGlobe = false }) => {
  const fillProbeEnabled = React.useMemo(() => isMapFillProbeEnabled(), []);
  return (
    <>
      {fillProbeEnabled && <MapFillProbe />}
      <Nations isGlobe={isGlobe} />
      <Cities />
      <MarkersLayer />
      <Units />
      <GlobeEffects active={isGlobe} />
      <RegionPopup />
      <CountryInfoPanel />
      <UnitPopup />
      <FeaturePopup />
      <ListenInPhone />
    </>
  );
};

export default MapScene;
