/*! Open Historia Continuum — dynamic native geopolitical power tiers */

import { institutionsForPolity, institutionStrategicPriority } from "./institutions.js";
import { buildPolityIdentityIndex, resolvePolityIdentity } from "./polityIdentity.js";
import { collectActiveScenarioPolityKeys, createScenarioPolityResolver } from "./scenarioPolities.js";

export const POWER_STATUS_SCHEMA_VERSION = 1;
export const POWER_TIERS = Object.freeze(["minor-power", "regional-power", "major-power"]);
export const POWER_REGIONAL_SCORE_MIN = 50;
export const POWER_MAJOR_SCORE_MIN = 75;
export const POWER_INSTITUTIONAL_LEVERAGE_MAX = 18;
export const POWER_STRATEGIC_ACTIVITY_MAX = 9;
const POWER_TIER_SET = new Set(POWER_TIERS);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const array = (value) => Array.isArray(value) ? value : [];
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const hasExactPolityKey = (world, token) => Boolean(
  Object.prototype.hasOwnProperty.call(world?.polityOverrides || {}, token)
  || Object.prototype.hasOwnProperty.call(world?.politicalActors?.byPolity || {}, token)
  || Object.prototype.hasOwnProperty.call(world?.countryStats || {}, token)
  || Object.prototype.hasOwnProperty.call(world?.powerStatus?.byPolity || {}, token)
);

const canonicalPolity = (value, world, identityIndex = null) => {
  const token = clean(value);
  if (!token) return "";
  // Persisted geopolitical state is already keyed by canonical polity identity.
  // Avoid rebuilding the save-wide identity index for the overwhelmingly common
  // exact-key read path (Country badges / prompt summaries can do this hundreds
  // of times in one render).
  if (hasExactPolityKey(world || {}, token)) return token;
  const identity = resolvePolityIdentity(token, world || {}, {
    allowUnknown: true,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
    identityIndex,
  });
  return clean(identity?.resolved || token);
};

export const normalizePowerTier = (value) => {
  const text = lower(value).replace(/_/g, "-");
  if (text === "great-power" || text === "global-power") return "major-power";
  if (text === "middle-power") return "regional-power";
  return POWER_TIER_SET.has(text) ? text : "";
};

export const isFinitePowerScore = (value) => (
  value !== null
  && value !== undefined
  && value !== ""
  && Number.isFinite(Number(value))
);

const normalizePowerRecord = (value, polityKey = "") => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const tier = normalizePowerTier(source.tier || source.powerTier || source.status);
  if (!tier) return null;
  const score = isFinitePowerScore(source.score) ? round1(clamp(source.score, 0, 100)) : null;
  return {
    polityKey: clean(source.polityKey || polityKey),
    tier,
    // Backwards-compatible continuous STRATEGIC weight. Tiering no longer reads
    // this composite because institutional embeddedness is not sovereign power.
    score,
    strategicWeight: isFinitePowerScore(source.strategicWeight)
      ? round1(clamp(source.strategicWeight, 0, 100))
      : score,
    sovereignCapabilityScore: isFinitePowerScore(source.sovereignCapabilityScore)
      ? round1(clamp(source.sovereignCapabilityScore, 0, 100))
      : null,
    institutionalLeverageScore: isFinitePowerScore(source.institutionalLeverageScore)
      ? round1(clamp(source.institutionalLeverageScore, 0, POWER_INSTITUTIONAL_LEVERAGE_MAX))
      : null,
    strategicActivityScore: isFinitePowerScore(source.strategicActivityScore)
      ? round1(clamp(source.strategicActivityScore, 0, POWER_STRATEGIC_ACTIVITY_MAX))
      : null,
    baselineScore: isFinitePowerScore(source.baselineScore ?? source.startingScore)
      ? round1(clamp(source.baselineScore ?? source.startingScore, 0, 100))
      : null,
    basis: clean(source.basis || "generated-estimate"),
    lastUpdatedDate: clean(source.lastUpdatedDate),
    lastUpdatedRound: Math.max(0, Math.trunc(Number(source.lastUpdatedRound) || 0)),
    candidateTier: normalizePowerTier(source.candidateTier),
    candidateRounds: Math.max(0, Math.trunc(Number(source.candidateRounds) || 0)),
    reasons: array(source.reasons).map(clean).filter(Boolean).slice(0, 12),
  };
};

