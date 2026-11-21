/*! Open Historia — the Reduce motion switch and the system's reduced-motion setting © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
    MAP_SETTING_KEYS,
    SITTING_ONLY_SETTINGS,
    SYSTEM_REDUCED_MOTION_QUERY,
    getMapSettingValue,
    getPolityLabelMaxZoom,
    setPolityLabelMaxZoom,
    reduceMotionEnabled,
    setMapSettingValue,
    systemPrefersReducedMotion,
} from "./mapSettings.js";

// A browser's two stores, as far as these reads go: localStorage and the one
// media query.
const withBrowser = ({ stored = {}, systemReduced = false, matchMedia } = {}, run) => {
    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const asked = [];
    Object.defineProperty(globalThis, "window", {
        value: {
            matchMedia: matchMedia ?? ((query) => {
                asked.push(query);
                return { matches: query === SYSTEM_REDUCED_MOTION_QUERY && systemReduced };
            }),
        },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
        value: { getItem: (key) => (Object.hasOwn(stored, key) ? stored[key] : null) },
        configurable: true,
        writable: true,
    });
    try {
        return run(asked);
    } finally {
        if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
        else delete globalThis.window;
        if (priorStorage) Object.defineProperty(globalThis, "localStorage", priorStorage);
        else delete globalThis.localStorage;
    }
};

const BOTH_ON = {
    [MAP_SETTING_KEYS.disableIdleRotation]: "1",
    [MAP_SETTING_KEYS.disableEventCamera]: "1",
};

test("the map's mode lasts the sitting only: every opening is on the political map", () => {
    // "its opening onto the diplomatic map by default, it should be on political be default" (the owner, 2026-10-16).
    assert.deepEqual(SITTING_ONLY_SETTINGS, [MAP_SETTING_KEYS.mapMode]);
    const stored = { [MAP_SETTING_KEYS.mapMode]: "diplomatic" };
    const written = [];
    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "window", { value: { dispatchEvent: () => true }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", {
        value: {
            getItem: (key) => (Object.hasOwn(stored, key) ? stored[key] : null),
            setItem: (key, value) => written.push([key, value]),
            removeItem: (key) => delete stored[key],
        },
        configurable: true,
        writable: true,
    });
    try {
        // What an earlier build kept on the device is not read: the political map.
        assert.equal(getMapSettingValue(MAP_SETTING_KEYS.mapMode, "political"), "political");
        // Switched in the sitting, it holds for the sitting, and nothing is written to the device.
        setMapSettingValue(MAP_SETTING_KEYS.mapMode, "diplomatic");
        assert.equal(getMapSettingValue(MAP_SETTING_KEYS.mapMode, "political"), "diplomatic");
        assert.deepEqual(written, []);
        assert.equal(Object.hasOwn(stored, MAP_SETTING_KEYS.mapMode), false, "and the old one is let go");
    } finally {
        setMapSettingValue(MAP_SETTING_KEYS.mapMode, "");
        if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
        else delete globalThis.window;
        if (priorStorage) Object.defineProperty(globalThis, "localStorage", priorStorage);
        else delete globalThis.localStorage;
    }
});

test("the system's reduced-motion setting is read from its media query", () => {
    withBrowser({ systemReduced: true }, (asked) => {
        assert.equal(systemPrefersReducedMotion(), true);
        assert.deepEqual(asked, ["(prefers-reduced-motion: reduce)"]);
    });
    withBrowser({ systemReduced: false }, () => assert.equal(systemPrefersReducedMotion(), false));
});

test("without a window or a matchMedia, the system asks for nothing", () => {
    assert.equal(systemPrefersReducedMotion(), false);
    withBrowser({ matchMedia: () => { throw new Error("no media"); } }, () => {
        assert.equal(systemPrefersReducedMotion(), false);
    });
});

test("Reduce motion is on when the player turned it on", () => {
    withBrowser({ stored: BOTH_ON }, () => assert.equal(reduceMotionEnabled(), true));
});

test("Reduce motion is on when the system asks, whatever the switches say", () => {
    withBrowser({ systemReduced: true }, () => assert.equal(reduceMotionEnabled(), true));
    withBrowser({
        systemReduced: true,
        stored: { [MAP_SETTING_KEYS.disableIdleRotation]: "0", [MAP_SETTING_KEYS.disableEventCamera]: "0" },
    }, () => assert.equal(reduceMotionEnabled(), true));
});

test("one motion switch alone is not the whole Reduce motion switch", () => {
    withBrowser({ stored: { [MAP_SETTING_KEYS.disableIdleRotation]: "1" } }, () => {
        assert.equal(reduceMotionEnabled(), false);
    });
    withBrowser({}, () => assert.equal(reduceMotionEnabled(), false));
});

test("N029: polity label cutoff is a validated persistent, live, local setting", () => {
    assert.equal(getPolityLabelMaxZoom(), 6.2);
    const key = MAP_SETTING_KEYS.polityLabelMaxZoom;
    const stored = { [key]: "8.4" };
    const actions = [];
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "window", { value: { dispatchEvent: (event) => { actions.push(event.detail); return true; } }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: {
        getItem: (name) => stored[name] ?? null,
        setItem: (name, value) => { stored[name] = value; },
        removeItem: (name) => { delete stored[name]; },
    }, configurable: true, writable: true });
    try {
        assert.equal(getPolityLabelMaxZoom(), 8.4, "read existing storage on a fresh load");
        stored[key] = "broken";
        assert.equal(getPolityLabelMaxZoom(), 6.2);
        setPolityLabelMaxZoom("12");
        assert.equal(stored[key], "9");
        assert.equal(getPolityLabelMaxZoom(), 9);
        assert.deepEqual(actions.at(-1), { key, value: "9" });
        setPolityLabelMaxZoom("6.2");
        assert.equal(stored[key], "6.2");
        assert.equal(getPolityLabelMaxZoom(), 6.2);
        assert.equal(SITTING_ONLY_SETTINGS.includes(key), false);
    } finally {
        setMapSettingValue(key, "");
        if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
        else delete globalThis.window;
        if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
        else delete globalThis.localStorage;
    }
});
