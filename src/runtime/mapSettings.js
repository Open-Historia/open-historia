/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";

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
    // timeline-jump generation gets a 5-minute deadline and falls back to
    // canned events past it. OFF (the default) waits as long as the model
    // needs — the fallback is only reachable through a real error, never a
    // slow model (Cancel still works either way).
    limitAiGeneration: "ai_limit_generation",
};

export function getMapSetting(key) {
    return localStorage.getItem(key) === "1";
}

export function setMapSetting(key, value) {
    localStorage.setItem(key, value ? "1" : "0");
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
