/*! Open Historia — portions (briefing dossiers + timeout/fallback hardening) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { curateGeneratedEvents } from "./nativeTimelineCurator.js";
import { directGeneratedUnitOps } from "./nativeUnitDirector.js";
import { callAI } from "./main.jsx";
import { normalizePromptPack } from "./gameplayPrompts.js";
import { getGameplayTool, validateGameplayPayload } from "./gameplaySchemas.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
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
  applyEventImpactsToWorld,
  normalizeActionEntry,
  normalizeActions,
  normalizeChatEntry,
  normalizeChats,
  normalizeEvents,
  normalizeGameData,
  normalizeWorldState,
  readActionsState,
  readChatsState,
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

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

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

const buildTemplateVariables = async (bundle, options = {}) => {
  const variables = await buildPromptContext(bundle, options);
  return {
    ...variables,
    playerPolityReputationContext: await buildPlayerPolityReputationText(bundle),
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
const ACTIONS_REFERENCE = "[Actions You Can Take]\nThis is the full menu of levers you have to change the world. Everything you change rides on an event's \"impacts\" object, except the two whole-jump levers noted at the end. Reach for the RIGHT lever, and NEVER narrate a change in an event's text without also emitting the impact that makes it real — narration and world state must always agree.\n\n• regionTransfers — Move a region to a new owner. This is the most important lever and the one most often forgotten: use it for every conquest, cession, sale, liberation, annexation, or hand-over, one entry per affected map region. Shape: {\"regionId\":\"<exact id/name when known; otherwise the exact city/historical-area wording from the event>\",\"regionName\":\"\",\"fromCode\":\"<current losing polity>\",\"toCode\":\"<new owner polity>\"}. ALWAYS set fromCode for a partial transfer when you know the losing polity: the native geography resolver uses that polity\'s actual current regions to turn historical names, translated names, and city references into real region ids without guessing across the whole world. Prefer exact map region names when available; do not invent a modern province name just to satisfy the field. An event whose text says land changed hands but carries no regionTransfers is invalid output and breaks the map.\n\n• polityChanges — Explicit polity lifecycle or metadata changes. EVERY entry must include operation:\"update|create|rename|restore|dissolve\" and code:\"<FULL polity name, never an abbreviation>\". update changes metadata/stats/tags/reputation on an EXISTING polity only; create explicitly establishes a genuinely NEW current polity/breakaway state; rename reconstitutes an existing polity under a new current/display name while preserving its stable campaign identity; restore explicitly brings a dormant/dissolved polity back; dissolve explicitly ends a polity after its territory is separately settled. Example: {\"operation\":\"update\",\"code\":\"German Empire\",\"reputation\":60,\"tags\":[\"...\"],\"stats\":{},\"note\":\"<why>\"}. A same-event create/restore happens before that event\'s regionTransfers, so a newborn polity may immediately receive only the territory the event actually establishes. Never mint a new polity merely because you used a stale/sloppy alternate name. On an ideological/alignment shift rewrite the COMPLETE tags list. National statistics change only through stats; when leadership changes, update stats.leader.\n\n• unitOps — Move the war on the map with PERSISTENT battalions. Five ops:\n    {\"op\":\"spawn\",\"unit\":{\"name\":\"\",\"type\":\"infantry|armor|air|naval|artillery|garrison\",\"ownerCode\":\"\",\"strength\":1-1000,\"lng\":0,\"lat\":0,\"regionId\":\"\"}}\n    {\"op\":\"move\",\"unitId\":\"<existing id>\",\"toLng\":0,\"toLat\":0,\"regionId\":\"\",\"note\":\"\"}\n    {\"op\":\"attack\",\"unitId\":\"<existing attacker id>\",\"targetUnitId\":\"<existing enemy id>\",\"note\":\"\"}\n    {\"op\":\"strength\",\"unitId\":\"<existing id>\",\"strength\":0-1000,\"note\":\"\"}\n    {\"op\":\"remove\",\"unitId\":\"<existing id>\",\"note\":\"\"}\n  REUSE existing units by id. An offensive, retreat, redeployment or continuing war normally MOVES the units that already exist; do not spawn a fresh army every time the prose says forces act. Spawn only for a genuinely new formation/mobilization/reinforcement that is not already represented. Use attack when two existing opposing units actually fight: the runtime resolves casualties deterministically, so NEVER invent post-battle strength values for those participants in the same event. strength is for explicit non-combat reinforcement/attrition/reorganization; remove only for destruction/disbandment/demobilization. When a front is decisively won, pair the operational advance with the appropriate regionTransfers entry so the map and troops do not contradict each other.\n\n• markerOps — Place, remove, or rename a named structure or city. Three ops:\n    {\"op\":\"build\",\"marker\":{\"name\":\"\",\"kind\":\"<lowercase, e.g. military base / port / embassy / airfield / city>\",\"ownerCode\":\"\",\"lng\":0,\"lat\":0,\"note\":\"\",\"foundedAt\":\"\"}}\n    {\"op\":\"remove\",\"name\":\"<exact existing name>\",\"note\":\"\"}\n    {\"op\":\"rename\",\"name\":\"<current name>\",\"newName\":\"<new name>\",\"note\":\"<why>\"}\n  Emit build whenever an event founds or constructs a place, remove when one is destroyed, and rename when a city or structure is renamed (rename works on existing map cities too — a city renamed after a leader or ideology, a capital re-designated, a conquered city given the conqueror's name). Structures NEVER move borders: a facility one polity builds inside another's land does not transfer the region, and ownerCode is who runs the facility, not who owns the ground.\n\n• createdChats — Have another polity open a diplomatic chat with the player BECAUSE of this event (a war scare prompting mediation, a border incident prompting an ultimatum, a windfall prompting a trade delegation). Shape: {\"countries\":[\"...\"],\"title\":\"<names the purpose>\",\"speaker\":\"<the initiating polity — never the player>\",\"openingMessage\":\"<that leader's first message, in their voice>\"}. The other side always speaks first; a blank or untitled chat is invalid.\n\n• actionIds — List the ids of the player's queued actions that this event resolves, so the game can clear them from the queue.\n\nWhole-jump levers (top level of your output, NOT inside an event):\n• diplomaticOutreach — Polities reaching out to the player on their OWN initiative this period — treaty feelers, trade proposals, non-aggression pacts, mediation offers, warnings, summit invitations — not tied to any single event. Same shape as createdChats. Open one whenever a polity plausibly would, rather than defaulting to none.\n• catalyst — An interactive branching scene handed to the player when a moment genuinely demands their decision, or null when none is warranted. Shape: {\"title\":\"\",\"premise\":\"\",\"opening\":\"\",\"choices\":[\"...\", \"...\", up to 5 distinct]}.\n\nKeep the total across createdChats and diplomaticOutreach to at most 3 per jump, and only when the approach genuinely serves the sender's interests.";

const runJsonTask = async (taskKey, {
  fallback,
  signal,
  timeoutMs = getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 120000 : 0,
  userMessage,
  validatePayload,
  variables,
}) => {
  const prompts = await loadPromptCatalog();
  const helperValues = resolveHelperValues(prompts.helpers, variables);
  let systemPrompt = renderTemplate(prompts.tasks[taskKey], {
    ...variables,
    ...helperValues,
  });

  // The chosen difficulty steers every simulation task (see runtime/difficulty.js).
  try {
    const game = await readGameData();
    systemPrompt = `${systemPrompt}\n\n${difficultyDirective(game.difficulty)}`;
  } catch {
    // Without game data the task still runs at its default temperament.
  }

  // Player agency: jumps must never sign the player up for landmark decisions.
  // Appended here (not only in defaultPrompts.json) because every game carries
  // its own frozen copy of the task prompts — a directive added at call time is
  // the only way the rule reaches campaigns that already exist. Field report:
  // "the AI just makes events saying that you form a treaty with another
  // country ... it just doesn't give you a choice and makes it an event."
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[Player Agency]\n${playerName} is controlled by a human player. Never commit ${playerName} to a major decision the player did not actually make: do not sign treaties, alliances, ceasefires, surrenders, trade pacts, unions, or other binding agreements on the player's behalf, do not accept or reject offers for them, and do not have ${playerName} take landmark unilateral action (declaring war, ceding territory, changing government) unless it directly executes one of the player's planned actions, chat replies, or explicit requests. When another polity seeks such an agreement or decision from the player, present it as something the player can answer: a diplomaticOutreach entry or an impacts.createdChats chat where the counterpart speaks first and makes the proposal, or an event describing the offer as OPEN and awaiting the player's response. Events remain free to narrate what other polities do among themselves and to resolve the player's own queued actions exactly as ordered.`;
    // Map truth: the recurring field report is the OPPOSITE failure — invasions
    // narrated turn after turn with zero regionTransfers, so the map never moves.
    // Appended at call time for the same reason as [Player Agency]: existing
    // campaigns carry frozen prompts, so a defaultPrompts.json rule never
    // reaches them. This also disarms an over-cautious reading of the agency
    // rule above ("don't act for the player") as "don't move the map".
    systemPrompt = `${systemPrompt}\n\n[Map Truth]\nTerritorial narration and the map must never disagree. If an event's title or description says territory was captured, seized, occupied, annexed, ceded, liberated, retaken, or otherwise changed hands, that SAME event MUST carry impacts.regionTransfers entries covering every region it names or implies — a capture claim with no regionTransfers is invalid output that breaks the map. When you do not know a region's exact id, put its plain name in regionId and the engine will resolve it; emit one entry per affected region. Resolving ${playerName}'s own ordered military operations into their territorial outcomes is REQUIRED and is never a player-agency violation: the agency rule restricts unprompted decisions, not the map consequences of offensives the player actually ordered. In an active war, sustained successful offensives normally transfer regions every jump. If nothing genuinely changed hands this period, keep capture language out of the event text.`;
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
    systemPrompt = `${systemPrompt}\n\n[Region and City Capture]\nTerritory is stored by MAP REGIONS. Prefer an exact region id/name from [Game Map Description]. If the event is grounded in a city, fortress, port, translated name, exonym, or historical area and you genuinely do not know the map region name, DO NOT invent one: put that exact grounded place/area wording in regionId (and regionName if useful) and ALWAYS set fromCode to the current losing polity. The native geography resolver can conservatively map that wording only against the losing polity's real current regions; if it cannot do so safely, the transfer is rejected instead of moving the wrong border.\nA region transfer still transfers the WHOLE resolved map region. If only a city changes hands while the surrounding region does not (a holdout, occupied port, enclave), do not use regionTransfers for that city; use the point/marker representation instead.\nWhen a polity is conquered, annexed, partitioned, or unified OUTRIGHT — every region it still holds changing hands at once — emit one regionTransfer with "wholeCountry": true, put the losing polity's name in regionId, and set toCode to the recipient. Use wholeCountry ONLY for a total takeover of everything it currently holds.`;
  }

  // Polities are identified by their full country name EVERYWHERE. A model that
  // answers "ESP" gets canonicalised on ingest, but it also then reasons about "ESP"
  // and "Spain" as if they were two powers, so state the rule rather than only
  // repairing the output.
  if (["actions", "jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Polity Names]\nEvery polity is identified ONLY by its full country name, exactly as written in the map description — "Spain", "United States", "Soviet Union". NEVER use a country code or abbreviation such as "ESP", "USA" or "SOV", anywhere, in any field. This applies to every owner field despite their names: toCode, fromCode, ownerCode and a polity's code all take the FULL NAME. A code is not a shorter way of writing a country here; it is a different, non-existent polity, and using one creates a phantom country on the map beside the real one.`;
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

Default verdict remains KEEP when uncertain.`;
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
      const response = await callAI(systemPrompt, history, {
        // No output-token cap. A long/action-heavy turn's JSON must not be truncated
        // mid-response — a cut-off response won't parse, so runJsonTask fell back to
        // canned events that carry NO regionTransfers and NO diplomacy, which is why
        // the map never changed and no chats opened. main.jsx now lets each provider
        // use its own model maximum when no maxTokens is passed.
        deadline,
        signal: controller.signal,
        tool,
      });
      const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
      const parsed = response?.toolInput ?? extractJsonPayload(rawText);
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
      let validation = parsed
        ? validateGameplayPayload(taskKey, parsed)
        : { valid: false, error: "Response did not contain parseable JSON or tool arguments." };
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
  const countryCatalog = [
    ...mergePolityCatalog(await loadCountryNames(), world),
    ...normalizeArray(additionalCountries).map((entry) => ({
      code: normalizeString(entry?.code),
      name: normalizeString(entry?.name || entry?.code),
    })),
  ];
  const lookup = new Map();

  for (const country of countryCatalog) {
    lookup.set((country.name || "").toUpperCase(), country);
    if (country.code) {
      lookup.set(country.code.toUpperCase(), country);
    }
  }

  const resolved = normalizeArray(names)
    .map((reference) => {
      const candidates = typeof reference === "string"
        ? [reference]
        : [reference?.name, reference?.code];
      return candidates
        .map((candidate) => lookup.get(normalizeString(candidate).toUpperCase()) || null)
        .find(Boolean) || null;
    })
    .filter(Boolean);
  const unique = new Map(resolved.map((entry) => [entry.code || entry.name, entry]));
  return Array.from(unique.values()).map((entry) => ({
      code: entry.code || "",
      name: entry.name || entry.code || "",
    }));
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

const pickMentionedSpeaker = (messageText, participants, excludedSpeaker) => {
  const normalizedText = normalizeString(messageText).toLowerCase();
  if (!normalizedText) return null;

  return (
    participants.find((country) => {
      if (country.name === excludedSpeaker) return false;
      return normalizedText.includes(country.name.toLowerCase());
    }) ?? null
  );
};

const fallbackNextSpeaker = ({ chat, excludedSpeaker }) => {
  const normalizedChat = normalizeChats([chat])[0];
  if (!normalizedChat) {
    return { nextSpeaker: "" };
  }

  const lastMessage = normalizedChat.messages.at(-1);
  const mentionedSpeaker = pickMentionedSpeaker(lastMessage?.text, normalizedChat.countries, excludedSpeaker);
  if (mentionedSpeaker) {
    return { nextSpeaker: mentionedSpeaker.name };
  }

  const fallbackCountry =
    normalizedChat.countries.find((country) => country.name !== excludedSpeaker) ??
    normalizedChat.countries[0] ??
    { name: "" };

  return {
    nextSpeaker: fallbackCountry.name,
  };
};

export const buildGeneratedChat = async (chatLike, linkEventId, world, { fallbackTitle = "", playerName = "" } = {}) => {
  const countriesInput = Array.isArray(chatLike?.countries) ? chatLike.countries : [];
  const countries = await resolveInvitees(countriesInput, world);
  if (countries.length === 0) return null;

  // The initiating polity speaks first — and it is never the player. When the
  // model names no speaker (or names the player), attribute the opener to the
  // first non-player participant.
  const playerKey = normalizeString(playerName).toUpperCase();
  const matchesPlayer = (country) =>
    playerKey && (normalizeString(country.name).toUpperCase() === playerKey || normalizeString(country.code).toUpperCase() === playerKey);
  const speakerKey = normalizeString(chatLike?.speaker).toUpperCase();
  const initiator =
    countries.find((country) =>
      speakerKey && !matchesPlayer(country)
      && (normalizeString(country.name).toUpperCase() === speakerKey || normalizeString(country.code).toUpperCase() === speakerKey))
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

const resolveRegionTransfers = async (containers, world) => {
  const catalog = await loadRegionCatalog().catch(() => []);
  // Without a catalog we cannot tell a good id from a bad one, and dropping real
  // transfers would be worse than phantom keys — leave the payload alone.
  if (catalog.length === 0) return [];

  const byId = new Map();
  const byName = new Map();
  for (const region of catalog) {
    byId.set(region.id, region);
    const key = regionKey(region.name);
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(region);
    else byName.set(key, [region]);
  }

  const worldState = normalizeWorldState(world);
  const owners = worldState.regionOwnershipOverrides;

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
    const override = toCountryName(normalizeString(owners[regionId]));
    if (override) return canonicalOwnerKey(override);

    // First border change in a conflict may have no runtime override yet. The
    // scenario catalog's base owner is still authoritative for candidate narrowing.
    const region = byId.get(regionId);
    return canonicalOwnerKey(region?.country || toCountryName(region?.countryCode) || "");
  };

  const regionsOwnedBy = (ownerToken) => {
    const key = canonicalOwnerKey(ownerToken);
    if (!key) return [];
    return catalog.filter((region) => ownerKeyOf(region.id) === key);
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

  const deterministicResolve = (transfer) => {
    if (byId.has(normalizeString(transfer?.regionId))) {
      return normalizeString(transfer.regionId);
    }

    const fromKey = canonicalOwnerKey(transfer?.fromCode);

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

      const regionId = deterministicResolve(transfer);
      if (regionId) {
        const row = byId.get(regionId);
        const normalized = {
          ...transfer,
          regionId,
          regionName: normalizeString(transfer?.regionName) || row?.name || "",
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
          "Resolve every supplied unresolved geography item using only its supplied candidateRegions. Return exactly one resolution per item index.",
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
const CAPTURE_LANGUAGE = /\b(captur\w*|seiz\w*|annex\w*|conquer\w*|occup(?:y|ies|ied|ation)|overr[au]n|liberat\w*|retak\w*|retaken|recaptur\w*|cedes?|ceded|ceding|cession|fell to|falls? to)\b/i;

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
  const unresolvedTransfers = await resolveRegionTransfers(containers, world);
  if (strict && unresolvedTransfers.length > 0) {
    return buildTransferFeedback(unresolvedTransfers);
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
    if (totalTransfers === 0) {
      const captureEvent = candidate.events.find((event) =>
        CAPTURE_LANGUAGE.test(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`));
      if (captureEvent) {
        return `Your events describe territory changing hands (e.g. "${normalizeString(captureEvent.title) || "an event"}") but the payload contains ZERO impacts.regionTransfers. Territorial narration and the map must never disagree: add impacts.regionTransfers entries ({"regionId": exact id or the region's plain name, "toCode": the new owner}) to EVERY event whose text says a region was captured, seized, occupied, annexed, ceded, liberated, or retaken, covering each region it names or implies. If nothing genuinely changed hands in this period, remove the capture language from those events instead, and resend.`;
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

const nextEvents = [...priorEvents, ...directedEvents];
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
  const nextChats = [...normalizeChats(baseChats)];
  // Chats this turn CREATED, kept apart from the pre-turn snapshot. A turn takes a
  // while to generate and the player can edit the chat list while it runs, so the
  // write at the end merges these onto whatever is actually stored by then rather
  // than putting the stale snapshot back. See the re-read before writeChatsState.
  const generatedChats = [];

  const { colors: nextColors, world: worldWithImpacts } = applyEventImpactsToWorld({
    colors: baseColors,
    events: directedEvents,
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
          eventIds: directedEvents.map((event) => event.id),
          fallbackReason: normalizeString(result.generation?.fallbackReason),
          fromDate: baseGame.gameDate,
          mode: normalizeString(result.mode) || "jump",
          plannedActions: plannedActionSnapshot,
          round: nextGame.round,
          summary: normalizeString(result.summary),
          source: result.generation?.source || "ai",
          toDate: nextGame.gameDate,
        },
        ...normalizeWorldState(baseWorld).simulationHistory,
      ].slice(0, 12),
    },
  });
  let nextWorld = worldWithImpacts;

  for (const event of directedEvents) {
    for (const createdChat of event.impacts.createdChats) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, worldWithImpacts, {
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
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", worldWithImpacts, {
      playerName: baseGame.country,
    });
    if (nextChat) { nextChats.unshift(nextChat); generatedChats.unshift(nextChat); }
  }

  if (result.mode === "jump" || result.mode === "auto") {
    try {
      nextWorld = await compactHistoryIfNeeded({
        actions: nextActions,
        chats: nextChats,
        events: nextEvents,
        game: nextGame,
        world: worldWithImpacts,
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
    chatsToWrite = [...generatedChats, ...normalizeChats(await readChatsState({ force: true }))];
  } catch {
    chatsToWrite = nextChats;
  }

  await Promise.all([
    writeActionsState(nextActions),
    writeChatsState(chatsToWrite),
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
export const generateCountryStatSheet = async ({ code, name } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle);
  const target = name || code || "the polity";
  const dossier = await buildTargetDossier(bundle, normalizeString(code));
  const era = normalizeString(bundle.world?.simulationRules).slice(0, 700);
  const { payload } = await runJsonTask("countryStatSheet", {
    userMessage: [
      `Compile the national stat sheet for ${target}${code ? ` (code ${code})` : ""}.`,
      era ? `ERA & WORLD RULES:\n${era}` : "",
      `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}`,
    ].filter(Boolean).join("\n\n"),
    variables,
  });
  // Persist into world state so the sheet SURVIVES date changes and the AI can mutate
  // it via polityChanges.stats (see applyEventImpactsToWorld) — "stats persist and only
  // change when the AI changes them". Re-read the world first to avoid clobbering a
  // concurrent jump's write.
  const statCode = normalizeString(code);
  if (statCode && payload && typeof payload === "object") {
    try {
      const world = normalizeWorldState(await readWorldState({ force: true }));
      await writeWorldState({ ...world, countryStats: { ...world.countryStats, [statCode]: payload } });
    } catch (error) {
      console.warn("[ai] failed to persist country stats:", error);
    }
  }
  return payload;
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
} = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const normalizedChat = normalizeChats([chat])[0];
  if (!normalizedChat) {
    return "";
  }

  const variables = await buildTemplateVariables(bundle, { chat: normalizedChat });
  const { payload } = await runJsonTask("nextSpeaker", {
    fallback: () => fallbackNextSpeaker({ chat: normalizedChat, excludedSpeaker: excludeSpeaker }),
    userMessage: "Choose the next speaker as JSON only.",
    variables: {
      ...variables,
      lastSpeaker: excludeSpeaker || variables.lastSpeaker,
    },
  });

  const nextSpeaker = normalizeString(payload?.nextSpeaker);
  if (!nextSpeaker) {
    return fallbackNextSpeaker({ chat: normalizedChat, excludedSpeaker: excludeSpeaker }).nextSpeaker;
  }

  const validSpeaker =
    normalizedChat.countries.find((country) => country.name.toLowerCase() === nextSpeaker.toLowerCase()) ??
    normalizedChat.countries.find((country) => country.name !== excludeSpeaker);

  return validSpeaker?.name || "";
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

// Event density per skip length (player-tuned): longer skips must return
// proportionally more events, and short ones must stay brief.
const eventCountRangeForDays = (days) => {
  if (days < 1) return [1, 1];   // sub-day skip (e.g. 6 hours)
  if (days <= 7) return [1, 2];
  if (days <= 31) return [5, 7];
  if (days <= 92) return [10, 13];
  if (days <= 184) return [19, 27];
  return [29, 37];
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
  const bundle = await readGameStateBundle({ force: true });
  const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
  // Fractional days are allowed so sub-day skips (e.g. 6h = 0.25) work; the game
  // date only advances in whole days, so a sub-day skip keeps the same date.
  const safeDays = Math.max(0, Number(days) || 0);
  if (safeDays <= 0) {
    throw new Error("Choose a time-skip amount greater than zero.");
  }
  const dateStep = Math.max(0, Math.round(safeDays));
  const originDate = normalizeString(bundle.game.gameDate);
  const targetDate = dateStep >= 1 ? (addIsoDays(originDate, dateStep) || originDate) : originDate;
  if (dateStep >= 1 && parseIsoDate(originDate) && targetDate === originDate) {
    throw new Error("The requested jump exceeds the supported date range.");
  }
  const variables = await buildTemplateVariables(bundle, { targetDate });
  const durationLabel = formatDurationLabel(safeDays);
  let [minEvents, maxEvents] = eventCountRangeForDays(safeDays);
  // Guarantee at least one event per queued action, so each planned action has a
  // slot to resolve into (bounded so a huge queue can't demand absurd counts).
  const plannedActionCount = normalizeActions(bundle.actions).filter((action) => action.status === "planned").length;
  if (plannedActionCount > minEvents) {
    minEvents = Math.min(plannedActionCount, 37);
    maxEvents = Math.max(maxEvents, minEvents + 3);
  }
  const { generation, payload } = await runJsonTask(mode === "auto" ? "autoJumpForward" : "jumpForward", {
    fallback: () => fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate }),
    signal,
    // The jump IS the game — by default generation waits as long as the model
    // needs (0 disables the deadline in runJsonTask), so the canned fallback is
    // only reachable through a real error, never a slow local/reasoning model.
    // The "Limit AI generation" toggle opts back into a 5-minute bound for
    // players who prefer a guaranteed turn over a guaranteed answer (Cancel
    // works either way).
    timeoutMs: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 300000 : 0,
    userMessage:
      mode === "auto"
        ? "Simulate an auto-jump and stop at the next notable or player-relevant event. Return JSON only. " +
          "Scale the events array to the time actually covered before your stop point: roughly 1-2 events per week, " +
          "5-7 per month, 10-13 per quarter, up to 29-37 for a full year — spread their dates across the covered period."
        : `Simulate a standard jump forward to the requested target date. Return JSON only. The "events" array must ` +
          `contain between ${minEvents} and ${maxEvents} events (this jump covers ${durationLabel}), with their dates ` +
           `spread across the skipped period.`,
    validatePayload: async (candidate, { finalAttempt } = {}) => {
      // Shape-of-story problems (event count, stray dates) are STRICT while a
      // retry remains — the model gets the exact error and usually fixes its
      // own answer — and SALVAGED on the final attempt: a finished generation
      // must never lose to the canned fallback over its date stamps, an extra
      // event, or an invented region name. finalAttempt comes from runJsonTask
      // itself (never from counting our own invocations — a schema failure on
      // attempt 1 skips this validator entirely, which used to make attempt 2
      // look "first" and leak strict feedback out as the fallback reason).
      const strict = !finalAttempt;
      const eventCount = normalizeArray(candidate?.events).length;
      if (strict && mode !== "auto" && (eventCount < minEvents || eventCount > maxEvents)) {
        return `$.events must contain between ${minEvents} and ${maxEvents} events; received ${eventCount}.`;
      }
      const dateError = validateTimelineDates({ candidate, mode, originDate, targetDate, requireAdvance: dateStep >= 1 });
      if (dateError) {
        if (strict) return dateError;
        clampTimelineDates(candidate, { mode, originDate, targetDate });
      }
      return await validateGeneratedWorldChanges(candidate, bundle.world, { strictTransfers: strict });
    },
    variables,
  });

  const result = {
    catalyst: payload?.catalyst ?? null,
    clearActions: payload?.clearActions !== false,
    events: normalizeArray(payload?.events),
    mode,
    outreach: normalizeArray(payload?.diplomaticOutreach),
    stopDate: normalizeString(payload?.stopDate) || targetDate,
    summary: normalizeString(payload?.summary),
    generation,
  };

  return applySimulationResult({
    baseActions: bundle.actions,
    baseChats: bundle.chats,
    baseColors,
    baseEvents: bundle.events,
    baseGame: bundle.game,
    baseWorld: bundle.world,
    result,
  });
  } finally {
    endSimulation();
  }
};

export const simulateAutoJump = async ({ days = 365, signal } = {}) =>
  simulateTimelineJump({ days, mode: "auto", signal });

export const applyGameMasterCommand = async (requestText) => {
  beginSimulation();
  try {
  const bundle = await readGameStateBundle({ force: true });
  const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
  const variables = await buildTemplateVariables(bundle, { gameMasterRequest: requestText });
  const { generation, payload } = await runJsonTask("gameMaster", {
    fallback: () => ({
      impacts: {
        polityChanges: [],
        regionTransfers: [],
      },
      summary: "No deterministic GM fallback changes were inferred from the request.",
    }),
    userMessage: "Apply the GM request as JSON only.",
    validatePayload: (candidate, { finalAttempt } = {}) =>
      validateGeneratedWorldChanges(candidate, bundle.world, { strictTransfers: !finalAttempt }),
    variables,
  });

  const gmEvent = normalizeGeneratedEvent({
    date: bundle.game.gameDate,
    description: normalizeString(payload?.summary),
    impacts: payload?.impacts,
    importance: "major",
    kind: "game-master",
    notable: true,
    playerRelated: true,
    title: "Game master intervention",
    source: generation.source,
  });

  if (!gmEvent) {
    throw new Error("The game master request did not produce a valid change set.");
  }

  return applySimulationResult({
    baseActions: bundle.actions,
    baseChats: bundle.chats,
    baseColors,
    baseEvents: bundle.events,
    baseGame: bundle.game,
    baseWorld: bundle.world,
    result: {
      catalyst: null,
      clearActions: false,
      events: [gmEvent],
      mode: "game-master",
      stopDate: bundle.game.gameDate,
      summary: gmEvent.description,
      generation,
    },
  });
  } finally {
    endSimulation();
  }
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
let idleDiplomacyInFlight = false;

export const maybeSendIdleDiplomacy = async ({ chance = IDLE_DIPLOMACY_CHANCE } = {}) => {
  if (idleDiplomacyInFlight || isSimulationBusy()) return null;
  if (Math.random() >= chance) return null;
  idleDiplomacyInFlight = true;
  try {
    const bundle = await readGameStateBundle({ force: true });
    if (!normalizeString(bundle.game?.country)) return null; // no active game
    const variables = await buildTemplateVariables(bundle);
    const { payload } = await runJsonTask("idleDiplomacy", {
      timeoutMs: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 60000 : 0,
      userMessage:
        "A quiet moment between rounds. Decide whether any single polity would send the player a short diplomatic note right now. Return JSON only.",
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
    if (!payload?.chat) return null;
    // A jump may have started while the model was thinking; its state bundle
    // predates our write, so drop the note rather than race the save.
    if (isSimulationBusy()) return null;
    const built = await buildGeneratedChat({ ...payload.chat, source: "outreach" }, "", bundle.world, {
      playerName: bundle.game.country,
    });
    if (!built) return null;
    const chats = normalizeChats(await readChatsState({ force: true }));
    // A note from a country the player already has an open 1:1 with lands in
    // that thread; anything else (including group approaches) opens a new chat.
    const single = built.countries.length === 1 ? regionKey(built.countries[0].name) : "";
    const existing = single
      ? chats.find((chat) => chat.status !== "closed"
          && Array.isArray(chat.countries)
          && chat.countries.length === 1
          && regionKey(chat.countries[0]?.name) === single)
      : null;
    let nextChats;
    if (existing) {
      const note = built.messages[0];
      if (!note) return null;
      nextChats = chats.map((chat) => (chat === existing
        ? { ...chat, messages: [...chat.messages, { ...note, time: normalizeString(bundle.game?.gameDate) }] }
        : chat));
    } else {
      nextChats = [built, ...chats];
    }
    if (isSimulationBusy()) return null;
    await writeChatsState(nextChats);
    return built;
  } catch {
    return null; // silence is always the safe outcome
  } finally {
    idleDiplomacyInFlight = false;
  }
};
