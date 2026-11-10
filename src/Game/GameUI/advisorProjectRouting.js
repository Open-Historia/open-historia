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

// Shared, native Project outcome computation for one-to-one Advisor replies
// and batched group replies. The latter stages all speakers in ONE canonical
// world mutation, avoiding partially applied Project operations within a batch.
const projectOutcome = ({ world, proposal, gameDate, round, applyProjectOpsToWorld }) => {
  const before = Array.isArray(world.projects) ? world.projects : [];
  const previousById = new Map(before.map((project) => [project.id, project]));
  const { deferredProjectIds = [], world: nextWorld } = applyProjectOpsToWorld({
    date: String(gameDate || ""), ops: proposal, round: Number(round) || 0, world,
  });
  const next = nextWorld.projects;
  const changes = [];
  for (const project of next) {
    const previous = previousById.get(project.id);
    if (!previous) changes.push({ change: "opened", title: project.name });
    else if (previous.updatedAt !== project.updatedAt) {
      changes.push({
        change: project.status === "complete" && previous.status !== "complete" ? "completed" : "updated",
        title: project.name,
      });
    }
  }
  for (const project of before) {
    if (!next.some((item) => item.id === project.id)) changes.push({ change: "closed", title: project.name });
  }
  for (const id of deferredProjectIds) {
    const project = next.find((entry) => entry.id === id);
    if (project) changes.push({ change: "deferred", title: project.name });
  }
  return { nextWorld, changes, changed: changes.some((change) => change.change !== "deferred") };
};

// The current world must be transformed while holding the canonical write
// queue. Never write a snapshot captured before the model response.
export const applyAdvisorProjectProposal = async ({
  proposal, gameDate, round, mutateWorldState, applyProjectOpsToWorld,
} = {}) => {
  if (!Array.isArray(proposal) || proposal.length === 0) return null;
  let items = [];
  await mutateWorldState((world) => {
    const result = projectOutcome({ world, proposal, gameDate, round, applyProjectOpsToWorld });
    items = result.changes;
    return result.changed ? result.nextWorld : null;
  });
  return items.length ? items : null;
};

// Each batch was fully parsed and authorized BEFORE calling this function.
// If any native Project operation throws, the single world mutation aborts;
// no preceding speaker's Projects are committed. Action proposals are NEVER
// enqueued here and still require each member's player-reviewed Proceed.
export const applyAdvisorGroupProjectBatch = async ({
  entries, gameDate, round, mutateWorldState, applyProjectOpsToWorld,
} = {}) => {
  const pending = (Array.isArray(entries) ? entries : []).filter((entry) =>
    Array.isArray(entry.proposal) && entry.proposal.length > 0);
  if (!pending.length) return new Map();
  const changesBySpeaker = new Map();
  await mutateWorldState((world) => {
    let staged = world;
    let changed = false;
    for (const entry of pending) {
      const result = projectOutcome({
        world: staged, proposal: entry.proposal, gameDate, round, applyProjectOpsToWorld,
      });
      changesBySpeaker.set(entry.speakerId, result.changes);
      if (result.changed) { staged = result.nextWorld; changed = true; }
    }
    return changed ? staged : null;
  });
  return changesBySpeaker;
};
