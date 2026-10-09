/*! Open Historia — a held turn's retry asks nothing it already asked © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip whose Projects board call fails is held with nothing written, and
// Retry runs the whole apply again (gameplay.js retryPendingProjectsJump). The
// steps before the board ask the model too: the timeline curator, and on a thin
// skip the breadth repair with a curator pass of its own. Asked again, they cost
// two or three more requests and could decide differently from the first run,
// so the retry's events were not the ones the player had been shown.
//
// A replay remembers those answers by the order they were asked in. The apply is
// deterministic between requests, so the retry asks the same questions in the
// same order and gets the first run's answers back without a request. Only the
// board call, which is what failed, is asked again. Import-free, so node tests
// can drive it.
//
// A skip that finished while another campaign was open is kept with its replay
// (parkedTurn.js), and by then every question the apply asks before the write
// has been answered: the curator, the breadth repair, the board, the history
// fold and the Stats refresh. Written later, even after a restart (`saved`),
// it asks none of them again.

// A copy in and a copy out: a later step may change what it was handed, and the
// retry must start from the answer as it arrived.
const copy = (value) => {
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
};

// An error, as a replay saves it: what a step that falls back on it reads.
const savedError = (error) => ({ name: String(error?.name || "Error"), message: String(error?.message || error || "") });
const restoredError = (saved) => Object.assign(new Error(String(saved?.message || "")), { name: String(saved?.name || "Error") });

// `saved` is what `saved()` below gave out, for a replay carried over a restart.
export const createTurnReplay = (saved = []) => {
  const answers = (Array.isArray(saved) ? saved : [])
    .filter((entry) => entry && typeof entry === "object" && typeof entry.label === "string")
    .map((entry) => ("error" in entry
      ? { label: entry.label, error: restoredError(entry.error) }
      : { label: entry.label, value: entry.value }));
  let cursor = 0;
  return {
    // Every run of the apply starts at the first answer again.
    rewind() {
      cursor = 0;
    },
    // `ask` is only called when this position has no answer yet. A failure is
    // remembered like an answer, because the step that asked falls back on it
    // and the retry must fall back the same way. A cancel is not: that aborts
    // the turn, which is then not held at all. Nor is any failure asked with
    // `rememberFailure: false`: the board's, which holds the turn so that the
    // board can be asked again.
    async answer(label, ask, { rememberFailure = true } = {}) {
      const index = cursor;
      cursor += 1;
      const known = answers[index];
      if (known && known.label === label) {
        if ("error" in known) throw known.error;
        return copy(known.value);
      }
      // A different question at this position means the run diverged; nothing
      // after it can be trusted, so it is asked afresh from here on.
      answers.length = index;
      try {
        const value = await ask();
        answers[index] = { label, value: copy(value) };
        return value;
      } catch (error) {
        if (rememberFailure && error?.name !== "AbortError") answers[index] = { label, error };
        throw error;
      }
    },
    // Every answer so far as plain data, for createTurnReplay(saved).
    saved() {
      return answers.map((entry) => ("error" in entry
        ? { label: entry.label, error: savedError(entry.error) }
        : { label: entry.label, value: copy(entry.value) }));
    },
  };
};

// Without a replay (an interactive event resolving, a game-master command)
// every question is simply asked.
export const replayAnswer = (replay, label, ask, options) => (replay ? replay.answer(label, ask, options) : ask());
