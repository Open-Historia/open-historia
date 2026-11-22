/*! Open Historia — the figures a war needs, written by the time skip that starts it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A country that fights needs figures the game's own arithmetic reads: its
// people, its economy, its budget and its debt (runtime/statsBackend.js), and
// how it makes war (runtime/militaryStats.js). They used to be asked for after
// the turn, a request for those in conflict with a player (conflictBackends.js)
// and another for every other country at war (militaryRating.js): a skip that
// started a war cost three requests. "have it already contain that" (the
// owner, 2026-11-02): the skip writes them itself, in the same answer, for the
// countries at war that have none and for every country its own warUpdates
// bring into a war. What it leaves out is still asked for after the turn
// (gameplay.js requestConflictSheets), so a war never goes without.
//
// The answer is a line a country, "Borduria | people 4200000 | economy 38 |
// ...": the format's own labels, exactly, and its figures in plain digits, in
// any order, any of the figures, a colon or a comma in place of a bar. No
// synonym, number word or digit grouping is read, in any language: the model
// is told so. A figure the game keeps already is never overwritten
// (gameplay.js keepWarFigures).
//
// Pure, and loads in plain Node.

import { readStatsBackend } from "../../runtime/statsBackend.js";
import { describeMilitary, ratedFigures } from "./militaryRating.js";

export const WAR_FIGURES_HEADING = "[Figures the War Needs]";
// The skip's answer field (gameplaySchemas.js).
export const WAR_FIGURES_FIELD = "warFigures";
// The most countries a skip is asked of by name, and the most it is shown as the scale.
export const WAR_FIGURES_WANTED_MOST = 8;
export const WAR_FIGURES_SCALE_MOST = 8;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// The line's labels, in the order the format shows them: each one's figure on
// the game's sheets, and the example the format gives it. The format and the
// reading below are both made from this, so they cannot drift apart.
const LABELS = [
  ["people", "population", "4200000"],
  ["economy", "gdp", "38"],
  ["budget", "budgetBalance", "-2.5"],
  ["debt", "publicDebt", "60"],
  ["quality", "quality", "55"],
  ["technology", "technology", "50"],
  ["land", "land", "55"],
  ["sea", "sea", "20"],
  ["air", "air", "30"],
  ["spending", "spending", "45"],
  ["manpower", "manpowerShare", "12"],
  ["cavalry", "cavalryShare", "0.2"],
  ["siege", "siegeShare", "0.1"],
];
const FORMAT = ["Borduria", ...LABELS.map(([label, , example]) => `${label} ${example}`)].join(" | ");

const RULE = [
  `The game's own war arithmetic needs figures of every country that fights: armies are raised from its people and paid from its economy, and fight by how it makes war. Write them in ${WAR_FIGURES_FIELD}, a line for each country named under NONE YET below and for each country a line of warUpdates in this answer starts a war with or brings into one, unless the scale below shows it; "" when there is none. A line is the country's exact name, then its figures:`,
  FORMAT,
  "Write the labels exactly as shown, never translated, and the figures in plain digits: a point before decimals, no separators or words (4200000, not 4,200,000 or 4.2 million).",
  "people: a plain count. economy: its economy in a year, in the unit of the scale below (choose one where none is shown). budget: its treasury's balance for the year, % of its economy (a deficit below 0). debt: what its treasury owes, % of its economy.",
  "quality, technology, land, sea, air, spending: 0 to 100 against every other country, 50 an ordinary army of its era and the world's strongest 85 to 95; quality is how well its soldiers fight, technology what they fight with, spending what its forces have for each soldier; land, sea or air 0 where it cannot fight there at all. manpower: the % of its people it could call up in a war (12 ordinary). cavalry, siege: the shares of its army that are horse (armour today) and siege engines (artillery), 0 to 1.",
  "Go by the era, the world and the country's place in it. These figures are the game's: tell none of them in an event.",
].join("\n");

// The block; "" when there is no war to need it.
//   wanted   the countries at war that have no figures yet, exact names
//   known    [{ name, backend }]: countries whose people and economy the game keeps, the economy's unit
//   rated    [{ name, military, population }]: countries rated already, the military scale
export const buildWarFiguresBlock = ({ wanted = [], known = [], rated = [] } = {}) => {
  const firsts = new Map();
  for (const name of list(wanted).map(clean).filter(Boolean)) if (!firsts.has(fold(name))) firsts.set(fold(name), name);
  const named = [...firsts.values()].slice(0, WAR_FIGURES_WANTED_MOST);
  const scale = new Map();
  for (const entry of list(known)) {
    const name = clean(entry?.name);
    const backend = readStatsBackend(entry?.backend);
    if (!name || !backend || scale.size >= WAR_FIGURES_SCALE_MOST) continue;
    const parts = [`people ${backend.population}`];
    if (backend.gdp !== undefined) parts.push(`economy ${backend.gdp}`);
    if (backend.budgetBalance !== undefined) parts.push(`budget ${backend.budgetBalance}`);
    if (backend.publicDebt !== undefined) parts.push(`debt ${backend.publicDebt}`);
    scale.set(fold(name), { name, parts });
  }
  for (const entry of list(rated)) {
    const name = clean(entry?.name);
    const line = describeMilitary(entry?.military);
    if (!name || !line) continue;
    const had = scale.get(fold(name));
    if (had) had.parts.push(line);
    else if (scale.size < WAR_FIGURES_SCALE_MOST) scale.set(fold(name), { name, parts: [line] });
  }
  return [
    WAR_FIGURES_HEADING,
    RULE,
    scale.size > 0
      ? `The scale (countries the game has figures for; your figures keep to theirs):\n${[...scale.values()].map((entry) => `- ${entry.name}: ${entry.parts.join(", ")}`).join("\n")}`
      : "The scale: no country has figures yet; yours set it.",
    named.length > 0 ? `NONE YET (at war, and the game has no figures of them): ${named.join(", ")}` : "NONE YET: none.",
  ].join("\n");
};

// ---- reading the answer ------------------------------------------------------------------

// The format's own labels, read as the prompt writes them, case aside, and no
// other word in any language. The reading took English synonyms too ("pop",
// "tech", "navy", "armour", "artillery"…) and nothing in any other language,
// so a model that wrote the labels in the game's language had no figure read;
// a label not the format's is still none of them. What the skip leaves unread
// is asked for after the turn, as what it leaves out always was
// (gameplay.js requestConflictSheets).
const FIELDS = new Map(LABELS.map(([label, field]) => [label, field]));
const SHARES = new Set(["cavalryShare", "siegeShare"]);

// A figure as the format writes it: digits, a sign below 0, a point before any
// decimals, and a "%" the model may put after a percentage or a share. Nothing
// else: "67,000,000", "67 000 000" and "4,2" each mean one thing in one
// language and another in the next, and "million" is English; a figure written
// so is not read, never misread.
const FIGURE = /^([+-]?\d+(?:\.\d+)?)\s*(%?)$/;

// One piece of a line, "people 4200000" or "budget: -2.5%": [field, value], or null.
const readPiece = (piece) => {
  const match = /^(\p{L}[\p{L}\p{M}]*)\s*[:=]?\s*(.+?)\.?$/u.exec(clean(piece));
  const field = match ? FIELDS.get(match[1].toLowerCase()) : undefined;
  const figure = field ? FIGURE.exec(match[2]) : null;
  if (!figure) return null;
  let value = Number(figure[1]);
  if (!Number.isFinite(value)) return null;
  // (A share written as a percent.)
  if (SHARES.has(field) && value > 1 && value <= 100) value /= 100;
  return [field, value];
};

// The answer's lines: [{ name, backend?, military? }], each country once (its first line), under the
// name it was written with. Which names the game takes is the caller's (gameplay.js keepWarFigures).
export const readWarFigures = (value) => {
  const lines = Array.isArray(value) ? value.flatMap((entry) => String(entry ?? "").split(/\r?\n/)) : String(value ?? "").split(/\r?\n/);
  const read = [];
  const seen = new Set();
  for (const raw of lines) {
    const line = clean(raw).replace(/^[-*•]\s*/, "");
    if (!line) continue;
    let name;
    let pieces;
    if (line.includes("|")) {
      [name, ...pieces] = line.split("|");
    } else {
      const at = line.indexOf(":");
      if (at < 0) continue;
      name = line.slice(0, at);
      pieces = line.slice(at + 1).split(/[;,](?!\d{3}(?!\d))/);
    }
    name = clean(name).replace(/:$/, "");
    if (!name || seen.has(fold(name))) continue;
    const figures = {};
    for (const piece of pieces) {
      const pair = readPiece(piece);
      if (pair && figures[pair[0]] === undefined) figures[pair[0]] = pair[1];
    }
    const backend = readStatsBackend(figures);
    const military = ratedFigures(figures);
    if (!backend && !military) continue;
    seen.add(fold(name));
    read.push({ name, ...(backend ? { backend } : {}), ...(military ? { military } : {}) });
  }
  return read;
};
