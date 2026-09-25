/*! Open Historia Continuum — counterfactual knowledge boundary
 *
 * The model may know chronology from an external/reference source beyond the
 * scenario's permitted authority boundary. The campaign must not inherit it.
 * This module turns Scenario Canon v2's reference authority into an explicit
 * runtime epistemic boundary for every world-history generating pass.
 *
 * Reference knowledge and campaign canon are different things:
 * - reference canon may establish facts only through its configured horizon;
 * - authored/current campaign canon owns everything after that horizon;
 * - remembered post-boundary source outcomes are never evidence.
 */

import { resolveScenarioHistoryAuthority } from "../../runtime/scenarioHistoryAuthority.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const resolveStartDate = (game = {}, fallbackDate = "") => clean(
  game?.startDate || game?.startingDate || game?.startingRoundDate || fallbackDate,
);

/**
 * Resolve the last date on which external/reference chronology may be treated as
 * evidence. This intentionally does NOT move forward with gameDate: once a
 * campaign starts, later source-canon chronology never gains authority merely
 * because the simulated calendar reaches that date.
 */
export const resolveReferenceKnowledgeBoundary = ({ world = {}, game = {}, fallbackDate = "" } = {}) => {
  const startDate = resolveStartDate(game, fallbackDate);
  const authority = resolveScenarioHistoryAuthority({
    world,
    scenarioDate: startDate,
  });

  return {
    authority: authority.referenceAuthority,
    horizon: authority.cutoffDate,
    inclusive: authority.cutoffInclusive,
    referenceHorizonDate: authority.referenceHorizonDate,
    startDate,
    divergenceDate: authority.divergenceDate,
  };
};

export const buildFutureHistoryBoundaryDirective = ({
  world = {},
  game = {},
  originDate = "",
  fallbackDate = "",
} = {}) => {
  const resolved = resolveReferenceKnowledgeBoundary({ world, game, fallbackDate });
  const origin = clean(originDate || game?.gameDate || resolved.startDate);
  const horizon = clean(resolved.horizon);

  const authorityLine = horizon
    ? resolved.inclusive
      ? `External/reference chronology is admissible only through ${horizon}. Everything after ${horizon} from outside/reference canon is OUTSIDE the simulation's knowledge boundary.`
      : `External/reference chronology is admissible only BEFORE ${horizon}. The date ${horizon} itself and everything after it belong to scenario/campaign canon, not outside/reference chronology.`
    : "External/reference chronology has NO runtime authority. Only scenario-authored and campaign-generated canon supplied to this task may establish historical facts.";

  const branchLine = resolved.startDate
    ? `Campaign branch start: ${resolved.startDate}${origin ? `; current simulation origin: ${origin}` : ""}. Reaching a later calendar date does NOT make post-boundary source-canon events canonical.`
    : origin
      ? `Current simulation origin: ${origin}. The campaign save, not remembered outside chronology, owns the timeline.`
      : "The campaign save, not remembered outside chronology, owns the timeline.";

  return [
    "[Counterfactual Knowledge Boundary — AUTHORITATIVE]",
    authorityLine,
    branchLine,
    "Treat every external/reference-canon outcome beyond the allowed boundary as UNKNOWN COUNTERFACTUAL FUTURE, even when you remember what the source canon says happened.",
    "MEMORY IS NOT EVIDENCE: never use remembered post-boundary event names, numbered resolutions, exact dates, vote totals, summit/conference names, election winners, officeholder successions, treaty signings, military operations, casualty figures, market outcomes, or other later source-canon specifics unless CURRENT CAMPAIGN CANON supplied to this task already established them.",
    "CALENDAR COINCIDENCE IS NOT CAUSALITY: a familiar source-canon date falling inside this interval provides zero evidence that its source event should occur.",
    "REFERENCE-CAUSAL MOMENTUM means surviving pressures may generate a SIMILAR TYPE of outcome. It never authorizes copying the remembered event identity, exact timing, participants, terms, figures, or sequence from post-boundary source canon.",
    "BRANCH AUDIT: before returning any candidate that resembles a known post-boundary source-canon event, ask whether every distinguishing detail is independently grounded in the supplied current canon and present-tense causal state. If not, discard it or resimulate the consequence from current campaign causes.",
    "When a similar outcome is genuinely earned, derive its date, participants, terms, scale, and consequences from THIS campaign's actors, politics, perceptions, institutions, relations, capabilities, and prior generated events — not from remembered history.",
    "Current canonical divergences, including unusual leader/party goals or source-divergent state choices, are positive evidence and must be allowed to redirect attention and outcomes rather than being averaged away toward the familiar source-canon path.",
  ].join("\n");
};
