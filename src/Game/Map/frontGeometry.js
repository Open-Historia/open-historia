/*! Open Historia — battlefields on the map: a run's troops played back, as shapes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield keeps a replay of its last run (runtime/fronts/replay.js): the
// path each troop took, and the ground as it was taken. The map plays it back,
// so the troops are seen going the way they went. This works out where every
// troop of a battlefield is on any day of its run, a fraction of a day
// included, with the way it has come so far, and writes that out as the
// features the layers read (FrontLayers.jsx): a counter a troop, and an arrow
// along the way it came. The ground is frontPaint.js's.
// Pure, and loads in plain Node.
//
//   drawing { name, status, sides, frame, toLngLat, troops: [[troop], [troop]] }
//   troop   { x, y, strength, kind, owner, named, state, label, moving, way }
//           or null for one not standing that day; x and y are in cell units of
//           the frame, owner is a name, and way the way it has come so far
//           this run, as { xs, ys, days }: each point of it with the day the
//           troop was there (null for one that has not gone anywhere)
//
// There is no front line to draw: the front is where the troops stand and
// where the colours of the ground meet.

import { TROOP_KINDS, TROOP_STATES } from "../../runtime/fronts/constants.js";
import { projectorOf } from "../../runtime/fronts/frame.js";

export const TROOP_KIND_GLYPH = Object.freeze({ infantry: "I", armor: "A", artillery: "G" });

const EMPTY = Object.freeze({ type: "FeatureCollection", features: [] });
const ADVANCING = TROOP_STATES[1];

// ---- the way a troop went -----------------------------------------------------------

// A path is kept as a few points (the days it changed its course or its
// pace), and a troop went straight from each to the next. It is drawn rounding
// each corner a little on the inside, as a column on the march does, and the
// line left behind it is the same curve. The rounding is short (never more
// than a part of the shorter of the two legs it joins), so what is drawn stays
// beside the way it really went and never swings outside it: a curve through
// the corner itself would have to swing wide of the corner first, off the
// troop's own ground. Where it stood still on either side of a point it stops
// dead there.
const ROUND_CELLS = 0.75;
const ROUND_PART = 0.4;
const ROUND_STEPS = 5;

// A track as a fine run of points, each with the day the troop was there.
const curveOf = (track) => {
  const days = [];
  const xs = [];
  const ys = [];
  const put = (day, x, y) => {
    const last = days.length - 1;
    if (last >= 0 && days[last] === day && xs[last] === x && ys[last] === y) return;
    days.push(day);
    xs.push(x);
    ys.push(y);
  };
  if (track.length > 0) put(track[0].day, track[0].x, track[0].y);
  for (let index = 1; index < track.length; index += 1) {
    const here = track[index];
    const before = track[index - 1];
    const after = track[index + 1];
    const inLeg = Math.sqrt((here.x - before.x) ** 2 + (here.y - before.y) ** 2);
    const outLeg = after ? Math.sqrt((after.x - here.x) ** 2 + (after.y - here.y) ** 2) : 0;
    const round = Math.min(ROUND_CELLS, ROUND_PART * inLeg, ROUND_PART * outLeg);
    if (!(round > 0)) {
      put(here.day, here.x, here.y);
      continue;
    }
    // Where it leaves the straight for the corner, and where it is back on it.
    const inPart = round / inLeg;
    const outPart = round / outLeg;
    const enterX = here.x - (here.x - before.x) * inPart;
    const enterY = here.y - (here.y - before.y) * inPart;
    const enterDay = here.day - (here.day - before.day) * inPart;
    const leaveX = here.x + (after.x - here.x) * outPart;
    const leaveY = here.y + (after.y - here.y) * outPart;
    const leaveDay = here.day + (after.day - here.day) * outPart;
    put(enterDay, enterX, enterY);
    for (let step = 1; step <= ROUND_STEPS; step += 1) {
      const u = step / ROUND_STEPS;
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      put(enterDay + (leaveDay - enterDay) * u, a * enterX + b * here.x + c * leaveX, a * enterY + b * here.y + c * leaveY);
    }
  }
  return { days: Float64Array.from(days), xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
};

// ---- a battlefield readied to be played ----------------------------------------------

// What frontAt needs of a view (record.js frontViewOf), made once for it: each
// troop's curve.
const stages = new WeakMap();
export const stageOf = (view) => {
  let stage = stages.get(view);
  if (stage) return stage;
  const { toLngLat } = projectorOf(view.frame);
  const labels = new Map();
  for (const entry of view.named ?? []) labels.set(`${entry.s}:${entry.i}`, entry.name);
  const replay = view.replay;
  const troops = view.troops.map((list, side) => {
    const tracks = replay?.tracks?.[side] ?? [];
    const count = Math.max(list.length, tracks.length);
    const made = [];
    for (let index = 0; index < count; index += 1) {
      const standing = list[index] ?? null;
      const track = tracks[index] ?? [];
      const curve = curveOf(track);
      // The last point of the curve at which it still stood where it began:
      // its way starts there, and it has none until it has left.
      let setOff = 0;
      while (setOff + 1 < curve.days.length && curve.xs[setOff + 1] === curve.xs[0] && curve.ys[setOff + 1] === curve.ys[0]) setOff += 1;
      // The stretches of its path it did not walk as an attacker: falling back,
      // giving ground, coming up behind the line. A way is drawn for an advance
      // and for nothing else, so each of these ends the way that led up to it.
      const breaks = [];
      for (let point = 1; point < track.length; point += 1) {
        const moved = Math.abs(track[point].x - track[point - 1].x) > 1 / 32 || Math.abs(track[point].y - track[point - 1].y) > 1 / 32;
        if (!moved || TROOP_STATES[track[point].state] === ADVANCING) continue;
        const last = breaks[breaks.length - 1];
        if (last && last.to === track[point - 1].day) last.to = track[point].day;
        else breaks.push({ from: track[point - 1].day, to: track[point].day });
      }
      const command = view.commands?.[side]?.[index];
      made.push({
        track,
        curve,
        setOff,
        breaks,
        command: Number.isInteger(command) ? command : -1,
        kind: TROOP_KINDS[standing?.kind ?? 0] ?? TROOP_KINDS[0],
        owner: view.sides[side]?.[standing?.owner ?? 0] ?? view.sides[side]?.[0] ?? "",
        named: standing?.named === true,
        label: standing?.named === true ? labels.get(`${side}:${index}`) ?? "" : "",
        // A troop the replay has no path for is where the record has it.
        standing,
      });
    }
    return made;
  });
  stage = {
    view,
    toLngLat,
    troops,
    known: Boolean(replay),
    start: replay?.start ?? 0,
    // The last day of the battlefield's own replay, and of the run.
    last: replay?.end ?? 0,
    end: replay?.days ?? 0,
  };
  stages.set(view, stage);
  return stage;
};

const troopAt = (stage, troop, day) => {
  const { track, curve, setOff } = troop;
  if (track.length === 0) {
    const standing = troop.standing;
    if (!standing || !(standing.strength > 0)) return null;
    return {
      x: standing.x, y: standing.y, strength: standing.strength, state: TROOP_STATES[standing.state] ?? TROOP_STATES[0],
      kind: troop.kind, owner: troop.owner, named: troop.named, label: troop.label, command: troop.command, moving: false, way: null,
    };
  }
  if (day < track[0].day) return null;
  // What it was doing, and how strong it was, by the points kept.
  let sample = 1;
  while (sample < track.length && track[sample].day < day) sample += 1;
  const last = track[track.length - 1];
  const ended = day >= last.day;
  const to = ended ? last : track[sample];
  const from = ended ? last : track[sample - 1];
  const span = to.day - from.day;
  const part = ended || !(span > 0) ? 1 : (day - from.day) / span;
  const strength = from.strength + (to.strength - from.strength) * part;
  if (!(strength > 0)) return null;
  // Where it was, by the curve through them, and the way it has come.
  let point = 1;
  const count = curve.days.length;
  while (point < count && curve.days[point] < day) point += 1;
  let x;
  let y;
  let way = null;
  if (point >= count) {
    x = curve.xs[count - 1];
    y = curve.ys[count - 1];
    if (count - 1 > setOff) way = { xs: curve.xs.subarray(setOff), ys: curve.ys.subarray(setOff), days: curve.days.subarray(setOff) };
  } else {
    const leg = curve.days[point] - curve.days[point - 1];
    const along = leg > 0 ? (day - curve.days[point - 1]) / leg : 1;
    x = curve.xs[point - 1] + (curve.xs[point] - curve.xs[point - 1]) * along;
    y = curve.ys[point - 1] + (curve.ys[point] - curve.ys[point - 1]) * along;
    if (point - 1 > setOff || (point - 1 === setOff && along > 0)) {
      const gone = point - setOff;
      const xs = new Float64Array(gone + 1);
      const ys = new Float64Array(gone + 1);
      const days = new Float64Array(gone + 1);
      xs.set(curve.xs.subarray(setOff, point));
      ys.set(curve.ys.subarray(setOff, point));
      days.set(curve.days.subarray(setOff, point));
      xs[gone] = x;
      ys[gone] = y;
      days[gone] = day;
      way = { xs, ys, days };
    }
  }
  // A troop that is falling back has no way drawn at all, and one that has
  // fallen back and gone forward again has only the way it has come since.
  if (way) {
    let since = -Infinity;
    for (const leg of troop.breaks) {
      if (leg.from >= day) break;
      if (day <= leg.to) {
        way = null;
        break;
      }
      since = leg.to;
    }
    if (way && since > way.days[0]) [, way] = cutWay(way, since);
  }
  return {
    x, y, strength, state: TROOP_STATES[to.state] ?? TROOP_STATES[0],
    kind: troop.kind, owner: troop.owner, named: troop.named, label: troop.label, command: troop.command,
    moving: !ended && (Math.abs(to.x - from.x) > 1 / 32 || Math.abs(to.y - from.y) > 1 / 32),
    way,
  };
};

// Whether a battlefield is to be seen at all on a day of its run: not before
// it opened, and not once it has closed.
export const frontShownOn = (stage, day) =>
  stage.known && day >= stage.start && !(stage.view.status === "closed" && day >= stage.last);

// A battlefield's troops as they were on a day of its run (a fraction of a day
// is fine): null when it is not to be seen that day.
export const frontAt = (stage, day) => {
  if (!frontShownOn(stage, day)) return null;
  const { view } = stage;
  return {
    name: view.name,
    status: view.status,
    sides: view.sides,
    frame: view.frame,
    toLngLat: stage.toLngLat,
    stage,
    troops: stage.troops.map((list) => list.map((troop) => troopAt(stage, troop, day))),
  };
};

// ---- what the layers read --------------------------------------------------------------

// A point a troop, and one a general: where his body of troops is on average,
// with how many they are, for a view from too far off to tell them apart (a
// side that was never shared out among generals has one for all of it).
// `colorOf(name)` gives a css colour; `labelOf` shortens a named formation's
// name to what fits under a counter.
export const frontTroopFeatures = (shown, colorOf, { labelOf = (name) => name } = {}) => {
  const features = [];
  for (const drawing of shown) {
    if (!drawing) continue;
    const { toLngLat } = drawing;
    drawing.troops.forEach((list, side) => {
      const bodies = new Map();
      list.forEach((troop, index) => {
        if (!troop) return;
        const command = troop.command ?? -1;
        const body = bodies.get(command) ?? { count: 0, x: 0, y: 0, strength: 0, owners: new Map() };
        bodies.set(command, body);
        body.count += 1;
        body.x += troop.x;
        body.y += troop.y;
        body.strength += troop.strength;
        body.owners.set(troop.owner, (body.owners.get(troop.owner) ?? 0) + 1);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: toLngLat(troop.x, troop.y) },
          properties: {
            what: "troop",
            battlefield: drawing.name,
            side,
            index,
            command,
            owner: troop.owner,
            rgb: colorOf(troop.owner),
            kind: troop.kind,
            glyph: TROOP_KIND_GLYPH[troop.kind] ?? "I",
            strength: Math.round(troop.strength),
            state: troop.state,
            named: troop.named,
            moving: troop.moving,
            label: troop.label ? labelOf(troop.label) : "",
          },
        });
      });
      for (const [command, body] of [...bodies].sort((a, b) => a[0] - b[0])) {
        // In the colour of whoever most of the body belongs to: the side's first member unless another has more.
        let owner = drawing.sides[side]?.[0] ?? "";
        let most = body.owners.get(owner) ?? 0;
        for (const [name, count] of body.owners) {
          if (count > most) {
            most = count;
            owner = name;
          }
        }
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: toLngLat(body.x / body.count, body.y / body.count) },
          properties: {
            what: "side",
            battlefield: drawing.name,
            side,
            command,
            owner,
            rgb: colorOf(owner),
            count: body.count,
            strength: Math.round(body.strength / body.count),
          },
        });
      }
    });
  }
  return features.length ? { type: "FeatureCollection", features } : EMPTY;
};

// ---- the way a troop came, as an arrow ---------------------------------------------

// How many days of a troop's way count as just gone. Its arrow is drawn along
// that much of the way behind it, and what it walked before is a faint line,
// so that a month of fighting does not bury the map in arrows while every way
// can still be followed back to where it began. This is the number from close
// in; from far off an arrow lies along more days (arrowDetailAt), since six
// days' march is a stub on a map of the whole front.
export const ARROW_FRESH_DAYS = 6;
const ARROW_DAYS_MOST = 20;
// The width an arrow begins at, as a part of its full width, and the head's
// length and half-width in half-widths of the arrow.
const ARROW_TAIL = 0.3;
const ARROW_HEAD_LENGTH = 3.2;
const ARROW_HEAD_HALF = 2.3;

// One arrow as a ring of [x, y] in the frame's cell units: the way a troop
// came (frontAt's `way`), thin where it walked long ago, widening over the
// last days of it, with a head at where the troop is on `day`. `halfWidth` is
// half the arrow's full width, in cells, and `over` how many days it widens
// over. null for a way too short to draw.
export const arrowRing = (way, day, halfWidth, over = ARROW_FRESH_DAYS) => {
  // The way without the points that stand on the one before.
  const xs = [];
  const ys = [];
  const days = [];
  for (let index = 0; index < way.xs.length; index += 1) {
    const last = xs.length - 1;
    if (last >= 0 && Math.abs(way.xs[index] - xs[last]) < 1e-6 && Math.abs(way.ys[index] - ys[last]) < 1e-6) {
      days[last] = way.days[index];
      continue;
    }
    xs.push(way.xs[index]);
    ys.push(way.ys[index]);
    days.push(way.days[index]);
  }
  const count = xs.length;
  if (count < 2 || !(halfWidth > 0)) return null;
  const along = [0];
  for (let index = 1; index < count; index += 1) along.push(along[index - 1] + Math.hypot(xs[index] - xs[index - 1], ys[index] - ys[index - 1]));
  const total = along[count - 1];
  if (!(total > halfWidth * 0.6)) return null;

  // An arrow keeps its proportions: one on a way too short for its head is
  // the same arrow smaller, and grows to its full width as the way lengthens.
  const fit = Math.min(1, (total * 0.7) / (ARROW_HEAD_LENGTH * halfWidth));
  const half = halfWidth * fit;
  const headLength = ARROW_HEAD_LENGTH * half;
  const headHalf = ARROW_HEAD_HALF * half;
  const neck = total - headLength;
  const widthOn = (when) => {
    let fresh = (when - (day - over)) / over;
    if (fresh < 0) fresh = 0;
    else if (fresh > 1) fresh = 1;
    return half * (ARROW_TAIL + (1 - ARROW_TAIL) * fresh * fresh * (3 - 2 * fresh));
  };
  const left = [];
  const right = [];
  const put = (x, y, tx, ty, width) => {
    const length = Math.hypot(tx, ty) || 1;
    const nx = -ty / length;
    const ny = tx / length;
    left.push([x + nx * width, y + ny * width]);
    right.push([x - nx * width, y - ny * width]);
  };
  let segment = 1;
  for (let index = 0; index < count && along[index] < neck; index += 1) {
    const before = Math.max(0, index - 1);
    const after = Math.min(count - 1, index + 1);
    put(xs[index], ys[index], xs[after] - xs[before], ys[after] - ys[before], widthOn(days[index]));
    segment = index + 1;
  }
  // Where the head begins, on the leg that crosses it.
  const leg = along[segment] - along[segment - 1];
  const part = leg > 0 ? Math.max(0, Math.min(1, (neck - along[segment - 1]) / leg)) : 0;
  const neckX = xs[segment - 1] + (xs[segment] - xs[segment - 1]) * part;
  const neckY = ys[segment - 1] + (ys[segment] - ys[segment - 1]) * part;
  const tipX = xs[count - 1];
  const tipY = ys[count - 1];
  let headX = tipX - neckX;
  let headY = tipY - neckY;
  const headSpan = Math.hypot(headX, headY);
  if (!(headSpan > 1e-9)) return null;
  headX /= headSpan;
  headY /= headSpan;
  put(neckX, neckY, headX, headY, Math.min(widthOn(days[segment - 1] + (days[segment] - days[segment - 1]) * part), headHalf * 0.6));
  const ring = [
    ...left,
    [neckX - headY * headHalf, neckY + headX * headHalf],
    [tipX, tipY],
    [neckX + headY * headHalf, neckY - headX * headHalf],
    ...right.reverse(),
  ];
  ring.push(ring[0]);
  return ring;
};

// ---- troops going one way together, as one arrow -------------------------------------

// A front may be hundreds of troops thick, and an arrow each would be a
// thicket. Troops of a side that go the same way close together are drawn as
// one arrow along the middle of their ways, the broader for the more of them
// there are. How close counts as together is given in cells and comes from the
// zoom (arrowDetailAt): on screen it is a greater distance the further off the
// map is seen from, so from far off a whole offensive is a handful of broad
// arrows, and close up each column has its own.
//
// Who shares an arrow is worked out for the days an arrow covers, and again
// every few days of the run: troops that march together for a week and then
// part share an arrow that week and not after, however long the run. One
// grouping gives way to the next over a day, the arrows of the one fading as
// those of the other come up, so nothing on the map jumps.

// Where every troop is at every half day of the run, worked out once.
const STEPS_PER_DAY = 2;
const STILL = 0.02;
const tableOf = (stage) => {
  if (stage.table) return stage.table;
  const steps = Math.max(0, Math.round((stage.end - stage.start) * STEPS_PER_DAY));
  const sides = stage.troops.map((list) => list.map((troop) => {
    const { curve } = troop;
    const count = curve.days.length;
    if (count < 2) return null;
    const xs = new Float32Array(steps + 1);
    const ys = new Float32Array(steps + 1);
    const moved = new Uint8Array(steps + 1);
    // How many of the steps up to each it moved in.
    const sum = new Uint16Array(steps + 1);
    let point = 1;
    let moves = 0;
    let far = 0;
    let first = steps;
    for (let step = 0; step <= steps; step += 1) {
      const day = stage.start + step / STEPS_PER_DAY;
      while (point < count - 1 && curve.days[point] < day) point += 1;
      if (day <= curve.days[0]) {
        xs[step] = curve.xs[0];
        ys[step] = curve.ys[0];
      } else if (day >= curve.days[count - 1]) {
        xs[step] = curve.xs[count - 1];
        ys[step] = curve.ys[count - 1];
      } else {
        const leg = curve.days[point] - curve.days[point - 1];
        const along = leg > 0 ? (day - curve.days[point - 1]) / leg : 1;
        xs[step] = curve.xs[point - 1] + (curve.xs[point] - curve.xs[point - 1]) * along;
        ys[step] = curve.ys[point - 1] + (curve.ys[point] - curve.ys[point - 1]) * along;
      }
      if (step > 0) {
        const gone = Math.hypot(xs[step] - xs[step - 1], ys[step] - ys[step - 1]);
        if (gone > STILL) {
          moved[step] = 1;
          if (moves === 0) first = step - 1;
          moves += 1;
          far += gone;
        }
        sum[step] = moves;
      }
    }
    return moves > 0 ? { xs, ys, moved, sum, far, first } : null;
  }));
  // Each side's troops that go anywhere, the furthest-travelled first: the
  // order in which they are tried as the one others gather round. It is the
  // same all run, so a grouping changes only when the troops do.
  const order = sides.map((list) => {
    const movers = [];
    list.forEach((entry, index) => {
      if (entry) movers.push(index);
    });
    return movers.sort((a, b) => list[b].far - list[a].far || a - b);
  });
  stage.table = { steps, sides, order };
  stage.groups = new Map();
  return stage.table;
};

// How many days a grouping stands for, and over how many of them it takes
// over from the one before.
export const ARROW_GROUP_DAYS = 3;
const ARROW_FADE_DAYS = 1;
// A reach is rounded to one of this many to a doubling, so that a map being
// zoomed does not ask for a grouping of its own at every step of the way.
const REACH_KEYS = 6;
const MAX_GROUPINGS = 240;

// How far apart two troops of a side keep, on average, over the steps from
// `from` to `to` in which either moves: Infinity when they are not going the
// same way together within `within` cells.
const apartOf = (lead, other, from, to, within) => {
  // The same way: within sixty degrees of each other.
  if (lead.hx * other.hx + lead.hy * other.hy < 0.5 * lead.gone * other.gone) return Infinity;
  const a = lead.entry;
  const b = other.entry;
  const worst = within * 1.7;
  let steps = 0;
  let sum = 0;
  for (let step = from + 1; step <= to; step += 1) {
    if (!a.moved[step] && !b.moved[step]) continue;
    const apart = Math.hypot(a.xs[step] - b.xs[step], a.ys[step] - b.ys[step]);
    if (apart > worst) return Infinity;
    steps += 1;
    sum += apart;
  }
  if (steps === 0) return Infinity;
  const mean = sum / steps;
  return mean <= within ? mean : Infinity;
};

// Which grouping a day of the run is drawn with.
const bucketOf = (stage, day, days) => {
  const last = Math.ceil((stage.end - stage.start + days) / ARROW_GROUP_DAYS);
  return Math.max(0, Math.min(last, Math.floor((day - stage.start) / ARROW_GROUP_DAYS + 1e-9)));
};

// Who shares an arrow in one grouping: [{ side, members, key }], two or more
// in each, the one the others gathered round first. It is made from the days
// an arrow drawn in it covers. A troop counts if it gets somewhere in them
// (further than `least` cells: an arrow shorter than that is not drawn). The
// furthest-travelled leads; each of the rest joins the nearest leader it goes
// the same way as and keeps within `reach` cells of, or leads itself. Joining
// is to a leader only, never through a chain of neighbours, so a broad front
// is several arrows side by side and not one down its middle. `days` is how
// many days an arrow covers.
const groupingOf = (stage, bucket, reach, least, days) => {
  const table = tableOf(stage);
  const reachKey = Math.round(Math.log2(Math.max(reach, 1e-3)) * REACH_KEYS);
  const leastKey = Math.round(Math.max(0, least) * 8);
  const key = `${bucket}:${reachKey}:${leastKey}:${Math.round(days * 2)}`;
  const known = stage.groups.get(key);
  if (known) return known;
  const within = 2 ** (reachKey / REACH_KEYS);
  const atLeast = Math.max(leastKey / 8, STILL * 4);
  const from = Math.min(table.steps, Math.max(0, Math.round((bucket * ARROW_GROUP_DAYS - days) * STEPS_PER_DAY)));
  const to = Math.min(table.steps, (bucket + 1) * ARROW_GROUP_DAYS * STEPS_PER_DAY);
  const groups = [];
  if (to > from) {
    table.sides.forEach((list, side) => {
      const leaders = [];
      for (const index of table.order[side]) {
        const entry = list[index];
        if (entry.sum[to] - entry.sum[from] < 2) continue;
        const hx = entry.xs[to] - entry.xs[from];
        const hy = entry.ys[to] - entry.ys[from];
        const gone = Math.hypot(hx, hy);
        if (!(gone > atLeast)) continue;
        const mover = { entry, hx, hy, gone };
        let best = null;
        let nearest = Infinity;
        for (const leader of leaders) {
          const apart = apartOf(leader.lead, mover, from, to, within);
          if (apart < nearest) {
            nearest = apart;
            best = leader;
          }
        }
        if (best) best.members.push(index);
        else leaders.push({ lead: mover, members: [index] });
      }
      for (const { members } of leaders) {
        if (members.length < 2) continue;
        groups.push({ side, members, key: `${side}:${[...members].sort((a, b) => a - b).join(",")}` });
      }
    });
  }
  if (stage.groups.size >= MAX_GROUPINGS) stage.groups.clear();
  stage.groups.set(key, groups);
  return groups;
};

// Which troops share an arrow on a day of the run, for troops counted as
// together within `reach` cells: [{ side, members, key }].
export const arrowGroupsOf = (stage, day, reach, least = 0, days = ARROW_FRESH_DAYS) =>
  groupingOf(stage, bucketOf(stage, day, days), reach, least, days);

// The middle of a group's members at every step of the run, and the step
// before the first of them set off.
const middleOf = (table, group) => {
  if (group.middle) return group.middle;
  const xs = new Float32Array(table.steps + 1);
  const ys = new Float32Array(table.steps + 1);
  let first = table.steps;
  for (const member of group.members) {
    const entry = table.sides[group.side][member];
    for (let step = 0; step <= table.steps; step += 1) {
      xs[step] += entry.xs[step];
      ys[step] += entry.ys[step];
    }
    if (entry.first < first) first = entry.first;
  }
  for (let step = 0; step <= table.steps; step += 1) {
    xs[step] /= group.members.length;
    ys[step] /= group.members.length;
  }
  group.middle = { xs, ys, first };
  return group.middle;
};

// The way a group came between two days of the run (the middle of its
// members' ways), as { xs, ys, days }: null when it had not set off by the
// second, or the two are the same.
const groupWay = (stage, group, since, day) => {
  const table = tableOf(stage);
  const middle = middleOf(table, group);
  const upTo = Math.min(table.steps, (day - stage.start) * STEPS_PER_DAY);
  const begin = Math.max(middle.first, (since - stage.start) * STEPS_PER_DAY);
  if (!(upTo > begin)) return null;
  const xs = [];
  const ys = [];
  const days = [];
  const put = (at) => {
    const step = Math.min(table.steps, Math.floor(at));
    const next = Math.min(table.steps, step + 1);
    const part = at - step;
    xs.push(middle.xs[step] + (middle.xs[next] - middle.xs[step]) * part);
    ys.push(middle.ys[step] + (middle.ys[next] - middle.ys[step]) * part);
    days.push(stage.start + at / STEPS_PER_DAY);
  };
  put(begin);
  for (let step = Math.floor(begin) + 1; step < upTo; step += 1) put(step);
  put(upTo);
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), days: Float64Array.from(days) };
};

// A way cut in two at a day: what was walked before it, and what since. Either
// may be null.
const cutWay = (way, since) => {
  const count = way.days.length;
  if (!(way.days[0] < since)) return [null, way];
  if (way.days[count - 1] <= since) return [way, null];
  let first = 0;
  while (first + 1 < count && way.days[first + 1] <= since) first += 1;
  const span = way.days[first + 1] - way.days[first];
  const part = span > 0 ? (since - way.days[first]) / span : 0;
  const cutX = way.xs[first] + (way.xs[first + 1] - way.xs[first]) * part;
  const cutY = way.ys[first] + (way.ys[first + 1] - way.ys[first]) * part;
  return [
    { xs: [...way.xs.subarray(0, first + 1), cutX], ys: [...way.ys.subarray(0, first + 1), cutY] },
    {
      xs: Float64Array.of(cutX, ...way.xs.subarray(first + 1)),
      ys: Float64Array.of(cutY, ...way.ys.subarray(first + 1)),
      days: Float64Array.of(since, ...way.days.subarray(first + 1)),
    },
  ];
};

const lengthOf = (way) => {
  let total = 0;
  for (let index = 1; index < way.xs.length; index += 1) total += Math.hypot(way.xs[index] - way.xs[index - 1], way.ys[index] - way.ys[index - 1]);
  return total;
};

// How much broader than one troop's arrow a group's is, and how near (in
// half-widths of an arrow) two troops must keep to share one when no reach is
// given.
const groupBreadth = (count) => Math.min(2.8, 1 + 0.36 * Math.sqrt(count - 1));
export const ARROW_MERGE_REACH = 11;
// A line's points are no closer together than this, in cells.
const LINE_STEP = 0.25;

// How the arrows are drawn at a zoom of the map, in px on screen: half the
// full width of one troop's arrow; how near two troops keep to share one; the
// shortest way an arrow is drawn along; how many days of the way an arrow
// lies along (more from far off, so that it is about as long on screen from
// anywhere: a sweep, not a stub); and whether the line of a way is drawn
// for a troop that has no arrow now; and how great a part of its side's
// troops an arrow must stand for to be drawn at all. The further off, the
// fewer and the broader: the reach on screen GROWS as the map is seen from
// further away, while a front's length on screen halves with every step out,
// so a front that is two hundred arrows from close in is a dozen from far
// off, and some thirty from the distance a whole front fills the screen at.
// What is left out from far off is the small: short movements, a few
// troops going their own way beside an offensive of hundreds, and the ways of
// those standing still (the ground they took says where they went). A
// formation with a name of its own always has its arrow.
const ARROW_HALF_WIDTH_STOPS = [[4, 1.6], [5.5, 2.6], [7, 4.2], [9, 6], [11, 8]];
const ARROW_REACH_STOPS = [[4.5, 90], [6, 76], [7.5, 62], [9, 56], [11, 88]];
const ARROW_LEAST_STOPS = [[5, 10], [7, 7], [9, 3], [10, 0]];
const ARROW_SHARE_STOPS = [[5, 0.012], [6, 0.008], [7, 0.004], [7.5, 0]];
export const ARROW_STILL_MIN_ZOOM = 7.5;
const stopsAt = (stops, zoom) => {
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    if (zoom <= stops[index][0]) {
      const [z0, v0] = stops[index - 1];
      const [z1, v1] = stops[index];
      return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return stops[stops.length - 1][1];
};
export const arrowDetailAt = (zoom) => ({
  halfWidth: stopsAt(ARROW_HALF_WIDTH_STOPS, zoom),
  reach: stopsAt(ARROW_REACH_STOPS, zoom),
  least: stopsAt(ARROW_LEAST_STOPS, zoom),
  share: stopsAt(ARROW_SHARE_STOPS, zoom),
  // Twice the days for every step out from zoom 7, to the half day.
  days: Math.round(Math.max(ARROW_FRESH_DAYS, Math.min(ARROW_DAYS_MOST, ARROW_FRESH_DAYS * 2 ** (7 - zoom))) * 2) / 2,
  still: zoom >= ARROW_STILL_MIN_ZOOM,
});

// The ways the troops have come so far this run, as arrows: one for troops
// going the same way together, one each for the rest. `colorsOf(name)` gives
// an arrow's colours for whose troops they are, as { top, side } (css
// colours: its face, and the darker edge that gives it depth). The measures
// are in a battlefield's cells, each a function of the drawing:
// `halfWidthOf` half the full width of one troop's arrow, `reachOf` how near
// troops keep to share one (left out, ARROW_MERGE_REACH half-widths), and
// `leastOf` the shortest way an arrow is drawn along (left out, any).
// `day` is the day each drawing is of (left out, each arrow is drawn for the
// day its troop reached, and none are shared). A way is written out as two
// things: an arrow along its last `days` days, and a line (`past`) along what
// was walked before them; with `still` false the line is left out for a way
// that has no arrow now. `share` is how great a part of its side's standing
// troops an arrow must stand for to be drawn (a formation with a name of its
// own is always drawn). `troops` is how many share it, and `alpha` how
// much of it shows (less than 1 while one grouping gives way to the next).
export const frontArrowFeatures = (shown, colorsOf, {
  day = null, halfWidthOf = () => 0.5, reachOf = null, leastOf = null, still = true, share = 0, days = ARROW_FRESH_DAYS,
} = {}) => {
  const features = [];
  shown.forEach((drawing, at) => {
    if (!drawing) return;
    const { toLngLat, stage } = drawing;
    const halfWidth = halfWidthOf(drawing);
    const least = leastOf ? leastOf(drawing) : 0;
    const now = Array.isArray(day) ? day[at] : day;
    const staged = Boolean(stage) && now !== null && now !== undefined;
    // The fewest troops an arrow of each side is drawn for.
    const fewest = drawing.troops.map((list) => {
      let count = 0;
      for (const troop of list) if (troop) count += 1;
      return Math.max(1, Math.ceil(share * count));
    });

    // What is drawn of one way: `past` what was walked before the last few
    // days, `recent` those days.
    const write = (past, recent, when, breadth, properties, alpha) => {
      if (!(alpha > 0.02)) return;
      const ring = recent && (!(least > 0) || lengthOf(recent) >= least) ? arrowRing(recent, when, halfWidth * breadth, days) : null;
      if (past && (ring || still)) {
        const line = [];
        let lastX = 0;
        let lastY = 0;
        const end = past.xs.length - 1;
        for (let index = 0; index <= end; index += 1) {
          const x = past.xs[index];
          const y = past.ys[index];
          if (line.length > 0 && index < end && Math.hypot(x - lastX, y - lastY) < LINE_STEP) continue;
          if (line.length > 0 && Math.abs(x - lastX) < 1e-6 && Math.abs(y - lastY) < 1e-6) continue;
          line.push(toLngLat(x, y));
          lastX = x;
          lastY = y;
        }
        if (line.length >= 2) {
          features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { battlefield: drawing.name, ...properties, past: true, alpha } });
        }
      }
      if (!ring) return;
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring.map(([x, y]) => toLngLat(x, y))] },
        properties: { battlefield: drawing.name, ...properties, past: false, alpha },
      });
    };
    const single = (troop, side, index, alpha) => {
      if (fewest[side] > 1 && !troop.named) return;
      const when = now ?? troop.way.days[troop.way.days.length - 1];
      const [past, recent] = cutWay(troop.way, when - days);
      const colours = colorsOf(troop.owner);
      write(past, recent, when, 1, { side, index, troops: 1, rgb: colours.top, dark: colours.side, moving: troop.moving }, alpha);
    };
    // Those of a group that stand on the day drawn: it is drawn as one when
    // two or more do.
    const standing = (group) => group.members.filter((member) => drawing.troops[group.side][member]);
    const shared = (group, present, alpha) => {
      if (present.length < fewest[group.side] && !present.some((member) => drawing.troops[group.side][member].named)) return;
      const since = now - days;
      const recent = groupWay(stage, group, since, now);
      const past = recent || still ? groupWay(stage, group, stage.start, Math.min(now, since)) : null;
      const lead = drawing.troops[group.side][present[0]];
      const colours = colorsOf(lead.owner);
      write(past, recent, now, groupBreadth(present.length), {
        side: group.side,
        index: group.members[0],
        troops: present.length,
        rgb: colours.top,
        dark: colours.side,
        moving: present.some((member) => drawing.troops[group.side][member].moving),
      }, alpha);
    };

    // Who shares an arrow on the day this drawing is of, and, while that
    // grouping is taking over from the one before it, who did then.
    const together = [new Set(), new Set()];
    const wasTogether = [new Set(), new Set()];
    let fading = false;
    let shows = 1;
    if (staged) {
      const reach = reachOf ? reachOf(drawing) : halfWidth * ARROW_MERGE_REACH;
      const bucket = bucketOf(stage, now, days);
      const current = groupingOf(stage, bucket, reach, least, days);
      const into = (now - stage.start - bucket * ARROW_GROUP_DAYS) / ARROW_FADE_DAYS;
      const before = bucket > 0 && into >= 0 && into < 1 ? groupingOf(stage, bucket - 1, reach, least, days) : null;
      if (before) {
        fading = true;
        shows = into * into * (3 - 2 * into);
      }
      const keys = new Set(current.map((group) => group.key));
      const keysBefore = new Set(before ? before.map((group) => group.key) : []);
      for (const group of current) {
        const present = standing(group);
        if (present.length < 2) continue;
        for (const member of group.members) together[group.side].add(member);
        shared(group, present, fading && !keysBefore.has(group.key) ? shows : 1);
      }
      for (const group of before ?? []) {
        const present = standing(group);
        if (present.length < 2) continue;
        for (const member of group.members) wasTogether[group.side].add(member);
        if (!keys.has(group.key)) shared(group, present, 1 - shows);
      }
    }
    drawing.troops.forEach((list, side) => list.forEach((troop, index) => {
      if (!troop?.way) return;
      const grouped = together[side].has(index);
      const wasGrouped = fading ? wasTogether[side].has(index) : grouped;
      if (!grouped) single(troop, side, index, wasGrouped ? shows : 1);
      else if (!wasGrouped) single(troop, side, index, 1 - shows);
    }));
  });
  return features.length ? { type: "FeatureCollection", features } : EMPTY;
};

// A side's colour as its arrows are drawn in: the same hue, made strong and
// neither dark nor pale. A country's own colour is chosen to fill land, and an
// arrow in it would not show on ground painted that colour.
export const frontArrowRgb = ([red, green, blue]) => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const most = Math.max(r, g, b);
  const least = Math.min(r, g, b);
  const spread = most - least;
  let lightness = (most + least) / 2;
  if (spread < 0.04) {
    // No hue to speak of: a grey stays grey, only lighter.
    const grey = Math.round(255 * Math.max(0.7, lightness));
    return [grey, grey, grey];
  }
  let hue;
  if (most === r) hue = ((g - b) / spread + 6) % 6;
  else if (most === g) hue = (b - r) / spread + 2;
  else hue = (r - g) / spread + 4;
  const saturation = Math.max(0.55, spread / (1 - Math.abs(2 * lightness - 1)));
  lightness = Math.min(0.62, Math.max(0.52, lightness));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * Math.min(1, saturation);
  const second = chroma * (1 - Math.abs((hue % 2) - 1));
  const base = lightness - chroma / 2;
  const [r1, g1, b1] = hue < 1 ? [chroma, second, 0] : hue < 2 ? [second, chroma, 0] : hue < 3 ? [0, chroma, second]
    : hue < 4 ? [0, second, chroma] : hue < 5 ? [second, 0, chroma] : [chroma, 0, second];
  return [Math.round((r1 + base) * 255), Math.round((g1 + base) * 255), Math.round((b1 + base) * 255)];
};
