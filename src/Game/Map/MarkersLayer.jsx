/*! Open Historia — built-structure map layer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import { createOwnerRgbResolver, ownerDisplayCss } from "./ownerColors.js";
import { MARKER_VISIBILITY_TIER } from "./vnext/presentationPolicy.js";
import { buildMarkerFeatureCollection, UNOWNED_MARKER_COLOR } from "./markerFeatures.js";

// World.markers — structures founded during play (cities, military bases,
// bunkers, missile silos, embassies…). Rendered in the visual language of the
// city layer (glyph + haloed label) but colored by owner so a forward base
// reads as belonging to someone.
const V_NEXT_TIER_LAYERS = [
  {
    tier: MARKER_VISIBILITY_TIER.strategic,
    shapeId: "markers-shapes-strategic",
    labelId: "markers-labels-strategic",
    shapeMinZoom: 3.0,
    labelMinZoom: 3.8,
  },
  {
    tier: MARKER_VISIBILITY_TIER.regional,
    shapeId: "markers-shapes-regional",
    labelId: "markers-labels-regional",
    shapeMinZoom: 4.2,
    labelMinZoom: 5.0,
  },
  {
    tier: MARKER_VISIBILITY_TIER.local,
    shapeId: "markers-shapes-local",
    labelId: "markers-labels-local",
    shapeMinZoom: 5.8,
    labelMinZoom: 6.6,
  },
];

const MarkersLayer = () => {
  const { markers, polityOverrides } = useWorldState();
  const [colorMap, setColorMap] = useState({});

  // Re-read the palette whenever colors.json is written (a polity founded or
  // recoloured mid-game; assets.js drops its cached palette first) or another
  // game opens, as Units.jsx does; read once, a base built by a new polity
  // stayed parchment until a reload. A failed read is retried by the next write.
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const refreshColors = () => {
      const current = ++generation;
      getNationColors()
        .then((next) => {
          if (!cancelled && current === generation) setColorMap(next);
        })
        .catch((error) => console.error("Failed to load colors for markers:", error));
    };
    refreshColors();
    window.addEventListener("oh:colors-updated", refreshColors);
    window.addEventListener("oh:active-game-changed", refreshColors);
    return () => {
      cancelled = true;
      window.removeEventListener("oh:colors-updated", refreshColors);
      window.removeEventListener("oh:active-game-changed", refreshColors);
    };
  }, []);
  const resolveOwnerRgb = useMemo(
    () => createOwnerRgbResolver(colorMap, polityOverrides),
    [colorMap, polityOverrides],
  );

  // Unowned structures read as neutral parchment, not an error. An owned one
  // takes its owner's colour exactly as the territory shows it (ownerColors.js),
  // painted over the features markerFeatures.js builds.
  const data = useMemo(() => {
    const collection = buildMarkerFeatureCollection(markers, { colorMap, polityOverrides });
    for (const feature of collection.features) {
      feature.properties.rgb = ownerDisplayCss(resolveOwnerRgb, feature.properties.ownerCode, UNOWNED_MARKER_COLOR);
    }
    return collection;
  }, [markers, colorMap, polityOverrides, resolveOwnerRgb]);

  return (
    <Source id="markers-source" type="geojson" data={data}>
        {V_NEXT_TIER_LAYERS.map((entry) => (
          <Layer
            key={entry.shapeId}
            id={entry.shapeId}
            type="symbol"
            beforeId="country-curved-labels"
            minzoom={entry.shapeMinZoom}
            filter={["==", ["get", "visibilityTier"], entry.tier]}
            layout={{
              "symbol-sort-key": ["get", "sortKey"],
              "text-field": ["get", "glyph"],
              "text-allow-overlap": true,
              "text-ignore-placement": false,
              "text-padding": 3,
              // Half again the city glyph's size: a structure is a single point
              // that has to be found and clicked, and at 9px it vanished into
              // the relief at continental zoom.
              "text-size": ["interpolate", ["linear"], ["zoom"], 3, 13, 7, 19, 11, 25],
            }}
            paint={{
              "text-color": ["get", "rgb"],
              "text-halo-color": "rgba(5, 8, 12, 0.92)",
              "text-halo-width": 1.8,
              "text-halo-blur": 0.25,
              "text-opacity": ["get", "statusOpacity"],
            }}
          />
        ))}
        {V_NEXT_TIER_LAYERS.map((entry) => (
          <Layer
            key={entry.labelId}
            id={entry.labelId}
            type="symbol"
            beforeId="country-curved-labels"
            minzoom={entry.labelMinZoom}
            filter={["==", ["get", "visibilityTier"], entry.tier]}
            layout={{
              "symbol-sort-key": ["get", "sortKey"],
              "text-field": ["get", "displayName"],
              "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
              "text-padding": 6,
              "text-radial-offset": 1.2,
              "text-size": ["interpolate", ["linear"], ["zoom"], 4, 8.5, 10, 10.5],
              "text-variable-anchor": ["top", "bottom", "left", "right"],
              "text-max-width": 16,
            }}
            paint={{
              "text-color": "rgba(247, 246, 240, 0.96)",
              "text-halo-color": "rgba(5, 8, 12, 0.92)",
              "text-halo-width": 1.35,
              "text-halo-blur": 0.35,
              "text-opacity": ["get", "statusOpacity"],
            }}
          />
        ))}
      </Source>
  );
};

export default MarkersLayer;
