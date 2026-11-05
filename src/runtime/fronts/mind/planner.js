/*! Open Historia — battlefields and fronts: a staff that looks ahead (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. "Redesign the model to have super complex
// control and give it understanding of everything that is going on ... it
// should have FULL CONTROL of its troops so it can even invent real world
// stratagies ... make it the stockfish of Open historia" (the owner,
// 2026-10-14).
//
// A staff that, like a chess engine, LOOKS AHEAD before it orders anything.
// Every few days it draws up several plans for its side, each a whole set of
// orders troop by troop, fights each of them out on a copy of the battle for
// some days (engine.js rehearsal: the real engine on a copy, the other side
// going on with what it was doing), weighs how each leaves the battle, and
// gives the orders of the best. What it sees is everything the engine knows:
// every troop of both sides, where it stands and what it is doing, the ground
// each side holds and whose home it is, the towns, the walls, the sky, the
// weather, who is cut off and who nearly is; and the plans it may give range
// from one order for the whole line to a different place for every troop.
//
//   the plans     keep what it was doing; its own judgement troop by troop
//                 (the NET: a weighing of what each troop sees, learnt), as it
//                 is, digging in where it would only hold, or resting the
//                 worn; push everywhere; dig in everywhere; the nearest half
//                 on one of the weakest places in the other side's line, the
//                 rest digging in; a pincer round its largest mass; the towns
//   the weighing  of a battle as a plan leaves it (EVAL_NAMES): ground taken
//                 and lost, towns, capitals, strength, troops cut off, wear,
//                 supply, troops in their works; learnt as well
//
// It is handed to a run as its `staffPolicy` (with `often`: it looks every
// LOOK_DAYS, the engine's own staff every STAFF_REVIEW_DAYS), and keeps its
// orders between its looks.
//
// Only + - * / and comparisons (sqrt for a distance), as everywhere in the
// engine: the same weights decide the same on every machine.

import { rehearsal, rehearsalPacket, rehearseDay, rehearseOrders } from "../engine.js";
import { AIR_MISSIONS, airMissionOf } from "../air.js";
import { isLive } from "../troops.js";
import { BREACH, DIG_IN, HOLD, PUSH, REST, TAKE_CAPITAL, TAKE_CITY, TROOP_ACTIONS, TROOP_FEATURE_COUNT, troopView } from "./troops.js";

// What a battle as a plan leaves it is weighed by, for the side looking ahead (each its own less the other's).
export const EVAL_NAMES = Object.freeze(["ground", "towns", "capitals", "strength", "cut off", "wear", "supply", "in its works"]);
export const DEFAULT_EVAL = Object.freeze([0.25, 4, 15, 1, 1.5, -1, 1, 0.3]);
// What each troop is shown besides what troops.js shows it: the nearest of the other side's troops, and how near
// it is to being surrounded.
export const EXTRA_NAMES = Object.freeze(["nearest enemy: how far", "nearest enemy: dug in", "nearest enemy: strength", "nearest enemy: under way", "nearest enemy: cut off", "how nearly it is surrounded"]);
export const NET_FEATURES = TROOP_FEATURE_COUNT + EXTRA_NAMES.length;
// The plans it draws up, in the order they are weighed (the first of equals is kept).
export const PLAN_NAMES = Object.freeze(["keep", "net", "net, digging in", "net, resting the worn", "push", "dig in", "the weakest place", "the second weakest place", "the third weakest place", "a pincer", "the towns", "everyone on the weakest place", "the walls"]);
// The plans it first drew up (champion 1 of tools/strategy-nn/ladder.mjs was made with these).
export const FIRST_PLAN_NAMES = Object.freeze(PLAN_NAMES.slice(0, 11));
// What the weighing came to weigh later, kept after the net's weights so that weights made before are read as
// they were (and these at their defaults): how nearly each side's troops are surrounded, the other's less its own
// (the strength of each, by how many of the eight points of the compass SURROUND_KM round it the other holds
// beyond half): an encirclement is worth something before it closes. 0 to begin with: weighed in at 1 it was no
// better over 40 duels (-2.0 a duel, SE 10.7), and the ladder may learn what it is worth.
export const LATE_EVAL_NAMES = Object.freeze(["nearly cut off"]);
export const LATE_EVAL = Object.freeze([0]);
// The weights, in one flat array: the weighing (EVAL_NAMES), then the net's: for each of TROOP_ACTIONS its
// weight of each of NET_FEATURES and a bias; then the later weighing (LATE_EVAL_NAMES).
export const NET_AT = EVAL_NAMES.length;
export const LATE_AT = NET_AT + TROOP_ACTIONS.length * (NET_FEATURES + 1);
export const PLAN_PARAMS = LATE_AT + LATE_EVAL_NAMES.length;
// Weights made before the later weighing, read with it at its defaults.
export const withLateEval = (values) => {
  const params = new Float64Array(PLAN_PARAMS);
  LATE_EVAL.forEach((value, at) => { params[LATE_AT + at] = value; });
  const given = Array.from(values ?? []);
  for (let at = 0; at < Math.min(given.length, PLAN_PARAMS); at += 1) params[at] = Number(given[at]) || 0;
  return params;
};
// How often it looks, how far ahead, and the most bodies of troops it sends anywhere at once.
export const LOOK_DAYS = 5;
export const AHEAD_DAYS = 6;
export const BODIES_MOST = 12;
const WORN = 0.5;
const SURROUND_KM = 30;
const FAR_KM = 150;

// Weights that know nothing yet: the default weighing, and a net that leans to holding.
export const plainPlanner = () => {
  const params = new Float64Array(PLAN_PARAMS);
  DEFAULT_EVAL.forEach((value, at) => { params[at] = value; });
  LATE_EVAL.forEach((value, at) => { params[LATE_AT + at] = value; });
  params[NET_AT + HOLD * (NET_FEATURES + 1) + NET_FEATURES] = 0.1;
  return params;
};

const within = (value, least, most) => (value < least ? least : value > most ? most : value);
const kmFrom = (battle, ax, ay, bx, by) => {
  const km = battle.place.kmAt((ay + by) / 2);
  const dx = (ax - bx) * km;
  const dy = (ay - by) * km;
  return Math.sqrt(dx * dx + dy * dy);
};

// ---- what each troop sees besides --------------------------------------------------
const COMPASS = Object.freeze([[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]]);
const extraOf = (battle, side, troop) => {
  const { field, place } = battle;
  let nearest = null;
  let best = Infinity;
  for (const enemy of battle.troops[1 - side]) {
    if (!isLive(enemy)) continue;
    const far = kmFrom(battle, enemy.x, enemy.y, troop.x, troop.y);
    if (far < best) {
      best = far;
      nearest = enemy;
    }
  }
  const out = new Float64Array(EXTRA_NAMES.length);
  out[0] = nearest ? within(best / FAR_KM, 0, 1) : 1;
  out[1] = nearest && nearest.dug ? 1 : 0;
  out[2] = nearest ? within(nearest.strength / 100, 0, 1.5) : 0;
  out[3] = nearest && nearest.order && !nearest.order.done ? 1 : 0;
  out[4] = nearest && nearest.pocket ? 1 : 0;
  // How many of eight points SURROUND_KM round it the other side holds.
  let theirs = 0;
  const reach = SURROUND_KM / place.kmAt(troop.y);
  for (const [cx, cy] of COMPASS) {
    const x = Math.floor(troop.x + cx * reach);
    const y = Math.floor(troop.y + cy * reach);
    if (x < 0 || y < 0 || x >= field.cols || y >= field.rows) continue;
    if (field.holders[y * field.cols + x] === 1 - side) theirs += 1;
  }
  out[5] = theirs / COMPASS.length;
  return out;
};

// What each troop of a side sees: troops.js and the extras, NET_FEATURES numbers each.
export const plannerFeatures = (battle, side, view) => view.rows.map((row) => {
  const out = new Float64Array(NET_FEATURES);
  out.set(row.t, 0);
  out.set(extraOf(battle, side, battle.troops[side][row.index]), TROOP_FEATURE_COUNT);
  return out;
});

// ---- the plans -----------------------------------------------------------------------
// The net's choice for one troop: the valid action it scores highest.
const netChoice = (params, features, valid) => {
  const width = NET_FEATURES + 1;
  let chosen = HOLD;
  let most = -Infinity;
  for (let action = 0; action < TROOP_ACTIONS.length; action += 1) {
    if (!valid[action]) continue;
    const at = NET_AT + action * width;
    let sum = params[at + NET_FEATURES];
    for (let feature = 0; feature < NET_FEATURES; feature += 1) sum += params[at + feature] * features[feature];
    if (sum > most) {
      most = sum;
      chosen = action;
    }
  }
  return chosen;
};

// What a troop doing an action is sent to: "hold", "dig in", "push", "rest", or a place's key.
const keyOf = (row, action) => (action === HOLD ? "hold" : action === DIG_IN ? "dig in" : action === PUSH ? "push" : action === REST ? "rest" : row.goal[action] || "hold");

// Orders for a side from where each troop is sent: { order, picked, way } bodies, troops sent to the same place
// going as one, the smallest beyond BODIES_MOST holding where they are.
const bodiesOf = (battle, view, keys) => {
  const bodies = new Map();
  view.rows.forEach((row, at) => {
    const key = keys[at];
    if (!bodies.has(key)) bodies.set(key, []);
    bodies.get(key).push(row.index);
  });
  const sent = [...bodies.keys()].filter((key) => key !== "hold" && key !== "dig in")
    .sort((a, b) => bodies.get(b).length - bodies.get(a).length || (a < b ? -1 : a > b ? 1 : 0));
  for (const key of sent.slice(BODIES_MOST)) {
    if (!bodies.has("hold")) bodies.set("hold", []);
    bodies.get("hold").push(...bodies.get(key));
    bodies.delete(key);
  }
  const out = [];
  for (const [key, picked] of bodies) {
    const sorted = picked.slice().sort((a, b) => a - b);
    if (key === "hold" || key === "dig in") out.push({ order: key, picked: sorted });
    else if (key === "push") out.push({ order: "advance", picked: sorted });
    else if (key === "rest") out.push({ order: "rest", picked: sorted });
    else {
      const way = (view.places.get(key)?.way ?? []).map(([x, y]) => battle.place.toLngLat(x, y).map((value) => Math.round(value * 10000) / 10000));
      if (way.length > 0) out.push({ order: "advance", picked: sorted, way });
    }
  }
  return out;
};

// Where a plan's largest body sent forward along a way is going: the way's last point ([lng, lat]), or null.
const aimOf = (bodies) => {
  let best = null;
  for (const body of Array.isArray(bodies) ? bodies : []) {
    if (body.order === "advance" && Array.isArray(body.way) && body.way.length > 0 && (!best || body.picked.length > best.picked.length)) best = body;
  }
  return best ? best.way[best.way.length - 1] : null;
};

// The nearest `share` of a side's troops that may go to a point, sent to `key`; the rest dig in.
const nearestHalf = (battle, view, key, target, share, may) => {
  const rows = view.rows;
  const ranked = rows.map((row, at) => ({ at, km: may(row) ? kmFrom(battle, row.troop.x, row.troop.y, target[0], target[1]) : Infinity }))
    .filter((entry) => entry.km < Infinity).sort((a, b) => a.km - b.km || a.at - b.at);
  if (ranked.length === 0) return null;
  const going = new Set(ranked.slice(0, Math.max(1, Math.ceil(rows.length * share))).map((entry) => entry.at));
  return rows.map((row, at) => (going.has(at) ? (typeof key === "function" ? key(row) : key) : "dig in"));
};

// Every plan but "keep" (null for one there is nothing to make of): where each troop is sent, by its place in
// view.rows.
const drawPlans = (battle, params, view, features) => {
  const rows = view.rows;
  const net = rows.map((row, at) => netChoice(params, features[at], row.valid));
  const free = (row) => row.valid[PUSH];
  const strike = (at) => {
    const target = view.places.get(`strike ${at}`)?.way?.[0];
    return target ? nearestHalf(battle, view, `strike ${at}`, target, 0.5, free) : null;
  };
  // A pincer: the nearer half go round the largest mass, each to the arm on its own side of it; the rest hold.
  const left = view.places.get("round 0 1")?.way;
  const right = view.places.get("round 0 -1")?.way;
  const pincer = left && right ? nearestHalf(battle, view, (row) => {
    const a = left[0];
    const b = right[0];
    return kmFrom(battle, row.troop.x, row.troop.y, a[0], a[1]) <= kmFrom(battle, row.troop.x, row.troop.y, b[0], b[1]) ? "round 0 1" : "round 0 -1";
  }, left[left.length - 1], 0.5, free) : null;
  return [
    net.map((action, at) => keyOf(rows[at], action)),
    net.map((action, at) => keyOf(rows[at], action === HOLD ? DIG_IN : action)),
    net.map((action, at) => keyOf(rows[at], rows[at].t[28] > WORN && rows[at].valid[REST] ? REST : action)),
    rows.map((row) => (free(row) ? "push" : "dig in")),
    rows.map(() => "dig in"),
    strike(0),
    strike(1),
    strike(2),
    pincer,
    rows.map((row) => (row.valid[TAKE_CAPITAL] && row.t[18] < 0.5 ? row.goal[TAKE_CAPITAL] : row.valid[TAKE_CITY] && row.t[15] < 0.5 ? row.goal[TAKE_CITY] : "dig in")),
    // Every troop that may, on the weakest place at once; and every one that may break a wall at the nearest of
    // the other side's, the rest digging in.
    view.places.get("strike 0")?.way?.[0] ? nearestHalf(battle, view, "strike 0", view.places.get("strike 0").way[0], 1, free) : null,
    rows.some((row) => row.valid[BREACH]) ? rows.map((row) => (row.valid[BREACH] ? row.goal[BREACH] : "dig in")) : null,
  ];
};

// A plan's orders with one body of troops told otherwise: an attack made a digging in, and a digging in or a
// holding made a push straight ahead. null for a body it cannot turn.
const turned = (bodies, at) => {
  const body = bodies[at];
  const other = body.order === "advance" ? { order: "dig in", picked: body.picked }
    : body.order === "dig in" || body.order === "hold" ? { order: "advance", picked: body.picked }
      : null;
  return other ? bodies.map((each, index) => (index === at ? other : each)) : null;
};

// ---- the weighing -----------------------------------------------------------------------
const areaOf = new WeakMap();
const rowArea = (battle) => {
  let areas = areaOf.get(battle.place);
  if (!areas || areas.length !== battle.field.rows) {
    areas = new Float64Array(battle.field.rows);
    for (let row = 0; row < areas.length; row += 1) {
      const km = battle.place.kmAt(row + 0.5);
      areas[row] = km * km;
    }
    areaOf.set(battle.place, areas);
  }
  return areas;
};

// What a battle comes to for a side, each of EVAL_NAMES its own less the other's. (Whose home ground a cell is,
// lawfully: battle.homeSide. Ground taken whole is shown as the taker's, and is taken all the same.)
export const standing = (battle, side) => {
  const { field } = battle;
  const lawful = battle.homeSide;
  const region = battle.arena?.region;
  const known = Boolean(lawful && region);
  const homeAt = (cell) => lawful[region[cell]];
  const out = new Float64Array(EVAL_NAMES.length);
  if (known) {
    // Ground: the other's home it holds less its own the other holds, by the thousand square kilometres.
    const areas = rowArea(battle);
    let ground = 0;
    for (let cell = 0; cell < field.size; cell += 1) {
      const home = homeAt(cell);
      if (home !== 0 && home !== 1) continue;
      const holder = field.holders[cell];
      if (holder === home) continue;
      const area = areas[Math.floor(cell / field.cols)];
      ground += holder === side ? area : home === side ? -area : 0;
    }
    out[0] = ground / 1000;
    // Towns and capitals: the other's it holds less its own the other holds.
    for (const city of battle.arena?.cities ?? []) {
      const cell = Math.floor(city.y) * field.cols + Math.floor(city.x);
      if (!(cell >= 0 && cell < field.size)) continue;
      const home = homeAt(cell);
      const holder = field.holders[cell];
      if ((home !== 0 && home !== 1) || holder === home) continue;
      const sign = holder === side ? 1 : home === side ? -1 : 0;
      if (city.capital) out[2] += sign;
      else out[1] += sign * ((Number(city.population) || 0) >= 100000 ? 1.5 : 1);
    }
  }
  // Strength, troops cut off, wear, supply, works: its own less the other's (in formations, or as a mean).
  for (const [who, sign] of [[side, 1], [1 - side, -1]]) {
    let live = 0;
    let strength = 0;
    let cut = 0;
    let worn = 0;
    let fed = 0;
    let dug = 0;
    for (const troop of battle.troops[who]) {
      if (!isLive(troop)) continue;
      live += 1;
      strength += troop.strength / 100;
      if (troop.pocket) cut += troop.strength / 100;
      worn += Number(troop.fatigue) || 0;
      fed += troop.supply === undefined ? 1 : troop.supply;
      if (troop.dug) dug += 1;
    }
    out[3] += sign * strength;
    out[4] -= sign * cut;
    if (live > 0) {
      out[5] += sign * (worn / live);
      out[6] += sign * (fed / live);
      out[7] += sign * (dug / live);
    }
  }
  return out;
};
// How nearly a side's troops are surrounded: the strength of each, by how many of the eight points round it the
// other side holds beyond half (0 at four, 1 at eight).
const nearlySurrounded = (battle, side) => {
  const { field, place } = battle;
  let sum = 0;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || troop.pocket) continue;
    const reach = SURROUND_KM / place.kmAt(troop.y);
    let theirs = 0;
    for (const [cx, cy] of COMPASS) {
      const x = Math.floor(troop.x + cx * reach);
      const y = Math.floor(troop.y + cy * reach);
      if (x >= 0 && y >= 0 && x < field.cols && y < field.rows && field.holders[y * field.cols + x] === 1 - side) theirs += 1;
    }
    if (theirs > 4) sum += (troop.strength / 100) * ((theirs - 4) / 4);
  }
  return sum;
};
// What the weighing weighs, all of it: EVAL_NAMES and then LATE_EVAL_NAMES, for a side (tools/strategy-nn/values.mjs
// learns the weights from these and how wars came out).
export const valueFeatures = (battle, side) => {
  const out = new Float64Array(EVAL_NAMES.length + LATE_EVAL_NAMES.length);
  out.set(standing(battle, side), 0);
  out[EVAL_NAMES.length] = nearlySurrounded(battle, 1 - side) - nearlySurrounded(battle, side);
  return out;
};
const valueOf = (params, battle, side) => {
  const seen = standing(battle, side);
  let value = 0;
  for (let at = 0; at < EVAL_NAMES.length; at += 1) value += params[at] * seen[at];
  const late = params.length > LATE_AT ? params[LATE_AT] : LATE_EVAL[0];
  if (late !== 0) value += late * (nearlySurrounded(battle, 1 - side) - nearlySurrounded(battle, side));
  return value;
};

// How a battle stands `ahead` days after a side's orders (none: carrying on), its wings sent on `air` (as they are:
// null), against each of the other side's `answers` (null: carrying on): the worst. A step a day rehearsed.
export function* weighSteps(run, battle, side, day, ahead, params, answers, bodies, air) {
  let worst = Infinity;
  for (const answer of answers) {
    const rehearsed = rehearsal(run, battle);
    if (bodies || air) rehearseOrders(rehearsed, side, bodies ?? [], day, { air });
    if (answer) rehearseOrders(rehearsed, 1 - side, answer, day);
    // (It looks after the day's morning: the copy's first day begins from it.)
    for (let days = 0; days < ahead; days += 1) {
      if (!rehearseDay(rehearsed, day + days, { morning: days > 0 })) break;
      yield;
    }
    const value = valueOf(params, rehearsed.battle, side);
    if (value < worst) worst = value;
  }
  return worst;
}

// ---- what it decided before -----------------------------------------------------------------
// A time skip fights its period twice, before its story is written and again as it is applied
// (Game/AI/frontApply.js), and the second time is the first again: "cant you make it do both on the same run?" (the
// owner, 2026-10-15). A staff given a `memo` keeps what it decided at each look, by the run's key for that look
// (engine.js: the run, the battle, the side, the day) and a print of the battle as it stood, and has it again rather
// than thinking it all through a second time. A battle that stands otherwise is thought about afresh.
export const MEMO_MOST = 4000;
const FNV_PRIME = 16777619;
const stir = (hash, value) => Math.imul(hash ^ (Math.round((Number(value) || 0) * 4096) | 0), FNV_PRIME) >>> 0;
const stirWord = (hash, word) => {
  let out = hash;
  const text = typeof word === "string" ? word : "";
  for (let at = 0; at < text.length; at += 1) out = Math.imul(out ^ text.charCodeAt(at), FNV_PRIME) >>> 0;
  return Math.imul(out ^ 255, FNV_PRIME) >>> 0;
};
// A battle as it stands, in a word: every troop of both sides (where it stands, how strong, dug in, how worn, what
// it is doing), the orders standing, and who holds each cell.
export const battlePrint = (battle) => {
  let hash = stir(stir(2166136261, battle.daysRun), Array.isArray(battle.orders) ? battle.orders.length : 0);
  for (const list of battle.troops) {
    hash = stir(hash, list.length);
    for (const troop of list) {
      hash = stir(stir(stir(stir(hash, troop.x), troop.y), troop.strength), troop.dig);
      hash = stir(stir(stir(stir(hash, troop.state), troop.hx), troop.hy), troop.fatigue);
      hash = stir(stir(hash, troop.dug ? 1 : 0), troop.serves);
      const order = troop.order;
      hash = order && !order.done ? stir(stir(stirWord(stirWord(hash, order.kind), order.word), order.leg), order.since) : stir(hash, -1);
    }
  }
  const holders = battle.field?.holders;
  if (holders) for (let cell = 0; cell < holders.length; cell += 1) hash = Math.imul(hash ^ holders[cell], FNV_PRIME) >>> 0;
  return hash.toString(36);
};
const lookKey = (battle, side, key) => `${key}|${side}|${battlePrint(battle)}`;
const keep = (memo, key, answer) => {
  if (memo.size >= MEMO_MOST) memo.delete(memo.keys().next().value);
  memo.set(key, structuredClone(answer));
};
// A look's steps taken one after another, to what it decided.
export const drain = (steps) => {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

// One of a look's plans fought on the battle and run another core rebuilt (engine.js rehearsalBase; rehearsers.js):
// its value as the staff's own weighing has it, or null where a copy was asked what it was not told.
//   look   { side, day, ahead, params, answers } of the look; job { bodies, air } of the plan
export const weighRebuilt = (base, look, job) => {
  const before = base.missed.count;
  const value = drain(weighSteps(base.run, base.battle, look.side, look.day, look.ahead, look.params, look.answers, job?.bodies ?? null, job?.air ?? null));
  return base.missed.count === before ? value : null;
};

// ---- the staff ----------------------------------------------------------------------------
//   params    PLAN_PARAMS weights (plainPlanner() to begin with)
//   look      how often it looks, in days (LOOK_DAYS); ahead, how far it looks (AHEAD_DAYS)
//   plans     which of PLAN_NAMES it may choose among (all of them)
//   refine    how many of the largest bodies of the plan it chose it then
//             tries told otherwise, one at a time (turned above), keeping
//             each change that leaves the battle better (REFINE_BODIES)
//   replies   whether each plan is weighed against the other side's answers
//             to it (REPLIES: carrying on, pushing everywhere, digging in
//             everywhere) and by the worst of them, rather than against its
//             carrying on only: what a chess engine does with a move
//   tally     (name of the plan chosen) => anything, for whoever counts
export const REFINE_BODIES = 4;
// THE PLAINER COMMANDER, for a side its war is meant to lose (a scenario's designer or the story said so: trained.js
// labStaffPolicy): "a below average performing model for war that still acts realistically for scripted wars that
// are meant to be lost" (the owner, 2026-10-15). The same staff, looking less often and less far, at fewer plans,
// with the plain weighing and its wings left on support: a cautious commander who carries on, pushes or digs in,
// and is never a fool. Nothing is decided for it ("depending on player actions in war, it should be possible for
// the opposite to happen too"): a side that fights it badly still loses to it.
export const PLAINER_PLANS = Object.freeze([0, 4, 5]);
export const PLAINER_PLANNER = Object.freeze({ look: 12, ahead: 2, refine: 0, airControl: false });
export const REPLIES = Object.freeze(["carry on", "push", "dig in"]);
//   airControl  whether it sends its wings on missions (air.js AIR_MISSIONS), or leaves them on support
//   observe   (battle, side) => anything, at each of its looks, before it plans: for whoever is watching
//   late      the later weighing's weights in place of those in `params` (to weigh without them: [0])
//   memo      a Map to keep what it decided at each look in, and have it again at a look just like it (lookKey)
export const createPlanner = ({ params: given = plainPlanner(), look = LOOK_DAYS, ahead = AHEAD_DAYS, plans = null, refine = REFINE_BODIES, replies = false, airControl = true, late = null, observe = null, tally = null, memo = null } = {}) => {
  const params = withLateEval(given);
  if (Array.isArray(late)) late.forEach((value, at) => { params[LATE_AT + at] = Number(value) || 0; });
  const allowed = plans ? new Set(plans) : null;
  // A look, as steps it may be stopped between (one a day it rehearses): the engine takes it so where a run is played
  // out in slices (Game/AI/frontTurn.js runFrontTurn), and the page is drawn between them: "its SOO LAGGY while in
  // war" (the owner, 2026-10-15). A look at a battle on a day it was looked at before, standing just as it stood
  // then, has what was decided then (memo).
  function* think(battle, side, context = {}, run = null) {
    if (!run) return undefined;
    if (battle.daysRun > 0 && battle.daysRun % look !== 0) return { keep: true };
    const key = memo && context?.key ? lookKey(battle, side, context.key) : "";
    if (key && memo.has(key)) return structuredClone(memo.get(key));
    const answer = yield* decide(battle, side, run);
    if (key) keep(memo, key, answer);
    return answer;
  }
  function* decide(battle, side, run) {
    if (typeof observe === "function") observe(battle, side);
    const view = troopView(battle, side);
    if (view.rows.length === 0) return { keep: true };
    for (const row of view.rows) row.troop = battle.troops[side][row.index];
    const drawn = drawPlans(battle, params, view, plannerFeatures(battle, side, view));
    const day = run.day + 1;
    // The other side's answers, as orders for all its troops (carrying on: none).
    const theirs = battle.troops[1 - side].map((troop, index) => (isLive(troop) ? index : -1)).filter((index) => index >= 0);
    const answers = replies && theirs.length > 0
      ? REPLIES.map((word) => (word === "push" ? [{ order: "advance", picked: theirs }] : word === "dig in" ? [{ order: "dig in", picked: theirs }] : null))
      : [null];
    // How a battle stands `ahead` days after these orders (none: carrying on), its wings sent on `air` (as they
    // are: null): against each answer, the worst. Orders already weighed at this look (two plans that came to the
    // same orders, a body turned back to what another plan had it doing) are not fought out again: a rehearsal
    // touches nothing another sees (engine.js rehearsal), and the same orders on the same battle come out the same.
    const weighed = new Map();
    const saidOf = (bodies, air) => `${air ?? ""}|${bodies ? JSON.stringify(bodies) : "carry on"}`;
    function* weigh(bodies, air = null) {
      const said = saidOf(bodies, air);
      if (weighed.has(said)) return weighed.get(said);
      const worst = yield* weighSteps(run, battle, side, day, ahead, params, answers, bodies, air);
      weighed.set(said, worst);
      return worst;
    }
    // Plans weighed together on other cores, where the run has them (rehearsers.js: "do the multi-core rehearsals
    // too", the owner, 2026-10-16): [bodies, air] each. The look waits for them as a step of its own ({ wait }),
    // and whatever they did not have is weighed here as it comes (weigh above), as it all is where nobody waits
    // (engine.js advance): the same values either way, so the same orders.
    const rehearsers = typeof run.input?.rehearsers?.weigh === "function" ? run.input.rehearsers : null;
    let look = null;
    function* weighTogether(list) {
      if (!rehearsers || look === false) return;
      const jobs = [];
      const saids = [];
      for (const [bodies, air] of list) {
        const said = saidOf(bodies, air);
        if (weighed.has(said) || saids.includes(said)) continue;
        saids.push(said);
        jobs.push({ bodies, air });
      }
      if (jobs.length < 2) return;
      if (look === null) {
        try {
          look = { packet: rehearsalPacket(run, battle), side, day, ahead, params, answers };
        } catch {
          look = false;
          return;
        }
      }
      const values = yield { wait: () => rehearsers.weigh(look, jobs) };
      if (!Array.isArray(values)) return;
      saids.forEach((said, at) => {
        if (typeof values[at] === "number") weighed.set(said, values[at]);
      });
    }
    let chosen = -1;
    let best = -Infinity;
    let orders = null;
    const drawnPlans = [];
    for (let plan = 0; plan < PLAN_NAMES.length; plan += 1) {
      if (allowed && !allowed.has(PLAN_NAMES[plan])) continue;
      const keys = plan === 0 ? null : drawn[plan - 1];
      if (plan > 0 && !keys) continue;
      drawnPlans.push({ plan, bodies: keys ? bodiesOf(battle, view, keys) : null });
    }
    yield* weighTogether(drawnPlans.map(({ bodies }) => [bodies, null]));
    for (const { plan, bodies } of drawnPlans) {
      const value = yield* weigh(bodies);
      if (value > best) {
        best = value;
        chosen = plan;
        orders = bodies;
      }
    }
    // The plan chosen, bettered a body at a time: the largest first.
    if (orders && refine > 0) {
      const largest = orders.map((body, at) => ({ at, size: body.picked.length })).sort((a, b) => b.size - a.size || a.at - b.at).slice(0, refine);
      for (let index = 0; index < largest.length; index += 1) {
        const other = turned(orders, largest[index].at);
        if (!other) continue;
        // (This and those after it, each turned from the plan as it stands, weighed together: one that betters the
        // plan changes it, and those after it are weighed again.)
        if (!weighed.has(saidOf(other, null))) yield* weighTogether(largest.slice(index).map(({ at }) => [turned(orders, at), null]).filter(([bodies]) => bodies));
        const value = yield* weigh(other);
        if (value > best) {
          best = value;
          orders = other;
        }
      }
    }
    // Its wings over the battle (air.js): sent on whichever mission leaves the battle best, with the orders chosen.
    let air = null;
    if (airControl && (run.airOver?.get(battle)?.[side]?.length ?? 0) > 0) {
      const missions = AIR_MISSIONS.filter((mission) => mission !== airMissionOf(battle, side));
      yield* weighTogether(missions.map((mission) => [orders, mission]));
      for (const mission of missions) {
        const value = yield* weigh(orders, mission);
        if (value > best) {
          best = value;
          air = mission;
        }
      }
    }
    if (typeof tally === "function" && chosen >= 0) tally(PLAN_NAMES[chosen]);
    if (chosen <= 0 || !orders) return air ? { keep: true, air } : { keep: true };
    // What the plan is, and where most of those it sends forward are going: for the record (engine.js
    // noteStaffPlan), which the other side's agents and aircraft may find out (GameUI/warRoom.jsx).
    const aim = aimOf(orders);
    const told = { troops: orders, plan: PLAN_NAMES[chosen], ...(aim ? { aim } : {}) };
    return air ? { ...told, air } : told;
  }
  const policy = (battle, side, context = {}, run = null) => drain(think(battle, side, context, run));
  policy.steps = think;
  policy.often = true;
  return policy;
};

// The plainer commander (PLAINER_PLANNER), with the plain weighing.
export const createPlainerPlanner = (extra = {}) => createPlanner({ params: plainPlanner(), ...PLAINER_PLANNER, plans: PLAINER_PLANS.map((at) => PLAN_NAMES[at]), ...extra });
