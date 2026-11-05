/*! Open Historia — one job at a time © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs async jobs one after another, in the order they were queued: each job
// starts when the one before it has settled, whether it succeeded or failed.
// For work that reads a file, changes it and writes it back, where two jobs
// running at once would each write over the other's change.

export const createSerialQueue = () => {
    let tail = Promise.resolve();
    return (job) => {
        const run = tail.then(() => job());
        tail = run.catch(() => {});
        return run;
    };
};
