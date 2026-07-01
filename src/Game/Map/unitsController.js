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
import { resolveClash } from "./unitCombat.js";

let units = [];
let playerCode = "";
let round = 1;
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

export const getUnits = () => units;
export const getUnitById = (id) => units.find((unit) => unit.id === id) ?? null;
export const getPlayerCode = () => playerCode;
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

const queueOrder = async (text) => {
  try {
    const actions = await readActionsState({ force: true });
    actions.push({
      kind: "action",
      source: "order",
      status: "planned",
      text,
      title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
    });
    await writeActionsState(actions);
  } catch (error) {
    console.error("Failed to queue order:", error);
  }
};

export const deployUnit = async ({ type, strength, name, lng, lat }) => {
  if (!playerCode) await refresh();
  return commit((list) => {
    const unit = normalizeUnitEntry({
      type,
      strength,
      name,
      lng,
      lat,
      ownerCode: playerCode || "PLAYER",
      source: "player",
      status: "idle",
    });
    return unit ? [...list, unit] : list;
  });
};

export const moveUnitTo = async (unitId, lng, lat) => {
  const unit = getUnitById(unitId);
  await commit((list) =>
    list.map((u) =>
      u.id === unitId
        ? { ...u, lng, lat, status: "moving", updatedAt: new Date().toISOString() }
        : u,
    ),
  );
  if (unit) {
    await queueOrder(
      `Move ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) to coordinates lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}.`,
    );
  }
};

export const attackWith = async (attackerId, targetId) => {
  const attacker = getUnitById(attackerId);
  const defender = getUnitById(targetId);
  if (!attacker || !defender || attackerId === targetId) return;

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
};

export const removeUnit = async (unitId) =>
  commit((list) => list.filter((u) => u.id !== unitId));
