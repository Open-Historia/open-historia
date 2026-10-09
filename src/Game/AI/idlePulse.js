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
// `player` is the player's polity, or every polity people play in a shared
// game (runtime/humanPolities.js humanCountriesOf).
export const idlePulseUnitOps = (world, unitOps, player) => {
  const playerNames = new Set((Array.isArray(player) ? player : [player])
    .map((name) => toCountryName(clean(name)).toLowerCase())
    .filter(Boolean));
  const isPlayers = (ownerCode) => playerNames.has(toCountryName(clean(ownerCode)).toLowerCase());
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

// The intel event that reports a sighting in the log. Written by the model in
// the player's language, so it is marked as the AI's: an event with no source is
// read as the scenario's own text (gameState.js normalizeEventEntry), and the
// translator sent every sighting off for translation into the language it was
// already in (translator.js isAuthoredEvent).
//
// It carries the very ops it is reporting. They have already been applied to
// the world and nothing re-applies an event's impacts from the log, so this is
// not a second application — it is what lets the event camera fly to the
// sighting instead of guessing from the prose.
export const sightingEvent = (date, sighting, unitOps) => ({
  date: clean(date),
  title: clean(sighting?.title),
  description: clean(sighting?.description),
  importance: "minor",
  kind: "intel",
  playerRelated: true,
  notable: false,
  source: "ai",
  impacts: { unitOps },
});

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

// ---- A quiet world ---------------------------------------------------------
// Most pulses answer with nothing, and on a world nothing has touched since
// they are likely to again: each is still a request. So a pulse that came back
// empty makes the next one on the SAME state half as likely, and each further
// empty answer halves it again; any change — a turn, a pulse that moved
// something, a new event, a new message in an open chat — or any answer with
// something in it restores the full chance. The answer is sampled, so a repeat
// on the same prompt can still produce a note: this backs off, it never stops.

// The most halvings: at worst a pulse keeps a thirty-second of its chance.
export const IDLE_PULSE_MAX_BACKOFF = 5;

// What the pulse sees that could change its answer.
export const idlePulseFingerprint = ({ round = 0, tick = 0, eventCount = 0, chats = [] } = {}) => [
  Number(round) || 0,
  Number(tick) || 0,
  Number(eventCount) || 0,
  ...(Array.isArray(chats) ? chats : []).map((chat) => {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    return `${clean(chat?.id)}:${clean(messages[messages.length - 1]?.id) || messages.length}`;
  }).sort(),
].join("|");

export const createIdlePulseBackoff = ({ maxHalvings = IDLE_PULSE_MAX_BACKOFF } = {}) => {
  let fingerprint = "";
  let empties = 0;
  return {
    // The share of a roll that passed which goes ahead on this state.
    share: (current) => (current && current === fingerprint ? 0.5 ** empties : 1),
    // What the pulse on this state answered.
    note: (current, empty) => {
      if (!empty || !current) {
        fingerprint = "";
        empties = 0;
        return;
      }
      empties = current === fingerprint ? Math.min(maxHalvings, empties + 1) : 1;
      fingerprint = current;
    },
  };
};
