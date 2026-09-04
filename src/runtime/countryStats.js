/*! Open Historia — native persistent country statistics and economic aggregation. */

export const COUNTRY_STATS_SCHEMA_VERSION = 1;
export const COUNTRY_STATS_POPULATION_CALIBRATION_VERSION = 2;
export const COUNTRY_STATS_HISTORY_VERSION = 1;
export const COUNTRY_STATS_HISTORY_MAX_SAMPLES = 1200;
export const COUNTRY_STATS_TRACKING_VERSION = 1;
export const COUNTRY_STATS_TRACKING_MAX_POLITIES = 8;
export const COUNTRY_STATS_TRACKING_INTERVALS = Object.freeze([0, 3, 6, 12, 24]);

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

export const countryStatsTrackingIntervalLabel = (months) => {
  const numeric = Math.max(0, Math.trunc(Number(months) || 0));
  if (!numeric) return "Manual only";
  return numeric === 1 ? "Every month" : `Every ${numeric} months`;
};

const uniqueTrackingPolities = (values, playerCountry = "", intervalMonths = 0) => {
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const key = clean(value);
    const token = key.toLocaleLowerCase();
    if (!key || seen.has(token)) return;
    seen.add(token);
    out.push(key);
  };

  if (Number(intervalMonths) > 0) add(playerCountry);
  if (Array.isArray(values)) values.forEach(add);
  return out.slice(0, COUNTRY_STATS_TRACKING_MAX_POLITIES);
};

export const normalizeCountryStatsTracking = (
  value,
  { playerCountry = "" } = {},
) => {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const rawInterval = Math.max(0, Math.trunc(Number(input.intervalMonths) || 0));
  const intervalMonths = COUNTRY_STATS_TRACKING_INTERVALS.includes(rawInterval)
    ? rawInterval
    : 0;
  const trackedPolities = uniqueTrackingPolities(
    input.trackedPolities,
    playerCountry,
    intervalMonths,
  );
  const trackedKeys = new Set(trackedPolities.map((item) => item.toLocaleLowerCase()));
  const lastAutoRefreshByPolity = {};
  if (input.lastAutoRefreshByPolity && typeof input.lastAutoRefreshByPolity === "object" && !Array.isArray(input.lastAutoRefreshByPolity)) {
    for (const [polity, date] of Object.entries(input.lastAutoRefreshByPolity)) {
      const key = clean(polity);
      const when = clean(date);
      if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(when)) continue;
      if (!trackedKeys.has(key.toLocaleLowerCase())) continue;
      lastAutoRefreshByPolity[key] = when;
    }
  }

  const pendingBaselinePolities = uniqueTrackingPolities(
    input.pendingBaselinePolities,
    "",
    0,
  ).filter((item) => trackedKeys.has(item.toLocaleLowerCase()));

  return {
    trackingVersion: COUNTRY_STATS_TRACKING_VERSION,
    intervalMonths,
    trackedPolities,
    lastAutoRefreshByPolity,
    pendingBaselinePolities,
    lastBatchDate: /^\d{4}-\d{2}-\d{2}$/.test(clean(input.lastBatchDate))
      ? clean(input.lastBatchDate)
      : "",
  };
};

export const countryStatsTrackingMonthsElapsed = (fromDate, toDate) => {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day };
  };
  const from = parse(fromDate);
  const to = parse(toDate);
  if (!from || !to) return 0;
  let months = (to.year - from.year) * 12 + (to.month - from.month);
  if (to.day < from.day) months -= 1;
  return Math.max(0, months);
};

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

  // The live map is authoritative and can legitimately assign hundreds of
  // provinces/components to one polity. Never truncate this ledger: doing so
  // silently deletes population/GDP from every component beyond the cap.
  return [...byKey.values()];
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


const MAX_ACCOUNTED_ECONOMIC_EVENTS = 64;

