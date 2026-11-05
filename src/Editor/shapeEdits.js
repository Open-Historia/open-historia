/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Reshaping regions so the new shape ships. A region with a stock GADM id is
// drawn from the stock tiles unless it is marked `edited` (exportPreset.js
// ships its geometry then, and the game keeps it out of the stock-tile fill),
// so every tool that changes a region's shape marks it — and an undo puts the
// flag back along with the shape. Pure OpenLayers, so it runs in node
// (shapeEdits.test.js).

import { unionGeoms } from "./geometry.js";

// Each feature's shape as an undo step needs it: its geometry and its flag.
export const captureShapes = (features) =>
  features.map((feature) => ({ feature, geometry: feature.getGeometry().clone(), edited: feature.get("edited") }));

export const restoreShapes = (rows) => {
  for (const row of rows) {
    row.feature.setGeometry(row.geometry.clone());
    if (row.edited === undefined) row.feature.unset("edited", true);
    else row.feature.set("edited", row.edited);
  }
};

// Merge (the Merge button) and Delete border (the dissolve tool): the first
// feature takes the union of all of them and the rest leave `source`. Returns
// the undo command, or null when the union fails and nothing has changed.
export const mergeRegionFeatures = (source, features) => {
  if (!Array.isArray(features) || features.length < 2) return null;
  const [target, ...removed] = features;
  const before = captureShapes([target]);
  let merged;
  try {
    merged = unionGeoms(features.map((f) => f.getGeometry()));
  } catch (e) {
    console.warn("[editor] merge failed:", e);
    return null;
  }
  const apply = () => {
    target.setGeometry(merged.clone());
    target.set("edited", true);
    removed.forEach((f) => source.removeFeature(f));
  };
  apply();
  return {
    undo: () => {
      restoreShapes(before);
      removed.forEach((f) => source.addFeature(f));
    },
    redo: apply,
  };
};

// The Move tool: call `start` on translatestart and `end` on translateend.
// `end` marks what moved as edited and returns the undo command, or null when
// nothing moved (a click with no drag).
export const trackMove = () => {
  let before = null;
  let from = null;
  return {
    start: (features, coordinate) => {
      before = captureShapes(features);
      from = coordinate ? coordinate.slice() : null;
    },
    end: (features, coordinate) => {
      const rows = before;
      const start = from;
      before = null;
      from = null;
      if (!rows?.length) return null;
      if (start && coordinate && start[0] === coordinate[0] && start[1] === coordinate[1]) return null;
      features.forEach((f) => f.set("edited", true));
      const after = captureShapes(features);
      return { undo: () => restoreShapes(rows), redo: () => restoreShapes(after) };
    },
  };
};
