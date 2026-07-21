/*! Open Historia — national stats pane © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { JSON_URLS, getNationFlags } from "../../runtime/assets.js";
import { isPolityLandless, readGameData, readWorldState } from "../../runtime/gameState.js";
import { useLibraryState } from "../../runtime/library.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import COUNTRY_NAMES from "../../runtime/generated/countryNames.js";
import { setRegionClickObserver } from "../Selection/Regions.jsx";
import { generateCountryStatSheet } from "../AI/gameplay.js";
import { validateGameplayPayload } from "../AI/gameplaySchemas.js";

// Sheets are regenerated when the game date moves; within a date they persist
// across reloads so flipping between countries stays instant.
const STORAGE_KEY = "oh-stat-sheets";
const MAX_STORED_SHEETS = 60;
const memoryCache = new Map();
const isValidStatSheet = (value) => validateGameplayPayload("countryStatSheet", value).valid;

const readStoredSheets = () => {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
};

const storeSheet = (key, entry) => {
    try {
        const all = readStoredSheets();
        all[key] = entry;
        const keys = Object.keys(all);
        if (keys.length > MAX_STORED_SHEETS) {
            for (const stale of keys.slice(0, keys.length - MAX_STORED_SHEETS)) delete all[stale];
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Quota errors just mean no persistence — the memory cache still works.
    }
};

const clamp01 = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const INDEX_ROWS = [
    { key: "sovereignty", label: "Sovereignty", icon: "⚑", color: "#8b5cf6" },
    { key: "foodAutonomy", label: "Food autonomy", icon: "🌾", color: "#22c55e" },
    { key: "energyAutonomy", label: "Energy autonomy", icon: "⚡", color: "#eab308" },
    { key: "economicIndependence", label: "Economic independence", icon: "🏦", color: "#06b6d4" },
    { key: "internalSecurity", label: "Internal security", icon: "🛡", color: "#f43f5e" },
    { key: "internationalReputation", label: "International reputation", icon: "🤝", color: "#3b82f6" },
];

const sectionTitleStyle = {
    color: "rgba(255,255,255,0.45)",
    fontSize: "0.68rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    margin: "1.1rem 0 0.6rem",
    textTransform: "uppercase",
};

const cardStyle = {
    backgroundColor: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "10px",
    padding: "0.6rem 0.7rem",
};

const Bar = ({ value, color }) => (
    <div style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "999px", height: "6px", overflow: "hidden" }}>
    <div style={{ backgroundColor: color, borderRadius: "999px", height: "100%", width: `${clamp01(value)}%`, transition: "width 0.4s" }} />
    </div>
);

// The AI writes economic figures however it likes — "30000000000",
// "$30,000,000,000", "2.1%", "1.2 trillion caps". Raw long numbers overflow
// the card, so purely numeric values from a million up render compactly
// (30000000000 → 30.0B) with any currency prefix preserved; everything else
// (percentages, prose) passes through untouched.
const compactEconomyValue = (value) => {
    if (value === null || value === undefined) return value;
    const text = String(value).trim();
    const match = /^([^0-9-]{0,4})(-?\d[\d,]*)(?:\.(\d+))?$/.exec(text);
    if (!match) return value;
    const number = Number(`${match[2].replace(/,/g, "")}${match[3] ? `.${match[3]}` : ""}`);
    if (!Number.isFinite(number) || Math.abs(number) < 1e6) return value;
    const prefix = match[1] ?? "";
    const abs = Math.abs(number);
    const [divisor, suffix] = abs >= 1e12 ? [1e12, "T"] : abs >= 1e9 ? [1e9, "B"] : [1e6, "M"];
    const compact = (number / divisor).toFixed(abs / divisor >= 100 ? 0 : 1);
    return `${prefix}${compact}${suffix}`;
};

const EconomyCard = ({ label, value, sub, tone }) => (
    <div style={cardStyle}>
    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "0.3rem", textTransform: "uppercase" }}>
    {label}
    </div>
    <div data-no-translate style={{ color: tone, fontSize: "1.05rem", fontWeight: 800 }}>{compactEconomyValue(value) || "—"}</div>
    {sub && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", marginTop: "0.15rem" }}>{sub}</div>}
    </div>
);

const stabilityColor = (value) => (value < 40 ? "#ef4444" : value < 70 ? "#f59e0b" : "#22c55e");

const StatsPane = ({ active }) => {
    const { activeGameId } = useLibraryState();
    const [player, setPlayer] = useState({ code: "", date: "", gameKey: "game" });
    const [targetCountry, setTargetCountry] = useState("");
    const [polity, setPolity] = useState(null); // world.polityOverrides[target]
    const [state, setState] = useState({ status: "idle", sheet: null, error: "" });
    const [flagFailed, setFlagFailed] = useState(false);
    // Is the PLAYER stateless (holds no territory)? A landless player's code may
    // still resolve to a real country, but they are not it — so their own row
    // must show the neutral initials, never that country's flag.
    const [playerLandless, setPlayerLandless] = useState(false);
    // Author-set flags from the scenario (flags.json). Memoized in assets.js, so
    // this is one fetch per scenario; {} for every scenario that sets none.
    const [customFlags, setCustomFlags] = useState({});
    const displayName = useCountryDisplayName(targetCountry);

    // Which game and which date are we in? Also seeds the target: your country.
    useEffect(() => {
        let cancelled = false;
        getNationFlags()
            .then((flags) => { if (!cancelled) setCustomFlags(flags || {}); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [activeGameId]);

    useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;
        const refreshPlayer = async () => {
            try {
                const game = await readGameData({ force: true });
                if (cancelled) return;
                const code = String(game?.country || "").trim();
                const nextPlayer = {
                    code,
                    date: String(game?.gameDate || game?.startDate || ""),
                    gameKey: String(JSON_URLS.game || game?.id || game?.name || "game"),
                };
                if (player.gameKey !== nextPlayer.gameKey) {
                    setTargetCountry(code);
                    setState({ status: "idle", sheet: null, error: "" });
                } else {
                    setTargetCountry((target) => target || code);
                }
                setPlayer((current) =>
                    current.code === nextPlayer.code &&
                    current.date === nextPlayer.date &&
                    current.gameKey === nextPlayer.gameKey
                        ? current
                        : nextPlayer);
            } catch {
                // Without game data the pane just shows its empty state.
            }
        };
        refreshPlayer();
        const intervalId = window.setInterval(refreshPlayer, 5000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [active, activeGameId, player.gameKey]);

    // While the pane is showing, clicking any country on the map inspects it.
    useEffect(() => {
        if (!active) return undefined;
        setRegionClickObserver((props) => {
            // One namespace: the owning country's NAME. The gid0/GID_0 tail is the
            // region's GADM provenance — a code — so falling through to it used to
            // hand this pane "RUS" for an unowned region while every owned one gave
            // a name. The sheet is keyed by country, and the two never matched.
            const gid0 = String(props?.gid0 || props?.GID_0 || "").trim();
            const country = String(props?.owner || "").trim() || COUNTRY_NAMES[gid0] || gid0;
            if (country) setTargetCountry(country);
        });
        return () => setRegionClickObserver(null);
    }, [active]);

    const loadSheet = useCallback(async ({ force = false } = {}) => {
        const code = targetCountry;
        if (!code) return;
        const cacheKey = `${player.gameKey}:${code}`;
        if (!force) {
            const cached = memoryCache.get(cacheKey) ?? readStoredSheets()[cacheKey];
            if (cached && cached.date === player.date && isValidStatSheet(cached.sheet)) {
                memoryCache.set(cacheKey, cached);
                setState({ status: "ready", sheet: cached.sheet, error: "" });
                return;
            }
        }
        setState({ status: "loading", sheet: null, error: "" });
        try {
            const sheet = await generateCountryStatSheet({ code, name: displayName || code });
            const validation = validateGameplayPayload("countryStatSheet", sheet);
            if (!validation.valid) throw new Error(`The stat sheet failed validation: ${validation.error}`);
            const entry = { date: player.date, sheet };
            memoryCache.set(cacheKey, entry);
            storeSheet(cacheKey, entry);
            setState((current) =>
                targetCountry === code ? { status: "ready", sheet, error: "" } : current);
        } catch (error) {
            setState((current) =>
                targetCountry === code
                    ? { status: "error", sheet: null, error: error?.message || "The stat sheet failed." }
                    : current);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetCountry, player.gameKey, player.date, displayName]);

    useEffect(() => {
        if (!active || !targetCountry) return;
        setFlagFailed(false);
        loadSheet();
        readWorldState({ force: false })
            .then((world) => {
                setPolity(world?.polityOverrides?.[targetCountry] ?? null);
                setPlayerLandless(isPolityLandless(world, player.code));
            })
            .catch(() => { setPolity(null); setPlayerLandless(false); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, targetCountry, player.date]);

    const sheet = state.sheet;
    const isPlayer = targetCountry && targetCountry.toUpperCase() === String(player.code).toUpperCase();
    // An author-set flag (scenario flags.json) wins over the code-derived one, so a
    // custom era polity shows the flag its map-maker drew instead of initials.
    // But a landless PLAYER never borrows the code-derived country flag (a
    // stateless actor is not the country its code resolves to) — their own row
    // falls through to the neutral initials unless they set a flag of their own.
    const suppressDerivedFlag = isPlayer && playerLandless;
    const flagUrl = customFlags[targetCountry] || polity?.flag || (suppressDerivedFlag ? "" : flagImageUrlFromGid(targetCountry));
    const initials = String(targetCountry).replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??";

    const breakdown = useMemo(() => {
        const raw = sheet?.gdpBreakdown ?? {};
        const parts = [
            { key: "agriculture", label: "Agriculture", color: "#22c55e", value: clamp01(raw.agriculture) },
            { key: "industry", label: "Industry", color: "#3b82f6", value: clamp01(raw.industry) },
            { key: "services", label: "Services", color: "#8b5cf6", value: clamp01(raw.services) },
        ];
        const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
        return parts.map((part) => ({ ...part, share: (part.value / total) * 100 }));
    }, [sheet]);

    const budgetNegative = String(sheet?.economy?.budgetBalance ?? "").trim().startsWith("-");

    return (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "0.9rem 1rem 1.25rem", scrollbarWidth: "none" }}>

        {!targetCountry && (
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.85rem" }}>
            No active game. Start one to see national statistics.
            </p>
        )}

        {targetCountry && (
            <>
            {/* Country header */}
            <div style={{ alignItems: "flex-start", display: "flex", gap: "0.7rem" }}>
            <div style={{ alignItems: "center", backgroundColor: "rgba(59,130,246,0.16)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "#93c5fd", display: "flex", flexShrink: 0, fontSize: "0.95rem", fontWeight: 800, height: "2.6rem", justifyContent: "center", overflow: "hidden", width: "2.6rem" }}>
            {flagUrl && !flagFailed ? (
                <img
                alt=""
                src={flagUrl}
                onError={() => setFlagFailed(true)}
                style={{ height: "100%", objectFit: "cover", width: "100%" }}
                />
            ) : initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.05rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName || targetCountry}
            </span>
            {isPlayer && (
                <span style={{ backgroundColor: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.5)", borderRadius: "999px", color: "#fbbf24", flexShrink: 0, fontSize: "0.62rem", fontWeight: 700, padding: "0.14rem 0.5rem" }}>
                Your country
                </span>
            )}
            </div>
            {sheet && (
                <>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.76rem", marginTop: "0.15rem" }}>
                {[sheet.capital, sheet.continent].filter(Boolean).join(" · ")}
                </div>
                {sheet.government && (
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.1rem" }}>
                    {sheet.government}
                    </div>
                )}
                {sheet.leader && (
                    <div style={{ color: "#fbbf24", fontSize: "0.72rem", marginTop: "0.1rem" }}>
                    Leader: {sheet.leader}
                    </div>
                )}
                </>
            )}
            </div>
            {state.status !== "loading" && (
                <button
                onClick={() => loadSheet({ force: true })}
                title="Regenerate this stat sheet"
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "1rem", padding: 0 }}
                >↻</button>
            )}
            </div>

            {state.status === "loading" && (
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginTop: "1rem" }}>
                Compiling the stat sheet…
                </p>
            )}

            {state.status === "error" && (
                <div style={{ backgroundColor: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", fontSize: "0.8rem", marginTop: "1rem", padding: "0.7rem 0.8rem" }}>
                {state.error}
                <button
                onClick={() => loadSheet({ force: true })}
                style={{ background: "none", border: "none", color: "#93c5fd", cursor: "pointer", display: "block", fontSize: "0.8rem", fontWeight: 700, marginTop: "0.4rem", padding: 0 }}
                >Try again</button>
                </div>
            )}

            {sheet && state.status === "ready" && (
                <>
                {/* National stability */}
                <div style={{ ...cardStyle, marginTop: "1rem" }}>
                <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "0.45rem" }}>
                <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                ⚠ National stability
                </span>
                <span data-no-translate style={{ fontSize: "0.85rem", fontWeight: 800 }}>
                {clamp01(sheet.stability)}/100
                </span>
                </div>
                <Bar value={sheet.stability} color={stabilityColor(clamp01(sheet.stability))} />
                </div>

                {/* Strategic indices */}
                <div style={sectionTitleStyle}>⚑ Strategic indices</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {INDEX_ROWS.map((row) => {
                    const value = clamp01(sheet.indices?.[row.key]);
                    return (
                        <div key={row.key} style={cardStyle}>
                        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                        <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.76rem" }}>
                        {row.icon} {row.label}
                        </span>
                        <span data-no-translate style={{ fontSize: "0.78rem", fontWeight: 800 }}>{value}%</span>
                        </div>
                        <Bar value={value} color={row.color} />
                        </div>
                    );
                })}
                </div>

                {/* Economy */}
                <div style={sectionTitleStyle}>📈 Economy</div>
                <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "1fr 1fr" }}>
                <EconomyCard label="GDP" value={sheet.economy?.gdp} sub={sheet.economy?.gdpGrowth} tone="#34d399" />
                <EconomyCard label="GDP/capita" value={sheet.economy?.gdpPerCapita} sub={sheet.economy?.currency} tone="#e5e7eb" />
                <EconomyCard label="Inflation" value={sheet.economy?.inflation} tone="#34d399" />
                <EconomyCard label="Unemployment" value={sheet.economy?.unemployment} tone="#34d399" />
                <EconomyCard label="Public debt" value={sheet.economy?.publicDebt} tone="#34d399" />
                <EconomyCard
                label="Budget balance"
                value={sheet.economy?.budgetBalance}
                sub={budgetNegative ? "Deficit" : "Surplus"}
                tone={budgetNegative ? "#f87171" : "#34d399"}
                />
                </div>

                {/* GDP breakdown */}
                <div style={{ ...cardStyle, marginTop: "0.9rem" }}>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.74rem", marginBottom: "0.5rem" }}>
                GDP breakdown
                </div>
                <div style={{ borderRadius: "999px", display: "flex", height: "10px", overflow: "hidden" }}>
                {breakdown.map((part) => (
                    <div key={part.key} style={{ backgroundColor: part.color, width: `${part.share}%` }} />
                ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem 0.8rem", marginTop: "0.5rem" }}>
                {breakdown.map((part) => (
                    <span key={part.key} style={{ alignItems: "center", color: "rgba(255,255,255,0.6)", display: "flex", fontSize: "0.68rem", gap: "0.3rem" }}>
                    <span style={{ backgroundColor: part.color, borderRadius: "2px", height: "7px", width: "7px" }} />
                    {part.label} <span data-no-translate>{part.value}%</span>
                    </span>
                ))}
                </div>
                </div>
                </>
            )}

            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem", marginTop: "1rem" }}>
            Click any country on the map to inspect it.
            </p>
            </>
        )}
        </div>
        </div>
    );
};

export default StatsPane;
