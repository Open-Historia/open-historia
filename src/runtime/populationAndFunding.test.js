/*! Open Historia — a scenario's own populations, and what a country has for its forces: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/populationAndFunding.test.js
//
// "Budget: factors in economics for military strength to know how much funding
// exists in the backend."
// "Alternate Scenarios: the map editor could provide fields for scenario
// designers to input custom population stats for countries, and groups."
//
// Needs node_modules: frontTurn.js reaches gameState.js, which reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { countryWeight, frontWorldReaders } from "../Game/AI/frontTurn.js";
import { withFrontManpower } from "../Game/AI/frontApply.js";
import { normalizeGroups } from "./groups.js";
import {
  FUNDING_FACTOR_LEAST,
  FUNDING_FACTOR_MOST,
  MILITARY_GDP_SHARE,
  fundingFactor,
  fundingPerHead,
  middleFundingPerHead,
  militaryFunding,
  treasuryFactor,
} from "./militaryFunding.js";
import { POPULATION_FIGURE_MOST, formatPopulationFigure, populationFigureOf, readPopulationFigure } from "./populationFigure.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const sheet = ({ people = 50e6, gdp = 1e12, balance = 0, debt = 40 } = {}) => ({ population: { total: people }, economy: { gdp, budgetBalance: balance, publicDebt: debt } });

// ---- a scenario's own populations -----------------------------------------------------

test("a population is read as its author types it", () => {
  assert.equal(readPopulationFigure("12,500,000"), 12500000);
  assert.equal(readPopulationFigure("12.5 million"), 12500000);
  assert.equal(readPopulationFigure("850k"), 850000);
  assert.equal(readPopulationFigure("1.4 Billion"), 1400000000);
  assert.equal(readPopulationFigure(4000000.4), 4000000);
  for (const nothing of ["", "many", "-5", "12 goats", null, undefined, 0, NaN]) assert.equal(readPopulationFigure(nothing), 0, String(nothing));
  assert.equal(readPopulationFigure("900 billion"), POPULATION_FIGURE_MOST);
  assert.equal(formatPopulationFigure(12500000), "12,500,000");
  assert.equal(formatPopulationFigure(""), "");
  assert.equal(populationFigureOf({ population: "3 million" }), 3000000);
  assert.equal(populationFigureOf(null), 0);
});

test("the Workshop has the field for a country and for a group, and the figure is kept with each", () => {
  const polities = read("../Editor/PolitiesPanel.jsx");
  assert.ok(polities.includes("Population when the scenario begins"));
  assert.ok(polities.includes("upsertPolity?.(current.key, { population: people > 0 ? people : undefined });"));
  const groups = read("../Editor/GroupsPanel.jsx");
  assert.ok(groups.includes("Population when the scenario begins"));
  assert.ok(groups.includes("patchRecord(current, { population: people > 0 ? people : undefined });"));
  // A group's record keeps it; one with none carries no such key.
  assert.deepEqual(normalizeGroups({ "The Cartel": { description: "x", population: "250k" }, "The League": { description: "y" } }), {
    "The Cartel": { name: "The Cartel", description: "x", color: normalizeGroups({ "The Cartel": {} })["The Cartel"].color, population: 250000 },
    "The League": { name: "The League", description: "y", color: normalizeGroups({ "The League": {} })["The League"].color },
  });
  // A country's record keeps it through the game's own reading of the world, and whoever writes its statistics is told it.
  assert.ok(read("./gameState.js").includes("...(populationFigureOf(value) > 0 ? { population: populationFigureOf(value) } : {}),"));
  assert.ok(read("../Game/AI/countryStatsWorkerKernel.js").includes("Population when the scenario begins, as its author gives it: ${Math.round(Number(polity.population))}. Take that as given, and move it only by what has happened since."));
  // Beside it, each one's own military figures (Editor/MilitaryFields.jsx), kept the same way.
  assert.ok(polities.includes("onChange={(military) => upsertPolity?.(current.key, { military: military ?? undefined })}"));
  assert.ok(groups.includes("onChange={(military) => patchRecord(current, { military: military ?? undefined })}"));
  assert.ok(read("./gameState.js").includes("...(normalizeMilitaryStats(value.military) ? { military: normalizeMilitaryStats(value.military) } : {}),"));
  assert.deepEqual(normalizeGroups({ "The Watch": { military: { manpowerShare: "60", quality: 300 } } })["The Watch"].military, { quality: 100, manpowerShare: 60 });
});

test("the game takes a country's and a group's people from its scenario until a sheet of statistics says otherwise", () => {
  const world = {
    regionOwnershipOverrides: { r1: "Aland", r2: "Aland", r3: "Borduria", r4: "Cisland" },
    polityOverrides: { Aland: { name: "Aland", population: 9000000 }, Borduria: { name: "Borduria", population: 4000000 }, Cisland: { name: "Cisland" } },
    groups: { "The Cartel": { name: "The Cartel", population: 250000 } },
    groupAreas: { r4: "The Cartel" },
    countryStats: { Borduria: { population: { total: 16000000 } } },
  };
  const readers = frontWorldReaders(world, { regionIds: ["r1", "r2", "r3", "r4"] });
  assert.equal(readers.peopleOf("Aland"), 9000000, "its author's figure");
  assert.equal(readers.peopleOf("Borduria"), 16000000, "its sheet's, once it has one");
  assert.equal(readers.peopleOf("Cisland"), 0, "nobody says");
  assert.equal(readers.peopleOf("The Cartel"), 250000);
  // So each weighs in a land war by its people: Aland 2 x the root of 9, the group by its own and no longer by its one region.
  assert.equal(readers.strengthOf("Aland"), 6);
  assert.equal(readers.strengthOf("Borduria"), 8);
  assert.equal(readers.strengthOf("The Cartel"), 1);
  assert.equal(frontWorldReaders({ ...world, groups: { "The Cartel": { name: "The Cartel", population: 4000000 } } }, { regionIds: ["r1"] }).strengthOf("The Cartel"), 4);
  // With groups switched off a group's figure is nobody's.
  assert.equal(frontWorldReaders(world, { regionIds: ["r1"], groups: false }).peopleOf("The Cartel"), 0);
});

// ---- what a country has for its forces --------------------------------------------------

test("a country's funding is a share of its economy, more with a surplus, less with a deficit and a heavy debt", () => {
  assert.equal(MILITARY_GDP_SHARE, 0.03);
  assert.equal(treasuryFactor(sheet()), 1);
  assert.equal(militaryFunding(sheet({ gdp: 1e12 })), 3e10);
  assert.ok(militaryFunding(sheet({ balance: 5 })) > militaryFunding(sheet()));
  assert.ok(militaryFunding(sheet({ balance: -8 })) < militaryFunding(sheet()));
  assert.ok(militaryFunding(sheet({ debt: 180 })) < militaryFunding(sheet({ debt: 60 })));
  assert.equal(treasuryFactor(sheet({ debt: 60 })), 1, "a debt that is easily carried costs nothing");
  // Held within its bounds, whatever a sheet says.
  assert.equal(treasuryFactor(sheet({ balance: -1000, debt: 1000 })), 0.6);
  assert.equal(treasuryFactor(sheet({ balance: 1000 })), 1.25);
  // No economy known: nothing to spend that anybody knows of.
  assert.equal(militaryFunding({ population: { total: 5e6 } }), 0);
  assert.equal(militaryFunding(null), 0);
  assert.equal(fundingPerHead(sheet({ people: 1e6, gdp: 1e9 })), 30);
});

test("funding moves a country's weight in a land war: its treasury alone, or against the others whose economies are known", () => {
  // Nothing known of it: nothing changes.
  assert.equal(fundingFactor(null), 1);
  assert.equal(fundingFactor({ population: { total: 5e6 } }), 1);
  // Nobody to compare with: how its own treasury stands.
  assert.equal(fundingFactor(sheet()), 1);
  assert.ok(fundingFactor(sheet({ balance: -10, debt: 150 })) < 0.9);
  assert.ok(fundingFactor(sheet({ balance: 6 })) > 1.1);
  // Three or more known: funding a head against the middle of them.
  const stats = { Rich: sheet({ people: 10e6, gdp: 8e11 }), Middle: sheet({ people: 10e6, gdp: 2e11 }), Poor: sheet({ people: 10e6, gdp: 2e10 }) };
  assert.equal(middleFundingPerHead({ Rich: stats.Rich, Middle: stats.Middle }), 0, "two are too few to compare");
  const middle = middleFundingPerHead(stats);
  assert.equal(middle, fundingPerHead(stats.Middle));
  assert.equal(fundingFactor(stats.Middle, middle), 1);
  assert.ok(fundingFactor(stats.Rich, middle) > 1.3 && fundingFactor(stats.Rich, middle) <= FUNDING_FACTOR_MOST);
  assert.ok(fundingFactor(stats.Poor, middle) < 0.7 && fundingFactor(stats.Poor, middle) >= FUNDING_FACTOR_LEAST);
  // And in the weight itself: the same people, better or worse paid for.
  assert.equal(countryWeight({ population: 100e6 }), 20);
  assert.equal(countryWeight({ population: 100e6, funding: 1.2 }), 24);
  assert.equal(countryWeight({ population: 100e6, funding: 0 }), 20, "a factor that is no number is none");
  const readers = frontWorldReaders({ regionOwnershipOverrides: {}, countryStats: stats }, {});
  assert.ok(readers.strengthOf("Rich") > readers.strengthOf("Middle") && readers.strengthOf("Middle") > readers.strengthOf("Poor"));
  assert.equal(readers.strengthOf("Middle"), countryWeight({ population: 10e6 }));
});

// ---- what recruitment costs a country ---------------------------------------------------

test("what a turn's recruitment drew comes off the country's population, less the men who came home", () => {
  const patched = [];
  const patch = (world, name, change) => {
    patched.push([name, change.population.total]);
    world.countryStats[name] = { ...world.countryStats[name], population: { ...world.countryStats[name].population, total: change.population.total } };
  };
  const world = { countryStats: { Aland: { population: { total: 9000000 } }, Borduria: { population: { total: 4000000 } } } };
  const fronts = { manpower: [{ name: "aland", drawn: 240000, returned: 30000 }, { name: "Borduria", drawn: 0, returned: 50000 }, { name: "Cisland", drawn: 90000, returned: 0 }] };
  const next = withFrontManpower(world, fronts, patch);
  assert.deepEqual(patched, [["Aland", 8790000], ["Borduria", 4050000]], "and a country with no sheet has nothing to take them from");
  assert.equal(next.countryStats.Aland.population.total, 8790000);
  assert.equal(world.countryStats.Aland.population.total, 9000000, "the world it was given is not written on");
  // Nothing charged: the same world.
  assert.equal(withFrontManpower(world, { manpower: [] }, patch), world);
  assert.equal(withFrontManpower(world, null, patch), world);
  assert.equal(withFrontManpower(world, { manpower: [{ name: "Cisland", drawn: 5, returned: 0 }] }, patch), world);
});
