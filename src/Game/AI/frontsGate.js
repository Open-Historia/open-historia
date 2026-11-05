/*! Open Historia — whether this game fights its land wars on battlefields © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Battlefields and fronts (runtime/fronts/) are a gameplay feature a scenario
// can switch off (server/gameFeatures.js, key "fronts"). Off, nothing of them
// runs: the skip's contract has no frontOrders, its prompt no [Fronts] block,
// no battlefield opens, and land war is the formations and control operations
// it was before.
//
// A feature a build does not list reads as ON everywhere else
// (isFeatureEnabled answers true for a key it has never heard of), which is
// right for a feature that was removed and wrong for one a build does not
// have. So this asks first whether the build lists it at all: in a build
// whose FEATURE_DEFINITIONS has no "fronts", fronts are off.

import { FRONT_PACE_SHARE } from "../../runtime/fronts/constants.js";
import { FEATURE_KEYS, activeWars, getActiveFeatures } from "../../runtime/gameFeatures.js";

export const FRONTS_FEATURE = "fronts";

// The Wars feature (key "fronts") has a switch for each part: battlefields,
// air units and navies (server/gameFeatures.js warsOf).
export const frontsOn = () => FEATURE_KEYS.includes(FRONTS_FEATURE) && activeWars().battlefields;
// Air units: raised, flown over battlefields and sent to strike. Off, none is.
export const airOn = () => !FEATURE_KEYS.includes(FRONTS_FEATURE) || activeWars().air;
// Navies: fleets raised, fighting, blockading and carrying troops by sea. Off, none is.
export const naviesOn = () => !FEATURE_KEYS.includes(FRONTS_FEATURE) || activeWars().navies;

// What a time skip is told of the parts of war the scenario has switched off:
// "" when it has all of them, so the prompt is then what it always was. The game
// leaves out what it writes of them all the same (gameState.js applyUnitOpBatch).
export const warPartsOffBlock = () => {
  const off = [airOn() ? "" : "air units", naviesOn() ? "" : "navies"].filter(Boolean);
  if (off.length === 0) return "";
  const raise = [airOn() ? "" : "aircraft", naviesOn() ? "" : "fleets"].filter(Boolean).join(" or ");
  return `[Wars]\nThis scenario's wars are fought without ${off.join(" and ")}. Raise, move or fight no ${raise} in unitOps or front orders: the game has none and leaves out any you write. Tell its wars on land${naviesOn() ? " and at sea" : ""}.`;
};

// The pace the engine is told for its advances, as a factor of the game's own
// paces for a formation on the move: the part of them that is the built-in
// pace of a front (FRONT_PACE_SHARE says why it is a part). The Wars feature's
// Pace of an advance setting is gone ("remove the pace of an advance setting
// from features", the owner, 2026-11-04): a pace a scenario or game saved
// before is dropped when it is read (gameFeatures.js keeps only the settings
// it defines), and every game advances at this one.
export const frontsPace = () => FRONT_PACE_SHARE;

// EXPERIMENT, in the lab only (runtime/fronts/mind/). Whether the sides nobody
// plays are led by the lab's own staff (mind/trained.js: on this branch the
// staff that looks ahead) in place of the engine's scripted staff. On in this
// lab build, for the owner to try ("put that current model on 3319 for me to
// test", 2026-10-14), unless whoever is at the keyboard turns it off, in the
// browser's console: localStorage.setItem("oh:strategyNet", "0"). There is no
// setting for it and no scenario can ask for it. (Only in a page: what runs a
// turn's fronts outside one, a test or a tool, has the engine's own staff.)
export const STRATEGY_NET_KEY = "oh:strategyNet";
export const strategyNetOn = () => {
  try {
    return typeof globalThis.window !== "undefined" && Boolean(globalThis.localStorage) && globalThis.localStorage.getItem(STRATEGY_NET_KEY) !== "0";
  } catch {
    return false;
  }
};

// The formations a model that moves units is shown. One fighting on a
// battlefield is a troop of its side there: the engine moves it, the
// battlefield's own lines in [Fronts] speak for it, and it leaves the list, so
// that nothing is told to march it somewhere. With fronts off, or with nothing
// on a battlefield, the list comes back as it is.
export const unitsOffBattlefields = (units) => {
  if (!Array.isArray(units) || !frontsOn() || !units.some((unit) => unit?.committedTo)) return units;
  return units.filter((unit) => !unit?.committedTo);
};
