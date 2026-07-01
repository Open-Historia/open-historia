// Preset generator.
//
//   node scripts/presets/build-preset.mjs scripts/presets/wwii-1939.spec.mjs
//
// Reads a data-only era spec, compiles it against the REAL region catalog
// (regions.pmtiles), and writes a complete scenario folder under
// server/data/scenarios/<id>/ plus a manifest entry. Mirrors what
// createScenario + updateScenario would produce, and additionally writes
// colors.json (which the runtime needs for map fill but which the API can't set).

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { loadRegionCatalog, buildCountryRegionIndex } from "./lib/regionCatalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SCENARIOS_DIR = path.join(PROJECT_ROOT, "server", "data", "scenarios");
const DEFAULT_SCENARIO_DIR = path.join(SCENARIOS_DIR, "default");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "server", "data", "scenario-manifest.json");
const BASE_COLORS_PATH = path.join(PROJECT_ROOT, "public", "assets", "colors.json");

const hexToRgb = (hex) => {
  const h = String(hex).replace("#", "").trim();
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const writeJson = (filePath, value) => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const die = (msg) => {
  console.error(`\n[build-preset] ERROR: ${msg}\n`);
  process.exit(1);
};

const specArg = process.argv[2];
if (!specArg) die("usage: node scripts/presets/build-preset.mjs <spec.mjs>");
const specPath = path.resolve(process.cwd(), specArg);
if (!existsSync(specPath)) die(`spec not found: ${specPath}`);

const spec = (await import(pathToFileURL(specPath).href)).default;
if (!spec?.id) die("spec must export default with an `id`");

const catalog = await loadRegionCatalog();
const index = buildCountryRegionIndex(catalog);
const validGid1 = new Set(catalog.map((r) => r.GID_1));
const validGid0 = new Set(index.keys());

// ── 1. Validate spec references ───────────────────────────────────────────────
const polityCodes = new Set(Object.keys(spec.polities ?? {}));
const errors = [];

for (const [owner, gid0List] of Object.entries(spec.countryAssignments ?? {})) {
  if (!polityCodes.has(owner)) errors.push(`countryAssignments owner "${owner}" missing from polities`);
  for (const gid0 of gid0List) {
    if (!validGid0.has(gid0)) errors.push(`countryAssignments[${owner}] references unknown GID_0 "${gid0}"`);
  }
}
for (const [gid1, owner] of Object.entries(spec.regionAssignments ?? {})) {
  if (!validGid1.has(gid1)) errors.push(`regionAssignments references unknown GID_1 "${gid1}"`);
  if (!polityCodes.has(owner)) errors.push(`regionAssignments[${gid1}] owner "${owner}" missing from polities`);
}
if (errors.length) die(`spec validation failed:\n  - ${errors.join("\n  - ")}`);

// ── 2. Compose regionOwnershipOverrides (country-level, then region-level) ─────
const overrides = {};
for (const [owner, gid0List] of Object.entries(spec.countryAssignments ?? {})) {
  for (const gid0 of gid0List) {
    for (const gid1 of index.get(gid0) ?? []) overrides[gid1] = owner;
  }
}
for (const [gid1, owner] of Object.entries(spec.regionAssignments ?? {})) {
  overrides[gid1] = owner; // region-level wins
}

// ── 2b. countryNameOverrides so map labels read as era polities, not modern ────
// Start from any hand-authored labels in the spec (e.g. annexations). When
// `relabelOwnedCountries` is set, additionally label every whole-country grant
// with its polity name (e.g. Germany/Austria -> "Holy Roman Empire"). This is
// right for eras where modern names are wholesale anachronistic (1200), but is
// left off where modern names mostly still fit (1939) to avoid labelling every
// colony with its empire's name.
const countryNameOverrides = { ...(spec.meta?.countryNameOverrides ?? {}) };
if (spec.relabelOwnedCountries) {
  for (const [owner, gid0List] of Object.entries(spec.countryAssignments ?? {})) {
    const polityName = spec.polities?.[owner]?.name;
    if (!polityName) continue;
    for (const gid0 of gid0List) countryNameOverrides[gid0] = polityName;
  }
}

// ── 3. polityOverrides + colors.json ──────────────────────────────────────────
// colors.json fully REPLACES the base palette at runtime (it is not merged), so
// start from the curated base so independent countries keep their colors, then
// layer the era polities on top.
const baseColors = existsSync(BASE_COLORS_PATH) ? JSON.parse(readFileSync(BASE_COLORS_PATH, "utf8")) : {};
const polityOverrides = {};
const colors = { ...baseColors };
for (const [code, p] of Object.entries(spec.polities ?? {})) {
  polityOverrides[code] = {
    code,
    name: p.name ?? code,
    aliases: Array.isArray(p.aliases) ? p.aliases : [],
    color: p.color ?? "#888888",
    note: p.note ?? "",
  };
  colors[code] = hexToRgb(p.color ?? "#888888");
}

// ── 4. Emit scenario folder ───────────────────────────────────────────────────
const scenarioDir = path.join(SCENARIOS_DIR, spec.id);
mkdirSync(path.join(scenarioDir, "storage"), { recursive: true });
const now = new Date().toISOString();

const world = {
  regionOwnershipOverrides: overrides,
  polityOverrides,
  simulationRules: spec.simulationRules ?? "",
  startingTimelineText: spec.startingTimelineText ?? "",
};
writeJson(path.join(scenarioDir, "world.json"), world);
writeJson(path.join(scenarioDir, "colors.json"), colors);

writeJson(path.join(scenarioDir, "game.json"), {
  country: spec.game?.country ?? "",
  startDate: spec.game?.startDate ?? "",
  gameDate: spec.game?.gameDate ?? spec.game?.startDate ?? "",
  round: 1,
  difficulty: "standard",
  language: "English",
});

const m = spec.meta ?? {};
writeJson(path.join(scenarioDir, "scenario.json"), {
  accentColor: m.accentColor ?? "#7c3aed",
  coverImageContentType: null,
  countryNameOverrides,
  createdAt: now,
  description: m.description ?? "",
  eyebrow: m.eyebrow ?? "Historical Preset",
  heroSubtitle: m.heroSubtitle ?? "",
  heroTitle: m.heroTitle ?? m.name ?? spec.id,
  id: spec.id,
  name: m.name ?? spec.id,
  subtitle: m.subtitle ?? "",
  updatedAt: now,
});

for (const key of ["actions", "advisor", "chat", "events"]) {
  writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
}

// prompts.json copied verbatim from default (already templates ${startDate}).
copyFileSync(path.join(DEFAULT_SCENARIO_DIR, "prompts.json"), path.join(scenarioDir, "prompts.json"));

// ── 5. Register in manifest (idempotent) ──────────────────────────────────────
const manifest = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  : { activeScenarioId: "default", selectedScenarioId: "default", order: ["default"], version: 2 };
if (!manifest.order.includes(spec.id)) manifest.order.push(spec.id);
writeJson(MANIFEST_PATH, manifest);

// ── 6. Coverage report ────────────────────────────────────────────────────────
const perPolity = {};
for (const owner of Object.values(overrides)) perPolity[owner] = (perPolity[owner] ?? 0) + 1;
const assigned = Object.keys(overrides).length;
console.log(`\n[build-preset] "${spec.id}" written to ${path.relative(PROJECT_ROOT, scenarioDir)}`);
console.log(`  regions assigned: ${assigned}/${catalog.length} (${catalog.length - assigned} keep modern owner)`);
console.log(`  polities: ${Object.keys(polityOverrides).length}`);
console.log("  per-polity region counts:");
for (const [code, n] of Object.entries(perPolity).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(code).padEnd(7)} ${n}`);
}
console.log(`  manifest order: [${manifest.order.join(", ")}]\n`);
