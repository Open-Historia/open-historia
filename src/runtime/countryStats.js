/*! Open Historia — native persistent country statistics and economic aggregation. */

export const COUNTRY_STATS_SCHEMA_VERSION = 1;

export const COUNTRY_STATS_COMPONENT_GROUPS = Object.freeze([
  "core",
  "integrated",
  "overseas/dependent",
]);

const COMPONENT_GROUP_SET = new Set(COUNTRY_STATS_COMPONENT_GROUPS);
const INDEX_KEYS = Object.freeze([
  "sovereignty",
  "foodAutonomy",
  "energyAutonomy",
  "economicIndependence",
  "internalSecurity",
  "internationalReputation",
]);
const ECONOMY_NUMERIC_KEYS = Object.freeze([
  "gdp",
  "gdpPerCapita",
  "coreGdpPerCapita",
  "otherGdpPerCapita",
  "gdpGrowth",
  "inflation",
  "unemployment",
  "publicDebt",
  "budgetBalance",
]);

const clean = (value) => String(value ?? "").trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value) => Number.isFinite(Number(value));

export const parseStatNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text) return null;

  const normalized = text
    .replace(/\u00a0/g, " ")
    .replace(/,/g, "")
    .replace(/−/g, "-")
    .toLowerCase();

  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;

  let number = Number(match[0]);
  if (!Number.isFinite(number)) return null;

  // Accept the common forms produced by old saves and older AI prompts:
  // "48.5 billion", "$48.5B", "1.2 trillion", "850 million".
  if (/\btrillion\b|\btn\b/.test(normalized) || /\d(?:\.\d+)?\s*t\b/.test(normalized)) {
    number *= 1e12;
  } else if (/\bbillion\b|\bbn\b/.test(normalized) || /\d(?:\.\d+)?\s*b\b/.test(normalized)) {
    number *= 1e9;
  } else if (/\bmillion\b|\bmn\b/.test(normalized) || /\d(?:\.\d+)?\s*m\b/.test(normalized)) {
    number *= 1e6;
  } else if (/\bthousand\b/.test(normalized) || /\d(?:\.\d+)?\s*k\b/.test(normalized)) {
    number *= 1e3;
  }

  return Number.isFinite(number) ? number : null;
};

const normalizePercent = (value) => {
  const parsed = parseStatNumber(value);
  return parsed == null ? null : clamp(parsed, 0, 100);
};

const normalizeSignedPercent = (value) => {
  const parsed = parseStatNumber(value);
  return parsed == null ? null : clamp(parsed, -1000, 1000);
};

const componentKey = (value) => clean(value).toLocaleLowerCase();

export const normalizeTerritorialComponents = (value) => {
  if (!Array.isArray(value)) return [];

  const byKey = new Map();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const geography = clean(item.geography);
    const group = clean(item.group).toLowerCase();
    const population = parseStatNumber(item.population);
    const gdpPerCapita = parseStatNumber(item.gdpPerCapita);

    if (!geography || !COMPONENT_GROUP_SET.has(group)) continue;
    if (!Number.isFinite(population) || population < 0) continue;
    if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;

    const normalized = {
      geography,
      group,
      population: Math.round(population),
      gdpPerCapita: Math.round(gdpPerCapita * 100) / 100,
    };

    // A generated sheet should contain one row per geography. If a provider
    // accidentally duplicates one, the latest row wins deterministically.
    byKey.set(componentKey(geography), normalized);
  }

  return [...byKey.values()].slice(0, 64);
};

export const aggregateTerritorialEconomy = (componentsInput) => {
  const components = normalizeTerritorialComponents(componentsInput);
  if (!components.length) return null;

  let population = 0;
  let gdp = 0;
  let corePopulation = 0;
  let otherPopulation = 0;
  let coreGdp = 0;
  let otherGdp = 0;

  for (const component of components) {
    const componentGdp = component.population * component.gdpPerCapita;
    population += component.population;
    gdp += componentGdp;

    if (component.group === "overseas/dependent") {
      otherPopulation += component.population;
      otherGdp += componentGdp;
    } else {
      corePopulation += component.population;
      coreGdp += componentGdp;
    }
  }

  if (!(population > 0) || !(gdp > 0)) return null;

  return {
    population: Math.round(population),
    gdp,
    gdpPerCapita: gdp / population,
    corePopulation: Math.round(corePopulation),
    otherPopulation: Math.round(otherPopulation),
    coreGdp,
    otherGdp,
    coreGdpPerCapita: corePopulation > 0 ? coreGdp / corePopulation : null,
    otherGdpPerCapita: otherPopulation > 0 ? otherGdp / otherPopulation : null,
  };
};

const normalizeIndices = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  for (const key of INDEX_KEYS) {
    const normalized = normalizePercent(value[key]);
    if (normalized != null) out[key] = Math.round(normalized);
  }
  return Object.keys(out).length ? out : undefined;
};

