/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// How the Workshop's saves take turns, and what it does with unsaved work
// before the document is closed or replaced. React-free, so the rules run
// under node --test (documentSaving.test.js); MapEditor.jsx wires them up.

// One save at a time. `attempt` does the writing and resolves true when the
// document is saved with nothing left over. A call made while a save is running
// waits for it and then runs once more, however many calls came in meanwhile.
// Two saves used to run side by side — an autosave and the flush when the tab
// was hidden — and with no document id yet both of them created a document.
export const createSaveRunner = (attempt) => {
  let running = null;
  let queued = null;
  const run = () => {
    if (!running) {
      running = Promise.resolve()
        .then(attempt)
        .finally(() => { running = null; });
      return running;
    }
    if (!queued) {
      queued = running
        .catch(() => {})
        .then(() => {
          queued = null;
          return run();
        });
    }
    return queued;
  };
  // Resolves once no save is running or waiting. Opening or starting another
  // map waits for this: a save landing after the swap would record the old
  // map's regions as what the new one last wrote.
  run.idle = async () => {
    while (running || queued) await (queued || running).catch(() => {});
  };
  return run;
};

// After a failed save the editor tries again on its own after each of these
// waits, then stops: the "Save failed" chip still offers Retry, and the next
// edit saves anyway. `failures` is how many automatic retries have been made.
export const SAVE_RETRY_DELAYS_MS = [5000, 15000, 60000];
export const saveRetryDelay = (failures) => SAVE_RETRY_DELAYS_MS[failures] ?? null;

// Whether a save status means the author's work is not safely stored yet.
export const isUnsavedStatus = (status) => status === "dirty" || status === "saving" || status === "error";

// Before the Workshop closes or replaces its document. Unsaved work — edits
// still in the autosave's two seconds, a save in flight, a save that failed —
// is saved first, and the author is asked only when that save does not land.
// `save` resolves true once the document is saved; `confirm` is asked the
// question and answers whether to go on anyway. Resolves true to go on.
export const settleUnsavedWork = async ({ status, save, confirm, question }) => {
  if (!isUnsavedStatus(status)) return true;
  if (await save()) return true;
  return Boolean(confirm(question));
};
