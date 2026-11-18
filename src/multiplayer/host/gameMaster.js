/*! Open Historia — the Game Master in a shared game, and what it changed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The owner's decision 8: Game Master tools "behind a visible notice". Before,
// nobody had them in a shared game, the host included, and the lobby's
// `cheats` setting was read by nothing.
//
//   - Whether the Game Master may be used at all is a setting of the game
//     (host/settings.js `cheats`), shown in every player's lobby; off unless the
//     host says ("host").
//   - Only the host uses it (the host's control "gm", host/gameHost.js
//     control.gameMaster), with the game's own console (gameplay.js
//     previewGameMasterCommand, then applyGameMasterPreview at once), in the
//     host's engine window, as one entry of the host's queue: nothing else is
//     applied while it runs, and it is refused while a round is resolved.
//   - What it changed is told to every player as it lands, and kept in a log
//     every lobby carries and the session keeps (newest last), so a player who
//     was away, or comes back another day, can read it.
//
// The rest of the Cheats panel writes the game straight from the page it is
// on, which in a shared game is no writer: it stays closed there.
//
// Pure.

import { GAME_MASTER_LOG_MAX, GAME_MASTER_SUMMARY_MAX } from "../game/messages.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const clip = (text, max) => {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};
// The longest command the host may give (the "gm" control's `command`).
export const GAME_MASTER_COMMAND_MAX = 2000;

const counted = (ids, one, many) => {
  const total = new Set(list(ids).map(clean).filter(Boolean)).size;
  if (!total) return "";
  return total === 1 ? `1 ${one}` : `${total} ${many}`;
};

// One line of the log, from what the console applied (applyGameMasterPreview's
// result): its own summary, and what it touched, counted.
export const gameMasterEntryOf = (made, { round = 0, date = "" } = {}) => {
  const figures = [...new Set(list(made?.statCountries).map(clean).filter(Boolean))];
  const parts = [
    counted(made?.eventIds, "event written", "events written"),
    counted(made?.warIds, "war changed", "wars changed"),
    counted(made?.relationIds, "relation changed", "relations changed"),
    counted(made?.agreementIds, "agreement changed", "agreements changed"),
    figures.length ? `figures set for ${figures.slice(0, 4).join(", ")}${figures.length > 4 ? " and others" : ""}` : "",
  ].filter(Boolean);
  const said = clean(made?.summary);
  const summary = [said, parts.length ? `(${parts.join("; ")})` : ""].filter(Boolean).join(" ") || "It changed the world.";
  return {
    round: Math.max(0, Math.min(1_000_000, Math.trunc(Number(round) || 0))),
    date: clean(date).slice(0, 40),
    summary: clip(summary, GAME_MASTER_SUMMARY_MAX),
  };
};

// What every player is told as it lands.
export const gameMasterNotice = (entry) => clip(`The host used the Game Master: ${clean(entry?.summary)}`, 500);

// The log with one more line, the oldest let go past its length.
export const withGameMasterEntry = (log, entry) => [...keptGameMasterLog(log), entry].slice(-GAME_MASTER_LOG_MAX);

// A log as the session kept it, every line checked: what does not read is left out.
export const keptGameMasterLog = (value) => list(value)
  .map((entry) => ({
    round: Math.max(0, Math.min(1_000_000, Math.trunc(Number(entry?.round) || 0))),
    date: clean(entry?.date).slice(0, 40),
    summary: clip(entry?.summary, GAME_MASTER_SUMMARY_MAX),
  }))
  .filter((entry) => entry.summary)
  .slice(-GAME_MASTER_LOG_MAX);
