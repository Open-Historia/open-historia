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
// DELIBERATELY IMPORT-FREE apart from the motion math, so it can be tested
// without a full install (see forcePosture.test.js). The territory index it
// consumes is built by territoryOutlines.js, which is where the PMTiles and
// turf dependencies live.

import { haversineKm } from "../../runtime/unitMotion.js";

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

// Where a formation is, in political terms. `territories` is
// { ownerName: { rings, contains(point) } } as built by territoryOutlines.js;
// an empty index simply drops these clauses rather than failing.
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
