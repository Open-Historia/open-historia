/*! Open Historia — portions (era polity names/flags + intel briefing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { getNationFlags, resolveCountryDisplayName } from "../../runtime/assets.js";
import { readWorldState } from "../../runtime/gameState.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { requestDiplomaticChat } from "../GameUI/chat.jsx";
import { openCountryPanel } from "./CountryPanel.jsx";

let _setSelection = null;
let _currentSelection = null;
let _dismiss = null;
let _selectionRequestSerial = 0;
// Cheats' click-to-annex/edit tools grab the next map click(s) instead of the
// normal region popup. The interceptor returns true to consume the click.
let _clickInterceptor = null;

export const setRegionClickInterceptor = (fn) => {
    _clickInterceptor = typeof fn === "function" ? fn : null;
};

// Passive tap on every normal region click (the Stats tab watches which country
// the player is inspecting). Never consumes the click — popups still open.
let _clickObserver = null;

export const setRegionClickObserver = (fn) => {
    _clickObserver = typeof fn === "function" ? fn : null;
};

const cleanSelectionValue = (value) => String(value ?? "").trim();

const currentRegionId = (props) =>
    cleanSelectionValue(
        props?.GID_1 ??
        props?.gid_1 ??
        props?.id ??
        "",
    );

// Normalize selection identity at the source boundary.
//
// Base-map vector tiles keep their original country metadata forever, even after
// conquest, annexation, occupation, editor changes, or other live ownership
// mutations. Every downstream region-click consumer should therefore see the
// current canonical controller from world.regionOwnershipOverrides when one is
// present. The original geographic GID_0 is retained in `gid0` as provenance.
//
// This replaces the old DevTools Region Owner Fix with a native, universal path:
// no country names, ISO assumptions, React-fiber surgery, or Stats-specific patch.
const resolveLiveSelectionProps = async (props) => {
    if (!props || typeof props !== "object") return props;

    const regionId = currentRegionId(props);
    if (!regionId) return props;

    let world;
    try {
        // Region ownership may have changed seconds ago through cheats, GM/editor,
        // war control, or normal simulation. Force a fresh read for click identity
        // rather than trusting stale tile metadata or a long-lived UI cache.
        world = await readWorldState({ force: true });
    } catch {
        return props;
    }

    const overrides =
        world?.regionOwnershipOverrides &&
        typeof world.regionOwnershipOverrides === "object"
            ? world.regionOwnershipOverrides
            : {};

    if (!Object.prototype.hasOwnProperty.call(overrides, regionId)) {
        return props;
    }

    const rawController = cleanSelectionValue(overrides[regionId]);
    const resolvedController = rawController
        ? resolvePolityIdentity(rawController, world, {
            allowUnknown: true,
            requireActive: false,
            allowCoreMatch: true,
            allowStockBase: true,
        }).resolved || rawController
        : "";

    const baseGid0 = cleanSelectionValue(
        props.gid0 ??
        props.GID_0 ??
        "",
    );

    return {
        ...props,
        // Current controller/owner is authoritative for every normal consumer.
        COUNTRY: resolvedController,
        GID_0: resolvedController,
        owner: resolvedController,
        // Keep the baked geographic/base identity separately for provenance.
        gid0: baseGid0,
    };
};

const commitRegionSelection = (props) => {
    if (!props || typeof props !== "object") return;

    try { _clickObserver?.(props); } catch { /* observers must never break clicks */ }

    const { COUNTRY, NAME_1, GID_0, GID_1, gid0, owner, lngLat } = props;
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
        _setSelection({ COUNTRY, NAME_1, GID_0, GID_1, gid0, owner, lngLat });
    }
};

export const onRegionSelected = (props) => {
    // Cheat/editor click interceptors operate on the raw click synchronously and
    // remain authoritative. A consumed click is not a normal inspection click.
    if (_clickInterceptor && _clickInterceptor(props)) return;

    const serial = ++_selectionRequestSerial;

    resolveLiveSelectionProps(props)
        .then((liveProps) => {
            // Ignore an older async owner lookup if the user clicked elsewhere.
            if (serial !== _selectionRequestSerial) return;
            commitRegionSelection(liveProps);
        })
        .catch(() => {
            if (serial !== _selectionRequestSerial) return;
            commitRegionSelection(props);
        });
};

