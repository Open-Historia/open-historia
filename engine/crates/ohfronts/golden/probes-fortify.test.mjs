import test from "node:test";
import { buildDays, buildTimeParts, fortifyCostFor, fortifyCostReckoner, fortifyLevelOf, fundingOf, lineKm, manpowerShareOf, peopleOf } from "../../../../../src/runtime/fortifyCost.js";
import { fundingFactor, fundingPerHead, middleFundingPerHead, militaryFunding, treasuryFactor } from "../../../../../src/runtime/militaryFunding.js";
import { militaryLookup, normalizeMilitaryStats } from "../../../../../src/runtime/militaryStats.js";
import { populationFigureOf, readPopulationFigure } from "../../../../../src/runtime/populationFigure.js";
import { normalizeFortifications } from "../../../../../src/runtime/warGeography.js";
import { normalizeWarOutcomes } from "../../../../../src/runtime/warOutcomes.js";
import { normalizeEra, normalizeMusterPoints, normalizeWarfare, normalizeWarSettings, warSettingsOf } from "../../../../../src/runtime/warSettings.js";
import { applyFortifyOp, cleanFortifyOp, fortifyLineOf } from "../../../../../src/runtime/fronts/fortifyOps.js";
import { isWarIdName, plainFrontName } from "../../../../../src/runtime/fronts/record.js";

const sheets = {
  Aland: { population: { total: 8000000 }, economy: { gdp: 400e9, budgetBalance: -4, publicDebt: 90 }, military: { manpowerShare: 7.25, quality: 140, land: "55" } },
  Borduria: { population: { total: 30000000 }, economy: { gdp: 900e9, budgetBalance: 3, publicDebt: 40 } },
  Cyrene: { population: { total: 2000000 }, economy: { gdp: 30e9, budgetBalance: 30, publicDebt: 500 } },
  Dacia: { population: { total: 0 }, economy: { gdp: "12e9" } },
  Erewhon: { economy: {} },
};

