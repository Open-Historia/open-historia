/*! Open Historia — strikes: missiles and bombing runs an event tells of © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// When an event says a nuclear missile was launched, or bombers were sent
// over a city, the map shows it: the missile leaves its silo (or the sea, from
// a submarine) and flies its arc to the place it hits, where a blast spreads;
// the aircraft fly there and bomb it. Some of them may be shot down on the
// way, and are seen to be.
//
// A strike is what the story wrote of one, kept in the world as `strikes`:
//
//   { id, eventId, date, round, owner, weapon, count, down,
//     from: { name, lng, lat }, to: { name, lng, lat } }
//
//   weapon   "silo missile" | "submarine missile" | "missile strike"
//            | "nuclear bomber" | "bombing run"
//   count    how many missiles or aircraft
//   down     how many of them were intercepted before they got there
//
// It changes nothing in the world by itself: what a strike DID is whatever
// its event's own operations say. This is only what is drawn (Map/StrikeLayers.jsx).
// A place the turn could not find is kept by its name alone, and the map looks
// for it among the places it knows when the strike is played.
//
// Pure. Loads in plain Node.

export const STRIKE_WEAPONS = Object.freeze(["silo missile", "submarine missile", "missile strike", "nuclear bomber", "bombing run"]);
// Which of them are nuclear, which fly as aircraft, and which as missiles.
export const NUCLEAR_WEAPONS = Object.freeze(["silo missile", "submarine missile", "nuclear bomber"]);
export const AIRCRAFT_WEAPONS = Object.freeze(["nuclear bomber", "bombing run"]);
// The most a strike is said to be of, the most strikes a turn adds, and the most the world keeps.
export const STRIKE_COUNT_MOST = 500;
export const STRIKES_PER_TURN_MOST = 16;
export const STRIKES_KEPT_MOST = 48;
// A strike is kept for the turn it happened in and the one after: long enough
// to be played when its event is read, and to be played again.
export const STRIKE_ROUNDS_KEPT = 2;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const round4 = (value) => Math.round(value * 10000) / 10000;
const numberOf = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));

export const isNuclear = (weapon) => NUCLEAR_WEAPONS.includes(weapon);
export const fliesAsAircraft = (weapon) => AIRCRAFT_WEAPONS.includes(weapon);

// A place as a strike keeps it: its name as it was written, and where it is
// when that is known.
const readPlace = (value) => {
  const name = clean(typeof value === "string" ? value : value?.name);
  const lng = numberOf(value?.lng);
  const lat = numberOf(value?.lat);
  const placed = Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90;
  if (!name && !placed) return null;
  return { name, lng: placed ? round4(lng) : null, lat: placed ? round4(lat) : null };
};

// One strike as it is kept, or null for what is not one.
export const normalizeStrike = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const id = clean(entry.id, 40);
  const weapon = STRIKE_WEAPONS.includes(entry.weapon) ? entry.weapon : "";
  const owner = clean(entry.owner);
  const to = readPlace(entry.to);
  if (!id || !weapon || !owner || !to) return null;
  const count = Math.max(1, Math.min(STRIKE_COUNT_MOST, Math.round(Number(entry.count) || 0) || 1));
  return {
    id,
    eventId: clean(entry.eventId, 80),
    date: clean(entry.date, 40),
    round: Math.max(0, Math.round(Number(entry.round) || 0)),
    owner,
    weapon,
    count,
    down: Math.max(0, Math.min(count, Math.round(Number(entry.down) || 0))),
    from: readPlace(entry.from),
    to,
  };
};

export const normalizeStrikes = (value) => {
  const kept = [];
  const seen = new Set();
  for (const entry of list(value)) {
    const strike = normalizeStrike(entry);
    if (!strike || seen.has(strike.id)) continue;
    seen.add(strike.id);
    kept.push(strike);
  }
  return kept.slice(-STRIKES_KEPT_MOST);
};

// The world's strikes after a turn: what the turns just before it left, and
// what this one added. A turn applied again replaces its own.
export const withTurnStrikes = (before, added, round) => {
  const turn = Math.max(0, Math.round(Number(round) || 0));
  const earlier = normalizeStrikes(before).filter((strike) => strike.round !== turn && strike.round > turn - STRIKE_ROUNDS_KEPT);
  const fresh = normalizeStrikes(list(added).map((strike) => ({ ...strike, round: turn })));
  return [...earlier, ...fresh].slice(-STRIKES_KEPT_MOST);
};

// ---- finding its places ----------------------------------------------------------------

// A name as it is written with its kind before it: "city: Kyiv" -> { kind: "city", name: "Kyiv" }. What the skip
// teaches a model to add after it, the country or region it lies in ("city: Isfahan, country: Iran"), is no part of
// the name.
export const parsePlace = (value) => {
  const text = clean(value).replace(/\s*,\s*(?:country|region|state|province)\s*:.*$/i, "");
  const marked = /^(city|region|country|group|structure|unit|sea)\s*:\s*(.+)$/i.exec(text);
  return marked ? { kind: marked[1].toLowerCase(), name: clean(marked[2]) } : { kind: "", name: text };
};

// Where a place a strike names is, from what the turn has in hand: the places
// of the event that tells of it (which the game has already found), then the
// map's cities, the world's structures and its formations. null when none of
// them is called that.
//   places       the event's own: [{ kind, name, lng, lat }]
//   cities       [{ name, lng, lat }]
//   markers      world.markers: [{ name, lng, lat }]
//   units        world.units: [{ name, lng, lat }]
export const findStrikePlace = (value, { places = [], cities = [], markers = [], units = [] } = {}) => {
  const { kind, name } = parsePlace(value);
  const wanted = fold(name);
  if (!wanted) return null;
  const at = (entry) => {
    const lng = numberOf(entry?.lng);
    const lat = numberOf(entry?.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng: round4(lng), lat: round4(lat) } : null;
  };
  const named = (rows) => list(rows).find((entry) => fold(entry?.name) === wanted && at(entry));
  // What the event itself placed, of the same kind where a kind is given.
  const told = list(places).find((entry) => fold(entry?.name) === wanted && at(entry) && (!kind || !clean(entry?.kind) || fold(entry.kind) === kind));
  const order = kind === "structure" ? [markers, cities, units] : kind === "unit" ? [units, markers, cities] : [cities, markers, units];
  const found = told ?? order.map(named).find(Boolean) ?? null;
  return found ? at(found) : null;
};

// Where a strike nobody gave a launching place sets off from, among what its
// owner has: a silo for a missile from one, a formation at sea for one from a
// submarine, an airfield for aircraft; failing that anything of its owner's,
// the nearer the target the better. null when it has nothing on the map.
const SITE_WORDS = {
  "silo missile": /silo|missile|rocket|launch|strategic/i,
  "missile strike": /missile|rocket|launch|battery|artillery/i,
  "submarine missile": /submarine|\bsub\b|fleet|squadron|naval|flotilla/i,
  "nuclear bomber": /air ?(field|base|port|wing|force)|bomber|aviation|squadron/i,
  "bombing run": /air ?(field|base|port|wing|force)|bomber|aviation|squadron/i,
};
export const pickStrikeOrigin = ({ weapon, owner, to = null, markers = [], units = [] } = {}) => {
  const mine = (entry) => fold(entry?.ownerCode) === fold(owner) && Number.isFinite(numberOf(entry?.lng)) && Number.isFinite(numberOf(entry?.lat));
  const far = (entry) => {
    if (!to || !Number.isFinite(to.lng)) return 0;
    const dx = Number(entry.lng) - to.lng;
    const dy = Number(entry.lat) - to.lat;
    return dx * dx + dy * dy;
  };
  const words = SITE_WORDS[weapon] ?? /./;
  const text = (entry) => `${clean(entry?.kind)} ${clean(entry?.name)} ${clean(entry?.type)} ${clean(entry?.composition)}`;
  // By sea first for a submarine's missile, from an air formation or a field for aircraft, from a structure for the rest.
  const fleets = list(units).filter((entry) => mine(entry) && entry.type === "naval");
  const wings = list(units).filter((entry) => mine(entry) && entry.type === "air");
  const sites = list(markers).filter((entry) => mine(entry) && !["destroyed", "abandoned"].includes(clean(entry?.status)));
  const pools = weapon === "submarine missile"
    ? [fleets.filter((entry) => words.test(text(entry))), fleets, sites.filter((entry) => /port|naval|harbou?r/i.test(text(entry)))]
    : fliesAsAircraft(weapon)
      ? [sites.filter((entry) => words.test(text(entry))), wings, sites.filter((entry) => /base|hq/i.test(text(entry)))]
      : [sites.filter((entry) => words.test(text(entry))), sites.filter((entry) => /base|hq|fortress/i.test(text(entry)))];
  for (const pool of pools) {
    if (pool.length === 0) continue;
    const [best] = pool.slice().sort((a, b) => far(a) - far(b) || clean(a.name).localeCompare(clean(b.name)));
    return { name: clean(best.name), lng: round4(Number(best.lng)), lat: round4(Number(best.lat)) };
  }
  return null;
};

// ---- a submarine nobody placed ----------------------------------------------------------

// How far from what it fires at a submarine lies, in kilometres: the nearest
// it is put, the farthest, and what it is put nearest to.
export const SEA_LAUNCH_KM = Object.freeze({ least: 400, most: 2600, usual: 1200, offshore: 110 });

// Where a submarine's missile sets off from when no fleet of its owner's is on
// the map: open water well off every shore, in the widest sea within reach of
// the target, the usual distance from it and, where a place of its owner's is
// known, on the side nearest that. Where no water in reach is that far from
// land, any open water there; and on a small map, where no water is that far
// from anything, the open water farthest from the target. null on a map with
// no sea.
//   grid      the map's sheet of land and sea (fronts/worldGrid.js)
//   to        { lng, lat }: what is fired at
//   near      { lng, lat } or null: a place of the owner's
//   seasOf, distanceTo   the sheet's own readers (fronts/worldGrid.js)
export const seaLaunchPlace = (grid, { to = null, near = null, seasOf, distanceTo } = {}) => {
  if (!grid || !to || !Number.isFinite(to.lng) || !Number.isFinite(to.lat) || typeof seasOf !== "function" || typeof distanceTo !== "function") return null;
  const target = grid.cellOf(to.lng, to.lat);
  if (target < 0) return null;
  const seas = seasOf(grid);
  const far = distanceTo(grid, target);
  const home = near && Number.isFinite(near.lng) && Number.isFinite(near.lat) ? grid.cellOf(near.lng, near.lat) : -1;
  const fromHome = home >= 0 ? distanceTo(grid, home) : null;
  // How wide each sea is, counted in cells, once a sheet.
  if (!grid.seaSizes) {
    const sizes = new Map();
    for (let cell = 0; cell < seas.length; cell += 1) if (seas[cell] && grid.land[cell] === 0) sizes.set(seas[cell], (sizes.get(seas[cell]) ?? 0) + 1);
    grid.seaSizes = sizes;
  }
  const open = (cell) => seas[cell] > 0 && grid.land[cell] === 0;
  // How many cells each cell is from land, up to as many as "well offshore" is: once a sheet.
  // (A sheet that measures row by row, a flat one or a world projection's, by its middle row.)
  const rowsKm = grid.stepKm?.downRow;
  const cellKm = rowsKm?.length
    ? Math.max(0.001, rowsKm[rowsKm.length >> 1])
    : (grid.flat ? grid.step * grid.scale : grid.step * 111.2) * (Number(grid.factor) > 0 ? grid.factor : 1);
  const deep = Math.max(1, Math.min(60, Math.round(SEA_LAUNCH_KM.offshore / cellKm)));
  if (!grid.offshore || grid.offshore.deep !== deep) {
    const { cols, rows, wrap } = grid;
    const steps = new Uint8Array(cols * rows).fill(255);
    let edge = [];
    for (let cell = 0; cell < steps.length; cell += 1) {
      if (grid.land[cell] > 0) {
        steps[cell] = 0;
        edge.push(cell);
      }
    }
    for (let depth = 1; depth <= deep && edge.length > 0; depth += 1) {
      const next = [];
      for (const cell of edge) {
        const row = Math.floor(cell / cols);
        const col = cell % cols;
        for (let dy = -1; dy <= 1; dy += 1) {
          const y = row + dy;
          if (y < 0 || y >= rows) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            let x = col + dx;
            if (wrap) x = (x + cols) % cols;
            else if (x < 0 || x >= cols) continue;
            const at = y * cols + x;
            if (steps[at] <= depth) continue;
            steps[at] = depth;
            next.push(at);
          }
        }
      }
      edge = next;
    }
    grid.offshore = { deep, steps };
  }
  const offshore = (cell) => grid.offshore.steps[cell] > deep;
  const within = [];
  let farthest = -1;
  let reach = -1;
  for (let cell = 0; cell < seas.length; cell += 1) {
    if (!open(cell)) continue;
    const km = far(cell);
    if (km > reach && km <= SEA_LAUNCH_KM.most) {
      reach = km;
      farthest = cell;
    }
    if (km >= SEA_LAUNCH_KM.least && km <= SEA_LAUNCH_KM.most) within.push(cell);
  }
  if (within.length === 0) {
    if (farthest < 0) return null;
    const [lng, lat] = grid.centreOf(farthest);
    return { lng: round4(lng), lat: round4(lat) };
  }
  let widest = 0;
  for (const cell of within) widest = Math.max(widest, grid.seaSizes.get(seas[cell]) ?? 0);
  const wide = within.filter((cell) => (grid.seaSizes.get(seas[cell]) ?? 0) === widest);
  const out = wide.filter(offshore);
  let best = -1;
  let least = Infinity;
  for (const cell of out.length > 0 ? out : wide) {
    const off = Math.abs(far(cell) - SEA_LAUNCH_KM.usual) + (fromHome ? fromHome(cell) * 0.5 : 0);
    if (off < least) {
      least = off;
      best = cell;
    }
  }
  if (best < 0) return null;
  const [lng, lat] = grid.centreOf(best);
  return { lng: round4(lng), lat: round4(lat) };
};

// ---- an event's own ----------------------------------------------------------------------

// The strikes an event tells of.
export const strikesOfEvent = (strikes, eventId) => {
  const id = clean(eventId, 80);
  return id ? list(strikes).filter((strike) => clean(strike?.eventId, 80) === id) : [];
};

// The box round what strikes fly over, as [[west, south], [east, north]], for a
// camera to be turned to; null when none of them is placed. A way over the
// date line is boxed as it goes, so its east may lie past 180.
export const strikeBounds = (strikes) => {
  let box = null;
  const take = (lng, lat) => {
    if (!box) box = { west: lng, south: lat, east: lng, north: lat };
    box.west = Math.min(box.west, lng);
    box.east = Math.max(box.east, lng);
    box.south = Math.min(box.south, lat);
    box.north = Math.max(box.north, lat);
  };
  for (const strike of list(strikes)) {
    const to = strike?.to;
    if (!to || !Number.isFinite(numberOf(to.lng)) || !Number.isFinite(numberOf(to.lat))) continue;
    // (Every longitude as the nearest of its turns to the first place boxed.)
    const near = box ? (box.west + box.east) / 2 : Number(to.lng);
    const turned = (lng) => lng + 360 * Math.round((near - lng) / 360);
    const at = turned(Number(to.lng));
    take(at, Number(to.lat));
    const from = strike.from;
    if (from && Number.isFinite(numberOf(from.lng)) && Number.isFinite(numberOf(from.lat))) take(at + (Number(from.lng) - at) - 360 * Math.round((Number(from.lng) - at) / 360), Number(from.lat));
  }
  if (!box) return null;
  // Room round it, more above than below: an arc bows upward.
  const wide = Math.max(2, box.east - box.west);
  const tall = Math.max(2, box.north - box.south);
  const south = Math.max(-80, box.south - tall * 0.12);
  const north = Math.min(84, box.north + tall * 0.2 + wide * 0.08);
  const span = Math.min(340, wide * 1.2);
  const middle = (box.west + box.east) / 2;
  return [[round4(middle - span / 2), round4(south)], [round4(middle + span / 2), round4(Math.max(north, south + 1))]];
};
