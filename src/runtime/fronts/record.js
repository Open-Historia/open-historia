/*! Open Historia — battlefields and fronts: the saved record © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What world.battlefields holds, checked on the way in, and how the rest of the
// game reads it without knowing how the engine works.
//
//   Battlefield {
//     v, name, warId, status,       name is what the model writes; unique, any case
//     sides: [[names], [names]],    exact names of countries or groups; side 0 first
//     openedDate, asOf, closedDate?,
//     frame,                        the grid it is laid on (frame.js)
//     field: { mask, band, key },   who holds each cell, and the distance to the
//                                   line for the cells near it; gone once closed
//     troops: [text, text],         a side each (codec.js encodeTroops)
//     named: [{ s, i, name, unitId }],   formations taken in from world.units
//     pool, base, quality, effort,  a pair each, one value a side
//     orders: [{ s, sector, order, objective?, effort?, by?, since, chosen?, way? }],
//                                   `chosen`: for a body of troops picked out
//                                   (which ones, the brief's carry says), not for
//                                   a stretch of line; `way`: the route drawn
//                                   for them, as [lng, lat] points
//     replay,                       the last run, kept to be played back: each
//                                   troop's path and the ground as it was
//                                   taken (replay.js); null where there is none
//     held,                         unused since the ground is painted
//     contested,                    [regionId, name]: regions taken in name
//                                   and not in full, and whose the map still
//                                   draws each as
//     brief, log                    what the prompt and the card read
//   }
//
// The engine writes every one of these; nothing here decodes them to check
// them. normalizeWorldState runs on every read of the world, so this is shape
// and length only.

import { PACKED_TEXT, TROOP_LETTERS, decodeMask, decodeTroops } from "./codec.js";
import {
  BATTLEFIELD_NAME_MAX,
  BATTLEFIELD_STATUSES,
  BATTLEFIELD_VERSION,
  DEFAULT_EFFORT,
  FRONT_EFFORTS,
  FRONT_ORDERS,
  HOLDER_WALL,
  MAX_WAY_POINTS,
  LOG_TEXT_MAX,
  MARK_MAX,
  LINE_MARKS,
  MAX_BATTLEFIELDS,
  MAX_CLOSED_BATTLEFIELDS,
  MAX_CONTESTED_REGIONS,
  MAX_LOG_ENTRIES,
  MAX_NAMED_TROOPS,
  MAX_ORDERS_PER_SIDE,
  MAX_SIDE_MEMBERS,
  MAX_TROOPS_PER_SIDE,
} from "./constants.js";
import { cellIndexAt, normalizeFrame, projectorOf } from "./frame.js";
import { readAttacks } from "./invade.js";
import { normalizeReplay, replayBetween, replayDayOn, replayOf, replayWindowOf } from "./replay.js";
import { readChronicle } from "./chronicle.js";

const NAME_MAX = 120;
const DATE_MAX = 40;
const PACKED_MAX = 200000;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();

// A battlefield's name, and a side's member, are matched in any case and never
// by anything looser: names are exact here as everywhere.
export const foldBattlefieldName = (value) => clean(value, BATTLEFIELD_NAME_MAX).toLowerCase();
const foldName = (value) => clean(value, NAME_MAX).toLowerCase();

const memberList = (value) => {
  const members = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const name = clean(entry, NAME_MAX);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    members.push(name);
    if (members.length >= MAX_SIDE_MEMBERS) break;
  }
  return members;
};

const pairOf = (value, read) => [read(Array.isArray(value) ? value[0] : undefined), read(Array.isArray(value) ? value[1] : undefined)];
const amount = (fallback) => (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};
const packed = (value) => (typeof value === "string" && value.length <= PACKED_MAX && PACKED_TEXT.test(value) ? value : "");
const troopText = (value) => {
  const text = packed(value);
  return text.slice(0, Math.min(Math.floor(text.length / TROOP_LETTERS), MAX_TROOPS_PER_SIDE) * TROOP_LETTERS);
};
const sideIndex = (value) => (value === 0 || value === 1 ? value : -1);

const normalizeOrder = (raw) => {
  if (!isRecord(raw)) return null;
  const s = sideIndex(raw.s);
  const order = clean(raw.order, 20).toLowerCase();
  if (s < 0 || !FRONT_ORDERS.includes(order)) return null;
  const entry = { s, sector: clean(raw.sector, NAME_MAX) || "all", order, since: clean(raw.since, DATE_MAX) };
  const objective = clean(raw.objective, NAME_MAX);
  if (objective) entry.objective = objective;
  const effort = clean(raw.effort, 20).toLowerCase();
  if (FRONT_EFFORTS.includes(effort)) entry.effort = effort;
  const by = clean(raw.by, NAME_MAX);
  if (by) entry.by = by;
  if (raw.chosen === true) entry.chosen = true;
  // What such an order was written for, where that is not a hand in the war
  // room: a Board operation's ("plan:" and its id) or a side's precaution
  // against a movement it has learnt of ("watch"). See plans.js.
  // (And an order for a stretch of line that the side's own staff decided, with nobody ordering it: "staff", staff.js.)
  // (And what a scenario's author made the front: "scenario", scenarioFronts.js.)
  const mark = entry.chosen || LINE_MARKS.includes(raw.mark) ? clean(raw.mark, MARK_MAX) : "";
  if (mark) entry.mark = mark;
  const way = [];
  for (const point of Array.isArray(raw.way) ? raw.way : []) {
    const lng = Number(Array.isArray(point) ? point[0] : NaN);
    const lat = Number(Array.isArray(point) ? point[1] : NaN);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    way.push([Math.round(lng * 10000) / 10000, Math.round(lat * 10000) / 10000]);
    if (way.length >= MAX_WAY_POINTS) break;
  }
  if (way.length > 0) entry.way = way;
  // The countries outside the war a route goes into, which sending troops
  // along it attacks (invade.js). The engine works them out afresh whenever
  // the route is put to its troops; what is kept is for whoever reads the record.
  const attacks = entry.chosen ? readAttacks(raw.attacks) : [];
  if (attacks.length > 0) entry.attacks = attacks;
  return entry;
};

// (The kinds a log entry may be are the engine's: "city", "whole", "overrun",
// "pocket", "siege", "taken", "destroyed", "assault", "invaded" for a
// country a side sent its troops into, "attacked" for one it went to war with
// by attacking, and "withdrew" and "returned" for a side that took its troops
// off the battlefield and brought them back, and "bombed" for an air strike
// the war room ordered: fronts/airStrike.js.)
const normalizeOrders = (value) => {
  const kept = [];
  const count = [0, 0];
  for (const raw of Array.isArray(value) ? value : []) {
    const order = normalizeOrder(raw);
    if (!order || count[order.s] >= MAX_ORDERS_PER_SIDE) continue;
    count[order.s] += 1;
    kept.push(order);
  }
  return kept;
};

const normalizeNamed = (value) => {
  const kept = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!isRecord(raw)) continue;
    const s = sideIndex(raw.s);
    const i = Number(raw.i);
    const unitId = clean(raw.unitId, NAME_MAX);
    if (s < 0 || !Number.isInteger(i) || i < 0 || i >= MAX_TROOPS_PER_SIDE || !unitId) continue;
    kept.push({ s, i, name: clean(raw.name, NAME_MAX), unitId });
    if (kept.length >= MAX_NAMED_TROOPS) break;
  }
  return kept;
};

// The regions that have changed hands in name and not yet in full, each with
// the name the map still draws it as: [regionId, name]. (replay.js says why
// there are two moments.)
const normalizeContested = (value) => {
  const kept = [];
  const known = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const regionId = clean(Array.isArray(raw) ? raw[0] : "", NAME_MAX);
    const shown = Array.isArray(raw) && typeof raw[1] === "string" ? clean(raw[1], NAME_MAX) : "";
    if (!regionId || !shown || known.has(regionId)) continue;
    known.add(regionId);
    kept.push([regionId, shown]);
    if (kept.length >= MAX_CONTESTED_REGIONS) break;
  }
  return kept;
};

const normalizeLog = (value) => {
  const kept = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!isRecord(raw)) continue;
    const at = clean(raw.at, LOG_TEXT_MAX);
    const k = clean(raw.k, 24).toLowerCase();
    if (!at || !k) continue;
    const entry = { d: clean(raw.d, DATE_MAX), k, at };
    if (sideIndex(raw.s) >= 0) entry.s = raw.s;
    kept.push(entry);
  }
  return kept.slice(-MAX_LOG_ENTRIES);
};

export const normalizeBattlefield = (raw) => {
  if (!isRecord(raw)) return null;
  const name = clean(raw.name, BATTLEFIELD_NAME_MAX);
  const sides = pairOf(raw.sides, memberList);
  const frame = normalizeFrame(raw.frame);
  if (!name || !frame || sides[0].length === 0 || sides[1].length === 0) return null;
  const status = BATTLEFIELD_STATUSES.includes(raw.status) ? raw.status : "active";
  const record = {
    v: BATTLEFIELD_VERSION,
    name,
    warId: clean(raw.warId, NAME_MAX),
    status,
    sides,
    openedDate: clean(raw.openedDate, DATE_MAX),
    asOf: clean(raw.asOf, DATE_MAX),
    frame,
    troops: pairOf(raw.troops, troopText),
    named: normalizeNamed(raw.named),
    pool: pairOf(raw.pool, amount(0)),
    base: pairOf(raw.base, amount(0)),
    quality: pairOf(raw.quality, amount(1)),
    effort: pairOf(raw.effort, (value) => (FRONT_EFFORTS.includes(value) ? value : DEFAULT_EFFORT)),
    // EXPERIMENT, in the lab (mind/policy.js): what a side's trained staff remembers, a list of numbers a side.
    ...(Array.isArray(raw.mind) ? { mind: [0, 1].map((side) => (Array.isArray(raw.mind[side]) ? raw.mind[side].slice(0, 64).map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0)) : [])) } : {}),
    orders: normalizeOrders(raw.orders),
    replay: normalizeReplay(raw.replay),
    held: packed(raw.held),
    contested: normalizeContested(raw.contested),
    brief: isRecord(raw.brief) ? raw.brief : {},
    log: normalizeLog(raw.log),
    // What its war has come to, run by run (chronicle.js), for its report once it is over.
    ...(readChronicle(raw.chronicle) ? { chronicle: readChronicle(raw.chronicle) } : {}),
  };
  if (status === "closed") record.closedDate = clean(raw.closedDate, DATE_MAX);
  else if (isRecord(raw.field)) record.field = { mask: packed(raw.field.mask), band: packed(raw.field.band), key: clean(raw.field.key, 40) };
  return record;
};

// The list as the world keeps it: one record a name, the open ones first as
// they came, then the newest few that have closed. A list this function made is
// handed back as it is, so a world read twice keeps one copy.
const made = new WeakSet();
const results = new WeakMap();
export const normalizeBattlefields = (value) => {
  if (!Array.isArray(value)) return [];
  if (made.has(value)) return value;
  const known = results.get(value);
  if (known) return known;
  const seen = new Set();
  const open = [];
  const closed = [];
  for (const raw of value) {
    const record = normalizeBattlefield(raw);
    const key = record ? foldBattlefieldName(record.name) : "";
    if (!record || seen.has(key)) continue;
    seen.add(key);
    (record.status === "closed" ? closed : open).push(record);
  }
  const list = [...open.slice(0, MAX_BATTLEFIELDS), ...closed.slice(-MAX_CLOSED_BATTLEFIELDS)];
  made.add(list);
  results.set(value, list);
  return list;
};

// A war's id written where a battlefield's name goes. A real-key test
// (2026-10-28) had the model name the front it ordered "WAR-FRANCE-ITALY-2016",
// and the War Room's header showed the id. Every id the game or the model makes
// is "war-" and words joined by dashes with no space, which no front's name is;
// `warIds` are the ids of the wars at hand, matched in any case.
const WAR_ID_SHAPE = /^war-[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
export const isWarIdName = (name, warIds = []) => {
  const folded = foldBattlefieldName(name);
  if (!folded) return false;
  return WAR_ID_SHAPE.test(folded) || [...warIds].some((id) => foldBattlefieldName(id) === folded);
};

// What a front of these two sides is called when nobody named it: its two
// leading members (engine.js nameFor), here the first of each side.
export const plainFrontName = (sides) => clean(`${sides[0][0]} - ${sides[1][0]} front`, BATTLEFIELD_NAME_MAX);

// A world whose battlefields were named with a war id, saved before the engine
// refused one: each is called as a front of its sides is when nobody named it,
// numbered past a name already taken, and what finds it by name follows (the
// formations committed to it, the transporters bound for or embarking from it),
// or they would be fighting on a battlefield that is not there. The world is
// handed back as it was when no battlefield is named so.
export const withWarIdFrontsRenamed = (world) => {
  const list = Array.isArray(world?.battlefields) ? world.battlefields : null;
  if (!list || !list.some((raw) => isRecord(raw) && isWarIdName(raw.name, [raw.warId]))) return world;
  const taken = new Set(list.filter(isRecord).map((raw) => foldBattlefieldName(raw.name)));
  const renamed = new Map();
  const battlefields = list.map((raw) => {
    if (!isRecord(raw) || !isWarIdName(raw.name, [raw.warId])) return raw;
    const sides = pairOf(raw.sides, memberList);
    if (sides[0].length === 0 || sides[1].length === 0) return raw;
    const plain = plainFrontName(sides);
    let name = plain;
    for (let count = 2; taken.has(foldBattlefieldName(name)); count += 1) name = clean(`${plain} ${count}`, BATTLEFIELD_NAME_MAX);
    taken.add(foldBattlefieldName(name));
    const key = foldBattlefieldName(raw.name);
    if (!renamed.has(key)) renamed.set(key, name);
    return { ...raw, name };
  });
  const follow = (value) => (typeof value === "string" ? renamed.get(foldBattlefieldName(value)) ?? value : value);
  const next = { ...world, battlefields };
  if (Array.isArray(world.units)) {
    next.units = world.units.map((unit) => (isRecord(unit) && renamed.has(foldBattlefieldName(unit.committedTo)) ? { ...unit, committedTo: follow(unit.committedTo) } : unit));
  }
  if (Array.isArray(world.transports)) {
    next.transports = world.transports.map((row) => {
      if (!isRecord(row)) return row;
      const out = { ...row };
      if (typeof row.battlefield === "string") out.battlefield = follow(row.battlefield);
      if (isRecord(row.embark)) out.embark = { ...row.embark, battlefield: follow(row.embark.battlefield) };
      return out;
    });
  }
  return next;
};

export const findBattlefield = (battlefields, name) => {
  const wanted = foldBattlefieldName(name);
  if (!wanted) return null;
  return normalizeBattlefields(battlefields).find((battlefield) => foldBattlefieldName(battlefield.name) === wanted) ?? null;
};

// Which side a country or group fights on there: 0, 1, or -1 for neither.
export const battlefieldSideOf = (battlefield, name) => {
  const wanted = foldName(name);
  if (!wanted || !battlefield) return -1;
  return battlefield.sides.findIndex((members) => members.some((member) => foldName(member) === wanted));
};

export const isOpenBattlefield = (battlefield) => battlefield?.status === "active" || battlefield?.status === "frozen";

// ---- reading it ----------------------------------------------------------------

// What the map draws of a battlefield. The troops are as they stand: what kind
// each is, whose it is and whether it is a named formation do not change in a
// run, and a troop's place in its side's list is its own for the whole of one,
// so the path at one place in the replay is the path of the troop at that
// place here. Paths are in cell units of `frame` (projectorOf(frame).toLngLat
// places them), and the painted ground is a state a cell of it. `window` is the
// days of the replay to play between, for a list made by battlefieldsAtDay,
// and null to show it as it ended. Read once a record.
const views = new WeakMap();
export const frontViewOf = (battlefield) => {
  if (!battlefield) return null;
  let view = views.get(battlefield);
  if (!view) {
    view = {
      name: battlefield.name,
      warId: battlefield.warId,
      status: battlefield.status,
      sides: battlefield.sides,
      frame: battlefield.frame,
      named: battlefield.named,
      troops: [decodeTroops(battlefield.troops[0]), decodeTroops(battlefield.troops[1])],
      // Which of its side's generals each troop is under, by its place in the
      // list (command.js); empty for a record that was never shared out.
      commands: [0, 1].map((side) => (Array.isArray(battlefield.brief?.carry?.command?.[side]) ? battlefield.brief.carry.command[side] : [])),
      replay: replayOf(battlefield),
      window: replayWindowOf(battlefield),
    };
    views.set(battlefield, view);
  }
  return view;
};

// A battlefield as it was on a day of its last run, to be played from `from`
// to `until`: null when it had not opened yet. One that has closed since was
// still being fought over. What describes only the end of the run (the regions
// partly taken) is left out.
const atDay = (battlefield, from, until) => {
  const replay = battlefield.replay;
  if (!replay) return battlefield;
  if (until < replay.s) return null;
  const then = { ...battlefield, replay: replayBetween(replay, Math.max(from, replay.s), until), held: "", contested: [] };
  if (battlefield.status === "closed" && until < replay.e) {
    then.status = "active";
    delete then.closedDate;
  }
  return then;
};

// The list as it stood on a day of the last run, counted from 0 as the run
// began, for a view of the world as it was seen then. `from` is the day the
// map is to start playing from to reach it (a turn being revealed plays the
// days each event covers); left out, the day is simply shown.
export const battlefieldsAtDay = (battlefields, until, from = until) => {
  const list = normalizeBattlefields(battlefields);
  if (!Number.isFinite(until)) return list;
  const seen = [];
  for (const battlefield of list) {
    const then = atDay(battlefield, Number.isFinite(from) ? from : until, until);
    if (then) seen.push(then);
  }
  made.add(seen);
  return seen;
};

// The same by date, each battlefield placing the date in its own run. No date
// is the list as it stands, and so is a date the calendar cannot place.
// `fromDate` is the date the map is to start playing from to reach it (a turn
// being revealed plays, at each event, the days since the event before it);
// left out, or one the calendar cannot place, the date is simply shown.
export const battlefieldsAsSeen = (battlefields, date, fromDate = date) => {
  const list = normalizeBattlefields(battlefields);
  if (date === null || date === undefined || date === "") return list;
  const seen = [];
  for (const battlefield of list) {
    const day = replayDayOn(battlefield.replay, date);
    const since = day === null ? null : replayDayOn(battlefield.replay, fromDate);
    const then = day === null ? battlefield : atDay(battlefield, since === null ? day : Math.min(since, day), day);
    if (then) seen.push(then);
  }
  made.add(seen);
  return seen;
};

// Who holds a stored point, by the saved mask: 0 or 1 for a side, HOLDER_WALL
// for sea, a country outside the war, a point off the frame, or a battlefield
// that has closed.
const masks = new WeakMap();
export const holderAt = (battlefield, lng, lat) => {
  const frame = battlefield?.frame;
  if (!frame || !battlefield.field?.mask) return HOLDER_WALL;
  const [x, y] = projectorOf(frame).toCell(lng, lat);
  const index = cellIndexAt(frame, x, y);
  if (index < 0) return HOLDER_WALL;
  let mask = masks.get(battlefield);
  if (!mask) {
    mask = decodeMask(battlefield.field.mask, frame.cols * frame.rows);
    masks.set(battlefield, mask);
  }
  return mask[index];
};