export const normalizePowerStatus = (input, world = {}) => {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const byPolitySource = source.byPolity && typeof source.byPolity === "object" && !Array.isArray(source.byPolity)
    ? source.byPolity
    : source;
  const entries = Object.entries(byPolitySource).filter(([rawKey]) => rawKey !== "schemaVersion");
  const needsIdentityIndex = entries.some(([rawKey]) => !hasExactPolityKey(world || {}, clean(rawKey)));
  const identityIndex = needsIdentityIndex ? buildPolityIdentityIndex(world || {}) : null;
  const byPolity = {};
  for (const [rawKey, rawValue] of entries) {
    const polityKey = canonicalPolity(rawKey, world, identityIndex);
    const record = normalizePowerRecord(rawValue, polityKey);
    if (polityKey && record) byPolity[polityKey] = { ...record, polityKey };
  }
  return { schemaVersion: POWER_STATUS_SCHEMA_VERSION, byPolity };
};

/**
 * Build an in-memory clean slate for a full-world era-relative recalibration.
 * Only explicit authored power overrides for canonical active scenario actors
 * survive. Generated/campaign-derived rows are intentionally removed so an old
 * bad calibration cannot become an anchor for its own replacement. Derived
 * ledgers such as countryStats never define membership in the calibration set.
 */
export const preparePowerStatusForGlobalCalibration = (worldLike, polityInputs = []) => {
  const world = clone(worldLike || {});
  const requested = new Set(array(polityInputs).map(clean).filter(Boolean));
  const resolveScenarioPolity = createScenarioPolityResolver(world);
  const source = world?.powerStatus?.byPolity && typeof world.powerStatus.byPolity === "object"
    ? world.powerStatus.byPolity
    : (world?.powerStatus && typeof world.powerStatus === "object" ? world.powerStatus : {});
  const byPolity = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (rawKey === "schemaVersion" || lower(rawValue?.basis) !== "authored") continue;
    const polityKey = resolveScenarioPolity(rawKey);
    if (!polityKey || !requested.has(polityKey) || byPolity[polityKey]) continue;
    const record = normalizePowerRecord(rawValue, polityKey);
    if (record) byPolity[polityKey] = { ...record, polityKey };
  }

  return {
    ...world,
    powerStatus: {
      schemaVersion: POWER_STATUS_SCHEMA_VERSION,
      byPolity,
    },
  };
};

const actorFor = (world, polity) => world?.politicalActors?.byPolity?.[polity] || null;
const statFor = (world, polity) => world?.countryStats?.[polity] || null;

const activePowerPolities = (world) => collectActiveScenarioPolityKeys(world);

const percentileRank = (value, sorted) => {
  if (!Number.isFinite(value) || !sorted.length) return null;
  if (sorted.length === 1) return 0.5;
  let below = 0;
  let equal = 0;
  for (const candidate of sorted) {
    if (candidate < value) below += 1;
    else if (candidate === value) equal += 1;
  }
  return clamp((below + Math.max(0, equal - 1) / 2) / (sorted.length - 1), 0, 1);
};

export const buildPowerReference = (world) => {
  const polities = activePowerPolities(world);
  const gdp = [];
  const population = [];
  let totalGdp = 0;
  let totalPopulation = 0;
  for (const polity of polities) {
    const sheet = statFor(world, polity);
    const gdpValue = Number(sheet?.economy?.gdp);
    const populationValue = Number(sheet?.population?.total);
    if (Number.isFinite(gdpValue) && gdpValue > 0) {
      gdp.push(gdpValue);
      totalGdp += gdpValue;
    }
    if (Number.isFinite(populationValue) && populationValue > 0) {
      population.push(populationValue);
      totalPopulation += populationValue;
    }
  }
  return {
    polityCount: polities.length,
    gdp: gdp.sort((a, b) => a - b),
    population: population.sort((a, b) => a - b),
    totalGdp,
    totalPopulation,
  };
};

const legacyPowerTier = (world, polity) => {
  const tags = [
    ...array(world?.countryTags?.[polity]),
    ...array(actorFor(world, polity)?.tags),
  ].map(lower);
  if (tags.some((tag) => ["major-power", "great-power", "global-power", "superpower"].includes(tag))) return "major-power";
  if (tags.some((tag) => ["regional-power", "middle-power"].includes(tag))) return "regional-power";
  if (tags.includes("minor-power")) return "minor-power";
  return "";
};

