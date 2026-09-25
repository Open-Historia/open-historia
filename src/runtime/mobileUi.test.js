/*! Open Historia — phone layout helpers: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/mobileUi.test.js
//
// --oh-app-height is what replaced 100vh in every panel: the height a phone is
// actually showing. It has to be written at once and kept current, or a panel
// sized from it would be too tall (the address bar showing) or too short (the
// keyboard gone again).

import assert from "node:assert/strict";
import test from "node:test";

import { APP_HEIGHT, APP_HEIGHT_VAR, installAppHeight } from "./mobileUi.js";

const fakeWindow = (height) => {
    const listeners = {};
    const viewportListeners = {};
    const props = {};
    return {
        innerHeight: height,
        document: { documentElement: { style: { setProperty: (name, value) => { props[name] = value; } } } },
        addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
        visualViewport: { addEventListener: (type, fn) => { (viewportListeners[type] ??= []).push(fn); } },
        fire(type) { (listeners[type] ?? []).forEach((fn) => fn()); },
        fireViewport(type) { (viewportListeners[type] ?? []).forEach((fn) => fn()); },
        props,
    };
};

test("the visible height is written at once and follows every resize", () => {
    const win = fakeWindow(640.4);
    assert.equal(installAppHeight(win), true);
    assert.equal(win.props[APP_HEIGHT_VAR], "640px");
    win.innerHeight = 700;
    win.fire("resize");
    assert.equal(win.props[APP_HEIGHT_VAR], "700px", "the address bar hid");
    win.innerHeight = 380;
    win.fireViewport("resize");
    assert.equal(win.props[APP_HEIGHT_VAR], "380px", "the keyboard opened");
    win.innerHeight = 375;
    win.fire("orientationchange");
    assert.equal(win.props[APP_HEIGHT_VAR], "375px", "turned sideways");
});

test("installing twice adds no second set of listeners, and no window is harmless", () => {
    const win = fakeWindow(500);
    installAppHeight(win);
    assert.equal(installAppHeight(win), false);
    assert.equal(installAppHeight(null), false);
});

test("styles read the variable with 100vh behind it", () => {
    assert.equal(APP_HEIGHT, "var(--oh-app-height, 100vh)");
});
