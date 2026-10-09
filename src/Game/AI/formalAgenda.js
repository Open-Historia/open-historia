/*! Open Historia — which proposals a Council is shown as its formal agenda © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Council prompt (gameplay.js institutionGovernancePrompt) lists the
// institution's proposals under [Formal agenda], and the AI members can only
// submit, amend, vote on or resolve a proposal whose exact id is listed there.
// It used to list the first sixteen in the map's insertion order, which is
// never pruned: once an institution had sixteen proposals, passed and archived
// ones included, current business fell off the list, its sponsor could not move
// it, and members lodged duplicates of it. Import-free, so node tests can drive
// it.

import { compareGameDates, isGameDate } from "../../runtime/gameDates.js";

// Business the members can still act on (institutionalGovernance.js
// transitionMap); everything after a vote is settled.
const OPEN_STATUSES = new Set(["draft", "debate", "amendment", "formalized", "voting"]);

const lastActivity = (proposal) => String(proposal?.lastUpdatedDate || proposal?.createdDate || "").trim();

// Newest activity first, undated last; equal ones keep their order.
const byRecentActivity = (entries) => entries
  .map((proposal, index) => ({ proposal, index, dated: isGameDate(lastActivity(proposal)) }))
  .sort((a, b) => (Number(b.dated) - Number(a.dated))
    || (a.dated && b.dated ? compareGameDates(lastActivity(b.proposal), lastActivity(a.proposal)) : 0)
    || a.index - b.index)
  .map((entry) => entry.proposal);

// { open, closed }: every open proposal the agenda has room for, most recent
// activity first, then the most recently settled ones in the slots left (at most
// `closedLimit`), so members can see what was already decided and not table it
// again.
export const formalAgendaProposals = (proposals, { limit = 16, closedLimit = 4 } = {}) => {
  const all = Object.values(proposals && typeof proposals === "object" ? proposals : {})
    .filter((proposal) => proposal && typeof proposal === "object");
  const open = byRecentActivity(all.filter((proposal) => OPEN_STATUSES.has(String(proposal.status || "").toLowerCase())))
    .slice(0, limit);
  const room = Math.max(0, Math.min(closedLimit, limit - open.length));
  const closed = room
    ? byRecentActivity(all.filter((proposal) => !OPEN_STATUSES.has(String(proposal.status || "").toLowerCase()))).slice(0, room)
    : [];
  return { open, closed };
};
