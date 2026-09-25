/*! Open Historia — cheats panel © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { APP_HEIGHT, SAFE_RIGHT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import {
    JSON_URLS,
    loadCountryNames,
    loadRegionCatalog,
    readJson,
    writeJson,
} from "../../runtime/assets.js";
import {
    applyCountryStatPatchToWorld,
    applyEventImpactsToWorld,
    MARKER_STATUSES,
    readEventsState,
    readGameData,
    readWorldState,
    writeEventsState,
    writeGameData,
    writeWorldState,
} from "../../runtime/gameState.js";
import COUNTRY_NAMES from "../../runtime/generated/countryNames.js";
import { POLITY_ROLE_PLACEHOLDER, polityRoleOf } from "../../../server/polityRole.js";
import { DIFFICULTY_LEVELS, normalizeDifficulty } from "../../runtime/difficulty.js";
import { applyGameMasterPreview, consolidateHistoryNow, previewGameMasterCommand } from "../AI/gameplayLazy.js";
import { HISTORY_CONSOLIDATION, countWords, describeHistoryConsolidation, planHistoryConsolidation } from "../AI/historyConsolidation.js";
import {
    POLITICAL_TRAIT_REGISTRY,
    canonicalPoliticalTraitKey,
    normalizePoliticalTraitValue,
} from "../../runtime/politicalTraitRegistry.js";
import { copyToClipboard } from "../../runtime/clipboard.js";
import { buildPoliticalDecisionContext } from "../AI/politicalDecisionContext.js";
import { isSceneInProgress } from "../AI/interactiveRewind.js";
import { isOfferableEvent } from "../../runtime/interactiveOffer.js";
import { setRegionClickInterceptor } from "../Selection/Regions.jsx";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { tidyProse } from "./markdownText.js";
import { useUnseenEventIds } from "./useUnseenEvents.js";
import { compareGameDates, formatGameDateReadable, isGameDate } from "../../runtime/gameDates.js";
import { applyPoliticalEditorStateToWorld, politicalActorToEditorState, politicalDebugSnapshotFromWorld, politicalEditorStateFromWorld } from "./countryEditorPolitical.js";
import {
    REMINDERS_LIMIT,
    REMINDER_MAX_CHARS,
    addReminder,
    editReminder,
    gmChangeKindLabel,
    gmChangesForRound,
    normalizeReminders,
    recordGmChange,
    removeReminder,
} from "../../runtime/gmChanges.js";

const PANEL_TOP = "4.75rem";
const EMPTY_FEATURES = { type: "FeatureCollection", features: [] };

const capitalize = (text) => String(text ?? "").replace(/^./, (first) => first.toUpperCase());

// Every tool in this panel changes the world outside the simulation, and the
// next time skip is told so, once (runtime/gmChanges.js). A small world write of
// its own after the tool's save has succeeded, so no tool's save path changes
// shape — and a note that fails costs the note, never the edit.
// `step` ({ group, template, item }) is one step of a change made in many — a
// border redrawn region by region — and joins the line that change is building.
const noteGmChange = async (kind, summary, step = null) => {
    try {
        const [world, game] = await Promise.all([readWorldState({ force: true }), readGameData({ force: true })]);
        await writeWorldState(recordGmChange(world, {
            kind,
            summary,
            round: Number(game?.round) || 0,
            date: String(game?.gameDate || game?.startDate || ""),
            ...(step || {}),
        }));
    } catch (error) {
        console.warn("[cheats] the change was made, but the note for the next time skip was not:", error);
    }
};

const TOOLS = [
    { id: "master-ai", title: "GM Console", subtitle: "Master AI · AI-assisted world intervention and canonical changes", icon: "✦", badge: "AI" },
    { id: "reminders", title: "Simulation Reminders", subtitle: "Standing facts every AI in the game is told until you withdraw them — and what the next skip will hear", icon: "❖" },
    { id: "roll-back-turn", title: "Roll Back Turn", subtitle: "Restore the game to the start of an earlier turn", icon: "↶" },
    { id: "your-country", title: "Play As Country", subtitle: "Change which country you're currently controlling", icon: "♛" },
    { id: "difficulty", title: "Difficulty", subtitle: "Tune simulation rigor without anti-player bias", icon: "◈" },
    { id: "annex-country", title: "Annex Country", subtitle: "Transfer an entire country's mapped territory", icon: "⇢" },
    { id: "annex-regions", title: "Annex Regions", subtitle: "Transfer individual map regions to another country", icon: "⌖" },
    { id: "edit-country", title: "Country Editor", subtitle: "Edit a country's identity and properties", icon: "◆" },
    { id: "add-country", title: "Add Country", subtitle: "Create a new polity for custom or fantasy campaigns", icon: "+", badge: "Advanced" },
    { id: "regions", title: "Region Inspector", subtitle: "Inspect control, sovereignty, claims, and region identity", icon: "▦" },
    { id: "edit-feature", title: "Map Feature Editor", subtitle: "Inspect and edit runtime features and scenario cities", icon: "◉" },
    { id: "add-feature", title: "Add Map Feature", subtitle: "Place cities, HQs, landmarks, ports, and other world features", icon: "+" },
    { id: "clear-features", title: "Clear Map Features", subtitle: "Remove custom features or restore standard cities", icon: "⌫", badge: "Advanced" },
    { id: "events", title: "Event Editor", subtitle: "Search, create, and repair canonical timeline events", icon: "≡" },
    { id: "interactive-event", title: "Interactive Event", subtitle: "Play any event on the record out as a scene, the way a time skip offers one now and then", icon: "⚡" },
    { id: "history-document", title: "History Document", subtitle: "Read and edit the living history the AI is given in place of older events; the timeline keeps every event", icon: "≣" },
];

const TOOL_GROUPS = [
    {
        id: "gm-history",
        title: "GM & History",
        subtitle: "Intervene in the world, repair canon, or restore an earlier state.",
        icon: "✦",
        tools: ["master-ai", "reminders", "events", "interactive-event", "history-document", "roll-back-turn"],
    },
    {
        id: "countries-territory",
        title: "Countries & Territory",
        subtitle: "Edit political actors, borders, and individual regions.",
        icon: "◇",
        tools: ["edit-country", "annex-country", "annex-regions", "regions", "add-country"],
    },
    {
        id: "military",
        title: "Military",
        subtitle: "Inspect and manually manipulate forces on the map.",
        icon: "⚔",
        tools: ["forces"],
    },
    {
        id: "simulation",
        title: "Simulation",
        subtitle: "Change player control and simulation challenge settings.",
        icon: "◈",
        tools: ["difficulty", "your-country"],
    },
    {
        id: "map",
        title: "Map",
        subtitle: "Manage visible cities, landmarks, and custom map features.",
        icon: "⌖",
        tools: ["edit-feature", "add-feature", "clear-features"],
    },
];

const inputStyle = {
    background: "rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 8,
    boxSizing: "border-box",
    color: "#fff",
    fontSize: "0.83rem",
    outline: "none",
    padding: "0.5rem 0.6rem",
    width: "100%",
};

const buttonStyle = {
    alignItems: "center",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    fontSize: "0.82rem",
    fontWeight: 600,
    gap: "0.4rem",
    justifyContent: "center",
    padding: "0.5rem 0.7rem",
};

const primaryButtonStyle = {
    ...buttonStyle,
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.28)",
};

const homeToolButtonStyle = {
    ...buttonStyle,
    alignItems: "center",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 10,
    gap: "0.65rem",
    justifyContent: "flex-start",
    padding: "0.62rem 0.7rem",
    textAlign: "left",
    width: "100%",
};

const iconTileStyle = {
    alignItems: "center",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#f4f4f5",
    display: "flex",
    flex: "0 0 2rem",
    fontSize: "0.9rem",
    fontWeight: 800,
    height: "2rem",
    justifyContent: "center",
    width: "2rem",
};

const badgeStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 999,
    color: "rgba(255,255,255,0.52)",
    flexShrink: 0,
    fontSize: "0.58rem",
    fontWeight: 800,
    letterSpacing: "0.045em",
    padding: "0.16rem 0.38rem",
    textTransform: "uppercase",
};

const labelStyle = {
    color: "rgba(255,255,255,0.75)",
    display: "block",
    fontSize: "0.72rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    margin: "0.6rem 0 0.25rem",
    textTransform: "uppercase",
};

// A <summary> is one line of small text, too thin for a thumb. On a touch
// screen its line is 44 px tall, which keeps the text and its ▸ centred (the
// tap classes set a min-height, and a summary would sit at the top of it).
const TOUCH_SUMMARY = { lineHeight: "2.75rem" };

const hexToRgb = (hex) => {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
    if (!match) return null;
    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const rgbToHex = (rgb) =>
    Array.isArray(rgb) && rgb.length === 3
        ? `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`
        : "#888888";

// The countries that ACTUALLY exist in the current game — enumerated from the map,
// not a fixed world list. Every defined polity, every current region owner, and the
// owners of the rendered geometry (the scenario's own custom regions when it has
// them, else the stock catalog), each resolved to its display NAME. On a fantasy
// map this yields the invented nations only, never real-Earth countries; a country
// you just created shows up too (it's in polityOverrides).
const loadPolities = async () => {
    const world = await readWorldState({ force: false });
    const overrides = world.regionOwnershipOverrides ?? {};
    const polityOverrides = world.polityOverrides ?? {};

    // identifier -> display name (stock ISO names first, era/custom polity names win).
    const nameByCode = new Map();
    for (const entry of (await loadCountryNames().catch(() => [])) ?? []) {
        if (entry?.code) nameByCode.set(String(entry.code), entry.name || String(entry.code));
    }
    for (const [code, polity] of Object.entries(polityOverrides)) {
        if (code && polity?.name) nameByCode.set(String(code), polity.name);
    }

    const owners = new Set();
    for (const code of Object.keys(polityOverrides)) if (code) owners.add(String(code));
    for (const owner of Object.values(overrides)) if (owner) owners.add(String(owner));
    for (const code of world.ownerCodes ?? []) if (code) owners.add(String(code));

    // R2.30: never reopen the full custom region geometry just to enumerate owners.
    // Nations already projects the active map to the compact region catalog.
    for (const region of await loadRegionCatalog().catch(() => [])) {
        const code = region.countryCode ? String(region.countryCode) : "";
        const owner =
            overrides[region.id] ??
            region.country ??
            COUNTRY_NAMES[code] ??
            code;
        if (owner) owners.add(String(owner));
    }

    const polities = Array.from(owners)
        .filter((code) => code && code.toLowerCase() !== "unclaimed")
        .map((code) => ({ code, name: nameByCode.get(code) || code }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { polities, world };
};

const PolitySelect = ({ polities, value, onChange, placeholder = "Pick a country…" }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)} style={{ ...inputStyle, colorScheme: "dark", cursor: "pointer" }}>
    <option value="">{placeholder}</option>
    {polities.map((polity) => (
        <option key={polity.code} value={polity.code} style={{ background: "#18181b", color: "#fff" }}>
        {polity.name}
        </option>
    ))}
    </select>
);

const CheatsPanel = ({ open, onClose, onOpenForces }) => {
    const [tool, setTool] = useState(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [polities, setPolities] = useState([]);
    const [game, setGame] = useState(null);
    // Click-capture mode: while set, the panel hides behind a floating toast
    // and map clicks route here instead of opening the region popup.
    const [clickMode, setClickMode] = useState(null);
    const clickHandlerRef = useRef(null);
    const isMobile = useIsMobile();

    const refresh = async () => {
        try {
            const [{ polities: nextPolities }, nextGame] = await Promise.all([
                loadPolities(),
                readGameData({ force: false }),
            ]);
            setPolities(nextPolities);
            setGame(nextGame);
        } catch (error) {
            setStatus(`Failed to load game data: ${error.message}`);
        }
    };

    useEffect(() => {
        if (open) {
            setStatus("");
            void refresh();
        } else {
            setTool(null);
            setClickMode(null);
        }
    }, [open]);

    useEffect(() => {
        if (!clickMode) {
            setRegionClickInterceptor(null);
            return undefined;
        }

        setRegionClickInterceptor((props) => {
            clickHandlerRef.current?.(props);
            return true;
        });
        return () => setRegionClickInterceptor(null);
    }, [clickMode]);

    const beginClickMode = (label, handler) => {
        clickHandlerRef.current = handler;
        setClickMode({ label });
    };

    const endClickMode = () => {
        clickHandlerRef.current = null;
        setClickMode(null);
    };
    // While the panel waits for a pick on the map it is hidden behind the toast,
    // and Back on a phone ends the pick, as Done does, rather than closing a
    // panel the player cannot see.
    useBackToClose(Boolean(clickMode), endClickMode);

    const runBusy = async (work, doneMessage) => {
        setBusy(true);
        setStatus("");
        try {
            const message = await work();
            setStatus(message || doneMessage || "Done.");
        } catch (error) {
            setStatus(`Failed: ${error.message}`);
        } finally {
            setBusy(false);
        }
    };

    if (!open) return null;

    const header = (title, subtitle) => (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "0.7rem", paddingBottom: "0.6rem" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "0.45rem", minWidth: 0 }}>
        {tool && (
            <button type="button" className="oh-tap" aria-label="Back to the cheat tools" onClick={() => { setTool(null); setStatus(""); }} style={{ ...buttonStyle, padding: "0.25rem 0.5rem" }}>
            ←
            </button>
        )}
        <div style={{ fontSize: "1rem", fontWeight: 800 }}>{title}</div>
        </div>
        <button type="button" className="oh-tap" aria-label="Close cheats" onClick={onClose} style={{ ...buttonStyle, padding: "0.25rem 0.55rem" }}>✕</button>
        </div>
        {subtitle && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.74rem", marginTop: "0.2rem" }}>{subtitle}</div>}
        </div>
    );

    return (
        <>
        {/* On a phone the toast takes the width its words need, up to the
            screen's: centred from 50%, it could only use half the screen and
            broke a one-line instruction over four. */}
        {clickMode && (
            <div className="oh-hud-popover" style={{ alignItems: "center", display: "flex", gap: "0.6rem", background: "rgba(24, 24, 27, 0.96)", border: "1px solid rgba(0,0,0,0.19)", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", color: "#fff", fontFamily: "sans-serif", fontSize: "0.85rem", left: "50%", padding: "0.6rem 0.9rem", position: "fixed", top: PANEL_TOP, transform: "translateX(-50%)", zIndex: 10070, ...(isMobile ? { boxSizing: "border-box", maxWidth: "calc(100vw - 1rem)", width: "max-content" } : null) }}>
            <span>{clickMode.label}</span>
            <button type="button" className="oh-tap-row" onClick={endClickMode} style={{ ...primaryButtonStyle, padding: "0.3rem 0.6rem" }}>Done</button>
            </div>
        )}

        <div
        className="oh-hud-panel"
        style={{
            background: "rgba(24, 24, 27, 0.96)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 18,
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
            color: "white",
            display: clickMode ? "none" : "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            maxHeight: `calc(${APP_HEIGHT} - ${PANEL_TOP} - ${SAFE_TOP} - 1rem)`,
            overflow: "hidden",
            padding: "0.9rem",
            position: "fixed",
            right: `calc(0.65rem + ${SAFE_RIGHT})`,
            top: `calc(${PANEL_TOP} + ${SAFE_TOP})`,
            width: ["edit-country", "events", "history-document", "edit-feature", "add-feature"].includes(tool) ? "min(31rem, calc(100vw - 1rem))" : "min(25.5rem, calc(100vw - 1rem))",
            zIndex: 10045,
        }}
        >
        {!tool ? (
            <>
            {header("Cheats", "Game Master, world editing, and simulation administration")}
            <div style={{ overflowY: "auto", paddingRight: "0.15rem" }}>
            <div style={{
                alignItems: "center",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 11,
                display: "flex",
                gap: "0.65rem",
                marginBottom: "0.8rem",
                padding: "0.62rem 0.7rem",
            }}>
                <div style={{ ...iconTileStyle, flexBasis: "2.15rem", height: "2.15rem", width: "2.15rem" }}>⌘</div>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 800 }}>Canonical world tools</div>
                    <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.66rem", lineHeight: 1.35, marginTop: "0.08rem" }}>
                        Edits become the current canonical state, not permanent locks. Normal simulation remains free to evolve them afterward.
                    </div>
                </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            {TOOL_GROUPS.map((group) => (
                <section key={group.id}>
                    <div style={{ alignItems: "flex-start", display: "flex", gap: "0.45rem", marginBottom: "0.36rem", padding: "0 0.1rem" }}>
                        <span style={{ color: "#e4e4e7", fontSize: "0.75rem", lineHeight: "1rem" }}>{group.icon}</span>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "0.69rem", fontWeight: 850, letterSpacing: "0.055em", textTransform: "uppercase" }}>{group.title}</div>
                            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.35, marginTop: "0.04rem" }}>{group.subtitle}</div>
                        </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.34rem" }}>
                    {group.tools.map((toolId) => {
                        if (toolId === "forces") {
                            if (typeof onOpenForces !== "function") return null;
                            return (
                                <button key="forces" type="button" onClick={onOpenForces} style={homeToolButtonStyle}>
                                    <span style={iconTileStyle}>⚔</span>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 760 }}>Force Manager</span>
                                        <span style={{ color: "rgba(255,255,255,0.45)", display: "block", fontSize: "0.65rem", fontWeight: 500, lineHeight: 1.35, marginTop: "0.08rem" }}>Deploy, inspect, edit, and repair forces on the map</span>
                                    </span>
                                    <span style={badgeStyle}>2.0</span>
                                </button>
                            );
                        }

                        const entry = TOOLS.find((candidate) => candidate.id === toolId);
                        if (!entry) return null;
                        return (
                            <button
                            key={entry.id}
                            type="button"
                            onClick={() => { setTool(entry.id); setStatus(""); }}
                            style={homeToolButtonStyle}
                            >
                                <span style={iconTileStyle}>{entry.icon || "•"}</span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 760 }}>{entry.title}</span>
                                    <span style={{ color: "rgba(255,255,255,0.45)", display: "block", fontSize: "0.65rem", fontWeight: 500, lineHeight: 1.35, marginTop: "0.08rem" }}>{entry.subtitle}</span>
                                </span>
                                {entry.badge && <span style={badgeStyle}>{entry.badge}</span>}
                            </button>
                        );
                    })}
                    </div>
                </section>
            ))}
            </div>
            </div>
            </>
        ) : (
            <ToolView
            tool={tool}
            header={header}
            busy={busy}
            status={status}
            game={game}
            polities={polities}
            refresh={refresh}
            runBusy={runBusy}
            beginClickMode={beginClickMode}
            endClickMode={endClickMode}
            setStatus={setStatus}
            navigateTool={(nextTool) => { setTool(nextTool); setStatus(""); }}
            closePanel={onClose}
            />
        )}
        {status && !tool && (
            <div style={{ color: "rgba(191,219,254,0.9)", fontSize: "0.76rem", marginTop: "0.6rem" }}>{status}</div>
        )}
        </div>
        </>
    );
};


const cleanEditorNumber = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const rounded = Math.round(number * 1000) / 1000;
    return String(rounded);
};

const MAP_FEATURE_KINDS = [
    { id: "city", label: "City / town", icon: "■" },
    { id: "landmark", label: "Landmark", icon: "◆" },
    { id: "military hq", label: "Military HQ", icon: "⌂" },
    { id: "military base", label: "Military Base", icon: "⚔" },
    { id: "fortress", label: "Fortification", icon: "▣" },
    { id: "port", label: "Port", icon: "⚓" },
    { id: "airfield", label: "Airfield", icon: "✈" },
    { id: "industrial plant", label: "Industrial Site", icon: "⚙" },
    { id: "embassy", label: "Embassy", icon: "◇" },
    { id: "temporary marker", label: "Temporary", icon: "⌖" },
    { id: "other", label: "Other", icon: "+" },
];

const MAP_FEATURE_STATUS_META = {
    planned: { label: "Planned", color: "#e4e4e7" },
    under_construction: { label: "Under construction", color: "#fcd34d" },
    active: { label: "Active", color: "#86efac" },
    damaged: { label: "Damaged", color: "#fca5a5" },
    inactive: { label: "Inactive", color: "#d1d1d5" },
    abandoned: { label: "Abandoned", color: "#fdba74" },
    destroyed: { label: "Destroyed", color: "#f87171" },
};

const mapFeatureStatusMeta = (status) =>
    MAP_FEATURE_STATUS_META[String(status ?? "").trim().toLowerCase()] || MAP_FEATURE_STATUS_META.active;

const CITY_PROMINENCE = [
    { tier: 1, label: "Town" },
    { tier: 2, label: "City" },
    { tier: 3, label: "Major city" },
    { tier: 4, label: "Capital" },
];

const notifyCitiesUpdated = () => {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:cities-updated"));
    }
};

const editorNumber = (value, { min = -Infinity, max = Infinity, label = "Value" } = {}) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
    if (number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return number;
};

const editorFieldStyle = {
    background: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.11)",
    borderRadius: 9,
    padding: "0.55rem",
};

const editorSectionLabelStyle = {
    color: "rgba(255,255,255,0.48)",
    fontSize: "0.63rem",
    fontWeight: 850,
    letterSpacing: "0.07em",
    marginBottom: "0.45rem",
    textTransform: "uppercase",
};

const debugPreStyle = {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "rgba(255,255,255,0.72)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.61rem",
    lineHeight: 1.42,
    margin: "0.3rem 0 0",
    overflow: "auto",
    padding: "0.55rem",
    whiteSpace: "pre-wrap",
};

