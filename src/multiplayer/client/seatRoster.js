/*! Open Historia — who plays which country in a shared game, for the game's own screens © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host's lobby lists every seat (host/gameHost.js lobbyFor: country, name,
// status, held, you, and `host` once the host's own seat is marked). The
// game's screens outside the round bar read it too: the map stars the label of
// a country a person plays, the region card says who plays it, and the game
// menu's Players lists them all. They read it through sharedGameBridge.js, so
// none of them loads the multiplayer code; this is the pure part.
//
// A country is matched by its name as the host keys it, compared without case
// or spare spaces (as sharedGameBridge.js playedByPerson does): the seat's
// `country` is a structured field, not text read for words.

const clean = (value, max = 80) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// The key two names of one country share.
export const countryKey = (name) => clean(name, 200).toLowerCase();

const NOBODY = Object.freeze([]);

// The seats as the screens read them: each a frozen row, those without a
// country dropped, the order the host gave kept.
export const rosterOf = (seats) => {
  const rows = (Array.isArray(seats) ? seats : [])
    .filter((seat) => seat && typeof seat === "object" && clean(seat.country))
    .map((seat) => Object.freeze({
      country: clean(seat.country, 200),
      name: clean(seat.name, 40),
      status: clean(seat.status, 20),
      held: seat.held === true,
      you: seat.you === true,
      host: seat.host === true,
    }));
  return rows.length ? Object.freeze(rows) : NOBODY;
};

export const sameRoster = (a, b) => a.length === b.length && a.every((row, at) => {
  const other = b[at];
  return row.country === other.country && row.name === other.name && row.status === other.status
    && row.held === other.held && row.you === other.you && row.host === other.host;
});

// A seat a person plays: one their device holds, whoever minds it now (the AI
// while they are away), not one whose country is gone and they only watch.
export const playedByAPerson = (seat) => Boolean(seat?.held) && seat.status !== "watching";

// The countries people play, by name (sharedGameBridge.js sharedGamePeople).
export const playedCountriesOf = (roster) => [...new Set((roster ?? []).filter(playedByAPerson).map((seat) => seat.country))];

// The seat of the person who plays `country`, or null. Any of `names` may be
// the one the host keys it by (the region card knows a country by its
// canonical name and by the name it is shown under).
export const playerSeatFor = (roster, ...names) => {
  const keys = new Set(names.flat().map(countryKey).filter(Boolean));
  if (!keys.size) return null;
  return (roster ?? []).find((seat) => playedByAPerson(seat) && keys.has(countryKey(seat.country))) ?? null;
};

// What a seat's player is doing, in the round bar's Players panel's words
// (ui/SharedGameOverlay.jsx seatState), less Ready, which needs the round.
export const seatStateText = (seat) => {
  if (!seat) return "";
  if (seat.status === "human") return "";
  if (seat.status === "away") return "Away";
  if (seat.status === "watching") return "Watching";
  return seat.held ? "Away: the AI plays it" : "AI player";
};
