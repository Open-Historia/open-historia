/*! Open Historia — the war room: which battlefields are the player's, and the words for what is on them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the war room's button and its panel both need to know, kept light: the
// button is on screen for the whole of a game and must not load the panel to
// find out whether there is a war.

import { decodeTroops } from "../../runtime/fronts/codec.js";
import { battlefieldSideOf, isOpenBattlefield } from "../../runtime/fronts/record.js";

const NONE = Object.freeze([]);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// The battlefields the player's troops are on, in the world's own order:
// [{ name, side, status }]. A battlefield counts while a war is being fought
// on it or is frozen there by a ceasefire, and so does a border the player has
// built up forces on in peace, or its forces at home, while any of them are
// there ("the war room should be there if you have troops deployed even if
// they arent in active conflict": the owner, 2026-11-02). One that has closed is over.
export const playerFronts = (battlefields, player, wars = null) => {
  const name = clean(player);
  if (!name || !Array.isArray(battlefields)) return NONE;
  const ended = new Set((Array.isArray(wars) ? wars : []).filter((war) => clean(war?.status).toLowerCase() === "ended").map((war) => clean(war?.id)));
  const found = [];
  for (const row of battlefields) {
    const standing = row?.status === "standing";
    if (!row || !(isOpenBattlefield(row) || standing) || !Array.isArray(row.sides)) continue;
    if (clean(row.warId) && ended.has(clean(row.warId))) continue;
    const sides = row.sides.map((members) => (Array.isArray(members) ? members.map(clean) : []));
    const side = battlefieldSideOf({ sides }, name);
    if (side !== 0 && side !== 1) continue;
    if (standing && !builtUp(row, side)) continue;
    found.push({ name: clean(row.name), side, status: row.status });
  }
  return found.length > 0 ? found : NONE;
};

// Whether a side has troops deployed on a record built up in peace (a border, or a country's forces at home:
// runtime/fronts/home.js): any troop of its that is alive. Those still mustering are not deployed yet ("war room
// should not be visible if there are no troops deployed and not in conflict": the owner, 2026-11-02).
const builtUp = (row, side) => typeof row.troops?.[side] === "string" && row.troops[side].length > 0
  && decodeTroops(row.troops[side]).some((troop) => troop.strength > 0);

// The same as one line of text, for a selector that must hand back a value
// that is equal while nothing has changed: a line each, "side:status:name".
export const playerFrontsKey = (battlefields, player, wars = null) => playerFronts(battlefields, player, wars).map((front) => `${front.side}:${front.status}:${front.name}`).join("\n");
// Whether any of them, as that key gives them, is a war's rather than a border built up in peace.
export const fightingIn = (key) => String(key ?? "").split("\n").some((line) => line && !line.includes(":standing:"));

// ---- words ---------------------------------------------------------------------------

// A place as a person reads it: "city: Kharkiv" is Kharkiv.
export const placeName = (value) => clean(value).replace(/^(city|region)\s*:\s*/i, "");

// (The labels and sentences themselves are in warRoom.jsx, as JSX, where the
// interface's translator finds them.)
export const ORDER_KEYS = Object.freeze(["advance", "blitz", "spearhead", "flank", "encircle", "hold", "dig in", "fall back", "withdraw"]);
