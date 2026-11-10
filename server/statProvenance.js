/*! Open Historia — bounded statistic origins shared by both stores and the client, AGPL-3.0-or-later. */
// Origins describe where a number was recorded, never its historical accuracy.
export const STAT_SOURCES = Object.freeze(["scenario", "manual", "ai", "calculated"]);
const SOURCES = new Set(STAT_SOURCES);
const GROUPS = new Set(["indices", "population", "economy", "gdpBreakdown", "military", "customStats"]);
const MAX_ENTRIES = 160;
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const number = (v) => (typeof v === "number" || (typeof v === "string" && v.trim())) && Number.isFinite(Number(v)) ? Number(v) : null;
const pathAllowed = (path) => ["stability", "intelligenceService", "warWeariness", "warResources"].includes(path) || /^(indices|population|economy|gdpBreakdown|military|customStats)\.[A-Za-z][A-Za-z0-9]{0,39}$/.test(path);

export const statNumericValues = (sheet) => {
  const out = {};
  if (!record(sheet)) return out;
  const stability = number(sheet.stability);
  if (stability !== null) out.stability = stability;
  for (const group of GROUPS) {
    if (!record(sheet[group])) continue;
    for (const [key, raw] of Object.entries(sheet[group])) {
      const path = `${group}.${key}`;
      const value = number(raw);
      if (pathAllowed(path) && value !== null) out[path] = value;
    }
  }
  return out;
};

