/*! Open Historia — portions (era polity names/flags + intel briefing) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { getNationFlags, getPrimedScenarioRegionCatalog, resolveCountryDisplayName } from "../../runtime/assets.js";
import { withMapClaims } from "../../runtime/mapClaims.js";
import { normalizeGroupAreas, normalizeGroups } from "../../runtime/groups.js";
import { readGameData, readWorldState } from "../../runtime/gameState.js";
import { livePuppetsFor, puppetKindLabel, puppetSummaryFor } from "../../runtime/puppets.js";
import { getWorldStateSnapshot } from "../Map/useWorldState.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { countryGidFromIdentity } from "../../runtime/countryFlags.js";
import { requestDiplomaticChat } from "../GameUI/chat.jsx";
import { openCountryPanel } from "./CountryPanel.jsx";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { APP_HEIGHT, MAP_CARD_OPENED, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useShortTouchScreen, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useBackToClose } from "../../runtime/backToClose.js";

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

// Stable browser event for passive consumers of a committed normal region
// selection. Unlike the legacy module-global observer below, this survives
// lazy chunk / HMR module boundaries and allows multiple listeners without
// changing the click-consumption contract.
export const REGION_SELECTED_EVENT = "oh:region-selected";

// Legacy passive tap retained for compatibility with any synchronous consumers.
// Never consumes the click — popups still open.
let _clickObserver = null;

// WHO IS PLAYING, and why it is read here rather than per click. What the card
// may say about a subordination depends on the viewer, and a COVERT one is
// invisible to a viewer it does not know — so a popup that had not yet learned
// the player's country showed no puppet panel at all, and an open one in a
// stranger's words. It is read once, kept for the session, and refreshed in the
// background; the first click of a session no longer races a request.
let _playerCountry = "";
const rememberPlayerCountry = (readGame) => readGame()
    .then((game) => {
        _playerCountry = String(game?.country ?? "").trim() || _playerCountry;
        return _playerCountry;
    })
    .catch(() => _playerCountry);

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

    let world = getWorldStateSnapshot();
    if (!world) {
        try {
            // Cold-start fallback only. Normal clicks use the map's live singleton
            // world snapshot and never fetch/parse the whole campaign.
            world = await readWorldState({ force: false });
        } catch {
            return props;
        }
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

    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
        try {
            window.dispatchEvent(new CustomEvent(REGION_SELECTED_EVENT, { detail: props }));
        } catch { /* passive listeners must never break clicks */ }
    }
    try { _clickObserver?.(props); } catch { /* observers must never break clicks */ }

    const { COUNTRY, NAME_1, GID_0, GID_1, gid0, owner, lngLat } = props;
    if (!_setSelection) return;

    const isSame =
    _currentSelection &&
    _currentSelection.COUNTRY === COUNTRY &&
    _currentSelection.NAME_1 === NAME_1;

    // Clicking the region already shown closes its card. Clicking a DIFFERENT
    // one shows that region: it used to only close the open card, so every
    // other click round the map appeared to do nothing and the card had to be
    // asked for twice. _setSelection replays the card's entrance on the new
    // region, which discards the outgoing one.
    if (isSame) _dismiss?.();
    else _setSelection({ COUNTRY, NAME_1, GID_0, GID_1, gid0, owner, lngLat });
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
        // Finger-sized on a touch screen (styles.css); a mouse keeps 22 px.
        className="oh-tap"
        title={title}
        aria-label={title}
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
    @keyframes regionSheetFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: none; }
    }
    @keyframes regionSheetFadeOut {
        from { opacity: 1; transform: none; }
        to   { opacity: 0; transform: translateY(10px); }
    }
    `;
    document.head.appendChild(style);
}

// On a phone the card is a sheet across the bottom of the screen: anchored at
// the tap, a 238 px card ran off the side of a 375 px screen whenever the tap
// was near an edge. It sits above the toolbar and the advisor button (4rem
// tall, 0.5rem up), stops 6rem short of the top for the date bar, and scrolls
// if it is taller than that leaves.
const SHEET_PLACEMENT = {
    left: `calc(0.5rem + ${SAFE_LEFT})`,
    right: `calc(0.5rem + ${SAFE_RIGHT})`,
    bottom: `calc(5rem + ${SAFE_BOTTOM})`,
};
const SHEET_MAX_HEIGHT = `calc(${APP_HEIGHT} - 6rem - ${SAFE_TOP} - 5rem - ${SAFE_BOTTOM})`;
// Held sideways, a narrower sheet at the right, clear of the chat and other
// panels at the left: between the date bar (4.5rem down) and the flag badge
// over the advisor button (7.75rem up), and scrolling in what that leaves.
const SIDEWAYS_SHEET_PLACEMENT = {
    right: `calc(0.5rem + ${SAFE_RIGHT})`,
    bottom: `calc(7.75rem + ${SAFE_BOTTOM})`,
    width: `min(22rem, calc(100vw - 1rem - ${SAFE_LEFT} - ${SAFE_RIGHT}))`,
};
const SIDEWAYS_SHEET_MAX_HEIGHT = `calc(${APP_HEIGHT} - 4.5rem - ${SAFE_TOP} - 7.75rem - ${SAFE_BOTTOM})`;

// The groups (runtime/groups.js) and which regions each controls, as the card
// reads them.
const groupsOf = (world) => {
    const groups = normalizeGroups(world?.groups);
    return { groups, groupAreas: normalizeGroupAreas(world?.groupAreas, groups) };
};

const RegionPopup = () => {
    const isMobile = useIsMobile();
    // A sheet on a phone, and on a phone held sideways (runtime/mobileUi.js).
    const shortTouch = useShortTouchScreen();
    const asSheet = isMobile || shortTouch;
    const isTouch = useTouchPrimary();
    const [selection, setSelection] = useState(null);
    const [screenPos, setScreenPos] = useState(null);
    const [animKey, setAnimKey] = useState(0);
    const [dismissing, setDismissing] = useState(false);
    const [flagState, setFlagState] = useState(() => createFlagState());
    const [flagImageFailed, setFlagImageFailed] = useState(false);
    // Scenario polity registry (world.polityOverrides): era names + optional flags.
    const [polities, setPolities] = useState({});
    const [worldState, setWorldState] = useState(null);
    // Who is looking, for the puppet lines: what the card may say about a
    // subordination depends on whether the player is party to it or found it out.
    // Kept across popups, not read afresh for each: the read is a promise, and
    // the first paint after a click would otherwise have no viewer at all — and
    // a card with no viewer is the player's own overlord described to them as a
    // stranger's business. The panel is suppressed until this is known.
    const [playerCountry, setPlayerCountry] = useState(_playerCountry);
    useEffect(() => {
        let cancelled = false;
        // The cached read, not a forced one: this is the same game.json every
        // other panel holds, and a failed round trip used to leave the card
        // with no viewer and so no puppet panel.
        rememberPlayerCountry(readGameData).then((country) => { if (!cancelled) setPlayerCountry(country); });
        return () => { cancelled = true; };
    }, [selection]);
    // sparse control metadata. ownership is the de-facto controller; sovereignty is
    // only stored when it differs, because duplicating every normal border is dumb.
    const [territoryState, setTerritoryState] = useState({
        regionClaimants: {},
        regionOwnershipOverrides: {},
        regionSovereigntyOverrides: {},
        groups: {},
        groupAreas: {},
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
        const applyWorld = (world) => {
            if (cancelled || !world) return;
            setWorldState(world);
            setPolities(world?.polityOverrides ?? {});
            setTerritoryState({
                // The map file's own disputes too, as the map shows them
                // (runtime/mapClaims.js): a dispute drawn in the Workshop was
                // striped on the map with no claimant on this card.
                regionClaimants: withMapClaims(world, getPrimedScenarioRegionCatalog())?.regionClaimants ?? {},
                regionOwnershipOverrides: world?.regionOwnershipOverrides ?? {},
                regionSovereigntyOverrides: world?.regionSovereigntyOverrides ?? {},
                ...groupsOf(world),
            });
        };

        const snapshot = getWorldStateSnapshot();
        if (snapshot) {
            applyWorld(snapshot);
        } else {
            readWorldState({ force: false })
                .then(applyWorld)
                .catch(() => {});
        }

        // flags.json is invalidated + announced by the asset writer. Reuse the
        // memoized catalog instead of forcing another network fetch on each click.
        getNationFlags()
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
        if (!selection || typeof window === "undefined") return undefined;
        const onWorldUpdated = (event) => {
            const world = event?.detail?.world;
            if (!world || typeof world !== "object") return;
            setWorldState(world);
            setPolities(world?.polityOverrides ?? {});
            setTerritoryState({
                regionClaimants: withMapClaims(world, getPrimedScenarioRegionCatalog())?.regionClaimants ?? {},
                regionOwnershipOverrides: world?.regionOwnershipOverrides ?? {},
                regionSovereigntyOverrides: world?.regionSovereigntyOverrides ?? {},
                ...groupsOf(world),
            });
        };
        window.addEventListener("oh:world-updated", onWorldUpdated);
        return () => window.removeEventListener("oh:world-updated", onWorldUpdated);
    }, [selection]);

    useEffect(() => {
        if (!selection) return;
        let cancelled = false;
        const refresh = () => {
            getNationFlags()
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
        // Current polity identity and stock geographic identity are separate.
        // A custom map may have no tile-baked GID_0 at all; the Workshop/importer
        // can still preserve the polity's standard-country bridge in record.code.
        // Prefer that stable record metadata, then the resolver's own code, then
        // baked geographic provenance, and only finally the legacy GID_0 field.
        const stockCode = cleanSelectionValue(
            record?.code ||
            identity?.code ||
            sel?.gid0 ||
            // Backward-compatible repair for already-imported custom maps whose
            // polity records predate importer code preservation.
            countryGidFromIdentity(record?.name || polityKey || controller) ||
            sel?.GID_0 ||
            "",
        );
        return {
            polityKey,
            code: stockCode,
            name: record?.name || polityKey || resolveCountryDisplayName(sel?.COUNTRY, stockCode || sel?.GID_0),
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
        if (e.animationName !== "regionPopupFadeOut" && e.animationName !== "regionSheetFadeOut") return;

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
        // A phone's sheet follows no point on the map, so nothing is tracked.
        if (!map || !selection || asSheet) {
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
    }, [map, selection, asSheet]);

    // On a phone the card and a bottom panel would share one spot at the
    // bottom of the screen, the card underneath: it tells the HUD it opened,
    // and the HUD shuts the panel (GameUI/main.jsx).
    useEffect(() => {
        if (isMobile && selection) window.dispatchEvent(new CustomEvent(MAP_CARD_OPENED));
    }, [isMobile, selection]);

    // Back on a phone closes the card (runtime/backToClose.js).
    useBackToClose(Boolean(selection) && !dismissing, () => setDismissing(true));

    if (!selection || (!asSheet && !screenPos)) return null;

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
    const controllingGroup = regionId ? territoryState.groups?.[territoryState.groupAreas?.[regionId]] ?? null : null;
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
    // The same summary the country panel shows (runtime/puppets.js), and for an
    // Overlord the Puppets this viewer knows it holds. A covert arrangement the
    // player never uncovered leaves no trace on the card.
    const controllerKey = isUnclaimed ? "" : (resolvePolityIdentity(controllerCode, worldState, {
        allowUnknown: true,
        requireActive: false,
        allowCoreMatch: true,
        allowStockBase: true,
    }).resolved || controllerCode || "");
    const subordination = controllerKey && worldState ? puppetSummaryFor(worldState, playerCountry, controllerKey) : null;
    const heldPuppets = controllerKey && worldState && playerCountry
        ? livePuppetsFor(worldState, playerCountry).filter((row) => row.overlord === controllerKey)
        : [];
    // Wider on a touch screen that still anchors the card at the tap (a tablet,
    // a phone on its side): the finger-sized buttons took 140 of the header's
    // 216 px and broke the country's name mid-word.
    const POPUP_WIDTH = isTouch ? 300 : 238;
    const showFlagImage = Boolean(flagState.imageUrl && !flagImageFailed);

    return createPortal(
        <div
        key={animKey}
        onAnimationEnd={handleAnimationEnd}
        style={{
            position: "fixed",
            ...(asSheet ? (isMobile ? SHEET_PLACEMENT : SIDEWAYS_SHEET_PLACEMENT) : {
                left: screenPos.x - POPUP_WIDTH / 2,
                top: screenPos.y - 10,
                width: `${POPUP_WIDTH}px`,
            }),
            zIndex: 20,
            pointerEvents: dismissing ? "none" : "auto",
            animation: dismissing
            ? `${asSheet ? "regionSheetFadeOut" : "regionPopupFadeOut"} 0.18s cubic-bezier(0.4, 0, 1, 1) both`
            : `${asSheet ? "regionSheetFadeIn" : "regionPopupFadeIn"} 0.22s cubic-bezier(0.22, 1, 0.36, 1) both`,
        }}
        >
        <div
        style={{
            backgroundColor: "rgba(24, 24, 27, 0.95)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            borderRadius: "12px",
            overflow: asSheet ? "auto" : "hidden",
            maxHeight: asSheet ? (isMobile ? SHEET_MAX_HEIGHT : SIDEWAYS_SHEET_MAX_HEIGHT) : undefined,
            fontFamily: "sans-serif",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "white",
        }}
        >
        <div style={{ position: "relative", width: "100%", height: "96px", background: "rgba(41,41,45,0.6)" }}>
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
        className="oh-tap"
        aria-label="Close region card"
        onClick={() => _dismiss?.()}
        style={{
            position: "absolute",
            top: "7px",
            right: "7px",
            background: "rgba(24,24,27,0.7)",
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
            e.currentTarget.style.background = "rgba(24,24,27,0.9)";
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.5)";
            e.currentTarget.style.background = "rgba(24,24,27,0.7)";
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

        {subordination && (
            <div style={{ marginTop: "7px", padding: "7px 9px", borderRadius: "9px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.13)", borderLeft: "2px solid rgba(255,255,255,0.3)" }}>
            <span style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "rgba(255,255,255,0.96)" }}>{subordination.headline}</span>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.82)", lineHeight: 1.4, marginTop: "3px" }}>{subordination.meaning}</div>
            {subordination.facts.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginTop: "5px" }}>
                {subordination.facts.map((fact) => (
                    <span key={fact} style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px", color: "rgba(255,255,255,0.7)", fontSize: "10px", padding: "1px 6px", whiteSpace: "nowrap" }}>{fact}</span>
                ))}
                </div>
            )}
            {subordination.provenance && (
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", fontStyle: "italic", marginTop: "3px" }}>{subordination.provenance}</div>
            )}
            </div>
        )}
        {heldPuppets.length > 0 && (
            <div style={{ marginTop: "7px", fontSize: "11px", lineHeight: 1.4, color: "rgba(255,255,255,0.8)" }}>
            <span style={{ color: "rgba(255,255,255,0.45)" }}>{heldPuppets[0].role === "overlord" ? "Our puppets: " : "Puppets: "}</span>
            {heldPuppets.map((row) => `${row.puppet} (${puppetKindLabel(row.kind)})`).join(", ")}
            </div>
        )}

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

        {controllingGroup && (
            <>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "7px 0 5px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", lineHeight: 1.35, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "2px", flexShrink: 0, background: controllingGroup.color, boxShadow: "0 0 0 1px rgba(0,0,0,0.55)" }} />
            <span style={{ color: "rgba(255,255,255,0.42)", flexShrink: 0 }}>Group control</span>
            <span style={{ color: controllingGroup.color, fontWeight: 700, minWidth: 0, wordBreak: "break-word" }}>{controllingGroup.name}</span>
            </div>
            {controllingGroup.description && (
                <div style={{ marginTop: "3px", fontSize: "11px", lineHeight: 1.4, color: "rgba(255,255,255,0.72)", maxHeight: "88px", overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {controllingGroup.description}
                </div>
            )}
            </>
        )}

        </div>
        </div>

        {/* The pointer at the tapped spot; a phone's sheet points at nothing. */}
        {!asSheet && (
            <div
            style={{
                width: 0,
                height: 0,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderTop: "9px solid rgba(24,24,27,0.95)",
                margin: "0 auto",
            }}
            />
        )}
        </div>,
        document.body
    );
};

export default RegionPopup;
