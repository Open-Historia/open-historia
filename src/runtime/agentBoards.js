/*! Open Historia — every government's Projects board in step with its agents © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// After a turn's espionage, and before the board is asked about the turn
// (gameplay.js applySimulationResult), the engine keeps each board in step
// with its own government's agents. For every player's service
// (spycraft.js spymastersOf; in single player, the player's alone):
//
//   - on its OWN board (the game's for the host's seat, single player's; its
//     seat's for anyone else, as the skip has it, seatBoards.js
//     seatBoardInSkip): the covert operation each of its agents IS, opened and
//     closed with the agent (projects.js spyOperationOps), and what it had on
//     file of others there, tied to its agents, doubted with them, and settled
//     once a clean agent of its own has reported (spyProvenanceOps,
//     spyIntelDoubtOps, spyVerdictOps);
//   - on every OTHER country's work, wherever it is kept (seatBoards.js
//     workOfEveryCountry): what its agents tell it, kept as its own knowledge
//     of the work, never on the work (projects.js agentKnowledgeChanges).
//
// The passes ran once, for the host's service, over the game's board: a guest's
// agents had no operations on the guest's board, learned of nothing, and the
// host's agents took every guest's own work lent to the game's board for the
// skip for the host's files, and stalled it (the review of 2026-11-18).
//
// A doubt is settled here, for each service from its own table of the agents'
// file (`intercepts`, the whole file: spycraft.js interceptTableOf), and never
// by the model: what was real is the world's to know (projects.js isBelief).
//
// Returns { world, ops, doubted }: the world, and how many board ops and doubts
// were written, for the turn's log.

import { applyProjectOpsToWorld } from "./gameState.js";
import { interceptTableOf, normalizeIntercepts, normalizeSpies } from "./spycraft.js";
import { agentKnowledgeChanges, spyIntelDoubtOps, spyOperationOps, spyProvenanceOps, spyVerdictOps } from "./projects.js";
import { seatBoardInSkip, withSeatBoardInSkip, withWorkChanged, workOfEveryCountry } from "./seatBoards.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const same = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);
const list = (value) => (Array.isArray(value) ? value : []);
const isLent = (row) => Boolean(clean(row?.lentFrom));

export const syncBoardsWithAgents = (world, { spymasters = [], host = "", date = "", round = 0, intercepts = null } = {}) => {
  let next = world;
  let ops = 0;
  let doubted = 0;
  const spies = normalizeSpies(world?.spies);
  for (const service of list(spymasters)) {
    const hosting = same(service, host);
    // Its own agents. One with no owner is from before owners were kept, and
    // was always the host seat's.
    const agents = spies.filter((spy) => (clean(spy.owner) ? same(spy.owner, service) : hosting));
    // What its own agents have filed, and only that.
    const table = normalizeIntercepts(interceptTableOf(intercepts, service, { gameCountry: host }));
    const applied = (board, batch) => applyProjectOpsToWorld({ actor: "engine", date, ops: batch, playerCountry: service, round, world: { ...next, projects: board } }).world;

    // Its own board. Provenance first, so an entry tied this turn is doubted in
    // the same pass rather than a turn later; then the verdict on a doubt a
    // clean source of its own now settles.
    if (hosting) {
      // The game's own board, less what other players lent it for the skip.
      // Every other country's entry on it is that country's work.
      const lent = list(next.projects).filter(isLent);
      const own = () => list(next.projects).filter((row) => !isLent(row));
      const withLent = (done) => (lent.length ? { ...done, projects: [...list(done.projects), ...lent] } : done);
      const sync = [...spyOperationOps(agents, own(), { date, playerPolity: service }), ...spyProvenanceOps(agents, own(), { playerPolity: service })];
      if (sync.length) next = withLent(applied(own(), sync));
      const doubt = spyIntelDoubtOps(agents, own(), { playerPolity: service });
      if (doubt.length) next = withLent(applied(own(), doubt));
      const verdicts = spyVerdictOps(agents, own(), { playerPolity: service, intercepts: table });
      if (verdicts.length) next = withLent(applied(own(), verdicts));
      ops += sync.length + verdicts.length;
      doubted += doubt.length;
    } else {
      let board = seatBoardInSkip(next, service);
      const sync = [...spyOperationOps(agents, board, { date, playerPolity: service }), ...spyProvenanceOps(agents, board, { playerPolity: service })];
      if (sync.length) board = applied(board, sync).projects;
      const doubt = spyIntelDoubtOps(agents, board, { playerPolity: service });
      if (doubt.length) board = applied(board, doubt).projects;
      // Another country's entry on a seat's board is a file from before the
      // engine: real where that country's work of its name is.
      const work = workOfEveryCountry(next, { host });
      const isWork = (row) => work.some(({ project, owner }) => same(owner, row?.ownerCode) && same(project?.name, row?.name));
      const verdicts = spyVerdictOps(agents, board, { playerPolity: service, intercepts: table, isWork });
      if (verdicts.length) board = applied(board, verdicts).projects;
      if (sync.length || doubt.length || verdicts.length) next = withSeatBoardInSkip(next, service, board);
      ops += sync.length + verdicts.length;
      doubted += doubt.length;
    }

    // Every other country's work, wherever it is kept.
    const work = workOfEveryCountry(next, { host }).filter(({ board, project }) => !(hosting && !board && !isLent(project)));
    const changes = agentKnowledgeChanges(agents, work, { knower: service, intercepts: table });
    if (changes.length) next = withWorkChanged(next, changes.map(({ index, project }) => ({ ...work[index], project })));
    doubted += changes.filter((change) => change.doubted).length;
  }
  return { world: next, ops, doubted };
};
