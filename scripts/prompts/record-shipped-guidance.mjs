/*! Open Historia — records the default guidance the game ships © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Records every default guidance passage this tree ships in
// src/Game/AI/shippedGuidance.js: the English defaults (promptGuidance.js over
// defaultPrompts.json) and every shipped translation of one
// (public/lang/prompts/<code>.json).
//
// The list only grows. A stored prompt pack holds the author's edits alone,
// but "Export all prompts" writes every passage, so a scenario that imported
// such a file stored the defaults of the version that made it as if the author
// had written them. normalizePackGuidance drops any passage recorded here, so
// that scenario, and every game played from it, runs the current defaults
// instead of pinning the old ones. For that, a later version has to recognise
// what every earlier one shipped: run this whenever a default passage or a
// prompt pack changes (promptGuidance.test.js fails until you do), and never
// remove a line from the list.
//
//   node scripts/prompts/record-shipped-guidance.mjs
//   node scripts/prompts/record-shipped-guidance.mjs --also passages.json
//
// --also records the passages in a JSON array of strings too: another
// branch's defaults, or older versions' (the list was seeded on 26 September
// 2026 with every passage alpha, beta and main had shipped since packs became
// guidance-only on 16 September 2026, and every translation of one).

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const LIST_FILE = path.join(ROOT, "src/Game/AI/shippedGuidance.js");

const { buildGuidanceDefaults, guidanceFingerprint } = await import(url.pathToFileURL(path.join(ROOT, "src/Game/AI/promptGuidance.js")).href);
const { SHIPPED_GUIDANCE_FINGERPRINTS } = await import(url.pathToFileURL(LIST_FILE).href);

const passages = [];
const walk = (value) => {
  if (typeof value === "string") {
    if (value.trim()) passages.push(value);
  } else if (value && typeof value === "object") Object.values(value).forEach(walk);
};
walk(buildGuidanceDefaults(JSON.parse(fs.readFileSync(path.join(ROOT, "src/Game/AI/defaultPrompts.json"), "utf8"))));
const english = passages.length;

const packDir = path.join(ROOT, "public/lang/prompts");
for (const file of fs.existsSync(packDir) ? fs.readdirSync(packDir) : []) {
  if (!file.endsWith(".json") || file === "catalog-en.json") continue;
  walk(JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8")));
}
const translated = passages.length - english;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--also" && args[i + 1]) walk(JSON.parse(fs.readFileSync(path.resolve(args[(i += 1)]), "utf8")));
}

const before = SHIPPED_GUIDANCE_FINGERPRINTS.size;
const all = [...new Set([...SHIPPED_GUIDANCE_FINGERPRINTS, ...passages.map(guidanceFingerprint)])].sort();
const lines = [];
for (let i = 0; i < all.length; i += 8) lines.push(`  "${all.slice(i, i + 8).join(" ")}",`);

const header = `/*! Open Historia — every default guidance passage the game has shipped © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Written by scripts/prompts/record-shipped-guidance.mjs; do not edit by hand,
// and never remove an entry. The fingerprints (guidanceFingerprint in
// promptGuidance.js) of every default guidance passage any version of the game
// has shipped, in English and in each shipped translation. A stored pack's
// passage that matches one is a copied default, not the author's writing, and
// gives way to the current default (normalizePackGuidance).
`;
fs.writeFileSync(
  LIST_FILE,
  `${header}const FINGERPRINTS = [\n${lines.join("\n")}\n].join(" ");\n\nexport const SHIPPED_GUIDANCE_FINGERPRINTS = new Set(FINGERPRINTS ? FINGERPRINTS.split(" ") : []);\n`.replace(/\n/g, "\r\n"),
);
console.log(`${english} English and ${translated} translated passages in this tree; ${all.length - before} new; ${all.length} recorded`);
