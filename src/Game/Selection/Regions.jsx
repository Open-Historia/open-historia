/*! Open Historia — portions (era polity names/flags + intel briefing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { getNationFlags, resolveCountryDisplayName } from "../../runtime/assets.js";
import { flagImageUrlFromGid, flagEmojiFromGid } from "../../runtime/countryFlags.js";
import { readWorldState } from "../../runtime/gameState.js";
import { requestDiplomaticChat } from "../GameUI/chat.jsx";
import { openCountryPanel } from "./CountryPanel.jsx";

let _setSelection = null;
let _currentSelection = null;
let _dismiss = null;
// Cheats' click-to-annex/edit tools grab the next map click(s) instead of the
// normal region popup. The interceptor returns true to consume the click.
let _clickInterceptor = null;

export const setRegionClickInterceptor = (fn) => {
    _clickInterceptor = typeof fn === "function" ? fn : null;
};

// Passive tap on every region click (the Stats tab watches which country the
// player is inspecting). Never consumes the click — popups still open.
let _clickObserver = null;

export const setRegionClickObserver = (fn) => {
    _clickObserver = typeof fn === "function" ? fn : null;
};

export const onRegionSelected = (props) => {
    try { _clickObserver?.(props); } catch { /* observers must never break clicks */ }
    if (_clickInterceptor && _clickInterceptor(props)) return;

    const { COUNTRY, NAME_1, GID_0, gid0, owner, lngLat } = props;
    if (!_setSelection) return;

    const isSame =
    _currentSelection &&
    _currentSelection.COUNTRY === COUNTRY &&
    _currentSelection.NAME_1 === NAME_1;

    if (isSame) {
        _dismiss?.();
    } else if (_currentSelection !== null) {
        _dismiss?.();
    } else {
        _setSelection({ COUNTRY, NAME_1, GID_0, gid0, owner, lngLat });
    }
};

export const onOceanClicked = () => {
    if (_currentSelection) _dismiss?.();
};

// Dismiss the region popup when another selection (e.g. a unit) takes over.
export const dismissRegionPopup = () => {
    if (_currentSelection) _dismiss?.();
};

const createFlagState = (status = "idle", imageUrl = null, emoji = null) => ({
    status,
    imageUrl,
    emoji,
});

// Flag image (with an emoji fallback) for a selected region's GID_0 country code.
const resolveFlagInfo = (gid0) => {
    const imageUrl = flagImageUrlFromGid(gid0);
    if (!imageUrl) return null;
    return { imageUrl, emoji: flagEmojiFromGid(gid0) };
};

// Era-aware flag: a scenario polity's own flag URL wins; otherwise the owner code
// resolves as an ISO country flag (correct for modern owners). Custom era polities
// with neither simply have no flag — the popup then says "No flag available".
const resolveEraFlagInfo = (ownerCode, polity, customFlags) => {
    // A flag the map-maker uploaded wins: it is the only one anyone chose on purpose.
    // It lives in the scenario's flags.json rather than on the polity, because
    // world.json is re-read every 5s and a few hundred flags would ride every poll.
    const own = ownerCode && customFlags?.[ownerCode];
    if (own) return { imageUrl: own, emoji: null };
    if (polity?.flag) return { imageUrl: polity.flag, emoji: null };
    return resolveFlagInfo(ownerCode);
};

const IconBtn = ({ children, title, onClick }) => {
    const [hovered, setHovered] = React.useState(false);

    return (
        <button
        title={title}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
            background: hovered ? "rgba(255,255,255,0.1)" : "none",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "6px",
            color: hovered ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: "11px",
            width: "22px",
            height: "22px",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background 0.2s, color 0.2s",
        }}
        >
        {children}
        </button>
    );
};

const ANIM_ID = "region-popup-anims";

if (typeof document !== "undefined" && !document.getElementById(ANIM_ID)) {
    const style = document.createElement("style");
    style.id = ANIM_ID;
    style.textContent = `
    @keyframes regionPopupFadeIn {
        from { opacity: 0; transform: translateY(calc(-100% + 10px)); }
        to   { opacity: 1; transform: translateY(-100%); }
    }
    @keyframes regionPopupFadeOut {
        from { opacity: 1; transform: translateY(-100%); }
        to   { opacity: 0; transform: translateY(calc(-100% + 10px)); }
    }
    `;
    document.head.appendChild(style);
}

