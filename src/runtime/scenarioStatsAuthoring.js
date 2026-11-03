/*! Open Historia — reviewed, scenario-owned starting Statistics. Pure validation and assembly. */
import {
  DEFAULT_STAT_INDEX_KEYS,
  NATIONAL_NATIVE_METRICS,
  normalizeStatSheetDefinition,
  serializeStatSheet,
} from "./statIndexDefinitions.js";
import {
  expandTerritorialMacroEstimates,
  isCompleteCountryStatSheet,
  isCompleteCustomCountryStatSheet,
  mergeCountryStatPatch,
  normalizeCountryStatSheet,
} from "./countryStats.js";
import { addGameDays, isCanonicalGameDate } from "./gameDates.js";
import { resolvePolityIdentity } from "./polityIdentity.js";
import {
  assertNoLegacyNativeStatCopies,
  nationalStatsAuthoringContract,
  nationalStatsPresentationCoverage,
} from "./statsMetricBindings.js";

// Scenario assetStatus.stats is intentionally a BOOLEAN for library cards.
// Two independently saved definitions both report true. Reviewed country
// baselines must compare the current actual asset to the authored definition,
// not mistake that presence flag for a concurrency version.
export const assertScenarioStatsDefinitionContentsCurrent = (expected, actual) => {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new Error("Statistics definition changed elsewhere or is unavailable. Reload the scenario before applying country baselines.");
  }
  const serialized = (input) => JSON.stringify(serializeStatSheet(
    normalizeStatSheetDefinition(input, { fallbackStandard: false })));
  if (serialized(expected) !== serialized(actual)) {
    throw new Error("Statistics definition changed elsewhere. Reload the scenario and review its country baselines before saving.");
  }
};

