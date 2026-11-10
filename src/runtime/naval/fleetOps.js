/*! Open Historia — what the war room tells a fleet © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The war room should also be able to command fleets."
//
// A fleet is a formation of the world's (world.units, type "naval"), and what
// the war at sea makes of it goes by two things it already has (engine.js):
// its POSTURE, and where it is, which a STANDING ORDER moves it toward a turn
// at a time (world.pendingUnitOrders, carried out by gameState.js
// advanceStandingOrders). Commanding one is setting those, and nothing more.
// Each command is an OP, as everything done in the war room is (fronts/
// warRoomOps.js), applied to the world for the country that asked
// (runtime/warRoomWrites.js sendFleetOp):
//
//   { op: "posture",  unit, posture }     what it is to do where it is
//   { op: "station",  unit, to, order }   sail to a place at sea (order "move"), or
//                                         work a station there ("patrol")
//   { op: "blockade", unit, country }     blockade a country the asker is at war with,
//                                         from open water off its coast nearest the fleet
//   { op: "escort",   unit, transport }   cover a convoy of the asker's at sea, from the
//                                         middle of what is left of its way
//   { op: "stand",    unit }              its standing order called off
//
// The postures it may be given are FLEET_POSTURES: Patrol, Blockade, Seek
// battle ("assaulting"), Hold ("holding"), Withdraw ("withdrawing") and Escort
// ("transit"). A place it is sent to is at sea, in the water the fleet is in,
// by the map's own sheet (runtime/warRoomChart.js).
//
// How the game carries out what is written decides how it is written:
//   - a patrol order puts its fleet back on its station every turn, wherever
//     the fleet was, so a fleet farther than FLEET_PATROL_KM from the station it
//     is to patrol is sent there with a move order under the posture "patrol",
//     which the game turns into a station of its own when it arrives;
//   - a patrol order gives its fleet the posture "patrol" every turn, so a
//     fleet given another posture loses its patrol order;
//   - a fleet withdrawing makes for its own coast and one seeking battle for
//     the nearest enemy (engine.js), and a fleet told to hold keeps its place:
//     each of the three loses any order to go elsewhere, and a fleet sent
//     somewhere under one of them goes in transit.
//
// Only the asker's own fleets, and the asker is the country that asked,
// whatever the op says. Pure, and runs in bare node.

import { normalizeTransports } from "../fronts/transports.js";
import { placeAlong, wayKm } from "../fronts/worldGrid.js";
import { kmOnMap } from "../unitMotion.js";

export const FLEET_POSTURES = Object.freeze(["patrol", "blockade", "assaulting", "holding", "withdrawing", "transit"]);
export const FLEET_OPS = Object.freeze(["posture", "station", "blockade", "escort", "stand"]);
// The radius of the station a fleet is told to patrol.
export const FLEET_PATROL_KM = 150;
// A fleet this near where it is sent is there (gameState.js pruneSatisfiedUnitOrders).
export const FLEET_ARRIVED_KM = 60;
// The postures under which a fleet moves of itself, or keeps its place: it goes elsewhere only in transit.
const SAILS_ITSELF = new Set(["assaulting", "withdrawing", "holding"]);

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const round4 = (value) => Math.round(Number(value) * 10000) / 10000;

const REFUSED = Object.freeze({
  nothing: "Nothing was asked.",
  nobody: "You play no country to command it.",
  fleet: "That is not a fleet of yours.",
  pending: "That fleet is not in your order of battle yet: it is confirmed when time next passes.",
  committed: "That fleet is fighting on a battlefield.",
  posture: "Fleets do not know that order.",
  place: "Say where the fleet is to go.",
  chart: "The map could not be read to see where the sea is: try again.",
  land: "That is not at sea.",
  cut: "No sea leads there from where the fleet is.",
  peace: "You are at war with no such country.",
  coast: "No coast of theirs can be reached by sea from where the fleet is.",
  convoy: "That is no convoy of yours at sea.",
});

// A standing order as the war room reads it, or null.
const orderOf = (entry) => {
  if (!entry || typeof entry !== "object" || !finite(entry.toLng) || !finite(entry.toLat)) return null;
  const kind = fold(entry.kind) === "patrol" ? "patrol" : "move";
  return { kind, toLng: Number(entry.toLng), toLat: Number(entry.toLat), radiusKm: Math.max(0, Number(entry.radiusKm) || 0), targetLabel: clean(entry.targetLabel) };
};

// The asker's fleets, as the war room lists them:
//   [{ id, name, strength, posture, status, lng, lat, composition, pending, committed, order }]
// `order` is its standing order ({ kind, toLng, toLat, radiusKm, targetLabel }) or null.
export const fleetsOf = (world, player) => {
  const wanted = fold(player);
  if (!wanted) return [];
  const orders = new Map(list(world?.pendingUnitOrders).filter((entry) => entry && typeof entry === "object").map((entry) => [clean(entry.unitId), entry]));
  return list(world?.units)
    .filter((unit) => unit && fold(unit.type) === "naval" && fold(unit.ownerCode) === wanted && clean(unit.id) && Number(unit.strength) > 0
      && finite(unit.lng) && finite(unit.lat) && fold(unit.status) !== "defeated")
    .map((unit) => ({
      id: clean(unit.id),
      name: clean(unit.name) || "Fleet",
      strength: Math.round(Math.min(100, Number(unit.strength))),
      posture: fold(unit.posture),
      status: fold(unit.status),
      lng: Number(unit.lng),
      lat: Number(unit.lat),
      composition: clean(unit.composition),
      pending: fold(unit.status) === "pending",
      committed: Boolean(clean(unit.committedTo)),
      order: orderOf(orders.get(clean(unit.id))),
    }));
};

// The countries the asker is at war with, by the war ledger (as the war at sea reads it: engine.js).
export const enemiesOf = (world, player) => {
  const wanted = fold(player);
  const found = new Map();
  if (!wanted) return [];
  for (const war of list(world?.wars)) {
    if (fold(war?.status || "active") !== "active") continue;
    const a = list(war.sideA).map((name) => clean(name)).filter(Boolean);
    const b = list(war.sideB).map((name) => clean(name)).filter(Boolean);
    const other = a.some((name) => fold(name) === wanted) ? b : b.some((name) => fold(name) === wanted) ? a : [];
    for (const name of other) if (fold(name) !== wanted && !found.has(fold(name))) found.set(fold(name), name);
  }
  return [...found.values()].sort((x, y) => x.localeCompare(y));
};

// The asker's convoys at sea: its transporters that have set out by sea and are on their way.
export const convoysOf = (world, player) => normalizeTransports(world?.transports)
  .filter((entry) => entry.medium === "sea" && entry.status === "moving" && entry.way.length >= 2
    && [entry.owner, entry.by].some((name) => fold(name) && fold(name) === fold(player)));

// Where a fleet blockading a country lies: in open water off that country's
// coast, at the stretch of it nearest the fleet that the fleet's own water
// reaches, by the map's chart (runtime/warRoomChart.js coastOff: the coast as
// the war at sea reads it, engine.js coastsOf). Lying there, within its reach
// of the coast, it presses on that country (blockade.js). null for none.
//   from   [lng, lat] where the fleet is
export const blockadeStationFor = (chart, country, from) => (typeof chart?.coastOff === "function" ? chart.coastOff(country, from) : null);

// Where a fleet covering a convoy lies: the middle of what is left of its way. null for none.
export const escortStationFor = (transport) => {
  const way = list(transport?.way);
  if (transport?.medium !== "sea" || transport?.status !== "moving" || way.length < 2) return null;
  const total = Number(transport.km) > 0 ? Number(transport.km) : wayKm(way);
  const gone = Math.max(0, Math.min(total, Number(transport.gone) || 0));
  const place = placeAlong(way, gone + (total - gone) / 2);
  return place ? [round4(place.lng), round4(place.lat)] : null;
};

const pointOf = (value) => (Array.isArray(value) && finite(value[0]) && finite(value[1]) && Math.abs(Number(value[1])) <= 90
  ? [round4(value[0]), round4(value[1])]
  : null);

// The world with one op applied for the country that asked. Returns
// { world, unit, order } (the fleet as it is now, and the standing order it
// has, or null) or { error } in words a person can read.
//   player   the country asking (the seat's, in a shared game)
//   date     the game's date, and `round` its round: when an order was given
//   chart    the map's chart (runtime/warRoomChart.js), null where it could not be read;
//            needed by an op that sends a fleet somewhere
//   at       the time to stamp the fleet with (now, by default)
export const applyFleetOp = (world, op, { player = "", date = "", round = 0, chart = null, at = "" } = {}) => {
  if (!op || !FLEET_OPS.includes(op.op)) return { error: REFUSED.nothing };
  const owner = clean(player, 120);
  if (!owner) return { error: REFUSED.nobody };
  const units = list(world?.units);
  const wanted = clean(op.unit, 160);
  const index = wanted ? units.findIndex((unit) => unit && clean(unit.id) === wanted) : -1;
  const unit = index >= 0 ? units[index] : null;
  if (!unit || fold(unit.type) !== "naval" || fold(unit.ownerCode) !== fold(owner)) return { error: REFUSED.fleet };
  if (fold(unit.status) === "pending") return { error: REFUSED.pending };
  if (clean(unit.committedTo)) return { error: REFUSED.committed };
  const id = clean(unit.id);
  const from = [Number(unit.lng), Number(unit.lat)];
  const orders = list(world?.pendingUnitOrders).filter((entry) => entry && typeof entry === "object");
  const standing = orderOf(orders.find((entry) => clean(entry.unitId) === id));
  const stamp = clean(at, 40) || new Date().toISOString();
  const issued = { issuedAt: clean(date, 40), issuedRound: Math.max(0, Math.trunc(Number(round) || 0)) };

  // The standing orders the war room writes: they stand until the fleet arrives or is told otherwise.
  const moveTo = (to, label = "") => ({ id: `warroom-${id}`, unitId: id, kind: "move", toLng: to[0], toLat: to[1], radiusKm: 0, untilRound: 0, targetLabel: clean(label, 160), ...issued });
  const patrolAt = (to) => ({ id: `warroom-${id}`, unitId: id, kind: "patrol", toLng: to[0], toLat: to[1], radiusKm: FLEET_PATROL_KM, untilRound: 0, targetLabel: "", ...issued });
  // The fleet under `posture` with `order` (undefined: the one it has; null: none).
  const written = (posture, order) => {
    const kept = orders.filter((entry) => clean(entry.unitId) !== id);
    const before = orders.find((entry) => clean(entry.unitId) === id);
    const next = order === undefined ? (before ? [...kept, before] : kept) : order ? [...kept, order] : kept;
    const now = order === undefined ? standing : order;
    const far = now?.kind === "move" ? kmOnMap(from[1], from[0], now.toLat, now.toLng) : 0;
    const status = now?.kind === "move" && far > FLEET_ARRIVED_KM ? "moving" : fold(unit.status) === "moving" ? "idle" : unit.status;
    const fleet = { ...unit, posture, status, updatedAt: stamp };
    const nextUnits = units.slice();
    nextUnits[index] = fleet;
    return { world: { ...world, units: nextUnits, pendingUnitOrders: next }, unit: fleet, order: now ? orderOf(now) : null };
  };
  // A place to send it: at sea, and in the water it is in.
  const seaRefusal = (to) => {
    if (!chart || typeof chart.sea !== "function") return REFUSED.chart;
    if (!chart.sea(to[0], to[1])) return REFUSED.land;
    return chart.joins(from, to) ? "" : REFUSED.cut;
  };

  if (op.op === "posture") {
    const posture = fold(op.posture);
    if (!FLEET_POSTURES.includes(posture)) return { error: REFUSED.posture };
    // Patrolling: on the way it is going, or else where it is.
    if (posture === "patrol") return written(posture, standing?.kind === "move" ? undefined : patrolAt([round4(from[0]), round4(from[1])]));
    // Blockading or in transit: still on its way, but no longer on a patrol's station.
    if (posture === "blockade" || posture === "transit") return written(posture, standing?.kind === "patrol" ? null : undefined);
    return written(posture, null);
  }

  if (op.op === "stand") {
    // (A fleet patrolling nothing holds where it is.)
    const posture = fold(unit.posture) === "patrol" ? "holding" : fold(unit.posture);
    return written(posture, null);
  }

  if (op.op === "station") {
    const to = pointOf(op.to);
    if (!to) return { error: REFUSED.place };
    const refusal = seaRefusal(to);
    if (refusal) return { error: refusal };
    if (op.order === "patrol") {
      const far = kmOnMap(from[1], from[0], to[1], to[0]);
      return written("patrol", far <= FLEET_PATROL_KM ? patrolAt(to) : moveTo(to, "a patrol station at sea"));
    }
    const posture = fold(unit.posture);
    return written(SAILS_ITSELF.has(posture) || posture === "patrol" || !posture ? "transit" : posture, moveTo(to));
  }

  if (op.op === "blockade") {
    const enemy = enemiesOf(world, owner).find((name) => fold(name) === fold(op.country));
    if (!enemy) return { error: REFUSED.peace };
    if (!chart || typeof chart.coastOff !== "function") return { error: REFUSED.chart };
    const station = blockadeStationFor(chart, enemy, from);
    if (!station) return { error: REFUSED.coast };
    return written("blockade", moveTo(station, `a blockade station off ${enemy}`));
  }

  // escort
  const convoy = convoysOf(world, owner).find((entry) => entry.id === clean(op.transport, 24));
  const station = convoy ? escortStationFor(convoy) : null;
  if (!station) return { error: REFUSED.convoy };
  if (chart && typeof chart.joins === "function" && !chart.joins(from, station)) return { error: REFUSED.cut };
  const bound = clean(convoy.to?.name);
  return written("transit", moveTo(station, `a station covering the ${clean(convoy.kind) || "convoy"} ${bound ? `bound for ${bound}` : "at sea"}`));
};

// An op as it may be sent to a host: only the fields an op has, each held to
// its size, so that what crosses the wire is small and is nothing else.
export const cleanFleetOp = (op) => {
  if (!op || !FLEET_OPS.includes(op.op)) return null;
  const sent = { op: op.op, unit: clean(op.unit, 160) };
  if (op.op === "posture") sent.posture = clean(op.posture, 20).toLowerCase();
  if (op.op === "station") {
    const to = pointOf(op.to);
    if (to) sent.to = to;
    sent.order = op.order === "patrol" ? "patrol" : "move";
  }
  if (op.op === "blockade") sent.country = clean(op.country, 120);
  if (op.op === "escort") sent.transport = clean(op.transport, 24);
  return sent;
};
