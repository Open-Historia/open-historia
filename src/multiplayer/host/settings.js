/*! Open Historia — a multiplayer game's settings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the host decides for the game, with the defaults the user asked for:
//   - seats: "up to 64 maximum, default limit is 8, controlled by a slider by
//     the host". Above 8 the turn needs a measured redesign first (the plan's
//     Phase 5b), so the slider runs to 64 but can only be set to 8 for now;
//   - the round: its length, the share of ready players that starts the
//     countdown (2/3 by default), and the countdown's length;
//   - cheats "not allowed by default" (off, the host alone, or put to a vote);
//   - who pays: the host, for now; the rotating payer comes with Phase 2.
// The schema is shared with the players' screens, which show these settings,
// and is closed like every other message.

import { bool, int, literal, num, obj, str, validate } from "../protocol/validate.js";

export const MAX_SEATS = 64;
// What the seat slider can be set to today; the rest of it is "coming later".
export const SEATS_AVAILABLE_NOW = 8;

export const DEFAULT_SETTINGS = Object.freeze({
  v: 1,
  name: "Open Historia game",
  seats: 8,
  roundMinutes: 20,
  readyThreshold: 2 / 3,
  countdownSeconds: 60,
  minPlanningSeconds: 0,
  afkSeconds: 0,
  daysPerRound: 30,
  leaverGraceMinutes: 5,
  allowMidGameJoin: true,
  cheats: "off",
  payment: "host",
});

export const SETTINGS_SCHEMA = obj({
  v: literal(1),
  name: str(60, { min: 1, pattern: /^\P{Cc}+$/u }),
  seats: int(2, MAX_SEATS),
  roundMinutes: int(1, 7 * 24 * 60),
  readyThreshold: num(0.5, 1),
  countdownSeconds: int(0, 3600),
  minPlanningSeconds: int(0, 3600),
  afkSeconds: int(0, 24 * 3600),
  daysPerRound: int(1, 3650),
  leaverGraceMinutes: int(0, 24 * 60),
  allowMidGameJoin: bool(),
  cheats: str(8, { enum: ["off", "host", "vote"] }),
  payment: str(8, { enum: ["host"] }),
});

// Settings the host typed, made whole and safe: unknown keys are dropped,
// anything out of range is refused with the reason, and the seats are held to
// what can be played today.
export const normalizeSettings = (input = {}) => {
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) merged[key] = input[key];
  }
  if (typeof merged.name === "string") merged.name = merged.name.trim() || DEFAULT_SETTINGS.name;
  const checked = validate(SETTINGS_SCHEMA, merged);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (checked.value.seats > SEATS_AVAILABLE_NOW) {
    return { ok: false, error: `More than ${SEATS_AVAILABLE_NOW} players is coming later.` };
  }
  return { ok: true, settings: checked.value };
};

// The round machine's view of them (host/round.js).
export const roundSettingsOf = (settings) => ({
  roundMinutes: settings.roundMinutes,
  readyThreshold: settings.readyThreshold,
  countdownSeconds: settings.countdownSeconds,
  minPlanningSeconds: settings.minPlanningSeconds,
  afkSeconds: settings.afkSeconds,
});
