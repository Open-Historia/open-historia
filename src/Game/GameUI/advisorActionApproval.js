/*! Open Historia — explicit player-approved Advisor-to-Actions handoff. AGPL-3.0-or-later. */
import {
  ADVISOR_RECIPIENT_TYPES,
  CHIEF_ADVISOR_THREAD,
  advisorContacts,
  advisorGroups,
  advisorMessagesFor,
  advisorRecipientType,
} from "../../runtime/advisorThreads.js";
import { planApprovedAdvisorAction, planCancelApprovedAdvisorAction, recordAdvisorActionReceipt } from "./advisorActionReview.js";

// What the host is asked for an approved proposal or a cancellation, in a
// shared game: an order by the proposal's own id (the host queues it once,
// however often it is asked, so a lost answer can be asked again), a queued
// order given other words, or one withdrawn.
export const hostRequestForProposal = (proposal, { cancel = false } = {}) => {
  if (cancel) return ["unorder", { order: proposal.actionId }];
  if (proposal.operation === "create") {
    return ["order", {
      text: proposal.text || proposal.title,
      title: proposal.title || proposal.text,
      ref: proposal.actionId,
      source: "advisor",
      kind: proposal.kind === "chat" ? "chat" : "action",
    }];
  }
  if (proposal.operation === "edit") {
    return ["reword", { order: proposal.targetId, ...(proposal.title ? { title: proposal.title } : {}), ...(proposal.text ? { text: proposal.text } : {}) }];
  }
  return ["unorder", { order: proposal.targetId }];
};

// The Actions queue an approval changes. In single player it is the game's
// own, written under its lock. In a shared game it is the host's: the plan is
// made on the queue as the player's view holds it, and the change is asked of
// the host, whose answer is the write. The same plan, the same refusals.
const changeQueue = async ({ sharedGame, readActions, requestFromHost, mutateActionsState, assertReady }, plan, request) => {
  if (!sharedGame) {
    let planned = null;
    await mutateActionsState((current) => {
      assertReady();
      planned = plan(current);
      return planned?.changed ? planned.next : null;
    });
    return planned;
  }
  if (typeof readActions !== "function" || typeof requestFromHost !== "function") {
    throw new Error("The shared game's queue could not be reached.");
  }
  const current = await readActions();
  assertReady();
  const planned = plan(Array.isArray(current) ? current : []);
  if (planned?.changed) {
    const [kind, fields] = request;
    const answer = await requestFromHost(kind, fields);
    if (!answer?.ok) throw new Error(answer?.error || "The host did not take that.");
  }
  return planned;
};

// Identity and recipient authority are re-read from persisted Advisor state
// before both approvals and cancellations. The displayed card is not authority.
// The Advisor conversation is the device's own, in a shared game too.
const readReviewedProposal = async ({
  threadId, messageId, proposalId, readAdvisorMessages,
}) => {
  const saved = await readAdvisorMessages({ force: true });
  if (!Array.isArray(saved)) throw new Error("The Advisor conversation could not be read.");
  const group = advisorGroups(saved).find((item) => item.id === threadId);
  if (threadId !== CHIEF_ADVISOR_THREAD && !group) {
    const contact = advisorContacts(saved).find((record) => record.id === threadId);
    if (!contact || contact.archived || advisorRecipientType(contact) !== ADVISOR_RECIPIENT_TYPES.MINISTER) {
      throw new Error("Only an active domestic Advisor / Minister conversation may submit player-approved Actions.");
    }
  }
  const messages = advisorMessagesFor(saved, threadId)
    .filter((entry) => entry?.role === "advisor" && entry.id === messageId);
  if (messages.length !== 1) throw new Error("The original Advisor reply was not found or was ambiguous.");
  const message = messages[0];
  if (group) {
    const member = advisorContacts(saved).find((row) => row.id === message.speakerId);
    if (group.archived || !group.memberIds?.includes(message.speakerId)
        || (message.speakerId !== CHIEF_ADVISOR_THREAD
          && (!member || member.archived || advisorRecipientType(member) !== ADVISOR_RECIPIENT_TYPES.MINISTER))) {
      throw new Error("Only a current invited Advisor / Minister may submit a group Action for player review.");
    }
  }
  const proposals = Array.isArray(message.actionProposals) ? message.actionProposals : [];
  const matches = proposals.filter((proposal) => proposal?.id === proposalId);
  if (matches.length !== 1) throw new Error("The requested Action proposal is missing or ambiguous.");
  // Proposal indices identify positions in the RAW model block. Malformed
  // entries can be rejected ahead of a valid one, leaving gaps. Preserve those
  // source indices across save/reload; never renumber by filtered-list position.
  const sourceIndex = /^proposal-(\d{1,2})$/.exec(matches[0].id)?.[1];
  if (sourceIndex === undefined || Number(sourceIndex) >= 24
      || matches[0].actionId !== `action-${messageId}-${sourceIndex}`
      || proposals.some((candidate) => candidate !== matches[0]
        && (candidate?.id === matches[0].id || candidate?.actionId === matches[0].actionId))) {
    throw new Error("The Advisor Action proposal does not match its original message identity.");
  }
  const proposal = matches[0];
  if (group && proposal.operation !== "create" && proposal.targetId?.startsWith("action-advisor-reply-")) {
    // The model sees every queued order in the group context. A minister
    // revising their own *unqueued* proposal must not accidentally overwrite
    // a different member's already-approved Action by copying its ID.
    // Provenance is the immutable originating saved proposal, not a title
    // (titles may collide) or the model's claim of who owns the order.
    const origin = saved.filter((entry) => entry?.role === "advisor"
      && entry.actionProposals?.some((item) =>
        item?.operation === "create" && item.actionId === proposal.targetId));
    const conversation = advisorMessagesFor(saved, threadId);
    const replyIndex = conversation.findIndex((row) => row?.role === "advisor" && row.id === messageId);
    const latestUserText = replyIndex < 0 ? "" : String(conversation.slice(0, replyIndex)
      .reverse().find((row) => row?.role === "user")?.text || "");
    if (origin.length > 1) {
      throw new Error("The targeted Advisor Action has ambiguous original ownership.");
    }
    const originalSpeaker = origin.length === 1
      ? (origin[0].speakerId || origin[0].threadId || CHIEF_ADVISOR_THREAD) : "";
    if ((!originalSpeaker || originalSpeaker !== message.speakerId)
        && !latestUserText.includes(proposal.targetId)) {
      throw new Error("This edit targets another advisor's queued Action, or its author cannot be verified. Ask for a new proposal to revise an unqueued draft; to change this specific queued Action, identify its exact Action ID in your instruction.");
    }
  }
  return { message, proposal };

};

