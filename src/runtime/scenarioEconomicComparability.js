/*! Open Historia — comparative scale review for scenario-authored national Statistics. */
// A plausibility SCREEN, not a historical truth oracle. All countries on one
// scenario roster share an accounting unit. Plausible real-world disparities
// must be reviewable, never silently rescaled or rejected by ratios alone.

const numeric = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const clean = (value) => String(value ?? "").trim();

export const SCENARIO_GDP_ACCOUNTING_UNIT = "constant 2026 EUR (nominal-output purchasing basis, not PPP)";

export const scenarioEconomicReadings = (sheets, names = {}) => {
  if (!sheets || typeof sheets !== "object" || Array.isArray(sheets)) return [];
  return Object.entries(sheets).flatMap(([code, sheet]) => {
    const population = numeric(sheet?.population?.total);
    const gdp = numeric(sheet?.economy?.gdp);
    // Unset is not zero. A custom/nonmodern scenario may have no comparable GDP.
    if (!(population > 0) || !(gdp > 0)) return [];
    const perCapita = gdp / population;
    if (!Number.isFinite(perCapita) || !(perCapita > 0)) return [];
    return [{ code, name: clean(names[code]) || code, population, gdp, perCapita }];
  }).sort((a, b) => a.code.localeCompare(b.code));
};

// Warn when two substantial populations imply a very wide cross-country
// productivity spread, with the larger population and total output shown for
// human inspection. This is intentionally NOT a validator/rejection criterion:
// modern and historical states can genuinely differ by these factors.
export const auditScenarioEconomicComparability = (sheets, names = {}) => {
  const readings = scenarioEconomicReadings(sheets, names);
  const warnings = [];
  const eligible = readings.filter((row) => row.population >= 1_000_000);
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const first = eligible[i];
      const second = eligible[j];
      const lower = first.perCapita <= second.perCapita ? first : second;
      const higher = lower === first ? second : first;
      const ratio = higher.perCapita / lower.perCapita;
      if (ratio < 8) continue;
      // No arbitrary national wealth floor, but exclude comparisons of two
      // small states whose unusual sectoral concentration is less informative.
      if (Math.max(first.population, second.population) < 10_000_000) continue;
      warnings.push({
        lowerCode: lower.code,
        higherCode: higher.code,
        lowerName: lower.name,
        higherName: higher.name,
        ratio: Math.round(ratio * 10) / 10,
        lowerPerCapita: lower.perCapita,
        higherPerCapita: higher.perCapita,
        lowerPopulation: lower.population,
        higherPopulation: higher.population,
        lowerGdp: lower.gdp,
        higherGdp: higher.gdp,
        // This warning never certifies either amount as historically correct.
        reason: "GDP per resident differs by at least eightfold; review common price basis, legal territorial coverage and independent historical evidence.",
      });
    }
  }
  warnings.sort((a, b) => b.ratio - a.ratio || a.lowerCode.localeCompare(b.lowerCode) || a.higherCode.localeCompare(b.higherCode));
  return { readings, warnings, flaggedCodes: [...new Set(warnings.flatMap((warning) => [warning.lowerCode, warning.higherCode]))].sort() };
};

export const serializeScenarioEconomicComparabilityCsv = (audit) => {
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["lowerCode", "lowerName", "higherCode", "higherName", "perCapitaRatio", "lowerPopulation", "higherPopulation", "lowerGdp", "higherGdp", "lowerGdpPerCapita", "higherGdpPerCapita", "reviewReason"];
  const rows = (Array.isArray(audit?.warnings) ? audit.warnings : []).map((w) => [
    w.lowerCode, w.lowerName, w.higherCode, w.higherName, w.ratio,
    w.lowerPopulation, w.higherPopulation, w.lowerGdp, w.higherGdp,
    w.lowerPerCapita, w.higherPerCapita, w.reason,
  ]);
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
};

// Optional, country-centered summary for human review. The underlying pairwise
// readings remain in the audit and export; wide real-world inequality alone is
// never evidence of a wrong national GDP or grounds to veto scenario saving.
export const summarizeScenarioEconomicComparability = (audit) => {
  const readings = Array.isArray(audit?.readings) ? audit.readings : [];
  const comparisons = Array.isArray(audit?.warnings) ? audit.warnings : [];
  const byCode = new Map();
  for (const comparison of comparisons) {
    for (const side of ["lower", "higher"]) {
      const code = comparison[side + "Code"];
      if (!code) continue;
      const prior = byCode.get(code);
      byCode.set(code, {
        code,
        name: comparison[side + "Name"] || code,
        comparisonCount: (prior?.comparisonCount || 0) + 1,
        maxRatio: Math.max(prior?.maxRatio || 0, comparison.ratio || 0),
      });
    }
  }
  const countries = [...byCode.values()].sort((a, b) =>
    b.comparisonCount - a.comparisonCount
    || b.maxRatio - a.maxRatio
    || a.code.localeCompare(b.code));
  return { readings: readings.length, comparisons: comparisons.length, countries };
};