export const normalizeCountryStatContinuity = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const out = {};
  const assessedDate = clean(value.assessedDate);
  const stateFingerprint = clean(value.stateFingerprint);
  const territorialFingerprint = clean(value.territorialFingerprint);
  const assessedRound = Number(value.assessedRound);
  const populationCalibrationVersion = Number(value.populationCalibrationVersion);

  if (assessedDate) out.assessedDate = assessedDate;
  if (Number.isFinite(assessedRound) && assessedRound >= 0) {
    out.assessedRound = Math.trunc(assessedRound);
  }
  if (stateFingerprint) out.stateFingerprint = stateFingerprint;
  if (territorialFingerprint) out.territorialFingerprint = territorialFingerprint;
  if (Number.isInteger(populationCalibrationVersion) && populationCalibrationVersion > 0) {
    out.populationCalibrationVersion = populationCalibrationVersion;
  }

  const accountedEventIds = [...new Set(
    (Array.isArray(value.accountedEventIds) ? value.accountedEventIds : [])
      .map(clean)
      .filter(Boolean),
  )].slice(-MAX_ACCOUNTED_ECONOMIC_EVENTS);

  if (accountedEventIds.length) out.accountedEventIds = accountedEventIds;

  return Object.keys(out).length ? out : undefined;
};

const mergeCountryStatContinuity = (...values) => {
  let out = {};
  let eventIds = [];

  for (const value of values) {
    const normalized = normalizeCountryStatContinuity(value);
    if (!normalized) continue;
    eventIds = [...eventIds, ...(normalized.accountedEventIds || [])];
    out = { ...out, ...normalized };
  }

  eventIds = [...new Set(eventIds.map(clean).filter(Boolean))]
    .slice(-MAX_ACCOUNTED_ECONOMIC_EVENTS);

  if (eventIds.length) out.accountedEventIds = eventIds;
  else delete out.accountedEventIds;

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

  const continuity = normalizeCountryStatContinuity(value.continuity);
  if (continuity) out.continuity = continuity;

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
  const continuity = normalizeCountryStatContinuity(value.continuity);

  if (components.length) out.territorialComponents = components;
  if (continuity) out.continuity = continuity;

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

// Population calibration is a bootstrap/reconstruction tool, not a second ledger.
// The model still estimates the relative distribution across every live-map component;
// native code then rescales those rows to ONE scenario-canonical population anchor so
// map granularity cannot make a 300-province empire randomly gain/lose tens of millions.
// The exact integer target is conserved with largest-remainder rounding.
const scaleComponentPopulationExact = (components, predicate, targetPopulation) => {
  const target = Math.max(0, Math.round(Number(targetPopulation) || 0));
  const selected = components
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => predicate(component));

  if (!selected.length) {
    return target === 0
      ? { components, error: "" }
      : { components, error: `population calibration target ${target} has no matching territorial component rows.` };
  }

  const current = selected.reduce((sum, { component }) => sum + component.population, 0);
  if (!(current > 0)) {
    return target === 0
      ? {
          components: components.map((component) => (predicate(component) ? { ...component, population: 0 } : component)),
          error: "",
        }
      : { components, error: `population calibration cannot allocate target ${target} because the matching component estimates sum to zero.` };
  }

  const ratio = target / current;
  const scaled = selected.map(({ component, index }) => {
    const exact = component.population * ratio;
    const floor = Math.max(0, Math.floor(exact));
    return { index, floor, fraction: exact - floor };
  });

  let remainder = target - scaled.reduce((sum, entry) => sum + entry.floor, 0);
  if (remainder > 0) {
    scaled.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let cursor = 0; cursor < scaled.length && remainder > 0; cursor += 1, remainder -= 1) {
      scaled[cursor].floor += 1;
    }
  } else if (remainder < 0) {
    // Floating-point edge case: remove units from the smallest fractional rows
    // without allowing any component population to go negative.
    scaled.sort((a, b) => a.fraction - b.fraction || b.index - a.index);
    for (let cursor = 0; cursor < scaled.length && remainder < 0; cursor += 1) {
      if (scaled[cursor].floor <= 0) continue;
      scaled[cursor].floor -= 1;
      remainder += 1;
    }
  }

  const populations = new Map(scaled.map((entry) => [entry.index, entry.floor]));
  return {
    components: components.map((component, index) => (
      populations.has(index)
        ? { ...component, population: populations.get(index) }
        : component
    )),
    error: "",
  };
};