const clean = (value) => String(value ?? "").trim();
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const NUMERIC = Object.freeze({
  stability: [0, 100], gdpGrowth: [-100, 100], inflation: [-1000, 1000],
  unemployment: [0, 100], publicDebt: [0, 1000], budgetBalance: [-1000, 1000],
  birthRate: [0, 80], deathRate: [0, 80], birthTrendPerYear: [-2, 2], deathTrendPerYear: [-2, 2],
  agriculture: [0, 100], industry: [0, 100], services: [0, 100],
});
const valueOf = (value, [min, max], name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} needs a number from ${min} to ${max}.`);
  }
  return value;
};
const positiveWhole = (value, name, limit = 1e12) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > limit) throw new Error(`${name} must be a positive whole number (at most ${limit}).`);
  return value;
};
// An uninhabited macro region legitimately has zero people and zero output.
// This is already supported by normalizeCountryStatsMacroEstimate and the
// territorial expansion reducer; only the country aggregate must be positive.
const nonnegativeWhole = (value, name, limit = 1e12) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error(`${name} must be a nonnegative whole number (at most ${limit}); received ${JSON.stringify(value)}.`);
  return value;
};
const requiredText = (value, name) => {
  const result = clean(value);
  if (!result || result.length > 160) throw new Error(`${name} cannot be empty or excessively long.`);
  return result;
};
const indicesOf = (value) => {
  if (!plain(value)) throw new Error("Strategic indices are missing.");
  const indices = {};
  for (const key of DEFAULT_STAT_INDEX_KEYS) indices[key] = valueOf(value[key], [0, 100], key);
  return indices;
};
const customValuesOf = (value, keys) => {
  // An all-native presentation has no independent values to generate. Do not
  // manufacture a customStats entry merely to satisfy the old custom-sheet
  // completeness check. A malformed supplied object is still rejected.
  if (!keys.length && (value === undefined || value === null)) return {};
  if (!plain(value)) throw new Error("Custom values are missing.");
  const customStats = {};
  for (const key of keys) customStats[key] = valueOf(value[key], [-1e18, 1e18], key);
  return customStats;
};

// UI/world key resolution uses the same canonical polity resolver as runtime.
// Do not create a second alias namespace for Stats authoring.
export const scenarioStatsPolityKey = (code, world) => {
  const raw = clean(code);
  if (!raw) return "";
  const resolved = resolvePolityIdentity(raw, world ?? {}, {
    allowUnknown: true, requireActive: false, allowCoreMatch: true, allowStockBase: true,
  });
  return clean(resolved?.resolved) || raw;
};

export const scenarioStatsCoverage = (world, options, { customKeys = null, customDefinition = null } = {}) => {
  const rows = (Array.isArray(options) ? options : []).map((option) => {
    const code = scenarioStatsPolityKey(option?.code, world);
    const sheet = world?.countryStats?.[code] ?? world?.countryStats?.[option?.code];
    const complete = customDefinition && nationalStatsAuthoringContract(customDefinition).custom
      ? nationalStatsPresentationCoverage(customDefinition, sheet).ready
      : Array.isArray(customKeys)
        ? isCompleteCustomCountryStatSheet(sheet, customKeys)
        : isCompleteCountryStatSheet(sheet);
    return { code, name: clean(option?.name) || code, status: complete ? "ready" : sheet ? "incomplete" : "missing" };
  });
  const unique = new Map(rows.filter((row) => row.code).map((row) => [row.code, row]));
  return [...unique.values()];
};

// This marker is written ONLY by the scenario-authoring acceptance/edit paths.
// A generated-but-unapplied proposal does not enter the scenario world.
const markScenarioReviewedBaseline = (sheet, date) => {
  if (!isCanonicalGameDate(date)) return normalizeCountryStatSheet(sheet);
  return normalizeCountryStatSheet({
    ...sheet,
    continuity: {
      ...(sheet?.continuity || {}),
      scenarioBaseline: { version: 1, source: "scenario-author-reviewed", date },
    },
  });
};

export const createScenarioDemographicBaseline = (date, population, values) => {
  const hasRates = ["birthRate", "deathRate", "birthTrendPerYear", "deathTrendPerYear"].some((key) => has(values, key));
  if (!hasRates) return null;
  if (!isCanonicalGameDate(date)) throw new Error("Save a valid scenario starting date before editing demographic conditions.");
  const endDate = addGameDays(date, 18262); // approximately fifty years, finite and native-validated
  const birthRate = valueOf(values.birthRate, NUMERIC.birthRate, "Birth rate");
  const deathRate = valueOf(values.deathRate, NUMERIC.deathRate, "Death rate");
  const birthTrendPerYear = valueOf(values.birthTrendPerYear ?? 0, NUMERIC.birthTrendPerYear, "Birth-rate annual trend");
  const deathTrendPerYear = valueOf(values.deathTrendPerYear ?? 0, NUMERIC.deathTrendPerYear, "Death-rate annual trend");
  return {
    version: 1, sourceDate: date, lastDate: date, endDate,
    basePopulation: positiveWhole(population, "Demographic population"),
    birthRate, deathRate, birthTrendPerYear, deathTrendPerYear,
    creditedBirths: 0, creditedDeaths: 0, birthFraction: 0, deathFraction: 0,
    influences: [],
  };
};

const authoringKeys = (customKeys, customDefinition) => {
  if (!customDefinition) return customKeys;
  // Do not reinterpret the default national sheet as an empty custom sheet
  // because a caller accidentally passed a standard-mode definition.
  const contract = nationalStatsAuthoringContract(customDefinition);
  if (!contract.custom) throw new Error("Native metric authoring requires a custom national Statistics definition.");
  return contract.customKeys;
};

const assertNoProposedBoundCopies = (row, customDefinition) => {
  if (!customDefinition) return;
  assertNoLegacyNativeStatCopies(customDefinition, { customStats: row?.customStats });
};

// The custom-sheet proposal transport produces mapped population/GDP and
// explicitly typed debt/budget readings. It currently initializes other
// economic rates to zero. A native-bound inflation or stability card must NOT
// turn one of those compatibility zeros into an allegedly authored baseline.
const GENERATED_NATIVE_FIELDS = new Set(["gdp", "gdpPerCapita", "totalPopulation", "publicDebt", "budgetBalance"]);
const assertNoInventedBoundNativeValues = (customDefinition, existing) => {
  if (!customDefinition) return;
  const { boundRows } = nationalStatsAuthoringContract(customDefinition);
  for (const row of boundRows) {
    if (GENERATED_NATIVE_FIELDS.has(row.nativeMetric)) continue;
    const path = NATIONAL_NATIVE_METRICS[row.nativeMetric]?.path ?? [];
    const prior = path.reduce((value, key) => value?.[key], existing);
    if (typeof prior !== "number" || !Number.isFinite(prior)) {
      throw new Error(`Native ${row.nativeMetric} has no reviewed starting value; custom-sheet generation cannot invent one. Author that national field explicitly first.`);
    }
  }
};

const proposedCommonFields = (row, { customKeys = null } = {}) => {
  const custom = Array.isArray(customKeys);
  const data = custom ? {} : {
    capital: requiredText(row.capital, "Capital"),
    continent: requiredText(row.continent, "Continent / region"),
    government: requiredText(row.government, "Government"),
    leader: requiredText(row.leader, "Leader"),
    stability: valueOf(row.stability, NUMERIC.stability, "Stability"),
    indices: indicesOf(row.indices),
    gdpBreakdown: {
      agriculture: valueOf(row.agriculture, NUMERIC.agriculture, "Agriculture share"),
      industry: valueOf(row.industry, NUMERIC.industry, "Industry share"),
      services: valueOf(row.services, NUMERIC.services, "Services share"),
    },
  };
  if (!custom && Math.abs(data.gdpBreakdown.agriculture + data.gdpBreakdown.industry + data.gdpBreakdown.services - 100) > 0.001) {
    throw new Error("Agriculture, industry and services must add up to exactly 100%.");
  }
  const values = custom ? customValuesOf(row.customStats, customKeys) : null;
  if (custom) data.customStats = values;
  data.economy = {
    gdpGrowth: custom ? 0 : valueOf(row.gdpGrowth, NUMERIC.gdpGrowth, "GDP growth"),
    inflation: custom ? 0 : valueOf(row.inflation, NUMERIC.inflation, "Inflation"),
    unemployment: custom ? 0 : valueOf(row.unemployment, NUMERIC.unemployment, "Unemployment"),
    publicDebt: valueOf(row.publicDebt, NUMERIC.publicDebt, "Public debt"),
    budgetBalance: valueOf(row.budgetBalance, NUMERIC.budgetBalance, "Budget balance"),
    currency: custom ? "scenario accounting units" : requiredText(row.currency, "Currency"),
  };
  return data;
};

// Only canonical numeric IDs or the exact M-prefixed prompt labels are accepted.
// Numbers supplied as JSON strings are an encoding difference, not a new bucket.
// Zero, negative, fractional, ambiguous, leading-zero and foreign IDs fail closed.
export const parseNativeMacroBucketIndex = (value) => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (!/^(?:M)?[1-9][0-9]*$/.test(label)) return null;
  const parsed = Number(label.replace(/^M/, ""));
  return Number.isSafeInteger(parsed) ? parsed : null;
};

// All geography is supplied by the existing native territorial planner.
// AI provides ONLY bounded values for those exact buckets. It never creates
// geography, sovereignty, or arbitrary total GDP overrides.
export const createReviewedScenarioStatsSheet = ({ row, basis, date, customKeys = null, customDefinition = null, existing = null } = {}) => {
  if (!plain(row)) throw new Error("No country proposal was provided.");
  const expectedCustomKeys = authoringKeys(customKeys, customDefinition);
  // Fail BEFORE assembling map/economic state if the model attempts to write
  // through an explicitly native-bound presentation key.
  assertNoProposedBoundCopies(row, customDefinition);
  if (customDefinition) assertNoLegacyNativeStatCopies(customDefinition, existing);
  assertNoInventedBoundNativeValues(customDefinition, existing);
  const mapped = Array.isArray(basis?.plan) && basis.plan.length > 0;
  if (!mapped) throw new Error("This polity has no authoritative mapped Statistics scope. Review its nonterritorial status manually; do not fabricate territory.");
  const expected = Array.isArray(basis.macroPlan) ? basis.macroPlan : [];
  const receivedRaw = Array.isArray(row.macro) ? row.macro : [];
  if (expected.length === 0 || receivedRaw.length !== expected.length) throw new Error(`Expected ${expected.length} exact native territorial bucket(s).`);
  const expectedIndices = new Set(expected.map((item) => item.index));
  // The native planner defines the identity. A model may repeat the visible
  // prompt label M1 or JSON-encode 1 as a string; these are the same exact ID.
  // Never use array position, model-defined geography or a missing ID to guess.
  const received = receivedRaw.map((item) => ({
    ...item,
    index: parseNativeMacroBucketIndex(item?.index),
  }));
  const actualIndices = received.map((item) => item.index);
  if (new Set(actualIndices).size !== expected.length || actualIndices.some((index) => !expectedIndices.has(index))) {
    // Bounded diagnostic: the planner has at most 12 buckets. These are IDs,
    // not private model prose or any user-authored numerical readings.
    const supplied = receivedRaw.map((item) => typeof item?.index === "string" ? item.index.slice(0, 32) : item?.index ?? null);
    throw new Error(`Territorial bucket identity is missing, duplicated, or outside the actual map. Expected ${JSON.stringify([...expectedIndices])}; received ${JSON.stringify(supplied)}.`);
  }
  for (const entry of received) {
    nonnegativeWhole(entry.population, `Population of regional bucket ${entry.index}`);
    valueOf(entry.gdpPerCapita, [entry.population === 0 ? 0 : 0.000001, 1e9], `GDP per person in bucket ${entry.index}`);
  }
  positiveWhole(received.reduce((sum, entry) => sum + entry.population, 0), "Total proposed territorial population");
  const expanded = expandTerritorialMacroEstimates(expected, received, {
    previousComponents: existing?.territorialComponents ?? [],
  });
  if (expanded.error || !expanded.components.length) throw new Error(expanded.error || "Cannot create a mapped territorial ledger.");
  const canonicalGeographies = expected.flatMap((item) => item.members.map((member) => clean(member.geography).toLowerCase())).sort();
  const receivedGeographies = expanded.components.map((entry) => entry.geography.toLowerCase()).sort();
  if (canonicalGeographies.length !== receivedGeographies.length || canonicalGeographies.some((name, i) => name !== receivedGeographies[i])) {
    throw new Error("The proposed ledger does not cover the exact current map.");
  }
  const proposed = proposedCommonFields(row, { customKeys: expectedCustomKeys });
  const total = expanded.components.reduce((sum, component) => sum + component.population, 0);
  const generated = mergeCountryStatPatch(null, {
    ...proposed,
    territorialScope: "mapped",
    territorialComponents: expanded.components,
  }, { replaceComponents: true });
  if (!generated || generated.population?.total !== total) throw new Error("Territorial population reconciliation failed.");
  const rateInputs = ["birthRate", "deathRate", "birthTrendPerYear", "deathTrendPerYear"]
    .filter((key) => has(row, key));
  // The author reviewed this national reading on the scenario's starting
  // date. GDP/fiscal extrapolation may use that date within native horizons.
  if (isCanonicalGameDate(date)) generated.continuity = { ...(generated.continuity || {}), assessedDate: date };
  if (rateInputs.length) {
    if (!has(row, "birthRate") || !has(row, "deathRate")) throw new Error("Demographics require both birth and death rates.");
    const baseline = createScenarioDemographicBaseline(date, total, row);
    generated.continuity = { ...(generated.continuity || {}), demographicEvolution: baseline };
  }
  // Existing authored values remain authoritative. A request to fill missing
  // fields must never replace the author's component ledger or existing rate
  // clock. Aggregate GDP/population corrections are applied through the native
  // reducer instead of leaving contradictory totals beside the components.
  if (existing && plain(existing)) {
    const previous = normalizeCountryStatSheet(existing);
    if (previous) {
      if (previous.territorialComponents?.length) {
        const actual = previous.territorialComponents.map((component) => clean(component.geography).toLowerCase()).sort();
        if (actual.length !== canonicalGeographies.length || actual.some((name, i) => name !== canonicalGeographies[i])) {
          throw new Error("This country has an authored territorial ledger that no longer matches the scenario map. Review the ownership change before replacing its components.");
        }
      }
      const restored = {
        ...previous,
        ...(previous.territorialComponents?.length ? { territorialComponents: previous.territorialComponents } : {}),
      };
      // Force existing author-entered aggregates back into the newly filled
      // ledger. The existing currency/metadata/indices also take precedence.
      let filled = mergeCountryStatPatch(generated, {
        ...(previous.territorialComponents?.length ? { territorialComponents: previous.territorialComponents } : {}),
        ...Object.fromEntries(["capital", "continent", "government", "leader", "stability", "indices", "indexKeys", "gdpBreakdown", "customStats", "workforce"]
          .filter((key) => has(previous, key)).map((key) => [key, restored[key]])),
        ...(has(previous.population, "total") ? { population: { total: previous.population.total } } : {}),
        ...(has(previous, "economy") ? {
          economy: Object.fromEntries(Object.entries(previous.economy).filter(([key]) => !["gdpPerCapita", "coreGdpPerCapita", "otherGdpPerCapita"].includes(key))),
        } : {}),
      }, { maxAggregateRescale: Infinity, replaceComponents: Boolean(previous.territorialComponents?.length) });
      if (previous.continuity) {
        const mergedContinuity = { ...(generated.continuity || {}), ...previous.continuity };
        if (previous.continuity.demographicClock) delete mergedContinuity.demographicEvolution;
        filled = normalizeCountryStatSheet({ ...filled, continuity: mergedContinuity });
      }
      return markScenarioReviewedBaseline(filled, date);
    }
  }
  return markScenarioReviewedBaseline(generated, date);
};

export const scenarioStatsRequiredReady = (sheet, customKeys = null, customDefinition = null) => (
  customDefinition && nationalStatsAuthoringContract(customDefinition).custom
    ? nationalStatsPresentationCoverage(customDefinition, sheet).ready
    : Array.isArray(customKeys)
      ? isCompleteCustomCountryStatSheet(sheet, customKeys)
      : isCompleteCountryStatSheet(sheet)
);

// Strictly reconstruct editable country fields from existing canonical entries.
// Do not invent 0 for absent GDP, population, or demographics.
export const scenarioStatsEditorValues = (sheet, customKeys = null) => {
  const current = normalizeCountryStatSheet(sheet) || {};
  const evolution = current.continuity?.demographicEvolution;
  const fields = {
    capital: current.capital ?? "", continent: current.continent ?? "",
    government: current.government ?? "", leader: current.leader ?? "",
    stability: current.stability ?? "",
    indices: { ...current.indices },
    population: current.population?.total ?? "", gdp: current.economy?.gdp ?? "",
    currency: current.economy?.currency ?? "",
    gdpGrowth: current.economy?.gdpGrowth ?? "", inflation: current.economy?.inflation ?? "",
    unemployment: current.economy?.unemployment ?? "", publicDebt: current.economy?.publicDebt ?? "",
    budgetBalance: current.economy?.budgetBalance ?? "",
    agriculture: current.gdpBreakdown?.agriculture ?? "",
    industry: current.gdpBreakdown?.industry ?? "", services: current.gdpBreakdown?.services ?? "",
    birthRate: evolution?.birthRate ?? "", deathRate: evolution?.deathRate ?? "",
    birthTrendPerYear: evolution?.birthTrendPerYear ?? "",
    deathTrendPerYear: evolution?.deathTrendPerYear ?? "",
    customStats: { ...current.customStats },
  };
  if (Array.isArray(customKeys)) for (const key of customKeys) fields.customStats[key] ??= "";
  return fields;
};

// Update one existing complete sheet without overwriting its map ledger.
// New sheets MUST first go through the map-aware generated proposal path.
export const applyScenarioStatsManualEdits = ({ sheet, edits, date, customKeys = null, customDefinition = null } = {}) => {
  const before = normalizeCountryStatSheet(sheet);
  const expectedCustomKeys = authoringKeys(customKeys, customDefinition);
  assertNoProposedBoundCopies({ customStats: edits?.customStats }, customDefinition);
  if (customDefinition) assertNoLegacyNativeStatCopies(customDefinition, before);
  if (!before || !Array.isArray(before.territorialComponents) || !before.territorialComponents.length) {
    throw new Error("This country needs a mapped starting baseline first. Generate and review one, then edit it here.");
  }
  const custom = Array.isArray(expectedCustomKeys);
  const proposed = {
    ...(!custom ? {
      capital: requiredText(edits.capital, "Capital"), continent: requiredText(edits.continent, "Continent"),
      government: requiredText(edits.government, "Government"), leader: requiredText(edits.leader, "Leader"),
      stability: valueOf(edits.stability, NUMERIC.stability, "Stability"),
      indices: indicesOf(edits.indices),
      gdpBreakdown: {
        agriculture: valueOf(edits.agriculture, NUMERIC.agriculture, "Agriculture"),
        industry: valueOf(edits.industry, NUMERIC.industry, "Industry"),
        services: valueOf(edits.services, NUMERIC.services, "Services"),
      },
    } : { customStats: customValuesOf(edits.customStats, expectedCustomKeys) }),
    population: { total: positiveWhole(edits.population, "Population") },
    economy: {
      gdp: valueOf(edits.gdp, [1, 1e18], "GDP"),
      ...(custom ? Object.fromEntries(["gdpGrowth", "inflation", "unemployment"]
        .filter((key) => edits[key] !== "" && edits[key] != null)
        .map((key) => [key, valueOf(edits[key], NUMERIC[key], {
          gdpGrowth: "GDP growth", inflation: "Inflation", unemployment: "Unemployment",
        }[key])])) : {
        currency: requiredText(edits.currency, "Currency"),
        gdpGrowth: valueOf(edits.gdpGrowth, NUMERIC.gdpGrowth, "GDP growth"),
        inflation: valueOf(edits.inflation, NUMERIC.inflation, "Inflation"),
        unemployment: valueOf(edits.unemployment, NUMERIC.unemployment, "Unemployment"),
      }),
      publicDebt: valueOf(edits.publicDebt, NUMERIC.publicDebt, "Public debt"),
      budgetBalance: valueOf(edits.budgetBalance, NUMERIC.budgetBalance, "Budget balance"),
    },
  };
  if (!custom && Math.abs(proposed.gdpBreakdown.agriculture + proposed.gdpBreakdown.industry + proposed.gdpBreakdown.services - 100) > 0.001) throw new Error("Sector shares must total 100%.");
  let candidate = mergeCountryStatPatch(before, proposed, { maxAggregateRescale: Infinity });
  const hasBirth = edits.birthRate !== "" && edits.birthRate != null;
  const hasDeath = edits.deathRate !== "" && edits.deathRate != null;
  const hasTrend = ["birthTrendPerYear", "deathTrendPerYear"]
    .some((key) => edits[key] !== "" && edits[key] != null);
  if (!hasBirth && hasTrend) throw new Error("Annual birth/death trends require both base rates; clear all four fields to leave the demographic process unset.");
  if (hasBirth !== hasDeath) throw new Error("Set both birth and death rates, or leave both blank.");
  if (hasBirth) {
    if (before.continuity?.demographicClock) {
      throw new Error("This scenario still carries a legacy fixed demographic clock. Clear that plan through a dedicated transition before authoring evolving rates; two clocks cannot run together.");
    }
    const evolution = createScenarioDemographicBaseline(date, candidate.population.total, {
      birthRate: edits.birthRate, deathRate: edits.deathRate,
      birthTrendPerYear: edits.birthTrendPerYear === "" ? 0 : edits.birthTrendPerYear,
      deathTrendPerYear: edits.deathTrendPerYear === "" ? 0 : edits.deathTrendPerYear,
    });
    candidate = normalizeCountryStatSheet({
      ...candidate,
      continuity: { ...(candidate.continuity || {}), demographicEvolution: evolution },
    });
  } else if (before.continuity?.demographicEvolution && edits.birthRate === "" && edits.deathRate === "") {
    const continuity = { ...(candidate.continuity || {}) };
    delete continuity.demographicEvolution;
    candidate = normalizeCountryStatSheet({ ...candidate, continuity });
  }
  if (!scenarioStatsRequiredReady(candidate, expectedCustomKeys, customDefinition)) throw new Error("The edited country sheet remains incomplete; no changes were saved.");
  return markScenarioReviewedBaseline(candidate, date);
};

// The author can supply aggregate totals without pretending to know a precise
// provincial distribution. The current map determines every component identity;
// the form explicitly discloses that allocation uses native relative weights.
export const authorApprovedMacroEstimates = (basis, population, gdp) => {
  positiveWhole(population, "Population");
  valueOf(gdp, [1, 1e18], "GDP");
  const buckets = Array.isArray(basis?.macroPlan) ? basis.macroPlan : [];
  if (!buckets.length || population < buckets.length) throw new Error("This country needs a valid mapped territorial basis and enough residents for its mapped regions.");
  const weights = buckets.map((bucket) => bucket.members.reduce((sum, member) => sum + Math.max(0.05, Number(member?.weight) || 1), 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => population * weight / totalWeight);
  const populations = raw.map((number) => Math.floor(number));
  let rest = population - populations.reduce((sum, number) => sum + number, 0);
  const sorted = raw.map((number, index) => ({ index, remainder: number - Math.floor(number) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < rest; index += 1) populations[sorted[index].index] += 1;
  // A map with more separate geographies than people cannot receive a fake
  // positive-resident row per geography. Let native apportionment reject it.
  const perCapita = gdp / population;
  return buckets.map((bucket, index) => ({
    index: bucket.index, group: "integrated", population: populations[index], gdpPerCapita: perCapita,
  }));
};
