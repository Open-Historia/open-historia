/*! Open Historia — what a table's turn leaves of its thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host's engine runs a table's turn (engineMain.js tableTurn): the AI
// governments at it answer, and the thread is saved the way the chat panel
// saves it, with the turn's log as the thread's own. These are the two
// questions that saving asks, kept apart from the engine window so they can be
// tested without one.

import { projectChatThread } from "../../runtime/chatThreads.js";

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

// A stored thread with a turn's log as its own; what is read from the log
// (who is in it, its title, its votes and demands) is kept beside it, as the
// panel keeps it.
export const threadAfterTurn = (entry, outcome) => {
  const projected = projectChatThread(outcome.events);
  return {
    ...entry,
    events: outcome.events,
    countries: projected.countries ?? entry.countries,
    title: projected.title || entry.title,
    polls: projected.polls ?? entry.polls,
    demands: projected.demands ?? entry.demands,
  };
};
