// The Logging file's settings block (settingsLog.js), read the way a report
// reads it: the line a player's file would carry.
//
// Run: node --test src/runtime/settingsLog.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryStorage, requestSettings } from "../Game/AI/requestBudget.js";
import { buildSettingsReport } from "./debugLog.js";
import { getDeviceProfileOverride, setDeviceProfileOverride } from "./deviceProfile.js";
import { MAP_SETTING_KEYS } from "./mapSettings.js";
import "./settingsLog.js";

globalThis.localStorage = createMemoryStorage();

const line = async (label) => {
    const report = await buildSettingsReport();
    return report.split("\n").find((row) => row.trim().startsWith(`${label}:`))?.trim() ?? "";
};

test("AI lookup functions: the file says when a key with a request limit is keeping them off", async () => {
    // A fresh install: the lookups are on and requests are saved, so no task
    // declares a lookup.
    assert.equal(await line("AI lookup functions"), "AI lookup functions: on (inactive: the key has a request limit)");
    requestSettings.setNoRequestLimit(true);
    assert.equal(await line("AI lookup functions"), "AI lookup functions: on");
    localStorage.setItem(MAP_SETTING_KEYS.lookupFunctions, "0");
    assert.equal(await line("AI lookup functions"), "AI lookup functions: off");
    requestSettings.setNoRequestLimit(false);
    assert.equal(await line("AI lookup functions"), "AI lookup functions: on (inactive: the key has a request limit)", "put back as it was before the switch");
});

test("My key has no request limit: one line, off on a fresh install; on, the limits are marked unused", async () => {
    assert.equal(await line("My key has no request limit"), "My key has no request limit: off");
    assert.equal(await line("Save AI requests"), "", "the two old switches have no lines");
    assert.equal(await line("Unlimited requests"), "");
    assert.equal(await line("Requests a day your key allows"), "Requests a day your key allows: 500");
    assert.match(await line("Used today"), /^Used today: \d+ of 500 \(/);
    requestSettings.setNoRequestLimit(true);
    assert.equal(await line("My key has no request limit"), "My key has no request limit: on");
    assert.equal(await line("Requests a day your key allows"), "Requests a day your key allows: 500 (not used: no request limit)");
    assert.equal(await line("Background requests a day, at most"), "Background requests a day, at most: 30", "a fixed cap, with or without a limit");
    assert.equal(await line("Background AI"), "", "no switch any more");
    assert.match(await line("Used today"), /^Used today: \d+ \(background /);
    requestSettings.setNoRequestLimit(false);
    assert.equal(await line("My key has no request limit"), "My key has no request limit: off");
});

test("Countries write to me between time skips: on unless the player turned it off", async () => {
    assert.equal(await line("Countries write to me between time skips"), "Countries write to me between time skips: on");
    localStorage.setItem(MAP_SETTING_KEYS.idleDiplomacy, "0");
    assert.equal(await line("Countries write to me between time skips"), "Countries write to me between time skips: off");
    localStorage.removeItem(MAP_SETTING_KEYS.idleDiplomacy);
});

test("Performance mode: the profile running, why, and what a reload would change it to", async () => {
    // Node has no touch screen and reports no memory: the full path.
    assert.equal(await line("Performance mode"), "Performance mode: full (memory not reported)");
    setDeviceProfileOverride("constrained");
    assert.equal(getDeviceProfileOverride(), "constrained");
    assert.equal(await line("Performance mode"), "Performance mode: full (memory not reported); low memory after a reload");
    setDeviceProfileOverride("");
    assert.equal(getDeviceProfileOverride(), "");
    assert.equal(localStorage.getItem("oh_device_profile"), null, "Auto removes the override");
    assert.equal(await line("Performance mode"), "Performance mode: full (memory not reported)");
});

test("Show what I am playing on Discord: the switch, and that it does nothing where Discord cannot be reached", async () => {
    // On unless turned off. Node is not a build with a local server beside a
    // Discord app, which is also what the website and the Android app are.
    assert.equal(await line("Show what I am playing on Discord"), "Show what I am playing on Discord: on (inactive: this build cannot reach Discord)");
    localStorage.setItem(MAP_SETTING_KEYS.discordPresence, "0");
    assert.equal(await line("Show what I am playing on Discord"), "Show what I am playing on Discord: off (inactive: this build cannot reach Discord)");
    localStorage.removeItem(MAP_SETTING_KEYS.discordPresence);
});

test("Count my visits: on only after a yes, and why it is off otherwise", async () => {
    // No consent.js on the page (the Android app): nothing is counted.
    assert.equal(await line("Count my visits"), "Count my visits: off (visits are not counted here)");
    const answer = { choice: "", signal: false };
    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    globalThis.window = {
        ohConsent: { counted: () => true, get: () => answer.choice, refusedBySignal: () => answer.signal },
    };
    try {
        assert.equal(await line("Count my visits"), "Count my visits: off (not answered)");
        answer.signal = true;
        assert.equal(await line("Count my visits"), "Count my visits: off (the browser asks not to be tracked)");
        answer.choice = "yes";
        assert.equal(await line("Count my visits"), "Count my visits: on");
        answer.choice = "no";
        assert.equal(await line("Count my visits"), "Count my visits: off");
    } finally {
        if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
        else delete globalThis.window;
    }
});

test("Seasons and weather: on unless the player turned it off", async () => {
    assert.equal(await line("Seasons and weather"), "Seasons and weather: on");
    localStorage.setItem(MAP_SETTING_KEYS.seasonsWeather, "0");
    assert.equal(await line("Seasons and weather"), "Seasons and weather: off");
    localStorage.removeItem(MAP_SETTING_KEYS.seasonsWeather);
});
