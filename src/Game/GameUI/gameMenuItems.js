/*! Open Historia — what the game's corner button offers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game menu button in the top-left corner opens the game menu (Settings,
// the game's tools) at once in single player, as it always has. In a shared
// game it drops down a short menu instead: the game menu as before, and
// Players, which drops down who plays what (the owner asked for "a player list
// menu that drops down" under that button). GameMenuDropdown.jsx draws it.
//
// Pure, so the tests read it: the seats are client/seatRoster.js rows.

import { seatStateText } from "../../multiplayer/client/seatRoster.js";

// The menu's items (their words are GameMenuDropdown.jsx's), or none: none means the button opens the game menu itself.
export const gameMenuItems = ({ seats = [] } = {}) => (
  Array.isArray(seats) && seats.length
    ? [
      { id: "menu" },
      { id: "players" },
    ]
    : []
);

// Who plays what, as the round bar's Players panel lists it: every seat in the
// host's order, the player's own marked "(you)", the host's seat marked, and
// what an absent player is doing ("Away", the AI minding it). The host's seat
// is known by the seat's own `host` mark, or, on the host's own page, by being
// this page's seat.
export const playerListRows = (seats = [], { role = "" } = {}) => (Array.isArray(seats) ? seats : []).map((seat) => ({
  key: `${seat.status}:${seat.country}`,
  country: seat.country,
  name: seat.name,
  you: Boolean(seat.you),
  host: Boolean(seat.host) || (role === "host" && Boolean(seat.you)),
  state: seatStateText(seat),
}));
