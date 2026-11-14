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

// A whole number written in digits, grouped in threes by any one separator a
// language writes them with: "12,500,000", "12.500.000", "12 500 000",
// "12'500'000".
const GROUPED_DIGITS = /^\d{1,3}([,.'’_ ])\d{3}(?:\1\d{3})*$/u;

// A figure as it is typed (12500000, "12,500,000", "12.500.000",
// "12 500 000"), as a whole number of people; 0 for nothing, or for what is not
// a whole number written in digits. Never a word: "12.5 million" and "850k"
// were read and "12,5 millions" or "12,5 Millionen" were not, and "12,5" was
// read as 125 (the owner, 2026-11-13: no keywording anywhere).
export const readPopulationFigure = (value) => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 ? Math.min(POPULATION_FIGURE_MOST, Math.round(value)) : 0;
  const text = String(value ?? "").trim().replace(/[   ]/g, " ");
  if (!/^\d+$/.test(text) && !GROUPED_DIGITS.test(text)) return 0;
  const people = Number(text.replace(/\D/g, ""));
  return Number.isFinite(people) && people >= 1 ? Math.min(POPULATION_FIGURE_MOST, people) : 0;
};

// The figure a record carries, read the same way: 0 for none.
export const populationFigureOf = (record) => readPopulationFigure(record && typeof record === "object" ? record.population : 0);

// A figure for a field, as a person reads it: "12,500,000", or "" for none.
export const formatPopulationFigure = (value) => {
  const people = readPopulationFigure(value);
  return people > 0 ? people.toLocaleString("en-US") : "";
};