const validDate = (date) => {
  if (typeof date !== "string") return false;
  const match = /^(-?)(\d{4,6})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (!year || month < 1 || month > 12 || day < 1) return false;
  // BC calendar years have no zero, as in runtime/gameDates.js.
  const astronomical = match[1] ? 1 - year : year;
  const leap = astronomical % 4 === 0 && (astronomical % 100 !== 0 || astronomical % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
};

export const statOrigin = (source, { date, round } = {}) => {
  if (!SOURCES.has(source)) return null;
  const out = { source };
  // Writers supply game dates, including BC dates. Never invent a date for a legacy value.
  if (validDate(date)) out.date = date;
  if (Number.isSafeInteger(round) && round >= 0) out.round = round;
  return out;
};

export const normalizeStatProvenance = (input, values = null) => {
  if (!record(input)) return undefined;
  const out = {};
  for (const [path, entry] of Object.entries(input)) {
    if (!pathAllowed(path) || !record(entry)) continue;
    const value = number(entry.value);
    const origin = statOrigin(entry.source, entry);
    if (value === null || !origin) continue;
    // Live ratings, war ledgers, and scenario military fields are bound by their consumers.
    if (values && !["intelligenceService", "warWeariness", "warResources"].includes(path) && !(path.startsWith("military.") && !Object.hasOwn(values, path)) && values[path] !== value) continue;
    out[path] = { ...origin, value };
    if (Object.keys(out).length >= MAX_ENTRIES) break;
  }
  return Object.keys(out).length ? out : undefined;
};

export const provenanceForStat = (provenance, path, value) => {
  const numeric = number(value);
  if (!pathAllowed(path) || numeric === null) return null;
  let entry = provenance?.[path];
  if (record(provenance?.fields) && Array.isArray(provenance?.origins)) {
    const index = provenance.fields[path];
    if (!Number.isInteger(index) || index < 0 || index >= MAX_ENTRIES) return null;
    entry = { ...provenance.origins[index], value: numeric };
  }
  if (!record(entry) || entry.value !== numeric) return null;
  const origin = statOrigin(entry.source, entry);
  return origin ? { ...origin, value: numeric } : null;
};

export const mergeStatProvenance = (base, patch, result, origin = null) => {
  const values = statNumericValues(result);
  const before = statNumericValues(base);
  const out = normalizeStatProvenance({ ...base?.statProvenance, ...patch?.statProvenance }, values) || {};
  const trustedOrigin = statOrigin(origin?.source, origin || {});
  for (const [path, value] of Object.entries(values)) {
    if (before[path] === value) continue;
    if (trustedOrigin) out[path] = { ...trustedOrigin, value };
    else if (out[path]?.value !== value) delete out[path];
  }
  return Object.keys(out).length ? out : undefined;
};

// Only a newly created game gets scenario attribution. Clones/imports preserve
// their existing origins; merely opening an old save never labels its numbers.
export const seedScenarioStatProvenance = (world, game = {}) => {
  if (!record(world)) return world;
  const sheets = { ...world.countryStats };
  const warEntries = (field) => Array.isArray(world[field]) ? world[field] : [];
  const names = new Set([...Object.keys(sheets), ...Object.keys(world.intelligence || {}), ...Object.keys(world.polityOverrides || {}), ...warEntries("warWeariness").map((entry) => entry?.country).filter(Boolean), ...warEntries("warResources").map((entry) => entry?.country).filter(Boolean)]);
  for (const name of names) {
    const sheet = { ...sheets[name] };
    const authoredMilitary = statNumericValues({ military: world.polityOverrides?.[name]?.military });
    const values = { ...authoredMilitary, ...statNumericValues(sheet) };
    const intelligence = number(world.intelligence?.[name]);
    if (intelligence !== null) values.intelligenceService = intelligence;
    for (const field of ["warWeariness", "warResources"]) {
      const value = number(warEntries(field).find((entry) => entry?.country === name)?.value);
      if (value !== null) values[field] = value;
    }
    const entries = normalizeStatProvenance(sheet.statProvenance, values) || {};
    const origin = statOrigin("scenario", { date: game.gameDate || game.startDate, round: game.round });
    for (const [path, value] of Object.entries(values)) {
      if (!provenanceForStat(entries, path, value)) entries[path] = { ...origin, value };
    }
    if (Object.keys(entries).length) sheet.statProvenance = entries;
    if (Object.keys(sheet).length) Object.defineProperty(sheets, name, { value: sheet, enumerable: true, configurable: true, writable: true });
  }
  return Object.keys(sheets).length || Object.hasOwn(world, "countryStats") ? { ...world, countryStats: sheets } : world;
};

// History already stores the numbers. Intern repeated source/date/turn triples
// once per snapshot instead of repeating a full metadata object for every metric.
export const packStatProvenance = (input, values) => {
  let entries = input;
  if (record(input?.fields) && Array.isArray(input?.origins)) {
    entries = {};
    for (const [path, index] of Object.entries(input.fields).slice(0, MAX_ENTRIES)) {
      if (!Number.isInteger(index) || index < 0 || index >= MAX_ENTRIES) continue;
      const origin = input.origins[index];
      if (Object.hasOwn(values, path) && record(origin)) entries[path] = { ...origin, value: values[path] };
    }
  }
  const normalized = normalizeStatProvenance(entries, values);
  if (!normalized) return undefined;
  const origins = [];
  const fields = {};
  const byOrigin = new Map();
  for (const [path, entry] of Object.entries(normalized)) {
    if (!Object.hasOwn(values, path)) continue;
    const origin = statOrigin(entry.source, entry);
    const key = JSON.stringify(origin);
    if (!byOrigin.has(key)) { byOrigin.set(key, origins.length); origins.push(origin); }
    fields[path] = byOrigin.get(key);
  }
  return Object.keys(fields).length ? { origins, fields } : undefined;
};

export const recordExternalStatOrigin = (world, name, value, origin, path = "intelligenceService") => {
  const trusted = statOrigin(origin?.source, origin || {});
  const numeric = number(value);
  if (!trusted || numeric === null || !pathAllowed(path)) return;
  if (!record(world.countryStats)) world.countryStats = {};
  const sheet = world.countryStats[name] || {};
  Object.defineProperty(world.countryStats, name, { value: { ...sheet, statProvenance: {
    ...sheet.statProvenance, [path]: { ...trusted, value: numeric },
  } }, enumerable: true, configurable: true, writable: true });
};

// Only the native turn's actual ledger changes receive calculated origins.
// Existing/imported ledger values are not reclassified simply because they exist.
export const recordNativeWarOrigins = (before, after, context) => {
  let next = after;
  for (const [field, fallback] of [["warWeariness", 0], ["warResources", 100]]) {
    const old = new Map((Array.isArray(before?.[field]) ? before[field] : []).map((entry) => [entry.country, entry.value]));
    const current = new Map((Array.isArray(after?.[field]) ? after[field] : []).map((entry) => [entry.country, entry.value]));
    for (const name of new Set([...old.keys(), ...current.keys()])) {
      if (!name || number(old.get(name) ?? fallback) === number(current.get(name) ?? fallback)) continue;
      if (next === after) next = { ...after, countryStats: { ...after.countryStats } };
      recordExternalStatOrigin(next, name, current.get(name) ?? fallback, { ...context, source: "calculated" }, field);
    }
  }
  return next;
};
