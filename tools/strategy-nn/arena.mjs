/*! Open Historia — the strategy network experiment: the arena © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. Wars for two staffs to fight each other in.
//
// "Train the AIs against each other and whichever wins advances. Add penalties
// for losing city territory, for losing troops, and for losing land; have the
// models train across various different country combos; add bonuses for taking
// enemy cities, encompassing, taking troops, and taking land."
//
// A SCENARIO is drawn from a seed: two to four countries side by side on a
// sheet, each of its own size and strength, with a capital and a few towns; a
// war between two TEAMS of them (one against one, two against one, one against
// two, two against two, or one against one with a neighbour looking on); an
// age, from galleys to the present; four to six months of it. The game's own
// front engine fights it a month at a time.
//
// Each team is led by a STAFF: a trained network, the engine's scripted staff,
// or a plain habit. The same staff leads every country and every battlefield
// of its team.
//
// WHAT A TEAM IS REWARDED AND CHARGED (REWARD below), all of it as things
// stand at the end of the war:
//
//   land taken        every THOUSAND SQUARE KILOMETRES of the other team's home
//                     ground it holds: ground its troops walked over and hold,
//                     cell by cell, by the area each cell covers. Not regions,
//                     and not a share: the same ground is worth the same
//                     whichever country it is in and however large that is.
//   land lost         every thousand square kilometres of its own the other holds
//   town taken        every town of the other team's whose ground it holds (a
//                     town of a hundred thousand or more counts LARGE_TOWN_COUNTS times)
//   town lost         every town of its own the other holds
//   capital taken     the other team's capital, held
//   capital lost      its own, held by the other: the worst there is
//   troops taken      the other team's losses in strength, as a share of what it began with
//   troops lost       its own
//   encompassing      the largest share of the other team's troops it had cut
//                     off at once, and every pocket of them that gave up
//
// A city is worth a great deal of ground, and a capital more than any city:
// "taking a city should matter much more tactically", "losing a capital city
// should matter even more". Losing counts for more than taking: "it should
// factor in needing to defend its own territory".
//
// Everything is drawn from the scenario's seed: the same scenario and the same
// two staffs are the same war.

import { addGameDays } from "../../src/runtime/gameDates.js";
import { musterTable } from "../../src/runtime/mustering.js";
import { runFronts } from "../../src/runtime/fronts/engine.js";
import { homeTableOf } from "../../src/runtime/fronts/mind/features.js";
import { DIG_IN, HOLD, PUSH, REST, STRIKE, TAKE_CAPITAL, TAKE_CITY, TROOP_ACTIONS, troopView } from "../../src/runtime/fronts/mind/troops.js";
import { syntheticMap } from "../../src/runtime/fronts/syntheticMap.js";

// (Measured on the scripted staff's wars and always advancing against it, a
// team in a war takes about fifteen thousand square kilometres, half the time
// none; a town in one war of two; a capital in about one war of two.)
export const REWARD = Object.freeze({
  landTaken: 0.2,
  landLost: 0.3,
  townTaken: 4,
  townLost: 5,
  capitalTaken: 12,
  capitalLost: 30,
  troopsTaken: 3,
  troopsLost: 4,
  encompassed: 2,
});
export const REWARD_PARTS = Object.freeze(["landTaken", "landLost", "townTaken", "townLost", "capitalTaken", "capitalLost", "troopsTaken", "troopsLost", "encompassed"]);
// The parts a team is charged for (its rewards are what it is given).
export const CHARGES = Object.freeze(new Set(["landLost", "townLost", "capitalLost", "troopsLost"]));
// What a town of a hundred thousand or more counts for beside a smaller one.
export const LARGE_TOWN_COUNTS = 1.5;
// Land is counted by the thousand square kilometres.
export const LAND_UNIT_KM2 = 1000;
// What a pocket that gave up adds to the share cut off, and the most any one share counts for.
export const POCKET_GAVE_UP = 0.25;
export const SHARE_MOST = 1.5;
export const PERIOD_DAYS = 30;
export const AGES = Object.freeze([1200, 1650, 1914, 1941, 1975, 2024]);
const COUNTRIES = Object.freeze(["Aland", "Borduria", "Cisland", "Dorland"]);
const LETTERS = "ABCD";
const LARGE_TOWN = 100000;

// A generator of numbers from 0 up to 1, from a seed (mulberry32).
export const rngOf = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

// Who is at war with whom, by how many countries there are: [team that began, the other], and a word for it.
const COMBOS = Object.freeze({
  2: [{ teams: [[0], [1]], kind: "one against one" }],
  3: [
    { teams: [[0, 2], [1]], kind: "two against one" },
    { teams: [[1], [0, 2]], kind: "one against two" },
    { teams: [[0], [1]], kind: "one against one, a neighbour looking on" },
    { teams: [[1], [2]], kind: "one against one, a neighbour looking on" },
  ],
  4: [
    { teams: [[0, 2], [1, 3]], kind: "two against two" },
    { teams: [[0, 1], [2, 3]], kind: "two against two" },
    { teams: [[1], [0, 2]], kind: "one against two" },
    { teams: [[1, 3], [2]], kind: "two against one" },
  ],
});

// A war to be fought, from a seed.
export const makeScenario = (seed) => {
  const random = rngOf(seed);
  const pick = (least, most) => least + Math.floor(random() * (most - least + 1));
  const count = [2, 2, 2, 3, 3, 3, 4, 4][pick(0, 7)];
  const rows = pick(3, 6);
  const widths = Array.from({ length: count }, () => pick(2, 4));
  const cols = widths.reduce((sum, width) => sum + width, 0);
  // Where each country's band ends, row by row: the borders wander a little.
  const ends = [];
  let at = 0;
  for (const width of widths.slice(0, -1)) {
    at += width;
    ends.push(at);
  }
  const layout = [];
  const edges = ends.slice();
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < edges.length; index += 1) {
      const least = (index === 0 ? 0 : edges[index - 1]) + 1;
      const most = (index === edges.length - 1 ? cols : edges[index + 1]) - 1;
      edges[index] = Math.max(least, Math.min(most, edges[index] + pick(-1, 1)));
    }
    let line = "";
    for (let col = 0; col < cols; col += 1) line += LETTERS[edges.findIndex((edge) => col < edge) < 0 ? count - 1 : edges.findIndex((edge) => col < edge)];
    layout.push(line);
  }
  const step = [0.5, 0.75, 1][pick(0, 2)];
  const stepLat = Math.round(step * 0.6 * 100) / 100;
  // What each country is: a small state, a middling one or a great power.
  const weights = Array.from({ length: count }, () => {
    const [least, most] = [[1.5, 3], [3, 6], [6, 9]][pick(0, 2)];
    return Math.round((least + random() * (most - least)) * 10) / 10;
  });
  const combo = COMBOS[count][pick(0, COMBOS[count].length - 1)];
  // A capital and up to three towns each, on regions of its own.
  const cities = [];
  for (let country = 0; country < count; country += 1) {
    const cells = [];
    layout.forEach((line, row) => [...line].forEach((letter, col) => { if (letter === LETTERS[country]) cells.push([col, row]); }));
    const towns = Math.min(cells.length, 1 + pick(0, 3));
    for (let town = 0; town < towns; town += 1) {
      const [col, row] = cells.splice(pick(0, cells.length - 1), 1)[0];
      cities.push({
        name: town === 0 ? `${COUNTRIES[country]} Capital` : `${COUNTRIES[country]} Town ${town}`,
        lng: 20 + (col + 0.5) * step,
        lat: 52 - (row + 0.5) * stepLat,
        population: town === 0 ? 500000 + pick(0, 4500000) : 20000 + pick(0, 780000),
        ...(town === 0 ? { capital: true } : {}),
        country,
      });
    }
  }
  return {
    seed,
    layout,
    step,
    stepLat,
    countries: COUNTRIES.slice(0, count),
    weights,
    teams: combo.teams,
    kind: combo.kind,
    cities,
    year: AGES[pick(0, AGES.length - 1)],
    periods: pick(4, 6),
    ...newerMechanics(random, pick, { count, layout, step, stepLat }),
  };
};

// Wars and Fronts Pt.2: what each war is drawn with besides, from the same
// seed. The month it begins in (its seasons), each country's own military
// figures and how long it takes to muster, now and then ground harder to
// cross across the border or a wall behind one, and air wings from 1914.
function newerMechanics(random, pick, { count, layout, step, stepLat }) {
  const month = pick(1, 12);
  const military = Array.from({ length: count }, () => ({
    quality: pick(25, 85),
    technology: pick(30, 80),
    land: 50,
    sea: 50,
    air: 50,
    manpowerShare: [8, 10, 12, 12, 15, 20, 30][pick(0, 6)],
    ...(random() < 0.2 ? { cavalryShare: Math.round(random() * 60) / 100, siegeShare: Math.round(random() * 20) / 100 } : {}),
  }));
  const muster = Array.from({ length: count }, () => {
    const first = [0.3, 0.4, 0.5, 0.6][pick(0, 3)];
    const days = pick(5, 30);
    return [[first, days], [1, days * (2 + pick(0, 3))]];
  });
  // Rough ground across one border, a column or two of regions wide; a wall a little inside another's.
  const cols = layout[0].length;
  const rows = layout.length;
  const terrain = random() < 0.3
    ? (() => {
      const col = pick(1, cols - 2);
      const west = 20 + col * step;
      return [{ id: "rough", level: pick(3, 8), rings: [[[west, 52], [west + step * pick(1, 2), 52], [west + step * 2, 52 - rows * stepLat], [west, 52 - rows * stepLat]]] }];
    })()
    : [];
  const wall = random() < 0.25
    ? (() => {
      const owner = pick(0, count - 1);
      const columns = layout.map((line) => [...line].map((letter, at) => (letter === LETTERS[owner] ? at : -1)).filter((at) => at >= 0));
      const edge = columns.map((list) => (list.length > 0 ? Math.min(...list) : 0));
      const lng = 20 + (Math.max(...edge) + 0.5) * step;
      return [{ id: "wall", name: "the wall", owner, level: pick(3, 9), points: [[lng, 52.2], [lng, 52 - rows * stepLat - 0.2]], breaches: [], wear: [] }];
    })()
    : [];
  return { month, military, muster, terrain, wall };
}

// Each country's air wings, from 1914: none, or up to four on its own ground.
const wingsOf = (scenario, random) => {
  if (scenario.year < 1914) return [];
  const units = [];
  scenario.countries.forEach((name, country) => {
    const cells = [];
    scenario.layout.forEach((line, row) => [...line].forEach((letter, col) => { if (letter === LETTERS[country]) cells.push([col, row]); }));
    const count = Math.floor(random() * 5);
    for (let at = 0; at < count && cells.length > 0; at += 1) {
      const [col, row] = cells[Math.floor(random() * cells.length)];
      units.push({ id: `wing-${country}-${at}`, name: `${name} wing ${at + 1}`, type: "air", ownerCode: name, strength: 100, lng: 20 + (col + 0.5) * scenario.step, lat: 52 - (row + 0.5) * scenario.stepLat });
    }
  });
  return units;
};

// What a team came to, as a number: each part by its weight, charges taken off.
export const rewardOf = (part) => REWARD_PARTS.reduce((sum, key) => sum + (CHARGES.has(key) ? -1 : 1) * REWARD[key] * (Number(part[key]) || 0), 0);

// A habit that orders troops one by one: each troop is given the first of a
// list of orders it may be given (troops.js), as a trained network's are.
export const troopHabit = (prefer) => (battle, side) => {
  const view = troopView(battle, side);
  const bodies = new Map();
  const said = new Array(TROOP_ACTIONS.length).fill(0);
  for (const row of view.rows) {
    const chosen = prefer.find((action) => row.valid[action]) ?? HOLD;
    said[chosen] += 1;
    const key = chosen === HOLD ? "hold" : chosen === DIG_IN ? "dig in" : chosen === PUSH ? "push" : chosen === REST ? "rest" : row.goal[chosen];
    if (!bodies.has(key)) bodies.set(key, []);
    bodies.get(key).push(row.index);
  }
  const troops = [...bodies.entries()].map(([key, picked]) => (key === "hold" || key === "dig in" ? { order: key, picked }
    : key === "push" ? { order: "advance", picked }
      : key === "rest" ? { order: "rest", picked }
      : { order: "advance", picked, way: view.places.get(key).way.map(([x, y]) => battle.place.toLngLat(x, y)) }));
  return { troops, said };
};

// The plain habits a staff is tried against beside the scripted one. The
// best of them: the whole line always advancing. And one that orders troops
// one by one: every troop that can goes for a capital, else a city, else the
// weakest place near it, else straight on.
export const HABITS = Object.freeze({
  advance: () => ({ order: "advance", sector: "all" }),
  hold: () => ({ order: "hold", sector: "all" }),
  dig: () => ({ order: "dig in", sector: "all" }),
  cities: troopHabit([TAKE_CAPITAL, TAKE_CITY, STRIKE, PUSH]),
  // "Drawing a route with all your forces and making the route go super deep into enemy territory makes it just
  // sledgehammer through" (the owner, 2026-10-14): every troop down one route to the other side's capital.
  thrust: (battle, side) => {
    const cities = battle.arena.cities ?? [];
    const target = cities.find((city) => city.capital && city.cell >= 0 && battle.homes?.[city.cell] === 1 - side)
      ?? cities.find((city) => city.cell >= 0 && battle.homes?.[city.cell] === 1 - side);
    if (!target) return { order: "advance", sector: "all" };
    const picked = battle.troops[side].map((troop, index) => (troop.strength > 0 ? index : -1)).filter((index) => index >= 0);
    return { troops: [{ order: "advance", picked, way: [battle.place.toLngLat(target.x, target.y)] }] };
  },
});

// How the two teams of a scenario stand by what their countries are: the
// stronger's weight over the weaker's. A war of 2 or less is one that orders
// can decide; in one much more lopsided, what is ordered hardly matters.
export const lopsidedness = (scenario) => {
  const sums = scenario.teams.map((members) => members.reduce((sum, index) => sum + scenario.weights[index], 0));
  return Math.max(sums[0], sums[1]) / Math.max(1e-9, Math.min(sums[0], sums[1]));
};
// `count` seeds from `from` on whose scenarios are contested (lopsidedness 2 or less).
export const contestedSeeds = (from, count) => {
  const seeds = [];
  for (let seed = from; seeds.length < count; seed += 1) if (lopsidedness(makeScenario(seed)) <= 2) seeds.push(seed);
  return seeds;
};

const fold = (value) => String(value ?? "").trim().toLowerCase();
const capped = (value) => Math.max(0, Math.min(SHARE_MOST, value));
// A country's people from its weight: what countryWeight reads back (2 * sqrt(millions)).
const peopleOfWeight = (weight) => Math.round(((weight / 2) * (weight / 2)) * 1e6);
const townCounts = (city) => ((Number(city.population) || 0) >= LARGE_TOWN ? LARGE_TOWN_COUNTS : 1);
// What a staff that decides for the side as a whole said, as the nearest of what a troop may be told.
const SIDE_WORDS = Object.freeze({ "dig in": DIG_IN, hold: HOLD });

// Fights a scenario between two staffs.
//   staffs   [the staff of the team that began the war, the other team's]: each a
//            (battle, side, context, run) => decision | undefined, or null for the
//            engine's own scripted staff
// Returns { rewards: [a, b], parts: [{ landTaken, ... }, { ... }], looks: [n, n],
// said: [[a count for each of TROOP_ACTIONS], [...]], land: [km² taken, km² taken] }.
export const fight = (scenario, staffs = [null, null]) => {
  const legend = Object.fromEntries(scenario.countries.map((name, index) => [LETTERS[index], name]));
  const world = syntheticMap({ layout: scenario.layout, legend, west: 20, north: scenario.north ?? 52, step: scenario.step, stepLat: scenario.stepLat, cities: scenario.cities.map(({ country, ...city }) => city), key: `arena-${scenario.seed}` });
  const names = scenario.countries;
  const teamOfName = new Map();
  scenario.teams.forEach((members, team) => members.forEach((index) => teamOfName.set(fold(names[index]), team)));
  const teamOf = (name) => teamOfName.get(fold(name)) ?? -1;
  const people = new Map(names.map((name, index) => [fold(name), peopleOfWeight(scenario.weights[index])]));
  const weights = new Map(names.map((name, index) => [fold(name), scenario.weights[index]]));

  const looks = [0, 0];
  const said = [new Array(TROOP_ACTIONS.length).fill(0), new Array(TROOP_ACTIONS.length).fill(0)];
  // What is known of each battlefield: the battle as the engine last had it, which team each of its sides is, and the tallies.
  const fields = new Map();
  const fieldOf = (name) => {
    if (!fields.has(name)) fields.set(name, { live: null, liveRun: null, teams: [-1, -1], before: [new Map(), new Map()], began: [0, 0], lost: [0, 0], cut: [0, 0], run: -1 });
    return fields.get(name);
  };
  let period = 0;
  const staffPolicy = (battle, side, context, run) => {
    const field = fieldOf(battle.name);
    field.live = battle;
    field.liveRun = run;
    homeTableOf(battle, run);
    field.teams = [teamOf(battle.sides[0][0]), teamOf(battle.sides[1][0])];
    const team = field.teams[side];
    if (team < 0) return undefined;
    const staff = staffs[team];
    // (A staff that looks ahead, mind/planner.js, is asked every day; any other only on the engine's own days,
    // and a habit keeps to its habit between them: only the engine's own staff answers a breakthrough.)
    if (context?.regular === false && staff?.often !== true) return staff ? { keep: true } : undefined;
    looks[team] += 1;
    if (!staff) return undefined;
    const decided = staff(battle, side, context, run);
    if (Array.isArray(decided?.said)) decided.said.forEach((count, at) => { said[team][at] += count; });
    else if (decided?.order) said[team][SIDE_WORDS[decided.order] ?? (decided.sector === "all" ? PUSH : STRIKE)] += 1;
    return decided;
  };
  staffPolicy.often = staffs.some((staff) => staff?.often === true);
  // Every day of every battlefield: what each side's troops lost, and how many are cut off.
  const watch = (seen) => {
    const field = fieldOf(seen.battlefield);
    for (const side of [0, 1]) {
      const troops = seen.troops?.[side] ?? [];
      // (A month's troops are read afresh from the record: what they were the month before is not theirs to lose again.)
      if (field.run !== period) field.before[side] = new Map();
      let live = 0;
      let cut = 0;
      let total = 0;
      troops.forEach((troop, index) => {
        const strength = Math.max(0, Number(troop.strength) || 0);
        const was = field.before[side].get(index);
        if (was !== undefined && strength < was) field.lost[side] += was - strength;
        field.before[side].set(index, strength);
        total += strength;
        if (strength > 0) {
          live += 1;
          if (troop.pocket) cut += 1;
        }
      });
      if (field.began[side] === 0) field.began[side] = total;
      if (live > 0 && cut / live > field.cut[side]) field.cut[side] = cut / live;
    }
    field.run = period;
  };

  const arenas = new Map();
  const gaveUp = [0, 0];
  let saved = [];
  // (The newer mechanics: what this war was drawn with.)
  const month = String(scenario.month ?? 3).padStart(2, "0");
  const opened = `${String(scenario.year).padStart(4, "0")}-${month}-01`;
  let fromDate = opened;
  const militaryOf = new Map(names.map((name, index) => [fold(name), scenario.military?.[index] ?? null]));
  const musterOf = new Map(names.map((name, index) => [fold(name), scenario.muster?.[index] ? { table: musterTable(scenario.muster[index]), head: scenario.muster[index][0][1] } : null]));
  // (A duel brings its own, turned round for each side: duel.mjs.)
  const wings = Array.isArray(scenario.wings) ? scenario.wings : wingsOf(scenario, rngOf(scenario.seed + 7));
  let walls = (scenario.wall ?? []).map((line) => ({ ...line, owner: names[line.owner] ?? "" }));
  for (period = 0; period < scenario.periods; period += 1) {
    const toDate = addGameDays(fromDate, PERIOD_DAYS);
    const result = runFronts({
      battlefields: saved,
      fromDate,
      toDate,
      days: PERIOD_DAYS,
      moments: [],
      wars: [{ id: "war-1", title: "the war", status: "active", sideA: scenario.teams[0].map((index) => names[index]), sideB: scenario.teams[1].map((index) => names[index]), startedDate: opened }],
      controllerOf: world.controllerOf,
      sovereignOf: world.sovereignOf,
      groupAreas: {},
      isGroup: () => false,
      units: wings,
      map: { ...world.map, ...((scenario.terrain ?? []).length > 0 ? { terrain: { key: `terrain-${scenario.seed}`, areas: scenario.terrain } } : {}) },
      // Every newer mechanic of the engine's (Wars and Fronts Pt.2).
      mechanics: { fatigue: true, weather: true, terrain: true, walls: true, muster: true, military: true, air: true, supply: true, attrition: true },
      militaryOf: (name) => militaryOf.get(fold(name)) ?? null,
      musterOf: (name) => musterOf.get(fold(name)) ?? null,
      gameBegan: `${String(scenario.year - 1).padStart(4, "0")}-01-01`,
      climateSeed: `arena-${scenario.seed}`,
      fortifications: walls,
      regionTypes: [],
      strengthOf: (name) => weights.get(fold(name)) ?? 1,
      peopleOf: (name) => people.get(fold(name)) ?? 0,
      players: [],
      pace: 1,
      flipAllowance: null,
      seed: `arena|${scenario.seed}`,
      arenas,
      staffPolicy,
      watch,
    });
    for (const flip of result.flips ?? []) if (flip.kind === "control") world.controller.set(flip.regionId, flip.to);
    for (const entry of result.news ?? []) {
      const field = fields.get(entry.battlefield);
      if (!field || (entry.s !== 0 && entry.s !== 1)) continue;
      // Troops cut off that gave up are the other side's doing.
      if (entry.k === "pocket") {
        const team = field.teams[1 - entry.s];
        if (team >= 0) gaveUp[team] += 1;
      }
    }
    saved = result.battlefields ?? [];
    // What the fighting did to the wall: its breaches and wear, for the next month.
    for (const change of result.fortifications ?? []) walls = walls.map((line) => (line.id === change.id ? { ...line, breaches: change.breaches, wear: change.wear } : line));
    fromDate = toDate;
  }

  // The tallies, team by team.
  const began = [0, 0];
  const lost = [0, 0];
  const cut = [0, 0];
  // Square kilometres of each team's home ground the other holds at the end, cell by cell.
  const landLostKm2 = [0, 0];
  // The teams that hold each city at the end: a city may stand on more than one battlefield's ground.
  const cityHolders = new Map();
  for (const field of fields.values()) {
    for (const side of [0, 1]) {
      const team = field.teams[side];
      if (team < 0) continue;
      began[team] += field.began[side];
      lost[team] += field.lost[side];
      // (The largest share of a team's troops cut off at once, on any of its battlefields.)
      if (field.cut[side] > cut[team]) cut[team] = field.cut[side];
    }
    const battle = field.live;
    const holders = battle?.field?.holders;
    const homes = battle ? homeTableOf(battle, field.liveRun) : null;
    if (!holders || !homes || homes.length !== holders.length) continue;
    const { cols } = battle.field;
    const { kmAt } = battle.place;
    for (let cell = 0; cell < holders.length; cell += 1) {
      const home = homes[cell];
      if ((home !== 0 && home !== 1) || holders[cell] !== 1 - home) continue;
      const team = field.teams[home];
      if (team < 0) continue;
      const km = kmAt(Math.floor(cell / cols) + 0.5);
      landLostKm2[team] += km * km;
    }
    for (const city of battle.arena?.cities ?? []) {
      const holder = city.cell >= 0 && city.cell < holders.length ? holders[city.cell] : -1;
      const team = holder === 0 || holder === 1 ? field.teams[holder] : -1;
      if (team < 0) continue;
      if (!cityHolders.has(city.name)) cityHolders.set(city.name, new Set());
      cityHolders.get(city.name).add(team);
    }
  }
  const towns = [[0, 0], [0, 0]];
  const capitals = [[0, 0], [0, 0]];
  for (const city of scenario.cities) {
    const owner = teamOf(names[city.country]);
    // (Taken on any battlefield it stands on is taken.)
    const holder = owner < 0 ? undefined : [...(cityHolders.get(city.name) ?? [])].find((team) => team !== owner);
    if (holder === undefined) continue;
    // [what the holder took, what the owner lost]
    if (city.capital) capitals[holder][0] += 1;
    else towns[holder][0] += townCounts(city);
    if (city.capital) capitals[owner][1] += 1;
    else towns[owner][1] += townCounts(city);
  }
  const parts = [0, 1].map((team) => {
    const other = 1 - team;
    return {
      landTaken: landLostKm2[other] / LAND_UNIT_KM2,
      landLost: landLostKm2[team] / LAND_UNIT_KM2,
      townTaken: towns[team][0],
      townLost: towns[team][1],
      capitalTaken: capitals[team][0],
      capitalLost: capitals[team][1],
      troopsTaken: capped(began[other] > 0 ? lost[other] / began[other] : 0),
      troopsLost: capped(began[team] > 0 ? lost[team] / began[team] : 0),
      encompassed: capped(cut[other] + POCKET_GAVE_UP * gaveUp[team]),
    };
  });
  const rewards = parts.map(rewardOf);
  return { rewards, parts, looks, said, land: [landLostKm2[1], landLostKm2[0]] };
};

// Two staffs against each other in one scenario, each leading each team once:
// how much better the first did than the second, over the two wars.
//   Returns { margin, first: [reward as the team that began, reward as the other], second: [...], parts, said }
//   parts and said are the first staff's, summed over its two wars.
export const match = (scenario, first, second) => {
  const opening = fight(scenario, [first, second]);
  const reply = fight(scenario, [second, first]);
  const mine = [opening.rewards[0], reply.rewards[1]];
  const theirs = [reply.rewards[0], opening.rewards[1]];
  const parts = Object.fromEntries(REWARD_PARTS.map((key) => [key, opening.parts[0][key] + reply.parts[1][key]]));
  const said = opening.said[0].map((count, at) => count + reply.said[1][at]);
  return { margin: mine[0] + mine[1] - theirs[0] - theirs[1], first: mine, second: theirs, parts, said };
};
