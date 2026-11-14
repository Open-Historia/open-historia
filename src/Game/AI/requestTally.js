/*! Open Historia — every AI call the game has open, and how many a turn has made, for the badge on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/requestTally.test.js
//
// requestActivity.js tells the skip's progress row what the one request a
// player is watching a spinner for is doing. It leaves out, on purpose, every
// call nobody waits on: a stat sheet filling in, a country writing between
// skips, a translation. Those are most of what a quiet game sends, and a player
// on a slow local model or a metered key could not tell "the game is idle"
// from "the game has had a request open for four minutes", nor how many calls
// the turn just played had cost.
//
// So callAI (main.jsx) reports EVERY call here, watched or not, when it starts
// and when it ends, and the badge (GameUI/AiActivityBadge.jsx) reads it. This
// counts calls, not HTTP requests: one call can be several requests (a retry,
// a lookup round, the Fallback list), and the request budget
// (requestBudget.js) is what counts those against a daily allowance.
//
// Nothing here changes what is sent or what is done with an answer.
//
// Import-free, with the clock handed in, so it is tested under bare node.

const EMPTY = Object.freeze({ open: Object.freeze([]), sinceTurn: 0, unansweredSinceTurn: 0, lastTurn: null, last: null });

// { begin(taskKey) → id, end(id, answered), newTurn(),
//   current() → snapshot, subscribe(listener) → unsubscribe }
//
// The snapshot is a new frozen object only when something changed, so it can
// be handed to useSyncExternalStore as it is.
export const createRequestTally = ({ now = () => Date.now() } = {}) => {
    const open = new Map(); // id -> { taskKey, startedAt }, in the order they began
    const listeners = new Set();
    let lastId = 0;
    let snapshot = EMPTY;

    const publish = (patch) => {
        snapshot = Object.freeze({ ...snapshot, ...patch, open: Object.freeze([...open.values()]) });
        for (const listener of [...listeners]) {
            try { listener(); } catch { /* a listener that throws must never cost a call its answer */ }
        }
    };

    return {
        // A call is about to be made. The id is handed back to end().
        begin(taskKey = "") {
            const id = (lastId += 1);
            open.set(id, Object.freeze({ taskKey: String(taskKey || ""), startedAt: now() }));
            publish({ sinceTurn: snapshot.sinceTurn + 1 });
            return id;
        },
        // The call is over: it returned an answer, or it threw (a failure, a
        // cancel). Ending one twice, or one that never began, does nothing.
        end(id, answered) {
            const call = open.get(id);
            if (!call) return;
            open.delete(id);
            publish({
                unansweredSinceTurn: snapshot.unansweredSinceTurn + (answered ? 0 : 1),
                last: Object.freeze({ taskKey: call.taskKey, ms: Math.max(0, now() - call.startedAt), answered: Boolean(answered) }),
            });
        },
        // The game's date moved: the counts start again, and what the turn
        // that just landed made is kept as lastTurn, because the moment a skip
        // lands is exactly when a player looks up to see what it cost. A call
        // still open belongs to the new turn, where it will end.
        newTurn() {
            publish({
                lastTurn: Object.freeze({ calls: snapshot.sinceTurn - open.size, unanswered: snapshot.unansweredSinceTurn }),
                sinceTurn: open.size,
                unansweredSinceTurn: 0,
            });
        },
        current: () => snapshot,
        subscribe(listener) {
            if (typeof listener !== "function") return () => {};
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
};

// The one the game uses: main.jsx callAI reports to it, the badge reads it.
export const requestTally = createRequestTally();

// The call to name on the badge when several are open: the one open longest,
// which is the one a player has been waiting on.
export const longestOpen = (snapshot) =>
    (snapshot?.open || []).reduce((oldest, call) => (!oldest || call.startedAt < oldest.startedAt ? call : oldest), null);
