/*! Open Historia — a player's agents in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Intelligence tab's orders, for the player who gave them: place an agent
// in a country, call one home, and decide what becomes of a foreign agent the
// player's own service has caught (send it home, or turn it and choose what it
// reports). In single player the screen writes these itself (GameUI/chat.jsx
// IntelligenceWorkspace); in a shared game the host does, with the game's own
// rules (runtime/spycraft.js) and for nobody but the player asking:
//
//   - an agent is its owner's to place and recall;
//   - a caught agent is the business of the country it was caught in.
//
// A placed agent also stands on its owner's Projects board, as in single player
// (runtime/projects.js spyOperationOps), so the board is passed in and handed
// back with the world.
//
// Plain data in, plain data out: { world, board } or { error }.

import { deploySpy, expelSpy, normalizeSpies, recallSpy, setCoverStory, turnSpy } from "../../runtime/spycraft.js";
import { spyOperationOps } from "../../runtime/projects.js";
import { applyProjectOpsToWorld } from "../../runtime/gameState.js";
import { isSeal, newSeal } from "../../runtime/spySeal.js";

export const AGENT_OPS = Object.freeze(["deploy", "recall", "expel", "turn", "story"]);
export const COVER_STORY_MAX_CHARS = 300;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// `seat` is the asker's country and `host` the host's: an agent with no owner
// on it is from before owners were kept, and was always the host seat's.
// `known(country)` says whether a name is a country of this game.
export const agentOrderFor = (world, board, seat, { op, target, spy, story } = {}, { host = "", date = "", known = () => true } = {}) => {
  const me = clean(seat);
  if (!me) return { error: "Take a country first." };
  const spies = normalizeSpies(world?.spies);
  const mine = (entry) => (entry.owner ? same(entry.owner, me) : same(host, me));
  const agent = spies.find((entry) => entry.id === clean(spy));
  let next;
  try {
    if (op === "deploy") {
      const country = clean(target);
      if (!country || !known(country)) return { error: "Unknown country." };
      next = deploySpy({ ...world, spies }, country, { date, owner: me });
    } else if (op === "recall") {
      if (!agent || !mine(agent) || !["active", "turned"].includes(agent.status)) return { error: "That is not one of your agents in place." };
      next = recallSpy({ ...world, spies }, agent.id);
    } else if (op === "expel" || op === "turn") {
      if (!agent || !same(agent.target, me) || agent.status !== "discovered") return { error: "That is not an agent your service is holding." };
      next = op === "expel"
        ? expelSpy({ ...world, spies }, agent.id, { date })
        : turnSpy({ ...world, spies }, agent.id, { date, coverStory: clean(story).slice(0, COVER_STORY_MAX_CHARS) });
    } else if (op === "story") {
      if (!agent || !same(agent.target, me) || agent.status !== "turned") return { error: "That is not an agent your service has turned." };
      next = setCoverStory({ ...world, spies }, agent.id, clean(story).slice(0, COVER_STORY_MAX_CHARS));
    } else {
      return { error: "Unknown order." };
    }
  } catch (refusal) {
    // The game's own words for why not (spycraft.js): shown to the player as they are.
    return { error: clean(refusal?.message) || "The order could not be carried out." };
  }
  const withSpies = { ...world, spies: next, spySeal: isSeal(world?.spySeal) ? world.spySeal : newSeal() };
  // The asker's own agents on the asker's own board.
  const ops = spyOperationOps(next, list(board), { date, playerPolity: me });
  const nextBoard = ops.length
    ? applyProjectOpsToWorld({ date, ops, playerCountry: me, world: { ...withSpies, projects: list(board) } }).world.projects
    : list(board);
  return { world: withSpies, board: nextBoard };
};
