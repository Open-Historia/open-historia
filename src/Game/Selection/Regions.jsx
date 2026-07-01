import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { resolveCountryDisplayName } from "../../runtime/assets.js";
import { flagImageUrlFromGid, flagEmojiFromGid } from "../../runtime/countryFlags.js";

let _setSelection = null;
let _currentSelection = null;
let _dismiss = null;

export const onRegionSelected = ({ COUNTRY, NAME_1, GID_0, lngLat }) => {
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
        _setSelection({ COUNTRY, NAME_1, GID_0, lngLat });
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
    const { current: map } = useMap();

    _setSelection = (value) => {
        _currentSelection = value;
        setDismissing(false);
        setFlagState(value ? createFlagState("loading") : createFlagState());
        setFlagImageFailed(false);
        setSelection(value);
        if (value !== null) setAnimKey((key) => key + 1);
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
        if (!selection?.GID_0 && !selection?.COUNTRY) {
            setFlagState(createFlagState());
            return;
        }

        setFlagImageFailed(false);

        const flagInfo = resolveFlagInfo(selection.GID_0);
        setFlagState(
            flagInfo
                ? createFlagState("ready", flagInfo.imageUrl, flagInfo.emoji)
                : createFlagState("error"),
        );
    }, [selection?.COUNTRY, selection?.GID_0]);

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
    const displayCountry = resolveCountryDisplayName(COUNTRY, selection.GID_0);
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
        <IconBtn title="Copy country name" onClick={() => navigator.clipboard?.writeText(displayCountry)}>{"\u29C9"}</IconBtn>
        <IconBtn title="Country info">{"\u24D8"}</IconBtn>
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