const normalizeBreakdown = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = ["agriculture", "industry", "services"].map((key) => normalizePercent(value[key]));
  if (raw.some((number) => number == null)) return undefined;

  const total = raw.reduce((sum, number) => sum + number, 0);
  if (!(total > 0)) return undefined;

  // Normalize to exactly 100 so a GM edit such as 20/40/39 cannot poison the
  // canonical sheet. Largest-remainder rounding keeps the result deterministic.
  const scaled = raw.map((number) => (number / total) * 100);
  const floors = scaled.map((number) => Math.floor(number));
  let remainder = 100 - floors.reduce((sum, number) => sum + number, 0);
  const order = scaled
    .map((number, index) => ({ index, fraction: number - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < order.length && remainder > 0; i += 1, remainder -= 1) {
    floors[order[i].index] += 1;
  }

  return {
    agriculture: floors[0],
    industry: floors[1],
    services: floors[2],
  };
};

const normalizeEconomy = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};

  for (const key of ECONOMY_NUMERIC_KEYS) {
    let normalized = null;
    if (["gdpGrowth", "budgetBalance"].includes(key)) normalized = normalizeSignedPercent(value[key]);
    else if (key === "unemployment") normalized = normalizePercent(value[key]);
    else if (["inflation", "publicDebt"].includes(key)) {
      const parsed = parseStatNumber(value[key]);
      normalized = parsed == null ? null : clamp(parsed, 0, 1000);
    } else normalized = parseStatNumber(value[key]);

    if (normalized != null && Number.isFinite(normalized)) out[key] = normalized;
  }

  const currency = clean(value.currency);
  if (currency) out.currency = currency;

  return Object.keys(out).length ? out : undefined;
};

const normalizePopulation = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  for (const key of ["total", "coreIntegrated", "otherTerritories"]) {
    const number = parseStatNumber(value[key]);
    if (Number.isFinite(number) && number >= 0) out[key] = Math.round(number);
  }
  return Object.keys(out).length ? out : undefined;
};

const copyTextField = (source, target, key) => {
  const text = clean(source?.[key]);
  if (text) target[key] = text;
};

export const normalizeCountryStatSheet = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const out = {};
  for (const key of ["capital", "continent", "government", "leader"]) {
    copyTextField(value, out, key);
  }

  const stability = normalizePercent(value.stability);
  if (stability != null) out.stability = Math.round(stability);

  const indices = normalizeIndices(value.indices);
  if (indices) out.indices = indices;

  const economy = normalizeEconomy(value.economy);
  if (economy) out.economy = economy;

  const population = normalizePopulation(value.population);
  if (population) out.population = population;

  const breakdown = normalizeBreakdown(value.gdpBreakdown);
  if (breakdown) out.gdpBreakdown = breakdown;

  const components = normalizeTerritorialComponents(value.territorialComponents);
  if (components.length) out.territorialComponents = components;

  const declaredVersion = Number(value.statsSchemaVersion);
  out.statsSchemaVersion = Number.isInteger(declaredVersion) && declaredVersion > 0
    ? declaredVersion
    : components.length
      ? COUNTRY_STATS_SCHEMA_VERSION
      : 0;

  // If the component ledger exists, it is the arithmetic authority regardless
  // of whatever total numbers an old save or model wrote beside it.
  if (components.length) return finalizeCountryStatSheet(out);

  return out;
};

export const finalizeCountryStatSheet = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  // Start with normalized legacy-compatible fields without recursively invoking
  // ourselves when a component ledger is already present.
  const out = {};
  for (const key of ["capital", "continent", "government", "leader"]) copyTextField(value, out, key);

  const stability = normalizePercent(value.stability);
  if (stability != null) out.stability = Math.round(stability);

  const indices = normalizeIndices(value.indices);
  if (indices) out.indices = indices;

  const breakdown = normalizeBreakdown(value.gdpBreakdown);
  if (breakdown) out.gdpBreakdown = breakdown;

  const economy = normalizeEconomy(value.economy) || {};
  const components = normalizeTerritorialComponents(value.territorialComponents);
  const aggregate = aggregateTerritorialEconomy(components);

  if (components.length) out.territorialComponents = components;

  if (aggregate) {
    out.population = {
      total: aggregate.population,
      coreIntegrated: aggregate.corePopulation,
      otherTerritories: aggregate.otherPopulation,
    };

    out.economy = {
      ...economy,
      gdp: Math.round(aggregate.gdp),
      gdpPerCapita: Math.round(aggregate.gdpPerCapita * 100) / 100,
      ...(aggregate.coreGdpPerCapita == null
        ? {}
        : { coreGdpPerCapita: Math.round(aggregate.coreGdpPerCapita * 100) / 100 }),
      ...(aggregate.otherGdpPerCapita == null
        ? {}
        : { otherGdpPerCapita: Math.round(aggregate.otherGdpPerCapita * 100) / 100 }),
    };
    out.statsSchemaVersion = COUNTRY_STATS_SCHEMA_VERSION;
  } else {
    const population = normalizePopulation(value.population);
    if (population) out.population = population;
    if (Object.keys(economy).length) out.economy = economy;
    const declaredVersion = Number(value.statsSchemaVersion);
    out.statsSchemaVersion = Number.isInteger(declaredVersion) && declaredVersion > 0 ? declaredVersion : 0;
  }

  return out;
};

