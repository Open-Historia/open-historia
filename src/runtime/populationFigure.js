/*! Open Historia — a population as a scenario's author writes it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The map editor could provide fields for scenario designers to input custom
// population stats for countries, and groups."
//
// The figure an author types for a country or a group in the Workshop
// (Editor/PolitiesPanel.jsx, Editor/GroupsPanel.jsx): its people when the
// scenario begins. It is kept with the country's record
// (world.polityOverrides[name].population) or the group's
// (world.groups[name].population), and it is what the game takes that
// population to be until a sheet of statistics says otherwise: what its
// troops are raised from (runtime/fronts/manpower.js), how it weighs in a land
// war (Game/AI/frontTurn.js), and what whoever writes its statistics is told
// to begin from (Game/AI/countryStatsWorkerKernel.js).
//
// Pure, and loads in plain Node.

export const POPULATION_FIGURE_MOST = 2e10;

const SCALES = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

// A figure as it is typed ("12,500,000", "12.5 million", "850k", 4000000), as
// a whole number of people; 0 for nothing, or for what is not a number.
export const readPopulationFigure = (value) => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 ? Math.min(POPULATION_FIGURE_MOST, Math.round(value)) : 0;
  const text = String(value ?? "").trim().toLowerCase().replace(/[,\s_'’]/g, "");
  const match = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(text);
  if (!match) return 0;
  const scale = match[2] ? SCALES[match[2]] : 1;
  if (!scale) return 0;
  const people = Number(match[1]) * scale;
  return Number.isFinite(people) && people >= 1 ? Math.min(POPULATION_FIGURE_MOST, Math.round(people)) : 0;
};

// The figure a record carries, read the same way: 0 for none.
export const populationFigureOf = (record) => readPopulationFigure(record && typeof record === "object" ? record.population : 0);

// A figure for a field, as a person reads it: "12,500,000", or "" for none.
export const formatPopulationFigure = (value) => {
  const people = readPopulationFigure(value);
  return people > 0 ? people.toLocaleString("en-US") : "";
};
