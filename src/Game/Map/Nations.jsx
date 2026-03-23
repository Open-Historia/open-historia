import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Protocol, PMTiles } from "pmtiles";
import { addProtocol } from "maplibre-gl";
import { Source, Layer, useMap } from "react-map-gl/maplibre";
import { onRegionSelected } from "../Selection/Regions";

let pmtilesAdded = false;

const setupProtocol = () => {
  if (!pmtilesAdded) {
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile.bind(protocol));
    pmtilesAdded = true;
  }
};

const COUNTRIES_URL = `pmtiles://${window.location.origin}/saves/save0/countries.pmtiles`;
const COUNTRIES_HTTP_URL = `${window.location.origin}/saves/save0/countries.pmtiles`;
const REGIONS_URL = `pmtiles://${window.location.origin}/saves/save0/regions.pmtiles`;

const decodeTile = async (data) => {
  const { VectorTile } = await import("@mapbox/vector-tile");
  const Pbf = (await import("pbf")).default;
  const tile = new VectorTile(new Pbf(data));
  return tile;
};

const calculateArea = (ring) => {
  let area = 0;
  if (!ring || ring.length < 3) return 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
};

const getCentroid = (ring) => {
  let x = 0, y = 0, area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p1 = ring[i];
    const p2 = ring[j];
    const f = p1[0] * p2[1] - p2[0] * p1[1];
    area += f;
    x += (p1[0] + p2[0]) * f;
    y += (p1[1] + p2[1]) * f;
  }
  const s = (area * 3) || 1;
  return { cx: x / s, cy: y / s };
};

const getPrincipalAxisAngle = (ring) => {
  if (!ring || ring.length < 3) return 0;

  let mx = 0, my = 0;
  for (const p of ring) { mx += p[0]; my += p[1]; }
  mx /= ring.length;
  my /= ring.length;

  let cxx = 0, cxy = 0, cyy = 0;
  for (const p of ring) {
    const dx = p[0] - mx;
    const dy = p[1] - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }

  const angleRad = Math.atan2(2 * cxy, cxx - cyy) / 2;
  let deg = angleRad * (180 / Math.PI);

  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;

  return deg;
};

const tileToLngLat = (px, py, extent = 4096) => {
  const lng = (px / extent) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / extent)));
  const lat = latRad * (180 / Math.PI);
  return [lng, lat];
};

const ringToLngLat = (ring, extent = 4096) =>
ring.map(([px, py]) => tileToLngLat(px, py, extent));

const WorldMap = () => {
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const [labelData, setLabelData] = useState({ type: "FeatureCollection", features: [] });

  const handleRegionClick = useCallback((e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["regions-fill"] });
    if (!features.length) return;
    // Pull GID_0 alongside the existing props
    const { COUNTRY, NAME_1, GID_0 } = features[0].properties;
    onRegionSelected({ COUNTRY, NAME_1, GID_0, lngLat: e.lngLat });
  }, [map]);

  useEffect(() => {
    if (!map) return;
    map.on("click", handleRegionClick);
    return () => map.off("click", handleRegionClick);
  }, [map, handleRegionClick]);

  useEffect(() => {
    setupProtocol();
    fetch("/assets/colors.json")
    .then((res) => {
      if (!res.ok) throw new Error("Colors not found");
      return res.json();
    })
    .then(setColorMap)
    .catch((err) => console.error("Error loading colors:", err));
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const pmtiles = new PMTiles(COUNTRIES_HTTP_URL);
        const tileData = await pmtiles.getZxy(0, 0, 0);
        if (!tileData || !tileData.data) {
          console.error("No tile data at zoom 0");
          return;
        }

        const tile = await decodeTile(tileData.data);
        const layer = tile.layers["countries"];
        if (!layer) {
          console.error("No countries layer in tile. Available layers:", Object.keys(tile.layers));
          return;
        }

        const extent = layer.extent || 4096;
        const registry = new Map();

        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          const props = feature.properties;

          const name = props?.Country || props?.NAME || props?.name || props?.COUNTRY;
          if (!name) continue;

          const geom = feature.loadGeometry();

          let bestRingTile = null, bestAreaTile = -1;
          for (const ring of geom) {
            const arr = ring.map(p => [p.x, p.y]);
            const area = calculateArea(arr);
            if (area > bestAreaTile) {
              bestAreaTile = area;
              bestRingTile = arr;
            }
          }

          if (!bestRingTile) continue;

          const bestRingLngLat = ringToLngLat(bestRingTile, extent);
          const areaLngLat = calculateArea(bestRingLngLat);

          const existing = registry.get(name);
          if (existing && areaLngLat <= existing.areaLngLat) continue;

          const { cx, cy } = getCentroid(bestRingTile);
          const [lng, lat] = tileToLngLat(cx, cy, extent);

          const areaScale = Math.sqrt(areaLngLat) * 17500;
          const rotation = getPrincipalAxisAngle(bestRingTile);

          registry.set(name, {
            areaLngLat,
            feature: {
              type: "Feature",
              id: i,
              geometry: { type: "Point", coordinates: [lng, lat] },
              properties: { name: name.toUpperCase(), areaScale, rotation }
            }
          });
        }

        setLabelData({
          type: "FeatureCollection",
          features: Array.from(registry.values()).map(v => v.feature)
        });

      } catch (err) {
        console.error("Failed to load pmtiles geometry:", err);
      }
    };

    load();
  }, []);

  const fillStyle = useMemo(() => {
    const stops = Object.entries(colorMap).flatMap(([iso, rgb]) => [
      iso, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    ]);

    const fallback = [
      "rgb",
      ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 0, 1], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
      ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 2, 3], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
      ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 1, 2], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]]
    ];

    return {
      "fill-color": stops.length > 0 ? ["match", ["get", "GID_0"], ...stops, fallback] : fallback,
      "fill-opacity": 0.66,
    };
  }, [colorMap]);

  const labelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": [
      "interpolate", ["exponential", 2], ["zoom"],
      0,  ["*", ["get", "areaScale"], ["^", 2, -16]],
      4,  ["*", ["get", "areaScale"], ["^", 2, -12]],
      8,  ["*", ["get", "areaScale"], ["^", 2,  -8]],
      12, ["*", ["get", "areaScale"], ["^", 2,  -4]],
      16, ["*", ["get", "areaScale"], ["^", 2,   0]],
      20, ["*", ["get", "areaScale"], ["^", 2,   4]],
      24, ["*", ["get", "areaScale"], ["^", 2,   8]],
    ],
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false
  }), []);

  const labelLayerPaint = useMemo(() => ({
    "text-color": "#FFFFFF",
    "text-halo-color": "rgba(0, 0, 0, 0.5)",
                                         "text-halo-width": 1,
                                         "text-opacity": [
                                           "interpolate", ["linear"], ["zoom"],
                                           5, 0.75,
                                           8, 0
                                         ]
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

    {/* Region borders — only visible when zoomed in */}
    <Source id="regions-source" type="vector" url={REGIONS_URL}>
    {/* Invisible fill used for click hit-testing */}
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
        12, 1.0
      ],
      "line-opacity": [
        "interpolate", ["linear"], ["zoom"],
        3, 0,
        4, 0.4,
        8, 0.7
      ]
    }}
    />
    </Source>

    <Source id="label-source" type="geojson" data={labelData}>
    <Layer
    id="country-labels"
    type="symbol"
    layout={labelLayerLayout}
    paint={labelLayerPaint}
    />
    </Source>
    </>
  );
};

export default WorldMap;
