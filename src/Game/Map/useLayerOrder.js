/*! Open Historia — keeping a component's layers in the map's order © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A layer the map is handed goes on top of everything until it is moved, and
// one laid on another component's source (IceLayers.jsx on the regions) or put
// back after a change of style comes back whenever that source does, which no
// render of its own component sees. So the canonical stack (mapLayerOrder.js)
// is settled whenever the style changes while any of a component's layers are
// on the map: at most once a frame, and doing nothing when it already stands.

import { useEffect } from "react";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";

export const useLayerOrder = (map, ids, active) => {
  const key = ids.join("|");
  useEffect(() => {
    if (!map || !active) return undefined;
    const wanted = key.split("|");
    let frame = 0;
    const settle = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          if (map.style && wanted.some((id) => map.getLayer(id))) enforceMapLayerOrder(map);
        } catch { /* the map is between styles: the next change settles it */ }
      });
    };
    settle();
    map.on("styledata", settle);
    return () => {
      map.off("styledata", settle);
      cancelAnimationFrame(frame);
    };
  }, [map, key, active]);
};