export const onOceanClicked = () => {
    _selectionRequestSerial++;
    if (_currentSelection) _dismiss?.();
};

// Dismiss the region popup when another selection (e.g. a unit) takes over.
export const dismissRegionPopup = () => {
    _selectionRequestSerial++;
    if (_currentSelection) _dismiss?.();
};

const createFlagState = (status = "idle", imageUrl = null, emoji = null) => ({
    status,
    imageUrl,
    emoji,
});

// Flags are resolved through the shared stable-lineage flag service below.

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
    const [worldState, setWorldState] = useState(null);
    // sparse control metadata. ownership is the de-facto controller; sovereignty is
    // only stored when it differs, because duplicating every normal border is dumb.
    const [territoryState, setTerritoryState] = useState({
        regionClaimants: {},
        regionOwnershipOverrides: {},
        regionSovereigntyOverrides: {},
    });
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
                if (cancelled) return;
                setWorldState(world);
                setPolities(world?.polityOverrides ?? {});
                setTerritoryState({
                    regionClaimants: world?.regionClaimants ?? {},
                    regionOwnershipOverrides: world?.regionOwnershipOverrides ?? {},
                    regionSovereigntyOverrides: world?.regionSovereigntyOverrides ?? {},
                });
            })
            .catch(() => {});
        getNationFlags({ force: true })
            .then((flags) => {
                if (!cancelled) setCustomFlags(flags || {});
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection?.GID_0, selection?.GID_1, selection?.NAME_1]);

    useEffect(() => {
        if (!selection) return;
        let cancelled = false;
        const refresh = () => {
            getNationFlags({ force: true })
                .then((flags) => {
                    if (!cancelled) {
                        setCustomFlags(flags || {});
                        setFlagImageFailed(false);
                    }
                })
                .catch(() => {});
        };
        window.addEventListener("oh:flags-updated", refresh);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:flags-updated", refresh);
        };
    }, [selection]);

    _setSelection = (value) => {
        _currentSelection = value;
        setDismissing(false);
        setFlagState(value ? createFlagState("loading") : createFlagState());
        setFlagImageFailed(false);
        setSelection(value);
        if (value !== null) setAnimKey((key) => key + 1);
    };

    const controllerForSelection = (sel) => {
        const regionId = sel?.GID_1 || "";
        return regionId
            ? territoryState.regionOwnershipOverrides?.[regionId] ?? sel?.GID_0 ?? sel?.owner ?? ""
            : sel?.GID_0 ?? sel?.owner ?? "";
    };

    const resolveSelectionIdentity = (sel) => {
        const controller = controllerForSelection(sel);
        const identity = resolvePolityIdentity(controller || sel?.GID_0 || sel?.COUNTRY, worldState, {
            allowUnknown: false,
            requireActive: false,
            allowCoreMatch: true,
            allowStockBase: true,
        });
        const polityKey = identity.resolved || controller || sel?.GID_0 || "";
        const record = worldState?.polityOverrides?.[polityKey];
        return {
            polityKey,
            code: sel?.GID_0 || "",
            name: record?.name || polityKey || resolveCountryDisplayName(sel?.COUNTRY, sel?.GID_0),
        };
    };

    // Open a diplomatic chat with the CURRENT controller, not the baked geography.
    const handleOpenChat = () => {
        if (!_currentSelection) return;
        requestDiplomaticChat(resolveSelectionIdentity(_currentSelection));
        _dismiss?.();
    };

    // Open the full country panel for the CURRENT controller. The panel resolves
    // its own live flag, so this bridge never has to carry stale visual metadata.
    const handleToggleStats = () => {
        const sel = _currentSelection;
        if (!sel) return;
        openCountryPanel(resolveSelectionIdentity(sel));
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

        const identity = resolveSelectionIdentity(selection);
        const flagInfo = resolvePolityFlag({
            polity: identity,
            world: worldState,
            flags: customFlags,
        });
        setFlagState(
            flagInfo?.imageUrl
                ? createFlagState("ready", flagInfo.imageUrl, null)
                : createFlagState("error"),
        );
    }, [selection?.COUNTRY, selection?.GID_0, selection?.GID_1, selection?.owner, worldState, customFlags, territoryState]);

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
    const regionId = selection.GID_1 || "";
    const controllerCode = regionId
        ? territoryState.regionOwnershipOverrides?.[regionId] ?? selection.GID_0 ?? selection.owner ?? ""
        : selection.GID_0 ?? selection.owner ?? "";
    const sovereignCode = regionId
        ? territoryState.regionSovereigntyOverrides?.[regionId] ?? controllerCode
        : controllerCode;
    const rawClaimants = regionId ? territoryState.regionClaimants?.[regionId] : null;
    const claimants = [...new Set(
        (Array.isArray(rawClaimants)
            ? rawClaimants
            : rawClaimants && typeof rawClaimants === "object"
                ? Object.keys(rawClaimants).filter((key) => rawClaimants[key])
                : [])
            .map((value) => String(value ?? "").trim())
            .filter((value) => value && value !== controllerCode),
    )];
    const isUnclaimed = controllerCode === "";
    const isOccupied = Boolean(controllerCode && sovereignCode && controllerCode !== sovereignCode);
    const isContested = claimants.length > 0;
    const controlStatus = isOccupied && isContested
        ? "Occupied / contested"
        : isOccupied
            ? "Occupied"
            : isContested
                ? "Contested"
                : isUnclaimed
                    ? "Unclaimed"
                    : "Administered";
    const displayPolity = (code) => {
        if (!code) return "Unclaimed Territory";
        const identity = resolvePolityIdentity(code, worldState, {
            allowUnknown: true,
            requireActive: false,
            allowCoreMatch: true,
            allowStockBase: true,
        });
        const key = identity.resolved || code;
        return worldState?.polityOverrides?.[key]?.name || key || "Unclaimed Territory";
    };
    // header stays on the current administrator/controller. legal title goes below.
    const displayCountry = isUnclaimed ? "Unclaimed Territory" : displayPolity(controllerCode);
    const POPUP_WIDTH = 238;
    const showFlagImage = Boolean(flagState.imageUrl && !flagImageFailed);

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
                color: "rgba(255,255,255,0.2)",
                fontSize: "11px",
                letterSpacing: "0.05em",
            }}
            >
            {flagState.status === "loading" && selection?.GID_0
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

        {!isUnclaimed && (isOccupied || isContested) && (
            <>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "7px 0 5px" }} />
            <div style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", gap: "3px 7px", fontSize: "11px", lineHeight: 1.35 }}>
            <span style={{ color: "rgba(255,255,255,0.42)" }}>Sovereign</span>
            <span style={{ color: "rgba(255,255,255,0.84)", wordBreak: "break-word" }}>{displayPolity(sovereignCode)}</span>
            <span style={{ color: "rgba(255,255,255,0.42)" }}>Controlled by</span>
            <span style={{ color: "rgba(255,255,255,0.84)", wordBreak: "break-word" }}>{displayPolity(controllerCode)}</span>
            <span style={{ color: "rgba(255,255,255,0.42)" }}>Status</span>
            <span style={{ color: isOccupied ? "#fbbf24" : "rgba(255,255,255,0.84)", fontWeight: 700 }}>{controlStatus}</span>
            {claimants.length > 0 && (
                <>
                <span style={{ color: "rgba(255,255,255,0.42)" }}>Claimants</span>
                <span style={{ color: "rgba(255,255,255,0.84)", wordBreak: "break-word" }}>
                {claimants.map(displayPolity).join(", ")}
                </span>
                </>
            )}
            </div>
            </>
        )}

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
