/*! Open Historia - explicit, guarded, one-metric-at-a-time legacy Statistics reconciliation.
 * The author chooses authority and scope. This module never guesses that zero is unset,
 * infers GDP units, or writes directly to a scenario. The caller saves guarded patches.
 */
import { NATIONAL_NATIVE_METRICS } from "./statIndexDefinitions.js";
import { nationalStatsAuthoringContract } from "./statsMetricBindings.js";
import { reviewScenarioNationalMetricAliases } from "./statsMetricAliasReview.js";
import { planBoundNationalStatsAliasArchival } from "./statsBoundAliasArchival.js";
import { normalizeCountryStatSheet } from "./countryStats.js";

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const pathValue = (object, path) => path.reduce((value, key) => value?.[key], object);
const maxCustomEntries = 60;
const blockedPromotion = new Set(["gdp", "gdpPerCapita", "totalPopulation"]);
const allowedModes = new Set(["keep-native", "promote-legacy"]);
const allowedScopes = new Set(["all", "matching", "different", "native-zero"]);
const safeArchiveKey = (base, used) => {
  for (let number = 1; number <= 1000; number += 1) {
    const tail = number === 1 ? "" : String(number);
    const name = base.slice(0, 40 - tail.length) + tail;
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
  }
  throw new Error("No unique archival key is available for the previous native value.");
};

const matchesScope = (entry, scope) => {
  if (scope === "all") return true;
  if (scope === "matching") return entry.status === "same-reading";
  if (scope === "different") return entry.status === "different";
  return entry.nativeValue === 0 && entry.customValue !== 0;
};

