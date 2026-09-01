/*! Open Historia — portions (briefing dossiers + timeout/fallback hardening) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { callAI, sendDiplomaticMessageOnceOff } from "./main.jsx";
import { normalizePromptPack } from "./gameplayPrompts.js";
import { extractJsonPayload, unwrapMimickedToolCall } from "./jsonSalvage.js";
import { getGameplayTool, validateGameplayPayload } from "./gameplaySchemas.js";
import { buildOwnerAliasMap, canonicalOwnerName, toCountryName } from "../../runtime/ownerNames.js";
import {
  buildActionHistoryText,
  buildChatSummaryText,
  buildDetailedChatHistoryText,
  buildEventHistoryText,
  buildPromptContext,
  formatDateReadable,
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
  advanceStandingOrders,
  applyEventImpactsToWorld,
  enforceUnitVolume,
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
  resumeStandingOrders,
  writeActionsState,
  writeChatsState,
  writeEventsState,
  writeGameData,
  writeWorldState,
} from "../../runtime/gameState.js";
import { dedupeGeneratedEvents } from "../../runtime/eventDedup.js";
import { difficultyDirective } from "../../runtime/difficulty.js";
import { MAP_SETTING_KEYS, getMapSettingDefaultOn, isBetaUnits } from "../../runtime/mapSettings.js";
import { AI_FIRST_BYTE_TIMEOUT_MS, AI_IDLE_TIMEOUT_MS, createIdleDeadline } from "./idleDeadline.js";
import { UNIT_CONTRACT_MARKER, templateAlreadySays } from "./promptDedupe.js";
import {
  SEGMENTED_JUMP_MIN_DAYS,
  buildSegmentInstruction,
  eventCountRangeForDays,
  formatDurationLabel,
  mergeSegmentPayloads,
  planJumpSegments,
  segmentEventRange,
} from "./jumpSegments.js";
import { logDebugEvent } from "../../runtime/debugLog.js";

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

export { extractJsonPayload } from "./jsonSalvage.js";

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
const ACTIONS_REFERENCE = "[Actions You Can Take]\nThis is the full menu of levers you have to change the world. Everything you change rides on an event's \"impacts\" object, except the two whole-jump levers noted at the end. Reach for the RIGHT lever, and NEVER narrate a change in an event's text without also emitting the impact that makes it real — narration and world state must always agree.\n\n• regionTransfers — Move a region to a new owner. This is the most important lever and the one most often forgotten: use it for every conquest, cession, sale, liberation, annexation, or hand-over, one entry per region. Shape: {\"regionId\":\"<exact id, or the plain region name if you don't know the id>\",\"regionName\":\"\",\"fromCode\":\"\",\"toCode\":\"<new owner code>\"}. An event whose text says land changed hands but that carries no regionTransfers is invalid output and silently breaks the map. Transfer in order of proximity to the attacker's territory; never hand over an isolated region ringed by enemy land without a naval or airborne reason. A transfer is enacted IMMEDIATELY when the other side has agreed (a treaty, a negotiated cession, an event where they conceded) or when the ground has already been taken and held - a hand-over both sides accept needs no programme and no project. Where neither is true the land has NOT changed hands: record the claim with regionClaims instead and leave the border exactly where it is.\n\n• polityChanges — Create, rename, recolor, or re-describe a polity. One entry can do any combination: {\"code\":\"<polity code>\",\"name\":\"<new name, only if it changed>\",\"color\":\"#RRGGBB (only if it changed)\",\"aliases\":[\"...\"],\"reputation\":0-100,\"tags\":[\"...\"],\"stats\":{...},\"note\":\"<why>\"}. Create a polity by giving a new code with a name and color. Change name/color when the polity's identity actually changes - a regime change, a revolution, a unification or partition, a proclaimed republic or a restored monarchy - and ALWAYS when the player has ordered it for their own polity. A mere new leader is not a rename. But a rename or recolour the player has ordered for THEIR OWN country is an administrative act of their own government: it needs no other power's consent, it cannot be refused, and it must be enacted in this jump by an event carrying polityChanges with the new name and that action's id in actionIds. Keep \"code\" as the polity's CURRENT name - the engine matches on it and then stores the new one; a change addressed to the name you are introducing lands on nothing and mints a second country beside the real one. On an ideological or alignment shift, rewrite the COMPLETE tags list (it is a full replacement, not a delta). Set reputation (0 = pariah, 100 = universally trusted) only when this turn's events actually moved a polity's standing. A country's national statistics move ONLY through \"stats\" here — send just the fields that changed; everything omitted keeps its prior value. That includes WHO LEADS: when a leader is overthrown, assassinated, dies, resigns or is voted out, put the successor's name in stats.leader (together with stats.government and stats.stability when those moved too). An event that narrates a leader falling but leaves stats.leader untouched leaves the OLD name standing on that country's stat sheet, so the story and the sheet disagree.\n\n• regionClaims — Mark territory CLAIMED but not held, so the map can show a dispute instead of pretending nothing happened. Use it when a polity asserts a right to land it does not control and has not been given: an irredentist declaration, a proclaimed union, a contested border, a government-in-exile's title, a player declaring a neighbour's province theirs. Shape: {\"regionId\":\"<exact id, or the plain region name>\",\"claimantCode\":\"<claiming polity's full name>\",\"note\":\"<why>\"}; add \"drop\":true to withdraw a claim that was renounced, traded away, or lost with the claimant's defeat. The region renders striped in every claimant's colour and stays that way until it is settled - by a regionTransfers entry when someone finally wins or concedes it, or by a drop. NEVER move a border for a claim alone, and never leave a claim unrecorded either: a declaration that changes nothing the player can see is a declaration they cannot tell they made.\n\n• unitOps — Move the war on the map with battalions. Four ops:\n    {\"op\":\"spawn\",\"unit\":{\"name\":\"\",\"type\":\"infantry|armor|air|naval|artillery|garrison\",\"ownerCode\":\"\",\"strength\":1-1000,\"lng\":0,\"lat\":0,\"regionId\":\"\"}}\n    {\"op\":\"move\",\"unitId\":\"<existing id>\",\"toLng\":0,\"toLat\":0,\"regionId\":\"\",\"note\":\"\"}\n    {\"op\":\"strength\",\"unitId\":\"<existing id>\",\"strength\":0-1000,\"note\":\"\"}\n    {\"op\":\"remove\",\"unitId\":\"<existing id>\",\"note\":\"\"}\n  Spawn units for mobilizations and reinforcements, move them to reflect offensives, lower their strength as they take losses, and remove them only when destroyed or disbanded. Only reference unit ids that appear in the current-units list. When a front is decisively won, pair the advance with a regionTransfers entry so the border follows the troops.\n\n• markerOps — Place, remove, rename or resize a named structure or city. Four ops:\n    {\"op\":\"build\",\"marker\":{\"name\":\"\",\"kind\":\"<lowercase, e.g. military base / port / embassy / airfield / city>\",\"ownerCode\":\"\",\"lng\":0,\"lat\":0,\"note\":\"\",\"foundedAt\":\"\"}}\n    {\"op\":\"remove\",\"name\":\"<exact existing name>\",\"note\":\"\"}\n    {\"op\":\"rename\",\"name\":\"<current name>\",\"newName\":\"<new name>\",\"note\":\"<why>\"}\n    {\"op\":\"population\",\"name\":\"<city>\",\"population\":<whole number of people>,\"note\":\"<why>\"}\n  Emit build whenever an event founds or constructs a place, remove when one is destroyed, and rename when a city or structure is renamed (rename works on existing map cities too — a city renamed after a leader or ideology, a capital re-designated, a conquered city given the conqueror's name). Structures NEVER move borders: a facility one polity builds inside another's land does not transfer the region, and ownerCode is who runs the facility, not who owns the ground. Emit population whenever an event plausibly moves how many people live somewhere - a siege, famine, epidemic, bombing or evacuation shrinking a city; an industrial boom, resettlement or refugee influx growing one - giving the new TOTAL, not the change. It works on any city on the map, whether the scenario authored it or it came with the world.\n\n• createdChats — Have another polity open a diplomatic chat with the player BECAUSE of this event (a war scare prompting mediation, a border incident prompting an ultimatum, a windfall prompting a trade delegation). Shape: {\"countries\":[\"...\"],\"title\":\"<names the purpose>\",\"speaker\":\"<the initiating polity — never the player>\",\"openingMessage\":\"<that leader's first message, in their voice>\"}. The other side always speaks first; a blank or untitled chat is invalid.\n\n• actionIds — List the ids of the player's queued actions that this event resolves, so the game can clear them from the queue.\n\nWhole-jump levers (top level of your output, NOT inside an event):\n• diplomaticOutreach — Polities reaching out to the player on their OWN initiative this period — treaty feelers, trade proposals, non-aggression pacts, mediation offers, warnings, summit invitations — not tied to any single event. Same shape as createdChats. Open one whenever a polity plausibly would, rather than defaulting to none.\n• catalyst — An interactive branching scene handed to the player when a moment genuinely demands their decision, or null when none is warranted. Shape: {\"title\":\"\",\"premise\":\"\",\"opening\":\"\",\"choices\":[\"...\", \"...\", up to 5 distinct]}.\n\nKeep the total across createdChats and diplomaticOutreach to at most 3 per jump, and only when the approach genuinely serves the sender's interests.";

// Written into a fallback's rawResponse when there is no model output to show.
// Exported so the debug report (time.jsx) can tell this apart from real model
// text and label its section honestly, rather than matching on the wording.
export const NO_RESPONSE_BODY_NOTE = "(no response body — the request failed before the model answered, so there was nothing to parse. See the failure reason above: a transport or HTTP error like this usually means the provider URL, API key or model name is wrong, not that the model misbehaved.)";
export const EMPTY_RESPONSE_BODY_NOTE = "(the provider returned an empty response body — the request succeeded but the model produced no text)";

// "Limit AI generation" (ON by default) — the whole policy, in one place rather
// than a number per call site.
//
// It used to be a stopwatch: five minutes for a jump, two for most tasks, one
// for the small ones, counted from the moment the request was sent and applied
// whether or not the model was answering. That could not tell a slow model from
// a stopped one, so it was off by default and the game waited forever instead —
// which is no protection at all, and left players watching a dead spinner.
//
// Now it counts SILENCE (idleDeadline.js): five minutes with nothing arriving
// part-way through an answer, fifteen with no answer at all. A model that keeps
// writing is never interrupted however long the turn takes, so the setting is
// safe to ship on; a stalled one is caught instead of hanging the turn forever.
// Off still means "wait as long as the model needs".
const taskIdleTimeoutMs = () =>
  (getMapSettingDefaultOn(MAP_SETTING_KEYS.limitAiGeneration) ? AI_IDLE_TIMEOUT_MS : 0);

const runJsonTask = async (taskKey, {
  fallback,
  signal,
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
    systemPrompt = `${systemPrompt}\n\n[Region and City Capture]\nOn this map, territory is owned by REGIONS, and impacts.regionTransfers MUST name a region exactly as it appears in the [Game Map Description] above — never a city, town, port, or landmark. Cities such as Toulouse or Narbonne are only markers that sit INSIDE a region; a regionTransfer whose regionId is a city name matches no region and is silently discarded, so the border never moves even though the event says it did. To capture a place and the ground around it, transfer the REGION that contains it, and set fromCode to that region\u2019s current owner.\nTaking a region takes everything inside it, cities included — that is the normal case, so a city changing hands usually means transferring its whole region. To capture ONLY a city while its region stays with its current owner (a besieged holdout, an occupied port, an enclave), do NOT name it in regionTransfers; instead emit an impacts.markerOps build for it — {\"op\":\"build\",\"marker\":{\"name\":\"<city>\",\"kind\":\"city\",\"ownerCode\":\"<new holder>\",\"lng\":<lng>,\"lat\":<lat>}} — using that city\u2019s coordinates from [City Coordinates]. That places the city under the new owner without moving the region border.\nWhen a polity is conquered, annexed, partitioned, or unified OUTRIGHT — every region it still holds changing hands at once — you do not need one entry per region. Emit a SINGLE regionTransfer with "wholeCountry": true, put the losing polity's name in regionId instead of a region name, and set toCode to whoever takes it; the engine expands that into every region that polity currently owns. Use this ONLY for a total takeover of everything it holds. Any partial gain — a province, a border strip, a few regions — stays as ordinary per-region transfers, which remain the normal case.`;
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
  if (["jumpForward", "autoJumpForward", "idleDiplomacy"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Unit Coordinates]\nWhenever an event says a force is raised, mobilised, garrisoned, landed, reinforced, redeployed or moved, that event MUST carry the matching impacts.unitOps — a spawn for a force that now exists, a move for one that relocated. An event that describes troops without unitOps produces a story about an army the map never shows.\nWrite every coordinate as a plain decimal number, using a POINT for the decimal mark and no other characters: lng 37.06, not "37,06", not "37.06°E". Every unitOps spawn and move MUST use the real-world longitude and latitude of where the unit actually is or is going. The lng 0 / lat 0 shown in the output template is ONLY a placeholder \u2014 0,0 is open ocean off West Africa, never a valid position, and a unit placed there is discarded. Set lng and lat to the actual coordinates: use the values from [City Coordinates] for a unit at or near one of those cities, or the real coordinates of the region or front where the action happens.`;
  }

  // Standing orders (world.pendingUnitOrders) survive a jump's single clearActions
  // flag on purpose - it wipes the actions queue wholesale. The ENGINE now advances
  // them every turn (advanceStandingOrders), so this block exists to tell the model
  // what is already in motion, NOT to ask it for the legs: a move op for a unit the
  // engine is already advancing would move that unit twice for the same elapsed time.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const pending = normalizeString(variables.pendingUnitOrders);
    if (pending && !pending.startsWith("No units")) {
      systemPrompt = `${systemPrompt}\n\n[Standing Unit Orders]\nEach unit below is already under a standing order and the engine advances it automatically every turn - a move continues toward its destination at that unit's own pace, and a patrol keeps working its station. You do NOT need to emit a move op for any of them, and you should not: doing so would advance the unit twice. Take these as context for what is happening on the map, and write events about them when the story warrants it. Emit a unit op for one of these units only when this jump genuinely REDIRECTS it (a new destination, a change of posture) or ends it (destroyed, recalled, withdrawn) - and say why in an event. An order clears itself once the unit arrives; you never need to remove one yourself.\n${pending}`;
    }
  }

  // The unit contract itself. defaultPrompts.json carries the same rules for NEW
  // games; this is what reaches the campaigns that already exist, whose prompts are
  // frozen — the same reason [Player Agency] and [Map Truth] are injected here.
  //
  // Skipped when the rendered template ALREADY says it. The bundled template's
  // units section is a near-verbatim copy of this block (same rules, same order,
  // largely the same sentences), so a new game was paying for both — ~2 KB of
  // every jump prompt spent saying the same thing twice, which is worse than
  // wasteful: a rule repeated in two slightly different wordings invites the
  // model to look for a distinction that is not there.
  //
  // Deliberately NOT extended to ACTIONS_REFERENCE, though it overlaps the
  // template's output-contract tail just as much. The template predates
  // regionClaims, actionIds and projectOps, and ACTIONS_REFERENCE is the ONLY
  // place a frozen-prompt campaign is told those three levers exist — skipping it
  // would silently take them away. That duplication gets resolved by rewriting
  // the template itself, not by dropping the block that carries the newer rules.
  if (["jumpForward", "autoJumpForward"].includes(taskKey) && !templateAlreadySays(systemPrompt, UNIT_CONTRACT_MARKER)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[Units on the Map]\nUnits are EVIDENCE OF YOUR OWN EVENTS. The player cannot move or fight their own formations - the map is there to show them what is happening - so every unit you spawn or move must be something one of this jump's events actually describes. Reach for them readily: a mobilization, a build-up on a border, a fleet sailing, an offensive, a withdrawal all deserve to be visible. But keep the map legible - only formations that matter to the story. A great power at war might show five or six; a country at peace shows one or two, or none.\nstrength is a PERCENTAGE of established strength (100 = fresh and full, 60 = worn down, 20 = a shell), and composition says what the formation actually is ("1 aircraft carrier, 2 frigates", "3 tank regiments"). Write both, plus a one-sentence note on what it is doing and where. A counter that does not say what it is tells the player nothing.\nDo not teleport. A move may only cover what that unit could really travel between the previous event's date and this one's. The engine enforces this: an over-long move becomes a partial advance that continues automatically on later turns, so ordering the full distance is safe and correct.\nThe map is what ${playerName} KNOWS, not omniscience. A force may legitimately appear far from its own territory when it is being DETECTED rather than arriving - a submarine that has shadowed a fleet for weeks, infiltrators already in country, a deployment only now confirmed. Such a unit is drawn as unconfirmed, which is correct and not a penalty. The one thing you cannot conjure is a fixed installation: use markerOps build for a base, and never spawn a far-flung garrison.\nSet posture whenever you place or move a unit - holding, massing, patrol, transit, exercise, blockade, withdrawing. It is how the player reads intent off the map. "patrol" is special: the engine keeps a patrolling unit working its station on its own, turn after turn, so state it once and leave it.`;
  }

  // The map reading as if only the player fields an army: unitOps is fully general
  // (any owner, not just the player), but a low events-per-jump budget plus
  // player-centric framing meant other powers rarely got a reason to use it -
  // their militaries existed only when something dramatic happened TO the player.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Other Powers' Militaries]\nThe map should not read as though only ${normalizeString(variables.playerPolity) || "the player's polity"} fields any forces. When a major or currently-relevant power (a scenario-defined actor, a country the player has clashed or negotiated with, a power actively at war or mobilizing) plausibly has forces in the field this period - mobilizing, patrolling a border, escorting a fleet, garrisoning a front, reinforcing an ally - reflect it with impacts.unitOps even when nothing dramatic is happening to the player specifically. A brief, minor event (or a line folded into a larger one) is enough to justify it; it does not need its own headline. Keep this proportionate: a country at peace far from any conflict does not need forces conjured for their own sake, and this must never be used to manufacture aggression toward the player that their own actions or the wider story do not warrant.`;
  }
  // The between-rounds pulse may now move the world's forces a little, so it needs
  // the same discipline the jump gets — injected here so it reaches existing games
  // whose stored idleDiplomacy prompt predates any of this.
  if (taskKey === "idleDiplomacy") {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[World Pulse]\nOnly minutes of real time have passed and the game date has NOT advanced, so any movement is a step, never a redeployment. Return at most two unitOps, and an empty list is the normal answer. Move only what already has a reason to move: a war under way, a crisis already named in recent events, a border already tense, a fleet already at sea. Never invent a new conflict here.\nPrefer moving or re-posturing an EXISTING unit over spawning one. Prefer movement ${playerName} can actually see - near their borders, waters, allies and rivals; a division shuffling across the far side of the world is invisible and not worth an operation. Never move a garrison, and never touch a unit owned by ${playerName}.\nWrite composition and a one-sentence note on anything you spawn, and set posture on anything you touch. Return a sighting ONLY when the movement is inside or near ${playerName}'s sphere and their services would plausibly have seen it; otherwise sighting is null and the movement is silent.\n${normalizeString(variables.idleChatAllowed) === "no" ? "This pulse is MOVEMENT ONLY: return chat as null." : ""}

[What the Sender Knows]
You are shown every chat in the campaign so you can judge WHO would plausibly speak and about what. The polity you then write as does NOT share that view. It knows only: the chats it was itself a participant in, whatever is public knowledge in the events above, and what ${playerName} has told it directly. It has NOT read ${playerName}'s correspondence with anyone else.
So use the wider picture to choose the sender and the moment — never to give them knowledge they could not have. A polity must not reference, allude to, or react to something said in a conversation it was not part of, and must not echo another leader's turn of phrase. If a private exchange elsewhere is the only reason a message would make sense, that is a message this polity cannot send: pick a different sender, or return chat as null.`;
  }

  // What a player's order actually costs them in time, and the single rule that
  // decides it: does this act need anyone else's consent?
  //
  // Field report behind this (issue #7): a player asked to rename their country.
  // The advisor opened a Projects board entry for it -- the only lever it has, its
  // fences being chart/actions/senddraft/deploy/projects and never polityChanges --
  // and the rename sat at 15% for twelve in-game months while the advisor reported
  // that the seals had been updated. Nothing had. A rename is one signature.
  //
  // The other half matters just as much in the opposite direction: a transfer of
  // somebody else's land is NOT a signature, and must not resolve just because the
  // player asked. regionClaims is what makes that answerable rather than a refusal.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}

[Sovereign Acts and What Needs Consent]
Before you decide how long one of ${playerName}'s orders takes, ask one question: does this act need anyone else's agreement?

NO - IT IS INTERNAL. Their own name, colour, flag, style, title, anthem, official language, capital designation, ministry structure, proclamations, and the administration of territory they already hold. Their own government decides and nobody may refuse. THESE RESOLVE IN THIS JUMP. Enact each with a single event dated inside the covered period, carrying the impact that makes it real - polityChanges for a change of name, colour, style or tags; markerOps rename for a renamed city or capital - and list that action's id in actionIds. They cannot fail for lack of consent, they need no programme, budget or timetable, and they never take multiple rounds. Narrate the reaction if it is interesting - a rival's contempt, a domestic celebration, the old name lingering in foreign newspapers - but the act itself is DONE. Never open a Projects entry for one, and never report one as in progress.

YES - IT TOUCHES ANOTHER POLITY. Region transfers, cessions, annexations, border adjustments: anything that moves land or binds another government. These need one of two things first, and it must actually be in the campaign record: CONSENT (that polity agreed, in a diplomatic exchange, a treaty, or an event where they conceded) or a FAIT ACCOMPLI (the ground has already been taken and held, so they have no say left - the map and the units are the evidence). Where either is already true, enact it THIS JUMP with regionTransfers; a hand-over both sides accept needs no programme either.

Where NEITHER is true yet, the order is not refused and not quietly deferred - it splits in two, and BOTH halves happen now. First, record the claim with regionClaims, so the region shows as disputed on the map immediately and the player can see that their declaration landed. Second, say plainly what is missing - whose agreement, or what has to be taken - and open the project for the campaign that will obtain it, with the transfer itself on that project's onComplete so the border moves the moment the effort actually succeeds. A declaration that changes nothing the player can see is the failure this rule exists to prevent.`;
  }

  // The Projects & Operations board. It exists precisely so long-running work
  // does not vanish between rounds, which only holds if the jump that narrates a
  // programme also MOVES it -- otherwise the board freezes at whatever the
  // advisor last said and the player stops trusting it. Injected at call time for
  // the same frozen-prompt reason as the directives above.
  // Only the game master still moves the board inline. The jump handed it to the
  // separate `projects` task (generateProjectOps), whose whole prompt is the
  // board and whose schema is the only place projectOps now appears for a jump —
  // so telling a jump about it would describe a lever its schema no longer has,
  // for ~1k tokens and a wasted retry when it tried to use one.
  //
  // catalystExecutor and catalystSummary were removed for that same reason
  // earlier: neither schema has an `impacts` field at all
  // (CATALYST_EXECUTOR_SCHEMA is {summary, resolved, nextChoices};
  // CATALYST_SUMMARY_SCHEMA is {title, description, importance}).
  if (taskKey === "gameMaster") {
    const projects = normalizeString(variables.projectsSummary);
    const board = projects && !projects.startsWith("No projects")
      ? `\n\nThe board as it stands:\n${projects}`
      : "";
    systemPrompt = `${systemPrompt}\n\n[Projects & Operations]\nThe player keeps a board of long-running efforts - research and industrial programmes, construction projects, military and covert operations, sustained political campaigns - each with a status, progress, timeline and next milestone. Keep it in step with what you narrate, using impacts.projectOps.\nWhen an event advances, delays, funds, starves, exposes or ends one of the efforts below, that SAME event must carry a projectOps entry moving it: op update for progress or a change of status, op milestone when a checkpoint is reached or missed, op complete when it finishes. Copy the id and name EXACTLY as they appear below - an op that names something not on the board is dropped. When an event STARTS a new multi-round effort (a power lays down a programme, opens a construction project, mounts an operation), open it with op create, including a foreign power's programme the player's services have learned of - set ownerCode to that country's full name.\nBe proportionate. A programme does not move every jump, and inventing progress is worse than reporting none: if nothing happened to it this period, leave it alone. A long jump should move the things that plausibly advanced over that span; a six-hour jump almost never moves any of them. Never open a project for an internal act - a rename, a recolour, a flag, a title, a proclamation, a reshuffle - or for a transfer the other side has already agreed to: those are enacted outright by the event that narrates them (see [Sovereign Acts and What Needs Consent]), and a progress bar for one is always wrong.${board}

Whose project it is. Entries marked THEIRS belong to another power; everything else is the player's own. A foreign programme moves because ITS OWNER moved it and the player's services observed as much - never because the player wished it stopped or ordered it stopped. The player has no priority dial and no cancel over another government's work, so an order of theirs is not a reason to touch a foreign entry: if their orders this period were aimed at a rival's programme, what happens is that THEIR OWN counter-effort advances - the sabotage, the embargo, the covert operation, the race to build first - and the rival's entry then moves only insofar as that effort actually bit, narrated as an event with the consequences that follow. Retaliation is the same rule, not an exception to it: a wrecked programme is wrecked by an event that says who did what and at what cost, and if the operation failed then the rival's programme carries right on. Never close, cancel or deprioritise a foreign entry to satisfy an instruction; close it only when the story genuinely ended it, and say what ended it.

The board above carries a \"Needs a decision this jump\" list. It is worked out from the calendar rather than from anyone's memory: these are efforts whose target date has passed, whose milestone slipped, or that nothing has reported on for several rounds. Deal with EVERY entry on it. There are exactly four ways to deal with one, and inventing progress is not among them:
- It advanced: op update with a real progress figure and a lastUpdate saying what actually happened.
- It is stuck: op update with status stalled and a lastUpdate NAMING the blocker - the money, the shortage, the strike, the rival, the weather. \"Progress continues\" is not an answer. A stalled project with a named cause is, and it gives the player something they can act on.
- It reached or missed a checkpoint: op milestone.
- It is over: op complete, cancel or fail, with a note.
A project marked HIGH PRIORITY must not sit on that list two jumps running - the player has said it matters, so it either moves or it stalls for a stated reason. A project marked low priority may be left drifting with a one-line note, and that is a correct answer for it. Everything else is normal: move it when the story plausibly moved it, and say so plainly when it did not. Never raise a progress figure that nothing in this jump's events justifies - a board of quietly inflating percentages is worth less than an honest one full of stalls.`;
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

  const controller = new AbortController();
  // Let an external signal (the player pressing Cancel) abort the in-flight AI
  // call too — the abort propagates through callAI to the server relay.
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  const idleMs = taskIdleTimeoutMs();
  const timeoutError = new Error(
    `AI task "${taskKey}" timed out: the model stopped answering. `
      + "Turn off \"Limit AI generation\" in Settings to wait as long as the model needs.",
  );
  // Two windows (idleDeadline.js): a long one for an answer that has not started
  // — prompt evaluation and buffered endpoints both look like a stall from here —
  // and a short one between the pieces of an answer that has.
  const idle = createIdleDeadline(
    { idleMs, firstByteMs: idleMs ? AI_FIRST_BYTE_TIMEOUT_MS : 0 },
    () => controller.abort(timeoutError),
  );
  const tool = getGameplayTool(taskKey);
  const history = [{ role: "user", parts: [{ text: userMessage }] }];
  // Detailed mode follows every AI task, not only the ones that fail. Sizes and
  // shapes, never the prompt itself: a jump's system prompt is tens of thousands
  // of characters of campaign, which would fill the whole log budget in one
  // entry — but "the prompt was 92k characters and there was no tool schema" is
  // most of what a stuck task needs, and it is invisible otherwise.
  const taskStartedAt = Date.now();
  logDebugEvent("ai", `Task "${taskKey}" started.`, {
    promptChars: systemPrompt.length,
    userMessageChars: String(userMessage ?? "").length,
    tool: tool?.name || "(none — raw JSON expected)",
    idleTimeoutMs: idleMs || "(no deadline — waits as long as the model needs)",
    ...(idleMs ? { firstByteTimeoutMs: AI_FIRST_BYTE_TIMEOUT_MS } : {}),
  }, { verbose: true });
  // The instruction itself, separately. It is short (a sentence), it is the one
  // part of the prompt that differs between two runs of the same task, and it is
  // what a reader compares against a payload that came back about the wrong
  // thing.
  logDebugEvent("ai", `Task "${taskKey}" instruction.`, userMessage, { verbose: true });
  let failureReason = "The model did not return valid structured output.";
  // The player's only recourse when a turn falls back is "give Claude the
  // logs" — but the fallback warning below used to log only failureReason, a
  // short label ("Response did not contain parseable JSON..."), never the
  // actual text that failed to parse. Kept across attempts so whichever one
  // the loop last saw is what the warning below can show.
  let lastRawText = "";
  // Whether ANY attempt got as far as a response body. An empty lastRawText has
  // two very different meanings — the request died in transport (a 404 from a
  // mistyped base URL, a timeout, DNS) so the model never answered, versus the
  // model answering with nothing — and the copied debug report used to blame
  // both on "logging wasn't added yet". The first case is the more common one
  // and points straight at provider settings, so say which happened.
  let sawResponseBody = false;
  // Why the FIRST answer was rejected, and the answer itself when it was a
  // complete one. Both exist for the same reason: attempt 2 can die before it
  // produces anything (a provider 500, a timeout), and when it does, everything
  // learned from attempt 1 used to be thrown away with it. See the catch block
  // and the salvage pass below the loop.
  let firstFailureReason = "";
  let salvageCandidate = null;

  try {
    for (let outputAttempt = 1; outputAttempt <= 2; outputAttempt += 1) {
      // Per attempt, not per task: a retry re-sends the whole prompt and so
      // re-does the wait for a first byte.
      idle.start();
      const response = await callAI(systemPrompt, history, {
        // No output-token cap. A long/action-heavy turn's JSON must not be truncated
        // mid-response — a cut-off response won't parse, so runJsonTask fell back to
        // canned events that carry NO regionTransfers and NO diplomacy, which is why
        // the map never changed and no chats opened. main.jsx now lets each provider
        // use its own model maximum when no maxTokens is passed.
        // The moment this task gives up if nothing more arrives — null while
        // nothing has come back yet. The providers read it to decide whether a
        // busy-retry wait still fits inside the window.
        deadline: idle.deadline,
        // Every network chunk of the answer restarts that window.
        onActivity: idle.note,
        signal: controller.signal,
        tool,
        // Names this call in the ai-call transport entries, so a task's own
        // entries and the request/response pair underneath them line up.
        logLabel: `task "${taskKey}"`,
      });
      // This attempt is answered: stop counting silence against it. Validation,
      // salvage and the retry's own prompt evaluation all happen with nothing on
      // the wire, and leaving the window armed across them would have attempt
      // 1's clock abort a perfectly healthy attempt 2. The next answer re-arms it.
      idle.cancel();
      const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
      lastRawText = rawText;
      sawResponseBody = true;
      logDebugEvent("ai", `Task "${taskKey}" attempt ${outputAttempt} answered.`, {
        responseChars: rawText.length,
        viaToolCall: Boolean(response?.toolInput),
        elapsedMs: Date.now() - taskStartedAt,
      }, { verbose: true });
      const parsed = response?.toolInput ?? unwrapMimickedToolCall(extractJsonPayload(rawText), tool?.name);
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
      // Clearing the schema means this is a complete, applicable turn. Only the
      // task validator can still reject it below, and while a retry remains it
      // does so STRICTLY — for shape-of-story problems it would have salvaged
      // had this been the last word. Worth keeping for exactly that case.
      const schemaValid = validation.valid;
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
        logDebugEvent("ai", `Task "${taskKey}" succeeded on attempt ${outputAttempt} in ${Math.round((Date.now() - taskStartedAt) / 1000)}s.`, undefined, { verbose: true });
        // The payload that was ACCEPTED, not only the ones that were rejected.
        // A turn that validates cleanly and still produces the wrong world — a
        // transfer to a polity that does not exist, a chat opened with nobody in
        // it — is a report about content that passed every check, and until now
        // the only output text the log kept was from answers that failed.
        // Logged from the payload rather than rawText so a tool call, which has
        // no raw text at all, is recorded the same way as a JSON reply.
        logDebugEvent("ai", `Task "${taskKey}" accepted payload.`, parsed, { verbose: true });
        return { generation: { source: "ai", fallbackReason: "" }, payload: parsed };
      }

      // Every rejection, including the one attempt 2 goes on to fix. A turn that
      // came out right on the retry still tells you which rule the model keeps
      // breaking, and that is invisible in a log that only records failures.
      logDebugEvent("ai", `Task "${taskKey}" attempt ${outputAttempt} REJECTED: ${validation.error}`, {
        clearedSchema: schemaValid,
        rawResponse: rawText,
      }, { verbose: true });

      failureReason = validation.error;
      if (!firstFailureReason) firstFailureReason = validation.error;
      if (schemaValid && !salvageCandidate) salvageCandidate = parsed;
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
    const transportReason = normalizeString(actualError?.message || actualError);
    // The retry dying in transport used to ERASE why the first answer was
    // rejected, so the debug report the player copies out read "Internal server
    // error" above a raw response that had nothing to do with it — the text
    // shown is attempt 1's (lastRawText is only reassigned once a call returns),
    // and its actual rejection reason was gone. Report the first answer's reason
    // first, since that is the one the raw text belongs to.
    failureReason = firstFailureReason
      ? `${firstFailureReason}${transportReason ? ` The retry then failed: ${transportReason}` : ""}`
      : transportReason || failureReason;
  } finally {
    idle.cancel();
  }

  // A deliberate user cancel must NOT silently fall back to canned events —
  // propagate the abort so the caller can quietly cancel the jump with no state
  // change. (A timeout still uses the fallback, as before.)
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Timeline jump cancelled.", "AbortError");
  }

  // Last chance before the canned fallback. An earlier answer that cleared the
  // schema is a finished turn — every event, transfer and projectOp the model
  // wrote — and the task validator rejected it only under `strict`, which is on
  // solely BECAUSE a retry remained: an event count, a stray date, an invented
  // region name, all of which it repairs in place on the final attempt. When the
  // retry then produced nothing usable (a provider 500, a timeout, a second
  // answer that failed outright), that final-attempt pass never ran, and the
  // player lost a complete turn to a rule the model was never given the chance
  // to satisfy. Run it now — the same salvage the second answer would have got.
  if (salvageCandidate) {
    try {
      const salvageError = validatePayload
        ? normalizeString(await validatePayload(salvageCandidate, { attempt: 2, finalAttempt: true }))
        : "";
      if (!salvageError) {
        logDebugEvent("ai", `Task "${taskKey}" salvaged an earlier answer after the retry failed — the turn is real, not canned.`, undefined, { verbose: true });
        return { generation: { source: "ai", fallbackReason: "" }, payload: salvageCandidate };
      }
    } catch {
      // Salvage validation is best-effort; fall through to the fallback below.
    }
  }

  if (typeof fallback !== "function") {
    throw new Error(`AI task "${taskKey}" failed: ${failureReason}`);
  }

  console.warn(`[ai] task "${taskKey}" failed (${failureReason}) — using the deterministic fallback.`);
  // Capped so one runaway response can't bloat world.json (this rides along on
  // every recent fallback's simulationHistory entry, see applySimulationResult)
  // or flood the console. Surfaced to the player as the "Copy debugging
  // message" button next to the fallback warning (time.jsx) — that button, not
  // DevTools, is the primary way this reaches anyone now.
  const RAW_RESPONSE_LIMIT = 12000;
  const capturedRawText = lastRawText.length > RAW_RESPONSE_LIMIT
    ? `${lastRawText.slice(0, RAW_RESPONSE_LIMIT)}\n…[${lastRawText.length - RAW_RESPONSE_LIMIT} more characters truncated]`
    : lastRawText;
  // No body at all is itself the diagnosis, so say so instead of leaving the
  // field empty and letting the report guess it is an old turn. The marker
  // goes in the same field the raw text uses, so it survives the reload path
  // (applySimulationResult → world.json) with no extra plumbing.
  const rawResponse = capturedRawText
    || (sawResponseBody ? EMPTY_RESPONSE_BODY_NOTE : NO_RESPONSE_BODY_NOTE);
  if (capturedRawText) {
    console.warn(`[ai] task "${taskKey}" — raw model response that failed to parse:\n${capturedRawText}`);
  } else {
    console.warn(`[ai] task "${taskKey}" — ${rawResponse}`);
  }
  return {
    generation: { source: "fallback", fallbackReason: failureReason, rawResponse, taskKey },
    payload: await fallback(),
  };
};

const CONSOLIDATION_INTERVAL_ROUNDS = 5;
const CONSOLIDATION_RETAIN_EVENTS = 24;
const CONSOLIDATION_SIZE_THRESHOLD = 48;
const CONSOLIDATION_BATCH_SIZE = 60;

// The Projects & Operations board, moved out of the jump into its own call.
//
// Why it is separate: projectOps was two thirds of the jump's output contract,
// and the board dominated what the model spent its attention on — a field run
// caught one narrating stalled programmes for three minutes and never reaching
// the events it was asked for. The board is BOOKKEEPING: it follows from the
// events rather than competing with them for the same budget. Split out, each
// call carries one contract, and this one sees only what it needs.
//
// Runs ONCE per jump, never per segment: a segmented jump would otherwise pay
// for this three times and show the model only a third of the round each time.
//
// Returns the ops rather than applying them. simulateTimelineJump attaches them
// back onto the events that caused them, so the board change is recorded as part
// of that event and the existing write path (applyEventImpactsToWorld ->
// releaseProjectCompletionEffects -> applyProjectOps) runs unchanged, inside the
// same single write and the same rollback snapshot.
const generateProjectOps = async (bundle, events, { signal } = {}) => {
  const board = normalizeArray(bundle.world?.projects);
  // Nothing to keep in step, and nothing an event could plausibly open against
  // an empty board that is worth a whole extra request.
  if (board.length === 0 || events.length === 0) return { ops: [], skipped: true };

  const variables = await buildTemplateVariables(bundle, {});
  // The events, numbered, because eventIndex is how an op says which one moved
  // the effort. Impacts are deliberately left out: this call decides what the
  // STORY did to the board, and the other levers are noise for that question.
  const eventList = events
    .map((event, index) => `[${index}] ${event.date || "undated"} — ${event.title}\n${event.description}`)
    .join("\n\n");

  const { generation, payload } = await runJsonTask("projects", {
    signal,
    userMessage:
      `These events have just been simulated. Move the board to match them, and return `
      + `{"projectOps":[]} if nothing on it genuinely moved.\n\n${eventList}`,
    variables,
    // No fallback: an empty board is exactly what a failed call should leave
    // behind, and runJsonTask throwing is what lets the caller tell the player
    // the board did not update rather than pretending it did.
  });
  return { generation, ops: normalizeArray(payload?.projectOps) };
};

// The turn is generated and waiting, not lost. Flagged so the UI can tell this
// apart from an ordinary jump failure and offer to retry just the board rather
// than regenerating the whole round.
const projectsHeldError = (cause) => {
  const error = new Error(
    "Your events are ready, but the Projects & Operations board did not update, so nothing has been "
    + `saved yet: ${cause?.message || "the board task returned no usable answer"}. `
    + "Retry the board to finish the turn, or discard it and run the turn again.",
  );
  error.projectsHeld = true;
  error.cause = cause;
  return error;
};

// Finish a held turn by re-running ONLY the board call. The events are not
// regenerated — they are already valid, and on a slow model they may have cost
// ten minutes. Because nothing was written, this is the same code path as the
// first attempt rather than a second one to keep in step.
export const retryPendingProjectsJump = async ({ signal } = {}) => {
  if (!pendingProjectsJump) throw new Error("There is no turn waiting on the Projects board.");
  const { applyArgs, bundle, events } = pendingProjectsJump;
  beginSimulation();
  try {
    let ops = [];
    let skipped = false;
    try {
      ({ ops, skipped } = await generateProjectOps(bundle, events, { signal }));
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      // The BOARD failed again. Nothing written, turn still held: the player can
      // retry once more or discard. Only this branch re-holds — a failure after
      // this point is a different situation and must not pretend otherwise.
      logDebugEvent("turn", "Board retry failed; the turn is still held.", error);
      throw projectsHeldError(error);
    }

    if (!skipped && ops.length) {
      const attached = attachProjectOpsToEvents(events, ops);
      logDebugEvent("turn", `Projects board updated on retry: ${attached} op(s).`, undefined, { verbose: true });
    }

    // Released BEFORE the write, so a turn can never be applied twice. If the
    // write itself fails the slot stays empty and its error propagates as an
    // ordinary turn failure — the player rolls back, which is the right move for
    // a half-finished write and the wrong one for a board that just needs asking
    // again.
    pendingProjectsJump = null;
    return await applySimulationResult(applyArgs);
  } finally {
    endSimulation();
  }
};

// Put each op onto the event that caused it, so the board move is part of that
// event's impacts. An op with no usable eventIndex lands on the LAST event: the
// alternative is dropping it, and a board change the model asked for is worth
// more than perfect attribution of which event caused it.
const attachProjectOpsToEvents = (events, ops) => {
  if (!events.length || !ops.length) return 0;
  let attached = 0;
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const raw = Number(op.eventIndex);
    const index = Number.isInteger(raw) && raw >= 0 && raw < events.length ? raw : events.length - 1;
    const event = events[index];
    if (!event.impacts || typeof event.impacts !== "object") event.impacts = {};
    if (!Array.isArray(event.impacts.projectOps)) event.impacts.projectOps = [];
    // eventIndex was addressing, not content — it means nothing once the op is
    // sitting on its event, and normalizeProjectOp would only have to ignore it.
    const { eventIndex, ...rest } = op;
    event.impacts.projectOps.push(rest);
    attached += 1;
  }
  return attached;
};

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

// A turn whose events are generated and validated but NOT yet written, because
// the Projects & Operations board could not be brought in step with them.
//
// Nothing is applied while this is set. That is deliberate and is what keeps the
// retry honest: the board's ops must ride in on the events that caused them
// (applyEventImpactsToWorld -> releaseProjectCompletionEffects -> applyProjectOps),
// which only works BEFORE the world is written. A retry that ran afterwards would
// have to go through the non-event door, which refuses to close a project
// carrying an onComplete — correct for the advisor, wrong for the simulation, and
// it would silently leave a finished annexation with the border unmoved.
//
// Holding the whole turn instead means the retry is the SAME path as the first
// attempt, with no privileged bypass to add and no second behaviour to keep in
// step. If it cannot be resolved the turn fails like any other and the player
// rolls back, which is what they do with a bad turn anyway.
let pendingProjectsJump = null;

// A pending turn counts as busy. The idle pulse already checks this before it
// starts and again before every write, so one guard keeps it from writing chat
// or units into a world that is about to be replaced by the held turn.
export const isSimulationBusy = () => activeSimulations > 0 || pendingProjectsJump !== null;

export const hasPendingProjectsJump = () => pendingProjectsJump !== null;

// Abandon the held turn. Nothing was written, so there is nothing to undo — the
// player simply loses the generation, the same as cancelling a jump.
export const discardPendingProjectsJump = () => {
  const had = pendingProjectsJump !== null;
  pendingProjectsJump = null;
  if (had) logDebugEvent("turn", "Held turn discarded; the board was never updated and nothing was written.");
  return had;
};

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
  // The player is never a chat PARTICIPANT — they're who the chat is WITH — but
  // the model sometimes names them alongside the real invitee ("France and
  // <player>"). Left in, that turned an ordinary 1-on-1 note into a false "group
  // chat" (extra turn-taking UI, wrong "Chat with X, Y" header) for no real
  // second country. Filter them out before anything downstream counts heads.
  const playerKey = normalizeString(playerName).toUpperCase();
  const matchesPlayer = (country) =>
    playerKey && (normalizeString(country.name).toUpperCase() === playerKey || normalizeString(country.code).toUpperCase() === playerKey);
  const countries = (await resolveInvitees(countriesInput, world)).filter((country) => !matchesPlayer(country));
  if (countries.length === 0) return null;

  // The initiating polity speaks first. When the model names no speaker, attribute
  // the opener to the first (now player-free) participant.
  const speakerKey = normalizeString(chatLike?.speaker).toUpperCase();
  const initiator =
    countries.find((country) =>
      speakerKey
      && (normalizeString(country.name).toUpperCase() === speakerKey || normalizeString(country.code).toUpperCase() === speakerKey))
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

// Case/diacritic-insensitive identity for a chat's participant SET (order-blind:
// "France, Spain" and "Spain, France" are the same conversation). Drives the
// dedup below: a country picking up an old thread must land back in that thread,
// not beside it in a freshly forked one.
const chatParticipantKey = (countries) =>
  (Array.isArray(countries) ? countries : [])
    .map((country) => regionKey(country?.name))
    .filter(Boolean)
    .sort()
    .join("|");

// Every message the game itself puts into a diplomatic thread passes through the
// fold below — the notes a jump generates, the idle diplomacy drip, and the
// advisor's own "send this to <country>" — so this is where a detailed log
// records them.
//
// The bodies go in whole, alongside WHICH thread they landed in: the two things
// reported about generated chats are "a country messaged me about something that
// never happened" and "it opened a second thread with France instead of
// answering in the one I had", and the second is invisible without knowing
// whether the fold matched an existing chat or created a new one.
const logGeneratedChat = (built, outcome) => {
  const participants = (built?.countries ?? [])
    .map((country) => country?.name || country?.code || "")
    .filter(Boolean)
    .join(", ") || "(no participants)";
  logDebugEvent("diplomacy",
    `Generated note ${outcome} — ${participants}: "${built?.title || "(untitled)"}" (source: ${built?.source || "unknown"}).`,
    (built?.messages ?? []).map((msg) => `${msg?.speaker || msg?.role || "?"}: ${msg?.text ?? ""}`),
    { verbose: true });
};

// Route freshly-generated chats into whichever existing OPEN thread already has
// the same participants (appending their messages there) instead of always
// forking a new one. `built` may itself contain chats that duplicate each other
// (two events in the same turn both reaching out to France), so a match against
// an entry already folded in THIS pass counts too, not just against `storageChats`.
// Every message gets stamped with `stampTime` when it has none of its own —
// including a brand-new chat's own opener. That used to be skipped on the
// theory that a new chat's title/event already dates IT, but nothing reads
// the event for a chat's date: the UI groups/sorts chats by their messages'
// own `time`, so an unstamped opener left the whole chat looking dateless
// (and, sorted as "no date yet", indistinguishable from a chat with no
// messages at all — see chat.jsx's chatGroupLabel).
const foldGeneratedChatsIntoStorage = (storageChats, builtChats, { stampTime = "" } = {}) => {
  let chats = [...storageChats];
  const created = [];
  const stamp = (messages) => (stampTime
    ? messages.map((msg) => (msg.time ? msg : { ...msg, time: stampTime }))
    : messages);

  for (const built of builtChats) {
    const key = chatParticipantKey(built.countries);
    const existingIdx = key ? chats.findIndex((chat) =>
      chat.status !== "closed" && chatParticipantKey(chat.countries) === key) : -1;
    if (existingIdx !== -1) {
      logGeneratedChat(built, "appended to an existing thread");
      chats = chats.map((chat, index) => (index === existingIdx
        ? { ...chat, messages: [...chat.messages, ...stamp(built.messages)] }
        : chat));
      continue;
    }
    const createdIdx = key ? created.findIndex((chat) => chatParticipantKey(chat.countries) === key) : -1;
    if (createdIdx !== -1) {
      logGeneratedChat(built, "merged into another note from the same turn");
      created[createdIdx] = { ...created[createdIdx], messages: [...created[createdIdx].messages, ...stamp(built.messages)] };
      continue;
    }
    logGeneratedChat(built, "opened a new thread");
    created.push({ ...built, messages: stamp(built.messages) });
  }

  return [...created, ...chats];
};

const resolveRegionTransfers = async (containers, world) => {
  const catalog = await loadRegionCatalog().catch(() => []);
  // Without a catalog we cannot tell a good id from a bad one, and dropping real
  // transfers would be worse than the phantom keys — leave the payload alone.
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
  // Owner comparisons are case- and diacritic-insensitive, and the model may
  // name a polity by its era DISPLAY name or an alias ("Second Polish
  // Republic") while ownership is keyed by the owner token ("Poland") —
  // canonicalize through the polity registry before comparing. The same alias
  // map the world state is written through (ownerNames.js), so what counts as
  // "the same polity" cannot drift between resolving a transfer and storing it.
  const ownerAliases = buildOwnerAliasMap(worldState.polityOverrides);
  const canonicalOwnerKey = (token) => regionKey(canonicalOwnerName(token, ownerAliases));
  const ownerKeyOf = (regionId) => {
    // A legacy save can still hold a code here; canonicalise so it keys as the same
    // owner as everything else rather than as a second, phantom power.
    const override = toCountryName(normalizeString(owners[regionId]));
    if (override) return canonicalOwnerKey(override);
    // No override yet (e.g. the FIRST invasion of a war): the region is still held by
    // its base owner, which the catalog carries. Fall back to it — otherwise
    // regionsOwnedBy() is empty for any not-yet-overridden owner, so disambiguation,
    // the containment near-miss, AND buildTransferFeedback's candidate list all fail
    // exactly when the model most needs them (the transfer that STARTS a conflict).
    const region = byId.get(regionId);
    return canonicalOwnerKey(region?.country || toCountryName(region?.countryCode) || "");
  };
  const regionsOwnedBy = (ownerToken) => {
    const key = canonicalOwnerKey(ownerToken);
    if (!key) return [];
    return catalog.filter((region) => ownerKeyOf(region.id) === key);
  };
  // Every owner key in this resolver is a full country NAME (ownerKeyOf canonicalises
  // codes on the way through), so a country can be matched directly.
  // Whole-country transfer: one entry that hands over EVERY region a polity still
  // holds (total conquest, annexation, unification, partition). Regions the winner
  // already owns are skipped so a self-transfer can't blank an owner.
  const expandWholeCountry = (transfer) => {
    const target = toCountryName(normalizeString(transfer?.regionId) || normalizeString(transfer?.regionName));
    const key = canonicalOwnerKey(target);
    if (!key) return [];
    const toKey = canonicalOwnerKey(toCountryName(transfer?.toCode));
    const owned = catalog.filter((region) => {
      const owner = ownerKeyOf(region.id);
      return owner === key && owner !== toKey;
    });
    return owned.map((region) => ({
      ...transfer,
      fromCode: toCountryName(normalizeString(transfer?.fromCode)) || target,
      regionId: region.id,
      regionName: region.name,
      wholeCountry: undefined,
    }));
  };

  const resolve = (transfer) => {
    // A model that did emit a real id keeps working.
    if (byId.has(normalizeString(transfer?.regionId))) return normalizeString(transfer.regionId);
    const fromKey = canonicalOwnerKey(transfer?.fromCode);
    // Otherwise the name may be in either field: the prompt puts it in regionId,
    // the schema also offers regionName.
    for (const candidate of [transfer?.regionId, transfer?.regionName]) {
      const query = regionKey(candidate);
      if (!query) continue;
      const matches = byName.get(query) ?? [];
      if (matches.length === 1) return matches[0].id;
      // Region names repeat across countries ("Santa Cruz", "Georgia"). Prefer the
      // one the transfer says it is taking territory from; a guess would flip a
      // border on the wrong continent, which is worse than changing nothing.
      if (matches.length > 1 && fromKey) {
        const owned = matches.filter((region) => ownerKeyOf(region.id) === fromKey);
        if (owned.length === 1) return owned[0].id;
      }
      // Near-miss within the losing side's own regions: containment either way
      // ("Ostpreussen" for "Ostpreussen-Sud") is safe when it is unique there.
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

  // How many regions an UNFLAGGED transfer may move by being reinterpreted as a
  // polity name. A real whole-country handover is dozens of regions and should say
  // so with wholeCountry:true; a handful is the plausible size of a region/polity
  // name collision, which is the case this fallback exists for.
  const IMPLICIT_WHOLE_COUNTRY_LIMIT = 3;

  const unresolved = [];
  for (const { impacts, path } of containers) {
    const transfers = normalizeArray(impacts?.regionTransfers);
    if (transfers.length === 0) continue;
    const resolved = [];
    for (const transfer of transfers) {
      // An explicit whole-country transfer expands FIRST: "annex Belgium" must move
      // every Belgian region even though a region may share the country's name.
      if (transfer?.wholeCountry === true) {
        const expanded = expandWholeCountry(transfer);
        if (expanded.length) {
          console.info(
            `[ai] ${path}.regionTransfers expanded whole country ` +
              `"${normalizeString(transfer?.regionId)}" -> ${normalizeString(transfer?.toCode)}: ` +
              `${expanded.length} region(s).`,
          );
          resolved.push(...expanded);
          continue;
        }
      }
      const regionId = resolve(transfer);
      if (regionId) {
        transfer.regionId = regionId;
        resolved.push(transfer);
        continue;
      }
      // Not a region the map knows — it MAY be a POLITY the model meant wholesale
      // ("Austria-Hungary is partitioned"). But the prompt also tells the model to
      // put a plain REGION name in regionId whenever it does not know the id, so an
      // unmatched name is the ROUTINE case here, not an exceptional one. Expanding
      // every one of them meant a single fuzzy name could hand over an entire
      // nation's territory in a turn whose events never mentioned it — reported as
      // "captured one region and it reverted all of Ukraine".
      //
      // An explicit wholeCountry:true still expands without limit (handled above);
      // that is the model saying it means a whole nation. Without the flag, accept
      // an expansion only while it is small enough to be a genuine name collision.
      // Anything larger goes to the retry, which names the exact region that failed
      // to match — and if the retry runs out, dropping one transfer is a far smaller
      // failure than silently moving a country.
      const expanded = expandWholeCountry(transfer);
      if (expanded.length && expanded.length <= IMPLICIT_WHOLE_COUNTRY_LIMIT) {
        console.info(
          `[ai] ${path}.regionTransfers treated "${normalizeString(transfer?.regionId)}" as a whole ` +
            `country -> ${normalizeString(transfer?.toCode)}: ${expanded.length} region(s).`,
        );
        resolved.push(...expanded);
        continue;
      }
      if (expanded.length) {
        console.warn(
          `[ai] ${path}.regionTransfers REFUSED to treat "${normalizeString(transfer?.regionId)}" as a ` +
            `whole country -> ${normalizeString(transfer?.toCode)}: it would move ${expanded.length} ` +
            `regions and the transfer did not set wholeCountry. Asking for an exact region id instead.`,
        );
      }
      unresolved.push({
        label: normalizeString(transfer?.regionName) || normalizeString(transfer?.regionId),
        fromCode: normalizeString(transfer?.fromCode),
        path,
        candidates: regionsOwnedBy(transfer?.fromCode),
      });
      console.warn(
        `[ai] ${path}.regionTransfers dropped "${normalizeString(transfer?.regionId)}"` +
          `${transfer?.regionName ? ` (${normalizeString(transfer.regionName)})` : ""} -> ` +
          `${normalizeString(transfer?.toCode)}: no map region matches that id or name.`,
      );
    }
    impacts.regionTransfers = resolved;
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
// What to tell the model when a projectOp names something that is not on the
// board. Same shape as buildTransferFeedback: state the problem, then list the
// real vocabulary, so the single retry has what it needs instead of guessing
// again. Capped because a long board would crowd out the rest of the retry.
const buildProjectFeedback = (operationPath, operation, knownProjects) => {
  const named = normalizeString(operation?.projectId || operation?.id || operation?.name || operation?.project);
  const names = [...new Set(knownProjects.values())].slice(0, 24);
  if (names.length === 0) {
    return `${operationPath} changes "${named}", but no project by that name exists and the board is empty. `
      + `Open it first with {"op":"create","name":"...","summary":"..."}, or drop the op.`;
  }
  return `${operationPath} changes "${named}", which is not on the board. `
    + `Use one of these exact names: ${names.map((name) => `"${name}"`).join(", ")}. `
    + `If this is genuinely a new effort, open it with {"op":"create","name":"...","summary":"..."} instead.`;
};

export const validateGeneratedWorldChanges = async (candidate, world, { strictTransfers = false } = {}) => {
  const strict = strictTransfers;
  const containers = Array.isArray(candidate?.events)
    ? candidate.events.map((event, index) => ({ impacts: event?.impacts, path: `$.events[${index}].impacts` }))
    : [{ impacts: candidate?.impacts, path: "$.impacts" }];
  // Every project an op could legitimately address: what is already on the
  // board, plus anything a create earlier in this same payload opens.
  const knownProjects = new Map();
  for (const project of normalizeArray(world?.projects)) {
    const name = normalizeString(project?.name);
    if (!name) continue;
    knownProjects.set(name.toLowerCase(), name);
    if (normalizeString(project?.id)) knownProjects.set(normalizeString(project.id), name);
  }

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

    // Project ops aimed at nothing. applyProjectOps drops these silently (which
    // is the right runtime behaviour - a phantom project conjured from a typo is
    // worse than a missed update), but silence is exactly what makes the failure
    // invisible: the event narrates a programme advancing and the board never
    // moves. On the strict attempt, hand the model the real board so the retry
    // can use the right name; on the final attempt, drop the op and keep the turn.
    const keptProjectOps = [];
    for (let index = 0; index < normalizeArray(impacts?.projectOps).length; index += 1) {
      const operation = impacts.projectOps[index];
      const operationPath = `${path}.projectOps[${index}]`;
      const op = normalizeString(operation?.op).toLowerCase();

      if (["create", "start", "launch", "open", "add"].includes(op)) {
        const project = operation.project ?? operation;
        if (!normalizeString(project?.name)) {
          if (strict) return `${operationPath} must name the project it is opening.`;
          continue;
        }
        // A create is also how a project first appears, so remember it: a later
        // op in the SAME turn may legitimately reference something opened above.
        knownProjects.set(normalizeString(project.name).toLowerCase(), normalizeString(project.name));
        if (normalizeString(project.id)) knownProjects.set(normalizeString(project.id), normalizeString(project.name));
        keptProjectOps.push(operation);
        continue;
      }

      const target = normalizeString(operation?.projectId || operation?.id).toLowerCase()
        || normalizeString(operation?.name || operation?.project).toLowerCase();
      if (!target) {
        if (strict) return `${operationPath} must carry the name (or id) of the project it changes.`;
        continue;
      }
      if (!knownProjects.has(target)) {
        if (strict) return buildProjectFeedback(operationPath, operation, knownProjects);
        continue;
      }
      keptProjectOps.push(operation);
    }
    if (impacts && Array.isArray(impacts.projectOps)) impacts.projectOps = keptProjectOps;
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
//
// Wrapped in the same beginSimulation/endSimulation busy-lock every jump/
// game-master/catalyst call already uses (see "Simulation busy lock" above) —
// without it, the idle diplomacy drip (on its own real-time timer, entirely
// independent of turns) could read chat.json mid-rollback, then write its own
// read-modify-write back AFTER this function's restore, resurrecting the
// pre-rollback chat history with its own new note landed on top: exactly a
// "rollback didn't undo diplomatic messages, and now there's a message from
// someone" field report. maybeSendIdleDiplomacy already re-checks
// isSimulationBusy() right before its own write specifically to yield to a
// simulation that started after it did — this just makes rollback count.
export const rollBackToSnapshot = async (index = 0) => {
  beginSimulation();
  try {
    const snapshots = await loadRollbackSnapshots();
    const snap = snapshots[index];
    if (!snap) return null;
    const s = snap.state ?? {};
    await Promise.all([
      // writeGameData rather than a raw writeJson: the snapshot was captured a
      // whole turn ago and carries that turn's unit-system flag, and a setting
      // must not roll back with the turn. See writeGameData in gameState.js.
      writeGameData(s.game ?? {}),
      writeJson(JSON_URLS.world, s.world ?? {}, { pretty: true }),
      writeJson(JSON_URLS.events, s.events ?? [], { pretty: true }),
      writeJson(JSON_URLS.actions, s.actions ?? [], { pretty: true }),
      writeJson(JSON_URLS.chat, s.chat ?? [], { pretty: true }),
      writeJson(JSON_URLS.colors, s.colors ?? {}, { pretty: true }),
    ]);
    await writeJson(JSON_URLS.snapshots, snapshots.slice(index + 1));
    const bundle = await readGameStateBundle({ force: true });
    // A rollback is the one event that legitimately moves the clock BACKWARDS.
    // The timeline's 5s poll refuses any read older than what it already shows
    // (its guard against a stale read reverting a fresh turn), so without this
    // announcement it discarded every read of the restored state and the panel
    // stayed pinned on the undone turn until the app restarted — which is what
    // made a cheats-menu rollback look like it had done nothing. Same convention
    // as "oh:turn-complete"; fired from here so BOTH callers (the cheats menu and
    // the timeline's own Undo) are covered by the one dispatch.
    if (typeof window !== "undefined") window.dispatchEvent(new Event("oh:rolled-back"));
    return { bundle, round: snap.round, remaining: snapshots.length - (index + 1) };
  } finally {
    endSimulation();
  }
};

// Sends a message the Advisor drafted (see ADVISOR_MESSAGE_DRAFT_DIRECTIVE in
// main.jsx) straight into the diplomatic channel with `countryName`, exactly
// as if the player had typed it into the Diplomacy panel and waited for a
// reply — used by advisor.jsx's "Send message to <country>" button so a
// drafted message never has to be manually copy-pasted. Reuses the same
// participant-set matching foldGeneratedChatsIntoStorage applies to
// AI-initiated notes, so this lands in an existing 1-on-1 thread with that
// country instead of forking a duplicate one, and takes the same busy-lock
// every other chat.json writer above takes so it can't race the idle
// diplomacy drip or a jump/rollback in flight.
export const sendAdvisorDraftedMessage = async ({ countryName, text }) => {
  const trimmedText = normalizeString(text);
  if (!trimmedText) throw new Error("There's no message text to send.");

  beginSimulation();
  try {
    const bundle = await readGameStateBundle({ force: true });
    const playerName = normalizeString(bundle.game?.country);
    if (!playerName) throw new Error("No active game to send a message in.");

    const [recipient] = await resolveInvitees([countryName], bundle.world);
    if (!recipient) throw new Error(`Could not identify "${countryName}" among the known polities.`);
    if (regionKey(recipient.name) === regionKey(playerName)) {
      throw new Error("Can't send a diplomatic message to your own polity.");
    }

    const chats = normalizeChats(await readChatsState({ force: true }));
    const recipientKey = chatParticipantKey([recipient]);
    const existing = chats.find((chat) =>
      chat.status !== "closed" && chatParticipantKey(chat.countries) === recipientKey);
    const priorMessages = existing?.messages ?? [];

    const gameDate = normalizeString(bundle.game?.gameDate);
    const { reply, reaction } = await sendDiplomaticMessageOnceOff({
      playerMessage: trimmedText,
      speakingAs: recipient.name,
      participantNames: [playerName, recipient.name],
      playerCountry: playerName,
      priorMessages,
    });

    const userMessage = {
      role: "user",
      speaker: playerName,
      text: trimmedText,
      time: gameDate,
      ...(reaction ? { reactions: { [recipient.name]: { emoji: reaction, code: recipient.code || "" } } } : {}),
    };
    const leaderMessage = { role: "leader", speaker: recipient.name, code: recipient.code || "", text: reply, time: gameDate };

    const built = normalizeChatEntry({
      countries: [recipient],
      messages: [userMessage, leaderMessage],
      source: "advisor",
      status: "open",
      title: existing?.title || `Chat with ${recipient.name}`,
    });
    if (!built) throw new Error("Could not build the message.");

    const nextChats = foldGeneratedChatsIntoStorage(chats, [built], {});
    await writeChatsState(nextChats);

    const finalChat = nextChats.find((chat) => chatParticipantKey(chat.countries) === recipientKey);
    return { chat: finalChat, reply };
  } finally {
    endSimulation();
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
  const nextEvents = [...priorEvents, ...freshEvents];
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
  // write at the end folds these onto whatever is actually stored by then (see
  // foldGeneratedChatsIntoStorage) rather than putting the stale snapshot back.
  const generatedChats = [];

  // Which unit system this session is running, pinned at startup.
  const betaUnits = isBetaUnits();

  const { colors: nextColors, world: impactedWorld } = applyEventImpactsToWorld({
    colors: baseColors,
    events: freshEvents,
    // Give every unit op a travel budget of the days between the previous event
    // and its own, so a move op advances a formation as far as it could actually
    // have got rather than teleporting it. An over-long move becomes a partial
    // advance plus a standing order the engine keeps working on later turns.
    //
    // Both of these are the beta unit system. In the classic system a unit op
    // lands where the model put it and no standing order is minted, which is
    // what motion: null plus betaEngine: false mean.
    motion: betaUnits ? { originDate: baseGame.gameDate, round: nextGame.round, tick: 0 } : null,
    betaEngine: betaUnits,
    // Stamps world.projects[].updatedRound, which is what lets the board say a
    // programme has sat untouched for three rounds. The staged reveal in time.jsx
    // deliberately omits it: replaying impacts for display must not age anything.
    round: nextGame.round,
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
          eventIds: freshEvents.map((event) => event.id),
          fallbackReason: normalizeString(result.generation?.fallbackReason),
          fromDate: baseGame.gameDate,
          mode: normalizeString(result.mode) || "jump",
          plannedActions: plannedActionSnapshot,
          // The raw model response that failed to parse (runJsonTask), so the
          // fallback warning's "Copy debugging message" button (time.jsx) has
          // something to copy even after a reload — only ever non-empty on a
          // fallback turn; a normal AI turn carries nothing here.
          rawResponse: normalizeString(result.generation?.rawResponse),
          round: nextGame.round,
          summary: normalizeString(result.summary),
          source: result.generation?.source || "ai",
          toDate: nextGame.gameDate,
        },
        ...normalizeWorldState(baseWorld).simulationHistory,
      ].slice(0, 12),
    },
  });
  // Advance every standing order the model did NOT touch across the whole jump,
  // and drift the patrols. This is what keeps a fleet crossing an ocean moving
  // turn after turn, and a squadron visibly working its station, with none of it
  // having to come back from the model. Units the model DID move are skipped:
  // they already stepped once per event against that event's own budget, and
  // advancing them again here would move them twice for the same elapsed time.
  //
  // Both this and the unit-volume cap are beta-only: the classic system has no
  // standing orders to advance and no cap on how many formations the world may
  // hold, so it leaves the impacted world exactly as the events left it.
  const movedThisTurn = freshEvents.flatMap((event) =>
    normalizeArray(event.impacts?.unitOps).map((op) => op.unitId || op.unit?.id).filter(Boolean));
  const worldWithImpacts = betaUnits
    ? enforceUnitVolume(
      advanceStandingOrders(
        // Rounds may have passed under the classic system since these orders were
        // issued, which would leave every dormant patrol already expired. Give
        // them the rest of their life from here before advancing anything.
        resumeStandingOrders(impactedWorld, {
          round: nextGame.round,
          previousSystem: normalizeWorldState(baseWorld).unitSystem,
        }),
        {
          fromDate: baseGame.gameDate,
          toDate: nextGame.gameDate,
          round: nextGame.round,
          skipUnitIds: movedThisTurn,
        },
      ),
      { playerCode: baseGame.country },
    )
    : impactedWorld;
  let nextWorld = worldWithImpacts;

  for (const event of freshEvents) {
    for (const createdChat of event.impacts.createdChats) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, worldWithImpacts, {
        fallbackTitle: event.title,
        playerName: baseGame.country,
      });
      if (nextChat) { nextChats.unshift(nextChat); generatedChats.push(nextChat); }
    }
  }

  // Unprompted outreach: polities reaching out on their own initiative during
  // the simulated period, not tied to any event (treaty feelers, summit
  // invitations). Same chat machinery, no linked event.
  for (const chatLike of normalizeArray(result.outreach)) {
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", worldWithImpacts, {
      playerName: baseGame.country,
    });
    if (nextChat) { nextChats.unshift(nextChat); generatedChats.push(nextChat); }
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
  //
  // Folding (not prepending) matters just as much as the re-read: a country that
  // already has an open thread with the player must have its new note land THERE,
  // not beside it in a duplicate chat opened from scratch every time it speaks.
  let chatsToWrite;
  try {
    chatsToWrite = foldGeneratedChatsIntoStorage(
      normalizeChats(await readChatsState({ force: true })),
      generatedChats,
      { stampTime: nextGame.gameDate },
    );
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

export const refinePlayerAction = async (rawInput, { persist = true, signal } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle, { actionInput: rawInput });
  const { payload } = await runJsonTask("descriptionToAction", {
    fallback: () => fallbackDescriptionToAction(rawInput, bundle),
    // Improve can be stopped mid-generation, exactly like a timeline jump.
    // runJsonTask already links an external signal to the controller it hands
    // the provider, so on a local model the next token write fails and inference
    // stops rather than running to completion unheard.
    signal,
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

export const simulateTimelineJump = async ({ days, mode = "jump", onProgress, signal } = {}) => {
  // Starting a fresh turn abandons any turn still held on the board. Its state
  // was captured against a world snapshot this one is about to re-read, so
  // applying it later would write a turn built on stale ground.
  discardPendingProjectsJump();
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
  // Guarantee at least one event per queued action, so each planned action has a
  // slot to resolve into (bounded so a huge queue can't demand absurd counts).
  const plannedActionCount = normalizeActions(bundle.actions).filter((action) => action.status === "planned").length;

  // Long skips are generated in SEGMENTS and merged into the one round the player
  // asked for — see jumpSegments.js for why, and for the merge rules. Auto jumps
  // never split: they stop at the next notable moment, so there is no span to
  // divide up front. Short enough, or the setting off, is a single call worded and
  // validated exactly as it always was.
  const segmentDays = (getMapSettingDefaultOn(MAP_SETTING_KEYS.chunkLongJumps)
    && mode !== "auto"
    && dateStep >= SEGMENTED_JUMP_MIN_DAYS)
    ? planJumpSegments(dateStep)
    : [dateStep];
  const segmentCount = segmentDays.length;
  const plannedActionShare = Math.ceil(plannedActionCount / segmentCount);
  if (segmentCount > 1) {
    logDebugEvent("turn", `Timeline jump split into ${segmentCount} segments.`, {
      dateStep,
      segmentDays,
      round: bundle.game.round,
    });
  }

  const segmentPayloads = [];
  const generatedSoFar = [];
  let generation = { source: "ai", fallbackReason: "" };
  let segmentOrigin = originDate;

  // A segmented jump takes as long as the segments put together, so the spinner
  // has to say which one is running or a correct turn looks like a hung one.
  // Wrapped because a throwing UI callback must never cost the player a turn —
  // the same rule the streaming onChunk callbacks follow.
  const reportProgress = (segmentIndex) => {
    if (segmentCount <= 1 || typeof onProgress !== "function") return;
    try {
      onProgress({ segment: segmentIndex + 1, segmentCount });
    } catch (error) {
      console.warn("[ai] a jump progress callback threw; continuing.", error);
    }
  };

  try {
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const isFinalSegment = segmentIndex === segmentCount - 1;
    const spanDays = segmentDays[segmentIndex];
    // The final segment always lands exactly on the requested date, so rounding
    // across segments can never leave the round short of where it was asked to go.
    const segmentTarget = isFinalSegment
      ? targetDate
      : (addIsoDays(segmentOrigin, spanDays) || targetDate);
    const [minEvents, maxEvents] = segmentCount > 1
      ? segmentEventRange(spanDays, plannedActionShare)
      : segmentEventRange(safeDays, plannedActionCount);
    // targetDate reaches only these two variables (promptContext.js), so the
    // expensive context — region catalog, city seed, territory index — is built
    // once for the whole jump and only the dates move per segment.
    const segmentVariables = segmentCount > 1
      ? { ...variables, targetDate: segmentTarget, targetDateReadable: formatDateReadable(segmentTarget) }
      : variables;
    reportProgress(segmentIndex);

    const { generation: segmentGeneration, payload } = await runJsonTask(mode === "auto" ? "autoJumpForward" : "jumpForward", {
      // Only a single-call jump falls back on its own. A failing SEGMENT throws
      // instead, so the catch below can fall back once for the whole period: half
      // a round of real events followed by half a round of canned ones would be a
      // turn that half-landed, which is worse than one that plainly did not (see
      // jsonSalvage.js).
      ...(segmentCount > 1
        ? {}
        : { fallback: () => fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate }) }),
      signal,
      // The jump IS the game, and its deadline is runJsonTask's for every task:
      // silence, not elapsed time, so a long segment is never mistaken for a
      // stalled one (and a segmented jump gets that window per segment, since it
      // is per request). Cancel works either way.
      userMessage: buildSegmentInstruction({
        mode,
        segmentIndex,
        segmentCount,
        minEvents,
        maxEvents,
        durationLabel: formatDurationLabel(safeDays),
        segmentDurationLabel: formatDurationLabel(spanDays),
        originDate,
        targetDate,
        segmentTargetDate: segmentTarget,
        priorEvents: generatedSoFar,
      }),
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
        // Each segment is checked against ITS OWN span, so an event dated outside
        // the segment is caught while the model can still fix it rather than at the
        // end of the whole round.
        const dateError = validateTimelineDates({
          candidate,
          mode,
          originDate: segmentOrigin,
          targetDate: segmentTarget,
          requireAdvance: dateStep >= 1,
        });
        if (dateError) {
          if (strict) return dateError;
          clampTimelineDates(candidate, { mode, originDate: segmentOrigin, targetDate: segmentTarget });
        }
        return await validateGeneratedWorldChanges(candidate, bundle.world, { strictTransfers: strict });
      },
      variables: segmentVariables,
    });

    segmentPayloads.push(payload);
    generatedSoFar.push(...normalizeArray(payload?.events));
    generation = segmentGeneration;
    // Where the next segment picks up. An auto jump can stop short of its span on
    // purpose, so follow the payload rather than the calendar.
    segmentOrigin = normalizeString(payload?.stopDate) || segmentTarget;
  }
  } catch (error) {
    // Only a SEGMENTED jump reaches here — a single call falls back inside
    // runJsonTask and never throws. A deliberate cancel must still cancel.
    if (signal?.aborted || error?.name === "AbortError") throw error;
    const reason = normalizeString(error?.message) || `AI task "jumpForward" failed.`;
    console.warn(`[ai] a jump segment failed (${reason}) — falling back for the whole period.`);
    logDebugEvent("warn", "[turn] A jump segment failed; the whole jump falls back.", {
      completedSegments: segmentPayloads.length,
      segmentCount,
      reason,
    });
    segmentPayloads.length = 0;
    segmentPayloads.push(await fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate }));
    generation = {
      source: "fallback",
      fallbackReason: reason,
      taskKey: mode === "auto" ? "autoJumpForward" : "jumpForward",
    };
  }

  // One round out of every segment. applySimulationResult advances the round
  // exactly once, and the dedupeGeneratedEvents pass inside it already collapses
  // repeats WITHIN the batch as well as against the existing log, so a later
  // segment restating an earlier one cannot reach the timeline.
  const merged = mergeSegmentPayloads(segmentPayloads, { targetDate });

  // The board, in its own call, once for the whole round — after the segments
  // merge so it sees the complete story, and before the world is written so its
  // ops ride along inside the same single write and rollback snapshot.
  //
  const result = {
    catalyst: merged.catalyst,
    clearActions: merged.clearActions,
    events: merged.events,
    mode,
    outreach: merged.diplomaticOutreach,
    stopDate: merged.stopDate,
    summary: merged.summary,
    generation,
  };
  const applyArgs = {
    baseActions: bundle.actions,
    baseChats: bundle.chats,
    baseColors,
    baseEvents: bundle.events,
    baseGame: bundle.game,
    baseWorld: bundle.world,
    result,
  };

  // The board, in its own call, once for the whole round — after the segments
  // merge so it sees the complete story, and BEFORE anything is written so its
  // ops ride in on the events that caused them.
  //
  // On failure the turn is HELD rather than applied: see pendingProjectsJump for
  // why the retry has to happen on this side of the write.
  try {
    const { ops, skipped } = await generateProjectOps(bundle, merged.events, { signal });
    if (!skipped && ops.length) {
      const attached = attachProjectOpsToEvents(merged.events, ops);
      logDebugEvent("turn", `Projects board updated: ${attached} op(s).`, undefined, { verbose: true });
    }
  } catch (error) {
    // A deliberate cancel is the player's and aborts the turn like any other.
    if (error?.name === "AbortError") throw error;
    pendingProjectsJump = { applyArgs, bundle, events: merged.events };
    logDebugEvent("turn", "Turn HELD: the board did not update, so nothing was written.", error);
    throw projectsHeldError(error);
  }

  return applySimulationResult(applyArgs);
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
// How often the pulse RUNS at all. Higher than the chat chance because the call
// now also moves the world's forces a little, and the map benefits from breathing
// more often than the inbox does. Splitting the two off one roll keeps the chat
// cadence the player already has exactly as it was while still being ONE request.
const IDLE_PULSE_CHANCE = 1 / 4;
// A pulse's ops get no travel budget on purpose: no game time has passed, so a
// unit may be re-postured or re-ordered, but nothing marches.
const IDLE_PULSE_ELAPSED_DAYS = 0;
let idleDiplomacyInFlight = false;
// Narrower than idleDiplomacyInFlight above: true only for the half of a pulse
// that actually asks whether a polity would send a note (allowChat). A
// movement-only pulse sets the in-flight guard but not this.
let idleChatPollInFlight = false;

// Whether the model is right now being asked whether a country would reach out
// unprompted. Deliberately NOT true for a jump/auto-jump, a game-master command,
// or an advisor exchange: those take the same busy lock and MIGHT end up emitting
// createdChats/diplomaticOutreach, but the indicator used to fire on every one of
// them, so simulating a turn or talking to the advisor lit up the chat button for
// the whole run. "Might produce a chat eventually" is not worth an indicator —
// only a poll whose entire purpose is that question gets one.
export const isChatGenerationLikely = () => idleChatPollInFlight;

// Apply a pulse's unit ops to the LIVE world. Routed through
// applyEventImpactsToWorld with a synthetic event rather than a hand-rolled
// applier, so the detection gate, the owner-name resolution and the patrol-order
// minting all behave exactly as they do on a real turn.
const applyIdlePulseUnitOps = async (bundle, unitOps) => {
  // Deliberately NOT bundle.world: a jump may have committed while the model was
  // thinking, and writing a world built on the stale snapshot would undo it.
  const freshWorld = await readWorldState({ force: true });
  const tick = (Number(freshWorld.idlePulseTick) || 0) + 1;
  const gameDate = normalizeString(bundle.game?.gameDate);
  const round = Number(bundle.game?.round) || 0;
  const betaUnits = isBetaUnits();

  const { world: impacted } = applyEventImpactsToWorld({
    colors: {},
    events: [{ date: gameDate, title: "", description: "", impacts: { unitOps } }],
    world: freshWorld,
    motion: betaUnits ? { originDate: gameDate, round, tick } : null,
    betaEngine: betaUnits,
  });
  // The classic system has nothing to drift and no cap to enforce — the pulse's
  // ops are the whole of its effect.
  if (!betaUnits) return { ...impacted, idlePulseTick: tick };
  // fromDate === toDate, so no unit travels: the pulse only re-posts standing
  // orders and drifts patrols, which is right when no game time has passed.
  const drifted = advanceStandingOrders(impacted, {
    fromDate: gameDate,
    toDate: gameDate,
    round,
    tick,
  });
  return enforceUnitVolume(
    { ...drifted, idlePulseTick: tick },
    { playerCode: normalizeString(bundle.game?.country) },
  );
};

// One short intelligence report in the event feed, so a build-up the player can
// see on the map also tells them WHY it is there. Only ever written when the
// model judged the movement near enough for their services to have seen it.
const appendSightingEvent = async (bundle, sighting, unitOps) => {
  const events = await readEventsState({ force: true });
  const next = normalizeEvents([
    ...events,
    {
      date: normalizeString(bundle.game?.gameDate),
      title: normalizeString(sighting.title),
      description: normalizeString(sighting.description),
      importance: "minor",
      kind: "intel",
      playerRelated: true,
      notable: false,
      // The event carries the very ops it is reporting. They have already been
      // applied to the world above and nothing re-applies an event's impacts from
      // the log, so this is not a second application — it is what lets the
      // existing event camera (eventFocus.js's impactPointBounds) fly to the
      // sighting instead of guessing from the prose.
      impacts: { unitOps },
    },
  ]);
  await writeEventsState(next);
};

export const maybeSendIdleDiplomacy = async ({ chance = IDLE_PULSE_CHANCE } = {}) => {
  if (idleDiplomacyInFlight || isSimulationBusy()) return null;
  const roll = Math.random();
  if (roll >= chance) return null;
  // One call, two rates: the chat half keeps the cadence the player already has,
  // while the movement half runs on every pulse.
  const allowChat = roll < Math.min(chance, IDLE_DIPLOMACY_CHANCE);
  idleDiplomacyInFlight = true;
  idleChatPollInFlight = allowChat;
  try {
    const bundle = await readGameStateBundle({ force: true });
    if (!normalizeString(bundle.game?.country)) return null; // no active game
    const variables = {
      ...(await buildTemplateVariables(bundle)),
      idleChatAllowed: allowChat ? "yes" : "no",
    };
    const { payload } = await runJsonTask("idleDiplomacy", {
      userMessage: allowChat
        ? "A quiet moment between rounds. Decide whether any single polity would send the player a short diplomatic note right now, and whether any forces would visibly move. Return JSON only."
        : "A quiet moment between rounds. Decide whether any forces would visibly move right now. Return chat as null. Return JSON only.",
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
    if (!payload) return null;

    // --- movement ---------------------------------------------------------
    const unitOps = normalizeArray(payload.unitOps);
    if (unitOps.length > 0 && !isSimulationBusy()) {
      try {
        const nextWorld = await applyIdlePulseUnitOps(bundle, unitOps);
        // Re-check immediately before the write, exactly as the chat half does:
        // a jump that started while we were applying owns the world now.
        if (!isSimulationBusy()) {
          await writeWorldState(nextWorld);
          if (payload.sighting && !isSimulationBusy()) {
            await appendSightingEvent(bundle, payload.sighting, unitOps);
          }
        }
      } catch (error) {
        // Movement is a bonus; never let it cost the player a diplomatic note.
        console.warn("[ai] idle pulse could not apply unit movement:", error);
      }
    }

    // --- diplomacy --------------------------------------------------------
    if (!allowChat || !payload.chat) return null;
    // A jump may have started while the model was thinking; its state bundle
    // predates our write, so drop the note rather than race the save.
    if (isSimulationBusy()) return null;
    const built = await buildGeneratedChat({ ...payload.chat, source: "outreach" }, "", bundle.world, {
      playerName: bundle.game.country,
    });
    if (!built) return null;
    const chats = normalizeChats(await readChatsState({ force: true }));
    // A note from a country the player already has an open thread with (1:1 or a
    // standing group) lands in that thread; only a genuinely new set of
    // participants opens a fresh chat.
    const nextChats = foldGeneratedChatsIntoStorage(chats, [built], { stampTime: normalizeString(bundle.game?.gameDate) });
    if (isSimulationBusy()) return null;
    await writeChatsState(nextChats);
    return built;
  } catch {
    return null; // silence is always the safe outcome
  } finally {
    idleDiplomacyInFlight = false;
    idleChatPollInFlight = false;
  }
};

// Clearer name for what this now does. The old export stays because main.jsx
// imports it dynamically and the docs reference it by name.
export const maybeRunIdlePulse = maybeSendIdleDiplomacy;
