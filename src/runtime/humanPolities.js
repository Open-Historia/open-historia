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
let hostCountry = "";

// The host's engine window, while it runs a shared game (multiplayer/host/engineMain.js),
// with the host's own country: a thread that names no owner is the host's.
export const setHostingSharedGame = (value, { host = "" } = {}) => {
  hosting = Boolean(value);
  hostCountry = hosting ? clean(host) : "";
};
export const hostingSharedGame = () => hosting;
export const sharedGameHostCountry = () => (hosting ? hostCountry : "");

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

// Two things the institution code once held in one "playerCountry": who acts
// now (a seat, with its player's authority) and the people, whom no model
// ever votes, decides, answers, accepts or withdraws for, and whom a ballot
// waits for. A guest's ballot was cast by the AI because only the acting seat
// was spared. This is the people, the one acting now first: a seat acting for
// itself is a person, whatever the list holds yet. In single player it is the
// player alone, as it always was.
export const humanCountriesWith = (game, actor = "") => {
  const names = humanCountriesOf(game);
  const name = clean(actor);
  if (!name) return names;
  return [name, ...names.filter((other) => other.toLocaleLowerCase() !== name.toLocaleLowerCase())];
};

// A thread made for a person is theirs. While this engine hosts a shared game
// a thread that names no owner is the host's (multiplayer/host/projection.js
// threadOwner), so one made for another person names them (chat.player): an
// AI's invitation of a guest, made in the host's skip, was the host's thread
// and reached the guest as nobody's. In single player, and for the host,
// nothing is added; a thread that names its owner keeps it.
export const ownedByPerson = (chat, person = "") => {
  const name = clean(person);
  if (!chat || !hosting || !name || clean(chat.player)) return chat;
  if (name.toLocaleLowerCase() === hostCountry.toLocaleLowerCase()) return chat;
  return { ...chat, player: name };
};

// Who gave an order: its ownerCode, or the player when it names none.
export const orderOwner = (action, game) => clean(action?.ownerCode) || clean(game?.country);
