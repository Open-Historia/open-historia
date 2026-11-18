import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { enlarge, frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { normalizeScenarioFronts, scenarioFrontWars } from "../../../../../src/runtime/fronts/scenarioFronts.js";

const DRAGON = { id: "dragon", name: "Dragon", base: "air", attack: 5, toughness: 4, speed: 2, icon: "", note: "", owners: [] };
const ELEPHANTS = { id: "war-elephants", name: "War Elephants", base: "armor", attack: 5, toughness: 3, speed: 2, icon: "", note: "", owners: [] };

test("golden probes: a scenario's own unit types in the sky", () => {
  const world = syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB"], legend: { A: "Aland", B: "Borduria" }, west: 20, north: 52, step: 1, stepLat: 0.5, key: "golden-types-sky" });
  const wing = (id, ownerCode, extra = {}) => ({ id, name: id, type: "air", ownerCode, strength: 60, lng: ownerCode === "Aland" ? 21 : 27, lat: 51, ...extra });
  const sky = (probe, extra) => runFronts(frontInput(world, { arenas: new Map(), troops: 0.5, days: 3, strengthOf: () => 4, mechanics: { air: true }, [probe]: 1, ...extra }));
  sky("goldenTypesSky", { units: [wing("aland-wing", "Aland", { unitType: "dragon" }), wing("borduria-wing", "Borduria")], unitTypes: [DRAGON] });
  sky("goldenTypesSkyOld", { era: 0, units: [wing("aland-wing", "Aland", { unitType: "dragon" }), wing("borduria-wing", "Borduria")], unitTypes: [DRAGON] });
  sky("goldenTypesSkyGrounded", { mechanics: { air: true, military: true }, militaryOf: (name) => (name === "Aland" ? { air: 0 } : null), units: [wing("aland-wing", "Aland", { unitType: "dragon" }), wing("borduria-wing", "Borduria", { unitType: "nothing" })], unitTypes: [DRAGON] });
});

test("golden probes: a scenario's own unit types on the ground", () => {
  const world = syntheticMap({
    layout: enlarge(["AAABBB", "AAABBB", "AAABBB", "~~~~~~"], 2),
    legend: { A: "Aland", B: "Borduria", "~": null },
    west: 20,
    north: 52,
    step: 0.25,
    cities: [{ name: "Alba", lng: 20.6, lat: 51.4, capital: true }, { name: "Brod", lng: 21.3, lat: 51.2, capital: true }],
  });
  const tanks = (extra = {}) => ({ id: "unit-1", name: "1st Guards", type: "armor", ownerCode: "Aland", strength: 80, lng: 20.7, lat: 51.6, unitType: "war-elephants", ...extra });
  const advance = [{ day: 0, type: "order", battlefield: "Aland - Borduria front", side: "Aland", order: "advance", sector: "all" }];
  const fight = (probe, extra) => runFronts(frontInput(world, { days: 4, moments: advance, [probe]: 1, ...extra }));
  const opened = fight("goldenTypesLand", { units: [tanks()], unitTypes: [ELEPHANTS] });
  fight("goldenTypesMorning", { units: [tanks()], unitTypes: [ELEPHANTS], mechanics: { fatigue: true, weather: true }, climateSeed: "seed" });
  const record = opened.battlefields[0];
  if (record) fight("goldenTypesLoad", { battlefields: opened.battlefields, units: [tanks({ committedTo: record.name })], unitTypes: [ELEPHANTS], fromDate: "2024-03-05", moments: [] });
});

test("golden probes: a whole coalition, and a war renewed under an id of its own", () => {
  const allies = Array.from({ length: 10 }, (_, index) => `Ally ${index + 1}`);
  const keys = "123456789a";
  const legend = { ...Object.fromEntries([...keys].map((key, index) => [key, allies[index]])), B: "Borduria", "~": null };
  const world = syntheticMap({ layout: [...keys].map((key) => `${key.repeat(2)}BBB`), legend, west: 10, north: 50, step: 1, stepLat: 0.25, key: "golden-coalition" });
  const war = { id: "war-10", title: "The Ten", status: "active", sideA: allies, sideB: ["Borduria"] };
  const first = runFronts(frontInput(world, { wars: [war], days: 2, goldenCoalition: 1 }));
  runFronts(frontInput(world, { wars: [war], days: 1, battlefields: first.battlefields, goldenCoalitionAgain: 1 }));

  const pair = syntheticMap({ layout: ["AAABBB", "AAABBB"], legend: { A: "Aland", B: "Borduria" }, west: 20, north: 51, step: 1, stepLat: 0.5, key: "golden-renewed" });
  const ended = { id: "war-aland-borduria-2024-03-03", title: "", status: "ended", sideA: ["Aland"], sideB: ["Borduria"] };
  runFronts(frontInput(pair, { wars: [ended], days: 3, goldenRenewed: 1, moments: [{ day: 2, type: "order", battlefield: "border: Aland / Borduria", side: "Aland", order: "advance", sector: "all", effort: "major", ref: 2 }] }));

  const fronts = normalizeScenarioFronts([{ name: "The Alba Front", sides: [["Aland"], ["Borduria"]], war: true, troops: [0, 0], stance: ["advance", "hold"], generals: [[], []] }]);
  scenarioFrontWars(fronts, [{ id: "war-scenario-front-1", status: "ended", sideA: ["Aland"], sideB: ["Borduria"] }, { id: "war-scenario-front-1-r2", status: "ended", sideA: ["X"], sideB: ["Y"] }], "1916-07-01");
});
