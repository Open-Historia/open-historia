/*! Open Historia — preset generator (incl. tier-2 geometry) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
const REGIONS_SEED_PATH = path.join(PROJECT_ROOT, "public", "assets", "regions-seed.geojson");

const hexToRgb = (hex) => {
  const h = String(hex).replace("#", "").trim();
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

// Deterministic pleasant color from a code — mirrors the game's procedural fill
// fallback, so owners without a curated color still get a stable, distinct tone.
const codeToColor = (code) => {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = 0.5;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.25;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

const writeJson = (filePath, value) => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const die = (msg) => {
  console.error(`\n[build-preset] ERROR: ${msg}\n`);
  process.exit(1);
};

// ── Era cities ────────────────────────────────────────────────────────────────
// spec.cities: [[name, at, tier, population], ...] where `at` is either the
// MODERN name of the place in cities-seed.json (coords resolved from the seed,
// e.g. ["Constantinople", "Istanbul", 4, 200000]) or explicit [lng, lat] for
// places with no modern successor (Karakorum, Cahokia...). tier drives when the
// city appears on the game map (4 = great-power capital ★, 3 = major city ◆,
// 2 = city, 1 = town); population is the historical estimate.
const CITIES_SEED_PATH = path.join(PROJECT_ROOT, "public", "assets", "cities-seed.json");

const buildCityLookup = () => {
  const seed = JSON.parse(readFileSync(CITIES_SEED_PATH, "utf8"));
  const byName = new Map();
  for (const c of seed) {
    if (!Array.isArray(c.coord) || c.coord[0] == null || c.coord[1] == null) continue;
    const key = String(c.name || "").toLowerCase();
    if (!key) continue;
    const prev = byName.get(key);
    // Same-named places (Paris, Texas...) resolve to the most populous one.
    if (!prev || (c.population || 0) > (prev.population || 0)) byName.set(key, c);
  }
  return byName;
};

const compileCities = (spec) => {
  if (!Array.isArray(spec.cities) || !spec.cities.length) return null;
  const lookup = buildCityLookup();
  const features = [];
  const cityErrors = [];
  for (const entry of spec.cities) {
    const [name, at, tier = 2, population = 0] = entry;
    let coord = null;
    if (Array.isArray(at)) {
      coord = [Number(at[0]), Number(at[1])];
    } else {
      const hit = lookup.get(String(at).toLowerCase());
      if (!hit) {
        cityErrors.push(`city "${name}": modern place "${at}" not found in cities-seed.json`);
        continue;
      }
      coord = [hit.coord[0], hit.coord[1]];
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coord },
      properties: {
        city: String(name),
        population: Number(population) || 0,
        capital: tier >= 4 ? "primary" : "",
        tier: Number(tier) || 2,
      },
    });
  }
  if (cityErrors.length) die(`spec city validation failed:\n  - ${cityErrors.join("\n  - ")}`);
  return { type: "FeatureCollection", features };
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

const cityCollection = compileCities(spec);

const world = {
  regionOwnershipOverrides: overrides,
  polityOverrides,
  // Tier-2: render the era from per-region geometry (see regions.geojson below)
  // so the map shows accurate per-region ownership — the stock pmtiles only fill
  // whole countries by GID_0 and cannot depict era borders inside a country.
  customRegions: true,
  // Era-accurate cities (cities.geojson) replace the modern city labels — no
  // St. Petersburg in 117 AD, no Istanbul in 1200.
  ...(cityCollection ? { customCities: true } : {}),
  // Era-appropriate deployable troop types (e.g. no Air Force in 1200).
  ...(Array.isArray(spec.allowedUnitTypes) ? { allowedUnitTypes: spec.allowedUnitTypes } : {}),
  simulationRules: spec.simulationRules ?? "",
  startingTimelineText: spec.startingTimelineText ?? "",
};

// ── regions.geojson (tier-2 custom geometry) ─────────────────────────────────
// Clone the seeded world geometry and stamp each region's era owner: the preset
// override where one exists, otherwise the region's own modern country so the
// whole map stays coloured. Written compact — pretty-printing 3.6k polygons is
// tens of MB.
const seedFc = JSON.parse(readFileSync(REGIONS_SEED_PATH, "utf8"));
// The seed geojson carries more regions than the pmtiles catalog (e.g. city
// regions like Sevastopol). Those miss the per-GID_1 overrides, so whole-country
// grants must also resolve by GID_0 or they leak their modern owner.
const gid0Owner = {};
for (const [owner, gid0List] of Object.entries(spec.countryAssignments ?? {})) {
  for (const gid0 of gid0List) gid0Owner[gid0] = owner;
}
const regionFeatures = [];
for (const feature of seedFc.features ?? []) {
  const props = feature.properties ?? {};
  const gid1 = props.id != null ? String(props.id) : "";
  if (!gid1 || !feature.geometry) continue;
  const gid0 = props.gid0 ? String(props.gid0) : "";
  // Ownership of regions the spec does NOT assign depends on the era: ancient/
  // medieval presets leave them UNCLAIMED (many countries simply did not exist),
  // while near-modern presets (spec.unassignedKeepModernOwner) keep the modern
  // sovereign — Mexico or Turkey in 1939 were real states, not empty land.
  // Antarctica stays unclaimed in every era.
  const fallbackOwner =
    spec.unassignedKeepModernOwner && gid0 && gid0 !== "ATA" ? gid0 : "";
  regionFeatures.push({
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      id: gid1,
      owner: overrides[gid1] ?? gid0Owner[gid0] ?? fallbackOwner,
      gid0,
      name: props.name ? String(props.name) : "",
      country: props.country ? String(props.country) : "",
      typeId: "land",
    },
  });
}

// The playable factions in this scenario (drives the start-country picker):
// every distinct owner actually present on the finished map — era polities plus,
// on near-modern presets, the independent countries that kept their modern owner.
world.ownerCodes = [...new Set(regionFeatures.map((f) => f.properties.owner).filter(Boolean))].sort();
writeJson(path.join(scenarioDir, "world.json"), world);

// Guarantee a color for every owner in the map (curated where known, else a
// stable procedural tone) so no region renders on the client's gray fallback.
for (const feature of regionFeatures) {
  const owner = feature.properties.owner;
  if (owner && !colors[owner]) colors[owner] = codeToColor(owner);
}
writeJson(path.join(scenarioDir, "colors.json"), colors);
writeFileSync(
  path.join(scenarioDir, "regions.geojson"),
  JSON.stringify({ type: "FeatureCollection", features: regionFeatures }),
  "utf8",
);

if (cityCollection) {
  writeJson(path.join(scenarioDir, "cities.geojson"), cityCollection);
}

writeJson(path.join(scenarioDir, "game.json"), {
  country: spec.game?.country ?? "",
  startDate: spec.game?.startDate ?? "",
  gameDate: spec.game?.gameDate ?? spec.game?.startDate ?? "",
  round: 1,
  difficulty: "standard",
  language: "English",
});

// Scenario cover image: meta.coverImage points at a project-relative jpg (we
// reuse the era-matched loading-screen art). Copied into the scenario so the
// library card shows it; survives regeneration because it lives in the spec.
const m = spec.meta ?? {};
let coverContentType = null;
if (m.coverImage) {
  const coverSrc = path.resolve(PROJECT_ROOT, m.coverImage);
  if (existsSync(coverSrc)) {
    copyFileSync(coverSrc, path.join(scenarioDir, "cover-image.bin"));
    coverContentType = "image/jpeg";
  } else {
    console.warn(`[build-preset] coverImage not found: ${coverSrc}`);
  }
}

writeJson(path.join(scenarioDir, "scenario.json"), {
  accentColor: m.accentColor ?? "#7c3aed",
  coverImageContentType: coverContentType,
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
console.log(`  regions.geojson: ${regionFeatures.length} features (customRegions=true, tier-2 render)`);
if (cityCollection) {
  console.log(`  cities.geojson: ${cityCollection.features.length} era cities (customCities=true)`);
}
console.log(`  polities: ${Object.keys(polityOverrides).length}`);
console.log("  per-polity region counts:");
for (const [code, n] of Object.entries(perPolity).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(code).padEnd(7)} ${n}`);
}
console.log(`  manifest order: [${manifest.order.join(", ")}]\n`);
