/*
 * OpenHistoria Phase 9 context diagnostics.
 *
 * Phase 9.4A diagnostics:
 * - Phase 9.3A focused bounded context remains ACTIVE for diplomaticReply;
 * - Phase 9.4A longitudinal attention is ACTIVE for jumpForward/autoJumpForward;
 * - young campaigns still receive their complete consolidated history;
 * - once old history exceeds the 24k activation ceiling, the SAME 24k transport
 *   envelope becomes ~18k broad summary coverage + up to 6k canonical-event anchors;
 * - other task prompts/history remain unchanged; diagnostics never mutate save state.
 *
 * campaign-quality invariant: current hard state and recent continuity remain exact.
 * Long-campaign compression spends part of the old-summary budget on direct canonical
 * event anchors so decisive divergences do not disappear merely because they are old.
 */

const clean = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);

export const CONTEXT_PROFILE_KEYS = Object.freeze({
  GENERAL: "general",
  WORLD_SIMULATION: "world-simulation",
  DIPLOMACY: "diplomacy",
  WAR: "war",
  STATS: "stats",
  GAME_MASTER: "game-master",
  PLAYER_ACTION: "player-action",
  HISTORY: "history",
  ADVISOR: "advisor",
  MECHANICAL: "mechanical",
});

export const CONTEXT_PROFILES = Object.freeze({
  [CONTEXT_PROFILE_KEYS.GENERAL]: Object.freeze({
    label: "General",
    intent: "Fallback profile for tasks without a dedicated attention contract.",
    priority: Object.freeze(["current hard state", "recent relevant canon"]),
  }),
  [CONTEXT_PROFILE_KEYS.WORLD_SIMULATION]: Object.freeze({
    label: "World Simulation",
    intent: "Broad but bounded awareness for autonomous world progression.",
    priority: Object.freeze([
      "current hard state",
      "active storylines and unresolved pressures",
      "active wars and diplomacy",
      "recent high-value events",
      "permanent canonical historical anchors",
      "selected older continuity",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.DIPLOMACY]: Object.freeze({
    label: "Diplomacy",
    intent: "Counterpart-focused continuity without losing binding current canon.",
    priority: Object.freeze([
      "participants and stable polity identity",
      "bilateral relations",
      "formal agreements",
      "actual war state",
      "durable thread memory and recent messages",
      "relevant events and commitments",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.WAR]: Object.freeze({
    label: "War / Military",
    intent: "Conflict-local operational continuity grounded in canonical belligerency.",
    priority: Object.freeze([
      "canonical war ledger",
      "belligerents and units",
      "de-facto control and legal sovereignty",
      "recent military events",
      "relevant alliances and commitments",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.STATS]: Object.freeze({
    label: "Stats / Economy",
    intent: "Preserve economic and territorial continuity while excluding unrelated narrative noise.",
    priority: Object.freeze([
      "authoritative Stats baseline",
      "territorial accounting basis",
      "accounted event ids",
      "recent economic evidence",
      "relevant territorial changes",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.GAME_MASTER]: Object.freeze({
    label: "Game Master",
    intent: "Enough current canon to plan an exact intervention without becoming a second simulator.",
    priority: Object.freeze([
      "entities and regions named by the request",
      "current hard state",
      "relevant ledgers",
      "relevant historical provenance",
      "current geography and identities",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.PLAYER_ACTION]: Object.freeze({
    label: "Player Action",
    intent: "Ground player planning and resolution in current capabilities, commitments, and consequences.",
    priority: Object.freeze([
      "player polity hard state",
      "active commitments and conflicts",
      "current Stats and capabilities",
      "recent causal history",
      "relevant geography",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.HISTORY]: Object.freeze({
    label: "History / Curation",
    intent: "Preserve chronology, causality, and provenance while consolidating or curating narrative history.",
    priority: Object.freeze([
      "source events/actions/chats",
      "chronology",
      "storyline state",
      "canonical war/diplomatic prerequisites",
      "provenance ids",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.ADVISOR]: Object.freeze({
    label: "Advisor",
    intent: "Give the player useful strategic advice from current canon and relevant campaign continuity.",
    priority: Object.freeze([
      "player polity state",
      "active wars and diplomacy",
      "current Stats",
      "recent relevant events/actions",
      "active storylines",
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.MECHANICAL]: Object.freeze({
    label: "Mechanical Helper",
    intent: "Exact bounded bookkeeping context for deterministic helper tasks.",
    priority: Object.freeze([
      "task-local canonical state",
      "explicit source candidates",
      "stable ids",
      "minimal narrative evidence",
    ]),
  }),
});

const TASK_PROFILE_MAP = Object.freeze({
  advisorChat: CONTEXT_PROFILE_KEYS.ADVISOR,
  diplomaticReply: CONTEXT_PROFILE_KEYS.DIPLOMACY,
  eventConsolidator: CONTEXT_PROFILE_KEYS.HISTORY,
  geographyResolver: CONTEXT_PROFILE_KEYS.MECHANICAL,
  timelineCurator: CONTEXT_PROFILE_KEYS.HISTORY,
  unitDirector: CONTEXT_PROFILE_KEYS.WAR,
  territoryDirector: CONTEXT_PROFILE_KEYS.MECHANICAL,
  actions: CONTEXT_PROFILE_KEYS.PLAYER_ACTION,
  countryStatSheet: CONTEXT_PROFILE_KEYS.STATS,
  descriptionToAction: CONTEXT_PROFILE_KEYS.PLAYER_ACTION,
  nextSpeaker: CONTEXT_PROFILE_KEYS.DIPLOMACY,
  catalystCreation: CONTEXT_PROFILE_KEYS.WORLD_SIMULATION,
  catalystExecutor: CONTEXT_PROFILE_KEYS.WORLD_SIMULATION,
  catalystSummary: CONTEXT_PROFILE_KEYS.HISTORY,
  jumpForward: CONTEXT_PROFILE_KEYS.WORLD_SIMULATION,
  autoJumpForward: CONTEXT_PROFILE_KEYS.WORLD_SIMULATION,
  gameMaster: CONTEXT_PROFILE_KEYS.GAME_MASTER,
  pregameHistory: CONTEXT_PROFILE_KEYS.HISTORY,
  idleDiplomacy: CONTEXT_PROFILE_KEYS.DIPLOMACY,
});

export const resolveContextProfileKey = (taskKey) =>
  TASK_PROFILE_MAP[clean(taskKey)] || CONTEXT_PROFILE_KEYS.GENERAL;

export const resolveContextProfile = (taskKey) => {
  const key = resolveContextProfileKey(taskKey);
  return { key, ...CONTEXT_PROFILES[key] };
};

export const isContextDiagnosticsEnabled = () => {
  try {
    return globalThis?.__OH_CONTEXT_DIAGNOSTICS__ === true;
  } catch {
    return false;
  }
};

const stringifyForMeasurement = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (["number", "boolean", "bigint"].includes(typeof value)) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const measureHistoryChars = (history) => array(history).reduce((total, entry) => {
  const roleChars = clean(entry?.role).length;
  const partChars = array(entry?.parts).reduce(
    (sum, part) => sum + stringifyForMeasurement(part?.text ?? part).length,
    0,
  );
  return total + roleChars + partChars;
}, 0);

const measureVariables = (variables) => Object.entries(
  variables && typeof variables === "object" ? variables : {},
).map(([key, value]) => ({
  key,
  chars: stringifyForMeasurement(value).length,
})).sort((left, right) => right.chars - left.chars);

const approximateTokens = (chars) => Math.ceil(Math.max(0, Number(chars) || 0) / 4);

const appendDiagnosticHistory = (report) => {
  try {
    const current = array(globalThis.__OH_CONTEXT_DIAGNOSTICS_HISTORY__);
    globalThis.__OH_CONTEXT_DIAGNOSTICS_HISTORY__ = [...current, report].slice(-100);
  } catch {
    // diagnostics must never interfere with gameplay in restricted environments.
  }
};

// ---------------------------------------------------------------------------
// 9.4A production diplomacy + longitudinal-history headroom/full-request projection
// ---------------------------------------------------------------------------
// Diplomacy uses its production budgets from 9.3A. World Simulation keeps a total
// 24k-char OLD-HISTORY envelope: once activated, ~18k is broad consolidated-summary
// coverage and up to 6k is direct canonical-event anchors. For those two profiles
// this is therefore a headroom/coverage check. Other profiles remain shadow-only.

const SHADOW_PLANS = Object.freeze({
  [CONTEXT_PROFILE_KEYS.WORLD_SIMULATION]: Object.freeze({
    exact: Object.freeze([
      "worldInitiativeContext",
      "canonicalWarContext",
      "territorialControlContext",
      "diplomaticContinuity",
      "plannedActions",
      "playerPolityReputationContext",
      "historicalAnchors",
    ]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 18000, mode: "tail-blocks", label: "recent detailed events" },
      { key: "consolidatedHistory", budget: 24000, mode: "tail-blocks", label: "production long-history summary share" },
      { key: "allActions", budget: 10000, mode: "tail-lines", label: "resolved player-action continuity" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.DIPLOMACY]: Object.freeze({
    exact: Object.freeze([
      "canonicalDiplomaticContext",
      "canonicalWarContext",
      "chatHistory",
    ]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 12000, mode: "tail-blocks", label: "recent campaign events" },
      { key: "consolidatedHistory", budget: 8000, mode: "tail-blocks", label: "older relevant-history allowance" },
      { key: "chatHistoryLong", budget: 6000, mode: "head-blocks", label: "other recent diplomatic context" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.PLAYER_ACTION]: Object.freeze({
    exact: Object.freeze(["plannedActions", "canonicalWarContext", "canonicalDiplomaticContext"]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 16000, mode: "tail-blocks", label: "recent campaign events" },
      { key: "consolidatedHistory", budget: 10000, mode: "tail-blocks", label: "older campaign continuity" },
      { key: "chatHistoryLong", budget: 8000, mode: "head-blocks", label: "recent diplomacy" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.ADVISOR]: Object.freeze({
    exact: Object.freeze(["plannedActions", "canonicalWarContext", "canonicalDiplomaticContext"]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 18000, mode: "tail-blocks", label: "recent campaign events" },
      { key: "consolidatedHistory", budget: 12000, mode: "tail-blocks", label: "older campaign continuity" },
      { key: "allActions", budget: 10000, mode: "tail-lines", label: "resolved player actions" },
      { key: "chatHistoryLong", budget: 8000, mode: "head-blocks", label: "recent diplomacy" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.GAME_MASTER]: Object.freeze({
    exact: Object.freeze([
      "canonicalWarContext",
      "canonicalDiplomaticContext",
      "territorialControlContext",
      "plannedActions",
    ]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 18000, mode: "tail-blocks", label: "recent campaign evidence" },
      { key: "consolidatedHistory", budget: 16000, mode: "tail-blocks", label: "older provenance allowance" },
      { key: "chatHistoryLong", budget: 8000, mode: "head-blocks", label: "recent diplomacy" },
      { key: "allActions", budget: 8000, mode: "tail-lines", label: "player-action provenance" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.STATS]: Object.freeze({
    exact: Object.freeze([
      "statsTerritorialContext",
      "statsTerritorialReferenceContext",
      "statsPreviousContext",
      "statsEconomicEvidenceContext",
    ]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 10000, mode: "tail-blocks", label: "recent event evidence" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.WAR]: Object.freeze({
    exact: Object.freeze([
      "canonicalWarContext",
      "canonicalDiplomaticContext",
      "territorialControlContext",
      "unitDirectorUnits",
      "unitDirectorCandidates",
      "territoryDirectorCandidates",
    ]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 10000, mode: "tail-blocks", label: "recent military history" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.HISTORY]: Object.freeze({
    exact: Object.freeze(["eventsToConsolidate", "chatsToConsolidate"]),
    bounded: Object.freeze([
      { key: "recentEventsLong", budget: 32000, mode: "tail-blocks", label: "chronological source window" },
      { key: "allActions", budget: 16000, mode: "tail-lines", label: "action provenance" },
      { key: "chatHistoryLong", budget: 16000, mode: "head-blocks", label: "chat provenance" },
    ]),
  }),
  [CONTEXT_PROFILE_KEYS.MECHANICAL]: Object.freeze({
    exact: Object.freeze([
      "unitDirectorUnits",
      "unitDirectorCandidates",
      "territoryDirectorState",
      "territoryDirectorCandidates",
      "territorialControlContext",
    ]),
    bounded: Object.freeze([]),
  }),
  [CONTEXT_PROFILE_KEYS.GENERAL]: Object.freeze({
    exact: Object.freeze([]),
    bounded: Object.freeze([
      { key: "recentEvents", budget: 12000, mode: "tail-blocks", label: "recent campaign events" },
      { key: "consolidatedHistory", budget: 8000, mode: "tail-blocks", label: "older campaign continuity" },
    ]),
  }),
});

const splitBlocks = (text) => clean(text)
  .split(/\n\s*\n+/)
  .map((entry) => entry.trim())
  .filter(Boolean);

const splitLines = (text) => clean(text)
  .split(/\r?\n/)
  .map((entry) => entry.trimEnd())
  .filter((entry) => entry.trim());

const selectWithinBudget = (text, budget, mode) => {
  const source = stringifyForMeasurement(text);
  const safeBudget = Math.max(0, Math.trunc(Number(budget) || 0));
  if (!source || safeBudget <= 0) {
    return {
      sourceChars: source.length,
      selectedChars: 0,
      omittedChars: source.length,
      selectedItems: 0,
      selectedText: "",
    };
  }
  if (source.length <= safeBudget) {
    return {
      sourceChars: source.length,
      selectedChars: source.length,
      omittedChars: 0,
      selectedItems: 1,
      selectedText: source,
    };
  }

  const usesLines = mode.includes("lines");
  const blocks = usesLines ? splitLines(source) : splitBlocks(source);
  const separator = usesLines ? "\n" : "\n\n";
  const takeHead = mode.startsWith("head");
  const ordered = takeHead ? blocks : [...blocks].reverse();
  const selected = [];
  let used = 0;

  for (const block of ordered) {
    const separatorChars = selected.length > 0 ? separator.length : 0;
    const next = separatorChars + block.length;
    if (used + next > safeBudget && selected.length > 0) break;
    if (used + next > safeBudget && selected.length === 0) {
      const fragment = takeHead ? block.slice(0, safeBudget) : block.slice(-safeBudget);
      selected.push(fragment);
      used = fragment.length;
      break;
    }
    selected.push(block);
    used += next;
  }

  const selectedText = (takeHead ? selected : selected.reverse()).join(separator);
  return {
    sourceChars: source.length,
    selectedChars: selectedText.length,
    omittedChars: Math.max(0, source.length - selectedText.length),
    selectedItems: selected.length,
    selectedText,
  };
};

const SHADOW_FULL_PROJECTION_PROFILES = new Set([
  CONTEXT_PROFILE_KEYS.WORLD_SIMULATION,
  CONTEXT_PROFILE_KEYS.DIPLOMACY,
]);

const countLiteralOccurrences = (text, needle) => {
  const haystack = stringifyForMeasurement(text);
  const target = stringifyForMeasurement(needle);
  if (!haystack || !target) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= haystack.length - target.length) {
    const found = haystack.indexOf(target, cursor);
    if (found < 0) break;
    count += 1;
    cursor = found + target.length;
  }
  return count;
};

const replaceLiteralAll = (text, needle, replacement) => {
  const source = stringifyForMeasurement(text);
  const target = stringifyForMeasurement(needle);
  if (!source || !target) return { text: source, occurrences: 0 };
  const occurrences = countLiteralOccurrences(source, target);
  if (occurrences <= 0) return { text: source, occurrences: 0 };
  return {
    text: source.split(target).join(stringifyForMeasurement(replacement)),
    occurrences,
  };
};

const buildShadowFullRequestProjection = ({
  combined = {},
  exact = [],
  bounded = [],
  history = [],
  profileKey = CONTEXT_PROFILE_KEYS.GENERAL,
  systemPrompt = "",
} = {}) => {
  if (!SHADOW_FULL_PROJECTION_PROFILES.has(profileKey)) return null;

  const actualSystemPrompt = stringifyForMeasurement(systemPrompt);
  const historyChars = measureHistoryChars(history);
  let projectedSystemPrompt = actualSystemPrompt;
  const boundedReplacements = [];

  for (const entry of bounded) {
    const sourceText = stringifyForMeasurement(combined[entry.key]);
    const selectedText = stringifyForMeasurement(entry.selectedText);
    if (!sourceText || sourceText === selectedText) {
      boundedReplacements.push({
        key: entry.key,
        occurrences: sourceText ? countLiteralOccurrences(projectedSystemPrompt, sourceText) : 0,
        sourceChars: sourceText.length,
        selectedChars: selectedText.length,
        removedPromptChars: 0,
        status: sourceText ? "within budget" : "empty",
      });
      continue;
    }

    const replacement = replaceLiteralAll(projectedSystemPrompt, sourceText, selectedText);
    projectedSystemPrompt = replacement.text;
    boundedReplacements.push({
      key: entry.key,
      occurrences: replacement.occurrences,
      sourceChars: sourceText.length,
      selectedChars: selectedText.length,
      removedPromptChars: replacement.occurrences * Math.max(0, sourceText.length - selectedText.length),
      status: replacement.occurrences > 0 ? "replaced in rendered prompt" : "not rendered in this prompt",
    });
  }

  const exactCoverage = [];
  let appendedExactChars = 0;
  for (const entry of exact) {
    const value = stringifyForMeasurement(combined[entry.key]);
    if (!value) continue;
    const occurrences = countLiteralOccurrences(projectedSystemPrompt, value);
    if (occurrences > 0) {
      exactCoverage.push({
        key: entry.key,
        chars: value.length,
        occurrences,
        status: "already present",
      });
      continue;
    }

    const block = `\n\n[Shadow protected exact context: ${entry.key}]\n${value}`;
    projectedSystemPrompt += block;
    appendedExactChars += block.length;
    exactCoverage.push({
      key: entry.key,
      chars: value.length,
      occurrences: 0,
      status: "appended in projection",
    });
  }

  const actualTotalInputChars = actualSystemPrompt.length + historyChars;
  const projectedSystemPromptChars = projectedSystemPrompt.length;
  const projectedTotalInputChars = projectedSystemPromptChars + historyChars;
  const deltaChars = projectedTotalInputChars - actualTotalInputChars;
  const reductionChars = Math.max(0, actualTotalInputChars - projectedTotalInputChars);
  const reductionPercent = actualTotalInputChars > 0
    ? (reductionChars / actualTotalInputChars) * 100
    : 0;

  return {
    method: "literal rendered-value substitution + append missing protected exact context",
    actualSystemPromptChars: actualSystemPrompt.length,
    actualTotalInputChars,
    projectedSystemPromptChars,
    projectedTotalInputChars,
    projectedApproxTokens: approximateTokens(projectedTotalInputChars),
    deltaChars,
    reductionChars,
    reductionPercent,
    appendedExactChars,
    historyChars,
    boundedReplacements,
    exactCoverage,
  };
};

export const buildShadowAttentionPreview = ({
  history = [],
  shadowMetadata = {},
  shadowSourceVariables = null,
  shadowVariables = {},
  systemPrompt = "",
  taskKey = "",
  variables = {},
} = {}) => {
  const profile = resolveContextProfile(taskKey);
  const plan = SHADOW_PLANS[profile.key] || SHADOW_PLANS[CONTEXT_PROFILE_KEYS.GENERAL];
  const sourceVariables = shadowSourceVariables && typeof shadowSourceVariables === "object"
    ? shadowSourceVariables
    : variables;
  const combined = { ...(sourceVariables || {}), ...(shadowVariables || {}) };

  const exact = plan.exact.map((key) => {
    const chars = stringifyForMeasurement(combined[key]).length;
    return { key, chars, approxTokens: approximateTokens(chars), policy: "protected exact" };
  }).filter((entry) => entry.chars > 0);

  const boundedInternal = plan.bounded.map((entry) => {
    const worldAnchorTierActive = profile.key === CONTEXT_PROFILE_KEYS.WORLD_SIMULATION &&
      entry.key === "consolidatedHistory" &&
      Boolean(clean(combined.historicalAnchors));
    const effectiveBudget = worldAnchorTierActive ? 18000 : entry.budget;
    const selection = selectWithinBudget(combined[entry.key], effectiveBudget, entry.mode);
    return {
      key: entry.key,
      label: entry.label,
      policy: `${entry.mode} <= ${effectiveBudget.toLocaleString()} chars`,
      budgetChars: effectiveBudget,
      ...selection,
      selectedApproxTokens: approximateTokens(selection.selectedChars),
    };
  }).filter((entry) => entry.sourceChars > 0);
  const bounded = boundedInternal.map(({ selectedText, ...entry }) => entry);

  const exactChars = exact.reduce((sum, entry) => sum + entry.chars, 0);
  const boundedSelectedChars = boundedInternal.reduce((sum, entry) => sum + entry.selectedChars, 0);
  const boundedSourceChars = boundedInternal.reduce((sum, entry) => sum + entry.sourceChars, 0);
  const historyChars = measureHistoryChars(history);
  const fullProjection = buildShadowFullRequestProjection({
    combined,
    exact,
    bounded: boundedInternal,
    history,
    profileKey: profile.key,
    systemPrompt,
  });

  return {
    version: "9.4A-shadow",
    profileKey: profile.key,
    exact,
    bounded,
    exactChars,
    boundedSourceChars,
    boundedSelectedChars,
    boundedOmittedChars: Math.max(0, boundedSourceChars - boundedSelectedChars),
    liveHistoryChars: historyChars,
    shadowMemoryChars: exactChars + boundedSelectedChars + historyChars,
    shadowMemoryApproxTokens: approximateTokens(exactChars + boundedSelectedChars + historyChars),
    fullProjection,
    metadata: {
      ...(profile.key === CONTEXT_PROFILE_KEYS.WORLD_SIMULATION && clean(combined.historicalAttentionStatus)
        ? { historicalAttentionStatus: clean(combined.historicalAttentionStatus) }
        : {}),
      ...(shadowMetadata && typeof shadowMetadata === "object" ? { ...shadowMetadata } : {}),
    },
  };
};

export const logContextDiagnostics = ({
  attempt = 1,
  history = [],
  shadowMetadata = {},
  shadowSourceVariables = null,
  shadowVariables = {},
  stage = "request",
  systemPrompt = "",
  taskKey = "",
  userMessage = "",
  variables = {},
} = {}) => {
  if (!isContextDiagnosticsEnabled()) return null;

  const profile = resolveContextProfile(taskKey);
  const variableSizes = measureVariables(variables);
  const systemPromptChars = stringifyForMeasurement(systemPrompt).length;
  const historyChars = measureHistoryChars(history);
  const userMessageChars = stringifyForMeasurement(userMessage).length;
  const totalInputChars = systemPromptChars + historyChars;
  const shadow = buildShadowAttentionPreview({
    history,
    shadowMetadata,
    shadowSourceVariables,
    shadowVariables,
    systemPrompt,
    taskKey,
    variables,
  });
  const report = {
    at: new Date().toISOString(),
    taskKey: clean(taskKey) || "unknown",
    profileKey: profile.key,
    profileLabel: profile.label,
    stage: clean(stage) || "request",
    attempt: Math.max(1, Math.trunc(Number(attempt) || 1)),
    systemPromptChars,
    historyChars,
    userMessageChars,
    totalInputChars,
    approximateInputTokens: approximateTokens(totalInputChars),
    variableChars: variableSizes.reduce((sum, entry) => sum + entry.chars, 0),
    largestVariables: variableSizes.slice(0, 16),
    shadow,
  };

  appendDiagnosticHistory(report);

  try {
    const stageLabel = report.stage.replace(/-/g, " ").toUpperCase();
    console.groupCollapsed(
      `[context 9.4A] ${report.taskKey} [${stageLabel}] · ${report.profileLabel} · ` +
      `${report.totalInputChars.toLocaleString()} chars (~${report.approximateInputTokens.toLocaleString()} tokens)`,
    );
    const productionWorldHistory = ["jumpForward", "autoJumpForward"].includes(report.taskKey);
    console.log(
      report.taskKey === "diplomaticReply"
        ? "PHASE 9.3A FOCUSED DIPLOMACY IS ACTIVE. Exact current canon/thread continuity is protected; bounded narrative context is model-visible."
        : productionWorldHistory
          ? "PHASE 9.4A LONGITUDINAL ATTENTION IS ACTIVE. Young campaigns keep full old history; after 24k chars the same old-history envelope becomes ~18k broad summary coverage + up to 6k direct canonical-event anchors. Current hard state/recent continuity are unchanged."
          : "THIS TASK'S MODEL-VISIBLE REQUEST IS UNCHANGED BY PHASE 9.4A. Shadow attention below remains measurement-only.",
    );
    console.log("Profile intent:", profile.intent);
    console.log("Profile priorities:", profile.priority);
    console.table({
      systemPrompt: { chars: report.systemPromptChars, approxTokens: approximateTokens(report.systemPromptChars) },
      history: { chars: report.historyChars, approxTokens: approximateTokens(report.historyChars) },
      totalInput: { chars: report.totalInputChars, approxTokens: report.approximateInputTokens },
      userMessage: { chars: report.userMessageChars, approxTokens: approximateTokens(report.userMessageChars) },
      renderedVariables: { chars: report.variableChars, approxTokens: approximateTokens(report.variableChars) },
    });

    if (shadow.exact.length > 0 || shadow.bounded.length > 0) {
      const memoryLabel = report.taskKey === "diplomaticReply"
        ? "Focused diplomacy MEMORY envelope"
        : productionWorldHistory
          ? "Production World Simulation longitudinal attention envelope"
          : "Shadow MEMORY envelope only";
      console.log(
        `${memoryLabel}: ${shadow.shadowMemoryChars.toLocaleString()} chars ` +
        `(~${shadow.shadowMemoryApproxTokens.toLocaleString()} tokens). ` +
        "This is NOT a replacement full-prompt estimate; fixed instructions/map/current-state sections outside the attention plan are excluded.",
      );
      if (shadow.exact.length > 0) {
        console.log("Shadow protected exact sections:");
        console.table(shadow.exact);
      }
      if (shadow.bounded.length > 0) {
        console.log("Shadow bounded narrative sections:");
        console.table(shadow.bounded);
      }
    }

    if (shadow.fullProjection) {
      const projection = shadow.fullProjection;
      const direction = projection.deltaChars <= 0 ? "reduction" : "increase";
      const magnitudeChars = Math.abs(projection.deltaChars);
      const magnitudeTokens = approximateTokens(magnitudeChars);
      console.log(
        `Shadow FULL request projection: ${projection.projectedTotalInputChars.toLocaleString()} chars ` +
        `(~${projection.projectedApproxTokens.toLocaleString()} tokens) vs ACTUAL ` +
        `${report.totalInputChars.toLocaleString()} chars (~${report.approximateInputTokens.toLocaleString()} tokens). ` +
        `${direction}: ${magnitudeChars.toLocaleString()} chars (~${magnitudeTokens.toLocaleString()} tokens)` +
        `${direction === "reduction" ? `, ${projection.reductionPercent.toFixed(1)}%` : ""}.`,
      );
      console.log(
        "Projection method: clone the actual rendered system prompt in memory; replace only bounded source values that are literally present; append protected exact context that the current prompt does not already contain; keep live history unchanged. For production-focused diplomacy and Phase 9.4A World Simulation history, this is a headroom/coverage check, not a legacy-prompt comparison.",
      );
      console.table({
        actualFullRequest: {
          chars: report.totalInputChars,
          approxTokens: report.approximateInputTokens,
        },
        projectedShadowFullRequest: {
          chars: projection.projectedTotalInputChars,
          approxTokens: projection.projectedApproxTokens,
        },
        delta: {
          chars: projection.deltaChars,
          approxTokens: projection.deltaChars === 0
            ? 0
            : Math.sign(projection.deltaChars) * approximateTokens(Math.abs(projection.deltaChars)),
        },
      });
      if (projection.boundedReplacements.length > 0) {
        console.log("Shadow full-prompt bounded replacements:");
        console.table(projection.boundedReplacements);
      }
      if (projection.exactCoverage.length > 0) {
        console.log("Shadow full-prompt protected-exact coverage:");
        console.table(projection.exactCoverage);
      }
    }

    if (Object.keys(shadow.metadata).length > 0) {
      console.log("Shadow diagnostic metadata:", shadow.metadata);
      if (shadow.metadata.diplomaticThreadAligned === false) {
        console.warn(
          "Diplomatic thread alignment warning: the focused prompt context is not bound to the thread being addressed. Treat this as a Phase 9.4A regression and stop the test before judging reply quality.",
        );
      }
    }

    if (report.largestVariables.length > 0) {
      console.log("Largest ACTUAL candidate variables constructed today:");
      console.table(report.largestVariables);
    }
    console.log("Rolling reports: globalThis.__OH_CONTEXT_DIAGNOSTICS_HISTORY__");
    console.groupEnd();
  } catch {
    // console tooling is diagnostic only; failures here are intentionally swallowed.
  }

  return report;
};
