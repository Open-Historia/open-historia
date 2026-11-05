/*! Open Historia — fortified lines a country orders built in the war room © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Make it so you can also manually draw fortified lines you want to create in
// the war room ... fortified lines ... level 0-10 ... (fortified lines should
// be a minimum of 3)", 10 being a line nobody passes.
//
// A line the player draws in the war room (GameUI/warRoomFortify.jsx) is an
// OP, as everything done there is (warRoomOps.js), applied to the world for
// the country that asked (runtime/warRoomWrites.js sendFortifyOp). So the
// rules are here once:
//
//   { op: "fortify",   points, level, name?, owner? }   a line to be built along `points`
//                                                      ([lng, lat]) at `level`, held to 3..9:
//                                                      a line nobody passes (10) is the
//                                                      scenario designer's alone
//   { op: "unfortify", id }                            one of the asker's lines that is still
//                                                      being built, given up
//
// A line is the asking country's: one that names another owner is refused. It
// runs only over the country's own territory, the land it holds on the map,
// every kilometre of it, read from the regions' own shapes (runtime/
// warRoomChart.js, regionLocator.js): water is
// crossed, another's land is not, not even a little way over a border. It
// is FORTIFY_KM_LEAST long at least and FORTIFY_KM_MOST at most, and it joins
// the world's lines (runtime/warGeography.js fortifications) BEING BUILT from
// the game's date for the days its length, level, treasury and manpower take
// (runtime/fortifyCost.js). Until then the engine leaves it out of the
// fighting (walls.js standsOn). A scenario that has turned fortified lines off
// (warSettings.js mechanics "walls") has none built either.
//
// Pure, and runs in bare node.

import { addGameDays } from "../gameDates.js";
import { fortifyCostFor, fortifyLevelOf } from "../fortifyCost.js";
import { FORTIFICATIONS_MOST, normalizeFortifications } from "../warGeography.js";
import { warSettingsOf } from "../warSettings.js";
import { standsOn } from "./walls.js";
import { kmBetween } from "./worldGrid.js";

export const FORTIFY_OPS = Object.freeze(["fortify", "unfortify"]);
export const FORTIFY_KM_LEAST = 1;
export const FORTIFY_KM_MOST = 6000;
// The most points a line is kept with: a drawing of more is thinned evenly from end to end.
export const FORTIFY_POINTS_MOST = 200;
// The most lines a country may have being built at once.
export const FORTIFY_BUILDING_MOST = 12;
// How far apart the places along a line are that are read for whose ground it
// is on: a kilometre, the whole length of the longest line.
const GROUND_STEP_KM = 1;
const GROUND_SAMPLES_MOST = 6000;
const NAME_MOST = 80;

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();

const REFUSED = Object.freeze({
  nothing: "Nothing was asked.",
  nobody: "You play no country to build it.",
  off: "Fortified lines are no part of this scenario's wars.",
  owner: "A line is built by your own country, for your own country.",
  level: "Say how strong the line is to be.",
  line: "Draw the line on the map.",
  short: "That line is too short to build.",
  long: "That line is too long to build: draw a shorter one.",
  ground: "A line is built on ground you hold: part of this one runs through land you do not.",
  water: "A line is built on land: this one runs only over water.",
  chart: "The map could not be read to see whose ground that is: try again.",
  calendar: "The game's date cannot be counted in days, so no line can be built to time.",
  room: "There is no room on the map for another fortified line.",
  busy: "You have as many lines being built as can be: wait for one to be finished.",
  gone: "That line is not one of yours being built.",
});

// A point as a line keeps it: [lng, lat] to five places, or null.
const pointOf = (value) => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  return [Math.round(lng * 100000) / 100000, Math.round(lat * 100000) / 100000];
};

// A line as it was drawn: its points, none twice in a row, and a drawing of
// very many thinned evenly from end to end (its ends are where it ends).
export const fortifyLineOf = (value) => {
  const points = [];
  for (const raw of Array.isArray(value) ? value.slice(0, FORTIFY_POINTS_MOST * 25) : []) {
    const point = pointOf(raw);
    const last = points[points.length - 1];
    if (!point || (last && last[0] === point[0] && last[1] === point[1])) continue;
    points.push(point);
  }
  if (points.length <= FORTIFY_POINTS_MOST) return points;
  const kept = [];
  for (let index = 0; index < FORTIFY_POINTS_MOST; index += 1) kept.push(points[Math.round((index * (points.length - 1)) / (FORTIFY_POINTS_MOST - 1))]);
  return kept;
};

// The places along a line, every GROUND_STEP_KM or so and at every corner.
const placesAlong = (points, km) => {
  const step = Math.max(GROUND_STEP_KM, km / GROUND_SAMPLES_MOST);
  const places = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const [lngA, latA] = points[index - 1];
    const [lngB, latB] = points[index];
    const parts = Math.max(1, Math.ceil(kmBetween(lngA, latA, lngB, latB) / step));
    for (let part = 1; part <= parts; part += 1) places.push([lngA + ((lngB - lngA) * part) / parts, latA + ((latB - latA) * part) / parts]);
  }
  return places;
};

// Whether a line runs over ground its owner holds: every place along it on
// land is the owner's, or near enough, and it is on land somewhere. "" when it
// does, else why not.
const groundRefusal = (chart, owner, points, km) => {
  let land = 0;
  for (const [lng, lat] of placesAlong(points, km)) {
    const held = chart.holds(owner, lng, lat);
    if (held === null || held === undefined) continue;
    if (!held) return REFUSED.ground;
    land += 1;
  }
  return land > 0 ? "" : REFUSED.water;
};

// An id no line of a list has.
const nextLineId = (lines) => {
  const taken = new Set(lines.map((line) => line.id));
  for (let serial = 1; ; serial += 1) if (!taken.has(`built-${serial}`)) return `built-${serial}`;
};

// Whether a line of a list is one of `owner`'s still being built on `date`.
const buildingOf = (line, owner, date) => Boolean(line.building) && fold(line.owner) === fold(owner) && !standsOn(line, date);

// The world with one op applied for the country that asked. Returns
// { world, line, days } (the line built and how long it takes; `line` alone
// for one given up) or { error } in words a person can read.
//   player   the country asking (the seat's, in a shared game)
//   date     the game's date: the day building begins
//   chart    the map's chart (runtime/warRoomChart.js), null where it could not be read
export const applyFortifyOp = (world, op, { player = "", date = "", chart = null } = {}) => {
  if (!op || !FORTIFY_OPS.includes(op.op)) return { error: REFUSED.nothing };
  const owner = clean(player, 120);
  if (!owner) return { error: REFUSED.nobody };
  const lines = normalizeFortifications(world?.fortifications);
  const today = clean(date, 40);

  if (op.op === "unfortify") {
    const line = lines.find((entry) => entry.id === clean(op.id, 64) && buildingOf(entry, owner, today));
    if (!line) return { error: REFUSED.gone };
    return { world: { ...world, fortifications: lines.filter((entry) => entry !== line) }, line };
  }

  if (!warSettingsOf(world).mechanics.walls) return { error: REFUSED.off };
  if (op.owner !== undefined && clean(op.owner) && fold(op.owner) !== fold(owner)) return { error: REFUSED.owner };
  const asked = Number(op.level);
  if (op.level === null || op.level === undefined || op.level === "" || !Number.isFinite(asked)) return { error: REFUSED.level };
  const level = fortifyLevelOf(asked);
  const points = fortifyLineOf(op.points);
  if (points.length < 2) return { error: REFUSED.line };
  const cost = fortifyCostFor(world, owner, points, level);
  if (!(cost.km >= FORTIFY_KM_LEAST)) return { error: REFUSED.short };
  if (cost.km > FORTIFY_KM_MOST) return { error: REFUSED.long };
  if (!addGameDays(today, 1)) return { error: REFUSED.calendar };
  if (lines.length >= FORTIFICATIONS_MOST) return { error: REFUSED.room };
  if (lines.filter((entry) => buildingOf(entry, owner, today)).length >= FORTIFY_BUILDING_MOST) return { error: REFUSED.busy };
  if (!chart || typeof chart.holds !== "function") return { error: REFUSED.chart };
  const ground = groundRefusal(chart, owner, points, cost.km);
  if (ground) return { error: ground };

  // (The days the war room showed for the line before it was asked for: worked out the same way.)
  const days = cost.days;
  const fortifications = normalizeFortifications([...lines, {
    id: nextLineId(lines),
    name: clean(op.name, NAME_MOST),
    owner,
    level,
    points,
    breaches: [],
    wear: [],
    building: { since: today, days },
  }]);
  return { world: { ...world, fortifications }, line: fortifications[fortifications.length - 1], days };
};

// An op as it may be sent to a host: only the fields an op has, each held to
// its size, so that what crosses the wire is small and is nothing else.
export const cleanFortifyOp = (op) => {
  if (!op || !FORTIFY_OPS.includes(op.op)) return null;
  if (op.op === "unfortify") return { op: "unfortify", id: clean(op.id, 64) };
  const sent = { op: "fortify", points: fortifyLineOf(op.points) };
  const level = Number(op.level);
  if (op.level !== null && op.level !== undefined && op.level !== "" && Number.isFinite(level)) sent.level = Math.round(level);
  if (op.name !== undefined) sent.name = clean(op.name, NAME_MOST);
  if (op.owner !== undefined) sent.owner = clean(op.owner, 120);
  return sent;
};
