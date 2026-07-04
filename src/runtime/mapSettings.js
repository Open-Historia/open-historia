/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";

// Keep in sync with assets.js DEFAULT_BASEMAP_ID.
const DEFAULT_BASEMAP_ID = "imagery";

export const MAP_SETTING_KEYS = {
    hideCountryLabels: "map_hide_country_labels",
    disableIdleRotation: "map_disable_idle_rotation",
    basemapStyle: "map_basemap_style",
};

const BOOLEAN_KEYS = new Set([
    MAP_SETTING_KEYS.hideCountryLabels,
    MAP_SETTING_KEYS.disableIdleRotation,
]);

const STRING_DEFAULTS = {
    [MAP_SETTING_KEYS.basemapStyle]: DEFAULT_BASEMAP_ID,
};

export function getMapSetting(key) {
    if (BOOLEAN_KEYS.has(key)) {
        return localStorage.getItem(key) === "1";
    }

    // String-valued settings (e.g. the basemap picker): stored value or default.
    return localStorage.getItem(key) || STRING_DEFAULTS[key];
}

export function setMapSetting(key, value) {
    if (BOOLEAN_KEYS.has(key)) {
        localStorage.setItem(key, value ? "1" : "0");
    } else {
        localStorage.setItem(key, String(value));
    }

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
