/*! Open Historia — battlefields and fronts: which newer mechanics a run uses © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2: which of the front engine's newer mechanics a run
// uses. A run is given them as input.mechanics; the game gives the ones its
// scenario has on (runtime/warSettings.js warSettingsOf).
//
//   fatigue    troops tire as they march and fight, and recover at rest (fatigue.js)
//   weather    seasons and the day's weather (weather.js)
//   terrain    ground a scenario made harder to cross (arena.js)
//   walls      fortified lines that must be broken through (walls.js)
//   muster     a war's levies come in over weeks, not on its first morning (muster.js)
//   military   each country's own quality, technology, unit mix and men a counter (military.js)
//   air        air wings take part in the fighting below them (air.js)
//   attrition  harsh weather and a hard climate wear down every troop out in
//              them, counted for each country (attrition.js, weather.js)
//   supply     advancing and building fortified lines spend a country's war
//              resources (runtime/warResources.js); the run counts each
//              country's days of advance (dawn.js dusk)
//   marching   new troops are raised inside their country and march to the
//              line, half again as fast over their own side's ground as through
//              the enemy's; a border built up in peace musters and marches (march.js)
//
// Only one turned on with a literal true is on, so that a run given none of
// them, as every engine test that is not about them is, is to the last digit
// the run it always was.

export const MECHANICS = Object.freeze(["fatigue", "weather", "terrain", "walls", "muster", "military", "air", "supply", "attrition", "marching"]);

export const readMechanics = (value) => Object.freeze(Object.fromEntries(MECHANICS.map((key) => [key, value?.[key] === true])));

export const anyMechanic = (mech) => MECHANICS.some((key) => mech?.[key] === true);
