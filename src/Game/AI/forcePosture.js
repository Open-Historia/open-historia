/*! Open Historia — force posture digest for AI prompts © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// What every power's forces are doing, written out so the advisor can answer
// "Russian units are getting very close to Ukraine's border, what do you think?"
// from facts rather than from geography it has to infer out of bare lat/lng.
//
// The advisor was already handed the whole unit list — buildUnitsSummaryText,
// despite the helper being named PLAYER_POLITY_BATTALION_SUMMARIES, has never
// filtered by owner. The problem was that it arrived under a heading reading
// "Player polity, X, details: ... Military Units:", so the model read it as the
// player's own army and never used it to answer questions about anyone else.
// This replaces that with something explicitly about everybody, and adds the
// three things the model cannot work out for itself: whose territory a formation
// is in, how far it is from whose border, and what it is already under orders to do.
//
// DELIBERATELY free of browser-only imports, so it can be tested without a full
// install (see forcePosture.test.js). That includes createTerritoryIndex at the
// bottom: territoryOutlines.js does nothing but fetch and decode the region
// tile, then hands the rings here, which keeps the border geometry testable
// without the map binaries.

import { haversineKm } from "../../runtime/unitMotion.js";
import { regionOwnerName } from "./regionVocab.js";

const norm = (value) => String(value ?? "").trim();
const lower = (value) => norm(value).toLowerCase();

const POSTURE_PHRASE = {
  holding: "holding position",
  massing: "massing",
  patrol: "patrolling",
  transit: "in transit",
  exercise: "on exercise",
  blockade: "blockading",
  withdrawing: "withdrawing",
};

// Compass point, so "180 km SW" reads like a report rather than a coordinate pair.
const BEARINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const bearingFrom = (from, to) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return BEARINGS[Math.round(((degrees + 360) % 360) / 45) % 8];
};

// Where a formation is, in political terms, from createTerritoryIndex's locate().
// A null index (the map binaries are unavailable) simply drops these clauses
// rather than failing the whole prompt build.
const describePlace = (unit, territories) => {
  if (!territories || typeof territories.locate !== "function") return "";
  const placed = territories.locate({ lng: unit.lng, lat: unit.lat });
  if (!placed) return "";

  const { inside, nearest, nearestKm } = placed;
  if (inside && nearest && lower(inside) !== lower(nearest)) {
    return `inside ${inside}, about ${Math.round(nearestKm)} km from the ${nearest} border`;
  }
  if (inside) return `inside ${inside}`;
  if (nearest) return `at sea, about ${Math.round(nearestKm)} km off ${nearest}`;
  return "";
};

const describeOrder = (unit, order) => {
  if (!order) return "";
  if (order.kind === "patrol") {
    return `working a ${Math.round(order.radiusKm)} km station`;
  }
  const remaining = Math.round(haversineKm(unit.lat, unit.lng, order.toLat, order.toLng));
  const target = norm(order.targetLabel) || `${order.toLat.toFixed(1)}, ${order.toLng.toFixed(1)}`;
  return `under orders to ${target}, about ${remaining} km still to go`;
};

// The nearest force belonging to anyone else, which is what "getting very close"
// usually means in practice.
const describeNearestRival = (unit, units) => {
  let best = null;
  for (const other of units) {
    if (other.id === unit.id) continue;
    if (lower(other.ownerCode) === lower(unit.ownerCode)) continue;
    const km = haversineKm(unit.lat, unit.lng, other.lat, other.lng);
    if (!best || km < best.km) best = { km, other };
  }
  if (!best || best.km > 2000) return "";
  const direction = bearingFrom(unit, best.other);
  return `nearest ${best.other.ownerCode} force ${Math.round(best.km)} km ${direction}`;
};

const describeUnit = (unit, { units, orders, territories }) => {
  const order = orders.find((entry) => entry.unitId === unit.id) ?? null;
  const clauses = [
    POSTURE_PHRASE[unit.posture] || unit.status,
    describePlace(unit, territories),
    describeOrder(unit, order),
    describeNearestRival(unit, units),
  ].filter(Boolean);

  const detail = [norm(unit.composition), `${unit.strength}% strength`]
    .filter(Boolean)
    .join(" · ");

  return (
    `  - ${unit.name} (${unit.type}, id ${unit.id})` +
    `${unit.covert ? " [unconfirmed — no known line of support]" : ""}` +
    ` — ${detail}. ${clauses.join("; ")}.` +
    `${norm(unit.note) ? ` "${norm(unit.note)}"` : ""}`
  );
};

/**
 * A grouped, geographically-aware readout of every force on the map.
 *
 * @param units      world.units
 * @param orders     world.pendingUnitOrders
 * @param territories index from territoryOutlines.js, or null to omit place clauses
 * @param playerCode the player's polity name, listed first
 */
