/*! Open Historia — portions (defensive date rendering) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import {
    PMTILES_ARCHIVES,
    decodeVectorTile,
    getPmtilesArchive,
    loadCountryNames,
    loadRegionCatalog,
} from "../../runtime/assets.js";
import { loadRollbackSnapshots, rollBackToSnapshot, simulateAutoJump, simulateTimelineJump } from "../AI/gameplay.js";
import {
    applyEventImpactsToWorld,
    normalizeActions,
    readEventsState,
    readGameData,
    readWorldState,
} from "../../runtime/gameState.js";
import { setWorldStateOverride } from "../Map/useWorldState.js";
import { setUnitsOverride } from "../Map/unitsController.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

dayjs.extend(advancedFormat);

const TIMELINE_STYLE_ID = "timeline-ui-style";
// Clamped so the timeline panel and widget always fit phone screens.
const PANEL_WIDTH = "min(26.25rem, calc(100vw - 0.9rem))";

const ensureTimelineStyles = () => {
    if (typeof document === "undefined" || document.getElementById(TIMELINE_STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = TIMELINE_STYLE_ID;
    style.textContent = `
    @keyframes timeline-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .timeline-markdown p {
        margin: 0 0 0.45rem 0;
    }

    .timeline-markdown p:last-child {
        margin-bottom: 0;
    }

    .timeline-markdown strong {
        color: rgba(255,255,255,0.96);
    }

    .timeline-markdown em {
        color: rgba(216,227,255,0.78);
    }

    .timeline-markdown ul,
    .timeline-markdown ol {
        margin: 0.35rem 0 0.45rem 1.1rem;
        padding: 0;
    }

    .timeline-markdown li {
        margin-bottom: 0.18rem;
    }

    .timeline-markdown blockquote {
        border-left: 2px solid rgba(96,165,250,0.55);
        color: rgba(214,226,255,0.68);
        margin: 0.55rem 0;
        padding-left: 0.8rem;
    }

    .timeline-markdown code {
        background: rgba(15,23,42,0.55);
        border-radius: 4px;
        padding: 0.05rem 0.32rem;
    }
    `;
    document.head.appendChild(style);
};

const SpinnerRing = ({ size = 14, tone = "rgba(255,255,255,0.88)" }) => {
    useEffect(() => {
        ensureTimelineStyles();
    }, []);

    return (
        <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ animation: "timeline-spin 0.7s linear infinite" }}
        >
        <circle cx="12" cy="12" r="8" stroke="rgba(255,255,255,0.2)" strokeWidth="2.2" />
        <path d="M12 4a8 8 0 0 1 8 8" stroke={tone} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
};

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const CalendarIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M3 10h18" />
    </svg>
);

const MapIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
    <path d="M9 3v15" />
    <path d="M15 6v15" />
    </svg>
);

const ChevronDownIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
    </svg>
);

const panelSurface = {
    backgroundColor: "rgba(17, 24, 39, 0.95)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "16px",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
    color: "white",
    fontFamily: "sans-serif",
    overflow: "hidden",
    position: "fixed",
    width: PANEL_WIDTH,
    zIndex: 9998,
};

const widgetSurface = {
    alignItems: "center",
    backdropFilter: "blur(4px)",
    backgroundColor: "rgba(17, 24, 39, 0.95)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
    color: "white",
    display: "flex",
    fontFamily: "sans-serif",
    gap: "0.25rem",
    height: "3.5rem",
    justifyContent: "center",
    padding: "0 0.5rem",
    position: "fixed",
    transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
    width: "min(18rem, calc(100vw - 0.9rem))",
    zIndex: 9999,
};

const buttonStyle = {
    alignItems: "center",
    background: "none",
    border: "none",
    borderRadius: "6px",
    color: "rgba(255,255,255,0.7)",
    cursor: "pointer",
    display: "flex",
    flexShrink: 0,
    fontSize: "1.5rem",
    fontWeight: "900",
    height: "2rem",
    justifyContent: "center",
    lineHeight: 1,
    transition: "all 0.15s ease",
    width: "2rem",
};

const formatDate = (value, pattern = "MMM D, YYYY") => {
    if (!value) {
        return "Undated";
    }

    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format(pattern) : String(value);
};

const formatRange = (fromDate, toDate) => {
    if (!fromDate && !toDate) {
        return "No recorded range";
    }

    if (!fromDate) {
        return formatDate(toDate);
    }

    if (!toDate || fromDate === toDate) {
        return formatDate(fromDate);
    }

    return `${formatDate(fromDate)} -> ${formatDate(toDate)}`;
};

const resolvePolityName = (code, polityLookup) => {
    if (!code) {
        return "";
    }

    return polityLookup.get(code) || code;
};

const resolveRegionName = (transfer, regionLookup) => {
    if (!transfer) {
        return "";
    }

    return transfer.regionName || regionLookup.get(transfer.regionId)?.name || transfer.regionId || "";
};

const getEventMapChangeCount = (event) =>
(event?.impacts?.regionTransfers?.length || 0) + (event?.impacts?.polityChanges?.length || 0);

const collectEventTags = (event, { polityLookup, regionLookup }) => {
    const labels = new Set();

    for (const change of event?.impacts?.polityChanges ?? []) {
        const label = change.name || resolvePolityName(change.code, polityLookup);
        if (label) {
            labels.add(label);
        }
    }

    for (const transfer of event?.impacts?.regionTransfers ?? []) {
        const regionName = resolveRegionName(transfer, regionLookup);
        if (regionName) {
            labels.add(regionName);
        }

        const ownerName = resolvePolityName(transfer.toCode, polityLookup);
        if (ownerName) {
            labels.add(ownerName);
        }
    }

    for (const chat of event?.impacts?.createdChats ?? []) {
        for (const country of chat?.countries ?? []) {
            if (country?.name) {
                labels.add(country.name);
            }
        }
    }

    return Array.from(labels).slice(0, 8);
};

const buildEventLookup = (events) => new Map((events ?? []).map((event) => [event.id, event]));

let regionBoundsPromise = null;
let countryBoundsPromise = null;

const tilePointToLngLat = (px, py, extent = 4096) => {
    const lng = (px / extent) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / extent)));
    const lat = latRad * (180 / Math.PI);
    return [lng, lat];
};

const extendBounds = (currentBounds, nextBounds) => {
    if (!nextBounds) {
        return currentBounds;
    }

    if (!currentBounds) {
        return nextBounds;
    }

    return [
        [
            Math.min(currentBounds[0][0], nextBounds[0][0]),
            Math.min(currentBounds[0][1], nextBounds[0][1]),
        ],
        [
            Math.max(currentBounds[1][0], nextBounds[1][0]),
            Math.max(currentBounds[1][1], nextBounds[1][1]),
        ],
    ];
};

const geometryToBounds = (geometry, extent = 4096) => {
    let minLng = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    for (const ring of geometry ?? []) {
        for (const point of ring ?? []) {
            const [lng, lat] = tilePointToLngLat(point.x, point.y, extent);
            minLng = Math.min(minLng, lng);
            minLat = Math.min(minLat, lat);
            maxLng = Math.max(maxLng, lng);
            maxLat = Math.max(maxLat, lat);
        }
    }

    if (
        !Number.isFinite(minLng) ||
        !Number.isFinite(minLat) ||
        !Number.isFinite(maxLng) ||
        !Number.isFinite(maxLat)
    ) {
        return null;
    }

    return [
        [minLng, minLat],
        [maxLng, maxLat],
    ];
};

const loadFeatureBounds = async (archiveUrl, layerName, keyResolvers) => {
    const pmtiles = getPmtilesArchive(archiveUrl);
    const tileData = await pmtiles.getZxy(0, 0, 0);
    if (!tileData?.data) {
        return new Map();
    }

    const tile = await decodeVectorTile(tileData.data);
    const layer = tile.layers[layerName];
    if (!layer) {
        return new Map();
    }

    const extent = layer.extent || 4096;
    const boundsLookup = new Map();

    for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const props = feature.properties ?? {};
        const key = keyResolvers
        .map((resolver) => resolver(props))
        .find((candidate) => candidate != null && String(candidate).trim() !== "");

        if (!key) {
            continue;
        }

        const featureBounds = geometryToBounds(feature.loadGeometry(), extent);
        if (!featureBounds) {
            continue;
        }

        const normalizedKey = String(key);
        boundsLookup.set(
            normalizedKey,
            extendBounds(boundsLookup.get(normalizedKey) || null, featureBounds),
        );
    }

    return boundsLookup;
};

const loadRegionBounds = async () => {
    if (!regionBoundsPromise) {
        regionBoundsPromise = loadFeatureBounds(
            PMTILES_ARCHIVES.regions,
            "regions",
            [
                (props) => props?.GID_1,
                                                (props) => props?.gid_1,
                                                (props) => props?.HASC_1,
                                                (props) => props?.fid,
            ],
        );
    }

    return regionBoundsPromise;
};

const loadCountryBounds = async () => {
    if (!countryBoundsPromise) {
        countryBoundsPromise = loadFeatureBounds(
            PMTILES_ARCHIVES.countries,
            "countries",
            [
                (props) => props?.GID_0,
                                                 (props) => props?.gid_0,
                                                 (props) => props?.ISO_A3,
                                                 (props) => props?.iso_a3,
            ],
        );
    }

    return countryBoundsPromise;
};

const getEventFocusBounds = (event, { countryBounds, regionBounds }) => {
    let resolvedBounds = null;

    for (const transfer of event?.impacts?.regionTransfers ?? []) {
        const regionId = String(transfer?.regionId ?? "");
        if (!regionId) {
            continue;
        }

        resolvedBounds = extendBounds(resolvedBounds, regionBounds.get(regionId) || null);
    }

    for (const change of event?.impacts?.polityChanges ?? []) {
        const code = String(change?.code ?? "");
        if (!code) {
            continue;
        }

        resolvedBounds = extendBounds(resolvedBounds, countryBounds.get(code) || null);
    }

    return resolvedBounds;
};

// Every event moves the camera. When the impacts don't pin a location, fall
// back to the chat participants, then to the countries the event's text
// actually mentions.
const deriveEventFocusBounds = (event, { countryBounds, regionBounds, polityLookup }) => {
    const impactBounds = getEventFocusBounds(event, { countryBounds, regionBounds });
    if (impactBounds) {
        return impactBounds;
    }

    let bounds = null;
    for (const chat of event?.impacts?.createdChats ?? []) {
        for (const country of chat?.countries ?? []) {
            if (country?.code) {
                bounds = extendBounds(bounds, countryBounds.get(String(country.code)) || null);
            }
        }
    }
    if (bounds) {
        return bounds;
    }

    const haystack = `${event?.title ?? ""} ${event?.description ?? ""}`.toLowerCase();
    for (const [code, name] of polityLookup) {
        // Very short names ("Chad") false-match inside other words rarely
        // enough to accept; sub-4-character names don't.
        if (!name || String(name).length < 4) {
            continue;
        }

        if (haystack.includes(String(name).toLowerCase())) {
            bounds = extendBounds(bounds, countryBounds.get(code) || null);
        }
    }

    return bounds;
};

const getMapInstance = (mapRef) => mapRef?.current?.getMap?.() ?? mapRef?.current ?? null;

const focusMapOnBounds = (mapRef, bounds) => {
    const map = getMapInstance(mapRef);
    if (!map || !bounds) {
        return;
    }

    let [[west, south], [east, north]] = bounds;

    if (Math.abs(east - west) < 0.35) {
        west -= 0.6;
        east += 0.6;
    }

    if (Math.abs(north - south) < 0.35) {
        south -= 0.45;
        north += 0.45;
    }

    map.fitBounds(
        [
            [west, south],
            [east, north],
        ],
        {
            duration: 1800,
            essential: true,
            maxZoom: 6.8,
            padding: 80,
        },
    );
};

const filterPlannedActions = (actions) =>
normalizeActions(actions).filter((action) => action.status === "planned");

const buildTurnRecord = ({ entry, index, history, eventLookup, game, lookups }) => {
    if (!entry) {
        return null;
    }

    const fallbackStartDate =
    entry.fromDate ||
    history[index + 1]?.toDate ||
    history[index + 1]?.date ||
    game?.startDate ||
    entry.toDate ||
    entry.date;
    const toDate = entry.toDate || entry.date || game?.gameDate || "";
    const fromDate = fallbackStartDate || toDate;
    const events = (entry.eventIds ?? []).map((eventId) => eventLookup.get(eventId)).filter(Boolean);
    const plannedActions = filterPlannedActions(entry.plannedActions || entry.actions);
    const mapChangeCount = events.reduce((sum, event) => sum + getEventMapChangeCount(event), 0);
    const tags = new Set();

    for (const action of plannedActions) {
        for (const invitee of action?.invitees ?? []) {
            if (invitee) {
                tags.add(invitee);
            }
        }
    }

    for (const event of events) {
        for (const label of collectEventTags(event, lookups)) {
            tags.add(label);
        }
    }

    const primaryEvent = events.find((event) => String(event.importance).toLowerCase() === "major") || events[0];

    return {
        date: entry.date || toDate,
        eventCount: events.length,
        events,
        fromDate,
        id: `${entry.toDate || entry.date || index}-${index}`,
        mapChangeCount,
        mode: entry.mode || "jump",
        fallbackReason: entry.fallbackReason || "",
        plannedActions,
        rangeLabel: formatRange(fromDate, toDate),
        round: entry.round || 0,
        source: entry.source || "ai",
        summary: entry.summary || "",
        tags: Array.from(tags).slice(0, 10),
        title:
        primaryEvent?.title ||
        (plannedActions[0]?.title ? `Turn centered on ${plannedActions[0].title}` : `Round ${entry.round || Math.max(1, (game?.round || 1) - index)}`),
        toDate,
    };
};

const MetricPill = ({ children, icon = null, tone = "default" }) => {
    const toneMap = {
        default: {
            background: "rgba(148,163,184,0.12)",
            border: "1px solid rgba(148,163,184,0.18)",
            color: "rgba(226,232,240,0.84)",
        },
        accent: {
            background: "rgba(96,165,250,0.12)",
            border: "1px solid rgba(96,165,250,0.22)",
            color: "#bfdbfe",
        },
        violet: {
            background: "rgba(168,85,247,0.12)",
            border: "1px solid rgba(192,132,252,0.2)",
            color: "#e9d5ff",
        },
    };

    const resolved = toneMap[tone] || toneMap.default;

    return (
        <span
        style={{
            alignItems: "center",
            background: resolved.background,
            border: resolved.border,
            borderRadius: "999px",
            color: resolved.color,
            display: "inline-flex",
            fontSize: "0.69rem",
            fontWeight: 600,
            gap: "0.32rem",
            letterSpacing: "0.02em",
            padding: "0.28rem 0.6rem",
        }}
        >
        {icon}
        <span>{children}</span>
        </span>
    );
};

const TagPill = ({ children }) => (
    <span
    style={{
        background: "rgba(255,255,255,0.04)",
                                   border: "1px solid rgba(255,255,255,0.08)",
                                   borderRadius: "999px",
                                   color: "rgba(226,228,240,0.74)",
                                   display: "inline-flex",
                                   fontSize: "0.68rem",
                                   fontWeight: 600,
                                   padding: "0.24rem 0.55rem",
    }}
    >
    {children}
    </span>
);

const ghostButtonStyle = {
    alignItems: "center",
    background: "rgba(255,255,255,0.035)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "10px",
    color: "rgba(255,255,255,0.84)",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "0.74rem",
    fontWeight: 600,
    gap: "0.42rem",
    justifyContent: "center",
    padding: "0.5rem 0.78rem",
    transition: "all 0.15s ease",
};

const EventCard = ({ event, footer = null, lookups }) => {
    const tags = collectEventTags(event, lookups);
    const mapChangeCount = getEventMapChangeCount(event);

    return (
        <div
        style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.03))",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            overflow: "hidden",
        }}
        >
        <div
        style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.02)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            gap: "0.45rem",
            justifyContent: "space-between",
            padding: "0.85rem 1rem 0.7rem",
        }}
        >
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
        <MetricPill icon={<CalendarIcon />} tone="default">
        {formatDate(event.date)}
        </MetricPill>
        {mapChangeCount > 0 && (
            <MetricPill icon={<MapIcon />} tone="accent">
            {mapChangeCount} map change{mapChangeCount === 1 ? "" : "s"}
            </MetricPill>
        )}
        {event.source === "fallback" && (
            <MetricPill tone="accent">Fallback</MetricPill>
        )}
        </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", padding: "0.95rem 1rem 1rem" }}>
        {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {tags.map((tag) => (
                <TagPill key={`${event.id}-${tag}`}>{tag}</TagPill>
            ))}
            </div>
        )}

        <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {event.title}
        </div>

        {event.description && (
            <div className="timeline-markdown" style={{ color: "rgba(221,228,240,0.82)", fontSize: "0.77rem", lineHeight: "1.58" }}>
            <ReactMarkdown>{event.description}</ReactMarkdown>
            </div>
        )}

        {footer}
        </div>
        </div>
    );
};

const EmptyPanelState = ({ text }) => (
    <div
    style={{
        alignItems: "center",
        background: "rgba(255,255,255,0.03)",
                                       border: "1px dashed rgba(255,255,255,0.1)",
                                       borderRadius: "16px",
                                       color: "rgba(214,226,255,0.48)",
                                       display: "flex",
                                       fontSize: "0.78rem",
                                       fontStyle: "italic",
                                       justifyContent: "center",
                                       lineHeight: "1.55",
                                       minHeight: "9.5rem",
                                       padding: "1.1rem",
                                       textAlign: "center",
    }}
    >
    {text}
    </div>
);

const PanelChrome = ({
    children,
    eyebrow,
    isOpen,
    subtitle,
    title,
    topOffset,
    onClose,
}) => {
    const hasHeaderText = Boolean(eyebrow || title || subtitle);

    return (
        <div
        style={{
            ...panelSurface,
            bottom: isOpen ? "4.9rem" : "-34rem",
            display: "flex",
            flexDirection: "column",
            // Match the Actions/Chat panels: on short laptop screens the sliver
            // calc(100vh - 33rem) collapsed to the 10rem floor, so grow to at
            // least 30rem while still capping at calc(100vh - 9rem) to fit. (The
            // min() already caps height, so no separate maxHeight is needed.)
            height: "min(calc(100vh - 9rem), max(calc(100vh - 33rem), 30rem))",
            left: "0.5rem",
            maxWidth: "calc(100vw - 1rem)",
            minHeight: "10rem",
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? "auto" : "none",
            transition: "bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease",
        }}
        >
        <div
        style={{
            borderBottom: hasHeaderText ? "1px solid rgba(255,255,255,0.07)" : "none",
            flexShrink: 0,
            padding: hasHeaderText ? "1rem 1.25rem 0.75rem" : "0.7rem 0.75rem 0",
        }}
        >
        <div style={{ alignItems: "center", display: "flex", justifyContent: hasHeaderText ? "space-between" : "flex-end" }}>
        {hasHeaderText && (
            <div style={{ minWidth: 0 }}>
            {eyebrow && (
                <div style={{ color: "rgba(147,197,253,0.75)", fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.14em", marginBottom: "0.12rem", textTransform: "uppercase" }}>
                {eyebrow}
                </div>
            )}
            {title && (
                <div style={{ color: "rgba(255,255,255,0.96)", fontSize: "1rem", fontWeight: 700 }}>
                {title}
                </div>
            )}
            {subtitle && (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.75rem", lineHeight: "1.45", marginTop: "0.12rem" }}>
                {subtitle}
                </div>
            )}
            </div>
        )}
        <button
        type="button"
        onClick={onClose}
        style={{
            background: "none",
            border: "none",
            borderRadius: "6px",
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            display: "flex",
            fontSize: "1.1rem",
            lineHeight: 1,
            padding: "0.15rem 0.3rem",
            transition: "all 0.15s ease",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(255,255,255,0.08)";
            event.currentTarget.style.color = "white";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.background = "none";
            event.currentTarget.style.color = "rgba(255,255,255,0.5)";
        }}
        aria-label="Close panel"
        >
        <CloseIcon />
        </button>
        </div>
        </div>

        <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.85rem", minHeight: 0, overflowY: "auto", padding: "0.95rem 1.25rem 1.25rem", scrollbarWidth: "none" }}>
        {children}
        </div>
        </div>
    );
};

const JumpNode = ({ isLoading, opt, onJump }) => {
    const [hovered, setHovered] = useState(false);

    return (
        <button
        type="button"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
            if (isLoading) {
                return;
            }

            onJump(opt.days);
        }}
        style={{
            background: hovered ? "rgba(109,40,217,0.35)" : "rgba(109,40,217,0.15)",
            border: hovered ? "1px solid rgba(139,92,246,0.7)" : "1px solid rgba(139,92,246,0.35)",
            borderRadius: "10px",
            color: "white",
            cursor: "pointer",
            opacity: isLoading ? 0.7 : 1,
            outline: "none",
            padding: "0.38rem 0",
            textAlign: "center",
            transition: "all 0.12s ease",
            width: "12.5rem",
        }}
        >
        <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{opt.sublabel}</div>
        <div style={{ color: "rgba(196,165,255,0.7)", fontSize: "0.7rem" }}>
        {opt.label}
        </div>
        </button>
    );
};

const TimelineSkipPanel = ({
    canUndo,
    currentDate,
    error,
    isLoading,
    isOpen,
    onAutoJump,
    onCancel,
    onClose,
    onJump,
    onUndo,
    topOffset,
    undoCount,
}) => {
    const [customValue, setCustomValue] = useState("");
    const [customUnit, setCustomUnit] = useState("days");
    const unitToDays = { hours: 1 / 24, days: 1, weeks: 7, months: 30, years: 365 };
    const runCustomJump = () => {
        const amount = Number(customValue);
        if (!Number.isFinite(amount) || amount <= 0 || isLoading) return;
        onJump(amount * (unitToDays[customUnit] ?? 1));
    };
    const jumpOptions = [
        { label: "6 hours", sublabel: dayjs(currentDate).format("M/D/YYYY"), days: 0.25 },
        { label: "1 day", sublabel: dayjs(currentDate).add(1, "day").format("M/D/YYYY"), days: 1 },
        { label: "3 days", sublabel: dayjs(currentDate).add(3, "day").format("M/D/YYYY"), days: 3 },
        { label: "1 week", sublabel: dayjs(currentDate).add(7, "day").format("M/D/YYYY"), days: 7 },
        { label: "1 month", sublabel: dayjs(currentDate).add(1, "month").format("M/D/YYYY"), days: 30 },
        { label: "3 months", sublabel: dayjs(currentDate).add(3, "month").format("M/D/YYYY"), days: 90 },
        { label: "6 months", sublabel: dayjs(currentDate).add(6, "month").format("M/D/YYYY"), days: 180 },
        { label: "1 year", sublabel: dayjs(currentDate).add(1, "year").format("M/D/YYYY"), days: 365 },
    ];

    return (
        <PanelChrome
        eyebrow=""
        isOpen={isOpen}
        onClose={onClose}
        title="Timeline"
        topOffset={topOffset}
        >
        <div
        style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: 0,
        }}
        >
        {canUndo && (
            <>
            <button
            type="button"
            disabled={isLoading}
            onClick={() => { if (!isLoading) onUndo(); }}
            style={{
                background: "rgba(180,83,9,0.18)",
                border: "1px solid rgba(245,158,11,0.5)",
                borderRadius: "10px",
                color: "#fcd9a8",
                cursor: isLoading ? "default" : "pointer",
                opacity: isLoading ? 0.7 : 1,
                padding: "0.38rem 0",
                textAlign: "center",
                width: "12.5rem",
            }}
            >
            <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>↩ Undo last turn</div>
            <div style={{ color: "rgba(252,211,77,0.72)", fontSize: "0.7rem" }}>
            {undoCount} turn{undoCount === 1 ? "" : "s"} can be undone
            </div>
            </button>
            <div style={{ background: "rgba(139,92,246,0.4)", height: "1.25rem", width: "2px" }} />
            </>
        )}
        <div
        style={{
            background: "rgba(109,40,217,0.2)",
            border: "2px solid rgba(139,92,246,0.8)",
            borderRadius: "999px",
            color: "rgba(196,165,255,0.95)",
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "0.35rem 0",
            textAlign: "center",
            width: "5.5rem",
        }}
        >
        {dayjs(currentDate).format("M/D/YYYY")}
        </div>

        {jumpOptions.map((opt) => (
            <React.Fragment key={opt.label}>
            <div style={{ background: "rgba(139,92,246,0.4)", height: "1.25rem", width: "2px" }} />
            <JumpNode isLoading={isLoading} opt={opt} onJump={onJump} />
            </React.Fragment>
        ))}

        <div style={{ background: "rgba(139,92,246,0.4)", height: "1.25rem", width: "2px" }} />
        <button
        type="button"
        onClick={() => {
            if (isLoading) {
                return;
            }

            onAutoJump();
        }}
        style={{
            background: "rgba(37,99,235,0.2)",
            border: "1px solid rgba(96,165,250,0.45)",
            borderRadius: "12px",
            color: "white",
            cursor: "pointer",
            opacity: isLoading ? 0.72 : 1,
            padding: "0.55rem 0.7rem",
            textAlign: "center",
            width: "12.5rem",
        }}
        >
        <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>Auto-jump</div>
        </button>

        <div style={{ background: "rgba(139,92,246,0.4)", height: "1.25rem", width: "2px" }} />
        <div
        style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            display: "flex",
            gap: "0.35rem",
            padding: "0.45rem 0.5rem",
            width: "12.5rem",
        }}
        >
        <input
        type="number"
        min="1"
        step="any"
        value={customValue}
        onChange={(event) => setCustomValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") runCustomJump(); }}
        placeholder="Custom"
        disabled={isLoading}
        style={{
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "8px",
            color: "#fff",
            fontSize: "0.8rem",
            minWidth: 0,
            outline: "none",
            padding: "0.3rem 0.4rem",
            width: "3.4rem",
        }}
        />
        <select
        data-no-translate
        value={customUnit}
        onChange={(event) => setCustomUnit(event.target.value)}
        disabled={isLoading}
        style={{
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "8px",
            color: "#fff",
            cursor: "pointer",
            flex: 1,
            fontSize: "0.8rem",
            minWidth: 0,
            outline: "none",
            padding: "0.3rem 0.2rem",
        }}
        >
        <option value="hours" style={{ color: "black" }}>hours</option>
        <option value="days" style={{ color: "black" }}>days</option>
        <option value="weeks" style={{ color: "black" }}>weeks</option>
        <option value="months" style={{ color: "black" }}>months</option>
        <option value="years" style={{ color: "black" }}>years</option>
        </select>
        <button
        type="button"
        onClick={runCustomJump}
        disabled={isLoading || !customValue}
        style={{
            background: "rgba(109,40,217,0.4)",
            border: "1px solid rgba(139,92,246,0.6)",
            borderRadius: "8px",
            color: "#fff",
            cursor: isLoading || !customValue ? "default" : "pointer",
            fontSize: "0.8rem",
            fontWeight: 700,
            opacity: isLoading || !customValue ? 0.5 : 1,
            padding: "0.3rem 0.6rem",
        }}
        >
        Go
        </button>
        </div>
        </div>

        {isLoading && (
            <div
            style={{
                alignItems: "center",
                background: "rgba(255,255,255,0.04)",
                       border: "1px solid rgba(255,255,255,0.08)",
                       borderRadius: "12px",
                       color: "rgba(255,255,255,0.75)",
                       display: "flex",
                       fontSize: "0.76rem",
                       gap: "0.55rem",
                       justifyContent: "center",
                       padding: "0.68rem 0.8rem",
            }}
            >
            <SpinnerRing size={15} />
            <span>Simulating…</span>
            {onCancel && (
                <button
                type="button"
                onClick={onCancel}
                style={{
                    background: "rgba(220,38,38,0.18)",
                    border: "1px solid rgba(248,113,113,0.5)",
                    borderRadius: "8px",
                    color: "#fecaca",
                    cursor: "pointer",
                    fontSize: "0.74rem",
                    fontWeight: 600,
                    marginLeft: "0.2rem",
                    padding: "0.28rem 0.7rem",
                }}
                >
                Cancel
                </button>
            )}
            </div>
        )}

        {error && (
            <div
            style={{
                background: "rgba(127,29,29,0.24)",
                   border: "1px solid rgba(248,113,113,0.3)",
                   borderRadius: "16px",
                   color: "#fecaca",
                   fontSize: "0.76rem",
                   lineHeight: "1.5",
                   padding: "0.85rem 0.9rem",
            }}
            >
            {error}
            </div>
        )}
        </PanelChrome>
    );
};

const TimelineHistoryPanel = ({
    isOpen,
    onRevealNextEvent,
    onRevealAll,
    lookups,
    onClose,
    record,
    topOffset,
    visibleEventCount,
    warning,
}) => {
    const totalEvents = record?.events?.length || 0;
    const visibleEvents =
    totalEvents > 0
    ? record.events.slice(0, Math.min(visibleEventCount, totalEvents))
    : [];
    const hasMoreEvents = visibleEvents.length < totalEvents;
    const lastVisibleEventRef = React.useRef(null);

    useEffect(() => {
        if (!isOpen || !lastVisibleEventRef.current) {
            return;
        }

        lastVisibleEventRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    }, [isOpen, record?.id, visibleEvents.length]);

    return (
        <PanelChrome
        eyebrow=""
        isOpen={isOpen}
        onClose={onClose}
        subtitle={record?.rangeLabel || ""}
        title="Events"
        topOffset={topOffset}
        >
        {warning && (
            <div
            style={{
                background: "rgba(120,53,15,0.24)",
                border: "1px solid rgba(251,191,36,0.35)",
                borderRadius: "12px",
                color: "#fde68a",
                fontSize: "0.76rem",
                lineHeight: "1.5",
                marginBottom: "0.75rem",
                padding: "0.75rem 0.85rem",
            }}
            >
            {warning}
            </div>
        )}
        {!record ? (
            <EmptyPanelState text="No event chain is available yet." />
        ) : totalEvents === 0 ? (
            <EmptyPanelState text="No world events were recorded for this time skip." />
        ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {visibleEvents.map((event, index) => {
                const isLastVisible = index === visibleEvents.length - 1;

                return (
                    <div key={event.id} ref={isLastVisible ? lastVisibleEventRef : null}>
                    {/* No "Show on map" footer: the camera already flies to
                        every event as it is revealed. */}
                    <EventCard event={event} lookups={lookups} />
                    </div>
                );
            })}
            {hasMoreEvents && (
                <>
                <button
                type="button"
                onClick={() => onRevealNextEvent()}
                style={{
                    ...ghostButtonStyle,
                    minHeight: "2.5rem",
                    width: "100%",
                }}
                >
                <ChevronDownIcon />
                <span>Next event</span>
                </button>
                {/* The interrupt: fast-forwards the reveal (and the staged map)
                    to the final state. Nothing is truncated — every event stays. */}
                <button
                type="button"
                onClick={() => onRevealAll?.()}
                style={{
                    ...ghostButtonStyle,
                    minHeight: "1.9rem",
                    opacity: 0.75,
                    width: "100%",
                }}
                >
                <span>Skip to end ({totalEvents - visibleEvents.length} more)</span>
                </button>
                </>
            )}
            </div>
        )}
        </PanelChrome>
    );
};

