/*! Open Historia — planned movements on a battlefield: what a side means to do, drawn before it is done © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A PLAN is a movement a side means to make and has not made yet: an arrow on
// the war room's map (GameUI/warRoom.jsx). A side's plans come from four
// places, and each plan says which in `kind`:
//
//   order      a standing order: an attack at a place, or along the line,
//              whoever gave it (the campaign's orders, or a general in the
//              war room);
//   route      a route the player drew for troops he picked out;
//   project    an Operation on the Board that sends troops at a place on this
//              battlefield (runtime/projects.js). Its arrow is the way the
//              troops nearest would take, and the player may redraw it;
//   diversion  a movement drawn to be stolen and never made.
//
// A plan is a movement STILL TO BE MADE. Once days of fighting have passed
// over an order it is no longer that but a movement being made: the plan says
// so (`begun`), and the war room's map stops drawing its arrow, since what
// the troops are doing is on the map already. A route that its troops have
// come to the end of, an order whose place has been taken and an operation
// that was sent and is over are not plans at all any more; a diversion is
// taken off by the engine when a period has passed over it (battle.js).
//
// The first three are worked out from the record and the Board whenever they
// are wanted: nothing of them is kept but what the player changed of a Board
// operation's arrow (redrawn, or told to move nothing). Diversions are kept,
// since nothing else says them. Both are in brief.carry.plans, a list a side:
//
//   { id: "d3", kind: "diversion", way: [[lng, lat]...], troops, at }
//   { id: "project:<its id>", kind: "project", project, way?, off?, sent?, at }
//
// What one side KNOWS of the other's plans is espionage's to say
// (runtime/spycraft.js): an agent alive in a country of the other side sends
// its real plans; an agent that has been TURNED sends what it is fed, which is
// the other side's diversions; and nothing in what arrives says which it is.
// A side with no double agent in its hands has nobody to tell a diversion to.
//
// Everything here is pure and runs in bare node: the war room reads it to
// draw, the turn reads it to carry out (AI/frontPlans.js).

import { decodeTroops } from "./codec.js";
import { chosenOrdersOf, generalsOf, orderTroops, releaseMarked, routeAhead, thinRoute } from "./command.js";
import {
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  MAX_PLANS_PER_SIDE,
  MAX_TROOPS_PER_SIDE,
  MAX_WAY_POINTS,
  PLAN_PLACE_KM,
  PLAN_REACH_KM,
  PLAN_STANDOFF_KM,
  THRUST_LEAST,
  THRUST_SHARE,
  THRUST_TROOPS,
  WATCH_KM,
  WATCH_SHARE,
  WATCH_TROOPS_MOST,
} from "./constants.js";
import { pointInFrame, projectorOf } from "./frame.js";
import { holderAt } from "./record.js";

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
// A name as it is looked for in a sentence: small letters, no accents.
const plain = (value) => clean(value, 4000).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isSide = (side) => side === HOLDER_SIDE_A || side === HOLDER_SIDE_B;
const live = (troop) => troop.strength > 0;
const carryOf = (record) => (record?.brief && typeof record.brief.carry === "object" && record.brief.carry ? record.brief.carry : {});

export const ATTACK_WORDS = Object.freeze(["advance", "blitz", "spearhead", "flank", "encircle"]);
const isAttack = (word) => ATTACK_WORDS.includes(word);
export const PROJECT_MARK = "plan:";
export const WATCH_MARK = "watch";

// ---- what is kept --------------------------------------------------------------------

const readWay = (value) => {
  const way = [];
  for (const point of Array.isArray(value) ? value : []) {
    const lng = Number(Array.isArray(point) ? point[0] : NaN);
    const lat = Number(Array.isArray(point) ? point[1] : NaN);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    way.push([Math.round(lng * 10000) / 10000, Math.round(lat * 10000) / 10000]);
  }
  return way.length > MAX_WAY_POINTS ? thinRoute(way, MAX_WAY_POINTS) : way;
};

// The kept plans of a record, a list a side, checked.
export const readPlans = (value) => [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
  const kept = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) && Array.isArray(value[side]) ? value[side] : []) {
    if (!raw || typeof raw !== "object") continue;
    const way = readWay(raw.way);
    const at = clean(raw.at, 40);
    if (raw.kind === "diversion") {
      const id = clean(raw.id, 24);
      if (!id || seen.has(id) || way.length < 2) continue;
      seen.add(id);
      kept.push({ id, kind: "diversion", way, troops: Math.max(1, Math.min(MAX_TROOPS_PER_SIDE, Math.round(Number(raw.troops) || 0) || 1)), at });
    } else if (raw.kind === "project") {
      const project = clean(raw.project, 160);
      const id = `project:${project}`;
      if (!project || seen.has(id)) continue;
      seen.add(id);
      const entry = { id, kind: "project", project, at };
      if (way.length >= 2) entry.way = way;
      if (raw.off === true) entry.off = true;
      if (raw.sent === true) entry.sent = true;
      // An entry that says nothing is not kept.
      if (entry.way || entry.off || entry.sent) kept.push(entry);
    }
    if (kept.length >= MAX_PLANS_PER_SIDE) break;
  }
  return kept;
});

export const keptPlansOf = (record, side) => (isSide(side) ? readPlans(carryOf(record).plans)[side] : []);

const withKept = (record, side, list) => {
  const plans = readPlans(carryOf(record).plans);
  plans[side] = readPlans(side === HOLDER_SIDE_A ? [list, []] : [[], list])[side];
  return { ...record, brief: { ...record.brief, carry: { ...carryOf(record), plans } } };
};

// A record with a diversion drawn for a side: a way, and how many troops it is
// to look like. Unchanged when there is no way to it or no room for another.
export const withDiversion = (record, side, { way, troops = 0, at = "" } = {}) => {
  if (!record || !isSide(side)) return record;
  const route = readWay(way);
  if (route.length < 2) return record;
  const kept = keptPlansOf(record, side);
  if (kept.length >= MAX_PLANS_PER_SIDE) return record;
  let serial = 1;
  while (kept.some((plan) => plan.id === `d${serial}`)) serial += 1;
  const count = Math.round(Number(troops) || 0) || THRUST_TROOPS.spearhead;
  return withKept(record, side, [...kept, { id: `d${serial}`, kind: "diversion", way: route, troops: count, at: clean(at, 40) }]);
};

// A record with what the player changed of a Board operation's arrow:
//   way   the arrow redrawn (null leaves it as it was, [] puts back the suggested one)
//   off   true: the operation moves nothing here; false: it does again
// A redrawn arrow is carried out afresh, whatever was sent before.
export const withProjectPlan = (record, side, { project, way = null, off = null, sent = null, at = "" } = {}) => {
  const wanted = clean(project, 160);
  if (!record || !isSide(side) || !wanted) return record;
  const kept = keptPlansOf(record, side);
  const id = `project:${wanted}`;
  const before = kept.find((plan) => plan.id === id) ?? { id, kind: "project", project: wanted };
  const entry = { ...before, at: clean(at, 40) || before.at || "" };
  if (Array.isArray(way)) {
    const route = readWay(way);
    if (route.length >= 2) entry.way = route;
    else delete entry.way;
    delete entry.sent;
  }
  if (off === true) entry.off = true;
  if (off === false) delete entry.off;
  if (sent === true) entry.sent = true;
  if (sent === false) delete entry.sent;
  const others = kept.filter((plan) => plan.id !== id);
  if (!entry.way && !entry.off && !entry.sent) return withKept(record, side, others);
  if (!kept.some((plan) => plan.id === id) && others.length >= MAX_PLANS_PER_SIDE) return record;
  return withKept(record, side, [...others, entry]);
};

export const withoutPlan = (record, side, id) => {
  if (!record || !isSide(side)) return record;
  const kept = keptPlansOf(record, side);
  const left = kept.filter((plan) => plan.id !== clean(id, 180));
  return left.length === kept.length ? record : withKept(record, side, left);
};

// ---- the ground a plan is drawn on --------------------------------------------------

// A side's troops as the record has them, in cell units, the dead left out of
// every reckoning but kept in their places.
const troopsOf = (record) => [decodeTroops(record.troops?.[0]), decodeTroops(record.troops?.[1])];

const middleOf = (list, indexes) => {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const index of indexes) {
    const troop = list[index];
    if (!troop || !live(troop)) continue;
    x += troop.x;
    y += troop.y;
    count += 1;
  }
  return count > 0 ? [x / count, y / count] : null;
};

// The `count` live troops of a list nearest a point (in cell units), nearest first.
const nearestTo = (list, x, y, count, skip = null) => {
  const found = [];
  list.forEach((troop, index) => {
    if (!live(troop) || (skip && skip.has(index))) return;
    const dx = troop.x - x;
    const dy = troop.y - y;
    found.push([dx * dx + dy * dy, index]);
  });
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return found.slice(0, Math.max(0, count)).map((entry) => entry[1]);
};

// How many troops an attack of this kind takes of a side that has `have`.
const thrustCount = (word, have) => Math.max(Math.min(have, THRUST_LEAST), Math.min(THRUST_TROOPS[word] ?? THRUST_TROOPS.advance, Math.floor(have * THRUST_SHARE)));

const parsePlace = (value) => {
  const text = clean(value);
  const marked = /^(city|region)\s*:\s*(.+)$/i.exec(text);
  return marked ? { kind: marked[1].toLowerCase(), name: clean(marked[2]) } : { kind: "", name: text };
};

// A city of the battlefield by its name, or null. `cities` as the engine is
// given them: [{ name, lng, lat, population, capital }].
const cityNamed = (record, cities, value) => {
  const { kind, name } = parsePlace(value);
  if (!name || kind === "region") return null;
  const wanted = fold(name);
  return (Array.isArray(cities) ? cities : []).find((city) => fold(city?.name) === wanted && pointInFrame(record.frame, Number(city.lng), Number(city.lat))) ?? null;
};

// The city nearest a point within `withinKm`, or null.
const cityNear = (record, cities, lng, lat, withinKm) => {
  const { toCell, kmAt } = projectorOf(record.frame);
  const [x, y] = toCell(lng, lat);
  let best = null;
  let bestKm = withinKm;
  for (const city of Array.isArray(cities) ? cities : []) {
    if (!clean(city?.name) || !pointInFrame(record.frame, Number(city.lng), Number(city.lat))) continue;
    const [cx, cy] = toCell(Number(city.lng), Number(city.lat));
    const km = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y)) * kmAt((cy + y) / 2);
    if (km <= bestKm) {
      bestKm = km;
      best = city;
    }
  }
  return best;
};

// The ways an attack of one kind would take from a point to a place, in cell
// units: one arrow, or the two columns of an encirclement, which pass either
// side of the place and close behind it.
const suggestedWays = (record, word, from, to) => {
  const { kmAt } = projectorOf(record.frame);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!(length > 0)) return [[from, to]];
  const ux = dx / length;
  const uy = dy / length;
  const off = PLAN_STANDOFF_KM / Math.max(1e-6, kmAt(to[1]));
  const round = (sign) => [
    from,
    [to[0] - ux * off * 0.6 - uy * sign * off, to[1] - uy * off * 0.6 + ux * sign * off],
    [to[0] + ux * off * 0.9 - uy * sign * off * 0.55, to[1] + uy * off * 0.9 + ux * sign * off * 0.55],
    [to[0] + ux * off, to[1] + uy * off],
  ];
  if (word === "encircle" && length > off * 1.2) return [round(1), round(-1)];
  if (word === "flank" && length > off * 1.2) return [round(1).slice(0, 3)];
  return [[from, to]];
};

const lngLatWays = (record, ways) => {
  const { toLngLat } = projectorOf(record.frame);
  return ways.map((way) => way.map(([x, y]) => {
    const [lng, lat] = toLngLat(x, y);
    return [Math.round(lng * 10000) / 10000, Math.round(lat * 10000) / 10000];
  }));
};

// Which way a body of troops faces: toward the other side's troops nearest it.
const facing = (record, decoded, side, from) => {
  const { kmAt } = projectorOf(record.frame);
  const near = nearestTo(decoded[1 - side], from[0], from[1], 12);
  const to = middleOf(decoded[1 - side], near);
  if (!to) return null;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!(length > 0)) return null;
  const reach = PLAN_REACH_KM / Math.max(1e-6, kmAt(from[1]));
  return [from[0] + (dx / length) * reach, from[1] + (dy / length) * reach];
};

// ---- a side's plans ------------------------------------------------------------------

// The standing orders of a side as plans: each attack an arrow (or two), each
// order that keeps troops where they are a plan with no arrow to it.
const orderPlans = (record, side, cities, decoded) => {
  const { toCell } = projectorOf(record.frame);
  const under = Array.isArray(carryOf(record).under?.[side]) ? carryOf(record).under[side] : [];
  const ages = Array.isArray(carryOf(record).ages) ? carryOf(record).ages : [];
  const have = decoded[side].filter(live).length;
  const plans = [];
  (Array.isArray(record.orders) ? record.orders : []).forEach((order, index) => {
    if (order.s !== side || order.mark === WATCH_MARK) return;
    let picked = [];
    under.forEach((serves, troop) => {
      if (serves === index && decoded[side][troop] && live(decoded[side][troop])) picked.push(troop);
    });
    // An order for troops picked out that none of them serves is over.
    if (order.chosen && picked.length === 0) return;
    const word = order.order;
    const plan = {
      id: `order:${index}`,
      kind: Array.isArray(order.way) && order.way.length > 0 ? "route" : "order",
      side,
      order: word,
      objective: clean(order.objective),
      name: "",
      by: clean(order.by),
      sector: order.chosen ? "" : clean(order.sector),
      chosen: order.chosen === true,
      mark: clean(order.mark),
      // Days of fighting have passed over it: a movement being made, and no
      // longer one still to be made.
      begun: Number(ages[index]) > 0,
      // The countries outside the war a route goes into (invade.js), once the
      // engine has read them: sending troops along it attacks them.
      attacks: Array.isArray(order.attacks) ? order.attacks.map((name) => clean(name)).filter(Boolean) : [],
      ways: [],
    };
    if (plan.kind === "route") {
      // From where its troops stand, along what was drawn; and once they are
      // on it, only what is left of it: from the point the middle one of them
      // is making for (the record says which), or failing that from the place
      // on it nearest them.
      const from = middleOf(decoded[side], picked);
      const route = order.way.map(([lng, lat]) => toCell(lng, lat));
      let left = route;
      if (plan.begun && from) {
        const making = picked.map((troop) => Number(carryOf(record).next?.[side]?.[troop])).filter((point) => Number.isInteger(point) && point >= 0).sort((a, b) => a - b);
        left = making.length > 0 ? route.slice(Math.min(route.length - 1, making[Math.floor(making.length / 2)])) : routeAhead(route, from[0], from[1]);
      }
      plan.ways = lngLatWays(record, [from ? [from, ...left] : left]);
    } else if (isAttack(word)) {
      const city = plan.objective ? cityNamed(record, cities, plan.objective) : null;
      // The place is the side's already: the movement has been made.
      if (city && holderAt(record, Number(city.lng), Number(city.lat)) === side) return;
      if (city) {
        const to = toCell(Number(city.lng), Number(city.lat));
        // An order for a stretch of line that nobody is carrying out yet: the
        // troops nearest its place are the ones it will take.
        if (picked.length === 0) picked = nearestTo(decoded[side], to[0], to[1], thrustCount(word, have));
        const from = middleOf(decoded[side], picked);
        if (from) plan.ways = lngLatWays(record, suggestedWays(record, word, from, to));
      } else if (!plan.objective) {
        // The line itself going forward: an arrow a general, the way his troops
        // face (and one arrow for a body of troops picked out).
        const serving = new Set(picked);
        const commands = generalsOf(record, side).map((general) => (picked.length > 0 ? general.troops.filter((troop) => serving.has(troop)) : general.troops)).filter((body) => body.length > 0);
        const bodies = order.chosen || commands.length === 0 ? [picked] : commands;
        const ways = [];
        for (const body of bodies) {
          const from = middleOf(decoded[side], body);
          const to = from ? facing(record, decoded, side, from) : null;
          if (to) ways.push([from, to]);
        }
        if (picked.length === 0) picked = bodies.flat();
        plan.ways = lngLatWays(record, ways);
      }
    }
    plan.picked = picked;
    plan.troops = picked.length;
    plans.push(plan);
  });
  return plans;
};

// What an operation's words say its troops are to do. The Board is written in
// the language of the game, so a sentence in another language says nothing
// here and the operation is an advance on its place: which it is.
const ORDER_HINTS = Object.freeze([
  ["encircle", /\b(encircl\w*|surround\w*|besieg\w*|envelop\w*|pincer\w*|cut(?:ting)? off)\b/],
  ["flank", /\b(out)?flank\w*\b/],
  ["blitz", /\b(blitz\w*|lightning (?:war|attack|offensive|advance))\b/],
  ["spearhead", /\b(spearhead\w*|break ?through\w*|armou?red thrust|thrust\w*)\b/],
]);
const orderHint = (text) => {
  for (const [word, pattern] of ORDER_HINTS) if (pattern.test(text)) return word;
  return "advance";
};

const letter = /\p{L}/u;
// Whether a name stands in a sentence as a word of its own.
const namedIn = (text, name) => {
  if (name.length < 3) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(name, from);
    if (at < 0) return false;
    const before = at > 0 ? text[at - 1] : " ";
    const after = at + name.length < text.length ? text[at + name.length] : " ";
    if (!letter.test(before) && !letter.test(after)) return true;
    from = at + 1;
  }
};

const OPEN_STATUSES = Object.freeze(["proposed", "active", "stalled", "paused"]);

// The Board's operations that send a side's troops at a place on this
// battlefield, each with the place:
//   { project, name, by, status, due, order, place: { name, lng, lat }, doubted, secrecy }
// An operation is one of these when it is open, belongs to a member of the
// side (an entry with no owner is the player's own), runs no agent, and either
// gives a point on ground the other side holds here or names a city of this
// battlefield that the other side holds.
// `people`: the countries and groups people play, where there is more than
// the one `player`: an operation of any of them is somebody's own.
export const operationsOn = ({ record, side, projects, cities, player = "", people = [] } = {}) => {
  if (!record || !isSide(side)) return [];
  const members = (record.sides?.[side] ?? []).map(fold);
  const own = new Set([fold(player), ...(Array.isArray(people) ? people : []).map(fold)].filter(Boolean));
  const held = [];
  for (const city of Array.isArray(cities) ? cities : []) {
    const name = clean(city?.name);
    if (!name || !pointInFrame(record.frame, Number(city.lng), Number(city.lat))) continue;
    if (holderAt(record, Number(city.lng), Number(city.lat)) !== 1 - side) continue;
    held.push({ city, key: plain(name) });
  }
  // The longest name first, so that "Nova Kakhovka" is not read as "Kakhovka".
  held.sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key));
  const found = [];
  for (const entry of Array.isArray(projects) ? projects : []) {
    if (!entry || entry.kind !== "operation" || !OPEN_STATUSES.includes(entry.status)) continue;
    if (Array.isArray(entry.linkedSpyIds) && entry.linkedSpyIds.length > 0) continue;
    const owner = clean(entry.ownerCode) || clean(player);
    if (!owner || !members.includes(fold(owner))) continue;
    let place = null;
    const lng = Number(entry.focus?.lng);
    const lat = Number(entry.focus?.lat);
    if (entry.focus && Number.isFinite(lng) && Number.isFinite(lat) && pointInFrame(record.frame, lng, lat) && holderAt(record, lng, lat) === 1 - side) {
      const near = cityNear(record, cities, lng, lat, PLAN_PLACE_KM);
      place = near && holderAt(record, Number(near.lng), Number(near.lat)) === 1 - side
        ? { name: clean(near.name), lng: Number(near.lng), lat: Number(near.lat) }
        : { name: "", lng, lat };
    }
    const text = plain(`${entry.name ?? ""}. ${entry.summary ?? ""}. ${entry.nextMilestone?.title ?? ""}`);
    if (!place) {
      const hit = held.find(({ key }) => namedIn(text, key));
      if (hit) place = { name: clean(hit.city.name), lng: Number(hit.city.lng), lat: Number(hit.city.lat) };
    }
    if (!place) continue;
    found.push({
      project: clean(entry.id, 160),
      name: clean(entry.name, 160),
      by: owner,
      own: own.has(fold(owner)),
      status: entry.status,
      due: entry.ongoing ? "" : clean(entry.targetDate, 40),
      order: orderHint(text),
      place,
      doubted: entry.verification === "doubted",
      secrecy: clean(entry.secrecy, 20) || "restricted",
    });
  }
  return found.filter((operation) => operation.project);
};

// The Board's operations as plans, with what the player changed of each.
const projectPlans = (record, side, context, decoded) => {
  const { toCell } = projectorOf(record.frame);
  const kept = keptPlansOf(record, side);
  const have = decoded[side].filter(live).length;
  const standing = chosenOrdersOf(record, side);
  return operationsOn({ ...context, record, side }).map((operation) => {
    const mine = kept.find((plan) => plan.kind === "project" && plan.project === operation.project) ?? null;
    // An operation takes the troops nearest that nobody has given an order of
    // their own: what was told by hand in the war room, and what another
    // operation has already sent, is not taken from under it.
    const busy = new Set(standing.filter((order) => order.mark !== `${PROJECT_MARK}${operation.project}`).flatMap((order) => order.troops));
    const to = toCell(operation.place.lng, operation.place.lat);
    const plan = {
      id: `project:${operation.project}`,
      kind: "project",
      side,
      project: operation.project,
      name: operation.name,
      by: operation.by,
      order: operation.order,
      objective: operation.place.name ? `city: ${operation.place.name}` : "",
      status: operation.status,
      due: operation.due,
      doubted: operation.doubted,
      secrecy: operation.secrecy,
      own: operation.own,
      edited: Boolean(mine?.way),
      off: mine?.off === true,
      sent: mine?.sent === true,
      begun: false,
      // It moves troops when time next passes: an operation under way, of the
      // player's own, that was not told to move nothing.
      live: operation.status === "active" && operation.own && mine?.off !== true,
      ways: [],
      picked: [],
    };
    if (mine?.way) {
      const route = mine.way.map(([lng, lat]) => toCell(lng, lat));
      plan.picked = nearestTo(decoded[side], route[0][0], route[0][1], thrustCount("advance", have), busy);
      plan.ways = lngLatWays(record, [route]);
    } else {
      plan.picked = nearestTo(decoded[side], to[0], to[1], thrustCount(operation.order, have), busy);
      const from = middleOf(decoded[side], plan.picked);
      if (from) plan.ways = lngLatWays(record, suggestedWays(record, operation.order, from, to));
    }
    plan.troops = plan.picked.length;
    return plan;
  });
};

const diversionPlans = (record, side) => keptPlansOf(record, side)
  .filter((plan) => plan.kind === "diversion")
  .map((plan) => ({
    id: plan.id,
    kind: "diversion",
    side,
    order: "advance",
    objective: "",
    name: "",
    by: "",
    ways: [plan.way],
    picked: [],
    troops: plan.troops,
    at: plan.at,
    begun: false,
  }));

// Every plan of a side of a battlefield:
//   { id, kind, side, order, objective, name, by, ways: [[[lng, lat]...]...],
//     picked: [troops, by their places in the record's list], troops,
//     begun, done?, ... }
// `begun`: days of fighting have passed over it, and it is being carried out.
// `done`: a Board operation that sent its troops and whose order is over: it
// has been carried out here, has no arrow, and is sent again only if the
// player says so (withProjectPlan with sent: false).
// `context`: { projects, cities, player, people } — the Board's entries as
// the world keeps them, the map's cities, the player's own name, and (in a
// game more than one person plays) the names of all who play.
export const plansOf = (record, side, context = {}) => {
  if (!record || !isSide(side) || !record.frame) return [];
  const decoded = troopsOf(record);
  const orders = orderPlans(record, side, context.cities, decoded);
  const projects = projectPlans(record, side, context, decoded);
  // A Board operation that has been sent stands among the orders: the order is
  // the arrow, and the operation is not drawn a second time beside it.
  const sent = new Set(orders.filter((plan) => plan.mark.startsWith(PROJECT_MARK)).map((plan) => plan.mark.slice(PROJECT_MARK.length)));
  for (const plan of orders) {
    if (!plan.mark.startsWith(PROJECT_MARK)) continue;
    const of = projects.find((project) => project.project === plan.mark.slice(PROJECT_MARK.length));
    if (of) {
      plan.name = of.name;
      plan.project = of.project;
    }
  }
  const waiting = projects.filter((plan) => !sent.has(plan.project)).map((plan) => (plan.sent ? { ...plan, done: true, ways: [], picked: [], troops: 0 } : plan));
  return [...orders, ...waiting, ...diversionPlans(record, side)];
};

// ---- carrying out the Board's operations ---------------------------------------------

// A record with the orders the Board's operations call for written onto it,
// for the sides listed in `sides` (those a person plays: nobody else's Board
// is the truth of what it will do). An operation under way sends its troops
// once, by the arrow the player drew for it or, with none drawn, by the
// engine's own attack of its kind at its place; one that has ended, was
// paused, or was told to move nothing here takes its troops off again.
export const withOperationOrders = (record, { sides = [], projects, cities, player = "", people = [], since = "" } = {}) => {
  let next = record;
  for (const side of sides) {
    if (!isSide(side)) continue;
    const decoded = troopsOf(next);
    const plans = projectPlans(next, side, { projects, cities, player, people }, decoded);
    const wanted = new Map(plans.filter((plan) => plan.live).map((plan) => [plan.project, plan]));
    next = releaseMarked(next, side, (mark) => mark.startsWith(PROJECT_MARK) && !wanted.has(mark.slice(PROJECT_MARK.length)));
    const standing = new Set(chosenOrdersOf(next, side).filter((order) => order.mark.startsWith(PROJECT_MARK)).map((order) => order.mark.slice(PROJECT_MARK.length)));
    for (const plan of wanted.values()) {
      if (standing.has(plan.project) || plan.sent || plan.picked.length === 0) continue;
      const kept = keptPlansOf(next, side).find((entry) => entry.kind === "project" && entry.project === plan.project);
      const before = next;
      next = orderTroops(next, {
        side,
        troops: plan.picked,
        order: plan.order,
        objective: kept?.way ? "" : plan.objective,
        way: kept?.way ?? null,
        by: plan.by,
        since,
        mark: `${PROJECT_MARK}${plan.project}`,
      });
      if (next !== before) next = withProjectPlan(next, side, { project: plan.project, sent: true, at: since });
    }
  }
  return next;
};

// ---- what one side knows of the other's plans ---------------------------------------

// A whole number from a text, the same on every machine.
const hashOf = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// What a side nobody plays feeds an agent it has turned: its attack, moved to
// a place it is not going. `truth` are its real plans.
const FAR_FROM_TRUTH_KM = 150;
const NEAR_TRUTH_KM = 40;
const madeUpPlans = (record, side, cities, truth, seed) => {
  const { toCell, kmAt } = projectorOf(record.frame);
  const decoded = troopsOf(record);
  const have = decoded[side].filter(live).length;
  if (have === 0) return [];
  const ends = truth.filter((plan) => isAttack(plan.order)).flatMap((plan) => plan.ways.map((way) => way[way.length - 1]));
  const places = [];
  for (const city of Array.isArray(cities) ? cities : []) {
    if (!clean(city?.name) || !pointInFrame(record.frame, Number(city.lng), Number(city.lat))) continue;
    if (holderAt(record, Number(city.lng), Number(city.lat)) !== 1 - side) continue;
    const [x, y] = toCell(Number(city.lng), Number(city.lat));
    // How far it is from where the side is really going.
    let away = Infinity;
    for (const [lng, lat] of ends) {
      const [ex, ey] = toCell(lng, lat);
      away = Math.min(away, Math.sqrt((ex - x) * (ex - x) + (ey - y) * (ey - y)) * kmAt((ey + y) / 2));
    }
    places.push({ city, x, y, away, weight: (Number(city.population) || 0) + (city.capital ? 1e9 : 0) });
  }
  const byWeight = (a, b) => b.weight - a.weight || clean(a.city.name).localeCompare(clean(b.city.name));
  // One of the larger places well away from the real attack; on a battlefield
  // too small to have one, the place furthest from it.
  let choice = places.filter((place) => place.away >= FAR_FROM_TRUTH_KM).sort(byWeight).slice(0, 5);
  if (choice.length === 0) choice = places.filter((place) => place.away >= NEAR_TRUTH_KM).sort((a, b) => b.away - a.away || byWeight(a, b)).slice(0, 1);
  if (choice.length === 0) return [];
  const place = choice[hashOf(`${record.name}|${record.asOf}|${seed}`) % choice.length];
  const picked = nearestTo(decoded[side], place.x, place.y, thrustCount("spearhead", have));
  const from = middleOf(decoded[side], picked);
  if (!from) return [];
  return [{
    id: "report:0",
    kind: "order",
    side,
    order: "spearhead",
    objective: `city: ${clean(place.city.name)}`,
    name: "",
    by: record.sides[side]?.[0] ?? "",
    ways: lngLatWays(record, suggestedWays(record, "spearhead", from, [place.x, place.y])),
    picked: [],
    troops: picked.length,
  }];
};

const reportable = (plan) => ({
  id: plan.id,
  kind: plan.kind === "diversion" ? "order" : plan.kind,
  side: plan.side,
  order: plan.order,
  objective: plan.objective,
  name: plan.name ?? "",
  by: plan.by ?? "",
  ways: plan.ways,
  picked: [],
  troops: plan.troops,
  ...(plan.doubted ? { doubted: true } : {}),
});

// What the agents of one side have sent it of the other side's plans.
//   record, side   the battlefield, and the side that is told
//   spies          the world's agents (runtime/spycraft.js)
//   projects, cities, player   as plansOf reads them
//   played         the names of the countries people play: a side with none
//                  of them feeds a turned agent a plan of its own making,
//                  and a side with one feeds it the diversions drawn for it
// Returns { plans, sources: [{ agent: owner, inside: target }] }: `plans` as
// plansOf gives them, each with nothing in it that says whether it is true.
// The Board's own entries on the other side's operations are part of it
// whatever agents there are: they are on the Board because they are known.
export const knownPlans = ({ record, side, spies, projects, cities, player = "", people = [], played = [] } = {}) => {
  if (!record || !isSide(side) || !record.frame) return { plans: [], sources: [] };
  const other = 1 - side;
  const mine = (record.sides?.[side] ?? []).map(fold);
  const theirs = (record.sides?.[other] ?? []).map(fold);
  const agents = (Array.isArray(spies) ? spies : []).filter((spy) => mine.includes(fold(spy?.owner)) && theirs.includes(fold(spy?.target))
    && (spy.status === "active" || spy.status === "turned"));
  const truth = plansOf(record, other, { projects, cities, player, people });
  const known = new Map();
  const add = (plan) => {
    const key = `${plan.order}|${plan.objective}|${JSON.stringify(plan.ways)}`;
    if (!known.has(key)) known.set(key, reportable(plan));
  };
  // What is on the Board of the other side's operations is known already.
  for (const plan of truth) if (plan.kind === "project" && !plan.own) add(plan);
  if (agents.some((spy) => spy.status === "active")) {
    for (const plan of truth) if (plan.kind !== "diversion" && (plan.ways.length > 0 || !isAttack(plan.order))) add(plan);
  }
  const turned = agents.filter((spy) => spy.status === "turned");
  if (turned.length > 0) {
    const drawn = truth.filter((plan) => plan.kind === "diversion");
    const people = (Array.isArray(played) ? played : []).map(fold);
    const fed = drawn.length > 0 || theirs.some((name) => people.includes(name))
      ? drawn
      : madeUpPlans(record, other, cities, truth, turned[0].id ?? "");
    for (const plan of fed) add(plan);
  }
  return {
    plans: [...known.values()].map((plan, index) => ({ ...plan, id: `known:${index}` })),
    sources: agents.map((spy) => ({ agent: clean(spy.owner), inside: clean(spy.target) })),
  };
};

// Whether a side has a double agent in its hands to tell a diversion to: an
// agent of the other side that it has turned.
export const hasDoubleAgent = ({ record, side, spies } = {}) => {
  if (!record || !isSide(side)) return false;
  const mine = (record.sides?.[side] ?? []).map(fold);
  const theirs = (record.sides?.[1 - side] ?? []).map(fold);
  return (Array.isArray(spies) ? spies : []).some((spy) => spy?.status === "turned" && theirs.includes(fold(spy.owner)) && mine.includes(fold(spy.target)));
};

// ---- in words ------------------------------------------------------------------------

const WORDS = Object.freeze({
  advance: "an advance",
  blitz: "a fast attack after massing",
  spearhead: "a spearhead",
  flank: "a move round the flank",
  encircle: "an encirclement",
  hold: "holding its line",
  "dig in": "digging in",
  "fall back": "falling back",
  withdraw: "withdrawing from the battlefield",
});

// A list of plans as a prompt reads them, a line each: names with their kind,
// never an id or a coordinate. `cities` gives a drawn way its place.
export const describePlans = (record, plans, { cities = [], most = 6 } = {}) => {
  const lines = [];
  for (const plan of Array.isArray(plans) ? plans : []) {
    const word = WORDS[plan.order] ?? "a movement";
    let where = plan.objective ? ` toward ${plan.objective}` : "";
    if (!where && plan.ways.length > 0) {
      const way = plan.ways[0];
      const [lng, lat] = way[way.length - 1];
      const near = cityNear(record, cities, lng, lat, PLAN_PLACE_KM);
      if (near) where = ` toward the country round city: ${clean(near.name)}`;
    }
    const size = plan.troops > 0 ? `, about ${plan.troops} formations` : "";
    const named = plan.name ? ` (${plan.kind === "project" ? "operation" : "plan"} "${plan.name}")` : "";
    lines.push(`${word}${where}${size}${named}${plan.doubted ? ", doubted" : ""}`);
    if (lines.length >= most) break;
  }
  return lines;
};

// ---- a side that has been warned -----------------------------------------------------

// How near a point (cell units) is to a way (cell units), in cells.
const offWay = (way, x, y) => {
  let best = Infinity;
  for (let index = 0; index + 1 < way.length; index += 1) {
    const [ax, ay] = way[index];
    const dx = way[index + 1][0] - ax;
    const dy = way[index + 1][1] - ay;
    const length = dx * dx + dy * dy;
    const along = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    const ox = x - ax - dx * along;
    const oy = y - ay - dy * along;
    best = Math.min(best, ox * ox + oy * oy);
  }
  return Math.sqrt(best);
};

// A record in which a side has dug in against the movements it has learnt of:
// its troops nearest the ways it was shown, wherever those ways cross ground
// of its own. What it dug in for last time is undone first, so a plan that
// is no longer reported is no longer waited for. `plans` as knownPlans gives.
export const withWatch = (record, side, plans, { since = "" } = {}) => {
  if (!record || !isSide(side) || !record.frame) return record;
  let next = releaseMarked(record, side, (mark) => mark === WATCH_MARK);
  const { toCell, kmAt } = projectorOf(next.frame);
  const ways = [];
  for (const plan of Array.isArray(plans) ? plans : []) {
    if (!isAttack(plan.order)) continue;
    for (const way of plan.ways) if (way.length >= 2) ways.push(way.map(([lng, lat]) => toCell(lng, lat)));
  }
  if (ways.length === 0) return next;
  const decoded = troopsOf(next);
  const busy = new Set(chosenOrdersOf(next, side).flatMap((order) => order.troops));
  const near = [];
  decoded[side].forEach((troop, index) => {
    if (!live(troop) || busy.has(index)) return;
    let best = Infinity;
    for (const way of ways) best = Math.min(best, offWay(way, troop.x, troop.y) * kmAt(troop.y));
    if (best <= WATCH_KM) near.push([best, index]);
  });
  near.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const most = Math.min(WATCH_TROOPS_MOST, Math.floor(decoded[side].filter(live).length * WATCH_SHARE));
  const picked = near.slice(0, most).map((entry) => entry[1]);
  if (picked.length === 0) return next;
  next = orderTroops(next, { side, troops: picked, order: "dig in", by: next.sides[side]?.[0] ?? "", since, mark: WATCH_MARK });
  return next;
};
