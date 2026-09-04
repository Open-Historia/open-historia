/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";
import { logDebugEvent } from "./debugLog.js";

// Immediate source of truth for string-valued settings. This also keeps a
// runtime override functional in privacy/file contexts where localStorage
// writes can be rejected.
const valueSettingMemory = new Map();

export const MAP_SETTING_KEYS = {
    // Empty/unset means "use the scenario author's basemap". A built-in ESRI
    // basemap id here is a local, reversible player override for this browser.
    basemapStyle: "map_basemap_style",
    hideCountryLabels: "map_hide_country_labels",
    disableIdleRotation: "map_disable_idle_rotation",
    disableEventCamera: "map_disable_event_camera",
    // Map vNext is the default renderer path. This kill switch keeps the old
    // source-by-source placement behaviour available while the replacement is
    // built in checkpoints; no canonical game state depends on it.
    disableMapVNext: "map_disable_vnext",
    // Not a map setting, but the same localStorage-toggle mechanism: when ON,
    // an AI task gives up when the model goes quiet — 5 minutes part-way through
    // an answer, 15 with no answer at all — and falls back to canned events. Off
    // waits as long as the model needs.
    //
    // ON by default — read with getMapSettingDefaultOn, NOT getMapSetting, since
    // an absent key here means "on", not "off".
    //
    // It ships on because it now measures SILENCE rather than elapsed time (see
    // AI/idleDeadline.js). The old version was a stopwatch started when the
    // request was sent — five minutes for a jump, however well it was going —
    // which threw away good turns from slow models, so it had to default off,
    // which left a genuinely stalled request hanging forever. A window that
    // every token restarts never interrupts a model that is answering, so it is
    // safe to have on, and it is the only thing that ever ends a stall.
    limitAiGeneration: "ai_limit_generation",
    // Long time skips are generated in SEGMENTS — several shorter model calls
    // merged into the one round the player asked for — rather than as a single
    // request. A nine-month skip asks for 30-odd events at once, which on a
    // hosted provider is tens of minutes of generation in one HTTP request; the
    // field report behind this was a gateway closing exactly that with a 502 at
    // 301.7s, costing the player a turn with fourteen queued orders in it.
    //
    // ON by default — read with getMapSettingDefaultOn, NOT getMapSetting, since
    // an absent key here means "on", not "off". Off restores the single-request
    // behaviour for players who would rather have one long wait than several
    // short ones (it re-sends the prompt per segment, so it costs more tokens).
    chunkLongJumps: "ai_chunk_long_jumps",
};

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
export function getMapSettingDefaultOn(key) {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(key) !== "0";
}

// Storage keys are what the game persists; they are not what a maintainer wants
// to read in a bug report. Kept beside MAP_SETTING_KEYS so a new setting that
// forgets to add a name still logs its key rather than nothing.
const SETTING_LABELS = {
    [MAP_SETTING_KEYS.hideCountryLabels]: "Hide country labels",
    [MAP_SETTING_KEYS.disableIdleRotation]: "Disable idle globe rotation",
    [MAP_SETTING_KEYS.disableEventCamera]: "Disable camera movement during events",
    [MAP_SETTING_KEYS.limitAiGeneration]: "Limit AI generation",
    [MAP_SETTING_KEYS.disableMapVNext]: "Use the previous map renderer",
    [MAP_SETTING_KEYS.chunkLongJumps]: "Generate long time skips in segments",
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

export function setMapSettingValue(key, value) {
    const normalized = String(value ?? "").trim();
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
