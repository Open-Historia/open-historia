/*! Open Historia — the checks a time skip makes after its events, held on failure © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// After a skip's events are written by the model, the game asks more of it:
// which units move, whose ground is held, what was built, which events are
// filler, which orders were answered, how the board moves. With "Save AI
// requests" on that is one request (turnReview.js); with it off, one each.
//
// Each of those fails open by itself, which used to mean the turn landed with
// none of it done and no word to the player. Now a failed check holds the turn,
// unwritten, and the player retries, continues without, or discards.
//
// This is what makes the retry cheap and "continue without" free: every check's
// answer is kept for the held turn, by the check and what it was asked about. A
// retry runs the turn's finish again, and a check asked the same thing is given
// its answer back rather than asked again; only the ones that failed are asked.
// A check asked about something different (the timeline clean-up, shown events
// a retried search produced afresh) is asked, never handed an answer about
// other events. Once the player continues
// without, the failed answers are given back as they are (the fail-open
// fallback) and nothing is asked at all.
//
// A check that answered with nothing to change has answered. Failure is the
// request failing or its answer not being usable — the caller says which.
//
// DELIBERATELY IMPORT-FREE.

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

// Player-facing names, for the held notice.
const CHECK_LABELS = Object.freeze({
    review: "the turn review",
    units: "unit moves",
    territory: "territory control",
    structures: "structures",
    timeline: "the timeline clean-up",
    actions: "which orders were carried out",
    breadth: "the search for more events",
});

export const describeCheck = (check) => CHECK_LABELS[check] ?? String(check ?? "a check");

export const createTurnChecks = () => {
    const answers = new Map();
    let accepted = false;
    return {
        // check names the check (CHECK_LABELS); `about` is what it was asked,
        // when one check is asked more than once in a turn. ask() makes the
        // request; failureOf(answer) is a reason string when the answer is a
        // failure, or "" when it is usable. A throw from ask() is not kept: it
        // is the caller's to handle, as it was before.
        run: async (check, ask, failureOf = () => "", { about = "" } = {}) => {
            const key = JSON.stringify([check, about]);
            const kept = answers.get(key);
            if (kept && (!kept.reason || accepted)) return copy(kept.answer);
            const answer = await ask();
            answers.set(key, { check, answer: copy(answer), reason: String(failureOf(answer) || "") });
            return answer;
        },
        failures: () => [...answers.values()]
            .filter((entry) => entry.reason)
            .map((entry) => ({ check: entry.check, reason: entry.reason })),
        // The player chose to go on without the checks that failed; false
        // takes that back (a cancelled Continue).
        accept: (on = true) => { accepted = on === true; },
        get accepted() { return accepted; },
    };
};

// Whether the turn is held: something failed, and the player has not yet
// chosen to go on without it.
export const checksHoldTurn = (checks) => Boolean(checks && !checks.accepted && checks.failures().length);

// The turn is generated and waiting on its checks, not lost. Flagged so the UI
// can tell it apart from an ordinary failure and offer the checks again, the
// turn without them, or a discard.
export const checksHeldError = (failures) => {
    const list = Array.isArray(failures) ? failures : [];
    const what = list.length
        ? list.map(({ check, reason }) => `${describeCheck(check)} (${reason})`).join("; ")
        : "a check did not come back";
    const error = new Error(
        "Your events are ready, but the checks that move units, take ground, build structures and tidy the "
        + `turn did not all come back, so nothing has been saved yet: ${what}. `
        + "Retry the checks, continue without them, or discard the turn.",
    );
    // simulationStatus.js HELD_TURN.checks; spelled out to keep this file
    // import-free (checksHold.test.js pins the two together).
    error.heldKind = "checks";
    return error;
};