const institutionPowerContribution = (world, polity) => {
  let score = 0;
  const reasons = [];
  for (const { institution, member } of institutionsForPolity(world, polity, { includeSuspended: false })) {
    const priority = institutionStrategicPriority(institution);
    if (member.status !== "member") continue;
    const roleBoost = member.role === "leader" ? 8 : member.role === "leading-member" ? 5 : 0;
    const memberBoost = priority >= 80 ? 1.5 : priority >= 60 ? 0.8 : 0.3;
    score += roleBoost + memberBoost;
    if (roleBoost) reasons.push(`${member.role} of ${institution.name}`);
  }
  return { score: Math.min(POWER_INSTITUTIONAL_LEVERAGE_MAX, score), reasons };
};

const strategicActivityContribution = (world, polity) => {
  const key = lower(polity);
  let score = 0;
  const reasons = [];
  const activeWars = array(world?.wars).filter((war) => ["active", "ceasefire"].includes(lower(war?.status)) && [...array(war?.sideA), ...array(war?.sideB)].some((party) => lower(canonicalPolity(party, world)) === key));
  if (activeWars.length) {
    score += Math.min(5, activeWars.length * 2);
    reasons.push(`central to ${activeWars.length} active conflict${activeWars.length === 1 ? "" : "s"}`);
  }
  const activeAgreements = array(world?.agreements).filter((agreement) => lower(agreement?.status) === "active" && array(agreement?.parties).some((party) => lower(canonicalPolity(party, world)) === key));
  if (activeAgreements.length >= 3) score += Math.min(4, activeAgreements.length * 0.6);
  return { score, reasons };
};

const baselinePowerScore = (world, polity) => {
  const source = world?.powerStatus?.byPolity && typeof world.powerStatus.byPolity === "object"
    ? world.powerStatus.byPolity
    : (world?.powerStatus || {});
  const record = source?.[polity];
  const value = record?.baselineScore ?? record?.startingScore;
  return isFinitePowerScore(value) ? round1(clamp(value, 0, 100)) : null;
};

