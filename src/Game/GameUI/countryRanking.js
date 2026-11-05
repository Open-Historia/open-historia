/*! Open Historia — the Stats pane's ranking of countries © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "A cross-country ranking tab in Stats."
//
// The countries of a game ranked against one another by one figure at a time.
// Some figures every country has, because the game works them out itself: how
// much land it holds, its military power (runtime/militaryPower.js: what it
// weighs in a land war, through its own military figures). The rest come from a
// country's sheet of statistics, and only the countries that have been
// assessed have one (the player's own, those being tracked, those opened in
// the Stats pane, those the player came into conflict with). So a ranking by
// such a figure lists the countries that have it, and says how many do not:
// it is thin until more of the world has been looked at, and it says so
// rather than ranking a guess.
//
// A scenario with a sheet of its own (customStats) is ranked by its own
// values. Its hidden backend (runtime/statsBackend.js) is never shown: a
// player of such a scenario does not see people or an economy anywhere else.
//
// No React here, so node can test it. The tab is in stats.jsx.

import { middleFundingPerHead } from "../../runtime/militaryFunding.js";
import { militaryPower } from "../../runtime/militaryPower.js";
import { militaryLookup } from "../../runtime/militaryStats.js";
import { buildOwnerAliasMap, createOwnerResolver, regionBaseOwner } from "../../runtime/ownerNames.js";
import { populationFigureOf } from "../../runtime/populationFigure.js";
import { wearinessOf } from "../../runtime/warWeariness.js";

// What a figure is, for how it is written: a count of people or things, money,
// money a head, a value out of a hundred, or a weight.
export const RANKING_METRICS = Object.freeze([
  { key: "population", label: "Population", kind: "number", sheet: true },
  { key: "gdp", label: "Economy", kind: "money", sheet: true },
  { key: "gdpPerCapita", label: "Wealth per person", kind: "money each", sheet: true },
  { key: "military", label: "Military power", kind: "weight", sheet: false },
  { key: "regions", label: "Land held", kind: "count", sheet: false },
  { key: "stability", label: "Stability", kind: "index", sheet: true },
  { key: "reputation", label: "Reputation", kind: "index", sheet: true },
  { key: "weariness", label: "War weariness", kind: "index", sheet: false },
]);
const CUSTOM_PREFIX = "custom:";
// The figures the game works out for every country, whatever the scenario shows.
const EVERY_SCENARIO = ["military", "regions", "reputation", "weariness"];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const read = Number(value);
  return Number.isFinite(read) ? read : null;
};

// The figures a game can be ranked by.
//   definition   the scenario's sheet (runtime/statsSheet.js): { custom, sections }
//   rows         its values flattened (flattenStatSheetRows), for a sheet of its own
//   world        to leave out a figure nobody has (war weariness in a world at peace)
export const rankingMetricsFor = ({ definition = null, rows = [], world = null } = {}) => {
  const weary = Array.isArray(world?.warWeariness) && world.warWeariness.length > 0;
  const standing = RANKING_METRICS.filter((metric) => metric.key !== "weariness" || weary);
  if (!definition?.custom) return standing;
  const own = (Array.isArray(rows) ? rows : [])
    .filter((row) => clean(row?.key) && clean(row?.label))
    .map((row) => ({ key: `${CUSTOM_PREFIX}${row.key}`, label: clean(row.label), kind: row.kind === "index" || row.kind === "percentage" ? "index" : "number", sheet: true, stat: row }));
  return [...own, ...standing.filter((metric) => EVERY_SCENARIO.includes(metric.key))];
};

// How many regions each country holds now: Map of its key in lower case to the
// count. From the catalog the map is drawn from, each region by who the world
// says holds it, else who it was drawn as.
export const regionCountsOf = (catalog, world) => {
  const ownership = record(world?.regionOwnershipOverrides);
  const owner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  const counts = new Map();
  const seen = new Set();
  const add = (name) => {
    const key = lower(name);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const region of Array.isArray(catalog) ? catalog : []) {
    const id = clean(region?.id);
    if (!id) continue;
    seen.add(id);
    add(ownership[id] != null ? owner(ownership[id]) : owner(regionBaseOwner(region)));
  }
  // (A region the world names and the catalog does not list still counts for whoever holds it.)
  for (const [id, holder] of Object.entries(ownership)) if (!seen.has(id)) add(owner(holder));
  return counts;
};

// A country's people as the game knows them: its sheet's, else what the scenario's author gave it. null for neither.
const peopleOf = (world, key) => {
  const total = finite(record(record(world?.countryStats)[key]).population?.total);
  if (total !== null && total > 0) return total;
  const authored = populationFigureOf(record(world?.polityOverrides)[key]);
  return authored > 0 ? authored : null;
};

// One country's figure, or null where the game has none for it.
//   context   { regions, middle, military }: regionCountsOf, middleFundingPerHead of
//             the world's sheets, and militaryLookup of the world (read once for the
//             whole ranking; worked out for the one country when not given)
export const rankingValue = (metric, world, key, context = {}) => {
  const sheet = record(record(world?.countryStats)[key]);
  const held = context.regions?.get(lower(key)) ?? 0;
  switch (metric?.key) {
    case "population":
      return peopleOf(world, key);
    case "gdp": {
      const gdp = finite(sheet.economy?.gdp);
      return gdp !== null && gdp > 0 ? gdp : null;
    }
    case "gdpPerCapita": {
      const each = finite(sheet.economy?.gdpPerCapita);
      return each !== null && each > 0 ? each : null;
    }
    case "stability":
      return finite(sheet.stability);
    case "regions":
      return held > 0 ? held : null;
    case "military": {
      // Its weight in a land war through its own figures; at the figures every country has, the weight itself. (Its
      // people's and its figures', never the land it holds: none where its people are not known yet.)
      const power = militaryPower(world, key, { middle: context.middle ?? 0, lookup: context.military ?? null });
      return power === null ? null : Math.round(power * 10) / 10;
    }
    case "reputation": {
      const moved = finite(record(world?.internationalReputation)[key]);
      const read = moved !== null ? moved : finite(sheet.indices?.internationalReputation);
      return read === null ? null : Math.max(0, Math.min(100, Math.round(read)));
    }
    case "weariness": {
      const weary = wearinessOf(world?.warWeariness, key);
      return weary > 0 ? Math.round(weary) : null;
    }
    default:
      break;
  }
  if (clean(metric?.key).startsWith(CUSTOM_PREFIX)) return finite(record(sheet.customStats)[metric.key.slice(CUSTOM_PREFIX.length)]);
  return null;
};

// The figure the tab opens on: the first a few countries have, so that a game
// in which nobody has been assessed yet does not open on an empty list.
export const openingMetric = ({ world = {}, countries = [], metrics = [], catalog = [] } = {}) => {
  const ranked = (metric) => buildRanking({ world, countries, metric, catalog }).rows.length;
  return metrics.find((metric) => ranked(metric) >= 3) ?? metrics.find((metric) => ranked(metric) > 0) ?? metrics[0] ?? null;
};

// The countries ranked by one figure.
//   world       the world
//   countries   [{ key, label }]: who is in the game (statsHistoricalTracking.js buildHistoricalTrackingCandidateRows)
//   metric      one of rankingMetricsFor
//   catalog     the region catalog the map is drawn from, for the land each holds
// Returns { rows, unranked, total, most }:
//   rows       [{ key, label, value, rank }] best first; countries level on the figure share a rank
//   unranked   how many countries the game has no such figure for
//   most       the largest figure, for a bar
export const buildRanking = ({ world = {}, countries = [], metric = null, catalog = [] } = {}) => {
  const context = {
    regions: regionCountsOf(catalog, world),
    middle: middleFundingPerHead(record(world?.countryStats)),
    military: metric?.key === "military" ? militaryLookup(world) : null,
  };
  const seen = new Set();
  const ranked = [];
  let unranked = 0;
  for (const country of Array.isArray(countries) ? countries : []) {
    const key = clean(country?.key);
    if (!key || seen.has(lower(key))) continue;
    seen.add(lower(key));
    const value = rankingValue(metric, world, key, context);
    if (value === null) unranked += 1;
    else ranked.push({ key, label: clean(country.label) || key, value });
  }
  ranked.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  let rank = 0;
  const rows = ranked.map((row, index) => {
    if (index === 0 || row.value !== ranked[index - 1].value) rank = index + 1;
    return { ...row, rank };
  });
  return { rows, unranked, total: rows.length + unranked, most: rows.length > 0 ? Math.max(...rows.map((row) => Math.abs(row.value))) : 0 };
};
