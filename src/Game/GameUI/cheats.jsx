/*! Open Historia — cheats panel © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    JSON_URLS,
    loadCountryNames,
    loadRegionCatalog,
    readJson,
    writeJson,
} from "../../runtime/assets.js";
import {
    readEventsState,
    readGameData,
    readWorldState,
    writeEventsState,
    writeGameData,
    writeWorldState,
} from "../../runtime/gameState.js";
import { DIFFICULTY_LEVELS, normalizeDifficulty } from "../../runtime/difficulty.js";
import { applyGameMasterCommand } from "../AI/gameplay.js";
import { setRegionClickInterceptor } from "../Selection/Regions.jsx";

const PANEL_TOP = "4.75rem";
const EMPTY_FEATURES = { type: "FeatureCollection", features: [] };

const TOOLS = [
    { id: "master-ai", title: "Master AI", subtitle: "Full control over the game with AI assistance" },
    { id: "roll-back-turn", title: "Roll Back Turn", subtitle: "Restore the game to the start of an earlier turn" },
    { id: "your-country", title: "Your Country", subtitle: "Change which country you're playing as" },
    { id: "difficulty", title: "Difficulty", subtitle: "Adjust the game difficulty level" },
    { id: "annex-country", title: "Annex Country", subtitle: "Click a country to annex it into another" },
    { id: "annex-regions", title: "Annex Regions", subtitle: "Click individual regions to transfer them to a country" },
    { id: "edit-country", title: "Edit Country", subtitle: "Modify existing country properties" },
    { id: "add-country", title: "Add Country", subtitle: "Create a new country on the map" },
    { id: "regions", title: "Regions", subtitle: "Edit region names, tags, and properties" },
    { id: "edit-feature", title: "Edit Map Feature", subtitle: "Edit existing map features like cities and landmarks" },
    { id: "add-feature", title: "Add Map Feature", subtitle: "Create new map features with custom properties" },
    { id: "clear-features", title: "Clear Map Features", subtitle: "Clean up old and irrelevant features" },
    { id: "events", title: "Events", subtitle: "Edit historical events and their descriptions" },
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
    background: "rgba(124,58,237,0.35)",
    border: "1px solid rgba(139,92,246,0.55)",
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
    const world = await readWorldState({ force: true });
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

    // Owners of the actually-rendered geometry, with current overrides applied: the
    // scenario's own custom regions when present, otherwise the stock GADM catalog.
    const custom = await readJson(JSON_URLS.regionsGeojson, { defaultValue: null }).catch(() => null);
    if (Array.isArray(custom?.features) && custom.features.length) {
        for (const feature of custom.features) {
            const props = feature?.properties ?? {};
            const id = props.id != null ? String(props.id) : "";
            const owner = overrides[id] ?? props.owner ?? props.gid0;
            if (owner) owners.add(String(owner));
        }
    } else {
        for (const region of await loadRegionCatalog().catch(() => [])) {
            const owner = overrides[region.id] ?? region.countryCode;
            if (owner) owners.add(String(owner));
        }
    }

    const polities = Array.from(owners)
        .filter((code) => code && code.toLowerCase() !== "unclaimed")
        .map((code) => ({ code, name: nameByCode.get(code) || code }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { polities, world };
};

const PolitySelect = ({ polities, value, onChange, placeholder = "Pick a country…" }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
    <option value="">{placeholder}</option>
    {polities.map((polity) => (
        <option key={polity.code} value={polity.code} style={{ color: "black" }}>
        {polity.name}
        </option>
    ))}
    </select>
);

const CheatsPanel = ({ open, onClose }) => {
    const [tool, setTool] = useState(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [polities, setPolities] = useState([]);
    const [game, setGame] = useState(null);
    // Click-capture mode: while set, the panel hides behind a floating toast
    // and map clicks route here instead of opening the region popup.
    const [clickMode, setClickMode] = useState(null);
    const clickHandlerRef = useRef(null);

    const refresh = async () => {
        try {
            const [{ polities: nextPolities }, nextGame] = await Promise.all([
                loadPolities(),
                readGameData({ force: true }),
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
            <button type="button" onClick={() => { setTool(null); setStatus(""); }} style={{ ...buttonStyle, padding: "0.25rem 0.5rem" }}>
            ←
            </button>
        )}
        <div style={{ fontSize: "1rem", fontWeight: 800 }}>{title}</div>
        </div>
        <button type="button" onClick={onClose} style={{ ...buttonStyle, padding: "0.25rem 0.55rem" }}>✕</button>
        </div>
        {subtitle && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.74rem", marginTop: "0.2rem" }}>{subtitle}</div>}
        </div>
    );

    return (
        <>
        {clickMode && (
            <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", background: "rgba(17,24,39,0.97)", border: "1px solid rgba(139,92,246,0.5)", borderRadius: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.5)", color: "#fff", fontFamily: "sans-serif", fontSize: "0.85rem", left: "50%", padding: "0.6rem 0.9rem", position: "fixed", top: PANEL_TOP, transform: "translateX(-50%)", zIndex: 10070 }}>
            <span>{clickMode.label}</span>
            <button type="button" onClick={endClickMode} style={{ ...primaryButtonStyle, padding: "0.3rem 0.6rem" }}>Done</button>
            </div>
        )}

        <div
        style={{
            background: "rgba(17, 24, 39, 0.96)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 16,
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
            color: "white",
            display: clickMode ? "none" : "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            maxHeight: `calc(100vh - ${PANEL_TOP} - 1rem)`,
            overflow: "hidden",
            padding: "0.9rem",
            position: "fixed",
            right: "0.5rem",
            top: PANEL_TOP,
            width: "min(24rem, calc(100vw - 1rem))",
            zIndex: 10045,
        }}
        >
        {!tool ? (
            <>
            {header("Cheats")}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", overflowY: "auto" }}>
            {TOOLS.map((entry) => (
                <button
                key={entry.id}
                type="button"
                onClick={() => { setTool(entry.id); setStatus(""); }}
                style={{ ...buttonStyle, alignItems: "flex-start", flexDirection: "column", gap: "0.1rem", textAlign: "left" }}
                >
                <span style={{ fontWeight: 700 }}>{entry.title}</span>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", fontWeight: 500 }}>{entry.subtitle}</span>
                </button>
            ))}
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
            />
        )}
        {status && !tool && (
            <div style={{ color: "rgba(191,219,254,0.9)", fontSize: "0.76rem", marginTop: "0.6rem" }}>{status}</div>
        )}
        </div>
        </>
    );
};

const ToolView = ({ tool, header, busy, status, game, polities, refresh, runBusy, beginClickMode, endClickMode, setStatus }) => {
    const meta = TOOLS.find((entry) => entry.id === tool);
    const [text, setText] = useState("");
    const [target, setTarget] = useState("");
    const [fields, setFields] = useState({});
    const [items, setItems] = useState(null);
    const [search, setSearch] = useState("");
    const [editingId, setEditingId] = useState(null);

    // Tools that browse existing data load it on entry.
    useEffect(() => {
        setItems(null);
        setEditingId(null);
        setSearch("");
        setFields({});
        setTarget("");
        if (tool === "events") {
            readEventsState({ force: true }).then(setItems).catch(() => setItems([]));
        }
        if (tool === "roll-back-turn") {
            readJson(JSON_URLS.snapshots, { defaultValue: [], force: true })
                .then((list) => setItems(Array.isArray(list) ? list : []))
                .catch(() => setItems([]));
        }
        if (tool === "edit-feature" || tool === "clear-features") {
            readJson(JSON_URLS.citiesGeojson, { defaultValue: EMPTY_FEATURES, force: true })
                .then((geojson) => setItems(geojson?.features ?? []))
                .catch(() => setItems([]));
        }
    }, [tool]);

    const statusLine = status && (
        <div style={{ color: status.startsWith("Failed") ? "#fca5a5" : "rgba(191,219,254,0.9)", fontSize: "0.76rem", marginTop: "0.6rem" }}>
        {status}
        </div>
    );

    const politiesByCode = useMemo(() => new Map(polities.map((polity) => [polity.code, polity])), [polities]);
    const nameOf = (code) => politiesByCode.get(code)?.name || code || "unclaimed land";

    // ----- individual tools -----

    if (tool === "master-ai") {
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ overflowY: "auto" }}>
            <label style={labelStyle}>Command</label>
            <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder='Anything — "give Poland all of Germany", "start a golden age in Egypt", "sink the British fleet"…'
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
            />
            <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => runBusy(async () => {
                const result = await applyGameMasterCommand(text.trim());
                setText("");
                const summary = result?.world?.lastJumpSummary || result?.summary || "";
                return summary ? `Done — ${summary}` : "The Game Master applied your command.";
            })}
            style={{ ...primaryButtonStyle, marginTop: "0.6rem", opacity: busy ? 0.6 : 1, width: "100%" }}
            >
            {busy ? "Rewriting the world…" : "Execute"}
            </button>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.5rem" }}>
            The AI interprets the command, applies its impacts to the map and countries, and records it as a game-master event.
            </div>
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
                            setItems(remaining);
                            setEditingId(null);
                            await refresh();
                            return `Rolled back to Round ${snap.round}. The map, date and panels catch up within a few seconds.`;
                        })}
                        >
                        Confirm
                        </button>
                        <button type="button" style={{ ...buttonStyle, padding: "0.25rem 0.55rem" }} onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                    ) : (
                        <button type="button" disabled={busy} style={{ ...buttonStyle, flexShrink: 0, padding: "0.25rem 0.55rem" }} onClick={() => setEditingId(snap.id)}>Roll back</button>
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
            disabled={busy || !target}
            onClick={() => runBusy(async () => {
                const current = await readGameData({ force: true });
                await writeGameData({ ...current, country: target });
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
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "1fr 1fr", overflowY: "auto" }}>
            {DIFFICULTY_LEVELS.map((level) => (
                <button
                key={level.id}
                type="button"
                disabled={busy}
                onClick={() => runBusy(async () => {
                    const nextGame = await readGameData({ force: true });
                    await writeGameData({ ...nextGame, difficulty: level.id });
                    await refresh();
                    return `Difficulty set to ${level.label} ${level.emoji} — it steers the AI from the next turn on.`;
                })}
                style={{
                    ...buttonStyle,
                    background: current === level.id ? "rgba(124,58,237,0.35)" : buttonStyle.background,
                    border: current === level.id ? "1px solid rgba(139,92,246,0.65)" : buttonStyle.border,
                    flexDirection: "column",
                    gap: "0.15rem",
                    padding: "0.65rem 0.4rem",
                }}
                >
                <span style={{ fontSize: "1.45rem", lineHeight: 1 }}>{level.emoji}</span>
                <span>{level.label}</span>
                </button>
            ))}
            </div>
            {statusLine}
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
                                const source = props.owner || props.GID_0 || props.gid0;
                                if (!source || source === owner) return;
                                const catalog = await loadRegionCatalog();
                                let count = 0;
                                for (const region of catalog) {
                                    const effective = overrides[region.id] ?? region.countryCode;
                                    if (effective === source) {
                                        overrides[region.id] = owner;
                                        count += 1;
                                    }
                                }
                                for (const [regionId, code] of Object.entries(world.regionOwnershipOverrides)) {
                                    if (code === source) overrides[regionId] = owner;
                                }
                                await writeWorldState({ ...world, regionOwnershipOverrides: overrides });
                                setStatus(`${nameOf(source)} annexed into ${nameOf(owner)} (${count} regions). The map updates within a few seconds.`);
                            } else {
                                if (!props.GID_1) return;
                                overrides[String(props.GID_1)] = owner;
                                await writeWorldState({ ...world, regionOwnershipOverrides: overrides });
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

    if (tool === "edit-country" || tool === "add-country") {
        const adding = tool === "add-country";
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
            <input style={{ ...inputStyle, width: "8rem" }} value={fields.color ?? ""} onChange={(event) => setFields({ ...fields, color: event.target.value })} placeholder="#7c3aed" />
            <input
            type="color"
            value={hexToRgb(fields.color) ? (fields.color.startsWith("#") ? fields.color : `#${fields.color}`) : "#7c3aed"}
            onChange={(event) => setFields({ ...fields, color: event.target.value })}
            style={{ background: "none", border: "none", cursor: "pointer", height: "2.1rem", padding: 0, width: "2.6rem" }}
            />
            </div>
            <button type="button" disabled={busy} onClick={applyCountry} style={{ ...primaryButtonStyle, marginTop: "0.7rem", width: "100%" }}>
            {adding ? "Create country" : "Save changes"}
            </button>
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "regions") {
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ overflowY: "auto" }}>
            <button
            type="button"
            onClick={() => beginClickMode("Click a region to inspect it", async (props) => {
                setFields({
                    id: String(props.GID_1 ?? ""),
                    name: props.NAME_1 || "",
                    owner: props.owner || props.GID_0 || "",
                });
                setStatus("");
                // One region at a time: back to the panel to edit it.
                endClickMode();
            })}
            style={{ ...primaryButtonStyle, width: "100%" }}
            >
            Pick a region on the map
            </button>
            {fields.id && (
                <>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.76rem", marginTop: "0.6rem" }}>
                Region <code>{fields.id}</code> — owned by <strong>{nameOf(fields.owner)}</strong>
                </div>
                <label style={labelStyle}>Name</label>
                <input style={inputStyle} value={fields.name ?? ""} onChange={(event) => setFields({ ...fields, name: event.target.value })} />
                <label style={labelStyle}>Owner</label>
                <PolitySelect polities={polities} value={fields.owner ?? ""} onChange={(code) => setFields({ ...fields, owner: code })} placeholder="Unclaimed" />
                <button
                type="button"
                disabled={busy}
                onClick={() => runBusy(async () => {
                    const world = await readWorldState({ force: true });
                    const notes = [];
                    if (fields.owner) {
                        await writeWorldState({
                            ...world,
                            regionOwnershipOverrides: { ...world.regionOwnershipOverrides, [fields.id]: fields.owner },
                        });
                        notes.push(`owner → ${nameOf(fields.owner)}`);
                    }
                    // Names can only be renamed on maps with their own geometry
                    // (map-editor scenarios); the stock world's names live in
                    // the map tiles.
                    const geojson = await readJson(JSON_URLS.regionsGeojson, { defaultValue: null, force: true });
                    const feature = geojson?.features?.find((entry) => String(entry?.properties?.id ?? "") === fields.id);
                    if (feature && fields.name && fields.name !== feature.properties.name) {
                        feature.properties.name = fields.name;
                        await writeJson(JSON_URLS.regionsGeojson, geojson, { pretty: true });
                        notes.push(`name → ${fields.name}`);
                    } else if (!feature && fields.name && fields.name !== "") {
                        notes.push("name unchanged — stock-map region names come from the map tiles and can't be renamed");
                    }
                    return notes.length ? `Saved: ${notes.join("; ")}.` : "Nothing to change.";
                })}
                style={{ ...primaryButtonStyle, marginTop: "0.7rem", width: "100%" }}
                >
                Save region
                </button>
                </>
            )}
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "edit-feature") {
        const features = items ?? [];
        const q = search.trim().toLowerCase();
        const shown = features
            .map((feature, index) => ({ feature, index }))
            .filter(({ feature }) => !q || String(feature?.properties?.city ?? feature?.properties?.name ?? "").toLowerCase().includes(q))
            .slice(0, 60);
        const saveFeatures = async (nextFeatures, message) => {
            await writeJson(JSON_URLS.citiesGeojson, { type: "FeatureCollection", features: nextFeatures }, { pretty: true });
            setItems(nextFeatures);
            return message;
        };

        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <input style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search features…" />
            {features.length === 0 && (
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem", marginTop: "0.6rem" }}>
                This map has no custom features yet — use Add Map Feature.
                </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.5rem", overflowY: "auto" }}>
            {shown.map(({ feature, index }) => {
                const props = feature?.properties ?? {};
                const isEditing = editingId === index;
                return (
                    <div key={index} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                    <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{props.city || props.name || `Feature ${index + 1}`}</span>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                    <button type="button" style={{ ...buttonStyle, padding: "0.2rem 0.5rem" }} onClick={() => { setEditingId(isEditing ? null : index); setFields(isEditing ? {} : { name: props.city || props.name || "", tier: String(props.tier ?? 2), population: String(props.population ?? "") }); }}>
                    {isEditing ? "Close" : "Edit"}
                    </button>
                    <button
                    type="button"
                    style={{ ...buttonStyle, padding: "0.2rem 0.5rem" }}
                    disabled={busy}
                    onClick={() => runBusy(async () => saveFeatures(features.filter((_, i) => i !== index), `${props.city || props.name || "Feature"} deleted.`))}
                    >
                    🗑
                    </button>
                    </div>
                    </div>
                    {isEditing && (
                        <div style={{ marginTop: "0.4rem" }}>
                        <label style={labelStyle}>Name</label>
                        <input style={inputStyle} value={fields.name ?? ""} onChange={(event) => setFields({ ...fields, name: event.target.value })} />
                        <label style={labelStyle}>Tier (1 town … 4 capital)</label>
                        <input style={inputStyle} type="number" min={1} max={4} value={fields.tier ?? "2"} onChange={(event) => setFields({ ...fields, tier: event.target.value })} />
                        <label style={labelStyle}>Population (optional)</label>
                        <input style={inputStyle} value={fields.population ?? ""} onChange={(event) => setFields({ ...fields, population: event.target.value })} />
                        <button
                        type="button"
                        disabled={busy}
                        style={{ ...primaryButtonStyle, marginTop: "0.5rem", width: "100%" }}
                        onClick={() => runBusy(async () => {
                            const nextFeatures = features.map((entry, i) => {
                                if (i !== index) return entry;
                                const population = Number(fields.population);
                                return {
                                    ...entry,
                                    properties: {
                                        ...entry.properties,
                                        city: fields.name || entry.properties?.city,
                                        name: fields.name || entry.properties?.name,
                                        tier: Math.max(1, Math.min(4, Number(fields.tier) || 2)),
                                        ...(Number.isFinite(population) && population > 0 ? { population } : null),
                                        capital: Math.max(1, Math.min(4, Number(fields.tier) || 2)) === 4,
                                    },
                                };
                            });
                            setEditingId(null);
                            return saveFeatures(nextFeatures, `${fields.name || "Feature"} saved.`);
                        })}
                        >
                        Save feature
                        </button>
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
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ overflowY: "auto" }}>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={fields.name ?? ""} onChange={(event) => setFields({ ...fields, name: event.target.value })} placeholder="Alexandria" />
            <label style={labelStyle}>Tier (1 town … 4 capital)</label>
            <input style={inputStyle} type="number" min={1} max={4} value={fields.tier ?? "2"} onChange={(event) => setFields({ ...fields, tier: event.target.value })} />
            <label style={labelStyle}>Population (optional)</label>
            <input style={inputStyle} value={fields.population ?? ""} onChange={(event) => setFields({ ...fields, population: event.target.value })} />
            <button
            type="button"
            disabled={!String(fields.name ?? "").trim()}
            onClick={() => {
                const name = fields.name.trim();
                const tier = Math.max(1, Math.min(4, Number(fields.tier) || 2));
                const population = Number(fields.population);
                beginClickMode(`Click the map where “${name}” goes`, async (props) => {
                    try {
                        if (!props.lngLat) return;
                        const geojson = await readJson(JSON_URLS.citiesGeojson, { defaultValue: EMPTY_FEATURES, force: true });
                        const features = [...(geojson?.features ?? []), {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [props.lngLat.lng, props.lngLat.lat] },
                            properties: {
                                city: name,
                                name,
                                tier,
                                capital: tier === 4,
                                ...(Number.isFinite(population) && population > 0 ? { population } : null),
                            },
                        }];
                        await writeJson(JSON_URLS.citiesGeojson, { type: "FeatureCollection", features }, { pretty: true });
                        const world = await readWorldState({ force: true });
                        if (!world.customCities) {
                            // The custom layer replaces the stock one, so flag it on —
                            // otherwise the new feature would never render.
                            await writeWorldState({ ...world, customCities: true });
                        }
                        setStatus(`${name} placed. The map picks it up within a few seconds.`);
                    } catch (error) {
                        setStatus(`Failed: ${error.message}`);
                    }
                });
            }}
            style={{ ...primaryButtonStyle, marginTop: "0.7rem", width: "100%" }}
            >
            Place on map
            </button>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.5rem" }}>
            On maps that still use the standard world cities, adding the first custom feature switches the map to custom features only.
            </div>
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "clear-features") {
        const count = (items ?? []).length;
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.78rem" }}>
            This map currently has <strong>{count}</strong> custom feature{count === 1 ? "" : "s"}.
            </div>
            <button
            type="button"
            disabled={busy || count === 0}
            onClick={() => runBusy(async () => {
                await writeJson(JSON_URLS.citiesGeojson, EMPTY_FEATURES, { pretty: true });
                setItems([]);
                return "All custom features removed.";
            })}
            style={{ ...primaryButtonStyle, marginTop: "0.7rem", width: "100%" }}
            >
            Delete all custom features
            </button>
            <button
            type="button"
            disabled={busy}
            onClick={() => runBusy(async () => {
                const world = await readWorldState({ force: true });
                await writeWorldState({ ...world, customCities: false });
                return "Map switched back to the standard world cities.";
            })}
            style={{ ...buttonStyle, marginTop: "0.5rem", width: "100%" }}
            >
            Use the standard world cities instead
            </button>
            {statusLine}
            </div>
            </>
        );
    }

    if (tool === "events") {
        const events = items ?? [];
        const q = search.trim().toLowerCase();
        const shown = events.filter((event) => !q || `${event.title} ${event.description}`.toLowerCase().includes(q)).slice(0, 50);
        return (
            <>
            {header(meta.title, meta.subtitle)}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <input style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events…" />
            {events.length === 0 && (
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem", marginTop: "0.6rem" }}>No events yet.</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.5rem", overflowY: "auto" }}>
            {shown.map((event) => {
                const isEditing = editingId === event.id;
                return (
                    <div key={event.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.title || "(untitled)"}</div>
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem" }}>{event.date}</div>
                    </div>
                    <div style={{ display: "flex", flexShrink: 0, gap: "0.3rem" }}>
                    <button type="button" style={{ ...buttonStyle, padding: "0.2rem 0.5rem" }} onClick={() => { setEditingId(isEditing ? null : event.id); setFields(isEditing ? {} : { title: event.title, description: event.description, date: event.date }); }}>
                    {isEditing ? "Close" : "Edit"}
                    </button>
                    <button
                    type="button"
                    style={{ ...buttonStyle, padding: "0.2rem 0.5rem" }}
                    disabled={busy}
                    onClick={() => runBusy(async () => {
                        const next = events.filter((entry) => entry.id !== event.id);
                        await writeEventsState(next);
                        setItems(next);
                        return "Event deleted.";
                    })}
                    >
                    🗑
                    </button>
                    </div>
                    </div>
                    {isEditing && (
                        <div style={{ marginTop: "0.4rem" }}>
                        <label style={labelStyle}>Title</label>
                        <input style={inputStyle} value={fields.title ?? ""} onChange={(e) => setFields({ ...fields, title: e.target.value })} />
                        <label style={labelStyle}>Date</label>
                        <input style={inputStyle} value={fields.date ?? ""} onChange={(e) => setFields({ ...fields, date: e.target.value })} />
                        <label style={labelStyle}>Description</label>
                        <textarea rows={4} style={{ ...inputStyle, resize: "vertical" }} value={fields.description ?? ""} onChange={(e) => setFields({ ...fields, description: e.target.value })} />
                        <button
                        type="button"
                        disabled={busy}
                        style={{ ...primaryButtonStyle, marginTop: "0.5rem", width: "100%" }}
                        onClick={() => runBusy(async () => {
                            const next = events.map((entry) => entry.id === event.id
                                ? { ...entry, title: fields.title ?? entry.title, date: fields.date ?? entry.date, description: fields.description ?? entry.description }
                                : entry);
                            await writeEventsState(next);
                            setItems(next);
                            setEditingId(null);
                            return "Event saved.";
                        })}
                        >
                        Save event
                        </button>
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

    return null;
};

export { CheatsPanel };
