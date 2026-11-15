/*! Open Historia — what the diplomatic map draws over the fills © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Over the regions' fills, which carry each view's colours (Nations.jsx), the
// diplomatic map draws:
//   - hatching: ceasefires, puppets, occupied land, an institution's candidates
//     and suspended members (diplomaticHatch.js), cut from the regions worker
//     as group areas are (vnext/groupAreas.js);
//   - the outline round the whole of an institution's land (Blocs);
//   - the borders where belligerents meet, lit, and the focus country's own
//     border (Relations), filtered from the sovereign borders already drawn by
//     the pair of owners each segment carries: no new geometry;
//   - thin lines from the focus country's capital to its allies' and enemies'
//     (diplomaticSeats.js).
// Stacking is MAP_LAYER_ORDER's (mapLayerOrder.js).
import React from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import { BLOC_OUTLINE_COLOR, LINE_COLORS, RELATION_COLORS } from "../../runtime/diplomaticPalette.js";
import { hatchPatternExpression } from "./diplomaticHatch.js";
import { focusFilter, frontFilter } from "./diplomaticBorderFilters.js";

const EMPTY = Object.freeze({ type: "FeatureCollection", features: [] });
const HATCH_PATTERN = hatchPatternExpression();

const FRONT_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 1.6, 4, 2.6, 8, 3.6, 12, 4.6];
const FRONT_CASING_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 3.4, 4, 5, 8, 6.6, 12, 8];
const FOCUS_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 1.4, 4, 2.2, 8, 3, 12, 3.8];
const OUTLINE_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 1.3, 3, 1.8, 6, 2.6, 9, 3.2, 12, 3.8];
const OUTLINE_CASING_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 2.8, 3, 3.6, 6, 4.8, 9, 5.8, 12, 6.8];
const LINE_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 1.1, 4, 1.6, 8, 2.2];
const LINE_CASING_WIDTH = ["interpolate", ["linear"], ["zoom"], 1, 2.6, 4, 3.4, 8, 4.4];


const DiplomaticLayers = ({ active, hatch, outlines, lines, seat, frontPairs, focusOwners, hasMapLayer }) => {
  const firstPresent = (ids) => ids.find((id) => hasMapLayer(id));
  const overFills = firstPresent(["fronts-basemap-put", "group-areas-tint", "polity-boundaries-shadow", "polity-boundaries"]);
  const overBorders = firstPresent(["group-areas-outline-casing", "war-walls-rubble", "units-heading", "country-curved-labels"]);
  const underLabels = firstPresent(["units-heading", "units-station", "country-curved-labels"]);
  const on = Boolean(active);
  return (
    <>
      <Source id="diplomatic-hatch-source" type="geojson" data={on ? hatch : EMPTY} tolerance={0.6}>
        <Layer
          id="diplomatic-hatch"
          type="fill"
          beforeId={overFills}
          paint={{ "fill-pattern": HATCH_PATTERN, "fill-opacity": on ? 0.85 : 0, "fill-antialias": false }}
        />
      </Source>
      {/* The borders where belligerents meet, and the focus country's own, from the sovereign borders' own segments. */}
      <Layer
        id="diplomatic-fronts-casing"
        type="line"
        source="polity-boundaries-source"
        beforeId={overBorders}
        filter={frontFilter(on ? frontPairs : null)}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": "rgba(5, 8, 13, 0.85)", "line-width": FRONT_CASING_WIDTH, "line-opacity": on ? 0.75 : 0 }}
      />
      <Layer
        id="diplomatic-fronts"
        type="line"
        source="polity-boundaries-source"
        beforeId={overBorders}
        filter={frontFilter(on ? frontPairs : null)}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": LINE_COLORS.war, "line-width": FRONT_WIDTH, "line-opacity": on ? 0.95 : 0 }}
      />
      <Layer
        id="diplomatic-focus-outline"
        type="line"
        source="polity-boundaries-source"
        beforeId={overBorders}
        filter={focusFilter(on ? focusOwners : null)}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": RELATION_COLORS.self, "line-width": FOCUS_WIDTH, "line-opacity": on ? 0.9 : 0 }}
      />
      <Source id="diplomatic-outline-source" type="geojson" data={on ? outlines : EMPTY} tolerance={0.3}>
        <Layer
          id="diplomatic-bloc-outline-casing"
          type="line"
          beforeId={overBorders}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": "rgba(5, 8, 13, 0.9)", "line-width": OUTLINE_CASING_WIDTH, "line-blur": 0.6, "line-opacity": on ? 0.55 : 0 }}
        />
        <Layer
          id="diplomatic-bloc-outline"
          type="line"
          beforeId={overBorders}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": BLOC_OUTLINE_COLOR, "line-width": OUTLINE_WIDTH, "line-opacity": on ? 0.95 : 0 }}
        />
      </Source>
      <Source id="diplomatic-lines-source" type="geojson" data={on ? lines : EMPTY} tolerance={0.4}>
        <Layer
          id="diplomatic-lines-casing"
          type="line"
          beforeId={underLabels}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": "rgba(5, 8, 13, 0.8)", "line-width": LINE_CASING_WIDTH, "line-opacity": on ? 0.6 : 0 }}
        />
        <Layer
          id="diplomatic-lines-ally"
          type="line"
          beforeId={underLabels}
          filter={["==", ["get", "kind"], "ally"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": LINE_COLORS.ally, "line-width": LINE_WIDTH, "line-opacity": on ? 0.85 : 0 }}
        />
        <Layer
          id="diplomatic-lines-war"
          type="line"
          beforeId={underLabels}
          filter={["==", ["get", "kind"], "war"]}
          layout={{ "line-join": "round" }}
          paint={{ "line-color": LINE_COLORS.war, "line-width": LINE_WIDTH, "line-dasharray": [3, 2], "line-opacity": on ? 0.95 : 0 }}
        />
        <Layer
          id="diplomatic-lines-ceasefire"
          type="line"
          beforeId={underLabels}
          filter={["==", ["get", "kind"], "ceasefire"]}
          layout={{ "line-join": "round" }}
          paint={{ "line-color": LINE_COLORS.ceasefire, "line-width": LINE_WIDTH, "line-dasharray": [1, 2.5], "line-opacity": on ? 0.9 : 0 }}
        />
      </Source>
      <Source id="diplomatic-seat-source" type="geojson" data={on && seat ? seat : EMPTY}>
        <Layer
          id="diplomatic-seat"
          type="circle"
          beforeId={underLabels}
          paint={{
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 6, 5],
            "circle-color": RELATION_COLORS.self,
            "circle-stroke-color": "rgba(5, 8, 13, 0.9)",
            "circle-stroke-width": 1.5,
            "circle-opacity": on ? 1 : 0,
            "circle-stroke-opacity": on ? 1 : 0,
          }}
        />
      </Source>
    </>
  );
};

export default DiplomaticLayers;
