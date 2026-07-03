/*! Open Historia — troop/unit map layer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { subscribeUnits, getUnits, startUnitsSync } from "./unitsController.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// On-map glyph per unit type (rendered via the same font stack as the city
// symbols, so they appear wherever those do).
const TYPE_GLYPH = {
  infantry: "I",
  armor: "A",
  air: "F",
  naval: "N",
  artillery: "G",
  garrison: "C",
};

const ownerColorString = (colorMap, code) => {
  const rgb = colorMap[code];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const normalized = String(code ?? "").toUpperCase();
  if (normalized.length < 2) return "rgb(120, 120, 120)";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[normalized.length - 1]));
  return `rgb(${72 + a * 5}, ${72 + c * 5}, ${72 + b * 5})`;
};

const Units = () => {
  const [units, setUnits] = useState(getUnits());
  const [colorMap, setColorMap] = useState({});

  useEffect(() => {
    const stop = startUnitsSync();
    const unsubscribe = subscribeUnits(() => setUnits(getUnits()));
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  useEffect(() => {
    getNationColors()
      .then(setColorMap)
      .catch((error) => console.error("Failed to load colors for units:", error));
  }, []);

  const data = useMemo(() => {
    if (!units.length) return EMPTY_FEATURE_COLLECTION;
    return {
      type: "FeatureCollection",
      features: units
        .filter((unit) => Number.isFinite(unit.lng) && Number.isFinite(unit.lat))
        .map((unit) => ({
          type: "Feature",
          id: unit.id,
          geometry: { type: "Point", coordinates: [unit.lng, unit.lat] },
          properties: {
            id: unit.id,
            name: unit.name,
            type: unit.type,
            ownerCode: unit.ownerCode,
            strength: unit.strength,
            status: unit.status,
            glyph: TYPE_GLYPH[unit.type] ?? "I",
            rgb: ownerColorString(colorMap, unit.ownerCode),
          },
        })),
    };
  }, [units, colorMap]);

  return (
    <Source id="units-source" type="geojson" data={data}>
      <Layer
        id="units-fill"
        type="circle"
        paint={{
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 7, 6, 11, 12, 16],
          "circle-color": ["get", "rgb"],
          // Pending (player-requested, not yet AI-resolved) units are translucent.
          "circle-opacity": ["case", ["==", ["get", "status"], "pending"], 0.32, 0.92],
          "circle-stroke-width": ["case", ["==", ["get", "status"], "pending"], 1.5, 2],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "status"], "pending"], "#93c5fd",
            ["==", ["get", "status"], "moving"], "#ffd24a",
            ["==", ["get", "status"], "engaged"], "#ff6b6b",
            "#ffffff",
          ],
          "circle-stroke-opacity": ["case", ["==", ["get", "status"], "pending"], 0.55, 1],
          "circle-pitch-alignment": "map",
        }}
      />
      <Layer
        id="units-icons"
        type="symbol"
        layout={{
          "symbol-sort-key": ["-", ["get", "strength"]],
          "text-field": ["get", "glyph"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 13, 12, 18],
        }}
        paint={{
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.65)",
          "text-halo-width": 1,
          "text-opacity": ["case", ["==", ["get", "status"], "pending"], 0.5, 1],
        }}
      />
      <Layer
        id="units-strength"
        type="symbol"
        minzoom={3}
        layout={{
          "symbol-sort-key": ["-", ["get", "strength"]],
          "text-field": ["to-string", ["get", "strength"]],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-offset": [0, 1.35],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 8, 11, 12, 13],
        }}
        paint={{
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.85)",
          "text-halo-width": 1.2,
        }}
      />
    </Source>
  );
};

export default Units;