export const calibrateTerritorialComponentPopulations = (componentsInput, calibration) => {
  const components = normalizeTerritorialComponents(componentsInput);
  if (!components.length) {
    return { components: [], error: "population calibration requires at least one valid territorial component." };
  }
  if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
    return { components, error: "populationCalibration is required for this native Stats bootstrap/reconstruction." };
  }

  const total = parseStatNumber(calibration.totalPopulation);
  const core = parseStatNumber(calibration.coreIntegratedPopulation);
  const other = parseStatNumber(calibration.otherTerritoriesPopulation);
  if (![total, core, other].every((value) => Number.isFinite(value) && value >= 0)) {
    return { components, error: "populationCalibration must provide non-negative numeric totalPopulation, coreIntegratedPopulation, and otherTerritoriesPopulation." };
  }

  const targetTotal = Math.round(total);
  const targetCore = Math.round(core);
  const targetOther = Math.round(other);
  if (!(targetTotal > 0)) {
    return { components, error: "populationCalibration.totalPopulation must be greater than zero." };
  }
  if (targetCore + targetOther !== targetTotal) {
    return {
      components,
      error: `populationCalibration group targets must sum exactly to totalPopulation (${targetCore} + ${targetOther} != ${targetTotal}).`,
    };
  }

  const corePredicate = (component) => component.group !== "overseas/dependent";
  const otherPredicate = (component) => component.group === "overseas/dependent";
  const before = aggregateTerritorialEconomy(components);

  let next = components;
  const coreScaled = scaleComponentPopulationExact(next, corePredicate, targetCore);
  if (coreScaled.error) return { components, error: coreScaled.error };
  next = coreScaled.components;

  const otherScaled = scaleComponentPopulationExact(next, otherPredicate, targetOther);
  if (otherScaled.error) return { components, error: otherScaled.error };
  next = otherScaled.components;

  const after = aggregateTerritorialEconomy(next);
  if (!after || after.population !== targetTotal || after.corePopulation !== targetCore || after.otherPopulation !== targetOther) {
    return {
      components,
      error: `population calibration invariant failed after scaling (expected ${targetTotal}/${targetCore}/${targetOther}; got ${after?.population ?? "none"}/${after?.corePopulation ?? "none"}/${after?.otherPopulation ?? "none"}).`,
    };
  }

  return {
    components: next,
    error: "",
    diagnostics: {
      beforeTotal: before?.population ?? null,
      afterTotal: after.population,
      coreTarget: targetCore,
      otherTarget: targetOther,
      totalTarget: targetTotal,
    },
  };
};


