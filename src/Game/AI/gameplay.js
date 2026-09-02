/*! Open Historia — portions (briefing dossiers + timeout/fallback hardening) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { curateGeneratedEvents } from "./nativeTimelineCurator.js";
import { directGeneratedUnitOps } from "./nativeUnitDirector.js";
import { directGeneratedTerritoryOps } from "./nativeTerritoryDirector.js";
import {
  applyWorldStorylineUpdates,
  assessRecentWorldConsequenceLiveness,
  buildWorldInitiativeContext,
  decodeWorldStorylineUpdates,
  findWorldStorylineAntiStasisIssues,
  normalizeWorldStorylineEventLinks,
  stripQuietDeferredStorylineUpdates,
  validateWorldStorylinePayload,
} from "./nativeWorldDirector.js";
import {
  deriveWorldExplorationAudit,
  screenGeneratedWorldEvents,
  stripWorldSweepAudit,
  validateWorldExplorationAudit,
} from "./nativeWorldIntegrity.js";
import {
  applyWarUpdates,
  bindWarUpdatesToEvents,
  buildCanonicalWarContext,
  decodeWarUpdates,
  reconcileCombatWarState,
  stripUnsupportedUnitAttackOps,
  validateCanonicalWarEvents,
  validateWarLedgerPayload,
} from "./nativeWarLedger.js";
import {
  applyDiplomaticUpdates,
  bindAgreementUpdatesToEvents,
  bindRelationUpdatesToEvents,
  buildBoundedDiplomaticContext,
  decodeAgreementUpdates,
  decodeRelationUpdates,
  migrateLegacyDiplomaticState,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";
import { callAI } from "./main.jsx";
import { isContextDiagnosticsEnabled, logContextDiagnostics, resolveTemplateVariableDemand } from "./contextDiagnostics.js";
import { NATIVE_GAME_MASTER_PROMPT, normalizePromptPack } from "./gameplayPrompts.js";
import {
  decodeGameMasterTransportPayload,
  getGameplayTool,
  validateGameplayPayload,
} from "./gameplaySchemas.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import {
  appendCountryStatHistorySample,
  captureCountryStatsHistory,
  expandTerritorialMacroEstimates,
  COUNTRY_STATS_POPULATION_CALIBRATION_VERSION,
  COUNTRY_STATS_TRACKING_MAX_POLITIES,
  countryStatsTrackingMonthsElapsed,
  finalizeCountryStatSheet,
  guardCountryStatContinuity,
  isCompleteCountryStatSheet,
  mergeCountryStatPatch,
  normalizeCountryStatSheet,
  normalizeCountryStatsTracking,
} from "../../runtime/countryStats.js";
import {
  buildActionHistoryText,
  buildChatSummaryText,
  buildDetailedChatHistoryText,
  buildEventHistoryText,
  buildPromptContext,
  getUnconsolidatedEvents,
  renderTemplate,
  resolveHelperValues,
} from "./promptContext.js";
import {
  JSON_URLS,
  loadCountryNames,
  loadRegionCatalog,
  loadScenarioRegionCatalog,
  readJson,
  writeJson,
} from "../../runtime/assets.js";
import {
  applyCountryStatPatchToWorld,
  applyEventImpactsToWorld,
  chatParticipantSetKey,
  mergeIncomingChats,
  normalizeActionEntry,
  normalizeActions,
  normalizeChatEntry,
  normalizeChats,
  normalizeEvents,
  normalizeGameData,
  normalizeWorldState,
  readActionsState,
  readChatsState,
  reconcileChatsForPlayer,
  reconcileStableChatsForPlayer,
  resolveChatParticipantIdentity,
  readEventsState,
  readGameData,
  readCountryStatsBundle,
  readGameStateBundle,
  readWorldState,
  readWorldStateView,
  primeCountryStatsWorkerCommit,
  writeActionsState,
  writeChatsState,
  writeEventsState,
  writeGameData,
  writeWorldState,
} from "../../runtime/gameState.js";
import { dedupeGeneratedEvents } from "../../runtime/eventDedup.js";
import { allocateCanonicalTurnEventIds, remapLedgerEventIds } from "../../runtime/eventIdentity.js";
import { difficultyDirective } from "../../runtime/difficulty.js";
import { MAP_SETTING_KEYS, getMapSetting } from "../../runtime/mapSettings.js";

const CHAT_HINT_PATTERNS = [
  /\bchat\b/i,
  /\bconference\b/i,
  /\bcontact\b/i,
  /\bdiplomac/i,
  /\bmeet\b/i,
  /\bmessage\b/i,
  /\bnegotiat/i,
  /\boutreach\b/i,
  /\bparley\b/i,
  /\bpeace talk/i,
  /\breach out\b/i,
  /\bspeak with\b/i,
  /\bsummit\b/i,
  /\btalk to\b/i,
  /\btalks? with\b/i,
  /\bпереговор/i,
  /\bвстрет/i,
  /\bдипломат/i,
  /\bсвяз/i,
  /\bчат/i,
  /\bдоговор/i,
];

const DEFAULT_SUGGESTION_TOPICS = [
  {
    title: "Stabilize the domestic front",
    description: "Keep the home front orderly and reduce the chance of internal drift while outside pressure builds.",
  },
  {
    title: "Shape the diplomatic field",
    description: "Use talks, signals, and leverage to narrow hostile options before the next crisis hardens.",
  },
  {
    title: "Prepare military leverage",
    description: "Create visible readiness and practical reserves so rivals must factor your capability into their plans.",
  },
  {
    title: "Secure economic depth",
    description: "Expand the industrial and fiscal base that decides whether later gambles are sustainable.",
  },
];

const decodeCountryStatMacroEstimates = (value, macroPlan = []) => {
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

      const index = Number(parts[0]);
      const group = parts[1].toLowerCase();
      const population = Number(String(parts[2]).replace(/[,_\s]/g, ""));
      const gdpPerCapita = Number(String(parts[3]).replace(/[,_€$£\s]/g, ""));

      if (!Number.isInteger(index) || !nativePlan.some((entry) => entry.index === index)) continue;
      if (!["core", "integrated", "overseas/dependent"].includes(group)) continue;
      if (!Number.isFinite(population) || population < 0) continue;
      if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;
      if (estimates.has(index)) continue;

      estimates.set(index, {
        index,
        group,
        population: Math.round(population),
        gdpPerCapita,
      });
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

  // Compatibility fallback for landless/custom scenarios with no native map basis.
  // In that rare path, accept the old group~geography~population~gdpPerCapita rows
  // and return them as ready-made components rather than inventing macro geography.
  if (!text) return { estimates: [], components: [], error: "" };
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

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const relationPairKeyForHistory = (a, b) => [normalizeString(a), normalizeString(b)]
  .filter(Boolean)
  .sort((left, right) => left.toLocaleLowerCase().localeCompare(right.toLocaleLowerCase()))
  .join(" ↔ ");

const parseIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeString(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1] ? { day, month, year } : null;
};

const STATS_ACCOUNTING_BASE_YEAR = 2026;

const validateNativeEconomicCalibration = ({
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

    const currentYear = parseIsoDate(currentDate)?.year;
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

const addIsoDays = (value, days) => {
  const parsed = parseIsoDate(value);
  if (!parsed) return "";
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parsed.year, parsed.month - 1, parsed.day);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) return "";
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

export const validateTimelineDates = ({ candidate, mode, originDate, targetDate, requireAdvance = false }) => {
  const stopDate = normalizeString(candidate?.stopDate);
  if (!parseIsoDate(originDate)) {
    const eventDates = normalizeArray(candidate?.events).map((event) => normalizeString(event?.date));
    const outputDates = [stopDate, ...eventDates];
    const malformedIsoIndex = outputDates.findIndex((date) => /^\d{4}-/.test(date) && !parseIsoDate(date));
    if (malformedIsoIndex >= 0) {
      const path = malformedIsoIndex === 0 ? "$.stopDate" : `$.events[${malformedIsoIndex - 1}].date`;
      return `${path} must be a real Gregorian date when using YYYY-MM-DD format.`;
    }
    // A whole-day advance was requested but the model kept the clock where it
    // was — the stuck-save signature (it then re-simulates the past instead of
    // the future). Reject on the strict attempt so the retry moves time forward.
    if (requireAdvance && stopDate && stopDate === normalizeString(originDate)) {
      return `$.stopDate must move time forward - it must not equal the current date ${originDate}.`;
    }
    if (parseIsoDate(stopDate)) {
      let previousDate = "";
      for (let index = 0; index < eventDates.length; index += 1) {
        if (!parseIsoDate(eventDates[index])) return `$.events[${index}].date must use the same YYYY-MM-DD format as $.stopDate.`;
        if (eventDates[index] > stopDate) return `$.events[${index}].date must not be later than ${stopDate}.`;
        if (previousDate && eventDates[index] < previousDate) return `$.events[${index}].date must not precede the previous event date.`;
        previousDate = eventDates[index];
      }
    }
    return "";
  }
  if (!parseIsoDate(stopDate)) return `$.stopDate must be a real date in YYYY-MM-DD format; received ${stopDate || "an empty value"}.`;
  if (mode === "auto") {
    if (stopDate <= originDate || stopDate > targetDate) {
      return `$.stopDate must be after ${originDate} and no later than ${targetDate}.`;
    }
  } else if (stopDate !== targetDate) {
    return `$.stopDate must equal the requested target date ${targetDate}.`;
  }

  let previousDate = originDate;
  for (let index = 0; index < normalizeArray(candidate?.events).length; index += 1) {
    const eventDate = normalizeString(candidate.events[index]?.date);
    if (!parseIsoDate(eventDate)) return `$.events[${index}].date must be a real date in YYYY-MM-DD format.`;
    // Events dated ON the origin date are legitimate for every jump length: a
    // sub-day skip stays on that date, and a 1-day jump's window used to be a
    // single legal date ("after Jan 14 and no later than Jan 15") that models
    // constantly missed by dating events "today" — burning the strict attempt
    // (and the whole turn, when the retry ran out of road) over nothing.
    if (eventDate < originDate || eventDate > stopDate) {
      return `$.events[${index}].date must be on or after ${originDate} and no later than ${stopDate}.`;
    }
    if (eventDate < previousDate) return `$.events[${index}].date must not precede the previous event date.`;
    previousDate = eventDate;
  }
  return "";
};

// Attempt-2 salvage for timeline dates: rather than discarding a finished
// (possibly very long) generation to the canned fallback because the model
// simulated a little past the window, pull the strays in. Events dated on or
// before the origin land on the first simulated day, events past the stop land
// on the stop date, unparseable dates become the stop date, and ordering is
// restored monotonically. The CONTENT is untouched — a good story with sloppy
// dates beats canned events every time (a 1-day skip whose model "kept going"
// used to trash the whole turn exactly this way).
export const clampTimelineDates = (candidate, { mode, originDate, targetDate }) => {
  if (!parseIsoDate(originDate)) return; // textual/BCE scenarios use the lenient branch
  let stopDate = normalizeString(candidate?.stopDate);
  if (mode === "auto") {
    if (!parseIsoDate(stopDate) || stopDate <= originDate || stopDate > targetDate) stopDate = targetDate;
  } else {
    stopDate = targetDate;
  }
  candidate.stopDate = stopDate;
  // Mirrors validation: on-or-after the origin is in-window for every jump
  // length, so strays dated before the origin pull up to the origin itself.
  const floor = originDate > stopDate ? stopDate : originDate;
  let previous = floor;
  for (const event of normalizeArray(candidate?.events)) {
    if (!event || typeof event !== "object") continue;
    let date = normalizeString(event.date);
    if (!parseIsoDate(date)) date = stopDate;
    if (date <= originDate) date = floor;
    if (date > stopDate) date = stopDate;
    if (date < previous) date = previous;
    event.date = date;
    previous = date;
  }
};

const sentenceCase = (value) => {
  const text = normalizeString(value);
  if (!text) return "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

const maybeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// Parse, and when that fails, repair the JSON slips small local models make
// most: trailing commas before } or ], and curly "smart" quotes as string
// delimiters. Repairs are only ever attempted AFTER a strict parse failed, so
// well-formed output is never touched.
const lenientJsonParse = (value) => {
  const direct = maybeJsonParse(value);
  if (direct) return direct;
  const repaired = value
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, "$1");
  return maybeJsonParse(repaired);
};

// Every balanced top-level {...} or [...] block in the text, string-aware, in
// order of appearance. A greedy first-{-to-last-} regex dies when the model
// writes prose containing a brace after its JSON, or emits two objects; walking
// candidates and parsing each one survives both.
const balancedJsonCandidates = (text) => {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let opener = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (start === -1) {
      if (ch === "{" || ch === "[") {
        start = i;
        depth = 1;
        opener = ch;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = inString;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "{" || ch === "[") depth += 1;
      else if (ch === "}" || ch === "]") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  // Objects first: the payload is an object, and a stray inline array (e.g. in
  // the model's commentary) must not shadow it.
  return candidates.sort((a, b) => (a[0] === "{" ? 0 : 1) - (b[0] === "{" ? 0 : 1));
};

export const extractJsonPayload = (rawText) => {
  // Reasoning models (and several Ollama chat templates) prepend a think block
  // the strict parser chokes on; the answer follows it.
  const text = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();

  const direct = lenientJsonParse(text);
  if (direct) return direct;

  // Any fenced block, not just ```json — small models label fences ```JSON,
  // ```javascript, or not at all.
  for (const fence of text.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)) {
    const parsed = fence[1] ? lenientJsonParse(fence[1].trim()) : null;
    if (parsed && typeof parsed === "object") return parsed;
  }

  for (const candidate of balancedJsonCandidates(text)) {
    const parsed = lenientJsonParse(candidate);
    if (parsed && typeof parsed === "object") return parsed;
  }

  return null;
};


// Structured-output providers occasionally leak the beginning of the NEXT array
// object into a preceding event field, e.g.
//
//   title: "Baltic Working Groups Meet},{date:"
//   warId: "},{date:"
//
// That is provider/tool transport syntax, not authored history or canonical war
// identity. R2.18 originally repaired only the visible title. A later live turn
// proved the same boundary fragment can land in optional identifier fields: a
// routine Baltic technical session then appeared to "reference" a fictional war
// literally named `},{date:` and the strict war ledger correctly rejected it.
//
// Keep this repair deliberately narrow. We strip only syntax that unmistakably
// looks like a JSON object boundary followed by the next event's `date:` key.
// Genuine unknown war IDs remain untouched and therefore still fail closed.
const EVENT_TRANSPORT_BOUNDARY_TAIL =
  /\s*["']?\s*}\s*,\s*{\s*["']?\s*date\s*["']?\s*:\s*["']?\s*$/i;
const EVENT_TRANSPORT_BOUNDARY_VALUE =
  /^\s*["']?\s*}\s*,\s*{\s*["']?\s*date\s*["']?\s*:\s*["']?\s*$/i;

const repairGeneratedEventTransportArtifacts = (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      repaired: 0,
      titleIndexes: [],
      warIdIndexes: [],
    };
  }

  const events = Array.isArray(candidate.events) ? candidate.events : [];
  const titleIndexes = [];
  const warIdIndexes = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;

    const title = typeof event.title === "string" ? event.title : "";
    if (title && EVENT_TRANSPORT_BOUNDARY_TAIL.test(title)) {
      const repairedTitle = title.replace(EVENT_TRANSPORT_BOUNDARY_TAIL, "").trim();
      if (repairedTitle && repairedTitle !== title) {
        event.title = repairedTitle;
        titleIndexes.push(index);
      }
    }

    const warId = typeof event.warId === "string" ? event.warId : "";
    if (warId && EVENT_TRANSPORT_BOUNDARY_VALUE.test(warId)) {
      // Optional event.warId means "no war association" when blank. Clear ONLY
      // the unmistakable transport fragment; do not guess or synthesize a war.
      event.warId = "";
      warIdIndexes.push(index);
    }
  }

  return {
    repaired: titleIndexes.length + warIdIndexes.length,
    titleIndexes,
    warIdIndexes,
  };
};

const loadPromptCatalog = async ({ force = false } = {}) =>
  normalizePromptPack(await readJson(JSON_URLS.prompts, { defaultValue: {}, force }));

const MILITARY_ACTION_PATTERN =
  /\b(troop|army|armies|attack|invade|invasion|deploy|fleet|navy|naval|air force|airforce|bomb|siege|offensive|battalion|regiment|garrison|blockade|mobiliz)/i;

// Reach/logistics doctrine for the AI. Deliberately CONDITIONAL: it only
// rides along when the turn actually involves forces (units on the map or
// military-sounding orders), so peaceful turns don't pay the context cost.
const buildMilitaryFeasibilityText = (world, actionsText) => {
  const hasUnits = normalizeArray(world?.units).length > 0;
  if (!hasUnits && !MILITARY_ACTION_PATTERN.test(actionsText || "")) {
    return "";
  }

  return [
    "",
    "MILITARY FEASIBILITY — test every deploy request, move/attack order and your own unitOps against the era and the unit's type before honoring it:",
    "- Era reach: before ~1500, armies march on foot or horse and cross water only by coastal shipping — intercontinental operations are impossible. ~1500–1850 (age of sail): overseas action needs fleets and friendly ports and takes months. 1850–1945: rail and steamships speed logistics; aircraft stay short-ranged until the 1940s. After 1945: global power projection belongs only to major powers with bases, carriers or allies along the route.",
    "- Unit type: air units are fastest but need airbases or carriers within range and cannot hold ground; naval units move only by sea; infantry, armor and artillery crawl overland and need supply lines; garrisons do not travel.",
    "- Distance: compare the unit's coordinates with the target's. An order beyond plausible reach or pace is NOT executed as given — reject it, or convert it into a partial advance with an event explaining the delay, the transport it would need, or why it failed.",
    "- Never teleport units: each move op may only cover what that unit could actually travel in the elapsed time; long campaigns should progress across several turns.",
  ].join("\n");
};

const STAT_SHEETS_STORAGE_KEY = "oh-stat-sheets";

const readStoredStatSheets = () => {
  try {
    return JSON.parse(localStorage.getItem(STAT_SHEETS_STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
};

// International reputation the AI evolves each turn (world.internationalReputation),
// surfaced to prompts. Falls back to the last stat sheet the player viewed, then a
// neutral 50 — so it is never "unknown".
const buildPlayerPolityReputationText = async (bundle) => {
  const playerCode = normalizeString(bundle.game.country);
  if (!playerCode) {
    return "No player polity is currently set.";
  }
  const world = bundle.world && typeof bundle.world === "object" ? bundle.world : {};
  let reputation = Number(world.internationalReputation?.[playerCode]);
  if (!Number.isFinite(reputation)) {
    const gameKey = normalizeString(bundle.game.id || bundle.game.name || "game");
    reputation = Number(readStoredStatSheets()[`${gameKey}:${playerCode}`]?.sheet?.indices?.internationalReputation);
  }
  if (!Number.isFinite(reputation)) {
    reputation = 50;
  }
  const clamped = Math.max(0, Math.min(100, Math.round(reputation)));
  const band = clamped >= 70 ? "well-regarded" : clamped >= 40 ? "mixed" : "poor";
  return `International reputation: ${clamped}/100 (${band}).`;
};

const buildTerritorialControlContext = async (worldLike) => {
  const world = normalizeWorldState(worldLike);
  const catalog = await loadRegionCatalog().catch(() => []);
  const byId = new Map(catalog.map((region) => [region.id, region]));
  const ids = new Set([
    ...Object.keys(world.regionOwnershipOverrides || {}),
    ...Object.keys(world.regionSovereigntyOverrides || {}),
    ...Object.keys(world.regionClaimants || {}),
  ]);

  const rows = [];
  for (const regionId of ids) {
    const region = byId.get(regionId);
    const baseOwner = normalizeString(region?.country || toCountryName(region?.countryCode) || "");
    const controller = normalizeString(world.regionOwnershipOverrides?.[regionId]) || baseOwner;
    const sovereign = normalizeString(world.regionSovereigntyOverrides?.[regionId]) || controller || baseOwner;
    const claimants = normalizeArray(world.regionClaimants?.[regionId]).map(normalizeString).filter(Boolean);

    if (!claimants.length && controller.toLowerCase() === sovereign.toLowerCase()) continue;

    rows.push(
      `- ${region?.name || regionId} (${regionId}): sovereign ${sovereign || "unknown"}; ` +
      `controller ${controller || "unknown"}` +
      (claimants.length ? `; active claimants/contenders ${claimants.join(", ")}` : ""),
    );
  }

  return rows.length > 0
    ? rows.slice(0, 80).join("\n") + (rows.length > 80 ? `\n(+${rows.length - 80} more non-normal territorial states omitted)` : "")
    : "No active occupation/control-vs-sovereignty differences or contested regions are currently recorded.";
};

const buildGameMasterStorylineContext = (worldLike) => {
  const world = normalizeWorldState(worldLike);
  const storylines = normalizeArray(world.storylines)
    .filter((entry) => entry && typeof entry === "object" && normalizeString(entry.id))
    .slice(0, 24);
  if (!storylines.length) return "No persistent world storylines are currently recorded.";
  return storylines.map((entry) => {
    const participants = normalizeArray(entry.participants).map(normalizeString).filter(Boolean);
    return [
      `- ${normalizeString(entry.id)} | ${normalizeString(entry.status) || "active"} | ` +
        `pressure ${Math.max(0, Math.min(100, Math.round(Number(entry.pressure) || 0)))}/100 | ` +
        `momentum ${Math.max(0, Math.min(100, Math.round(Number(entry.momentum) || 0)))}/100`,
      `  ${normalizeString(entry.title) || "Untitled process"}${participants.length ? ` | participants: ${participants.join(", ")}` : ""}`,
      `  state: ${normalizeString(entry.state) || "No current semantic state recorded."}`,
    ].join("\n");
  }).join("\n");
};

const buildTemplateVariables = async (bundle, options = {}) => {
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const taskKey = normalizeString(options?.taskKey);
  const explicitRequiredKeys = options?.requiredKeys;

  // Phase 9.5B uses the ACTUAL loaded/frozen task + helper templates. If demand
  // cannot be resolved for any reason, fail OPEN to the legacy full context build:
  // performance may regress for that one request, but model-visible knowledge never does.
  let demand = null;
  if (explicitRequiredKeys == null && taskKey) {
    try {
      const prompts = await loadPromptCatalog();
      const promptTemplate =
        taskKey === "gameMaster" ? NATIVE_GAME_MASTER_PROMPT : prompts.tasks[taskKey];
      if (promptTemplate) {
        demand = resolveTemplateVariableDemand({
          helperTemplates: prompts.helpers,
          promptTemplate,
          taskKey,
          variables: {},
        });
      }
    } catch {
      demand = null;
    }
  }

  const requiredKeys =
    explicitRequiredKeys != null
      ? explicitRequiredKeys
      : demand?.requiredVariableKeys ?? null;
  const requiredSet =
    requiredKeys == null
      ? null
      : new Set(
          (requiredKeys instanceof Set ? [...requiredKeys] : normalizeArray(requiredKeys))
            .map(normalizeString)
            .filter(Boolean),
        );
  const wants = (key) => !requiredSet || requiredSet.has(key);

  // Keep taskKey as an INTERNAL context-construction hint. It is not a template
  // variable; Phase 10 uses it only to bound persistent-object attention per task.
  const contextOptions = { ...options, requiredKeys, taskKey };

  const variables = await buildPromptContext(bundle, contextOptions);
  const chatFocusActors = normalizeArray(options?.chat?.countries)
    .map((country) =>
      normalizeString(country?.polityKey || country?.name || country?.code),
    )
    .filter(Boolean);

  if (wants("playerPolityReputationContext")) {
    variables.playerPolityReputationContext =
      await buildPlayerPolityReputationText(bundle);
  }
  if (wants("territorialControlContext")) {
    variables.territorialControlContext =
      await buildTerritorialControlContext(bundle.world);
  }
  if (wants("canonicalWarContext")) {
    variables.canonicalWarContext = buildCanonicalWarContext(bundle.world);
  }
  if (wants("canonicalDiplomaticContext")) {
    variables.canonicalDiplomaticContext = buildBoundedDiplomaticContext(
      bundle.world,
      {
        playerPolity: normalizeString(bundle?.game?.country),
        focusActors: chatFocusActors,
        maxActors: 8,
      },
    ).text;
  }
  if (wants("canonicalStorylineContext")) {
    variables.canonicalStorylineContext = buildGameMasterStorylineContext(bundle.world);
  }
  if (wants("unitsSummary")) {
    variables.unitsSummary =
      normalizeString(variables.unitsSummary) +
      buildMilitaryFeasibilityText(
        bundle.world,
        buildActionHistoryText(bundle.actions),
      );
  }

  const endedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const constructedKeys = Object.keys(variables);
  const candidateVariableCount = 55; // 9.5A broad surface (54) + the repaired actionsToConsolidate key.

  // Non-enumerable metadata never reaches templates, JSON serialization, or the AI.
  // Diagnostics can still read it to prove what 9.5B skipped and how long the build took.
  const buildMeta = {
    taskKey: taskKey || "compatibility-full-build",
    elapsedMs: Math.max(0, endedAt - startedAt),
    candidateVariableCount,
    constructedVariableCount: constructedKeys.length,
    skippedVariableCount: Math.max(
      0,
      candidateVariableCount - constructedKeys.length,
    ),
    requiredVariableCount: requiredSet?.size ?? candidateVariableCount,
    failOpenFullBuild: requiredSet == null,
  };

  try {
    Object.defineProperty(variables, "__ohContextBuildMeta", {
      configurable: true,
      enumerable: false,
      value: buildMeta,
    });
  } catch {
    // Performance diagnostics must never interfere with prompt construction.
  }

  if (isContextDiagnosticsEnabled()) {
    console.info(
      `[context 9.5B build] ${buildMeta.taskKey}: ` +
      `${buildMeta.elapsedMs.toFixed(1)} ms; ` +
      `${buildMeta.constructedVariableCount}/${buildMeta.candidateVariableCount} variables materialized; ` +
      `${buildMeta.skippedVariableCount} skipped before construction` +
      (buildMeta.failOpenFullBuild ? " (compatibility fail-open full build)" : ""),
    );
  }

  return variables;
};

// Give the AI real time: local/self-hosted models (and reasoning modes) often
// need well over a minute per turn. The old 12s default silently discarded
// their answers and served the canned fallback instead — turns "completed"
// with nothing to show. The UI has spinners; waiting beats silently wrong.
// Capability reference appended to every timeline jump (see runJsonTask below): the
// full menu of world-changing levers the tool schema exposes, so the model always ends
// its system prompt with an explicit list of what it can do and how. Injected at call
// time so it reaches existing frozen-prompt games too.
const ACTIONS_REFERENCE = `[Actions You Can Take]\nThis is the full menu of levers you have to change the world. Everything you change rides on an event's \"impacts\" object, except the whole-jump levers noted at the end. Reach for the RIGHT lever, and NEVER narrate a change in an event's text without also emitting the impact that makes it real — narration and world state must always agree.\n\n• regionTransfers — LEGAL SOVEREIGNTY only: treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final territorial settlement. Shape: {"regionId":"<exact id/name when known; otherwise exact grounded place wording>","regionName":"","fromCode":"<current legal sovereign>","toCode":"<new legal sovereign>"}. Do NOT use regionTransfers for a temporary battlefield capture or occupation.\n\n• regionControlOps — DE-FACTO CONTROL / ACTIVE FRONT state. Three ops:\n    {"op":"contest","regionId":"<region/place>","fromCode":"<current controller>","actorCode":"<challenger>","note":""}\n    {"op":"control","regionId":"<region/place>","fromCode":"<previous controller>","toCode":"<new controller>","note":""}\n    {"op":"clear_contest","regionId":"<region/place>","fromCode":"<current controller>","claimantCode":"<claimant to remove>","clearAll":false,"note":""}\n  Use contest when fighting makes a named region actively disputed without a decisive control change. Use control for wartime capture/occupation/liberation/retaking. Use clear_contest when withdrawal, ceasefire or settlement ends the active contest. ALWAYS set fromCode when you know the current controller so the geography resolver is bounded to that side's actual regions. The existing map stripes regionClaimants automatically; do not fake a legal treaty just to make the front move.\n\n• polityChanges — Explicit polity lifecycle or metadata changes. EVERY entry must include operation:\"update|create|rename|restore|dissolve\" and code:\"<FULL polity name, never an abbreviation>\". update changes metadata/stats/tags/reputation on an EXISTING polity only; create explicitly establishes a genuinely NEW current polity/breakaway state; rename reconstitutes an existing polity under a new current/display name while preserving its stable campaign identity; restore explicitly brings a dormant/dissolved polity back; dissolve explicitly ends a polity after its territory is separately settled. Example: {\"operation\":\"update\",\"code\":\"German Empire\",\"reputation\":60,\"tags\":[\"...\"],\"stats\":{},\"note\":\"<why>\"}. A same-event create/restore happens before that event\'s regionTransfers, so a newborn polity may immediately receive only the territory the event actually establishes. Never mint a new polity merely because you used a stale/sloppy alternate name. On an ideological/alignment shift rewrite the COMPLETE tags list. National statistics change only through stats; when leadership changes, update stats.leader.\n\n• unitOps — Move the war on the map with PERSISTENT battalions. Five ops:\n    {\"op\":\"spawn\",\"unit\":{\"name\":\"\",\"type\":\"infantry|armor|air|naval|artillery|garrison\",\"ownerCode\":\"\",\"strength\":1-1000,\"lng\":0,\"lat\":0,\"regionId\":\"\"}}\n    {\"op\":\"move\",\"unitId\":\"<existing id>\",\"toLng\":0,\"toLat\":0,\"regionId\":\"\",\"note\":\"\"}\n    {\"op\":\"attack\",\"unitId\":\"<existing attacker id>\",\"targetUnitId\":\"<existing enemy id>\",\"note\":\"\"}\n    {\"op\":\"strength\",\"unitId\":\"<existing id>\",\"strength\":0-1000,\"note\":\"\"}\n    {\"op\":\"remove\",\"unitId\":\"<existing id>\",\"note\":\"\"}\n  REUSE existing units by id. An offensive, retreat, redeployment or continuing war normally MOVES the units that already exist; do not spawn a fresh army every time the prose says forces act. Spawn only for a genuinely new formation/mobilization/reinforcement that is not already represented. Use attack when two existing opposing units actually fight: the runtime resolves casualties deterministically, so NEVER invent post-battle strength values for those participants in the same event. strength is for explicit non-combat reinforcement/attrition/reorganization; remove only for destruction/disbandment/demobilization. When a front is decisively won in wartime, pair the advance with regionControlOps control; use regionTransfers only if that same event also legally settles sovereignty.\n\n• markerOps — Persistent PHYSICAL world features. Four ops:\n    {\"op\":\"build\",\"marker\":{\"name\":\"\",\"kind\":\"<lowercase: factory / naval yard / logistics hub / laboratory / base / port / embassy / airfield / city / etc.>\",\"ownerCode\":\"\",\"status\":\"planned|under_construction|active|damaged|inactive|abandoned|destroyed\",\"lng\":0,\"lat\":0,\"note\":\"\",\"foundedAt\":\"\"}}\n    {\"op\":\"update\",\"markerId\":\"<EXISTING stable id>\",\"status\":\"active\",\"note\":\"<new current state>\"}\n    {\"op\":\"rename\",\"markerId\":\"<existing stable id when known>\",\"name\":\"<fallback current name>\",\"newName\":\"<new name>\",\"note\":\"<why>\"}\n    {\"op\":\"remove\",\"markerId\":\"<existing id>\",\"name\":\"<fallback name>\",\"note\":\"<canonical cleanup only>\"}\n  BUILD only a genuinely new, significant, named, geographically concrete feature likely to matter again. Do NOT mint map clutter for routine activity and do NOT rebuild an existing feature. When CURRENT MAP STRUCTURES supplies an id, REUSE that id with update/rename. Expansion, completion, capture/change of operator, conversion, damage, abandonment, reconstruction and destruction are updates to the SAME object. Destruction normally means update status=destroyed — it remains historical canon; remove is for correcting/deleting something that should no longer exist in canon. Existing features may participate in events without being updated: when relevant, naturally use their exact canonical name in the event prose. Structures NEVER move borders: a facility one polity builds inside another's land does not transfer the region, and ownerCode is who runs the facility, not who owns the ground.
  PHYSICAL-WORLD COMPLETENESS AUDIT — REQUIRED FOR EVERY EVENT: before finalizing each event, silently ask whether the event (a) establishes a significant persistent physical facility/place, or (b) materially changes one already supplied in CURRENT MAP STRUCTURES. Qualifying changes include major expansion/completion, conversion, capture/change of operator, damage, abandonment, reconstruction or destruction. If YES, the matching markerOps mutation is REQUIRED in that same event; do not leave the physical consequence only in prose. If an existing feature merely participates without changing, mention its exact canonical name naturally but emit no markerOp. If NO significant persistent physical feature is created or changed, emit no markerOp. This is a completeness rule, NOT a quota and NOT a reason to invent an event.\n\n• createdChats — Have another polity open a diplomatic chat with the player BECAUSE of this event (a war scare prompting mediation, a border incident prompting an ultimatum, a windfall prompting a trade delegation). Shape: {\"countries\":[\"...\"],\"title\":\"<names the purpose>\",\"speaker\":\"<the initiating polity — never the player>\",\"openingMessage\":\"<that leader's first message, in their voice>\"}. The other side always speaks first; a blank or untitled chat is invalid.\n\n• actionIds — List the ids of the player's queued actions that this event resolves, so the game can clear them from the queue.\n\nWAR EVENT METADATA:\n• warId — REQUIRED on an event that declares/joins/ends a war OR depicts actual battlefield combat. It must identify the canonical conflict in world.wars.\n• combatants — REQUIRED ONLY for actual battle/offensive/invasion/bombardment/front-combat events. List the polity names DIRECTLY FIGHTING EACH OTHER; at least one must come from each opposing side of warId.\n• Force-description vocabulary is NOT combat. Phrases such as combat battlegroup, combat-ready unit, combat capability, deployment, forward presence, deterrence, exercise, training, readiness, reinforcement, air policing, or allied military cooperation do NOT authorize warId/combatants/warUpdates unless the same event explicitly says the named sides are fighting one another.\n• A new war must have an explicit causal event that narrates declaration/commencement of hostilities or direct adversarial battlefield action. Never infer belligerency merely because two armed allied/rival polities appear in the same military event.\n\nWhole-jump levers (top level of your output, NOT inside an event):\n• warUpdates — AUTHORITATIVE BELLIGERENCY changes. This is NOT a storyline and NOT optional when war status changes. One compact record per line:\n    warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note\n  ops: start | join-a | join-b | leave | ceasefire | resume | end\n  start: actors=Side A and opponents=Side B. join-a/join-b: actors are the joining polities. leave: actors are the leaving polities.\n  eventNumbersCSV is a compatibility hint only. Leave it blank (keep the positional ~~ separators) unless convenient; native Javascript binds the war update to the causal event from event.warId and transition semantics. Every war transition must still have a real causal event. A defensive alliance, mobilization, storyline, historical expectation, or hostile rhetoric does NOT itself create belligerency.\n• relationUpdates — MATERIAL BILATERAL POLITICAL CLIMATE changes only. The ledger is sparse: do NOT create neutral-zero rows for untouched countries and do NOT update a pair merely because diplomats met. One compact record per line:\n    polityA~polityB~absoluteScore~status~eventNumbersCSV~summary\n  absoluteScore is -100..100; status is friendly | cordial | neutral | cautious | strained | hostile | rival. eventNumbersCSV is a compatibility hint only and may be blank; native Javascript binds the update to the unique causal event from the actors and summary. Formal alliance status is NOT encoded here; that lives in agreementUpdates. An alliance can be politically strained, and friendly states can have no alliance.\n• agreementUpdates — FORMAL TREATY / ALLIANCE / GUARANTEE lifecycle. One compact record per line:\n    agreementId~op~type~partiesCSV~eventNumbersCSV~title~terms\n  ops: start | update | suspend | resume | end | expire\n  types: alliance | mutual_defense | guarantee | non_aggression | friendship_consultation | trade_economic | military_cooperation | military_access | neutrality | peace_settlement | other\n  eventNumbersCSV is a compatibility hint only and may be blank; native Javascript binds the agreement lifecycle change to the unique causal event from its parties/title/terms. A NEW signed/ratified/concluded formal commitment MUST use start and have a real establishing event. BEFORE using start, inspect CURRENT FORMAL AGREEMENTS: if that stable agreementId already exists and is active, NEVER start it again. If a later event merely implements, discusses, staffs, exercises, or administratively follows an existing pact without changing its formal terms/status, emit NO agreementUpdates row. Use update only for a genuine formal amendment/terms change; suspend/resume/end/expire only for those actual lifecycle changes. Negotiations/proposals alone create NO agreement. For guarantee, partiesCSV order is guarantor first, beneficiary second. For later operations reuse the stable agreementId; unchanged type/parties/title may be blank where runtime preserves them.\n• diplomaticOutreach — Polities reaching out to the player on their OWN initiative this period — treaty feelers, trade proposals, non-aggression pacts, mediation offers, warnings, summit invitations — not tied to any single event. Same shape as createdChats. Open one whenever a polity plausibly would, rather than defaulting to none.\n• catalyst — An interactive branching scene handed to the player when a moment genuinely demands their decision, or null when none is warranted. Shape: {\"title\":\"\",\"premise\":\"\",\"opening\":\"\",\"choices\":[\"...\", \"...\", up to 5 distinct]}.\n\nKeep the total across createdChats and diplomaticOutreach to at most 3 per jump, and only when the approach genuinely serves the sender's interests.`;

const CANONICAL_UPDATE_ENVELOPE_TASKS = new Set(["pregameHistory"]);

const canonicalUpdateKind = (value) => {
  const raw = normalizeString(value).toLowerCase();
  const [family, operation = ""] = raw.split(":", 2);
  return { raw, family, operation };
};

const expandCanonicalUpdateEnvelope = (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;

  const storylineUpdates = [];
  const warUpdates = [];
  const relationUpdates = [];
  const agreementUpdates = [];

  for (const raw of normalizeArray(candidate.canonicalUpdates)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const { family, operation } = canonicalUpdateKind(raw.kind);
    const polities = normalizeArray(raw.polities).map(normalizeString).filter(Boolean);
    const opponents = normalizeArray(raw.opponents).map(normalizeString).filter(Boolean);

    if (family === "storyline") {
      storylineUpdates.push({
        id: normalizeString(raw.id),
        status: operation,
        pressure: Number(raw.pressure),
        momentum: Number(raw.momentum),
        startedDate: normalizeString(raw.date),
        kind: normalizeString(raw.category),
        title: normalizeString(raw.title),
        participants: polities,
        eventIndexes: [],
        eventIds: [],
        state: normalizeString(raw.detail),
      });
      continue;
    }

    if (family === "war") {
      warUpdates.push({
        id: normalizeString(raw.id),
        op: operation,
        actors: polities,
        opponents,
        eventIndexes: [],
        eventIds: [],
        note: normalizeString(raw.detail),
      });
      continue;
    }

    if (family === "relation") {
      relationUpdates.push({
        a: normalizeString(polities[0]),
        b: normalizeString(polities[1]),
        score: Number(raw.score),
        // Native diplomacy derives the canonical status band from score.
        eventIndexes: [],
        eventIds: [],
        summary: normalizeString(raw.detail),
      });
      continue;
    }

    if (family === "agreement") {
      agreementUpdates.push({
        id: normalizeString(raw.id),
        op: operation,
        type: normalizeString(raw.category).toLowerCase(),
        parties: polities,
        eventIndexes: [],
        eventIds: [],
        title: normalizeString(raw.title),
        terms: normalizeString(raw.detail),
      });
    }
  }

  const expanded = {
    ...candidate,
    storylineUpdates,
    warUpdates,
    relationUpdates,
    agreementUpdates,
  };
  delete expanded.canonicalUpdates;
  return expanded;
};

const runJsonTask = async (taskKey, {
  fallback,
  maxTokens,
  reasoningEnabled,
  signal,
  timeoutMs = getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 120000 : 0,
  userMessage,
  validatePayload,
  variables,
}) => {
  const prompts = await loadPromptCatalog();
  const promptTemplate = taskKey === "gameMaster"
    ? NATIVE_GAME_MASTER_PROMPT
    : prompts.tasks[taskKey];
  const liveDemand = resolveTemplateVariableDemand({
    helperTemplates: prompts.helpers,
    promptTemplate,
    taskKey,
    variables,
  });
  const helperValues = resolveHelperValues(prompts.helpers, variables, {
    includeKeys: liveDemand.helperKeys,
  });
  let systemPrompt = renderTemplate(promptTemplate, {
    ...variables,
    ...helperValues,
  });

  // Difficulty 2.0 is intentionally scoped. It belongs only in places that
  // actually RESOLVE uncertain simulation pressure or bargaining. Mechanical
  // helpers (Stats, geography, timeline curation, unit/territory directors),
  // action parsing/suggestions, pregame history, and the GM/admin path must stay
  // difficulty-neutral so challenge can never corrupt canonical bookkeeping.
  const difficultyScope = (() => {
    if (["jumpForward", "autoJumpForward"].includes(taskKey)) return "simulation";
    if (["catalystCreation", "catalystExecutor"].includes(taskKey)) return "catalyst";
    if (taskKey === "idleDiplomacy") return "diplomacy";
    return "";
  })();

  if (difficultyScope) {
    try {
      const game = await readGameData();
      systemPrompt = `${systemPrompt}\n\n${difficultyDirective(game.difficulty, difficultyScope)}`;
    } catch {
      // Missing game data leaves the task neutral rather than inventing a level.
    }
  }

  if (taskKey === "countryStatSheet") {
    systemPrompt = `${systemPrompt}

[Native Country Stats — LIVE 7A.2 / 8B.2.18.1]
This is a PERSISTENT campaign stat sheet, not a disposable modern-country lookup. Native code has already selected the authoritative territorial ACCOUNTING MODE and partition below; the model MUST NOT choose a different mode from prose, modern borders, or historical expectation.

AUTHORITATIVE TERRITORIAL BASIS:
${normalizeString(variables?.statsTerritorialContext) || "No territorial basis was resolved; use the target dossier conservatively."}

PRE-SEPARATION / DONOR COMPONENT REFERENCES:
${normalizeString(variables?.statsTerritorialReferenceContext) || "None available. Estimate from the supplied territorial basis and campaign context."}

PREVIOUS PERSISTENT STATS / CONTINUITY ANCHOR:
${normalizeString(variables?.statsPreviousContext) || "No previous persistent stat sheet exists; establish a fresh baseline."}

FRESH ECONOMIC / DEMOGRAPHIC EVIDENCE NOT YET ACCOUNTED IN THAT BASELINE:
${normalizeString(variables?.statsEconomicEvidenceContext) || "None. Preserve continuity; the absence of fresh evidence is not permission to reroll the economy."}

TERRITORIAL ACCOUNTING CONTRACT — REQUIRED:
- LEGAL SOVEREIGNTY is the normal accounting mode. Temporary foreign battlefield occupation does NOT automatically become part of the occupier's national population/GDP, and occupied legally-sovereign territory remains in the legal sovereign's national scope.
- Native code may instead explicitly select DE-FACTO STATE ADMINISTRATION for an active territorial polity that lacks a usable legal-sovereign map basis but actually administers territory as a state/breakaway/provisional government. ONLY when that mode is explicitly printed in the authoritative basis do controlled regions become this polity's Stats scope.
- DE-FACTO STATE ADMINISTRATION is NOT a loophole for ordinary foreign occupiers. The model must never switch modes itself.
- If a de-facto state is administering territory still legally claimed by another polity, both ledgers may legitimately overlap at the world level: the legal sovereign's sheet describes its de-jure realm while the de-facto state's sheet describes the population/economy it actually administers. Do not "fix" that by deleting territory from either side unless canonical sovereignty/control changes.
- When native code supplies a donor/reference component from the displaced legal sovereign, use it as a continuity anchor. For an EXACT/FULL matching component, preserve roughly that population/productivity unless campaign evidence justifies change. For a PARTIAL parent component, NEVER copy the whole donor population; estimate only the explicitly listed controlled subregions.

CONTINUITY CONTRACT — REQUIRED:
- The previous persistent sheet is the numeric baseline, not a suggestion, EXCEPT where the authoritative territorial mode/coverage has changed and the old component layout no longer represents the current scope.
- Events already accounted in the baseline may still appear elsewhere in broad history/context. Do NOT apply them a second time. Only the FRESH evidence block above is newly account-able evidence for this reassessment.
- If the authoritative territorial basis is unchanged and there is little/no fresh evidence, surviving component populations/productivity and macro indicators should remain close to their previous values. Slow demographic/productivity drift over elapsed time is fine; unexplained discontinuities are not.
- A short-span component population or GDP/capita re-baseline of roughly 50% or more needs either a real supplied campaign cause OR an authoritative territorial coverage/mode change that makes the old component non-comparable. Native JavaScript applies a conservative final guard as a second line of defense.
- Legal annexation/cession can add/remove/change normal legal components. In explicitly selected DE-FACTO STATE ADMINISTRATION mode, de-facto control changes can add/remove/change administrative components because control is the native accounting basis for that special polity.
- Never use modern-country wealth/population stereotypes to overwrite the campaign baseline.

SCALE / HISTORY AUTHORITY — REQUIRED:
${normalizeString(variables?.statsCalibrationContext) || "Use the persistent campaign ledger and supplied canon as the numeric authority. Real-world history may fill genuinely unresolved initial conditions, but it must never overwrite established campaign state or import later historical outcomes that did not occur in this timeline."}

SCENARIO / DIVERGENCE CANON FOR BASELINE SCALE:
${normalizeString(variables?.statsScenarioCalibrationCanon) || "No extra scenario-start canon was supplied. The live territorial basis and persistent campaign state still outrank same-date real-world history."}

POPULATION / REGIONAL CALIBRATION CONTRACT — NATIVE CONTROLLED:
${variables?.statsPopulationCalibrationRequested ? `
- CAUSAL CALIBRATION IS REQUIRED for this call. Return populationCalibration as provenance metadata plus one estimate for every NATIVE MACRO BUCKET below.
- populationCalibration describes the authority boundary for THIS SCENARIO. It does NOT contain or impose a whole-polity population target. The national total will be derived by native JavaScript from the regional macro estimates, preventing one bad historical headline lookup from overriding the live territorial footprint.
- First identify historyAuthorityCutoff: the latest point where real-world demographic causality is genuinely shared. If the scenario diverged before the start date, real-world outcomes after that frontier are FORBIDDEN as calibration facts.
- Return basis as ONE concise evidence summary naming the shared baseline and post-cutoff scenario facts used. This is audit provenance, not hidden reasoning.
- mode=historical_start ONLY when scenario canon remains materially historical through the start date. Use mode=counterfactual_start when the scenario already diverged before play. Use mode=campaign_reconstruction for a later manual/repair reconstruction.
- For counterfactual_start/campaign_reconstruction, reason forward from the last shared historical/regional baseline using ONLY supplied scenario/campaign canon after the cutoff. Historical war losses, famine, partition, migration, or territorial losses that did not occur in this timeline must not leak into any regional estimate.
- The live macro buckets are the population scope. Estimate ONLY the territory represented by each bucket. A colony, dependency, subject, or related polity absent from the live bucket list is not part of this national population.
- This is a one-time bootstrap/reconstruction anchor. It does NOT create a historical attractor for future turns.` : `
- CAUSAL CALIBRATION PROVENANCE IS NOT REQUESTED for this call. Omit populationCalibration. The existing persistent component ledger is the numeric authority; assess only bounded changes to the macro buckets.`}

NOMINAL ECONOMIC BASELINE CALIBRATION — NATIVE CONTROLLED:
${variables?.statsEconomicCalibrationRequested ? `
- ECONOMIC CALIBRATION IS REQUIRED for this fresh baseline/hard audit. Return economicCalibration.
- The canonical GDP ledger is NOMINAL economic output expressed in a common constant-2026-EUR accounting unit. It is NOT PPP, purchasing-power parity, international dollars, real living-standard output, or a modernization/productivity adjustment.
- Start from a historically/causally legitimate NOMINAL GDP and NOMINAL GDP/capita anchor at or before the shared-history frontier. economicCalibration.anchorCurrency must be USD or EUR and the two nominal anchor values must be contemporaneous nominal values for anchorYear.
- economicCalibration.rebasedGdpPerCapita2026Eur is ONLY the monetary rebasing of that nominal GDP/capita into constant 2026 EUR. It may reflect ordinary inflation and USD/EUR conversion. It MUST NOT incorporate PPP or make a poorer historical country look like a 2026 rich-country economy.
- economicCalibration.nominalGdpBillions and nominalGdpPerCapita must describe the SAME territorial scope. Native code audits their implied population against the authoritative live baseline when mode=historical_start.
- If the current generated GDP/capita materially departs from the rebased nominal anchor, cite ONLY canonical IDs from this bounded list in economicCalibration.divergenceEventIds: ${normalizeArray(variables?.statsEconomicEvidenceIds).join(", ") || "(none)"}.
- An empty divergenceEventIds array means no supplied campaign event justifies a large departure from the nominal baseline. Do not invent a boom, convergence miracle, collapse, sanctions shock, reform dividend, or productivity leap.
- mode/historyAuthorityCutoff must obey the same scenario-causality frontier as populationCalibration when both are present. Real-world economic outcomes after divergence are forbidden unless scenario canon explicitly preserves them.
- GDP growth is REAL annual growth, separate from the nominal GDP level. For a historical-start baseline, preserve the inherited macro-cycle direction unless supplied post-cutoff campaign evidence causally changes it; do not smooth a recession into generic +1% growth merely because it seems plausible.
- economicCalibration is audit provenance only. Native JavaScript still derives national GDP from exact territorial population × gdpPerCapita rows.` : `
- ECONOMIC CALIBRATION PROVENANCE IS NOT REQUESTED for this call. Omit economicCalibration. The existing persistent nominal component ledger is the economic scale authority; do not re-anchor it to PPP or same-date real-world headlines.`}

BOUNDED REGIONAL METHOD — REQUIRED:
- Native code retains EVERY exact live-map province/component internally, but it has grouped them into a SMALL set of spatial demographic macro buckets for this AI call. This is a performance boundary only.
- Return territorialMacroComponentsText with EXACTLY ONE row for EVERY [M#] macro bucket, in this exact transport format: index~group~population~gdpPerCapita
- Example rows: 1~core~32000000~4200 OR 2~overseas/dependent~4200000~900
- index MUST be the supplied macro integer. Do not return province-by-province rows. Do not add, omit, split, or merge macro buckets.
- Compatibility only: if the authoritative basis explicitly says no mapped macro buckets exist, territorialMacroComponentsText may instead use group~geography~population~gdpPerCapita rows for the genuinely supported landless/custom scope.
- Allowed group values: core | integrated | overseas/dependent.
- Estimate each macro bucket from its representative places, spatial center, scenario canon, and any prior macro baseline. Prefer checkable regional magnitudes over a single historical whole-country headline total.
- Do NOT force the macro-bucket sum to a remembered country/empire headline. A historical headline is usable only as a cross-check when its territorial definition exactly matches the live macro scope; otherwise the regional estimates win.
- The SUM of macro-bucket populations becomes the national population. Native JavaScript expands each macro estimate deterministically back across ALL exact live-map components, preserving prior local proportions where a campaign ledger already exists.
- Do not give colonies, dependencies, peripheral territories, or poorer constituent regions metropolitan productivity by default.
- group is only an economic/display bucket. It is NOT a sovereignty, alliance, customs-union, recognition, or constitutional judgment.
- gdpPerCapita inside each macro bucket is NOMINAL output per person expressed in constant 2026-EUR accounting terms so components and eras can be aggregated. It is NOT PPP/international-dollar purchasing power and does NOT import 2026 technology, institutions, productivity, or living standards.
- population totals and GDP aggregates are DERIVED by native JavaScript after regional expansion.
- economy.gdpGrowth, inflation, unemployment, publicDebt and budgetBalance are percentages expressed as plain numbers; budgetBalance is negative for deficit and positive for surplus.
- economy.currency is the polity's actual current domestic currency/medium, even though GDP accounting uses 2026-EUR-equivalent values.
- GDP breakdown must sum to exactly 100.
- Never invent a war, reform, boom, depression, trade bloc, annexation, reconstruction program, tax change, loan, or fiscal shock absent from supplied campaign evidence.

This live instruction supersedes older frozen country-stat prompts and all earlier 7A.1/7A.2 territorial wording.`;
  }

  // Structured event quotations are appended at call time because campaign prompt
  // packs are frozen when a game is created. Older saves may still explicitly tell
  // the model to append block quotes to description; this live instruction supersedes
  // that presentation-only legacy rule without changing event selection or adding calls.
  if (["jumpForward", "autoJumpForward", "pregameHistory"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}

[Structured Event Quotations — live override]
Event.description is the narrative account ONLY. Do NOT append a quotation, attribution line, markdown blockquote, or speaker signature to description merely for presentation.

When a genuinely memorable quotation materially improves an event, place it in the OPTIONAL event.quote object instead:
{"text":"quotation text without surrounding quotation marks","speaker":"speaker name","role":"optional office/title"}

Rules:
- Quotes are occasional, not a quota. Most events should have no quote.
- Never duplicate event.quote.text inside description.
- Attribute only when the speaker is known from the supplied canon or the event you are simulating. If attribution is uncertain, omit the quote rather than guessing.
- For real historical people in a historical context, do not fabricate a quotation and present it as an authentic historical quote. Use a documented/grounded quotation when available; otherwise omit it.
- In alternate-history or fictional developments, an in-world statement may be generated when it is clearly part of the simulated event rather than falsely presented as a documented real-world quotation.
- Keep quote.text concise and directly relevant to the event.
- The quote object is presentation metadata, not an additional mechanical impact.
This instruction supersedes any older frozen prompt instruction telling you to put block quotes at the end of event.description.`;
  }


  // Round-Zero bootstrap uses the EXISTING pregameHistory call and the EXISTING
  // canonical ledgers. Prompt packs may now carry the generic Round-Zero contract
  // themselves; when they do, append only dynamic runtime grounding so we do not
  // pay twice for the same doctrine. Older/frozen prompt packs still receive the
  // full compatibility contract here.
  if (taskKey === "pregameHistory") {
    const roundOneDate =
      normalizeString(variables?.date) ||
      normalizeString(variables?.dateReadable) ||
      "the game start date";

    const runtimeGrounding = `[Round-Zero Runtime Grounding — LIVE]
Start date: ${roundOneDate}

CURRENT ROUND-ONE POLITIES — STRUCTURED OUTPUT AUTHORITY:
${normalizeString(variables?.pregameCanonicalPolityVocabulary) || "No current polity vocabulary was available."}

Rules:
- Every polity token inside canonicalUpdates.polities/opponents MUST resolve to one of the current polities above.
- Historical/prose labels are descriptive only. Never create a structured umbrella/legacy polity that does not exist in the current save.
- Titles/details may use natural historical prose; structured polity identity must remain canonical.

CURRENT CANONICAL STATE ALREADY PRESENT:
Wars:
${normalizeString(variables?.canonicalWarContext) || "None supplied."}

Diplomacy:
${normalizeString(variables?.canonicalDiplomaticContext) || "None supplied."}

Do not duplicate canonical state already present. Return canonicalUpdates:[] only when no qualifying Day-1 canonical state exists.`;

    const diplomaticBaselineOverride = `[Round-Zero Diplomatic Baseline — LIVE OVERRIDE]
This supersedes any earlier Round-Zero wording that says every relation or already-standing agreement must have its own uniquely identifiable causal event in the bounded pre-game event list.
Round-Zero relations are absolute as-of-start political memory, not single-event deltas. Existing agreements are standing Day-1 state, not necessarily newly signed during the displayed backstory window.
Emit historically justified relation/agreement baseline records even when no single generated event card uniquely anchors them. Native Javascript will attach a source event when one is clear and otherwise preserve the valid baseline fact without inventing false causality.
Do NOT create filler event cards solely to satisfy relation/agreement bookkeeping.
Within the available canonicalUpdates capacity, cover the material diplomatic graph rather than stopping after a handful of obvious pairs.`;

    const warStorylineMirrorOverride = `[Round-Zero War Storyline Mirror — LIVE OVERRIDE]
This supersedes any earlier Round-Zero instruction requiring the model to emit a second storyline item for a live war.
For each war already live at Round One, emit the canonical war lifecycle item (normally kind="war:start") and its real causal event with matching event.warId.
DO NOT spend a separate canonicalUpdates slot on storyline-<warId>. After the war ledger validates, native Javascript mechanically mirrors that live conflict into the EXISTING world.storylines ledger with the canonical id storyline-<warId>, kind=war, and the validated belligerents as participants.
Still emit other unresolved non-war storylines normally.`;

    const hasRoundZeroContract =
      systemPrompt.includes("[ROUND-ZERO WORLD BOOTSTRAP CONTRACT v4]");

    if (hasRoundZeroContract) {
      systemPrompt = `${systemPrompt}

${runtimeGrounding}

${diplomaticBaselineOverride}

${warStorylineMirrorOverride}`;
    } else {
      systemPrompt = `${systemPrompt}

[ROUND-ZERO WORLD BOOTSTRAP CONTRACT v4]
This ONE pregameHistory response writes bounded history strictly BEFORE ${roundOneDate} and compiles important state ALREADY TRUE at Round 1 into the EXISTING storyline, war, relation and agreement ledgers. It is not a future-history scheduler.

GEMINI-SAFE CANONICAL ENVELOPE
Use canonicalUpdates only. Every item uses the same flat required fields. Fill irrelevant fields with "", [], or 0.

Kinds:
- relation: polities=[A,B], score, detail.
- storyline:active | storyline:dormant: id, polities participants, pressure, momentum, date, category process kind, title, detail state.
- war:start | war:join-a | war:join-b | war:leave | war:ceasefire | war:resume | war:end: id, polities actors, opponents, detail.
- agreement:start | agreement:update | agreement:suspend | agreement:resume | agreement:end | agreement:expire: id, polities parties, category agreement type, title, detail terms/current meaning.

Never output relation status or event indexes/ids. Javascript owns those mechanics.

ROUND-ZERO AUDIT
- Every war still live at Round 1 must have BOTH a war update and matching ACTIVE storyline id storyline-<warId>, category=war.
- Every materially important active formal agreement explicit in the source must be represented and must have a unique causal pregame anchor event.
- Persist sparse bilateral relations needed to explain how central actors actually make decisions on Day 1; do not leave central actors blank when the source explicitly establishes allies, patrons, rivals or enemies.
- Keep wars, relations and agreements distinct.
- Preserve causal historical inertia when underlying causes remain intact, but never schedule future historical outcomes.

${runtimeGrounding}

${diplomaticBaselineOverride}

${warStorylineMirrorOverride}`;
    }
  }

  // Phase 6B.2: long fixed-date jumps use bounded internal whole-world passes so new storylines can persist and compete for attention before the user-visible jump ends.
  // Appended here (not only in defaultPrompts.json) because every game carries
  // its own frozen copy of the task prompts — a directive added at call time is
  // the only way the rule reaches campaigns that already exist. Field report:
  // "the AI just makes events saying that you form a treaty with another
  // country ... it just doesn't give you a choice and makes it an event."
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    const playerDecisionGateMode = taskKey === "autoJumpForward"
      ? "AUTO-JUMP: when a genuinely consequential foreign request or crisis reaches a point that requires a NEW strategic decision from the player, stop at that decision point and surface it through diplomaticOutreach / an open createdChat / an event explicitly awaiting the player's answer."
      : "STANDARD FIXED JUMP: do not invent the missing player decision merely to keep the timeline moving. Leave the request unresolved when appropriate, or let FOREIGN actors delay, hedge, back down, escalate, or proceed using only existing commitments and the uncertainty created by the absence of new player authorization.";

    systemPrompt = `${systemPrompt}

[Player Agency — Strategic Decision Gates]
${playerName} is controlled by a human player. PLAYER SILENCE means only that no NEW authorization has been given. It is NOT consent, rejection, neutrality, refusal, abdication, or permission for you to choose the historically expected policy.

Never convert silence into an inferred doctrine. In event titles/descriptions, prefer factual wording such as "no new guarantee has been issued by ${playerName}", "no mobilization order has been authorized", or "the player government has not provided additional commitments" rather than declaring the player polity "neutral", "opposed", "supportive", or "refusing" unless the player actually established that policy.

You MAY autonomously simulate ordinary life inside ${playerName}: routine administration, implementation of already-established policy, parliamentary or court politics, markets and industry, social movements, routine military maintenance/readiness, and automatic consequences of commitments or orders the player already made.

You MUST NOT create a NEW strategic decision for ${playerName} unless it directly executes an explicit planned action, chat reply, standing order, or prior commitment whose scope clearly authorizes it. In particular, do not silently:
- sign or reject a treaty, alliance, guarantee, ceasefire, surrender, trade pact, union, or major diplomatic settlement;
- issue or accept an ultimatum;
- grant a "blank check" or new security commitment;
- declare war or peace;
- order a major offensive, general mobilization, landmark deployment, annexation, cession, or regime change;
- make a major foreign-policy reversal or negotiated compromise on the player's behalf.

Existing commitments continue to operate ONLY within their actual scope. A defensive alliance is not automatically an offensive-war guarantee. A consultation promise is not automatic consent to the counterpart's preferred policy.

When history or another polity reaches a point that would normally require a NEW decision by ${playerName}, HISTORY STOPS AT THE DECISION GATE. Do not fill in the historical answer.

${playerDecisionGateMode}

Events remain free to narrate what foreign polities do among themselves and what independent institutions inside ${playerName} do within already-authorized policy.`;

    const canonicalWarContext = normalizeString(variables?.canonicalWarContext);
    systemPrompt = `${systemPrompt}

[Canonical War-State Ledger — LIVE 6B.3]
world.wars is the AUTHORITATIVE source of belligerency. Storylines explain causal/narrative continuity; they do NOT make countries belligerents.

CURRENT CANONICAL CONFLICTS:
${canonicalWarContext || "No active or ceasefire canonical wars are recorded."}

Hard rules:
- Actual battlefield combat requires an ACTIVE canonical war.
- Battle/offensive/invasion/bombardment/raid/siege/front-combat events MUST carry event.warId and event.combatants.
- event.combatants must name real belligerent polities from BOTH opposing sides of that war.
- A declaration of war, entry into an existing war, departure, ceasefire, resumption, or peace/end MUST emit a matching top-level warUpdates record and a real event carrying the same warId. Native Javascript binds the record to that event; do not spend reasoning effort counting event positions.
- An alliance does not silently activate. Mobilization does not silently activate. A historical war does not silently activate. A storyline whose title contains "war" does not silently activate.
- If a historically expected belligerent has not actually joined in THIS campaign, it has no battlefield front.
- WAR-DEPENDENT DOMESTIC / ECONOMIC FRAMING is ledger-bound too. A polity that is NOT a belligerent must not be described as operating under its own "wartime" economy, wartime rationing, wartime food policy, wartime mobilization/demobilization, war taxes, blockade conditions, or comparable belligerency-dependent home-front conditions merely because the calendar matches real history or because OTHER countries are fighting.
- Foreign-war spillover into a neutral/non-belligerent polity is allowed only when CURRENT supplied canon gives a concrete causal bridge (for example disrupted imports, refugee pressure, border trade interruption, or sanctions). In that case describe it explicitly as spillover from the named foreign conflict; do NOT imply the affected polity itself is at war.
- Real-world chronology is never evidence that an absent war, blockade, mobilization, or home-front regime exists in THIS campaign.
- ${playerName} may not be inserted into a war merely because history/alliance logic suggests it. The existing Player Agency decision-gate rules still control new player commitments.
- warUpdates is compact text, one record per line:
  warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note
  ops: start | join-a | join-b | leave | ceasefire | resume | end
  eventNumbersCSV is a compatibility placeholder/hint and may be blank; runtime owns canonical event binding from warId + transition semantics.
- Return warUpdates:"" when belligerency does not change in this pass.

This state is persisted between hidden world passes and is the future Stats -> Current Conflicts source of truth.`;

    systemPrompt = `${systemPrompt}

[Structured Polity Update Integrity — LIVE 9Q.2]
impacts.polityChanges operation="update" is a REAL persistent state mutation, not decoration for an otherwise ordinary event.
- Do NOT emit a polity update merely because an event concerns domestic politics, economics, administration, a debate, a review, a meeting, or a general condition.
- Do NOT restate existing tags, invent/restate a stability value, or attach a tiny metadata/stat tweak just to make an event look mechanically consequential.
- A debate/proposal/review with no enacted policy, institutional change, leadership change, material reputation shift, or other concrete persistent outcome should normally have NO polityChanges entry.
- stats fields may be changed only when THIS event itself materially changes that persistent statistic and the direction/magnitude is causally supported by current campaign canon.
- tags may be rewritten only for an actual ideological/alignment/governance shift that the event establishes; routine political disagreement does not rewrite a polity's identity.
If no real persistent polity state changes, leave impacts.polityChanges empty.`;

    const worldInitiativeContext = normalizeString(variables?.worldInitiativeContext);
    systemPrompt = `${systemPrompt}

[Native World Director — authoritative live causal context]
${worldInitiativeContext || "No native World Director context was available; reason from current campaign state without importing a memorized future calendar."}

The Native World Director context above is the SINGLE live owner of world-attention, historical-candidate/causal-inertia, causal-timing, branch-recompute, exploration, and persistent-storyline doctrine. It supersedes overlapping or older frozen prompt wording on those topics. Follow the separate Player Agency and Canonical War State rules above for human authorization and actual belligerency.`;

    systemPrompt = `${systemPrompt}

[Economic Causality — LIVE 7A.2]
The CANONICAL ECONOMIC CONSTRAINTS supplied by the Native World Director are authoritative where present. They describe capability and financing pressure, NOT hard action gates. Never use a crude threshold such as "debt above X means this action is impossible." A fiscally stressed government may still rearm, mobilize, subsidize, build infrastructure, or fight — but a large program must plausibly be financed through borrowing, taxation, cuts/reallocation, monetary expansion, foreign credit, asset sales, or acceptance of higher inflation/debt and political strain.

When a NEW event in this pass materially changes the macroeconomic condition of a polity that has a canonical Stats baseline, encode the lasting consequence in that SAME event with impacts.polityChanges[].stats using ABSOLUTE post-event values for only the fields that actually changed. Prefer gdpGrowth, inflation, unemployment, publicDebt, budgetBalance, stability, and relevant autonomy/independence indices. Do not casually rewrite derived GDP, GDP/capita, population, or territorial components from a normal world event; those aggregates are governed by the native component ledger.

Examples of causes that can warrant a Stats consequence when genuinely material: sustained war/mobilization finance, blockade or sanctions, major tax/borrowing programs, currency/financial crisis, severe harvest/energy shock, major industrial/infrastructure expansion, depression/boom, or a territorial settlement with substantial economic scope. A routine meeting, speech, single budget debate, or mere passage of time does NOT require a numeric change.

If an actor has NO canonical economic baseline in the supplied constraints, do not fabricate an entire numeric Stats sheet just to satisfy this rule. Reason qualitatively from the ordinary campaign context instead.

Any emitted stats update must remain causally compatible with the event prose. Economic strain changes the price and consequences of policy; it does not silently veto policy.`;
    // Map truth: the recurring field report is the OPPOSITE failure — invasions
    // narrated turn after turn with zero regionTransfers, so the map never moves.
    // Appended at call time for the same reason as [Player Agency]: existing
    // campaigns carry frozen prompts, so a defaultPrompts.json rule never
    // reaches them. This also disarms an over-cautious reading of the agency
    // rule above ("don't act for the player") as "don't move the map".
    systemPrompt = `${systemPrompt}\n\n[Map Truth — Control is not Sovereignty]\nTerritorial narration and the map must never disagree, but wartime control and legal sovereignty are DIFFERENT things. A battle capture, occupation, liberation or retaking uses impacts.regionControlOps (usually op=control; op=contest while the region is actively disputed). A treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement uses impacts.regionTransfers because legal sovereignty changed. Do NOT turn every front-line advance into a permanent legal border. When you do not know the exact region id, preserve the grounded place wording in regionId and set fromCode so the native geography resolver can map it conservatively. Resolving ${playerName}'s own ordered military operations into their real control consequences is REQUIRED and is never a player-agency violation. If nothing actually changed control or sovereignty this period, keep capture/cession language out of the event text.\n\n[Current Non-Normal Territorial State]\n${normalizeString(variables.territorialControlContext) || "No active occupations or contested regions recorded."}`;
    // No restating: the model is shown the recent timeline as context and, left
    // unchecked, re-narrates events it already reported — each restatement gets a
    // fresh id, so the same event stacks up and shows turn after turn. A content-key
    // de-dup on the write path (dedupeGeneratedEvents) drops exact/same-date
    // restatements; this directive stops the "rolling-date" ones (the same situation
    // re-narrated under each new turn's date) that a de-dup can't catch. Appended at
    // call time so existing frozen-prompt campaigns get it too.
    systemPrompt = `${systemPrompt}\n\n[New Developments Only]\nThe events shown to you above have ALREADY happened and appear only as context. Do NOT restate, rephrase, re-report, or re-narrate them. Emit ONLY genuinely NEW developments that occur during THIS period. If an ongoing situation (a war, a crisis, an occupation) has no new development this period, do not emit an event for it.`;
    // Place renaming: appended at call time so existing frozen-prompt campaigns get it
    // too; the markerOps rename op ships via the LIVE tool schema either way.
    systemPrompt = `${systemPrompt}\n\n[Place Renaming]\nYou may rename places when the story warrants it (a city renamed after a leader or ideology, a capital re-designated, a colonial name replaced, a conquered city given the conqueror's name). Emit an impacts.markerOps entry {"op":"rename","name":"<current name>","newName":"<new name>","note":"<why>"}. This works on structures you built AND on existing map cities. Do it sparingly and only when a real event motivates it.`;
    systemPrompt = `${systemPrompt}\n\n[Persistent Physical World — LIVE Phase 10.1]\nCURRENT MAP STRUCTURES is a bounded attention view of canonical persistent physical features; omitted features still exist in the save. Treat supplied feature names and ids as real parts of the world that can shape later history. If a supplied factory, arsenal, port, laboratory, base, logistics hub, headquarters or other feature materially participates in a new event, refer to it naturally by its exact canonical name. Mention alone requires NO markerOp.\nWhen an existing feature materially changes — major expansion/completion, capture/change of operator, conversion, damage, abandonment, reconstruction or destruction — REUSE its stable markerId with markerOps update. Do not build it again. Use lifecycle status literally: planned before work begins; under_construction once works/groundbreaking begin; active once operational; damaged after material damage; inactive when out of service; abandoned when left behind; destroyed when physically destroyed. A construction-start event must not silently default the feature to active. Destruction is normally status=destroyed, NOT remove, so the historical place remains canonical and can later be rebuilt or remembered. Use remove only for true canonical deletion/correction.\n\nPHYSICAL-WORLD CONSEQUENCE AUDIT — REQUIRED, BUT NOT A QUOTA:\nBefore finalizing EACH event you intend to emit, silently ask: Does this event establish a significant named geographically concrete physical facility/place that persists beyond the event, OR materially change an existing supplied feature? If YES, the matching markerOps build/update/rename is REQUIRED in that SAME event. Do not narrate a major factory opening, arsenal/rifle works, naval-yard or port expansion, logistics hub, laboratory, fortification, headquarters/base, airfield or similarly durable physical consequence while leaving the map unchanged. If an existing feature only participates and its state does not change, naturally reference its exact canonical name but emit no markerOp. If no qualifying physical feature is created or changed, emit no markerOp.\n\nExamples of the intended threshold: a new major aircraft factory = build; a major Wilhelmshaven naval-yard expansion = update the existing yard if supplied, otherwise build the newly represented facility; an insurgent government beginning organized rifle production at a persistent named works/arsenal = build; a raid that materially damages that works = update; ordinary output fluctuations, routine maintenance, generic offices, unnamed workshops, or "continues operating" = no markerOp.\nThere is NO marker quota and this audit must NEVER manufacture filler history merely to add pins. It only makes the physical consequences of events you already judged worth emitting mechanically complete. Prefer a few durable world features that future events can reuse over many generic pins.`;
  }

  // Existing campaigns carry frozen prompt packs, so group-chat floor control
  // needs a live directive too. Silence is a valid outcome here: this task decides
  // whether ANOTHER participant should take the floor, not whether a bilateral
  // counterpart is allowed to ghost the player (1:1 replies are guaranteed by UI).
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Autonomous Diplomacy — live override]\nA.I.-controlled polities have their own diplomacy and may negotiate, threaten, align, mediate, trade, or make agreements without waiting for ${normalizeString(variables.playerPolity) || "the player"}. Private A.I.↔A.I. diplomacy belongs in the TIMELINE as events. Lasting bilateral political shifts use top-level relationUpdates; signed/ratified/concluded formal treaties, alliances, guarantees and pacts use top-level agreementUpdates; polityChanges remains for polity metadata/reputation, regionTransfers for legal territorial settlements, and unitOps for concrete military coordination. Do NOT create a hidden or fake NPC-only chat: the player is implicit in every diplomatic chat in this game. impacts.createdChats and top-level diplomaticOutreach are ONLY for situations where one or more A.I. polities actually contact the player. A group chat means those listed polities are jointly bringing the player into the discussion, not privately talking among themselves. Keep the combined total of createdChats + diplomaticOutreach to at most 3 per jump; fewer is usually better, and zero is correct when nobody has a reason to contact the player.`;

    if (!systemPrompt.includes("[DIPLOMATIC RELATION DECISION MODEL v1]")) {
      systemPrompt = `${systemPrompt}

[DIPLOMATIC RELATION DECISION MODEL v1]
Canonical bilateral relation score/status is persistent political climate, not UI decoration. Use it as a strong prior for A.I. trust, threat interpretation, bargaining posture, willingness to cooperate or compromise, tolerance of strategic risk, demand for safeguards, and severity of reaction.

This is NOT a hard acceptance probability or veto. National interest, formal obligations, strategic geography, relative power, domestic constraints, reputation, and the concrete proposal remain independent causal factors. A friendly government may reject a dangerous demand; a hostile government may cooperate when necessity is overwhelming.

Formal agreements, bilateral warmth, and actual war are separate facts. A strained ally may still owe treaty duties; friendly states without a treaty have not promised support; hostility alone does not create belligerency.

When a NEW event materially changes a bilateral political climate, emit the supported sparse relationUpdate with the new ABSOLUTE score/status and bind it to that event. Do not drift scores merely because time passed. The same foreign action should often provoke meaningfully different responses when undertaken by a trusted partner versus a distrusted rival.`;
    }

    const diplomaticContinuity = normalizeString(variables?.diplomaticContinuity);
    if (diplomaticContinuity) {
      systemPrompt = `${systemPrompt}\n\n[Diplomatic Consequence Bridge — LIVE 5E]\nDiplomatic chats are part of the causal world state, not decorative roleplay. Before choosing this period's events, review EVERY durable diplomatic memory below and ask: "Does anything said or agreed here require a new development during the interval from ${normalizeString(variables.dateReadable) || normalizeString(variables.date) || "the origin date"} through ${normalizeString(variables.targetDateReadable) || normalizeString(variables.targetDate) || "the target date"}?"\n\n${diplomaticContinuity}\n\nEvidence rule: the "Standing diplomatic memory" is a compressed continuity aid. The "Recent verbatim diplomatic evidence" is authoritative for the exact words, actor attribution, deadlines, and modal force of recent exchanges. If a summary weakens, strengthens, or otherwise conflicts with the verbatim evidence, FOLLOW THE VERBATIM EVIDENCE. A later acknowledgement, pleasantry, or statement of mutual understanding does NOT cancel an earlier threat, promise, agreement, or declared intent unless it explicitly retracts, supersedes, or modifies it.\n\nApply these rules:\n1. MUTUAL AGREEMENT + DUE DATE: if the player and another polity explicitly agreed that a meeting, consultation, withdrawal, exchange, conference, hand-over, coordinated operation, or other concrete follow-through WILL occur on a date inside this simulated interval, that follow-through is a PRESUMPTIVE TIMELINE EVENT. Generate it unless the supplied canon shows it was already fulfilled, explicitly cancelled/superseded, prevented by a new event, or genuinely too trivial to be newsworthy. If such a commitment is already OVERDUE at the origin date and no fulfillment/cancellation appears in canon, do not forget it either: generate the belated follow-through, cancellation, breach, postponement, or other concrete explanation that best fits the world.\n2. AGREEMENT WITHOUT A FIXED DATE: preserve it as an active commitment and let it shape events; generate implementation when the period/context naturally reaches it.\n3. UNILATERAL DECLARATION: if a polity explicitly said it WILL take an action, treat that declaration as strong evidence of intent, but still simulate whether circumstances permit execution. For the human-controlled ${normalizeString(variables.playerPolity) || "player polity"}, only treat an explicit player chat statement as authorization when it plainly commits to the action; vague discussion is not an order.\n4. THREAT / WARNING / SUSPICIOUS INFORMATION: these do NOT automatically force one scripted reaction. They create DECISION PRESSURE on the affected A.I. polity. You must evaluate that pressure as part of this jump instead of merely remembering the words.\n   - IMMINENT, EXPLICIT THREAT OR ULTIMATUM: a direct credible statement such as "we will invade you in 24 hours", "withdraw by tomorrow or we attack", or an equally immediate military threat is CRITICAL pressure. Unless there is a concrete reason the target believes the threat is impossible, unserious, already withdrawn, or otherwise neutralized, the threatened A.I. polity should normally take at least one timely protective or diplomatic action BEFORE the threatened deadline: mobilize/redeploy forces, raise military readiness, alert allies, issue a protest/ultimatum, seek guarantees, evacuate exposed assets, or another contextually rational response. Do NOT require it to choose a specific response; choose what that government would realistically do.\n   - AMBIGUOUS MILITARY / LOGISTICAL SIGNAL: information such as new depots, rail improvements, exercises, reconnaissance, or logistical hubs near a frontier is NOT proof of hostile intent. Evaluate trust, alliances, recent crises, geography, military balance, prior assurances, and the actor's reputation. A cautious government may increase readiness or investigate; a trusting government may deliberately do nothing extraordinary. Either is valid. Do not manufacture an event merely to prove that the signal was noticed.\n   - POLITICAL / ECONOMIC / DIPLOMATIC SIGNAL: sanctions threats, alliance feelers, guarantees, recognition disputes, trade pressure, or severe diplomatic warnings should likewise alter the affected A.I. polity's choices when consequential, but rhetoric alone need not create a timeline event.\n   - SILENCE IS A DECISION ONLY WHEN PLAUSIBLE: for serious but ambiguous signals, "no extraordinary action" may be the correct outcome and need not be narrated. For an imminent credible invasion threat, silent inaction should be exceptional and supported by the world context, not the default.\n5. REACTIVE CONSEQUENCES ARE OWN ACTIONS: when an A.I. polity reacts, simulate ITS response as a new world event or diplomatic outreach where appropriate. Do not convert the original speaker's words into the target's action. An A.I. protest/contact with the player may use diplomaticOutreach/createdChats; internal cabinet decisions, mobilization, alliance coordination, deployments, investigations, and similar responses belong in timeline events.\n6. PROPOSAL OR REQUEST: a proposal that was never accepted is NOT an agreement. Do not turn it into accomplished fact. The recipient may still react to the proposal itself if accepting, rejecting, countering, preparing, or seeking clarification would be strategically meaningful.\n7. FOLLOW-THROUGH MUST BE NEW: if the commitment's implementation or the reaction already appears in Event History, do not restate it. If a new event makes the commitment impossible, narrate the cancellation/failure/breach instead when that is important.\n8. STRUCTURE REAL CONSEQUENCES: when follow-through or reaction changes persistent state, emit the proper impacts in the SAME event. A meeting or cabinet decision with no mechanical effect may simply be an event. Actual mobilization/redeployment/reinforcement uses unitOps and should reuse existing units where appropriate; spawn only genuinely new mobilized formations. A legal territorial settlement uses regionTransfers; lasting alignment/reputation changes use polityChanges. Do not narrate a concrete military movement that the structured impacts fail to represent.\n9. REACTION TIMING: consequences should occur when a competent government would actually act. An ultimatum expiring in 24 hours may warrant same-day or next-day response; an ambiguous infrastructure signal may take days or weeks to trigger policy. Do not postpone a clearly time-sensitive reaction until after the danger has passed merely because other storylines are active.\n10. REACTION-TARGET INTEGRITY: for every consequential diplomatic memory, identify (a) the polity that originated the signal/request/threat, (b) the polity or polities affected by it, and (c) any explicit response or declared intent already stated by the affected polity. A new event by the ORIGINAL SIGNALING polity does NOT satisfy the affected polity's reaction audit. Example: Germany announces frontier logistics work to Russia; a later German readiness event is not a Russian reaction. Evaluate Russia separately.\n11. RECIPIENT-DECLARED INTENT: inspect the recent verbatim evidence as well as the summary. If the affected A.I. polity itself has already replied with language such as "we must take measures", "we will mobilize", "we intend to reinforce", "we shall consult our allies", or another clear statement of intended action, treat that as a UNILATERAL DECLARATION by that polity, not merely as generic concern. Unless later dialogue/canon EXPLICITLY retracts or supersedes it, the next suitable simulation interval should normally show concrete follow-through or a concrete reason it was delayed/abandoned. Mere acknowledgement or calmer diplomatic language is not a retraction. Preserve proportionality: "take necessary defensive measures" need not mean full mobilization, but it should not silently collapse into no action by default.\n12. INTERNAL DECISION AUDIT: before finalizing the event set, silently review each durable diplomatic memory that contains a threat, warning, declaration, request, or strategically significant disclosure. For EACH affected A.I. polity decide one of: REACT NOW / REACT LATER / NO EXTRAORDINARY REACTION. Check that any output event actually belongs to the affected polity whose reaction you are evaluating. Only output resulting world events/chats that are newsworthy; never output this audit or filler events saying a government "decided to do nothing."\n\nThis bridge does NOT mean every diplomatic sentence deserves an event. It means explicit commitments and consequential signals must participate in normal event selection instead of being disconnected from the simulation.`;
    }
  }

  if (["idleDiplomacy", "nextSpeaker"].includes(taskKey)) {
    const canonicalDiplomacy = normalizeString(variables?.canonicalDiplomaticContext);
    if (canonicalDiplomacy) {
      systemPrompt = `${systemPrompt}

[Canonical Diplomatic State — LIVE 7B]
${canonicalDiplomacy}`;
    }
  }

  if (taskKey === "idleDiplomacy") {
    if (!systemPrompt.includes("[DIPLOMATIC RELATION DECISION MODEL v1]")) {
      systemPrompt = `${systemPrompt}

[DIPLOMATIC RELATION DECISION MODEL v1]
Treat canonical bilateral relation score/status as a strong prior for diplomatic tone and willingness to initiate contact. Friendly relations make reassurance, congratulations, candid consultation, alliance follow-up, and commercial feelers more plausible; strained/hostile relations make protests, warnings, guarded clarification, counter-balancing, or silence more plausible. This is not a hard threshold: current interests and events still decide whether anybody has a real reason to write.`;
    }
    const blockedSets = normalizeString(variables?.idleDiplomacyBlockedParticipantSets) || "None.";
    const eventReaction = normalizeString(variables?.eventDiplomaticReactionContext);
    const jumpInitiative = normalizeString(variables?.jumpDiplomaticInitiativeContext);
    systemPrompt = `${systemPrompt}\n\n[Living Diplomacy — live override]\nThis is optional autonomous outreach, not mandatory chatter. Return {"chat":null} unless an A.I.-controlled polity has a natural reason to contact the player now. A reason does NOT have to be a crisis or strategic negotiation: friendly congratulations, condolences, professional courtesy, curiosity, reassurance, clarification, protest, commercial interest, alliance follow-up, or a warm acknowledgement of a public development are valid when they fit the sender's relationship and interests. Do not manufacture importance, knowledge, hostility, or diplomatic stakes that the supplied world does not support. The approach may be bilateral OR, when several polities genuinely share the same purpose, a small group approach: countries must list every non-player participant who is jointly contacting the player, and speaker must be one of those participants. Never include the player's polity in countries. Reuse the diplomatic context already visible in Existing Chats instead of repeating a proposal, warning, congratulations, or request that is already there. A group approach is still a conversation WITH the player; never use this task to represent private NPC↔NPC talks.\n\n[Already active on this in-game date — DO NOT choose these exact participant sets]\n${blockedSets}\nIf the only plausible outreach would come from one of those exact participant sets, return {"chat":null} instead of generating a message the runtime must throw away. A different genuinely justified joint group is still allowed; do not invent extra participants merely to evade this guard.${eventReaction ? `\n\n[Event-triggered reaction — one-shot]\nA human administrator explicitly allowed NPCs to react to the canonical event below. Evaluate THIS event in the current diplomatic world. Silence remains valid and must be chosen when nobody would plausibly contact the player. But do not confuse "minor" with "unworthy of human contact": a friendly ally may simply congratulate the player, express sympathy, show interest, or make a brief good-natured remark even when no treaty, warning, or mechanical consequence is needed. Keep any opener natural and proportionate. The schema permits at most one initiating chat for this one-shot evaluation.\n\n${eventReaction}` : ""}${jumpInitiative ? `\n\n[Post-jump Diplomatic Initiative Review — LIVE 08.4.5]\nThe normal world simulation has finished this period and JS is performing a BOUNDED COMPLETION REVIEW for incoming diplomacy. Some polities may already have contacted the player this turn. Their messages consume slots, but they do NOT satisfy another polity's independent reason to speak. Examine the period's surviving events, player actions, current diplomatic position, existing relations/agreements, and unresolved prior conversations below. Ask which still-unrepresented A.I.-controlled polity, if any, would realistically choose to contact the player NOW rather than remain silent.\n\nDo NOT default to silence merely because no crisis exists or because another government already wrote. Major territorial changes, military buildup, alliance activity, trade or colonial friction, a conspicuous policy shift, an unresolved warning/proposal, or a meaningful friendly development can naturally prompt a warning, reassurance, clarification request, congratulations, implementation note, trade feeler, mediation offer, or strategic probe. DIRECT RESPONSE-BEARING DIPLOMACY is stronger: a formal invitation, request for a government's position, treaty/mediation proposal, demand, ultimatum, guarantee, request for assistance, or comparable direct diplomatic act creates a strong presumption that a named addressee who has not yet responded should answer unless the supplied canon gives a concrete reason for silence. A polity does NOT need prior chat history to initiate; cold-start partners are fully eligible. Conversely, do NOT create chatter merely because a month passed. The supplied context may report prolonged autonomous silence: treat 60+ days as a reason to search unresolved diplomatic continuity more carefully and 90+ days as conspicuous silence that deserves a deliberate re-check, NOT as permission to invent a message. When silence is conspicuous, do not require a fresh crisis or treaty proposal: an ally, rival, major trading partner, or strategically concerned power may have a concrete reason for a proportionate implementation note, reassurance, clarification, commercial feeler, warning, or friendly continuity contact based on an ongoing relationship. Prefer such a grounded contact over indefinite silence when a real current interest exists and the same participant set is not already represented this turn. If no FURTHER polity has a concrete reason to speak after that review, return {"chat":null}. Return at most ONE initiating chat for this review; JS may ask again while slots remain.\n\n${jumpInitiative}` : ""}`;
  }

  if (taskKey === "nextSpeaker") {
    systemPrompt = `${systemPrompt}\n\n[Diplomatic Floor Control — live override]\nThis task decides whether another non-player participant should take the floor in a GROUP diplomatic chat. Returning nextSpeaker:null is valid and often correct when nobody has a distinct useful contribution, the player's message merely acknowledges/closes the exchange, or another reply would only repeat agreement. Never select a participant merely because they are present. If the player directly addresses or asks a participant for an answer, that participant should normally respond. Do not select the most recent speaker or anyone the caller marks as already having spoken in this response round. Bilateral chats do NOT use this silence decision: their counterpart still answers the player's message.`;
  }

  if (taskKey === "gameMaster") {
    systemPrompt = `${systemPrompt}\n\n[GM Territorial Semantics — live override]\nA wartime capture/occupation/liberation/retaking changes DE-FACTO control and must use impacts.regionControlOps, not regionTransfers. Use regionTransfers only for a LEGAL sovereignty change such as treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement. Do not conflate the two just because the old frozen GM prompt says \"moves territory\".\n\n[GM Geographic Completeness — LIVE 8B.2.10]\nTerritorial narration and structured operations must agree PLACE BY PLACE, not merely in aggregate. If an authored event says control is established, expanded, consolidated, seized, occupied, liberated or retaken in several named cities/areas, emit a matching regionControlOps operation for EVERY named place whose map region actually changes control. Never narrate \"Płock, Częstochowa and Warsaw\" while emitting only two control operations. For a city-grounded change, put the actual city name in regionId/regionName or the exact rendered region id/name when known; native validation will map the city point to the rendered region and will reject an incomplete preview rather than silently dropping the city. One operation must describe one intended place: never reuse a nearby city's rendered region for a different named city, and never let event-wide prose substitute for the operation's own geographic target.\n\n[GM Physical-World Completeness — LIVE 10.1B]\nCURRENT MAP STRUCTURES is canonical persistent physical state, including stable marker ids and lifecycle status. For EVERY authored GM event, silently audit whether the prose establishes a significant named geographically concrete physical feature that persists beyond the event OR materially changes an existing supplied feature. If YES, the SAME event MUST contain the matching impacts.markerOps mutation. BUILD only a genuinely new feature. UPDATE the SAME existing markerId for major expansion/completion, capture or operator change, conversion, damage, abandonment, reconstruction, or destruction. RENAME preserves identity. REMOVE is only true canonical deletion/admin cleanup — historical destruction is status=destroyed and the marker remains in canon. Use status literally: planned before work, under_construction once construction has begun, active once operational, damaged after material damage, inactive when out of service, abandoned when left behind, destroyed when physically destroyed. A catastrophic explosion that leaves a damaged site therefore MUST update that existing marker to status=damaged; reconstruction later updates the SAME id toward under_construction/active. If a supplied feature merely participates without changing, reference its exact canonical name naturally but emit no markerOp. Never create marker filler merely because this audit exists.\n\n[Current Non-Normal Territorial State]\n${normalizeString(variables.territorialControlContext) || "No active occupations or contested regions recorded."}`;
  }

  // The consolidator's summary REPLACES what it covers, so anything it leaves out
  // is gone from the campaign for good. Existing games carry frozen prompts, so
  // both the instruction and the order list have to arrive at call time.
  if (taskKey === "eventConsolidator") {
    systemPrompt = `${systemPrompt}\n\n[Durable Canon]\nThis summary REPLACES the material it covers: once consolidated, those events, conversations and player orders are never sent to the simulation again, so whatever you omit is lost permanently. Carry forward explicitly, as standing facts rather than narration:\n1. How this world has DIVERGED from real history — states that never formed, wars that never happened, rulers who never fell, borders that never moved. Name them. A later model that sees only a gap fills it from real history and invents powers this campaign does not contain.\n2. The lasting CONSEQUENCES of the player's own orders, not the orders themselves.\n3. Commitments still in force: treaties, alliances, occupations, debts, standing grievances.\nBrevity matters, but never at the cost of a divergence or a commitment that is still true.`;
    const resolvedOrders = normalizeString(variables?.actionsToConsolidate);
    if (resolvedOrders && !resolvedOrders.startsWith("No ")) {
      systemPrompt = `${systemPrompt}\n\n[Player Orders Being Consolidated]\nThese are the player's own resolved orders for the period covered by this summary. Record what they CHANGED about the world; the order text itself is being discarded.\n${resolvedOrders}`;
    }
  }

  // Reputation context: how the world currently regards the player, and how the
  // model should let it bias behaviour and evolve it via polityChanges.
  // Territory is owned by REGIONS, but the model kept naming CITIES in regionTransfers
  // (e.g. "Toulouse"), which match no region and are silently dropped — the map never
  // moves though the event narrates a capture. Force region names, and teach the
  // take-the-whole-region (default) vs capture-only-the-city (markerOps) distinction.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Region and City Capture]\nTerritory is stored by MAP REGIONS. Prefer an exact region id/name from [Game Map Description]. If an event is grounded in a city, fortress, port, translated name, exonym, or historical area and you genuinely do not know the map region name, DO NOT invent one: put that exact grounded place/area wording in regionId (and regionName if useful) and ALWAYS set fromCode to the current controller/losing polity. The native geography resolver can conservatively map that wording only against that side's real regions; if it cannot do so safely, the operation is rejected instead of moving the wrong province.\nA regionControlOps control changes the WHOLE resolved map region's de-facto controller but leaves legal sovereignty intact. A regionTransfers entry changes the WHOLE resolved map region's LEGAL sovereign and normally hands administration over too unless a third-party occupier still physically controls it. If only a city changes hands while the surrounding region does not (a holdout, occupied port, enclave), do not change the region; use the point/marker representation instead.\nFor a total wartime occupation/collapse, regionControlOps control may use wholeCountry=true. For a total legal annexation/unification/partition settlement, regionTransfers may use wholeCountry=true. Never use either wholeCountry shortcut for a partial campaign.`;
  }

  // Polities are identified by their full country name EVERYWHERE. A model that
  // answers "ESP" gets canonicalised on ingest, but it also then reasons about "ESP"
  // and "Spain" as if they were two powers, so state the rule rather than only
  // repairing the output.
  if (["actions", "jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor", "territoryDirector"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Polity Names]\nEvery polity is identified ONLY by its full country name, exactly as written in the map description — "Spain", "United States", "Soviet Union". NEVER use a country code or abbreviation such as "ESP", "USA" or "SOV", anywhere, in any field. This applies to every owner field despite their names: toCode, fromCode, ownerCode and a polity's code all take the FULL NAME. A code is not a shorter way of writing a country here; it is a different, non-existent polity, and using one creates a phantom country on the map beside the real one.`;
  }

  if (taskKey === "gameMaster") {
    systemPrompt = `${systemPrompt}\n\n[GM Polity Identity vs Current Name — LIVE 8B.1.4]\nNever use ISO/map abbreviations. For territorial, war, relation, agreement, unit-owner and other canonical references, use the stable full polity identity. In impacts.polityChanges specifically, code is the stable historical/campaign identity and name is the OPTIONAL current regime/display name. Example: a Polish independence uprising may restore code=\"Poland\" while the event establishes name=\"Polish Provisional Government\". The display name does NOT create a second polity. UPDATE is only for an already-current active polity; it must never be used to establish independence or awaken a dormant historical identity. Choose a provisional/junta/republic/monarchy/etc. name only when the event itself supports that governing form; otherwise leaving name blank (so the stable identity is displayed) is better than inventing unsupported politics. This live rule supersedes any older instruction that treats polityChanges.code and polityChanges.name as interchangeable.`;
  }

  // Units kept landing at 0,0 (null island) because the model copied the lng:0,lat:0
  // placeholder from the output template; guide it to real coordinates.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Unit Coordinates]\nWhenever an event says a force is raised, mobilised, garrisoned, landed, reinforced, redeployed or moved, that event MUST carry the matching impacts.unitOps — a spawn for a force that now exists, a move for one that relocated. An event that describes troops without unitOps produces a story about an army the map never shows.\nWrite every coordinate as a plain decimal number, using a POINT for the decimal mark and no other characters: lng 37.06, not "37,06", not "37.06°E". Every unitOps spawn and move MUST use the real-world longitude and latitude of where the unit actually is or is going. The lng 0 / lat 0 shown in the output template is ONLY a placeholder \u2014 0,0 is open ocean off West Africa, never a valid position, and a unit placed there is discarded. Set lng and lat to the actual coordinates: use the values from [City Coordinates] for a unit at or near one of those cities, or the real coordinates of the region or front where the action happens.`;
  }

  if (["actions", "jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor"].includes(taskKey)) {
    const reputationContext = normalizeString(variables.playerPolityReputationContext);
    if (reputationContext) {
      systemPrompt = `${systemPrompt}\n\n[International Reputation]\n${reputationContext}\nLow international reputation should reduce trade, trust, and coalition support, and should make nearby rivals more likely to sanction, isolate, or form balancing alliances. High reputation should improve access, trust, and coalition-building. When events this turn change how the world regards a polity, record the new value by including a "reputation" field (an integer 0-100) on that polity's impacts.polityChanges entry: aggression, broken treaties, and atrocities lower it; cooperation, aid, and honored commitments raise it. Only include reputation when it actually changes.`;
    }
  }

  // The actions menu goes last so the system prompt for every jump ends with the full
  // list of levers the model can pull (reaches existing games too — see ACTIONS_REFERENCE).
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n${ACTIONS_REFERENCE}`;
  }

  if (taskKey === "unitDirector") {
    const directorUnits = normalizeString(variables.unitDirectorUnits) || "[]";
    const directorCandidates = normalizeString(variables.unitDirectorCandidates) || "[]";
    systemPrompt = `${systemPrompt}\n\n[Native Unit Director — runtime rules]\nYou are NOT writing new history. The supplied events are already canonical candidates. Your only job is to make existing persistent military units behave consistently with those events.\n\nCURRENT GAME DATE: ${normalizeString(variables.unitDirectorGameDate)}\nCURRENT ROUND: ${normalizeString(variables.unitDirectorRound)}\n\nCURRENT PERSISTENT UNITS:\n${directorUnits}\n\nMILITARY EVENT CANDIDATES:\n${directorCandidates}\n\nPriority order:\n1. REUSE existing unit ids. Existing armies should move, attack, weaken, retreat through later moves, and persist across turns.\n2. MOVE a current unit when the event says that formation/army advances, withdraws, redeploys, mobilizes toward a front, or otherwise changes position.\n3. ATTACK only when the EVENT ITSELF already describes actual battlefield contact (battle, clash, assault, bombardment, offensive, invasion or direct fighting) between two supplied opposing units AND the event does not already declare a decisive winner/territorial transfer. A conscription law, mobilization order, readiness measure, exercise, procurement, training, deployment preparation, administrative integration or other military-policy event is NOT combat and MUST NEVER receive op=attack merely because military units exist. Use op=attack with attacker and defender ids only for genuine fighting. Do NOT guess casualties with strength; javascript resolves the clash deterministically.\n4. SPAWN only when the event genuinely creates a new formation/mobilization/reinforcement that is not already represented. Never spawn a new counter merely because an existing army is fighting again.\n5. strength is only for explicit NON-COMBAT reinforcement, attrition, disease, desertion, refit or demobilization. remove only for explicit destruction/disbandment.\n6. Do not invent military activity for diplomatic, political or economic events. It is valid to return no ops for an event.\n7. Never change territory. The territory/control layer is separate.\n8. Use only supplied existing unit ids. Keep movement local/plausible for the era; a move may precede an attack in the same event when needed to bring formations into contact.\n\nReturn exactly the required tool payload.`;
  }

  const controller = new AbortController();
  // Let an external signal (the player pressing Cancel) abort the in-flight AI
  // call too — the abort propagates through callAI to the server relay.

// ---- timeline curator calibration ------------------------------------------
// the analyst has a bad habit of calling routine paperwork "worthwhile" and
// claiming recurrence matters because, apparently, another fucking timetable
// is now a historic recurring crisis.

if (taskKey === "timelineCurator") {
  systemPrompt = `${systemPrompt}

[Strict Curator Calibration]

Be conservative about DELETING history, but do NOT be conservative about CLASSIFYING low-value material accurately. JavaScript applies independent safety gates after your judgment.

RECURRENCE:
Set recurrenceMatters=true ONLY when repetition itself creates meaningful historical pressure or consequence.

Examples that normally justify recurrenceMatters=true:
- renewed clashes or combat
- casualties
- strikes, protests, riots or unrest
- arrests or repression
- sanctions, embargoes or blockades
- shortages or economic disruption
- mutiny, sabotage, breakdown, failure or withdrawal
- repeated incidents whose accumulation materially changes the situation

Routine continuation does NOT make recurrence meaningful.

Normally set recurrenceMatters=false for repeated:
- meetings or conferences
- negotiations without a new settlement
- planning cycles
- operational timetables
- mobilization schedules
- technical protocols
- reviews or inspections
- budget negotiations
- funding tranches
- administrative implementation
- reports, studies or committees
- ordinary military preparations without a new operational consequence

Do not use recurrenceMatters merely as a reason to protect an otherwise incremental event.

WORTHWHILE:
substantive=true does NOT imply worthwhile=true.

Set worthwhile=false when an event establishes a real but minor fact that does not deserve its own permanent timeline entry because an already-established storyline merely advanced another routine step.

Examples:
- another timetable in an already established military plan
- another implementation protocol after the policy already exists
- another round of budget bargaining with no decisive legislative outcome
- another committee, review, inspection or consultation
- another technical refinement to an already functioning program

QUALITATIVE ADVANCE:
A new detail is not automatically a materially new dimension.

Things such as another timetable, quota, funding allocation, review result, logistics arrangement, protocol refinement, procedural step, or administrative package normally remain incrementalProcess=true and qualitativeAdvance=false unless they cross a real threshold.

PROCESS FILLER:
If processFramePresent=true and there is no completed observable result directly quotable from the candidate, set:
- observableOutcomeEvidence=""
- pureProcessFiller=true

Do not rescue a process-only event merely because the meeting concerns an important subject.

SATURATED STORYLINES:
When a storyline already has several recent canonical entries, judge whether the candidate actually changes the situation rather than rewarding it for being specific.

A small new detail inside an already-established process may still have:
- substantive=true
- materiallyNewDimensions containing a minor detail

while correctly having:
- worthwhile=false
- qualitativeAdvance=false
- incrementalProcess=true

STORYLINE STAGE REGRESSION:
A candidate is not a qualitative advance merely because it gives a fresh date or a more detailed description to a diplomatic, political, military, or administrative state that earlier canonical events already resolved.

Read the supplied prior history chronologically.

If prior canonical history shows a storyline progressing through stages such as:
proposal → response → negotiation → decision → implementation

then a later candidate must not treat an earlier stage as newly occurring again unless the candidate explicitly establishes a new trigger, reopening, reversal, or materially changed position.

Examples:

If a government already formally rejected a proposal, a later event saying that government rejects the same proposal again is normally REDUNDANT unless something reopened the question.

If negotiations already opened and later adjourned, a candidate describing the counterpart's initial response to the original proposal is normally a regression to an already-resolved stage.

If an alliance already finalized mobilization protocols, another event merely finalizing substantially the same protocols or schedules is normally incremental or redundant.

Judge the candidate against the LATEST established state of that storyline, not merely against whether its wording differs from one prior event.

A repeated important fact is still repeated. Importance does not make an already-established state new.

CONFIDENCE:
Confidence measures confidence in your CLASSIFICATION, not confidence that the event happened. Do not artificially reduce confidence merely because an event is plausible or historically realistic.

Default verdict remains KEEP when uncertain.

[MULTI-PASS CAUSAL CHAIN]
Candidates may have been generated in successive hidden world windows inside one user jump. If a later candidate materially depends on an earlier candidate in the SAME supplied batch/storyline, do not drop the earlier event merely as incremental/redundant when doing so would make the later development causally unintelligible. This does not protect filler; it protects real prerequisite milestones.

[CANONICAL WAR-STATE PREREQUISITES]
An event that starts/joins/resumes a canonical war may be the mechanical prerequisite for later same-batch combat carrying the same warId. Do not drop that transition as redundant when doing so would orphan later battles/offensives from their legal belligerency state. Peace/ceasefire/end transitions are likewise substantive because they change what later combat is allowed to occur.`;
}

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Date.now() + timeoutMs : null;
  const timeoutError = new Error(`AI task "${taskKey}" timed out.`);
  const timeoutId = deadline ? setTimeout(() => controller.abort(timeoutError), timeoutMs) : null;
  const tool = getGameplayTool(taskKey);
  const history = [{ role: "user", parts: [{ text: userMessage }] }];
  let failureReason = "The model did not return valid structured output.";

  try {
    for (let outputAttempt = 1; outputAttempt <= 2; outputAttempt += 1) {
      // Phase 9.2A: diagnostics are observational only. When explicitly enabled in
      // DevTools they measure the exact prompt/history already about to be sent;
      // they never filter, truncate, reorder, or mutate model-visible context.
      logContextDiagnostics({
        attempt: outputAttempt,
        helperTemplates: prompts.helpers,
        history,
        promptTemplate,
        stage: "structured-request",
        systemPrompt,
        taskKey,
        userMessage,
        variables,
      });
      const aiStartedAt =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      const response = await callAI(systemPrompt, history, {
        // No output-token cap. A long/action-heavy turn's JSON must not be truncated
        // mid-response — a cut-off response won't parse, so runJsonTask fell back to
        // canned events that carry NO regionTransfers and NO diplomacy, which is why
        // the map never changed and no chats opened. main.jsx now lets each provider
        // use its own model maximum when no maxTokens is passed.
        deadline,
        ...(Number(maxTokens) > 0 ? { maxTokens: Number(maxTokens) } : {}),
        ...(typeof reasoningEnabled === "boolean" ? { reasoningEnabled } : {}),
        signal: controller.signal,
        tool,
      });
      if (isContextDiagnosticsEnabled()) {
        const aiEndedAt =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        console.info(
          `[context 9.5B timing] ${taskKey} AI attempt ${outputAttempt}: ` +
          `${Math.max(0, aiEndedAt - aiStartedAt).toFixed(1)} ms`,
        );
      }
      const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
      let parsed = response?.toolInput ?? extractJsonPayload(rawText);
      let transportDecodeError = "";
      if (taskKey === "gameMaster" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const decoded = decodeGameMasterTransportPayload(parsed);
        transportDecodeError = normalizeString(decoded?.error);
        parsed = decoded?.payload;
      }
      // Provider/tool transport cleanup belongs here, before schema validation and
      // before any event can enter the canonical save. This is mechanical syntax
      // repair only; it does not rewrite event meaning.
      const eventTransportRepair = repairGeneratedEventTransportArtifacts(parsed);
      if (eventTransportRepair.repaired) {
        const repairedFields = [
          ...eventTransportRepair.titleIndexes.map((index) => `event${index + 1}.title`),
          ...eventTransportRepair.warIdIndexes.map((index) => `event${index + 1}.warId`),
        ];
        console.warn(
          `[OH event transport repair] stripped leaked JSON boundary syntax from ` +
          `${eventTransportRepair.repaired} generated event field(s): ` +
          repairedFields.join(", "),
        );
      }
      // A single mistyped optional field must not discard the whole turn to the
      // canned fallback: the model sometimes returns `catalyst` as a prose string
      // instead of the object|null the jump schema requires. Coerce any non-object
      // catalyst to null (= no catalyst offered this turn) so the turn's real
      // content (events, transfers, chats) still validates and applies.
      if (parsed && typeof parsed === "object" && parsed.catalyst != null
          && (typeof parsed.catalyst !== "object" || Array.isArray(parsed.catalyst))) {
        parsed.catalyst = null;
      }
      // Same idea for markerOps. The engine has always accepted `found`/`destroy`
      // as aliases and a build written flat, but the schema only ever allowed the
      // canonical spelling — and a single rejected op fails the WHOLE payload, so
      // one flattened building cost the player the entire turn. Rewrite to the
      // canonical shape here, before validation, so the turn survives.
      for (const event of Array.isArray(parsed?.events) ? parsed.events : []) {
        const ops = event?.impacts?.markerOps;
        if (!Array.isArray(ops)) continue;
        event.impacts.markerOps = ops.map((op) => {
          if (!op || typeof op !== "object") return op;
          const kind = String(op.op ?? "").trim().toLowerCase();
          if (kind === "destroy") {
            return { ...op, op: "update", status: "destroyed" };
          }
          const canonical = kind === "found" ? "build" : kind === "modify" ? "update" : kind;
          if (canonical !== "build" || op.marker) return { ...op, op: canonical };
          // Flat build: lift the structure's own fields under `marker`.
          const { op: _op, note, ...marker } = op;
          return { op: "build", marker, ...(note == null ? {} : { note }) };
        });
      }

      // 8B.2.18: the Stats tool now estimates only a bounded set of native
      // demographic macro buckets. Native code expands those estimates back into
      // every exact live-map component before canonical validation/persistence.
      // AI latency therefore stays roughly constant as province count grows.
      let statsCoverageError = "";
      let statsCalibrationError = "";
      let statsEconomicCalibrationError = "";
      if (taskKey === "countryStatSheet" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const macroPlan = normalizeArray(variables?.statsTerritorialMacroPlan);
        const decoded = decodeCountryStatMacroEstimates(
          parsed.territorialMacroComponentsText ?? parsed.territorialComponentsText,
          macroPlan,
        );
        statsCoverageError = normalizeString(decoded?.error);
        let components = decoded?.components || [];

        if (!statsCoverageError && macroPlan.length > 0) {
          const expanded = expandTerritorialMacroEstimates(
            macroPlan,
            decoded?.estimates || [],
            { previousComponents: variables?.statsPreviousTerritorialComponents },
          );
          statsCoverageError = normalizeString(expanded?.error);
          if (!statsCoverageError) components = expanded.components;
        }

        const calibrationRequested = Boolean(variables?.statsPopulationCalibrationRequested);
        const calibration = parsed.populationCalibration;
        if (calibrationRequested) {
          const allowedModes = new Set(["historical_start", "counterfactual_start", "campaign_reconstruction"]);
          const mode = normalizeString(calibration?.mode);
          const cutoff = normalizeString(calibration?.historyAuthorityCutoff);
          const basis = normalizeString(calibration?.basis);
          if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
            statsCalibrationError = "populationCalibration is required for this native Stats bootstrap/reconstruction.";
          } else if (!allowedModes.has(mode)) {
            statsCalibrationError = `populationCalibration.mode must be historical_start, counterfactual_start, or campaign_reconstruction; received ${mode || "blank"}.`;
          } else if (!cutoff) {
            statsCalibrationError = "populationCalibration.historyAuthorityCutoff must identify the latest shared-history frontier used for this scenario estimate.";
          } else if (!basis) {
            statsCalibrationError = "populationCalibration.basis must briefly state the evidence behind the regional causal calibration.";
          } else if (!statsCoverageError) {
            const total = components.reduce((sum, component) => sum + Math.max(0, Number(component?.population) || 0), 0);
            console.info(
              `[stats 8B.2.18.1] ${normalizeString(variables?.statsCalibrationTargetName) || "polity"}: ` +
                `regional causal calibration applied (${mode}; history authority through ${cutoff}) — ` +
                `${macroPlan.length} macro bucket(s) expanded to ${components.length} exact live component(s), ` +
                `population ${Math.round(total).toLocaleString()}. Basis: ${basis}`,
            );
          }
        }

        const economicCalibrationRequested = Boolean(variables?.statsEconomicCalibrationRequested);
        const economicCalibration = parsed.economicCalibration;
        if (economicCalibrationRequested && !statsCoverageError) {
          statsEconomicCalibrationError = validateNativeEconomicCalibration({
            calibration: economicCalibration,
            populationCalibration: calibration,
            components,
            eligibleEvidenceIds: variables?.statsEconomicEvidenceIds,
            currentDate: variables?.statsEconomicCalibrationCurrentDate,
          });
          if (!statsEconomicCalibrationError) {
            const totalPopulation = components.reduce(
              (sum, component) => sum + Math.max(0, Number(component?.population) || 0),
              0,
            );
            const totalGdp = components.reduce(
              (sum, component) =>
                sum +
                Math.max(0, Number(component?.population) || 0) *
                  Math.max(0, Number(component?.gdpPerCapita) || 0),
              0,
            );
            const generatedPc = totalPopulation > 0 ? totalGdp / totalPopulation : 0;
            console.info(
              `[stats nominal baseline] ${normalizeString(variables?.statsCalibrationTargetName) || "polity"}: ` +
                `${normalizeString(economicCalibration?.mode)} anchor ${economicCalibration?.anchorYear} ` +
                `${normalizeString(economicCalibration?.anchorCurrency).toUpperCase()} nominal GDP/capita ` +
                `${Math.round(Number(economicCalibration?.nominalGdpPerCapita) || 0).toLocaleString()} -> ` +
                `${Math.round(Number(economicCalibration?.rebasedGdpPerCapita2026Eur) || 0).toLocaleString()} 2026-EUR; ` +
                `generated ${Math.round(generatedPc).toLocaleString()} 2026-EUR.`,
            );
          }
        }

        // Calibration/macro transport fields are generation-only. The save keeps the
        // exact expanded component ledger plus native continuity/calibration stamps.
        const {
          populationCalibration: _populationCalibration,
          economicCalibration: _economicCalibration,
          territorialMacroComponentsText: _territorialMacroComponentsText,
          territorialComponentsText: _territorialComponentsText,
          ...statFields
        } = parsed;
        parsed = finalizeCountryStatSheet({
          ...statFields,
          territorialComponents: components,
        });

        const plannedComponentCount = normalizeArray(variables?.statsTerritorialPlan).length;
        const finalizedComponentCount = normalizeArray(parsed?.territorialComponents).length;
        if (!statsCoverageError && plannedComponentCount > 0 && finalizedComponentCount !== plannedComponentCount) {
          statsCoverageError =
            `Native Stats normalization dropped authoritative territorial components: expected ${plannedComponentCount}, finalized ${finalizedComponentCount}.`;
        }
      }

      let validation = transportDecodeError
        ? { valid: false, error: transportDecodeError }
        : parsed
          ? validateGameplayPayload(taskKey, parsed)
          : { valid: false, error: "Response did not contain parseable JSON or tool arguments." };
      if (validation.valid && (statsCoverageError || statsCalibrationError || statsEconomicCalibrationError)) {
        validation = {
          valid: false,
          error: [statsCoverageError, statsCalibrationError, statsEconomicCalibrationError].filter(Boolean).join(" "),
        };
      }

      // Round Zero alone uses the provider-safe canonicalUpdates envelope.
      // Once it has passed schema validation, Javascript expands that one response
      // into the four existing native ledgers before canonical validation.
      if (validation.valid && CANONICAL_UPDATE_ENVELOPE_TASKS.has(taskKey)) {
        parsed = expandCanonicalUpdateEnvelope(parsed);
      }

      if (validation.valid && validatePayload) {
        // finalAttempt tells the validator this is the last chance: callers use
        // it to switch from strict (return a corrective error for the retry) to
        // salvage (repair the payload in place). It MUST come from here, not
        // from counting validator invocations — when attempt 1 dies at the
        // schema/parse level this validator never runs, so an invocation
        // counter would treat attempt 2 as "first", return strict feedback
        // meant for the model, and hand the player a fallback whose reason
        // reads "Resend the same response with ..." (a real field report).
        const taskError = normalizeString(
          await validatePayload(parsed, { attempt: outputAttempt, finalAttempt: outputAttempt === 2 }),
        );
        if (taskError) validation = { valid: false, error: taskError };
      }

      if (validation.valid) {
        return { generation: { source: "ai", fallbackReason: "" }, payload: parsed };
      }

      failureReason = validation.error;
      if (outputAttempt === 1 && !controller.signal.aborted) {
        history.push({
          role: "model",
          parts: [{ text: rawText || JSON.stringify(parsed ?? null) }],
        });
        // A model that answered with a tool call is told to call it again; one
        // that answered in prose (local models without tool support) is told to
        // answer in raw JSON — telling it to call a tool it cannot see wastes
        // the one retry this task gets.
        const retryInstruction = response?.toolInput
          ? `Call ${tool?.name || "the required tool"} again with corrected input.`
          : "Respond again with ONLY the corrected JSON object - no prose, no explanations, no markdown fences, just the JSON.";
        history.push({
          role: "user",
          parts: [{ text: `Your previous structured answer failed validation: ${validation.error} ${retryInstruction}` }],
        });
        continue;
      }
    }
  } catch (error) {
    const actualError = controller.signal.aborted ? controller.signal.reason : error;
    failureReason = normalizeString(actualError?.message || actualError) || failureReason;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  // A deliberate user cancel must NOT silently fall back to canned events —
  // propagate the abort so the caller can quietly cancel the jump with no state
  // change. (A timeout still uses the fallback, as before.)
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Timeline jump cancelled.", "AbortError");
  }

  if (typeof fallback !== "function") {
    throw new Error(`AI task "${taskKey}" failed: ${failureReason}`);
  }

  console.warn(`[ai] task "${taskKey}" failed (${failureReason}) — using the deterministic fallback.`);
  return {
    generation: { source: "fallback", fallbackReason: failureReason },
    payload: await fallback(),
  };
};

const CONSOLIDATION_INTERVAL_ROUNDS = 5;
const CONSOLIDATION_RETAIN_EVENTS = 24;
const CONSOLIDATION_SIZE_THRESHOLD = 48;
const CONSOLIDATION_BATCH_SIZE = 60;

// Phase 9.4A: the canonical save still keeps every consolidated-history block.
// World Simulation gets a 24k-char OLD-HISTORY transport envelope. Young campaigns
// stay unchanged. Once the raw consolidated story exceeds 24k, promptContext reserves
// up to 6k of that SAME envelope for direct canonical-event anchors and uses the
// remaining ~18k for broad chronological consolidated-summary coverage. This keeps
// long-campaign cost bounded without trading away critical divergences for recency.
const WORLD_SIMULATION_CONSOLIDATED_HISTORY_MAX_CHARS = 24000;
const WORLD_SIMULATION_HISTORICAL_ANCHOR_ACTIVATION_CHARS = 24000;
const WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_CHARS = 6000;
const WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_ITEMS = 18;

const consolidateHistoryBatch = async (bundle, events, chats, actions = []) => {
  const variables = await buildTemplateVariables(bundle, {
    taskKey: "eventConsolidator",
    // Resolved orders are consolidated alongside the events they caused. Capping
    // the history that gets SENT each turn is not enough on its own: drop the old
    // orders without recording what they did and the model loses the campaign's
    // divergences from real history, then refills the gap from real history. A
    // player hit exactly that — a 1920s Europe with no WW1 and a surviving Tsar
    // started growing a Soviet Union that never existed.
    actionsToConsolidate: buildActionHistoryText(actions, {
      includeResolved: true,
      limit: actions.length || 1,
    }),
    chatsToConsolidate: buildDetailedChatHistoryText(chats, { limit: chats.length || 1, messageLimit: 100 }),
    eventsToConsolidate: buildEventHistoryText(events, { limit: events.length || 1 }),
  });
  const { generation, payload } = await runJsonTask("eventConsolidator", {
    fallback: () => ({
      summary: [
        events.map((event) => `${event.date || "undated"} ${event.title}: ${event.description}`).join("; "),
        buildChatSummaryText(chats, { limit: chats.length || 1 }),
        actions.length ? `Player orders resolved: ${actions.map((action) => action.title).join("; ")}` : "",
      ].filter(Boolean).join("\n"),
    }),
    timeoutMs: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 60000 : 0,
    userMessage: "Consolidate the supplied campaign history with the required tool.",
    variables,
  });
  return { generation, summary: normalizeString(payload?.summary) };
};

const compactHistoryIfNeeded = async (bundle) => {
  const world = normalizeWorldState(bundle.world);
  const unconsolidatedEvents = getUnconsolidatedEvents(bundle.events, world);
  const shouldCompactEvents =
    unconsolidatedEvents.length > CONSOLIDATION_SIZE_THRESHOLD ||
    (bundle.game.round % CONSOLIDATION_INTERVAL_ROUNDS === 0 &&
      unconsolidatedEvents.length > CONSOLIDATION_RETAIN_EVENTS);
  const priorChatIds = new Set(world.consolidatedHistory.flatMap((entry) => entry.chatIds));
  const closedChats = normalizeChats(bundle.chats)
    .filter((chat) => chat.status === "closed" && !priorChatIds.has(chat.id));
  const eventsToConsolidate = shouldCompactEvents
    ? unconsolidatedEvents.slice(0, -CONSOLIDATION_RETAIN_EVENTS).slice(0, CONSOLIDATION_BATCH_SIZE)
    : [];

  if (eventsToConsolidate.length === 0 && closedChats.length === 0) return world;

  // Ride along with a consolidation that is happening anyway — no extra AI call,
  // which matters when the point of the exercise is to shrink cost. Orders already
  // folded into an earlier summary are skipped.
  const priorActionIds = new Set(world.consolidatedHistory.flatMap((entry) => entry.actionIds));
  const actionsToConsolidate = normalizeActions(bundle.actions)
    .filter((action) => action.status !== "planned" && action.id && !priorActionIds.has(action.id))
    .slice(0, CONSOLIDATION_BATCH_SIZE);

  const { generation, summary } = await consolidateHistoryBatch(
    bundle,
    eventsToConsolidate,
    closedChats,
    actionsToConsolidate,
  );
  if (!summary) return world;
  const throughEvent = eventsToConsolidate.at(-1);

  return normalizeWorldState({
    ...world,
    consolidatedHistory: [
      ...world.consolidatedHistory,
      {
        actionIds: actionsToConsolidate.map((action) => action.id),
        chatIds: closedChats.map((chat) => chat.id),
        createdAt: new Date().toISOString(),
        source: generation.source,
        summary,
        throughDate: throughEvent?.date || bundle.game.gameDate,
        throughEventId: throughEvent?.id || world.consolidatedHistory.at(-1)?.throughEventId || "",
        throughRound: bundle.game.round,
      },
    ],
  });
};

const mergePolityCatalog = (countryCatalog, world) => {
  const merged = new Map();

  for (const country of countryCatalog) {
    if (!country) continue;
    merged.set((country.code || country.name).toUpperCase(), {
      code: country.code || "",
      name: country.name || country.code || "",
    });
  }

  for (const polity of Object.values(normalizeWorldState(world).polityOverrides)) {
    if (!polity) continue;
    merged.set((polity.code || polity.name).toUpperCase(), {
      code: polity.code,
      name: polity.name || polity.code,
    });

    if (polity.name) {
      merged.set(polity.name.toUpperCase(), {
        code: polity.code,
        name: polity.name,
      });
    }
  }

  return Array.from(merged.values());
};

// ---- Simulation busy lock ---------------------------------------------------
// The idle diplomacy drip (maybeSendIdleDiplomacy below) must never run - and
// above all never WRITE chat state - while a jump, game-master command, or
// catalyst stage is in flight: those read the full state bundle at entry and
// write it all back at the end, so a concurrent chat write would be silently
// clobbered (or worse, interleave with the rollback snapshot). Every simulation
// entry point wraps itself in beginSimulation/endSimulation; the drip checks
// the counter before starting AND before writing, and simply skips its turn.
let activeSimulations = 0;
const beginSimulation = () => { activeSimulations += 1; };
const endSimulation = () => { activeSimulations = Math.max(0, activeSimulations - 1); };
export const isSimulationBusy = () => activeSimulations > 0;

const resolveInvitees = async (names, world, additionalCountries = []) => {
  const countryCatalog = mergePolityCatalog(await loadCountryNames(), world);

  // Map known scenario/map actors onto the same stable lineage keys used by chat
  // reconciliation. This keeps useful map codes (flags/UI) without using them as
  // political identity when a save-aware name/alias already resolves correctly.
  const catalogByPolityKey = new Map();
  for (const country of countryCatalog) {
    const resolved = resolveChatParticipantIdentity(country, world);
    if (!resolved.safe || !resolved.polityKey) continue;
    if (!catalogByPolityKey.has(resolved.polityKey)) {
      catalogByPolityKey.set(resolved.polityKey, resolved.participant);
    }
  }

  // Same-event polityChanges are validated before those lifecycle mutations have
  // been applied to world state. Preserve that capability with exact matching only:
  // an event may create "Republic of X" and open talks with it immediately, but an
  // unrelated fuzzy name must not get invented into existence by chat resolution.
  const additional = normalizeArray(additionalCountries)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const code = normalizeString(entry.code);
      const name = normalizeString(entry.name || entry.code);
      const aliases = normalizeArray(entry.aliases || entry.additionalNames).map(normalizeString).filter(Boolean);
      if (!code && !name) return null;
      return {
        code: code || name,
        name: name || code,
        aliases,
      };
    })
    .filter(Boolean);

  const resolveAdditional = (reference) => {
    const tokens = (typeof reference === "string"
      ? [reference]
      : [reference?.polityKey, reference?.name, reference?.code])
      .map((value) => normalizeString(value).toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) return null;

    const matches = additional.filter((country) => {
      const names = [country.code, country.name, ...country.aliases]
        .map((value) => normalizeString(value).toLowerCase())
        .filter(Boolean);
      return tokens.some((token) => names.includes(token));
    });
    if (matches.length !== 1) return null;
    return {
      code: matches[0].code,
      name: matches[0].name,
      polityKey: matches[0].code,
    };
  };

  const resolved = [];
  const seen = new Set();
  for (const reference of normalizeArray(names)) {
    const participantInput = typeof reference === "string" ? { name: reference } : reference;
    const identity = resolveChatParticipantIdentity(participantInput, world);
    let participant = null;
    let polityKey = "";

    if (identity.safe) {
      polityKey = identity.polityKey;
      const catalogParticipant = catalogByPolityKey.get(polityKey);
      participant = {
        ...identity.participant,
        // A scenario catalog's compact code is presentation metadata, not identity.
        // Keep it when available so Phase 5A does not randomly turn flags white.
        ...(catalogParticipant?.code ? { code: catalogParticipant.code } : {}),
        polityKey,
      };
    } else {
      participant = resolveAdditional(reference);
      polityKey = participant?.polityKey || "";
    }

    if (!participant || !polityKey) continue;
    const key = normalizeString(polityKey).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(participant);
  }

  return resolved;
};
const inferInviteeNames = async (text, world, playerCountry = "") => {
  const countryCatalog = mergePolityCatalog(await loadCountryNames(), world);
  const normalizedText = normalizeString(text).toLowerCase();

  return countryCatalog
    .filter((country) => country.name && country.name.toLowerCase() !== normalizeString(playerCountry).toLowerCase())
    .filter((country) => normalizedText.includes(country.name.toLowerCase()))
    .slice(0, 5)
    .map((country) => country.name);
};

const fallbackActionSuggestions = async (bundle) => {
  const recentTitles = normalizeEvents(bundle.events).slice(-3).map((event) => event.title);
  const topics = DEFAULT_SUGGESTION_TOPICS.map((topic, index) => {
    const recentTitle = recentTitles[index];
    const actions = [
      normalizeActionEntry({
        kind: "action",
        source: "suggested",
        text: `Issue a concrete order addressing ${recentTitle || topic.title.toLowerCase()} and assign a responsible ministry or command.`,
        title: recentTitle ? `Respond to ${recentTitle}` : `Act on ${topic.title}`,
      }),
      normalizeActionEntry({
        kind: "action",
        source: "suggested",
        text: `Prepare a second-order measure that protects ${bundle.game.country || "the polity"} if this line of effort triggers resistance.`,
        title: "Create a contingency layer",
      }),
    ].filter(Boolean);

    return {
      actions,
      description: topic.description,
      id: `fallback-topic-${index}`,
      title: recentTitle || topic.title,
    };
  });

  return { topics };
};

const fallbackDescriptionToAction = async (rawInput, bundle) => {
  const trimmed = normalizeString(rawInput);
  const isChat = CHAT_HINT_PATTERNS.some((pattern) => pattern.test(trimmed));
  const inferredInvitees = isChat
    ? await inferInviteeNames(trimmed, bundle.world, bundle.game.country)
    : [];
  const title = sentenceCase(trimmed.split(/[.!?]/)[0] || trimmed);
  const expandedText = isChat
    ? `${trimmed}. Clarify the objective, the concession you can offer, and the outcome you want before the exchange hardens.`
    : `${trimmed}. Define the instrument, timing, and expected political or military effect so the move can be executed cleanly.`;

  return {
    chatStarter: isChat ? trimmed : "",
    invitees: inferredInvitees,
    kind: isChat ? "chat" : "action",
    text: expandedText.slice(0, 520),
    title: title.length > 72 ? `${title.slice(0, 69)}...` : title,
  };
};

const speakerExclusionKey = (value) => normalizeString(value).toLowerCase();

const pickAddressedSpeaker = (messageText, participants, excludedSpeakers = []) => {
  const text = normalizeString(messageText);
  const normalizedText = text.toLowerCase();
  if (!normalizedText) return null;

  const excluded = new Set(normalizeArray(excludedSpeakers).map(speakerExclusionKey).filter(Boolean));
  const hasQuestion = text.includes("?");

  return (
    participants.find((country) => {
      const name = normalizeString(country?.name);
      const nameKey = name.toLowerCase();
      if (!nameKey || excluded.has(nameKey)) return false;

      // Native backstop for obvious direct address. The AI normally handles nuance,
      // but a direct question such as "Russia, will you accept?" must not become
      // silence merely because a provider returned null or the selector call failed.
      return normalizedText.startsWith(`${nameKey},`) ||
        normalizedText.startsWith(`${nameKey}:`) ||
        normalizedText.includes(`\n${nameKey},`) ||
        normalizedText.includes(`\n${nameKey}:`) ||
        (hasQuestion && normalizedText.includes(nameKey));
    }) ?? null
  );
};

const fallbackNextSpeaker = ({ chat, excludedSpeaker = "", excludedSpeakers = [] }) => {
  const normalizedChat = normalizeChats([chat])[0];
  if (!normalizedChat) {
    return { nextSpeaker: null };
  }

  const excluded = [excludedSpeaker, ...normalizeArray(excludedSpeakers)].filter(Boolean);
  const lastMessage = normalizedChat.messages.at(-1);
  const addressedSpeaker = pickAddressedSpeaker(lastMessage?.text, normalizedChat.countries, excluded);

  // Silence is the safe fallback. We only force a speaker when the player's latest
  // message clearly addresses somebody; otherwise an AI failure must not recreate
  // the old "someone always gets the final word" round-robin behaviour.
  return { nextSpeaker: addressedSpeaker?.name || null };
};

export const buildGeneratedChat = async (chatLike, linkEventId, world, { fallbackTitle = "", playerName = "" } = {}) => {
  const countriesInput = Array.isArray(chatLike?.countries) ? chatLike.countries : [];
  const resolvedCountries = await resolveInvitees(countriesInput, world);

  // The player is IMPLICIT in every diplomatic chat. Model output sometimes
  // included the player in `countries`, which created self-participants such as
  // [United Kingdom, German Empire] while Germany itself was the player. Resolve
  // through lineage and strip the player before the chat ever reaches storage.
  const playerIdentity = resolveChatParticipantIdentity({ name: playerName }, world);
  const playerPolityKey = playerIdentity.safe ? normalizeString(playerIdentity.polityKey).toLowerCase() : "";
  const playerKey = normalizeString(playerName).toUpperCase();
  const matchesPlayer = (country) => {
    const identity = resolveChatParticipantIdentity(country, world);
    if (
      playerPolityKey &&
      identity.safe &&
      normalizeString(identity.polityKey).toLowerCase() === playerPolityKey
    ) return true;
    return playerKey && (
      normalizeString(country?.name).toUpperCase() === playerKey ||
      normalizeString(country?.code).toUpperCase() === playerKey
    );
  };
  const countries = resolvedCountries.filter((country) => !matchesPlayer(country));
  if (countries.length === 0) return null;

  // The initiating polity speaks first — and it is never the player. When the
  // model names no speaker (or names the player), attribute the opener to the
  // first non-player participant.
  const speakerIdentity = resolveChatParticipantIdentity({ name: chatLike?.speaker }, world);
  const speakerPolityKey = speakerIdentity.safe ? normalizeString(speakerIdentity.polityKey).toLowerCase() : "";
  const speakerKey = normalizeString(chatLike?.speaker).toUpperCase();
  const initiator =
    countries.find((country) =>
      !matchesPlayer(country) && (
        (speakerPolityKey && normalizeString(country?.polityKey).toLowerCase() === speakerPolityKey) ||
        (speakerKey && (
          normalizeString(country?.name).toUpperCase() === speakerKey ||
          normalizeString(country?.code).toUpperCase() === speakerKey
        ))
      ))
    ?? countries.find((country) => !matchesPlayer(country))
    ?? countries[0];

  const entry = normalizeChatEntry({
    countries,
    id: chatLike?.id,
    linkedEventId: linkEventId,
    messages:
      Array.isArray(chatLike?.messages) && chatLike.messages.length > 0
        ? chatLike.messages
        : chatLike?.openingMessage
        ? [
            {
              code: initiator?.code || "",
              polityKey: initiator?.polityKey || "",
              role: "leader",
              speaker: initiator?.name || normalizeString(chatLike?.speaker),
              text: chatLike.openingMessage,
              time: "",
            },
          ]
        : [],
    source: normalizeString(chatLike?.source) || "invitation",
    status: "open",
    // A chat must say why it exists: the model's title, else the causing
    // event's title, else at least the participants.
    title: chatLike?.title || fallbackTitle || `Chat with ${countries.map((country) => country.name).join(", ")}`,
  });
  // The initiating polity always speaks first. If no first message survives
  // normalization (the model gave no openingMessage, or only blank text), this
  // would be a titled-but-empty "mystery chat" the player can't make sense of
  // ("no clue why talks started"). Drop it instead of opening an empty thread —
  // such chats otherwise slipped through on the salvage/final AI attempt (where
  // validateChatOpener is no longer enforced) and as opener-less idle-diplomacy
  // notes. Every caller already treats a null return as "no chat".
  if (!entry || entry.messages.length === 0) return null;
  return entry;
};

// Region ownership is keyed by the map's own region id (GID_1, e.g. "DEU.2_1"),
// but the prompts ask the model for a region's original NAME in regionId, and the
// model is never shown an id to copy. An unresolved name is not inert: it becomes
// regionOwnershipOverrides["Bayern"], which matches no geometry feature and so
// paints nothing while still counting as a map change in the timeline. Turn names
// into real ids here; whatever cannot be resolved is REPORTED back to the caller
// so the model can be retried with the real region names in hand (see
// validateGeneratedWorldChanges), and only after that is it dropped so a phantom
// key never reaches the world state.
const regionKey = (value) => normalizeString(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ");

const GEOGRAPHY_RESOLVER_BATCH_SIZE = 6;
const GEOGRAPHY_RESOLVER_MAX_CANDIDATES = 140;
const GEOGRAPHY_RESOLVER_MAX_AREA_REGIONS = 12;

const resolveRegionTransfers = async (containers, world, {
  ownershipMode = "sovereignty",
  enforceNarratedCityCoverage = false,
} = {}) => {
  // Phase 8B.2.10: resolve against the geography that is ACTUALLY rendered for
  // this scenario. loadRegionCatalog() is intentionally broad and may contain
  // stock GADM rows alongside custom/historical scenario rows; letting those two
  // corpora compete is what made friendly names such as "Masovia" capable of
  // pointing at a real-but-wrong province.
  //
  // The current regionsGeojson is the map truth. Use it as the primary corpus
  // whenever it exists, retaining stock catalog data only as a compatibility
  // fallback for maps that do not expose rendered region features.
  const [mergedCatalog, renderedRegionsGeojson] = await Promise.all([
    loadRegionCatalog().catch(() => []),
    readJson(JSON_URLS.regionsGeojson, { defaultValue: null, force: true }).catch(() => null),
  ]);

  const renderedFeatures = normalizeArray(renderedRegionsGeojson?.features);
  const renderedCatalog = renderedFeatures
    .map((feature) => {
      const props = feature?.properties ?? {};
      const id = normalizeString(
        props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id,
      );
      const name = normalizeString(
        props.name ?? props.NAME_1 ?? props.Name ?? props.regionName,
      );
      if (!id || !name) return null;

      const countryCode = normalizeString(
        props.gid0 ?? props.GID_0 ?? props.gid_0 ?? props.countryCode,
      );
      const country = normalizeString(
        props.owner ??
        props.COUNTRY ??
        props.Country ??
        props.country ??
        toCountryName(countryCode) ??
        "",
      );

      return {
        id,
        name,
        country,
        countryCode,
        geometry: feature?.geometry ?? null,
        aliases: [
          props.sourceBaseRegionName,
          props.sourceBaseRegionId,
          props.NAME_1,
          props.VARNAME_1,
        ].map(normalizeString).filter(Boolean),
      };
    })
    .filter(Boolean);

  const catalog = renderedCatalog.length > 0 ? renderedCatalog : mergedCatalog;

  // Without a catalog we cannot tell a good id from a bad one, and dropping real
  // transfers would be worse than phantom keys — leave the payload alone.
  if (catalog.length === 0) return [];

  const byId = new Map();
  const byName = new Map();
  const byAliasId = new Map();

  const addNameAlias = (token, region) => {
    const key = regionKey(token);
    if (!key) return;
    const bucket = byName.get(key);
    if (bucket) {
      if (!bucket.some((entry) => entry.id === region.id)) bucket.push(region);
    } else {
      byName.set(key, [region]);
    }
  };

  const addIdAlias = (token, region) => {
    const key = normalizeString(token);
    if (!key || key === region.id) return;
    const bucket = byAliasId.get(key);
    if (bucket) {
      if (!bucket.some((entry) => entry.id === region.id)) bucket.push(region);
    } else {
      byAliasId.set(key, [region]);
    }
  };

  for (const region of catalog) {
    byId.set(region.id, region);
    addNameAlias(region.name, region);
    for (const alias of normalizeArray(region.aliases)) {
      addNameAlias(alias, region);
      addIdAlias(alias, region);
    }
  }

  const worldState = normalizeWorldState(world);
  const controlOwners = worldState.regionOwnershipOverrides;
  const sovereigntyOwners = worldState.regionSovereigntyOverrides || {};

  // save-aware owner matching. the old resolver only understood explicit aliases,
  // which meant "Bulgaria" could have ZERO candidate regions while the actual map
  // was owned by "Kingdom of Bulgaria". that is precisely the phantom-country mess
  // polityIdentity.js exists to stop.
  const ownerAlias = new Map();
  for (const [token, entry] of Object.entries(worldState.polityOverrides ?? {})) {
    const canonical = regionKey(token);
    if (!canonical) continue;
    ownerAlias.set(canonical, canonical);
    const displayName = regionKey(entry?.name);
    if (displayName) ownerAlias.set(displayName, canonical);
    for (const alias of entry?.aliases ?? []) {
      const aliasKey = regionKey(alias);
      if (aliasKey) ownerAlias.set(aliasKey, canonical);
    }
  }

  const resolveOwnerName = (token) => {
    const raw = toCountryName(normalizeString(token));
    if (!raw) return "";
    const resolution = resolvePolityIdentity(raw, worldState, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    return resolution.resolved || raw;
  };

  const canonicalOwnerKey = (token) => {
    const key = regionKey(resolveOwnerName(token));
    return ownerAlias.get(key) ?? key;
  };

  const ownerKeyOf = (regionId) => {
    if (ownershipMode === "sovereignty") {
      const sovereign = toCountryName(normalizeString(sovereigntyOwners[regionId]));
      if (sovereign) return canonicalOwnerKey(sovereign);
    }

    const controller = toCountryName(normalizeString(controlOwners[regionId]));
    if (controller) return canonicalOwnerKey(controller);

    // First mutation of a stock region has no runtime override yet. The scenario
    // catalog is therefore the fallback legal owner/controller.
    const region = byId.get(regionId);
    return canonicalOwnerKey(region?.country || toCountryName(region?.countryCode) || "");
  };

  const regionsOwnedBy = (ownerToken) => {
    const key = canonicalOwnerKey(ownerToken);
    if (!key) return [];
    return catalog.filter((region) => ownerKeyOf(region.id) === key);
  };

  // Phase 8B.2.9: city-grounded territory operations must follow the ACTUAL
  // rendered scenario geometry, not a historically plausible region label. A
  // 1915 event may say "Warsaw and Masovia", while this scenario's Warsaw marker
  // is physically inside the map region "Mazowieckie" and a different region is
  // literally named "Masovia". Exact-name matching alone therefore can be wrong.
  //
  // Custom/era scenarios already carry both authoritative city points and region
  // polygons. Use those assets deterministically before accepting a friendly
  // region-name match. This keeps the geography decision in map truth rather than
  // asking the model to guess which similar historical label the scenario author
  // meant. Pure stock maps keep the existing resolver path.
  const pointInRing = ([x, y], ring) => {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      const xi = Number(a?.[0]);
      const yi = Number(a?.[1]);
      const xj = Number(b?.[0]);
      const yj = Number(b?.[1]);
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      const crosses = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  };

  const pointInPolygonCoordinates = (point, polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    if (!pointInRing(point, polygon[0])) return false;
    // Holes negate the outer-ring hit.
    for (let index = 1; index < polygon.length; index += 1) {
      if (pointInRing(point, polygon[index])) return false;
    }
    return true;
  };

  const pointInGeometry = (point, geometry) => {
    if (!Array.isArray(point) || point.length < 2 || !geometry) return false;
    if (geometry.type === "Polygon") {
      return pointInPolygonCoordinates(point, geometry.coordinates);
    }
    if (geometry.type === "MultiPolygon") {
      return normalizeArray(geometry.coordinates)
        .some((polygon) => pointInPolygonCoordinates(point, polygon));
    }
    return false;
  };

  let cityAnchorContext = null;
  if (worldState.customCities) {
    try {
      const citiesGeojson = await readJson(
        JSON_URLS.citiesGeojson,
        { defaultValue: null, force: true },
      ).catch(() => null);

      const regionGeometryById = new Map();
      for (const region of catalog) {
        if (region?.id && region?.geometry) regionGeometryById.set(region.id, region.geometry);
      }

      // Compatibility fallback for a map whose primary catalog came from
      // loadRegionCatalog() rather than rendered features.
      if (regionGeometryById.size === 0) {
        for (const feature of renderedFeatures) {
          const props = feature?.properties ?? {};
          const id = normalizeString(
            props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id,
          );
          if (id && feature?.geometry) regionGeometryById.set(id, feature.geometry);
        }
      }

      const cities = normalizeArray(citiesGeojson?.features)
        .map((feature) => {
          const props = feature?.properties ?? {};
          const coordinates = feature?.geometry?.type === "Point"
            ? feature.geometry.coordinates
            : null;
          const name = normalizeString(props.city || props.name);
          const aliases = new Set([name]);
          const renamed = normalizeString(worldState.cityRenames?.[name.toLowerCase()]);
          if (renamed) aliases.add(renamed);
          return {
            aliases: [...aliases].filter(Boolean),
            coordinates,
            name,
          };
        })
        .filter((city) => city.name && Array.isArray(city.coordinates) && city.coordinates.length >= 2);

      if (cities.length && regionGeometryById.size) {
        cityAnchorContext = { cities, regionGeometryById };
      }
    } catch (error) {
      console.warn("[geo resolver] custom city/region anchor data unavailable; using normal geography resolver.", error);
    }
  }

  const mentionedCitiesIn = (text) => {
    if (!cityAnchorContext) return [];
    const haystack = ` ${regionKey(text)} `;
    if (!haystack.trim()) return [];
    const matches = [];
    for (const city of cityAnchorContext.cities) {
      const matched = city.aliases.some((alias) => {
        const key = regionKey(alias);
        return key.length >= 3 && haystack.includes(` ${key} `);
      });
      if (matched) matches.push(city);
    }
    return matches;
  };

  const containingRegionIdsForCity = (city, candidates) => {
    if (!cityAnchorContext || !city || !Array.isArray(candidates) || candidates.length === 0) return [];
    const hits = [];
    for (const region of candidates) {
      const geometry = cityAnchorContext.regionGeometryById.get(region.id);
      if (geometry && pointInGeometry(city.coordinates, geometry)) hits.push(region.id);
    }
    return [...new Set(hits)];
  };

  const cityAnchoredRegionId = (transfer, candidates) => {
    if (!cityAnchorContext || !Array.isArray(candidates) || candidates.length === 0) return "";

    // Phase 8B.2.11: city anchoring is intentionally LOCAL to this operation.
    // Never fall through to the whole event description here: one event commonly
    // names several simultaneous captures, and using event-wide prose allowed the
    // Warsaw marker to hijack a perfectly exact "Piotrków" operation.
    const contexts = [
      normalizeString(transfer?.note),
      `${normalizeString(transfer?.regionId)} ${normalizeString(transfer?.regionName)}`,
    ];

    let anchors = [];
    for (const context of contexts) {
      anchors = mentionedCitiesIn(context);
      if (anchors.length) break;
    }
    if (anchors.length === 0) return "";

    const containing = new Set();
    for (const city of anchors) {
      const hits = containingRegionIdsForCity(city, candidates);
      // A city point must identify exactly one losing-side region. Boundary points,
      // overlapping bad geometry, or missing geometry fail safe instead of guessing.
      if (hits.length !== 1) continue;
      containing.add(hits[0]);
    }

    return containing.size === 1 ? [...containing][0] : "";
  };

  // If the event prose explicitly says control is being established/expanded/
  // consolidated in a named city, that city's rendered region must be present in
  // the structured control ops. This catches the exact partial-coverage failure
  // where prose says "Płock, Częstochowa and Warsaw" but the transaction only
  // carries operations for the first two.
  const NARRATED_CONTROL_TARGET_CUE = /\b(?:captur\w*|seiz\w*|conquer\w*|occup(?:y|ies|ied|ation)|overr[au]n\w*|liberat\w*|retak\w*|recaptur\w*|takes?\s+(?:de[- ]?facto\s+)?control|assumes?\s+(?:de[- ]?facto\s+)?control|establish(?:es|ed|ing)?(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control|expand(?:s|ed|ing)?(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control|extend(?:s|ed|ing)?(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control|consolidat(?:e|es|ed|ing)(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control)\b/i;

  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const cityClaimedAsControlTarget = (text, city) => {
    const haystack = regionKey(text);
    if (!haystack) return false;

    for (const alias of city.aliases) {
      const key = regionKey(alias);
      if (key.length < 3) continue;
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(key)}(?=$|[^a-z0-9])`, "g");
      for (const match of haystack.matchAll(pattern)) {
        const cityIndex = Number(match.index || 0) + normalizeString(match[1]).length;
        const before = haystack.slice(Math.max(0, cityIndex - 220), cityIndex);
        const clause = before.split(/[.!?;\n]/).pop() || before;
        if (NARRATED_CONTROL_TARGET_CUE.test(clause)) return true;
      }
    }

    return false;
  };

  const expandWholeCountry = (transfer) => {
    const target = resolveOwnerName(
      normalizeString(transfer?.regionId) ||
      normalizeString(transfer?.regionName),
    );
    const key = canonicalOwnerKey(target);
    if (!key) return [];

    const toKey = canonicalOwnerKey(transfer?.toCode);
    const owned = catalog.filter((region) => {
      const owner = ownerKeyOf(region.id);
      return owner === key && owner !== toKey;
    });

    return owned.map((region) => ({
      ...transfer,
      fromCode: resolveOwnerName(transfer?.fromCode) || target,
      regionId: region.id,
      regionName: region.name,
      wholeCountry: undefined,
    }));
  };

  const deterministicResolve = (transfer, event) => {
    const requestedId = normalizeString(transfer?.regionId);
    if (byId.has(requestedId)) {
      return requestedId;
    }

    const fromKey = canonicalOwnerKey(transfer?.fromCode);

    const aliasedIds = byAliasId.get(requestedId) ?? [];
    if (aliasedIds.length === 1) return aliasedIds[0].id;
    if (aliasedIds.length > 1 && fromKey) {
      const owned = aliasedIds.filter((region) => ownerKeyOf(region.id) === fromKey);
      if (owned.length === 1) return owned[0].id;
    }
    const ownedCandidates = fromKey ? regionsOwnedBy(transfer?.fromCode) : [];

    // A city explicitly named INSIDE THIS OPERATION may disambiguate a historical
    // or friendly label (e.g. regionId "Masovia" + note "Warsaw"). Crucially this
    // no longer reads the event-wide prose, so another city in the same event
    // cannot hijack an exact rendered region such as Piotrków.
    const anchored = cityAnchoredRegionId(transfer, ownedCandidates);
    if (anchored) return anchored;

    for (const candidate of [transfer?.regionId, transfer?.regionName]) {
      const query = regionKey(candidate);
      if (!query) continue;

      const matches = byName.get(query) ?? [];
      if (matches.length === 1) return matches[0].id;

      if (matches.length > 1 && fromKey) {
        const owned = matches.filter((region) => ownerKeyOf(region.id) === fromKey);
        if (owned.length === 1) return owned[0].id;
      }

      // This is intentionally the LAST deterministic fuzzy-ish rule. Substring
      // matching inside the losing side is safe only when exactly one map region
      // survives. Anything harder belongs to the bounded semantic geography pass.
      if (fromKey && query.length >= 4) {
        const contains = regionsOwnedBy(transfer.fromCode).filter((region) => {
          const name = regionKey(region.name);
          return name.includes(query) || query.includes(name);
        });
        if (contains.length === 1) return contains[0].id;
      }
    }

    return "";
  };

  const pushUniqueTransfer = (target, transfer) => {
    const id = normalizeString(transfer?.regionId);
    const toCode = regionKey(transfer?.toCode);
    if (!id || !toCode) return;

    const duplicate = target.some(
      (entry) =>
        normalizeString(entry?.regionId) === id &&
        regionKey(entry?.toCode) === toCode,
    );

    if (!duplicate) target.push(transfer);
  };

  const unresolved = [];
  const semanticPending = [];
  const deterministicDestinations = new Map();

  for (const [containerIndex, container] of containers.entries()) {
    const { impacts, path, event } = container;
    const transfers = normalizeArray(impacts?.regionTransfers);
    if (transfers.length === 0) continue;

    const resolved = [];
    const destinationByRegion = new Map();
    deterministicDestinations.set(path, destinationByRegion);

    for (const [transferIndex, transfer] of transfers.entries()) {
      if (transfer?.wholeCountry === true) {
        const expanded = expandWholeCountry(transfer);
        if (expanded.length) {
          console.info(
            `[ai] ${path}.regionTransfers expanded whole country ` +
              `"${normalizeString(transfer?.regionId)}" -> ${normalizeString(transfer?.toCode)}: ` +
              `${expanded.length} region(s).`,
          );
          for (const item of expanded) {
            pushUniqueTransfer(resolved, item);
            destinationByRegion.set(item.regionId, regionKey(item.toCode));
          }
          continue;
        }
      }

      const regionId = deterministicResolve(transfer, event);
      if (regionId) {
        const row = byId.get(regionId);
        const normalized = {
          ...transfer,
          regionId,
          // Preview/apply must expose the ACTUAL canonical map region we resolved,
          // not keep an AI-authored historical/friendly label that can hide a bad
          // mapping (e.g. prose says one place while regionId points elsewhere).
          regionName: row?.name || normalizeString(transfer?.regionName) || regionId,
        };
        pushUniqueTransfer(resolved, normalized);
        destinationByRegion.set(regionId, regionKey(transfer?.toCode));
        continue;
      }

      // If a polity name was used as shorthand for a total takeover, preserve the
      // old compatibility behavior. Explicit wholeCountry remains strongly preferred.
      const expanded = expandWholeCountry(transfer);
      if (expanded.length) {
        console.info(
          `[ai] ${path}.regionTransfers treated "${normalizeString(transfer?.regionId)}" as a whole ` +
            `country -> ${normalizeString(transfer?.toCode)}: ${expanded.length} region(s).`,
        );
        for (const item of expanded) {
          pushUniqueTransfer(resolved, item);
          destinationByRegion.set(item.regionId, regionKey(item.toCode));
        }
        continue;
      }

      const candidates = regionsOwnedBy(transfer?.fromCode);
      const label =
        normalizeString(transfer?.regionName) ||
        normalizeString(transfer?.regionId);

      const record = {
        candidates,
        containerIndex,
        event,
        impacts,
        label,
        path,
        resolved,
        semanticIndex: semanticPending.length,
        transfer,
        transferIndex,
      };

      // No losing-side region set means there is nothing bounded for the semantic
      // resolver to choose from. Do not hand it the whole planet and ask for vibes.
      if (!label || candidates.length === 0) {
        unresolved.push({
          label,
          fromCode: normalizeString(transfer?.fromCode),
          path,
          candidates,
        });
        continue;
      }

      semanticPending.push(record);
    }

    impacts.regionTransfers = resolved;
  }

  const semanticPlans = [];

  for (let offset = 0; offset < semanticPending.length; offset += GEOGRAPHY_RESOLVER_BATCH_SIZE) {
    const batch = semanticPending.slice(offset, offset + GEOGRAPHY_RESOLVER_BATCH_SIZE);

    const items = batch.map((record) => ({
      index: record.semanticIndex,
      sourcePlace: record.label,
      fromCode: resolveOwnerName(record.transfer?.fromCode) || normalizeString(record.transfer?.fromCode),
      toCode: resolveOwnerName(record.transfer?.toCode) || normalizeString(record.transfer?.toCode),
      event: {
        date: normalizeString(record.event?.date),
        title: normalizeString(record.event?.title),
        description:
          normalizeString(record.event?.description) ||
          normalizeString(record.event?.summary),
      },
      candidateRegions: record.candidates
        .slice(0, GEOGRAPHY_RESOLVER_MAX_CANDIDATES)
        .map((region) => ({
          id: region.id,
          name: region.name,
          baseCountry: region.country || "",
        })),
      omittedCandidateCount: Math.max(
        0,
        record.candidates.length - GEOGRAPHY_RESOLVER_MAX_CANDIDATES,
      ),
    }));

    const fallback = () => ({
      resolutions: items.map((item) => ({
        index: item.index,
        status: "UNRESOLVED",
        relation: "UNRESOLVED",
        regionIds: [],
        confidence: 0,
        reason: "Geography resolver unavailable; safe failure.",
      })),
    });

    let payload = fallback();
    let source = "fallback";

    try {
      const response = await runJsonTask("geographyResolver", {
        fallback,
        userMessage:
          "Resolve every supplied unresolved geography item using only its supplied candidateRegions. " +
          "Resolve by REAL geographic meaning, not spelling similarity. Use the event title/description as disambiguating evidence: " +
          "if the event anchors the change on a named city, choose only the candidate region that actually contains that city; the city anchor outranks a merely similar or historically related sourcePlace label. " +
          "historical areas must map to their genuine modern/scenario equivalents, not a similarly named neighboring region. " +
          "If you are not highly certain, return UNRESOLVED rather than guessing. Return exactly one resolution per item index.",
        variables: {
          geographyResolverItems: JSON.stringify(items, null, 2),
        },
      });
      payload = response.payload || payload;
      source = response.generation?.source || "ai";
    } catch (error) {
      console.warn(
        "[geo resolver] semantic geography pass failed; unresolved transfers will fail safe.",
        error,
      );
    }

    const byIndex = new Map(
      normalizeArray(payload?.resolutions).map((resolution) => [
        Number(resolution?.index),
        resolution,
      ]),
    );

    for (const record of batch) {
      const resolution = byIndex.get(record.semanticIndex);
      const relation = normalizeString(resolution?.relation).toUpperCase();
      const status = normalizeString(resolution?.status).toUpperCase();
      const confidence = Number(resolution?.confidence);
      const allowed = new Set(record.candidates.map((region) => region.id));
      const regionIds = [
        ...new Set(
          normalizeArray(resolution?.regionIds)
            .map((id) => normalizeString(id))
            .filter(Boolean),
        ),
      ];

      const singleRegionRelation =
        relation === "REGION_ALIAS" ||
        relation === "CITY_CONTAINING_REGION";
      const areaRelation =
        relation === "HISTORICAL_AREA" ||
        relation === "TRANSLATED_AREA";
      // historical/translated areas often span several real map regions. 0.95 is
      // already a very strong answer once every returned id is deterministically
      // proven to belong to the losing side's bounded candidate set; demanding
      // 0.96 was just enough to throw away correct mappings like Southern Dobruja.
      const threshold = areaRelation ? 0.95 : 0.93;

      const valid =
        status === "RESOLVED" &&
        Number.isFinite(confidence) &&
        confidence >= threshold &&
        regionIds.length > 0 &&
        regionIds.every((id) => allowed.has(id)) &&
        (!singleRegionRelation || regionIds.length === 1) &&
        (!areaRelation || regionIds.length <= GEOGRAPHY_RESOLVER_MAX_AREA_REGIONS) &&
        (singleRegionRelation || areaRelation);

      if (!valid) {
        unresolved.push({
          label: record.label,
          fromCode: normalizeString(record.transfer?.fromCode),
          path: record.path,
          candidates: record.candidates,
        });

        console.warn(
          `[geo resolver] ${record.path}.regionTransfers[${record.transferIndex}] ` +
            `"${record.label}" remains unresolved; no safe candidate mapping was accepted.`,
          {
            source,
            status,
            relation,
            confidence,
            regionIds,
          },
        );
        continue;
      }

      semanticPlans.push({
        ...record,
        confidence,
        relation,
        regionIds,
        source,
      });
    }
  }

  // A single event cannot semantically resolve the same region to two different
  // recipients. This catches vague split-settlement wording such as two transfers
  // both saying merely "Macedonia" and prevents the resolver from awarding the
  // same province twice based on historical vibes.
  const conflictingPlans = new Set();
  const semanticDestinations = new Map();

  for (const plan of semanticPlans) {
    const deterministic = deterministicDestinations.get(plan.path) || new Map();

    for (const regionId of plan.regionIds) {
      const destination = regionKey(plan.transfer?.toCode);
      const deterministicDestination = deterministic.get(regionId);

      if (
        deterministicDestination &&
        deterministicDestination !== destination
      ) {
        conflictingPlans.add(plan);
        continue;
      }

      const key = `${plan.path}|${regionId}`;
      const existing = semanticDestinations.get(key);
      if (existing && existing.destination !== destination) {
        conflictingPlans.add(plan);
        conflictingPlans.add(existing.plan);
      } else if (!existing) {
        semanticDestinations.set(key, {
          destination,
          plan,
        });
      }
    }
  }

  for (const plan of semanticPlans) {
    if (conflictingPlans.has(plan)) {
      unresolved.push({
        label: plan.label,
        fromCode: normalizeString(plan.transfer?.fromCode),
        path: plan.path,
        candidates: plan.candidates,
      });
      console.warn(
        `[geo resolver] rejected ambiguous cross-recipient mapping for "${plan.label}" in ${plan.path}; ` +
          "the same map region was claimed by incompatible transfers in one event.",
      );
      continue;
    }

    for (const regionId of plan.regionIds) {
      const row = byId.get(regionId);
      if (!row) continue;
      pushUniqueTransfer(plan.resolved, {
        ...plan.transfer,
        regionId,
        regionName: row.name,
        wholeCountry: undefined,
      });
    }

    console.info(
      `[geo resolver] "${plan.label}" -> ` +
        `${plan.regionIds.map((id) => `${byId.get(id)?.name || id} (${id})`).join(", ")} ` +
        `(${plan.relation.toLowerCase()}, ${plan.confidence.toFixed(2)}, ${plan.source}).`,
    );
  }

  if (enforceNarratedCityCoverage && cityAnchorContext) {
    for (const { impacts, path, event } of containers) {
      const controlOps = normalizeArray(impacts?.regionTransfers)
        .filter((entry) => normalizeString(entry?.op).toLowerCase() === "control");
      if (controlOps.length === 0) continue;

      const eventText = [
        normalizeString(event?.title),
        normalizeString(event?.description) || normalizeString(event?.summary),
      ].filter(Boolean).join(". ");
      if (!eventText) continue;

      const resolvedRegionIds = new Set(
        controlOps.map((entry) => normalizeString(entry?.regionId)).filter(Boolean),
      );

      for (const city of cityAnchorContext.cities) {
        if (!cityClaimedAsControlTarget(eventText, city)) continue;

        const hits = containingRegionIdsForCity(city, catalog);
        if (hits.length !== 1) continue;
        const regionId = hits[0];
        if (resolvedRegionIds.has(regionId)) continue;

        const row = byId.get(regionId);
        unresolved.push({
          kind: "narrated-city-coverage",
          label: city.name,
          cityName: city.name,
          regionId,
          regionName: row?.name || regionId,
          fromCode: "",
          path,
          candidates: row ? [row] : [],
        });

        console.warn(
          `[geo resolver] ${path}.regionControlOps narration claims control changes in ` +
            `${city.name}, but no control op targets its rendered region ` +
            `${row?.name || regionId} (${regionId}).`,
        );
      }
    }
  }

  return unresolved;
};

// regionControlOps use the SAME geography vocabulary and bounded resolver as
// legal transfers, but they are bounded by current DE-FACTO control instead of
// sovereignty. Proxy them through the proven resolver rather than maintain two
// subtly different historical-geography engines. because apparently one was not
// already enough fun.
const resolveRegionControlOps = async (containers, world) => {
  const proxyContainers = containers.map((container) => {
    const proxies = normalizeArray(container?.impacts?.regionControlOps).map((op, index) => {
      const realToCode = normalizeString(op?.toCode);
      const proxyToCode =
        realToCode ||
        normalizeString(op?.actorCode) ||
        normalizeString(op?.claimantCode) ||
        normalizeString(op?.fromCode) ||
        "Unresolved polity";

      return {
        ...cloneValue(op),
        toCode: proxyToCode,
        __controlOpIndex: index,
        __hadRealToCode: Boolean(realToCode),
      };
    });

    return {
      ...container,
      impacts: { regionTransfers: proxies },
    };
  });

  const unresolved = await resolveRegionTransfers(proxyContainers, world, {
    ownershipMode: "control",
    enforceNarratedCityCoverage: true,
  });

  for (let index = 0; index < containers.length; index += 1) {
    const targetImpacts = containers[index]?.impacts;
    if (!targetImpacts || typeof targetImpacts !== "object") continue;

    targetImpacts.regionControlOps = normalizeArray(proxyContainers[index]?.impacts?.regionTransfers)
      .map((entry) => {
        const next = { ...entry };
        delete next.__controlOpIndex;
        const hadRealToCode = next.__hadRealToCode === true;
        delete next.__hadRealToCode;
        if (!hadRealToCode && next.op !== "control") delete next.toCode;
        return next;
      });
  }

  return unresolved;
};

// One retry's worth of corrective vocabulary: the exact regions the losing side
// currently owns, so a model that wrote "Pomerania" can resend the same answer
// with the real names/ids ("Pomorskie (POL.11_1)") instead of losing the map
// change entirely. The lists stay small — one owner's regions, not the world's.
const buildTransferFeedback = (unresolved) => {
  const lines = [];
  for (const entry of unresolved.slice(0, 3)) {
    const target = entry.label || "(blank)";
    if (entry.candidates.length > 0) {
      const listed = entry.candidates.slice(0, 40)
        .map((region) => `${region.name} (${region.id})`)
        .join(", ");
      const more = entry.candidates.length > 40 ? `, +${entry.candidates.length - 40} more` : "";
      lines.push(
        `${entry.path}.regionTransfers: no map region matches "${target}". ` +
          `Regions currently owned by ${entry.fromCode}: ${listed}${more}.`,
      );
    } else {
      lines.push(
        `${entry.path}.regionTransfers: no map region matches "${target}"` +
          `${entry.fromCode ? ` and no regions are recorded for owner "${entry.fromCode}"` : ""}. ` +
          `Use the region's exact in-game name in regionId, and set fromCode to the region's current owner so the engine can locate it.`,
      );
    }
  }
  lines.push(
    "Resend the same response with these regionTransfers corrected to exact regionId values (or exact names) from the lists above; drop a transfer only if no listed region matches your intent.",
  );
  return lines.join("\n");
};

const buildControlFeedback = (unresolved) => {
  const coverage = normalizeArray(unresolved)
    .filter((entry) => entry?.kind === "narrated-city-coverage");
  const ordinary = normalizeArray(unresolved)
    .filter((entry) => entry?.kind !== "narrated-city-coverage");

  const chunks = [];
  if (ordinary.length > 0) {
    chunks.push(
      buildTransferFeedback(ordinary)
        .replaceAll(".regionTransfers", ".regionControlOps")
        .replaceAll("these regionTransfers", "these regionControlOps")
        .replaceAll("applied transfer", "applied control operation")
        .replaceAll("currently owned by", "currently controlled by")
        .replaceAll("current owner", "current controller")
        .replaceAll("drop a transfer", "drop a control operation"),
    );
  }

  for (const entry of coverage) {
    chunks.push(
      `${entry.path}.regionControlOps: event narration explicitly says de-facto control changes in ` +
        `${entry.cityName || entry.label}, which the rendered map places in ` +
        `${entry.regionName} (${entry.regionId}), but no control operation targets that region. ` +
        `Add the matching control operation using regionId "${entry.regionId}" and regionName ` +
        `"${entry.regionName}" with the correct current controller/fromCode and new controller/toCode, ` +
        `or revise the event prose so it does not claim control changed there.`,
    );
  }

  if (coverage.length > 0) {
    chunks.push(
      "Resend the same transaction with every narrated city/territory control change represented by a matching regionControlOps entry. Do not silently drop a named control change merely because another nearby region was resolved successfully.",
    );
  }

  return chunks.join("\n");
};

// Also canonicalizes region ids in place (see resolveRegionTransfers): runJsonTask
// hands the accepted payload straight to the caller, and a payload is only accepted
// once this returns clean, so every applied transfer has passed through here.
//
// strictTransfers: when set, an unresolvable transfer FAILS validation with the
// losing owner's real region list, so runJsonTask's retry gives the model the
// vocabulary to fix its own answer. Callers set it on every attempt EXCEPT the
// last (runJsonTask passes finalAttempt to validatePayload) — the final answer
// must never be rejected into the canned fallback over a name.

// An AI-opened chat must arrive with a reason and a first message — the
// initiating polity speaks first. Empty string when the entry is fine.
const validateChatOpener = (chatLike, path) => {
  const hasMessages = Array.isArray(chatLike?.messages) && chatLike.messages.length > 0;
  if (!normalizeString(chatLike?.title)) {
    return `${path}.title must name the purpose of the chat.`;
  }
  if (!hasMessages && !normalizeString(chatLike?.openingMessage)) {
    return `${path}.openingMessage must carry the initiating polity's first message - never open an empty chat.`;
  }
  return "";
};

// Event text that claims territory changed hands. Word-boundary anchored so
// "preoccupied" or "occupational" never match; deliberately narrow (capture
// verbs, not war verbs) so a defensive battle that moved no borders — a
// legitimate zero-transfer turn — never trips the reluctance guard below.
const CONTROL_CHANGE_LANGUAGE = /\b(captur\w*|seiz\w*|conquer\w*|occup(?:y|ies|ied|ation)|overr[au]n|liberat\w*|retak\w*|retaken|recaptur\w*|fell to|falls? to|takes? control|assumes? control)\b/i;
const LEGAL_TRANSFER_LANGUAGE = /\b(annex\w*|cedes?|ceded|ceding|cession|sovereignty (?:passes|transfers?|is transferred)|treaty transfer|formal(?:ly)? transfer(?:red)?|incorporat\w*|unification|territorial award|sold|sale of territory)\b/i;

// Strict/salvage discipline, the same contract clampTimelineDates follows:
// the FIRST attempt returns corrective errors so the model can fix its own
// answer; the SECOND attempt never rejects a finished generation — invalid
// ops are DROPPED in place instead ("$.events[4].impacts.unitOps[0].unitId
// does not identify an existing unit" used to trash whole good turns to the
// canned fallback over one stale id).
export const validateGeneratedWorldChanges = async (candidate, world, { strictTransfers = false } = {}) => {
  const strict = strictTransfers;
  const containers = Array.isArray(candidate?.events)
    ? candidate.events.map((event, index) => ({
        event,
        impacts: event?.impacts,
        path: `$.events[${index}].impacts`,
      }))
    : [{
        event: {
          date: "",
          title: "Game master intervention",
          description: normalizeString(candidate?.summary),
        },
        impacts: candidate?.impacts,
        path: "$.impacts",
      }];
  const unresolvedTransfers = await resolveRegionTransfers(containers, world, { ownershipMode: "sovereignty" });
  if (strict && unresolvedTransfers.length > 0) {
    return buildTransferFeedback(unresolvedTransfers);
  }

  const unresolvedControlOps = await resolveRegionControlOps(containers, world);
  if (strict && unresolvedControlOps.length > 0) {
    return buildControlFeedback(unresolvedControlOps);
  }
  // Reluctance guard (strict attempt only): events that NARRATE a capture while
  // the whole payload ships ZERO regionTransfers are the recurring field report
  // — "two turns of invasions and not a single province transferred". One
  // corrective retry asks the model to reconcile narration with the map (or to
  // strip the capture language if genuinely nothing changed hands). English
  // verb heuristic only — a non-English game just never gets this extra nudge —
  // and the final attempt always passes through salvage, so it can never cost a
  // finished turn. Only for event-shaped payloads: a $.impacts container has no
  // narration to check.
  if (strict && Array.isArray(candidate?.events)) {
    const totalTransfers = containers.reduce(
      (sum, { impacts }) => sum + normalizeArray(impacts?.regionTransfers).length,
      0,
    );
    const totalControlOps = containers.reduce(
      (sum, { impacts }) => sum + normalizeArray(impacts?.regionControlOps).length,
      0,
    );

    if (totalControlOps === 0) {
      const controlEvent = candidate.events.find((event) =>
        CONTROL_CHANGE_LANGUAGE.test(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`) &&
        !LEGAL_TRANSFER_LANGUAGE.test(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`));
      if (controlEvent) {
        return `Your events describe a wartime capture/occupation/control change (e.g. "${normalizeString(controlEvent.title) || "an event"}") but the payload contains ZERO impacts.regionControlOps. Use regionControlOps control for battlefield capture/occupation/liberation/retaking; do NOT fake a legal sovereignty transfer. If control did not actually change, remove the capture language instead.`;
      }
    }

    if (totalTransfers === 0) {
      const legalEvent = candidate.events.find((event) =>
        LEGAL_TRANSFER_LANGUAGE.test(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`));
      if (legalEvent) {
        return `Your events describe a legal territorial settlement (e.g. "${normalizeString(legalEvent.title) || "an event"}") but the payload contains ZERO impacts.regionTransfers. Use regionTransfers only for the legal sovereignty change (cession, annexation, recognized hand-over, sale, unification or final settlement).`;
      }
    }
  }
  const unitIds = new Set(normalizeWorldState(world).units.map((unit) => normalizeString(unit.id)).filter(Boolean));
  const generatedPolities = [];
  for (const { impacts } of containers) generatedPolities.push(...normalizeArray(impacts?.polityChanges));

  for (const { impacts, path } of containers) {
    const keptChats = [];
    for (let index = 0; index < normalizeArray(impacts?.createdChats).length; index += 1) {
      const createdChat = impacts.createdChats[index];
      const countries = await resolveInvitees(createdChat?.countries, world, generatedPolities);
      if (countries.length === 0) {
        if (strict) return `${path}.createdChats[${index}].countries must contain at least one known polity.`;
        continue; // salvage: drop the unresolvable chat, keep the turn
      }
      if (strict) {
        const chatError = validateChatOpener(createdChat, `${path}.createdChats[${index}]`);
        if (chatError) return chatError;
      }
      keptChats.push(createdChat);
    }
    if (impacts && Array.isArray(impacts.createdChats)) impacts.createdChats = keptChats;

    const keptUnitOps = [];
    for (let index = 0; index < normalizeArray(impacts?.unitOps).length; index += 1) {
      const operation = impacts.unitOps[index];
      const operationPath = `${path}.unitOps[${index}]`;
      if (operation.op === "spawn") {
        if (!normalizeString(operation.unit?.name) || !normalizeString(operation.unit?.ownerCode)) {
          if (strict) return `${operationPath}.unit must have nonblank name and ownerCode values.`;
          continue;
        }
        const spawnedId = normalizeString(operation.unit?.id);
        if (spawnedId && unitIds.has(spawnedId)) {
          if (strict) return `${operationPath}.unit.id duplicates an existing unit.`;
          delete operation.unit.id; // salvage: let normalization mint a fresh id
        } else if (spawnedId) {
          unitIds.add(spawnedId);
        }
        keptUnitOps.push(operation);
        continue;
      }

      const unitId = normalizeString(operation.unitId);
      if (!unitId) {
        if (strict) return `${operationPath}.unitId must not be blank.`;
        continue;
      }
      if (!unitIds.has(unitId)) {
        if (strict) return `${operationPath}.unitId does not identify an existing unit.`;
        continue; // salvage: drop the op aimed at a unit that no longer exists
      }
      if (operation.op === "attack") {
        const targetUnitId = normalizeString(operation.targetUnitId);
        if (!targetUnitId || targetUnitId === unitId || !unitIds.has(targetUnitId)) {
          if (strict) return `${operationPath}.targetUnitId must identify a different existing enemy unit.`;
          continue;
        }
      }
      if (operation.op === "remove" || (operation.op === "strength" && operation.strength === 0)) unitIds.delete(unitId);
      keptUnitOps.push(operation);
    }
    if (impacts && Array.isArray(impacts.unitOps)) impacts.unitOps = keptUnitOps;

    // Marker ops that would be silently dropped by normalization instead fail
    // the strict attempt, so the retry tells the model what was missing.
    const keptMarkerOps = [];
    for (let index = 0; index < normalizeArray(impacts?.markerOps).length; index += 1) {
      const operation = impacts.markerOps[index];
      const operationPath = `${path}.markerOps[${index}]`;
      const op = normalizeString(operation?.op).toLowerCase();
      if (op === "build" || op === "found") {
        const marker = operation.marker ?? operation;
        if (!normalizeString(marker?.name)) {
          if (strict) return `${operationPath}.marker.name must not be blank.`;
          continue;
        }
        if (!Number.isFinite(Number(marker?.lng)) || !Number.isFinite(Number(marker?.lat))) {
          if (strict) return `${operationPath}.marker must carry numeric lng and lat coordinates.`;
          continue;
        }
      } else if (op === "update" || op === "modify" || op === "destroy") {
        if (!normalizeString(operation?.name) && !normalizeString(operation?.markerId)) {
          if (strict) return `${operationPath} must carry an existing markerId (preferred) or feature name.`;
          continue;
        }
        // Preview generation validates the raw schema shape (status/note/etc. at
        // the top level), while the accepted transaction is then normalized for
        // persistence as { op:"update", markerId, name, changes:{...} }. Apply
        // revalidates that exact preview, so accept BOTH representations here.
        // This mirrors gameState.normalizeMarkerOp and prevents a valid preview
        // from failing closed merely because its marker patch is already normalized.
        const markerPatch = operation?.changes && typeof operation.changes === "object" && !Array.isArray(operation.changes)
          ? operation.changes
          : operation;
        const hasChange = op === "destroy" || ["kind", "ownerCode", "status", "note", "lng", "lat"]
          .some((field) => Object.prototype.hasOwnProperty.call(markerPatch || {}, field));
        if (!hasChange) {
          if (strict) return `${operationPath} update must change kind, ownerCode, status, note, or coordinates.`;
          continue;
        }
        const hasLng = Object.prototype.hasOwnProperty.call(markerPatch || {}, "lng");
        const hasLat = Object.prototype.hasOwnProperty.call(markerPatch || {}, "lat");
        if (hasLng !== hasLat) {
          if (strict) return `${operationPath} must provide lng and lat together when relocating a feature.`;
          continue;
        }
      } else if (op === "remove") {
        if (!normalizeString(operation?.name) && !normalizeString(operation?.markerId)) {
          if (strict) return `${operationPath} must carry the name (or markerId) of the feature to delete.`;
          continue;
        }
      } else if (op === "rename") {
        if ((!normalizeString(operation?.name) && !normalizeString(operation?.markerId)) || !normalizeString(operation?.newName)) {
          if (strict) return `${operationPath} rename must carry an existing markerId/name and a non-blank newName.`;
          continue;
        }
      } else {
        if (strict) return `${operationPath}.op must be build, update, rename, or remove.`;
        continue;
      }
      keptMarkerOps.push(operation);
    }
    if (impacts && Array.isArray(impacts.markerOps)) impacts.markerOps = keptMarkerOps;
  }

  // Unprompted outreach chats (top-level, not tied to an event) need real
  // participants exactly like createdChats do.
  if (Array.isArray(candidate?.diplomaticOutreach)) {
    const keptOutreach = [];
    for (let index = 0; index < candidate.diplomaticOutreach.length; index += 1) {
      const countries = await resolveInvitees(
        candidate.diplomaticOutreach[index]?.countries,
        world,
        generatedPolities,
      );
      if (countries.length === 0) {
        if (strict) return `$.diplomaticOutreach[${index}].countries must contain at least one known polity.`;
        continue;
      }
      if (strict) {
        const chatError = validateChatOpener(candidate.diplomaticOutreach[index], `$.diplomaticOutreach[${index}]`);
        if (chatError) return chatError;
      }
      keptOutreach.push(candidate.diplomaticOutreach[index]);
    }
    candidate.diplomaticOutreach = keptOutreach;
  }

  // Prompt advice is not a quota. Enforce the inbox bound here so a provider that
  // gets enthusiastic cannot dump six invitations into one turn. Event-linked chats
  // win salvage priority because they have an explicit in-world cause; free-floating
  // outreach uses whatever slots remain.
  const generatedChatContainers = containers.filter(({ path }) => path !== "$.impacts");
  const createdChatCount = generatedChatContainers.reduce(
    (sum, { impacts }) => sum + normalizeArray(impacts?.createdChats).length,
    0,
  );
  const outreachCount = normalizeArray(candidate?.diplomaticOutreach).length;
  const totalDiplomaticApproaches = createdChatCount + outreachCount;
  if (totalDiplomaticApproaches > 3) {
    if (strict) {
      return `The combined total of impacts.createdChats and $.diplomaticOutreach must be at most 3; received ${totalDiplomaticApproaches}.`;
    }

    let remaining = 3;
    for (const { impacts } of generatedChatContainers) {
      if (!impacts || !Array.isArray(impacts.createdChats)) continue;
      impacts.createdChats = impacts.createdChats.slice(0, remaining);
      remaining = Math.max(0, remaining - impacts.createdChats.length);
    }
    if (Array.isArray(candidate?.diplomaticOutreach)) {
      candidate.diplomaticOutreach = candidate.diplomaticOutreach.slice(0, remaining);
    }
  }

  return "";
};

const fallbackJumpSimulation = async ({ bundle, days, mode, targetDate }) => {
  const plannedActions = normalizeActions(bundle.actions).filter((action) => action.status === "planned");
  const firstThreeActions = plannedActions.slice(0, 3);
  const events = [];

  // Ancient/FMG scenarios may use textual or BCE dates. Only perform calendar
  // arithmetic on strict Gregorian dates; otherwise preserve the scenario text.
  const advanceGameDate = (dayCount) =>
    addIsoDays(bundle.game.gameDate, dayCount) || normalizeString(bundle.game.gameDate);

  if (firstThreeActions.length > 0) {
    firstThreeActions.forEach((action, index) => {
      const eventDate = advanceGameDate(
        Math.max(1, Math.round(((index + 1) / (firstThreeActions.length + 1)) * Math.max(days, 1))),
      );

      events.push({
        date: eventDate,
        description:
          action.kind === "chat"
            ? `${bundle.game.country} opens a deliberate diplomatic channel tied to ${action.title.toLowerCase()}, forcing counterparts to weigh terms instead of guessing intent.`
            : `${bundle.game.country} begins implementing ${action.title.toLowerCase()}, producing immediate administrative and political consequences that other powers start to notice.`,
        impacts: {
          createdChats:
            action.kind === "chat" && action.invitees.length > 0 && action.chatStarter
              ? [
                  {
                    countries: action.invitees,
                    openingMessage: action.chatStarter,
                    speaker: bundle.game.country,
                    title: action.title,
                  },
                ]
              : [],
          polityChanges: [],
          regionTransfers: [],
          regionControlOps: [],
        },
        importance: index === firstThreeActions.length - 1 ? "major" : "minor",
        kind: action.kind === "chat" ? "diplomacy" : "player",
        notable: index === firstThreeActions.length - 1,
        playerRelated: true,
        title:
          action.kind === "chat"
            ? `${bundle.game.country} opens a diplomatic channel`
            : `${bundle.game.country} acts on ${action.title.toLowerCase()}`,
      });
    });
  } else {
    // A provider/validation failure is not an in-world historical event.
    // Advancing the requested clock quietly is safer than fabricating a generic
    // "international balance remains in motion" card that can pollute canon,
    // saturation, and later causal context.
  }

  const lastEvent = events.at(-1) ?? null;
  const catalyst = lastEvent
    ? {
        choices: [
          "Press the advantage immediately",
          "Probe cautiously before committing",
          "Hold position and gather more intelligence",
        ],
        opening: `${lastEvent.title}. ${lastEvent.description}`,
        premise: `This scene begins as ${lastEvent.title.toLowerCase()} reaches the point where direct judgment matters.`,
        title: lastEvent.title,
      }
    : null;

  return {
    catalyst,
    clearActions: true,
    events,
    storylineUpdates: [],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
    stopDate: targetDate,
    summary:
      plannedActions.length > 0
        ? `${bundle.game.country} moves from planning into execution, and the world begins adjusting to the turn's most concrete orders.`
        : `AI world generation failed for this interval; the deterministic fallback advanced time without fabricating a canonical world event.`,
  };
};

const normalizeGeneratedEvent = (entry, index = 0) => {
  const normalized = normalizeEvents([entry])[0];
  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    id: normalized.id || `generated-event-${index}`,
  };
};

const MAX_ROLLBACK_SNAPSHOTS = 12;

// Persist the PRE-turn state so the cheats menu's "Roll back turn" can restore it.
// A dedicated per-game runtime asset (storage/snapshots.json) — never bundled with
// a scenario or dragged through the 5s poll — capped so a long game can't grow it
// without bound. Purely best-effort: a snapshot failure must never break a turn.
const captureRollbackSnapshot = async ({ round, fromDate, toDate, game, world, events, actions, chat, colors }) => {
  try {
    const prior = await readJson(JSON_URLS.snapshots, { defaultValue: [], force: true }).catch(() => []);
    const list = Array.isArray(prior) ? prior : [];
    const snapshot = {
      id: `snap-${round}-${Date.now()}`,
      round,
      fromDate,
      toDate,
      capturedAt: new Date().toISOString(),
      state: {
        game: cloneValue(game),
        world: cloneValue(world),
        events: cloneValue(events),
        actions: cloneValue(actions),
        chat: cloneValue(chat),
        colors: cloneValue(colors),
      },
    };
    await writeJson(JSON_URLS.snapshots, [snapshot, ...list].slice(0, MAX_ROLLBACK_SNAPSHOTS));
  } catch (error) {
    console.warn("[rollback] snapshot capture failed:", error);
  }
};

// Restore points, newest first (index 0 = undo the most recent turn). Shared by
// the cheats menu and the timeline's Undo control.
export const loadRollbackSnapshots = async () => {
  const list = await readJson(JSON_URLS.snapshots, { defaultValue: [], force: true }).catch(() => []);
  return Array.isArray(list) ? list : [];
};

// Roll back to the start of the turn captured at `index`: restore the six
// per-turn assets, discard that restore point and every newer one (those turns
// no longer happened), and return the freshly-normalized bundle so the caller
// can update immediately. Returns null if there is no such snapshot.
export const rollBackToSnapshot = async (index = 0) => {
  const snapshots = await loadRollbackSnapshots();
  const snap = snapshots[index];
  if (!snap) return null;
  const s = snap.state ?? {};
  await Promise.all([
    writeJson(JSON_URLS.game, s.game ?? {}, { pretty: true }),
    writeJson(JSON_URLS.world, s.world ?? {}, { pretty: true }),
    writeJson(JSON_URLS.events, s.events ?? [], { pretty: true }),
    writeJson(JSON_URLS.actions, s.actions ?? [], { pretty: true }),
    writeJson(JSON_URLS.chat, s.chat ?? [], { pretty: true }),
    writeJson(JSON_URLS.colors, s.colors ?? {}, { pretty: true }),
  ]);
  await writeJson(JSON_URLS.snapshots, snapshots.slice(index + 1));
  const bundle = await readGameStateBundle({ force: true });
  return { bundle, round: snap.round, remaining: snapshots.length - (index + 1) };
};


// ---------------------------------------------------------------------------
// Fix 08.4.5 — Bounded multi-contact diplomatic initiative
// ---------------------------------------------------------------------------
// The jump model has always been ALLOWED to open diplomatic outreach, while a
// separate real-time idle drip occasionally does the same between turns. In
// practice the full world pass became too conservative after the anti-spam work:
// months containing major player actions, alliance changes or balance-of-power
// shocks could finish with little or no incoming diplomacy at all.
//
// 08.4.4 added one diplomacy-only post-jump review, but stopped as soon as ANY
// incoming approach survived. That meant one Austrian telegram could suppress
// independent British, Russian or Ottoman reasons to contact the player. 08.4.5
// keeps the same anti-spam ceiling but treats it as a bounded completion pass:
// existing approaches consume slots, duplicate participant sets are blocked, and
// the model may add independently justified contacts until it chooses silence or
// the shared three-approach turn ceiling is reached.
const DIPLOMATIC_INITIATIVE_MIN_DAYS = 14;
const DIPLOMATIC_INITIATIVE_MAX_DAYS = 45;
const DIPLOMATIC_INITIATIVE_SOFT_SILENCE_DAYS = 60;
const DIPLOMATIC_INITIATIVE_STRONG_SILENCE_DAYS = 90;
const DIPLOMATIC_INITIATIVE_MAX_APPROACHES_PER_JUMP = 3;
const DIPLOMATIC_AUTONOMOUS_SOURCES = new Set([
  "invitation",
  "outreach",
  "jump-initiative",
  "event-reaction",
]);

// Local bounded-text helper for the diplomacy-only review context. Keep this
// self-contained: gameplay.js has no generic `truncate()` helper, and the
// optional initiative review must never fail because of presentation clipping.
const diplomaticInitiativeClip = (value, maxLength = 320) => {
  const text = normalizeString(value);
  const limit = Math.max(1, Math.trunc(Number(maxLength) || 0));
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
};

const diplomaticInitiativeSpanDays = (fromDate, toDate) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(normalizeString(fromDate))
    ? Date.parse(`${normalizeString(fromDate)}T00:00:00Z`)
    : NaN;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(normalizeString(toDate))
    ? Date.parse(`${normalizeString(toDate)}T00:00:00Z`)
    : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86400000);
};

const dateGeneratedChatOpener = (chat, fallbackDate = "") => {
  if (!chat) return chat;
  const date = normalizeString(fallbackDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return chat;
  const messages = normalizeArray(chat?.messages);
  if (!messages.length || normalizeString(messages[0]?.time || messages[0]?.date)) return chat;
  return {
    ...chat,
    messages: messages.map((message, index) =>
      index === 0 ? { ...message, time: date } : message
    ),
  };
};

const diplomaticInitiativeSilenceState = ({ chats, events, toDate, startDate } = {}) => {
  const target = normalizeString(toDate);
  let latest = "";
  const eventDateById = new Map(
    normalizeEvents(events)
      .map((event) => [normalizeString(event?.id), normalizeString(event?.date)])
      .filter(([id, date]) => id && /^\d{4}-\d{2}-\d{2}$/.test(date)),
  );

  const consider = (rawDate) => {
    const date = normalizeString(rawDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (target && date > target) return;
    if (!latest || date > latest) latest = date;
  };

  for (const chat of normalizeChats(chats)) {
    const source = normalizeString(chat?.source).toLowerCase();
    if (!DIPLOMATIC_AUTONOMOUS_SOURCES.has(source)) continue;

    // We are measuring NEW autonomous approaches, not ordinary replies inside an
    // already-open diplomatic thread. Therefore use the opener's date when it is
    // present; do not let a later leader reply reset the silence clock.
    const messages = normalizeArray(chat?.messages);
    const opener = messages[0];
    const openerDate = normalizeString(opener?.time || opener?.date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(openerDate)) {
      consider(openerDate);
      continue;
    }

    // Back-compat path 1: event-created chats historically had a blank opener
    // timestamp but retained linkedEventId. The causal event is the exact creation
    // date for that autonomous approach.
    const linkedEventDate = eventDateById.get(normalizeString(chat?.linkedEventId));
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(linkedEventDate))) {
      consider(linkedEventDate);
      continue;
    }

    // Back-compat path 2: old standalone outreach often has BOTH a blank opener
    // timestamp and no linkedEventId. If the player later replied (or the thread
    // otherwise acquired dated messages), the earliest dated message proves the
    // autonomous opener existed no later than that date. Use that conservative
    // inferred creation date instead of falsely treating the entire campaign as
    // diplomatically silent. Never use the latest reply: ongoing conversation is
    // not a new autonomous approach.
    const inferredDate = messages
      .map((message) => normalizeString(message?.time || message?.date))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort()[0] || "";
    consider(inferredDate);
  }

  const anchor = latest || normalizeString(startDate);
  const days = anchor && target ? diplomaticInitiativeSpanDays(anchor, target) : 0;
  const level = days >= DIPLOMATIC_INITIATIVE_STRONG_SILENCE_DAYS
    ? "strong"
    : days >= DIPLOMATIC_INITIATIVE_SOFT_SILENCE_DAYS
      ? "soft"
      : "normal";

  return {
    days,
    level,
    lastDate: latest,
    noRecordedAutonomousApproach: !latest,
  };
};

const diplomaticInitiativeContextText = ({
  playerPolity,
  fromDate,
  toDate,
  events,
  relationUpdates,
  agreementUpdates,
  plannedActions,
  silenceState,
  existingApproachLabels = [],
  remainingSlots = 0,
} = {}) => {
  const eventRows = normalizeArray(events).slice(-8).map((event, index) =>
    `${index + 1}. ${normalizeString(event?.date) || toDate || "undated"} — ` +
    `${normalizeString(event?.title) || "Untitled event"}: ` +
    diplomaticInitiativeClip(normalizeString(event?.description), 320)
  );
  const actionRows = normalizeArray(plannedActions).slice(0, 4).map((action, index) =>
    `${index + 1}. ${diplomaticInitiativeClip(normalizeString(action?.text || action?.title || action?.description), 320)}`
  );
  const relationRows = normalizeArray(relationUpdates).slice(-6).map((update) =>
    `- ${normalizeString(update?.a)} ↔ ${normalizeString(update?.b)}: ` +
    `${Number.isFinite(Number(update?.score)) ? Math.round(Number(update.score)) : "?"} ` +
    `${normalizeString(update?.status)} — ${diplomaticInitiativeClip(normalizeString(update?.summary), 220)}`
  );
  const agreementRows = normalizeArray(agreementUpdates).slice(-6).map((update) =>
    `- ${normalizeString(update?.id)} | ${normalizeString(update?.op)} | ` +
    `${normalizeArray(update?.parties).map(normalizeString).filter(Boolean).join(" + ") || "parties preserved"} | ` +
    `${diplomaticInitiativeClip(normalizeString(update?.title || update?.terms), 220)}`
  );

  return [
    `PLAYER POLITY: ${normalizeString(playerPolity) || "unknown"}`,
    `SIMULATED PERIOD JUST COMPLETED: ${normalizeString(fromDate) || "?"} → ${normalizeString(toDate) || "?"}`,
    `AUTONOMOUS INCOMING DIPLOMACY SILENCE: ${Math.max(0, Number(silenceState?.days) || 0)} day(s) since ${silenceState?.lastDate ? `the last autonomous incoming approach (${silenceState.lastDate})` : "campaign start with no recorded autonomous incoming approach"}; pressure=${normalizeString(silenceState?.level) || "normal"}.`,
    silenceState?.level === "strong"
      ? "Silence has become conspicuous. Re-examine unresolved relations, active agreements, security concerns, commercial opportunities, prior warnings/proposals, and friendly alliance continuity before deciding nobody would write. Continued silence is still legal when concretely justified."
      : silenceState?.level === "soft"
        ? "Silence is becoming prolonged. Search diplomatic continuity somewhat more carefully than usual, but do not manufacture chatter."
        : "No prolonged-silence bias is required.",
    "",
    "SURVIVING VISIBLE DEVELOPMENTS THIS PERIOD:",
    eventRows.length ? eventRows.join("\n") : "None survived curation.",
    "",
    "PLAYER ACTIONS THAT ENTERED THIS TURN:",
    actionRows.length ? actionRows.join("\n") : "None.",
    "",
    "MATERIAL RELATION CHANGES THIS PERIOD:",
    relationRows.length ? relationRows.join("\n") : "None.",
    "",
    "FORMAL AGREEMENT LIFECYCLE CHANGES THIS PERIOD:",
    agreementRows.length ? agreementRows.join("\n") : "None.",
    "",
    "INCOMING APPROACHES ALREADY REPRESENTED THIS TURN:",
    normalizeArray(existingApproachLabels).length ? normalizeArray(existingApproachLabels).map((label) => `- ${label}`).join("\n") : "None.",
    `REMAINING INCOMING APPROACH SLOTS THIS TURN: ${Math.max(0, Number(remainingSlots) || 0)} of ${DIPLOMATIC_INITIATIVE_MAX_APPROACHES_PER_JUMP}.`,
    "",
    "Decision standard: independently evaluate which polity still has a concrete reason to speak because of current interests, the developments above, a direct request/invitation/proposal from the player, or unresolved diplomatic continuity. A prior chat is NOT required for a polity to initiate contact. One polity speaking does NOT satisfy another polity's independent reason to answer. Direct formal invitations, requests for a government's position, treaty/mediation proposals, demands, ultimatums, guarantees, requests for assistance, and comparable response-bearing diplomatic acts create a strong presumption that at least one still-unrepresented addressee should answer unless the supplied canon gives a concrete reason for silence. Silence remains valid when no further grounded contact exists; generic small talk is not.",
  ].join("\n");
};

const maybeGeneratePostJumpDiplomaticInitiative = async ({
  bundle,
  fromDate,
  toDate,
  events,
  relationUpdates,
  agreementUpdates,
  plannedActions,
  existingGeneratedChats = [],
  mode = "jump",
  signal,
} = {}) => {
  if (mode !== "jump") return [];

  const spanDays = diplomaticInitiativeSpanDays(fromDate, toDate);
  if (spanDays < DIPLOMATIC_INITIATIVE_MIN_DAYS || spanDays > DIPLOMATIC_INITIATIVE_MAX_DAYS) {
    return [];
  }

  const existingApproaches = normalizeArray(existingGeneratedChats).filter(Boolean);
  const existingCount = Math.min(
    DIPLOMATIC_INITIATIVE_MAX_APPROACHES_PER_JUMP,
    existingApproaches.length,
  );
  const initialRemaining = Math.max(
    0,
    DIPLOMATIC_INITIATIVE_MAX_APPROACHES_PER_JUMP - existingCount,
  );

  if (initialRemaining <= 0) {
    console.info(
      `[OH Diplomatic Initiative 08.4.5] post-jump completion already at cap: ` +
      `${existingCount}/${DIPLOMATIC_INITIATIVE_MAX_APPROACHES_PER_JUMP} incoming approach(es) survived this turn.`,
    );
    return [];
  }

  const participantLabel = (chat) => normalizeArray(chat?.countries)
    .map((country) => {
      const identity = resolveChatParticipantIdentity(country, bundle?.world);
      return normalizeString(identity?.name || country?.name || country?.code);
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join(" + ");

  try {
    // Block any participant set that has already spoken on the stop date AND every
    // approach already generated in this turn even when its opener carries an earlier
    // event date. The latter is what 08.4.4 missed when one event-linked approach
    // incorrectly ended the whole diplomatic review.
    const blockedParticipantSets = idleDiplomacyBlockedSetsForDate(
      bundle?.chats,
      bundle?.world,
      toDate,
    );
    for (const chat of existingApproaches) {
      const key = chatParticipantSetKey(chat, bundle?.world);
      if (!key) continue;
      blockedParticipantSets.set(key, participantLabel(chat) || key);
    }

    const silenceState = diplomaticInitiativeSilenceState({
      chats: bundle?.chats,
      events: bundle?.events,
      toDate,
      startDate: bundle?.game?.startDate || fromDate,
    });
    const baseVariables = await buildTemplateVariables(bundle, { taskKey: "idleDiplomacy" });
    const generated = [];

    for (let reviewIndex = 0; reviewIndex < initialRemaining; reviewIndex += 1) {
      const representedCount = existingCount + generated.length;
      const remainingSlots = Math.max(
        0,
        DIPLOMATIC_INITIATIVE_MAX_APPROACHES_PER_JUMP - representedCount,
      );
      if (remainingSlots <= 0) break;

      const blockedParticipantLabels = Array.from(blockedParticipantSets.values());
      const existingApproachLabels = [
        ...existingApproaches.map(participantLabel),
        ...generated.map(participantLabel),
      ].filter(Boolean);
      const variables = {
        ...baseVariables,
        idleDiplomacyBlockedParticipantSets:
          blockedParticipantLabels.length > 0
            ? blockedParticipantLabels.map((label) => `- ${label}`).join("\n")
            : "None.",
        jumpDiplomaticInitiativeContext: diplomaticInitiativeContextText({
          playerPolity: bundle?.game?.country,
          fromDate,
          toDate,
          events,
          relationUpdates,
          agreementUpdates,
          plannedActions,
          silenceState,
          existingApproachLabels,
          remainingSlots,
        }),
      };

      const { payload } = await runJsonTask("idleDiplomacy", {
        timeoutMs: 60000,
        maxTokens: 1200,
        reasoningEnabled: false,
        signal,
        userMessage:
          `Post-jump diplomatic initiative completion review ${reviewIndex + 1}/${initialRemaining}. ` +
          `This period currently has ${representedCount} surviving incoming approach(es), with ${remainingSlots} slot(s) still available under the hard turn cap. ` +
          `Do not treat an earlier polity's message as satisfying another polity's independent reason to contact the player. ` +
          `Pay special attention to response-bearing player diplomacy: formal invitations, requests for a government's position, proposals, mediation offers, demands, ultimatums, guarantees, or requests for assistance. ` +
          `A named addressee does not need prior chat history to initiate a new conversation; cold-start diplomatic partners are fully eligible. ` +
          `${silenceState.level === "strong" ? `There have now been about ${silenceState.days} in-game days without autonomous incoming diplomacy, so explicitly re-examine unresolved relations, agreements, security reactions, commercial opportunities and prior diplomatic continuity before choosing silence. ` : silenceState.level === "soft" ? `Autonomous diplomacy has been quiet for about ${silenceState.days} in-game days; search continuity somewhat more carefully than usual. ` : ""}` +
          `Choose at most one additional independently justified polity or genuinely joint small group for THIS review. If no further grounded contact exists after accounting for approaches already represented this turn, return chat:null. Return JSON only.`,
        validatePayload: async (candidate, { finalAttempt } = {}) => {
          if (candidate?.chat == null) return "";
          const countries = await resolveInvitees(candidate.chat.countries, bundle?.world);
          if (countries.length === 0) {
            return "$.chat.countries must contain at least one known non-player polity (or chat must be null).";
          }
          const duplicateKey = chatParticipantSetKey({ countries }, bundle?.world);
          if (duplicateKey && blockedParticipantSets.has(duplicateKey) && !finalAttempt) {
            return `$.chat repeats participant set ${blockedParticipantSets.get(duplicateKey)} which already has an incoming approach represented this turn. Choose a different justified participant set or return chat:null.`;
          }
          return finalAttempt ? "" : validateChatOpener(candidate.chat, "$.chat");
        },
        variables,
      });

      if (!payload?.chat) {
        console.info(
          `[OH Diplomatic Initiative 08.4.5] completion review stopped after ${representedCount} incoming approach(es); ` +
          `model judged no additional grounded contact appropriate.`,
        );
        break;
      }

      const built = await buildGeneratedChat(
        { ...payload.chat, source: "jump-initiative" },
        "",
        bundle?.world,
        { playerName: bundle?.game?.country },
      );
      if (!built) {
        console.warn(
          "[OH Diplomatic Initiative 08.4.5] generated outreach could not be normalized; keeping prior completed diplomacy and stopping the review.",
        );
        break;
      }

      const builtParticipantKey = chatParticipantSetKey(built, bundle?.world);
      if (builtParticipantKey && blockedParticipantSets.has(builtParticipantKey)) {
        console.warn(
          `[OH Diplomatic Initiative 08.4.5] model repeated already-represented participant set ` +
          `${blockedParticipantSets.get(builtParticipantKey)} on its final attempt; dropping the duplicate and stopping the review.`,
        );
        break;
      }

      const datedBuilt = {
        ...built,
        messages: built.messages.map((message, index) =>
          index === 0 && !normalizeString(message.time)
            ? { ...message, time: normalizeString(toDate) || normalizeString(bundle?.game?.gameDate) }
            : message
        ),
      };

      generated.push(datedBuilt);
      if (builtParticipantKey) {
        blockedParticipantSets.set(
          builtParticipantKey,
          participantLabel(datedBuilt) || builtParticipantKey,
        );
      }

      console.info(
        `[OH Diplomatic Initiative 08.4.5] generated autonomous approach ${representedCount + 1}/` +
        `${DIPLOMATIC_INITIATIVE_MAX_APPROACHES_PER_JUMP} from ` +
        `${participantLabel(datedBuilt) || "an AI polity"}.`,
      );
    }

    return generated;
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Timeline jump cancelled.", "AbortError");
    console.warn(
      `[OH Diplomatic Initiative 08.4.5] completion review failed: ${normalizeString(error?.message || error) || "unknown error"}. ` +
      "Keeping the completed world turn and any diplomacy already generated.",
    );
    return [];
  }
};

const applySimulationResult = async ({
  baseActions,
  baseChats,
  baseColors,
  baseEvents,
  baseGame,
  baseWorld,
  result,
  signal,
}) => {
  await yieldToUiFrame(signal);
  const generatedEvents = normalizeArray(result.events)
    .map((entry, index) => normalizeGeneratedEvent({
      ...entry,
      source: entry?.source || result.generation?.source || "ai",
    }, index))
    .filter(Boolean);
  // The model is shown the running timeline as context and tends to restate events
  // it already reported; each restatement gets a fresh random id, so only a
  // content-key de-dup catches it. Drop restatements BEFORE they persist, apply
  // impacts, or land in this turn's record (also see the [New Developments Only]
  // directive in buildTemplateVariables).
  const priorEvents = normalizeEvents(baseEvents);
const freshEvents = dedupeGeneratedEvents(priorEvents, generatedEvents);

// run the curator BEFORE impacts, chats, history, and persistence.
// revolutionary concept: decide whether an event exists before fucking saving it.
let curatedEvents = await curateGeneratedEvents({
  events: freshEvents,
  priorEvents,
  game: baseGame,
  world: baseWorld,
  actions: baseActions,
  mode: result.mode,

  // use the game's own ai task runner instead of stealing gemini's transport
  // out of the browser like some sort of fucking catalytic converter.
  analyzeBatch: ({ candidates, priorHistory }) =>
    runJsonTask("timelineCurator", {
      fallback: () => ({
        judgments: candidates.map((event, index) => ({
          index,
          verdict: "KEEP",
          confidence: 0,
          materialStateChange:
            "Semantic curator unavailable; event preserved by fail-open fallback.",
          matchedPriorIndexes: [],
          materiallyNewDimensions: ["unknown"],
          recurrenceMatters: false,
          newTriggerAfterPriorPosture: "none",
          worthwhile: true,
          substantive: true,
          personalityTexture: false,
          storyline: normalizeString(event?.title) || `event-${index}`,
          qualitativeAdvance: true,
          incrementalProcess: false,
          processFramePresent: false,
          observableOutcomeEvidence: "",
          pureProcessFiller: false,
          reason: "Curator AI failed; fail-open KEEP.",
        })),

        recentHistoryMechanical: false,
        storylineSaturation: [],
        underrepresentedDomains: [],
      }),

      userMessage:
        "Analyze every supplied native timeline candidate with the required curator tool. Return exactly one judgment for every candidate index.",

      variables: {
        curatorPriorHistory: JSON.stringify(priorHistory, null, 2),
        curatorCandidates: JSON.stringify(candidates, null, 2),
      },
    }),
});
await yieldToUiFrame(signal);

// Fix 08.3 — breadth is measured by WHAT SURVIVES CURATION, not by how many
// candidate JSON objects the primary model happened to emit. A month-scale
// whole-world pass with only 0-3 worthwhile survivors gets one bounded composition search
// of exploration lanes still visibly neglected after curation. This still is
// NOT a minimum-event quota: the re-check may return zero, and every supplemental
// candidate must pass native integrity screening AND the same semantic Curator.
const breadthRepair = await maybeRepairWorldBreadthAfterCuration({
  survivingEvents: curatedEvents,
  mainEvents: freshEvents,
  bundle: {
    actions: baseActions,
    chats: baseChats,
    events: priorEvents,
    game: baseGame,
    world: baseWorld,
  },
  context: result?.breadthRepairContext,
  mode: result.mode,
  signal,
});
await yieldToUiFrame(signal);

if (breadthRepair?.events?.length) {
  // Attach NEW storyline ids to their own repair events before any filtering so
  // surviving events can carry durable continuity forward exactly like main-pass
  // events. Existing storyline ids are forbidden by runWorldBreadthRepair.
  const repairTaggedEvents = attachDecodedStorylineIds(
    breadthRepair.events,
    breadthRepair.storylineUpdates,
    "world-breadth-repair",
  );
  const repairNormalizedEvents = repairTaggedEvents
    .map((entry, index) => normalizeGeneratedEvent({
      ...entry,
      source: entry?.source || "ai",
    }, freshEvents.length + index))
    .filter(Boolean);
  const repairFreshEvents = dedupeGeneratedEvents(
    [...priorEvents, ...freshEvents],
    repairNormalizedEvents,
  );

  const repairScreened = screenGeneratedWorldEvents({
    events: repairFreshEvents,
    world: baseWorld,
    game: baseGame,
    analysis: breadthRepair.analysis,
  });

  const repairCuratedEvents = await curateGeneratedEvents({
    events: repairScreened.events,
    priorEvents: [...priorEvents, ...curatedEvents],
    game: baseGame,
    world: baseWorld,
    actions: baseActions,
    mode: result.mode,
    analyzeBatch: ({ candidates, priorHistory }) =>
      runJsonTask("timelineCurator", {
        fallback: () => ({
          judgments: candidates.map((event, index) => ({
            index,
            verdict: "KEEP",
            confidence: 0,
            materialStateChange:
              "Semantic curator unavailable; event preserved by fail-open fallback.",
            matchedPriorIndexes: [],
            materiallyNewDimensions: ["unknown"],
            recurrenceMatters: false,
            newTriggerAfterPriorPosture: "none",
            worthwhile: true,
            substantive: true,
            personalityTexture: false,
            storyline: normalizeString(event?.title) || `event-${index}`,
            qualitativeAdvance: true,
            incrementalProcess: false,
            processFramePresent: false,
            observableOutcomeEvidence: "",
            pureProcessFiller: false,
            reason: "Curator AI failed; fail-open KEEP.",
          })),
          recentHistoryMechanical: false,
          storylineSaturation: [],
          underrepresentedDomains: [],
        }),
        userMessage:
          "Analyze every supplied native timeline candidate with the required curator tool. Return exactly one judgment for every candidate index.",
        variables: {
          curatorPriorHistory: JSON.stringify(priorHistory, null, 2),
          curatorCandidates: JSON.stringify(candidates, null, 2),
        },
      }),
  });

  const survivingRepairStorylineIds = new Set(
    repairCuratedEvents
      .flatMap((event) => normalizeArray(event?.storylineIds))
      .map(normalizeString)
      .filter(Boolean),
  );
  const repairStorylineUpdates = normalizeArray(breadthRepair.storylineUpdates)
    .filter((update) => survivingRepairStorylineIds.has(normalizeString(update?.id)));

  if (repairStorylineUpdates.length) {
    result.storylineUpdates = [
      ...decodeWorldStorylineUpdates(result.storylineUpdates),
      ...repairStorylineUpdates,
    ];
  }

  curatedEvents = [...curatedEvents, ...repairCuratedEvents];
  console.info(
    `[OH World Composition 08.3.1] supplemental candidates: ${breadthRepair.events.length}; ` +
    `integrity kept ${repairScreened.events.length}; Curator kept ${repairCuratedEvents.length}.`,
  );
}

// The curator decides WHICH events survive. The unit director then makes the
// surviving military events actually use the persistent order of battle instead
// of spawning a counter and forgetting it exists for the rest of the century.
await yieldToUiFrame(signal);
const directedEvents = await directGeneratedUnitOps({
  events: curatedEvents,
  game: baseGame,
  world: baseWorld,
  analyzeBatch: ({ candidates, units }) =>
    runJsonTask("unitDirector", {
      fallback: () => ({ eventOrders: [], summary: "Unit director unavailable; existing simulator unitOps preserved." }),
      userMessage:
        "Advance the supplied military events through the existing persistent units. Return one eventOrders entry only where a real unit operation is warranted; leaving an event untouched is valid.",
      variables: {
        unitDirectorCandidates: JSON.stringify(candidates, null, 2),
        unitDirectorUnits: JSON.stringify(units, null, 2),
        unitDirectorGameDate: normalizeString(baseGame.gameDate),
        unitDirectorRound: String(baseGame.round || 1),
      },
    }),
});

// Armies now move and fight. This second narrow pass translates the surviving
// prose/front state into the native disputed-region machinery without pretending
// that every occupation is suddenly international law.
await yieldToUiFrame(signal);
let territoryEvents = await directGeneratedTerritoryOps({
  events: directedEvents,
  world: baseWorld,
  analyzeBatch: async ({ candidates, territorialState }) =>
    runJsonTask("territoryDirector", {
      fallback: () => ({
        eventOrders: [],
        summary: "Territory director unavailable; existing legal/control impacts preserved.",
      }),
      userMessage:
        "Reconcile the supplied events with de-facto territorial control. Add only control/contest/clear operations that the event itself supports; never invent a legal sovereignty change.",
      variables: {
        territoryDirectorCandidates: JSON.stringify(candidates, null, 2),
        territoryDirectorState: JSON.stringify(territorialState, null, 2),
        territorialControlContext: await buildTerritorialControlContext(baseWorld),
      },
    }),
});

// The main simulator's control ops were resolved during payload validation, but
// the native territory director can add new human place names after that point.
// Resolve those too before they ever reach world.json. Unresolved additions fail
// safe by disappearing instead of creating phantom region keys.
const territoryContainers = territoryEvents.map((event, index) => ({
  event,
  impacts: event?.impacts,
  path: `$.events[${index}].impacts`,
}));
const unresolvedDirectedControl = await resolveRegionControlOps(territoryContainers, baseWorld);
if (unresolvedDirectedControl.length > 0) {
  console.warn(
    `[territory director] dropped ${unresolvedDirectedControl.length} unresolved control geography item(s) after the post-simulation pass.`,
  );
}

// Post-processors may add HOW after the main payload was validated. They may not
// manufacture a new semantic WHAT.
//
// Native Unit Director can occasionally attach op=attack to an event that only
// describes military policy/readiness (for example a conscription law). The war
// validator is correct to treat an attack op as combat; the incorrect fact is the
// post-processor attack itself. Strip those unsupported attack ops first.
const unsupportedDirectedAttacks = stripUnsupportedUnitAttackOps(territoryEvents);
if (unsupportedDirectedAttacks.length) {
  console.warn(
    `[OH unit-op semantic guard] dropped ${unsupportedDirectedAttacks.length} post-processor attack op(s) ` +
    `from non-combat event(s): ` +
    unsupportedDirectedAttacks
      .map((entry) => `"${entry.title || `event ${entry.eventIndex + 1}`}"`)
      .join(", "),
  );
}

// Canonical timeline identity is assigned only after every semantic/native event
// post-processor has finished, but before any ledger validation or persistence.
// Hidden-pass ids such as world-pass-1-event-1 are intentionally temporary and
// may repeat on later turns; canonical ids are round-scoped so future history
// references are globally unambiguous. Existing save history is NEVER rewritten
// here because legacy duplicate ids may already be referenced ambiguously.
const canonicalEventIdentity = allocateCanonicalTurnEventIds({
  existingEvents: priorEvents,
  newEvents: territoryEvents,
  round: (baseGame.round || 1) + 1,
});
territoryEvents = canonicalEventIdentity.events;
result.warUpdates = remapLedgerEventIds(normalizeArray(result.warUpdates), canonicalEventIdentity.idMap);
result.relationUpdates = remapLedgerEventIds(normalizeArray(result.relationUpdates), canonicalEventIdentity.idMap);
result.agreementUpdates = remapLedgerEventIds(normalizeArray(result.agreementUpdates), canonicalEventIdentity.idMap);
if (canonicalEventIdentity.idMap.size) {
  console.info(`[OH event identity] assigned ${canonicalEventIdentity.idMap.size} canonical round-scoped event id(s).`);
}

// Genuine combat can also be introduced/modified after the main payload by the
// Unit/Territory directors or breadth composition. Reconcile that FINAL event set
// against canonical war state before the final invariant check.
const postProcessorWarCandidate = {
  events: territoryEvents,
  warUpdates: normalizeArray(result.warUpdates),
};
const postProcessorWarRepair = reconcileCombatWarState(postProcessorWarCandidate, {
  world: baseWorld,
});
result.warUpdates = decodeWarUpdates(postProcessorWarCandidate.warUpdates);

if (postProcessorWarRepair.unresolved.length) {
  const first = postProcessorWarRepair.unresolved[0];
  throw new Error(
    `[canonical war-state] Combat event "${first.title || `event ${first.index + 1}`}" ` +
    `could not be canonically bound after post-processing: ${first.reason}.`,
  );
}

// Re-check canonical belligerency before ANY state is persisted.
const canonicalWarError = validateCanonicalWarEvents({
  events: territoryEvents,
  updates: normalizeArray(result.warUpdates),
  world: baseWorld,
});
if (canonicalWarError) {
  throw new Error(`[canonical war-state] ${canonicalWarError}`);
}

const canonicalDiplomaticError = validateDiplomaticLedgerPayload({
  events: territoryEvents,
  relationUpdates: normalizeArray(result.relationUpdates),
  agreementUpdates: normalizeArray(result.agreementUpdates),
}, { world: baseWorld });
if (canonicalDiplomaticError) {
  throw new Error(`[canonical diplomatic-state] ${canonicalDiplomaticError}`);
}

const nextEvents = [...priorEvents, ...territoryEvents];
  const nextGame = normalizeGameData({
    ...baseGame,
    gameDate: normalizeString(result.stopDate) || baseGame.gameDate,
    round: (baseGame.round || 1) + 1,
  });
  const plannedActionSnapshot = normalizeActions(baseActions).filter((action) => action.status === "planned");
  const nextActions = normalizeActions(baseActions).map((action) => ({
    ...action,
    status: action.status === "planned" && result.clearActions ? "resolved" : action.status,
  }));
  let nextChats = [...normalizeChats(baseChats)];
  // Chats this turn CREATED, kept apart from the pre-turn snapshot. A turn takes a
  // while to generate and the player can edit the chat list while it runs, so the
  // write at the end merges these onto whatever is actually stored by then rather
  // than putting the stale snapshot back. See the re-read before writeChatsState.
  const generatedChats = [];

  await yieldToUiFrame(signal);
  const { colors: nextColors, world: worldWithImpacts } = applyEventImpactsToWorld({
    colors: baseColors,
    events: territoryEvents,
    game: nextGame,
    world: {
      ...baseWorld,
      activeCatalyst: result.catalyst ?? null,
      actionSuggestions: [],
      lastJumpMode: normalizeString(result.mode),
      lastJumpSummary: normalizeString(result.summary),
      lastJumpTargetDate: nextGame.gameDate,
      simulationHistory: [
        {
          catalyst: result.catalyst ? cloneValue(result.catalyst) : null,
          date: nextGame.gameDate,
          eventIds: territoryEvents.map((event) => event.id),
          fallbackReason: normalizeString(result.generation?.fallbackReason),
          fromDate: baseGame.gameDate,
          mode: normalizeString(result.mode) || "jump",
          plannedActions: plannedActionSnapshot,
          round: nextGame.round,
          summary: normalizeString(result.summary),
          source: result.generation?.source || "ai",
          storylineIds: normalizeArray(result.storylineUpdates)
            .map((entry) => normalizeString(entry?.id))
            .filter(Boolean),
          warIds: [...new Set(
            normalizeArray(result.warUpdates)
              .map((entry) => normalizeString(entry?.id))
              .filter(Boolean),
          )],
          relationIds: [...new Set(
            normalizeArray(result.relationUpdates)
              .map((entry) => relationPairKeyForHistory(entry?.a, entry?.b))
              .filter(Boolean),
          )],
          agreementIds: [...new Set(
            normalizeArray(result.agreementUpdates)
              .map((entry) => normalizeString(entry?.id))
              .filter(Boolean),
          )],
          toDate: nextGame.gameDate,
        },
        ...normalizeWorldState(baseWorld).simulationHistory,
      ].slice(0, 12),
    },
  });
  await yieldToUiFrame(signal);
  const warMerge = applyWarUpdates({
    world: worldWithImpacts,
    updates: normalizeArray(result.warUpdates),
    events: territoryEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });

  await yieldToUiFrame(signal);
  const diplomaticMerge = applyDiplomaticUpdates({
    world: warMerge.world,
    relationUpdates: normalizeArray(result.relationUpdates),
    agreementUpdates: normalizeArray(result.agreementUpdates),
    events: territoryEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });

  await yieldToUiFrame(signal);
  const storylineMerge = applyWorldStorylineUpdates({
    world: diplomaticMerge.world,
    updates: normalizeArray(result.storylineUpdates),
    events: territoryEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });
  let nextWorld = storylineMerge.world;

  for (const event of territoryEvents) {
    for (const createdChat of event.impacts.createdChats) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, nextWorld, {
        fallbackTitle: event.title,
        playerName: baseGame.country,
      });
      if (nextChat) {
        const datedChat = dateGeneratedChatOpener(nextChat, event.date || nextGame.gameDate);
        nextChats.unshift(datedChat);
        generatedChats.unshift(datedChat);
      }
    }
  }

  // Unprompted outreach: polities reaching out on their own initiative during
  // the simulated period, not tied to any event (treaty feelers, summit
  // invitations). Same chat machinery, no linked event.
  for (const chatLike of normalizeArray(result.outreach)) {
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", nextWorld, {
      playerName: baseGame.country,
    });
    if (nextChat) {
      const datedChat = dateGeneratedChatOpener(nextChat, nextGame.gameDate);
      nextChats.unshift(datedChat);
      generatedChats.unshift(datedChat);
    }
  }

  // Keep the in-memory turn bundle sane too. If two generated items refer to the
  // same open participant set (including aliases / reversed group order), compacting
  // history should see one conversation rather than two fake diplomatic threads.
  nextChats = reconcileStableChatsForPlayer(nextChats, nextWorld, baseGame.country);

  // Fix 08.4.5: AFTER Curator + canonical world updates, complete incoming diplomacy
  // up to the same hard three-approach turn ceiling. Existing event-linked/outreach
  // chats consume slots but no longer shut the review down merely because one polity
  // already spoke. Each added approach blocks its participant set before the next
  // review. The loop stops as soon as the model judges that no further independent
  // contact is grounded. A failed review never damages the already-valid world turn.
  const initiativeChats = await maybeGeneratePostJumpDiplomaticInitiative({
    bundle: {
      actions: nextActions,
      chats: nextChats,
      events: nextEvents,
      game: nextGame,
      world: nextWorld,
    },
    fromDate: baseGame.gameDate,
    toDate: nextGame.gameDate,
    events: territoryEvents,
    relationUpdates: normalizeArray(result.relationUpdates),
    agreementUpdates: normalizeArray(result.agreementUpdates),
    plannedActions: plannedActionSnapshot,
    existingGeneratedChats: generatedChats,
    mode: result.mode,
    signal,
  });
  for (const initiativeChat of normalizeArray(initiativeChats)) {
    nextChats.unshift(initiativeChat);
    generatedChats.unshift(initiativeChat);
  }
  if (normalizeArray(initiativeChats).length > 0) {
    nextChats = reconcileStableChatsForPlayer(nextChats, nextWorld, baseGame.country);
  }

  if (result.mode === "jump" || result.mode === "auto") {
    try {
      nextWorld = await compactHistoryIfNeeded({
        actions: nextActions,
        chats: nextChats,
        events: nextEvents,
        game: nextGame,
        world: nextWorld,
      });
    } catch (error) {
      console.warn("[ai] campaign history consolidation failed; the completed turn will still be saved.", error);
    }
  }

  // 8B.3.1 — optional bounded automatic Stats tracking. It runs only when the
  // player's configured calendar interval is due and uses ONE compact AI batch for
  // all initialized tracked countries. Failure never invalidates the completed turn.
  try {
    nextWorld = await refreshTrackedCountryStatsIfDue({
      bundle: {
        actions: nextActions,
        chats: nextChats,
        events: nextEvents,
        game: nextGame,
        world: nextWorld,
      },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[stats auto 8B.3.1] unexpected scheduler failure; completed world turn is preserved.", error);
  }

  // 8B.3 — permanent compact Stats history. This snapshots only the numeric
  // countryStats sheets that already exist; it does NOT generate missing Stats and
  // therefore adds no AI work when automatic tracking is disabled or not due.
  nextWorld = captureCountryStatsHistory(nextWorld, {
    date: nextGame.gameDate || nextGame.startDate || "",
    round: nextGame.round || 0,
  });

  // Re-read the chat list instead of writing the pre-turn snapshot back over it.
  // Turns take a while, and anything the player did to the list while one ran —
  // deleting a thread, archiving one — exists only in storage. Writing baseChats
  // on top resurrected deleted chats, and the AI's next message then landed in the
  // revived thread instead of opening a fresh one. Falls back to the snapshot if
  // the read fails, which is the old behaviour and never loses a generated chat.
  let chatsToWrite;
  try {
    const liveChats = await readChatsState({
      force: true,
      world: nextWorld,
      playerCountry: baseGame.country,
    });
    chatsToWrite = mergeIncomingChats(liveChats, generatedChats, nextWorld, {
      playerCountry: baseGame.country,
    });
  } catch {
    chatsToWrite = reconcileStableChatsForPlayer(nextChats, nextWorld, baseGame.country);
  }

  await Promise.all([
    writeActionsState(nextActions),
    writeChatsState(chatsToWrite, { world: nextWorld, playerCountry: baseGame.country }),
    writeEventsState(nextEvents),
    writeGameData(nextGame),
    writeJson(JSON_URLS.colors, nextColors, { pretty: true }),
    writeWorldState(nextWorld),
  ]);

  // The turn's new state is now persisted. Web-mode encrypted sync listens for this
  // to back up the turn (replacing a fixed 20s poll); it is a no-op in desktop mode
  // where nothing listens. Firing here — the single choke point every turn type runs
  // through (jump, auto-jump, catalyst, game-master) — means the sync's full scan
  // sees the committed round.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("oh:turn-complete"));

  // Snapshot the state we just replaced so it can be rolled back to (best-effort).
  await captureRollbackSnapshot({
    round: baseGame.round || 1,
    fromDate: baseGame.gameDate || baseGame.startDate || "",
    toDate: nextGame.gameDate || "",
    game: baseGame,
    world: baseWorld,
    events: baseEvents,
    actions: baseActions,
    chat: baseChats,
    colors: baseColors,
  });

  return {
    actions: nextActions,
    chats: chatsToWrite, // what was actually persisted, not the pre-turn snapshot
    colors: nextColors,
    events: nextEvents,
    game: nextGame,
    generation: result.generation ?? { source: "ai", fallbackReason: "" },
    world: nextWorld,
  };
};

export const generateActionSuggestions = async ({ force = true } = {}) => {
  const bundle = await readGameStateBundle({ force });
  const variables = await buildTemplateVariables(bundle, { taskKey: "actions" });
  const { payload } = await runJsonTask("actions", {
    fallback: () => fallbackActionSuggestions(bundle),
    userMessage: "Generate current strategic action suggestions as JSON only.",
    variables,
  });

  const normalizeTopics = (raw) =>
    normalizeArray(raw)
      .map((topic, topicIndex) => {
        if (!topic || typeof topic !== "object") {
          return null;
        }

        const title = normalizeString(topic.title || topic.name);
        if (!title) {
          return null;
        }

        return {
          actions: normalizeArray(topic.actions)
            .map((action, actionIndex) =>
              normalizeActionEntry(
                {
                  ...action,
                  source: "suggested",
                  suggestionTopic: title,
                },
                actionIndex,
              ),
            )
            .filter(Boolean),
          description: normalizeString(topic.description),
          id: normalizeString(topic.id) || `topic-${topicIndex}`,
          title,
        };
      })
      .filter(Boolean);

  // Models told "JSON only" mislabel or wrap the list — accept the common
  // shapes (top-level array, topics, suggestions) before giving up.
  let topics = normalizeTopics(
    Array.isArray(payload) ? payload : payload?.topics ?? payload?.suggestions,
  );

  // A parseable-but-EMPTY answer used to be accepted as "no suggestions were
  // generated" — the deterministic fallback (which always has topics) now
  // covers it, same as empty timeline turns.
  if (topics.length === 0) {
    console.warn("[ai] action suggestions came back empty — using the deterministic fallback.");
    topics = normalizeTopics((await fallbackActionSuggestions(bundle))?.topics);
  }

  const world = normalizeWorldState(await readWorldState());
  world.actionSuggestions = topics;
  await writeWorldState(world);

  return topics;
};

// Freeform AI intelligence briefing on a specific country/polity, grounded in the
// current world state. Returned as plain-text bullet points for the region popup.
// Everything the game state actually records about ONE polity — the target's
// dossier for intelligence briefings. The generic world summary truncates hard
// (24 of possibly thousands of region overrides, 16 polities), so without this
// the target usually isn't in the prompt at all and the AI can only shrug.
const buildTargetDossier = async (bundle, code, normalizedWorld = null) => {
  const world = normalizedWorld || normalizeWorldState(bundle.world);
  const lines = [];

  const polity = code ? world.polityOverrides?.[code] : null;
  if (polity) {
    lines.push(
      `Polity: ${polity.name || code} (code ${code})${
        polity.aliases?.length > 0 ? ` — also known as ${polity.aliases.join(", ")}` : ""
      }`,
    );
    if (polity.note) lines.push(`Notes: ${polity.note}`);
  }

  const overrides = Object.entries(world.regionOwnershipOverrides ?? {});
  const owned = code ? overrides.filter(([, owner]) => owner === code) : [];
  if (owned.length > 0) {
    const regionCatalog = await loadRegionCatalog();
    const regionLookup = new Map(regionCatalog.map((region) => [region.id, region]));
    const names = owned.slice(0, 40).map(([regionId]) => {
      const region = regionLookup.get(regionId);
      return region ? `${region.name}${region.country ? ` (${region.country})` : ""}` : regionId;
    });
    lines.push(
      `Territory: holds ${owned.length} regions${owned.length > names.length ? ", including" : ""}: ${names.join(", ")}${
        owned.length > names.length ? ", …" : ""
      }`,
    );
  } else if (code) {
    lines.push(
      overrides.length > 0
        ? `Territory: no regions on the current map are recorded as held by ${code}.`
        : `Territory: holds its modern-day territory (no territorial changes recorded).`,
    );
  }

  const units = normalizeArray(bundle.world?.units).filter((unit) => unit?.ownerCode === code);
  if (units.length > 0) {
    const byType = new Map();
    let strength = 0;
    for (const unit of units) {
      byType.set(unit.type, (byType.get(unit.type) || 0) + 1);
      strength += Number(unit.strength) || 0;
    }
    const composition = Array.from(byType.entries()).map(([type, n]) => `${n} ${type}`).join(", ");
    lines.push(`Deployed forces: ${units.length} units (${composition}), combined strength ${strength}.`);
  } else {
    lines.push("Deployed forces: none currently on the map.");
  }

  return lines.join("\n");
};

const canonicalStatsPolity = (token, world) => {
  const text = normalizeString(token);
  if (!text) return "";
  const resolved = resolvePolityIdentity(text, world, {
    allowUnknown: true,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return normalizeString(resolved?.resolved) || toCountryName(text) || text;
};

// ---------------------------------------------------------------------------
// Phase 7A.2 — bounded economic continuity evidence
// ---------------------------------------------------------------------------
// This is deliberately cheap/native: no extra AI call, no whole-history semantic
// scan. Stats reassessment sees at most a small recent target-specific evidence
// packet, while the persistent continuity ledger prevents already-accounted events
// from being applied twice.
const STATS_ECONOMIC_EVENT_SCAN_LIMIT = 64;
const STATS_ECONOMIC_EVIDENCE_LIMIT = 12;
const STATS_ACCOUNTED_EVENT_LIMIT = 64;

const ECONOMIC_EVENT_PATTERN = /\b(?:tax|taxation|levy|budget|fiscal|deficit|surplus|debt|bond|loan|credit|bank|banking|currency|monetary|inflation|unemployment|recession|depression|boom|growth|trade|tariff|customs|sanction|blockade|shortage|harvest|famine|food|coal|oil|energy|industry|industrial|factory|rail|railway|infrastructure|subsid|spending|appropriation|finance|financial|wage|strike|mobiliz|war finance|occupation|annex|cession|reparat|investment|export|import)\b/i;

const stableStatsHash = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};


const STATS_MACRO_MAX_BUCKETS = 12;
const STATS_MACRO_TARGET_COMPONENTS = 30;
const STATS_MACRO_SAMPLE_NAMES = 10;

// 8B.2.18.1 performance: detailed scenario GeoJSON is immutable for the life of
// the loaded object, so normalize its 4k+ feature records only once. WeakMap keeps
// scenario swaps safe: a new parsed FeatureCollection gets a new cache entry and
// the old one can be collected naturally.

// Long native territorial scans must not monopolize the browser main thread. The
// Stats pipeline is async already, so yield between bounded chunks and let map/UI
// rendering, input, and DevTools breathe while a large polity is prepared.
const throwIfAborted = (signal, label = "Background task cancelled.") => {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException(label, "AbortError");
};

const yieldToUiFrame = async (signal) => {
  throwIfAborted(signal);

  // scheduler.yield() is explicitly designed to let higher-priority UI/input work
  // run before this continuation. requestAnimationFrame + setTimeout is the portable
  // fallback and guarantees at least one paint opportunity before heavy work resumes.
  if (globalThis?.scheduler?.yield) {
    await globalThis.scheduler.yield();
  } else if (typeof requestAnimationFrame === "function") {
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0))
    );
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throwIfAborted(signal);
};

const statsYieldToMainThread = (signal) => yieldToUiFrame(signal);

// R2.33 — actual browser background thread.
//
// Native World Director is pure CPU analysis: no canonical writes and no AI call.
// Run that several-second computation in a module Worker. The main game waits for
// the result asynchronously while MapLibre/input continue receiving frames.
let worldDirectorWorker = null;
let worldDirectorWorkerBroken = false;
let worldDirectorRequestId = 0;
const worldDirectorPending = new Map();

const getWorldDirectorWorker = () => {
  if (worldDirectorWorkerBroken || typeof Worker === "undefined") return null;
  if (worldDirectorWorker) return worldDirectorWorker;

  try {
    const worker = new Worker(
      new URL("./worldDirectorWorker.js", import.meta.url),
      { type: "module", name: "openhistoria-world-director" },
    );

    worker.onmessage = (event) => {
      const id = Number(event?.data?.id);
      const pending = worldDirectorPending.get(id);
      if (!pending) return;
      worldDirectorPending.delete(id);

      if (event?.data?.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event?.data?.result);
    };

    worker.onerror = (event) => {
      worldDirectorWorkerBroken = true;
      for (const pending of worldDirectorPending.values()) {
        pending.reject(new Error(event?.message || "Native World Director worker failed."));
      }
      worldDirectorPending.clear();
      worker.terminate();
      worldDirectorWorker = null;
    };

    worldDirectorWorker = worker;
    return worker;
  } catch {
    worldDirectorWorkerBroken = true;
    return null;
  }
};

const buildWorldInitiativeContextBackground = async (bundle, options = {}, signal) => {
  throwIfAborted(signal);
  const worker = getWorldDirectorWorker();

  if (!worker) {
    await yieldToUiFrame(signal);
    return buildWorldInitiativeContext(bundle, options);
  }

  const id = ++worldDirectorRequestId;

  try {
    return await new Promise((resolve, reject) => {
      const abort = () => {
        worldDirectorPending.delete(id);
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("World Director cancelled.", "AbortError"),
        );
      };

      if (signal?.aborted) {
        abort();
        return;
      }

      worldDirectorPending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener?.("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener?.("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener?.("abort", abort, { once: true });
      worker.postMessage({ id, bundle, options });
    });
  } catch (error) {
    if (signal?.aborted) throw error;

    worldDirectorWorkerBroken = true;
    worldDirectorWorker?.terminate?.();
    worldDirectorWorker = null;
    console.warn(
      "[OH PERF] Native World Director worker unavailable; using main-thread fallback.",
      error,
    );
    await yieldToUiFrame(signal);
    return buildWorldInitiativeContext(bundle, options);
  }
};

// R2.35 — dedicated new-country Stats CPU lane.
//
// This worker owns ONLY deterministic preparation (territorial accounting + dossier).
// The canonical world remains owned by the normal runtime seam, and the existing AI
// call remains exactly one request for exactly the selected country.
let countryStatsWorker = null;
let countryStatsWorkerBroken = false;
let countryStatsWorkerRequestId = 0;
const countryStatsWorkerPending = new Map();

const resetCountryStatsWorker = ({ broken = false, reason = null } = {}) => {
  if (broken) countryStatsWorkerBroken = true;
  countryStatsWorker?.terminate?.();
  countryStatsWorker = null;

  for (const pending of countryStatsWorkerPending.values()) {
    pending.reject(
      reason instanceof Error
        ? reason
        : new DOMException("Country Stats worker stopped.", "AbortError"),
    );
  }
  countryStatsWorkerPending.clear();
};

const getCountryStatsWorker = () => {
  if (countryStatsWorkerBroken || typeof Worker === "undefined") return null;
  if (countryStatsWorker) return countryStatsWorker;

  try {
    const worker = new Worker(
      new URL("./countryStatsWorker.js", import.meta.url),
      { type: "module", name: "openhistoria-country-stats" },
    );

    worker.onmessage = (event) => {
      const id = Number(event?.data?.id);
      const pending = countryStatsWorkerPending.get(id);
      if (!pending) return;
      countryStatsWorkerPending.delete(id);

      if (event?.data?.error) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve({
          ...event?.data?.result,
          workerTimings:
            event?.data?.timings && typeof event.data.timings === "object"
              ? event.data.timings
              : {},
        });
      }
    };

    worker.onerror = (event) => {
      resetCountryStatsWorker({
        broken: true,
        reason: new Error(event?.message || "Country Stats worker failed."),
      });
    };

    countryStatsWorker = worker;
    return worker;
  } catch {
    countryStatsWorkerBroken = true;
    return null;
  }
};

const buildCountryStatsPreparationBackground = async (
  bundle,
  code,
  normalizedWorld,
  { signal, forceReassess = false } = {},
) => {
  throwIfAborted(signal);

  // R2.39: do NOT prepare or clone the scenario/world payload on the UI thread.
  // The worker fetches/parses its own runtime JSON using the active tokenized URLs.
  throwIfAborted(signal);
  const worker = getCountryStatsWorker();

  if (!worker) {
    await yieldToUiFrame(signal);
    const territorialBasis = await buildTargetStatsTerritorialBasis(
      bundle,
      code,
      normalizedWorld,
      { signal },
    );
    const dossier = await buildTargetDossier(bundle, code, normalizedWorld);
    return {
      territorialBasis,
      dossier,
      workerElapsed: 0,
      source: "main-thread-fallback",
    };
  }

  const id = ++countryStatsWorkerRequestId;
  const startedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  try {
    const result = await new Promise((resolve, reject) => {
      const abort = () => {
        countryStatsWorkerPending.delete(id);

        // There is only one active Stats generation job in the UI. Terminating the
        // worker is the only way to PREEMPT a CPU-bound request immediately rather
        // than waiting for its synchronous loop to finish before a cancel message can
        // be processed. The next country lazily receives a fresh worker.
        resetCountryStatsWorker({
          broken: false,
          reason:
            signal?.reason instanceof Error
              ? signal.reason
              : new DOMException("Country Stats calculation cancelled.", "AbortError"),
        });

        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("Country Stats calculation cancelled.", "AbortError"),
        );
      };

      if (signal?.aborted) {
        abort();
        return;
      }

      countryStatsWorkerPending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener?.("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener?.("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener?.("abort", abort, { once: true });

      // Send only the normalized state the deterministic planner actually reads.
      // No map geometry and no chat archive.
      const enqueueStartedAt =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();

      worker.postMessage({
        type: "prepare",
        id,
        payload: {
          code,
          forceReassess: Boolean(forceReassess),
          urls: {
            world: JSON_URLS.world,
            events: JSON_URLS.events,
            game: JSON_URLS.game,
            regionsGeojson: JSON_URLS.regionsGeojson,
          },
        },
      });

      const enqueueElapsed =
        (typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now()) - enqueueStartedAt;

      if (enqueueElapsed >= 8) {
        console.info(
          `[stats worker R2.39] ${code}: tiny request enqueue ${enqueueElapsed.toFixed(1)} ms.`,
        );
      }
    });

    throwIfAborted(signal);

    const endedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    const workerTimings = result?.workerTimings || {};
    console.info(
      `[stats worker R2.39] ${code}: ` +
      `wall ${(endedAt - startedAt).toFixed(1)} ms; ` +
      `worker load ${Number(workerTimings.load || 0).toFixed(1)} ms; ` +
      `worker compute+semantic-middle ${Number(workerTimings.compute || 0).toFixed(1)} ms; ` +
      `worker total ${Number(workerTimings.total || 0).toFixed(1)} ms.`,
    );

    return {
      ...result,
      source: "worker-self-loading",
    };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;

    console.warn(
      "[OH PERF] Country Stats worker unavailable/self-load failed; using cooperative main-thread fallback.",
      error,
    );
    resetCountryStatsWorker({ broken: true, reason: error });

    await yieldToUiFrame(signal);
    const territorialBasis = await buildTargetStatsTerritorialBasis(
      bundle,
      code,
      normalizedWorld,
      { signal },
    );
    const dossier = await buildTargetDossier(bundle, code, normalizedWorld);
    return {
      territorialBasis,
      dossier,
      workerElapsed: 0,
      source: "main-thread-fallback",
    };
  }
};

const persistCountryStatsBackground = async ({
  code,
  sheet,
  continuity,
  date,
  round,
  signal,
} = {}) => {
  throwIfAborted(signal);
  const worker = getCountryStatsWorker();
  if (!worker) return null;

  const id = ++countryStatsWorkerRequestId;
  const startedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  const result = await new Promise((resolve, reject) => {
    const abort = () => {
      countryStatsWorkerPending.delete(id);
      resetCountryStatsWorker({
        broken: false,
        reason:
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("Country Stats persistence cancelled.", "AbortError"),
      });
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Country Stats persistence cancelled.", "AbortError"),
      );
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    countryStatsWorkerPending.set(id, {
      resolve: (value) => {
        signal?.removeEventListener?.("abort", abort);
        resolve(value);
      },
      reject: (error) => {
        signal?.removeEventListener?.("abort", abort);
        reject(error);
      },
    });
    signal?.addEventListener?.("abort", abort, { once: true });

    const enqueueStartedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    worker.postMessage({
      type: "persist",
      id,
      payload: {
        code,
        sheet,
        continuity,
        date,
        round,
        urls: { world: JSON_URLS.world },
      },
    });

    const enqueueElapsed =
      (typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()) - enqueueStartedAt;

    if (enqueueElapsed >= 8) {
      console.info(
        `[stats persist R2.40] ${code}: small commit enqueue ${enqueueElapsed.toFixed(1)} ms.`,
      );
    }
  });

  throwIfAborted(signal);
  const endedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const timings = result?.workerTimings || {};

  console.info(
    `[stats persist R2.40] ${code}: ` +
    `wall ${(endedAt - startedAt).toFixed(1)} ms; ` +
    `worker stringify ${Number(timings.stringify || 0).toFixed(1)} ms; ` +
    `PUT/read ${Number(timings.putAndRead || 0).toFixed(1)} ms; ` +
    `echo parse ${Number(timings.echoParse || 0).toFixed(1)} ms; ` +
    `worker total ${Number(timings.totalWall || timings.total || 0).toFixed(1)} ms.`,
  );

  return result;
};

const createUiBudget = (milliseconds = 6) => {
  let sliceStartedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  return async (signal) => {
    const now =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    if (now - sliceStartedAt < milliseconds) {
      throwIfAborted(signal);
      return;
    }
    await yieldToUiFrame(signal);
    sliceStartedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
  };
};

const statsVerboseTerritoryDebugEnabled = () => {
  try {
    return Boolean(globalThis?.__OH_STATS_DEBUG_FULL_TERRITORY__);
  } catch {
    return false;
  }
};

const statsSphericalVector = (lng, lat) => {
  const lon = (Number(lng) || 0) * Math.PI / 180;
  const phi = (Number(lat) || 0) * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lon), cosPhi * Math.sin(lon), Math.sin(phi)];
};

const statsVectorDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const statsVectorNormalize = (value) => {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
};
const statsVectorLngLat = (value) => {
  const unit = statsVectorNormalize(value);
  return {
    lng: Math.atan2(unit[1], unit[0]) * 180 / Math.PI,
    lat: Math.asin(Math.max(-1, Math.min(1, unit[2]))) * 180 / Math.PI,
  };
};

const statsRegionHeuristicWeight = ({ tags = [], type = "" } = {}) => {
  const lowered = new Set(normalizeArray(tags).map((tag) => normalizeString(tag).toLowerCase()).filter(Boolean));
  const typeKey = normalizeString(type).toLowerCase();
  let weight = 1;
  if ([...lowered].some((tag) => tag.includes("capital"))) weight *= 4;
  else if ([...lowered].some((tag) => tag.includes("metro") || tag.includes("city") || tag.includes("urban"))) weight *= 2.5;
  if ([...lowered].some((tag) => tag.includes("desert"))) weight *= 0.5;
  if ([...lowered].some((tag) => tag.includes("mountain") || tag.includes("hill"))) weight *= 0.8;
  if ([...lowered].some((tag) => tag.includes("jungle"))) weight *= 0.75;
  if (typeKey.includes("island")) weight *= 0.8;
  return Math.max(0.1, weight);
};

const buildStatsMacroPlan = (plannedRows = []) => {
  const rows = normalizeArray(plannedRows)
    .map((row, index) => {
      const geography = normalizeString(row?.geography || row?.baseGeography);
      if (!geography) return null;
      const hasLng = row?.lng !== null && row?.lng !== undefined && row?.lng !== "";
      const hasLat = row?.lat !== null && row?.lat !== undefined && row?.lat !== "";
      const lng = Number(row?.lng);
      const lat = Number(row?.lat);
      const hasPoint = hasLng && hasLat && Number.isFinite(lng) && Number.isFinite(lat);
      return {
        sourceIndex: index,
        index: Number(row?.index) || index + 1,
        geography,
        lng: hasPoint ? lng : ((index * 137.508) % 360) - 180,
        lat: hasPoint ? lat : 0,
        weight: Math.max(0.1, Number(row?.weight) || 1),
        vector: statsSphericalVector(hasPoint ? lng : ((index * 137.508) % 360) - 180, hasPoint ? lat : 0),
        regionIds: normalizeArray(row?.regions).map((region) => normalizeString(region?.id)).filter(Boolean),
        adjacencyIds: normalizeArray(row?.regions).flatMap((region) => normalizeArray(region?.adjacencies).map(normalizeString)).filter(Boolean),
      };
    })
    .filter(Boolean);
  if (!rows.length) return [];

  const clusterSpatially = (subset, bucketCount) => {
    if (!subset.length) return [];
    const count = Math.max(1, Math.min(bucketCount, subset.length));
    if (count === 1) {
      const vector = subset.reduce((sum, row) => [
        sum[0] + row.vector[0] * row.weight,
        sum[1] + row.vector[1] * row.weight,
        sum[2] + row.vector[2] * row.weight,
      ], [0, 0, 0]);
      return [{ members: subset, ...statsVectorLngLat(vector) }];
    }

    const centers = [];
    let first = subset[0];
    for (const row of subset) {
      if (row.weight > first.weight || (row.weight === first.weight && row.geography.localeCompare(first.geography) < 0)) first = row;
    }
    centers.push(first.vector);
    while (centers.length < count) {
      let choice = null;
      let choiceScore = -Infinity;
      for (const row of subset) {
        let nearestDistance = Infinity;
        for (const center of centers) {
          const distance = 1 - Math.max(-1, Math.min(1, statsVectorDot(row.vector, center)));
          if (distance < nearestDistance) nearestDistance = distance;
        }
        const score = nearestDistance * Math.sqrt(row.weight);
        if (score > choiceScore || (score === choiceScore && row.geography.localeCompare(choice?.geography || "") < 0)) {
          choice = row;
          choiceScore = score;
        }
      }
      centers.push(choice?.vector || subset[centers.length % subset.length].vector);
    }

    let assignments = new Array(subset.length).fill(0);
    for (let iteration = 0; iteration < 5; iteration += 1) {
      assignments = subset.map((row) => {
        let best = 0;
        let bestDot = -Infinity;
        for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
          const similarity = statsVectorDot(row.vector, centers[centerIndex]);
          if (similarity > bestDot) {
            bestDot = similarity;
            best = centerIndex;
          }
        }
        return best;
      });
      for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
        const members = subset.filter((_, rowIndex) => assignments[rowIndex] === centerIndex);
        if (!members.length) continue;
        const vector = members.reduce((sum, row) => [
          sum[0] + row.vector[0] * row.weight,
          sum[1] + row.vector[1] * row.weight,
          sum[2] + row.vector[2] * row.weight,
        ], [0, 0, 0]);
        centers[centerIndex] = statsVectorNormalize(vector);
      }
    }
    return centers.map((center, centerIndex) => ({
      members: subset.filter((_, rowIndex) => assignments[rowIndex] === centerIndex),
      ...statsVectorLngLat(center),
    })).filter((bucket) => bucket.members.length);
  };

  // Preserve major disconnected territorial blocks before spatial clustering.
  // This prevents a nearby colony (e.g. North Africa) from being blended into the
  // metropole merely because a global k-means center falls across the sea.
  const rowByRegionId = new Map();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const id of rows[rowIndex].regionIds) rowByRegionId.set(id, rowIndex);
  }
  const graph = rows.map(() => new Set());
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const adjacentId of rows[rowIndex].adjacencyIds) {
      const other = rowByRegionId.get(adjacentId);
      if (other == null || other === rowIndex) continue;
      graph[rowIndex].add(other);
      graph[other].add(rowIndex);
    }
  }
  const visited = new Set();
  const connected = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (visited.has(rowIndex)) continue;
    const queue = [rowIndex];
    visited.add(rowIndex);
    const memberIndexes = [];
    while (queue.length) {
      const current = queue.shift();
      memberIndexes.push(current);
      for (const next of graph[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    connected.push(memberIndexes.map((index) => rows[index]));
  }

  const majorCandidates = connected.filter((component) => component.length >= 4).sort((a, b) => b.length - a.length);
  const originalTinyRows = connected.filter((component) => component.length < 4).flat();
  const reserveForTiny = originalTinyRows.length || majorCandidates.length > STATS_MACRO_MAX_BUCKETS ? 1 : 0;
  const majorLimit = Math.max(0, STATS_MACRO_MAX_BUCKETS - reserveForTiny);
  const major = majorCandidates.slice(0, majorLimit);
  const tinyRows = [
    ...originalTinyRows,
    ...majorCandidates.slice(majorLimit).flat(),
  ];
  const baseDesired = Math.max(1, Math.min(STATS_MACRO_MAX_BUCKETS, Math.ceil(rows.length / STATS_MACRO_TARGET_COMPONENTS)));
  const tinyCapacity = Math.max(0, STATS_MACRO_MAX_BUCKETS - major.length);
  const tinyMinimum = tinyRows.length ? Math.min(tinyCapacity, 3, Math.ceil(tinyRows.length / 10)) : 0;
  const minimumForLandmasses = major.length + tinyMinimum;
  const desired = Math.max(1, Math.min(STATS_MACRO_MAX_BUCKETS, Math.max(baseDesired, minimumForLandmasses)));

  const allocations = major.map(() => 1);
  let tinyAllocation = tinyMinimum;
  let remaining = desired - allocations.reduce((sum, value) => sum + value, 0) - tinyAllocation;
  while (remaining > 0) {
    let bestType = "major";
    let bestIndex = -1;
    let bestPressure = tinyRows.length && tinyAllocation > 0 ? tinyRows.length / tinyAllocation : -1;
    for (let index = 0; index < major.length; index += 1) {
      const pressure = major[index].length / allocations[index];
      if (pressure > bestPressure) {
        bestPressure = pressure;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) allocations[bestIndex] += 1;
    else if (tinyRows.length) tinyAllocation += 1;
    else break;
    remaining -= 1;
  }

  const buckets = [];
  major.forEach((component, index) => buckets.push(...clusterSpatially(component, allocations[index])));
  if (tinyRows.length && tinyAllocation > 0) {
    buckets.push(...clusterSpatially(tinyRows, tinyAllocation));
  } else if (tinyRows.length && buckets.length) {
    // Pathological case with more major disconnected landmasses than the hard
    // macro cap: retain the cap and attach overflow rows to their nearest bucket.
    for (const row of tinyRows) {
      let nearest = buckets[0];
      let best = -Infinity;
      for (const bucket of buckets) {
        const center = statsSphericalVector(bucket.lng, bucket.lat);
        const similarity = statsVectorDot(row.vector, center);
        if (similarity > best) {
          best = similarity;
          nearest = bucket;
        }
      }
      nearest.members.push(row);
    }
  }
  if (!buckets.length) buckets.push(...clusterSpatially(rows, desired));

  buckets.sort((a, b) => b.lat - a.lat || a.lng - b.lng || a.members[0].geography.localeCompare(b.members[0].geography));
  return buckets.map((bucket, index) => ({ index: index + 1, ...bucket }));
};

const buildStatsMacroContext = (macroPlan = []) => normalizeArray(macroPlan).map((bucket) => {
  const center = statsVectorLngLat(statsSphericalVector(bucket?.lng, bucket?.lat));
  const members = normalizeArray(bucket?.members);
  const samples = [...members]
    .sort((a, b) => b.weight - a.weight || a.geography.localeCompare(b.geography))
    .slice(0, STATS_MACRO_SAMPLE_NAMES)
    .map((member) => member.geography);
  return `[M${bucket.index}] ${members.length} live component(s); center ${Math.abs(center.lat).toFixed(1)}°${center.lat >= 0 ? "N" : "S"}, ${Math.abs(center.lng).toFixed(1)}°${center.lng >= 0 ? "E" : "W"}; representative places: ${samples.join(", ")}`;
}).join("\n");

const buildStatsPreviousMacroContext = (previous, macroPlan = []) => {
  const byGeography = new Map(normalizeArray(previous?.territorialComponents).map((component) => [normalizeString(component?.geography).toLowerCase(), component]));
  const lines = [];
  for (const bucket of normalizeArray(macroPlan)) {
    const components = normalizeArray(bucket?.members)
      .map((member) => byGeography.get(normalizeString(member?.geography).toLowerCase()))
      .filter(Boolean);
    if (!components.length) continue;
    const population = components.reduce((sum, component) => sum + Math.max(0, Number(component?.population) || 0), 0);
    const gdp = components.reduce((sum, component) => sum + Math.max(0, Number(component?.population) || 0) * Math.max(0, Number(component?.gdpPerCapita) || 0), 0);
    const groups = new Map();
    for (const component of components) groups.set(component.group, (groups.get(component.group) || 0) + Math.max(0, Number(component.population) || 0));
    const group = [...groups.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "core";
    lines.push(`[M${bucket.index}] group=${group}; population=${Math.round(population)}; gdpPerCapita=${population > 0 ? Math.round(gdp / population) : 0}; matched=${components.length}/${normalizeArray(bucket.members).length}`);
  }
  return lines.join("\n");
};

const statsDateMillis = (value) => {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const time = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return Number.isFinite(time) ? time : null;
};

const statsElapsedYears = (fromDate, toDate) => {
  const from = statsDateMillis(fromDate);
  const to = statsDateMillis(toDate);
  if (from == null || to == null || to <= from) return 0;
  return (to - from) / (365.2425 * 86400000);
};

const statsPolityAliases = (world, canonicalName) => {
  const values = new Set([normalizeString(canonicalName)]);
  const target = normalizeString(canonicalName).toLowerCase();
  for (const [key, polity] of Object.entries(world?.polityOverrides || {})) {
    const candidates = [key, polity?.code, polity?.name, ...normalizeArray(polity?.aliases)]
      .map(normalizeString)
      .filter(Boolean);
    const belongs = candidates.some((candidate) => {
      const resolved = canonicalStatsPolity(candidate, world);
      return normalizeString(resolved).toLowerCase() === target;
    });
    if (belongs) candidates.forEach((candidate) => values.add(candidate));
  }
  return [...values].filter(Boolean);
};

const STATS_GENERIC_POLITY_WORDS = new Set([
  "empire", "kingdom", "republic", "state", "states", "federation", "federal",
  "union", "united", "people", "peoples", "grand", "duchy", "commonwealth",
]);

const statsTextMentionsTarget = (textValue, aliases) => {
  const text = normalizeString(textValue).toLowerCase();
  if (!text) return false;

  for (const alias of aliases) {
    const phrase = normalizeString(alias).toLowerCase();
    if (phrase.length >= 4 && text.includes(phrase)) return true;
    const tokens = phrase
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/[\s-]+/)
      .filter((token) => token.length >= 5 && !STATS_GENERIC_POLITY_WORDS.has(token));
    for (const token of tokens) {
      if (text.includes(token)) return true;
      // Conservative adjective/name-family bridge: Germany/German,
      // Russia/Russian, Austria/Austrian, Serbia/Serbian, etc.
      if (token.length >= 6 && text.includes(token.slice(0, 5))) return true;
    }
  }
  return false;
};

const buildTargetEconomicEvidence = ({ bundle, statCode, previous, normalizedWorld = null }) => {
  const world = normalizedWorld || normalizeWorldState(bundle?.world);
  const target = canonicalStatsPolity(statCode, world) || normalizeString(statCode);
  const targetKey = target.toLowerCase();
  const aliases = statsPolityAliases(world, target);
  const accounted = new Set(
    normalizeArray(previous?.continuity?.accountedEventIds)
      .map(normalizeString)
      .filter(Boolean),
  );

  const sameTarget = (token) => {
    const resolved = canonicalStatsPolity(token, world);
    return normalizeString(resolved).toLowerCase() === targetKey;
  };

  const recent = normalizeEvents(bundle?.events).slice(-STATS_ECONOMIC_EVENT_SCAN_LIMIT);
  const relevant = [];

  for (const event of recent) {
    const id = normalizeString(event?.id);
    if (!id) continue;
    const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};

    const statImpact = normalizeArray(impacts.polityChanges).some((change) =>
      change?.stats && sameTarget(change?.code || change?.name));
    const legalTerritoryImpact = normalizeArray(impacts.regionTransfers).some((transfer) =>
      sameTarget(transfer?.fromCode) || sameTarget(transfer?.toCode));
    const controlImpact = normalizeArray(impacts.regionControlOps).some((op) =>
      sameTarget(op?.fromCode) || sameTarget(op?.toCode) || sameTarget(op?.actorCode) || sameTarget(op?.claimantCode));
    const combatant = normalizeArray(event?.combatants).some(sameTarget);
    const mentioned = statsTextMentionsTarget(prose, aliases);
    const economicCue = ECONOMIC_EVENT_PATTERN.test(prose);

    if (!(statImpact || legalTerritoryImpact || (economicCue && (mentioned || controlImpact || combatant)))) {
      continue;
    }

    relevant.push({
      id,
      date: normalizeString(event?.date),
      title: normalizeString(event?.title) || "Economic development",
      description: normalizeString(event?.description),
      importance: normalizeString(event?.importance),
      directStatImpact: statImpact,
      legalTerritoryImpact,
    });
  }

  const unaccounted = relevant.filter((event) => !accounted.has(event.id));
  const selectedFresh = unaccounted.slice(-STATS_ECONOMIC_EVIDENCE_LIMIT);
  const deferredCount = Math.max(0, unaccounted.length - selectedFresh.length);
  const lines = selectedFresh.map((event) => {
    const detail = event.description.length > 360
      ? `${event.description.slice(0, 359).trimEnd()}…`
      : event.description;
    const flags = [
      event.directStatImpact ? "event carries explicit stats impact" : "",
      event.legalTerritoryImpact ? "legal-territory change" : "",
    ].filter(Boolean).join(", ");
    return `- [${event.id}] ${event.date || "undated"} — ${event.title}${flags ? ` [${flags}]` : ""}${detail ? `: ${detail}` : ""}`;
  });
  if (deferredCount > 0) {
    lines.unshift(`- ${deferredCount} earlier fresh relevant economic event(s) are intentionally deferred by the bounded evidence window; do not invent their details.`);
  }

  return {
    text: lines.join("\n"),
    relevantIds: relevant.map((event) => event.id).slice(-STATS_ACCOUNTED_EVENT_LIMIT),
    selectedFreshIds: selectedFresh.map((event) => event.id),
    unaccountedCount: unaccounted.length,
  };
};


const TRACKED_STATS_BATCH_VERSION = "8B.3.1";
const TRACKED_STATS_RECENT_EVENT_LIMIT = 8;
const TRACKED_STATS_SCAN_LIMIT = 80;

const compactTrackedStatsSheet = (sheetInput) => {
  const sheet = finalizeCountryStatSheet(sheetInput);
  if (!sheet) return null;
  return {
    stability: Number(sheet.stability),
    indices: {
      sovereignty: Number(sheet.indices?.sovereignty),
      foodAutonomy: Number(sheet.indices?.foodAutonomy),
      energyAutonomy: Number(sheet.indices?.energyAutonomy),
      economicIndependence: Number(sheet.indices?.economicIndependence),
      internalSecurity: Number(sheet.indices?.internalSecurity),
      internationalReputation: Number(sheet.indices?.internationalReputation),
    },
    population: {
      total: Number(sheet.population?.total),
      coreIntegrated: Number(sheet.population?.coreIntegrated),
      otherTerritories: Number(sheet.population?.otherTerritories),
    },
    economy: {
      gdp: Number(sheet.economy?.gdp),
      gdpPerCapita: Number(sheet.economy?.gdpPerCapita),
      gdpGrowth: Number(sheet.economy?.gdpGrowth),
      inflation: Number(sheet.economy?.inflation),
      unemployment: Number(sheet.economy?.unemployment),
      publicDebt: Number(sheet.economy?.publicDebt),
      budgetBalance: Number(sheet.economy?.budgetBalance),
      currency: normalizeString(sheet.economy?.currency),
    },
    gdpBreakdown: {
      agriculture: Number(sheet.gdpBreakdown?.agriculture),
      industry: Number(sheet.gdpBreakdown?.industry),
      services: Number(sheet.gdpBreakdown?.services),
    },
  };
};

const buildTrackedStatsNarrativeEvidence = ({ bundle, statCode, normalizedWorld }) => {
  const world = normalizedWorld || normalizeWorldState(bundle?.world);
  const aliases = statsPolityAliases(world, statCode);
  const targetKey = normalizeString(canonicalStatsPolity(statCode, world)).toLowerCase();

  const sameTarget = (value) =>
    normalizeString(canonicalStatsPolity(value, world)).toLowerCase() === targetKey;

  return normalizeEvents(bundle?.events)
    .slice(-TRACKED_STATS_SCAN_LIMIT)
    .filter((event) => {
      const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
      const directStats = normalizeArray(impacts.polityChanges)
        .some((change) => change?.stats && sameTarget(change?.code || change?.name));
      const territory = normalizeArray(impacts.regionTransfers)
        .some((change) => sameTarget(change?.fromCode) || sameTarget(change?.toCode));
      const control = normalizeArray(impacts.regionControlOps)
        .some((change) => sameTarget(change?.fromCode) || sameTarget(change?.toCode) || sameTarget(change?.actorCode));
      const combatant = normalizeArray(event?.combatants).some(sameTarget);
      const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
      return directStats || territory || control || combatant || statsTextMentionsTarget(prose, aliases);
    })
    .slice(-TRACKED_STATS_RECENT_EVENT_LIMIT)
    .map((event) => {
      const detail = normalizeString(event?.description);
      return `- ${normalizeString(event?.date) || "undated"} — ${normalizeString(event?.title) || "Untitled event"}${detail ? `: ${detail.slice(0, 320)}` : ""}`;
    })
    .join("\n");
};

const trackedStatsLatestHistoryDate = (world, polity) => {
  const rows = normalizeArray(world?.countryStatsHistory?.[polity]);
  return rows
    .map((row) => normalizeString(row?.date))
    .filter((date) => parseIsoDate(date))
    .sort()
    .at(-1) || "";
};

const sanitizeTrackedStatsPatch = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const percent = (raw) => {
    const number = Number(raw);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
  };
  const signed = (raw, min = -1000, max = 1000) => {
    const number = Number(raw);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
  };
  const positive = (raw) => {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? number : null;
  };

  const patch = {};
  const stability = percent(value.stability);
  if (stability != null) patch.stability = stability;

  const indices = {};
  for (const key of ["sovereignty", "foodAutonomy", "energyAutonomy", "economicIndependence", "internalSecurity", "internationalReputation"]) {
    const number = percent(value?.indices?.[key]);
    if (number != null) indices[key] = number;
  }
  if (Object.keys(indices).length) patch.indices = indices;

  const population = {};
  const totalPopulation = positive(value?.population?.total);
  if (totalPopulation != null) population.total = Math.round(totalPopulation);
  if (Object.keys(population).length) patch.population = population;

  const economy = {};
  const gdp = positive(value?.economy?.gdp);
  const gdpPerCapita = positive(value?.economy?.gdpPerCapita);
  if (gdp != null) economy.gdp = gdp;
  else if (gdpPerCapita != null) economy.gdpPerCapita = gdpPerCapita;
  for (const key of ["gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance"]) {
    const number = signed(value?.economy?.[key]);
    if (number != null) economy[key] = number;
  }
  if (Object.keys(economy).length) patch.economy = economy;

  const breakdown = {};
  for (const key of ["agriculture", "industry", "services"]) {
    const number = percent(value?.gdpBreakdown?.[key]);
    if (number != null) breakdown[key] = number;
  }
  if (Object.keys(breakdown).length === 3) patch.gdpBreakdown = breakdown;

  return Object.keys(patch).length ? patch : null;
};

const refreshTrackedCountryStatsIfDue = async ({
  bundle,
  signal,
} = {}) => {
  const game = normalizeGameData(bundle?.game);
  let world = normalizeWorldState(bundle?.world);
  const currentDate = normalizeString(game?.gameDate || game?.startDate);
  if (!parseIsoDate(currentDate)) return world;

  const tracking = normalizeCountryStatsTracking(world?.countryStatsTracking, {
    playerCountry: game?.country,
  });
  const intervalMonths = Number(tracking.intervalMonths) || 0;
  if (!intervalMonths || !tracking.trackedPolities.length) {
    if (world?.countryStatsTracking) world.countryStatsTracking = tracking;
    return world;
  }

  const due = [];
  const pendingBaseline = [];

  for (const rawPolity of tracking.trackedPolities.slice(0, COUNTRY_STATS_TRACKING_MAX_POLITIES)) {
    const polity = canonicalStatsPolity(rawPolity, world) || normalizeString(rawPolity);
    const previous = normalizeCountryStatSheet(world?.countryStats?.[polity]);
    if (!previous || !isCompleteCountryStatSheet(previous)) {
      pendingBaseline.push(polity);
      continue;
    }

    const lastAuto = normalizeString(tracking.lastAutoRefreshByPolity?.[polity]);
    const baselineDate =
      (parseIsoDate(lastAuto) && lastAuto) ||
      (parseIsoDate(previous?.continuity?.assessedDate) && normalizeString(previous.continuity.assessedDate)) ||
      trackedStatsLatestHistoryDate(world, polity) ||
      normalizeString(game?.startDate);

    if (countryStatsTrackingMonthsElapsed(baselineDate, currentDate) < intervalMonths) continue;

    const economic = buildTargetEconomicEvidence({
      bundle,
      statCode: polity,
      previous,
      normalizedWorld: world,
    });
    const narrative = buildTrackedStatsNarrativeEvidence({
      bundle,
      statCode: polity,
      normalizedWorld: world,
    });
    due.push({
      polity,
      previous,
      baselineDate,
      elapsedMonths: countryStatsTrackingMonthsElapsed(baselineDate, currentDate),
      economic,
      narrative,
    });
  }

  world.countryStatsTracking = normalizeCountryStatsTracking({
    ...tracking,
    pendingBaselinePolities: pendingBaseline,
  }, { playerCountry: game?.country });

  if (!due.length) return world;

  const systemPrompt = `You are Open Historia's bounded periodic national-statistics auditor.

You are refreshing EXISTING persistent country stat sheets for a running alternate-history campaign. This is a continuity update, NOT a fresh historical lookup and NOT a territorial rebase.

RULES:
- The supplied current sheet is canonical. Change it conservatively from that baseline.
- Respect the campaign date and supplied campaign evidence. Real-world outcomes after the campaign start are not automatically canonical.
- Absence of evidence is a strong reason for continuity, not a reason to reroll numbers.
- Current sheets may already include explicit event stat patches from this same turn. Do not double-apply those effects.
- Population and GDP should evolve plausibly over the elapsed interval. Keep GDP, population, GDP/capita, growth, inflation, unemployment, debt and budget balance mutually coherent.
- Strategic indices are 0..100 and should normally move gradually unless evidence clearly supports a shock.
- GDP sector shares must sum to 100 if supplied.
- Do not invent territorial changes. This lightweight periodic audit deliberately preserves the existing territorial component ledger.
- Return exactly one JSON object and no markdown/prose outside it.

OUTPUT:
{
  "updates": [
    {
      "country": "exact supplied canonical key",
      "stability": 0,
      "indices": {
        "sovereignty": 0,
        "foodAutonomy": 0,
        "energyAutonomy": 0,
        "economicIndependence": 0,
        "internalSecurity": 0,
        "internationalReputation": 0
      },
      "population": { "total": 0 },
      "economy": {
        "gdp": 0,
        "gdpPerCapita": 0,
        "gdpGrowth": 0,
        "inflation": 0,
        "unemployment": 0,
        "publicDebt": 0,
        "budgetBalance": 0
      },
      "gdpBreakdown": { "agriculture": 0, "industry": 0, "services": 0 }
    }
  ]
}

You may omit a field when the existing value should remain exactly unchanged.`;

  const userMessage = [
    `Campaign date: ${currentDate}`,
    `Periodic Stats batch version: ${TRACKED_STATS_BATCH_VERSION}`,
    "",
    ...due.flatMap((entry, index) => [
      `=== COUNTRY ${index + 1}: ${entry.polity} ===`,
      `Elapsed since last dedicated Stats audit: ${entry.elapsedMonths} month(s) (baseline ${entry.baselineDate || "unknown"}).`,
      `CURRENT CANONICAL SHEET:`,
      JSON.stringify(compactTrackedStatsSheet(entry.previous)),
      `FRESH TARGET-SPECIFIC ECONOMIC EVIDENCE:`,
      normalizeString(entry.economic?.text) || "None.",
      `RECENT RELEVANT CAMPAIGN CONTEXT:`,
      normalizeString(entry.narrative) || "None.",
      "",
    ]),
  ].join("\n");

  try {
    const response = await callAI(
      systemPrompt,
      [{ role: "user", parts: [{ text: userMessage }] }],
      {
        signal,
        reasoningEnabled: false,
        ...(getMapSetting(MAP_SETTING_KEYS.limitAiGeneration)
          ? { deadline: Date.now() + 90000 }
          : {}),
      },
    );
    const rawText = typeof response === "string"
      ? response
      : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);
    const updates = normalizeArray(parsed?.updates);
    const dueByKey = new Map(due.map((entry) => [entry.polity.toLocaleLowerCase(), entry]));

    let applied = 0;
    const refreshed = { ...(tracking.lastAutoRefreshByPolity || {}) };

    for (const update of updates) {
      const polity = canonicalStatsPolity(update?.country, world) || normalizeString(update?.country);
      const entry = dueByKey.get(polity.toLocaleLowerCase());
      if (!entry) continue;

      const patch = sanitizeTrackedStatsPatch(update);
      if (!patch) continue;

      const merged = mergeCountryStatPatch(entry.previous, patch, {
        continuity: {
          assessedDate: currentDate,
          assessedRound: Math.max(0, Math.trunc(Number(game?.round) || 0)),
          accountedEventIds: entry.economic?.relevantIds || [],
        },
      });
      const guarded = guardCountryStatContinuity(
        entry.previous,
        merged,
        {
          elapsedYears: Math.max(0, entry.elapsedMonths / 12),
          evidenceText: [entry.economic?.text, entry.narrative].filter(Boolean).join("\n"),
          territoryChanged: false,
        },
      )?.sheet || merged;

      if (!guarded || !isCompleteCountryStatSheet(guarded)) continue;

      world.countryStats = {
        ...(world.countryStats || {}),
        [entry.polity]: guarded,
      };
      const reputation = Number(guarded?.indices?.internationalReputation);
      if (Number.isFinite(reputation)) {
        world.internationalReputation = {
          ...(world.internationalReputation || {}),
          [entry.polity]: Math.max(0, Math.min(100, Math.round(reputation))),
        };
      }
      refreshed[entry.polity] = currentDate;
      applied += 1;
    }

    world.countryStatsTracking = normalizeCountryStatsTracking({
      ...tracking,
      lastAutoRefreshByPolity: refreshed,
      pendingBaselinePolities: pendingBaseline,
      lastBatchDate: applied > 0 ? currentDate : tracking.lastBatchDate,
    }, { playerCountry: game?.country });

    if (applied > 0) {
      console.info(
        `[stats auto ${TRACKED_STATS_BATCH_VERSION}] refreshed ${applied}/${due.length} due tracked countr${due.length === 1 ? "y" : "ies"} in one AI batch; ` +
        `${pendingBaseline.length} tracked countr${pendingBaseline.length === 1 ? "y needs" : "ies need"} a baseline.`,
      );
    } else {
      console.warn(
        `[stats auto ${TRACKED_STATS_BATCH_VERSION}] batch returned no usable tracked-country updates; completed world turn is preserved.`,
      );
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(
      `[stats auto ${TRACKED_STATS_BATCH_VERSION}] periodic tracked-country refresh failed; completed world turn is preserved.`,
      error,
    );
  }

  return world;
};

// 8B.2.18 — causal population calibration context.
//
// Population bootstrap/reconstruction needs bounded regional historical priors without
// turning same-date real history into an attractor. Feed the EXISTING countryStatSheet
// call the scenario author's own pre-game briefing, the
// canonical pre-game events that Round Zero produced, and bounded campaign checkpoints.
// The model can therefore distinguish "historical 1936 Germany" from "a 1936 Germany
// whose timeline diverged in 1917" without adding another AI/database layer.
const STATS_CALIBRATION_STARTING_TEXT_LIMIT = 5000;
const STATS_CALIBRATION_PREGAME_EVENT_LIMIT = 12;
const STATS_CALIBRATION_CAMPAIGN_EVENT_LIMIT = 16;
const STATS_CALIBRATION_HISTORY_LIMIT = 8;
const STATS_CALIBRATION_CONSOLIDATED_LIMIT = 10;
const STATS_DEMOGRAPHIC_CANON_PATTERN = /\b(?:war|battle|casualt|killed|deaths?|mortality|epidem|pandemic|disease|famine|starvation|refuge|migration|emigration|immigration|expulsion|deport|population|birth|annex|cession|partition|occupation|independence|secession|mobiliz|demobiliz|reconstruction|coloniz|settlement)\b/i;

const compactStatsCalibrationEvent = (event) => {
  const date = normalizeString(event?.date) || "undated";
  const title = normalizeString(event?.title) || "Untitled event";
  const description = normalizeString(event?.description);
  const detail = description.length > 240
    ? `${description.slice(0, 239).trimEnd()}…`
    : description;
  return `- ${date} — ${title}${detail ? `: ${detail}` : ""}`;
};

const buildStatsPopulationCalibrationCanon = ({ bundle, statCode, normalizedWorld = null } = {}) => {
  const world = normalizedWorld || normalizeWorldState(bundle?.world);
  const target = canonicalStatsPolity(statCode, world) || normalizeString(statCode);
  const targetKey = target.toLowerCase();
  const aliases = statsPolityAliases(world, target);
  const startDate = normalizeString(bundle?.game?.startDate || bundle?.game?.gameDate);
  const currentDate = normalizeString(bundle?.game?.gameDate || startDate);
  const events = normalizeEvents(bundle?.events);

  const sameTarget = (token) => {
    const resolved = canonicalStatsPolity(token, world);
    return normalizeString(resolved).toLowerCase() === targetKey;
  };

  const isBeforeStart = (event) => {
    if (normalizeString(event?.source).toLowerCase() === "pregame") return true;
    const eventDate = normalizeString(event?.date);
    const parsedEvent = parseIsoDate(eventDate);
    const parsedStart = parseIsoDate(startDate);
    if (parsedEvent && parsedStart) {
      return statsDateMillis(eventDate) < statsDateMillis(startDate);
    }
    return false;
  };

  const pregame = events
    .filter(isBeforeStart)
    .slice(-STATS_CALIBRATION_PREGAME_EVENT_LIMIT);

  const campaignRelevant = events
    .filter((event) => !isBeforeStart(event))
    .filter((event) => {
      const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
      const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
      const directStats = normalizeArray(impacts.polityChanges).some((change) =>
        change?.stats && sameTarget(change?.code || change?.name));
      const territory = normalizeArray(impacts.regionTransfers).some((transfer) =>
        sameTarget(transfer?.fromCode) || sameTarget(transfer?.toCode));
      const combatant = normalizeArray(event?.combatants).some(sameTarget);
      const mentioned = statsTextMentionsTarget(prose, aliases);
      return directStats || territory || combatant || (mentioned && STATS_DEMOGRAPHIC_CANON_PATTERN.test(prose)) ||
        STATS_DEMOGRAPHIC_CANON_PATTERN.test(prose) && /\b(?:pandemic|epidemic|global|worldwide)\b/i.test(prose);
    })
    .slice(-STATS_CALIBRATION_CAMPAIGN_EVENT_LIMIT);

  const startingTimelineText = normalizeString(world?.startingTimelineText);
  const historySummaries = normalizeArray(world?.simulationHistory)
    .map((entry) => {
      const rawSummary = normalizeString(entry?.summary);
      if (!rawSummary) return "";
      const summary = rawSummary.length > 600 ? `${rawSummary.slice(0, 599).trimEnd()}…` : rawSummary;
      const fromDate = normalizeString(entry?.fromDate);
      const toDate = normalizeString(entry?.toDate || entry?.date);
      const mode = normalizeString(entry?.mode);
      return `- ${fromDate || "?"}${toDate && toDate !== fromDate ? ` → ${toDate}` : ""}${mode ? ` [${mode}]` : ""}: ${summary}`;
    })
    .filter(Boolean)
    .slice(-STATS_CALIBRATION_HISTORY_LIMIT);

  // Consolidated history exists specifically to preserve old campaign divergences
  // after raw events fall out of bounded attention. Sample it across the whole
  // chronology, not merely from the tail, so a 1914 divergence still constrains a
  // 1936 hard audit even after decades of play.
  const consolidatedAll = normalizeArray(world?.consolidatedHistory)
    .map((entry) => {
      const rawSummary = normalizeString(entry?.summary);
      if (!rawSummary) return "";
      const summary = rawSummary.length > 700 ? `${rawSummary.slice(0, 699).trimEnd()}…` : rawSummary;
      const throughDate = normalizeString(entry?.throughDate);
      const round = Number(entry?.throughRound);
      return `- through ${throughDate || "?"}${Number.isFinite(round) ? ` (round ${Math.trunc(round)})` : ""}: ${summary}`;
    })
    .filter(Boolean);
  const consolidatedHistory = (() => {
    if (consolidatedAll.length <= STATS_CALIBRATION_CONSOLIDATED_LIMIT) return consolidatedAll;
    const selected = [];
    for (let index = 0; index < STATS_CALIBRATION_CONSOLIDATED_LIMIT; index += 1) {
      const sourceIndex = Math.round(
        index * (consolidatedAll.length - 1) / (STATS_CALIBRATION_CONSOLIDATED_LIMIT - 1),
      );
      selected.push(consolidatedAll[sourceIndex]);
    }
    return [...new Set(selected)];
  })();

  const blocks = [
    `Scenario start: ${startDate || "unknown"}. Current campaign date: ${currentDate || "unknown"}.`,
    "Use this canon to locate the latest genuinely shared historical frontier. A changed polity name, changed borders, a different war outcome, a surviving/dissolved regime, or any other supplied contradiction is evidence that later real-world history belongs to another timeline.",
  ];

  if (startingTimelineText) {
    blocks.push(
      `SCENARIO AUTHOR'S WORLD-BEFORE-ROUND-ONE BRIEFING (highest-priority pre-start canon):\n${startingTimelineText.slice(0, STATS_CALIBRATION_STARTING_TEXT_LIMIT)}`,
    );
  }
  if (pregame.length) {
    blocks.push(
      `CANONICAL PRE-GAME EVENTS (${pregame.length} shown):\n${pregame.map(compactStatsCalibrationEvent).join("\n")}`,
    );
  }
  if (consolidatedHistory.length) {
    blocks.push(
      `LONG-CAMPAIGN CONSOLIDATED CANON (${consolidatedHistory.length} chronological coverage samples):\n${consolidatedHistory.join("\n")}`,
    );
  }
  if (historySummaries.length) {
    blocks.push(
      `RECENT CAMPAIGN HISTORY CHECKPOINTS (${historySummaries.length} shown):\n${historySummaries.join("\n")}`,
    );
  }
  if (campaignRelevant.length) {
    blocks.push(
      `TARGET/DEMOGRAPHIC CAMPAIGN EVENTS AFTER START (${campaignRelevant.length} shown):\n${campaignRelevant.map(compactStatsCalibrationEvent).join("\n")}`,
    );
  }
  if (!startingTimelineText && !pregame.length) {
    blocks.push(
      "No explicit pre-start divergence text/events are available. Do NOT interpret that absence as proof that same-date real history is canonical: the live polity identity and authoritative territorial basis may themselves demonstrate an alternate scenario. If they materially conflict with real history, treat the divergence frontier as earlier/unknown and estimate forward from shared regional priors plus scenario state instead of copying a historical headline total.",
    );
  }

  return blocks.join("\n\n");
};

// Build a native legal-territory accounting basis for Stats. Unlike the old AIO,
// this does not scrape rendered DOM/map prose. We have direct access to the region
// catalog plus separate controller/sovereign ledgers, so temporary occupation can
// stay militarily real without being counted as national population/GDP.
// 7A.1.5: custom/hybrid regions can legitimately omit `country`. Resolve their
// provenance from countryCode when available; otherwise keep the exact region name
// as its own deterministic economic bucket. Never collapse unrelated blank-country
// regions into one fake "Unclassified" component.
const buildTargetStatsTerritorialBasis = async (bundle, code, normalizedWorld = null, { signal } = {}) => {
  const world = normalizedWorld || normalizeWorldState(bundle.world);
  const target = canonicalStatsPolity(code, world);
  if (!target) {
    return {
      context: "No target polity was resolved.",
      plan: [],
      macroPlan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  // 8B.2.14: Stats must use the SAME scenario geography that the player actually
  // sees. loadRegionCatalog() is deliberately broad: stock GADM rows are merged
  // with scenario/custom rows and its cache may outlive individual runtime fetches.
  // That is useful for name resolution, but it is not authoritative enough for
  // territorial accounting on hybrid maps. The rendered regionsGeojson is the
  // current map partition and therefore wins whenever it exists. Stock/merged
  // catalog data is retained only as a compatibility fallback for maps that do not
  // expose a rendered region FeatureCollection.
  // 8B.2.18.1 performance: the rendered scenario map is authoritative, so do
  // not eagerly load/merge the broad stock region catalog in parallel. That fallback
  // can be much larger than the active scenario and used to block Stats even when it
  // was immediately discarded.
  // R2.31 performance: never reopen / parse the giant scenario GeoJSON merely to
  // inspect another country's Stats. Nations already projects the exact rendered
  // scenario partition into a compact non-geometry catalog. Use that authoritative
  // projection directly; stock merged catalog remains fallback-only.
  const scenarioCatalog = await loadScenarioRegionCatalog({ force: false }).catch(() => []);

  const renderedCatalog = [];
  const yieldCatalogSlice = createUiBudget(5);
  for (const region of normalizeArray(scenarioCatalog)) {
    const id = normalizeString(region?.id);
    const name = normalizeString(region?.name) || id;

    if (id && name) {
      const countryCode = normalizeString(region?.countryCode);
      const mappedCountryCode = countryCode
        ? normalizeString(toCountryName(countryCode))
        : "";
      const resolvedCodeGeography =
        mappedCountryCode && mappedCountryCode.toLowerCase() !== countryCode.toLowerCase()
          ? mappedCountryCode
          : "";

      const country = normalizeString(region?.country);
      const baseGeography = country || resolvedCodeGeography || name || id;
      const baseOwner = country || resolvedCodeGeography || mappedCountryCode || "";

      renderedCatalog.push({
        id,
        name,
        countryCode,
        baseGeography,
        baseOwner,
        lng: Number.isFinite(Number(region?.lng)) ? Number(region.lng) : null,
        lat: Number.isFinite(Number(region?.lat)) ? Number(region.lat) : null,
        weight: statsRegionHeuristicWeight({ tags: region?.tags, type: region?.type }),
        adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
      });
    }

    // Previous cooperative code began only AFTER this 4,390-row projection.
    await yieldCatalogSlice(signal);
  }

  const mergedCatalog = renderedCatalog.length
    ? []
    : await loadRegionCatalog({ force: false }).catch(() => []);

  const fallbackCatalog = normalizeArray(mergedCatalog)
    .map((region) => {
      const id = normalizeString(region?.id);
      const name = normalizeString(region?.name) || id;
      if (!id || !name) return null;

      const rawCountryCode = normalizeString(region?.countryCode);
      const mappedCountryCode = rawCountryCode
        ? normalizeString(toCountryName(rawCountryCode))
        : "";
      const resolvedCodeGeography =
        mappedCountryCode && mappedCountryCode.toLowerCase() !== rawCountryCode.toLowerCase()
          ? mappedCountryCode
          : "";
      const country = normalizeString(region?.country);
      const baseGeography = country || resolvedCodeGeography || name || id;
      const baseOwner = country || resolvedCodeGeography || mappedCountryCode || "";

      const centroid = region?.centroid?.coordinates;
      const lng = Number(Array.isArray(centroid) ? centroid[0] : region?.lng ?? region?.longitude);
      const lat = Number(Array.isArray(centroid) ? centroid[1] : region?.lat ?? region?.latitude);
      return {
        id,
        name,
        countryCode: rawCountryCode,
        baseGeography,
        baseOwner,
        lng: Number.isFinite(lng) ? lng : null,
        lat: Number.isFinite(lat) ? lat : null,
        weight: statsRegionHeuristicWeight({ tags: region?.tags, type: region?.type }),
        adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
      };
    })
    .filter(Boolean);

  const catalog = renderedCatalog.length > 0 ? renderedCatalog : fallbackCatalog;
  if (!catalog.length) {
    return {
      context: "No region catalog is available; use existing campaign records conservatively.",
      plan: [],
      macroPlan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  // 8B.2.18.1 performance: target membership is the hot path over every map
  // feature. Do not invoke the full polity identity resolver 2-4 times per region.
  // Resolve the target once, build its known identity/alias set once, and compare raw
  // map ownership tokens against that set. Keep a tiny generic resolver cache only
  // for the rare displaced-sovereign/donor comparisons that truly need it.
  const targetIdentityKeys = new Set([
    target,
    code,
    ...statsPolityAliases(world, target),
  ].map((value) => normalizeString(value).toLowerCase()).filter(Boolean));
  const mappedTargetCode = normalizeString(toCountryName(code));
  if (mappedTargetCode) targetIdentityKeys.add(mappedTargetCode.toLowerCase());

  const sameTarget = (value) => {
    const raw = normalizeString(value);
    if (!raw) return false;
    const key = raw.toLowerCase();
    if (targetIdentityKeys.has(key)) return true;
    const mapped = normalizeString(toCountryName(raw)).toLowerCase();
    return Boolean(mapped && targetIdentityKeys.has(mapped));
  };

  const canonicalCache = new Map();
  const canonicalCached = (value) => {
    const raw = normalizeString(value);
    if (!raw) return "";
    const key = raw.toLowerCase();
    if (canonicalCache.has(key)) return canonicalCache.get(key);
    const resolved = canonicalStatsPolity(raw, world);
    canonicalCache.set(key, resolved);
    return resolved;
  };
  const same = (a, b) =>
    normalizeString(canonicalCached(a)).toLowerCase() ===
    normalizeString(canonicalCached(b)).toLowerCase();

  const totalByBase = new Map();
  const legalByBase = new Map();
  const controlledByBase = new Map();
  const displacedSovereigns = new Set();

  let occupiedByTarget = 0;
  let targetOccupiedByOthers = 0;
  let nativeHomelandControlled = 0;

  const pushRegion = (map, baseGeography, region) => {
    if (!map.has(baseGeography)) map.set(baseGeography, []);
    map.get(baseGeography).push(region);
  };

  await statsYieldToMainThread(signal);
  const yieldTerritorySlice = createUiBudget(6);
  for (let catalogIndex = 0; catalogIndex < catalog.length; catalogIndex += 1) {
    const region = catalog[catalogIndex];
    const regionId = normalizeString(region?.id);
    const baseGeography = normalizeString(region?.baseGeography) || normalizeString(region?.name) || regionId;
    if (!regionId || !baseGeography) continue;

    totalByBase.set(baseGeography, (totalByBase.get(baseGeography) || 0) + 1);

    const baseOwner = normalizeString(region?.baseOwner);
    const controller = normalizeString(
      world.regionOwnershipOverrides?.[regionId] || baseOwner,
    );
    // 8B.2.14: regionSovereigntyOverrides is intentionally SPARSE. normalizeWorldState
    // drops an explicit sovereignty entry whenever legal sovereign === current controller
    // to avoid persisting thousands of redundant normal-ownership rows. Therefore, when
    // no explicit sovereignty anchor exists, the CURRENT CONTROLLER is the effective legal
    // sovereign. A genuine wartime occupation is safe because its old legal sovereign is
    // preserved as an explicit differing sovereignty override before control flips.
    const sovereign = normalizeString(
      world.regionSovereigntyOverrides?.[regionId] || controller || baseOwner,
    );

    const row = {
      id: regionId,
      name: normalizeString(region?.name) || regionId,
      sovereign,
      lng: Number.isFinite(Number(region?.lng)) ? Number(region.lng) : null,
      lat: Number.isFinite(Number(region?.lat)) ? Number(region.lat) : null,
      weight: Math.max(0.1, Number(region?.weight) || 1),
      adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
    };

    if (sameTarget(controller)) {
      pushRegion(controlledByBase, baseGeography, row);

      if (!sameTarget(sovereign)) {
        occupiedByTarget += 1;
        if (sovereign) displacedSovereigns.add(sovereign);

        // Strong native evidence that the controlled land is the polity's own
        // homeland/base geography rather than an arbitrary foreign occupation.
        if (sameTarget(baseGeography)) nativeHomelandControlled += 1;
      }
    }

    if (sameTarget(sovereign) && controller && !sameTarget(controller)) {
      targetOccupiedByOthers += 1;
    }

    if (sameTarget(sovereign)) pushRegion(legalByBase, baseGeography, row);

    // Time-budgeted rather than item-count-budgeted: one scenario can make 20
    // regions cheap and another can make 20 identity checks expensive. Never hold
    // the browser for more than roughly one half-frame before yielding.
    await yieldTerritorySlice(signal);
  }

  const targetOverrideEntry = Object.entries(world.polityOverrides || {})
    .find(([key, record]) => [
      key,
      record?.code,
      record?.name,
      ...normalizeArray(record?.aliases),
    ].some((value) => value && sameTarget(value)));

  const targetOverride = targetOverrideEntry?.[1] || null;
  const targetExplicitlyActive =
    normalizeString(targetOverride?.status).toLowerCase() === "active";

  // Structured lifecycle evidence is universal and identity-safe. Merely being a
  // CREATEd/RESTOREd polity is not by itself enough (a government-in-exile or newly
  // created foreign invader must not absorb whatever it happens to occupy). Stronger
  // evidence exists when the establishing event ALSO assigns territory/control to the
  // polity. No country names, historical keywords, or scenario-specific ids.
  let lifecycleEstablished = false;
  let foundingTerritoryEstablished = false;
  const yieldLifecycleSlice = createUiBudget(5);
  for (const event of normalizeArray(bundle?.events)) {
    const changes = normalizeArray(event?.impacts?.polityChanges);
    const establishesTarget = changes.some((change) => {
      const operation = normalizeString(change?.operation).toLowerCase();
      return ["create", "restore"].includes(operation) &&
        (sameTarget(change?.code) || sameTarget(change?.name));
    });

    if (!establishesTarget) continue;
    lifecycleEstablished = true;

    const grantsControl = normalizeArray(event?.impacts?.regionControlOps)
      .some((operation) =>
        ["control", "control_flip"].includes(normalizeString(operation?.op).toLowerCase()) &&
        sameTarget(operation?.toCode));

    const grantsSovereignty = normalizeArray(event?.impacts?.regionTransfers)
      .some((transfer) => sameTarget(transfer?.toCode));

    if (grantsControl || grantsSovereignty) foundingTerritoryEstablished = true;
    await yieldLifecycleSlice(signal);
  }

  // Canonical war context is supporting evidence, especially for older saves whose
  // lifecycle-establishing event may have been consolidated away. It is NOT enough
  // by itself to convert a normal foreign occupation into national Stats scope.
  let opposedToDisplacedSovereign = false;
  for (const war of normalizeArray(world?.wars)) {
    if (!["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) continue;

    const sideA = normalizeArray(war?.sideA);
    const sideB = normalizeArray(war?.sideB);
    const targetInA = sideA.some((party) => sameTarget(party));
    const targetInB = sideB.some((party) => sameTarget(party));
    if (!targetInA && !targetInB) continue;

    const opponents = targetInA ? sideB : sideA;
    if (opponents.some((party) =>
      [...displacedSovereigns].some((sovereign) => same(party, sovereign)))) {
      opposedToDisplacedSovereign = true;
      break;
    }
  }

  const legalRegionCount = [...legalByBase.values()]
    .reduce((sum, regions) => sum + regions.length, 0);
  const controlledRegionCount = [...controlledByBase.values()]
    .reduce((sum, regions) => sum + regions.length, 0);

  // Universal de-facto-state rule.
  //
  // Normal states stay on LEGAL SOVEREIGNTY accounting, even while occupying
  // foreign territory. Controller-based accounting is selected ONLY when:
  //   1) there is no usable legal-sovereign mapped basis;
  //   2) the polity actually controls mapped territory;
  //   3) it is an explicitly active campaign polity; and
  //   4) native evidence identifies those holdings as its territorial state base,
  //      not ordinary foreign occupation.
  const deFactoStatehoodEvidence = Boolean(
    nativeHomelandControlled > 0 ||
    foundingTerritoryEstablished ||
    (lifecycleEstablished && opposedToDisplacedSovereign)
  );

  const useDeFactoStateBasis = Boolean(
    legalRegionCount === 0 &&
    controlledRegionCount > 0 &&
    targetExplicitlyActive &&
    deFactoStatehoodEvidence,
  );

  const selectedByBase = useDeFactoStateBasis ? controlledByBase : legalByBase;
  const mode = useDeFactoStateBasis ? "de_facto_state" : "legal";

  if (useDeFactoStateBasis) {
    console.info(
      `[stats 8B.2.18.1] ${target}: DE-FACTO STATE ADMINISTRATION selected — ` +
        `${controlledRegionCount} controlled region(s), 0 legal-sovereign region(s), ` +
        `rendered-geography=${renderedCatalog.length ? "yes" : "fallback"}, ` +
        `own-base=${nativeHomelandControlled}, lifecycle=${lifecycleEstablished ? "yes" : "no"}, ` +
        `founding-territory=${foundingTerritoryEstablished ? "yes" : "no"}, ` +
        `war-with-displaced-sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  } else if (legalRegionCount === 0 && controlledRegionCount > 0) {
    console.info(
      `[stats 8B.2.18.1] ${target}: ${controlledRegionCount} controlled region(s) excluded from national Stats; ` +
        `de-facto state qualification failed (active=${targetExplicitlyActive ? "yes" : "no"}, ` +
        `own-base=${nativeHomelandControlled}, lifecycle=${lifecycleEstablished ? "yes" : "no"}, ` +
        `founding-territory=${foundingTerritoryEstablished ? "yes" : "no"}, ` +
        `war-with-displaced-sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}).`,
    );
  }

  const rows = [...selectedByBase.entries()]
    .map(([baseGeography, regions]) => ({
      baseGeography,
      regions,
      total: totalByBase.get(baseGeography) || regions.length,
    }))
    .sort((a, b) =>
      b.regions.length - a.regions.length ||
      a.baseGeography.localeCompare(b.baseGeography));

  if (!rows.length) {
    return {
      context: [
        `Target: ${target}`,
        "Accounting mode: LEGAL SOVEREIGNTY",
        "No legally sovereign map regions were resolved for this polity.",
        controlledRegionCount > 0
          ? `The polity controls ${controlledRegionCount} region(s), but native statehood safeguards did NOT classify those holdings as a de-facto national administrative basis. Ordinary occupation therefore remains excluded from national population/GDP.`
          : "No de-facto controlled mapped regions were resolved either.",
        "Do not silently substitute modern borders. If this is a landless polity, estimate only what the campaign canon actually supports.",
      ].join("\n"),
      plan: [],
      mode,
      referenceContext: "",
    };
  }

  const plannedRows = rows.map((row, index) => {
    const located = row.regions.filter((region) =>
      region?.lng !== null && region?.lng !== undefined && region?.lng !== "" &&
      region?.lat !== null && region?.lat !== undefined && region?.lat !== "" &&
      Number.isFinite(Number(region.lng)) && Number.isFinite(Number(region.lat))
    );
    const weight = row.regions.reduce((sum, region) => sum + Math.max(0.1, Number(region?.weight) || 1), 0);
    const vector = located.reduce((sum, region) => {
      const localWeight = Math.max(0.1, Number(region?.weight) || 1);
      const local = statsSphericalVector(region.lng, region.lat);
      return [sum[0] + local[0] * localWeight, sum[1] + local[1] * localWeight, sum[2] + local[2] * localWeight];
    }, [0, 0, 0]);
    const point = located.length ? statsVectorLngLat(vector) : { lng: null, lat: null };
    return {
      index: index + 1,
      geography: row.baseGeography,
      regions: row.regions,
      total: row.total,
      lng: point.lng,
      lat: point.lat,
      weight,
    };
  });

  const macroPlan = buildStatsMacroPlan(plannedRows);
  const macroContext = buildStatsMacroContext(macroPlan);
  console.info(
    `[stats 8B.2.18.1] ${target}: ${plannedRows.length} authoritative live component(s) -> ${macroPlan.length} bounded demographic macro bucket(s) (${mode}); AI output no longer scales with province count.`,
  );
  if (statsVerboseTerritoryDebugEnabled()) {
    console.debug(
      `[stats 8B.2.18.1 debug] ${target}: full authoritative component plan`,
      plannedRows.map((row) => ({
        index: row.index,
        geography: row.geography,
        coverage: `${row.regions.length}/${row.total}`,
        regions: row.regions.map((region) => `${region.name} [${region.id}]`),
      })),
    );
    console.debug(`[stats 8B.2.18.1 debug] ${target}: macro plan`, macroPlan);
  }

  const lines = [
    `Target: ${target}`,
    `Accounting mode: ${useDeFactoStateBasis ? "DE-FACTO STATE ADMINISTRATION" : "LEGAL SOVEREIGNTY"}`,
    useDeFactoStateBasis
      ? `De-facto administered mapped regions: ${controlledRegionCount}. Legal-sovereign mapped regions: 0.`
      : `Legally sovereign mapped regions: ${legalRegionCount}.`,
    `Exact live-map accounting components held natively: ${plannedRows.length}.`,
    `Bounded demographic macro buckets for this AI assessment: ${macroPlan.length}.`,
    "The macro buckets below are native spatial groupings used only to bound demographic/economic estimation. They do NOT redefine sovereignty, province identity, or constitutional status.",
    macroContext,
  ];

  if (useDeFactoStateBasis) {
    lines.push(
      "SPECIAL STATEHOOD RULE: native code selected controller-based Stats because this active polity has no usable legal-sovereign map basis but does administer territory as a state actor. Count ONLY the controlled territory represented by the macro buckets. This rule must NOT be generalized by the model to ordinary foreign occupation.",
    );
    lines.push(
      `Native qualification evidence: own-base controlled regions=${nativeHomelandControlled}; lifecycle create/restore=${lifecycleEstablished ? "yes" : "no"}; founding event granted territory/control=${foundingTerritoryEstablished ? "yes" : "no"}; active/ceasefire conflict with displaced sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  }

  if (!useDeFactoStateBasis && occupiedByTarget > 0) {
    lines.push(
      `Temporary occupations held by ${target} but legally sovereign to others: ${occupiedByTarget} region(s) — DO NOT add these inhabitants/GDP to the national component total.`,
    );
  }

  if (targetOccupiedByOthers > 0) {
    lines.push(
      `Legally sovereign ${target} regions under temporary foreign control: ${targetOccupiedByOthers} region(s) — keep them in legal population/GDP scope, but current occupation may economically depress/disrupt them if campaign evidence supports it.`,
    );
  }

  // For a de-facto state, the displaced legal sovereign often already has a mature
  // component ledger for the same geography. Expose exact canonical donor rows as
  // continuity anchors. This is universal data reuse, not scenario-specific data.
  const referenceLines = [];
  if (useDeFactoStateBasis) {
    for (const row of plannedRows) {
      const sourcePolities = [...new Set(
        row.regions
          .map((region) => canonicalCached(region?.sovereign))
          .filter((source) => source && !same(source, target)),
      )];

      for (const source of sourcePolities) {
        const sourceSheet = normalizeCountryStatSheet(world?.countryStats?.[source]);
        const sourceComponents = normalizeArray(sourceSheet?.territorialComponents);
        const donor = sourceComponents.find((component) =>
          normalizeString(component?.geography).toLowerCase() ===
          normalizeString(row.geography).toLowerCase());

        const donorPopulation = Number(donor?.population);
        const donorGdpPerCapita = Number(donor?.gdpPerCapita);
        if (
          !donor ||
          !Number.isFinite(donorPopulation) ||
          donorPopulation < 0 ||
          !Number.isFinite(donorGdpPerCapita) ||
          donorGdpPerCapita <= 0
        ) {
          continue;
        }

        const full = row.regions.length >= row.total;
        referenceLines.push(
          `[${row.index}] ${row.geography} ← ${source}: canonical donor component population=${Math.round(donorPopulation)}, gdpPerCapita=${donorGdpPerCapita}. ${
            full
              ? "Current scope is FULL/NEAR-FULL for this base bucket; treat this as a strong pre-separation continuity anchor."
              : `Current scope is PARTIAL (${row.regions.length}/${row.total}); DO NOT copy the donor's whole population. Estimate ONLY the listed controlled subregions while using donor productivity/demography as context.`
          }`,
        );
      }
    }
  }

  if (referenceLines.length) {
    console.info(`[stats 8B.2.18.1] ${target}: ${referenceLines.length} donor/reference component anchor(s) available.`);
    if (statsVerboseTerritoryDebugEnabled()) {
      console.debug(`[stats 8B.2.18.1 debug] ${target}: donor/reference component anchors`, referenceLines);
    }
  }

  const fingerprintSource = [
    `mode=${mode}`,
    `geographySource=${renderedCatalog.length ? "rendered" : "fallback"}`,
    ...plannedRows.map((row) => [
      row.geography,
      row.total,
      row.regions.map((region) => region.id).sort().join(","),
    ].join("|")),
  ].join("\n");

  return {
    context: lines.join("\n"),
    plan: plannedRows.map((row) => ({ index: row.index, geography: row.geography })),
    macroPlan: macroPlan.map((bucket) => ({
      index: bucket.index,
      lng: bucket.lng,
      lat: bucket.lat,
      members: bucket.members.map((member) => ({
        geography: member.geography,
        weight: member.weight,
      })),
    })),
    fingerprint: `territory-${stableStatsHash(fingerprintSource)}`,
    mode,
    referenceContext: referenceLines.slice(0, 24).join("\n") + (referenceLines.length > 24 ? `\n(+${referenceLines.length - 24} more donor anchors retained natively but omitted from the bounded AI context)` : ""),
  };
};

// A persisted sheet generated from the current native territorial planner must have
// exactly one component for every authoritative geography bucket in that plan.
// This is intentionally weaker than the exact territorial fingerprint (components do
// not carry region ids), but it lets us detect legacy/poisoned sheets whose saved
// fingerprint was stamped after a border change while their component coverage still
// describes the old territory. Once a sheet has been regenerated by the native plan,
// the exact fingerprint remains the primary future border-change detector.
const statsTerritorialPlanMatchesSheet = (sheet, plan = []) => {
  const expected = normalizeArray(plan)
    .map((entry) => normalizeString(entry?.geography).toLowerCase())
    .filter(Boolean)
    .sort();

  // No authoritative map-derived plan means there is nothing exact to validate here.
  if (!expected.length) return true;

  const actual = normalizeArray(sheet?.territorialComponents)
    .map((entry) => normalizeString(entry?.geography).toLowerCase())
    .filter(Boolean)
    .sort();

  if (actual.length !== expected.length) return false;
  return expected.every((geography, index) => actual[index] === geography);
};

export const generateCountryStats = async ({ code, name } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle, {
    requiredKeys: ["playerPolity", "date", "worldSummary", "recentEvents", "language"],
  });
  const target = name || code || "the polity";
  const playerPolity = variables.playerPolity || bundle?.game?.country || "the player";
  const dossier = await buildTargetDossier(bundle, normalizeString(code));
  const era = normalizeString(bundle.world?.simulationRules).slice(0, 700);
  const system =
    `You are the intelligence advisor in an alternate-history strategy game. ` +
    `The current date is ${variables.date || "unknown"}. The player leads ${playerPolity}. ` +
    `Give a concise intelligence briefing on ${target}${code ? ` (code ${code})` : ""}. ` +
    `Treat the TARGET DOSSIER and WORLD STATE below as ground truth. Where specifics are not recorded, ` +
    `give your best historical estimate for this era, people and region — you are the advisor, and ` +
    `plausible estimates are your job. Never answer with "unknown", "no data" or "not specified"; ` +
    `mark guesses with "(est.)" instead. ` +
    `Cover government/leadership, territory & key regions, military strength, economy, and diplomatic posture toward ${playerPolity}.\n\n` +
    (era ? `ERA & WORLD RULES:\n${era}\n\n` : "") +
    `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}\n\n` +
    `WORLD STATE:\n${variables.worldSummary || variables.grandMapDescription || "(no summary)"}\n\n` +
    `RECENT EVENTS:\n${variables.recentEvents || "(none)"}\n\n` +
    `Respond in ${variables.language || "English"} as 4-6 short bullet points, each prefixed with "- ". No preamble, no closing remarks.`;
  const raw = await callAI(system, [
    { role: "user", parts: [{ text: `Give me the intelligence briefing on ${target}.` }] },
  ]);
  return String(raw || "").trim();
};

// Structured national stat sheet for the Stats tab, grounded in the same
// campaign context as the intelligence briefing.
export const generateCountryStatSheet = async ({ code, name, forceReassess = false, signal } = {}) => {
  const statsStartedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  // Stats is a read-mostly panel. Use the already-canonical runtime bundle cache
  // rather than forcing every underlying state resource back through storage on each
  // inspection/refresh. Writers update the runtime cache at the canonical mutation
  // boundary, so this remains current while avoiding a large synchronous reload.
  const bundle = await readCountryStatsBundle({ force: false });
  throwIfAborted(signal);
  // readCountryStatsBundle already supplies the stable normalized read-only world.
  // Re-normalizing it here was another full-campaign allocation on every country.
  const worldAtStart = bundle.world;
  const statCode = canonicalStatsPolity(code, worldAtStart) || normalizeString(code);
  const target = name || statCode || code || "the polity";

  // R2.35: territorial accounting and dossier construction run in an ACTUAL worker
  // thread. Waiting is allowed; stealing map/input frames is not.
  await statsYieldToMainThread(signal);
  const statsPreparation = await buildCountryStatsPreparationBackground(
    bundle,
    statCode,
    worldAtStart,
    { signal, forceReassess },
  );
  const territorialBasis = statsPreparation.territorialBasis;
  const dossier = statsPreparation.dossier;
  throwIfAborted(signal);
  await statsYieldToMainThread(signal);

  // Prompt context is needed only once we know a real reassessment may proceed.
  // Keep this after the bounded/yielding territorial preparation rather than on the
  // click's first synchronous path.
  const variables = await buildTemplateVariables(bundle, {
    taskKey: "countryStatSheet",
    requiredKeys: [
      "date",
      "playerPolity",
      "language",
      "simulationRules",
      "worldSummary",
      "recentEvents",
    ],
  });
  throwIfAborted(signal);
  await statsYieldToMainThread(signal);
  const territoryReadyAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const territorialContext = territorialBasis.context;
  const territorialPlan = territorialBasis.plan;
  const territorialMacroPlan = normalizeArray(territorialBasis.macroPlan);
  console.info(
    `[stats 8B.2.18.1 perf] ${target}: preparation ${(Math.max(0, territoryReadyAt - statsStartedAt)).toFixed(1)} ms (${statsPreparation.source}); ${territorialPlan.length} exact component(s) -> ${territorialMacroPlan.length} macro bucket(s).`,
  );
  const statsMiddleMainStartedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const territorialFingerprint = normalizeString(territorialBasis.fingerprint);
  const territorialBasisMode = normalizeString(territorialBasis.mode) || "legal";
  const territorialReferenceContext = normalizeString(territorialBasis.referenceContext);
  const era = normalizeString(bundle.world?.simulationRules).slice(0, 700);
  const previous = normalizeCountryStatSheet(worldAtStart.countryStats?.[statCode]);
  const previousComplete = isCompleteCountryStatSheet(previous);
  const currentDate = normalizeString(bundle?.game?.gameDate || bundle?.game?.startDate);
  const campaignStartDate = normalizeString(bundle?.game?.startDate) || currentDate;
  const currentRound = Math.max(0, Math.trunc(Number(bundle?.game?.round) || 0));

  const previousStateFingerprint = normalizeString(previous?.continuity?.stateFingerprint);
  const previousTerritorialFingerprint = normalizeString(previous?.continuity?.territorialFingerprint);
  const hasAuthoritativeTerritorialFingerprint = Boolean(territorialFingerprint);
  const territorialCoverageMatches = !previousComplete
    ? true
    : statsTerritorialPlanMatchesSheet(previous, territorialPlan);
  const previousComponentCount = normalizeArray(previous?.territorialComponents).length;
  const previousPopulationCalibrationVersion = Math.max(
    0,
    Math.trunc(Number(previous?.continuity?.populationCalibrationVersion) || 0),
  );
  const atScenarioStartState = Boolean(
    campaignStartDate &&
    currentDate === campaignStartDate &&
    currentRound <= 1
  );

  // 8B.2.18: 8B.2.15 removed the planner's 64-row cap, but countryStats.js and
  // the canonical schema still silently truncated persisted ledgers to 64 rows.
  // The tell is exact: today's territorial fingerprint already matches, the live
  // plan has >64 rows, the saved ledger has exactly 64, and coverage is incomplete.
  // Treat that baseline as numerically poisoned and rebuild it automatically once.
  const legacyComponentCapPoison = Boolean(
    previousComplete &&
    territorialPlan.length > 64 &&
    previousComponentCount === 64 &&
    previousTerritorialFingerprint &&
    previousTerritorialFingerprint === territorialFingerprint &&
    !territorialCoverageMatches
  );

  // 8B.2.18 population calibration is deliberately a START-STATE migration only.
  // A mature alternate-history campaign whose old ledger predates this feature must
  // NOT be silently dragged toward history. At Round One/start date we can safely
  // rebuild the newly-created baseline once; later campaigns preserve canon unless
  // the user explicitly requests a hard audit.
  const startPopulationCalibrationUpgrade = Boolean(
    previousComplete &&
    hasAuthoritativeTerritorialFingerprint &&
    atScenarioStartState &&
    previousPopulationCalibrationVersion < COUNTRY_STATS_POPULATION_CALIBRATION_VERSION
  );
  const rebuildNumericBaseline = Boolean(
    forceReassess ||
    legacyComponentCapPoison ||
    startPopulationCalibrationUpgrade
  );
  const populationCalibrationRequested = Boolean(
    hasAuthoritativeTerritorialFingerprint &&
    (!previousComplete || rebuildNumericBaseline)
  );
  // Economic nominal-scale calibration is deliberately narrower than the population
  // migration. Fresh baselines and explicit hard audits get an auditable nominal
  // anchor; established campaign ledgers remain canon and are never silently pulled
  // back toward real history merely because this feature was added later.
  const economicCalibrationRequested = Boolean(!previousComplete || forceReassess);

  // Legacy 7A.1 sheets can be complete while carrying no continuity fingerprint.
  // On a mapped polity we MUST NOT stamp today's border fingerprint onto that old
  // sheet and call it current: a legal annexation/cession may have happened between
  // the old estimate and this first 7A.2 refresh. Rebase it once against the exact
  // current legal territorial plan instead. Historical economic events are treated as
  // already embodied in the legacy baseline during this bootstrap, so the rebase does
  // not double-apply old wars/taxes/trade shocks.
  const legacyContinuityBootstrap = Boolean(previousComplete && !previousStateFingerprint);
  const legacyMappedTerritoryBootstrap = Boolean(
    legacyContinuityBootstrap && hasAuthoritativeTerritorialFingerprint,
  );

  const workerMiddle = statsPreparation?.middle;
  const workerMiddlePrepared = Boolean(workerMiddle?.prepared);
  const rawEconomicEvidence = workerMiddlePrepared
    ? workerMiddle.rawEconomicEvidence
    : buildTargetEconomicEvidence({ bundle, statCode, previous, normalizedWorld: worldAtStart });
  const economicEvidence = legacyMappedTerritoryBootstrap
    ? {
        ...rawEconomicEvidence,
        text: "",
        selectedFreshIds: [],
        unaccountedCount: 0,
      }
    : rawEconomicEvidence;

  const stateFingerprint = `stats-${stableStatsHash(JSON.stringify({
    date: currentDate,
    round: currentRound,
    territory: territorialFingerprint,
    economicEvents: rawEconomicEvidence.relevantIds,
  }))}`;

  // Only preserve the old zero-AI migration behavior when we have NO authoritative
  // map-derived territorial fingerprint at all (for example a landless/custom scenario).
  // If a mapped territorial basis exists, the one-time bootstrap must reassess it.
  if (statCode && legacyContinuityBootstrap && !hasAuthoritativeTerritorialFingerprint) {
    try {
      const world = await readWorldState({ force: true });
      const migrated = applyCountryStatPatchToWorld(world, statCode, {}, {
        continuity: {
          assessedDate: currentDate,
          assessedRound: currentRound,
          stateFingerprint,
          territorialFingerprint,
          accountedEventIds: rawEconomicEvidence.relevantIds,
        },
      });
      await writeWorldState(world);
      console.info(`[stats 7A.2] continuity metadata migrated for ${statCode}; no authoritative mapped territory was available, so the existing baseline was reused.`);
      return migrated || previous;
    } catch (error) {
      console.warn("[stats 7A.2] continuity migration failed; falling through to reassessment:", error);
    }
  }

  if (legacyMappedTerritoryBootstrap) {
    console.info(`[stats 7A.2] legacy mapped baseline for ${statCode} has no territorial fingerprint; forcing one territorial rebase without replaying historical economic evidence.`);
  }

  if (previousComplete && !territorialCoverageMatches) {
    console.warn(`[stats 7A.2] territorial component coverage mismatch for ${statCode}; forcing reassessment even if the saved state fingerprint matches.`);
  }

  // Exact same simulation state + no unaccounted target-economic events = no AI
  // call ONLY when the persisted component coverage still matches the authoritative
  // current territorial plan. This repairs saves poisoned by the old migration lock,
  // where a new border fingerprint could be stamped onto stale pre-annexation totals.
  // An explicit manual hard audit (Shift+click in Stats) is the deliberate escape hatch:
  // it bypasses this zero-call guard so a suspect baseline can be rebuilt from live canon.
  if (
    !rebuildNumericBaseline &&
    previousComplete &&
    territorialCoverageMatches &&
    previousStateFingerprint === stateFingerprint &&
    economicEvidence.unaccountedCount === 0
  ) {
    console.info(`[stats 7A.2] same-state refresh for ${statCode}; canonical baseline reused with zero AI calls.`);
    return previous;
  }

  if (forceReassess) {
    console.warn(`[stats 8B.2.18.1] MANUAL HARD REASSESS for ${statCode}; rebuilding the stat baseline from the current authoritative territorial basis (${territorialBasisMode}) without importing later real-world outcomes.`);
  }
  if (legacyComponentCapPoison) {
    console.warn(
      `[stats 8B.2.18.1] ${statCode}: detected legacy 64-component truncation (${previousComponentCount}/${territorialPlan.length}) under the current territorial fingerprint; rebuilding the poisoned numeric baseline automatically.`,
    );
  }
  if (startPopulationCalibrationUpgrade) {
    console.warn(
      `[stats 8B.2.18.1] ${statCode}: start-state Stats baseline predates causal population calibration v${COUNTRY_STATS_POPULATION_CALIBRATION_VERSION}; rebuilding it once against scenario canon + exact live territory.`,
    );
  }

  // Normal reassessment keeps the persistent component ledger as the numeric source
  // of truth. Only an explicit hard audit or the exact legacy-64 corruption signature
  // discards that numeric anchor. Even then, historical knowledge is a STARTING-STATE
  // prior only; campaign canon owns everything that happened after the scenario began.
  // Keep AI continuity bounded as well. The exact province/component ledger remains
  // native, but the model sees only a regional roll-up instead of hundreds of rows.
  const previousContext = workerMiddlePrepared
    ? normalizeString(workerMiddle.previousContext)
    : !rebuildNumericBaseline && previous
      ? (() => {
          const normalizedPrevious = normalizeCountryStatSheet(previous) || previous;
          const { territorialComponents: _previousComponents = [], ...previousSummary } = normalizedPrevious;
          const macroSummary = buildStatsPreviousMacroContext(normalizedPrevious, territorialMacroPlan);
          return [
            "Previous whole-sheet metadata / derived aggregates:",
            JSON.stringify(previousSummary, null, 2),
            macroSummary ? `Previous bounded regional macro roll-up:\n${macroSummary}` : "",
          ].filter(Boolean).join("\n");
        })()
      : "";

  const statsScenarioCalibrationCanon = populationCalibrationRequested
    ? workerMiddlePrepared
      ? normalizeString(workerMiddle.statsScenarioCalibrationCanon)
      : buildStatsPopulationCalibrationCanon({ bundle, statCode, normalizedWorld: worldAtStart })
    : "";

  const populationCalibrationReason = !previousComplete
    ? "no persistent population/component baseline exists yet"
    : forceReassess
      ? "the user explicitly requested a hard stat audit"
      : legacyComponentCapPoison
        ? "the prior ledger was truncated by the legacy 64-component persistence bug"
        : startPopulationCalibrationUpgrade
          ? "the Round-One baseline predates causal population calibration"
          : "native reconstruction requested";

  const statsCalibrationContext = (() => {
    const startLabel = campaignStartDate || "the scenario start";
    const currentLabel = currentDate || "the current campaign date";

    if (populationCalibrationRequested) {
      return [
        `Native causal POPULATION CALIBRATION is REQUIRED because ${populationCalibrationReason}.`,
        `The regional calibration must describe THIS scenario timeline and the EXACT current authoritative territorial footprint. It is not a lookup of the real-world polity with the same name.`,
        `Infer the latest shared-history frontier from the supplied scenario/divergence canon. Real-world demographic evidence is usable only up to that frontier. Everything after it is another timeline unless scenario canon explicitly preserves the same outcome.`,
        `If the scenario is still materially historical through ${startLabel}, a same-era historical census/estimate may seed unresolved starting conditions. If the scenario diverged earlier, reason forward from the last shared regional/historical baseline through the supplied alternate pre-start canon instead.`,
        currentLabel !== startLabel
          ? `The campaign is now at ${currentLabel}. Reconstruct from the scenario-start state plus canonical campaign developments; NEVER jump to a real-world ${currentLabel} population merely because the calendar matches.`
          : `The campaign is at its start date (${startLabel}); pre-start scenario canon and the live territory define what population exists on Day One.`,
        `A changed map itself is divergence evidence. Historical headline populations are invalid when their territorial definition includes places absent from the live basis or omits places present in it.`,
        `Return causal-calibration provenance plus one population/productivity estimate for each bounded native macro bucket. Native JavaScript will derive the national total from those regional estimates and expand them back across every exact live component.`,
        `After this calibrated ledger is persisted, it becomes campaign canon. Future normal Stats updates evolve from it and MUST NOT re-anchor to later real history.`,
      ].join("\n- ").replace(/^/, "- ");
    }

    if (previousComplete) {
      return [
        "The PREVIOUS PERSISTENT STATS ledger is the numeric scale authority for established campaign state; later real-world history is not an attractor and must not pull the simulation back toward our timeline.",
        "Carry surviving component population/productivity forward from that ledger, modified only by elapsed time, supplied fresh campaign evidence, donor transfers, or actual authoritative territorial changes.",
        "If the map partition changes while canonical territory/economic reality does not, conserve the previous whole-polity demographic/economic scale and reallocate it across the CURRENT authoritative components rather than re-looking-up the country historically.",
        "If territory is legally added or lost, preserve surviving components and add/subtract the transferred geography using donor references and campaign evidence where available. Do not substitute the historical fate of the polity at the current calendar date.",
        "Historical knowledge may still fill a genuinely unresolved local fact, but it may not overwrite an already canonical value or manufacture an event that the campaign did not record.",
      ].join("\n- ").replace(/^/, "- ");
    }

    return [
      `No persistent numeric baseline exists and no exact mapped calibration path is available. Use era/regional knowledge conservatively for unresolved INITIAL CONDITIONS around ${startLabel}, subject to scenario canon.`,
      currentLabel !== startLabel
        ? `Because the first Stats assessment is occurring at ${currentLabel}, reason from scenario-start conditions and supplied campaign canon rather than copying same-date real history.`
        : "Because the assessment is at the scenario start, era-appropriate local magnitudes are legitimate priors where canon is silent.",
      "Once this sheet is persisted, it becomes campaign canon; future assessments must evolve from it rather than repeatedly re-anchoring to real history.",
    ].join("\n- ").replace(/^/, "- ");
  })();

  const evidenceContext = populationCalibrationRequested
    ? [
        !previousComplete
          ? "INITIAL CAUSAL POPULATION BOOTSTRAP: no prior canonical component ledger exists."
          : forceReassess
            ? "MANUAL HARD STAT AUDIT: the prior numeric component ledger is intentionally not being trusted."
            : legacyComponentCapPoison
              ? "NATIVE STAT REPAIR: the prior ledger is numerically incomplete because of the legacy 64-component persistence cap."
              : "NATIVE START-STATE CALIBRATION UPGRADE: the existing Round-One ledger predates bounded regional causal calibration.",
        "Respect the CURRENT authoritative territorial basis and accounting mode exactly.",
        `Treat scenario canon—not the current calendar date—as the authority boundary. Shared real history may seed only the portion of causality that remains shared before the inferred divergence frontier.`,
        currentDate !== campaignStartDate
          ? `Reconstruct ${currentDate || "the current date"} from the ${campaignStartDate || "scenario-start"} alternate-world baseline plus supplied campaign developments. Do not import absent real-world outcomes in between.`
          : `Establish the Day-One population for ${campaignStartDate || "the scenario start"} from the supplied pre-start canon and exact live territory.`,
        "Return populationCalibration only as scenario-causality provenance, plus exactly one row for every bounded native macro bucket. Native code derives the national total from those regional rows and expands them across the exact live component ledger.",
        rawEconomicEvidence.text ? `Relevant target-specific campaign evidence to respect: ${rawEconomicEvidence.text}` : "No additional target-specific economic evidence was found.",
      ].join(" ")
    : legacyMappedTerritoryBootstrap
      ? [
          "Legacy territorial continuity bootstrap: the previous complete sheet predates an exact territorial fingerprint.",
          "Treat older economic/demographic events as ALREADY reflected in that baseline; do not apply them again.",
          "Reconcile the previous values with the CURRENT authoritative territorial basis. Preserve the previous whole-polity scale unless actual canonical territory/economic evidence requires change; reallocate that scale across the new map partition rather than using later real-world history as a replacement baseline.",
        ].join(" ")
      : [
          economicEvidence.text,
          territorialBasisMode === "de_facto_state"
            ? "Native accounting mode is DE-FACTO STATE ADMINISTRATION. The current component plan represents territory actually administered by this active state actor despite unresolved legal sovereignty. Use donor component references where supplied; do not preserve a stale generic whole-polity component when it conflicts with the authoritative controlled-region plan."
            : "",
        ].filter(Boolean).join(" ");

  const statsMiddleMainEndedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  console.info(
    `[stats middle R2.41] ${target}: main-thread post-worker context ` +
    `${Math.max(0, statsMiddleMainEndedAt - statsMiddleMainStartedAt).toFixed(1)} ms; ` +
    `semantic context source=${workerMiddlePrepared ? "worker" : "main-thread-fallback"}.`,
  );

  await statsYieldToMainThread(signal);

  const statsAiStartedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const { payload } = await runJsonTask("countryStatSheet", {
    signal,
    userMessage: [
      `Compile the persistent national stat sheet for ${target}${statCode ? ` (canonical polity ${statCode})` : ""}.`,
      era ? `ERA & WORLD RULES:\n${era}` : "",
      `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}`,
      `AUTHORITATIVE TERRITORIAL BASIS:\n${territorialContext}`,
      previousContext ? `PREVIOUS PERSISTENT STATS:\n${previousContext}` : "",
      `FRESH ECONOMIC / DEMOGRAPHIC EVIDENCE:\n${evidenceContext || "None newly unaccounted."}`,
    ].filter(Boolean).join("\n\n"),
    variables: {
      ...variables,
      statsTerritorialContext: territorialContext,
      statsTerritorialPlan: territorialPlan,
      statsTerritorialMacroPlan: territorialMacroPlan,
      statsPreviousTerritorialComponents: normalizeArray(previous?.territorialComponents),
      statsTerritorialBasisMode: territorialBasisMode,
      statsTerritorialReferenceContext: territorialReferenceContext,
      statsPreviousContext: previousContext,
      statsEconomicEvidenceContext: evidenceContext,
      statsCalibrationContext,
      statsScenarioCalibrationCanon,
      statsPopulationCalibrationRequested: populationCalibrationRequested,
      statsEconomicCalibrationRequested: economicCalibrationRequested,
      statsEconomicEvidenceIds: normalizeArray(rawEconomicEvidence?.selectedFreshIds),
      statsEconomicCalibrationStartDate: campaignStartDate,
      statsEconomicCalibrationCurrentDate: currentDate,
      statsCalibrationTargetName: statCode || target,
    },
  });
  const statsAiEndedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  console.info(`[stats 8B.2.18.1 perf] ${target}: bounded Stats AI ${(Math.max(0, statsAiEndedAt - statsAiStartedAt)).toFixed(1)} ms.`);

  throwIfAborted(signal);
  const finalized = finalizeCountryStatSheet(payload);

  // Fail closed if any future normalization/schema regression drops authoritative
  // live-map components. A wrong but internally valid national total is worse than
  // a visible Stats error because it poisons campaign canon and downstream AI.
  if (territorialPlan.length > 0 && !statsTerritorialPlanMatchesSheet(finalized, territorialPlan)) {
    const finalizedCount = normalizeArray(finalized?.territorialComponents).length;
    throw new Error(
      `Native Stats territorial invariant failed for ${statCode || target}: expected ${territorialPlan.length} live-map component(s), finalized ${finalizedCount}. Refusing to persist a truncated national ledger.`,
    );
  }

  const elapsedYears = statsElapsedYears(previous?.continuity?.assessedDate, currentDate);
  const territoryChanged = Boolean(
    hasAuthoritativeTerritorialFingerprint &&
    (
      !previousTerritorialFingerprint ||
      previousTerritorialFingerprint !== territorialFingerprint ||
      !territorialCoverageMatches
    )
  );
  // Explicit hard audit and the exact legacy-64 corruption repair bypass the
  // continuity guard because the prior numeric ledger itself is not trustworthy.
  // Normal refreshes remain protected from rerolls and double-counting.
  const guarded = populationCalibrationRequested
    ? { sheet: finalized, restored: [] }
    : guardCountryStatContinuity(previous, finalized, {
        elapsedYears,
        evidenceText: evidenceContext,
        territoryChanged,
      });

  if (guarded.restored?.length) {
    console.warn(`[stats 7A.2] restored ${guarded.restored.length} unsupported continuity discontinuity/discontinuity entries for ${statCode}.`);
    if (statsVerboseTerritoryDebugEnabled()) {
      console.debug(`[stats 8B.2.18.1 debug] ${statCode}: restored continuity details`, guarded.restored);
    }
  }

  // A newly-created baseline conceptually accounts for the current recent ledger.
  // An established baseline accounts only the bounded fresh evidence shown in THIS
  // reassessment; if more than 12 fresh events existed, another refresh can process
  // the deferred remainder instead of silently marking unseen evidence as handled.
  const accountedNow = populationCalibrationRequested
    ? rawEconomicEvidence.relevantIds
    : legacyMappedTerritoryBootstrap
      ? rawEconomicEvidence.relevantIds
      : previous?.continuity
        ? economicEvidence.selectedFreshIds
        : rawEconomicEvidence.relevantIds;

  if (statCode && guarded.sheet && typeof guarded.sheet === "object") {
    throwIfAborted(signal);

    const continuity = {
      assessedDate: currentDate,
      assessedRound: currentRound,
      stateFingerprint,
      territorialFingerprint,
      ...(populationCalibrationRequested
        ? { populationCalibrationVersion: COUNTRY_STATS_POPULATION_CALIBRATION_VERSION }
        : previousPopulationCalibrationVersion > 0
          ? { populationCalibrationVersion: previousPopulationCalibrationVersion }
          : {}),
      accountedEventIds: accountedNow,
    };

    try {
      const commitStartedAt =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();

      // R2.40: the expensive full-world save belongs in the same Stats worker that
      // already owns Stats loading/preparation. The UI sends only one bounded sheet.
      const persisted = await persistCountryStatsBackground({
        code: statCode,
        sheet: guarded.sheet,
        continuity,
        date: currentDate,
        round: currentRound,
        signal,
      });

      if (persisted?.sheet && typeof persisted.sheet === "object") {
        const workerDoneAt =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

        // The worker has already written canonical world.json. Patch the same-tab
        // caches narrowly so future reads see it without reparsing/normalizing the
        // entire world and without waking MapTree/Timeline/Chat.
        await primeCountryStatsWorkerCommit({
          country: statCode,
          sheet: persisted.sheet,
          historySeries: persisted.historySeries,
        });

        const cachePrimedAt =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("oh:country-stats-updated", {
            detail: {
              country: statCode,
              sheet: persisted.sheet,
              source: "native-country-stats-worker-persist",
            },
          }));
        }

        const endedAt =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

        console.info(
          `[stats commit R2.40] ${statCode}: ` +
          `worker persistence wait ${(workerDoneAt - commitStartedAt).toFixed(1)} ms (UI free); ` +
          `local cache patch ${(cachePrimedAt - workerDoneAt).toFixed(1)} ms; ` +
          `targeted notify ${(endedAt - cachePrimedAt).toFixed(1)} ms; ` +
          `main-thread tail ${(endedAt - workerDoneAt).toFixed(1)} ms.`,
        );

        return persisted.sheet;
      }

      throw new Error("Country Stats worker persistence returned no canonical sheet.");
    } catch (workerPersistError) {
      if (signal?.aborted || workerPersistError?.name === "AbortError") {
        throw workerPersistError;
      }

      // Correctness fallback only. If this path logs during the responsiveness test,
      // the test is not exercising R2.40's intended persistence architecture.
      console.warn(
        "[OH PERF] Country Stats worker persistence failed; using main-thread canonical fallback.",
        workerPersistError,
      );

      try {
        const world = await readWorldState({ force: false });
        const nextSheet = applyCountryStatPatchToWorld(
          world,
          statCode,
          guarded.sheet,
          {
            replaceComponents: true,
            continuity,
          },
        );
        world.countryStatsHistory = appendCountryStatHistorySample(
          world.countryStatsHistory,
          statCode,
          nextSheet,
          { date: currentDate, round: currentRound },
        );
        await writeWorldState(world, { emitEvents: false });

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("oh:country-stats-updated", {
            detail: {
              country: statCode,
              sheet: nextSheet,
              source: "native-country-stats-main-thread-fallback",
            },
          }));
        }

        return nextSheet;
      } catch (error) {
        console.warn("[ai] failed to persist native country stats:", error);
      }
    }
  }

  return guarded.sheet || finalized;
};

export const refinePlayerAction = async (rawInput, { persist = true } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle, { taskKey: "descriptionToAction", actionInput: rawInput });
  const { payload } = await runJsonTask("descriptionToAction", {
    fallback: () => fallbackDescriptionToAction(rawInput, bundle),
    userMessage: "Convert the player's raw intent into one structured in-game command as JSON only.",
    variables,
  });

  const invitees = normalizeArray(payload?.invitees).map((entry) => normalizeString(entry)).filter(Boolean);
  const action = normalizeActionEntry({
    chatStarter: normalizeString(payload?.chatStarter),
    invitees,
    kind: normalizeString(payload?.kind).toLowerCase() === "chat" ? "chat" : "action",
    rawInput,
    source: "manual",
    status: "planned",
    text: normalizeString(payload?.text),
    title: normalizeString(payload?.title),
  });

  if (!action) {
    throw new Error("Could not convert the action into a structured command.");
  }

  if (persist) {
    const nextActions = [...(await readActionsState({ force: true })), action];
    await writeActionsState(nextActions);
  }

  return action;
};

export const chooseNextDiplomaticSpeaker = async ({
  chat,
  excludeSpeaker = "",
  excludedSpeakers = [],
} = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const normalizedChat = normalizeChats([chat])[0];
  if (!normalizedChat) {
    return "";
  }

  const excluded = [excludeSpeaker, ...normalizeArray(excludedSpeakers)]
    .map(speakerExclusionKey)
    .filter(Boolean);
  const excludedSet = new Set(excluded);
  const variables = await buildTemplateVariables(bundle, { taskKey: "nextSpeaker", chat: normalizedChat });
  const { payload } = await runJsonTask("nextSpeaker", {
    fallback: () => fallbackNextSpeaker({
      chat: normalizedChat,
      excludedSpeaker: excludeSpeaker,
      excludedSpeakers,
    }),
    userMessage: [
      "Decide whether another participant genuinely needs to speak now. Return JSON only.",
      "Use nextSpeaker:null when nobody has a distinct useful response; silence is valid and often natural.",
      "A participant directly addressed or asked a question should normally answer.",
      excluded.length > 0
        ? `Do not select these participants in this response round: ${[excludeSpeaker, ...normalizeArray(excludedSpeakers)].filter(Boolean).join(", ")}.`
        : "No participant is excluded beyond the normal most-recent-speaker rule.",
    ].join("\n"),
    variables: {
      ...variables,
      lastSpeaker: excludeSpeaker || variables.lastSpeaker,
    },
  });

  const fallback = () => fallbackNextSpeaker({
    chat: normalizedChat,
    excludedSpeaker: excludeSpeaker,
    excludedSpeakers,
  }).nextSpeaker || "";

  const nextSpeaker = normalizeString(payload?.nextSpeaker);
  if (!nextSpeaker) {
    return fallback();
  }

  const validSpeaker = normalizedChat.countries.find((country) => {
    const nameKey = speakerExclusionKey(country?.name);
    return nameKey === nextSpeaker.toLowerCase() && !excludedSet.has(nameKey);
  });

  // Invalid / stale / already-spoken model output does not force a random country.
  // Either the latest player line directly addresses somebody, or the floor is quiet.
  return validSpeaker?.name || fallback();
};

export const consolidateRecentHistory = async ({ limit = 12 } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const events = getUnconsolidatedEvents(bundle.events, bundle.world).slice(0, limit);
  const chats = normalizeChats(bundle.chats).filter((chat) => chat.status === "closed").slice(0, limit);
  const { summary } = await consolidateHistoryBatch(bundle, events, chats);
  return summary;
};

export const createCatalyst = async ({ force = true } = {}) => {
  const bundle = await readGameStateBundle({ force });
  const variables = await buildTemplateVariables(bundle, { taskKey: "catalystCreation" });
  const { payload } = await runJsonTask("catalystCreation", {
    fallback: () => ({
      choices: [
        "Intervene decisively",
        "Probe for weakness first",
        "Remain cautious and observe",
      ],
      opening: normalizeEvents(bundle.events).at(-1)?.description || "A turning point begins to unfold.",
      premise: normalizeEvents(bundle.events).at(-1)?.title || "A decisive moment takes shape.",
      title: normalizeEvents(bundle.events).at(-1)?.title || "Emerging Catalyst",
    }),
    userMessage: "Design the next catalyst scene as JSON only.",
    variables,
  });

  const catalyst = {
    choices: normalizeArray(payload?.choices).map((entry) => normalizeString(entry)).filter(Boolean).slice(0, 5),
    opening: normalizeString(payload?.opening),
    premise: normalizeString(payload?.premise),
    title: normalizeString(payload?.title),
  };

  const world = normalizeWorldState(await readWorldState({ force: true }));
  world.activeCatalyst = catalyst;
  await writeWorldState(world);
  return catalyst;
};

export const advanceActiveCatalyst = async (choiceText) => {
  beginSimulation();
  try {
  const bundle = await readGameStateBundle({ force: true });
  const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
  const world = normalizeWorldState(bundle.world);
  const catalyst = world.activeCatalyst;

  if (!catalyst) {
    throw new Error("No active catalyst is available.");
  }

  const catalystHistoryText = normalizeArray(catalyst.history)
    .map((entry) => `${entry.choice}: ${entry.summary}`)
    .join("\n");
  const variables = await buildTemplateVariables(bundle, {
    taskKey: "catalystExecutor",
    catalystChoice: choiceText,
    catalystHistory: catalystHistoryText,
    catalystOpening: catalyst.opening || "",
    catalystPremise: catalyst.premise || catalyst.title || "",
  });

  const { payload } = await runJsonTask("catalystExecutor", {
    fallback: () => {
      const resolved = normalizeArray(catalyst.history).length >= 1;
      const existingChoices = normalizeArray(catalyst.choices)
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
      const distinctChoices = Array.from(
        new Map(existingChoices.map((choice) => [choice.toLocaleLowerCase(), choice])).values(),
      );
      const nextChoices = distinctChoices.length >= 2
        ? distinctChoices.slice(0, 5)
        : ["Press the advantage", "Reassess the situation"];
      return {
        nextChoices: resolved ? [] : nextChoices,
        resolved,
        summary: `${choiceText} becomes the line of action inside "${catalyst.title || "the scene"}", pushing the situation toward a definite outcome.`,
      };
    },
    userMessage: "Continue the catalyst scene as JSON only.",
    variables,
  });

  const historyEntry = {
    choice: choiceText,
    summary: normalizeString(payload?.summary),
  };

  const nextCatalyst = {
    ...catalyst,
    choices: normalizeArray(payload?.nextChoices).map((entry) => normalizeString(entry)).filter(Boolean).slice(0, 5),
    history: [...normalizeArray(catalyst.history), historyEntry],
    opening: normalizeString(payload?.summary) || catalyst.opening,
  };

  if (!payload?.resolved) {
    const nextWorld = {
      ...world,
      activeCatalyst: nextCatalyst,
    };
    await writeWorldState(nextWorld);
    return {
      catalyst: nextCatalyst,
      world: nextWorld,
    };
  }

  const summaryVariables = await buildTemplateVariables(bundle, {
    taskKey: "catalystSummary",
    catalystHistory: [...normalizeArray(catalyst.history), historyEntry]
      .map((entry) => `${entry.choice}: ${entry.summary}`)
      .join("\n"),
    catalystPremise: catalyst.premise || catalyst.title || "",
  });
  const { generation: summaryGeneration, payload: summaryPayload } = await runJsonTask("catalystSummary", {
    fallback: () => ({
      description: historyEntry.summary,
      importance: "major",
      title: catalyst.title || "Catalyst resolved",
    }),
    userMessage: "Summarize the finished catalyst into one campaign event as JSON only.",
    variables: summaryVariables,
  });

  const catalystEvent = normalizeGeneratedEvent({
    date: bundle.game.gameDate,
    description: normalizeString(summaryPayload?.description),
    impacts: {
      createdChats: [],
      polityChanges: [],
      regionTransfers: [],
      regionControlOps: [],
    },
    importance: normalizeString(summaryPayload?.importance) || "major",
    kind: "catalyst",
    notable: true,
    playerRelated: true,
    title: normalizeString(summaryPayload?.title) || catalyst.title || "Catalyst resolved",
    source: summaryGeneration.source,
  });

  return applySimulationResult({
    baseActions: bundle.actions,
    baseChats: bundle.chats,
    baseColors,
    baseEvents: bundle.events,
    baseGame: bundle.game,
    baseWorld: {
      ...bundle.world,
      activeCatalyst: null,
    },
    result: {
      catalyst: null,
      clearActions: false,
      events: catalystEvent ? [catalystEvent] : [],
      mode: "catalyst",
      stopDate: bundle.game.gameDate,
      summary: normalizeString(summaryPayload?.description) || historyEntry.summary,
      generation: summaryGeneration,
    },
  });
  } finally {
    endSimulation();
  }
};

// ---------------------------------------------------------------------------
// Fix 07.2 — targeted endogenous-motion repair
// ---------------------------------------------------------------------------
// The normal whole-world pass remains the source of history. If one selected,
// high-pressure storyline crosses the 70-day anti-stasis backstop but the model
// still copies its equilibrium forward, repair ONLY that process. Never throw
// away unrelated valid events, and never turn this into a second world sweep.
const WORLD_MOTION_REPAIR_EVENT_LIMIT = 1;
const WORLD_MOTION_REPAIR_HISTORY_LIMIT = 12;

const compactStorylineRepairHistory = (bundle, storyline) => {
  const id = normalizeString(storyline?.id);
  const participants = normalizeArray(storyline?.participants)
    .map(normalizeString)
    .filter(Boolean);
  const participantKeys = participants.map((name) => name.toLowerCase());

  return normalizeEvents(bundle?.events)
    .filter((event) => {
      if (normalizeArray(event?.storylineIds).map(normalizeString).includes(id)) return true;
      const haystack = `${event?.title || ""} ${event?.description || ""} ${normalizeArray(event?.combatants).join(" ")}`.toLowerCase();
      return participantKeys.some((key) => key.length >= 4 && haystack.includes(key));
    })
    .slice(-WORLD_MOTION_REPAIR_HISTORY_LIMIT)
    .map((event) => {
      const desc = normalizeString(event?.description).slice(0, 900);
      return `${normalizeString(event?.date) || "????-??-??"} — ${normalizeString(event?.title) || "Untitled"}${desc ? `\n${desc}` : ""}`;
    })
    .join("\n\n");
};

const runTargetedWorldMotionRepair = async ({
  bundle,
  issue,
  mainPassEvents = [],
  originDate,
  targetDate,
  canEmitEvent,
  signal,
} = {}) => {
  const prior = issue?.prior;
  const attempted = issue?.update;
  const storylineId = normalizeString(issue?.id || prior?.id);
  if (!prior || !storylineId) return null;

  const participants = normalizeArray(prior?.participants)
    .map(normalizeString)
    .filter(Boolean)
    .slice(0, 8);

  const dossiers = await Promise.all(
    participants.map(async (name) => {
      try {
        const text = await buildTargetDossier(bundle, name);
        return `${name}:\n${normalizeString(text).slice(0, 4200) || "No additional dossier available."}`;
      } catch {
        return `${name}: no additional dossier available.`;
      }
    }),
  );

  const recentHistory = compactStorylineRepairHistory(bundle, prior) || "No directly matched recent canonical events were found.";
  const existingPassSummary = normalizeArray(mainPassEvents)
    .slice(0, 8)
    .map((event, index) => `${index + 1}. ${normalizeString(event?.date)} — ${normalizeString(event?.title)}\n${normalizeString(event?.description).slice(0, 650)}`)
    .join("\n\n") || "None.";
  const territorialContext = await buildTerritorialControlContext(bundle?.world);
  const canonicalWarContext = buildCanonicalWarContext(bundle?.world);
  const playerPolity = normalizeString(bundle?.game?.country) || "the player polity";
  const eventAllowance = canEmitEvent
    ? "You MAY return at most ONE visible event if this repair uncovers a genuinely material public development."
    : "The main pass has already used its visible-event ceiling. Return NO visible event; repair the process only through a causally justified hidden pressure/momentum/status change.";

  const repairCause = issue?.kind === "missing-update"
    ? "was selected for native attention, but the normal whole-world pass omitted its required semantic update"
    : "crossed its anti-stasis backstop after the normal whole-world pass still left it objectively unchanged";

  let systemPrompt = `You are the TARGETED ENDOGENOUS MOTION REPAIR for OpenHistoria, an alternate-history strategy simulation.\n\n` +
    `You are NOT simulating the whole world and you are NOT generating filler. One already-known persistent storyline ${repairCause}. Simulate ONLY this process through the supplied interval.\n\n` +
    `Core rule: DEFERRED OR STALE DOES NOT MEAN FROZEN. The actors inside this process have their own objectives, commanders, institutions, manpower, supply, morale, politics, economics and initiative. Decide what they actually attempted during the interval and what succeeded, failed, partially succeeded, or changed internally. Do not wait for ${playerPolity} or an outside event to give them permission to act.\n\n` +
    `WWI/trench-style stalemate is legal. Territorial movement is NOT required. But you may not merely paraphrase the same equilibrium. Routine artillery exchanges, patrols, unchanged skirmishes, meetings, weather-only delay, or generic 'fighting continues' are NOT a repair. Artillery/patrol activity may be background cause only when it produces a material consequence.\n\n` +
    `A smaller power may hold, counterattack, recover ground, exploit overextension, force a local reverse, or create negotiation pressure. A larger power may fail locally. Do not decide outcomes from country size or memorized real history; branch from this campaign's actual state.\n\n` +
    `If the equilibrium genuinely remains militarily static, change another real dimension when causally warranted: operational readiness, supply, command, casualties/attrition, morale, domestic politics, diplomatic pressure, offensive preparation/abandonment, strategic objectives, or status. Numeric pressure/momentum changes must be explained by the returned state; do not wiggle numbers merely to satisfy the validator.\n\n` +
    `PLAYER AGENCY: ${playerPolity} is human-controlled. Autonomous private/social/local actors may create pressure inside it, but do not make a NEW major sovereign/executive decision for ${playerPolity} unless already authorized by supplied canon.\n\n` +
    `${eventAllowance}\n\n` +
    `OUTPUT CONTRACT: call the normal jump-result tool once. Return stopDate=${targetDate}. clearActions=false. Return NO catalyst and NO diplomaticOutreach. warUpdates, relationUpdates and agreementUpdates MUST be empty strings — this repair cannot silently alter belligerency or treaty ledgers. storylineUpdates MUST contain EXACTLY ONE record for ${storylineId}, in the standard format:\n` +
    `For any combat event: preserve legal sovereignty vs de-facto control. Use warId/combatants correctly. Do not fabricate a legal region transfer for a battlefield capture. Existing persistent unit/territorial directors will reconcile missing unit/control detail after this repair. Do NOT conclude a ceasefire, peace treaty, war termination, formal alliance, or other ledger-changing settlement in this narrow repair; movement TOWARD negotiations/settlement is allowed.\n`;

  try {
    if (participants.some((name) => name.toLowerCase() === playerPolity.toLowerCase())) {
      const game = normalizeGameData(bundle?.game || {});
      systemPrompt += `\n${difficultyDirective(game.difficulty, "simulation")}\n`;
    }
  } catch {
    // Difficulty failure leaves the narrow repair neutral rather than blocking it.
  }

  const userMessage = [
    `INTERVAL: ${originDate} → ${targetDate}`,
    `STAGNATION AGE AT STOP: ${Number(issue?.stagnationAgeDays) || 0} days`,
    "",
    "AUTHORITATIVE STORYLINE BEFORE THIS PASS:",
    JSON.stringify(prior, null, 2),
    "",
    issue?.kind === "missing-update"
      ? "WHOLE-WORLD PASS STORYLINE UPDATE: MISSING — repair the selected process without replacing unrelated main-pass events."
      : "WHOLE-WORLD PASS ATTEMPTED UPDATE (insufficient):",
    JSON.stringify(attempted || {}, null, 2),
    "",
    "CURRENT CANONICAL WARS:",
    canonicalWarContext || "None recorded.",
    "",
    "CURRENT TERRITORIAL / FRONT EXCEPTIONS:",
    territorialContext || "None recorded.",
    "",
    "PARTICIPANT DOSSIERS:",
    dossiers.join("\n\n"),
    "",
    "RECENT CANONICAL HISTORY RELEVANT TO THIS PROCESS:",
    recentHistory,
    "",
    "EVENTS ALREADY GENERATED BY THE MAIN PASS THIS INTERVAL — DO NOT DUPLICATE THEM:",
    existingPassSummary,
  ].join("\n");

  try {
    if (signal?.aborted) throw signal.reason || new DOMException("Timeline jump cancelled.", "AbortError");
    const timeoutMs = getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 180000 : 0;
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;

    logContextDiagnostics({
      attempt: 1,
      history: [{ role: "user", parts: [{ text: userMessage }] }],
      promptTemplate: systemPrompt,
      stage: "structured-request",
      systemPrompt,
      taskKey: "worldMotionRepair",
      userMessage,
      variables: { storylineId, originDate, targetDate },
    });

    const response = await callAI(systemPrompt, [
      { role: "user", parts: [{ text: userMessage }] },
    ], {
      deadline,
      signal,
      tool: getGameplayTool("jumpForward"),
    });

    const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("repair response did not contain a structured jump payload");
    }

    // Repair is never allowed to resolve queued player actions or open side channels.
    parsed.clearActions = false;
    parsed.catalyst = null;
    parsed.diplomaticOutreach = [];

    const schemaValidation = validateGameplayPayload("jumpForward", parsed);
    if (!schemaValidation.valid) throw new Error(schemaValidation.error);

    const repairEvents = normalizeArray(parsed.events);
    if (repairEvents.length > (canEmitEvent ? WORLD_MOTION_REPAIR_EVENT_LIMIT : 0)) {
      throw new Error(`repair returned ${repairEvents.length} visible event(s), above its local allowance`);
    }
    if (normalizeArray(parsed.warUpdates).length || normalizeArray(parsed.relationUpdates).length || normalizeArray(parsed.agreementUpdates).length) {
      throw new Error("repair attempted to mutate war/relation/agreement ledgers; those belong to the normal world pass");
    }

    // Native bookkeeping owns causal event linkage here too. The repair model only
    // needs to describe the storyline evolution and, optionally, one causal event.
    normalizeWorldStorylineEventLinks(parsed, { world: bundle?.world });

    const decodedUpdates = decodeWorldStorylineUpdates(parsed.storylineUpdates);
    if (decodedUpdates.length !== 1 || normalizeString(decodedUpdates[0]?.id) !== storylineId) {
      throw new Error(`repair must return exactly one storyline update for ${storylineId}`);
    }
    if (repairEvents.length && !normalizeArray(decodedUpdates[0]?.eventIndexes).includes(0)) {
      throw new Error("native storyline binding could not identify the repair event as causal");
    }

    const dateError = validateTimelineDates({
      candidate: parsed,
      mode: "jump",
      originDate,
      targetDate,
      requireAdvance: true,
    });
    if (dateError) throw new Error(dateError);

    const warError = validateWarLedgerPayload(parsed, { world: bundle?.world });
    if (warError) throw new Error(warError);

    const storylineError = validateWorldStorylinePayload(parsed, {
      existingStorylines: [prior],
      selectedStorylines: [prior],
      deferredStorylines: [],
      originDate,
      stopDate: normalizeString(parsed.stopDate) || targetDate,
      enforceAntiStasis: true,
      world: bundle?.world,
    });
    if (storylineError) throw new Error(storylineError);

    const worldChangeError = await validateGeneratedWorldChanges(
      parsed,
      bundle?.world,
      { strictTransfers: false },
    );
    if (worldChangeError) throw new Error(worldChangeError);

    return {
      event: repairEvents[0] || null,
      update: decodedUpdates[0],
      summary: normalizeString(parsed.summary),
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Timeline jump cancelled.", "AbortError");
    console.warn(
      `[OH World Motion Repair] ${storylineId} failed: ${normalizeString(error?.message || error) || "unknown error"}. ` +
      "Keeping the valid main world pass; this storyline remains overdue for the next turn.",
    );
    return null;
  }
};

const repairAntiStasisStorylines = async ({
  payload,
  bundle,
  analysis,
  originDate,
  targetDate,
  passMaxEvents,
  signal,
} = {}) => {
  const issues = findWorldStorylineAntiStasisIssues(payload, {
    existingStorylines: bundle?.world?.storylines,
    selectedStorylines: analysis?.attentionStorylines,
    originDate,
    stopDate: normalizeString(payload?.stopDate) || targetDate,
    world: bundle?.world,
  });
  if (!issues.length) return { repaired: 0, failed: 0, issues: [] };

  let events = normalizeArray(payload?.events);
  let updates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
  let repaired = 0;
  let failed = 0;

  console.warn(
    `[OH World Motion Repair] ${issues.length} selected storyline repair issue(s): ` +
    issues.map((issue) =>
      issue?.kind === "missing-update"
        ? `${issue.id} (missing semantic update)`
        : `${issue.id} (${issue.stagnationAgeDays}d anti-stasis)`
    ).join(", "),
  );

  for (const issue of issues) {
    const canEmitEvent = events.length < Math.max(0, Number(passMaxEvents) || 0);
    const repair = await runTargetedWorldMotionRepair({
      bundle,
      issue,
      mainPassEvents: events,
      originDate,
      targetDate,
      canEmitEvent,
      signal,
    });

    // Remove the insufficient copy-forward either way. If repair fails this keeps
    // the canonical storyline's old accounted/review dates intact, so it remains
    // immediately overdue next turn instead of being silently pushed forward.
    updates = updates.filter((entry) => normalizeString(entry?.id) !== normalizeString(issue.id));

    if (!repair) {
      failed += 1;
      continue;
    }

    const eventOffset = events.length;
    if (repair.event) events = [...events, repair.event];
    updates.push({
      ...repair.update,
      eventIndexes: normalizeArray(repair.update?.eventIndexes)
        .map((index) => index + eventOffset),
    });
    repaired += 1;

    console.info(
      `[OH World Motion Repair] repaired ${issue.id}: ` +
      `${repair.event ? `1 material event (${normalizeString(repair.event.title)})` : "hidden objective evolution"}.`,
    );
  }

  payload.events = events;
  // Internal transport may be object records after schema validation; the native
  // decoder explicitly supports this form and preserves exact event-index offsets.
  payload.storylineUpdates = updates;

  return { repaired, failed, issues };
};

// ---------------------------------------------------------------------------
// Fix 08.3.1 — normal-month world composition, post-Curator + consequence-aware
// ---------------------------------------------------------------------------
// The main pass owns player consequences, focused storylines, wars, and obvious
// causal developments. After semantic curation, a month-scale whole-world result
// with only 0-3 visible survivors is still suspiciously shallow. Recompute breadth
// from WHAT ACTUALLY SURVIVED (not raw candidates, storyline bookkeeping, or ledger
// rows), then perform one bounded second composition search over neglected slots.
// This is still not an event quota: a genuinely quiet world may return zero. Every
// supplemental event must survive normal integrity screening and the same Curator.
const WORLD_BREADTH_REPAIR_MIN_DAYS = 21;
const WORLD_BREADTH_REPAIR_MAX_DAYS = 40;
const WORLD_BREADTH_REPAIR_TRIGGER_MAX_SURVIVORS = 3;
const WORLD_BREADTH_REPAIR_MIN_EXPLORATION_SLOTS = 6;
const WORLD_BREADTH_REPAIR_MIN_QUIET_SLOTS = 2;
const WORLD_BREADTH_REPAIR_EVENT_LIMIT = 5;
const WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS = 6;
const WORLD_BREADTH_REPAIR_HISTORY_LIMIT = 16;
const quietWorldBreadthSlots = (analysis, explorationAudit) => {
  const quietIds = new Set(
    normalizeArray(explorationAudit?.quietSlotIds)
      .map(Number)
      .filter(Number.isInteger),
  );
  if (!quietIds.size) return [];
  return normalizeArray(analysis?.explorationSlate)
    .filter((slot) => quietIds.has(Number(slot?.id)));
};

const postCuratorWorldBreadthSlots = ({ analysis, survivingEvents, bundle } = {}) => {
  // Visible breadth must be measured from visible survivors. A raw candidate that
  // Integrity/Curator rejected, or a hidden storyline/ledger update, must not make
  // an exploration lane look visually occupied. This was the main reason 08.2 could
  // re-check only 2/8 slots after the user actually received one worthwhile event.
  const audit = deriveWorldExplorationAudit(
    {
      events: normalizeArray(survivingEvents),
      storylineUpdates: [],
      diplomaticOutreach: [],
      warUpdates: [],
      relationUpdates: [],
      agreementUpdates: [],
    },
    analysis,
    {
      world: bundle?.world || {},
      gameCountry: bundle?.game?.country,
    },
  );

  const quiet = quietWorldBreadthSlots(analysis, audit);
  if (quiet.length <= WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS) {
    return { audit, slots: quiet };
  }

  // Relevance-backed actor lanes first, but reserve room for at least one global
  // lane when one is quiet so ordinary world texture is not crowded out by powers
  // already prominent in the causal ledger.
  const actorSlots = quiet
    .filter((slot) => slot?.type === "actor-domain")
    .sort((a, b) => (Number(b?.relevance) || 0) - (Number(a?.relevance) || 0));
  const globalSlots = quiet.filter((slot) => slot?.type !== "actor-domain");

  const selected = actorSlots.slice(0, WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS);
  if (globalSlots.length && !selected.some((slot) => slot?.type !== "actor-domain")) {
    if (selected.length >= WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS) selected.pop();
    selected.push(globalSlots[0]);
  }

  for (const slot of [...globalSlots.slice(1), ...actorSlots]) {
    if (selected.length >= WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS) break;
    if (!selected.some((entry) => Number(entry?.id) === Number(slot?.id))) selected.push(slot);
  }

  return { audit, slots: selected };
};

const compactBreadthRepairHistory = (bundle) =>
  normalizeEvents(bundle?.events)
    .slice(-WORLD_BREADTH_REPAIR_HISTORY_LIMIT)
    .map((event) => {
      const desc = normalizeString(event?.description).slice(0, 520);
      return `${normalizeString(event?.date) || "????-??-??"} — ${normalizeString(event?.title) || "Untitled"}${desc ? `\n${desc}` : ""}`;
    })
    .join("\n\n");

const runWorldBreadthRepair = async ({
  bundle,
  analysis,
  quietSlots,
  mainEvents,
  originDate,
  targetDate,
  horizonDays,
  eventAllowance,
  survivorCount = 0,
  consequenceSignal = null,
  signal,
} = {}) => {
  const maxEvents = Math.max(0, Math.min(
    WORLD_BREADTH_REPAIR_EVENT_LIMIT,
    Number(eventAllowance) || 0,
  ));
  if (!quietSlots.length || maxEvents <= 0) return null;

  const existingPassEvents = normalizeArray(mainEvents);
  const existingPassSummary = existingPassEvents
    .slice(0, 10)
    .map((event, index) => `${index + 1}. ${normalizeString(event?.date)} — ${normalizeString(event?.title)}\n${normalizeString(event?.description).slice(0, 600)}`)
    .join("\n\n") || "None.";

  const actorNames = [...new Set(
    quietSlots
      .filter((slot) => slot?.type === "actor-domain")
      .map((slot) => normalizeString(slot?.actor))
      .filter(Boolean),
  )].slice(0, 5);

  const dossiers = await Promise.all(
    actorNames.map(async (name) => {
      try {
        const text = await buildTargetDossier(bundle, name);
        return `${name}:\n${normalizeString(text).slice(0, 2400) || "No additional dossier available."}`;
      } catch {
        return `${name}: no additional dossier available.`;
      }
    }),
  );

  const playerPolity = normalizeString(bundle?.game?.country) || "the player polity";
  const canonicalWarContext = buildCanonicalWarContext(bundle?.world);
  const diplomaticContext = buildBoundedDiplomaticContext(bundle?.world || {}, {
    playerPolity,
    focusActors: actorNames,
    selectedStorylines: [],
    maxActors: 8,
  });
  const recentHistory = compactBreadthRepairHistory(bundle) || "No recent canonical events are available.";
  const currentStorylineTitles = normalizeArray(bundle?.world?.storylines)
    .filter((storyline) => normalizeString(storyline?.status).toLowerCase() !== "resolved")
    .slice(0, 24)
    .map((storyline) => `${normalizeString(storyline?.id)} — ${normalizeString(storyline?.title)}`)
    .join("\n") || "None.";

  const slotLines = quietSlots.map((slot) => {
    const guard = normalizeArray(slot?.deferredTopics).length
      ? ` Deferred process(es) to avoid routine restatement of: ${normalizeArray(slot.deferredTopics).join("; ")}.`
      : "";
    const basis = normalizeString(slot?.basis)
      ? ` Current native basis: ${normalizeString(slot.basis)}.`
      : " No specific present-tense pressure was identified; inspect latent causes conservatively.";
    return `${slot.id}. ${normalizeString(slot?.actor)} — inspect ${normalizeString(slot?.domain)}.${basis}${guard}`;
  });

  let systemPrompt = `You are the NORMAL-MONTH WORLD COMPOSITION PASS for OpenHistoria, an alternate-history strategy simulation.\n\n` +
    `The primary whole-world pass for ${originDate} → ${targetDate} (${Math.round(Number(horizonDays) || 0)} days) was valid, but after Integrity and semantic Curator only ${Math.max(0, Number(survivorCount) || 0)} worthwhile visible event(s) remain. You are NOT replacing those events, NOT retrying the whole world, and NOT satisfying an event quota. Search the supplied exploration lanes that remain visibly neglected AFTER curation.\n\n` +
    `Evaluate EVERY supplied lane before finalizing. Do not stop after finding the first or second acceptable event if other supplied lanes also contain independent, concrete developments. Return ZERO events if all lanes are genuinely quiet; otherwise return each independently worthwhile outcome you actually find, up to the local ceiling. The purpose is broader discovery, not calendar padding. Small but concrete history is legitimate: domestic politics, industry, science/technology, social movements, institutions, public life, culture, personalities, accidents/disasters, economic decisions, regional developments, and informal diplomacy can all matter without being world-shattering.\n\n` +
    `OUTCOME-FIRST DISCIPLINE: Prefer completed facts and observable results over process. A meeting, review, study, procurement discussion, inspection, exercise, doctrine/planning session, or preliminary inquiry is normally NOT a visible event merely because officials performed it. Return it only when this interval produces a concrete adopted decision, funded order, fielded capability, command change, casualty/accident, deployment, completed project, demonstrated finding, prototype, licensed process, production step, or another observable consequence. Do not inflate process into significance.\n\n` +
    `${consequenceSignal?.level === "low" ? `CONSEQUENCE-AWARE SEARCH BIAS: The rolling visible timeline is busy but unusually low in material threshold outcomes (${Math.max(0, Number(consequenceSignal?.consequentialCount) || 0)}/${Math.max(0, Number(consequenceSignal?.eventCount) || 0)} over ~${Math.max(1, Number(consequenceSignal?.lookbackDays) || 90)} days). While evaluating THESE SAME neglected lanes, first ask whether any already-grounded pressure has matured into a real threshold outcome — a vote/result, resignation/appointment, strike/settlement, completed capability, decisive commercial/financial action, crisis escalation/de-escalation, or other development that materially changes what actors can do next. This is search ordering, NOT a requirement for drama. If no grounded threshold has matured, return ordinary concrete history or nothing rather than fabricating one.\n\n` : ""}` +
    `PHYSICAL-WORLD CONSEQUENCE AUDIT: For EACH event you decide is independently timeline-worthy, silently ask whether that event establishes a significant named geographically concrete physical facility/place that will persist beyond the event. If YES, that same event MUST carry an impacts.markerOps build with real coordinates and a lifecycle status that matches the event (planned, under_construction, or active; do not call a groundbreaking project active). Examples include a major new factory/arsenal, naval yard or port facility, logistics hub, laboratory, fortification, headquarters/base or airfield. Do not create markers for routine activity, generic offices, unnamed workshops, ordinary maintenance or mere continuation. This is NOT a marker quota and is NEVER a reason to invent an event. This narrow breadth-repair pass is not given the full current-feature ledger, so do not guess updates to existing markers; leave existing-feature lifecycle changes to the primary simulation unless an exact stable marker id is explicitly supplied in the evidence.\n\n` +
    `BELLIGERENCY / CAUSALITY DISCIPLINE: Treat the CURRENT CANONICAL WARS section below as authoritative. Do not describe a non-belligerent polity as having a wartime economy, wartime rationing, wartime production, war shortages, mobilization, or home-front controls merely because wars exist elsewhere. For a non-belligerent, such pressure is valid only when THIS campaign supplies an independent cause such as explicit preparedness/contingency policy or genuine foreign-war spillover (for example disrupted trade/imports/shipping, sanctions, refugees, or border disruption). If that cause is absent, find a different grounded development or return nothing.\n\n` +
    `BAD SEARCH RESULTS: “the general staff reviews artillery procurement” with no adopted outcome; “an institute studies substitutes because of wartime shortages” for a polity that is not at war. BETTER: an order is actually adopted/funded, a capability enters production/service, or research reaches a concrete demonstrated result grounded in the campaign.\n\n` +
    `Do NOT repeat or paraphrase events already generated by the main pass. Do NOT service an existing persistent storyline merely because it exists; selected/deferred processes were handled by the primary simulation and anti-stasis machinery. If a supplied quiet slot independently creates a genuinely NEW unresolved process, you may create a NEW storyline linked to that event. Do not update an existing storyline id.\n\n` +
    `This narrow repair cannot declare/join/end a war, sign/ratify/suspend/end a formal agreement, or mutate bilateral relation ledgers. Those high-consequence ledger transitions belong to the primary whole-world pass. If a quiet-slot search points toward such a development, prefer the preceding concrete pressure/initiative only when it is independently timeline-worthy; otherwise return nothing rather than half-canonizing a treaty or war.\n\n` +
    `PLAYER AGENCY: ${playerPolity} is human-controlled. Autonomous private/social/local actors and limited officials may create circumstances, pressure, proposals, unrest, research, scandals, local actions, or public movements inside it. Do not make a NEW major sovereign/executive choice for ${playerPolity}.\n\n` +
    `OUTPUT CONTRACT: call the normal jump-result tool once. stopDate=${targetDate}. clearActions=false. catalyst=null. diplomaticOutreach must be empty. warUpdates, relationUpdates and agreementUpdates must be empty strings. Return at most ${maxEvents} visible event(s), but there is NO minimum and no preferred exact count. Search all supplied lanes first, then return every independently worthwhile, date-valid outcome you found up to the ceiling. storylineUpdates may contain only NEW storyline ids created by a returned event, never an existing storyline.\n`;

  try {
    const game = normalizeGameData(bundle?.game || {});
    systemPrompt += `\n${difficultyDirective(game.difficulty, "simulation")}\n`;
  } catch {
    // Difficulty failure leaves the breadth repair neutral rather than blocking it.
  }

  const userMessage = [
    `INTERVAL: ${originDate} → ${targetDate}`,
    `LOCAL EVENT CEILING: ${maxEvents} (ceiling only; zero is valid)`,
    `ROLLING CONSEQUENCE SIGNAL: ${consequenceSignal?.level === "low" ? "LOW — prioritize mature threshold outcomes where causally earned" : "normal"} (${Math.max(0, Number(consequenceSignal?.consequentialCount) || 0)}/${Math.max(0, Number(consequenceSignal?.eventCount) || 0)} threshold events across ~${Math.max(1, Number(consequenceSignal?.lookbackDays) || 90)}d)`,
    "",
    "POST-CURATOR NEGLECTED EXPLORATION LANES — evaluate ALL of these:",
    slotLines.join("\n"),
    "",
    "EVENTS ALREADY GENERATED BY THE MAIN PASS — DO NOT DUPLICATE:",
    existingPassSummary,
    "",
    "EXISTING PERSISTENT STORYLINES — DO NOT SERVICE OR UPDATE THESE IDS:",
    currentStorylineTitles,
    "",
    "CURRENT CANONICAL WARS (authoritative belligerency context only; no ledger mutation in this repair):",
    canonicalWarContext || "None recorded.",
    "",
    "BOUNDED DIPLOMATIC CONTEXT:",
    diplomaticContext?.text || "No bounded diplomatic context available.",
    "",
    "QUIET-SLOT ACTOR DOSSIERS:",
    dossiers.join("\n\n") || "No actor-specific dossiers were required.",
    "",
    "RECENT CANONICAL EVENTS — use only to avoid repetition and respect branch state:",
    recentHistory,
  ].join("\n");

  try {
    if (signal?.aborted) throw signal.reason || new DOMException("Timeline jump cancelled.", "AbortError");
    const timeoutMs = getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 180000 : 0;
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;

    logContextDiagnostics({
      attempt: 1,
      history: [{ role: "user", parts: [{ text: userMessage }] }],
      promptTemplate: systemPrompt,
      stage: "structured-request",
      systemPrompt,
      taskKey: "worldBreadthRepair",
      userMessage,
      variables: {
        originDate,
        targetDate,
        horizonDays,
        quietSlotIds: quietSlots.map((slot) => slot.id),
        consequenceSignal,
      },
    });

    const response = await callAI(systemPrompt, [
      { role: "user", parts: [{ text: userMessage }] },
    ], {
      deadline,
      signal,
      tool: getGameplayTool("jumpForward"),
    });

    const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("breadth repair response did not contain a structured jump payload");
    }

    parsed.clearActions = false;
    parsed.catalyst = null;
    parsed.diplomaticOutreach = [];

    const schemaValidation = validateGameplayPayload("jumpForward", parsed);
    if (!schemaValidation.valid) throw new Error(schemaValidation.error);

    const repairEvents = normalizeArray(parsed.events);
    if (repairEvents.length > maxEvents) {
      throw new Error(`breadth repair returned ${repairEvents.length} event(s), above its local ceiling ${maxEvents}`);
    }

    if (
      normalizeArray(parsed.warUpdates).length ||
      normalizeArray(parsed.relationUpdates).length ||
      normalizeArray(parsed.agreementUpdates).length
    ) {
      throw new Error("breadth repair attempted to mutate war/relation/agreement ledgers");
    }

    const decodedStorylines = decodeWorldStorylineUpdates(parsed.storylineUpdates);
    const existingStorylineIds = new Set(
      normalizeArray(bundle?.world?.storylines)
        .map((storyline) => normalizeString(storyline?.id))
        .filter(Boolean),
    );
    for (const update of decodedStorylines) {
      const id = normalizeString(update?.id);
      if (existingStorylineIds.has(id)) {
        throw new Error(`breadth repair attempted to update existing storyline ${id}`);
      }
      if (!normalizeArray(update?.eventIndexes).length) {
        throw new Error(`new breadth storyline ${id || "<missing id>"} must link to a returned event`);
      }
    }

    if (!repairEvents.length) {
      if (decodedStorylines.length) {
        throw new Error("breadth repair returned storyline updates without a visible event");
      }
      return {
        events: [],
        storylineUpdates: [],
        quietSlots,
      };
    }

    const dateError = validateTimelineDates({
      candidate: parsed,
      mode: "jump",
      originDate,
      targetDate,
      requireAdvance: true,
    });
    if (dateError) throw new Error(dateError);

    const storylineError = validateWorldStorylinePayload(parsed, {
      existingStorylines: bundle?.world?.storylines,
      selectedStorylines: [],
      deferredStorylines: [],
      originDate,
      stopDate: normalizeString(parsed.stopDate) || targetDate,
      enforceAntiStasis: false,
      world: bundle?.world,
    });
    if (storylineError) throw new Error(storylineError);

    const worldChangeError = await validateGeneratedWorldChanges(
      parsed,
      bundle?.world,
      { strictTransfers: false },
    );
    if (worldChangeError) throw new Error(worldChangeError);

    return {
      events: repairEvents,
      storylineUpdates: decodedStorylines,
      quietSlots,
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Timeline jump cancelled.", "AbortError");
    console.warn(
      `[OH World Breadth Repair] failed: ${normalizeString(error?.message || error) || "unknown error"}. ` +
      "Keeping the valid main world pass unchanged.",
    );
    return null;
  }
};

const maybeRepairWorldBreadthAfterCuration = async ({
  survivingEvents,
  mainEvents,
  bundle,
  context,
  mode = "jump",
  signal,
} = {}) => {
  const analysis = context?.analysis;
  const slate = normalizeArray(analysis?.explorationSlate);
  const postCuratorBreadth = postCuratorWorldBreadthSlots({
    analysis,
    survivingEvents,
    bundle,
  });
  const quietSlots = normalizeArray(postCuratorBreadth?.slots);
  const days = Number(context?.horizonDays) || 0;
  const survivorCount = normalizeArray(survivingEvents).length;
  const eventCeiling = Math.max(0, Number(context?.eventCeiling) || 0);
  const available = Math.max(0, eventCeiling - survivorCount);
  const consequenceSignal = assessRecentWorldConsequenceLiveness({
    events: bundle?.events,
    additionalEvents: survivingEvents,
    referenceDate: normalizeString(context?.targetDate),
  });
  const sparseTrigger = survivorCount <= WORLD_BREADTH_REPAIR_TRIGGER_MAX_SURVIVORS;
  // Same composition pass, no extra AI layer: a busy-but-toothless rolling window
  // may also justify searching the still-neglected lanes. Keep this bounded so a
  // healthy 7-10 event month never receives gratuitous padding.
  const consequenceTrigger =
    consequenceSignal.level === "low" &&
    survivorCount <= Math.min(6, Math.max(0, eventCeiling - 1));

  const eligible =
    mode === "jump" &&
    normalizeString(context?.generationSource || "ai") === "ai" &&
    days >= WORLD_BREADTH_REPAIR_MIN_DAYS &&
    days <= WORLD_BREADTH_REPAIR_MAX_DAYS &&
    (sparseTrigger || consequenceTrigger) &&
    slate.length >= WORLD_BREADTH_REPAIR_MIN_EXPLORATION_SLOTS &&
    quietSlots.length >= WORLD_BREADTH_REPAIR_MIN_QUIET_SLOTS &&
    available > 0;

  if (!eligible) {
    return {
      triggered: false,
      events: [],
      storylineUpdates: [],
      analysis,
      survivorCount,
      quietSlotCount: quietSlots.length,
      consequenceSignal,
    };
  }

  const compositionReason = sparseTrigger
    ? `${survivorCount} worthwhile visible event(s) survived Curator across ${Math.round(days)}d`
    : `${survivorCount} worthwhile visible event(s) survived, but rolling consequence signal is LOW (${consequenceSignal.consequentialCount}/${consequenceSignal.eventCount} threshold events)`;
  console.warn(
    `[OH World Composition 08.3.1] ${compositionReason}; ` +
    `searching ${quietSlots.length}/${slate.length} exploration lane(s) still visibly neglected after curation. ` +
    "This is the existing composition pass with consequence-aware search ordering, not an event/drama quota.",
  );

  const repair = await runWorldBreadthRepair({
    bundle,
    analysis,
    quietSlots,
    mainEvents: normalizeArray(mainEvents),
    originDate: normalizeString(context?.originDate),
    targetDate: normalizeString(context?.targetDate),
    horizonDays: days,
    eventAllowance: available,
    survivorCount,
    consequenceSignal,
    signal,
  });

  if (!repair) {
    return {
      triggered: true,
      failed: true,
      events: [],
      storylineUpdates: [],
      analysis,
      survivorCount,
      quietSlotCount: quietSlots.length,
      consequenceSignal,
    };
  }

  console.info(
    `[OH World Composition 08.3.1] search completed: ${normalizeArray(repair.events).length} supplemental candidate(s) from ` +
    `${repair.quietSlots?.length || quietSlots.length} post-Curator neglected exploration lane(s).`,
  );

  return {
    triggered: true,
    failed: false,
    events: normalizeArray(repair.events),
    storylineUpdates: normalizeArray(repair.storylineUpdates),
    analysis,
    survivorCount,
    quietSlotCount: quietSlots.length,
    consequenceSignal,
  };
};

// ---------------------------------------------------------------------------
// Phase 6B.2 — bounded intra-jump world simulation
// ---------------------------------------------------------------------------
// A fixed jump longer than roughly one month is too much causal distance for
// one giant answer: a crisis born halfway through the response cannot enter the
// native scheduler until the NEXT user turn. Split long jumps into a few hidden
// whole-world windows. Each window sees the previous window's events, chats,
// impacts and persistent storylines; the UI still receives one final turn.
const worldPassCountForDays = (days, mode = "jump") => {
  if (mode !== "jump") return 1; // auto-jump already stops at a notable moment
  const span = Math.max(0, Number(days) || 0);
  if (span <= 30) return 1;
  if (span <= 75) return 2;
  if (span <= 150) return 3;
  return 4;
};

const buildWorldPassWindows = ({ originDate, targetDate, dateStep, days, mode }) => {
  const passCount = worldPassCountForDays(days, mode);
  if (passCount <= 1 || dateStep <= 0) {
    return [{
      index: 0,
      total: 1,
      fromDate: originDate,
      toDate: targetDate,
      days: Math.max(0, Number(days) || 0),
    }];
  }

  const windows = [];
  let previousOffset = 0;
  for (let index = 1; index <= passCount; index += 1) {
    const offset = index === passCount
      ? dateStep
      : Math.max(previousOffset + 1, Math.round((dateStep * index) / passCount));
    const fromDate = addIsoDays(originDate, previousOffset) || originDate;
    const toDate = addIsoDays(originDate, offset) || targetDate;
    windows.push({
      index: index - 1,
      total: passCount,
      fromDate,
      toDate,
      days: Math.max(1, offset - previousOffset),
    });
    previousOffset = offset;
  }
  return windows;
};

const attachStorylineIdsByIndexes = (events, decodedStorylineUpdates) => {
  const resultEvents = normalizeArray(events).map((event) => ({
    ...(event && typeof event === "object" ? event : {}),
    storylineIds: normalizeArray(event?.storylineIds),
  }));

  for (const update of normalizeArray(decodedStorylineUpdates)) {
    const storylineId = normalizeString(update?.id);
    if (!storylineId) continue;
    for (const eventIndex of normalizeArray(update?.eventIndexes)) {
      if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= resultEvents.length) continue;
      resultEvents[eventIndex].storylineIds = [...new Set([
        ...normalizeArray(resultEvents[eventIndex].storylineIds).map(normalizeString).filter(Boolean),
        storylineId,
      ])].slice(0, 6);
    }
  }

  return resultEvents;
};

const attachDecodedStorylineIds = (events, decodedStorylineUpdates, passLabel = "pass") =>
  attachStorylineIdsByIndexes(
    normalizeArray(events).map((event, index) => ({
      ...(event && typeof event === "object" ? event : {}),
      // Unique internal ids prevent same-index events from different passes from
      // collapsing into one generated-event-N during the final canonical apply.
      id: `${passLabel}-${normalizeString(event?.id) || `event-${index + 1}`}`,
    })),
    decodedStorylineUpdates,
  );

const filterBoundLedgerUpdatesToKeptEvents = (updates, allEvents, keptEvents) => {
  const allIds = normalizeArray(allEvents)
    .map((event) => normalizeString(event?.id))
    .filter(Boolean);
  const keptIds = new Set(
    normalizeArray(keptEvents)
      .map((event) => normalizeString(event?.id))
      .filter(Boolean),
  );

  return normalizeArray(updates).filter((update) => {
    const serialized = JSON.stringify(update ?? {});
    const referenced = allIds.filter((id) => serialized.includes(id));
    if (!referenced.length) return true;
    return referenced.some((id) => keptIds.has(id));
  });
};

const filterStorylineUpdatesAfterIntegrityScreen = ({
  updates,
  allEvents,
  existingStorylines,
  dropped,
} = {}) => {
  const existingIds = new Set(
    normalizeArray(existingStorylines)
      .map((entry) => normalizeString(entry?.id))
      .filter(Boolean),
  );

  const fatalDroppedIds = new Set(
    normalizeArray(dropped)
      .filter((entry) =>
        ["NON_BELLIGERENT_WARTIME_CAUSALITY"].includes(
          normalizeString(entry?.route),
        )
      )
      .map((entry) => normalizeString(entry?.id))
      .filter(Boolean),
  );

  if (!fatalDroppedIds.size) return normalizeArray(updates);

  const fatalIndexes = new Set();
  normalizeArray(allEvents).forEach((event, index) => {
    if (fatalDroppedIds.has(normalizeString(event?.id))) {
      fatalIndexes.add(index);
    }
  });

  return normalizeArray(updates).filter((update) => {
    const id = normalizeString(update?.id);
    if (!id || existingIds.has(id)) return true;

    const indexes = normalizeArray(update?.eventIndexes)
      .filter((index) => Number.isInteger(index) && index >= 0);

    if (!indexes.length) return true;

    // A NEW storyline whose only establishing event(s) were rejected for an
    // objective causal impossibility must not survive invisibly and poison the
    // next pass. Existing selected storylines are intentionally preserved so
    // routine no-delta cards can collapse into hidden state updates.
    return !indexes.every((index) => fatalIndexes.has(index));
  });
};


const WORLD_WAR_TRANSITION_HINTS = Object.freeze({
  start: /\b(declar(?:e|es|ed|ation)|war begins|hostilities begin|invad(?:e|es|ed|ing|sion)|opens? hostilities)\b/i,
  "join-a": /\b(joins?|enters?|interven(?:e|es|ed|tion)|declares? war)\b/i,
  "join-b": /\b(joins?|enters?|interven(?:e|es|ed|tion)|declares? war)\b/i,
  leave: /\b(leaves?|withdraws?|withdrawal|exits?|separate peace)\b/i,
  ceasefire: /\b(cease[- ]?fire|armistice|truce|suspends? hostilities)\b/i,
  resume: /\b(resumes? hostilities|cease[- ]?fire collapses?|armistice collapses?|fighting resumes?)\b/i,
  end: /\b(peace|surrenders?|capitulat(?:e|es|ed|ion)|war ends?|ends? the war|peace settlement)\b/i,
});

const normalizeWorldWarEventLinks = (candidate) => {
  if (!candidate || typeof candidate !== "object") return { rebound: 0 };
  const events = normalizeArray(candidate?.events);
  const updates = decodeWarUpdates(candidate?.warUpdates);
  let rebound = 0;

  const normalized = updates.map((update) => {
    const warId = normalizeString(update?.id);
    const supplied = normalizeArray(update?.eventIndexes)
      .map(Number)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length);

    const sameWar = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => normalizeString(event?.warId) === warId);

    const hint = WORLD_WAR_TRANSITION_HINTS[normalizeString(update?.op).toLowerCase()];
    const semantic = hint
      ? sameWar.filter(({ event }) =>
          hint.test(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`))
      : [];

    let eventIndexes = [];
    if (semantic.length === 1) {
      eventIndexes = [semantic[0].index];
    } else if (sameWar.length === 1) {
      eventIndexes = [sameWar[0].index];
    } else {
      const suppliedSameWar = supplied.filter((index) =>
        normalizeString(events[index]?.warId) === warId);
      const suppliedSemantic = semantic.length
        ? suppliedSameWar.filter((index) => semantic.some((row) => row.index === index))
        : suppliedSameWar;
      if (suppliedSemantic.length === 1) eventIndexes = suppliedSemantic;
    }

    if (JSON.stringify(eventIndexes) !== JSON.stringify(supplied)) rebound += 1;
    return {
      ...update,
      eventIndexes,
      eventIds: [],
    };
  });

  candidate.warUpdates = normalized;
  if (rebound) {
    console.info(
      `[OH war native binding] rebound ${rebound} war ledger record(s) from event.warId and transition semantics.`,
    );
  }
  return { rebound, updates: normalized };
};

// Lightweight in-memory commit used BETWEEN hidden world passes. It deliberately
// does not write storage, capture rollback snapshots, fire turn-complete, compact
// history, or call the curator/unit/territory semantic directors. Those expensive
// canonical passes run ONCE after all world windows finish.
//
// The next world pass still sees concrete event impacts, diplomacy and storyline
// state, which is the causal information needed to stop a mid-jump crisis from
// disappearing. The final canonical apply starts from the original save and
// processes the accumulated events exactly once.
const advanceWorkingBundleForWorldPass = async ({
  bundle,
  colors,
  result,
  passNumber,
  signal,
}) => {
  await yieldToUiFrame(signal);
  const priorEvents = normalizeEvents(bundle.events);
  const generatedEvents = normalizeArray(result.events)
    .map((entry, index) => normalizeGeneratedEvent({
      ...entry,
      id: normalizeString(entry?.id) || `world-pass-${passNumber}-event-${index + 1}`,
      source: entry?.source || result.generation?.source || "ai",
    }, index))
    .filter(Boolean);
  const freshEvents = dedupeGeneratedEvents(priorEvents, generatedEvents);

  const nextGame = normalizeGameData({
    ...bundle.game,
    gameDate: normalizeString(result.stopDate) || bundle.game.gameDate,
    // Internal windows are not user turns. The canonical round increments once
    // when applySimulationResult commits the full jump.
    round: bundle.game.round || 1,
  });

  const nextActions = normalizeActions(bundle.actions).map((action) => ({
    ...action,
    status: action.status === "planned" && result.clearActions ? "resolved" : action.status,
  }));

  const { colors: nextColors, world: worldWithImpacts } = applyEventImpactsToWorld({
    colors,
    events: freshEvents,
    game: nextGame,
    world: {
      ...bundle.world,
      activeCatalyst: result.catalyst ?? bundle.world?.activeCatalyst ?? null,
      actionSuggestions: [],
      lastJumpMode: normalizeString(result.mode),
      lastJumpSummary: normalizeString(result.summary),
      lastJumpTargetDate: nextGame.gameDate,
    },
  });

  const warMerge = applyWarUpdates({
    world: worldWithImpacts,
    updates: normalizeArray(result.warUpdates),
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: bundle.game.round || 1,
  });

  const diplomaticMerge = applyDiplomaticUpdates({
    world: warMerge.world,
    relationUpdates: normalizeArray(result.relationUpdates),
    agreementUpdates: normalizeArray(result.agreementUpdates),
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: bundle.game.round || 1,
  });

  const storylineMerge = applyWorldStorylineUpdates({
    world: diplomaticMerge.world,
    updates: normalizeArray(result.storylineUpdates),
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: bundle.game.round || 1,
  });
  let nextWorld = storylineMerge.world;

  await yieldToUiFrame(signal);
  let nextChats = [...normalizeChats(bundle.chats)];
  for (const event of freshEvents) {
    for (const createdChat of normalizeArray(event?.impacts?.createdChats)) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, nextWorld, {
        fallbackTitle: event.title,
        playerName: bundle.game.country,
      });
      if (nextChat) nextChats.unshift(dateGeneratedChatOpener(nextChat, event.date || nextGame.gameDate));
      await yieldToUiFrame(signal);
    }
  }
  for (const chatLike of normalizeArray(result.outreach)) {
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", nextWorld, {
      playerName: bundle.game.country,
    });
    if (nextChat) nextChats.unshift(dateGeneratedChatOpener(nextChat, nextGame.gameDate));
  }
  nextChats = reconcileStableChatsForPlayer(nextChats, nextWorld, bundle.game.country);

  return {
    bundle: {
      actions: nextActions,
      chats: nextChats,
      events: [...priorEvents, ...freshEvents],
      game: nextGame,
      world: nextWorld,
    },
    colors: nextColors,
    freshEvents,
  };
};

// Phase 6A.1: event density is a CEILING, never a quota. The old 29-37
// minimum for a one-year skip effectively told the model to fill a calendar,
// which strongly rewarded memorized historical chronology. Quiet periods and
// uneven event density are valid; the Curator still filters visible output.
const eventBudgetForDays = (days) => {
  if (days < 1) return 1;   // sub-day skip (e.g. 6 hours)
  if (days <= 7) return 3;
  if (days <= 31) return 10;
  if (days <= 92) return 12;
  if (days <= 184) return 18;
  return 24;
};

// Human-readable label for the skipped span, used in the AI prompt. Collapses
// whole-day counts into weeks/months/years where they divide evenly.
const formatDurationLabel = (days) => {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const whole = Math.round(days);
  const pluralize = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (whole % 365 === 0) return pluralize(whole / 365, "year");
  if (whole % 30 === 0) return pluralize(whole / 30, "month");
  if (whole % 7 === 0) return pluralize(whole / 7, "week");
  return pluralize(whole, "day");
};

export const simulateTimelineJump = async ({ days, mode = "jump", signal } = {}) => {
  beginSimulation();
  try {
    // Paint the spinner/Timeline state before any save normalization or migration.
    await yieldToUiFrame(signal);
    let initialBundle = await readGameStateBundle({ force: false });
    await yieldToUiFrame(signal);
    const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: false });
    await yieldToUiFrame(signal);

    const diplomaticMigration = migrateLegacyDiplomaticState({
      world: initialBundle.world,
      events: initialBundle.events,
      chats: initialBundle.chats,
      game: initialBundle.game,
    });
    await yieldToUiFrame(signal);
    if (diplomaticMigration.migrated) {
      initialBundle = { ...initialBundle, world: diplomaticMigration.world };
      console.info(
        `[OH diplomacy migration 7B] scanned ${diplomaticMigration.scannedEvents} legacy event(s) and ` +
        `${diplomaticMigration.scannedChats || 0} chat thread(s); seeded ${diplomaticMigration.agreementsAdded} agreement(s) ` +
        `(${diplomaticMigration.chatAgreementsAdded || 0} from explicit standing-alliance chat evidence) and ` +
        `${diplomaticMigration.relationsAdded} sparse relation(s).`,
      );
    }

    // Fractional days are allowed so sub-day skips (e.g. 6h = 0.25) work; the
    // persisted game date itself advances in whole days.
    const safeDays = Math.max(0, Number(days) || 0);
    if (safeDays <= 0) {
      throw new Error("Choose a time-skip amount greater than zero.");
    }

    const dateStep = Math.max(0, Math.round(safeDays));
    const originDate = normalizeString(initialBundle.game.gameDate);
    const targetDate = dateStep >= 1
      ? (addIsoDays(originDate, dateStep) || originDate)
      : originDate;
    if (dateStep >= 1 && parseIsoDate(originDate) && targetDate === originDate) {
      throw new Error("The requested jump exceeds the supported date range.");
    }

    const windows = buildWorldPassWindows({
      originDate,
      targetDate,
      dateStep,
      days: safeDays,
      mode,
    });

    let totalMaxEvents = eventBudgetForDays(safeDays);
    const initialPlannedActionCount = normalizeActions(initialBundle.actions)
      .filter((action) => action.status === "planned").length;
    if (initialPlannedActionCount > 0) {
      totalMaxEvents = Math.min(
        37,
        Math.max(totalMaxEvents, 4 + Math.min(initialPlannedActionCount, 12)),
      );
    }

    let remainingEventBudget = totalMaxEvents;
    let workingBundle = {
      actions: initialBundle.actions,
      chats: initialBundle.chats,
      events: initialBundle.events,
      game: initialBundle.game,
      world: initialBundle.world,
    };
    let workingColors = baseColors;

    const accumulatedEvents = [];
    const accumulatedOutreach = [];
    const accumulatedStorylineUpdates = [];
    const accumulatedWarUpdates = [];
    const accumulatedRelationUpdates = [];
    const accumulatedAgreementUpdates = [];
    const accumulatedSummaries = [];
    const breadthRepairContexts = [];
    const passGenerations = [];
    let latestCatalyst = null;
    let clearActions = false;

    const taskKey = mode === "auto" ? "autoJumpForward" : "jumpForward";

    console.info(
      `[OH World Simulation 6B.5] ${windows.length} internal world pass(es) for ${originDate} → ${targetDate}; total visible-event ceiling ${totalMaxEvents}`,
    );

    for (let passIndex = 0; passIndex < windows.length; passIndex += 1) {
      const window = windows[passIndex];
      const passOriginDate = normalizeString(workingBundle.game.gameDate) || window.fromDate;
      const passTargetDate = window.toDate;
      const passesLeft = windows.length - passIndex;

      await yieldToUiFrame(signal);
      const variables = await buildTemplateVariables(workingBundle, {
        taskKey,
        consolidatedHistoryMaxChars: WORLD_SIMULATION_CONSOLIDATED_HISTORY_MAX_CHARS,
        consolidatedHistorySelection: "coverage",
        historicalAnchorActivationChars: WORLD_SIMULATION_HISTORICAL_ANCHOR_ACTIVATION_CHARS,
        historicalAnchorMaxChars: WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_CHARS,
        historicalAnchorMaxItems: WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_ITEMS,
        targetDate: passTargetDate,
      });
      await yieldToUiFrame(signal);
      const worldInitiative = await buildWorldInitiativeContextBackground(
        workingBundle,
        { targetDate: passTargetDate },
        signal,
      );
      variables.worldInitiativeContext = worldInitiative.text;

      const plannedActionCount = normalizeActions(workingBundle.actions)
        .filter((action) => action.status === "planned").length;

      // The old max-only ceiling remains global. Each hidden pass gets a bounded
      // fair share plus a little headroom; unused capacity carries forward.
      const localCeiling = eventBudgetForDays(window.days);
      const fairShare = Math.max(1, Math.ceil(remainingEventBudget / Math.max(1, passesLeft)));
      let passMaxEvents = remainingEventBudget <= 0
        ? 0
        : Math.max(
            1,
            Math.min(remainingEventBudget, localCeiling, fairShare + 2),
          );
      if (plannedActionCount > 0 && remainingEventBudget > 0) {
        passMaxEvents = Math.min(
          remainingEventBudget,
          Math.max(passMaxEvents, Math.min(6, 2 + plannedActionCount)),
        );
      }

      console.info(
        `[OH world-pass ${passIndex + 1}/${windows.length}] ${passOriginDate} → ${passTargetDate}; ` +
        `storylines ${normalizeArray(workingBundle.world?.storylines).length}; ` +
        `attention ${worldInitiative.analysis?.attentionCount || 0}; event cap ${passMaxEvents}`,
      );

      const durationLabel = formatDurationLabel(window.days);

      const { generation, payload } = await runJsonTask(taskKey, {
        fallback: () => fallbackJumpSimulation({
          bundle: workingBundle,
          days: window.days || 1,
          mode,
          targetDate: passTargetDate,
        }),
        signal,
        timeoutMs: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 300000 : 0,
        userMessage:
          mode === "auto"
            ? `Simulate an auto-jump and stop at the next genuinely notable or player-relevant event. Return JSON only. ` +
              `Generate ONLY causally warranted new developments before that stop point, at most ${passMaxEvents} events. ` +
              `There is no hard event-count quota. Do not pad the calendar, but do not confuse a lack of major geopolitical change with a lack of history: search for ordinary consequential developments and human/public texture as well as major events before deciding the world is quiet. ` +
              `Persistent storylines remain autonomous even when deferred from focused attention: a material endogenous development from their own actors/conditions may reactivate them, while routine continuation stays hidden. Obey any 35-day reappraisal / 70-day anti-stasis directives in the Native World Director context. ` +
              `Return compact storylineUpdates for every due persistent process, warUpdates for every canonical belligerency transition, relationUpdates for material bilateral political changes, and agreementUpdates for formal treaty/commitment lifecycle changes; use empty strings when a ledger does not change.`
            : `This is internal whole-world pass ${passIndex + 1} of ${windows.length} inside one user-requested fixed jump. ` +
              `Simulate ONLY ${passOriginDate} through ${passTargetDate} (${durationLabel}) and return JSON only. ` +
              `Generate ONLY causally warranted new developments, at most ${passMaxEvents} visible events. ` +
              `There is no hard event-count quota and no requirement to spread cards evenly. The event cap is a ceiling, not a target. ` +
              `Persistent storylines are autonomous causal processes. Scheduler selection prioritizes focused review; it does NOT grant or deny permission for actors inside deferred processes to act. A deferred storyline may reactivate through a genuinely material endogenous development from its own actors/conditions, but routine artillery, patrols, meetings, weather-only stasis, and paraphrases of an unchanged front remain non-events. ` +
              `For selected active wars/crises, actually simulate each side's objectives, capabilities, constraints, opposition and result before concluding the equilibrium holds; smaller powers may hold, counterattack or exploit overextension, and static trench lines may still produce command, supply, morale, political, diplomatic or attritional consequences. Obey the 35-day reappraisal and 70-day anti-stasis directives in the Native World Director context without inventing a card merely to satisfy them. ` +
              `Advance scheduler-selected persistent storylines, but do NOT let one crisis monopolize the world: ` +
              `also evaluate independent diplomacy, domestic politics, economics, industry/technology, social and public life, military change, regional pressures, human/personality texture and genuinely new initiatives where current causes warrant them. ` +
              `For a month-scale whole-world pass, a final set of only 0-3 visible events is unusually sparse: before finalizing it, deliberately complete the exploration slate and re-check unrelated regions and actors across major, ordinary-consequential, and human/public lanes. Finding one or two excellent events is not a reason to stop searching. This is search calibration, NOT a minimum count; never invent an event merely to raise the number. ` +
              `Do not create meta/calendar padding or empty process churn for breadth. Small but concrete events and human texture are legitimate history, not filler. Return compact storylineUpdates for every due process and every new unresolved process, with semantic state through THIS pass stopDate. ` +
              `Return warUpdates for every declaration/join/leave/ceasefire/resume/end in this pass; hard combat is legal only inside an active canonical war. Return relationUpdates only for material bilateral political shifts and agreementUpdates for every formal signed/ratified/concluded commitment or later lifecycle change; empty strings are correct when unchanged.`,
        validatePayload: async (candidate, { finalAttempt } = {}) => {
          const strict = !finalAttempt;
          const eventCount = normalizeArray(candidate?.events).length;

          if (strict && eventCount > passMaxEvents) {
            return `$.events must contain at most ${passMaxEvents} events in this internal world pass; received ${eventCount}. The cap is a ceiling, so keep the strongest and most representative events rather than padding or overflowing it.`;
          }
          if (strict && plannedActionCount > 0 && eventCount === 0) {
            return "$.events must contain at least one event while planned player actions are awaiting resolution.";
          }

          const dateError = validateTimelineDates({
            candidate,
            mode,
            originDate: passOriginDate,
            targetDate: passTargetDate,
            requireAdvance: window.days >= 1,
          });
          if (dateError) {
            if (strict) return dateError;
            clampTimelineDates(candidate, {
              mode,
              originDate: passOriginDate,
              targetDate: passTargetDate,
            });
          }

          // Validate/salvage concrete world-state mutations BEFORE the war ledger.
          //
          // A model retry can reference a unit that existed in history but has
          // since been deleted from canonical world.units. validateGeneratedWorldChanges
          // owns that current-ledger check: strict attempts return a precise stale-unit
          // error; the final attempt drops only the invalid op instead of destroying
          // an otherwise valid whole-world pass.
          //
          // The war ledger must see the sanitized impacts. Otherwise a stale
          // unitOps attack is treated as real battlefield combat first and can fail
          // for missing warId before unit validation ever gets a chance to run.
          const worldChangeError = await validateGeneratedWorldChanges(
            candidate,
            workingBundle.world,
            { strictTransfers: strict },
          );
          if (worldChangeError) return worldChangeError;

          // A unit attack mutation may not manufacture semantic combat that the
          // event itself never narrates. Apply the same guard used after native
          // post-processing before war reconciliation, including model-authored
          // unitOps in the main world payload.
          const unsupportedMainPassAttacks = stripUnsupportedUnitAttackOps(candidate?.events);
          if (unsupportedMainPassAttacks.length) {
            console.warn(
              `[OH unit-op semantic guard] dropped ${unsupportedMainPassAttacks.length} unsupported main-pass attack op(s) ` +
              `from non-combat event(s): ` +
              unsupportedMainPassAttacks
                .map((entry) => `"${entry.title || `event ${entry.eventIndex + 1}`}"`)
                .join(", "),
            );
          }

          // Semantic combat is stronger evidence than missing bookkeeping, but a
          // NEW war additionally requires direct adversarial evidence in the
          // event prose. Two names, a warId, or military vocabulary alone cannot
          // create belligerency.
          const combatWarRepair = reconcileCombatWarState(candidate, {
            world: workingBundle.world,
          });
          if (combatWarRepair.unresolved.length && strict) {
            const first = combatWarRepair.unresolved[0];
            return `Combat event "${first.title || `event ${first.index + 1}`}" could not be canonically bound: ${first.reason}. ` +
              "If this is real battlefield combat, name the direct opposing combatants and supply/bind the correct war lifecycle. If it is deployment, readiness, exercise, deterrence, military cooperation, or other non-combat activity, remove warId/combatants/warUpdates rather than inventing belligerency.";
          }

          // Bookkeeping hardening: the model decides WHAT happened; native code
          // owns event indexes/ids and causal linkage. Model-supplied numbers are
          // compatibility hints only and are rebound from the actual payload.
          normalizeWorldWarEventLinks(candidate);

          let warError = validateWarLedgerPayload(candidate, {
            world: workingBundle.world,
          });

          // Final-attempt fail-soft: if combat is still structurally ambiguous
          // after one corrective retry, drop ONLY the offending combat event(s)
          // instead of discarding the entire whole-world simulation. This is a
          // last resort; unambiguous combat is materialized above and genuine
          // canonical-war violations remain errors.
          if (warError && !strict && combatWarRepair.unresolved.length) {
            const dropIndexes = new Set(combatWarRepair.unresolved.map((entry) => entry.index));

            // R2.45: war lifecycle bookkeeping is causal with the event(s) that
            // establish it. Snapshot the native-bound links BEFORE removing an
            // ambiguous combat event. If every establishing event for a same-pass
            // war update is being discarded, discard that orphan update too.
            //
            // This is deliberately index-causal rather than warId-heuristic:
            // unrelated updates for the same war survive, existing canonical
            // world.wars are untouched, and genuine ledger violations still fail
            // the strict validator below.
            const boundWarUpdatesBeforeSalvage = decodeWarUpdates(candidate?.warUpdates);
            const orphanedWarUpdateIndexes = new Set();
            const orphanedWarUpdateLabels = [];
            boundWarUpdatesBeforeSalvage.forEach((update, updateIndex) => {
              const eventIndexes = normalizeArray(update?.eventIndexes)
                .map(Number)
                .filter((index) => Number.isInteger(index) && index >= 0);
              if (!eventIndexes.length || !eventIndexes.every((index) => dropIndexes.has(index))) {
                return;
              }
              orphanedWarUpdateIndexes.add(updateIndex);
              orphanedWarUpdateLabels.push(
                `${normalizeString(update?.id) || "unknown-war"} (${normalizeString(update?.op) || "update"})`,
              );
            });

            candidate.events = normalizeArray(candidate.events)
              .filter((_, index) => !dropIndexes.has(index));

            if (orphanedWarUpdateIndexes.size) {
              candidate.warUpdates = boundWarUpdatesBeforeSalvage
                .filter((_, index) => !orphanedWarUpdateIndexes.has(index));
              console.warn(
                `[OH war ledger salvage R2.45] dropped ${orphanedWarUpdateIndexes.size} orphaned war lifecycle update(s) ` +
                `whose establishing event was removed: ${orphanedWarUpdateLabels.join(", ")}.`,
              );
            }

            if (dropIndexes.size) {
              console.warn(
                `[OH war ledger salvage] dropped ${dropIndexes.size} ambiguous hard-combat event(s) ` +
                "after the model failed its corrective retry; preserving the rest of the world pass.",
              );
              normalizeWorldWarEventLinks(candidate);
              warError = validateWarLedgerPayload(candidate, {
                world: workingBundle.world,
              });
            }
          }
          if (warError) return warError;

          const diplomaticError = validateDiplomaticLedgerPayload(candidate, {
            world: workingBundle.world,
            allowNativeBinding: true,
          });
          if (diplomaticError) return diplomaticError;

          normalizeWorldStorylineEventLinks(candidate, {
            world: workingBundle.world,
          });

          // A quiet update for a DEFERRED storyline is harmless extra bookkeeping,
          // not a reason to reject an otherwise-valid 30k-token world simulation.
          // Strip it before validation on the FIRST attempt. Material deferred re-entry
          // still carries eventIndexes and remains subject to the strict trigger checks.
          const deferredSalvage = stripQuietDeferredStorylineUpdates(
            candidate,
            worldInitiative.analysis?.deferredStorylines,
          );
          if (deferredSalvage.strippedIds.length) {
            console.warn(
              `[OH World Storyline salvage] stripped ${deferredSalvage.strippedIds.length} quiet deferred bookkeeping update(s): ` +
              deferredSalvage.strippedIds.join(", "),
            );
          }

          const storylineError = validateWorldStorylinePayload(candidate, {
            existingStorylines: workingBundle.world?.storylines,
            selectedStorylines: worldInitiative.analysis?.attentionStorylines,
            deferredStorylines: worldInitiative.analysis?.deferredStorylines,
            originDate: passOriginDate,
            stopDate: normalizeString(candidate?.stopDate) || passTargetDate,
            world: workingBundle.world,
            // Fix 07.2 / 07.2B: anti-stasis AND a completely missing selected
            // storyline update are repaired LOCALLY after the whole-world payload
            // survives normal structural validation. One stale/omitted process
            // must never discard unrelated valid events from the entire turn.
            enforceAntiStasis: false,
            enforceSelectedCoverage: false,
          });
          if (storylineError) return storylineError;

          const explorationAuditError = validateWorldExplorationAudit(
            candidate,
            worldInitiative.analysis,
            {
              finalAttempt,
              world: workingBundle.world,
              gameCountry: workingBundle.game?.country,
            },
          );
          if (explorationAuditError) return explorationAuditError;

          return "";
        },
        variables,
      });

      // Fix 07.2 / 07.2B: preserve the accepted whole-world response. A selected
      // storyline that is objectively stale OR was omitted from storylineUpdates gets
      // one small targeted repair call. A failed local repair never triggers the
      // deterministic whole-turn fallback; the process simply stays overdue.
      await repairAntiStasisStorylines({
        payload,
        bundle: workingBundle,
        analysis: worldInitiative.analysis,
        originDate: passOriginDate,
        targetDate: passTargetDate,
        passMaxEvents,
        signal,
      });

      await yieldToUiFrame(signal);
      const nativeExplorationAudit = deriveWorldExplorationAudit(
        payload,
        worldInitiative.analysis,
        {
          world: workingBundle.world,
          gameCountry: workingBundle.game?.country,
        },
      );

      breadthRepairContexts.push({
        analysis: worldInitiative.analysis,
        explorationAudit: {
          quietSlotIds: nativeExplorationAudit.quietSlotIds,
          nonQuietCount: nativeExplorationAudit.nonQuietCount,
          slotCount: nativeExplorationAudit.slotCount,
        },
        originDate: passOriginDate,
        targetDate: passTargetDate,
        horizonDays: window.days,
        eventCeiling: passMaxEvents,
        generationSource: generation?.source || "ai",
      });

      const decodedStorylineUpdates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
      const passEvents = attachDecodedStorylineIds(
        payload?.events,
        decodedStorylineUpdates,
        `world-pass-${passIndex + 1}`,
      );
      const decodedWarUpdates = bindWarUpdatesToEvents(
        decodeWarUpdates(payload?.warUpdates),
        passEvents,
      );
      const decodedRelationUpdates = bindRelationUpdatesToEvents(
        decodeRelationUpdates(payload?.relationUpdates),
        passEvents,
      );
      const decodedAgreementUpdates = bindAgreementUpdatesToEvents(
        decodeAgreementUpdates(payload?.agreementUpdates),
        passEvents,
      );

      // Native integrity runs BEFORE the hidden working-world commit. The final
      // semantic curator still decides timeline worth, but objectively invalid
      // or obvious no-delta candidates must not feed later internal passes.
      const screened = screenGeneratedWorldEvents({
        events: passEvents,
        world: workingBundle.world,
        game: workingBundle.game,
        analysis: worldInitiative.analysis,
      });

      const screenedWarUpdates = filterBoundLedgerUpdatesToKeptEvents(
        decodedWarUpdates,
        passEvents,
        screened.events,
      );
      const screenedRelationUpdates = filterBoundLedgerUpdatesToKeptEvents(
        decodedRelationUpdates,
        passEvents,
        screened.events,
      );
      const screenedAgreementUpdates = filterBoundLedgerUpdatesToKeptEvents(
        decodedAgreementUpdates,
        passEvents,
        screened.events,
      );

      const screenedStorylineUpdates = filterStorylineUpdatesAfterIntegrityScreen({
        updates: decodedStorylineUpdates,
        allEvents: passEvents,
        existingStorylines: workingBundle.world?.storylines,
        dropped: screened.dropped,
      });

      const passResult = {
        catalyst: payload?.catalyst ?? null,
        clearActions: payload?.clearActions !== false,
        events: screened.events,
        mode,
        outreach: normalizeArray(payload?.diplomaticOutreach),
        storylineUpdates: screenedStorylineUpdates,
        warUpdates: screenedWarUpdates,
        relationUpdates: screenedRelationUpdates,
        agreementUpdates: screenedAgreementUpdates,
        stopDate: normalizeString(payload?.stopDate) || passTargetDate,
        summary: stripWorldSweepAudit(payload?.summary),
        generation,
      };

      await yieldToUiFrame(signal);
      const advanced = await advanceWorkingBundleForWorldPass({
        bundle: workingBundle,
        colors: workingColors,
        result: passResult,
        passNumber: passIndex + 1,
        signal,
      });
      await yieldToUiFrame(signal);
      workingBundle = advanced.bundle;
      workingColors = advanced.colors;

      accumulatedEvents.push(...advanced.freshEvents);
      accumulatedOutreach.push(...normalizeArray(passResult.outreach));
      accumulatedStorylineUpdates.push(...normalizeArray(passResult.storylineUpdates));
      accumulatedWarUpdates.push(...normalizeArray(passResult.warUpdates));
      accumulatedRelationUpdates.push(...normalizeArray(passResult.relationUpdates));
      accumulatedAgreementUpdates.push(...normalizeArray(passResult.agreementUpdates));
      if (passResult.summary) accumulatedSummaries.push(passResult.summary);
      if (passResult.catalyst) latestCatalyst = passResult.catalyst;
      clearActions = clearActions || passResult.clearActions;
      passGenerations.push(generation ?? { source: "ai", fallbackReason: "" });

      remainingEventBudget = Math.max(
        0,
        remainingEventBudget - advanced.freshEvents.length,
      );

      console.info(
        `[OH world-pass ${passIndex + 1}/${windows.length}] produced ${advanced.freshEvents.length} new event(s), ` +
        `${normalizeArray(passResult.storylineUpdates).length} storyline update(s), ${normalizeArray(passResult.warUpdates).length} war update(s), ` +
        `${normalizeArray(passResult.relationUpdates).length} relation update(s), ${normalizeArray(passResult.agreementUpdates).length} agreement update(s); ` +
        `${normalizeArray(workingBundle.world?.storylines).length} storyline(s), ` +
        `${normalizeArray(workingBundle.world?.wars).filter((war) => war?.status !== "ended").length} current conflict(s).`,
      );
    }

    const fallbackReasons = passGenerations
      .map((entry) => normalizeString(entry?.fallbackReason))
      .filter(Boolean);
    const allAi = passGenerations.every((entry) => (entry?.source || "ai") === "ai");
    const finalGeneration = {
      source: allAi ? "ai" : "mixed",
      fallbackReason: fallbackReasons.join(" | "),
      passCount: windows.length,
    };

    const breadthRepairContext = (() => {
      if (mode !== "jump" || safeDays < WORLD_BREADTH_REPAIR_MIN_DAYS || safeDays > WORLD_BREADTH_REPAIR_MAX_DAYS) {
        return null;
      }
      const ranked = breadthRepairContexts
        .map((context) => ({
          context,
          quietCount: quietWorldBreadthSlots(context?.analysis, context?.explorationAudit).length,
        }))
        .sort((a, b) => b.quietCount - a.quietCount);
      const chosen = ranked[0]?.context;
      if (!chosen) return null;
      return {
        ...chosen,
        originDate,
        targetDate,
        horizonDays: safeDays,
        eventCeiling: totalMaxEvents,
        generationSource: allAi ? "ai" : "mixed",
      };
    })();

    const finalResult = {
      breadthRepairContext,
      catalyst: latestCatalyst,
      clearActions,
      events: accumulatedEvents,
      mode,
      outreach: accumulatedOutreach,
      storylineUpdates: accumulatedStorylineUpdates,
      warUpdates: accumulatedWarUpdates,
      relationUpdates: accumulatedRelationUpdates,
      agreementUpdates: accumulatedAgreementUpdates,
      stopDate: targetDate,
      summary: accumulatedSummaries.filter(Boolean).join(" ").slice(0, 5000),
      generation: finalGeneration,
    };

    // Canonicalization/persistence happens ONCE. One semantic curator pass, one
    // unit-director pass, one territory-director pass, one rollback snapshot and
    // one visible round increment — independent of the number of hidden windows.
    await yieldToUiFrame(signal);
    return applySimulationResult({
      baseActions: initialBundle.actions,
      baseChats: initialBundle.chats,
      baseColors,
      baseEvents: initialBundle.events,
      baseGame: initialBundle.game,
      baseWorld: initialBundle.world,
      result: finalResult,
      signal,
    });
  } finally {
    endSimulation();
  }
};

export const simulateAutoJump = async ({ days = 365, signal } = {}) =>
  simulateTimelineJump({ days, mode: "auto", signal });

const GAME_MASTER_MODE_SET = new Set(["direct", "exact-event", "world-intervention"]);

const gmPatchHasContent = (patch) => {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  return Object.entries(patch).some(([, value]) => {
    if (value == null) return false;
    if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
    return true;
  });
};

const validateGameMasterStatPatches = (patches, world, events) => {
  const normalizedWorld = normalizeWorldState(world);
  const eventCount = normalizeArray(events).length;

  for (let index = 0; index < normalizeArray(patches).length; index += 1) {
    const entry = patches[index];
    const requested = normalizeString(entry?.country);
    const resolution = resolvePolityIdentity(requested, normalizedWorld, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    const canonical = normalizeString(resolution?.resolved);
    if (!canonical) {
      return `$.countryStatPatches[${index}].country could not resolve existing polity "${requested}".`;
    }
    if (!gmPatchHasContent(entry?.patch)) {
      return `$.countryStatPatches[${index}].patch must contain at least one requested Stats field.`;
    }

    for (const eventIndex of normalizeArray(entry?.eventIndexes)) {
      if (!Number.isInteger(Number(eventIndex)) || Number(eventIndex) < 0 || Number(eventIndex) >= eventCount) {
        return `$.countryStatPatches[${index}].eventIndexes contains an index outside this transaction's events array.`;
      }
    }

    const breakdown = entry?.patch?.gdpBreakdown;
    if (breakdown && typeof breakdown === "object") {
      const total = Number(breakdown.agriculture) + Number(breakdown.industry) + Number(breakdown.services);
      if (!Number.isFinite(total) || Math.abs(total - 100) > 0.001) {
        return `$.countryStatPatches[${index}].patch.gdpBreakdown must total exactly 100.`;
      }
    }

    const aggregateRebaseRequested =
      Number.isFinite(Number(entry?.patch?.population?.total)) ||
      Number.isFinite(Number(entry?.patch?.economy?.gdp));
    const sheet = normalizedWorld?.countryStats?.[canonical];
    const hasComponentBaseline = Array.isArray(sheet?.territorialComponents) && sheet.territorialComponents.length > 0;
    if (aggregateRebaseRequested && !hasComponentBaseline) {
      return `$.countryStatPatches[${index}] requests a population/GDP re-baseline for ${canonical}, but that polity has no component-backed canonical Stats baseline yet.`;
    }
  }

  return "";
};

const normalizeGameMasterStatPatches = (patches, world) => {
  const normalizedWorld = normalizeWorldState(world);
  return normalizeArray(patches).map((entry) => {
    const resolution = resolvePolityIdentity(entry?.country, normalizedWorld, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    return {
      ...entry,
      country: normalizeString(resolution?.resolved) || normalizeString(entry?.country),
      eventIndexes: normalizeArray(entry?.eventIndexes)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 0),
    };
  });
};

const GAME_MASTER_PERSISTENT_PROCESS_HINT = /\b(?:crisis|collapse|revolution|uprising|insurgency|civil\s+war|succession|regime\s+rupture|banking\s+emergency|sovereign\s+debt|mass\s+unrest|nationwide\s+strike|general\s+strike|standoff|confrontation|instability|tension|escalat(?:e|es|ed|ing|ion)|de-escalat(?:e|es|ed|ing|ion)|prolonged|ongoing)\b/i;

const validateGameMasterStorylineUpdates = async (candidate, { mode, world, game, request = "" } = {}) => {
  // Native semantic binding owns the causal event links; model-supplied indexes are
  // hints. This mutates only the preview candidate and therefore remains visible
  // before Apply can ever persist it.
  normalizeWorldStorylineEventLinks(candidate, { world });

  const normalizedWorld = normalizeWorldState(world);
  const currentDate = normalizeString(game?.gameDate || game?.startDate);
  const validationError = validateWorldStorylinePayload(candidate, {
    existingStorylines: normalizedWorld.storylines,
    selectedStorylines: [],
    deferredStorylines: [],
    originDate: currentDate,
    stopDate: currentDate,
    enforceAntiStasis: false,
    enforceSelectedCoverage: false,
    world: normalizedWorld,
  });
  if (validationError) return validationError;

  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  if (mode === "world-intervention" && GAME_MASTER_PERSISTENT_PROCESS_HINT.test(normalizeString(request)) && !updates.length) {
    return "World Intervention describes an unresolved or changing multi-turn process, but $.storylineUpdates is empty. Persist that crisis/process in canonical world.storylines (or update/resolve the existing storyline) so the normal World Director inherits it on later turns.";
  }

  const currentPolities = new Map(
    (await buildCurrentCanonicalPolityVocabulary(normalizedWorld))
      .map((name) => normalizeString(name))
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name]),
  );
  // A world intervention may establish a new/restored polity and a persistent
  // crisis involving it in the SAME preview. Lifecycle validation runs first, so
  // those event-driven identities are safe to admit here even though they do not
  // exist in the pre-transaction world yet.
  for (const event of normalizeArray(candidate?.events)) {
    for (const change of normalizeArray(event?.impacts?.polityChanges)) {
      const operation = normalizeString(change?.operation).toLowerCase();
      if (!["create", "restore", "rename", "update"].includes(operation)) continue;
      for (const token of [change?.name, change?.code]) {
        const name = normalizeString(token);
        if (name) currentPolities.set(name.toLowerCase(), name);
      }
    }
  }

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    if (mode !== "direct" && normalizeArray(update?.eventIndexes).length === 0) {
      return `$.storylineUpdates record ${index + 1} must link to at least one authored GM event in ${mode} mode.`;
    }
    for (let participantIndex = 0; participantIndex < normalizeArray(update?.participants).length; participantIndex += 1) {
      const raw = normalizeString(normalizeArray(update.participants)[participantIndex]);
      const resolution = resolvePolityIdentity(raw, normalizedWorld, {
        allowUnknown: false,
        requireActive: false,
        allowCoreMatch: true,
        allowStockBase: true,
      });
      const resolved = normalizeString(resolution?.resolved || raw);
      const canonical = currentPolities.get(resolved.toLowerCase()) || currentPolities.get(raw.toLowerCase()) || "";
      if (!canonical) {
        return `$.storylineUpdates record ${index + 1} participant ${participantIndex + 1} could not resolve to a current or same-transaction canonical polity: "${raw}".`;
      }
      update.participants[participantIndex] = canonical;
    }
  }

  candidate.storylineUpdates = updates;
  return "";
};

const gameMasterPolityKey = (value) => normalizeString(value).toLowerCase();

const resolveGameMasterLifecycleIdentity = (token, world) => {
  const requested = normalizeString(token);
  if (!requested) return "";
  // Callers already hand us the live/normalized world. Re-normalizing it here is
  // surprisingly expensive when this helper is used while scanning map ownership.
  const resolution = resolvePolityIdentity(requested, world, {
    allowUnknown: false,
    // Do NOT ask the generic identity resolver whether a stock/base name is
    // "active". Its stock-base compatibility path intentionally permits ordinary
    // modern maps with no polity registry, but that is not enough evidence for GM
    // lifecycle semantics in a historical save (1915 Poland was the bug here).
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return normalizeString(resolution?.resolved);
};

// GM lifecycle needs PRESENT political existence, not merely "this name exists in
// the stock GADM vocabulary". Build that truth from the authoritative scenario map
// plus explicit lifecycle status. Hybrid/historical maps are the important edge case:
// loadRegionCatalog() contains BOTH stock GADM geography and custom scenario regions,
// so treating every catalog country as current can resurrect a base-map polity that the
// scenario deliberately replaced (1915 Poland inside the Russian Empire was exactly
// that bug). When custom scenario geometry exists, its owner/COUNTRY fields are the
// base political truth; stock catalog countries are only a fallback for a pure stock map.
// IMPORTANT: collect UNIQUE owner tokens first, then resolve them once.
// One authoritative discovery path for the polities that CURRENTLY exist in the
// scenario/save. Round-One bootstrap and GM lifecycle validation both consume this
// same vocabulary so prose/history labels can never silently mint phantom actors.
const buildCurrentCanonicalPolityVocabulary = async (world) => {
  const normalizedWorld = normalizeWorldState(world);
  const ownerTokens = new Set();

  const collect = (token) => {
    const raw = normalizeString(token);
    if (raw) ownerTokens.add(raw);
  };

  for (const [key, entry] of Object.entries(normalizedWorld.polityOverrides || {})) {
    if (normalizeString(entry?.status).toLowerCase() === "active") collect(key);
  }

  // Runtime overrides are authoritative regardless of map type. Legal sovereigns
  // remain current actors even if all of their land is occupied.
  for (const owner of Object.values(normalizedWorld.regionOwnershipOverrides || {})) collect(owner);
  for (const owner of Object.values(normalizedWorld.regionSovereigntyOverrides || {})) collect(owner);

  const scenarioRegions = await readJson(JSON_URLS.regionsGeojson, {
    defaultValue: null,
  }).catch(() => null);
  const scenarioFeatures = normalizeArray(scenarioRegions?.features);

  if (scenarioFeatures.length > 0) {
    for (const feature of scenarioFeatures) {
      const props = feature?.properties || {};
      collect(
        props.owner ||
        props.COUNTRY ||
        props.Country ||
        props.country ||
        toCountryName(props.GID_0 || props.gid0 || props.gid_0) ||
        "",
      );
    }
  } else {
    const catalog = await loadRegionCatalog().catch(() => []);
    for (const region of catalog) {
      const regionId = normalizeString(region?.id);
      collect(
        (regionId && normalizedWorld.regionOwnershipOverrides?.[regionId]) ||
        region?.country ||
        toCountryName(region?.countryCode) ||
        "",
      );
    }
  }

  const byKey = new Map();
  for (const raw of ownerTokens) {
    const resolved =
      resolveGameMasterLifecycleIdentity(raw, normalizedWorld) ||
      toCountryName(raw) ||
      raw;
    const canonical = normalizeString(resolved);
    const key = gameMasterPolityKey(canonical);
    if (key && !byKey.has(key)) byKey.set(key, canonical);
  }

  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
};

const buildGameMasterActivePolitySet = async (world) =>
  new Set((await buildCurrentCanonicalPolityVocabulary(world)).map(gameMasterPolityKey));

// Phase 8B.2.5: the AI authors the CURRENT regime/display name, but native code
// owns stable polity identity and existence semantics. Most importantly, a stock
// map name is NOT proof that the polity currently exists. That distinction is what
// separates "Poland is a known geography" from "Poland is an active state" in 1915.
const normalizeGameMasterPolityLifecycle = (candidate, world, baseActivePolities = new Set()) => {
  const active = new Set(baseActivePolities);

  for (const event of normalizeArray(candidate?.events)) {
    const changes = event?.impacts?.polityChanges;
    if (!Array.isArray(changes)) continue;

    event.impacts.polityChanges = changes.map((change) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) return change;
      const operation = normalizeString(change.operation).toLowerCase();
      const code = normalizeString(change.code);
      if (!code) return change;

      const knownIdentity = resolveGameMasterLifecycleIdentity(code, world);
      const knownKey = gameMasterPolityKey(knownIdentity || code);
      const activeIdentity = knownKey && active.has(knownKey) ? (knownIdentity || code) : "";

      let normalizedChange = change;

      if (["create", "update"].includes(operation) && knownIdentity && !activeIdentity) {
        normalizedChange = {
          ...change,
          operation: "restore",
          code: knownIdentity,
        };
      } else if (operation === "restore" && knownIdentity) {
        normalizedChange = {
          ...change,
          code: knownIdentity,
        };
      }

      const finalOperation = normalizeString(normalizedChange?.operation).toLowerCase();
      const finalCode =
        resolveGameMasterLifecycleIdentity(normalizedChange?.code, world) ||
        toCountryName(normalizeString(normalizedChange?.code)) ||
        normalizeString(normalizedChange?.code);
      const finalKey = gameMasterPolityKey(finalCode);

      if (["create", "restore"].includes(finalOperation) && finalKey) active.add(finalKey);
      if (finalOperation === "dissolve" && finalKey) active.delete(finalKey);

      return normalizedChange;
    });
  }

  return candidate;
};

// Phase 8B.1.5: bind obvious war metadata from the transaction's own linked
// warUpdates before canonical validation. The AI occasionally emits a correct
// START/JOIN/etc. record linked to event 0 but forgets to repeat that same war id
// on the event. That relationship is deterministic, so preview normalization may
// repair it without another AI call or any world mutation. For a START event, the
// opposing sides also provide an unambiguous combatants fallback. Ambiguous or
// conflicting multi-war links are deliberately left untouched so the canonical
// validator still fails closed.
const normalizeGameMasterWarEventBindings = (candidate) => {
  const events = normalizeArray(candidate?.events);
  const updates = decodeWarUpdates(candidate?.warUpdates);
  if (!events.length || !updates.length) return candidate;

  const eventIndexById = new Map(
    events
      .map((event, index) => [normalizeString(event?.id), index])
      .filter(([id]) => Boolean(id)),
  );
  const updatesByEventIndex = new Map();

  const link = (index, update) => {
    if (!Number.isInteger(index) || index < 0 || index >= events.length) return;
    if (!updatesByEventIndex.has(index)) updatesByEventIndex.set(index, []);
    updatesByEventIndex.get(index).push(update);
  };

  for (const update of updates) {
    for (const index of normalizeArray(update?.eventIndexes)) {
      link(Number(index), update);
    }
    for (const eventId of normalizeArray(update?.eventIds)) {
      const index = eventIndexById.get(normalizeString(eventId));
      if (Number.isInteger(index)) link(index, update);
    }
  }

  for (const [eventIndex, linkedUpdates] of updatesByEventIndex.entries()) {
    const event = events[eventIndex];
    if (!event || typeof event !== "object") continue;

    const warIds = [...new Set(
      linkedUpdates
        .map((update) => normalizeString(update?.id))
        .filter(Boolean),
    )];

    if (!normalizeString(event.warId) && warIds.length === 1) {
      event.warId = warIds[0];
    }

    const eventWarId = normalizeString(event.warId);
    if (!eventWarId || normalizeArray(event.combatants).length >= 2) continue;

    const startUpdate = linkedUpdates.find((update) =>
      normalizeString(update?.id) === eventWarId &&
      normalizeString(update?.op).toLowerCase() === "start"
    );
    if (!startUpdate) continue;

    const combatants = [...new Set([
      ...normalizeArray(startUpdate.actors),
      ...normalizeArray(startUpdate.opponents),
    ]
      .map((value) => normalizeString(value))
      .filter(Boolean))]
      .slice(0, 8);

    if (combatants.length >= 2) event.combatants = combatants;
  }

  return candidate;
};

const validateGameMasterPolityLifecycle = (candidate, world, baseActivePolities = new Set()) => {
  const active = new Set(baseActivePolities);

  for (let eventIndex = 0; eventIndex < normalizeArray(candidate?.events).length; eventIndex += 1) {
    const event = normalizeArray(candidate?.events)[eventIndex];
    const changes = normalizeArray(event?.impacts?.polityChanges);

    for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
      const change = changes[changeIndex];
      const operation = normalizeString(change?.operation).toLowerCase();
      const code = normalizeString(change?.code);
      if (!code) continue;

      const knownIdentity = resolveGameMasterLifecycleIdentity(code, world);
      const stableIdentity = knownIdentity || toCountryName(code) || code;
      const stableKey = gameMasterPolityKey(stableIdentity);
      const activeIdentity = stableKey && active.has(stableKey) ? stableIdentity : "";

      if (operation === "create" && activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to CREATE "${code}", but it already resolves to active polity "${activeIdentity}". Use update/rename for the existing polity instead of creating a duplicate identity.`;
      }

      if (operation === "restore" && activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to RESTORE "${code}", but "${activeIdentity}" is already active. Use update/rename if the current regime or display name is changing.`;
      }

      if (operation === "update" && !activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to UPDATE "${code}", but that polity is not currently active. Use restore for a known historical/dormant identity or create for a genuinely new polity.`;
      }

      if (["create", "restore"].includes(operation) && stableKey) active.add(stableKey);
      if (operation === "dissolve" && stableKey) active.delete(stableKey);
    }
  }

  return "";
};

const validateGameMasterBreakawaySovereignty = (candidate) => {
  const createdPolities = new Set();
  for (const event of normalizeArray(candidate?.events)) {
    for (const change of normalizeArray(event?.impacts?.polityChanges)) {
      const operation = normalizeString(change?.operation).toLowerCase();
      if (!["create", "restore"].includes(operation)) continue;
      const code = normalizeString(change?.code);
      const name = normalizeString(change?.name);
      if (code) createdPolities.add(code.toLowerCase());
      if (name) createdPolities.add(name.toLowerCase());
    }
  }
  if (!createdPolities.size) return "";

  const activeBreakawayPairs = [];
  for (const update of normalizeArray(candidate?.warUpdates)) {
    if (normalizeString(update?.op).toLowerCase() !== "start") continue;
    const sideA = normalizeArray(update?.actors).map((value) => normalizeString(value)).filter(Boolean);
    const sideB = normalizeArray(update?.opponents).map((value) => normalizeString(value)).filter(Boolean);
    for (const a of sideA) {
      for (const b of sideB) {
        if (createdPolities.has(a.toLowerCase()) || createdPolities.has(b.toLowerCase())) {
          activeBreakawayPairs.push([a, b]);
        }
      }
    }
  }
  if (!activeBreakawayPairs.length) return "";

  const opposingPair = (fromCode, toCode) => activeBreakawayPairs.some(([a, b]) => {
    const from = normalizeString(fromCode).toLowerCase();
    const to = normalizeString(toCode).toLowerCase();
    return (a.toLowerCase() === to && b.toLowerCase() === from)
      || (b.toLowerCase() === to && a.toLowerCase() === from);
  });

  for (let eventIndex = 0; eventIndex < normalizeArray(candidate?.events).length; eventIndex += 1) {
    const event = normalizeArray(candidate?.events)[eventIndex];
    const transfers = normalizeArray(event?.impacts?.regionTransfers);
    for (let transferIndex = 0; transferIndex < transfers.length; transferIndex += 1) {
      const transfer = transfers[transferIndex];
      const toCode = normalizeString(transfer?.toCode);
      const fromCode = normalizeString(transfer?.fromCode);
      if (!createdPolities.has(toCode.toLowerCase()) || !opposingPair(fromCode, toCode)) continue;
      return `$.events[${eventIndex}].impacts.regionTransfers[${transferIndex}] attempts to transfer LEGAL sovereignty from "${fromCode}" to newly created belligerent "${toCode}" while their independence war is starting. A unilateral declaration, uprising, revolution or secession does not itself change legal sovereignty. Keep the prior sovereign legally in place and represent the disputed territory with regionControlOps (normally contest; use control only for territory the breakaway has decisively captured/administers). Legal sovereignty can move later through explicit recognition, cession, annexation or settlement.`;
    }
  }

  return "";
};

const normalizeGameMasterIsoDate = (value) => {
  const raw = normalizeString(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10) === raw ? raw : "";
};

const GAME_MASTER_REQUEST_MONTHS = Object.freeze({
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
});

const gameMasterRequestDateFromParts = (yearValue, monthValue, dayValue) => {
  const year = Number(yearValue);
  const day = Number(dayValue);
  const monthToken = normalizeString(monthValue).toLowerCase();
  const month = Number.isFinite(Number(monthValue))
    ? Number(monthValue)
    : GAME_MASTER_REQUEST_MONTHS[monthToken];
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  return normalizeGameMasterIsoDate(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
};

const extractExplicitGameMasterRequestDates = (requestText) => {
  const request = normalizeString(requestText);
  if (!request) return [];
  const dates = new Set();
  const add = (value) => {
    const normalized = normalizeGameMasterIsoDate(value);
    if (normalized) dates.add(normalized);
  };

  for (const match of request.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    add(`${match[1]}-${match[2]}-${match[3]}`);
  }

  const monthPattern = "January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\s*,?\\s+(\\d{4})\\b`, "gi");
  for (const match of request.matchAll(dayFirst)) {
    add(gameMasterRequestDateFromParts(match[3], match[2], match[1]));
  }

  const monthFirst = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})\\b`, "gi");
  for (const match of request.matchAll(monthFirst)) {
    add(gameMasterRequestDateFromParts(match[3], match[1], match[2]));
  }

  return [...dates].sort();
};

const validateGameMasterRequestedExactDate = (candidate, { mode, request }) => {
  if (mode !== "exact-event") return "";
  const requestedDates = extractExplicitGameMasterRequestDates(request);
  // Only enforce when the administrator supplied one unambiguous explicit date.
  // Requests that mention several historical dates need semantic interpretation.
  if (requestedDates.length !== 1) return "";

  const expectedDate = requestedDates[0];
  const eventDate = normalizeGameMasterIsoDate(normalizeArray(candidate?.events)[0]?.date);
  if (eventDate === expectedDate) return "";

  return `The administrator explicitly requested the Exact Event date ${expectedDate}, but $.events[0].date is ${eventDate || "blank/invalid"}. Exact Event preview must preserve an explicit requested date exactly; do not silently backdate, forward-date, or otherwise reinterpret it.`;
};

const gameMasterEventHasCanonicalEffects = (candidate, eventIndex) => {
  const event = normalizeArray(candidate?.events)[eventIndex];
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  for (const field of [
    "regionTransfers",
    "regionControlOps",
    "polityChanges",
    "createdChats",
    "unitOps",
    "markerOps",
  ]) {
    if (normalizeArray(impacts[field]).length > 0) return true;
  }

  const linked = (entries) => normalizeArray(entries).some((entry) =>
    normalizeArray(entry?.eventIndexes).some((value) => Number(value) === eventIndex));

  return linked(candidate?.countryStatPatches)
    || linked(candidate?.storylineUpdates)
    || linked(candidate?.warUpdates)
    || linked(candidate?.relationUpdates)
    || linked(candidate?.agreementUpdates);
};

const validateGameMasterChronology = (candidate, game) => {
  const currentDate = normalizeGameMasterIsoDate(game?.gameDate || game?.startDate);
  if (!currentDate) return "";

  const events = normalizeArray(candidate?.events);
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const eventDate = normalizeGameMasterIsoDate(events[eventIndex]?.date);
    if (!eventDate || eventDate <= currentDate) continue;
    if (!gameMasterEventHasCanonicalEffects(candidate, eventIndex)) continue;

    return `$.events[${eventIndex}] is dated ${eventDate}, after the current game date ${currentDate}, but it establishes canonical state changes. GM Apply never advances time, so a future-dated event cannot make wars, relations, agreements, territory, polities, Stats, units, markers, or chats true in the present. Nothing was applied. Keep the requested future date and advance the simulation first, or revise the event/effects to a date on or before ${currentDate}.`;
  }

  return "";
};

const validateGameMasterPreviewPayload = async (candidate, { mode, world, game, request = "" }) => {
  if (!candidate || typeof candidate !== "object") return "The GM did not return a transaction object.";
  if (!GAME_MASTER_MODE_SET.has(mode)) return `Unsupported GM mode "${mode}".`;

  // Normalize lifecycle identity before any downstream validation. Present-state
  // activity is derived from the live map, not merely from stock/base-map names.
  // This mutates only the in-memory PREVIEW payload; no save/world writes happen.
  const activePolities = await buildGameMasterActivePolitySet(world);
  normalizeGameMasterPolityLifecycle(candidate, world, activePolities);
  normalizeGameMasterWarEventBindings(candidate);

  if (normalizeString(candidate.mode) !== mode) {
    return `$.mode must echo the selected GM mode "${mode}".`;
  }

  const events = normalizeArray(candidate.events);
  if (mode === "exact-event" && events.length !== 1) {
    return `Exact Event mode requires exactly one event; received ${events.length}.`;
  }
  if (mode === "world-intervention" && events.length === 0) {
    return "World Intervention mode requires at least one authored event so the intervention has canonical historical context.";
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!normalizeString(event?.date)) return `$.events[${index}].date must not be blank.`;
    if (!normalizeString(event?.title)) return `$.events[${index}].title must not be blank.`;
    if (!normalizeString(event?.description)) return `$.events[${index}].description must not be blank.`;
  }

  const requestedDateError = validateGameMasterRequestedExactDate(candidate, { mode, request });
  if (requestedDateError) return requestedDateError;

  const chronologyError = validateGameMasterChronology(candidate, game);
  if (chronologyError) return chronologyError;

  const lifecycleError = validateGameMasterPolityLifecycle(candidate, world, activePolities);
  if (lifecycleError) return lifecycleError;

  const breakawaySovereigntyError = validateGameMasterBreakawaySovereignty(candidate);
  if (breakawaySovereigntyError) return breakawaySovereigntyError;

  const storylineError = await validateGameMasterStorylineUpdates(candidate, {
    mode,
    world,
    game,
    request,
  });
  if (storylineError) return `[canonical storyline-state] ${storylineError}`;

  // Resolve/validate map, unit, marker and chat operations now, while this is
  // still a preview. This may conservatively resolve a grounded place label to
  // an exact map region, but it never writes world state.
  const worldChangeError = await validateGeneratedWorldChanges(candidate, world, { strictTransfers: true });
  if (worldChangeError) return worldChangeError;

  const statError = validateGameMasterStatPatches(candidate.countryStatPatches, world, candidate.events);
  if (statError) return statError;

  const normalizedEvents = normalizeArray(candidate.events)
    .map((entry, index) => normalizeGeneratedEvent({
      ...entry,
      source: entry?.source || "game-master-preview",
    }, index))
    .filter(Boolean);

  const warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(candidate.warUpdates), normalizedEvents);
  const warError = validateCanonicalWarEvents({
    events: normalizedEvents,
    updates: warUpdates,
    world,
  });
  if (warError) return `[canonical war-state] ${warError}`;

  const relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(candidate.relationUpdates), normalizedEvents);
  const agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(candidate.agreementUpdates), normalizedEvents);
  const diplomaticError = validateDiplomaticLedgerPayload({
    events: normalizedEvents,
    relationUpdates,
    agreementUpdates,
  }, { world });
  if (diplomaticError) return `[canonical diplomatic-state] ${diplomaticError}`;

  return "";
};

const gameMasterCanonicalPolityKey = (token, world) => {
  const raw = normalizeString(token);
  if (!raw) return "";
  const resolution = resolvePolityIdentity(raw, normalizeWorldState(world), {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return gameMasterPolityKey(normalizeString(resolution?.resolved) || toCountryName(raw) || raw);
};

// GM Apply must never report success merely because the common mutation seam
// returned an object. Verify every previewed territorial consequence against the
// in-memory post-apply world before ANY persistence happens.
const verifyGameMasterTerritoryPostconditions = (events, world) => {
  const normalizedWorld = normalizeWorldState(world);

  for (let eventIndex = 0; eventIndex < normalizeArray(events).length; eventIndex += 1) {
    const event = normalizeArray(events)[eventIndex];
    const impacts = event?.impacts || {};

    for (let transferIndex = 0; transferIndex < normalizeArray(impacts.regionTransfers).length; transferIndex += 1) {
      const transfer = normalizeArray(impacts.regionTransfers)[transferIndex];
      const regionId = normalizeString(transfer?.regionId);
      const expected = gameMasterCanonicalPolityKey(transfer?.toCode, normalizedWorld);
      const actual = gameMasterCanonicalPolityKey(
        normalizedWorld.regionSovereigntyOverrides?.[regionId],
        normalizedWorld,
      );
      if (!regionId || !expected || actual !== expected) {
        return `legal-sovereignty operation ${eventIndex}:${transferIndex} did not take effect for ${regionId || "unknown region"} (expected ${normalizeString(transfer?.toCode) || "target"}, got ${normalizeString(normalizedWorld.regionSovereigntyOverrides?.[regionId]) || "no canonical sovereign override"}).`;
      }
    }

    for (let controlIndex = 0; controlIndex < normalizeArray(impacts.regionControlOps).length; controlIndex += 1) {
      const control = normalizeArray(impacts.regionControlOps)[controlIndex];
      const op = normalizeString(control?.op).toLowerCase();
      const regionId = normalizeString(control?.regionId);
      if (!regionId) {
        return `de-facto control operation ${eventIndex}:${controlIndex} has no canonical region id after preview validation.`;
      }

      if (op === "control" || op === "control_flip") {
        const expected = gameMasterCanonicalPolityKey(control?.toCode, normalizedWorld);
        const actualRaw = normalizedWorld.regionOwnershipOverrides?.[regionId];
        const actual = gameMasterCanonicalPolityKey(actualRaw, normalizedWorld);
        if (!expected || actual !== expected) {
          return `de-facto control operation ${eventIndex}:${controlIndex} did not take effect for ${regionId} (expected ${normalizeString(control?.toCode) || "target"}, got ${normalizeString(actualRaw) || "no controller override"}).`;
        }
      }

      if (op === "contest") {
        const expected = gameMasterCanonicalPolityKey(control?.actorCode || control?.claimantCode, normalizedWorld);
        const claimants = normalizeArray(normalizedWorld.regionClaimants?.[regionId])
          .map((value) => gameMasterCanonicalPolityKey(value, normalizedWorld))
          .filter(Boolean);
        if (!expected || !claimants.includes(expected)) {
          return `contest operation ${eventIndex}:${controlIndex} did not take effect for ${regionId} (expected claimant ${normalizeString(control?.actorCode || control?.claimantCode) || "unknown"}).`;
        }
      }
    }
  }

  return "";
};

const hashGameMasterText = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const createGameMasterTransactionId = () => {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `gm-${Date.now().toString(36)}-${random || "transaction"}`;
};

// Fingerprint only canonical state the GM planner is allowed to mutate/read while
// authoring a transaction. If any of it changes between Preview and Apply, the
// transaction fails closed and the administrator must regenerate instead of having
// native code silently reinterpret an old preview against a new world.
const gameMasterStateFingerprint = ({ game = {}, world = {}, events = [], colors = {} } = {}) => {
  const normalizedWorld = normalizeWorldState(world);
  const relevant = {
    game: {
      country: normalizeString(game?.country),
      gameDate: normalizeString(game?.gameDate),
      round: Number(game?.round) || 0,
      startDate: normalizeString(game?.startDate),
    },
    colors,
    events: normalizeEvents(events).map((event) => ({
      id: event.id,
      date: event.date,
      title: event.title,
      description: event.description,
      impacts: event.impacts,
      warId: event.warId,
      combatants: event.combatants,
    })),
    world: {
      polityOverrides: normalizedWorld.polityOverrides,
      regionOwnershipOverrides: normalizedWorld.regionOwnershipOverrides,
      regionSovereigntyOverrides: normalizedWorld.regionSovereigntyOverrides,
      regionClaimants: normalizedWorld.regionClaimants,
      countryStats: normalizedWorld.countryStats,
      countryTags: normalizedWorld.countryTags,
      internationalReputation: normalizedWorld.internationalReputation,
      units: normalizedWorld.units,
      markers: normalizedWorld.markers,
      cityRenames: normalizedWorld.cityRenames,
      storylines: normalizedWorld.storylines,
      wars: normalizedWorld.wars,
      relations: normalizedWorld.relations,
      agreements: normalizedWorld.agreements,
    },
  };
  return hashGameMasterText(JSON.stringify(relevant));
};

const gameMasterTransactionCandidate = (transaction) => ({
  mode: normalizeString(transaction?.mode),
  summary: normalizeString(transaction?.summary),
  events: cloneValue(normalizeArray(transaction?.events)),
  countryStatPatches: cloneValue(normalizeArray(transaction?.countryStatPatches)),
  storylineUpdates: cloneValue(normalizeArray(transaction?.storylineUpdates)),
  warUpdates: cloneValue(normalizeArray(transaction?.warUpdates)),
  relationUpdates: cloneValue(normalizeArray(transaction?.relationUpdates)),
  agreementUpdates: cloneValue(normalizeArray(transaction?.agreementUpdates)),
  diplomaticOutreach: cloneValue(normalizeArray(transaction?.diplomaticOutreach)),
});

const gameMasterAcceptedOperationLabels = (transaction) => {
  const labels = [];
  for (const [eventIndex, event] of normalizeArray(transaction?.events).entries()) {
    labels.push(`event:${eventIndex}:${normalizeString(event?.id)}`);
    const impacts = event?.impacts || {};
    for (const [field, prefix] of [
      ["regionTransfers", "sovereignty"],
      ["regionControlOps", "control"],
      ["polityChanges", "polity"],
      ["unitOps", "unit"],
      ["markerOps", "marker"],
      ["createdChats", "event-chat"],
    ]) {
      normalizeArray(impacts[field]).forEach((_, index) => labels.push(`${prefix}:${eventIndex}:${index}`));
    }
  }
  normalizeArray(transaction?.countryStatPatches).forEach((entry, index) => labels.push(`stats:${index}:${normalizeString(entry?.country)}`));
  normalizeArray(transaction?.storylineUpdates).forEach((entry, index) => labels.push(`storyline:${index}:${normalizeString(entry?.id)}`));
  normalizeArray(transaction?.warUpdates).forEach((entry, index) => labels.push(`war:${index}:${normalizeString(entry?.id)}`));
  normalizeArray(transaction?.relationUpdates).forEach((entry, index) => labels.push(`relation:${index}:${relationPairKeyForHistory(entry?.a, entry?.b)}`));
  normalizeArray(transaction?.agreementUpdates).forEach((entry, index) => labels.push(`agreement:${index}:${normalizeString(entry?.id)}`));
  normalizeArray(transaction?.diplomaticOutreach).forEach((_, index) => labels.push(`outreach:${index}`));
  return labels.filter(Boolean).slice(0, 128);
};

const gameMasterHistoryEntry = ({ transaction, game, eventIds, summary, transactionId }) => {
  const dates = normalizeArray(transaction?.events).map((event) => normalizeString(event?.date)).filter(Boolean).sort();
  const fallbackDate = normalizeString(game?.gameDate || game?.startDate);
  const fromDate = dates[0] || fallbackDate;
  const toDate = dates.at(-1) || fallbackDate;
  return {
    catalyst: null,
    date: toDate,
    eventIds,
    fallbackReason: "",
    fromDate,
    mode: "game-master",
    plannedActions: [],
    round: Math.max(0, Math.trunc(Number(game?.round) || 0)),
    source: "gm-console",
    summary: normalizeString(summary) || "GM Console transaction applied.",
    toDate,
    transactionId,
  };
};

const insertGameMasterHistoryEntry = (historyInput, entry) => {
  const history = [...normalizeArray(historyInput)];
  const entryDate = normalizeString(entry?.toDate || entry?.date || entry?.fromDate);
  let insertAt = history.findIndex((item) => {
    const itemDate = normalizeString(item?.toDate || item?.date || item?.fromDate);
    return entryDate && itemDate && entryDate > itemDate;
  });
  if (insertAt < 0) insertAt = history.length;
  history.splice(insertAt, 0, entry);
  return history;
};

// GM-authored timeline records are only UI/history links; the canonical event ledger
// remains the source of truth. If an Event Editor deletion removed the linked event,
// discard the now-orphaned GM history record so the Events panel cannot get stuck on
// an empty, stale record (for example an old future-dated GM test event).
const pruneOrphanedGameMasterHistory = (historyInput, eventsInput) => {
  const knownEventIds = new Set(
    normalizeArray(eventsInput)
      .map((event) => normalizeString(event?.id))
      .filter(Boolean),
  );

  return normalizeArray(historyInput)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const source = normalizeString(entry?.source).toLowerCase();
      const mode = normalizeString(entry?.mode).toLowerCase();
      if (source !== "gm-console" && mode !== "game-master") return entry;

      const before = normalizeArray(entry?.eventIds).map(normalizeString).filter(Boolean);
      const after = before.filter((eventId) => knownEventIds.has(eventId));
      if (after.length === 0) return null;
      if (after.length === before.length) return entry;
      return { ...entry, eventIds: after };
    })
    .filter(Boolean);
};

// Phase 8B.1: generate and validate a GM transaction WITHOUT persisting it.
// Preview receives stable transaction/event IDs now so 8B.2 applies exactly the
// object the administrator inspected; Apply never asks the AI to reinterpret it.
export const previewGameMasterCommand = async (requestText, { mode = "world-intervention" } = {}) => {
  const request = normalizeString(requestText);
  const selectedMode = normalizeString(mode).toLowerCase();
  if (!request) throw new Error("Enter a GM request first.");
  if (!GAME_MASTER_MODE_SET.has(selectedMode)) throw new Error(`Unsupported GM mode "${selectedMode}".`);

  beginSimulation();
  try {
    const [bundle, colors] = await Promise.all([
      readGameStateBundle({ force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
    ]);
    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "gameMaster", gameMasterRequest: request })),
      gameMasterMode: selectedMode,
    };

    const { generation, payload } = await runJsonTask("gameMaster", {
      userMessage: `Generate a ${selectedMode} GM transaction preview for the administrator request. Do not apply anything.`,
      validatePayload: (candidate) => validateGameMasterPreviewPayload(candidate, {
        mode: selectedMode,
        world: bundle.world,
        game: bundle.game,
        request,
      }),
      variables,
    });

    const transactionId = createGameMasterTransactionId();
    const storylineUpdates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
    const events = attachStorylineIdsByIndexes(
      normalizeArray(payload?.events)
        .map((entry, index) => normalizeGeneratedEvent({
          ...entry,
          id: `event-manual-${transactionId}-${index + 1}`,
          source: "game-master",
        }, index))
        .filter(Boolean),
      storylineUpdates,
    );
    const warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(payload?.warUpdates), events);
    const relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(payload?.relationUpdates), events);
    const agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(payload?.agreementUpdates), events);
    const countryStatPatches = normalizeGameMasterStatPatches(payload?.countryStatPatches, bundle.world);

    return {
      id: transactionId,
      mode: selectedMode,
      request,
      date: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
      baseFingerprint: gameMasterStateFingerprint({ game: bundle.game, world: bundle.world, events: bundle.events, colors }),
      summary: normalizeString(payload?.summary),
      transaction: {
        id: transactionId,
        mode: selectedMode,
        summary: normalizeString(payload?.summary),
        events,
        countryStatPatches,
        storylineUpdates,
        warUpdates,
        relationUpdates,
        agreementUpdates,
        diplomaticOutreach: normalizeArray(payload?.diplomaticOutreach),
      },
      generation,
      previewOnly: true,
    };
  } finally {
    endSimulation();
  }
};

// Phase 8B.2: apply the EXACT already-previewed transaction. There is no AI call,
// no turn simulation, no date advance and no round increment. The preview is
// revalidated against a freshly-read canonical world immediately before any write.
export const applyGameMasterPreview = async (preview) => {
  const transactionId = normalizeString(preview?.id || preview?.transaction?.id);
  const mode = normalizeString(preview?.mode || preview?.transaction?.mode).toLowerCase();
  const request = normalizeString(preview?.request);
  if (!transactionId || !preview?.transaction || typeof preview.transaction !== "object") {
    throw new Error("This GM preview is missing its transaction identity. Generate a fresh preview.");
  }
  if (!GAME_MASTER_MODE_SET.has(mode)) throw new Error(`Unsupported GM mode "${mode}".`);
  if (!normalizeString(preview?.baseFingerprint)) {
    throw new Error("This preview predates the 8B.2 safety fingerprint. Generate a fresh preview before applying.");
  }

  beginSimulation();
  try {
    const [bundle, colors] = await Promise.all([
      readGameStateBundle({ force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
    ]);
    const liveWorld = normalizeWorldState(bundle.world);

    if (normalizeArray(liveWorld.gmAudit).some((entry) => normalizeString(entry?.transactionId) === transactionId)) {
      throw new Error(`GM transaction ${transactionId} has already been applied.`);
    }

    const liveFingerprint = gameMasterStateFingerprint({ game: bundle.game, world: liveWorld, events: bundle.events, colors });
    if (liveFingerprint !== normalizeString(preview.baseFingerprint)) {
      throw new Error("Canonical state changed after this preview was generated. Nothing was applied; regenerate the preview against the current world.");
    }

    const transaction = cloneValue(preview.transaction);
    const candidate = gameMasterTransactionCandidate(transaction);
    const candidateBeforeValidation = JSON.stringify(candidate);
    const validationError = await validateGameMasterPreviewPayload(candidate, {
      mode,
      world: liveWorld,
      game: bundle.game,
      request: preview.request,
    });
    if (validationError) throw new Error(`GM transaction is no longer valid: ${validationError}`);
    if (JSON.stringify(candidate) !== candidateBeforeValidation) {
      throw new Error("Current canonical validation would reinterpret this preview. Nothing was applied; regenerate it so the changed operation is visible before approval.");
    }

    const events = normalizeArray(transaction.events).map((event) => cloneValue(event));
    const priorEvents = normalizeEvents(bundle.events);
    const freshEvents = dedupeGeneratedEvents(priorEvents, events);
    if (freshEvents.length !== events.length) {
      throw new Error("One or more authored GM events duplicate existing canonical history. Nothing was applied; regenerate or make the event wording/date explicit.");
    }
    const existingIds = new Set(priorEvents.map((event) => normalizeString(event?.id)).filter(Boolean));
    const duplicateId = events.find((event) => existingIds.has(normalizeString(event?.id)));
    if (duplicateId) throw new Error(`Authored GM event id ${duplicateId.id} already exists. Nothing was applied; regenerate the preview.`);

    const impactMerge = applyEventImpactsToWorld({
      colors,
      events,
      game: bundle.game,
      world: liveWorld,
    });
    let nextWorld = impactMerge.world;
    const nextColors = impactMerge.colors;

    const territoryPostconditionError = verifyGameMasterTerritoryPostconditions(events, nextWorld);
    if (territoryPostconditionError) {
      throw new Error(
        `A previewed territorial operation failed during the in-memory Apply: ${territoryPostconditionError} Nothing was persisted.`,
      );
    }

    const statCountries = [];
    for (const entry of normalizeArray(transaction.countryStatPatches)) {
      const country = normalizeString(entry?.country);
      const nextSheet = applyCountryStatPatchToWorld(nextWorld, country, cloneValue(entry?.patch));
      if (!nextSheet) throw new Error(`Stats patch for ${country || "unknown polity"} could not be applied. Nothing was persisted.`);
      statCountries.push(country);
      const reputation = Number(nextSheet?.indices?.internationalReputation);
      if (Number.isFinite(reputation)) {
        nextWorld.internationalReputation = {
          ...(nextWorld.internationalReputation || {}),
          [country]: Math.max(0, Math.min(100, Math.round(reputation))),
        };
      }
    }

    if (statCountries.length) {
      nextWorld = captureCountryStatsHistory(nextWorld, {
        date: bundle.game.gameDate || bundle.game.startDate || "",
        round: bundle.game.round || 0,
      });
    }

    const warMerge = applyWarUpdates({
      world: nextWorld,
      updates: normalizeArray(transaction.warUpdates),
      events,
      stopDate: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
    });
    if (warMerge.appliedIds.length !== normalizeArray(transaction.warUpdates).length) {
      throw new Error("A canonical war operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    nextWorld = warMerge.world;

    const diplomaticMerge = applyDiplomaticUpdates({
      world: nextWorld,
      relationUpdates: normalizeArray(transaction.relationUpdates),
      agreementUpdates: normalizeArray(transaction.agreementUpdates),
      events,
      stopDate: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
    });
    if (diplomaticMerge.appliedRelationIds.length !== normalizeArray(transaction.relationUpdates).length) {
      throw new Error("A canonical relation operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    if (diplomaticMerge.appliedAgreementIds.length !== normalizeArray(transaction.agreementUpdates).length) {
      throw new Error("A canonical agreement operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    nextWorld = diplomaticMerge.world;

    const storylineMerge = applyWorldStorylineUpdates({
      world: nextWorld,
      updates: normalizeArray(transaction.storylineUpdates),
      events,
      stopDate: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
    });
    if (storylineMerge.appliedIds.length !== normalizeArray(transaction.storylineUpdates).length) {
      throw new Error("A canonical storyline operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    nextWorld = storylineMerge.world;

    const generatedChats = [];
    for (const event of events) {
      for (const createdChat of normalizeArray(event?.impacts?.createdChats)) {
        const nextChat = await buildGeneratedChat(createdChat, event.id, nextWorld, {
          fallbackTitle: event.title,
          playerName: bundle.game.country,
        });
        if (!nextChat) throw new Error(`A diplomatic chat linked to event "${event.title}" could not be built. Nothing was persisted.`);
        generatedChats.unshift(nextChat);
      }
    }
    for (const chatLike of normalizeArray(transaction.diplomaticOutreach)) {
      const nextChat = await buildGeneratedChat({ ...chatLike, source: "gm-outreach" }, "", nextWorld, {
        playerName: bundle.game.country,
      });
      if (!nextChat) throw new Error("A GM diplomatic outreach operation could not be built. Nothing was persisted.");
      generatedChats.unshift(nextChat);
    }

    let chatsToWrite = reconcileStableChatsForPlayer(bundle.chats, nextWorld, bundle.game.country);
    if (generatedChats.length) {
      const liveChats = await readChatsState({ force: true, world: nextWorld, playerCountry: bundle.game.country });
      chatsToWrite = mergeIncomingChats(liveChats, generatedChats, nextWorld, { playerCountry: bundle.game.country });
    }

    const nextEvents = [...priorEvents, ...events];
    // Repair orphaned GM timeline links before inserting this transaction. This is
    // intentionally limited to GM-owned history records and never touches ordinary
    // turn history.
    nextWorld.simulationHistory = pruneOrphanedGameMasterHistory(
      nextWorld.simulationHistory,
      nextEvents,
    );
    const eventIds = events.map((event) => normalizeString(event?.id)).filter(Boolean);
    const storylineIds = [...new Set(storylineMerge.appliedIds.map(normalizeString).filter(Boolean))];
    const warIds = [...new Set(warMerge.appliedIds.map(normalizeString).filter(Boolean))];
    const relationIds = [...new Set(diplomaticMerge.appliedRelationIds.map(normalizeString).filter(Boolean))];
    const agreementIds = [...new Set(diplomaticMerge.appliedAgreementIds.map(normalizeString).filter(Boolean))];
    const chatIds = generatedChats.map((chat) => normalizeString(chat?.id)).filter(Boolean);
    const summary = normalizeString(transaction.summary || preview.summary);

    if (eventIds.length) {
      nextWorld.simulationHistory = insertGameMasterHistoryEntry(
        nextWorld.simulationHistory,
        gameMasterHistoryEntry({ transaction, game: bundle.game, eventIds, summary, transactionId }),
      );
    }

    const auditRecord = {
      id: `audit-${transactionId}`,
      transactionId,
      appliedAt: new Date().toISOString(),
      date: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
      mode,
      request,
      summary,
      source: "gm-console",
      status: "applied",
      transaction: cloneValue(transaction),
      acceptedOperations: gameMasterAcceptedOperationLabels(transaction),
      rejectedOperations: [],
      eventIds,
      storylineIds,
      warIds,
      relationIds,
      agreementIds,
      chatIds,
      statCountries: [...new Set(statCountries.filter(Boolean))],
    };
    nextWorld.gmAudit = [auditRecord, ...normalizeArray(nextWorld.gmAudit)].slice(0, 64);

    // Canonical persistence only. Deliberately omit actions/game writes, rollback
    // snapshots and oh:turn-complete: a GM edit is administrative authority, not a turn.
    // Avoid rewriting unrelated assets when this transaction did not touch them.
    const touchedEvents = events.length > 0;
    const touchedChats = generatedChats.length > 0;
    const touchedColors = JSON.stringify(nextColors) !== JSON.stringify(colors);
    const writes = [writeWorldState(nextWorld)];
    if (touchedEvents) writes.push(writeEventsState(nextEvents));
    if (touchedChats) {
      writes.push(writeChatsState(chatsToWrite, { world: nextWorld, playerCountry: bundle.game.country }));
    }
    if (touchedColors) writes.push(writeJson(JSON_URLS.colors, nextColors, { pretty: true }));

    try {
      await Promise.all(writes);
    } catch (error) {
      // Storage is file-based rather than transactional. Restore every asset this GM
      // transaction may have touched so a single failed write does not leave half an
      // intervention in canon. Best-effort rollback errors are logged separately.
      const rollbackWrites = [writeWorldState(bundle.world)];
      if (touchedEvents) rollbackWrites.push(writeEventsState(bundle.events));
      if (touchedChats) {
        rollbackWrites.push(writeChatsState(bundle.chats, { world: bundle.world, playerCountry: bundle.game.country }));
      }
      if (touchedColors) rollbackWrites.push(writeJson(JSON_URLS.colors, colors, { pretty: true }));
      const rollbackResults = await Promise.allSettled(rollbackWrites);
      const rollbackFailed = rollbackResults.some((result) => result.status === "rejected");
      if (rollbackFailed) console.error("[GM 8B.2] persistence rollback was incomplete.", rollbackResults);
      throw new Error(
        rollbackFailed
          ? `GM persistence failed and rollback was incomplete: ${error?.message || error}`
          : `GM persistence failed; the pre-apply state was restored: ${error?.message || error}`,
      );
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("oh:gm-transaction-applied", { detail: { transactionId } }));
      if (events.some((event) => normalizeArray(event?.impacts?.markerOps).length > 0)) {
        window.dispatchEvent(new Event("oh:cities-updated"));
      }
    }

    return {
      applied: true,
      transactionId,
      auditId: auditRecord.id,
      mode,
      date: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
      summary,
      eventIds,
      storylineIds,
      warIds,
      relationIds,
      agreementIds,
      chatIds,
      statCountries: auditRecord.statCountries,
    };
  } finally {
    endSimulation();
  }
};

// Kept for stale callers, but direct prose execution remains forbidden. The UI must
// always generate and expose a preview before any canonical write can happen.
export const applyGameMasterCommand = async () => {
  throw new Error("Direct GM execution is disabled. Generate a preview and apply that exact transaction through the GM Console.");
};

// ---- Pre-game history -------------------------------------------------------
// Pre-game backstory dates must sit strictly before round one. Strict/salvage
// like the jump validators: attempt 1 returns corrective errors the model can
// fix, attempt 2 drops what cannot be placed instead of rejecting the turn.
// Non-Gregorian scenarios ("1200 BCE") skip date checks entirely — the model
// is told to match the scenario's own dating style and we take it at its word.
const validatePregameEvents = (candidate, { startDate, strict }) => {
  const events = normalizeArray(candidate?.events);
  if (events.length === 0) return "$.events must contain at least one pre-game event.";
  if (!parseIsoDate(startDate)) return "";
  if (strict) {
    let previous = "";
    for (let index = 0; index < events.length; index += 1) {
      const date = normalizeString(events[index]?.date);
      if (!parseIsoDate(date)) {
        return `$.events[${index}].date must be a real YYYY-MM-DD date.`;
      }
      if (date >= startDate) {
        return `$.events[${index}].date must be strictly before the game start date ${startDate} — these events are pre-game history.`;
      }
      if (previous && date < previous) {
        return `$.events[${index}].date must not be earlier than the previous event — order the backstory chronologically.`;
      }
      previous = date;
    }
    return "";
  }
  candidate.events = events
    .filter((event) => {
      const date = normalizeString(event?.date);
      return parseIsoDate(date) && date < startDate;
    })
    .sort((a, b) => normalizeString(a.date).localeCompare(normalizeString(b.date)));
  return "";
};

const validatePregamePolityVocabulary = (
  candidate,
  {
    world = {},
    canonicalPolities = [],
  } = {},
) => {
  const allowedByKey = new Map(
    normalizeArray(canonicalPolities)
      .map((name) => normalizeString(name))
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name]),
  );
  if (!allowedByKey.size) return "";

  const checkToken = (token, path) => {
    const raw = normalizeString(token);
    if (!raw) return "";
    const resolved = resolvePolityIdentity(raw, world, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    const canonical = normalizeString(resolved?.resolved);
    if (canonical && allowedByKey.has(canonical.toLowerCase())) return "";

    const sample = [...allowedByKey.values()].slice(0, 80).join("; ");
    return `${path} uses non-current or unresolved polity "${raw}". Round-One structured ledgers may use ONLY current canonical polities from the save. Do not invent an umbrella/legacy actor; decompose it into the applicable current polity/polities. Current polity vocabulary: ${sample}.`;
  };

  const storylineUpdates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  for (let i = 0; i < storylineUpdates.length; i += 1) {
    for (let j = 0; j < normalizeArray(storylineUpdates[i]?.participants).length; j += 1) {
      const error = checkToken(
        normalizeArray(storylineUpdates[i]?.participants)[j],
        `$.storylineUpdates record ${i + 1} participant ${j + 1}`,
      );
      if (error) return error;
    }
  }

  const warUpdates = decodeWarUpdates(candidate?.warUpdates);
  for (let i = 0; i < warUpdates.length; i += 1) {
    const actorFields = [
      ["actors", normalizeArray(warUpdates[i]?.actors)],
      ["opponents", normalizeArray(warUpdates[i]?.opponents)],
    ];
    for (const [field, tokens] of actorFields) {
      for (let j = 0; j < tokens.length; j += 1) {
        const error = checkToken(tokens[j], `$.warUpdates record ${i + 1} ${field}[${j}]`);
        if (error) return error;
      }
    }
  }

  const relationUpdates = decodeRelationUpdates(candidate?.relationUpdates);
  for (let i = 0; i < relationUpdates.length; i += 1) {
    const aError = checkToken(relationUpdates[i]?.a, `$.relationUpdates record ${i + 1}.a`);
    if (aError) return aError;
    const bError = checkToken(relationUpdates[i]?.b, `$.relationUpdates record ${i + 1}.b`);
    if (bError) return bError;
  }

  const agreementUpdates = decodeAgreementUpdates(candidate?.agreementUpdates);
  for (let i = 0; i < agreementUpdates.length; i += 1) {
    for (let j = 0; j < normalizeArray(agreementUpdates[i]?.parties).length; j += 1) {
      const error = checkToken(
        normalizeArray(agreementUpdates[i]?.parties)[j],
        `$.agreementUpdates record ${i + 1} parties[${j}]`,
      );
      if (error) return error;
    }
  }

  return "";
};

// A live canonical war and its scheduler-facing war storyline are intentionally
// separate ledgers, but the existence/id of the war storyline is mechanical once
// belligerency is authoritative. Round Zero therefore must not waste an AI output
// slot asking the model to duplicate the same fact with an exact derived id.
//
// Preserve an explicit semantic war storyline when the model supplied one for the
// same participant set (so its pressure/momentum/state judgement is retained), but
// canonicalize its id/status/kind. If none exists, synthesize only the minimal
// scheduler mirror from the already-validated war + its causal historical event.
// This is NOT a new system or new historical judgement; it is an adapter between
// the existing world.wars and world.storylines ledgers.
const ensurePregameWarStorylineMirrors = (
  candidate,
  {
    warProbe = { wars: [] },
    warUpdates = [],
    startDate = "",
  } = {},
) => {
  const events = normalizeArray(candidate?.events);
  let storylines = decodeWorldStorylineUpdates(candidate?.storylineUpdates);

  const participantKey = (participants) =>
    [...new Set(
      normalizeArray(participants)
        .map(normalizeString)
        .filter(Boolean)
        .map((name) => name.toLowerCase()),
    )]
      .sort()
      .join(" | ");

  const liveWars = normalizeArray(warProbe?.wars)
    .filter((war) => ["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase()));

  for (const war of liveWars) {
    const warId = normalizeString(war?.id);
    if (!warId) continue;

    const relatedUpdate = normalizeArray(warUpdates)
      .find((update) => normalizeString(update?.id) === warId);
    if (!relatedUpdate) continue;

    const participants = [...new Set([
      ...normalizeArray(war?.sideA).map(normalizeString),
      ...normalizeArray(war?.sideB).map(normalizeString),
    ].filter(Boolean))];
    const expectedId = `storyline-${warId}`;
    const expectedParticipantsKey = participantKey(participants);

    const causalIndexes = normalizeArray(relatedUpdate?.eventIndexes)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length);
    const causalEvent = causalIndexes.length ? events[causalIndexes[0]] : null;

    const exactIndex = storylines.findIndex(
      (entry) => normalizeString(entry?.id) === expectedId,
    );
    const semanticIndex = exactIndex >= 0
      ? exactIndex
      : storylines.findIndex((entry) =>
          normalizeString(entry?.kind).toLowerCase() === "war" &&
          participantKey(entry?.participants) === expectedParticipantsKey
        );

    const warStatus = normalizeString(war?.status).toLowerCase();
    const defaultPressure = warStatus === "ceasefire" ? 60 : 85;
    const defaultMomentum = warStatus === "ceasefire" ? 15 : 30;
    const fallbackTitle =
      normalizeString(causalEvent?.title) ||
      normalizeString(relatedUpdate?.note) ||
      expectedId;
    const fallbackState =
      normalizeString(relatedUpdate?.note) ||
      normalizeString(causalEvent?.description) ||
      fallbackTitle;
    const fallbackStartedDate =
      normalizeString(causalEvent?.date) ||
      normalizeString(startDate);

    const prior = semanticIndex >= 0 ? storylines[semanticIndex] : null;
    const canonicalMirror = {
      ...(prior || {}),
      id: expectedId,
      status: "active",
      pressure: Number.isFinite(Number(prior?.pressure))
        ? Number(prior.pressure)
        : defaultPressure,
      momentum: Number.isFinite(Number(prior?.momentum))
        ? Number(prior.momentum)
        : defaultMomentum,
      startedDate: normalizeString(prior?.startedDate) || fallbackStartedDate,
      kind: "war",
      title: normalizeString(prior?.title) || fallbackTitle,
      participants,
      eventIndexes: causalIndexes,
      eventIds: [],
      state: normalizeString(prior?.state) || fallbackState,
    };

    // Remove duplicate semantic mirrors for the same exact participant set, then
    // insert the one canonical scheduler record.
    storylines = storylines.filter((entry, index) => {
      if (index === semanticIndex) return false;
      if (normalizeString(entry?.id) === expectedId) return false;
      return !(
        normalizeString(entry?.kind).toLowerCase() === "war" &&
        participantKey(entry?.participants) === expectedParticipantsKey
      );
    });
    storylines.push(canonicalMirror);
  }

  candidate.storylineUpdates = storylines;
};

// Pregame history is the existing one-time bootstrap seam. Validate only the
// canonical state that must survive INTO Round One; do not retroactively demand
// that every old battle/treaty mentioned in the backstory be replayed as a normal
// simulation mutation. Existing ledger decoders/appliers remain the sole owners of
// persisted war/diplomatic/storyline shapes.
const validatePregameCanonicalBootstrap = (
  candidate,
  {
    world = {},
    startDate = "",
    strict = true,
    canonicalPolities = [],
  } = {},
) => {
  const eventError = validatePregameEvents(candidate, { startDate, strict });
  if (eventError) return eventError;

  const polityError = validatePregamePolityVocabulary(candidate, {
    world,
    canonicalPolities,
  });
  if (polityError) return polityError;

  // Rebind after date salvage/sorting so model-supplied event numbers can never
  // point at the wrong historical event. War binding uses event.warId + transition
  // semantics; diplomacy/storylines use their existing native semantic binders.
  normalizeWorldWarEventLinks(candidate);

  // Final-attempt date salvage may remove/reorder pregame events. Pass-local event
  // numbers are no longer trustworthy after that mutation, so force the existing
  // semantic binders to re-derive diplomacy/storyline links from the surviving
  // event content. Wrong historical dates are worse than a safely dropped row.
  if (!strict) {
    candidate.relationUpdates = decodeRelationUpdates(candidate?.relationUpdates)
      .map((update) => ({ ...update, eventIndexes: [], eventIds: [] }));
    candidate.agreementUpdates = decodeAgreementUpdates(candidate?.agreementUpdates)
      .map((update) => ({ ...update, eventIndexes: [], eventIds: [] }));
    candidate.storylineUpdates = decodeWorldStorylineUpdates(candidate?.storylineUpdates)
      .map((update) => ({ ...update, eventIndexes: [] }));
  }

  const warUpdates = decodeWarUpdates(candidate?.warUpdates);
  for (let index = 0; index < warUpdates.length; index += 1) {
    const update = warUpdates[index];
    if (!["start", "join-a", "join-b", "leave", "ceasefire", "resume", "end"].includes(normalizeString(update?.op))) {
      return `$.warUpdates record ${index + 1} has unsupported operation ${normalizeString(update?.op) || "<blank>"}.`;
    }
    const indexes = normalizeArray(update?.eventIndexes);
    if (!indexes.length) {
      return `$.warUpdates record ${index + 1} (${normalizeString(update?.id) || "unnamed war"}) must link to a real pre-game event. Set matching event.warId on the causal pre-game event; Javascript owns the ledger-event binding.`;
    }
    if (indexes.some((eventIndex) => eventIndex < 0 || eventIndex >= normalizeArray(candidate?.events).length)) {
      return `$.warUpdates record ${index + 1} references a pre-game event outside $.events.`;
    }
  }

  // Probe the EXISTING war ledger in-memory. This catches invalid start/join/
  // ceasefire ordering without applying the normal hard-combat validator to old
  // historical cards that are records rather than current-turn mutations.
  const warProbe = applyWarUpdates({
    world,
    updates: warUpdates,
    events: normalizeArray(candidate?.events),
    stopDate: startDate,
    round: 1,
  });
  if (warProbe.appliedIds.length !== warUpdates.length) {
    return "$.warUpdates contains an invalid Round-One war lifecycle sequence. Bootstrap only wars that actually survive into the start date, beginning with a valid start operation.";
  }
  const touchedWarIds = new Set(warUpdates.map((update) => normalizeString(update?.id)).filter(Boolean));
  for (const warId of touchedWarIds) {
    const war = normalizeArray(warProbe.wars).find((entry) => normalizeString(entry?.id) === warId);
    if (!war || !["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) {
      return `$.warUpdates leaves ${warId} ${normalizeString(war?.status) || "missing"} at Round One. Wars already ended before the campaign belongs only in pre-game events, not the live war ledger.`;
    }
  }

  // Belligerency is already authoritative at this point. Mirror every surviving
  // Round-One war into the EXISTING storyline ledger mechanically rather than
  // spending another AI schema slot on an exact-id duplicate of the same fact.
  ensurePregameWarStorylineMirrors(candidate, {
    warProbe,
    warUpdates,
    startDate,
  });

  const agreementUpdates = decodeAgreementUpdates(candidate?.agreementUpdates);
  for (let index = 0; index < agreementUpdates.length; index += 1) {
    if (normalizeString(agreementUpdates[index]?.op).toLowerCase() !== "start") {
      return `$.agreementUpdates record ${index + 1} must use op=start for a formal commitment already in force when this fresh save begins. Ended/expired/suspended historical instruments belong in the backstory, not the active Day-1 ledger.`;
    }
  }

  // Round Zero represents state that already exists on the start date. Its bounded
  // historical event cards are evidence/context, not a requirement that every
  // baseline relation or standing treaty have one uniquely attributable event card.
  // The existing diplomatic director still binds a causal event when one is clear;
  // otherwise it retains the structurally valid baseline fact only in this mode.
  const diplomaticError = validateDiplomaticLedgerPayload(candidate, {
    world,
    allowNativeBinding: true,
    allowUnboundBaseline: true,
  });
  if (diplomaticError) return diplomaticError;

  normalizeWorldStorylineEventLinks(candidate, { world });
  const storylineUpdates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  for (let index = 0; index < storylineUpdates.length; index += 1) {
    const storyline = storylineUpdates[index];
    if (normalizeString(storyline?.status).toLowerCase() === "resolved") {
      return `$.storylineUpdates record ${index + 1} is resolved. Pregame bootstrap persists only unresolved processes that are still alive at Round One.`;
    }
    const startedDate = normalizeString(storyline?.startedDate);
    if (startedDate && parseIsoDate(startDate) && (!parseIsoDate(startedDate) || startedDate > startDate)) {
      return `$.storylineUpdates record ${index + 1} startedDate must be on or before the Round-One date ${startDate}.`;
    }
  }

  // Canonical wars and causal war-processes remain separate ledgers. The mirror
  // above guarantees that every live Round-One war also has the exact scheduler id
  // required by the existing World Director; this assertion catches only an actual
  // adapter failure, not a model formatting mistake.
  const storylineById = new Map(
    storylineUpdates
      .map((entry) => [normalizeString(entry?.id), entry])
      .filter(([id]) => Boolean(id)),
  );
  for (const warId of touchedWarIds) {
    const war = normalizeArray(warProbe.wars).find((entry) => normalizeString(entry?.id) === warId);
    if (!war || !["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) continue;
    const storyline = storylineById.get(`storyline-${warId}`);
    if (!storyline || normalizeString(storyline?.status).toLowerCase() !== "active" || normalizeString(storyline?.kind).toLowerCase() !== "war") {
      return `Round-Zero war-storyline mirror failed for canonical conflict ${warId}. Javascript must create ACTIVE storyline-${warId} with kind=war after the war ledger validates.`;
    }
  }

  const storylineError = validateWorldStorylinePayload(candidate, {
    existingStorylines: world?.storylines,
    selectedStorylines: [],
    deferredStorylines: [],
    originDate: startDate,
    stopDate: startDate,
    world,
    enforceAntiStasis: false,
  });
  if (storylineError) return storylineError;

  // Do not reject an otherwise valid bootstrap merely because the model chose a
  // sparse diplomatic graph. Completeness is a generation-quality concern; native
  // ledgers must preserve every valid baseline fact the model did emit rather than
  // turning one missing edge into a total fresh-save failure.

  return "";
};

// A fresh game whose scenario wrote a "World Before Round One" briefing gets
// initialized once, the first time the player opens it. The SAME existing
// pregameHistory call writes the bounded historical timeline AND bootstraps the
// canonical state that is already alive at Round One: unresolved storylines,
// active/ceasefire wars, material relations and active formal agreements.
//
// This deliberately does NOT use applySimulationResult: the clock stays at the
// start date, round stays 1, and pregame event impacts are never replayed. The
// existing native ledgers receive only their own canonical bootstrap records.
// simulationHistory remains the one-time done-marker.
export const maybeGeneratePregameHistory = async () => {
  if (isSimulationBusy()) return null;
  const bundle = await readGameStateBundle({ force: true });
  const briefing = normalizeString(bundle.world.startingTimelineText);
  if (!briefing) return null;
  if (normalizeEvents(bundle.events).length > 0) return null;
  if ((normalizeWorldState(bundle.world).simulationHistory ?? []).length > 0) return null;
  const startDate = normalizeString(bundle.game.startDate || bundle.game.gameDate);
  if (!startDate) return null;

  beginSimulation();
  try {
    const canonicalPolities = await buildCurrentCanonicalPolityVocabulary(bundle.world);
    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "pregameHistory" })),
      pregameCanonicalPolityVocabulary:
        canonicalPolities.length > 0
          ? canonicalPolities.map((name) => `- ${name}`).join("\n")
          : "No current polity vocabulary was available.",
    };
    console.info(`[OH pregame bootstrap] starting Round-Zero initialization for ${startDate}...`);
    const { payload } = await runJsonTask("pregameHistory", {
      timeoutMs: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 300000 : 0,
      userMessage: `Write the pre-game historical timeline AND canonical Round-One bootstrap for ${startDate} through the required structured output only. Put every storyline/war/relation/agreement semantic update into canonicalUpdates using the correct kind field. Use ONLY supplied current Round-One polity identities. Do not serialize ledger mini-languages or invent event indexes. This is a baseline-state compiler: do not stop after only a few obvious facts. For a dense, source-rich historical start, normally return about 8-10 materially important pre-game events and use roughly 10-12 canonicalUpdates; return less only when the supplied source genuinely supports less, never by inventing filler. Within the provider-safe capacity, prioritize ALL active wars and formal agreements first, then the most important unresolved NON-WAR processes, then use remaining canonicalUpdates for materially important bilateral political climates among the central actors. A Round-One relation or standing agreement does NOT need a dedicated historical event card merely to exist; include historical events because they are important timeline anchors, not as bookkeeping padding. Before finishing, re-check the supplied source for omitted live agreements, unresolved pressures, and major diplomatic relationships if you are substantially below those targets.`,
      validatePayload: (candidate, { finalAttempt } = {}) =>
        validatePregameCanonicalBootstrap(candidate, {
          world: bundle.world,
          startDate,
          strict: !finalAttempt,
          canonicalPolities,
        }),
      variables,
    });

    // The player may have switched games while this generated — the runtime
    // endpoints follow the ACTIVE game, so re-verify the same fresh game is
    // still there before writing anything.
    const [eventsNow, worldNow, gameNow] = await Promise.all([
      readEventsState({ force: true }),
      readWorldState({ force: true }),
      readGameData({ force: true }),
    ]);
    if (normalizeEvents(eventsNow).length > 0) return null;
    const currentWorld = normalizeWorldState(worldNow);
    if ((currentWorld.simulationHistory ?? []).length > 0) return null;
    if (normalizeString(gameNow.startDate || gameNow.gameDate) !== startDate) return null;

    const generatedEvents = normalizeArray(payload?.events)
      .map((entry, index) =>
        normalizeGeneratedEvent({ ...entry, impacts: undefined, source: "pregame" }, index))
      .filter(Boolean);
    if (generatedEvents.length === 0) return null;

    // Storyline ids are attached to the historical events before any ledger is
    // applied, giving every Day-1 process stable causal sourceEventIds and a real
    // lastVisibleEventDate without inventing another bootstrap registry.
    const storylineUpdates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
    const bootstrapEvents = attachDecodedStorylineIds(
      generatedEvents,
      storylineUpdates,
      "pregame",
    );
    const warUpdates = bindWarUpdatesToEvents(
      decodeWarUpdates(payload?.warUpdates),
      bootstrapEvents,
    );
    const relationUpdates = bindRelationUpdatesToEvents(
      decodeRelationUpdates(payload?.relationUpdates),
      bootstrapEvents,
    );
    const agreementUpdates = bindAgreementUpdatesToEvents(
      decodeAgreementUpdates(payload?.agreementUpdates),
      bootstrapEvents,
    );

    // Reuse the normal canonical ownership order. Belligerency exists before
    // storyline scheduling asks whether a war-process is active; diplomacy then
    // supplies the commitments/relations that shape every later world pass.
    const warMerge = applyWarUpdates({
      world: currentWorld,
      updates: warUpdates,
      events: bootstrapEvents,
      stopDate: startDate,
      round: 1,
    });
    const diplomaticMerge = applyDiplomaticUpdates({
      world: warMerge.world,
      relationUpdates,
      agreementUpdates,
      events: bootstrapEvents,
      stopDate: startDate,
      round: 1,
      allowUnboundBaseline: true,
    });
    const storylineMerge = applyWorldStorylineUpdates({
      world: diplomaticMerge.world,
      updates: storylineUpdates,
      events: bootstrapEvents,
      stopDate: startDate,
      round: 1,
    });

    console.info(
      `[OH pregame bootstrap] ${bootstrapEvents.length} historical event(s); ` +
      `${storylineMerge.appliedIds.length} storyline(s); ` +
      `${warMerge.appliedIds.length} war operation(s); ` +
      `${diplomaticMerge.appliedRelationIds.length} relation(s); ` +
      `${diplomaticMerge.appliedAgreementIds.length} agreement(s).`,
    );

    const summary = normalizeString(payload?.summary);
    const nextWorld = storylineMerge.world;
    nextWorld.simulationHistory = [
      {
        catalyst: null,
        date: startDate,
        eventIds: bootstrapEvents.map((event) => event.id),
        fallbackReason: "",
        fromDate: normalizeString(bootstrapEvents[0]?.date) || startDate,
        mode: "pregame",
        plannedActions: [],
        round: 1,
        summary,
        source: "ai",
        toDate: startDate,
      },
    ];

    await Promise.all([
      writeEventsState(bootstrapEvents),
      writeWorldState(nextWorld),
    ]);
    return bootstrapEvents;
  } catch (error) {
    // This is now canonical initialization rather than cosmetic backstory. Keep
    // it retryable, but make failures visible in DevTools instead of silently
    // starting a causally blank world and spending months debugging the symptom.
    console.warn("[OH pregame bootstrap] initialization failed; the fresh-save caller may retry.", error);
    return null;
  } finally {
    endSimulation();
  }
};

// ---- Event Editor diplomatic reaction queue ---------------------------------
// A manually-authored event can optionally invite ONE autonomous NPC reaction.
// The editor commits the event immediately, then stores a real-time grace deadline
// in world.pendingEventOutreach. This worker evaluates only when the deadline is
// due, re-reads the exact event before AND after the model call, and routes any
// resulting message through the same canonical chat merge path as normal gameplay.
const eventReactionKey = (event) => [
  normalizeString(event?.id),
  normalizeString(event?.createdAt),
].join("\u001f");

const eventReactionQueueKey = (entry) => [
  normalizeString(entry?.sourceEventId),
  normalizeString(entry?.sourceEventCreatedAt),
].join("\u001f");

const eventReactionPromptText = (event, playerName) => {
  const quote = event?.quote?.text
    ? `\nQuote: “${normalizeString(event.quote.text)}”${event.quote.speaker ? ` — ${normalizeString(event.quote.speaker)}` : ""}`
    : "";
  return [
    `PLAYER POLITY: ${normalizeString(playerName) || "Unknown"}`,
    `EVENT DATE: ${normalizeString(event?.date) || "Undated"}`,
    `EVENT TITLE: ${normalizeString(event?.title) || "Untitled"}`,
    `EVENT KIND: ${normalizeString(event?.kind) || "world"}`,
    `EVENT IMPORTANCE: ${normalizeString(event?.importance) || "minor"}`,
    `PLAYER-RELATED FLAG: ${event?.playerRelated ? "yes" : "no"}`,
    `EVENT DESCRIPTION: ${normalizeString(event?.description) || "No description."}${quote}`,
  ].join("\n");
};

const eventReactionDueMs = (entry) => {
  const ms = Date.parse(normalizeString(entry?.deliverAfter));
  return Number.isFinite(ms) ? ms : 0;
};

let eventReactionInFlight = false;

export const processPendingEventOutreach = async ({ debug = false } = {}) => {
  if (eventReactionInFlight) return debug ? { processed: 0, reason: "already-in-flight", retryAfterMs: 1000 } : null;
  if (isSimulationBusy()) return debug ? { processed: 0, reason: "simulation-busy", retryAfterMs: 5000 } : null;

  eventReactionInFlight = true;
  try {
    let bundle = await readGameStateBundle({ force: true });
    const now = Date.now();
    const queue = normalizeArray(bundle.world?.pendingEventOutreach)
      .slice()
      .sort((a, b) => eventReactionDueMs(a) - eventReactionDueMs(b));
    const due = queue.find((entry) => eventReactionDueMs(entry) <= now);

    if (!due) {
      const nextDue = queue.length ? eventReactionDueMs(queue[0]) : 0;
      return debug ? {
        processed: 0,
        reason: queue.length ? "not-due" : "empty",
        nextDueAt: nextDue ? new Date(nextDue).toISOString() : "",
      } : null;
    }

    const dueKey = eventReactionQueueKey(due);
    const dueQueueId = normalizeString(due?.id);
    const findCurrentEvent = (events) => normalizeArray(events).find((event) => eventReactionKey(event) === dueKey);
    let event = findCurrentEvent(bundle.events);

    const removeQueueEntry = async (worldInput, { events = null, reactionResult = "", chatId = "" } = {}) => {
      const nextWorld = {
        ...worldInput,
        pendingEventOutreach: normalizeArray(worldInput?.pendingEventOutreach)
          .filter((entry) => normalizeString(entry?.id) !== dueQueueId),
      };
      await writeWorldState(nextWorld);

      if (event && events && reactionResult) {
        const updatedEvents = normalizeArray(events).map((candidate) =>
          eventReactionKey(candidate) === dueKey
            ? {
                ...candidate,
                npcReaction: {
                  ...(candidate?.npcReaction || {}),
                  enabled: Boolean(candidate?.npcReaction?.enabled),
                  evaluatedAt: new Date().toISOString(),
                  result: reactionResult,
                  ...(chatId ? { chatId } : {}),
                },
              }
            : candidate
        );
        await writeEventsState(updatedEvents);
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:event-outreach-evaluated", {
          detail: { sourceEventId: due.sourceEventId, result: reactionResult || "cancelled", chatId },
        }));
      }
    };

    if (!event || !event?.npcReaction?.enabled) {
      await removeQueueEntry(bundle.world);
      return debug ? { processed: 1, reason: event ? "reaction-disabled" : "event-missing" } : null;
    }

    const beforeSignature = JSON.stringify({
      date: event.date,
      title: event.title,
      description: event.description,
      quote: event.quote || null,
      kind: event.kind,
      importance: event.importance,
      playerRelated: Boolean(event.playerRelated),
    });

    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "idleDiplomacy" })),
      idleDiplomacyBlockedParticipantSets: "None.",
      eventDiplomaticReactionContext: eventReactionPromptText(event, bundle.game?.country),
    };

    let payload;
    try {
      ({ payload } = await runJsonTask("idleDiplomacy", {
        timeoutMs: 60000,
        maxTokens: 1024,
        reasoningEnabled: false,
        userMessage:
          "Evaluate the supplied canonical event once. Decide whether one AI-controlled polity or a genuinely joint small group would naturally send the player a diplomatic message because of it. Casual friendly acknowledgement is allowed; silence is also fully valid. Return JSON only.",
        validatePayload: async (candidate, { finalAttempt } = {}) => {
          if (candidate?.chat == null) return "";
          const countries = await resolveInvitees(candidate.chat.countries, bundle.world);
          if (countries.length === 0) {
            return "$.chat.countries must contain at least one known non-player polity (or chat must be null).";
          }
          return finalAttempt ? "" : validateChatOpener(candidate.chat, "$.chat");
        },
        variables,
      }));
    } catch (error) {
      // Keep the request pending, but back off instead of hot-looping a dead provider.
      const latestWorld = await readWorldState({ force: true });
      const latestQueue = normalizeArray(latestWorld.pendingEventOutreach).map((entry) =>
        normalizeString(entry?.id) === dueQueueId
          ? {
              ...entry,
              attempts: Number(entry?.attempts || 0) + 1,
              deliverAfter: new Date(Date.now() + 30000).toISOString(),
              lastError: normalizeString(error?.message),
            }
          : entry
      );
      await writeWorldState({ ...latestWorld, pendingEventOutreach: latestQueue });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:event-outreach-queue-changed"));
      }
      return debug ? { processed: 0, reason: "ai-error", retryAfterMs: 30000, message: normalizeString(error?.message) } : null;
    }

    // The grace window extends through generation in practice: if the admin edits,
    // disables, or deletes the event while the model is thinking, do NOT send a stale
    // message. Re-evaluate the latest edit instead, or cancel if the event vanished.
    const [latestWorld, latestEvents] = await Promise.all([
      readWorldState({ force: true }),
      readEventsState({ force: true }),
    ]);
    const queueStillPending = normalizeArray(latestWorld.pendingEventOutreach)
      .some((entry) => normalizeString(entry?.id) === dueQueueId);
    const latestEvent = findCurrentEvent(latestEvents);

    if (!queueStillPending || !latestEvent || !latestEvent?.npcReaction?.enabled) {
      if (queueStillPending) await removeQueueEntry(latestWorld);
      return debug ? { processed: 1, reason: "cancelled-during-generation" } : null;
    }

    const afterSignature = JSON.stringify({
      date: latestEvent.date,
      title: latestEvent.title,
      description: latestEvent.description,
      quote: latestEvent.quote || null,
      kind: latestEvent.kind,
      importance: latestEvent.importance,
      playerRelated: Boolean(latestEvent.playerRelated),
    });

    if (afterSignature !== beforeSignature) {
      const rescheduled = normalizeArray(latestWorld.pendingEventOutreach).map((entry) =>
        normalizeString(entry?.id) === dueQueueId
          ? { ...entry, deliverAfter: new Date(Date.now() + 1000).toISOString(), lastError: "" }
          : entry
      );
      await writeWorldState({ ...latestWorld, pendingEventOutreach: rescheduled });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:event-outreach-queue-changed"));
      }
      return debug ? { processed: 0, reason: "event-changed-requeue", retryAfterMs: 1000 } : null;
    }

    event = latestEvent;

    if (!payload?.chat) {
      await removeQueueEntry(latestWorld, { events: latestEvents, reactionResult: "silent" });
      return debug ? { processed: 1, reason: "model-chose-silence" } : null;
    }

    if (isSimulationBusy()) {
      const deferred = normalizeArray(latestWorld.pendingEventOutreach).map((entry) =>
        normalizeString(entry?.id) === dueQueueId
          ? { ...entry, deliverAfter: new Date(Date.now() + 5000).toISOString() }
          : entry
      );
      await writeWorldState({ ...latestWorld, pendingEventOutreach: deferred });
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("oh:event-outreach-queue-changed"));
      return debug ? { processed: 0, reason: "simulation-started-during-generation", retryAfterMs: 5000 } : null;
    }

    const built = await buildGeneratedChat(
      { ...payload.chat, source: "event-reaction" },
      event.id,
      latestWorld,
      { fallbackTitle: event.title, playerName: bundle.game?.country },
    );

    if (!built) {
      await removeQueueEntry(latestWorld, { events: latestEvents, reactionResult: "silent" });
      return debug ? { processed: 1, reason: "generated-chat-invalid-treated-as-silence" } : null;
    }

    const messageDate = normalizeString(event.date) || normalizeString(bundle.game?.gameDate);
    const datedBuilt = {
      ...built,
      messages: built.messages.map((message, index) =>
        index === 0 && !normalizeString(message.time)
          ? { ...message, time: messageDate }
          : message
      ),
    };

    const currentChats = await readChatsState({
      force: true,
      world: latestWorld,
      playerCountry: bundle.game?.country,
    });
    const nextChats = mergeIncomingChats(currentChats, [datedBuilt], latestWorld, {
      playerCountry: bundle.game?.country,
    });
    await writeChatsState(nextChats, {
      world: latestWorld,
      playerCountry: bundle.game?.country,
    });

    const builtParticipantKey = chatParticipantSetKey(datedBuilt, latestWorld);
    const mergedChat = builtParticipantKey
      ? nextChats.find((chat) =>
          normalizeString(chat?.status).toLowerCase() !== "closed" &&
          chatParticipantSetKey(chat, latestWorld) === builtParticipantKey)
      : null;
    const actualChatId = normalizeString(mergedChat?.id || datedBuilt.id);

    await removeQueueEntry(latestWorld, {
      events: latestEvents,
      reactionResult: "sent",
      chatId: actualChatId,
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("oh:diplomacy-chats-updated", {
        detail: { source: "event-reaction", linkedEventId: event.id, chatId: actualChatId },
      }));
    }

    return datedBuilt;
  } finally {
    eventReactionInFlight = false;
  }
};

// ---- Idle diplomacy drip ----------------------------------------------------
// While the player sits between jumps, the world occasionally speaks first:
// on each real-world-minute tick (the caller's cadence) there is a small chance
// one polity sends a short note to the player's inbox. Hard-suspended while any
// simulation is in flight (busy lock above), never stacked, and silent on any
// failure — there is no canned fallback small talk.
// Raised from 1/20: at 1/20 (with a 60s visible-tab-only roll) a player waited ~20
// idle minutes just to CONSULT the model, and most consulted rolls still returned
// null — so AI-initiated chats felt almost nonexistent. 1/8 keeps a parked tab from
// filling the inbox while making an idle approach actually plausible; the jump-path
// cap (see defaultPrompts.json) remains the primary source of diplomacy.
const IDLE_DIPLOMACY_CHANCE = 1 / 8;
const IDLE_DIPLOMACY_MAX_PER_GAME_DATE = 2;

const idleDiplomacyBlockedSetsForDate = (chats, world, gameDate) => {
  const blocked = new Map();
  const wantedDate = normalizeString(gameDate);
  if (!wantedDate) return blocked;

  for (const chat of normalizeChats(chats)) {
    if (normalizeString(chat?.status).toLowerCase() === "closed") continue;
    const participantKey = chatParticipantSetKey(chat, world);
    if (!participantKey) continue;

    const activeToday = normalizeArray(chat?.messages).some((message) =>
      normalizeString(message?.role).toLowerCase() === "leader" &&
      normalizeString(message?.time) === wantedDate
    );
    if (!activeToday) continue;

    const names = normalizeArray(chat?.countries)
      .map((country) => {
        const identity = resolveChatParticipantIdentity(country, world);
        return normalizeString(identity?.name || country?.name || country?.code);
      })
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    blocked.set(participantKey, names.join(" + ") || participantKey);
  }

  return blocked;
};

const idleDiplomacyNoop = (debug, reason, details = {}) =>
  debug
    ? { __idleDiplomacyDebug: true, sent: false, reason, ...details }
    : null;

let idleDiplomacyInFlight = false;
let idleDiplomacyGameDate = "";
let idleDiplomacySuccessesThisDate = 0;

export const maybeSendIdleDiplomacy = async ({
  chance = IDLE_DIPLOMACY_CHANCE,
  debug = false,
} = {}) => {
  if (idleDiplomacyInFlight) return idleDiplomacyNoop(debug, "already-in-flight");
  if (isSimulationBusy()) return idleDiplomacyNoop(debug, "simulation-busy");
  if (Math.random() >= chance) return idleDiplomacyNoop(debug, "chance-miss");

  idleDiplomacyInFlight = true;
  try {
    const bundle = await readGameStateBundle({ force: true });
    if (!normalizeString(bundle.game?.country)) {
      return idleDiplomacyNoop(debug, "no-active-game");
    }

    // Real-time idling must not turn one frozen in-game day into an inbox avalanche.
    // Two successful autonomous notes per game date is enough to make the world feel
    // alive; advancing the campaign date resets the allowance. This remains
    // session-local: the saved-history guard below handles already-active threads.
    const currentGameDate = normalizeString(bundle.game?.gameDate);
    if (currentGameDate !== idleDiplomacyGameDate) {
      idleDiplomacyGameDate = currentGameDate;
      idleDiplomacySuccessesThisDate = 0;
    }
    if (idleDiplomacySuccessesThisDate >= IDLE_DIPLOMACY_MAX_PER_GAME_DATE) {
      return idleDiplomacyNoop(debug, "daily-cap-reached", {
        gameDate: currentGameDate,
        successesThisDate: idleDiplomacySuccessesThisDate,
      });
    }

    // Do this BEFORE the model call. The old version learned that Russia had already
    // spoken only after paying for another Russia message and then discarding it.
    // Existing chat state is already in the bundle, so this adds no network request.
    const blockedParticipantSets = idleDiplomacyBlockedSetsForDate(
      bundle.chats,
      bundle.world,
      currentGameDate,
    );
    const blockedParticipantKeys = new Set(blockedParticipantSets.keys());
    const blockedParticipantLabels = Array.from(blockedParticipantSets.values());

    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "idleDiplomacy" })),
      idleDiplomacyBlockedParticipantSets:
        blockedParticipantLabels.length > 0
          ? blockedParticipantLabels.map((label) => `- ${label}`).join("\n")
          : "None.",
    };

    const { payload } = await runJsonTask("idleDiplomacy", {
      // Background diplomacy must be bounded even when the global "limit AI
      // generation" setting is off. A stuck provider should not hold the idle lock
      // forever or burn a full reasoning budget for a one-paragraph telegram.
      timeoutMs: 60000,
      maxTokens: 1024,
      reasoningEnabled: false,
      userMessage:
        "A quiet moment between rounds. Decide whether one eligible polity or small joint group would send the player a short diplomatic note right now. Respect the blocked participant sets in the system instructions. Return JSON only.",
      validatePayload: async (candidate, { finalAttempt } = {}) => {
        if (candidate?.chat == null) return "";
        const countries = await resolveInvitees(candidate.chat.countries, bundle.world);
        if (countries.length === 0) {
          return "$.chat.countries must contain at least one known polity (or chat must be null).";
        }
        // Strict on attempt 1: make the model give the note a title AND a first
        // line, so the player can see why the polity reached out. Salvage on the
        // final attempt — buildGeneratedChat drops an opener-less note rather
        // than posting an empty "mystery" thread.
        return finalAttempt ? "" : validateChatOpener(candidate.chat, "$.chat");
      },
      variables,
    });

    if (!payload?.chat) {
      return idleDiplomacyNoop(debug, "model-chose-silence", {
        blockedParticipantSets: blockedParticipantLabels,
      });
    }

    // A jump may have started while the model was thinking; its state bundle
    // predates our write, so drop the note rather than race the save.
    if (isSimulationBusy()) {
      return idleDiplomacyNoop(debug, "simulation-started-during-generation");
    }

    const built = await buildGeneratedChat(
      { ...payload.chat, source: "outreach" },
      "",
      bundle.world,
      { playerName: bundle.game.country },
    );
    if (!built) {
      return idleDiplomacyNoop(debug, "generated-chat-invalid");
    }

    const builtParticipantKey = chatParticipantSetKey(built, bundle.world);

    // Final deterministic backstop for the pre-generation exclusion. The prompt
    // should prevent this in normal use, but model output never gets to override a
    // cost/spam guard.
    if (builtParticipantKey && blockedParticipantKeys.has(builtParticipantKey)) {
      return idleDiplomacyNoop(debug, "participant-set-already-active-today", {
        participants: normalizeArray(built.countries).map((country) => country.name).filter(Boolean),
      });
    }

    // Re-read immediately before the write because another diplomacy action could
    // have landed while the model was thinking. This is the race-safe guard; unlike
    // the old implementation, it should almost never be the first time we discover
    // that a participant set is already active today.
    const chats = await readChatsState({
      force: true,
      world: bundle.world,
      playerCountry: bundle.game.country,
    });
    const alreadyActiveToday = builtParticipantKey && chats.some((chat) =>
      normalizeString(chat?.status).toLowerCase() !== "closed" &&
      chatParticipantSetKey(chat, bundle.world) === builtParticipantKey &&
      normalizeArray(chat?.messages).some((message) =>
        normalizeString(message?.role).toLowerCase() === "leader" &&
        normalizeString(message?.time) === currentGameDate
      )
    );
    if (alreadyActiveToday) {
      return idleDiplomacyNoop(debug, "participant-set-became-active-during-generation", {
        participants: normalizeArray(built.countries).map((country) => country.name).filter(Boolean),
      });
    }

    const datedBuilt = {
      ...built,
      messages: built.messages.map((message, index) =>
        index === 0 && !normalizeString(message.time)
          ? { ...message, time: currentGameDate }
          : message
      ),
    };

    // Same reconciliation path as full turns: 1:1 and GROUP approaches reuse an
    // existing open thread when the stable participant set is the same, regardless
    // of alias/display name or participant order. Closed historical talks stay closed.
    const nextChats = mergeIncomingChats(chats, [datedBuilt], bundle.world, {
      playerCountry: bundle.game.country,
    });

    if (isSimulationBusy()) {
      return idleDiplomacyNoop(debug, "simulation-started-before-write");
    }

    await writeChatsState(nextChats, {
      world: bundle.world,
      playerCountry: bundle.game.country,
    });
    idleDiplomacySuccessesThisDate += 1;
    return datedBuilt;
  } catch (error) {
    return idleDiplomacyNoop(debug, "error", {
      message: normalizeString(error?.message),
    });
  } finally {
    idleDiplomacyInFlight = false;
  }
};
