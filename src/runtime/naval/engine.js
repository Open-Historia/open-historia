/*! Open Historia — war at sea: what happens when hostile fleets meet © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Now let's do a version of this for navy battles."
//
// The land war is fought by an engine (runtime/fronts/): the story gives
// orders and the game decides who holds the ground. At sea there was nothing
// of the kind. A fleet is a formation of the world's (world.units, type
// "naval"); the story moved it, a transporter's crossing could be caught by
// one, and two hostile fleets in the same water did nothing to each other
// unless the story said so, with whatever losses it cared to write.
//
// THE FLEETS ARE STILL THE WORLD'S. They are moved as they always were (the
// story's unit operations, a player's orders to his formations), and where a
// fleet is and the posture it keeps ARE its orders. What this engine does is
// what happens next, a day at a time over the period a turn covers:
//
//   a navy to fight with   a country at war that has a coast and no fleet at
//                          all is given one, in its home waters, of a size
//                          that goes with what it is (commissioned). It is
//                          fitting out for its first days, and a country
//                          whose navy is gone is not given another for years
//   closing                a fleet that is seeking battle (posture
//                          "assaulting") makes for the nearest hostile fleet
//                          it could reach, over open water
//   retiring               a fleet that is withdrawing makes for its own
//                          coast; under it, as a fleet holding its home
//                          waters is, it is seldom brought to battle
//   battle                 hostile fleets within reach of each other may
//                          fight: the more so the more either wants to, and a
//                          fleet that is withdrawing is hard to bring to it.
//                          Every fleet of the two sides in reach joins. Each
//                          side's weight is its fleets' strength, what their
//                          countries are, and how they are handled; the side
//                          outweighed loses more
//   afterwards             a fleet beaten down to nothing is sunk and gone; a
//                          side that lost, and a fleet badly mauled, breaks
//                          off and withdraws
//   blockade               a fleet in the posture of that name, not beaten
//                          off, within reach of an enemy's coast presses on
//                          that country: how hard is worked out for each day
//                          (blockade.js), and what it costs the country's
//                          economy and its armies is the turn's to apply
//
// It returns what the fleets became (their strength, where they are, a
// posture changed, a fleet gone, a fleet commissioned) and the battles, for
// the story to tell and the map to show.
//
// Pure, the same input the same result on every machine (nothing is drawn but
// from the run's seed), and it loads in plain Node.

import { addGameDays, diffGameDays } from "../gameDates.js";
import { BLOCKADE_LEAST, dayPressure, seaShareOf, stationsOf } from "./blockade.js";
import { readMilitary, seaWorth } from "../fronts/military.js";
import { weatherOn } from "../fronts/weather.js";
import { kmBetween } from "../fronts/worldGrid.js";
import { eraOf } from "../unitMotion.js";
import { normalizeNavalControlChronology } from "./controlChronology.js";

// How far apart hostile fleets can be and still fight, in km, by era (before
// 1500, 1500 to 1849, 1850 to 1944, from 1945): oars and sail meet hull to
// hull; aircraft and missiles reach over the horizon.
export const NAVAL_REACH_KM = Object.freeze([150, 300, 600, 900]);
// How far a fleet seeking battle will go after one, as a multiple of that
// reach, and how far a fleet sails in a day.
export const SORTIE_REACHES = 4;
export const FLEET_KM_PER_DAY = Object.freeze([130, 200, 480, 750]);
// How much a posture wants a fight (the chance that fleets in reach are
// brought to battle on a day goes by the keener of the two), and how well a
// fleet fights under it.
export const POSTURE_KEEN = Object.freeze({ assaulting: 1, blockade: 0.8, patrol: 0.6, massing: 0.5, exercise: 0.4, transit: 0.4, holding: 0.3, withdrawing: 0.1 });
export const POSTURE_FIGHTS = Object.freeze({ assaulting: 1.1, blockade: 1, patrol: 1, massing: 1, exercise: 0.9, transit: 0.8, holding: 1.05, withdrawing: 0.6 });
// A day's chance for two fleets in reach: ENGAGE_LEAST and up to ENGAGE_SPAN
// more for the keenest posture, so fleets patrolling the same water meet
// within a week or two and not on the first morning; less by EVADES where one
// is withdrawing, and by SHELTERED where one that is withdrawing or holding
// lies within HOME_WATERS_KM of its own coast.
export const ENGAGE_LEAST = 0.02;
export const ENGAGE_SPAN = 0.18;
export const EVADES = 0.4;
export const SHELTERED = 0.3;
export const HOME_WATERS_KM = 120;
// A battle: the points of strength an evenly matched side loses, before how
// hard it was fought; a fleet at or under SUNK_UNDER afterwards is gone, one
// under BREAKS_UNDER breaks off, and so does every fleet of a side whose share
// of the battle's weight was under LOST_UNDER.
export const BATTLE_LOSS = 20;
export const SUNK_UNDER = 10;
export const BREAKS_UNDER = 35;
export const LOST_UNDER = 0.42;
// The days a fleet that has fought is in no state to fight again: a month has
// one battle in it for a fleet, and a year a campaign.
export const REFIT_DAYS = 21;
// A fleet commissioned for a country that had none: its strength by what the
// country is, and how many a run commissions at most.
export const COMMISSION_LEAST = 40;
export const COMMISSION_PER_WEIGHT = 3;
export const COMMISSIONS_MOST = 6;
// The days a fleet just commissioned is fitting out and fights nobody, and the
// days before a country that was given a navy, or lost the last of one, is
// given another: a navy takes years to build.
export const FITTING_OUT_DAYS = 10;
export const NAVY_REBUILD_DAYS = 1095;
export const NAVIES_KEPT_MOST = 120;
export const FLEET_KINDS_BY_ERA = Object.freeze([
  "galleys and transports",
  "ships of the line and frigates",
  "battleships, cruisers and destroyers",
  "carriers, destroyers and submarines",
]);
export const SEA_BATTLES_A_RUN_MOST = 16;
// How near a named sea or a city has to be for a battle to be called by it.
export const NAMED_SEA_KM = 900;
export const NAMED_CITY_KM = 400;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => Number.isFinite(Number(value));

// Weighing the weather: the states that are a storm at sea, what one leaves of the chance that fleets in
// reach of each other meet, and of what a blockading fleet can do.
const STORMY = new Set(["storm", "blizzard"]);
// How far from frozen water's box a place on a coast is still beside it, in degrees.
const ICE_COAST_DEGREES = 0.25;
export const STORM_ENGAGE = 0.25;
export const STORM_BLOCKADE = 0.5;

// A number from 0 up to 1 that belongs to one thing that happens.
const chanceOf = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
};

const keenOf = (posture) => POSTURE_KEEN[fold(posture)] ?? 0.5;
const fightsOf = (posture) => POSTURE_FIGHTS[fold(posture)] ?? 1;
// What a fleet's country adds to it: a great power's fleet is more than a small state's at the same strength.
export const navyFactor = (weight) => 0.5 + 0.5 * Math.min(3, Math.max(0, Number(weight) || 0) / 10);

// Who is at war with whom, from the ledger as the period begins.
export const hostilities = (wars) => {
  const enemies = new Map();
  const warOf = new Map();
  const add = (a, b, id) => {
    if (!enemies.has(a)) enemies.set(a, new Set());
    enemies.get(a).add(b);
    warOf.set(`${a}|${b}`, id);
  };
  for (const war of list(wars)) {
    if (fold(war?.status || "active") !== "active") continue;
    const sides = [list(war.sideA).map(fold).filter(Boolean), list(war.sideB).map(fold).filter(Boolean)];
    for (const a of sides[0]) {
      for (const b of sides[1]) {
        if (a === b) continue;
        add(a, b, clean(war.id));
        add(b, a, clean(war.id));
      }
    }
  }
  return { enemies, warOf, hostile: (a, b) => enemies.get(a)?.has(b) === true };
};

// The cells beside a cell of the sheet, the diagonal ones too.
const BESIDE = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const besideOf = (grid, cell) => {
  const col = cell % grid.cols;
  const row = (cell - col) / grid.cols;
  const cells = [];
  for (const [dx, dy] of BESIDE) {
    const x = grid.wrap ? (col + dx + grid.cols) % grid.cols : col + dx;
    const y = row + dy;
    if (x < 0 || x >= grid.cols || y < 0 || y >= grid.rows) continue;
    cells.push(y * grid.cols + x);
  }
  return cells;
};

// A country's coast, for every country asked of, in one pass over the sheet:
// the cells of its land that are part water themselves or lie beside water.
// And, counted in the same pass, how many of its cells lie on a land border
// with a country it is not at war with (`borders`): what it can still trade
// over when its coast is closed (blockade.js seaShareOf).
//   enemies   Map of a country to the set of those it is at war with
const coastsOf = (grid, wanted, controllerOf, enemies = null) => {
  const coasts = new Map([...wanted].map((name) => [name, []]));
  const borders = new Map([...wanted].map((name) => [name, 0]));
  coasts.borders = borders;
  if (!grid || wanted.size === 0 || typeof controllerOf !== "function") return coasts;
  const holders = new Map();
  const holderOf = (mark) => {
    if (!holders.has(mark)) holders.set(mark, fold(controllerOf(grid.ids[mark])));
    return holders.get(mark);
  };
  for (let cell = 0; cell < grid.land.length; cell += 1) {
    const land = grid.land[cell];
    const mark = grid.region[cell];
    if (land === 0 || !mark) continue;
    const holder = holderOf(mark);
    const cells = coasts.get(holder);
    if (!cells) continue;
    let water = land < grid.full;
    let open = false;
    for (const next of besideOf(grid, cell)) {
      if (grid.land[next] < grid.full) water = true;
      const other = grid.land[next] > 0 && grid.region[next] ? holderOf(grid.region[next]) : "";
      if (other && other !== holder && enemies?.get(holder)?.has(other) !== true) open = true;
    }
    if (water) cells.push(cell);
    if (open) borders.set(holder, borders.get(holder) + 1);
  }
  return coasts;
};

// A country's home water: on its coast, nearest a place (its capital, for a
// new fleet; where a fleet is, for one sailing home), where one is given.
const homeWater = (grid, cells, capital) => {
  if (cells.length === 0) return null;
  let best = cells[Math.floor(cells.length / 2)];
  if (capital) {
    let least = Infinity;
    for (const cell of cells) {
      const [lng, lat] = grid.centreOf(cell);
      const km = grid.km(lng, lat, capital.lng, capital.lat);
      if (km < least) {
        least = km;
        best = cell;
      }
    }
  }
  // (Open water beside it, where there is some: a fleet is not drawn on the beach.)
  const beside = besideOf(grid, best);
  const open = beside.find((cell) => grid.land[cell] === 0) ?? beside.find((cell) => grid.land[cell] < grid.full);
  return grid.centreOf(open ?? best);
};

// Whether a straight course between two places is water all the way, on the sheet.
const openWater = (grid, from, to) => {
  if (!grid) return false;
  const steps = Math.max(2, Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) / (grid.step * 0.5)));
  for (let step = 0; step <= steps; step += 1) {
    const cell = grid.cellOf(from[0] + ((to[0] - from[0]) * step) / steps, from[1] + ((to[1] - from[1]) * step) / steps);
    if (cell < 0 || grid.land[cell] >= grid.full) return false;
  }
  return true;
};

// What a battle is called by: a sea its scenario names, else a city it was fought off, else nothing.
const placeOf = ({ lng, lat, seas, cities, km }) => {
  let best = null;
  for (const sea of list(seas)) {
    if (!clean(sea?.name) || !finite(sea.lng) || !finite(sea.lat)) continue;
    const far = km(lng, lat, Number(sea.lng), Number(sea.lat));
    if (far <= NAMED_SEA_KM && (!best || far < best.far)) best = { far, name: clean(sea.name) };
  }
  if (best) return `in ${best.name}`;
  for (const city of list(cities)) {
    if (!clean(city?.name) || !finite(city.lng) || !finite(city.lat)) continue;
    const far = km(lng, lat, Number(city.lng), Number(city.lat));
    if (far <= NAMED_CITY_KM && (!best || far < best.far)) best = { far, name: clean(city.name) };
  }
  return best ? `off ${best.name}` : "at sea";
};

// The war at sea over a period.
//   fromDate, days   the period
//   seed             what makes this run its own
//   wars             the war ledger as the period begins
//   units            world.units
//   strengthOf       (name) => a country's weight (Game/AI/frontTurn.js countryWeight)
//   controllerOf     (regionId) => who holds a region
//   grid             the sheet of the whole map (runtime/fronts/worldGrid.js), or null:
//                    without it nobody is commissioned and nobody closes
//   cities, seas     the map's cities and the seas its scenario names, for what a battle is called
//   flat, scale      the map's own measure, where it is a flat sheet
//   factor, metric   the same on a world projection (fronts/worldGrid.js measureOptions)
//   caps             { perCountry, world }: the most formations a country and the world may have
//   raised           world.naviesRaised: [{ country, date }], when each country was last given
//                    a navy or lost the last of one
// Returns { battles, unitChanges, commissioned, fleets, raised, blockades, blockadePeriods, blockadeDays }.
//   blockades   [{ country, by: [names], pressure, covered, days }]: each country a fleet
//               pressed on in the period (blockade.js): the mean of its days, the share
//               of its coast reached, and how many of the period's days it stood
//   blockadePeriods [{ country, fromDate, toDate, days, activeDays, pressure, covered, by }]:
//               dated, disjoint monthly slices of raw pressure for coasts exposed
//               during the turn, including later zero-pressure months. A missing
//               map gives null evidence; NOT an additional GDP debit.
//   blockadeDays [{ country, date, pressure, covered, by }]: sparse, positive,
//               civil-day observations on (fromDate, fromDate+days]. Missing
//               dates mean zero ONLY when this complete array is available.
//               Null means unknown, never zero and never a GDP debit.
export const runNaval = ({ fromDate = "", days = 0, seed = "", wars = [], units = [], strengthOf = null, controllerOf = null, grid = null, cities = [], seas = [], flat = false, scale = undefined, factor = 1, metric = null, caps = {}, raised = [], era: setEra = null, militaryOf = null, weatherSeed = null, iced = [], controlChanges = [] } = {}) => {
  const era = eraOf(fromDate, setEra);
  // Weighing the weather (fronts/weather.js): a storm keeps fleets apart and weakens a blockade. Fleets in the same
  // stretch of sea (five degrees by five) have the same weather; none without a seed.
  const stormy = (fleet, day) => (weatherSeed === null || weatherSeed === undefined ? false
    : STORMY.has(weatherOn({ seed: String(weatherSeed), place: `sea ${Math.round(fleet.lng / 5)} ${Math.round(fleet.lat / 5)}`, lat: fleet.lat, date: dateOf(day) }).state));
  // Frozen water (fronts/climate.js): the boxes of water frozen this period. A fleet in one is frozen in: it
  // neither sails nor fights, and blockades nobody.
  const ice = list(iced).filter((box) => Array.isArray(box) && box.length >= 4 && box.every(Number.isFinite));
  const frozenIn = (fleet) => ice.some(([west, south, east, north]) => fleet.lng >= west && fleet.lng <= east && fleet.lat >= south && fleet.lat <= north);
  // A place on a coast beside frozen water (a coast's places lie on its land, at the water's edge): shut by the ice (blockade.js).
  const icedCoast = ice.length === 0 ? null : (lng, lat) => ice.some(([west, south, east, north]) => lng >= west - ICE_COAST_DEGREES && lng <= east + ICE_COAST_DEGREES && lat >= south - ICE_COAST_DEGREES && lat <= north + ICE_COAST_DEGREES);
  // Weighing countries' own military figures (fronts/military.js): what a country's navy is against
  // what every country's was, and 0 for one that has none, which neither fights nor is given a fleet.
  const navies = new Map();
  const seaOf = (name) => {
    if (typeof militaryOf !== "function") return 1;
    const key = fold(name);
    if (!navies.has(key)) navies.set(key, seaWorth(readMilitary(militaryOf(name))));
    return navies.get(key);
  };
  const reach = NAVAL_REACH_KM[era];
  const km = (lngA, latA, lngB, latB) => (grid ? grid.km(lngA, latA, lngB, latB) : kmBetween(lngA, latA, lngB, latB, { flat, scale, factor, metric }));
  const dateOf = (day) => addGameDays(fromDate, day) || clean(fromDate);
  const weightOf = (name) => {
    const weight = typeof strengthOf === "function" ? Number(strengthOf(name)) : 1;
    return Number.isFinite(weight) && weight > 0 ? weight : 1;
  };
  const { enemies, warOf, hostile } = hostilities(wars);
  // The coastline is allowed to change only under explicit, individually
  // checked land-front control receipts. Missing geography remains UNKNOWN.
  const controls = controlChanges.length
    ? normalizeNavalControlChronology({ grid, controllerOf, changes: controlChanges, days }) : [];
  const controlChronology = controls === null ? null : controls;
  const ownerOverrides = new Map();
  const controlOf = (id) => ownerOverrides.get(String(id)) || controllerOf?.(id);
  let changeIndex = 0;

  // When each country's navy was last made or lost, by the country's name.
  const clock = new Map();
  for (const entry of list(raised)) if (clean(entry?.country) && clean(entry?.date)) clock.set(fold(entry.country), { country: clean(entry.country), date: clean(entry.date) });
  const clockNow = () => [...clock.values()].slice(-NAVIES_KEPT_MOST);
  // Missing coast geometry cannot support a dated pressure observation.
  // Peace, in contrast, establishes that no hostile blockade is possible.
  const empty = { battles: [], unitChanges: [], commissioned: [], fleets: [], raised: clockNow(), blockades: [],
    blockadePeriods: controls === null ? null : grid || enemies.size === 0 ? [] : null,
    blockadeDays: controls === null ? null : grid || enemies.size === 0 ? [] : null,
    ...(controlChanges.length && controlChronology ? { controlChronology } : {}),
  };
  if (enemies.size === 0) return empty;

  const all = list(units);
  const fleets = all
    .filter((unit) => unit && fold(unit.type) === "naval" && !clean(unit.committedTo) && clean(unit.id) && finite(unit.lng) && finite(unit.lat) && Number(unit.strength) > 0 && enemies.has(fold(unit.ownerCode)) && seaOf(unit.ownerCode) > 0)
    .map((unit) => ({
      id: clean(unit.id),
      name: clean(unit.name) || "a fleet",
      owner: clean(unit.ownerCode),
      key: fold(unit.ownerCode),
      strength: Math.min(100, Number(unit.strength)),
      began: Math.min(100, Number(unit.strength)),
      posture: fold(unit.posture) || "patrol",
      lng: Number(unit.lng),
      lat: Number(unit.lat),
      at: [Number(unit.lng), Number(unit.lat)],
      ready: 0,
      broke: false,
      sunk: false,
      fresh: false,
    }));

  // ---- a navy to fight with ---------------------------------------------------------
  const commissioned = [];
  const belligerents = new Set(enemies.keys());
  let coasts = grid ? coastsOf(grid, belligerents, controllerOf, enemies) : new Map();
  const names = new Map();
  for (const war of list(wars)) for (const name of [...list(war?.sideA), ...list(war?.sideB)]) if (clean(name) && !names.has(fold(name))) names.set(fold(name), clean(name));
  if (grid && days >= 0) {
    const sailors = new Set(all.filter((unit) => fold(unit?.type) === "naval").map((unit) => fold(unit.ownerCode)));
    const atSea = (name) => sailors.has(name) || (coasts.get(name)?.length ?? 0) > 0;
    const perCountry = new Map();
    for (const unit of all) perCountry.set(fold(unit?.ownerCode), (perCountry.get(fold(unit?.ownerCode)) ?? 0) + 1);
    let total = all.length;
    for (const key of [...belligerents].sort()) {
      if (commissioned.length >= COMMISSIONS_MOST) break;
      if (sailors.has(key) || (coasts.get(key)?.length ?? 0) === 0 || seaOf(key) === 0) continue;
      // (Against somebody it could meet at sea: a war between two that have no enemy there needs no navy.)
      if (![...enemies.get(key)].some(atSea)) continue;
      if (total >= (Number(caps?.world) || Infinity) || (perCountry.get(key) ?? 0) >= (Number(caps?.perCountry) || Infinity)) continue;
      // (A country that was given one, or lost the last of one, waits out the years it takes to build another.)
      const since = clock.get(key);
      if (since && !(diffGameDays(since.date, fromDate) >= NAVY_REBUILD_DAYS)) continue;
      const owner = names.get(key) ?? key;
      const capital = list(cities).find((city) => {
        if (city?.capital !== true || !finite(city.lng) || !finite(city.lat)) return false;
        const cell = grid.cellOf(Number(city.lng), Number(city.lat));
        return cell >= 0 && grid.region[cell] && fold(controllerOf(grid.ids[grid.region[cell]])) === key;
      });
      const home = homeWater(grid, coasts.get(key), capital ? { lng: Number(capital.lng), lat: Number(capital.lat) } : null);
      if (!home) continue;
      const strength = Math.max(COMMISSION_LEAST, Math.min(100, Math.round(COMMISSION_LEAST + COMMISSION_PER_WEIGHT * weightOf(owner))));
      const unit = {
        id: `fleet-${key.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")}-${clean(fromDate)}`,
        name: `${owner} Home Fleet`,
        type: "naval",
        ownerCode: owner,
        strength,
        lng: home[0],
        lat: home[1],
        status: "idle",
        posture: "patrol",
        composition: FLEET_KINDS_BY_ERA[era],
        source: "ai",
      };
      commissioned.push(unit);
      total += 1;
      clock.delete(key);
      clock.set(key, { country: owner, date: clean(fromDate) });
      fleets.push({ id: unit.id, name: unit.name, owner, key, strength, began: strength, posture: "patrol", lng: home[0], lat: home[1], at: [home[0], home[1]], ready: FITTING_OUT_DAYS + 1, broke: false, sunk: false, fresh: true });
    }
  }
  // (One fleet is enough to go on with: a blockade needs nobody to fight.)
  if (fleets.length === 0 || days <= 0) return { ...empty, commissioned, raised: clockNow(), fleets: fleets.map(({ id, name, owner, strength, posture, lng, lat }) => ({ id, name, owner, strength: Math.round(strength), posture, lng, lat, place: placeOf({ lng, lat, seas, cities, km }) })) };

  // The water under each fleet's own coast nearest where it is as the period begins.
  for (const fleet of fleets) {
    const cells = coasts.get(fleet.key) ?? [];
    fleet.home = grid && cells.length > 0 ? homeWater(grid, cells, { lng: fleet.lng, lat: fleet.lat }) : null;
  }
  const shelterOf = (fleet) => ((fleet.posture === "withdrawing" || fleet.posture === "holding") && fleet.home && km(fleet.lng, fleet.lat, fleet.home[0], fleet.home[1]) <= HOME_WATERS_KM ? SHELTERED : 1);

  // Where each country at war with a coast can be blockaded: the places its
  // coast is read at, and how much of its trade goes by sea (blockade.js).
  const posts = new Map();
  for (const key of [...belligerents].sort()) {
    const cells = coasts.get(key) ?? [];
    if (!grid || cells.length === 0) continue;
    posts.set(key, { stations: stationsOf(cells.map((cell) => grid.centreOf(cell))), seaShare: seaShareOf(cells.length, coasts.borders?.get(key) ?? 0), sum: 0, covered: 0, days: 0, by: new Set(), periods: new Map() });
  }
  // When a land frontier changes the coast, add an exposure row only if it
  // eventually records positive pressure. Its zero days must still be counted.
  const refreshCoasts = (day) => {
    if (!controlChronology?.length) return;
    let changed = false;
    while (changeIndex < controlChronology.length && controlChronology[changeIndex].day <= day) {
      const item = controlChronology[changeIndex++];
      ownerOverrides.set(item.regionId, item.to);
      changed = true;
    }
    if (!changed) return;
    coasts = coastsOf(grid, belligerents, controlOf, enemies);
    for (const key of belligerents) {
      const cells = coasts.get(key) ?? [];
      let post = posts.get(key);
      if (!post) {
        post = { stations: [], seaShare: 0, sum: 0, covered: 0, days: 0, by: new Set(), periods: new Map() };
        posts.set(key, post);
      }
      post.stations = stationsOf(cells.map((cell) => grid.centreOf(cell)));
      post.seaShare = seaShareOf(cells.length, coasts.borders?.get(key) ?? 0);
    }
    // Fleet shelter uses home waters at the current date; an occupied home
    // port must not protect a withdrawing fleet for the rest of the turn.
    for (const fleet of fleets) {
      const cells = coasts.get(fleet.key) ?? [];
      fleet.home = cells.length ? homeWater(grid, cells, { lng: fleet.lng, lat: fleet.lat }) : null;
    }
  };

  // Sparse civil-day economic observations stay ephemeral; no new writable
  // blockade ledger or save schema. Overflow is unknown, not partial evidence.
  const BLOCKADE_DAYS_MAX = 12000;
  const blockadeDays = [];
  let blockadeDaysOverflow = false;
  const battles = [];
  const live = (fleet) => !fleet.sunk && !fleet.broke;
  for (let day = 1; day <= days; day += 1) {
    refreshCoasts(day);
    // ---- closing, and retiring -------------------------------------------------------
    if (grid) {
      for (const fleet of fleets) {
        if (fleet.sunk || frozenIn(fleet)) continue;
        if (fleet.posture === "withdrawing") {
          if (!fleet.home) continue;
          const far = km(fleet.lng, fleet.lat, fleet.home[0], fleet.home[1]);
          if (far <= 1) continue;
          const share = Math.min(1, FLEET_KM_PER_DAY[era] / far);
          const to = share >= 1 ? [fleet.home[0], fleet.home[1]] : [fleet.lng + (fleet.home[0] - fleet.lng) * share, fleet.lat + (fleet.home[1] - fleet.lat) * share];
          if (openWater(grid, [fleet.lng, fleet.lat], to)) [fleet.lng, fleet.lat] = to;
          continue;
        }
        if (!live(fleet) || fleet.posture !== "assaulting" || fleet.ready > day) continue;
        let target = null;
        let least = Infinity;
        for (const other of fleets) {
          if (!live(other) || !hostile(fleet.key, other.key)) continue;
          const far = km(fleet.lng, fleet.lat, other.lng, other.lat);
          if (far < least) {
            least = far;
            target = other;
          }
        }
        if (!target || least <= reach * 0.5 || least > reach * SORTIE_REACHES) continue;
        const share = Math.min(1, FLEET_KM_PER_DAY[era] / least, (least - reach * 0.5) / least);
        const to = [fleet.lng + (target.lng - fleet.lng) * share, fleet.lat + (target.lat - fleet.lat) * share];
        if (!openWater(grid, [fleet.lng, fleet.lat], to)) continue;
        [fleet.lng, fleet.lat] = to;
      }
    }

    // ---- battle ----------------------------------------------------------------------
    const pairs = [];
    for (let a = 0; a < fleets.length; a += 1) {
      for (let b = a + 1; b < fleets.length; b += 1) {
        const one = fleets[a];
        const two = fleets[b];
        if (!live(one) || !live(two) || one.ready > day || two.ready > day || !hostile(one.key, two.key)) continue;
        const far = km(one.lng, one.lat, two.lng, two.lat);
        if (far <= reach) pairs.push({ one, two, far });
      }
    }
    pairs.sort((x, y) => x.far - y.far || (x.one.id < y.one.id ? -1 : x.one.id > y.one.id ? 1 : 0) || (x.two.id < y.two.id ? -1 : 1));
    for (const { one, two } of pairs) {
      if (battles.length >= SEA_BATTLES_A_RUN_MOST) break;
      if (one.ready > day || two.ready > day || !live(one) || !live(two) || frozenIn(one) || frozenIn(two)) continue;
      const keen = Math.max(keenOf(one.posture), keenOf(two.posture));
      const shy = Math.min(keenOf(one.posture), keenOf(two.posture)) <= POSTURE_KEEN.withdrawing ? EVADES : 1;
      if (chanceOf(`${seed}|${day}|${one.id}|${two.id}|meet`) >= (ENGAGE_LEAST + ENGAGE_SPAN * keen) * shy * Math.min(shelterOf(one), shelterOf(two)) * (stormy(one, day) || stormy(two, day) ? STORM_ENGAGE : 1)) continue;
      const lng = (one.lng + two.lng) / 2;
      const lat = (one.lat + two.lat) / 2;
      // Every fleet of the two sides that is in reach of it joins.
      const sides = [[one], [two]];
      for (const fleet of fleets) {
        if (fleet === one || fleet === two || !live(fleet) || fleet.ready > day || km(fleet.lng, fleet.lat, lng, lat) > reach) continue;
        const withOne = hostile(fleet.key, two.key) && !hostile(fleet.key, one.key);
        const withTwo = hostile(fleet.key, one.key) && !hostile(fleet.key, two.key);
        if (withOne) sides[0].push(fleet);
        else if (withTwo) sides[1].push(fleet);
      }
      const weights = sides.map((side, index) => side.reduce((sum, fleet) => sum + fleet.strength * navyFactor(weightOf(fleet.owner)) * seaOf(fleet.owner) * fightsOf(fleet.posture), 0)
        * (0.85 + 0.3 * chanceOf(`${seed}|${day}|${one.id}|${two.id}|luck${index}`)));
      const share = weights[0] / (weights[0] + weights[1]);
      const hard = 0.5 + 0.7 * Math.max(...sides.flat().map((fleet) => keenOf(fleet.posture)));
      const told = sides.map((side, index) => {
        const mine = index === 0 ? share : 1 - share;
        const loss = (BATTLE_LOSS * hard * (1 - mine) * 2) / Math.sqrt(side.length);
        return side.map((fleet) => {
          const before = fleet.strength;
          fleet.strength = Math.max(0, fleet.strength - Math.max(1, loss));
          fleet.ready = day + REFIT_DAYS;
          if (fleet.strength <= SUNK_UNDER) {
            fleet.sunk = true;
            fleet.strength = 0;
            fleet.sunkOn = dateOf(day);
          } else if (mine < LOST_UNDER || fleet.strength < BREAKS_UNDER) {
            fleet.broke = true;
            fleet.posture = "withdrawing";
          }
          return { id: fleet.id, name: fleet.name, owner: fleet.owner, before: Math.round(before), after: Math.round(fleet.strength), ...(fleet.sunk ? { sunk: true } : {}), ...(fleet.broke ? { broke: true } : {}) };
        });
      });
      battles.push({
        id: `sea:${dateOf(day)}:${battles.length}`,
        day,
        date: dateOf(day),
        place: placeOf({ lng, lat, seas, cities, km }),
        lng,
        lat,
        warId: warOf.get(`${one.key}|${two.key}`) ?? "",
        sides: sides.map((side) => [...new Set(side.map((fleet) => fleet.owner))]),
        fleets: told,
        winner: share >= 1 - LOST_UNDER ? 0 : share <= LOST_UNDER ? 1 : -1,
      });
    }

    // ---- blockade --------------------------------------------------------------------
    for (const [key, post] of posts) {
      const blockaders = [];
      for (const fleet of fleets) {
        if (!live(fleet) || fleet.posture !== "blockade" || !hostile(fleet.key, key) || frozenIn(fleet)) continue;
        if (!post.stations.some(([lng, lat]) => km(lng, lat, fleet.lng, fleet.lat) <= reach)) continue;
        // What it can put into the blockade: what it is, less what the fleets of its enemies in reach of it tie down.
        const mine = fleet.strength * navyFactor(weightOf(fleet.owner)) * seaOf(fleet.owner) * (stormy(fleet, day) ? STORM_BLOCKADE : 1);
        let tied = 0;
        for (const other of fleets) {
          if (!live(other) || other.posture === "withdrawing" || !hostile(other.key, fleet.key)) continue;
          if (km(other.lng, other.lat, fleet.lng, fleet.lat) <= reach) tied += other.strength * navyFactor(weightOf(other.owner)) * seaOf(other.owner) * fightsOf(other.posture);
        }
        blockaders.push({ lng: fleet.lng, lat: fleet.lat, weight: mine > 0 ? (mine * mine) / (mine + tied) : 0, owner: fleet.owner });
      }
      const today = dayPressure({ stations: post.stations, blockaders, reach, km, seaShare: post.seaShare, iced: icedCoast });
      // Keep each civil day in exactly one month. A month where the blockade
      // was lifted still counts those zero-pressure days in its mean; using
      // only the days when fleets were active would overstate economic harm.
      const date = dateOf(day);
      const month = date.slice(0, 7);
      let period = post.periods.get(month);
      if (!period) {
        // Every period starts at the first observed civil day of this run's
        // month, including if coastline control was gained mid-month.
        const first = addGameDays(fromDate, 1);
        const firstDate = date.slice(0, 7) === first.slice(0, 7) ? first : `${date.slice(0, 7)}-01`;
        const earlierZeroDays = Math.max(0, diffGameDays(firstDate, date));
        period = { fromDate: firstDate, toDate: date, days: earlierZeroDays, activeDays: 0, sum: 0, covered: 0, by: new Set() };
        post.periods.set(month, period);
      }
      period.toDate = date;
      period.days += 1;
      if (!(today.pressure > 0)) continue;
      if (!blockadeDaysOverflow) {
        if (blockadeDays.length >= BLOCKADE_DAYS_MAX) blockadeDaysOverflow = true;
        else blockadeDays.push({
          country: names.get(key) ?? key,
          date,
          pressure: today.pressure,
          covered: today.covered,
          by: [...new Set(blockaders.map((fleet) => fleet.owner))].sort(),
        });
      }
      period.sum += today.pressure;
      period.covered += today.covered;
      period.activeDays += 1;
      for (const fleet of blockaders) period.by.add(fleet.owner);
      post.sum += today.pressure;
      post.covered += today.covered;
      post.days += 1;
      for (const fleet of blockaders) post.by.add(fleet.owner);
    }
  }

  const blockades = [];
  for (const [key, post] of posts) {
    const pressure = post.sum / days;
    if (!(pressure >= BLOCKADE_LEAST)) continue;
    blockades.push({ country: names.get(key) ?? key, by: [...post.by].sort(), pressure: Math.round(pressure * 1000) / 1000, covered: Math.round((post.covered / post.days) * 1000) / 1000, days: post.days });
  }

  // Bounded turn-local evidence; these observations are NOT written into
  // world.blockades. An exceptional skip producing too many slices reports
  // the timeline unavailable, never silently a truncated apparently complete
  // economic history. The original aggregate still drives the war as before.
  const BLOCKADE_PERIODS_MAX = 12000;
  const blockadePeriods = [];
  for (const [key, post] of posts) {
    // Evidence must not inherit the whole-turn blockade threshold: a short
    // blockade can average below BLOCKADE_LEAST in a long skip yet exceed it
    // during a shorter skip covering the same days. Preserve every month's
    // observed pressure (including its weak signals), then explicit zero
    // months after a pressured coast is liberated. The legacy `blockades`
    // array remains thresholded and is still the ONLY GDP/budget writer.
    if (!(post.sum > 0)) continue;
    for (const period of post.periods.values()) {
      blockadePeriods.push({
        country: names.get(key) ?? key,
        fromDate: period.fromDate, toDate: period.toDate,
        days: period.days, activeDays: period.activeDays,
        pressure: period.sum / period.days,
        covered: period.activeDays > 0 ? period.covered / period.activeDays : 0,
        by: [...period.by].sort(),
      });
    }
  }
  blockadePeriods.sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.country.localeCompare(b.country));
  const datedBlockades = !grid || blockadePeriods.length > BLOCKADE_PERIODS_MAX || controls === null ? null : blockadePeriods;
  // A chronological writer cannot infer a specific event-day loss from a
  // monthly average. This bounded exact daily evidence is the future input;
  // it must never be confused with the legacy whole-period GDP writer.
  blockadeDays.sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
  const datedBlockadeDays = !grid || blockadeDaysOverflow || controls === null ? null : blockadeDays;

  const unitChanges = [];
  for (const fleet of fleets) {
    if (fleet.fresh) {
      // (A fleet commissioned this period is written as it ends it, or not at all.)
      const unit = commissioned.find((entry) => entry.id === fleet.id);
      if (fleet.sunk) commissioned.splice(commissioned.indexOf(unit), 1);
      else Object.assign(unit, { strength: Math.max(1, Math.round(fleet.strength)), lng: fleet.lng, lat: fleet.lat, posture: fleet.posture });
      continue;
    }
    if (fleet.sunk) {
      unitChanges.push({ unitId: fleet.id, remove: true });
      continue;
    }
    const moved = fleet.lng !== fleet.at[0] || fleet.lat !== fleet.at[1];
    const worn = Math.round(fleet.strength) !== Math.round(fleet.began);
    if (!moved && !worn && !fleet.broke) continue;
    unitChanges.push({
      unitId: fleet.id,
      ...(worn ? { strength: Math.max(1, Math.round(fleet.strength)) } : {}),
      ...(moved ? { lng: fleet.lng, lat: fleet.lat } : {}),
      ...(fleet.broke ? { posture: "withdrawing" } : {}),
    });
  }
  // A country whose last fleet went down has no navy from that day: its years of building begin then.
  const afloat = new Set(all.filter((unit) => fold(unit?.type) === "naval" && clean(unit?.id) && !fleets.some((fleet) => fleet.id === clean(unit.id) && fleet.sunk)).map((unit) => fold(unit.ownerCode)));
  for (const fleet of fleets) if (!fleet.sunk) afloat.add(fleet.key);
  for (const fleet of fleets) {
    if (!fleet.sunk || afloat.has(fleet.key)) continue;
    const before = clock.get(fleet.key);
    if (before && diffGameDays(before.date, fleet.sunkOn) <= 0) continue;
    clock.delete(fleet.key);
    clock.set(fleet.key, { country: fleet.owner, date: fleet.sunkOn });
  }
  return {
    battles,
    unitChanges,
    commissioned,
    raised: clockNow(),
    blockades,
    blockadePeriods: datedBlockades,
    blockadeDays: datedBlockadeDays,
    ...(controlChanges.length ? { controlChronology } : {}),
    fleets: fleets.filter((fleet) => !fleet.sunk).map(({ id, name, owner, strength, posture, lng, lat }) => ({ id, name, owner, strength: Math.round(strength), posture, lng, lat, place: placeOf({ lng, lat, seas, cities, km }) })),
  };
};
