/*! Open Historia — battlefields and fronts: an engineer for the countries nobody plays (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. "Make it also be able to control and understand
// fortifications, fleets and blockades, plane attacks, and litterally
// everything" (the owner, 2026-10-14).
//
// A person draws fortified lines in the war room (fortifyOps.js); a country
// nobody plays had nobody to draw any. After a turn's fighting, this engineer
// has one built for a country nobody plays that leads a side outmatched on a
// battlefield (its side's strength there under ENGINEER_OUTMATCHED of the
// other's) and is building no line already:
//
//   where     along its side of the front, ENGINEER_BEHIND_KM behind it, on the
//             longest stretch of the front its side holds, at most
//             ENGINEER_KM_MOST of it about that stretch's middle
//   how high  the highest level, ENGINEER_LEVEL_MOST down to 3, whose building
//             takes no longer than ENGINEER_DAYS_MOST (fortifyCost.js: its
//             length, the country's treasury and its men); where none would,
//             a shorter line about the same middle, down to ENGINEER_KM_LEAST
//   how       by the very op a person's war room sends (applyFortifyOp): on the
//             country's own ground, every kilometre of it, or not at all
//
// Pure: the same world, the same lines.

import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { applyFortifyOp } from "./fortifyOps.js";
import { projectorOf } from "./frame.js";
import { holderAt } from "./record.js";
import { standsOn } from "./walls.js";
import { fortifyCostReckoner } from "../fortifyCost.js";
import { normalizeFortifications } from "../warGeography.js";

export const ENGINEER_OUTMATCHED = 0.8;
export const ENGINEER_BEHIND_KM = 25;
export const ENGINEER_KM_MOST = 300;
export const ENGINEER_DAYS_MOST = 60;
export const ENGINEER_LEVEL_MOST = 7;
export const ENGINEER_KM_LEAST = 30;
// Every so many cells along the front a point of the line is read.
const READ_EVERY = 2;

const list = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const kmBetween = (kmAt, frame, [lngA, latA], [lngB, latB]) => {
  const { toCell } = projectorOf(frame);
  const [ax, ay] = toCell(lngA, latA);
  const [bx, by] = toCell(lngB, latB);
  const km = kmAt((ay + by) / 2);
  const dx = (ax - bx) * km;
  const dy = (ay - by) * km;
  return Math.sqrt(dx * dx + dy * dy);
};

// A line along a side's front on a battlefield, ENGINEER_BEHIND_KM back from it into the side's own ground:
// [[lng, lat], ...], or [] where there is none to draw. Read across the frame both ways (row by row and column by
// column), whichever finds the front more often.
export const frontLineFor = (record, side, { behindKm = ENGINEER_BEHIND_KM, mostKm = ENGINEER_KM_MOST } = {}) => {
  const frame = record?.frame;
  if (!frame || !(frame.cols > 0) || !(frame.rows > 0)) return [];
  const { toLngLat, kmAt } = projectorOf(frame);
  const other = side === HOLDER_SIDE_A ? HOLDER_SIDE_B : HOLDER_SIDE_A;
  const holder = (x, y) => {
    const [lng, lat] = toLngLat(x, y);
    return holderAt(record, lng, lat);
  };
  const scan = (alongRows) => {
    const outer = alongRows ? frame.rows : frame.cols;
    const inner = alongRows ? frame.cols : frame.rows;
    const points = [];
    for (let a = 0.5; a < outer; a += READ_EVERY) {
      let was = -1;
      let crossing = null;
      for (let b = 0.5; b < inner; b += 1) {
        const here = alongRows ? holder(b, a) : holder(a, b);
        if (here !== side && here !== other) continue;
        if (was >= 0 && here !== was) {
          // Its own ground lies back the way the read came from (was === side) or on the way on.
          crossing = { at: b, back: was === side ? -1 : 1 };
          break;
        }
        was = here;
      }
      if (!crossing) continue;
      const cells = behindKm / kmAt(alongRows ? a : crossing.at);
      const b = crossing.at + crossing.back * cells;
      const [x, y] = alongRows ? [b, a] : [a, b];
      if (x < 0 || y < 0 || x >= frame.cols || y >= frame.rows || holder(x, y) !== side) continue;
      points.push(toLngLat(x, y));
    }
    return points;
  };
  const rows = scan(true);
  const cols = scan(false);
  const points = rows.length >= cols.length ? rows : cols;
  if (points.length < 2) return [];
  // The longest stretch with no great gap in it, and of that at most mostKm about its middle.
  const gap = 4 * READ_EVERY * frame.km;
  const runs = [[points[0]]];
  for (let at = 1; at < points.length; at += 1) {
    if (kmBetween(kmAt, frame, points[at - 1], points[at]) > gap) runs.push([]);
    runs[runs.length - 1].push(points[at]);
  }
  let longest = runs.reduce((best, run) => (run.length > best.length ? run : best), runs[0]);
  if (longest.length < 2) return [];
  const lengthOf = (run) => run.slice(1).reduce((sum, point, at) => sum + kmBetween(kmAt, frame, run[at], point), 0);
  while (longest.length > 2 && lengthOf(longest) > mostKm) longest = longest.slice(1, -1);
  return longest.map(([lng, lat]) => [Math.round(lng * 10000) / 10000, Math.round(lat * 10000) / 10000]);
};

// A side's strength on a battlefield as its record tells it: formations times their strength.
const strengthOf = (record, side) => {
  const told = record?.brief?.strength?.[side];
  return (Number(told?.n) || 0) * (Number(told?.pct) || 0);
};

// The lines the countries nobody plays have built after a turn.
//   world      the world as the turn leaves it
//   players    the countries people play
//   date       the game's date
//   chart      whose the ground is (runtime/warRoomChart.js), as a war room's op is checked with
// Returns { world, built: [{ owner, battlefield, level, km, days }] }.
export const engineerLines = (world, { players = [], date = "", chart = null } = {}) => {
  const played = new Set(list(players).map(fold));
  const built = [];
  let next = world;
  // (A line of its own still being built on the date: walls.js standsOn.)
  const building = (owner) => normalizeFortifications(next?.fortifications).some((line) => fold(line.owner) === fold(owner) && line.building && !standsOn(line, date));
  for (const record of list(world?.battlefields)) {
    if (!record || record.status !== "active") continue;
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const mine = strengthOf(record, side);
      const theirs = strengthOf(record, 1 - side);
      if (!(theirs > 0) || mine >= ENGINEER_OUTMATCHED * theirs) continue;
      const owner = list(record.sides?.[side]).find((name) => clean(name) && !played.has(fold(name)));
      if (!owner || played.has(fold(list(record.sides?.[side])[0])) || building(owner)) continue;
      let points = frontLineFor(record, side);
      let placed = false;
      // (The country's part of the cost, read once: `next` stays as it is until a line is placed.)
      const costOf = fortifyCostReckoner(next, owner);
      while (!placed && points.length >= 2) {
        let fits = 0;
        for (let level = ENGINEER_LEVEL_MOST; level >= 3; level -= 1) {
          if (costOf(points, level).days <= ENGINEER_DAYS_MOST) {
            fits = level;
            break;
          }
        }
        if (fits === 0) {
          // (Too long to build in time at any level: shorter, about the same middle.)
          if (points.length <= 2 || costOf(points, 3).km <= ENGINEER_KM_LEAST) break;
          points = points.slice(1, -1);
          continue;
        }
        const cost = costOf(points, fits);
        const done = applyFortifyOp(next, { op: "fortify", points, level: fits, name: `${clean(owner)} line before ${clean(record.name)}` }, { player: owner, date, chart });
        if (!done.error) {
          next = done.world;
          built.push({ owner: clean(owner), battlefield: clean(record.name), level: fits, km: Math.round(cost.km), days: done.days });
        }
        placed = true;
      }
    }
  }
  return { world: next, built };
};
