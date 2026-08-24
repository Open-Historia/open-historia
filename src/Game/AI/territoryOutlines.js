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
import { haversineKm } from "../../runtime/unitMotion.js";
import { regionOwnerName } from "./regionVocab.js";

const norm = (value) => String(value ?? "").trim();
const lower = (value) => norm(value).toLowerCase();

// Only index the powers the question could plausibly be about. Indexing all ~200
// countries would decode and hold geometry nobody is going to ask about.
const MAX_OWNERS = 24;
// Anything further than this is "the other side of the world", not a border.
const MAX_REPORTED_KM = 4000;

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

// Ray casting on the tile's own ring vertices. Cheap, dependency-free, and
// accurate enough at this resolution; @turf/boolean-point-in-polygon would need
// the rings wrapped as GeoJSON polygons with winding order honoured, which buys
// nothing when "inside Belarus" is the entire requirement.
const ringContains = (ring, lng, lat) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const ringDistanceKm = (ring, lng, lat) => {
  let best = Infinity;
  for (const [vertexLng, vertexLat] of ring) {
    const km = haversineKm(lat, lng, vertexLat, vertexLng);
    if (km < best) best = km;
  }
  return best;
};

/**
 * Build a locate() index for the powers that matter to the current question.
 *
 * Ownership follows the LIVE map via regionVocab's regionOwnerName — an explicit
 * regionOwnershipOverrides entry wins, else the region's base country — so a
 * polity the campaign invented ("Free Ireland") is as locatable as a stock one.
 */
export const buildTerritoryIndex = async (world, { owners = [] } = {}) => {
  const outlines = await loadRegionOutlines();
  if (outlines.size === 0) return null;

  const wanted = new Set(
    owners.map(lower).filter(Boolean).slice(0, MAX_OWNERS),
  );
  if (wanted.size === 0) return null;

  const overrides = world?.regionOwnershipOverrides ?? {};
  const byOwner = new Map();
  for (const [id, outline] of outlines) {
    const owner = regionOwnerName({ id, country: outline.country, countryCode: outline.countryCode }, overrides);
    if (!owner || !wanted.has(lower(owner))) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(...outline.rings);
  }
  if (byOwner.size === 0) return null;

  return {
    owners: [...byOwner.keys()],
    /**
     * @returns {{inside: string, nearest: string, nearestKm: number}|null}
     *   `inside` is the polity whose territory contains the point ("" at sea),
     *   `nearest` the closest OTHER polity's border, with its distance.
     */
    locate: ({ lng, lat }) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

      let inside = "";
      for (const [owner, rings] of byOwner) {
        if (rings.some((ring) => ringContains(ring, lng, lat))) {
          inside = owner;
          break;
        }
      }

      let nearest = "";
      let nearestKm = Infinity;
      for (const [owner, rings] of byOwner) {
        // The interesting distance is to somebody ELSE's border; a unit sitting
        // in its own country is zero km from its own, which says nothing.
        if (inside && lower(owner) === lower(inside)) continue;
        for (const ring of rings) {
          const km = ringDistanceKm(ring, lng, lat);
          if (km < nearestKm) {
            nearestKm = km;
            nearest = owner;
          }
        }
      }

      if (nearestKm > MAX_REPORTED_KM) {
        nearest = "";
        nearestKm = Infinity;
      }
      if (!inside && !nearest) return null;
      return { inside, nearest, nearestKm };
    },
  };
};
