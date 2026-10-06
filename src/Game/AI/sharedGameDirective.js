/*! Open Historia — what the simulator is told when several people play © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The jump's prompt is written for one player. A shared game fills its player
// slot with every polity people play (promptContext.js joinPolityNames) and
// marks each order with the polity that gave it; this says what that means.
// Appended by code after the scenario's own guidance, beside the player's focus
// (gameplay.js), so an author's edits can neither remove it nor starve it of
// room. Single player gets nothing, and its prompt is what it always was.
//
// The native guard holds the same line whatever the model writes
// (nativeWorldIntegrity.js screenGeneratedWorldEvents): a player polity's own
// choice with no order or message of its own is withdrawn.

import { humanCountriesOf } from "../../runtime/humanPolities.js";

// The tasks that simulate the world for every player at once: the jump and its
// two repair passes. Every other task speaks to or for one polity (a leader's
// reply, the advisor, a stat sheet) and keeps the single player's wording.
export const SHARED_WORLD_TASKS = new Set(["jumpForward", "autoJumpForward", "worldMotionRepair", "worldBreadthRepair"]);

export const buildSharedGameDirective = (game) => {
  const people = humanCountriesOf(game);
  if (people.length < 2) return "";
  return [
    "[Shared Game — several people play]",
    `People play these polities, one each: ${people.join("; ")}. Everything this prompt says about "the player" holds for each of them separately. Every other polity is yours to simulate.`,
    "- Every queued order is marked with the polity that gave it, and speaks only for that polity's own government. An order can never make another player's polity choose, agree, sign, pay, cede or reply: what one player asks of another is a proposal, answered only by that player's own orders or messages.",
    "- The world acts on every player's polity as on any other — pressure, incidents, reactions, attacks — and never decides a player polity's own reply.",
    "- A player polity's choice with no order or message of its own behind it is withdrawn by the engine: write each player's outcomes from their own orders.",
    "- Share the period between the players: every player's orders get their outcomes, and no one player's polity is the whole story.",
    "- On the Projects board, an entry owned by one of these polities is that player's own work, lent to this board for the period: advance it, miss its milestones or finish it by what happens, exactly as you do the first player's own. It is never something another government has found out, and an entry marked secret or covert is known to its own government alone: no event may reveal it to the others.",
  ].join("\n");
};
