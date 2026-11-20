/*!
 * Open Historia Map Editor - read-only Country Details summary.
 * All values come from existing scenario authoring state. Missing means unset.
 */
import { formatPopulationFigure } from "../runtime/populationFigure.js";
import { normalizeMilitaryStats } from "../runtime/militaryStats.js";
import { overlordRowOf, puppetRowsOf } from "./scenarioPuppets.js";

const names = (value) => Array.isArray(value)
  ? value.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim())
  : [];

export const countryOverviewFacts = ({
  current, polities = {}, puppets = [], flags = {}, tags = {},
} = {}) => {
  const key = String(current?.key || "");
  const record = current?.record && typeof current.record === "object" ? current.record : null;
  const nameOf = (otherKey) => String(polities?.[otherKey]?.name || otherKey || "").trim();
  const military = normalizeMilitaryStats(record?.military);
  const overlord = key ? overlordRowOf(puppets, key) : null;
  const dependents = key ? puppetRowsOf(puppets, key) : [];
  const population = formatPopulationFigure(record?.population);
  return {
    aliases: names(record?.aliases),
    formerNames: names(record?.formerNames),
    regionCount: Number(current?.regionCount) || 0,
    claimantCount: Number(current?.claimantCount) || 0,
    flagSet: Boolean(flags?.[key]),
    tags: names(tags?.[key]),
    population: population || null,
    militaryFields: military ? Object.keys(military).length : 0,
    overlord: overlord ? nameOf(overlord.overlord) : null,
    dependencyKind: overlord?.kind || null,
    dependentNames: dependents.map((row) => nameOf(row.puppet)),
    note: typeof record?.note === "string" && record.note.trim() ? record.note.trim() : null,
    hasRecord: Boolean(record),
  };
};
