import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { onRegionSelected } from "../Selection/Regions";
import {
  PMTILES_PROTOCOL_URLS,
  ensurePmtilesProtocol,
  getNationColors,
} from "../../runtime/assets.js";
import { loadCountryLabelCollections } from "../../runtime/countryLabels.js";

ensurePmtilesProtocol();

const COUNTRIES_URL = PMTILES_PROTOCOL_URLS.countries;
const REGIONS_URL = PMTILES_PROTOCOL_URLS.regions;
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const buildCountryTextSize = (multiplier = 1) => ([
  "interpolate", ["exponential", 2], ["zoom"],
  0, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -16]]],
  4, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -12]]],
  8, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -8]]],
  12, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -4]]],
  16, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, 0]]],
  20, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, 4]]],
  24, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, 8]]],
]);

const WorldMap = () => {
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const [pointLabelData, setPointLabelData] = useState(EMPTY_FEATURE_COLLECTION);
  const [curvedLabelData, setCurvedLabelData] = useState(EMPTY_FEATURE_COLLECTION);

  const handleRegionClick = useCallback((event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: ["regions-fill"] });
    if (!features.length) return;

    const { COUNTRY, NAME_1, GID_0 } = features[0].properties;
    onRegionSelected({ COUNTRY, NAME_1, GID_0, lngLat: event.lngLat });
  }, [map]);

  useEffect(() => {
    if (!map) return;
    map.on("click", handleRegionClick);
    return () => map.off("click", handleRegionClick);
  }, [handleRegionClick, map]);

  useEffect(() => {
    getNationColors()
      .then(setColorMap)
      .catch((error) => console.error("Error loading colors:", error));
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadCountryLabelCollections()
      .then(({ pointLabelData: pointLabels, curvedLabelData: curvedLabels }) => {
        if (cancelled) return;
        setPointLabelData(pointLabels);
        setCurvedLabelData(curvedLabels);
      })
      .catch((error) => console.error("Failed to load country labels:", error));

    return () => {
      cancelled = true;
    };
  }, []);

  const fillStyle = useMemo(() => {
    const stops = Object.entries(colorMap).flatMap(([iso, rgb]) => [
      iso, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    ]);

    const fallback = [
      "rgb",
      ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 0, 1], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
      ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 2, 3], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
      ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 1, 2], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
    ];

    return {
      "fill-color": stops.length > 0 ? ["match", ["get", "GID_0"], ...stops, fallback] : fallback,
      "fill-opacity": 0.66,
    };
  }, [colorMap]);

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
  }), []);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
  }), []);

  const labelLayerPaint = useMemo(() => ({
    "text-color": "#FFFFFF",
    "text-halo-color": "rgba(0, 0, 0, 0.5)",
    "text-halo-width": 1,
    "text-opacity": [
      "interpolate", ["linear"], ["zoom"],
      5, 0.75,
      8, 0,
    ],
  }), []);

  return (
    <>
      <Source id="countries-source" type="vector" url={COUNTRIES_URL}>
        <Layer
          id="countries-fill"
          type="fill"
          source-layer="countries"
          paint={fillStyle}
        />
        <Layer
          id="countries-outline"
          type="line"
          source-layer="countries"
          paint={{ "line-color": "#000", "line-width": 0.5 }}
        />
      </Source>

      <Source id="regions-source" type="vector" url={REGIONS_URL}>
        <Layer
          id="regions-fill"
          type="fill"
          source-layer="regions"
          paint={{ "fill-color": "transparent", "fill-opacity": 0 }}
        />
        <Layer
          id="regions-outline"
          type="line"
          source-layer="regions"
          paint={{
            "line-color": "#000",
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              3, 0.2,
              8, 0.6,
              12, 1.0,
            ],
            "line-opacity": [
              "interpolate", ["linear"], ["zoom"],
              3, 0,
              4, 0.4,
              8, 0.7,
            ],
          }}
        />
      </Source>

      <Source id="country-curved-label-source" type="geojson" data={curvedLabelData}>
        <Layer
          id="country-curved-labels"
          type="symbol"
          layout={curvedLabelLayerLayout}
          paint={labelLayerPaint}
        />
      </Source>

      <Source id="country-point-label-source" type="geojson" data={pointLabelData}>
        <Layer
          id="country-labels"
          type="symbol"
          layout={pointLabelLayerLayout}
          paint={labelLayerPaint}
        />
      </Source>
    </>
  );
};

export default WorldMap;
