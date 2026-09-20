/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";
import { logDebugEvent, logSettingChange } from "./debugLog.js";

// Immediate source of truth for string-valued settings. This also keeps a
// runtime override functional in privacy/file contexts where localStorage
// writes can be rejected.
const valueSettingMemory = new Map();

export const MAP_SETTING_KEYS = {
    // Empty/unset means "use the scenario author's basemap". A built-in ESRI
    // basemap id here is a local, reversible player override for this browser.
    basemapStyle: "map_basemap_style",
    // Empty/unset means "use the scenario author's label font" (world.labelFont,
    // itself defaulting to Georgia). A family name here is a local, reversible
    // player override, the same shape as basemapStyle above. It exists in
    // Settings as well as in the two editors because a label font you cannot
    // read is a reason to change it, and until now the only way to was through
    // the game editor.
    labelFont: "map_label_font",
    hideCountryLabels: "map_hide_country_labels",
    // OFF by default, like every getMapSetting key: the map looks exactly as it
    // does today until the player asks to see their sphere. Puppets deliberately
    // get a border treatment and never a fill or stripe — striping already means
    // DISPUTED (regionClaimants) and OCCUPIED (regionSovereigntyOverrides), and a
    // third meaning would make a contested satellite border unreadable.
    showPuppetOverlay: "map_show_puppet_overlay",
    disableIdleRotation: "map_disable_idle_rotation",
    disableEventCamera: "map_disable_event_camera",
    // Not a map setting, but the same localStorage-toggle mechanism: when ON,
    // an AI task gives up when the model goes quiet — 5 minutes part-way through
    // an answer, 15 with no answer at all — and falls back to canned events. Off
    // waits as long as the model needs.
    //
    // OFF by default — read with getMapSetting, so an absent key means "off".
    //
    // It measures SILENCE rather than elapsed time (see AI/idleDeadline.js): a
    // window that every token restarts never interrupts a model that is still
    // answering, so turning it on is safe, and it is the only thing that ever
    // ends a genuine stall. It ships off all the same, because the fallback it
    // triggers is a canned turn the player did not ask for; the beta leaves
    // that trade to the player, who opts in from Settings → AI.
    limitAiGeneration: "ai_limit_generation",
    // Opt-in (ported from the abdulrahman-2005 fork): tasks nobody is waiting
    // on — today the event consolidator — ride the provider's batch endpoint
    // at about half the price, with the result applied later by a poller.
    // Anthropic only; every other provider keeps the synchronous call.
    batchBackgroundTasks: "ai_batch_background_tasks",
    // Long time skips are generated in SEGMENTS — several shorter model calls
    // merged into the one round the player asked for — rather than as a single
    // request. A nine-month skip asks for 30-odd events at once, which on a
    // hosted provider is tens of minutes of generation in one HTTP request; the
    // field report behind this was a gateway closing exactly that with a 502 at
    // 301.7s, costing the player a turn with fourteen queued orders in it.
    //
    // OFF by default — read with getMapSetting, so an absent key means "off":
    // a skip is one request unless the player opts in. Segments re-send the
    // prompt per piece, so they cost more tokens and a round reads less like
    // one; a player whose provider drops long requests turns them on from
    // Settings → AI.
    chunkLongJumps: "ai_chunk_long_jumps",
    // The lookup functions (AI/lookupTools.js): the structured tasks declare
    // them beside their output function so the model can ask for exact names,
    // ids and ledgers before answering. ON by default — read with
    // getMapSettingDefaultOn, so an absent key means "on". A player whose
    // provider handles tool calls badly, or who wants the single cheaper
    // request per task, turns them off from Settings → AI.
    lookupFunctions: "ai_lookup_functions",
    // A skip's events on the Events panel as the model writes them
    // (AI/streamedEvents.js). ON by default; off leaves the skip behind the
    // Timeline panel's spinner.
    liveSkipEvents: "ai_live_skip_events",
};

// Families the label-font pickers suggest — Settings → Map and the game and
// scenario editors, one list. Suggestions only: labels rasterize from the
// player's own fonts, so any installed family works.
export const LABEL_FONT_SUGGESTIONS = Object.freeze([
    "Georgia", "Times New Roman", "Garamond", "Palatino Linotype", "Impact",
    "Arial Black", "Arial", "Trebuchet MS", "Verdana", "Courier New", "Comic Sans MS",
]);

