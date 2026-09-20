/*! Open Historia — portions (game settings in the diagnostics log) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Logging file's "Settings when this file was saved" block: every setting a
// player can change, with the value in force as the file is built.
//
// The log records settings as they CHANGE (logSettingChange, called by each
// setter), but a switch flipped before the log's span — or never touched, sitting
// at its default — is in no log at all, and "was X on?" is the first question a
// report gets. So the file also states them all, read at the moment it is saved.
//
// One place for all of them, each read through the getter its owner already
// exports, so what the file says is what the game is running with. Registered
// into debugLog.js rather than imported by it, because these modules import that
// one. Imported by src/main.jsx at boot, so the block is there however the file
// is saved — Settings or a failure button.
//
// Labels match the Settings panel word for word, so a reader can find the switch;
// src/runtime/diagnosticsLogGuard.test.js fails if a switch in the panel is
// missing here.
//
// What a line may say: never a key (only "set" or "not set"), never custom
// parameters (they can carry headers — only their size), and an endpoint only by
// its host. Everything is redacted again as the file is built.
import { isDebugLogEnabled, isDebugLogVerbose, registerSettingsSnapshot } from "./debugLog.js";
import { MAP_SETTING_KEYS, getMapSetting, getMapSettingDefaultOn, getMapSettingValue } from "./mapSettings.js";
import { getStoredChatLanguage, getStoredLanguage, languageDisplayName } from "./i18n.js";
import {
    AI_TASK_ROUTING,
    endpointHostForLog,
    getEntryStatus,
    getProviderMeta,
    getRateLimitPolicy,
    getReasoningEnabled,
    getResolvedFallbackList,
    getTaskPick,
} from "../Game/AI/providerConfig.js";
import { isRatingEnabled, isTelemetryEnabled } from "../Game/AI/telemetry.js";
import { requestDay, requestSettings } from "../Game/AI/requestBudget.js";

const onOff = (value) => (value ? "on" : "off");

// The globe and terrain switches are App.jsx state mirrored to localStorage as
// JSON booleans; App writes them on mount, so they are there by the time a file
// can be saved.
const storedBoolean = (key, fallback) => {
    try {
        const stored = localStorage.getItem(key);
        return stored === null ? fallback : JSON.parse(stored) === true;
    } catch {
        return fallback;
    }
};

registerSettingsSnapshot("Display", () => [
    ["UI language", languageDisplayName(getStoredLanguage())],
    ["AI chat language", languageDisplayName(getStoredChatLanguage())],
    ["Fullscreen", onOff(typeof document !== "undefined" && document.fullscreenElement)],
    // The umbrella switch: on exactly when both of the map's motion switches are.
    ["Reduce motion", onOff(getMapSetting(MAP_SETTING_KEYS.disableIdleRotation) && getMapSetting(MAP_SETTING_KEYS.disableEventCamera))],
]);

registerSettingsSnapshot("Map", () => [
    ["Basemap", getMapSettingValue(MAP_SETTING_KEYS.basemapStyle) || "scenario default"],
    ["Label font", getMapSettingValue(MAP_SETTING_KEYS.labelFont) || "scenario default"],
    ["3D Globe", onOff(storedBoolean("Globe", false))],
    ["3D Terrain", onOff(storedBoolean("Terrain", true))],
    ["Hide country labels", onOff(getMapSetting(MAP_SETTING_KEYS.hideCountryLabels))],
    ["Disable idle globe rotation", onOff(getMapSetting(MAP_SETTING_KEYS.disableIdleRotation))],
    ["Disable camera movement during events", onOff(getMapSetting(MAP_SETTING_KEYS.disableEventCamera))],
]);

// Every entry of the Fallback list, in order, with the state it is in: "which
// model was it trying to use?" has as many answers as the list has entries.
const describeStatus = (entry) => {
    const { status, reason, until } = getEntryStatus(entry.id);
    if (status === "unusable") return `Unusable: ${reason}`;
    if (status === "spent") return `Spent until ${new Date(until).toISOString()}`;
    if (status === "busy") return `${reason} until ${new Date(until).toISOString()}`;
    return "ready";
};

registerSettingsSnapshot("AI", () => {
    const list = getResolvedFallbackList();
    const items = [["Fallback list", `${list.length} entr${list.length === 1 ? "y" : "ies"}`]];
    list.forEach((entry, index) => {
        const text = (value) => String(value ?? "").trim();
        items.push(
            [`Entry ${index + 1}`, `${entry.connectionName} (${getProviderMeta(entry.provider)?.label || entry.provider})`],
            ["Model", text(entry.model) || "(provider default)"],
            ["API key", text(entry.apiKey) ? "set" : "not set"],
        );
        // Only the self-hosted providers have an endpoint to point somewhere else.
        if (entry.provider === "openai-compatible" || entry.provider === "anthropic-compatible") {
            items.push(["Endpoint", endpointHostForLog(entry.endpoint)]);
        }
        const customParams = text(entry.customParams);
        items.push(["Custom parameters", customParams ? `set (${customParams.length} characters)` : "none"]);
        items.push(["Structured output", entry.structuredMode || "auto"]);
        if (entry.provider === "openai-compatible") items.push(["Strict tool schema", onOff(entry.toolStrict)]);
        items.push(["Status", describeStatus(entry)]);
    });
    items.push(["When a model is rate limited", getRateLimitPolicy() === "next" ? "try the next one" : "wait"]);
    // Only the tasks with a pick of their own; every other task starts at the top.
    const picks = AI_TASK_ROUTING
        .map(({ key, label }) => [`${label} model`, list.find((entry) => entry.id === getTaskPick(key))?.label ?? ""])
        .filter(([, picked]) => picked);
    if (picks.length) items.push(...picks);
    else items.push(["Per-task models", "none — every task starts at the top of the list"]);
    items.push(
        ["Model reasoning", onOff(getReasoningEnabled())],
        ["Limit AI generation", onOff(getMapSetting(MAP_SETTING_KEYS.limitAiGeneration))],
        ["Generate long time skips in segments", onOff(getMapSetting(MAP_SETTING_KEYS.chunkLongJumps))],
        ["AI lookup functions", onOff(getMapSettingDefaultOn(MAP_SETTING_KEYS.lookupFunctions))],
        ["Show time skip events as they are written", onOff(getMapSettingDefaultOn(MAP_SETTING_KEYS.liveSkipEvents))],
        ["Batch background AI tasks", onOff(getMapSetting(MAP_SETTING_KEYS.batchBackgroundTasks))],
        ["Record AI telemetry", onOff(isTelemetryEnabled())],
        ["Rate AI generations", onOff(isRatingEnabled())],
    );
    return items;
});

// The request budget (AI/requestBudget.js): the switches, and what today has
// cost — "it ate my whole allowance" is a report, and the count by task is most
// of the answer to it.
registerSettingsSnapshot("AI requests", () => {
    const day = requestDay();
    const tasks = Object.entries(day.byTask).sort((a, b) => b[1] - a[1]).map(([task, count]) => `${task} ${count}`).join(", ");
    return [
        ["Save AI requests", onOff(requestSettings.saveRequests())],
        ["Requests a day your key allows", String(day.limit)],
        ["Background AI", onOff(requestSettings.backgroundAi())],
        ["Background requests a day, at most", String(day.backgroundCap)],
        ["Move units to match the events", onOff(requestSettings.reviewSection("units"))],
        ["Mark occupied and disputed land", onOff(requestSettings.reviewSection("territory"))],
        ["Put new structures on the map", onOff(requestSettings.reviewSection("structures"))],
        ["Take repeats and filler off the timeline", onOff(requestSettings.reviewSection("timeline"))],
        ["Keep the Projects board in step", onOff(requestSettings.reviewSection("board"))],
        ["Collect your agents' reports", onOff(requestSettings.reviewSection("spies"))],
        ["Used today", `${day.used} of ${day.limit} (background ${day.background}, refused by rate limit ${day.refused}, failed ${day.failed})`],
        ["Used today, by task", tasks || "nothing yet"],
        ["Last time skip", day.lastJump ? `${day.lastJump.used} request(s)${day.lastJump.refused ? `, ${day.lastJump.refused} refused` : ""}` : "none yet"],
    ];
});

// The server's LAN sharing, which is what lets a phone in. A request away, and
// absent on the web and Android builds (their in-browser API answers 404), where
// the section is left out.
registerSettingsSnapshot("Network", async () => {
    const response = await fetch("/api/server/network", { cache: "no-store" });
    if (!response.ok) return null;
    const state = await response.json();
    return [["Let other devices connect", `${onOff(state?.lanEnabled)}${state?.lockedByEnv ? " (set by OH_HOST)" : ""}`]];
});

registerSettingsSnapshot("Diagnostics", () => [
    ["Keep a diagnostics log", onOff(isDebugLogEnabled())],
    ["Detailed logging", onOff(isDebugLogVerbose())],
]);
