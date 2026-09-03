/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";
import { logDebugEvent } from "./debugLog.js";

export const MAP_SETTING_KEYS = {
    hideCountryLabels: "map_hide_country_labels",
    disableIdleRotation: "map_disable_idle_rotation",
    disableEventCamera: "map_disable_event_camera",
    // Not a map setting, but the same localStorage-toggle mechanism: when ON,
    // timeline-jump generation gets a 5-minute deadline and falls back to
    // canned events past it. OFF (the default) waits as long as the model
    // needs — the fallback is only reachable through a real error, never a
    // slow model (Cancel still works either way).
    limitAiGeneration: "ai_limit_generation",
};

export function getMapSetting(key) {
    // Guarded because these reads are reached from modules that node --test
    // imports without a DOM, and an unguarded read would turn "import this
    // module" into a ReferenceError. An absent store reads as every setting
    // off, which is the shipped default anyway.
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(key) === "1";
}

// Storage keys are what the game persists; they are not what a maintainer wants
// to read in a bug report. Kept beside MAP_SETTING_KEYS so a new setting that
// forgets to add a name still logs its key rather than nothing.
const SETTING_LABELS = {
    [MAP_SETTING_KEYS.hideCountryLabels]: "Hide country labels",
    [MAP_SETTING_KEYS.disableIdleRotation]: "Disable idle globe rotation",
    [MAP_SETTING_KEYS.disableEventCamera]: "Disable camera movement during events",
    [MAP_SETTING_KEYS.limitAiGeneration]: "Limit AI generation",
};

export function setMapSetting(key, value) {
    localStorage.setItem(key, value ? "1" : "0");
    // Every toggle in Settings that matters to a bug report goes through here.
    // One line covers all of them, and it lands in the log at the moment it was
    // flipped rather than as a state dump at the end.
    logDebugEvent("setting", `${SETTING_LABELS[key] || key} turned ${value ? "on" : "off"}.`);
    window.dispatchEvent(new Event("mapSettings:updated"));
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