export const estimateNativePowerScore = (world, polityInput, referenceInput = null) => {
  const polity = canonicalPolity(polityInput, world);
  if (!polity) {
    return {
      score: null,
      strategicWeight: null,
      sovereignCapabilityScore: null,
      institutionalLeverageScore: 0,
      strategicActivityScore: 0,
      reasons: [],
    };
  }
  const sheet = statFor(world, polity);
  const gdp = Number(sheet?.economy?.gdp);
  const population = Number(sheet?.population?.total);
  const reference = referenceInput || buildPowerReference(world);
  let materialScore = 0;
  let evidence = 0;
  const sovereignReasons = [];
  const generatedBaseline = baselinePowerScore(world, polity);

  // Sovereign/material capability is deliberately ERA-RELATIVE. Currency units
  // and the absolute size of a modern economy are not power thresholds; the
  // polity is measured against the other active actors in this campaign world.
  if (Number.isFinite(gdp) && gdp > 0 && reference.gdp.length >= 3 && reference.totalGdp > 0) {
    const percentile = percentileRank(gdp, reference.gdp);
    const share = clamp(gdp / reference.totalGdp, 0, 1);
    materialScore += (percentile ?? 0) * 42 + Math.min(15, Math.sqrt(share) * 45);
    evidence += 1;
    sovereignReasons.push(`GDP rank ${Math.round((percentile ?? 0) * 100)}th percentile; ${round1(share * 100)}% of observed world output`);
  }
  if (Number.isFinite(population) && population > 0 && reference.population.length >= 3 && reference.totalPopulation > 0) {
    const percentile = percentileRank(population, reference.population);
    const share = clamp(population / reference.totalPopulation, 0, 1);
    materialScore += (percentile ?? 0) * 17 + Math.min(6, Math.sqrt(share) * 20);
    evidence += 1;
    sovereignReasons.push(`population rank ${Math.round((percentile ?? 0) * 100)}th percentile; ${round1(share * 100)}% of observed world population`);
  }

  let sovereignCapability = evidence
    ? materialScore
    : (generatedBaseline != null ? generatedBaseline : 0);
  if (!evidence && generatedBaseline != null) sovereignReasons.unshift(`Round-Zero era-relative baseline ${generatedBaseline}`);

  const actor = actorFor(world, polity);
  const tags = [...array(world?.countryTags?.[polity]), ...array(actor?.tags)].map(lower);
  if (tags.includes("nuclear")) {
    sovereignCapability += 8;
    sovereignReasons.push("nuclear capability");
  }

  // These are leverage/relevance, not sovereign capability. They may change how
  // much attention or reach an actor has without changing what it materially IS.
  const institutions = institutionPowerContribution(world, polity);
  const strategic = strategicActivityContribution(world, polity);

  if (!evidence && generatedBaseline == null) {
    const powerSource = world?.powerStatus?.byPolity && typeof world.powerStatus.byPolity === "object"
      ? world.powerStatus.byPolity
      : (world?.powerStatus || {});
    const prior = powerSource?.[polity];
    const priorBasis = lower(prior?.basis);
    // IMPORTANT: never treat a native/campaign fallback tier as new evidence.
    // Only explicit scenario/authored tiers (or old generated-estimate tiers kept
    // for backwards compatibility) may seed sovereign capability when material
    // / generated-baseline evidence is absent.
    const explicitPriorTier = ["authored", "scenario-derived", "generated-estimate"].includes(priorBasis)
      ? normalizePowerTier(prior?.tier || prior?.powerTier || prior?.status)
      : "";
    const legacy = explicitPriorTier || legacyPowerTier(world, polity);
    const legacyScore = legacy === "major-power" ? 70 : legacy === "regional-power" ? 50 : legacy === "minor-power" ? 30 : null;
    if (legacyScore != null) {
      const sovereignScore = round1(clamp(legacyScore, 0, 100));
      const strategicWeight = round1(clamp(sovereignScore + institutions.score + strategic.score, 0, 100));
      return {
        score: strategicWeight,
        strategicWeight,
        sovereignCapabilityScore: sovereignScore,
        institutionalLeverageScore: round1(institutions.score),
        strategicActivityScore: round1(strategic.score),
        reasons: [
          `${legacy} scenario/authored baseline; insufficient relative material data`,
          ...sovereignReasons,
          ...institutions.reasons,
          ...strategic.reasons,
        ].slice(0, 12),
      };
    }
    return {
      score: null,
      strategicWeight: null,
      sovereignCapabilityScore: null,
      institutionalLeverageScore: round1(institutions.score),
      strategicActivityScore: round1(strategic.score),
      reasons: [...sovereignReasons, ...institutions.reasons, ...strategic.reasons].slice(0, 12),
    };
  }

  const sovereignScore = round1(clamp(sovereignCapability, 0, 100));
  const strategicWeight = round1(clamp(sovereignScore + institutions.score + strategic.score, 0, 100));
  return {
    // Preserve `score` as the old continuous strategic-weight API for PWv2
    // completeness and old saves. Tiering below uses sovereignCapabilityScore.
    score: strategicWeight,
    strategicWeight,
    sovereignCapabilityScore: sovereignScore,
    institutionalLeverageScore: round1(institutions.score),
    strategicActivityScore: round1(strategic.score),
    reasons: [...sovereignReasons, ...institutions.reasons, ...strategic.reasons].slice(0, 12),
  };
};

const isUnresolvedFallbackRecord = (record) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (isFinitePowerScore(record.baselineScore ?? record.startingScore)) return false;
  const basis = lower(record.basis);
  if (basis === "native-fallback") return true;
  return basis === "campaign-derived"
    && array(record.reasons).some((reason) => /insufficient relative material data/i.test(clean(reason)));
};

const tierForScore = (score) => {
  if (!isFinitePowerScore(score)) return "";
  if (score >= POWER_MAJOR_SCORE_MIN) return "major-power";
  if (score >= POWER_REGIONAL_SCORE_MIN) return "regional-power";
  return "minor-power";
};

const desiredTierWithHysteresis = (current, score) => {
  if (!current) return tierForScore(score);
  // Generated/authored Round-Zero tiers are an era-aware prior. Native state
  // needs a genuinely sustained structural change to overturn them, so the
  // demotion thresholds sit well below the promotion thresholds.
  if (current === "major-power") return score < 55 ? (score < 32 ? "minor-power" : "regional-power") : "major-power";
  if (current === "regional-power") {
    if (score >= POWER_MAJOR_SCORE_MIN) return "major-power";
    if (score < 35) return "minor-power";
    return "regional-power";
  }
  if (score >= POWER_MAJOR_SCORE_MIN) return "major-power";
  if (score >= POWER_REGIONAL_SCORE_MIN) return "regional-power";
  return "minor-power";
};

