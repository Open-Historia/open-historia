/*! Open Historia — what the open AI request is doing, said while a skip waits on it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/requestActivity.test.js
//
// A skip is mostly one long request, and for all of it the panel showed a
// spinner and the phase's name. On a thinking model behind a slow provider that
// is minutes of one unchanging line. A player's log has nine skips started in
// fourteen minutes: seven cancelled by the player, five of them between 83 and
// 215 seconds in, each started again within seconds, and only the ninth, left
// alone, landing, after 658 seconds. Nothing had failed: the request was open
// and the model was thinking, and the panel had no way to say so. The
// provider's "client connection closed" was the game doing as it was told.
//
// So the request path reports here and the skip's progress row reads it. A
// request opens; each chunk of its stream says how many characters of reasoning
// and how many of the answer (text, or the arguments of a tool call) it
// carried; the request closes. From that the row says one of three things —
// nothing has come back yet, the model is thinking, the model is writing — and,
// once the request has been open a minute, that a slow model can take several.
//
// A request that does not stream reports nothing between opening and closing,
// so it reads as waiting throughout, which is what it is.
//
// Only requests somebody may be watching a spinner for are reported (main.jsx
// callAI decides): a conversation shows its own reply as it arrives, and nobody
// waits on a background call.
//
// Import-free, with the clock handed in, so it is tested under bare node.

export const REQUEST_WAITING = "waiting";
export const REQUEST_THINKING = "thinking";
export const REQUEST_WRITING = "writing";

// How long a request is open before the row adds that this is normal.
export const STILL_WORKING_AFTER_MS = 60000;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0);

// { open({ label }) → { sent(), received({ reasoningChars, answerChars }), close() },
//   current() → snapshot or null, subscribe(listener) → unsubscribe }
//
// Listeners hear a request open, go out, change what it is doing, and close —
// never each chunk: the row keeps its own one-second clock for the rest.
export const createRequestActivity = ({ now = () => Date.now() } = {}) => {
    const open = new Map(); // id -> request, in the order they opened
    const listeners = new Set();
    let lastId = 0;

    const tell = () => {
        for (const listener of [...listeners]) {
            try { listener(); } catch { /* a listener that throws must never cost a request */ }
        }
    };

    const snapshotOf = (request, at) => {
        const openMs = Math.max(0, at - request.sentAt);
        return {
            label: request.label,
            state: request.state,
            openMs,
            chunks: request.chunks,
            reasoningChars: request.reasoningChars,
            answerChars: request.answerChars,
            stillWorking: openMs >= STILL_WORKING_AFTER_MS,
        };
    };

    return {
        // A request is about to be made. The handle is how the request path
        // reports on it; every method is safe to call after close().
        open({ label = "" } = {}) {
            const request = {
                id: (lastId += 1),
                label: clean(label),
                sentAt: now(),
                receivedAt: null,
                state: REQUEST_WAITING,
                chunks: 0,
                reasoningChars: 0,
                answerChars: 0,
            };
            open.set(request.id, request);
            tell();
            return {
                // The request itself goes out now. Said again when a provider
                // path asks a second time inside one call (a busy provider
                // retried, a step down the structured-output ladder): what the
                // first try received is not what this one has.
                sent() {
                    if (!open.has(request.id)) return;
                    request.sentAt = now();
                    request.receivedAt = null;
                    request.state = REQUEST_WAITING;
                    request.chunks = 0;
                    request.reasoningChars = 0;
                    request.answerChars = 0;
                    tell();
                },
                // One chunk of the stream. A chunk that carried neither (a
                // keep-alive, half a frame) is life but not an answer: the
                // request is still waiting for one.
                received({ reasoningChars = 0, answerChars = 0 } = {}) {
                    if (!open.has(request.id)) return;
                    const reasoning = count(reasoningChars);
                    const answer = count(answerChars);
                    request.chunks += 1;
                    if (!reasoning && !answer) return;
                    request.reasoningChars += reasoning;
                    request.answerChars += answer;
                    request.receivedAt = now();
                    // A chunk with both is the model starting to write.
                    const state = answer ? REQUEST_WRITING : REQUEST_THINKING;
                    if (state === request.state) return;
                    request.state = state;
                    tell();
                },
                close() {
                    if (open.delete(request.id)) tell();
                },
            };
        },
        // The request to show: with several open, the one that last received
        // something, else the one that went out last. Null when none is open
        // (the skip is doing its own work).
        current() {
            let shown = null;
            for (const request of open.values()) {
                if (!shown) {
                    shown = request;
                } else if (request.receivedAt !== null || shown.receivedAt !== null) {
                    if ((request.receivedAt ?? -Infinity) >= (shown.receivedAt ?? -Infinity)) shown = request;
                } else if (request.sentAt >= shown.sentAt) {
                    shown = request;
                }
            }
            return shown ? snapshotOf(shown, now()) : null;
        },
        subscribe(listener) {
            if (typeof listener !== "function") return () => {};
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
};

// The one the game uses: main.jsx reports to it, the progress row reads it.
export const requestActivity = createRequestActivity();

// The skip's clock in the row: minutes and seconds, 0:07, 10:58, 75:03.
export const formatElapsedClock = (ms) => {
    const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const seconds = (ms) => `${Math.round(Math.max(0, Number(ms) || 0) / 1000)} s`;
const characters = (chars) => `${chars.toLocaleString("en-US")} character${chars === 1 ? "" : "s"}`;

// What a request had got to, as one clause for the diagnostics log. A skip the
// player cancels says it, so the next report like the one above reads at a
// glance: "…cancelled by the player after 106 s; the open request (task
// "jumpForward" → the model, open 105 s) had received no answer text yet (the
// model was thinking: 5,210 characters of reasoning)".
export const describeRequestActivity = (snapshot) => {
    if (!snapshot) return "no request was open";
    const open = `open ${seconds(snapshot.openMs)}`;
    const which = `the open request (${snapshot.label ? `${snapshot.label}, ` : ""}${open})`;
    const reasoning = count(snapshot.reasoningChars);
    const answer = count(snapshot.answerChars);
    if (answer) {
        return `${which} had received ${characters(answer)} of its answer${reasoning ? ` after ${characters(reasoning)} of reasoning` : ""}`;
    }
    if (reasoning) return `${which} had received no answer text yet (the model was thinking: ${characters(reasoning)} of reasoning)`;
    // A stream that has started and says nothing readable is not a dead one.
    const chunks = count(snapshot.chunks);
    return chunks
        ? `${which} had received no text yet (${chunks} chunk${chunks === 1 ? "" : "s"} of keep-alives or empty frames)`
        : `${which} had received nothing yet`;
};
