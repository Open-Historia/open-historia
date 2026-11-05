/*! Open Historia — the war room's writes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
//
// Everything the war room (GameUI/warRoom.jsx) changes goes through here as an
// op (runtime/fronts/warRoomOps.js): an order for troops picked out, a route
// drawn for them, what was said to the generals and what they took from it, a
// diversion, a Board operation's arrow redrawn; and a fortified line to be
// built (fronts/fortifyOps.js), an order for a fleet (naval/fleetOps.js) or an
// air strike (fronts/airStrikeOps.js).
//
// Through the write queue, on the world as it stands when the write's turn
// comes, so it cannot put back a world another writer has changed since. A
// turn that is running is working on the world it began with and will write
// over anything written under it: nothing is written until it has landed, and
// the caller is told so.
//
// Runs under bare node: the world store and the ops both do.

import { applyAirStrikeOp, cleanAirStrikeOp } from "./fronts/airStrikeOps.js";
import { applyFortifyOp, cleanFortifyOp } from "./fronts/fortifyOps.js";
import { applyWarRoomOp, cleanWarRoomOp } from "./fronts/warRoomOps.js";
import { activeWars } from "./gameFeatures.js";
import { mutateWorldState, readGameData } from "./gameState.js";
import { applyFleetOp, cleanFleetOp } from "./naval/fleetOps.js";
import { eraSettingOf } from "./warSettings.js";

export const TURN_RUNNING_REFUSAL = "A turn is being resolved: the generals take orders once it has landed.";

// Applies one op for the player. Resolves with nothing; throws with a reason a
// person can read when it was refused. `turnRunning` says whether a turn is
// being resolved on this page (the caller has the flag: AI/simulationStatus.js).
export const sendWarRoomOp = async (op, { turnRunning = () => false } = {}) => {
  const sent = cleanWarRoomOp(op);
  if (!sent) throw new Error("Nothing was asked.");
  if (turnRunning()) throw new Error(TURN_RUNNING_REFUSAL);
  const game = await readGameData();
  let refusal = "";
  await mutateWorldState((world) => {
    const result = applyWarRoomOp(world?.battlefields, sent, { player: game?.country, date: game?.gameDate || game?.startDate, transports: world?.transports, era: eraSettingOf(world) });
    if (result.error) {
      refusal = result.error;
      return null;
    }
    // (An op for a transporter changes the world's transporters, and no battlefield.)
    return { ...world, battlefields: result.battlefields, ...(result.transports ? { transports: result.transports } : null) };
  });
  if (refusal) throw new Error(refusal);
};

// The war room's fortified lines (runtime/fronts/fortifyOps.js) and fleets
// (runtime/naval/fleetOps.js) go the same way, each by an op of its own. Both
// are held to the map (runtime/warRoomChart.js: where the sea is, whose the
// ground is), which the caller reads (`readChart`, resolving with a chart or
// null).
const sendHeldToMap = async (sent, { apply, needsChart }, { turnRunning, readChart }) => {
  if (turnRunning()) throw new Error(TURN_RUNNING_REFUSAL);
  const chart = needsChart ? await Promise.resolve().then(readChart).catch(() => null) : null;
  // (The map can take a moment to read: a turn may have begun meanwhile.)
  if (turnRunning()) throw new Error(TURN_RUNNING_REFUSAL);
  const game = await readGameData();
  let refusal = "";
  await mutateWorldState((world) => {
    const result = apply(world, sent, { player: game?.country, date: game?.gameDate || game?.startDate, round: game?.round, chart });
    if (result.error) {
      refusal = result.error;
      return null;
    }
    return result.world;
  });
  if (refusal) throw new Error(refusal);
};

// A line drawn to be built, or one of the player's being built given up.
export const sendFortifyOp = async (op, { turnRunning = () => false, readChart = async () => null } = {}) => {
  const sent = cleanFortifyOp(op);
  if (!sent) throw new Error("Nothing was asked.");
  await sendHeldToMap(sent, { apply: applyFortifyOp, needsChart: sent.op === "fortify" }, { turnRunning, readChart });
};

// An order for one of the player's fleets.
export const sendFleetOp = async (op, { turnRunning = () => false, readChart = async () => null } = {}) => {
  const sent = cleanFleetOp(op);
  if (!sent) throw new Error("Nothing was asked.");
  await sendHeldToMap(sent, { apply: applyFleetOp, needsChart: ["station", "blockade", "escort"].includes(sent.op) }, { turnRunning, readChart });
};

// An air strike for one of the player's air units, or its strike called off. The map is read for a city struck:
// whose the ground is. (None in a scenario without air units: the Wars feature.)
export const sendAirStrikeOp = async (op, { turnRunning = () => false, readChart = async () => null } = {}) => {
  const sent = cleanAirStrikeOp(op);
  if (!sent) throw new Error("Nothing was asked.");
  const apply = (world, given, context) => applyAirStrikeOp(world, given, { ...context, air: activeWars().air });
  await sendHeldToMap(sent, { apply, needsChart: sent.op === "airstrike" && sent.kind === "city" }, { turnRunning, readChart });
};