export const seedPowerBaselineScore = (worldLike, polityInput, scoreInput, { basis = "generated-relative-baseline", date = "", round = 0, reasons = [] } = {}) => {
  const world = clone(worldLike || {});
  const polity = canonicalPolity(polityInput, world);
  if (!polity || !isFinitePowerScore(scoreInput)) return world;
  const baselineScore = Number(scoreInput);
  const powerStatus = normalizePowerStatus(world.powerStatus, world);
  const normalizedScore = round1(clamp(baselineScore, 0, 100));
  const tier = tierForScore(normalizedScore);
  powerStatus.byPolity[polity] = {
    polityKey: polity,
    tier,
    score: normalizedScore,
    strategicWeight: normalizedScore,
    sovereignCapabilityScore: normalizedScore,
    institutionalLeverageScore: 0,
    strategicActivityScore: 0,
    baselineScore: normalizedScore,
    basis: clean(basis) || "generated-relative-baseline",
    lastUpdatedDate: clean(date),
    lastUpdatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    candidateTier: "",
    candidateRounds: 0,
    reasons: array(reasons).map(clean).filter(Boolean).slice(0, 12),
  };
  return { ...world, powerStatus };
};

export const seedPowerTier = (worldLike, polityInput, tierInput, { basis = "generated-estimate", date = "", round = 0 } = {}) => {
  const world = clone(worldLike || {});
  const polity = canonicalPolity(polityInput, world);
  const tier = normalizePowerTier(tierInput);
  if (!polity || !tier) return world;
  const powerStatus = normalizePowerStatus(world.powerStatus, world);
  const native = estimateNativePowerScore({ ...world, powerStatus }, polity);
  powerStatus.byPolity[polity] = {
    polityKey: polity,
    tier,
    score: native.score,
    strategicWeight: native.strategicWeight,
    sovereignCapabilityScore: native.sovereignCapabilityScore,
    institutionalLeverageScore: native.institutionalLeverageScore,
    strategicActivityScore: native.strategicActivityScore,
    baselineScore: null,
    basis: clean(basis) || "generated-estimate",
    lastUpdatedDate: clean(date),
    lastUpdatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    candidateTier: "",
    candidateRounds: 0,
    reasons: native.reasons,
  };
  return { ...world, powerStatus };
};

