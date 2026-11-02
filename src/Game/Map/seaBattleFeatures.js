/*! Open Historia — sea battles and blockades as the map marks them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the map draws of the war at sea.
//
// SEA BATTLES (runtime/naval/record.js): a mark where each of the last turns'
// battles was fought, who fought it and when, in the colour of how it went
// for whoever looks at the map. The newest turn's stand out; the turn
// before's are fainter, and then they go.
//
// BLOCKADES (runtime/naval/blockade.js): round each fleet that is blockading,
// the water it closes (a ring at the reach of its age), and under the fleet
// the countries it presses on with how much of each one's trade is cut.
//
// Pure: geometry out of records. The layers are SeaBattleLayers.jsx.

import { NAVAL_REACH_KM } from "../../runtime/naval/engine.js";
import { eraOf } from "../../runtime/unitMotion.js";
import { mapRing } from "../../../server/mapDistance.js";
import { currentMapMeasure } from "../../runtime/mapMeasure.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const collection = (features) => ({ type: "FeatureCollection", features });
export const EMPTY_SEA_BATTLE_FEATURES = Object.freeze(collection([]));

// How a battle went, to whoever looks at the map: "own" when the side the
// viewer fought on had the better of it, "enemy" when the other side had, and
// "other" when neither had or the viewer was no part of it.
export const seaBattleTone = (battle, viewer) => {
  if (!fold(viewer) || (battle?.winner !== 0 && battle?.winner !== 1)) return "other";
  const mine = [0, 1].find((side) => list(battle?.sides?.[side]).some((name) => fold(name) === fold(viewer)));
  if (mine === undefined) return "other";
  return battle.winner === mine ? "own" : "enemy";
};

//   battles   world.seaBattles
//   viewer    the country the player plays
// Returns a feature collection of points: { id, tone, label, fresh }.
export const seaBattleFeatures = ({ battles = [], viewer = "" } = {}) => {
  const kept = list(battles).filter((battle) => battle && clean(battle.id) && Number.isFinite(Number(battle.lng)) && Number.isFinite(Number(battle.lat)));
  const newest = kept.reduce((most, battle) => Math.max(most, Number(battle.round) || 0), 0);
  return collection(kept.map((battle) => {
    const sides = [0, 1].map((side) => list(battle.sides?.[side]).map(clean).filter(Boolean).join(", "));
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(battle.lng), Number(battle.lat)] },
      properties: {
        id: clean(battle.id),
        tone: seaBattleTone(battle, viewer),
        // (Names and a date: nothing here is the interface's own wording.)
        label: [sides.filter(Boolean).join(" – "), clean(battle.date)].filter(Boolean).join("\n"),
        fresh: (Number(battle.round) || 0) >= newest,
      },
    };
  }));
};

// ---- blockades --------------------------------------------------------------------------

export const BLOCKADE_RING_POINTS = 64;
const KM_A_DEGREE = 111.32;

// A ring `km` round a place, as a closed line.
const ringOf = (lng, lat, km) => {
  // (A map that is not plain Mercator draws it by its own measure: server/mapDistance.js.)
  const measure = currentMapMeasure();
  if (!measure.plain) return mapRing(measure, lng, lat, km, BLOCKADE_RING_POINTS);
  const across = Math.max(0.05, Math.cos((Math.min(85, Math.abs(lat)) * Math.PI) / 180));
  const points = [];
  for (let step = 0; step <= BLOCKADE_RING_POINTS; step += 1) {
    const turn = (step * 2 * Math.PI) / BLOCKADE_RING_POINTS;
    points.push([lng + (Math.cos(turn) * km) / (KM_A_DEGREE * across), Math.max(-89, Math.min(89, lat + (Math.sin(turn) * km) / KM_A_DEGREE))]);
  }
  return points;
};

// Whose a blockade is, to whoever looks at the map: "own" where the viewer is
// one of those laying it, "enemy" where the viewer is under it, else "other".
export const blockadeTone = (blockades, viewer) => {
  const me = fold(viewer);
  if (!me) return "other";
  if (list(blockades).some((blockade) => fold(blockade.country) === me)) return "enemy";
  return list(blockades).some((blockade) => list(blockade.by).some((name) => fold(name) === me)) ? "own" : "other";
};

//   blockades   world.blockades
//   units       world.units: the fleets that lay them are found among these
//   viewer      the country the player plays
//   date        the game's date, for how far a fleet closes the water
//   flat        true for a map laid out flat: a place is marked, and no ring is drawn
// Returns { rings, labels }: two feature collections.
//   era         the era the scenario set (runtime/warSettings.js), or null to read it off the date
export const blockadeFeatures = ({ blockades = [], units = [], viewer = "", date = "", flat = false, era = null } = {}) => {
  const laid = list(blockades).filter((blockade) => blockade && clean(blockade.country) && Number(blockade.pressure) > 0);
  if (laid.length === 0) return { rings: collection([]), labels: collection([]) };
  const reach = NAVAL_REACH_KM[eraOf(date, era)];
  const rings = [];
  const labels = [];
  for (const unit of list(units)) {
    if (!unit || fold(unit.type) !== "naval" || fold(unit.posture) !== "blockade" || clean(unit.committedTo)) continue;
    const lng = Number(unit.lng);
    const lat = Number(unit.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    // The blockades this fleet's country is one of those laying.
    const mine = laid.filter((blockade) => list(blockade.by).some((name) => fold(name) === fold(unit.ownerCode)));
    if (mine.length === 0) continue;
    const tone = blockadeTone(mine, viewer);
    const id = clean(unit.id) || `${fold(unit.ownerCode)}:${lng}:${lat}`;
    if (!flat) rings.push({ type: "Feature", geometry: { type: "LineString", coordinates: ringOf(lng, lat, reach) }, properties: { id, tone } });
    labels.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      // (A country's name and a figure: nothing here is the interface's own wording.)
      properties: { id, tone, label: mine.map((blockade) => `${clean(blockade.country)} ${Math.round(Number(blockade.pressure) * 100)}%`).join("\n") },
    });
  }
  return { rings: collection(rings), labels: collection(labels) };
};
