/*!
 * Open Historia Map Editor — whose a region's shape is
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A world map starts as the stock world: the GADM regions every scenario
// without a map of its own is drawn on. A region of it that nobody has
// reshaped has the shape the stock world gave it, and is not the map's own to
// repair: the save-time border cleanup reads it only as a neighbour
// (topologySweep.js, "What a save has to look at").
//
// Which regions those are is told the way the game tells it
// (Game/Map/vnext/regionDisplayMesh.js isExplicitAuthoredGeometry): by what
// the editor marks, never by what an id looks like. A region drawn in the
// editor has a reg_ id, and a stock region a tool reshaped carries
// `edited: true` (an import may say `authored` or `geometrySource`, and an
// older document `mergedFrom`). What is left is told from the regions of a
// map that never was the stock world, the built-in one for instance, by its
// id being one the stock world has (runtime/generated/stockRegionIds.js): a
// dot in an id proves nothing, and sixteen regions of Ghana have none.

import { STOCK_REGION_IDS } from "../runtime/generated/stockRegionIds.js";

export const isStockShape = ({ id, edited, authored, geometrySource, mergedFrom } = {}, stockIds = STOCK_REGION_IDS) =>
  stockIds.has(String(id ?? ""))
  && edited !== true
  && authored !== true
  && !mergedFrom
  && String(geometrySource ?? "").toLowerCase() !== "authored";

// The same, asked of one of the editor's own features.
export const ownsShape = (feature) => !isStockShape({
  id: feature.getId(),
  edited: feature.get("edited"),
  authored: feature.get("authored"),
  geometrySource: feature.get("geometrySource"),
  mergedFrom: feature.get("mergedFrom"),
});
