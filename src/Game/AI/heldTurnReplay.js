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

export const createTurnReplay = () => {
  const answers = [];
  let cursor = 0;
  return {
    // Every run of the apply starts at the first answer again.
    rewind() {
      cursor = 0;
    },
    // `ask` is only called when this position has no answer yet. A failure is
    // remembered like an answer, because the step that asked falls back on it
    // and the retry must fall back the same way. A cancel is not: that aborts
    // the turn, which is then not held at all.
    async answer(label, ask) {
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
        if (error?.name !== "AbortError") answers[index] = { label, error };
        throw error;
      }
    },
  };
};

// Without a replay (an interactive event resolving, a game-master command)
// every question is simply asked.
export const replayAnswer = (replay, label, ask) => (replay ? replay.answer(label, ask) : ask());
