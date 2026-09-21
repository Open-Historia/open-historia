/*! Open Historia — portions (defensive date rendering) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import {
    PMTILES_ARCHIVES,
    decodeVectorTile,
    getPmtilesArchive,
    getPrimedScenarioRegionCatalog,
    loadCountryNames,
    loadRegionCatalog,
    loadRollbackSnapshotCount,
} from "../../runtime/assets.js";
import { canInterveneInLastTurn, declineInteractiveOffer, interveneAfterEvent, loadRollbackSnapshots, maybeGeneratePregameHistory, retryPendingJumpSegment, retryPendingProjectsJump, rollBackToSnapshot, simulateAutoJump, simulateTimelineJump } from "../AI/gameplayLazy.js";
import { NO_RESPONSE_BODY_NOTE, discardPendingJumpSegment, discardPendingProjectsJump } from "../AI/simulationStatus.js";
import { acceptStructuredModeSuggestion, declineStructuredModeSuggestion, getStructuredModeSuggestion } from "../AI/main.jsx";
import { fallbackStateStore, getResolvedFallbackList } from "../AI/providerConfig.js";
import { describeUnavailable, fallbackAvailability } from "../AI/fallbackRunner.js";
import { describeJumpCost, requestDay, savingRequests } from "../AI/requestBudget.js";
import { getActivePlayerFocus, useActiveFeatures } from "../../runtime/gameFeatures.js";
import { logDebugEvent, setDebugLogContext } from "../../runtime/debugLog.js";
import { useFailureReportButton } from "../../runtime/saveDebugLog.js";
import { EVENT_TAG_ENUM } from "../../runtime/eventTags.js";
import { documentsForEvent } from "../../runtime/reportDelivery.js";
import { unseenEvents } from "../../runtime/unseenEvents.js";
import { isSceneInProgress } from "../AI/interactiveRewind.js";
import { offeredEvent } from "../../runtime/interactiveOffer.js";
import { normalizeMarkdown } from "./markdownText.js";
import { useUnseenEventIds } from "./useUnseenEvents.js";
import { isMainMenuOpen, useMainMenuOpen } from "./libraryBar";
import {
    applyEventImpactsToWorld,
    normalizeActions,
} from "../../runtime/gameState.js";
import {
    buildFocusContext,
    buildPlaceCatalog,
    deriveEventFocusBounds,
    deriveEventLinks,
    mergeFeatureParts,
    tileGeometryParts,
} from "./eventFocus.js";
import { setWorldStateOverride } from "../Map/useWorldState.js";
import { getUnitById, setUnitsOverride } from "../Map/unitsController.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { primeRuntimeValue } from "../../runtime/runtimeStore.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { MAP_SETTING_KEYS, getMapSettingDefaultOn, useMapSetting } from "../../runtime/mapSettings.js";
import { formatGameDateReadable, isGameDate, normalizeGameDate } from "../../runtime/gameDates.js";
import { jumpDayStep, jumpTargetDate } from "../../runtime/jumpDates.js";

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
        color: rgba(230,230,233,0.78);
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
        color: rgba(229,229,232,0.68);
        margin: 0.55rem 0;
        padding-left: 0.8rem;
    }

    .timeline-markdown code {
        background: rgba(20,20,23,0.55);
        border-radius: 4px;
        padding: 0.05rem 0.32rem;
    }
    `;
    document.head.appendChild(style);
};

// An event description is written in paragraphs now, and a model that separates
// them with a single newline used to have them glued back into one block:
// CommonMark treats a lone newline as a space. remark-breaks makes it a real
// break, remark-gfm gets the rest of the vocabulary a model reaches for, and
// normalizeMarkdown repairs the <br>/<b> tags it writes instead of markdown -
// the same three the advisor and the chat have always had (markdown.jsx). The
// card keeps its own stylesheet rather than borrowing .oh-md, which is sized for
// a side panel.
const EVENT_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

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
    backgroundColor: "var(--oh-hud-bg-strong)",
    backdropFilter: "var(--oh-hud-blur)",
    border: "1px solid var(--oh-hud-border)",
    borderRadius: "18px",
    boxShadow: "var(--oh-hud-shadow)",
    color: "white",
    fontFamily: "sans-serif",
    overflow: "hidden",
    position: "fixed",
    width: PANEL_WIDTH,
    zIndex: 9998,
};

const widgetSurface = {
    alignItems: "center",
    backdropFilter: "var(--oh-hud-blur)",
    backgroundColor: "var(--oh-hud-bg-strong)",
    border: "1px solid var(--oh-hud-border)",
    borderRadius: "14px",
    boxShadow: "var(--oh-hud-shadow-soft)",
    color: "white",
    display: "flex",
    fontFamily: "sans-serif",
    gap: "0.25rem",
    height: "3.5rem",
    justifyContent: "center",
    padding: "0 0.5rem",
    position: "fixed",
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

    // A game date in any year, BC spelled out ("1 March 218 BC"); dayjs only
    // for values that are not game dates (timestamps).
    const readable = formatGameDateReadable(value, pattern);
    if (readable) return readable;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format(pattern) : String(value);
};

// Where a jump of `days` from `from` lands, as the widget shows it — through
// jumpTargetDate, the rule the jump itself uses, so a part-day skip rounds the
// same way here as there (12 hours is tomorrow). addGameDays alone truncates:
// the custom row read today for a 12-hour skip that landed on tomorrow.
const jumpLandingLabel = (from, days) =>
    formatGameDateReadable(jumpTargetDate(from, days), "M/D/YYYY")
    || dayjs(from).add(jumpDayStep(days), "day").format("M/D/YYYY");

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

// Every change an event made to the map, in words — what the "N map changes"
// pill opens into. Transfers and control moves name the region and both sides,
// polity changes say what happened to the country, unit and structure ops say
// what was raised, moved or built: the impacts' own vocabulary, read out.
const describeEventMapChanges = (event, { polityLookup = new Map(), regionLookup = new Map() } = {}) => {
    const impacts = event?.impacts ?? {};
    const polity = (code) => resolvePolityName(code, polityLookup) || "";
    const region = (entry) => resolveRegionName(entry, regionLookup) || "a region";
    const unitName = (id) => getUnitById(id)?.name || `unit ${id}`;
    const note = (text) => (text ? ` — ${text}` : "");
    const lines = [];
    for (const transfer of impacts.regionTransfers ?? []) {
        lines.push({ kind: "territory", text: `${region(transfer)}: ${polity(transfer.fromCode) || "unowned"} → ${polity(transfer.toCode) || "unowned"}${transfer.wholeCountry ? " (whole country)" : ""}${note(transfer.note)}` });
    }
    for (const op of impacts.regionControlOps ?? []) {
        if (op?.op === "contest") lines.push({ kind: "control", text: `${region(op)}: contested by ${polity(op.actorCode)}, held by ${polity(op.fromCode) || "no one"}${note(op.note)}` });
        else if (op?.op === "control") lines.push({ kind: "control", text: `${region(op)}: control passes from ${polity(op.fromCode) || "no one"} to ${polity(op.toCode)}${note(op.note)}` });
        else if (op?.op === "clear_contest") lines.push({ kind: "control", text: `${region(op)}: ${op.clearAll ? "every contest settled" : `${polity(op.claimantCode)} no longer contests it`}${note(op.note)}` });
    }
    for (const claim of impacts.regionClaims ?? []) {
        lines.push({ kind: "claim", text: `${region(claim)}: ${claim.drop ? `${polity(claim.claimantCode)} drops its claim` : `claimed by ${polity(claim.claimantCode)}`}${note(claim.note)}` });
    }
    for (const change of impacts.polityChanges ?? []) {
        const verb = { create: "created", rename: "renamed", dissolve: "dissolved", restore: "restored", update: "updated" }[change.operation] || "updated";
        const name = change.name || polity(change.code) || "a polity";
        const details = [];
        if (change.operation === "rename" && change.code && change.name && change.code !== change.name) details.push(`was ${polity(change.code)}`);
        if (change.color) details.push(`colour ${change.color}`);
        if (change.reputation != null && change.reputation !== "") details.push(`reputation ${change.reputation}`);
        if (change.intelligence != null && change.intelligence !== "") details.push(`intelligence ${change.intelligence}`);
        if (Array.isArray(change.tags) && change.tags.length) details.push(`tags ${change.tags.join(", ")}`);
        lines.push({ kind: "polity", text: `${name}: ${verb}${details.length ? ` (${details.join("; ")})` : ""}${note(change.note)}` });
    }
    for (const op of impacts.unitOps ?? []) {
        if (op?.op === "spawn") lines.push({ kind: "unit", text: `${op.unit?.name || "A formation"} raised — ${op.unit?.type || "unit"} of ${polity(op.unit?.ownerCode) || "an unknown owner"}${note(op.unit?.note)}` });
        else if (op?.op === "move") lines.push({ kind: "unit", text: `${unitName(op.unitId)} moves${op.regionId ? ` to ${op.regionId}` : ""}${op.posture ? ` (${op.posture})` : ""}${note(op.note)}` });
        else if (op?.op === "strength") lines.push({ kind: "unit", text: `${unitName(op.unitId)}: strength ${op.strength}%${note(op.note)}` });
        else if (op?.op === "remove") lines.push({ kind: "unit", text: `${unitName(op.unitId)} removed${note(op.note)}` });
    }
    for (const op of impacts.markerOps ?? []) {
        if (op?.op === "build") lines.push({ kind: "structure", text: `${op.marker?.name || "A structure"} built${op.marker?.kind ? ` (${op.marker.kind})` : ""}${op.marker?.ownerCode ? ` by ${polity(op.marker.ownerCode)}` : ""}${note(op.marker?.note)}` });
        else if (op?.op === "remove") lines.push({ kind: "structure", text: `${op.name || op.markerId || "A structure"} removed${note(op.note)}` });
        else if (op?.op === "rename") lines.push({ kind: "structure", text: `${op.name || op.markerId} renamed ${op.newName}${note(op.note)}` });
        else if (op?.op === "update") lines.push({ kind: "structure", text: `${op.name || op.markerId} updated` });
        else if (op?.op === "population") lines.push({ kind: "structure", text: `${op.name || op.markerId}: population changed` });
    }
    return lines;
};

const getEventMapChangeCount = (event) => describeEventMapChanges(event).length;

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
            // A participant is {code, name} once resolved, a bare name before.
            const label = typeof country === "string" ? country : country?.name;
            if (label) {
                labels.add(label);
            }
        }
    }

    return Array.from(labels).slice(0, 8);
};

const buildEventLookup = (events) => new Map((events ?? []).map((event) => [event.id, event]));

let regionBoundsPromise = null;
let countryBoundsPromise = null;

// Bounds for every feature in an archive's overview tile (0/0/0 — the tile the
// game already treats as the complete country/region catalog), keyed by the id
// the events refer to. Rings are kept apart until the merge so an outlying
// island can be told from the mainland and dropped (see mergeFeatureParts).
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
    const partsByKey = new Map();

    for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const props = feature.properties ?? {};
        const key = keyResolvers
        .map((resolver) => resolver(props))
        .find((candidate) => candidate != null && String(candidate).trim() !== "");

        if (!key) {
            continue;
        }

        const parts = tileGeometryParts(feature.loadGeometry(), extent);
        if (parts.length === 0) {
            continue;
        }

        const normalizedKey = String(key);
        const bucket = partsByKey.get(normalizedKey);
        if (bucket) {
            bucket.push(...parts);
        } else {
            partsByKey.set(normalizedKey, parts);
        }
    }

    const boundsLookup = new Map();
    for (const [key, parts] of partsByKey) {
        const bounds = mergeFeatureParts(parts);
        if (bounds) {
            boundsLookup.set(key, bounds);
        }
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

    // Padding bigger than the viewport makes fitBounds throw, and 80px is a
    // quarter of a phone screen — scale it down on small canvases.
    const canvas = map.getCanvas?.();
    const shortSide = Math.min(canvas?.clientWidth || 0, canvas?.clientHeight || 0);
    const padding = shortSide > 0 ? Math.max(16, Math.min(80, Math.round(shortSide * 0.12))) : 40;

    map.fitBounds(
        [
            [west, south],
            [east, north],
        ],
        {
            duration: 1800,
            essential: true,
            maxZoom: 6.8,
            padding,
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
        // Only ever non-empty on a fallback turn (see gameplay.js) — the main
        // thing the fallback warning's "Save logging file" button attaches.
        rawResponse: entry.rawResponse || "",
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

// The turn as it is being written, in the shape buildTurnRecord makes, so the
// Events panel gives a skip in progress the same cards, chips and reveal it
// gives a finished one (AI/streamedEvents.js). The id is fixed for the length of
// the skip: the panel keys its filter and its scroll on it.
const LIVE_TURN_RECORD_ID = "live-turn";

// A copy, because this is the running game's own world and
// applyEventImpactsToWorld is handed a snapshot everywhere else.
const cloneWorldForStaging = (world) => {
    if (!world || typeof world !== "object") return null;
    try {
        return typeof structuredClone === "function" ? structuredClone(world) : JSON.parse(JSON.stringify(world));
    } catch {
        return null;
    }
};

// A field on the shape that is rarely read, computed the first time it is.
const onFirstRead = (target, key, compute) => {
    let value;
    let read = false;
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get() {
            if (!read) {
                value = compute();
                read = true;
            }
            return value;
        },
    });
};

// The card for one streamed event, made once and kept. Cached against the event
// it came from: the list is rebuilt on every arrival but its entries are the
// same objects, and a fresh copy each time threw away the memo in every visible
// EventCard, sending deriveEventLinks back through the place catalog for the
// whole skip.
//
// The id is always the counter's, never the model's. A model may write its own
// id and may repeat it, and two cards keyed alike is exactly the reconciliation
// bug this panel must not have. The real ids arrive with the written turn.
const liveEventCards = new WeakMap();
let liveEventSeq = 0;

// The lists the cards, the camera and the map staging walk. A streamed event's
// are whatever the model typed, and `?? []` does not save an iteration from a
// non-array: that throws in a render and blanks the panel. Dropped here once.
const LIVE_EVENT_LISTS = [
    "regionTransfers", "regionControlOps", "regionClaims", "polityChanges",
    "unitOps", "markerOps", "createdChats", "projectOps",
];

const liveEventCard = (event) => {
    if (!event || typeof event !== "object") return event;
    let card = liveEventCards.get(event);
    if (!card) {
        liveEventSeq += 1;
        card = { ...event, id: `${LIVE_TURN_RECORD_ID}-${liveEventSeq}` };
        for (const key of ["tags", "combatants"]) {
            if (card[key] !== undefined && !Array.isArray(card[key])) card[key] = [];
        }
        const impacts = card.impacts && typeof card.impacts === "object" && !Array.isArray(card.impacts)
            ? { ...card.impacts }
            : {};
        for (const key of LIVE_EVENT_LISTS) {
            if (impacts[key] !== undefined && !Array.isArray(impacts[key])) impacts[key] = [];
        }
        card.impacts = impacts;
        liveEventCards.set(event, card);
    }
    return card;
};

const buildLiveTurnRecord = ({ events, fromDate, toDate, round, lookups }) => {
    // Filtered before anything reads a field off one: this record is built on
    // every arriving event, and a throw here takes the whole panel down blank.
    const numbered = events.filter((event) => event && typeof event === "object").map(liveEventCard);
    const primaryEvent = numbered.find((event) => String(event.importance).toLowerCase() === "major") || numbered[0];

    const record = {
        date: toDate || fromDate,
        eventCount: numbered.length,
        events: numbered,
        fallbackReason: "",
        fromDate,
        id: LIVE_TURN_RECORD_ID,
        mode: "jump",
        plannedActions: [],
        rangeLabel: formatRange(fromDate, toDate),
        rawResponse: "",
        round,
        source: "ai",
        summary: "",
        title: primaryEvent?.title || "",
        toDate,
    };

    // Both cost a pass over every event and every impact on it, and this record
    // is rebuilt on every arrival, so computing them eagerly was quadratic for
    // two fields the Events panel never reads. They belong to the history list,
    // which never sees a live record.
    onFirstRead(record, "tags", () => {
        const tags = new Set();
        for (const event of numbered) {
            for (const label of collectEventTags(event, lookups)) tags.add(label);
        }
        return Array.from(tags).slice(0, 10);
    });
    onFirstRead(record, "mapChangeCount", () => (
        numbered.reduce((sum, event) => sum + getEventMapChangeCount(event), 0)
    ));
    return record;
};

const MetricPill = ({ children, icon = null, tone = "default", onClick = null, active = false }) => {
    const toneMap = {
        default: {
            background: "rgba(148,163,184,0.12)",
            border: "1px solid rgba(148,163,184,0.18)",
            color: "rgba(232,232,234,0.84)",
        },
        accent: {
            background: "rgba(96,165,250,0.12)",
            border: "1px solid rgba(96,165,250,0.22)",
            color: "#bfdbfe",
        },
        slate: {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#f4f4f5",
        },
    };

    const resolved = toneMap[tone] || toneMap.default;

    // With onClick the pill is a real button (the map-changes pill opens its list).
    const Tag = onClick ? "button" : "span";
    return (
        <Tag
        type={onClick ? "button" : undefined}
        onClick={onClick ?? undefined}
        style={{
            alignItems: "center",
            background: active ? "rgba(0,0,0,0.42)" : resolved.background,
            border: resolved.border,
            borderRadius: "999px",
            color: resolved.color,
            cursor: onClick ? "pointer" : undefined,
            display: "inline-flex",
            font: "inherit",
            fontSize: "0.69rem",
            fontWeight: 600,
            gap: "0.32rem",
            letterSpacing: "0.02em",
            padding: "0.28rem 0.6rem",
        }}
        >
        {icon}
        <span>{children}</span>
        </Tag>
    );
};

const TagPill = ({ children }) => (
    <span
    style={{
        background: "rgba(255,255,255,0.04)",
                                   border: "1px solid rgba(255,255,255,0.08)",
                                   borderRadius: "999px",
                                   color: "rgba(230,230,233,0.74)",
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
    background: "rgba(255,255,255,0.04)",
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

// What an event is about, as chips that fly the map there (eventFocus.js
// deriveEventLinks). One glyph per kind, the same family as the map's own.
const LINK_GLYPHS = { polity: "⚑", region: "⌖", unit: "⛊", structure: "▣" };

const LinkPill = ({ link, onFocus }) => (
    <button
    type="button"
    title={`Show ${link.label} on the map`}
    onClick={() => onFocus?.(link.bounds)}
    style={{
        alignItems: "center",
        background: "rgba(96,165,250,0.07)",
        border: "1px solid rgba(96,165,250,0.2)",
        borderRadius: "999px",
        color: "rgba(219,234,254,0.86)",
        cursor: "pointer",
        display: "inline-flex",
        font: "inherit",
        fontSize: "0.68rem",
        fontWeight: 600,
        gap: "0.3rem",
        padding: "0.24rem 0.55rem",
    }}
    >
    <span aria-hidden="true" style={{ opacity: 0.7 }}>{LINK_GLYPHS[link.kind] || "⌖"}</span>
    {link.label}
    </button>
);

// A document that came with an event: its heading, and the text itself on a
// click. Published ones say so; a paper only the player's government holds says
// that instead.
const EventDocument = ({ report }) => {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.18)", borderRadius: "12px", overflow: "hidden" }}>
        <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{ alignItems: "center", background: "none", border: "none", color: "rgba(254,243,199,0.92)", cursor: "pointer", display: "flex", font: "inherit", fontSize: "0.74rem", fontWeight: 700, gap: "0.45rem", padding: "0.5rem 0.7rem", textAlign: "left", width: "100%" }}
        >
        <span aria-hidden="true">📄</span>
        <span style={{ flex: 1, minWidth: 0 }}>{report.title}</span>
        <span style={{ color: "rgba(254,243,199,0.5)", flexShrink: 0, fontSize: "0.62rem", fontWeight: 600 }}>
        {report.visibleTo === null ? "Published" : "Our government's"}{report.dateline ? ` · ${report.dateline}` : ""} {open ? "▴" : "▾"}
        </span>
        </button>
        {open && (
            <div className="timeline-markdown" style={{ borderTop: "1px solid rgba(251,191,36,0.12)", color: "rgba(228,228,231,0.84)", fontSize: "0.74rem", lineHeight: 1.55, padding: "0.55rem 0.8rem 0.7rem" }}>
            <ReactMarkdown>{report.body}</ReactMarkdown>
            </div>
        )}
        </div>
    );
};

// What a card is opened by, rather than which card it is. A streamed event's id
// changes when the turn is written, so a card keyed by id would close at exactly
// the moment the live panel must not. The headline survives that crossing.
const eventDisclosureKey = (event) => {
    const title = String(event?.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    return title || String(event?.id ?? "");
};

// openMapChanges/onToggleMapChanges let the panel hold the disclosure instead of
// the card. Left out, the card keeps its own.
const EventCard = ({ event, footer = null, lookups, openMapChanges = null, onToggleMapChanges = null }) => {
    // The model's category tags, then what the event is about: links the map
    // can fly to when the card has them, the participants it names otherwise.
    const links = useMemo(
        () => (typeof lookups?.eventLinks === "function" ? lookups.eventLinks(event) : null),
        [event, lookups],
    );
    const tags = [...(Array.isArray(event.tags) ? event.tags : []), ...(links ? [] : collectEventTags(event, lookups))];
    const documents = useMemo(
        () => (typeof lookups?.eventDocuments === "function" ? lookups.eventDocuments(event) : []),
        [event, lookups],
    );
    const mapChanges = describeEventMapChanges(event, lookups);
    const mapChangeCount = mapChanges.length;
    const [ownMapChanges, setOwnMapChanges] = useState(false);
    const heldAbove = typeof onToggleMapChanges === "function";
    const showMapChanges = heldAbove ? Boolean(openMapChanges) : ownMapChanges;
    const toggleMapChanges = () => (heldAbove ? onToggleMapChanges() : setOwnMapChanges((open) => !open));

    return (
        <div
        style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
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
            <MetricPill icon={<MapIcon />} tone="accent" active={showMapChanges} onClick={toggleMapChanges}>
            {mapChangeCount} map change{mapChangeCount === 1 ? "" : "s"}{showMapChanges ? " ▴" : " ▾"}
            </MetricPill>
        )}
        {event.source === "fallback" && (
            <MetricPill tone="accent">Fallback</MetricPill>
        )}
        </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", padding: "0.95rem 1rem 1rem" }}>
        {(tags.length > 0 || links?.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {tags.map((tag) => (
                <TagPill key={`${event.id}-${tag}`}>{tag}</TagPill>
            ))}
            {(links ?? []).map((link) => (
                <LinkPill key={`${event.id}-link-${link.kind}-${link.label}`} link={link} onFocus={lookups?.focusLink} />
            ))}
            </div>
        )}
        {showMapChanges && mapChanges.length > 0 && (
            <div style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.18)", borderRadius: "12px", display: "grid", gap: "0.3rem", padding: "0.55rem 0.7rem" }}>
            <div style={{ color: "#bfdbfe", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>What changed on the map</div>
            {mapChanges.map((change, index) => (
                <div key={`${event.id}-change-${index}`} style={{ color: "rgba(228,228,231,0.86)", display: "flex", fontSize: "0.74rem", gap: "0.45rem", lineHeight: 1.45 }}>
                <span style={{ color: "rgba(191,219,254,0.7)", flexShrink: 0, fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.04em", minWidth: "4.4rem", paddingTop: "0.12rem", textTransform: "uppercase" }}>{change.kind}</span>
                <span>{change.text}</span>
                </div>
            ))}
            </div>
        )}

        <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {event.title}
        </div>

        {event.description && (
            <div className="timeline-markdown" style={{ color: "rgba(228,228,231,0.82)", fontSize: "0.77rem", lineHeight: "1.58" }}>
            <ReactMarkdown remarkPlugins={EVENT_REMARK_PLUGINS}>{normalizeMarkdown(event.description)}</ReactMarkdown>
            </div>
        )}

        {documents.length > 0 && (
            <div style={{ display: "grid", gap: "0.35rem" }}>
            {documents.map((report) => <EventDocument key={report.id} report={report} />)}
            </div>
        )}

        {footer}
        </div>
        </div>
    );
};

// Opens the interactive event panel (main.jsx listens): on the offer, or on
// the scene in progress.
const openInteractiveEvent = () => window.dispatchEvent(new Event("oh:open-interactive-event"));

// On the card of the event a time skip offered as an interactive event
// (runtime/interactiveOffer.js): play the moment out, or let it pass. Neither
// button spends a request; playing it out opens the panel that does.
const InteractiveOfferStrip = () => {
    const [passing, setPassing] = useState(false);
    const letPass = async () => {
        if (passing) return;
        setPassing(true);
        try {
            await declineInteractiveOffer();
        } catch (error) {
            console.warn("[interactive] the offer could not be let pass.", error);
        } finally {
            setPassing(false);
        }
    };
    return (
        <div style={{ alignItems: "center", background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.45)", borderRadius: "12px", display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.55rem 0.7rem" }}>
            <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
                <div style={{ color: "#fde047", fontSize: "0.74rem", fontWeight: 800 }}>⚡ Interactive event</div>
                <div style={{ color: "rgba(254,249,195,0.72)", fontSize: "0.68rem", lineHeight: 1.4 }}>Play this moment out as a scene: you make the moves, and how it ends goes into the record.</div>
            </div>
            <button type="button" onClick={openInteractiveEvent} style={{ background: "#facc15", border: "none", borderRadius: "8px", color: "#1c1917", cursor: "pointer", fontSize: "0.72rem", fontWeight: 800, padding: "0.4rem 0.75rem" }}>
                Play it out
            </button>
            <button type="button" onClick={letPass} disabled={passing} title="Let the moment pass as it happened — free" style={{ ...ghostButtonStyle, opacity: passing ? 0.6 : 1, padding: "0.4rem 0.75rem" }}>
                {passing ? "Letting it pass…" : "Let it pass"}
            </button>
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
                                       color: "rgba(229,229,232,0.48)",
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

// What today has cost and what the next skip will, under the skip buttons
// (AI/requestBudget.js). A player on a free key has a few hundred requests a
// day and, until this line, no way to see them going.
const RequestsTodayCaption = () => {
    const [day, setDay] = useState(() => requestDay());
    useEffect(() => {
        const refresh = () => setDay(requestDay());
        window.addEventListener("ai:request-budget", refresh);
        const timer = setInterval(refresh, 60000);
        return () => {
            window.removeEventListener("ai:request-budget", refresh);
            clearInterval(timer);
        };
    }, []);
    const cost = describeJumpCost({ saveRequests: savingRequests() });
    // A long skip split into segments (Settings → AI) pays one request a segment.
    const segmented = useMapSetting(MAP_SETTING_KEYS.chunkLongJumps);
    const nearlyOut = day.left <= Math.max(3, Math.ceil(day.limit * 0.1));
    return (
        <div
        title="Counted on this device since midnight Pacific time. Change what the game spends in Settings → AI → AI requests."
        style={{ color: nearlyOut ? "#fbbf24" : "rgba(255,255,255,0.42)", fontSize: "0.68rem", lineHeight: 1.45, marginTop: "0.45rem", textAlign: "center", width: "12.5rem" }}
        >
            <span data-no-translate>{day.used}</span> of <span data-no-translate>{day.limit}</span> AI requests used today
            <br />
            {cost.capped
                ? <>a skip uses <span data-no-translate>{cost.min}</span>, at most <span data-no-translate>{cost.max}</span>{segmented ? ", plus one per extra segment" : ""}</>
                : <>a skip can use twenty or more</>}
            {day.lastJump ? <> · the last used <span data-no-translate>{day.lastJump.used}</span></> : null}
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
            background: hovered ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
            border: hovered ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.18)",
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
        <div style={{ color: "#e4e4e7", fontSize: "0.7rem" }}>
        {opt.label}
        </div>
        </button>
    );
};

// What the skip is doing, and the way out. The same row in both panels, so
// switching between them does not look like two different states of the game.
const SkipProgressRow = ({ label, onCancel }) => (
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
    <span>{label || "Simulating…"}</span>
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
);

const TimelineSkipPanel = ({
    canUndo,
    currentDate,
    error,
    isLoading,
    isOpen,
    isRetryingProjects,
    isRetryingSegment,
    modeSuggestion,
    offeredInteractive = null,
    onAcceptModeSuggestion,
    onAutoJump,
    onCancel,
    onClose,
    onDeclineModeSuggestion,
    onDiscardProjects,
    onDiscardSegment,
    onJump,
    onRetryProjects,
    onRetrySegment,
    onUndo,
    progressLabel,
    projectsHeld,
    projectsRetries,
    sceneInProgress = false,
    segmentHeld,
    segmentRetries,
    topOffset,
    undoCount,
}) => {
    const [customValue, setCustomValue] = useState("");
    const [customUnit, setCustomUnit] = useState("days");
    // Time stands still while an interactive event is being played: the skips
    // wait for it to end or be set aside, as the engine does.
    const blocked = isLoading || sceneInProgress;
    const unitToDays = { hours: 1 / 24, days: 1, weeks: 7, months: 30, years: 365 };
    const runCustomJump = () => {
        const amount = Number(customValue);
        if (!Number.isFinite(amount) || amount <= 0 || blocked) return;
        onJump(amount * (unitToDays[customUnit] ?? 1));
    };
    // Where a custom jump would land, shown under the row the way every preset
    // shows its date (#718). "1 month" is 30 days, so from 1 January it lands on
    // the 31st; a player aiming for the 1st of the next month can now see that
    // before pressing Go instead of after a turn has been spent finding out.
    const customDays = Number(customValue) * (unitToDays[customUnit] ?? 1);
    const customLanding = Number.isFinite(customDays) && customDays > 0
        ? jumpLandingLabel(currentDate, customDays)
        : "";
    const jumpOptions = [
        { label: "6 hours", sublabel: jumpLandingLabel(currentDate, 0.25), days: 0.25 },
        { label: "1 day", sublabel: jumpLandingLabel(currentDate, 1), days: 1 },
        { label: "3 days", sublabel: jumpLandingLabel(currentDate, 3), days: 3 },
        { label: "1 week", sublabel: jumpLandingLabel(currentDate, 7), days: 7 },
        { label: "1 month", sublabel: jumpLandingLabel(currentDate, 30), days: 30 },
        { label: "3 months", sublabel: jumpLandingLabel(currentDate, 90), days: 90 },
        { label: "6 months", sublabel: jumpLandingLabel(currentDate, 180), days: 180 },
        { label: "1 year", sublabel: jumpLandingLabel(currentDate, 365), days: 365 },
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
        {sceneInProgress && (
            <div style={{ background: "rgba(250,204,21,0.1)", border: "1px solid rgba(250,204,21,0.5)", borderRadius: "10px", color: "#fef08a", fontSize: "0.72rem", lineHeight: 1.45, marginBottom: "0.6rem", padding: "0.5rem 0.6rem", textAlign: "center", width: "12.5rem" }}>
                ⚡ A scene is in progress. Time stands still until it ends or is set aside.
                <button
                type="button"
                onClick={openInteractiveEvent}
                style={{ background: "#facc15", border: "none", borderRadius: "8px", color: "#1c1917", cursor: "pointer", display: "block", fontSize: "0.72rem", fontWeight: 800, margin: "0.4rem auto 0", padding: "0.3rem 0.7rem" }}
                >
                Return to the scene
                </button>
            </div>
        )}
        {/* The offer outlives the reveal until the next skip replaces it; this
            says so where the skip is pressed. */}
        {!sceneInProgress && offeredInteractive && (
            <div style={{ background: "rgba(250,204,21,0.07)", border: "1px solid rgba(250,204,21,0.35)", borderRadius: "10px", color: "#fef08a", fontSize: "0.72rem", lineHeight: 1.45, marginBottom: "0.6rem", padding: "0.5rem 0.6rem", textAlign: "center", width: "12.5rem" }}>
                ⚡ An interactive event is on offer: <span data-no-translate style={{ fontWeight: 800 }}>{offeredInteractive.title}</span>. The next time skip lets it pass.
                <button
                type="button"
                onClick={openInteractiveEvent}
                style={{ background: "#facc15", border: "none", borderRadius: "8px", color: "#1c1917", cursor: "pointer", display: "block", fontSize: "0.72rem", fontWeight: 800, margin: "0.4rem auto 0", padding: "0.3rem 0.7rem" }}
                >
                Play it out
                </button>
            </div>
        )}
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
            <div style={{ background: "rgba(255,255,255,0.1)", height: "1.25rem", width: "2px" }} />
            </>
        )}
        <div
        style={{
            background: "rgba(255,255,255,0.07)",
            border: "2px solid rgba(255,255,255,0.28)",
            borderRadius: "999px",
            color: "#e4e4e7",
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "0.35rem 0",
            textAlign: "center",
            width: "5.5rem",
        }}
        >
        {formatGameDateReadable(currentDate, "M/D/YYYY") || dayjs(currentDate).format("M/D/YYYY")}
        </div>

        {jumpOptions.map((opt) => (
            <React.Fragment key={opt.label}>
            <div style={{ background: "rgba(255,255,255,0.1)", height: "1.25rem", width: "2px" }} />
            <JumpNode isLoading={blocked} opt={opt} onJump={onJump} />
            </React.Fragment>
        ))}

        <div style={{ background: "rgba(255,255,255,0.1)", height: "1.25rem", width: "2px" }} />
        <button
        type="button"
        onClick={() => {
            if (blocked) {
                return;
            }

            onAutoJump();
        }}
        style={{
            background: "rgba(37,99,235,0.2)",
            border: "1px solid rgba(96,165,250,0.45)",
            borderRadius: "12px",
            color: "white",
            cursor: blocked ? "default" : "pointer",
            opacity: blocked ? 0.72 : 1,
            padding: "0.55rem 0.7rem",
            textAlign: "center",
            width: "12.5rem",
        }}
        >
        <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>Auto-jump</div>
        </button>

        <div style={{ background: "rgba(255,255,255,0.1)", height: "1.25rem", width: "2px" }} />
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
        disabled={blocked}
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
        disabled={blocked}
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
        disabled={blocked || !customValue}
        style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.28)",
            borderRadius: "8px",
            color: "#fff",
            cursor: blocked || !customValue ? "default" : "pointer",
            fontSize: "0.8rem",
            fontWeight: 700,
            opacity: blocked || !customValue ? 0.5 : 1,
            padding: "0.3rem 0.6rem",
        }}
        >
        Go
        </button>
        </div>
        {customLanding && (
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", marginTop: "0.3rem", textAlign: "center", width: "12.5rem" }}>
            Lands on {customLanding}
            </div>
        )}
        <RequestsTodayCaption />
        </div>

        {/* The events are in the Events panel; this is for a player who came back to cancel. */}
        {isLoading && <SkipProgressRow label={progressLabel} onCancel={onCancel} />}

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

        {/* A HELD jump, not a failed one: one segment of a split jump did not
            come back, the segments before it are still in hand, and nothing has
            been written — the game is still on its old date. Amber rather than
            red for that reason, and Retry re-runs ONLY the segment that failed,
            so the minutes already spent on the earlier ones are not spent
            again. */}
        {segmentHeld && (
            <div
            style={{
                background: "rgba(120,53,15,0.28)",
                border: "1px solid rgba(251,191,36,0.35)",
                borderRadius: "16px",
                color: "#fde68a",
                display: "flex",
                flexDirection: "column",
                fontSize: "0.76rem",
                gap: "0.7rem",
                lineHeight: "1.5",
                padding: "0.85rem 0.9rem",
            }}
            >
            <div>{segmentHeld}</div>
            {/* A failed retry otherwise re-renders the identical message, so the
                button reads as dead even though it ran. Say plainly that it was
                tried and did not work. */}
            {segmentRetries > 0 && !isRetryingSegment && (
                <div style={{ color: "rgba(253,230,138,0.68)", fontSize: "0.72rem" }}>
                Tried {segmentRetries === 1 ? "once" : `${segmentRetries} times`} — that segment still
                did not come back. Retrying again may help if the problem was temporary;
                otherwise discard the turn and run it again, perhaps as a shorter skip.
                </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                type="button"
                disabled={isRetryingSegment}
                onClick={onRetrySegment}
                style={{
                    background: "rgba(251,191,36,0.18)",
                    border: "1px solid rgba(251,191,36,0.4)",
                    borderRadius: "12px",
                    color: "#fde68a",
                    cursor: isRetryingSegment ? "default" : "pointer",
                    flex: 1,
                    fontSize: "0.76rem",
                    opacity: isRetryingSegment ? 0.6 : 1,
                    padding: "0.5rem 0.7rem",
                }}
                >
                {isRetryingSegment ? (progressLabel || "Retrying the segment…") : "Retry the segment"}
                </button>
                <button
                type="button"
                disabled={isRetryingSegment}
                onClick={onDiscardSegment}
                style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.16)",
                    borderRadius: "12px",
                    color: "rgba(255,255,255,0.72)",
                    cursor: isRetryingSegment ? "default" : "pointer",
                    flex: 1,
                    fontSize: "0.76rem",
                    opacity: isRetryingSegment ? 0.6 : 1,
                    padding: "0.5rem 0.7rem",
                }}
                >
                Discard the turn
                </button>
            </div>
            </div>
        )}

        {/* A HELD turn, not a failed one: the events are generated and valid but
            nothing has been written, because the Projects & Operations board
            could not be brought in step with them. Deliberately amber rather
            than red, and worded so the player knows their turn still exists —
            Retry re-runs only the board, which is seconds rather than the
            minutes regenerating the events would cost. */}
        {projectsHeld && (
            <div
            style={{
                background: "rgba(120,53,15,0.28)",
                border: "1px solid rgba(251,191,36,0.35)",
                borderRadius: "16px",
                color: "#fde68a",
                display: "flex",
                flexDirection: "column",
                fontSize: "0.76rem",
                gap: "0.7rem",
                lineHeight: "1.5",
                padding: "0.85rem 0.9rem",
            }}
            >
            <div>{projectsHeld}</div>
            {/* A failed retry otherwise re-renders the identical message, so the
                button reads as dead even though it ran. Say plainly that it was
                tried and did not work. */}
            {projectsRetries > 0 && !isRetryingProjects && (
                <div style={{ color: "rgba(253,230,138,0.68)", fontSize: "0.72rem" }}>
                Tried {projectsRetries === 1 ? "once" : `${projectsRetries} times`} — the board still
                did not update. Retrying again may help if the problem was temporary;
                otherwise discard the turn and run it again.
                </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                type="button"
                disabled={isRetryingProjects}
                onClick={onRetryProjects}
                style={{
                    background: "rgba(251,191,36,0.18)",
                    border: "1px solid rgba(251,191,36,0.4)",
                    borderRadius: "12px",
                    color: "#fde68a",
                    cursor: isRetryingProjects ? "default" : "pointer",
                    flex: 1,
                    fontSize: "0.76rem",
                    opacity: isRetryingProjects ? 0.6 : 1,
                    padding: "0.5rem 0.7rem",
                }}
                >
                {isRetryingProjects ? "Retrying the board…" : "Retry the board"}
                </button>
                <button
                type="button"
                disabled={isRetryingProjects}
                onClick={onDiscardProjects}
                style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.16)",
                    borderRadius: "12px",
                    color: "rgba(255,255,255,0.72)",
                    cursor: isRetryingProjects ? "default" : "pointer",
                    flex: 1,
                    fontSize: "0.76rem",
                    opacity: isRetryingProjects ? 0.6 : 1,
                    padding: "0.5rem 0.7rem",
                }}
                >
                Discard the turn
                </button>
            </div>
            </div>
        )}

        {/* The ladder has twice found the same lower method working for this
            endpoint. Offered, never applied silently: the app did the discovery,
            the player makes the decision — and declining is remembered so this
            asks once rather than after every turn. */}
        {modeSuggestion && (
            <div
            style={{
                background: "rgba(30,58,138,0.28)",
                border: "1px solid rgba(96,165,250,0.32)",
                borderRadius: "16px",
                color: "#bfdbfe",
                display: "flex",
                flexDirection: "column",
                fontSize: "0.76rem",
                gap: "0.7rem",
                lineHeight: "1.5",
                padding: "0.85rem 0.9rem",
            }}
            >
            <div>
            <strong>Turns could be faster.</strong> Your AI model{modeSuggestion.label ? <> (<span data-no-translate>{modeSuggestion.label}</span>)</> : null} can&apos;t use the
            method the game tries first, so every turn wastes time working that
            out. The game can skip straight to what works — on a long turn that
            can save several minutes. Nothing else changes.
            <div style={{ color: "rgba(191,219,254,0.62)", fontSize: "0.72rem", marginTop: "0.4rem" }}>
            You can undo this any time under Settings → AI: edit that model, then How the AI answers.
            </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                type="button"
                onClick={onAcceptModeSuggestion}
                style={{
                    background: "rgba(96,165,250,0.2)",
                    border: "1px solid rgba(96,165,250,0.42)",
                    borderRadius: "12px",
                    color: "#bfdbfe",
                    cursor: "pointer",
                    flex: 1,
                    fontSize: "0.76rem",
                    padding: "0.5rem 0.7rem",
                }}
                >
                Yes, speed up turns
                </button>
                <button
                type="button"
                onClick={onDeclineModeSuggestion}
                style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.16)",
                    borderRadius: "12px",
                    color: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    flex: 1,
                    fontSize: "0.76rem",
                    padding: "0.5rem 0.7rem",
                }}
                >
                No thanks
                </button>
            </div>
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
    canRollbackTurn,
    buildDebugIncident,
    onRollbackTurn,
    canIntervene = false,
    onIntervene = null,
    // The event of this turn offered as an interactive event, by id; "" for none.
    offeredInteractiveId = "",
    // The record is still being written: nothing is saved and the world has not
    // moved. The cards and the reveal are a finished turn's, but everything that
    // acts on a written turn waits for it to land.
    live = false,
    // { label, onCancel } while the skip runs.
    progress = null,
    record,
    topOffset,
    visibleEventCount,
    // Held here, not in each card, so a card survives being replaced by its
    // validated self (eventDisclosureKey).
    openMapChanges = null,
    onToggleMapChanges = null,
    warning,
}) => {
    // Category filter chips (ported from the abdulrahman-2005 fork): only the
    // categories present on this turn's events appear; null = no filter. Older
    // events without tags are always shown. The choice is keyed by the record,
    // so a new turn starts unfiltered without an effect to reset it.
    const [categoryChoice, setCategoryChoice] = useState({ recordId: null, tag: null });
    const categoryFilter = record && categoryChoice.recordId === record.id ? categoryChoice.tag : null;
    const categoryChips = useMemo(() => {
        const present = new Set();
        for (const event of record?.events ?? []) {
            for (const tag of Array.isArray(event?.tags) ? event.tags : []) present.add(tag);
        }
        return EVENT_TAG_ENUM.filter((tag) => present.has(tag));
    }, [record?.events]);
    const filteredEvents = useMemo(() => {
        const events = record?.events ?? [];
        return categoryFilter
            ? events.filter((event) => Array.isArray(event?.tags) && event.tags.includes(categoryFilter))
            : events;
    }, [record?.events, categoryFilter]);
    const totalEvents = filteredEvents.length;
    const visibleEvents =
    totalEvents > 0
    ? filteredEvents.slice(0, Math.min(visibleEventCount, totalEvents))
    : [];
    const hasMoreEvents = visibleEvents.length < totalEvents;
    const lastVisibleEventRef = React.useRef(null);
    // Save the log with this fallback attached, or — logging off — copy the
    // fallback alone under the button's old label (runtime/saveDebugLog.js).
    const report = useFailureReportButton({
        buildIncident: () => buildDebugIncident?.() ?? null,
        copyIdleLabel: "📋 Copy debugging message",
    });
    // idle | working — the undo runs without switching panels, so this button is
    // the only place the player can see that anything is happening.
    const [rollbackState, setRollbackState] = useState("idle");
    // Intervene (AI/intervene.js): idle | asking | working. Asking is the one
    // confirmation — the events not yet revealed are discarded for good — and
    // it is keyed to the record so a new turn never opens on a stale question.
    const [interveneState, setInterveneState] = useState({ recordId: null, state: "idle" });
    const intervening = record && interveneState.recordId === record.id ? interveneState.state : "idle";
    const handleInterveneClick = async () => {
        if (!record || intervening === "working" || !canIntervene || typeof onIntervene !== "function") return;
        if (intervening !== "asking") {
            setInterveneState({ recordId: record.id, state: "asking" });
            return;
        }
        setInterveneState({ recordId: record.id, state: "working" });
        try {
            await onIntervene();
        } finally {
            setInterveneState({ recordId: record.id, state: "idle" });
        }
    };
    const handleRollbackClick = async () => {
        if (rollbackState === "working" || !canRollbackTurn || typeof onRollbackTurn !== "function") return;
        setRollbackState("working");
        try {
            await onRollbackTurn();
        } finally {
            setRollbackState("idle");
        }
    };

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
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.6rem" }}>
            {typeof buildDebugIncident === "function" && (
                <button
                type="button"
                onClick={report.onClick}
                title={report.loggingOn
                    ? "Saves the diagnostics log as a file, with this turn's details — what was attempted and the raw model response — at the top. Attach the file to your bug report. No API key is included; the model's response may quote your campaign."
                    : "Copies this turn's details — what was attempted, game/provider context, and the raw model response. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."}
                style={{
                    alignItems: "center",
                    background: report.done ? "rgba(34,197,94,0.16)" : "rgba(251,191,36,0.1)",
                    border: `1px solid ${report.done ? "rgba(74,222,128,0.4)" : "rgba(251,191,36,0.3)"}`,
                    borderRadius: "8px",
                    color: report.done ? "#86efac" : "#fde68a",
                    cursor: report.busy ? "default" : "pointer",
                    display: "flex",
                    fontFamily: "sans-serif",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    gap: "0.35rem",
                    padding: "0.4rem 0.7rem",
                    transition: "background 0.15s, border-color 0.15s, color 0.15s",
                }}
                >
                {report.label}
                </button>
            )}
            {/* Only offered while a restore point actually exists — a fallback on
                the very first turn has nothing behind it to roll back to. The
                working state keeps it rendered: canRollbackTurn goes false the
                moment the undo starts loading, which would otherwise unmount the
                button mid-click and take its progress label with it. */}
            {typeof onRollbackTurn === "function" && (canRollbackTurn || rollbackState === "working") && (
                <button
                type="button"
                onClick={handleRollbackClick}
                disabled={rollbackState === "working"}
                title="Undoes this turn and restores the world to how it was before the jump, so you can fix the provider settings and try again."
                style={{
                    alignItems: "center",
                    background: "rgba(180,83,9,0.22)",
                    border: "1px solid rgba(245,158,11,0.45)",
                    borderRadius: "8px",
                    color: "#fcd9a8",
                    cursor: rollbackState === "working" ? "default" : "pointer",
                    display: "flex",
                    fontFamily: "sans-serif",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    gap: "0.35rem",
                    opacity: rollbackState === "working" ? 0.7 : 1,
                    padding: "0.4rem 0.7rem",
                    transition: "background 0.15s, border-color 0.15s, color 0.15s",
                }}
                >
                {rollbackState === "working" ? "Rolling back…" : "↩ Rollback turn"}
                </button>
            )}
            </div>
            </div>
        )}
        {!record ? (
            <EmptyPanelState text="No event chain is available yet." />
        ) : totalEvents === 0 ? (
            // Mid-skip an empty list just means the first event has not arrived.
            live ? null : <EmptyPanelState text="No world events were recorded for this time skip." />
        ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {categoryChips.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {categoryChips.map((tag) => {
                    const active = categoryFilter === tag;
                    return (
                        <button
                        key={tag}
                        type="button"
                        onClick={() => setCategoryChoice({ recordId: record.id, tag: active ? null : tag })}
                        style={{
                            padding: "0.2rem 0.6rem",
                            borderRadius: "999px",
                            border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.16)",
                            background: active ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.06)",
                            color: "white",
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            cursor: "pointer",
                        }}
                        >
                        {tag}
                        </button>
                    );
                })}
                </div>
            )}
            {visibleEvents.map((event, index) => {
                const isLastVisible = index === visibleEvents.length - 1;

                const openKey = eventDisclosureKey(event);

                return (
                    <div key={event.id} ref={isLastVisible ? lastVisibleEventRef : null}>
                    {/* No "Show on map" footer: the camera already flies to
                        every event as it is revealed. The offered interactive
                        event carries its offer instead. */}
                    <EventCard
                    event={event}
                    lookups={lookups}
                    openMapChanges={openMapChanges ? openMapChanges.has(openKey) : null}
                    onToggleMapChanges={onToggleMapChanges ? () => onToggleMapChanges(openKey) : null}
                    footer={offeredInteractiveId && event.id === offeredInteractiveId ? <InteractiveOfferStrip /> : null}
                    />
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
                {/* Intervene: stop the round HERE. The revealed events are canon,
                    the rest never happened, and the game's date is the last
                    revealed event's — so the player's orders go out before what
                    came next. Costs no request (AI/intervene.js). Only offered
                    with no category filter on: the count is by reveal order. */}
                {canIntervene && !categoryFilter && typeof onIntervene === "function" && (
                    intervening === "asking" ? (
                        <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.4rem",
                            padding: "0.6rem 0.7rem",
                            borderRadius: "0.6rem",
                            border: "1px solid rgba(251,191,36,0.55)",
                            background: "rgba(251,191,36,0.10)",
                            fontSize: "0.78rem",
                            lineHeight: 1.4,
                        }}
                        >
                        <span>
                            Stop the round after <strong>{visibleEvents[visibleEvents.length - 1]?.title}</strong>? The
                            {" "}{totalEvents - visibleEvents.length} event{totalEvents - visibleEvents.length === 1 ? "" : "s"} not yet revealed
                            will be discarded — they never happen — and the date becomes {visibleEvents[visibleEvents.length - 1]?.date}.
                            You can still undo the round afterwards.
                        </span>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                            <button
                            type="button"
                            onClick={handleInterveneClick}
                            style={{ ...ghostButtonStyle, flex: 1, minHeight: "2rem", border: "1px solid rgba(251,191,36,0.8)", background: "rgba(251,191,36,0.22)" }}
                            >
                            <span>Stop here</span>
                            </button>
                            <button
                            type="button"
                            onClick={() => setInterveneState({ recordId: record.id, state: "idle" })}
                            style={{ ...ghostButtonStyle, flex: 1, minHeight: "2rem", opacity: 0.8 }}
                            >
                            <span>Keep going</span>
                            </button>
                        </div>
                        </div>
                    ) : (
                        <button
                        type="button"
                        onClick={handleInterveneClick}
                        disabled={intervening === "working"}
                        title="Stop the round here: what is revealed happened, what is not never does, and you act before it."
                        style={{
                            ...ghostButtonStyle,
                            minHeight: "1.9rem",
                            opacity: intervening === "working" ? 0.7 : 0.9,
                            width: "100%",
                            cursor: intervening === "working" ? "default" : "pointer",
                        }}
                        >
                        <span>{intervening === "working" ? "Stopping the round…" : "✋ Intervene here"}</span>
                        </button>
                    )
                )}
                </>
            )}
            </div>
        )}
        {/* Under the cards, so the list reads as a finished turn's would. */}
        {progress && (
            <div style={{ marginTop: totalEvents > 0 ? "0.75rem" : 0 }}>
            <SkipProgressRow label={progress.label} onCancel={progress.onCancel} />
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
    // Places the widget beside the advisor drawer: right, transform and
    // transition (main.jsx).
    dockStyle = null,
    topOffset = "0.5rem",
}) => {
    // Shared store rather than three local copies on a 5s poll of their own.
    const gameData = useRuntimeState("game");
    const events = useRuntimeState("events");
    const worldState = useRuntimeState("world");
    const setGameData = (game) => primeRuntimeValue("game", game);
    const setEvents = (next) => primeRuntimeValue("events", next);
    const setWorldState = (world) => primeRuntimeValue("world", world);
    // The interactive event the last skip offered (runtime/interactiveOffer.js),
    // once the reveal has reached its event; none while a scene is in progress.
    const unseenEventIds = useUnseenEventIds();
    const sceneInProgress = isSceneInProgress(worldState?.activeInteractive);
    const offeredInteractive = offeredEvent({ offer: worldState?.interactiveOffer, events, sceneInProgress });
    const shownOffer = offeredInteractive && !unseenEventIds.has(offeredInteractive.id) ? offeredInteractive : null;
    const [countryBounds, setCountryBounds] = useState(new Map());
    const [countryCatalog, setCountryCatalog] = useState([]);
    const [regionBounds, setRegionBounds] = useState(new Map());
    const [regionCatalog, setRegionCatalog] = useState([]);
    const [localOpenPanel, setLocalOpenPanel] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    // What the spinner says while a jump runs. Empty for a single-request jump —
    // the notice falls back to its own wording — and set per segment when a long
    // skip is generated in pieces (AI/jumpSegments.js).
    const [jumpProgress, setJumpProgress] = useState("");
    // A phase of the skip as it starts: "Writing 1 month of events… (part 2 of 3)".
    const showSkipPhase = ({ label, detail } = {}) =>
        setJumpProgress(label ? `${label}…${detail ? ` (${detail})` : ""}` : "");
    // The skip's events as the model writes them (AI/streamedEvents.js): the
    // request already streamed, nothing was reading it. A preview, before the
    // validators sort, clamp and screen; the list goes when the turn does.
    const [streamedEvents, setStreamedEvents] = useState([]);
    const showStreamedEvents = (list) => setStreamedEvents(Array.isArray(list) ? list : []);
    // Not isLoading, which Undo and Intervene raise too: neither writes events,
    // and a live panel over either promises cards that never come.
    const [skipInFlight, setSkipInFlight] = useState(false);
    // The span being written, for the panel's subtitle. Set when the skip starts.
    const [liveRange, setLiveRange] = useState({ from: "", to: "" });
    // The pre-jump world the live reveal stages onto. Null when no skip is running.
    const [liveStageBase, setLiveStageBase] = useState(null);
    // Cards the player has opened, by headline, so one opened mid-skip survives
    // the validated turn replacing the preview.
    const [openMapChanges, setOpenMapChanges] = useState(() => new Set());
    const toggleMapChanges = (key) => setOpenMapChanges((open) => {
        const next = new Set(open);
        if (!next.delete(key)) next.add(key);
        return next;
    });
    const [error, setError] = useState("");
    const [fallbackWarning, setFallbackWarning] = useState("");
    // A turn that is generated and valid but NOT written, because the Projects &
    // Operations board could not be brought in step with it. Set means a turn is
    // waiting: the player retries just the board, or discards and runs the turn
    // again. Nothing has been saved either way.
    const [projectsHeld, setProjectsHeld] = useState("");
    const [isRetryingProjects, setIsRetryingProjects] = useState(false);
    // How many times the board has been retried for the turn currently held.
    // Without it a failed retry re-renders the identical message and reads as a
    // dead button - which is exactly how it read in testing.
    const [projectsRetries, setProjectsRetries] = useState(0);
    // A jump whose segments are part-generated: one segment failed and the rest
    // of the round was never asked for. Set means a turn is waiting — the player
    // retries that one segment, or discards. Nothing has been written either way,
    // so there is no rollback to run: the game is still on its pre-jump date.
    const [segmentHeld, setSegmentHeld] = useState("");
    const [isRetryingSegment, setIsRetryingSegment] = useState(false);
    // How many times the failed segment has been retried for the jump currently
    // held — same reason as projectsRetries.
    const [segmentRetries, setSegmentRetries] = useState(0);
    // The structured-output ladder has now twice found the same lower method
    // working for this endpoint. Offered rather than applied: the app does the
    // discovery, the player makes the decision. Checked after a turn ends, so it
    // never interrupts one.
    const [modeSuggestion, setModeSuggestion] = useState(null);
    // Holds the in-flight jump's AbortController so the Cancel button can stop it.
    const jumpAbortRef = React.useRef(null);
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

        // Each on its own. The stock outlines come from tile archives that a
        // drawn map does not use and an install may not have at all; they used
        // to share one Promise.all with the names, so a missing archive (a 404)
        // took the country and region names down with it — and with them the
        // event camera, the cards' links and the names in "N map changes".
        const loadLookups = async () => {
            const settle = async (label, load, fallback) => {
                try {
                    return (await load()) ?? fallback;
                } catch (lookupError) {
                    if (!cancelled) console.warn(`Timeline lookups: the ${label} could not be loaded; going on without them.`, lookupError);
                    return fallback;
                }
            };
            const [countries, regions, nextCountryBounds, nextRegionBounds] = await Promise.all([
                settle("country names", loadCountryNames, []),
                settle("region catalog", loadRegionCatalog, []),
                settle("stock country outlines", loadCountryBounds, new Map()),
                settle("stock region outlines", loadRegionBounds, new Map()),
            ]);

            if (cancelled) {
                return;
            }

            setCountryBounds(nextCountryBounds);
            setCountryCatalog(countries);
            setRegionBounds(nextRegionBounds);
            setRegionCatalog(regions);
        };

        loadLookups();

        return () => {
            cancelled = true;
        };
    }, []);

    // The store owns the refresh and the never-move-the-clock-backwards guard.
    // Left here is the panel's own reaction to an undone turn: the live warning
    // belongs to the discarded turn. The turn now newest was seen in full before
    // the undone one was made, and the reel shows it so (the effect on the
    // newest turn, below).
    useEffect(() => {
        const handleRolledBack = () => {
            setFallbackWarning("");
        };
        window.addEventListener("oh:rolled-back", handleRolledBack);
        return () => window.removeEventListener("oh:rolled-back", handleRolledBack);
    }, []);

    // Pre-game history: a fresh game (round 1, no events, no turns) whose
    // scenario wrote a "World Before Round One" briefing gets its backstory
    // generated once, the first time the player actually enters it. Waits out
    // the main menu so tokens are never spent on a game the player is only
    // hovering past; every other guard (busy lock, still-the-same-game check,
    // the done-marker) lives in maybeGeneratePregameHistory itself. The menu
    // state is a dependency because nothing else re-renders this when the
    // player finally enters the game.
    const mainMenuOpen = useMainMenuOpen();
    const pregameAttemptedRef = React.useRef(false);
    useEffect(() => {
        if (pregameAttemptedRef.current || !gameData || !worldState) {
            return;
        }
        const fresh =
            (Number(gameData.round) || 1) === 1 &&
            (events?.length ?? 0) === 0 &&
            (worldState.simulationHistory?.length ?? 0) === 0;
        if (!fresh || !String(worldState.startingTimelineText ?? "").trim()) {
            return;
        }
        if (isMainMenuOpen()) {
            return;
        }
        pregameAttemptedRef.current = true;
        maybeGeneratePregameHistory().catch(() => {});
    }, [gameData, worldState, events, mainMenuOpen]);

    function setPanel(panelName) {
        // Where the player was looking, in detailed mode. On its own a panel
        // change is trivia; interleaved with the turn and API entries it is what
        // turns "it broke" into a reproduction — which panel was open when the
        // crash landed, and what they had opened just before.
        logDebugEvent("ui", `Panel: ${panelName || "closed"}`, undefined, { verbose: true });
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

        logDebugEvent("ui", `Panel toggled: ${panelName}`, undefined, { verbose: true });

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

        // Nothing in the Fallback list can answer — every model Spent or
        // Unusable: say when the first comes back, or what to fix, rather than
        // spend the turn finding out and falling back to canned events. An
        // empty list is left to the start-of-game prompt, as a missing key is.
        const fallbackEntries = getResolvedFallbackList();
        const availability = fallbackAvailability({ entries: fallbackEntries, store: fallbackStateStore });
        if (fallbackEntries.length && !availability.canAnswer) {
            const reason = describeUnavailable({ entries: fallbackEntries, store: fallbackStateStore });
            setPanel("skip");
            setError(availability.nextEntry ? `${reason} Add a backup in Settings → AI to keep playing now.` : reason);
            logDebugEvent("turn", "Timeline jump not started: nothing in the Fallback list can answer.", {
                firstBack: availability.nextEntry?.label ?? "(none — every model is Unusable)",
                ...(availability.nextResetAt ? { at: new Date(availability.nextResetAt).toISOString() } : {}),
            });
            return;
        }

        // Worked out before the flag goes up: only the finally lowers it, so a
        // throw before the try would leave the panel live for good.
        const landingDate = mode === "auto" ? "" : jumpTargetDate(currentDate, days);
        // Settings, AI: off leaves the skip behind the Timeline panel's spinner.
        const live = getMapSettingDefaultOn(MAP_SETTING_KEYS.liveSkipEvents);

        // Watched from the Events panel, which fills as the model writes and
        // carries the spinner underneath. A failed or held turn goes back to the
        // Timeline panel, where those notices live.
        setPanel(live ? "history" : "skip");
        setIsLoading(true);
        setSkipInFlight(live);
        setJumpProgress("");
        setStreamedEvents([]);
        // A carry the last turn never consumed, because a skip landing on the
        // same date leaves the record's identity unchanged, must not reach this one.
        revealCarryRef.current = null;
        if (live) {
            setOpenMapChanges(new Set());
            // Only when live: behind the spinner the reveal effect never re-runs,
            // so a failed skip would leave the previous turn collapsed to one event.
            setVisibleEventCount(1);
            setLiveRange({ from: currentDate, to: landingDate });
            // Nothing is written yet, so the world on screen is the base.
            setLiveStageBase(cloneWorldForStaging(worldState));
        }
        setError("");
        setFallbackWarning("");
        // simulateTimelineJump abandons any held turn when it starts, so a notice
        // left on screen would offer buttons with nothing behind them.
        setSegmentHeld("");
        setSegmentRetries(0);
        setProjectsHeld("");
        setProjectsRetries(0);

        // The turn is the unit a bug report is written in ("I jumped a month and
        // the border went wrong"), so both ends of it go in the diagnostics log
        // with the timing between them — a jump that took eleven minutes and one
        // that took eleven seconds are different bugs, and the wall-clock
        // timestamps are the only way to tell them apart after the fact.
        const startedAt = Date.now();
        logDebugEvent("turn", `Timeline ${mode === "auto" ? "auto-jump" : "jump"} started: ${days} day(s) from ${gameData.gameDate || "unknown"}.`, {
            round: gameData.round ?? 0,
        });

        const controller = new AbortController();
        jumpAbortRef.current = controller;
        try {
            // No onEvents with the setting off: nothing streams anywhere.
            const onEvents = live ? showStreamedEvents : undefined;
            const result = mode === "auto"
            ? await simulateAutoJump({ days, signal: controller.signal, onProgress: showSkipPhase, onEvents })
            : await simulateTimelineJump({
                days,
                signal: controller.signal,
                // What the skip is doing right now, in its own words
                // (AI/skipPhases.js). Without this the spinner said the same
                // thing throughout and a working turn read as a frozen one.
                onProgress: showSkipPhase,
                // And the events, as they are written.
                onEvents,
            });
            // Before the record changes, so what was uncovered stays uncovered.
            // Not for a fallback turn: the canned period is not the round that
            // was on screen, so it is read from the beginning.
            if (result.generation?.source !== "fallback") carryLiveReveal();
            setGameData(result.game);
            setEvents(result.events);
            setWorldState(result.world);
            const elapsed = `${Math.round((Date.now() - startedAt) / 1000)}s`;
            if (result.generation?.source === "fallback") {
                setFallbackWarning(`Turn generated by fallback: ${result.generation.fallbackReason || "structured AI output was unavailable"}`);
                // A fallback is the single most reported bug in the game, and the
                // reason is otherwise only reachable through the details the
                // history panel's Save button attaches — which cover the LAST
                // turn only, so a session with three fallbacks could report
                // exactly one of them.
                logDebugEvent("turn", `Turn FELL BACK after ${elapsed}: ${result.generation.fallbackReason || "structured AI output was unavailable"}`, {
                    round: result.game?.round ?? 0,
                    toDate: result.game?.gameDate || "",
                });
            } else {
                logDebugEvent("turn", `Turn finished in ${elapsed} — now ${result.game?.gameDate || "unknown"}.`, {
                    round: result.game?.round ?? 0,
                    events: result.events?.length ?? 0,
                    source: result.generation?.source || "ai",
                });
            }
            // What the turn actually DID to the world, in detailed mode. This is
            // the entry that answers the most common report there is — "the
            // event said my army took the province but the border never moved" —
            // because a turn that narrates a capture with zero region transfers
            // shows up here as `regionTransfers: 0` beside an event list that
            // clearly describes one. Titles and counts, not event prose: the
            // prose is in the player's own screenshot, and it is the part of a
            // log they are least comfortable posting.
            const lastTurn = (result.world?.simulationHistory ?? [])[0] ?? null;
            const changeCount = (impactKey) => (result.events ?? [])
                .reduce((total, event) => total + (event?.impacts?.[impactKey]?.length ?? 0), 0);
            logDebugEvent("turn", `Turn ${result.game?.round ?? 0} world changes.`, {
                events: (result.events ?? []).map((event) => event?.title || "(untitled)"),
                regionTransfers: changeCount("regionTransfers"),
                polityChanges: changeCount("polityChanges"),
                unitOps: changeCount("unitOps"),
                markerOps: changeCount("markerOps"),
                projectOps: changeCount("projectOps"),
                createdChats: changeCount("createdChats"),
                units: result.world?.units?.length ?? 0,
                pendingUnitOrders: result.world?.pendingUnitOrders?.length ?? 0,
                projects: result.world?.projects?.length ?? 0,
                summary: lastTurn?.summary || "",
            }, { verbose: true });

            setPanel("history");
        } catch (jumpError) {
            // Every notice that explains why lives in the Timeline panel, so go
            // back rather than leave the player on a panel that stopped filling.
            setPanel("skip");
            if (controller.signal.aborted || jumpError?.name === "AbortError") {
                // Player cancelled — nothing was written, so just close out quietly.
                setError("");
                logDebugEvent("turn", "Turn cancelled by the player.");
            } else if (jumpError?.segmentHeld) {
                // Not a failed turn: a long skip is generated in segments and one
                // of them did not come back. The finished segments are still held,
                // unwritten, so retrying re-runs only the segment that failed
                // rather than the whole round.
                setError("");
                setSegmentHeld(jumpError.message || "A segment of this jump failed.");
                setSegmentRetries(0);
                logDebugEvent("turn", `Turn HELD after ${Math.round((Date.now() - startedAt) / 1000)}s: segment ${(jumpError.segmentIndex ?? 0) + 1} of ${jumpError.segmentCount ?? 0} failed; nothing was written.`);
            } else if (jumpError?.projectsHeld) {
                // Not a failed turn: the events are generated and valid, and the
                // whole turn is being HELD unwritten because the Projects board
                // could not be brought in step with them. Retrying re-runs only
                // the board call — the events are not regenerated, which on a slow
                // model is the difference between ten seconds and ten minutes.
                setError("");
                setProjectsHeld(jumpError.message || "The Projects & Operations board did not update.");
                setProjectsRetries(0);
            } else {
                console.error("Failed to simulate jump:", jumpError);
                setError(jumpError.message || "Failed to simulate timeline jump.");
            }
        } finally {
            jumpAbortRef.current = null;
            setIsLoading(false);
            setSkipInFlight(false);
            setJumpProgress("");
            setStreamedEvents([]);
            setLiveStageBase(null);
            // Between turns, never during one. If the ladder has learned
            // something consistent about this endpoint, offer it now.
            setModeSuggestion(getStructuredModeSuggestion());
        }
    };

    const cancelJump = () => {
        jumpAbortRef.current?.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
    };

    // Finish a held turn by re-running ONLY the board call. The events are not
    // regenerated: they are already valid, and on a slow model regenerating them
    // is the difference between a few seconds and several minutes.
    const retryHeldProjects = async () => {
        if (isRetryingProjects) return;
        setIsRetryingProjects(true);
        setProjectsRetries((count) => count + 1);
        const startedAt = Date.now();
        const controller = new AbortController();
        jumpAbortRef.current = controller;
        try {
            const result = await retryPendingProjectsJump({ signal: controller.signal });
            setGameData(result.game);
            setEvents(result.events);
            setWorldState(result.world);
            setVisibleEventCount(1);
            setProjectsHeld("");
            setProjectsRetries(0);
            logDebugEvent("turn", `Held turn finished in ${Math.round((Date.now() - startedAt) / 1000)}s — now ${result.game?.gameDate || "unknown"}.`, {
                round: result.game?.round ?? 0,
                events: result.events?.length ?? 0,
            });
        } catch (retryError) {
            if (controller.signal.aborted || retryError?.name === "AbortError") {
                // Cancelled. The turn is still held and still unwritten, so leave
                // the notice up rather than implying it was resolved.
                logDebugEvent("turn", "Board retry cancelled; the turn is still held.");
            } else if (retryError?.projectsHeld) {
                setProjectsHeld(retryError.message);
            } else {
                // The board worked but the write did not. The held turn is gone
                // with it, so this is an ordinary turn failure from here.
                setProjectsHeld("");
                setError(retryError.message || "Failed to finish the held turn.");
            }
        } finally {
            jumpAbortRef.current = null;
            setIsRetryingProjects(false);
        }
    };

    // Finish a held jump by re-running ONLY the segment that failed and the ones
    // after it. The segments already generated are not regenerated: they are
    // valid, and on a slow model each one may have cost minutes.
    const retryHeldSegment = async () => {
        if (isRetryingSegment) return;
        const live = getMapSettingDefaultOn(MAP_SETTING_KEYS.liveSkipEvents);
        setIsRetryingSegment(true);
        setSkipInFlight(live);
        setSegmentRetries((count) => count + 1);
        setJumpProgress("");
        setStreamedEvents([]);
        revealCarryRef.current = null;
        if (live) {
            setOpenMapChanges(new Set());
            setVisibleEventCount(1);
            // The finished segments are in hand; the retry writes the rest.
            setLiveRange({ from: currentDate, to: "" });
            setLiveStageBase(cloneWorldForStaging(worldState));
            setPanel("history");
        }
        const startedAt = Date.now();
        const controller = new AbortController();
        jumpAbortRef.current = controller;
        try {
            const result = await retryPendingJumpSegment({
                signal: controller.signal,
                onProgress: showSkipPhase,
                onEvents: live ? showStreamedEvents : undefined,
            });
            carryLiveReveal();
            setGameData(result.game);
            setEvents(result.events);
            setWorldState(result.world);
            setSegmentHeld("");
            setSegmentRetries(0);
            logDebugEvent("turn", `Held jump finished in ${Math.round((Date.now() - startedAt) / 1000)}s — now ${result.game?.gameDate || "unknown"}.`, {
                round: result.game?.round ?? 0,
                events: result.events?.length ?? 0,
            });
            setPanel("history");
        } catch (retryError) {
            if (controller.signal.aborted || retryError?.name === "AbortError") {
                // Cancelled. The turn is still held and still unwritten, so leave
                // the notice up rather than implying it was resolved.
                logDebugEvent("turn", "Segment retry cancelled; the turn is still held.");
            } else if (retryError?.segmentHeld) {
                setSegmentHeld(retryError.message);
            } else if (retryError?.projectsHeld) {
                // The segments finished; the BOARD is what is holding the turn
                // now. One notice at a time, or the player is offered two retries
                // for one turn and only one of them does anything.
                setSegmentHeld("");
                setSegmentRetries(0);
                setProjectsHeld(retryError.message);
                setProjectsRetries(0);
            } else {
                // The segments finished but the write did not. The held jump is
                // gone with it, so this is an ordinary turn failure from here.
                setSegmentHeld("");
                setError(retryError.message || "Failed to finish the held jump.");
            }
        } finally {
            jumpAbortRef.current = null;
            setIsRetryingSegment(false);
            setSkipInFlight(false);
            setJumpProgress("");
            setStreamedEvents([]);
            setLiveStageBase(null);
        }
    };

    // Throw the held jump away. Nothing was ever written, so there is nothing to
    // undo and no rollback to run — the game is still on its pre-jump date and
    // the player simply loses the segments generated so far.
    const discardHeldSegment = () => {
        discardPendingJumpSegment();
        setSegmentHeld("");
        setSegmentRetries(0);
    };

    // Throw the held turn away. Nothing was ever written, so there is nothing to
    // undo — the player just loses the generation, as if they had cancelled.
    const discardHeldProjects = () => {
        discardPendingProjectsJump();
        setProjectsHeld("");
        setProjectsRetries(0);
    };

    const acceptModeSuggestion = () => {
        if (!modeSuggestion) return;
        acceptStructuredModeSuggestion(modeSuggestion.key, modeSuggestion.mode);
        setModeSuggestion(null);
    };

    const declineModeSuggestion = () => {
        if (!modeSuggestion) return;
        // Remembered for the session, so it asks once rather than every turn.
        declineStructuredModeSuggestion(modeSuggestion.key, modeSuggestion.mode);
        setModeSuggestion(null);
    };

    // How many turns can be undone (a restore point is captured at the start of
    // each turn). Re-checked whenever the round changes — after a jump or undo.
    useEffect(() => {
        let active = true;
        // The index, not the snapshots: the full list carries every prior world.
        loadRollbackSnapshotCount().then((count) => {
            if (active) setUndoCount(count);
        });
        return () => { active = false; };
    }, [gameData?.round]);

    // stayOnHistory: called from the fallback warning's "Rollback turn" button,
    // which lives in the history panel — yanking that panel away mid-undo would
    // hide the very thing the player just acted on. The Timeline panel's own
    // undo button still switches, since that is where it is already looking.
    const runUndo = async ({ stayOnHistory = false } = {}) => {
        if (isLoading || undoCount <= 0) {
            return false;
        }

        if (!stayOnHistory) setPanel("skip");
        setIsLoading(true);
        setError("");
        setFallbackWarning("");

        logDebugEvent("turn", "Undoing the last turn.", { round: gameData?.round ?? 0, undoCount });
        try {
            const result = await rollBackToSnapshot(0);
            if (result) {
                logDebugEvent("turn", `Undo complete — back to ${result.bundle.game?.gameDate || "unknown"}.`, {
                    round: result.bundle.game?.round ?? 0,
                    remaining: result.remaining,
                });
                setGameData(result.bundle.game);
                setEvents(result.bundle.events);
                setWorldState(result.bundle.world);
                setVisibleEventCount(1);
                setUndoCount(result.remaining);
                setPanel("history");
                return true;
            }
        } catch (undoError) {
            console.error("Failed to undo turn:", undoError);
            setError(undoError.message || "Failed to undo the last turn.");
        } finally {
            setIsLoading(false);
        }
        return false;
    };

    // Intervene (AI/intervene.js): whether the newest turn carries the journal
    // it needs, re-checked with the round like the undo count. Cleared while a
    // jump runs so a half-revealed turn is never stopped under a new one.
    const [canInterveneTurn, setCanInterveneTurn] = useState(false);
    const latestTurnDate = worldState?.simulationHistory?.[0]?.date ?? "";
    useEffect(() => {
        let active = true;
        canInterveneInLastTurn()
            .then((can) => { if (active) setCanInterveneTurn(Boolean(can)); })
            .catch(() => { if (active) setCanInterveneTurn(false); });
        return () => { active = false; };
    }, [gameData?.round, latestTurnDate]);

    // Stop the round after the events revealed so far. The engine rolls back to
    // the turn's snapshot and applies the kept prefix again, without a request;
    // the panel then shows the shorter turn, fully revealed.
    const runIntervene = async () => {
        const keep = Math.max(1, visibleEventCount);
        if (isLoading || !canInterveneTurn) return false;
        setIsLoading(true);
        setError("");
        setFallbackWarning("");
        logDebugEvent("turn", `Intervening after event ${keep} of the last turn.`, { round: gameData?.round ?? 0 });
        try {
            const result = await interveneAfterEvent(keep);
            if (result) {
                logDebugEvent("turn", `Intervention complete — the round now stops on ${result.closingDate}.`, {
                    kept: result.kept,
                    dropped: result.dropped,
                });
                setGameData(result.bundle.game);
                setEvents(result.bundle.events);
                setWorldState(result.bundle.world);
                setVisibleEventCount(result.kept);
                setPanel("history");
                return true;
            }
            setError("There was nothing to stop: the round has no events after the ones revealed.");
        } catch (interveneError) {
            console.error("Failed to intervene:", interveneError);
            setError(interveneError.message || "Failed to stop the round.");
        } finally {
            setIsLoading(false);
        }
        return false;
    };

    // Display-name lookups for the timeline's own labels, off the same catalogs
    // the camera resolves places from.
    const polityLookup = useMemo(
        () => new Map(countryCatalog.map((entry) => [entry.code, entry.name])),
        [countryCatalog],
    );
    const regionLookup = useMemo(
        () => new Map(regionCatalog.map((entry) => [entry.id, entry])),
        [regionCatalog],
    );

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
    // Built even with no events yet, so a skip that has not produced its first
    // does not leave the previous turn on screen as if it were this one.
    const liveTurnRecord = useMemo(() => (skipInFlight
        ? buildLiveTurnRecord({
            events: streamedEvents,
            fromDate: liveRange.from,
            toDate: liveRange.to,
            round: (gameData?.round || 0) + 1,
            lookups,
        })
        : null), [skipInFlight, streamedEvents, liveRange.from, liveRange.to, gameData?.round, lookups]);
    const displayRecord = liveTurnRecord ?? latestTurnRecord;
    const totalVisibleEvents = displayRecord?.events?.length || 0;
    // The newest revealed event, written turn or not: the camera follows the
    // live reveal for the same reason the map stages along with it.
    const activeVisibleEvent =
    openPanel === "history" && totalVisibleEvents > 0
    ? displayRecord.events[Math.min(Math.max(visibleEventCount, 1), totalVisibleEvents) - 1]
    : null;

    // Resolve a valid date defensively: gameDate, else startDate, else nothing.
    // dayjs("") / dayjs(null) is an Invalid Date, so guard before formatting.
    // Dates dayjs can't parse but that ARE text ("1200 BCE", ancient-era
    // scenarios) display verbatim instead of "Undated".
    // Full display name, never the code: era polity name first, then the
    // base country name, then the raw value as a last resort.
    // Re-read when the game's features change, so the log's header follows a
