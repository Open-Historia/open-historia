/*! Open Historia — bounded world-repair calls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One world-repair AI call (the motion or breadth repair) under three limits.
// Each aborts a LOCAL controller, so the caller's own signal stays un-aborted:
// the repair's catch then sees an ordinary failure and the turn carries on,
// while the player's Cancel still cancels.
//
//   * firstByteMs with no answer at all, and idleMs of silence once an answer
//     has started — the two windows in idleDeadline.js;
//   * hardLimitMs in total, when the caller has a time budget to keep. This one
//     holds however live the stream is.
//
// The third is what makes the motion repair's per-skip time budget a real cap.
// It used to be checked only before a repair started, so the last repair of a
// pass could run a whole idle window past it — or indefinitely, if a model kept
// trickling tokens, since every token re-arms the idle window.
//
// Lives outside gameplay.js so it can be tested: gameplay.js cannot be loaded by
// `node --test`. Its only import, idleDeadline.js, is import-free.

import { AI_FIRST_BYTE_TIMEOUT_MS, AI_IDLE_TIMEOUT_MS, createIdleDeadline } from "./idleDeadline.js";

// `error.repairStop` on a call stopped by its own limits, so a caller can tell
// the model going quiet from the pass running out of time.
export const REPAIR_STOP_STALLED = "stalled";
export const REPAIR_STOP_TIME_BUDGET = "time-budget";

// `call` receives { signal, deadline, onActivity } and returns the provider's
// promise. `hardLimitMs` defaults to no limit; 0 or less means the time is
// already spent, so nothing is called at all.
export const runBoundedRepairCall = async (call, {
  taskKey = "repair",
  signal = null,
  idleMs = AI_IDLE_TIMEOUT_MS,
  firstByteMs = AI_FIRST_BYTE_TIMEOUT_MS,
  hardLimitMs = Infinity,
} = {}) => {
  const stalled = Object.assign(
    new Error(`AI task "${taskKey}" timed out: the model stopped answering.`),
    { repairStop: REPAIR_STOP_STALLED },
  );
  const outOfTime = Object.assign(
    new Error(`AI task "${taskKey}" stopped: the time for repairs ran out.`),
    { repairStop: REPAIR_STOP_TIME_BUDGET },
  );
  const limited = Number.isFinite(hardLimitMs);
  if (limited && hardLimitMs <= 0 && !signal?.aborted) throw outOfTime;

  const controller = new AbortController();
  const forwardCancel = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", forwardCancel, { once: true });
  }
  const idle = createIdleDeadline({ idleMs, firstByteMs }, () => controller.abort(stalled));
  const hardTimer = limited ? setTimeout(() => controller.abort(outOfTime), hardLimitMs) : null;
  const hardDeadline = limited ? Date.now() + hardLimitMs : null;
  // Which of these limits stopped the call, if one did and the player did not.
  const ownStop = () => {
    const reason = controller.signal.reason;
    return !signal?.aborted && (reason === stalled || reason === outOfTime) ? reason : null;
  };
  idle.start();
  try {
    // A provider's busy-retry must not sleep past whichever limit comes first.
    const deadlines = [idle.deadline, hardDeadline].filter((value) => Number.isFinite(value));
    const result = await call({
      signal: controller.signal,
      deadline: deadlines.length ? Math.min(...deadlines) : null,
      onActivity: idle.note,
    });
    // Stopped is stopped, even when a provider answers the abort with whatever
    // it had so far: a cut-off answer would only fail as a bad repair, and be
    // held against the storyline instead of against the clock.
    const stop = ownStop();
    if (stop) throw stop;
    return result;
  } catch (error) {
    // The provider may surface the abort as a generic AbortError; name the limit.
    throw ownStop() ?? error;
  } finally {
    idle.cancel();
    if (hardTimer !== null) clearTimeout(hardTimer);
    signal?.removeEventListener?.("abort", forwardCancel);
  }
};