const CountryEditorView = ({ meta, header, busy, status, polities, refresh, runBusy, beginClickMode, endClickMode, setStatus }) => {
    const [target, setTarget] = useState("");
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({});
    const [politicsForm, setPoliticsForm] = useState(() => politicalActorToEditorState(null));
    const [politicsDebug, setPoliticsDebug] = useState(null);
    const [decisionContextText, setDecisionContextText] = useState("");
    const [baseline, setBaseline] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const touch = useTouchPrimary();

    const nameOf = useMemo(
        () => new Map(polities.map((polity) => [polity.code, polity.name])),
        [polities],
    );

    useEffect(() => {
        if (!target) {
            setForm({});
            setPoliticsForm(politicalActorToEditorState(null));
            setPoliticsDebug(null);
            setDecisionContextText("");
            setBaseline(null);
            return undefined;
        }

        let cancelled = false;
        setLoading(true);

        Promise.all([
            readWorldState({ force: true }),
            readJson(JSON_URLS.colors, { defaultValue: {}, force: true }).catch(() => ({})),
        ])
            .then(([world, colors]) => {
                if (cancelled) return;
                const polity = world?.polityOverrides?.[target] ?? {};
                const sheet = world?.countryStats?.[target] ?? null;
                const rgb = colors?.[target];
                const color = polity.color || (Array.isArray(rgb) ? rgbToHex(rgb) : "");
                const population = Number(sheet?.population?.total);
                const gdp = Number(sheet?.economy?.gdp);
                const perCapita = Number(sheet?.economy?.gdpPerCapita);

                setBaseline({
                    sheet,
                    componentCount: Array.isArray(sheet?.territorialComponents) ? sheet.territorialComponents.length : 0,
                    perCapita: Number.isFinite(perCapita) ? perCapita : null,
                });
                setPoliticsForm(politicalEditorStateFromWorld(world, target));
                setPoliticsDebug(politicalDebugSnapshotFromWorld(world, target));
                setDecisionContextText(buildPoliticalDecisionContext(world, target, { maxChars: 12000 })?.text || "");
                setForm({
                    name: polity.name || nameOf.get(target) || target,
                    color,
                    capital: sheet?.capital || "",
                    continent: sheet?.continent || "",
                    government: sheet?.government || "",
                    leader: sheet?.leader || "",
                    populationM: Number.isFinite(population) ? cleanEditorNumber(population / 1e6) : "",
                    gdpB: Number.isFinite(gdp) ? cleanEditorNumber(gdp / 1e9) : "",
                    gdpGrowth: sheet?.economy?.gdpGrowth ?? "",
                    inflation: sheet?.economy?.inflation ?? "",
                    unemployment: sheet?.economy?.unemployment ?? "",
                    publicDebt: sheet?.economy?.publicDebt ?? "",
                    budgetBalance: sheet?.economy?.budgetBalance ?? "",
                    currency: sheet?.economy?.currency || "",
                    stability: sheet?.stability ?? "",
                    sovereignty: sheet?.indices?.sovereignty ?? "",
                    foodAutonomy: sheet?.indices?.foodAutonomy ?? "",
                    energyAutonomy: sheet?.indices?.energyAutonomy ?? "",
                    economicIndependence: sheet?.indices?.economicIndependence ?? "",
                    internalSecurity: sheet?.indices?.internalSecurity ?? "",
                    internationalReputation: sheet?.indices?.internationalReputation ?? "",
                    agriculture: sheet?.gdpBreakdown?.agriculture ?? "",
                    industry: sheet?.gdpBreakdown?.industry ?? "",
                    services: sheet?.gdpBreakdown?.services ?? "",
                });
            })
            .catch((error) => {
                if (!cancelled) setStatus(`Failed: ${error.message}`);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [target, reloadKey, nameOf, setStatus]);

    const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
    const changePolitics = (key, value) => setPoliticsForm((current) => ({ ...current, [key]: value }));
    const changeTrait = (key, value) => setPoliticsForm((current) => {
        const next = {
            ...current,
            traitValues: { ...(current.traitValues || {}), [key]: value },
        };
        // Keep the raw power-user JSON synchronized whenever it is currently
        // valid. If the user is midway through typing invalid JSON, preserve it
        // verbatim and let the normal save-time validator explain the problem.
        try {
            const raw = JSON.parse(String(current.traitsJson || "{}").trim() || "{}");
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
                for (const rawKey of Object.keys(raw)) {
                    if (canonicalPoliticalTraitKey(rawKey) === key) delete raw[rawKey];
                }
                const normalized = normalizePoliticalTraitValue(value);
                if (normalized != null) raw[key] = normalized;
                next.traitsJson = JSON.stringify(raw, null, 2);
            }
        } catch { /* raw JSON stays exactly as typed */ }
        return next;
    });
    const changeTraitsJson = (value) => setPoliticsForm((current) => {
        const next = { ...current, traitsJson: value };
        try {
            const parsed = JSON.parse(String(value || "{}").trim() || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return next;
            const traitValues = Object.fromEntries(POLITICAL_TRAIT_REGISTRY.map((definition) => [definition.key, ""]));
            for (const [rawKey, rawValue] of Object.entries(parsed)) {
                const key = canonicalPoliticalTraitKey(rawKey);
                if (!key) continue;
                const normalized = normalizePoliticalTraitValue(rawValue);
                if (normalized != null) traitValues[key] = String(normalized);
            }
            next.traitValues = traitValues;
        } catch { /* invalid in-progress JSON is allowed until Save */ }
        return next;
    });
    const changeParty = (index, key, value) => setPoliticsForm((current) => ({
        ...current,
        parties: (current.parties || []).map((party, partyIndex) => (partyIndex === index ? { ...party, [key]: value } : party)),
    }));
    const changeBloc = (index, key, value) => setPoliticsForm((current) => ({
        ...current,
        powerBlocs: (current.powerBlocs || []).map((bloc, blocIndex) => (blocIndex === index ? { ...bloc, [key]: value } : bloc)),
    }));
    const addParty = () => setPoliticsForm((current) => ({
        ...current,
        parties: [...(current.parties || []), {
            id: `custom-party-${Date.now().toString(36)}`, name: "New political entity", shortName: "", leader: "", ideology: "", publicDescription: "",
            publicPrioritiesText: "", publicForeignPolicyText: "", supportPercent: "", influencePercent: "", influenceLabel: "", ruling: false, coalition: false,
        }],
    }));
    const removeParty = (index) => setPoliticsForm((current) => ({ ...current, parties: (current.parties || []).filter((_, partyIndex) => partyIndex !== index) }));
    const addBloc = () => setPoliticsForm((current) => ({
        ...current,
        powerBlocs: [...(current.powerBlocs || []), {
            id: `custom-bloc-${Date.now().toString(36)}`, name: "New power bloc", shortName: "", kind: "", status: "", leader: "", ideology: "",
            publicDescription: "", publicPrioritiesText: "", publicForeignPolicyText: "", influencePercent: "", influenceLabel: "",
        }],
    }));
    const removeBloc = (index) => setPoliticsForm((current) => ({ ...current, powerBlocs: (current.powerBlocs || []).filter((_, blocIndex) => blocIndex !== index) }));

    const changeSectorShare = (key, rawValue) => {
        const nextValue = Math.max(0, Math.min(100, Math.round(Number(rawValue) || 0)));
        const sectorKeys = ["agriculture", "industry", "services"];
        setForm((current) => {
            const others = sectorKeys.filter((candidate) => candidate !== key);
            const remainder = 100 - nextValue;
            const currentOtherValues = others.map((candidate) =>
                Math.max(0, Math.min(100, Number(current[candidate]) || 0)));
            const otherTotal = currentOtherValues[0] + currentOtherValues[1];

            let distributed;
            if (remainder <= 0) {
                distributed = [0, 0];
            } else if (otherTotal > 0) {
                const exact = currentOtherValues.map((value) => remainder * (value / otherTotal));
                distributed = exact.map(Math.floor);
                let left = remainder - distributed[0] - distributed[1];
                const order = exact
                    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
                    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
                for (let i = 0; i < order.length && left > 0; i += 1, left -= 1) {
                    distributed[order[i].index] += 1;
                }
            } else {
                distributed = [Math.floor(remainder / 2), Math.ceil(remainder / 2)];
            }

            return {
                ...current,
                [key]: nextValue,
                [others[0]]: distributed[0],
                [others[1]]: distributed[1],
            };
        });
    };

    const hasComponentBaseline = Boolean(baseline?.componentCount);

    const save = () => runBusy(async () => {
        if (!target) throw new Error("Pick a country first.");

        const world = await readWorldState({ force: true });
        const existing = world.polityOverrides?.[target] ?? {};
        const requestedName = String(form.name ?? "").trim();
        const colorHex = String(form.color ?? "").trim();
        const nextName = requestedName || existing.name || nameOf.get(target) || target;
        const aliases = [...new Set([
            ...(Array.isArray(existing.aliases) ? existing.aliases : []),
            target,
            existing.name,
            nextName,
        ].map((value) => String(value ?? "").trim()).filter(Boolean))];

        const nextOverride = {
            ...existing,
            aliases,
            code: target,
            name: nextName,
            ...(hexToRgb(colorHex) ? { color: colorHex.startsWith("#") ? colorHex : `#${colorHex}` } : {}),
        };
        world.polityOverrides = { ...(world.polityOverrides || {}), [target]: nextOverride };

        // Political World v2 is the sole political authority. The editor writes
        // directly into world.politicalActors and never creates a parallel
        // "country politics" copy inside Stats. Hidden/derived PWv2 fields not
        // exposed by this surface are preserved by the bridge.
        const nextPoliticalActor = applyPoliticalEditorStateToWorld(world, target, politicsForm);
        setPoliticsDebug(politicalDebugSnapshotFromWorld(world, target));
        setDecisionContextText(buildPoliticalDecisionContext(world, target, { maxChars: 12000 })?.text || "");

        // Before the patch, for the one-line note the next time skip is given.
        const previousName = String(existing.name || nameOf.get(target) || target).trim();
        const sheetBefore = world.countryStats?.[target] ?? null;
        const headlineBefore = {
            leader: String(sheetBefore?.leader ?? "").trim(),
            government: String(sheetBefore?.government ?? "").trim(),
            capital: String(sheetBefore?.capital ?? "").trim(),
            stability: Number.isFinite(Number(sheetBefore?.stability)) ? Number(sheetBefore.stability) : null,
        };

        let nextSheet = world.countryStats?.[target] ?? null;
        if (hasComponentBaseline) {
            const populationM = editorNumber(form.populationM, { min: 0.001, max: 20000, label: "Population (millions)" });
            const gdpB = editorNumber(form.gdpB, { min: 0.001, max: 1000000, label: "GDP (billions)" });
            const stability = editorNumber(form.stability, { min: 0, max: 100, label: "Stability" });
            const gdpGrowth = editorNumber(form.gdpGrowth, { min: -1000, max: 1000, label: "GDP growth" });
            const inflation = editorNumber(form.inflation, { min: 0, max: 1000, label: "Inflation" });
            const unemployment = editorNumber(form.unemployment, { min: 0, max: 100, label: "Unemployment" });
            const publicDebt = editorNumber(form.publicDebt, { min: 0, max: 1000, label: "Public debt" });
            const budgetBalance = editorNumber(form.budgetBalance, { min: -1000, max: 1000, label: "Budget balance" });

            const indexPatch = {};
            for (const [key, label] of [
                ["sovereignty", "Sovereignty"],
                ["foodAutonomy", "Food autonomy"],
                ["energyAutonomy", "Energy autonomy"],
                ["economicIndependence", "Economic independence"],
                ["internalSecurity", "Internal security"],
                ["internationalReputation", "International reputation"],
            ]) {
                const value = editorNumber(form[key], { min: 0, max: 100, label });
                if (value != null) indexPatch[key] = value;
            }

            const agriculture = editorNumber(form.agriculture, { min: 0, max: 100, label: "Agriculture share" });
            const industry = editorNumber(form.industry, { min: 0, max: 100, label: "Industry share" });
            const services = editorNumber(form.services, { min: 0, max: 100, label: "Services share" });
            const hasAnyBreakdown = [agriculture, industry, services].some((value) => value != null);
            if (hasAnyBreakdown && [agriculture, industry, services].some((value) => value == null)) {
                throw new Error("Set all three GDP-sector shares together.");
            }

            const patch = {
                ...(String(form.capital ?? "").trim() ? { capital: String(form.capital).trim() } : {}),
                ...(String(form.continent ?? "").trim() ? { continent: String(form.continent).trim() } : {}),
                ...(String(nextPoliticalActor?.government?.form ?? "").trim() ? { government: String(nextPoliticalActor.government.form).trim() } : {}),
                ...((nextPoliticalActor?.government?.headOfGovernment || nextPoliticalActor?.government?.headOfState || nextPoliticalActor?.leader)
                    ? { leader: String(
                        typeof (nextPoliticalActor.government?.headOfGovernment || nextPoliticalActor.government?.headOfState || nextPoliticalActor.leader) === "string"
                            ? (nextPoliticalActor.government?.headOfGovernment || nextPoliticalActor.government?.headOfState || nextPoliticalActor.leader)
                            : (nextPoliticalActor.government?.headOfGovernment || nextPoliticalActor.government?.headOfState || nextPoliticalActor.leader)?.name || ""
                    ).trim() }
                    : {}),
                ...(stability == null ? {} : { stability }),
                ...(Object.keys(indexPatch).length ? { indices: indexPatch } : {}),
                ...(populationM == null ? {} : { population: { total: Math.round(populationM * 1e6) } }),
                economy: {
                    ...(gdpB == null ? {} : { gdp: Math.round(gdpB * 1e9) }),
                    ...(gdpGrowth == null ? {} : { gdpGrowth }),
                    ...(inflation == null ? {} : { inflation }),
                    ...(unemployment == null ? {} : { unemployment }),
                    ...(publicDebt == null ? {} : { publicDebt }),
                    ...(budgetBalance == null ? {} : { budgetBalance }),
                    ...(String(form.currency ?? "").trim() ? { currency: String(form.currency).trim() } : {}),
                },
                ...(hasAnyBreakdown ? { gdpBreakdown: { agriculture, industry, services } } : {}),
            };

            nextSheet = applyCountryStatPatchToWorld(world, target, patch);
            const reputation = Number(nextSheet?.indices?.internationalReputation);
            if (Number.isFinite(reputation)) {
                world.internationalReputation = {
                    ...(world.internationalReputation || {}),
                    [target]: Math.max(0, Math.min(100, Math.round(reputation))),
                };
            }
        }

        await writeWorldState(world);

        const rgb = hexToRgb(colorHex);
        if (rgb) {
            const colors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
            await writeJson(JSON_URLS.colors, { ...colors, [target]: rgb }, { pretty: true });
        }

        const edits = [
            previousName && previousName !== nextName ? `renamed it from ${previousName}` : "",
            ...["leader", "government", "capital"].map((key) => {
                const after = String(nextSheet?.[key] ?? "").trim();
                return after && after !== headlineBefore[key] ? `${key}: ${after}` : "";
            }),
            Number.isFinite(Number(nextSheet?.stability)) && Number(nextSheet.stability) !== headlineBefore.stability
                ? `stability ${headlineBefore.stability ?? "unset"} → ${Number(nextSheet.stability)}`
                : "",
        ].filter(Boolean);
        const politicalSummary = [
            nextPoliticalActor?.government?.form,
            nextPoliticalActor?.government?.ideology,
        ].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
        await noteGmChange(hasComponentBaseline ? "stats" : "polity",
            `Edited ${nextName} in the country editor${edits.length ? `: ${edits.join("; ")}` : ""}${politicalSummary ? `${edits.length ? "; " : ": "}PWv2 ${politicalSummary}` : ""}.`);

        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("oh:country-stats-updated", {
                detail: { country: target },
            }));
        }

        await refresh();
        setReloadKey((value) => value + 1);
        return hasComponentBaseline
            ? `${nextName} updated. These values are the current baseline; future simulation can change them naturally.`
            : `${nextName} identity updated. Generate a Stats baseline before editing national statistics.`;
    });

    const previewPopulation = Number(form.populationM) * 1e6;
    const previewGdp = Number(form.gdpB) * 1e9;
    const previewPerCapita = Number.isFinite(previewPopulation) && previewPopulation > 0 && Number.isFinite(previewGdp) && previewGdp > 0
        ? previewGdp / previewPopulation
        : baseline?.perCapita;
    const perCapitaText = Number.isFinite(previewPerCapita)
        ? `€${Math.round(previewPerCapita).toLocaleString()}`
        : "—";

    const pairedField = (label, key, props = {}) => (
        <div style={{ minWidth: 0 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>{label}</label>
            <input
                {...props}
                style={{ ...inputStyle, ...(props.style || {}) }}
                value={form[key] ?? ""}
                onChange={(event) => change(key, event.target.value)}
            />
        </div>
    );
    const politicsPairedField = (label, key, props = {}) => (
        <div style={{ minWidth: 0 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>{label}</label>
            <input
                {...props}
                style={{ ...inputStyle, ...(props.style || {}) }}
                value={politicsForm[key] ?? ""}
                onChange={(event) => changePolitics(key, event.target.value)}
            />
        </div>
    );
    const politicsTextarea = (label, key, placeholder = "") => (
        <div style={{ marginTop: "0.55rem" }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>{label}</label>
            <textarea
                rows={4}
                placeholder={placeholder}
                style={{ ...inputStyle, lineHeight: 1.42, minHeight: "5.5rem", resize: "vertical" }}
                value={politicsForm[key] ?? ""}
                onChange={(event) => changePolitics(key, event.target.value)}
            />
        </div>
    );

    return (
        <>
        {header(meta.title, "Identity, Political World v2, national baseline, and present-state administration")}
        <div style={{ overflowY: "auto", paddingRight: "0.12rem" }}>
            <div style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 11,
                marginBottom: "0.72rem",
                padding: "0.62rem 0.7rem",
            }}>
                <div style={{ color: "#f4f4f5", fontSize: "0.66rem", fontWeight: 900, letterSpacing: "0.065em", textTransform: "uppercase" }}>
                    Canonical now · evolvable later
                </div>
                <div style={{ color: "rgba(255,255,255,0.52)", fontSize: "0.67rem", lineHeight: 1.4, marginTop: "0.16rem" }}>
                    A manual edit sets the country's current baseline. Later wars, annexations, losses, growth, crises, and other world events remain free to change it.
                </div>
            </div>

            <button
                type="button"
                className="oh-tap-row"
                disabled={busy}
                onClick={() => {
                    beginClickMode(
                        target ? "Click another country on the map to edit it" : "Click a country on the map to edit it",
                        (props) => {
                            const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase();
                            const gid0 = String(props?.gid0 || "").trim();
                            const candidates = [
                                props?.owner,
                                props?.GID_0,
                                props?.COUNTRY,
                                COUNTRY_NAMES[gid0],
                                gid0,
                            ].map((value) => String(value ?? "").trim()).filter(Boolean);

                            let match = null;
                            for (const candidate of candidates) {
                                const key = normalize(candidate);
                                match = polities.find((polity) =>
                                    normalize(polity.code) === key || normalize(polity.name) === key
                                );
                                if (match) break;
                            }

                            if (!match) {
                                setStatus("Failed: that map area does not resolve to an editable country.");
                                endClickMode();
                                return;
                            }

                            setTarget(match.code);
                            setStatus(`Selected ${match.name}.`);
                            endClickMode();
                        },
                    );
                }}
                style={{ ...primaryButtonStyle, width: "100%" }}
            >
                {target ? "Pick another country on map →" : "Pick a country on map →"}
            </button>

            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.66rem", lineHeight: 1.4, marginTop: "0.35rem" }}>
                Click any owned region. The editor resolves the region's current live owner, not the map's historical provenance.
            </div>

            <details style={{ ...editorFieldStyle, marginTop: "0.6rem", padding: "0.5rem 0.6rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.7rem", fontWeight: 800, ...(touch ? TOUCH_SUMMARY : null) }}>
                    Advanced · choose from country list
                </summary>
                <div style={{ marginTop: "0.5rem" }}>
                    <PolitySelect
                        polities={polities}
                        value={target}
                        onChange={(code) => {
                            setTarget(code);
                            setStatus("");
                        }}
                    />
                </div>
            </details>

            {loading && (
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.75rem", marginTop: "0.75rem" }}>
                    Loading canonical country state…
                </div>
            )}

            {target && !loading && (
                <>
                    <div style={{ ...editorFieldStyle, marginTop: "0.75rem" }}>
                        <div style={editorSectionLabelStyle}>Identity</div>
                        <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.61rem", marginBottom: "0.4rem" }}>
                            Stable key: <code>{target}</code>
                        </div>
                        <label style={{ ...labelStyle, marginTop: 0 }}>Display name</label>
                        <input
                            style={inputStyle}
                            value={form.name ?? ""}
                            onChange={(event) => change("name", event.target.value)}
                        />
                        <label style={labelStyle}>Color</label>
                        <div style={{ alignItems: "center", display: "flex", gap: "0.45rem" }}>
                            <input
                                style={{ ...inputStyle, flex: 1 }}
                                value={form.color ?? ""}
                                onChange={(event) => change("color", event.target.value)}
                                placeholder="#a1a1aa"
                            />
                            <input
                                type="color"
                                className="oh-tap"
                                value={hexToRgb(form.color) ? (String(form.color).startsWith("#") ? form.color : `#${form.color}`) : "rgba(255,255,255,0.22)"}
                                onChange={(event) => change("color", event.target.value)}
                                style={{ background: "none", border: "none", cursor: "pointer", height: "2.2rem", padding: 0, width: "2.8rem" }}
                            />
                        </div>
                    </div>

                    <div style={{ ...editorFieldStyle, marginTop: "0.65rem" }}>
                        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                            <div>
                                <div style={editorSectionLabelStyle}>Political World v2</div>
                                <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.62rem", lineHeight: 1.4 }}>
                                    Canonical political truth used by the Advisor, diplomacy, institutions and simulation. This is not a Stats-side copy.
                                </div>
                            </div>
                            <span style={{ background: politicsForm.exists ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)", border: `1px solid ${politicsForm.exists ? "rgba(34,197,94,0.28)" : "rgba(245,158,11,0.28)"}`, borderRadius: 999, color: politicsForm.exists ? "#86efac" : "#fbbf24", flexShrink: 0, fontSize: "0.58rem", fontWeight: 850, padding: "0.14rem 0.42rem", textTransform: "uppercase" }}>
                                {politicsForm.exists ? "Canonical actor" : "New actor"}
                            </span>
                        </div>

                        <details open style={{ marginTop: "0.65rem" }}>
                            <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 850 }}>Government & political system</summary>
                            <div style={{ display: "grid", gap: "0.48rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.58rem" }}>
                                {politicsPairedField("Government form", "governmentForm")}
                                {politicsPairedField("Government ideology", "governmentIdeology")}
                                {politicsPairedField("Head of state", "headOfState")}
                                {politicsPairedField("Head of government", "headOfGovernment")}
                                {politicsPairedField("Operative political leader", "politicalLeader")}
                                {politicsPairedField("Government status", "governmentStatus")}
                                {politicsPairedField("Coalition / cabinet name", "coalitionName")}
                                {politicsPairedField("Political system type", "politicalSystemType")}
                                <div style={{ minWidth: 0 }}>
                                    <label style={{ ...labelStyle, marginTop: 0 }}>Representation model</label>
                                    <select style={inputStyle} value={politicsForm.politicalRepresentation ?? ""} onChange={(event) => changePolitics("politicalRepresentation", event.target.value)}>
                                        <option value="">Auto / unspecified</option>
                                        <option value="electoral">Electoral</option>
                                        <option value="court_factions">Court factions</option>
                                        <option value="party_state">Party state</option>
                                        <option value="elite_factions">Elite factions</option>
                                        <option value="military_factions">Military factions</option>
                                        <option value="revolutionary_factions">Revolutionary factions</option>
                                        <option value="colonial">Colonial</option>
                                        <option value="none">None</option>
                                    </select>
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <label style={{ ...labelStyle, marginTop: 0 }}>Regime character</label>
                                    <select style={inputStyle} value={politicsForm.regimeCharacter ?? ""} onChange={(event) => changePolitics("regimeCharacter", event.target.value)}>
                                        <option value="">Unspecified</option>
                                        <option value="democratic">Democratic</option>
                                        <option value="hybrid">Hybrid</option>
                                        <option value="authoritarian">Authoritarian</option>
                                        <option value="totalitarian">Totalitarian</option>
                                        <option value="theocratic">Theocratic</option>
                                        <option value="military">Military</option>
                                        <option value="colonial">Colonial</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                {politicsPairedField("Government approval / 100", "approval", { type: "number", min: "0", max: "100", step: "0.1" })}
                                {politicsPairedField("Political stability / 100", "politicalStability", { type: "number", min: "0", max: "100", step: "0.1" })}
                            </div>
                            <div style={{ marginTop: "0.48rem" }}>
                                {politicsPairedField("Public system label", "politicalSystemLabel")}
                            </div>
                            {politicsTextarea("Political-system notes", "politicalSystemNotes")}
                        </details>

                        <details open style={{ marginTop: "0.7rem" }}>
                            <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 850 }}>Strategic outlook · goals, fears, ambitions, pressure</summary>
                            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.4, marginTop: "0.35rem" }}>One item per line. These are canonical causal inputs, not flavor text.</div>
                            {politicsTextarea("Goals", "goalsText", "One goal per line")}
                            {politicsTextarea("Fears", "fearsText", "One fear per line")}
                            {politicsTextarea("Ambitions", "ambitionsText", "One ambition per line")}
                            {politicsTextarea("Domestic pressure notes", "domesticPressuresText", "One pressure per line")}
                        </details>

                        <details open style={{ marginTop: "0.7rem" }}>
                            <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 850 }}>Parties / political entities ({politicsForm.parties?.length || 0})</summary>
                            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.4, marginTop: "0.35rem" }}>Ruling and coalition membership writes directly to canonical government party IDs.</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.55rem" }}>
                                {(politicsForm.parties || []).map((party, index) => (
                                    <details key={party.id || index} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "0.5rem" }}>
                                        <summary style={{ cursor: "pointer", fontSize: "0.7rem", fontWeight: 800 }}>
                                            {party.name || `Political entity ${index + 1}`}{party.ruling ? " · Government" : party.coalition ? " · Coalition" : ""}
                                        </summary>
                                        <div style={{ display: "grid", gap: "0.44rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.55rem" }}>
                                            <div><label style={{ ...labelStyle, marginTop: 0 }}>Name</label><input style={inputStyle} value={party.name ?? ""} onChange={(event) => changeParty(index, "name", event.target.value)} /></div>
                                            <div><label style={{ ...labelStyle, marginTop: 0 }}>Short name</label><input style={inputStyle} value={party.shortName ?? ""} onChange={(event) => changeParty(index, "shortName", event.target.value)} /></div>
                                            <div><label style={{ ...labelStyle, marginTop: 0 }}>Leader</label><input style={inputStyle} value={party.leader ?? ""} onChange={(event) => changeParty(index, "leader", event.target.value)} /></div>
                                            <div><label style={{ ...labelStyle, marginTop: 0 }}>Ideology</label><input style={inputStyle} value={party.ideology ?? ""} onChange={(event) => changeParty(index, "ideology", event.target.value)} /></div>
                                            <div><label style={{ ...labelStyle, marginTop: 0 }}>Support (%)</label><input type="number" min="0" max="100" step="0.1" style={inputStyle} value={party.supportPercent ?? ""} onChange={(event) => changeParty(index, "supportPercent", event.target.value)} /></div>
                                            <div><label style={{ ...labelStyle, marginTop: 0 }}>Influence (%)</label><input type="number" min="0" max="100" step="0.1" style={inputStyle} value={party.influencePercent ?? ""} onChange={(event) => changeParty(index, "influencePercent", event.target.value)} /></div>
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem" }}>
                                            <label style={{ alignItems: "center", display: "flex", fontSize: "0.67rem", gap: "0.35rem" }}><input type="checkbox" checked={party.ruling === true} onChange={(event) => changeParty(index, "ruling", event.target.checked)} /> Ruling / government</label>
                                            <label style={{ alignItems: "center", display: "flex", fontSize: "0.67rem", gap: "0.35rem" }}><input type="checkbox" checked={party.coalition === true} disabled={party.ruling === true} onChange={(event) => changeParty(index, "coalition", event.target.checked)} /> Coalition partner</label>
                                        </div>
                                        <label style={labelStyle}>Public description</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={party.publicDescription ?? ""} onChange={(event) => changeParty(index, "publicDescription", event.target.value)} />
                                        <label style={labelStyle}>Public priorities · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={party.publicPrioritiesText ?? ""} onChange={(event) => changeParty(index, "publicPrioritiesText", event.target.value)} />
                                        <label style={labelStyle}>Foreign-policy outlook · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={party.publicForeignPolicyText ?? ""} onChange={(event) => changeParty(index, "publicForeignPolicyText", event.target.value)} />
                                        <button type="button" onClick={() => removeParty(index)} style={{ ...buttonStyle, color: "#fca5a5", marginTop: "0.5rem", width: "100%" }}>Remove political entity</button>
                                    </details>
                                ))}
                            </div>
                            <button type="button" onClick={addParty} style={{ ...buttonStyle, marginTop: "0.5rem", width: "100%" }}>+ Add political entity</button>
                        </details>

                        <details style={{ marginTop: "0.7rem" }}>
                            <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 850 }}>Power blocs / non-party actors ({politicsForm.powerBlocs?.length || 0})</summary>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.55rem" }}>
                                {(politicsForm.powerBlocs || []).map((bloc, index) => (
                                    <details key={bloc.id || index} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "0.5rem" }}>
                                        <summary style={{ cursor: "pointer", fontSize: "0.7rem", fontWeight: 800 }}>{bloc.name || `Power bloc ${index + 1}`}</summary>
                                        <div style={{ display: "grid", gap: "0.44rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.55rem" }}>
                                            {[["Name", "name"], ["Short name", "shortName"], ["Kind", "kind"], ["Status", "status"], ["Leader", "leader"], ["Ideology", "ideology"], ["Influence label", "influenceLabel"]].map(([label, key]) => (
                                                <div key={key}><label style={{ ...labelStyle, marginTop: 0 }}>{label}</label><input style={inputStyle} value={bloc[key] ?? ""} onChange={(event) => changeBloc(index, key, event.target.value)} /></div>
                                            ))}
                                            <div><label style={{ ...labelStyle, marginTop: 0 }}>Influence (%)</label><input type="number" min="0" max="100" step="0.1" style={inputStyle} value={bloc.influencePercent ?? ""} onChange={(event) => changeBloc(index, "influencePercent", event.target.value)} /></div>
                                        </div>
                                        <label style={labelStyle}>Public description</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={bloc.publicDescription ?? ""} onChange={(event) => changeBloc(index, "publicDescription", event.target.value)} />
                                        <label style={labelStyle}>Public priorities · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={bloc.publicPrioritiesText ?? ""} onChange={(event) => changeBloc(index, "publicPrioritiesText", event.target.value)} />
                                        <label style={labelStyle}>Foreign-policy outlook · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={bloc.publicForeignPolicyText ?? ""} onChange={(event) => changeBloc(index, "publicForeignPolicyText", event.target.value)} />
                                        <button type="button" onClick={() => removeBloc(index)} style={{ ...buttonStyle, color: "#fca5a5", marginTop: "0.5rem", width: "100%" }}>Remove power bloc</button>
                                    </details>
                                ))}
                            </div>
                            <button type="button" onClick={addBloc} style={{ ...buttonStyle, marginTop: "0.5rem", width: "100%" }}>+ Add power bloc</button>
                        </details>

                        <details open style={{ marginTop: "0.75rem" }} data-political-trait-catalog="true">
                            <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 850 }}>Canonical traits · full supported catalog ({POLITICAL_TRAIT_REGISTRY.length})</summary>
                            <div style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.62rem", lineHeight: 1.45, marginTop: "0.35rem" }}>
                                Every native PWv2 trait is listed here, including traits this actor has never established. Blank means <strong>unset</strong>, not 0. Values are canonical 0-100 inputs used by the native disposition engine.
                            </div>
                            <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginTop: "0.6rem" }}>
                                {POLITICAL_TRAIT_REGISTRY.map((trait) => {
                                    const rawValue = politicsForm.traitValues?.[trait.key] ?? "";
                                    const isSet = rawValue !== "" && rawValue !== null && rawValue !== undefined;
                                    return (
                                        <div key={trait.key} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "0.52rem" }}>
                                            <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "space-between" }}>
                                                <label style={{ ...labelStyle, margin: 0 }}>{trait.label}</label>
                                                <span style={{ color: isSet ? "#86efac" : "rgba(255,255,255,0.35)", fontSize: "0.56rem", fontWeight: 800, textTransform: "uppercase" }}>{isSet ? "set" : "unset"}</span>
                                            </div>
                                            <input
                                                type="number"
                                                min={trait.min}
                                                max={trait.max}
                                                step="0.1"
                                                placeholder="unset"
                                                style={{ ...inputStyle, marginTop: "0.3rem" }}
                                                value={rawValue}
                                                onChange={(event) => changeTrait(trait.key, event.target.value)}
                                            />
                                            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.57rem", lineHeight: 1.35, marginTop: "0.32rem" }}>{trait.description}</div>
                                            <code style={{ color: "rgba(196,181,253,0.72)", display: "block", fontSize: "0.55rem", marginTop: "0.3rem" }}>{trait.key}</code>
                                        </div>
                                    );
                                })}
                            </div>
                        </details>

                        <details style={{ marginTop: "0.75rem" }} data-political-structured-json="true">
                            <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 850 }}>Advanced structured traits & perceptions</summary>
                            <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.61rem", lineHeight: 1.45, marginTop: "0.35rem" }}>
                                Raw JSON remains available for power users and legacy extension traits. Registered canonical trait keys stay synchronized with the controls above whenever this JSON is valid.
                            </div>
                            <label style={labelStyle}>Traits JSON</label>
                            <textarea
                                rows={10}
                                spellCheck={false}
                                style={{ ...inputStyle, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.65rem", lineHeight: 1.4, resize: "vertical" }}
                                value={politicsForm.traitsJson ?? "{}"}
                                onChange={(event) => changeTraitsJson(event.target.value)}
                            />
                            <label style={labelStyle}>Perceptions JSON</label>
                            <textarea
                                rows={12}
                                spellCheck={false}
                                style={{ ...inputStyle, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.65rem", lineHeight: 1.4, resize: "vertical" }}
                                value={politicsForm.perceptionsJson ?? "{}"}
                                onChange={(event) => changePolitics("perceptionsJson", event.target.value)}
                            />
                        </details>

                        <details style={{ marginTop: "0.75rem" }} data-political-debug="true">
                            <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 850 }}>Political Debug · prove what the simulator sees</summary>
                            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.61rem", lineHeight: 1.45, marginTop: "0.35rem" }}>
                                Read-only canonical and derived state. This includes values the editor cannot directly modify, plus the complete supported trait catalog with unset dimensions preserved.
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.42rem", marginTop: "0.55rem" }}>
                                <button type="button" style={buttonStyle} onClick={async () => {
                                    const ok = await copyToClipboard(JSON.stringify(politicsDebug?.actor ?? null, null, 2));
                                    setStatus(ok ? "Copied full Political Actor JSON." : "Failed to copy Political Actor JSON.");
                                }}>Copy full actor JSON</button>
                                <button type="button" style={buttonStyle} onClick={async () => {
                                    const ok = await copyToClipboard(decisionContextText || "");
                                    setStatus(ok ? "Copied Political Decision Context capsule." : "Failed to copy decision capsule.");
                                }}>Copy decision capsule</button>
                                <button type="button" style={buttonStyle} onClick={async () => {
                                    const ok = await copyToClipboard(JSON.stringify(politicsDebug ?? null, null, 2));
                                    setStatus(ok ? "Copied political numeric/debug snapshot." : "Failed to copy political debug snapshot.");
                                }}>Copy numeric/debug snapshot</button>
                            </div>
                            <div style={{ marginTop: "0.65rem" }}>
                                <div style={editorSectionLabelStyle}>All supported traits · current canonical values</div>
                                <div style={{ display: "grid", gap: "0.3rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: "0.4rem" }}>
                                    {(politicsDebug?.traitCatalog?.traits || POLITICAL_TRAIT_REGISTRY.map((trait) => ({ ...trait, value: null, status: "unset" }))).map((trait) => (
                                        <div key={trait.key} style={{ alignItems: "center", background: "rgba(255,255,255,0.025)", borderRadius: 7, display: "flex", fontSize: "0.62rem", justifyContent: "space-between", padding: "0.35rem 0.45rem" }}>
                                            <span>{trait.label}</span>
                                            <code style={{ color: trait.value == null ? "rgba(255,255,255,0.34)" : "#c4b5fd" }}>{trait.value == null ? "unset" : trait.value}</code>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <label style={labelStyle}>Decision authority · derived/native</label>
                            <pre style={{ ...debugPreStyle, maxHeight: "13rem" }}>{JSON.stringify(politicsDebug?.decisionAuthority ?? null, null, 2)}</pre>
                            <label style={labelStyle}>Behavioral disposition · stored</label>
                            <pre style={{ ...debugPreStyle, maxHeight: "13rem" }}>{JSON.stringify(politicsDebug?.storedDisposition ?? null, null, 2)}</pre>
                            <label style={labelStyle}>Behavioral disposition · derived now</label>
                            <pre style={{ ...debugPreStyle, maxHeight: "13rem" }}>{JSON.stringify(politicsDebug?.derivedDisposition ?? null, null, 2)}</pre>
                            <label style={labelStyle}>Full Political Actor JSON</label>
                            <pre style={{ ...debugPreStyle, maxHeight: "22rem" }}>{JSON.stringify(politicsDebug?.actor ?? null, null, 2)}</pre>
                            <label style={labelStyle}>Bounded Political Decision Context capsule</label>
                            <textarea
                                readOnly
                                rows={18}
                                spellCheck={false}
                                style={{ ...inputStyle, color: "rgba(255,255,255,0.72)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.62rem", lineHeight: 1.4, resize: "vertical" }}
                                value={decisionContextText || ""}
                            />
                        </details>
                    </div>

                    {!hasComponentBaseline ? (
                        <div style={{
                            background: "rgba(245,158,11,0.08)",
                            border: "1px solid rgba(245,158,11,0.24)",
                            borderRadius: 10,
                            color: "rgba(254,243,199,0.88)",
                            fontSize: "0.7rem",
                            lineHeight: 1.45,
                            marginTop: "0.65rem",
                            padding: "0.62rem 0.7rem",
                        }}>
                            This country does not yet have a component-backed canonical Stats baseline. Identity can be edited now; open Stats → Economy once to establish the national baseline before editing GDP, population, or macro values here.
                        </div>
                    ) : (
                        <>
                            <div style={{ ...editorFieldStyle, marginTop: "0.65rem" }}>
                                <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "0.45rem" }}>
                                    <div style={editorSectionLabelStyle}>National baseline</div>
                                    <span style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.6rem" }}>
                                        {baseline.componentCount} territorial component{baseline.componentCount === 1 ? "" : "s"}
                                    </span>
                                </div>
                                <div style={{ display: "grid", gap: "0.48rem", gridTemplateColumns: "1fr 1fr" }}>
                                    {pairedField("Population (millions) · whole polity", "populationM", { type: "number", min: "0.001", step: "0.1" })}
                                    {pairedField("GDP (€ billions) · whole polity", "gdpB", { type: "number", min: "0.001", step: "0.1" })}
                                    <div style={{ minWidth: 0 }}>
                                        <label style={{ ...labelStyle, marginTop: 0 }}>GDP / capita · derived</label>
                                        <div style={{ ...inputStyle, color: "rgba(255,255,255,0.62)", cursor: "default" }}>{perCapitaText}</div>
                                    </div>
                                    {pairedField("GDP growth (%)", "gdpGrowth", { type: "number", step: "0.1" })}
                                </div>
                                <div style={{
                                    background: "rgba(59,130,246,0.07)",
                                    border: "1px solid rgba(96,165,250,0.18)",
                                    borderRadius: 8,
                                    color: "rgba(219,234,254,0.72)",
                                    fontSize: "0.61rem",
                                    lineHeight: 1.45,
                                    marginTop: "0.5rem",
                                    padding: "0.5rem 0.58rem",
                                }}>
                                    These are whole-polity targets. Changing population proportionally rescales population across every current territorial component. Changing GDP proportionally rescales each component's GDP per capita, preserving existing regional and colonial differences. The displayed GDP/capita is derived from the edited totals, and future simulation can still move all of these values naturally.
                                </div>
                            </div>

                            <div style={{ ...editorFieldStyle, marginTop: "0.65rem" }}>
                                <div style={editorSectionLabelStyle}>Macroeconomy & administration</div>
                                <div style={{ display: "grid", gap: "0.48rem", gridTemplateColumns: "1fr 1fr" }}>
                                    {pairedField("Capital", "capital")}
                                    {pairedField("Currency", "currency")}
                                    {pairedField("Continent / region", "continent")}
                                    {pairedField("Stability / 100", "stability", { type: "number", min: "0", max: "100", step: "1" })}
                                    {pairedField("Inflation (%)", "inflation", { type: "number", min: "0", step: "0.1" })}
                                    {pairedField("Unemployment (%)", "unemployment", { type: "number", min: "0", max: "100", step: "0.1" })}
                                    {pairedField("Public debt (% GDP)", "publicDebt", { type: "number", min: "0", step: "0.1" })}
                                    {pairedField("Budget balance (% GDP)", "budgetBalance", { type: "number", step: "0.1" })}
                                </div>
                            </div>

                            <details style={{ ...editorFieldStyle, marginTop: "0.65rem" }}>
                                <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 800, ...(touch ? TOUCH_SUMMARY : null) }}>
                                    Strategic indices
                                </summary>
                                <div style={{ display: "grid", gap: "0.48rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.6rem" }}>
                                    {pairedField("Sovereignty", "sovereignty", { type: "number", min: "0", max: "100", step: "1" })}
                                    {pairedField("Food autonomy", "foodAutonomy", { type: "number", min: "0", max: "100", step: "1" })}
                                    {pairedField("Energy autonomy", "energyAutonomy", { type: "number", min: "0", max: "100", step: "1" })}
                                    {pairedField("Economic independence", "economicIndependence", { type: "number", min: "0", max: "100", step: "1" })}
                                    {pairedField("Internal security", "internalSecurity", { type: "number", min: "0", max: "100", step: "1" })}
                                    {pairedField("International reputation", "internationalReputation", { type: "number", min: "0", max: "100", step: "1" })}
                                </div>
                            </details>

                            <details style={{ ...editorFieldStyle, marginTop: "0.65rem" }}>
                                <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 800, ...(touch ? TOUCH_SUMMARY : null) }}>
                                    GDP sector breakdown
                                </summary>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.72rem", marginTop: "0.65rem" }}>
                                    {[
                                        ["Agriculture", "agriculture", "#22c55e"],
                                        ["Industry", "industry", "#3b82f6"],
                                        ["Services", "services", "#d4d4d8"],
                                    ].map(([label, key, tone]) => {
                                        const value = Math.max(0, Math.min(100, Math.round(Number(form[key]) || 0)));
                                        return (
                                            <div key={key} style={{ minWidth: 0 }}>
                                                <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "0.32rem" }}>
                                                    <span style={{ ...labelStyle, margin: 0 }}>{label}</span>
                                                    <span data-no-translate style={{ color: tone, fontSize: "0.72rem", fontWeight: 900 }}>{value}%</span>
                                                </div>
                                                <input
                                                    aria-label={`${label} share`}
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    step="1"
                                                    value={value}
                                                    onChange={(event) => changeSectorShare(key, event.target.value)}
                                                    style={{ accentColor: tone, cursor: "pointer", margin: 0, width: "100%" }}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{
                                    borderRadius: "999px",
                                    display: "flex",
                                    height: "7px",
                                    marginTop: "0.72rem",
                                    overflow: "hidden",
                                    width: "100%",
                                }}>
                                    <div style={{ background: "#22c55e", width: `${Math.max(0, Math.min(100, Number(form.agriculture) || 0))}%` }} />
                                    <div style={{ background: "#3b82f6", width: `${Math.max(0, Math.min(100, Number(form.industry) || 0))}%` }} />
                                    <div style={{ background: "rgba(255,255,255,0.07)", width: `${Math.max(0, Math.min(100, Number(form.services) || 0))}%` }} />
                                </div>
                                <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.61rem", lineHeight: 1.4, marginTop: "0.45rem" }}>
                                    Always totals 100%. Moving one sector keeps that value and redistributes the remainder across the other two in proportion to their current shares.
                                </div>
                            </details>
                        </>
                    )}

                    <div style={{ display: "flex", gap: "0.45rem", marginTop: "0.72rem" }}>
                        <button type="button" className="oh-tap-row" disabled={busy} onClick={save} style={{ ...primaryButtonStyle, flex: 1 }}>
                            Save present-state edit
                        </button>
                        <button
                            type="button"
                            className="oh-tap-row"
                            disabled={busy}
                            onClick={() => setReloadKey((value) => value + 1)}
                            style={buttonStyle}
                        >
                            Reset
                        </button>
                    </div>
                </>
            )}
            {status && (
                <div style={{ color: status.startsWith("Failed") ? "#fca5a5" : "rgba(191,219,254,0.9)", fontSize: "0.76rem", marginTop: "0.6rem" }}>
                    {status}
                </div>
            )}
        </div>
        </>
    );
};


