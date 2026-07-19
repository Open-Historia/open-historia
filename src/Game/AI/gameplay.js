/*! Open Historia — portions (briefing dossiers + timeout/fallback hardening) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { callAI } from "./main.jsx";
import { normalizePromptPack } from "./gameplayPrompts.js";
import { getGameplayTool, validateGameplayPayload } from "./gameplaySchemas.js";
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

const validateTimelineDates = ({ candidate, mode, originDate, targetDate }) => {
  const stopDate = normalizeString(candidate?.stopDate);
  if (!parseIsoDate(originDate)) {
    const eventDates = normalizeArray(candidate?.events).map((event) => normalizeString(event?.date));
    const outputDates = [stopDate, ...eventDates];
    const malformedIsoIndex = outputDates.findIndex((date) => /^\d{4}-/.test(date) && !parseIsoDate(date));
    if (malformedIsoIndex >= 0) {
      const path = malformedIsoIndex === 0 ? "$.stopDate" : `$.events[${malformedIsoIndex - 1}].date`;
      return `${path} must be a real Gregorian date when using YYYY-MM-DD format.`;
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
    if (eventDate <= originDate || eventDate > stopDate) {
      return `$.events[${index}].date must be after ${originDate} and no later than ${stopDate}.`;
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
  const dayAfterOrigin = addIsoDays(originDate, 1) || targetDate;
  let stopDate = normalizeString(candidate?.stopDate);
  if (mode === "auto") {
    if (!parseIsoDate(stopDate) || stopDate <= originDate || stopDate > targetDate) stopDate = targetDate;
  } else {
    stopDate = targetDate;
  }
  candidate.stopDate = stopDate;
  const floor = dayAfterOrigin > stopDate ? stopDate : dayAfterOrigin;
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
const runJsonTask = async (taskKey, {
  fallback,
  signal,
  timeoutMs = 120000,
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

  // Reputation context: how the world currently regards the player, and how the
  // model should let it bias behaviour and evolve it via polityChanges.
  if (["actions", "jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor"].includes(taskKey)) {
    const reputationContext = normalizeString(variables.playerPolityReputationContext);
    if (reputationContext) {
      systemPrompt = `${systemPrompt}\n\n[International Reputation]\n${reputationContext}\nLow international reputation should reduce trade, trust, and coalition support, and should make nearby rivals more likely to sanction, isolate, or form balancing alliances. High reputation should improve access, trust, and coalition-building. When events this turn change how the world regards a polity, record the new value by including a "reputation" field (an integer 0-100) on that polity's impacts.polityChanges entry: aggression, broken treaties, and atrocities lower it; cooperation, aid, and honored commitments raise it. Only include reputation when it actually changes.`;
    }
  }

  const controller = new AbortController();
  // Let an external signal (the player pressing Cancel) abort the in-flight AI
  // call too — the abort propagates through callAI to the server relay.
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
        deadline,
        maxTokens: taskKey === "jumpForward" || taskKey === "autoJumpForward" ? 16384 : 8192,
        signal: controller.signal,
        tool,
      });
      const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
      const parsed = response?.toolInput ?? extractJsonPayload(rawText);
      let validation = parsed
        ? validateGameplayPayload(taskKey, parsed)
        : { valid: false, error: "Response did not contain parseable JSON or tool arguments." };
      if (validation.valid && validatePayload) {
        const taskError = normalizeString(await validatePayload(parsed));
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

const consolidateHistoryBatch = async (bundle, events, chats) => {
  const variables = await buildTemplateVariables(bundle, {
    chatsToConsolidate: buildDetailedChatHistoryText(chats, { limit: chats.length || 1, messageLimit: 100 }),
    eventsToConsolidate: buildEventHistoryText(events, { limit: events.length || 1 }),
  });
  const { generation, payload } = await runJsonTask("eventConsolidator", {
    fallback: () => ({
      summary: [
        events.map((event) => `${event.date || "undated"} ${event.title}: ${event.description}`).join("; "),
        buildChatSummaryText(chats, { limit: chats.length || 1 }),
      ].filter(Boolean).join("\n"),
    }),
    timeoutMs: 60000,
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

  const { generation, summary } = await consolidateHistoryBatch(bundle, eventsToConsolidate, closedChats);
  if (!summary) return world;
  const throughEvent = eventsToConsolidate.at(-1);

  return normalizeWorldState({
    ...world,
    consolidatedHistory: [
      ...world.consolidatedHistory,
      {
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

const buildGeneratedChat = async (chatLike, linkEventId, world) => {
  const countriesInput = Array.isArray(chatLike?.countries) ? chatLike.countries : [];
  const countries = await resolveInvitees(countriesInput, world);
  if (countries.length === 0) return null;

  return normalizeChatEntry({
    countries,
    id: chatLike?.id,
    linkedEventId: linkEventId,
    messages:
      chatLike?.messages && Array.isArray(chatLike.messages)
        ? chatLike.messages
        : chatLike?.openingMessage
        ? [
            {
              code: countries.find((country) => country.name === chatLike.speaker)?.code || countries[0]?.code || "",
              role: "leader",
              speaker: chatLike.speaker || countries[0]?.name || "",
              text: chatLike.openingMessage,
              time: "",
            },
          ]
        : [],
    source: normalizeString(chatLike?.source) || "invitation",
    status: "open",
    title: chatLike?.title || `Chat with ${countries.map((country) => country.name).join(", ")}`,
  });
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
  // canonicalize through the polity registry before comparing.
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
  const canonicalOwnerKey = (token) => {
    const key = regionKey(token);
    return ownerAlias.get(key) ?? key;
  };
  const ownerKeyOf = (regionId) => canonicalOwnerKey(owners[regionId] ?? "");
  const regionsOwnedBy = (ownerToken) => {
    const key = canonicalOwnerKey(ownerToken);
    if (!key) return [];
    return catalog.filter((region) => ownerKeyOf(region.id) === key);
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

  const unresolved = [];
  for (const { impacts, path } of containers) {
    const transfers = normalizeArray(impacts?.regionTransfers);
    if (transfers.length === 0) continue;
    const resolved = [];
    for (const transfer of transfers) {
      const regionId = resolve(transfer);
      if (regionId) {
        transfer.regionId = regionId;
        resolved.push(transfer);
        continue;
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
// vocabulary to fix its own answer. Callers set it on the FIRST attempt only —
// the second answer must never be rejected into the canned fallback over a name.
export const validateGeneratedWorldChanges = async (candidate, world, { strictTransfers = false } = {}) => {
  const containers = Array.isArray(candidate?.events)
    ? candidate.events.map((event, index) => ({ impacts: event?.impacts, path: `$.events[${index}].impacts` }))
    : [{ impacts: candidate?.impacts, path: "$.impacts" }];
  const unresolvedTransfers = await resolveRegionTransfers(containers, world);
  if (strictTransfers && unresolvedTransfers.length > 0) {
    return buildTransferFeedback(unresolvedTransfers);
  }
  const unitIds = new Set(normalizeWorldState(world).units.map((unit) => normalizeString(unit.id)).filter(Boolean));
  const generatedPolities = [];

  for (const { impacts, path } of containers) {
    generatedPolities.push(...normalizeArray(impacts?.polityChanges));
    for (let index = 0; index < normalizeArray(impacts?.createdChats).length; index += 1) {
      const countries = await resolveInvitees(impacts.createdChats[index]?.countries, world, generatedPolities);
      if (countries.length === 0) {
        return `${path}.createdChats[${index}].countries must contain at least one known polity.`;
      }
    }

    for (let index = 0; index < normalizeArray(impacts?.unitOps).length; index += 1) {
      const operation = impacts.unitOps[index];
      const operationPath = `${path}.unitOps[${index}]`;
      if (operation.op === "spawn") {
        if (!normalizeString(operation.unit?.name) || !normalizeString(operation.unit?.ownerCode)) {
          return `${operationPath}.unit must have nonblank name and ownerCode values.`;
        }
        const spawnedId = normalizeString(operation.unit?.id);
        if (spawnedId && unitIds.has(spawnedId)) return `${operationPath}.unit.id duplicates an existing unit.`;
        if (spawnedId) unitIds.add(spawnedId);
        continue;
      }

      const unitId = normalizeString(operation.unitId);
      if (!unitId) return `${operationPath}.unitId must not be blank.`;
      if (!unitIds.has(unitId)) return `${operationPath}.unitId does not identify an existing unit.`;
      if (operation.op === "remove" || (operation.op === "strength" && operation.strength === 0)) unitIds.delete(unitId);
    }

    // Marker ops that would be silently dropped by normalization instead fail
    // here, so the retry tells the model what was missing.
    for (let index = 0; index < normalizeArray(impacts?.markerOps).length; index += 1) {
      const operation = impacts.markerOps[index];
      const operationPath = `${path}.markerOps[${index}]`;
      const op = normalizeString(operation?.op).toLowerCase();
      if (op === "build" || op === "found") {
        const marker = operation.marker ?? operation;
        if (!normalizeString(marker?.name)) return `${operationPath}.marker.name must not be blank.`;
        if (!Number.isFinite(Number(marker?.lng)) || !Number.isFinite(Number(marker?.lat))) {
          return `${operationPath}.marker must carry numeric lng and lat coordinates.`;
        }
      } else if (op === "remove" || op === "destroy") {
        if (!normalizeString(operation?.name) && !normalizeString(operation?.markerId)) {
          return `${operationPath} must carry the name (or markerId) of the structure to remove.`;
        }
      }
    }
  }

  // Unprompted outreach chats (top-level, not tied to an event) need real
  // participants exactly like createdChats do.
  for (let index = 0; index < normalizeArray(candidate?.diplomaticOutreach).length; index += 1) {
    const countries = await resolveInvitees(
      candidate.diplomaticOutreach[index]?.countries,
      world,
      generatedPolities,
    );
    if (countries.length === 0) {
      return `$.diplomaticOutreach[${index}].countries must contain at least one known polity.`;
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
  const nextEvents = [...normalizeEvents(baseEvents), ...generatedEvents];
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

  const { colors: nextColors, world: worldWithImpacts } = applyEventImpactsToWorld({
    colors: baseColors,
    events: generatedEvents,
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
          eventIds: generatedEvents.map((event) => event.id),
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

  for (const event of generatedEvents) {
    for (const createdChat of event.impacts.createdChats) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, worldWithImpacts);
      if (nextChat) nextChats.unshift(nextChat);
    }
  }

  // Unprompted outreach: polities reaching out on their own initiative during
  // the simulated period, not tied to any event (treaty feelers, summit
  // invitations). Same chat machinery, no linked event.
  for (const chatLike of normalizeArray(result.outreach)) {
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", worldWithImpacts);
    if (nextChat) nextChats.unshift(nextChat);
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

  await Promise.all([
    writeActionsState(nextActions),
    writeChatsState(nextChats),
    writeEventsState(nextEvents),
    writeGameData(nextGame),
    writeJson(JSON_URLS.colors, nextColors, { pretty: true }),
    writeWorldState(nextWorld),
  ]);

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
    chats: nextChats,
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
  let validationAttempts = 0;
  const { generation, payload } = await runJsonTask(mode === "auto" ? "autoJumpForward" : "jumpForward", {
    fallback: () => fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate }),
    signal,
    // The jump IS the game — let slow (local/reasoning) models finish instead
    // of silently swapping in the canned fallback. Five minutes covers even a
    // large reasoning model writing 37 events; the bound only exists so a
    // genuinely hung request can't spin forever (Cancel works throughout).
    // The settings toggle removes the bound entirely: 0 disables the deadline
    // in runJsonTask, so only a real error (or Cancel) can end the wait.
    timeoutMs: getMapSetting(MAP_SETTING_KEYS.noAiTimeLimit) ? 0 : 300000,
    userMessage:
      mode === "auto"
        ? "Simulate an auto-jump and stop at the next notable or player-relevant event. Return JSON only. " +
          "Scale the events array to the time actually covered before your stop point: roughly 1-2 events per week, " +
          "5-7 per month, 10-13 per quarter, up to 29-37 for a full year — spread their dates across the covered period."
        : `Simulate a standard jump forward to the requested target date. Return JSON only. The "events" array must ` +
          `contain between ${minEvents} and ${maxEvents} events (this jump covers ${durationLabel}), with their dates ` +
           `spread across the skipped period.`,
    validatePayload: async (candidate) => {
      validationAttempts += 1;
      // Shape-of-story problems (event count, stray dates) are STRICT on the
      // first attempt — the model gets the exact error and usually fixes its
      // own answer — and SALVAGED on the second: a finished generation must
      // never lose to the canned fallback over its date stamps or an extra
      // event. Only real errors reach the fallback now.
      const strict = validationAttempts === 1;
      const eventCount = normalizeArray(candidate?.events).length;
      if (strict && mode !== "auto" && (eventCount < minEvents || eventCount > maxEvents)) {
        return `$.events must contain between ${minEvents} and ${maxEvents} events; received ${eventCount}.`;
      }
      const dateError = validateTimelineDates({ candidate, mode, originDate, targetDate });
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
  let gmValidationAttempts = 0;
  const { generation, payload } = await runJsonTask("gameMaster", {
    fallback: () => ({
      impacts: {
        polityChanges: [],
        regionTransfers: [],
      },
      summary: "No deterministic GM fallback changes were inferred from the request.",
    }),
    userMessage: "Apply the GM request as JSON only.",
    validatePayload: (candidate) => {
      gmValidationAttempts += 1;
      return validateGeneratedWorldChanges(candidate, bundle.world, { strictTransfers: gmValidationAttempts === 1 });
    },
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

// ---- Idle diplomacy drip ----------------------------------------------------
// While the player sits between jumps, the world occasionally speaks first:
// on each real-world-minute tick (the caller's cadence) there is a small chance
// one polity sends a short note to the player's inbox. Hard-suspended while any
// simulation is in flight (busy lock above), never stacked, and silent on any
// failure — there is no canned fallback small talk.
const IDLE_DIPLOMACY_CHANCE = 1 / 20;
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
      timeoutMs: 60000,
      userMessage:
        "A quiet moment between rounds. Decide whether any single polity would send the player a short diplomatic note right now. Return JSON only.",
      validatePayload: async (candidate) => {
        if (candidate?.chat == null) return "";
        const countries = await resolveInvitees(candidate.chat.countries, bundle.world);
        return countries.length > 0
          ? ""
          : "$.chat.countries must contain at least one known polity (or chat must be null).";
      },
      variables,
    });
    if (!payload?.chat) return null;
    // A jump may have started while the model was thinking; its state bundle
    // predates our write, so drop the note rather than race the save.
    if (isSimulationBusy()) return null;
    const built = await buildGeneratedChat({ ...payload.chat, source: "outreach" }, "", bundle.world);
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
