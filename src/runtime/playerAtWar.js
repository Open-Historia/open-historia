/*! Open Historia — whether the player's country is at war © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whether the country the game is played as is on a side of a war that is
// being fought, from the war ledger (world.wars). The game's screen asks it
// for the music: the war pieces play while the player is at war, wherever
// they are looking (the owner, 2026-10-13: "when in war, it doesnt play the
// war song"), and not only in the war room.
//
// Light on purpose: it is asked on every change of the world, for as long as
// a game is open.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// A polity's name is exact: only its case and spacing are forgiven, never
// another spelling of it.
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const members = (side) => (Array.isArray(side) ? side : []);

// A war in the ledger is being fought unless it says otherwise (a ceasefire,
// a peace, an end): a row with no status is an active one, as the ledger
// reads it everywhere else.
const fought = (war) => clean(war?.status || "active").toLowerCase() === "active";

export const playerAtWar = (wars, player) => {
  const name = clean(player);
  if (!name || !Array.isArray(wars)) return false;
  return wars.some((war) => war && fought(war)
    && [...members(war.sideA), ...members(war.sideB)].some((member) => same(member, name)));
};
