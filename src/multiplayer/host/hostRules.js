/*! Open Historia — what decides a shared game's rounds beyond its lobby settings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every round of a shared game is resolved on the host's computer, by the
// host's game and the host's AI settings. Some of what decides it is not among
// the lobby's settings (host/settings.js), and nobody but the host could see it
// (the gap audit of 2026-11-18). The map's rule 7, same inputs: the host states
// each in the lobby, and every screen reads it there.
//
//   difficulty    the host's game's level: ONE level for every seat. It weighs
//                 how things go for each player against the world the AI plays,
//                 and never between two players (AI/sharedGameDirective.js; the
//                 battlefields already hold that line, runtime/fronts/handicap.js).
//   requests      what one round costs the host's AI: its one request (one per
//                 segment of a long round), and `most` when the host's settings
//                 let the model look things up (AI/requestBudget.js
//                 describeJumpCost, as the time panel says it in single player).
//   stallMinutes  how long a round waits on a silent AI before it fails and the
//                 host can run it again ("Limit AI generation"); 0 for as long as
//                 it takes, until the host cancels it.
//
// Runtime-free: the host's engine reads its device's settings and hands them in.

import { describeJumpCost } from "../../Game/AI/requestBudget.js";
import { SEGMENTED_JUMP_MIN_DAYS, planJumpSegments } from "../../Game/AI/jumpSegments.js";
import { AI_FIRST_BYTE_TIMEOUT_MS } from "../../Game/AI/idleDeadline.js";
import { normalizeDifficulty } from "../../runtime/difficulty.js";

// `noRequestLimit` and `lookups`: Settings → AI's "My key has no request
// limit" and "AI lookup functions"; `segmented`: "Generate long time skips in
// segments"; `limitGeneration`: "Limit AI generation".
export const roundRulesOf = ({ difficulty = "", daysPerRound = 30, noRequestLimit = false, lookups = true, segmented = false, limitGeneration = false } = {}) => {
  const days = Math.max(1, Math.round(Number(daysPerRound) || 1));
  const segments = segmented && days >= SEGMENTED_JUMP_MIN_DAYS ? planJumpSegments(days).length : 1;
  const cost = describeJumpCost({ lookups: Boolean(noRequestLimit && lookups), segments, unlimited: Boolean(noRequestLimit) });
  return {
    difficulty: normalizeDifficulty(difficulty),
    requests: cost.min,
    most: cost.max,
    stallMinutes: limitGeneration ? Math.round(AI_FIRST_BYTE_TIMEOUT_MS / 60_000) : 0,
  };
};

export const sameRules = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
