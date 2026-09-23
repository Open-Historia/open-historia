/*! Open Historia — Back closes what is open © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// On a phone, Back should close the panel on top, not leave the game.
//
// A phone browser's back gesture, and Android's Back button in the app, both
// step back through the page's history (the app's MainActivity goes back in
// its WebView when it can and leaves the app when it cannot). So each open
// panel adds one history step, and stepping back closes the newest one. A panel closed any other way (its ✕, its launcher) takes its step back
// out again, and the pop that causes is recognised and ignored. The steps are
// indistinguishable, which is fine: there are always exactly as many of ours
// as there are panels open, and Back always closes the one opened last.
//
// It only runs where a finger is the main pointer. On a desktop, Escape and
// the ✕ already do this, and a mouse's back button closing a panel would be a
// surprise.
import { useEffect, useRef } from "react";
import { isTouchPrimary } from "./mobileUi.js";

export const createBackStack = (win) => {
    const open = [];
    let ignore = 0;
    let listening = false;
    // Steps our own closes owe the history, taken together at the end of the
    // moment they were closed in: history.go(-n) once, one popstate to ignore.
    // Two panels closing at once (the chat opening puts the advisor away) as
    // two back() calls could be merged by the browser into one, which would
    // leave a step behind and swallow the player's next Back. And a panel
    // opening in the same moment has pushed its step by then, so the one
    // taken back out is behind it, where the closed panel's was.
    let owed = 0;
    const settle = () => {
        const steps = owed;
        owed = 0;
        if (!steps) return;
        ignore += 1;
        try {
            win.history.go(-steps);
        } catch {
            ignore -= 1;
        }
    };
    const step = (entry) => {
        entry.done = false;
        open.push(entry);
        try {
            win.history.pushState({ ohBack: true }, "");
        } catch {
            // A sandboxed frame without history: Back simply does nothing here.
        }
    };
    const onPop = () => {
        if (ignore > 0) {
            ignore -= 1;
            return;
        }
        const top = open.pop();
        if (!top) return;
        top.done = true;
        // A close may be refused: the Workshop asks before it drops unsaved work,
        // and "stay" answers false (at once, or once the question is answered).
        // Refused, the panel is still open, so it gets its step back, unless it
        // was closed some other way in the meantime.
        const kept = (result) => {
            if (result === false && !top.released) step(top);
        };
        const result = top.close();
        if (result && typeof result.then === "function") result.then(kept, () => {});
        else kept(result);
    };
    return {
        // Opens one step for a panel; returns the function that closes it again
        // from our side (safe to call twice, and a no-op once Back has closed it).
        push(close) {
            if (!listening) {
                win.addEventListener("popstate", onPop);
                listening = true;
            }
            const entry = { close, done: false, released: false };
            step(entry);
            return () => {
                entry.released = true;
                const index = open.indexOf(entry);
                if (index !== -1) open.splice(index, 1);
                if (entry.done) return;
                entry.done = true;
                owed += 1;
                if (owed === 1) queueMicrotask(settle);
            };
        },
        get size() {
            return open.length;
        },
    };
};

let shared = null;

// While `open` is true (and on a touch screen), Back calls `onClose`. An
// `onClose` that returns false (or a promise of false) keeps the panel open.
export const useBackToClose = (open, onClose, { enabled = true } = {}) => {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        if (!open || !enabled || typeof window === "undefined" || !window.history || !isTouchPrimary()) return undefined;
        shared ??= createBackStack(window);
        // Returns what onClose returns, so a refusal gets through.
        return shared.push(() => closeRef.current?.());
    }, [open, enabled]);
};
