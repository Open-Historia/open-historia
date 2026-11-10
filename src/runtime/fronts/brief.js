/*! Open Historia — battlefields and fronts: what the prompt and the card read © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The model that commands a war never sees the field, a cell or a coordinate.
// It reads a BRIEF: how long the line is and which way it runs, where each
// sector of it lies in named places, the regions it runs through and what each
// side holds of the other's land, how strong each side is, what moved since
// the last turn, what is cut off, what each side has been told to do, and the
// sector words it may use. The card a player opens reads the same.
//
// The brief is made when a run ends and saved on the record as plain data;
// describeBattlefield words it for a prompt, a few lines to a battlefield.
// Every name carries its kind ("city: Kyiv", "region: Donbas") and nothing in
// it is an id: a model writes back the names it was shown.

import { battleAttrition } from "./attrition.js";
import { BRIEF_TEXT_MAX, FATIGUE_EXHAUSTED, HOLDER_SIDE_A, HOLDER_SIDE_B, RESERVES_AMPLE_PER_TROOP, SCENARIO_MARK } from "./constants.js";
import { traceContour } from "./field.js";
import { measure } from "./ground.js";
import { measureLine } from "./line.js";
import { describePoint, inSector, readSectors } from "./sectors.js";
import { skyHeld } from "./air.js";
import { levyPending } from "./muster.js";

// How near another country's land a country's forces at home count as standing on its borders (home.js).
const HOME_NEAR_KM = 60;
import { isLive } from "./troops.js";

const unique = (names) => [...new Set(names)];

// What a troop is at, in a word a reader of the brief can be shown or told.
const doingOf = (troop) => {
  const order = troop.order && !troop.order.done ? troop.order : null;
  if (troop.pocket) return "cut-off";
  if (troop.dug) return "dug-in";
  if (!order) return "holding";
  if (order.kind === "way") return order.word === "path" ? "on-route" : order.own ? "advancing" : order.word;
  if (order.kind === "reduce") return "closing";
  if (order.kind === "assault") return "assaulting";
  if (order.kind === "fallback") return "falling-back";
  if (order.kind === "withdraw") return "withdrawing";
  if (order.kind === "breakout") return "breaking-out";
  if (order.kind === "pursue") return "pursuing";
  return "holding";
};

// The brief of a battle as it stands.
// The names of the frozen water on a battlefield's ground (climate.js).
const frozenNames = (battle) => {
  const { arena } = battle;
  if (!arena?.iced) return [];
  const names = new Set();
  for (let cell = 0; cell < arena.size && names.size < 4; cell += 1) if (arena.iced[cell] === 1) names.add(arena.names[arena.region[cell]]);
  return [...names].filter(Boolean);
};

// The most regions named along the line, and of the other's land a side holds.
export const ALONG_MOST = 10;
export const HELD_REGIONS_MOST = 12;
export const HELD_CITIES_MOST = 8;
const named = (arena, region) => region > 0 && arena.names[region] && arena.names[region] !== arena.ids[region];

// WHERE THE WAR IS, in names: the regions the line runs through, on either side
// of it, in the order a reader walks it (from the end of the way it mostly runs
// that its sector words name first), and what each side holds of the land that
// is lawfully the other's, its towns the larger first. The sectors' "from Kaunas
// to Danzig" said only which large town was nearest each end, and a story told
// with nothing else put a war fought deep in one country's land on the other's
// ("the game is still talking about things that happened historically", a
// player crushing Germany from Berlin, 2026-11-10).
//   { along: [names], holds: [{ cities: [{ name, capital? }], regions: [names], more }, ...] }
// A side is the field's (HOLDER_SIDE_A, HOLDER_SIDE_B); whose land a region is,
// is the side of its lawful sovereign (battle.homeSide, battle.js readRegions).
export const lineGeography = (battle, sectors) => {
  const { field, arena } = battle;
  const home = battle.homeSide;
  const { cols, size } = field;
  const high = sectors?.names?.[1];
  const axis = high ? sectors.cuts.get(high) : null;
  const count = arena.names.length;
  const lineCells = new Float64Array(count);
  const lineAlong = new Float64Array(count);
  const mark = (cell) => {
    const region = arena.region[cell];
    if (!named(arena, region)) return;
    const col = cell % cols;
    lineCells[region] += 1;
    lineAlong[region] += axis ? (col + 0.5) * axis.x + ((cell - col) / cols + 0.5) * axis.y : 0;
  };
  // A cell is on the line where a cell beside it in play is the other side's.
  for (let cell = 0; cell < size; cell += 1) {
    const side = field.holders[cell];
    if (side > HOLDER_SIDE_B || !field.play[cell]) continue;
    const col = cell % cols;
    for (const next of [col + 1 < cols ? cell + 1 : -1, cell + cols < size ? cell + cols : -1]) {
      if (next < 0 || !field.play[next]) continue;
      const other = field.holders[next];
      if (other > HOLDER_SIDE_B || other === side) continue;
      mark(cell);
      mark(next);
    }
  }
  // The regions with most of the line, in the order a reader walks it.
  const touched = [];
  for (let region = 1; region < count; region += 1) if (lineCells[region] > 0) touched.push(region);
  const along = touched
    .sort((a, b) => lineCells[b] - lineCells[a] || a - b)
    .slice(0, ALONG_MOST)
    .sort((a, b) => lineAlong[b] / lineCells[b] - lineAlong[a] / lineCells[a] || a - b)
    .map((region) => arena.names[region]);
  // What each side holds of the other's land: a region whose cells in play are
  // mostly the other side's, and every town on ground the other side holds.
  const holds = [HOLDER_SIDE_A, HOLDER_SIDE_B].map(() => ({ cities: [], regions: [], more: 0 }));
  if (home) {
    const inPlay = new Float64Array(count);
    const byOther = new Float64Array(count);
    for (let cell = 0; cell < size; cell += 1) {
      if (!field.play[cell]) continue;
      const region = arena.region[cell];
      const owner = home[region];
      if (owner !== HOLDER_SIDE_A && owner !== HOLDER_SIDE_B) continue;
      inPlay[region] += 1;
      if (field.holders[cell] === 1 - owner) byOther[region] += 1;
    }
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const taken = [];
      for (let region = 1; region < count; region += 1) {
        if (home[region] === 1 - side && inPlay[region] > 0 && byOther[region] * 2 >= inPlay[region] && named(arena, region)) taken.push(region);
      }
      taken.sort((a, b) => byOther[b] - byOther[a] || a - b);
      holds[side].regions = taken.slice(0, HELD_REGIONS_MOST).map((region) => arena.names[region]);
      holds[side].more = Math.max(0, taken.length - HELD_REGIONS_MOST);
      holds[side].cities = arena.cities
        .filter((city) => city.cell >= 0 && city.cell < size && field.holders[city.cell] === side && home[arena.region[city.cell]] === 1 - side)
        .sort((a, b) => (b.capital ? 1 : 0) - (a.capital ? 1 : 0) || b.population - a.population || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, HELD_CITIES_MOST)
        .map((city) => ({ name: city.name, ...(city.capital ? { capital: true } : {}) }));
    }
  }
  return { along, holds };
};

export const buildBrief = (battle, since) => {
  const { field, arena, place } = battle;
  const { kmAt, rowKm } = place;
  const contour = traceContour(field);
  const line = measureLine(field, contour);
  const sectors = readSectors(line);
  const geography = lineGeography(battle, sectors);

  const rows = [];
  for (const name of sectors.names) {
    if (name === "all") continue;
    const sector = { kind: "cut", word: name, ...sectors.cuts.get(name) };
    let first = -1;
    let last = -1;
    let lengthKm = 0;
    for (const strand of contour.strands) {
      for (let step = 0; step < strand.count; step += 1) {
        const vertex = strand.first + step;
        if (!inSector(sector, contour.x[vertex], contour.y[vertex], kmAt)) continue;
        if (first < 0) first = vertex;
        if (last >= 0 && line.strand[last] === line.strand[vertex] && vertex === last + 1) lengthKm += line.km[vertex] - line.km[last];
        last = vertex;
      }
    }
    if (first < 0) continue;
    const counts = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => battle.troops[side].reduce((count, troop) => count + (isLive(troop) && inSector(sector, troop.x, troop.y, kmAt) ? 1 : 0), 0));
    // The ground side A gained there since the run began, less what it lost,
    // as a depth along that stretch of line.
    let gained = 0;
    for (let index = 0; index < field.size; index += 1) {
      const now = field.holders[index];
      const then = battle.startHolders[index];
      if (now === then || now > HOLDER_SIDE_B || then > HOLDER_SIDE_B) continue;
      const col = index % field.cols;
      const row = (index - col) / field.cols;
      if (inSector(sector, col + 0.5, row + 0.5, kmAt)) gained += (now === HOLDER_SIDE_A ? 1 : -1) * rowKm[row] * rowKm[row];
    }
    rows.push({
      name,
      from: describePoint(arena, contour.x[first], contour.y[first]),
      to: describePoint(arena, contour.x[last], contour.y[last]),
      n: counts,
      moved: lengthKm > 0 ? Math.round(gained / lengthKm) : 0,
    });
  }

  const strength = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
    const live = battle.troops[side].filter(isLive);
    const pool = battle.pool[side];
    // On a side of several countries, how many each has there: each commands its own.
    const members = battle.sides[side].map((name, owner) => ({ name, n: live.reduce((count, troop) => count + (troop.owner === owner ? 1 : 0), 0) })).filter((entry) => entry.n > 0);
    // How many are worn out (fatigue.js).
    const tired = live.reduce((count, troop) => count + (troop.fatigue >= FATIGUE_EXHAUSTED ? 1 : 0), 0);
    // How many more are still to muster (muster.js).
    const mustering = levyPending(battle.levy, side);
    return {
      n: live.length,
      ...(mustering > 0 ? { mustering } : {}),
      pct: live.length > 0 ? Math.round(live.reduce((sum, troop) => sum + troop.strength, 0) / live.length) : 0,
      ...(tired > 0 ? { tired } : {}),
      reserves: pool >= RESERVES_AMPLE_PER_TROOP * Math.max(1, live.length) ? "ample" : pool >= 1 ? "thin" : "none",
      ...(members.length > 1 ? { members } : {}),
    };
  });

  // A country's forces at home (home.js): how many of them stand within HOME_NEAR_KM of another country's land.
  const homeNear = battle.home ? (() => {
    const toOther = measure(battle)[HOLDER_SIDE_B];
    return battle.troops[HOLDER_SIDE_A].reduce((count, troop) => {
      if (!isLive(troop)) return count;
      const cell = Math.floor(troop.y) * field.cols + Math.floor(troop.x);
      return count + (cell >= 0 && cell < field.size && (toOther[cell] / 3) * battle.frame.km <= HOME_NEAR_KM ? 1 : 0);
    }, 0);
  })() : 0;

  const manned = new Set();
  if (battle.pocketOf) {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      for (const troop of battle.troops[side]) {
        const inside = troop.x >= 0 && troop.y >= 0 && troop.x < field.cols && troop.y < field.rows;
        const pocket = isLive(troop) && inside ? battle.pocketOf[side][Math.floor(troop.y) * field.cols + Math.floor(troop.x)] : -1;
        if (pocket >= 0) manned.add(pocket);
      }
    }
  }
  // What is cut off with troops in it: a pocket by where it lies, a besieged
  // place by its own name.
  const pockets = [];
  battle.pockets.forEach((pocket, index) => {
    if (!manned.has(index)) return;
    const at = pocket.siege || describePoint(arena, (pocket.cell % field.cols) + 0.5, Math.floor(pocket.cell / field.cols) + 0.5);
    if (at) pockets.push({ s: pocket.s, at, days: pocket.days, ...(pocket.siege ? { siege: true } : {}) });
  });

  // What each general's body of troops amounts to, a list a side in the order
  // of their commands: how many, how strong, about where they stand, what
  // most of them are at, how many are cut off and how many dug in.
  const commands = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
    const bodies = [];
    for (const troop of battle.troops[side]) {
      if (!isLive(troop) || !(troop.command >= 0)) continue;
      const body = bodies[troop.command] ?? (bodies[troop.command] = { n: 0, strength: 0, x: 0, y: 0, cut: 0, dug: 0, at: new Map() });
      body.n += 1;
      body.strength += troop.strength;
      body.x += troop.x;
      body.y += troop.y;
      if (troop.pocket) body.cut += 1;
      if (troop.dug) body.dug += 1;
      const doing = doingOf(troop);
      body.at.set(doing, (body.at.get(doing) ?? 0) + 1);
    }
    return Array.from(bodies, (body) => {
      if (!body) return { n: 0 };
      let doing = "holding";
      let most = 0;
      for (const [what, count] of body.at) {
        if (count > most) {
          most = count;
          doing = what;
        }
      }
      return { n: body.n, pct: Math.round(body.strength / body.n), at: describePoint(arena, body.x / body.n, body.y / body.n), doing, cut: body.cut, dug: body.dug };
    });
  });

  return {
    km: Math.round(line.total),
    axis: sectors.axis,
    sectors: rows,
    // The regions the line runs through, and what each side holds of the other's land (lineGeography).
    along: geography.along,
    holds: geography.holds,
    commands,
    strength,
    ...(battle.home && homeNear > 0 ? { near: homeNear } : {}),
    taken: [unique(battle.taken[0]), unique(battle.taken[1])],
    cities: [unique(battle.citiesTaken[0]), unique(battle.citiesTaken[1])],
    pockets,
    since,
    // Who held the sky over it today, with how many wings a side (air.js).
    ...(skyHeld(battle) ? { air: skyHeld(battle) } : {}),
    // The water frozen hard enough to cross there this turn (climate.js), by name.
    ...(frozenNames(battle).length > 0 ? { frozen: frozenNames(battle) } : {}),
    // What the weather and being cut off took from each side this run, in formations' worth (attrition.js).
    ...(battleAttrition(battle) ? { attrition: battleAttrition(battle) } : {}),
    // The season, today's weather and the days of each this run (weather.js): for the story.
    ...(battle.sky && battle.skies ? { weather: { season: battle.sky.season, now: battle.sky.state, days: { ...battle.skies } } } : {}),
  };
};

// ---- the words -----------------------------------------------------------------

const list = (names, kind, most = 4) => {
  const shown = names.slice(0, most).map((name) => `${kind}: ${name}`);
  if (names.length > most) shown.push(`${names.length - most} more`);
  return shown.join(", ");
};

const ordersOf = (record, side) => {
  const mine = record.orders.map((order, index) => ({ order, index })).filter(({ order }) => order.s === side);
  if (mine.length === 0) return "all hold";
  // An order for a stretch of line is told by its sector; one for a body of
  // troops picked out, by how many they are.
  const under = record.brief?.carry?.under?.[side];
  const serving = (index) => (Array.isArray(under) ? under.reduce((count, serves) => count + (serves === index ? 1 : 0), 0) : 0);
  const line = mine.filter(({ order }) => !order.chosen);
  // (On a side of several countries an order is its giver's troops' alone: it says whose, where it is not the first country's.)
  const lead = String(record.sides?.[side]?.[0] ?? "").toLowerCase();
  const whose = (order) => (record.sides?.[side]?.length > 1 && order.by && String(order.by).toLowerCase() !== lead ? ` (${order.by}'s troops)` : "");
  // (What its scenario's author made the front is said to be that: it stands until an event changes it.)
  const parts = line.map(({ order }) => `${order.sector} ${order.order}${order.objective ? ` toward ${order.objective}` : ""}${whose(order)}${order.mark === SCENARIO_MARK ? " (the scenario's)" : ""}`);
  for (const { order, index } of mine) {
    if (!order.chosen) continue;
    const into = Array.isArray(order.attacks) && order.attacks.length > 0 ? `, into ${order.attacks.join(" and ")}, which is not in the war` : "";
    parts.push(`${serving(index)} formations ${order.way ? `sent along a route drawn for them${into}` : `${order.order}${order.objective ? ` toward ${order.objective}` : ""}`}`);
  }
  parts[0] += ` (${record.effort[side]})`;
  if (!line.some(({ order }) => order.sector === "all")) parts.push("elsewhere hold");
  return parts.join("; ");
};

// What a battlefield's last run did to it, in a sentence: how far each side
// went in each of the three sectors the line is told by, what each took and
// lost (a town or a region by its name with its kind, `most` of each and the
// rest counted), and what is cut off. `moved` says whether any of it happened.
//   { since, text, moved }
export const describeSince = (record, { most = 4 } = {}) => {
  const brief = record?.brief ?? {};
  const lead = [record?.sides?.[0]?.[0] ?? "", record?.sides?.[1]?.[0] ?? ""];
  const sectors = Array.isArray(brief.sectors) ? brief.sectors : [];
  // What moved is told by the same three sectors as the line is, a side at a
  // time: "Aland advanced 65 km in the north, 22 km in the centre".
  const moves = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
    const gained = sectors.slice(0, 3).filter((sector) => Math.abs(sector.moved) >= 1 && (sector.moved > 0) === (side === HOLDER_SIDE_A));
    return gained.length > 0 ? `${lead[side]} advanced ${gained.map((sector) => `${Math.abs(sector.moved)} km in the ${sector.name}`).join(", ")}` : "";
  }).filter(Boolean);
  const taken = Array.isArray(brief.taken) ? brief.taken : [[], []];
  const cities = Array.isArray(brief.cities) ? brief.cities : [[], []];
  const gains = (side) => [list(cities[side] ?? [], "city", most), list(taken[side] ?? [], "region", most)].filter(Boolean).join(", ");
  const parts = [moves.length > 0 ? moves.join("; ") : "the line did not move"];
  const took = gains(0);
  const lost = gains(1);
  if (took || lost) parts.push(`${lead[0]} took ${took || "none"}`, `lost ${lost || "none"}`);
  const pockets = (Array.isArray(brief.pockets) ? brief.pockets : []).slice(0, 2)
    // (Who is shut in, and by whom: "Pocket: Mongolia at X" was read as Mongolia's doing.)
    .map((pocket) => `${pocket.siege ? "Besieged" : "Surrounded"}: troops of ${lead[pocket.s]} are ${pocket.siege ? "shut in" : "cut off"} by ${lead[1 - pocket.s]} at ${pocket.at}, ${pocket.days} days.`);
  return {
    since: String(brief.since ?? ""),
    text: `${parts.join("; ")}.${pockets.length > 0 ? ` ${pockets.join(" ")}` : ""}`,
    moved: moves.length > 0 || Boolean(took || lost),
  };
};

// The text of one battlefield for a prompt, at most `max` characters
// (BRIEF_TEXT_MAX for a time skip's, which tells many; the advisor reads its
// own country's at more: Game/AI/advisorWars.js).
// With `viewer` a country or a group fighting there, the other side's standing
// orders are left out: what a government has told its own side is its own.
export const describeBattlefield = (record, { viewer = "", max = BRIEF_TEXT_MAX } = {}) => {
  if (!record || !Array.isArray(record.sides)) return "";
  const brief = record.brief ?? {};
  // A country's forces at home (home.js): how many, how many still mustering, how many near its borders.
  if (record.home === true) {
    const own = Array.isArray(brief.strength) ? brief.strength[0] ?? {} : {};
    const country = record.sides[0][0] ?? "";
    const parts = [`${own.n ?? 0} formations round its cities`];
    if (own.mustering > 0) parts.push(`${own.mustering} more still mustering`);
    if (brief.near > 0) parts.push(`${brief.near} of them within ${HOME_NEAR_KM} km of its borders`);
    return `- ${record.name}: ${country}'s forces at home, built up in peace: ${parts.join(", ")}. No war is fought here; its orders are given as home: ${country}.`.slice(0, max);
  }
  const lead = [record.sides[0][0] ?? "", record.sides[1][0] ?? ""];
  const wanted = String(viewer ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const viewing = wanted ? record.sides.findIndex((members) => members.some((member) => member.toLowerCase() === wanted)) : -1;
  const status = record.status === "frozen" ? ", frozen by a ceasefire" : record.status === "closed" ? ", closed" : record.status === "standing" ? ", forces built up in peace: no war is fought here" : "";
  const head = `- ${record.name}: ${record.sides[0].join(", ")} against ${record.sides[1].join(", ")}, open since ${record.openedDate}${status}, line ${brief.km ?? 0} km`;

  const strength = Array.isArray(brief.strength) && brief.strength.length === 2
    ? `  Strength: ${brief.strength.map((side, index) => `${lead[index]} ${side.n} formations (${side.pct}%)${side.tired > 0 ? `, ${side.tired} of them exhausted` : ""}${side.mustering > 0 ? `, ${side.mustering} more still mustering` : ""}${Array.isArray(side.members) && side.members.length > 1 ? ` (${side.members.map((member) => `${member.name} ${member.n}`).join(", ")})` : ""}, reserves ${side.reserves}`).join("; ")}`
    : "";
  // The season and the weather it was fought in (weather.js): "autumn; mud on 6 of 10 days, rain on 3".
  const weather = brief.weather && typeof brief.weather === "object" && brief.weather.days
    ? (() => {
      const days = Object.entries(brief.weather.days).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      const total = days.reduce((sum, [, count]) => sum + count, 0);
      const spells = days.slice(0, 3).map(([state, count], at) => `${state} on ${count}${at === 0 ? ` of ${total} days` : ""}`).join(", ");
      return `  Weather: ${brief.weather.season ? `${brief.weather.season}; ` : ""}${spells}${brief.weather.now ? `; ${brief.weather.now} now` : ""}`;
    })()
    : "";
  // What the weather and being cut off took, besides the fighting (attrition.js): "Attrition: Aland lost 3.2 formations' worth, Borea 0.4".
  const attrition = Array.isArray(brief.attrition) && brief.attrition.some((lost) => lost > 0)
    ? `  Attrition: ${[HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => `${lead[side]} lost ${brief.attrition[side] ?? 0} formations' worth`).join(", ")} to the weather and to being cut off this period`
    : "";
  // Who holds the sky (air.js): "Air: Aland holds the sky (6 wings against 2)".
  const air = brief.air && (brief.air.holds === 0 || brief.air.holds === 1) && Array.isArray(brief.air.wings)
    ? `  Air: ${lead[brief.air.holds]} holds the sky (${brief.air.wings[brief.air.holds]} wings against ${brief.air.wings[1 - brief.air.holds]})`
    : "";
  // Water frozen hard enough to cross (climate.js).
  const ice = Array.isArray(brief.frozen) && brief.frozen.length > 0 ? `  Ice: ${brief.frozen.join(", ")} ${brief.frozen.length === 1 ? "is" : "are"} frozen hard enough for troops to cross` : "";
  // A side that has withdrawn its troops from here (engine.js withdrawWhoLeft).
  const gone = [HOLDER_SIDE_A, HOLDER_SIDE_B].filter((side) => brief.carry?.away?.[side] === true)
    .map((side) => `  ${lead[side]} has withdrawn its troops from here: the ground it holds is unguarded until it orders them back.`).join("\n");
  const sectors = Array.isArray(brief.sectors) ? brief.sectors : [];
  const where = sectors.filter((sector) => sector.from && sector.to);
  // (No sector at all is no line of it: "Line: " with nothing after it told a skip nothing of where the war was.)
  const lineText = (most) => (where.length > 0 && most > 0 ? `  Line: ${where.slice(0, most).map((sector) => `${sector.name}: ${sector.from === sector.to ? sector.from : `${sector.from} to ${sector.to}`}`).join("; ")}` : "");
  // The regions it runs through, from the end its first sector word names (lineGeography).
  const whose = (side) => (record.sides[side].length > 1 ? `${lead[side]}'s side` : lead[side]);
  const along = Array.isArray(brief.along) ? brief.along.filter((name) => typeof name === "string" && name) : [];
  const ends = String(brief.axis ?? "").split("-");
  const runs = where.length > 0 && ends.length === 2 ? ` ${where[0].name === ends[0] ? `${ends[0]} to ${ends[1]}` : `${ends[1]} to ${ends[0]}`}` : "";
  const alongText = (most) => (along.length > 0 && most > 0 ? `  The line runs${runs} through ${list(along, "region", most)}` : "");
  // What each side holds of the other's land, capitals and the larger towns first.
  const holds = Array.isArray(brief.holds) ? brief.holds : null;
  const heldText = (most) => {
    if (!holds || most <= 0) return "";
    const parts = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
      const held = holds[side] ?? {};
      const cities = (Array.isArray(held.cities) ? held.cities : []).slice(0, most)
        .map((city) => `city: ${city.name}${city.capital ? " (a capital)" : ""}`);
      const regions = Array.isArray(held.regions) ? held.regions : [];
      const more = regions.length - Math.min(regions.length, most) + (Number(held.more) || 0);
      const shown = [...cities, ...regions.slice(0, most).map((name) => `region: ${name}`)];
      if (shown.length === 0) return "";
      return `${whose(side)} holds ${shown.join(", ")}${more > 0 ? ` and ${more} more regions` : ""} of ${whose(1 - side)}'s land`;
    }).filter(Boolean);
    return `  Occupied: ${parts.length > 0 ? `${parts.join("; ")}.` : "neither side holds any of the other's land."}`;
  };

  const sinceText = (most) => `  Since ${brief.since ?? ""}: ${describeSince(record, { most }).text}`;

  const standing = [HOLDER_SIDE_A, HOLDER_SIDE_B]
    .filter((side) => viewing < 0 || side === viewing)
    .map((side) => `${lead[side]}: ${ordersOf(record, side)}.`);
  const orders = `  Standing orders: ${standing.join(" ")}`;
  const words = sectors.map((sector) => sector.name);
  // (Every word fitting is said in fewer: the room is the line's.)
  const every = ["north", "south", "east", "west", "northeast", "southwest", "southeast", "northwest", "centre"].every((word) => words.includes(word));
  const valid = `  Sectors: ${every ? "centre and all eight points of the compass, or a place on the line." : words.length > 0 ? `${words.join(", ")}, or a place on the line.` : "all, or a place on the line."}`;

  // The line is told by the three sectors of the way it mostly runs: the other
  // words are only other cuts of the same line. Too long: fewer names are
  // listed, then the weather, what it wore away and the sky go, then fewer
  // sectors. Where the line runs and who holds whose land go last of all: a
  // story told without them was told where real history had the war.
  //   [sectors, names in what moved, regions along the line, of what is held, with the weather and the rest]
  let text = "";
  for (const [mostSectors, mostNames, mostAlong, mostHeld, extras] of [
    [3, 4, 8, 6, true], [3, 2, 5, 4, true], [3, 1, 3, 2, true], [2, 1, 2, 2, true], [1, 1, 2, 1, true],
    [3, 2, 5, 4, false], [3, 1, 3, 3, false], [3, 1, 2, 2, false], [2, 1, 2, 2, false], [1, 1, 2, 1, false], [0, 1, 1, 1, false],
  ]) {
    const more = extras ? [weather, attrition, ice, air] : [];
    text = [head, strength, ...more, gone, lineText(mostSectors), alongText(mostAlong), heldText(mostHeld), sinceText(mostNames), orders, valid].filter(Boolean).join("\n");
    if (text.length <= max) return text;
  }
  return text.slice(0, max - 1).trimEnd() + "…";
};
