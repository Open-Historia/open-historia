/*! Open Historia — the polities people play © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game has one human polity: the player's, game.country. The engine's
// rules take it as a list, the one name in it.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const humanCountriesOf = (game) => {
  const name = clean(game?.country);
  return name ? [name] : [];
};
