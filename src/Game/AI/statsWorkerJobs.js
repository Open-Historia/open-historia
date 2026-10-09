/*! Open Historia — sharing the Stats worker between jobs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One module-level worker computes and saves Stats sheets (gameplay.js
// getCountryStatsWorker) for every job at once: the sheet the player opened, a
// first reading from a chat, a skip's refresh. Import-free, so node tests can
// drive it.

// A cancelled job leaves the pending map. Only when nobody else is waiting on
// the worker may it be stopped to preempt the cancelled job's CPU-bound work.
// Stopping it with others in flight rejected them with the cancel: a first
// reading saving its finished sheet was lost when the player picked another
// country, and its request was made again later.
export const abandonWorkerJob = (pending, id) => {
  pending.delete(id);
  return pending.size === 0;
};

// A worker that failed is set aside for the session only after `limit` failures
// in a row. One hiccup (world.json read in the middle of a write) used to send
// every later Stats sheet to the main thread until a restart, which weighs most
// on phones. A success clears the streak.
export const createWorkerFailureStreak = (limit = 3) => {
  let failures = 0;
  return {
    // true once the worker should not be used again this session.
    failed() {
      failures += 1;
      return failures >= limit;
    },
    succeeded() {
      failures = 0;
    },
  };
};
