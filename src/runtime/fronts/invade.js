/*! Open Historia — battlefields and fronts: troops sent into a country that is not in the war © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The ground of a battlefield is its two sides'. Everybody else's land is a
// wall to it: no troop walks there and nothing is painted there. A country
// comes INTO a war in two ways. The story says so, in the war ledger. Or
// troops are SENT into it: a route drawn in the war room that goes well into
// its land is an attack on it, and when the troops on that route come to its
// border it is at war with their side. It joins the other side of their
// battlefield, its land there is ground to be fought over, it raises troops,
// and the frame grows as the fighting comes to its edge (day.js growIfNeeded).
//
// Only a route does it, and only by going INTO a country: a way that clips
// the corner of a neighbour for less than ROUTE_INTO_KM attacks nobody, and
// nothing a line of troops does by itself ever crosses such a border.
//
// Pure. The engine reads a route's countries when the route is put to its
// troops (engine.js), and the war room reads them as soon as the route is
// drawn, from the same ground, to say what sending troops along it means
// (AI/frontApply.js routesIntoOthers).

import { MAX_ORDER_ATTACKS, ROUTE_INTO_KM } from "./constants.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// The countries and groups outside a war whose land a way goes into, in the
// order it comes to them: each by the name the world knows it by.
//   arena             the battlefield's ground (arena.js): which region each cell is
//   place             the frame's projector (frame.js): kmAt(y)
//   way               the way's points in cells, as the engine has them
//   holderOf(id)      who holds a region in name ("" for nobody)
//   inWar(name)       whether a name is on either side already
export const othersOnWay = ({ arena, place, way, holderOf, inWar } = {}) => {
  if (!arena || !place || !Array.isArray(way) || way.length < 2) return [];
  const { cols, rows, region, ids } = arena;
  const holders = new Map();
  const nameOf = (index) => {
    if (!holders.has(index)) holders.set(index, String(holderOf(ids[index]) ?? "").replace(/\s+/g, " ").trim());
    return holders.get(index);
  };
  const inside = new Map();
  for (let leg = 0; leg + 1 < way.length; leg += 1) {
    const [ax, ay] = way[leg];
    const [bx, by] = way[leg + 1];
    const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    if (!(length > 0)) continue;
    const steps = Math.max(1, Math.ceil(length * 2));
    for (let step = 0; step < steps; step += 1) {
      const x = ax + ((bx - ax) * (step + 0.5)) / steps;
      const y = ay + ((by - ay) * (step + 0.5)) / steps;
      if (!(x >= 0) || !(y >= 0) || x >= cols || y >= rows) continue;
      const index = region[Math.floor(y) * cols + Math.floor(x)];
      if (!index) continue;
      // Ground no troop may enter (water, or a type that is a wall) is nobody's land to march into.
      if (arena.regionSpeed && !(arena.regionSpeed[index] > 0)) continue;
      const name = nameOf(index);
      if (!name || inWar(name)) continue;
      const key = fold(name);
      const entry = inside.get(key) ?? { name, km: 0 };
      entry.km += (length / steps) * place.kmAt(y);
      inside.set(key, entry);
    }
  }
  return [...inside.values()].filter((entry) => entry.km >= ROUTE_INTO_KM).slice(0, MAX_ORDER_ATTACKS).map((entry) => entry.name);
};

// The names a saved order says it attacks, read: a few names, each once.
export const readAttacks = (value) => {
  const kept = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const name = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 120).trim();
    if (!name || kept.some((entry) => fold(entry) === fold(name))) continue;
    kept.push(name);
    if (kept.length >= MAX_ORDER_ATTACKS) break;
  }
  return kept;
};

// Whether a point stands within `reach` cells of land a name holds.
//   held   a byte a region of the arena: 1 where the name holds it
export const landWithin = (arena, held, x, y, reach) => {
  const { cols, rows, region } = arena;
  const span = Math.ceil(reach);
  const col = Math.floor(x);
  const row = Math.floor(y);
  for (let dy = -span; dy <= span; dy += 1) {
    const at = row + dy;
    if (at < 0 || at >= rows) continue;
    for (let dx = -span; dx <= span; dx += 1) {
      const across = col + dx;
      if (across < 0 || across >= cols || dx * dx + dy * dy > reach * reach) continue;
      if (held[region[at * cols + across]]) return true;
    }
  }
  return false;
};
