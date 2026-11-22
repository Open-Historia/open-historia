// Run: node --test src/Game/GameUI/actionsPanelLayout.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
    GOAL_OPEN_KEY,
    PANEL_HEIGHT_KEY,
    PANEL_HEIGHT_VAR,
    actionsLayoutReducer,
    clampPanelHeight,
    initialActionsLayout,
    keyedPanelHeight,
    openSectionOf,
    panelHeightCss,
    readGoalOpen,
    readPanelHeight,
    writeGoalOpen,
    writePanelHeight,
} from "./actionsPanelLayout.js";

const memoryStorage = () => {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
        map,
    };
};

const brokenStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
};

test("the suggested list is open only while it is shown at all", () => {
    assert.equal(openSectionOf("suggested", true), "suggested");
    assert.equal(openSectionOf("suggested", false), "submitted");
    assert.equal(openSectionOf("submitted", true), "submitted");
    assert.deepEqual(initialActionsLayout(), { section: "submitted", goalOpen: true });
    assert.deepEqual(initialActionsLayout(false), { section: "submitted", goalOpen: false });
});

test("opening the suggested actions minimizes the standing goal", () => {
    const start = initialActionsLayout(true);
    // AI Suggestions pressed while no list of them was shown yet.
    assert.deepEqual(actionsLayoutReducer(start, { type: "open", section: "suggested", showSuggested: false }), { section: "suggested", goalOpen: false });
    // Its header clicked while the submitted actions were open.
    assert.deepEqual(actionsLayoutReducer(start, { type: "toggle", showSuggested: true }), { section: "suggested", goalOpen: false });
});

test("opening the submitted actions minimizes the standing goal", () => {
    const suggested = { section: "suggested", goalOpen: true };
    // An order sent while the suggestions were open.
    assert.deepEqual(actionsLayoutReducer(suggested, { type: "open", section: "submitted", showSuggested: true }), { section: "submitted", goalOpen: false });
    // Either header clicked: the other list opens, as the accordion always did.
    assert.deepEqual(actionsLayoutReducer(suggested, { type: "toggle", showSuggested: true }), { section: "submitted", goalOpen: false });
});

test("asking for the list that is already open changes nothing", () => {
    const submitted = { section: "submitted", goalOpen: true };
    assert.equal(actionsLayoutReducer(submitted, { type: "open", section: "submitted", showSuggested: true }), submitted);
    const suggested = { section: "suggested", goalOpen: true };
    assert.equal(actionsLayoutReducer(suggested, { type: "open", section: "suggested", showSuggested: true }), suggested);
    // With no suggestions shown, the submitted actions are already the open list.
    const hidden = { section: "suggested", goalOpen: true };
    assert.deepEqual(actionsLayoutReducer(hidden, { type: "open", section: "submitted", showSuggested: false }), { section: "submitted", goalOpen: true });
    // And a header that cannot be clicked does nothing.
    assert.equal(actionsLayoutReducer(submitted, { type: "toggle", showSuggested: false }), submitted);
});

test("expanding the standing goal leaves the open list open", () => {
    const minimized = { section: "suggested", goalOpen: false };
    assert.deepEqual(actionsLayoutReducer(minimized, { type: "goal" }), { section: "suggested", goalOpen: true });
    assert.deepEqual(actionsLayoutReducer({ section: "suggested", goalOpen: true }, { type: "goal" }), { section: "suggested", goalOpen: false });
    assert.equal(actionsLayoutReducer(minimized, { type: "goal", open: false }), minimized);
    assert.equal(actionsLayoutReducer(minimized, { type: "nothing" }), minimized);
});

test("the goal card's state is remembered, and blocked storage never breaks the panel", () => {
    const storage = memoryStorage();
    assert.equal(readGoalOpen(storage), true, "expanded until the player minimizes it");
    writeGoalOpen(storage, false);
    assert.equal(storage.map.get(GOAL_OPEN_KEY), "0");
    assert.equal(readGoalOpen(storage), false);
    writeGoalOpen(storage, true);
    assert.equal(readGoalOpen(storage), true);
    assert.equal(readGoalOpen(brokenStorage), true);
    assert.equal(readGoalOpen(null), true);
    assert.doesNotThrow(() => writeGoalOpen(brokenStorage, false));
    assert.doesNotThrow(() => writeGoalOpen(null, false));
});

