/*! Open Historia - accepted-event national Statistics effects.
 * Economic proposals require a canonical territorial ledger; strategic-only
 * proposals require initialized national readings. The countryStats merger
 * remains the sole numerical writer.
 */

import { addGameDays, compareGameDates, isCanonicalGameDate } from "./gameDates.js";
import { normalizeStatsCrisisEstimate, estimateGrowthLimit } from "./statsCrisisEstimate.js";
import { normalizeStatsEconomicEventAccounting } from "./statsEconomicEventAccounting.js";
import { indexRetainedEconomicAssessments } from "./statsEconomicCoverage.js";
import { normalizeStatsEventReceipts, remainingStatsRecoveryLosses } from "./statsEventReceipts.js";
import { fiscalSourceDateOf } from "./statsFiscalClock.js";
import { normalizeCountryStatEconomicInfluences, COUNTRY_STATS_MAX_ECONOMIC_INFLUENCES } from "./countryStats.js";
import { MAX_STAT_INDICES, MAX_CUSTOM_STATS, STAT_INDEX_KEY_PATTERN, normalizeStatSheetDefinition } from "./statIndexDefinitions.js";

const EFFECT_KEYS = new Set(["populationChange", "populationCause", "gdpChangePercent", "gdpCause", "annualRealGrowthDelta", "durationDays", "stabilityDelta", "indexDeltas", "customStatDeltas", "resolveGrowthInfluenceEventId", "recoveryOfEventId", "sourceStorylineId", "debtFinancedOutlayPercentGdp", "debtFinancedOutlayCause", "economicShockEstimate", "assessesUnquantifiedEventId", "reason"]);
const POPULATION_CAUSES = new Set(["births", "deaths", "immigration", "emigration"]);
const GDP_CAUSES = new Set(["production", "destruction", "trade", "policy"]);
const DEBT_OUTLAY_CAUSES = new Set(["procurement", "mobilization", "relief", "reconstruction"]);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const record = (value) => value && typeof value === "object" && !Array.isArray(value);

// The model-facing GM Preview and the canonical event writer must agree on
// whether a dated growth influence is even eligible for the native clock.
// A one-off destruction of GDP stock is not a valid recurring growth cause.
export const validateFiniteEconomicInfluenceForm = (effect, eventDate) => {
  if (!record(effect)) return "";
  if (!has(effect, "annualRealGrowthDelta")) {
    return has(effect, "durationDays") ? "Economic duration requires a finite influence" : "";
  }
  if (!isCanonicalGameDate(eventDate) || typeof effect.annualRealGrowthDelta !== "number"
    || !Number.isFinite(effect.annualRealGrowthDelta) || effect.annualRealGrowthDelta === 0
    || Math.abs(effect.annualRealGrowthDelta) > 20 || !Number.isInteger(effect.durationDays)
    || effect.durationDays < 1 || effect.durationDays > 730
    || !["production", "trade", "policy"].includes(effect.gdpCause)) {
    return "Finite economic influence needs a dated, bounded duration and cause";
  }
  return "";
};

