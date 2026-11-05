/*! Open Historia — the strategy network experiment: weights into the game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Writes a trained run's weights where the game can load them
// (src/runtime/fronts/mind/weights.js), for the lab's switch to use.
//
//   node tools/strategy-nn/export.mjs --name troops
//   node tools/strategy-nn/export.mjs --none      (takes them out again)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readWeights } from "../../src/runtime/fronts/mind/net.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1] ?? "1";
};
const target = path.join(here, "../../src/runtime/fronts/mind/weights.js");
const head = [
  "/*! Open Historia — battlefields and fronts: a trained staff's weights (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */",
  "// EXPERIMENT, in the lab only. Written by tools/strategy-nn/export.mjs from a",
  "// training run: do not edit by hand. null where no trained staff is shipped.",
];

if (args.includes("--none")) {
  fs.writeFileSync(target, `${head.join("\n")}\n\nexport const TRAINED_STAFF = null;\n`);
  console.log("no trained staff is shipped");
} else {
  const name = flag("name") ?? "troops";
  const file = path.join(here, "runs", name, flag("file") ?? "best.json");
  const packed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!readWeights(packed)) throw new Error(`${file} holds no weights this build can read`);
  // (What the league's trial said of it: its margin a war over the scripted staff, over always advancing, and over going for the cities troop by troop.)
  const kept = { run: name, round: packed.round ?? packed.gen ?? 0, score: packed.score ?? packed.validation ?? null, overStaff: packed.overStaff ?? null, overAdvance: packed.overAdvance ?? null, ...(packed.overCities !== undefined ? { overCities: packed.overCities } : {}), shape: packed.shape, prior: packed.prior ?? 0, drafts: packed.drafts === true, params: packed.params };
  fs.writeFileSync(target, `${head.join("\n")}\n\nexport const TRAINED_STAFF = ${JSON.stringify(kept)};\n`);
  console.log(`shipped runs/${name} (round ${kept.round}, ${packed.params.length} weights)`);
}
