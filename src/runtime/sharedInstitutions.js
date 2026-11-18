/*! Open Historia — a shared game's institutions, asked of the host © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game a player's screen writes nothing to the game (the host's
// engine owns it), so the institution functions here (institutionLifecycle.js,
// institutionalGovernance.js, institutionalChannels.js) ask the host instead
// when the page plays one: the host runs the same function for this player's
// country (multiplayer/host/institutions.js), and the change comes back in the
// next view of the game. Founding an institution in a shared game used to end
// in a refused write ("409").
//
// The screens use what these functions return to go on: the institution or
// proposal to show, the thread to open. The host answers with their ids, and a
// thread it made is looked for in the documents the page holds until the view
// with it has come.

import { inSharedGame, requestFromHost } from "../multiplayer/client/sharedGameBridge.js";
import { readChatsState } from "./gameState.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const institutionsGoToHost = () => inSharedGame();

// The thread the host made or opened, once this page holds it; null when the
// view has not brought it in time (the screens then simply do not open it).
const threadFromView = async (id, { readChats = () => readChatsState({ force: true }), waitMs = 8000 } = {}) => {
  if (!id) return null;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const found = (await readChats().catch(() => [])).find?.((chat) => clean(chat?.id) === id) ?? null;
    if (found || Date.now() >= deadline) return found;
    await wait(250);
  }
};

// `call` and `args`: game/messages.js INSTITUTION_CALLS. Resolves what the
// screens read of the game's own results ({ institution, proposal,
// createdChat, channel }), or throws the host's reason.
// The host's answer is waited for however long it takes: one asked while a
// round is resolved waits for the round (host/requestWaits.js), and a deadline
// of its own here told the player it failed, then the host did it.
export const askHostForInstitution = async (call, args = {}, options = {}) => {
  const answer = await requestFromHost("institution", { call, args });
  if (!answer?.ok) throw new Error(answer?.error || "The host did not do that.");
  const made = answer.result ?? {};
  const chat = await threadFromView(clean(made.chatId), options);
  return {
    shared: true,
    institution: made.institutionId ? { id: clean(made.institutionId) } : null,
    proposal: made.proposalId ? { id: clean(made.proposalId), status: clean(made.proposalStatus) } : null,
    createdChat: chat,
    channel: chat,
  };
};
