/*! Open Historia — unit orders & deployment controller © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Shared troop interaction state + mutations.
//
// Holds the current unit list in memory (refreshed from world.json every 5s so
// AI-spawned/moved units appear) and applies player mutations immediately for
// snappy feedback, persisting them to world.json. A tiny pub/sub lets the map
// layer, the selection popup and the Forces panel re-render on change.
//
// Player deploy is purely local (you place your own pieces). Move and attack
// write immediately AND queue a machine-readable order (as an action) so the AI
// honors/contests them on the next time-jump. Combat uses the seeded resolver
// in unitCombat.js for instant feedback; the AI reconciles fronts on the jump.

import {
  readWorldState,
  readWorldStateView,
  writeWorldState,
  readGameData,
  readActionsState,
  writeActionsState,
  clearStaleUnitMotion,
  normalizeUnitEntry,
} from "../../runtime/gameState.js";
import { resolveClash, distanceKm, engagementRangeKm, moveLeashKm } from "./unitCombat.js";
import { toCountryName } from "../../runtime/ownerNames.js";

let units = [];
// Standing orders the ENGINE is advancing (world.pendingUnitOrders).
let pendingOrders = [];
let playerCode = "";
let round = 1;
let gameDate = "";
let allowedUnitTypes = null; // null = all types allowed; else the scenario's whitelist
let interactionMode = { kind: "idle" }; // idle | deploy | admin-place | move | attack
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
let unitsOverride = null;
export const setUnitsOverride = (list) => {
  unitsOverride = Array.isArray(list) ? list : null;
  emit();
};

export const getUnits = () => unitsOverride ?? units;
export const getUnitById = (id) => (unitsOverride ?? units).find((unit) => unit.id === id) ?? null;
// Standing orders the ENGINE is advancing — a move still under way, or a patrol
// working its station. Read by the map (heading lines and station rings) and by
// the unit popup, which turns them into "en route to ..., about N km to go".
export const getPendingUnitOrders = () => pendingOrders;
export const getUnitOrder = (unitId) =>
  pendingOrders.find((order) => order.unitId === unitId) ?? null;
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
    // Every unit an action in the queue is still standing over: the classic
    // long-range move and approach orders record theirs here (see queueOrder's
    // unitRevert), and those units really are under orders they have not reached.
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
const commit = async (mutator) => {
  busy = true;
  try {
    const world = await readWorldState({ force: true });
    const nextUnits = mutator(world.units ?? []);
    const saved = await writeWorldState({ ...world, units: nextUnits });
    units = saved.units ?? nextUnits;
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

// A clicked map location described by the region beneath it (see
// resolveRegionAt in Nations.jsx): { regionId, regionName, owner, country, lng, lat }.
// Orders name the PLACE ("Provence in Kingdom of France") rather than bare
// coordinates, so the AI can resolve the order against the region it names.
const isOwnRegion = (unit, region) => {
  const owner = toCountryName(region?.owner ?? "");
  return Boolean(owner) && (owner === unit.ownerCode || owner === toCountryName(unit.ownerCode));
};

const placePhrase = (region, at) =>
  region?.regionName
    ? `${region.regionName}${region.owner ? ` in ${region.owner}` : ""}` +
      `${region.regionId ? ` (region id ${region.regionId})` : ""} — at ${at}`
    : at;

export const moveUnitTo = async (unitId, lng, lat, region = null) => {
  const unit = getUnitById(unitId);
  if (!unit) return { resolved: false };

  const distance = distanceKm(unit, { lng, lat });
  const leash = moveLeashKm(unit.type, gameDate);
  const place = placePhrase(region, `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}`);

  // Beyond the era/type leash the unit does NOT teleport: it stays put with a
  // long-range order the AI advances (or rejects) realistically over turns.
  if (distance > leash) {
    await commit((list) =>
      list.map((u) =>
        u.id === unitId ? { ...u, status: "moving", updatedAt: new Date().toISOString() } : u,
      ),
    );
    await queueOrder(
      `Long-range movement order: ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) is ordered to ` +
        `${place} — about ${Math.round(distance)} km away, beyond a single ` +
        `${unit.type} move in this era (~${leash} km). Advance it realistically across turns given the era, terrain ` +
        `and transport available, or reject the order with an event explaining why it is infeasible.`,
      { unitId: unit.id, status: unit.status },
    );
    return { resolved: false, distance, leash };
  }

  await commit((list) =>
    list.map((u) =>
      u.id === unitId
        // Within the leash the unit is placed on its destination immediately, so it
        // has ARRIVED. This used to stamp "moving" on a formation already standing
        // where it was sent, and classic has no engine to ever take it back off: the
        // unit kept a yellow moving ring for the rest of the campaign. Saves already
        // carrying that are repaired on load by clearStaleUnitMotion.
        ? { ...u, lng, lat, status: "idle", updatedAt: new Date().toISOString() }
        : u,
    ),
  );
  await queueOrder(
    `Move ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) to ${place}.`,
    { unitId: unit.id, lng: unit.lng, lat: unit.lat, status: unit.status },
  );
  return { resolved: true, distance, leash };
};

export const attackWith = async (attackerId, targetId) => {
  const attacker = getUnitById(attackerId);
  const defender = getUnitById(targetId);
  if (!attacker || !defender || attackerId === targetId) return { resolved: false };

  // Out-of-range attacks don't resolve instantly (no striking across the
  // planet): they become an approach order the AI plays out over turns,
  // judged against the era, unit type and logistics.
  const distance = distanceKm(attacker, defender);
  const range = engagementRangeKm(attacker.type, gameDate);
  if (distance > range) {
    await commit((list) =>
      list.map((u) =>
        u.id === attackerId ? { ...u, status: "moving", updatedAt: new Date().toISOString() } : u,
      ),
    );
    await queueOrder(
      `Attack order (approach required): ${attacker.name} (${attacker.type}, id ${attacker.id}, owner ${attacker.ownerCode}) ` +
        `is ordered against ${defender.name} (id ${defender.id}, owner ${defender.ownerCode}) about ${Math.round(distance)} km away — ` +
        `beyond its ~${range} km engagement reach for this era. March/sail/fly it toward the target realistically across turns ` +
        `and resolve the clash when contact is actually possible, or reject the order with an event explaining why it is infeasible.`,
      { unitId: attacker.id, status: attacker.status },
    );
    return { resolved: false, distance, range };
  }

  const result = resolveClash(attacker, defender, round);
  await commit((list) =>
    list
      .map((u) => {
        if (u.id === attackerId) {
          const survives = result.attackerStrength > 0;
          return {
            ...u,
            strength: result.attackerStrength,
            status: survives ? "engaged" : "defeated",
            lng: survives && result.captured ? defender.lng : u.lng,
            lat: survives && result.captured ? defender.lat : u.lat,
            updatedAt: new Date().toISOString(),
          };
        }
        if (u.id === targetId) {
          return {
            ...u,
            strength: result.defenderStrength,
            status: result.defenderStrength > 0 ? "engaged" : "defeated",
            updatedAt: new Date().toISOString(),
          };
        }
        return u;
      })
      .filter((u) => u.strength > 0),
  );

  await queueOrder(
    `Attack: ${attacker.name} (id ${attacker.id}, owner ${attacker.ownerCode}) assaults ` +
      `${defender.name} (id ${defender.id}, owner ${defender.ownerCode}). Local resolution -> ` +
      `attacker strength ${result.attackerStrength}, defender strength ${result.defenderStrength}` +
      `${result.captured ? "; attacker holds the field (consider a regionTransfer)" : ""}. ` +
      `Escalate, reinforce or counterattack as the wider front warrants.`,
  );
  return { resolved: true, distance, range };
};

// Attack aimed at a map feature — a city or a built structure (world.markers) —
// rather than another unit. There is no local clash to resolve against a
// building, so the instant feedback is positional: in range the unit closes on
// the objective and reads "engaged", and the queued order hands the assault to
// the AI, which owns the outcome (a fallen city may mean a regionTransfer, a
// stormed structure a markerOps remove/rebuild). Out of range it becomes an
// approach order exactly like a long-range unit attack.
export const attackFeature = async (attackerId, target) => {
  const attacker = getUnitById(attackerId);
  const point = { lng: Number(target?.lng), lat: Number(target?.lat) };
  if (!attacker || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return { resolved: false };
  // Ordering troops against their own structure is a misclick, not an order.
  if (target.source === "marker" && target.ownerCode && target.ownerCode === attacker.ownerCode) {
    return { resolved: false, ownTarget: true };
  }

  const targetLabel = target.source === "marker"
    ? `the ${target.kind ? `${target.kind} ` : ""}structure "${target.name || "unnamed"}"` +
      `${target.ownerCode ? ` held by ${target.ownerCode}` : ""}${target.id ? ` (marker id ${target.id})` : ""}`
    : `the city of ${target.name || "an unnamed city"}`;
  const at = `lat ${point.lat.toFixed(2)}, lng ${point.lng.toFixed(2)}`;

  const distance = distanceKm(attacker, point);
  const range = engagementRangeKm(attacker.type, gameDate);
  if (distance > range) {
    await commit((list) =>
      list.map((u) =>
        u.id === attackerId ? { ...u, status: "moving", updatedAt: new Date().toISOString() } : u,
      ),
    );
    await queueOrder(
      `Attack order (approach required): ${attacker.name} (${attacker.type}, id ${attacker.id}, owner ${attacker.ownerCode}) ` +
        `is ordered to assault ${targetLabel} at ${at}, about ${Math.round(distance)} km away — beyond its ~${range} km ` +
        `engagement reach for this era. March/sail/fly it toward the objective realistically across turns and resolve the ` +
        `assault when contact is actually possible, or reject the order with an event explaining why it is infeasible.`,
      { unitId: attacker.id, status: attacker.status },
    );
    return { resolved: false, distance, range };
  }

  await commit((list) =>
    list.map((u) =>
      u.id === attackerId
        ? { ...u, lng: point.lng, lat: point.lat, status: "engaged", updatedAt: new Date().toISOString() }
        : u,
    ),
  );
  await queueOrder(
    `Assault order: ${attacker.name} (${attacker.type}, id ${attacker.id}, owner ${attacker.ownerCode}) attacks ` +
      `${targetLabel} at ${at} and is now engaged at the objective. Resolve the assault on the next turn — decide the ` +
      `defense it meets, the casualties, and the outcome. If the objective falls, reflect it: a captured city usually ` +
      `implies a regionTransfer of its region, and a destroyed or seized structure should be reflected with markerOps ` +
      `(remove it, or rebuild it under the new owner). If the assault is repelled, say so in an event and adjust the unit.`,
    { unitId: attacker.id, lng: attacker.lng, lat: attacker.lat, status: attacker.status },
  );
  return { resolved: true, distance, range };
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

// Attack aimed at a PROVINCE (a region under the cursor) rather than another
// unit or a city/marker. There is no local clash against a province — the
// instant feedback is the march: in range the unit closes on the target and
// reads "engaged", and the queued order hands the assault to the AI, which owns
// the outcome (a fallen province is a regionTransfer on the next jump). Out of
// range it becomes an approach order, exactly like a long-range unit attack.
export const attackRegion = async (attackerId, target) => {
  const attacker = getUnitById(attackerId);
  const point = { lng: Number(target?.lng), lat: Number(target?.lat) };
  if (!attacker || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return { resolved: false };
  // Ordering troops against a province they already hold is a misclick, not an order.
  if (isOwnRegion(attacker, target)) return { resolved: false, ownTarget: true };

  const at = `lat ${point.lat.toFixed(2)}, lng ${point.lng.toFixed(2)}`;
  const regionLabel = target.regionName
    ? `the province of ${target.regionName}` +
      `${target.owner ? `, held by ${target.owner}` : ""}${target.regionId ? ` (region id ${target.regionId})` : ""}`
    : `the area at ${at}`;
  const place = placePhrase(target, at);

  const distance = distanceKm(attacker, point);
  const range = engagementRangeKm(attacker.type, gameDate);
  if (distance > range) {
    await commit((list) =>
      list.map((u) =>
        u.id === attackerId ? { ...u, status: "moving", updatedAt: new Date().toISOString() } : u,
      ),
    );
    await queueOrder(
      `Attack order (approach required): ${attacker.name} (${attacker.type}, id ${attacker.id}, owner ${attacker.ownerCode}) ` +
        `is ordered to assault ${place}, about ${Math.round(distance)} km away — beyond its ~${range} km ` +
        `engagement reach for this era. March/sail/fly it toward the province realistically across turns and resolve the ` +
        `assault when contact is actually possible, or reject the order with an event explaining why it is infeasible.`,
      { unitId: attacker.id, status: attacker.status },
    );
    return { resolved: false, distance, range };
  }

  await commit((list) =>
    list.map((u) =>
      u.id === attackerId
        ? { ...u, lng: point.lng, lat: point.lat, status: "engaged", updatedAt: new Date().toISOString() }
        : u,
    ),
  );
  await queueOrder(
    `Assault order: ${attacker.name} (${attacker.type}, id ${attacker.id}, owner ${attacker.ownerCode}) attacks ` +
      `${regionLabel} and is now engaged at the objective. Resolve the assault on the next turn — decide the ` +
      `defense it meets, the casualties, and the outcome. If the province falls, reflect it with a ` +
      `regionTransfer of ${target.regionId || at} to ${attacker.ownerCode}. If the assault is repelled, say so in an ` +
      `event and adjust the unit.`,
    { unitId: attacker.id, lng: attacker.lng, lat: attacker.lat, status: attacker.status },
  );
  return { resolved: true, distance, range };
};

export const disbandUnit = async (unitId) => {
  const unit = getUnitById(unitId);
  if (!unit) return;
  await commit((list) => list.filter((u) => u.id !== unitId));
  await queueOrder(
    `Disband order: ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) is decommissioned and stood down.`,
  );
};
