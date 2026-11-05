/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

import Snap from "ol/interaction/Snap.js";

export const bordersIn = (source, box) => {
  const found = [];
  source.forEachFeatureInExtent(box, (feature) => {
    const geometry = feature.getGeometry();
    const type = geometry?.getType();
    if (type !== "Polygon" && type !== "MultiPolygon") return;
    const flat = geometry.getFlatCoordinates();
    const stride = geometry.getStride();
    const endss = type === "Polygon" ? [geometry.getEnds()] : geometry.getEndss();
    let start = 0;
    for (const ends of endss) {
      for (const end of ends) {
        for (let i = start; i + stride < end; i += stride) {
          const ax = flat[i];
          const ay = flat[i + 1];
          const bx = flat[i + stride];
          const by = flat[i + stride + 1];
          if ((ax < box[0] && bx < box[0]) || (ax > box[2] && bx > box[2]) || (ay < box[1] && by < box[1]) || (ay > box[3] && by > box[3])) continue;
          found.push({ feature, segment: [[ax, ay], [bx, by]] });
        }
        start = end;
      }
    }
  });
  return found;
};

export default class RegionSnap extends Snap {
  constructor(options) {
    super(options);
    const { source } = options;
    this.rBush_ = { getInExtent: (box) => bordersIn(source, box), clear: () => {} };
  }

  addFeature() {}

  removeFeature() {}
}
