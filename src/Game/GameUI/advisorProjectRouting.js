/*! Open Historia — domestic Advisor Project routing. AGPL-3.0-or-later. */
import {
  ADVISOR_RECIPIENT_TYPES,
  CHIEF_ADVISOR_THREAD,
  advisorRecipientType,
} from "../../runtime/advisorThreads.js";

// A typed minister contact may author Project operations during a conversation.
// This is deliberately NOT proof of a political appointment or broader
// delegation. Non-minister character contexts never gain this mutating path.
export const canAdvisorApplyProjectOps = (threadId, recipient) => (
  threadId === CHIEF_ADVISOR_THREAD
  || Boolean(recipient
    && !recipient.archived
    && recipient.id === threadId
    && advisorRecipientType(recipient) === ADVISOR_RECIPIENT_TYPES.MINISTER)
);

// The current world must be read, transformed and persisted while holding the
// native canonical write queue. Never write a world snapshot captured before
// the LLM reply: changes from another panel could be silently lost.
export const applyAdvisorProjectProposal = async ({
  proposal,
  gameDate,
  round,
  mutateWorldState,
  applyProjectOpsToWorld,
} = {}) => {
  if (!Array.isArray(proposal) || proposal.length === 0) return null;
  let items = [];
  await mutateWorldState((world) => {
    const before = Array.isArray(world.projects) ? world.projects : [];
    const previousById = new Map(before.map((project) => [project.id, project]));
    const { deferredProjectIds, world: nextWorld } = applyProjectOpsToWorld({
      date: String(gameDate || ""),
      ops: proposal,
      round: Number(round) || 0,
      world,
    });
    const next = nextWorld.projects;
    const changes = [];
    for (const project of next) {
      const previous = previousById.get(project.id);
      if (!previous) {
        changes.push({ change: "opened", title: project.name });
      } else if (previous.updatedAt !== project.updatedAt) {
        changes.push({
          change: project.status === "complete" && previous.status !== "complete" ? "completed" : "updated",
          title: project.name,
        });
      }
    }
    for (const project of before) {
      if (!next.some((entry) => entry.id === project.id)) {
        changes.push({ change: "closed", title: project.name });
      }
    }
    // Completion effects that require a world event must NOT be enacted here.
    // Reflect the engine's deferred outcome instead of a false success card.
    for (const id of deferredProjectIds) {
      const project = next.find((entry) => entry.id === id);
      if (project) changes.push({ change: "deferred", title: project.name });
    }
    items = changes;
    return changes.some((change) => change.change !== "deferred") ? nextWorld : null;
  });
  return items.length ? items : null;
};
