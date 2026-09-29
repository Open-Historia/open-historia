// The Logging file's settings block (settingsLog.js), read the way a report
// reads it: the line a player's file would carry.
//
// Run: node --test src/runtime/settingsLog.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryStorage, requestSettings } from "../Game/AI/requestBudget.js";
import { buildSettingsReport } from "./debugLog.js";
import { MAP_SETTING_KEYS } from "./mapSettings.js";
import "./settingsLog.js";

globalThis.localStorage = createMemoryStorage();

const line = async (label) => {
    const report = await buildSettingsReport();
    return report.split("\n").find((row) => row.trim().startsWith(`${label}:`))?.trim() ?? "";
};

test("AI lookup functions: the file says when Save AI requests is keeping them off", async () => {
    // A fresh install: the switch is on and requests are saved, so no task
    // declares a lookup.
    assert.equal(await line("AI lookup functions"), "AI lookup functions: on (inactive: Save AI requests)");
    requestSettings.setSaveRequests(false);
    assert.equal(await line("AI lookup functions"), "AI lookup functions: on");
    localStorage.setItem(MAP_SETTING_KEYS.lookupFunctions, "0");
    assert.equal(await line("AI lookup functions"), "AI lookup functions: off");
    requestSettings.setSaveRequests(true);
    assert.equal(await line("AI lookup functions"), "AI lookup functions: off");
});
