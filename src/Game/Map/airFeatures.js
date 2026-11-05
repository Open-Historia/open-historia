/*! Open Historia — aircraft over the battlefields: where each is © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/Map/airFeatures.test.js
//
// "Air arms fly over every battlefield, but nothing shows on the map; you only
// see a line in the battle report" (the owner's list, 2026-10-16). Each side's
// wings over a battlefield (its record's brief.air: runtime/fronts/air.js
// skyHeld) are drawn as aircraft circling over the troops they were sent to
// help (support) or to strike (strike): a few for each side however many wings
// it has, in the tone of whose they are (transportIcons.js TRANSPORT_TONES:
// the player's side, its enemy, another). Wings kept on the ground are not
// drawn. Where each one is comes from the time, so the map can move them along
// (AirLayers.jsx).
//
// Pure, and loads in plain Node.

import { battlefieldSideOf } from "../../runtime/fronts/record.js";
import { projectorOf } from "../../runtime/fronts/frame.js";

// The most aircraft drawn for a side over a battlefield, how wide each circles, and how long a circle takes.
export const AIR_MOST_A_SIDE = 6;
export const AIR_CIRCLE_KM = 22;
export const AIR_TURN_SECONDS = 26;

const EMPTY = Object.freeze({ type: "FeatureCollection", features: [] });
const live = (troop) => Number(troop?.strength) > 0 && Number.isFinite(troop?.x) && Number.isFinite(troop?.y);

// `count` of a side's troops, spread along its line: sorted west to east, then evenly picked.
const spread = (troops, count) => {
  const sorted = troops.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= count) return sorted;
  return Array.from({ length: count }, (_, at) => sorted[Math.floor(((at + 0.5) * sorted.length) / count)]);
};

// The aircraft over the battlefields drawn (frontsController.js getFrontTargets: { record, view }), at `seconds`:
// points with { tone, heading } (heading in degrees clockwise from north, the way the aircraft is flying).
//   mine   the country the player plays: its side's aircraft are "own", the other side's "enemy"
export const airPlanesOf = (targets, { mine = "", seconds = 0 } = {}) => {
  const features = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const record = target?.record;
    const air = record?.brief?.air;
    const troops = target?.view?.troops;
    if (!air || !record?.frame || !Array.isArray(troops)) continue;
    const { toLngLat } = projectorOf(record.frame);
    const km = Number(record.frame.km) > 0 ? Number(record.frame.km) : 10;
    const radius = AIR_CIRCLE_KM / km;
    const played = battlefieldSideOf(record, mine);
    for (const side of [0, 1]) {
      const wings = Math.floor(Number(air.wings?.[side]) || 0);
      const mission = air.missions?.[side] ?? "support";
      if (wings <= 0 || mission === "grounded") continue;
      // Over its own troops to help them, over the other side's to strike them.
      const over = (Array.isArray(troops[mission === "strike" ? 1 - side : side]) ? troops[mission === "strike" ? 1 - side : side] : []).filter(live);
      if (over.length === 0) continue;
      const tone = played < 0 ? "other" : side === played ? "own" : "enemy";
      spread(over, Math.min(wings, AIR_MOST_A_SIDE)).forEach((anchor, at) => {
        // Each its own way round and its own place on its circle, so that they do not fly in step.
        const turn = at % 2 === 0 ? 1 : -1;
        const angle = at * 2.39996 + side * 1.3 + turn * ((2 * Math.PI * seconds) / AIR_TURN_SECONDS);
        const x = anchor.x + radius * Math.cos(angle);
        const y = anchor.y + radius * Math.sin(angle);
        // Along the circle: (-sin, cos) the way round it turns, east and north in the frame's cells.
        const east = -Math.sin(angle) * turn;
        const north = Math.cos(angle) * turn;
        const [lng, lat] = toLngLat(x, y);
        features.push({
          type: "Feature",
          properties: { tone, heading: Math.round(((Math.atan2(east, north) * 180) / Math.PI + 360) % 360), mission },
          geometry: { type: "Point", coordinates: [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] },
        });
      });
    }
  }
  return features.length > 0 ? { type: "FeatureCollection", features } : EMPTY;
};
