/*! Open Historia — the strategy network experiment: a look at a few wars © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Fights a few scenarios with the scripted staff on both sides, and with the
// habit of always advancing against it, and prints what each came to.
//
//   node tools/strategy-nn/peek.mjs <first seed> <how many>

import { HABITS, REWARD_PARTS, fight, makeScenario, match } from "./arena.mjs";

const fmt = (value) => (Math.round(value * 100) / 100).toFixed(2).padStart(6);
const from = Number(process.argv[2] ?? 1);
const count = Number(process.argv[3] ?? 8);
const started = Date.now();
let total = 0;
for (let seed = from; seed < from + count; seed += 1) {
  const scenario = makeScenario(seed);
  const at = Date.now();
  const war = fight(scenario, [null, null]);
  const ms = Date.now() - at;
  const versus = match(scenario, HABITS.advance, null);
  total += versus.margin;
  const teams = scenario.teams.map((members) => members.map((index) => `${scenario.countries[index][0]}${scenario.weights[index]}`).join("+")).join(" v ");
  console.log(`#${String(seed).padStart(3)} ${scenario.layout[0].length}x${scenario.layout.length}@${scenario.step} ${scenario.year} ${teams.padEnd(18)} ${scenario.kind.padEnd(38)} ${scenario.periods}mo ${String(ms).padStart(5)}ms`);
  console.log(`      staff v staff: ${war.rewards.map(fmt).join(" /")}   began: ${REWARD_PARTS.map((key) => `${key} ${fmt(war.parts[0][key])}`).join(" ")}`);
  console.log(`      always advancing against the scripted staff, each leading each team once: margin ${fmt(versus.margin)}`);
}
console.log(`mean margin of always advancing over the scripted staff: ${fmt(total / count)} a scenario, in ${Date.now() - started} ms`);
