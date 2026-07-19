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
  writeWorldState,
  readGameData,
  readActionsState,
  writeActionsState,
  normalizeUnitEntry,
} from "../../runtime/gameState.js";
import { resolveClash, distanceKm, engagementRangeKm, moveLeashKm } from "./unitCombat.js";

let units = [];
let playerCode = "";
let round = 1;
let gameDate = "";
let allowedUnitTypes = null; // null = all types allowed; else the scenario's whitelist
let interactionMode = { kind: "idle" }; // idle | deploy | move | attack
let pollTimer = null;
let busy = false; // suppress poll overwrite mid-commit

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
export const getPlayerCode = () => playerCode;
// The scenario's allowed deployable troop types, or null when unrestricted.
export const getAllowedUnitTypes = () => allowedUnitTypes;
export const getInteractionMode = () => interactionMode;
export const setInteractionMode = (next) => {
  interactionMode = next && next.kind ? next : { kind: "idle" };
  emit();
};
export const clearInteractionMode = () => setInteractionMode({ kind: "idle" });

const refresh = async () => {
  if (busy) return;
  try {
    const [world, game] = await Promise.all([
      readWorldState({ force: true }),
      readGameData({ force: true }),
    ]);
    units = world.units ?? [];
    playerCode = game.country ?? "";
    round = game.round ?? 1;
    gameDate = game.gameDate || game.startDate || "";
    allowedUnitTypes = Array.isArray(world.allowedUnitTypes) && world.allowedUnitTypes.length
      ? world.allowedUnitTypes
      : null;
    emit();
  } catch (error) {
    console.error("Failed to refresh units:", error);
  }
};

export const startUnitsSync = () => {
  if (pollTimer) return () => {};
  refresh();
  pollTimer = setInterval(refresh, 5000);
  return () => {
    clearInterval(pollTimer);
    pollTimer = null;
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
        updatedAt: new Date().toISOString(),
      };
    }));
};

export const deployUnit = async ({ type, strength, name, lng, lat }) => {
  if (!playerCode) await refresh();
  // Deploy as PENDING (rendered translucent): the player states an intent, and the
  // AI confirms, relocates or rejects it on the next time-jump.
  // Built outside the commit so the queued order can reference its id.
  const unit = normalizeUnitEntry({
    type,
    strength,
    name,
    lng,
    lat,
    ownerCode: playerCode || "PLAYER",
    source: "player",
    status: "pending",
  });
  if (!unit) return units;
  const saved = await commit((list) => [...list, unit]);
  await queueOrder(
    `Deploy request: ${name || type} (${type}, strength ${strength}, owner ${playerCode || "PLAYER"}) at ` +
      `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}. Currently pending — confirm it into the order of battle, ` +
      `reposition it, or reject it as the front and logistics allow.`,
    { unitId: unit.id, remove: true },
  );
  return saved;
};

export const moveUnitTo = async (unitId, lng, lat) => {
  const unit = getUnitById(unitId);
  if (!unit) return { resolved: false };

  const distance = distanceKm(unit, { lng, lat });
  const leash = moveLeashKm(unit.type, gameDate);

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
        `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)} — about ${Math.round(distance)} km away, beyond a single ` +
        `${unit.type} move in this era (~${leash} km). Advance it realistically across turns given the era, terrain ` +
        `and transport available, or reject the order with an event explaining why it is infeasible.`,
      { unitId: unit.id, status: unit.status },
    );
    return { resolved: false, distance, leash };
  }

  await commit((list) =>
    list.map((u) =>
      u.id === unitId
        ? { ...u, lng, lat, status: "moving", updatedAt: new Date().toISOString() }
        : u,
    ),
  );
  await queueOrder(
    `Move ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) to coordinates lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}.`,
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

export const removeUnit = async (unitId) =>
  commit((list) => list.filter((u) => u.id !== unitId));
