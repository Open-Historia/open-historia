/*! Open Historia — what the war room tells an air unit: an air strike © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room's Deploy Aircraft (GameUI/warRoomAircraft.jsx): one of the
// player's air units sent to strike a place when time next passes, which
// airStrike.js flies. Each order is an OP, as everything done in the war room
// is (warRoomOps.js): the page playing alone applies it to its own world, and
// a page in a shared game sends it to the host, which applies the very same op
// for the country that asked (runtime/warRoomWrites.js sendAirStrikeOp,
// multiplayer/host/gameHost.js):
//
//   { op: "airstrike", unit, kind, to, target, country, battlefield, marker, people, radius }
//   { op: "unairstrike", unit }     its strike called off
//
//   radius            the strike radius, a share of the era's blast (airStrike.js
//                     strikeRadiusOf, 0.5 to 2 in steps of 0.05): none for the default
//
//   kind "troops"     `to` lies on `battlefield`, one the asker fights on;
//                     `target` names the place near it
//   kind "structure"  `marker`, one of world.markers of a country the asker
//                     is at war with, still standing: struck where it stands
//   kind "city"       `to` is the city's place, `target` its name, `country`
//                     who holds it, a country the asker is at war with (held
//                     to the map's chart where it could be read: runtime/
//                     warRoomChart.js holds); `people`, how many live there
//
// The place lies within the air unit's era's reach of its base (air.js
// AIR_REACH_KM). One strike a unit: another replaces it; at most
// AIR_STRIKE_ORDERS_MOST a country. Only the asker's own air units, and the
// asker is the country that asked, whatever the op says. Pure, and runs in bare node.

import { eraOf, hashSeed } from "../unitMotion.js";
import { eraSettingOf, warSettingsOf } from "../warSettings.js";
import { militaryLookup } from "../militaryStats.js";
import { decodeTroops } from "./codec.js";
import { airWorth, readMilitary } from "./military.js";
import { AIR_REACH_KM } from "./air.js";
import { AIR_BLAST_KM, AIR_STRIKE_KINDS, AIR_STRIKE_ORDERS_MOST, AIR_STRIKE_RADIUS_DEFAULT, enemiesIn, fightersShareOf, normalizeAirStrikeOrders, strikeRadiusOf } from "./airStrike.js";
import { pointInFrame, projectorOf } from "./frame.js";
import { foldBattlefieldName, isOpenBattlefield, normalizeBattlefields } from "./record.js";
import { kmBetween, measureOptions } from "./worldGrid.js";
import { engineMapOf, worldMeasureOf } from "../../../server/mapDistance.js";

export const AIR_STRIKE_OPS = Object.freeze(["airstrike", "unairstrike"]);
// What of world.markers can be struck: what stands.
const STANDING = new Set(["active", "damaged", "inactive", "under_construction"]);

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const round4 = (value) => Math.round(Number(value) * 10000) / 10000;

const REFUSED = Object.freeze({
  nothing: "Nothing was asked.",
  off: "This scenario's wars have no air units.",
  nobody: "You play no country to command it.",
  unit: "That is not an air unit of yours.",
  pending: "That air unit is not in your order of battle yet: it is confirmed when time next passes.",
  spent: "That air unit has nothing left to fly.",
  era: "Nothing flies in this era.",
  peace: "You are at war with nobody.",
  kind: "Say what is to be struck: troops, a structure or a city.",
  place: "Say where it is to strike.",
  field: "That is not on a battlefield you are fighting on.",
  marker: "That is no structure of a country you are at war with, or nothing of it is left standing.",
  city: "Say which city of a country you are at war with.",
  held: "That city is not held by a country you are at war with.",
  many: `You have ${AIR_STRIKE_ORDERS_MOST} air strikes waiting already.`,
});

const pointOf = (value) => (Array.isArray(value) && finite(value[0]) && finite(value[1]) && Math.abs(Number(value[1])) <= 90
  ? [round4(value[0]), round4(value[1])]
  : null);

// How far an air unit reaches, and how far the bombs of one strike fall, in km, at a date in a world.
export const airReachOf = (world, date) => {
  const era = eraOf(date, eraSettingOf(world));
  return { reach: AIR_REACH_KM[era] ?? 0, blast: AIR_BLAST_KM[era] ?? 0 };
};

// A FRONT'S AIR ARM. A country at war with no air unit of its own on the map
// flies its air arm over each battlefield it fights on all the same (air.js
// AIR ARMS): the aircraft the map draws circling over its troops. The war
// room flies a strike with it too ("why is the aircraft button greyed out ...
// then why do I see planes flying around", the owner, 2026-11-03): one air
// arm a battlefield, at full strength, based where the country's troops there
// stand (the middle of them), named for the battlefield. It is no unit of the
// world's: what a strike costs it is gone by the next run, as the engine's own
// arms are whole again each run. None for a country with an air unit of its own
// (it flies that), one whose air arm is worth nothing (its military figures:
// air 0), or one with no troops there.
// i18n-ignore: a key prefix.
export const AIR_ARM_UNIT = "air-arm:";
export const airArmsOf = (world, player) => {
  const wanted = fold(player);
  if (!wanted) return [];
  if (list(world?.units).some((unit) => unit && fold(unit.type) === "air" && fold(unit.ownerCode) === wanted && fold(unit.status) !== "defeated")) return [];
  if (warSettingsOf(world ?? {}).mechanics.military === true && airWorth(readMilitary(militaryLookup(world ?? {})(player))) === 0) return [];
  const arms = [];
  for (const record of normalizeBattlefields(world?.battlefields)) {
    if (record.status !== "active" || !record.frame) continue;
    const side = record.sides.findIndex((members) => members.some((member) => fold(member) === wanted));
    if (side < 0) continue;
    const member = record.sides[side].findIndex((name) => fold(name) === wanted);
    const troops = decodeTroops(record.troops?.[side]).filter((troop) => troop && Number(troop.strength) > 0 && (troop.owner ?? 0) === member);
    if (troops.length === 0) continue;
    const x = troops.reduce((sum, troop) => sum + Number(troop.x), 0) / troops.length;
    const y = troops.reduce((sum, troop) => sum + Number(troop.y), 0) / troops.length;
    const [lng, lat] = projectorOf(record.frame).toLngLat(x, y);
    if (!finite(lng) || !finite(lat)) continue;
    arms.push({ id: `${AIR_ARM_UNIT}${record.name}`, type: "air", ownerCode: record.sides[side][member], name: `${record.name} air arm`, strength: 100, lng: round4(lng), lat: round4(lat), composition: "", status: "" });
  }
  return arms;
};

// The air arms the strikes waiting to fly were ordered for (airArmsOf), as units the strikes fly with
// (airStrike.js resolveAirStrikes): none where no strike names one.
export const airArmsForOrders = (world, orders = world?.airStrikeOrders) => {
  const owners = [...new Set(normalizeAirStrikeOrders(orders).filter((order) => order.unit.startsWith(AIR_ARM_UNIT)).map((order) => order.owner))];
  return owners.flatMap((owner) => airArmsOf(world, owner));
};

// The asker's air units, as the war room lists them, its fronts' air arms among them (airArmsOf):
//   [{ id, name, strength, lng, lat, composition, fighters, pending, order }]
// `fighters` is the share of it that is fighters (airStrike.js fightersShareOf); `order`, the strike it waits to fly, or null.
export const airUnitsOf = (world, player) => {
  const wanted = fold(player);
  if (!wanted) return [];
  const orders = new Map(normalizeAirStrikeOrders(world?.airStrikeOrders).map((order) => [order.unit, order]));
  return [...list(world?.units), ...airArmsOf(world, player)]
    .filter((unit) => unit && fold(unit.type) === "air" && fold(unit.ownerCode) === wanted && clean(unit.id) && Number(unit.strength) >= 1
      && finite(unit.lng) && finite(unit.lat) && fold(unit.status) !== "defeated")
    .map((unit) => ({
      id: clean(unit.id),
      name: clean(unit.name) || "Air unit",
      strength: Math.round(Math.min(100, Number(unit.strength))),
      lng: Number(unit.lng),
      lat: Number(unit.lat),
      composition: clean(unit.composition),
      fighters: fightersShareOf(unit),
      pending: fold(unit.status) === "pending",
      order: orders.get(clean(unit.id)) ?? null,
    }));
};

// The structures of the countries the asker is at war with that a strike can find standing:
//   [{ id, name, kind, ownerCode, lng, lat, status }]
export const strikableStructures = (world, player) => {
  const enemies = enemiesIn(world?.wars, player);
  if (enemies.size === 0) return [];
  return list(world?.markers)
    .filter((marker) => marker && clean(marker.id) && clean(marker.name) && enemies.has(fold(marker.ownerCode)) && STANDING.has(fold(marker.status) || "active")
      && finite(marker.lng) && finite(marker.lat))
    .map((marker) => ({ id: clean(marker.id), name: clean(marker.name), kind: fold(marker.kind), ownerCode: clean(marker.ownerCode), lng: Number(marker.lng), lat: Number(marker.lat), status: fold(marker.status) || "active" }));
};

// The world with one op applied for the country that asked. Returns { world, order }
// (the strike as it now waits, or null when one was called off) or { error } in words a person can read.
//   player   the country asking (the seat's, in a shared game)
//   date     the game's date, and `round` its round: when it was ordered
//   chart    the map's chart (runtime/warRoomChart.js), null where it could not be read: a city's holder is then taken as given
//   air      false in a scenario without air units (the Wars feature)
export const applyAirStrikeOp = (world, op, { player = "", date = "", round = 0, chart = null, air = true } = {}) => {
  if (!op || !AIR_STRIKE_OPS.includes(op.op)) return { error: REFUSED.nothing };
  if (air === false) return { error: REFUSED.off };
  const owner = clean(player, 120);
  if (!owner) return { error: REFUSED.nobody };
  const wanted = clean(op.unit, 160);
  const unit = wanted ? list(world?.units).find((entry) => entry && clean(entry.id) === wanted) ?? airArmsOf(world, owner).find((entry) => entry.id === wanted) ?? null : null;
  if (!unit || fold(unit.type) !== "air" || fold(unit.ownerCode) !== fold(owner)) return { error: REFUSED.unit };
  const id = clean(unit.id);
  const orders = normalizeAirStrikeOrders(world?.airStrikeOrders);
  const others = orders.filter((order) => order.unit !== id);
  if (op.op === "unairstrike") return { world: { ...world, airStrikeOrders: others }, order: null };

  if (fold(unit.status) === "pending") return { error: REFUSED.pending };
  if (!(Number(unit.strength) >= 1)) return { error: REFUSED.spent };
  const { reach } = airReachOf(world, date);
  if (!(reach > 0)) return { error: REFUSED.era };
  const enemies = enemiesIn(world?.wars, owner);
  if (enemies.size === 0) return { error: REFUSED.peace };
  const kind = AIR_STRIKE_KINDS.includes(op.kind) ? op.kind : "";
  if (!kind) return { error: REFUSED.kind };

  let to = null;
  let target = "";
  let country = "";
  let battlefield = "";
  let marker = "";
  let people = 0;
  if (kind === "structure") {
    const found = list(world?.markers).find((entry) => entry && clean(entry.id) === clean(op.marker, 160));
    if (!found || !enemies.has(fold(found.ownerCode)) || !STANDING.has(fold(found.status) || "active") || !finite(found.lng) || !finite(found.lat)) return { error: REFUSED.marker };
    to = [round4(found.lng), round4(found.lat)];
    target = clean(found.name, 160);
    country = clean(found.ownerCode, 120);
    marker = clean(found.id, 160);
  } else {
    to = pointOf(op.to);
    if (!to) return { error: REFUSED.place };
    if (kind === "troops") {
      const record = normalizeBattlefields(world?.battlefields).find((entry) => isOpenBattlefield(entry) && foldBattlefieldName(entry.name) === foldBattlefieldName(op.battlefield));
      const side = record ? record.sides.findIndex((members) => list(members).some((member) => fold(member) === fold(owner))) : -1;
      if (!record || side < 0 || !record.frame || !pointInFrame(record.frame, to[0], to[1])) return { error: REFUSED.field };
      battlefield = record.name;
      country = clean(record.sides[1 - side]?.[0], 120);
      target = clean(op.target, 160);
    } else {
      target = clean(op.target, 160);
      country = [...list(world?.wars).flatMap((war) => [...list(war?.sideA), ...list(war?.sideB)])].map((name) => clean(name, 120)).find((name) => fold(name) === fold(op.country)) ?? "";
      if (!target || !country || !enemies.has(fold(country))) return { error: REFUSED.city };
      if (chart && typeof chart.holds === "function" && chart.holds(country, to[0], to[1]) === false) return { error: REFUSED.held };
      people = Math.max(0, Math.round(Number(op.people) || 0));
    }
  }
  const far = kmBetween(Number(unit.lng), Number(unit.lat), to[0], to[1], measureOptions(engineMapOf(worldMeasureOf(world))));
  if (!(far <= reach)) return { error: `That is beyond ${clean(unit.name) || "the air unit"}'s reach: ${Math.round(far).toLocaleString("en-US")} km, and it reaches ${reach.toLocaleString("en-US")} km.` };
  if (others.filter((order) => fold(order.owner) === fold(owner)).length >= AIR_STRIKE_ORDERS_MOST) return { error: REFUSED.many };
  const radius = strikeRadiusOf(op.radius);
  // (A strike at the default radius keeps the id it always had.)
  const idParts = [id, Math.max(0, Math.trunc(Number(round) || 0)), to[0], to[1], kind, ...(radius === AIR_STRIKE_RADIUS_DEFAULT ? [] : [radius])];
  const order = normalizeAirStrikeOrders([{
    id: `strike-${hashSeed(idParts.join("|")).toString(36)}`,
    unit: id,
    owner,
    kind,
    lng: to[0],
    lat: to[1],
    target,
    country,
    battlefield,
    marker,
    people,
    date: clean(date, 40),
    round: Math.max(0, Math.trunc(Number(round) || 0)),
    radius,
  }])[0];
  return { world: { ...world, airStrikeOrders: [...others, order] }, order };
};

// An op as it may be sent to a host: only the fields an op has, each held to
// its size, so that what crosses the wire is small and is nothing else.
export const cleanAirStrikeOp = (op) => {
  if (!op || !AIR_STRIKE_OPS.includes(op.op)) return null;
  const sent = { op: op.op, unit: clean(op.unit, 160) };
  if (op.op === "airstrike") {
    sent.kind = AIR_STRIKE_KINDS.includes(op.kind) ? op.kind : "";
    const to = pointOf(op.to);
    if (to) sent.to = to;
    if (clean(op.target)) sent.target = clean(op.target, 160);
    if (clean(op.country)) sent.country = clean(op.country, 120);
    if (clean(op.battlefield)) sent.battlefield = clean(op.battlefield, 120);
    if (clean(op.marker)) sent.marker = clean(op.marker, 160);
    if (Number(op.people) > 0) sent.people = Math.round(Number(op.people));
    if (strikeRadiusOf(op.radius) !== AIR_STRIKE_RADIUS_DEFAULT) sent.radius = strikeRadiusOf(op.radius);
  }
  return sent;
};
