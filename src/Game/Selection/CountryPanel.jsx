/*! Open Historia — country info panel © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { createPortal } from "react-dom";
import Markdown, { MarkdownStyleInjector } from "../GameUI/markdown.jsx";
import { JSON_URLS, getNationFlags, getNationTags, loadRegionCatalog, loadScenarioRegionCatalog } from "../../runtime/assets.js";
import { resolveCountryTags } from "../../runtime/countryTags.js";
import {
    briefingCacheKey,
    classifyPolityRegions,
    createBriefingCache,
    createEventMatcher,
    knownPolityNames,
    resolvePanelPolity,
    sortEventsNewestFirst,
} from "../../runtime/countryInfoPanel.js";
import { readEventsState, readGameData, readWorldStateView } from "../../runtime/gameState.js";
import { getStoredLanguage } from "../../runtime/i18n.js";
import { getLibraryState } from "../../runtime/library.js";
import { onMemoryPressure } from "../../runtime/memoryPressure.js";
import { puppetSummaryFor } from "../../runtime/puppets.js";
import { requestDiplomaticChat } from "../GameUI/chat.jsx";
import GameFlagPicker from "../GameUI/GameFlagPicker.jsx";
import { getWorldStateSnapshot, useWorldState } from "../Map/useWorldState.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { generateCountryStats } from "../AI/gameplayLazy.js";
import { createReportRequests } from "./reportRequests.js";

// Bridge: the region popup's info button opens this panel from outside React.
let _openPanel = null;

// Advisor Reports by campaign and country, outside the panel: the panel is
// pointed at one country after another while a report is still being written
// (reportRequests.js). Keyed by briefingKeyFor below.
const advisorReports = createReportRequests();
const reportFromOutcome = (outcome) => (outcome.error
    ? { error: outcome.error?.message || "Couldn't generate a report. Set an AI provider + key in Settings." }
    : (outcome.text || "No information available."));

export const openCountryPanel = (country) => {
    _openPanel?.(country);
};

// The card's Stats button: main.jsx opens the Country drawer on this polity
// (detail.country). The drawer only followed map clicks while it was open, and
// on a phone it covers the map, so it could show nothing but the player's own
// country.
export const OPEN_COUNTRY_STATS_EVENT = "oh:open-country-stats";

const FILTER_MODES = [
    { id: "all", label: "All" },
    { id: "major", label: "Major" },
    { id: "minor", label: "Minor" },
];

const surface = {
    backgroundColor: "rgba(24, 24, 27, 0.97)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "16px",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.45)",
    color: "white",
    fontFamily: "sans-serif",
};

// On a phone the panel is the whole screen, inset like the card it is. Docked
// under the date bar it left the date bar (and, when short, the toolbar)
// showing, and the timeline or chat they opened (9998) came up underneath it.
// It sits at 10039, under the phone advisor sheet and the API-setup prompt
// (10040), where desktop's 10042 would cover them: whatever opens one of those
// while the panel is showing expects it on top. The reverse cannot happen: the
// panel opens only from the map's region card, which both of them cover.
const PHONE_PLACEMENT = {
    top: `calc(0.5rem + ${SAFE_TOP})`,
    bottom: `calc(0.5rem + ${SAFE_BOTTOM})`,
    left: `calc(0.5rem + ${SAFE_LEFT})`,
    right: `calc(0.5rem + ${SAFE_RIGHT})`,
    width: "auto",
    maxHeight: "none",
    zIndex: 10039,
};

const pillStyle = {
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: "999px",
    color: "rgba(255,255,255,0.92)",
    display: "inline-block",
    fontSize: "0.74rem",
    fontWeight: 600,
    padding: "0.22rem 0.6rem",
};

const footerButtonStyle = {
    alignItems: "center",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: "999px",
    color: "white",
    cursor: "pointer",
    display: "flex",
    flex: 1,
    fontSize: "0.88rem",
    fontWeight: 700,
    justifyContent: "center",
    padding: "0.7rem 0.9rem",
};

// Related Events shows this many more at a time; the region lists start with
// this many pills and open in place.
const EVENT_STEP = 30;
const SOVEREIGN_PILLS = 80;
const OTHER_PILLS = 40;

// The Advisor Reports this session has paid for, one per polity per round
// (runtime/countryInfoPanel.js); the ones still being written are in
// advisorReports, so a second press or a reopened panel waits for the same
// request.
const briefings = createBriefingCache();
if (typeof window !== "undefined") {
    window.addEventListener("oh:active-game-changed", () => briefings.clear());
}
onMemoryPressure(() => briefings.clear());

// Shows a briefing request's answer, unless the panel has moved on to
// another country or round by the time it arrives: it is then kept for when
// that country is opened again.
const showBriefing = (key, request, shownKey, setReport) => {
    shownKey.current = key;
    setReport("loading");
    request
        .then((text) => ({ text }), (error) => ({ error }))
        .then((outcome) => {
            if (shownKey.current !== key) {
                advisorReports.keep(key, outcome);
                return;
            }
            setReport(reportFromOutcome(outcome));
        });
};

const RegionPills = ({ names, limit, expanded, onExpand }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
    {(expanded ? names : names.slice(0, limit)).map((regionName) => (
        <span key={regionName} style={pillStyle}>{regionName}</span>
    ))}
    {!expanded && names.length > limit && (
        <button type="button" className="oh-tap" onClick={onExpand} style={{ ...pillStyle, background: "none", cursor: "pointer", fontFamily: "inherit", opacity: 0.6 }}>
        {`+${names.length - limit} more`}
        </button>
    )}
    </div>
);

const CountryInfoPanel = () => {
    const isMobile = useIsMobile();
    const [country, setCountry] = useState(null); // { code, name, flagUrl, flagEmoji }
    // What the panel read for `country` when it opened; null while it reads,
    // so nothing of the previous country is ever shown under this one's name.
    const [loaded, setLoaded] = useState(null);
    const [search, setSearch] = useState("");
    const [filterIndex, setFilterIndex] = useState(0);
    const [eventLimit, setEventLimit] = useState(EVENT_STEP);
    const [expandedLists, setExpandedLists] = useState({});
    const [report, setReport] = useState(null); // null | "loading" | text | {error}
    const [flagFailed, setFlagFailed] = useState(false);
    const [flagCatalog, setFlagCatalog] = useState({});
    const [flagPickerOpen, setFlagPickerOpen] = useState(false);
    const [worldWrites, setWorldWrites] = useState(0);
    // The briefing the report box is for; "" until one is shown or asked for.
    // A report only ever lands on its own country.
    const shownReportKey = useRef("");
    useEffect(() => {
        if (!country) shownReportKey.current = "";
    }, [country]);
    // The panel goes with the map on a switch to another save: a report still
    // being written is then kept for when its campaign and country are open
    // again, not handed to a panel that is gone.
    useEffect(() => () => {
        shownReportKey.current = "";
    }, []);
    // The map's world store. During a turn's staged reveal it holds the world
    // the map is showing, not the saved one the reveal is heading towards, so
    // the panel never tells the player what the map has not shown yet.
    const mapState = useWorldState();

    _openPanel = (next) => {
        // A fresh object, so reopening the same country reads it again.
        setCountry(next ? { ...next } : null);
        setLoaded(null);
        setSearch("");
        setFilterIndex(0);
        setEventLimit(EVENT_STEP);
        setExpandedLists({});
        setReport(null);
        shownReportKey.current = "";
        setFlagFailed(false);
        setFlagPickerOpen(false);
    };

    useEffect(() => {
        if (!country) return undefined;
        let cancelled = false;

        (async () => {
            // The map's live world when it has one. Only before the map has
            // loaded is the saved world read, as the shared read-only view.
            const snapshot = getWorldStateSnapshot();
            const [allEvents, savedWorld, drawnCatalog, baseTags, flags, game] = await Promise.all([
                readEventsState().catch(() => []),
                snapshot ? null : readWorldStateView().catch(() => null),
                loadScenarioRegionCatalog().catch(() => []),
                getNationTags().catch(() => ({})),
                getNationFlags().catch(() => ({})),
                readGameData().catch(() => ({})),
            ]);
            // The catalog Stats counts territory from: the rendered map's own
            // regions, and the merged stock catalog only when it draws none.
            const drawn = Array.isArray(drawnCatalog) && drawnCatalog.length > 0;
            const catalog = drawn ? drawnCatalog : await loadRegionCatalog().catch(() => []);
            if (cancelled) return;
            setFlagCatalog(flags || {});
            setLoaded({
                country,
                allEvents: allEvents ?? [],
                savedWorld,
                catalog: catalog ?? [],
                drawn,
                baseTags: baseTags || {},
                game: game || {},
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [country]);

    // While the panel is open it follows the game: a write the map store does
    // not republish (tags, aliases) still re-reads the live world, and a new
    // event log or round is picked up from the cache the write primed.
    useEffect(() => {
        if (!country || typeof window === "undefined") return undefined;
        let cancelled = false;
        const onWorldUpdated = () => setWorldWrites((count) => count + 1);
        const onJsonUpdated = (event) => {
            const url = event?.detail?.url;
            const read = url === JSON_URLS.events
                ? readEventsState().then((allEvents) => ({ allEvents: allEvents ?? [] }))
                : url === JSON_URLS.game
                    ? readGameData().then((game) => ({ game: game || {} }))
                    : null;
            read?.then((patch) => {
                if (!cancelled) setLoaded((current) => (current?.country === country ? { ...current, ...patch } : current));
            }).catch(() => {});
        };
        window.addEventListener("oh:world-updated", onWorldUpdated);
        window.addEventListener("oh:runtime-json-updated", onJsonUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:world-updated", onWorldUpdated);
            window.removeEventListener("oh:runtime-json-updated", onJsonUpdated);
        };
    }, [country]);

    const ready = Boolean(country && loaded?.country === country);
    const worldState = useMemo(
        () => (ready ? getWorldStateSnapshot() || loaded.savedWorld || {} : null),
        // The snapshot is re-read whenever the map store publishes or the world is written.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ready, loaded, mapState.worldState, worldWrites],
    );
    const identity = useMemo(() => (worldState ? resolvePanelPolity(country, worldState) : null), [country, worldState]);
    const polityKey = identity?.stableKey || "";
    const displayName = identity?.currentName || country?.name || "";
    const playerCountry = ready ? loaded.game?.country || "" : "";
    const aliases = useMemo(() => (Array.isArray(identity?.polity?.aliases) ? identity.polity.aliases : []), [identity]);
    // The author's starting tags unless the AI has since rewritten them.
    const tags = useMemo(
        () => (identity ? resolveCountryTags(loaded.baseTags, worldState, identity.stableKey) : []),
        [identity, loaded, worldState],
    );
    const regionLists = useMemo(
        () => classifyPolityRegions({
            catalog: identity ? loaded.catalog : [],
            world: worldState ?? {},
            polityKey,
            includeUncatalogued: Boolean(loaded) && !loaded.drawn,
        }),
        [identity, loaded, worldState, polityKey],
    );
    const regions = regionLists.sovereign;
    const controlledForeignRegions = regionLists.controlledForeign;
    const occupiedSovereignRegions = regionLists.occupiedSovereign;
    // The log is stored oldest first; the panel leads with what just happened.
    const events = useMemo(() => {
        if (!identity) return [];
        const involves = createEventMatcher({
            key: identity.stableKey,
            name: identity.currentName,
            aliases,
            knownNames: knownPolityNames(worldState),
        });
        return sortEventsNewestFirst(loaded.allEvents.filter(involves));
    }, [identity, aliases, loaded, worldState]);

    // The campaign, polity, round and prompt languages a briefing answers for.
    // The prompt names the save's language ("Respond in ...") and callAI adds
    // the player's UI language (languageDirective), so a change to either asks
    // afresh.
    const briefingKeyFor = (game) => briefingCacheKey({
        gameId: getLibraryState()?.activeGameId ?? "",
        polity: polityKey || country?.code,
        date: game?.date,
        round: game?.round,
        language: `${getStoredLanguage()}/${worldState?.language || game?.language || "English"}`,
    });
    const reportKey = identity ? briefingKeyFor(loaded.game) : "";

    // Reopened in the same round: the briefing already paid for, or the one
    // still on its way, instead of an empty box and a second request. A report
    // still being written for this country is joined, and one that came back
    // while another country was shown is handed over.
    useEffect(() => {
        if (!reportKey || shownReportKey.current) return;
        const pending = advisorReports.pending(reportKey);
        if (pending) {
            showBriefing(reportKey, pending, shownReportKey, setReport);
            return;
        }
        const kept = advisorReports.take(reportKey);
        const cached = briefings.get(reportKey);
        if (kept || cached !== undefined) {
            shownReportKey.current = reportKey;
            setReport(kept ? reportFromOutcome(kept) : cached);
        }
    }, [reportKey]);

    useEffect(() => {
        if (!country) return;
        let cancelled = false;
        const refresh = () => {
            // flags.json is invalidated and announced by the asset writer, so
            // the memoized catalog is already the new one.
            getNationFlags()
                .then((flags) => {
                    if (!cancelled) {
                        setFlagCatalog(flags || {});
                        setFlagFailed(false);
                    }
                })
                .catch(() => {});
        };
        window.addEventListener("oh:flags-updated", refresh);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:flags-updated", refresh);
        };
    }, [country]);

    // What this viewer may see of this country's subordination, and nothing more.
    // The answer comes from runtime/puppets.js because the map overlay, the
    // diplomacy markers and the advisor's prompt all have to give the same one.
    //
    // A covert arrangement the player has not discovered renders NOTHING here -
    // not a locked row, not a greyed-out line. A disabled control would announce
    // the existence of the secret it is keeping.
    const subordination = useMemo(
        () => puppetSummaryFor(worldState, playerCountry, displayName || country?.name || ""),
        [worldState, playerCountry, displayName, country],
    );

    const filteredEvents = useMemo(() => {
        const mode = FILTER_MODES[filterIndex].id;
        const query = search.trim().toLowerCase();
        return events.filter((event) => {
            if (mode !== "all" && String(event.importance).toLowerCase() !== mode) return false;
            if (query && !`${event.title} ${event.description}`.toLowerCase().includes(query)) return false;
            return true;
        });
    }, [events, filterIndex, search]);

    // Back on a phone closes the flag picker, then the panel
    // (runtime/backToClose.js). The picker only renders once the world is read.
    useBackToClose(Boolean(country), () => setCountry(null));
    useBackToClose(Boolean(country && worldState) && flagPickerOpen, () => setFlagPickerOpen(false));

    if (!country) return null;

    const currentFlag = resolvePolityFlag({
        polity: { polityKey, name: displayName || country.name, code: country.code },
        world: worldState,
        flags: flagCatalog,
    });

    // A briefing on screen makes the button "Regenerate Report": a new request
    // is then the player's deliberate choice, and replaces the kept one.
    const hasReport = typeof report === "string" && report !== "loading";

    const runAdvisorReport = async () => {
        if (report === "loading" || !ready) return;
        const game = await readGameData().catch(() => loaded.game);
        const key = briefingKeyFor(game);
        // Joins a report already being written for this country rather than
        // asking again.
        const request = advisorReports.request(key, () =>
            generateCountryStats({ code: polityKey || country.code, name: displayName || country.name })
                .then((raw) => {
                    const text = String(raw || "").trim();
                    if (text) briefings.set(key, text);
                    return text;
                }));
        showBriefing(key, request, shownReportKey, setReport);
    };

    const openStats = () => {
        const target = polityKey || country.polityKey || country.name || country.code;
        if (!target) return;
        window.dispatchEvent(new CustomEvent(OPEN_COUNTRY_STATS_EVENT, { detail: { country: target } }));
        setCountry(null);
    };

    const openDiplomacy = () => {
        requestDiplomaticChat({
            name: displayName || country.name,
            code: country.code,
            polityKey: polityKey || country.polityKey || "",
        });
        setCountry(null);
    };

    return createPortal(
        <div
        style={{
            ...surface,
            display: "flex",
            flexDirection: "column",
            maxHeight: `calc(${APP_HEIGHT} - 5.75rem)`,
            overflow: "hidden",
            position: "fixed",
            right: "0.5rem",
            top: "4.75rem",
            width: "min(28rem, calc(100vw - 1rem))",
            zIndex: 10042,
            ...(isMobile ? PHONE_PLACEMENT : null),
        }}
        >
        {/* Header */}
        <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", padding: "1rem 1.1rem 0.8rem" }}>
        {currentFlag.imageUrl && !flagFailed ? (
            <button type="button" onClick={() => setFlagPickerOpen(true)} title="Change flag" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}>
                <img src={currentFlag.imageUrl} alt="" onError={() => setFlagFailed(true)} style={{ borderRadius: 4, height: "1.35rem", width: "2.1rem", objectFit: "cover", boxShadow: "0 0 0 1px rgba(255,255,255,0.15)" }} />
            </button>
        ) : (
            <button type="button" onClick={() => setFlagPickerOpen(true)} title="Set flag" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, height: "1.35rem", width: "2.1rem", cursor: "pointer" }} />
        )}
        <span style={{ flex: 1, fontSize: "1.15rem", fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {displayName || country.name}
        </span>
        <button type="button" className="oh-tap" onClick={() => setFlagPickerOpen(true)} title="Change flag" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, color: "rgba(255,255,255,0.72)", cursor: "pointer", fontSize: "0.68rem", fontWeight: 700, padding: "0.3rem 0.45rem" }}>Flag</button>
        <button
        type="button"
        className="oh-tap"
        aria-label="Close country panel"
        onClick={() => setCountry(null)}
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "1.15rem", lineHeight: 1, padding: "0.2rem" }}
        >
        {"✕"}
        </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.4rem", minHeight: 0, overflowY: "auto", padding: "0 1.1rem 1rem", scrollbarWidth: "thin" }}>
        <div style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800 }}>Related Events</div>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.75rem" }}>
        {filteredEvents.length > eventLimit ? `${eventLimit} of ${filteredEvents.length} shown` : `${filteredEvents.length} shown`}
        </div>
        </div>
        <div style={{ display: "flex", gap: "0.45rem" }}>
        <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search events..."
        style={{ background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "white", flex: 1, fontSize: "0.82rem", outline: "none", padding: "0.55rem 0.7rem" }}
        />
        <button
        type="button"
        className="oh-tap-row"
        onClick={() => setFilterIndex((filterIndex + 1) % FILTER_MODES.length)}
        title="Filter by importance"
        style={{ ...footerButtonStyle, borderRadius: 8, flex: "none", fontSize: "0.78rem", padding: "0.45rem 0.7rem" }}
        >
        {"ⱶ"} {FILTER_MODES[filterIndex].id === "all" ? "Filters" : FILTER_MODES[filterIndex].label}
        </button>
        </div>

        {!ready ? (
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem", padding: "0.3rem 0 0.4rem" }}>
            Loading...
            </div>
        ) : filteredEvents.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem", padding: "0.3rem 0 0.4rem" }}>
            No events found for this country.
            </div>
        ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", padding: "0.2rem 0 0.4rem" }}>
            {filteredEvents.slice(0, eventLimit).map((event) => (
                <div key={event.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.55rem 0.7rem" }}>
                <div style={{ alignItems: "baseline", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{event.title}</span>
                <span style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0, fontSize: "0.68rem" }}>{event.date}</span>
                </div>
                {event.description && (
                    <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.74rem", lineHeight: 1.5, marginTop: "0.2rem" }}>
                    {String(event.description).length > 220 ? `${String(event.description).slice(0, 220)}…` : event.description}
                    </div>
                )}
                </div>
            ))}
            {filteredEvents.length > eventLimit && (
                <button
                type="button"
                className="oh-tap-row"
                onClick={() => setEventLimit((limit) => limit + EVENT_STEP)}
                style={{ ...footerButtonStyle, borderRadius: 8, fontSize: "0.78rem", padding: "0.45rem 0.7rem" }}
                >
                Show more events
                </button>
            )}
            </div>
        )}

        {subordination && (
            <div
                style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.13)",
                    borderLeft: "2px solid rgba(255,255,255,0.3)",
                    borderRadius: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.45rem",
                    marginTop: "0.5rem",
                    padding: "0.65rem 0.8rem",
                }}
            >
                <span style={{ fontSize: "0.9rem", fontWeight: 800, letterSpacing: "0.01em" }}>{subordination.headline}</span>
                <div style={{ color: "rgba(255,255,255,0.86)", fontSize: "0.78rem", lineHeight: 1.45 }}>{subordination.meaning}</div>
                {subordination.facts.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                        {subordination.facts.map((fact) => (
                            <span
                                key={fact}
                                style={{
                                    background: "rgba(0,0,0,0.22)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: 999,
                                    color: "rgba(255,255,255,0.7)",
                                    fontSize: "0.68rem",
                                    padding: "0.12rem 0.45rem",
                                    whiteSpace: "nowrap",
                                }}
                            >{fact}</span>
                        ))}
                    </div>
                )}
                {subordination.provenance && (
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.7rem", fontStyle: "italic" }}>
                        {subordination.provenance}
                    </div>
                )}
            </div>
        )}

        {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.5rem" }}>
            {tags.map((tag) => (
                <span
                    key={tag}
                    style={{ ...pillStyle, background: "rgba(255,255,255,0.11)", borderColor: "rgba(255,255,255,0.25)" }}
                    title="What this country is — the map-maker set this, and the AI reads it as context"
                >
                    {tag}
                </span>
            ))}
            </div>
        )}

        <div style={{ fontSize: "1rem", fontWeight: 800, marginTop: "0.5rem" }}>Details</div>
        {/* One column on a phone: side by side, the first list got about 130 px
            and a long name wrapped over three lines. */}
        <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
        <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.35rem" }}>Alternative Names</div>
        {aliases.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.78rem" }}>None</div>
        ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {aliases.map((alias) => (
                <span key={alias} style={pillStyle}>{alias}</span>
            ))}
            </div>
        )}
        </div>
        <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.35rem" }}>Sovereign Regions ({regions.length})</div>
        {regions.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.78rem" }}>None</div>
        ) : (
            <RegionPills
            names={regions}
            limit={SOVEREIGN_PILLS}
            expanded={Boolean(expandedLists.sovereign)}
            onExpand={() => setExpandedLists((current) => ({ ...current, sovereign: true }))}
            />
        )}
        </div>
        </div>

        {(controlledForeignRegions.length > 0 || occupiedSovereignRegions.length > 0) && (
            <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", marginTop: "0.45rem" }}>
            <div>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>Controlled, Not Sovereign ({controlledForeignRegions.length})</div>
            {controlledForeignRegions.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.76rem" }}>None</div>
            ) : (
                <RegionPills
                names={controlledForeignRegions}
                limit={OTHER_PILLS}
                expanded={Boolean(expandedLists.controlled)}
                onExpand={() => setExpandedLists((current) => ({ ...current, controlled: true }))}
                />
            )}
            </div>
            <div>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>Under Foreign Control ({occupiedSovereignRegions.length})</div>
            {occupiedSovereignRegions.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.76rem" }}>None</div>
            ) : (
                <RegionPills
                names={occupiedSovereignRegions}
                limit={OTHER_PILLS}
                expanded={Boolean(expandedLists.occupied)}
                onExpand={() => setExpandedLists((current) => ({ ...current, occupied: true }))}
                />
            )}
            </div>
            </div>
        )}

        {report !== null && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, marginTop: "0.6rem", padding: "0.7rem 0.8rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.3rem" }}>Advisor Report</div>
            {report === "loading" ? (
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem" }}>Preparing the report…</div>
            ) : report?.error ? (
                <div style={{ color: "#f87171", fontSize: "0.78rem" }}>{report.error}</div>
            ) : (
                // The shared renderer (markdown.jsx): a table or a <br> in the
                // model's report reads as one, not as pipes and a literal tag.
                <>
                <MarkdownStyleInjector />
                <Markdown bare className="timeline-markdown" style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.79rem", lineHeight: 1.55 }}>
                {String(report)}
                </Markdown>
                </>
            )}
            </div>
        )}
        </div>

        {/* Footer */}
        {/* Three buttons wrap onto two lines on a narrow phone rather than squeezing their words. */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexWrap: "wrap", gap: "0.6rem", padding: "0.8rem 1.1rem" }}>
        <button type="button" className="oh-tap-row" onClick={runAdvisorReport} style={{ ...footerButtonStyle, flex: "1 1 auto", whiteSpace: "nowrap" }}>
        {hasReport ? "Regenerate Report" : "Advisor Report"}
        </button>
        <button type="button" className="oh-tap-row" onClick={openStats} style={{ ...footerButtonStyle, flex: "1 1 auto", whiteSpace: "nowrap" }}>
        Stats
        </button>
        <button type="button" className="oh-tap-row" onClick={openDiplomacy} style={{ ...footerButtonStyle, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.28)", flex: "1 1 auto", whiteSpace: "nowrap" }}>
        Open Diplomacy
        </button>
        </div>
        {worldState && (
            <GameFlagPicker
                isOpen={flagPickerOpen}
                polity={{ polityKey, name: displayName || country.name, code: country.code }}
                world={worldState}
                onClose={() => setFlagPickerOpen(false)}
                onApplied={(nextFlags) => {
                    setFlagCatalog(nextFlags || {});
                    setFlagFailed(false);
                }}
            />
        )}
        </div>,
        document.body,
    );
};

export default CountryInfoPanel;
