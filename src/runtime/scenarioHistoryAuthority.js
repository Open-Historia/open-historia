/*! Open Historia Continuum - universal scenario reference-authority boundary */

import { addGameDays, compareGameDates, isGameDate, normalizeGameDate } from "./gameDates.js";
import { readScenarioCanon } from "./scenarioCanon.js";

const clean = (value) => String(value ?? "").trim();

export const isValidScenarioDate = (value) => isGameDate(value);

export const compareScenarioDates = (left, right) => {
  if (!isGameDate(left) || !isGameDate(right)) return null;
  return compareGameDates(left, right);
};

export const previousScenarioDate = (value) => isGameDate(value) ? addGameDays(value, -1) : "";

export const resolveScenarioHistoryAuthority = ({ world = {}, scenarioDate = "" } = {}) => {
  const startDate = isGameDate(scenarioDate) ? normalizeGameDate(scenarioDate) : clean(scenarioDate);
  const canon = readScenarioCanon(world);

  if (!canon.initialized) {
    return {
      canonInitialized: false,
      referenceAuthority: "legacy-campaign-start",
      referenceAllowed: Boolean(startDate),
      cutoffDate: startDate,
      cutoffInclusive: true,
      referenceHorizonDate: isGameDate(startDate) ? normalizeGameDate(startDate) : "",
      divergenceDate: "",
      scenarioStartDate: startDate,
      universeId: "",
      universeType: "custom",
    };
  }

  const context = canon.canonContext ?? {};
  const referenceAuthority = clean(context.referenceAuthority) || "none";
  const rawDivergenceDate = clean(context.divergence?.date);
  const divergenceDate = isGameDate(rawDivergenceDate) ? normalizeGameDate(rawDivergenceDate) : rawDivergenceDate;
  const universeId = clean(context.universe?.id);
  const universeType = clean(context.universe?.type) || "custom";

  if (referenceAuthority === "round-zero-only") {
    return {
      canonInitialized: true,
      referenceAuthority,
      referenceAllowed: Boolean(startDate),
      cutoffDate: startDate,
      cutoffInclusive: true,
      referenceHorizonDate: isGameDate(startDate) ? normalizeGameDate(startDate) : "",
      divergenceDate,
      scenarioStartDate: startDate,
      universeId,
      universeType,
    };
  }

  if (referenceAuthority === "pre-divergence-only") {
    const hasDivergence = Boolean(divergenceDate);
    return {
      canonInitialized: true,
      referenceAuthority,
      referenceAllowed: hasDivergence,
      cutoffDate: divergenceDate,
      cutoffInclusive: false,
      referenceHorizonDate: isGameDate(divergenceDate) ? previousScenarioDate(divergenceDate) : "",
      divergenceDate,
      scenarioStartDate: startDate,
      universeId,
      universeType,
    };
  }

  return {
    canonInitialized: true,
    referenceAuthority: "none",
    referenceAllowed: false,
    cutoffDate: "",
    cutoffInclusive: false,
    referenceHorizonDate: "",
    divergenceDate,
    scenarioStartDate: startDate,
    universeId,
    universeType,
  };
};

export const isReferenceDatePermitted = (value, authority = {}) => {
  const date = clean(value);
  const cutoff = clean(authority?.cutoffDate);
  if (!authority?.referenceAllowed || !isGameDate(date) || !isGameDate(cutoff)) return false;
  const comparison = compareGameDates(date, cutoff);
  return authority?.cutoffInclusive ? comparison <= 0 : comparison < 0;
};
