/*! Open Historia — battlefields and fronts: where a side's new troops come in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so you can draw a line of where reinforcements are to get deployed
// in the war room" (the owner, 2026-10-15).
//
// A country's DEPLOYMENT LINE on a battlefield is drawn in the war room
// (GameUI/warRoom.jsx; the op "deploy", warRoomOps.js) and kept in the
// battlefield's brief.carry.deploy, a list a side of { country, way }: one
// line a country, a side's own as its plans are. Its new troops on
// that battlefield come in on it: the levies it musters (engine.js
// musterDay), a draft or a reinforcement of its own (reinforceOnFront), and
// its troops when it joins the battle (raiseFor). They stand on ground their
// side holds along the line, each point of it the nearest such cell within
// DEPLOY_REACH_KM, spread evenly from one end to the other; where their side
// holds none along it they come in on their own stretch of the front, as a
// country with no line does.
//
// "using the deploy tool should give the option to do a front or swarm" (the
// owner, 2026-10-16). A deployment may instead be a SWARM's: one place, kept as
// { country, way: [[lng, lat]], form: "swarm" }. Its country's new troops come
// in there as a swarm under a general of their own, and join the swarm that
// gathered there before while it is still near (swarms.js gatherNewcomers).
//
// "the deployment tool in the war room doesnt seem to work. it does draw the
// line, but the troops are never actually deployed" (the owner, 2026-10-24).
// A deployment drawn also CALLS UP fresh formations there: `call` on it,
// DEPLOY_USUAL. How many is the country's to say, not the player's ("remove the
// thing to select how many troops": the owner, 2026-11-02): engine.js
// callUpSize, by the men it has left, its supplies, its war weariness and how
// fast it musters. When time next passes they are drafted as for an
// order for more troops (engine.js callUpDeployed, reinforceOnFront), with the
// men it has left and the room its line has (never held to what its strength
// usually raises, as the story's drafts are), and `last` on it says what came
// of it: { n, why, d }, how
// many came in, why none did (DEPLOY_WHY), and on what day. A deployment drawn
// with a call of 0 only moves where new troops come in.
//
// Only + - * / and comparisons.

import { HOLDER_SIDE_A, HOLDER_SIDE_B, MAX_WAY_POINTS, REINFORCE_MOST } from "./constants.js";

// (A deployment's form, as swarms.js names it: a line unless it says a swarm.)
const SWARM = "swarm";

// How far from the line drawn a new troop may stand, and the most points a line keeps.
export const DEPLOY_REACH_KM = 40;
export const DEPLOY_WAY_MOST = MAX_WAY_POINTS * 4;

// A call-up of as many formations as a draft of its country's usually brings (engine.js reinforceOnFront).
export const DEPLOY_USUAL = "usual";
// Why a call-up brought nobody, by what the engine noted: no men left to call up, no room on the battlefield, none of
// its side's ground to stand on, the fighting halted, its country no longer on the battlefield.
export const DEPLOY_WHY = Object.freeze({
  "reinforce-no-men": "men",
  "reinforce-full": "full",
  "reinforce-no-ground": "ground",
  "reinforce-halted": "halted",
  "side-not-fighting": "side",
});
const WHY_WORDS = Object.values(DEPLOY_WHY);

// A call-up as it is kept: DEPLOY_USUAL, a number of formations 1 to REINFORCE_MOST, or undefined for none.
export const readCall = (value) => {
  if (value === DEPLOY_USUAL) return DEPLOY_USUAL;
  const count = Math.round(Number(value));
  if (!Number.isFinite(count) || count < 1) return undefined;
  return count > REINFORCE_MOST ? REINFORCE_MOST : count;
};

// What came of the last call-up, as it is kept, or undefined.
const readLast = (value) => {
  if (!value || typeof value !== "object") return undefined;
  const n = Math.round(Number(value.n));
  if (!Number.isFinite(n) || n < 0) return undefined;
  const why = WHY_WORDS.includes(value.why) ? value.why : "";
  return { n, why, d: clean(value.d, 40) };
};

// An entry with its call-up and what came of the last, where it has them.
const withCall = (entry, call, last) => ({ ...entry, ...(call !== undefined ? { call } : {}), ...(last ? { last } : {}) });

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const isSide = (side) => side === HOLDER_SIDE_A || side === HOLDER_SIDE_B;

// A line as it is kept: [lng, lat] points, rounded, at most DEPLOY_WAY_MOST of them (thinned evenly, ends kept).
const readWay = (value) => {
  const way = [];
  for (const point of Array.isArray(value) ? value : []) {
    const lng = Number(Array.isArray(point) ? point[0] : NaN);
    const lat = Number(Array.isArray(point) ? point[1] : NaN);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat > 90 || lat < -90) continue;
    way.push([Math.round(lng * 10000) / 10000, Math.round(lat * 10000) / 10000]);
  }
  if (way.length <= DEPLOY_WAY_MOST) return way;
  const kept = [];
  for (let index = 0; index < DEPLOY_WAY_MOST; index += 1) kept.push(way[Math.round((index * (way.length - 1)) / (DEPLOY_WAY_MOST - 1))]);
  return kept;
};

// The deployments of a record's carry, a list a side, checked: a country once a side. A line has two points or
// more; a swarm's place is one, and says so.
export const readDeploy = (value) => [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
  const kept = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) && Array.isArray(value[side]) ? value[side] : []) {
    const country = clean(raw?.country, 120);
    const swarm = raw?.form === SWARM;
    const way = swarm ? readWay(raw?.way).slice(0, 1) : readWay(raw?.way);
    if (!country || seen.has(fold(country)) || way.length < (swarm ? 1 : 2)) continue;
    seen.add(fold(country));
    kept.push(withCall(swarm ? { country, way, form: SWARM } : { country, way }, readCall(raw?.call), readLast(raw?.last)));
  }
  return kept;
});

// Whether any side keeps a line.
export const hasDeploy = (deploy) => Array.isArray(deploy) && deploy.some((list) => Array.isArray(list) && list.length > 0);

const carryOf = (record) => (record?.brief && typeof record.brief.carry === "object" && record.brief.carry ? record.brief.carry : {});

// A side's deployment lines on a record.
export const deployLinesOf = (record, side) => (isSide(side) ? readDeploy(carryOf(record).deploy)[side] : []);

// A record with a country's deployment line drawn (or, with a way of fewer than two points, taken off). With
// `form: "swarm"`, its swarm's place: the first point of the way (none takes it off). It calls up `call`
// formations there when time next passes (readCall: DEPLOY_USUAL, a number, or none).
export const withDeployLine = (record, side, { country, way, form = "", call } = {}) => {
  const name = clean(country, 120);
  if (!record || !isSide(side) || !name) return record;
  const deploy = readDeploy(carryOf(record).deploy);
  const swarm = form === SWARM;
  const line = swarm ? readWay(way).slice(0, 1) : readWay(way);
  const others = deploy[side].filter((entry) => fold(entry.country) !== fold(name));
  const drawn = swarm ? { country: name, way: line, form: SWARM } : { country: name, way: line };
  deploy[side] = line.length >= (swarm ? 1 : 2) ? [...others, withCall(drawn, readCall(call))] : others;
  const carry = { ...carryOf(record) };
  if (hasDeploy(deploy)) carry.deploy = deploy;
  else delete carry.deploy;
  return { ...record, brief: { ...record.brief, carry } };
};

// Where a member's new troops on a battle stand: on its deployment line, where its side holds ground along it,
// as cells in order from one end of the line to the other; otherwise `cells` as they were.
export const deployCells = (battle, side, member, cells) => {
  const lines = Array.isArray(battle.deploy) && Array.isArray(battle.deploy[side]) ? battle.deploy[side] : [];
  // (A swarm's place is no line: its troops come in as any do, and gather there, swarms.js gatherNewcomers.)
  const line = lines.find((entry) => fold(entry.country) === fold(member) && entry.form !== SWARM);
  if (!line) return cells;
  const { field, place } = battle;
  const { cols, rows } = field;
  const reach = Math.max(1, Math.round(DEPLOY_REACH_KM / battle.frame.km));
  const out = [];
  const seen = new Set();
  const take = (x, y) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let best = -1;
    let bestAt = reach * reach + 1;
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const gx = cx + dx;
        const gy = cy + dy;
        const far = dx * dx + dy * dy;
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows || far >= bestAt) continue;
        const cell = gy * cols + gx;
        if (field.holders[cell] !== side) continue;
        best = cell;
        bestAt = far;
      }
    }
    if (best >= 0 && !seen.has(best)) {
      seen.add(best);
      out.push(best);
    }
  };
  const points = line.way.map(([lng, lat]) => place.toCell(lng, lat));
  for (let at = 1; at < points.length; at += 1) {
    const [ax, ay] = points[at - 1];
    const [bx, by] = points[at];
    const steps = Math.max(1, Math.floor(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))) + 1);
    for (let step = at === 1 ? 0 : 1; step <= steps; step += 1) take(ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps);
  }
  return out.length > 0 ? out : cells;
};
