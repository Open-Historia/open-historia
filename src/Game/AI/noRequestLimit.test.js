/*! Open Historia — "My key has no request limit": tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/noRequestLimit.test.js
//
// Runs without node_modules: requestBudget.js imports only fallbackRunner.js.
//
// "make there be one toggle that does all the optimal stuff for non request
// limited keys so its simple" (the owner, 2026-11-07). One switch in Settings →
// AI → AI requests replaced Save AI requests and Unlimited requests. On, it
// turns off everything that saves requests, raises the caps, and turns the
// lookup functions on; off, it puts back what the player had. A player on a
// free key, who never touches it, sees nothing change. (It turned Background AI
// on too, until that switch went, 2026-11-07.)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    BACKGROUND_DAILY_CAP,
    JUMP_REQUEST_CAP,
    LEGACY_REQUEST_KEYS,
    LOOKUP_FUNCTIONS_KEY,
    REQUEST_BUDGET_KEYS,
    UNLIMITED_JUMP_REQUEST_CAP,
    backgroundAllowance,
    createMemoryStorage,
    createRequestLedger,
    createRequestSettings,
    describeDay,
    describeJumpCost,
    jumpRequestCap,
    lookupRoundLimit,
} from "./requestBudget.js";

const NOON_PACIFIC = Date.UTC(2026, 8, 17, 19, 0, 0);
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const setup = (stored = {}) => {
    const storage = createMemoryStorage(stored);
    return {
        storage,
        settings: createRequestSettings({ storage }),
        ledger: createRequestLedger({ storage, now: () => NOON_PACIFIC }),
    };
};

// What every reader of the switch sees, at once.
const readings = (settings) => ({
    noRequestLimit: settings.noRequestLimit(),
    saveRequests: settings.saveRequests(),
    unlimited: settings.unlimited(),
});
const ON = { noRequestLimit: true, saveRequests: false, unlimited: true };
const OFF = { noRequestLimit: false, saveRequests: true, unlimited: false };

// ---- One stored state, three getters that agree ----------------------------

test("one key holds the switch, and the three getters always agree with it", () => {
    const { settings, storage } = setup();
    assert.equal(REQUEST_BUDGET_KEYS.noRequestLimit, "ai_no_request_limit");
    assert.equal(REQUEST_BUDGET_KEYS.saveRequests, undefined, "the old switches are not settings any more");
    assert.equal(REQUEST_BUDGET_KEYS.unlimited, undefined);
    assert.deepEqual(readings(settings), OFF);
    settings.setNoRequestLimit(true);
    assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.noRequestLimit), "1");
    assert.deepEqual(readings(settings), ON);
    settings.setNoRequestLimit(false);
    assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.noRequestLimit), "0");
    assert.deepEqual(readings(settings), OFF);
    assert.equal(settings.setSaveRequests, undefined, "one setter, the switch's");
    assert.equal(settings.setUnlimited, undefined);
});

test("the lookup functions' key is the map setting's", () => {
    const mapSettings = source("../../runtime/mapSettings.js");
    assert.match(mapSettings, new RegExp(`lookupFunctions: "${LOOKUP_FUNCTIONS_KEY}"`));
});

// ---- The migration from the two old switches -------------------------------

test("a player keeps what they had: Unlimited requests on, or Save AI requests off, is the switch on", () => {
    const cases = [
        [{}, OFF, "never touched either"],
        [{ [LEGACY_REQUEST_KEYS.saveRequests]: "1" }, OFF, "saving left on"],
        [{ [LEGACY_REQUEST_KEYS.saveRequests]: "0" }, ON, "saving turned off: \"for a key with no daily limit\""],
        [{ [LEGACY_REQUEST_KEYS.unlimited]: "1" }, ON, "unlimited on"],
        [{ [LEGACY_REQUEST_KEYS.unlimited]: "1", [LEGACY_REQUEST_KEYS.saveRequests]: "1" }, ON, "unlimited on with saving on (it read off)"],
        [{ [LEGACY_REQUEST_KEYS.unlimited]: "0", [LEGACY_REQUEST_KEYS.saveRequests]: "0" }, ON, "unlimited turned off again, saving off"],
        [{ [LEGACY_REQUEST_KEYS.unlimited]: "0" }, OFF, "unlimited turned off again, saving as it was"],
    ];
    for (const [stored, expected, why] of cases) {
        assert.deepEqual(readings(setup(stored).settings), expected, why);
    }
    assert.deepEqual(LEGACY_REQUEST_KEYS, { saveRequests: "ai_save_requests", unlimited: "ai_unlimited_requests" });
});

test("the new key wins over the old ones, and setting it removes them", () => {
    const { settings, storage } = setup({ [LEGACY_REQUEST_KEYS.unlimited]: "1", [REQUEST_BUDGET_KEYS.noRequestLimit]: "0" });
    assert.deepEqual(readings(settings), OFF);
    settings.setNoRequestLimit(true);
    assert.equal(storage.getItem(LEGACY_REQUEST_KEYS.unlimited), null);
    assert.equal(storage.getItem(LEGACY_REQUEST_KEYS.saveRequests), null);
});

test("reading writes nothing, and a migrated player's own choices are left alone", () => {
    const stored = { [LEGACY_REQUEST_KEYS.saveRequests]: "0", [LOOKUP_FUNCTIONS_KEY]: "0" };
    const { settings, storage } = setup(stored);
    assert.deepEqual(readings(settings), ON);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), "0", "the switch only changes these when it is turned");
    assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.noRequestLimit), null);
    assert.equal(storage.getItem(LEGACY_REQUEST_KEYS.saveRequests), "0");
});

// ---- What turning it on and off does ---------------------------------------

test("on: the lookup functions on; off: put back as the player had them", () => {
    const { settings, storage } = setup({ ai_background_activity: "0", [LOOKUP_FUNCTIONS_KEY]: "0" });
    settings.setNoRequestLimit(true);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), "1");
    assert.equal(storage.getItem("ai_background_activity"), "0", "Background AI's old key is not touched");
    settings.setNoRequestLimit(false);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), "0");
    assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.beforeNoRequestLimit), null, "nothing kept once put back");
});

test("defaults are put back as defaults: an absent key goes back to absent", () => {
    const { settings, storage } = setup();
    settings.setNoRequestLimit(true);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), "1");
    settings.setNoRequestLimit(false);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), null);
    assert.equal(storage.getItem("ai_background_activity"), null, "nothing is written for Background AI");
});

test("a record kept from when the switch turned Background AI on puts back only the lookups", () => {
    const { settings, storage } = setup({
        [REQUEST_BUDGET_KEYS.noRequestLimit]: "1",
        [REQUEST_BUDGET_KEYS.beforeNoRequestLimit]: JSON.stringify({ backgroundAi: "0", lookups: "0" }),
        ai_background_activity: "1",
        [LOOKUP_FUNCTIONS_KEY]: "1",
    });
    settings.setNoRequestLimit(false);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), "0");
    assert.equal(storage.getItem("ai_background_activity"), "1", "a key nothing reads is left alone");
});

test("setting the switch to what it already is changes nothing else", () => {
    const { settings, storage } = setup({ [REQUEST_BUDGET_KEYS.noRequestLimit]: "1", [LOOKUP_FUNCTIONS_KEY]: "0" });
    settings.setNoRequestLimit(true);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), "0", "a lookup choice made under Advanced stands");
    assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.beforeNoRequestLimit), null);
    const off = setup({ [LOOKUP_FUNCTIONS_KEY]: "0" });
    off.settings.setNoRequestLimit(false);
    assert.equal(off.storage.getItem(LOOKUP_FUNCTIONS_KEY), "0");
});

test("a kept record that is not an object puts nothing back and does not throw", () => {
    const { settings, storage } = setup({ [REQUEST_BUDGET_KEYS.noRequestLimit]: "1", [REQUEST_BUDGET_KEYS.beforeNoRequestLimit]: "{broken", [LOOKUP_FUNCTIONS_KEY]: "1" });
    settings.setNoRequestLimit(false);
    assert.equal(storage.getItem(LOOKUP_FUNCTIONS_KEY), "1");
    assert.equal(storage.getItem(REQUEST_BUDGET_KEYS.beforeNoRequestLimit), null);
});

// ---- The caps, background AI and the day ------------------------------------

test("on: the higher caps and rounds; off: the free key's, exactly as before", () => {
    assert.equal(jumpRequestCap({ unlimited: setup({ [REQUEST_BUDGET_KEYS.noRequestLimit]: "1" }).settings.unlimited() }), UNLIMITED_JUMP_REQUEST_CAP);
    assert.equal(jumpRequestCap({ unlimited: setup().settings.unlimited() }), JUMP_REQUEST_CAP);
    assert.equal(lookupRoundLimit({ unlimited: true }), 6);
    assert.equal(lookupRoundLimit({ unlimited: false }), 3);
    assert.deepEqual(describeJumpCost({ lookups: false }), { min: 1, max: 1, lookups: false, rounds: 0, unlimited: false });
});

// The background cap is fixed now, and holds with the switch on too; only the
// reserve, a share of a day's limit, goes with the limit.
test("on: the background keeps no reserve but still stops at its cap; off: both", () => {
    const { settings, ledger } = setup({ [REQUEST_BUDGET_KEYS.dailyLimit]: "100" });
    // 90 used of 100: the last tenth.
    for (let index = 0; index < 90; index += 1) ledger.note({ status: 200 });
    assert.equal(backgroundAllowance({ settings, ledger }).reason, "reserve");
    settings.setNoRequestLimit(true);
    assert.equal(backgroundAllowance({ settings, ledger }).allowed, true, "no limit, no reserve");
    for (let index = 0; index < BACKGROUND_DAILY_CAP; index += 1) ledger.note({ status: 200, kind: "background" });
    assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: false, reason: "cap", remaining: 0 });
    settings.setNoRequestLimit(false);
    assert.equal(backgroundAllowance({ settings, ledger }).allowed, false);
});

// Idle diplomacy is outside that cap with or without a limit (2026-11-09).
test("with or without a limit, idle diplomacy's requests leave the background cap alone", () => {
    for (const noLimit of [false, true]) {
        const { settings, ledger } = setup({ [REQUEST_BUDGET_KEYS.noRequestLimit]: noLimit ? "1" : "0", [REQUEST_BUDGET_KEYS.dailyLimit]: "10000" });
        for (let index = 0; index < BACKGROUND_DAILY_CAP + 5; index += 1) ledger.note({ status: 200, kind: "background", taskKey: "idleDiplomacy" });
        assert.deepEqual(backgroundAllowance({ settings, ledger }), { allowed: true, reason: "", remaining: BACKGROUND_DAILY_CAP }, `noLimit ${noLimit}`);
    }
});

test("the day says whether there is a limit to count against", () => {
    const { settings, ledger } = setup();
    assert.equal(describeDay({ settings, ledger }).noLimit, false);
    settings.setNoRequestLimit(true);
    assert.equal(describeDay({ settings, ledger }).noLimit, true);
    assert.equal(describeDay({ settings, ledger }).limit, 500, "the stored limit is kept for when it is off again");
});

// ---- Every caller reads the one switch --------------------------------------

test("the callers read the switch through the getters, and nothing reads the old keys", () => {
    const gameplay = source("./gameplay.js");
    const main = source("./main.jsx");
    assert.match(gameplay, /const lookupFunctionsEnabled = \(\) => !savingRequests\(\) && getMapSettingDefaultOn\(MAP_SETTING_KEYS\.lookupFunctions\);/);
    assert.match(main, /const advisorGroupFunctionsAllowed = \(\) => !savingRequests\(\) && getMapSettingDefaultOn\(MAP_SETTING_KEYS\.lookupFunctions\);/);
    assert.match(gameplay, /const salvageFirst = \(salvage \|\| savingRequests\(\)\) && !strictFirst;/);
    assert.match(gameplay, /const unlimited = unlimitedRequests\(\);/);
    const settings = source("../GameUI/settings.jsx");
    const time = source("../GameUI/time.jsx");
    const settingsLog = source("../../runtime/settingsLog.js");
    for (const [name, text] of [["gameplay.js", gameplay], ["main.jsx", main], ["settings.jsx", settings], ["time.jsx", time], ["settingsLog.js", settingsLog]]) {
        assert.equal(/ai_save_requests|ai_unlimited_requests|\.setSaveRequests|\.setUnlimited\(/.test(text), false, name);
    }
});

test("Settings: the switch first, the daily limit only when it is off, the lookups under Advanced, and no Background AI", () => {
    const settings = source("../GameUI/settings.jsx");
    const section = settings.slice(settings.indexOf("const RequestBudgetSection = () => {"), settings.indexOf("const SocialLinks = ("));
    const at = (text) => {
        const index = section.indexOf(text);
        assert.ok(index >= 0, text);
        return index;
    };
    assert.ok(at('label="My key has no request limit"') < at("used today"), "the switch at the top");
    assert.ok(at("{!noLimit && (") < at('htmlFor="ai-daily-request-limit"'));
    assert.ok(at("{noLimit && (") < at('label="AI lookup functions"'));
    // Idle diplomacy's own switch, where Background AI's was (2026-11-09): after
    // the daily limit, before Advanced, shown whatever the switch above says.
    assert.ok(at('htmlFor="ai-daily-request-limit"') < at('label="Countries write to me between time skips"'));
    assert.ok(at('label="Countries write to me between time skips"') < at("{noLimit && ("));
    assert.match(section, /onToggle=\{\(\) => setMapSetting\(MAP_SETTING_KEYS\.idleDiplomacy, !idleDiplomacyOn\)\}/);
    assert.equal(section.includes('label="Background AI"'), false);
    assert.equal(section.includes("ai-background-daily-cap"), false);
    assert.match(section, /apply\(`My key has no request limit turned \$\{next \? "on" : "off"\}\.`, \(\) => setNoRequestLimit\(next\)\);/);
    assert.equal(section.includes('label="Save AI requests"'), false);
    assert.equal(section.includes('label="Unlimited requests"'), false);
    // And the Generation behavior section no longer has a lookup switch.
    assert.equal(settings.split('label="AI lookup functions"').length - 1, 1);
});
