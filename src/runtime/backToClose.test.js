/*! Open Historia — Back closes what is open: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/backToClose.test.js
//
// On a phone, Back must close the panel on top and nothing else, and a panel
// closed by its own ✕ must take its history step with it, or the next Back
// would do nothing (or close a panel that is already shut).

import assert from "node:assert/strict";
import test from "node:test";

import { createBackStack } from "./backToClose.js";

// A window whose history behaves like a browser's: pushState adds a step,
// go(n) moves n steps and fires one popstate. The real event is asynchronous;
// firing it at once is the harder case for the ignore count.
const fakeWindow = () => {
    const listeners = [];
    let depth = 0;
    let pops = 0;
    const firePop = () => {
        pops += 1;
        listeners.forEach((listener) => listener({ state: null }));
    };
    const history = {
        pushState: () => {
            depth += 1;
        },
        go: (delta) => {
            const target = Math.max(0, depth + delta);
            if (target === depth) return;
            depth = target;
            firePop();
        },
        back: () => history.go(-1),
    };
    return {
        addEventListener: (type, listener) => {
            if (type === "popstate") listeners.push(listener);
        },
        history,
        // The player presses Back.
        pressBack() {
            history.back();
        },
        get depth() {
            return depth;
        },
        get pops() {
            return pops;
        },
    };
};

// Our own closes take their steps back at the end of the moment they happen in.
const endOfMoment = () => new Promise((resolve) => queueMicrotask(resolve));

test("Back closes the panel that is open, and the page is back where it started", () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    let closed = 0;
    stack.push(() => { closed += 1; });
    assert.equal(win.depth, 1, "opening a panel adds one history step");
    win.pressBack();
    assert.equal(closed, 1);
    assert.equal(stack.size, 0);
    assert.equal(win.depth, 0);
});

test("a panel closed by its own button takes its step back out, and Back then has nothing of ours to close", async () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    let closed = 0;
    const release = stack.push(() => { closed += 1; });
    release();
    release();
    await endOfMoment();
    assert.equal(closed, 0, "closing it ourselves does not call its close again");
    assert.equal(win.depth, 0, "its history step is gone");
    assert.equal(stack.size, 0);
});

test("with two panels open, Back closes the newest first, then the older one", () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    const closed = [];
    stack.push(() => closed.push("chat"));
    stack.push(() => closed.push("advisor"));
    win.pressBack();
    assert.deepEqual(closed, ["advisor"]);
    win.pressBack();
    assert.deepEqual(closed, ["advisor", "chat"]);
    assert.equal(win.depth, 0);
});

test("closing the older panel by hand leaves Back on the newer one", async () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    const closed = [];
    const releaseChat = stack.push(() => closed.push("chat"));
    stack.push(() => closed.push("advisor"));
    releaseChat();
    await endOfMoment();
    assert.equal(win.depth, 1, "one step left, for the one panel still open");
    win.pressBack();
    assert.deepEqual(closed, ["advisor"]);
    assert.equal(stack.size, 0);
});

test("a panel Back closed is not closed again when it unmounts", async () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    let closed = 0;
    const release = stack.push(() => { closed += 1; });
    win.pressBack();
    release();
    await endOfMoment();
    assert.equal(closed, 1);
    assert.equal(win.depth, 0, "no second step back out of the page");
});

test("two panels closed in one moment take their steps back together, and the next Back is not swallowed", async () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    const releaseAdvisor = stack.push(() => {});
    const releaseCard = stack.push(() => {});
    releaseAdvisor();
    releaseCard();
    await endOfMoment();
    assert.equal(win.depth, 0);
    assert.equal(win.pops, 1, "one traversal, not two a browser might merge");
    let closed = 0;
    stack.push(() => { closed += 1; });
    win.pressBack();
    assert.equal(closed, 1, "the player's next Back still closes the next panel");
});

test("a panel opened in the same moment another closes keeps its step", async () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    const closed = [];
    const releaseAdvisor = stack.push(() => closed.push("advisor"));
    // The chat opens and puts the advisor away, in one render.
    releaseAdvisor();
    stack.push(() => closed.push("chat"));
    await endOfMoment();
    assert.equal(win.depth, 1, "one step, for the chat");
    assert.equal(stack.size, 1);
    win.pressBack();
    assert.deepEqual(closed, ["chat"]);
    assert.equal(win.depth, 0);
});

test("a close that is refused keeps the panel open, with its step back", () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    let asked = 0;
    stack.push(() => { asked += 1; return false; });
    win.pressBack();
    assert.equal(asked, 1);
    assert.equal(stack.size, 1, "still open");
    assert.equal(win.depth, 1, "and Back has a step to take again");
    win.pressBack();
    assert.equal(asked, 2, "the next Back asks again");
});

test("a close answered later: refused, the step comes back; accepted, it does not", async () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    let answer;
    stack.push(() => new Promise((resolve) => { answer = resolve; }));
    win.pressBack();
    assert.equal(stack.size, 0, "gone from the stack while the question is open");
    answer(false);
    await Promise.resolve();
    assert.equal(stack.size, 1, "refused: open again");
    assert.equal(win.depth, 1);
    win.pressBack();
    answer(true);
    await Promise.resolve();
    assert.equal(stack.size, 0, "accepted: closed");
    assert.equal(win.depth, 0);
});

test("a refused close whose panel was closed another way in the meantime takes no step", async () => {
    const win = fakeWindow();
    const stack = createBackStack(win);
    let answer;
    const release = stack.push(() => new Promise((resolve) => { answer = resolve; }));
    win.pressBack();
    release();
    answer(false);
    await endOfMoment();
    assert.equal(stack.size, 0);
    assert.equal(win.depth, 0);
});

test("without history (a sandboxed frame) nothing throws", async () => {
    const stack = createBackStack({
        addEventListener: () => {},
        history: {
            pushState: () => { throw new Error("SecurityError"); },
            go: () => { throw new Error("SecurityError"); },
        },
    });
    const release = stack.push(() => {});
    assert.doesNotThrow(release);
    await endOfMoment();
});
