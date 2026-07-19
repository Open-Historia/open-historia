/*! Open Historia — built-structure map layer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// Marker kinds are free-form ("military base", "missile silo", "embassy", …),
// so the on-map shape is picked by keyword: military-flavored structures get a
// triangle, everything else a square — the same glyph family the city layer
// draws with, so the font is guaranteed to have them.
const MILITARY_KIND = /\b(base|fort|fortress|bunker|silo|garrison|missile|radar|airfield|airbase|barracks|outpost|citadel|castle)\b/;

const glyphForKind = (kind) => (MILITARY_KIND.test(kind) ? "▲" : "■");

const ownerColorString = (colorMap, code) => {
  const rgb = colorMap[String(code ?? "").trim()];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  // Unowned / unknown-owner structures read as neutral parchment, not an error.
  return "rgb(226, 222, 205)";
};

// World.markers — structures founded during play (cities, military bases,
// bunkers, missile silos, embassies…). Rendered in the visual language of the
// city layer (glyph + haloed label) but colored by owner so a forward base
// reads as belonging to someone.
const MarkersLayer = () => {
  const { markers } = useWorldState();
  const [colorMap, setColorMap] = useState({});

  useEffect(() => {
    getNationColors()
      .then(setColorMap)
      .catch((error) => console.error("Failed to load colors for markers:", error));
  }, []);

  const data = useMemo(() => {
    if (!markers.length) return EMPTY_FEATURE_COLLECTION;
    return {
      type: "FeatureCollection",
      features: markers
        .filter((marker) => Number.isFinite(marker.lng) && Number.isFinite(marker.lat) && marker.name)
        .map((marker) => ({
          type: "Feature",
          id: marker.id,
          geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
          properties: {
            id: marker.id,
            name: marker.name,
            kind: marker.kind || "landmark",
            ownerCode: marker.ownerCode || "",
            glyph: glyphForKind(String(marker.kind || "")),
            rgb: ownerColorString(colorMap, marker.ownerCode),
          },
        })),
    };
  }, [markers, colorMap]);

  return (
    <Source id="markers-source" type="geojson" data={data}>
      <Layer
        id="markers-shapes"
        type="symbol"
        layout={{
          "text-field": ["get", "glyph"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-padding": 2,
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9, 6, 14, 10, 20],
        }}
        paint={{
          "text-color": ["get", "rgb"],
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        }}
      />
      <Layer
        id="markers-labels"
        type="symbol"
        minzoom={2.6}
        layout={{
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-padding": 5,
          "text-radial-offset": 0.7,
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 8.5, 10, 10],
          "text-variable-anchor": ["top", "bottom", "left", "right"],
        }}
        paint={{
          "text-color": "#ffffff",
          "text-halo-color": "#333333",
          "text-halo-width": 2,
        }}
      />
    </Source>
  );
};

export default MarkersLayer;
