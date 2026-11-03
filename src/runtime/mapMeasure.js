/*! Open Historia — the measure of the map being played © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How the map being played measures distances (server/mapDistance.js), for
// what measures without a world at hand: a unit card's "km to go", the War
// Room's figures, a patrol ring. Kept as the game reads and writes its world
// (gameState.js) and as the map shows it (Game/Map/useWorldState.js). Where a
// world IS at hand, worldMeasureOf(world) is its own measure and is used instead.
import { PLAIN_MEASURE, worldMeasureOf } from "../../server/mapDistance.js";

let current = PLAIN_MEASURE;

// The world being played was read or written: its map's measure is the one in use.
export const noteMapMeasure = (world) => {
  if (world && typeof world === "object") current = worldMeasureOf(world);
};

export const currentMapMeasure = () => current;
