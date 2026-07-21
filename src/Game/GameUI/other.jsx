/*! Open Historia — portions (mobile country/date row) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { isPolityLandless, readWorldState } from "../../runtime/gameState.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { flagEmojiFromGid, flagImageUrlFromGid } from "../../runtime/countryFlags.js";

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
    // A LANDLESS player is a stateless actor (a person, a movement, a
    // government-in-exile) whose game.country may still resolve to a real ISO
    // code — but they are NOT that country, so the badge must not borrow its
    // flag. Neutral placeholder instead. Refreshed on the same 5s cadence as the
    // stats pane so gaining/losing all territory flips the badge within a poll.
    const [landless, setLandless] = useState(false);
    const [imageFailed, setImageFailed] = useState(false);
    const isMobile = useIsMobile();
    // The player sees the FULL country name in the tooltip, never the code.
    const displayName = useCountryDisplayName(country);

    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            try {
                const data = await readJson(JSON_URLS.game, { defaultValue: {} });
                if (cancelled) return;
                const code = data.country;
                setCountry(code);
                // force:false rides the memoized world read (cheap; a real jump
                // invalidates the cache, so this still sees territory changes).
                const world = await readWorldState({ force: false });
                if (!cancelled) setLandless(isPolityLandless(world, code));
            } catch (err) {
                if (!cancelled) console.error("Failed to load game.json:", err);
            }
        };
        refresh();
        const intervalId = window.setInterval(refresh, 5000);
        return () => { cancelled = true; window.clearInterval(intervalId); };
    }, []);

    useEffect(() => {
        setImageFailed(false);
    }, [country]);

    // On phones the country is already shown inside the date widget — this
    // badge and the date widget would overlap on a portrait screen.
    if (isMobile || !country) return null;

    // Landless → never borrow the code-derived country flag; fall through to the
    // neutral FallbackBadge (both null makes the render pick it).
    const flagUrl = landless ? null : flagImageUrlFromGid(country);
    const flagEmoji = landless ? null : flagEmojiFromGid(country);

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
            style={{ borderRadius: "50%", height: "100%", objectFit: "cover", width: "100%" }}
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
