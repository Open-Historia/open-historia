/*! Open Historia — saying a group turn a line at a time © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/GameUI/chatReveal.test.js
//
// The timing of a group turn said a line at a time (AI/chatActions.js
// planChatReveal). The first step is said when the turn arrives; each later one
// waits `pauseMs` while its speaker is shown typing, then is said. `pauseMs`
// may be a number or a function, so the panel can choose a fresh delay per line.
// The panel (chat.jsx) says a step by writing it into the thread, so a step not said yet
// exists only here — and stopping, when the player cuts in or leaves the
// thread, hands back what is left, for the panel to drop or to say at once.
//
// Import-free, with the clock passed in, so the timing is tested under node.

// `onTyping(step)` is called when a step's speaker starts typing, and with null
// when nobody is; `onSay(step)` says a step and returns false when it could not
// (the turn then ends: nothing after it can be said either); `onEnd()` is called
// once, however the turn ends.
export const startChatReveal = ({
    steps = [],
    pauseMs = 0,
    onTyping = () => {},
    onSay = () => true,
    onEnd = () => {},
    schedule = setTimeout,
    cancel = clearTimeout,
} = {}) => {
    const left = Array.isArray(steps) ? [...steps] : [];
    let timer = null;
    let running = true;

    const end = () => {
        running = false;
        timer = null;
        onTyping(null);
        onEnd();
    };
    const typeNext = () => {
        if (!running) return;
        if (!left.length) { end(); return; }
        onTyping(left[0]);
        const requestedPause = typeof pauseMs === "function" ? pauseMs(left[0]) : pauseMs;
        const delay = Number.isFinite(Number(requestedPause)) ? Math.max(0, Number(requestedPause)) : 0;
        timer = schedule(() => {
            if (!running) return;
            const step = left.shift();
            if (onSay(step) === false) { left.length = 0; end(); return; }
            typeNext();
        }, delay);
    };
    typeNext();

    return {
        get running() { return running; },
        // Ends the turn where it stands and hands back the steps not said yet.
        stop() {
            if (!running) return [];
            cancel(timer);
            const rest = left.splice(0);
            end();
            return rest;
        },
    };
};

// The log a step is written onto. The thread as the panel holds it now, when
// that still has everything this turn wrote — so a vote the player cast in
// between stays under the step — and otherwise the turn's own copy. The first
// step always takes the turn's copy: it holds the player's line, which the
// stored log may not have yet.
export const logForNextStep = ({ turnLog = [], wroteAny = false, chatId, liveChatId, liveLog } = {}) => {
    const lastWritten = wroteAny ? turnLog.at(-1)?.id : "";
    if (!lastWritten || String(liveChatId) !== String(chatId) || !Array.isArray(liveLog)) return turnLog;
    return liveLog.some((event) => event?.id === lastWritten) ? liveLog : turnLog;
};
