/*! Open Historia — built-structure map layer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import {
  getMarkerPresentation,
  MARKER_VISIBILITY_TIER,
} from "./vnext/presentationPolicy.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// Marker kinds are free-form ("military base", "missile silo", "embassy", …),
// so the on-map shape is picked by keyword: military-flavored structures get a
// triangle, everything else a square — the same glyph family the city layer
// draws with, so the font is guaranteed to have them.
const MILITARY_KIND = /\b(base|fort|fortress|bunker|silo|garrison|missile|radar|airfield|airbase|barracks|outpost|citadel|castle)\b/;

const glyphForKind = (kind) => (MILITARY_KIND.test(kind) ? "▲" : "■");

const MARKER_STATUS_LABEL = {
  planned: "Planned",
  under_construction: "Under construction",
  active: "Active",
  damaged: "Damaged",
  inactive: "Inactive",
  abandoned: "Abandoned",
  destroyed: "Destroyed",
};

const normalizeMarkerStatus = (status) => {
  const key = String(status || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MARKER_STATUS_LABEL, key) ? key : "active";
};

const markerStatusOpacity = (status) => ({
  planned: 0.76,
  under_construction: 0.86,
  active: 1,
  damaged: 0.95,
  inactive: 0.68,
  abandoned: 0.64,
  destroyed: 0.62,
}[normalizeMarkerStatus(status)]);


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

const MarkersLayer = ({ vNext = false }) => {
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
        .map((marker) => {
          const status = normalizeMarkerStatus(marker.status);
          const statusLabel = MARKER_STATUS_LABEL[status];
          const presentation = getMarkerPresentation(marker);
          return {
            type: "Feature",
            id: marker.id,
            geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
            properties: {
              id: marker.id,
              name: marker.name,
              // Lifecycle is encoded by opacity and remains fully described in
              // the feature popup. VNext does not make every map label longer.
              displayName: vNext || status === "active" ? marker.name : `${marker.name} · ${statusLabel}`,
              kind: marker.kind || "landmark",
              ownerCode: marker.ownerCode || "",
              status,
              statusLabel,
              statusOpacity: markerStatusOpacity(status),
              family: presentation.family,
              priority: presentation.priority,
              sortKey: presentation.sortKey,
              visibilityTier: presentation.visibilityTier,
              glyph: vNext ? presentation.glyph : glyphForKind(String(marker.kind || "")),
              rgb: ownerColorString(colorMap, marker.ownerCode),
            },
          };
        }),
    };
  }, [markers, colorMap, vNext]);

  if (vNext) {
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
              "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 7, 13, 11, 17],
            }}
            paint={{
              "text-color": ["get", "rgb"],
              "text-halo-color": "rgba(5, 8, 12, 0.92)",
              "text-halo-width": 1.4,
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
              "text-radial-offset": 0.8,
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
  }

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
          "text-opacity": ["get", "statusOpacity"],
        }}
      />
      <Layer
        id="markers-labels"
        type="symbol"
        minzoom={2.6}
        layout={{
          "text-field": ["get", "displayName"],
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
          "text-opacity": ["get", "statusOpacity"],
        }}
      />
    </Source>
  );
};

export default MarkersLayer;