// 8B.2.18: the model now estimates a bounded set of regional macro buckets,
// never one row per map province. Native code expands those macro estimates back
// into the complete live-map component ledger so territorial transfers remain
// precise without making AI latency scale with map granularity.
export const expandTerritorialMacroEstimates = (
  macroPlanInput,
  macroEstimatesInput,
  { previousComponents: previousComponentsInput = [] } = {},
) => {
  const macroPlan = Array.isArray(macroPlanInput) ? macroPlanInput : [];
  const estimates = Array.isArray(macroEstimatesInput) ? macroEstimatesInput : [];
  if (!macroPlan.length) {
    return { components: [], error: "regional Stats expansion requires at least one native macro bucket." };
  }

  const estimateByIndex = new Map();
  for (const estimate of estimates) {
    const index = Math.trunc(Number(estimate?.index));
    const group = clean(estimate?.group).toLowerCase();
    const population = parseStatNumber(estimate?.population);
    const gdpPerCapita = parseStatNumber(estimate?.gdpPerCapita);
    if (!Number.isInteger(index) || index < 1 || estimateByIndex.has(index)) continue;
    if (!COMPONENT_GROUP_SET.has(group)) continue;
    if (!Number.isFinite(population) || population < 0) continue;
    if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;
    estimateByIndex.set(index, {
      index,
      group,
      population: Math.round(population),
      gdpPerCapita: Math.round(gdpPerCapita * 100) / 100,
    });
  }

  const previousByGeography = new Map(
    normalizeTerritorialComponents(previousComponentsInput)
      .map((component) => [componentKey(component.geography), component]),
  );
  const output = [];
  const diagnostics = [];
  const seen = new Set();

  for (const bucket of macroPlan) {
    const index = Math.trunc(Number(bucket?.index));
    const estimate = estimateByIndex.get(index);
    const members = Array.isArray(bucket?.members) ? bucket.members : [];
    if (!estimate) {
      return { components: [], error: `regional Stats estimate is missing macro bucket ${index || "?"}.` };
    }
    if (!members.length) {
      return { components: [], error: `native macro bucket ${index || "?"} has no territorial members.` };
    }

    const memberRows = [];
    let priorProxyNumerator = 0;
    let priorProxyDenominator = 0;
    for (const member of members) {
      const geography = clean(member?.geography);
      const key = componentKey(geography);
      if (!geography || seen.has(key)) {
        return { components: [], error: `native macro plan contains a blank or duplicate geography in bucket ${index}.` };
      }
      seen.add(key);
      const prior = previousByGeography.get(key);
      const heuristicWeight = Math.max(0.05, Number(member?.weight) || 1);
      if (prior && Number(prior.population) > 0) {
        priorProxyNumerator += Number(prior.population);
        priorProxyDenominator += heuristicWeight;
      }
      memberRows.push({ geography, prior, heuristicWeight });
    }

    const proxyScale = priorProxyNumerator > 0 && priorProxyDenominator > 0
      ? priorProxyNumerator / priorProxyDenominator
      : 1;
    const provisional = memberRows.map(({ geography, prior, heuristicWeight }) => ({
      geography,
      group: estimate.group,
      population: Math.max(1, Math.round(
        prior && Number(prior.population) > 0
          ? Number(prior.population)
          : heuristicWeight * proxyScale,
      )),
      gdpPerCapita: prior && Number(prior.gdpPerCapita) > 0
        ? Number(prior.gdpPerCapita)
        : estimate.gdpPerCapita,
    }));

    const scaled = scaleComponentPopulationExact(provisional, () => true, estimate.population);
    if (scaled.error) return { components: [], error: `macro bucket ${index}: ${scaled.error}` };

    // Preserve local productivity differences from an existing campaign ledger,
    // but move the bucket's weighted mean toward the newly assessed macro value.
    const beforeEconomy = aggregateTerritorialEconomy(scaled.components);
    const currentPc = Number(beforeEconomy?.gdpPerCapita);
    const pcRatio = Number.isFinite(currentPc) && currentPc > 0
      ? estimate.gdpPerCapita / currentPc
      : 1;
    const finalBucket = scaled.components.map((component) => ({
      ...component,
      group: estimate.group,
      gdpPerCapita: Math.max(1, Math.round(component.gdpPerCapita * pcRatio * 100) / 100),
    }));

    output.push(...finalBucket);
    diagnostics.push({
      index,
      memberCount: finalBucket.length,
      population: estimate.population,
      gdpPerCapita: estimate.gdpPerCapita,
      group: estimate.group,
    });
  }

  return {
    components: normalizeTerritorialComponents(output),
    error: "",
    diagnostics,
  };
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
  // Preserve the complete live territorial ledger. A fixed component cap makes
  // aggregate population/GDP depend on map granularity rather than ownership.
  return [...out.values()];
};