const cleanEventText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// A description is multi-paragraph prose, so it cannot go through the one above:
// collapsing every run of whitespace turned an edited event into a single block
// and threw the paragraphs away.
const cleanEventBody = tidyProse;
const eventImpactSummary = (event) => {
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    const rows = [
        ["polity", impacts.polityChanges],
        ["territory", impacts.regionTransfers],
        ["claims", impacts.regionClaims],
        ["control", impacts.regionControlOps],
        ["units", impacts.unitOps],
        ["markers", impacts.markerOps],
        ["chats", impacts.createdChats],
        ["actions", impacts.actionIds],
    ];
    const populated = rows
        .map(([label, value]) => [label, Array.isArray(value) ? value.length : 0])
        .filter(([, count]) => count > 0);
    const count = populated.reduce((sum, [, value]) => sum + value, 0);
    return {
        count,
        text: populated.map(([label, value]) => `${label} ${value}`).join(" · "),
    };
};

const manualEventId = () => {
    try {
        const uuid = globalThis.crypto?.randomUUID?.();
        if (uuid) return `event-manual-${uuid}`;
    } catch {
        // Fall through to a compact local id.
    }
    return `event-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
};

const sortEventsChronologically = (events) => events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
        const leftDate = cleanEventText(left.event?.date);
        const rightDate = cleanEventText(right.event?.date);
        if (leftDate && rightDate && leftDate !== rightDate) return compareGameDates(leftDate, rightDate);
        if (leftDate && !rightDate) return -1;
        if (!leftDate && rightDate) return 1;
        const leftCreated = cleanEventText(left.event?.createdAt);
        const rightCreated = cleanEventText(right.event?.createdAt);
        if (leftCreated && rightCreated && leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated);
        return left.index - right.index;
    })
    .map(({ event }) => event);

const eventDateLooksIso = (value) => isGameDate(cleanEventText(value));

const historyEntryDate = (entry) => cleanEventText(entry?.toDate || entry?.date || entry?.fromDate);

const historyEntryCoversDate = (entry, date) => {
    const wanted = cleanEventText(date);
    if (!wanted) return false;
    const from = cleanEventText(entry?.fromDate || entry?.date || entry?.toDate);
    const to = cleanEventText(entry?.toDate || entry?.date || entry?.fromDate);
    if (eventDateLooksIso(wanted) && eventDateLooksIso(from) && eventDateLooksIso(to)) {
        const low = from <= to ? from : to;
        const high = from <= to ? to : from;
        return wanted >= low && wanted <= high;
    }
    return wanted === cleanEventText(entry?.date) || wanted === to || wanted === from;
};

const isManualTimelineEvent = (event) => {
    const source = cleanEventText(event?.source).toLowerCase();
    const id = cleanEventText(event?.id).toLowerCase();
    return source === "manual" || id.startsWith("event-manual-");
};

// Manual Exact Events live in the same canonical event ledger as AI events, but the
// visible Events panel is turn-oriented: time.jsx renders only IDs referenced by
// world.simulationHistory. Keep manual events linked there without advancing a turn,
// changing the game date, or applying any gameplay-state effects.
const syncManualEventTimelineHistory = (worldInput, eventsInput, game) => {
    const world = worldInput && typeof worldInput === "object" ? { ...worldInput } : {};
    const manualEvents = (Array.isArray(eventsInput) ? eventsInput : [])
        .filter((event) => isManualTimelineEvent(event) && cleanEventText(event?.id) && cleanEventText(event?.date));
    const manualIds = new Set(manualEvents.map((event) => cleanEventText(event.id)));
    const knownEventIds = new Set((Array.isArray(eventsInput) ? eventsInput : []).map((event) => cleanEventText(event?.id)).filter(Boolean));

    let changed = false;
    let history = (Array.isArray(world.simulationHistory) ? world.simulationHistory : []).map((entry) => ({
        ...entry,
        eventIds: Array.isArray(entry?.eventIds) ? [...entry.eventIds] : [],
    }));

    // First remove every manual ID from prior links. This makes date edits deterministic
    // and prevents duplicate links if the editor is opened repeatedly.
    history = history
        .map((entry) => {
            const before = entry.eventIds;
            const after = before.filter((id) => {
                const normalizedId = cleanEventText(id);
                if (manualIds.has(normalizedId)) return false;
                if (normalizedId.toLowerCase().startsWith("event-manual-") && !knownEventIds.has(normalizedId)) return false;
                return true;
            });
            if (after.length !== before.length) changed = true;
            return after.length === before.length ? entry : { ...entry, eventIds: after };
        })
        .filter((entry) => {
            if (entry.eventIds.length) return true;
            const source = cleanEventText(entry?.source).toLowerCase();
            const mode = cleanEventText(entry?.mode).toLowerCase();
            // Manual and GM-authored history entries exist only to make their linked
            // canonical events visible in time.jsx. If the Event Editor deletes the
            // event, remove the empty history shell too; structured world effects are
            // deliberately left untouched.
            if (
                source === "manual" ||
                mode === "manual-event" ||
                source === "gm-console" ||
                mode === "game-master"
            ) {
                changed = true;
                return false;
            }
            return true;
        });

    const orderedManual = [...manualEvents].sort((a, b) => compareGameDates(cleanEventText(a.date), cleanEventText(b.date)));

    for (const event of orderedManual) {
        const eventId = cleanEventText(event.id);
        const date = cleanEventText(event.date);
        let targetIndex = history.findIndex((entry) => historyEntryCoversDate(entry, date));

        if (targetIndex >= 0) {
            const ids = history[targetIndex].eventIds;
            if (!ids.some((id) => cleanEventText(id) === eventId)) {
                history[targetIndex] = { ...history[targetIndex], eventIds: [...ids, eventId] };
                changed = true;
            }
            continue;
        }

        const manualRecord = {
            date,
            eventIds: [eventId],
            fallbackReason: "",
            fromDate: date,
            mode: "manual-event",
            plannedActions: [],
            round: Math.max(0, Math.trunc(Number(game?.round) || 0)),
            source: "manual",
            summary: `Manual exact event: ${cleanEventText(event?.title) || "Untitled event"}`,
            toDate: date,
        };

        let insertAt = history.findIndex((entry) => {
            const entryDate = historyEntryDate(entry);
            return eventDateLooksIso(date) && eventDateLooksIso(entryDate) && compareGameDates(date, entryDate) > 0;
        });
        if (insertAt < 0) insertAt = history.length;
        history.splice(insertAt, 0, manualRecord);
        changed = true;
    }

    return changed
        ? { changed: true, world: { ...world, simulationHistory: history } }
        : { changed: false, world };
};

const eventBadgeStyle = (tone = "rgba(255,255,255,0.55)") => ({
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${tone}`,
    borderRadius: 999,
    color: tone,
    fontSize: "0.55rem",
    fontWeight: 800,
    letterSpacing: "0.04em",
    lineHeight: 1,
    padding: "0.2rem 0.38rem",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
});

const eventFilterButtonStyle = (active) => ({
    ...buttonStyle,
    background: active ? "rgba(0,0,0,0.39)" : "rgba(255,255,255,0.05)",
    borderColor: active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)",
    color: active ? "#f4f4f5" : "rgba(255,255,255,0.7)",
    fontSize: "0.66rem",
    padding: "0.36rem 0.5rem",
});

