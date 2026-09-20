/*! Open Historia — scenario-defined national Stats sheet definitions © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
export const STAT_SHEET_VERSION = 2;
export const MAX_STAT_INDICES = 12;
export const MAX_STAT_SECTIONS = 12;
export const MAX_STATS_PER_SECTION = 20;
export const MAX_CUSTOM_STATS = 60;
export const STAT_INDEX_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
export const STAT_KINDS = Object.freeze(["index", "number", "percentage", "currency"]);

export const DEFAULT_STAT_INDEX_ROWS = Object.freeze([
  Object.freeze({ key: "sovereignty", label: "Sovereignty", kind: "index", icon: "⚑", color: "#f97316", description: "Practical political sovereignty and freedom of action." }),
  Object.freeze({ key: "foodAutonomy", label: "Food autonomy", kind: "index", icon: "🌾", color: "#22c55e", description: "Ability to meet food needs without vulnerable external supply." }),
  Object.freeze({ key: "energyAutonomy", label: "Energy autonomy", kind: "index", icon: "⚡", color: "#eab308", description: "Ability to meet energy needs without vulnerable external supply." }),
  Object.freeze({ key: "economicIndependence", label: "Economic independence", kind: "index", icon: "🏦", color: "#06b6d4", description: "Economic resilience and freedom from external dependency." }),
  Object.freeze({ key: "internalSecurity", label: "Internal security", kind: "index", icon: "🛡", color: "#f43f5e", description: "Domestic security, institutional control, and resistance to internal disruption." }),
  Object.freeze({ key: "internationalReputation", label: "International reputation", kind: "index", icon: "🤝", color: "#3b82f6", description: "International trust, legitimacy, and standing." }),
]);

export const DEFAULT_STAT_INDEX_KEYS = Object.freeze(DEFAULT_STAT_INDEX_ROWS.map((row) => row.key));

// A custom sheet deliberately converts the current modern layout into generic,
// scenario-owned values. The untouched standard sheet still uses the audited
// native population/economy pipeline; once an author customizes the sheet these
// rows become ordinary era-agnostic stats and may be deleted/replaced freely.
export const DEFAULT_CUSTOM_STAT_SECTIONS = Object.freeze([
  Object.freeze({
    key: "national",
    label: "National",
    icon: "◈",
    stats: Object.freeze([
      Object.freeze({ key: "nationalStability", label: "National stability", kind: "index", icon: "⚖", color: "#22c55e", description: "Overall political and social stability." }),
      Object.freeze({ key: "intelligenceService", label: "Intelligence service", kind: "index", icon: "♟", color: "#38bdf8", description: "Capability of the polity's intelligence and counter-intelligence apparatus." }),
    ]),
  }),
  Object.freeze({ key: "strategic", label: "Strategic indices", icon: "⚑", stats: DEFAULT_STAT_INDEX_ROWS }),
  Object.freeze({
    key: "population",
    label: "Population",
    icon: "♟",
    stats: Object.freeze([
      Object.freeze({ key: "totalPopulation", label: "Total population", kind: "number", icon: "♟", color: "#94a3b8", unit: "people", compact: true, decimals: 0, minimum: 0, description: "Population represented by this polity in the scenario's own accounting terms." }),
    ]),
  }),
  Object.freeze({
    key: "economy",
    label: "Economy",
    icon: "📈",
    stats: Object.freeze([
      Object.freeze({ key: "gdp", label: "GDP", kind: "currency", icon: "💶", color: "#34d399", prefix: "€", compact: true, decimals: 1, minimum: 0, description: "Scenario-appropriate total economic output. Change the label/unit for eras where GDP is not meaningful." }),
      Object.freeze({ key: "gdpPerCapita", label: "GDP/capita", kind: "currency", icon: "◫", color: "#e5e7eb", prefix: "€", compact: true, decimals: 0, minimum: 0, description: "Scenario-appropriate output or income per person. Delete or repurpose when not meaningful." }),
      Object.freeze({ key: "inflation", label: "Inflation", kind: "percentage", icon: "↗", color: "#34d399", suffix: "%", decimals: 1, minimum: 0, maximum: 1000, description: "Price inflation in percent." }),
      Object.freeze({ key: "unemployment", label: "Unemployment", kind: "percentage", icon: "♟", color: "#34d399", suffix: "%", decimals: 1, minimum: 0, maximum: 100, description: "Unemployment in percent." }),
      Object.freeze({ key: "publicDebt", label: "Public debt", kind: "percentage", icon: "▥", color: "#34d399", suffix: "%", decimals: 1, minimum: 0, maximum: 1000, description: "Public debt in the scenario's chosen percentage basis." }),
      Object.freeze({ key: "budgetBalance", label: "Budget balance", kind: "percentage", icon: "±", color: "#34d399", suffix: "%", decimals: 1, minimum: -1000, maximum: 1000, description: "Budget balance in percent; negative values represent deficits." }),
      Object.freeze({ key: "agricultureShare", label: "Agriculture", kind: "percentage", icon: "🌾", color: "#22c55e", suffix: "%", decimals: 0, minimum: 0, maximum: 100, description: "Agriculture share of output." }),
      Object.freeze({ key: "industryShare", label: "Industry", kind: "percentage", icon: "🏭", color: "#3b82f6", suffix: "%", decimals: 0, minimum: 0, maximum: 100, description: "Industry share of output." }),
      Object.freeze({ key: "servicesShare", label: "Services", kind: "percentage", icon: "◆", color: "#f59e0b", suffix: "%", decimals: 0, minimum: 0, maximum: 100, description: "Services share of output." }),
    ]),
  }),
]);

const clean = (value) => String(value ?? "").trim();
const DEFAULT_COLOR = "#a1a1aa";
const validColor = (value) => /^#[0-9a-f]{6}$/i.test(clean(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const toStatIndexKey = (value) => {
  const words = clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  let key = words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("")
    .slice(0, 40);
  if (!/^[A-Za-z]/.test(key)) key = `stat${key}`.slice(0, 40);
  return STAT_INDEX_KEY_PATTERN.test(key) ? key : "";
};

const uniqueKey = (base, used) => {
  const seed = STAT_INDEX_KEY_PATTERN.test(base) ? base : "stat";
  let candidate = seed;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const tail = String(suffix);
    candidate = `${seed.slice(0, Math.max(1, 40 - tail.length))}${tail}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
};

const normalizeBound = (value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const normalizeStatDefinition = (item, { used = new Set(), fallbackKind = "index" } = {}) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const label = clean(item.label ?? item.name).slice(0, 60);
  if (!label) return null;
  let key = clean(item.key);
  if (!STAT_INDEX_KEY_PATTERN.test(key)) key = toStatIndexKey(label);
  if (!key) return null;
  key = uniqueKey(key, used);
  const requestedKind = clean(item.kind).toLowerCase();
  const kind = STAT_KINDS.includes(requestedKind) ? requestedKind : fallbackKind;
  const decimals = clamp(Math.trunc(Number(item.decimals) || 0), 0, 4);
  let minimum = normalizeBound(item.minimum ?? item.min);
  let maximum = normalizeBound(item.maximum ?? item.max);
  if (kind === "index") {
    minimum = 0;
    maximum = 100;
  } else if (kind === "percentage") {
    if (minimum === undefined) minimum = 0;
    if (maximum === undefined) maximum = 100;
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    [minimum, maximum] = [maximum, minimum];
  }
  return {
    key,
    label,
    kind,
    icon: clean(item.icon).slice(0, 8) || "◆",
    color: validColor(item.color) ? clean(item.color).toLowerCase() : DEFAULT_COLOR,
    description: clean(item.description).slice(0, 360),
    prefix: clean(item.prefix).slice(0, 12),
    suffix: clean(item.suffix ?? item.unit).slice(0, 24),
    decimals,
    compact: Boolean(item.compact),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
};

export const normalizeStatIndexRows = (value, { fallback = true } = {}) => {
  const input = Array.isArray(value)
    ? value
    : Array.isArray(value?.indices)
      ? value.indices
      : [];
  const rows = [];
  const used = new Set();
  for (const item of input) {
    const row = normalizeStatDefinition({ ...item, kind: "index" }, { used, fallbackKind: "index" });
    if (!row) continue;
    rows.push(row);
    if (rows.length >= MAX_STAT_INDICES) break;
  }
  if (rows.length) return rows;
  return fallback ? DEFAULT_STAT_INDEX_ROWS.map((row) => ({ ...row })) : [];
};

const cloneDefaultSections = () => DEFAULT_CUSTOM_STAT_SECTIONS.map((section) => ({
  ...section,
  stats: section.stats.map((stat) => ({ ...stat })),
}));

export const normalizeStatSheetSections = (value, { fallback = false } = {}) => {
  const rawSections = Array.isArray(value)
    ? value
    : Array.isArray(value?.sections)
      ? value.sections
      : [];
  const sectionKeys = new Set();
  const statKeys = new Set();
  const sections = [];
  let statCount = 0;

  for (const rawSection of rawSections) {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) continue;
    const label = clean(rawSection.label ?? rawSection.name).slice(0, 60);
    if (!label) continue;
    let key = clean(rawSection.key);
    if (!STAT_INDEX_KEY_PATTERN.test(key)) key = toStatIndexKey(label);
    if (!key) continue;
    key = uniqueKey(key, sectionKeys);
    const stats = [];
    for (const rawStat of Array.isArray(rawSection.stats) ? rawSection.stats : []) {
      if (statCount >= MAX_CUSTOM_STATS || stats.length >= MAX_STATS_PER_SECTION) break;
      const stat = normalizeStatDefinition(rawStat, { used: statKeys, fallbackKind: "index" });
      if (!stat) continue;
      stats.push(stat);
      statCount += 1;
    }
    if (!stats.length) continue;
    sections.push({
      key,
      label,
      icon: clean(rawSection.icon).slice(0, 8) || "◆",
      stats,
    });
    if (sections.length >= MAX_STAT_SECTIONS || statCount >= MAX_CUSTOM_STATS) break;
  }

  if (sections.length) return sections;
  return fallback ? cloneDefaultSections() : [];
};

export const normalizeStatSheetDefinition = (value, { fallbackStandard = true } = {}) => {
  // V1 compatibility: yesterday's experimental stats.json was {indices:[...]};
  // migrate it into a real section rather than losing the author's work.
  const legacyIndices = normalizeStatIndexRows(value, { fallback: false });
  if (!Array.isArray(value?.sections) && legacyIndices.length) {
    return {
      custom: true,
      version: STAT_SHEET_VERSION,
      sections: [{ key: "strategic", label: "Strategic indices", icon: "⚑", stats: legacyIndices }],
    };
  }

  const sections = normalizeStatSheetSections(value, { fallback: false });
  if (sections.length) return { custom: true, version: STAT_SHEET_VERSION, sections };
  return fallbackStandard
    ? { custom: false, version: STAT_SHEET_VERSION, sections: cloneDefaultSections() }
    : { custom: false, version: STAT_SHEET_VERSION, sections: [] };
};

export const defaultCustomStatSheetDefinition = () => ({
  custom: true,
  version: STAT_SHEET_VERSION,
  sections: cloneDefaultSections(),
});

export const serializeStatSheet = (value) => {
  const definition = Array.isArray(value)
    ? { custom: true, version: STAT_SHEET_VERSION, sections: [{ key: "strategic", label: "Strategic indices", icon: "⚑", stats: value }] }
    : normalizeStatSheetDefinition(value, { fallbackStandard: false });
  return {
    version: STAT_SHEET_VERSION,
    sections: definition.sections,
  };
};

export const flattenStatSheetRows = (definitionInput) => {
  const definition = normalizeStatSheetDefinition(definitionInput);
  return definition.sections.flatMap((section) => section.stats.map((stat) => ({ ...stat, sectionKey: section.key, sectionLabel: section.label })));
};

export const statSheetKeys = (definitionInput) => flattenStatSheetRows(definitionInput).map((stat) => stat.key);

export const normalizeCustomStatValues = (value, definitionInput, { partial = false } = {}) => {
  const definition = normalizeStatSheetDefinition(definitionInput);
  if (!definition.custom) return {};
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  for (const stat of flattenStatSheetRows(definition)) {
    if (!Object.prototype.hasOwnProperty.call(source, stat.key)) {
      if (!partial) continue;
      continue;
    }
    const numeric = Number(source[stat.key]);
    if (!Number.isFinite(numeric)) continue;
    let next = numeric;
    if (Number.isFinite(stat.minimum)) next = Math.max(stat.minimum, next);
    if (Number.isFinite(stat.maximum)) next = Math.min(stat.maximum, next);
    out[stat.key] = Number(next.toFixed(stat.decimals));
  }
  return out;
};

export const isCompleteCustomStatValues = (value, definitionInput) => {
  const definition = normalizeStatSheetDefinition(definitionInput);
  if (!definition.custom) return false;
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return statSheetKeys(definition).every((key) => Number.isFinite(Number(source[key])));
};

export const describeStatIndexRows = (rows) => normalizeStatIndexRows(rows)
  .map((row) => `${row.key} = ${row.label}${row.description ? ` — ${row.description}` : ""}`)
  .join("; ");

export const describeStatSheetDefinition = (definitionInput) => {
  const definition = normalizeStatSheetDefinition(definitionInput);
  return definition.sections.map((section) => {
    const stats = section.stats.map((stat) => {
      const range = Number.isFinite(stat.minimum) || Number.isFinite(stat.maximum)
        ? ` range ${Number.isFinite(stat.minimum) ? stat.minimum : "unbounded"}..${Number.isFinite(stat.maximum) ? stat.maximum : "unbounded"}`
        : "";
      const display = [stat.prefix, stat.suffix].filter(Boolean).join(" / ");
      return `${stat.key} = ${stat.label} [${stat.kind}${range}${display ? `; display ${display}` : ""}]${stat.description ? ` — ${stat.description}` : ""}`;
    }).join("; ");
    return `${section.label}: ${stats}`;
  }).join("\n");
};