// SINGLE MUTATION BOUNDARY for normal simulation, the future expanded GM,
// editor/repair tools, and scripted events. It accepts legacy string values,
// applies explicit component edits when supplied, and then recomputes every
// derived population/GDP value from the component ledger.
export const mergeCountryStatPatch = (
  baseValue,
  patchValue,
  { replaceComponents = false, continuity = null } = {},
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

  const mergedContinuity = mergeCountryStatContinuity(
    base.continuity,
    patch.continuity,
    continuity,
  );
  if (mergedContinuity) merged.continuity = mergedContinuity;

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

// ---------------------------------------------------------------------------
// Compact persistent Stats history
// ---------------------------------------------------------------------------
// countryStats is the canonical CURRENT sheet. countryStatsHistory is a compact
// numeric time series for charts only: no territorial component ledgers, no prose,
// no duplicated economic logic. One sample is cheap enough to keep for long games.
const HISTORY_INDEX_KEYS = Object.freeze([
  "sovereignty",
  "foodAutonomy",
  "energyAutonomy",
  "economicIndependence",
  "internalSecurity",
  "internationalReputation",
]);

const HISTORY_ECONOMY_KEYS = Object.freeze([
  "gdp",
  "gdpPerCapita",
  "gdpGrowth",
  "inflation",
  "unemployment",
  "publicDebt",
  "budgetBalance",
]);

const HISTORY_BREAKDOWN_KEYS = Object.freeze([
  "agriculture",
  "industry",
  "services",
]);

const normalizeHistoryDate = (value) => {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

const historyNumber = (value) => {
  const number = parseStatNumber(value);
  return Number.isFinite(number) ? number : null;
};

export const normalizeCountryStatHistorySample = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const date = normalizeHistoryDate(value.date);
  if (!date) return null;

  const out = {
    date,
    historyVersion: COUNTRY_STATS_HISTORY_VERSION,
  };
  const round = Number(value.round);
  if (Number.isFinite(round) && round >= 0) out.round = Math.trunc(round);

  const copyNumber = (key, source = value) => {
    const number = historyNumber(source?.[key]);
    if (number != null) out[key] = number;
  };

  copyNumber("stability");
  for (const key of HISTORY_INDEX_KEYS) copyNumber(key);
  copyNumber("population");
  copyNumber("corePopulation");
  copyNumber("otherPopulation");
  for (const key of HISTORY_ECONOMY_KEYS) copyNumber(key);
  for (const key of HISTORY_BREAKDOWN_KEYS) copyNumber(key);

  return Object.keys(out).length > 3 ? out : null;
};

export const buildCountryStatHistorySample = (sheetInput, { date = "", round = 0 } = {}) => {
  const sheet = finalizeCountryStatSheet(sheetInput);
  if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) return null;

  const sampleDate = normalizeHistoryDate(date || sheet?.continuity?.assessedDate);
  if (!sampleDate) return null;

  return normalizeCountryStatHistorySample({
    date: sampleDate,
    round,
    stability: sheet.stability,
    sovereignty: sheet.indices?.sovereignty,
    foodAutonomy: sheet.indices?.foodAutonomy,
    energyAutonomy: sheet.indices?.energyAutonomy,
    economicIndependence: sheet.indices?.economicIndependence,
    internalSecurity: sheet.indices?.internalSecurity,
    internationalReputation: sheet.indices?.internationalReputation,
    population: sheet.population?.total,
    corePopulation: sheet.population?.coreIntegrated,
    otherPopulation: sheet.population?.otherTerritories,
    gdp: sheet.economy?.gdp,
    gdpPerCapita: sheet.economy?.gdpPerCapita,
    gdpGrowth: sheet.economy?.gdpGrowth,
    inflation: sheet.economy?.inflation,
    unemployment: sheet.economy?.unemployment,
    publicDebt: sheet.economy?.publicDebt,
    budgetBalance: sheet.economy?.budgetBalance,
    agriculture: sheet.gdpBreakdown?.agriculture,
    industry: sheet.gdpBreakdown?.industry,
    services: sheet.gdpBreakdown?.services,
  });
};

const normalizeHistorySeries = (value) => {
  if (!Array.isArray(value)) return [];
  const byDate = new Map();
  for (const item of value) {
    const sample = normalizeCountryStatHistorySample(item);
    if (sample) byDate.set(sample.date, sample); // latest source wins deterministically
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.round || 0) - Number(b.round || 0))
    .slice(-COUNTRY_STATS_HISTORY_MAX_SAMPLES);
};

export const normalizeCountryStatsHistory = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [polity, samples] of Object.entries(value)) {
    const key = clean(polity);
    if (!key) continue;
    const normalized = normalizeHistorySeries(samples);
    if (normalized.length) out[key] = normalized;
  }
  return out;
};

export const appendCountryStatHistorySample = (
  historyInput,
  polity,
  sheetOrSample,
  { date = "", round = 0 } = {},
) => {
  const key = clean(polity);
  if (!key) return normalizeCountryStatsHistory(historyInput);

  const history = normalizeCountryStatsHistory(historyInput);
  const sample = normalizeCountryStatHistorySample(sheetOrSample) ||
    buildCountryStatHistorySample(sheetOrSample, { date, round });
  if (!sample) return history;

  history[key] = normalizeHistorySeries([...(history[key] || []), sample]);
  return history;
};