const DateWidget = ({
    activePanel = null,
    mapRef,
    onSetPanel = null,
    onTogglePanel = null,
    rightShift,
    topOffset = "0.5rem",
}) => {
    const [gameData, setGameData] = useState(null);
    const [events, setEvents] = useState([]);
    const [worldState, setWorldState] = useState(null);
    const [countryBounds, setCountryBounds] = useState(new Map());
    const [polityLookup, setPolityLookup] = useState(new Map());
    const [regionBounds, setRegionBounds] = useState(new Map());
    const [regionLookup, setRegionLookup] = useState(new Map());
    const [localOpenPanel, setLocalOpenPanel] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [fallbackWarning, setFallbackWarning] = useState("");
    // Holds the in-flight jump's AbortController so the Cancel button can stop it.
    const jumpAbortRef = React.useRef(null);
    // Mirrors the latest applied turn (round + date) so the 5s refresh poll can tell a
    // stale read from a genuinely newer one — and never revert a just-completed jump.
    const gameStampRef = React.useRef({ round: 0, date: "" });
    React.useEffect(() => {
        gameStampRef.current = { round: Number(gameData?.round) || 0, date: gameData?.gameDate || "" };
    }, [gameData]);
    const [visibleEventCount, setVisibleEventCount] = useState(1);
    const [undoCount, setUndoCount] = useState(0);
    const openPanel = typeof onSetPanel === "function" ? activePanel : localOpenPanel;
    const isMobile = useIsMobile();
    const disableEventCamera = useMapSetting(MAP_SETTING_KEYS.disableEventCamera);

    useEffect(() => {
        ensureTimelineStyles();
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadLookups = async () => {
            try {
                const [countries, regions, nextCountryBounds, nextRegionBounds] = await Promise.all([
                    loadCountryNames(),
                                                                                                    loadRegionCatalog(),
                                                                                                    loadCountryBounds(),
                                                                                                    loadRegionBounds(),
                ]);

                if (cancelled) {
                    return;
                }

                setCountryBounds(nextCountryBounds);
                setPolityLookup(new Map((countries ?? []).map((entry) => [entry.code, entry.name])));
                setRegionBounds(nextRegionBounds);
                setRegionLookup(new Map((regions ?? []).map((entry) => [entry.id, entry])));
            } catch (lookupError) {
                if (!cancelled) {
                    console.error("Failed to load timeline lookups:", lookupError);
                }
            }
        };

        loadLookups();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadState = async () => {
            try {
                const [game, nextEvents, world] = await Promise.all([
                    readGameData({ force: true }),
                                                                    readEventsState({ force: true }),
                                                                    readWorldState({ force: true }),
                ]);

                if (cancelled) {
                    return;
                }

                // Never let this background poll overwrite a fresher turn with an older
                // read. A jump advances the round (and date); if the store read comes
                // back behind what's already on screen — a write still settling, an
                // eventually-consistent read, a poll that fired mid-jump — applying it
                // would revert the date and wipe the just-generated events. Skip it.
                const local = gameStampRef.current;
                const polledRound = Number(game?.round) || 0;
                const polledDate = game?.gameDate || "";
                if (polledRound < local.round || (polledRound === local.round && polledDate < local.date)) {
                    return;
                }

                setGameData(game);
                setEvents(nextEvents);
                setWorldState(world);
            } catch (loadError) {
                if (!cancelled) {
                    console.error("Failed to load timeline state:", loadError);
                }
            }
        };

        loadState();
        const interval = setInterval(loadState, 5000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    function setPanel(panelName) {
        if (typeof onSetPanel === "function") {
            onSetPanel(panelName);
            return;
        }

        setLocalOpenPanel(panelName);
    }

    function togglePanel(panelName) {
        if (isLoading && panelName !== "skip") {
            return;
        }

        if (typeof onTogglePanel === "function") {
            onTogglePanel(panelName);
            return;
        }

        setLocalOpenPanel((current) => (current === panelName ? null : panelName));
    }

    const runJump = async (days, mode = "jump") => {
        if (!gameData || days == null || isLoading) {
            return;
        }

        setPanel("skip");
        setIsLoading(true);
        setError("");
        setFallbackWarning("");

        const controller = new AbortController();
        jumpAbortRef.current = controller;
        try {
            const result = mode === "auto"
            ? await simulateAutoJump({ days, signal: controller.signal })
            : await simulateTimelineJump({ days, signal: controller.signal });
            setGameData(result.game);
            setEvents(result.events);
            setWorldState(result.world);
            setVisibleEventCount(1);
            if (result.generation?.source === "fallback") {
                setFallbackWarning(`Turn generated by fallback: ${result.generation.fallbackReason || "structured AI output was unavailable"}`);
            }
            setPanel("history");
        } catch (jumpError) {
            if (controller.signal.aborted || jumpError?.name === "AbortError") {
                // Player cancelled — nothing was written, so just close out quietly.
                setError("");
            } else {
                console.error("Failed to simulate jump:", jumpError);
                setError(jumpError.message || "Failed to simulate timeline jump.");
            }
        } finally {
            jumpAbortRef.current = null;
            setIsLoading(false);
        }
    };

    const cancelJump = () => {
        jumpAbortRef.current?.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
    };

    // How many turns can be undone (a restore point is captured at the start of
    // each turn). Re-checked whenever the round changes — after a jump or undo.
    useEffect(() => {
        let active = true;
        loadRollbackSnapshots().then((list) => {
            if (active) setUndoCount(list.length);
        });
        return () => { active = false; };
    }, [gameData?.round]);

    const runUndo = async () => {
        if (isLoading || undoCount <= 0) {
            return;
        }

        setPanel("skip");
        setIsLoading(true);
        setError("");
        setFallbackWarning("");

        try {
            const result = await rollBackToSnapshot(0);
            if (result) {
                setGameData(result.bundle.game);
                setEvents(result.bundle.events);
                setWorldState(result.bundle.world);
                setVisibleEventCount(1);
                setUndoCount(result.remaining);
                setPanel("history");
            }
        } catch (undoError) {
            console.error("Failed to undo turn:", undoError);
            setError(undoError.message || "Failed to undo the last turn.");
        } finally {
            setIsLoading(false);
        }
    };

    const eventLookup = useMemo(() => buildEventLookup(events), [events]);
    const lookups = useMemo(() => ({ polityLookup, regionLookup }), [polityLookup, regionLookup]);

    const historyRecords = useMemo(() => {
        const rawHistory = worldState?.simulationHistory ?? [];
        return rawHistory
        .map((entry, index) => buildTurnRecord({
            entry,
            index,
            history: rawHistory,
            eventLookup,
            game: gameData,
            lookups,
        }))
        .filter(Boolean);
    }, [eventLookup, gameData, lookups, worldState]);

    const latestTurnRecord = historyRecords[0] || null;
    const persistedFallbackWarning = latestTurnRecord?.source === "fallback"
    ? `Turn generated by fallback: ${latestTurnRecord.fallbackReason || "structured AI output was unavailable"}`
    : "";
    const totalVisibleEvents = latestTurnRecord?.events?.length || 0;
    const activeVisibleEvent =
    openPanel === "history" && totalVisibleEvents > 0
    ? latestTurnRecord.events[Math.min(Math.max(visibleEventCount, 1), totalVisibleEvents) - 1]
    : null;

    // Resolve a valid date defensively: gameDate, else startDate, else nothing.
    // dayjs("") / dayjs(null) is an Invalid Date, so guard before formatting.
    // Dates dayjs can't parse but that ARE text ("1200 BCE", ancient-era
    // scenarios) display verbatim instead of "Undated".
    // Full display name, never the code: era polity name first, then the
    // base country name, then the raw value as a last resort.
    const playerCountryCode = gameData?.country || "";
    const playerCountry = playerCountryCode
    ? (worldState?.polityOverrides?.[playerCountryCode]?.name
        || polityLookup.get(playerCountryCode)
        || playerCountryCode)
    : "";
    const rawGameDate = gameData?.gameDate || gameData?.startDate || "";
    const parsedGameDate = rawGameDate ? dayjs(rawGameDate) : null;
    const hasValidGameDate = Boolean(parsedGameDate && parsedGameDate.isValid());
    // Mobile shares the row with the country name, so abbreviate the month.
    const displayDate = !gameData
    ? "Loading..."
    : hasValidGameDate
    ? parsedGameDate.format(isMobile && playerCountry ? "MMM Do, YYYY" : "MMMM Do, YYYY")
    : String(rawGameDate).trim() || "Undated";
    const currentDate = hasValidGameDate
    ? parsedGameDate.format("YYYY-MM-DD")
    : dayjs().format("YYYY-MM-DD");

    useEffect(() => {
        setVisibleEventCount(1);
    }, [latestTurnRecord?.id]);

    // The camera follows EVERY revealed event — impacts pin the exact spot,
    // otherwise the countries the event involves do. Opt out via the
    // "Disable camera movement during events" map setting.
    useEffect(() => {
        if (!activeVisibleEvent || disableEventCamera) {
            return;
        }

        const bounds = deriveEventFocusBounds(activeVisibleEvent, { countryBounds, regionBounds, polityLookup });
        focusMapOnBounds(mapRef, bounds);
    }, [activeVisibleEvent, countryBounds, disableEventCamera, mapRef, polityLookup, regionBounds]);

    const revealNextEvent = () => {
        setVisibleEventCount((current) => {
            if (!totalVisibleEvents) {
                return 1;
            }

            return Math.min(totalVisibleEvents, current + 1);
        });
    };

    // Skip the remaining reveals: the map snaps to the final post-jump state.
    // This is also the interrupt — non-destructive, every event stays in
    // history; it only fast-forwards the presentation.
    const revealAllEvents = () => {
        if (totalVisibleEvents) {
            setVisibleEventCount(totalVisibleEvents);
        }
    };

    // ---- Staged event reveal (#368) -----------------------------------------
    // world.json already holds the FINAL post-jump state when the panel opens
    // (authoritative and crash-safe). The reveal replays the pre-jump world
    // from the turn's rollback snapshot, applying only the revealed events'
    // impacts, through a purely VISUAL override the map layers read (ownership
    // recolors, units, markers). Finishing or skipping the reveal, closing the
    // panel, a new record, or a missing snapshot all clear the override — the
    // worst case is the old behavior: the final state all at once.
    const [stagedBase, setStagedBase] = useState({ recordId: null, world: null });

    // A new turn invalidates any staged base from the previous one.
    useEffect(() => {
        setStagedBase({ recordId: null, world: null });
    }, [latestTurnRecord?.id]);

    // Load the pre-jump world lazily, whenever the history panel is actually
    // open and the base is missing — a one-shot load at record time raced the
    // session boot (snapshots briefly read empty) and staging silently never
    // engaged for that turn.
    useEffect(() => {
        const record = latestTurnRecord;
        if (openPanel !== "history" || !record || !(record.events?.length > 0)) {
            return undefined;
        }
        if (stagedBase.recordId === record.id && stagedBase.world) {
            return undefined;
        }
        let cancelled = false;
        loadRollbackSnapshots()
            .then((snapshots) => {
                if (cancelled) return;
                const match = (snapshots || []).find(
                    (snap) => snap?.fromDate === record.fromDate && snap?.toDate === record.toDate && snap?.state?.world,
                );
                if (match) setStagedBase({ recordId: record.id, world: match.state.world });
            })
            .catch(() => {
                /* no snapshot — reveal without staging */
            });
        return () => {
            cancelled = true;
        };
    }, [latestTurnRecord?.id, openPanel, stagedBase.recordId]);

    useEffect(() => {
        const record = latestTurnRecord;
        const stagingActive =
            openPanel === "history" &&
            record &&
            stagedBase.recordId === record.id &&
            stagedBase.world &&
            totalVisibleEvents > 0 &&
            visibleEventCount < totalVisibleEvents;
        if (!stagingActive) {
            setWorldStateOverride(null);
            setUnitsOverride(null);
            return;
        }
        const revealed = record.events.slice(0, Math.max(1, visibleEventCount));
        const { world: stagedWorld } = applyEventImpactsToWorld({
            colors: {},
            events: revealed,
            world: stagedBase.world,
        });
        setWorldStateOverride(stagedWorld);
        setUnitsOverride(stagedWorld.units ?? []);
    }, [latestTurnRecord, openPanel, stagedBase, totalVisibleEvents, visibleEventCount]);

    // Never leave a stale override behind when this widget unmounts.
    useEffect(
        () => () => {
            setWorldStateOverride(null);
            setUnitsOverride(null);
        },
        [],
    );

    return (
        <>
        <TimelineSkipPanel
        canUndo={undoCount > 0}
        currentDate={currentDate}
        error={error}
        isLoading={isLoading}
        isOpen={openPanel === "skip"}
        onAutoJump={() => runJump(365, "auto")}
        onCancel={cancelJump}
        onClose={() => setPanel(null)}
        onJump={(days) => runJump(days, "jump")}
        onUndo={runUndo}
        topOffset={topOffset}
        undoCount={undoCount}
        />
        <TimelineHistoryPanel
        isOpen={openPanel === "history"}
        onRevealNextEvent={revealNextEvent}
        onRevealAll={revealAllEvents}
        lookups={lookups}
        onClose={() => setPanel(null)}
        record={latestTurnRecord}
        topOffset={topOffset}
        visibleEventCount={visibleEventCount}
        warning={fallbackWarning || persistedFallbackWarning}
        />

        <div
        style={{
            ...widgetSurface,
            right: rightShift,
            top: topOffset,
            // The player's country sits beside the date. On phones the standalone
            // pill would cover the date, so stretch the widget; on desktop cap the
            // width so a long fantasy country name ellipsizes instead of sprawling.
            ...(isMobile
                ? { width: "min(24rem, calc(100vw - 5.75rem))" }
                : playerCountry
                ? { maxWidth: "min(28rem, calc(100vw - 8rem))" }
                : null),
        }}
        >
        <button
        type="button"
        style={{
            ...buttonStyle,
            color: openPanel === "history" ? "#bfdbfe" : buttonStyle.color,
        }}
        onClick={() => togglePanel("history")}
        onMouseEnter={(event) => {
            if (openPanel !== "history") {
                event.currentTarget.style.color = "white";
            }
        }}
        onMouseLeave={(event) => {
            if (openPanel !== "history") {
                event.currentTarget.style.color = buttonStyle.color;
            }
        }}
        >
        {"\u00AB"}
        </button>

        <div style={{ alignItems: "center", display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
        {playerCountry ? (
            <div style={{ alignItems: "baseline", display: "flex", gap: "0.5rem", justifyContent: "center", maxWidth: "100%", minWidth: 0 }}>
            <span
            style={{
                color: "rgba(147,197,253,0.88)",
                fontSize: isMobile ? "0.68rem" : "0.8rem",
                fontWeight: 700,
                letterSpacing: "0.05em",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
            }}
            >
            {playerCountry}
            </span>
            <span style={{ color: "rgba(255,255,255,0.94)", flexShrink: 0, fontSize: isMobile ? "0.82rem" : "0.95rem", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
            {displayDate}
            </span>
            </div>
        ) : (
            <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", letterSpacing: "0.02em" }}>
            {displayDate}
            </div>
        )}
        </div>

        <button
        type="button"
        style={{
            ...buttonStyle,
            color: openPanel === "skip" ? "rgba(196,165,255,0.9)" : buttonStyle.color,
        }}
        onClick={() => {
            if (isLoading) {
                setPanel("skip");
                return;
            }

            togglePanel("skip");
        }}
        onMouseEnter={(event) => {
            if (openPanel !== "skip") {
                event.currentTarget.style.color = "white";
            }
        }}
        onMouseLeave={(event) => {
            if (openPanel !== "skip") {
                event.currentTarget.style.color = buttonStyle.color;
            }
        }}
        >
        {isLoading ? <SpinnerRing size={15} tone="rgba(196,165,255,0.95)" /> : "\u00BB"}
        </button>
        </div>
        </>
    );
};

export { DateWidget };
