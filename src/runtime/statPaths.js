/*! Open Historia — the figures a project or an agreement may move © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "AI decides freely, within bounds" (the owner, 2026-11-15). A project's
// effects, and an agreement's, are numbers on a country's sheet, and the model
// chooses which: ANY figure the sheet carries. The engine holds the size of each
// change by the KIND of figure it is (projectEngine.js STAT_BOUNDS), never which
// figures may be moved.
//
// What went wrong (a player, 2026-11-26: "a 100% sustainability goal will
// impact energy autonomy but not internal security, national stability,
// international reputation"): the model was given a grammar of paths
// ("stability, indices.<key>, customStats.<key> …") and left to guess the keys.
// On a sheet of the scenario's own (Modern Day 2026: nationalStability,
// internalSecurity … are customStats) it wrote the standard sheet's paths, and
// the engine, finding no such figure on completion, passed the effect over
// without a word. Now the paths are the sheet's own, listed from the scenario's
// stat definition and the country's sheet, and sent as the schema's enum where a
// request plans one country's effects: a path the sheet does not have cannot be
// written.
//
// One definition for projects and agreements alike (agreementEffects.js reads
// the same grammar). Pure, and loads in plain Node.

import { DEFAULT_STAT_INDEX_KEYS, flattenStatSheetRows, normalizeStatSheetDefinition } from "./statIndexDefinitions.js";

export const MILITARY_STAT_FIGURES = Object.freeze(["quality", "technology", "land", "sea", "air", "spending"]);
export const ECONOMY_RATE_FIGURES = Object.freeze(["gdpGrowth", "inflation", "unemployment", "budgetBalance"]);
// The standard sheet's economy, as an effect may move it.
export const ECONOMY_STAT_FIGURES = Object.freeze(["gdp", ...ECONOMY_RATE_FIGURES, "publicDebt"]);
const KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

// The grammar, for a request that is not given one country's own list (a time
// skip writing for many, a treaty line): every path an effect may name.
export const STAT_PATH_GRAMMAR = "stability, indices.<key>, military.<quality|technology|land|sea|air|spending>, "
  + "economy.<gdp|gdpGrowth|inflation|unemployment|budgetBalance|publicDebt>, population.total, customStats.<key> "
  + "(the keys are the sheet's own: a scenario with a sheet of its own keeps every figure it shows under customStats)";

// Every stat path a sheet of this scenario can carry, in the sheet's order:
//   definition   the scenario's stat sheet (statIndexDefinitions.js; null for the standard one)
//   sheet        the country's sheet as it stands, or null: its own figures are
//                added (an index or custom key the definition does not list, its
//                military figures), and, where it is given, a figure it has no
//                value for is left out, since there is nothing to move
// [{ path, label }]
export const statPathsOf = ({ definition = null, sheet = null } = {}) => {
  const read = normalizeStatSheetDefinition(definition);
  const out = [];
  const seen = new Set();
  const add = (path, label = "") => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, label: label || path });
  };
  const has = (head, key) => {
    if (!isRecord(sheet)) return true;
    if (head === "stability") return finite(sheet.stability);
    return isRecord(sheet[head]) && finite(sheet[head][key]);
  };
  if (read.custom) {
    for (const row of flattenStatSheetRows(read)) if (KEY.test(row.key) && has("customStats", row.key)) add(`customStats.${row.key}`, row.label);
  } else {
    if (has("stability")) add("stability", "Stability");
    const indexRows = flattenStatSheetRows(read).filter((row) => DEFAULT_STAT_INDEX_KEYS.includes(row.key));
    for (const row of indexRows) if (has("indices", row.key)) add(`indices.${row.key}`, row.label);
    for (const key of ECONOMY_STAT_FIGURES) if (has("economy", key)) add(`economy.${key}`);
    if (has("population", "total")) add("population.total");
  }
  if (isRecord(sheet)) {
    // Whatever the sheet itself carries that the definition does not list.
    if (!read.custom) for (const key of Object.keys(isRecord(sheet.indices) ? sheet.indices : {})) if (KEY.test(key) && finite(sheet.indices[key])) add(`indices.${key}`);
    for (const key of Object.keys(isRecord(sheet.customStats) ? sheet.customStats : {})) if (KEY.test(key) && finite(sheet.customStats[key])) add(`customStats.${key}`);
    for (const key of MILITARY_STAT_FIGURES) if (isRecord(sheet.military) && finite(sheet.military[key])) add(`military.${key}`);
  }
  return out;
};

// The same as the paths alone, for a schema's enum.
export const statPathEnum = (options) => statPathsOf(options).map((entry) => entry.path);

// A tool's schema with the stat paths of its effects (and yields) held to
// `paths`: every object property named `stat` under a property named
// `effects` or `yields` gets the enum. A copy; the tool passed is not changed.
// With no paths the tool is returned as it was.
export const withStatPathEnum = (tool, paths) => {
  const list = Array.isArray(paths) ? [...new Set(paths.filter((path) => typeof path === "string" && path))] : [];
  if (!list.length || !isRecord(tool)) return tool;
  const walk = (node, underEffects = false) => {
    if (Array.isArray(node)) return node.map((item) => walk(item, underEffects));
    if (!isRecord(node)) return node;
    const copy = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && isRecord(value)) {
        copy.properties = Object.fromEntries(Object.entries(value).map(([name, schema]) => {
          if (underEffects && name === "stat" && isRecord(schema)) return [name, { ...schema, type: "string", enum: list }];
          return [name, walk(schema, underEffects || name === "effects" || name === "yields")];
        }));
      } else {
        copy[key] = walk(value, underEffects);
      }
    }
    return copy;
  };
  return walk(tool);
};

// The figures of a sheet as a request is told them: "path value" each, or a
// line saying the sheet has not been read yet.
export const describeStatPaths = ({ definition = null, sheet = null } = {}) => {
  if (!isRecord(sheet)) return "";
  return statPathsOf({ definition, sheet }).map(({ path, label }) => {
    const [head, key] = path.split(".");
    const value = head === "stability" ? sheet.stability : sheet[head]?.[key];
    return `${path}${label && label !== path ? ` (${label})` : ""} ${value}`;
  }).join(", ");
};