export const mergeCountryStatsHistory = (...values) => {
  let out = {};
  for (const value of values) {
    const normalized = normalizeCountryStatsHistory(value);
    for (const [polity, samples] of Object.entries(normalized)) {
      out[polity] = normalizeHistorySeries([...(out[polity] || []), ...samples]);
    }
  }
  return out;
};

// Capture every sheet that CURRENTLY exists. This does not generate missing Stats
// and therefore adds no AI work to a turn. Repeated dates replace the prior sample,
// which makes same-day refreshes and GM edits deterministic rather than duplicative.
export const captureCountryStatsHistory = (worldInput, { date = "", round = 0 } = {}) => {
  if (!worldInput || typeof worldInput !== "object" || Array.isArray(worldInput)) return worldInput;
  const countryStats = worldInput.countryStats && typeof worldInput.countryStats === "object"
    ? worldInput.countryStats
    : {};
  let history = normalizeCountryStatsHistory(worldInput.countryStatsHistory);

  for (const [polity, sheet] of Object.entries(countryStats)) {
    history = appendCountryStatHistorySample(history, polity, sheet, { date, round });
  }

  return {
    ...worldInput,
    countryStatsHistory: history,
  };
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


const compactEconomicNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const abs = Math.abs(number);
  if (abs >= 1e12) return `${Math.round((number / 1e12) * 10) / 10}T`;
  if (abs >= 1e9) return `${Math.round((number / 1e9) * 10) / 10}B`;
  if (abs >= 1e6) return `${Math.round((number / 1e6) * 10) / 10}M`;
  if (abs >= 1e3) return `${Math.round((number / 1e3) * 10) / 10}K`;
  return `${Math.round(number * 10) / 10}`;
};

export const buildCompactEconomicContext = (value, { name = "" } = {}) => {
  const sheet = finalizeCountryStatSheet(value);
  if (!sheet || !sheet.economy) return "";

  const economy = sheet.economy;
  const breakdown = sheet.gdpBreakdown || {};
  const indices = sheet.indices || {};
  const fields = [
    Number.isFinite(Number(economy.gdp)) ? `GDP-eq €${compactEconomicNumber(economy.gdp)}` : "",
    Number.isFinite(Number(economy.gdpGrowth)) ? `growth ${Number(economy.gdpGrowth)}%` : "",
    Number.isFinite(Number(economy.inflation)) ? `inflation ${Number(economy.inflation)}%` : "",
    Number.isFinite(Number(economy.unemployment)) ? `unemployment ${Number(economy.unemployment)}%` : "",
    Number.isFinite(Number(economy.publicDebt)) ? `debt ${Number(economy.publicDebt)}% GDP` : "",
    Number.isFinite(Number(economy.budgetBalance)) ? `budget ${Number(economy.budgetBalance)}% GDP` : "",
    Number.isFinite(Number(breakdown.industry)) ? `industry ${Number(breakdown.industry)}%` : "",
    Number.isFinite(Number(indices.foodAutonomy)) ? `food autonomy ${Number(indices.foodAutonomy)}/100` : "",
    Number.isFinite(Number(indices.energyAutonomy)) ? `energy autonomy ${Number(indices.energyAutonomy)}/100` : "",
    Number.isFinite(Number(indices.economicIndependence)) ? `economic independence ${Number(indices.economicIndependence)}/100` : "",
  ].filter(Boolean);

  if (!fields.length) return "";
  const prefix = clean(name);
  return `${prefix ? `${prefix}: ` : ""}${fields.join("; ")}. ${buildEconomicConditionSummary(sheet)}`;
};

const ratioOutside = (value, reference, lower, upper) => {
  if (!(Number(reference) > 0) || !(Number(value) >= 0)) return false;
  const ratio = Number(value) / Number(reference);
  return ratio < lower || ratio > upper;
};

const evidenceMentionsGeography = (evidenceText, geography) => {
  const evidence = clean(evidenceText).toLocaleLowerCase();
  const target = clean(geography).toLocaleLowerCase();
  if (!evidence || !target || target.length < 4) return false;
  return evidence.includes(target);
};

