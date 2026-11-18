/*! Open Historia — what a shared game's world task is told of every player © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/worldTaskPeople.test.js
//
// Rule 9 of a shared game: what the simulation gives "the player" it gives each
// seat. The time skip and its two repairs (sharedGameDirective.js
// SHARED_WORLD_TASKS) simulate the world for every player at once, yet the
// blocks that exist because the model never moves a figure it is not shown
// (standing and intelligence, military strength, the diplomatic slice, the
// political capsules, the board's espionage) were built for game.country
// alone: a guest who built a spy academy or rearmed for years was never shown
// a figure to move, and its relations were in the slice only if they fell
// within the host's eight (the review of 2026-11-18, simulation 4). Each is
// built for every person now, in the round's ONE request, by name.
//
// One person (single player, or a shared game only its host plays) is told
// exactly as before: `people` is then [] or the one name, and every function
// here returns what single player's always did (worldTaskPeople.test.js).
//
// Pure but for the import of the people's list.

import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { SHARED_WORLD_TASKS } from "./sharedGameDirective.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();

// The people a task is built for: every polity people play in a world task of
// a shared game (game.country first), and none otherwise, where the task
// speaks to or for one polity and keeps the single player's wording.
export const worldTaskPeople = (game, taskKey) => (SHARED_WORLD_TASKS.has(clean(taskKey)) ? humanCountriesOf(game) : []);

// The people besides `player`, each once.
export const otherPeople = (player, people = []) => {
  const out = [];
  for (const value of Array.isArray(people) ? people : []) {
    const name = clean(value);
    if (!name || fold(name) === fold(player) || out.some((known) => fold(known) === fold(name))) continue;
    out.push(name);
  }
  return out;
};

// The diplomatic slice (nativeDiplomaticDirector.js buildBoundedDiplomaticContext):
// bounded to the player and the polities in view. Every other player is asked
// for too, ahead of them, and each adds one actor to the bound, so the host's
// own relations are not crowded out by its guests'.
export const DIPLOMATIC_SLICE_ACTORS = 8;
export const diplomaticSliceOptions = (player, { focusActors = [], people = [] } = {}) => {
  const others = otherPeople(player, people);
  return {
    playerPolity: clean(player),
    focusActors: [...others, ...(Array.isArray(focusActors) ? focusActors : [])],
    maxActors: DIPLOMATIC_SLICE_ACTORS + others.length,
  };
};

// The political decision capsules of a time skip (gameplay.js
// buildWorldInitiativePoliticalDecisionContext): the player's is first, then
// the actors in the world's attention, 8 in all. Every person's comes first,
// and each other player adds one to the bound.
export const POLITICAL_CAPSULE_ACTORS = 8;
export const politicalCapsulePeople = (player, people = []) => {
  const first = clean(player);
  return first ? [first, ...otherPeople(first, people)] : otherPeople("", people);
};
export const politicalCapsuleBound = (persons = []) => POLITICAL_CAPSULE_ACTORS + Math.max(0, (Array.isArray(persons) ? persons.length : 0) - 1);

// What the capsules of several people's polities are evidence of, as single
// player's line says of its one, with whose authority a choice needs: each
// polity's own player's. (Single player's line stays in gameplay.js.)
// i18n-ignore: the model's briefing, never shown.
export const peoplesPressureLine = (persons = []) => `For each HUMAN-controlled polity (${persons.map(clean).filter(Boolean).join("; ")}), internal pressure may produce non-sovereign social, party, institutional or public developments, but it is NOT consent or authority to invent a new executive, parliamentary, diplomatic, military, territorial or other sovereign choice. Such choices require exact prior authority from that polity's own player, already present in its canonical orders/process state.`;

// The board pass's espionage (gameplay.js, task "projects"): the board it keeps
// is the game country's, the host's seat, so its brief is that service's. The
// other players' own entries are lent to that board for the period
// (multiplayer/host/seatBoards.js) and are no intelligence of the host's.
// i18n-ignore: the model's briefing, never shown.
export const sharedBoardServiceLine = (owner) => {
  const name = clean(owner) || "the host's polity";
  return `What ${name}'s service has read, uncensored: the board below is ${name}'s, and another player's entries lent to it for the period are that player's own work, never ${name}'s intelligence. ${name}'s player sees only what it could decode.`;
};
