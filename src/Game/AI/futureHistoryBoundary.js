/*! Open Historia — real history as the default for a time skip
 *
 * The jump templates say it in general (defaultPrompts.json, [Real History Is
 * the Default]): a game set in our history follows real history wherever the
 * game has not changed things. This block adds what only the save knows — when
 * this game began, and, from the scenario's canon (Scenario Canon v2,
 * scenarioHistoryAuthority.js), whether this world's history had already split
 * from ours before that, and how.
 *
 * It replaced the Counterfactual Knowledge Boundary (2026-09-26), which told
 * the model that nothing it remembered after the game's start was evidence. A
 * skip through May 2014 could then not hold that month's real elections, coups
 * or crises unless the campaign had already invented them, and the timeline
 * filled up with generic news. Real history is now the default, and the game
 * departs from it only where the game has changed something.
 */

import { resolveScenarioHistoryAuthority } from "../../runtime/scenarioHistoryAuthority.js";
import { readScenarioCanon } from "../../runtime/scenarioCanon.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// The scenario's own account of how its world split from ours, as much of it as
// a prompt can carry.
const DIVERGENCE_DESCRIPTION_CHARS = 1500;

const resolveStartDate = (game = {}, fallbackDate = "") => clean(
  game?.startDate || game?.startingDate || game?.startingRoundDate || fallbackDate,
);

/**
 * How this game's world relates to real history: when it began, whether the
 * scenario's canon declares its own universe or a divergence, and where.
 */
export const resolveReferenceKnowledgeBoundary = ({ world = {}, game = {}, fallbackDate = "" } = {}) => {
  const startDate = resolveStartDate(game, fallbackDate);
  const authority = resolveScenarioHistoryAuthority({
    world,
    scenarioDate: startDate,
  });
  let divergenceDescription = "";
  try {
    divergenceDescription = clean(readScenarioCanon(world)?.canonContext?.divergence?.description);
  } catch {
    divergenceDescription = "";
  }

  return {
    authority: authority.referenceAuthority,
    canonInitialized: Boolean(authority.canonInitialized),
    universeType: clean(authority.universeType) || "custom",
    horizon: authority.cutoffDate,
    inclusive: authority.cutoffInclusive,
    referenceHorizonDate: authority.referenceHorizonDate,
    startDate,
    divergenceDate: authority.divergenceDate,
    divergenceDescription,
  };
};

// Which of four worlds this is. A scenario that predates Scenario Canon v2 is a
// game set in our history, as every built-in scenario is.
const worldKind = (resolved) => {
  if (!resolved.canonInitialized) return "historical";
  if (resolved.universeType === "fictional") return "fictional";
  if (resolved.authority === "pre-divergence-only" || resolved.universeType === "alternate") return "alternate";
  if (resolved.universeType === "historical" || resolved.authority === "round-zero-only") return "historical";
  return "custom";
};

export const buildRealHistoryDirective = ({
  world = {},
  game = {},
  originDate = "",
  fallbackDate = "",
} = {}) => {
  const resolved = resolveReferenceKnowledgeBoundary({ world, game, fallbackDate });
  const start = clean(resolved.startDate);
  const origin = clean(originDate || game?.gameDate || start);
  const began = start
    ? `This game began on ${start}${origin && origin !== start ? `, and this jump starts on ${origin}` : ""}.`
    : "";
  const divergence = clean(resolved.divergenceDate);
  const account = resolved.divergenceDescription.length > DIVERGENCE_DESCRIPTION_CHARS
    ? `${resolved.divergenceDescription.slice(0, DIVERGENCE_DESCRIPTION_CHARS).trimEnd()}…`
    : resolved.divergenceDescription;

  const lines = ["[This Game and Real History]"];
  switch (worldKind(resolved)) {
    case "fictional":
      lines.push(`${began} This world is not ours: its past is the scenario's briefing and the events of this game, and it moves by the setting's own lore, which plays the part real history plays in a historical game.`.trim());
      break;
    case "alternate":
      lines.push(`${began} This world's history split from ours${divergence ? ` on ${divergence}` : " before the game began"}, as the scenario describes. Real history before the split is its past; after it, simulate from the scenario's premises and from this game, and let real history guide only what the split plainly could not have reached.`.trim());
      if (account) lines.push(`How it split: ${account}`);
      break;
    case "custom":
      lines.push(`${began} If the scenario's briefing places this world in our history, real history is the default for everything the game has not changed; if it describes a world of its own, follow that world's lore instead.`.trim());
      break;
    default:
      lines.push(`${began} Real history up to that date is this world's past, and from then on it stays the default for everything the game has not changed: the real events of this period happen, with their real people, places, dates and numbers, unless something in this game has changed their causes. What the game has changed so far is in the event history, the records and the map.`.trim());
  }
  return lines.join("\n");
};
