/*! Open Historia — the polities people play © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Single player has one human polity: the player's, game.country. A shared game
// has one per seat a person holds, and the host lists them all in
// game.humanCountries; a seat the AI has taken over is not in the list.
// game.country stays first: it is the host's own seat, the one every
// single-player path of the engine already speaks to.
//
// The list counts only in the engine that is hosting the game (the host's
// engine window says so with setHostingSharedGame). The host clears it when the
// game stops being shared, but a save can still carry one: the app was closed
// mid-game, or the save was exported from a host. Opened anywhere else it is
// single player, and the AI plays every country but the player's as it always
// has.
//
// An order carries its owner in ownerCode (the name units and projects use for
// the polity they belong to). Single player's orders have none: they are the
// player's.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

let hosting = false;

// The host's engine window, while it runs a shared game (multiplayer/host/engineMain.js).
export const setHostingSharedGame = (value) => {
  hosting = Boolean(value);
};

export const humanCountriesOf = (game) => {
  const names = [];
  const seen = new Set();
  const extra = hosting && Array.isArray(game?.humanCountries) ? game.humanCountries : [];
  for (const value of [game?.country, ...extra]) {
    const name = clean(value);
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
};

export const isSharedGame = (game) => humanCountriesOf(game).length > 1;

// Who gave an order: its ownerCode, or the player when it names none.
export const orderOwner = (action, game) => clean(action?.ownerCode) || clean(game?.country);
