/*! Open Historia — the keyboard and the touch test: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/mobileUiKeyboard.test.js
//
// On a phone the country picker bounced up and down and its map never drew:
// the search box focused itself (the phone reported a fine pointer), the
// keyboard came up, and the dialog and its map, sized from the visible height,
// shrank and re-centred under it. These hold the three parts of the fix.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
    APP_HEIGHT_VAR,
    SCREEN_HEIGHT,
    SCREEN_HEIGHT_VAR,
    SHORT_TOUCH_QUERY,
    TOUCH_QUERY,
    installAppHeight,
    isTouchPrimary,
    isTypingInto,
} from "./mobileUi.js";

const fakeWindow = ({ width, height }) => {
    const listeners = {};
    const props = {};
    const document = { activeElement: { tagName: "BODY" }, documentElement: { style: { setProperty: (name, value) => { props[name] = value; } } } };
    return {
        innerWidth: width,
        innerHeight: height,
        document,
        addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
        visualViewport: { addEventListener: (type, fn) => { (listeners[`vv:${type}`] ??= []).push(fn); } },
        fire(type) { (listeners[type] ?? []).forEach((fn) => fn({ type })); },
        focus(element) { document.activeElement = element; },
        props,
    };
};

const searchBox = { tagName: "INPUT", type: "search" };

test("the screen height leaves the keyboard out; the visible height does not", () => {
    const win = fakeWindow({ width: 412, height: 842 });
    installAppHeight(win);
    assert.equal(win.props[SCREEN_HEIGHT_VAR], "842px");

    win.focus(searchBox);
    win.innerHeight = 470;
    win.fire("resize");
    assert.equal(win.props[APP_HEIGHT_VAR], "470px", "the visible height follows the keyboard");
    assert.equal(win.props[SCREEN_HEIGHT_VAR], "842px", "the screen height does not");

    win.focus({ tagName: "BODY" });
    win.innerHeight = 842;
    win.fire("resize");
    assert.equal(win.props[SCREEN_HEIGHT_VAR], "842px", "the keyboard gone");

    win.innerHeight = 786;
    win.fire("resize");
    assert.equal(win.props[SCREEN_HEIGHT_VAR], "786px", "with nothing typed into, a shrink is the address bar and counts");
});

test("a turn counts even while typing: the keyboard never changes the width", () => {
    const win = fakeWindow({ width: 412, height: 842 });
    installAppHeight(win);
    win.focus(searchBox);
    win.innerWidth = 842;
    win.innerHeight = 380;
    win.fire("orientationchange");
    assert.equal(win.props[SCREEN_HEIGHT_VAR], "380px");
});

test("growing always counts, even with a field focused", () => {
    const win = fakeWindow({ width: 412, height: 700 });
    installAppHeight(win);
    win.focus(searchBox);
    win.innerHeight = 842;
    win.fire("resize");
    assert.equal(win.props[SCREEN_HEIGHT_VAR], "842px");
});

test("only fields that raise a keyboard count as typing", () => {
    assert.equal(isTypingInto({ tagName: "INPUT", type: "text" }), true);
    assert.equal(isTypingInto({ tagName: "input" }), true, "an input with no type is text");
    assert.equal(isTypingInto({ tagName: "TEXTAREA" }), true);
    assert.equal(isTypingInto({ tagName: "DIV", isContentEditable: true }), true);
    assert.equal(isTypingInto({ tagName: "INPUT", type: "checkbox" }), false);
    assert.equal(isTypingInto({ tagName: "INPUT", type: "range" }), false);
    assert.equal(isTypingInto({ tagName: "BUTTON" }), false);
    assert.equal(isTypingInto(null), false);
});

// A small matchMedia for the queries these helpers ask: comma = or, `and` = and.
const mediaFor = (device) => (query) => ({
    matches: query.split(",").some((clause) => [...clause.matchAll(/\(([a-z-]+):\s*([a-z0-9]+)\)/g)].every(([, feature, value]) => {
        if (feature === "max-width") return device.width <= parseInt(value, 10);
        if (feature === "max-height") return device.height <= parseInt(value, 10);
        return device[feature] === value;
    })),
});

const withDevice = (device, run) => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { value: { matchMedia: mediaFor(device) }, configurable: true, writable: true });
    try {
        return run();
    } finally {
        if (saved) Object.defineProperty(globalThis, "window", saved);
        else delete globalThis.window;
    }
};

test("a phone counts as touch whatever its pointer says", () => {
    // What Chromium's TouchDevice reports for a phone.
    const phone = { pointer: "coarse", "any-pointer": "coarse", hover: "none", width: 390, height: 844 };
    assert.equal(withDevice(phone, isTouchPrimary), true, "an ordinary phone");
    // An older WebView, a touchscreen that also takes a stylus: fine, and nothing else.
    const stylusPhone = { pointer: "fine", "any-pointer": "fine", hover: "none", width: 412, height: 842 };
    assert.equal(withDevice(stylusPhone, isTouchPrimary), true, "stylus phone");
    assert.equal(withDevice({ ...stylusPhone, width: 842, height: 412 }, isTouchPrimary), true, "held sideways");
    assert.equal(withDevice({ ...stylusPhone, width: 842, height: 412 }, () => window.matchMedia(SHORT_TOUCH_QUERY).matches), true);
    // A touchscreen that claims to be a mouse too: hover, but a coarse pointer on a phone's screen.
    const mouseClaimingPhone = { pointer: "fine", "any-pointer": "coarse", hover: "hover", width: 412, height: 842 };
    assert.equal(withDevice(mouseClaimingPhone, isTouchPrimary), true, "claims a mouse");
    assert.equal(withDevice({ ...mouseClaimingPhone, width: 842, height: 412 }, () => window.matchMedia(SHORT_TOUCH_QUERY).matches), true);
});

test("a desktop stays a desktop, touchscreen laptops and desktop mode included", () => {
    assert.equal(withDevice({ pointer: "fine", "any-pointer": "fine", hover: "hover", width: 1280, height: 800 }, isTouchPrimary), false);
    assert.equal(withDevice({ pointer: "fine", "any-pointer": "coarse", hover: "hover", width: 1366, height: 768 }, isTouchPrimary), false);
    assert.equal(withDevice({ pointer: "fine", "any-pointer": "coarse", hover: "hover", width: 1366, height: 768 }, () => window.matchMedia(SHORT_TOUCH_QUERY).matches), false);
});

test("the tap sizes in styles.css ask the same question as TOUCH_QUERY", () => {
    const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    assert.ok(css.includes(`@media ${TOUCH_QUERY} {`), "styles.css .oh-tap media query");
});

test("the country picker is sized from the screen height, pinned, and does not focus itself on a phone", () => {
    const picker = fs.readFileSync(new URL("../Game/GameUI/CountryPickerMap.jsx", import.meta.url), "utf8");
    // The touch test is mobileUi.js's, not a (pointer: coarse) of the picker's own.
    assert.doesNotMatch(picker, /matchMedia/);
    assert.match(picker, /autoFocus=\{!(touchFirst|isTouchPrimary\(\)) && !isMobile\}/);
    assert.match(picker, /clamp\(150px, calc\(\$\{SCREEN_HEIGHT\} - 28rem\), 320px\)/);
    assert.match(picker, /display: searching \? "none" : "block"/);
    assert.doesNotMatch(picker, /APP_HEIGHT/);
    const library = fs.readFileSync(new URL("../Game/GameUI/libraryBar.jsx", import.meta.url), "utf8");
    const dialog = library.slice(library.indexOf("onClick={closeCountryPicker}"), library.indexOf("Choose your difficulty"));
    assert.match(dialog, /alignItems: isMobile \? "flex-start" : "center"/);
    assert.match(dialog, /maxHeight: isMobile \? `calc\(\$\{SCREEN_HEIGHT\} - 1\.5rem/);
    assert.equal(SCREEN_HEIGHT, "var(--oh-screen-height, 100vh)");
});
