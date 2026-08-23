/*! Open Historia — national stats pane © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { JSON_URLS, getNationFlags } from "../../runtime/assets.js";
import { isPolityLandless, readGameData, readWorldState } from "../../runtime/gameState.js";
import { useLibraryState } from "../../runtime/library.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import COUNTRY_NAMES from "../../runtime/generated/countryNames.js";
import { setRegionClickObserver } from "../Selection/Regions.jsx";
import { generateCountryStatSheet } from "../AI/gameplay.js";
import { validateGameplayPayload } from "../AI/gameplaySchemas.js";
import {
    finalizeCountryStatSheet,
    isCompleteCountryStatSheet,
    mergeCountryStatPatch,
} from "../../runtime/countryStats.js";

// Sheets are regenerated when the game date moves; within a date they persist
// across reloads so flipping between countries stays instant.
const STORAGE_KEY = "oh-stat-sheets";
const MAX_STORED_SHEETS = 60;
const memoryCache = new Map();
const isValidStatSheet = (value) => {
    const sheet = finalizeCountryStatSheet(value);
    return isCompleteCountryStatSheet(sheet) && validateGameplayPayload("countryStatSheet", sheet).valid;
};

// One native mutation path: the same merge semantics are used by normal world
// simulation, future GM/editor writes, and this cache-overlay fallback. Derived
// population/GDP fields are always recomputed from territorial components.
const mergeStatSheet = (base, override) => mergeCountryStatPatch(base, override);

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

const formatCompactNumber = (value, { digits = 1 } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    const abs = Math.abs(number);
    if (abs >= 1e12) return `${(number / 1e12).toFixed(abs >= 100e12 ? 0 : digits)}T`;
    if (abs >= 1e9) return `${(number / 1e9).toFixed(abs >= 100e9 ? 0 : digits)}B`;
    if (abs >= 1e6) return `${(number / 1e6).toFixed(abs >= 100e6 ? 0 : digits)}M`;
    if (abs >= 1e3) return `${(number / 1e3).toFixed(abs >= 100e3 ? 0 : digits)}K`;
    return Number.isInteger(number) ? number.toLocaleString() : number.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatPopulation = (value) => formatCompactNumber(value);
const formatEuroTotal = (value) => {
    const text = formatCompactNumber(value);
    return text === "—" ? text : `€${text}`;
};
const formatEuroPerCapita = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? `€${Math.round(number).toLocaleString()}` : "—";
};
const formatPercent = (value, { signed = false } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    const rounded = Math.round(number * 10) / 10;
    const prefix = signed && rounded > 0 ? "+" : "";
    return `${prefix}${rounded}%`;
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

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lowerText = (value) => cleanText(value).toLocaleLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);

const canonicalPolityKey = (value, world) => {
    const raw = cleanText(value);
    if (!raw) return "";
    try {
        const resolved = resolvePolityIdentity(raw, world, {
            allowUnknown: true,
            requireActive: false,
            allowCoreMatch: true,
            allowStockBase: true,
        });
        if (cleanText(resolved?.resolved)) return cleanText(resolved.resolved);
    } catch {
        // Diplomacy UI must remain readable even if an old save contains a stale name.
    }
    return raw;
};

const polityDisplayName = (world, value) => {
    const key = canonicalPolityKey(value, world);
    if (!key) return "Unknown polity";
    const direct = world?.polityOverrides?.[key];
    if (cleanText(direct?.name)) return cleanText(direct.name);
    for (const [candidateKey, candidate] of Object.entries(world?.polityOverrides || {})) {
        if (lowerText(candidateKey) === lowerText(key)) return cleanText(candidate?.name) || cleanText(candidateKey);
    }
    return key;
};

// Match the canonical 7B rule: score is authoritative and the semantic
// relation band is derived deterministically from it. Old saves may still
// contain a stale status string; the UI deliberately does not trust it.
const relationStatusForScore = (score = 0) => {
    const numeric = Math.max(-100, Math.min(100, Math.round(Number(score) || 0)));
    if (numeric >= 55) return "friendly";
    if (numeric >= 20) return "cordial";
    if (numeric >= -10) return "neutral";
    if (numeric >= -30) return "cautious";
    if (numeric >= -60) return "strained";
    if (numeric > -90) return "hostile";
    return "rival";
};

const relationTone = (score = 0) => {
    const key = relationStatusForScore(score);
    if (["hostile", "rival"].includes(key)) return "#f87171";
    if (key === "strained") return "#fb923c";
    if (key === "cautious") return "#fbbf24";
    if (key === "friendly") return "#34d399";
    if (key === "cordial") return "#60a5fa";
    return "#cbd5e1";
};

const formatRelationScore = (value) => {
    const number = Math.max(-100, Math.min(100, Math.round(Number(value) || 0)));
    return `${number > 0 ? "+" : ""}${number}`;
};

const prettyToken = (value) => cleanText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const statusBadgeStyle = (tone) => ({
    backgroundColor: `${tone}1f`,
    border: `1px solid ${tone}66`,
    borderRadius: "999px",
    color: tone,
    display: "inline-flex",
    fontSize: "0.58rem",
    fontWeight: 800,
    letterSpacing: "0.04em",
    lineHeight: 1,
    padding: "0.18rem 0.38rem",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
});

const agreementStatusTone = (status) => {
    const key = lowerText(status);
    if (key === "active") return "#34d399";
    if (key === "suspended") return "#fbbf24";
    return "#94a3b8";
};

const warStatusTone = (status) => (lowerText(status) === "active" ? "#f87171" : "#fbbf24");

const RelationMeter = ({ score, tone }) => {
    const value = Math.max(-100, Math.min(100, Number(score) || 0));
    const width = `${Math.abs(value) / 2}%`;
    return (
        <div style={{ backgroundColor: "rgba(255,255,255,0.08)", borderRadius: "999px", height: "5px", marginTop: "0.38rem", overflow: "hidden", position: "relative" }}>
        <div style={{ backgroundColor: "rgba(255,255,255,0.22)", height: "100%", left: "50%", position: "absolute", top: 0, width: "1px" }} />
        <div style={{ backgroundColor: tone, borderRadius: "999px", height: "100%", left: value >= 0 ? "50%" : `calc(50% - ${width})`, position: "absolute", top: 0, width }} />
        </div>
    );
};

const DiplomacyMetric = ({ label, value, tone = "#e5e7eb" }) => (
    <div style={{ ...cardStyle, minWidth: 0, padding: "0.55rem 0.6rem" }}>
    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>
    {label}
    </div>
    <div data-no-translate style={{ color: tone, fontSize: "1rem", fontWeight: 900, marginTop: "0.2rem" }}>{value}</div>
    </div>
);

const DiplomacySection = ({ world, targetCountry }) => {
    const diplomacy = useMemo(() => {
        if (!world || !targetCountry) return null;
        const target = canonicalPolityKey(targetCountry, world);
        const targetKey = lowerText(target);
        if (!targetKey) return null;

        const relations = asArray(world.relations)
            .map((relation) => {
                const a = canonicalPolityKey(relation?.a, world);
                const b = canonicalPolityKey(relation?.b, world);
                const aKey = lowerText(a);
                const bKey = lowerText(b);
                if (aKey !== targetKey && bKey !== targetKey) return null;
                const counterpart = aKey === targetKey ? b : a;
                return {
                    ...relation,
                    counterpart,
                    counterpartName: polityDisplayName(world, counterpart),
                    displayStatus: relationStatusForScore(relation?.score),
                };
            })
            .filter(Boolean)
            .sort((left, right) => Number(right.score || 0) - Number(left.score || 0) || left.counterpartName.localeCompare(right.counterpartName));

        const agreements = asArray(world.agreements)
            .map((agreement) => {
                const parties = asArray(agreement?.parties).map((party) => canonicalPolityKey(party, world)).filter(Boolean);
                if (!parties.some((party) => lowerText(party) === targetKey)) return null;
                const counterparts = parties
                    .filter((party) => lowerText(party) !== targetKey)
                    .map((party) => polityDisplayName(world, party));
                return { ...agreement, counterparts };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const rank = { active: 0, suspended: 1, ended: 2, expired: 3 };
                return (rank[lowerText(left.status)] ?? 9) - (rank[lowerText(right.status)] ?? 9) ||
                    String(right.lastUpdatedDate || right.startedDate || "").localeCompare(String(left.lastUpdatedDate || left.startedDate || ""));
            });

        const currentWars = asArray(world.wars)
            .filter((war) => ["active", "ceasefire"].includes(lowerText(war?.status)))
            .map((war) => {
                const sideA = asArray(war?.sideA).map((party) => canonicalPolityKey(party, world)).filter(Boolean);
                const sideB = asArray(war?.sideB).map((party) => canonicalPolityKey(party, world)).filter(Boolean);
                const onA = sideA.some((party) => lowerText(party) === targetKey);
                const onB = sideB.some((party) => lowerText(party) === targetKey);
                if (!onA && !onB) return null;
                const opponents = (onA ? sideB : sideA).map((party) => polityDisplayName(world, party));
                return { ...war, opponents };
            })
            .filter(Boolean)
            .sort((left, right) => String(right.lastUpdatedDate || right.startedDate || "").localeCompare(String(left.lastUpdatedDate || left.startedDate || "")));

        return {
            relations,
            agreements,
            currentWars,
            activeAgreements: agreements.filter((agreement) => lowerText(agreement.status) === "active").length,
        };
    }, [world, targetCountry]);

    if (!diplomacy) return null;

    return (
        <>
        <div style={sectionTitleStyle}>🤝 Diplomacy</div>
        <div style={{ display: "grid", gap: "0.45rem", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <DiplomacyMetric label="Relations" value={diplomacy.relations.length} tone="#60a5fa" />
        <DiplomacyMetric label="Active agreements" value={diplomacy.activeAgreements} tone="#34d399" />
        <DiplomacyMetric label="Conflicts" value={diplomacy.currentWars.length} tone={diplomacy.currentWars.length ? "#f87171" : "#94a3b8"} />
        </div>

        <div style={{ ...cardStyle, marginTop: "0.55rem", padding: 0, overflow: "hidden" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", padding: "0.55rem 0.65rem" }}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", fontWeight: 800 }}>Bilateral relations</span>
        <span style={{ color: "rgba(255,255,255,0.32)", fontSize: "0.6rem" }}>−100 to +100</span>
        </div>
        {diplomacy.relations.length ? diplomacy.relations.map((relation, index) => {
            const tone = relationTone(relation.score);
            return (
                <div key={relation.id || `${relation.counterpart}-${index}`} style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "0.55rem 0.65rem" }}>
                <div style={{ alignItems: "flex-start", display: "flex", gap: "0.6rem", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.88)", fontSize: "0.74rem", fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {relation.counterpartName}
                </div>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.62rem", marginTop: "0.12rem" }}>
                {relation.summary || "Tracked bilateral relationship."}
                </div>
                </div>
                <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column", flexShrink: 0, gap: "0.2rem" }}>
                <span data-no-translate style={{ color: tone, fontSize: "0.9rem", fontWeight: 900 }}>{formatRelationScore(relation.score)}</span>
                <span style={statusBadgeStyle(tone)}>{prettyToken(relation.displayStatus)}</span>
                </div>
                </div>
                <RelationMeter score={relation.score} tone={tone} />
                </div>
            );
        }) : (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", padding: "0.65rem" }}>
            No tracked bilateral relations. An absent record is not the same as explicit neutrality.
            </div>
        )}
        </div>

        <div style={{ ...cardStyle, marginTop: "0.55rem", padding: 0, overflow: "hidden" }}>
        <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", fontWeight: 800, padding: "0.55rem 0.65rem" }}>
        Formal agreements
        </div>
        {diplomacy.agreements.length ? diplomacy.agreements.map((agreement, index) => {
            const tone = agreementStatusTone(agreement.status);
            const counterpartText = agreement.counterparts.length ? agreement.counterparts.join(" · ") : "Multilateral agreement";
            return (
                <div key={agreement.id || `${agreement.title}-${index}`} style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "0.55rem 0.65rem" }}>
                <div style={{ alignItems: "flex-start", display: "flex", gap: "0.55rem", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.86)", fontSize: "0.72rem", fontWeight: 750 }}>{agreement.title || "Untitled agreement"}</div>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", marginTop: "0.14rem" }}>
                {prettyToken(agreement.type || "other")} · {counterpartText}
                </div>
                {agreement.lastUpdatedDate && (
                    <div data-no-translate style={{ color: "rgba(255,255,255,0.28)", fontSize: "0.58rem", marginTop: "0.12rem" }}>
                    Updated {agreement.lastUpdatedDate}
                    </div>
                )}
                </div>
                <span style={statusBadgeStyle(tone)}>{prettyToken(agreement.status || "active")}</span>
                </div>
                </div>
            );
        }) : (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", padding: "0.65rem" }}>
            No canonical formal agreements involving this polity.
            </div>
        )}
        </div>

        <div style={{ ...cardStyle, marginTop: "0.55rem", padding: 0, overflow: "hidden" }}>
        <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", fontWeight: 800, padding: "0.55rem 0.65rem" }}>
        Current conflicts
        </div>
        {diplomacy.currentWars.length ? diplomacy.currentWars.map((war, index) => {
            const tone = warStatusTone(war.status);
            return (
                <div key={war.id || `${war.title}-${index}`} style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "0.55rem 0.65rem" }}>
                <div style={{ alignItems: "flex-start", display: "flex", gap: "0.55rem", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.86)", fontSize: "0.72rem", fontWeight: 750 }}>
                vs {war.opponents.length ? war.opponents.join(" · ") : "Unknown opponent"}
                </div>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", marginTop: "0.14rem" }}>
                {war.title || "Canonical conflict"}{war.startedDate ? ` · since ${war.startedDate}` : ""}
                </div>
                </div>
                <span style={statusBadgeStyle(tone)}>{prettyToken(war.status || "active")}</span>
                </div>
                </div>
            );
        }) : (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", padding: "0.65rem" }}>
            No active or ceasefire canonical conflicts involving this polity.
            </div>
        )}
        </div>
        </>
    );
};

const statsSubtabStyle = (selected) => ({
    alignItems: "center",
    backgroundColor: selected ? "rgba(59,130,246,0.13)" : "rgba(255,255,255,0.025)",
    border: `1px solid ${selected ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.09)"}`,
    borderRadius: "8px",
    color: selected ? "#bfdbfe" : "rgba(255,255,255,0.58)",
    cursor: "pointer",
    display: "flex",
    flex: 1,
    fontSize: "0.72rem",
    fontWeight: 800,
    justifyContent: "center",
    minHeight: "2.45rem",
    padding: "0.45rem 0.55rem",
    transition: "background-color 0.15s, border-color 0.15s, color 0.15s",
});

const StatsPane = ({ active }) => {
    const { activeGameId } = useLibraryState();
    const [player, setPlayer] = useState({ code: "", date: "", gameKey: "game" });
    const [targetCountry, setTargetCountry] = useState("");
    const [polity, setPolity] = useState(null); // world.polityOverrides[target]
    const [worldSnapshot, setWorldSnapshot] = useState(null);
    const [statsView, setStatsView] = useState("diplomacy");
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
                    gameKey: String(activeGameId || game?.id || game?.name || JSON_URLS.game || "game"),
                };
                if (player.gameKey !== nextPlayer.gameKey) {
                    setTargetCountry(code);
                    setState({ status: "idle", sheet: null, error: "" });
                    setWorldSnapshot(null);
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

    const loadSheet = useCallback(async ({ force = false, forceReassess = false } = {}) => {
        const code = targetCountry;
        if (!code) return;
        const cacheKey = `${player.gameKey}:${code}`;
        // The AI's partial stat changes, kept aside so they can be layered over
        // whichever full sheet we end up with (cached or freshly generated).
        let aiOverride = null;
        if (!force) {
            // The persisted, AI-maintained sheet in world state wins and SURVIVES date
            // changes — it changes only when the AI changes it (polityChanges.stats).
            try {
                const world = await readWorldState({ force: false });
                const persisted = world?.countryStats?.[code];
                if (persisted && isValidStatSheet(persisted)) {
                    memoryCache.set(cacheKey, { date: player.date, sheet: persisted });
                    setState({ status: "ready", sheet: persisted, error: "" });
                    return;
                }
                // Incomplete on its own, but still the AI's word on the fields it names.
                if (persisted && typeof persisted === "object") aiOverride = persisted;
            } catch { /* fall through to the device cache / regenerate */ }
            // Device-cache fallback — no longer date-gated, so it persists across dates.
            const cached = memoryCache.get(cacheKey) ?? readStoredSheets()[cacheKey];
            if (cached && isValidStatSheet(cached.sheet)) {
                const sheet = mergeStatSheet(cached.sheet, aiOverride);
                memoryCache.set(cacheKey, { date: player.date, sheet });
                setState({ status: "ready", sheet, error: "" });
                return;
            }
        }
        setState({ status: "loading", sheet: null, error: "" });
        try {
            // targetCountry is the stable campaign identity key. A polity rename keeps
            // that key on purpose, so resolve the CURRENT display name separately for
            // the human-facing header and the Stats generation prompt. Identity and
            // territorial scope remain independent: a renamed polity does not gain land.
            let generationName = displayName || code;
            try {
                const latestWorld = await readWorldState({ force: false });
                const liveName = String(latestWorld?.polityOverrides?.[code]?.name || "").trim();
                if (liveName) generationName = liveName;
            } catch { /* display-name lookup is non-fatal */ }

            const generated = await generateCountryStatSheet({ code, name: generationName, forceReassess });
            const validation = validateGameplayPayload("countryStatSheet", generated);
            if (!validation.valid) throw new Error(`The stat sheet failed validation: ${validation.error}`);
            // generateCountryStatSheet already receives the previous persistent sheet as
            // continuity context and persists through the native mutation boundary. Do
            // not re-apply the legacy/partial pre-generation record here: doing so can
            // overwrite freshly normalized component-derived GDP with stale browser-era values.
            const sheet = finalizeCountryStatSheet(generated);
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

    // Cheats 2.0 country edits mutate the same canonical world.countryStats seam.
    // If this pane is already open, consume the lightweight local event and refresh
    // from world state immediately instead of showing a stale pre-edit browser view.
    useEffect(() => {
        if (!active || !targetCountry || typeof window === "undefined") return undefined;

        let cancelled = false;
        const onCountryStatsUpdated = async (event) => {
            const changedCountry = String(event?.detail?.country || "").trim();
            if (changedCountry && changedCountry !== targetCountry) return;

            try {
                const world = await readWorldState({ force: true });
                if (cancelled) return;

                const persisted = world?.countryStats?.[targetCountry];
                if (persisted && typeof persisted === "object") {
                    const cacheKey = `${player.gameKey}:${targetCountry}`;
                    const entry = { date: player.date, sheet: persisted };
                    memoryCache.set(cacheKey, entry);
                    storeSheet(cacheKey, entry);
                    setState({ status: "ready", sheet: persisted, error: "" });
                }

                setWorldSnapshot(world || {});
                setPolity(world?.polityOverrides?.[targetCountry] ?? null);
                setPlayerLandless(isPolityLandless(world, player.code));
            } catch {
                // The normal pane refresh path remains available if this best-effort
                // same-session synchronization cannot read the world immediately.
            }
        };

        window.addEventListener("oh:country-stats-updated", onCountryStatsUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:country-stats-updated", onCountryStatsUpdated);
        };
    }, [active, targetCountry, player.gameKey, player.date, player.code]);

    useEffect(() => {
        if (!active || !targetCountry) return;
        setFlagFailed(false);
        loadSheet();
        readWorldState({ force: false })
            .then((world) => {
                setWorldSnapshot(world || {});
                setPolity(world?.polityOverrides?.[targetCountry] ?? null);
                setPlayerLandless(isPolityLandless(world, player.code));
            })
            .catch(() => {
                setWorldSnapshot(null);
                setPolity(null);
                setPlayerLandless(false);
            });
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

    const budgetNegative = Number(sheet?.economy?.budgetBalance) < 0;
    const totalPopulation = Number(sheet?.population?.total);
    const corePopulation = Number(sheet?.population?.coreIntegrated);
    const otherPopulation = Number(sheet?.population?.otherTerritories);
    const hasOtherTerritories = Number.isFinite(otherPopulation) && otherPopulation > 0;
    const wholePerCapita = Number(sheet?.economy?.gdpPerCapita);
    const corePerCapita = Number(sheet?.economy?.coreGdpPerCapita);
    const displayedPerCapita = hasOtherTerritories && Number.isFinite(corePerCapita)
        ? corePerCapita
        : wholePerCapita;
    const populationScope = hasOtherTerritories
        ? `Core/integrated ${formatPopulation(corePopulation)} · Other territories ${formatPopulation(otherPopulation)}`
        : "";
    const capitaScope = hasOtherTerritories
        ? `Core/integrated · Whole polity ${formatEuroPerCapita(wholePerCapita)}`
        : "Whole polity";

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
            {polity?.name || displayName || targetCountry}
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
            {statsView === "economy" && state.status !== "loading" && (
                <button
                onClick={(event) => loadSheet({ force: true, forceReassess: event.shiftKey })}
                title="Refresh stat sheet · Shift+click = force fresh baseline"
                aria-label="Refresh stat sheet; hold Shift while clicking to force a fresh baseline"
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "1rem", padding: 0 }}
                >↻</button>
            )}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
            <button
            type="button"
            aria-pressed={statsView === "diplomacy"}
            onClick={() => setStatsView("diplomacy")}
            style={statsSubtabStyle(statsView === "diplomacy")}
            >🤝 Diplomacy</button>
            <button
            type="button"
            aria-pressed={statsView === "economy"}
            onClick={() => setStatsView("economy")}
            style={statsSubtabStyle(statsView === "economy")}
            >📈 Economy</button>
            </div>

            {statsView === "economy" && state.status === "loading" && (
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginTop: "1rem" }}>
                Compiling national statistics…
                </p>
            )}

            {statsView === "economy" && state.status === "error" && (
                <div style={{ backgroundColor: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", fontSize: "0.8rem", marginTop: "1rem", padding: "0.7rem 0.8rem" }}>
                {state.error}
                <button
                onClick={() => loadSheet({ force: true })}
                style={{ background: "none", border: "none", color: "#93c5fd", cursor: "pointer", display: "block", fontSize: "0.8rem", fontWeight: 700, marginTop: "0.4rem", padding: 0 }}
                >Try again</button>
                </div>
            )}

            {statsView === "diplomacy" && worldSnapshot && (
                <DiplomacySection world={worldSnapshot} targetCountry={targetCountry} />
            )}

            {statsView === "diplomacy" && !worldSnapshot && (
                <p style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.76rem", marginTop: "1rem" }}>
                Loading diplomatic state…
                </p>
            )}

            {statsView === "economy" && sheet && state.status === "ready" && (
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

                {/* Population — whole polity plus core/integrated vs other territories. */}
                <div style={sectionTitleStyle}>👥 Population</div>
                <div style={cardStyle}>
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                Total population
                </div>
                <div data-no-translate style={{ color: "#e5e7eb", fontSize: "1.15rem", fontWeight: 800 }}>
                {formatPopulation(totalPopulation)}
                </div>
                {populationScope && (
                    <div data-no-translate style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem", marginTop: "0.2rem" }}>
                    {populationScope}
                    </div>
                )}
                </div>

                {/* Economy */}
                <div style={sectionTitleStyle}>📈 Economy</div>
                <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "1fr 1fr" }}>
                <EconomyCard
                label="GDP"
                value={formatEuroTotal(sheet.economy?.gdp)}
                sub={`Growth ${formatPercent(sheet.economy?.gdpGrowth, { signed: true })} · 2026-EUR eq.`}
                tone="#34d399"
                />
                <EconomyCard
                label="GDP/capita"
                value={formatEuroPerCapita(displayedPerCapita)}
                sub={capitaScope}
                tone="#e5e7eb"
                />
                <EconomyCard label="Inflation" value={formatPercent(sheet.economy?.inflation)} tone="#34d399" />
                <EconomyCard label="Unemployment" value={formatPercent(sheet.economy?.unemployment)} tone="#34d399" />
                <EconomyCard label="Public debt" value={formatPercent(sheet.economy?.publicDebt)} sub="of GDP" tone="#34d399" />
                <EconomyCard
                label="Budget balance"
                value={formatPercent(sheet.economy?.budgetBalance, { signed: true })}
                sub={`${budgetNegative ? "Deficit" : "Surplus"} · of GDP`}
                tone={budgetNegative ? "#f87171" : "#34d399"}
                />
                </div>
                {sheet.economy?.currency && (
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.66rem", marginTop: "0.45rem" }}>
                    Domestic currency: <span data-no-translate>{sheet.economy.currency}</span> · GDP accounting shown in 2026-EUR-equivalent values.
                    </div>
                )}

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
