import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { battlePrint, createPlainerPlanner, createPlanner, plainPlanner, standing, valueFeatures, withLateEval } from "../../../../../src/runtime/fronts/mind/planner.js";
import { labStaffPolicy, shippedPlannerParams } from "../../../../../src/runtime/fronts/mind/trained.js";
import { commanderOf } from "../../../../../src/runtime/fronts/mind/commanders.js";

const legend = { A: "Aland", B: "Borduria" };
const CITIES = [
  { name: "Aland Capital", lng: 21.5, lat: 51.25, population: 900000, capital: true },
  { name: "Westford", lng: 23.5, lat: 50.75, population: 60000 },
  { name: "Borduria Capital", lng: 26.5, lat: 51.25, population: 800000, capital: true },
  { name: "Eastmarch", lng: 24.5, lat: 50.25, population: 150000 },
];
const small = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities: CITIES, key: "planner" });
const wide = () => syntheticMap({
  layout: ["AAAAAAABBBBBBB", "AAAAAABBBBBBBB", "AAAAAAABBBBBBB", "AAAAABBBBBBBBB", "AAAAAAABBBBBBB", "AAAAAABBBBBBBB"],
  legend,
  west: 14,
  north: 53,
  step: 1,
  stepLat: 0.5,
  cities: [...CITIES, { name: "Northgate", lng: 16.5, lat: 52.75, population: 220000 }, { name: "Southmere", lng: 30.5, lat: 50.25, population: 120000 }],
  key: "planner-wide",
});
const MECHANICS = { fatigue: true, weather: true, supply: true, attrition: true };
const war = (world, extra = {}) => frontInput(world, { arenas: new Map(), staff: true, troops: 1, days: 12, strengthOf: () => 4, mechanics: MECHANICS, climateSeed: "planner", ...extra });

test("golden probes for the staff that looks ahead", () => {
  withLateEval([1, 2, "3", null]);
  plainPlanner();
  shippedPlannerParams();
  for (const sides of [[["Aland"], ["Borduria"]], [["Aland", "Carpathia"], ["Borduria"]]]) {
    for (const outcomes of [[], [{ winner: "Aland", loser: "Borduria" }], [{ winner: "Borduria", loser: "aland " }]]) {
      for (const difficulty of ["easy", "medium", "hard", "nonsense"]) {
        for (const players of [[], ["Borduria"], [" ALAND"]]) for (const side of [0, 1]) commanderOf({ sides, side, outcomes, difficulty, players });
      }
    }
  }
  const looking = (battle, side) => {
    standing(battle, side);
    valueFeatures(battle, side);
    battlePrint(battle);
    return undefined;
  };
  runFronts(war(small(), { days: 8, staffPolicy: looking }));
  runFronts(war(small(), { seed: "plain", staffPolicy: createPlanner() }));
  runFronts(war(small(), { seed: "plainer", staffPolicy: createPlainerPlanner() }));
  runFronts(war(small(), { seed: "replies", days: 6, staffPolicy: createPlanner({ replies: true, ahead: 3, refine: 2 }) }));
  runFronts(war(small(), { seed: "lab", players: ["Borduria"], staffPolicy: labStaffPolicy({ difficulty: "hard", players: ["Borduria"] }) }));
  runFronts(war(small(), { seed: "meant", staffPolicy: labStaffPolicy({ outcomes: [{ winner: "Borduria", loser: "Aland" }], difficulty: "medium" }) }));
  runFronts(war(small(), { seed: "plans", staffPolicy: createPlanner({ params: shippedPlannerParams(), plans: ["keep", "push", "a pincer", "the towns"], airControl: false, look: 3 }) }));
});

test("golden probes for whole wars led by the staff that looks ahead, as the game leads them", { skip: !process.env.GOLDEN_HEAVY }, () => {
  const days = Number(process.env.GOLDEN_HEAVY_DAYS) || 30;
  for (const [seed, world] of [["heavy-small", small()], ["heavy-wide", wide()], ["heavy-wide-2", wide()]]) {
    runFronts(war(world, { seed, days, staffPolicy: labStaffPolicy({ difficulty: "medium" }) }));
  }
  runFronts(war(wide(), { seed: "heavy-hard", days, players: ["Borduria"], staffPolicy: labStaffPolicy({ difficulty: "hard", players: ["Borduria"] }) }));
  runFronts(war(wide(), { seed: "heavy-meant", days, staffPolicy: labStaffPolicy({ outcomes: [{ winner: "Aland", loser: "Borduria" }] }) }));
});