export const buildForcePostureText = (units, orders, territories, playerCode) => {
  const list = (Array.isArray(units) ? units : []).filter(
    (unit) => unit && Number.isFinite(unit.lng) && Number.isFinite(unit.lat),
  );
  if (list.length === 0) {
    return "No military forces are currently visible anywhere on the map.";
  }
  const orderList = Array.isArray(orders) ? orders : [];

  const byOwner = new Map();
  for (const unit of list) {
    const key = norm(unit.ownerCode) || "Unknown";
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(unit);
  }

  // The player first, then the powers fielding the most, so a truncated readout
  // still contains whatever matters most to the question being asked.
  const owners = [...byOwner.keys()].sort((a, b) => {
    const player = lower(playerCode);
    if (lower(a) === player) return -1;
    if (lower(b) === player) return 1;
    return byOwner.get(b).length - byOwner.get(a).length;
  });

  const context = { units: list, orders: orderList, territories };
  return owners
    .map((owner) => {
      const header = lower(owner) === lower(playerCode) ? `${owner} (your own forces)` : owner;
      const lines = byOwner
        .get(owner)
        .slice(0, 12)
        .map((unit) => describeUnit(unit, context))
        .join("\n");
      return `${header}:\n${lines}`;
    })
    .join("\n");
};

// ---------------------------------------------------------------------------
// Territory index
// ---------------------------------------------------------------------------
// Built here rather than in territoryOutlines.js so the geometry can be tested
// without the region PMTiles: that module does nothing but fetch and decode the
// tile, then hand the rings to this.

// Only index the powers the question could plausibly be about. Indexing all ~200
// countries would hold geometry nobody is going to ask about.
const MAX_OWNERS = 24;
// Further than this is "the other side of the world", not a border.
const MAX_REPORTED_KM = 4000;

// Ray casting on the tile's own ring vertices. Accurate enough at this
// resolution, and cheaper than wrapping every ring as a GeoJSON polygon with
// winding order honoured just to answer "is this inside Belarus".
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

// Distance to the nearest point on the ring's EDGES, not merely to its vertices.
// Vertex-only distance overstates badly wherever a border runs straight for a
// while: against a box whose only vertices are its corners, a point 222 km from
// the near edge measured as 598 km, because the corners were the closest things
// it could see. Real coastlines are denser than that, but z0 geometry is coarse
// and long straight segments are common enough to matter.
//
// The projection is equirectangular, scaled by cos(lat) — flat-earth, but only
// ever used to find WHERE on the segment the closest point lies; the distance
// itself is then measured great-circle. At the scale of a border crossing that
// is well inside the error the coarse geometry already carries.
const ringDistanceKm = (ring, lng, lat) => {
  if (ring.length === 0) return Infinity;
  const scale = Math.cos((lat * Math.PI) / 180) || 1e-6;
  let best = Infinity;

  for (let i = 0; i < ring.length; i += 1) {
    const [aLng, aLat] = ring[i];
    const [bLng, bLat] = ring[(i + 1) % ring.length];

    const ax = (aLng - lng) * scale;
    const ay = aLat - lat;
    const bx = (bLng - lng) * scale;
    const by = bLat - lat;
    const dx = bx - ax;
    const dy = by - ay;

    let closestLng = aLng;
    let closestLat = aLat;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq > 0) {
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
      closestLng = aLng + (bLng - aLng) * t;
      closestLat = aLat + (bLat - aLat) * t;
    }

    const km = haversineKm(lat, lng, closestLat, closestLng);
    if (km < best) best = km;
  }
  return best;
};

/**
 * Turn decoded region outlines into the locate() index buildForcePostureText uses.
 *
 * Ownership follows the LIVE map via regionVocab's regionOwnerName — an explicit
 * regionOwnershipOverrides entry wins, else the region's base country — so a
 * polity the campaign invented ("Free Ireland") is as locatable as a stock one.
 *
 * @param outlines Map(regionId -> {country, countryCode, rings})
 */
export const createTerritoryIndex = (outlines, world, { owners = [] } = {}) => {
  if (!outlines || outlines.size === 0) return null;
  const wanted = new Set(owners.map(lower).filter(Boolean).slice(0, MAX_OWNERS));
  if (wanted.size === 0) return null;

  const overrides = world?.regionOwnershipOverrides ?? {};
  const byOwner = new Map();
  for (const [id, outline] of outlines) {
    const owner = regionOwnerName(
      { id, country: outline.country, countryCode: outline.countryCode },
      overrides,
    );
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