export function getMapSetting(key) {
    // Guarded because these reads are reached from modules that node --test
    // imports without a DOM, and an unguarded read would turn "import this
    // module" into a ReferenceError. An absent store reads as every setting
    // off, which is the shipped default anyway.
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(key) === "1";
}

// The same read for a setting that ships ON: only an explicit "0" (the player
// turned it off) disables it, so a fresh install or cleared storage gets the
// feature without opting in. Mirrors getReasoningEnabled() in AI/providerConfig.js.
//
// A default-on setting CANNOT use getMapSetting above — an absent key reads as
// "1" !== null, i.e. off — so every consumer of such a key must come through here.
//
// lookupFunctions and liveSkipEvents ship on; limitAiGeneration and
// chunkLongJumps, which used to, went default-off in the beta.
export function getMapSettingDefaultOn(key) {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(key) !== "0";
}

// Storage keys are what the game persists; they are not what a maintainer wants
// to read in a bug report. Kept beside MAP_SETTING_KEYS so a new setting that
// forgets to add a name still logs its key rather than nothing.
const SETTING_LABELS = {
    [MAP_SETTING_KEYS.hideCountryLabels]: "Hide country labels",
    [MAP_SETTING_KEYS.showPuppetOverlay]: "Show puppet states on the map",
    [MAP_SETTING_KEYS.disableIdleRotation]: "Disable idle globe rotation",
    [MAP_SETTING_KEYS.disableEventCamera]: "Disable camera movement during events",
    [MAP_SETTING_KEYS.limitAiGeneration]: "Limit AI generation",
    [MAP_SETTING_KEYS.batchBackgroundTasks]: "Batch background AI tasks",
    [MAP_SETTING_KEYS.chunkLongJumps]: "Generate long time skips in segments",
    [MAP_SETTING_KEYS.lookupFunctions]: "AI lookup functions",
    [MAP_SETTING_KEYS.liveSkipEvents]: "Show time skip events as they are written",
};

export function setMapSetting(key, value) {
    localStorage.setItem(key, value ? "1" : "0");
    // Every toggle in Settings that matters to a bug report goes through here.
    // One line covers all of them, and it lands in the log at the moment it was
    // flipped rather than as a state dump at the end.
    logDebugEvent("setting", `${SETTING_LABELS[key] || key} turned ${value ? "on" : "off"}.`);
    window.dispatchEvent(new Event("mapSettings:updated"));
}

export function getMapSettingValue(key, fallback = "") {
    if (valueSettingMemory.has(key)) return valueSettingMemory.get(key);
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

// The value settings' names in the diagnostics log, as the Settings panel shows
// them; an empty value is the scenario author's choice.
const VALUE_SETTING_LABELS = {
    [MAP_SETTING_KEYS.basemapStyle]: "Basemap",
    [MAP_SETTING_KEYS.labelFont]: "Label font",
};

export function setMapSettingValue(key, value) {
    const normalized = String(value ?? "").trim();
    // Logged once it settles: the label font is typed, and saves per keystroke.
    if (normalized !== getMapSettingValue(key, "")) {
        logSettingChange(VALUE_SETTING_LABELS[key] || key, normalized || "scenario default", { settle: true });
    }
    valueSettingMemory.set(key, normalized);
    try {
        if (normalized) localStorage.setItem(key, normalized);
        else localStorage.removeItem(key);
    } catch {
        // The live in-memory setting still applies for this session.
    }
    window.dispatchEvent(new CustomEvent("mapSettings:updated", {
        detail: { key, value: normalized },
    }));
}

export function useMapSetting(key) {
    const [value, setValue] = useState(() => getMapSetting(key));

    useEffect(() => {
        setValue(getMapSetting(key));
        const onUpdated = () => setValue(getMapSetting(key));
        window.addEventListener("mapSettings:updated", onUpdated);
        return () => window.removeEventListener("mapSettings:updated", onUpdated);
    }, [key]);

    return value;
}

export function useMapSettingValue(key, fallback = "") {
    const [value, setValue] = useState(() => getMapSettingValue(key, fallback));

    useEffect(() => {
        const onUpdated = (event) => setValue(
            event?.detail?.key === key
                ? event.detail.value
                : getMapSettingValue(key, fallback),
        );
        onUpdated();
        window.addEventListener("mapSettings:updated", onUpdated);
        return () => window.removeEventListener("mapSettings:updated", onUpdated);
    }, [fallback, key]);

    return value;
}
