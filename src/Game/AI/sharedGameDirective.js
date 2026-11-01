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

// "France", "France or Spain", "France, Spain or Italy": the several polities
// people play, filled into a prompt written for one. Joined with "and" they
// read as one polity ("France and Spain is played by a human", "Always call the
// player's polity France and Spain"); with "or" each sentence holds for each of
// them alone, as the shared game's directive says it does.
export const joinPolityNames = (names) => {
  const list = (Array.isArray(names) ? names : []).map((name) => String(name ?? "").trim()).filter(Boolean);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0] || "";
};

export const buildSharedGameDirective = (game) => {
  const people = humanCountriesOf(game);
  if (people.length < 2) return "";
  return [
    "[Shared Game — several people play]",
    `People play these polities, one each: ${people.join("; ")}. Everything this prompt says about "the player" holds for each of them separately. Every other polity is yours to simulate.`,
    `- Where this prompt names them together ("${joinPolityNames(people)}"), it means each of them on its own. They are separate polities with separate governments, territories, armies and aims, played by different people; they may be friends, rivals or at war with each other.`,
    "- Every queued order is marked with the polity that gave it, and speaks only for that polity's own government. An order can never make another player's polity choose, agree, sign, pay, cede or reply: what one player asks of another is a proposal, answered only by that player's own orders or messages.",
    "- The world acts on every player's polity as on any other — pressure, incidents, reactions, attacks — and never decides a player polity's own reply.",
    "- A player polity's choice with no order or message of its own behind it is withdrawn by the engine: write each player's outcomes from their own orders.",
    "- Share the period between the players: every player's orders get their outcomes, and no one player's polity is the whole story.",
    // Each letter is one person's thread (AI/sharedLetters.js, multiplayer/host/projection.js).
    "- Every chat you open (createdChats, diplomaticOutreach) is a letter to ONE player: name that player's polity in `to`, and in countries only the governments writing, never a player's polity. A government with something to say to two players writes two letters.",
    `- Each conversation under [Diplomacy So Far] says whose it is. A player's message there that no government has answered yet is answered in this period: the governments in that conversation reply with a chat naming the same countries and that player in \`to\`, and the reply lands in the same conversation. What a player writes binds only their own government.`,
    // Each player is shown only the events they may read (multiplayer/host/projection.js readableBy).
    "- Each player sees only the events their government would know of. An event that is secret - a covert order's outcome, a hidden meeting, a plot not yet found out - lists in its audience the polities that know of it (the one that acted, and anyone in on it or who uncovered it); everyone else is never shown it. Leave audience out of anything public. What others can observe of a secret act (ships sailing, a minister dismissed) may be its own public event, without the secret.",
    "- On the Projects board, an entry owned by one of these polities is that player's own work, lent to this board for the period: advance it, miss its milestones or finish it by what happens, exactly as you do the first player's own. It is never something another government has found out, and an entry marked secret or covert is known to its own government alone: no event may reveal it to the others.",
  ].join("\n");
};