// Conservative native continuity guard for on-demand reassessments. It is NOT a
// macroeconomic simulator: it only prevents a fresh model call from silently
// re-baselining surviving components or macro indicators without enough elapsed
// time / supplied campaign evidence. Territory changes are handled structurally
// by the native component plan and therefore bypass this guard for changed rows.
export const guardCountryStatContinuity = (
  previousValue,
  candidateValue,
  {
    elapsedYears = 0,
    evidenceText = "",
    territoryChanged = false,
  } = {},
) => {
  const previous = finalizeCountryStatSheet(previousValue);
  const candidate = finalizeCountryStatSheet(candidateValue);
  if (!previous || !candidate) return { sheet: candidate, restored: [] };

  const previousComponents = new Map(
    normalizeTerritorialComponents(previous.territorialComponents)
      .map((component) => [componentKey(component.geography), component]),
  );
  const restored = [];
  const years = Math.max(0, Number(elapsedYears) || 0);
  const genericEvidence = Boolean(clean(evidenceText));

  let components = normalizeTerritorialComponents(candidate.territorialComponents)
    .map((component) => {
      const prior = previousComponents.get(componentKey(component.geography));
      if (!prior) return component;

      const specificEvidence = evidenceMentionsGeography(evidenceText, component.geography);
      // Longer spans naturally permit larger cumulative demographic/productivity
      // changes. Fresh explicit evidence widens the band, and a legal-territory
      // change widens it further because the SAME base-geography bucket may now
      // cover a different subset of regions. Surviving matched components are still
      // guarded rather than globally unlocked by one annexation elsewhere.
      const territorialMultiplier = territoryChanged ? 1.6 : 1;
      const populationSwing = Math.min(1.25, 0.5 + years * 0.03) * (genericEvidence ? 1.2 : 1) * territorialMultiplier;
      const productivitySwing = Math.min(1.75, 0.5 + years * 0.05) * (genericEvidence ? 1.25 : 1) * territorialMultiplier;
      const popLower = 1 / (1 + populationSwing);
      const popUpper = 1 + populationSwing;
      const pcLower = 1 / (1 + productivitySwing);
      const pcUpper = 1 + productivitySwing;

      const next = { ...component };

      if (
        ratioOutside(component.population, prior.population, popLower, popUpper) &&
        !specificEvidence
      ) {
        restored.push({
          geography: component.geography,
          field: "population",
          attempted: component.population,
          restored: prior.population,
        });
        next.population = prior.population;
      }

      const extremePc = ratioOutside(component.gdpPerCapita, prior.gdpPerCapita, 0.5, 2);
      if (
        (
          ratioOutside(component.gdpPerCapita, prior.gdpPerCapita, pcLower, pcUpper) ||
          extremePc
        ) &&
        !specificEvidence
      ) {
        restored.push({
          geography: component.geography,
          field: "gdpPerCapita",
          attempted: component.gdpPerCapita,
          restored: prior.gdpPerCapita,
        });
        next.gdpPerCapita = prior.gdpPerCapita;
      }

      return next;
    });

  let guarded = finalizeCountryStatSheet({
    ...candidate,
    territorialComponents: components,
  });

  // With no new economic evidence, a short-span refresh should not randomly
  // re-roll macro rates by double-digit percentage points. These are absolute
  // indicators, not deltas.
  if (!genericEvidence && years <= 2 && previous.economy && guarded?.economy) {
    const thresholds = {
      gdpGrowth: 8,
      inflation: 10,
      unemployment: 8,
      publicDebt: 25,
      budgetBalance: 8,
    };
    const economy = { ...guarded.economy };
    for (const [field, threshold] of Object.entries(thresholds)) {
      const before = Number(previous.economy[field]);
      const after = Number(guarded.economy[field]);
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      if (Math.abs(after - before) <= threshold) continue;
      restored.push({ geography: "whole polity", field, attempted: after, restored: before });
      economy[field] = before;
    }
    guarded = finalizeCountryStatSheet({ ...guarded, economy });
  }

  return { sheet: guarded, restored };
};