test("golden probes for what a fortified line costs", () => {
  for (const value of [5, 0.5, 1, NaN, 3e10, "1,200", "3.5m", "12 million", "2bn", " 7 K ", "abc", "5.", "1e3", null, undefined, "constructor", "4’000", "8_000", "0.4", "12.75k", "1.5 billion", "", true]) readPopulationFigure(value);
  for (const record of [{ population: "2m" }, { population: 40000 }, null, "x", { population: "nope" }]) populationFigureOf(record);
  for (const sheet of Object.values(sheets).concat([null, {}, { economy: { gdp: -5 } }])) {
    treasuryFactor(sheet);
    militaryFunding(sheet);
    fundingPerHead(sheet);
  }
  middleFundingPerHead(sheets);
  middleFundingPerHead({ Aland: sheets.Aland, Borduria: sheets.Borduria });
  middleFundingPerHead({ ...sheets, Fen: { population: { total: 5e6 }, economy: { gdp: 70e9 } } });
  middleFundingPerHead(null);
  const middle = middleFundingPerHead(sheets);
  for (const sheet of Object.values(sheets)) {
    fundingFactor(sheet, middle);
    fundingFactor(sheet);
  }
  for (const value of [{ quality: -5, technology: "70", spending: "", manpowerShare: 0.04, cavalryShare: 0.12345, siegeShare: 2, menPerCounter: 1e9, muster: [[0.5, 30], [0.2, 10]] }, { land: "x" }, null, [], {}]) normalizeMilitaryStats(value);
  const world = {
    countryStats: sheets,
    polityOverrides: { aland: { name: "Aland", military: { manpowerShare: 9, sea: 40 }, population: "9m" }, nova: { name: "Nova Terra", population: "1.2m", military: { air: 70 } } },
    groups: { Rebels: { population: 50000, military: { land: 30 } } },
    warSettings: { mechanics: { military: true, walls: true }, manpowerShare: 15 },
  };
  const lookup = militaryLookup(world);
  for (const name of ["Aland", " aland ", "Nova Terra", "nova", "Rebels", "Borduria", ""]) lookup(name);
  for (const value of [0, 3, 2.5, "1", -1, null, "", 4]) normalizeEra(value);
  for (const value of [[[0.5, 30], [0.2, 10]], [[0.2, 10], [0.2005, 20]], [[0.1, 5], [0.9, 5]], [[0, 1], [1, 2]], [0.3], null, [[0.25, "40"], ["0.75", 120.04]]]) normalizeMusterPoints(value);
  for (const value of ["front", "swarm", "line", null]) normalizeWarfare(value);
  const settings = [
    { mechanics: { walls: false, air: "yes", fatigue: true }, era: 2, menPerCounter: 1234.6, manpowerShare: 12.34, muster: [[0.3, 10], [0.8, 60]], outcomes: [{ winner: "Aland", loser: "Borduria" }, { winner: " aland ", loser: "BORDURIA" }, { winner: "x", loser: "X" }], warfare: "swarm" },
    { era: 9, menPerCounter: 0, manpowerShare: 101 },
    null,
    [],
    "text",
  ];
  for (const value of settings) {
    normalizeWarSettings(value);
    warSettingsOf({ warSettings: value });
  }
  normalizeWarOutcomes([{ winner: "A", loser: "B" }, null, { winner: "", loser: "B" }, ...Array.from({ length: 30 }, (_, at) => ({ winner: `W${at}`, loser: `L${at}` }))]);
  normalizeFortifications([
    { id: " w1 ", name: "  The   Wall ", owner: "Aland", level: 12, points: [[1, 2], [3, "4"], ["x", 5], [6, 95], [7.123456789, 8.987654321]], breaches: [[5, 9], [2, 6], [12, 11], [-1, 3], [20, 30.456]], wear: [[3.7, 0.5], [-1, 0.2], [4, 0], [5, 1.5], [6, "0.12345"]], building: { since: " 1914-07-20 ", days: 40000 } },
    { points: [[1, 1]] },
    null,
    { level: 1, points: [[0, 0], [1, 1]], building: { since: "", days: 4 } },
    { id: "", level: "", points: [[0, 0], [1, 1]], building: { since: "1914-01-01" } },
  ]);
  for (const value of [5, 2, 11, "7.5", "x", null, 8.5]) fortifyLevelOf(value);
  for (const options of [{ km: 130, level: 5, funding: 1.2, men: 960000 }, { km: "40", level: 9, funding: 0, men: -1 }, {}, { km: 6000, level: 9, funding: 0.6, men: 1000 }, { km: NaN }]) buildDays(options);
  const points = [[0.5, 53.5], [1.5, 53.6], [2.5, 53.5]];
  lineKm(points);
  lineKm([[0, 0], ["1", 1], [2, 2]]);
  lineKm(null);
  for (const country of ["Aland", "Nova Terra", "Rebels", "Borduria", "Nowhere", ""]) {
    peopleOf(world, country);
    manpowerShareOf(world, country);
    manpowerShareOf({ countryStats: sheets }, country);
    fundingOf(world, country);
    fortifyCostFor(world, country, points, 6);
  }
  const reckon = fortifyCostReckoner(world, "Aland");
  for (let level = 9; level >= 2; level -= 1) reckon(points, level);
  for (const days of [0, 1, 13.6, 14, 60, 61, 729, 730, 5000, "x", -3]) buildTimeParts(days);
  fortifyLineOf(Array.from({ length: 450 }, (_, at) => [at % 7 === 0 ? 0.1 * (at - 1) : 0.1 * at, 50 + 0.001 * at]));
  fortifyLineOf([[1, 1], [1, 1], [2, 2], null, [3, 100], [4.1234567, 4]]);
  cleanFortifyOp({ op: "fortify", points: [[1, 1], [2, 2]], level: "6.6", name: "  A   line ", owner: " Aland " });
  cleanFortifyOp({ op: "unfortify", id: "  built-3  " });
  cleanFortifyOp({ op: "other" });
  for (const name of ["war-france-italy-2016", "WAR-France-Italy-2016", "war-ąę-x", "war-भारत", "war--x", "war-", "war-a_b", "The front", "war-²-٠", "war-x-"]) isWarIdName(name, ["war-1"]);
  isWarIdName("The front", new Set(["the FRONT"]));
  plainFrontName([["Aland"], ["Borduria", "Cyrene"]]);
  plainFrontName([[], ["Borduria"]]);
  const chart = { holds: (owner, lng) => (lng > 3 ? null : owner === "Aland") };
  const base = { countryStats: sheets, warSettings: { mechanics: { walls: true } }, fortifications: [] };
  const made = applyFortifyOp(base, { op: "fortify", points, level: 5, name: "North" }, { player: "Aland", date: "1914-08-01", chart });
  const again = applyFortifyOp(made.world, { op: "fortify", points: [[0.5, 52], [1.5, 52.1]], level: 4 }, { player: " aland ", date: "1914-08-01", chart });
  applyFortifyOp(again.world, { op: "unfortify", id: "built-1" }, { player: "Aland", date: "1914-08-02" });
  applyFortifyOp(again.world, { op: "unfortify", id: "built-2" }, { player: "Borduria", date: "1914-08-02" });
  applyFortifyOp(again.world, { op: "unfortify", id: "built-9" }, { player: "Aland", date: "1914-08-02" });
  applyFortifyOp(again.world, { op: "unfortify", id: "built-1" }, { player: "Aland", date: "1990-01-01" });
  applyFortifyOp(base, { op: "fortify", points: [[2.5, 53], [3.5, 53]], level: 5 }, { player: "Aland", date: "1914-08-01", chart });
  applyFortifyOp(base, { op: "fortify", points: [[4, 53], [5, 53]], level: 5 }, { player: "Aland", date: "1914-08-01", chart });
  applyFortifyOp(base, { op: "fortify", points, level: "", owner: "Borduria" }, { player: "Aland", date: "1914-08-01", chart });
  applyFortifyOp(null, { op: "fortify", points, level: 3 }, { player: "Aland", date: "x", chart });
});
