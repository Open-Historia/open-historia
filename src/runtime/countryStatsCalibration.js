/*! Open Historia — country stats calibration checks © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Stats tool answer checks generateCountryStatSheet runs before a sheet is
// persisted: the macro-bucket rows are decoded, a historical-start answer just
// outside the nominal-scale guard is nudged to its boundary, and the economic
// calibration is audited. Pure and import-light, so node --test can load it
// (gameplay.js cannot be).
import { normalizeCountryStatsMacroEstimate } from "./countryStats.js";
import { parseGameDate } from "./gameDates.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const decodeCountryStatMacroEstimates = (value, macroPlan = []) => {
  const nativePlan = normalizeArray(macroPlan)
    .map((entry, index) => ({
      index: Number(entry?.index) || index + 1,
      memberCount: normalizeArray(entry?.members).length,
    }))
    .filter((entry) => entry.memberCount > 0);

  const text = normalizeString(value);
  if (nativePlan.length > 0) {
    if (!text) {
      return { estimates: [], error: `territorialMacroComponentsText is empty; return exactly ${nativePlan.length} macro estimate row(s).` };
    }

    const estimates = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split("~").map((part) => part.trim());
      if (parts.length !== 4) continue;

      const normalized = normalizeCountryStatsMacroEstimate({
        index: Number(parts[0]),
        group: parts[1],
        population: Number(String(parts[2]).replace(/[,_\s]/g, "")),
        gdpPerCapita: Number(String(parts[3]).replace(/[,_€$£\s]/g, "")),
      });

      if (!normalized || !nativePlan.some((entry) => entry.index === normalized.index)) continue;
      if (estimates.has(normalized.index)) continue;
      estimates.set(normalized.index, normalized);
    }

    const missing = nativePlan.map((entry) => entry.index).filter((index) => !estimates.has(index));
    if (missing.length > 0 || estimates.size !== nativePlan.length) {
      return {
        estimates: [],
        error: `territorialMacroComponentsText must contain exactly one valid row for every native macro bucket; missing index(es): ${missing.join(", ") || "none"}.`,
      };
    }
    return { estimates: nativePlan.map((entry) => estimates.get(entry.index)), error: "" };
  }

  // Compatibility fallback for a valid non-territorial polity with no native map
  // basis. Campaign-supported distributed people/organizations may still provide old
  // group~geography~population~gdpPerCapita rows. NONE explicitly means there is no
  // defensible quantitative population/GDP scope; that is valid and must not invent land.
  if (!text || text.toLowerCase() === "none") return { estimates: [], components: [], error: "" };
  const components = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.trim().split("~").map((part) => part.trim());
    if (parts.length !== 4) continue;
    const [groupRaw, geography, populationRaw, gdpPerCapitaRaw] = parts;
    const group = groupRaw.toLowerCase();
    const population = Number(String(populationRaw).replace(/[,_\s]/g, ""));
    const gdpPerCapita = Number(String(gdpPerCapitaRaw).replace(/[,_€$£\s]/g, ""));
    if (!["core", "integrated", "overseas/dependent"].includes(group)) continue;
    if (!geography || !Number.isFinite(population) || population < 0) continue;
    if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;
    components.push({ geography, group, population: Math.round(population), gdpPerCapita });
  }
  return { estimates: [], components, error: "" };
};


const STATS_ACCOUNTING_BASE_YEAR = 2026;

// The model owns the relative productivity story across native macro/components,
// but tiny arithmetic misses just outside the historical-scale guard should not
// burn both structured-output attempts and leave the Stats pane unusable. When a
// historical-start answer cites NO canonical divergence and lands within 10% of
// the guard boundary, preserve its relative regional pattern and nudge the whole
// component ledger only to that boundary. Larger departures still fail closed.
export const normalizeNearBoundaryHistoricalNominalScale = ({ calibration, components, currentDate } = {}) => {
  const rows = normalizeArray(components);
  if (!rows.length || !calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
    return { components: rows, adjusted: false };
  }

  const mode = normalizeString(calibration?.mode);
  const divergenceEventIds = normalizeArray(calibration?.divergenceEventIds)
    .map(normalizeString)
    .filter(Boolean);
  const anchorYear = Math.trunc(Number(calibration?.anchorYear));
  const rebasedGdpPerCapita = Number(calibration?.rebasedGdpPerCapita2026Eur);
  if (mode !== "historical_start" || divergenceEventIds.length || !Number.isInteger(anchorYear) || !(rebasedGdpPerCapita > 0)) {
    return { components: rows, adjusted: false };
  }

  const totalPopulation = rows.reduce(
    (sum, component) => sum + Math.max(0, Number(component?.population) || 0),
    0,
  );
  const totalGdp = rows.reduce(
    (sum, component) =>
      sum +
      Math.max(0, Number(component?.population) || 0) *
        Math.max(0, Number(component?.gdpPerCapita) || 0),
    0,
  );
  const generatedGdpPerCapita = totalPopulation > 0 ? totalGdp / totalPopulation : 0;
  if (!(generatedGdpPerCapita > 0)) return { components: rows, adjusted: false };

  const currentYear = parseGameDate(currentDate)?.year;
  const elapsedYears = Number.isInteger(currentYear) ? Math.max(0, currentYear - anchorYear) : 0;
  const noEvidenceMultiplier = Math.min(2, 1.35 + elapsedYears * 0.08);
  const lowerBound = 1 / noEvidenceMultiplier;
  const upperBound = noEvidenceMultiplier;
  const scaleRatio = generatedGdpPerCapita / rebasedGdpPerCapita;
  if (scaleRatio >= lowerBound && scaleRatio <= upperBound) {
    return { components: rows, adjusted: false };
  }

  const nearLowerBoundary = scaleRatio < lowerBound && scaleRatio >= lowerBound * 0.9;
  const nearUpperBoundary = scaleRatio > upperBound && scaleRatio <= upperBound * 1.1;
  if (!nearLowerBoundary && !nearUpperBoundary) {
    return { components: rows, adjusted: false };
  }

  const targetRatio = nearLowerBoundary ? lowerBound : upperBound;
  const factor = targetRatio / scaleRatio;
  const adjustedComponents = rows.map((component) => ({
    ...component,
    gdpPerCapita: Math.max(1, Math.round((Number(component?.gdpPerCapita) || 0) * factor * 100) / 100),
  }));
  return {
    components: adjustedComponents,
    adjusted: true,
    beforeRatio: scaleRatio,
    afterRatio: targetRatio,
    factor,
  };
};

export const validateNativeEconomicCalibration = ({
  calibration,
  populationCalibration,
  components,
  eligibleEvidenceIds,
  currentDate,
} = {}) => {
  if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
    return "economicCalibration is required for a fresh/hard-audit native Stats baseline.";
  }

  const allowedModes = new Set(["historical_start", "counterfactual_start", "campaign_reconstruction"]);
  const mode = normalizeString(calibration?.mode);
  const cutoff = normalizeString(calibration?.historyAuthorityCutoff);
  const basis = normalizeString(calibration?.basis);
  const anchorYear = Math.trunc(Number(calibration?.anchorYear));
  const anchorCurrency = normalizeString(calibration?.anchorCurrency).toUpperCase();
  const nominalGdpBillions = Number(calibration?.nominalGdpBillions);
  const nominalGdpPerCapita = Number(calibration?.nominalGdpPerCapita);
  const rebasedGdpPerCapita = Number(calibration?.rebasedGdpPerCapita2026Eur);
  const divergenceEventIds = normalizeArray(calibration?.divergenceEventIds)
    .map(normalizeString)
    .filter(Boolean);

  if (!allowedModes.has(mode)) {
    return `economicCalibration.mode must be historical_start, counterfactual_start, or campaign_reconstruction; received ${mode || "blank"}.`;
  }
  if (!cutoff) return "economicCalibration.historyAuthorityCutoff is required.";
  if (!basis) return "economicCalibration.basis must briefly state the nominal-output evidence used.";
  if (!Number.isInteger(anchorYear) || anchorYear < 1 || anchorYear > 9999) {
    return "economicCalibration.anchorYear must be a real integer year.";
  }
  if (!new Set(["USD", "EUR"]).has(anchorCurrency)) {
    return "economicCalibration.anchorCurrency must be USD or EUR so native code can audit the rebasing scale.";
  }
  if (!(nominalGdpBillions > 0) || !(nominalGdpPerCapita > 0) || !(rebasedGdpPerCapita > 0)) {
    return "economicCalibration nominal GDP, nominal GDP/capita, and rebased 2026-EUR GDP/capita anchors must all be positive.";
  }

  const populationMode = normalizeString(populationCalibration?.mode);
  if (populationMode && populationMode !== mode) {
    return `economicCalibration.mode (${mode}) must match populationCalibration.mode (${populationMode}) for the same baseline.`;
  }

  const eligible = new Set(normalizeArray(eligibleEvidenceIds).map(normalizeString).filter(Boolean));
  const invalidEvidence = divergenceEventIds.filter((id) => !eligible.has(id));
  if (invalidEvidence.length) {
    return `economicCalibration.divergenceEventIds contains event id(s) not present in the bounded fresh economic evidence: ${invalidEvidence.join(", ")}.`;
  }

  // The rebasing factor is an ACCOUNTING conversion only: contemporaneous nominal
  // USD/EUR -> constant 2026 EUR. It must never smuggle PPP/international-dollar
  // purchasing power into the canonical nominal GDP ledger. The modern-era ceiling
  // is intentionally generous enough for CPI + FX movement while still rejecting
  // the classic 2x-3x PPP substitution seen in Belarus-style failures.
  const rebasingFactor = rebasedGdpPerCapita / nominalGdpPerCapita;
  if (anchorYear >= 2000 && anchorYear <= STATS_ACCOUNTING_BASE_YEAR) {
    const maxModernFactor = Math.min(
      3,
      1 + (STATS_ACCOUNTING_BASE_YEAR - anchorYear) * 0.075,
    );
    if (rebasingFactor < 0.45 || rebasingFactor > maxModernFactor) {
      return (
        `economicCalibration rebasing factor ${rebasingFactor.toFixed(2)}x is not credible for a ${anchorYear} ${anchorCurrency} nominal anchor ` +
        `(allowed modern accounting range 0.45x-${maxModernFactor.toFixed(2)}x). Do not substitute PPP/international-dollar output for nominal GDP.`
      );
    }
  }

  const cutoffYearMatch = cutoff.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  const cutoffYear = cutoffYearMatch ? Number(cutoffYearMatch[1]) : null;
  if (mode === "historical_start" && Number.isInteger(cutoffYear) && anchorYear > cutoffYear + 1) {
    return (
      `economicCalibration.anchorYear ${anchorYear} lies after the shared-history cutoff ${cutoffYear}. ` +
      "Later real-world economic outcomes are forbidden after scenario divergence."
    );
  }

  const rows = normalizeArray(components);
  const totalPopulation = rows.reduce(
    (sum, component) => sum + Math.max(0, Number(component?.population) || 0),
    0,
  );
  const totalGdp = rows.reduce(
    (sum, component) =>
      sum +
      Math.max(0, Number(component?.population) || 0) *
        Math.max(0, Number(component?.gdpPerCapita) || 0),
    0,
  );
  const generatedGdpPerCapita = totalPopulation > 0 ? totalGdp / totalPopulation : 0;

  if (mode === "historical_start" && totalPopulation > 0) {
    const impliedAnchorPopulation = (nominalGdpBillions * 1e9) / nominalGdpPerCapita;
    const scopeRatio = impliedAnchorPopulation / totalPopulation;
    if (scopeRatio < 0.6 || scopeRatio > 1.67) {
      return (
        `economicCalibration nominal GDP and GDP/capita imply ${Math.round(impliedAnchorPopulation).toLocaleString()} people, ` +
        `but the authoritative live baseline contains ${Math.round(totalPopulation).toLocaleString()}. ` +
        "The nominal economic anchor appears to use the wrong territorial scope."
      );
    }

    const currentYear = parseGameDate(currentDate)?.year;
    const elapsedYears = Number.isInteger(currentYear) ? Math.max(0, currentYear - anchorYear) : 0;
    const noEvidenceMultiplier = Math.min(2, 1.35 + elapsedYears * 0.08);
    const scaleRatio = generatedGdpPerCapita / rebasedGdpPerCapita;
    const scaleOutsideUnexplainedRange =
      generatedGdpPerCapita > 0 &&
      (scaleRatio > noEvidenceMultiplier || scaleRatio < 1 / noEvidenceMultiplier);

    if (scaleOutsideUnexplainedRange && divergenceEventIds.length === 0) {
      return (
        `Generated nominal GDP/capita (${Math.round(generatedGdpPerCapita).toLocaleString()} 2026-EUR) is ${scaleRatio.toFixed(2)}x the audited ` +
        `historical nominal anchor (${Math.round(rebasedGdpPerCapita).toLocaleString()} 2026-EUR) without any cited canonical economic divergence event. ` +
        "Preserve the nominal historical scale or cite supplied divergenceEventIds that causally justify the departure."
      );
    }
  }

  return "";
};