export const planStatsEventEffect = ({ effect, sheet, absoluteStats = null, statSheetDefinition = null, eventId = "", eventDate = "", eventStorylineIds = [], storylines = [], polity = "", receipts = [], historicalEvents = [], resolvePolity = (name) => name } = {}) => {
  // The event applier already owns a rename-safe polity resolver. Reuse it for
  // historical source/receipt identity instead of comparing displayed names.
  const sameCountry = (left, right) => typeof left === "string" && !!left.trim()
    && typeof right === "string" && !!right.trim()
    && String(resolvePolity(left)).trim().toLocaleLowerCase("en-US")
      === String(resolvePolity(right)).trim().toLocaleLowerCase("en-US");
  if (!record(effect) || !record(sheet) || typeof eventId !== "string" || !eventId.trim() || eventId.length > 128) {
    throw new Error("Accepted Statistics effect requires an event identity and canonical sheet");
  }
  if (Object.keys(effect).some((key) => !EFFECT_KEYS.has(key))) throw new Error("Unknown Statistics effect field");
  const reason = effect.reason;
  if (typeof reason !== "string" || !reason.trim() || reason.length > 240) {
    throw new Error("Statistics effect needs a bounded explicit reason");
  }
  // An optional persistent-source link is provenance, NOT numerical authority.
  // A link must belong to the SAME accepted event and the target polity. The
  // World Director already owns ongoing storyline status; Stats must not mint
  // a second crisis process or assume that a storyline implies a numeric rate.
  let sourceStorylineId = null;
  if (has(effect, "sourceStorylineId")) {
    const id = effect.sourceStorylineId;
    const associated = Array.isArray(eventStorylineIds) && eventStorylineIds.includes(id);
    const matches = Array.isArray(storylines) ? storylines.filter((row) => row?.id === id) : [];
    const source = matches.length === 1 ? matches[0] : null;
    const participants = source?.participants;
    const participates = Array.isArray(participants)
      && participants.some((name) => sameCountry(name, polity));
    if (typeof id !== "string" || !id.trim() || id.length > 128
      || !associated || source?.status !== "active" || !participates) {
      throw new Error("Statistics cause must reference an active, event-linked storyline involving the target polity");
    }
    sourceStorylineId = id;
  }
  const population = has(effect, "populationChange");
  const gdp = has(effect, "gdpChangePercent");
  const finite = has(effect, "annualRealGrowthDelta");
  const stability = has(effect, "stabilityDelta");
  const indices = has(effect, "indexDeltas");
  const custom = has(effect, "customStatDeltas");
  const resolves = has(effect, "resolveGrowthInfluenceEventId");
  const recovery = has(effect, "recoveryOfEventId");
  const fiscalOutlay = has(effect, "debtFinancedOutlayPercentGdp");
  const estimated = has(effect, "economicShockEstimate");
  const shockEstimate = estimated ? normalizeStatsCrisisEstimate(effect.economicShockEstimate) : null;
  // A qualitative crisis estimate requires an existing, dated, same-event and
  // same-country canonical source. It is NEVER independent authority to
  // manipulate GDP, debt, residents, stability or an arbitrary index.
  if (estimated && (!shockEstimate || !finite || !sourceStorylineId
    || population || gdp || fiscalOutlay || stability || indices || custom || resolves || recovery
    || !isCanonicalGameDate(eventDate) || effect.durationDays > 90
    || !(effect.annualRealGrowthDelta <= -0.25)
    || effect.annualRealGrowthDelta < -estimateGrowthLimit(shockEstimate)
    || (shockEstimate.channel === "credit" || shockEstimate.channel === "trade"
      ? effect.gdpCause !== "trade" : effect.gdpCause !== "production"))) {
    throw new Error("Unmeasured systemic shock estimate requires a bounded, dated, source-linked production or trade pressure");
  }
  // Closing a national assessment does not close an entire global crisis.
  // Only a new *estimated* country-specific influence may account for one
  // previously unquantified event. The old declaration stays historical.
  let assessesUnquantifiedEventId = null;
  if (has(effect, "assessesUnquantifiedEventId")) {
    const originalId = effect.assessesUnquantifiedEventId;
    const matches = Array.isArray(historicalEvents)
      ? historicalEvents.filter((row) => row?.id === originalId) : [];
    const original = matches.length === 1 ? matches[0] : null;
    const originalAccounting = normalizeStatsEconomicEventAccounting(original?.economicAccounting);
    const priorUnmodeled = originalAccounting?.status === "unquantified"
      || (originalAccounting?.status === "applied" && Array.isArray(originalAccounting.exposures)
        && originalAccounting.exposures.some((entry) => sameCountry(entry.polity, polity)));
    const causal = Array.isArray(storylines)
      ? storylines.filter((row) => row?.id === sourceStorylineId) : [];
    // Never let an unauthenticated/malformed persisted receipt masquerade as
    // prior national settlement. The writer and both economic review readers
    // must apply the same receipt admission shape before duplicate checking.
    const alreadyReceipted = normalizeStatsEventReceipts(receipts).some((row) =>
      sameCountry(row.polity, polity)
      && row.assessesUnquantifiedEventId === originalId);
    // A source ID string alone must not block a real national assessment.
    // Use the SAME validated retained-event evidence as the Country Panel and
    // AI review briefing, including after receipts age out. An older malformed,
    // future, duplicated or foreign-source claim is not prior acceptance.
    const historicalIds = new Map();
    for (const row of Array.isArray(historicalEvents) ? historicalEvents : []) {
      if (typeof row?.id === "string" && row.id.trim()) {
        historicalIds.set(row.id, (historicalIds.get(row.id) || 0) + 1);
      }
    }
    const historicalAssessments = indexRetainedEconomicAssessments({
      events: historicalEvents, date: eventDate, eventIds: historicalIds,
      resolve: resolvePolity, includePrivate: true,
    });
    const alreadyInHistory = (historicalAssessments.get(originalId) || []).some((row) =>
      sameCountry(row.polity, polity)
      && Array.isArray(original?.storylineIds) && original.storylineIds.includes(row.sourceId)
      && isCanonicalGameDate(original?.date)
      && compareGameDates(row.date, original.date) > 0);
    if (typeof originalId !== "string" || !originalId.trim() || originalId.length > 128
      || originalId === eventId || !shockEstimate || !sourceStorylineId
      || !original || !priorUnmodeled
      || !isCanonicalGameDate(original.date) || !isCanonicalGameDate(eventDate)
      || causal.length !== 1 || !isCanonicalGameDate(causal[0].startedDate)
      || compareGameDates(causal[0].startedDate, original.date) > 0
      || compareGameDates(original.date, eventDate) >= 0
      || !Array.isArray(original.storylineIds)
      || !original.storylineIds.includes(sourceStorylineId)
      || alreadyReceipted || alreadyInHistory) {
      throw new Error("Statistics follow-up requires one earlier unmodeled national economic disruption, the same active causal storyline and a new country-specific estimate not already assessed");
    }
    assessesUnquantifiedEventId = originalId;
  }
  if (recovery && (population || gdp || finite || resolves || fiscalOutlay || !(stability || indices || custom))) {
    throw new Error("Statistics recovery can only restore previously measured stability, strategic or custom losses");
  }
  if (resolves && (population || gdp || finite || fiscalOutlay || stability || indices || custom)) {
    throw new Error("Growth influence resolution cannot be combined with another Statistics mutation");
  }
  if (!population && !gdp && !finite && !fiscalOutlay && !stability && !indices && !custom && !resolves) throw new Error("Statistics effect changes no canonical metric");
  // Replay identity is checked before active-process capacity. A previously
  // accepted finite influence is not an invalid *new* process: it is the
  // same event being replayed, and must be diagnosed as such. Per-country
  // accounted IDs are the durable authority even when finite rows expire.
  if (Array.isArray(sheet.continuity?.accountedEventIds)
    && sheet.continuity.accountedEventIds.includes(eventId)) {
    throw new Error("Statistics event already accounted for");
  }
  let resolution = null;
  let resolvedInfluences = null;
  if (resolves) {
    const target = effect.resolveGrowthInfluenceEventId;
    if (!isCanonicalGameDate(eventDate) || typeof target !== "string" || !target.trim()
      || target.length > 128 || target === eventId
      || (record(absoluteStats) && Object.keys(absoluteStats).length > 0)
      || (isCanonicalGameDate(sheet.continuity?.nativeEconomyClock?.lastDate)
        && compareGameDates(eventDate, sheet.continuity.nativeEconomyClock.lastDate) < 0)) {
      throw new Error("Growth influence resolution needs a distinct, dated existing event and no continuity overwrite");
    }
    const existing = sheet.continuity?.economicInfluences;
    const normalized = normalizeCountryStatEconomicInfluences(existing);
    const original = normalized?.find((row) => row.eventId === target);
    if (sourceStorylineId && original?.sourceStorylineId !== sourceStorylineId) {
      throw new Error("Statistics resolution cannot relabel an existing causal source storyline");
    }
    if (!original || Object.hasOwn(original, "resolvedDate")
      || compareGameDates(eventDate, original.startDate) < 0
      || compareGameDates(eventDate, original.endDate) > 0) {
      throw new Error("Growth influence resolution must reference a live, unresolved canonical event");
    }
    resolvedInfluences = normalized.map((row) => row.eventId === target
      ? { ...row, resolvedDate: eventDate, resolvedByEventId: eventId } : row);
    if (!normalizeCountryStatEconomicInfluences(resolvedInfluences)) {
      throw new Error("Growth influence resolution produced invalid canonical state");
    }
    resolution = { eventId: target, resolvedDate: eventDate, resolvedByEventId: eventId };
  }
  if (finite) {
    const finiteError = validateFiniteEconomicInfluenceForm(effect, eventDate);
    if (finiteError) throw new Error(finiteError);
    const existing = sheet.continuity?.economicInfluences || [];
    if (shockEstimate && Array.isArray(existing) && existing.some((row) =>
      row?.economicShockEstimate && row.sourceStorylineId === sourceStorylineId
      && isCanonicalGameDate(row.endDate) && compareGameDates(row.endDate, eventDate) >= 0
      && (!row.resolvedDate || compareGameDates(row.resolvedDate, eventDate) > 0))) {
      throw new Error("A country cannot stack multiple active estimated pressures from the same crisis");
    }
    const active = Array.isArray(existing) ? existing.filter((row) =>
      isCanonicalGameDate(row?.endDate) && compareGameDates(row.endDate, eventDate) >= 0
      && (!row.resolvedDate || compareGameDates(row.resolvedDate, eventDate) > 0)) : [];
    // Preserve the duplicate-event diagnostic even for a finite process
    // received from a partially migrated sheet without accountedEventIds.
    if (Array.isArray(existing) && existing.some((row) => row?.eventId === eventId)) {
      throw new Error("Statistics event already applied as a finite economic influence");
    }
    if (!Array.isArray(existing) || active.length >= COUNTRY_STATS_MAX_ECONOMIC_INFLUENCES
      || (existing.length && !normalizeCountryStatEconomicInfluences(existing))) {
      throw new Error("Finite economic influence violates canonical identity or capacity");
    }
  } else if (has(effect, "durationDays")) throw new Error("Economic duration requires a finite influence");
  if (has(effect, "populationCause") !== population || has(effect, "gdpCause") !== (gdp || finite)) {
    throw new Error("Statistics effect needs a cause for each requested change");
  }
  // Borrowed fiscal spending is a one-off DEBT STOCK change, not a recurring
  // deficit rate and not production destruction. There is no authoritative
  // monetary expenditure in a comparative 0..100 military spending rating.
  // Only a dated, explicitly assessed debt-financed amount may enter here.
  // Never assume that an ordinary war or a unit's strength implies an outlay.
  if (has(effect, "debtFinancedOutlayCause") !== fiscalOutlay) {
    throw new Error("Debt-financed Statistics outlay needs an explicit spending cause");
  }
  if (fiscalOutlay) {
    const amount = effect.debtFinancedOutlayPercentGdp;
    const debt = sheet.economy?.publicDebt;
    const economicGdp = sheet.economy?.gdp;
    const fiscalSourceDate = fiscalSourceDateOf(sheet);
    if (isCanonicalGameDate(fiscalSourceDate) && isCanonicalGameDate(eventDate)
      && compareGameDates(eventDate, fiscalSourceDate) < 0) {
      throw new Error("Debt-financed Statistics outlay cannot precede its established fiscal assessment");
    }
    if (!isCanonicalGameDate(eventDate) || !DEBT_OUTLAY_CAUSES.has(effect.debtFinancedOutlayCause)
      || typeof amount !== "number" || !Number.isFinite(amount)
      || amount < 0.0001 || amount > 5
      || Math.abs(amount * 10000 - Math.round(amount * 10000)) > 1e-7
      || !(typeof debt === "number" && Number.isFinite(debt) && debt >= 0 && debt <= 1000)
      || !(typeof economicGdp === "number" && Number.isFinite(economicGdp) && economicGdp > 0)
      || debt + amount > 1000
      || gdp || population || finite) {
      throw new Error("Debt-financed Statistics outlay requires dated, bounded fiscal/GDP evidence without another GDP or demographic write");
    }
  }
  // Relative effects cannot share their target with an absolute write.
  // Clock-owned monetary/production values are protected regardless of which
  // relative metric is requested; only disjoint top-level writes can coexist.
  // This keeps a saved event from creating two writers for one reading.
  const economyAbsolute = record(absoluteStats?.economy) ? absoluteStats.economy : null;
  const clockOwnedKeys = ["gdp", "gdpPerCapita", "coreGdpPerCapita", "otherGdpPerCapita",
    "gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance"];
  if (stability && has(absoluteStats ?? {}, "stability")) {
    throw new Error("Relative Statistics effect conflicts with an absolute national stability patch");
  }
  const indexDeltas = effect.indexDeltas;
  // gameState merges top-level patch fields, not nested index maps. Combining
  // any absolute indices map with indexDeltas would silently discard the
  // absolute map, even when the keys are disjoint. Refuse that ambiguity.
  if (indices && has(absoluteStats ?? {}, "indices")) {
    throw new Error("Relative Statistics index effect conflicts with an absolute national indices patch");
  }
  if (indices) {
    if (!record(indexDeltas) || !Object.keys(indexDeltas).length
      || Object.keys(indexDeltas).length > MAX_STAT_INDICES) {
      throw new Error("Statistics index effect needs a bounded nonempty map");
    }
    for (const [key, delta] of Object.entries(indexDeltas)) {
      if (!STAT_INDEX_KEY_PATTERN.test(key) || !Object.hasOwn(sheet.indices ?? {}, key)
        || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 20
        || !Number.isInteger(sheet.indices[key])
        || sheet.indices[key] < 0 || sheet.indices[key] > 100
        || sheet.indices[key] + delta < 0 || sheet.indices[key] + delta > 100) {
        throw new Error(`Statistics index ${key} effect lacks an initialized, bounded canonical value`);
      }
    }
  }
  // Scenario-authored metrics belong to customStats, never to a second
  // copy of a bound native reading. Their actual definition is supplied by
  // the authoritative scenario at apply-time, not reconstructed from numbers.
  const customDeltas = effect.customStatDeltas;
  let customPatch = null;
  if (custom) {
    const definition = normalizeStatSheetDefinition(statSheetDefinition, { fallbackStandard: false });
    if (!definition.custom || !record(customDeltas) || !Object.keys(customDeltas).length
      || Object.keys(customDeltas).length > MAX_CUSTOM_STATS) {
      throw new Error("Relative custom Statistics effects require the active custom scenario definition and a bounded map");
    }
    // The countryStats merger shallow-merges nested customStats; refuse any
    // absolute custom map in the same change rather than dropping either map.
    if (has(absoluteStats ?? {}, "customStats")) {
      throw new Error("Relative custom Statistics effect conflicts with an absolute customStats patch");
    }
    const rows = definition.sections.flatMap((section) => section.stats)
      .filter((row) => !row.nativeMetric);
    const definitions = new Map(rows.map((row) => [row.key, row]));
    customPatch = {};
    for (const [key, delta] of Object.entries(customDeltas)) {
      const row = definitions.get(key);
      const before = sheet.customStats?.[key];
      if (!STAT_INDEX_KEY_PATTERN.test(key) || !row
        || typeof before !== "number" || !Number.isFinite(before)
        || typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) {
        throw new Error(`Custom Statistics effect ${key} lacks an initialized, scenario-defined numeric reading`);
      }
      // The UI precision is part of the authored metric's numerical contract.
      // Never silently round an effect away or manufacture precision.
      const decimals = row.decimals;
      const scale = 10 ** decimals;
      const next = before + delta;
      const precise = (number) => Math.abs(number * scale - Math.round(number * scale)) < 1e-6;
      const range = row.kind === "index" || row.kind === "percentage" ? 20 : Math.max(1, Math.abs(before) * 0.2);
      if (!Number.isFinite(next) || Math.abs(next) > 1e18
        || Math.abs(delta) > range || !precise(delta) || !precise(next)
        || (row.kind === "index" && !Number.isInteger(delta))
        || (Number.isFinite(row.minimum) && next < row.minimum)
        || (Number.isFinite(row.maximum) && next > row.maximum)) {
        throw new Error(`Custom Statistics effect ${key} exceeds its precision, native bounds, or scenario range`);
      }
      customPatch[key] = Number(next.toFixed(decimals));
      if (customPatch[key] === before) throw new Error(`Custom Statistics effect ${key} changes no stored reading`);
    }
  }
  if (stability && (!Number.isInteger(effect.stabilityDelta)
    || effect.stabilityDelta === 0 || Math.abs(effect.stabilityDelta) > 20
    || !Number.isInteger(sheet.stability) || sheet.stability < 0 || sheet.stability > 100
    || sheet.stability + effect.stabilityDelta < 0 || sheet.stability + effect.stabilityDelta > 100)) {
    throw new Error("Statistics stability effect lacks an initialized, bounded canonical value");
  }
  if (recovery) {
    const originId = effect.recoveryOfEventId;
    if (typeof originId !== "string" || !originId.trim() || originId.length > 128
      || originId === eventId || !isCanonicalGameDate(eventDate)
      || typeof polity !== "string" || !polity.trim()) {
      throw new Error("Statistics recovery must identify a distinct earlier canonical event and polity");
    }
    const remaining = remainingStatsRecoveryLosses(receipts, { eventId: originId, polity, date: eventDate });
    if (!remaining) throw new Error("Statistics recovery references no earlier, eligible canonical cause");
    const requested = [
      ...(stability ? [["stability", effect.stabilityDelta]] : []),
      ...(indices ? Object.entries(indexDeltas).map(([key, amount]) => [`indices.${key}`, amount]) : []),
      ...(custom ? Object.entries(customDeltas).map(([key, amount]) => [`customStats.${key}`, amount]) : []),
    ];
    for (const [metric, amount] of requested) {
      if (!(amount > 0) || !Object.hasOwn(remaining, metric) || amount > remaining[metric] + 1e-8) {
        throw new Error(`Statistics recovery of ${metric} exceeds its remaining canonical loss`);
      }
    }
  }
  if (record(absoluteStats) && (has(absoluteStats, "territorialComponents")
    || (population && has(absoluteStats, "population"))
    || has(absoluteStats, "gdpBreakdown")
    || (economyAbsolute && clockOwnedKeys.some((key) => has(economyAbsolute, key))))) {
    throw new Error("Relative Statistics effect conflicts with an absolute national patch");
  }
  // Strategic-only effects are valid on era-specific sheets without modern
  // GDP/population coverage. Economic and demographic effects still require the
  // existing complete territorial component ledger and strict numerical baseline.
  const previousPopulation = sheet.population?.total;
  const previousGdp = sheet.economy?.gdp;
  if (population || gdp || finite) {
    if (!Array.isArray(sheet.territorialComponents) || sheet.territorialComponents.length === 0) {
      throw new Error("Statistics effect requires existing territorial accounting");
    }
    if (!Number.isSafeInteger(previousPopulation) || previousPopulation <= 0
      || !(Number.isFinite(previousGdp) && previousGdp > 0 && previousGdp <= 1e18)) {
      throw new Error("Statistics effect has no complete numerical baseline");
    }
  }
  const patch = {};
  if (fiscalOutlay) patch.economy = { publicDebt: Math.round(
    (sheet.economy.publicDebt + effect.debtFinancedOutlayPercentGdp) * 10000,
  ) / 10000 };
  if (stability) patch.stability = sheet.stability + effect.stabilityDelta;
  if (custom) patch.customStats = customPatch;
  if (indices) patch.indices = Object.fromEntries(Object.entries(indexDeltas)
    .map(([key, delta]) => [key, sheet.indices[key] + delta]));
  if (population) {
    const amount = effect.populationChange;
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > previousPopulation * 0.2) {
      throw new Error("Statistics population change is outside native bounds");
    }
    const cause = effect.populationCause;
    if (!POPULATION_CAUSES.has(cause) || ((cause === "births" || cause === "immigration") !== (amount > 0))) {
      throw new Error("Statistics population cause disagrees with the signed change");
    }
    const total = previousPopulation + amount;
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error("Statistics population result is invalid");
    patch.population = { total };
  }
  if (gdp) {
    const percent = effect.gdpChangePercent;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent === 0 || percent < -90 || percent > 100
      || !GDP_CAUSES.has(effect.gdpCause) || (effect.gdpCause === "production" && percent < 0)
      || (effect.gdpCause === "destruction" && percent > 0)) {
      throw new Error("Statistics GDP effect or cause is outside native bounds");
    }
    const nextGdp = Math.round(previousGdp * (1 + percent / 100) * 100) / 100;
    if (!(nextGdp > 0) || nextGdp > 1e18) throw new Error("Statistics GDP effect exceeds canonical bounds");
    const existingDebtRatio = sheet.economy?.publicDebt;
    const debtRatio = typeof existingDebtRatio === "number" && Number.isFinite(existingDebtRatio)
      ? Math.round(existingDebtRatio * previousGdp / nextGdp * 10000) / 10000 : null;
    if (debtRatio !== null && (debtRatio < 0 || debtRatio > 1000)) {
      throw new Error("GDP consequence exceeds bounded public debt accounting");
    }
    patch.economy = { gdp: nextGdp, ...(debtRatio !== null ? { publicDebt: debtRatio } : {}) };
  } else if (population) {
    // Population scaling must not silently destroy/create production through a
    // change in the component ledger's per-capita representation.
    patch.economy = { gdp: previousGdp };
  }
  if (resolution) patch.continuity = { economicInfluences: resolvedInfluences };
  let process = null;
  if (finite) {
    process = { eventId, startDate: eventDate,
      endDate: addGameDays(eventDate, effect.durationDays),
      annualRealGrowthDelta: effect.annualRealGrowthDelta,
      cause: effect.gdpCause, reason: reason.trim(),
      ...(sourceStorylineId ? { sourceStorylineId } : {}),
      ...(shockEstimate ? { economicShockEstimate: shockEstimate } : {}) };
    patch.continuity = { economicInfluences: [
      ...(sheet.continuity?.economicInfluences || []).filter((row) => compareGameDates(row.endDate, eventDate) >= 0
        && (!row.resolvedDate || compareGameDates(row.resolvedDate, eventDate) > 0)),
      process,
    ] };
    if (!normalizeCountryStatEconomicInfluences(patch.continuity.economicInfluences)) {
      throw new Error("Finite economic influence is not valid canonical state");
    }
  }
  return { patch, process, resolution, sourceStorylineId, assessesUnquantifiedEventId,
    recoveryOfEventId: recovery ? effect.recoveryOfEventId : null, reason: reason.trim(), populationCause: population ? effect.populationCause : null,
    gdpCause: (gdp || finite) ? effect.gdpCause : null };
};