const scaleComponentPopulation = (components, predicate, targetPopulation) => {
  const current = components
    .filter(predicate)
    .reduce((sum, component) => sum + component.population, 0);
  if (!(current > 0) || !(targetPopulation >= 0)) return components;
  const ratio = targetPopulation / current;
  return components.map((component) => (
    predicate(component)
      ? { ...component, population: Math.max(0, Math.round(component.population * ratio)) }
      : component
  ));
};

const scaleComponentProductivity = (components, predicate, ratio) => {
  if (!Number.isFinite(ratio) || !(ratio > 0)) return components;
  return components.map((component) => (
    predicate(component)
      ? { ...component, gdpPerCapita: Math.max(1, Math.round(component.gdpPerCapita * ratio * 100) / 100) }
      : component
  ));
};

const mergeComponentsByGeography = (base, patch) => {
  const out = new Map(normalizeTerritorialComponents(base).map((component) => [componentKey(component.geography), component]));
  for (const component of normalizeTerritorialComponents(patch)) {
    out.set(componentKey(component.geography), component);
  }
  return [...out.values()].slice(0, 64);
};

// SINGLE MUTATION BOUNDARY for normal simulation, the future expanded GM,
// editor/repair tools, and scripted events. It accepts legacy string values,
// applies explicit component edits when supplied, and then recomputes every
// derived population/GDP value from the component ledger.
export const mergeCountryStatPatch = (
  baseValue,
  patchValue,
  { replaceComponents = false } = {},
) => {
  const base = normalizeCountryStatSheet(baseValue) || {};
  const patch = patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)
    ? patchValue
    : {};

  const merged = {
    ...base,
    ...Object.fromEntries(
      ["capital", "continent", "government", "leader"]
        .map((key) => [key, clean(patch[key])])
        .filter(([, value]) => value),
    ),
  };

  const stability = normalizePercent(patch.stability);
  if (stability != null) merged.stability = Math.round(stability);

  if (patch.indices && typeof patch.indices === "object" && !Array.isArray(patch.indices)) {
    merged.indices = {
      ...(base.indices || {}),
      ...(normalizeIndices(patch.indices) || {}),
    };
  }

  if (patch.gdpBreakdown && typeof patch.gdpBreakdown === "object" && !Array.isArray(patch.gdpBreakdown)) {
    merged.gdpBreakdown = normalizeBreakdown({
      ...(base.gdpBreakdown || {}),
      ...patch.gdpBreakdown,
    }) || base.gdpBreakdown;
  }

  const economyPatch = normalizeEconomy(patch.economy) || {};
  merged.economy = {
    ...(base.economy || {}),
    ...economyPatch,
  };

  let components = normalizeTerritorialComponents(base.territorialComponents);
  if (Array.isArray(patch.territorialComponents)) {
    components = replaceComponents
      ? normalizeTerritorialComponents(patch.territorialComponents)
      : mergeComponentsByGeography(components, patch.territorialComponents);
  }

  // Aggregate population edits are supported for GM/editor convenience. The
  // component ledger remains source-of-truth, so aggregate targets scale the
  // appropriate component populations rather than creating contradictory totals.
  const populationPatch = normalizePopulation(patch.population);
  if (components.length && populationPatch) {
    const corePredicate = (component) => component.group !== "overseas/dependent";
    const otherPredicate = (component) => component.group === "overseas/dependent";

    if (finite(populationPatch.coreIntegrated)) {
      components = scaleComponentPopulation(components, corePredicate, populationPatch.coreIntegrated);
    }
    if (finite(populationPatch.otherTerritories)) {
      components = scaleComponentPopulation(components, otherPredicate, populationPatch.otherTerritories);
    }
    if (
      finite(populationPatch.total) &&
      !finite(populationPatch.coreIntegrated) &&
      !finite(populationPatch.otherTerritories)
    ) {
      components = scaleComponentPopulation(components, () => true, populationPatch.total);
    }
  } else if (populationPatch) {
    merged.population = {
      ...(base.population || {}),
      ...populationPatch,
    };
  }

  if (components.length && patch.economy && typeof patch.economy === "object" && !Array.isArray(patch.economy)) {
    const before = aggregateTerritorialEconomy(components);
    const requestedGdp = parseStatNumber(patch.economy.gdp);
    const requestedWholePc = parseStatNumber(patch.economy.gdpPerCapita);
    const requestedCorePc = parseStatNumber(patch.economy.coreGdpPerCapita);
    const requestedOtherPc = parseStatNumber(patch.economy.otherGdpPerCapita);

    // Total GDP is the strongest aggregate authority. If both GDP and GDP/capita
    // are supplied inconsistently, GDP wins and per-capita is recomputed.
    if (before && Number.isFinite(requestedGdp) && requestedGdp > 0) {
      components = scaleComponentProductivity(components, () => true, requestedGdp / before.gdp);
    } else if (before && Number.isFinite(requestedWholePc) && requestedWholePc > 0) {
      components = scaleComponentProductivity(components, () => true, requestedWholePc / before.gdpPerCapita);
    } else {
      if (before && Number.isFinite(requestedCorePc) && requestedCorePc > 0 && before.coreGdpPerCapita > 0) {
        components = scaleComponentProductivity(
          components,
          (component) => component.group !== "overseas/dependent",
          requestedCorePc / before.coreGdpPerCapita,
        );
      }
      const afterCore = aggregateTerritorialEconomy(components);
      if (
        afterCore &&
        Number.isFinite(requestedOtherPc) &&
        requestedOtherPc > 0 &&
        afterCore.otherGdpPerCapita > 0
      ) {
        components = scaleComponentProductivity(
          components,
          (component) => component.group === "overseas/dependent",
          requestedOtherPc / afterCore.otherGdpPerCapita,
        );
      }
    }
  }

  if (components.length) merged.territorialComponents = components;

  return finalizeCountryStatSheet(merged);
};

