/*! Open Historia — whose AI makes the readings a shared game makes by itself © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// After every time skip, and when a scenario's fronts are built, the game reads
// figures by itself: the four the war reads of each country in conflict with a
// player and the military figures of every other country at war (gameplay.js
// requestConflictSheets), and the first sheet of a country an agent was sent
// into (ensureCountryAssessed). In single player they are background requests
// on the player's own AI. In the engine of a shared game they were made on the
// host's AI whatever its settings said: with "each player's own AI" answering
// (settings.replies "own") the lobby says the players' AI writes the figures,
// and the host's key paid for these all the same, after every round (the
// review of 2026-11-18, cost 6 and wars 9).
//
// They follow the setting, as a sheet a player opens does (the owner's
// decision 3): with the host's AI answering, they are the host's, as in single
// player, under its device's daily cap for background work; with each
// player's own, the host's AI makes none. What the war needs of a country
// still unread is then the round's own: the time skip writes the war's figures
// in its one answer (warFiguresPrompt.js), and each player's device reads the
// countries its player opens. Nothing is added to a round.
//
// The engine that hosts a shared game sets it from the lobby's settings as they
// stand, from before the game's start is finished (its fronts may be built
// then) until sharing stops (host/engineMain.js); anywhere else, and on every
// page, it reads as single player.

let hostReads = true;

export const setHostReadsFigures = (value) => {
  hostReads = value !== false;
};

// Whether the game's own readings are made on this device's AI.
export const hostReadsFigures = () => hostReads;

// And where they are written. Each reading asks the AI out of turn and then
// writes what it was told; in the engine hosting a shared game that write was
// made beside the host's one queue (rule 2: every change to the world is one
// entry of it), between a player's request and the next (FOLLOWUPS A6). While
// the engine shares a game it sets `enter(label)`, which resolves when an entry
// of its queue begins with the function that ends it (host/engineMain.js): the
// write half of every reading runs inside one (gameplay.js beginStatsWrite,
// inReadingOrder). Anywhere else, and before and after sharing, there is none
// and a reading writes at once, as single player always has.
let enterOrder = null;

export const setReadingsOrder = (enter) => {
  enterOrder = typeof enter === "function" ? enter : null;
};

// The entry a reading's write is made in (a promise of the function that ends
// it), or null when there is no host's order to make it in.
export const readingEntry = (label) => (enterOrder ? enterOrder(String(label || "reading")) : null);
