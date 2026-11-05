/*! Open Historia — battlefields and fronts: a war's levies come in over weeks © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "muster"). "Armies appear on day one of a
// war currently. Calling the army should take exponentially longer to
// mobilize everyone the more people that are mobilized."
//
// A side raises the troops a battle calls for (battle.js raiseTroops) as it
// always did, but each country's are not all there at once: on the first day
// only the share its MUSTERING CURVE gives (runtime/mustering.js: the share of
// its army called up on each day since the call-up began, handed to the run as
// a table), and the rest come in day by day, stood on its own ground along the
// line and put under what their stretch of it is told (engine.js musterDay),
// each charged to its people as it comes.
//
//   which wars    every war that began after the game did, on a battlefield
//                 the scenario did not build: a war under way when the game
//                 began has its armies already
//   the starter   the side that began the war called up its levies before it
//                 declared: it begins at the first point of its own curve
//   in peacetime  every country has an army: MUSTER_STANDING_SHARE of its
//                 levy is there from the first day (constants.js), and its
//                 curve calls up the rest
//   on the map    formations of the world's own (units on the map) are there
//                 from the first day: they are its standing army
//
// What is still to come is kept with the battlefield (brief.carry.levy), a
// list a side of [owner, target, raised, since]: owner its place among the
// side's members, target the counters it is to have, raised those it has had,
// since the day its call-up began.
//
// Only + - * / and comparisons; the dates through gameDates.js.

import { compareGameDates } from "../gameDates.js";
import { MUSTER_STANDING_SHARE } from "./constants.js";

// Whether a war's battlefields muster in this run.
export const mustersFor = (run, war) => run.mech?.muster === true && !run.input?.authored && Boolean(war?.began) && Boolean(run.input?.gameBegan)
  && compareGameDates(war.began, run.input.gameBegan) > 0;

// The share of a country's levy that has come in `days` after its call-up began: its peacetime army
// (MUSTER_STANDING_SHARE) and, of the rest, what its curve has called up; all of it where no curve is known.
export const musterShare = (run, name, days) => {
  const table = run.musterOf?.(name)?.table;
  if (!Array.isArray(table) || table.length === 0 || !(days >= 0)) return 1;
  const at = Math.floor(days);
  const called = at >= table.length ? 1 : table[at];
  return MUSTER_STANDING_SHARE + (1 - MUSTER_STANDING_SHARE) * called;
};

// The days a country's call-up had behind it when the war began: its curve's first point for the side that began it, none for the other.
export const headStartOf = (run, name, starter) => (starter ? Math.max(0, Math.round(Number(run.musterOf?.(name)?.head) || 0)) : 0);

// Which `keep` of `count` things in a row to keep: spread evenly along it.
export const spreadPick = (count, keep) => {
  const picked = [];
  if (keep <= 0) return picked;
  for (let at = 0; at < count; at += 1) if (Math.floor(((at + 1) * keep) / count) > Math.floor((at * keep) / count)) picked.push(at);
  return picked;
};

// The levy as a battle holds it: [{ o, t, r, f }] a side, from what was kept.
export const readLevy = (value) => [0, 1].map((side) => (Array.isArray(value?.[side]) ? value[side] : [])
  .filter((entry) => Array.isArray(entry) && Number.isInteger(entry[0]) && entry[0] >= 0 && entry[1] > 0 && entry[2] >= 0 && typeof entry[3] === "string" && entry[3])
  .map(([o, t, r, f]) => ({ o, t: Math.floor(t), r: Math.min(Math.floor(t), Math.floor(r)), f })));

// What a side is still owed, in counters.
export const levyPending = (levy, side) => (Array.isArray(levy?.[side]) ? levy[side] : []).reduce((sum, entry) => sum + Math.max(0, entry.t - entry.r), 0);
export const levyOwed = (levy) => levyPending(levy, 0) + levyPending(levy, 1) > 0;
