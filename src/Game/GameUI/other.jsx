/*! Open Historia — portions (mobile country/date row) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { memo, useEffect, useState } from "react";
import { JSON_URLS, getNationFlags } from "../../runtime/assets.js";
import { isPolityLandless, readWorldState } from "../../runtime/gameState.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { SAFE_BOTTOM } from "../../runtime/mobileUi.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { flagEmojiFromGid, flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { useLibraryState } from "../../runtime/library.js";

const baseStyle = {
    position: "fixed",
    backgroundColor: "var(--oh-hud-bg)",
    backdropFilter: "var(--oh-hud-blur)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontFamily: "sans-serif",
    borderRadius: "14px",
    border: "1px solid var(--oh-hud-border)",
    boxShadow: "var(--oh-hud-shadow-soft)",
};

// A GID_0 that isn't a real ISO country (custom scenario polities like "HRE",
// "YUAN") has no flag — flagImageUrlFromGid/flagEmojiFromGid both return null
// for it, which this component uses directly as the fallback signal instead
// of maintaining a separate "is this a real country" check.
const FallbackBadge = ({ label }) => (
    <div
    title={label}
    aria-label={label ? `${label} flag unavailable` : "Flag unavailable"}
    style={{
        alignItems: "center",
        background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035))",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "5px",
        color: "rgba(255,255,255,0.68)",
        display: "flex",
        fontSize: "1rem",
        fontWeight: 700,
        height: "100%",
        justifyContent: "center",
        width: "100%",
    }}
    >
    🏳️
    </div>
);

// dockStyle places the standalone badge beside the advisor drawer (main.jsx).
const DEFAULT_DOCK_STYLE = { right: "0.5rem" };

const Other = memo(function Other({ dockStyle = DEFAULT_DOCK_STYLE, active = false, onToggle = null }) {
    const { activeGame } = useLibraryState();
    const activeGameId = String(activeGame?.id || "");
    const activeGameCountry = String(activeGame?.country || "").trim();
    const [country, setCountry] = useState(() => activeGameCountry || null);
    // A LANDLESS player is a stateless actor (a person, a movement, a
    // government-in-exile) whose game.country may still resolve to a real ISO
    // code — but they are NOT that country, so the badge must not borrow its
    // flag. Neutral placeholder instead. Refreshed on the same 5s cadence as the
    // stats pane so gaining/losing all territory flips the badge within a poll.
    const [landless, setLandless] = useState(false);
    const [worldState, setWorldState] = useState(null);
    const [flagCatalog, setFlagCatalog] = useState({});
    const [imageFailed, setImageFailed] = useState(false);
    const isMobile = useIsMobile();
    // The player sees the FULL country name in the tooltip, never the code.
    const displayName = useCountryDisplayName(country);

    useEffect(() => {
        let cancelled = false;
        const liveCountry = { current: activeGameCountry };
        const liveWorld = { current: null };

        // The library store owns which campaign is active. Using cached game.json here
        // meant a campaign switch could leave this one badge stuck on the previous
        // player's polity even while every other UI surface had already moved on.
        if (activeGameCountry) {
            setCountry((current) => current === activeGameCountry ? current : activeGameCountry);
        }
        setWorldState(null);
        setLandless(false);
        setImageFailed(false);

        const apply = () => {
            if (cancelled) return;
            const code = liveCountry.current;
            setCountry((current) => current === code ? current : code);
            if (liveWorld.current) {
                const next = isPolityLandless(liveWorld.current, code);
                setLandless((current) => current === next ? current : next);
            }
        };

        Promise.all([
            // One forced refresh on campaign activation is cheap and prevents the new
            // polity from being paired with the previous campaign's world/flag state.
            readWorldState({ force: true }),
            getNationFlags().catch(() => ({})),
        ])
            .then(([world, flags]) => {
                liveWorld.current = world;
                setWorldState(world || null);
                setFlagCatalog(flags || {});
                apply();
            })
            .catch((err) => {
                if (!cancelled) console.error("Failed to load player badge state:", err);
            });

        const onGameUpdated = (event) => {
            liveCountry.current = event?.detail?.game?.country || liveCountry.current;
            apply();
        };
        const onWorldUpdated = (event) => {
            liveWorld.current = event?.detail?.world || liveWorld.current;
            setWorldState(liveWorld.current || null);
            apply();
        };
        const onRuntimeUpdated = (event) => {
            if (event?.detail?.url === JSON_URLS.flags && event?.detail?.value) {
                setFlagCatalog(event.detail.value);
                setImageFailed(false);
            }
        };

        window.addEventListener("oh:game-updated", onGameUpdated);
        window.addEventListener("oh:world-updated", onWorldUpdated);
        window.addEventListener("oh:runtime-json-updated", onRuntimeUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:game-updated", onGameUpdated);
            window.removeEventListener("oh:world-updated", onWorldUpdated);
            window.removeEventListener("oh:runtime-json-updated", onRuntimeUpdated);
        };
    }, [activeGameCountry, activeGameId]);

    useEffect(() => {
        setImageFailed(false);
    }, [country]);

    // Hidden on phones, where it would cover the date: there the country name
    // in the date widget opens the drawer (time.jsx).
    if (isMobile || !country) return null;

    // Landless → never borrow the code-derived country flag; fall through to the
    // neutral FallbackBadge (both null makes the render pick it).
    const resolvedFlag = landless
        ? { imageUrl: null }
        : resolvePolityFlag({
            polity: { polityKey: country, code: country, name: displayName || country },
            world: worldState || {},
            flags: flagCatalog || {},
        });
    const flagUrl = landless ? null : (resolvedFlag?.imageUrl || flagImageUrlFromGid(country));
    const flagEmoji = landless ? null : flagEmojiFromGid(country);

    return (
        <button
        type="button"
        title={`${displayName} · Open country panel`}
        aria-label={`Open ${displayName} country panel`}
        onClick={onToggle}
        style={{
            ...baseStyle,
            ...dockStyle,
            bottom: `calc(4.75rem + ${SAFE_BOTTOM})`,
            // Rides beside the advisor drawer, so a wide drawer carries it over
            // the Actions/Projects/chat panels (9998); an open panel stays on top.
            zIndex: 9997,
            height: "4rem",
            width: "4rem",
            padding: "0.48rem",
            boxSizing: "border-box",
            overflow: "hidden",
            cursor: "pointer",
            appearance: "none",
            background: active
                ? "linear-gradient(180deg, rgba(91,155,255,0.22), rgba(59,130,246,0.12))"
                : "linear-gradient(180deg, rgba(53,53,58,0.58), rgba(17,17,19,0.48))",
            transition: `${dockStyle.transition || ""}${dockStyle.transition ? ", " : ""}background 0.15s ease`,
        }}
        >
        {flagUrl && !imageFailed ? (
            <img
            src={flagUrl}
            alt={displayName}
            onError={() => setImageFailed(true)}
            style={{ borderRadius: "5px", boxShadow: "0 0 0 1px rgba(255,255,255,0.16)", height: "100%", objectFit: "cover", width: "100%" }}
            />
        ) : flagEmoji ? (
            <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>{flagEmoji}</span>
        ) : (
            <FallbackBadge label={displayName} />
        )}
        </button>
    );
});

export { Other };
