/*! Open Historia — what the open AI request is doing, for the skip's progress row © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/requestActivity.test.js
//
// A player on a thinking model behind a slow provider started nine skips in
// fourteen minutes. Seven they cancelled by hand, between 11 and 215 seconds
// in, and one was lost to a reload of the page. Nothing had failed: the one
// open request had simply not answered yet, and for all of that time the panel
// showed a spinner and one unchanging line, with nothing to say that the
// request was alive, how long it had run, or that a model can take this long.
// The ninth was left alone and landed after eleven minutes. The provider's own
// error for the cancelled ones, "the client connection closed before the
// response was fully delivered", was the game hanging up.
//
// So the request path says what it is doing as it goes, and the skip's progress
// row (GameUI/time.jsx SkipProgressRow) reads it. A request is in one of three
// states, in the order it passes through them:
//
//   waiting   sent, and nothing has come back yet: the prompt is being
//             evaluated, or the request is queued, or the endpoint answers all
//             at once and so never leaves this state
//   thinking  the last thing to arrive was reasoning
//   writing   the last thing to arrive was answer text or tool-call arguments
//
// Reported from main.jsx: callAI tracks each gameplay call, every provider
// caller says when a request goes out, and the stream readers
// (streamAssembly.js) say what each frame carried. When no request is open the
// skip is doing its own work, and there is nothing to show.
//
// Listeners hear a change in what would be SHOWN (a request opening or closing,
// a state changing), never each chunk: a row that follows this re-renders a few
// times a request, not a few times a second. The clock on the row is the row's
// own.
//
// Import-free, with the clock handed in, like skipPhases.js, so it is tested
// under bare node.

export const REQUEST_STATE = Object.freeze({ waiting: "waiting", thinking: "thinking", writing: "writing" });

// How long a request is open before the row adds that a slow model can take
// several minutes. Long enough that an ordinary request is over first.
export const STILL_WORKING_AFTER_MS = 60000;

const chars = (value) => {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

export const createRequestActivity = ({ now = () => Date.now() } = {}) => {
    // Open requests by id, in the order they were sent.
    const open = new Map();
    const listeners = new Set();
    let nextId = 1;

    // With several open (the checks after a skip can run side by side), the one
    // to show is the one that last received something; among those that have
    // received nothing, the one that has waited longest.
    const shown = () => {
        let best = null;
        for (const request of open.values()) {
            if (!best || (request.receivedAt ?? -Infinity) > (best.receivedAt ?? -Infinity)) best = request;
        }
        return best;
    };

    const signature = () => {
        const request = shown();
        return request ? `${request.id}:${request.state}` : "";
    };

    const tell = () => {
        for (const listener of [...listeners]) {
            try { listener(); } catch { /* a listener that throws must never cost a request */ }
        }
    };

    // Runs a change and tells the listeners only if what would be shown moved.
    const change = (apply) => {
        const before = signature();
        apply();
        if (signature() !== before) tell();
    };

    return {
        // One per AI call. `label` names the call for the log ('task "jumpForward"'),
        // and a call that was given none is named by its task. A call makes its
        // requests one after another (a lookup round, a retry, the next Fallback
        // entry), so it has at most one open at a time.
        track({ label = "", taskKey = "" } = {}) {
            const name = String(label || (taskKey ? `task "${taskKey}"` : ""));
            let id = 0;
            return {
                // A request is going out. Whatever this call had open is over.
                sent() {
                    change(() => {
                        if (id) open.delete(id);
                        id = nextId;
                        nextId += 1;
                        open.set(id, {
                            id,
                            label: name,
                            sentAt: now(),
                            receivedAt: null,
                            state: REQUEST_STATE.waiting,
                            reasoningChars: 0,
                            answerChars: 0,
                        });
                    });
                },
                // What one frame of the stream carried, in characters. A frame
                // with both counts as writing: the answer has started.
                received({ reasoning = 0, answer = 0 } = {}) {
                    const request = open.get(id);
                    const thought = chars(reasoning);
                    const written = chars(answer);
                    if (!request || (!thought && !written)) return;
                    change(() => {
                        request.reasoningChars += thought;
                        request.answerChars += written;
                        request.receivedAt = now();
                        request.state = written ? REQUEST_STATE.writing : REQUEST_STATE.thinking;
                    });
                },
                // The request is over: answered, refused or failed. Safe to call
                // twice, and with nothing open.
                done() {
                    if (!id) return;
                    change(() => {
                        open.delete(id);
                        id = 0;
                    });
                },
            };
        },

        // What the row shows, or null when no request is open.
        current() {
            const request = shown();
            if (!request) return null;
            const openMs = Math.max(0, now() - request.sentAt);
            return {
                label: request.label,
                state: request.state,
                openMs,
                stillWorking: openMs >= STILL_WORKING_AFTER_MS,
                reasoningChars: request.reasoningChars,
                answerChars: request.answerChars,
                openRequests: open.size,
            };
        },

        // Returns the unsubscribe.
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
};

// The game's own: one page, one request path.
export const requestActivity = createRequestActivity();

const seconds = (ms) => `${Math.round(Math.max(0, Number(ms) || 0) / 1000)} s`;
const count = (value) => chars(value).toLocaleString("en-US");

// The same snapshot in the words the log keeps when the player cancels: how
// long the open request had run and what had come back. The player's log said
// "Turn cancelled by the player." for each of the seven and nothing else, and
// whether the request had been alive each time had to be worked out from what
// was missing.
export const describeOpenRequest = (snapshot) => {
    if (!snapshot) return "no request was open";
    const request = `the open request${snapshot.label ? ` (${snapshot.label})` : ""} had run ${seconds(snapshot.openMs)}`;
    if (snapshot.state === REQUEST_STATE.writing) {
        return `${request} and had received ${count(snapshot.answerChars)} characters of its answer`
            + (snapshot.reasoningChars ? `, after ${count(snapshot.reasoningChars)} of reasoning` : "");
    }
    if (snapshot.state === REQUEST_STATE.thinking) {
        return `${request} and had received no answer text yet (the model was thinking: ${count(snapshot.reasoningChars)} characters of reasoning)`;
    }
    return `${request} and had received nothing yet`;
};

// What the log line of a cancelled skip or retry ends with: how far in the
// cancel came, and what the request open at that moment had received.
// `request` is the snapshot taken as Cancel was pressed (null: none was open),
// or undefined when the cancel came some other way and nobody took one.
export const describeCancelPoint = (elapsedMs, request) =>
    ` after ${seconds(elapsedMs)}${request === undefined ? "" : `; ${describeOpenRequest(request)}`}`;

// The skip's clock on the row: minutes and seconds, 0:07, 1:46, 61:03.
export const formatElapsed = (ms) => {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
