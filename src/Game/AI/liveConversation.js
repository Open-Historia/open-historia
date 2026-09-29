/*! Open Historia — which conversation a reply belongs to © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// main.jsx holds ONE module-level history for the advisor and one for whichever
// diplomatic thread is open, and replaces it whenever a thread is opened, the
// advisor is cleared or a campaign's transcript is loaded. A reply is awaited
// for seconds, sometimes minutes, and the player can do any of those meanwhile:
// press Back on France while France is typing and open Germany, and France's
// reply used to be pushed onto Germany's history and its memory summary written
// over Germany's, so Germany's next answer was written from France's private
// exchange. A failed call popped whatever was last, which by then was Germany's
// own message.
//
// A reply takes the conversation's number before it waits, and writes back only
// while that number is still current. Otherwise the reply goes to its caller
// alone, which saves it with the thread it was asked in.

export const createConversationGeneration = () => {
  let generation = 0;
  return {
    // The number to hold across the wait.
    current: () => generation,
    // The history is being replaced: every reply still in flight is now for a
    // conversation that is not here.
    replace: () => {
      generation += 1;
      return generation;
    },
    isCurrent: (held) => held === generation,
  };
};

// Takes back exactly the entry a failed request added, wherever it now sits,
// rather than whatever happens to be last.
export const removeEntry = (history, entry) => {
  if (!Array.isArray(history)) return false;
  const index = history.lastIndexOf(entry);
  if (index < 0) return false;
  history.splice(index, 1);
  return true;
};