// Player focus the player just changed in Settings.
    const activeFeatures = useActiveFeatures();
    const playerCountryCode = gameData?.country || "";
    const playerCountry = playerCountryCode
    ? (worldState?.polityOverrides?.[playerCountryCode]?.name
        || polityLookup.get(playerCountryCode)
        || playerCountryCode)
    : "";

    // Keeps the diagnostics log's header — and the in-game date stamped on every
    // entry it records from here on — in step with the campaign. This component
    // owns the game bundle, so it is the only place that knows all four of these
    // at once; everything else in the log reads them back out of the context.
    useEffect(() => {
        setDebugLogContext({
            gameDate: gameData?.gameDate || "",
            round: gameData?.round == null ? "" : String(gameData.round),
            difficulty: gameData?.difficulty || "",
            playerFocus: getActivePlayerFocus() ?? "off",
            playerCountry: playerCountry || playerCountryCode || "",
        });
    }, [gameData?.gameDate, gameData?.round, gameData?.difficulty, activeFeatures, playerCountry, playerCountryCode]);

    // "Save logging file" (TimelineHistoryPanel, next to the fallback warning):
    // the diagnostics log, with this fallback's own details attached at the top —
    // what was attempted and the raw model response — so a fallback can be
    // diagnosed from the one file the player sends. With logging off the same
    // details are copied on their own instead ("Copy debugging message"). Built
    // lazily on click, not kept in state, since it only ever matters if the
    // button is pressed.
    //
    // Only what the log's header does not already say. Provider, model, polity
    // and difficulty all sit in that header — and in the copied report's, which
    // reads the same context — so they are not repeated here; the round is
    // passed and dropped by the log if it matches.
    const buildFallbackIncident = () => {
        const record = latestTurnRecord;
        if (!record) return null;
        const actionsList = record.plannedActions.length
        ? record.plannedActions.map((action) =>
            `- ${action.title}${action.text && action.text !== action.title ? `: ${action.text}` : ""}`)
        : "(none queued)";
        // The events THIS fallback turn produced are generic canned text (no
        // diagnostic value) — exclude them and show what actually led up to it.
        const recordEventIds = new Set(record.events.map((event) => event.id));
        const priorEvents = events.filter((event) => !recordEventIds.has(event.id)).slice(-3);
        const recentEvents = priorEvents.length
        ? priorEvents.map((event) => `- ${event.date || "undated"}: ${event.title}`)
        : "(none)";

        return {
            kind: "turn-fallback",
            title: "AI turn fell back",
            fields: [
                ["Failure reason", record.fallbackReason || "(unknown)"],
                ["Mode", record.mode],
                ["Requested range", `${record.fromDate || "unknown"} -> ${record.toDate || "unknown"}`],
                ["Round", String(record.round ?? "")],
                ["Player's queued actions this round", actionsList],
                ["Most recent prior events", recentEvents],
                [
                    // A transport failure has no response to show, so do not label
                    // the note that explains that as one — it sent readers hunting
                    // for a parsing bug when the real cause was the provider config.
                    record.rawResponse === NO_RESPONSE_BODY_NOTE
                        ? "Model response"
                        : "Raw model response that was rejected (failed to parse or to validate)",
                    // Every fallback now fills this in — with the raw text when
                    // there was one, or with a note saying no response body arrived
                    // (gameplay.js). So an empty field can only be a turn recorded
                    // before that, and this line must not claim to know which
                    // failure it was.
                    record.rawResponse || "(not captured — recorded by an older build that only saved the failure reason; re-run the turn to capture the response, or the note explaining that none arrived)",
                ],
            ],
        };
    };
    const rawGameDate = gameData?.gameDate || gameData?.startDate || "";
    // Any game date, BC included ("March 1st, 218 BC"); prose dates show verbatim.
    const hasValidGameDate = isGameDate(rawGameDate);
    // Mobile shares the row with the country name, so abbreviate the month.
    const displayDate = !gameData
    ? "Loading..."
    : hasValidGameDate
    ? formatGameDateReadable(rawGameDate, isMobile && playerCountry ? "MMM Do, YYYY" : "MMMM Do, YYYY")
    : String(rawGameDate).trim() || "Undated";
    const currentDate = hasValidGameDate
    ? normalizeGameDate(rawGameDate)
    : dayjs().format("YYYY-MM-DD");

    // Readable by the async turn handlers, which close over the render that made
    // them while a skip outlives a great many renders.
    const visibleEventCountRef = React.useRef(1);
    const streamedEventsRef = React.useRef([]);
    useEffect(() => { visibleEventCountRef.current = visibleEventCount; }, [visibleEventCount]);
    useEffect(() => { streamedEventsRef.current = streamedEvents; }, [streamedEvents]);
    // Set the moment a watched skip lands, read once by the effect below.
    const revealCarryRef = React.useRef(null);
    const carryLiveReveal = () => {
        const streamed = streamedEventsRef.current;
        if (!streamed.length) {
            revealCarryRef.current = null;
            return;
        }
        const revealed = Math.min(Math.max(1, visibleEventCountRef.current), streamed.length);
        revealCarryRef.current = {
            revealed,
            streamed: streamed.length,
            // Which events were uncovered, not how many: the engine can drop one
            // and write a scripted beat in above it, so counting would restore a
            // different stretch of the round than the player walked through.
            keys: streamed.slice(0, revealed).map((event) => eventDisclosureKey(event)).filter(Boolean),
        };
    };

    // The last written turn's count, not the panel's, which mid-skip is the turn
    // being written.
    const writtenEventCount = latestTurnRecord?.events?.length || 0;

    // Where the reveal stands for the newest written turn (runtime/unseenEvents.js):
    // a skip that just landed shows its first event, a reload resumes where the
    // player was, and a turn with nothing unseen is shown whole. A failed or
    // cancelled skip comes back through here, which restores the previous reveal.
    useEffect(() => {
        // Mid-skip the reveal belongs to the turn being written, and the written
        // turn is the one before it.
        if (skipInFlight) return;
        const ids = (latestTurnRecord?.events ?? []).map((event) => event?.id).filter(Boolean);
        const carried = revealCarryRef.current;
        revealCarryRef.current = null;
        // Except for the turn just watched being written: making the player press
        // "Next event" back to where they were is the jolt this exists to avoid.
        if (carried && ids.length) {
            // The furthest event they reached, found again. Everything before it
            // stays walked past, including a beat the engine wrote in among them.
            const written = latestTurnRecord?.events ?? [];
            const wanted = new Set(carried.keys);
            let furthest = -1;
            written.forEach((event, index) => {
                if (wanted.has(eventDisclosureKey(event))) furthest = index;
            });
            // None of them survived, so this is not the round they were reading:
            // carrying the count would uncover a turn they have never seen.
            const keep = Math.min(ids.length, furthest >= 0 ? furthest + 1 : 1);
            unseenEvents.markSeenThrough(ids, keep);
            setVisibleEventCount(keep);
            // The engine screens the payload and the curator drops events, so a
            // skip can honestly end with fewer cards than were watched arriving.
            // That reads as a bug unless the log says it happened, and by how much.
            if (carried.streamed !== ids.length) {
                logDebugEvent("turn", `Live skip: ${carried.streamed} event(s) were written on screen, ${ids.length} survived the engine's checks.`, {
                    streamed: carried.streamed,
                    written: ids.length,
                    revealed: keep,
                });
            }
            return;
        }
        setVisibleEventCount(Math.max(1, ids.length - unseenEvents.unseenInTurn(ids).size));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [latestTurnRecord?.id, writtenEventCount, skipInFlight]);

    // Half of what the camera needs to turn the names an event carries
    // ("Ireland", "Donetsk") into a place on the map: the half that only moves
    // when the map data itself does.
    const focusCatalog = useMemo(() => buildPlaceCatalog({
        countries: countryCatalog,
        countryBounds,
        regionBounds,
        regions: regionCatalog,
    }), [countryBounds, countryCatalog, regionBounds, regionCatalog]);

    // The other half is the live world (era polities, who owns what), which the
    // store replaces wholesale. Reading it through a ref keeps a world update
    // from re-running the camera effect, which would re-fly to the event already
    // on screen, and the finished context is cached so it is rebuilt only when
    // an event is actually revealed against a newer world.
    const focusWorldRef = React.useRef(null);
    const focusContextRef = React.useRef({ catalog: null, context: null, world: null });

    useEffect(() => {
        focusWorldRef.current = worldState;
    }, [worldState]);

    // The cached context, rebuilt only when the catalog or the world moved on.
    // Shared by the camera below and the event cards' links.
    // The map's own region records come in when its worker has read the
    // geometry — after this panel mounted — and on a drawn map they are the only
    // frames there are, so their arrival re-derives the cards' links.
    const [primedRegionsVersion, setPrimedRegionsVersion] = useState(0);
    useEffect(() => {
        const bump = () => setPrimedRegionsVersion((version) => version + 1);
        window.addEventListener("oh:region-catalog-primed", bump);
        return () => window.removeEventListener("oh:region-catalog-primed", bump);
    }, []);

    const currentFocusContext = useCallback(() => {
        const world = focusWorldRef.current;
        const drawn = getPrimedScenarioRegionCatalog();
        const cached = focusContextRef.current;
        if (cached.catalog !== focusCatalog || cached.world !== world || cached.drawn !== drawn || !cached.context) {
            focusContextRef.current = {
                catalog: focusCatalog,
                context: buildFocusContext({ catalog: focusCatalog, world, drawnRegions: drawn }),
                drawn,
                world,
            };
        }
        return focusContextRef.current.context;
        // primedRegionsVersion is not read: it is what makes the cards ask again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusCatalog, primedRegionsVersion]);

    // What each event is about, as chips on its card that fly the map there
    // (eventFocus.js deriveEventLinks). Re-derived once the map data has loaded,
    // since currentFocusContext changes with the catalog.
    // And the documents that reached the player with the event itself — a
    // published text, or a paper only the player's government holds
    // (runtime/reportDelivery.js). A letter came through diplomacy and a stolen
    // copy through an agent; the card shows neither.
    const documentReports = worldState?.reports;
    const documentPlayer = gameData?.country;
    const cardLookups = useMemo(() => ({
        ...lookups,
        eventLinks: (event) => deriveEventLinks(event, currentFocusContext(), {
            unitName: (id) => getUnitById(id)?.name || "",
        }),
        focusLink: (bounds) => focusMapOnBounds(mapRef, bounds),
        eventDocuments: (event) => documentsForEvent(documentReports, event?.id, documentPlayer),
    }), [lookups, currentFocusContext, mapRef, documentReports, documentPlayer]);

    // The camera follows EVERY revealed event — impacts pin the exact spot,
    // otherwise the polities the event involves do, and its own words are the
    // last resort. Opt out via the "Disable camera movement during events" map
    // setting.
    useEffect(() => {
        if (!activeVisibleEvent || disableEventCamera) {
            return;
        }

        try {
            focusMapOnBounds(mapRef, deriveEventFocusBounds(activeVisibleEvent, currentFocusContext()));
        } catch (error) {
            // Unvalidated impacts, so this can fail where a written turn's never does.
            console.warn("[OH event camera] could not place this event; the camera stays put.", error);
        }
    }, [activeVisibleEvent, disableEventCamera, currentFocusContext, mapRef]);

    // Each step of the reveal is remembered (runtime/unseenEvents.js): what it
    // uncovers may now be shown everywhere — the thread an event opened, the copy
    // an agent stole in it — and the advisor and the leaders may speak of it.
    // Empty while a skip is in flight: the streamed events are not in the record
    // yet, and the ids of the turn BEFORE this one must never be marked seen by
    // a reveal that is walking through the turn after it.
    const turnEventIdsInOrder = () => (liveTurnRecord
        ? []
        : (latestTurnRecord?.events ?? []).map((event) => event?.id).filter(Boolean));
    const revealNextEvent = () => {
        if (!totalVisibleEvents) {
            setVisibleEventCount(1);
            return;
        }
        const next = Math.min(totalVisibleEvents, visibleEventCount + 1);
        setVisibleEventCount(next);
        unseenEvents.markSeenThrough(turnEventIdsInOrder(), next);
    };

    // Skip the remaining reveals: the map snaps to the final post-jump state.
    // This is also the interrupt — non-destructive, every event stays in
    // history; it only fast-forwards the presentation.
    const revealAllEvents = () => {
        if (totalVisibleEvents) {
            setVisibleEventCount(totalVisibleEvents);
            unseenEvents.markSeenThrough(turnEventIdsInOrder(), totalVisibleEvents);
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
        // Not mid-skip: the snapshot that would load belongs to the turn before.
        if (skipInFlight || openPanel !== "history" || !record || !(record.events?.length > 0)) {
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
    }, [latestTurnRecord?.id, openPanel, skipInFlight, stagedBase.recordId]);

    useEffect(() => {
        // No snapshot needed while the skip writes: the world has not moved, so
        // it is already the pre-jump base. Without this the map sits still all
        // round, since the reveal now happens during the skip and the turn lands
        // fully revealed, the one state the staging below never covers.
        if (liveTurnRecord) {
            const revealedLive = liveTurnRecord.events.slice(0, Math.max(1, visibleEventCount));
            if (openPanel === "history" && liveStageBase && revealedLive.length) {
                try {
                    const { world: livePreview } = applyEventImpactsToWorld({
                        colors: {},
                        events: revealedLive,
                        motion: { originDate: liveTurnRecord.fromDate || "", round: liveTurnRecord.round || 0, tick: 0 },
                        world: liveStageBase,
                    });
                    setWorldStateOverride(livePreview);
                    setUnitsOverride(livePreview.units ?? []);
                    return;
                } catch (error) {
                    // Unvalidated impacts again: the map waits rather than taking the panel.
                    console.warn("[OH staged reveal] the live preview could not be applied; the map waits for the turn.", error);
                }
            }
            setWorldStateOverride(null);
            setUnitsOverride(null);
            return;
        }
        const record = latestTurnRecord;
        const stagingActive =
            !skipInFlight &&
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
            // Same motion the persisted turn used (applySimulationResult), or the
            // reveal would show units teleporting to positions the saved world
            // never had. The residual advance past the last event is not replayed
            // here — the reveal is a partial state by definition, and the map's
            // position tween absorbs the difference when the override clears.
            //
            // "Same as the persisted turn" is the whole point, so this mirrors
            // applySimulationResult's motion exactly.
            motion: {
                originDate: record.fromDate || "",
                round: record.round || 0,
                tick: 0,
            },
            world: stagedBase.world,
        });
        setWorldStateOverride(stagedWorld);
        setUnitsOverride(stagedWorld.units ?? []);
    }, [latestTurnRecord, liveStageBase, liveTurnRecord, openPanel, skipInFlight, stagedBase, totalVisibleEvents, visibleEventCount]);

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
        isRetryingProjects={isRetryingProjects}
        isRetryingSegment={isRetryingSegment}
        modeSuggestion={modeSuggestion}
        onAcceptModeSuggestion={acceptModeSuggestion}
        onAutoJump={() => runJump(365, "auto")}
        onCancel={cancelJump}
        onClose={() => setPanel(null)}
        onDeclineModeSuggestion={declineModeSuggestion}
        onDiscardProjects={discardHeldProjects}
        onDiscardSegment={discardHeldSegment}
        onJump={(days) => runJump(days, "jump")}
        onRetryProjects={retryHeldProjects}
        onRetrySegment={retryHeldSegment}
        onUndo={runUndo}
        offeredInteractive={skipInFlight ? null : shownOffer}
        progressLabel={jumpProgress}
        projectsHeld={projectsHeld}
        projectsRetries={projectsRetries}
        sceneInProgress={sceneInProgress}
        segmentHeld={segmentHeld}
        segmentRetries={segmentRetries}
        topOffset={topOffset}
        undoCount={undoCount}
        />
        <TimelineHistoryPanel
        isOpen={openPanel === "history"}
        onRevealNextEvent={revealNextEvent}
        onRevealAll={revealAllEvents}
        lookups={cardLookups}
        onClose={() => setPanel(null)}
        buildDebugIncident={buildFallbackIncident}
        // A fallback turn is usually a turn the player wants gone; the undo it
        // needs already exists over in the Timeline panel, so this just saves
        // the trip. Same restore point, same code path.
        // Nothing is written mid-skip, so there is no turn to roll back and no round to stop.
        canRollbackTurn={undoCount > 0 && !isLoading && !skipInFlight}
        onRollbackTurn={() => runUndo({ stayOnHistory: true })}
        canIntervene={canInterveneTurn && undoCount > 0 && !isLoading && !skipInFlight}
        onIntervene={runIntervene}
        // The last written turn's offer, never on a skip still being written:
        // that skip replaces it.
        offeredInteractiveId={!skipInFlight && shownOffer ? shownOffer.id : ""}
        live={Boolean(liveTurnRecord)}
        progress={skipInFlight ? { label: jumpProgress, onCancel: cancelJump } : null}
        record={displayRecord}
        topOffset={topOffset}
        visibleEventCount={visibleEventCount}
        openMapChanges={openMapChanges}
        onToggleMapChanges={toggleMapChanges}
        warning={fallbackWarning || persistedFallbackWarning}
        />

        <div
        style={{
            ...widgetSurface,
            ...dockStyle,
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
            color: openPanel === "skip" ? "#e4e4e7" : buttonStyle.color,
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
        {isLoading ? <SpinnerRing size={15} tone="rgba(255,255,255,0.28)" /> : "\u00BB"}
        </button>
        </div>
        </>
    );
};

export { DateWidget };
