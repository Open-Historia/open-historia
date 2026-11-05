/*! Open Historia — explicit player-approved Advisor-to-Actions handoff. AGPL-3.0-or-later. */
import {
  ADVISOR_RECIPIENT_TYPES,
  CHIEF_ADVISOR_THREAD,
  advisorContacts,
  advisorMessagesFor,
  advisorRecipientType,
} from "../../runtime/advisorThreads.js";
import { planApprovedAdvisorAction, recordAdvisorActionReceipt } from "./advisorActionReview.js";

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
  assertReady = () => {},
} = {}) => {
  // Host request "order" currently accepts text only, with no stable proposal
  // ID/acknowledged Action ID. Retrying after a lost ack could issue twice.
  // Refuse instead of presenting a false idempotency guarantee in multiplayer.
  if (sharedGame) {
    throw new Error("Advisor Action review in shared games needs host-backed proposal IDs. Queue through the Actions panel for now.");
  }
  const saved = await readAdvisorMessages({ force: true });
  if (!Array.isArray(saved)) throw new Error("The Advisor conversation could not be read.");
  if (threadId !== CHIEF_ADVISOR_THREAD) {
    const contact = advisorContacts(saved).find((record) => record.id === threadId);
    if (!contact || contact.archived || advisorRecipientType(contact) !== ADVISOR_RECIPIENT_TYPES.MINISTER) {
      throw new Error("Only an active domestic Advisor / Minister conversation may submit player-approved Actions.");
    }
  }
  const messages = advisorMessagesFor(saved, threadId)
    .filter((entry) => entry?.role === "advisor" && entry.id === messageId);
  if (messages.length !== 1) throw new Error("The original Advisor reply was not found or was ambiguous.");
  const message = messages[0];
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
  if (message.actionReceipts?.[proposalId]) return message.actionReceipts[proposalId];

  let planned = null;
  await mutateActionsState((current) => {
    assertReady();
    planned = planApprovedAdvisorAction(current, matches[0], normalizeAction, { repeatOf });
    return planned.changed ? planned.next : null;
  });
  if (!planned) throw new Error("The Action mutation did not produce an accepted result.");
  // A queue write completed (or the same deterministic Action ID already
  // exists). Only now are we allowed to stamp a receipt on the message.
  // If this save fails, a repeat can reconcile against the same Action ID.
  await mutateAdvisorState((entries) => recordAdvisorActionReceipt(
    entries, threadId, messageId, proposalId, planned.receipt,
  ));
  return planned.receipt;
};
