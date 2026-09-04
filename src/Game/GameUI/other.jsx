/*! Open Historia — portions (mobile country/date row) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useState } from "react";
import { JSON_URLS, getNationFlags } from "../../runtime/assets.js";
import { isPolityLandless, readWorldState } from "../../runtime/gameState.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { flagEmojiFromGid, flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { useLibraryState } from "../../runtime/library.js";

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

const Other = memo(function Other({ rightShift = "0.5rem", embedded = false }) {
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

    // In dock mode the badge is part of the responsive bottom command surface.
    // The old standalone badge still stays hidden on phones.
    if ((!embedded && isMobile) || !country) return null;

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
        <div
        className={embedded ? "oh-dock-polity" : undefined}
        title={displayName}
        style={embedded ? {
            alignItems: "center",
            display: "flex",
            gap: "0.58rem",
            minWidth: 0,
            maxWidth: isMobile ? "3.2rem" : "13.2rem",
            padding: isMobile ? "0 0.22rem" : "0 0.72rem 0 0.34rem",
            color: "white",
            fontFamily: "inherit",
            overflow: "hidden",
        } : {
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
        <div style={embedded ? {
            alignItems: "center",
            display: "flex",
            flex: "0 0 auto",
            height: "1.5rem",
            justifyContent: "center",
            overflow: "hidden",
            width: "2.25rem",
        } : { display: "contents" }}>
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
        </div>
        {embedded && !isMobile && (
            <div className="oh-dock-polity-meta" style={{ minWidth: 0, lineHeight: 1.05 }}>
                <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.75rem", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {displayName}
                </div>
                <div style={{ color: "rgba(198,215,235,0.42)", fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.04em", marginTop: "0.18rem", textTransform: "uppercase" }}>
                    Player polity
                </div>
            </div>
        )}
        </div>
    );
});

export { Other };
