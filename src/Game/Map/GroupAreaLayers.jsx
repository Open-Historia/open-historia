/*! Open Historia — groups' areas on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A group's area (runtime/groups.js) drawn over the countries' own colours: a
// light tint in the group's colour, an outline around the whole area, and the
// group's name. The regions stay their countries'; nothing here is a border.
// The shapes come from the regions worker (vnext/groupAreas.js); this only
// draws them. Stacking is MAP_LAYER_ORDER's (mapLayerOrder.js): the tint above
// every fill and stripe, the outline above the sovereign borders, the name
// below cities, structures and units.
import React from "react";
import { Layer, Source } from "react-map-gl/maplibre";

export const GROUP_AREA_TINT_OPACITY = 0.2;

const OUTLINE_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 1.1, 3, 1.6, 6, 2.4, 9, 3, 12, 3.6];
const CASING_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 2.4, 3, 3.2, 6, 4.4, 9, 5.4, 12, 6.4];

const GroupAreaLayers = ({ data, visible, hasMapLayer }) => {
  if (!data?.fills?.features?.length && !data?.outlines?.features?.length) return null;
  const firstPresent = (ids) => ids.find((id) => hasMapLayer(id));
  const tintBefore = firstPresent(["polity-boundaries-shadow", "polity-boundaries"]);
  const outlineBefore = firstPresent([
    "units-heading", "units-station", "country-curved-labels", "country-line-labels-live-world",
    "country-labels-live-managed", "country-labels", "cities-shapes",
  ]);
  const labelBefore = firstPresent(["cities-shapes", "cities-capitals", "cities-labels", "markers-shapes-strategic", "units-fill"]);
  return (
    <>
      <Source id="group-areas-fill-source" type="geojson" data={data.fills} tolerance={0.6}>
        <Layer
          id="group-areas-tint"
          type="fill"
          beforeId={tintBefore}
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": visible ? GROUP_AREA_TINT_OPACITY : 0,
            "fill-antialias": false,
          }}
        />
      </Source>
      <Source id="group-areas-outline-source" type="geojson" data={data.outlines} tolerance={0.3}>
        <Layer
          id="group-areas-outline-casing"
          type="line"
          beforeId={outlineBefore}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": "rgba(5, 8, 13, 0.9)",
            "line-width": CASING_WIDTH,
            "line-blur": 0.6,
            "line-opacity": visible ? 0.4 : 0,
          }}
        />
        <Layer
          id="group-areas-outline"
          type="line"
          beforeId={outlineBefore}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": ["get", "color"],
            "line-width": OUTLINE_WIDTH,
            "line-opacity": visible ? 0.95 : 0,
          }}
        />
      </Source>
      <Source id="group-areas-label-source" type="geojson" data={data.labels}>
        <Layer
          id="group-areas-labels"
          type="symbol"
          beforeId={labelBefore}
          layout={{
            "text-field": ["get", "group"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 5, 12.5, 8, 15],
            "text-transform": "uppercase",
            "text-letter-spacing": 0.08,
            "text-max-width": 10,
            "symbol-sort-key": ["-", 0, ["get", "regions"]],
          }}
          paint={{
            "text-color": ["get", "color"],
            "text-halo-color": "rgba(5, 8, 13, 0.92)",
            "text-halo-width": 1.5,
            "text-opacity": visible ? 1 : 0,
          }}
        />
      </Source>
    </>
  );
};

export default GroupAreaLayers;
