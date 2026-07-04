/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers (World.jsx, Nations.jsx,
// GlobeEffects.jsx) listen for "mapSettings:updated" instead of receiving
// these as props threaded through GameUI/main.jsx, mirroring how
// runtime/i18n.js dispatches "i18n:updated".

export const MAP_SETTING_KEYS = {
    hideCountryLabels: "map_hide_country_labels",
    disableIdleRotation: "map_disable_idle_rotation",
    reverseScrollZoom: "map_reverse_scroll_zoom",
    disablePanInertia: "map_disable_pan_inertia",
    zoomSensitivity: "map_zoom_sensitivity",
    borderWidth: "map_border_width",
    featureSize: "map_feature_size",
    blurSensitiveFlags: "map_blur_sensitive_flags",
};

const BOOLEAN_KEYS = new Set([
    MAP_SETTING_KEYS.hideCountryLabels,
    MAP_SETTING_KEYS.disableIdleRotation,
    MAP_SETTING_KEYS.reverseScrollZoom,
    MAP_SETTING_KEYS.disablePanInertia,
    MAP_SETTING_KEYS.blurSensitiveFlags,
]);

const NUMBER_DEFAULTS = {
    [MAP_SETTING_KEYS.zoomSensitivity]: 1,
    [MAP_SETTING_KEYS.borderWidth]: 1,
    [MAP_SETTING_KEYS.featureSize]: 1,
};

export function getMapSetting(key) {
    if (BOOLEAN_KEYS.has(key)) {
        return localStorage.getItem(key) === "1";
    }

    const raw = localStorage.getItem(key);
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : NUMBER_DEFAULTS[key];
}

export function setMapSetting(key, value) {
    if (BOOLEAN_KEYS.has(key)) {
        localStorage.setItem(key, value ? "1" : "0");
    } else {
        localStorage.setItem(key, String(value));
    }

    window.dispatchEvent(new Event("mapSettings:updated"));
}