export const isCompleteCountryStatSheet = (value) => {
  const sheet = finalizeCountryStatSheet(value);
  if (!sheet || sheet.statsSchemaVersion !== COUNTRY_STATS_SCHEMA_VERSION) return false;
  if (!["capital", "continent", "government", "leader"].every((key) => clean(sheet[key]))) return false;
  if (!Number.isFinite(Number(sheet.stability))) return false;
  if (!INDEX_KEYS.every((key) => Number.isFinite(Number(sheet.indices?.[key])))) return false;
  if (!Array.isArray(sheet.territorialComponents) || sheet.territorialComponents.length < 1) return false;
  if (!(Number(sheet.population?.total) > 0)) return false;
  if (!(Number(sheet.economy?.gdp) > 0) || !(Number(sheet.economy?.gdpPerCapita) > 0)) return false;
  if (!["gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance"].every(
    (key) => Number.isFinite(Number(sheet.economy?.[key])),
  )) return false;
  if (!clean(sheet.economy?.currency)) return false;
  const breakdown = sheet.gdpBreakdown;
  if (!breakdown || breakdown.agriculture + breakdown.industry + breakdown.services !== 100) return false;
  return true;
};

export const buildEconomicConditionSummary = (value) => {
  const sheet = finalizeCountryStatSheet(value);
  if (!sheet || !sheet.economy) return "No canonical economic stat sheet is available yet.";

  const economy = sheet.economy;
  const growth = Number(economy.gdpGrowth);
  const inflation = Number(economy.inflation);
  const unemployment = Number(economy.unemployment);
  const debt = Number(economy.publicDebt);
  const balance = Number(economy.budgetBalance);
  const clauses = [];

  if (Number.isFinite(growth)) {
    clauses.push(growth <= -5 ? "severe contraction" : growth < -1 ? "economic contraction" : growth >= 5 ? "rapid growth" : growth > 1 ? "positive growth" : "near-stagnant growth");
  }
  if (Number.isFinite(inflation)) {
    if (inflation >= 20) clauses.push("very high inflation");
    else if (inflation >= 8) clauses.push("elevated inflation");
    else if (inflation <= 3) clauses.push("contained inflation");
  }
  if (Number.isFinite(unemployment)) {
    if (unemployment >= 15) clauses.push("very high unemployment");
    else if (unemployment >= 8) clauses.push("high unemployment");
  }
  if (Number.isFinite(debt)) {
    if (debt >= 120) clauses.push("very heavy public debt");
    else if (debt >= 80) clauses.push("high public debt");
  }
  if (Number.isFinite(balance)) {
    if (balance <= -10) clauses.push("extreme fiscal deficit");
    else if (balance <= -5) clauses.push("large fiscal deficit");
    else if (balance >= 3) clauses.push("strong fiscal surplus");
  }

  const position = clauses.length ? clauses.join(", ") : "broadly moderate recorded conditions";
  return `${position}. Economic stress constrains the cost and financing of major programs; it does not make them impossible. Extraordinary spending may require borrowing, taxation, cuts elsewhere, foreign finance, or acceptance of inflation/debt consequences.`;
};
