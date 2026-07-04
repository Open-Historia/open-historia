/*! Open Historia — portions (mobile country/date row) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { flagEmojiFromGid, flagImageUrlFromGid, isSensitiveFlag } from "../../runtime/countryFlags.js";
import { MAP_SETTING_KEYS, getMapSetting } from "../../runtime/mapSettings.js";

const baseStyle = {
    position: "fixed",
    backgroundColor: "rgba(17, 24, 39, 0.9)",
    backdropFilter: "blur(4px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontFamily: "sans-serif",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
};

// A GID_0 that isn't a real ISO country (custom scenario polities like "HRE",
// "YUAN") has no flag — flagImageUrlFromGid/flagEmojiFromGid both return null
// for it, which this component uses directly as the fallback signal instead
// of maintaining a separate "is this a real country" check.
const FallbackBadge = ({ label }) => (
    <div
    title={label}
    style={{
        alignItems: "center",
        backgroundColor: "rgba(75, 85, 99, 0.9)",
        borderRadius: "50%",
        color: "white",
        display: "flex",
        fontSize: "1.1rem",
        fontWeight: 700,
        height: "100%",
        justifyContent: "center",
        width: "100%",
    }}
    >
    {label ? label.trim().charAt(0).toUpperCase() : "?"}
    </div>
);

const Other = memo(function Other({ rightShift = "0.5rem" }) {
    const [country, setCountry] = useState(null);
    const [imageFailed, setImageFailed] = useState(false);
    const isMobile = useIsMobile();
    // The player sees the FULL country name in the tooltip, never the code.
    const displayName = useCountryDisplayName(country);

    useEffect(() => {
        readJson(JSON_URLS.game, { defaultValue: {} })
        .then((data) => setCountry(data.country))
        .catch((err) => console.error("Failed to load game.json:", err));
    }, []);

    useEffect(() => {
        setImageFailed(false);
    }, [country]);

    // All hooks must run before the early return below (Rules of Hooks) —
    // this one has to sit here, not next to where shouldBlur is computed.
    const [blurSensitive, setBlurSensitive] = useState(
        () => getMapSetting(MAP_SETTING_KEYS.blurSensitiveFlags),
    );

    useEffect(() => {
        const onUpdated = () => setBlurSensitive(getMapSetting(MAP_SETTING_KEYS.blurSensitiveFlags));
        window.addEventListener("mapSettings:updated", onUpdated);
        return () => window.removeEventListener("mapSettings:updated", onUpdated);
    }, []);

    // On phones the country is already shown inside the date widget — this
    // badge and the date widget would overlap on a portrait screen.
    if (isMobile || !country) return null;

    const flagUrl = flagImageUrlFromGid(country);
    const flagEmoji = flagEmojiFromGid(country);
    const shouldBlur = blurSensitive && isSensitiveFlag(country);

    return (
        <div
        title={displayName}
        style={{
            ...baseStyle,
            bottom: "4.75rem",
            right: rightShift,
            height: "2.75rem",
            width: "2.75rem",
            padding: "0.35rem",
            boxSizing: "border-box",
            transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            overflow: "hidden",
        }}
        >
        {flagUrl && !imageFailed ? (
            <img
            src={flagUrl}
            alt={displayName}
            onError={() => setImageFailed(true)}
            style={{ borderRadius: "50%", height: "100%", objectFit: "cover", width: "100%", filter: shouldBlur ? "blur(4px)" : "none" }}
            />
        ) : flagEmoji ? (
            <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>{flagEmoji}</span>
        ) : (
            <FallbackBadge label={displayName} />
        )}
        </div>
    );
});

export { Other };