test("the panel's height is remembered, and forgotten for the default", () => {
    const storage = memoryStorage();
    assert.equal(readPanelHeight(storage), null);
    writePanelHeight(storage, 412.6);
    assert.equal(storage.map.get(PANEL_HEIGHT_KEY), "413");
    assert.equal(readPanelHeight(storage), 413);
    writePanelHeight(storage, null);
    assert.equal(storage.map.has(PANEL_HEIGHT_KEY), false);
    storage.setItem(PANEL_HEIGHT_KEY, "tall");
    assert.equal(readPanelHeight(storage), null);
    assert.equal(readPanelHeight(brokenStorage), null);
    assert.doesNotThrow(() => writePanelHeight(brokenStorage, 400));
});

test("the panel is dragged between 20rem and the screen's available height", () => {
    // A 900 px screen at 16 px to the rem: 900 - 9rem = 756 px at most, 320 px at least.
    assert.equal(clampPanelHeight(500, { viewport: 900, rem: 16 }), 500);
    assert.equal(clampPanelHeight(100, { viewport: 900, rem: 16 }), 320);
    assert.equal(clampPanelHeight(5000, { viewport: 900, rem: 16 }), 756);
    // A screen too short for the minimum gets what it has.
    assert.equal(clampPanelHeight(100, { viewport: 400, rem: 16 }), 256);
    assert.equal(clampPanelHeight(-50, { viewport: 100, rem: 16 }), 0);
});

test("the arrow keys, Home and End move the edge; other keys do not", () => {
    const screen = { viewport: 900, rem: 16 };
    assert.equal(keyedPanelHeight("ArrowUp", { current: 500, ...screen }), 516);
    assert.equal(keyedPanelHeight("ArrowDown", { current: 500, ...screen }), 484);
    assert.equal(keyedPanelHeight("ArrowUp", { current: 500, shift: true, ...screen }), 564);
    assert.equal(keyedPanelHeight("ArrowDown", { current: 330, shift: true, ...screen }), 320);
    assert.equal(keyedPanelHeight("Home", { current: 500, ...screen }), 320);
    assert.equal(keyedPanelHeight("End", { current: 500, ...screen }), 756);
    assert.equal(keyedPanelHeight("a", { current: 500, ...screen }), null);
});

test("the panel's height as CSS: the old rule by default, a dragged height capped by the screen", () => {
    const app = "var(--oh-app-height, 100vh)";
    assert.equal(panelHeightCss(null, app), `min(calc(${app} - 9rem), max(calc(${app} - 16rem), 30rem))`);
    assert.equal(panelHeightCss(480.4, app), `min(calc(${app} - 9rem), max(480px, 20rem))`);
    assert.equal(panelHeightCss(0, app), panelHeightCss(null, app));
});

// The panel itself (actions.jsx) is React; these read its source.
const actionsSource = fs.readFileSync(new URL("./actions.jsx", import.meta.url), "utf8");
const projectsSource = fs.readFileSync(new URL("./projects.jsx", import.meta.url), "utf8");

test("the panel has a resize handle on its top edge that a mouse, a finger and a keyboard can use", () => {
    const start = actionsSource.indexOf("const PanelResizeHandle");
    assert.ok(start > 0, "PanelResizeHandle is defined");
    const handle = actionsSource.slice(start, actionsSource.indexOf("\nconst ", start + 10));
    for (const needle of [
        "role=\"separator\"",
        "aria-label=\"Resize the Actions panel\"",
        "cursor: \"ns-resize\"",
        "touchAction: \"none\"",
        "onPointerDown=",
        "setPointerCapture",
        "\"pointercancel\"",
        "onDoubleClick={() => onCommit(null)}",
        "onKeyDown=",
        "top: 0,",
    ]) {
        assert.ok(handle.includes(needle), `the handle has ${needle}`);
    }
    assert.ok(/tabIndex=\{shown \? 0 : -1\}/.test(handle), "the handle takes the keyboard's focus while the panel is open");
    assert.ok(actionsSource.includes("<PanelResizeHandle panelRef={panelRef}"), "the panel draws the handle");
    assert.ok(actionsSource.includes("height: `var(${PANEL_HEIGHT_VAR})`"), "the panel's height is the variable the handle moves");
    assert.ok(projectsSource.includes(`var(${PANEL_HEIGHT_VAR},`), "the Projects tab sizes its tag menu by the panel's real height");
});

test("the standing goal card and the order lists share one state", () => {
    assert.ok(actionsSource.includes("React.useReducer(actionsLayoutReducer"), "one reducer holds both");
    assert.ok(actionsSource.includes("open={layout.goalOpen} onToggle={() => dispatchLayout({ type: \"goal\" })}"), "the goal card reads and flips it");
    assert.equal((actionsSource.match(/dispatchLayout\(\{ type: "toggle", showSuggested \}\)/g) || []).length, 2, "both list headers go through it");
    assert.ok(!/setOpenSection|\bopenSection\b/.test(actionsSource), "the old accordion state is gone");
});
