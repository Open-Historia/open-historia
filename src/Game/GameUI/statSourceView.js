/*! Open Historia — read-only source details for standard and custom national statistics, AGPL-3.0-or-later. */
import { provenanceForStat } from "../../../server/statProvenance.js";
import { DEFAULT_STAT_INDEX_ROWS, flattenStatSheetRows, readCustomStatNumber } from "../../runtime/statIndexDefinitions.js";
import { militaryProfile } from "../../runtime/militaryPower.js";
import { intelligenceOf } from "../../runtime/spycraft.js";

export const STAT_SOURCE_LABELS = Object.freeze({
  scenario: "Scenario value", manual: "Manual edit", ai: "AI estimate", calculated: "Calculated",
  default: "Game default", unspecified: "Source unspecified", unknown: "Unknown",
});
const at = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const STANDARD = [
  ["stability", "National stability"],
  ...DEFAULT_STAT_INDEX_ROWS.map((row) => [`indices.${row.key}`, row.label]),
  ["population.total", "Total population"], ["population.coreIntegrated", "Core and integrated population"], ["population.otherTerritories", "Other territories population"],
  ["economy.gdp", "GDP"], ["economy.gdpPerCapita", "GDP/capita"], ["economy.coreGdpPerCapita", "Core GDP/capita"], ["economy.otherGdpPerCapita", "Other territories GDP/capita"],
  ["economy.gdpGrowth", "GDP growth"], ["economy.inflation", "Inflation"], ["economy.unemployment", "Unemployment"], ["economy.publicDebt", "Public debt"], ["economy.budgetBalance", "Budget balance"],
  ["gdpBreakdown.agriculture", "Agriculture"], ["gdpBreakdown.industry", "Industry"], ["gdpBreakdown.services", "Services"],
];
const MILITARY = { quality: "Troop quality", technology: "Technology", spending: "Spending", manpowerShare: "Manpower share", land: "Land", sea: "Naval", air: "Air", weariness: "War weariness", resources: "War resources" };
const TERRITORIAL_TOTALS = new Set(["population.total", "population.coreIntegrated", "population.otherTerritories", "economy.gdp", "economy.gdpPerCapita", "economy.coreGdpPerCapita", "economy.otherGdpPerCapita"]);

export const nationalStatSourceRows = ({ sheet = {}, definition = null, world = null, country = "" } = {}) => {
  const specs = definition?.custom
    ? flattenStatSheetRows(definition).map((stat) => [`customStats.${stat.key}`, stat.label])
    : STANDARD;
  const rows = [];
  const add = (path, label, raw, fallback = "unspecified", calculated = false, storedOrigin = true) => {
    const value = readCustomStatNumber(raw);
    const entry = (fallback === "default" || !storedOrigin) ? null : provenanceForStat(sheet.statProvenance, path, value);
    const source = value === null ? "unknown" : entry?.source || fallback;
    rows.push({ path, label, value, source, sourceLabel: STAT_SOURCE_LABELS[source], ...(entry?.date ? { date: entry.date } : {}), ...(entry?.round !== undefined ? { round: entry.round } : {}), calculated });
  };
  for (const [path, label] of specs) {
    if (definition?.custom && path === "customStats.intelligenceService" && world) continue;
    // Optional territorial splits are shown only when recorded, like the main sheet.
    if (!definition?.custom && /coreGdp|otherGdp|coreIntegrated|otherTerritories/.test(path) && at(sheet, path) == null) continue;
    const calculated = Boolean(sheet.territorialComponents?.length) && TERRITORIAL_TOTALS.has(path);
    add(path, label, at(sheet, path), "unspecified", calculated);
  }
  if (world && country) {
    add("intelligenceService", "Intelligence service", intelligenceOf(world, country), Object.hasOwn(world.intelligence || {}, country) ? "unspecified" : "default");
    const profile = militaryProfile(world, country);
    add("militaryPower", "Military power", profile.power, "calculated", true, false);
    for (const [key, label] of Object.entries(MILITARY)) {
      if (!Object.hasOwn(profile.figures, key)) continue;
      const ledger = key === "weariness" ? world.warWeariness : key === "resources" ? world.warResources : null;
      const native = Array.isArray(ledger) && ledger.some((entry) => String(entry?.country || "").toLowerCase() === country.toLowerCase());
      const path = key === "resources" ? "warResources" : key === "weariness" && (native || !profile.own[key]) ? "warWeariness" : `military.${key}`;
      const entry = provenanceForStat(sheet.statProvenance, path, profile.figures[key]);
      add(path, label, profile.figures[key], entry || native || profile.own[key] ? "unspecified" : "default", entry?.source === "calculated");
    }
  }
  return rows;
};

export const historicalStatSourceLabel = (sample, metric, value) => {
  if (readCustomStatNumber(value) === null) return STAT_SOURCE_LABELS.unknown;
  const key = metric?.key;
  let path;
  if (String(metric?.unit || "").startsWith("custom:")) path = `customStats.${key}`;
  else if (DEFAULT_STAT_INDEX_ROWS.some((row) => row.key === key)) path = `indices.${key}`;
  else if (["agriculture", "industry", "services"].includes(key)) path = `gdpBreakdown.${key}`;
  else if (key === "population") path = "population.total";
  else if (key === "stability") path = "stability";
  else path = `economy.${key}`;
  const origin = provenanceForStat(sample?.statProvenance, path, value);
  return STAT_SOURCE_LABELS[origin?.source || "unspecified"];
};
