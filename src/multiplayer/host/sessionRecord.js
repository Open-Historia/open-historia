/*! Open Historia — a shared game's session, kept with the game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Who plays what, where the round is and what the host decided are part of the
// game (the owner, 2026-11-15: a shared game is a lasting thing, "seats saved
// with the game and bound to each player's device, resumable another day").
// Before, they lived only in the engine window's memory: Stop, a crash, or
// "let's go on tomorrow" gave an empty lobby at round 1, and the first person
// to take a country got its previous player's threads, orders and stolen
// papers. Now the host writes this record into the campaign
// (storage/shared.json) whenever it changes, and reads it back when the game
// is shared again: every seat is its player's device's until the host
// releases it.
//
// It is read from disk, so it is checked like a message from another machine
// (protocol/validate.js): closed, bounded, and what does not fit is dropped,
// never trusted. Pure.

import { NAME, bool, int, list, literal, obj, str, validate } from "../protocol/validate.js";
import { SETTINGS_SCHEMA, normalizeSettings } from "./settings.js";

export const SESSION_RECORD_VERSION = 1;

const COUNTRY = NAME(200);
const DEVICE = str(64, { min: 1 });
const SEAT = obj({
  country: COUNTRY,
  device: str(64, { nullable: true }),
  name: str(40),
  status: str(8, { enum: ["human", "away", "ai", "watching"] }),
});
const SCHEMA = obj({
  v: literal(SESSION_RECORD_VERSION),
  // The campaign this session is of: a record found in another one is not used.
  campaign: str(160, { min: 1 }),
  started: bool(),
  // The round being planned or read when the record was written; a round that
  // was being resolved had not landed, and is planned again.
  round: int(0, 1_000_000),
  hostDevice: DEVICE,
  seats: list(SEAT, 128),
  // Players whose country is gone and who stay to watch (owner's decision 11).
  watching: list(obj({ device: DEVICE, name: str(40), was: COUNTRY }), 128),
  // Players asking the host to change country (owner's decision 12).
  changes: list(obj({ device: DEVICE, name: str(40), from: COUNTRY, to: COUNTRY }), 64),
  // Lines whose answer their writer's own device is writing (settings.replies "own").
  ownLines: list(obj({ line: str(160, { min: 1 }), thread: str(120, { min: 1 }), seat: COUNTRY }), 400),
  // Devices the host has banned from this game.
  banned: list(DEVICE, 256),
  // The game's settings as they stood (host/settings.js), changes made during
  // the game included: a game taken up again starts from them, so a host
  // sharing it another day is shown its rules, not the defaults.
  settings: SETTINGS_SCHEMA,
}, ["watching", "changes", "ownLines", "banned", "settings"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// The record of a session as it stands.
export const sessionRecordOf = ({ campaign, started, round, hostDevice, seats = [], watching = [], changes = [], ownLines = [], banned = [], settings = null }) => ({
  v: SESSION_RECORD_VERSION,
  campaign: clean(campaign).slice(0, 160),
  started: Boolean(started),
  round: Math.max(0, Math.min(1_000_000, Math.trunc(Number(round) || 0))),
  hostDevice: clean(hostDevice).slice(0, 64),
  seats: seats.slice(0, 128).map((seat) => ({
    country: clean(seat.country).slice(0, 200),
    device: seat.device ? clean(seat.device).slice(0, 64) : null,
    name: clean(seat.name).slice(0, 40),
    status: ["human", "away", "ai", "watching"].includes(seat.status) ? seat.status : "ai",
  })).filter((seat) => seat.country),
  watching: watching.slice(0, 128).map((entry) => ({ device: clean(entry.device).slice(0, 64), name: clean(entry.name).slice(0, 40), was: clean(entry.was).slice(0, 200) }))
    .filter((entry) => entry.device && entry.was),
  changes: changes.slice(0, 64).map((entry) => ({ device: clean(entry.device).slice(0, 64), name: clean(entry.name).slice(0, 40), from: clean(entry.from).slice(0, 200), to: clean(entry.to).slice(0, 200) }))
    .filter((entry) => entry.device && entry.from && entry.to),
  ownLines: ownLines.slice(-400).map((entry) => ({ line: clean(entry.line).slice(0, 160), thread: clean(entry.thread).slice(0, 120), seat: clean(entry.seat).slice(0, 200) }))
    .filter((entry) => entry.line && entry.thread && entry.seat),
  banned: [...new Set(banned.map((device) => clean(device).slice(0, 64)).filter(Boolean))].slice(0, 256),
  ...(settings && normalizeSettings(settings).ok ? { settings: normalizeSettings(settings).settings } : {}),
});

// The session a record holds, for `campaign` and the host on `hostDevice`; null
// when there is none to take up (no record, another campaign's, another
// host's, or one that does not read).
export const sessionFromRecord = (record, { campaign, hostDevice }) => {
  if (!record || typeof record !== "object" || !Object.keys(record).length) return null;
  const checked = validate(SCHEMA, record);
  if (!checked.ok) return null;
  const value = checked.value;
  if (clean(value.campaign) !== clean(campaign) || clean(value.hostDevice) !== clean(hostDevice)) return null;
  return {
    started: value.started,
    round: value.round,
    seats: value.seats,
    watching: value.watching ?? [],
    changes: value.changes ?? [],
    ownLines: value.ownLines ?? [],
    banned: value.banned ?? [],
    settings: value.settings ?? null,
  };
};

// The settings a game kept the last time it was shared, for the host's Host a
// lobby to start from: null when it kept none, or the record is another game's.
export const keptSettingsOf = (record, { campaign } = {}) => {
  if (!record || typeof record !== "object" || clean(record.campaign) !== clean(campaign)) return null;
  const checked = normalizeSettings(record.settings ?? null);
  return record.settings && checked.ok ? checked.settings : null;
};
