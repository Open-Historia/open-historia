/*! Open Historia — the one order a shared game's changes are applied in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every change to a shared game is one entry here, applied one at a time, in
// the order it came: a player's request, an AI government's answer being
// written, an institution's business, a seat taken or left, and the round's
// own time skip, which is an entry like any other and simply a long one.
//
// So nothing is ever applied between a round's reading of the world and its
// saving of it. Before, the skip read the world, worked for a minute or more,
// then saved what it had read: a player joining or leaving, a fortified line,
// a peace accepted in a chat or a letter between people written meanwhile was
// overwritten, after an "ok". The handlers each checked "is a round being
// resolved?" on their way in, and refused; whatever was already under way
// when the round began was not checked again. Whatever arrives while a round
// is resolved now waits here and is applied straight after it, as the next
// round's.
//
// An entry that needs the AI does its thinking outside, and only its writing
// is an entry (engineMain.js tableTurn): a model's minute never holds up the
// other players' requests.
//
// Runtime-free, so the host's tests drive it as the engine does.

// `label`: an identifier for what an entry is ("round", "who-plays-what", a
// request's type), for the host's log; never words a player reads.
export const createWorldQueue = ({ onSettled = () => {} } = {}) => {
  let tail = Promise.resolve();
  let running = "";
  let waiting = 0;

  // Applies `fn` when its turn comes; resolves or rejects with what it did.
  // An entry that fails does not stop the ones after it.
  const run = (label, fn) => {
    waiting += 1;
    const entry = tail.then(async () => {
      waiting -= 1;
      running = String(label || "a change");
      try {
        return await fn();
      } finally {
        running = "";
        onSettled(label);
      }
    });
    tail = entry.then(() => undefined, () => undefined);
    return entry;
  };

  return {
    run,
    // What is being applied now ("" for nothing), and how many wait behind it.
    get running() {
      return running;
    },
    get waiting() {
      return waiting;
    },
    // Settles once everything asked so far has been applied.
    settled: () => tail,
  };
};
