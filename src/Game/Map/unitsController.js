/*! Open Historia — unit orders & deployment controller © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Shared troop interaction state + mutations.
//
// Holds the current unit list in memory (refreshed from world.json every 5s so
// AI-spawned/moved units appear) and applies player mutations immediately for
// snappy feedback, persisting them to world.json. A tiny pub/sub lets the map
// layer, the selection popup and the Forces panel re-render on change.
//
// Player deploy is purely local (you place your own pieces) and queues a
// machine-readable order (as an action) so the AI confirms or rejects it on the
// next time-jump; anything else a player wants from a formation is stated as
// intent (requestUnitOrders) and carried out by the engine and the AI.

import {
  readWorldState,
  readWorldStateView,
  writeWorldState,
  readGameData,
  readActionsState,
  writeActionsState,
  clearStaleUnitMotion,
  normalizeUnitEntry,
  recenterPatrolOrders,
} from "../../runtime/gameState.js";

let units = [];
// Standing orders the ENGINE is advancing (world.pendingUnitOrders).
let pendingOrders = [];
let playerCode = "";
let round = 1;
let gameDate = "";
let allowedUnitTypes = null; // null = all types allowed; else the scenario's whitelist
let interactionMode = { kind: "idle" }; // idle | deploy | admin-place
let syncRefCount = 0;
let syncInstalled = false;
let bootstrapPromise = null;
let busy = false; // suppress external adoption mid-commit

const listeners = new Set();
const emit = () => {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (error) {
      console.error("units listener failed:", error);
    }
  }
};

export const subscribeUnits = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Visual override for the staged event reveal (see time.jsx): while a turn's
// events are being revealed one by one, the map shows the units as of the last
// revealed event rather than the final post-jump list. null = live state.
//
// The standing orders of that same moment ride with them. The map draws a
// patrol's ring and a march's heading line from the orders, and the saved ones
// belong to another moment — the pre-jump world while a skip streams its events,
// the finished turn while a past one is replayed — so a patrolling unit moved
// off to its new station while its ring stayed at the old one.
let unitsOverride = null;
let ordersOverride = null;
export const setUnitsOverride = (list, orders = null) => {
  unitsOverride = Array.isArray(list) ? list : null;
  ordersOverride = unitsOverride && Array.isArray(orders) ? orders : null;
  emit();
};

export const getUnits = () => unitsOverride ?? units;
export const getUnitById = (id) => (unitsOverride ?? units).find((unit) => unit.id === id) ?? null;
// Standing orders the ENGINE is advancing — a move still under way, or a patrol
// working its station. Read by the map (heading lines and station rings) and by
// the unit popup, which turns them into "en route to ..., about N km to go".
export const getPendingUnitOrders = () => ordersOverride ?? pendingOrders;
export const getUnitOrder = (unitId) =>
  (ordersOverride ?? pendingOrders).find((order) => order.unitId === unitId) ?? null;
export const getPlayerCode = () => playerCode;
// The scenario's allowed deployable troop types, or null when unrestricted.
export const getAllowedUnitTypes = () => allowedUnitTypes;
export const getInteractionMode = () => interactionMode;
export const setInteractionMode = (next) => {
  interactionMode = next && next.kind ? next : { kind: "idle" };
  emit();
};
export const clearInteractionMode = () => setInteractionMode({ kind: "idle" });

const sameUnits = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] || {};
    const right = b[index] || {};
    if (
      left.id !== right.id ||
      left.type !== right.type ||
      left.ownerCode !== right.ownerCode ||
      left.name !== right.name ||
      left.strength !== right.strength ||
      left.status !== right.status ||
      left.lng !== right.lng ||
      left.lat !== right.lat ||
      left.orderId !== right.orderId ||
      left.updatedAt !== right.updatedAt
    ) {
      return false;
    }
  }
  return true;
};

const sameAllowedUnitTypes = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const sameOrders = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] || {};
    const right = b[index] || {};
    if (
      left.id !== right.id ||
      left.unitId !== right.unitId ||
      left.kind !== right.kind ||
      left.toLng !== right.toLng ||
      left.toLat !== right.toLat ||
      left.radiusKm !== right.radiusKm ||
      left.untilRound !== right.untilRound
    ) {
      return false;
    }
  }
  return true;
};

const adoptWorld = (world, { notify = true } = {}) => {
  if (!world || typeof world !== "object" || busy) return false;

  const nextUnits = Array.isArray(world.units) ? world.units : [];
  const nextAllowed =
    Array.isArray(world.allowedUnitTypes) && world.allowedUnitTypes.length
      ? world.allowedUnitTypes
      : null;

  const nextOrders = Array.isArray(world.pendingUnitOrders) ? world.pendingUnitOrders : [];

  const unitsChanged = !sameUnits(units, nextUnits);
  const typesChanged = !sameAllowedUnitTypes(allowedUnitTypes, nextAllowed);
  const ordersChanged = !sameOrders(pendingOrders, nextOrders);

  if (unitsChanged) units = nextUnits;
  if (typesChanged) allowedUnitTypes = nextAllowed;
  if (ordersChanged) pendingOrders = nextOrders;

  const changed = unitsChanged || typesChanged || ordersChanged;
  if (notify && changed) emit();
  return changed;
};

const adoptGame = (game, { notify = true } = {}) => {
  if (!game || typeof game !== "object" || busy) return false;

  const nextPlayerCode = game.country ?? "";
  const nextRound = game.round ?? 1;
  const nextGameDate = game.gameDate || game.startDate || "";

  const changed =
    nextPlayerCode !== playerCode ||
    nextRound !== round ||
    nextGameDate !== gameDate;

  playerCode = nextPlayerCode;
  round = nextRound;
  gameDate = nextGameDate;

  if (notify && changed) emit();
  return changed;
};

// Once per session, on the first sync: clear the stale "moving" status that older
// saves carry on units nothing is actually moving. See clearStaleUnitMotion for
// what produced them and why a unit under a queued order is left alone. Written
// back rather than merely displayed, so the save stops lying about it too.
let motionRepaired = false;
const repairStaleUnitMotion = async () => {
  if (motionRepaired) return;
  motionRepaired = true;
  busy = true;
  try {
    const [world, actions] = await Promise.all([
      readWorldState({ force: true }),
      readActionsState({ force: true }),
    ]);
    // Every unit an action in the queue is still standing over (queueOrder's
    // unitRevert): those units really are under orders they have not reached.
    const queuedUnitIds = actions.map((action) => action?.unitRevert?.unitId).filter(Boolean);
    const repaired = clearStaleUnitMotion(world, { queuedUnitIds });
    if (repaired === world) return;
    const saved = await writeWorldState(repaired);
    units = saved.units ?? repaired.units;
    emit();
  } catch (error) {
    console.error("Failed to clear stale unit motion:", error);
  } finally {
    busy = false;
  }
};

const bootstrap = async () => {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = Promise.all([
    // Read-only normalized view is cached/stable and does NOT force a network
    // round-trip or build a fresh mutable world every five seconds.
    readWorldStateView({ force: false }),
    readGameData({ force: false }),
  ])
    .then(([world, game]) => {
      const unitsChanged = adoptWorld(world, { notify: false });
      const gameChanged = adoptGame(game, { notify: false });
      if (unitsChanged || gameChanged) emit();
      void repairStaleUnitMotion();
    })
    .catch((error) => {
      console.error("Failed to bootstrap units:", error);
    })
    .finally(() => {
      bootstrapPromise = null;
    });

  return bootstrapPromise;
};

const onWorldUpdated = (event) => {
  adoptWorld(event?.detail?.world);
};

const onGameUpdated = (event) => {
  adoptGame(event?.detail?.game);
};

const installUnitSync = () => {
  if (syncInstalled || typeof window === "undefined") return;
  syncInstalled = true;
  window.addEventListener("oh:world-updated", onWorldUpdated);
  window.addEventListener("oh:game-updated", onGameUpdated);
};

const uninstallUnitSync = () => {
  if (!syncInstalled || typeof window === "undefined") return;
  syncInstalled = false;
  window.removeEventListener("oh:world-updated", onWorldUpdated);
  window.removeEventListener("oh:game-updated", onGameUpdated);
};

export const startUnitsSync = () => {
  syncRefCount += 1;
  installUnitSync();
  void bootstrap();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    syncRefCount = Math.max(0, syncRefCount - 1);
    if (syncRefCount === 0) uninstallUnitSync();
  };
};

// Read-modify-write world.units while preserving the rest of world state.
// `orders`, when given, rewrites world.pendingUnitOrders in the same write from
// the new unit list, so a unit and its standing order never disagree on disk.
const commit = async (mutator, { orders = null } = {}) => {
  busy = true;
  try {
    const world = await readWorldState({ force: true });
    const nextUnits = mutator(world.units ?? []);
    const nextOrders = orders ? orders(world.pendingUnitOrders ?? [], nextUnits) : null;
    const saved = await writeWorldState({ ...world, units: nextUnits, ...(nextOrders ? { pendingUnitOrders: nextOrders } : {}) });
    units = saved.units ?? nextUnits;
    if (nextOrders) pendingOrders = saved.pendingUnitOrders ?? nextOrders;
    emit();
    return units;
  } catch (error) {
    console.error("Failed to commit units:", error);
    return units;
  } finally {
    busy = false;
  }
};

// Read-modify-write world.pendingUnitOrders. Nothing the player does creates a
// standing order — the engine mints them — but revertUnitOrder still has to be
// able to CANCEL one, because an action queued with a pendingOrderId on it may
// still be sitting in actions.json when the player deletes it.
const commitPendingOrders = async (mutator) => {
  busy = true;
  try {
    const world = await readWorldState({ force: true });
    const nextOrders = mutator(world.pendingUnitOrders ?? []);
    const saved = await writeWorldState({ ...world, pendingUnitOrders: nextOrders });
    pendingOrders = saved.pendingUnitOrders ?? nextOrders;
    emit();
    return pendingOrders;
  } catch (error) {
    console.error("Failed to commit pending unit orders:", error);
    return pendingOrders;
  } finally {
    busy = false;
  }
};

// Authoritative editor seam used by Cheats 2.0 / Force Manager. Unlike normal
// player move/deploy/attack functions below, this does NOT queue an Action and
// does not apply movement leashes or AI adjudication. The explicit admin surface
// is allowed to repair the canonical unit record directly while still sharing
// the same normalized world.units persistence path.
export const updateUnitAdmin = async (unitId, patch = {}) => {
  const id = String(unitId ?? "").trim();
  if (!id || !patch || typeof patch !== "object") return null;
  const moved = Object.prototype.hasOwnProperty.call(patch, "lng") || Object.prototype.hasOwnProperty.call(patch, "lat");
  // A patrolling unit placed somewhere else takes its station with it
  // (recenterPatrolOrders): the ring follows it, and the next turn's patrol step
  // works the new station instead of pulling the unit back to the old one. Same
  // write as the unit, so the two never disagree on disk.
  const orders = moved
    ? (list, nextUnits) => {
      const unit = nextUnits.find((entry) => entry.id === id);
      return unit ? recenterPatrolOrders(list, id, unit.lng, unit.lat) : list;
    }
    : null;

  await commit((list) =>
    list.map((unit, index) => {
      if (unit.id !== id) return unit;

      const next = normalizeUnitEntry({
        ...unit,
        ...(Object.prototype.hasOwnProperty.call(patch, "name") ? { name: patch.name } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "type") ? { type: patch.type } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "strength") ? { strength: patch.strength } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "status") ? { status: patch.status } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lng") ? { lng: patch.lng } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lat") ? { lat: patch.lat } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "note") ? { note: patch.note } : {}),
        id: unit.id,
        ownerCode: unit.ownerCode,
        source: unit.source,
        orderId: unit.orderId,
        createdAt: unit.createdAt,
        updatedAt: new Date().toISOString(),
      }, index);

      return next || unit;
    }),
    { orders },
  );

  return units.find((unit) => unit.id === id) ?? null;
};

// Authoritative map-placement seam for Cheats 2.0. This is deliberately NOT a
// normal move order: no movement leash, no status mutation, no queued player
// Action, and no AI permission step. It only changes the selected canonical
// unit's coordinates while preserving its identity, owner, strength and status.
export const placeUnitAdmin = async (unitId, lng, lat) => {
  const id = String(unitId ?? "").trim();
  const nextLng = Number(lng);
  const nextLat = Number(lat);
  if (!id || !Number.isFinite(nextLng) || !Number.isFinite(nextLat)) return null;
  if (nextLng < -180 || nextLng > 180 || nextLat < -90 || nextLat > 90) return null;
  if (!units.some((unit) => unit.id === id)) return null;
  return updateUnitAdmin(id, { lng: nextLng, lat: nextLat });
};

// unitRevert records how to undo the order if the player deletes the queued
// action before the next jump (#368): without it, a manual move stayed on the
// map while the AI was never told about it.
const queueOrder = async (text, unitRevert = null) => {
  try {
    const actions = await readActionsState({ force: true });
    actions.push({
      kind: "action",
      source: "order",
      status: "planned",
      text,
      title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
      ...(unitRevert ? { unitRevert } : {}),
    });
    await writeActionsState(actions);
  } catch (error) {
    console.error("Failed to queue order:", error);
  }
};

// Undo a queued manual order whose action the player deleted (#368): a pending
// deploy is removed again, a moved unit snaps back to its recorded position,
// and a long-range/approach order restores the unit's prior status.
export const revertUnitOrder = async (revert) => {
  const unitId = String(revert?.unitId ?? "").trim();
  if (!unitId) return;
  // A standing order minted by the beta engine for this action: cancel it, or the
  // unit keeps marching toward a destination whose justification is gone.
  if (revert.pendingOrderId) {
    await commitPendingOrders((list) => list.filter((entry) => entry.id !== revert.pendingOrderId));
  }
  if (revert.remove) {
    await commit((list) => list.filter((u) => u.id !== unitId));
    return;
  }
  await commit((list) =>
    list.map((u) => {
      if (u.id !== unitId) return u;
      return {
        ...u,
        ...(Number.isFinite(revert.lng) && Number.isFinite(revert.lat) ? { lng: revert.lng, lat: revert.lat } : {}),
        ...(revert.status ? { status: revert.status } : {}),
        ...(revert.pendingOrderId ? { orderId: "" } : {}),
        updatedAt: new Date().toISOString(),
      };
    }));
};

export const deployUnit = async ({ type, strength, name, composition, lng, lat }) => {
  if (!playerCode) await bootstrap();
  // Deploy as PENDING (rendered translucent): the player states an intent, and the
  // AI confirms, relocates or rejects it on the next time-jump.
  // Built outside the commit so the queued order can reference its id.
  const unit = normalizeUnitEntry({
    type,
    strength,
    name,
    composition,
    lng,
    lat,
    ownerCode: playerCode || "PLAYER",
    source: "player",
    status: "pending",
  });
  if (!unit) return units;
  const saved = await commit((list) => [...list, unit]);
  await queueOrder(
    `Deploy request: ${name || type} (${type}, strength ${strength}% of establishment` +
      `${composition ? `, ${composition}` : ""}, owner ${playerCode || "PLAYER"}) at ` +
      `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}. Currently pending — confirm it into the order of battle, ` +
      `reposition it, or reject it as the front and logistics allow.`,
    { unitId: unit.id, remove: true },
  );
  return saved;
};

// ---- beta system: stated intent ------------------------------------------

// The player asks for something to be done with a formation, in their own words.
// This is intent, not control: it queues an ordinary action for the AI to weigh
// against the front, the era and everyone else's plans on the next jump — the
// same treatment every other action they plan gets. Nothing on the map moves now.
export const requestUnitOrders = async (unitId, text) => {
  const request = String(text ?? "").trim();
  const unit = getUnitById(unitId);
  if (!unit || !request) return false;
  await queueOrder(
    `Orders requested for ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}), ` +
      `currently at lat ${unit.lat.toFixed(2)}, lng ${unit.lng.toFixed(2)}: ${request} — ` +
      `carry this out over the coming period as far as the era, terrain, logistics and the wider ` +
      `situation allow, or explain in an event why it could not be done.`,
  );
  return true;
};

// Round and game date are read by the Forces panel and the unit popup for
// naming and order text; exported so nothing has to re-read game.json.
export const getRound = () => round;
export const getGameDate = () => gameDate;

export const removeUnit = async (unitId) =>
  commit((list) => list.filter((u) => u.id !== unitId));

export const disbandUnit = async (unitId) => {
  const unit = getUnitById(unitId);
  if (!unit) return;
  await commit((list) => list.filter((u) => u.id !== unitId));
  await queueOrder(
    `Disband order: ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) is decommissioned and stood down.`,
  );
};