// Simulation Reminders (runtime/gmChanges.js): the Game Master's standing facts,
// given to every AI in the game until they are withdrawn — and beneath them, the
// changes made by hand this round, which is exactly what the next time skip
// will be told. Nothing here costs a request.
const RemindersView = ({ meta, header, busy, status, game, runBusy }) => {
    const [world, setWorld] = useState(null);
    const [draft, setDraft] = useState("");
    const [editingId, setEditingId] = useState(null);
    const [editText, setEditText] = useState("");

    const load = async () => {
        const next = await readWorldState({ force: true });
        setWorld(next);
        return next;
    };
    // Loaded once on entry; every action below reloads it.
    useEffect(() => {
        let cancelled = false;
        readWorldState({ force: true })
            .then((next) => { if (!cancelled) setWorld(next); })
            .catch(() => { if (!cancelled) setWorld({}); });
        return () => { cancelled = true; };
    }, []);

    const round = Number(game?.round) || 0;
    const date = String(game?.gameDate || game?.startDate || "");
    const reminders = normalizeReminders(world?.simulationReminders);
    const pending = world ? gmChangesForRound(world, round) : [];
    const readable = (value) => (value ? formatGameDateReadable(value) : "");

    const issue = () => runBusy(async () => {
        const text = draft.trim();
        if (!text) throw new Error("Write the reminder first.");
        const current = await readWorldState({ force: true });
        if (normalizeReminders(current.simulationReminders).length >= REMINDERS_LIMIT) {
            throw new Error(`There can be ${REMINDERS_LIMIT} reminders at once. Withdraw one that no longer holds first.`);
        }
        await writeWorldState(addReminder(current, { text, round, date }));
        setDraft("");
        await load();
        return "Reminder issued. Every AI in the game is told it from its next call.";
    });

    const saveEdit = (id) => runBusy(async () => {
        const text = editText.trim();
        if (!text) throw new Error("A reminder cannot be empty — withdraw it instead.");
        const current = await readWorldState({ force: true });
        await writeWorldState(editReminder(current, id, text));
        setEditingId(null);
        await load();
        return "Reminder updated. The next call is told the new wording.";
    });

    const withdraw = (id) => runBusy(async () => {
        const current = await readWorldState({ force: true });
        await writeWorldState(removeReminder(current, id, { round, date }));
        if (editingId === id) setEditingId(null);
        await load();
        return "Reminder withdrawn. The next time skip is told it no longer holds.";
    });

    const cardStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.6rem" };
    const noteStyle = { color: "rgba(255,255,255,0.48)", fontSize: "0.68rem", lineHeight: 1.45 };
    const statusLine = status && (
        <div style={{ color: status.startsWith("Failed") ? "#fca5a5" : "rgba(191,219,254,0.9)", fontSize: "0.72rem", marginTop: "0.55rem" }}>
            {status}
        </div>
    );

    return (
        <>
        {header(meta.title, meta.subtitle)}
        <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.55rem", minHeight: 0, overflowY: "auto", paddingRight: "0.12rem" }}>
            <div style={noteStyle}>
                A reminder is a fact you declare for this game — "the Kerch bridge is down", "the harvest has failed across the south". The time skip, the checks after it, the advisor and every leader are told it on each call, ahead of the lore and the starting borders, until you withdraw it. Every AI sees every reminder, so keep secrets out of them.
            </div>

            <div style={editorFieldStyle}>
                <div style={editorSectionLabelStyle}>Issue a reminder</div>
                <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="The Kerch bridge is destroyed and cannot be crossed until it is rebuilt."
                    rows={3}
                    maxLength={REMINDER_MAX_CHARS}
                    style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical", width: "100%" }}
                />
                <button type="button" className="oh-tap-row" disabled={busy || !draft.trim()} onClick={issue} style={{ ...primaryButtonStyle, marginTop: "0.45rem", width: "100%" }}>
                    Issue reminder
                </button>
            </div>

            <div style={editorFieldStyle}>
                <div style={editorSectionLabelStyle}>Standing reminders · {reminders.length} of {REMINDERS_LIMIT}</div>
                {world === null && <div style={noteStyle}>Loading…</div>}
                {world !== null && reminders.length === 0 && <div style={noteStyle}>None. Every AI is working from the record alone.</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    {reminders.map((entry) => (
                        <div key={entry.id} style={cardStyle}>
                            {editingId === entry.id ? (
                                <>
                                <textarea
                                    value={editText}
                                    onChange={(event) => setEditText(event.target.value)}
                                    rows={3}
                                    maxLength={REMINDER_MAX_CHARS}
                                    style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical", width: "100%" }}
                                />
                                <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem" }}>
                                    <button type="button" className="oh-tap-row" disabled={busy} onClick={() => saveEdit(entry.id)} style={{ ...primaryButtonStyle, flex: 1 }}>Save</button>
                                    <button type="button" className="oh-tap-row" disabled={busy} onClick={() => setEditingId(null)} style={{ ...buttonStyle, flex: 1 }}>Cancel</button>
                                </div>
                                </>
                            ) : (
                                <>
                                <div style={{ fontSize: "0.76rem", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{entry.text}</div>
                                <div style={{ alignItems: "center", display: "flex", gap: "0.35rem", justifyContent: "space-between", marginTop: "0.35rem" }}>
                                    <span style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.62rem" }}>
                                        {entry.date ? `since ${readable(entry.date)}` : ""}{entry.round ? ` · round ${entry.round}` : ""}
                                    </span>
                                    <span style={{ display: "flex", gap: "0.3rem" }}>
                                        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => { setEditingId(entry.id); setEditText(entry.text); }} style={{ ...buttonStyle, fontSize: "0.64rem", padding: "0.22rem 0.45rem" }}>Edit</button>
                                        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => withdraw(entry.id)} style={{ ...buttonStyle, borderColor: "rgba(244,63,94,0.32)", color: "#fda4af", fontSize: "0.64rem", padding: "0.22rem 0.45rem" }}>Withdraw</button>
                                    </span>
                                </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div style={editorFieldStyle}>
                <div style={editorSectionLabelStyle}>What the next time skip will be told</div>
                <div style={{ ...noteStyle, marginBottom: "0.4rem" }}>
                    Every change made by hand this round — here, in the GM console or with any other tool in this panel. The skip hears them once, as acts of authority it must not undo.
                </div>
                {pending.length === 0
                    ? <div style={noteStyle}>Nothing has been changed by hand this round.</div>
                    : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                            {pending.map((entry) => (
                                <div key={entry.id} style={{ ...cardStyle, fontSize: "0.7rem", lineHeight: 1.4 }}>
                                    <span style={{ color: "#e4e4e7", fontSize: "0.6rem", fontWeight: 750, marginRight: "0.4rem", textTransform: "uppercase" }}>{gmChangeKindLabel(entry.kind)}</span>
                                    {entry.summary}
                                </div>
                            ))}
                        </div>
                    )}
            </div>
            {statusLine}
        </div>
        </>
    );
};

// Interactive Event: offer any event on the record to be played out as a scene.
// A time skip does this by itself now and then — one skip in three, and never
// twice within three rounds (runtime/interactiveOffer.js). This puts the same
// offer on an event of the Game Master's choosing and opens the panel that
// plays it out (GameUI/interactive.jsx).
//
// It writes the offer and nothing else. The scene itself costs what it always
// costs (one request to open, one a move, one to end), and the cooldown is left
// alone, so skips go on offering their own.
const InteractiveEventView = ({ meta, header, busy, status, game, runBusy, closePanel }) => {
    // The shared store, like the panels that play the scene: an offer written
    // here reaches the buttons below without a re-read.
    const world = useRuntimeState("world");
    const events = useRuntimeState("events");
    const [search, setSearch] = useState("");
    const [limit, setLimit] = useState(30);
    // A scene starts from what the player has seen, so an event the reveal has
    // not reached cannot be offered yet (gameplay.js createInteractive).
    const unseen = useUnseenEventIds();

    const sceneInProgress = isSceneInProgress(world?.activeInteractive);
    const offer = world?.interactiveOffer ?? null;
    const query = cleanEventText(search).toLowerCase();
    // Newest first: the moment closest to where the player stands is the one
    // worth playing out, and the one a scene can open on.
    const listed = useMemo(() => {
        const all = Array.isArray(events) ? [...events].reverse() : [];
        if (!query) return all;
        return all.filter((event) => [event?.title, event?.date, event?.description, event?.id]
            .some((value) => cleanEventText(value).toLowerCase().includes(query)));
    }, [events, query]);

    const openScene = () => {
        window.dispatchEvent(new Event("oh:open-interactive-event"));
        // The cheats panel sits above the scene, so it steps out of the way.
        closePanel?.();
    };

    const offerEvent = (event) => runBusy(async () => {
        const id = cleanEventText(event?.id);
        if (!id) throw new Error("That event has no id, so a scene cannot be opened on it.");
        const current = await readWorldState({ force: true });
        await writeWorldState({ ...current, interactiveOffer: { eventId: id, round: Math.max(0, Math.trunc(Number(game?.round) || 0)) } });
        openScene();
        return `Offered "${cleanEventText(event?.title) || id}". Play it out in the panel that just opened.`;
    });

    const clearOffer = () => runBusy(async () => {
        const current = await readWorldState({ force: true });
        await writeWorldState({ ...current, interactiveOffer: null });
        return "The offer is gone. Nothing else changed.";
    });

    const noteStyle = { color: "rgba(255,255,255,0.48)", fontSize: "0.68rem", lineHeight: 1.45 };
    const warnStyle = { background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.32)", borderRadius: 8, color: "#fde68a", fontSize: "0.68rem", lineHeight: 1.45, padding: "0.5rem 0.6rem" };
    const statusLine = status && (
        <div style={{ color: status.startsWith("Failed") ? "#fca5a5" : "rgba(191,219,254,0.9)", fontSize: "0.72rem", marginTop: "0.55rem" }}>
            {status}
        </div>
    );
    const offeredTitle = offer && cleanEventText((Array.isArray(events) ? events : []).find((event) => cleanEventText(event?.id) === cleanEventText(offer.eventId))?.title);

    return (
        <>
        {header(meta.title, meta.subtitle)}
        <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.55rem", minHeight: 0, overflowY: "auto", paddingRight: "0.12rem" }}>
            <div style={noteStyle}>
                Pick an event and it becomes the moment to play out: the scene opens inside it, you make the moves, and how it ends is written into the record as one event. Only the scene costs requests — offering one costs nothing, and letting it pass costs nothing.
            </div>

            {sceneInProgress && (
                <div style={warnStyle}>
                    A scene is already in progress. End it or set it aside before opening another.
                    <button type="button" className="oh-tap-row" onClick={openScene} style={{ ...buttonStyle, display: "block", marginTop: "0.4rem" }}>Open the scene</button>
                </div>
            )}

            {offer && !sceneInProgress && (
                <div style={warnStyle}>
                    <span data-no-translate>{offeredTitle || cleanEventText(offer.eventId)}</span> is offered now.
                    <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem" }}>
                        <button type="button" className="oh-tap-row" onClick={openScene} style={{ ...primaryButtonStyle, flex: 1 }}>Play it out</button>
                        <button type="button" className="oh-tap-row" disabled={busy} onClick={clearOffer} style={{ ...buttonStyle, flex: 1 }}>Clear the offer</button>
                    </div>
                </div>
            )}

            <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search the record…"
                style={{ ...inputStyle, width: "100%" }}
            />

            {world === null && <div style={noteStyle}>Loading the record…</div>}
            {world !== null && listed.length === 0 && <div style={noteStyle}>{query ? "No event matches that." : "The record is empty: play a turn first."}</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {listed.slice(0, limit).map((event) => {
                    const id = cleanEventText(event.id);
                    const revealing = unseen.has(id);
                    const wouldBeOffered = isOfferableEvent(event);
                    return (
                        <div key={id || `${event.title}-${event.date}`} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                            <div data-no-translate style={{ fontSize: "0.76rem", fontWeight: 700, lineHeight: 1.35 }}>{cleanEventText(event.title) || "Untitled event"}</div>
                            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.25rem" }}>
                                {isGameDate(event.date) && <span data-no-translate style={{ ...noteStyle, fontSize: "0.64rem" }}>{formatGameDateReadable(event.date)}</span>}
                                <span style={eventBadgeStyle(wouldBeOffered ? "rgba(134,239,172,0.5)" : "rgba(255,255,255,0.28)")}>
                                    {wouldBeOffered ? "a skip could offer this" : "a skip never would"}
                                </span>
                            </div>
                            <button
                                type="button"
                                className="oh-tap-row"
                                disabled={busy || revealing || sceneInProgress}
                                onClick={() => offerEvent(event)}
                                title={revealing
                                    ? "Finish revealing the last time skip first: a scene starts from what you have seen."
                                    : "Offer this moment and open the scene"}
                                style={{ ...primaryButtonStyle, marginTop: "0.45rem", opacity: busy || revealing || sceneInProgress ? 0.5 : 1, width: "100%" }}
                            >
                                {revealing ? "Not revealed yet" : "Play this out"}
                            </button>
                        </div>
                    );
                })}
            </div>

            {listed.length > limit && (
                <button type="button" className="oh-tap-row" onClick={() => setLimit((value) => value + 30)} style={buttonStyle}>
                    Show {Math.min(30, listed.length - limit)} more of {listed.length}
                </button>
            )}
            {statusLine}
        </div>
        </>
    );
};

const EventEditorView = ({ meta, header, busy, status, game, runBusy }) => {
    const [events, setEvents] = useState(null);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState("all");
    const [sort, setSort] = useState("newest");
    const [limit, setLimit] = useState(80);
    const [editingKey, setEditingKey] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [creating, setCreating] = useState(false);
    const [createForm, setCreateForm] = useState({});
    const [reactionQueue, setReactionQueue] = useState([]);
    const [reactionClock, setReactionClock] = useState(() => Date.now());
    const isMobile = useIsMobile();
    const touch = useTouchPrimary();

    const currentDate = cleanEventText(game?.gameDate || game?.startDate);
    const NPC_REACTION_GRACE_MS = 12000;
    const eventReactionIdentity = (event) => [
        cleanEventText(event?.id),
        cleanEventText(event?.createdAt),
    ].join("\u001f");
    const queueReactionIdentity = (entry) => [
        cleanEventText(entry?.sourceEventId),
        cleanEventText(entry?.sourceEventCreatedAt),
    ].join("\u001f");
    const pendingReactionFor = (event) => reactionQueue.find((entry) =>
        queueReactionIdentity(entry) === eventReactionIdentity(event));

    const announceReactionQueueChange = () => {
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("oh:event-outreach-queue-changed"));
        }
    };

    const refreshReactionQueue = async () => {
        const world = await readWorldState({ force: true });
        const queue = Array.isArray(world?.pendingEventOutreach) ? world.pendingEventOutreach : [];
        setReactionQueue(queue);
        return { world, queue };
    };

    const syncVisibleTimeline = async (eventList) => {
        const world = await readWorldState({ force: true });
        const synced = syncManualEventTimelineHistory(world, eventList, game);
        if (synced.changed) await writeWorldState(synced.world);
        return synced.changed;
    };

    const load = async () => {
        const next = await readEventsState({ force: true });
        const list = Array.isArray(next) ? next : [];
        await syncVisibleTimeline(list);
        await refreshReactionQueue();
        setEvents(list);
        return list;
    };

    useEffect(() => {
        let cancelled = false;
        load()
            .then((next) => { if (!cancelled) setEvents(Array.isArray(next) ? next : []); })
            .catch((error) => {
                console.warn("[cheats] event/timeline load failed:", error);
                if (!cancelled) setEvents([]);
            });
        return () => { cancelled = true; };
        // This is a one-time editor-entry repair pass for legacy manual events.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (reactionQueue.length === 0) return undefined;
        const timer = setInterval(() => setReactionClock(Date.now()), 500);
        return () => clearInterval(timer);
    }, [reactionQueue.length]);

    useEffect(() => {
        const refresh = () => {
            Promise.all([readEventsState({ force: true }), refreshReactionQueue()])
                .then(([nextEvents]) => setEvents(Array.isArray(nextEvents) ? nextEvents : []))
                .catch(() => {});
        };
        window.addEventListener("oh:event-outreach-evaluated", refresh);
        window.addEventListener("oh:event-outreach-queue-changed", refresh);
        return () => {
            window.removeEventListener("oh:event-outreach-evaluated", refresh);
            window.removeEventListener("oh:event-outreach-queue-changed", refresh);
        };
    }, []);

    const persist = async (nextEvents) => {
        const ordered = sortEventsChronologically(nextEvents);
        await writeEventsState(ordered);
        const persistedRaw = await readEventsState({ force: true });
        const persisted = Array.isArray(persistedRaw) ? persistedRaw : ordered;
        await syncVisibleTimeline(persisted);
        setEvents(persisted);
        return persisted;
    };

    const syncReactionQueueForEvent = async (event, enabled, { restart = false } = {}) => {
        const world = await readWorldState({ force: true });
        const queue = Array.isArray(world?.pendingEventOutreach) ? [...world.pendingEventOutreach] : [];
        const key = eventReactionIdentity(event);
        const existingIndex = queue.findIndex((entry) => queueReactionIdentity(entry) === key);
        let nextQueue = queue;

        if (!enabled || event?.npcReaction?.evaluatedAt) {
            if (existingIndex >= 0) nextQueue = queue.filter((_, index) => index !== existingIndex);
        } else if (existingIndex < 0) {
            nextQueue = [...queue, {
                id: `event-outreach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sourceEventId: cleanEventText(event.id),
                sourceEventCreatedAt: cleanEventText(event.createdAt),
                queuedAt: new Date().toISOString(),
                deliverAfter: new Date(Date.now() + NPC_REACTION_GRACE_MS).toISOString(),
                attempts: 0,
                lastError: "",
            }];
        } else if (restart) {
            nextQueue = queue.map((entry, index) => index === existingIndex
                ? { ...entry, queuedAt: new Date().toISOString(), deliverAfter: new Date(Date.now() + NPC_REACTION_GRACE_MS).toISOString(), attempts: 0, lastError: "" }
                : entry);
        }

        if (JSON.stringify(nextQueue) !== JSON.stringify(queue)) {
            await writeWorldState({ ...world, pendingEventOutreach: nextQueue });
            setReactionQueue(nextQueue);
            announceReactionQueueChange();
        } else {
            setReactionQueue(queue);
        }
        return nextQueue;
    };

    const beginCreate = () => {
        setEditingKey(null);
        setEditForm({});
        setCreating(true);
        setCreateForm({
            date: currentDate,
            title: "",
            description: "",
            quoteText: "",
            quoteSpeaker: "",
            quoteRole: "",
            importance: "major",
            kind: "world",
            notable: true,
            playerRelated: false,
            allowNpcReactions: false,
        });
    };

    const beginEdit = (event, editorKey) => {
        setCreating(false);
        setEditingKey(editorKey);
        setEditForm({
            title: event.title || "",
            date: event.date || "",
            description: event.description || "",
            quoteText: event?.quote?.text || "",
            quoteSpeaker: event?.quote?.speaker || "",
            quoteRole: event?.quote?.role || "",
            importance: event.importance || "minor",
            kind: event.kind || "world",
            notable: Boolean(event.notable),
            playerRelated: Boolean(event.playerRelated),
            allowNpcReactions: Boolean(event?.npcReaction?.enabled),
        });
    };

    const sourceGroup = (event) => {
        const source = cleanEventText(event?.source).toLowerCase();
        if (source.includes("manual") || source.includes("gm")) return "manual";
        if (source === "scenario") return "scenario";
        return "campaign";
    };

    const importanceOptions = useMemo(() => {
        const values = new Set(["minor", "major"]);
        for (const event of events ?? []) if (cleanEventText(event?.importance)) values.add(cleanEventText(event.importance));
        return [...values];
    }, [events]);

    const kindOptions = useMemo(() => {
        const values = new Set(["world", "player", "diplomacy", "military", "economic", "domestic"]);
        for (const event of events ?? []) if (cleanEventText(event?.kind)) values.add(cleanEventText(event.kind));
        return [...values];
    }, [events]);

    // Event IDs in older/generated saves are not guaranteed to be globally unique.
    // The editor therefore uses a UI-local row locator instead of assuming event.id
    // uniquely identifies one canonical timeline entry. This avoids React key collisions
    // and, more importantly, prevents editing/deleting every event that shares an ID.
    const indexedEvents = useMemo(() => (events ?? []).map((event, sourceIndex) => ({
        event,
        sourceIndex,
        editorKey: [
            cleanEventText(event?.id) || "event",
            cleanEventText(event?.createdAt) || "no-created-at",
            sourceIndex,
        ].join("::"),
    })), [events]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = indexedEvents.filter(({ event }) => {
            if (filter === "campaign" && sourceGroup(event) !== "campaign") return false;
            if (filter === "manual" && sourceGroup(event) !== "manual") return false;
            if (filter === "notable" && !event?.notable) return false;
            if (filter === "player" && !event?.playerRelated) return false;
            if (!q) return true;
            const haystack = [
                event?.date,
                event?.title,
                event?.description,
                event?.quote?.text,
                event?.quote?.speaker,
                event?.quote?.role,
                event?.importance,
                event?.kind,
                event?.source,
                ...(Array.isArray(event?.combatants) ? event.combatants : []),
            ].map((value) => cleanEventText(value)).join(" ").toLowerCase();
            return haystack.includes(q);
        });
        return list.sort((a, b) => {
            const dateCompare = compareGameDates(cleanEventText(a.event?.date), cleanEventText(b.event?.date));
            const createdCompare = cleanEventText(a.event?.createdAt).localeCompare(cleanEventText(b.event?.createdAt));
            const sourceCompare = a.sourceIndex - b.sourceIndex;
            const result = dateCompare || createdCompare || sourceCompare;
            return sort === "oldest" ? result : -result;
        });
    }, [indexedEvents, filter, search, sort]);

    const counts = useMemo(() => ({
        total: (events ?? []).length,
        campaign: (events ?? []).filter((event) => sourceGroup(event) === "campaign").length,
        manual: (events ?? []).filter((event) => sourceGroup(event) === "manual").length,
        notable: (events ?? []).filter((event) => event?.notable).length,
    }), [events]);

    const eventQuoteFromForm = (form) => {
        const text = cleanEventText(form?.quoteText);
        if (!text) return null;
        const speaker = cleanEventText(form?.quoteSpeaker);
        const role = cleanEventText(form?.quoteRole);
        return {
            text,
            ...(speaker ? { speaker } : {}),
            ...(role ? { role } : {}),
        };
    };

    const renderQuoteEditor = (form, setForm) => (
        <details style={{ ...editorFieldStyle, marginTop: "0.5rem", padding: "0.45rem 0.55rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.68rem", fontWeight: 750, ...(touch ? TOUCH_SUMMARY : null) }}>Optional quotation</summary>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.6rem", lineHeight: 1.4, marginTop: "0.45rem" }}>
                Quotes are occasional presentation metadata, not a mechanical impact. Leave blank for ordinary events.
            </div>
            <label style={{ display: "block", marginTop: "0.5rem" }}>
                <span style={labelStyle}>Quote text</span>
                <textarea
                    rows={3}
                    style={{ ...inputStyle, lineHeight: 1.4, resize: "vertical" }}
                    value={form.quoteText ?? ""}
                    onChange={(e) => setForm({ ...form, quoteText: e.target.value })}
                    placeholder="Quotation text without surrounding quotation marks"
                />
            </label>
            <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.5rem" }}>
                <label>
                    <span style={labelStyle}>Speaker</span>
                    <input style={inputStyle} value={form.quoteSpeaker ?? ""} onChange={(e) => setForm({ ...form, quoteSpeaker: e.target.value })} placeholder="Optional attribution" />
                </label>
                <label>
                    <span style={labelStyle}>Role / title</span>
                    <input style={inputStyle} value={form.quoteRole ?? ""} onChange={(e) => setForm({ ...form, quoteRole: e.target.value })} placeholder="Optional office or role" />
                </label>
            </div>
        </details>
    );

    // The inline minHeight would beat the tap class, so a touch screen gets the
    // thumb-sized one here.
    const choiceButton = (active) => ({
        ...buttonStyle,
        background: active ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.05)",
        borderColor: active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)",
        color: active ? "#f4f4f5" : "rgba(255,255,255,0.7)",
        fontSize: "0.64rem",
        minHeight: touch ? "2.75rem" : "2rem",
        padding: "0.34rem 0.48rem",
        textTransform: "capitalize",
    });

    const renderMetadataEditor = (form, setForm) => (
        <details style={{ ...editorFieldStyle, marginTop: "0.5rem", padding: "0.45rem 0.55rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.68rem", fontWeight: 750, ...(touch ? TOUCH_SUMMARY : null) }}>Advanced event metadata</summary>
            <div style={{ marginTop: "0.55rem" }}>
                <span style={labelStyle}>Importance</span>
                <div style={{ display: "grid", gap: "0.35rem", gridTemplateColumns: `repeat(${Math.max(1, Math.min(importanceOptions.length, 4))}, minmax(0, 1fr))` }}>
                    {importanceOptions.map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setForm({ ...form, importance: value })}
                            style={choiceButton((form.importance ?? "minor") === value)}
                        >
                            {value}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ marginTop: "0.5rem" }}>
                <span style={labelStyle}>Kind</span>
                {/* Two across on a phone: the list also carries every kind the
                    record uses, and a long one did not fit a third of it. */}
                <div style={{ display: "grid", gap: "0.35rem", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))" }}>
                    {kindOptions.map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setForm({ ...form, kind: value })}
                            style={choiceButton((form.kind ?? "world") === value)}
                        >
                            {value}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1rem", marginTop: "0.55rem" }}>
                <label className="oh-tap-row" style={{ alignItems: "center", cursor: "pointer", display: "flex", fontSize: "0.7rem", gap: "0.38rem" }}>
                    <input type="checkbox" checked={Boolean(form.notable)} onChange={(e) => setForm({ ...form, notable: e.target.checked })} />
                    Notable
                </label>
                <label className="oh-tap-row" style={{ alignItems: "center", cursor: "pointer", display: "flex", fontSize: "0.7rem", gap: "0.38rem" }}>
                    <input type="checkbox" checked={Boolean(form.playerRelated)} onChange={(e) => setForm({ ...form, playerRelated: e.target.checked })} />
                    Player-related
                </label>
            </div>
        </details>
    );

    const renderNpcReactionEditor = (form, setForm) => (
        <div style={{
            ...editorFieldStyle,
            background: form.allowNpcReactions ? "rgba(16,185,129,0.07)" : editorFieldStyle.background,
            borderColor: form.allowNpcReactions ? "rgba(52,211,153,0.28)" : editorFieldStyle.border,
            marginTop: "0.5rem",
            padding: "0.55rem 0.62rem",
        }}>
            <label style={{ alignItems: "flex-start", cursor: "pointer", display: "flex", gap: "0.5rem" }}>
                <input
                    type="checkbox"
                    checked={Boolean(form.allowNpcReactions)}
                    onChange={(e) => setForm({ ...form, allowNpcReactions: e.target.checked })}
                    style={{ marginTop: "0.12rem" }}
                />
                <span>
                    <span style={{ color: form.allowNpcReactions ? "#a7f3d0" : "rgba(255,255,255,0.82)", display: "block", fontSize: "0.7rem", fontWeight: 800 }}>
                        Allow NPC diplomatic reactions
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.42)", display: "block", fontSize: "0.6rem", lineHeight: 1.4, marginTop: "0.14rem" }}>
                        After a 12-second undo window, the AI may send one natural diplomatic follow-up — or none. Minor friendly reactions such as congratulations, condolences, curiosity, or simple goodwill are allowed; enabling this never guarantees a message.
                    </span>
                </span>
            </label>
        </div>
    );

    const statusLine = status && (
        <div style={{ color: status.startsWith("Failed") ? "#fca5a5" : "rgba(191,219,254,0.9)", fontSize: "0.72rem", marginTop: "0.55rem" }}>
            {status}
        </div>
    );

    return (
        <>
        {header(meta.title, meta.subtitle)}
        <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflowY: "auto", paddingRight: "0.12rem" }}>
            <div style={{
                background: "rgba(255,255,255,0.045)",
                border: "1px solid rgba(96,165,250,0.2)",
                borderRadius: 10,
                color: "rgba(219,234,254,0.78)",
                fontSize: "0.66rem",
                lineHeight: 1.4,
                padding: "0.55rem 0.65rem",
            }}>
                <strong style={{ color: "#dbeafe" }}>Canonical history editor.</strong> Text, optional quotations, and metadata edits immediately change the persistent timeline. Already-applied state effects are deliberately not replayed, reverted, or reinterpreted here.
            </div>

            <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", marginTop: "0.55rem" }}>
                {[
                    ["Events", counts.total],
                    ["Campaign", counts.campaign],
                    ["Notable", counts.notable],
                    ["Manual", counts.manual],
                ].map(([label, value]) => (
                    <div key={label} style={{ ...editorFieldStyle, minWidth: 0, padding: "0.45rem 0.5rem" }}>
                        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.52rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
                        <div style={{ fontSize: "0.9rem", fontWeight: 850, marginTop: "0.1rem" }}>{value}</div>
                    </div>
                ))}
            </div>

            <button type="button" className="oh-tap-row" disabled={busy} onClick={beginCreate} style={{ ...primaryButtonStyle, marginTop: "0.55rem", width: "100%" }}>
                + Add exact event
            </button>

            {creating && (
                <div style={{ ...editorFieldStyle, borderColor: "rgba(255,255,255,0.23)", marginTop: "0.55rem" }}>
                    <div style={{ color: "#f4f4f5", fontSize: "0.7rem", fontWeight: 850, letterSpacing: "0.04em", textTransform: "uppercase" }}>New canonical event</div>
                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.62rem", lineHeight: 1.35, marginTop: "0.18rem" }}>
                        Inserts history directly and links it into the normal Events panel. Optional NPC reactions are evaluated separately only after the undo window.
                    </div>
                    <label style={{ display: "block", marginTop: "0.55rem" }}>
                        <span style={labelStyle}>Date</span>
                        <input type="date" style={{ ...inputStyle, colorScheme: "dark" }} value={createForm.date ?? ""} onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })} />
                    </label>
                    <label style={{ display: "block", marginTop: "0.45rem" }}>
                        <span style={labelStyle}>Title</span>
                        <input style={inputStyle} value={createForm.title ?? ""} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="Exact event title" />
                    </label>
                    <label style={{ display: "block", marginTop: "0.45rem" }}>
                        <span style={labelStyle}>Description</span>
                        <textarea rows={4} style={{ ...inputStyle, lineHeight: 1.4, resize: "vertical" }} value={createForm.description ?? ""} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="What canonically happened?" />
                    </label>
                    {renderQuoteEditor(createForm, setCreateForm)}
                    {renderMetadataEditor(createForm, setCreateForm)}
                    {renderNpcReactionEditor(createForm, setCreateForm)}
                    <div style={{ display: "flex", gap: "0.45rem", marginTop: "0.55rem" }}>
                        <button
                            type="button"
                            className="oh-tap-row"
                            disabled={busy}
                            onClick={() => runBusy(async () => {
                                const title = cleanEventText(createForm.title);
                                const description = cleanEventBody(createForm.description);
                                const date = cleanEventText(createForm.date);
                                const quote = eventQuoteFromForm(createForm);
                                if (!date) throw new Error("Exact events need a date.");
                                if (!title) throw new Error("Exact events need a title.");
                                if (!description) throw new Error("Exact events need a description.");
                                const nextEvent = {
                                    createdAt: new Date().toISOString(),
                                    date,
                                    description,
                                    id: manualEventId(),
                                    importance: cleanEventText(createForm.importance) || "major",
                                    kind: cleanEventText(createForm.kind) || "world",
                                    notable: Boolean(createForm.notable),
                                    playerRelated: Boolean(createForm.playerRelated),
                                    ...(quote ? { quote } : {}),
                                    ...(createForm.allowNpcReactions ? { npcReaction: { enabled: true } } : {}),
                                    source: "manual",
                                    title,
                                };
                                const persisted = await persist([...(events ?? []), nextEvent]);
                                const persistedEvent = persisted.find((event) => eventReactionIdentity(event) === eventReactionIdentity(nextEvent)) || nextEvent;
                                if (createForm.allowNpcReactions) {
                                    await syncReactionQueueForEvent(persistedEvent, true);
                                }
                                await noteGmChange("timeline", `Wrote the event "${title}" (${date}) into the record by hand.`);
                                setCreating(false);
                                setCreateForm({});
                                setFilter("all");
                                setSort("newest");
                                setLimit(80);
                                return createForm.allowNpcReactions
                                    ? `Exact event added: ${title}. NPC reactions may arrive after the 12-second undo window.`
                                    : `Exact event added to canonical history and linked to the Events panel: ${title}`;
                            })}
                            style={{ ...primaryButtonStyle, flex: 1 }}
                        >
                            Add to canonical history
                        </button>
                        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => { setCreating(false); setCreateForm({}); }} style={buttonStyle}>Cancel</button>
                    </div>
                </div>
            )}

            {/* On a phone the search has the whole row and the sort goes under
                it: beside a 9rem sort, the field was too short to read. */}
            <div style={{ display: "flex", flexWrap: isMobile ? "wrap" : undefined, gap: "0.4rem", marginTop: "0.55rem" }}>
                <input
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                    value={search}
                    onChange={(event) => { setSearch(event.target.value); setLimit(80); }}
                    placeholder="Search title, description, date, kind…"
                />
                <div style={{ display: "grid", flexShrink: 0, gap: "0.25rem", gridTemplateColumns: "1fr 1fr", width: isMobile ? "100%" : "9rem" }}>
                    <button type="button" onClick={() => setSort("newest")} style={choiceButton(sort === "newest")}>Newest</button>
                    <button type="button" onClick={() => setSort("oldest")} style={choiceButton(sort === "oldest")}>Oldest</button>
                </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                {[
                    ["all", "All"],
                    ["campaign", "Campaign"],
                    ["notable", "Notable"],
                    ["player", "Player"],
                    ["manual", "Manual"],
                ].map(([value, label]) => (
                    <button key={value} type="button" className="oh-tap-row" onClick={() => { setFilter(value); setLimit(80); }} style={eventFilterButtonStyle(filter === value)}>{label}</button>
                ))}
                <span style={{ alignSelf: "center", color: "rgba(255,255,255,0.34)", fontSize: "0.62rem", marginLeft: "auto" }}>
                    {filtered.length} match{filtered.length === 1 ? "" : "es"}
                </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem" }}>
                {events === null && <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.74rem", padding: "0.5rem" }}>Loading canonical timeline…</div>}
                {events !== null && filtered.length === 0 && <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.74rem", padding: "0.5rem" }}>No matching events.</div>}

                {filtered.slice(0, limit).map(({ event, sourceIndex, editorKey }) => {
                    const isEditing = editingKey === editorKey;
                    const impact = eventImpactSummary(event);
                    const major = cleanEventText(event.importance).toLowerCase() === "major";
                    const manual = sourceGroup(event) === "manual";
                    const source = cleanEventText(event.source) || "scenario";
                    const pendingReaction = pendingReactionFor(event);
                    const pendingReactionMs = pendingReaction
                        ? Math.max(0, Date.parse(cleanEventText(pendingReaction.deliverAfter)) - reactionClock)
                        : 0;
                    const pendingReactionSeconds = pendingReaction ? Math.max(0, Math.ceil(pendingReactionMs / 1000)) : 0;
                    const reactionResult = cleanEventText(event?.npcReaction?.result).toLowerCase();
                    return (
                        <div key={editorKey} style={{ ...editorFieldStyle, borderColor: isEditing ? "rgba(255,255,255,0.23)" : "rgba(255,255,255,0.1)", padding: "0.55rem 0.6rem" }}>
                            <div style={{ alignItems: "flex-start", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                                <div style={{ minWidth: 0 }}>
                                    <div data-no-translate style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.62rem", fontWeight: 700 }}>{event.date || "Undated"}</div>
                                    <div style={{ fontSize: "0.78rem", fontWeight: 780, lineHeight: 1.28, marginTop: "0.08rem" }}>{event.title || "(untitled)"}</div>
                                </div>
                                <div style={{ display: "flex", flexShrink: 0, gap: "0.3rem" }}>
                                    <button type="button" className="oh-tap-row" disabled={busy} style={{ ...buttonStyle, padding: "0.28rem 0.5rem" }} onClick={() => isEditing ? setEditingKey(null) : beginEdit(event, editorKey)}>{isEditing ? "Close" : "Edit"}</button>
                                    <button
                                        type="button"
                                        className="oh-tap"
                                        disabled={busy}
                                        aria-label="Delete event"
                                        title="Delete event from canonical history"
                                        style={{ ...buttonStyle, borderColor: "rgba(244,63,94,0.32)", color: "#fda4af", padding: "0.28rem 0.48rem" }}
                                        onClick={() => {
                                            const warning = impact.count
                                                ? `Delete “${event.title || "this event"}” from canonical history?\n\nThis event has ${impact.count} structured state impact(s). Deleting the timeline record will NOT undo state changes that were already applied.`
                                                : `Delete “${event.title || "this event"}” from canonical history?`;
                                            if (!window.confirm(warning)) return;
                                            void runBusy(async () => {
                                                await persist((events ?? []).filter((_, index) => index !== sourceIndex));
                                                await syncReactionQueueForEvent(event, false);
                                                await noteGmChange("timeline", `Deleted the event "${cleanEventText(event.title) || "untitled"}"${cleanEventText(event.date) ? ` (${cleanEventText(event.date)})` : ""} from the record${impact.count ? "; what it changed on the map was left as it is" : ""}.`);
                                                if (editingKey === editorKey) setEditingKey(null);
                                                return pendingReaction
                                                    ? "Event removed from canonical history and its pending diplomatic reaction was cancelled. Existing world state was left untouched."
                                                    : "Event removed from canonical history. Existing world state was left untouched.";
                                            });
                                        }}
                                    >🗑</button>
                                </div>
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.28rem", marginTop: "0.38rem" }}>
                                {major && <span style={eventBadgeStyle("rgba(251,191,36,0.85)")}>Major</span>}
                                {event.notable && <span style={eventBadgeStyle("#e4e4e7")}>Notable</span>}
                                {event.playerRelated && <span style={eventBadgeStyle("rgba(96,165,250,0.85)")}>Player</span>}
                                {manual && <span style={eventBadgeStyle("rgba(52,211,153,0.85)")}>Manual</span>}
                                {event?.quote?.text && <span style={eventBadgeStyle("rgba(148,163,184,0.82)")}>Quote</span>}
                                {pendingReaction && <span style={eventBadgeStyle("rgba(52,211,153,0.9)")}>NPC reaction pending · {pendingReactionSeconds}s</span>}
                                {!pendingReaction && reactionResult === "sent" && <span style={eventBadgeStyle("rgba(96,165,250,0.85)")}>NPC chat sent</span>}
                                {impact.count > 0 && <span title={impact.text} style={eventBadgeStyle("rgba(248,113,113,0.82)")}>State-linked · {impact.count}</span>}
                                <span style={eventBadgeStyle()}>{cleanEventText(event.kind) || "world"}</span>
                            </div>

                            {!isEditing && event.description && (
                                <div style={{ color: "rgba(255,255,255,0.49)", fontSize: "0.66rem", lineHeight: 1.4, marginTop: "0.38rem" }}>
                                    {event.description.length > 260 ? `${event.description.slice(0, 257)}…` : event.description}
                                </div>
                            )}
                            {pendingReaction && !isEditing && (
                                <div style={{ alignItems: "center", background: "rgba(16,185,129,0.055)", border: "1px solid rgba(52,211,153,0.18)", borderRadius: 8, display: "flex", gap: "0.5rem", justifyContent: "space-between", marginTop: "0.45rem", padding: "0.4rem 0.48rem" }}>
                                    <div style={{ color: "rgba(167,243,208,0.72)", fontSize: "0.61rem", lineHeight: 1.35 }}>
                                        NPCs may react after the grace window. Editing this event before delivery changes what they evaluate. Delivery check in {pendingReactionSeconds}s.
                                    </div>
                                    <button
                                        type="button"
                                        className="oh-tap-row"
                                        disabled={busy}
                                        onClick={() => runBusy(async () => {
                                            const next = (events ?? []).map((entry, index) => index === sourceIndex
                                                ? { ...entry, npcReaction: { ...(entry?.npcReaction || {}), enabled: false } }
                                                : entry);
                                            const persisted = await persist(next);
                                            const persistedEvent = persisted.find((candidate) => eventReactionIdentity(candidate) === eventReactionIdentity(event)) || event;
                                            await syncReactionQueueForEvent(persistedEvent, false);
                                            return "Pending NPC reaction cancelled. The event remains canonical.";
                                        })}
                                        style={{ ...buttonStyle, flexShrink: 0, fontSize: "0.62rem", padding: "0.3rem 0.45rem" }}
                                    >
                                        Cancel delivery
                                    </button>
                                </div>
                            )}
                            {!pendingReaction && !isEditing && reactionResult === "silent" && (
                                <div style={{ background: "rgba(148,163,184,0.055)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 8, color: "rgba(212,212,216,0.72)", fontSize: "0.61rem", lineHeight: 1.35, marginTop: "0.45rem", padding: "0.4rem 0.48rem" }}>
                                    NPC reaction check complete. No chat message sent.
                                </div>
                            )}
                            {!pendingReaction && !isEditing && reactionResult === "sent" && (
                                <div style={{ background: "rgba(59,130,246,0.055)", border: "1px solid rgba(96,165,250,0.18)", borderRadius: 8, color: "rgba(191,219,254,0.78)", fontSize: "0.61rem", lineHeight: 1.35, marginTop: "0.45rem", padding: "0.4rem 0.48rem" }}>
                                    NPC reaction check complete. 1 chat message sent.
                                </div>
                            )}
                            {!isEditing && event?.quote?.text && (
                                <div style={{ borderLeft: "2px solid rgba(148,163,184,0.38)", marginTop: "0.45rem", padding: "0.08rem 0 0.08rem 0.58rem" }}>
                                    <div style={{ color: "rgba(247,247,249,0.78)", fontSize: "0.65rem", fontStyle: "italic", lineHeight: 1.45 }}>
                                        “{event.quote.text}”
                                    </div>
                                    {(event.quote.speaker || event.quote.role) && (
                                        <div style={{ color: "rgba(206,206,210,0.46)", fontSize: "0.58rem", marginTop: "0.2rem" }}>
                                            — {event.quote.speaker || "Unknown speaker"}{event.quote.role ? `, ${event.quote.role}` : ""}
                                        </div>
                                    )}
                                </div>
                            )}

                            {isEditing && (
                                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "0.55rem", paddingTop: "0.5rem" }}>
                                    <label>
                                        <span style={labelStyle}>Date</span>
                                        <input type="date" style={{ ...inputStyle, colorScheme: "dark" }} value={editForm.date ?? ""} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
                                    </label>
                                    <label style={{ display: "block", marginTop: "0.45rem" }}>
                                        <span style={labelStyle}>Title</span>
                                        <input style={inputStyle} value={editForm.title ?? ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                                    </label>
                                    <label style={{ display: "block", marginTop: "0.45rem" }}>
                                        <span style={labelStyle}>Description</span>
                                        <textarea rows={5} style={{ ...inputStyle, lineHeight: 1.4, resize: "vertical" }} value={editForm.description ?? ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                                    </label>
                                    {renderQuoteEditor(editForm, setEditForm)}
                                    {renderMetadataEditor(editForm, setEditForm)}
                                    {renderNpcReactionEditor(editForm, setEditForm)}
                                    {pendingReaction && (
                                        <div style={{ color: "rgba(167,243,208,0.72)", fontSize: "0.61rem", lineHeight: 1.4, marginTop: "0.45rem" }}>
                                            Reaction evaluation is pending. Saving text/date changes does not reset the timer; the worker will re-read this exact event before delivery.
                                        </div>
                                    )}
                                    {impact.count > 0 && (
                                        <div style={{ background: "rgba(127,29,29,0.13)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, color: "rgba(254,202,202,0.78)", fontSize: "0.62rem", lineHeight: 1.4, marginTop: "0.5rem", padding: "0.45rem 0.52rem" }}>
                                            <strong>Structured state already applied:</strong> {impact.text}. Saving this editor changes the canonical event record only; those effects are preserved exactly as they are.
                                        </div>
                                    )}
                                    <div style={{ color: "rgba(255,255,255,0.28)", fontSize: "0.56rem", marginTop: "0.45rem", overflowWrap: "anywhere" }}>
                                        ID {event.id} · source {source}
                                    </div>
                                    <div style={{ display: "flex", gap: "0.45rem", marginTop: "0.55rem" }}>
                                        <button
                                            type="button"
                                            className="oh-tap-row"
                                            disabled={busy}
                                            onClick={() => runBusy(async () => {
                                                const title = cleanEventText(editForm.title);
                                                const description = cleanEventBody(editForm.description);
                                                const date = cleanEventText(editForm.date);
                                                const quote = eventQuoteFromForm(editForm);
                                                if (!date) throw new Error("Events need a date.");
                                                if (!title) throw new Error("Events need a title.");
                                                const wasEnabled = Boolean(event?.npcReaction?.enabled);
                                                const enabled = Boolean(editForm.allowNpcReactions);
                                                const deliberatelyReenabled = enabled && !wasEnabled;
                                                const nextReaction = enabled
                                                    ? deliberatelyReenabled
                                                        ? { enabled: true }
                                                        : { ...(event?.npcReaction || {}), enabled: true }
                                                    : { ...(event?.npcReaction || {}), enabled: false };
                                                const next = (events ?? []).map((entry, index) => index === sourceIndex
                                                    ? {
                                                        ...entry,
                                                        date,
                                                        description,
                                                        importance: cleanEventText(editForm.importance) || entry.importance || "minor",
                                                        kind: cleanEventText(editForm.kind) || entry.kind || "world",
                                                        notable: Boolean(editForm.notable),
                                                        playerRelated: Boolean(editForm.playerRelated),
                                                        quote: quote || null,
                                                        npcReaction: nextReaction,
                                                        title,
                                                    }
                                                    : entry);
                                                const persisted = await persist(next);
                                                const persistedEvent = persisted.find((candidate) => eventReactionIdentity(candidate) === eventReactionIdentity(event));
                                                if (persistedEvent) {
                                                    await syncReactionQueueForEvent(persistedEvent, enabled, { restart: deliberatelyReenabled });
                                                }
                                                // Only what the record now SAYS differently — a badge or a
                                                // reaction switch is not news to the simulation.
                                                const rewritten = [
                                                    cleanEventText(event.title) !== title ? `retitled it "${title}"` : "",
                                                    cleanEventText(event.date) !== date ? `redated it to ${date}` : "",
                                                    cleanEventBody(event.description) !== description ? "rewrote what it says" : "",
                                                ].filter(Boolean);
                                                if (rewritten.length) {
                                                    await noteGmChange("timeline", `Edited the event "${cleanEventText(event.title) || title}" by hand: ${rewritten.join(", ")}.`);
                                                }
                                                setEditingKey(null);
                                                setEditForm({});
                                                return `Canonical event updated: ${title}`;
                                            })}
                                            style={{ ...primaryButtonStyle, flex: 1 }}
                                        >
                                            Save canonical edit
                                        </button>
                                        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => { setEditingKey(null); setEditForm({}); }} style={buttonStyle}>Cancel</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {filtered.length > limit && (
                    <button type="button" className="oh-tap-row" onClick={() => setLimit((value) => value + 80)} style={{ ...buttonStyle, width: "100%" }}>
                        Show 80 more · {filtered.length - limit} remaining
                    </button>
                )}
            </div>
            {statusLine}
        </div>
        </>
    );
};

const ToolView = ({ tool, header, busy, status, game, polities, refresh, runBusy, beginClickMode, endClickMode, setStatus, navigateTool, closePanel }) => {
    const meta = TOOLS.find((entry) => entry.id === tool);
    const [text, setText] = useState("");
    const [gmMode, setGmMode] = useState("world-intervention");
    const [gmPreview, setGmPreview] = useState(null);
    const [gmApplyResult, setGmApplyResult] = useState(null);
    const [gmExpandedSections, setGmExpandedSections] = useState({});
    const [target, setTarget] = useState("");
    const [fields, setFields] = useState({});
    const [items, setItems] = useState(null);
    const [search, setSearch] = useState("");
    const [editingId, setEditingId] = useState(null);
    const isMobile = useIsMobile();
    const touch = useTouchPrimary();

    const loadMapFeatureData = async () => {
        const [world, geojson] = await Promise.all([
            readWorldState({ force: true }),
            readJson(JSON_URLS.citiesGeojson, { defaultValue: EMPTY_FEATURES, force: true }).catch(() => EMPTY_FEATURES),
        ]);
        const data = {
            customCities: Boolean(world?.customCities),
            markers: Array.isArray(world?.markers) ? world.markers : [],
            cities: Array.isArray(geojson?.features) ? geojson.features : [],
        };
        setItems(data);
        return data;
    };

    // History Document: the living document, the ledger of passes behind it, and
    // where the next pass stands. Every read is forced: this tool exists to show
    // what the save says right now.
    const loadHistoryDocument = async () => {
        const [world, events, chats, actions] = await Promise.all([
            readWorldState({ force: true }),
            readEventsState({ force: true }),
            readJson(JSON_URLS.chat, { defaultValue: [], force: true }).catch(() => []),
            readJson(JSON_URLS.actions, { defaultValue: [], force: true }).catch(() => []),
        ]);
        const bundle = { world, events, chats, actions, game };
        const data = {
            document: world?.historyDocument ?? null,
            passes: Array.isArray(world?.consolidatedHistory) ? world.consolidatedHistory : [],
            status: { ...describeHistoryConsolidation(bundle), canFoldNow: planHistoryConsolidation(bundle, { force: true }).due },
            totalEvents: Array.isArray(events) ? events.length : 0,
        };
        setItems(data);
        setFields({ document: data.document?.text ?? "" });
        return data;
    };

    const saveScenarioCities = async (features) => {
        const cityNames = (list) => new Set((Array.isArray(list) ? list : [])
            .map((feature) => String(feature?.properties?.name ?? "").trim()).filter(Boolean));
        const before = cityNames((await readJson(JSON_URLS.citiesGeojson, { defaultValue: EMPTY_FEATURES, force: true }).catch(() => EMPTY_FEATURES))?.features);
        await writeJson(JSON_URLS.citiesGeojson, { type: "FeatureCollection", features }, { pretty: true });
        notifyCitiesUpdated();
        const after = cityNames(features);
        const added = [...after].filter((name) => !before.has(name));
        const removed = [...before].filter((name) => !after.has(name));
        const listed = (names) => `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
        const parts = [
            added.length ? `added the cit${added.length === 1 ? "y" : "ies"} ${listed(added)}` : "",
            removed.length ? `removed the cit${removed.length === 1 ? "y" : "ies"} ${listed(removed)}` : "",
        ].filter(Boolean);
        await noteGmChange("feature", parts.length
            ? `${capitalize(parts.join("; "))} on the map by hand.`
            : "Edited the details of the map's cities by hand.");
        return loadMapFeatureData();
    };

    // One line for the next time skip, from the operations themselves.
    const describeAdminMarkerOps = (markerOps) => {
        const ops = Array.isArray(markerOps) ? markerOps : [];
        const named = (op) => String(op?.name ?? op?.markerId ?? "a feature").trim();
        const group = (verb, list) => {
            if (!list.length) return "";
            const names = list.map(named);
            return `${verb} ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
        };
        const byOp = (kind) => ops.filter((op) => String(op?.op ?? "").toLowerCase() === kind);
        const parts = [
            group("placed", byOp("add").concat(byOp("create"))),
            group("changed", byOp("update")),
            group("removed", byOp("remove").concat(byOp("delete"))),
        ].filter(Boolean);
        return parts.length
            ? `${capitalize(parts.join("; "))} on the map by hand.`
            : "Edited the map's features by hand.";
    };

    const applyAdminMarkerOps = async (markerOps) => {
        const world = await readWorldState({ force: true });
        const result = applyEventImpactsToWorld({
            world,
            game,
            events: [{
                id: `admin-map-feature-${Date.now().toString(36)}`,
                date: game?.gameDate || game?.startDate || "",
                title: "Map Feature Editor administrative change",
                description: "Structured administrative mutation from the Map Feature Editor.",
                importance: "minor",
                kind: "world",
                notable: false,
                playerRelated: false,
                impacts: { markerOps },
                source: "manual-admin",
            }],
        });
        await writeWorldState(result.world);
        await noteGmChange("feature", describeAdminMarkerOps(markerOps));
        await refresh();
        return loadMapFeatureData();
    };

    // Tools that browse existing data load it on entry.
    useEffect(() => {
        setItems(null);
        setEditingId(null);
        setGmPreview(null);
        setGmApplyResult(null);
        setGmExpandedSections({});
        setSearch("");
        setFields({});
        setTarget("");
        if (tool === "roll-back-turn") {
            readJson(JSON_URLS.snapshots, { defaultValue: [], force: true })
                .then((list) => setItems(Array.isArray(list) ? list : []))
                .catch(() => setItems([]));
        }
        if (tool === "edit-feature" || tool === "add-feature" || tool === "clear-features") {
            loadMapFeatureData().catch(() => setItems({ customCities: false, markers: [], cities: [] }));
        }
        if (tool === "history-document") {
            loadHistoryDocument().catch((error) => setItems({ document: null, passes: [], status: { text: `Could not read the campaign: ${error.message}`, canFoldNow: false }, totalEvents: 0 }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tool]);

    const statusLine = status && (
        <div style={{ color: status.startsWith("Failed") ? "#fca5a5" : "rgba(191,219,254,0.9)", fontSize: "0.76rem", marginTop: "0.6rem" }}>
        {status}
        </div>
    );

    const politiesByCode = useMemo(() => new Map(polities.map((polity) => [polity.code, polity])), [polities]);
    const nameOf = (code) => politiesByCode.get(code)?.name || code || "unclaimed land";

    // ----- individual tools -----

    if (tool === "reminders") {
        return (
            <RemindersView
                meta={meta}
                header={header}
                busy={busy}
                status={status}
                game={game}
                runBusy={runBusy}
            />
        );
    }

    if (tool === "events") {
        return (
            <EventEditorView
                meta={meta}
                header={header}
                busy={busy}
                status={status}
                game={game}
                runBusy={runBusy}
            />
        );
    }

    if (tool === "interactive-event") {
        return (
            <InteractiveEventView
                meta={meta}
                header={header}
                busy={busy}
                status={status}
                game={game}
                runBusy={runBusy}
                closePanel={closePanel}
            />
        );
    }

    if (tool === "edit-country") {
        return (
            <CountryEditorView
                meta={meta}
                header={header}
                busy={busy}
                status={status}
                polities={polities}
                refresh={refresh}
                runBusy={runBusy}
                beginClickMode={beginClickMode}
                endClickMode={endClickMode}
                setStatus={setStatus}
            />
        );
    }

    if (tool === "master-ai") {
        const transaction = gmPreview?.transaction ?? null;
        const gmApplied = Boolean(gmApplyResult?.applied);
        const events = Array.isArray(transaction?.events) ? transaction.events : [];
        const statPatches = Array.isArray(transaction?.countryStatPatches) ? transaction.countryStatPatches : [];
        const storylineUpdates = Array.isArray(transaction?.storylineUpdates) ? transaction.storylineUpdates : [];
        const warUpdates = Array.isArray(transaction?.warUpdates) ? transaction.warUpdates : [];
        const relationUpdates = Array.isArray(transaction?.relationUpdates) ? transaction.relationUpdates : [];
        const agreementUpdates = Array.isArray(transaction?.agreementUpdates) ? transaction.agreementUpdates : [];
        const puppetUpdates = Array.isArray(transaction?.puppetUpdates) ? transaction.puppetUpdates : [];
        const outreach = Array.isArray(transaction?.diplomaticOutreach) ? transaction.diplomaticOutreach : [];
        const impactCounts = events.reduce((acc, event) => {
            const impacts = event?.impacts ?? {};
            acc.territory += (Array.isArray(impacts.regionTransfers) ? impacts.regionTransfers.length : 0)
                + (Array.isArray(impacts.regionClaims) ? impacts.regionClaims.length : 0);
            acc.polities += Array.isArray(impacts.polityChanges) ? impacts.polityChanges.length : 0;
            acc.politics += Array.isArray(impacts.politicalActorOps) ? impacts.politicalActorOps.length : 0;
            acc.units += Array.isArray(impacts.unitOps) ? impacts.unitOps.length : 0;
            acc.markers += Array.isArray(impacts.markerOps) ? impacts.markerOps.length : 0;
            acc.chats += Array.isArray(impacts.createdChats) ? impacts.createdChats.length : 0;
            return acc;
        }, { territory: 0, polities: 0, politics: 0, units: 0, markers: 0, chats: 0 });

        const eventOps = (field) => events.flatMap((event, eventIndex) =>
            (Array.isArray(event?.impacts?.[field]) ? event.impacts[field] : []).map((op, opIndex) => ({
                ...op,
                _eventIndex: eventIndex,
                _eventTitle: event?.title || `Event ${eventIndex}`,
                _opIndex: opIndex,
            }))
        );
        const transferOps = eventOps("regionTransfers");
        const claimOps = eventOps("regionClaims");
        const controlOps = eventOps("regionControlOps");
        const polityOps = eventOps("polityChanges");
        const politicalOps = eventOps("politicalActorOps");
        const unitOps = eventOps("unitOps");
        const markerOps = eventOps("markerOps");
        const eventChats = eventOps("createdChats");

        const compactJson = (value) => {
            try { return JSON.stringify(value); } catch { return String(value ?? ""); }
        };
        const eventRef = (entry) => `event ${entry._eventIndex}`;
        const exactRowStyle = {
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 7,
            color: "rgba(255,255,255,0.66)",
            fontSize: "0.65rem",
            lineHeight: 1.38,
            marginTop: "0.24rem",
            padding: "0.42rem 0.5rem",
            wordBreak: "break-word",
        };
        const subsectionTitle = (title, count, note = "") => (
            <div style={{ alignItems: "baseline", display: "flex", gap: "0.35rem", justifyContent: "space-between", marginTop: "0.48rem" }}>
                <div style={{ color: "rgba(255,255,255,0.76)", fontSize: "0.67rem", fontWeight: 750, letterSpacing: "0.02em" }}>
                    {title} <span style={{ color: "rgba(147,197,253,0.72)", fontWeight: 600 }}>({count})</span>
                </div>
                {note ? <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.58rem", textAlign: "right" }}>{note}</div> : null}
            </div>
        );

        const GM_COLLAPSED_OPERATION_LIMIT = 4;
        const visibleOperationRows = (sectionId, entries) => {
            const expanded = Boolean(gmExpandedSections[sectionId]);
            return expanded ? entries : entries.slice(0, GM_COLLAPSED_OPERATION_LIMIT);
        };
        const operationExpander = (sectionId, count) => {
            if (count <= GM_COLLAPSED_OPERATION_LIMIT) return null;
            const expanded = Boolean(gmExpandedSections[sectionId]);
            const hidden = Math.max(0, count - GM_COLLAPSED_OPERATION_LIMIT);
            return (
                <button
                    type="button"
                    className="oh-tap-row"
                    onClick={() => setGmExpandedSections((current) => ({ ...current, [sectionId]: !expanded }))}
                    style={{
                        background: "transparent",
                        border: 0,
                        color: "rgba(147,197,253,0.82)",
                        cursor: "pointer",
                        fontSize: "0.63rem",
                        fontWeight: 650,
                        marginTop: "0.28rem",
                        padding: "0.15rem 0",
                        textAlign: "left",
                    }}
                >
                    {expanded ? "Show fewer" : `… ${hidden} more · click to show all`}
                </button>
            );
        };

        const modeOptions = [
            {
                id: "direct",
                title: "Direct / OOC correction",
                description: "Exact canonical/admin edits with the smallest possible scope.",
            },
            {
                id: "exact-event",
                title: "Exact Event",
                description: "Author one timeline event and all structured effects it establishes.",
            },
            {
                id: "world-intervention",
                title: "World Intervention",
                description: "Orchestrate a coherent multi-event change across territory, polities, wars, diplomacy, forces and Stats.",
            },
        ];

        const countChip = (label, value) => (
            <span
                key={label}
                style={{
                    background: value ? "rgba(59,130,246,0.13)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${value ? "rgba(96,165,250,0.28)" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 999,
                    color: value ? "rgba(219,234,254,0.95)" : "rgba(255,255,255,0.42)",
                    fontSize: "0.66rem",
                    padding: "0.18rem 0.42rem",
                }}
            >
                {label} {value}
            </span>
        );

        return (
            <>
            {header(meta.title, "Unified GM · natural-language canonical transaction planner")}
            <div style={{ overflowY: "auto", paddingRight: "0.15rem" }}>
                <div style={{
                    background: "rgba(30,64,175,0.09)",
                    border: "1px solid rgba(96,165,250,0.18)",
                    borderRadius: 9,
                    color: "rgba(219,234,254,0.82)",
                    fontSize: "0.72rem",
                    lineHeight: 1.45,
                    marginBottom: "0.7rem",
                    padding: "0.55rem 0.65rem",
                }}>
                    <strong style={{ color: "#bfdbfe" }}>Preview → Apply.</strong> Generate a transaction, inspect every canonical operation, then apply that exact preview. Apply performs no second AI call, revalidates the live world immediately before writing, and never advances the date or round.
                </div>

                <label style={labelStyle}>Mode</label>
                {/* One per row on a phone: a third of the panel squeezed each
                    mode's description into a column a word or two wide. */}
                <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr))", marginBottom: "0.7rem" }}>
                    {modeOptions.map((option) => {
                        const active = gmMode === option.id;
                        return (
                            <button
                                key={option.id}
                                type="button"
                                disabled={busy}
                                onClick={() => { setGmMode(option.id); setGmPreview(null); setGmApplyResult(null); setGmExpandedSections({}); }}
                                style={{
                                    ...buttonStyle,
                                    alignItems: "flex-start",
                                    background: active ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.04)",
                                    borderColor: active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)",
                                    flexDirection: "column",
                                    gap: "0.18rem",
                                    justifyContent: "flex-start",
                                    minHeight: 74,
                                    padding: "0.55rem",
                                    textAlign: "left",
                                }}
                            >
                                <span style={{ color: active ? "#f4f4f5" : "rgba(255,255,255,0.8)", fontSize: "0.74rem" }}>{option.title}</span>
                                <span style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.63rem", fontWeight: 400, lineHeight: 1.3 }}>{option.description}</span>
                            </button>
                        );
                    })}
                </div>

                <label style={labelStyle}>GM request</label>
                <textarea
                    value={text}
                    onChange={(event) => { setText(event.target.value); setGmPreview(null); setGmApplyResult(null); setGmExpandedSections({}); }}
                    placeholder={gmMode === "direct"
                        ? 'Example: "Germany should have a population of 72 million and GDP of €500 billion. Do not add a timeline event."'
                        : gmMode === "exact-event"
                            ? 'Example: "On 4 March 1927 Britain and Germany sign a naval consultation accord. Make it major and notable, create the agreement, and set relations to +45."'
                            : 'Example: "Russia enters a constitutional crisis; Finland gains broad autonomy, Polish unrest spreads, Nicholas II replaces the government, and Russia asks Germany for consultations."'}
                    rows={5}
                    style={{ ...inputStyle, resize: "vertical" }}
                />
                <button
                    type="button"
                    className="oh-tap-row"
                    disabled={busy || !text.trim()}
                    onClick={() => runBusy(async () => {
                        const result = await previewGameMasterCommand(text.trim(), { mode: gmMode });
                        setGmPreview(result);
                        setGmApplyResult(null);
                        setGmExpandedSections({});
                        return result?.summary
                            ? `Preview ready — ${result.summary}`
                            : "GM transaction preview ready. Nothing has been applied.";
                    })}
                    style={{ ...primaryButtonStyle, marginTop: "0.6rem", opacity: busy || !text.trim() ? 0.6 : 1, width: "100%" }}
                >
                    {busy ? "Planning canonical transaction…" : gmPreview ? "Regenerate Preview" : "Generate Preview"}
                </button>
                <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.69rem", lineHeight: 1.4, marginTop: "0.45rem" }}>
                    AI interpretation is constrained by the live native GM schema. Wars, relations, agreements and subordinations are structured objects now — no encoded string mini-language and no turn simulation path.
                </div>

                {gmPreview && (
                    <div style={{
                        background: "rgba(0,0,0,0.18)",
                        border: "1px solid rgba(255,255,255,0.11)",
                        borderRadius: 10,
                        marginTop: "0.8rem",
                        padding: "0.7rem",
                    }}>
                        <div style={{ alignItems: "center", display: "flex", gap: "0.45rem", justifyContent: "space-between" }}>
                            <div>
                                <div style={{ color: gmApplied ? "#86efac" : "#93c5fd", fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.08em" }}>{gmApplied ? "APPLIED · CANON UPDATED" : "PREVIEW ONLY · NOTHING CHANGED"}</div>
                                <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.62rem", marginTop: "0.16rem" }}>
                                    {gmPreview.date || "Current date"} · {gmPreview.mode} · source {gmPreview?.generation?.source || "unknown"}
                                </div>
                            </div>
                            <span style={{ border: "1px solid rgba(74,222,128,0.25)", borderRadius: 999, color: "#86efac", fontSize: "0.62rem", padding: "0.2rem 0.42rem" }}>
                                {gmApplied ? "APPLIED" : "VALIDATED"}
                            </span>
                        </div>

                        <div style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.75rem", lineHeight: 1.45, marginTop: "0.55rem" }}>
                            {gmPreview.summary || "No summary returned."}
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.6rem" }}>
                            {countChip("events", events.length)}
                            {countChip("territory", impactCounts.territory)}
                            {countChip("polities", impactCounts.polities)}
                            {countChip("politics", impactCounts.politics)}
                            {countChip("stats", statPatches.length)}
                            {countChip("storylines", storylineUpdates.length)}
                            {countChip("units", impactCounts.units)}
                            {countChip("markers", impactCounts.markers)}
                            {countChip("wars", warUpdates.length)}
                            {countChip("relations", relationUpdates.length)}
                            {countChip("agreements", agreementUpdates.length)}
                            {countChip("subordinations", puppetUpdates.length)}
                            {countChip("chats", impactCounts.chats + outreach.length)}
                        </div>

                        {events.length > 0 && (
                            <div style={{ marginTop: "0.7rem" }}>
                                <div style={{ ...labelStyle, marginBottom: "0.3rem", marginTop: 0 }}>Authored events</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                    {events.map((event, index) => (
                                        <div key={event.id || `${event.date}-${index}`} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.55rem" }}>
                                            <div style={{ color: "rgba(147,197,253,0.82)", fontSize: "0.61rem" }}>EVENT {index} · {event.date || "undated"}</div>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.28rem" }}>
                                                {[
                                                    String(event.importance || "minor").toUpperCase(),
                                                    String(event.kind || "world").toUpperCase(),
                                                    ...(event.notable ? ["NOTABLE"] : []),
                                                    ...(event.playerRelated ? ["PLAYER-RELATED"] : []),
                                                    ...(event.warId ? [`WAR · ${event.warId}`] : []),
                                                ].map((badge) => (
                                                    <span key={badge} style={{
                                                        background: "rgba(255,255,255,0.05)",
                                                        border: "1px solid rgba(255,255,255,0.09)",
                                                        borderRadius: 999,
                                                        color: "rgba(255,255,255,0.5)",
                                                        fontSize: "0.56rem",
                                                        padding: "0.14rem 0.34rem",
                                                    }}>{badge}</span>
                                                ))}
                                            </div>
                                            <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.74rem", fontWeight: 650, marginTop: "0.22rem" }}>{event.title}</div>
                                            <div style={{ color: "rgba(255,255,255,0.54)", fontSize: "0.68rem", lineHeight: 1.35, marginTop: "0.2rem" }}>{event.description}</div>
                                            {Array.isArray(event.combatants) && event.combatants.length > 0 ? (
                                                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", marginTop: "0.24rem" }}>Combatants: {event.combatants.join(" · ")}</div>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ marginTop: "0.72rem" }}>
                            <div style={{ ...labelStyle, marginBottom: "0.15rem", marginTop: 0 }}>Exact canonical changes</div>
                            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.62rem", lineHeight: 1.35 }}>
                                These are the individual operations the Apply step would execute. Authored prose above is not a substitute for these state changes.
                            </div>

                            {(transferOps.length > 0 || claimOps.length > 0 || controlOps.length > 0) && (
                                <div style={{ marginTop: "0.5rem" }}>
                                    {subsectionTitle("Territory · legal sovereignty", transferOps.length, transferOps.length ? "legal owner changes" : "unchanged")}
                                    {transferOps.length === 0 ? (
                                        <div style={{ ...exactRowStyle, color: "rgba(134,239,172,0.72)" }}>
                                            NONE · legal sovereignty remains with the current sovereigns.
                                        </div>
                                    ) : visibleOperationRows("territory-sovereignty", transferOps).map((entry, index) => (
                                        <div key={`transfer-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>{entry.regionName || entry.regionId || "Unknown region"}</strong>
                                            {` · ${entry.fromCode || "unclaimed"} → ${entry.toCode || "unclaimed"}${entry.wholeCountry ? " · whole country" : ""}`}
                                            <span style={{ color: "rgba(255,255,255,0.34)" }}> · {eventRef(entry)}</span>
                                            {entry.note ? <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.14rem" }}>{entry.note}</div> : null}
                                        </div>
                                    ))}
                                    {operationExpander("territory-sovereignty", transferOps.length)}

                                    {subsectionTitle("Territory · de-facto control / contest", controlOps.length, "does not change legal sovereignty")}
                                    {controlOps.length === 0 ? (
                                        <div style={exactRowStyle}>NONE</div>
                                    ) : visibleOperationRows("territory-control", controlOps).map((entry, index) => {
                                        const region = entry.regionName || entry.regionId || "Unknown region";
                                        let detail = entry.op || "operation";
                                        if (entry.op === "contest") detail = `CONTEST · current controller ${entry.fromCode || "unknown"} · challenger ${entry.actorCode || "unknown"}`;
                                        if (entry.op === "control") detail = `CONTROL · ${entry.fromCode || "unknown"} → ${entry.toCode || "unknown"}`;
                                        if (entry.op === "clear_contest") detail = `CLEAR CONTEST · controller ${entry.fromCode || "unknown"}${entry.clearAll ? " · all claimants" : ` · claimant ${entry.claimantCode || "unknown"}`}`;
                                        return (
                                            <div key={`control-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}>
                                                <strong style={{ color: "rgba(255,255,255,0.88)" }}>{region}</strong> · {detail}
                                                <span style={{ color: "rgba(255,255,255,0.34)" }}> · {eventRef(entry)}</span>
                                                {entry.note ? <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.14rem" }}>{entry.note}</div> : null}
                                            </div>
                                        );
                                    })}
                                    {operationExpander("territory-control", controlOps.length)}

                                    {subsectionTitle("Territory · claims", claimOps.length, "does not move the border")}
                                    {claimOps.length === 0 ? (
                                        <div style={exactRowStyle}>NONE</div>
                                    ) : visibleOperationRows("territory-claims", claimOps).map((entry, index) => (
                                        <div key={`claim-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>{entry.regionName || entry.regionId || "Unknown region"}</strong>
                                            {` · ${entry.drop ? "CLAIM WITHDRAWN" : "CLAIMED"} by ${entry.claimantCode || "unknown"}`}
                                            <span style={{ color: "rgba(255,255,255,0.34)" }}> · {eventRef(entry)}</span>
                                            {entry.note ? <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.14rem" }}>{entry.note}</div> : null}
                                        </div>
                                    ))}
                                    {operationExpander("territory-claims", claimOps.length)}
                                </div>
                            )}

                            {polityOps.length > 0 && (
                                <div>
                                    {subsectionTitle("Polities", polityOps.length)}
                                    {polityOps.map((entry, index) => {
                                        const stableIdentity = entry.code || entry.name || "Unknown polity";
                                        const displayName = String(entry.name || "").trim();
                                        const hasDistinctDisplayName = displayName && displayName.toLocaleLowerCase() !== String(stableIdentity).trim().toLocaleLowerCase();
                                        const details = Object.fromEntries(Object.entries(entry).filter(([key, value]) =>
                                            !key.startsWith("_") && !["operation", "code", "name"].includes(key) && value !== "" && value !== undefined && value !== null
                                        ));
                                        return (
                                            <div key={`polity-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}>
                                                <strong style={{ color: "rgba(255,255,255,0.88)" }}>
                                                    {String(entry.operation || "update").toUpperCase()} · {stableIdentity}{hasDistinctDisplayName ? ` → ${displayName}` : ""}
                                                </strong>
                                                <span style={{ color: "rgba(255,255,255,0.34)" }}> · {eventRef(entry)}</span>
                                                {hasDistinctDisplayName ? (
                                                    <div style={{ color: "rgba(147,197,253,0.62)", marginTop: "0.14rem" }}>
                                                        Stable identity: {stableIdentity} · current/display name: {displayName}
                                                    </div>
                                                ) : null}
                                                {Object.keys(details).length > 0 ? <div style={{ color: "rgba(255,255,255,0.44)", marginTop: "0.14rem" }}>{compactJson(details)}</div> : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {politicalOps.length > 0 && (
                                <div data-gm-political-actor-ops="true">
                                    {subsectionTitle("Political Actor / PWv2", politicalOps.length, "exact canonical political mutations")}
                                    {politicalOps.map((entry, index) => {
                                        let args = entry.argsJson;
                                        try { args = JSON.parse(entry.argsJson); } catch { /* keep raw text */ }
                                        return (
                                            <div key={`politics-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}>
                                                <strong style={{ color: "rgba(255,255,255,0.88)" }}>
                                                    {String(entry.op || "update").toUpperCase()} · {entry.polityKey || entry.polity || entry.country || "Unknown polity"}
                                                </strong>
                                                <span style={{ color: "rgba(255,255,255,0.34)" }}> · {eventRef(entry)}</span>
                                                <div style={{ color: "rgba(255,255,255,0.5)", marginTop: "0.14rem" }}>
                                                    {compactJson(args)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {statPatches.length > 0 && (
                                <div>
                                    {subsectionTitle("Authoritative Stats baselines", statPatches.length)}
                                    {statPatches.map((entry, index) => (
                                        <div key={`stat-${entry.country}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>{entry.country}</strong> · {compactJson(entry.patch)}
                                            {Array.isArray(entry.eventIndexes) && entry.eventIndexes.length > 0 ? <span style={{ color: "rgba(255,255,255,0.34)" }}> · events {entry.eventIndexes.join(", ")}</span> : null}
                                            {entry.reason ? <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.14rem" }}>{entry.reason}</div> : null}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {unitOps.length > 0 && (
                                <div>
                                    {subsectionTitle("Military units", unitOps.length)}
                                    {unitOps.map((entry, index) => {
                                        let detail = compactJson(Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("_"))));
                                        if (entry.op === "spawn") detail = `SPAWN · ${entry.unit?.name || "unnamed"} · ${entry.unit?.ownerCode || "unknown owner"} · ${entry.unit?.type || "unit"} · strength ${entry.unit?.strength ?? "?"} · ${entry.unit?.regionId || `${entry.unit?.lat ?? "?"}, ${entry.unit?.lng ?? "?"}`}`;
                                        if (entry.op === "move") detail = `MOVE · ${entry.unitId || "unknown unit"} → ${entry.regionId || `${entry.toLat ?? "?"}, ${entry.toLng ?? "?"}`}`;
                                        if (entry.op === "attack") detail = `ATTACK · ${entry.unitId || "unknown unit"} → ${entry.targetUnitId || "unknown target"}`;
                                        if (entry.op === "strength") detail = `STRENGTH · ${entry.unitId || "unknown unit"} → ${entry.strength ?? "?"}`;
                                        if (entry.op === "remove") detail = `REMOVE · ${entry.unitId || "unknown unit"}`;
                                        return <div key={`unit-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}><strong style={{ color: "rgba(255,255,255,0.88)" }}>{detail}</strong><span style={{ color: "rgba(255,255,255,0.34)" }}> · {eventRef(entry)}</span>{entry.note ? <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.14rem" }}>{entry.note}</div> : null}</div>;
                                    })}
                                </div>
                            )}

                            {markerOps.length > 0 && (
                                <div>
                                    {subsectionTitle("Map features", markerOps.length)}
                                    {markerOps.map((entry, index) => {
                                        const patch = entry?.changes && typeof entry.changes === "object" ? entry.changes : entry;
                                        const displayName = entry.name || entry.marker?.name || "unnamed feature";
                                        let detail = `${String(entry.op || "operation").toUpperCase()} · ${displayName}`;
                                        if (entry.markerId) detail += ` · id ${entry.markerId}`;
                                        if (entry.op === "build") {
                                            detail += ` · ${entry.marker?.kind || "feature"} · owner ${entry.marker?.ownerCode || "none"} · status ${mapFeatureStatusMeta(entry.marker?.status).label} · ${entry.marker?.lat ?? "?"}, ${entry.marker?.lng ?? "?"}`;
                                        }
                                        if (entry.op === "update") {
                                            const changes = [];
                                            if (patch.status) changes.push(`status → ${mapFeatureStatusMeta(patch.status).label}`);
                                            if (patch.kind) changes.push(`type → ${patch.kind}`);
                                            if (Object.prototype.hasOwnProperty.call(patch, "ownerCode")) changes.push(`owner → ${patch.ownerCode || "none"}`);
                                            if (Number.isFinite(Number(patch.lat)) && Number.isFinite(Number(patch.lng))) changes.push(`location → ${Number(patch.lat).toFixed(2)}, ${Number(patch.lng).toFixed(2)}`);
                                            if (patch.foundedAt) changes.push(`founded → ${patch.foundedAt}`);
                                            if (changes.length) detail += ` · ${changes.join(" · ")}`;
                                        }
                                        if (entry.op === "rename") detail += ` → ${entry.newName || "unnamed"}`;
                                        return <div key={`marker-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}><strong style={{ color: "rgba(255,255,255,0.88)" }}>{detail}</strong><span style={{ color: "rgba(255,255,255,0.34)" }}> · {eventRef(entry)}</span>{patch.note || entry.marker?.note ? <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.14rem" }}>{patch.note || entry.marker?.note}</div> : null}</div>;
                                    })}
                                </div>
                            )}

                            {storylineUpdates.length > 0 && (
                                <div>
                                    {subsectionTitle("Persistent storylines", storylineUpdates.length, "world.storylines")}
                                    {storylineUpdates.map((entry, index) => (
                                        <div key={`storyline-${entry.id}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>
                                                {String(entry.status || "active").toUpperCase()} · {entry.id || "unnamed-storyline"}
                                            </strong>
                                            <span style={{ color: "rgba(255,255,255,0.46)" }}>
                                                {` · pressure ${Number.isFinite(Number(entry.pressure)) ? Number(entry.pressure) : "—"} · momentum ${Number.isFinite(Number(entry.momentum)) ? Number(entry.momentum) : "—"}`}
                                            </span>
                                            {entry.title ? <div style={{ marginTop: "0.12rem", color: "rgba(255,255,255,0.68)" }}>{entry.title}</div> : null}
                                            <div style={{ color: "rgba(255,255,255,0.38)", marginTop: "0.1rem" }}>
                                                Participants: {entry.participants?.join(", ") || "—"} · Events: {entry.eventIndexes?.join(", ") || "—"}
                                                {entry.startedDate ? ` · Started: ${entry.startedDate}` : ""}
                                            </div>
                                            {entry.state ? <div style={{ color: "rgba(255,255,255,0.48)", marginTop: "0.12rem", lineHeight: 1.35 }}>{entry.state}</div> : null}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {warUpdates.length > 0 && (
                                <div>
                                    {subsectionTitle("Wars", warUpdates.length, "world.wars")}
                                    {warUpdates.map((entry, index) => (
                                        <div key={`war-${entry.id}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>{String(entry.op || "update").toUpperCase()} · {entry.id}</strong>
                                            <div style={{ marginTop: "0.12rem" }}>Actors: {entry.actors?.join(", ") || "—"}{entry.opponents?.length ? ` · Opponents: ${entry.opponents.join(", ")}` : ""}</div>
                                            <div style={{ color: "rgba(255,255,255,0.36)", marginTop: "0.1rem" }}>Events: {entry.eventIndexes?.join(", ") || "—"}{entry.note ? ` · ${entry.note}` : ""}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {relationUpdates.length > 0 && (
                                <div>
                                    {subsectionTitle("Relations", relationUpdates.length, "world.relations")}
                                    {relationUpdates.map((entry, index) => (
                                        <div key={`relation-${entry.a}-${entry.b}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>{entry.a} ↔ {entry.b}</strong> · {entry.score} · {entry.status}
                                            <div style={{ color: "rgba(255,255,255,0.38)", marginTop: "0.1rem" }}>Events: {entry.eventIndexes?.join(", ") || "—"}{entry.summary ? ` · ${entry.summary}` : ""}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {agreementUpdates.length > 0 && (
                                <div>
                                    {subsectionTitle("Agreements", agreementUpdates.length, "world.agreements")}
                                    {agreementUpdates.map((entry, index) => (
                                        <div key={`agreement-${entry.id}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>{String(entry.op || "update").toUpperCase()} · {entry.id}</strong> · {entry.type}
                                            <div style={{ marginTop: "0.12rem" }}>Parties: {entry.parties?.join(", ") || "—"}{entry.title ? ` · ${entry.title}` : ""}</div>
                                            <div style={{ color: "rgba(255,255,255,0.38)", marginTop: "0.1rem" }}>Events: {entry.eventIndexes?.join(", ") || "—"}{entry.terms ? ` · ${entry.terms}` : ""}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {puppetUpdates.length > 0 && (
                                <div data-gm-puppet-updates="true">
                                    {subsectionTitle("Subordinations", puppetUpdates.length, "world.puppets")}
                                    {puppetUpdates.map((entry, index) => (
                                        <div key={`puppet-${entry.overlord}-${entry.puppet}-${entry.op}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>{String(entry.op || "update").toUpperCase()} · {entry.overlord || "Unknown overlord"} → {entry.puppet || "Unknown puppet"}</strong>
                                            <div style={{ marginTop: "0.12rem" }}>Kind: {entry.kind || "—"} · Secrecy: {entry.secrecy || "—"} · Loyalty: {Number.isFinite(Number(entry.loyalty)) ? Number(entry.loyalty) : "—"}</div>
                                            <div style={{ color: "rgba(255,255,255,0.38)", marginTop: "0.1rem" }}>Events: {entry.eventIndexes?.join(", ") || "—"}{entry.note ? ` · ${entry.note}` : ""}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {(eventChats.length > 0 || outreach.length > 0) && (
                                <div>
                                    {subsectionTitle("Diplomatic chats", eventChats.length + outreach.length)}
                                    {eventChats.map((entry, index) => (
                                        <div key={`event-chat-${entry._eventIndex}-${entry._opIndex}-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>EVENT CHAT · {entry.title || "Untitled"}</strong> · speaker {entry.speaker || "unknown"}
                                            <div style={{ marginTop: "0.12rem" }}>Participants: {(entry.countries || []).map((country) => country?.name || country).filter(Boolean).join(", ") || "—"}</div>
                                            <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.1rem" }}>{entry.openingMessage || ""}</div>
                                            <div style={{ color: "rgba(255,255,255,0.3)", marginTop: "0.1rem" }}>{eventRef(entry)}</div>
                                        </div>
                                    ))}
                                    {outreach.map((entry, index) => (
                                        <div key={`outreach-${index}`} style={exactRowStyle}>
                                            <strong style={{ color: "rgba(255,255,255,0.88)" }}>OUTREACH · {entry.title || "Untitled"}</strong> · speaker {entry.speaker || "unknown"}
                                            <div style={{ marginTop: "0.12rem" }}>Participants: {(entry.countries || []).map((country) => country?.name || country).filter(Boolean).join(", ") || "—"}</div>
                                            <div style={{ color: "rgba(255,255,255,0.42)", marginTop: "0.1rem" }}>{entry.openingMessage || ""}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            className="oh-tap-row"
                            disabled={busy || gmApplied}
                            title={gmApplied ? "This exact transaction has already been applied." : "Apply exactly the validated preview above. No second AI call."}
                            onClick={() => runBusy(async () => {
                                const result = await applyGameMasterPreview(gmPreview);
                                setGmApplyResult(result);
                                // world.json writes already emit the canonical update consumed by
                                // the map. Do not make the first post-Apply frames compete with a
                                // heavyweight admin-panel refresh; refresh this panel when idle.
                                const refreshLater = () => Promise.resolve(refresh()).catch((error) => {
                                    console.warn("[GM] deferred admin refresh failed:", error);
                                });
                                if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
                                    window.requestIdleCallback(refreshLater, { timeout: 1200 });
                                } else {
                                    setTimeout(refreshLater, 0);
                                }
                                return result?.summary
                                    ? `Applied — ${result.summary}`
                                    : `Applied GM transaction ${result?.transactionId || ""}.`;
                            })}
                            style={{
                                ...primaryButtonStyle,
                                cursor: busy || gmApplied ? "not-allowed" : "pointer",
                                bottom: "0.45rem",
                                boxShadow: "0 -10px 24px rgba(8,12,20,0.88)",
                                marginTop: "0.75rem",
                                opacity: busy || gmApplied ? 0.52 : 1,
                                position: "sticky",
                                width: "100%",
                                zIndex: 4,
                            }}
                        >
                            {busy ? "Applying canonical transaction…" : gmApplied ? "Applied ✓" : "Apply Transaction"}
                        </button>
                        <div style={{ color: gmApplied ? "rgba(134,239,172,0.72)" : "rgba(255,255,255,0.4)", fontSize: "0.64rem", lineHeight: 1.35, marginTop: "0.35rem", textAlign: "center" }}>
                            {gmApplied
                                ? `Applied as ${gmApplyResult.transactionId}. Date and round were not advanced.`
                                : "Apply uses this exact preview, revalidates current canon, writes through native seams, and records a persistent GM audit entry."}
                        </div>
                    </div>
                )}
                {statusLine}
            </div>
            </>
        );
    }

    if (tool === "history-document") {
        const data = items;
        const doc = data?.document ?? null;
        const passes = data?.passes ?? [];
        const savedText = doc?.text ?? "";
        const draft = typeof fields.document === "string" ? fields.document : savedText;
        const dirty = draft !== savedText;
        const draftWords = countWords(draft);
        const confirmingReset = editingId === "reset-history";
        // Reads the save again before writing, so a hand edit never clobbers a
        // document a turn rewrote while the panel was open.
        const saveDocument = async () => {
            const world = await readWorldState({ force: true });
            const current = world?.historyDocument ?? null;
            const text = draft.trim();
            const next = text
                ? {
                    text,
                    revision: (current?.revision ?? 0) + 1,
                    updatedAt: new Date().toISOString(),
                    source: "manual",
                    throughDate: current?.throughDate ?? "",
                    throughEventId: current?.throughEventId ?? "",
                    throughRound: current?.throughRound ?? 0,
                }
                : null;
            await writeWorldState({ ...world, historyDocument: next });
            if ((current?.text ?? "").trim() !== text) {
                await noteGmChange("history", next
                    ? "Rewrote the history document by hand; it is the account of the past to go by."
                    : "Cleared the history document by hand.");
            }
            await loadHistoryDocument();
            return next
                ? `History document saved (revision ${next.revision}, ${countWords(text)} words). The AI reads it from its next call.`
                : "History document cleared. The AI is shown the pass summaries below until the next pass writes a new document.";
        };
        const resetCompression = async () => {
            const world = await readWorldState({ force: true });
            await writeWorldState({ ...world, historyDocument: null, consolidatedHistory: [] });
            setEditingId(null);
            await loadHistoryDocument();
            return "Compression reset: the document and its pass ledger are gone. Every event is still in the timeline, and the AI is shown all of them in full until the next pass.";
        };
        return (
            <>
            {header(meta.title, meta.subtitle)}
            {/* Scrolls on a phone: a sixteen-row document under the notes is
                taller than a phone's panel, which cut off the Save buttons. */}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0, ...(isMobile || touch ? { overflowY: "auto" } : null) }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem", marginBottom: "0.5rem" }}>
            Every event stays in the timeline in full. When enough have piled up, a pass folds the older ones into this document — the first pass writes it, every later one rewrites it with the new period added and unimportant older material condensed to stay near {HISTORY_CONSOLIDATION.documentWordBudget} words — and the AI is shown the document in their place, plus the newest {HISTORY_CONSOLIDATION.retainEvents} events one by one.
            </div>
            {data === null && (
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem" }}>Reading the campaign…</div>
            )}
            {data !== null && (
                <div style={{ ...editorFieldStyle, color: "rgba(255,255,255,0.72)", fontSize: "0.74rem", lineHeight: 1.45, marginBottom: "0.5rem" }}>
                <div>{data.totalEvents} events in the timeline. {data.status.text}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.45rem" }}>
                <button
                type="button"
                className="oh-tap-row"
                disabled={busy || !data.status.canFoldNow}
                title={data.status.canFoldNow ? "Runs the AI consolidator on the older events now" : "Only the retained tail is waiting; there is nothing older to fold"}
                style={{ ...primaryButtonStyle, opacity: busy || !data.status.canFoldNow ? 0.55 : 1, padding: "0.3rem 0.6rem" }}
                onClick={() => runBusy(async () => {
                    const result = await consolidateHistoryNow();
                    await loadHistoryDocument();
                    return result.consolidated
                        ? `Folded ${result.events} event${result.events === 1 ? "" : "s"} and ${result.chats} chat${result.chats === 1 ? "" : "s"}; the document is now revision ${result.documentRevision}, ${result.documentWords} words. The newest ${result.retained} events stay in full.`
                        : "Nothing was folded: only the retained tail is waiting, or the consolidator came back empty.";
                })}
                >
                Fold the older events now
                </button>
                {confirmingReset ? (
                    <>
                    <button type="button" className="oh-tap-row" disabled={busy} style={{ ...primaryButtonStyle, padding: "0.3rem 0.6rem" }} onClick={() => runBusy(resetCompression)}>Confirm reset</button>
                    <button type="button" className="oh-tap-row" disabled={busy} style={{ ...buttonStyle, padding: "0.3rem 0.6rem" }} onClick={() => setEditingId(null)}>Keep</button>
                    </>
                ) : (
                    <button
                    type="button"
                    className="oh-tap-row"
                    disabled={busy || (!doc && passes.length === 0)}
                    title="Deletes the document and the pass ledger; every event is shown to the AI in full again until the next pass"
                    style={{ ...buttonStyle, opacity: busy || (!doc && passes.length === 0) ? 0.55 : 1, padding: "0.3rem 0.6rem" }}
                    onClick={() => setEditingId("reset-history")}
                    >
                    Reset compression
                    </button>
                )}
                </div>
                </div>
            )}
            {data !== null && (
                <>
                <div style={editorSectionLabelStyle}>The document{doc || draft ? ` · ${draftWords} words${dirty ? " · unsaved changes" : ""}` : ""}</div>
                <textarea
                value={draft}
                onChange={(event) => setFields({ document: event.target.value })}
                rows={16}
                placeholder="No history document yet. The first pass writes it — or type one here and save it."
                style={{ ...inputStyle, fontFamily: "inherit", lineHeight: 1.45, resize: "vertical", width: "100%" }}
                />
                <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.4rem" }}>
                <button
                type="button"
                className="oh-tap-row"
                disabled={busy || !dirty}
                style={{ ...primaryButtonStyle, opacity: busy || !dirty ? 0.55 : 1, padding: "0.3rem 0.6rem" }}
                onClick={() => runBusy(saveDocument)}
                >
                Save document
                </button>
                <button type="button" className="oh-tap-row" disabled={busy || !dirty} style={{ ...buttonStyle, opacity: busy || !dirty ? 0.55 : 1, padding: "0.3rem 0.6rem" }} onClick={() => setFields({ document: savedText })}>Revert</button>
                </div>
                </>
            )}
            {passes.length > 0 && (
                <details style={{ marginTop: "0.6rem" }}>
                <summary style={{ cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: "0.74rem", ...(touch ? TOUCH_SUMMARY : null) }}>{passes.length} pass{passes.length === 1 ? "" : "es"} so far — what each one folded</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem", maxHeight: "18rem", overflowY: "auto" }}>
                {passes.map((entry, index) => {
                    const summary = String(entry?.summary ?? "");
                    const metaLine = [
                        `Pass ${index + 1}`,
                        entry?.throughRound ? `through round ${entry.throughRound}` : "",
                        entry?.throughDate ? `to ${entry.throughDate}` : "",
                        entry?.chatIds?.length ? `${entry.chatIds.length} chat${entry.chatIds.length === 1 ? "" : "s"}` : "",
                        entry?.actionIds?.length ? `${entry.actionIds.length} order${entry.actionIds.length === 1 ? "" : "s"}` : "",
                        entry?.source === "fallback" ? "written without the AI" : "",
                    ].filter(Boolean).join(" · ");
                    return (
                        <div key={`${entry?.throughEventId || "pass"}-${index}`} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem", marginBottom: "0.3rem" }}>{metaLine}</div>
                        <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.74rem", lineHeight: 1.45, maxHeight: "8rem", overflowY: "auto", whiteSpace: "pre-wrap" }}>{summary}</div>
                        </div>
                    );
                })}
                </div>
                </details>
            )}
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "roll-back-turn") {
        const snapshots = items ?? [];
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem", marginBottom: "0.5rem" }}>
            Restore the game to how it was at the start of an earlier turn. This permanently discards every turn played after the one you pick.
            </div>
            {items === null && (
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem" }}>Loading restore points…</div>
            )}
            {items !== null && snapshots.length === 0 && (
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem" }}>
                No restore points yet — one is captured automatically at the start of each turn. Play a turn, then come back.
                </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", overflowY: "auto" }}>
            {snapshots.map((snap, index) => {
                const confirming = editingId === snap.id;
                const dateLabel = snap.fromDate ? String(snap.fromDate) : "";
                return (
                    <div key={snap.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>Round {snap.round}{dateLabel ? ` · ${dateLabel}` : ""}</div>
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem" }}>
                    {index === 0 ? "undoes the most recent turn" : `undoes the last ${index + 1} turns`}
                    </div>
                    </div>
                    {confirming ? (
                        <div style={{ display: "flex", flexShrink: 0, gap: "0.3rem" }}>
                        <button
                        type="button"
                        className="oh-tap-row"
                        disabled={busy}
                        style={{ ...primaryButtonStyle, padding: "0.25rem 0.55rem" }}
                        onClick={() => runBusy(async () => {
                            const s = snap.state ?? {};
                            await Promise.all([
                                writeJson(JSON_URLS.game, s.game ?? {}, { pretty: true }),
                                writeJson(JSON_URLS.world, s.world ?? {}, { pretty: true }),
                                writeJson(JSON_URLS.events, s.events ?? [], { pretty: true }),
                                writeJson(JSON_URLS.actions, s.actions ?? [], { pretty: true }),
                                writeJson(JSON_URLS.chat, s.chat ?? [], { pretty: true }),
                                writeJson(JSON_URLS.colors, s.colors ?? {}, { pretty: true }),
                            ]);
                            // Drop this restore point and every newer one — those turns no longer happened.
                            const remaining = snapshots.slice(index + 1);
                            await writeJson(JSON_URLS.snapshots, remaining);
                            // Noted in the restored world, so the next skip hears it — along
                            // with any change made in this round before the undone turn,
                            // which it is now hearing for the first time again.
                            await noteGmChange("rollback", `Rolled the world back to the start of round ${snap.round}${dateLabel ? ` (${dateLabel})` : ""}: the ${index === 0 ? "turn" : `${index + 1} turns`} after it never happened.`);
                            setItems(remaining);
                            setEditingId(null);
                            await refresh();
                            return `Rolled back to Round ${snap.round}. The map, date and panels catch up within a few seconds.`;
                        })}
                        >
                        Confirm
                        </button>
                        <button type="button" className="oh-tap-row" style={{ ...buttonStyle, padding: "0.25rem 0.55rem" }} onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                    ) : (
                        <button type="button" className="oh-tap-row" disabled={busy} style={{ ...buttonStyle, flexShrink: 0, padding: "0.25rem 0.55rem" }} onClick={() => setEditingId(snap.id)}>Roll back</button>
                    )}
                    </div>
                    </div>
                );
            })}
            </div>
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "your-country") {
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.78rem" }}>
            Currently playing: <strong>{nameOf(game?.country)}</strong>
            </div>
            <label style={labelStyle}>New country</label>
            <PolitySelect polities={polities} value={target} onChange={setTarget} />
            <button
            type="button"
            className="oh-tap-row"
            disabled={busy || !target}
            onClick={() => runBusy(async () => {
                const current = await readGameData({ force: true });
                await writeGameData({ ...current, country: target });
                await noteGmChange("polity", `The player now leads ${nameOf(target)}${current?.country ? ` instead of ${nameOf(current.country)}` : ""}.`);
                await refresh();
                return `You now lead ${nameOf(target)}.`;
            })}
            style={{ ...primaryButtonStyle, marginTop: "0.6rem", width: "100%" }}
            >
            Switch country
            </button>
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "difficulty") {
        const current = normalizeDifficulty(game?.difficulty);
        const currentMeta = DIFFICULTY_LEVELS.find((level) => level.id === current) || DIFFICULTY_LEVELS[2];
        const profileRows = [
            ["Player leniency", currentMeta?.profile?.playerLeniency],
            ["NPC competence", currentMeta?.profile?.npcCompetence],
            ["Consequence pressure", currentMeta?.profile?.consequencePressure],
            ["Diplomatic firmness", currentMeta?.profile?.diplomaticFirmness],
        ];

        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ overflowY: "auto", paddingRight: "0.12rem" }}>
                <div style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.21)",
                    borderRadius: 9,
                    color: "rgba(255,255,255,0.72)",
                    fontSize: "0.68rem",
                    lineHeight: 1.45,
                    marginBottom: "0.55rem",
                    padding: "0.58rem 0.68rem",
                }}>
                    <strong style={{ color: "#f4f4f5", display: "block", fontSize: "0.72rem", marginBottom: "0.12rem" }}>
                        CAUSAL CHALLENGE · NOT RUBBER-BANDING
                    </strong>
                    Difficulty changes how uncertainty, weak plans, opposition, and bargaining are resolved. Higher levels mean less benefit of the doubt and more competent opponents — never secret anti-player knowledge, arbitrary bad luck, or a world that conspires against you.
                </div>

                <div style={{ display: "grid", gap: "0.42rem", gridTemplateColumns: "1fr 1fr" }}>
                    {DIFFICULTY_LEVELS.map((level) => {
                        const active = current === level.id;
                        return (
                            <button
                                key={level.id}
                                type="button"
                                disabled={busy}
                                onClick={() => runBusy(async () => {
                                    const nextGame = await readGameData({ force: true });
                                    await writeGameData({ ...nextGame, difficulty: level.id });
                                    await refresh();
                                    return `Difficulty set to ${level.label} ${level.emoji}. Future simulation and diplomatic bargaining use this rigor; GM/admin edits remain exact.`;
                                })}
                                style={{
                                    ...buttonStyle,
                                    alignItems: "flex-start",
                                    background: active ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.05)",
                                    border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.10)",
                                    flexDirection: "column",
                                    gap: "0.26rem",
                                    minHeight: "6.1rem",
                                    padding: "0.58rem 0.62rem",
                                    textAlign: "left",
                                }}
                            >
                                <div style={{ alignItems: "center", display: "flex", gap: "0.42rem", width: "100%" }}>
                                    <span style={{ fontSize: "1.15rem", lineHeight: 1 }}>{level.emoji}</span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ alignItems: "center", display: "flex", gap: "0.3rem" }}>
                                            <strong style={{ color: "#fff", fontSize: "0.76rem" }}>{level.label}</strong>
                                            {active && (
                                                <span style={{
                                                    background: "rgba(255,255,255,0.1)",
                                                    border: "1px solid rgba(255,255,255,0.23)",
                                                    borderRadius: 999,
                                                    color: "#f4f4f5",
                                                    fontSize: "0.5rem",
                                                    fontWeight: 900,
                                                    letterSpacing: "0.04em",
                                                    padding: "0.08rem 0.28rem",
                                                }}>ACTIVE</span>
                                            )}
                                        </div>
                                        <div style={{ color: active ? "#e4e4e7" : "rgba(255,255,255,0.48)", fontSize: "0.58rem", marginTop: "0.06rem" }}>
                                            {level.blurb}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.59rem", lineHeight: 1.35 }}>
                                    {level.description}
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div style={{ ...editorFieldStyle, marginTop: "0.58rem" }}>
                    <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                        <div>
                            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.56rem", fontWeight: 900, letterSpacing: "0.08em" }}>CURRENT BEHAVIOR</div>
                            <div style={{ color: "#fff", fontSize: "0.82rem", fontWeight: 800, marginTop: "0.08rem" }}>
                                {currentMeta.emoji} {currentMeta.label}
                            </div>
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.58rem", textAlign: "right" }}>
                            Applies from the next AI decision
                        </div>
                    </div>

                    <div style={{ display: "grid", gap: "0.34rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.5rem" }}>
                        {profileRows.map(([label, value]) => (
                            <div key={label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, padding: "0.38rem 0.45rem" }}>
                                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.51rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
                                <div style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.67rem", fontWeight: 700, marginTop: "0.08rem" }}>{value}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: "grid", gap: "0.22rem", marginTop: "0.48rem" }}>
                        {(currentMeta.effects ?? []).map((effect) => (
                            <div key={effect} style={{ color: "rgba(255,255,255,0.56)", fontSize: "0.6rem", lineHeight: 1.38 }}>
                                <span style={{ color: "#d4d4d8", marginRight: "0.28rem" }}>◆</span>{effect}
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{
                    border: "1px solid rgba(34,197,94,0.20)",
                    borderRadius: 8,
                    color: "rgba(255,255,255,0.48)",
                    fontSize: "0.58rem",
                    lineHeight: 1.42,
                    marginTop: "0.5rem",
                    padding: "0.48rem 0.58rem",
                }}>
                    <strong style={{ color: "rgba(187,247,208,0.82)" }}>Difficulty-neutral systems:</strong> GM/Cheats edits, canonical Stats arithmetic, geography resolution, territory/control semantics, timeline curation, and unit/territory directors. Difficulty cannot silently rewrite those systems.
                </div>

                {statusLine}
            </div>
            </>
        );
    }

    if (tool === "annex-country" || tool === "annex-regions") {
        const wholeCountry = tool === "annex-country";
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div>
            <label style={labelStyle}>Annex into</label>
            <PolitySelect polities={polities} value={target} onChange={setTarget} placeholder="Pick the new owner…" />
            <button
            type="button"
            className="oh-tap-row"
            disabled={!target}
            onClick={() => {
                const owner = target;
                beginClickMode(
                    wholeCountry
                        ? `Click the country to annex into ${nameOf(owner)}`
                        : `Click regions to hand to ${nameOf(owner)} — Done when finished`,
                    async (props) => {
                        try {
                            const world = await readWorldState({ force: true });
                            const overrides = { ...world.regionOwnershipOverrides };
                            if (wholeCountry) {
                                // Resolve the clicked region's CURRENT owner. On a stock
                                // map a region reassigned via regionOwnershipOverrides still
                                // carries its original GID_0 in the tile, so reading the raw
                                // property annexed the wrong country — consult the override
                                // for this region id first.
                                const clickedId =
                                    props.id != null
                                        ? String(props.id)
                                        : props.GID_1 != null
                                            ? String(props.GID_1)
                                            : "";
                                // Both sides of the comparison below must be in ONE
                                // namespace. `source` came from the click (an owner
                                // name, or a GADM code via the tail) and `effective`
                                // from the catalog (always a code), so a miss here
                                // transfers nothing and reports success.
                                const clickedGid0 = String(props.GID_0 || props.gid0 || "");
                                const source =
                                    (clickedId && overrides[clickedId])
                                    || props.owner
                                    || COUNTRY_NAMES[clickedGid0]
                                    || clickedGid0;
                                if (!source || source === owner) return;
                                const catalog = await loadRegionCatalog();
                                let count = 0;
                                for (const region of catalog) {
                                    const code = String(region.countryCode || "");
                                    const effective = overrides[region.id] ?? COUNTRY_NAMES[code] ?? code;
                                    if (effective === source) {
                                        overrides[region.id] = owner;
                                        count += 1;
                                    }
                                }
                                for (const [regionId, code] of Object.entries(world.regionOwnershipOverrides)) {
                                    if (code === source) overrides[regionId] = owner;
                                }
                                await writeWorldState({ ...world, regionOwnershipOverrides: overrides });
                                await noteGmChange("territory", `Annexed the whole of ${nameOf(source)} into ${nameOf(owner)} by hand (${count} regions).`);
                                setStatus(`${nameOf(source)} annexed into ${nameOf(owner)} (${count} regions). The map updates within a few seconds.`);
                            } else {
                                if (!props.GID_1) return;
                                const previous = overrides[String(props.GID_1)];
                                overrides[String(props.GID_1)] = owner;
                                await writeWorldState({ ...world, regionOwnershipOverrides: overrides });
                                if (previous !== owner) {
                                    await noteGmChange("territory", "", {
                                        group: `regions→${owner}`,
                                        template: `Moved {items} to ${nameOf(owner)} by hand.`,
                                        item: String(props.NAME_1 || props.GID_1),
                                    });
                                }
                                setStatus(`${props.NAME_1 || props.GID_1} → ${nameOf(owner)}. Keep clicking, or press Done.`);
                            }
                        } catch (error) {
                            setStatus(`Failed: ${error.message}`);
                        }
                    },
                );
            }}
            style={{ ...primaryButtonStyle, marginTop: "0.6rem", width: "100%" }}
            >
            Start clicking the map
            </button>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.5rem" }}>
            The map repaints ownership within ~5 seconds of each change.
            </div>
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "add-country") {
        const adding = true;
        const applyCountry = () => runBusy(async () => {
            const name = (fields.name ?? "").trim();
            // One naming scheme, no codes: the country's NAME is its identifier.
            const code = adding ? name : (target || "").trim();
            const colorHex = (fields.color ?? "").trim();
            if (!code) throw new Error(adding ? "Give the country a name." : "Pick a country first.");
            const world = await readWorldState({ force: true });
            const existing = world.polityOverrides?.[code] ?? {};
            const nextOverride = {
                ...existing,
                code,
                name: name || existing.name || code,
                ...(hexToRgb(colorHex) ? { color: colorHex.startsWith("#") ? colorHex : `#${colorHex}` } : null),
            };
            await writeWorldState({
                ...world,
                polityOverrides: { ...world.polityOverrides, [code]: nextOverride },
            });
            const rgb = hexToRgb(colorHex);
            if (rgb) {
                const colors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
                await writeJson(JSON_URLS.colors, { ...colors, [code]: rgb }, { pretty: true });
            }
            if (adding && !world.polityOverrides?.[code]) {
                await noteGmChange("polity", `Created the polity ${nextOverride.name} by hand; it holds no land until it is given some.`);
            }
            await refresh();
            return adding
                ? `${nextOverride.name} created. Use Annex Country or Annex Regions to give it territory.`
                : `${nextOverride.name} updated. The map picks up colors within a few seconds.`;
        });

        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ overflowY: "auto" }}>
            {!adding && (
                <>
                <label style={labelStyle}>Country</label>
                <PolitySelect polities={polities} value={target} onChange={(code) => { setTarget(code); setFields({}); }} />
                </>
            )}
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={fields.name ?? ""} onChange={(event) => setFields({ ...fields, name: event.target.value })} placeholder={adding ? "Atlantis" : nameOf(target)} />
            <label style={labelStyle}>Color (hex)</label>
            <div style={{ alignItems: "center", display: "flex", gap: "0.45rem" }}>
            <input style={{ ...inputStyle, width: "8rem" }} value={fields.color ?? ""} onChange={(event) => setFields({ ...fields, color: event.target.value })} placeholder="#a1a1aa" />
            <input
            type="color"
            className="oh-tap"
            value={hexToRgb(fields.color) ? (fields.color.startsWith("#") ? fields.color : `#${fields.color}`) : "#a1a1aa"}
            onChange={(event) => setFields({ ...fields, color: event.target.value })}
            style={{ background: "none", border: "none", cursor: "pointer", height: "2.1rem", padding: 0, width: "2.6rem" }}
            />
            </div>
            <button type="button" className="oh-tap-row" disabled={busy} onClick={applyCountry} style={{ ...primaryButtonStyle, marginTop: "0.7rem", width: "100%" }}>
            {adding ? "Create country" : "Save changes"}
            </button>
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "regions") {
        const regionId = String(fields.id ?? "").trim();
        const controller = String(fields.controller ?? fields.owner ?? "").trim();
        const owner = controller;
        const sovereign = String(fields.sovereign ?? controller).trim();
        const claimants = Array.isArray(fields.claimants) ? fields.claimants : [];
        const isContested = claimants.length > 0;
        const isOccupied = Boolean(controller && sovereign && controller !== sovereign);
        const stateLabel = !controller ? "Unclaimed" : isOccupied ? "Occupied" : isContested ? "Disputed" : "Held";
        const stateTone = isOccupied ? "#fcd34d" : isContested ? "#e4e4e7" : controller ? "#86efac" : "rgba(255,255,255,0.55)";

        const normalizeClaimants = (raw, currentOwner = "") => [...new Set(
            (Array.isArray(raw)
                ? raw
                : raw && typeof raw === "object"
                    ? Object.keys(raw).filter((key) => raw[key])
                    : [])
                .map((value) => String(value ?? "").trim())
                .filter((value) => value && value !== currentOwner),
        )];

        const countryNameFromBaseCode = (code) => {
            const raw = String(code ?? "").trim();
            if (!raw) return "";
            return COUNTRY_NAMES[raw]
                || COUNTRY_NAMES[raw.toLowerCase?.()]
                || COUNTRY_NAMES[raw.toUpperCase?.()]
                || raw;
        };

        const readRegionState = async ({ id, rawProps = null, fallback = fields } = {}) => {
            const resolvedId = String(id ?? rawProps?.GID_1 ?? rawProps?.id ?? fallback?.id ?? "").trim();
            if (!resolvedId) throw new Error("That map click did not resolve to a region id.");

            const world = await readWorldState({ force: true });
            const ownership = world?.regionOwnershipOverrides ?? {};
            const sovereignty = world?.regionSovereigntyOverrides ?? {};
            const claims = world?.regionClaimants ?? {};

            const rawBaseGid0 = String(
                rawProps?.gid0
                ?? rawProps?.GID_0
                ?? fallback?.baseGid0
                ?? "",
            ).trim();
            const rawBaseOwner = String(
                rawProps?.owner
                ?? rawProps?.COUNTRY
                ?? fallback?.baseOwner
                ?? "",
            ).trim();
            const baseOwner = rawBaseOwner || countryNameFromBaseCode(rawBaseGid0);

            const currentOwner = Object.prototype.hasOwnProperty.call(ownership, resolvedId)
                ? String(ownership[resolvedId] ?? "").trim()
                : baseOwner;
            // The sovereignty map is sparse: no row means the controller is the sovereign.
            const currentSovereign = Object.prototype.hasOwnProperty.call(sovereignty, resolvedId)
                ? String(sovereignty[resolvedId] ?? "").trim()
                : currentOwner;
            const currentClaimants = normalizeClaimants(claims[resolvedId], currentOwner);

            const geojson = await readJson(JSON_URLS.regionsGeojson, { defaultValue: null, force: true }).catch(() => null);
            const customFeature = geojson?.features?.find((entry) =>
                String(entry?.properties?.id ?? entry?.properties?.GID_1 ?? entry?.id ?? "") === resolvedId
            );
            const displayName = String(
                customFeature?.properties?.name
                ?? customFeature?.properties?.NAME_1
                ?? rawProps?.NAME_1
                ?? fallback?.name
                ?? resolvedId,
            ).trim();

            const next = {
                ...fallback,
                id: resolvedId,
                name: displayName,
                baseGid0: rawBaseGid0,
                baseOwner,
                owner: currentOwner,
                controller: currentOwner,
                sovereign: currentSovereign,
                claimants: currentClaimants,
                // What each claimant is (server/polityRole.js), and the edits
                // typed into the rows below before they are saved.
                claimantRoles: Object.fromEntries(currentClaimants.map((claimant) => [claimant, polityRoleOf(world?.polityOverrides, claimant)])),
                claimantRoleDrafts: {},
                canRename: Boolean(customFeature),
                ownerTarget: currentOwner,
                controllerTarget: currentOwner,
                sovereignTarget: currentSovereign,
                claimantTarget: "",
                claimantTyped: "",
                claimantRoleNew: "",
            };
            setFields(next);
            return { world, geojson, customFeature, next };
        };

        // Every edit goes through the same event-impact seam the simulation uses,
        // so ownership and claims land exactly as an AI event would land them.
        const applyTerritoryImpacts = async (impacts, message) => {
            const world = await readWorldState({ force: true });
            const result = applyEventImpactsToWorld({
                world,
                round: game?.round || 0,
                events: [{
                    id: `admin-region-${Date.now().toString(36)}`,
                    date: game?.gameDate || game?.startDate || "",
                    title: "Region Inspector administrative change",
                    description: "Structured administrative mutation from the Region Inspector.",
                    importance: "minor",
                    kind: "world",
                    notable: false,
                    playerRelated: false,
                    impacts,
                    source: "manual-admin",
                }],
            });
            await writeWorldState(result.world);
            const region = String(fields.name || regionId || "a region");
            const was = (code) => (code ? ` (was ${nameOf(code)})` : "");
            const edits = [
                ...(impacts.regionControlOps ?? []).filter((op) => op.op === "control")
                    .map((op) => `${region} is now held by ${nameOf(op.toCode)}${was(op.fromCode)}`),
                ...(impacts.regionTransfers ?? [])
                    .map((op) => `${region} now belongs legally to ${nameOf(op.toCode)}${was(op.fromCode)}`),
                ...(impacts.regionClaims ?? [])
                    .map((op) => `${nameOf(op.claimantCode)} ${op.drop ? "no longer claims" : "now claims"} ${region}`),
            ];
            if (edits.length) await noteGmChange("territory", `${edits.join("; ")} — set by hand.`);
            await refresh();
            await readRegionState({ id: regionId, fallback: fields });
            return message;
        };

        const infoRow = (label, value, tone = "rgba(255,255,255,0.86)") => (
            <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "7.4rem minmax(0, 1fr)", alignItems: "start" }}>
                <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.66rem", fontWeight: 750, textTransform: "uppercase" }}>{label}</div>
                <div style={{ color: tone, fontSize: "0.76rem", fontWeight: 650, minWidth: 0, overflowWrap: "anywhere" }}>{value || "—"}</div>
            </div>
        );

        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ overflowY: "auto", paddingRight: "0.08rem" }}>
                <div style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.17)", borderRadius: 10, color: "#e4e4e7", fontSize: "0.68rem", lineHeight: 1.45, padding: "0.55rem 0.65rem" }}>
                    <strong style={{ color: "#f4f4f5" }}>Canonical now · evolvable later.</strong> Region edits change the present territorial state only. Future wars, treaties and simulated events remain free to move it again.
                </div>

                <button
                    type="button"
                    className="oh-tap-row"
                    disabled={busy}
                    onClick={() => beginClickMode("Click a region on the map to inspect it", async (props) => {
                        try {
                            setStatus("");
                            await readRegionState({ rawProps: props, fallback: {} });
                        } catch (error) {
                            setStatus(`Failed: ${error.message}`);
                        } finally {
                            endClickMode();
                        }
                    })}
                    style={{ ...primaryButtonStyle, marginTop: "0.55rem", width: "100%" }}
                >
                    {regionId ? "Pick another region on map →" : "Pick a region on map →"}
                </button>

                {regionId && (
                    <>
                    <div style={{ ...editorFieldStyle, marginTop: "0.55rem", padding: "0.58rem 0.65rem" }}>
                        <div style={{ alignItems: "flex-start", display: "flex", gap: "0.65rem", justifyContent: "space-between" }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ color: "#fff", fontSize: "0.92rem", fontWeight: 850, overflowWrap: "anywhere" }}>{fields.name || regionId}</div>
                                <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.61rem", marginTop: "0.12rem" }}>{regionId}</div>
                            </div>
                            <span style={{ background: `${stateTone}18`, border: `1px solid ${stateTone}55`, borderRadius: 999, color: stateTone, flexShrink: 0, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.04em", padding: "0.22rem 0.5rem", textTransform: "uppercase" }}>
                                {stateLabel}
                            </span>
                        </div>
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", display: "grid", gap: "0.38rem", marginTop: "0.52rem", paddingTop: "0.52rem" }}>
                            {infoRow("Base geography", nameOf(fields.baseOwner) || countryNameFromBaseCode(fields.baseGid0))}
                            {fields.baseGid0 && infoRow("Base GID₀", fields.baseGid0, "rgba(255,255,255,0.58)")}
                            {infoRow("Controller", nameOf(controller), isOccupied ? "#fcd34d" : "#d1fae5")}
                            {infoRow("Sovereign", nameOf(sovereign), isOccupied ? "#fde68a" : "rgba(255,255,255,0.86)")}
                            {infoRow("Claimants", claimants.length ? claimants.map(nameOf).join(", ") : "None", claimants.length ? "#f4f4f5" : "rgba(255,255,255,0.55)")}
                        </div>
                    </div>

                    <div style={{ ...editorFieldStyle, marginTop: "0.55rem" }}>
                        <div style={editorSectionLabelStyle}>De-facto control</div>
                        <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.65rem", lineHeight: 1.4, marginBottom: "0.45rem" }}>
                            Changes who physically administers the region. This uses the same canonical control semantics as occupation/liberation: legal sovereignty stays put and displaced parties may remain claimants.
                        </div>
                        <PolitySelect polities={polities} value={fields.controllerTarget ?? controller} onChange={(value) => setFields({ ...fields, controllerTarget: value })} placeholder="Unclaimed / no controller" />
                        <button
                            type="button"
                            className="oh-tap-row"
                            disabled={busy || !fields.controllerTarget || fields.controllerTarget === controller}
                            onClick={() => runBusy(() => applyTerritoryImpacts({
                                regionControlOps: [{
                                    op: "control",
                                    regionId,
                                    regionName: fields.name || "",
                                    fromCode: controller,
                                    toCode: fields.controllerTarget,
                                    note: "Authoritative Region Inspector control edit",
                                }],
                            }, `Controller → ${nameOf(fields.controllerTarget)}.`))}
                            style={{ ...primaryButtonStyle, marginTop: "0.45rem", width: "100%" }}
                        >
                            Apply controller change
                        </button>
                        {isOccupied && (
                            <button
                                type="button"
                                className="oh-tap-row"
                                disabled={busy || !sovereign}
                                onClick={() => runBusy(() => applyTerritoryImpacts({
                                    regionControlOps: [
                                        {
                                            op: "control",
                                            regionId,
                                            regionName: fields.name || "",
                                            fromCode: controller,
                                            toCode: sovereign,
                                            note: "Region Inspector restores legal sovereign control",
                                        },
                                        {
                                            op: "clear_contest",
                                            regionId,
                                            regionName: fields.name || "",
                                            fromCode: sovereign,
                                            claimantCode: controller,
                                            clearAll: false,
                                            note: "Remove displaced foreign controller after restoration",
                                        },
                                    ],
                                }, `Control restored to sovereign ${nameOf(sovereign)}.`))}
                                style={{ ...buttonStyle, marginTop: "0.4rem", width: "100%" }}
                            >
                                Restore sovereign control
                            </button>
                        )}
                    </div>

                    <div style={{ ...editorFieldStyle, marginTop: "0.55rem" }}>
                        <div style={editorSectionLabelStyle}>Legal sovereignty</div>
                        <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.65rem", lineHeight: 1.4, marginBottom: "0.45rem" }}>
                            Formal title only. A legal transfer also moves administration when the old sovereign still controls the ground; a genuine third-party occupier is preserved.
                        </div>
                        <PolitySelect polities={polities} value={fields.sovereignTarget ?? sovereign} onChange={(value) => setFields({ ...fields, sovereignTarget: value })} placeholder="Pick legal sovereign…" />
                        <button
                            type="button"
                            className="oh-tap-row"
                            disabled={busy || !fields.sovereignTarget || fields.sovereignTarget === sovereign}
                            onClick={() => runBusy(() => applyTerritoryImpacts({
                                regionTransfers: [{
                                    regionId,
                                    regionName: fields.name || "",
                                    fromCode: sovereign,
                                    toCode: fields.sovereignTarget,
                                    note: "Authoritative Region Inspector sovereignty transfer",
                                }],
                            }, `Legal sovereignty → ${nameOf(fields.sovereignTarget)}.`))}
                            style={{ ...primaryButtonStyle, marginTop: "0.45rem", width: "100%" }}
                        >
                            Transfer legal sovereignty
                        </button>
                    </div>


                    <div style={{ ...editorFieldStyle, marginTop: "0.55rem" }}>
                        <div style={editorSectionLabelStyle}>Claims & disputed state</div>
                        <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.65rem", lineHeight: 1.4, marginBottom: "0.45rem" }}>
                            A claim marks the region disputed — striped in the claimant's colour — without moving the border. A claimant can be anyone: a country claiming the land as its own, a terrorist organisation, a gang, one side of a civil war. What you write under it is what the AI is told it is, wherever it appears.
                        </div>
                        {claimants.length ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.32rem" }}>
                                {claimants.map((claimant) => {
                                    const savedRole = fields.claimantRoles?.[claimant] ?? "";
                                    const draftRole = fields.claimantRoleDrafts?.[claimant] ?? savedRole;
                                    const roleChanged = draftRole.trim() !== savedRole && draftRole.trim() !== "";
                                    return (
                                    <div key={claimant} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, display: "grid", gap: "0.3rem", padding: "0.38rem 0.5rem" }}>
                                        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                                        <span style={{ color: "#f4f4f5", fontSize: "0.73rem", fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }}>{nameOf(claimant)}</span>
                                        <button
                                            type="button"
                                            className="oh-tap-row"
                                            disabled={busy}
                                            onClick={() => runBusy(() => applyTerritoryImpacts({
                                                regionClaims: [{
                                                    regionId,
                                                    regionName: fields.name || "",
                                                    claimantCode: claimant,
                                                    drop: true,
                                                    note: "Region Inspector withdraws a claim",
                                                }],
                                            }, `${nameOf(claimant)}'s claim withdrawn.`))}
                                            style={{ ...buttonStyle, flexShrink: 0, fontSize: "0.66rem", padding: "0.24rem 0.42rem" }}
                                        >
                                            Withdraw
                                        </button>
                                        </div>
                                        <div style={{ display: "flex", gap: "0.35rem" }}>
                                            <input
                                                value={draftRole}
                                                placeholder={POLITY_ROLE_PLACEHOLDER}
                                                aria-label={`What ${nameOf(claimant)} is`}
                                                onChange={(event) => setFields({ ...fields, claimantRoleDrafts: { ...(fields.claimantRoleDrafts ?? {}), [claimant]: event.target.value } })}
                                                style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: "0.68rem", padding: "0.3rem 0.45rem" }}
                                            />
                                            <button
                                                type="button"
                                                disabled={busy || !roleChanged}
                                                // Restating the claim with a role: the list is unchanged,
                                                // and the role lands on the claimant's record.
                                                onClick={() => runBusy(() => applyTerritoryImpacts({
                                                    regionClaims: [{
                                                        regionId,
                                                        regionName: fields.name || "",
                                                        claimantCode: claimant,
                                                        claimantRole: draftRole.trim(),
                                                        note: "Region Inspector describes a claimant",
                                                    }],
                                                }, `${nameOf(claimant)} is now described as ${draftRole.trim()}.`))}
                                                style={{ ...buttonStyle, flexShrink: 0, fontSize: "0.66rem", padding: "0.24rem 0.42rem" }}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.7rem" }}>No active claimants.</div>
                        )}

                        {(() => {
                            // An existing power from the list, or any name typed in: a
                            // name the world does not know is founded as a landless
                            // claimant when the claim lands (runtime/polityFounding.js).
                            const typed = String(fields.claimantTyped ?? "").trim();
                            const target = typed || fields.claimantTarget || "";
                            const newRole = String(fields.claimantRoleNew ?? "").trim();
                            return (
                            <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem" }}>
                                <PolitySelect polities={polities} value={fields.claimantTarget ?? ""} onChange={(value) => setFields({ ...fields, claimantTarget: value, claimantTyped: "" })} placeholder="Add a claimant…" />
                                <input
                                    value={fields.claimantTyped ?? ""}
                                    placeholder="…or type any name (a movement, a gang, a faction)"
                                    onChange={(event) => setFields({ ...fields, claimantTyped: event.target.value })}
                                    style={{ ...inputStyle, fontSize: "0.7rem" }}
                                />
                                <div style={{ display: "flex", gap: "0.4rem" }}>
                                    <input
                                        value={fields.claimantRoleNew ?? ""}
                                        placeholder={`What it is — ${POLITY_ROLE_PLACEHOLDER}`}
                                        onChange={(event) => setFields({ ...fields, claimantRoleNew: event.target.value })}
                                        style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: "0.7rem" }}
                                    />
                                    <button
                                        type="button"
                                        className="oh-tap-row"
                                        disabled={busy || !target || target === owner || claimants.includes(target)}
                                        onClick={() => runBusy(() => applyTerritoryImpacts({
                                            regionClaims: [{
                                                regionId,
                                                regionName: fields.name || "",
                                                claimantCode: target,
                                                ...(newRole ? { claimantRole: newRole } : {}),
                                                note: "Region Inspector asserts a claim",
                                            }],
                                        }, `${nameOf(target)} now claims the region.`))}
                                        style={{ ...primaryButtonStyle, flexShrink: 0, padding: "0.5rem 0.7rem" }}
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                            );
                        })()}

                        {claimants.length > 0 && (
                            <button
                                type="button"
                                className="oh-tap-row"
                                disabled={busy}
                                onClick={() => runBusy(() => applyTerritoryImpacts({
                                    regionClaims: claimants.map((claimant) => ({
                                        regionId,
                                        regionName: fields.name || "",
                                        claimantCode: claimant,
                                        drop: true,
                                        note: "Region Inspector clears all claims",
                                    })),
                                }, "All claims withdrawn."))}
                                style={{ ...buttonStyle, marginTop: "0.42rem", width: "100%" }}
                            >
                                Withdraw all claims
                            </button>
                        )}
                    </div>

                    <details style={{ ...editorFieldStyle, marginTop: "0.55rem", padding: "0.5rem 0.6rem" }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.69rem", fontWeight: 800, ...(touch ? TOUCH_SUMMARY : null) }}>Advanced · region identity</summary>
                        <div style={{ marginTop: "0.5rem" }}>
                            <label style={labelStyle}>Region name</label>
                            <input
                                style={inputStyle}
                                value={fields.name ?? ""}
                                disabled={!fields.canRename}
                                onChange={(event) => setFields({ ...fields, name: event.target.value })}
                            />
                            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.62rem", lineHeight: 1.4, marginTop: "0.3rem" }}>
                                {fields.canRename
                                    ? "This scenario has editable custom region geometry. Renaming preserves the stable region ID."
                                    : "Stock-map region names come from immutable map tiles, so this name is read-only here."}
                            </div>
                            {fields.canRename && (
                                <button
                                    type="button"
                                    className="oh-tap-row"
                                    disabled={busy || !String(fields.name ?? "").trim()}
                                    onClick={() => runBusy(async () => {
                                        const geojson = await readJson(JSON_URLS.regionsGeojson, { defaultValue: null, force: true });
                                        const feature = geojson?.features?.find((entry) =>
                                            String(entry?.properties?.id ?? entry?.properties?.GID_1 ?? entry?.id ?? "") === regionId
                                        );
                                        if (!feature) throw new Error("The editable region geometry disappeared; pick the region again.");
                                        const formerName = String(feature.properties?.name ?? "").trim();
                                        feature.properties = { ...(feature.properties ?? {}), name: String(fields.name).trim() };
                                        await writeJson(JSON_URLS.regionsGeojson, geojson, { pretty: true });
                                        if (formerName && formerName !== String(fields.name).trim()) {
                                            await noteGmChange("territory", `Renamed the region ${formerName} to ${String(fields.name).trim()} by hand; it is the same place.`);
                                        }
                                        await readRegionState({ id: regionId, fallback: fields });
                                        return `Region name → ${String(fields.name).trim()}.`;
                                    })}
                                    style={{ ...primaryButtonStyle, marginTop: "0.45rem", width: "100%" }}
                                >
                                    Save region name
                                </button>
                            )}
                            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", fontSize: "0.62rem", lineHeight: 1.45, marginTop: "0.5rem", paddingTop: "0.45rem" }}>
                                Region ID: <code>{regionId}</code><br />
                                Base geography: {nameOf(fields.baseOwner) || countryNameFromBaseCode(fields.baseGid0) || "unknown"}
                                {fields.baseGid0 ? <> · GID₀ <code>{fields.baseGid0}</code></> : null}
                            </div>
                        </div>
                    </details>
                    </>
                )}

                {!regionId && (
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", lineHeight: 1.45, marginTop: "0.55rem" }}>
                        Pick any map region to inspect who holds it, who claims it, and its geographic provenance.
                    </div>
                )}
                {statusLine}
            </div>
            </>
        );
    }

    if (tool === "edit-feature") {
        const data = items && !Array.isArray(items)
            ? items
            : { customCities: false, markers: [], cities: [] };
        const markers = data.markers ?? [];
        const cities = data.cities ?? [];
        const q = search.trim().toLowerCase();
        const defaultTab = markers.length || !data.customCities ? "runtime" : "cities";
        const activeTab = fields.featureTab || defaultTab;
        const kindLabel = (kind) => MAP_FEATURE_KINDS.find((entry) => entry.id === String(kind ?? "").toLowerCase())?.label
            || String(kind || "landmark").replace(/\b\w/g, (letter) => letter.toUpperCase());
        const choiceButton = (active) => ({
            ...buttonStyle,
            background: active ? "rgba(0,0,0,0.48)" : "rgba(255,255,255,0.05)",
            border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.1)",
            color: active ? "#f4f4f5" : "rgba(255,255,255,0.72)",
            fontSize: "0.68rem",
            padding: "0.38rem 0.45rem",
        });
        const setFeatureTab = (featureTab) => {
            setEditingId(null);
            setFields({ featureTab });
            setSearch("");
        };
        const markerRows = markers
            .filter((marker) => !q || [marker?.name, marker?.kind, marker?.ownerCode, marker?.status, marker?.note].some((value) => String(value ?? "").toLowerCase().includes(q)))
            .slice(0, 80);
        const cityRows = cities
            .map((feature, index) => ({ feature, index }))
            .filter(({ feature }) => !q || [feature?.properties?.city, feature?.properties?.name].some((value) => String(value ?? "").toLowerCase().includes(q)))
            .slice(0, 80);

        const markerFromForm = (marker, coords = null) => ({
            ...marker,
            id: marker.id,
            name: String(fields.name ?? marker.name ?? "").trim(),
            kind: (fields.kind === "other" ? String(fields.customKind ?? "").trim() : String(fields.kind ?? marker.kind ?? "landmark").trim()) || "landmark",
            ownerCode: String(fields.ownerCode ?? marker.ownerCode ?? "").trim(),
            lng: Number(coords?.lng ?? fields.lng ?? marker.lng),
            lat: Number(coords?.lat ?? fields.lat ?? marker.lat),
            note: String(fields.note ?? marker.note ?? "").trim(),
            status: MARKER_STATUSES.includes(String(fields.status ?? marker.status ?? "active").trim().toLowerCase())
                ? String(fields.status ?? marker.status ?? "active").trim().toLowerCase()
                : "active",
            foundedAt: String(fields.foundedAt ?? marker.foundedAt ?? "").trim(),
            createdAt: marker.createdAt,
        });

        const saveMarker = async (marker, coords = null) => {
            const nextMarker = markerFromForm(marker, coords);
            if (!nextMarker.name) throw new Error("Give the feature a name.");
            if (markers.some((entry) => entry.id !== marker.id && String(entry.name || "").trim().toLowerCase() === nextMarker.name.toLowerCase())) {
                throw new Error(`Another runtime feature is already named “${nextMarker.name}”. Use a unique name so stable marker identities never become ambiguous.`);
            }
            if (!Number.isFinite(nextMarker.lng) || !Number.isFinite(nextMarker.lat) || (nextMarker.lng === 0 && nextMarker.lat === 0)) {
                throw new Error("The feature needs valid map coordinates.");
            }
            const markerOps = [];
            if (String(nextMarker.name).trim() !== String(marker.name || "").trim()) {
                markerOps.push({
                    op: "rename",
                    markerId: marker.id,
                    name: marker.name,
                    newName: nextMarker.name,
                    note: "Map Feature Editor rename",
                });
            }
            markerOps.push({
                op: "update",
                markerId: marker.id,
                name: nextMarker.name,
                kind: nextMarker.kind,
                ownerCode: nextMarker.ownerCode,
                status: nextMarker.status,
                lng: nextMarker.lng,
                lat: nextMarker.lat,
                note: nextMarker.note,
                foundedAt: nextMarker.foundedAt,
            });
            const refreshed = await applyAdminMarkerOps(markerOps);
            return (refreshed?.markers ?? []).find((entry) => entry.id === marker.id) || nextMarker;
        };

        const editCity = async (index, coords = null) => {
            const current = cities[index];
            if (!current) throw new Error("That scenario city no longer exists.");
            const tier = Math.max(1, Math.min(4, Number(fields.tier) || Number(current?.properties?.tier) || 2));
            const populationRaw = fields.population;
            const population = Number(populationRaw);
            const name = String(fields.name ?? current?.properties?.city ?? current?.properties?.name ?? "").trim();
            if (!name) throw new Error("Give the city a name.");
            const nextCities = cities.map((entry, i) => {
                if (i !== index) return entry;
                const coordinates = coords
                    ? [Number(coords.lng), Number(coords.lat)]
                    : entry?.geometry?.coordinates;
                return {
                    ...entry,
                    geometry: { ...(entry.geometry || {}), type: "Point", coordinates },
                    properties: {
                        ...(entry.properties || {}),
                        city: name,
                        name,
                        tier,
                        capital: tier === 4 ? "primary" : "",
                        ...(String(populationRaw ?? "").trim() && Number.isFinite(population) && population >= 0
                            ? { population: Math.round(population) }
                            : { population: 0 }),
                    },
                };
            });
            await saveScenarioCities(nextCities);
            return { name, tier };
        };

        return (
            <>
            {header(meta.title, "Runtime world features + scenario-authored cities")}
            {/* On a phone the whole tool scrolls as one, the list with it: with
                the notes, tabs and search held in place, a phone held sideways
                had no room left for the list at all. */}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", ...(isMobile || touch ? { overflow: "auto" } : null) }}>
                <div style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    color: "rgba(255,255,255,0.55)",
                    fontSize: "0.66rem",
                    lineHeight: 1.45,
                    marginBottom: "0.55rem",
                    padding: "0.55rem 0.62rem",
                }}>
                    <strong style={{ color: "#f4f4f5" }}>Two native layers, one editor.</strong> Runtime features live in the canonical world and coexist with cities. Scenario cities are the authored historical city set used when this scenario has custom cities enabled.
                </div>

                <button
                    type="button"
                    className="oh-tap-row"
                    onClick={() => navigateTool?.("add-feature")}
                    style={{ ...primaryButtonStyle, marginBottom: "0.5rem", width: "100%" }}
                >
                    + Add new map feature
                </button>

                <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "1fr 1fr", marginBottom: "0.5rem" }}>
                    <button type="button" className="oh-tap-row" onClick={() => setFeatureTab("runtime")} style={choiceButton(activeTab === "runtime")}>
                        World features · {markers.length}
                    </button>
                    <button type="button" className="oh-tap-row" onClick={() => setFeatureTab("cities")} style={choiceButton(activeTab === "cities")}>
                        Scenario cities · {cities.length}
                    </button>
                </div>

                <input
                    style={inputStyle}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={activeTab === "runtime" ? "Search name, type, owner, status…" : "Search scenario cities…"}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: "0.38rem", marginTop: "0.5rem", overflowY: isMobile || touch ? "visible" : "auto", paddingRight: "0.08rem" }}>
                {activeTab === "runtime" && markerRows.length === 0 && (
                    <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.72rem", lineHeight: 1.45, padding: "0.55rem 0" }}>
                        No runtime world features match this view. Use + Add new map feature above to create HQs, ports, landmarks, temporary markers, and more without replacing the city layer.
                    </div>
                )}

                {activeTab === "runtime" && markerRows.map((marker) => {
                    const key = `marker:${marker.id}`;
                    const isEditing = editingId === key;
                    return (
                        <div key={key} style={{ background: "rgba(255,255,255,0.04)", border: isEditing ? "1px solid rgba(0,0,0,0.5)" : "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "0.55rem 0.62rem" }}>
                            <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ alignItems: "center", display: "flex", gap: "0.36rem", minWidth: 0 }}>
                                        <span style={{ color: "#f4f4f5", fontSize: "0.8rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{marker.name}</span>
                                        <span style={{ ...badgeStyle, color: "#e4e4e7" }}>RUNTIME</span>
                                        <span style={{ ...badgeStyle, color: mapFeatureStatusMeta(marker.status).color }}>
                                            {mapFeatureStatusMeta(marker.status).label}
                                        </span>
                                    </div>
                                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.63rem", marginTop: "0.1rem" }}>
                                        {kindLabel(marker.kind)}{marker.ownerCode ? ` · ${nameOf(marker.ownerCode)}` : ""}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                                    <button
                                        type="button"
                                        className="oh-tap-row"
                                        onClick={() => {
                                            if (isEditing) {
                                                setEditingId(null);
                                                setFields({ featureTab: "runtime" });
                                                return;
                                            }
                                            const knownKind = MAP_FEATURE_KINDS.some((entry) => entry.id === marker.kind) ? marker.kind : "other";
                                            setEditingId(key);
                                            setFields({
                                                featureTab: "runtime",
                                                name: marker.name || "",
                                                kind: knownKind,
                                                customKind: knownKind === "other" ? marker.kind || "" : "",
                                                ownerCode: marker.ownerCode || "",
                                                status: marker.status || "active",
                                                note: marker.note || "",
                                                foundedAt: marker.foundedAt || "",
                                                lng: String(marker.lng ?? ""),
                                                lat: String(marker.lat ?? ""),
                                            });
                                        }}
                                        style={{ ...buttonStyle, padding: "0.25rem 0.5rem" }}
                                    >
                                        {isEditing ? "Close" : "Edit"}
                                    </button>
                                    <button
                                        type="button"
                                        className="oh-tap-row"
                                        disabled={busy}
                                        onClick={() => {
                                            if (!window.confirm(`Delete “${marker.name}” from the canonical world?`)) return;
                                            runBusy(async () => {
                                                await applyAdminMarkerOps([{ op: "remove", markerId: marker.id, name: marker.name, note: "Map Feature Editor delete" }]);
                                                setEditingId(null);
                                                setFields({ featureTab: "runtime" });
                                                return `${marker.name} deleted.`;
                                            });
                                        }}
                                        style={{ ...buttonStyle, color: "#fda4af", padding: "0.25rem 0.5rem" }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>

                            {isEditing && (
                                <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
                                    <label style={{ ...labelStyle, marginTop: 0 }}>Name</label>
                                    <input style={inputStyle} value={fields.name ?? ""} onChange={(event) => setFields({ ...fields, name: event.target.value })} />

                                    <label style={labelStyle}>Feature type</label>
                                    {/* Two across on a phone, where a third of the card could
                                        not hold "Fortification" or "Industrial Site". */}
                                    <div style={{ display: "grid", gap: "0.28rem", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))" }}>
                                    {MAP_FEATURE_KINDS.map((kind) => (
                                        <button key={kind.id} type="button" className="oh-tap-row" onClick={() => setFields({ ...fields, kind: kind.id })} style={choiceButton(fields.kind === kind.id)}>
                                            {kind.icon} {kind.label}
                                        </button>
                                    ))}
                                    </div>
                                    {fields.kind === "other" && (
                                        <input style={{ ...inputStyle, marginTop: "0.38rem" }} value={fields.customKind ?? ""} onChange={(event) => setFields({ ...fields, customKind: event.target.value })} placeholder="Custom type, e.g. observatory" />
                                    )}

                                    <label style={labelStyle}>Associated country (optional)</label>
                                    <PolitySelect polities={polities} value={fields.ownerCode ?? ""} onChange={(value) => setFields({ ...fields, ownerCode: value })} placeholder="Neutral / no associated country" />

                                    <label style={labelStyle}>Lifecycle status</label>
                                    <select
                                        value={fields.status || "active"}
                                        onChange={(event) => setFields({ ...fields, status: event.target.value })}
                                        style={{ ...inputStyle, colorScheme: "dark", cursor: "pointer" }}
                                    >
                                        {MARKER_STATUSES.map((markerStatus) => (
                                            <option key={markerStatus} value={markerStatus} style={{ background: "#18181b", color: "#fff" }}>
                                                {mapFeatureStatusMeta(markerStatus).label}
                                            </option>
                                        ))}
                                    </select>

                                    <label style={labelStyle}>Note (optional)</label>
                                    <textarea style={{ ...inputStyle, minHeight: "4.2rem", resize: "vertical" }} value={fields.note ?? ""} onChange={(event) => setFields({ ...fields, note: event.target.value })} />

                                    <label style={labelStyle}>Founded / established date (optional)</label>
                                    <input style={inputStyle} value={fields.foundedAt ?? ""} onChange={(event) => setFields({ ...fields, foundedAt: event.target.value })} placeholder={game?.gameDate || "YYYY-MM-DD"} />

                                    <div style={{ display: "grid", gap: "0.38rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.55rem" }}>
                                        <button
                                            type="button"
                                            className="oh-tap-row"
                                            disabled={busy}
                                            onClick={() => {
                                                beginClickMode(`Click the new map position for “${marker.name}”`, async (props) => {
                                                    try {
                                                        if (!props?.lngLat) throw new Error("That click did not contain map coordinates.");
                                                        await saveMarker(marker, props.lngLat);
                                                        endClickMode();
                                                        setEditingId(null);
                                                        setFields({ featureTab: "runtime" });
                                                        setStatus(`${marker.name} moved authoritatively.`);
                                                    } catch (error) {
                                                        endClickMode();
                                                        setStatus(`Failed: ${error.message}`);
                                                    }
                                                });
                                            }}
                                            style={buttonStyle}
                                        >
                                            Place on map →
                                        </button>
                                        <button
                                            type="button"
                                            className="oh-tap-row"
                                            disabled={busy}
                                            onClick={() => runBusy(async () => {
                                                const saved = await saveMarker(marker);
                                                setEditingId(null);
                                                setFields({ featureTab: "runtime" });
                                                return `${saved.name} saved.`;
                                            })}
                                            style={primaryButtonStyle}
                                        >
                                            Save feature
                                        </button>
                                    </div>

                                    <details style={{ marginTop: "0.45rem" }}>
                                        <summary style={{ color: "rgba(255,255,255,0.48)", cursor: "pointer", fontSize: "0.64rem", ...(touch ? TOUCH_SUMMARY : null) }}>Manual coordinates · advanced</summary>
                                        <div style={{ display: "grid", gap: "0.38rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.38rem" }}>
                                            <input style={inputStyle} value={fields.lng ?? ""} onChange={(event) => setFields({ ...fields, lng: event.target.value })} placeholder="Longitude" />
                                            <input style={inputStyle} value={fields.lat ?? ""} onChange={(event) => setFields({ ...fields, lat: event.target.value })} placeholder="Latitude" />
                                        </div>
                                    </details>
                                </div>
                            )}
                        </div>
                    );
                })}

                {activeTab === "cities" && !data.customCities && (
                    <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", borderRadius: 9, color: "rgba(253,230,138,0.92)", fontSize: "0.68rem", lineHeight: 1.45, padding: "0.55rem 0.62rem" }}>
                        This campaign currently uses the stock PMTiles city database. Those source records are immutable at runtime. Add Map Feature will therefore create new cities as runtime world features instead of replacing every stock city.
                    </div>
                )}

                {activeTab === "cities" && data.customCities && cityRows.length === 0 && (
                    <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.72rem", lineHeight: 1.45, padding: "0.55rem 0" }}>
                        No scenario cities match this view.
                    </div>
                )}

                {activeTab === "cities" && data.customCities && cityRows.map(({ feature, index }) => {
                    const props = feature?.properties ?? {};
                    const coords = feature?.geometry?.coordinates ?? [];
                    const key = `city:${index}`;
                    const isEditing = editingId === key;
                    const tier = Math.max(1, Math.min(4, Number(props.tier) || (props.capital === "primary" || props.capital === true ? 4 : 2)));
                    return (
                        <div key={key} style={{ background: "rgba(255,255,255,0.04)", border: isEditing ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "0.55rem 0.62rem" }}>
                            <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ alignItems: "center", display: "flex", gap: "0.36rem", minWidth: 0 }}>
                                        <span style={{ color: "#fff", fontSize: "0.8rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.city || props.name || `City ${index + 1}`}</span>
                                        <span style={{ ...badgeStyle, color: "#bfdbfe" }}>CITY</span>
                                    </div>
                                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.63rem", marginTop: "0.1rem" }}>
                                        {CITY_PROMINENCE.find((entry) => entry.tier === tier)?.label || `Tier ${tier}`}{Number(props.population) > 0 ? ` · ${Number(props.population).toLocaleString()}` : ""}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                                    <button
                                        type="button"
                                        className="oh-tap-row"
                                        onClick={() => {
                                            if (isEditing) {
                                                setEditingId(null);
                                                setFields({ featureTab: "cities" });
                                            } else {
                                                setEditingId(key);
                                                setFields({
                                                    featureTab: "cities",
                                                    name: props.city || props.name || "",
                                                    tier: String(tier),
                                                    population: String(props.population ?? ""),
                                                });
                                            }
                                        }}
                                        style={{ ...buttonStyle, padding: "0.25rem 0.5rem" }}
                                    >
                                        {isEditing ? "Close" : "Edit"}
                                    </button>
                                    <button
                                        type="button"
                                        className="oh-tap-row"
                                        disabled={busy}
                                        onClick={() => {
                                            const name = props.city || props.name || `City ${index + 1}`;
                                            if (!window.confirm(`Delete scenario city “${name}”?`)) return;
                                            runBusy(async () => {
                                                await saveScenarioCities(cities.filter((_, i) => i !== index));
                                                setEditingId(null);
                                                setFields({ featureTab: "cities" });
                                                return `${name} deleted from the scenario city layer.`;
                                            });
                                        }}
                                        style={{ ...buttonStyle, color: "#fda4af", padding: "0.25rem 0.5rem" }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>

                            {isEditing && (
                                <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
                                    <label style={{ ...labelStyle, marginTop: 0 }}>Name</label>
                                    <input style={inputStyle} value={fields.name ?? ""} onChange={(event) => setFields({ ...fields, name: event.target.value })} />

                                    <label style={labelStyle}>Prominence</label>
                                    <div style={{ display: "grid", gap: "0.3rem", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))" }}>
                                    {CITY_PROMINENCE.map((entry) => (
                                        <button key={entry.tier} type="button" className="oh-tap-row" onClick={() => setFields({ ...fields, tier: String(entry.tier) })} style={choiceButton(Number(fields.tier) === entry.tier)}>
                                            {entry.label}
                                        </button>
                                    ))}
                                    </div>

                                    <label style={labelStyle}>Population</label>
                                    <input type="number" min="0" step="1000" style={inputStyle} value={fields.population ?? ""} onChange={(event) => setFields({ ...fields, population: event.target.value })} />

                                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.63rem", lineHeight: 1.45, marginTop: "0.4rem" }}>
                                        Tier controls historical-map visibility: Town → City → Major city → Capital. Capital uses the renderer's canonical <code>primary</code> flag.
                                    </div>

                                    <div style={{ display: "grid", gap: "0.38rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.55rem" }}>
                                        <button
                                            type="button"
                                            className="oh-tap-row"
                                            disabled={busy}
                                            onClick={() => {
                                                const oldName = props.city || props.name || `City ${index + 1}`;
                                                beginClickMode(`Click the new map position for “${oldName}”`, async (clickProps) => {
                                                    try {
                                                        if (!clickProps?.lngLat) throw new Error("That click did not contain map coordinates.");
                                                        const saved = await editCity(index, clickProps.lngLat);
                                                        endClickMode();
                                                        setEditingId(null);
                                                        setFields({ featureTab: "cities" });
                                                        setStatus(`${saved.name} moved on the scenario city layer.`);
                                                    } catch (error) {
                                                        endClickMode();
                                                        setStatus(`Failed: ${error.message}`);
                                                    }
                                                });
                                            }}
                                            style={buttonStyle}
                                        >
                                            Place on map →
                                        </button>
                                        <button
                                            type="button"
                                            className="oh-tap-row"
                                            disabled={busy}
                                            onClick={() => runBusy(async () => {
                                                const saved = await editCity(index);
                                                setEditingId(null);
                                                setFields({ featureTab: "cities" });
                                                return `${saved.name} saved and refreshed on the map.`;
                                            })}
                                            style={primaryButtonStyle}
                                        >
                                            Save city
                                        </button>
                                    </div>
                                    <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.6rem", marginTop: "0.35rem" }}>
                                        Coordinates: {Number(coords[0]).toFixed?.(4) ?? "—"}, {Number(coords[1]).toFixed?.(4) ?? "—"}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                </div>
                {statusLine}
            </div>
            </>
        );
    }

    if (tool === "add-feature") {
        const type = fields.addType || "landmark";
        const isCity = type === "city";
        const customKind = type === "other" ? String(fields.customKind ?? "").trim() : type;
        const choiceStyle = (active) => ({
            ...buttonStyle,
            background: active ? "rgba(0,0,0,0.48)" : "rgba(255,255,255,0.05)",
            border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.1)",
            color: active ? "#f4f4f5" : "rgba(255,255,255,0.72)",
            fontSize: "0.68rem",
            padding: "0.42rem 0.45rem",
        });
        const currentUsesCustomCities = Boolean(items && !Array.isArray(items) && items.customCities);


        const beginPlacement = () => {
            const name = String(fields.name ?? "").trim();
            if (!name) {
                setStatus("Failed: Give the feature a name first.");
                return;
            }
            if (type === "other" && !customKind) {
                setStatus("Failed: Give the custom feature type a name.");
                return;
            }
            const tier = Math.max(1, Math.min(4, Number(fields.tier) || 2));
            const population = Number(fields.population);
            const ownerCode = String(fields.ownerCode ?? "").trim();
            const markerStatusRaw = String(fields.status ?? "active").trim().toLowerCase();
            const markerStatus = MARKER_STATUSES.includes(markerStatusRaw) ? markerStatusRaw : "active";
            const note = String(fields.note ?? "").trim();
            const foundedAt = String(fields.foundedAt ?? game?.gameDate ?? "").trim();

            beginClickMode(`Click the map where “${name}” goes`, async (props) => {
                try {
                    if (!props?.lngLat) throw new Error("That click did not contain map coordinates.");
                    const lng = Number(props.lngLat.lng);
                    const lat = Number(props.lngLat.lat);

                    if (isCity && currentUsesCustomCities) {
                        const latest = await readJson(JSON_URLS.citiesGeojson, { defaultValue: EMPTY_FEATURES, force: true });
                        const nextCities = [...(latest?.features ?? []), {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [lng, lat] },
                            properties: {
                                city: name,
                                name,
                                tier,
                                capital: tier === 4 ? "primary" : "",
                                ...(Number.isFinite(population) && population >= 0 ? { population: Math.round(population) } : { population: 0 }),
                            },
                        }];
                        await saveScenarioCities(nextCities);
                        endClickMode();
                        setFields({ addType: "city" });
                        setStatus(`${name} added to the scenario city layer and refreshed live.`);
                        return;
                    }

                    const latestWorld = await readWorldState({ force: true });
                    if ((latestWorld?.markers ?? []).some((entry) => String(entry?.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
                        throw new Error(`A runtime feature named “${name}” already exists. Edit the existing feature or choose a unique name.`);
                    }
                    await applyAdminMarkerOps([{
                        op: "build",
                        marker: {
                            name,
                            kind: isCity ? "city" : customKind,
                            ownerCode,
                            status: markerStatus,
                            lng,
                            lat,
                            note,
                            foundedAt,
                        },
                    }]);
                    endClickMode();
                    setFields({ addType: type, status: "active" });
                    setStatus(`${name} added as a persistent world feature.`);
                } catch (error) {
                    endClickMode();
                    setStatus(`Failed: ${error.message}`);
                }
            });
        };

        const kindChoices = MAP_FEATURE_KINDS;

        return (
            <>
            {header(meta.title, "Create a persistent city or world feature without replacing unrelated map data")}
            <div style={{ overflowY: "auto", paddingRight: "0.08rem" }}>
                <button
                    type="button"
                    className="oh-tap"
                    onClick={() => navigateTool?.("edit-feature")}
                    style={{ ...buttonStyle, marginBottom: "0.55rem", width: "100%" }}
                >
                    ← Back to Map Feature Editor
                </button>
                <div style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 10, color: "rgba(219,234,254,0.82)", fontSize: "0.66rem", lineHeight: 1.45, marginBottom: "0.55rem", padding: "0.55rem 0.62rem" }}>
                    <strong>Safe coexistence:</strong> HQs, ports, landmarks, and other live features go into <code>world.markers</code>. A new city joins the scenario city dataset only when this scenario already uses one; otherwise it becomes a runtime city marker so the stock city database stays intact.
                </div>

                <label style={{ ...labelStyle, marginTop: 0 }}>Feature type</label>
                <div style={{ display: "grid", gap: "0.3rem", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))" }}>
                {kindChoices.map((kind) => (
                    <button key={kind.id} type="button" className="oh-tap-row" onClick={() => setFields({ ...fields, addType: kind.id })} style={choiceStyle(type === kind.id)}>
                        {kind.icon} {kind.label}
                    </button>
                ))}
                </div>
                {type === "other" && (
                    <input style={{ ...inputStyle, marginTop: "0.38rem" }} value={fields.customKind ?? ""} onChange={(event) => setFields({ ...fields, customKind: event.target.value })} placeholder="Custom type, e.g. observatory" />
                )}

                <label style={labelStyle}>Name</label>
                <input style={inputStyle} value={fields.name ?? ""} onChange={(event) => setFields({ ...fields, name: event.target.value })} placeholder={isCity ? "Alexandria" : "German Military Mission HQ"} />

                {isCity && currentUsesCustomCities ? (
                    <>
                    <label style={labelStyle}>Prominence</label>
                    <div style={{ display: "grid", gap: "0.3rem", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))" }}>
                    {CITY_PROMINENCE.map((entry) => (
                        <button key={entry.tier} type="button" className="oh-tap-row" onClick={() => setFields({ ...fields, tier: String(entry.tier) })} style={choiceStyle(Number(fields.tier || 2) === entry.tier)}>
                            {entry.label}
                        </button>
                    ))}
                    </div>
                    <label style={labelStyle}>Population (optional)</label>
                    <input type="number" min="0" step="1000" style={inputStyle} value={fields.population ?? ""} onChange={(event) => setFields({ ...fields, population: event.target.value })} />
                    <div style={{ color: "#bfdbfe", fontSize: "0.63rem", lineHeight: 1.45, marginTop: "0.4rem" }}>
                        This scenario already uses historical custom cities, so the new city will join that same authored layer with proper population and prominence metadata.
                    </div>
                    </>
                ) : (
                    <>
                    {isCity && (
                        <div style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 8, color: "rgba(253,230,138,0.82)", fontSize: "0.63rem", lineHeight: 1.45, marginTop: "0.5rem", padding: "0.45rem 0.52rem" }}>
                            This campaign uses immutable stock cities. The new city will therefore be a runtime city marker so the stock database stays intact. Runtime markers do not currently carry city population/prominence fields.
                        </div>
                    )}
                    <label style={labelStyle}>Associated country (optional)</label>
                    <PolitySelect polities={polities} value={fields.ownerCode ?? ""} onChange={(value) => setFields({ ...fields, ownerCode: value })} placeholder="Neutral / no associated country" />
                    <label style={labelStyle}>Lifecycle status</label>
                    <select
                        value={fields.status || "active"}
                        onChange={(event) => setFields({ ...fields, status: event.target.value })}
                        style={{ ...inputStyle, colorScheme: "dark", cursor: "pointer" }}
                    >
                        {MARKER_STATUSES.map((markerStatus) => (
                            <option key={markerStatus} value={markerStatus} style={{ background: "#18181b", color: "#fff" }}>
                                {mapFeatureStatusMeta(markerStatus).label}
                            </option>
                        ))}
                    </select>
                    <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.4, marginTop: "0.3rem" }}>
                        Planned and under-construction features remain canonical map objects before they become operational; damaged, abandoned, and destroyed features also remain visible historical objects.
                    </div>
                    <label style={labelStyle}>Note (optional)</label>
                    <textarea style={{ ...inputStyle, minHeight: "4.2rem", resize: "vertical" }} value={fields.note ?? ""} onChange={(event) => setFields({ ...fields, note: event.target.value })} placeholder="Purpose, status, or short description…" />
                    <label style={labelStyle}>Founded / established date (optional)</label>
                    <input style={inputStyle} value={fields.foundedAt ?? game?.gameDate ?? ""} onChange={(event) => setFields({ ...fields, foundedAt: event.target.value })} placeholder="YYYY-MM-DD" />
                    </>
                )}

                <button type="button" className="oh-tap-row" disabled={busy || !String(fields.name ?? "").trim()} onClick={beginPlacement} style={{ ...primaryButtonStyle, marginTop: "0.72rem", width: "100%" }}>
                    Place on map →
                </button>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.62rem", lineHeight: 1.45, marginTop: "0.38rem" }}>
                    Placement changes the present canonical world only. Normal future simulation remains free to rename or lifecycle-update the same stable feature; historical damage/destruction changes status rather than deleting its identity.
                </div>
                {statusLine}
            </div>
            </>
        );
    }

    if (tool === "clear-features") {
        const data = items && !Array.isArray(items)
            ? items
            : { customCities: false, markers: [], cities: [] };
        const markerCount = data.markers?.length ?? 0;
        const cityCount = data.cities?.length ?? 0;
        return (
            <>
            {header(meta.title, "Destructive cleanup for runtime features and scenario city layers")}
            <div style={{ overflowY: "auto" }}>
                <div style={{ display: "grid", gap: "0.42rem", gridTemplateColumns: "1fr 1fr" }}>
                    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "0.55rem" }}>
                        <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase" }}>Runtime features</div>
                        <div style={{ fontSize: "1rem", fontWeight: 850, marginTop: "0.12rem" }}>{markerCount}</div>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "0.55rem" }}>
                        <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase" }}>Scenario cities</div>
                        <div style={{ fontSize: "1rem", fontWeight: 850, marginTop: "0.12rem" }}>{data.customCities ? cityCount : "Stock"}</div>
                    </div>
                </div>

                <button
                    type="button"
                    className="oh-tap-row"
                    disabled={busy || markerCount === 0}
                    onClick={() => {
                        if (!window.confirm(`Delete all ${markerCount} runtime world feature${markerCount === 1 ? "" : "s"}?`)) return;
                        runBusy(async () => {
                            await applyAdminMarkerOps(data.markers.map((marker) => ({ op: "remove", markerId: marker.id, name: marker.name, note: "Clear Map Features" })));
                            return "All runtime world features removed.";
                        });
                    }}
                    style={{ ...buttonStyle, color: markerCount ? "#fda4af" : "rgba(255,255,255,0.35)", marginTop: "0.65rem", width: "100%" }}
                >
                    Delete all runtime features
                </button>

                {data.customCities && (
                    <button
                        type="button"
                        className="oh-tap-row"
                        disabled={busy || cityCount === 0}
                        onClick={() => {
                            if (!window.confirm(`Delete all ${cityCount} scenario-authored cities? The historical city layer will become empty.`)) return;
                            runBusy(async () => {
                                await saveScenarioCities([]);
                                return "Scenario city layer cleared.";
                            });
                        }}
                        style={{ ...buttonStyle, color: cityCount ? "#fda4af" : "rgba(255,255,255,0.35)", marginTop: "0.42rem", width: "100%" }}
                    >
                        Delete all scenario cities
                    </button>
                )}

                <details style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9, marginTop: "0.55rem", padding: "0.5rem 0.58rem" }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.68rem", fontWeight: 800, ...(touch ? TOUCH_SUMMARY : null) }}>Advanced · city-layer source</summary>
                    <div style={{ color: "rgba(255,255,255,0.43)", fontSize: "0.63rem", lineHeight: 1.45, marginTop: "0.45rem" }}>
                        Turning off scenario cities restores the stock PMTiles city database. On historical scenarios this may reintroduce modern/anachronistic cities, so this is intentionally not the default cleanup action.
                    </div>
                    <button
                        type="button"
                        className="oh-tap-row"
                        disabled={busy || !data.customCities}
                        onClick={() => runBusy(async () => {
                            const world = await readWorldState({ force: true });
                            await writeWorldState({ ...world, customCities: false });
                            await noteGmChange("feature", "Replaced the scenario's own cities with the standard world city list, by hand.");
                            await refresh();
                            await loadMapFeatureData();
                            return "Scenario city layer disabled; stock world cities restored.";
                        })}
                        style={{ ...buttonStyle, marginTop: "0.45rem", width: "100%" }}
                    >
                        Use standard world cities instead
                    </button>
                </details>
                {statusLine}
            </div>
            </>
        );
    }


    return null;
};

export { CheatsPanel };
