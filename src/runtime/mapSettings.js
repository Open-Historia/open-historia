/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";
import { logDebugEvent, setDebugLogContext } from "./debugLog.js";

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
    // The work-in-progress unit system: the AI owns movement and combat, units
    // carry a posture, and the engine advances standing orders every turn
    // (runtime/unitMotion.js). OFF — the default, and what an absent key means —
    // is the classic system: the player moves and attacks by hand and combat
    // resolves through the seeded resolver in Map/unitCombat.js.
    //
    // Both modes read and write the SAME save shape, so switching is lossless in
    // either direction; see isBetaUnits() below for why it is read once.
    betaUnits: "beta_unit_system",
};

export function getMapSetting(key) {
    // Guarded because isBetaUnits() below is read from gameplay.js and
    // promptContext.js, not just from components — and node --test has no
    // localStorage, so an unguarded read would turn "import this module" into a
    // ReferenceError for any future test that touches those paths. An absent
    // store reads as every setting off, which is the shipped default anyway.
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
    [MAP_SETTING_KEYS.betaUnits]: "Beta unit system",
};

export function setMapSetting(key, value) {
    localStorage.setItem(key, value ? "1" : "0");
    // Every toggle in Settings that matters to a bug report goes through here —
    // the beta unit system above all, which changes who moves the units and so
    // changes what half the reports in the tracker even mean. One line here
    // covers all of them, and it lands in the log at the moment it was flipped
    // rather than as a state dump at the end.
    logDebugEvent("setting", `${SETTING_LABELS[key] || key} turned ${value ? "on" : "off"}.`);
    window.dispatchEvent(new Event("mapSettings:updated"));
}

// Is the beta unit system active for THIS session?
//
// Pinned on first read rather than re-read live, because the two systems are not
// interchangeable halfway through a turn: unitsController.js holds the
// interaction mode and unit list in module state, an AI prompt is assembled from
// a dozen call sites that must all agree about what the model was told, and a
// jump already in flight would otherwise land its events under different rules
// than it was planned under. The settings toggle says a restart is needed, and
// this is what makes that true rather than merely advisory.
//
// Read through this everywhere outside React. Inside React, either is fine:
// useMapSetting reflects the toggle immediately (so the settings panel shows the
// real checkbox state), while this reflects what the running session is doing.
let betaUnitsPinned = null;
export function isBetaUnits() {
    if (betaUnitsPinned === null) {
        betaUnitsPinned = getMapSetting(MAP_SETTING_KEYS.betaUnits);
        // Pinned once, recorded once. Which unit system the SESSION is running
        // is not the same as which one the toggle currently shows, and a bug
        // report about units is unreadable without knowing the first — so the
        // report header carries the pinned value, taken here where it is set.
        setDebugLogContext({ unitSystem: betaUnitsPinned ? "beta (AI-driven)" : "classic" });
    }
    return betaUnitsPinned;
}

// Tests only: drop the pin so a case can set the flag and re-read it. Never call
// this from app code — that is exactly the mid-session switch the pin prevents.
export function resetBetaUnitsPinForTests() {
    betaUnitsPinned = null;
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
