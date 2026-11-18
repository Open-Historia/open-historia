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

import { GAME_MASTER_FIGURES_NAMED, GAME_MASTER_LOG_MAX, GAME_MASTER_SUMMARY_MAX } from "../game/messages.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const clip = (text, max) => {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};
// The longest command the host may give (the "gm" control's `command`).
export const GAME_MASTER_COMMAND_MAX = 2000;
const COUNT_MOST = 100_000;
const NAME_MOST = 200;

const distinct = (ids) => new Set(list(ids).map(clean).filter(Boolean)).size;
const count = (value) => Math.max(0, Math.min(COUNT_MOST, Math.trunc(Number(value) || 0)));

// What it touched, as fields (game/messages.js GAME_MASTER_ENTRY `changed`),
// or null for nothing. They were English pieces glued onto the AI's summary
// here ("(2 wars changed; figures set for A, B and others)"), kept so in the
// session and sent so to every player: no language could order them, and they
// stayed English for everyone for the rest of the game. Each screen now says
// them in whole sentences (gameMasterChangeLines).
const changedOf = (made) => {
  const figures = [...new Set(list(made?.statCountries).map(clean).filter((name) => name && name.length <= NAME_MOST))];
  const changed = {
    events: distinct(made?.eventIds),
    wars: distinct(made?.warIds),
    relations: distinct(made?.relationIds),
    agreements: distinct(made?.agreementIds),
    figures: figures.slice(0, GAME_MASTER_FIGURES_NAMED),
    moreFigures: Math.max(0, figures.length - GAME_MASTER_FIGURES_NAMED),
  };
  return changed.events || changed.wars || changed.relations || changed.agreements || changed.figures.length ? changed : null;
};

// One line of the log, from what the console applied (applyGameMasterPreview's
// result): its own summary, and what it touched, counted.
export const gameMasterEntryOf = (made, { round = 0, date = "" } = {}) => {
  const changed = changedOf(made);
  return {
    round: Math.max(0, Math.min(1_000_000, Math.trunc(Number(round) || 0))),
    date: clean(date).slice(0, 40),
    summary: clip(clean(made?.summary) || "It changed the world.", GAME_MASTER_SUMMARY_MAX),
    ...(changed ? { changed } : {}),
  };
};

// What it touched, in whole sentences, each its own: a screen shows them
// beside the summary, and each is translated whole, with its count in it.
export const gameMasterChangeLines = (entry) => {
  const changed = entry?.changed;
  if (!changed || typeof changed !== "object") return [];
  const events = count(changed.events);
  const wars = count(changed.wars);
  const relations = count(changed.relations);
  const agreements = count(changed.agreements);
  const figures = list(changed.figures).map(clean).filter(Boolean).join(", ");
  const more = count(changed.moreFigures);
  return [
    events ? (events === 1 ? "It wrote 1 event." : `It wrote ${events} events.`) : "",
    wars ? (wars === 1 ? "It changed 1 war." : `It changed ${wars} wars.`) : "",
    relations ? (relations === 1 ? "It changed 1 relation between countries." : `It changed ${relations} relations between countries.`) : "",
    agreements ? (agreements === 1 ? "It changed 1 agreement." : `It changed ${agreements} agreements.`) : "",
    !figures ? ""
      : !more ? `It set the figures of ${figures}.`
        : more === 1 ? `It set the figures of ${figures} and 1 other country.`
          : `It set the figures of ${figures} and ${more} other countries.`,
  ].filter(Boolean);
};

// What every player is told as it lands: its own words; what it touched is
// listed under Players (gameMasterChangeLines).
export const gameMasterNotice = (entry) => clip(`The host used the Game Master: ${clean(entry?.summary)}`, 500);

// The log with one more line, the oldest let go past its length.
export const withGameMasterEntry = (log, entry) => [...keptGameMasterLog(log), entry].slice(-GAME_MASTER_LOG_MAX);

// What a kept entry says it touched, checked as an entry is made (null for nothing).
const keptChanged = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const figures = list(value.figures).map(clean).filter((name) => name && name.length <= NAME_MOST).slice(0, GAME_MASTER_FIGURES_NAMED);
  const changed = {
    events: count(value.events), wars: count(value.wars), relations: count(value.relations), agreements: count(value.agreements),
    figures, moreFigures: figures.length ? count(value.moreFigures) : 0,
  };
  return changed.events || changed.wars || changed.relations || changed.agreements || changed.figures.length ? changed : null;
};

// A log as the session kept it, every line checked: what does not read is left out.
// (A line kept before the counts were fields has them in its summary, as it was said.)
export const keptGameMasterLog = (value) => list(value)
  .map((entry) => {
    const changed = keptChanged(entry?.changed);
    return {
      round: Math.max(0, Math.min(1_000_000, Math.trunc(Number(entry?.round) || 0))),
      date: clean(entry?.date).slice(0, 40),
      summary: clip(entry?.summary, GAME_MASTER_SUMMARY_MAX),
      ...(changed ? { changed } : {}),
    };
  })
  .filter((entry) => entry.summary)
  .slice(-GAME_MASTER_LOG_MAX);
