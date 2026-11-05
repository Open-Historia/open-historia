/*! Open Historia — battlefields and fronts: the replay of a run © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine works a whole turn out before any of it is shown. So that the map
// can show it happening (each troop going the way it went, the ground changing
// colour around it as it goes), a battlefield keeps a replay of its last run:
//
//   replay { d, n, s, e, t, names, m, p }
//     d      the date of the run's first day
//     n      how many days the run was. Days are counted from 0, the state
//            the run began from, to n, the state it ended in
//     s, e   the days this battlefield's own replay begins and ends on: 0 and
//            n, or the day it opened and the day it closed
//     t      a pair: each side's troops' paths (codec.js encodeTracks), in
//            the order of the record's troops
//     names  whose colour taken ground is painted in: the members of side 0,
//            then those of side 1
//     m      the painted ground as the replay begins, a state a cell (codec.js
//            encodeStates): PAINT_OWN_A or PAINT_OWN_B for ground a side
//            holds at home, 1 + an index into `names` for ground painted in
//            that name, PAINT_WALL for sea and land that is nobody's in this war
//     p      every change of that ground after it, with its time (codec.js
//            encodePaint)
//     o, f   (only when there are any) whose each region the fighting has
//            reached is DRAWN as: `o` is [regionId, name] as the run begins,
//            `f` every change of that after it, [day, regionId, name]
//
// A region changes hands twice. IN NAME when the side that does not hold it
// has more than six tenths of it: it is the taker's for every rule of the
// game from that day, and nothing on the map changes. IN FULL only when the
// taker holds all of it: then the map switches it over, colour, border and
// labels. Between the two the map goes on drawing it as its old holder's, and
// `o` and `f` are how it knows to: the world's owner is the taker by then.
//
// There is no front line in it: the front is where the colours meet, and where
// the troops stand. Ground is PAINTED when a side holds it that is not the
// side whose home ground it is; ground a side holds at home is simply its own,
// and is drawn by the map as it always was.
//
// A replay being shown part of the way (a turn being revealed) carries two
// marks the engine never writes, `from` and `until`: the days to play it
// between.
//
// The recorder is the engine's side of this; the rest is how the game reads
// it. Pure and deterministic, and loads in plain Node.

import { diffGameDays } from "../gameDates.js";
import {
  PACKED_TEXT,
  PAINT_NAMES_MAX,
  PAINT_OWN_A,
  PAINT_OWN_B,
  PAINT_TICKS_PER_DAY,
  PAINT_WALL,
  TRACK_DAY_MAX,
  decodePaint,
  decodeStates,
  decodeTracks,
  encodePaint,
  encodeStates,
  encodeTracks,
} from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, TROOP_STATES } from "./constants.js";

export const MAX_TRACK_POINTS = 32;
// How far, in cells, a point left out of a path may lie to the SIDE of where
// the points kept put the troop on that day. Being a little ahead of or behind
// that place counts for less (TRACK_ALONG): a troop's pace changes from day to
// day with its fighting, and a path that kept every such day would be all
// points; what is seen is the way it went, and roughly when.
export const TRACK_TOLERANCE = 0.2;
const TRACK_ALONG = 0.3;
// Strength counts toward that too: this many points of strength as one cell.
const STRENGTH_PER_CELL = 40;
// A path is saved to 1/16 of a cell: two points nearer than that are one.
const SAME_PLACE = 1 / 32;
// A run of hundreds of troops across a wide front is some tens of thousands
// of characters; this is the most a replay may be.
export const MAX_REPLAY_CHARS = 120000;
// How many regions a replay says how to draw, and how many times in a run
// they may change.
export const MAX_SHOWN_REGIONS = 600;
const MAX_SHOWN_TURNS = 1200;
const TEXT_MAX = 200000;
const DATE_MAX = 40;
const NAME_MAX = 120;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stateIndex = (value) => {
  if (typeof value === "number") return value >= 0 && value < TROOP_STATES.length ? Math.floor(value) : 0;
  const index = TROOP_STATES.indexOf(String(value ?? ""));
  return index < 0 ? 0 : index;
};

// ---- recording a run -------------------------------------------------------------

// Which points of a path to keep: the first and the last, every day what the
// troop was doing changed, and as many more as it takes for the points kept to
// put it within `tolerance` of where it was on every day. A troop is judged by
// where it was WHEN, not by the shape of its path alone, so one that waited
// and then ran is not shown ambling the whole way.
const thinTrack = (samples, tolerance) => {
  const count = samples.length;
  if (count <= 2) return samples.slice();
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  for (let index = 0; index < count - 1; index += 1) {
    if (samples[index].state !== samples[index + 1].state) keep[index] = 1;
  }
  const spans = [];
  let from = 0;
  for (let index = 1; index < count; index += 1) {
    if (!keep[index]) continue;
    spans.push(from, index);
    from = index;
  }
  while (spans.length) {
    const b = spans.pop();
    const a = spans.pop();
    if (b - a < 2) continue;
    const first = samples[a];
    const last = samples[b];
    const span = last.day - first.day;
    // The way from the one kept point to the other, to tell ahead from aside.
    const reach = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
    const wayX = reach > 0 ? (last.x - first.x) / reach : 0;
    const wayY = reach > 0 ? (last.y - first.y) / reach : 0;
    let worst = 0;
    let at = -1;
    for (let index = a + 1; index < b; index += 1) {
      const sample = samples[index];
      const part = span > 0 ? (sample.day - first.day) / span : 0;
      const dx = sample.x - (first.x + (last.x - first.x) * part);
      const dy = sample.y - (first.y + (last.y - first.y) * part);
      const ds = (sample.strength - (first.strength + (last.strength - first.strength) * part)) / STRENGTH_PER_CELL;
      const ahead = (dx * wayX + dy * wayY) * TRACK_ALONG;
      const aside = reach > 0 ? dx * -wayY + dy * wayX : Math.sqrt(dx * dx + dy * dy);
      const off = Math.sqrt(ahead * ahead + aside * aside + ds * ds);
      if (off > worst) {
        worst = off;
        at = index;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      spans.push(a, at, at, b);
    }
  }
  const kept = [];
  for (let index = 0; index < count; index += 1) if (keep[index]) kept.push(samples[index]);
  return kept;
};

const sameStanding = (a, b) =>
  Math.abs(a.x - b.x) < SAME_PLACE && Math.abs(a.y - b.y) < SAME_PLACE && a.state === b.state && Math.abs(a.strength - b.strength) <= 2;

const packTrack = (samples, tolerance) => {
  let slack = tolerance;
  let kept = thinTrack(samples, slack);
  for (let pass = 0; pass < 8 && kept.length > MAX_TRACK_POINTS; pass += 1) {
    slack *= 1.6;
    kept = thinTrack(samples, slack);
  }
  if (kept.length > MAX_TRACK_POINTS) kept = [...kept.slice(0, MAX_TRACK_POINTS - 1), kept[kept.length - 1]];
  // A troop stays where its path ends, so an end that says nothing new is
  // not kept: one that never moved is a single point.
  while (kept.length >= 2 && sameStanding(kept[kept.length - 1], kept[kept.length - 2])) kept.pop();
  return kept;
};

const memberList = (value) => (Array.isArray(value) ? value : []).map((name) => String(name ?? "").slice(0, NAME_MAX));

// Keeps a run as it is worked out, a day at a time, and hands back the replay.
// One for each battlefield, each run. `sides` are the battlefield's two lists
// of members; `cols` and `rows` its frame's. (`from` is what another
// recorder had recorded, carried onto this one's grid: carryOnto below.)
export const createReplayRecorder = ({ sides = [[], []], cols = 0, rows = 0, from = null } = {}) => {
  const members = [memberList(sides[0]), memberList(sides[1])];
  const names = [...members[0], ...members[1]].slice(0, PAINT_NAMES_MAX);
  const cells = Math.max(0, Math.floor(cols) * Math.floor(rows));
  // What each cell is painted as now, the same as it began (and as a list of states), and the changes.
  const painted = from ? from.painted : new Uint8Array(cells);
  let beganStates = from ? from.began : null;
  let began = beganStates ? encodeStates(beganStates) : null;
  const changes = from ? from.changes : [];
  let start = from ? from.start : -1;
  let lastDay = from ? from.lastDay : -1;
  const tracks = from ? from.tracks : [[], []];
  // Whose each region is drawn as: as the run begins, now, and the changes.
  const shownFirst = from ? from.shownFirst : new Map();
  const shownNow = from ? from.shownNow : new Map();
  const turns = from ? from.turns : [];

  const stateOf = (ground, cell) => {
    const holder = ground.holders[cell];
    if (holder !== HOLDER_SIDE_A && holder !== HOLDER_SIDE_B) return PAINT_WALL;
    const side = holder === HOLDER_SIDE_A ? 0 : 1;
    const own = side === 0 ? PAINT_OWN_A : PAINT_OWN_B;
    if ((ground.homes && ground.homes[cell] === holder) || members[side].length === 0) return own;
    const painter = Math.min(ground.painters ? ground.painters[cell] : 0, members[side].length - 1);
    const state = 1 + (side === 0 ? painter : members[0].length + painter);
    return state <= names.length ? state : own;
  };

  return {
    // The state at the end of `day` (0 is the state the run began from): each
    // side's troops in the order of their lists, the fallen at strength 0, and
    // the ground: for every cell who holds it (`holders`), which of that
    // side's members took it (`painters`), whose home ground it is (`homes`),
    // and, for a cell that changed hands that day, the part of the day at
    // which it did (`when`, optional). Called in order of day.
    record(day, troops, ground) {
      const at = Math.max(0, Math.min(TRACK_DAY_MAX, Math.floor(Number(day) || 0)));
      if (start < 0) start = at;
      if (ground?.holders && cells > 0) {
        if (began === null) {
          for (let cell = 0; cell < cells; cell += 1) painted[cell] = stateOf(ground, cell);
          beganStates = Uint8Array.from(painted);
          began = encodeStates(painted);
        } else {
          const first = (at - 1) * PAINT_TICKS_PER_DAY;
          const today = [];
          for (let cell = 0; cell < cells; cell += 1) {
            const state = stateOf(ground, cell);
            if (state === painted[cell]) continue;
            painted[cell] = state;
            const part = ground.when ? Number(ground.when[cell]) : 1;
            const within = Number.isFinite(part) ? Math.max(0, Math.min(1, part)) : 1;
            today.push({ tick: first + Math.round(within * PAINT_TICKS_PER_DAY), cell, state });
          }
          today.sort((a, b) => a.tick - b.tick || a.cell - b.cell);
          for (const change of today) changes.push(change);
        }
      }
      lastDay = at;
      for (let side = 0; side < 2; side += 1) {
        const list = Array.isArray(troops?.[side]) ? troops[side] : [];
        const kept = tracks[side];
        for (let index = 0; index < list.length; index += 1) {
          const troop = list[index];
          if (!kept[index]) kept[index] = [];
          const samples = kept[index];
          const before = samples[samples.length - 1];
          const strength = Number(troop?.strength) > 0 ? Math.min(100, Number(troop.strength)) : 0;
          // Nothing follows a fall, and a troop is not seen before it stands.
          if (before ? before.strength <= 0 : strength <= 0) continue;
          samples.push({ day: at, x: Number(troop?.x) || 0, y: Number(troop?.y) || 0, strength, state: stateIndex(troop?.state) });
        }
      }
    },

    // From `day` the map draws a region as `name`'s; before, it drew it as
    // `was`'s. Told on day 0 for every region the last run left drawn as
    // another's than the world says; on the day a region changes hands in
    // name, with the name it is still drawn as (nothing changes on the map,
    // but the map has now to be told what to draw); and on the day it changes
    // hands in full, with the new name and the old.
    shown(day, regionId, name, was = name) {
      const id = String(regionId ?? "").trim().slice(0, NAME_MAX);
      const to = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
      if (!id || !to) return;
      if (!shownFirst.has(id)) {
        if (shownFirst.size >= MAX_SHOWN_REGIONS) return;
        const from = String(was ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) || to;
        shownFirst.set(id, from);
        shownNow.set(id, from);
      }
      if (shownNow.get(id) === to || turns.length >= MAX_SHOWN_TURNS) return;
      turns.push([Math.max(0, Math.min(TRACK_DAY_MAX, Math.floor(Number(day) || 0))), id, to]);
      shownNow.set(id, to);
    },

    // The same recording carried onto a battlefield's larger frame (day.js
    // growFrame), so that its replay goes on from the day it began rather than
    // beginning again from the day the frame grew: a reveal shows the battle at
    // every event of the run, and before the day it grew there was none to show.
    //   cols, rows   the larger frame's
    //   cellOf       a cell of this recorder's grid -> the larger grid's (-1 off it)
    //   pointOf      a point in this grid's cells -> the larger grid's ([x, y])
    //   ground       the ground as it is now, on the larger grid, as record() reads it
    //   day          the day it grew (its changes since this recorder last
    //                recorded are told as that day's)
    // A new recorder; null when there is nothing to carry yet, or the sides have
    // changed since this one began (a member joined): that one begins again.
    carryOnto({ sides: now = [[], []], cols: toCols = 0, rows: toRows = 0, cellOf, pointOf, ground, day = 0 } = {}) {
      if (beganStates === null || typeof cellOf !== "function" || typeof pointOf !== "function") return null;
      const same = (a, b) => a.length === b.length && a.every((name, at) => name === b[at]);
      if (!same(members[0], memberList(now[0])) || !same(members[1], memberList(now[1]))) return null;
      const size = Math.max(0, Math.floor(toCols) * Math.floor(toRows));
      // The ground now on the larger grid; what it began as, its own where this grid's reaches, and the changes onto it.
      const nowStates = new Uint8Array(size);
      for (let cell = 0; cell < size; cell += 1) nowStates[cell] = stateOf(ground, cell);
      const beganThere = Uint8Array.from(nowStates);
      const wasThere = Uint8Array.from(nowStates);
      for (let cell = 0; cell < cells; cell += 1) {
        const there = cellOf(cell);
        if (there < 0 || there >= size) continue;
        beganThere[there] = beganStates[cell];
        wasThere[there] = painted[cell];
      }
      const carried = [];
      for (const change of changes) {
        const there = cellOf(change.cell);
        if (there >= 0 && there < size) carried.push({ tick: change.tick, cell: there, state: change.state });
      }
      // Where the ground now differs from what the carried changes leave (the grid resampled), it changed that day.
      const tick = Math.max(0, (Math.max(1, Math.floor(Number(day) || 0)) - 1) * PAINT_TICKS_PER_DAY);
      for (let cell = 0; cell < size; cell += 1) if (wasThere[cell] !== nowStates[cell]) carried.push({ tick, cell, state: nowStates[cell] });
      carried.sort((a, b) => a.tick - b.tick || a.cell - b.cell);
      const carryTrack = (samples) => samples.map((sample) => {
        const [x, y] = pointOf(sample.x, sample.y);
        return { ...sample, x, y };
      });
      return createReplayRecorder({
        sides: now,
        cols: toCols,
        rows: toRows,
        from: {
          painted: nowStates,
          began: beganThere,
          changes: carried,
          start,
          lastDay,
          tracks: tracks.map((side) => side.map((samples) => (samples ? carryTrack(samples) : samples))),
          shownFirst: new Map(shownFirst),
          shownNow: new Map(shownNow),
          turns: turns.map((turn) => [...turn]),
        },
      });
    },

    // The replay to save on the record. `date` is the date of the run's first
    // day and `days` how long the run was.
    finish({ date = "", days } = {}) {
      const total = Math.max(0, Math.min(TRACK_DAY_MAX, Math.floor(Number.isFinite(Number(days)) ? Number(days) : lastDay)));
      const pack = (tolerance) => tracks.map((side) => {
        const paths = [];
        for (let index = 0; index < side.length; index += 1) paths.push(side[index] ? packTrack(side[index], tolerance) : []);
        return encodeTracks(paths);
      });
      let tolerance = TRACK_TOLERANCE;
      let texts = pack(tolerance);
      let ground = began ?? "";
      let log = encodePaint(changes);
      const size = () => ground.length + log.length + texts[0].length + texts[1].length;
      // Too much to save: coarser paths first; then the ground is kept as it
      // ended, with nothing of how it came to be so.
      for (let pass = 0; pass < 3 && size() > MAX_REPLAY_CHARS; pass += 1) {
        tolerance *= 2;
        texts = pack(tolerance);
      }
      if (size() > MAX_REPLAY_CHARS) {
        ground = encodeStates(painted);
        log = "";
      }
      const end = lastDay < 0 ? 0 : lastDay;
      return {
        d: String(date ?? "").slice(0, DATE_MAX),
        n: Math.max(total, end),
        s: Math.max(0, start),
        e: end,
        t: texts,
        names,
        m: ground,
        p: log,
        ...(shownFirst.size > 0 ? { o: [...shownFirst], f: turns.map((turn) => [...turn]) } : {}),
      };
    },
  };
};

// ---- the saved replay ---------------------------------------------------------------

const wholeDay = (value, most) => {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 0) return 0;
  return number > most ? most : number;
};
const packed = (value) => (typeof value === "string" && value.length <= TEXT_MAX && PACKED_TEXT.test(value) ? value : "");

// Shape and length only: the engine wrote it, and the world is read too often
// to decode it here. A replay this function made is handed back as it is, so
// what has been decoded from it (replayOf) is decoded once.
const made = new WeakSet();
export const normalizeReplay = (raw) => {
  if (!isRecord(raw) || !Array.isArray(raw.t)) return null;
  if (made.has(raw)) return raw;
  const n = wholeDay(raw.n, TRACK_DAY_MAX);
  const s = wholeDay(raw.s, n);
  const replay = {
    d: String(raw.d ?? "").replace(/\s+/g, " ").trim().slice(0, DATE_MAX),
    n,
    s,
    e: Math.max(s, raw.e === undefined ? n : wholeDay(raw.e, n)),
    t: [packed(raw.t[0]), packed(raw.t[1])],
    names: memberList(raw.names).map((name) => name.replace(/\s+/g, " ").trim()).slice(0, PAINT_NAMES_MAX),
    m: packed(raw.m),
    p: packed(raw.p),
  };
  if (Array.isArray(raw.o) && raw.o.length > 0) {
    const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "");
    const first = [];
    const known = new Set();
    for (const entry of raw.o) {
      if (first.length >= MAX_SHOWN_REGIONS) break;
      const id = Array.isArray(entry) ? text(entry[0]) : "";
      const name = Array.isArray(entry) ? text(entry[1]) : "";
      if (!id || !name || known.has(id)) continue;
      known.add(id);
      first.push([id, name]);
    }
    if (first.length > 0) {
      const turns = [];
      for (const entry of Array.isArray(raw.f) ? raw.f : []) {
        if (turns.length >= MAX_SHOWN_TURNS) break;
        const id = Array.isArray(entry) ? text(entry[1]) : "";
        const name = Array.isArray(entry) ? text(entry[2]) : "";
        if (!id || !name || !known.has(id)) continue;
        turns.push([wholeDay(entry[0], n), id, name]);
      }
      // In the order they happened, whatever order they were written in.
      turns.sort((a, b) => a[0] - b[0]);
      replay.o = first;
      replay.f = turns;
    }
  }
  if (Number.isFinite(raw.until)) {
    replay.until = Math.max(0, Math.min(n, Number(raw.until)));
    replay.from = Number.isFinite(raw.from) ? Math.max(0, Math.min(replay.until, Number(raw.from))) : replay.until;
  }
  made.add(replay);
  return replay;
};

// The same replay, to be played between two of its days: a turn being
// revealed shows the days an event covers and stops there.
export const replayBetween = (replay, from, until) => {
  if (!replay) return replay;
  const end = Math.max(0, Math.min(replay.n, Number(until) || 0));
  const marked = { ...replay, from: Math.max(0, Math.min(end, Number(from) || 0)), until: end };
  made.add(marked);
  return marked;
};

// Whose each region a replay speaks of is drawn as on a day of its run (a
// fraction of a day is fine), as { regionId: name }. The same object is given
// for as long as nothing has changed, so a caller can tell by looking. null
// for a replay that speaks of none.
const shownAt = new WeakMap();
export const shownOwnersAt = (replay, day) => {
  if (!replay || !Array.isArray(replay.o) || replay.o.length === 0) return null;
  const turns = Array.isArray(replay.f) ? replay.f : [];
  let upTo = 0;
  while (upTo < turns.length && turns[upTo][0] <= day) upTo += 1;
  const known = shownAt.get(replay.o);
  if (known && known.upTo === upTo && known.turns === turns) return known.owners;
  const owners = {};
  for (const [id, name] of replay.o) owners[id] = name;
  for (let index = 0; index < upTo; index += 1) owners[turns[index][1]] = turns[index][2];
  Object.freeze(owners);
  shownAt.set(replay.o, { upTo, turns, owners });
  return owners;
};

// The day of the run a date falls on, held to the run; null for no date, or
// one the calendar cannot place.
export const replayDayOn = (replay, date) => {
  if (!replay || date === null || date === undefined || date === "") return null;
  const days = diffGameDays(replay.d, date);
  if (days === null) return null;
  return days < 0 ? 0 : days > replay.n ? replay.n : days;
};

// A saved replay, read: each troop's path as its points, and the painted
// ground as it began with the changes after it. `cells` is how many cells the
// battlefield's frame has. A copy made to be shown part of the way shares its
// paths with the replay it was made from, and so shares this.
//
//   { date, days, start, end, tracks: [[path], [path]],
//     paint: { names, began, ticks, cells, states } }
const read = new WeakMap();
const readReplay = (replay, cells) => {
  let known = read.get(replay.t);
  if (!known) {
    known = {
      date: replay.d,
      days: replay.n,
      start: replay.s,
      end: replay.e,
      tracks: [decodeTracks(replay.t[0]), decodeTracks(replay.t[1])],
      paint: { names: replay.names, began: decodeStates(replay.m, cells), ...decodePaint(replay.p) },
    };
    read.set(replay.t, known);
  }
  return known;
};
export const replayOf = (battlefield) => {
  const replay = battlefield?.replay;
  if (!replay || !Array.isArray(replay.t)) return null;
  return readReplay(replay, (battlefield.frame?.cols ?? 0) * (battlefield.frame?.rows ?? 0));
};

// The days a replay is to be played between, or null to show it as it ended.
export const replayWindowOf = (battlefield) => {
  const replay = battlefield?.replay;
  return replay && Number.isFinite(replay.until) ? { from: replay.from, until: replay.until } : null;
};

// A battlefield's replay with nothing left to play: the ground as the run left
// it and every troop where it ended. What a copy of the world kept only to go
// back to (a restore point) needs of it, at a fraction of the size.
export const stillReplayOf = (battlefield) => {
  const replay = battlefield?.replay;
  if (!replay || !Array.isArray(replay.t)) return replay ?? null;
  const { paint } = replayOf(battlefield);
  const ground = Uint8Array.from(paint.began);
  for (let index = 0; index < paint.cells.length; index += 1) {
    if (paint.cells[index] < ground.length) ground[paint.cells[index]] = paint.states[index];
  }
  const ends = (text) => encodeTracks(decodeTracks(text).map((samples) => {
    const last = samples[samples.length - 1];
    return last ? [{ ...last, day: 0 }] : [];
  }));
  const still = { d: "", n: 0, s: 0, e: 0, t: [ends(replay.t[0]), ends(replay.t[1])], names: replay.names, m: encodeStates(ground), p: "" };
  made.add(still);
  return still;
};

// Where a troop was on a day of the run (a fraction of a day is fine), by its
// path: null before it stood, and where it ended ever after. Straight between
// the points kept; the map rounds the corners (Game/Map/frontGeometry.js).
export const trackAt = (track, day) => {
  if (!track || track.length === 0 || day < track[0].day) return null;
  const last = track[track.length - 1];
  if (day >= last.day) return { x: last.x, y: last.y, strength: last.strength, state: last.state, moving: false };
  let index = 1;
  while (track[index].day < day) index += 1;
  const from = track[index - 1];
  const to = track[index];
  const span = to.day - from.day;
  const part = span > 0 ? (day - from.day) / span : 1;
  return {
    x: from.x + (to.x - from.x) * part,
    y: from.y + (to.y - from.y) * part,
    strength: from.strength + (to.strength - from.strength) * part,
    // What it was doing on the way to a point is what that point says.
    state: to.state,
    moving: Math.abs(to.x - from.x) >= SAME_PLACE || Math.abs(to.y - from.y) >= SAME_PLACE,
  };
};
