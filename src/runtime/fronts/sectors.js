/*! Open Historia — battlefields and fronts: sectors and places © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An order is given for a stretch of the line in words: "the northern troops
// advance", "spearhead toward Kyiv". This turns the words into ground.
//
// A SECTOR is a third of the line along a compass axis. Which words fit depends
// on how the line runs: one running north to south has a north, a centre and a
// south, and no west; a diagonal one can be cut either way; a ring round a
// pocket has every one of them. A word that does not fit is read as the whole
// line and the caller is told, so the model learns which words it can use.
//
// A PLACE is a city inside the frame or a region with ground in it, found by
// its exact name in any case, with "city:" or "region:" in front if the writer
// said which. A place can stand for a sector: the line within sixty kilometres
// of the point nearest it. Names are never folded onto one another.
//
// Compass work is dot products with fixed vectors: no step of a day needs an angle.

import { PLACE_SECTOR_KM, SECTOR_AXIS_SHARE } from "./constants.js";
import { projectorOf } from "./frame.js";

const DIAGONAL = 0.7071067811865476;
// The four axes a line can be cut along, each with the word for either end.
const AXES = Object.freeze([
  { x: 0, y: 1, high: "north", low: "south", name: "north-south", diagonal: false },
  { x: 1, y: 0, high: "east", low: "west", name: "east-west", diagonal: false },
  { x: DIAGONAL, y: DIAGONAL, high: "northeast", low: "southwest", name: "northeast-southwest", diagonal: true },
  { x: DIAGONAL, y: -DIAGONAL, high: "southeast", low: "northwest", name: "northwest-southeast", diagonal: true },
]);
export const COMPASS_WORDS = Object.freeze(["north", "south", "east", "west", "northeast", "southwest", "southeast", "northwest"]);

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// How a line can be cut:
//   { axis, names, cuts }
//   axis    the way it mostly runs, in words ("north-south")
//   names   the sector words that fit it, "all" and "centre" among them
//   cuts    word -> { x, y, from, to }: the ground whose place along (x, y)
//           lies between `from` and `to`. An end sector has no outer limit, so
//           ground beyond the end of the line still belongs to it.
export const readSectors = (line) => {
  const { contour, count } = line;
  const spans = AXES.map((axis) => {
    let low = Infinity;
    let high = -Infinity;
    for (let vertex = 0; vertex < count; vertex += 1) {
      const along = contour.x[vertex] * axis.x + contour.y[vertex] * axis.y;
      if (along < low) low = along;
      if (along > high) high = along;
    }
    return count > 0 ? { low, high, extent: high - low } : { low: 0, high: 0, extent: 0 };
  });
  let widest = 0;
  for (let index = 1; index < AXES.length; index += 1) if (spans[index].extent > spans[widest].extent) widest = index;
  const least = spans[widest].extent * SECTOR_AXIS_SHARE;
  const fits = spans.map((span) => span.extent > 0 && span.extent >= least);
  // The way it mostly runs. A line is said to run on a diagonal only when it
  // has no real extent across that diagonal: a ring, or a line that wanders,
  // is as wide on one diagonal as on the other, and is named by the compass.
  const longest = AXES[widest].diagonal && fits[widest === 2 ? 3 : 2] ? (spans[1].extent > spans[0].extent ? 1 : 0) : widest;
  // A diagonal word needs the line to have real extent both ways: on a line
  // running due north its "northeast" would only be another word for its north.
  const both = fits[0] && fits[1];
  // The way the line mostly runs is named first, end, centre, end: that is the
  // order a reader walks it in.
  const names = ["all"];
  const cuts = new Map();
  const order = [longest, ...AXES.map((axis, index) => index).filter((index) => index !== longest)];
  for (const index of order) {
    if (!fits[index] || (AXES[index].diagonal && !both)) continue;
    const axis = AXES[index];
    const { low, extent } = spans[index];
    cuts.set(axis.high, { x: axis.x, y: axis.y, from: low + (extent * 2) / 3, to: Infinity });
    cuts.set(axis.low, { x: axis.x, y: axis.y, from: -Infinity, to: low + extent / 3 });
    if (index !== longest) {
      names.push(axis.high, axis.low);
      continue;
    }
    names.push(axis.high, "centre", axis.low);
    cuts.set("centre", { x: axis.x, y: axis.y, from: low + extent / 3, to: low + (extent * 2) / 3 });
  }
  return { axis: spans[longest].extent > 0 ? AXES[longest].name : "", names, cuts };
};

// ---- places --------------------------------------------------------------------

// "city: Kyiv" -> { kind: "city", name: "kyiv" }; no kind in front leaves it open.
const parsePlace = (value) => {
  const text = fold(value);
  const match = /^(city|region)\s*:\s*(.*)$/.exec(text);
  return match ? { kind: match[1], name: match[2].trim() } : { kind: "", name: text };
};

// A place of this battlefield by its exact name, or null. A name that is both
// a city and a region is the city unless the writer said "region:".
//   { kind: "city" | "region", name, x, y, cell?, region? }
export const findPlace = (arena, value) => {
  const { kind, name } = parsePlace(value);
  if (!name) return null;
  if (kind !== "region") {
    const city = arena.cities.find((entry) => fold(entry.name) === name);
    if (city) return { kind: "city", name: city.name, x: city.x, y: city.y, cell: city.cell };
  }
  if (kind !== "city") {
    for (let index = 1; index < arena.names.length; index += 1) {
      if (fold(arena.names[index]) === name) return { kind: "region", name: arena.names[index], x: arena.centreX[index], y: arena.centreY[index], region: index };
    }
  }
  return null;
};

export const placeText = (place) => `${place.kind}: ${place.name}`;

// The words for where a point is: its nearest city, or failing any city the
// region it lies in. Names with their kind, never an id.
export const describePoint = (arena, x, y) => {
  const { kmAt } = projectorOf(arena.frame);
  let best = null;
  let bestKm = Infinity;
  for (const city of arena.cities) {
    const dx = city.x - x;
    const dy = city.y - y;
    const km = Math.sqrt(dx * dx + dy * dy) * kmAt((city.y + y) / 2);
    if (km < bestKm) {
      bestKm = km;
      best = city;
    }
  }
  if (best) return `city: ${best.name}`;
  if (x >= 0 && y >= 0 && x < arena.cols && y < arena.rows) {
    const region = arena.region[Math.floor(y) * arena.cols + Math.floor(x)];
    // A region with no name of its own is known only by its id, which is never shown.
    if (region > 0 && arena.names[region] !== arena.ids[region]) return `region: ${arena.names[region]}`;
  }
  return "";
};

// ---- a sector as ground --------------------------------------------------------

export const WHOLE_LINE = Object.freeze({ kind: "all" });

// The vertex of the line nearest a point, or -1 on an empty line.
export const nearestVertex = (line, x, y) => {
  const { contour, count } = line;
  let best = -1;
  let bestDistance = Infinity;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const dx = contour.x[vertex] - x;
    const dy = contour.y[vertex] - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = vertex;
    }
  }
  return best;
};

// What a sector word means on this line:
//   { kind: "all" }
//   { kind: "cut", word, x, y, from, to }          a third along a compass axis
//   { kind: "place", word, px, py }                the line near a place
//   null                                           the word fits nothing here
// "center" is read as "centre".
export const resolveSector = (arena, line, sectors, value) => {
  const word = fold(value);
  if (!word || word === "all") return WHOLE_LINE;
  const name = word === "center" ? "centre" : word;
  const cut = sectors.cuts.get(name);
  if (cut) return { kind: "cut", word: name, ...cut };
  if (name === "centre" || COMPASS_WORDS.includes(name)) return null;
  const place = findPlace(arena, value);
  if (!place) return null;
  const vertex = nearestVertex(line, place.x, place.y);
  if (vertex < 0) return null;
  return { kind: "place", word: placeText(place), px: line.contour.x[vertex], py: line.contour.y[vertex] };
};

// Whether a point lies in a sector. `kmAt` is the frame's.
export const inSector = (sector, x, y, kmAt) => {
  if (sector.kind === "all") return true;
  if (sector.kind === "cut") {
    const along = x * sector.x + y * sector.y;
    return along >= sector.from && along <= sector.to;
  }
  const dx = x - sector.px;
  const dy = y - sector.py;
  return Math.sqrt(dx * dx + dy * dy) * kmAt((y + sector.py) / 2) <= PLACE_SECTOR_KM;
};

// The middle of a sector's stretch of line: the mean of its vertices, or of
// the whole line where it has none.
export const sectorMiddle = (line, sector, kmAt) => {
  const { contour, count } = line;
  let sumX = 0;
  let sumY = 0;
  let inside = 0;
  let allX = 0;
  let allY = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    allX += contour.x[vertex];
    allY += contour.y[vertex];
    if (!inSector(sector, contour.x[vertex], contour.y[vertex], kmAt)) continue;
    sumX += contour.x[vertex];
    sumY += contour.y[vertex];
    inside += 1;
  }
  if (inside > 0) return [sumX / inside, sumY / inside];
  return count > 0 ? [allX / count, allY / count] : [0, 0];
};
