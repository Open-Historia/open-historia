/*! Open Historia — unit deployment & intel controller © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Shared unit interaction state + the two mutations the player still owns.
//
// Units are a VISUAL REPRESENTATION of what the events say, not a wargame the
// player plays. There is no manual movement and no manual combat: the AI owns
// where forces go and what happens when they meet, and the engine
// (runtime/unitMotion.js) advances standing orders realistically every turn.
// What the player keeps is stating intent — placing a formation, and asking for
// orders in words — both of which queue an action the AI adjudicates on the next
// time jump, exactly like every other action they plan.
//
// Holds the current unit list in memory (refreshed from world.json every 5s so
// AI-spawned/moved units appear) and applies the player's own mutations
// immediately for snappy feedback, persisting them to world.json. A tiny pub/sub
// lets the map layer, the selection popup and the Forces panel re-render.

import {
  readWorldState,
  writeWorldState,
  readGameData,
  readActionsState,
  writeActionsState,
  normalizeUnitEntry,
} from "../../runtime/gameState.js";

let units = [];
let pendingOrders = [];
let playerCode = "";
let round = 1;
let gameDate = "";
let allowedUnitTypes = null; // null = all types allowed; else the scenario's whitelist
let interactionMode = { kind: "idle" }; // idle | deploy
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

const refresh = async () => {
  if (busy) return;
  try {
    const [world, game] = await Promise.all([
      readWorldState({ force: true }),
      readGameData({ force: true }),
    ]);
    units = world.units ?? [];
    pendingOrders = world.pendingUnitOrders ?? [];
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

// Read-modify-write world.pendingUnitOrders. Nothing the player does creates a
// standing order any more — the engine mints them — but revertUnitOrder still
// has to be able to CANCEL one, because actions queued before manual movement
// was removed are still sitting in actions.json with a pendingOrderId on them.
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

// unitRevert records how to undo the order if the player deletes the queued
// action before the next jump (#368): without it, a manual deploy stayed on the
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

// Undo a queued unit order whose action the player deleted (#368): a pending
// deploy is removed again.
//
// The lng/lat/status/pendingOrderId branches below are only reachable for
// actions queued by the OLD manual move/attack UI, which no longer exists.
// They are kept deliberately: those actions are still sitting in existing saves,
// and deleting one has to undo everything it did or the unit keeps marching
// toward a destination whose justification is gone.
export const revertUnitOrder = async (revert) => {
  const unitId = String(revert?.unitId ?? "").trim();
  if (!unitId) return;
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
  if (!playerCode) await refresh();
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

export const removeUnit = async (unitId) =>
  commit((list) => list.filter((u) => u.id !== unitId));

// Round and game date are read by the Forces panel and the unit popup for
// naming and order text; kept exported so nothing has to re-read game.json.
export const getRound = () => round;
export const getGameDate = () => gameDate;
