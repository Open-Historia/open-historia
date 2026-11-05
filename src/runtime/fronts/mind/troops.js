/*! Open Historia — battlefields and fronts: what each troop is shown (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only (policy.js createTroopPolicy). "Train the model
// to manage individual troops."
//
// A staff that orders the side as a whole says one word for its whole line.
// This one looks at every troop of the side by itself and gives each its own
// order, out of nine:
//
//   hold             stay, and fight whatever comes (no order: move.js)
//   dig in           dig in where it stands, and stand there
//   push             go straight out from where it stands, into the other side's ground
//   strike           go at the weakest place in the other side's line near it, and through it
//   go round         go round a mass of the other side's troops near it, past
//                    its flank and in behind it: two going round the same mass
//                    from either side close a ring on it
//   take a city      go for the nearest city the other side holds
//   take a capital   go for the nearest capital the other side holds (its own,
//                    or one it took)
//   guard a city     go to the city of the side's own that is most in danger near it
//   shore up         go to where the side's own line is weakest near it
//
// Every place a troop may be sent is worked out once a look, for the whole
// side: a few weak places, a few masses, the cities. A troop is shown what each
// would mean for it (how far, how strongly held) and what stands round it.
//
// Only + - * / and comparisons (sqrt for a distance), as everywhere in the engine.

import { HOLDER_SIDE_A, TROOP_ATTACK } from "../constants.js";
import { readField } from "../field.js";
import { cellAt } from "../ground.js";
import { KIND_ARMOUR, KIND_ARTILLERY, STATE_DUG_IN, isLive } from "../troops.js";

export const TROOP_ACTIONS = Object.freeze(["hold", "dig in", "push", "strike", "go round", "take a city", "take a capital", "guard a city", "shore up", "rest", "breach"]);
export const HOLD = 0;
export const DIG_IN = 1;
export const PUSH = 2;
export const STRIKE = 3;
export const GO_ROUND = 4;
export const TAKE_CITY = 5;
export const TAKE_CAPITAL = 6;
export const GUARD = 7;
export const SHORE_UP = 8;
// Wars and Fronts Pt.2: pull back off the line to recover (fatigue.js), and go at the nearest stretch of an enemy wall (walls.js).
export const REST = 9;
export const BREACH = 10;

export const TROOP_FEATURE_NAMES = Object.freeze([
  "one",
  "strength", "armour", "artillery", "supply", "cut off", "dug in",
  "depth behind its line",
  "odds round it", "its own round it", "theirs round it",
  "strike: how far", "strike: odds there",
  "go round: how far", "go round: how many there",
  "city: how far", "city: worth", "city: how held",
  "capital: how far", "capital: how held",
  "guard: how far", "guard: danger", "guard: worth",
  "shore up: how far", "shore up: odds there",
  "how far back it stands among its own", "attacking now", "at a city of its own",
  // Wars and Fronts Pt.2.
  "fatigue", "breach: how far", "breach: wall's level", "today's going", "the sky over it", "still mustering",
]);
export const TROOP_FEATURE_COUNT = TROOP_FEATURE_NAMES.length;

// How near counts as round a troop or a place; how far a troop may be sent;
// how many of each kind of place are worked out; how far through a weak place
// a strike goes, and how far past a mass and behind it a troop goes round it.
export const LOCAL_KM = 50;
export const CITY_KM = 60;
export const REACH_MOST_KM = 250;
export const SPOTS_MOST = 4;
export const MASSES_MOST = 2;
export const GUARDED_MOST = 3;
const THROUGH_KM = 15;
const PAST_KM = 45;
const BEHIND_KM = 45;
const HERE_KM = 10;
// Within how many cells of the line a troop counts as at the front.
const FRONT_CELLS = 6;
const LARGE_TOWN = 100000;

const within = (value, least, most) => (value < least ? least : value > most ? most : value);
export const cityWorth = (city) => (city.capital ? 3 : (Number(city.population) || 0) >= LARGE_TOWN ? 2 : 1);

// A side's live troops as points with what each is worth in a fight.
const pointsOf = (battle, side) => {
  const points = [];
  const factor = (Number(battle.quality?.[side]) || 1) * (Number(battle.edge?.[side]?.power) || 1);
  battle.troops[side].forEach((troop, index) => {
    if (!isLive(troop)) return;
    const fed = troop.supply === undefined ? 1 : troop.supply;
    points.push({ index, troop, x: troop.x, y: troop.y, worth: troop.strength * TROOP_ATTACK[troop.kind] * fed * (troop.punch ?? 1) * factor });
  });
  return points;
};

const kmBetween = (kmAt, ax, ay, bx, by) => {
  const km = kmAt((ay + by) / 2);
  const dx = (ax - bx) * km;
  const dy = (ay - by) * km;
  return Math.sqrt(dx * dx + dy * dy);
};

const sumNear = (points, kmAt, x, y, km) => {
  let sum = 0;
  for (const point of points) if (kmBetween(kmAt, point.x, point.y, x, y) <= km) sum += point.worth;
  return sum;
};

// How deep in a side's own ground a point is, in cells (negative: in the other's).
const depthOf = (field, side, x, y) => {
  const phi = readField(field, x, y);
  return side === HOLDER_SIDE_A ? -phi : phi;
};

// Which way is into the other side's ground from a point: a unit vector. Where
// the line is too far off to say, the way from one side's troops to the other's.
const intoTheirs = (field, side, x, y, fallback) => {
  let gx = readField(field, x + 1, y) - readField(field, x - 1, y);
  let gy = readField(field, x, y + 1) - readField(field, x, y - 1);
  if (side !== HOLDER_SIDE_A) {
    gx = -gx;
    gy = -gy;
  }
  const length = Math.sqrt(gx * gx + gy * gy);
  return length > 1e-6 ? [gx / length, gy / length] : fallback;
};

const middleOf = (points) => {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x / points.length;
    y += point.y / points.length;
  }
  return [x, y];
};

// The best few of a list by a score, none within `apart` km of one already taken.
const spread = (list, kmAt, apart, most) => {
  const taken = [];
  for (const entry of list.slice().sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (taken.length >= most) break;
    if (taken.some((other) => kmBetween(kmAt, other.x, other.y, entry.x, entry.y) < apart)) continue;
    taken.push(entry);
  }
  return taken;
};

// The nearest of a list of places within reach of a point: { place, km } or null.
const nearestOf = (places, kmAt, x, y, { least = 0 } = {}) => {
  let found = null;
  for (const place of places) {
    const km = kmBetween(kmAt, place.x, place.y, x, y);
    if (km > REACH_MOST_KM || km < least) continue;
    if (!found || km < found.km) found = { place, km };
  }
  return found;
};

// What each of a side's troops is shown, and where each could be sent.
//   battle, side   the battle as it stands, and which side
// Returns { rows, places }:
//   rows     [{ index, t, valid, goal }]: a troop's place in its side's list, what
//            it sees (TROOP_FEATURE_COUNT numbers), which of TROOP_ACTIONS it
//            may be given, and for each action that sends it somewhere, the key
//            of the place it would go (into `places`)
//   places   Map key -> { way: [[x, y], ...] in cells }
export const troopView = (battle, side) => {
  const { field, place } = battle;
  const { kmAt } = place;
  const other = 1 - side;
  const own = pointsOf(battle, side);
  const theirs = pointsOf(battle, other);
  const rows = [];
  const places = new Map();
  if (own.length === 0) return { rows, places };
  const meanOwn = own.reduce((sum, point) => sum + point.worth, 0) / own.length;
  const scale = 8 * (meanOwn > 0 ? meanOwn : 1);
  const crowd = (worth) => worth / (worth + scale);
  const odds = (mine, facing) => (mine + facing > 0 ? mine / (mine + facing) : 0.5);
  const [ownX, ownY] = middleOf(own);
  const [theirX, theirY] = theirs.length > 0 ? middleOf(theirs) : [ownX, ownY];
  const towardLength = Math.sqrt((theirX - ownX) * (theirX - ownX) + (theirY - ownY) * (theirY - ownY));
  const toward = towardLength > 1e-6 ? [(theirX - ownX) / towardLength, (theirY - ownY) / towardLength] : [side === HOLDER_SIDE_A ? 1 : -1, 0];
  const inFrame = (x, y) => [within(x, 0.5, field.cols - 0.5), within(y, 0.5, field.rows - 0.5)];
  const along = (x, y, [dx, dy], km) => {
    const cells = km / kmAt(y);
    return inFrame(x + dx * cells, y + dy * cells);
  };

  // The weak places in the other side's line, and its masses: of its troops at the front.
  const front = theirs.filter((point) => !point.troop.pocket && depthOf(field, other, point.x, point.y) <= FRONT_CELLS);
  const faced = (front.length > 0 ? front : theirs).map((point) => {
    const mine = sumNear(own, kmAt, point.x, point.y, LOCAL_KM);
    const facing = sumNear(theirs, kmAt, point.x, point.y, LOCAL_KM);
    return { index: point.index, x: point.x, y: point.y, mine, facing };
  });
  const weak = spread(faced.map((entry) => ({ ...entry, score: odds(entry.mine, entry.facing) })), kmAt, 2 * LOCAL_KM, SPOTS_MOST);
  weak.forEach((spot, at) => {
    const into = intoTheirs(field, side, spot.x, spot.y, toward);
    places.set(`strike ${at}`, { way: [along(spot.x, spot.y, into, THROUGH_KM)] });
  });
  const masses = spread(faced.map((entry) => ({ ...entry, score: entry.facing })), kmAt, 2 * LOCAL_KM, MASSES_MOST);
  const sideways = masses.map((mass, at) => {
    const into = intoTheirs(field, side, mass.x, mass.y, toward);
    const beside = [-into[1], into[0]];
    for (const sign of [1, -1]) {
      const past = along(mass.x, mass.y, [beside[0] * sign, beside[1] * sign], PAST_KM);
      places.set(`round ${at} ${sign}`, { way: [past, along(mass.x, mass.y, into, BEHIND_KM)] });
    }
    return beside;
  });

  // The cities: those the other side holds, to be taken, and the side's own, to be kept.
  const cities = (battle.arena?.cities ?? []).map((city, at) => {
    const cell = cellAt(field, city.x, city.y);
    return { ...city, at, holder: cell >= 0 ? field.holders[cell] : -1 };
  });
  const toTake = cities.filter((city) => city.holder === other).map((city) => {
    const mine = sumNear(own, kmAt, city.x, city.y, CITY_KM);
    const facing = sumNear(theirs, kmAt, city.x, city.y, CITY_KM);
    places.set(`city ${city.at}`, { way: [[city.x, city.y]] });
    return { ...city, held: 1 - odds(mine, facing) };
  });
  const capitals = toTake.filter((city) => city.capital);
  const kept = cities.filter((city) => city.holder === side).map((city) => {
    const mine = sumNear(own, kmAt, city.x, city.y, CITY_KM);
    const facing = sumNear(theirs, kmAt, city.x, city.y, CITY_KM);
    const danger = facing > 0 ? 1 - odds(mine, facing) : 0;
    return { ...city, danger, score: (danger + 0.1) * cityWorth(city), index: city.at };
  });
  const guarded = spread(kept, kmAt, 0, GUARDED_MOST);
  for (const city of guarded) places.set(`guard ${city.at}`, { way: [[city.x, city.y]] });

  // Where the side's own line is weakest.
  const ownFront = own.filter((point) => !point.troop.pocket && depthOf(field, side, point.x, point.y) <= FRONT_CELLS).map((point) => {
    const mine = sumNear(own, kmAt, point.x, point.y, LOCAL_KM);
    const facing = sumNear(theirs, kmAt, point.x, point.y, LOCAL_KM);
    return { index: point.index, x: point.x, y: point.y, there: odds(mine, facing), score: facing > 0 ? 1 - odds(mine, facing) : 0 };
  }).filter((entry) => entry.score > 0);
  const shaky = spread(ownFront, kmAt, 2 * LOCAL_KM, SPOTS_MOST);
  shaky.forEach((spot, at) => places.set(`shore ${at}`, { way: [[spot.x, spot.y]] }));

  // The stretches of the other side's walls standing against this side today (walls.js): a few, spread out.
  const mask = battle.wallMask?.[side] ?? null;
  const wallCells = [];
  if (mask && battle.walls) {
    for (let cell = 0; cell < mask.length; cell += 1) {
      if (mask[cell] !== 1) continue;
      const at = battle.walls.cellLine[cell];
      const level = at > 0 ? (battle.wallRun?.lines?.[at - 1]?.level ?? 0) : 0;
      wallCells.push({ index: cell, x: (cell % field.cols) + 0.5, y: Math.floor(cell / field.cols) + 0.5, level, score: 10 - level });
    }
  }
  const walls = spread(wallCells, kmAt, 2 * LOCAL_KM, SPOTS_MOST);
  walls.forEach((spot, at) => places.set(`breach ${at}`, { way: [[spot.x, spot.y]] }));
  // How much of the side is still to come in (muster.js).
  const owed = Array.isArray(battle.levy?.[side]) ? battle.levy[side].reduce((sum, entry) => sum + Math.max(0, entry.t - entry.r), 0) : 0;
  const mustering = owed > 0 ? owed / (owed + own.length) : 0;
  // Who holds the sky over the battlefield (air.js): + for this side, - for the other.
  const sky = battle.wings ? (battle.wings.holds === side ? 1 : -1) * battle.wings.superiority : 0;

  // How far back each troop stands among its own.
  const depths = own.map((point) => depthOf(field, side, point.x, point.y));
  const order = depths.map((depth, at) => at).sort((a, b) => depths[a] - depths[b] || a - b);
  const rank = new Float64Array(own.length);
  order.forEach((at, place) => { rank[at] = own.length > 1 ? place / (own.length - 1) : 0; });

  own.forEach((point, at) => {
    const { troop } = point;
    const { x, y } = point;
    const mine = sumNear(own, kmAt, x, y, LOCAL_KM);
    const facing = sumNear(theirs, kmAt, x, y, LOCAL_KM);
    const t = new Float64Array(TROOP_FEATURE_COUNT);
    const valid = new Array(TROOP_ACTIONS.length).fill(false);
    const goal = new Array(TROOP_ACTIONS.length).fill("");
    valid[HOLD] = true;
    valid[DIG_IN] = true;
    valid[PUSH] = !troop.pocket;
    t[0] = 1;
    t[1] = within(troop.strength / 100, 0, 1.5);
    t[2] = troop.kind === KIND_ARMOUR ? 1 : 0;
    t[3] = troop.kind === KIND_ARTILLERY ? 1 : 0;
    t[4] = troop.supply === undefined ? 1 : troop.supply;
    t[5] = troop.pocket ? 1 : 0;
    t[6] = troop.state === STATE_DUG_IN || troop.dug ? 1 : 0;
    t[7] = within((depths[at] * kmAt(y)) / 50, -1, 1);
    t[8] = odds(mine, facing);
    t[9] = crowd(mine);
    t[10] = crowd(facing);

    const strike = nearestOf(weak, kmAt, x, y);
    t[11] = strike ? strike.km / REACH_MOST_KM : 1;
    t[12] = strike ? odds(strike.place.mine, strike.place.facing) : 0;
    if (strike) {
      valid[STRIKE] = !troop.pocket;
      goal[STRIKE] = `strike ${weak.indexOf(strike.place)}`;
    }
    const mass = nearestOf(masses, kmAt, x, y);
    t[13] = mass ? mass.km / REACH_MOST_KM : 1;
    t[14] = mass ? crowd(mass.place.facing) : 0;
    if (mass) {
      const at2 = masses.indexOf(mass.place);
      const [bx, by] = sideways[at2];
      const sign = (x - mass.place.x) * bx + (y - mass.place.y) * by >= 0 ? 1 : -1;
      valid[GO_ROUND] = !troop.pocket;
      goal[GO_ROUND] = `round ${at2} ${sign}`;
    }
    const city = nearestOf(toTake, kmAt, x, y);
    t[15] = city ? city.km / REACH_MOST_KM : 1;
    t[16] = city ? cityWorth(city.place) / 3 : 0;
    t[17] = city ? city.place.held : 0;
    if (city) {
      valid[TAKE_CITY] = true;
      goal[TAKE_CITY] = `city ${city.place.at}`;
    }
    const capital = nearestOf(capitals, kmAt, x, y);
    t[18] = capital ? capital.km / REACH_MOST_KM : 1;
    t[19] = capital ? capital.place.held : 0;
    if (capital) {
      valid[TAKE_CAPITAL] = true;
      goal[TAKE_CAPITAL] = `city ${capital.place.at}`;
    }
    const guard = nearestOf(guarded, kmAt, x, y);
    t[20] = guard ? guard.km / REACH_MOST_KM : 1;
    t[21] = guard ? guard.place.danger : 0;
    t[22] = guard ? cityWorth(guard.place) / 3 : 0;
    if (guard && guard.km >= HERE_KM) {
      valid[GUARD] = true;
      goal[GUARD] = `guard ${guard.place.at}`;
    }
    const shore = nearestOf(shaky, kmAt, x, y, { least: HERE_KM });
    t[23] = shore ? shore.km / REACH_MOST_KM : 1;
    t[24] = shore ? shore.place.there : 0;
    if (shore) {
      valid[SHORE_UP] = true;
      goal[SHORE_UP] = `shore ${shaky.indexOf(shore.place)}`;
    }
    t[25] = rank[at];
    t[26] = troop.order && !troop.order.done && (troop.order.kind === "way" || troop.order.kind === "assault") ? 1 : 0;
    t[27] = kept.some((city) => kmBetween(kmAt, city.x, city.y, x, y) < 2 * HERE_KM) ? 1 : 0;
    // Wars and Fronts Pt.2: how worn it is, the nearest wall to break, today's going, the sky, the levies still to come.
    t[28] = within(Number(troop.fatigue) || 0, 0, 1);
    const wall = nearestOf(walls, kmAt, x, y);
    t[29] = wall ? wall.km / REACH_MOST_KM : 1;
    t[30] = wall ? wall.place.level / 10 : 0;
    if (wall && !troop.pocket) {
      valid[BREACH] = true;
      goal[BREACH] = `breach ${walls.indexOf(wall.place)}`;
    }
    t[31] = within((battle.sky ? battle.sky.effects.pace : 1) * (troop.climate ? troop.climate.pace : 1), 0, 1.5);
    t[32] = within(sky, -1, 1);
    t[33] = mustering;
    // A rest: pull back off the line, and the more so the more it is worn.
    valid[REST] = !troop.pocket;
    goal[REST] = "rest";
    rows.push({ index: point.index, t, valid, goal });
  });
  return { rows, places };
};
