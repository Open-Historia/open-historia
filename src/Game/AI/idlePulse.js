/*! Open Historia — what the between-rounds pulse may do to the world's forces © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The idle pulse (gameplay.js maybeSendIdleDiplomacy) may move a little of the
// world's forces between rounds. Its unit ops go through the same applier as a
// turn's (applyEventImpactsToWorld), riding on an event of their own that is
// never written to the log. Import-light, so node tests can drive it.
import { toCountryName } from "../../runtime/ownerNames.js";

export const IDLE_PULSE_EVENT_ID = "idle-pulse";

// The event the ops ride on. It must have a title: the applier normalizes its
// events, and one with neither a title nor a description is dropped with
// everything it carries. The pulse's event had neither, so no pulse ever moved
// a unit, although each one spent a request asking what should move.
export const idlePulseEvent = (date, unitOps) => ({
  id: IDLE_PULSE_EVENT_ID,
  date,
  title: "Idle pulse",
  description: "",
  impacts: { unitOps },
});

const clean = (value) => String(value ?? "").trim();

// What the pulse may do. Its prompt ([World Pulse], gameplay.js) asks for at
// most two ops, never on a unit the player owns and never moving a garrison,
// but a model can ignore a prompt. The world acts on other powers' forces; the
// player's own are theirs alone, so an op on one (or a spawn made for them) is
// dropped here. So is an op on a unit that is not there, and a garrison "move"
// the applier would refuse, so the sighting never reports what did not happen.
// The player's units are the ones enforceUnitVolume (gameState.js) exempts.
export const idlePulseUnitOps = (world, unitOps, player) => {
  const playerName = toCountryName(clean(player)).toLowerCase();
  const isPlayers = (ownerCode) => Boolean(playerName) && toCountryName(clean(ownerCode)).toLowerCase() === playerName;
  const units = new Map((Array.isArray(world?.units) ? world.units : []).map((unit) => [clean(unit?.id), unit]));
  return (Array.isArray(unitOps) ? unitOps : [])
    .filter((op) => {
      if (!op || typeof op !== "object") return false;
      if (op.op === "spawn") return !isPlayers(op.unit?.ownerCode);
      const unit = units.get(clean(op.unitId));
      if (!unit || unit.source === "player" || isPlayers(unit.ownerCode)) return false;
      return !(op.op === "move" && unit.type === "garrison");
    })
    .slice(0, 2);
};

// A unit the pulse touched keeps the event it was detected with. The applier
// stamps the event that last moved a unit onto it, and the pulse's event is not
// in the log: pointing at it would take the "Detected" row off the unit's card
// (Selection/Units.jsx). A unit the pulse raised has no such event.
export const keepDetectedEvents = (before, after) => {
  const detected = new Map((Array.isArray(before?.units) ? before.units : []).map((unit) => [unit?.id, unit?.eventId]));
  return {
    ...after,
    units: (Array.isArray(after?.units) ? after.units : []).map((unit) => (unit?.eventId === IDLE_PULSE_EVENT_ID
      ? { ...unit, eventId: detected.get(unit.id) || "" }
      : unit)),
  };
};
