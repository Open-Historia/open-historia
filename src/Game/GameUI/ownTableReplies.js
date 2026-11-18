/*! Open Historia — the chat panel's hold on replies this device writes in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game whose host has each player's own device answer for the
// governments the AI plays (multiplayer/client/ownReplies.js), this is that
// device's one runner: it reads the thread from the page's own view, asks the
// page's own model (AI/gameplay.js writeTableReply) and sends the host the
// words. It lives outside the chat panel, so an answer being written goes on
// when the player leaves the thread, and the panel finds it on coming back.

import { useSyncExternalStore } from "react";
import { createOwnReplies } from "../../multiplayer/client/ownReplies.js";
import { requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";
import { readChatsState } from "../../runtime/gameState.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { writeTableReply } from "../AI/gameplayLazy.js";

const replies = createOwnReplies({
  readThread: async (thread) => {
    const chats = await readChatsState({ force: true });
    return (Array.isArray(chats) ? chats : []).find((chat) => String(chat?.id ?? "") === thread) ?? null;
  },
  write: ({ chat, text, governments, playerCountry }) => writeTableReply({ chat, playerCountry, playerMessage: text, governments }),
  send: (fields) => requestFromHost("reply", fields),
  // The model answering that nobody speaks is no fault; the rest are.
  log: (text, why) => logDebugEvent("shared game", text, undefined, { problem: why !== "silent" }),
});

// Answer a line the host left to this device ({ thread, line, governments }
// from client/ownReplies.js ownReplyAsked, with the player's `text` and country).
export const answerOnThisDevice = (asked) => replies.start(asked);
export const retryOwnReply = (thread) => replies.retry(thread);
export const dismissOwnReply = (thread) => replies.dismiss(thread);

// The answer this device is writing for a thread, or what stopped it; null when there is none.
export const useOwnReply = (thread) => useSyncExternalStore(
  replies.subscribe,
  () => replies.get(thread),
);