// All dependencies are the existing canonical runtime service methods. Keeping
// the commit seam separate from the React button lets us test actual write
// ordering and failure behavior, not merely whether a button was rendered.
export const approveAdvisorAction = async ({
  threadId,
  messageId,
  proposalId,
  readAdvisorMessages,
  mutateActionsState,
  mutateAdvisorState,
  normalizeAction,
  repeatOf,
  sharedGame = false,
  readActions = null,
  requestFromHost = null,
  assertReady = () => {},
} = {}) => {
  const { message, proposal } = await readReviewedProposal({
    threadId, messageId, proposalId, readAdvisorMessages,
  });
  // Cancelled creates can be re-queued with their original deterministic ID.
  // A receipt for an edit/remove stays a terminal, acknowledged operation.
  const previous = message.actionReceipts?.[proposalId];
  if (previous && previous.status !== "cancelled") return previous;

  const planned = await changeQueue(
    { sharedGame, readActions, requestFromHost, mutateActionsState, assertReady },
    (current) => planApprovedAdvisorAction(current, proposal, normalizeAction, { repeatOf }),
    hostRequestForProposal(proposal),
  );
  if (!planned) throw new Error("The Action mutation did not produce an accepted result.");
  // A queue write completed (or the same deterministic Action ID already
  // exists). Only now are we allowed to stamp a receipt on the message.
  // If this save fails, a repeat can reconcile against the same Action ID.
  await mutateAdvisorState((entries) => recordAdvisorActionReceipt(
    entries, threadId, messageId, proposalId, planned.receipt,
  ));
  return planned.receipt;
};

// Cancel only the specific CREATE Action while it is still planned. The same
// persisted message identity, minister authority and deterministic Action ID
// are rechecked as on approval. The queue is mutated under its native lock.
export const cancelApprovedAdvisorAction = async ({
  threadId,
  messageId,
  proposalId,
  readAdvisorMessages,
  mutateActionsState,
  mutateAdvisorState,
  sharedGame = false,
  readActions = null,
  requestFromHost = null,
  assertReady = () => {},
} = {}) => {
  const { message, proposal } = await readReviewedProposal({
    threadId, messageId, proposalId, readAdvisorMessages,
  });
  if (proposal.operation !== "create") {
    throw new Error("Only a newly queued Advisor Action can be cancelled from its proposal card.");
  }
  const previous = message.actionReceipts?.[proposalId];
  let alreadyCancelled = false;
  const planned = await changeQueue(
    { sharedGame, readActions, requestFromHost, mutateActionsState, assertReady },
    (current) => {
      if (!Array.isArray(current) || !current.some((order) => order?.id === proposal.actionId)) {
        if (previous?.status === "cancelled") {
          alreadyCancelled = true;
          return null;
        }
        throw new Error("This Action is no longer queued. Check the Actions panel.");
      }
      return planCancelApprovedAdvisorAction(current, proposal);
    },
    hostRequestForProposal(proposal, { cancel: true }),
  );
  if (alreadyCancelled) return previous;
  if (!planned) throw new Error("The Action cancellation did not produce an accepted result.");
  // Removing the queued Action must precede recording cancellation. A failed
  // receipt write is detectable; it must not silently restore the old order.
  await mutateAdvisorState((entries) => recordAdvisorActionReceipt(
    entries, threadId, messageId, proposalId, planned.receipt,
  ));
  return planned.receipt;
};
