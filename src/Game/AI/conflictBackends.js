/*! Open Historia — one request for the statistics of every country a player comes into conflict with © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A country a person's own comes into conflict with is asked for what the war
// reads of it (runtime/statsBackend.js: its people, its economy, the balance of
// its budget, its debt). That used to be a whole sheet of statistics a country,
// one request each, two at a time. It is ONE request now, for every such
// country there is, and since they are worked out together they are in one
// unit and to one scale.
//
// BOTH LAYERS, IN THAT ONE REQUEST. "I meant update both layers of the stats
// in one request." In a scenario with a sheet of its own, the request also
// writes that sheet for every country that has none: the backend first, then
// the scenario's values saying the same thing. So a country that comes into a
// war has both layers from the one request, and nothing is left to be asked
// for when somebody opens its statistics. A country whose own sheet is there
// already (written before sheets kept a backend) is shown it, and given the
// backend that agrees with it; its sheet is not written again.
//
// In an ordinary scenario the backend is part of the standard sheet, and the
// four figures are what is kept; the rest of that sheet (its government, its
// indices) is written when somebody opens the country's statistics, as it
// always was, from the figures already there.
//
// This module is the request's words and the reading of its answer; the asking
// and the writing are gameplay.js ensureConflictBackends. Pure, and loads in
// plain Node.

import { normalizeMilitaryStats } from "../../runtime/militaryStats.js";
import { readStatsBackend } from "../../runtime/statsBackend.js";
import { MILITARY_EXAMPLE, MILITARY_FIGURE_LINES, MILITARY_RELATIVE_LINE, describeMilitary } from "./militaryRating.js";

// The most countries one such request asks of.
export const CONFLICT_BACKENDS_MOST = 8;
// The most countries whose backends are shown for the unit and the scale.
export const CONFLICT_BACKENDS_KNOWN_MOST = 6;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The request.
//   date        the game's date
//   rules       the scenario's own rules of its world and era, or ""
//   player      the country the player leads
//   countries   [{ name, population?, values? }]: who is asked of; `population`
//               where the scenario's author gives it; `values` the scenario's
//               own sheet where the country has one already
//   known       [{ name, backend }]: countries whose backends are already kept
//   sheet       { description, keys } of the scenario's own sheet, or null for
//               a scenario that shows the standard one
//   military    whether to rate each polity's military figures too, where it has
//               none (runtime/militaryStats.js: Wars and Fronts Pt.2); a polity
//               marked `rated` in `countries` has its own already
//   rated       [{ name, military, population? }]: the polities rated already, the
//               scale the figures keep to (militaryRating.js ratedScaleOf): "when
//               this stuff is generated, it should be relative to other
//               countries" (the owner, 2026-10-16)
export const conflictBackendsRequest = ({ date = "", rules = "", player = "", countries = [], known = [], sheet = null, military = false, rated = [] } = {}) => {
  const custom = isRecord(sheet) && list(sheet.keys).length > 0;
  const asked = list(countries)
    .map((entry) => ({ name: clean(entry?.name), population: Number(entry?.population), values: custom && isRecord(entry?.values) && Object.keys(entry.values).length > 0 ? entry.values : null, rated: entry?.rated === true }))
    .filter((entry) => entry.name)
    .slice(0, CONFLICT_BACKENDS_MOST);
  const both = custom ? asked.filter((entry) => !entry.values) : [];
  const rating = military && asked.some((entry) => !entry.rated);
  const militaryExample = rating ? `,"military":${MILITARY_EXAMPLE}` : "";
  const example = both.length > 0
    ? `{"countries":[{"country":"the exact name you were given","population":0,"gdp":0,"budgetBalance":0,"publicDebt":0,"customStats":{"${clean(sheet.keys[0])}":0}${militaryExample}}]}`
    : `{"countries":[{"country":"the exact name you were given","population":0,"gdp":0,"budgetBalance":0,"publicDebt":0${militaryExample}}]}`;
  const systemPrompt = [
    "You are Open Historia's national-statistics estimator. For each polity you are given, estimate four figures the game's own arithmetic needs and no player sees:",
    "population: its people, as a plain count.",
    "gdp: the size of its economy in a year, in ONE unit that you use for every polity of this world (the unit of the polities already known, where some are shown).",
    "budgetBalance: its treasury's balance for the year as a percentage of that economy (a surplus above 0, a deficit below).",
    "publicDebt: what its treasury owes, as a percentage of that economy.",
    "Go by the era, the world as described, and each polity's size and place in it. They are estimates for the game date given, not modern figures unless the game is modern. A polity whose scenario gives its people is given that figure: keep it.",
    ...(custom ? [
      "",
      "This scenario shows its players a sheet of its own, described below, and those four figures are the hidden layer under it. The two layers are written TOGETHER, in this one answer.",
      both.length > 0
        ? "For a polity marked `and its sheet`: after its four figures, write every value of the scenario's sheet in customStats, under the exact keys, so that the sheet says the same thing as the figures (a polity they make populous and rich is not poor and empty on its sheet)."
        : "",
      asked.some((entry) => entry.values)
        ? "For a polity whose sheet is shown: its sheet stands as it is. Return its four figures only, agreeing with that sheet."
        : "",
    ].filter((line, index) => line || index === 0) : []),
    ...(rating ? [
      "",
      "For a polity marked `and its military`, also rate how it makes war, in `military`, each a whole number from 0 to 100 where 50 is an ordinary army of its era.",
      MILITARY_RELATIVE_LINE,
      ...MILITARY_FIGURE_LINES,
    ] : []),
    "",
    "Return exactly one JSON object and no markdown:",
    example,
    "One entry for every polity asked of, in the order given, each under the exact name given.",
  ].join("\n");
  const shown = list(known).filter((entry) => clean(entry?.name) && entry?.backend).slice(0, CONFLICT_BACKENDS_KNOWN_MOST);
  const scale = rating ? list(rated).map((entry) => ({ name: clean(entry?.name), line: describeMilitary(entry?.military, entry?.population) })).filter((entry) => entry.name && entry.line) : [];
  const line = (entry) => {
    const said = entry.population >= 1 ? ` (its scenario gives its people as ${Math.round(entry.population)})` : "";
    const armed = rating && !entry.rated ? "; and its military" : "";
    if (!custom) return `- ${entry.name}${said}${armed}`;
    return entry.values ? `- ${entry.name}${said}; its sheet: ${JSON.stringify(entry.values)}${armed}` : `- ${entry.name}${said}; and its sheet${armed}`;
  };
  const userMessage = [
    `Game date: ${clean(date) || "unknown"}`,
    clean(player) ? `The player leads ${clean(player)}.` : "",
    clean(rules) ? `ERA & WORLD RULES:\n${String(rules).trim().slice(0, 1800)}` : "",
    custom ? `THE SCENARIO'S OWN SHEET:\n${String(sheet.description ?? "").trim().slice(0, 2400)}` : "",
    shown.length
      ? `ALREADY KNOWN (for the unit and the scale; do not return these):\n${shown.map((entry) => `- ${clean(entry.name)}: ${JSON.stringify(entry.backend)}`).join("\n")}`
      : "No polity's figures are known yet: choose one unit for gdp and use it for all of these.",
    scale.length ? `MILITARIES ALREADY RATED (the scale every military you rate keeps to; do not return these):\n${scale.map((entry) => `- ${entry.name}: ${entry.line}`).join("\n")}` : "",
    `ESTIMATE THESE:\n${asked.map(line).join("\n")}`,
  ].filter(Boolean).join("\n\n");
  return { systemPrompt, userMessage, asked: asked.map((entry) => entry.name), sheets: both.map((entry) => entry.name), rated: rating ? asked.filter((entry) => !entry.rated).map((entry) => entry.name) : [] };
};

// The answer, for each country that was asked of and answered usably:
// [{ name, backend, customStats? }], under the names that were asked.
// `customStats` is what was written of the scenario's own sheet, as it was
// written: whoever keeps it holds it to the sheet's definition. A country
// nobody asked of is left out, and so is one answered twice after the first.
export const readConflictBackends = (payload, asked) => {
  const wanted = new Map(list(asked).map((name) => [fold(name), clean(name)]));
  const read = [];
  const seen = new Set();
  for (const entry of list(payload?.countries)) {
    const key = fold(entry?.country ?? entry?.name);
    if (!wanted.has(key) || seen.has(key)) continue;
    const backend = readStatsBackend(entry);
    if (!backend) continue;
    seen.add(key);
    // (And its military figures, where it was asked for them and gave any: runtime/militaryStats.js.)
    const military = normalizeMilitaryStats(entry.military);
    read.push({ name: wanted.get(key), backend, ...(isRecord(entry.customStats) ? { customStats: entry.customStats } : {}), ...(military ? { military } : {}) });
  }
  return read;
};