const RegionPopup = () => {
    const [selection, setSelection] = useState(null);
    const [screenPos, setScreenPos] = useState(null);
    const [animKey, setAnimKey] = useState(0);
    const [dismissing, setDismissing] = useState(false);
    const [flagState, setFlagState] = useState(() => createFlagState());
    const [flagImageFailed, setFlagImageFailed] = useState(false);
    // Scenario polity registry (world.polityOverrides): era names + optional flags.
    const [polities, setPolities] = useState({});
    // Author-set flags from the scenario's flags.json (owner code -> data URL).
    // Memoized in assets.js, so this is one fetch per scenario, not per selection.
    const [customFlags, setCustomFlags] = useState({});
    const { current: map } = useMap();

    // Refresh the polity registry whenever a selection opens (cheap; keeps the
    // popup era-correct after switching games/scenarios mid-session).
    useEffect(() => {
        if (!selection) return;
        let cancelled = false;
        readWorldState({ force: true })
            .then((world) => {
                if (!cancelled) setPolities(world?.polityOverrides ?? {});
            })
            .catch(() => {});
        getNationFlags()
            .then((flags) => {
                if (!cancelled) setCustomFlags(flags || {});
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection?.GID_0, selection?.NAME_1]);

    _setSelection = (value) => {
        _currentSelection = value;
        setDismissing(false);
        setFlagState(value ? createFlagState("loading") : createFlagState());
        setFlagImageFailed(false);
        setSelection(value);
        if (value !== null) setAnimKey((key) => key + 1);
    };

    // Era-aware display name for the selected owner (polity name > overrides > modern).
    const resolveSelectionName = (sel) =>
        polities[sel?.GID_0]?.name || resolveCountryDisplayName(sel?.COUNTRY, sel?.GID_0);

    // Open a diplomatic chat with the selected country (via the chat panel bridge).
    const handleOpenChat = () => {
        if (!_currentSelection) return;
        requestDiplomaticChat({
            name: resolveSelectionName(_currentSelection),
            code: _currentSelection.GID_0,
        });
        _dismiss?.();
    };

    // Open the full country panel (related events, aliases, owned regions,
    // advisor report, diplomacy) for the selected owner.
    const handleToggleStats = () => {
        const sel = _currentSelection;
        if (!sel) return;
        const flagInfo = resolveEraFlagInfo(sel.GID_0, polities[sel.GID_0], customFlags);
        openCountryPanel({
            code: sel.GID_0,
            name: resolveSelectionName(sel),
            flagUrl: flagInfo?.imageUrl || null,
            flagEmoji: flagInfo?.emoji || null,
        });
        _dismiss?.();
    };

    _dismiss = () => setDismissing(true);

    const handleAnimationEnd = (e) => {
        if (e.animationName !== "regionPopupFadeOut") return;

        _currentSelection = null;
        setSelection(null);
        setFlagState(createFlagState());
        setFlagImageFailed(false);
        setDismissing(false);
    };

    useEffect(() => {
        const unclaimed = selection?.owner === "";
        if (unclaimed || (!selection?.GID_0 && !selection?.COUNTRY)) {
            setFlagState(createFlagState());
            return;
        }

        setFlagImageFailed(false);

        // Era-correct flag only: the polity's own flag, else the owner's ISO flag.
        // Deliberately NO modern-country fallback — an era polity without a flag
        // shows "No flag available" rather than an anachronistic modern flag.
        const flagInfo = resolveEraFlagInfo(selection.GID_0, polities[selection.GID_0], customFlags);
        setFlagState(
            flagInfo
                ? createFlagState("ready", flagInfo.imageUrl, flagInfo.emoji)
                : createFlagState("error"),
        );
    }, [selection?.COUNTRY, selection?.GID_0, selection?.owner, polities]);

    useEffect(() => {
        if (!map) return;

        const handleMapClick = (e) => {
            const features = map.queryRenderedFeatures(e.point);
            if ((!features || features.length === 0) && _currentSelection) {
                _dismiss?.();
            }
        };

        map.on("click", handleMapClick);
        return () => map.off("click", handleMapClick);
    }, [map]);

    useEffect(() => {
        if (!map || !selection) {
            setScreenPos(null);
            return;
        }

        const update = () => {
            const center = map.getCenter();
            const toRad = (deg) => (deg * Math.PI) / 180;
            const lat1 = toRad(center.lat);
            const lat2 = toRad(selection.lngLat.lat);
            const dLng = toRad(selection.lngLat.lng - center.lng);
            const cosAngle =
            Math.sin(lat1) * Math.sin(lat2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);

            if (cosAngle < 0) {
                setScreenPos(null);
                return;
            }

            const point = map.project(selection.lngLat);
            setScreenPos((prev) => {
                if (
                    prev &&
                    Math.abs(prev.x - point.x) < 0.5 &&
                    Math.abs(prev.y - point.y) < 0.5
                ) {
                    return prev;
                }

                return { x: point.x, y: point.y };
            });
        };

        let frameId = 0;
        const scheduleUpdate = () => {
            if (frameId) return;
            frameId = requestAnimationFrame(() => {
                frameId = 0;
                update();
            });
        };

        update();
        map.on("move", scheduleUpdate);
        return () => {
            if (frameId) cancelAnimationFrame(frameId);
            map.off("move", scheduleUpdate);
        };
    }, [map, selection]);

    if (!selection || !screenPos) return null;

    const { COUNTRY, NAME_1 } = selection;
    // Custom regions with an empty owner are deliberately unclaimed land.
    const isUnclaimed = selection.owner === "";
    // Era name first: the scenario's polity name for the owner ("Holy Roman
    // Empire", not "Germany"), then scenario name overrides, then the modern name.
    const displayCountry = isUnclaimed
        ? "Unclaimed Territory"
        : polities[selection.GID_0]?.name
            || resolveCountryDisplayName(COUNTRY, selection.GID_0);
    const POPUP_WIDTH = 210;
    const showFlagImage = Boolean(flagState.imageUrl && !flagImageFailed);
    const showFlagEmoji = Boolean(!showFlagImage && flagState.emoji);

    return createPortal(
        <div
        key={animKey}
        onAnimationEnd={handleAnimationEnd}
        style={{
            position: "fixed",
            left: screenPos.x - POPUP_WIDTH / 2,
            top: screenPos.y - 10,
            width: `${POPUP_WIDTH}px`,
            zIndex: 20,
            pointerEvents: dismissing ? "none" : "auto",
            animation: dismissing
            ? "regionPopupFadeOut 0.18s cubic-bezier(0.4, 0, 1, 1) both"
            : "regionPopupFadeIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
        >
        <div
        style={{
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            borderRadius: "12px",
            overflow: "hidden",
            fontFamily: "sans-serif",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "white",
        }}
        >
        <div style={{ position: "relative", width: "100%", height: "96px", background: "rgba(30,42,60,0.6)" }}>
        {showFlagImage ? (
            <img
            src={flagState.imageUrl}
            alt={displayCountry}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.9 }}
            onError={() => setFlagImageFailed(true)}
            />
        ) : (
            <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: showFlagEmoji ? "white" : "rgba(255,255,255,0.2)",
                fontSize: showFlagEmoji ? "3rem" : "11px",
                letterSpacing: showFlagEmoji ? 0 : "0.05em",
                textShadow: showFlagEmoji ? "0 4px 18px rgba(0,0,0,0.35)" : "none",
            }}
            >
            {showFlagEmoji
            ? flagState.emoji
            : flagState.status === "loading" && selection?.GID_0
            ? "Loading..."
            : "No flag available"}
            </div>
        )}
        <button
        onClick={() => _dismiss?.()}
        style={{
            position: "absolute",
            top: "7px",
            right: "7px",
            background: "rgba(17,24,39,0.7)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "6px",
            width: "22px",
            height: "22px",
            cursor: "pointer",
            color: "rgba(255,255,255,0.5)",
            fontSize: "11px",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "color 0.2s, background 0.2s",
        }}
        onMouseEnter={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.9)";
            e.currentTarget.style.background = "rgba(17,24,39,0.9)";
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.5)";
            e.currentTarget.style.background = "rgba(17,24,39,0.7)";
        }}
        >
        {"\u2715"}
        </button>
        </div>

        <div style={{ padding: "8px 10px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", minHeight: "26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#3b82f6", flexShrink: 0, boxShadow: "0 0 6px rgba(59,130,246,0.6)" }} />
        <span style={{ color: "rgba(255,255,255,0.95)", fontWeight: 600, fontSize: "13px", lineHeight: 1.3, wordBreak: "break-word" }}>
        {displayCountry}
        </span>
        </div>
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
        {!isUnclaimed && <IconBtn title="Open diplomatic chat" onClick={handleOpenChat}>{"\uD83D\uDCAC"}</IconBtn>}
        <IconBtn title="Copy name" onClick={() => navigator.clipboard?.writeText(displayCountry)}>{"\u29C9"}</IconBtn>
        {!isUnclaimed && <IconBtn title="Country intel (AI)" onClick={handleToggleStats}>{"\u24D8"}</IconBtn>}
        </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "7px 0" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", minHeight: "22px" }}>
        <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "12px", minWidth: 0, wordBreak: "break-word" }}>
        {NAME_1}
        </span>
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
        <IconBtn title="Copy region name" onClick={() => navigator.clipboard?.writeText(NAME_1)}>{"\u29C9"}</IconBtn>
        <IconBtn title="Region info">{"\u24D8"}</IconBtn>
        </div>
        </div>

        </div>
        </div>

        <div
        style={{
            width: 0,
            height: 0,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: "9px solid rgba(17,24,39,0.95)",
            margin: "0 auto",
        }}
        />
        </div>,
        document.body
    );
};

export default RegionPopup;
