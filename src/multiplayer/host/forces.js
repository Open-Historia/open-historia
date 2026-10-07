/*! Open Historia — a player's forces in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A player's own pieces on the map. In single player the screen places and
// removes them itself and queues the order that tells the time skip
// (Game/Map/unitsController.js). In a shared game the host does both halves for
// the player who asked, and holds each to the game's rules: the scenario's unit
// types, a ceiling on how many a person fields, a real place on the map.
//
// What a player wants a formation to DO is an ordinary order, in words
// (request "order"): the time skip weighs it like any other. Only raising a
// formation and standing one down change the map at once, as they do in single
// player: a raised one waits, translucent, for the skip to confirm it.
//
// Plain data in, plain data out: { world, actions } or { error }.

import { normalizeUnitEntry } from "../../runtime/gameState.js";

// The plan's ceiling for a person's formations (the AI's own cap is the
// engine's, gameState.js MAX_UNITS_PER_POLITY).
export const MAX_UNITS_PER_PLAYER = 15;
export const UNIT_NAME_MAX_CHARS = 80;
export const UNIT_COMPOSITION_MAX_CHARS = 200;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const planned = (action) => clean(action?.status || "planned") === "planned";

// The order that tells the time skip, as the screen words it in single player.
const orderAction = (text, { id, owner, at, unitRevert }) => ({
  id,
  kind: "action",
  source: "order",
  status: "planned",
  text,
  title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
  rawInput: text,
  ownerCode: owner,
  createdAt: at,
  ...(unitRevert ? { unitRevert } : {}),
});

const deployable = (type, allowed) => !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(clean(type).toLowerCase());

// Raise a formation: it stands on the map as pending, with the Deploy request
// that asks the time skip to confirm it, move it or turn it down.
export const deployFor = ({ world, actions }, seat, request, { orderId, unitId, at, maxOrders = Infinity } = {}) => {
  const owner = clean(seat);
  const type = clean(request?.type).toLowerCase();
  if (!owner) return { error: "Take a country first." };
  if (!deployable(type, world?.allowedUnitTypes)) return { error: "This scenario does not allow that kind of unit." };
  const mine = list(world?.units).filter((unit) => same(unit?.ownerCode, owner) && clean(unit?.status) !== "defeated");
  if (mine.length >= MAX_UNITS_PER_PLAYER) return { error: `A player fields at most ${MAX_UNITS_PER_PLAYER} formations. Stand one down first.` };
  const queued = list(actions).filter((action) => same(action?.ownerCode, owner) && planned(action));
  if (queued.length >= maxOrders) return { error: `At most ${maxOrders} orders a round.` };
  const strength = Math.max(1, Math.min(100, Math.round(Number(request?.strength) || 100)));
  const name = clean(request?.name).slice(0, UNIT_NAME_MAX_CHARS);
  const composition = clean(request?.composition).slice(0, UNIT_COMPOSITION_MAX_CHARS);
  const unit = normalizeUnitEntry({
    id: unitId,
    type,
    strength,
    name,
    composition,
    lng: Number(request?.lng),
    lat: Number(request?.lat),
    ownerCode: owner,
    source: "player",
    status: "pending",
    createdAt: at,
    updatedAt: at,
  });
  if (!unit || unit.type !== type) return { error: "That is not a place on the map, or not a kind of unit." };
  const text =
    `Deploy request: ${name || type} (${type}, strength ${strength}% of establishment` +
    `${composition ? `, ${composition}` : ""}, owner ${owner}) at ` +
    `lat ${unit.lat.toFixed(2)}, lng ${unit.lng.toFixed(2)}. Currently pending — confirm it into the order of battle, ` +
    `reposition it, or reject it as the front and logistics allow.`;
  return {
    world: { ...world, units: [...list(world?.units), unit] },
    actions: [...list(actions), orderAction(text, { id: orderId, owner, at, unitRevert: { unitId: unit.id, remove: true } })],
    unit,
  };
};

// Stand a formation down. One still pending was never in the order of battle:
// it goes, and its Deploy request with it. Any other leaves the map now, and a
// Disband order rides with the next skip so the world hears of it; the order
// carries the formation as it was, so withdrawing the order brings it back.
export const disbandFor = ({ world, actions }, seat, unitId, { orderId, at, maxOrders = Infinity } = {}) => {
  const owner = clean(seat);
  const id = clean(unitId);
  const unit = list(world?.units).find((entry) => clean(entry?.id) === id);
  if (!unit || !same(unit.ownerCode, owner)) return { error: "That is not one of your formations." };
  const units = list(world.units).filter((entry) => entry !== unit);
  const orders = list(world.pendingUnitOrders).filter((order) => clean(order?.unitId) !== id);
  const nextWorld = { ...world, units, ...(Array.isArray(world.pendingUnitOrders) ? { pendingUnitOrders: orders } : {}) };
  if (clean(unit.status) === "pending") {
    return {
      world: nextWorld,
      actions: list(actions).filter((action) =>
        !(action?.unitRevert?.remove && clean(action.unitRevert.unitId) === id && planned(action) && same(action.ownerCode, owner))),
    };
  }
  const queued = list(actions).filter((action) => same(action?.ownerCode, owner) && planned(action));
  if (queued.length >= maxOrders) return { error: `At most ${maxOrders} orders a round.` };
  const text = `Disband order: ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) is decommissioned and stood down.`;
  return {
    world: nextWorld,
    actions: [...list(actions), orderAction(text, { id: orderId, owner, at, unitRevert: { unitId: id, restore: unit } })],
  };
};

// An order was withdrawn before the skip read it: what it did to the map is
// undone. A pending formation is taken off again; one stood down stands again
// as it was (without the march it was on, whose standing order went with it);
// a standing order the engine minted for the order is cancelled. The order
// itself is the host's own writing (deployFor, disbandFor, or the engine), so
// what it says to undo is trusted; whose it is has been checked by the caller.
export const revertOrderFor = (world, action, seat, { at } = {}) => {
  const revert = action?.unitRevert;
  const unitId = clean(revert?.unitId);
  if (!unitId) return world;
  const owner = clean(seat);
  let units = list(world?.units);
  let orders = list(world?.pendingUnitOrders);
  if (clean(revert.pendingOrderId)) orders = orders.filter((order) => clean(order?.id) !== clean(revert.pendingOrderId));
  if (revert.remove) {
    units = units.filter((unit) => !(clean(unit?.id) === unitId && same(unit.ownerCode, owner)));
  } else if (revert.restore && typeof revert.restore === "object") {
    const { restore } = revert;
    if (same(restore.ownerCode, owner) && !units.some((unit) => clean(unit?.id) === unitId)) {
      units = [...units, {
        ...restore,
        id: unitId,
        ...(clean(restore.orderId) ? { orderId: "", posture: "", ...(clean(restore.status) === "moving" ? { status: "idle" } : {}) } : {}),
      }];
    }
  } else {
    units = units.map((unit) => (clean(unit?.id) === unitId && same(unit.ownerCode, owner)
      ? {
        ...unit,
        ...(Number.isFinite(revert.lng) && Number.isFinite(revert.lat) ? { lng: revert.lng, lat: revert.lat } : {}),
        ...(clean(revert.status) ? { status: clean(revert.status) } : {}),
        ...(clean(revert.pendingOrderId) ? { orderId: "" } : {}),
        updatedAt: at || unit.updatedAt,
      }
      : unit));
  }
  return { ...world, units, ...(Array.isArray(world?.pendingUnitOrders) || orders.length ? { pendingUnitOrders: orders } : {}) };
};
