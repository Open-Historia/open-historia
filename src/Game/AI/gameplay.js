/*! Open Historia — portions (briefing dossiers + timeout/fallback hardening) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { curateGeneratedEvents } from "./nativeTimelineCurator.js";
import { directGeneratedUnitOps } from "./nativeUnitDirector.js";
import { directGeneratedTerritoryOps } from "./nativeTerritoryDirector.js";
import {
  applyWorldStorylineUpdates,
  buildWorldInitiativeContext,
  decodeWorldStorylineUpdates,
  validateWorldStorylinePayload,
} from "./nativeWorldDirector.js";
import {
  applyWarUpdates,
  bindWarUpdatesToEvents,
  buildCanonicalWarContext,
  decodeWarUpdates,
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
import { logContextDiagnostics } from "./contextDiagnostics.js";
import { NATIVE_GAME_MASTER_PROMPT, normalizePromptPack } from "./gameplayPrompts.js";
import {
  decodeGameMasterTransportPayload,
  getGameplayTool,
  validateGameplayPayload,
} from "./gameplaySchemas.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import {
  finalizeCountryStatSheet,
  guardCountryStatContinuity,
  isCompleteCountryStatSheet,
  normalizeCountryStatSheet,
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
  resolveChatParticipantIdentity,
  readEventsState,
  readGameData,
  readGameStateBundle,
  readWorldState,
  writeActionsState,
  writeChatsState,
  writeEventsState,
  writeGameData,
  writeWorldState,
} from "../../runtime/gameState.js";
import { dedupeGeneratedEvents } from "../../runtime/eventDedup.js";
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

const decodeCountryStatComponents = (value, plan = []) => {
  // 7A.1.3: when native code has a legal-territory plan, Gemini is allowed to
  // estimate ONLY the economic values/classification. Geography identity and
  // coverage are bound by index here so the model cannot replace Germany with
  // Prussia/Bavaria, omit a partial modern-base bucket, or double-count a parent
  // and child. The persistent sheet therefore inherits the map's exact legal
  // partition rather than the model's preferred historical vocabulary.
  const nativePlan = normalizeArray(plan)
    .map((entry, index) => ({
      index: Number(entry?.index) || index + 1,
      geography: normalizeString(entry?.geography),
    }))
    .filter((entry) => entry.geography);

  if (nativePlan.length > 0) {
    const text = normalizeString(value);
    if (!text) {
      return { components: [], error: `territorialComponentsText is empty; return exactly ${nativePlan.length} indexed component estimate row(s).` };
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

      if (!Number.isInteger(index) || index < 1 || index > nativePlan.length) continue;
      if (!["core", "integrated", "overseas/dependent"].includes(group)) continue;
      if (!Number.isFinite(population) || population < 0) continue;
      if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;
      if (estimates.has(index)) continue;

      estimates.set(index, {
        group,
        population: Math.round(population),
        gdpPerCapita,
      });
    }

    const missing = nativePlan
      .map((entry) => entry.index)
      .filter((index) => !estimates.has(index));
    if (missing.length > 0 || estimates.size !== nativePlan.length) {
      return {
        components: [],
        error: `territorialComponentsText must contain exactly one valid row for every native component index 1-${nativePlan.length}; missing index(es): ${missing.join(", ") || "none"}.`,
      };
    }

    return {
      components: nativePlan.map((entry) => ({
        geography: entry.geography,
        ...estimates.get(entry.index),
      })),
      error: "",
    };
  }

  // Compatibility fallback for a save/scenario where no map-derived plan could
  // be built. This preserves the 7A.1 compact transport rather than making Stats
  // unusable for landless/custom scenarios.
  if (Array.isArray(value)) return { components: value, error: "" };
  const text = normalizeString(value);
  if (!text) return { components: [], error: "" };

  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("~").map((part) => part.trim());
    if (parts.length !== 4) continue;

    const [groupRaw, geography, populationRaw, gdpPerCapitaRaw] = parts;
    const group = groupRaw.toLowerCase();
    const population = Number(String(populationRaw).replace(/[,_\s]/g, ""));
    const gdpPerCapita = Number(String(gdpPerCapitaRaw).replace(/[,_€$£\s]/g, ""));

    if (!["core", "integrated", "overseas/dependent"].includes(group)) continue;
    if (!geography || !Number.isFinite(population) || population < 0) continue;
    if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;

    rows.push({
      geography,
      group,
      population: Math.round(population),
      gdpPerCapita,
    });
    if (rows.length >= 64) break;
  }

  return { components: rows, error: "" };
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

const buildTemplateVariables = async (bundle, options = {}) => {
  const variables = await buildPromptContext(bundle, options);
  const chatFocusActors = normalizeArray(options?.chat?.countries)
    .map((country) => normalizeString(country?.polityKey || country?.name || country?.code))
    .filter(Boolean);
  const diplomaticContext = buildBoundedDiplomaticContext(bundle.world, {
    playerPolity: normalizeString(bundle?.game?.country),
    focusActors: chatFocusActors,
    maxActors: 8,
  });
  return {
    ...variables,
    playerPolityReputationContext: await buildPlayerPolityReputationText(bundle),
    territorialControlContext: await buildTerritorialControlContext(bundle.world),
    canonicalWarContext: buildCanonicalWarContext(bundle.world),
    canonicalDiplomaticContext: diplomaticContext.text,
    unitsSummary:
      variables.unitsSummary +
      buildMilitaryFeasibilityText(bundle.world, buildActionHistoryText(bundle.actions)),
  };
};

// Give the AI real time: local/self-hosted models (and reasoning modes) often
// need well over a minute per turn. The old 12s default silently discarded
// their answers and served the canned fallback instead — turns "completed"
// with nothing to show. The UI has spinners; waiting beats silently wrong.
// Capability reference appended to every timeline jump (see runJsonTask below): the
// full menu of world-changing levers the tool schema exposes, so the model always ends
// its system prompt with an explicit list of what it can do and how. Injected at call
// time so it reaches existing frozen-prompt games too.
const ACTIONS_REFERENCE = `[Actions You Can Take]\nThis is the full menu of levers you have to change the world. Everything you change rides on an event's \"impacts\" object, except the whole-jump levers noted at the end. Reach for the RIGHT lever, and NEVER narrate a change in an event's text without also emitting the impact that makes it real — narration and world state must always agree.\n\n• regionTransfers — LEGAL SOVEREIGNTY only: treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final territorial settlement. Shape: {"regionId":"<exact id/name when known; otherwise exact grounded place wording>","regionName":"","fromCode":"<current legal sovereign>","toCode":"<new legal sovereign>"}. Do NOT use regionTransfers for a temporary battlefield capture or occupation.\n\n• regionControlOps — DE-FACTO CONTROL / ACTIVE FRONT state. Three ops:\n    {"op":"contest","regionId":"<region/place>","fromCode":"<current controller>","actorCode":"<challenger>","note":""}\n    {"op":"control","regionId":"<region/place>","fromCode":"<previous controller>","toCode":"<new controller>","note":""}\n    {"op":"clear_contest","regionId":"<region/place>","fromCode":"<current controller>","claimantCode":"<claimant to remove>","clearAll":false,"note":""}\n  Use contest when fighting makes a named region actively disputed without a decisive control change. Use control for wartime capture/occupation/liberation/retaking. Use clear_contest when withdrawal, ceasefire or settlement ends the active contest. ALWAYS set fromCode when you know the current controller so the geography resolver is bounded to that side's actual regions. The existing map stripes regionClaimants automatically; do not fake a legal treaty just to make the front move.\n\n• polityChanges — Explicit polity lifecycle or metadata changes. EVERY entry must include operation:\"update|create|rename|restore|dissolve\" and code:\"<FULL polity name, never an abbreviation>\". update changes metadata/stats/tags/reputation on an EXISTING polity only; create explicitly establishes a genuinely NEW current polity/breakaway state; rename reconstitutes an existing polity under a new current/display name while preserving its stable campaign identity; restore explicitly brings a dormant/dissolved polity back; dissolve explicitly ends a polity after its territory is separately settled. Example: {\"operation\":\"update\",\"code\":\"German Empire\",\"reputation\":60,\"tags\":[\"...\"],\"stats\":{},\"note\":\"<why>\"}. A same-event create/restore happens before that event\'s regionTransfers, so a newborn polity may immediately receive only the territory the event actually establishes. Never mint a new polity merely because you used a stale/sloppy alternate name. On an ideological/alignment shift rewrite the COMPLETE tags list. National statistics change only through stats; when leadership changes, update stats.leader.\n\n• unitOps — Move the war on the map with PERSISTENT battalions. Five ops:\n    {\"op\":\"spawn\",\"unit\":{\"name\":\"\",\"type\":\"infantry|armor|air|naval|artillery|garrison\",\"ownerCode\":\"\",\"strength\":1-1000,\"lng\":0,\"lat\":0,\"regionId\":\"\"}}\n    {\"op\":\"move\",\"unitId\":\"<existing id>\",\"toLng\":0,\"toLat\":0,\"regionId\":\"\",\"note\":\"\"}\n    {\"op\":\"attack\",\"unitId\":\"<existing attacker id>\",\"targetUnitId\":\"<existing enemy id>\",\"note\":\"\"}\n    {\"op\":\"strength\",\"unitId\":\"<existing id>\",\"strength\":0-1000,\"note\":\"\"}\n    {\"op\":\"remove\",\"unitId\":\"<existing id>\",\"note\":\"\"}\n  REUSE existing units by id. An offensive, retreat, redeployment or continuing war normally MOVES the units that already exist; do not spawn a fresh army every time the prose says forces act. Spawn only for a genuinely new formation/mobilization/reinforcement that is not already represented. Use attack when two existing opposing units actually fight: the runtime resolves casualties deterministically, so NEVER invent post-battle strength values for those participants in the same event. strength is for explicit non-combat reinforcement/attrition/reorganization; remove only for destruction/disbandment/demobilization. When a front is decisively won in wartime, pair the advance with regionControlOps control; use regionTransfers only if that same event also legally settles sovereignty.\n\n• markerOps — Place, remove, or rename a named structure or city. Three ops:\n    {\"op\":\"build\",\"marker\":{\"name\":\"\",\"kind\":\"<lowercase, e.g. military base / port / embassy / airfield / city>\",\"ownerCode\":\"\",\"lng\":0,\"lat\":0,\"note\":\"\",\"foundedAt\":\"\"}}\n    {\"op\":\"remove\",\"name\":\"<exact existing name>\",\"note\":\"\"}\n    {\"op\":\"rename\",\"name\":\"<current name>\",\"newName\":\"<new name>\",\"note\":\"<why>\"}\n  Emit build whenever an event founds or constructs a place, remove when one is destroyed, and rename when a city or structure is renamed (rename works on existing map cities too — a city renamed after a leader or ideology, a capital re-designated, a conquered city given the conqueror's name). Structures NEVER move borders: a facility one polity builds inside another's land does not transfer the region, and ownerCode is who runs the facility, not who owns the ground.\n\n• createdChats — Have another polity open a diplomatic chat with the player BECAUSE of this event (a war scare prompting mediation, a border incident prompting an ultimatum, a windfall prompting a trade delegation). Shape: {\"countries\":[\"...\"],\"title\":\"<names the purpose>\",\"speaker\":\"<the initiating polity — never the player>\",\"openingMessage\":\"<that leader's first message, in their voice>\"}. The other side always speaks first; a blank or untitled chat is invalid.\n\n• actionIds — List the ids of the player's queued actions that this event resolves, so the game can clear them from the queue.\n\nWAR EVENT METADATA:\n• warId — REQUIRED on an event that declares/joins/ends a war OR depicts actual battlefield combat. It must identify the canonical conflict in world.wars.\n• combatants — REQUIRED for actual battle/offensive/invasion/bombardment/front-combat events. List the polity names directly fighting; at least one must come from each opposing side of warId.\n\nWhole-jump levers (top level of your output, NOT inside an event):\n• warUpdates — AUTHORITATIVE BELLIGERENCY changes. This is NOT a storyline and NOT optional when war status changes. One compact record per line:\n    warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note\n  ops: start | join-a | join-b | leave | ceasefire | resume | end\n  start: actors=Side A and opponents=Side B. join-a/join-b: actors are the joining polities. leave: actors are the leaving polities.\n  eventNumbersCSV is 1-based and points to the event(s) in THIS response establishing the transition. Every war transition must have a real linked event. A defensive alliance, mobilization, storyline, historical expectation, or hostile rhetoric does NOT itself create belligerency.\n• relationUpdates — MATERIAL BILATERAL POLITICAL CLIMATE changes only. The ledger is sparse: do NOT create neutral-zero rows for untouched countries and do NOT update a pair merely because diplomats met. One compact record per line:\n    polityA~polityB~absoluteScore~status~eventNumbersCSV~summary\n  absoluteScore is -100..100; status is friendly | cordial | neutral | cautious | strained | hostile | rival. eventNumbersCSV is 1-based and must point to the event that materially changed the relationship. Formal alliance status is NOT encoded here; that lives in agreementUpdates. An alliance can be politically strained, and friendly states can have no alliance.\n• agreementUpdates — FORMAL TREATY / ALLIANCE / GUARANTEE lifecycle. One compact record per line:\n    agreementId~op~type~partiesCSV~eventNumbersCSV~title~terms\n  ops: start | update | suspend | resume | end | expire\n  types: alliance | mutual_defense | guarantee | non_aggression | friendship_consultation | trade_economic | military_cooperation | military_access | neutrality | peace_settlement | other\n  A NEW signed/ratified/concluded formal commitment MUST use start and reference its establishing event. Negotiations/proposals alone create NO agreement. For guarantee, partiesCSV order is guarantor first, beneficiary second. For later operations reuse the stable agreementId; unchanged type/parties/title may be blank where runtime preserves them.\n• diplomaticOutreach — Polities reaching out to the player on their OWN initiative this period — treaty feelers, trade proposals, non-aggression pacts, mediation offers, warnings, summit invitations — not tied to any single event. Same shape as createdChats. Open one whenever a polity plausibly would, rather than defaulting to none.\n• catalyst — An interactive branching scene handed to the player when a moment genuinely demands their decision, or null when none is warranted. Shape: {\"title\":\"\",\"premise\":\"\",\"opening\":\"\",\"choices\":[\"...\", \"...\", up to 5 distinct]}.\n\nKeep the total across createdChats and diplomaticOutreach to at most 3 per jump, and only when the approach genuinely serves the sender's interests.`;

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
  const helperValues = resolveHelperValues(prompts.helpers, variables);
  const promptTemplate = taskKey === "gameMaster"
    ? NATIVE_GAME_MASTER_PROMPT
    : prompts.tasks[taskKey];
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

[Native Country Stats — LIVE 7A.2 / 8B.2.13]
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

COMPONENT METHOD — REQUIRED:
- Native code has already partitioned the authoritative territorial basis into NUMBERED components shown below. You MUST NOT choose, rename, split, merge, add, or omit geographies.
- Return territorialComponentsText with EXACTLY ONE row for EVERY numbered component, in this exact transport format: index~group~population~gdpPerCapita
- Example rows: 1~core~4100000~4200 OR 2~overseas/dependent~800000~900
- index MUST be the supplied integer component index. Native JavaScript binds that index back to the authoritative geography name; geography names therefore do NOT appear in your response.
- Allowed group values: core | integrated | overseas/dependent.
- For PARTIAL components, population/GDP estimates cover ONLY the explicitly listed subregions, never the entire parent geography.
- Estimate EACH numbered component's current population and GDP/capita independently. Do not give colonies, dependencies, peripheral territories, or poorer constituent regions metropolitan productivity by default.
- group is only an economic/display bucket: core | integrated | overseas/dependent. It is NOT a sovereignty, alliance, customs-union, recognition, or constitutional judgment.
- Previous component names are a continuity/economic reference only. If they conflict with the current numbered authoritative basis, the current numbered basis wins and native code will rebind continuity going forward.
- gdpPerCapita inside each component is expressed in 2026-EUR-equivalent purchasing-value/accounting terms ONLY so different components and eras can be aggregated. It does NOT import 2026 technology, institutions, productivity, or living standards.
- population totals and GDP aggregates are DERIVED. Native JavaScript will decode territorialComponentsText and recompute them after your response.
- economy.gdpGrowth, inflation, unemployment, publicDebt and budgetBalance are percentages expressed as plain numbers; budgetBalance is negative for deficit and positive for surplus.
- economy.currency is the polity's actual current domestic currency/medium, even though component GDP accounting uses 2026-EUR-equivalent values.
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

Never convert silence into an inferred doctrine. In event titles/descriptions, prefer factual wording such as "no new German guarantee has been issued", "no mobilization order has been authorized", or "Berlin has not provided additional commitments" rather than declaring the player polity "neutral", "opposed", "supportive", or "refusing" unless the player actually established that policy.

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
- A declaration of war, entry into an existing war, departure, ceasefire, resumption, or peace/end MUST emit a matching top-level warUpdates record linked to the event number that establishes it.
- An alliance does not silently activate. Mobilization does not silently activate. A historical war does not silently activate. A storyline whose title contains "war" does not silently activate.
- If a historically expected belligerent has not actually joined in THIS campaign, it has no battlefield front.
- ${playerName} may not be inserted into a war merely because history/alliance logic suggests it. The existing Player Agency decision-gate rules still control new player commitments.
- warUpdates is compact text, one record per line:
  warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note
  ops: start | join-a | join-b | leave | ceasefire | resume | end
- Return warUpdates:"" when belligerency does not change in this pass.

This state is persisted between hidden world passes and is the future Stats -> Current Conflicts source of truth.`;

    const worldInitiativeContext = normalizeString(variables?.worldInitiativeContext);
    systemPrompt = `${systemPrompt}

[Native World Director — Historical Candidates, Causal Timing, Branch Recompute]
The TARGET DATE is a simulation horizon, NOT a historical itinerary.

CORE DOCTRINE:
- Historical events are CANDIDATES, not appointments.
- Historical timing must be CAUSALLY RE-EARNED.
- Historical consequences are PRECEDENTS, not scripts.
- After a branch-changing event, downstream history is recomputed from THIS campaign.
- The current simulated campaign always outranks remembered real-world chronology.

CANON PRECEDENCE:
current live state + current diplomacy + simulated campaign history + resolved player actions
> scenario/start-date lore and structural background that has not been contradicted
> general real-world historical knowledge
> memorized future chronology (candidate source only; never authority)

A proposed development may have a valid causal basis from ANY of these:
1. an explicit current pressure, motive, capability, dispute, commitment, war, territorial state, recent development, or player action;
2. a LATENT STRUCTURAL condition that still exists even if it was not recently mentioned — alliances, rivalry, nationalism, ideology, domestic instability, leadership, military doctrine, economic strain, colonial competition, social movements, etc.;
3. a historically observed future development whose IMPORTANT causal prerequisites remain substantially intact in THIS campaign and whose occurrence has not been invalidated by simulated divergence;
4. a genuinely plausible unscheduled shock or autonomous foreign initiative.

HISTORICAL-CANDIDATE TEST:
For a historical development, silently ask:
- Are the relevant actors/institutions still present and in roughly the required positions?
- Do the political, diplomatic, military, social, geographic, and personal prerequisites still exist?
- Has this campaign already changed or removed an important prerequisite?
- If I did NOT know the real historical date, would I still judge this development plausible from the current world?

If yes, the historical development MAY occur and may even closely resemble history. Do not randomize merely to look "alternate." If important prerequisites have changed, modify, delay, replace, or omit it.

CAUSAL-TIMING TEST:
The historical month/day is NOT automatically wrong, but it must be independently justified.
- Keep an exact historical date only if THIS campaign still preserves the scheduling mechanism that would place the event there: an already-planned visit, fixed election, treaty deadline, published exercise, succession date, or another genuinely scheduled process.
- If the exact date exists only because you remember future history, do NOT copy it. Choose timing from current travel, investigation, cabinet deliberation, mobilization, logistics, diplomatic deadlines, weather, readiness, and other live causal constraints.
- Once an earlier prerequisite, decision, alliance response, or delay changes, RECOMPUTE the timing of every downstream step. Do not keep later historical dates just because the event identity remains plausible.
- Do not deliberately shift dates for cosmetic alternate-history flavor. The goal is causal timing, not random difference.

BRANCH CHECKPOINT — REQUIRED AFTER EVERY MAJOR SHOCK OR ESCALATION:
After an assassination, coup, declaration, ultimatum, mobilization, treaty, government collapse, major battle, or similarly branch-changing event, silently RESET the downstream historical chain and audit:
1. Which actors now have a decision to make?
2. What do they currently want and fear?
3. What treaties / guarantees / commitments ACTUALLY apply?
4. Which support or constraint that existed historically is missing, changed, or still unresolved here?
5. Does the next historical choice require a PLAYER decision gate?
6. What are the actor's plausible alternatives NOW?

Do not emit this audit. Use it to choose the next event.

SAME-OUTCOME JUSTIFICATION:
If an actor chooses substantially the SAME escalatory course as real history despite changed support, alliances, player silence, or other altered conditions, the event description must contain at least one CURRENT-CAMPAIGN reason that independently explains the choice. "Because that is what happened historically" is never a reason. If no independent current reason exists, choose another response, delay, mediation, partial measure, or no escalation.

PLAYER-SILENCE INTERACTION:
If a historical chain expected a new commitment from ${playerName} and the player gave none, do not rewrite that absence as "${playerName} chooses neutrality" or "${playerName} refuses support." The fact is only that no new authorization/guarantee/order exists. Foreign actors may still proceed, hedge, wait, seek alternatives, or back down — but they must recalculate around that uncertainty and the real scope of existing commitments.

A surviving assassination risk may therefore produce an assassination. That does NOT automatically authorize the historical guarantee, ultimatum, declaration, mobilization, alliance activation, or war that followed it. Every downstream choice and its timing must pass the current-state audit above.

CURRENT WORLD DIRECTOR CONTEXT:
${worldInitiativeContext || "No strong explicit pressure was detected. Latent structural conditions and historically plausible candidates may still exist if their prerequisites survive."}

The explicit ledger is evidence, NOT a checklist and NOT the complete world. Quiet periods remain valid. There is NO event quota and NO requirement to fill the calendar.

[Persistent World Storylines — Compact Output Contract]
Timeline events are visible milestones; storylines are hidden continuing processes. Do NOT manufacture timeline cards merely to prove continuity.

The tool field storylineUpdates is ONE STRING, not an array. Return either:
- "" when no storyline needs persistence; OR
- one record per line, maximum 16 records, using exactly:
id~status~pressure~momentum~startedDate~kind~title~participantsCSV~eventNumbersCSV~state

Rules:
- Never use "~" inside a field.
- status = active | dormant | resolved.
- pressure = unresolved seriousness/stakes, 0-100.
- momentum = current rate of meaningful change, 0-100. Frozen war can be pressure 90 / momentum 25.
- startedDate = YYYY-MM-DD when known for a new process; blank is allowed for an existing process.
- kind/title/participants may be blank for an EXISTING storyline because runtime preserves them. For a NEW storyline, provide them when practical.
- eventNumbersCSV uses 1-based event numbers from THIS response, e.g. "2,3"; blank when the process evolved quietly with no visible milestone.
- state must describe what is true THROUGH the actual stopDate, including quiet stabilization after the last visible event.
- Return one record for EVERY storyline listed under PERSISTENT STORYLINE ATTENTION.
- If this pass creates a new unresolved multi-step process, give it a stable descriptive id such as storyline-austro-serbian-war and create a record for it. Later internal passes will receive that storyline back as canonical state.
- This is a WHOLE-WORLD pass. Urgent storylines deserve attention, but they do not monopolize the world: unrelated diplomacy, domestic politics, economics, regional tensions, military change, and genuinely new initiatives may still develop when causally warranted.
- Never create filler merely to demonstrate breadth. Diversity is permission and attention fairness, not an event quota.
- Javascript attaches event storylineIds, stamps accountedThroughDate=stopDate, and computes nextReviewDate. Do not output those bookkeeping fields.

Example record:
storyline-austro-serbian-war~active~88~32~1914-07-28~war~Austro-Serbian War~Austria-Hungary,Kingdom of Serbia~3,4~The initial campaign has settled into a difficult winter front while both governments remain committed to the war.

Keep this compact and factual.`;

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
  }

  // Existing campaigns carry frozen prompt packs, so group-chat floor control
  // needs a live directive too. Silence is a valid outcome here: this task decides
  // whether ANOTHER participant should take the floor, not whether a bilateral
  // counterpart is allowed to ghost the player (1:1 replies are guaranteed by UI).
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Autonomous Diplomacy — live override]\nA.I.-controlled polities have their own diplomacy and may negotiate, threaten, align, mediate, trade, or make agreements without waiting for ${normalizeString(variables.playerPolity) || "the player"}. Private A.I.↔A.I. diplomacy belongs in the TIMELINE as events. Lasting bilateral political shifts use top-level relationUpdates; signed/ratified/concluded formal treaties, alliances, guarantees and pacts use top-level agreementUpdates; polityChanges remains for polity metadata/reputation, regionTransfers for legal territorial settlements, and unitOps for concrete military coordination. Do NOT create a hidden or fake NPC-only chat: the player is implicit in every diplomatic chat in this game. impacts.createdChats and top-level diplomaticOutreach are ONLY for situations where one or more A.I. polities actually contact the player. A group chat means those listed polities are jointly bringing the player into the discussion, not privately talking among themselves. Keep the combined total of createdChats + diplomaticOutreach to at most 3 per jump; fewer is usually better, and zero is correct when nobody has a reason to contact the player.`;

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
    const blockedSets = normalizeString(variables?.idleDiplomacyBlockedParticipantSets) || "None.";
    const eventReaction = normalizeString(variables?.eventDiplomaticReactionContext);
    systemPrompt = `${systemPrompt}\n\n[Living Diplomacy — live override]\nThis is optional autonomous outreach, not mandatory chatter. Return {"chat":null} unless an A.I.-controlled polity has a natural reason to contact the player now. A reason does NOT have to be a crisis or strategic negotiation: friendly congratulations, condolences, professional courtesy, curiosity, reassurance, or a warm acknowledgement of a minor public development are valid when they fit the sender's relationship and interests. Do not manufacture importance, knowledge, hostility, or diplomatic stakes that the supplied world does not support. The approach may be bilateral OR, when several polities genuinely share the same purpose, a small group approach: countries must list every non-player participant who is jointly contacting the player, and speaker must be one of those participants. Never include the player's polity in countries. Reuse the diplomatic context already visible in Existing Chats instead of repeating a proposal, warning, congratulations, or request that is already there. A group approach is still a conversation WITH the player; never use this task to represent private NPC↔NPC talks.\n\n[Already active on this in-game date — DO NOT choose these exact participant sets]\n${blockedSets}\nIf the only plausible outreach would come from one of those exact participant sets, return {"chat":null} instead of generating a message the runtime must throw away. A different genuinely justified joint group is still allowed; do not invent extra participants merely to evade this guard.${eventReaction ? `\n\n[Event-triggered reaction — one-shot]\nA human administrator explicitly allowed NPCs to react to the canonical event below. Evaluate THIS event in the current diplomatic world. Silence remains valid and must be chosen when nobody would plausibly contact the player. But do not confuse "minor" with "unworthy of human contact": a friendly ally may simply congratulate the player, express sympathy, show interest, or make a brief good-natured remark even when no treaty, warning, or mechanical consequence is needed. Keep any opener natural and proportionate. The schema permits at most one initiating chat for this one-shot evaluation.\n\n${eventReaction}` : ""}`;
  }

  if (taskKey === "nextSpeaker") {
    systemPrompt = `${systemPrompt}\n\n[Diplomatic Floor Control — live override]\nThis task decides whether another non-player participant should take the floor in a GROUP diplomatic chat. Returning nextSpeaker:null is valid and often correct when nobody has a distinct useful contribution, the player's message merely acknowledges/closes the exchange, or another reply would only repeat agreement. Never select a participant merely because they are present. If the player directly addresses or asks a participant for an answer, that participant should normally respond. Do not select the most recent speaker or anyone the caller marks as already having spoken in this response round. Bilateral chats do NOT use this silence decision: their counterpart still answers the player's message.`;
  }

  if (taskKey === "gameMaster") {
    systemPrompt = `${systemPrompt}\n\n[GM Territorial Semantics — live override]\nA wartime capture/occupation/liberation/retaking changes DE-FACTO control and must use impacts.regionControlOps, not regionTransfers. Use regionTransfers only for a LEGAL sovereignty change such as treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement. Do not conflate the two just because the old frozen GM prompt says \"moves territory\".\n\n[GM Geographic Completeness — LIVE 8B.2.10]\nTerritorial narration and structured operations must agree PLACE BY PLACE, not merely in aggregate. If an authored event says control is established, expanded, consolidated, seized, occupied, liberated or retaken in several named cities/areas, emit a matching regionControlOps operation for EVERY named place whose map region actually changes control. Never narrate \"Płock, Częstochowa and Warsaw\" while emitting only two control operations. For a city-grounded change, put the actual city name in regionId/regionName or the exact rendered region id/name when known; native validation will map the city point to the rendered region and will reject an incomplete preview rather than silently dropping the city. One operation must describe one intended place: never reuse a nearby city's rendered region for a different named city, and never let event-wide prose substitute for the operation's own geographic target.\n\n[Current Non-Normal Territorial State]\n${normalizeString(variables.territorialControlContext) || "No active occupations or contested regions recorded."}`;
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
    systemPrompt = `${systemPrompt}\n\n[Native Unit Director — runtime rules]\nYou are NOT writing new history. The supplied events are already canonical candidates. Your only job is to make existing persistent military units behave consistently with those events.\n\nCURRENT GAME DATE: ${normalizeString(variables.unitDirectorGameDate)}\nCURRENT ROUND: ${normalizeString(variables.unitDirectorRound)}\n\nCURRENT PERSISTENT UNITS:\n${directorUnits}\n\nMILITARY EVENT CANDIDATES:\n${directorCandidates}\n\nPriority order:\n1. REUSE existing unit ids. Existing armies should move, attack, weaken, retreat through later moves, and persist across turns.\n2. MOVE a current unit when the event says that formation/army advances, withdraws, redeploys, mobilizes toward a front, or otherwise changes position.\n3. ATTACK only when two supplied opposing units actually make contact AND the event does not already declare a decisive winner/territorial transfer. Use op=attack with attacker and defender ids. Do NOT guess casualties with strength; javascript resolves the clash deterministically.\n4. SPAWN only when the event genuinely creates a new formation/mobilization/reinforcement that is not already represented. Never spawn a new counter merely because an existing army is fighting again.\n5. strength is only for explicit NON-COMBAT reinforcement, attrition, disease, desertion, refit or demobilization. remove only for explicit destruction/disbandment.\n6. Do not invent military activity for diplomatic, political or economic events. It is valid to return no ops for an event.\n7. Never change territory. The territory/control layer is separate.\n8. Use only supplied existing unit ids. Keep movement local/plausible for the era; a move may precede an attack in the same event when needed to bring formations into contact.\n\nReturn exactly the required tool payload.`;
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
      const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
      let parsed = response?.toolInput ?? extractJsonPayload(rawText);
      let transportDecodeError = "";
      if (taskKey === "gameMaster" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const decoded = decodeGameMasterTransportPayload(parsed);
        transportDecodeError = normalizeString(decoded?.error);
        parsed = decoded?.payload;
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
          const canonical = kind === "found" ? "build" : kind === "destroy" ? "remove" : kind;
          if (canonical !== "build" || op.marker) return { ...op, op: canonical };
          // Flat build: lift the structure's own fields under `marker`.
          const { op: _op, note, ...marker } = op;
          return { op: "build", marker, ...(note == null ? {} : { note }) };
        });
      }

      // The Stats tool estimates territorial components; arithmetic belongs to
      // native code. Fill/recompute schema version, population and GDP aggregates
      // BEFORE normal schema validation so the model is never trusted to keep
      // population × GDP/capita arithmetic internally consistent.
      let statsCoverageError = "";
      if (taskKey === "countryStatSheet" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const decoded = decodeCountryStatComponents(
          parsed.territorialComponents ?? parsed.territorialComponentsText,
          variables?.statsTerritorialPlan,
        );
        statsCoverageError = normalizeString(decoded?.error);
        parsed = finalizeCountryStatSheet({
          ...parsed,
          territorialComponents: decoded?.components || [],
        });
        delete parsed.territorialComponentsText;
      }

      let validation = transportDecodeError
        ? { valid: false, error: transportDecodeError }
        : parsed
          ? validateGameplayPayload(taskKey, parsed)
          : { valid: false, error: "Response did not contain parseable JSON or tool arguments." };
      if (validation.valid && statsCoverageError) {
        validation = { valid: false, error: statsCoverageError };
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
      } else if (op === "remove" || op === "destroy") {
        if (!normalizeString(operation?.name) && !normalizeString(operation?.markerId)) {
          if (strict) return `${operationPath} must carry the name (or markerId) of the structure to remove.`;
          continue;
        }
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
    const midpoint = advanceGameDate(Math.max(1, Math.round(Math.max(days, 1) / 2)));
    events.push({
      date: midpoint,
      description: `Foreign ministries and general staffs keep adjusting to the current balance of power while ${bundle.game.country} gathers its next move.`,
      impacts: {
        createdChats: [],
        polityChanges: [],
        regionTransfers: [],
        regionControlOps: [],
      },
      importance: mode === "auto" ? "major" : "minor",
      kind: "world",
      notable: mode === "auto",
      playerRelated: false,
      title: "The international balance remains in motion",
    });
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
    storylineUpdates: "",
    warUpdates: "",
    relationUpdates: "",
    agreementUpdates: "",
    stopDate: targetDate,
    summary:
      plannedActions.length > 0
        ? `${bundle.game.country} moves from planning into execution, and the world begins adjusting to the turn's most concrete orders.`
        : `Time advances without a direct order from ${bundle.game.country}, but the wider system keeps shifting and building pressure.`,
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

const applySimulationResult = async ({
  baseActions,
  baseChats,
  baseColors,
  baseEvents,
  baseGame,
  baseWorld,
  result,
}) => {
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
const curatedEvents = await curateGeneratedEvents({
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

// The curator decides WHICH events survive. The unit director then makes the
// surviving military events actually use the persistent order of battle instead
// of spawning a counter and forgetting it exists for the rest of the century.
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
const territoryEvents = await directGeneratedTerritoryOps({
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

// Post-processors may add unit attacks/control operations after the main payload
// was validated. Re-check canonical belligerency before ANY state is persisted.
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
  const warMerge = applyWarUpdates({
    world: worldWithImpacts,
    updates: normalizeArray(result.warUpdates),
    events: territoryEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });

  const diplomaticMerge = applyDiplomaticUpdates({
    world: warMerge.world,
    relationUpdates: normalizeArray(result.relationUpdates),
    agreementUpdates: normalizeArray(result.agreementUpdates),
    events: territoryEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });

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
      if (nextChat) { nextChats.unshift(nextChat); generatedChats.unshift(nextChat); }
    }
  }

  // Unprompted outreach: polities reaching out on their own initiative during
  // the simulated period, not tied to any event (treaty feelers, summit
  // invitations). Same chat machinery, no linked event.
  for (const chatLike of normalizeArray(result.outreach)) {
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", nextWorld, {
      playerName: baseGame.country,
    });
    if (nextChat) { nextChats.unshift(nextChat); generatedChats.unshift(nextChat); }
  }

  // Keep the in-memory turn bundle sane too. If two generated items refer to the
  // same open participant set (including aliases / reversed group order), compacting
  // history should see one conversation rather than two fake diplomatic threads.
  nextChats = reconcileChatsForPlayer(nextChats, nextWorld, baseGame.country);

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
    chatsToWrite = reconcileChatsForPlayer(nextChats, nextWorld, baseGame.country);
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
  const variables = await buildTemplateVariables(bundle);
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
const buildTargetDossier = async (bundle, code) => {
  const world = normalizeWorldState(bundle.world);
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

const buildTargetEconomicEvidence = ({ bundle, statCode, previous }) => {
  const world = normalizeWorldState(bundle?.world);
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
    return `- ${event.date || "undated"} — ${event.title}${flags ? ` [${flags}]` : ""}${detail ? `: ${detail}` : ""}`;
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

// Build a native legal-territory accounting basis for Stats. Unlike the old AIO,
// this does not scrape rendered DOM/map prose. We have direct access to the region
// catalog plus separate controller/sovereign ledgers, so temporary occupation can
// stay militarily real without being counted as national population/GDP.
// 7A.1.5: custom/hybrid regions can legitimately omit `country`. Resolve their
// provenance from countryCode when available; otherwise keep the exact region name
// as its own deterministic economic bucket. Never collapse unrelated blank-country
// regions into one fake "Unclassified" component.
const buildTargetStatsTerritorialBasis = async (bundle, code) => {
  const world = normalizeWorldState(bundle.world);
  const target = canonicalStatsPolity(code, world);
  if (!target) {
    return {
      context: "No target polity was resolved.",
      plan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  // 8B.2.13: Stats must use the SAME scenario geography that the player actually
  // sees. loadRegionCatalog() is deliberately broad: stock GADM rows are merged
  // with scenario/custom rows and its cache may outlive individual runtime fetches.
  // That is useful for name resolution, but it is not authoritative enough for
  // territorial accounting on hybrid maps. The rendered regionsGeojson is the
  // current map partition and therefore wins whenever it exists. Stock/merged
  // catalog data is retained only as a compatibility fallback for maps that do not
  // expose a rendered region FeatureCollection.
  const [mergedCatalog, renderedRegionsGeojson] = await Promise.all([
    loadRegionCatalog({ force: true }).catch(() => []),
    readJson(JSON_URLS.regionsGeojson, { defaultValue: null, force: true }).catch(() => null),
  ]);

  const renderedCatalog = normalizeArray(renderedRegionsGeojson?.features)
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
      const mappedCountryCode = countryCode
        ? normalizeString(toCountryName(countryCode))
        : "";
      const resolvedCodeGeography =
        mappedCountryCode && mappedCountryCode.toLowerCase() !== countryCode.toLowerCase()
          ? mappedCountryCode
          : "";

      // IMPORTANT: economic/base geography is provenance, not current owner.
      // Custom scenario regions frequently have owner="Russian Empire" while the
      // actual economic bucket is their exact local region name (Łódź, Kielce, ...).
      // Conversely stock-like features with a real gid0 can safely group under the
      // resolved base geography (e.g. POL -> Poland). Never use props.owner as the
      // geography label merely because it is the current/seed sovereign.
      const baseGeography =
        normalizeString(props.country ?? props.COUNTRY ?? props.Country) ||
        resolvedCodeGeography ||
        name ||
        id;

      // Base owner is a separate concept from base geography. This is the fallback
      // legal owner when a save has no explicit override for this feature.
      const baseOwner = normalizeString(
        props.owner ?? props.COUNTRY ?? props.Country ?? props.country,
      ) || resolvedCodeGeography || mappedCountryCode || "";

      return {
        id,
        name,
        countryCode,
        baseGeography,
        baseOwner,
      };
    })
    .filter(Boolean);

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

      return {
        id,
        name,
        countryCode: rawCountryCode,
        baseGeography,
        baseOwner,
      };
    })
    .filter(Boolean);

  const catalog = renderedCatalog.length > 0 ? renderedCatalog : fallbackCatalog;
  if (!catalog.length) {
    return {
      context: "No region catalog is available; use existing campaign records conservatively.",
      plan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  const same = (a, b) =>
    normalizeString(canonicalStatsPolity(a, world)).toLowerCase() ===
    normalizeString(canonicalStatsPolity(b, world)).toLowerCase();

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

  for (const region of catalog) {
    const regionId = normalizeString(region?.id);
    const baseGeography = normalizeString(region?.baseGeography) || normalizeString(region?.name) || regionId;
    if (!regionId || !baseGeography) continue;

    totalByBase.set(baseGeography, (totalByBase.get(baseGeography) || 0) + 1);

    const baseOwner = canonicalStatsPolity(region?.baseOwner, world);
    const controller = canonicalStatsPolity(
      world.regionOwnershipOverrides?.[regionId] || baseOwner,
      world,
    );
    // Sovereignty must never be inferred from a temporary controller when the
    // rendered feature already supplies a base legal owner. Old saves with no
    // sovereignty ledger are migrated by normalizeWorldState; this fallback is
    // therefore only a final compatibility guard.
    const sovereign = canonicalStatsPolity(
      world.regionSovereigntyOverrides?.[regionId] || baseOwner || controller,
      world,
    );

    const row = {
      id: regionId,
      name: normalizeString(region?.name) || regionId,
      sovereign,
    };

    if (same(controller, target)) {
      pushRegion(controlledByBase, baseGeography, row);

      if (!same(sovereign, target)) {
        occupiedByTarget += 1;
        if (sovereign) displacedSovereigns.add(sovereign);

        // Strong native evidence that the controlled land is the polity's own
        // homeland/base geography rather than an arbitrary foreign occupation.
        if (same(baseGeography, target)) nativeHomelandControlled += 1;
      }
    }

    if (same(sovereign, target) && controller && !same(controller, target)) {
      targetOccupiedByOthers += 1;
    }

    if (!same(sovereign, target)) continue;
    pushRegion(legalByBase, baseGeography, row);
  }

  const targetOverrideEntry = Object.entries(world.polityOverrides || {})
    .find(([key, record]) => [
      key,
      record?.code,
      record?.name,
      ...normalizeArray(record?.aliases),
    ].some((value) => value && same(value, target)));

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
  for (const event of normalizeArray(bundle?.events)) {
    const changes = normalizeArray(event?.impacts?.polityChanges);
    const establishesTarget = changes.some((change) => {
      const operation = normalizeString(change?.operation).toLowerCase();
      return ["create", "restore"].includes(operation) &&
        (same(change?.code, target) || same(change?.name, target));
    });

    if (!establishesTarget) continue;
    lifecycleEstablished = true;

    const grantsControl = normalizeArray(event?.impacts?.regionControlOps)
      .some((operation) =>
        ["control", "control_flip"].includes(normalizeString(operation?.op).toLowerCase()) &&
        same(operation?.toCode, target));

    const grantsSovereignty = normalizeArray(event?.impacts?.regionTransfers)
      .some((transfer) => same(transfer?.toCode, target));

    if (grantsControl || grantsSovereignty) foundingTerritoryEstablished = true;
  }

  // Canonical war context is supporting evidence, especially for older saves whose
  // lifecycle-establishing event may have been consolidated away. It is NOT enough
  // by itself to convert a normal foreign occupation into national Stats scope.
  let opposedToDisplacedSovereign = false;
  for (const war of normalizeArray(world?.wars)) {
    if (!["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) continue;

    const sideA = normalizeArray(war?.sideA);
    const sideB = normalizeArray(war?.sideB);
    const targetInA = sideA.some((party) => same(party, target));
    const targetInB = sideB.some((party) => same(party, target));
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
      `[stats 8B.2.13] ${target}: DE-FACTO STATE ADMINISTRATION selected — ` +
        `${controlledRegionCount} controlled region(s), 0 legal-sovereign region(s), ` +
        `rendered-geography=${renderedCatalog.length ? "yes" : "fallback"}, ` +
        `own-base=${nativeHomelandControlled}, lifecycle=${lifecycleEstablished ? "yes" : "no"}, ` +
        `founding-territory=${foundingTerritoryEstablished ? "yes" : "no"}, ` +
        `war-with-displaced-sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  } else if (legalRegionCount === 0 && controlledRegionCount > 0) {
    console.info(
      `[stats 8B.2.13] ${target}: ${controlledRegionCount} controlled region(s) excluded from national Stats; ` +
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

  const plannedRows = rows.map((row, index) => ({
    index: index + 1,
    geography: row.baseGeography,
    regions: row.regions,
    total: row.total,
  }));

  console.info(
    `[stats 8B.2.13] ${target}: authoritative ${mode} component plan (${plannedRows.length})`,
    plannedRows.map((row) => ({
      index: row.index,
      geography: row.geography,
      coverage: `${row.regions.length}/${row.total}`,
      regions: row.regions.map((region) => `${region.name} [${region.id}]`),
    })),
  );

  if (plannedRows.length > 64) {
    console.info(
      `[stats 8B.2.13] ${target} has ${plannedRows.length} authoritative economic geography buckets in ${mode} mode; processing ALL of them (legacy 64-component truncation disabled).`,
    );
  }

  const lines = [
    `Target: ${target}`,
    `Accounting mode: ${useDeFactoStateBasis ? "DE-FACTO STATE ADMINISTRATION" : "LEGAL SOVEREIGNTY"}`,
    useDeFactoStateBasis
      ? `De-facto administered mapped regions: ${controlledRegionCount}. Legal-sovereign mapped regions: 0.`
      : `Legally sovereign mapped regions: ${legalRegionCount}.`,
    `Authoritative numbered economic components: ${plannedRows.length} (ALL selected buckets; none truncated)`,
  ];

  if (useDeFactoStateBasis) {
    lines.push(
      "SPECIAL STATEHOOD RULE: native code selected controller-based Stats because this active polity has no usable legal-sovereign map basis but does administer territory as a state actor. Count ONLY the controlled regions listed below. This rule must NOT be generalized by the model to ordinary foreign occupation.",
    );
    lines.push(
      `Native qualification evidence: own-base controlled regions=${nativeHomelandControlled}; lifecycle create/restore=${lifecycleEstablished ? "yes" : "no"}; founding event granted territory/control=${foundingTerritoryEstablished ? "yes" : "no"}; active/ceasefire conflict with displaced sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  }

  for (const row of plannedRows) {
    const full = row.regions.length >= row.total;
    const names = row.regions.slice(0, 30).map((region) => region.name);
    lines.push(
      `[${row.index}] ${row.geography}: ${row.regions.length}/${row.total} base regions (${full ? "FULL/NEAR-FULL" : "PARTIAL"})${
        full
          ? ""
          : ` — ONLY these ${useDeFactoStateBasis ? "controlled" : "legal"} subregions: ${names.join(", ")}${row.regions.length > names.length ? ", …" : ""}`
      }`,
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
          .map((region) => canonicalStatsPolity(region?.sovereign, world))
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
    console.info(
      `[stats 8B.2.13] ${target}: donor/reference component anchors`,
      referenceLines,
    );
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
    fingerprint: `territory-${stableStatsHash(fingerprintSource)}`,
    mode,
    referenceContext: referenceLines.join("\n"),
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
  const variables = await buildTemplateVariables(bundle);
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
export const generateCountryStatSheet = async ({ code, name, forceReassess = false } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle);
  const worldAtStart = normalizeWorldState(bundle.world);
  const statCode = canonicalStatsPolity(code, worldAtStart) || normalizeString(code);
  const target = name || statCode || code || "the polity";
  const dossier = await buildTargetDossier(bundle, statCode);
  const territorialBasis = await buildTargetStatsTerritorialBasis(bundle, statCode);
  const territorialContext = territorialBasis.context;
  const territorialPlan = territorialBasis.plan;
  const territorialFingerprint = normalizeString(territorialBasis.fingerprint);
  const territorialBasisMode = normalizeString(territorialBasis.mode) || "legal";
  const territorialReferenceContext = normalizeString(territorialBasis.referenceContext);
  const era = normalizeString(bundle.world?.simulationRules).slice(0, 700);
  const previous = normalizeCountryStatSheet(worldAtStart.countryStats?.[statCode]);
  const previousComplete = isCompleteCountryStatSheet(previous);
  const currentDate = normalizeString(bundle?.game?.gameDate || bundle?.game?.startDate);
  const currentRound = Math.max(0, Math.trunc(Number(bundle?.game?.round) || 0));

  const previousStateFingerprint = normalizeString(previous?.continuity?.stateFingerprint);
  const previousTerritorialFingerprint = normalizeString(previous?.continuity?.territorialFingerprint);
  const hasAuthoritativeTerritorialFingerprint = Boolean(territorialFingerprint);
  const territorialCoverageMatches = !previousComplete
    ? true
    : statsTerritorialPlanMatchesSheet(previous, territorialPlan);

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

  const rawEconomicEvidence = buildTargetEconomicEvidence({ bundle, statCode, previous });
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
      const world = normalizeWorldState(await readWorldState({ force: true }));
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
    !forceReassess &&
    previousComplete &&
    territorialCoverageMatches &&
    previousStateFingerprint === stateFingerprint &&
    economicEvidence.unaccountedCount === 0
  ) {
    console.info(`[stats 7A.2] same-state refresh for ${statCode}; canonical baseline reused with zero AI calls.`);
    return previous;
  }

  if (forceReassess) {
    console.warn(`[stats 8B.2.13] MANUAL HARD REASSESS for ${statCode}; rebuilding the stat baseline from the current authoritative territorial basis (${territorialBasisMode}).`);
  }

  // A hard audit intentionally removes the previous numeric anchor. This is NOT normal
  // gameplay continuity; it is a user-invoked repair/QA path for a baseline suspected to
  // be stale or wrong. The current native territorial plan remains authoritative.
  const previousContext = !forceReassess && previous
    ? JSON.stringify(previous, null, 2).slice(0, 9000)
    : "";
  const evidenceContext = forceReassess
    ? [
        "MANUAL HARD STAT AUDIT requested by the user. Establish a fresh current baseline from the CURRENT authoritative territorial basis and campaign canon. Respect the native accounting mode exactly.",
        "Do not preserve old component population/GDP estimates merely for continuity; they are being audited because they may be stale or incorrect.",
        "Do not invent territorial changes or historical catastrophes absent from the supplied campaign. Estimate every numbered component independently for the current date, then let native aggregation derive totals.",
        rawEconomicEvidence.text ? `Recent relevant campaign evidence to respect: ${rawEconomicEvidence.text}` : "No additional recent target-specific economic evidence was found.",
      ].join(" ")
    : legacyMappedTerritoryBootstrap
      ? [
          "Legacy territorial continuity bootstrap: the previous complete sheet predates an exact territorial fingerprint.",
          "Treat older economic/demographic events as ALREADY reflected in that baseline; do not apply them again.",
          "Reconcile the previous values with the CURRENT authoritative territorial basis. Preserve continuity for unchanged components, but add/remove/re-estimate components required by the current native accounting plan.",
        ].join(" ")
      : [
          economicEvidence.text,
          territorialBasisMode === "de_facto_state"
            ? "Native accounting mode is DE-FACTO STATE ADMINISTRATION. The current component plan represents territory actually administered by this active state actor despite unresolved legal sovereignty. Use donor component references where supplied; do not preserve a stale generic whole-polity component when it conflicts with the authoritative controlled-region plan."
            : "",
        ].filter(Boolean).join(" ");

  const { payload } = await runJsonTask("countryStatSheet", {
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
      statsTerritorialBasisMode: territorialBasisMode,
      statsTerritorialReferenceContext: territorialReferenceContext,
      statsPreviousContext: previousContext,
      statsEconomicEvidenceContext: evidenceContext,
    },
  });

  const finalized = finalizeCountryStatSheet(payload);
  const elapsedYears = statsElapsedYears(previous?.continuity?.assessedDate, currentDate);
  const territoryChanged = Boolean(
    hasAuthoritativeTerritorialFingerprint &&
    (
      !previousTerritorialFingerprint ||
      previousTerritorialFingerprint !== territorialFingerprint ||
      !territorialCoverageMatches
    )
  );
  // Hard audit is the one explicit bypass for the continuity guard. Normal refreshes
  // remain protected from rerolls/double-counting; Shift+click deliberately says the
  // persisted baseline itself is suspect and should be replaced by the fresh result.
  const guarded = forceReassess
    ? { sheet: finalized, restored: [] }
    : guardCountryStatContinuity(previous, finalized, {
        elapsedYears,
        evidenceText: evidenceContext,
        territoryChanged,
      });

  if (guarded.restored?.length) {
    console.warn(
      `[stats 7A.2] restored ${guarded.restored.length} unsupported continuity discontinuity/discontinuities for ${statCode}:`,
      guarded.restored,
    );
  }

  // A newly-created baseline conceptually accounts for the current recent ledger.
  // An established baseline accounts only the bounded fresh evidence shown in THIS
  // reassessment; if more than 12 fresh events existed, another refresh can process
  // the deferred remainder instead of silently marking unseen evidence as handled.
  const accountedNow = forceReassess
    ? rawEconomicEvidence.relevantIds
    : legacyMappedTerritoryBootstrap
      ? rawEconomicEvidence.relevantIds
      : previous?.continuity
        ? economicEvidence.selectedFreshIds
        : rawEconomicEvidence.relevantIds;

  if (statCode && guarded.sheet && typeof guarded.sheet === "object") {
    try {
      const world = normalizeWorldState(await readWorldState({ force: true }));
      const nextSheet = applyCountryStatPatchToWorld(
        world,
        statCode,
        guarded.sheet,
        {
          replaceComponents: true,
          continuity: {
            assessedDate: currentDate,
            assessedRound: currentRound,
            stateFingerprint,
            territorialFingerprint,
            accountedEventIds: accountedNow,
          },
        },
      );
      await writeWorldState(world);
      return nextSheet;
    } catch (error) {
      console.warn("[ai] failed to persist native country stats:", error);
    }
  }

  return guarded.sheet || finalized;
};

export const refinePlayerAction = async (rawInput, { persist = true } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle, { actionInput: rawInput });
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
  const variables = await buildTemplateVariables(bundle, { chat: normalizedChat });
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
  const variables = await buildTemplateVariables(bundle);
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

const attachDecodedStorylineIds = (events, decodedStorylineUpdates, passLabel = "pass") => {
  const resultEvents = normalizeArray(events).map((event, index) => ({
    ...(event && typeof event === "object" ? event : {}),
    // Unique internal ids prevent same-index events from different passes from
    // collapsing into one generated-event-N during the final canonical apply.
    id: `${passLabel}-${normalizeString(event?.id) || `event-${index + 1}`}`,
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
}) => {
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

  let nextChats = [...normalizeChats(bundle.chats)];
  for (const event of freshEvents) {
    for (const createdChat of normalizeArray(event?.impacts?.createdChats)) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, nextWorld, {
        fallbackTitle: event.title,
        playerName: bundle.game.country,
      });
      if (nextChat) nextChats.unshift(nextChat);
    }
  }
  for (const chatLike of normalizeArray(result.outreach)) {
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", nextWorld, {
      playerName: bundle.game.country,
    });
    if (nextChat) nextChats.unshift(nextChat);
  }
  nextChats = reconcileChatsForPlayer(nextChats, nextWorld, bundle.game.country);

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
  if (days <= 31) return 7;
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
    let initialBundle = await readGameStateBundle({ force: true });
    const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });

    const diplomaticMigration = migrateLegacyDiplomaticState({
      world: initialBundle.world,
      events: initialBundle.events,
      chats: initialBundle.chats,
      game: initialBundle.game,
    });
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
    const passGenerations = [];
    let latestCatalyst = null;
    let clearActions = false;

    console.info(
      `[OH World Simulation 6B.2] ${windows.length} internal world pass(es) for ${originDate} → ${targetDate}; total visible-event ceiling ${totalMaxEvents}`,
    );

    for (let passIndex = 0; passIndex < windows.length; passIndex += 1) {
      const window = windows[passIndex];
      const passOriginDate = normalizeString(workingBundle.game.gameDate) || window.fromDate;
      const passTargetDate = window.toDate;
      const passesLeft = windows.length - passIndex;

      const variables = await buildTemplateVariables(workingBundle, {
        consolidatedHistoryMaxChars: WORLD_SIMULATION_CONSOLIDATED_HISTORY_MAX_CHARS,
        consolidatedHistorySelection: "coverage",
        historicalAnchorActivationChars: WORLD_SIMULATION_HISTORICAL_ANCHOR_ACTIVATION_CHARS,
        historicalAnchorMaxChars: WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_CHARS,
        historicalAnchorMaxItems: WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_ITEMS,
        targetDate: passTargetDate,
      });
      const worldInitiative = buildWorldInitiativeContext(workingBundle, {
        targetDate: passTargetDate,
      });
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
      const taskKey = mode === "auto" ? "autoJumpForward" : "jumpForward";

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
              `There is no minimum event count or event-density quota. Return compact storylineUpdates for every due persistent process, warUpdates for every canonical belligerency transition, relationUpdates for material bilateral political changes, and agreementUpdates for formal treaty/commitment lifecycle changes; use empty strings when a ledger does not change.`
            : `This is internal whole-world pass ${passIndex + 1} of ${windows.length} inside one user-requested fixed jump. ` +
              `Simulate ONLY ${passOriginDate} through ${passTargetDate} (${durationLabel}) and return JSON only. ` +
              `Generate ONLY causally warranted new developments, at most ${passMaxEvents} visible events. ` +
              `There is no minimum event count, no density quota, and no requirement to spread cards evenly. ` +
              `Advance the scheduler-selected persistent storylines, but do NOT let one crisis monopolize the world: ` +
              `also evaluate independent diplomacy, domestic politics, economics, military change, regional pressures and genuinely new initiatives where current causes warrant them. ` +
              `Do not create filler for breadth. Return compact storylineUpdates for every due process and every new unresolved process, with semantic state through THIS pass stopDate. ` +
              `Return warUpdates for every declaration/join/leave/ceasefire/resume/end in this pass; hard combat is legal only inside an active canonical war. Return relationUpdates only for material bilateral political shifts and agreementUpdates for every formal signed/ratified/concluded commitment or later lifecycle change; empty strings are correct when unchanged.`,
        validatePayload: async (candidate, { finalAttempt } = {}) => {
          const strict = !finalAttempt;
          const eventCount = normalizeArray(candidate?.events).length;

          if (strict && eventCount > passMaxEvents) {
            return `$.events must contain at most ${passMaxEvents} events in this internal world pass; received ${eventCount}. Quiet periods are valid.`;
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

          const warError = validateWarLedgerPayload(candidate, {
            world: workingBundle.world,
          });
          if (warError) return warError;

          const diplomaticError = validateDiplomaticLedgerPayload(candidate, {
            world: workingBundle.world,
          });
          if (diplomaticError) return diplomaticError;

          const storylineError = validateWorldStorylinePayload(candidate, {
            existingStorylines: workingBundle.world?.storylines,
            selectedStorylines: worldInitiative.analysis?.attentionStorylines,
            originDate: passOriginDate,
            stopDate: normalizeString(candidate?.stopDate) || passTargetDate,
          });
          if (storylineError) return storylineError;

          return await validateGeneratedWorldChanges(
            candidate,
            workingBundle.world,
            { strictTransfers: strict },
          );
        },
        variables,
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

      const passResult = {
        catalyst: payload?.catalyst ?? null,
        clearActions: payload?.clearActions !== false,
        events: passEvents,
        mode,
        outreach: normalizeArray(payload?.diplomaticOutreach),
        storylineUpdates: decodedStorylineUpdates,
        warUpdates: decodedWarUpdates,
        relationUpdates: decodedRelationUpdates,
        agreementUpdates: decodedAgreementUpdates,
        stopDate: normalizeString(payload?.stopDate) || passTargetDate,
        summary: normalizeString(payload?.summary),
        generation,
      };

      const advanced = await advanceWorkingBundleForWorldPass({
        bundle: workingBundle,
        colors: workingColors,
        result: passResult,
        passNumber: passIndex + 1,
      });
      workingBundle = advanced.bundle;
      workingColors = advanced.colors;

      accumulatedEvents.push(...advanced.freshEvents);
      accumulatedOutreach.push(...normalizeArray(passResult.outreach));
      accumulatedStorylineUpdates.push(...decodedStorylineUpdates);
      accumulatedWarUpdates.push(...decodedWarUpdates);
      accumulatedRelationUpdates.push(...decodedRelationUpdates);
      accumulatedAgreementUpdates.push(...decodedAgreementUpdates);
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
        `${decodedStorylineUpdates.length} storyline update(s), ${decodedWarUpdates.length} war update(s), ` +
        `${decodedRelationUpdates.length} relation update(s), ${decodedAgreementUpdates.length} agreement update(s); ` +
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

    const finalResult = {
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
    return applySimulationResult({
      baseActions: initialBundle.actions,
      baseChats: initialBundle.chats,
      baseColors,
      baseEvents: initialBundle.events,
      baseGame: initialBundle.game,
      baseWorld: initialBundle.world,
      result: finalResult,
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
const buildGameMasterActivePolitySet = async (world) => {
  const normalizedWorld = normalizeWorldState(world);
  const active = new Set();
  const ownerTokens = new Set();

  const collect = (token) => {
    const raw = normalizeString(token);
    if (raw) ownerTokens.add(raw);
  };

  for (const [key, entry] of Object.entries(normalizedWorld.polityOverrides || {})) {
    if (normalizeString(entry?.status).toLowerCase() === "active") collect(key);
  }

  // Runtime overrides are always authoritative regardless of map type. Legal
  // sovereigns remain current actors even if all of their land is occupied.
  for (const owner of Object.values(normalizedWorld.regionOwnershipOverrides || {})) collect(owner);
  for (const owner of Object.values(normalizedWorld.regionSovereigntyOverrides || {})) collect(owner);

  const scenarioRegions = await readJson(JSON_URLS.regionsGeojson, {
    defaultValue: null,
  }).catch(() => null);
  const scenarioFeatures = normalizeArray(scenarioRegions?.features);

  if (scenarioFeatures.length > 0) {
    // Region Inspector uses the same provenance order: explicit scenario owner first,
    // then COUNTRY, then the geography code only as a last compatibility fallback.
    // Do NOT also scan stock catalog countries in this branch; on a hybrid map those
    // stock shapes are geographic vocabulary, not proof of present political existence.
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
    // Pure stock map: catalog countries really are the base current controllers.
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

  // Resolve each distinct polity only once. A continental map may have thousands of
  // regions but normally only a few dozen distinct current owners.
  for (const raw of ownerTokens) {
    const resolved =
      resolveGameMasterLifecycleIdentity(raw, normalizedWorld) ||
      toCountryName(raw) ||
      raw;
    const key = gameMasterPolityKey(resolved);
    if (key) active.add(key);
  }

  return active;
};

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
      ...(await buildTemplateVariables(bundle, { gameMasterRequest: request })),
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
    const events = normalizeArray(payload?.events)
      .map((entry, index) => normalizeGeneratedEvent({
        ...entry,
        id: `event-manual-${transactionId}-${index + 1}`,
        source: "game-master",
      }, index))
      .filter(Boolean);
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

    let chatsToWrite = reconcileChatsForPlayer(bundle.chats, nextWorld, bundle.game.country);
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

// A fresh game whose scenario wrote a "World Before Round One" briefing gets
// its backstory generated once, the first time the player opens it: the
// briefing (plus rules and map) becomes real timeline events dated before the
// start. Deliberately NOT applySimulationResult — the clock must stay at the
// start date, round must stay 1, and backstory events carry no impacts (the
// scenario's world already reflects them). The simulationHistory entry it
// writes doubles as the done-marker, so it can never run twice.
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
    const variables = await buildTemplateVariables(bundle);
    const { payload } = await runJsonTask("pregameHistory", {
      timeoutMs: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 300000 : 0,
      userMessage: "Write the pre-game historical timeline as JSON only.",
      validatePayload: (candidate, { finalAttempt } = {}) =>
        validatePregameEvents(candidate, { startDate, strict: !finalAttempt }),
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

    const summary = normalizeString(payload?.summary);
    currentWorld.simulationHistory = [
      {
        catalyst: null,
        date: startDate,
        eventIds: generatedEvents.map((event) => event.id),
        fallbackReason: "",
        fromDate: normalizeString(generatedEvents[0]?.date) || startDate,
        mode: "pregame",
        plannedActions: [],
        round: 1,
        summary,
        source: "ai",
        toDate: startDate,
      },
    ];
    await Promise.all([
      writeEventsState(generatedEvents),
      writeWorldState(currentWorld),
    ]);
    return generatedEvents;
  } catch {
    // Silent: backstory is a bonus. The next open retries.
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
      ...(await buildTemplateVariables(bundle)),
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
      ...(await buildTemplateVariables(bundle)),
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
