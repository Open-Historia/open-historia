/*! Open Historia Continuum — shared Round-Zero canon context
 *
 * Deterministic context adapter between Scenario Editor canon and downstream Round-Zero
 * systems. It performs zero model calls and knows nothing about Earth, named
 * franchises, countries, institutions or any particular source timeline.
 */

import {
  activeReferencePackIds,
  readScenarioCanon,
} from "./scenarioCanon.js";
import { resolveScenarioHistoryAuthority } from "./scenarioHistoryAuthority.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const cleanMultiline = (value) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => line.replace(/[\t ]+$/g, ""))
  .join("\n")
  .trim();
const array = (value) => Array.isArray(value) ? value : [];
const truncate = (value, limit) => {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const resolveScenarioDate = (game = {}, fallback = "") => clean(
  game?.startDate || game?.gameDate || fallback,
);

const collectApprovedPregameHistory = (events = []) => array(events)
  .filter((event) => clean(event?.source).toLowerCase() === "pregame")
  .map((event) => ({
    id: clean(event?.id),
    date: clean(event?.date),
    title: clean(event?.title),
    description: cleanMultiline(event?.description),
  }))
  .filter((event) => event.date || event.title || event.description)
  .slice(-24);

export const buildRoundZeroCanonContext = ({
  scenario = {},
  game = {},
  world = {},
  events = [],
  scenarioDate = "",
} = {}) => {
  const startDate = resolveScenarioDate(game, scenarioDate);
  const canon = readScenarioCanon(world);
  const historyAuthority = resolveScenarioHistoryAuthority({ world, scenarioDate: startDate });
  return {
    scenarioDate: startDate,
    scenario: {
      name: clean(scenario?.name),
      description: cleanMultiline(scenario?.description),
      premise: cleanMultiline(scenario?.heroSubtitle),
    },
    canonInitialized: canon.initialized,
    universe: {
      id: clean(canon.canonContext?.universe?.id),
      type: clean(canon.canonContext?.universe?.type) || "custom",
    },
    historyAuthority,
    referencePackIds: activeReferencePackIds(canon.canonContext),
    divergence: {
      date: clean(historyAuthority.divergenceDate || canon.canonContext?.divergence?.date),
    },
    pregameHistory: collectApprovedPregameHistory(events),
    worldBeforeRoundOneMode: "authoritative",
    worldBeforeRoundOne: cleanMultiline(world?.startingTimelineText),
    simulationRules: cleanMultiline(world?.simulationRules),
  };
};

const historyAuthorityText = (context) => {
  const authority = context?.historyAuthority ?? {};
  const cutoff = clean(authority.cutoffDate);
  if (!authority.referenceAllowed || !cutoff) {
    return "External/reference canon has NO authority unless explicitly supplied as scenario canon below.";
  }
  if (authority.cutoffInclusive) {
    return `External/reference canon is admissible through ${cutoff}. Anything after ${cutoff} must come from scenario-authored or campaign canon.`;
  }
  return `External/reference canon is admissible only BEFORE ${cutoff}. The date ${cutoff} itself and everything after it belong to this scenario's canon.`;
};

/**
 * Compact high-value prompt projection. Authority, authored divergence, and
 * World Before Round One are ordered before flavor/premise so truncation cannot
 * hide the branch boundary. Materialized pregame events are only a view of that
 * authored canon, never an independent alternate-history source.
 */
export const buildRoundZeroCanonContextText = (options = {}, {
  maxChars = 9000,
} = {}) => {
  const context = buildRoundZeroCanonContext(options);
  const sections = [
    `[ROUND-ZERO CANON — AUTHORITATIVE]\nTARGET START-WORLD DATE: ${context.scenarioDate || "(unspecified)"}\nREFERENCE AUTHORITY: ${historyAuthorityText(context)}`,
  ];

  if (context.divergence.date) {
    sections.push([
      "DIVERGENCE BOUNDARY:",
      `Reference canon stops being authoritative at ${context.divergence.date}.`,
      "The boundary is an authority cutoff, not a second history ledger. World Before Round One contains the scenario-authored pre-game canon.",
    ].join("\n"));
  }

  if (context.worldBeforeRoundOne) {
    sections.push([
      "AUTHORITATIVE WORLD BEFORE ROUND ONE:",
      truncate(context.worldBeforeRoundOne, 3200),
      "These scenario-authored facts remain canon on and after the divergence. External/reference canon after the divergence has no authority to correct, replace, or autocomplete them.",
    ].join("\n"));
  }

  if (context.pregameHistory.length) {
    const rows = context.pregameHistory.map((event) => {
      const identity = [event.date, event.title].filter(Boolean).join(" — ");
      const description = truncate(event.description, 420);
      return `- ${identity || "Pregame event"}${description ? `: ${description}` : ""}`;
    });
    sections.push(`MATERIALIZED PRE-GAME TIMELINE (a runtime view of scenario canon/reference authority):\n${truncate(rows.join("\n"), 3600)}`);
  }

  if (context.scenario.name || context.scenario.description || context.scenario.premise) {
    sections.push([
      context.scenario.name ? `Scenario: ${context.scenario.name}` : "",
      context.scenario.description ? `Scenario description: ${truncate(context.scenario.description, 1000)}` : "",
      context.scenario.premise ? `Scenario premise: ${truncate(context.scenario.premise, 1000)}` : "",
    ].filter(Boolean).join("\n"));
  }

  if (context.simulationRules) {
    sections.push(`SCENARIO SIMULATION RULES (constraints, not historical facts):\n${truncate(context.simulationRules, 1600)}`);
  }

  sections.push("WORLD BEFORE ROUND ONE is authoritative scenario canon. The explicit Scenario Editor start-world state is the destination. Reference canon may supplement only inside the configured authority boundary; never invent post-cutoff source history to fill gaps.");
  return truncate(sections.filter(Boolean).join("\n\n"), Math.max(1200, Number(maxChars) || 9000));
};
