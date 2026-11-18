/*! Open Historia — what a table's turn leaves of its thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host's engine runs a table's turn (engineMain.js tableTurn): the AI
// governments at it answer, and the thread is saved the way the chat panel
// saves it, with the turn's log as the thread's own. These are the two
// questions that saving asks, kept apart from the engine window so they can be
// tested without one.

import { eventsFromLegacyChat, normalizeChatEvents, projectChatThread } from "../../runtime/chatThreads.js";

// Whether a turn's outcome is the thread's new log. Not when the game's own
// institution functions have already written it (`committed`), and not when
// the turn has no log to give: nobody at the table was the AI's to answer for
// (everyone left at it is a person, or its owner left the game), or the thread
// could not be read. An empty log written over a thread took its members with
// it, and a thread with no members is dropped on the save: the conversation
// was gone from every screen.
export const turnWritesThread = (outcome) => Boolean(outcome)
  && !outcome.committed
  && Array.isArray(outcome.events)
  && outcome.events.length > 0;

// Whether a vote in a thread waits for a ballot from one of `governments`: a
// poll some government the AI plays at the table has not voted in. A ballot is
// cast in the table's turn on the host (AI/chatActions.js poll_vote), which
// only the host's own game can carry out: with settings.replies "own" a
// player's device writes the governments' words alone, and a vote a player
// called stood with people's ballots only (the gap audit of 2026-11-18).
export const votesAwaited = (chat, governments = []) => {
  const names = (Array.isArray(governments) ? governments : []).map((name) => String(name ?? "").trim().toLocaleLowerCase()).filter(Boolean);
  if (!chat || !names.length) return false;
  const log = Array.isArray(chat.events) && chat.events.length ? chat.events : eventsFromLegacyChat(chat);
  const polls = projectChatThread(normalizeChatEvents(log)).polls ?? [];
  return polls.some((poll) => Array.isArray(poll?.options) && poll.options.length >= 2
    && names.some((name) => !Object.keys(poll.votes ?? {}).some((voter) => voter.trim().toLocaleLowerCase() === name)));
};

// A stored thread with what a turn said added to its log as it stands now; what
// is read from the log (who is in it, its title, its votes and demands) is kept
// beside it, as the panel keeps it. Added, not replaced: the turn read the
// thread before the model answered, and a line written meanwhile (another
// player's, another answer's) was lost when the turn wrote back its own copy.
// `outcome.newEvents`: what this turn said and did; an outcome that carries
// only its whole log (an older caller) is taken as before.
export const threadAfterTurn = (entry, outcome) => {
  const now = normalizeChatEvents(Array.isArray(entry?.events) && entry.events.length ? entry.events : eventsFromLegacyChat(entry));
  const added = Array.isArray(outcome?.newEvents) ? outcome.newEvents : null;
  const known = new Set(now.map((event) => String(event?.id ?? "")));
  const events = added
    ? normalizeChatEvents([...now, ...added.filter((event) => !known.has(String(event?.id ?? "")))])
    : outcome.events;
  const projected = projectChatThread(events);
  return {
    ...entry,
    events,
    countries: projected.countries ?? entry.countries,
    title: projected.title || entry.title,
    polls: projected.polls ?? entry.polls,
    demands: projected.demands ?? entry.demands,
  };
};
