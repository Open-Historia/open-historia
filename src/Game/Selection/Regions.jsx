import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";

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


const flagCache = {}; // GID_0 → { png, svg } | null

const fetchFlagUrls = async (gid0) => {
    if (!gid0) return null;
    const key = gid0.toUpperCase();
    if (key in flagCache) return flagCache[key];

    try {
        const res = await fetch(
            `https://restcountries.com/v3.1/alpha/${key}?fields=flags`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        flagCache[key] = data?.flags ?? null;
    } catch {
        flagCache[key] = null;
    }

    return flagCache[key];
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
    const [flagUrl, setFlagUrl] = useState(null);
    const { current: map } = useMap();

    _setSelection = (val) => {
        _currentSelection = val;
        setDismissing(false);
        setFlagUrl(null);
        setSelection(val);
        if (val !== null) setAnimKey((k) => k + 1);
    };

        _dismiss = () => setDismissing(true);

        const handleAnimationEnd = (e) => {
            if (e.animationName === "regionPopupFadeOut") {
                _currentSelection = null;
                setSelection(null);
                setFlagUrl(null);
                setDismissing(false);
            }
        };

        // Fetch flag whenever GID_0 changes
        useEffect(() => {
            if (!selection?.GID_0) { setFlagUrl(null); return; }
            let cancelled = false;
            fetchFlagUrls(selection.GID_0).then((flags) => {
                if (!cancelled) setFlagUrl(flags?.svg ?? null);
            });
                return () => { cancelled = true; };
        }, [selection?.GID_0]);

        // ocean click
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
            if (!map || !selection) { setScreenPos(null); return; }

            const update = () => {
                const center = map.getCenter();
                const toRad = (d) => (d * Math.PI) / 180;
                const lat1 = toRad(center.lat);
                const lat2 = toRad(selection.lngLat.lat);
                const dLng  = toRad(selection.lngLat.lng - center.lng);
                const cosAngle =
                Math.sin(lat1) * Math.sin(lat2) +
                Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);

                if (cosAngle < 0) { setScreenPos(null); return; }

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
    const POPUP_WIDTH = 210;

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
            : "regionPopupFadeIn  0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
        >
        {/* Card */}
        <div style={{
            backgroundColor: "rgba(17, 24, 39, 0.95)",
                        backdropFilter: "blur(4px)",
                        WebkitBackdropFilter: "blur(4px)",
                        borderRadius: "12px",
                        overflow: "hidden",
                        fontFamily: "sans-serif",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "white",
        }}>
        {/* Flag banner */}
        <div style={{ position: "relative", width: "100%", height: "96px", background: "rgba(30,42,60,0.6)" }}>
        {flagUrl ? (
            <img
            src={flagUrl}
            alt={COUNTRY}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.9 }}
            onError={(e) => { e.target.style.display = "none"; }}
            />
        ) : (
            <div style={{
                width: "100%", height: "100%", display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.2)", fontSize: "11px",
             letterSpacing: "0.05em",
            }}>
            {flagUrl === null && selection?.GID_0 ? "Loading…" : "No flag available"}
            </div>
        )}
        <button
        onClick={() => _dismiss?.()}
        style={{
            position: "absolute", top: "7px", right: "7px",
            background: "rgba(17,24,39,0.7)", backdropFilter: "blur(4px)",
                        border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px",
                        width: "22px", height: "22px", cursor: "pointer",
                        color: "rgba(255,255,255,0.5)", fontSize: "11px", padding: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "color 0.2s, background 0.2s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.9)"; e.currentTarget.style.background = "rgba(17,24,39,0.9)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "rgba(17,24,39,0.7)"; }}
        >✕</button>
        </div>

        {/* Info section */}
        <div style={{ padding: "8px 10px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", minHeight: "26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#3b82f6", flexShrink: 0, boxShadow: "0 0 6px rgba(59,130,246,0.6)" }} />
        <span style={{ color: "rgba(255,255,255,0.95)", fontWeight: 600, fontSize: "13px", lineHeight: 1.3, wordBreak: "break-word" }}>
        {COUNTRY}
        </span>
        </div>
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
        <IconBtn title="Copy country name" onClick={() => navigator.clipboard?.writeText(COUNTRY)}>⧉</IconBtn>
        <IconBtn title="Country info">ⓘ</IconBtn>
        </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "7px 0" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", minHeight: "22px" }}>
        <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "12px", minWidth: 0, wordBreak: "break-word" }}>
        {NAME_1}
        </span>
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
        <IconBtn title="Copy region name" onClick={() => navigator.clipboard?.writeText(NAME_1)}>⧉</IconBtn>
        <IconBtn title="Region info">ⓘ</IconBtn>
        </div>
        </div>
        </div>
        </div>

        {/* Arrow */}
        <div style={{
            width: 0, height: 0,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: "9px solid rgba(17,24,39,0.95)",
                        margin: "0 auto",
        }} />
        </div>,
        document.body
    );
};

export default RegionPopup;