/** Audit-only plan; no inference, normalization of absent numeric fields, or mutations. */
export const planBoundNationalStatsAliasReconciliation = ({
  definition, world, roster, metricKey, mode, scope = "all",
} = {}) => {
  const { custom, boundRows, customKeys } = nationalStatsAuthoringContract(definition);
  if (!custom || typeof metricKey !== "string" || !metricKey) {
    throw new Error("Choose an explicitly native-bound custom Statistics card.");
  }
  const selected = boundRows.filter((row) => row.key === metricKey);
  if (selected.length !== 1) throw new Error("Selected card is missing or ambiguously bound.");
  if (!allowedModes.has(mode) || !allowedScopes.has(scope)) {
    throw new Error("Choose an explicit reconciliation action and population scope.");
  }
  const native = NATIONAL_NATIVE_METRICS[selected[0].nativeMetric];
  if (!native) throw new Error("The selected native statistic is not recognized.");
  if (mode === "promote-legacy" && blockedPromotion.has(selected[0].nativeMetric)) {
    throw new Error("Population, GDP and GDP per capita belong to the territorial accounting ledger. Reconcile their units and totals through dedicated map-aware editing, or explicitly keep native values.");
  }
  // Use precisely the selected bound definition for the established lossless
  // archive planner. Unselected custom Statistics must stay independently owned.
  const focused = {
    custom: true,
    sections: (definition?.sections || []).map((section) => ({
      ...section,
      stats: (section.stats || []).filter((stat) => stat.key === metricKey && stat.nativeMetric === selected[0].nativeMetric),
    })).filter((section) => section.stats.length > 0),
  };
  const selectedRoster = [];
  const requested = new Set();
  for (const option of Array.isArray(roster) ? roster : []) {
    const code = String(option?.code ?? "").trim();
    if (!code || requested.has(code)) continue;
    requested.add(code);
    const sheet = world?.countryStats?.[code];
    if (!sheet) continue;
    const matching = reviewScenarioNationalMetricAliases(definition, sheet)
      .filter((entry) => entry.reviewRequired && entry.nativeMetric === selected[0].nativeMetric
        && (entry.key === selected[0].key || entry.key === selected[0].nativeMetric));
    if (matching.length > 0 && matching.every((entry) => matchesScope(entry, scope))) selectedRoster.push(option);
  }
  const archival = planBoundNationalStatsAliasArchival({ definition: focused, world, roster: selectedRoster });
  const patches = {};
  const entries = [];
  for (const [code, archived] of Object.entries(archival.patches)) {
    const prior = world.countryStats[code];
    const countryEntries = archival.entries.filter((entry) => entry.countryCode === code);
    let patch = archived;
    if (mode === "promote-legacy") {
      if (countryEntries.length !== 1) {
        throw new Error(`${code}: multiple legacy aliases target one native reading; resolve them individually before promoting.`);
      }
      const entry = countryEntries[0];
      const current = pathValue(prior, native.path);
      const intended = entry.legacyValue;
      if (!finite(current) || !finite(intended) || intended < native.minimum
        || (native.maximum !== undefined && intended > native.maximum)) {
        throw new Error(`${code}: the legacy ${metricKey} value is outside the native metric's validated range.`);
      }
      // Index-based native fields are whole-number readings: silently rounding a
      // fractional author's value would discard evidence.
      if (native.kind === "index" && !Number.isInteger(intended)) {
        throw new Error(`${code}: native index values must be whole numbers; resolve the legacy fraction manually.`);
      }
      const continuity = prior.continuity || {};
      if (intended !== current && (
        own(continuity, "nativeEconomyClock") || own(continuity, "gdpTrendClock")
        || own(continuity, "fiscalClock") || own(continuity, "budgetClock")
      )) {
        throw new Error(`${code}: an active economic continuity cursor exists. This baseline cannot be rebased by a bulk legacy migration.`);
      }
      const used = new Set([...Object.keys(patch.customStats || {}), ...customKeys, ...boundRows.map((row) => row.key)].map((key) => key.toLowerCase()));
      const custom = { ...patch.customStats };
      if (intended !== current) {
        const priorKey = safeArchiveKey(`archivedPriorNative${selected[0].nativeMetric[0].toUpperCase() + selected[0].nativeMetric.slice(1)}`, used);
        custom[priorKey] = current;
      }
      if (Object.keys(custom).length > maxCustomEntries) {
        throw new Error(`${code}: preserving both prior native and legacy values exceeds the custom Statistics limit.`);
      }
      // Replace only the selected canonical scalar, never aggregate-derived GDP,
      // population or components. Preserve every other field exactly.
      const field = native.path.at(-1);
      if (native.path.length === 1) {
        patch = { ...patch, [field]: intended, customStats: custom };
      } else {
        const parent = native.path[0];
        patch = { ...patch, [parent]: { ...patch[parent], [field]: intended }, customStats: custom };
      }
      const roundTripped = normalizeCountryStatSheet(patch);
      if (!roundTripped || pathValue(roundTripped, native.path) !== intended
        || Object.entries(custom).some(([key, value]) => !own(roundTripped.customStats, key) || !Object.is(roundTripped.customStats[key], value))) {
        throw new Error(`${code}: reconciliation does not survive normalized save/reload without value loss.`);
      }
      for (const key of ["population", "territorialComponents", "territorialScope"]) {
        if (JSON.stringify(patch[key]) !== JSON.stringify(archived[key])) {
          throw new Error(`${code}: unexpected change to canonical territory or population.`);
        }
      }
      for (const [key, value] of Object.entries(archived.economy || {})) {
        if (key !== native.path[1] && !Object.is(patch.economy?.[key], value)) {
          throw new Error(`${code}: reconciliation changed an unrelated canonical economic reading.`);
        }
      }
    }
    patches[code] = patch;
    entries.push(...countryEntries.map((entry) => ({
      ...entry, decision: mode, nativeAfter: mode === "promote-legacy" ? entry.legacyValue : entry.nativeValue,
    })));
  }
  return { patches, originals: archival.originals, entries, countries: Object.keys(patches).length,
    disagreements: entries.filter((entry) => !entry.equal).length };
};
