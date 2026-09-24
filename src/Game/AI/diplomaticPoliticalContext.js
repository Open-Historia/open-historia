/*! Open Historia — Continuum Phase009C diplomatic Political Decision Context bridge */

import { buildPoliticalDecisionContext } from "./politicalDecisionContext.js";

export const DIPLOMATIC_POLITICAL_DECISION_MAX_CHARS = 2400;

export const DIPLOMATIC_POLITICAL_DECISION_LIMITS = Object.freeze({
  traits: 6,
  goals: 5,
  fears: 4,
  ambitions: 4,
  domesticPressures: 4,
  pressureIssues: 4,
  governingEntities: 3,
  oppositionEntities: 1,
  perceptions: 4,
  relations: 3,
  agreements: 3,
  wars: 2,
  institutions: 8,
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/**
 * Build the private, read-only political reasoning section for one diplomatic
 * speaker. Political Actors remain canonical; this only projects the current
 * actor state into the existing diplomacy request.
 *
 * The human/player polity is the focused counterpart because the current
 * diplomatic reply is a response to a player-authored message. Counterpart
 * hidden politics remain behind Political Knowledge inside
 * buildPoliticalDecisionContext().
 */
export const buildDiplomaticPoliticalContext = ({
  world = {},
  speakingAs = "",
  playerCountry = "",
  decisionFocusText = "",
} = {}) => {
  const actorPolity = clean(speakingAs);
  const counterpartPolity = clean(playerCountry);
  if (!actorPolity) return null;

  const context = buildPoliticalDecisionContext(world, actorPolity, {
    counterpartPolity,
    decisionFocusText,
    maxChars: DIPLOMATIC_POLITICAL_DECISION_MAX_CHARS,
    limits: DIPLOMATIC_POLITICAL_DECISION_LIMITS,
  });
  if (!context?.text) return null;

  const text = [
    "[Private Political Reasoning — Diplomatic Speaker]",
    "Use this bounded canonical Political Actor capsule to decide this speaker's stance, priorities, risk tolerance, interpretation, concessions, red lines, and diplomatic tone in THIS exchange.",
    "This is internal reasoning context, not a speech to quote. Do not expose private/internal goals, pressures, strategies, traits, perceptions, or intelligence merely because they are present. Reveal only what this government would plausibly communicate.",
    "Actor perceptions may be wrong. Objective canonical diplomacy/war state remains reality. This read-only context does not authorize changing Political Actors, casting the player's choices, or inventing player consent.",
    context.text,
  ].join("\n");

  return {
    context,
    text,
    actorPolity: context.actorPolity || actorPolity,
    counterpartPolity: context.counterpartPolity || counterpartPolity,
  };
};