export const refreshPowerStatus = (worldLike, { date = "", round = 0, immediate = false } = {}) => {
  const world = clone(worldLike || {});
  const powerStatus = normalizePowerStatus(world.powerStatus, world);
  const polities = activePowerPolities(world);
  const reference = buildPowerReference(world);

  for (const rawPolity of polities) {
    const polity = canonicalPolity(rawPolity, world);
    if (!polity) continue;
    const status = lower(world?.polityOverrides?.[polity]?.status);
    if (["dissolved", "inactive"].includes(status)) {
      delete powerStatus.byPolity[polity];
      continue;
    }
    const native = estimateNativePowerScore({ ...world, powerStatus }, polity, reference);
    const prior = powerStatus.byPolity[polity];
    if (!isFinitePowerScore(native.score)) {
      if (!prior) {
        const legacy = legacyPowerTier(world, polity) || "minor-power";
        powerStatus.byPolity[polity] = {
          polityKey: polity,
          tier: legacy,
          score: null,
          strategicWeight: null,
          sovereignCapabilityScore: null,
          institutionalLeverageScore: native.institutionalLeverageScore,
          strategicActivityScore: native.strategicActivityScore,
          baselineScore: null,
          basis: legacyPowerTier(world, polity) ? "scenario-derived" : "native-fallback",
          lastUpdatedDate: clean(date),
          lastUpdatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
          candidateTier: "",
          candidateRounds: 0,
          reasons: native.reasons,
        };
      } else if (isUnresolvedFallbackRecord(prior)) {
        // Migrate poisoned records created by the pre-fix fallback loop. Those
        // records had a finite campaign-derived score but no baseline/material
        // evidence, usually accompanied by "insufficient relative material
        // data". Keeping that finite score would make old checkpoints continue
        // to look complete even after the null-score bug was fixed. Preserve
        // the visible fallback tier but make the missing evidence explicit.
        powerStatus.byPolity[polity] = {
          ...prior,
          score: null,
          strategicWeight: null,
          sovereignCapabilityScore: null,
          institutionalLeverageScore: native.institutionalLeverageScore,
          strategicActivityScore: native.strategicActivityScore,
          baselineScore: null,
          basis: legacyPowerTier(world, polity) ? "scenario-derived" : "native-fallback",
          lastUpdatedDate: clean(date) || prior.lastUpdatedDate || "",
          lastUpdatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
          candidateTier: "",
          candidateRounds: 0,
          reasons: native.reasons.length ? native.reasons : ["awaiting era-relative power evidence"],
        };
      }
      continue;
    }

    const sovereignTierScore = isFinitePowerScore(native.sovereignCapabilityScore)
      ? native.sovereignCapabilityScore
      : native.score;
    const currentTier = prior?.tier || legacyPowerTier(world, polity) || tierForScore(sovereignTierScore);
    const desired = desiredTierWithHysteresis(currentTier, sovereignTierScore);
    let tier = currentTier;
    let candidateTier = "";
    let candidateRounds = 0;
    if (desired !== currentTier) {
      if (immediate) {
        tier = desired;
      } else if (prior?.candidateTier === desired) {
        candidateTier = desired;
        // Hysteresis counts campaign progression, not function calls. Several
        // native subsystems can refresh power status during one completed round
        // (event impacts, diplomacy, institution updates, final reconciliation).
        // Re-running in that same round must not promote/demote a polity twice.
        const currentRound = Math.max(0, Math.trunc(Number(round) || 0));
        const priorRound = Math.max(0, Math.trunc(Number(prior?.lastUpdatedRound) || 0));
        candidateRounds = Math.max(1, Number(prior.candidateRounds) || 0);
        if (currentRound > priorRound) candidateRounds += 1;
        if (candidateRounds >= 2) {
          tier = desired;
          candidateTier = "";
          candidateRounds = 0;
        }
      } else {
        candidateTier = desired;
        candidateRounds = 1;
      }
    }
    powerStatus.byPolity[polity] = {
      polityKey: polity,
      tier,
      score: native.score,
      strategicWeight: native.strategicWeight,
      sovereignCapabilityScore: native.sovereignCapabilityScore,
      institutionalLeverageScore: native.institutionalLeverageScore,
      strategicActivityScore: native.strategicActivityScore,
      baselineScore: prior?.baselineScore ?? null,
      basis: prior?.basis === "authored" && tier === prior.tier ? "authored" : (prior?.basis === "generated-relative-baseline" ? "generated-relative-baseline" : "campaign-derived"),
      lastUpdatedDate: clean(date) || prior?.lastUpdatedDate || "",
      lastUpdatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
      candidateTier,
      candidateRounds,
      reasons: native.reasons,
    };
  }

  return { ...world, powerStatus };
};

export const powerTierForPolity = (world, polityInput) => {
  const polity = canonicalPolity(polityInput, world);
  const source = world?.powerStatus?.byPolity && typeof world.powerStatus.byPolity === "object"
    ? world.powerStatus.byPolity
    : (world?.powerStatus || {});
  // Read the one record we need. Normalizing the entire 202-polity ledger for
  // every Country-tag lookup caused an O(polities² × regions) startup blow-up
  // once the geopolitical baseline had actually been applied.
  const direct = source?.[polity];
  const existing = normalizePowerTier(direct?.tier || direct?.powerTier || direct?.status);
  if (existing) return existing;
  const wanted = lower(polity);
  if (wanted) {
    for (const [rawKey, rawValue] of Object.entries(source || {})) {
      if (rawKey === "schemaVersion" || lower(rawKey) !== wanted) continue;
      const fallback = normalizePowerTier(rawValue?.tier || rawValue?.powerTier || rawValue?.status);
      if (fallback) return fallback;
    }
  }
  return legacyPowerTier(world, polity) || "minor-power";
};

// Bounded decision-facing profile. Coarse tier remains useful for UI/history, but
// the simulator also needs the continuous difference between two actors in the
// same tier. Membership/leverage is surfaced separately so alliance density can
// affect reach/attention without pretending it is independent material power.
export const powerDecisionProfileForPolity = (world, polityInput) => {
  const polity = canonicalPolity(polityInput, world);
  if (!polity) {
    return {
      tier: "minor-power",
      strategicWeight: null,
      sovereignCapabilityScore: null,
      institutionalLeverageScore: 0,
      strategicActivityScore: 0,
    };
  }
  const native = estimateNativePowerScore(world, polity);
  return {
    tier: powerTierForPolity(world, polity),
    strategicWeight: native.strategicWeight,
    sovereignCapabilityScore: native.sovereignCapabilityScore,
    institutionalLeverageScore: native.institutionalLeverageScore,
    strategicActivityScore: native.strategicActivityScore,
  };
};
