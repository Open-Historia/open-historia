/*! Open Historia — battlefields and fronts: what the difficulty weighs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The land war is fought on even terms on Medium: what decides it is who
// brought what, where they stand and what they are told. Above Medium the side
// fighting a country a person plays is given an edge, the larger the harder
// the level, and on Impossible a huge one; below Medium that side is held back
// instead. An edge is four figures (constants.js DIFFICULTY_EDGES): how hard
// its troops fight, in attack and in defence (and so how slowly its ground is
// taken where nobody stands on it); how fast its own troops advance; how much
// reserve comes with every troop it raises; and how fast its troops are
// brought back up to strength.
//
// Only a battlefield with a person on ONE side of it is weighed. A war between
// countries nobody plays is fought fair on every level, and so is one with
// people on both sides: nobody is handicapped against another player. The
// countries that fight beside a person are given nothing either way.

import { DIFFICULTY_EDGES, SHORTAGE_EDGE } from "./constants.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export const FAIR_EDGE = DIFFICULTY_EDGES.medium;

// The edge of a difficulty, by its id (runtime/difficulty.js). An old game's
// "standard", a blank and anything unknown are Medium.
export const edgeOfDifficulty = (difficulty) => {
  const id = fold(difficulty);
  return Object.hasOwn(DIFFICULTY_EDGES, id) ? DIFFICULTY_EDGES[id] : FAIR_EDGE;
};

// Which side of a battlefield the difficulty weighs: the one that fights a
// country a person plays and has no such country of its own. -1 for neither.
//   sides     [[names], [names]]: who is fighting on each
//   players   the countries (and groups) people play
export const weighedSide = (sides, players) => {
  const played = new Set((Array.isArray(players) ? players : []).map(fold).filter(Boolean));
  if (played.size === 0) return -1;
  const has = [0, 1].map((side) => (Array.isArray(sides?.[side]) ? sides[side] : []).some((member) => played.has(fold(member))));
  return has[0] === has[1] ? -1 : has[0] ? 1 : 0;
};

// A side's edge with what it is short of taken off (constants.js
// SHORTAGE_EDGE): the edge itself where it is short of nothing.
//   shortage   0 to 1
export const shortEdge = (edge, shortage) => {
  const short = Number(shortage);
  if (!(short > 0)) return edge;
  const by = short > 1 ? 1 : short;
  return {
    power: edge.power * (1 - SHORTAGE_EDGE.power * by),
    pace: edge.pace * (1 - SHORTAGE_EDGE.pace * by),
    reserves: edge.reserves * (1 - SHORTAGE_EDGE.reserves * by),
    mend: edge.mend * (1 - SHORTAGE_EDGE.mend * by),
  };
};

// How short a side is: its members' shortages, each by what it brings.
//   members      who is fighting on it
//   shortageOf   (name) => 0 to 1
//   strengthOf   (name) => its weight
export const sideShortage = (members, shortageOf, strengthOf) => {
  if (typeof shortageOf !== "function") return 0;
  let weight = 0;
  let short = 0;
  for (const member of Array.isArray(members) ? members : []) {
    const brings = typeof strengthOf === "function" ? Number(strengthOf(member)) : 1;
    const worth = brings > 0 ? brings : 1;
    const lacks = Number(shortageOf(member));
    weight += worth;
    if (lacks > 0) short += worth * (lacks > 1 ? 1 : lacks);
  }
  return weight > 0 ? short / weight : 0;
};

// What a battlefield's sides are given: `side` is the one weighed (-1 for
// neither), `edge` what it is given, `edges` the two sides' own.
export const handicapOf = ({ difficulty = "", sides = [], players = [] } = {}) => {
  const edge = edgeOfDifficulty(difficulty);
  const side = edge === FAIR_EDGE ? -1 : weighedSide(sides, players);
  return { side, edge: side < 0 ? FAIR_EDGE : edge, edges: [side === 0 ? edge : FAIR_EDGE, side === 1 ? edge : FAIR_EDGE] };
};
