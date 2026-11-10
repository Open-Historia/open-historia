/*! Open Historia — "Countries write to me between time skips": tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/idleDiplomacySwitch.test.js
//
// "readd the idle diplomacy setting so you can disable it (no more limiting it
// tho, it should be unlimited if its enabled)" (the owner, 2026-11-09). One
// switch in Settings → AI → AI requests, on by default. Off, no idle diplomacy
// is scheduled or sent; on, the background daily cap neither stops it nor
// counts it, and the scenario's own idleDiplomacy feature still applies.
//
// gameplay.js cannot be imported in a node test, so its gate is the pure
// idlePulseChance (idlePulse.js), and the wiring is read from the source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { idlePulseChance } from "./idlePulse.js";
import {
    BACKGROUND_DAILY_CAP,
    BACKGROUND_REQUEST,
    backgroundAllowance,
    createMemoryStorage,
    createRequestLedger,
    createRequestSettings,
} from "./requestBudget.js";
import { MAP_SETTING_KEYS, getMapSettingDefaultOn } from "../../runtime/mapSettings.js";

const NOON_PACIFIC = Date.UTC(2026, 8, 17, 19, 0, 0);
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const idlePulseSource = () => {
    const gameplay = source("./gameplay.js");
    const start = gameplay.indexOf("export const maybeSendIdleDiplomacy = async () => {");
    assert.ok(start >= 0);
    return gameplay.slice(start, gameplay.indexOf("\n};\n", start));
};

test("the switch is its own key, on unless the player turned it off", () => {
    assert.equal(MAP_SETTING_KEYS.idleDiplomacy, "ai_idle_diplomacy");
    const prior = globalThis.localStorage;
    globalThis.localStorage = createMemoryStorage();
    try {
        assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.idleDiplomacy), true, "a fresh install");
        localStorage.setItem(MAP_SETTING_KEYS.idleDiplomacy, "0");
        assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.idleDiplomacy), false);
        localStorage.setItem(MAP_SETTING_KEYS.idleDiplomacy, "1");
        assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.idleDiplomacy), true);
    } finally {
        if (prior === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = prior;
    }
});

test("off: the pulse's chance is zero, so nothing is built or sent", () => {
    for (const featureChance of [1 / 8, 0.5, 1]) {
        assert.equal(idlePulseChance({ playerSwitch: false, featureChance }), 0);
    }
});

test("on: the scenario's own chance a minute; and with the scenario's idle diplomacy off, off", () => {
    assert.equal(idlePulseChance({ playerSwitch: true, featureChance: 1 / 8 }), 1 / 8);
    assert.equal(idlePulseChance({ playerSwitch: true, featureChance: 0 }), 0, "the scenario turned it off");
    assert.equal(idlePulseChance({ playerSwitch: true, featureChance: Number.NaN }), 0);
    assert.equal(idlePulseChance({ playerSwitch: true, featureChance: 3 }), 1);
});

test("on, with the background cap used up: the pulse still rolls its full chance", () => {
    const storage = createMemoryStorage();
    const settings = createRequestSettings({ storage });
    const ledger = createRequestLedger({ storage, now: () => NOON_PACIFIC });
    for (let index = 0; index < BACKGROUND_DAILY_CAP; index += 1) ledger.note({ status: 200, kind: BACKGROUND_REQUEST, taskKey: "spyIntercept" });
    assert.equal(backgroundAllowance({ settings, ledger }).allowed, false, "the rest of the background is stopped");
    assert.equal(idlePulseChance({ playerSwitch: true, featureChance: 1 / 8 }), 1 / 8, "idle diplomacy is not");
    // The pulse never asks the cap.
    const pulse = idlePulseSource();
    assert.equal(pulse.includes("backgroundAiAllowance"), false);
    assert.equal(pulse.includes("backgroundAllowance"), false);
});

test("the pulse reads the switch before anything else is asked, and is still a background request", () => {
    const pulse = idlePulseSource();
    assert.match(pulse, /const pulseChance = idlePulseChance\(\{\n\s+playerSwitch: getMapSettingDefaultOn\(MAP_SETTING_KEYS\.idleDiplomacy\),\n\s+featureChance: idleDiplomacyChancePerMinute\(\),\n\s+\}\);\n\s+if \(!\(pulseChance > 0\)\) return null;/);
    assert.ok(pulse.indexOf("if (!(pulseChance > 0)) return null;") < pulse.indexOf("readGameStateBundle"));
    assert.ok(pulse.indexOf("if (!(pulseChance > 0)) return null;") < pulse.indexOf('runJsonTask("idleDiplomacy"'));
    // It still waits for idle: never during a turn, never stacked.
    assert.ok(pulse.indexOf("if (idleDiplomacyInFlight || isSimulationBusy()) return null;") < pulse.indexOf("const pulseChance"));
    assert.match(pulse, /runJsonTask\("idleDiplomacy", \{[\s\S]*?requestKind: BACKGROUND_REQUEST,/);
});

test("off: the game screen schedules no pulse at all", () => {
    const main = source("../GameUI/main.jsx");
    assert.match(main, /const idleDiplomacyOn = useMapSettingDefaultOn\(MAP_SETTING_KEYS\.idleDiplomacy\);/);
    const effect = main.slice(main.indexOf("const idleDiplomacyOn = useMapSettingDefaultOn"), main.indexOf("}, [idleDiplomacyOn, hasNoGames, mainMenuOpen, gameEntered]);"));
    assert.ok(effect.length > 0);
    const off = effect.indexOf("if (!idleDiplomacyOn) return undefined;");
    assert.ok(off >= 0);
    assert.ok(off < effect.indexOf("setInterval("));
    assert.ok(off < effect.indexOf("createPlayerActivity("));
    assert.ok(effect.includes("maybeSendIdleDiplomacy"));
});

test("the Logging file names the switch in its AI requests block", () => {
    const settingsLog = source("../../runtime/settingsLog.js");
    assert.match(settingsLog, /\["Countries write to me between time skips", onOff\(getMapSettingDefaultOn\(MAP_SETTING_KEYS\.idleDiplomacy\)\)\]/);
});
