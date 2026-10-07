/*! Open Historia — unit orders & deployment controller © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Shared troop interaction state + mutations.
//
// Holds the current unit list in memory (read once, then refreshed from each
// oh:world-updated / oh:game-updated event a write dispatches, so AI-spawned
// and moved units appear; there is no poll) and applies player mutations
// immediately for snappy feedback, persisting them to world.json. A tiny
// pub/sub lets the map layer, the selection popup and the Forces panel
// re-render on change.
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
import { wrapLng } from "../../runtime/unitMotion.js";
import { TURN_RUNNING_NOTE, isSimulationBusy } from "../AI/simulationStatus.js";
import { inSharedGame, requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";

// A turn reads world.json when it starts and writes it back whole when it
// lands, so a unit placed, disbanded or moved in between would be undone
// without a word. While one runs (or waits to be retried) the map's unit
// changes are refused, and the Forces panel and the unit card say why.
// Requested orders are not: they go to the queue, which the turn reads again
// before it writes it (runtime/turnCommit.js).
export const unitsLocked = () => {
  if (!isSimulationBusy()) return false;
  console.warn("[units] a turn is running; the change was not made.");
  return true;
};

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
// Whether `type` may be deployed under `allowed` (null or empty: any type).
export const isDeployableType = (type, allowed) =>
  !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(String(type ?? "").trim().toLowerCase());
export const getInteractionMode = () => interactionMode;
export const setInteractionMode = (next) => {
  interactionMode = next && next.kind ? next : { kind: "idle" };
  emit();
};
export const clearInteractionMode = () => setInteractionMode({ kind: "idle" });

// A placement armed in one save belongs to that save: left armed, the first
// click on the next map deployed the other save's unit there — an air wing in
// 1200 AD — past that scenario's allowed types.
const onActiveGameChanged = () => {
  if (interactionMode.kind !== "idle") clearInteractionMode();
};
if (typeof window !== "undefined") {
  window.addEventListener("oh:active-game-changed", onActiveGameChanged);
}

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
    if (syncRefCount === 0) {
      uninstallUnitSync();
      // No map left to take the placement's click.
      if (interactionMode.kind !== "idle") clearInteractionMode();
    }
  };
};

// Read-modify-write world.units while preserving the rest of world state.
// `orders`, when given, rewrites world.pendingUnitOrders in the same write from
// the new unit list, so a unit and its standing order never disagree on disk.
// Resolves to the saved units, or null when the write failed: the caller must
// know, because an order queued beside a unit that was never saved sends the
// next jump to rule on a formation that is not on the map.
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
    return null;
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
  if (unitsLocked()) return null;
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

  const saved = await commit((list) =>
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

  return saved ? saved.find((unit) => unit.id === id) ?? null : null;
};

// Authoritative map-placement seam for Cheats 2.0. This is deliberately NOT a
// normal move order: no movement leash, no status mutation, no queued player
// Action, and no AI permission step. It only changes the selected canonical
// unit's coordinates while preserving its identity, owner, strength and status.
export const placeUnitAdmin = async (unitId, lng, lat) => {
  const id = String(unitId ?? "").trim();
  const nextLng = wrapLng(Number(lng));
  const nextLat = Number(lat);
  if (!id || !Number.isFinite(nextLng) || !Number.isFinite(nextLat)) return null;
  if (nextLat < -90 || nextLat > 90) return null;
  if (!units.some((unit) => unit.id === id)) return null;
  return updateUnitAdmin(id, { lng: nextLng, lat: nextLat });
};

// What the player is told when an order could not be written: the map and the
// AI's picture of the war would drift apart without a word.
export const ORDER_NOT_SAVED = "The order could not be saved; the next time skip would not see it. Try again.";
export const UNIT_TYPE_NOT_ALLOWED = "This scenario does not allow that kind of unit.";
// The Force Manager's edits are not orders, so the next skip is not involved.
export const UNIT_NOT_SAVED = "The unit could not be saved. Try again.";

// unitRevert records how to undo the order if the player deletes the queued
// action before the next jump (#368): without it, a manual move stayed on the
// map while the AI was never told about it.
const orderAction = (text, unitRevert = null) => ({
  kind: "action",
  source: "order",
  status: "planned",
  text,
  title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
  ...(unitRevert ? { unitRevert } : {}),
});

// Rewrites the action queue. Resolves to the queue as it was before, or null
// when it could not be read or written.
const editActions = async (edit) => {
  try {
    const before = await readActionsState({ force: true });
    await writeActionsState(edit([...before]));
    return before;
  } catch (error) {
    console.error("Failed to queue order:", error);
    return null;
  }
};

// Resolves to whether the order was written.
const queueOrder = async (text, unitRevert = null) =>
  Boolean(await editActions((actions) => [...actions, orderAction(text, unitRevert)]));

// A change to the units that the AI must hear about, as one change: the action
// queue first, then the units, and the queue put back as it was if the units
// could not be saved. Neither half is left standing without the other — a
// deploy request for a unit that is not on the map, or a unit gone with no
// order behind it. Resolves to whether both were saved.
const commitWithActions = async (edit, mutator) => {
  const before = await editActions(edit);
  if (!before) return false;
  if (await commit(mutator)) return true;
  try {
    await writeActionsState(before);
  } catch (error) {
    console.error("Failed to take back the queued order:", error);
  }
  return false;
};

// Undo a queued manual order whose action the player deleted (#368): a pending
// deploy is removed again, a disbanded unit comes back, a moved unit snaps back
// to its recorded position, and a long-range/approach order restores the unit's
// prior status. Resolves to whether the undo was saved.
export const revertUnitOrder = async (revert) => {
  const unitId = String(revert?.unitId ?? "").trim();
  if (!unitId) return false;
  // In a shared game the host undoes an order's move when the order is
  // withdrawn (multiplayer/host/forces.js): there is nothing to undo here.
  if (inSharedGame()) return true;
  if (unitsLocked()) return false;
  // A standing order minted by the beta engine for this action: cancel it, or the
  // unit keeps marching toward a destination whose justification is gone.
  if (revert.pendingOrderId) {
    await commitPendingOrders((list) => list.filter((entry) => entry.id !== revert.pendingOrderId));
  }
  if (revert.remove) {
    return Boolean(await commit((list) => list.filter((u) => u.id !== unitId)));
  }
  // A disband the player took back: the formation stands again as it was, but
  // for its standing order, which went with it when it left the map (every
  // world write drops the orders of units that are gone). Brought back still
  // "moving" under an order that no longer exists, it would march nowhere.
  if (revert.restore) {
    const { restore } = revert;
    const unit = {
      ...restore,
      id: unitId,
      ...(restore.orderId
        ? { orderId: "", posture: "", ...(restore.status === "moving" ? { status: "idle" } : {}) }
        : {}),
    };
    return Boolean(await commit((list) =>
      (list.some((u) => u.id === unitId) ? list : [...list, unit])));
  }
  return Boolean(await commit((list) =>
    list.map((u) => {
      if (u.id !== unitId) return u;
      return {
        ...u,
        ...(Number.isFinite(revert.lng) && Number.isFinite(revert.lat) ? { lng: revert.lng, lat: revert.lat } : {}),
        ...(revert.status ? { status: revert.status } : {}),
        ...(revert.pendingOrderId ? { orderId: "" } : {}),
        updatedAt: new Date().toISOString(),
      };
    })));
};

// Resolves to { ok: true } once the unit and its Deploy request are both
// saved, else to { ok: false, error } with neither left behind.
// Null when a turn is running and nothing was placed.
// A type the scenario does not allow (world.allowedUnitTypes) is refused,
// placing nothing: the Forces panel only offers those, and this holds the rule
// for every other caller too (the advisor's one-click deployments).
export const deployUnit = async ({ type, strength, name, composition, lng, lat }) => {
  // In a shared game the host raises the formation and queues its Deploy
  // request, for this player and by the same rules (multiplayer/host/forces.js);
  // both come back in the next view.
  if (inSharedGame()) {
    const answer = await requestFromHost("deploy", {
      type: String(type ?? "").trim().toLowerCase(),
      strength: Math.max(1, Math.min(100, Number(strength) || 100)),
      name: String(name ?? "").trim().slice(0, 80),
      composition: String(composition ?? "").trim().slice(0, 200),
      lng: wrapLng(Number(lng)),
      lat: Number(lat),
    });
    return answer.ok ? { ok: true } : { ok: false, error: answer.error || ORDER_NOT_SAVED };
  }
  if (unitsLocked()) return null;
  if (!playerCode) await bootstrap();
  if (!isDeployableType(type, allowedUnitTypes)) return { ok: false, error: UNIT_TYPE_NOT_ALLOWED };
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
  if (!unit) return { ok: false, error: ORDER_NOT_SAVED };
  // The scenario's allowed types (no air wing in 1200), whoever asks: the
  // Forces panel offers only those, but the advisor names its own.
  if (allowedUnitTypes && !allowedUnitTypes.includes(unit.type)) return { ok: false, error: UNIT_TYPE_NOT_ALLOWED };
  const text =
    `Deploy request: ${name || type} (${type}, strength ${strength}% of establishment` +
    `${composition ? `, ${composition}` : ""}, owner ${playerCode || "PLAYER"}) at ` +
    `lat ${unit.lat.toFixed(2)}, lng ${unit.lng.toFixed(2)}. Currently pending — confirm it into the order of battle, ` +
    `reposition it, or reject it as the front and logistics allow.`;
  const saved = await commitWithActions(
    (actions) => [...actions, orderAction(text, { unitId: unit.id, remove: true })],
    (list) => [...list, unit],
  );
  return saved ? { ok: true } : { ok: false, error: ORDER_NOT_SAVED };
};

// ---- beta system: stated intent ------------------------------------------

// The player asks for something to be done with a formation, in their own words.
// This is intent, not control: it queues an ordinary action for the AI to weigh
// against the front, the era and everyone else's plans on the next jump — the
// same treatment every other action they plan gets. Nothing on the map moves now.
// Resolves to whether the order was written.
export const requestUnitOrders = async (unitId, text) => {
  const request = String(text ?? "").trim();
  const unit = getUnitById(unitId);
  if (!unit || !request) return false;
  // In a shared game an order is asked of the host, like any other
  // (multiplayer/): the same words, under this player's country.
  if (inSharedGame()) {
    const wording = `Orders requested for ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}), ` +
      `currently at lat ${unit.lat.toFixed(2)}, lng ${unit.lng.toFixed(2)}: ${request} — ` +
      `carry this out over the coming period as far as the era, terrain, logistics and the wider ` +
      `situation allow, or explain in an event why it could not be done.`;
    return (await requestFromHost("order", { text: wording.slice(0, 1500) })).ok;
  }
  return queueOrder(
    `Orders requested for ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}), ` +
      `currently at lat ${unit.lat.toFixed(2)}, lng ${unit.lng.toFixed(2)}: ${request} — ` +
      `carry this out over the coming period as far as the era, terrain, logistics and the wider ` +
      `situation allow, or explain in an event why it could not be done.`,
  );
};

// The player stands one of their formations down. The unit leaves the map now
// and a Disband order rides with the next jump, so the AI narrates the
// stand-down instead of never learning of it. The order carries the unit as it
// was (unitRevert.restore): deleting the order before the jump brings it back.
//
// A unit still pending — deployed, not yet confirmed by a jump — was never in
// the order of battle: its Deploy request is withdrawn with it, and no Disband
// order is queued, or the next skip would raise the brigade the player just
// dismissed.
//
// Resolves to { ok: true } once both halves are saved, else to
// { ok: false, error } with the unit and the queue as they were (while a turn
// runs, nothing is changed and the error says so).
export const disbandUnit = async (unitId) => {
  const unit = getUnitById(unitId);
  if (!unit) return { ok: false, error: ORDER_NOT_SAVED };
  // In a shared game the host stands it down (multiplayer/host/forces.js).
  if (inSharedGame()) {
    const answer = await requestFromHost("disband", { unit: String(unit.id) });
    return answer.ok ? { ok: true } : { ok: false, error: answer.error || ORDER_NOT_SAVED };
  }
  if (unitsLocked()) return { ok: false, error: TURN_RUNNING_NOTE };
  const removeIt = (list) => list.filter((u) => u.id !== unit.id);
  const edit = unit.status === "pending"
    ? (actions) => actions.filter((action) =>
      !(action?.unitRevert?.remove && action.unitRevert.unitId === unit.id && (action.status ?? "planned") === "planned"))
    : (actions) => [
      ...actions,
      orderAction(
        `Disband order: ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) is decommissioned and stood down.`,
        { unitId: unit.id, restore: unit },
      ),
    ];
  const saved = await commitWithActions(edit, removeIt);
  return saved ? { ok: true } : { ok: false, error: ORDER_NOT_SAVED };
};
