/*! Open Historia — unit deployment & intel controller © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Shared unit interaction state + the mutations the player owns.
//
// There are TWO unit systems here, chosen by the betaUnits setting and pinned for
// the session (see runtime/mapSettings.js isBetaUnits). Everything above the
// mode-specific mutations — the poll, the in-memory list, the pub/sub, deploy —
// is shared, and both systems read and write the same save shape, so a save can
// move between them without losing anything.
//
// CLASSIC (default, and what upstream ships): a wargame the player plays. Move
// and attack write immediately AND queue a machine-readable order so the AI
// honors or contests them on the next time-jump. Combat uses the seeded resolver
// in unitCombat.js for instant feedback; the AI reconciles fronts on the jump.
// See moveUnitTo / attackWith / attackFeature.
//
// BETA (work in progress): units are a VISUAL REPRESENTATION of what the events
// say, not a wargame. No manual movement and no manual combat — the AI owns where
// forces go and what happens when they meet, and the engine
// (runtime/unitMotion.js) advances standing orders realistically every turn. What
// the player keeps is stating intent: placing a formation, and asking for orders
// in words. See requestUnitOrders.
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
  clearStaleUnitMotion,
  normalizeUnitEntry,
} from "../../runtime/gameState.js";
import { resolveClash, distanceKm, engagementRangeKm, moveLeashKm } from "./unitCombat.js";

let units = [];
let pendingOrders = [];
let playerCode = "";
let round = 1;
let gameDate = "";
let allowedUnitTypes = null; // null = all types allowed; else the scenario's whitelist
// idle | deploy in both systems; move | attack are classic-only.
let interactionMode = { kind: "idle" };
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

export const startUnitsSync = () => {
  if (pollTimer) return () => {};
  refresh().then(repairStaleUnitMotion);
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
// deploy is removed again, a moved unit snaps back to its recorded position, and
// a long-range/approach order restores the unit's prior status.
//
// Handles both systems, and must keep doing so. The lng/lat/status branches are
// live in classic mode (moveUnitTo and the attack orders record them), and in
// beta mode they are still reachable through actions queued by the classic UI
// that are sitting in existing saves — deleting one has to undo everything it
// did, or the unit keeps marching toward a destination whose justification is
// gone. pendingOrderId likewise cancels a standing order minted by the beta
// engine.
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

// ---- classic system: manual movement and combat --------------------------
// Reachable only while betaUnits is off — the interaction modes these serve are
// set from the classic unit popup, and the classic branches of the map click
// dispatcher (Nations.jsx) are the only callers. Restored verbatim from upstream
// so the default experience is exactly the one people already know.

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

  // Within the leash the unit is placed on its destination immediately, so it has
  // ARRIVED — the same rule the beta engine applies on arrival. This used to stamp
  // "moving" on a formation already standing where it was sent, and classic has no
  // engine to ever take it back off: the unit kept a yellow moving ring and a popup
  // reading "moving" for the rest of the campaign. Saves already carrying that are
  // repaired on load by clearStaleUnitMotion. The out-of-range branch above is the
  // one that genuinely IS moving — it leaves the unit where it stands.
  await commit((list) =>
    list.map((u) =>
      u.id === unitId
        ? { ...u, lng, lat, status: "idle", updatedAt: new Date().toISOString() }
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

export const removeUnit = async (unitId) =>
  commit((list) => list.filter((u) => u.id !== unitId));

// Round and game date are read by the Forces panel and the unit popup for
// naming and order text; kept exported so nothing has to re-read game.json.
export const getRound = () => round;
export const getGameDate = () => gameDate;
