/*! Open Historia — territory outlines for force-posture prompts © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Where a point is, politically: which polity's territory it sits inside, and how
// far it is from whose border. This is what lets the advisor answer "Russian
// units are getting very close to Ukraine's border" instead of being handed bare
// coordinates and asked to do geography in its head.
//
// The runtime layer has no geometry at all — loadRegionCatalog (assets.js) yields
// {id, name, country, countryCode} and nothing else — which is why the spawn gate
// in gameState.js works off point footprints. Here in the AI layer we CAN reach
// the tiles, so we do: the same z0 overview tile loadRegionCatalog already fetches
// and memoizes, decoded once more for its ring vertices.
//
// z0 geometry is coarse — tens of km. That is fine for advisory prose ("about
// 90 km from the border") and would not be fine for anything mechanical. Nothing
// mechanical uses it.

import {
  PMTILES_ARCHIVES,
  decodeVectorTile,
  getPmtilesArchive,
  resolveCountryDisplayName,
} from "../../runtime/assets.js";
import { tilePointToLngLat } from "../GameUI/eventFocus.js";
import { createTerritoryIndex } from "./forcePosture.js";

let outlinesPromise = null;
let outlinesKey = "";

// regionId -> { country, countryCode, rings: [[lng, lat], ...][] }
const loadRegionOutlines = async () => {
  const cacheKey = PMTILES_ARCHIVES.regions;
  if (outlinesPromise && outlinesKey === cacheKey) return outlinesPromise;
  outlinesKey = cacheKey;

  outlinesPromise = (async () => {
    const outlines = new Map();
    try {
      const pmtiles = getPmtilesArchive(cacheKey);
      const tileData = await pmtiles.getZxy(0, 0, 0);
      if (!tileData?.data) return outlines;

      const tile = await decodeVectorTile(tileData.data);
      const layer = tile.layers?.regions;
      if (!layer) return outlines;
      const extent = layer.extent || 4096;

      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const props = feature.properties ?? {};
        const id = props.GID_1 || props.gid_1 || props.HASC_1 || props.fid;
        if (!id) continue;

        const rings = [];
        for (const ring of feature.loadGeometry() ?? []) {
          if (!ring?.length) continue;
          rings.push(ring.map((point) => tilePointToLngLat(point.x, point.y, extent)));
        }
        if (rings.length === 0) continue;

        outlines.set(String(id), {
          country: resolveCountryDisplayName(
            props.COUNTRY || props.Country || props.country,
            props.GID_0 || props.gid_0 || "",
          ),
          countryCode: props.GID_0 || props.gid_0 || "",
          rings,
        });
      }
    } catch (error) {
      // Advisory colour only — never let a tile read break a prompt build.
      console.warn("[ai] could not read region outlines for force posture:", error);
    }
    return outlines;
  })();

  return outlinesPromise;
};

/**
 * Load the region outlines and hand them to createTerritoryIndex.
 *
 * Split that way on purpose: everything below is PMTiles plumbing that cannot run
 * without the map binaries, while the geometry that answers "whose territory, how
 * far from whose border" lives in forcePosture.js and is unit-tested there.
 * Returns null when the tiles are unavailable, and buildForcePostureText simply
 * drops the place clauses rather than failing.
 */
export const buildTerritoryIndex = async (world, { owners = [] } = {}) =>
  createTerritoryIndex(await loadRegionOutlines(), world, { owners });
