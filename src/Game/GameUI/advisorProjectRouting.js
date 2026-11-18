/*! Open Historia — domestic Advisor Project routing. AGPL-3.0-or-later. */
import {
  ADVISOR_RECIPIENT_TYPES,
  CHIEF_ADVISOR_THREAD,
  advisorRecipientType,
} from "../../runtime/advisorThreads.js";
import { inSharedGame, requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";
import { PROJECT_OPS_MAX } from "../../multiplayer/game/messages.js";

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
// The advisor opens the player's projects, funds or calls them off, and reports
// on any entry; the engine runs them (runtime/projectEngine.js), so nothing the
// advisor writes completes one or moves its progress.
const CLOSED = new Set(["complete", "failed", "cancelled"]);

// In a shared game the board is the host's to change: what the advisor proposes
// is worked out on the player's view (for its report) and asked of the host, by
// the same operations (multiplayer/game/messages.js "projectOps"), never
// written here. At most PROJECT_OPS_MAX in one request.
const askHostForOps = async (ops) => {
  for (let start = 0; start < ops.length; start += PROJECT_OPS_MAX) {
    const answer = await requestFromHost("projectOps", { ops: ops.slice(start, start + PROJECT_OPS_MAX), by: "advisor" });
    if (!answer?.ok) throw new Error(answer?.error || "The host did not take that.");
  }
};
const projectOutcome = ({ world, proposal, gameDate, round, applyProjectOpsToWorld }) => {
  const before = Array.isArray(world.projects) ? world.projects : [];
  const previousById = new Map(before.map((project) => [project.id, project]));
  const { world: nextWorld } = applyProjectOpsToWorld({
    actor: "ai", date: String(gameDate || ""), ops: proposal, round: Number(round) || 0, world,
  });
  const next = nextWorld.projects;
  const changes = [];
  for (const project of next) {
    const previous = previousById.get(project.id);
    if (!previous) changes.push({ change: "opened", title: project.name });
    else if (previous.updatedAt !== project.updatedAt) {
      changes.push({
        change: CLOSED.has(project.status) && !CLOSED.has(previous.status) ? "closed" : "updated",
        title: project.name,
      });
    }
  }
  return { nextWorld, changes, changed: changes.length > 0 };
};

// The current world must be transformed while holding the canonical write
// queue. Never write a snapshot captured before the model response.
export const applyAdvisorProjectProposal = async ({
  proposal, gameDate, round, mutateWorldState, applyProjectOpsToWorld,
} = {}) => {
  if (!Array.isArray(proposal) || proposal.length === 0) return null;
  let items = [];
  const shared = inSharedGame();
  await mutateWorldState((world) => {
    const result = projectOutcome({ world, proposal, gameDate, round, applyProjectOpsToWorld });
    items = result.changes;
    return result.changed && !shared ? result.nextWorld : null;
  });
  if (shared && items.length) await askHostForOps(proposal);
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
  const shared = inSharedGame();
  let anyChange = false;
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
    anyChange = changed;
    return changed && !shared ? staged : null;
  });
  // One request for the whole batch, in the speakers' order, as the one world
  // mutation above is in single player.
  if (shared && anyChange) await askHostForOps(pending.flatMap((entry) => entry.proposal));
  return changesBySpeaker;
};
