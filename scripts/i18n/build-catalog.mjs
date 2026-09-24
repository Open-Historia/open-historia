/*! Open Historia — language-pack catalogs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Writes the English catalogs the shipped language packs translate:
//
//   public/lang/catalog-en.json          every fixed interface string, read out
//                                        of the source (extractStrings.mjs),
//                                        plus every stock country name and the
//                                        preset scenarios' card text;
//   public/lang/prompts/catalog-en.json  every guidance passage of the default
//                                        prompts (promptGuidance.js), which the
//                                        packs carry translated too.
//
// Patterns (text built at render time) sit in the interface catalog with their
// slots in double braces: "{{count}} events".
//
// One catalog serves every branch. The branches' interfaces differ, so pass
// each other branch's tree with --also and the catalog is their union; the
// same packs can then ship everywhere:
//
//   node scripts/i18n/build-catalog.mjs
//   node scripts/i18n/build-catalog.mjs --also ../beta-checkout --also ../main-checkout
//
// A tree given with --also needs only its src/ (and scripts/presets/ for the
// scenario cards): `git archive origin/beta src scripts/presets | tar -x -C dir`.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { extractTree } from "./extractStrings.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const LANG_DIR = path.join(ROOT, "public", "lang");

const args = process.argv.slice(2);
const also = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--also" && args[i + 1]) also.push(path.resolve(args[(i += 1)]));
}
const roots = [ROOT, ...also];

// Card text of the preset scenarios: the fields a scenario card renders.
const specStrings = (root) => {
  const dir = path.join(root, "scripts", "presets");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".spec.mjs")) continue;
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/\b(?:name|description|subtitle|eyebrow|heroTitle|heroSubtitle)\s*:\s*"((?:[^"\\]|\\.)+)"/g)) {
      out.push(JSON.parse(`"${match[1]}"`));
    }
  }
  return out;
};

// The built-in scenarios' own polities (server/seed/<id>/world.json): their
// names and aliases are the game's own text, on the map from the first boot,
// and many are not stock names ("Nauru", "Transnistria", "Republic of Poland").
const seedPolityNames = (root) => {
  const dir = path.join(root, "server", "seed");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const seed of fs.readdirSync(dir)) {
    const file = path.join(dir, seed, "world.json");
    if (!fs.existsSync(file)) continue;
    let world;
    try {
      world = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const [key, polity] of Object.entries(world?.polityOverrides ?? {})) {
      for (const name of [key, polity?.name, polity?.mapLabel, ...(Array.isArray(polity?.aliases) ? polity.aliases : [])]) {
        if (typeof name === "string" && name.trim()) out.push(name.trim());
      }
    }
  }
  return out;
};

// Every stock country's name, from the shipped countries archive.
const countryNames = async () => {
  try {
    const { loadCountryCatalog } = await import(url.pathToFileURL(path.join(ROOT, "scripts/presets/lib/regionCatalog.mjs")));
    return (await loadCountryCatalog()).map((entry) => entry.COUNTRY).filter(Boolean);
  } catch (error) {
    console.warn(`  country names skipped (${error.message}); the previous catalog's are kept`);
    return null;
  }
};

const guidancePassages = async (root) => {
  const guidanceFile = path.join(root, "src/Game/AI/promptGuidance.js");
  const promptsFile = path.join(root, "src/Game/AI/defaultPrompts.json");
  if (!fs.existsSync(guidanceFile) || !fs.existsSync(promptsFile)) return [];
  const { buildGuidanceDefaults } = await import(url.pathToFileURL(guidanceFile));
  const defaults = buildGuidanceDefaults(JSON.parse(fs.readFileSync(promptsFile, "utf8")));
  const out = [];
  const walk = (value) => {
    if (typeof value === "string") {
      if (value.trim()) out.push(value);
    } else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(defaults);
  return out;
};

const main = async () => {
  const strings = new Set();
  let patternCount = 0;
  for (const root of roots) {
    const { exact, patterns, errors } = extractTree(root);
    errors.forEach((error) => console.warn(`  parse error: ${error}`));
    exact.forEach((_, text) => strings.add(text));
    patterns.forEach((_, text) => strings.add(text));
    patternCount += patterns.size;
    specStrings(root).forEach((text) => strings.add(text));
    seedPolityNames(root).forEach((text) => strings.add(text));
    console.log(`  ${path.relative(ROOT, root) || "."}: ${exact.size} strings, ${patterns.size} patterns`);
  }

  const countries = await countryNames();
  if (countries) countries.forEach((name) => strings.add(name));
  else {
    // Keep the previous catalog's names rather than dropping them.
    try {
      for (const entry of JSON.parse(fs.readFileSync(path.join(LANG_DIR, "catalog-en.json"), "utf8"))) {
        if (typeof entry === "string" && /^[A-Z]/.test(entry) && !entry.includes("{{") && entry.length < 60) strings.add(entry);
      }
    } catch { /* first run */ }
  }

  const catalog = [...strings].map((s) => s.trim()).filter((s) => s.length > 1 && /[A-Za-z]{2}/.test(s)).sort();
  fs.mkdirSync(LANG_DIR, { recursive: true });
  fs.writeFileSync(path.join(LANG_DIR, "catalog-en.json"), `${JSON.stringify([...new Set(catalog)], null, 1)}\n`);
  const patterns = catalog.filter((s) => s.includes("{{")).length;
  console.log(`catalog-en.json: ${catalog.length} strings (${patterns} of them patterns)`);

  const passages = new Set();
  for (const root of roots) (await guidancePassages(root)).forEach((text) => passages.add(text));
  const promptDir = path.join(LANG_DIR, "prompts");
  fs.mkdirSync(promptDir, { recursive: true });
  const promptCatalog = [...passages].sort();
  fs.writeFileSync(path.join(promptDir, "catalog-en.json"), `${JSON.stringify(promptCatalog, null, 1)}\n`);
  console.log(`prompts/catalog-en.json: ${promptCatalog.length} guidance passages, ${promptCatalog.join("").length} characters`);
  void patternCount;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
