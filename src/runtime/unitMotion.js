import { diffGameDays } from "./gameDates.js";

/*! Open Historia — unit motion, reach & detection math © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Deterministic movement for map units — the reason a fleet sent to the
// Atlantic visibly crosses it over several turns instead of teleporting, and
// keeps working its station afterwards, without costing a single token.
//
// DELIBERATELY IMPORT-FREE. gameState.js pulls in assets.js, which imports
// maplibre-gl, so `node --test src/runtime/gameState.*.test.js` cannot even
// load without a full install. Keeping this file dependency-free (the same
// trick GameUI/eventFocus.js uses) means its tests run in a bare checkout.
// gameState.js re-exports haversineKm from here, so nothing else has to know.

// ---- geometry --------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

// Great-circle distance in km. Moved here from gameState.js (which now
// re-exports it) so the repo carries ONE haversine instead of the two it had —
// gameState's copy and unitCombat.js's `distanceKm` were the same function.
export const haversineKm = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad((lat2 ?? 0) - (lat1 ?? 0));
  const dLng = toRad((lng2 ?? 0) - (lng1 ?? 0));
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1 ?? 0)) * Math.cos(toRad(lat2 ?? 0)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
};

const wrapLng = (lng) => {
  let value = lng;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
};

const clampLat = (lat) => Math.max(-85, Math.min(85, lat));

// ---- seeded randomness -----------------------------------------------------

// xmur3, salvaged from the deleted unitCombat.js. Same string always yields the
// same uint32, which is what makes patrol drift reproducible across reloads.
export const hashSeed = (text) => {
  const str = String(text ?? "");
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
};

// ---- pace ------------------------------------------------------------------
//
// Two things are both called "a move", and they do not go at the same speed.
//
//   A REDEPLOYMENT is a formation being moved: marched along its own roads,
//   and since the railway carried by train, by road convoy and by ship. A
//   modern heavy division goes from Texas to Korea in about three weeks, and
//   across Germany by rail in two days.
//
//   An ADVANCE is a formation going forward against an enemy under its own
//   power, fighting or ready to, fed from behind. Thirty kilometres a day is a
//   good day for infantry in any century; fifty for armour.
//
// One table used to serve for both — infantry 40 km a day, armour 90, in a
// straight line. A 45-skip test (2026-10-09) showed what that did to a
// redeployment: a division ordered from Texas to Korea was 127 to 328 game
// days on the way, across Canada, the Arctic and Siberia, while the events of
// those months had it landed and fighting. So a move is now paced by what it
// is. It is an advance when the formation's posture is "assaulting", and a
// redeployment otherwise; and a redeployment is paced by how much of its way
// lies over water (`seaShare`, worked out where the map's shapes are to hand,
// AI/gameplay.js resolvePlacements), because before the railway a march and a
// voyage were very different speeds.
//
// Everything is km a day, sustained: loading, unloading, halts and weather
// are inside the figure, which is why a ship's is well under its speed
// through the water. Four eras, read off the game's own date: before 1500,
// 1500 to 1849 (sail and the musket), 1850 to 1944 (rail and steam), and from
// 1945. Garrisons are 0 because they are fixed by definition
// (buildMilitaryFeasibilityText already tells the model as much).
const ERA_STARTS = [1500, 1850, 1945];
// A formation going forward against an enemy. Before the tank, "armor" is the
// heavy cavalry of its day.
const ADVANCE_KM_PER_DAY = {
  infantry: [18, 20, 20, 30],
  armor: [30, 35, 35, 50],
  artillery: [12, 15, 18, 30],
};
// A redeployment over land: the march, then the troop train, then rail and road.
const OVERLAND_KM_PER_DAY = {
  infantry: [25, 28, 300, 500],
  armor: [40, 45, 300, 500],
  artillery: [18, 22, 300, 500],
};
// A redeployment by sea, port to port: galleys and coasters, sail, steam, sealift.
const SEALIFT_KM_PER_DAY = [110, 170, 400, 650];
// A fleet under way, and an air wing changing its base.
const FLEET_KM_PER_DAY = [130, 200, 480, 750];
const AIR_KM_PER_DAY = [700, 1000, 1500, 5000];

// The formation is in contact with an enemy and goes at an advance's pace.
export const ADVANCING_POSTURES = new Set(["assaulting"]);

// Which of the four eras a game date is in. A date that carries no year reads
// as the present, as it always has here.
export const eraOf = (gameDate) => {
  const text = String(gameDate ?? "");
  const match = /(-?\d{3,4})/.exec(text);
  const bce = /BC|BCE/i.test(text);
  const year = match ? Number(match[1]) * (bce ? -1 : 1) : 2000;
  return ERA_STARTS.filter((start) => year >= start).length;
};

// Kept for whoever scales something else by the era (strike reach, supply).
export const eraSpeedFactor = (gameDate) => [0.35, 0.5, 0.75, 1][eraOf(gameDate)];

// How far a formation gets in a day.
//   posture      "assaulting" is an advance; anything else a redeployment.
//   seaShare     the part of the way that is over water, 0 to 1; null when
//                nobody worked it out (an order from an older save): a long
//                journey is then taken to be half by sea.
//   remainingKm  how far it still has to go, for that guess.
export const kmPerDay = (type, gameDate, { posture = "", seaShare = null, remainingKm = 0 } = {}) => {
  const era = eraOf(gameDate);
  if (type === "garrison") return 0;
  if (type === "naval") return FLEET_KM_PER_DAY[era];
  if (type === "air") return AIR_KM_PER_DAY[era];
  const kind = Object.hasOwn(OVERLAND_KM_PER_DAY, type) ? type : "infantry";
  if (ADVANCING_POSTURES.has(String(posture ?? "").toLowerCase())) return ADVANCE_KM_PER_DAY[kind][era];
  const told = Number(seaShare);
  const share = seaShare !== null && seaShare !== undefined && Number.isFinite(told)
    ? Math.max(0, Math.min(1, told))
    : (Number(remainingKm) > 1500 ? 0.5 : 0);
  const overland = OVERLAND_KM_PER_DAY[kind][era];
  const sealift = SEALIFT_KM_PER_DAY[era];
  // Each part of the way at its own pace: the days add, not the speeds.
  return Math.round(1 / ((1 - share) / overland + share / sealift));
};

export const maxTravelKm = (type, gameDate, days, options = {}) =>
  kmPerDay(type, gameDate, options) * Math.max(0, Number(days) || 0);

// The part of the great circle between two points that lies over water,
// 0 to 1, by `isLand([lng, lat])`. Sampled about every 150 km, the ends left
// out: a port is on land and its ship is not.
export const seaShareOf = (from, to, isLand) => {
  if (typeof isLand !== "function") return null;
  const start = { lng: Number(from?.lng), lat: Number(from?.lat) };
  const end = { lng: Number(to?.lng), lat: Number(to?.lat) };
  if (![start.lng, start.lat, end.lng, end.lat].every(Number.isFinite)) return null;
  const distance = haversineKm(start.lat, start.lng, end.lat, end.lng);
  if (distance < 60) return 0;
  const steps = Math.max(6, Math.min(48, Math.round(distance / 150)));
  let water = 0;
  for (let index = 1; index < steps; index += 1) {
    const point = stepToward(start, end, (distance * index) / steps);
    if (!isLand([point.lng, point.lat])) water += 1;
  }
  return Number((water / (steps - 1)).toFixed(2));
};

// What the model is told of all this, so an event does not land a division
// the map still shows at sea: the paces of this game's own era, in a line.
export const describeTravelPace = (gameDate) => {
  const era = eraOf(gameDate);
  const overland = OVERLAND_KM_PER_DAY.infantry[era];
  const how = ["on the march", "on the march", "by rail", "by rail and road"][era];
  return `A formation that is redeployed covers about ${overland} km a day ${how} and about ${SEALIFT_KM_PER_DAY[era]} by sea; `
    + `a fleet about ${FLEET_KM_PER_DAY[era]}${era >= 2 ? `, an air wing about ${AIR_KM_PER_DAY[era]}` : ""}. `
    + `A formation advancing against an enemy (posture "assaulting") covers about ${ADVANCE_KM_PER_DAY.infantry[era]} km a day on foot `
    + `and ${ADVANCE_KM_PER_DAY.armor[era]} ${era >= 2 ? "with armour" : "mounted"}. `
    + "The engine moves each formation at that pace, and goes on moving it on later turns until it arrives: an event says a formation HAS ARRIVED only when the days since its order allow it, and otherwise that it is on its way.";
};

// Whole days between two YYYY-MM-DD dates, or null when either side is not a
// plain Gregorian date ("1200 BCE", "Third Age 3019"). null means "do not clamp":
// a fantasy or ancient scenario must never freeze because its dates don't parse.
export const daysBetweenDates = (from, to) => {
  const days = diffGameDays(from, to);
  return days === null ? null : Math.max(0, days);
};

// ---- movement --------------------------------------------------------------

// Step `from` toward `to` by at most maxKm along the great circle.
//
// This SLERPs rather than lerping the coordinates. Interpolating longitude
// linearly tears at the antimeridian: a fleet ordered Yokosuka -> San Diego
// would track backwards across Eurasia instead of over the Pacific.
export const stepToward = (from, to, maxKm) => {
  const fromLat = Number(from?.lat) || 0;
  const fromLng = Number(from?.lng) || 0;
  const toLat = Number(to?.lat) || 0;
  const toLng = Number(to?.lng) || 0;

  const distance = haversineKm(fromLat, fromLng, toLat, toLng);
  if (distance <= 0) {
    return { lng: wrapLng(toLng), lat: clampLat(toLat), arrived: true, remainingKm: 0 };
  }
  const budget = Math.max(0, Number(maxKm) || 0);
  if (budget <= 0) {
    return { lng: wrapLng(fromLng), lat: clampLat(fromLat), arrived: false, remainingKm: distance };
  }
  if (budget >= distance) {
    return { lng: wrapLng(toLng), lat: clampLat(toLat), arrived: true, remainingKm: 0 };
  }

  const omega = distance / EARTH_RADIUS_KM;
  const sinOmega = Math.sin(omega);
  const t = budget / distance;

  const unit = (lat, lng) => {
    const phi = toRad(lat);
    const lambda = toRad(lng);
    return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  };
  const a = unit(fromLat, fromLng);
  const b = unit(toLat, toLng);

  // Guard the antipodal case: sin(omega) -> 0 makes the slerp weights blow up.
  const wa = sinOmega === 0 ? 1 - t : Math.sin((1 - t) * omega) / sinOmega;
  const wb = sinOmega === 0 ? t : Math.sin(t * omega) / sinOmega;

  const x = a[0] * wa + b[0] * wb;
  const y = a[1] * wa + b[1] * wb;
  const z = a[2] * wa + b[2] * wb;

  return {
    lng: wrapLng(toDeg(Math.atan2(y, x))),
    lat: clampLat(toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))),
    arrived: false,
    remainingKm: distance - budget,
  };
};

// ---- patrol ----------------------------------------------------------------

// How wide a station each type works when the model says posture "patrol" and
// names no radius of its own.
export const DEFAULT_PATROL_RADIUS_KM = {
  garrison: 0,
  artillery: 25,
  infantry: 40,
  armor: 60,
  naval: 250,
  air: 300,
};

// A point on the unit's station, derived purely from the seed. Same seed always
// gives the same point, so re-reading world.json never jitters the map and the
// staged event reveal reproduces a patrol exactly. Callers seed with
// `${unit.id}|${round}|${tick}` so the position changes per turn and per idle
// pulse, but never at random.
export const patrolPoint = (station, radiusKm, seed) => {
  const centreLat = Number(station?.lat) || 0;
  const centreLng = Number(station?.lng) || 0;
  const radius = Math.max(0, Number(radiusKm) || 0);
  if (radius <= 0) {
    return { lng: wrapLng(centreLng), lat: clampLat(centreLat) };
  }

  const hash = hashSeed(seed);
  const bearing = ((hash % 3600) / 3600) * Math.PI * 2;
  // Bias outward (0.55..1.0 of the radius) so a patrol reads as working its
  // station rather than loitering on top of the centre point.
  const spread = 0.55 + ((Math.floor(hash / 3600) % 1000) / 1000) * 0.45;

  // Great-circle destination from (centre, bearing, distance). Offsetting the
  // degrees flat-earth style instead looks fine near the equator but overshoots
  // badly at high latitude — an Arctic station would smear its patrol hundreds
  // of km past the radius — so do the spherical trig and be exactly on station.
  const delta = (radius * spread) / EARTH_RADIUS_KM;
  const phi1 = toRad(centreLat);
  const lambda1 = toRad(centreLng);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearing),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return { lng: wrapLng(toDeg(lambda2)), lat: clampLat(toDeg(phi2)) };
};
