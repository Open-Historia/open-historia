/*! Open Historia — battlefields and fronts: transporters © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Troops come to a battlefield over land their side holds. A TRANSPORTER takes
// them where it holds none: ships by sea, trains through its own land,
// aircraft by air. It is what lets a country fight one it has no border with,
// and open a second front behind a line.
//
// A transporter is whatever it is called (a troop convoy, an armoured train,
// a wing of transport aircraft: `kind` is free) and is three numbers and a
// medium: the medium says where it can go, `speed` how many kilometres it
// makes in a day, and `capacity` how many formations one of them carries. A
// dispatch is as many of them as its load needs.
//
// Nobody draws its way. It is found when it sets out (wayfinder.js), the same
// way every time for the same map, and it then goes along it day by day. On
// the way it may be INTERCEPTED: by its enemies' ships and aircraft near it,
// from a shore they hold, and above all by whoever was told to go after it
// (an aircraft only over its enemies' ground, as an air strike is: airliftIntercepts).
// What is hit is lost with the troops aboard. What arrives puts its troops
// down: on their own ground as reinforcements, on the enemy's as a landing
// that opens a battlefield there, and in a country that was in no war as an
// attack on it (invade.js).
//
// They are kept in the world as `transports`, beside the battlefields:
//
//   { id, medium: "sea"|"land"|"air", kind, owner, warId, battlefield,
//     from: { lng, lat, name }, to: { lng, lat, name },
//     speed, capacity, load: [[strength, troopKind]...],
//     status: "ordered"|"moving"|"landed"|"lost"|"refused"|"returned",
//     ordered, departed, due, ended,          game dates
//     way: [[lng, lat]...], km, gone, at: [lng, lat], landing: [lng, lat],
//     hunters: [names], hits, sunk, by, note,
//     embark?: { battlefield, side, troops: [indexes] } }
//
// One that was ORDERED sets out on the first day time next passes. One that
// has ended (landed, lost, refused, returned) is kept through the run that
// follows, so that it can be told and shown, and then let go.
//
// Pure: the engine carries the troops off and puts them down (engine.js).

import { hashSeed } from "../unitMotion.js";
import { AIR_REACH_KM } from "./air.js";
import { AIR_FIND, INTERCEPTORS_MOST } from "./airStrike.js";
import { BATTLEFIELD_NAME_MAX } from "./constants.js";
import { MEDIA, WAY_POINTS_MOST, findWay } from "./wayfinder.js";
import { kmBetween, placeAlong } from "./worldGrid.js";

export const TRANSPORT_MEDIA = MEDIA;
// The words a line of orders sends a transporter with, and the medium each means.
export const TRANSPORT_ORDERS = Object.freeze({ ship: "sea", rail: "land", airlift: "air" });
// How many formations a dispatch the story orders carries when it does not say.
export const TRANSPORT_LOAD_USUAL = 8;
export const TRANSPORT_STATUSES = Object.freeze(["ordered", "moving", "landed", "lost", "refused", "returned"]);
export const TRANSPORT_ENDED = Object.freeze(["landed", "lost", "refused", "returned"]);
// The most transporters a world keeps, the most formations one dispatch carries, and the most who hunt one.
export const MAX_TRANSPORTS = 24;
export const TRANSPORT_LOAD_MOST = 40;
export const TRANSPORT_HUNTERS_MOST = 6;
// What a transporter's speed and one carrier's load may be, whoever says them.
export const TRANSPORT_SPEED_KM = Object.freeze({ sea: [40, 1400], land: [15, 1600], air: [300, 22000] });
export const TRANSPORT_CAPACITY = Object.freeze([1, 12]);

// What carries troops in each medium, by the year: its name, its speed in
// kilometres a day and how many formations one of them takes. The first row
// whose year has come is the one in use; a medium with no row yet for a year
// cannot be had then (nothing flew troops before the 1930s).
export const CARRIERS = Object.freeze({
  sea: Object.freeze([
    Object.freeze({ since: 1940, kind: "troop convoy", speed: 720, capacity: 6 }),
    Object.freeze({ since: 1850, kind: "troopships", speed: 480, capacity: 5 }),
    Object.freeze({ since: -Infinity, kind: "transport fleet", speed: 190, capacity: 3 }),
  ]),
  land: Object.freeze([
    Object.freeze({ since: 1920, kind: "troop trains", speed: 800, capacity: 4 }),
    Object.freeze({ since: 1840, kind: "troop trains", speed: 480, capacity: 4 }),
    Object.freeze({ since: -Infinity, kind: "wagon train", speed: 35, capacity: 2 }),
  ]),
  // (`most`: the formations one airlift carries in all, at an air figure of 50: airliftMost.)
  air: Object.freeze([
    Object.freeze({ since: 1960, kind: "transport aircraft", speed: 15000, capacity: 2, most: 6 }),
    Object.freeze({ since: 1936, kind: "transport aircraft", speed: 5500, capacity: 1, most: 3 }),
  ]),
});

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const clamp = (value, least, most) => Math.min(most, Math.max(least, value));
const round3 = (value) => Math.round(value * 1000) / 1000;

// The carrier a medium has in a year, or null when it has none yet.
export const carrierFor = (medium, year) => {
  const rows = CARRIERS[medium];
  if (!rows) return null;
  const when = Number.isFinite(year) ? year : 2000;
  return rows.find((row) => when >= row.since) ?? null;
};

// ---- what may carry troops, and how many ------------------------------------------------

// "make it so air transports work like train and boat except they can go over
// anywhere, but they can carry less troops ... also make different transport
// types disableable in features and if a country has their airforce or navy
// disabled by being set to zero they cant use those transports" (the owner,
// 2026-11-09).
//
// What a country may not send, by a medium: one the game's features switched
// off (server/gameFeatures.js transportMediaOf), by sea with a navy figure of
// 0, by air with an air figure of 0 (military.js: 0 is none at all).
export const TRANSPORT_BARS = Object.freeze(["switched-off", "no-navy", "no-air-force"]);
// A figure as it was given: a number, or null for none (a country nobody gave figures is at 50 in all).
const figureOf = (military, arm) => {
  const value = military?.[arm];
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
};
//   media      what the game lets carry troops (every medium where not given)
//   military   the country's military figures ({ sea, air, ... }), or null where the game weighs none
// Returns one of TRANSPORT_BARS, or "" when it may.
export const transportBar = (medium, { media = null, military = null } = {}) => {
  if (Array.isArray(media) && !media.includes(medium)) return "switched-off";
  if (medium === "sea" && figureOf(military, "sea") !== null && figureOf(military, "sea") <= 0) return "no-navy";
  if (medium === "air" && figureOf(military, "air") !== null && figureOf(military, "air") <= 0) return "no-air-force";
  return "";
};

// An airlift carries fewer than a train or a ship: its year's carrier's `most`
// at an air figure of 50, twice that at 100, a fifth of it at 10, and never
// under one formation while the country has an air force at all. A train or a
// ship carries TRANSPORT_LOAD_MOST. (Before any carrier flies troops, one the
// story names and gives a speed carries what the first that did.) 0 where the
// country has no air force.
export const AIRLIFT_FIGURE_USUAL = 50;
export const airliftMost = (year, military = null) => {
  const row = carrierFor("air", year) ?? CARRIERS.air.at(-1);
  const air = figureOf(military, "air") ?? AIRLIFT_FIGURE_USUAL;
  if (!(air > 0)) return 0;
  return clamp(Math.round((row.most * Math.min(100, air)) / AIRLIFT_FIGURE_USUAL), 1, TRANSPORT_LOAD_MOST);
};
// The most formations one dispatch by a medium carries, for a country in a year.
export const transportLoadMost = (medium, year, military = null) => (medium === "air" ? airliftMost(year, military) : TRANSPORT_LOAD_MOST);

// (Nothing at all is not zero: a place that is only named has no coordinates yet.)
const numberOf = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
const readPoint = (value) => {
  const lng = numberOf(Array.isArray(value) ? value[0] : value?.lng);
  const lat = numberOf(Array.isArray(value) ? value[1] : value?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 ? [round3(lng), round3(lat)] : null;
};
const readPlace = (value) => {
  const point = readPoint(value);
  return point ? { lng: point[0], lat: point[1], name: clean(value?.name, 120) } : null;
};
// What is aboard: a strength and a kind of troop a formation.
const readLoad = (value) => {
  const load = [];
  for (const entry of list(value)) {
    const strength = Math.round(Number(Array.isArray(entry) ? entry[0] : entry?.strength));
    const kind = Math.round(Number(Array.isArray(entry) ? entry[1] : entry?.kind));
    if (!(strength > 0)) continue;
    load.push([clamp(strength, 1, 100), kind === 1 || kind === 2 ? kind : 0]);
    if (load.length >= TRANSPORT_LOAD_MOST) break;
  }
  return load;
};
const readNames = (value, most) => {
  const names = [];
  for (const entry of list(value)) {
    const name = clean(entry);
    if (name && !names.some((other) => fold(other) === fold(name))) names.push(name);
    if (names.length >= most) break;
  }
  return names;
};

// One transporter as it is kept, or null for what is not one.
export const normalizeTransport = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const id = clean(entry.id, 24);
  const medium = TRANSPORT_MEDIA.includes(entry.medium) ? entry.medium : "";
  const owner = clean(entry.owner);
  // (One the story ordered names its place; where that is, is found when it sets out.)
  const to = readPlace(entry.to) ?? (clean(entry.to?.name) ? { lng: null, lat: null, name: clean(entry.to.name) } : null);
  if (!id || !medium || !owner || !to) return null;
  const [slow, fast] = TRANSPORT_SPEED_KM[medium];
  const record = {
    id,
    medium,
    kind: clean(entry.kind, 40),
    owner,
    warId: clean(entry.warId, 80),
    battlefield: clean(entry.battlefield, BATTLEFIELD_NAME_MAX),
    from: readPlace(entry.from),
    to,
    speed: clamp(Math.round(Number(entry.speed) || 0) || slow, slow, fast),
    capacity: clamp(Math.round(Number(entry.capacity) || 0) || 1, TRANSPORT_CAPACITY[0], TRANSPORT_CAPACITY[1]),
    load: readLoad(entry.load),
    status: TRANSPORT_STATUSES.includes(entry.status) ? entry.status : "ordered",
    ordered: clean(entry.ordered, 40),
    departed: clean(entry.departed, 40),
    due: clean(entry.due, 40),
    ended: clean(entry.ended, 40),
    way: list(entry.way).map(readPoint).filter(Boolean).slice(0, WAY_POINTS_MOST),
    km: Math.max(0, Math.round(Number(entry.km) || 0)),
    gone: Math.max(0, Math.round(Number(entry.gone) || 0)),
    at: readPoint(entry.at),
    landing: readPoint(entry.landing),
    hunters: readNames(entry.hunters, TRANSPORT_HUNTERS_MOST),
    hits: Math.max(0, Math.round(Number(entry.hits) || 0)),
    sunk: Math.max(0, Math.round(Number(entry.sunk) || 0)),
    by: clean(entry.by),
    note: clean(entry.note, 160),
  };
  // The countries outside its war that it is bound for: putting troops down
  // there is an attack on them (the engine writes it when it sets out).
  const attacks = readNames(entry.attacks, 2);
  if (attacks.length > 0) record.attacks = attacks;
  // How many formations it was told to take when nothing says which: a
  // dispatch the story ordered is raised when it sets out.
  const raise = Math.round(Number(entry.raise) || 0);
  if (raise > 0 && record.load.length === 0) record.raise = clamp(raise, 1, TRANSPORT_LOAD_MOST);
  const embark = entry.embark && typeof entry.embark === "object" ? entry.embark : null;
  if (embark && clean(embark.battlefield) && (embark.side === 0 || embark.side === 1)) {
    const troops = [...new Set(list(embark.troops).map(Number).filter((index) => Number.isInteger(index) && index >= 0))].slice(0, TRANSPORT_LOAD_MOST);
    if (troops.length > 0) record.embark = { battlefield: clean(embark.battlefield, BATTLEFIELD_NAME_MAX), side: embark.side, troops };
  }
  return record;
};

// The world's transporters as they are kept: each once, the newest kept when
// there are too many.
export const normalizeTransports = (value) => {
  const kept = [];
  const seen = new Set();
  for (const entry of list(value)) {
    const record = normalizeTransport(entry);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    kept.push(record);
  }
  return kept.slice(-MAX_TRANSPORTS);
};

export const isUnderWay = (transport) => transport?.status === "ordered" || transport?.status === "moving";
// How many carriers a dispatch is: as many as its load needs.
// How many formations it carries: those aboard, or before it sets out those it is to raise or take aboard.
export const loadOf = (transport) => transport.load.length || transport.raise || transport.embark?.troops.length || 0;
export const carriersOf = (transport) => Math.max(1, Math.ceil(Math.max(1, loadOf(transport)) / Math.max(1, transport.capacity)));

// An id no transporter of a list has.
export const nextTransportId = (transports) => {
  const taken = new Set(list(transports).map((entry) => clean(entry?.id)));
  for (let serial = 1; ; serial += 1) if (!taken.has(`t${serial}`)) return `t${serial}`;
};

// A list with one more transporter ORDERED in it: it sets out when time next
// passes. Returns { transports, transport } or { error }.
//   medium, owner, to   what it is, whose, and where it is sent ({ lng, lat, name })
//   from                where it sets out, when its troops are not on a battlefield
//   kind, speed, capacity   what it is called and can do; the year's carrier where not said
//   load | raise | embark   what it carries: troops in hand, a number to raise, or troops of a battlefield
export const orderTransport = (transports, spec = {}, { date = "", year = null } = {}) => {
  const kept = normalizeTransports(transports);
  const medium = TRANSPORT_MEDIA.includes(spec.medium) ? spec.medium : "";
  if (!medium) return { error: "medium" };
  const usual = carrierFor(medium, year);
  // A carrier that is named and given its speed is taken at its word; one that is not must exist yet.
  const named = clean(spec.kind, 40);
  const said = Math.round(Number(spec.speed) || 0);
  if (!usual && !(named && said > 0)) return { error: "not-yet" };
  if (kept.filter(isUnderWay).length >= MAX_TRANSPORTS - 4) return { error: "too-many" };
  const record = normalizeTransport({
    id: nextTransportId(kept),
    medium,
    kind: named || usual?.kind || medium,
    owner: spec.owner,
    warId: spec.warId,
    battlefield: spec.battlefield,
    from: spec.from,
    to: spec.to,
    speed: said > 0 ? said : usual?.speed,
    capacity: Math.round(Number(spec.capacity) || 0) || usual?.capacity || 1,
    load: spec.load,
    raise: spec.raise,
    embark: spec.embark,
    status: "ordered",
    ordered: date,
    by: spec.by,
  });
  if (!record) return { error: "incomplete" };
  if (record.load.length === 0 && !record.raise && !record.embark) return { error: "nothing-aboard" };
  return { transports: [...kept, record].slice(-MAX_TRANSPORTS), transport: record };
};

// A list without a transporter that has not set out yet. One under way cannot be called back by this.
export const cancelTransport = (transports, id) => normalizeTransports(transports).filter((entry) => !(entry.id === clean(id) && entry.status === "ordered"));

// A list in which somebody is told to go after a transporter (or told to stop).
export const huntTransport = (transports, id, hunter, on = true) => normalizeTransports(transports).map((entry) => {
  if (entry.id !== clean(id) || !isUnderWay(entry) || !clean(hunter) || fold(hunter) === fold(entry.owner)) return entry;
  const others = entry.hunters.filter((name) => fold(name) !== fold(hunter));
  return { ...entry, hunters: on ? [...others, clean(hunter)].slice(0, TRANSPORT_HUNTERS_MOST) : others };
});

// ---- setting out ----------------------------------------------------------------------

// The cities a dispatch may set out from: its owner's, the best first. Best is
// the least way to go: from where its troops stand to the city (when they stand
// somewhere) and on from it to where they are sent. A ship from a country whose
// capital is far inland sails from a port, and troops a long way from the sea
// go overland to the one that is on their way.
//   cities        the map's cities: [{ name, lng, lat }]
//   holderAt      (lng, lat) => who holds the ground there
//   owner, to     whose it is, and where it is sent ({ lng, lat })
//   near          where its troops stand, [lng, lat], or null
//   km            (lngA, latA, lngB, latB) => the kilometres between two places
//   most          how many to give
// Returns [{ lng, lat, name }], the name with its kind ("city: X").
// (Troops taken off a battlefield try this many of them when no way begins where
// they stand, for one of these reasons: wayfinder.js findWay.)
export const EMBARK_PORTS_MOST = 12;
export const TRANSPORT_START_FAILS = Object.freeze(["no-coast", "no-ground"]);
export const departuresFor = ({ cities = [], holderAt = () => "", owner = "", to = null, near = null, km, most = 8 } = {}) => {
  const mine = [];
  const there = readPoint(to);
  const here = readPoint(near);
  for (const city of list(cities)) {
    const lng = Number(city?.lng);
    const lat = Number(city?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || fold(holderAt(lng, lat)) !== fold(owner)) continue;
    const far = (there ? km(lng, lat, there[0], there[1]) : 0) + (here ? km(here[0], here[1], lng, lat) : 0);
    mine.push({ lng, lat, name: `city: ${clean(city.name)}`, far });
  }
  mine.sort((a, b) => a.far - b.far || a.name.localeCompare(b.name));
  return mine.slice(0, Math.max(0, most)).map(({ lng, lat, name }) => ({ lng, lat, name }));
};

// The way found for a transporter and what follows from it: it is MOVING, with
// its way, how long that is and the day it is due; or REFUSED, with why.
//   grid       the sheet of the whole map (worldGrid.js)
//   from       where it sets out, [lng, lat]
//   holderOf, friendly, hostile, year   as findWay takes them
//   date, dateOf(days)   the day it sets out and the date so many days after it
export const setOut = (transport, { grid, from, holderOf, friendly, hostile, year, date = "", dateOf = () => "" }) => {
  const origin = readPoint(from) ?? (transport.from ? [transport.from.lng, transport.from.lat] : null);
  if (!origin) return { ...transport, status: "refused", note: "no-origin", ended: date };
  if (!Number.isFinite(transport.to.lng) || !Number.isFinite(transport.to.lat)) return { ...transport, status: "refused", note: "no-place", ended: date };
  const found = findWay(grid, { medium: transport.medium, from: origin, to: [transport.to.lng, transport.to.lat], holderOf, friendly, hostile, year });
  if (found.error) return { ...transport, status: "refused", note: found.error, ended: date };
  const days = Math.max(1, Math.ceil(found.km / Math.max(1, transport.speed)));
  return {
    ...transport,
    status: "moving",
    from: { lng: origin[0], lat: origin[1], name: transport.from?.name ?? "" },
    departed: date,
    due: dateOf(days),
    way: found.way,
    km: found.km,
    gone: 0,
    at: found.way[0],
    landing: found.landing,
    note: found.arrived ? "" : "railhead",
  };
};

// A transporter a day further on: how far it has gone and where it is.
// `arrived` is true on the day it comes to the end of its way.
export const moveOn = (transport, { flat = false, scale } = {}) => {
  const gone = Math.min(transport.km, transport.gone + transport.speed);
  const place = placeAlong(transport.way, gone, { flat, scale });
  return { transport: { ...transport, gone: Math.round(gone), at: place ? [round3(place.lng), round3(place.lat)] : transport.at }, arrived: gone >= transport.km };
};

// ---- interception -----------------------------------------------------------------------

// How far a formation of the world's reaches after a transporter, in
// kilometres, and how likely it is to catch one a day at no distance, by what
// it is and what it goes after.
export const INTERCEPT_REACH_KM = Object.freeze({ naval: Object.freeze({ sea: 380, air: 130, land: 0 }), air: Object.freeze({ sea: 900, air: 900, land: 650 }) });
export const INTERCEPT_BASE = Object.freeze({ naval: Object.freeze({ sea: 0.26, air: 0.05, land: 0 }), air: Object.freeze({ sea: 0.16, air: 0.22, land: 0.09 }) });
// A shore (or, for a train, a front) its enemies hold: how near it counts, and what it adds.
export const SHORE_REACH_KM = Object.freeze({ sea: 110, air: 220, land: 45 });
export const SHORE_BASE = Object.freeze({ sea: 0.05, air: 0.09, land: 0.04 });
// Whoever was TOLD to go after it, while it has anything within twice its reach of the transporter.
export const HUNT_BASE = 0.5;
// Its own side's ships and aircraft near it cover it.
export const ESCORT_REACH_KM = 320;
export const ESCORT_SAVES = 0.3;
export const INTERCEPT_CHANCE_MOST = 0.9;
// What a hit costs: at least a carrier's load, and this share of what is aboard at most.
export const HIT_SHARE = Object.freeze([0.3, 0.85]);

// A number from 0 up to 1 that is one transporter's own on one day of one run.
export const transportChance = (seed, id, day, what) => (hashSeed([seed, "transport", id, day, what].join("|")) % 10000) / 10000;

// How likely a transporter is to be intercepted on a day, and by whom.
//   at            where it is, [lng, lat]
//   units         the world's formations: [{ type, ownerCode, lng, lat, strength, name }]
//   enemy(name)   it is at war with the transporter's owner
//   ally(name)    it is on the owner's side (the owner itself included)
//   grid, holderOf   the sheet, for the shores near it
// Returns { chance, by, with, threats }: `by` is whoever is likeliest to have
// done it, and `with` the formation it would have been done with ("" for a shore).
export const interceptionOf = (transport, at, { units = [], enemy = () => false, ally = () => false, grid = null, holderOf = () => "", flat = false, scale } = {}) => {
  const medium = transport.medium;
  const far = (lng, lat) => kmBetween(at[0], at[1], lng, lat, { flat, scale });
  const threats = [];
  let cover = 0;
  const hunting = new Set(transport.hunters.map(fold));
  const hunted = new Map();
  for (const unit of list(units)) {
    const type = unit?.type === "naval" || unit?.type === "air" ? unit.type : "";
    const owner = clean(unit?.ownerCode);
    const lng = Number(unit?.lng);
    const lat = Number(unit?.lat);
    if (!type || !owner || !Number.isFinite(lng) || !Number.isFinite(lat) || clean(unit.committedTo)) continue;
    const strength = clamp((Number(unit.strength) || 0) / 100, 0, 1.5);
    if (!(strength > 0)) continue;
    const distance = far(lng, lat);
    if (ally(owner)) {
      if (distance <= ESCORT_REACH_KM && (type === "air" || medium === "sea")) cover += strength;
      continue;
    }
    if (!enemy(owner)) continue;
    const reach = INTERCEPT_REACH_KM[type][medium];
    if (reach > 0 && distance < reach) threats.push({ by: owner, with: clean(unit.name), weight: INTERCEPT_BASE[type][medium] * strength * (1 - distance / reach) });
    if (hunting.has(fold(owner)) && reach > 0 && distance < reach * 2) hunted.set(fold(owner), { by: owner, with: clean(unit.name) });
  }
  // The shores near it that an enemy holds: the nearest of each holder's.
  if (grid) {
    const reach = SHORE_REACH_KM[medium];
    const cell = grid.cellOf(at[0], at[1]);
    if (cell >= 0) {
      const stepKm = Math.max(1, grid.km(at[0], at[1], at[0], at[1] + grid.step));
      const rings = Math.min(40, Math.ceil((reach * (hunting.size > 0 ? 3 : 1)) / stepKm));
      const row = Math.floor(cell / grid.cols);
      const col = cell % grid.cols;
      const nearest = new Map();
      for (let dy = -rings; dy <= rings; dy += 1) {
        const y = row + dy;
        if (y < 0 || y >= grid.rows) continue;
        for (let dx = -rings; dx <= rings; dx += 1) {
          let x = col + dx;
          if (grid.wrap) x = ((x % grid.cols) + grid.cols) % grid.cols;
          else if (x < 0 || x >= grid.cols) continue;
          const mark = grid.region[y * grid.cols + x];
          if (!mark) continue;
          const name = clean(holderOf(grid.ids[mark]));
          if (!name || !enemy(name)) continue;
          const [lng, lat] = grid.centreOf(y * grid.cols + x);
          const distance = far(lng, lat);
          const before = nearest.get(fold(name));
          if (!before || distance < before.distance) nearest.set(fold(name), { by: name, distance });
        }
      }
      for (const [key, shore] of nearest) {
        if (shore.distance < reach) threats.push({ by: shore.by, with: "", weight: SHORE_BASE[medium] * (1 - shore.distance / reach) });
        if (hunting.has(key) && shore.distance < reach * 3 && !hunted.has(key)) hunted.set(key, { by: shore.by, with: "" });
      }
    }
  }
  for (const hunter of hunted.values()) threats.push({ ...hunter, weight: HUNT_BASE });
  let total = 0;
  for (const threat of threats) total += threat.weight;
  total *= Math.max(1 - ESCORT_SAVES * 2.2, 1 - ESCORT_SAVES * cover);
  const first = threats.slice().sort((a, b) => b.weight - a.weight)[0] ?? null;
  // (What is against it is turned into a chance that grows with it and never reaches one.)
  return { chance: Math.min(INTERCEPT_CHANCE_MOST, total / (1 + total)), by: first?.by ?? "", with: first?.with ?? "", threats: threats.length };
};

// What a hit does to a transporter: it loses carriers and the troops aboard
// them. Returns { transport, lost }: `lost` formations went down; a
// transporter with nothing left aboard is LOST.
export const struck = (transport, draw, date = "") => {
  const aboard = transport.load.length;
  if (aboard === 0) return { transport: { ...transport, status: "lost", ended: date, hits: transport.hits + 1 }, lost: 0 };
  const share = HIT_SHARE[0] + (HIT_SHARE[1] - HIT_SHARE[0]) * clamp(draw, 0, 1);
  const lost = clamp(Math.max(Math.min(transport.capacity, aboard), Math.round(aboard * share)), 1, aboard);
  const load = transport.load.slice(0, aboard - lost);
  const next = { ...transport, load, hits: transport.hits + 1, sunk: transport.sunk + lost };
  return { transport: load.length === 0 ? { ...next, status: "lost", ended: date } : next, lost };
};

// ---- an airlift over enemy ground --------------------------------------------------------

// An AIRLIFT (medium "air") goes over anything, and is caught only where it
// flies over ground its enemies hold, and there as an air strike is
// (airStrike.js): each air unit of a country at war with its owner whose base
// lies within its era's reach (air.js AIR_REACH_KM) of what it flies over of
// theirs rises, the nearest first and INTERCEPTORS_MOST at most, and finds it at
// AIR_FIND of the era (radar from 1945). A unit of a country with no air arm
// (military.js airWorth 0) does not rise. Where no unit on the map finds it,
// the AIR ARM of whoever holds the ground below and has no air unit of its own
// on the map (most countries' are on no map: air.js) finds it at
// AIRLIFT_ARM_FIND of the era, times what that arm is worth (at most
// AIRLIFT_ARM_WORTH_MOST). Each that finds it is a hit (struck): a share of
// what is aboard is lost, or all of it. Troops flown into enemy land are put
// down there all the same, and fight as any landing does (engine.js landTransport).
export const AIRLIFT_ARM_FIND = Object.freeze([0, 0, 0.2, 0.3]);
export const AIRLIFT_ARM_WORTH_MOST = 1.5;
// How finely a day's flight is looked at for the ground under it, and the most points that is.
export const AIRLIFT_LOOK_KM = 40;
export const AIRLIFT_LOOKS_MOST = 160;

// The points along a way from `fromKm` to `toKm`: its two ends, and between
// them none further apart than AIRLIFT_LOOK_KM (fewer on a very long stretch).
export const stretchOf = (way, fromKm, toKm, options = {}) => {
  const from = Math.max(0, Number(fromKm) || 0);
  const to = Math.max(from, Number(toKm) || 0);
  const parts = clamp(Math.ceil((to - from) / AIRLIFT_LOOK_KM), 1, AIRLIFT_LOOKS_MOST - 1);
  const points = [];
  for (let part = 0; part <= parts; part += 1) {
    const place = placeAlong(way, from + ((to - from) * part) / parts, options);
    if (place) points.push([round3(place.lng), round3(place.lat)]);
  }
  return points;
};

// Who finds an airlift on a day.
//   over          [[lng, lat]...]: what it flew over that day (stretchOf)
//   holderAt      (lng, lat) => who holds the ground there ("" for the sea, or nobody's)
//   enemy(name)   it is at war with the airlift's owner
//   units         the world's formations: [{ id, type, ownerCode, lng, lat, strength, name, status }]
//   era           0 to 3 (unitMotion.js eraOf)
//   worthOf(name) what a country's air arm is worth (military.js airWorth): 1 where nobody says
//   roll(what)    a number from 0 up to 1 that is the airlift's own, that day, for `what`
// Returns { over, found }: `over`, whose ground of its enemies' it flew over, by
// name; `found`, [{ by, with, at }]: who found it, with which unit ("" for an
// air arm), and where ([lng, lat]). One that flew over none of its enemies'
// ground is found by nobody.
export const airliftIntercepts = (transport, { over = [], holderAt = () => "", enemy = () => false, units = [], era = 3, worthOf = () => 1, roll = () => 1, flat = false, scale } = {}) => {
  const hostile = [];
  const holders = [];
  for (const point of list(over)) {
    const name = clean(holderAt(point[0], point[1]));
    if (!name || fold(name) === fold(transport?.owner) || !enemy(name)) continue;
    hostile.push({ point, name });
    if (!holders.some((entry) => fold(entry) === fold(name))) holders.push(name);
  }
  if (hostile.length === 0) return { over: [], found: [] };
  const reach = AIR_REACH_KM[era] ?? 0;
  const find = AIR_FIND[era] ?? 0;
  const worth = (name) => Math.max(0, Number(worthOf(name)) || 0);
  const flying = new Set();
  const rising = [];
  for (const unit of list(units)) {
    const owner = clean(unit?.ownerCode);
    const lng = Number(unit?.lng);
    const lat = Number(unit?.lat);
    if (fold(unit?.type) !== "air" || !owner || fold(unit?.status) === "pending" || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    flying.add(fold(owner));
    if (!(reach > 0) || !enemy(owner) || !((Number(unit.strength) || 0) >= 1) || !(worth(owner) > 0)) continue;
    let nearest = null;
    for (const entry of hostile) {
      const km = kmBetween(lng, lat, entry.point[0], entry.point[1], { flat, scale });
      if (!nearest || km < nearest.km) nearest = { km, at: entry.point };
    }
    if (nearest && nearest.km <= reach) rising.push({ unit, owner, ...nearest });
  }
  const idOf = (unit) => clean(unit?.id) || clean(unit?.name);
  rising.sort((a, b) => a.km - b.km || (idOf(a.unit) < idOf(b.unit) ? -1 : idOf(a.unit) > idOf(b.unit) ? 1 : 0));
  const found = [];
  for (const entry of rising) {
    if (found.length >= INTERCEPTORS_MOST) break;
    if (roll(`find|${idOf(entry.unit)}`) < find) found.push({ by: entry.owner, with: clean(entry.unit.name), at: entry.at });
  }
  if (found.length === 0) {
    for (const name of holders) {
      if (flying.has(fold(name))) continue;
      const chance = (AIRLIFT_ARM_FIND[era] ?? 0) * Math.min(AIRLIFT_ARM_WORTH_MOST, worth(name));
      if (chance > 0 && roll(`arm|${fold(name)}`) < chance) {
        found.push({ by: name, with: "", at: hostile.find((entry) => fold(entry.name) === fold(name)).point });
        break;
      }
    }
  }
  return { over: holders, found };
};

// ---- told ---------------------------------------------------------------------------------

// What a transporter is called in a sentence: "troop convoy of Aland's".
export const transportTitle = (transport) => `${transport.kind || transport.medium} of ${transport.owner}`;
// Where it is bound, as it is told: the place's name with its kind when it has one.
export const boundFor = (transport) => transport.to.name || (Number.isFinite(transport.to.lat) ? `${transport.to.lat.toFixed(1)}, ${transport.to.lng.toFixed(1)}` : "");
